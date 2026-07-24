# 감정온도 3단계 정리 + 사고징후 카드 제거 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 상담 준비/통화 화면에서 사고징후(위험도) 표시를 제거하고 그 자리에 감정온도 안내문구를 넣으며, 감정 라벨 "고조"를 "집중 대응"으로 바꾼다. 프론트 전용, 계약 무변경.

**Architecture:** `useCallFlow.ts`의 라벨 상수 한 곳과 `PrepCard.tsx`·`ActiveCall.tsx`의 렌더 블록만 수정한다. 백엔드·계약·파서는 건드리지 않으므로 `npm run check`의 `validate:*`가 그대로 통과하면 계약 무변경이 증명된다.

**Tech Stack:** React + TypeScript + Vite (인라인 `css()` 스타일 헬퍼)

**Spec:** `docs/superpowers/specs/2026-07-24-emotion-3level-remove-risk-card-design.md`

## Global Constraints

- 대상 저장소: `C:\Users\natur\Documents\금융콜센터AI\kda4-k7-product` (프론트).
- **백엔드 파일을 만지지 않는다.** product `main`에 진행 중인 모노레포 이식의 미커밋 백엔드 파일이 있으므로, 커밋은 항상 명시적 경로(`src/...`)로만 한다. `git add -A`·`git add .` 금지.
- 계약(`contracts.py`, `database/contracts/*.json`, `src/services/consultationContract.ts`)을 바꾸지 않는다. wire의 `emotion.level`은 `stable/caution/elevated` 그대로.
- 감정 라벨: `stable`="안정", `caution`="주의", `elevated`="집중 대응".
- 안내문구(정확히 이 문장): `감정온도는 음성·발화 내용을 기반으로 산출한 상담 보조지표입니다. 고객의 실제 감정이나 위험 여부를 확정하지 않습니다.`
- 긴급 배지 문구 "긴급 · 사고 징후 감지"는 **바꾸지 않는다**.
- 프론트에 단위 테스트 러너가 없다. 검증은 `npm run check`와 시각 E2E로 한다.
- 커밋 prefix: `feat:`/`fix:`/`chore:`.

---

### Task 1: 감정 라벨 "고조" → "집중 대응"

**Files:**
- Modify: `src/hooks/useCallFlow.ts` (`EMOTION_LABELS` 상수)

**Interfaces:**
- Consumes: 없음
- Produces: `EMOTION_LABELS.elevated === "집중 대응"` — `PrepCard`·`ActiveCall`이 `vm.prepEmotionLabel`로 소비(이미 배선돼 있어 추가 작업 없음)

- [ ] **Step 1: 현재 라벨 확인**

```bash
cd "C:/Users/natur/Documents/금융콜센터AI/kda4-k7-product"
grep -n "EMOTION_LABELS = " src/hooks/useCallFlow.ts
```
Expected: `const EMOTION_LABELS = { stable: "안정", caution: "주의", elevated: "고조" } as const;`

- [ ] **Step 2: 라벨 변경**

`src/hooks/useCallFlow.ts`에서 다음 줄을

```typescript
const EMOTION_LABELS = { stable: "안정", caution: "주의", elevated: "고조" } as const;
```

다음으로 바꾼다:

```typescript
const EMOTION_LABELS = { stable: "안정", caution: "주의", elevated: "집중 대응" } as const;
```

- [ ] **Step 3: 타입 체크**

```bash
cd "C:/Users/natur/Documents/금융콜센터AI/kda4-k7-product"
npx tsc --noEmit
```
Expected: 에러 없음. `EMOTION_LABELS`는 `as const`라 값 타입이 넓어질 뿐 소비처(`vm.prepEmotionLabel: string`)에 영향 없음

- [ ] **Step 4: 커밋**

```bash
cd "C:/Users/natur/Documents/금융콜센터AI/kda4-k7-product"
git add src/hooks/useCallFlow.ts
git commit -m "fix(emotion): 감정 라벨 '고조' -> '집중 대응'

백엔드 검토안(2026-07-24) 감정온도 3단계 표기(안정/주의/집중 대응)에 맞춘다.
계약값(stable/caution/elevated)은 유지, 화면 표시 라벨만 변경."
```

---

### Task 2: PrepCard — 사고징후 카드 제거 + 안내문구 + 미사용 변수 정리

**Files:**
- Modify: `src/components/desktop/PrepCard.tsx`

**Interfaces:**
- Consumes: 없음
- Produces: 없음 (최종 UI)

- [ ] **Step 1: 대상 블록 확인**

```bash
cd "C:/Users/natur/Documents/금융콜센터AI/kda4-k7-product"
grep -n "사고 징후 <span\|const riskHigh" src/components/desktop/PrepCard.tsx
```
Expected: `const riskHigh = ...`(11행 부근)과 `사고 징후 <span ...>(위험도)`(128행 부근)

- [ ] **Step 2: 사고징후 카드를 안내문구로 교체**

`src/components/desktop/PrepCard.tsx`에서 사고징후 카드 블록 전체를 찾는다. 다음 블록(감정온도 카드 닫는 `</div>` **다음**, 좌측 컬럼 닫는 `</div>` **앞**):

