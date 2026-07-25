#!/usr/bin/env bash
# K7 로컬(온프레미스) 데모 한 방 기동 — Postgres + 백엔드(8000) + 프론트(5173, LAN)
#
# 사용:  ./scripts/demo-up.sh          # 기동 (이미 떠 있으면 재시작)
#        ./scripts/demo-up.sh down     # 종료
#
# 전제: brew postgresql@17 + pgvector, backend/.venv(uvicorn·FlagEmbedding·faster-whisper 포함),
#       k7 DB에 규정 청크 적재 완료(database/rag/README.md 절차).
#       실시간 STT를 쓰려면: backend/.venv/bin/pip install -r backend/requirements-live-stt.txt
#       (모델 가중치는 최초 1회만 내려받고 이후 완전 오프라인)
# LAN IP가 바뀌어도(와이파이 이동) 다시 실행하면 env를 재생성해 맞춘다.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PG="/opt/homebrew/opt/postgresql@17/bin"
VENV="$ROOT/backend/.venv"
LOG_DIR="${TMPDIR:-/tmp}/k7-demo"
mkdir -p "$LOG_DIR"

down() {
  pkill -f "uvicorn app.main:app" 2>/dev/null || true
  pkill -f "vite.*--host" 2>/dev/null || true
  echo "백엔드·프론트 종료됨 (Postgres는 유지)"
}

if [ "${1:-}" = "down" ]; then down; exit 0; fi

IP="$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || echo 127.0.0.1)"
echo "LAN IP: $IP"

# 1) Postgres (규정 pgvector 인덱스)
brew services start postgresql@17 >/dev/null 2>&1 || true
for i in 1 2 3 4 5; do "$PG/pg_isready" -q && break || sleep 1; done
"$PG/pg_isready" -q || { echo "❌ Postgres 기동 실패"; exit 1; }
echo "✅ Postgres"

# 2) env 재생성 — LAN IP 기준 (gitignored 파일들)
#
# k7-backend(HeeChang) config.py 변수명에 맞춘다(ADR-0012 모노레포 통합):
#   USE_LOCAL_MODELS=true      → OpenAI 대신 로컬 STT(faster-whisper)+로컬 LLM(Ollama exaone)
#   STUB_MODELS=true           → 모델·Ollama 없이 canned 응답(화면 흐름만). `demo-up.sh stub` 로 켠다
#   LOCAL_WHISPER_DEVICE       → 이 맥은 cuda 없으니 cpu/int8. GPU 서버는 cuda/float16로 바꾼다
#   OLLAMA_MODEL               → 상담가이드(consult_guide) 생성용. 미기동이면 canned 폴백
STUB=false; [ "${1:-}" = "stub" ] && STUB=true
cat > "$ROOT/backend/.env" <<EOF
DATABASE_URL=postgresql://localhost:5432/k7
USE_LOCAL_MODELS=true
STUB_MODELS=$STUB
LOCAL_WHISPER_MODEL=large-v3-turbo
LOCAL_WHISPER_DEVICE=cpu
LOCAL_WHISPER_COMPUTE_TYPE=int8
OLLAMA_BASE_URL=http://localhost:11434
OLLAMA_MODEL=exaone3.5:7.8b
EXTRA_CORS_ORIGINS=https://k7product.vercel.app,http://$IP:5173,http://localhost:5173
EOF
cat > "$ROOT/.env.development.local" <<EOF
VITE_API_BASE_URL=http://$IP:8000
EOF

# 3) 백엔드 (bge-m3 warm-up은 부팅 시 백그라운드 스레드가 알아서)
[ -x "$VENV/bin/uvicorn" ] || { echo "❌ backend/.venv 없음 — python3.12 -m venv backend/.venv 후 requirements(-rag) 설치"; exit 1; }
pkill -f "uvicorn app.main:app" 2>/dev/null || true; sleep 1
(cd "$ROOT/backend" && nohup "$VENV/bin/uvicorn" app.main:app --host 0.0.0.0 --port 8000 \
  > "$LOG_DIR/backend.log" 2>&1 &)
for i in $(seq 1 20); do curl -sf "http://localhost:8000/health" >/dev/null && break || sleep 1; done
curl -sf "http://localhost:8000/health" >/dev/null || { echo "❌ 백엔드 기동 실패 — $LOG_DIR/backend.log 확인"; exit 1; }
echo "✅ 백엔드  http://$IP:8000  (log: $LOG_DIR/backend.log)"

# 4) 프론트 (LAN 바인딩)
pkill -f "vite.*--host" 2>/dev/null || true; sleep 1
(cd "$ROOT" && nohup npm run dev -- --host > "$LOG_DIR/frontend.log" 2>&1 &)
for i in $(seq 1 20); do curl -sf "http://localhost:5173/" >/dev/null && break || sleep 1; done
curl -sf "http://localhost:5173/" >/dev/null || { echo "❌ 프론트 기동 실패 — $LOG_DIR/frontend.log 확인"; exit 1; }
echo "✅ 프론트  http://$IP:5173  (log: $LOG_DIR/frontend.log)"

echo ""
echo "── 시연 4화면 (같은 와이파이 어느 기기에서나) ──"
echo "  시연 합본   http://$IP:5173/"
echo "  고객 화면   http://$IP:5173/?role=customer"
echo "  직원 화면   http://$IP:5173/?role=employee"
echo "  관리자      http://$IP:5173/?role=admin"
