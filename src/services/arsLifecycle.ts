export interface ArsStateForReconciliation {
  active: boolean;
  drained: boolean;
}

export interface ArsInactiveReconciliation {
  finalize: boolean;
  inactivePolls: number;
}

export interface ArsPendingCommands {
  agentConnectedGeneration: number | null;
  callEndGeneration: number | null;
}

export interface ArsCommandState {
  generation: number;
  active: boolean;
  intakeComplete: boolean;
  agentConnected: boolean;
  drained: boolean;
}

export interface ArsPendingDecision {
  pending: ArsPendingCommands;
  sendAgentConnected: boolean;
  sendCallEnd: boolean;
}

export type ArsUiPhase =
  | "idle"
  | "connecting"
  | "recording"
  | "confirm"
  | "prep"
  | "active"
  | "summarizing"
  | "wrap";

/** A newer real call must not be attached to the previous wrap-up screen. */
export function shouldStartFreshArsCall(phase: ArsUiPhase): boolean {
  return phase === "idle" || phase === "summarizing" || phase === "wrap";
}

/** Late/replayed call_end events must not close an already-open wrap-up. */
export function shouldIgnoreArsCallEnd(phase: ArsUiPhase): boolean {
  return phase === "idle" || phase === "summarizing" || phase === "wrap";
}

/**
 * Require two drained inactive snapshots before reconciling a missing call_end.
 * A single stale poll must never tear down a just-started second call.
 */
export function reconcileArsInactiveSnapshot(
  state: ArsStateForReconciliation,
  options: { localActive: boolean; inactivePolls: number }
): ArsInactiveReconciliation {
  if (state.active || !options.localActive) {
    return { finalize: false, inactivePolls: 0 };
  }
  if (!state.drained) {
    return { finalize: false, inactivePolls: options.inactivePolls };
  }
  const inactivePolls = options.inactivePolls + 1;
  return { finalize: inactivePolls >= 2, inactivePolls };
}

/**
 * Reconcile queued counselor commands against an authoritative ARS snapshot.
 * A command belongs to exactly one generation and can never spill into a
 * redial. Agent capture may open only after intake has completed and drained.
 */
export function reconcilePendingArsCommands(
  commands: ArsPendingCommands,
  state: ArsCommandState
): ArsPendingDecision {
  let agentConnectedGeneration = commands.agentConnectedGeneration;
  let callEndGeneration = commands.callEndGeneration;

  if (callEndGeneration !== null) {
    if (callEndGeneration !== state.generation || !state.active) {
      callEndGeneration = null;
    } else {
      return {
        pending: { agentConnectedGeneration: null, callEndGeneration },
        sendAgentConnected: false,
        sendCallEnd: true,
      };
    }
  }

  if (agentConnectedGeneration !== null) {
    if (
      agentConnectedGeneration !== state.generation ||
      !state.active ||
      state.agentConnected
    ) {
      agentConnectedGeneration = null;
    }
  }

  return {
    pending: { agentConnectedGeneration, callEndGeneration },
    sendAgentConnected:
      agentConnectedGeneration === state.generation &&
      state.active &&
      state.intakeComplete &&
      state.drained &&
      !state.agentConnected,
    sendCallEnd: false,
  };
}