```tsx
            <div style={css("flex:1;min-height:104px;border-radius:8px;padding:12px 14px;background:" + (riskHigh ? "var(--red-800)" : "var(--gray-100)"))}>
              <div style={css("font:600 11px 'Geist Sans','Pretendard',sans-serif;margin-bottom:7px;color:" + (riskHigh ? "rgba(255,255,255,.85)" : "var(--gray-700)"))}>
                사고 징후 <span style={css("font-weight:400;opacity:.7")}>(위험도)</span>
              </div>
              <div style={css("display:flex;align-items:center;gap:9px")}>
                <span style={css("width:12px;height:12px;border-radius:9999px;flex:none;background:" + (riskHigh ? "#fff" : "var(--green-700)"))} />
                <span style={css("font:800 26px 'Geist Sans','Pretendard',sans-serif;letter-spacing:-.8px;color:" + (riskHigh ? "#fff" : "var(--gray-1000)"))}>{vm.prepRiskLabel}</span>
              </div>
              <div style={css("font:400 11.5px/1.45 'Geist Sans','Pretendard',sans-serif;margin-top:6px;color:" + (riskHigh ? "rgba(255,255,255,.88)" : "var(--gray-600)"))}>{vm.prepRiskSignal}</div>
            </div>
```

를 다음으로 바꾼다:

```tsx
            {/* 감정온도 안내 — 사고징후 카드 제거(검토안 4절), 표현 원칙(3절)을 화면에 명시 */}
            <div style={css("flex:1;min-height:104px;background:var(--gray-100);border-radius:8px;padding:12px 14px;display:flex;align-items:center")}>
              <div style={css("font:400 11px/1.65 'Geist Sans','Pretendard',sans-serif;color:var(--gray-500)")}>
                감정온도는 음성·발화 내용을 기반으로 산출한 상담 보조지표입니다. 고객의 실제 감정이나 위험 여부를 확정하지 않습니다.
              </div>
            </div>
```

- [ ] **Step 3: 미사용 `riskHigh` 제거**

`riskHigh`는 위에서 제거한 카드에서만 쓰였다. 다음 줄(11행 부근)을 삭제한다:

```tsx
  const riskHigh = vm.prepRiskLabel === "높음"; // 위험일 때만 강한 색(빨강)
```

- [ ] **Step 4: `riskHigh`가 완전히 사라졌는지 확인**

```bash
cd "C:/Users/natur/Documents/금융콜센터AI/kda4-k7-product"
grep -n "riskHigh\|사고 징후" src/components/desktop/PrepCard.tsx
```
Expected: 헤더 배지의 "긴급 · 사고 징후 감지"만 남고(유지 대상), `riskHigh`와 위험도 카드는 없음

- [ ] **Step 5: 타입 체크·빌드**

```bash
cd "C:/Users/natur/Documents/금융콜센터AI/kda4-k7-product"
npx tsc --noEmit && npm run build
```
Expected: 에러 없이 빌드 성공

- [ ] **Step 6: 커밋**

```bash
cd "C:/Users/natur/Documents/금융콜센터AI/kda4-k7-product"
git add src/components/desktop/PrepCard.tsx
git commit -m "feat(card): 준비 카드 사고징후 위험도 카드 제거 + 감정온도 안내문구

검토안 4절대로 사고징후 카드를 UI에서 걷어내고, 빈 좌측 자리에 감정온도가
보조지표임을 명시하는 안내문구(3절 표현 원칙)를 넣는다. 백엔드 judge와
금융사고 라우팅은 유지, 헤더 긴급 배지도 유지. 미사용 riskHigh 정리."
```

---

### Task 3: ActiveCall — 통화 중 인라인 사고징후 제거

**Files:**
- Modify: `src/components/desktop/ActiveCall.tsx`

**Interfaces:**
- Consumes: 없음
- Produces: 없음 (최종 UI)

- [ ] **Step 1: 대상 확인**

```bash
cd "C:/Users/natur/Documents/금융콜센터AI/kda4-k7-product"
grep -n "사고 징후\|gpp_maybe" src/components/desktop/ActiveCall.tsx
```
Expected: 스탯바 인라인 항목(아이콘 `gpp_maybe` + "사고 징후" + `vm.prepRiskLabel`)

- [ ] **Step 2: 구분선 + 사고징후 span 제거**

`src/components/desktop/ActiveCall.tsx`에서 감정 라벨 span의 닫는 `</span>` **다음**의 구분선과 사고징후 span을 함께 제거한다. 다음 블록을

```tsx
          <span style={css("width:1.3px;height:22px;background:var(--gray-200)")} />
          <span style={css("display:flex;align-items:center;gap:5px")}>
            <span className="mi" style={css("font-size:15px;color:" + vm.prepRiskFg)}>gpp_maybe</span>
            <span style={css("font:500 11px 'Geist Sans','Pretendard',sans-serif;color:var(--gray-700)")}>사고 징후</span>
            <span style={css("font:600 14px 'Geist Sans','Pretendard',sans-serif;color:" + vm.prepRiskFg)}>{vm.prepRiskLabel}</span>
          </span>
```

