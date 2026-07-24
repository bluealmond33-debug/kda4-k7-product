# KARI-NA 실시간 통화 데모 (스트리밍 STT + 개인정보 격리) — 설계 문서

- **작성일**: 2026-07-21
- **대상**: K7팀 KARI-NA MVP
- **목표 발표일**: 2026-07-29
- **선행 문서**: `2026-07-21-karina-docker-deployment-design.md` (이 설계는 그 compose 스택을 확장한다)

## 1. 목적

발표에서 **팀원 한 명이 고객 역할로 "전화"를 걸면, 실시간으로 음성이 전사되어 상담사
대시보드에 자막으로 뜨고, 감정온도·라우팅·위험 카드가 발화마다 라이브로 갱신되는** 모습을
보여준다. 동시에 개인정보(고객 식별·계좌 조회)는 **AI 서버가 접근하지 못하는 별도 격리
서버**에 두어, "AI는 대화 내용만 보고 민감정보 원문엔 손대지 않는다"는 금융 콜센터 아키텍처
메시지를 실물 배선으로 증명한다.

전부 **이 랩탑 안, 같은 와이파이(LAN)** 에서 완결한다. 외부 통신망/공인 IP는 쓰지 않는다 —
온프레미스 원칙(ADR-0007)과 오히려 일치하며, 데모 목적엔 LAN 웹 통화가 가장 안전·현실적이다.

### 현재 코드 기준선 (2026-07-21 확인)
- 백엔드(`backend/`): FastAPI + uvicorn 단일 프로세스. **WebSocket/SSE/스트리밍 전무**, 모든
  오디오 엔드포인트가 whole-file(`await audio.read()`). STT 코어 `app/services/local_stt.py`는
  `ffmpeg 서브프로세스→numpy→WhisperModel.transcribe`로 av(PyAV) 차단을 우회 중.
- 프론트(`kda4-k7-product/`): 단일 페이지 `LiveDemo.tsx` + 상태머신 `useCallFlow.ts`
  (idle→connecting→recording→confirm→prep→active→wrap). `Mode = "sim" | "mic"` 존재하나
  **실제 마이크/WS 없음** — `"sim"`은 대본(`DEMO_UTTERANCE`) 타이머 재생, `"mic"`은 파일 업로드.
  전사는 `TranscriptChunk {text, at, isFinal}` 개념이 이미 있음. 분석 카드는 `ActiveCall.tsx`가 렌더.
- 개인정보: **전부 목업**. DB 스키마엔 `calls/transcripts/consultation_cards`만, 고객/계좌 테이블
  없음. 본인인증·계좌·내역은 프론트 하드코딩(`CUSTOMER.authAnswers`, `ACCOUNTS`, `HISTORY`).

## 2. 확정된 설계 결정

| # | 결정 | 값 |
|---|------|-----|
| 1 | 통화 방식 | **웹 통화 페이지**. 고객 웹앱 마이크 → `wss` WebSocket으로 랩탑에 오디오 스트리밍. 외부 통신망 불필요 |
| 2 | 스트리밍 STT | **문장 단위 세그먼트**. 순수 파이썬 RMS 에너지 VAD(numpy)로 발화 경계 감지 → 발화 종료 시 그 구간만 기존 whisper 코어로 전사, 한 줄씩 확정 출력. native VAD(.pyd)는 Smart App Control 차단 위험이라 회피 |
| 3 | 개인정보 | **컨테이너 분리**. 별도 `pii-service` + 별도 DB 스키마. **ai-backend는 pii-service를 호출하지 않음** |
| 4 | 마이크 secure-context | **mkcert로 LAN https/wss**. 팀원이 자기 기기에서 열어도 `getUserMedia` 동작 |
| 5 | 분석 분리 | 발화당 **빠른 신호**(감정온도·라우팅·위험)는 실시간, **LLM 요약(exaone)** 은 debounce로 분리 |
| 6 | 무대 폴백 | 기존 `"sim"` 대본 모드 유지 — 라이브 실패 시 원터치 전환 |
| 7 | 스트리밍 라이브러리 | whisper_streaming/WhisperLive **비채택** (av 의존 → Smart App Control 차단과 충돌) |

## 3. 아키텍처

```
                        (mkcert https/wss, 전부 LAN)
 [customer-web ?role=customer]                        ┌─────────────────────────────┐
   마이크→AudioWorklet→Int16 16k  ──wss /ws/call──►    │  ai-backend (기존 backend/)  │
                                                       │   · ws/call.py (레지스트리) │
 [agent-web  (기존 kda4-k7-product)]                    │   · streaming_stt (webrtcvad)│
   라이브 자막 + 감정/라우팅/위험 ◄──wss (transcript/  │   · live_signals (빠른 신호) │
   + AI 요약 카드                    signals/summary)   │   · exaone 요약 (debounce)  │
        │                                              └─────────────────────────────┘
        │ (상담사 인증 성공 후에만, REST)                          │ RAG(pgvector)
        └──https──► ┌────────────────────┐                        ▼
                    │  pii-service (신규) │              [db: pgvector/pgvector:pg17]
                    │  고객·계좌·본인인증  │◄──pii 스키마──   k7_mvp 스키마 / pii 스키마
                    └────────────────────┘
```

