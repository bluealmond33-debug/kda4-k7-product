# 전화 요약 블록 발화 기반화 (customer_request_points) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 상담 준비 카드의 "전화 요약 · 고객 발화 STT 요약" 3줄을 프론트 하드코딩 픽스처에서 LLM이 실제 발화에서 추출한 값으로 바꾼다.

**Architecture:** 백엔드가 기존 단일 Ollama 호출(`format:"json"`)의 JSON 스키마에 `customer_request_points` 한 필드를 얹어 추출하고, 정제 후 mvp 계약을 통해 프론트로 내려보낸다. 프론트는 `exactKeys` 파서에 필드를 추가하고 빈 배열이면 블록을 렌더하지 않는다. 계약 변경이 양방향 파괴적이라 `schema_version`을 `mvp-1.1`로 올려 불일치를 명시적 에러로 만든다.

**Tech Stack:** FastAPI + Pydantic v2 / Ollama exaone3.5:7.8b / React + TypeScript + Vite / Ajv (JSON Schema 검증)

**Spec:** `docs/superpowers/specs/2026-07-23-customer-request-points-design.md`

## Global Constraints

- 레포 2개를 함께 바꾼다. 백엔드 `C:\Users\natur\Documents\금융콜센터AI\backend`, 프론트 `C:\Users\natur\Documents\금융콜센터AI\kda4-k7-product`.
- 백엔드 파이썬은 반드시 `./.venv/Scripts/python.exe`로 실행한다. 시스템 파이썬을 쓰지 않는다.
- 필드명은 정확히 `customer_request_points`다. 의미는 **고객이 발화에서 요구·진술한 것**이며 상담사 액션이 아니다.
- 정제 상한: 항목 **최대 4개**, 항목당 **100자**.
- `schema_version`·`contract_version` 값은 정확히 `mvp-1.1`이다.
- 빈 배열일 때 프론트는 블록을 **렌더하지 않는다**. 픽스처로 폴백하지 않는다.
- mock 경로도 백엔드와 같은 필드를 쓴다. `useCallFlow`의 `consultationResponse` 초기값이 `getDemoConsultationCard()`(예제 JSON 파싱)이므로 Task 4에서 예제 JSON에 필드를 넣으면 mock에도 값이 생긴다. 따라서 `SUMMARY_POINTS` 폴백은 필요 없다.
- `SUMMARY_POINTS` 상수 자체(`src/data/demoContent.ts:220`)는 **파일에 남긴다**. import만 끊는다. `tsconfig.json`이 `noUnusedLocals: false`라 미사용 export는 에러가 아니다.
- 프론트에는 단위 테스트 러너가 없다. 검증은 `npm run check`와 `scripts/validate-frontend-contract.mjs`로 한다.
- 커밋 prefix 규칙: `feat:`/`fix:`/`docs:`/`chore:`/`test:`.

---

### Task 1: 백엔드 — 요구사항 불릿 정제 함수

LLM이 돌려준 리스트를 화면에 쓸 수 있는 형태로 정규화한다. 사전 측정에서 `'- 해외 무단 결제 거래 확인'`처럼 불릿 접두사가 섞여 나오는 것을 확인했고, 화면이 자체 불릿을 그리므로 이중 표기가 된다.

**Files:**
- Create: `tests/test_local_llm.py`
- Modify: `app/services/local_llm.py`

**Interfaces:**
- Consumes: 없음 (첫 태스크)
- Produces: `clean_request_points(value: object) -> list[str]` — `app/services/local_llm.py`의 모듈 레벨 순수 함수. Task 2가 파싱 직후 호출한다.

- [ ] **Step 1: 실패하는 테스트 작성**

`tests/test_local_llm.py` 생성:

```python
"""local_llm의 요구사항 불릿 정제 — LLM 출력이 화면에 그대로 쓰일 수 있는지."""

from app.services.local_llm import clean_request_points


def test_불릿_접두사를_제거한다():
    raw = ["- 해외 무단 결제 거래 확인", "• 즉시 거래 차단 요청", "* 본인 확인 완료"]
    assert clean_request_points(raw) == [
        "해외 무단 결제 거래 확인",
        "즉시 거래 차단 요청",
        "본인 확인 완료",
    ]


def test_앞뒤_공백을_제거한다():
    assert clean_request_points(["  즉시 지급정지 요청  "]) == ["즉시 지급정지 요청"]


def test_빈_항목을_버린다():
    assert clean_request_points(["실제 항목", "", "   ", "-", "- "]) == ["실제 항목"]


def test_중복을_입력_순서대로_한_번만_남긴다():
    raw = ["지급정지 요청", "본인 확인", "- 지급정지 요청"]
    assert clean_request_points(raw) == ["지급정지 요청", "본인 확인"]


def test_최대_4개까지만_남긴다():
    raw = ["항목1", "항목2", "항목3", "항목4", "항목5", "항목6"]
    assert clean_request_points(raw) == ["항목1", "항목2", "항목3", "항목4"]


def test_100자를_넘는_항목은_버린다():
    raw = ["짧은 항목", "가" * 101]
    assert clean_request_points(raw) == ["짧은 항목"]


def test_정확히_100자인_항목은_남긴다():
    raw = ["가" * 100]
    assert clean_request_points(raw) == ["가" * 100]


def test_리스트가_아니면_빈_리스트를_돌려준다():
    assert clean_request_points(None) == []
    assert clean_request_points("지급정지 요청") == []
    assert clean_request_points({"a": 1}) == []


def test_문자열이_아닌_항목은_버린다():
    assert clean_request_points(["정상 항목", 123, None, {"a": 1}]) == ["정상 항목"]


def test_빈_리스트는_빈_리스트다():
    assert clean_request_points([]) == []
```

