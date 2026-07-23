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
  ADMIN_QUEUE_POOL,
  type IncomingKind,
  type SheetData,
  renderSheet,
  WRAP_TYPE_OPTIONS,
  WRAP_RESULT_OPTIONS,
  WRAP_DEFAULTS,
  type Followup,
} from "../data/demoContent";
import { piiVerify, piiAccounts, piiHistory } from "../services/pii";
import { startLiveCall } from "../services/liveCall";
import { API_BASE_URL, useReal } from "../services/config";
import { emotionLabel } from "../services/emotion";
import type { EmotionTemperatureLevel, IncidentRisk } from "../services/types";
import {
  startSttSession,
  summarize,
  createConsultationFromAudio,
  getDemoConsultationCard,
  parseEmotionSource,
  emotionSourceBadge,
  demoBus,
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
const PREP_LEN = 4;
// 업무 유형과 무관하게 항상 맞는 유의사항. 실제 규정(RAG)이 PREP_LEN보다 적게 잡혔을 때
// 뒤를 채운다 — 규정이 0건인 통화(코퍼스에 해당 규정이 없는 경우)에도 카드가 비지 않고,
// 무엇보다 엉뚱한 규정을 근거로 안내하는 것보다 일반 원칙을 보여주는 편이 안전하다.
const GENERIC_CHECKS: { title: string; sub: string }[] = [
  {
    title: "본인확인 우선",
    sub: "연락처·생년월일 뒷자리 등으로 본인확인 후 상세 조회 — 완료 전에는 잠깁니다",
  },
  { title: "개인정보 보호", sub: "민감정보는 마스킹, 확정 표현 대신 확인 후 안내" },
  { title: "사고 여부 확인", sub: "금전피해·무단거래 정황이면 즉시 사고·지급정지 절차" },
  { title: "규정 근거 안내", sub: "관련 규정을 확인하고 근거에 따라 정확히 안내" },
];
const PREP_ITEMS: Record<IncomingKind, { title: string; sub: string }[]> = {
  normal: [
    {
      title: "본인확인 우선 진행",
      sub: "연결 직후 연락처·생년월일 등으로 본인확인 — 완료 전에는 고객 상세 조회가 잠깁니다",
    },
    { title: "확정 표현 금지", sub: "“연장 확정” 단정 대신 재약정 심사 결과에 따라 달라질 수 있음을 안내" },
    { title: "문의 내용과 담당 부서 확인", sub: "요약·업무유형·라우팅 근거가 고객 발화와 맞는지 확인" },
    {
      title: "녹취 고지 자동 재생 — 연결 시 자동",
      sub: "통화 연결과 동시에 녹취 안내 멘트가 재생됩니다",
    },
  ],
  urgent: [
    {
      title: "본인확인 우선 진행",
      sub: "명의도용 의심 콜 — 본인확인 없이는 어떤 조치도 진행하지 않습니다",
    },
    { title: "사실관계 먼저 확인", sub: "지급정지 전 '본인이 신청한 대출인지'를 반드시 확인 — 오인 접수 방지" },
    { title: "추가 피해 방지 안내", sub: "통화 중 다른 금융기관 앱·문자 링크를 열지 않도록 안내" },
    {
      title: "녹취 고지 자동 재생 — 연결 시 자동",
      sub: "통화 연결과 동시에 녹취 안내 멘트가 재생됩니다",
    },
  ],
  transfer: [
    {
      title: "본인확인 상태 확인",
      sub: "전임 상담사가 본인확인을 마쳤는지 인수인계에서 확인 — 완료면 재인증 생략",
    },
    { title: "인수인계 메모 확인", sub: "앞서 진행된 내용(금리 인하 요구권 안내)을 중복 안내하지 않기" },
    { title: "확정 표현 금지", sub: "수수료 면제는 약정서 특약 확인 전에 단정하지 않기" },
    {
      title: "녹취 고지 자동 재생 — 연결 시 자동",
      sub: "통화 연결과 동시에 녹취 안내 멘트가 재생됩니다",
    },
  ],
};


// 화면별 데모 안내(투어링)는 src/tour 로 분리 — 시연 전용 레이어라 훅에 두지 않는다.

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

// 실시간 통화 데모용 고정 통화 ID (고객 마이크 송신 소켓 ↔ 상담사 전사 수신 소켓 매칭용)
const LIVE_CALL_ID = "demo1";

// 후속 조치 라벨 → Material Symbols 아이콘. 백엔드(EXAONE)가 라벨 문자열만 주므로
// 아이콘은 프론트가 키워드로 고른다(픽스처 Followup과 같은 모양을 유지하기 위함).
const followupIcon = (label: string): string =>
  /sms|문자/i.test(label) ? "sms"
  : /콜백|예약|일정|대기/.test(label) ? "event"
  : /등록|접수/.test(label) ? "description"
  : /이메일|메일/.test(label) ? "mail"
  : "task_alt";

// ── 침묵 판정 민감도 ──────────────────────────────────────────────────────────
// 마이크 레벨(onLevel, 초당 ~4회)로 "아직 말하는 중"을 판정해 침묵 카운트다운을 리셋한다.
// 예전엔 임계 0.02를 **한 번만** 넘어도 즉시 리셋해서, 실제 시연장의 키보드·숨소리·주변
// 잡음에 카운트다운이 계속 되돌아가 요약이 영영 시작되지 않았다(되돌이표).
// 그래서 ①임계를 실제 발화 대역(0.05~0.3)에 가깝게 올리고 ②연속 N회 지속될 때만
// 발화로 인정한다. 잠깐 튄 잡음은 무시되고, 실제 말은 0.5초면 인정된다.
// 조용히 말해 레벨이 낮은 경우에도 STT 전사가 확정되면 onTranscript가 리셋하므로 안전하다.
const SPEECH_LEVEL_THRESHOLD = 0.06; // 잡음(≈0.005~0.03) 위, 발화(≈0.05~0.3) 하단
const SPEECH_SUSTAIN_TICKS = 2; // 연속 2회(≈0.5초) 이상 지속돼야 발화로 인정
// 말소리 지속 중에는 카운트다운을 5초로 '리셋'하지 않고 잔여시간 하한만 지킨다(보류).
// 리셋 방식은 숫자가 4→5→2처럼 널뛰어 사용자를 헷갈리게 했다. 보류 방식은 숫자가
// 내려가다 ~2초에서 멈춰 기다리고, **확정 전사(onTranscript)가 도착했을 때만** 처음부터
// 다시 센다 — 진짜 발화는 곧 전사가 확정되므로 잘못 만료될 틈이 없다.
const SPEECH_HOLD_MS = 2000;

export function useCallFlow(config: CallFlowConfig = {}) {
  const s1 = config.silenceSec1 ?? 5;
  const s2 = config.silenceSec2 ?? 5;
  const lineGap = config.lineGapMs ?? 2400;

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
  const [emo, setEmo] = useState(0);
  const [silenceLeft, setSilenceLeft] = useState(0);
  const [micErr, setMicErr] = useState("");
  const [audioBusy, setAudioBusy] = useState(false);

  const [prepChecks, setPrepChecks] = useState<boolean[]>(Array(PREP_LEN).fill(true));
  const [verified, setVerified] = useState(false);
  const [authMethod, setAuthMethod] = useState<AuthMethod>("phone");
  const [authInput, setAuthInput] = useState("");
  const [authErr, setAuthErr] = useState(false);
  const [authErrMsg, setAuthErrMsg] = useState("");
  const [authTime, setAuthTime] = useState("");
  const [authMethodLabel, setAuthMethodLabel] = useState("");
  // 개인정보 격리 서버(pii-service)에서 인증 성공 후 로드하는 계좌/이력
  const [piiAcc, setPiiAcc] = useState<SheetData | null>(null);
  const [piiHist, setPiiHist] = useState<SheetData | null>(null);
  // 실시간 통화 자막 — 고객 마이크가 실시간 전사된 최신 문장(전화 화면에 표시)
  const [liveCaption, setLiveCaption] = useState("");
  // 실시간 마이크 레벨/활성 — 녹음 중 시각 피드백(말하면 반응하는 바)
  const [micLevel, setMicLevel] = useState(0);
  const [micActive, setMicActive] = useState(false);

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
  // 상담 가이드(EXAONE) — 단계별 스크립트. 비어 있으면 콜 유형 픽스처(SCRIPTS)로 폴백.
  const [guideSteps, setGuideSteps] = useState<{ title: string; text: string }[]>([]);
  // 실제 발화 분석이 진행 중 — true면 준비 카드가 데모 픽스처(주담대) 대신 "분석 중"을
  // 보여준다. 실통화에서 픽스처 브리핑이 먼저 떴다가 실분석으로 바뀌는 혼란 방지.
  const [summaryPending, setSummaryPending] = useState(false);
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


  // 관리자 대기열에 데모로 추가된 인입 — 폰 '통화 추가' 버튼이 랜덤으로 밀어넣는다
  const [queueExtras, setQueueExtras] = useState<
    { id: number; dept: string; masked: string; summary: string; at: number }[]
  >([]);
  const addQueueCall = useCallback(() => {
    setQueueExtras((xs) => {
      // 아직 안 들어온 사람 우선 — 풀이 다 소진되면 그때부터 중복 허용
      const unused = ADMIN_QUEUE_POOL.filter((p) => !xs.some((x) => x.masked === p.masked));
      const pool = unused.length ? unused : ADMIN_QUEUE_POOL;
      const pick = pool[Math.floor(Math.random() * pool.length)];
      return xs.concat({ id: Date.now() + Math.random(), ...pick, at: Date.now() });
    });
  }, []);

  const [wrapSheetOpen, setWrapSheetOpen] = useState(false);
  const [summaryVersion, setSummaryVersion] = useState(0);
  const [regenerating, setRegenerating] = useState(false);
  const [wrapType, setWrapType] = useState(WRAP_DEFAULTS.normal.type);
  const [wrapResult, setWrapResult] = useState(WRAP_DEFAULTS.normal.result);
  const [typeMenu, setTypeMenu] = useState(false);
  const [resultMenu, setResultMenu] = useState(false);
  const [followups, setFollowups] = useState<Followup[]>(WRAP_DEFAULTS.normal.followups);

  const [summary, setSummary] = useState<CallSummary | null>(null);
  // 백엔드가 통화 내용으로 검색해 준 실제 규정(RAG). 준비 카드의 "이번 상담 유의사항"을
  // 픽스처 대신 이걸로 채운다 — 관련 규정이 없으면 빈 배열이고, 그때는 GENERIC_CHECKS로
  // 넘어간다(백엔드가 점수 하한 미달이면 일부러 비워 보낸다).
  const [ragRefs, setRagRefs] = useState<{ title: string; excerpt: string; category?: string }[]>(
    []
  );
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
  // 임계 이상 레벨이 연속 몇 회 이어졌는지 — 순간 잡음과 실제 발화를 가른다.
  const loudRun = useRef(0);
  const silEnd = useRef(0);
  const stt = useRef<SttSession | null>(null);
  const live = useRef<{ stop: () => void } | null>(null);
  const transcript = useRef<TranscriptChunk[]>([]);
  const phaseRef = useRef<Phase>("idle");
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
    loudRun.current = 0; // 다음 통화가 이전 통화의 레벨 연속 카운트를 물려받지 않도록
    if (stt.current) {
      stt.current.stop();
      stt.current = null;
    }
    if (live.current) {
      live.current.stop();
      live.current = null;
    }
    setMicActive(false);
    setMicLevel(0);
  }, []);

  const startClock = useCallback(() => {
    if (clockT.current) return;
    clockT.current = window.setInterval(() => setClock((c) => c + 1), 1000);
  }, []);

  // 분류 파이프라인 이벤트 연출 — 관리자 대시보드(?role=admin)가 구독한다.
  // 실제 처리(픽스처)는 즉시 끝나므로 스테이지 진행을 step 간격으로 흘린다.
  // 여기서는 emit만 한다 — 통화 상태 로직에는 일절 관여하지 않는다.
  const emitCardPipeline = useCallback(
    (source: "demo" | "backend", step = 700) => {
      const callId = respRef.current.call_id;
      demoBus.emit("pipeline.stage", { callId, stage: "stt", status: "done" });
      demoBus.emit("pipeline.stage", { callId, stage: "classify", status: "start" });
      after(step, () => {
        demoBus.emit("pipeline.stage", { callId, stage: "classify", status: "done" });
        demoBus.emit("pipeline.stage", { callId, stage: "risk", status: "start" });
      });
      after(step * 2, () => {
        demoBus.emit("pipeline.stage", { callId, stage: "risk", status: "done" });
        demoBus.emit("pipeline.stage", { callId, stage: "persist", status: "start" });
      });
      after(step * 3, () => {
        const { consultation_card: card } = respRef.current;
        demoBus.emit("pipeline.stage", {
          callId,
          stage: "persist",
          status: "done",
          detail: "mvp-1.0 카드 저장",
        });
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

  // ── silence detection (drives confirm → summary) ──
  const runSummary = useCallback(async () => {
    const text = transcript.current
      .filter((c) => c.isFinal)
      .map((c) => c.text)
      .join(" ")
      .trim();
    // 실데이터 비활성/전사 없음 → 기존 mock 요약(픽스처 유지, 무대 폴백)
    if (!useReal.data || !text) {
      const [r] = await Promise.allSettled([
        summarize({ chunks: transcript.current, text }),
      ]);
      if (r.status === "fulfilled") setSummary(r.value);
      setSummaryPending(false);
      return;
    }
    try {
      const res = await fetch(`${API_BASE_URL}/analyze-text`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, average_volume: 0 }),
      });
      if (!res.ok) throw new Error(`analyze-text ${res.status}`);
      const d = await res.json();
      const score: number = typeof d?.emotion?.score === "number" ? d.emotion.score : 40;
      const level: EmotionTemperatureLevel =
        score >= 70 ? "elevated" : score >= 40 ? "caution" : "stable";
      const highRisk = (d?.urgency_score ?? 0) >= 60;
      const dept: string = d?.routing?.department || d?.category || "일반상담팀";
      const kw: string[] = Array.isArray(d?.keywords) ? d.keywords : [];
      // 0) 관련 규정 — 준비 카드 유의사항의 근거. 백엔드가 부서 카테고리로 필터하고
      //    점수 하한을 넘긴 것만 보내므로, 여기서는 그대로 신뢰하고 담기만 한다.
      setRagRefs(Array.isArray(d?.references) ? d.references : []);

      // 0.5) 상담 가이드(EXAONE) — 스크립트·후속조치·상담결과가 실제 통화 내용을 따라간다.
      //      비면(생성 실패) 기존 픽스처 유지 — 화면이 깨지지 않는 폴백 원칙.
      const steps = (Array.isArray(d?.script_steps) ? d.script_steps : [])
        .filter((s: unknown): s is { title: string; text: string } =>
          !!s && typeof (s as { title?: unknown }).title === "string" && typeof (s as { text?: unknown }).text === "string")
        .slice(0, 4);
      if (steps.length === 4) setGuideSteps(steps);
      const fups = (Array.isArray(d?.follow_ups) ? d.follow_ups : [])
        .filter((f: unknown): f is string => typeof f === "string" && !!f.trim());
      if (fups.length) setFollowups(fups.map((label: string) => ({ icon: followupIcon(label), label })));
      if (typeof d?.result_label === "string" && d.result_label.trim()) setWrapResult(d.result_label.trim());

      // 1) AI 사전요약(CallSummary) — 실제 전사 기반
      setSummary({
        type: d?.category || "일반 상담",
        headline: d?.summary || "상담 내용을 요약했습니다.",
        bullets: kw.length ? kw.slice(0, 4) : [d?.summary || ""].filter(Boolean),
        emotion: { score, level, label_ko: emotionLabel(level), signals: [] },
        incidentRisk: (highRisk ? "high" : "watch") as IncidentRisk,
        recommendedAgent: highRisk ? "숙련 상담사 우선" : "일반 상담 가능",
      });

      // 2) 상담카드 오버레이 — 라우팅(부서)·위험·감정이 실제 대화를 반영하게
      // 근거 발화도 실제 마지막 확정 발화로 교체(픽스처 주담대 인용이 남지 않게)
      const lastUtterance =
        transcript.current.filter((c) => c.isFinal && c.text.trim()).slice(-1)[0]?.text ?? text;
      setConsultationResponse((prev) => ({
        ...prev,
        transcript: { ...prev.transcript, text: lastUtterance },
        consultation_card: {
          ...prev.consultation_card,
          summary: d?.summary || prev.consultation_card.summary,
          business_type: d?.category || prev.consultation_card.business_type,
          department: dept,
          routing_reason: d?.routing?.reason || prev.consultation_card.routing_reason,
          incident_risk: highRisk ? "high" : "low",
          risk_reason: kw.length
            ? `위험 신호: ${kw.join(", ")}`
            : prev.consultation_card.risk_reason,
          routing_confidence: 0.9,
          emotion: {
            status: "completed",
            score,
            level,
            reason: "[SOURCE=REAL_MODEL] 실시간 통화 분석",
          },
        },
      }));

      // 3) 후처리 업무유형 — 실제 반영
      if (d?.category) setWrapType(d.category);
      setSummaryPending(false);
    } catch {
      const [r] = await Promise.allSettled([
        summarize({ chunks: transcript.current, text }),
      ]);
      if (r.status === "fulfilled") setSummary(r.value);
      setSummaryPending(false);
    }
  }, []);

  const toPrep = useCallback(() => {
    if (silT.current) {
      clearInterval(silT.current);
      silT.current = null;
    }
    if (stt.current) {
      stt.current.stop();
      stt.current = null;
    }
    setPhase("prep");
    setPrepChecks(Array(PREP_LEN).fill(true));
    // 실제 발화가 있으면 분석이 끝날 때까지 준비 카드에 픽스처(주담대) 대신 "분석 중" 표시.
    // 시뮬 모드(마이크 폴백)는 픽스처가 곧 무대이므로 pending을 켜지 않는다.
    if (useReal.data && transcript.current.some((c) => c.isFinal && c.text.trim())) {
      setSummaryPending(true);
    }
    void runSummary();
    emitCardPipeline("demo");
  }, [emitCardPipeline, runSummary]);

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
      setPhase("confirm");
    } else if (silStage.current === "confirmPause") {
      silStage.current = "second";
      silEnd.current = now + s2 * 1000;
    } else if (silStage.current === "second") {
      silStage.current = null;
      toPrep();
    }
  }, [s2, toPrep]);

  const runScript = useCallback(() => {
    // Deterministic emotion escalation for the demo.
    const emos = [1, 1, 2, 3];
    emos.forEach((e, i) => after(lineGap * (i + 1), () => setEmo(e)));
    after(lineGap * (emos.length + 1), () => armFirst());
    // 전사 소스: 실제 고객 마이크 스트리밍(고객→WS→로컬 STT). 마이크 거부/불가 시
    // 기존 대본 시뮬레이션으로 자동 폴백해 무대가 끊기지 않게 한다.
    transcript.current = [];
    setLiveCaption("");
    startLiveCall(LIVE_CALL_ID, {
      onTranscript: (t) => {
        transcript.current.push({ text: t.text, at: t.at ?? 0, isFinal: true });
        setLiveCaption(t.text);
        demoBus.emit("stt.utterance", {
          callId: respRef.current.call_id,
          text: t.text,
          isFinal: true,
          atMs: t.at ?? 0,
        });
        // 고객이 말했다 = 침묵이 아니다. 카운트다운을 처음부터 다시 건다.
        // 이게 없으면 armFirst 이후 타이머가 한 번도 리셋되지 않아, 고객이 계속
        // 말하는 중에도 s1초가 지나면 "더 하실 말씀 없으신가요"로 넘어가 말을 끊었다.
        if (silStage.current) armFirst();
      },
      onLevel: (l) => {
        setMicLevel(l);
        // 지속되는 입력이 있으면 침묵 카운트다운을 '보류'한다 — 5초 리셋이 아니라
        // 잔여시간 하한(SPEECH_HOLD_MS)만 지킨다. 숫자 널뛰기(4→5→2…) 방지.
        // 처음(s1)부터 다시 세는 건 확정 전사(onTranscript)가 도착했을 때뿐이다.
        if (l > SPEECH_LEVEL_THRESHOLD) {
          loudRun.current += 1;
          if (loudRun.current >= SPEECH_SUSTAIN_TICKS && silStage.current) {
            silEnd.current = Math.max(silEnd.current, Date.now() + SPEECH_HOLD_MS);
          }
        } else {
          loudRun.current = 0;
        }
      },
    })
      .then((h) => {
        live.current = h;
        setMicActive(true);
      })
      .catch(() => {
        setMicActive(false);
        stt.current = startSttSession(
          {
            onChunk: (c) => {
              transcript.current.push(c);
              demoBus.emit("stt.utterance", {
                callId: respRef.current.call_id,
                text: c.text,
                isFinal: c.isFinal,
                atMs: c.at,
              });
            },
          },
          lineGap
        );
      });
  }, [after, armFirst, lineGap]);

  const beginRecording = useCallback(() => {
    setPhase("recording");
    silStage.current = null;
    silT.current = window.setInterval(silTick, 200);
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
  }, [runScript, silTick]);

  // ── public actions ──
  const startCall = useCallback(() => {
    clearAll();
    // 인입 유형에 맞는 상담카드 픽스처 선택 (데모)
    const kind = incomingRef.current;
    const resp =
      kind === "urgent"
        ? (structuredClone(URGENT_RESPONSE) as unknown as ConsultationCardResponse)
        : kind === "transfer"
        ? (structuredClone(TRANSFER_RESPONSE) as unknown as ConsultationCardResponse)
        : getDemoConsultationCard();
    setConsultationResponse(resp);
    // 리렌더 전에 타이머 콜백이 읽을 수 있도록 ref는 즉시 동기화
    respRef.current = resp;
    demoBus.emit("call.incoming", { callId: resp.call_id, kind });
    demoBus.emit("pipeline.stage", {
      callId: resp.call_id,
      stage: "utterance",
      status: "start",
    });
    // 후처리 프리셋도 콜 유형에 맞춰 채운다 — 상담 유형·결과·후속조치가 통화 내용과 어긋나지 않게
    const wrap = WRAP_DEFAULTS[kind];
    setWrapType(wrap.type);
    setWrapResult(wrap.result);
    setFollowups(wrap.followups);
    setTransferReserved(false);
    setEmoDrift(null);
    setRagRefs([]); // 지난 통화의 규정이 다음 통화 유의사항에 남지 않게
    setGuideSteps([]); // 지난 통화의 스크립트도 마찬가지 — 픽스처로 시작해 분석 도착 시 교체
    setPhase("connecting");
    setClock(0);
    setEmo(0);
    setSilenceLeft(0);
    setMicErr("");
    startClock();
    after(3000, () => beginRecording());
  }, [after, beginRecording, clearAll, startClock]);

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
    if (prepChecks.every(Boolean)) {
      setPhase("active");
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
  }, [after, prepChecks]);

  const reset = useCallback(() => {
    clearAll();
    demoBus.emit("demo.reset", {});
    setPhase("idle");
    setClock(0);
    setEmo(0);
    setSilenceLeft(0);
    setMicErr("");
    setSummary(null);
    setSummaryPending(false);
    setConsultationResponse(getDemoConsultationCard());
    setVerified(false);
    setAuthInput("");
    setAuthErr(false);
    setMemoItems([]);
    setMemoDraft("");
    setDockType(null);
    setRegExpanded(false);
    setWrapSheetOpen(false);
    setWrapType(WRAP_DEFAULTS.normal.type);
    setWrapResult(WRAP_DEFAULTS.normal.result);
    setFollowups(WRAP_DEFAULTS.normal.followups);
    setRagRefs([]);
    setGuideSteps([]);
    setTransferReserved(false);
    setTransferTarget(null);
    setEmoDrift(null);
    setSummaryVersion(0);
    setRegenerating(false);
    setIncoming("normal");
  }, [clearAll]);

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
      setRagRefs([]);
      setGuideSteps([]);
      setTransferReserved(false);
      setEmoDrift(null);
      setMicErr("");
      setEmo(0);
      setSilenceLeft(0);
      setVerified(false);
      setAuthInput("");
      startClock();
      if (n === 2) {
        setPrepChecks(Array(PREP_LEN).fill(true));
        setWrapSheetOpen(false);
        setPhase("prep");
      } else if (n === 3) {
        setPrepChecks(Array(PREP_LEN).fill(true)); // 유의사항 확인을 거친 상태로 진입
        setWrapSheetOpen(false);
        setPhase("active");
      } else {
        setPrepChecks(Array(PREP_LEN).fill(true));
        setWrapSheetOpen(true);
        setPhase("wrap");
      }
    },
    [clearAll, reset, startCall, startClock]
  );

  const endCall = useCallback(() => {
    if (phaseRef.current === "active") {
      clearAll();
      setPhase("summarizing");
      // 종료와 동시에 후처리 시트가 자동으로 올라온다 — 통화→후처리는 한 흐름
      setWrapSheetOpen(true);
      demoBus.emit("pipeline.stage", {
        callId: respRef.current.call_id,
        stage: "wrap",
        status: "start",
      });
      after(3600, () => {
        setPhase("wrap");
        const callId = respRef.current.call_id;
        const preset = WRAP_DEFAULTS[incomingRef.current];
        demoBus.emit("pipeline.stage", {
          callId,
          stage: "wrap",
          status: "done",
          detail: "후처리 초안 자동 작성",
        });
        demoBus.emit("call.ended", {
          callId,
          wrapType: preset.type,
          wrapResult: preset.result,
        });
        if (transferRef.current.reserved) {
          demoBus.emit("transfer.completed", {
            callId,
            toDept: transferRef.current.target ?? SUGGESTED_DEPT[incomingRef.current],
          });
        }
      });
    } else {
      reset();
    }
  }, [after, clearAll, reset]);

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
      clearAll();
      setMode("mic");
      setPhase("recording");
      setClock(0);
      setEmo(0);
      setMicErr("");
      setAudioBusy(true);
      startClock();
      try {
        const response = await createConsultationFromAudio(file);
        setConsultationResponse(response);
        respRef.current = response;
        transcript.current = [
          { text: response.transcript.text, at: 0, isFinal: true },
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
        });
        setSummary(null);
        setSummaryPending(false);
        setPrepChecks(Array(PREP_LEN).fill(true));
        setPhase("prep");
        emitCardPipeline("backend", 250);
      } catch (error) {
        const message = error instanceof Error ? error.message : "음성 처리에 실패했습니다.";
        setMicErr(message);
        setPhase("idle");
      } finally {
        setAudioBusy(false);
      }
    },
    [clearAll, emitCardPipeline, startClock]
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
  const runVerify = useCallback(async () => {
    const need = authMethod === "birth" ? 6 : 4;
    const digits = (authInput || "").replace(/\D/g, "");
    if (digits.length < need) {
      setAuthErrMsg(`자릿수가 부족합니다 — ${need}자리를 입력하세요`);
      setAuthErr(true);
      return;
    }
    const val = digits.slice(-need);
    // 본인인증은 개인정보 격리 서버(pii-service)로 보낸다 — AI 백엔드는 관여하지 않음.
    // pii-service가 꺼져 있으면 로컬 대조로 폴백(무대 안전장치).
    let ok = false;
    let custId: string | null = null;
    try {
      const r = await piiVerify(authMethod, val);
      ok = r.verified;
      custId = r.customer_id;
    } catch {
      ok = val === CUSTOMER.authAnswers[authMethod];
      custId = ok ? "c1" : null;
    }
    if (!ok) {
      setAuthErrMsg("고객 진술과 불일치 — 값을 다시 확인하거나 다른 대조 방식을 사용하세요");
      setAuthErr(true);
      return;
    }
    // 인증 성공 → 개인정보(계좌/이력)를 격리 서버에서 로드(실패 시 렌더 단계에서 정적 폴백).
    if (custId) {
      piiAccounts(custId).then(setPiiAcc).catch(() => {});
      piiHistory(custId).then(setPiiHist).catch(() => {});
    }
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
  }, [authInput, authMethod]);
  const resetAuth = useCallback(() => {
    setVerified(false);
    setAuthInput("");
    setAuthErr(false);
    setPiiAcc(null);
    setPiiHist(null);
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
        // 한글 IME 조합 중 Enter는 '조합 확정'일 뿐 — 이때 추가하면 메모가 "안녕하세"+"요"로 쪼개진다
        if (e.nativeEvent.isComposing) return;
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
  }, [fit, phase, verified, regExpanded, memoItems, followups, wrapSheetOpen, micErr]);

  useEffect(() => () => clearAll(), [clearAll]);

  // ── derived view model ──
  const p = phase;
  const inCall = ["connecting", "recording", "confirm", "prep", "active"].includes(p);
  const ended = p === "wrap" || p === "summarizing";
  const sim = mode === "sim";
  const nv = !verified;

  // 계좌/이력은 인증 후 pii-service에서 받은 데이터 우선, 없으면(미로드/서버다운) 정적 폴백
  const dk = renderSheet(
    (dockType === "accounts" ? piiAcc : dockType === "history" ? piiHist : null) ??
      SHEETS[dockType ?? "history"]
  );
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
  const card = consultationResponse.consultation_card;
  // 통화 중 드리프트가 있으면 실시간 값이 카드 초기값을 덮는다
  // 통화 중 드리프트한 감정온도는 종료 후(후처리)에도 유지 — 마지막 실측이 초기 카드값으로 되돌아가지 않게
  const temperature =
    (p === "active" || ended) && emoDrift
      ? { status: "completed" as const, score: emoDrift.score, level: emoDrift.level, reason: emoDrift.reason }
      : card.emotion;
  const inquiryLabel = card.business_type || summary?.type || "상담 유형 분석 중";
  // 요약 문장은 헤드라인 한 곳에만 — 불릿에는 근거만 남겨 중복을 없앤다.
  const contractBullets = [card.routing_reason, card.risk_reason].filter(
    (value): value is string => !!value
  );
  const prepSummaryBullets = (contractBullets.length
    ? contractBullets
    : summary?.bullets ?? ["고객 발화를 분석하고 있습니다."]
  ).slice(0, 4);
  // 유의사항 = 실제 규정(RAG) 우선, 모자란 만큼 일반 원칙으로 채움. 규정이 하나도 없으면
  // (실데이터 미사용이거나 백엔드가 하한 미달로 비워 보낸 경우) 기존 데모 픽스처로 강등한다.
  const prepDefinitions = summaryPending
    ? GENERIC_CHECKS.slice(0, PREP_LEN)
    : ragRefs.length
    ? [
        ...ragRefs.map((r) => ({
          title: r.title,
          sub: (r.excerpt || "")
            .replace(/^\[[^\]]*\]\s*/, "") // "[문서명 > p3 > 부서]" 머리말 제거
            .replace(/\s+/g, " ")
            .trim()
            .slice(0, 110),
        })),
        ...GENERIC_CHECKS,
      ].slice(0, PREP_LEN)
    : PREP_ITEMS[incoming];
  const emotionBars = temperature.score == null
    ? 0
    : temperature.score > 66
      ? 3
      : temperature.score > 33
        ? 2
        : 1;
  const riskSignals = [card.risk_reason].filter((value): value is string => !!value);

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
    // 관리자 대기열 데모 추가 인입
    queueExtras,
    addQueueCall,
    simBg: sim ? "var(--blue-700)" : "#fff",
    simFg: sim ? "#fff" : "var(--color-fg-secondary)",
    micBg: !sim ? "var(--blue-700)" : "#fff",
    micFg: !sim ? "#fff" : "var(--color-fg-secondary)",
    setSim,
    setMic,
    submitAudio,
    reset,
    jumpToStep,
    startCall,
    answerCall,
    endCall,
    skipWait,
    showSkip: p === "recording" || p === "confirm",
    emo,
    silenceLeft,
    // phone
    phIdle: p === "idle",
    phInCall: inCall || ended,
    phEnded: ended,
    clockStr: fmt(clock),
    showTimer: inCall,
    // 통화 누르자마자 00:01 — 실기기처럼 연결음 단계부터 타이머가 붙는다
    phoneClockStr: fmt(Math.max(clock, 1)),
    showRecDot: p === "recording" || p === "confirm",
    phoneStatus: STATUS[p] || "",
    showGlass: !!GLASS[p],
    glassText: GLASS[p] || "",
    showWave: p === "recording",
    liveCaption,
    micLevel,
    micActive,
    showControls: inCall,
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
    // 분석 대기 중에는 픽스처 카드(주담대)를 숨긴다 — 실통화에서 엉뚱한 브리핑 선노출 방지
    summaryPending,
    prepHeadline: summaryPending
      ? "실시간 발화를 분석해 브리핑을 만들고 있습니다…"
      : card.summary || summary?.headline || "상담카드 생성 중",
    // 문의유형은 배정권고 타일이 담당 — 여기 반복하지 않는다
    prepCustomerLine: `발신 ${CUSTOMER.phoneMasked} · 음성 접수`,
    prepRoutingTitle: summaryPending ? "담당 부서 분석 중" : card.department || "담당 부서 분석 중",
    prepRoutingReason: summaryPending
      ? "문의 유형과 담당 업무를 대조하고 있습니다"
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
    prepRiskLabel: RISK_LABELS[card.incident_risk],
    prepRiskFg: RISK_COLORS[card.incident_risk],
    prepRiskSignal: riskSignals.join(" · ") || "특이 사고 징후 없음",
    prepConfidence:
      !summaryPending && card.routing_confidence != null
        ? `확신 ${Math.round(card.routing_confidence * 100)}% · 상담사 확인 전 후보`
        : "확신도 산출 전 · 상담사 확인 필요",
    // 배정 확신도 % 숫자만 (상단 배지용)
    prepConfidencePct:
      !summaryPending && card.routing_confidence != null
        ? Math.round(card.routing_confidence * 100)
        : null,
    // 감정온도 숫자(당근 매너온도 스타일) — 신호등 대신 큰 숫자로
    prepEmotionScore: temperature.score ?? null,
    // 근거 발화 — 분석 대기 중엔 실제 마지막 확정 발화를(픽스처 인용 노출 방지),
    // 분석 후엔 runSummary가 실발화로 교체해 둔 카드 값을 쓴다.
    transcriptQuote: summaryPending
      ? transcript.current.filter((c) => c.isFinal && c.text.trim()).slice(-1)[0]?.text ?? "…"
      : consultationResponse.transcript.text,
    // AI가 발화에서 분해한 요구사항 — 이관 판단이 가능한 요약 본문.
    // 실제 통화면 백엔드 요약의 불릿(키워드)을, 없으면 데모 픽스처를 쓴다.
    summaryPoints: summaryPending
      ? ["음성 인식 완료 · AI 요약 생성 중…"]
      : summary?.bullets?.length ? summary.bullets : SUMMARY_POINTS[incoming],
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
    connectBg: allChecked ? "var(--blue-700)" : "var(--gray-200)",
    connectFg: allChecked ? "#fff" : "var(--gray-600)",
    connectCursor: allChecked ? "pointer" : "not-allowed",
    prepHint: "유의사항을 확인하고 통화를 연결하세요",
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
    // 자릿수 = 입력 상자 개수 — 마스킹된 전체 번호는 보여주지 않는다(최소 표시 원칙, 필요한 칸만)
    authMaxLen: authMethod === "birth" ? 6 : 4,
    // 지금 물어야 할 값 — 안내 문구가 대조 방식을 따라간다
    authAskLabel:
      authMethod === "birth" ? "생년월일 6자리 (YYMMDD)" : authMethod === "account" ? "계좌 뒤 4자리" : "연락처 뒤 4자리",
    // script + memo — 실제 통화 분석(EXAONE)이 있으면 그걸, 없으면 콜 유형 픽스처.
    // 스크립트·규정·후속조치가 전부 같은 실분석에서 나와 한 사건을 말하게 된다.
    steps: summaryPending
      ? [{ title: "AI 분석 중", text: "통화 내용 분석이 끝나면 이 통화에 맞춘 단계별 스크립트가 표시됩니다." }]
      : (guideSteps.length === 4 ? guideSteps : SCRIPTS[incoming]).map((st) => ({ title: st.title, text: st.text })),
    firstLine: summaryPending
      ? "안녕하세요, 키움은행 고객센터입니다. 문의하신 내용 확인해 바로 도와드리겠습니다."
      : (guideSteps.length === 4 ? guideSteps : SCRIPTS[incoming])[0].text,
    // 관련 규정 AI 추천 — 실제 RAG 근거(백엔드가 점수 하한 통과분만 보냄) 우선.
    // 실데이터는 시트 행(row)이 없어 row:null — '열기'는 규정집 의미검색(query)으로 연결.
    regRecos: ragRefs.length
      ? ragRefs.slice(0, 3).map((r) => ({
          title: r.title,
          body: (r.excerpt || "").replace(/^\[[^\]]*\]\s*/, "").replace(/\s+/g, " ").trim().slice(0, 110),
          file: `실물 규정 · AI 검색${r.category ? ` · ${r.category}` : ""}`,
          row: null as number | null,
          query: r.title as string | null,
        }))
      : REG_RECOS[incoming].map((r) => ({ ...r, row: r.row as number | null, query: null as string | null })),
    regQuery: REG_QUERY[incoming],
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
      setRegSearch(""); // 검색 필터가 대상 행을 가리지 않게 — 열기는 항상 원본 시트에서 그 행을 보여준다
      setRegTargetRow(row);
      setRegExpanded(true);
    },
    // 실제 RAG 추천 규정의 '열기' — 시트 행이 없으므로 규정집 의미검색으로 그 문서를 찾아 보여준다
    openRegQuery: (q: string) => {
      setRegTargetRow(null);
      setRegSearch(q);
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
    // 실분석 result_label이 고정 목록에 없으면 맨 위에 끼워 드롭다운에서도 선택 가능하게
    resultOpts: [
      ...(wrapResult && !WRAP_RESULT_OPTIONS.includes(wrapResult) ? [wrapResult] : []),
      ...WRAP_RESULT_OPTIONS,
    ].map((o) => ({
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
    recoFollowups: WRAP_DEFAULTS[incoming].recommended.filter(
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
