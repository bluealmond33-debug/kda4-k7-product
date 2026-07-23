# 상담 준비 카드 "전화 요약" 발화 기반화 (customer_request_points)

- 작성일: 2026-07-23
- 작성: 이희창 (통합승인책임자)
- 관련: 7/29 팀 발표·제출

## 배경

7/23 시연 테스트에서 발견했다. 상담 준비 카드의 **"전화 요약 · 고객 발화 STT 요약"** 블록
3줄이 **백엔드와 무관한 프론트 하드코딩 픽스처**다.

- 출처: `kda4-k7-product/src/data/demoContent.ts:220` `SUMMARY_POINTS`
- 소비: `src/hooks/useCallFlow.ts:1276` — `SUMMARY_POINTS[incoming]` → `vm.summaryPoints`
- 렌더: `src/components/desktop/PrepCard.tsx:146`, `src/components/desktop/ActiveCall.tsx:442`
- 키: 상단 수신 유형 토글(`일반`/`긴급`/`이관`). **통화 내용이 아니라 토글이 내용을 결정한다.**

mvp-1.0 계약(`app/contracts.py`의 `ConsultationCard`)에 해당 필드가 아예 없어서, 구조적으로
발화가 반영될 수 없다.

실제로 재현했다. 해외 카드 부정결제 음성을 태웠는데 이 블록에 "주택담보대출 만기 연장 가능
여부 확인 요청"이 떴다. 같은 카드의 요약·부서·감정온도·사고징후·근거발화는 모두 실제 통화를
정확히 반영한다. 이 블록만 딴 얘기를 한다.

라벨이 **"고객 발화 STT 요약"** 이라 특히 위험하다. 화면이 "이건 고객이 한 말을 요약한
것"이라고 명시하는데 실제로는 고정 문구다.

## 목표

"전화 요약" 블록을 실제 발화에서 LLM이 추출한 값으로 바꾼다.

### 비목표 (이번 범위 밖 — 아래 "미해결" 참조)

- **유의사항(`PREP_ITEMS`)** — 상담 규정에서 오는 항목("확정 표현 금지", "녹취 고지")이
  섞여 있어 고정이 오히려 맞고, 4개 고정이 통화연결 게이트(`PREP_LEN = 4`)와 엮여 있다.
- **오프닝 문장(`suggested_opening` 성격)** — 같은 클래스의 픽스처지만 별도 필드가 필요하다.

## 사전 측정 (2026-07-23)

프로덕션 코드를 건드리지 않고 스크립트로 16회 실측했다. 기존 `_SYSTEM_PROMPT`의 JSON
스키마에 필드 한 줄만 얹은 변형으로 호출했다.

| 발화 | 정상 추출 | 빈 배열 | JSON 파싱 실패 |
|---|---|---|---|
| 시연 음성(정상) | 8/8 | 0 | 0 |
| "여보세요"(거의 무발화) | 2/4 | 2/4 | 0 |
| 모호한 발화 | 4/4 | 0 | 0 |

**JSON 파싱 실패 0/16.** `local_llm.py`가 Ollama를 `format: "json"`으로 호출해 생성이 유효
JSON으로 제약되기 때문이다. 정상 발화 예시:

```
['부정 해외 결제 거래 확인', '즉시 거래 정지 요청', '본인 확인 완료']
```

측정에서 나온 설계 입력 두 가지:

1. **불릿 접두사가 섞인다.** 일부 회차가 `'- 해외 무단 결제 거래 확인'`처럼 `- `를 붙여
   반환했다 → 정제 필요.
2. **모호한 발화는 "성공"하지만 내용이 빈 껍데기다.** `['문의 내용 파악 필요', '구체적 정보
   요청']` — 빈 배열보다 나쁘다. 그럴듯한데 상담사가 얻을 정보가 없다 → 프롬프트에서
   "확인되는 항목이 없으면 빈 배열"을 명시해야 걸러진다.

## 결정

### 필드명·의미

`customer_request_points: list[str]` — **고객이 발화에서 요구·진술한 것의 분해**.

