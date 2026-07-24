# K7 MVP 최종 팀 인계 메시지

이 문서는 2026-07-16 현재 실제 GitHub·Railway·Vercel 상태를 기준으로 한 복사·붙여넣기용 메시지입니다.

## 팀 Slack에 보낼 짧은 메시지

```text
[이찬희 데이터 거버넌스·통합 파트 현황]

lch 브랜치의 mvp-1.1 표준 계약, 모델 어댑터, Railway PostgreSQL 핵심 3테이블, 원자적 저장·재조회 코드와 React API 경계를 완성했습니다. 선택 규정 RAG는 `rag_documents`, `rag_chunks` 두 테이블만 추가할 수 있습니다. React는 API 응답을 타입으로 단순 가정하지 않고 mvp-1.1 런타임 검증을 통과한 데이터만 상담카드에 표시합니다.

공개 운영 상태를 다시 확인한 결과:
- GET /health → database=connected, contract_version=mvp-1.0
- POST /api/v1/calls → 실제 음성 STT·분석·DB 저장
- GET /api/v1/calls/{call_id}/consultation-card → 같은 call_id 저장 결과 재조회
- 기존 8개 POST 데모 경로 유지
상태입니다. 최신 lch 목표는 mvp-1.1이므로 운영 백엔드는 아직 최신 계약 배포 전입니다.

이전에 실제 한국어 WAV로 POST 201·GET 200까지 확인했습니다. 남은 운영 보완은 두 가지입니다.
1) 희창이 형이 최신 lch의 mvp-1.1 계약을 운영 백엔드에 반영하고, STT duration_sec를 응답 조립 전에 round(..., 3) 처리해 POST와 DB 재조회 응답을 완전히 같게 만들기
2) Vercel 소유자가 최신 lch에 VITE_API_BASE_URL, VITE_USE_REAL_DATA_API=true를 적용해 /api/v1/calls 화면을 직접 재배포하기

현재 감정은 실제 음성 모델이 없으므로 unavailable이 맞습니다. 텍스트 /emotion 스텁을 실제 감정처럼 사용하지 않습니다. 현재 MVP는 완성 음성 파일 일괄 처리이며 실시간 전화망·스트리밍 STT는 아닙니다.

팀이 확정한 새 흐름도 lch에 반영했습니다. FastAPI가 call_id를 먼저 발급하고 동일 음성을 `STT→OpenAI 요약·분류·라우팅`과 `음성 감정 모델`로 나눈 뒤, `external_session_key == call_id`를 확인해 한 상담카드로 저장합니다. 음성 모델 원시 결과는 `raw_emotion_result JSONB`로 추적하고 화면에는 검증된 표준 점수만 전달합니다.

감정 상태는 운영 계약에서 `unavailable | completed`만 허용하고 `demo`는 백엔드·프론트·DB에서 모두 차단했습니다. Railway PostgreSQL 실제 검증에서 두 모델 결과 결합·재조회, 잘못된 점수–단계 거절, 테스트 행 자동 삭제와 최종 0건을 확인했습니다.

실제 Railway POST·GET 응답은 프론트 런타임 계약 검증을 모두 통과했고, 검수 데이터는 삭제해 calls/transcripts/consultation_cards 모두 0건으로 복구했습니다.
Railway는 Vercel 운영 origin의 음성 POST preflight도 200으로 허용하므로, 소유자 재배포 후 브라우저 CORS를 추가로 수정할 필요는 없습니다.

최종 릴리스 명령은 실제 음성 테스트 전후 PostgreSQL 행 수를 비교합니다. 기존 데이터는 건드리지 않고 검수용 call_id만 삭제되어 원래 행 수로 돌아온 경우에만 release_ready=true가 됩니다.

두 검수 완료 후, 운영과 연결되지 않은 k7-mvp-lch-preview 검증 서비스만 삭제하면 됩니다. Postgres와 kda4-k7-backend는 삭제하거나 교체하면 안 됩니다.
```

## 이희창 님과 Claude에게 보낼 실행 프롬프트

