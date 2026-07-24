# 실행 엔진 → 팀 모노레포 이식 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `HeeChang50/kda4-k7-backend`의 실행 엔진을 `kda4-k7-product/backend`로 이식해 팀 모노레포를 단일 진실 공급원으로 만든다. 개인 저장소 커밋 60개는 히스토리에 보존한다.

**Architecture:** `git subtree`로 실행 엔진을 임시 경로 `backend-upstream/`에 편입한 뒤, 충돌 5파일(`config.py`·`contracts.py`·`database.py`·`main.py`·`__init__.py`)을 병합하고 나머지 ~64파일을 `backend/`로 옮긴다. product 고유 14파일(김민기 `app/rag/`, `app/routing/`, 어댑터)은 보존하며, RAG는 실행 엔진의 디스패처(pgvector→FAISS 폴백)로 단일화한다.

**Tech Stack:** FastAPI + Pydantic v2 / faster-whisper / Ollama / faiss-cpu / pgvector / React + Vite

**Spec:** `docs/superpowers/specs/2026-07-23-backend-monorepo-migration-design.md`
**ADR:** `kda4-k7-hippo/02 Decisions/ADR-0012-실행엔진-모노레포-이식.md`

## Global Constraints

- 두 저장소 경로: 실행 엔진 `C:\Users\natur\Documents\금융콜센터AI\backend`, 모노레포 `C:\Users\natur\Documents\금융콜센터AI\kda4-k7-product`.
- **`main`에 직접 작업하지 않는다.** product에 작업 브랜치를 만들고, 완료 기준을 모두 통과하기 전에는 머지하지 않는다. 실패 시 현행 실행 엔진으로 7/29 발표한다.
- **product 고유 14파일은 삭제 금지**: `app/rag/`(`__init__`·`auto_ingest`·`embedder`·`ingest`·`store`·`taxonomy`), `app/routing/`(`__init__`·`emergency_gate`·`taxonomy`), `app/card_routing_pipeline.py`, `app/compat.py`, `app/emotion_adapter.py`, `app/integration_service.py`, `app/model_adapter.py`.
- **`git subtree add --prefix=backend`는 실패한다** (`backend/`가 이미 존재). 반드시 `--prefix=backend-upstream`을 쓴다.
- 계약 버전은 `mvp-1.0`을 유지한다. 이번 이식에서 올리지 않는다.
- 커밋 prefix: `feat:`/`fix:`/`chore:`/`docs:`/`test:`/`merge:`.
- 파이썬은 product 루트의 `.venv`를 쓴다(`./.venv/Scripts/python.exe`). 현재 존재하지 않으므로 Task 1에서 만든다.

---

### Task 1: 준비 — 실행 엔진 main 정리, product 작업 환경, 기준선 기록

`subtree`는 원격 `main`을 읽는다. 현재 실행 엔진의 작업 브랜치가 `origin/main`보다 10커밋 앞서 있어 그대로 편입하면 오늘 작업(regulations API·PII 수정·라우팅 수정·FAISS 지문 검증)이 전부 빠진다.

또한 product에는 `.venv`가 없어 파이썬 테스트를 한 번도 로컬에서 돌린 적이 없다. 완료 기준을 검증하려면 먼저 만들어야 한다.

**Files:**
- 코드 변경 없음 (환경 준비)

**Interfaces:**
- Consumes: 없음
- Produces: `origin/main`에 실행 엔진 최신 커밋, product 작업 브랜치 `feat/backend-monorepo-migration`, product 루트 `.venv`

- [ ] **Step 1: 실행 엔진 브랜치 상태 확인**

```bash
cd "C:/Users/natur/Documents/금융콜센터AI/backend"
git status --short
git log --oneline origin/main..HEAD
```
Expected: working tree 깨끗(또는 커밋할 변경만), `origin/main..HEAD`에 10개 이상 커밋

- [ ] **Step 2: 실행 엔진 테스트 기준선 기록**

```bash
cd "C:/Users/natur/Documents/금융콜센터AI/backend"
./.venv/Scripts/python.exe -m pytest -q
```
Expected: `76 passed, 4 skipped` (이식 후 이 수치가 유지되어야 한다. 다르면 실제 출력을 기준선으로 적어둔다)

- [ ] **Step 3: 실행 엔진을 main에 머지·푸시**

```bash
cd "C:/Users/natur/Documents/금융콜센터AI/backend"
git checkout main
git merge --no-ff feat/regulations-api -m "merge: 규정 API·PII·라우팅 수정 통합 (이식 전 정리)"
git push origin main
git log --oneline -1
```
Expected: push 성공. `git log --oneline origin/main -1`이 방금 머지 커밋을 가리킨다

- [ ] **Step 4: product 작업 브랜치 생성**

```bash
cd "C:/Users/natur/Documents/금융콜센터AI/kda4-k7-product"
git checkout main
git pull
git checkout -b feat/backend-monorepo-migration
```
Expected: 새 브랜치로 전환

- [ ] **Step 5: product 파이썬 환경 구성**

```bash
cd "C:/Users/natur/Documents/금융콜센터AI/kda4-k7-product"
py -3.12 -m venv .venv
./.venv/Scripts/python.exe -m pip install -q -r backend/requirements.txt
```
Expected: 설치 성공

