// 관리자 대시보드의 라이브 상태 — demoBus 이벤트를 이벤트소싱으로 누적한다.
// 큐 상태의 진실원은 관리자 로컬(이 리듀서)이다. 나중에 WS 릴레이를 도입하면
// 서버가 이 역할을 자연스럽게 이어받는다 — 프로토콜(DemoEventMap)은 그대로.

import { useEffect, useMemo, useReducer } from "react";
import {
  demoBus,
  type DemoCallKind,
  type DemoEnvelope,
  type DemoEventMap,
  type DemoSource,
  type MvpIncidentRisk,
  type PipelineStageId,
  type PipelineStageStatus,
  type Sge,
} from "../services";
import {
  AI_HANDLED_SEED,
  DEPARTMENTS,
  DEPT_SEED_QUEUES,
  SEED_CARD_TOTAL,
  SEED_FEED,
  normalizeDeptLabel,
  type QueueItem,
} from "../data/adminContent";
import {
  adminTranscriptIdentity,
  isMismatchedCallGeneration,
  normalizeCallGeneration,
  shouldApplyAdminRouting,
  shouldCountAdminCard,
  shouldReplaceAdminCall,
} from "../services/adminCallLifecycle";

export interface AdminCallRecord {
  callId: string;
  generation: number;
  kind: DemoCallKind;
  source: DemoSource;
  startedAt: number;
  endedAt: number | null;
  utterances: string[];
  utteranceKeys: string[];
  stages: Partial<Record<PipelineStageId, PipelineStageStatus>>;
  card: DemoEventMap["card.created"] | null;
  sge: Sge | null;
  department: string | null;
  confidence: number | null;
  risk: MvpIncidentRisk | null;
  routingApplied: boolean;
  /** 이관 예약·완료 표시 (부서 보드 밖 내부 팀 대상도 배지로는 보인다) */
  transferTo: string | null;
  /** 본인인증 완료 여부 — 이관 카드에서 받는 부서의 재확인 필요 판단. null=분류 전(미상) */
  verified: boolean | null;
}

export interface FeedState {
  calls: Record<string, AdminCallRecord>;
  /** callId, 오래된 순 */
  order: string[];
  queues: Record<string, QueueItem[]>;
  totalCards: number;
  /** 상담사가 처리한 건수 (대기열에서 연결·완료) */
  handled: number;
  /** AI(ARS)가 자동 응대한 단순(S) 건수 — S는 대기열에 들어가지 않는다 */
  aiHandled: number;
  ticker: { callId: string; text: string } | null;
}

const initialState = (): FeedState => {
  // 피드 시드 — 완료 처리된 최근 콜 몇 건을 깔아 "이미 돌아가는 시스템"으로 시작한다.
  // 헤더 누적(12건)·부서 대기열 시드와 숫자 서사가 이어진다. 오래된 순으로 order에 쌓는다.
  const now = Date.now();
  const calls: Record<string, AdminCallRecord> = {};
  const order: string[] = [];
  [...SEED_FEED].reverse().forEach((s, i) => {
    const callId = `seed-feed-${i}`;
    const startedAt = now - s.minutesAgo * 60_000;
    calls[callId] = {
      callId,
      generation: 1,
      kind: s.sge === "E" ? "urgent" : "normal",
      source: "server",
      startedAt,
      endedAt: startedAt + 3 * 60_000,
      utterances: [],
      utteranceKeys: [],
      stages: {},
      card: {
        callId,
        summary: s.summary,
        businessType: s.businessType,
        department: s.department,
        routingReason: "",
        incidentRisk: s.sge === "E" ? "high" : "low",
        riskReason: null,
        confidence: null,
        emotionLevel: null,
        source: "demo",
      },
      sge: s.sge,
      department: s.department,
      confidence: null,
      risk: s.sge === "E" ? "high" : "low",
      routingApplied: true,
      transferTo: null,
      verified: s.verified,
    };
    order.push(callId);
  });
  return {
    calls,
    order,
    queues: Object.fromEntries(
      DEPARTMENTS.map((d) => [d.name, (DEPT_SEED_QUEUES[d.name] ?? []).slice()])
    ),
    totalCards: SEED_CARD_TOTAL,
    handled: 0,
    aiHandled: AI_HANDLED_SEED,
    ticker: null,
  };
};

