import { API_BASE_URL } from "./config";
import {
  reconcilePendingArsCommands,
  type ArsPendingCommands,
} from "./arsLifecycle";

const env = import.meta.env;

function wsBase(): string {
  const explicit = String(env.VITE_WS_BASE_URL ?? "").replace(/\/$/, "");
  if (explicit) return explicit;
  if (API_BASE_URL) return API_BASE_URL.replace(/^http/, "ws");
  const protocol = location.protocol === "https:" ? "wss" : "ws";
  return `${protocol}://${location.hostname}:8000`;
}

export interface ArsLifecycleEvent {
  finalSeq: number;
  drained: boolean;
  generation?: number;
  endReason?: string;
  endedBy?: string;
}

export interface ArsStateSnapshot extends ArsLifecycleEvent {
  active: boolean;
  digits: string;
  intakeComplete: boolean;
  agentConnected: boolean;
  dtmfCount: number;
}

export interface ArsDtmfEvent {
  digit: string;
  seq: number;
  phase: "intake" | "waiting_for_agent" | "active";
  capturedAt: number;
  persisted: boolean;
}

export interface ArsControlHandlers {
  onCallStart?(event: ArsLifecycleEvent): void;
  onIntakeComplete?(event: ArsLifecycleEvent): void;
  onAgentConnected?(): void;
  onDigit?(event: ArsDtmfEvent): void;
  onDigits?(digits: string): void;
  onCallEnd?(event: ArsLifecycleEvent): void;
  onState?(state: ArsStateSnapshot): void;
  onMobileStatus?(connected: boolean): void;
  onError?(message: string): void;
}

export interface ArsControlHandle {
  stop(): void;
  agentConnected(): void;
  endCall(): void;
}