- [ ] **Step 6: product 테스트 기준선 기록**

```bash
cd "C:/Users/natur/Documents/금융콜센터AI/kda4-k7-product"
./.venv/Scripts/python.exe -m pytest backend/tests -q
```
Expected: 통과 수를 기록한다. 이식 후 이 수치 이상이어야 한다. **여기서 실패하는 테스트가 있으면 이식 전부터 깨져 있던 것이므로 목록을 적어두고 이식 성공 판정에서 제외한다.**

- [ ] **Step 7: 프론트 기준선**

```bash
cd "C:/Users/natur/Documents/금융콜센터AI/kda4-k7-product"
npm run check
```
Expected: PASS

- [ ] **Step 8: 커밋 (기준선 메모)**

기준선 수치를 기록으로 남긴다.

```bash
cd "C:/Users/natur/Documents/금융콜센터AI/kda4-k7-product"
git commit --allow-empty -m "chore: 이식 기준선 기록

실행 엔진 pytest: <Step 2 결과>
product pytest:   <Step 6 결과>
npm run check:    PASS"
```

---

### Task 2: git subtree로 실행 엔진 편입

커밋 60개를 product 히스토리에 편입한다. 파일 복사가 아니라 subtree를 쓰는 이유는 `git blame`과 기여 그래프에 작업 이력을 남기기 위해서다.

**Files:**
- Create: `backend-upstream/` (임시 — Task 10에서 제거)

**Interfaces:**
- Consumes: Task 1의 `origin/main` 최신 상태
- Produces: `backend-upstream/app/**`, `backend-upstream/tests/**`, `backend-upstream/database/**`, `backend-upstream/scripts/**`, `backend-upstream/requirements.txt`

- [ ] **Step 1: 원격 추가·fetch**

```bash
cd "C:/Users/natur/Documents/금융콜센터AI/kda4-k7-product"
git remote add mybackend https://github.com/HeeChang50/kda4-k7-backend.git
git fetch mybackend
```
Expected: fetch 성공

- [ ] **Step 2: subtree 편입**

```bash
cd "C:/Users/natur/Documents/금융콜센터AI/kda4-k7-product"
git subtree add --prefix=backend-upstream mybackend main
```
Expected: `Added dir 'backend-upstream'`. `--prefix=backend`로 하면 `prefix 'backend' already exists`로 실패한다

- [ ] **Step 3: 히스토리 편입 검증**

```bash
cd "C:/Users/natur/Documents/금융콜센터AI/kda4-k7-product"
git log --oneline -- backend-upstream | wc -l
```
Expected: 60 이상. 1이면 subtree가 아니라 squash로 들어간 것이므로 되돌리고 다시 한다

- [ ] **Step 4: 파일 존재 확인**

```bash
cd "C:/Users/natur/Documents/금융콜센터AI/kda4-k7-product"
ls backend-upstream/app/services/ | head
ls backend-upstream/app/routers/
```
Expected: `rag.py`·`rag_store.py`·`local_stt.py` 등, `mvp.py`·`pipeline.py`·`regulations.py`

---

### Task 3: requirements 통합

공유 패키지 9개가 **전부 다른 버전에 고정**돼 있다. product가 일관되게 최신이며, 특히 `openai`는 `1.51.0` → `2.45.0` 메이저 점프라 실행 엔진의 OpenAI 폴백 경로가 깨질 수 있다.

| 패키지 | 실행 엔진 | product |
|---|---|---|
| fastapi | 0.115.0 | 0.139.0 |
| uvicorn[standard] | 0.30.6 | 0.51.0 |
| python-multipart | 0.0.9 | 0.0.32 |
| pydantic | 2.9.2 | 2.13.4 |
| pydantic-settings | 2.5.2 | 2.14.2 |
| openai | 1.51.0 | 2.45.0 |
| psycopg[binary] | 3.2.3 | 3.3.4 |
| pytest | 8.3.3 | 9.1.1 |
| httpx | 0.27.2 | 0.28.1 |

**Files:**
- Modify: `backend/requirements.txt`

**Interfaces:**
- Consumes: Task 2의 `backend-upstream/requirements.txt`
- Produces: 통합 `backend/requirements.txt` — 이후 모든 태스크가 이 환경에서 검증된다

- [ ] **Step 1: 통합 requirements 작성**

`backend/requirements.txt`를 다음으로 바꾼다. 공유 패키지는 **product의 최신 핀**을 채택하고, 실행 엔진 고유 12개를 추가한다.

```
fastapi==0.139.0
uvicorn[standard]==0.51.0
python-multipart==0.0.32
pydantic==2.13.4
pydantic-settings==2.14.2
openai==2.45.0
psycopg[binary]==3.3.4
pytest==9.1.1
httpx==0.28.1

# ── 실행 엔진(온프레미스) ────────────────────────────────
faiss-cpu==1.9.0
numpy==2.1.2
python-dotenv==1.0.1
faster-whisper==1.0.3

# emotion_temperature (박정운 v4 모델) 추론용 — app/services/k7modeling
scipy>=1.12
opensmile>=2.5
pandas>=2.1
lightgbm==4.6.0
scikit-learn>=1.4
joblib>=1.3
# pyarrow는 opensmile→audformat→pandas가 끌고 오는데, 최신(25.x)은 이 Windows의 VC++ 런타임과
# side-by-side 충돌(DLL load failed 14001)이 나서 18.1.0으로 고정한다.
pyarrow==18.1.0

# 규정 PDF 적재(POST /api/v1/regulations/upload)에만 필요. 없어도 API는 뜨고,
# 업로드 요청 시에만 안내 문구와 함께 실패한다(지연 import).
pdfplumber>=0.11
```

