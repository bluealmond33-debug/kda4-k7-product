// 데모 이벤트 버스 — 고객·상담사·관리자 화면에 같은 DemoEnvelope v1을 전달한다.
// call_id가 없으면 기존 단일 브라우저 데모(BroadcastChannel + 로컬 루프백)를 유지하고,
// 등록된 call_id가 명시된 LAN 시연에서는 동일 브라우저 채널과 중앙 WS 릴레이를 함께 쓴다.

import { API_BASE_URL } from "./config";
import { resolveExplicitCallId } from "./callId";
import { BoundedEnvelopeKeys, demoEnvelopeKey } from "./demoRelayContract";
import type { Sge } from "./sge";
import type { EmotionTemperatureLevel, MvpIncidentRisk } from "./types";

/** 백엔드 파이프라인 스테이지 — docs/AUDIO_TEXT_DUAL_PIPELINE.md 의 처리 순서와 1:1 */
export type PipelineStageId =
  | "utterance" // 고객 발화 수신
  | "stt" // 실시간 STT (Whisper)
  | "classify" // sLLM 분류·요약 (strict-JSON)
  | "risk" // 위험·감정 분석
  | "persist" // 상담카드 저장 (PostgreSQL)
  | "route" // 부서 라우팅
  | "rag" // RAG 규정검색 (pgvector)
  | "wrap"; // 후처리 요약

export type PipelineStageStatus = "start" | "done" | "skip";

export type DemoCallKind = "normal" | "urgent" | "transfer";

export interface DemoEventMap {
  "call.incoming": { callId: string; kind: DemoCallKind; generation?: number };
  "stt.utterance": {
    callId: string;
    text: string;
    isFinal: boolean;
    atMs: number;
    speaker?: "customer" | "agent";
    generation?: number;
    audioSeq?: number;
  };
  "pipeline.stage": {
    callId: string;
    stage: PipelineStageId;
    status: PipelineStageStatus;
    detail?: string;
  };
  "card.created": {
    callId: string;
    summary: string;
    businessType: string;
    /** 3층 업무코드(ARS 코드) — 아는 경우에만 (mvp-1.0 계약엔 아직 없음) */
    businessCode?: string;
    department: string;
    routingReason: string;
    incidentRisk: MvpIncidentRisk;
    riskReason: string | null;
    confidence: number | null;
    emotionLevel: EmotionTemperatureLevel | null;
    /** demo = 픽스처 시뮬레이션 · backend = 실제 POST /api/v1/calls 응답 */
    source: "demo" | "backend";
  };
  "routing.assigned": {
    callId: string;
    department: string;
    sge: Sge;
    confidence: number | null;
    risk: MvpIncidentRisk;
  };
  /** 상담사가 통화를 받았다 — 고객 창이 "내 말이 상담사에게 넘어갔다"를 아는 유일한 신호.
   *  이게 없으면 두 창이 각자 시계로 돌아 인계 연출이 어긋난다(고객 쪽은 자기 대본대로
   *  넘어가고 직원 쪽은 사람이 누른 시점에 넘어간다). */
  "agent.connected": { callId: string | null };
  "transfer.requested": { callId: string | null; toDept: string; mode: "reserve" | "immediate" };
  "transfer.completed": { callId: string | null; toDept: string };
  "call.ended": {
    callId: string;
    wrapType?: string;
    wrapResult?: string;
    generation?: number;
    endReason?: string;
    endedBy?: string;
  };
  "queue.snapshot": { queues: Array<{ dept: string; s: number; g: number; e: number }> };
  "demo.reset": Record<string, never>;
}

export type DemoEventType = keyof DemoEventMap;
export type DemoSource = "counselor" | "admin" | "server";

export interface DemoEnvelope<K extends DemoEventType = DemoEventType> {
  /** 프로토콜 버전 — WS 릴레이 전환 시 호환성 축 */
  v: 1;
  type: K;
  payload: DemoEventMap[K];
  ts: number;
  /** 탭별 단조 증가 — 수신측 정렬·중복 방지 */
  seq: number;
  source: DemoSource;
}

type AnyListener = (env: DemoEnvelope) => void;

export interface DemoBusTransport {
  post(msg: DemoEnvelope): void;
  subscribe(fn: AnyListener): () => void;
  close(): void;
}

export type DemoRelayRole = "customer" | "employee" | "admin";

