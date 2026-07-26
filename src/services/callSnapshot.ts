import type { DemoCallKind } from "./index";

/**
 * 진행 중인 통화의 **칠판**.
 *
 * demoBus는 라디오 생방송이다 — 통화 시작 신호는 그 순간 딱 한 번 나가고 사라진다.
 * 그래서 통화 도중에 새로 연 창(또는 새로고침한 창)은 "지금 통화 중"이라는 사실을
 * 알 방법이 없어 대기 화면에 앉아 있었다.
 *
 * 주기적으로 외치는 대신(하트비트) 한 군데 적어 둔다: 필요한 건 "지금 통화 중이냐,
 * 언제 시작했냐" 두 가지뿐이고 그건 계속 방송할 필요가 없다. 창이 열릴 때 한 번 읽으면
 * 되고, 이벤트가 계속 돌지 않아 로그도 조용하다.
 *
 * ⚠️ 유령 통화 방지 — 창을 통화 중에 그냥 닫거나(시연 중 실제로 일어난다) 브라우저가
 * 죽으면 지우는 사람이 없어 값이 남는다. 그 값을 믿으면 다음에 연 창이 **끝난 통화에
 * 합류해** 엉뚱한 경과 시간을 띄운다(실제로 54초짜리 유령 통화가 잡혔다).
 * 그래서 통화 중인 창이 몇 초마다 `updatedAt`만 갱신하고, 읽는 쪽은 그 값이 최근일 때만
 * 믿는다 — 소유자가 사라지면 칠판은 스스로 상해서 아무도 안 믿게 된다.
 * (버스로 외치는 대신 저장소에 적기만 하므로 이벤트 로그는 여전히 조용하다.)
 */

const KEY = "karina-call-snapshot";
/** 소유자가 이 시간 넘게 갱신을 안 하면 사라진 것으로 본다 */
const STALE_MS = 15 * 1000;
/** 소유자가 칠판을 다시 적는 주기 — STALE_MS의 1/3이면 한 번 걸러도 살아남는다 */
export const SNAPSHOT_BEAT_MS = 5 * 1000;

export interface CallSnapshot {
  callId: string;
  kind: DemoCallKind;
  /** 통화 시작 시각(epoch ms) — 늦게 합류한 창의 시계 원점이 된다 */
  startedAtMs: number;
  /** 소유 창이 마지막으로 "나 아직 통화 중"이라고 적은 시각 */
  updatedAt: number;
}

/** localStorage는 사파리 프라이빗·정책 차단에서 던진다. 시연이 그걸로 멈추면 안 된다. */
function store(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

export function writeCallSnapshot(snap: Omit<CallSnapshot, "updatedAt">): void {
  try {
    store()?.setItem(KEY, JSON.stringify({ ...snap, updatedAt: Date.now() }));
  } catch {
    /* 저장 실패는 조용히 넘긴다 — 없으면 '늦게 연 창이 못 붙는다'로 끝나지 시연이 깨지진 않는다 */
  }
}

export function clearCallSnapshot(): void {
  try {
    store()?.removeItem(KEY);
  } catch {
    /* 지우기 실패도 마찬가지 — 어차피 오래되면 읽는 쪽에서 무시한다 */
  }
}

/** 지금 붙을 만한 통화가 있으면 준다. 오래된 값은 무시하고 그 자리에서 지운다. */
export function readCallSnapshot(): CallSnapshot | null {
  const raw = (() => {
    try {
      return store()?.getItem(KEY) ?? null;
    } catch {
      return null;
    }
  })();
  if (!raw) return null;
  try {
    const snap = JSON.parse(raw) as CallSnapshot;
    if (!snap || typeof snap.startedAtMs !== "number" || !snap.callId) {
      clearCallSnapshot();
      return null;
    }
    // 소유자가 갱신을 멈췄다 = 창이 닫혔거나 통화가 끝났다. 믿지 않고 지운다.
    if (typeof snap.updatedAt !== "number" || Date.now() - snap.updatedAt > STALE_MS) {
      clearCallSnapshot();
      return null;
    }
    return snap;
  } catch {
    clearCallSnapshot();
    return null;
  }
}
