# 개인 백엔드 → 팀 모노레포 이식 (kda4-k7-product/backend)

- 작성일: 2026-07-23
- 작성: 이희창 (통합승인책임자)
- 관련: 7/29 팀 발표·제출

## 배경

백엔드가 두 곳에 있고 갈라져 있다.

| | 위치 | 상태 |
|---|---|---|
| **실엔진** | `HeeChang50/kda4-k7-backend` | 현재 데모를 돌리는 온프레미스 파이프라인. `app/` 69개 .py, 커밋 60개 |
| **레거시** | `kda4-k7-product/backend/` | `app/` 19개 .py. README가 "활성 경로 아님"으로 명시. 다만 김민기 RAG·어댑터가 여기에만 있다 |

팀 레포 `README.md:17`이 "실행 엔진은 이 저장소가 아니라 `HeeChang50/kda4-k7-backend`입니다"라고
적고 있어 현 구도는 팀이 인지한 상태다.

## 목표

셋을 동시에 만족시킨다.

1. **완성품** — 7/29 발표 시점에 동작하는 하나의 백엔드
2. **포트폴리오** — 개인 레포의 커밋 60개가 팀 레포 히스토리에도 커밋 단위로 남을 것
3. **팀 통합** — 팀원이 모여 있는 `kda4-k7-product`가 단일 진실 공급원이 될 것

개인 레포는 이식 후에도 **삭제하지 않는다**. 포트폴리오용 독립 저장소로 유지한다.

## 병합면 실측 (2026-07-23)

양쪽 `app/**.py`를 비교했다.

| 구분 | 수 | 내용 |
|---|---|---|
| 양쪽에 있고 **내용이 다름** | 5 | `__init__.py`, `config.py`, `contracts.py`, `database.py`, `main.py` |
| 양쪽에 있고 동일 | **0** | — |
| product에만 (보존 대상) | 14 | 김민기 `app/rag/` 6, `app/routing/` 3, 어댑터 5 |
| 실엔진에만 | ~64 | 온프레미스 파이프라인 전체 (`services/`, `routers/`, `ws/` 등) |

**위험은 초기 우려보다 낮다.** 확인된 사실:

- `database/rag/schema.sql` — 두 파일의 diff가 **전부 주석**(한글/영문)이다. 테이블·컬럼·타입 차이 0.
- `app/database.py` — 공개 API가 **완전히 동일**하다. 같은 `DatabaseUnavailable`, 같은 6개 함수, 같은 시그니처.
- 두 pgvector 스토어는 **한쪽이 다른 쪽에서 파생**됐다(2026-07-21 ADR-0010 작업). 같은 클래스명·헬퍼를 공유하고 기능이 보완적이다.

| | 고유 기능 |
|---|---|
| 김민기 `app/rag/store.py` (294줄) | `upsert_documents_and_chunks`, `get_regulation_document`, `get_regulation_stats` — 적재·조회·통계 |
| 실엔진 `services/rag_store.py` (257줄) | `pgvector_ready`, `_probe`, `reset_readiness`, `seed_demo_regulations` — 가용성 게이팅·시딩 |

실질 충돌은 `main.py` 하나다. `/api/v1/regulations/*` 4경로(`/search`·`/stats`·`/documents/{id}`·`/upload`)가
양쪽에 있는데, product는 `main.py` 인라인 + 김민기 pgvector를, 실엔진은 `routers/regulations.py` +
FAISS를 쓴다.

## ADR-0011과의 관계 — 이 이식은 §2를 대체한다

`kda4-k7-hippo/02 Decisions/ADR-0011-온프레미스-전면전환.md`(2026-07-23, 확정)의 §2가
저장소 역할을 다음으로 고정해 두었다.

> | `HeeChang50/kda4-k7-backend` | **실행 엔진** |
> | `kda4-k7-product` | **계약·저장·적재 + 프론트** |
>
> 접점은 `persist_pipeline_result()`다. STT나 모델을 두 곳에서 각각 실행하지 않는다.

