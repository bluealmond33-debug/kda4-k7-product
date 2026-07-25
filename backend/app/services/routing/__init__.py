"""상담 라우팅 분류기 — 전형진(nangom, jeon 브랜치)님 산출물 벤더링.

원본: bluealmond33-debug/kda4-k7-hippo `07 Outputs/routing-demo/`. LLM 호출 없이 규칙 +
로컬 sklearn 모델로 상담을 긴급(EMERGENCY)/단순업무(SIMPLE)/일반(GENERAL) 3단계로 분류하고,
카드 ARS 세부 업무(S1xx)까지 라우팅한다. 데모 서버(server.py, SQLite+SSE)는 제외하고 핵심
분류 로직 3개 파일만 가져왔다.

- classifier.py: classify_transcript() — 규칙 기반 3단계 분류(외부 파일 의존 없음)
- ars_catalog.py: 카드 ARS 단순업무 카탈로그(17종)
- topic_classifier.py: 로컬 sklearn 주제 분류기 — models/bank_topic_classifier.joblib 필요
  (용량·재학습 이유로 git 제외, 없으면 규칙 기반 부분만 동작하고 이 3단계는 스킵됨)

우리 백엔드에서는 app/services/routing_classifier.py의 얇은 어댑터를 통해 쓴다.
"""