- [ ] **Step 2: 설치**

```bash
cd "C:/Users/natur/Documents/금융콜센터AI/kda4-k7-product"
./.venv/Scripts/python.exe -m pip install -q -r backend/requirements.txt
```
Expected: 설치 성공

- [ ] **Step 3: product 기존 테스트가 새 핀에서 도는지 확인**

```bash
cd "C:/Users/natur/Documents/금융콜센터AI/kda4-k7-product"
./.venv/Scripts/python.exe -m pytest backend/tests -q
```
Expected: Task 1 Step 6의 기준선과 동일

- [ ] **Step 4: 실행 엔진 코드가 새 핀에서 import 되는지 확인 (openai 2.x 위험 지점)**

```bash
cd "C:/Users/natur/Documents/금융콜센터AI/kda4-k7-product/backend-upstream"
../.venv/Scripts/python.exe -c "
import sys
sys.path.insert(0, '.')
import app.services.stt, app.services.gpt_analysis
print('openai 경로 import OK')
"
```
Expected: `openai 경로 import OK`.
**실패하면** openai 2.x API 변경 때문이다. `app/services/stt.py`·`gpt_analysis.py`의 클라이언트 호출을 2.x 시그니처로 고친다. 이 경로는 폴백 전용이라 온프레미스 데모에는 영향이 없지만, ADR-0012가 "폴백 유지"를 근거로 삼았으므로 반드시 동작해야 한다.

- [ ] **Step 5: 커밋**

```bash
cd "C:/Users/natur/Documents/금융콜센터AI/kda4-k7-product"
git add backend/requirements.txt
git commit -m "chore(deps): 실행 엔진 의존성 통합

공유 패키지 9개가 서로 다른 버전에 고정돼 있어 product의 최신 핀으로
통일하고 실행 엔진 고유 12개(faiss-cpu·faster-whisper·감정모델 스택·
pdfplumber)를 추가한다. openai는 1.51->2.45 메이저 점프라 폴백 경로의
클라이언트 호출을 확인했다."
```

---

### Task 4: config.py 병합

실행 엔진은 모듈 레벨 `settings = Settings()`를, product는 `get_settings()` + `lru_cache`를 쓴다. 실행 엔진 8파일이 `from app.config import settings`를, product 3파일이 `get_settings()`를 쓰므로 **둘 다 지원**하는 것이 재작성보다 싸고 안전하다.

**Files:**
- Modify: `backend/app/config.py`

**Interfaces:**
- Consumes: `backend-upstream/app/config.py`
- Produces: `Settings` 클래스(실행 엔진 필드 전부 포함), `get_settings() -> Settings`, 모듈 레벨 `settings`, `Settings.cors_origins`, `Settings.cors_allow_origins`

- [ ] **Step 1: 양쪽 확인**

```bash
cd "C:/Users/natur/Documents/금융콜센터AI/kda4-k7-product"
cat backend-upstream/app/config.py
cat backend/app/config.py
```

- [ ] **Step 2: 병합**

`backend/app/config.py`를 다음 원칙으로 작성한다.

1. `backend-upstream/app/config.py`의 `Settings` 필드를 **전부** 가져온다(whisper·ollama·감정모델 경로/해시·wavlm·vad·stub_models·use_local_models 등).
2. product의 `database_url` 필드와 docstring을 유지한다.
3. CORS 프로퍼티는 **두 이름 모두** 노출한다. 실행 엔진 `main.py`는 `cors_allow_origins`, product `main.py`는 `cors_origins`를 쓴다.
4. 파일 맨 아래에 접근자 두 가지를 모두 둔다.

```python
from functools import lru_cache


@lru_cache
def get_settings() -> "Settings":
    return Settings()


# 실행 엔진 8개 파일이 `from app.config import settings`로 쓴다.
# product 3개 파일은 get_settings()를 쓴다. 두 스타일을 모두 지원한다.
settings = get_settings()
```

`Settings` 안에 CORS 별칭을 둔다:

```python
    @property
    def cors_allow_origins(self) -> list[str]:
        """실행 엔진 main.py가 쓰는 이름. cors_origins와 같은 값."""
        return self.cors_origins
```

- [ ] **Step 3: 두 접근 방식이 모두 되는지 확인**

```bash
cd "C:/Users/natur/Documents/금융콜센터AI/kda4-k7-product/backend"
../.venv/Scripts/python.exe -c "
from app.config import settings, get_settings
assert settings is get_settings(), 'lru_cache 동일 인스턴스여야 한다'
assert settings.cors_origins == settings.cors_allow_origins
print('use_local_models =', settings.use_local_models)
print('ollama_model     =', settings.ollama_model)
print('OK')
"
```
Expected: `OK`와 함께 온프레미스 필드가 출력된다

- [ ] **Step 4: product 테스트 유지 확인**

