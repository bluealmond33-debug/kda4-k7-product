import { useCallback, useEffect, useRef, useState } from "react";

/**
 * 고정 비율 스테이지 — stageW×stageH로 디자인한 화면을 뷰포트에 맞춰 균등 축소한다.
 * 직원 화면(LiveDemo)의 1420px 스테이지 스케일과 같은 원리: 레이아웃을 폭에 따라
 * 리플로우시키지 않고, 완성된 캔버스 하나를 통째로 scale()로 줄여 항상 같은 비율로 보인다.
 * 가로·세로 둘 다에 맞춰(min) 레터박스, 확대는 하지 않는다(≤1 — 텍스트 선명도 유지).
 */
export function useStageFit(stageW: number, stageH: number, margin = 28) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [scale, setScale] = useState(1);

  const fit = useCallback(() => {
    const el = rootRef.current;
    const availW = (el ? el.clientWidth : window.innerWidth) - margin;
    const availH = (el ? el.clientHeight : window.innerHeight) - margin;
    const sc = Math.max(0.1, Math.min(1, availW / stageW, availH / stageH));
    setScale((prev) => (Math.abs(prev - sc) > 0.0005 ? sc : prev));
  }, [stageW, stageH, margin]);

  useEffect(() => {
    fit();
    const onResize = () => fit();
    window.addEventListener("resize", onResize);
    let ro: ResizeObserver | null = null;
    if (typeof ResizeObserver !== "undefined" && rootRef.current) {
      ro = new ResizeObserver(() => fit());
      ro.observe(rootRef.current);
    }
    return () => {
      window.removeEventListener("resize", onResize);
      ro?.disconnect();
    };
  }, [fit]);

  return { rootRef, scale };
}
