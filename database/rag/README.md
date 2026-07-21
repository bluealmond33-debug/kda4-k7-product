# 규정 RAG — 전처리 산출물 & 온프레미스 적재 안내

이 폴더는 규정검색(RAG)용 **전처리 완료 산출물**과 스키마를 담습니다.
전처리(PDF → 청킹 → 부서/업무코드 태깅)는 끝났고, **임베딩 + pgvector 적재만 온프레미스에서 수행**하면 검색이 동작합니다.

## 파일

| 파일 | 내용 |
|---|---|
| `registry.csv` | 문서 대장 32건. 3층 분류(`routing` S/G/E · `department` DEP/LON/FX/INV · `business_code`) 포함 |
| `chunks.jsonl` | 전처리 완료 청크 **1,153개** (본문 972 · 표 181). 문서 32건 전부. 각 청크에 `department`/`business_code`/`routing`/`categories` 태그 부착 |
| `schema.sql` | pgvector 스키마 (`rag_documents` / `rag_chunks`, `vector(1024)`, hnsw+GIN 인덱스) |
| `registry.sample.csv` | 샘플 |

- 대상: 하나은행 예금(청약·발행어음)·대출·외환·연금(IRP) 상품설명서/약관.
- 청킹 기준: 구조 마커(`◇ □ ①~⑳ 제N조 [소제목]`) 분리 · 표 별도 마크다운 · 중복 해시 제거 · 맥락 헤더 · 1200자 캡 · 법령/서식코드/개정일 엔티티 태깅. (스캔본 `발행어음.pdf`는 OCR 처리)

## ⚠️ 온프레미스에서 해야 할 일 — 임베딩 + pgvector 적재

`chunks.jsonl`은 **글 조각**일 뿐이라, 아래 2단계를 **온프레미스 인덱스 호스트**에서 수행해야 검색이 가능합니다.

1. **임베딩** — 각 청크 텍스트를 bge-m3(BAAI/bge-m3, 1024차원, 로컬)로 벡터화
2. **pgvector 적재** — `rag_documents` / `rag_chunks` 테이블에 저장

이 두 단계는 `backend/app/rag/store.py`의 `upsert_documents_and_chunks()`가 한 번에 처리합니다(내부에서 `embedder.embed()` 호출 → 적재).

### 사전 준비 (인덱스 호스트)

```bash
# bge-m3 임베딩 + pdf 도구 (런타임 API에는 불필요, 적재 호스트에만)
pip install -r backend/requirements-rag.txt

# pgvector가 켜진 온프레미스 Postgres 접속 정보
export DATABASE_URL=postgresql://<user>:<pw>@<host>:5432/<db>
export K7_EMBED=bge-m3            # 운영 기본값 (1024차원)
```

### 적재 실행 (PDF 재청킹 없이 chunks.jsonl 직접 적재)

`chunks.jsonl`이 이미 준비돼 있으므로 **재청킹 없이 바로 적재**할 수 있습니다. `backend/`에서 실행:

```bash
cd backend
python3 - <<'PY'
import json
from app.config import get_settings
from app.rag.store import upsert_documents_and_chunks

with open("../database/rag/chunks.jsonl", encoding="utf-8") as f:
    chunks = [json.loads(line) for line in f if line.strip()]

n = upsert_documents_and_chunks(get_settings(), chunks)
print(n, "chunks loaded")   # 1153 예상
PY
```

> 처음 실행 시 스키마가 없으면 `initialize_rag(get_settings())`를 먼저 호출하거나, `store.upsert...`가 참조하는 `database/rag/schema.sql`이 적용돼 있어야 합니다.

### (선택) PDF 원본에서 다시 청킹하려면

원본 PDF가 있고 청킹부터 재실행하려면:

```bash
cd backend
python3 -m app.rag.ingest ../database/rag/registry.csv <파일1.pdf> <파일2.pdf> ...
```
→ 단, 현재 `chunks.jsonl`은 스캔본 `발행어음.pdf`의 OCR 결과를 포함하므로, PDF 재청킹만으로는 발행어음이 비어버립니다(OCR 별도 필요). **기본 경로는 위의 `chunks.jsonl` 직접 적재를 권장.**

## 적재 후 — 검색

적재가 끝나면 `backend/app/rag/store.py`의 `search_regulations(settings, query, category=..., limit=...)`로 하이브리드 검색(의미 0.65 + 키워드 0.35)이 동작합니다.

- **부서(8대분류) 단계 필터**: `category=` 파라미터로 이미 지원 (DEP/LON/FX/INV 등).
- **세부 업무코드(`business_code`) 단계 필터**: 청크에 태그는 부착돼 있으나, `taxonomy.py` 유효코드 목록에 신규 코드(`subscription`/`pension`/detail) 추가 또는 별도 `business_code` 필터 파라미터 신설이 필요(백엔드 소폭 확장).

## 분류 태그 요약 (registry / chunks 공통)

```
routing(1층)      : G (전부 일반) — S(단순)/E(긴급)는 이번 세트에 해당 문서 없음
department(2층)   : DEP 수신·예적금 / LON 여신·대출 / FX 외환 / INV 연금
business_code(3층): subscription(청약)·deposit(발행어음) / loan / fx / pension(IRP)
```