```bash
cd "C:/Users/natur/Documents/금융콜센터AI/kda4-k7-product"
./.venv/Scripts/python.exe -m pytest backend/tests -q
```
Expected: Task 1 기준선과 동일

- [ ] **Step 5: 커밋**

```bash
git add backend/app/config.py
git commit -m "feat(config): 실행 엔진 설정 병합, 두 접근 스타일 지원

실행 엔진의 온프레미스 필드(whisper·ollama·감정모델·wavlm·vad·stub)를
가져오고, product의 get_settings() lru_cache를 유지한다. 실행 엔진 8파일이
모듈 레벨 settings를, product 3파일이 get_settings()를 쓰므로 둘 다
노출한다. CORS도 cors_origins/cors_allow_origins 두 이름을 제공한다."
```

---

### Task 5: contracts.py 병합

product 쪽이 더 엄격하다(`extra="forbid"`, `_reject_boolean_number`, 감정 score/level 교차검증). 실행 엔진에는 product에 없는 `EmotionStatus.DEMO`가 있다.

**Files:**
- Modify: `backend/app/contracts.py`

**Interfaces:**
- Consumes: `backend-upstream/app/contracts.py`
- Produces: `ConsultationCard`, `MvpCallResponse`(`schema_version = "mvp-1.0"`), `MvpHealthResponse`, `ModelConsultationResult`, `EmotionStatus`(`unavailable`·`demo`·`completed`)

- [ ] **Step 1: 차이 확인**

```bash
cd "C:/Users/natur/Documents/금융콜센터AI/kda4-k7-product"
diff backend-upstream/app/contracts.py backend/app/contracts.py
```

- [ ] **Step 2: 병합**

`backend/app/contracts.py`를 **product 파일 기반으로 유지**하고 다음만 더한다.

`EmotionStatus`에 `DEMO`를 추가한다:

```python
class EmotionStatus(str, Enum):
    UNAVAILABLE = "unavailable"
    DEMO = "demo"
    COMPLETED = "completed"
```

> `DEMO`는 실행 엔진이 감정 모델 미연동 상태를 표시할 때 쓴다. 프론트 파서
> (`src/services/consultationContract.ts`)는 `unavailable`·`completed`만 허용하므로
> **`/api/v1/calls` 응답에는 `demo`가 나가면 안 된다.** 내부 표현으로만 쓴다.

product의 `extra="forbid"`·검증기·`HealthResponse`는 **그대로 둔다**. 실행 엔진 쪽 이름이 `MvpHealthResponse`라면 product의 `HealthResponse`에 별칭을 추가한다:

```python
MvpHealthResponse = HealthResponse  # 실행 엔진 코드가 쓰는 이름
```

- [ ] **Step 3: 예제 JSON이 여전히 통과하는지 확인**

```bash
cd "C:/Users/natur/Documents/금융콜센터AI/kda4-k7-product"
./.venv/Scripts/python.exe -m pytest backend/tests/test_contracts.py -q
```
Expected: PASS

- [ ] **Step 4: 커밋**

```bash
git add backend/app/contracts.py
git commit -m "feat(contract): 실행 엔진 계약 병합 — EmotionStatus.DEMO 추가

product의 엄격 검증(extra=forbid, boolean 거부, score/level 교차검증)을
기반으로 두고 실행 엔진의 DEMO 상태만 더한다. DEMO는 내부 표현이며
프론트 파서가 unavailable/completed만 허용하므로 API 응답으로 내보내지
않는다. mvp-1.0 유지."
```

---

### Task 6: database.py 병합

공개 API가 **완전히 동일**하다 — 같은 `DatabaseUnavailable`, 같은 6개 함수(`_database_url`·`initialize_database`·`ping_database`·`save_call`·`get_call`), 같은 시그니처. 구현 세부만 다르다.

**Files:**
- Modify: `backend/app/database.py`

**Interfaces:**
- Consumes: `backend-upstream/app/database.py`
- Produces: `DatabaseUnavailable`, `initialize_database(settings)`, `ping_database(settings) -> bool`, `save_call(settings, response, raw_model_result)`, `get_call(settings, call_id) -> MvpCallResponse | None`

- [ ] **Step 1: 차이 확인**

```bash
cd "C:/Users/natur/Documents/금융콜센터AI/kda4-k7-product"
diff backend-upstream/app/database.py backend/app/database.py
```

- [ ] **Step 2: 병합**

실행 엔진 구현을 채택하되, product에만 있는 로직(예: `save_call`의 추가 컬럼·예외 처리)은 남긴다. 판단 기준은 **product 테스트가 통과하는가**다. `backend/tests/test_database_failures.py`·`test_database_integration.py`가 계약을 고정한다.

- [ ] **Step 3: 검증**

```bash
cd "C:/Users/natur/Documents/금융콜센터AI/kda4-k7-product"
./.venv/Scripts/python.exe -m pytest backend/tests/test_database_failures.py backend/tests/test_database_integration.py -q
```
Expected: PASS (integration 마커는 외부 PostgreSQL이 없으면 skip)

- [ ] **Step 4: 커밋**

```bash
git add backend/app/database.py
git commit -m "feat(db): 실행 엔진 database 구현 병합

공개 API가 양쪽 동일(같은 6함수·시그니처)해 실행 엔진 구현을 채택하고
product 고유 로직만 남긴다. product의 database 테스트가 계약을 고정한다."
```

