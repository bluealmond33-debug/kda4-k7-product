import { css } from "../lib/css";
import { BRAND_MARK_PNG } from "../assets/brandMark";

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
  ink = "#fff",
}: {
  size?: number;
  color?: string;
  ink?: string;
}) {
  return (
    <svg viewBox="0 0 100 100" width={size} height={size} style={{ display: "block", flex: "none" }} aria-hidden="true">
      {/* 라운드 블롭 얼굴 바탕 */}
      <rect x="7" y="7" width="86" height="86" rx="31" fill={color} />
      {/* 눈 */}
      <circle cx="37" cy="43" r="6.2" fill={ink} />
      <circle cx="63" cy="43" r="6.2" fill={ink} />
      {/* 미소 */}
      <path d="M34 59 Q50 74 66 59" fill="none" stroke={ink} strokeWidth="6.4" strokeLinecap="round" />
    </svg>
  );
}

/**
 * 심볼 + KARI-NA 워드마크 가로 락업. 워드마크는 Avenir Next(라틴 주서체)로 조판하고
 * 공식 로고처럼 자간을 넓게 준다. tagline을 켜면 'Response Innovation'이 아래 붙는다.
 */
export default function BrandLogo({
  size = 22,
  color,
  symbolColor,
  tagline = false,
  wordmark = true,
}: {
  size?: number;
  /** 워드마크(KARI-NA) 잉크. 공식 락업은 검정(--gray-1000) */
  color?: string;
  /** 심볼 색을 워드마크와 다르게 줄 때(공식 = 파란 심볼 + 검정 워드마크). 없으면 color를 따른다 */
  symbolColor?: string;
  tagline?: boolean;
  wordmark?: boolean;
}) {
  const ink = color ?? "currentColor";
  if (!wordmark) return <BrandSymbol size={size} color={symbolColor ?? color} />;
  return (
    <span style={css("display:inline-flex;align-items:center;gap:" + Math.round(size * 0.42) + "px")}>
      <BrandSymbol size={size} color={symbolColor ?? color} />
      <span style={css("display:flex;flex-direction:column;gap:1px")}>
        <span
          style={css(
            "font:500 " + Math.round(size * 0.92) + "px 'Avenir Next','Pretendard',sans-serif;letter-spacing:" +
              (size * 0.055).toFixed(2) + "px;line-height:1;color:" + ink
          )}
        >
          KARI-NA
        </span>
        {tagline && (
          <span
            style={css(
              "font:400 " + Math.round(size * 0.3) + "px 'Avenir Next','Pretendard',sans-serif;letter-spacing:" +
                (size * 0.06).toFixed(2) + "px;line-height:1;color:" + ink + ";opacity:.72"
            )}
          >
            Response Innovation
          </span>
        )}
      </span>
    </span>
  );
}