**전부 삭제**한다. 삭제 후 스탯바는 `감정 라벨 | 시계`가 된다(감정 span 다음이 곧 시계 span의 앞 구분선/시계로 이어짐).

> 주의: 감정 span과 시계 span 사이에 구분선이 하나만 남도록 한다. 위 블록의 첫 줄(구분선)을
> 지우면 감정 span 바로 뒤에 시계 앞 구분선(있다면)이 온다. 삭제 후 Step 4 스크린샷으로 구분선이
> 이중으로 남거나 빠지지 않았는지 육안 확인한다.

- [ ] **Step 3: 타입 체크·빌드**

```bash
cd "C:/Users/natur/Documents/금융콜센터AI/kda4-k7-product"
npx tsc --noEmit && npm run build
```
Expected: 에러 없이 빌드 성공. `vm.prepRiskFg`·`vm.prepRiskLabel`은 뷰모델에 남아 있어도 무해(다른 정리 대상 아님)

- [ ] **Step 4: 커밋**

```bash
cd "C:/Users/natur/Documents/금융콜센터AI/kda4-k7-product"
git add src/components/desktop/ActiveCall.tsx
git commit -m "feat(call): 통화 화면 인라인 사고징후 표시 제거

준비 카드와 일관되게 통화 중 스탯바에서도 사고징후 항목을 제거한다.
스탯바는 감정 라벨 | 시계로 정리된다. 백엔드 탐지는 유지."
```

---

### Task 4: 통합 검증 (계약 무변경 + 시각 E2E)

**Files:**
- 코드 변경 없음

**Interfaces:**
- Consumes: Task 1~3
- Produces: 없음

- [ ] **Step 1: 전체 검증 (계약 무변경 증명 포함)**

```bash
cd "C:/Users/natur/Documents/금융콜센터AI/kda4-k7-product"
npm run check
```
Expected: PASS. `validate:manifest`·`validate:contracts`·`validate:adapter`·`validate:frontend-contract`·`build` 전부 통과. 계약 파일을 안 건드렸으므로 contract 검증이 통과하면 무변경이 증명된다

- [ ] **Step 2: preview 재빌드·재기동**

현재 preview(4173)가 떠 있으면 새 빌드 반영을 위해 재기동한다.

```bash
cd "C:/Users/natur/Documents/금융콜센터AI/kda4-k7-product"
# 기존 4173 종료 후
npm run preview -- --host 0.0.0.0 --port 4173
```

- [ ] **Step 3: 시각 E2E — 준비 카드**

브라우저에서 시연 화면 접속(핫스팟 사용 중이면 `http://192.168.137.1:4173/`, 아니면 `http://192.168.11.135:4173/`) → 시연 WAV 업로드 → 준비 카드 확인.

Expected:
- 좌측에 **사고징후(위험도) 카드가 없음**
- 그 자리에 **"감정온도는 음성·발화 내용을 기반으로… 확정하지 않습니다."** 안내문구
- 감정 라벨이 점수 밴드에 맞게 표시. 점수 66 초과면 **"집중 대응"**(과거 "고조" 아님)

- [ ] **Step 4: 시각 E2E — 통화 화면**

준비 카드에서 "통화 연결"로 진행 → 통화 중 스탯바 확인.

Expected: 스탯바에 **사고징후 항목이 없음**. 감정 라벨과 시계만 표시. 구분선이 이중/누락 없이 정상

- [ ] **Step 5: 긴급 배지 유지 확인**

초기화 → 상단 수신 토글 **긴급** → 시연 WAV 업로드 → 준비 카드 헤더 확인.

Expected: 헤더 배지가 **"긴급 · 사고 징후 감지"** 로 그대로 표시(문구 미변경). 위험도 카드는 여전히 없음

- [ ] **Step 6: 완료 보고**

세 커밋(라벨·PrepCard·ActiveCall)과 검증 결과를 정리해 이희창에게 보고한다. `main` 머지 여부는 사람이 판단한다(product 거버넌스). 진행 중인 백엔드 이식과 별개 파일이므로 독립적으로 머지 가능하다.

---

## 검토 메모

**스펙 대비 커버리지**
- 사고징후 카드 제거(PrepCard) → Task 2
- 빈 자리 안내문구 → Task 2 Step 2
- 사고징후 인라인 제거(ActiveCall) → Task 3
- 감정 라벨 고조→집중 대응 → Task 1
- 긴급 배지 문구 유지 → Task 2 Step 4(확인), Task 4 Step 5(검증)
- 계약 무변경 → Global Constraints + Task 4 Step 1
- 백엔드 유지 → 어느 태스크도 백엔드를 만지지 않음

**범위 밖(스펙 미해결)**: 첫 응대 문장 감정 연계(1c, 이식 후 customer_request_points와), 감정+숙련도 라우팅(2단계), 성과·교육(3단계), 검토안 9절 통합 응답 구조.
