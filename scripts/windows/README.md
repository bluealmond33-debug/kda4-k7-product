# K7 Windows/Galaxy 분산 라이브 시연

이 폴더는 기존 `mvp-1.0` 전체 파일 업로드/배치 처리 계약을 바꾸지 않는 **추가 실험용 라이브 시연 경로**입니다. 기존 API와 화면 흐름은 그대로 유지하며, Galaxy의 WO Mic과 상담원 마이크를 중앙 노트북의 실시간 STT로 보내는 기능만 덧붙입니다.

현재 범위는 두 마이크의 STT 수집입니다. 서로 떨어진 고객과 상담원에게 상대방 음성을 재생하는 실제 VoIP/전화 중계 기능은 포함하지 않습니다. 상담원 노트북에서는 스피커 소리가 다시 마이크로 들어가지 않도록 헤드셋 사용을 권장합니다.

## 1. 최초 설치

인터넷이 되는 곳에서 저장소 루트 PowerShell을 열고 실행합니다.

```powershell
.\scripts\windows\setup-local-ai.cmd
```

스크립트는 `.venv`, Python/Node 의존성, Ollama와 EXAONE, faster-whisper 모델을 준비합니다. 하드웨어에 따라 다음처럼 보수적으로 선택하며, 사용자 환경변수로 덮어쓸 수 있습니다.

- CPU 또는 16GB급 메모리: `exaone3.5:2.4b`, faster-whisper `small`, CPU `int8`
- 6GB 이상 NVIDIA VRAM: `exaone3.5:7.8b`, faster-whisper `small`, CUDA `float16`
- 더 큰 GPU: VRAM에 따라 medium/large-v3 및 더 큰 EXAONE

설치 없이 선택 결과만 확인하려면 다음을 사용합니다.

```powershell
.\scripts\windows\setup-local-ai.ps1 -PlanOnly
```

오디오 송신기만 쓰는 노트북에는 최소한 Python과 다음 패키지가 필요합니다.

```powershell
python -m pip install sounddevice websockets
```

## 2. 한 노트북 + Galaxy 시연

1. Galaxy WO Mic 앱과 Windows WO Mic Client를 `Connected` 상태로 만듭니다.
2. 서버와 화면을 실행합니다.

```powershell
.\scripts\windows\start-phone-ars.cmd
```

3. 실행창이 출력한 `Customer` 주소를 Galaxy Chrome에서, `Employee` 주소를 상담사 브라우저에서 엽니다. 두 주소의 `call_id`가 반드시 같아야 합니다.
4. Galaxy 고객 화면에서 통화를 시작하면 녹취가 즉시 시작됩니다. 자동 시간 제한으로 통화가 끊기지 않으며, 고객 또는 상담원의 명시적인 종료 동작만 통화를 끝냅니다.
5. 숫자 `0`은 일반 DTMF 입력입니다. 사전 문의 입력 단계의 `#`만 상담원 연결 준비를 완료하며 통화 자체를 끊지는 않습니다.

`Call ID`는 서버가 `POST /api/live-stt/calls`로 새로 등록합니다. `demo1` 같은 묵시적 기본값이나 실패 시 fallback은 없습니다. 직접 고정 ID를 쓰고 싶다면 등록까지 포함해 다음처럼 실행합니다.

```powershell
.\scripts\windows\start-phone-ars.cmd -CallId rehearsal-01
```

## 3. 3대 분산 시연

세 Windows 노트북이 같은 LAN에 있어야 합니다. 예시는 중앙 서버 IP가 `192.168.0.10`인 경우입니다.

### 중앙 AI/STT 노트북

```powershell
.\scripts\windows\start-distributed-server.cmd -HostIp 192.168.0.10
```

출력되는 다음 네 값을 그대로 사용합니다.

- `Call ID`
- `Customer` URL: `http://192.168.0.10:5173/?role=customer&call_id=...`
- `Employee` URL: `http://192.168.0.10:5173/?role=employee&call_id=...`
- 고객/상담원 sender 명령

### 고객 음성 노트북 + Galaxy

Galaxy WO Mic을 이 노트북의 WO Mic Client에 먼저 연결합니다. 고객 송신기는 장치 이름에서 `WO Mic`을 자동으로 찾습니다.