const DEMO_EVENT_TYPES = new Set<DemoEventType>([
  "call.incoming",
  "stt.utterance",
  "pipeline.stage",
  "card.created",
  "routing.assigned",
  "agent.connected",
  "transfer.requested",
  "transfer.completed",
  "call.ended",
  "queue.snapshot",
  "demo.reset",
]);
const ADMIN_ONLY_EVENTS = new Set<DemoEventType>([
  "transfer.requested",
  "transfer.completed",
  "queue.snapshot",
  "demo.reset",
]);
const MAX_RELAY_QUEUE = 256;
const DEFAULT_MAX_EVENT_BYTES = 64 * 1024;

function isDemoEnvelope(value: unknown): value is DemoEnvelope {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<DemoEnvelope>;
  return (
    item.v === 1 &&
    typeof item.type === "string" &&
    DEMO_EVENT_TYPES.has(item.type as DemoEventType) &&
    !!item.payload &&
    typeof item.payload === "object" &&
    Number.isInteger(item.ts) &&
    Number.isInteger(item.seq) &&
    Number(item.seq) > 0 &&
    (item.source === "counselor" || item.source === "admin" || item.source === "server")
  );
}

function relayWsBase(): string {
  const explicit = String(import.meta.env.VITE_WS_BASE_URL ?? "").replace(/\/$/, "");
  if (explicit) return explicit;
  if (API_BASE_URL) return API_BASE_URL.replace(/^http/, "ws");
  const protocol = location.protocol === "https:" ? "wss" : "ws";
  return `${protocol}://${location.hostname}:8000`;
}

function eventByteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

/** 기본 전송 — BroadcastChannel(탭 간) + 로컬 루프백. 미지원 환경은 루프백만. */
export function createBroadcastTransport(name = "karina-demo-bus"): DemoBusTransport {
  const listeners = new Set<AnyListener>();
  const deliver = (env: DemoEnvelope) => {
    listeners.forEach((fn) => {
      try {
        fn(env);
      } catch {
        /* 리스너 오류가 버스를 죽이지 않게 */
      }
    });
  };
  const bc = typeof BroadcastChannel !== "undefined" ? new BroadcastChannel(name) : null;
  if (bc) bc.onmessage = (e: MessageEvent<DemoEnvelope>) => deliver(e.data);
  return {
    post(msg) {
      bc?.postMessage(msg);
      deliver(msg); // 자기 탭 루프백
    },
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    close() {
      bc?.close();
      listeners.clear();
    },
  };
}

/**
 * Registered-call transport used across the Galaxy, counselor laptop, and
 * central admin laptop. Every envelope is delivered locally once, mirrored to
 * a call-scoped BroadcastChannel, and published to the server after its ready
 * frame. Broadcast/WS echo copies are collapsed with a bounded stable-key set.
 */
