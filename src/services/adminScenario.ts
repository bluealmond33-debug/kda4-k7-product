// 관리자 단독 시연 — 테스트 콜 1건을 실데모와 동일한 이벤트 열로 재생한다.
// 상담사 탭이 없어도 파이프라인 점등 → 피드 카드 → 부서 대기열 증가가 그대로 보인다.
// 수신 경로는 demoBus 하나뿐 — 라이브 콜과 테스트 콜의 렌더 분기가 없다.

import { TEST_CALLS } from "../data/adminContent";
import { demoBus } from "./demoBus";
import type { Sge } from "./sge";

let seq = 0;
const timers: number[] = [];

function at(ms: number, fn: () => void) {
  timers.push(window.setTimeout(fn, ms));
}

/** 진행 중인 테스트 콜 타이머 전부 중단 (대시보드 초기화 시) */
export function cancelTestCalls() {
  timers.forEach(clearTimeout);
  timers.length = 0;
}

export function playTestCall(sge: Sge) {
  const fx = TEST_CALLS[sge];
  const callId = `admin-test-${sge.toLowerCase()}-${++seq}-${Date.now().toString(36)}`;
  const gap = 1100; // 발화 간격
  const t0 = 600 + fx.utterances.length * gap; // 발화가 끝나는 시점

  demoBus.emit("call.incoming", { callId, kind: fx.kind });
  demoBus.emit("pipeline.stage", { callId, stage: "utterance", status: "start" });
  at(500, () => {
    demoBus.emit("pipeline.stage", { callId, stage: "utterance", status: "done" });
    demoBus.emit("pipeline.stage", { callId, stage: "stt", status: "start" });
  });
  fx.utterances.forEach((text, i) =>
    at(600 + i * gap, () =>
      demoBus.emit("stt.utterance", { callId, text, isFinal: true, atMs: i * gap })
    )
  );
  at(t0, () => {
    demoBus.emit("pipeline.stage", { callId, stage: "stt", status: "done" });
    demoBus.emit("pipeline.stage", { callId, stage: "classify", status: "start" });
  });
  at(t0 + 700, () => {
    demoBus.emit("pipeline.stage", { callId, stage: "classify", status: "done" });
    demoBus.emit("pipeline.stage", { callId, stage: "risk", status: "start" });
  });
  at(t0 + 1400, () => {
    demoBus.emit("pipeline.stage", { callId, stage: "risk", status: "done" });
    demoBus.emit("pipeline.stage", { callId, stage: "persist", status: "start" });
  });
  at(t0 + 2100, () => {
    demoBus.emit("pipeline.stage", {
      callId,
      stage: "persist",
      status: "done",
      detail: "mvp-1.0 카드 저장",
    });
    demoBus.emit("card.created", {
      callId,
      summary: fx.card.summary,
      businessType: fx.card.businessType,
      businessCode: fx.card.businessCode,
      department: fx.card.department,
      routingReason: fx.card.routingReason,
      incidentRisk: fx.card.incidentRisk,
      riskReason: fx.card.riskReason,
      confidence: fx.card.confidence,
      emotionLevel: fx.card.emotionLevel,
      source: "demo",
    });
    demoBus.emit("pipeline.stage", { callId, stage: "route", status: "start" });
  });
  at(t0 + 2800, () => {
    demoBus.emit("pipeline.stage", {
      callId,
      stage: "route",
      status: "done",
      detail: fx.card.department,
    });
    demoBus.emit("routing.assigned", {
      callId,
      department: fx.card.department,
      sge: fx.sge, // 픽스처가 라우팅 1층을 명시 — 판정 로직과 무관하게 시연 의도대로
      confidence: fx.card.confidence,
      risk: fx.card.incidentRisk,
    });
  });
  // 단순(S)은 AI가 즉시 응대 → RAG·후처리까지, 일반·긴급은 대기열에 남는다(WAITING)
  if (sge === "S") {
    at(t0 + 3500, () =>
      demoBus.emit("pipeline.stage", { callId, stage: "rag", status: "start" })
    );
    at(t0 + 4300, () =>
      demoBus.emit("pipeline.stage", {
        callId,
        stage: "rag",
        status: "done",
        detail: "규정 1건 참조",
      })
    );
    at(t0 + 5200, () => {
      demoBus.emit("pipeline.stage", {
        callId,
        stage: "wrap",
        status: "done",
        detail: "AI 자동 응대 완료",
      });
      demoBus.emit("call.ended", {
        callId,
        wrapType: "카드 › 사용내역 조회",
        wrapResult: "AI 상담 완료",
      });
    });
  }
  return callId;
}