---

### Task 7: 실행 엔진 고유 파일 이동

충돌 5파일을 뺀 나머지(~64개)를 `backend-upstream/`에서 `backend/`로 옮긴다. product 고유 14파일과 경로가 겹치지 않으므로 단순 이동이다.

**Files:**
- Create: `backend/app/services/**`, `backend/app/routers/**`, `backend/app/ws/**`, `backend/tests/test_*.py`(실행 엔진분), `backend/database/rag/`, `backend/scripts/`, `backend/pii-service/`

**Interfaces:**
- Consumes: Task 4~6의 병합된 `config.py`·`contracts.py`·`database.py`
- Produces: `app.services.rag`, `app.services.rag_store`, `app.services.local_stt`, `app.services.local_llm`, `app.routers.mvp`, `app.routers.pipeline`, `app.routers.regulations`, `app.ws.call`

- [ ] **Step 1: 이동 (충돌 5파일 제외)**

```bash
cd "C:/Users/natur/Documents/금융콜센터AI/kda4-k7-product"
# app 하위 디렉터리 통째로 (product에 없는 것들)
git mv backend-upstream/app/services backend/app/services
git mv backend-upstream/app/ws       backend/app/ws
# routers는 product에 없으므로 통째로
git mv backend-upstream/app/routers  backend/app/routers
# 나머지 app 최상위 .py (충돌 5개 제외)
for f in schemas.py; do git mv "backend-upstream/app/$f" "backend/app/$f"; done
```

> `backend-upstream/app/` 최상위에 위 목록 외 파일이 더 있으면 함께 옮긴다.
> `ls backend-upstream/app/*.py`로 확인하고 `__init__.py`·`config.py`·`contracts.py`·
> `database.py`·`main.py`만 남긴다.

- [ ] **Step 2: 테스트·데이터·스크립트 이동**

```bash
cd "C:/Users/natur/Documents/금융콜센터AI/kda4-k7-product"
for f in backend-upstream/tests/test_*.py; do git mv "$f" "backend/tests/$(basename $f)"; done
git mv backend-upstream/database/rag backend/database-rag-upstream   # 아래 Step 3에서 정리
git mv backend-upstream/scripts     backend/scripts
git mv backend-upstream/pii-service backend/pii-service
```

- [ ] **Step 3: RAG 스키마 정리**

`database/rag/schema.sql`은 product 루트에도 있고 실행 엔진에도 있는데 **차이가 전부 주석**이다. product 루트 것을 정본으로 삼고 실행 엔진 사본을 버린다.

```bash
cd "C:/Users/natur/Documents/금융콜센터AI/kda4-k7-product"
diff database/rag/schema.sql backend/database-rag-upstream/schema.sql
git rm -r backend/database-rag-upstream
```
Expected: diff가 주석만. 구조 차이가 나오면 멈추고 사람에게 확인한다

- [ ] **Step 4: 규정 청크 런타임 사본 이동**

```bash
cd "C:/Users/natur/Documents/금융콜센터AI/kda4-k7-product"
ls backend/app/services/rag_data/
```
Expected: `regulation_chunks.jsonl`·`faiss_local.index`가 함께 왔는지 확인. `.gitignore`로 빠졌으면 실행 엔진에서 직접 복사한다

- [ ] **Step 5: import 경로 확인 (아직 main.py는 미병합이라 앱은 안 뜬다)**

```bash
cd "C:/Users/natur/Documents/금융콜센터AI/kda4-k7-product/backend"
../.venv/Scripts/python.exe -c "
import app.services.rag, app.services.rag_store, app.services.local_llm
import app.routers.mvp, app.routers.pipeline, app.routers.regulations
print('실행 엔진 모듈 import OK')
"
```
Expected: `실행 엔진 모듈 import OK`

- [ ] **Step 6: 커밋**

```bash
git add -A backend backend-upstream
git commit -m "feat(backend): 실행 엔진 파일 이식 (services·routers·ws·tests)

충돌 5파일을 제외한 실행 엔진 전체를 backend/로 옮긴다. product 고유
14파일(김민기 rag·routing·어댑터)과 경로가 겹치지 않아 단순 이동이다.
database/rag/schema.sql은 차이가 주석뿐이라 product 루트 것을 정본으로
삼고 사본을 버린다."
```

---

### Task 8: main.py 병합

유일한 실질 충돌이다. 실행 엔진(49줄)은 라우터 4개를 include하고, product(231줄)는 regulations 4경로를 인라인으로 갖고 있다.

**Files:**
- Modify: `backend/app/main.py`

**Interfaces:**
- Consumes: Task 7의 `app.routers.*`, product의 `app.compat`·`app.rag`
- Produces: `app` (FastAPI 인스턴스)

- [ ] **Step 1: 이식 전 라우트 목록 저장 (대조 기준)**

```bash
cd "C:/Users/natur/Documents/금융콜센터AI/backend"
./.venv/Scripts/python.exe -c "
import json
from app.main import app
paths = sorted(app.openapi()['paths'].keys())
open('/tmp/routes-engine.txt','w').write('\n'.join(paths))
print(len(paths), '경로 저장')
"
```

- [ ] **Step 2: 병합**

`backend/app/main.py`를 다음 구조로 작성한다.

