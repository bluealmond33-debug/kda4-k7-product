# KARI-NA (Kiwoom Academy Response Innovation · No ARS) — 금융 콜센터 AI 백엔드

K7팀 프로젝트 "KARI-NA" — Kiwoom Academy Response Innovation, No ARS. ARS에 갇히지 않는
콜센터. 고객 상담 음성을 받아
**완전 온프레미스**로 STT → 요약/분류(텍스트) → 감정온도(음향) → 융합 판단 → RAG를
거쳐 상담사용 브리핑 카드를 자동 생성하는 FastAPI 백엔드다.

## 아키텍처

```
고객 음성
  │
  ├─▶ STT (faster-whisper, GPU, 로컬)
  │      │
  │      ├─▶ 요약·분류·위험플래그 (Ollama exaone3.5, 로컬)  ─┐
  │      └─▶ 텍스트 감정 (content_emotion/situation_severity) ─┤
  │                                                             ├─▶ 정책 결합기(fusion) ─▶ judge ─▶ RAG ─▶ 브리핑 카드
  └─▶ 음향 감정온도 (eGeMAPS+LightGBM, 박정운 모델, 로컬)  ────┘
```

- **온프레미스**: STT·LLM·임베딩·DB 전부 이 서버 안에서 처리, 클라우드 의존 0(Railway는 폴백용으로만 유지)
- **두 채널 감정 분석**:
  - 음향(`app/services/emotion.py`) — 목소리 톤·격앙도. 박정운(Jeongwoon Park)님의 emotion_temperature 모델(eGeMAPS 88특징+LightGBM, ordinal low/medium/high)
  - 텍스트(`app/services/text_emotion.py`) — 상담 내용·상황 심각도. voice_tone은 항상 `unknown_text_only`로 고정(텍스트로 목소리를 추측하지 않음)
- **융합**(`app/services/fusion.py`) — 에스컬레이션 전용 정책 결합기. judge()의 순수 규칙 판정은 그대로 두고, 텍스트가 위험을 시사하면 `NONE`→`MEDIUM`으로만 올림(내리지 않음)

## 실행

```bash
cd backend
python -m venv .venv          # Python 3.12 권장
./.venv/Scripts/python.exe -m pip install -r requirements.txt

cp .env.example .env          # 값 채우기 (.env.example에 각 항목 설명 있음)
./.venv/Scripts/python.exe -m uvicorn app.main:app --host 0.0.0.0 --port 8000
```

`GET /health` 로 상태 확인 (DB 연결 여부 포함).

## 온프레미스 모드

`.env`에 `USE_LOCAL_MODELS=true`로 켜면 OpenAI 대신:
- STT: faster-whisper (`local_whisper_model`, 기본 `large-v3-turbo`)
- 분석/텍스트감정: Ollama (`ollama_model`, 기본 `exaone3.5:7.8b`) — 로컬에 Ollama 서버 필요

> 이 랩탑은 Windows 스마트 앱 제어가 서명 안 된 av(PyAV) DLL을 차단해서, STT는 ffmpeg
> 서브프로세스로 직접 디코딩한 배열을 `model.transcribe()`에 넘기는 방식으로 우회한다
> (`app/services/local_stt.py`). 스마트 앱 제어(끄면 재설치 전까지 못 되돌림)는 건드리지 않는다.

## 감정온도 모델(음향) 활성화

`app/services/k7modeling/`에 박정운님 추론 코드가 벤더링돼 있지만, **모델 바이너리(.joblib,
14MB)는 라이선스·용량 문제로 git에 없다.** 아래 경로에 파일을 받아 두면 자동 활성화(없으면
스텁으로 조용히 폴백):

```
app/services/k7modeling/models/emotion_temperature_demo_final_v4.joblib
```

SHA-256: `88e2c3f3e0d85497a3e59a84ac42835ccf8620aab999de27cdb9ff92fc27d4ac`

## 팀 계약

- `app/schemas.py` — 우리 자체 파이프라인 스키마 (자유롭게 확장 가능)
- `app/contracts.py` — **이찬희 파트(kda4-k7-product)와 공유하는 mvp-1.0 계약** — 프론트가
  exactKeys로 엄격 검증하므로 필드 추가·변경 시 팀 논의 필요. `/api/v1/calls`가 이 계약을 씀

## 주요 폴더

```
app/
  routers/       pipeline.py(자체 API), mvp.py(팀 mvp-1.0 계약)
  services/      stt, gpt_analysis, emotion(음향), text_emotion, fusion, judge, rag
  services/k7modeling/  박정운 감정온도 모델 추론 코드(벤더링)
tests/           유닛테스트 + K7_TEST_LOCAL_MODELS=1로 게이팅된 통합테스트
```
