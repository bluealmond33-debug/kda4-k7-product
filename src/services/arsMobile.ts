import { API_BASE_URL } from "./config";
import type { ArsLifecycleEvent, ArsStateSnapshot } from "./arsControl";

const env = import.meta.env;

function wsBase(): string {
  const explicit = String(env.VITE_WS_BASE_URL ?? "").replace(/\/$/, "");
  if (explicit) return explicit;
  if (API_BASE_URL) return API_BASE_URL.replace(/^http/, "ws");
  const protocol = location.protocol === "https:" ? "wss" : "ws";
  return `${protocol}://${location.hostname}:8000`;
}

export interface MobileArsHandlers {
  onConnection?(connected: boolean): void;
  onCallStart?(event: ArsLifecycleEvent): void;
  onIntakeComplete?(event: ArsLifecycleEvent): void;
  onAgentConnected?(event: ArsLifecycleEvent): void;
  onCallEnd?(event: ArsLifecycleEvent): void;
  onState?(state: ArsStateSnapshot): void;
  onError?(message: string): void;
  /** 본인인증 생년월일 8자리 수집 시작(서버 ack) — 안내 음성 재생 신호로 쓴다. */
  onAuthStart?(): void;
  /** 자리 입력마다(8자리 전까지) — 화면에 "N/8" 같은 진행 표시용. */
  onAuthProgress?(count: number): void;
  /** 8자리 다 채워짐 — 데모는 대조 없이 여기서 바로 완료 처리. */
  onAuthComplete?(digits: string): void;
  /** 8자리 안 채우고 #/*를 눌렀을 때 — "8자리 다 눌러주세요" 리마인드용. */
  onAuthIncomplete?(count: number): void;
  /** 8자리는 채웠지만 형식이 유효한 생년월일이 아닐 때 — 재입력 요청. */
  onAuthMismatch?(): void;
}

export interface MobileArsHandle {
  startCall(): void;
  pressDigit(digit: string): boolean;
  startAuth(): void;
  endCall(): void;
  stop(options?: { hangup?: boolean }): void;
}

