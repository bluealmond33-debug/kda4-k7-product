# 프론트 지도 (Frontend Map)

프론트엔드 화면 구조·디자인 자산을 한 장으로. 시스템 전체는 루트 [`README.md`](../README.md) 참고.
Vite + React 18 + TypeScript, 라우터 없이 URL 경로로 화면 역할을 나눈다(`src/App.tsx`).

## 4개 화면 (한 곳에서 정의: `src/App.tsx`)

| 경로 | 화면 | 컴포넌트 | 용도 |
|------|------|----------|------|
| `/` | **시연화면** | `<LiveDemo />` (폰+데스크톱 합본) | 한 화면에서 전체 흐름을 다 보여줄 때 |
| `/customer` | **고객 화면** | `<LiveDemo view="phone" />` | 실제 발표: 고객 단독 |
| `/employee` | **상담사 화면** | `<LiveDemo view="desktop" />` | 실제 발표: 상담사 콘솔 단독 |
| `/admin` | **관리자(관제) 화면** | `<AdminDashboard />` | 백엔드 파이프라인 관제 (별도 성격) |

구 방식 `?role=customer|employee|admin` 도 계속 동작. `call_id`가 있으면 세 화면이 중앙 WS 릴레이로 같은 통화 세션을 공유한다.

### 화면 자동 최신화 (중요)
고객·상담사·시연화면은 **같은 `<LiveDemo>` 컴포넌트 하나**를 `view` prop만 바꿔 재사용한다.
→ **고객 화면을 고치면 시연화면의 폰 부분이 자동으로 같이 바뀐다.** 따로 두 번 수정할 필요 없음.
`/admin`만 별도 컴포넌트다(관제라 성격이 달라서 분리).

## 폴더 구조 (`src/`)
- `components/` — UI. `admin/`(관제), `desktop/`(상담사 데스크톱), 공용(`LiveDemo`, `Phone` 등)
- `styles/` — **디자인 단일 소스**. 아래 "디자인 자산" 참고
- `features/` `hooks/` `services/` `lib/` — 상태·통화 흐름·데이터 로직
- `data/` `assets/` `tour/` — 목업 데이터, 정적 자산, 데모 투어

## 디자인 자산 인덱스 (흩어지지 않게 여기서 관리)
- **`src/styles/tokens.css`** — ⭐ 실사용 단일 소스. 폰트 `@font-face`·색·타이포 토큰. 화면에 실제 렌더되는 값은 전부 여기서 나온다. **디자인 바꾸려면 여기부터.**
- `src/styles/global.css` — 전역 스타일. 폰트는 토큰(`var(--font-*)`) 참조(하드코딩 없음).
- `design-reference/*.dc.html` — 목업 2개(`live-demo`, `wireframe`). 참고용 정적 파일.
- `public/karina-logo.svg`, `public/karina-mark.svg` — 로고.

### 폰트 정책 (self-host, CDN 0개 — 온프레미스 오프라인 대응)
- **본문/제목 라틴** = Avenir Next (`public/fonts/AvenirNext-*.woff2`)
- **한글** = Pretendard (`public/fonts/PretendardVariable.woff2`)
- **아이콘** = Material Symbols self-host, 구글 다운로드본 (`public/fonts/material-symbols-outlined.woff2`)
- **모노(코드·숫자·시계)** = 시스템 모노 스택(`ui-monospace, "SF Mono", Menlo…`) — 번들 폰트 없음
- **LED 시계** = DSEG 7/14-segment (`dseg` npm) — 세그먼트 디스플레이 시뮬레이션 전용 특수 폰트
- ❌ 제거됨: Geist Sans/Mono, Space Grotesk, IBM Plex Mono, Material Symbols npm/CDN import