type Action =
  | { type: "event"; env: DemoEnvelope }
  | { type: "connect"; dept: string; id: string }
  | { type: "resetAll" };

function newRecord(
  callId: string,
  kind: DemoCallKind,
  source: DemoSource,
  ts: number,
  generation = 0
): AdminCallRecord {
  return {
    callId,
    generation,
    kind,
    source,
    startedAt: ts,
    endedAt: null,
    utterances: [],
    utteranceKeys: [],
    stages: {},
    card: null,
    sge: null,
    department: null,
    confidence: null,
    risk: null,
    routingApplied: false,
    transferTo: null,
    verified: null,
  };
}

function patchCall(
  state: FeedState,
  callId: string,
  patch: (r: AdminCallRecord) => AdminCallRecord
): FeedState {
  const rec = state.calls[callId];
  if (!rec) return state;
  return { ...state, calls: { ...state.calls, [callId]: patch(rec) } };
}

/** callId(라이브) 또는 id(시드)로 대기열에서 항목을 찾아 제거 — [찾은 항목, 새 큐들] */
function takeItem(
  queues: FeedState["queues"],
  key: string
): [QueueItem | null, FeedState["queues"]] {
  for (const dept of Object.keys(queues)) {
    const idx = queues[dept].findIndex((it) => it.callId === key || it.id === key);
    if (idx >= 0) {
      const item = queues[dept][idx];
      return [item, { ...queues, [dept]: queues[dept].filter((_, i) => i !== idx) }];
    }
  }
  return [null, queues];
}

function withoutCallQueueItems(
  queues: FeedState["queues"],
  callId: string
): FeedState["queues"] {
  return Object.fromEntries(
    Object.entries(queues).map(([department, items]) => [
      department,
      items.filter((item) => item.callId !== callId),
    ])
  );
}

