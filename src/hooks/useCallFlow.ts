import type * as React from "react";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  CALL_SCRIPT,
  SHEETS,
  renderSheet,
  WRAP_TYPE_OPTIONS,
  WRAP_RESULT_OPTIONS,
  DEFAULT_FOLLOWUPS,
  RECOMMENDED_FOLLOWUPS,
  type Followup,
} from "../data/demoContent";
import {
  startSttSession,
  summarize,
  getConsultationCard,
  getDemoConsultationCard,
  type CallSummary,
  type ConsultationCardResponse,
  type TranscriptChunk,
  type SttSession,
} from "../services";

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
    "연결 대기 중입니다. 상담사 연결 전 용건을 말씀해 주시면 더 빠르게 도와드려요. 계좌번호·비밀번호 등 민감정보는 말씀하지 마시고, 언제든 상담사 연결을 요청하실 수 있어요.",
  confirm: "더 말씀하실 내용이 있으신가요?",
  prep: "상담사에게 우선 연결하고 있습니다.",
};
const PREP_ITEMS = [
  { title: "확정적 반환 표현 금지", sub: "“무조건 돌려받는다” 대신 반환지원 제도 절차로 안내" },
  { title: "개인정보 마스킹 유지", sub: "수취 계좌·예금주 원문 노출 금지" },
  {
    title: "녹취 고지 자동 재생 — 연결 시 자동",
    sub: "통화 연결과 동시에 녹취 안내 멘트가 재생됩니다",
  },
];

const INQUIRY_LABELS: Record<string, string> = {
  mistaken_transfer: "전자금융 › 착오송금",
  voice_phishing_suspected: "금융사고 › 보이스피싱 의심",
  lost_card: "카드 › 분실신고",
  overseas_payment: "카드 › 해외결제",
  account_opening: "예금 › 계좌개설",
  payment_error: "전자금융 › 결제 오류",
  loan: "여신 › 대출상담",
  general_inquiry: "일반 문의",
  other: "기타 문의",
};

const RISK_LABELS = {
  low: "낮음",
  medium: "주의",
  high: "높음",
  critical: "긴급",
} as const;

const fmt = (s: number) => {
  const m = Math.floor(s / 60);
  const r = s % 60;
  return (m < 10 ? "0" : "") + m + ":" + (r < 10 ? "0" : "") + r;
};