블록 라벨("고객 발화 STT 요약"), 화면상 위치, 기존 픽스처의 성격이 모두 이 의미를 가리킨다.
기존 픽스처도 "주택담보대출 만기 연장 가능 여부 **확인 요청**"처럼 고객 요구를 적고 있었다.

> 대안으로 팀이 `consultation_card.schema.json`에 이미 정의한 `recommended_actions`
> (상담사 액션: "거래내역 확인", "필요 시 사고대응팀 이관")도 검토했다. 어휘 재사용이라는
> 장점이 있으나 이 블록의 라벨·의미와 맞지 않는다. 상담사 액션은 별도 블록이 필요하며
> 이번 범위가 아니다.

`consultation_card-1.0` 계약 전체로 갈아타는 것도 제외했다. 필수 필드가 19개이고, 현재 UI는
그 계약을 전혀 읽지 않는다(`src/`에 소비처 없음). 실제 사용 중인 계약은
`mvp_call_response`(mvp-1.0)뿐이다.

### 계약 버전

`schema_version`을 **`mvp-1.0` → `mvp-1.1`** 로 올린다.

`src/services/consultationContract.ts:22`의 `exactKeys`는 키 개수와 이름을 정확히 비교하는
**양방향 파괴적** 검증이다. 필드를 추가하면 (구프론트+신백엔드), (신프론트+구백엔드) 양쪽 다
깨진다. 버전을 올려두면 불일치가 모호한 파싱 실패 대신 명시적 버전 에러로 드러난다.

파서가 값을 고정 검증하고 있으므로(`consultationContract.ts:174` — `!== "mvp-1.0"`이면
`fail`) 이 줄도 함께 바꾼다. 백엔드에서 버전 문자열이 박힌 곳은 세 군데다:

- `app/contracts.py:83` — `MvpCallResponse.schema_version`
- `app/contracts.py:96` — `MvpHealthResponse.contract_version`
- `app/main.py:48` — `/health` 응답 리터럴

### 폴백

**빈 배열이면 블록을 그리지 않는다.**

측정상 LLM 호출 실패로 이 필드만 비는 경우는 없다. `customer_request_points`는 `summary`·
`department`를 만드는 **바로 그 단일 호출**에 얹히므로, 호출이 실패하면 카드 자체가 이미
실패한다. 빈 배열은 "말이 거의 없는 통화"에서만 나오고, 그때는 채울 내용이 없는 게 사실이다.

억지로 채우면 위 측정 2번처럼 빈 껍데기가 된다. 팀 원칙 "스텁을 진짜 모델인 척 하지 않는다"
(`MvpEmotionResult` 독스트링)와도 일관된다.

## 변경 범위

### 백엔드 (`HeeChang50/kda4-k7-backend`)

| 파일 | 변경 |
|---|---|
| `app/schemas.py` | `GptAnalysis.customer_request_points: list[str] = []` |
| `app/services/local_llm.py` | 프롬프트 JSON 스키마에 필드 + "없으면 빈 배열" 규칙 + 정제 |
| `app/services/gpt_analysis.py` | OpenAI 경로 동등 처리 |
| `app/services/stub_models.py` | 스텁 경로 동등 처리 |
| `app/contracts.py` | `ModelConsultationResult`·`ConsultationCard`에 필드, 버전 문자열 2곳 |
| `app/main.py` | `/health`의 `contract_version` 리터럴 |
| `app/services/mvp_adapter.py` | `to_model_consultation_result`에서 전달 |

`to_consultation_card`는 `ConsultationCard(**analysis.model_dump(), ...)` 형태라
`ModelConsultationResult`에 필드를 넣으면 자동 전파된다.

**정제 규칙** (`local_llm.py`에 순수 함수로 분리):

1. 리스트가 아니면 `[]`
2. 각 항목: 선행 `-`, `•`, `*`, 공백 제거 후 `strip()`
3. 빈 문자열 제거
4. 중복 제거(입력 순서 유지)
5. 항목당 100자 초과 시 제외
6. 최대 4개로 절단

### 프론트 (`bluealmond33-debug/kda4-k7-product`)