function onEvent(state: FeedState, env: DemoEnvelope): FeedState {
  switch (env.type) {
    case "call.incoming": {
      const p = env.payload as DemoEventMap["call.incoming"];
      const generation = normalizeCallGeneration(p.generation);
      const existing = state.calls[p.callId];
      if (existing) {
        if (
          !shouldReplaceAdminCall(
            existing.generation,
            existing.endedAt !== null,
            generation
          )
        ) {
          return state;
        }
        return {
          ...state,
          calls: {
            ...state.calls,
            [p.callId]: newRecord(p.callId, p.kind, env.source, env.ts, generation),
          },
          // Keep exactly one slot, moved to the newest position.
          order: [...state.order.filter((id) => id !== p.callId), p.callId],
          queues: withoutCallQueueItems(state.queues, p.callId),
          ticker: null,
        };
      }
      return {
        ...state,
        calls: {
          ...state.calls,
          [p.callId]: newRecord(p.callId, p.kind, env.source, env.ts, generation),
        },
        order: [...state.order, p.callId],
      };
    }
    case "stt.utterance": {
      const p = env.payload as DemoEventMap["stt.utterance"];
      const existing = state.calls[p.callId];
      if (!existing) return state;
      if (
        isMismatchedCallGeneration(existing.generation, p.generation)
      ) {
        return state;
      }
      const utteranceKey = adminTranscriptIdentity(p);
      if (existing.utteranceKeys.includes(utteranceKey)) return state;
      const next = patchCall(state, p.callId, (r) => ({
        ...r,
        utterances: [...r.utterances, p.text],
        utteranceKeys: [...r.utteranceKeys, utteranceKey],
      }));
      return { ...next, ticker: { callId: p.callId, text: p.text } };
    }
    case "pipeline.stage": {
      const p = env.payload as DemoEventMap["pipeline.stage"];
      return patchCall(state, p.callId, (r) => ({
        ...r,
        stages: { ...r.stages, [p.stage]: p.status },
      }));
    }
    case "card.created": {
      const p = env.payload as DemoEventMap["card.created"];
      const existing = state.calls[p.callId];
      if (!existing) return state;
      const countCard = shouldCountAdminCard(existing.card !== null);
      const next = patchCall(state, p.callId, (r) => ({ ...r, card: p }));
      return countCard ? { ...next, totalCards: next.totalCards + 1 } : next;
    }
    case "routing.assigned": {
      const p = env.payload as DemoEventMap["routing.assigned"];
      const existing = state.calls[p.callId];
      if (!existing) return state;
      const applyRouting = shouldApplyAdminRouting(existing.routingApplied);
      // 구 부서 라벨(데모 픽스처)은 7부서 taxonomy로 정규화해 흡수.
      // 긴급(E)은 부서와 무관하게 사고·신고(SG) 강제 — taxonomy의 EMERGENCY_DEPARTMENT 규칙
      // (긴급 게이트: E이면 반드시 SG. 구 픽스처가 다른 부서를 달고 와도 여기서 교정)
      const dept = p.sge === "E" ? "사고·신고" : normalizeDeptLabel(p.department);
      const next = patchCall(state, p.callId, (r) => ({
        ...r,
        sge: p.sge,
        department: dept,
        confidence: p.confidence,
        risk: p.risk,
        routingApplied: true,
        // 긴급(E)은 사고 접수 우선이라 본인인증 전 연결될 수 있음 → 받는 부서가 재확인.
        // 단순(S)·일반(G)은 접수 단계 본인확인 완료로 간주.
        verified: p.sge === "E" ? false : true,
      }));
      if (!applyRouting) return next;
      // 단순(S)은 상담사 대기열로 가지 않는다 — ARS·AI가 즉시 받아 자동 응대 카운터로
      if (p.sge === "S") return { ...next, aiHandled: next.aiHandled + 1 };
      const rec = next.calls[p.callId];
      const label = rec?.card?.businessType ?? "신규 상담";
      const queue = next.queues[dept];
      if (!queue) return next; // 보드 밖 부서(내부 팀)는 배지로만
      const item: QueueItem = {
        id: p.callId,
        label,
        sge: p.sge,
        callId: p.callId,
        code: rec?.card?.businessCode,
      };
      // 긴급(E)은 대기열 맨 앞으로 — 참조 라우팅 정책(긴급 우선) 그대로
      const nextQueue = p.sge === "E" ? [item, ...queue] : [...queue, item];
      return { ...next, queues: { ...next.queues, [dept]: nextQueue } };
    }
    case "transfer.requested": {
      const p = env.payload as DemoEventMap["transfer.requested"];
      const toDept = normalizeDeptLabel(p.toDept);
      const marked = p.callId
        ? patchCall(state, p.callId, (r) => ({ ...r, transferTo: p.toDept }))
        : state;
      if (p.mode !== "immediate" || !p.callId) return marked; // reserve = 배지만
      const [item, queues] = takeItem(marked.queues, p.callId);
      if (!item || !marked.queues[toDept]) return marked;
      return {
        ...marked,
        queues: { ...queues, [toDept]: [...queues[toDept], item] },
      };
    }
    case "transfer.completed": {
      const p = env.payload as DemoEventMap["transfer.completed"];
      const toDept = normalizeDeptLabel(p.toDept);
      const marked = p.callId
        ? patchCall(state, p.callId, (r) => ({ ...r, transferTo: p.toDept }))
        : state;
      if (!p.callId || !marked.queues[toDept]) return marked;
      const [item, queues] = takeItem(marked.queues, p.callId);
      if (!item) return marked;
      return { ...marked, queues: { ...queues, [toDept]: [...queues[toDept], item] } };
    }
    case "call.ended": {
      const p = env.payload as DemoEventMap["call.ended"];
      const existing = state.calls[p.callId];
      if (
        existing &&
        isMismatchedCallGeneration(existing.generation, p.generation)
      ) {
        return state;
      }
      const next = patchCall(state, p.callId, (r) => ({
        ...r,
        endedAt: env.ts,
        stages: { ...r.stages, wrap: "done" },
      }));
      // 상담 완료 = 대기열에서 빠진다 (이관 예약분은 transfer.completed가 뒤이어 옮긴다)
      const rec = next.calls[p.callId];
      if (rec?.transferTo) return next;
      const [item, queues] = takeItem(next.queues, p.callId);
      if (!item) return next;
      return { ...next, queues, handled: next.handled + 1 };
    }
    case "demo.reset": {
      // 상담사 탭 초기화 = 진행 중이던 그 탭의 콜만 정리. 누적 통계·시드는 유지.
      const dropped = new Set(
        state.order.filter(
          (id) => state.calls[id].endedAt === null && state.calls[id].source === env.source
        )
      );
      if (dropped.size === 0) return { ...state, ticker: null };
      const calls: FeedState["calls"] = {};
      for (const [id, r] of Object.entries(state.calls)) if (!dropped.has(id)) calls[id] = r;
      const queues = Object.fromEntries(
        Object.entries(state.queues).map(([d, items]) => [
          d,
          items.filter((it) => !it.callId || !dropped.has(it.callId)),
        ])
      );
      return {
        ...state,
        calls,
        order: state.order.filter((id) => !dropped.has(id)),
        queues,
        ticker: null,
      };
    }
    case "queue.snapshot":
      return state;
  }
}

