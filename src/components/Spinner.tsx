import { css } from "../lib/css";
import { BrandFace } from "./BrandLogo";

/**
 * KARI-NA 로딩 스피너.
 * mark=false(작은 인라인): 짙은 아크(blue-700)+옅은 아크(blue-400)가 180° 마주 보고 회전.
 * mark=true(큰 로딩 연출): 두꺼운 파란 스우시가 돌고, 가운데 흰 원에 마스코트 얼굴이 가만히 있다.
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
  if (mark) {
    // 두꺼운 파란 스우시(~270° 라운드 아크) + 흰 중심 원 + 얼굴
    const disc = Math.round(size * 0.6);
    const face = size * 0.42;
    return (
      <span
        role="status"
        aria-label="불러오는 중"
        style={css("position:relative;display:inline-flex;flex:none;align-items:center;justify-content:center;width:" + size + "px;height:" + size + "px")}
      >
        <svg
          viewBox="0 0 48 48"
          width={size}
          height={size}
          style={{ animation: `spin ${speedMs}ms linear infinite`, display: "block" }}
          aria-hidden="true"
        >
          {/* 원주 2π·20 ≈ 125.7 → on 90.5(≈259°) 남김 gap. 라운드 캡의 도는 스우시 */}
          <circle cx="24" cy="24" r="20" fill="none" stroke="var(--blue-700)" strokeWidth="8" strokeLinecap="round" strokeDasharray="90.5 126" />
        </svg>
        {/* 흰 중심 원 — 얼굴 바탕. 아크 위로 살짝 떠 보이게 옅은 그림자 */}
        <span
          style={css("position:absolute;display:flex;align-items:center;justify-content:center;width:" + disc + "px;height:" + disc + "px;border-radius:9999px;background:#fff;box-shadow:0 1px 5px rgba(20,23,28,.14)")}
        >
          <BrandFace size={face} />
        </span>
      </span>
    );
  }

  // 작은 인라인 — 마주 보는 두 아크. r=18, 원주 ≈ 113.1 → 한 아크 34(≈108°), 나머지 79.1 간격.
  const dash = "34 79.1";
  return (
    <span
      role="status"
      aria-label="불러오는 중"
      style={css("position:relative;display:inline-flex;flex:none;align-items:center;justify-content:center;width:" + size + "px;height:" + size + "px")}
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
    </span>
  );
}
