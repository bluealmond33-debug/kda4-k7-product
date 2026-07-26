import { useEffect, useId, useState, type RefObject } from "react";

/**
 * 연결 빔 (Magic UI AnimatedBeam 이식).
 *
 * 두 요소 사이에 곡선을 긋고, 그 위로 빛 한 덩이가 흐른다 — "여기서 저기로 간다"를
 * 화살표보다 정확히 말한다. framer-motion 없이 SVG `<animate>`(SMIL)로 그라데이션
 * 좌표만 움직인다: JS 프레임 루프가 없어 관제 화면이 여러 개 떠 있어도 비용이 거의 없다.
 *
 * 좌표 주의 — 관리자 스테이지는 `transform: scale()` 안에 있다.
 * getBoundingClientRect는 **확대된** 픽셀을 주는데 SVG는 확대 전 좌표계에 그려지므로,
 * 컨테이너의 rect/offsetWidth 비율로 나눠 되돌린다. 이걸 빠뜨리면 스케일이 1이 아닌
 * 모니터에서 선이 노드를 빗나간다.
 */
/**
 * 빔 한 줄 — **이미 있는 `<svg>` 안에** 그린다.
 *
 * 좌표를 아는 그림(분류 정책 캔버스처럼 노드 위치가 상수인 경우)은 DOM을 재지 않고
 * 경로를 바로 넘기면 된다. AnimatedBeam(측정형)도 속으로 이걸 쓴다 —
 * "빛이 흐른다"의 구현은 한 곳뿐이어야 화면마다 속도·색이 갈리지 않는다.
 */
export function BeamPath({
  d,
  x1,
  y1,
  x2,
  y2,
  duration = 3,
  delay = 0,
  reverse = false,
  pathColor = "var(--gray-400)",
  pathWidth = 1.6,
  pathOpacity = 0.5,
  gradientStartColor = "#2f5fc4",
  gradientStopColor = "#6ee0c8",
  active = true,
}: {
  /** SVG path d */
  d: string;
  /** 경로의 시작·끝 (빛이 지나갈 축) */
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  duration?: number;
  delay?: number;
  reverse?: boolean;
  pathColor?: string;
  pathWidth?: number;
  pathOpacity?: number;
  gradientStartColor?: string;
  gradientStopColor?: string;
  active?: boolean;
}) {
  const id = useId().replace(/:/g, "");
  /* 빛 덩이 = 그라데이션 창을 구간 밖에서 밖으로 통과시킨 것.
     좌표는 **픽셀(userSpaceOnUse)** 로 준다 — objectBoundingBox는 가로 일직선 구간에서
     bbox 높이가 0이라 그라데이션이 아예 그려지지 않는다(파이프라인 노드 행이 정확히 그 경우). */
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = Math.max(1, Math.hypot(dx, dy));
  const ux = dx / len;
  const uy = dy / len;
  const tail = len * 0.45; // 빛 덩이 길이
  const at = (t: number) => [x1 + ux * t, y1 + uy * t] as const;
  const [ax1, ay1] = at(-tail);
  const [ax2, ay2] = at(0);
  const [bx1, by1] = at(len);
  const [bx2, by2] = at(len + tail);
  const g = reverse
    ? { x1: [bx2, ax1], y1: [by2, ay1], x2: [bx1, ax2], y2: [by1, ay2] }
    : { x1: [ax1, bx2], y1: [ay1, by2], x2: [ax2, bx1], y2: [ay2, by1] };
  const vals = (v: number[]) => v.map((n) => n.toFixed(1)).join(";");
  return (
    <>
      <path d={d} stroke={pathColor} strokeWidth={pathWidth} strokeOpacity={pathOpacity} fill="none" strokeLinecap="round" />
      {active && (
        <>
          <path d={d} stroke={`url(#${id})`} strokeWidth={pathWidth + 0.8} fill="none" strokeLinecap="round" />
          <linearGradient id={id} gradientUnits="userSpaceOnUse">
            <stop stopColor={gradientStartColor} stopOpacity="0" />
            <stop offset="0.5" stopColor={gradientStartColor} />
            <stop offset="0.75" stopColor={gradientStopColor} />
            <stop offset="1" stopColor={gradientStopColor} stopOpacity="0" />
            <animate attributeName="x1" values={vals(g.x1)} dur={`${duration}s`} begin={`${delay}s`} repeatCount="indefinite" />
            <animate attributeName="y1" values={vals(g.y1)} dur={`${duration}s`} begin={`${delay}s`} repeatCount="indefinite" />
            <animate attributeName="x2" values={vals(g.x2)} dur={`${duration}s`} begin={`${delay}s`} repeatCount="indefinite" />
            <animate attributeName="y2" values={vals(g.y2)} dur={`${duration}s`} begin={`${delay}s`} repeatCount="indefinite" />
          </linearGradient>
        </>
      )}
    </>
  );
}