```python
import os

# faiss(RAG)와 faster-whisper/ctranslate2가 서로 다른 OpenMP 런타임(libiomp5md.dll /
# libomp140.dll)을 링크해서 같은 프로세스에서 둘 다 쓰면 Windows에서 충돌·크래시가 난다.
# 다른 라이브러리 import 전에 설정해야 효과가 있다.
os.environ.setdefault("KMP_DUPLICATE_LIB_OK", "TRUE")

import threading
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import settings
from app.compat import build_compat_router
from app.database import initialize_database, ping_database
from app.rag import RegulationSearchUnavailable, initialize_rag, embedder
from app.routers.mvp import router as mvp_router
from app.routers.pipeline import router as pipeline_router
from app.routers.regulations import router as regulations_router
from app.ws.call import router as ws_router


@asynccontextmanager
async def lifespan(_: FastAPI):
    if settings.database_url:
        initialize_database(settings)
        # 규정 RAG는 pgvector가 필요해 선택적이다. 부팅을 막지 않는다.
        try:
            initialize_rag(settings)
        except RegulationSearchUnavailable:
            pass
    # 임베더 warm-up — bge-m3 lazy load가 첫 검색을 수 초 지연시키지 않도록
    # 백그라운드에서 미리 로드한다(부팅은 막지 않음, 실패해도 무해).
    threading.Thread(target=embedder.is_available, daemon=True).start()
    yield


app = FastAPI(
    title="KARI-NA(Kiwoom Academy Response Innovation · No ARS) — 상담카드 통합 API",
    version="mvp-1.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    # Vercel 프리뷰 배포(k7product-git-<branch>-….vercel.app)도 허용
    allow_origin_regex=r"https://.*\.vercel\.app",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(build_compat_router(settings))
app.include_router(pipeline_router)
app.include_router(mvp_router)
app.include_router(regulations_router)  # 규정 지식베이스 /api/v1/regulations/*
app.include_router(ws_router)           # 실시간 통화 WebSocket /ws/call/{call_id}


@app.get("/health")
async def health() -> dict:
    return {
        "status": "ok",
        "database": "connected" if ping_database(settings) else "not_connected",
        "contract_version": "mvp-1.0",
    }
```

> product의 인라인 regulations 4경로는 **삭제한다.** 실행 엔진의
> `app/routers/regulations.py`가 같은 4경로를 제공하며, Task 9에서 김민기 저장소
> 기능을 그쪽으로 흡수한다.
>
> product의 인라인 `POST /api/v1/calls`와 `GET .../consultation-card`도 삭제한다.
> `app/routers/mvp.py`가 같은 경로를 제공한다.
>
> `allow_methods`는 실행 엔진의 `["*"]`를 채택한다. WebSocket과 파일 업로드가 있어
> product의 `["GET","POST","OPTIONS"]`로는 부족하다.

- [ ] **Step 3: 앱 기동 확인**

```bash
cd "C:/Users/natur/Documents/금융콜센터AI/kda4-k7-product/backend"
../.venv/Scripts/python.exe -c "
from app.main import app
paths = sorted(app.openapi()['paths'].keys())
print(len(paths), '경로')
for p in paths: print(' ', p)
"
```
Expected: 에러 없이 경로 목록 출력

- [ ] **Step 4: 라우트 누락 대조**

Step 1에서 저장한 실행 엔진 경로가 **전부 포함**되어야 한다.

```bash
cd "C:/Users/natur/Documents/금융콜센터AI/kda4-k7-product/backend"
../.venv/Scripts/python.exe -c "
from app.main import app
now = set(app.openapi()['paths'].keys())
before = set(open('/tmp/routes-engine.txt').read().split())
missing = before - now
print('누락:', sorted(missing) if missing else '없음')
"
```
Expected: `누락: 없음`

- [ ] **Step 5: 커밋**

```bash
git add backend/app/main.py
git commit -m "feat(api): main.py 병합 — 실행 엔진 라우터 구조 채택

product의 인라인 regulations 4경로와 calls 2경로를 삭제하고 실행 엔진의
라우터(mvp·pipeline·regulations·ws)로 대체한다. product 고유 요소는
유지: compat 라우터, Vercel 프리뷰 CORS regex, initialize_rag lifespan,
임베더 warm-up 스레드.

KMP_DUPLICATE_LIB_OK를 최상단에 둔다 — faiss와 faster-whisper가 다른
OpenMP 런타임을 링크해 Windows에서 크래시한다."
```

---

### Task 9: RAG 단일화

`/api/v1/regulations/*`를 실행 엔진 라우터가 제공하되, 김민기 `app/rag/store.py`의 고유 기능을 실행 엔진 `services/rag_store.py`로 흡수해 pgvector 구현을 하나로 만든다.

| | 고유 기능 |
|---|---|
| 김민기 `app/rag/store.py` | `upsert_documents_and_chunks`, `get_regulation_document`, `get_regulation_stats` |
| 실행 엔진 `services/rag_store.py` | `pgvector_ready`, `_probe`, `reset_readiness`, `seed_demo_regulations` |

**Files:**
- Modify: `backend/app/services/rag_store.py`
- Modify: `backend/app/routers/regulations.py`
- Keep: `backend/app/rag/ingest.py`·`auto_ingest.py`·`embedder.py`·`taxonomy.py`