```powershell
.\scripts\windows\start-customer-audio-edge.cmd -ServerUrl http://192.168.0.10:8000 -CallId PASTE_CALL_ID
```

Galaxy Chrome에서는 중앙 서버가 출력한 `Customer` URL을 엽니다. WO Mic 앱은 `Start`/연결 상태를 유지합니다.

### 상담원 노트북

중앙 서버가 출력한 `Employee` URL을 브라우저에서 열고 다음 명령을 실행합니다. 장치를 생략하면 Windows 기본 입력 마이크입니다.

```powershell
.\scripts\windows\start-agent-audio-edge.cmd -ServerUrl http://192.168.0.10:8000 -CallId PASTE_CALL_ID
.\scripts\windows\start-agent-audio-edge.cmd -ServerUrl http://192.168.0.10:8000 -CallId PASTE_CALL_ID -Device 3
```

실제 입력 장치 번호는 다음처럼 확인합니다. 장치 목록 확인에는 Call ID가 필요하지 않습니다.

```powershell
.\scripts\windows\start-audio-edge.cmd -ListDevices
```

## 4. 통화 재시작과 후처리 안전장치

송신기는 계속 실행해 둘 수 있지만 서버가 허용한 구간만 K7A1 오디오를 전송합니다.

| 상태 | 고객 마이크 | 상담원 마이크 |
|---|---:|---:|
| 통화 전/종료 후 | 닫힘 | 닫힘 |
| 고객 사전 문의 | 열림 | 닫힘 |
| 사전 문의 완료 후 연결 준비 | 닫힘 | 닫힘 |
| 상담원 연결 후 | 열림 | 열림 |

통화 종료 시 양쪽 꼬리 발화를 먼저 drain한 뒤 후처리로 넘어갑니다. 다시 전화를 받으면 서버 `generation`이 증가하고 각 송신기의 `audio_seq`가 1부터 다시 시작합니다. 게이트가 닫히거나 generation이 바뀌는 즉시 대기 오디오를 폐기하므로, 이전 통화의 느린 네트워크 backlog가 다음 통화 STT나 상담 카드에 섞이지 않습니다.

각 binary WebSocket 메시지는 다음 규격입니다.

- 24-byte big-endian header: `>4sIQQ`
- magic: ASCII `K7A1`
- generation: uint32
- audio_seq: uint64, 역할/세대별 1부터 시작
- captured_at_ms: uint64
- payload: 16 kHz, mono, signed PCM16 little-endian

같은 Call ID와 역할의 두 번째 송신기는 서버가 WebSocket 1008로 거절합니다. 잘못 등록된 Call ID도 거절되며, 송신기 창에 원인을 표시합니다.

## 5. 연결 문제

- Windows 방화벽에서 Python과 Node.js의 현재 **개인 네트워크** 통신을 허용합니다.
- WO Mic의 `UDP 60000` 오류는 WO Mic Client 방화벽 규칙을 확인합니다.
- `Configuration error: call-id is required`가 나오면 중앙 서버 실행창의 정확한 Call ID를 전달합니다.
- `duplicate sender`/WebSocket 1008이면 같은 역할로 먼저 실행된 sender 창을 하나만 남깁니다.
- 포트 8000/5173에 예전 서버가 남아 있다는 경고가 나오면 그 서버를 정상 종료한 뒤 다시 실행합니다.

## 6. 종료와 검증

서버 실행 스크립트가 소유한 프로세스만 종료합니다.

```powershell
.\scripts\windows\stop-phone-ars.cmd
```

송신기는 각 창에서 `Ctrl+C`로 종료합니다. 단위 테스트와 PowerShell 구문 검사는 다음과 같습니다.

```powershell
python -m unittest discover .\scripts\windows -p "test_*.py" -v
$errors = $null
Get-ChildItem .\scripts\windows\*.ps1 | ForEach-Object {
  [void][System.Management.Automation.Language.Parser]::ParseFile($_.FullName, [ref]$null, [ref]$errors)
  if ($errors) { $errors; throw "PowerShell parse failed" }
}
```
