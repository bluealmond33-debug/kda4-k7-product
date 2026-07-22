"""pgvector 규정 저장소 초기화 + 더미 규정 시드 (1회성).

전제: Docker(pgvector/pgvector:pg17)로 Postgres가 떠 있고, .env의 DATABASE_URL이 그 인스턴스를
가리키며, USE_LOCAL_MODELS=true(Ollama bge-m3 가동 중)일 것.

실행:
    cd backend
    ./.venv/Scripts/python.exe -m scripts.seed_rag_pgvector

동작:
    1) database/rag/schema.sql 실행 → pgvector 확장 + rag_documents/rag_chunks 생성
    2) app/services/rag.py의 _DOCS를 Ollama bge-m3로 임베딩해 upsert(멱등)
    3) pgvector_ready() 재판정 결과 출력
성공하면 이후 search_procedures()가 자동으로 pgvector 경로로 전환된다(백엔드 재시작 권장).
"""

import sys

from app.config import settings
from app.services import rag_store


def main() -> int:
    if not settings.database_url:
        print("[중단] DATABASE_URL이 비어 있습니다 (.env 확인)")
        return 1
    if not settings.use_local_models:
        print("[중단] USE_LOCAL_MODELS=false — pgvector 컬럼은 bge-m3(1024) 전제입니다")
        return 1

    print("· pgvector 스키마 초기화 중...")
    try:
        rag_store.initialize_rag(settings)
    except rag_store.RegulationSearchUnavailable as exc:
        print(f"[실패] 스키마 초기화 — pgvector 확장이 설치됐는지 확인: {exc}")
        return 1

    print("· 더미 규정 임베딩 + 적재 중 (Ollama bge-m3)...")
    try:
        count = rag_store.seed_demo_regulations(settings)
    except rag_store.RegulationSearchUnavailable as exc:
        print(f"[실패] 시드 적재: {exc}")
        return 1

    ready = rag_store.pgvector_ready(settings)
    print(f"· 완료: 청크 {count}개 적재, pgvector_ready = {ready}")
    if not ready:
        print("  ⚠ ready=False — 확장/시드 상태를 확인하세요")
        return 1
    print("  → 이제 search_procedures()가 pgvector 경로를 사용합니다. 백엔드 재시작 권장.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
