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
  /** 직원 화면(/analyze-text)이 실제 분류를 끝내면 온다 — 고객 폰은 이 분석을 직접 안
   *  돌리므로, 안 받으면 접수 시점 픽스처값(예: "주택담보대출 만기연장")이 통화종료
   *  문자 등에 계속 노출된다(2026-07-28 현장 피드백). */
  onRoutingUpdate?(routing: {
    department: string | null;
    businessType: string | null;
    taskCode: string | null;
    taskName: string | null;
  }): void;
}

export interface MobileArsHandle {
  startCall(): void;
  pressDigit(digit: string): boolean;
  /** 소켓이 아직 준비 안 됐으면(와이파이 재연결 중 등) false — 호출부가 재시도 여부를 안다. */
  startAuth(): boolean;
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
        department?: string;
        business_type?: string;
        task_code?: string;
        task_name?: string;
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
      if (message.type === "routing_update") {
        handlers.onRoutingUpdate?.({
          department: typeof message.department === "string" ? message.department : null,
          businessType: typeof message.business_type === "string" ? message.business_type : null,
          taskCode: typeof message.task_code === "string" ? message.task_code : null,
          taskName: typeof message.task_name === "string" ? message.task_name : null,
        });
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
        // pendingIntakeGeneration guards against sending stray DTMF while the
        // #-triggered intake_complete ack is still in flight. Auth digits are
        // unrelated to that handshake, so they must not wait on it — otherwise
        // a slow/lost ack (flaky WiFi) leaves the auth keypad permanently dead
        // even though the server already moved on to awaiting_auth.
        (pendingIntakeGeneration !== null && !state.awaitingAuth) ||
        !hydrated ||
        socket?.readyState !== WebSocket.OPEN
      ) {
        return false;
      }
      if (!send("dtmf", { digit })) return false;
      state = { ...state, digits: (state.digits + digit).slice(-24) };
      // 본인인증 자리 입력은 원래 서버 왕복(auth_progress 브로드캐스트)이 와야 화면 칸이
      // 채워졌다 — 와이파이가 느리면 누른 게 바로 안 보여 "안 눌린다"로 느껴졌다(2026-07-28
      // 현장 피드백). 누른 즉시 로컬로 먼저 한 칸 채우고, 서버 값이 도착하면(onAuthProgress·
      // onState 둘 다 authDigitCount를 그대로 덮어쓴다) 그걸로 보정한다 — 8자리는 값 무관
      // 통과라 mismatch로 어긋날 일이 사실상 없다.
      if (state.awaitingAuth && /^[0-9]$/.test(digit)) {
        state = { ...state, authDigitCount: Math.min(8, state.authDigitCount + 1) };
      }
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
        return false;
      }
      return send("auth_start");
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
