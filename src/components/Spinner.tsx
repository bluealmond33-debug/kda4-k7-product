import { css } from "../lib/css";
import { BrandSymbol } from "./BrandLogo";

/**
 * KARI-NA 로딩 스피너 — 마주 보는 두 아크가 한 궤도를 돈다.
 * 기존 '테두리 한 줄' 스피너를 대체한다: 짙은 아크(blue-700) + 옅은 아크(blue-400)가
 * 180° 마주 보고 함께 회전해 깊이가 생긴다. 가운데엔 KARI-NA 브랜드 심볼을 정지 상태로
 * 얹어, 도는 건 궤도뿐이고 브랜드는 가만히 중심을 지킨다.
 *
 * size — 바깥 지름(px). mark=true면 가운데 브랜드 심볼(약 size≥40에서만 또렷).
 * 회전은 전역 @keyframes spin(global.css) 재사용.
 */
export default function Spinner({
  size = 26,
  mark = false,
  speedMs = 900,
}: {
  size?: number;
  mark?: boolean;
  speedMs?: number;
}) {
  // r=18, 원주 ≈ 113.1 → 한 아크 34(≈108°), 나머지 79.1은 간격. 두 원을 180° 어긋나게 겹친다.
  const dash = "34 79.1";
  return (
    <span
      role="status"
      aria-label="불러오는 중"
      style={css(
        "position:relative;display:inline-flex;flex:none;align-items:center;justify-content:center;width:" +
          size +
          "px;height:" +
          size +
          "px"
      )}
    >
      <svg
        viewBox="0 0 48 48"
        width={size}
        height={size}
        style={{ animation: `spin ${speedMs}ms linear infinite`, display: "block" }}
        aria-hidden="true"
      >
        <circle cx="24" cy="24" r="18" fill="none" stroke="var(--blue-700)" strokeWidth="5" strokeLinecap="round" strokeDasharray={dash} />
        <circle cx="24" cy="24" r="18" fill="none" stroke="var(--blue-400)" strokeWidth="5" strokeLinecap="round" strokeDasharray={dash} transform="rotate(180 24 24)" />
      </svg>
      {mark && (
        <span style={{ position: "absolute", display: "flex" }}>
          <BrandSymbol size={size * 0.34} color="var(--blue-700)" />
        </span>
      )}
    </span>
  );
}
