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
    "연결 대기 중입니다. 상담사 연결 전 문의하실 내용을 음성으로 말씀해 주세요. 언제든 상담사 연결을 요청하실 수 있어요.",
  confirm: "더 말씀하실 내용이 있으신가요?",
  prep: "상담사에게 우선 연결하고 있습니다.",
};
/* 유의사항은 콜 유형별 — 카드·스크립트·규정과 같은 사건을 말해야 한다.
   (구: 모든 콜에 동일한 고정 4개 → 주담대 콜에 '착오송금 반환 표현 금지'가 뜨는 자기모순)
   실서비스에선 상담카드+관련 규정에서 AI가 콜마다 생성하는 자리다. */
const PREP_LEN = 4;
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

  const [prepChecks, setPrepChecks] = useState<boolean[]>(Array(PREP_LEN).fill(false));
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
    const [summaryResult] = await Promise.allSettled([
      summarize({ chunks: transcript.current, text }),
    ]);
    if (summaryResult.status === "fulfilled") setSummary(summaryResult.value);
    // The standard mvp-1.0 fixture remains visible for the scripted demo.
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
    setPrepChecks(Array(PREP_LEN).fill(false));
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
  const incomingRef = useRef<IncomingKind>("normal");
  incomingRef.current = incoming;

  const startCall = useCallback(() => {
    clearAll();
    // 인입 유형에 맞는 상담카드 픽스처 선택 (데모)
    const kind = incomingRef.current;
    setConsultationResponse(
      kind === "urgent"
        ? (structuredClone(URGENT_RESPONSE) as unknown as ConsultationCardResponse)
        : kind === "transfer"
        ? (structuredClone(TRANSFER_RESPONSE) as unknown as ConsultationCardResponse)
        : getDemoConsultationCard()
    );
    // 후처리 프리셋도 콜 유형에 맞춰 채운다 — 상담 유형·결과·후속조치가 통화 내용과 어긋나지 않게
    const wrap = WRAP_DEFAULTS[kind];
    setWrapType(wrap.type);
    setWrapResult(wrap.result);
    setFollowups(wrap.followups);
    setTransferReserved(false);
    setEmoDrift(null);
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
      // 상담이 진행되며 고객이 진정되는 흐름 — 감정온도가 살아있는 신호임을 보여준다
      after(20000, () =>
        setEmoDrift({ score: 22, level: "stable", reason: "상담 진행 후 안정 — 응대 톤 유지" })
      );
    }
  }, [after, prepChecks]);

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
  }, [clearAll]);

  const endCall = useCallback(() => {
    if (phaseRef.current === "active") {
      clearAll();
      setPhase("summarizing");
      // 종료와 동시에 후처리 시트가 자동으로 올라온다 — 통화→후처리는 한 흐름
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
        transcript.current = [
          { text: response.transcript.text, at: 0, isFinal: true },
        ];
        setSummary(null);
        setPrepChecks(Array(PREP_LEN).fill(false));
        setPhase("prep");
      } catch (error) {
        const message = error instanceof Error ? error.message : "음성 처리에 실패했습니다.";
        setMicErr(message);
        setPhase("idle");
      } finally {
        setAudioBusy(false);
      }
    },
    [clearAll, startClock]
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
  const rg = renderSheet(manualData ?? SHEETS.manual);
  // 검색 필터 — r.n(원본 행 번호)은 유지되므로 '열기' 강조(regTargetRow)와 충돌하지 않는다
  const regNeedle = regSearch.trim().toLowerCase();
  const rgRows = regNeedle
    ? rg.rows.filter((r) => r.cells.some((c) => c.text.toLowerCase().includes(regNeedle)))
    : rg.rows;

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
  const prepDefinitions = PREP_ITEMS[incoming];
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
    scaledW: STAGE_W * scale + "px",
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
    },
    toggleTransferReserve: () =>
      setTransferReserved((v) => {
        if (v) setTransferTarget(null);
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
    prepHeadline: card.summary || summary?.headline || "상담카드 생성 중",
    // 문의유형은 배정권고 타일이 담당 — 여기 반복하지 않는다
    prepCustomerLine: `발신 ${CUSTOMER.phoneMasked} · 음성 접수`,
    prepRoutingTitle: card.department || "담당 부서 분석 중",
    prepRoutingReason: card.routing_reason || "문의 유형과 담당 업무를 대조하고 있습니다",
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
      card.routing_confidence != null
        ? `확신 ${Math.round(card.routing_confidence * 100)}% · 상담사 확인 전 후보`
        : "확신도 산출 전 · 상담사 확인 필요",
    transcriptQuote: consultationResponse.transcript.text,
    // AI가 발화에서 분해한 요구사항 — 이관 판단이 가능한 요약 본문
    summaryPoints: SUMMARY_POINTS[incoming],
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
    prepHint: allChecked
      ? "유의사항 확인 완료 · 통화를 연결하세요"
      : `유의사항 ${PREP_LEN}개를 모두 확인하면 통화 연결이 활성화됩니다`,
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
    // 마스킹 '구멍' 입력 — 실제 데이터 모양 속에 입력 칸만 뚫려 있다
    // phone: 010 - **** - [    ] / birth: [      ] (YYMMDD) / account: ***-**-[    ]
    authPrefix: authMethod === "birth" ? "" : authMethod === "account" ? "***-**-" : "010 - **** - ",
    authMaxLen: authMethod === "birth" ? 6 : 4,
    // 입력 칸 placeholder — '●●●●'는 마스킹(****)과 똑같아 보여 빈칸임을 알 수 없었다.
    // '무엇을 칠지'를 글자로 말한다 (생년월일은 형식이 정보라 YYMMDD 유지)
    authHolePlaceholder: authMethod === "birth" ? "YYMMDD" : "뒤 4자리",
    // 지금 물어야 할 값 — 안내 문구가 대조 방식을 따라간다
    authAskLabel:
      authMethod === "birth" ? "생년월일 6자리" : authMethod === "account" ? "계좌 뒤 4자리" : "연락처 뒤 4자리",
    // script + memo — 스크립트·규정은 콜 유형과 같은 사건을 말한다
    steps: SCRIPTS[incoming].map((st) => ({ title: st.title, text: st.text })),
    firstLine: SCRIPTS[incoming][0].text,
    regRecos: REG_RECOS[incoming],
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
      setRegTargetRow(row);
      setRegExpanded(true);
    },
    closeReg: () => {
      setRegExpanded(false);
      setRegTargetRow(null);
    },
    regTargetRow,
    regExpanded,
    regCollapsed: !regExpanded,
    // 실검색 — 입력은 자유, AI 추천 검색어는 placeholder로 강등
    regSearch,
    onRegSearch: (e: React.ChangeEvent<HTMLInputElement>) => setRegSearch(e.target.value),
    clearRegSearch: () => setRegSearch(""),
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
