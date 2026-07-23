import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolveCallId, resolveExplicitCallId } from "../src/services/callId.ts";
import {
  reconcileArsInactiveSnapshot,
  reconcilePendingArsCommands,
  shouldIgnoreArsCallEnd,
  shouldStartFreshArsCall,
} from "../src/services/arsLifecycle.ts";
import {
  BoundedEnvelopeKeys,
  demoEnvelopeKey,
} from "../src/services/demoRelayContract.ts";
import {
  adminTranscriptIdentity,
  isMismatchedCallGeneration,
  shouldApplyAdminRouting,
  shouldCountAdminCard,
  shouldReplaceAdminCall,
} from "../src/services/adminCallLifecycle.ts";

assert.equal(resolveCallId("?call=kda-42"), "kda-42");
assert.equal(resolveCallId("?call_id=team.demo_1"), "team.demo_1");
assert.equal(resolveCallId("?call=../../escape"), "demo1");
assert.equal(resolveExplicitCallId("?call_id=team.demo_1"), "team.demo_1");
assert.equal(resolveExplicitCallId("?call=../../escape"), null);
assert.equal(resolveExplicitCallId("?role=customer"), null);

assert.equal(shouldStartFreshArsCall("wrap"), true);
assert.equal(shouldStartFreshArsCall("prep"), false);
assert.equal(shouldIgnoreArsCallEnd("summarizing"), true);
assert.equal(shouldIgnoreArsCallEnd("active"), false);

const firstInactive = reconcileArsInactiveSnapshot(
  { active: false, drained: true },
  { localActive: true, inactivePolls: 0 }
);
assert.deepEqual(firstInactive, { finalize: false, inactivePolls: 1 });
assert.deepEqual(
  reconcileArsInactiveSnapshot(
    { active: false, drained: true },
    { localActive: true, inactivePolls: firstInactive.inactivePolls }
  ),
  { finalize: true, inactivePolls: 2 }
);
assert.deepEqual(
  reconcileArsInactiveSnapshot(
    { active: false, drained: false },
    { localActive: true, inactivePolls: 1 }
  ),
  { finalize: false, inactivePolls: 1 }
);

const blockedUntilDrained = reconcilePendingArsCommands(
  { agentConnectedGeneration: 3, callEndGeneration: null },
  {
    generation: 3,
    active: true,
    intakeComplete: true,
    agentConnected: false,
    drained: false,
  }
);
assert.equal(blockedUntilDrained.sendAgentConnected, false);
assert.equal(blockedUntilDrained.pending.agentConnectedGeneration, 3);

const readyToConnect = reconcilePendingArsCommands(
  blockedUntilDrained.pending,
  {
    generation: 3,
    active: true,
    intakeComplete: true,
    agentConnected: false,
    drained: true,
  }
);
assert.equal(readyToConnect.sendAgentConnected, true);

const staleConnect = reconcilePendingArsCommands(
  { agentConnectedGeneration: 3, callEndGeneration: null },
  {
    generation: 4,
    active: true,
    intakeComplete: true,
    agentConnected: false,
    drained: true,
  }
);
assert.deepEqual(staleConnect, {
  pending: { agentConnectedGeneration: null, callEndGeneration: null },
  sendAgentConnected: false,
  sendCallEnd: false,
});

const staleEnd = reconcilePendingArsCommands(
  { agentConnectedGeneration: null, callEndGeneration: 3 },
  {
    generation: 4,
    active: true,
    intakeComplete: false,
    agentConnected: false,
    drained: true,
  }
);
assert.equal(staleEnd.sendCallEnd, false);
assert.equal(staleEnd.pending.callEndGeneration, null);

const firstEnvelope = {
  v: 1,
  type: "stt.utterance",
  payload: { callId: "kda-42", text: "테스트", isFinal: true, atMs: 1 },
  ts: 100,
  seq: 1,
  source: "counselor",
};
const reorderedEnvelope = {
  ...firstEnvelope,
  payload: { isFinal: true, text: "테스트", atMs: 1, callId: "kda-42" },
};
assert.equal(demoEnvelopeKey(firstEnvelope), demoEnvelopeKey(reorderedEnvelope));
const seen = new BoundedEnvelopeKeys(2);
assert.equal(seen.remember(demoEnvelopeKey(firstEnvelope)), true);
assert.equal(seen.remember(demoEnvelopeKey(reorderedEnvelope)), false);
assert.equal(seen.remember("second"), true);
assert.equal(seen.remember("third"), true);
assert.equal(seen.remember(demoEnvelopeKey(firstEnvelope)), true);

const callFlowSource = readFileSync(
  new URL("../src/hooks/useCallFlow.ts", import.meta.url),
  "utf8"
);
assert.doesNotMatch(callFlowSource, /control\.stop\(\{\s*hangup:/);
const demoBusSource = readFileSync(
  new URL("../src/services/demoBus.ts", import.meta.url),
  "utf8"
);
assert.match(demoBusSource, /if \(role === "customer"\) return false;/);

assert.equal(shouldReplaceAdminCall(1, true, 2), true);
assert.equal(shouldReplaceAdminCall(1, false, 2), true);
assert.equal(shouldReplaceAdminCall(1, true, 1), false);
assert.equal(shouldReplaceAdminCall(0, true, 0), true);
assert.equal(isMismatchedCallGeneration(2, 1), true);
assert.equal(isMismatchedCallGeneration(2, 2), false);
assert.equal(isMismatchedCallGeneration(2, undefined), false);

const historySegment = {
  callId: "kda-42",
  generation: 2,
  speaker: "customer",
  audioSeq: 7,
  atMs: 1_000,
  text: "첫 번째 수신",
};
assert.equal(
  adminTranscriptIdentity(historySegment),
  adminTranscriptIdentity({
    ...historySegment,
    // A replay envelope gets a new bus ts/seq, but its audio segment remains 7.
    atMs: 9_999,
    text: "재전송 복사본",
  })
);
assert.notEqual(
  adminTranscriptIdentity(historySegment),
  adminTranscriptIdentity({ ...historySegment, audioSeq: 8 })
);
assert.equal(shouldCountAdminCard(false), true);
assert.equal(shouldCountAdminCard(true), false);
assert.equal(shouldApplyAdminRouting(false), true);
assert.equal(shouldApplyAdminRouting(true), false);

console.log("live-call contract validation passed");
