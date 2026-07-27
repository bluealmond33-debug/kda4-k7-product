import { useEffect, useRef } from "react";

/**
 * 시리풍 음성 파형 — Canvas 2D 자체 구현.
 *
 * 애플 에셋을 쓰지 않는다(배포되지 않고 애플 저작물이다). 저 형태의 원리만 가져와
 * 직접 그린다: **사인 곡선을 baseline 기준 위아래로 미러링해 '렌즈' 띠를 만들고,
 * 양끝으로 갈수록 0에 수렴하는 엔벨로프를 곱한 뒤, 위상·주기·속도가 서로 다른
 * 여러 장을 겹쳐 additive(lighter)로 합성**한다. 겹치는 곳이 저절로 밝아지면서
 * 시리 특유의 교차 발광이 나온다 — 그라데이션을 칠하는 게 아니라 겹침의 결과다.
 *
 * 색은 무지개 대신 화자 색 계열의 명도 3단계로 번안했다(ONAIR: 색은 신호에만).
 * 검은 무대 위에서만 쓴다.
 *
 * 각 곡선은 수명을 갖고 태어나 사라진다(sin 수명 엔벨로프) — 같은 파형이 반복되는
 * 기계적인 느낌 대신 매번 다른 결로 출렁이게 하는 장치다.
 *
 * 진폭은 React 상태가 아니라 getAmplitude()로 매 프레임 읽는다 — 60fps 구동이
 * 재렌더를 유발하지 않게.
 */

/** 곡선 한 장. 태어날 때 파라미터를 새로 뽑는다. */
interface Curve {
  color: string;
  /** 이 장의 상대 진폭 */
  amp: number;
  /** 렌즈가 가운데로 얼마나 오므라드는지 — 클수록 좁고 뾰족 */
  openness: number;
  /** [-2,2] 구간에 들어가는 마디 수 — 클수록 결이 잘게 */
  freq: number;
  /** 위상이 흐르는 속도·방향 */
  speed: number;
  phase: number;
  bornAt: number;
  /** 수명(ms) */
  life: number;
}

const rand = (a: number, b: number) => a + Math.random() * (b - a);

function spawn(color: string, now: number): Curve {
  return {
    color,
    amp: rand(0.34, 1),
    // 낮게 잡을수록 띠가 가운데로 몰리지 않고 좌우로 퍼진다 — 시리처럼 마디가 보이게
    openness: rand(0.15, 0.7),
    freq: rand(1.8, 3.6),
    speed: rand(0.6, 1.5) * (Math.random() < 0.5 ? -1 : 1),
    phase: rand(0, Math.PI * 2),
    bornAt: now,
    life: rand(2600, 5400),
  };
}

/** 전역 감쇠 — 가운데는 평평하고 양끝(x=±2)에서 급격히 0으로. 파형이 가는 선으로 빨려든다. */
const attenuate = (x: number) => Math.pow(4 / (4 + Math.pow(x, 4)), 4);

/** 좌표 도메인 — 화면 폭을 x ∈ [-2, 2]로 본다 */
const X0 = -2;
const X1 = 2;
/** 곡선 하나를 그릴 때 찍는 표본 수 */
const STEPS = 96;