/** Counselor-side ARS lifecycle control. */
export function startArsControl(
  callId: string,
  handlers: ArsControlHandlers = {}
): ArsControlHandle {
  const id = encodeURIComponent(callId);
  let socket: WebSocket | null = null;
  let retryTimer = 0;
  let stateTimer = 0;
  let stopped = false;
  let hydrated = false;
  let generation = 0;
  let latestState: ArsStateSnapshot | null = null;
  let pending: ArsPendingCommands = {
    agentConnectedGeneration: null,
    callEndGeneration: null,
  };

  const lifecycleEvent = (message: {
    final_seq?: number;
    drained?: boolean;
    generation?: number;
    end_reason?: string;
    ended_by?: string;
  }): ArsLifecycleEvent => ({
    finalSeq: Math.max(0, Number(message.final_seq) || 0),
    drained: message.drained !== false,
    generation: Math.max(0, Number(message.generation) || 0),
    endReason: typeof message.end_reason === "string" ? message.end_reason : undefined,
    endedBy: typeof message.ended_by === "string" ? message.ended_by : undefined,
  });

  const acceptGeneration = (value: unknown) => {
    const incoming = Math.max(0, Number(value) || 0);
    if (incoming > 0 && generation > 0 && incoming < generation) return false;
    if (incoming > generation) {
      generation = incoming;
      if (
        pending.agentConnectedGeneration !== null &&
        pending.agentConnectedGeneration !== incoming
      ) {
        pending.agentConnectedGeneration = null;
      }
      if (
        pending.callEndGeneration !== null &&
        pending.callEndGeneration !== incoming
      ) {
        pending.callEndGeneration = null;
      }
    }
    return true;
  };

  const send = (
    type: "agent_connected" | "call_end" | "state_request",
    commandGeneration = generation
  ) => {
    if (socket?.readyState !== WebSocket.OPEN) return false;
    socket.send(
      JSON.stringify(
        type === "state_request" || commandGeneration <= 0
          ? { type }
          : { type, generation: commandGeneration }
      )
    );
    return true;
  };

  const flushPending = () => {
    // A reconnect is not command-ready until ars_state hydrates the latest
    // generation. Commands are bound to the generation captured at the click.
    if (!hydrated || !latestState || socket?.readyState !== WebSocket.OPEN) return;
    const stateGeneration = Math.max(0, Number(latestState.generation) || 0);
    const decision = reconcilePendingArsCommands(pending, {
      generation: stateGeneration,
      active: latestState.active,
      intakeComplete: latestState.intakeComplete,
      agentConnected: latestState.agentConnected,
      drained: latestState.drained,
    });
    pending = decision.pending;
    if (decision.sendCallEnd) {
      send("call_end", stateGeneration);
      return;
    }
    if (decision.sendAgentConnected) send("agent_connected", stateGeneration);
  };

  const connect = () => {
    if (stopped) return;
    hydrated = false;
    socket = new WebSocket(`${wsBase()}/ws/ars/${id}?role=desktop`);
    socket.onmessage = (event) => {
      let message: {
        type?: string;
        digit?: string;
        role?: string;
        connected?: boolean;
        active?: boolean;
        digits?: string;
        intake_complete?: boolean;
        agent_connected?: boolean;
        final_seq?: number;
        drained?: boolean;
        generation?: number;
        end_reason?: string;
        ended_by?: string;
        dtmf_count?: number;
        dtmf_seq?: number;
        phase?: "intake" | "waiting_for_agent" | "active";
        captured_at_ms?: number;
        persisted?: boolean;
      };
      try {
        message = JSON.parse(event.data as string);
      } catch {
        return;
      }
      if (
        ["call_start", "intake_complete", "agent_connected", "dtmf", "call_end", "ars_state"].includes(
          message.type ?? ""
        ) &&
        !acceptGeneration(message.generation)
      ) {
        return;
      }
      if (message.type === "call_start") {
        // The previous snapshot is no longer authoritative for this generation.
        pending.agentConnectedGeneration = null;
        pending.callEndGeneration = null;
        hydrated = false;
        latestState = null;
        send("state_request");
        handlers.onCallStart?.(lifecycleEvent(message));
      }
      if (message.type === "intake_complete") {
        send("state_request");
        handlers.onIntakeComplete?.(lifecycleEvent(message));
      }
      if (message.type === "agent_connected") {
        pending.agentConnectedGeneration = null;
        handlers.onAgentConnected?.();
      }
      if (message.type === "dtmf" && message.digit) {
        handlers.onDigit?.({
          digit: message.digit,
          seq: Math.max(0, Number(message.dtmf_seq) || 0),
          phase: message.phase ?? "intake",
          capturedAt: Math.max(0, Number(message.captured_at_ms) || 0),
          persisted: message.persisted === true,
        });
      }
      if (message.type === "call_end") {
        pending.callEndGeneration = null;
        pending.agentConnectedGeneration = null;
        latestState = null;
        hydrated = false;
        handlers.onCallEnd?.(lifecycleEvent(message));
      }
      if (message.type === "peer_status" && message.role === "mobile") {
        handlers.onMobileStatus?.(Boolean(message.connected));
      }
      if (message.type === "ars_state") {
        const state: ArsStateSnapshot = {
          ...lifecycleEvent(message),
          active: Boolean(message.active),
          digits: message.digits ?? "",
          intakeComplete: Boolean(message.intake_complete),
          agentConnected: Boolean(message.agent_connected),
          dtmfCount: Math.max(0, Number(message.dtmf_count) || 0),
        };
        hydrated = true;
        latestState = state;
        handlers.onDigits?.(state.digits);
        handlers.onState?.(state);
        flushPending();
      }
    };
    socket.onopen = () => {
      // Do not flush pending commands here. First hydrate generation/state.
      send("state_request");
      window.clearInterval(stateTimer);
      stateTimer = window.setInterval(() => send("state_request"), 1500);
    };
    socket.onerror = () => handlers.onError?.("휴대폰 ARS 제어 채널에 연결할 수 없습니다.");
    socket.onclose = () => {
      hydrated = false;
      latestState = null;
      window.clearInterval(stateTimer);
      handlers.onMobileStatus?.(false);
      if (!stopped) retryTimer = window.setTimeout(connect, 1500);
    };
  };

  connect();

  return {
    agentConnected() {
      if (generation <= 0) {
        handlers.onError?.("활성 통화 세대를 확인한 뒤 다시 연결해 주세요.");
        send("state_request");
        return;
      }
      pending.agentConnectedGeneration = generation;
      pending.callEndGeneration = null;
      flushPending();
    },
    endCall() {
      if (generation <= 0) {
        handlers.onError?.("활성 통화 세대를 확인한 뒤 다시 종료해 주세요.");
        send("state_request");
        return;
      }
      pending.callEndGeneration = generation;
      pending.agentConnectedGeneration = null;
      flushPending();
    },
    stop() {
      stopped = true;
      window.clearTimeout(retryTimer);
      window.clearInterval(stateTimer);
      socket?.close();
    },
  };
}
