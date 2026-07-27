import { css } from "../../lib/css";

/**
 * 원형 게이지 (Magic UI AnimatedCircularProgressBar 이식).
 *
 * stroke-dasharray로 원 둘레를 잘라 채운다. 값이 바뀌면 CSS transition이 이어 그리므로
 * 1초마다 값이 떨어지는 카운트다운도 뚝뚝 끊기지 않고 흐른다.
 *
 * 12시에서 시작해 시계방향으로 도는 게 사람이 시간으로 읽는 방향이라 -90도 돌려 둔다.
 * 남은 시간용이므로 기본은 **줄어드는** 게이지다 — 채워지는 게이지는 "곧 끝난다"가 아니라
 * "얼마나 했다"로 읽힌다.
 */
export default function AnimatedCircularProgress({
  value,
  max = 100,
  min = 0,
  size = 40,
  stroke = 3.5,
  primary = "var(--blue-700)",
  secondary = "rgba(255,255,255,.28)",
  children,
  transitionMs = 950,
}: {
  value: number;
  max?: number;
  min?: number;
  size?: number;
  stroke?: number;
  /** 채워진 호 색 */
  primary?: string;
  /** 남은 호(바탕) 색 */
  secondary?: string;
  /** 가운데에 놓을 것 — 보통 남은 초 숫자 */
  children?: React.ReactNode;
  transitionMs?: number;
}) {
  const span = Math.max(1, max - min);
  const pct = Math.min(1, Math.max(0, (value - min) / span));
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  return (
    <span style={{ ...css("position:relative;display:inline-flex;align-items:center;justify-content:center;flex:none"), width: size, height: size }}>
      <svg width={size} height={size} style={{ transform: "rotate(-90deg)" }} aria-hidden="true">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={secondary} strokeWidth={stroke} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={primary}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - pct)}
          style={{ transition: `stroke-dashoffset ${transitionMs}ms linear` }}
        />
      </svg>
      {children != null && (
        <span style={css("position:absolute;inset:0;display:flex;align-items:center;justify-content:center")}>{children}</span>
      )}
    </span>
  );
}
