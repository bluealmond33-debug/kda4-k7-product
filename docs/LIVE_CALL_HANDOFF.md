# KDA 실시간 휴대폰 통화 통합 — 팀·AI 인수인계

공유용 웹 문서: <https://k7-live-call-handoff.theonewhogazes.chatgpt.site>

> 기준 브랜치: `codex/mingikim-live-call`
>
> UI 기준선: `origin/mingikim` (`77b00254fa7a7a79d0e13f152c01551797ba60e2`)
>
> 원격 `main`은 수정·푸시하지 않는다.

## 1. 이 작업의 목적

기존 KDA 상담 데모에 실제 Galaxy 마이크를 연결하고, 최종적으로 다음 세 장비가 같은 통화를 공유하도록 기반을 확장했다.

```text
[Galaxy + 고객 노트북]
 WO Mic → customer audio edge
               │
               ▼
[중앙 서버 노트북]
 통화 세션 · 2채널 STT · EXAONE · RAG · 요약 · DTMF 저장
               ▲
               │
 상담원 마이크 → agent audio edge
[상담원 노트북]
 상담 화면 · 고객/상담원 실시간 자막 · 후처리
```

고객과 상담원 오디오는 처음부터 다른 장치에서 들어오므로 무거운 화자 분리 모델을 사용하지 않는다. 각 송신기가 `speaker=customer` 또는 `speaker=agent`를 명시하고 서버가 두 버퍼를 독립 처리한다.

## 2. 현재 완료된 범위

### 휴대폰·고객 채널

- Galaxy의 WO Mic 음성을 Windows 가상 마이크로 수신한다.
- 고객 노트북의 경량 sender가 PCM16/16 kHz 오디오를 중앙 서버 WebSocket으로 전송한다.
- sender는 `WO Mic Device`를 자동 선택하며 장치 목록·명시 선택도 지원한다.
- Galaxy 브라우저에는 실제 전화 형태 화면과 키패드가 표시된다.
- 별도 안내 TTS 없이 통화 버튼 직후 녹취가 시작된다.
- 무음 5초나 임의 타이머로 통화를 끊지 않는다.
- 고객이 브라우저를 닫거나 Wi-Fi가 잠깐 끊겨도 15초 재연결 유예를 준다.
- 명시적 종료 또는 유예 만료 시에만 마지막 음성 tail까지 drain한 뒤 종료한다.

### 상담원 채널

- 별도 상담원 노트북에서 `agent audio edge`를 실행할 수 있다.
- 상담원이 연결되기 전에는 상담원 오디오 gate가 닫혀 있다.
- 사전 접수 STT drain 완료와 상담 준비 확인 후 `agent_connected` ACK가 와야 두 채널 gate가 열린다.
- 상담원 sender가 끊겨도 고객 통화를 즉시 종료하지 않는다. 같은 sender ID 재연결 또는 이관을 허용한다.
- 상담 중 화면 하단 자막에 `고객`과 `상담원`이 구분되어 표시된다.

### 통화 수명주기

- 고정 `demo1`에 의존하지 않고 서버가 `call_id`를 발급하거나 요청된 안전한 ID를 등록한다.
- 한 `call_id`를 재사용하더라도 매 통화마다 `generation`이 증가한다.
- 오디오 패킷에는 `generation`, `audio_seq`, `captured_at_ms`가 들어간다.
- 이전 통화의 지연 패킷, 중복 패킷, 역순 패킷은 다음 통화에 들어갈 수 없다.
- STT는 통화당 직렬 처리하며 pending task 수를 제한한다.
- 과부하로 발화가 거절되면 `drained=true`를 거짓으로 보내지 않는다.
- 종료 순서는 `gate close → 고객/상담원 tail flush → STT drain → final_seq 확정 → call_end ACK`다.
- 고객이 먼저 끊기, 상담원이 끊기, 브라우저 갑작스러운 종료, 즉시 재통화가 모두 별도 경로로 처리된다.

### 키패드(DTMF)

- `0`은 종료 키가 아니다. 계좌번호·인증번호 등 일반 숫자로 전달된다.
- 상담 전 `#`은 사전 음성 접수 완료를 요청한다.
- 상담원이 연결된 뒤 `#`은 일반 DTMF 입력이며 통화를 종료하지 않는다.
- 모든 유효 입력 `0-9`, `*`, `#`은 다음 정보와 함께 저장된다.