| 파일 | 변경 |
|---|---|
| `database/contracts/mvp_call_response.schema.json` | 필드 + 버전 |
| `database/contracts/examples/mvp_call_response.example.json` | 예시 값 |
| `src/services/consultationContract.ts` | `exactKeys` 목록 + 배열 검증 + 버전 핀(174행) |
| `src/services/types.ts` | `ConsultationCardResponse` 타입 |
| `src/hooks/useCallFlow.ts:1276` | `SUMMARY_POINTS[incoming]` → 백엔드 값 |
| `src/components/desktop/PrepCard.tsx:146` | 빈 배열이면 블록 미표시 |
| `src/components/desktop/ActiveCall.tsx:442` | 같음 — 두 번째 렌더 지점 |

`summaryPoints`는 준비 카드(`PrepCard`)와 통화 중 화면(`ActiveCall`) **두 곳**에서 렌더된다.
한쪽만 고치면 통화 단계에서 다시 픽스처가 보인다.

예제 JSON을 빠뜨리면 `npm run validate:contracts`와 mock 경로가 깨진다
(`src/services/consultation.ts`가 `mvp_call_response.example.json`을 실제로 파싱한다).

mock 경로도 같은 필드를 쓴다. `useCallFlow`의 `consultationResponse` 초기값이
`getDemoConsultationCard()`(예제 JSON 파싱)이므로 예제 JSON에 필드를 넣으면 mock에도 값이
생긴다. 따라서 `SUMMARY_POINTS` 폴백은 불필요하다 — import만 끊고 상수 정의는 남긴다.

## 테스트

**백엔드**
- 정제 함수 유닛테스트: 접두사 `- `/`• `, 중복, 5개 이상 절단, 빈 배열, 100자 초과, 비리스트
- 계약 직렬화: `ConsultationCard`가 필드를 포함하고 기본값이 `[]`인지
- 기존 76 passed 유지

**프론트**
- 파서 테스트: 필드 있음 / 없음(에러) / 타입 오류(에러) / 빈 배열 허용
- `npm run check` 통과

**E2E**
- 시연 WAV 재투입 → "전화 요약" 3줄이 통화 내용과 일치하는지 확인
- 수신 토글을 `일반`으로 두고도 내용이 통화를 따라가는지 (원래 버그의 회귀 검증)

## 배포

`exactKeys`가 양방향 파괴적이라 **백엔드·프론트를 함께 재기동**해야 한다. 둘 다 이희창
랩탑에서 도는 호스트 데모라 실제 위험은 낮지만, 팀원이 `192.168.11.135:5173`에 붙어 있는
동안은 그 순간 깨진다. 재기동 전에 공지한다.

## 미해결

같은 시연 테스트에서 확인됐으나 이번 범위 밖:

- **오프닝 문장이 픽스처다** — "이 문장으로 통화를 여세요: *네 고객님, 주택담보대출 만기 연장
  문의 주셨죠*". 상담사에게 **틀린 주제로 통화를 열라고 지시**한다. 시연 리스크는 이번 건보다
  클 수 있다. 출처 `demoContent.ts:183`. 팀 계약의 `suggested_opening`에 대응.
- **유의사항도 픽스처다** — "확정 표현 금지: '연장 확정' 단정 대신…"이 대출 시나리오를 전제한다.
- **RAG 오매칭** — 카드 해외 부정결제 질의에 외환거래약관이 검색된다("해외" 키워드로 FX
  소프트필터가 잘못 걸림). CRD가 나와야 한다.
- **`/briefing` 라우팅 오분류** — 긴급 건이 `GENERAL`·`기타·복합`으로 분류된다. 프론트가 쓰는
  `/api/v1/calls` 경로는 정상이라 시연 화면에는 안 드러난다.
- **문서 불일치** — `kda4-k7-hippo/_system/CURRENT_STATE.md`가 pgvector 실활성화 완료로
  적고 있으나 실제 런타임은 FAISS다. 도커는 안 쓰기로 확정됐으므로 문서를 실제에 맞춰야 한다.
