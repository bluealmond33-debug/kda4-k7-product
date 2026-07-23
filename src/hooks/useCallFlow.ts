import type * as React from "react";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  SCRIPTS,
  REG_RECOS,
  REG_QUERY,
  SUMMARY_POINTS,
  SUMMARY_PROSE,
  CUSTOMER,
  SHEETS,
  URGENT_RESPONSE,
  TRANSFER_RESPONSE,
  TRANSFER_HANDOVER,
  TRANSFER_TARGETS,
  TRANSFER_DEPTS,
  SUGGESTED_DEPT,
  type IncomingKind,
  type SheetData,
  renderSheet,
  WRAP_TYPE_OPTIONS,
  WRAP_RESULT_OPTIONS,
  WRAP_DEFAULTS,
  type Followup,
} from "../data/demoContent";
import {
  startSttSession,
  summarize,
  createConsultationFromAudio,
  getDemoConsultationCard,
  parseEmotionSource,
  emotionSourceBadge,
  demoBus as sharedDemoBus,
  deriveSge,
  type CallSummary,
  type ConsultationCardResponse,
  type TranscriptChunk,
  type SttSession,
} from "../services";
import {
  searchRegulations,
  fetchRegulationDocument,
  type RegulationDoc,
  categoryForDepartment,
  semanticSearchEnabled,
  type RegulationHit,
} from "../services/regulationSearch";
import { API_BASE_URL, useReal } from "../services/config";
import {
  startLiveCall,
  type LiveHandle,
  type LiveSpeaker,
  type LiveTranscript,
} from "../services/liveCall";
import { resolveCallId, resolveExplicitCallId } from "../services/callId";
import {
  startArsControl,
  type ArsControlHandle,
  type ArsDtmfEvent,
  type ArsLifecycleEvent,
  type ArsStateSnapshot,
} from "../services/arsControl";
import {
  startMobileArsControl,
  type MobileArsHandle,
} from "../services/arsMobile";
import {
  reconcileArsInactiveSnapshot,
  shouldIgnoreArsCallEnd,
  shouldStartFreshArsCall,
} from "../services/arsLifecycle";

export type Phase =
  | "idle"
  | "connecting"
  | "recording"
  | "confirm"
  | "prep"
  | "active"
  | "summarizing"
  | "wrap";

export type Mode = "sim" | "mic";
export type DockType = "history" | "accounts";
export type AuthMethod = "phone" | "birth" | "account";

export interface CallFlowConfig {
  /** Seconds of silence before the "still there?" confirm prompt. */
  silenceSec1?: number;
  /** Seconds of further silence before the summary is finalised. */
  silenceSec2?: number;
  /** Gap between scripted transcript lines (ms). */
  lineGapMs?: number;
  /** 스테이지 기준 폭(px). 기본 1420(합본). 고객 화면처럼 콘텐츠가 좁은 뷰는 줄인다. */
  stageW?: number;
  /** 스케일 상한. 기본 1(축소만). 좁은 스테이지는 >1로 화면을 채워 여백을 없앤다. */
  maxScale?: number;
  /** 스테이지 좌우 여백(px). 0이면 가로를 꽉 채운다. */
  fitPad?: number;
  /** false면 세로 캡 없이 가로 기준으로만 스케일(세로는 스크롤). */
  fitHeight?: boolean;
  /** Which independently opened LAN surface owns ARS control. */
  surface?: "full" | "phone" | "desktop";
}

const STAGE_W = 1420;
const LABELS: Record<Phase, string> = {
  idle: "대기",
  connecting: "자연어 접수 안내",
  recording: "용건 접수·요약",
  confirm: "추가 문의 확인",
  prep: "상담 준비 카드",
  active: "상담 통화중",
  summarizing: "후처리 요약 중",
  wrap: "후처리",
};
const STATUS: Partial<Record<Phase, string>> = {
  connecting: "연결 대기 중",
  recording: "용건 접수 중 (녹음)",
  confirm: "추가 문의 확인 중",
  prep: "AI 요약 완료 · 우선 연결 중",
  active: "상담사 통화 중",
  summarizing: "통화 종료",
  wrap: "통화 종료",
};
const GLASS: Partial<Record<Phase, string>> = {
  connecting:
    "연결 대기 중입니다. 상담사 연결 전 문의하실 내용을 음성으로 말씀해 주세요. 언제든 상담사 연결을 요청하실 수 있어요.",
  confirm: "더 말씀하실 내용이 있으신가요?",
  prep: "상담사에게 우선 연결하고 있습니다.",
};
const PREP_ITEMS = [
  {
    title: "본인확인 우선 진행",
    sub: "연결 직후 연락처·생년월일 등으로 본인확인",
  },
  {
    title: "단정적 안내 금지",
    sub: "조건·심사·처리 결과를 확인하기 전에는 확정 표현을 피하고 확인된 기준으로 안내",
  },
  { title: "문의 내용과 담당 부서 확인", sub: "요약·업무유형·라우팅 근거가 고객 발화와 맞는지 확인" },
];

/** 데모 안내(가이드 모드) — 화면별로 "이 화면이 무엇이고 왜 이렇게 생겼는지"를 설명한다.
 *  멘토·처음 보는 사람에게 시연할 때 켠다. phase → guideKey 로 매핑. */
type GuideKey = "idle" | "intake" | "prep" | "active" | "wrap";
const GUIDE: Record<GuideKey, { step: string; title: string; points: string[]; next: string }> = {
  idle: {
    step: "대기",
    title: "시계가 화면의 주인공인 이유",
    points: [
      "직원 화면의 언어는 '설명'이 아니라 '상태'입니다. 대기 중 능동적으로 볼 정보는 시각 하나뿐이라, 시계를 주인공으로 뒀습니다.",
      "전화는 자동으로 도착하므로 '전화 받기' 같은 입구 버튼은 존재감을 낮췄고, 하단 회색 항목(처리 내역·매뉴얼·코칭)은 짬에 하는 부차 활동이라 배경으로 물러나 있습니다.",
      "상태(수신 가능·대기열·다음 콜백)는 우상단 한 곳에만 모읍니다 — 같은 정보를 두 번 표시하지 않습니다.",
    ],
    next: "왼쪽 전화기의 초록 통화 버튼을 눌러 전화를 걸어보세요.",
  },
  intake: {
    step: "접수",
    title: "AI가 용건을 먼저 정리합니다",
    points: [
      "고객이 대기 중 말한 용건을 AI가 실시간으로 접수·요약합니다. 상담사는 통화를 받기 전부터 '무슨 일인지'를 압니다.",
      "이때 필요한 신호는 감정온도·접수 경과뿐 — 나머지는 요약이 끝나면 준비 카드로 옵니다.",
    ],
    next: "상단 '5초 건너뛰고 요약'으로 바로 넘어갈 수 있어요.",
  },
  prep: {
    step: "준비",
    title: "준비 카드 — 이 데모의 핵심",
    points: [
      "가장 큰 글씨(AI 사전 녹음 요약)가 '무슨 일'입니다. 아래 근거 발화·상담사가 할 일·배정 확신도가 그 요약을 뒷받침합니다.",
      "오른쪽 감정온도·사고징후는 '어떻게 응대할지'의 신호입니다.",
      "유의사항을 하나씩 확인하면 게이지가 차고, 4개를 모두 확인하면 그 자리가 '첫 응대 문장'으로 바뀌며 통화 연결이 열립니다 — 준비의 마지막 단계가 곧 오프닝 멘트입니다.",
    ],
    next: "유의사항의 '확인'을 네 번 눌러 통화를 열어보세요.",
  },
  active: {
    step: "통화",
    title: "통화 콘솔 — 3열 작업대",
    points: [
      "왼쪽=고객 정보와 본인확인(인증 전엔 상세 조회가 잠깁니다) · 가운데=AI 요약과 단계별 스크립트·메모 · 오른쪽=이 상담에 필요한 규정·매뉴얼.",
      "빛·글로우·깜빡임 대신 그림자 깊이만으로 초점을 줍니다 — 8시간 응시해도 눈이 덜 피로하도록.",
      "감정온도는 고정값이 아니라 통화 중 실시간으로 갱신됩니다(잠시 후 주의→안정).",
    ],
    next: "오른쪽 위 빨간 '통화 종료'를 누르면 후처리로 이어집니다.",
  },
  wrap: {
    step: "후처리",
    title: "상담사의 유일한 산출물 = 초안 검증",
    points: [
      "통화 종료와 동시에 시트가 자동으로 올라옵니다. 통화 화면은 배경에 남아 방금 내용을 다시 볼 수 있습니다.",
      "왼쪽 상담 정보는 녹취·메모에서 자동으로 채워지고, 상담사는 필요한 것만 고칩니다(연필 아이콘). 오른쪽 초안도 클릭해 편집합니다.",
      "상담 유형·결과·후속조치는 이번 콜 유형에 맞춰 미리 채워집니다.",
    ],
    next: "'초안 폐기·다음 콜' 또는 상단 '초기화'로 처음부터 다시 볼 수 있어요.",
  },
};
// 가이드 투어 순서 — 스테퍼 인디케이터·이전/다음 내비게이션 기준
const GUIDE_ORDER: GuideKey[] = ["idle", "intake", "prep", "active", "wrap"];

const RISK_LABELS = { low: "낮음", high: "높음" } as const;
const EMOTION_LABELS = { stable: "안정", caution: "주의", elevated: "고조" } as const;
// 색은 값에 바인딩 — 낮음이 빨갛게, 주의가 늘 앰버로 보이는 거짓말을 막는다
const EMOTION_COLORS = {
  stable: { fg: "var(--green-900)", bar: "var(--green-700)" },
  caution: { fg: "var(--amber-900)", bar: "var(--amber-700)" },
  elevated: { fg: "var(--red-900)", bar: "var(--red-700)" },
} as const;
const RISK_COLORS = { low: "var(--green-900)", high: "var(--red-900)" } as const;

const fmt = (s: number) => {
  const m = Math.floor(s / 60);
  const r = s % 60;
  return (m < 10 ? "0" : "") + m + ":" + (r < 10 ? "0" : "") + r;
};

const fmtCallTimestamp = (date: Date) => {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}.${pad(date.getMonth() + 1)}.${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
};

const LIVE_CALL_SEARCH = typeof location === "undefined" ? "" : location.search;
const EXPLICIT_LIVE_CALL_ID = resolveExplicitCallId(LIVE_CALL_SEARCH);
const LIVE_CALL_ID = resolveCallId(LIVE_CALL_SEARCH);
const SILENT_DEMO_PUBLISHER: Pick<typeof sharedDemoBus, "emit"> = {
  emit: () => undefined,
};

type SpeakerTranscriptChunk = TranscriptChunk & {
  speaker: LiveSpeaker;
  seq: number;
};

type SummaryScope = "intake" | "full";