```json
{
  "call_id": "example-call",
  "generation": 2,
  "seq": 4,
  "digit": "5",
  "phase": "active",
  "captured_at_ms": 1784709000000
}
```

- 저장소는 기존 `mvp-1.0` PostgreSQL 3테이블 계약을 깨지 않는 로컬 SQLite sidecar다.
- 기본 경로는 Windows `%LOCALAPPDATA%\K7\live-state.sqlite3`이며 `K7_LIVE_STATE_DB`로 변경할 수 있다.
- 상담원 화면에는 전체 번호를 노출하지 않고 마스킹된 입력과 저장 상태를 표시한다.
- 수신 숫자를 현재 본인확인 대조 입력칸에 적용할 수 있다.
- raw DTMF는 민감정보가 될 수 있으므로 공개 HTTP 조회 API를 만들지 않았다.

### STT·요약·분류

- faster-whisper 기반 로컬 STT를 사용한다.
- 현재 테스트 노트북 기본값은 `small / cpu / int8`이다.
- 시연 서버 노트북 성능이 충분하면 CUDA와 더 큰 Whisper 모델로 환경변수만 교체할 수 있다.
- EXAONE은 Ollama를 통해 로컬에서 실행한다.
- 현재 노트북은 `exaone3.5:2.4b`를 기본 사용하고 `7.8b`도 설치돼 있다.
- 사전 요약은 고객 발화만 기준으로 라우팅한다. 상담원 발화의 위험 단어가 고객 위험도로 오염되지 않는다.
- 전체 통화 종료 요청은 두 화자를 모두 전달한다.
- 백엔드는 UI 확정 후 사용할 수 있도록 다음 후처리 섹션 계약을 준비했다.
  - 고객 문의
  - 상담원 안내
  - 확인·처리된 사항
  - 미완료 사항
  - 후속 조치
- 모델이 이메일, 문자, 재발급, 처리완료 등 원문에 없는 사실을 추가하면 grounding guard가 거절한다.
- 모델이 없거나 출력이 거절되면 `local-rule-v2` fallback으로 명시한다. STT 원문을 AI 요약이라고 속이지 않는다.
- 감정 모델이 실제로 연결되지 않았으면 `모델 미연동`으로 표시한다.

### 관리자 콘솔

관리자 콘솔은 중앙 서버 프로세스를 시작·종료하는 시스템 콘솔이 아니다. 다음 시연·관찰용 화면이다.

- STT → 분류 → 위험 → 카드 → 라우팅 파이프라인 진행 관찰
- 상담 큐와 라우팅 결과 관찰
- 상담원 화면 새로고침 후에도 현재 콜 이벤트 replay
- 이관 요청·완료 흐름 관찰
- 운영 장애 시 고객/상담원 화면 사이 이벤트가 어디까지 왔는지 확인

필수 실행 컴포넌트는 아니지만 팀 시연, QA, 장애 추적에 유용하므로 유지한다.

## 3. 세 노트북 실행 방법

### A. 중앙 서버 노트북

```powershell
.\scripts\windows\setup-local-ai.ps1
.\scripts\windows\start-distributed-live-call.ps1
```

스크립트가 출력하는 값을 팀에 공유한다.

- `Call ID`
- Customer URL
- Employee URL
- Admin URL
- Customer/Agent sender 명령

서버 포트:

| 포트 | 프로토콜 | 용도 |
|---|---|---|
| 5173 | TCP | 고객·상담원·관리자 웹 UI |
| 8000 | TCP | FastAPI, ARS/STT/Demo WebSocket |
| 11434 | TCP/localhost | Ollama 로컬 모델 |
| 60000 | UDP | 고객 노트북의 WO Mic 수신 |

Windows 방화벽 최초 설정:

```powershell
.\scripts\windows\enable-k7-lan-firewall.ps1
```

관리자 승인이 필요하며 5173/TCP, 8000/TCP, 60000/UDP만 연다.

### B. 고객 노트북 + Galaxy

1. Galaxy와 고객 노트북을 같은 Wi-Fi 또는 노트북 모바일 핫스팟에 연결한다.
2. Galaxy WO Mic에서 `Transport=Wi-Fi` 후 Start한다.
3. Windows WO Mic Client에서 Galaxy IP에 연결한다.
4. Windows 입력 장치에 `마이크(WO Mic Device)`가 보이는지 확인한다.
5. 고객 sender를 실행한다.