- [ ] **Step 2: 테스트가 실패하는지 확인**

Run: `cd backend && ./.venv/Scripts/python.exe -m pytest tests/test_local_llm.py -v`
Expected: FAIL — `ImportError: cannot import name 'clean_request_points' from 'app.services.local_llm'`

- [ ] **Step 3: 최소 구현**

`app/services/local_llm.py`의 `class LocalLlmError` **바로 위**에 추가:

```python
_MAX_REQUEST_POINTS = 4
_MAX_POINT_LENGTH = 100
_BULLET_PREFIX = "-•*·–—"


def clean_request_points(value: object) -> list[str]:
    """LLM이 돌려준 요구사항 불릿을 화면에 쓸 수 있게 정규화한다.

    화면(PrepCard/ActiveCall)이 자체 불릿을 그리므로 모델이 붙여 보내는 '- ' 같은
    접두사를 떼지 않으면 이중 표기가 된다. 사전 측정에서 회차마다 붙었다 안 붙었다 했다.
    """
    if not isinstance(value, list):
        return []

    cleaned: list[str] = []
    for item in value:
        if not isinstance(item, str):
            continue
        text = item.strip().lstrip(_BULLET_PREFIX).strip()
        if not text or len(text) > _MAX_POINT_LENGTH:
            continue
        if text in cleaned:
            continue
        cleaned.append(text)
        if len(cleaned) == _MAX_REQUEST_POINTS:
            break
    return cleaned
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `cd backend && ./.venv/Scripts/python.exe -m pytest tests/test_local_llm.py -v`
Expected: PASS — 10 passed

- [ ] **Step 5: 전체 스위트가 깨지지 않았는지 확인**

Run: `cd backend && ./.venv/Scripts/python.exe -m pytest -q`
Expected: PASS — 86 passed, 4 skipped (기존 76 + 신규 10)

- [ ] **Step 6: 커밋**

```bash
cd backend
git add tests/test_local_llm.py app/services/local_llm.py
git commit -m "feat(llm): 요구사항 불릿 정제 함수 추가

LLM이 '- 항목'처럼 불릿 접두사를 붙여 보내는 회차가 있어 화면의 자체
불릿과 이중 표기된다. 접두사 제거·중복 제거·4개/100자 상한을 한 순수
함수로 분리한다."
```

---

### Task 2: 백엔드 — GptAnalysis에 필드 추가 + 3개 분석 경로 배선

분석 결과 모델에 필드를 넣고, 로컬 LLM·OpenAI·스텁 세 경로가 모두 같은 모양을 돌려주게 한다. 경로마다 다르면 데모 환경에 따라 화면이 달라진다.

**Files:**
- Modify: `app/schemas.py`
- Modify: `app/services/local_llm.py`
- Modify: `app/services/gpt_analysis.py`
- Modify: `app/services/stub_models.py`
- Modify: `tests/test_local_llm.py`

**Interfaces:**
- Consumes: `clean_request_points(value) -> list[str]` (Task 1)
- Produces: `GptAnalysis.customer_request_points: list[str]` — Task 3의 어댑터가 읽는다.

- [ ] **Step 1: 실패하는 테스트 작성**

`tests/test_local_llm.py` 끝에 추가:

```python
from app.schemas import GptAnalysis
from app.services.stub_models import analyze_transcript_stub


def test_GptAnalysis는_요구사항_없이도_만들어진다():
    """기존 호출부가 안 깨지도록 기본값은 빈 리스트다."""
    analysis = GptAnalysis(
        summary="요약",
        department="일반상담팀",
        keywords=["키워드"],
        risk_flags={},
    )
    assert analysis.customer_request_points == []


def test_GptAnalysis에_요구사항을_담을_수_있다():
    analysis = GptAnalysis(
        summary="요약",
        department="계좌보안팀",
        keywords=["카드"],
        risk_flags={},
        customer_request_points=["즉시 지급정지 요청"],
    )
    assert analysis.customer_request_points == ["즉시 지급정지 요청"]


