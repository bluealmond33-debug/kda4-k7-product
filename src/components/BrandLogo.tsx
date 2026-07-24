import { css } from "../lib/css";

/**
 * KARI-NA 브랜드 심볼 — 마주 보는 두 로브(공식 로고 PNG에서 실루엣 추출, viewBox 164×147).
 * 원본 브랜드 블루가 #2F5FC4 로 제품 토큰 --blue-700 과 정확히 같아 currentColor로 물려 쓴다.
 * 검은 무대/역상에서는 color만 흰색으로 주면 된다.
 */
export function BrandSymbol({ size = 22, color }: { size?: number; color?: string }) {
  return (
    <svg
      viewBox="0 0 164 147"
      width={Math.round(size * (164 / 147))}
      height={size}
      fill={color ?? "currentColor"}
      aria-hidden="true"
      style={{ display: "block", flex: "none" }}
    >
      <path d="M61 0 L55 0 L37 3 L29 6 L22 9 L17 12 L13 15 L10 18 L7 21 L5 24 L3 27 L2 30 L1 33 L0 36 L0 39 L0 42 L0 45 L1 48 L2 51 L4 54 L6 57 L9 60 L12 63 L15 66 L20 69 L26 72 L24 75 L18 78 L14 81 L11 84 L8 87 L5 90 L4 93 L2 96 L1 99 L0 102 L0 105 L0 108 L0 111 L1 114 L2 117 L4 120 L5 123 L8 126 L11 129 L14 132 L19 135 L24 138 L31 141 L41 144 L53 146 L61 146 Z" />
      <path d="M103 0 L109 0 L127 3 L135 6 L142 9 L147 12 L151 15 L154 18 L157 21 L159 24 L161 27 L162 30 L163 33 L164 36 L164 39 L164 42 L164 45 L163 48 L162 51 L160 54 L158 57 L155 60 L152 63 L149 66 L144 69 L138 72 L140 75 L146 78 L150 81 L153 84 L156 87 L159 90 L160 93 L162 96 L163 99 L164 102 L164 105 L164 108 L164 111 L163 114 L162 117 L160 120 L159 123 L156 126 L153 129 L150 132 L145 135 L140 138 L133 141 L123 144 L111 146 L103 146 Z" />
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