```powershell
.\scripts\windows\start-customer-audio-edge.cmd `
  -ServerUrl http://SERVER_IP:8000 `
  -CallId CALL_ID
```

6. Galaxy Chrome에서 Customer URL을 연다.
7. 초록 통화 버튼을 누르고 말한다.
8. 사전 용건을 모두 말한 뒤 `#`을 누른다.

주의: 현재 실험에서는 Wi-Fi 이름과 IP 대역이 일치해야 한다. 노트북이 `192.168.11.x`인데 Galaxy가 LTE 또는 `192.168.137.x`에 있으면 접속되지 않는다.

### C. 상담원 노트북

상담원 마이크 sender:

```powershell
.\scripts\windows\start-agent-audio-edge.cmd `
  -ServerUrl http://SERVER_IP:8000 `
  -CallId CALL_ID
```

상담원 브라우저에서 Employee URL을 연다. 상담 준비 카드의 유의사항을 확인하고 통화 연결을 누르면 서버 ACK 이후 상담원 오디오 gate가 열린다.

헤드셋 사용을 권장한다. 스피커를 쓰면 고객 음성이 상담원 마이크에 재입력되어 중복 전사될 수 있다.

## 4. WebSocket 계약

### 오디오 엣지

```text
ws://SERVER_IP:8000/ws/audio/{call_id}?speaker=customer&sender_id={stable_id}
ws://SERVER_IP:8000/ws/audio/{call_id}?speaker=agent&sender_id={stable_id}
```

K7A1 frame:

```text
magic(4) | generation(u32) | audio_seq(u64) | captured_at_ms(u64) | PCM16 mono
```

### ARS/수명주기

```text
ws://SERVER_IP:8000/ws/ars/{call_id}?role=mobile
ws://SERVER_IP:8000/ws/ars/{call_id}?role=desktop
```

주요 이벤트:

- `call_start`
- `dtmf`
- `intake_complete`
- `agent_connected`
- `call_end`
- `ars_state`
- `lifecycle_error`

### 실시간 자막

```text
ws://SERVER_IP:8000/ws/call/{call_id}?role=agent
```

전사 예시:

```json
{
  "type": "transcript",
  "speaker": "customer",
  "generation": 2,
  "seq": 8,
  "audio_seq": 447,
  "text": "대출 만기 연장을 문의하려고요.",
  "is_final": true
}
```

## 5. 환경변수

| 변수 | 기본/권장 | 설명 |
|---|---|---|
| `K7_AUDIO_CAPTURE_MODE` | `edge` | 3노드 구조에서는 서버 직접 마이크 대신 edge |
| `K7_LIVE_STT_MODEL` | `small` | Whisper 모델 |
| `K7_LIVE_STT_DEVICE` | `cpu` | 시연 서버 GPU에서는 `cuda` 검토 |
| `K7_LIVE_STT_COMPUTE_TYPE` | `int8` | CPU 노트북 권장 |
| `K7_LIVE_STT_MAX_PENDING_TASKS` | `8` | 통화당 STT 대기 작업 상한 |
| `K7_OLLAMA_MODEL` | `exaone3.5:2.4b` | 현재 노트북 기본 |
| `K7_OLLAMA_URL` | `http://127.0.0.1:11434` | 로컬 Ollama |
| `K7_LIVE_STATE_DB` | `%LOCALAPPDATA%\K7\live-state.sqlite3` | DTMF sidecar 저장소 |
| `K7_ARS_ORPHAN_END_GRACE_SECONDS` | `15` | 고객 제어 소켓 재연결 유예 |

## 6. 테스트와 검증 증거

필수 검사:

```powershell
npm run check
.\.venv\Scripts\python.exe -m pytest backend\tests -q
.\.venv\Scripts\python.exe scripts\windows\test_audio_edge_sender.py
```

검증 범위:

- 고객/상담원 2채널 오디오 ingest
- 역할별 gate
- STT 직렬화와 backlog 상한
- 고객·상담원 tail drain
- stale generation/duplicate audio 차단
- 같은 sender ID 재연결
- 갑작스러운 고객 종료와 15초 유예
- 상담원 연결 조건과 잘못된 세대 거절
- 재통화 상태 초기화
- DTMF 0 일반 입력
- 상담 중 `#` 일반 입력
- DTMF SQLite 저장과 generation 분리
- EXAONE grounding/hallucination guard
- 브라우저 역할별 relay/replay
- TypeScript와 Vite 프로덕션 빌드