def test_스텁도_요구사항을_돌려준다():
    """스텁 경로에서 블록이 조용히 사라지면 UI 흐름 확인이 안 된다."""
    result = analyze_transcript_stub("아무 전사문")
    assert len(result.customer_request_points) >= 1
    assert all(isinstance(p, str) and p.strip() for p in result.customer_request_points)
```

- [ ] **Step 2: 테스트가 실패하는지 확인**

Run: `cd backend && ./.venv/Scripts/python.exe -m pytest tests/test_local_llm.py -v -k "GptAnalysis or 스텁"`
Expected: FAIL — `ValidationError` 또는 `AttributeError: 'GptAnalysis' object has no attribute 'customer_request_points'`

- [ ] **Step 3: 스키마에 필드 추가**

`app/schemas.py`의 `class GptAnalysis`를 다음으로 바꾼다:

```python
class GptAnalysis(BaseModel):
    summary: str
    department: str
    keywords: list[str]
    risk_flags: RiskFlags
    # 고객이 발화에서 요구·진술한 것의 분해. 화면 "전화 요약 · 고객 발화 STT 요약" 블록.
    # 추출 실패나 무발화 시 빈 리스트 — 화면은 빈 리스트면 블록을 그리지 않는다.
    customer_request_points: list[str] = []
```

- [ ] **Step 4: 로컬 LLM 프롬프트와 파싱에 배선**

`app/services/local_llm.py`의 `_SYSTEM_PROMPT` 안 JSON 스키마에서 `"keywords"` 줄 **다음**에 한 줄 추가:

```
  "keywords": ["핵심 키워드 3~6개"],
  "customer_request_points": ["고객이 요구·진술한 것 2~4개. 확인되는 게 없으면 빈 배열 []"],
```

같은 파일 `_SYSTEM_PROMPT` 문자열 맨 끝(`플래그는 전사문에서...` 줄 다음)에 추가:

```
customer_request_points는 전사문에서 실제로 확인되는 고객의 요구·진술만 적는다. 상담사가 할
일이 아니라 고객이 말한 것을 적는다. 확인되는 게 없으면 빈 배열 []로 남기고, "문의 내용 파악
필요" 같은 내용 없는 문장으로 채우지 마라.
```

같은 파일 `analyze_transcript_local`의 `return GptAnalysis(...)`를 다음으로 바꾼다:

```python
        return GptAnalysis(
            summary=payload["summary"],
            department=payload["department"],
            keywords=payload["keywords"],
            risk_flags=RiskFlags(**payload.get("risk_flags", {})),
            customer_request_points=clean_request_points(payload.get("customer_request_points")),
        )
```

- [ ] **Step 5: OpenAI 경로 배선**

`app/services/gpt_analysis.py`의 `return GptAnalysis(...)`를 다음으로 바꾼다:

```python
    return GptAnalysis(
        summary=payload["summary"],
        department=payload["department"],
        keywords=payload["keywords"],
        risk_flags=RiskFlags(**payload["risk_flags"]),
        customer_request_points=clean_request_points(payload.get("customer_request_points")),
    )
```

같은 파일 상단 import 블록에 추가:

```python
from app.services.local_llm import clean_request_points
```

- [ ] **Step 6: 스텁 경로 배선**

`app/services/stub_models.py`의 `analyze_transcript_stub`을 다음으로 바꾼다:

```python
def analyze_transcript_stub(transcript: str) -> GptAnalysis:
    """실제 LLM 없이 고정 분석을 돌려준다. 위험 플래그는 전부 False(안전 기본값)."""
    return GptAnalysis(
        summary="[데모 스텁] 실제 분석 모델이 없어 생성된 예시 요약입니다. UI 흐름 확인용입니다.",
        department="일반상담팀",
        keywords=["데모", "스텁"],
        risk_flags=RiskFlags(),
        customer_request_points=["[데모 스텁] 실제 분석 모델이 없어 생성된 예시 항목입니다."],
    )
```

- [ ] **Step 7: 테스트 통과 확인**

Run: `cd backend && ./.venv/Scripts/python.exe -m pytest tests/test_local_llm.py -v`
Expected: PASS — 13 passed

- [ ] **Step 8: 전체 스위트 확인**

Run: `cd backend && ./.venv/Scripts/python.exe -m pytest -q`
Expected: PASS — 89 passed, 4 skipped

- [ ] **Step 9: 커밋**

```bash
cd backend
git add app/schemas.py app/services/local_llm.py app/services/gpt_analysis.py app/services/stub_models.py tests/test_local_llm.py
git commit -m "feat(llm): 고객 요구사항 분해를 분석 결과에 추가

기존 단일 호출의 JSON 스키마에 customer_request_points를 얹는다. 별도
LLM 호출이 아니라 summary/department를 뽑는 그 호출에 편승하므로 지연
증가가 없다. 내용 없는 문장으로 채우지 말고 빈 배열을 남기라고 프롬프트에
명시했다(사전 측정에서 '문의 내용 파악 필요' 같은 빈 껍데기가 나왔다).

