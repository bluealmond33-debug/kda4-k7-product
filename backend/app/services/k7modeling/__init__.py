"""K7 call-center modeling utilities.

Vendored from 박정운(Jeongwoon Park)의 bluealmond33-debug/kda4-k7-project1
about_v4.1_model 브랜치(PR #6, 2026-07-18, 미병합) — emotion.py의 실제 추론 경로로 쓰기 위해
predict-demo-emotion-v4 의존 모듈만 그대로 가져왔다. 학습·라벨링용 코드가 대부분이라 죽은 코드가
많지만, 내부 상대 import가 서로 얽혀 있어 필요한 함수만 발췌하지 않고 통째로 들여왔다.
모델 바이너리(emotion_temperature_demo_final_v4.joblib, SHA-256
88e2c3f3e0d85497a3e59a84ac42835ccf8620aab999de27cdb9ff92fc27d4ac)는 의도적으로 GitHub에
없으므로(대회/연구용 CC BY-NC-SA 4.0) 별도로 받아 app/services/k7modeling/models/ 아래 둬야 한다.
"""

__version__ = "0.1.0"

