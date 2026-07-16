# K7 금융 상담 사전접수 통합 프로젝트

고객의 자연어 문의를 STT·AI가 분석하고, 상담사가 사전 상담카드를 확인하는 흐름을
React와 PostgreSQL 데이터 계약으로 연결한 팀 공통 프로젝트입니다.
왼쪽 아이폰에서 전화를 걸면 대기 시간 동안 고객이 용건을 말하고, AI가 이를
요약해 오른쪽 **상담사 데스크톱**에 준비 카드로 띄워 주는 흐름을 클릭으로
시연할 수 있습니다.

현재 화면은 mock만으로도 독립 실행됩니다. FastAPI가 준비되면 동일한
`external_session_key`와 표준 JSON 응답을 사용해 실제 STT·감정온도·상담카드·라우팅
결과로 전환할 수 있습니다.

---

## 실행

```bash
npm install
npm run dev      # 로컬 개발 서버 (http://localhost:5173)
npm run build    # 프로덕션 빌드 → dist/
npm run preview  # 빌드 결과 미리보기
npm run check    # JSON 계약 검증 + TypeScript/Vite 빌드
```

Node 20.19+ 또는 22.12+가 필요합니다.

---

## 전체 연결 구조

```mermaid
flowchart LR
    STT["STT"] --> API["FastAPI"]
    EMOTION["감정온도"] --> API
    CARD["분류·요약·RAG"] --> API
    ROUTING["라우팅"] --> API
    API <--> DB["PostgreSQL"]
    API --> UI["React 상담사 화면"]
```

모든 팀은 통화 한 건을 `external_session_key`로 식별합니다. React와 모델은
PostgreSQL에 직접 연결하지 않으며, FastAPI가 검증·마스킹·권한·조회로그를 처리합니다.
DB 전체 사용법은 [`database/README.md`](database/README.md), API 계약은
[`database/contracts/openapi.yaml`](database/contracts/openapi.yaml)을 기준으로 합니다.

## Vercel 배포

1. Vercel에서 **Add New → Project → 위 저장소 import**
2. Framework Preset: **Vite** (자동 감지) · Build: `npm run build` · Output: `dist`
3. Deploy. 이후 `main`에 push할 때마다 자동 재배포됩니다.
4. Pull Request를 열면 Vercel이 **미리보기 URL**을 만들어 주므로, Codex 등으로
   수정한 브랜치를 배포 전 확인할 수 있습니다.

---

## 백엔드(AI) 연결 지점

AI 기능은 전부 **서비스 레이어(`src/services/`)** 로 분리되어 있고, 지금은
결정적인 **mock(시뮬레이션)** 이 기본값입니다. 요약·감정·통합 상담카드는 환경변수로
실제 API를 선택하며, STT 실시간 오디오 전송은 별도 구현 경계로 남겨 둡니다.

```bash
cp .env.example .env
```

```
VITE_API_BASE_URL=https://<백엔드 주소>
VITE_USE_REAL_STT=true       # POST /stt
VITE_USE_REAL_SUMMARY=true   # POST /summarize
VITE_USE_REAL_EMOTION=true   # POST /emotion
VITE_USE_REAL_DATA_API=true  # GET /api/v1/consultation-sessions/{key}/consultation-card
VITE_DATA_API_PREFIX=/api/v1
VITE_DATA_ACCESS_PURPOSE=consultation_preparation
VITE_DEMO_SESSION_KEY=K7-DEMO-20260715-0001
```

| 기능 | 파일 | mock 동작 | 실제(real) 계약 |
| --- | --- | --- | --- |
| STT (음성→텍스트) | `services/stt.ts` | 스크립트 발화 재생 | 실시간 오디오 스트림 연동 지점만 정의 |
| 요약·업무유형 (RAG) | `services/summarize.ts` | 착오송금 요약 반환 | `POST /summarize` → `CallSummary` |
| 감정온도 (ML) | `services/emotion.ts` | 키워드 휴리스틱 | `POST /emotion` → `EmotionScore` |
| 통합 상담카드 | `services/consultation.ts` | 표준 계약 JSON | FastAPI 통합 조회 → `ConsultationCardResponse` |

