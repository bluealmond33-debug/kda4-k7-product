/**
 * 상담 카드 공용 시각 요소 — 준비 카드(PrepCard)와 관리자 카드(CallCardModal)가 함께 쓴다.
 * 색은 '신호'에만: 감정온도 온도계 수은/텍스트, 확신 링은 잉크(무채색).
 */

/** 확신도 도넛 게이지 — 잉크 아크가 %만큼 채워지고 숫자는 링 안 중앙(색 없이 강조). */
export function ConfidenceRing({ pct }: { pct: number }) {
  const S = 40, cx = S / 2, r = 16, C = 2 * Math.PI * r;
  const off = C * (1 - Math.max(0, Math.min(100, pct)) / 100);
  return (
    <svg width={S} height={S} viewBox={"0 0 " + S + " " + S} style={{ flex: "none", display: "block" }}>
      <circle cx={cx} cy={cx} r={r} fill="none" stroke="var(--gray-200)" strokeWidth="4" />
      <circle cx={cx} cy={cx} r={r} fill="none" stroke="var(--gray-1000)" strokeWidth="4" strokeDasharray={C} strokeDashoffset={off} strokeLinecap="round" transform={"rotate(-90 " + cx + " " + cx + ")"} />
      <text x={cx} y={cx + 0.5} textAnchor="middle" dominantBaseline="central" style={{ font: "800 14px 'Avenir Next','Pretendard',sans-serif", letterSpacing: "-0.5px", fill: "var(--gray-1000)" }}>{pct}</text>
    </svg>
  );
}

/** 세로 온도계 — 흰 유리관 + 회색 외곽 + 눈금 + 하이라이트, 수은 높이=감정 점수(0~100), 색은 레벨 색. */
export function Thermometer({ score, color }: { score: number | null; color: string }) {
  const W = 20,
    H = 54,
    cx = 10;
  const tubeW = 8,
    tubeX = cx - tubeW / 2,
    top = 4,
    bulbCy = 43,
    bulbR = 8,
    tubeBot = bulbCy;
  const innerW = 3.5,
    innerX = cx - innerW / 2,
    innerTop = top + 3,
    innerBot = bulbCy - 3;
  const pct = Math.max(0, Math.min(100, score ?? 0)) / 100;
  const fillTop = innerBot - (innerBot - innerTop) * pct;
  const ticks = [0.75, 0.5, 0.25].map((t) => innerBot - (innerBot - innerTop) * t);
  return (
    <svg width={W} height={H} viewBox={"0 0 " + W + " " + H} style={{ flex: "none", display: "block" }}>
      <rect x={tubeX} y={top} width={tubeW} height={tubeBot - top} rx={tubeW / 2} fill="#fff" stroke="var(--gray-300)" strokeWidth="1.5" />
      <circle cx={cx} cy={bulbCy} r={bulbR} fill="#fff" stroke="var(--gray-300)" strokeWidth="1.5" />
      {ticks.map((y, i) => (
        <line key={i} x1={tubeX + tubeW} y1={y} x2={tubeX + tubeW + 3} y2={y} stroke="var(--gray-300)" strokeWidth="1.2" strokeLinecap="round" />
      ))}
      <circle cx={cx} cy={bulbCy} r={bulbR - 3.5} fill={color} />
      <rect x={innerX} y={fillTop} width={innerW} height={bulbCy - fillTop} rx={innerW / 2} fill={color} />
      <rect x={tubeX + 1.3} y={top + 3} width="1.3" height={tubeBot - top - 12} rx="0.65" fill="rgba(255,255,255,.75)" />
    </svg>
  );
}

/** 감정 레벨(안정/주의/고조) → 대표 점수·색. 점수 데이터가 없는 화면(관리자)에서 온도계 표시용. */
export const EMOTION_LABEL: Record<string, string> = { stable: "안정", caution: "주의", elevated: "고조" };
export const EMOTION_SCORE: Record<string, number> = { stable: 24, caution: 55, elevated: 84 };
export const EMOTION_INK: Record<string, string> = {
  stable: "var(--green-700)",
  caution: "var(--amber-700)",
  elevated: "var(--red-700)",
};
