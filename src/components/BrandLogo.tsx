import { css } from "../lib/css";
import { BRAND_MARK_PNG } from "../assets/brandMark";
import { BRAND_LOCKUP_PNG, BRAND_LOCKUP_RATIO } from "../assets/brandLockup";

const MARK_W = 186, MARK_H = 173; // 공식 아트워크 원본 비율

/**
 * KARI-NA 브랜드 심볼 — 공식 아트워크(브랜드 시스템 아티팩트 원본 PNG)를 CSS mask로 렌더.
 * 손으로 딴 SVG가 엉성해 실제 아트워크로 교체했다. PNG의 알파(=심볼 실루엣)를 마스크로 쓰고
 * background 색을 채우므로, 네이티브 색과 무관하게 blue/흰/검정 어떤 색이든 또렷하게 나온다.
 */
export function BrandSymbol({ size = 22, color }: { size?: number; color?: string }) {
  const w = Math.round(size * (MARK_W / MARK_H));
  return (
    <span
      aria-hidden="true"
      style={{
        display: "block",
        flex: "none",
        width: w + "px",
        height: size + "px",
        background: color ?? "var(--blue-700)",
        WebkitMaskImage: `url("${BRAND_MARK_PNG}")`,
        maskImage: `url("${BRAND_MARK_PNG}")`,
        WebkitMaskSize: "contain",
        maskSize: "contain",
        WebkitMaskRepeat: "no-repeat",
        maskRepeat: "no-repeat",
        WebkitMaskPosition: "center",
        maskPosition: "center",
      }}
    />
  );
}

/**
 * KARI-NA 마스코트 얼굴 — 로딩/접수 연출용 친근한 표정. 브랜드 색 라운드 블롭 + 흰 눈·미소.
 * (브랜드 심볼과 별개: 로고 대신 '얼굴'을 넣어 달라는 요청.)
 */
export function BrandFace({
  size = 40,
  color = "var(--blue-700)",
}: {
  size?: number;
  color?: string;
}) {
  // 배경(흰 원)은 스피너가 깔아 준다 — 여기는 파란 표정(눈·미소)만. 세로 캡슐 눈 + 채워진 반원 미소.
  return (
    <svg viewBox="0 0 100 100" width={size} height={size} style={{ display: "block", flex: "none" }} aria-hidden="true">
      {/* 눈 — 세로 캡슐 */}
      <rect x="31" y="30" width="12" height="27" rx="6" fill={color} />
      <rect x="57" y="30" width="12" height="27" rx="6" fill={color} />
      {/* 미소 — 채워진 반원(위 평평·아래 둥근) */}
      <path d="M27 62 A23 20 0 0 0 73 62 Z" fill={color} />
    </svg>
  );
}

/**
 * 심볼 + 워드마크 가로 락업 — **공식 아트워크 이미지 그대로** 쓴다.
 *
 * 예전에는 심볼(마스크) 옆에 "KARI-NA"를 Avenir Next로 조판해 붙였다. 자간을 흉내 내도 실제
 * 로고와 자형·굵기가 달라서, 같은 화면에 진짜 락업(카드 헤더)과 나란히 놓이면 두 로고가
 * 서로 다르게 보였다. 브랜드는 한 벌만 있어야 하므로 여기도 원본 PNG를 쓴다.
 *
 * 원본이 이미 파란 심볼 + 검정 워드마크 + 태그라인 3단이므로 색·태그라인 옵션이 없다.
 * 색을 칠해야 하는 자리(어두운 면 위 흰 로고 등)는 워드마크 없이 BrandSymbol을 쓴다 —
 * 그쪽은 알파 마스크라 어떤 색이든 칠할 수 있다.
 */
export default function BrandLogo({ size = 22 }: { size?: number }) {
  // size = 심볼 높이 기준. 락업은 심볼보다 세로가 조금 낮으므로(태그라인 포함 정렬)
  // 시각적으로 같은 무게가 되도록 1.28배로 세운다.
  const h = Math.round(size * 1.28);
  return (
    <img
      src={BRAND_LOCKUP_PNG}
      alt="KARI-NA · Response Innovation"
      style={{ display: "block", flex: "none", height: h, width: h * BRAND_LOCKUP_RATIO }}
    />
  );
}
