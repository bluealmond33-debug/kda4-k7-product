# app/rag — 규정 검색 (RAG)

상담 콘솔의 "관련 규정 및 매뉴얼" 패널 백엔드. 은행 규정 PDF를 검색 가능한 청크로 만들고, 상담 용건에 맞는 규정을 하이브리드 검색으로 추천한다.

설계·근거 전체: hippo `07 Outputs/2026-07-20-RAG-규정검색-설계-및-분류체계-v0.1.md`

## 구성

| 파일 | 역할 |
|---|---|
| `taxonomy.py` | 8 대분류 닫힌 집합 (검색 필터 + AI 용건분류 라벨셋) |
| `ingest.py` | PDF → 구조화 청크 (조항/표 분리·중복제거·엔티티태깅·개정일감지) |
| `embedder.py` | bge-m3 임베딩 (onprem, lazy) — 없으면 `is_available()=False` |
| `store.py` | pgvector 적재 + 하이브리드 검색(의미+키워드) + supersede/카테고리 필터 |

## 엔드포인트

- `GET /api/v1/regulations/search?q=&category=&k=` — 패널용. `{available, documents}`.
  인덱스/모델 미프로비저닝 시 `available=false`(에러 아님) → 패널은 수동 목록으로 폴백.
- `POST /rag`, `POST /briefing` (legacy) — 더미 5개 대신 실검색 결과. 검색 불가 시 더미 유지.

## 그레이스풀 디그레이드

API 부팅에는 무거운 의존성이 **필요 없다**. `FlagEmbedding`(bge-m3)·`pdfplumber`가 없으면 규정검색은 `available=false`로 응답하고 나머지 API는 정상 동작. 실검색·인덱싱 호스트에만 설치:

```bash
pip install -r requirements-rag.txt
```

## 문서 적재 (온프레미스/인덱스 호스트)

```bash
# 1) database/rag/registry.sample.csv 를 참고해 문서 대장 작성 (doc당 한 줄)
# 2) PDF → 청크 → pgvector 적재
export DATABASE_URL=postgresql://...        # pgvector 확장 필요
python3 -m app.rag.ingest registry.csv 규정1.pdf 규정2.pdf > /dev/null  # 청크 확인
python3 - <<'PY'
from app.config import get_settings
from app.rag.ingest import ingest_files
from app.rag.store import upsert_documents_and_chunks
chunks = ingest_files("registry.csv", ["규정1.pdf", "규정2.pdf"])
print(upsert_documents_and_chunks(get_settings(), chunks), "chunks loaded")
PY
```

## 규정 개정 (supersede)

덮어쓰지 않고 갈아끼운다: registry에서 구버전 `status=superseded`, 신버전 `status=active` → 재적재. 검색은 `status='active'`만 노출. 개정일은 ingest가 본문에서 자동 감지.
