# 전형진 님에게 보낼 금융 모델 연동 요청

아래 내용을 Slack에 그대로 전달할 수 있습니다.

---

형진님, 공유해주신 구조대로 연결 경계를 반영했습니다.

형진님 모델은 OpenAI 전체 대체가 아니라 **STT 텍스트 → 금융 요약·3축 분류 원시 결과**를 담당하고, 제 데이터 통합 어댑터가 이를 K7 `mvp-1.0`의 `business_type`, `department`, `incident_risk`, `risk_reason`, `routing_confidence`로 바꾸는 구조로 가겠습니다.

어댑터가 받는 요청 결과는 우선 다음 네 필드로 고정했습니다.

```json
{
  "summary": "고객이 주택담보대출 만기 연장 가능 여부를 문의함.",
  "task_category": "대출",
  "consulting_situation": "만기 연장 문의",
  "qa_topic": "주택담보대출 만기 연장"
}
```

희창이 형 운영 FastAPI에서 실제 모델 서버를 호출하려면 아래 자료가 필요합니다.

1. 모델 서버 URL과 endpoint
2. 인증 방식 또는 필요한 헤더
3. 요청 JSON 예시(STT 텍스트 필드명 포함)
4. 정상 응답 JSON 한 건
5. 입력 부족·분석 불가 응답 JSON 한 건
6. 서버 오류 응답 JSON 한 건과 HTTP 상태 코드
7. `task_category`, `consulting_situation`, `qa_topic`에서 나올 수 있는 전체 라벨 목록
8. 모델명·모델 버전 값
9. confidence를 제공한다면 필드명, 0~1/0~100 범위, 정확한 의미
10. Railway에서 접근 가능한 주소인지 여부

현재 `routing_confidence`는 모델 성능 점수가 아니라 검토된 업무→부서 매핑 규칙의 신뢰도로 관리하고 있습니다. 모델 자체 confidence가 준비되면 둘을 섞지 않고 별도 의미를 확정해서 연결하겠습니다.

또한 모델 서버가 개인 PC나 사내 내부망에서만 열려 있으면 Railway 운영 백엔드가 직접 호출할 수 없습니다. 시연용이라도 Railway에서 접근 가능한 HTTPS 주소, 승인된 터널/프록시 또는 Railway 별도 서비스 중 하나가 필요합니다.

전체 라벨 목록을 받으면 `database/mvp/model_postprocessing.v1.json`의 매핑을 실제 라벨에 맞게 최종 확정하겠습니다. 처음 보는 라벨은 임의 부서로 보내지 않고 오류로 잡도록 구현했습니다.

---
