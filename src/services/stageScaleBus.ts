// 창간 스테이지 스케일 동기화 — 직원(desktop) 창이 자기 transform 배율을 방송하면
// 고객(phone) 창이 같은 배율로 렌더해 폰트·요소 크기가 물리적으로 일치한다.
// demoBus(엄격한 타입 계약)와 분리한 가벼운 전용 BroadcastChannel.
// 제약: 같은 오리진 · 같은 머신(한 발표 화면의 두 창)에서만 동작 — BroadcastChannel 특성상.
//   서로 다른 물리 기기(LAN)는 각자 자기 화면에 맞추는 게 맞으므로 동기화 대상이 아니다.

const CHANNEL = "karina-stage-scale";
const bc = typeof BroadcastChannel !== "undefined" ? new BroadcastChannel(CHANNEL) : null;

/** scale = 직원 창의 현재 배율(방송) · req = 폰이 뒤늦게 떠서 현재 배율을 요청 */
export type StageScaleMsg = { t: "scale"; scale: number } | { t: "req" };

export function postStageScale(msg: StageScaleMsg): void {
  bc?.postMessage(msg);
}

export function subscribeStageScale(fn: (msg: StageScaleMsg) => void): () => void {
  if (!bc) return () => {};
  const handler = (e: MessageEvent<StageScaleMsg>) => {
    const d = e.data;
    if (!d || typeof d !== "object") return;
    if (d.t === "scale" && typeof d.scale === "number" && Number.isFinite(d.scale) && d.scale > 0) fn(d);
    else if (d.t === "req") fn(d);
  };
  bc.addEventListener("message", handler);
  return () => bc.removeEventListener("message", handler);
}
