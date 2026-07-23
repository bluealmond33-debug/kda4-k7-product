# K7 노트북 폐쇄망 데모 실행서

## 이 데모가 실제로 하는 일

업로드한 한국어 상담 음성을 로컬 faster-whisper가 문자로 바꾸고, 로컬 Ollama의 EXAONE이 상담카드 구조로 분석합니다. FastAPI가 금융사고 안전 규칙과 로컬 업무가이드 검색 결과를 결합해 PostgreSQL에 저장하고, 기존 React UI가 같은 응답을 상담 준비·통화·후처리 화면에서 사용합니다.

```text
브라우저
  → Nginx/React :8080
  → FastAPI :8000
     ├─ faster-whisper small / CPU int8
     ├─ Ollama / EXAONE 3.5 2.4B (CPU 기본값)
     ├─ NIA 일반업무 10종 주제 모델
     ├─ K7 데모 업무가이드 RAG
     └─ PostgreSQL 17
```

## 최초 준비(인터넷 연결 시 한 번)

```powershell
Copy-Item .env.local-demo.example .env.local-demo
.\scripts\prepare-local-demo.ps1
```

이 단계가 Docker 이미지, EXAONE 모델, faster-whisper 모델을 내려받습니다.

## 폐쇄망 실행

```powershell
.\scripts\start-local-demo.ps1 -Offline
```

- 서버 노트북: `http://127.0.0.1:8080`
- 같은 핫스팟/LAN: `http://<서버 노트북 IPv4>:8080`
- 현재 IP 확인: `ipconfig` 또는 `Get-NetIPAddress -AddressFamily IPv4`

Windows 방화벽에서 다른 기기의 접속만 실패하면 TCP 8080 인바운드 허용 여부를 확인합니다. 서버 노트북에서도 열리지 않으면 먼저 `.\scripts\doctor-local-demo.ps1`을 실행합니다.

## 발표용 검증 순서

1. 상단에서 `음성 파일`을 선택합니다.
2. `음성 파일 선택`으로 실제 M4A/WAV/MP3를 업로드합니다.
3. 상담 준비 카드의 요약·요청·추가 확인 정보·위험도를 확인합니다.
4. 체크리스트를 모두 확인하고 `통화 연결`을 누릅니다.
5. 통화 화면에서 같은 실제 요청과 단계별 스크립트가 이어지는지 확인합니다.
6. 오른쪽 `관련 규정 및 매뉴얼`에서 검색 근거와 관련도를 확인합니다.
7. 감정온도는 실제 모델이 붙기 전까지 `모델 미연동`이 정상입니다.
8. 일반업무 주제 분류는 모델 SHA-256 검증 후 실행됩니다. margin `0.75`
   이상만 자동 채택하고, 미만은 `G004 기타·복합 일반 상담`으로 폴백합니다.

일반업무 주제 모델의 검증 정확도는 전체 `74.2%`, margin `0.75` 이상
구간 `90.4%`(검증 데이터의 `61.3%`)입니다. 이 수치는 긴급·단순·일반
전체 라우팅 또는 ARS 17종의 실제 발화 정확도가 아닙니다.

## 정상 상태 기준

```powershell
.\scripts\doctor-local-demo.ps1
```

다음 값이 모두 확인돼야 합니다.

```json
{
  "status": "ok",
  "database": "connected",
  "pipeline_mode": "local",
  "stt_provider": "faster_whisper",
  "analysis_provider": "ollama"
}
```

## 종료

```powershell
.\scripts\stop-local-demo.ps1 -Offline
```

이 명령은 컨테이너와 네트워크만 내리며 PostgreSQL·Ollama named volume은 삭제하지 않습니다.

## 정확한 제품 경계

- 실제 작동: 파일 업로드, STT, LLM 구조화 분석, 안전 규칙, 로컬 RAG, DB 저장·조회, 화면 연결
- 아직 미구현: CTI/SIP 실시간 전화, 음향 감정 모델, 은행 고객 원장, 실제 인증, 실제 지급정지·민원 시스템 실행, 긴급·단순·ARS 17종 실제 발화 정확도 검증
- 시연 자료: `database/knowledge/demo_guides.ko.json`은 K7 데모용이며 은행 내부 규정이라고 소개하면 안 됩니다.

## 추가 음성 회귀 테스트 자료

개인정보나 저작권이 불명확한 실제 콜 녹음을 임의로 수집하지 않습니다. 팀 공용 테스트는 AI Hub의 샘플 데이터 신청·이용 조건을 확인한 뒤 다음 두 데이터셋에서 금융 도메인 파일을 선정합니다.

- 상담 음성(데이터셋 100): 실제 콜센터 협약을 바탕으로 만든 가상 시나리오이며 금융 도메인 1,000시간을 포함합니다.
- 민원(콜센터) 질의-응답(데이터셋 98): 금융·보험 음성과 질의응답 라벨을 포함합니다.

샘플을 받은 뒤 `samples/approved/` 아래에 음원과 이용조건 메모를 함께 두고, 정상 상담·금융사고·대출·카드·민원 유형별 최소 2개씩 `POST /api/v1/calls` 회귀 테스트를 수행합니다. 원본 데이터 라이선스가 저장소 재배포를 허용하지 않으면 음원은 Git에 올리지 않습니다.
