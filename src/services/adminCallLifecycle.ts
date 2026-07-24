export function normalizeCallGeneration(value: unknown): number {
  return Math.max(0, Number(value) || 0);
}

/** Legacy generation 0 remains compatible; versioned events must match exactly. */
export function isMismatchedCallGeneration(
  currentGeneration: number,
  incomingGeneration: unknown
): boolean {
  const incoming = normalizeCallGeneration(incomingGeneration);
  return currentGeneration > 0 && incoming > 0 && incoming !== currentGeneration;
}

/** A redial replaces the latest same-call-id dashboard slot without duplicating order. */
export function shouldReplaceAdminCall(
  currentGeneration: number,
  ended: boolean,
  incomingGeneration: unknown
): boolean {
  const incoming = normalizeCallGeneration(incomingGeneration);
  if (incoming > 0 && currentGeneration > 0) return incoming > currentGeneration;
  return ended;
}

export interface AdminTranscriptIdentityInput {
  callId: string;
  generation?: number;
  speaker?: "customer" | "agent";
  audioSeq?: number;
  atMs: number;
  text: string;
}

/** Identity survives counselor reload because backend history preserves segment metadata. */
export function adminTranscriptIdentity(input: AdminTranscriptIdentityInput): string {
  const generation = normalizeCallGeneration(input.generation);
  const speaker = input.speaker === "agent" ? "agent" : "customer";
  const audioSeq = Math.max(0, Number(input.audioSeq) || 0);
  if (audioSeq > 0) {
    return `${input.callId}:${generation}:${speaker}:audio:${audioSeq}`;
  }
  const normalizedText = input.text.trim().replace(/\s+/g, " ");
  return `${input.callId}:${generation}:${speaker}:at:${Math.max(
    0,
    Number(input.atMs) || 0
  )}:${normalizedText}`;
}

export function shouldCountAdminCard(hasCard: boolean): boolean {
  return !hasCard;
}

export function shouldApplyAdminRouting(alreadyApplied: boolean): boolean {
  return !alreadyApplied;
}
