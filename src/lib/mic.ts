import { useEffect, useState } from "react";

/**
 * 공용 마이크 레벨 미터 — 실제 입력 음량(0~1)을 매 프레임 읽을 수 있게 한다.
 *
 * 한 대의 마이크를 여러 컴포넌트가 같이 본다(폰의 주황 점, 전사 패널 두 개의 파형).
 * 그래서 getUserMedia를 각자 부르지 않고 **참조 카운트로 스트림 하나를 공유**한다 —
 * 마지막 사용자가 놓을 때만 트랙을 정지한다.
 *
 * 주의: getUserMedia는 보안 컨텍스트(localhost·https)에서만 동작한다. LAN http로
 * 시연하면 브라우저가 막으므로 getMicLevel()은 계속 null을 준다 — 호출부는 그때
 * 시뮬레이션 값으로 되돌아가야 한다(파형이 죽어버리지 않게).
 */

// ── 레벨 산출 파라미터 ────────────────────────────────────────────────
// 사람 목소리를 눈에 보이게 만드는 구간. 무음(-55dB 이하)은 0으로 게이트하고,
// 보통 말소리(-30~-15dB)가 파형의 대부분을 쓰도록 -12dB를 천장으로 잡는다.
const DB_FLOOR = -55;
const DB_CEIL = -12;
/** 작은 소리도 눈에 보이게 살짝 부풀린다(1보다 작을수록 아래쪽이 들림) */
const CURVE = 0.75;
/** 어택은 빠르게, 릴리즈는 느리게 — 옛 시리처럼 말이 시작되면 바로 부풀고 천천히 잦아든다 */
const ATTACK_TAU = 0.045;
const RELEASE_TAU = 0.32;

let refCount = 0;
let stream: MediaStream | null = null;
let audioCtx: AudioContext | null = null;
let analyser: AnalyserNode | null = null;
// ArrayBuffer로 명시 — getByteTimeDomainData는 SharedArrayBuffer 뷰를 받지 않는다
let buf: Uint8Array<ArrayBuffer> | null = null;
let starting: Promise<void> | null = null;
/** 평활된 현재 레벨(0~1) */
let level = 0;
let raf = 0;
let lastT = 0;
/** 마이크가 실제로 살아 있는지 — false면 호출부는 시뮬레이션으로 되돌아간다 */
let live = false;

const listeners = new Set<(on: boolean) => void>();
const notify = () => listeners.forEach((fn) => fn(live));

function tick(t: number) {
  const dt = lastT ? Math.min(0.05, (t - lastT) / 1000) : 0.016;
  lastT = t;

  let target = 0;
  if (analyser && buf) {
    analyser.getByteTimeDomainData(buf);
    // RMS — 파형의 실효값. 피크보다 체감 음량에 가깝다.
    let sum = 0;
    for (let i = 0; i < buf.length; i++) {
      const v = (buf[i] - 128) / 128;
      sum += v * v;
    }
    const rms = Math.sqrt(sum / buf.length);
    // dB로 옮겨야 사람 귀처럼 반응한다 — 선형 RMS는 작은 소리에서 거의 안 움직인다.
    const db = 20 * Math.log10(Math.max(rms, 1e-6));
    const norm = (db - DB_FLOOR) / (DB_CEIL - DB_FLOOR);
    target = Math.pow(Math.max(0, Math.min(1, norm)), CURVE);
  }

  // 프레임 독립 이징 — 프레임률이 흔들려도 같은 속도로 붙는다
  const tau = target > level ? ATTACK_TAU : RELEASE_TAU;
  level += (target - level) * (1 - Math.exp(-dt / tau));

  raf = requestAnimationFrame(tick);
}

async function start() {
  if (!navigator.mediaDevices?.getUserMedia) return;
  try {
    const s = await navigator.mediaDevices.getUserMedia({ audio: true });
    // 기다리는 사이 마지막 사용자가 놓았으면 즉시 정리한다
    if (refCount === 0) {
      s.getTracks().forEach((t) => t.stop());
      return;
    }
    stream = s;
    const Ctx: typeof AudioContext =
      window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    audioCtx = new Ctx();
    // 자동재생 정책으로 suspended 상태로 열릴 수 있다 — 통화는 클릭에서 시작하므로 대개 풀린다
    if (audioCtx.state === "suspended") await audioCtx.resume().catch(() => {});
    analyser = audioCtx.createAnalyser();
    analyser.fftSize = 1024;
    // 평활은 우리가 dt 기반으로 직접 한다 — 여기선 원신호를 받는다
    analyser.smoothingTimeConstant = 0;
    buf = new Uint8Array(new ArrayBuffer(analyser.fftSize));
    audioCtx.createMediaStreamSource(s).connect(analyser);
    // analyser는 destination에 연결하지 않는다 — 연결하면 스피커로 되돌아 나가 하울링이 난다
    live = true;
    lastT = 0;
    raf = requestAnimationFrame(tick);
    notify();
  } catch {
    // 권한 거부·미지원·비보안 컨텍스트 — 조용히 포기하고 시뮬레이션에 맡긴다
    live = false;
    notify();
  }
}

function stop() {
  cancelAnimationFrame(raf);
  raf = 0;
  stream?.getTracks().forEach((t) => t.stop());
  audioCtx?.close().catch(() => {});
  stream = null;
  audioCtx = null;
  analyser = null;
  buf = null;
  level = 0;
  live = false;
  starting = null;
  notify();
}

/** 마이크를 잡는다. 반환된 함수를 부르면 놓는다(마지막 사용자가 놓을 때 실제로 정지). */
export function acquireMic(): () => void {
  refCount++;
  if (refCount === 1 && !starting) starting = start();
  let released = false;
  return () => {
    if (released) return;
    released = true;
    refCount--;
    if (refCount === 0) stop();
  };
}

/** 지금 입력 레벨(0~1). 마이크가 안 살아 있으면 null — 호출부는 시뮬레이션으로 대체한다. */
export function getMicLevel(): number | null {
  return live ? level : null;
}

/** 마이크가 실제로 켜져 있는 동안 true (권한 허용 + 스트림 활성) */
export function useMic(active: boolean): boolean {
  const [on, setOn] = useState(live);
  useEffect(() => {
    if (!active) {
      setOn(false);
      return;
    }
    const release = acquireMic();
    setOn(live);
    listeners.add(setOn);
    return () => {
      listeners.delete(setOn);
      release();
    };
  }, [active]);
  return on;
}