export function useCallFlow(config: CallFlowConfig = {}) {
  const s1 = config.silenceSec1 ?? 5;
  const s2 = config.silenceSec2 ?? 5;
  const lineGap = config.lineGapMs ?? 2400;
  const surface = config.surface ?? "full";
  const isCustomerSurface = surface === "phone";
  // The counselor surface is the sole publisher of server-derived call events.
  // The customer still renders its direct STT stream, but does not create a
  // second envelope with a different ts/seq for the same transcript.
  const demoBus = isCustomerSurface ? SILENT_DEMO_PUBLISHER : sharedDemoBus;

  const [phase, setPhase] = useState<Phase>("idle");
  const [mode, setMode] = useState<Mode>("sim");
  // 다음 인입 콜 유형 (데모) — normal | urgent(장면 A) | transfer(이관 수신)
  const [incoming, setIncoming] = useState<IncomingKind>("normal");
  // 통화 중 "이관 예약" — 통화를 끊지 않고 걸어두면 종료 시 인계된다
  const [transferReserved, setTransferReserved] = useState(false);
  // 이관 예약 대상 — null = 기본(부서 대기열 자동 배정), 이름 = 지정 상담사
  const [transferTarget, setTransferTarget] = useState<string | null>(null);
  // 감정온도는 고정값이 아니라 실시간 신호 — 데모에선 통화 20초 후 안정으로 하강(상담 효과 연출)
  const [emoDrift, setEmoDrift] = useState<{ score: number; level: "stable" | "caution" | "elevated"; reason: string } | null>(null);
  const [clock, setClock] = useState(0);
  const [callStartedAt, setCallStartedAt] = useState("");
  const [emo, setEmo] = useState(0);
  const [silenceLeft, setSilenceLeft] = useState(0);
  const [micErr, setMicErr] = useState("");
  const [audioBusy, setAudioBusy] = useState(false);
  const [liveCaption, setLiveCaption] = useState("");
  const [liveCaptionSpeaker, setLiveCaptionSpeaker] =
    useState<LiveSpeaker>("customer");
  const [liveTranscriptLines, setLiveTranscriptLines] = useState<LiveTranscript[]>([]);
  const [captureBySpeaker, setCaptureBySpeaker] = useState<Record<LiveSpeaker, boolean>>({
    customer: false,
    agent: false,
  });
  const [levelBySpeaker, setLevelBySpeaker] = useState<Record<LiveSpeaker, number>>({
    customer: 0,
    agent: 0,
  });
  const [analysisSource, setAnalysisSource] = useState("demo");
  const [liveActionItems, setLiveActionItems] = useState<string[]>([]);
  const [summaryPending, setSummaryPending] = useState(false);
  const [arsDigits, setArsDigits] = useState("");
  const [dtmfEvents, setDtmfEvents] = useState<ArsDtmfEvent[]>([]);
  const [arsMobileConnected, setArsMobileConnected] = useState(false);
  const [mobileServerConnected, setMobileServerConnected] = useState(false);
  const [mobileIntakeComplete, setMobileIntakeComplete] = useState(false);
  const [mobileIntakePending, setMobileIntakePending] = useState(false);
  const [mobileAgentConnected, setMobileAgentConnected] = useState(false);

  const [prepChecks, setPrepChecks] = useState<boolean[]>(PREP_ITEMS.map(() => true));
  const [verified, setVerified] = useState(false);
  const [authMethod, setAuthMethod] = useState<AuthMethod>("phone");
  const [authInput, setAuthInput] = useState("");
  const [authErr, setAuthErr] = useState(false);
  const [authErrMsg, setAuthErrMsg] = useState("");
  const [authTime, setAuthTime] = useState("");
  const [authMethodLabel, setAuthMethodLabel] = useState("");

  const [memoItems, setMemoItems] = useState<string[]>([]);
  const [memoDraft, setMemoDraft] = useState("");
  const memoDraftRef = useRef("");
  memoDraftRef.current = memoDraft;

  const [dockType, setDockType] = useState<DockType | null>(null);
  const [regExpanded, setRegExpanded] = useState(false);
  // 규정집 실검색 — 비어 있으면 전체, 입력하면 조항·항목·내용·멘트를 훑는다
  const [regSearch, setRegSearch] = useState("");
  // 업로드한 실제 파일(CSV/XLSX)이 더미 시트를 대체한다 — 세션 동안 유지
  const [manualData, setManualData] = useState<SheetData | null>(null);
  // 규정집을 '열기'로 열면 해당 조항 행이 강조된다 (0-base 행 인덱스)
  const [regTargetRow, setRegTargetRow] = useState<number | null>(null);
  // 실제 규정 원문 열람 — 검색 히트를 클릭하면 그 문서의 청크 전체가 시트로 열린다
  const [regDoc, setRegDoc] = useState<RegulationDoc | null>(null);
  const [regDocChunk, setRegDocChunk] = useState<string | null>(null);
  const [regDocLoading, setRegDocLoading] = useState(false);
  const openRegDocReal = useCallback((docId: string, chunkId?: string) => {
    setRegExpanded(true);
    setRegTargetRow(null);
    setRegDocChunk(chunkId ?? null);
    setRegDocLoading(true);
    void fetchRegulationDocument(docId)
      .then((doc) => setRegDoc(doc))
      .finally(() => setRegDocLoading(false));
  }, []);
  // 의미 검색(2단 검색의 2단째) — 로컬 시트 필터는 0ms 즉시, 시맨틱은 디바운스 후
  // 백엔드 pgvector 하이브리드(/api/v1/regulations/search)가 규정 원문 청크를 더한다
  const [semHits, setSemHits] = useState<RegulationHit[]>([]);
  const [semLoading, setSemLoading] = useState(false);

  // 데모 안내(가이드 모드) — 화면별 소개 팝업. 로드/단계도달 후 '잠시 뒤' 자동으로 뜬다(아래 효과).
  const [guideOpen, setGuideOpen] = useState(false);
  // 팝업이 보여줄 단계 — 도달 시 자동으로 현재 단계, 스테퍼 번호 클릭 시 그 단계
  const [guideStep, setGuideStep] = useState<GuideKey>("idle");

  const [wrapSheetOpen, setWrapSheetOpen] = useState(false);
  const [summaryVersion, setSummaryVersion] = useState(0);
  const [regenerating, setRegenerating] = useState(false);
  const [wrapType, setWrapType] = useState(WRAP_DEFAULTS.normal.type);
  const [wrapResult, setWrapResult] = useState(WRAP_DEFAULTS.normal.result);
  const [typeMenu, setTypeMenu] = useState(false);
  const [resultMenu, setResultMenu] = useState(false);
  const [followups, setFollowups] = useState<Followup[]>(WRAP_DEFAULTS.normal.followups);

  const [summary, setSummary] = useState<CallSummary | null>(null);
  const [consultationResponse, setConsultationResponse] =
    useState<ConsultationCardResponse>(() => getDemoConsultationCard());
  const summaryText = useRef("");

  const [scale, setScale] = useState(1);
  const [natH, setNatH] = useState(0);

  // ── imperative bookkeeping (not part of render state) ──
  const timers = useRef<number[]>([]);
  const clockT = useRef<number | null>(null);
  const silT = useRef<number | null>(null);
  const silStage = useRef<null | "first" | "confirmPause" | "second">(null);
  const silEnd = useRef(0);
  const stt = useRef<SttSession | null>(null);
  const live = useRef<LiveHandle | null>(null);
  const arsControlRef = useRef<ArsControlHandle | null>(null);
  const mobileArsRef = useRef<MobileArsHandle | null>(null);
  const transcript = useRef<SpeakerTranscriptChunk[]>([]);
  const realCallActiveRef = useRef(false);
  const lifecycleEpoch = useRef(0);
  const intakeTransitionPending = useRef(false);
  const endTransitionPending = useRef(false);
  const endRequested = useRef(false);
  const resetRequested = useRef(false);
  const inactiveStatePolls = useRef(0);
  const callGenerationRef = useRef(0);
  const analysisRequestSeq = useRef(0);
  const analysisAbortRef = useRef<AbortController | null>(null);
  const phaseRef = useRef<Phase>("idle");
  const transitionPhase = useCallback((next: Phase) => {
    phaseRef.current = next;
    setPhase(next);
  }, []);
  phaseRef.current = phase;
  // 데모 이벤트 버스용 참조 — 타이머(비동기) 콜백이 최신 카드·콜 유형·이관 상태를 읽는다
  const respRef = useRef<ConsultationCardResponse>(consultationResponse);
  respRef.current = consultationResponse;
  const incomingRef = useRef<IncomingKind>("normal");
  incomingRef.current = incoming;
  const transferRef = useRef<{ reserved: boolean; target: string | null }>({
    reserved: false,
    target: null,
  });
  transferRef.current = { reserved: transferReserved, target: transferTarget };
  const wrapRef = useRef({ type: wrapType, result: wrapResult });
  wrapRef.current = { type: wrapType, result: wrapResult };

  const rootRef = useRef<HTMLDivElement | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);

  const after = useCallback((ms: number, fn: () => void) => {
    const id = window.setTimeout(fn, ms);
    timers.current.push(id);
    return id;
  }, []);

  const clearAll = useCallback(() => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
    if (clockT.current) {
      clearInterval(clockT.current);
      clockT.current = null;
    }
    if (silT.current) {
      clearInterval(silT.current);
      silT.current = null;
    }
    silStage.current = null;
    if (stt.current) {
      stt.current.stop();
      stt.current = null;
    }
    if (live.current) {
      live.current.stop();
      live.current = null;
    }
    analysisAbortRef.current?.abort();
    analysisAbortRef.current = null;
    setCaptureBySpeaker({ customer: false, agent: false });
    setLevelBySpeaker({ customer: 0, agent: 0 });
  }, []);

  const waitForFinalTranscript = useCallback(async (finalSeq: number, expectedEpoch: number) => {
    if (finalSeq <= 0) return true;
    const deadline = Date.now() + 30_000;
    while (Date.now() < deadline) {
      if (lifecycleEpoch.current !== expectedEpoch) return false;
      const handle = live.current;
      if (handle) {
        const received = await handle.waitForSeq(
          finalSeq,
          Math.max(1, deadline - Date.now())
        );
        return lifecycleEpoch.current === expectedEpoch && received;
      }
      await new Promise<void>((resolve) => window.setTimeout(resolve, 25));
    }
    return false;
  }, []);

  const startClock = useCallback(() => {
    if (clockT.current) return;
    clockT.current = window.setInterval(() => setClock((c) => c + 1), 1000);
  }, []);

  // 분류 파이프라인 이벤트 연출 — 관리자 대시보드(?role=admin)가 구독한다.
  // 실제 처리(픽스처)는 즉시 끝나므로 스테이지 진행을 step 간격으로 흘린다.
  // 여기서는 emit만 한다 — 통화 상태 로직에는 일절 관여하지 않는다.
  const emitCardPipeline = useCallback(
    (
      source: "demo" | "backend",
      step = 700,
      options: { persist?: boolean } = {}
    ) => {
      const persist = options.persist !== false;
      const callId = respRef.current.call_id;
      demoBus.emit("pipeline.stage", { callId, stage: "stt", status: "done" });
      demoBus.emit("pipeline.stage", { callId, stage: "classify", status: "start" });
      after(step, () => {
        demoBus.emit("pipeline.stage", { callId, stage: "classify", status: "done" });
        demoBus.emit("pipeline.stage", { callId, stage: "risk", status: "start" });
      });
      after(step * 2, () => {
        demoBus.emit("pipeline.stage", { callId, stage: "risk", status: "done" });
        demoBus.emit("pipeline.stage", {
          callId,
          stage: "persist",
          status: persist ? "start" : "skip",
          ...(!persist ? { detail: "실시간 시연 경로 · 아직 저장하지 않음" } : {}),
        });
      });
      after(step * 3, () => {
        const { consultation_card: card } = respRef.current;
        if (persist) {
          demoBus.emit("pipeline.stage", {
            callId,
            stage: "persist",
            status: "done",
            detail: "mvp-1.0 카드 저장",
          });
        }
        demoBus.emit("card.created", {
          callId,
          summary: card.summary,
          businessType: card.business_type,
          department: card.department,
          routingReason: card.routing_reason,
          incidentRisk: card.incident_risk,
          riskReason: card.risk_reason,
          confidence: card.routing_confidence,
          emotionLevel: card.emotion.level,
          source,
        });
        demoBus.emit("pipeline.stage", { callId, stage: "route", status: "start" });
      });
      after(step * 4, () => {
        const { consultation_card: card } = respRef.current;
        demoBus.emit("pipeline.stage", {
          callId,
          stage: "route",
          status: "done",
          detail: card.department,
        });
        demoBus.emit("routing.assigned", {
          callId,
          department: card.department,
          sge: deriveSge(card.incident_risk, card.department, incomingRef.current),
          confidence: card.routing_confidence,
          risk: card.incident_risk,
        });
      });
    },
    [after]
  );

  // ── silence detection (scripted demo) / explicit # completion (real call) ──
  const runSummary = useCallback(async (
    options: { forceLive?: boolean; scope?: SummaryScope } = {}
  ): Promise<boolean> => {
    const { forceLive = false, scope = "intake" } = options;
    analysisAbortRef.current?.abort();
    analysisAbortRef.current = null;
    const requestSeq = ++analysisRequestSeq.current;
    const epoch = lifecycleEpoch.current;
    const chunks = transcript.current.filter(
      (chunk) => scope === "full" || chunk.speaker === "customer"
    );
    const turns = chunks
      .filter((chunk) => chunk.isFinal && chunk.text.trim())
      .slice(0, 1_000)
      .map((chunk, index) => ({
        speaker: chunk.speaker,
        text: chunk.text.trim().slice(0, 4_000),
        seq: chunk.seq || index + 1,
        at: chunk.at,
      }));
    const text = (scope === "full"
      ? turns
          .map((turn) => `[${turn.speaker === "agent" ? "상담원" : "고객"}] ${turn.text}`)
          .join("\n")
      : turns.map((turn) => turn.text).join(" ")
    ).slice(0, 12_000);
    const isCurrent = () =>
      lifecycleEpoch.current === epoch && analysisRequestSeq.current === requestSeq;
    const useLocalLiveAnalysis = forceLive || realCallActiveRef.current;

    if (!text && useLocalLiveAnalysis) {
      if (!isCurrent()) return false;
      const headline = "수신된 고객 발화가 없어 자동 요약을 생성하지 않았습니다.";
      setAnalysisSource("no-transcript");
      setLiveActionItems(["고객 문의 내용을 다시 확인해 주세요."]);
      setSummary({
        type: "미분류",
        headline,
        bullets: ["수신된 음성 발화 없음"],
        emotion: { score: 0, level: "stable", label_ko: "안정", signals: [] },
        incidentRisk: "watch",
        recommendedAgent: "상담사 확인 필요",
      });
      setConsultationResponse((prev) => {
        const next: ConsultationCardResponse = {
          ...prev,
          transcript: { ...prev.transcript, text: "" },
          consultation_card: {
            ...prev.consultation_card,
            summary: headline,
            business_type: "미분류",
            department: "일반상담팀",
            routing_reason: "고객 발화가 없어 자동 라우팅하지 않음",
            incident_risk: "low",
            risk_reason: null,
            routing_confidence: null,
            emotion: {
              status: "unavailable",
              score: null,
              level: null,
              reason: "분석할 음성 발화가 없습니다.",
            },
          },
        };
        respRef.current = next;
        return next;
      });
      setSummaryPending(false);
      setWrapType("미분류");
      setWrapResult("상담 종료 · 내용 확인 필요");
      setFollowups([]);
      return true;
    }

    if (!text || (!useLocalLiveAnalysis && !useReal.data)) {
      const [result] = await Promise.allSettled([
        summarize({ chunks, text }),
      ]);
      if (!isCurrent()) return false;
      if (result.status === "fulfilled") setSummary(result.value);
      return true;
    }

    if (isCurrent()) setSummaryPending(true);
    const controller = new AbortController();
    analysisAbortRef.current = controller;
    try {
      const localApiBase =
        API_BASE_URL || `${location.protocol}//${location.hostname}:8000`;
      const response = await fetch(
        useLocalLiveAnalysis
          ? `${localApiBase}/api/live-stt/analyze`
          : `${API_BASE_URL}/analyze-text`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text, turns, scope, average_volume: 0 }),
          signal: controller.signal,
        }
      );
      if (!response.ok) throw new Error(`analyze-text ${response.status}`);
      const data = await response.json();
      if (!isCurrent()) return false;
      const emotionAvailable =
        data?.emotion?.status === "completed" &&
        typeof data?.emotion?.score === "number";
      const emotionScore = emotionAvailable ? Number(data.emotion.score) : 0;
      const emotionLevel =
        emotionScore >= 70 ? "elevated" : emotionScore >= 40 ? "caution" : "stable";
      const highRisk = Number(data?.urgency_score ?? 0) >= 60;
      const department = String(
        data?.routing?.department || data?.category || "일반상담팀"
      );
      const keywords: string[] = Array.isArray(data?.keywords)
        ? data.keywords.filter((item: unknown): item is string => typeof item === "string")
        : [];
      const actionItems: string[] = Array.isArray(data?.action_items)
        ? data.action_items.filter(
            (item: unknown): item is string => typeof item === "string" && !!item.trim()
          )
        : [];
      const headline = String(data?.summary ?? "요약 결과가 없습니다.");
      setAnalysisSource(String(data?.source ?? "unknown"));
      setLiveActionItems(actionItems);
      if (EXPLICIT_LIVE_CALL_ID) {
        setWrapResult("상담 종료 · 결과 확인 필요");
        setFollowups(
          actionItems.map((label) => ({ icon: "task_alt", label }))
        );
      }
      setSummary({
        type: String(data?.category || "일반 상담"),
        headline,
        bullets: actionItems.length
          ? actionItems
          : [data?.routing?.reason].filter((item): item is string => typeof item === "string"),
        emotion: {
          score: emotionScore,
          level: emotionLevel,
          label_ko: EMOTION_LABELS[emotionLevel],
          signals: [],
        },
        incidentRisk: highRisk ? "high" : "watch",
        recommendedAgent: highRisk ? "숙련 상담사 우선" : "일반 상담 가능",
      });
      setConsultationResponse((prev) => {
        const next: ConsultationCardResponse = {
          ...prev,
          transcript: { ...prev.transcript, text },
          consultation_card: {
            ...prev.consultation_card,
            summary: headline,
            business_type: String(data?.category || prev.consultation_card.business_type),
            department,
            routing_reason: String(
              data?.routing?.reason || prev.consultation_card.routing_reason
            ),
            incident_risk: highRisk ? "high" : "low",
            risk_reason: highRisk
              ? String(data?.risk_reason || `위험 신호: ${keywords.join(", ")}`)
              : null,
            routing_confidence:
              typeof data?.routing_confidence === "number"
                ? data.routing_confidence
                : 0.9,
            emotion: emotionAvailable
              ? {
                  status: "completed",
                  score: emotionScore,
                  level: emotionLevel,
                  reason: String(data?.emotion?.reason || "실제 음성 감정 모델 분석"),
                }
              : {
                  status: "unavailable",
                  score: null,
                  level: null,
                  reason: String(
                    data?.emotion?.reason || "실제 음성 감정 모델이 연결되지 않았습니다."
                  ),
                },
          },
        };
        respRef.current = next;
        return next;
      });
      if (data?.category) setWrapType(String(data.category));
      setRegSearch(
        [data?.category, headline, ...actionItems].filter(Boolean).join(" ").slice(0, 500)
      );
      return true;
    } catch {
      if (!isCurrent()) return false;
      if (useLocalLiveAnalysis) {
        setAnalysisSource("unavailable");
        setLiveActionItems(["STT 원문을 확인하고 문의사항을 직접 분류해 주세요."]);
        setConsultationResponse((prev) => {
          const next: ConsultationCardResponse = {
            ...prev,
            transcript: { ...prev.transcript, text },
            consultation_card: {
              ...prev.consultation_card,
              summary: "요약 모델에 연결할 수 없습니다. 근거 발화를 직접 확인해 주세요.",
            },
          };
          respRef.current = next;
          return next;
        });
      }
      return true;
    } finally {
      if (analysisAbortRef.current === controller) analysisAbortRef.current = null;
      if (isCurrent()) setSummaryPending(false);
    }
  }, []);

  const toPrep = useCallback((forceLive = false) => {
    if (silT.current) {
      clearInterval(silT.current);
      silT.current = null;
    }
    if (stt.current) {
      stt.current.stop();
      stt.current = null;
    }
    if (forceLive) {
      // Gate agent_connected until this request reaches success or an explicit
      // fallback card. The PrepCard may render immediately, but it is not ready.
      setAnalysisSource("pending");
      setSummaryPending(true);
    }
    transitionPhase("prep");
    // 최신 준비 카드는 체크박스 없이 유의사항을 한 번에 제시한다.
    // 연결 게이트는 체크 동작 대신 실제 요약 완료 여부로만 제어한다.
    setPrepChecks(PREP_ITEMS.map(() => true));
    void runSummary({ forceLive, scope: "intake" }).then((completed) => {
      if (completed) {
        emitCardPipeline(forceLive ? "backend" : "demo", forceLive ? 250 : 700, {
          persist: !forceLive,
        });
      }
    });
  }, [emitCardPipeline, runSummary, transitionPhase]);

  const armFirst = useCallback(() => {
    silStage.current = "first";
    silEnd.current = Date.now() + s1 * 1000;
  }, [s1]);

  const silTick = useCallback(() => {
    if (!silStage.current) return;
    const now = Date.now();
    const left = Math.max(0, Math.ceil((silEnd.current - now) / 1000));
    setSilenceLeft((prev) => (prev !== left ? left : prev));
    if (now < silEnd.current) return;
    if (silStage.current === "first") {
      silStage.current = "confirmPause";
      silEnd.current = now + 1600;
      transitionPhase("confirm");
    } else if (silStage.current === "confirmPause") {
      silStage.current = "second";
      silEnd.current = now + s2 * 1000;
    } else if (silStage.current === "second") {
      silStage.current = null;
      toPrep();
    }
  }, [s2, toPrep, transitionPhase]);

  const runScript = useCallback(() => {
    transcript.current = [];
    setLiveCaption("");
    setLiveCaptionSpeaker("customer");
    setLiveTranscriptLines([]);
    if (realCallActiveRef.current) {
      const epoch = lifecycleEpoch.current;
      void startLiveCall(LIVE_CALL_ID, {
        onTranscript: (item) => {
          if (lifecycleEpoch.current !== epoch) return;
          transcript.current.push({
            text: item.text,
            at: item.at,
            isFinal: true,
            speaker: item.speaker,
            seq: item.seq,
            generation: item.generation,
            audioSeq: item.audioSeq,
          });
          setLiveCaption(item.text);
          setLiveCaptionSpeaker(item.speaker);
          setLiveTranscriptLines((lines) => [...lines, item].slice(-30));
          demoBus.emit("stt.utterance", {
            callId: LIVE_CALL_ID,
            text: item.text,
            isFinal: true,
            atMs: item.at,
            speaker: item.speaker,
            generation: item.generation,
            audioSeq: item.audioSeq,
          });
        },
        onLevel: (level, speaker) => {
          if (lifecycleEpoch.current !== epoch) return;
          setLevelBySpeaker((current) => ({ ...current, [speaker]: level }));
        },
        onCaptureStatus: (active, _device, speaker) => {
          if (lifecycleEpoch.current !== epoch) return;
          setCaptureBySpeaker((current) => ({ ...current, [speaker]: active }));
        },
        onWarning: (message, status) => {
          if (lifecycleEpoch.current !== epoch) return;
          setMicErr(message);
          // 단순 backlog 알림은 작업이 따라잡은 뒤 화면에 영구히 남기지 않는다.
          // 발화 누락(rejected/drained_incomplete)은 별도 error 이벤트가 유지한다.
          if (status === "backlogged") {
            window.setTimeout(() => {
              if (lifecycleEpoch.current === epoch) {
                setMicErr((current) => (current === message ? "" : current));
              }
            }, 6000);
          }
        },
        onError: (message) => {
          if (lifecycleEpoch.current === epoch) setMicErr(message);
        },
      })
        .then((handle) => {
          if (
            lifecycleEpoch.current !== epoch ||
            !realCallActiveRef.current ||
            ["idle", "summarizing", "wrap"].includes(phaseRef.current)
          ) {
            handle.stop();
            return;
          }
          live.current?.stop();
          live.current = handle;
        })
        .catch(() => {
          if (lifecycleEpoch.current === epoch) {
            setMicErr("로컬 STT 수신 채널을 시작할 수 없습니다.");
          }
        });
      return;
    }

    // Deterministic emotion escalation for the scripted, single-page demo.
    const emos = [1, 1, 2, 3];
    emos.forEach((e, i) => after(lineGap * (i + 1), () => setEmo(e)));
    after(lineGap * (emos.length + 1), () => armFirst());
    // Feed the (mock) transcript so the summariser has real input.
    stt.current = startSttSession(
      {
        onChunk: (c) => {
          const chunk: SpeakerTranscriptChunk = {
            ...c,
            speaker: "customer",
            seq: transcript.current.length + 1,
          };
          transcript.current.push(chunk);
          demoBus.emit("stt.utterance", {
            callId: respRef.current.call_id,
            text: c.text,
            isFinal: c.isFinal,
            atMs: c.at,
            speaker: "customer",
          });
        },
      },
      lineGap
    );
  }, [after, armFirst, lineGap]);

  const beginRecording = useCallback(() => {
    transitionPhase("recording");
    silStage.current = null;
    if (!realCallActiveRef.current) {
      silT.current = window.setInterval(silTick, 200);
    }
    demoBus.emit("pipeline.stage", {
      callId: respRef.current.call_id,
      stage: "utterance",
      status: "done",
    });
    demoBus.emit("pipeline.stage", {
      callId: respRef.current.call_id,
      stage: "stt",
      status: "start",
    });
    runScript(); // mic is simulation-only for this demo
  }, [runScript, silTick, transitionPhase]);

  // ── public actions ──
  const startCall = useCallback(() => {
    lifecycleEpoch.current += 1;
    analysisRequestSeq.current += 1;
    intakeTransitionPending.current = false;
    endTransitionPending.current = false;
    endRequested.current = false;
    resetRequested.current = false;
    inactiveStatePolls.current = 0;
    clearAll();
    transcript.current = [];
    summaryText.current = "";
    // 인입 유형에 맞는 상담카드 픽스처 선택 (데모)
    const kind = incomingRef.current;
    const resp: ConsultationCardResponse =
      kind === "urgent"
        ? (structuredClone(URGENT_RESPONSE) as unknown as ConsultationCardResponse)
        : kind === "transfer"
        ? (structuredClone(TRANSFER_RESPONSE) as unknown as ConsultationCardResponse)
        : getDemoConsultationCard();
    resp.call_id = LIVE_CALL_ID;
    setConsultationResponse(resp);
    // 리렌더 전에 타이머 콜백이 읽을 수 있도록 ref는 즉시 동기화
    respRef.current = resp;
    demoBus.emit("call.incoming", {
      callId: resp.call_id,
      kind,
      ...(callGenerationRef.current > 0
        ? { generation: callGenerationRef.current }
        : {}),
    });
    demoBus.emit("pipeline.stage", {
      callId: resp.call_id,
      stage: "utterance",
      status: "start",
    });
    // 후처리 프리셋도 콜 유형에 맞춰 채운다 — 상담 유형·결과·후속조치가 통화 내용과 어긋나지 않게
    const wrap = WRAP_DEFAULTS[kind];
    setWrapType(EXPLICIT_LIVE_CALL_ID ? "미분류" : wrap.type);
    setWrapResult(EXPLICIT_LIVE_CALL_ID ? "상담 진행 중 · 결과 미입력" : wrap.result);
    setFollowups(EXPLICIT_LIVE_CALL_ID ? [] : wrap.followups);
    setPrepChecks(PREP_ITEMS.map(() => false));
    setSummary(null);
    setVerified(false);
    setAuthMethod("phone");
    setAuthInput("");
    setAuthErr(false);
    setAuthErrMsg("");
    setAuthTime("");
    setAuthMethodLabel("");
    setMemoItems([]);
    setMemoDraft("");
    memoDraftRef.current = "";
    setDockType(null);
    setRegExpanded(false);
    setRegSearch("");
    setRegTargetRow(null);
    setRegDoc(null);
    setRegDocChunk(null);
    setSemHits([]);
    setWrapSheetOpen(false);
    setTypeMenu(false);
    setResultMenu(false);
    setTransferReserved(false);
    setTransferTarget(null);
    setEmoDrift(null);
    transitionPhase("connecting");
    setClock(0);
    setCallStartedAt(fmtCallTimestamp(new Date()));
    setEmo(0);
    setSilenceLeft(0);
    setMicErr("");
    setAudioBusy(false);
    setLiveCaption("");
    setLiveCaptionSpeaker("customer");
    setLiveTranscriptLines([]);
    setCaptureBySpeaker({ customer: false, agent: false });
    setLevelBySpeaker({ customer: 0, agent: 0 });
    setAnalysisSource("demo");
    setLiveActionItems([]);
    setSummaryPending(false);
    setSummaryVersion(0);
    setRegenerating(false);
    setArsDigits("");
    setDtmfEvents([]);
    setMobileIntakeComplete(false);
    setMobileIntakePending(false);
    setMobileAgentConnected(false);
    startClock();
    if (realCallActiveRef.current) beginRecording();
    else after(3000, () => beginRecording());
  }, [after, beginRecording, clearAll, startClock, transitionPhase]);

  const pickIncoming = useCallback((k: IncomingKind) => {
    if (phaseRef.current === "idle") setIncoming(k);
  }, []);

  const skipWait = useCallback(() => {
    if (phaseRef.current === "recording" || phaseRef.current === "confirm") {
      silStage.current = null;
      timers.current.forEach(clearTimeout);
      timers.current = [];
      toPrep();
    }
  }, [toPrep]);

  const answerCall = useCallback(() => {
    const summaryReady =
      !realCallActiveRef.current || (!summaryPending && analysisSource !== "pending");
    if (prepChecks.every(Boolean) && summaryReady) {
      if (realCallActiveRef.current) {
        // The server ACK is the single gate for both the active screen and the
        // counselor edge microphone. Keep PrepCard visible until that ACK.
        arsControlRef.current?.agentConnected();
        return;
      }
      transitionPhase("active");
      // 통화 연결과 동시에 우측 규정 추천이 뜬다 — RAG 스테이지도 같은 시점에 점등
      demoBus.emit("pipeline.stage", {
        callId: respRef.current.call_id,
        stage: "rag",
        status: "start",
      });
      after(1200, () =>
        demoBus.emit("pipeline.stage", {
          callId: respRef.current.call_id,
          stage: "rag",
          status: "done",
          detail: "규정 2건 추천",
        })
      );
      // 상담이 진행되며 고객이 진정되는 흐름 — 감정온도가 살아있는 신호임을 보여준다
      after(20000, () =>
        setEmoDrift({ score: 22, level: "stable", reason: "상담 진행 후 안정 — 응대 톤 유지" })
      );
    }
  }, [after, analysisSource, prepChecks, summaryPending, transitionPhase]);

  const reset = useCallback(() => {
    lifecycleEpoch.current += 1;
    analysisRequestSeq.current += 1;
    intakeTransitionPending.current = false;
    endTransitionPending.current = false;
    endRequested.current = false;
    resetRequested.current = false;
    inactiveStatePolls.current = 0;
    clearAll();
    transcript.current = [];
    summaryText.current = "";
    demoBus.emit("demo.reset", {});
    transitionPhase("idle");
    setClock(0);
    setCallStartedAt("");
    setEmo(0);
    setSilenceLeft(0);
    setMicErr("");
    setAudioBusy(false);
    setLiveCaption("");
    setLiveCaptionSpeaker("customer");
    setLiveTranscriptLines([]);
    setCaptureBySpeaker({ customer: false, agent: false });
    setLevelBySpeaker({ customer: 0, agent: 0 });
    setAnalysisSource("demo");
    setLiveActionItems([]);
    setSummaryPending(false);
    setSummary(null);
    const demo = getDemoConsultationCard();
    demo.call_id = LIVE_CALL_ID;
    setConsultationResponse(demo);
    respRef.current = demo;
    setPrepChecks(PREP_ITEMS.map(() => false));
    setVerified(false);
    setAuthMethod("phone");
    setAuthInput("");
    setAuthErr(false);
    setAuthErrMsg("");
    setAuthTime("");
    setAuthMethodLabel("");
    setMemoItems([]);
    setMemoDraft("");
    setDockType(null);
    setRegExpanded(false);
    setRegSearch("");
    setRegTargetRow(null);
    setRegDoc(null);
    setRegDocChunk(null);
    setSemHits([]);
    setWrapSheetOpen(false);
    setWrapType(WRAP_DEFAULTS.normal.type);
    setWrapResult(WRAP_DEFAULTS.normal.result);
    setFollowups(WRAP_DEFAULTS.normal.followups);
    setTransferReserved(false);
    setTransferTarget(null);
    setEmoDrift(null);
    setSummaryVersion(0);
    setRegenerating(false);
    setIncoming("normal");
    setArsDigits("");
    setDtmfEvents([]);
    setMobileIntakeComplete(false);
    setMobileIntakePending(false);
    setMobileAgentConnected(false);
    realCallActiveRef.current = false;
    callGenerationRef.current = 0;
  }, [clearAll, transitionPhase]);

  const enterActiveFromAck = useCallback(() => {
    if (!realCallActiveRef.current || phaseRef.current === "active") return;
    if (phaseRef.current !== "prep") return;
    transitionPhase("active");
    setMicErr((current) =>
      current === "마지막 STT 처리 제한시간을 초과했습니다. 끝 발화를 확인해 주세요."
        ? ""
        : current
    );
    setMobileAgentConnected(true);
    setMobileIntakePending(false);
    demoBus.emit("pipeline.stage", {
      callId: LIVE_CALL_ID,
      stage: "rag",
      status: "start",
    });
    after(1200, () =>
      demoBus.emit("pipeline.stage", {
        callId: LIVE_CALL_ID,
        stage: "rag",
        status: "done",
        detail: "상담원 채널 연결 · 규정 추천 활성화",
      })
    );
  }, [after, transitionPhase]);

  const finishIntakeAfterDrain = useCallback(
    (event: ArsLifecycleEvent, resumeAgent = false) => {
      if (intakeTransitionPending.current) return;
      intakeTransitionPending.current = true;
      const epoch = lifecycleEpoch.current;
      void (async () => {
        try {
          const receivedFinalSeq = await waitForFinalTranscript(event.finalSeq, epoch);
          if (lifecycleEpoch.current !== epoch) return;
          if (!event.drained || !receivedFinalSeq) {
            setMicErr("마지막 STT 처리 제한시간을 초과했습니다. 끝 발화를 확인해 주세요.");
          } else {
            setMicErr((current) =>
              current === "마지막 STT 처리 제한시간을 초과했습니다. 끝 발화를 확인해 주세요."
                ? ""
                : current
            );
          }
          setMobileIntakePending(false);
          setMobileIntakeComplete(true);
          if (["connecting", "recording", "confirm"].includes(phaseRef.current)) {
            timers.current.forEach(clearTimeout);
            timers.current = [];
            if (isCustomerSurface) {
              transitionPhase("prep");
              demoBus.emit("pipeline.stage", {
                callId: LIVE_CALL_ID,
                stage: "classify",
                status: "start",
              });
            } else {
              toPrep(true);
            }
          }
          if (resumeAgent && phaseRef.current === "prep") enterActiveFromAck();
        } finally {
          if (lifecycleEpoch.current === epoch) {
            intakeTransitionPending.current = false;
          }
        }
      })();
    },
    [enterActiveFromAck, isCustomerSurface, toPrep, transitionPhase, waitForFinalTranscript]
  );

  const finishCallAfterDrain = useCallback(
    (event: ArsLifecycleEvent, wasLiveCall: boolean) => {
      if (endTransitionPending.current) return;
      endTransitionPending.current = true;
      const epoch = lifecycleEpoch.current;
      void (async () => {
        try {
          const receivedFinalSeq = await waitForFinalTranscript(event.finalSeq, epoch);
          if (lifecycleEpoch.current !== epoch) return;
          if (!event.drained || !receivedFinalSeq) {
            setMicErr("마지막 STT 처리 제한시간을 초과했습니다. 끝 발화를 확인해 주세요.");
          }
          if (resetRequested.current) {
            resetRequested.current = false;
            realCallActiveRef.current = false;
            reset();
            return;
          }

          const currentPhase = phaseRef.current;
          const generation = callGenerationRef.current || event.generation;
          if (isCustomerSurface) {
            clearAll();
            realCallActiveRef.current = false;
            // Keep an explicit ended screen until the customer starts another
            // call or resets. There is no arbitrary auto-dismiss timer.
            transitionPhase("wrap");
            setClock(0);
            setMobileIntakePending(false);
            setMobileIntakeComplete(false);
            setMobileAgentConnected(false);
            demoBus.emit("call.ended", {
              callId: LIVE_CALL_ID,
              ...(generation ? { generation } : {}),
              endReason: event.endReason,
              endedBy: event.endedBy,
            });
            return;
          }

          const endedBeforeAgent = ["connecting", "recording", "confirm", "prep"].includes(
            currentPhase
          );
          const hasTranscript = transcript.current.some(
            (chunk) => chunk.isFinal && chunk.text.trim().length > 0
          );
          const customerEnded =
            event.endedBy === "customer" ||
            event.endReason === "customer_hangup" ||
            event.endReason === "customer_disconnect" ||
            (!event.endedBy && !event.endReason && !endRequested.current);
          if (endedBeforeAgent && !hasTranscript) {
            // A LAN counselor event must close the admin record explicitly;
            // counselor demo.reset is intentionally not relay-authorized.
            demoBus.emit("call.ended", {
              callId: LIVE_CALL_ID,
              ...(generation ? { generation } : {}),
              endReason: event.endReason ?? "ended_before_transcript",
              endedBy: event.endedBy,
            });
            realCallActiveRef.current = false;
            reset();
            return;
          }
          if (currentPhase === "active" || (endedBeforeAgent && hasTranscript)) {
            clearAll();
            if (endedBeforeAgent) {
              setWrapResult(customerEnded ? "상담 중단 · 고객 종료" : "추가 확인 필요");
              setFollowups([]);
            }
            realCallActiveRef.current = false;
            transitionPhase("summarizing");
            setWrapSheetOpen(true);
            demoBus.emit("pipeline.stage", {
              callId: LIVE_CALL_ID,
              stage: "wrap",
              status: "start",
            });
            const completed = await runSummary({ forceLive: wasLiveCall, scope: "full" });
            if (
              lifecycleEpoch.current === epoch &&
              completed &&
              phaseRef.current === "summarizing"
            ) {
              transitionPhase("wrap");
              demoBus.emit("pipeline.stage", {
                callId: LIVE_CALL_ID,
                stage: "wrap",
                status: "done",
                detail: "고객·상담원 전체 대화 후처리 초안",
              });
              demoBus.emit("call.ended", {
                callId: LIVE_CALL_ID,
                wrapType: wrapRef.current.type,
                wrapResult: wrapRef.current.result,
                ...(generation ? { generation } : {}),
                endReason: event.endReason,
                endedBy: event.endedBy,
              });
              if (transferRef.current.reserved) {
                demoBus.emit("transfer.completed", {
                  callId: LIVE_CALL_ID,
                  toDept:
                    transferRef.current.target ?? SUGGESTED_DEPT[incomingRef.current],
                });
              }
            }
            return;
          }
          realCallActiveRef.current = false;
          if (!shouldIgnoreArsCallEnd(currentPhase)) reset();
        } finally {
          if (lifecycleEpoch.current === epoch) {
            endRequested.current = false;
            endTransitionPending.current = false;
          }
        }
      })();
    },
    [
      clearAll,
      isCustomerSurface,
      reset,
      runSummary,
      transitionPhase,
      waitForFinalTranscript,
    ]
  );

  const beginRealCall = useCallback(
    (generation?: number) => {
      inactiveStatePolls.current = 0;
      const startsFresh =
        !realCallActiveRef.current || shouldStartFreshArsCall(phaseRef.current);
      realCallActiveRef.current = true;
      if (generation && generation > 0) callGenerationRef.current = generation;
      if (startsFresh) startCall();
    },
    [startCall]
  );

  const requestReset = useCallback(() => {
    if (realCallActiveRef.current) {
      resetRequested.current = true;
      if (!endRequested.current) {
        endRequested.current = true;
        if (isCustomerSurface) mobileArsRef.current?.endCall();
        else arsControlRef.current?.endCall();
      }
      return;
    }
    reset();
  }, [isCustomerSurface, reset]);

  const requestCustomerStart = useCallback(() => {
    if (!EXPLICIT_LIVE_CALL_ID) {
      setMicErr("중앙 서버가 발급한 call_id가 필요합니다. 시작 스크립트에 표시된 고객 URL을 열어 주세요.");
      return;
    }
    if (!mobileServerConnected) {
      setMicErr("통화 서버 연결 중입니다. 연결 표시 후 다시 눌러 주세요.");
      return;
    }
    setMicErr("");
    mobileArsRef.current?.startCall();
  }, [mobileServerConnected]);

  const requestCustomerEnd = useCallback(() => {
    if (!realCallActiveRef.current || endRequested.current) return;
    endRequested.current = true;
    mobileArsRef.current?.endCall();
  }, []);

  const pressCustomerDigit = useCallback(
    (digit: string) => {
      const sent = mobileArsRef.current?.pressDigit(digit) ?? false;
      if (!sent) {
        setMicErr("키패드 전송 채널이 준비되지 않았습니다. 연결 상태를 확인해 주세요.");
        return false;
      }
      setMicErr("");
      if (digit === "#" && !mobileIntakeComplete && !mobileAgentConnected) {
        setMobileIntakePending(true);
      }
      return true;
    },
    [mobileAgentConnected, mobileIntakeComplete]
  );

  useEffect(() => {
    if (isCustomerSurface) return;
    if (!EXPLICIT_LIVE_CALL_ID) {
      if (surface === "desktop") {
        setMicErr("중앙 서버가 발급한 call_id가 필요합니다. 시작 스크립트에 표시된 상담사 URL을 열어 주세요.");
      }
      return;
    }
    const control = startArsControl(LIVE_CALL_ID, {
      onCallStart: (event) => beginRealCall(event.generation),
      onDigit: (event) => {
        setArsDigits((value) => (value + event.digit).slice(-24));
        setDtmfEvents((events) => [...events.slice(-63), event]);
        if (!event.persisted) {
          setMicErr("키패드 입력은 전달됐지만 서버 저장에 실패했습니다.");
        }
      },
      onDigits: setArsDigits,
      onIntakeComplete: (event) => finishIntakeAfterDrain(event),
      onAgentConnected: enterActiveFromAck,
      onCallEnd: (event) => {
        inactiveStatePolls.current = 0;
        if (shouldIgnoreArsCallEnd(phaseRef.current)) {
          realCallActiveRef.current = false;
          endRequested.current = false;
          return;
        }
        finishCallAfterDrain(event, true);
      },
      onState: (state: ArsStateSnapshot) => {
        setArsDigits(state.digits);
        const reconciliation = reconcileArsInactiveSnapshot(state, {
          localActive: realCallActiveRef.current,
          inactivePolls: inactiveStatePolls.current,
        });
        inactiveStatePolls.current = reconciliation.inactivePolls;
        if (!state.active) {
          if (reconciliation.finalize) finishCallAfterDrain(state, true);
          return;
        }
        beginRealCall(state.generation);
        if (state.intakeComplete && state.drained) {
          finishIntakeAfterDrain(state, state.agentConnected);
        } else if (state.agentConnected) {
          enterActiveFromAck();
        }
      },
      onMobileStatus: setArsMobileConnected,
      onError: (message) => {
        if (realCallActiveRef.current) setMicErr(message);
      },
    });
    arsControlRef.current = control;
    return () => {
      if (arsControlRef.current === control) arsControlRef.current = null;
      control.stop();
    };
  }, [
    beginRealCall,
    enterActiveFromAck,
    finishCallAfterDrain,
    finishIntakeAfterDrain,
    isCustomerSurface,
    surface,
  ]);

  useEffect(() => {
    if (!isCustomerSurface) return;
    if (!EXPLICIT_LIVE_CALL_ID) {
      setMicErr("중앙 서버가 발급한 call_id가 필요합니다. 시작 스크립트에 표시된 고객 URL을 열어 주세요.");
      return;
    }
    const control = startMobileArsControl(LIVE_CALL_ID, {
      onConnection: (connected) => {
        setMobileServerConnected(connected);
        setArsMobileConnected(connected);
        if (connected) {
          // A transient WebSocket error can fire immediately before the retry
          // succeeds.  Do not leave a stale red warning beside the authoritative
          // green "connected" indicator on the Galaxy surface.
          setMicErr((message) =>
            message === "통화 서버에 연결할 수 없습니다." ||
            message === "통화 서버 연결 중입니다. 연결 표시 후 다시 눌러 주세요."
              ? ""
              : message
          );
        }
      },
      onCallStart: (event) => beginRealCall(event.generation),
      onIntakeComplete: (event) => {
        setMobileIntakePending(false);
        setMobileIntakeComplete(true);
        finishIntakeAfterDrain(event);
      },
      onAgentConnected: () => {
        setMobileIntakePending(false);
        setMobileIntakeComplete(true);
        setMobileAgentConnected(true);
        enterActiveFromAck();
      },
      onCallEnd: (event) => finishCallAfterDrain(event, true),
      onState: (state) => {
        setArsDigits(state.digits);
        setMobileIntakeComplete(state.intakeComplete);
        setMobileAgentConnected(state.agentConnected);
        const reconciliation = reconcileArsInactiveSnapshot(state, {
          localActive: realCallActiveRef.current,
          inactivePolls: inactiveStatePolls.current,
        });
        inactiveStatePolls.current = reconciliation.inactivePolls;
        if (!state.active) {
          if (reconciliation.finalize) finishCallAfterDrain(state, true);
          return;
        }
        beginRealCall(state.generation);
        if (state.intakeComplete && state.drained) {
          finishIntakeAfterDrain(state, state.agentConnected);
        } else if (state.agentConnected) {
          enterActiveFromAck();
        }
      },
      onError: setMicErr,
    });
    mobileArsRef.current = control;
    return () => {
      if (mobileArsRef.current === control) mobileArsRef.current = null;
      // Refresh/navigation is an unexpected disconnect, not an explicit hangup.
      // The server keeps its recovery grace; only the red end/reset actions send call_end.
      control.stop();
    };
  }, [
    beginRealCall,
    enterActiveFromAck,
    finishCallAfterDrain,
    finishIntakeAfterDrain,
    isCustomerSurface,
  ]);

  // 시연 내비게이션 — 상단 알약의 단계(접수·준비·통화·후처리)를 누르면 그 화면으로 바로 점프.
  // 접수는 실제 흐름(전화 연결)을 타고, 준비/통화/후처리는 콜 유형 픽스처로 상태를 정합하게 세팅한다.
  const jumpToStep = useCallback(
    (n: number) => {
      if (n <= 0) {
        reset();
        return;
      }
      if (n === 1) {
        reset();
        startCall();
        return;
      }
      clearAll();
      const kind = incomingRef.current;
      const resp =
        kind === "urgent"
          ? (structuredClone(URGENT_RESPONSE) as unknown as ConsultationCardResponse)
          : kind === "transfer"
          ? (structuredClone(TRANSFER_RESPONSE) as unknown as ConsultationCardResponse)
          : getDemoConsultationCard();
      setConsultationResponse(resp);
      respRef.current = resp;
      const wrap = WRAP_DEFAULTS[kind];
      setWrapType(wrap.type);
      setWrapResult(wrap.result);
      setFollowups(wrap.followups);
      setTransferReserved(false);
      setEmoDrift(null);
      setMicErr("");
      setEmo(0);
      setSilenceLeft(0);
      setVerified(false);
      setAuthInput("");
      startClock();
      if (n === 2) {
        setPrepChecks(PREP_ITEMS.map(() => true));
        setWrapSheetOpen(false);
        setPhase("prep");
      } else if (n === 3) {
        setPrepChecks(PREP_ITEMS.map(() => true)); // 유의사항 확인을 거친 상태로 진입
        setWrapSheetOpen(false);
        setPhase("active");
      } else {
        setPrepChecks(PREP_ITEMS.map(() => true));
        setWrapSheetOpen(true);
        setPhase("wrap");
      }
    },
    [clearAll, reset, startCall, startClock]
  );

  const endCall = useCallback(() => {
    if (realCallActiveRef.current) {
      if (endRequested.current) return;
      endRequested.current = true;
      if (isCustomerSurface) mobileArsRef.current?.endCall();
      else arsControlRef.current?.endCall();
      return;
    }
    if (phaseRef.current !== "active") {
      reset();
      return;
    }
    finishCallAfterDrain({ finalSeq: 0, drained: true }, false);
  }, [finishCallAfterDrain, isCustomerSurface, reset]);

  const setSim = useCallback(() => {
    if (phaseRef.current === "idle") {
      setMode("sim");
      setMicErr("");
    }
  }, []);
  const setMic = useCallback(() => {
    if (phaseRef.current === "idle") {
      setMode("mic");
      setMicErr("");
    }
  }, []);

  const submitAudio = useCallback(
    async (file: File) => {
      const epoch = ++lifecycleEpoch.current;
      analysisRequestSeq.current += 1;
      clearAll();
      transcript.current = [];
      setLiveCaption("");
      setLiveCaptionSpeaker("customer");
      setLiveTranscriptLines([]);
      setMode("mic");
      transitionPhase("recording");
      setClock(0);
      setEmo(0);
      setMicErr("");
      setAudioBusy(true);
      startClock();
      try {
        const response = await createConsultationFromAudio(file);
        if (lifecycleEpoch.current !== epoch) return;
        setConsultationResponse(response);
        respRef.current = response;
        transcript.current = [
          {
            text: response.transcript.text,
            at: 0,
            isFinal: true,
            speaker: "customer",
            seq: 1,
          },
        ];
        // 실백엔드 경로 — 같은 이벤트 열을 압축 발행 (source: backend)
        demoBus.emit("call.incoming", { callId: response.call_id, kind: "normal" });
        demoBus.emit("pipeline.stage", {
          callId: response.call_id,
          stage: "utterance",
          status: "done",
        });
        demoBus.emit("stt.utterance", {
          callId: response.call_id,
          text: response.transcript.text,
          isFinal: true,
          atMs: 0,
          speaker: "customer",
        });
        setSummary(null);
        setPrepChecks(PREP_ITEMS.map(() => true));
        transitionPhase("prep");
        emitCardPipeline("backend", 250);
      } catch (error) {
        const message = error instanceof Error ? error.message : "음성 처리에 실패했습니다.";
        if (lifecycleEpoch.current !== epoch) return;
        setMicErr(message);
        transitionPhase("idle");
      } finally {
        if (lifecycleEpoch.current === epoch) setAudioBusy(false);
      }
    },
    [clearAll, emitCardPipeline, startClock, transitionPhase]
  );

  // ── auth ──
  const pickAuth = useCallback((m: AuthMethod) => {
    setAuthMethod(m);
    // 방식이 바뀌면 이전 입력은 무의미 — 비운다 (잘라서 남기면 오입력 오류처럼 보인다)
    setAuthInput("");
    setAuthErr(false);
  }, []);
  const onAuthInput = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      // 숫자만, 방식별 자릿수까지만 — 4자리 칸에는 4자리만 들어간다
      const max = authMethod === "birth" ? 6 : 4;
      setAuthInput(e.target.value.replace(/\D/g, "").slice(0, max));
      setAuthErr(false);
    },
    [authMethod]
  );
  const runVerify = useCallback(() => {
    const need = authMethod === "birth" ? 6 : 4;
    const digits = (authInput || "").replace(/\D/g, "");
    if (digits.length < need) {
      setAuthErrMsg(`자릿수가 부족합니다 — ${need}자리를 입력하세요`);
      setAuthErr(true);
      return;
    }
    // 고객 진술값과 대조 — 불일치는 인증 실패 (은행 툴의 핵심 경로)
    if (digits.slice(-need) !== CUSTOMER.authAnswers[authMethod]) {
      setAuthErrMsg("고객 진술과 불일치 — 값을 다시 확인하거나 다른 대조 방식을 사용하세요");
      setAuthErr(true);
      return;
    }
    {
      const now = new Date();
      const t =
        ("0" + now.getHours()).slice(-2) + ":" + ("0" + now.getMinutes()).slice(-2);
      const lbl =
        authMethod === "phone"
          ? "연락처 뒷 4자리 대조"
          : authMethod === "birth"
          ? "생년월일 대조"
          : "계좌 뒷 4자리 대조";
      setVerified(true);
      setAuthTime(t);
      setAuthMethodLabel(lbl);
      setAuthErr(false);
    }
  }, [authInput, authMethod]);
  const resetAuth = useCallback(() => {
    setVerified(false);
    setAuthInput("");
    setAuthErr(false);
  }, []);

  // ── memo ──
  const addMemo = useCallback(() => {
    const t = memoDraftRef.current.trim();
    if (!t) return;
    setMemoItems((items) => items.concat(t));
    setMemoDraft("");
  }, []);
  const onMemoKey = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Enter") {
        e.preventDefault();
        addMemo();
      }
    },
    [addMemo]
  );
  // 기록된 불릿의 수정·삭제 — 당연한 기능: 오타 메모를 지우거나 고칠 수 있어야 한다
  const updateMemo = useCallback((i: number, text: string) => {
    const t = text.trim();
    if (!t) return;
    setMemoItems((items) => items.map((m, x) => (x === i ? t : m)));
  }, []);
  const removeMemo = useCallback((i: number) => {
    setMemoItems((items) => items.filter((_, x) => x !== i));
  }, []);

  // ── followups ──
  const removeFollowup = useCallback((i: number) => {
    setFollowups((f) => f.filter((_, x) => x !== i));
  }, []);
  const addFollowup = useCallback((f: Followup) => {
    setFollowups((cur) => (cur.some((x) => x.label === f.label) ? cur : cur.concat(f)));
  }, []);

  // ── viewport fit (스테이지를 컨테이너에 맞춰 스케일) ──
  // 기본은 1420px 합본 스테이지의 축소 전용. stageW/maxScale을 주면(고객 화면 등)
  // 좁은 스테이지를 확대해 화면을 채운다 — 세로는 뷰포트 높이로 캡(offsetHeight는 스케일 무관 원치수).
  const stageW = config.stageW ?? STAGE_W;
  const maxScale = config.maxScale ?? 1;
  // fitPad = 좌우 여백(px), fitHeight=false 면 세로 캡 없이 가로를 100% 채운다(직원 단독 화면)
  const fitPad = config.fitPad ?? 40;
  const fitHeight = config.fitHeight ?? true;
  const fit = useCallback(() => {
    const w = rootRef.current ? rootRef.current.clientWidth : window.innerWidth;
    const avail = Math.max(320, w - fitPad);
    const h = stageRef.current ? stageRef.current.offsetHeight : 0;
    const scH = fitHeight && h > 0 ? Math.max(0.4, (window.innerHeight - 40) / h) : maxScale;
    const sc = Math.min(maxScale, avail / stageW, scH);
    setScale((prev) => (prev !== sc ? sc : prev));
    setNatH((prev) => (prev !== h ? h : prev));
  }, [stageW, maxScale, fitPad, fitHeight]);

  useEffect(() => {
    const onResize = () => fit();
    window.addEventListener("resize", onResize);
    const raf = requestAnimationFrame(fit);
    return () => {
      window.removeEventListener("resize", onResize);
      cancelAnimationFrame(raf);
    };
  }, [fit]);

  // re-measure after any layout-affecting change
  useLayoutEffect(() => {
    fit();
  }, [fit, phase, verified, regExpanded, memoItems, followups, wrapSheetOpen, micErr, guideOpen]);

  useEffect(() => () => clearAll(), [clearAll]);

  // ── derived view model ──
  const p = phase;
  const inCall = ["connecting", "recording", "confirm", "prep", "active"].includes(p);
  const ended = p === "wrap" || p === "summarizing";
  // 데모 안내: 현재 phase → 가이드 화면 키
  const guideKey: GuideKey =
    p === "idle"
      ? "idle"
      : ["connecting", "recording", "confirm"].includes(p)
      ? "intake"
      : p === "prep"
      ? "prep"
      : p === "active"
      ? "active"
      : "wrap";
  // 새 단계에 도달하면 그 단계 안내를 자동 팝업으로 (화면별 소개 멘트).
  // 화면을 잠깐 본 뒤(700ms) 뜬다 — "화면 먼저, 설명은 이어서". 대기(idle)는 로드 후 1회.
  // (스테퍼 번호 클릭 = openGuideStep = 지연 없이 즉시)
  useEffect(() => {
    setGuideStep(guideKey);
    const t = window.setTimeout(() => setGuideOpen(true), 700);
    return () => window.clearTimeout(t);
  }, [guideKey]);
  const sim = mode === "sim";
  const nv = !verified;

  const dk = renderSheet(SHEETS[dockType ?? "history"]);
  const rg = renderSheet(manualData ?? SHEETS.manual);
  // 검색 필터 — r.n(원본 행 번호)은 유지되므로 '열기' 강조(regTargetRow)와 충돌하지 않는다
  const regNeedle = regSearch.trim().toLowerCase();
  const rgRows = regNeedle
    ? rg.rows.filter((r) => r.cells.some((c) => c.text.toLowerCase().includes(regNeedle)))
    : rg.rows;

  // 의미 검색(2단째) — 로컬 필터는 위에서 0ms 즉시, 시맨틱은 250ms 디바운스 후 백엔드
  // pgvector 하이브리드 검색. "잘못 송금했어요"→"착오송금 반환" 같은 의미 매칭을 더한다.
  // 카드의 전달부서가 있으면 그 부서(category)의 규정만 좁혀 검색 — 카드 라우터와 한 몸.
  // 연타 시 이전 요청은 abort. 백엔드/인덱스가 없으면 조용히 빈 결과(로컬 필터는 계속).
  useEffect(() => {
    if (!semanticSearchEnabled || !regSearch.trim()) {
      setSemHits([]);
      setSemLoading(false);
      return;
    }
    const ctrl = new AbortController();
    setSemLoading(true);
    const t = window.setTimeout(async () => {
      try {
        const res = await searchRegulations(regSearch, {
          category: categoryForDepartment(
            consultationResponse.consultation_card.department
          ),
          k: 10,
          signal: ctrl.signal,
        });
        setSemHits(res.available ? res.documents : []);
        setSemLoading(false);
      } catch (err) {
        if (!(err instanceof DOMException && err.name === "AbortError")) {
          setSemHits([]);
          setSemLoading(false);
        }
      }
    }, 250);
    return () => {
      ctrl.abort();
      window.clearTimeout(t);
    };
  }, [regSearch, consultationResponse]);

  // CSV/XLSX 버퍼 → SheetData (첫 시트, 첫 행 = 헤더). 업로드·레포 파일 공용 파서
  const parseSheetBuffer = useCallback(async (buf: ArrayBuffer, filename: string): Promise<SheetData | null> => {
    const XLSX = await import("xlsx");
    const wb = XLSX.read(buf);
    const sheetName = wb.SheetNames[0];
    const aoa = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], {
      header: 1,
      defval: "",
    }) as unknown as (string | number)[][];
    const filled = aoa
      .map((r) => r.map((c) => String(c ?? "").trim()))
      .filter((r) => r.some((c) => c));
    if (filled.length < 2) return null; // 헤더+본문이 없으면 무시
    const [head, ...rows] = filled;
    const widths = [64, 130, 300, 300];
    return {
      title: filename.replace(/\.(xlsx|xls|csv)$/i, ""),
      file: filename,
      sheet: sheetName,
      cols: head.map((l, i) => ({ l, w: widths[i] ?? 200 })),
      rows: rows.map((r) => head.map((_, i) => r[i] ?? "")),
    };
  }, []);

  // 실제 CSV/XLSX 파일을 읽어 규정 시트를 교체 (수동 업로드)
  const loadManualFile = useCallback(
    async (file: File) => {
      const data = await parseSheetBuffer(await file.arrayBuffer(), file.name);
      if (!data) return;
      setManualData(data);
      setRegTargetRow(null);
      setRegSearch("");
    },
    [parseSheetBuffer]
  );

  // 레포에 실파일을 커밋하면 더미를 자동 대체 — public/manual.xlsx 또는 public/manual.csv
  // (없으면 조용히 더미 유지. content-type 방어: SPA 폴백이 index.html을 줄 때 오파싱 방지)
  useEffect(() => {
    let alive = true;
    (async () => {
      for (const path of ["/manual.xlsx", "/manual.csv"]) {
        try {
          const res = await fetch(path);
          if (!res.ok) continue;
          const ct = res.headers.get("content-type") || "";
          if (ct.includes("text/html")) continue;
          const data = await parseSheetBuffer(await res.arrayBuffer(), path.slice(1));
          if (data && alive) setManualData(data);
          break;
        } catch {
          /* 더미 유지 */
        }
      }
    })();
    return () => {
      alive = false;
    };
  }, [parseSheetBuffer]);

  const mColors = (active: boolean) => ({
    bg: active ? "var(--blue-700)" : "var(--onair-surface)",
    fg: active ? "#fff" : "var(--gray-800)",
    bd: active ? "var(--blue-700)" : "var(--gray-300)",
  });
  const mP = mColors(authMethod === "phone");
  const mB = mColors(authMethod === "birth");
  const mA = mColors(authMethod === "account");

  const allChecked = prepChecks.every(Boolean);
  const liveSummaryReady =
    !realCallActiveRef.current || (!summaryPending && analysisSource !== "pending");
  const canConnect = allChecked && liveSummaryReady;
  const micActive = captureBySpeaker.customer || captureBySpeaker.agent;
  const micLevel = Math.max(levelBySpeaker.customer, levelBySpeaker.agent);
  const card = consultationResponse.consultation_card;
  const explicitSummaryPending = Boolean(EXPLICIT_LIVE_CALL_ID && summaryPending);
  const capturedTranscript = liveTranscriptLines
    .filter((line) => line.speaker === "customer" && line.text.trim())
    .map((line) => line.text.trim())
    .join(" ")
    .trim();
  // 분석 요청이 진행 중이어도 이전 데모 fixture를 근거 발화로 잠깐 노출하지 않는다.
  // 현재 콜에서 실제로 수신한 문장이 있으면 그것이 언제나 표시의 기준이다.
  const groundedTranscript = capturedTranscript || consultationResponse.transcript.text.trim();
  // 통화 중 드리프트가 있으면 실시간 값이 카드 초기값을 덮는다
  // 통화 중 드리프트한 감정온도는 종료 후(후처리)에도 유지 — 마지막 실측이 초기 카드값으로 되돌아가지 않게
  const temperature = explicitSummaryPending
    ? {
        status: "unavailable" as const,
        score: null,
        level: null,
        reason: "실제 음성 감정 모델 상태를 확인하고 있습니다.",
      }
    : (p === "active" || ended) && emoDrift
      ? { status: "completed" as const, score: emoDrift.score, level: emoDrift.level, reason: emoDrift.reason }
      : card.emotion;
  const inquiryLabel = explicitSummaryPending
    ? "상담 유형 분석 중"
    : card.business_type || summary?.type || "상담 유형 분석 중";
  // 요약 문장은 헤드라인 한 곳에만 — 불릿에는 근거만 남겨 중복을 없앤다.
  const contractBullets = [card.routing_reason, card.risk_reason].filter(
    (value): value is string => !!value
  );
  const prepSummaryBullets = (contractBullets.length
    ? contractBullets
    : summary?.bullets ?? ["고객 발화를 분석하고 있습니다."]
  ).slice(0, 4);
  const prepDefinitions = PREP_ITEMS;
  const emotionBars = temperature.score == null
    ? 0
    : temperature.score > 66
      ? 3
      : temperature.score > 33
        ? 2
        : 1;
  const riskSignals = [card.risk_reason].filter((value): value is string => !!value);
  const firstLine = EXPLICIT_LIVE_CALL_ID
    ? explicitSummaryPending || groundedTranscript.length === 0
      ? "안녕하세요. 문의하실 내용을 다시 한 번 말씀해 주시겠어요?"
      : card.business_type
      ? `안녕하세요. ${card.business_type} 문의로 확인했습니다. 본인확인 후 자세히 도와드리겠습니다.`
      : "안녕하세요. 말씀해 주신 문의 내용을 확인했습니다. 본인확인 후 자세히 도와드리겠습니다."
    : SCRIPTS[incoming][0].text;
  const liveSteps = [
    { title: "1. 오프닝 · 문의 재확인", text: firstLine },
    {
      title: "2. 본인확인",
      text: "고객 동의를 확인한 뒤 등록 정보와 고객이 말한 값을 대조합니다. 인증 전에는 상세 정보를 열람하지 않습니다.",
    },
    {
      title: "3. 문의 내용 검증",
      text: groundedTranscript
        ? `다음 내용을 고객에게 다시 확인합니다: “${
            explicitSummaryPending ? groundedTranscript : card.summary || groundedTranscript
          }”`
        : "사전 발화가 없어 문의 내용을 다시 듣고 업무 유형과 요청사항을 확인합니다.",
    },
    {
      title: "4. 근거 확인 · 마무리",
      text: "관련 규정과 처리 가능 여부를 확인한 뒤 안내하고, 필요한 추가 절차와 후속 연락 여부를 고객과 재확인합니다.",
    },
  ];

  return {
    // refs
    rootRef,
    stageRef,
    // scaling
    scaleT: "scale(" + scale + ")",
    scaledW: stageW * scale + "px",
    stageWpx: stageW + "px",
    scaledH: natH ? natH * scale + "px" : "auto",
    // header
    phaseLabel: LABELS[p] || p,
    // 데모 안내(가이드 모드)
    guideOpen,
    closeGuide: () => setGuideOpen(false),
    guide: GUIDE[guideStep],
    guideStep,
    guideIndex: GUIDE_ORDER.indexOf(guideStep),
    // 스테퍼 인디케이터용 — 순서대로 {key,label}
    guideSteps: GUIDE_ORDER.map((k) => ({ key: k, label: GUIDE[k].step })),
    // 스테퍼 번호/인디케이터 클릭 → 그 단계 안내로 전환하며 팝업 (도달 전 단계도 미리보기 가능)
    openGuideStep: (k: string) => {
      setGuideStep(k as GuideKey);
      setGuideOpen(true);
    },
    // 가이드 투어 이전/다음 — 데모는 안 움직이고 안내만 앞뒤로 넘긴다. 마지막에서 '다음' = 닫기
    guidePrev: () => {
      const i = GUIDE_ORDER.indexOf(guideStep);
      if (i > 0) setGuideStep(GUIDE_ORDER[i - 1]);
    },
    guideNext: () => {
      const i = GUIDE_ORDER.indexOf(guideStep);
      if (i < GUIDE_ORDER.length - 1) setGuideStep(GUIDE_ORDER[i + 1]);
      else setGuideOpen(false);
    },
    // 데모 진행 단계 — 0 대기 · 1 접수 · 2 준비 · 3 통화 · 4 후처리
    stepIndex:
      p === "idle"
        ? 0
        : ["connecting", "recording", "confirm"].includes(p)
        ? 1
        : p === "prep"
        ? 2
        : p === "active"
        ? 3
        : 4,
    // 인입 유형 (데모 제어) — idle에서만 변경 가능
    incoming,
    pickNormal: () => pickIncoming("normal"),
    pickUrgent: () => pickIncoming("urgent"),
    pickTransfer: () => pickIncoming("transfer"),
    // 콜 유형은 접수 시점에 픽스처가 고정되므로 대기 중에만 바꿀 수 있다 — UI가 이 사실을 보여줘야 함
    canPickIncoming: p === "idle",
    isUrgent: incoming === "urgent",
    isTransfer: incoming === "transfer",
    handover: TRANSFER_HANDOVER,
    transferTargets: TRANSFER_TARGETS,
    transferDepts: TRANSFER_DEPTS,
    suggestedDept: SUGGESTED_DEPT[incoming],
    transferReserved,
    transferTarget,
    // 기본이 먼저: 인자 없이 부르면 자동 배정 예약. 지정은 이름을 넘길 때만
    reserveTransfer: (target?: string) => {
      setTransferReserved(true);
      setTransferTarget(target ?? null);
      demoBus.emit("transfer.requested", {
        callId: respRef.current.call_id,
        toDept: target ?? SUGGESTED_DEPT[incomingRef.current],
        mode: "reserve",
      });
    },
    toggleTransferReserve: () =>
      setTransferReserved((v) => {
        if (v) setTransferTarget(null);
        else
          demoBus.emit("transfer.requested", {
            callId: respRef.current.call_id,
            toDept: SUGGESTED_DEPT[incomingRef.current],
            mode: "reserve",
          });
        return !v;
      }),
    micErr,
    audioBusy,
    simBg: sim ? "var(--blue-700)" : "#fff",
    simFg: sim ? "#fff" : "var(--color-fg-secondary)",
    micBg: !sim ? "var(--blue-700)" : "#fff",
    micFg: !sim ? "#fff" : "var(--color-fg-secondary)",
    setSim,
    setMic,
    submitAudio,
    reset: requestReset,
    jumpToStep,
    startCall: isCustomerSurface ? requestCustomerStart : startCall,
    answerCall,
    endCall: isCustomerSurface ? requestCustomerEnd : endCall,
    skipWait,
    showSkip:
      (p === "recording" || p === "confirm") && !realCallActiveRef.current,
    emo,
    silenceLeft,
    // phone
    phIdle: p === "idle",
    phInCall: inCall || ended,
    phEnded: ended,
    clockStr: fmt(clock),
    callStartedAt: callStartedAt || "시작 시각 미기록",
    showTimer: inCall && p !== "connecting",
    // 통화 누르자마자 00:01 — 실기기처럼 연결음 단계부터 타이머가 붙는다
    phoneClockStr: fmt(Math.max(clock, 1)),
    showRecDot: p === "recording" || p === "confirm",
    phoneStatus:
      p === "prep"
        ? analysisSource === "no-transcript"
          ? "상담사 연결 준비 중"
          : "AI 요약 완료 · 상담사 연결 준비 중"
        : STATUS[p] || "",
    showGlass: !!GLASS[p],
    glassText: GLASS[p] || "",
    showWave: p === "recording",
    showControls: inCall,
    isCustomerSurface,
    callId: LIVE_CALL_ID,
    liveCaption,
    liveCaptionSpeaker,
    liveCaptionSpeakerLabel: liveCaptionSpeaker === "agent" ? "상담원" : "고객",
    liveTranscriptLines,
    captureBySpeaker,
    levelBySpeaker,
    micActive,
    micLevel,
    arsDigits,
    dtmfEvents,
    dtmfMasked:
      arsDigits.length > 0
        ? `${"•".repeat(Math.max(0, arsDigits.replace(/[^0-9]/g, "").length - 4))}${arsDigits
            .replace(/[^0-9]/g, "")
            .slice(-4)}${arsDigits.endsWith("#") ? " #" : ""}`
        : "",
    dtmfPersisted: dtmfEvents.length === 0 || dtmfEvents.every((event) => event.persisted),
    arsMobileConnected,
    mobileServerConnected,
    mobileIntakeComplete,
    mobileIntakePending,
    mobileAgentConnected,
    customerKeypadEnabled:
      isCustomerSurface &&
      realCallActiveRef.current &&
      mobileServerConnected &&
      !mobileIntakePending &&
      (p === "recording" || p === "confirm" || p === "active"),
    customerPressDigit: pressCustomerDigit,
    // desktop waiting
    showWaiting: ["idle", "connecting", "recording", "confirm"].includes(p),
    waitingText:
      p === "idle"
        ? "상담 대기 중"
        : p === "confirm"
        ? "추가 문의 확인 중…"
        : "AI가 고객 용건을 접수·요약하는 중…",
    waitingSub:
      p === "idle"
        ? "전화가 오면 자연어 접수가 시작됩니다"
        : "완료되면 상담 준비 카드가 표시됩니다",
    waitingSpin: p !== "idle",
    // desktop screens — 통화 종료 후에도 통화 화면이 배경에 남고(흐름 연속),
    // 후처리는 그 위로 올라오는 바텀 시트다. "통화→후처리 = 한 흐름"
    showPrep: p === "prep",
    showActive: p === "active" || ended,
    showWrap: ended,
    wrapLoading: p === "summarizing",
    wrapReady: p === "wrap",
    // prep card
    prepRows: prepDefinitions.map((r, i) => {
      const on = prepChecks[i];
      return {
        ...r,
        on,
        toggle: () =>
          setPrepChecks((c) => {
            const next = c.slice();
            next[i] = !next[i];
            return next;
          }),
        boxBg: on ? "var(--green-700)" : "var(--onair-surface)",
        boxBd: on ? "var(--green-700)" : "var(--gray-500)",
        icon: on ? "check" : "",
        bg: on ? "var(--gray-100)" : "var(--background-200)",
        bd: "transparent",
      };
    }),
    prepDone: prepChecks.filter(Boolean).length,
    prepTotal: prepDefinitions.length,
    prepHeadline: summaryPending
      ? "AI가 실제 고객 발화를 요약하고 있습니다…"
      : card.summary || summary?.headline || "상담카드 생성 중",
    summarySourceLabel: summaryPending
      ? "AI 요약 생성 중"
      : analysisSource.startsWith("ollama:")
      ? `AI 사전 녹음 요약 · ${analysisSource.slice("ollama:".length)}`
      : analysisSource === "local-rule-v2"
      ? "로컬 규칙 요약 · Ollama 미연결"
      : analysisSource === "no-transcript"
      ? "수신 발화 없음 · 자동 요약 생략"
      : analysisSource === "unavailable"
      ? "요약 모델 연결 실패 · 수동 확인"
      : "AI 사전 녹음 요약",
    // 문의유형은 배정권고 타일이 담당 — 여기 반복하지 않는다
    prepCustomerLine: `발신 ${CUSTOMER.phoneMasked} · 음성 접수`,
    prepRoutingTitle: explicitSummaryPending ? "담당 부서 분석 중" : card.department || "담당 부서 분석 중",
    prepRoutingReason: explicitSummaryPending
      ? "실제 고객 발화를 기준으로 업무 유형과 담당 부서를 대조하고 있습니다"
      : card.routing_reason || "문의 유형과 담당 업무를 대조하고 있습니다",
    prepEmotionLabel:
      temperature.status === "unavailable"
        ? "모델 미연동"
        : temperature.level
        ? EMOTION_LABELS[temperature.level]
        : "분석 중",
    // 백엔드가 reason 맨 앞에 실어 보낸 [SOURCE=...]를 배지로 분리하고, 신호 텍스트에선 접두사를 뺀다(P0-3)
    prepEmotionSourceBadge: emotionSourceBadge(parseEmotionSource(temperature.reason)),
    prepEmotionSignal:
      (temperature.reason ?? "").replace(/^\[SOURCE=[A-Z_]+\]\s*/, "") || "특이 감정 신호 없음",
    prepEmotionBars: emotionBars,
    prepEmotionFg: temperature.level ? EMOTION_COLORS[temperature.level].fg : "var(--gray-700)",
    prepEmotionBar: temperature.level ? EMOTION_COLORS[temperature.level].bar : "var(--gray-500)",
    prepRiskLabel: explicitSummaryPending ? "분석 중" : RISK_LABELS[card.incident_risk],
    prepRiskFg: RISK_COLORS[card.incident_risk],
    prepRiskSignal: riskSignals.join(" · ") || "특이 사고 징후 없음",
    prepConfidence:
      explicitSummaryPending
        ? "실제 발화 분석 중 · 상담사 확인 전 후보"
        : card.routing_confidence != null
        ? `확신 ${Math.round(card.routing_confidence * 100)}% · 상담사 확인 전 후보`
        : "확신도 산출 전 · 상담사 확인 필요",
    // 배정 확신도 % 숫자만 (상단 배지용)
    prepConfidencePct:
      card.routing_confidence != null ? Math.round(card.routing_confidence * 100) : null,
    // 감정온도 숫자(당근 매너온도 스타일) — 신호등 대신 큰 숫자로
    prepEmotionScore: temperature.score ?? null,
    transcriptQuote: groundedTranscript,
    // AI가 발화에서 분해한 요구사항 — 이관 판단이 가능한 요약 본문
    summaryPoints: liveActionItems.length
      ? liveActionItems
      : EXPLICIT_LIVE_CALL_ID
      ? ["고객 문의 내용을 다시 확인해 주세요."]
      : SUMMARY_POINTS[incoming],
    prepSummaryBullets,
    externalSessionKey: consultationResponse.call_id,
    // 본인인증 전에는 마스킹된 이름 — 인증이 열람의 열쇠라는 걸 화면이 그대로 보여준다
    customerName: verified ? `${CUSTOMER.name} 고객` : `${CUSTOMER.masked} 고객`,
    customerType: CUSTOMER.type,
    customerPhone: CUSTOMER.phoneMasked,
    inquiryLabel,
    wrapSummaryDefault: [
      // '다시 생성'을 누르면 다른 문형으로 재작성된다 (데모: 템플릿 순환)
      // v0 = 카드 요약 원문. 이미 "고객이…"로 시작하므로 접두사를 붙이면 "고객의 고객이" 중복이 된다
      summaryVersion % 2 === 0
        ? `${card.summary ?? summary?.headline ?? "상담 내용을 요약했습니다."}`
        : `${SUMMARY_PROSE[incoming]}`,
      `업무유형: ${card.business_type}.`,
      `전달부서: ${card.department}.`,
    ]
      .filter(Boolean)
      .join(" "),
    summaryVersion,
    regenerating,
    regenerateSummary: () => {
      // 재생성 느낌 — 잠깐 생성 중 상태를 거쳐 다른 문형으로
      setRegenerating(true);
      after(700, () => {
        setSummaryVersion((v) => v + 1);
        setRegenerating(false);
      });
    },
    summaryProse: SUMMARY_PROSE[incoming],
    connectBg: canConnect ? "var(--blue-700)" : "var(--gray-200)",
    connectFg: canConnect ? "#fff" : "var(--gray-600)",
    connectCursor: canConnect ? "pointer" : "not-allowed",
    prepHint: summaryPending
      ? "AI 사전 요약이 완료되면 통화 연결이 활성화됩니다"
      : canConnect
      ? "사전 요약 준비 완료 · 통화를 연결하세요"
      : "상담 준비 정보를 확인하는 중입니다",
    // auth (1d)
    verified,
    notVerified: nv,
    setAuthPhone: () => pickAuth("phone"),
    setAuthBirth: () => pickAuth("birth"),
    setAuthAcct: () => pickAuth("account"),
    mPhoneBg: mP.bg,
    mPhoneFg: mP.fg,
    mPhoneBd: mP.bd,
    mBirthBg: mB.bg,
    mBirthFg: mB.fg,
    mBirthBd: mB.bd,
    mAcctBg: mA.bg,
    mAcctFg: mA.fg,
    mAcctBd: mA.bd,
    authInput,
    onAuthInput,
    runVerify,
    resetAuth,
    authErr,
    authErrMsg,
    authTime,
    authMethodLabel,
    applyDtmfToAuth: () => {
      const received = arsDigits.replace(/\D/g, "");
      const need = authMethod === "birth" ? 6 : 4;
      setAuthInput(received.slice(-need));
      setAuthErr(false);
      setAuthErrMsg("");
    },
    canApplyDtmfToAuth: arsDigits.replace(/\D/g, "").length > 0,
    // 자릿수 = 입력 상자 개수 — 마스킹된 전체 번호는 보여주지 않는다(최소 표시 원칙, 필요한 칸만)
    authMaxLen: authMethod === "birth" ? 6 : 4,
    // 지금 물어야 할 값 — 안내 문구가 대조 방식을 따라간다
    authAskLabel:
      authMethod === "birth" ? "생년월일 6자리 (YYMMDD)" : authMethod === "account" ? "계좌 뒤 4자리" : "연락처 뒤 4자리",
    // script + memo — 스크립트·규정은 콜 유형과 같은 사건을 말한다
    steps: EXPLICIT_LIVE_CALL_ID
      ? liveSteps
      : SCRIPTS[incoming].map((st) => ({ title: st.title, text: st.text })),
    firstLine,
    isExplicitLiveCall: !!EXPLICIT_LIVE_CALL_ID,
    regRecos: EXPLICIT_LIVE_CALL_ID ? [] : REG_RECOS[incoming],
    regQuery: EXPLICIT_LIVE_CALL_ID
      ? explicitSummaryPending
        ? "본인확인"
        : card.business_type || "본인확인"
      : REG_QUERY[incoming],
    memoItems,
    memoEmpty: memoItems.length === 0,
    memoDraft,
    onMemoDraft: (e: React.ChangeEvent<HTMLInputElement>) => setMemoDraft(e.target.value),
    onMemoKey,
    updateMemo,
    removeMemo,
    // dock (detail lookups)
    openHistory: () => setDockType("history"),
    openAccounts: () => setDockType("accounts"),
    closeDock: () => setDockType(null),
    dockOpen: !!dockType,
    dockTitle: dk.title,
    dockFile: dk.file,
    dockSheet: dk.sheet,
    dockCols: dk.cols,
    dockRows: dk.rows,
    // regulations panel
    openManual: () => setRegExpanded(true),
    openManualAt: (row: number) => {
      setRegTargetRow(row);
      setRegExpanded(true);
    },
    closeReg: () => {
      setRegExpanded(false);
      setRegTargetRow(null);
      setRegDoc(null);
      setRegDocChunk(null);
      setRegSearch(""); // 축소 = 검색어까지 비워 완전히 접힘(다시 클릭하면 줄어들게)
    },
    // 실제 규정 원문 열람
    regDoc,
    regDocChunk,
    regDocLoading,
    openRegDocReal,
    closeRegDoc: () => {
      setRegDoc(null);
      setRegDocChunk(null);
    },
    regTargetRow,
    regExpanded,
    regCollapsed: !regExpanded,
    // 실검색 — 입력은 자유, AI 추천 검색어는 placeholder로 강등
    regSearch,
    onRegSearch: (e: React.ChangeEvent<HTMLInputElement>) => setRegSearch(e.target.value),
    clearRegSearch: () => setRegSearch(""),
    // 의미 검색 — pgvector 하이브리드 결과 (규정 원문 청크)
    semHits,
    semLoading,
    loadManualFile,
    // 확장 폭 640 — 시트가 3컬럼 리플로우라 640이면 잘림 없이 들어가고, 중앙 스크립트 압착도 덜하다
    regW: regExpanded ? 640 : 372,
    regFile: rg.file,
    regSheet: rg.sheet,
    regCols: rg.cols,
    regRows: rgRows,
    regRowsTotal: rg.rows.length,
    // wrap sheet
    wrapSheetOpen,
    notWrapSheetOpen: !wrapSheetOpen,
    toggleWrapSheet: () => setWrapSheetOpen((v) => !v),
    wrapType,
    wrapResult,
    typeMenu,
    resultMenu,
    toggleTypeMenu: () => {
      setTypeMenu((v) => !v);
      setResultMenu(false);
    },
    toggleResultMenu: () => {
      setResultMenu((v) => !v);
      setTypeMenu(false);
    },
    typeOpts: WRAP_TYPE_OPTIONS.map((o) => ({
      label: o,
      pick: () => {
        setWrapType(o);
        setTypeMenu(false);
      },
    })),
    resultOpts: WRAP_RESULT_OPTIONS.map((o) => ({
      label: o,
      pick: () => {
        setWrapResult(o);
        setResultMenu(false);
      },
    })),
    followups: followups.map((f, i) => ({
      icon: f.icon,
      label: f.label,
      remove: () => removeFollowup(i),
    })),
    noFollowups: followups.length === 0,
    // 이미 추가된 추천은 숨긴다 — x로 빼면 다시 나타난다
    recoFollowups: EXPLICIT_LIVE_CALL_ID
      ? []
      : WRAP_DEFAULTS[incoming].recommended.filter(
          (f) => !followups.some((x) => x.label === f.label)
        ).map((f) => ({
          icon: f.icon,
          label: f.label,
          add: () => addFollowup(f),
        })),
    onSummary: (e: React.FormEvent<HTMLDivElement>) => {
      summaryText.current = (e.target as HTMLElement).innerText;
    },
  };
}

export type CallFlowVM = ReturnType<typeof useCallFlow>;