**이 이식은 §2를 supersede한다.** 실행 엔진을 `kda4-k7-product/backend`로 옮겨 팀 레포를 단일
진실 공급원으로 만든다. 별도 ADR-0012를 작성해 결정 이력을 남긴다. ADR-0011의 나머지(§1 온프레미스
실행 기준, §3 레거시 경계, §5 pgvector/FAISS)는 그대로 유효하다.

### 폴백은 유실되지 않는다

ADR-0011 §3이 `product/backend`의 OpenAI 경로를 남긴 이유는 "온프레미스 장비가 없는 팀원이
화면만 확인하거나, 데모 당일 장비 장애 시 폴백"이다. 이식해도 이 기능은 유지된다 —
실엔진 `app/routers/mvp.py`가 이미 3경로를 분기하기 때문이다.

```python
if settings.stub_models:          transcribe_audio_stub(...)     # 장비 없는 팀원
elif settings.use_local_models:   transcribe_audio_local(...)    # 온프레미스 (기본)
else:                             transcribe_audio(client, ...)  # OpenAI 폴백
```

| 상황 | 설정 |
|---|---|
| 온프레미스 시연 (기본) | `USE_LOCAL_MODELS=true` |
| GPU·Ollama 없는 팀원 | `STUB_MODELS=true` — UI 흐름 확인 가능 |
| 데모 당일 장비 장애 | 둘 다 `false` + OpenAI 키 |

즉 이식 후 폴백이 **하나의 코드베이스 안에서 환경변수로** 갈린다. 두 레포에 두 구현을 두는
것보다 정합성이 높다. 이것이 ADR-0012의 핵심 근거다.

## 결정

### 히스토리 보존 방식

`git subtree`로 편입한다. 파일만 복사하면 커밋 60개가 **커밋 1개로 뭉개져** 팀 레포의
`git blame`과 기여 그래프에서 작업 이력이 사라진다.

**제약**: `product/backend/`가 이미 존재하므로 `git subtree add --prefix=backend`는 실패한다
(`prefix 'backend' already exists`). 임시 경로를 경유한다.

```bash
cd kda4-k7-product
git remote add mybackend https://github.com/HeeChang50/kda4-k7-backend.git
git fetch mybackend
git subtree add --prefix=backend-upstream mybackend main
```

이 시점에 실엔진 커밋 60개가 product 히스토리에 편입된다. 이후 `backend-upstream/`의 파일을
`backend/`로 병합하고 `backend-upstream/`을 지운다. **디렉터리를 지워도 히스토리는 남는다.**

### 충돌 5파일 해소 방침

| 파일 | 방침 |
|---|---|
| `app/__init__.py` | product 것 채택 (실엔진 0줄, product 1줄) |
| `app/config.py` | 실엔진 필드 전부 채택(whisper·ollama·감정모델·wavlm·vad 등) + product의 `get_settings()` lru_cache 유지. 모듈 레벨 `settings = get_settings()`를 **병기**해 두 import 스타일을 모두 지원한다 |
| `app/contracts.py` | product 기반(`extra="forbid"`·`_reject_boolean_number` 검증기 보존) + 실엔진의 `EmotionStatus.DEMO` 추가 |
| `app/database.py` | 공개 API가 같으므로 실엔진 구현을 채택하고 product 고유 로직만 이식 |
| `app/main.py` | 실엔진의 라우터 구조 채택. product의 인라인 regulations 4경로를 `routers/regulations.py`로 흡수 |

`config.py`의 import 스타일은 실엔진 8파일이 `from app.config import settings`, product 3파일이
`get_settings()`를 쓴다. 총 11파일이라 양쪽 병기가 재작성보다 싸고 안전하다.

### RAG 단일화

- **라우터**: 실엔진 `app/routers/regulations.py`를 채택한다. 4경로가 이미 다 있다.
- **저장소**: 실엔진의 **디스패처 패턴**을 유지한다 — `pgvector_ready()`면 pgvector, 아니면 FAISS
  폴백. `services/rag.py::search_procedures`에 이미 구현돼 있다.