**Interfaces:**
- Consumes: Task 8의 `regulations_router`
- Produces: `services.rag_store.upsert_documents_and_chunks`, `.get_regulation_document`, `.get_regulation_stats` (기존 `pgvector_ready`·`search_regulations`에 더해)

- [ ] **Step 1: 실패하는 테스트 작성**

`backend/tests/test_rag_store_unified.py` 생성:

```python
"""이식 후 pgvector 저장소가 하나인지 — 김민기 기능이 실행 엔진 쪽에 있어야 한다."""

from app.services import rag_store


def test_적재_기능이_실행엔진_저장소에_있다():
    assert hasattr(rag_store, "upsert_documents_and_chunks")


def test_문서조회_기능이_실행엔진_저장소에_있다():
    assert hasattr(rag_store, "get_regulation_document")


def test_통계_기능이_실행엔진_저장소에_있다():
    assert hasattr(rag_store, "get_regulation_stats")


def test_가용성_게이팅이_유지된다():
    assert hasattr(rag_store, "pgvector_ready")
    assert hasattr(rag_store, "search_regulations")
```

- [ ] **Step 2: 실패 확인**

```bash
cd "C:/Users/natur/Documents/금융콜센터AI/kda4-k7-product"
./.venv/Scripts/python.exe -m pytest backend/tests/test_rag_store_unified.py -q
```
Expected: FAIL — `AssertionError` 3건 (가용성 게이팅 1건만 통과)

- [ ] **Step 3: 기능 이관**

`backend/app/rag/store.py`의 `upsert_documents_and_chunks`·`get_regulation_document`·`get_regulation_stats` 세 함수를 `backend/app/services/rag_store.py`로 옮긴다. 두 파일이 같은 헬퍼(`_database_url`·`_vector_literal`)와 같은 예외(`RegulationSearchUnavailable`)를 이미 쓰므로 본문은 대체로 그대로 붙는다.

옮긴 뒤 `app/rag/store.py`는 하위호환 재노출만 남긴다:

```python
"""김민기 pgvector 저장소 — 구현은 app/services/rag_store.py로 통합됐다(ADR-0012).

app/rag/ingest.py 등 기존 호출부가 깨지지 않도록 이름만 재노출한다.
"""

from app.services.rag_store import (  # noqa: F401
    RegulationSearchUnavailable,
    get_regulation_document,
    get_regulation_stats,
    initialize_rag,
    search_regulations,
    upsert_documents_and_chunks,
)
```

- [ ] **Step 4: 통과 확인**

```bash
cd "C:/Users/natur/Documents/금융콜센터AI/kda4-k7-product"
./.venv/Scripts/python.exe -m pytest backend/tests/test_rag_store_unified.py -q
```
Expected: PASS — 4 passed

- [ ] **Step 5: 기존 RAG 테스트 유지 확인**

```bash
cd "C:/Users/natur/Documents/금융콜센터AI/kda4-k7-product"
./.venv/Scripts/python.exe -m pytest backend/tests/test_rag_taxonomy.py backend/tests/test_rag_search_endpoint.py backend/tests/test_rag_store_integration.py backend/tests/test_regulations_api.py backend/tests/test_rag.py -q
```
Expected: PASS (integration 마커는 skip 가능)

- [ ] **Step 6: 커밋**

```bash
git add backend/app/services/rag_store.py backend/app/rag/store.py backend/tests/test_rag_store_unified.py
git commit -m "feat(rag): pgvector 저장소 단일화 (ADR-0012)

김민기 app/rag/store.py의 적재·조회·통계를 실행 엔진
services/rag_store.py로 흡수한다. 두 구현이 같은 헬퍼와 예외를 쓰고
있어(한쪽이 다른 쪽 파생) 본문이 그대로 옮겨진다.

app/rag/store.py는 ingest.py 등 기존 호출부를 위해 재노출만 남긴다.
검색은 실행 엔진의 디스패처(pgvector 준비되면 pgvector, 아니면 FAISS
폴백)를 그대로 쓴다 — ADR-0010 준수와 현행 데모 무손상을 동시에 만족."
```

---

### Task 10: 임시 경로 제거 + 완료 기준 전수 검증

**Files:**
- Delete: `backend-upstream/`

**Interfaces:**
- Consumes: Task 1~9 전체
- Produces: 없음 (최종 검증)

- [ ] **Step 1: 임시 경로에 남은 것 확인**

```bash
cd "C:/Users/natur/Documents/금융콜센터AI/kda4-k7-product"
find backend-upstream -type f | grep -v '^backend-upstream/\.git' | head -30
```
Expected: 충돌 5파일과 문서·설정만 남아 있어야 한다. 코드가 남아 있으면 Task 7로 돌아간다

- [ ] **Step 2: 문서 이동 후 임시 경로 제거**

```bash
cd "C:/Users/natur/Documents/금융콜센터AI/kda4-k7-product"
git mv backend-upstream/docs/superpowers backend/docs-superpowers 2>/dev/null || true
git rm -r --quiet backend-upstream
git commit -m "chore: 이식 임시 경로 제거

backend-upstream/은 subtree 편입 경유지였다. 디렉터리를 지워도 편입된
커밋 60개는 히스토리에 남는다."
```

