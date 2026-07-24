# bank_topic_classifier.joblib 필요 (선택)

전형진(nangom)님의 로컬 은행 주제 분류 모델. 이 파일이 있으면 `classify_transcript()`의
3단계(로컬 ML 주제 분류)가 활성화되고, 없으면 규칙 기반 1·2단계(긴급/단순업무 판정)만
동작한다(정상 폴백, 에러 없음).

- 학습: 은행 라벨 40,000건 / 검증: 4,995건
- 전체 정확도 74.2%, 마진≥0.75 자동분류 구간 정확도 90.4%
- 모델 종류: char n-gram TF-IDF + LinearSVC (`char_wb_tfidf_linear_svc`)
- 완전 오프라인(scikit-learn 1.9.0), 외부 API 호출 없음
- 개인정보 미포함이지만 용량·재학습 이유로 git 제외 — 이 폴더에 배치(gitignore됨)

기대 경로: `app/services/routing/models/bank_topic_classifier.joblib`

> 2026-07-20: 전형진님께 파일 수령·배치 완료(로컬). 이 랩탑에서 로드·주제분류 활성화 검증됨
> (`get_model_status().available == True`). 다른 PC/서버 배포 시 이 파일을 별도로 복사해야 함.
