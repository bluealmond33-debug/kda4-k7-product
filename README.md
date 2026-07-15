# K7 라이브 상담 시연 (kda4-k7-product)

키움은행 **AI 상담 접수·요약 시연**을 React로 옮긴 프로젝트입니다.
왼쪽 아이폰에서 전화를 걸면 대기 시간 동안 고객이 용건을 말하고, AI가 이를
요약해 오른쪽 **상담사 데스크톱**에 준비 카드로 띄워 주는 흐름을 클릭으로
시연할 수 있습니다.

> 원본은 디자인 도구(HTML)로 만든 시안이며, 이 저장소는 그것을
> **Vite + React + TypeScript** 표준 프로젝트로 변환한 것입니다. GitHub push →
> Vercel 배포 → 이후 백엔드(STT·RAG·감정ML) 연결까지 이어가기 위한 베이스입니다.

---

## 실행

```bash
npm install
npm run dev      # 로컬 개발 서버 (http://localhost:5173)
npm run build    # 프로덕션 빌드 → dist/
npm run preview  # 빌드 결과 미리보기
```

Node 18+ 권장.

---

## GitHub에 올리기

이 폴더(`react-app/`)를 저장소 루트로 올리는 경우:

```bash
git init
git add .
git commit -m "init: K7 상담 시연 (React)"
git branch -M main
git remote add origin https://github.com/bluealmond33-debug/kda4-k7-product.git
git push -u origin main
```

## Vercel 배포

1. Vercel에서 **Add New → Project → 위 저장소 import**
2. Framework Preset: **Vite** (자동 감지) · Build: `npm run build` · Output: `dist`
3. Deploy. 이후 `main`에 push할 때마다 자동 재배포됩니다.
4. Pull Request를 열면 Vercel이 **미리보기 URL**을 만들어 주므로, Codex 등으로
   수정한 브랜치를 배포 전 확인할 수 있습니다.

---

## 백엔드(AI) 연결 지점

AI 기능은 전부 **서비스 레이어(`src/services/`)** 로 분리되어 있고, 지금은
결정적인 **mock(시뮬레이션)** 이 기본값입니다. 백엔드가 준비되면 `.env`만 채우면
됩니다 — UI 코드는 바꿀 필요가 없습니다.

```bash
cp .env.example .env
```

```
VITE_API_BASE_URL=https://<백엔드 주소>
VITE_USE_REAL_STT=true       # POST /stt
VITE_USE_REAL_SUMMARY=true   # POST /summarize
VITE_USE_REAL_EMOTION=true   # POST /emotion
```

| 기능 | 파일 | mock 동작 | 실제(real) 계약 |
| --- | --- | --- | --- |
| STT (음성→텍스트) | `services/stt.ts` | 스크립트 발화 재생 | 브라우저 STT / 오디오 스트림 → 백엔드 |
| 요약·업무유형 (RAG) | `services/summarize.ts` | 착오송금 요약 반환 | `POST /summarize` → `CallSummary` |
| 감정온도 (ML) | `services/emotion.ts` | 키워드 휴리스틱 | `POST /emotion` → `EmotionScore` |

요청/응답 타입은 `src/services/types.ts`에 정의되어 있습니다. 실제 연동 시 각
파일의 `useReal.*` 분기 안쪽만 구현하면 됩니다(자리 표시 주석 있음).

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
```

상태 흐름: `idle → connecting → recording → confirm → prep → active →
summarizing → wrap`. 타이밍(무응답 5초·5초, 라인 간격)은
`useCallFlow(config)`의 `silenceSec1 / silenceSec2 / lineGapMs`로 조절합니다.

## 디자인 시스템

색·타입·라운드·그림자는 **Dotorian Design System** 토큰(`src/styles/tokens.css`,
Geist 기반)을 그대로 이식했습니다. 컴포넌트 스타일은 `var(--*)` 토큰을
참조합니다. 폰트는 Geist Sans/Mono + Pretendard(한글) + Material Symbols(아이콘).

## design-reference/

원본 디자인 도구 소스(`*.dc.html`)를 참고용으로 함께 넣었습니다. 이 파일들은
전용 런타임에서만 실행되므로 이 저장소에서 직접 구동되지는 않지만, 화면 구성과
값(문구·수치)의 원본 기준으로 읽을 수 있습니다.