로컬/OpenAI/스텁 세 경로를 같은 모양으로 맞춰 데모 환경에 따라 화면이
달라지지 않게 한다."
```

---

### Task 3: 백엔드 — mvp-1.1 계약과 어댑터

계약에 필드를 싣고 버전을 올린다. `exactKeys`가 양방향 파괴적이라 버전을 올려야 불일치가 명시적 에러가 된다.

**Files:**
- Modify: `app/contracts.py`
- Modify: `app/main.py`
- Modify: `app/services/mvp_adapter.py`
- Modify: `tests/test_mvp_adapter.py`

**Interfaces:**
- Consumes: `GptAnalysis.customer_request_points: list[str]` (Task 2)
- Produces: `ConsultationCard.customer_request_points: list[str]`, `MvpCallResponse.schema_version == "mvp-1.1"` — Task 4·5의 프론트 계약이 이 모양을 기대한다.

- [ ] **Step 1: 실패하는 테스트 작성**

이 파일에는 이미 `_gpt(...)`와 `_judgement(level, reason_codes)` 헬퍼가 있다(13행, 22행). 그대로 쓴다. `_gpt`는 아직 요구사항 인자를 받지 않으므로 파라미터를 하나 추가한다.

`tests/test_mvp_adapter.py`의 `_gpt` 헬퍼를 다음으로 바꾼다:

```python
def _gpt(
    department="이체오류처리팀",
    keywords=None,
    summary="착오송금 신고 접수",
    customer_request_points=None,
) -> GptAnalysis:
    return GptAnalysis(
        summary=summary,
        department=department,
        keywords=["착오송금"] if keywords is None else keywords,
        risk_flags=RiskFlags(),
        customer_request_points=customer_request_points or [],
    )
```

같은 파일 맨 끝에 추가:

```python
from app.contracts import MvpCallResponse


def test_요구사항이_상담카드로_전달된다():
    card = to_consultation_card(
        _gpt(customer_request_points=["즉시 지급정지 요청", "부정결제 확인"]),
        _judgement(AttentionLevel.NONE),
    )
    assert card.customer_request_points == ["즉시 지급정지 요청", "부정결제 확인"]


def test_요구사항이_없으면_빈_리스트다():
    card = to_consultation_card(_gpt(), _judgement(AttentionLevel.NONE))
    assert card.customer_request_points == []


def test_계약_버전은_mvp_1_1이다():
    assert MvpCallResponse.model_fields["schema_version"].default == "mvp-1.1"
```

- [ ] **Step 2: 테스트가 실패하는지 확인**

Run: `cd backend && ./.venv/Scripts/python.exe -m pytest tests/test_mvp_adapter.py -v -k "요구사항 or 계약_버전"`
Expected: FAIL — `AttributeError: 'ConsultationCard' object has no attribute 'customer_request_points'`

- [ ] **Step 3: 계약에 필드와 버전 반영**

`app/contracts.py`의 `class ModelConsultationResult`에서 `routing_confidence` 줄 **다음**에 추가:

```python
    customer_request_points: list[str] = Field(default_factory=list, max_length=4)
```

같은 파일 `class ConsultationCard`에서 `routing_confidence` 줄 **다음**에 추가:

```python
    customer_request_points: list[str] = Field(default_factory=list, max_length=4)
```

같은 파일에서 버전 문자열 두 곳을 바꾼다:

```python
class MvpCallResponse(BaseModel):
    schema_version: str = "mvp-1.1"
```

```python
class MvpHealthResponse(BaseModel):
    status: str
    database: str
    contract_version: str = "mvp-1.1"
