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
  REG_SUGGEST,
  PREP_NEED_TAGS,
  ADMIN_QUEUE_POOL,
  type IncomingKind,
  type SheetData,
  type SheetRow,
  renderSheet,
  WRAP_TYPE_OPTIONS,
  WRAP_RESULT_OPTIONS,
  WRAP_DEFAULTS,
  type Followup,
} from "../data/demoContent";
import { piiVerify, piiAccounts, piiHistory } from "../services/pii";
import { addCallLog } from "../lib/callLog";
import { emotionLabel } from "../services/emotion";
import type { EmotionTemperatureLevel, IncidentRisk } from "../services/types";
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
  SNAPSHOT_BEAT_MS,
  SNAPSHOT_MAX_LINES,
  clearCallSnapshot,
  readCallSnapshot,
  writeCallSnapshot,
} from "../services/callSnapshot";
import {
  searchRegulations,
  fetchRegSuggests,
  fetchRegulationDocument,
  type RegulationDoc,
  categoryForDepartment,
  semanticSearchEnabled,
  type RegulationHit,
} from "../services/regulationSearch";
import { API_BASE_URL, useReal } from "../services/config";
import { postStageScale, subscribeStageScale } from "../services/stageScaleBus";
import {
  startLiveCall,
  type LiveHandle,
  type LiveSpeaker,
  type LiveTranscript,
} from "../services/liveCall";
import { resolveCallId, resolveExplicitCallId } from "../services/callId";
import { DEPT_UNKNOWN, normalizeDept } from "../data/taxonomy";
import { maskPii } from "../lib/maskPii";
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
// 유의사항 — 준비 카드 좌측. sub는 한 줄로 짧게(멘토 피드백: 길면 안 읽힌다).
const PREP_ITEMS: Record<IncomingKind, { title: string; sub: string }[]> = {
  normal: [
    { title: "본인확인 우선", sub: "완료 전 상세조회 잠금" },
    { title: "확정 표현 금지", sub: "심사 결과 전 단정 금지" },
    { title: "담당 부서 확인", sub: "요약·라우팅이 발화와 맞는지" },
  ],
  urgent: [
    { title: "본인확인 우선", sub: "확인 전 조치 보류" },
    { title: "사실관계 먼저", sub: "본인 신청 여부 확인 후 지급정지" },
    { title: "추가 피해 방지", sub: "통화 중 앱·링크 열지 않게" },
  ],
  transfer: [
    { title: "인증 상태 확인", sub: "인수인계에 완료면 재인증 생략" },
    { title: "인계 메모 확인", sub: "앞 안내 중복 금지" },
    { title: "확정 표현 금지", sub: "특약 확인 전 단정 금지" },
  ],
};

// 감정온도 연동 오프닝 멘트 — 온도 밴드(calm/warm/hot)에 따라 첫 문장이 달라진다.
// 낮으면 편하게, 주의면 공감+정확, 고조면 사과+안심 우선. 콜 유형별로 맥락을 실었다.
const OPENING: Record<IncomingKind, Record<"calm" | "warm" | "hot", string>> = {
  normal: {
    calm: "네, 고객님. 주택담보대출 만기 연장 건으로 연락 주셨네요. 필요한 내용 미리 확인해 두었으니 편하게 말씀해 주세요.",
    warm: "네, 고객님. 만기 연장 때문에 신경 쓰이셨죠. 제가 하나씩 정확히 확인해서 바로 안내해 드릴게요.",
    hot: "고객님, 기다리시게 해서 죄송합니다. 지금 바로 확인해서 빠르게 도와드리겠습니다.",
  },
  urgent: {
    calm: "네, 고객님. 접수하신 내용 확인했습니다. 침착하게 하나씩 같이 확인해 볼게요.",
    warm: "네, 고객님. 많이 걱정되셨죠. 제가 바로 확인해서 필요한 조치를 안내해 드리겠습니다.",
    hot: "고객님, 많이 놀라셨죠. 안심하세요. 지금 바로 지급정지부터 확인하고 끝까지 도와드리겠습니다.",
  },
  transfer: {
    calm: "네, 고객님. 앞선 상담 내용 전달받았습니다. 이어서 바로 안내해 드릴게요.",
    warm: "네, 고객님. 다시 설명하시게 해서 죄송해요. 앞 내용은 제가 확인했으니 이어서 도와드리겠습니다.",
    hot: "고객님, 여러 번 안내받으시느라 불편하셨죠. 제가 끝까지 책임지고 마무리해 드리겠습니다.",
  },
};

/** 통화(active) 로컬 데모 대화 — 상담원↔고객이 번갈아 말하는 스크립트.
 *  서버 없이도 양쪽 전사 패널에 실제 대화가 오가는 back-and-forth를 보여준다. */
const ACTIVE_DIALOGUE: { speaker: "agent" | "customer"; text: string }[] = [
  { speaker: "agent", text: "네 고객님, 주택담보대출 만기 연장 문의 주셨죠. 제가 바로 확인해 드릴게요." },
  { speaker: "customer", text: "네, 다음 달이 만기인데 연장이 가능할까요?" },
  { speaker: "agent", text: "먼저 본인 확인부터 도와드릴게요. 생년월일 여덟 자리 말씀해 주시겠어요?" },
  // 안내가 "여덟 자리"이므로 고객도 여덟 자리로 답한다(정답: CUSTOMER.authAnswers.birth).
  { speaker: "customer", text: "19990303입니다." },
  { speaker: "agent", text: "확인되었습니다. 재약정으로 만기 연장 가능하시고, 금리는 심사 후 안내드려요." },
  { speaker: "customer", text: "필요한 서류는 어떤 게 있나요?" },
  { speaker: "agent", text: "소득증빙과 등기부등본이 필요하고, 비대면으로도 제출하실 수 있어요." },
  { speaker: "customer", text: "아 네, 알겠습니다. 감사합니다." },
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
    title: "상담사의 유일한 산출물 = 후처리 결과 검증",
    points: [
      "통화 종료와 동시에 시트가 자동으로 올라옵니다. 통화 화면은 배경에 남아 방금 내용을 다시 볼 수 있습니다.",
      "왼쪽 상담 정보는 녹취·메모에서 자동으로 채워지고, 상담사는 필요한 것만 고칩니다(연필 아이콘). 오른쪽 후처리 결과도 클릭해 편집합니다.",
      "상담 유형·결과·후속조치는 이번 콜 유형에 맞춰 미리 채워집니다.",
    ],
    next: "'저장 후 다음 콜' 또는 상단 '초기화'로 처음부터 다시 볼 수 있어요.",
  },
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

/** 카드 생성 창 — 침묵이 끝나고 준비 카드가 날아오기까지 '카드 만드는 중'을 보여 주는 시간.
 *  0으로 두면(예전 동작) 카드가 즉시 떠서 '카드 생성' 단계가 한 번도 켜지지 않는다.
 *  실제 요약·분류가 쓰는 시간과 비슷한 눈금으로 잡는다 — 화면이 사실보다 빠른 척하지 않게. */
const CARD_BUILD_MS = 1200;

/** 단계 바에서 '후처리'로 건너뛸 때 표시할 통화 길이(초).
 *  후처리는 통화가 끝난 뒤의 화면이라 시계가 흐르면 안 된다 — 끝난 통화의 길이로 고정한다. */
