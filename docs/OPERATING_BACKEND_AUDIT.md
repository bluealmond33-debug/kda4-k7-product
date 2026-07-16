# K7 운영 백엔드 데이터 통합 감사

## 감사 대상과 증거

- Railway service: `kda4-k7-backend`
- GitHub source: `HeeChang50/kda4-k7-backend`
- 운영 branch: `main`
- 운영 commit: `9f3c4da57a9cc12813f483093d51088037c23595`
- Railway deployment: `09fe8b9c-ba9f-4f65-b503-95d84f4e2aa0`
- 감사 방식: Railway 실행 컨테이너의 `/app/app`을 읽기 전용으로 확인

이 문서는 이희창 저장소나 운영 서비스를 직접 수정한 기록이 아니다. 배포된 코드와 공개 API를 읽어 데이터 거버넌스 경계를 검수한 결과다.

## 확인된 현재 처리

### 활성 `mvp-1.0`

`app/routers/mvp.py`의 `POST /api/v1/calls`는 다음 순서로 동작한다.

```text
완성 음성 파일 전체 수신
→ audio.read()로 전체 바이트 로드
→ Whisper STT
→ GPT 분석
→ judge에는 중립 placeholder 감정 전달
→ ConsultationCard 감정은 unavailable
→ PostgreSQL 저장
→ 201 응답
```

따라서 현재 구현은 통신사 전화망이나 WebSocket 스트리밍이 아니라 **완성 음성 파일 일괄 처리**다.

활성 상담카드가 가짜 감정 점수를 내보내지 않고 `unavailable`을 사용하는 것은 올바르다.

### 레거시 데모 API

`app/routers/pipeline.py`에서 다음 경로는 텍스트를 `bytes`로 바꿔 임시 난수 감정 함수에 전달한다.

- `/analyze-text`
- `/emotion`
- `/summarize`

`app/services/emotion.py`는 실제 음향 모델이 아니라 입력 바이트의 SHA-256을 시드로 사용하는 의사난수 스텁이다. 음성 파일을 받는 `/analyze`, `/briefing`도 같은 스텁을 사용하므로 “음성을 입력받는다”는 사실만으로 실제 감정 모델이 되는 것은 아니다.

이 경로들은 기존 소비자를 깨지 않기 위해 유지할 수 있지만 다음 규칙을 적용한다.

1. 활성 `mvp-1.0` 상담카드의 `completed` 감정으로 승격하지 않는다.
2. UI나 발표에서 학습된 음성 감정 모델 결과라고 설명하지 않는다.
3. Vercel은 레거시 `/summarize`가 아니라 `/api/v1/calls` 결과를 사용한다.
4. 실제 음성 감정 모델을 받기 전에는 `unavailable`을 유지한다.

## 발견된 계약 차이

실제 한국어 WAV 운영 테스트:

- POST: `201`
- GET: `200`
- call_id 일치
- 상담 내용 일치
- 유일한 차이:
  - POST `duration_sec`: `10.100000381469727`
  - GET `duration_sec`: `10.1`

원인은 STT가 반환한 이진 부동소수점 값과 PostgreSQL `numeric(10,3)` 저장 정밀도의 차이다.

## 운영 백엔드 최소 수정

`app/routers/mvp.py`에서 `TranscriptResult`를 만들기 전에 저장 정밀도와 동일하게 반올림한다.

```python
duration_sec = round(float(transcribed.duration_sec or 0), 3)
```

그리고 응답에 같은 값을 사용한다.

```python
transcript=TranscriptResult(
    text=transcribed.text,
    stt_model="whisper-1",
    duration_sec=duration_sec,
)
```

이 변경은 STT·GPT·judge·RAG 로직을 건드리지 않는다. POST 응답과 PostgreSQL 재조회가 동일한 계약 값을 사용하게 만드는 데이터 경계 수정이다.

## 실제 음성 감정 모델 연결 조건

실제 모델이 준비되면 입력은 반드시 원본 `audio_bytes`여야 한다.

```text
audio_bytes
→ 실제 음성 감정 모델
→ 점수·단계·근거
→ MvpEmotionResult(status="completed", ...)
→ ConsultationCard
```

STT 텍스트, 텍스트 키워드, 텍스트 해시 결과를 `completed`로 저장하지 않는다.

이찬희 `lch`의 `persist_pipeline_result()`는 실제 감정 결과에 `emotion_source="audio"`가 없으면 거절한다. 운영 백엔드가 같은 경계를 직접 구현하거나 해당 통합 함수를 이식해야 한다.

## 최종 인수 조건

- [x] 운영 POST/GET 경로 존재
- [x] PostgreSQL `connected`
- [x] 계약 버전 `mvp-1.0`
- [x] 기존 8개 POST 경로 유지
- [x] 실제 음성 POST 201·GET 200
- [ ] `duration_sec` 정규화 반영 후 POST/GET 전체 동일
- [ ] Vercel이 `/api/v1/calls`를 호출
- [ ] Vercel이 통합 상담카드 응답을 표시
- [ ] 실제 감정 모델 수령 전 `unavailable` 유지
- [ ] 실제 감정 모델 연결 시 음성 입력 출처 검증