export default function SiriWave({
  colors,
  getAmplitude,
  amplitude = 0.4,
  layers = 3,
  className,
}: {
  /** 겹칠 색(밝은 순서 무관). 보통 화자 색 계열 명도 3단계 */
  colors: string[];
  /** 매 프레임 읽는 진폭(0~1). 주면 amplitude보다 우선한다 */
  getAmplitude?: () => number;
  /** 고정 진폭(0~1) */
  amplitude?: number;
  /** 색 하나당 겹칠 곡선 장수 */
  layers?: number;
  className?: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  // 최신 prop을 rAF 루프가 읽도록 ref로 넘긴다(루프를 재시작하지 않기 위해)
  const ampFnRef = useRef<() => number>(() => amplitude);
  ampFnRef.current = getAmplitude ?? (() => amplitude);
  const colorsRef = useRef(colors);
  colorsRef.current = colors;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // CSS 픽셀 크기는 부모(absolute inset:0)가 정하고, 버퍼는 DPR 배로 잡아 선명하게.
    let w = 0;
    let h = 0;
    const resize = () => {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const r = canvas.getBoundingClientRect();
      w = r.width;
      h = r.height;
      canvas.width = Math.max(1, Math.round(w * dpr));
      canvas.height = Math.max(1, Math.round(h * dpr));
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);

    const now0 = performance.now();
    let curves: Curve[] = [];
    const seed = () => {
      curves = [];
      colorsRef.current.forEach((c) => {
        for (let i = 0; i < layers; i++) {
          const cv = spawn(c, now0);
          // 처음부터 다 같이 태어나면 다 같이 죽는다 — 수명을 흩어 놓는다
          cv.bornAt = now0 - rand(0, cv.life);
          curves.push(cv);
        }
      });
    };
    seed();

    let raf = 0;
    const loop = (t: number) => {
      const amp = Math.max(0, Math.min(1, ampFnRef.current()));
      // 색 목록이 바뀌면(화자 전환 등) 다시 뿌린다
      if (curves.length !== colorsRef.current.length * layers) seed();

      ctx.clearRect(0, 0, w, h);
      const cy = h / 2;
      const half = h / 2;
      // 시간(초) — 위상이 흐르는 기준
      const time = (t - now0) / 1000;

      // 가는 기준선 — 파형이 없는 구간에도 좌우 끝까지 이어지는 실 한 줄
      ctx.globalCompositeOperation = "source-over";
      ctx.strokeStyle = colorsRef.current[0];
      ctx.globalAlpha = 0.28;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, cy);
      ctx.lineTo(w, cy);
      ctx.stroke();

      // 렌즈 띠 — 겹칠수록 밝아지도록 additive 합성
      ctx.globalCompositeOperation = "lighter";
      for (let ci = 0; ci < curves.length; ci++) {
        const c = curves[ci];
        const age = t - c.bornAt;
        if (age >= c.life) {
          // 죽은 곡선은 **지금** 색으로 다시 태어난다 — 죽은 곡선의 색을 그대로 물려주면
          // 화자가 바뀌어도 옛 색이 영원히 남는다. 곡선 수명이 흩어져 있어 색이 한 장씩
          // 갈리며 자연스럽게 크로스페이드된다(툭 끊기는 리셋 없이 화자 전환이 보인다).
          const palette = colorsRef.current;
          curves[ci] = spawn(palette[Math.floor(ci / layers) % palette.length], t);
          continue;
        }
        // 수명 엔벨로프 — 0에서 태어나 1까지 부풀었다 다시 0으로 사라진다
        const born = Math.sin((Math.PI * age) / c.life);

        const k = c.amp * born * amp;
        if (k < 0.002) continue;

        // y(x) = 진폭 · 전역감쇠 · 렌즈감쇠 · sin(마디 − 흐름)
        const yAt = (x: number) =>
          k *
          attenuate(x) *
          (1 / (1 + Math.pow(c.openness * x, 2))) *
          Math.sin(c.freq * x - time * c.speed + c.phase) *
          // 피크에서도 상자 위아래에 여백을 남긴다 — 잘린 것처럼 보이지 않게
          half * 0.86;

        ctx.fillStyle = c.color;
        // 낮게 — 겹친 곳만 흰빛으로 타고, 나머지는 화자 색이 남아야 한다
        ctx.globalAlpha = 0.3;
        ctx.beginPath();
        for (let i = 0; i <= STEPS; i++) {
          const x = X0 + ((X1 - X0) * i) / STEPS;
          const px = ((x - X0) / (X1 - X0)) * w;
          const py = cy - yAt(x);
          if (i === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        }
        // 되돌아오며 baseline 반대편을 그려 닫는다 — 이게 '렌즈' 모양을 만든다
        for (let i = STEPS; i >= 0; i--) {
          const x = X0 + ((X1 - X0) * i) / STEPS;
          const px = ((x - X0) / (X1 - X0)) * w;
          ctx.lineTo(px, cy + yAt(x));
        }
        ctx.closePath();
        ctx.fill();
      }

      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = "source-over";
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, [layers]);

  return <canvas ref={canvasRef} className={className} style={{ display: "block", width: "100%", height: "100%" }} />;
}