요청/응답 타입은 `src/services/types.ts`에 정의되어 있습니다. 통합 상담카드 mock은
`database/contracts/examples/consultation_card_response.example.json`을 화면이 직접
사용하므로 백엔드와 프론트의 예제 구조가 어긋나지 않습니다.

실제 로그인 연동 시 인증 모듈이 `setApiAccessToken(token)`으로 단기 Bearer 토큰을
주입합니다. 토큰은 `VITE_*` 환경변수나 저장소에 넣지 않습니다. 고객정보 조회 목적은
`X-Access-Purpose` 헤더로 전달되어 백엔드 조회로그에 기록됩니다.

> **마이크**: 이 시연은 요구사항에 따라 **시뮬레이션 전용**입니다. 상단 "실제
> 마이크"를 눌러도 권한/미지원 시 자동으로 시뮬레이션으로 되돌아갑니다.

---

## 구조

```
src/
  main.tsx / App.tsx           진입점
  styles/
    tokens.css                 Dotorian 디자인 토큰(색·타입·간격·라운드·그림자)
    global.css                 리셋 + 공용 클래스(.card/.pill/.mi 등) + keyframes
  lib/css.ts                   인라인 CSS 문자열 → React style 변환 헬퍼
  services/                    AI 서비스 레이어 (stt / summarize / emotion + 타입/설정)
  data/demoContent.ts          스크립트·규정집·이력 등 시연 데이터
  hooks/useCallFlow.ts         전체 상태머신 + 파생 뷰모델(vm)
  components/
    LiveDemo.tsx               전체 화면 조립(제어 바 + 폰 + 데스크톱)
    Phone.tsx                  아이폰(키패드 / 통화 화면)
    desktop/
      DesktopShell.tsx         데스크톱 앱 창(1440×940 → 스케일)
      Waiting.tsx              대기 화면
      PrepCard.tsx             1c 상담 준비 카드
      ActiveCall.tsx           1a 통화 중(본인인증 1d 포함)
      WrapSheet.tsx            1b 후처리
database/
  schema.sql / seed.sql        PostgreSQL 스키마·가상 데이터
  queries.sql / commands.sql   조회·저장 쿼리
  contracts/                   JSON Schema·OpenAPI·예제 응답
  README.md                    로컬·Railway 적용과 팀별 사용법
```

상태 흐름: `idle → connecting → recording → confirm → prep → active →
summarizing → wrap`. 타이밍(무응답 5초·5초, 라인 간격)은
`useCallFlow(config)`의 `silenceSec1 / silenceSec2 / lineGapMs`로 조절합니다.

## PostgreSQL 빠른 실행

PostgreSQL 16과 `psql`이 준비된 개발·테스트 환경에서 다음 순서로 실행합니다.

```powershell
$env:DATABASE_URL = "postgresql://postgres:password@localhost:5432/k7_consultation"
psql "$env:DATABASE_URL" -v ON_ERROR_STOP=1 -f database/schema.sql
psql "$env:DATABASE_URL" -v ON_ERROR_STOP=1 -f database/seed.sql
psql "$env:DATABASE_URL" -v ON_ERROR_STOP=1 -f database/queries.sql
psql "$env:DATABASE_URL" -v ON_ERROR_STOP=1 -f database/commands.sql
psql "$env:DATABASE_URL" -v ON_ERROR_STOP=1 -f database/verify.sql
```

`seed.sql`은 개발·테스트 전용입니다. Railway 운영 DB에는 `schema.sql`만 적용하고,
기존 DB 업그레이드는 `database/migrations/`의 순서대로 적용합니다.

## 디자인 시스템

색·타입·라운드·그림자는 **Dotorian Design System** 토큰(`src/styles/tokens.css`,
Geist 기반)을 그대로 이식했습니다. 컴포넌트 스타일은 `var(--*)` 토큰을
참조합니다. 폰트는 Geist Sans/Mono + Pretendard(한글) + Material Symbols(아이콘).

## design-reference/

원본 디자인 도구 소스(`*.dc.html`)를 참고용으로 함께 넣었습니다. 이 파일들은
전용 런타임에서만 실행되므로 이 저장소에서 직접 구동되지는 않지만, 화면 구성과
값(문구·수치)의 원본 기준으로 읽을 수 있습니다.
