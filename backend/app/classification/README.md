# 은행 상담 분류기 연동 안내

이 패키지는 STT 전사문을 `SIMPLE`, `GENERAL`, `EMERGENCY`로 분류하고 업무 코드를 반환한다. 데모 UI, SQLite, 더미 상담카드는 포함하지 않는다. 기존 OpenAI 임시 파이프라인을 자동으로 교체하지 않으며 백엔드에서 선택적으로 호출한다.

## 처리 순서

1. 보이스피싱·본인 미승인 거래의 복합 문맥을 우선 확인한다.
2. 예외 징후가 없는 단일 조회·안내 및 개인회원 ARS 업무를 단순 업무로 판정한다.
3. 로컬 NIA 은행 주제 모델이 있고 마진이 `0.75` 이상이면 일반 업무 세부 코드를 선택한다.
4. 모델이 없거나 확신도가 낮고 규칙도 불명확하면 안전하게 `G004` 일반 상담으로 보낸다.

기관명이나 `인증번호` 같은 단일 단어만으로 긴급 판정하지 않는다. `직원 연결`, 오류, 분쟁, 제한, 정지 등이 섞이면 단순 업무로 처리하지 않는다.

## 호출

```python
from app.classification import classify_transcript

result = classify_transcript("체크카드 한도 조회하고 싶어요")
```

대표 출력:

```json
{
  "code": "S104",
  "name": "카드 이용한도 조회",
  "classification": "SIMPLE",
  "handler": "AI_CC",
  "matched_keywords": ["체크카드 한도 조회"],
  "reason": "명확한 단일 조회·안내 의도이며 예외 징후 없음"
}
```

## 제품 백엔드 매핑

현재 `mvp-1.0` 계약은 `task_code`와 `classification`을 저장하지 않는다. 계약을 확장하기 전에는 다음처럼 기존 필드에 매핑할 수 있다.

| 분류 결과 | 처리 대상 | 기존 `department` 권장값 |
|---|---|---|
| `SIMPLE` | ARS 또는 AI CC | `ARS` |
| `GENERAL` | 인간 일반 상담 대기열 | 업무별 기존 부서 |
| `EMERGENCY` | 인간 긴급 대기열 | `금융사기` |

`pipeline.py`에서 OpenAI 호출을 바로 제거하지 말고 기능 플래그 뒤에서 분류기를 먼저 호출한다. 분류 결과는 `business_type`, `department`, `routing_reason`, `incident_risk`, `risk_reason`으로 변환해 `persist_pipeline_result()`에 전달한다.

## EXAONE 3.5와 역할 분리

- 이 분류기: 업무 코드, 3단계 분류, 처리 대상, 긴급 라우팅
- Ollama + EXAONE 3.5: 요약, 핵심 사항, 주요 키워드
- FastAPI: 두 결과를 결합하고 계약 검증 후 PostgreSQL 저장

EXAONE 장애가 분류와 긴급 라우팅을 막지 않도록 별도 어댑터와 타임아웃을 둔다. `key_points`, `keywords`, `task_code`, `classification`을 영구 저장하려면 Pydantic 계약, JSON Schema, PostgreSQL 스키마를 함께 변경해야 한다.

## 선택형 로컬 주제 모델

모델 파일은 저장소에 커밋하지 않는다.

```text
backend/app/classification/models/bank_topic_classifier.joblib
```

내부 서버에 `joblib`, `scikit-learn` 및 학습 때와 호환되는 버전을 설치하고 위 경로에 모델을 배치한다. 파일이 없거나 로드에 실패하면 규칙 기반 일반 상담으로 자동 폴백한다.

## 테스트

```powershell
.\.venv\Scripts\python.exe -m pytest backend\tests\test_bank_classifier.py -q
```