실기 검증에서 Galaxy(`192.168.11.185`)가 서버 UI 5173과 WebSocket 8000에 접속했고, 실제 WO Mic 발화가 generation 2에서 다음처럼 수신됐다.

```text
고객: 네, 감사합니다.
고객: 이거 어떻게 보면 되겠지
```

## 7. 아직 의도적으로 완료하지 않은 것

UI가 확정되지 않았으므로 다음은 후속 작업이다.

- 다섯 섹션 후처리 요약의 최종 시각 배치
- DTMF 마스킹 카드의 최종 위치·상호작용 디자인
- 실제 양방향 음성 중계
  - 고객 음성 → 상담원 헤드셋
  - 상담원 음성 → Galaxy 스피커
- 실제 통신/CTI 연동
- 브라우저 역할 인증과 call token
- DTMF·녹취 암호화, 보존 기간, 접근 감사
- 상담원 음소거·보류를 edge sender에 실제 제어로 연결
- 후처리 저장 API와 운영 DB 계약
- 감정 모델의 정식 운영 연결 및 검증

현재 시스템은 **실시간 STT와 상담 흐름 기반**이다. 실제 전화 음성을 양방향으로 들려주는 VoIP/CTI 계층은 아직 아니다.

## 8. 다른 AI가 이어서 작업할 때 지켜야 할 불변조건

1. 원격 `main`에 직접 푸시하지 않는다.
2. `origin/mingikim` UI를 통째로 교체하지 않는다.
3. 고객/상담원 라벨을 추론하지 말고 edge의 명시적 `speaker`를 신뢰한다.
4. `generation`이 다른 오디오나 수명주기 이벤트를 절대 현재 콜에 적용하지 않는다.
5. 종료 ACK 전에 두 화자 STT tail이 모두 drain됐는지 확인한다.
6. 상담원 sender disconnect를 고객 통화 종료로 해석하지 않는다.
7. `0`을 종료 키로 사용하지 않는다.
8. 상담 연결 후 `#`을 종료/접수 완료 명령으로 사용하지 않는다.
9. DTMF 원문을 상담원 화면·로그·공개 API에 그대로 노출하지 않는다.
10. 감정 모델이 없으면 `unavailable`, 요약 모델이 없으면 명시적 fallback으로 표시한다.
11. STT 원문을 AI 요약이라고 표시하지 않는다.
12. 모델 출력의 절차·처리완료·연락방식은 원문 grounding을 통과해야 한다.
13. 실제 live 모드에서 데모 fixture를 상담 결과처럼 노출하지 않는다.
14. 양방향 음성 중계를 추가할 때 상담원 헤드셋과 echo 방지 정책을 함께 설계한다.

## 9. 주요 코드 위치

| 영역 | 파일 |
|---|---|
| 실시간 STT·오디오·ARS 서버 | `backend/app/live_stt.py` |
| DTMF 영속 저장 | `backend/app/live_dtmf_store.py` |
| 라우터 등록 | `backend/app/main.py` |
| 전체 상담 상태머신 | `src/hooks/useCallFlow.ts` |
| Galaxy ARS 제어 | `src/services/arsMobile.ts` |
| 상담원 ARS 제어 | `src/services/arsControl.ts` |
| 실시간 자막 | `src/services/liveCall.ts` |
| 고객 전화 UI | `src/components/Phone.tsx` |
| 상담원 통화 UI | `src/components/desktop/ActiveCall.tsx` |
| 관리자 relay/replay | `src/services/demoBus.ts`, `src/hooks/useAdminFeed.ts` |
| Windows 실행 도구 | `scripts/windows/` |
| 계약 검증 | `scripts/validate-live-call-contract.mjs` |

## 10. 병합 전략

- 이 브랜치를 바로 `main`에 합치지 않는다.
- UI 담당 최신 브랜치 변경을 먼저 확인한다.
- 충돌 시 서버 계약과 테스트를 기준으로 UI 어댑터만 조정한다.
- PR에서는 오디오/ARS/수명주기, DTMF, UI 표시를 논리적으로 구분해 리뷰한다.
- 실제 배포 전 보안·보존 정책과 양방향 음성/CTI 범위를 별도 승인한다.