const VALID_DIGIT = /^[0-9*#]$/;

/** Actual Galaxy/customer browser ARS controller used by ?role=customer. */
export function startMobileArsControl(
  callId: string,
  handlers: MobileArsHandlers = {}
): MobileArsHandle {
  const id = encodeURIComponent(callId);
  let socket: WebSocket | null = null;
  let retryTimer = 0;
  let stateTimer = 0;
  let stopped = false;
  let hydrated = false;
  let generation = 0;
  let state: ArsStateSnapshot = {
    active: false,
    digits: "",
    intakeComplete: false,
    agentConnected: false,
    dtmfCount: 0,
    finalSeq: 0,
    drained: true,
    awaitingAuth: false,
    authDigitCount: 0,
    authVerified: false,
  };
  let pendingStart = false;
  let pendingStartSent = false;
  let inactiveAfterStart = 0;
  let pendingEndGeneration: number | null = null;
  let pendingIntakeGeneration: number | null = null;

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
    if (incoming > generation) generation = incoming;
    return true;
  };

  const send = (
    type: string,
    extra: Record<string, unknown> = {},
    commandGeneration = generation
  ) => {
    if (socket?.readyState !== WebSocket.OPEN) return false;
    socket.send(
      JSON.stringify({
        type,
        ...(type !== "state_request" && type !== "call_start" && commandGeneration > 0
          ? { generation: commandGeneration }
          : {}),
        ...extra,
      })
    );
    return true;
  };

  const flushPending = () => {
    if (!hydrated || socket?.readyState !== WebSocket.OPEN) return;
    const stateGeneration = Math.max(0, Number(state.generation) || 0);
    if (pendingEndGeneration !== null) {
      if (state.active && pendingEndGeneration === stateGeneration) {
        send("call_end", {}, pendingEndGeneration);
      } else {
        pendingEndGeneration = null;
      }
      return;
    }
    if (pendingStart) {
      if (state.active) {
        pendingStart = false;
        pendingStartSent = false;
        inactiveAfterStart = 0;
      } else if (!pendingStartSent && send("call_start")) {
        pendingStartSent = true;
        inactiveAfterStart = 0;
      }
      return;
    }
    if (pendingIntakeGeneration !== null) {
      if (
        pendingIntakeGeneration !== stateGeneration ||
        !state.active ||
        state.intakeComplete ||
        state.agentConnected
      ) {
        pendingIntakeGeneration = null;
      } else {
        send("intake_complete", {}, pendingIntakeGeneration);
      }
    }
  };

  const applySnapshot = (message: {
    active?: boolean;
    digits?: string;
    intake_complete?: boolean;
      agent_connected?: boolean;
      dtmf_count?: number;
    final_seq?: number;
    drained?: boolean;
    generation?: number;
    end_reason?: string;
    ended_by?: string;
    awaiting_auth?: boolean;
    auth_digit_count?: number;
    auth_verified?: boolean;
  }) => {
    state = {
      ...lifecycleEvent(message),
      active: Boolean(message.active),
      digits: String(message.digits ?? "").slice(-24),
      intakeComplete: Boolean(message.intake_complete),
      agentConnected: Boolean(message.agent_connected),
      dtmfCount: Math.max(0, Number(message.dtmf_count) || 0),
      awaitingAuth: Boolean(message.awaiting_auth),
      authDigitCount: Math.max(0, Number(message.auth_digit_count) || 0),
      authVerified: Boolean(message.auth_verified),
    };
    hydrated = true;
    if (state.active) pendingStart = false;
    if (state.active) {
      pendingStartSent = false;
      inactiveAfterStart = 0;
    } else if (pendingStart && pendingStartSent) {
      // One inactive snapshot can cross the just-sent call_start. Only retry
      // after two authoritative inactive snapshots to avoid double generation.
      inactiveAfterStart += 1;
      if (inactiveAfterStart >= 2) pendingStartSent = false;
    }
    if (!state.active) {
      pendingEndGeneration = null;
      pendingIntakeGeneration = null;
    }
    const stateGeneration = Math.max(0, Number(state.generation) || 0);
    if (
      pendingEndGeneration !== null &&
      pendingEndGeneration !== stateGeneration
    ) {
      pendingEndGeneration = null;
    }
    if (
      pendingIntakeGeneration !== null &&
      (pendingIntakeGeneration !== stateGeneration ||
        state.intakeComplete ||
        state.agentConnected)
    ) {
      pendingIntakeGeneration = null;
    }
    handlers.onState?.(state);
    flushPending();
  };

  const connect = () => {
    if (stopped) return;
    hydrated = false;
    socket = new WebSocket(`${wsBase()}/ws/ars/${id}?role=mobile`);
    socket.onopen = () => {
      handlers.onConnection?.(true);
      send("state_request");
      window.clearInterval(stateTimer);
      stateTimer = window.setInterval(() => send("state_request"), 1500);
    };
    socket.onmessage = (event) => {
      let message: {
        type?: string;
        active?: boolean;
        digits?: string;
        intake_complete?: boolean;
        agent_connected?: boolean;
        final_seq?: number;
        drained?: boolean;
        generation?: number;
        end_reason?: string;
        ended_by?: string;
        count?: number;
      };
      try {
        message = JSON.parse(event.data as string);
      } catch {
        return;
      }
      if (!acceptGeneration(message.generation)) return;
      const lifecycle = lifecycleEvent(message);
      if (message.type === "call_start") {
        // A start is a new authoritative session boundary. No command from the
        // prior session may survive even if an old client reported the same id.
        pendingEndGeneration = null;
        pendingIntakeGeneration = null;
        pendingStart = false;
        pendingStartSent = false;
        inactiveAfterStart = 0;
        state = { ...state, active: true, generation: lifecycle.generation };
        handlers.onCallStart?.(lifecycle);
      }
      if (message.type === "intake_complete") {
        pendingIntakeGeneration = null;
        state = { ...state, intakeComplete: true, ...lifecycle };
        handlers.onIntakeComplete?.(lifecycle);
      }
      if (message.type === "agent_connected") {
        pendingIntakeGeneration = null;
        state = { ...state, intakeComplete: true, agentConnected: true, ...lifecycle };
        handlers.onAgentConnected?.(lifecycle);
      }
      if (message.type === "call_end") {
        pendingEndGeneration = null;
        pendingStart = false;
        pendingStartSent = false;
        inactiveAfterStart = 0;
        pendingIntakeGeneration = null;
        state = { ...state, active: false, ...lifecycle };
        handlers.onCallEnd?.(lifecycle);
      }
      if (message.type === "auth_start") {
        state = { ...state, awaitingAuth: true, authDigitCount: 0, authVerified: false };
        handlers.onAuthStart?.();
      }
      if (message.type === "auth_progress") {
        const count = Math.max(0, Number(message.count) || 0);
        state = { ...state, authDigitCount: count };
        handlers.onAuthProgress?.(count);
      }
      if (message.type === "auth_complete" && typeof message.digits === "string") {
        state = { ...state, awaitingAuth: false, authVerified: true };
        handlers.onAuthComplete?.(message.digits);
      }
      if (message.type === "auth_incomplete") {
        handlers.onAuthIncomplete?.(Math.max(0, Number(message.count) || 0));
      }
      if (message.type === "auth_mismatch") {
        state = { ...state, authDigitCount: 0 };
        handlers.onAuthMismatch?.();
      }
      if (message.type === "ars_state") applySnapshot(message);
    };
    socket.onerror = () => handlers.onError?.("통화 서버에 연결할 수 없습니다.");
    socket.onclose = () => {
      hydrated = false;
      if (pendingStart) pendingStartSent = false;
      handlers.onConnection?.(false);
      window.clearInterval(stateTimer);
      if (!stopped) retryTimer = window.setTimeout(connect, 1500);
    };
  };

  connect();

  return {
    startCall() {
      if (pendingEndGeneration !== null || state.active) return;
      generation = 0;
      pendingStart = true;
      pendingStartSent = false;
      inactiveAfterStart = 0;
      pendingIntakeGeneration = null;
      state = {
        ...state,
        digits: "",
        dtmfCount: 0,
        intakeComplete: false,
        agentConnected: false,
      };
      flushPending();
    },
    pressDigit(digit) {
      if (
        !VALID_DIGIT.test(digit) ||
        !state.active ||
        pendingEndGeneration !== null ||
        pendingIntakeGeneration !== null ||
        !hydrated ||
        socket?.readyState !== WebSocket.OPEN
      ) {
        return false;
      }
      if (!send("dtmf", { digit })) return false;
      state = { ...state, digits: (state.digits + digit).slice(-24) };
      handlers.onState?.(state);
      // # only completes the pre-call intake. During the counselor call it is
      // an ordinary DTMF digit and can never end or re-complete the call.
      if (digit === "#" && !state.intakeComplete && !state.agentConnected) {
        // The DTMF write above succeeded, so this is now an acknowledged local
        // request. If the second write crosses a disconnect, reconnect/state
        // reconciliation retries only the idempotent intake_complete command.
        pendingIntakeGeneration = generation;
        send("intake_complete", {}, pendingIntakeGeneration);
      }
      return true;
    },
    startAuth() {
      if (!state.active || state.awaitingAuth || !hydrated || socket?.readyState !== WebSocket.OPEN) {
        return;
      }
      send("auth_start");
    },
    endCall() {
      pendingStart = false;
      pendingStartSent = false;
      pendingIntakeGeneration = null;
      pendingEndGeneration = null;
      if (!state.active || generation <= 0) return;
      pendingEndGeneration = generation;
      flushPending();
    },
    stop(options = {}) {
      if (options.hangup && state.active) send("call_end");
      stopped = true;
      window.clearTimeout(retryTimer);
      window.clearInterval(stateTimer);
      socket?.close();
    },
  };
}