- [ ] **Step 3: 히스토리 보존 확인 (완료 기준)**

```bash
cd "C:/Users/natur/Documents/금융콜센터AI/kda4-k7-product"
git log --oneline -- backend | wc -l
git log --oneline -- backend | tail -5
```
Expected: 60 이상. 개인 저장소의 오래된 커밋 메시지가 보인다

- [ ] **Step 4: 백엔드 테스트 전수 (완료 기준)**

```bash
cd "C:/Users/natur/Documents/금융콜센터AI/kda4-k7-product"
./.venv/Scripts/python.exe -m pytest backend/tests -q
```
Expected: Task 1 기준선(실행 엔진 76 + product 기준선) 합계 이상, 실패 0

- [ ] **Step 5: 프론트 검증 (완료 기준)**

```bash
cd "C:/Users/natur/Documents/금융콜센터AI/kda4-k7-product"
npm run check
```
Expected: PASS

- [ ] **Step 6: 앱 기동 + /health (완료 기준)**

```bash
cd "C:/Users/natur/Documents/금융콜센터AI/kda4-k7-product/backend"
../.venv/Scripts/python.exe -m uvicorn app.main:app --host 0.0.0.0 --port 8000
```
별도 셸에서:
```bash
curl -s http://127.0.0.1:8000/health
```
Expected: `{"status":"ok","database":"connected","contract_version":"mvp-1.0"}`

- [ ] **Step 7: E2E — 시연 WAV (완료 기준)**

```bash
ffmpeg -y -i "C:/Users/natur/Documents/금융콜센터AI/stt/test_sample2.m4a" \
  -ar 16000 -ac 1 -c:a pcm_s16le /tmp/demo.wav
curl -s -X POST http://127.0.0.1:8000/api/v1/calls \
  -F "audio=@/tmp/demo.wav;type=audio/wav" -o /tmp/calls.json -w "HTTP %{http_code}\n"
cd "C:/Users/natur/Documents/금융콜센터AI/kda4-k7-product"
./.venv/Scripts/python.exe -c "
import io, json, sys
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
d = json.load(open('/tmp/calls.json', encoding='utf-8'))
c = d['consultation_card']
print('STT       :', d['transcript']['stt_model'])
print('부서      :', c['department'])
print('위험도    :', c['incident_risk'])
print('감정      :', c['emotion']['score'], c['emotion']['level'])
print('REAL_MODEL:', 'REAL_MODEL' in (c['emotion']['reason'] or ''))
print('PII 마스킹:', '***' in d['transcript']['text'])
"
```
Expected: `HTTP 201`, `faster-whisper:large-v3-turbo`, 부서가 통화 내용에 맞음, `REAL_MODEL: True`, `PII 마스킹: True`

- [ ] **Step 8: 프론트 E2E**

프론트를 띄우고(`npm run dev -- --host 0.0.0.0`) `http://192.168.11.135:5173/`에서 시연 WAV를 업로드해 준비 카드가 이식 전과 동일하게 뜨는지 확인한다.

Expected: 요약·근거발화(PII 마스킹)·부서·감정온도·사고징후가 모두 표시됨

- [ ] **Step 9: 최종 커밋**

```bash
cd "C:/Users/natur/Documents/금융콜센터AI/kda4-k7-product"
git commit --allow-empty -m "chore: 이식 완료 기준 검증

pytest: <결과>
npm run check: PASS
/health: contract_version mvp-1.0
E2E: STT faster-whisper, 감정 REAL_MODEL, PII 마스킹 확인
히스토리: backend/ 커밋 <N>개"
```

- [ ] **Step 10: 머지는 사람이 판단**

완료 기준을 모두 통과했으면 이희창에게 보고하고 `main` 머지 여부를 확인받는다. **AI가 임의로 머지하지 않는다**(팀 거버넌스: `main`은 검토된 통합 PR만).

---

## 검토 메모

**스펙 대비 커버리지**
- 히스토리 보존(subtree, 임시 경로 경유) → Task 2, Task 10 Step 2·3
- 충돌 5파일 방침 → Task 4(config), 5(contracts), 6(database), 8(main), 7(`__init__`은 product 것 유지)
- RAG 단일화(라우터·디스패처·김민기 기능 흡수·적재 유지) → Task 9
- 폴백 3경로 유지 → Task 3 Step 4(openai 2.x import 검증), Task 4(stub/local 설정 필드)
- 실행 엔진 최신 작업 유실 방지 → Task 1 Step 3
- product 고유 14파일 보존 → Task 7 Step 1 주석, Task 10 Step 4(product 테스트 전수)
- 완료 기준 5항목 → Task 10 Step 3~8

**스펙에 없던 발견을 계획에 추가함**
- requirements 버전 핀이 공유 패키지 9개 전부 충돌(openai 메이저 점프 포함) → Task 3
- product에 `.venv`가 없어 파이썬 테스트를 로컬에서 돌린 적이 없음 → Task 1 Step 5·6
- `cors_origins` vs `cors_allow_origins` 이름 불일치 → Task 4 Step 2

**범위 밖**: `customer_request_points`(이식 후 `plans/2026-07-23-customer-request-points.md`로 구현), 오프닝 문장 픽스처, 유의사항 픽스처, RAG 오매칭, `CURRENT_STATE.md` 갱신.