선행 도커 설계의 `db`/`ollama`/`backend`/`frontend` 서비스에 **`pii-service`를 추가**하고,
`backend`에 WS를, `frontend`에 고객 뷰를 더한다. 컨테이너 간 통신은 compose 서비스명으로,
브라우저는 published 포트로 접속(mkcert https).

## 4. 컴포넌트별 상세 설계

### 4.1 ai-backend — WebSocket 계층 (`app/ws/call.py`, 신규)
- 엔드포인트: `WS /ws/call/{call_id}?role=customer|agent`.
- **CallSession 레지스트리**(인메모리): `call_id → { customer_ws, agent_ws[], transcript[], audio_buf, seq }`.
  고객이 보낸 전사/신호를 같은 `call_id`의 상담사 소켓들로 팬아웃.
- 메시지 프로토콜:
  - customer→server: **바이너리 프레임** = Int16 PCM 16k mono, 20ms(=320 sample=640 byte) 단위.
    연결 직후 JSON `{type:"hello", call_id}` 1회.
  - server→agent(JSON): `{type:"transcript", seq, speaker:"customer", text, isFinal, at}` /
    `{type:"signals", emotion:{score,label}, routing:{title,code}, risk:{label,reasons}}` /
    `{type:"summary", headline, bullets[]}` / `{type:"status", phase}`.
  - server→customer(JSON): `{type:"status", state:"connected|active|ended"}` 최소.
- 서버 시작: 기존 uvicorn 그대로. **TLS는 §4.5**.

### 4.2 ai-backend — 스트리밍 STT (`app/services/stream_segmenter.py` + `streaming_stt.py`, 신규)
- 입력이 이미 raw PCM 16k라 **ffmpeg 디코드 불필요** → av 차단 이슈 원천 회피.
- **세그먼터**(`stream_segmenter.py`, numpy만): 20ms 프레임 RMS로 voiced/silence 판정. 연속 voiced로
  발화 시작, **trailing silence ~700ms** 로 종료, voiced 길이 <300ms 발화는 버림, 최대 ~15s 강제 컷.
  webrtcvad/silero 같은 네이티브 VAD(.pyd)는 av와 같은 Smart App Control 차단 위험이 있어 **비채택**.
- **전사**(`streaming_stt.py`): 발화 Int16 → `float32/32768.0` → **기존 싱글턴** `local_stt._get_model()`
  의 `WhisperModel.transcribe(audio, language="ko")` → 텍스트 확정 → `{transcript,isFinal:true}` emit.
- v1은 **final만**(깜빡임 없음). interim 부분전사는 P2. Linux 컨테이너에선 webrtcvad로 업그레이드 여지.

### 4.3 ai-backend — 빠른 신호 vs 느린 요약 (`app/services/live_signals.py`, 신규)
- **발화당(핫패스, 실시간)**:
  - 감정온도: 발화 오디오(numpy) → 기존 `emotion`/`k7modeling` 모델. *어댑터 필요* — 현재 모델이
    `audio_bytes`(wav)를 받으므로, 발화 PCM을 인메모리 wav로 감싸거나 numpy 수용 경로 추가.
  - 라우팅: `routing_classifier`(전형진 규칙+sklearn)에 전사 텍스트 투입 — 빠름.
  - 위험: 경량 키워드 패스(즉시). 근거 있는 최종 위험등급(EXAONE fusion)은 요약과 함께 debounce.
- **누적(콜드패스, debounce)**: exaone 요약/briefing을 N발화마다 또는 유휴 ~4s 시 1회 실행 →
  `{summary}` push. **핫패스와 분리**해 GPU·지연 보호(§6 GPU 리스크).

### 4.4 pii-service (신규 컨테이너, 경량 FastAPI)
- 위치: `Documents/금융콜센터AI/pii-service/`, 자체 Dockerfile, compose에 서비스 추가.
- DB: 같은 `db` 컨테이너 안의 **별도 `pii` 스키마 + 전용 DB 롤**(`pii_svc`). ai-backend의 DB 유저는
  `pii` 스키마에 **GRANT 없음** → 컨테이너 하나로도 실제 접근 경계가 생김(별도 DB 컨테이너까진 불필요).
  init SQL로 스키마·롤·데모 고객(이정민 등) 시드.
- 엔드포인트:
  - `POST /verify` — 본인인증(phone/birth/account 뒷자리) → `{verified, customer_id}`.
    프론트 하드코딩 `runVerify` 대체.
  - `GET /customers/{id}` — 마스킹 고객정보. `GET /customers/{id}/accounts`·`/history`.
    프론트 `ACCOUNTS`/`HISTORY` fixtures 대체.
- **ai-backend는 이 서비스를 호출하지 않는다.** 오직 agent-web이 상담사 인증 성공 후 호출.

