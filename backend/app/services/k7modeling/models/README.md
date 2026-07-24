# emotion_temperature_demo_final_v4.joblib 필요

이 폴더에 박정운(Jeongwoon Park)님의 `emotion_temperature_demo_final_v4.joblib`를 받아 놓으면
`app/services/emotion.py`가 자동으로 실제 모델을 쓴다. 없으면 조용히 이전 스텁/unavailable로
폴백한다(에러 안 남).

- 파일이 GitHub에 없는 이유: `kda4-k7-project1` about_v4.1_model 브랜치의
  `v4.1_github/modeling/artifacts/models/README.md` 참고 — 라이선스(CC BY-NC-SA 4.0, 연구용)와
  용량(14,121,579 bytes) 문제로 의도적으로 제외됨. 박정운님께 직접(Slack DM, 공유 드라이브 등)
  요청해서 받아야 한다.
- 기대 경로: `app/services/k7modeling/models/emotion_temperature_demo_final_v4.joblib`
  (다른 위치에 두려면 .env의 `EMOTION_TEMPERATURE_MODEL_PATH`로 지정)
- SHA-256 검증: `88e2c3f3e0d85497a3e59a84ac42835ccf8620aab999de27cdb9ff92fc27d4ac`
  (다르면 변조/버전 불일치로 보고 로드하지 않음 — `.env`의
  `EMOTION_TEMPERATURE_MODEL_SHA256`으로 다른 해시를 허용할 수 있음)
- 모델 카드 기준: 발표 데모/연구용 shadow 전용, 실제 고객 자동 판단·라우팅 금지.
