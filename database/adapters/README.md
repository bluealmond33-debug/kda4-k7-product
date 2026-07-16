# 모델 결과 참조 어댑터

이 폴더는 변경 중인 모델 결과를 K7의 상담카드·라우팅 JSON으로 바꾸는 독립 실행 모듈입니다. FastAPI 엔드포인트는 구현하지 않으며, 다른 팀이 함수 또는 명령어로 바로 시험할 수 있는 기준 구현을 제공합니다.

외부 Python 패키지는 필요하지 않습니다.

## 처리 흐름

```text
팀원 모델 JSON
  + 외부 상담 키
  + 수정 가능한 매핑 JSON
          │
          ▼
model_result_adapter.py
  ├─ ready ───────────→ consultation_card + routing_candidate
  └─ needs_enrichment → 누락된 매핑·필드 목록
```

## 바로 실행하기

저장소 최상위 폴더에서 실행합니다.

### Windows

```powershell
py -3.12 database/adapters/model_result_adapter.py `
  --input database/contracts/examples/model_consultation_result_input.example.json `
  --session-key K7-DEMO-20260715-0001 `
  --generated-at 2026-07-16T00:00:00Z
```

### macOS·Linux

```bash
python3 database/adapters/model_result_adapter.py \
  --input database/contracts/examples/model_consultation_result_input.example.json \
  --session-key K7-DEMO-20260715-0001 \
  --generated-at 2026-07-16T00:00:00Z
```

`status=ready`이면 출력의 `consultation_card`와 `routing_candidate`가 기존 K7 계약 구조입니다. `needs_enrichment`이면 `pending_fields`와 `warnings`를 확인합니다.

## FastAPI에서 함수로 사용하기

```python
from database.adapters import load_mapping, normalize_model_result

mapping = load_mapping()
normalized = normalize_model_result(
    model_payload,
    external_session_key=external_session_key,
    mapping=mapping,
)

if normalized["status"] != "ready":
    # 아직 매핑되지 않은 업무·부서를 보완하거나 일반 대기열로 처리
    ...

consultation_card = normalized["consultation_card"]
routing_candidate = normalized["routing_candidate"]
```

FastAPI는 정규화 결과를 JSON Schema로 한 번 더 검증한 뒤 `commands.sql`의 바인딩 쿼리를 사용합니다.

## 새 업무유형·부서 추가

`model_result_mapping.v1.json`의 두 부분만 수정합니다.

```json
{
  "department_aliases": {
    "모델이 반환하는 부서명": "database_department_code"
  },
  "business_types": {
    "모델이 반환하는 업무유형": {
      "inquiry_type": "other",
      "department_code": "general_banking",
      "default_risk_level": "low",
      "default_urgency_level": "low",
      "routing_confidence": 1.0
    }
  }
}
```

- `inquiry_type`은 `consultation_card.schema.json`의 코드 중 하나를 사용합니다.
- `department_code`는 DB `departments`에 존재해야 합니다.
- 기본 위험도는 명시적인 업무 규칙이며, 입력 누락을 임의로 저위험 처리하는 값이 아닙니다.
- 기본 `routing_confidence`는 라벨→부서 매핑의 확정 정도이며 모델 정확도가 아닙니다.
- 새 업무 라벨은 매핑 파일 버전을 올리고 테스트를 추가합니다.

팀별 매핑을 별도 파일로 관리할 수도 있습니다.

```powershell
py -3.12 database/adapters/model_result_adapter.py `
  --input result.json `
  --session-key K7-SESSION-0001 `
  --mapping team_mapping.json
```

## 새 모델 필드 추가

임시 입력 Schema는 추가 필드를 받을 수 있습니다. 어댑터는 알지 못하는 값의 **필드명만** `ignored_fields`에 표시하고 DB에는 저장하지 않습니다.

새 필드를 실제 제품에서 사용해야 할 때만 다음 순서로 승격합니다.

1. 필드 의미·자료형·필수 여부 합의
2. 임시 입력 Schema에 명시
3. 어댑터 변환 로직과 테스트 추가
4. 필요한 경우 운영 JSON 계약·DB·React를 함께 변경

이 방식으로 모델팀은 실험 필드를 자유롭게 추가하고, DB는 합의된 값만 안전하게 받습니다.

## 테스트

Python 단위테스트와 기존 상담카드·라우팅 Schema까지 한 번에 확인합니다.

```powershell
npm run validate:adapter
```

### Windows

```powershell
py -3.12 -m unittest discover database/adapters/tests -v
```

설치된 버전이 다르면 `-3.12`를 해당 Python 3 버전으로 바꿉니다. `npm run validate:adapter`는 실행 가능한 Python을 자동으로 찾습니다.

### macOS·Linux

```bash
python3 -m unittest discover database/adapters/tests -v
```

테스트는 현재 두 사례, 매핑만으로 새 업무 추가, 미등록 업무, 추가 필드, 세션 키 불일치, 위험 사유 누락을 확인합니다.