export function createHybridTransport(
  callId: string,
  role: DemoRelayRole,
  name = `karina-demo-bus:${callId}`
): DemoBusTransport {
  const listeners = new Set<AnyListener>();
  const seen = new BoundedEnvelopeKeys();
  const queue: DemoEnvelope[] = [];
  const expectedSource: DemoSource = role === "admin" ? "admin" : "counselor";
  const bc = typeof BroadcastChannel !== "undefined" ? new BroadcastChannel(name) : null;
  let socket: WebSocket | null = null;
  let retryTimer = 0;
  let ready = false;
  let stopped = false;
  let maxEventBytes = DEFAULT_MAX_EVENT_BYTES;

  const deliver = (envelope: DemoEnvelope) => {
    if (!seen.remember(demoEnvelopeKey(envelope))) return false;
    listeners.forEach((listener) => {
      try {
        listener(envelope);
      } catch {
        /* A view listener must not tear down the shared transport. */
      }
    });
    return true;
  };

  const canPublishToRelay = (envelope: DemoEnvelope) => {
    // Customer already receives the authoritative /ws/call stream directly.
    // Keeping this relay socket receive-only prevents a second copy of every
    // server-derived event when the employee surface publishes the same call.
    if (role === "customer") return false;
    if (envelope.source !== expectedSource) return false;
    if (role !== "admin" && ADMIN_ONLY_EVENTS.has(envelope.type)) return false;
    const payload = envelope.payload as unknown as Record<string, unknown>;
    const payloadCallId = payload.callId;
    return payloadCallId == null || payloadCallId === callId;
  };

  const encodeForRelay = (envelope: DemoEnvelope) => {
    const encoded = JSON.stringify(envelope);
    return eventByteLength(encoded) <= maxEventBytes ? encoded : null;
  };

  const enqueue = (envelope: DemoEnvelope) => {
    queue.push(envelope);
    if (queue.length > MAX_RELAY_QUEUE) queue.splice(0, queue.length - MAX_RELAY_QUEUE);
  };

  const flush = () => {
    if (!ready || socket?.readyState !== WebSocket.OPEN) return;
    while (queue.length && ready && socket.readyState === WebSocket.OPEN) {
      const envelope = queue.shift()!;
      const encoded = encodeForRelay(envelope);
      if (encoded === null) continue;
      try {
        socket.send(encoded);
      } catch {
        queue.unshift(envelope);
        ready = false;
        socket.close();
      }
    }
  };

  const publishToRelay = (envelope: DemoEnvelope) => {
    if (!canPublishToRelay(envelope)) return;
    if (!ready || socket?.readyState !== WebSocket.OPEN) {
      enqueue(envelope);
      return;
    }
    const encoded = encodeForRelay(envelope);
    if (encoded === null) return;
    try {
      socket.send(encoded);
    } catch {
      enqueue(envelope);
      ready = false;
      socket.close();
    }
  };

  const connect = () => {
    if (stopped || typeof WebSocket === "undefined") return;
    ready = false;
    socket = new WebSocket(
      `${relayWsBase()}/ws/demo/${encodeURIComponent(callId)}?role=${encodeURIComponent(role)}`
    );
    socket.onmessage = (event) => {
      let message: unknown;
      try {
        message = JSON.parse(String(event.data));
      } catch {
        return;
      }
      if (message && typeof message === "object" && (message as { type?: unknown }).type === "ready") {
        const readyMessage = message as {
          channel?: unknown;
          call_id?: unknown;
          role?: unknown;
          protocol_version?: unknown;
          max_event_bytes?: unknown;
        };
        if (
          readyMessage.channel !== "demo" ||
          readyMessage.call_id !== callId ||
          readyMessage.role !== role ||
          readyMessage.protocol_version !== 1
        ) {
          socket?.close(1002, "unexpected demo ready frame");
          return;
        }
        const advertisedLimit = Number(readyMessage.max_event_bytes);
        if (Number.isInteger(advertisedLimit) && advertisedLimit > 0) {
          maxEventBytes = Math.min(DEFAULT_MAX_EVENT_BYTES, advertisedLimit);
        }
        ready = true;
        flush();
        return;
      }
      if (!isDemoEnvelope(message)) return;
      if (deliver(message)) bc?.postMessage(message);
    };
    socket.onclose = () => {
      ready = false;
      socket = null;
      if (!stopped) retryTimer = window.setTimeout(connect, 1_200);
    };
  };

  if (bc) {
    bc.onmessage = (event: MessageEvent<unknown>) => {
      if (isDemoEnvelope(event.data)) deliver(event.data);
    };
  }
  connect();

  return {
    post(envelope) {
      deliver(envelope);
      bc?.postMessage(envelope);
      publishToRelay(envelope);
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    close() {
      stopped = true;
      window.clearTimeout(retryTimer);
      ready = false;
      queue.length = 0;
      socket?.close();
      bc?.close();
      listeners.clear();
    },
  };
}

function createDemoBus(transport: DemoBusTransport, initialSource: DemoSource = "counselor") {
  let seq = 0;
  let source: DemoSource = initialSource;
  return {
    setSource(s: DemoSource) {
      source = s;
    },
    emit<K extends DemoEventType>(type: K, payload: DemoEventMap[K]) {
      transport.post({ v: 1, type, payload, ts: Date.now(), seq: ++seq, source });
    },
    on<K extends DemoEventType>(
      type: K,
      fn: (payload: DemoEventMap[K], env: DemoEnvelope<K>) => void
    ): () => void {
      return transport.subscribe((env) => {
        if (env.type === type) fn(env.payload as DemoEventMap[K], env as DemoEnvelope<K>);
      });
    },
    onAny(fn: AnyListener): () => void {
      return transport.subscribe(fn);
    },
  };
}

const runtimeSearch = typeof window === "undefined" ? "" : window.location.search;
const runtimeCallId = resolveExplicitCallId(runtimeSearch);
const runtimeRoleParam = new URLSearchParams(runtimeSearch).get("role");
const runtimeRelayRole: DemoRelayRole =
  runtimeRoleParam === "admin"
    ? "admin"
    : runtimeRoleParam === "customer"
      ? "customer"
      : "employee";
const runtimeTransport = runtimeCallId
  ? createHybridTransport(runtimeCallId, runtimeRelayRole)
  : createBroadcastTransport();

export const demoBus = createDemoBus(
  runtimeTransport,
  runtimeRelayRole === "admin" ? "admin" : "counselor"
);
