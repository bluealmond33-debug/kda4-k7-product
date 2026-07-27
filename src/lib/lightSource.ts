/**
 * 커서 광원 — 마우스 위치를 광원으로 삼아 화면 전체의 그림자 방향을 정한다.
 *
 * `--lx`/`--ly`(-1~1)를 :root에 흘려보내면 tokens.css의 그림자 토큰들이 calc로 받아
 * 함께 기운다. 커서가 왼쪽에 있으면 빛이 왼쪽에서 오므로 그림자는 오른쪽으로 눕는다.
 *
 * 무한원 광원(directional light)으로 모델링한다 — 요소마다 각자 계산하지 않고 화면 전체가
 * 한 방향으로 같이 기운다. 요소별로 방사형 계산을 하면 카드마다 그림자 방향이 달라져
 * '같은 공간에 있다'는 감각이 깨지고, 비용도 요소 수에 비례해 커진다.
 *
 * 비용: :root 변수 하나만 바꾸므로 갱신은 O(1)이다. 다만 그 변수를 쓰는 모든 면이
 * 다시 칠해지므로, **값이 목표에 닿으면 rAF를 멈추고** 다음 포인터 이동에서 되살린다.
 * 커서가 멈춰 있는 동안엔 아무 일도 일어나지 않는다.
 *
 * 접근성: prefers-reduced-motion이면 아예 시작하지 않는다 — 변수는 0으로 남고
 * 그림자는 예전처럼 똑바로 아래로 떨어진다(기능 손실 없음).
 */

/** 목표에 이만큼 가까워지면 멈춘다 — 눈에 안 보이는 소수점 때문에 계속 그리지 않게 */
const EPS = 0.002;
/** 따라오는 속도(시정수, 초). 작을수록 즉각적, 클수록 미끄러진다 */
const TAU = 0.13;

let started = false;

export function startLightSource() {
  if (started || typeof window === "undefined") return;
  if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
  started = true;

  const root = document.documentElement;
  let targetX = 0;
  let targetY = 0;
  let curX = 0;
  let curY = 0;
  let raf = 0;
  let lastT = 0;

  const clamp = (v: number) => (v < -1 ? -1 : v > 1 ? 1 : v);

  const loop = (t: number) => {
    const dt = lastT ? Math.min(0.05, (t - lastT) / 1000) : 0.016;
    lastT = t;
    const k = 1 - Math.exp(-dt / TAU);
    curX += (targetX - curX) * k;
    curY += (targetY - curY) * k;
    root.style.setProperty("--lx", curX.toFixed(3));
    root.style.setProperty("--ly", curY.toFixed(3));

    if (Math.abs(targetX - curX) < EPS && Math.abs(targetY - curY) < EPS) {
      // 다 따라잡았다 — 다음 포인터 이동까지 쉰다
      raf = 0;
      lastT = 0;
      return;
    }
    raf = requestAnimationFrame(loop);
  };

  const wake = () => {
    if (!raf) raf = requestAnimationFrame(loop);
  };

  window.addEventListener(
    "pointermove",
    (e: PointerEvent) => {
      const cx = window.innerWidth / 2;
      const cy = window.innerHeight / 2;
      // 광원(커서)에서 화면 중심으로 향하는 방향 = 그림자가 눕는 방향.
      // 커서가 왼쪽이면 (cx - x) > 0 → 그림자는 오른쪽으로.
      targetX = clamp((cx - e.clientX) / cx);
      targetY = clamp((cy - e.clientY) / cy);
      wake();
    },
    { passive: true }
  );
}