```text
K7 운영 백엔드에서 이찬희 데이터 통합 파트의 마지막 인수 작업만 수행해줘.

운영 소유 저장소는 HeeChang50/kda4-k7-backend, 운영 서비스는
https://kda4-k7-backend-production.up.railway.app 이다.

먼저 현재 main 코드를 읽고 기존 STT·GPT 분석·judge·RAG·레거시 API를 보존해라. 새 FastAPI 서비스나 새 PostgreSQL을 만들지 마라.

현재 공개 운영에서 확인된 사실:
- /health: status=ok, database=connected, contract_version=mvp-1.0
- POST /api/v1/calls와 GET /api/v1/calls/{call_id}/consultation-card 존재
- 실제 한국어 WAV POST 201, 같은 call_id GET 200 성공
- 기존 8개 POST 경로는 유지되어야 함

최신 lch의 목표 계약은 mvp-1.1이다. 먼저 현재 운영 소스와 최신 lch 차이를 검토하고, 기존 경로를 보존한 채 mvp-1.1 계약·DB 마이그레이션·프론트 응답을 함께 맞춰라.

발견된 마지막 계약 차이:
- POST transcript.duration_sec = 10.100000381469727
- PostgreSQL 저장 후 GET transcript.duration_sec = 10.1

원인은 Whisper 부동소수점 값과 PostgreSQL numeric(10,3)의 정밀도 차이다.
app/routers/mvp.py에서 TranscriptResult를 만들기 전에 아래처럼 정규화하고, POST 응답과 DB 저장에 같은 값을 사용해라.

duration_sec = round(float(transcribed.duration_sec or 0), 3)

감정 정책:
- 실제 감정온도 입력은 audio_bytes만 허용
- 현재 임시 emotion.py와 텍스트 /emotion은 실제 모델이 아님
- 실제 음성 감정 모델을 받기 전 상담카드는 status=unavailable 유지
- 텍스트·키워드·해시 스텁 결과를 completed 감정으로 저장하지 말 것

Railway:
- 기존 Postgres 하나만 사용
- DATABASE_URL은 값 복사가 아니라 ${{Postgres.DATABASE_URL}} 참조 유지
- 비밀값을 로그나 답변에 출력하지 말 것
- k7-mvp-lch-preview는 운영 서비스가 아니지만 최종 Vercel 검수 전에는 건드리지 말 것

배포 후 실제 한국어 음성으로 검수:
1. health database=connected, contract_version=mvp-1.1
2. POST /api/v1/calls HTTP 201
3. schema_version=mvp-1.1, source_channel=voice
4. GET 같은 call_id HTTP 200
5. POST와 GET 전체 JSON 완전 동일
6. 기존 /stt, /analyze, /judge, /rag, /analyze-text, /emotion, /summarize, /briefing POST 유지

완료 보고에는 변경 파일·commit·Railway deployment·검수 call_id·POST/GET 동일 여부만 기록하고 비밀값은 숨겨라.
```

상세 배경과 전체 자산 목록은 `docs/HEECHANG_CLAUDE_HANDOFF_PROMPT.md`를 함께 전달합니다.

음성 감정 모델 담당자에게는 `docs/AUDIO_EMOTION_MODEL_HANDOFF.md`를 전달합니다. 모델팀은 DB나 React를 수정하지 않고 Railway에서 호출 가능한 URL, 인증, 지원 음성 형식, 정상·실패 JSON, 모델 버전과 처리시간만 제공하면 됩니다.

## Vercel 소유자에게 보낼 메시지

```text
Vercel의 k7product 운영 배포를 lch 통합 음성 API 버전으로 갱신해주세요.

배포 소스:
- repo: bluealmond33-debug/kda4-k7-product
- branch: lch
- PR: #1

환경변수:
- VITE_API_BASE_URL=https://kda4-k7-backend-production.up.railway.app
- VITE_USE_REAL_DATA_API=true
- VITE_DATA_API_PREFIX=/api/v1

완료 확인:
1. 음성 파일 선택 후 Network에 POST /api/v1/calls가 표시
2. 응답 HTTP 201
3. schema_version=mvp-1.1, source_channel=voice
4. 응답의 요약·업무유형·부서·위험도가 상담카드에 표시
5. 감정 모델 미연동 시 임의 점수가 아니라 모델 미연동 표시

현재 배포 번들은 아직 /api/v1/calls와 Railway 주소가 없고 구형 /summarize만 포함합니다. Vercel 팀 유료 권한 공유는 필요 없고 소유자 계정에서 직접 재배포하면 됩니다.
```

## 최종 삭제 조건

`k7-mvp-lch-preview`는 현재 공개 도메인과 사용자 정의 환경변수가 없고 운영 백엔드·PostgreSQL·Vercel 어느 곳에서도 참조하지 않습니다. 다만 실행 중인 배포는 남아 있습니다.

다음 두 조건이 모두 충족된 뒤 Railway 관리자에게 삭제를 요청합니다.

1. 실제 음성으로 운영 POST와 GET의 전체 JSON이 완전히 동일
2. Vercel 화면이 구형 `/summarize`가 아니라 `/api/v1/calls` 응답을 표시

삭제 대상은 `k7-mvp-lch-preview` 하나뿐입니다. `kda4-k7-backend`, `Postgres`, `postgres-volume`은 운영 자산이므로 삭제하지 않습니다.

## 한 번에 확인하는 명령

백엔드와 현재 Vercel 배포 상태:

```powershell
npm run check:release
```

최종 실제 음성까지 포함:

```powershell
$env:K7_TEST_DATABASE_URL = "화면에 출력하지 않은 Railway 테스트 DB URL"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\check-release-gates.ps1 -AudioPath "C:\path\to\sample.wav"
Remove-Item Env:K7_TEST_DATABASE_URL
```

실제 음성 검수 행은 성공·실패 여부와 관계없이 `finally`에서 삭제됩니다. 게이트는 DB 스키마를 검증하고 검수 전후 행 수가 원래대로 복구됐는지도 확인합니다. `release_ready=true`가 나온 뒤에만 데이터 통합 MVP를 최종 완료로 판정합니다.