### 4.5 프론트엔드 (`kda4-k7-product`)
- **고객 뷰**: `App.tsx`에서 `?role=customer` 감지해 분기(라우터 불필요). `CustomerCall.tsx`:
  전화 UI + `getUserMedia` → AudioWorklet(`public/pcm-worklet.js`)로 16k Int16 다운샘플 →
  `wss://<host>:8000/ws/call/{call_id}?role=customer` 전송.
- **상담사 뷰**(기존 `ActiveCall.tsx`): `services/liveClient.ts`(WS 클라이언트, 재연결 포함) 신설.
  - 중앙 컬럼에 **`LiveTranscript` 패널** 추가 — `transcript` 메시지를 `TranscriptChunk`로 append.
  - 기존 감정/라우팅/위험 pill·"AI 사전요약" 카드를 타이머 목업 대신 `signals`/`summary` 메시지로 구동.
  - 본인인증/계좌 UI → `pii-service` 호출로 교체(`VITE_PII_API_BASE_URL`).
- **`Mode`**: `"sim"`(대본, **무대 폴백 유지**) 그대로 두고 `"live"` 경로 신설. 기존 `"mic"`(파일업로드)은 유지 or 정리.

### 4.6 mkcert https/wss
- `mkcert -install` 후 `localhost` + 랩탑 LAN IP 대상 인증서 발급.
- 프론트 Vite dev를 https로, backend uvicorn을 `--ssl-keyfile/--ssl-certfile`로 기동(→ wss).
- 대안: 단일 리버스 프록시(Caddy)로 TLS 종단 — 단순 데모엔 과할 수 있어 v1은 두 엔드포인트 직접 TLS.

## 5. 데이터 흐름 (한 통화)

1. 상담사 대시보드 "라이브 대기" → agent WS 연결.
2. 고객 `?role=customer` 페이지 "통화" → customer WS + 마이크 시작.
3. 발화 → Int16 PCM 프레임 스트리밍 → 서버 VAD 세그먼트.
4. 침묵=발화 종료 → 구간 전사 → `{transcript}` agent push → 자막 한 줄 추가.
5. 동시에 발화오디오→감정온도, 텍스트→라우팅/위험 → `{signals}` push → 카드 갱신.
6. 누적 전사 debounce → exaone 요약 → `{summary}` push → "AI 사전요약" 갱신.
7. 상담사 본인인증 입력 → agent-web → pii-service `/verify` → 성공 시 `/accounts`·`/history` 로드
   (ai-backend 경유 안 함).
8. 통화 종료 → 전사·카드 `calls` DB 저장.

## 6. 에러 처리 · 무대 안전장치

- 🔴 **마이크 secure-context** — mkcert https/wss로 해결(§4.6). 발표 전 각 기기에서 마이크 허용 확인.
- **sim 원터치 폴백** — 라이브 삐끗 시 대본 데모로 전환(기존 `"sim"`).
- **WS 끊김** — `call_id` 유지 자동 재연결(고객·상담사 양쪽).
- 🟠 **GPU 8GB 빠듯** — STT(turbo)+exaone 동시. 완화: 요약 debounce·throttle, 감정 LightGBM은 CPU.
  발표 전 부하 리허설 필수.
- **긴 발화** — VAD max-duration 강제 컷으로 무한 대기 방지.
- **pii-service 다운** — 프론트가 기존 fixtures로 폴백 → 인증/계좌 화면 안 죽음.

## 7. 테스트

- 단위: VAD 세그먼트 경계(합성 PCM+침묵), live_signals(알려진 오디오/텍스트→기대 카드),
  pii `/verify`(정답/오답 자릿수).
- 통합: 2탭(고객/상담사) end-to-end. **마이크 대신 저장된 한국어 wav를 주입**해 재현성 확보.
- 무대 리허설 체크리스트: 마이크 권한/secure context · GPU 부하 · sim 폴백 · 같은 와이파이 · 재연결.

## 8. 스코프 단계 (7/29 안전)

- **P0 (핵심 wow)**: 마이크→wss→VAD 스트리밍 STT→상담사 자막 라이브 + 감정/라우팅/위험 카드 라이브.
  sim 폴백 유지. (4.1·4.2·4.3 핫패스·4.5 고객뷰/자막·4.6)
- **P1 (아키텍처 스토리)**: pii-service 분리, 본인인증/계좌 실제 호출, compose에 서비스 추가. (4.4)
- **P2 (폴리시)**: LLM 요약 라이브 갱신 고도화, 통화 UI 연출(발신/링), interim 부분전사.

## 9. 미해결 / 리스크

- 감정 모델 발화당 최소 오디오 길이 — 너무 짧은 발화는 신뢰도 낮음(어댑터에서 최소 길이 가드).
- 한국어 VAD 튜닝(RMS 임계·silence 임계·min voiced 길이) 실측 필요 — 발표 환경 소음 수준에 맞춰 조정.
- GPU 동시 부하 실측(STT turbo + exaone) — 안 되면 요약을 CPU/less-frequent로.
- mkcert 인증서를 팀원 기기에 어떻게 신뢰시킬지(각 기기 rootCA 설치 vs 발표 기기 집중).