function reducer(state: FeedState, action: Action): FeedState {
  switch (action.type) {
    case "event":
      return onEvent(state, action.env);
    case "connect": {
      const queue = state.queues[action.dept];
      if (!queue) return state;
      const item = queue.find((it) => it.id === action.id);
      if (!item) return state;
      return {
        ...state,
        queues: {
          ...state.queues,
          [action.dept]: queue.filter((it) => it.id !== action.id),
        },
        handled: state.handled + 1,
      };
    }
    case "resetAll":
      return initialState();
  }
}

export function useAdminFeed() {
  const [state, dispatch] = useReducer(reducer, undefined, initialState);

  useEffect(() => demoBus.onAny((env) => dispatch({ type: "event", env })), []);

  const derived = useMemo(() => {
    const records = state.order.map((id) => state.calls[id]);
    const active = records.filter((r) => r.endedAt === null);
    // 플로우 패널은 가장 최근 콜 기준 (진행 중 우선)
    const flowCall = active[active.length - 1] ?? records[records.length - 1] ?? null;
    // 피드는 최신이 위, 진행 중 긴급(E)은 맨 위 고정
    const feed = [...records].reverse();
    feed.sort((a, b) => {
      const aPin = a.sge === "E" && a.endedAt === null ? 1 : 0;
      const bPin = b.sge === "E" && b.endedAt === null ? 1 : 0;
      return bPin - aPin;
    });
    const counts: Record<string, { s: number; g: number; e: number }> = {};
    let sTotal = 0;
    let gTotal = 0;
    let eTotal = 0;
    for (const dept of Object.keys(state.queues)) {
      const c = { s: 0, g: 0, e: 0 };
      for (const it of state.queues[dept]) {
        if (it.sge === "S") c.s += 1;
        else if (it.sge === "E") c.e += 1;
        else c.g += 1;
      }
      counts[dept] = c;
      sTotal += c.s;
      gTotal += c.g;
      eTotal += c.e;
    }
    return {
      records,
      feed,
      flowCall,
      concurrent: active.length,
      queueCounts: counts,
      sgeTotals: { s: sTotal, g: gTotal, e: eTotal },
    };
  }, [state]);

  return {
    state,
    ...derived,
    connectItem: (dept: string, id: string) => dispatch({ type: "connect", dept, id }),
    resetAll: () => dispatch({ type: "resetAll" }),
  };
}

export type AdminFeed = ReturnType<typeof useAdminFeed>;
