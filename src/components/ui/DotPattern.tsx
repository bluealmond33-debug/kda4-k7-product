import { useId } from "react";
import { css } from "../../lib/css";

/**
 * 점 격자 배경 (Magic UI DotPattern 이식).
 *
 * Tailwind·framer-motion을 쓰지 않는 코드베이스라 SVG `<pattern>` 하나로 다시 썼다.
 * 부모가 `position:relative`여야 하고, 자신은 절대배치로 깔린다.
 *
 * 온에어 문법 주의: 배경은 **바닥의 결**이지 요소가 아니다. 기본 불투명도를 낮게 두고
 * 색도 중립 그레이만 쓴다 — 틴트가 들어가면 카드 면이 색을 머금은 것처럼 보인다.
 * `fade`를 켜면 가장자리로 갈수록 사라져 패널 경계에서 격자가 잘린 티가 나지 않는다.
 */
export default function DotPattern({
  gap = 16,
  r = 1,
  color = "var(--gray-500)",
  opacity = 0.28,
  fade = true,
  offsetX = 0,
  offsetY = 0,
}: {
  /** 점 간격(px) */
  gap?: number;
  /** 점 반지름(px) */
  r?: number;
  color?: string;
  opacity?: number;
  /** 중심에서 바깥으로 흐려짐 */
  fade?: boolean;
  offsetX?: number;
  offsetY?: number;
}) {
  const id = useId().replace(/:/g, "");
  const mask = fade
    ? "radial-gradient(ellipse at center, #000 30%, transparent 78%)"
    : undefined;
  return (
    <svg
      aria-hidden="true"
      style={{
        ...css("position:absolute;inset:0;width:100%;height:100%;pointer-events:none"),
        opacity,
        ...(mask ? { maskImage: mask, WebkitMaskImage: mask } : null),
      }}
    >
      <defs>
        <pattern id={id} width={gap} height={gap} patternUnits="userSpaceOnUse" x={offsetX} y={offsetY}>
          <circle cx={r} cy={r} r={r} fill={color} />
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill={`url(#${id})`} />
    </svg>
  );
}