const WRAP_JUMP_CALL_SEC = 187;

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
  const surface = config.surface ?? "full";
  const isCustomerSurface = surface === "phone";
  // 라이브 서버(실단말·중앙 call_id) 모드는 URL에 명시적 call_id가 있을 때만 켠다.
  // call_id가 없으면 프런트 단독 로컬 데모로 폴백한다 — 서버·마이크 연결 없이 스크립트로.
  const liveServerMode = EXPLICIT_LIVE_CALL_ID != null;
  const customerLiveMode = isCustomerSurface && liveServerMode;
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
  /** 고객이 먼저 끊었다 — 상담사 화면에서 자동 연결을 멈추고 '콜백 대상'으로 바꾼다 */
  const [customerEnded, setCustomerEnded] = useState(false);
  const [callStartedAt, setCallStartedAt] = useState("");
  const [emo, setEmo] = useState(0);
  const [silenceLeft, setSilenceLeft] = useState(0);
  const [micErr, setMicErr] = useState("");
  const [audioBusy, setAudioBusy] = useState(false);
  const [liveCaption, setLiveCaption] = useState("");
  const [liveCaptionSpeaker, setLiveCaptionSpeaker] =
    useState<LiveSpeaker>("customer");
  const [liveTranscriptLines, setLiveTranscriptLines] = useState<LiveTranscript[]>([]);
  /* 하트비트가 최신 전사를 읽는 통로 — state를 effect 의존성에 넣으면 말이 한 줄 늘 때마다
     5초 타이머가 리셋돼 칠판이 갱신되지 않는다(그러면 15초 뒤 스스로 상한다). */
  const linesRef = useRef<LiveTranscript[]>([]);
  linesRef.current = liveTranscriptLines;
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
  /** 카드 생성 창이 도는 중 — 접수 패널의 '카드 생성' 단계를 켜고, 끝나면 카드가 날아온다 */
  const [cardBuilding, setCardBuilding] = useState(false);
  const [arsDigits, setArsDigits] = useState("");
  const [dtmfEvents, setDtmfEvents] = useState<ArsDtmfEvent[]>([]);
  const [arsMobileConnected, setArsMobileConnected] = useState(false);
  const [mobileServerConnected, setMobileServerConnected] = useState(false);
  const [mobileIntakeComplete, setMobileIntakeComplete] = useState(false);
  const [mobileIntakePending, setMobileIntakePending] = useState(false);
  const [mobileAgentConnected, setMobileAgentConnected] = useState(false);

  const [prepChecks, setPrepChecks] = useState<boolean[]>(Array(PREP_LEN).fill(true));
  const [verified, setVerified] = useState(false);
  const [authMethod, setAuthMethod] = useState<AuthMethod>("birth");
  const [authInput, setAuthInput] = useState("");
  const [authErr, setAuthErr] = useState(false);
  const [authErrMsg, setAuthErrMsg] = useState("");
  const [authTime, setAuthTime] = useState("");
  const [authMethodLabel, setAuthMethodLabel] = useState("");
  // 개인정보 격리 서버(pii-service)에서 인증 성공 후 로드하는 계좌/이력
  const [piiAcc, setPiiAcc] = useState<SheetData | null>(null);
  const [piiHist, setPiiHist] = useState<SheetData | null>(null);

  const [memoItems, setMemoItems] = useState<string[]>([]);
  const [memoDraft, setMemoDraft] = useState("");
  const memoDraftRef = useRef("");
  memoDraftRef.current = memoDraft;

  const [dockType, setDockType] = useState<DockType | null>(null);
  const [regExpanded, setRegExpanded] = useState(false);
  // 규정집 실검색 — 비어 있으면 전체, 입력하면 조항·항목·내용·멘트를 훑는다
  const [regSearch, setRegSearch] = useState("");
  // 백엔드가 고른 추천 검색어 — RAG가 전사를 보고 관련 규정을 반환. 꺼져 있으면 null → 로컬 폴백
  const [backendRegSuggests, setBackendRegSuggests] = useState<{ term: string }[] | null>(null);
  // 검색 필터(엑셀 컬럼필터 감각) — 문서유형·부서(코드, null=카드 자동)·표만·시행일 이후
  const [regDocType, setRegDocType] = useState<string | null>(null);
  const [regDeptFilter, setRegDeptFilter] = useState<string | null>(null);
  const [regTableOnly, setRegTableOnly] = useState(false);
  const [regEffFrom, setRegEffFrom] = useState<string | null>(null);
  // 업로드한 실제 파일(CSV/XLSX)이 더미 시트를 대체한다 — 세션 동안 유지
  const [manualData, setManualData] = useState<SheetData | null>(null);
  // 규정집을 '열기'로 열면 해당 조항 행이 강조된다 (0-base 행 인덱스)
  const [regTargetRow, setRegTargetRow] = useState<number | null>(null);
  // 상담 가이드(EXAONE) — 단계별 스크립트. 비어 있으면 콜 유형 픽스처(SCRIPTS)로 폴백.
  const [guideSteps, setGuideSteps] = useState<{ title: string; text: string }[]>([]);
  // (summaryPending 는 위쪽 mingikim 상태 선언에서 이미 관리한다 — 중복 선언 방지)
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
  /* 통화 시계의 **원점**(epoch ms). 초를 +1씩 세지 않고 이 시각과의 차이로 계산한다.
     ① 탭이 백그라운드로 가면 setInterval이 느려져 +1 방식은 초가 밀린다.
     ② 다른 창에서 온 call.incoming의 startedAtMs로 원점을 맞추면, 창이 몇 개든
        '접수 경과'가 고객이 전화를 건 그 시각부터 같은 초를 찍는다. */
  const clockOrigin = useRef<number | null>(null);
  /* 내가 방금 건 전화 — 버스가 자기 탭에도 루프백하므로, 그걸 '남이 건 전화'로 오해해
     또 한 통을 시작하지 않게 한다. emit 안에서 동기적으로 배달되므로 이 플래그로 충분하다. */
  const selfStartRef = useRef(false);
  /* 다른 창의 전화에 합류하는 중 — 이때는 call.incoming을 다시 싣지 않는다.
     두 번 실리면 관제 보드에 같은 통화가 두 건으로 쌓인다. */
  const joiningRef = useRef(false);
  /** 이 통화를 내가 걸었나 — 칠판을 살려 두는 건 건 쪽 하나면 된다(합류한 창까지 적을 이유가 없다) */
  const ownsCallRef = useRef(false);
  /** 내가 방금 낸 종료 이벤트 — 버스 루프백을 '남이 끊었다'로 오해하지 않게 */
  const selfEndRef = useRef(false);
  const startCallRef = useRef<() => void>(() => undefined);
  const endCallRef = useRef<() => void>(() => undefined);
  const startClockRef = useRef<() => void>(() => undefined);
  const resetRef = useRef<() => void>(() => undefined);
  const silT = useRef<number | null>(null);
  /** 카드 생성 창 타이머 — 리셋 때 반드시 끊는다(안 끊으면 초기화한 뒤에 prep으로 튄다) */
  const buildT = useRef<number | null>(null);
  const silStage = useRef<null | "first" | "confirmPause" | "second">(null);
  // 임계 이상 레벨이 연속 몇 회 이어졌는지 — 순간 잡음과 실제 발화를 가른다.
  const loudRun = useRef(0);
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
  // 통화 시간 거울 — 종료 처리는 async 콜백에서 일어나 clock 상태가 오래된 값일 수 있다
  const clockRef = useRef(0);
  clockRef.current = clock;

  const rootRef = useRef<HTMLDivElement | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  // 창간 스케일 동기화: 폰이 직원 창에서 받은 배율(있으면 그대로 채택) · 직원이 마지막 방송한 배율
  const syncedScaleRef = useRef<number | null>(null);
  const lastPubScaleRef = useRef<number | null>(null);

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

  /* 다른 창이 건 통화의 시작 시각을 받아 내 시계 원점을 맞춘다.
     **듣기는 항상 shared 버스로 한다** — 고객 화면의 demoBus는 발행을 막은 스텁이라
     on이 없다(고객 창은 같은 발화를 두 번 싣지 않으려고 발행을 안 한다).
     버스는 자기 탭에도 루프백하므로 내가 보낸 것도 되돌아오는데, 값이 같아 아무 일도 안 난다.
     이미 세고 있던 중이라도 원점만 바꾸면 다음 tick(≤500ms)에 바로 따라잡는다. */
  useEffect(
    () =>
      sharedDemoBus.on("call.incoming", (p) => {
        /* **이미 내 통화가 돌고 있으면 내 시계가 정본이다.** 뒤늦게 도착한 원점을 받아들이면
           화면에서 초가 뒤로 튀는데, 그건 어떤 어긋남보다 나쁘다(관객이 바로 알아챈다).
           아직 원점이 없는 창(= 지금 이 통화에 합류하는 창)만 발신 시각을 따라간다. */
        if (typeof p.startedAtMs === "number" && clockOrigin.current == null) {
          clockOrigin.current = p.startedAtMs;
        }
        /* 고객이 전화를 걸면 직원 콘솔이 **스스로** 접수 화면으로 들어간다.
           발표자가 두 창을 각각 조작하지 않아도 한 통화로 붙는다.
           · 내가 건 전화(루프백)는 무시 · 이미 통화 중이면 무시
           · 고객 화면은 합류하지 않는다 — 전화를 거는 쪽이지 받는 쪽이 아니다 */
        if (selfStartRef.current || isCustomerSurface) return;
        /* 이미 통화 중인데 다른 창에서 새 통화가 시작됐다 — 시연에서 실제로 밟는 순서다
           (발표자가 테스트 콜을 먼저 누른 뒤 고객이 전화). 그대로 무시하면 두 화면이 서로
           **다른 통화**를 보여준다: 왼쪽은 고객의 새 통화, 오른쪽은 아까의 테스트 콜.
           데모에는 통화가 하나뿐이므로 **나중에 시작된 쪽이 진실**이다 — 접고 새로 붙는다. */
        if (phaseRef.current !== "idle") resetRef.current();
        joiningRef.current = true;
        clockOrigin.current = typeof p.startedAtMs === "number" ? p.startedAtMs : null;
        startCallRef.current();
        if (typeof p.startedAtMs === "number") clockOrigin.current = p.startedAtMs;
      }),
    []
  );

  /* 고객이 먼저 끊었다 — 상담사 화면이 그걸 모르면 시연에서 가장 나쁜 그림이 된다:
     왼쪽 폰은 종료 화면인데 오른쪽 콘솔은 계속 "통화 중"이고, 15초 카운트다운은 그대로
     흘러 **끊은 고객에게 자동 연결**된다.

     · 통화 중(active)이었으면 이쪽도 종료로 넘긴다 — 이미 끊긴 통화를 붙들고 있을 이유가 없다.
     · 아직 연결 전(접수·준비)이면 **카드는 남긴다.** 접수는 끝났고 담당자가 콜백할 건이라,
       카드를 지우면 그 사실까지 지워진다. 대신 자동 연결만 멈추고 '콜백 대상'으로 표시한다. */
  useEffect(
    () =>
      sharedDemoBus.on("call.ended", (p) => {
        if (isCustomerSurface) return; // 고객 창은 제 폰이 진실이다
        if (selfEndRef.current) return; // 내가 낸 종료(루프백)
        if (p.endedBy === "agent") return; // 상담사가 끊은 건 이 창이 이미 안다
        const ph = phaseRef.current;
        if (ph === "idle" || ph === "wrap" || ph === "summarizing") return;
        setCustomerEnded(true);
        if (ph === "active") endCallRef.current();
      }),
    [isCustomerSurface]
  );

  /* 통화 중인 창이 칠판을 살려 둔다 — 갱신이 멈추면 다른 창이 '끝난 통화'로 보고 무시한다.
     발신한 창(합류가 아닌 쪽)만 적는다: 두 창이 같은 칠판에 번갈아 적을 이유가 없다. */
  const inCallForBeat = phase !== "idle" && phase !== "wrap";
  useEffect(() => {
    if (!inCallForBeat || !ownsCallRef.current) return;
    const beat = () => {
      if (clockOrigin.current == null) return;
      writeCallSnapshot({
        callId: respRef.current.call_id,
        kind: incomingRef.current,
        startedAtMs: clockOrigin.current,
        phase: phaseRef.current,
        // 마스킹해서 담는다 — 원문은 저장소에 남기지 않는다(화면에 보이는 것과 같은 문장)
        lines: linesRef.current.slice(-SNAPSHOT_MAX_LINES).map((l) => ({
          seq: l.seq,
          text: maskPii(l.text),
          at: l.at,
          speaker: l.speaker,
        })),
      });
    };
    beat();
    const id = window.setInterval(beat, SNAPSHOT_BEAT_MS);
    return () => window.clearInterval(id);
    // 말이 한 줄 늘 때마다 즉시 다시 적는다 — 5초 주기만 믿으면 새로고침 직전에 온 말이
    // 칠판에 없어 복구했을 때 대화가 잘려 보인다(타이머는 다시 감기지만 비용은 없다)
  }, [inCallForBeat, liveTranscriptLines.length]);

  /* 창이 열릴 때 한 번 — 이미 돌고 있는 통화가 있으면 그 통화로 들어간다.
     버스(생방송)를 못 들은 창을 위한 보험이다: 새로고침하거나 시연 도중에 창을 새로 열어도
     대기 화면에 혼자 남지 않는다. 고객 화면은 전화를 거는 쪽이라 합류하지 않는다. */
  /* 고객 창 새로고침 복구 — **대본을 다시 돌리지 않는다.**
     startCall을 부르면 ARS 안내가 처음부터 다시 나가고(음성까지) 접수가 리셋된다.
     새로고침한 사람이 원하는 건 "하던 통화로 돌아가는 것"이지 새 통화가 아니다.
     그래서 되돌리는 건 **화면 상태와 시계뿐**이다: 폰이 다이얼이 아니라 통화 화면으로,
     경과 시간은 처음 걸었던 시각부터.
     지난 전사는 메모리에만 있어 돌아오지 않는다 — 지금부터의 말이 이어서 쌓인다. */
  useEffect(() => {
    if (!isCustomerSurface) return;
    const snap = readCallSnapshot();
    if (!snap) return;
    if (phaseRef.current !== "idle") return;
    const back = snap.phase;
    if (!back || !["recording", "confirm", "prep", "active"].includes(back)) return;
    clockOrigin.current = snap.startedAtMs;
    /* 칠판을 이어서 살려 둔다 — 복구한 창이 새 주인이다. 안 하면 갱신이 끊겨 15초 뒤
       칠판이 상하고, 그때부터는 아무도(자기 자신도) 이 통화로 못 돌아온다. */
    ownsCallRef.current = true;
    // 지난 대화도 되돌린다 — 빈 패널로 돌아오면 "통화가 처음부터 다시 시작됐다"로 읽힌다
    if (snap.lines?.length) {
      setLiveTranscriptLines(
        snap.lines.map((l) => ({ seq: l.seq, text: l.text, at: l.at, speaker: l.speaker as LiveSpeaker }))
      );
    }
    // connecting(안내 재생 중)으로는 돌리지 않는다 — 안내는 이미 지나갔다
    transitionPhase(back as Phase);
    startClockRef.current();
  }, [isCustomerSurface, transitionPhase]);

  useEffect(() => {
    if (isCustomerSurface) return;
    /* StrictMode(개발)는 마운트를 두 번 돌린다. "한 번만" 플래그로 막으면 **살아남는 쪽**이
       막혀 원점을 못 받는다(늦게 연 창이 몇 초 늦게 세던 원인). 그래서 막지 않고,
       몇 번 돌아도 같은 결과가 나오게 만든다 — 매번 joining으로 표시하고 원점을 못 박는다. */
    const snap = readCallSnapshot();
    if (!snap) return;
    if (phaseRef.current !== "idle") return;
    clockOrigin.current = snap.startedAtMs;
    joiningRef.current = true;
    startCallRef.current();
    // startCall이 전사를 비우므로 **그 뒤에** 지난 대화를 얹는다
    if (snap.lines?.length) {
      setLiveTranscriptLines(
        snap.lines.map((l) => ({ seq: l.seq, text: l.text, at: l.at, speaker: l.speaker as LiveSpeaker }))
      );
    }
    /* startCall이 안에서 무엇을 하든 **마지막에 원점을 못 박는다.** 시작 경로가 여러 갈래라
       중간에 지금 시각으로 덮이는 길이 남아 있었고(늦게 연 창이 몇 초 뒤부터 세는 증상),
       원점은 여기서 정하는 게 맞다 — 이 창은 남의 통화에 합류하는 중이다.
       다음 tick(≤500ms)에 화면이 따라온다. */
    clockOrigin.current = snap.startedAtMs;
    // 마운트 직후 한 번만 — 이후의 통화는 버스가 알려 준다
  }, [isCustomerSurface]);

  const startClock = useCallback(() => {
    if (clockT.current) return;
    if (clockOrigin.current == null) clockOrigin.current = Date.now();
    const tick = () => {
      const from = clockOrigin.current ?? Date.now();
      setClock(Math.max(0, Math.round((Date.now() - from) / 1000)));
    };
    tick();
    // 500ms로 도는 이유: 다른 창의 원점이 도착해 시계가 보정될 때 1초를 기다리지 않는다
    clockT.current = window.setInterval(tick, 500);
  }, []);
  startClockRef.current = startClock;

  /* 통화 중이면 시계는 **항상** 돈다.
     clearAll이 인터벌을 지우는 자리가 여러 곳이라(effect 정리·재시작 등), 시작 경로에서 한 번
     켜는 것만으로는 부족했다 — 실제로 늦게 합류한 창의 시계가 몇 초 만에 멈춰 그 값에 굳었다.
     상태에 걸어 두면 무엇이 지우든 다음 렌더에 되살아난다. */
  useEffect(() => {
    if (phase === "idle" || phase === "wrap") return;
    startClock();
  }, [phase, startClock]);


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
          businessCode: card.routing?.task_code ?? undefined,
          businessCodeLabel: card.routing?.task_name ?? null,
          department: card.department,
          routingReason: card.routing_reason,
          incidentRisk: card.incident_risk,
          riskReason: card.risk_reason,
          confidence: card.routing_confidence,
          emotionLevel: card.emotion.level,
          /* 관제도 상담사와 **같은 카드**를 그린다 — 그러려면 같은 재료가 가야 한다.
             여기서 안 보내면 관제 쪽은 자기만의 조판을 다시 만들 수밖에 없고, 그러면
             같은 통화가 두 화면에서 다르게 생기게 된다.

             verified는 카드가 만들어지는 시점에는 아직 모른다(본인인증은 연결 뒤에 일어난다).
             관제 피드가 routing.assigned로 따로 받아 두므로 여기서는 비운다 — 모르는 것을
             false로 채우면 "인증 실패"로 읽힌다. */
          transcriptQuote: groundedTranscript || null,
          summaryPoints: card.customer_requests ?? [],
          needTags: [...PREP_NEED_TAGS[incomingRef.current]],
          verified: null,
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
      // 뽑아낸 요구사항이 없으면 **빈 채로 둔다.** 예전엔 "고객 문의 내용을 다시 확인해
      // 주세요"로 자리를 채웠는데, 요약이 정상 생성된 뒤에도 같이 노출돼 "이 문구는 도대체
      // 왜?"(0724 시연, 박정운)를 불렀다. 없는 것은 없다고 보여주는 편이 낫다 —
      // headline이 이미 "발화가 없어 요약을 생성하지 않았다"고 말하고 있다.
      setLiveActionItems([]);
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
            // 발화가 없으면 부서도 없다. 예전엔 "일반상담팀"으로 자리를 채웠는데,
            // taxonomy에 없는 이름이라 규정 필터가 조용히 풀리는 경로였다(500ad1e 참고).
            department: DEPT_UNKNOWN,
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
      // 백엔드(k7-backend) 정본: 분석은 /analyze-text 하나로 통일. 이 엔드포인트가
      // consult_guide(EXAONE)를 통해 script_steps·follow_ups·result_label·references까지
      // 채워 응답한다(구 /api/live-stt/analyze는 k7-backend 라우터 구조에 없음).
      const response = await fetch(
        useLocalLiveAnalysis
          ? `${localApiBase}/analyze-text`
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
      // 관련 규정(RAG) — 준비 카드 유의사항의 근거. 백엔드가 부서 카테고리로 필터하고
      // 점수 하한을 넘긴 것만 보내므로 그대로 신뢰해 담는다. 없으면 GENERIC_CHECKS 폴백.
      setRagRefs(Array.isArray(data?.references) ? data.references : []);
      // 상담 가이드(EXAONE) — 스크립트가 실제 통화 내용을 따라간다. 4단계가 다 오면 교체,
      // 아니면(생성 실패) 콜 유형 픽스처(SCRIPTS) 유지 — 화면이 깨지지 않는 폴백 원칙.
      const guideStepsNext = (Array.isArray(data?.script_steps) ? data.script_steps : [])
        .filter((s: unknown): s is { title: string; text: string } =>
          !!s &&
          typeof (s as { title?: unknown }).title === "string" &&
          typeof (s as { text?: unknown }).text === "string")
        .slice(0, 4);
      if (guideStepsNext.length === 4) setGuideSteps(guideStepsNext);
      if (typeof data?.result_label === "string" && data.result_label.trim())
        setWrapResult(data.result_label.trim());
      const emotionAvailable =
        data?.emotion?.status === "completed" &&
        typeof data?.emotion?.score === "number";
      const emotionScore = emotionAvailable ? Number(data.emotion.score) : 0;
      const emotionLevel =
        emotionScore >= 70 ? "elevated" : emotionScore >= 40 ? "caution" : "stable";
      const highRisk = Number(data?.urgency_score ?? 0) >= 60;
      // 백엔드가 준 이름을 taxonomy 라벨로 정규화한다. 모르는 이름이면 지어내지 않고
      // '미분류'로 둔다 — 가짜 부서명이 붙으면 규정 필터가 조용히 풀린다.
      const department =
        normalizeDept(data?.routing?.department) ??
        normalizeDept(data?.category) ??
        DEPT_UNKNOWN;
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
    // 최신 준비 카드는 체크박스 없이 유의사항을 한 번에 제시한다.
    // 연결 게이트는 체크 동작 대신 실제 요약 완료 여부로만 제어한다.
    setPrepChecks(Array(PREP_LEN).fill(true));
    // 요약·분류는 지금 바로 시작한다(아래 카드 생성 창과 병렬로 돈다)
    void runSummary({ forceLive, scope: "intake" }).then((completed) => {
      if (completed) {
        emitCardPipeline(forceLive ? "backend" : "demo", forceLive ? 250 : 700, {
          persist: !forceLive,
        });
      }
    });
    // 카드 생성 창 — 접수 패널의 '카드 생성' 단계를 실제로 보여주는 시간.
    // 예전엔 침묵이 끝나자마자 prep으로 넘어가 패널이 그 순간 사라졌고, 그래서 '카드 생성'
    // 단계가 한 번도 켜지지 않았다(카드 생성이 0초로 보였다). 실제 시스템은 요약·분류에
    // 시간을 쓰므로 그 시간을 눈에 보이게 둔다 — 화면이 사실보다 빠른 척하면 시연에서
    // "이게 진짜 도는 건가"라는 의심을 부른다. 이 창이 끝나면 카드가 날아온다.
    setCardBuilding(true);
    if (buildT.current) clearTimeout(buildT.current);
    buildT.current = window.setTimeout(() => {
      buildT.current = null;
      setCardBuilding(false);
      transitionPhase("prep");
    }, CARD_BUILD_MS);
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
    // 대본 데모의 전사 소스 — 실통화는 위의 realCallActive 분기가 서버 STT를 구독한다.
    stt.current = startSttSession(
      {
        onChunk: (c) => {
          const chunk: SpeakerTranscriptChunk = {
            ...c,
            speaker: "customer",
            seq: transcript.current.length + 1,
          };
          transcript.current.push(chunk);
          // 로컬(서버 없음) 데모 — 전사 패널이 liveTranscriptLines를 직접 읽으므로
          // demoBus뿐 아니라 여기도 채워 고객 화면 전사가 스크립트로 흐르게 한다.
          setLiveTranscriptLines((lines) =>
            [...lines, { seq: chunk.seq, text: c.text, at: c.at, speaker: "customer" as const, generation: 0, audioSeq: chunk.seq }].slice(-30)
          );
          setLiveCaption(c.text);
          setLiveCaptionSpeaker("customer");
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
    ownsCallRef.current = !joiningRef.current;
    /* 원점은 **알리기 전에** 정한다. 예전엔 emit 뒤에 정해서, 전에 다른 창이 흘린 시작 시각이
       남아 있으면 그 낡은 값을 '내 통화 시작'이라고 실어 보냈다 —
       받는 쪽은 9초 전에 시작한 통화로 알아듣는다(실측으로 잡힌 증상). */
    if (!joiningRef.current) clockOrigin.current = Date.now();
    setCustomerEnded(false);
    selfStartRef.current = true;
    window.setTimeout(() => {
      selfStartRef.current = false;
    }, 0);
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
    /* 통화 시작만은 **고객 화면도 발행한다**(shared 버스). 고객이 전화를 거는 순간
       직원 콘솔이 스스로 접수 화면으로 들어가야 두 창이 한 통화가 된다.
       발화·파이프라인은 여전히 상담사 쪽만 싣는다 — 같은 전사가 두 번 실리는 걸 막는 규칙은
       그대로다. 여기서 나가는 건 "언제 시작했다" 한 줄뿐이다.
       합류로 시작한 경우(joiningRef)는 싣지 않는다 — 이미 남이 실은 통화다. */
    if (!joiningRef.current) {
      sharedDemoBus.emit("call.incoming", {
        callId: resp.call_id,
        kind,
        // 다른 창의 접수 경과가 이 시각부터 세어진다
        startedAtMs: clockOrigin.current ?? Date.now(),
        ...(callGenerationRef.current > 0
          ? { generation: callGenerationRef.current }
          : {}),
      });
      writeCallSnapshot({
        callId: resp.call_id,
        kind,
        startedAtMs: clockOrigin.current ?? Date.now(),
        phase: "connecting",
      });
    }
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
    setPrepChecks(Array(PREP_LEN).fill(false));
    setSummary(null);
    setVerified(false);
    // 초기값(birth)과 같게 되돌린다 — 예전엔 "phone"으로 떨어져 리셋 후에는
    // 안내는 "생년월일 8자리"인데 칸은 4개가 되는 어긋남이 났다.
    setAuthMethod("birth");
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
    setRagRefs([]); // 지난 통화의 규정이 다음 통화 유의사항에 남지 않게
    setGuideSteps([]); // 지난 통화의 스크립트도 마찬가지 — 픽스처로 시작해 분석 도착 시 교체
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
    joiningRef.current = false;
  }, [after, beginRecording, clearAll, startClock, transitionPhase]);

  startCallRef.current = startCall;

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
      /* 다른 창에 "상담사가 받았다"를 알린다 — 고객 창은 이 신호로 대화 인계 연출을 시작한다.
         두 창이 같은 순간에 움직여야 "말이 저쪽으로 건너갔다"로 읽힌다. */
      demoBus.emit("agent.connected", { callId: respRef.current.call_id });
      // 로컬 데모 — 통화 연결 후 고객↔상담원 대화를 스크립트로 재생.
      // 양쪽 전사 패널(liveTranscriptLines·demoBus)에 화자가 번갈아 표시된다.
      let td = 1100;
      ACTIVE_DIALOGUE.forEach((turn) => {
        after(td, () => {
          const at = Date.now();
          const seq = transcript.current.length + 1;
          transcript.current.push({ text: turn.text, at, isFinal: true, speaker: turn.speaker, seq });
          setLiveTranscriptLines((lines) =>
            [...lines, { seq, text: turn.text, at, speaker: turn.speaker, generation: 0, audioSeq: seq }].slice(-40)
          );
          setLiveCaption(turn.text);
          setLiveCaptionSpeaker(turn.speaker);
          demoBus.emit("stt.utterance", { callId: respRef.current.call_id, text: turn.text, isFinal: true, atMs: at, speaker: turn.speaker });
        });
        td += Math.max(2600, turn.text.length * 85);
      });
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
    // 카드 생성 창을 끊는다 — 안 끊으면 초기화한 뒤에 예약된 타이머가 prep으로 튄다
    if (buildT.current) {
      clearTimeout(buildT.current);
      buildT.current = null;
    }
    setCardBuilding(false);
    clearAll();
    transcript.current = [];
    summaryText.current = "";
    demoBus.emit("demo.reset", {});
    transitionPhase("idle");
    clockOrigin.current = null;
    ownsCallRef.current = false;
    clearCallSnapshot();
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
    setRagRefs([]);
    setGuideSteps([]);
    const demo = getDemoConsultationCard();
    demo.call_id = LIVE_CALL_ID;
    setConsultationResponse(demo);
    respRef.current = demo;
    setPrepChecks(Array(PREP_LEN).fill(false));
    setVerified(false);
    // 초기값(birth)과 같게 되돌린다 — 예전엔 "phone"으로 떨어져 리셋 후에는
    // 안내는 "생년월일 8자리"인데 칸은 4개가 되는 어긋남이 났다.
    setAuthMethod("birth");
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
    setRagRefs([]);
    setGuideSteps([]);
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
            clockOrigin.current = null;
            ownsCallRef.current = false;
            clearCallSnapshot();
            setClock(0);
            setMobileIntakePending(false);
            setMobileIntakeComplete(false);
            setMobileAgentConnected(false);
            selfEndRef.current = true;
            window.setTimeout(() => {
              selfEndRef.current = false;
            }, 0);
            sharedDemoBus.emit("call.ended", {
              callId: LIVE_CALL_ID,
              ...(generation ? { generation } : {}),
              endReason: event.endReason,
              endedBy: event.endedBy ?? (isCustomerSurface ? "customer" : "agent"),
            });
            return;
          }

          const endedBeforeAgent = ["connecting", "recording", "confirm", "prep"].includes(
            currentPhase
          );
          const finals = transcript.current.filter(
            (chunk) => chunk.isFinal && chunk.text.trim().length > 0
          );
          const hasTranscript = finals.length > 0;
          // 후처리 진입 게이트 — "상담사와 실제로 말이 오간 콜"에만 후처리를 연다.
          //   진입 = 상담사 연결됨(active) + 상담사·고객 양쪽 발화 최소 1턴 + 종료 이벤트
          // ARS 접수만 하고 끊은 콜은 녹취가 있어도 '상담'이 아니다 → 후처리를 열지 않는다.
          // 화자 라벨이 없는 라이브 STT는 라벨 대신 발화 존재로 판단한다 — 라벨을 못 받는다는
          // 이유로 정상 상담의 후처리가 막히면 그게 더 큰 사고다.
          const labeled = finals.filter((c) => c.speaker);
          const hadConversation = labeled.length
            ? labeled.some((c) => c.speaker === "agent") &&
              labeled.some((c) => c.speaker === "customer")
            : hasTranscript;
          const agentConnected = currentPhase === "active";
          const customerEnded =
            event.endedBy === "customer" ||
            event.endReason === "customer_hangup" ||
            event.endReason === "customer_disconnect" ||
            (!event.endedBy && !event.endReason && !endRequested.current);
          // 미상담 종료 — 상담사와 말이 오가기 전에 끊긴 콜. 후처리를 열지 않고 내역에만 남긴다.
          // (전에는 ARS 녹취만 있어도 후처리가 열려 "종료 안 했는데 넘어왔다"는 신고가 나왔다)
          if (!agentConnected || !hadConversation) {
            // A LAN counselor event must close the admin record explicitly;
            // counselor demo.reset is intentionally not relay-authorized.
            selfEndRef.current = true;
            window.setTimeout(() => {
              selfEndRef.current = false;
            }, 0);
            sharedDemoBus.emit("call.ended", {
              callId: LIVE_CALL_ID,
              ...(generation ? { generation } : {}),
              endReason: event.endReason ?? "ended_before_transcript",
              endedBy: event.endedBy ?? (isCustomerSurface ? "customer" : "agent"),
            });
            // 대기(idle) 같은 비통화 상태에서 들어온 종료 이벤트는 콜이 아니므로 남기지 않는다
            if (endedBeforeAgent || agentConnected) {
              addCallLog({
                type: wrapRef.current.type,
                status: "미상담 종료",
                talk: fmt(clockRef.current),
                result: customerEnded ? "고객 종료 · 상담 없음" : "상담 전 종료",
              });
            }
            realCallActiveRef.current = false;
            reset();
            return;
          }
          if (agentConnected) {
            clearAll();
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
                detail: "고객·상담원 전체 대화 후처리 결과",
              });
              selfEndRef.current = true;
            window.setTimeout(() => {
              selfEndRef.current = false;
            }, 0);
            sharedDemoBus.emit("call.ended", {
                callId: LIVE_CALL_ID,
                wrapType: wrapRef.current.type,
                wrapResult: wrapRef.current.result,
                ...(generation ? { generation } : {}),
                endReason: event.endReason,
                endedBy: event.endedBy ?? (isCustomerSurface ? "customer" : "agent"),
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
      // 로컬 데모(서버 없음): 서버로 보낼 채널이 없으니 입력을 화면에만 반영한다. 예전엔 그냥
      // return true 했는데, 그러면 눌러도 입력창에 아무것도 안 떠서 '안 눌리는' 것처럼 보였다.
      // (실서버 모드에선 서버 onDigit 이벤트가 arsDigits를 채우므로 여기서 건드리지 않는다.)
      if (!customerLiveMode) {
        setArsDigits((value) => (value + digit).slice(-24));
        return true;
      }
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
    [customerLiveMode, mobileAgentConnected, mobileIntakeComplete]
  );

  useEffect(() => {
    if (isCustomerSurface) return;
    // call_id 없음 = 프런트 단독 로컬 데모(서버 배너 없이). 실서버는 명시 call_id일 때만.
    if (!EXPLICIT_LIVE_CALL_ID) return;
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
    // call_id 없음 = 프런트 단독 로컬 데모. 서버 연결·배너 없이 스크립트로 돈다.
    if (!EXPLICIT_LIVE_CALL_ID) return;
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
      setRagRefs([]);
      setGuideSteps([]);
      setTransferReserved(false);
      setEmoDrift(null);
      setMicErr("");
      setEmo(0);
      setSilenceLeft(0);
      setVerified(false);
      setAuthInput("");
      if (n === 2) {
        startClock();
        setPrepChecks(Array(PREP_LEN).fill(true));
        setWrapSheetOpen(false);
        setPhase("prep");
      } else if (n === 3) {
        startClock();
        setPrepChecks(Array(PREP_LEN).fill(true)); // 유의사항 확인을 거친 상태로 진입
        setWrapSheetOpen(false);
        setPhase("active");
      } else {
        // 후처리는 '통화가 끝난 뒤'에만 존재하는 화면이다. 여기로 건너뛸 때 시계를 계속
        // 돌리면 통화가 아직 붙어 있는 것처럼 보인다(01:02가 흘러감) — 실제로는 끝난 상태다.
        // 그래서 시계를 멈추고 끝난 통화의 길이로 고정한다(clearAll이 이미 인터벌을 껐다).
        setClock(WRAP_JUMP_CALL_SEC);
        setPrepChecks(Array(PREP_LEN).fill(true));
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
    // 통화 중이면 종료 화면(wrap→고객 폰은 SMS)으로. 아직 연결 전(connecting/idle)이면 reset.
    // active만 허용하면 통화 대부분을 'recording'에서 보내는 폰이 끊을 때 다이얼로 리셋돼
    // 종료 화면이 안 뜬다 → 이미 말이 오가는 recording/confirm도 통화 중으로 본다(합본 화면 포함).
    // prep(상담사 준비)은 고객 쪽에선 통화가 붙어 있는 상태라 고객 surface에서만 통화 중.
    const p = phaseRef.current;
    const inCallNow =
      p === "active" ||
      p === "recording" ||
      p === "confirm" ||
      (isCustomerSurface && p === "prep");
    if (!inCallNow) {
      reset();
      return;
    }
    finishCallAfterDrain({ finalSeq: 0, drained: true }, false);
  }, [finishCallAfterDrain, isCustomerSurface, reset]);

  endCallRef.current = endCall;
  resetRef.current = reset;

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
      clockOrigin.current = Date.now();
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
        setSummaryPending(false);
        setPrepChecks(Array(PREP_LEN).fill(true));
        setPhase("prep");
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
      const max = authMethod === "birth" ? 8 : 4;
      setAuthInput(e.target.value.replace(/\D/g, "").slice(0, max));
      setAuthErr(false);
    },
    [authMethod]
  );
  const runVerify = useCallback(async () => {
    const need = authMethod === "birth" ? 8 : 4;
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
  /* 자릿수가 다 차면 스스로 대조한다.
     화면에는 늘 "빈칸에 입력하면 **자동 대조**됩니다"라고 적혀 있었는데 실제로는 대조 버튼을
     눌러야 했다 — 안내와 동작이 어긋나면 상담사는 안내를 믿지 않게 된다. 마지막 자리를
     치는 순간이 곧 "다 말했다"는 신호이므로, 여기가 대조의 자연스러운 자리다.
     같은 값으로 두 번 조회하지 않도록 직전에 대조한 값을 기억한다(불일치 후 그대로 둬도
     매 렌더마다 재시도하지 않는다). 지우고 다시 치면 값이 달라지므로 다시 대조된다. */
  const lastTried = useRef("");
  useEffect(() => {
    if (verified) return;
    const need = authMethod === "birth" ? 8 : 4;
    const digits = authInput.replace(/\D/g, "");
    if (digits.length < need) {
      lastTried.current = ""; // 지우는 중 — 다시 채우면 대조할 수 있어야 한다
      return;
    }
    const key = authMethod + ":" + digits;
    if (lastTried.current === key) return;
    lastTried.current = key;
    void runVerify();
  }, [authInput, authMethod, verified, runVerify]);
  const resetAuth = useCallback(() => {
    setVerified(false);
    setAuthInput("");
    setAuthErr(false);
    lastTried.current = "";
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
    const own = Math.min(maxScale, avail / stageW, scH);
    // 직원 창은 자기 배율을 방송(바뀔 때만) — 폰 창이 같은 물리 크기로 맞추도록.
    if (surface === "desktop" && own !== lastPubScaleRef.current) {
      lastPubScaleRef.current = own;
      postStageScale({ t: "scale", scale: own });
    }
    // 폰 창은 직원 배율에 맞추되(폰트·크기 일치), 자기 창을 넘지 않게 캡(잘림 방지).
    // → 폰을 직원만큼 키우려면 고객 창을 넓히면 own이 커지며 직원 배율까지 따라간다.
    const sc =
      surface === "phone" && syncedScaleRef.current != null
        ? Math.min(syncedScaleRef.current, own)
        : own;
    setScale((prev) => (prev !== sc ? sc : prev));
    setNatH((prev) => (prev !== h ? h : prev));
  }, [stageW, maxScale, fitPad, fitHeight, surface]);

  useEffect(() => {
    const onResize = () => fit();
    window.addEventListener("resize", onResize);
    const raf = requestAnimationFrame(fit);
    return () => {
      window.removeEventListener("resize", onResize);
      cancelAnimationFrame(raf);
    };
  }, [fit]);

  // 창간 스케일 동기화 — 폰: 직원 배율 수신 시 그대로 채택 + 초기 요청 / 직원: 요청 오면 현재 배율 재방송.
  useEffect(() => {
    if (surface === "phone") {
      const unsub = subscribeStageScale((m) => {
        if (m.t === "scale") {
          syncedScaleRef.current = m.scale;
          fit();
        }
      });
      postStageScale({ t: "req" }); // 직원 창이 이미 떠 있으면 현재 배율을 즉시 받기
      return unsub;
    }
    if (surface === "desktop") {
      return subscribeStageScale((m) => {
        if (m.t === "req" && lastPubScaleRef.current != null) {
          postStageScale({ t: "scale", scale: lastPubScaleRef.current });
        }
      });
    }
  }, [surface, fit]);

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
          // 부서 필터 수동 선택이 있으면 우선, 없으면 카드 부서로 자동
          category:
            regDeptFilter ??
            categoryForDepartment(consultationResponse.consultation_card.department),
          docType: regDocType,
          kind: regTableOnly ? "table" : null,
          effectiveFrom: regEffFrom,
          k: 10,
          signal: ctrl.signal,
        });
        setSemHits(res.available ? res.documents : []);
        setSemLoading(false);
      } catch (err) {
        /* 연타로 취소된 것(AbortError)은 다음 요청이 이어받으므로 로딩을 유지한다.
           다만 **타임아웃(TimeoutError)은 이어받을 요청이 없다** — 여기서 안 풀면
           스피너가 영원히 돈다(백엔드 주소가 틀렸을 때 실제로 그랬다). */
        const aborted = err instanceof DOMException && err.name === "AbortError";
        if (!aborted) {
          setSemHits([]);
          setSemLoading(false);
        }
      }
    }, 250);
    return () => {
      ctrl.abort();
      window.clearTimeout(t);
    };
  }, [regSearch, consultationResponse, regDocType, regDeptFilter, regTableOnly, regEffFrom]);

  // 추천 검색어 = 백엔드 결정. 통화 전사가 쌓이면 RAG에 흘려 '관련 규정'을 받아 알약으로 띄운다.
  // 어떤 용어를 보여줄지는 프런트가 정하지 않는다 — 백엔드가 꺼져 있으면 null로 두고 로컬 매칭이 폴백.
  const liveTranscriptText = liveTranscriptLines.map((l) => l.text).join(" ");
  useEffect(() => {
    const spoken = (liveTranscriptText + " " + liveCaption).trim();
    if (!semanticSearchEnabled || spoken.length < 6) {
      setBackendRegSuggests(null);
      return;
    }
    const ctrl = new AbortController();
    const t = window.setTimeout(async () => {
      const hits = await fetchRegSuggests(spoken, {
        category: categoryForDepartment(consultationResponse.consultation_card.department),
        signal: ctrl.signal,
      });
      // null(백엔드 off/실패)이면 상태를 건드리지 않고 로컬 폴백에 맡긴다
      if (hits) setBackendRegSuggests(hits.map((h) => ({ term: h.term })));
    }, 600);
    return () => {
      ctrl.abort();
      window.clearTimeout(t);
    };
  }, [liveTranscriptText, liveCaption, consultationResponse]);

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
  const contractBullets = [
    ...card.customer_requests,
    ...card.missing_information.map((item) => `추가 확인 필요: ${item}`),
    card.routing_reason,
    card.risk_reason,
  ].filter(
    (value): value is string => !!value
  );
  const prepSummaryBullets = (contractBullets.length
    ? contractBullets
    : summary?.bullets ?? ["고객 발화를 분석하고 있습니다."]
  ).slice(0, 4);
  // 실통화(백엔드)면 카드가 만들어 준 유의사항을 그대로 쓰고, 대본 데모면
  // 콜 유형별로 준비된 4개(PREP_ITEMS)를 쓴다 — 폴백이 '생성 실패' 문구가 아니라
  // 콜 유형에 맞는 실제 문구여야 무대가 끊기지 않는다.
  const prepDefinitions = card.required_actions.length
    ? card.required_actions.map((item) => ({
        title: item.title,
        sub: `${item.detail} · 근거: ${
          item.source === "policy" ? "안전 규칙" : item.source === "rag" ? "관련 자료" : "AI 분석"
        }`,
      }))
    : PREP_ITEMS[incoming];
  const emotionBars = temperature.score == null
    ? 0
    : temperature.score > 66
      ? 3
      : temperature.score > 33
        ? 2
        : 1;
  // 감정온도 = 당근 매너온도식. 36.5를 기준(평온)으로, 격앙될수록 위로 오른다.
  // 0~100 감정강도 → 36.5~41.0°C. 밴드: ~37.4 평온(초록) · ~39.0 주의(노랑) · 그 위 고조(빨강).
  const EMO_BASE = 36.5;
  const tempC =
    temperature.score == null
      ? null
      : Math.round((EMO_BASE + Math.min(100, Math.max(0, temperature.score)) * 0.045) * 10) / 10;
  const emoBand: "calm" | "warm" | "hot" =
    tempC == null ? "warm" : tempC <= 37.4 ? "calm" : tempC <= 39.0 ? "warm" : "hot";
  const EMO_BAND_META = {
    calm: { label: "안정", fg: "var(--green-900)", bar: "var(--green-700)" },
    warm: { label: "주의", fg: "var(--amber-900)", bar: "var(--amber-700)" },
    hot: { label: "고조", fg: "var(--red-900)", bar: "var(--red-700)" },
  } as const;
  const emoMeta = EMO_BAND_META[emoBand];
  // 게이지 눈금 — 35.5~41.0°C 창에서 현재 온도 위치(%)와 36.5 기준점 위치(%)
  const TEMP_MIN = 35.5;
  const TEMP_MAX = 41.0;
  const tempPct =
    tempC == null ? 0 : Math.max(0, Math.min(100, ((tempC - TEMP_MIN) / (TEMP_MAX - TEMP_MIN)) * 100));
  const basePct = ((EMO_BASE - TEMP_MIN) / (TEMP_MAX - TEMP_MIN)) * 100;
  // 감정온도에 맞춘 오프닝 멘트 — 온도가 높으면 사과·안심 우선으로 첫 문장이 바뀐다.
  const adaptiveOpening = OPENING[incoming][emoBand];
  const riskSignals = [card.risk_reason].filter((value): value is string => !!value);
  const firstLine = EXPLICIT_LIVE_CALL_ID
    ? explicitSummaryPending || groundedTranscript.length === 0
      ? "안녕하세요. 문의하실 내용을 다시 한 번 말씀해 주시겠어요?"
      : card.business_type
      ? `안녕하세요. ${card.business_type} 문의로 확인했습니다. 본인확인 후 자세히 도와드리겠습니다.`
      : "안녕하세요. 말씀해 주신 문의 내용을 확인했습니다. 본인확인 후 자세히 도와드리겠습니다."
    : adaptiveOpening;
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
  const ragSheet = card.knowledge_references.length
    ? {
        file: "K7_로컬_지식베이스",
        sheet: "검색 근거",
        cols: [
          { l: "문서", w: 220 },
          { l: "구간", w: 180 },
          { l: "근거 내용", w: 430 },
          { l: "관련도", w: 80 },
        ],
        // SheetRow로 못박는다 — 규정 시트와 같은 행 모델이라야 사고 방지 표식이 이 경로에서도 산다
        rows: card.knowledge_references.map((reference, index): SheetRow => ({
          n: index + 1,
          cells: [
            { text: reference.title, w: 220 },
            { text: reference.section, w: 180 },
            { text: reference.excerpt, w: 430 },
            { text: `${Math.round(reference.score * 100)}%`, w: 80 },
          ],
        })),
      }
    : rg;
  const activeRegRows = card.knowledge_references.length
    ? regNeedle
      ? ragSheet.rows.filter((row) =>
          row.cells.some((cell) => cell.text.toLowerCase().includes(regNeedle))
        )
      : ragSheet.rows
    : rgRows;
  const actualSummaryPoints = card.customer_requests.length
    ? card.customer_requests
    : SUMMARY_POINTS[incoming];
  // 상담 스크립트는 '상담원이 실제로 읽는 대본(verbatim 멘트)'이어야 한다 — 할 일(required_actions)은
  // 유의사항 칩으로 이미 보여주므로, 스크립트에는 콜 유형별 실제 멘트를 그대로 쓴다.
  // 첫 스텝(오프닝)은 감정온도 밴드에 맞춘 문장으로 교체 — '이 문장으로 여세요'와 일치시킨다.
  const actualCallSteps = SCRIPTS[incoming].map((step, i) => ({
    title: step.title,
    text: i === 0 ? adaptiveOpening : step.text,
  }));

  // 후처리 결과 본문 기본값 — 화면(wrapSummaryDefault)과 저장(saveWrap)이 같은 문장을 써야 하므로
  // 한 곳에서 만든다. 상담사가 직접 고쳤다면 summaryText.current가 이걸 대신한다.
  // 여기서 한 번 가린다 — 렌더가 아니라 **소스**에서. 후처리 초안은 상담사가 고쳐 쓰는
  // contentEditable이라 그리는 쪽에서 가리면 별표가 저장 본문에 섞인다. 소스에서 가리면
  // 화면·저장·복사가 같은(가려진) 문장을 쓴다 — 원문 PII가 DB로 새지 않는다.
  const wrapSummaryText = maskPii(
    [
      // '다시 생성'을 누르면 다른 문형으로 재작성된다 (데모: 템플릿 순환)
      // v0 = 카드 요약 원문. 이미 "고객이…"로 시작하므로 접두사를 붙이면 "고객의 고객이" 중복이 된다
      summaryVersion % 2 === 0
        ? `${card.summary ?? summary?.headline ?? "상담 내용을 요약했습니다."}`
        : `${SUMMARY_PROSE[incoming]}`,
      `업무유형: ${card.business_type}.`,
      `전달부서: ${card.department}.`,
    ]
      .filter(Boolean)
      .join(" ")
  );

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
    /** 원본 phase — 고객 폰의 AI 안내 스크립트가 단계별로 말할 줄을 고르는 데 쓴다.
     *  화면용 라벨(phaseLabel)과 달리 상태 그 자체라 분기 조건에 안전하게 쓸 수 있다. */
    phase: p,
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
    reset: requestReset,
    /**
     * 시연 현장 진단 스냅샷 (DiagPanel이 주기적으로 읽는다).
     *
     * F2(마이크 미해제)·F4(메모 미동작)는 로컬 데모로 재현되지 않는다 — 실제 백엔드 통화에서
     * 무슨 값이 어떻게 흐르는지 봐야 잡힌다. 그래서 판단에 필요한 원시 상태를 그대로 노출한다.
     * ref에서 읽으므로 호출 시점의 진짜 값이다(렌더 시점의 오래된 state가 아니라).
     */
    diagSnapshot: () => {
      const finals = transcript.current.filter(
        (c) => c.isFinal && c.text.trim().length > 0
      );
      const labeled = finals.filter((c) => c.speaker);
      const hasAgent = labeled.some((c) => c.speaker === "agent");
      const hasCustomer = labeled.some((c) => c.speaker === "customer");
      const agentConnected = phaseRef.current === "active";
      // 라벨이 없으면 발화 존재로 대체 판단 — finishCallAfterDrain의 게이트와 같은 규칙
      const hadConversation = labeled.length ? hasAgent && hasCustomer : finals.length > 0;
      return {
        phase: phaseRef.current,
        clock: fmt(clockRef.current),
        liveCall: realCallActiveRef.current,
        transcriptFinals: finals.length,
        labeledChunks: labeled.length,
        hasAgent,
        hasCustomer,
        memoCount: memoItems.length,
        lastMemo: memoItems.length ? memoItems[memoItems.length - 1] : "",
        // 후처리가 열릴지 미리 보여준다 — "왜 후처리가 안 떴나"를 현장에서 바로 답할 수 있게
        wrapGate: { agentConnected, hadConversation, willOpen: agentConnected && hadConversation },
        businessCode: card.routing?.task_code ?? null,
        businessName: card.routing?.task_name ?? null,
        department: card.department,
        confidence: card.routing_confidence,
      };
    },
    /** 후처리 저장 — 처리 내역에 한 줄 남기고 대기 화면으로. '저장' 버튼이 실제로 저장한다.
     *  콜백 예약 후속 조치가 붙어 있으면 상태를 '콜백 예약'으로 잡는다(내역 타임라인이 색으로 구분). */
    saveWrap: () => {
      addCallLog({
        type: wrapType,
        result: wrapResult,
        status: followups.some((f) => f.icon === "event") ? "콜백 예약" : "후처리 완료",
        talk: fmt(clock),
        summary: (summaryText.current || wrapSummaryText).trim(),
        followups: followups.map((f) => ({ icon: f.icon, label: f.label })),
      });
      requestReset();
    },
    jumpToStep,
    startCall: customerLiveMode ? requestCustomerStart : startCall,
    answerCall,
    endCall: customerLiveMode ? requestCustomerEnd : endCall,
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
    /** 고객이 먼저 끊었다 — 준비 카드는 남기되 자동 연결을 멈추고 콜백 대상으로 표시한다 */
    customerEnded,
    /** 지금 쓰이는 업무매뉴얼 원본 — 업로드본이 있으면 그것. 대기 화면 매뉴얼도 같은 걸 봐야
     *  두 화면이 서로 다른 규정을 주장하지 않는다(표식이 붙는 조항도 여기서 나온다) */
    manualSheet: manualData ?? SHEETS.manual,
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
    customerLiveMode,
    mobileIntakeComplete,
    mobileIntakePending,
    mobileAgentConnected,
    // 통화 중이면 키패드는 항상 눌린다. 실기기에서 통화 중 키패드가 잠기는 일은 없다.
    // - 실서버 모드: DTMF를 보낼 채널이 실제로 열려 있어야 한다(고객 폰 + 서버 연결).
    // - 로컬 데모(백엔드 없이 시연): 통화 중이면 무조건 열린다. 고객이 #을 눌러 통화를 끝내는
    //   흐름을 보여줘야 하고, 합본 화면(surface="full")의 폰도 같이 눌려야 한다.
    //   이 값은 Phone.tsx에서만 쓰이고 Phone은 직원 전용 화면에선 렌더되지 않아 안전하다.
    //   로컬 데모는 **전화를 건 순간부터**(connecting 포함) 켠다 — 실기기는 통화 화면이
    //   뜨는 즉시 키패드를 누를 수 있고, 처음 몇 초만 흐릿하면 고장으로 보인다.
    customerKeypadEnabled:
      !mobileIntakePending &&
      (customerLiveMode
        ? isCustomerSurface &&
          realCallActiveRef.current &&
          mobileServerConnected &&
          (p === "recording" || p === "confirm" || p === "active")
        : p === "connecting" ||
          p === "recording" ||
          p === "confirm" ||
          p === "active" ||
          p === "prep"),
    customerPressDigit: pressCustomerDigit,
    // desktop waiting
    showWaiting: ["idle", "connecting", "recording", "confirm"].includes(p),
    /** 카드를 만드는 중 — 접수 패널의 '카드 생성' 단계를 켠다(끝나면 카드가 날아온다) */
    cardBuilding,
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
    // 본인인증 상태 — 인수인계(transfer) 콜은 전임 상담사가 이미 인증(재인증 생략),
    // 신규·긴급은 연결 직후 상담사가 인증한다(=아직 미완료). 유의사항 첫 항목과 일치.
    // 통화 중 상담사가 대조를 마치면(verified) 카드도 따라 바뀐다 — 예전엔 인입 유형만
    // 봐서, 왼쪽 패널이 "본인인증 완료"인데 카드는 "인증 미완료"로 남는 모순이 났다.
    prepVerified: incoming === "transfer" || verified,
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
    // 라우팅 메타 — 카드가 '자동 라우팅되어 온 것'임을 어필: 부서(2층)·SGE(1층)·업무유형(3층)
    prepSge: deriveSge(card.incident_risk, card.department, incoming),
    prepBusinessType: card.business_type || "업무 유형 분석 중",
    // 3층 라우팅 체인 표시용 — 업무코드(3층)와 핵심 니즈 태그
    // 3층 업무코드 — **분류 결과(card.routing)에서 그대로 읽는다.**
    // 예전엔 콜 유형별 상수(PREP_BUSINESS_CODE)를 찍어서, 백엔드가 분류에 실패해(routing=null)
    // 아무것도 못 줘도 화면엔 늘 코드가 떠 있었다. "업무코드가 계속 G002"의 정체가 이거였다 —
    // 폴백이 아니라 분류 결과와 무관한 값이었고, 그래서 분류 실패가 UI에서 보이지 않았다.
    // 이제 실패는 실패로 보인다(null → '미분류'). 조용한 기본값으로 덮지 않는다.
    prepBusinessCode: card.routing?.task_code ?? null,
    prepBusinessCodeLabel: card.routing?.task_name ?? null,
    prepNeedTags: PREP_NEED_TAGS[incoming],
    // 라벨·색은 당근식 온도 밴드(36.5 기준)에서 나온다 — 온도·색·라벨·멘트가 한 소스로 일관.
    prepEmotionLabel:
      temperature.status === "unavailable"
        ? "모델 미연동"
        : tempC == null
        ? "분석 중"
        : emoMeta.label,
    // 백엔드가 reason 맨 앞에 실어 보낸 [SOURCE=...]를 배지로 분리하고, 신호 텍스트에선 접두사를 뺀다(P0-3)
    prepEmotionSourceBadge: emotionSourceBadge(parseEmotionSource(temperature.reason)),
    prepEmotionSignal:
      (temperature.reason ?? "").replace(/^\[SOURCE=[A-Z_]+\]\s*/, "") || "특이 감정 신호 없음",
    prepEmotionBars: emotionBars,
    prepEmotionFg: tempC == null ? "var(--gray-700)" : emoMeta.fg,
    prepEmotionBar: tempC == null ? "var(--gray-500)" : emoMeta.bar,
    // 당근 매너온도식 — °C 값(36.5 기준), 게이지 창 내 위치(%)와 36.5 눈금 위치(%)
    prepTempC: tempC,
    prepTempPct: tempPct,
    prepTempBasePct: basePct,
    // 온도 밴드별 표정 — 숫자보다 얼굴이 먼저 읽힌다
    prepEmotionFace:
      tempC == null
        ? "sentiment_neutral"
        : emoBand === "calm"
        ? "sentiment_satisfied"
        : emoBand === "warm"
        ? "sentiment_neutral"
        : "sentiment_very_dissatisfied",
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
      !summaryPending && card.routing_confidence != null
        ? Math.round(card.routing_confidence * 100)
        : null,
    // 감정온도 숫자(당근 매너온도 스타일) — 신호등 대신 큰 숫자로
    prepEmotionScore: temperature.score ?? null,
    transcriptQuote: groundedTranscript,
    // AI가 발화에서 분해한 요구사항 — 이관 판단이 가능한 요약 본문
    // 라이브 콜에서 뽑아낸 게 없으면 **빈 배열** — 데모 픽스처로 메우지도, 플레이스홀더
    // 문구로 자리를 채우지도 않는다(0724 피드백 F7). 소비처가 map이라 빈 배열이면
    // 불릿 영역이 그대로 비고, 없는 분석을 있는 것처럼 보이게 하지 않는다.
    summaryPoints: liveActionItems.length
      ? liveActionItems
      : EXPLICIT_LIVE_CALL_ID
      ? []
      : actualSummaryPoints,
    prepSummaryBullets,
    knowledgeQuery: card.business_type,
    knowledgeReferences: card.knowledge_references,
    externalSessionKey: consultationResponse.call_id,
    // 본인인증 전에는 마스킹된 이름 — 인증이 열람의 열쇠라는 걸 화면이 그대로 보여준다
    customerName: verified ? `${CUSTOMER.name} 고객` : `${CUSTOMER.masked} 고객`,
    customerType: CUSTOMER.type,
    customerPhone: CUSTOMER.phoneMasked,
    inquiryLabel,
    wrapSummaryDefault: wrapSummaryText,
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
    summaryProse: consultationResponse
      ? [card.routing_reason, ...card.missing_information.map((item) => `추가 확인: ${item}`)]
          .filter(Boolean)
          .join(" · ") || card.summary || "고객 음성에서 확인된 상담 내용을 검토하고 있습니다."
      : SUMMARY_PROSE[incoming],
    /** 지금 통화 연결이 가능한가 — 준비 카드의 자동 연결 카운트다운이 이 값으로 게이트된다.
     *  (연결 불가 상태에서 카운트다운이 0이 되면 answerCall이 조용히 무시돼 사고가 된다) */
    canConnect,
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
    authMaxLen: authMethod === "birth" ? 8 : 4,
    /* 입력 안내 — **authMethod에서 파생한다.** 화면에 문구를 하드코딩해 두면
       인증 수단이 바뀌었을 때 칸 수와 설명이 어긋난다(실제로 났던 버그). */
    authPrompt:
      authMethod === "birth"
        ? { what: "생년월일 8자리", hint: "(YYYYMMDD)" }
        : authMethod === "phone"
        ? { what: "연락처 뒤 4자리", hint: "" }
        : { what: "계좌 뒤 4자리", hint: "" },
    // 지금 물어야 할 값 — 안내 문구가 대조 방식을 따라간다
    authAskLabel:
      authMethod === "birth" ? "생년월일 8자리 (YYYYMMDD)" : authMethod === "account" ? "계좌 뒤 4자리" : "연락처 뒤 4자리",
    // script + memo — 스크립트·규정은 콜 유형과 같은 사건을 말한다.
    // 실통화 EXAONE 스크립트(guideSteps 4단계)가 도착하면 그걸, 아니면 콜 유형 픽스처(actualCallSteps).
    steps: EXPLICIT_LIVE_CALL_ID
      ? liveSteps
      : guideSteps.length === 4
      ? guideSteps.map((st) => ({ title: st.title, text: st.text }))
      : actualCallSteps,
    // 오프닝은 '상담사가 실제로 말할 첫 문장'이다 — required_actions(할 일)로 덮어쓰지 않는다.
    // 대본 경로에서는 감정온도 밴드에 맞춘 adaptiveOpening이 그대로 나간다.
    firstLine,
    isExplicitLiveCall: !!EXPLICIT_LIVE_CALL_ID,
    // 관련 규정 AI 추천 — 실제 RAG 근거(백엔드가 점수 하한 통과분만 보냄) 우선.
    // 실데이터는 시트 행(row)이 없어 row:null — '열기'는 규정집 의미검색(query)으로 연결.
    regRecos: EXPLICIT_LIVE_CALL_ID
      ? []
      : ragRefs.length
      ? ragRefs.slice(0, 3).map((r) => ({
          title: r.title,
          body: (r.excerpt || "").replace(/^\[[^\]]*\]\s*/, "").replace(/\s+/g, " ").trim().slice(0, 110),
          file: `실물 규정 · AI 검색${r.category ? ` · ${r.category}` : ""}`,
          row: null as number | null,
          query: r.title as string | null,
        }))
      : REG_RECOS[incoming].map((r) => ({ ...r, row: r.row as number | null, query: null as string | null })),
    regQuery: EXPLICIT_LIVE_CALL_ID
      ? explicitSummaryPending
        ? "본인확인"
        : card.business_type || "본인확인"
      : card.business_type || REG_QUERY[incoming],
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
    // 알약 클릭 = 그 용어로 바로 검색 (같은 걸 다시 누르면 해제)
    applyRegSearch: (q: string) => setRegSearch((cur) => (cur === q ? "" : q)),
    /** 추천 검색어의 근거 — 화면이 라벨을 정직하게 붙일 수 있게 출처를 밝힌다.
     *  "통화 중 언급"이라고만 적었더니, 실제로는 **AI 접수 단계에서 고객이 말한** 용어인데
     *  상담원과 통화하기 전부터 칩이 떠 있어 오해를 샀다. 기준은 아래 regSuggests 참조. */
    regSuggestSource: (backendRegSuggests && backendRegSuggests.length ? "backend" : "spoken") as
      | "backend"
      | "spoken",
    /**
     * 추천 검색어 기준 — 두 단계로만 정한다. 추측으로 채우지 않는다.
     *  1) 백엔드 RAG가 고른 용어가 있으면 그것을 그대로 쓴다(무엇이 관련 규정인지는 백엔드 몫).
     *  2) 없으면(백엔드 off) **고객이 실제로 말한 문장에 등장한 용어만** 처음 나온 순서대로.
     *     여기서 '말한 문장'은 AI 접수 발화 + 상담원 통화 발화를 모두 포함한다 — 접수에서 이미
     *     말한 용어를 통화에 들어와서 지우면 상담사가 근거를 잃는다.
     *  3) 둘 다 비면 줄 자체를 그리지 않는다(빈 칩이나 기본값을 만들지 않는다).
     */
    regSuggests: (() => {
      // 1순위: 백엔드 RAG가 고른 관련 규정(연결 시). 어떤 용어인지는 백엔드가 결정한다.
      if (backendRegSuggests && backendRegSuggests.length) return backendRegSuggests;
      // 폴백: 백엔드 off — 전사에 등장한 로컬 키워드만, 처음 나온 순서대로.
      const spoken = liveTranscriptLines.map((l) => l.text).join(" ") + " " + liveCaption;
      return REG_SUGGEST[incoming]
        .map((s) => {
          const at = s.match
            .map((w) => spoken.indexOf(w))
            .filter((i) => i >= 0)
            .sort((a, b) => a - b)[0];
          return { term: s.term, at };
        })
        .filter((x): x is { term: string; at: number } => x.at != null)
        .sort((a, b) => a.at - b.at)
        .map((x) => ({ term: x.term }));
    })(),
    // 검색 필터(엑셀 컬럼필터) — UI가 옵션을 정하고 값만 넘긴다
    regDocType,
    setRegDocType,
    regDeptFilter,
    setRegDeptFilter,
    regTableOnly,
    setRegTableOnly,
    regEffFrom,
    setRegEffFrom,
    regFilterCount:
      (regDocType ? 1 : 0) + (regDeptFilter ? 1 : 0) + (regTableOnly ? 1 : 0) + (regEffFrom ? 1 : 0),
    clearRegFilters: () => {
      setRegDocType(null);
      setRegDeptFilter(null);
      setRegTableOnly(false);
      setRegEffFrom(null);
    },
    // 의미 검색 — pgvector 하이브리드 결과 (규정 원문 청크)
    semHits,
    semLoading,
    loadManualFile,
    // 확장 폭 640 — 시트가 3컬럼 리플로우라 640이면 잘림 없이 들어가고, 중앙 스크립트 압착도 덜하다
    regW: regExpanded ? 640 : 372,
    regFile: ragSheet.file,
    regSheet: ragSheet.sheet,
    regCols: ragSheet.cols,
    regRows: activeRegRows,
    regRowsTotal: ragSheet.rows.length,
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
    // 되살릴 수 있는 후보 = (기본 조치 ∪ 추천 조치) − 지금 붙어 있는 것.
    // 기본 조치까지 후보에 넣는 게 핵심이다: 추천만 후보로 두면 x로 지운 기본 조치는
    // 영영 되살릴 길이 없어 실수 한 번이 복구 불가가 된다. 라벨로 중복을 걸러 기본 → 추천
    // 순서를 유지하므로, 지웠다 되살려도 칩이 튀지 않고 늘 같은 자리에 나타난다.
    recoFollowups: EXPLICIT_LIVE_CALL_ID
      ? []
      : (() => {
          const preset = WRAP_DEFAULTS[incoming];
          const pool: Followup[] = [];
          preset.followups.concat(preset.recommended).forEach((f) => {
            if (!pool.some((x) => x.label === f.label)) pool.push(f);
          });
          return pool
            .filter((f) => !followups.some((x) => x.label === f.label))
            .map((f) => ({
              icon: f.icon,
              label: f.label,
              add: () => addFollowup(f),
            }));
        })(),
    onSummary: (e: React.FormEvent<HTMLDivElement>) => {
      summaryText.current = (e.target as HTMLElement).innerText;
    },
  };
}

export type CallFlowVM = ReturnType<typeof useCallFlow>;