export function useCallFlow(config: CallFlowConfig = {}) {
  const s1 = config.silenceSec1 ?? 5;
  const s2 = config.silenceSec2 ?? 5;
  const lineGap = config.lineGapMs ?? 2400;

  const [phase, setPhase] = useState<Phase>("idle");
  const [mode, setMode] = useState<Mode>("sim");
  const [clock, setClock] = useState(0);
  const [emo, setEmo] = useState(0);
  const [silenceLeft, setSilenceLeft] = useState(0);
  const [micErr, setMicErr] = useState("");

  const [prepChecks, setPrepChecks] = useState<boolean[]>([false, false, false]);
  const [verified, setVerified] = useState(false);
  const [authMethod, setAuthMethod] = useState<AuthMethod>("phone");
  const [authInput, setAuthInput] = useState("");
  const [authErr, setAuthErr] = useState(false);
  const [authTime, setAuthTime] = useState("");
  const [authMethodLabel, setAuthMethodLabel] = useState("");

  const [memoItems, setMemoItems] = useState<string[]>([]);
  const [memoDraft, setMemoDraft] = useState("");
  const memoDraftRef = useRef("");
  memoDraftRef.current = memoDraft;

  const [dockType, setDockType] = useState<DockType | null>(null);
  const [regExpanded, setRegExpanded] = useState(false);

  const [wrapSheetOpen, setWrapSheetOpen] = useState(true);
  const [wrapType, setWrapType] = useState(WRAP_TYPE_OPTIONS[0]);
  const [wrapResult, setWrapResult] = useState(WRAP_RESULT_OPTIONS[0]);
  const [typeMenu, setTypeMenu] = useState(false);
  const [resultMenu, setResultMenu] = useState(false);
  const [followups, setFollowups] = useState<Followup[]>(DEFAULT_FOLLOWUPS);

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
  const transcript = useRef<TranscriptChunk[]>([]);
  const phaseRef = useRef<Phase>("idle");
  phaseRef.current = phase;

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
  }, []);

  const startClock = useCallback(() => {
    if (clockT.current) return;
    clockT.current = window.setInterval(() => setClock((c) => c + 1), 1000);
  }, []);

  // ── silence detection (drives confirm → summary) ──
  const runSummary = useCallback(async () => {
    const text = transcript.current
      .filter((c) => c.isFinal)
      .map((c) => c.text)
      .join(" ");
    const [summaryResult, cardResult] = await Promise.allSettled([
      summarize({ chunks: transcript.current, text }),
      getConsultationCard(),
    ]);
    if (summaryResult.status === "fulfilled") setSummary(summaryResult.value);
    if (cardResult.status === "fulfilled") setConsultationResponse(cardResult.value);
    // On API failure the contract fixture remains visible, preserving the live demo.
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
    setPrepChecks([false, false, false]);
    void runSummary();
  }, [runSummary]);

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
    // Feed the (mock) transcript so the summariser has real input.
    transcript.current = [];
    stt.current = startSttSession(
      {
        onChunk: (c) => transcript.current.push(c),
      },
      lineGap
    );
  }, [after, armFirst, lineGap]);

  const beginRecording = useCallback(() => {
    setPhase("recording");
    silStage.current = null;
    silT.current = window.setInterval(silTick, 200);
    runScript(); // mic is simulation-only for this demo
  }, [runScript, silTick]);

  // ── public actions ──
  const startCall = useCallback(() => {
    clearAll();
    setPhase("connecting");
    setClock(0);
    setEmo(0);
    setSilenceLeft(0);
    setMicErr("");
    startClock();
    after(3000, () => beginRecording());
  }, [after, beginRecording, clearAll, startClock]);

  const skipWait = useCallback(() => {
    if (phaseRef.current === "recording" || phaseRef.current === "confirm") {
      silStage.current = null;
      timers.current.forEach(clearTimeout);
      timers.current = [];
      toPrep();
    }
  }, [toPrep]);

  const answerCall = useCallback(() => {
    if (prepChecks.every(Boolean)) setPhase("active");
  }, [prepChecks]);

  const reset = useCallback(() => {
    clearAll();
    setPhase("idle");
    setClock(0);
    setEmo(0);
    setSilenceLeft(0);
    setMicErr("");
    setSummary(null);
    setConsultationResponse(getDemoConsultationCard());
    setVerified(false);
    setAuthInput("");
    setAuthErr(false);
    setMemoItems([]);
    setMemoDraft("");
    setDockType(null);
    setRegExpanded(false);
    setWrapSheetOpen(true);
    setFollowups(DEFAULT_FOLLOWUPS);
  }, [clearAll]);

  const endCall = useCallback(() => {
    if (phaseRef.current === "active") {
      clearAll();
      setPhase("summarizing");
      setWrapSheetOpen(true);
      after(3600, () => setPhase("wrap"));
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

  // ── auth ──
  const pickAuth = useCallback((m: AuthMethod) => {
    setAuthMethod(m);
    setAuthErr(false);
  }, []);
  const onAuthInput = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setAuthInput(e.target.value);
    setAuthErr(false);
  }, []);
  const runVerify = useCallback(() => {
    const need = authMethod === "birth" ? 6 : 4;
    const n = (authInput || "").replace(/\D/g, "").length;
    if (n >= need) {
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
    } else {
      setAuthErr(true);
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

  // ── followups ──
  const removeFollowup = useCallback((i: number) => {
    setFollowups((f) => f.filter((_, x) => x !== i));
  }, []);
  const addFollowup = useCallback((f: Followup) => {
    setFollowups((cur) => (cur.some((x) => x.label === f.label) ? cur : cur.concat(f)));
  }, []);

  // ── viewport fit (scale the 1420px stage down to the container) ──
  const fit = useCallback(() => {
    const w = rootRef.current ? rootRef.current.clientWidth : window.innerWidth;
    const avail = Math.max(320, w - 40);
    const sc = Math.min(1, avail / STAGE_W);
    setScale((prev) => (prev !== sc ? sc : prev));
    const h = stageRef.current ? stageRef.current.offsetHeight : 0;
    setNatH((prev) => (prev !== h ? h : prev));
  }, []);

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

  const dk = renderSheet(SHEETS[dockType ?? "history"]);
  const rg = renderSheet(SHEETS.manual);

  const mColors = (active: boolean) => ({
    bg: active ? "var(--blue-700)" : "#fff",
    fg: active ? "#fff" : "var(--gray-800)",
    bd: active ? "var(--blue-700)" : "var(--gray-400)",
  });
  const mP = mColors(authMethod === "phone");
  const mB = mColors(authMethod === "birth");
  const mA = mColors(authMethod === "account");

  const allChecked = prepChecks.every(Boolean);
  const integrated = consultationResponse.data;
  const card = integrated.consultation_card;
  const routing = integrated.routing_result;
  const temperature = integrated.emotion_temperature;
  const inquiryLabel = card
    ? INQUIRY_LABELS[card.inquiry_type] ?? card.inquiry_type
    : summary?.type ?? "상담 유형 분석 중";
  const contractBullets = card
    ? [card.summary, card.customer_request, ...card.risk_factors].filter(
        (value): value is string => !!value
      )
    : [];
  const prepSummaryBullets = (contractBullets.length
    ? contractBullets
    : summary?.bullets ?? ["고객 발화를 분석하고 있습니다."]
  ).slice(0, 4);
  const prepDefinitions = PREP_ITEMS.map((fallback, index) => ({
    ...fallback,
    title: card?.confirmation_items[index] ?? fallback.title,
  }));
  const emotionBars =
    temperature.level === "elevated" ? 3 : temperature.level === "caution" ? 2 : 1;

  return {
    // refs
    rootRef,
    stageRef,
    // scaling
    scaleT: "scale(" + scale + ")",
    scaledW: STAGE_W * scale + "px",
    scaledH: natH ? natH * scale + "px" : "auto",
    // header
    phaseLabel: LABELS[p] || p,
    micErr,
    simBg: sim ? "var(--blue-700)" : "#fff",
    simFg: sim ? "#fff" : "var(--color-fg-secondary)",
    micBg: !sim ? "var(--blue-700)" : "#fff",
    micFg: !sim ? "#fff" : "var(--color-fg-secondary)",
    setSim,
    setMic,
    reset,
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
    showTimer: inCall && p !== "connecting",
    showRecDot: p === "recording" || p === "confirm",
    phoneStatus: STATUS[p] || "",
    showGlass: !!GLASS[p],
    glassText: GLASS[p] || "",
    showWave: p === "recording",
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
    // desktop screens
    showPrep: p === "prep",
    showActive: p === "active",
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
        boxBg: on ? "var(--green-700)" : "#fff",
        boxBd: on ? "var(--green-700)" : "var(--gray-500)",
        icon: on ? "check" : "",
        bg: on ? "var(--green-100)" : "var(--background-200)",
        bd: on ? "var(--green-400)" : "var(--gray-200)",
      };
    }),
    prepDone: prepChecks.filter(Boolean).length,
    prepTotal: prepDefinitions.length,
    prepHeadline: card?.summary ?? summary?.headline ?? "상담카드 생성 중",
    prepCustomerLine: `${integrated.customer.full_name_masked} · ${inquiryLabel} · ${integrated.customer.phone_masked}`,
    prepRoutingTitle:
      routing?.counselor_name && routing.department_name
        ? `${routing.department_name} · ${routing.counselor_name}`
        : summary?.recommendedAgent ?? "담당 상담사 추천 중",
    prepRoutingReason: routing?.rationale ?? "문의 유형과 담당 업무를 대조하고 있습니다",
    prepEmotionLabel: temperature.label_ko ?? summary?.emotion.label_ko ?? "분석 중",
    prepEmotionSignal:
      temperature.signals.join(" · ") ||
      summary?.emotion.signals.join(" · ") ||
      "특이 감정 신호 없음",
    prepEmotionBars: emotionBars,
    prepRiskLabel: card ? RISK_LABELS[card.risk_level] : "분석 중",
    prepRiskSignal: card?.risk_factors.join(" · ") || "특이 사고 징후 없음",
    prepSummaryBullets,
    externalSessionKey: integrated.external_session_key,
    customerNameMasked: integrated.customer.full_name_masked,
    customerNumber: integrated.customer.customer_number,
    customerPhoneMasked: integrated.customer.phone_masked,
    inquiryLabel,
    wrapSummaryDefault: [
      `${integrated.customer.full_name_masked} 고객의 ${card?.summary ?? summary?.headline ?? "상담 내용"}.`,
      card?.customer_request ? `요청사항: ${card.customer_request}.` : "",
      card?.recommended_actions.length
        ? `권장 조치: ${card.recommended_actions.join(", ")}.`
        : "",
    ]
      .filter(Boolean)
      .join(" "),
    connectBg: allChecked ? "var(--blue-700)" : "var(--gray-200)",
    connectFg: allChecked ? "#fff" : "var(--gray-600)",
    connectCursor: allChecked ? "pointer" : "not-allowed",
    prepHint: allChecked
      ? "유의사항 확인 완료 · 통화를 연결하세요"
      : "유의사항 3개를 모두 확인하면 통화 연결이 활성화됩니다",
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
    authTime,
    authMethodLabel,
    authPlaceholder:
      authMethod === "birth"
        ? "생년월일 6자리 (YYMMDD)"
        : authMethod === "account"
        ? "계좌 뒷 4자리"
        : "연락처 뒷 4자리",
    // script + memo
    steps: CALL_SCRIPT.map((st) => ({ title: st.title, text: st.text })),
    memoItems,
    memoEmpty: memoItems.length === 0,
    memoDraft,
    onMemoDraft: (e: React.ChangeEvent<HTMLInputElement>) => setMemoDraft(e.target.value),
    onMemoKey,
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
    closeReg: () => setRegExpanded(false),
    regExpanded,
    regCollapsed: !regExpanded,
    regW: regExpanded ? 720 : 372,
    regFile: rg.file,
    regSheet: rg.sheet,
    regCols: rg.cols,
    regRows: rg.rows,
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
    recoFollowups: RECOMMENDED_FOLLOWUPS.map((f) => ({
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