```

파일 첫 줄 독스트링도 갱신한다:

```python
"""K7 표준 응답 계약(mvp-1.1) — 이찬희 파트(kda4-k7-product/lch)와 동일한 스키마.
```

- [ ] **Step 4: /health 리터럴 갱신**

`app/main.py:48` 부근의 `"contract_version": "mvp-1.0",`을 다음으로 바꾼다:

```python
        "contract_version": "mvp-1.1",
```

- [ ] **Step 5: 어댑터에서 전달**

`app/services/mvp_adapter.py`의 `to_model_consultation_result` 안 `return ModelConsultationResult(...)`에서 `routing_confidence=None,` 줄 **다음**에 추가:

```python
        customer_request_points=gpt_result.customer_request_points,
```

- [ ] **Step 6: 테스트 통과 확인**

Run: `cd backend && ./.venv/Scripts/python.exe -m pytest tests/test_mvp_adapter.py -v`
Expected: PASS

- [ ] **Step 7: 전체 스위트 확인**

Run: `cd backend && ./.venv/Scripts/python.exe -m pytest -q`
Expected: PASS — 92 passed, 4 skipped

- [ ] **Step 8: 실제 응답 모양 확인**

```bash
cd backend
./.venv/Scripts/python.exe -c "
import io, sys, json
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
from app.contracts import ConsultationCard
print(json.dumps(ConsultationCard(
    summary='요약', business_type='카드', department='계좌보안팀',
    routing_reason='사유', incident_risk='low',
    customer_request_points=['즉시 지급정지 요청'],
).model_dump(), ensure_ascii=False, indent=2))
"
```
Expected: `customer_request_points` 키가 포함되고 값이 `["즉시 지급정지 요청"]`

- [ ] **Step 9: 커밋**

```bash
cd backend
git add app/contracts.py app/main.py app/services/mvp_adapter.py tests/test_mvp_adapter.py
git commit -m "feat(contract): mvp-1.1 — 상담카드에 customer_request_points 추가

프론트 파서의 exactKeys가 키 개수와 이름을 정확히 비교해 양방향으로
파괴적이다. 필드를 더하면 구프론트+신백엔드, 신프론트+구백엔드가 모두
깨지므로 schema_version을 mvp-1.1로 올려 불일치를 모호한 파싱 실패 대신
명시적 버전 에러로 드러낸다. /health의 contract_version도 함께 올린다."
```

---

### Task 4: 프론트 — 계약 스키마와 예제 JSON

Ajv가 스키마와 예제를 대조하므로 둘을 함께 바꿔야 한다. 예제 JSON은 mock 경로가 실제로 파싱하는 픽스처이기도 하다.

**Files:**
- Modify: `database/contracts/mvp_call_response.schema.json`
- Modify: `database/contracts/examples/mvp_call_response.example.json`

**Interfaces:**
- Consumes: Task 3의 `ConsultationCard` 모양 (`customer_request_points: list[str]`, 최대 4개)
- Produces: Task 5의 파서와 `validate-frontend-contract.mjs`가 읽는 픽스처

- [ ] **Step 1: 스키마에 필드와 버전 반영**

`database/contracts/mvp_call_response.schema.json`에서 `$id`와 `schema_version`을 바꾼다:

```json
  "$id": "https://k7.example/contracts/mvp-call-response-1.1.schema.json",
```

```json
    "schema_version": { "const": "mvp-1.1" },
```

같은 파일 `consultation_card.required` 배열에 항목을 추가한다(마지막 `"emotion"` 다음):

```json
      "required": [
        "summary",
        "business_type",
        "department",
        "routing_reason",
        "incident_risk",
        "risk_reason",
        "routing_confidence",
        "emotion",
        "customer_request_points"
      ],
```

같은 파일 `consultation_card.properties`에서 `"routing_confidence"` 블록 **다음**에 추가:

```json
        "customer_request_points": {
          "type": "array",
          "maxItems": 4,
          "items": { "type": "string", "minLength": 1, "maxLength": 100 }
        },
```

- [ ] **Step 2: 예제 JSON 갱신**

`database/contracts/examples/mvp_call_response.example.json`에서 `schema_version`을 바꾸고 `consultation_card`에 필드를 추가한다. 전체 파일은 다음이 된다:

```json
{
  "schema_version": "mvp-1.1",
  "call_id": "94650acb-f213-49ee-a94e-87dfd645cc40",
  "status": "ready",
  "source_channel": "voice",
  "audio_filename": "loan-extension.wav",
  "transcript": {
    "text": "주택담보대출 만기를 연장할 수 있는지와 필요한 서류를 알고 싶습니다.",
    "stt_model": "whisper-1",
    "duration_sec": 8.42
  },
  "consultation_card": {
    "summary": "고객이 주택담보대출 만기 연장 가능 여부와 필요한 서류를 문의함.",
    "business_type": "주택담보대출 만기 연장",
    "department": "대출 및 금융상담",
    "routing_reason": "대출 만기 연장 및 약정 변경 상담에 해당",
    "incident_risk": "low",
    "risk_reason": null,
    "routing_confidence": 0.94,
    "customer_request_points": [
      "주택담보대출 만기 연장 가능 여부 확인 요청",
      "연장 시 필요한 서류 안내 요청",
      "비대면 진행 가능 여부에 관심"
    ],
    "emotion": {
      "status": "unavailable",
      "score": null,
      "level": null,
      "reason": "감정 모델은 아직 MVP 통합 전입니다."
    }
  },
  "created_at": "2026-07-16T06:00:00Z"
}
```

- [ ] **Step 3: 스키마·예제 정합 확인**

Run: `cd kda4-k7-product && npm run validate:contracts`
Expected: PASS — 에러 없이 종료

- [ ] **Step 4: 커밋**

```bash
cd kda4-k7-product
git add database/contracts/mvp_call_response.schema.json database/contracts/examples/mvp_call_response.example.json
git commit -m "feat(contract): mvp-1.1 — customer_request_points 스키마·예제 추가

백엔드 mvp-1.1에 맞춘다. 예제 JSON은 Ajv 대조 대상이자 mock 경로가 실제로
파싱하는 픽스처라 함께 갱신해야 한다."
```

---

### Task 5: 프론트 — 타입·파서와 검증 케이스

`exactKeys`는 예상 키 목록과 정확히 일치해야 통과하므로 목록에 필드를 넣고, 값 자체도 검증한다.

**Files:**
- Modify: `src/services/types.ts`
- Modify: `src/services/consultationContract.ts`
- Modify: `scripts/validate-frontend-contract.mjs`

**Interfaces:**
- Consumes: Task 4의 스키마·예제
- Produces: `MvpConsultationCard.customer_request_points: string[]` — Task 6이 `vm.summaryPoints`로 읽는다.

- [ ] **Step 1: 타입 갱신**

`src/services/types.ts`의 `MvpConsultationCard`를 다음으로 바꾼다:

```typescript
export interface MvpConsultationCard {
  summary: string;
  business_type: string;
  department: string;
  routing_reason: string;
  incident_risk: MvpIncidentRisk;
  risk_reason: string | null;
  routing_confidence: number | null;
  /** 고객이 발화에서 요구·진술한 것. 빈 배열이면 화면에서 블록을 그리지 않는다. */
  customer_request_points: string[];
  emotion: MvpEmotionResult;
}
```

같은 파일 `ConsultationCardResponse`의 버전 리터럴을 바꾼다:

```typescript
export interface ConsultationCardResponse {
  schema_version: "mvp-1.1";
```

- [ ] **Step 2: 파서 갱신**

`src/services/consultationContract.ts:174` 부근의 버전 핀을 바꾼다:

```typescript
  if (response.schema_version !== "mvp-1.1") {
    fail("$.schema_version", "expected mvp-1.1");
  }
```

같은 파일 `fail()` 함수의 메시지도 버전을 맞춘다:

```typescript
function fail(path: string, message: string): never {
  throw new Error(`Invalid mvp-1.1 response at ${path}: ${message}`);
}
```

같은 파일 `exactKeys(card, "$.consultation_card", [...])` 목록에 항목을 추가한다:

```typescript
  exactKeys(card, "$.consultation_card", [
    "summary",
    "business_type",
    "department",
    "routing_reason",
    "incident_risk",
    "risk_reason",
    "routing_confidence",
    "customer_request_points",
    "emotion",
  ]);
```

같은 파일 위 `exactKeys` 호출 **다음**에 값 검증을 추가한다:

```typescript
  const requestPoints = card.customer_request_points;
  if (!Array.isArray(requestPoints)) {
    fail("$.consultation_card.customer_request_points", "expected array");
  }
  if (requestPoints.length > 4) {
    fail("$.consultation_card.customer_request_points", "expected at most 4 items");
  }
  requestPoints.forEach((point, index) => {
    if (typeof point !== "string" || point.trim().length === 0) {
      fail(
        `$.consultation_card.customer_request_points[${index}]`,
        "expected non-empty string"
      );
    }
    if (point.length > 100) {
      fail(
        `$.consultation_card.customer_request_points[${index}]`,
        "expected at most 100 characters"
      );
    }
  });
```

같은 파일 맨 아래 `return { ... }`의 `consultation_card` 조립부에서, `routing_confidence: nullableNumberInRange(...)` 블록과 `emotion: parseEmotion(card.emotion),` **사이**에 한 줄을 넣는다:

```typescript
      routing_confidence: nullableNumberInRange(
        card.routing_confidence,
        "$.consultation_card.routing_confidence",
        0,
        1
      ),
      customer_request_points: requestPoints as string[],
      emotion: parseEmotion(card.emotion),
```

- [ ] **Step 3: 검증 스크립트에 케이스 추가**

`scripts/validate-frontend-contract.mjs`의 accepted 확인부를 바꾼다:

```javascript
const accepted = parseConsultationCardResponse(fixture);
if (accepted.schema_version !== "mvp-1.1" || accepted.source_channel !== "voice") {
  throw new Error("valid response did not survive frontend parsing");
}
if (accepted.consultation_card.customer_request_points.length !== 3) {
  throw new Error("customer_request_points did not survive frontend parsing");
}
```

같은 파일 `rejectedCases` 배열의 `{ ...fixture, schema_version: "mvp-2.0" },` **다음**에 케이스를 추가한다:

```javascript
  { ...fixture, schema_version: "mvp-1.0" },
  {
    ...fixture,
    consultation_card: {
      ...fixture.consultation_card,
      customer_request_points: "즉시 지급정지 요청",
    },
  },
  {
    ...fixture,
    consultation_card: {
      ...fixture.consultation_card,
      customer_request_points: ["항목1", "항목2", "항목3", "항목4", "항목5"],
    },
  },
  {
    ...fixture,
    consultation_card: {
      ...fixture.consultation_card,
      customer_request_points: ["  "],
    },
  },
  {
    ...fixture,
    consultation_card: {
      ...fixture.consultation_card,
      customer_request_points: ["가".repeat(101)],
    },
  },
```

빈 배열은 **허용**되어야 하므로 accepted 쪽에 확인을 추가한다. 파일 맨 끝 `console.log` **바로 위**에 넣는다:

```javascript
const emptyPoints = parseConsultationCardResponse({
  ...fixture,
  consultation_card: { ...fixture.consultation_card, customer_request_points: [] },
});
if (emptyPoints.consultation_card.customer_request_points.length !== 0) {
  throw new Error("empty customer_request_points must be accepted");
}
```

- [ ] **Step 4: 검증 실행**

Run: `cd kda4-k7-product && npm run validate:frontend-contract`
Expected: PASS — `FRONTEND_CONTRACT_OK valid=1 invalid_rejected=13`

- [ ] **Step 5: 타입 체크**

Run: `cd kda4-k7-product && npx tsc --noEmit`
Expected: PASS — 에러 없음. `mock` 경로(`src/services/consultation.ts`)가 타입 에러를 내면 그 파일이 쓰는 `demoResponse` 픽스처는 Task 4에서 이미 필드를 가지므로 캐스팅만 맞추면 된다.

- [ ] **Step 6: 커밋**

```bash
cd kda4-k7-product
git add src/services/types.ts src/services/consultationContract.ts scripts/validate-frontend-contract.mjs
git commit -m "feat(contract): mvp-1.1 파서 — customer_request_points 검증

exactKeys가 키 목록과 정확히 일치해야 통과하므로 목록에 필드를 넣고
값(배열·4개·100자·비어있지 않은 문자열)도 검증한다. 빈 배열은 허용한다 —
무발화 통화에서 정상적으로 비는 값이다.

버전 핀을 mvp-1.1로 올리고 mvp-1.0을 거부 케이스로 추가해 구백엔드가
붙었을 때 조용히 통과하지 않게 한다."
```

---

### Task 6: 프론트 — 렌더 배선과 빈 배열 숨김

`vm.summaryPoints`의 출처를 픽스처에서 백엔드 값으로 바꾸고, 두 렌더 지점 모두 빈 배열이면 블록을 그리지 않게 한다.

**Files:**
- Modify: `src/hooks/useCallFlow.ts`
- Modify: `src/components/desktop/PrepCard.tsx`
- Modify: `src/components/desktop/ActiveCall.tsx`

**Interfaces:**
- Consumes: `MvpConsultationCard.customer_request_points: string[]` (Task 5)
- Produces: 없음 (최종 소비 지점)

- [ ] **Step 1: 백엔드 값 배선**

`src/hooks/useCallFlow.ts:1081`에 이미 `const card = consultationResponse.consultation_card;`가 있고, `consultationResponse`는 `useState<ConsultationCardResponse>(() => getDemoConsultationCard())`로 초기화된다(267행). 즉 `card`는 실제 API 경로든 mock 경로든 **항상 정의돼 있고**, Task 5에서 타입상 필수 필드가 되므로 `card.customer_request_points`는 언제나 `string[]`이다. 폴백이 필요 없다.

`src/hooks/useCallFlow.ts:1276`을 다음으로 바꾼다:

```typescript
    // 백엔드가 발화에서 분해한 고객 요구사항 — 빈 배열이면 화면이 블록을 그리지 않는다
    summaryPoints: card.customer_request_points,
```

같은 파일 7행 부근 import에서 `SUMMARY_POINTS,` 한 줄을 지운다. 다른 곳에서 쓰지 않는다(파일 내 사용처는 이 한 곳뿐이었다). `src/data/demoContent.ts`의 상수 정의 자체는 남겨둔다.

- [ ] **Step 2: PrepCard에서 빈 배열이면 블록 숨김**

`src/components/desktop/PrepCard.tsx:142` 부근, 주석 `{/* 우: 전화 요약 — 대기 중 고객 발화 STT를 요약한 내용 */}` 다음의 `<div ...>` 블록 전체를 조건부로 감싼다. 여는 부분을 다음으로 바꾼다:

```tsx
            {/* 우: 전화 요약 — 대기 중 고객 발화 STT를 요약한 내용.
                빈 배열이면 그리지 않는다 — 무발화 통화에서 픽스처로 채우지 않기 위함. */}
            {vm.summaryPoints.length > 0 && (
            <div style={css("flex:1;min-width:0;align-self:stretch;background:var(--onair-surface);border:1.5px solid var(--blue-500);border-radius:8px;padding:14px 16px")}>
```

그 블록의 닫는 `</div>` 다음에 `)}`를 붙인다:

```tsx
            </div>
            )}
```

- [ ] **Step 3: ActiveCall에서 빈 배열이면 블록 숨김**

`src/components/desktop/ActiveCall.tsx:439` 부근, 주석 `{/* 전화 요약 — 고객 발화 STT를 요약한 내용(대화 요약) */}` 다음의 라벨 `<div>`와 목록 `<div>` 두 개를 함께 감싼다. 라벨 div 앞에 추가:

```tsx
            {vm.summaryPoints.length > 0 && (<>
```

목록 div의 닫는 `</div>` 다음에 추가:

```tsx
            </>)}
```

- [ ] **Step 4: 전체 검증**

Run: `cd kda4-k7-product && npm run check`
Expected: PASS — validate:manifest, validate:contracts, validate:adapter, validate:frontend-contract, build 모두 통과

- [ ] **Step 5: 커밋**

```bash
cd kda4-k7-product
git add src/hooks/useCallFlow.ts src/components/desktop/PrepCard.tsx src/components/desktop/ActiveCall.tsx
git commit -m "feat(card): 전화 요약을 백엔드 발화 기반 값으로 교체

수신 유형 토글이 내용을 결정하던 픽스처를 백엔드 customer_request_points로
바꾼다. 해외 카드 부정결제 음성에 '주택담보대출 만기 연장'이 뜨던 문제다.

빈 배열이면 블록을 그리지 않는다. 라벨이 '고객 발화 STT 요약'이라
고정 문구로 채우면 화면이 거짓말을 하게 된다.

mock 경로도 예제 JSON을 파싱해 같은 필드를 채우므로 SUMMARY_POINTS
폴백은 불필요하다. import만 끊고 상수 정의는 남긴다."
```

---

### Task 7: E2E 통합 검증

계약이 양방향 파괴적이라 양쪽을 함께 띄워야 의미 있는 검증이 된다.

**Files:**
- 코드 변경 없음 (검증 전용)

**Interfaces:**
- Consumes: Task 1~6 전체
- Produces: 없음

- [ ] **Step 1: 백엔드 재기동**

```bash
cd backend
# 기존 프로세스 종료 후
./.venv/Scripts/python.exe -m uvicorn app.main:app --host 0.0.0.0 --port 8000
```

- [ ] **Step 2: 계약 버전 확인**

Run: `curl -s http://127.0.0.1:8000/health`
Expected: `{"status":"ok","database":"connected","contract_version":"mvp-1.1"}`

- [ ] **Step 3: 프론트 재기동**

```bash
cd kda4-k7-product
npm run dev -- --host 0.0.0.0
```

- [ ] **Step 4: 실제 음성으로 응답 확인**

시연용 WAV가 없으면 기존 샘플에서 만든다(16kHz 모노 — 음향 감정 모델이 유효 WAV를 요구한다):

```bash
ffmpeg -y -i "C:/Users/natur/Documents/금융콜센터AI/stt/test_sample2.m4a" \
  -ar 16000 -ac 1 -c:a pcm_s16le /tmp/demo.wav
```

```bash
curl -s -X POST http://127.0.0.1:8000/api/v1/calls \
  -F "audio=@/tmp/demo.wav;type=audio/wav" \
  | ./backend/.venv/Scripts/python.exe -c "
import io, json, sys
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
d = json.load(sys.stdin)
print('schema_version:', d['schema_version'])
for p in d['consultation_card']['customer_request_points']:
    print(' -', p)
"
```

Expected: `schema_version: mvp-1.1`, 그리고 항목들이 **실제 통화 내용**(해외 카드 부정결제·지급정지)에 대응한다. "주택담보대출"이 나오면 실패다.

- [ ] **Step 5: 화면에서 회귀 확인**

브라우저에서 `http://192.168.11.135:5173/` 접속 → **수신 토글을 `일반`으로 둔 채** 시연 WAV 업로드 → 준비 카드의 "전화 요약" 블록 확인.

Expected: 토글이 `일반`인데도 항목이 통화 내용을 따라간다. 원래 버그는 토글이 내용을 결정하는 것이었으므로, 이게 회귀 검증의 핵심이다.

- [ ] **Step 6: 통화 단계도 확인**

같은 화면에서 "통화 연결"까지 진행 → `ActiveCall` 화면의 "전화 요약" 블록도 같은 내용인지 확인.

Expected: 준비 카드와 동일한 항목. 다르면 Task 6 Step 3이 누락된 것이다.

- [ ] **Step 7: 팀원 공지**

`192.168.11.135:5173`에 붙어 있는 팀원이 있으면 재기동으로 화면이 깨졌을 수 있다. 새로고침을 요청한다.

---

## 검토 메모

**스펙 대비 커버리지**
- 필드명·의미(`customer_request_points`, 고객 발화 요약) → Task 2, 3
- 계약 버전 `mvp-1.1` 4개 지점 → Task 3(백엔드 3곳), Task 5(파서 핀)
- 정제 규칙 6개 → Task 1
- 폴백(빈 배열 → 블록 숨김) → Task 6 Step 2·3, Task 5(빈 배열 허용)
- 3개 분석 경로 동등 처리 → Task 2 Step 4·5·6
- 두 렌더 지점 → Task 6 Step 2·3
- 예제 JSON·mock 경로 → Task 4
- 배포 동시성 → Task 7

**범위 밖(스펙 "미해결"에 기록됨)**: 오프닝 문장 픽스처, 유의사항 픽스처, RAG 오매칭, `/briefing` 라우팅 오분류, CURRENT_STATE 문서 불일치.
