// 데모 이벤트 버스 — 상담사 탭(LiveDemo)의 데모 진행을 관리자 탭(AdminDashboard)에 실시간 중계한다.
//
// 전송 계층은 추상화되어 있다: 지금은 같은 브라우저의 탭 간 BroadcastChannel,
// 나중에 고객 폰/직원 화면을 다른 기기로 분리할 때는 같은 Envelope를 서버 릴레이(WS/SSE)로
// 흘리는 transport만 갈아끼우면 된다 — 프로토콜(DemoEventMap)은 불변.
// 자기 탭 발행분도 로컬 루프백한다 — 관리자 탭 단독 테스트 콜이 같은 수신 경로를 타게.

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
  "call.incoming": { callId: string; kind: DemoCallKind };
  "stt.utterance": { callId: string; text: string; isFinal: boolean; atMs: number };
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
  "transfer.requested": { callId: string | null; toDept: string; mode: "reserve" | "immediate" };
  "transfer.completed": { callId: string | null; toDept: string };
  "call.ended": { callId: string; wrapType?: string; wrapResult?: string };
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

function createDemoBus(transport: DemoBusTransport) {
  let seq = 0;
  let source: DemoSource = "counselor";
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

export const demoBus = createDemoBus(createBroadcastTransport());