- **흡수**: 김민기 `app/rag/store.py`의 고유 기능(`upsert_documents_and_chunks`,
  `get_regulation_stats`, `get_regulation_document`)을 실엔진 `services/rag_store.py`로 옮겨
  **pgvector 구현을 하나로** 만든다.
- **유지**: `services/rag.py`의 FAISS 경로와 하나은행 1,153청크는 폴백 계층으로 남긴다.
- **적재**: 김민기 `app/rag/ingest.py`·`auto_ingest.py`·`embedder.py`·`taxonomy.py`는 그대로 살린다.

이 방침이 **ADR-0010(벡터저장소 pgvector 통일)을 준수하면서 현재 동작하는 FAISS 데모를 깨지
않는다.** pgvector가 실제로 뜨면(현재는 Docker를 쓰지 않아 미가동) 자동으로 그쪽을 탄다.

## 완료 기준

- 실엔진 테스트 **76 passed, 4 skipped** 전부 통과
- product 테스트 **13개 파일** 전부 통과
- `npm run check` 통과 (manifest·contracts·adapter·frontend-contract·build)
- `/health`가 `{"status":"ok","database":"connected","contract_version":"mvp-1.0"}` 응답
- 시연 WAV E2E: STT → 요약 → 감정온도(REAL_MODEL) → judge → RAG → 상담카드가 이식 전과 동일
- `git log --oneline backend/` 에 개인 레포 커밋 60개가 보일 것

## 위험과 완화

| 위험 | 완화 |
|---|---|
| 발표 6일 전 대수술로 데모가 깨진다 | 이식 작업은 **별도 브랜치**에서 한다. `main`은 손대지 않는다. 완료 기준을 다 통과하기 전에는 머지하지 않는다. 실패 시 현 실엔진으로 발표한다 |
| 김민기·이찬희 코드 손실 | product 고유 14파일은 **삭제 금지**. 완료 기준에 product 테스트 13개 파일 전원 통과를 넣어 회귀를 잡는다 |
| `main.py` 병합 실수로 라우트 누락 | 이식 후 `/openapi.json`의 경로 목록을 이식 전과 대조한다 |
| **실엔진 최신 작업 유실** | `subtree`는 원격 `main`을 읽는다. 2026-07-23 현재 실엔진의 작업 브랜치 `feat/regulations-api`가 `origin/main`보다 **10커밋 앞서 있다**(regulations API, PII 수정, 라우팅 수정, FAISS 지문 검증 등). 이식 전에 반드시 `main`에 머지·푸시해야 한다. 안 하면 오늘 작업이 통째로 빠진다 |

## 순서

1. **실엔진 `feat/regulations-api` → `main` 머지·푸시** (subtree가 원격 `main`을 읽으므로 필수. 현재 10커밋 앞서 있음)
2. product에 작업 브랜치 생성
3. `git subtree add --prefix=backend-upstream`
4. 충돌 5파일 병합
5. 실엔진 고유 ~64파일을 `backend/`로 이동
6. RAG 단일화 (김민기 고유 기능 흡수)
7. `backend-upstream/` 제거
8. 완료 기준 전부 검증
9. 머지

## 후속

- **`customer_request_points`** — 이식 완료 후 병합된 트리에 **한 번만** 구현한다. 설계는
  `2026-07-23-customer-request-points-design.md`, 계획은
  `plans/2026-07-23-customer-request-points.md`에 있다. 이식 전에 구현하면 같은 작업을 두 번 한다.
- 개인 레포는 유지한다. 이식 후 개발은 product에서 하되, 포트폴리오 저장소로 남긴다.
- **ADR-0012 작성** — ADR-0011 §2를 supersede. 근거는 위 "폴백은 유실되지 않는다" 절.
  `kda4-k7-hippo/02 Decisions/`에 쓰고 `_system/DECISION_LOG.md`에 한 줄 추가한다.
- 이번 시연 테스트에서 확인된 나머지: 오프닝 문장 픽스처, 유의사항 픽스처, RAG 오매칭(카드
  부정결제에 외환약관), `CURRENT_STATE.md`의 pgvector 표기 불일치.
  (`/briefing` 라우팅 오분류는 실엔진 `8064ea3`에서 이미 수정됐다.)
