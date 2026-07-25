import { useSyncExternalStore } from "react";

/**
 * 오늘 처리 내역 — 후처리를 저장하면 여기 쌓이고, 대기 화면의 '처리 내역'이 이걸 읽는다.
 *
 * 왜 있나: 전에는 '저장 후 다음 콜'이 그냥 reset()이라 후처리 결과도 후속 조치도
 * 흔적 없이 사라졌다. 버튼이 '저장'이라 말하면 어딘가엔 남아야 한다.
 *
 * 두 종류가 쌓인다:
 *  - **후처리 저장**(status: 완료 / 콜백 예약) — 상담이 실제로 있었던 콜
 *  - **미상담 종료**(status: 미상담 종료) — 상담사와 말이 오가기 전에 끊긴 콜.
 *    후처리 화면을 띄우지 않고 로그만 남긴다(F3 진입 게이트). 통계에는 넣지 않는다.
 *
 * 저장소는 localStorage — 시연 중 새로고침해도 오늘 쌓은 게 살아 있어야 한다.
 * 날짜가 바뀌면 자동으로 비운다('오늘' 내역이므로).
 */

export type CallLogStatus = "후처리 완료" | "콜백 예약" | "미상담 종료";

export interface CallLogEntry {
  id: string;
  /** "14:05" */
  time: string;
  /** 상담 유형 — "대출 › 만기연장·재약정" */
  type: string;
  status: CallLogStatus;
  /** 상담 결과(후처리 저장분만) */
  result?: string;
  /** 통화 길이 "03:07" */
  talk?: string;
  /** 후처리 결과 본문 */
  summary?: string;
  /** 저장 시점의 후속 조치 */
  followups?: { icon: string; label: string }[];
}

const KEY = "karina.callLog.v1";

interface Stored {
  day: string;
  entries: CallLogEntry[];
}

/** 오늘 날짜 키 — 날짜가 바뀌면 내역을 비운다 */
function today(): string {
  const d = new Date();
  return d.getFullYear() + "-" + (d.getMonth() + 1) + "-" + d.getDate();
}

function read(): CallLogEntry[] {
  if (typeof localStorage === "undefined") return [];
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as Stored;
    if (!parsed || parsed.day !== today() || !Array.isArray(parsed.entries)) return [];
    return parsed.entries;
  } catch {
    return [];
  }
}

// 스냅샷은 캐시한다 — useSyncExternalStore는 getSnapshot이 매번 같은 참조를 주길 요구한다.
// 매 호출마다 JSON.parse로 새 배열을 만들면 무한 렌더 루프에 빠진다.
let cache: CallLogEntry[] = read();

const listeners = new Set<() => void>();
const emit = () => listeners.forEach((fn) => fn());

function write(entries: CallLogEntry[]) {
  cache = entries;
  try {
    localStorage.setItem(KEY, JSON.stringify({ day: today(), entries } satisfies Stored));
  } catch {
    // 용량 초과·프라이빗 모드 — 메모리에는 남으니 이번 세션 시연은 계속된다
  }
  emit();
}

/** 최신이 앞. 새 콜은 위에 쌓인다(처리 내역 타임라인이 최근 순). */
export function addCallLog(entry: Omit<CallLogEntry, "id" | "time"> & { time?: string }) {
  const d = new Date();
  const p = (n: number) => (n < 10 ? "0" + n : "" + n);
  const full: CallLogEntry = {
    ...entry,
    id: String(d.getTime()) + "-" + Math.round(d.getTime() % 1000),
    time: entry.time ?? p(d.getHours()) + ":" + p(d.getMinutes()),
  };
  write([full, ...cache]);
}

export function clearCallLog() {
  write([]);
}

export function getCallLog(): CallLogEntry[] {
  return cache;
}

function subscribe(fn: () => void) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** 리액트에서 구독 — 후처리를 저장하면 대기 화면 내역이 즉시 갱신된다 */
export function useCallLog(): CallLogEntry[] {
  return useSyncExternalStore(subscribe, getCallLog, getCallLog);
}