export default function AnimatedBeam({
  containerRef,
  fromRef,
  toRef,
  curvature = 0,
  reverse = false,
  duration = 3,
  delay = 0,
  pathColor = "var(--gray-400)",
  pathWidth = 1.6,
  pathOpacity = 0.5,
  gradientStartColor = "#2f5fc4",
  gradientStopColor = "#6ee0c8",
  active = true,
  startXOffset = 0,
  startYOffset = 0,
  endXOffset = 0,
  endYOffset = 0,
}: {
  containerRef: RefObject<HTMLElement | null>;
  fromRef: RefObject<HTMLElement | null>;
  toRef: RefObject<HTMLElement | null>;
  curvature?: number;
  reverse?: boolean;
  duration?: number;
  delay?: number;
  pathColor?: string;
  pathWidth?: number;
  pathOpacity?: number;
  gradientStartColor?: string;
  gradientStopColor?: string;
  /** 꺼지면 바탕선만 남는다 — 아직 지나가지 않은 구간 */
  active?: boolean;
  startXOffset?: number;
  startYOffset?: number;
  endXOffset?: number;
  endYOffset?: number;
}) {
  const id = useId().replace(/:/g, "");
  const [d, setD] = useState("");
  const [box, setBox] = useState({ w: 0, h: 0 });
  const [seg, setSeg] = useState({ x1: 0, y1: 0, x2: 0, y2: 0 });

  useEffect(() => {
    const measure = () => {
      const c = containerRef.current;
      const a = fromRef.current;
      const b = toRef.current;
      if (!c || !a || !b) return;
      const cr = c.getBoundingClientRect();
      // 스테이지 scale 되돌리기 — SVG는 확대 전 좌표계에 그린다
      const k = c.offsetWidth > 0 ? cr.width / c.offsetWidth : 1;
      const ar = a.getBoundingClientRect();
      const br = b.getBoundingClientRect();
      const x1 = (ar.left + ar.width / 2 - cr.left) / k + startXOffset;
      const y1 = (ar.top + ar.height / 2 - cr.top) / k + startYOffset;
      const x2 = (br.left + br.width / 2 - cr.left) / k + endXOffset;
      const y2 = (br.top + br.height / 2 - cr.top) / k + endYOffset;
      const mx = (x1 + x2) / 2;
      const my = (y1 + y2) / 2 - curvature;
      // 값이 그대로면 state를 건드리지 않는다 — 매번 새 객체를 넣으면 렌더→측정→렌더로 돈다
      setBox((p) => (p.w === c.offsetWidth && p.h === c.offsetHeight ? p : { w: c.offsetWidth, h: c.offsetHeight }));
      setSeg((p) => (p.x1 === x1 && p.y1 === y1 && p.x2 === x2 && p.y2 === y2 ? p : { x1, y1, x2, y2 }));
      setD(`M ${x1},${y1} Q ${mx},${my} ${x2},${y2}`);
    };
    measure();
    const ro = new ResizeObserver(measure);
    if (containerRef.current) ro.observe(containerRef.current);
    if (fromRef.current) ro.observe(fromRef.current);
    if (toRef.current) ro.observe(toRef.current);
    window.addEventListener("resize", measure);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [containerRef, fromRef, toRef, curvature, startXOffset, startYOffset, endXOffset, endYOffset]);

  if (!d) return null;
  return (
    <svg
      aria-hidden="true"
      width={box.w}
      height={box.h}
      viewBox={`0 0 ${box.w} ${box.h}`}
      /* 노드 **뒤**로 깔린다 — 중심끼리 이으므로 앞에 두면 선이 아이콘 타일을 가로지른다.
         뒤에 두면 빛이 타일 뒤를 지나가는 것으로 읽혀 흐름이 더 분명해진다. */
      style={{ position: "absolute", left: 0, top: 0, pointerEvents: "none", zIndex: 0 }}
    >
      <BeamPath
        d={d}
        x1={seg.x1}
        y1={seg.y1}
        x2={seg.x2}
        y2={seg.y2}
        duration={duration}
        delay={delay}
        reverse={reverse}
        pathColor={pathColor}
        pathWidth={pathWidth}
        pathOpacity={pathOpacity}
        gradientStartColor={gradientStartColor}
        gradientStopColor={gradientStopColor}
        active={active}
      />
    </svg>
  );
}
