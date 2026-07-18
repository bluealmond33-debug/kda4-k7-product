// Static demo content for the desktop screens: the recommended call script,
// and the spreadsheet-style reference tables (manual / history / accounts).
// In production these would come from a CMS / knowledge base / core banking API.

/** 로그인한 상담사 프로필 — 대기 화면·통화 화면 프로필 영역에서 공유.
 *  level 은 부서 내 숙련도(경력/초보) — 이관 방향(초보→경력)의 기준. */
export const AGENT = {
  name: "김키움",
  role: "상담사",
  dept: "대출·금융상담팀",
  tenure: "4년차",
  level: "경력" as "경력" | "초보",
  id: "K7-1042",
} as const;

/** 데모 고객 — 본인인증 전에는 마스킹된 이름만, 인증 후 실명 열람.
 *  전화번호는 항상 마스킹(최소 표시 원칙). */
export const CUSTOMER = {
  name: "이정민",
  masked: "이*민",
  phoneMasked: "010-****-4821",
  type: "개인 고객",
  /** 본인확인 대조 정답 — 불일치 경로를 데모하기 위한 기준값 (원문은 화면에 표시하지 않는다) */
  authAnswers: { phone: "4821", birth: "880214", account: "4821" },
} as const;

/** 데모 인입 콜 유형 — 라우팅 기준 후보 문서(vault 07 Outputs 2026-07-18) 참조.
 *  urgent = 장면 A(인입 시 긴급, 대기열 우선) · transfer = 부서 내 초보→경력 이관 수신 */
export type IncomingKind = "normal" | "urgent" | "transfer";

/** 긴급 콜 픽스처 — 명의도용 의심(사고 징후 high), 대기열 맨 앞 점프 */
export const URGENT_RESPONSE = {
  schema_version: "mvp-1.0",
  call_id: "demo-urgent-0001",
  status: "ready",
  source_channel: "voice",
  audio_filename: "demo-urgent.wav",
  transcript: {
    text: "제가 신청한 적 없는 대출이 실행됐다는 문자를 받았어요. 지금 바로 확인해주세요.",
    stt_model: "whisper-1",
    duration_sec: 6.8,
  },
  consultation_card: {
    summary: "고객이 본인이 신청하지 않은 대출 실행 문자를 받았다며 긴급 확인을 요청함.",
    business_type: "명의도용 의심 대출",
    department: "대출 및 금융상담",
    routing_reason: "본인 미신청 대출 실행 정황 — 긴급 확인 대상",
    incident_risk: "high",
    risk_reason: "명의도용·대출사기 의심 · 사고대응팀 공조 필요",
    routing_confidence: 0.91,
    // 데모 더미값 — 감정 모델 연동 시 실값으로 대체
    emotion: {
      status: "completed",
      score: 84,
      level: "elevated",
      reason: "다급·불안 발화 반복 감지",
    },
  },
  created_at: "2026-07-18T07:00:00Z",
} as const;

/** 긴급 카드가 대기열 맨 앞으로 온 이유 — 카드가 스스로 설명한다 (라우팅 기준 후보 문서 ①금전 피해 진행 중) */
export const URGENT_PRIORITY_REASON =
  "금전 피해 진행 가능성(본인 미신청 대출 실행) — 긴급 기준 해당, 대기열 맨 앞으로 배정됨";

/** 이관 수신 픽스처 — 초보 상담사가 넘긴 복합 문의 */
export const TRANSFER_RESPONSE = {
  schema_version: "mvp-1.0",
  call_id: "demo-transfer-0001",
  status: "ready",
  source_channel: "voice",
  audio_filename: "demo-transfer.wav",
  transcript: {
    text: "전세자금대출 금리랑 만기를 바꾸고 싶은데 중도상환수수료가 어떻게 되는지도 알고 싶어요.",
    stt_model: "whisper-1",
    duration_sec: 9.6,
  },
  consultation_card: {
    summary: "고객이 전세자금대출 조건변경(금리·만기)과 중도상환수수료를 복합 문의함.",
    business_type: "전세자금대출 조건변경",
    department: "대출 및 금융상담",
    routing_reason: "약정 변경·심사 조건 상담에 해당",
    incident_risk: "low",
    risk_reason: null,
    routing_confidence: 0.89,
    // 데모 더미값 — 감정 모델 연동 시 실값으로 대체
    emotion: {
      status: "completed",
      score: 48,
      level: "caution",
      reason: "긴 상담으로 답답함 표현",
    },
  },
  created_at: "2026-07-18T07:10:00Z",
} as const;

/** 이관 인수인계 — 사람이 쓰지 않는다. 전임 상담사의 통화를 AI가 요약해 자동 작성 */
export const TRANSFER_HANDOVER = {
  from: "박민지",
  fromLevel: "초보" as const,
  fromTenure: "1년차",
  talkTime: "07:24",
  verified: true,
  aiMemo: [
    "금리 인하 요구권 안내까지 진행됨",
    "중도상환수수료 면제 조건에서 막힘 — 약정서 특약 확인 필요",
    "고객이 재약정 절차를 오늘 안에 알고 싶어 함",
  ],
  remaining: "수수료 면제 조건 확정 · 재약정 절차 안내",
} as const;

/** 부서 내 이관 가능한 경력 상담사 — 이관 방향은 초보→경력 */
export const TRANSFER_TARGETS = [
  { name: "이수진", level: "경력", tenure: "6년차", state: "대기 중" },
  { name: "정해원", level: "경력", tenure: "9년차", state: "통화 중 · 예약 가능" },
] as const;

export interface ScriptStep {
  title: string;
  text: string;
}

/** 콜 유형별 상담 스크립트 — 카드·스크립트·규정이 한 사건을 말하도록 유형마다 한 벌.
 *  (구 착오송금 단일 스크립트는 카드가 주담대인데 스크립트가 착오송금인 자기모순을 만들었다) */
export const SCRIPTS: Record<IncomingKind, ScriptStep[]> = {
  normal: [
    { title: "1. 오프닝 · 공감", text: "“네 고객님, 주택담보대출 만기 연장 문의 주셨죠. 제가 바로 확인해 드리겠습니다.”" },
    { title: "2. 사실 확인", text: "“현재 대출 계좌와 만기 예정일을 확인해볼게요. 천천히 말씀해 주셔도 됩니다.”" },
    { title: "3. 절차 안내 · 재약정", text: "“만기 연장은 재약정 심사로 진행됩니다. 소득 증빙과 등기부등본이 필요하고, 비대면으로도 접수하실 수 있어요.”" },
    { title: "4. 마무리 · 후속 안내", text: "“필요 서류 목록을 문자로 보내드리고, 심사 담당자가 콜백 드리도록 예약해 두겠습니다. 더 궁금하신 점 있으실까요?”" },
  ],
  urgent: [
    { title: "1. 오프닝 · 공감", text: "“네 고객님, 많이 놀라셨죠. 지금 바로 확인해 드리겠습니다.”" },
    { title: "2. 사실 확인", text: "“받으신 문자의 대출 실행 시각과 금액을 확인해볼게요. 최근 본인 명의로 신청하신 대출이 있으신가요?”" },
    { title: "3. 긴급 조치 · 지급정지", text: "“본인이 신청하지 않은 것으로 확인되면 즉시 지급정지와 명의도용 사고 접수를 진행합니다. 사고대응팀과 바로 연결해 드릴게요.”" },
    { title: "4. 마무리 · 후속 안내", text: "“접수 번호를 문자로 보내드리고, 사고대응팀에서 30분 내 콜백 드리겠습니다. 통화 중에는 다른 금융기관 앱을 열지 말아 주세요.”" },
  ],
  transfer: [
    { title: "1. 오프닝 · 이어받기", text: "“네 고객님, 앞서 상담 내용은 전달받았습니다. 중도상환수수료 조건부터 이어서 안내드릴게요.”" },
    { title: "2. 사실 확인", text: "“약정서 특약의 면제 조건을 확인해볼게요. 대출 실행일과 약정 기간을 함께 보겠습니다.”" },
    { title: "3. 절차 안내 · 재약정", text: "“면제 조건이 충족되면 재약정으로 금리와 만기를 변경할 수 있습니다. 오늘 접수하시면 이번 주 안에 심사 결과를 안내드려요.”" },
    { title: "4. 마무리 · 후속 안내", text: "“재약정 절차와 수수료 기준을 문자로 정리해 보내드리겠습니다. 더 궁금하신 점 있으실까요?”" },
  ],
};

/** 유형별 AI 추천 규정 (우측 패널) — 스크립트와 같은 사건을 가리킨다 */
export const REG_RECOS: Record<IncomingKind, { title: string; body: string; file: string }[]> = {
  normal: [
    { title: "주택담보대출 재약정 절차", body: "만기 연장은 재약정 심사 대상 — 소득 증빙·담보 재평가 기준을 확인한다.", file: "여신_업무매뉴얼 · 31행" },
    { title: "만기 연장 필요 서류", body: "소득금액증명원·등기부등본·인감증명서. 비대면 접수 가능 조건 확인.", file: "여신_서류기준 · 8행" },
  ],
  urgent: [
    { title: "명의도용 대출 사고 접수", body: "본인 미신청 확인 시 즉시 지급정지 → 사고 접수 → 수사기관 신고 안내.", file: "금융사고_대응지침 · 12행" },
    { title: "전자금융 이상거래(FDS) 대응", body: "거래 시각·기기·IP 변경 이력 확인. 의심 시 사고대응팀 연계.", file: "이상거래_대응지침 · 44행" },
  ],
  transfer: [
    { title: "중도상환수수료 면제 조건", body: "약정서 특약 기준 — 경과 기간·상환 비율별 면제 조건을 확인한다.", file: "여신_수수료기준 · 17행" },
    { title: "전세자금대출 재약정", body: "금리·만기 변경은 재약정 심사 대상. 보증기관 동의 요건 확인.", file: "여신_업무매뉴얼 · 42행" },
  ],
};

/** 유형별 요구사항 분해 — AI가 발화에서 뽑은 불릿. 이관 판단이 가능한 수준의 요약 본문 */
export const SUMMARY_POINTS: Record<IncomingKind, string[]> = {
  normal: [
    "주택담보대출 만기 연장 가능 여부 확인 요청",
    "연장 시 필요한 서류 안내 요청",
    "비대면 진행 가능 여부에 관심",
  ],
  urgent: [
    "본인 미신청 대출 실행 문자 수신 — 사실 확인 요청",
    "즉시 지급정지 등 긴급 조치 요구",
    "명의도용 여부 확인 필요",
  ],
  transfer: [
    "전세자금대출 금리·만기 조건변경 문의",
    "중도상환수수료 면제 조건 확인 요청",
    "재약정 절차를 오늘 안에 안내받기 원함",
  ],
};

/** 유형별 규정 검색어 (우측 패널 검색창 데모 값) */
export const REG_QUERY: Record<IncomingKind, string> = {
  normal: "주담대 만기 연장",
  urgent: "명의도용 지급정지",
  transfer: "중도상환수수료 면제",
};

export interface SheetColumn {
  l: string;
  w: number;
}
export interface SheetData {
  title: string;
  file: string;
  sheet: string;
  cols: SheetColumn[];
  rows: string[][];
}

export const SHEETS: Record<"history" | "accounts" | "manual", SheetData> = {
  history: {
    title: "과거 상담 이력",
    file: "상담이력_조회.xlsx",
    sheet: "2026",
    cols: [
      { l: "날짜", w: 96 },
      { l: "채널", w: 64 },
      { l: "상담 유형", w: 170 },
      { l: "결과", w: 80 },
      { l: "담당 상담사", w: 100 },
    ],
    rows: [
      ["2026.07.02", "전화", "카드 › 분실신고", "완결", "김하나"],
      ["2026.05.18", "챗봇", "수신 › 이체한도 상향", "완결", "자동화"],
      ["2026.03.09", "전화", "전자금융 › OTP 재발급", "완결", "박지성"],
      ["2026.02.14", "전화", "대출 › 상환일정 문의", "완결", "이수민"],
      ["2025.12.30", "앱", "수신 › 예금 만기 안내", "완결", "자동화"],
      ["2025.11.07", "전화", "카드 › 한도 상향", "완결", "김하나"],
    ],
  },
  accounts: {
    title: "보유 계좌 및 카드 현황",
    file: "고객보유상품_조회.xlsx",
    sheet: "보유상품",
    cols: [
      { l: "구분", w: 70 },
      { l: "상품명", w: 180 },
      { l: "번호", w: 160 },
      { l: "상태", w: 70 },
      { l: "개설일", w: 96 },
    ],
    rows: [
      ["입출금", "키움 주거래 통장", "***-**-4821", "정상", "2019.03.11"],
      ["적금", "키움 자유적금", "***-**-7745", "정상", "2022.06.01"],
      ["체크카드", "키움 체크카드", "****-****-**-2231", "정상", "2019.03.11"],
      ["대출", "신용대출", "***-**-9902", "정상", "2024.01.20"],
    ],
  },
  manual: {
    title: "전자금융거래 업무매뉴얼",
    file: "전자금융거래_업무매뉴얼_v24.xlsx",
    sheet: "착오송금 반환",
    cols: [
      { l: "조항", w: 64 },
      { l: "항목", w: 130 },
      { l: "내용", w: 300 },
      { l: "안내 멘트", w: 300 },
    ],
    rows: [
      [
        "§12-1",
        "반환지원 대상",
        "수취인 동의 없이 임의 반환 불가. 예금보험공사 반환지원 제도로 신청 접수.",
        "“수취인 동의 없이 임의로 돌려드릴 수는 없고, 반환지원 제도로 신청하실 수 있습니다.”",
      ],
      [
        "§12-2",
        "확정 표현 금지",
        "“무조건 반환” 등 확정적 표현 사용 금지.",
        "“반드시 돌려받는다고 말씀드리긴 어렵지만, 절차대로 최대한 도와드리겠습니다.”",
      ],
      [
        "§12-3",
        "본인확인",
        "반환 접수 전 본인확인 필수(연락처·생년월일·계좌 대조).",
        "“접수를 위해 본인확인을 먼저 도와드릴게요.”",
      ],
      ["§12-4", "정보 확인", "수취 계좌·거래 시각 등 상담 핵심정보를 확인.", "—"],
      [
        "§13-1",
        "FDS 연계",
        "이상거래 징후 시 사고대응팀 연계 후 처리.",
        "“안전을 위해 사고대응팀으로 연결해 드리겠습니다.”",
      ],
    ],
  },
};

export interface SheetRow {
  n: number;
  cells: { text: string; w: number }[];
}
export interface RenderedSheet {
  title: string;
  file: string;
  sheet: string;
  cols: SheetColumn[];
  rows: SheetRow[];
}

/** Expand a SheetData into row objects with per-cell widths for rendering. */
export function renderSheet(d: SheetData): RenderedSheet {
  return {
    title: d.title,
    file: d.file,
    sheet: d.sheet,
    cols: d.cols,
    rows: d.rows.map((r, ri) => ({
      n: ri + 1,
      cells: r.map((c, ci) => ({ text: c, w: d.cols[ci].w })),
    })),
  };
}

export const WRAP_TYPE_OPTIONS = [
  "전자금융 › 착오송금",
  "전자금융 › OTP/보안",
  "카드 › 분실·정지",
  "수신 › 이체한도",
  "대출 › 상환일정",
];

export const WRAP_RESULT_OPTIONS = [
  "타 부서 이관 · 사고대응팀",
  "상담 완료 · 안내",
  "재상담 예약",
  "추가 확인 필요",
];

export interface Followup {
  icon: string;
  label: string;
}

export const DEFAULT_FOLLOWUPS: Followup[] = [
  { icon: "event", label: "콜백 예약 · 오늘 16:00" },
  { icon: "confirmation_number", label: "사고대응팀 이관 티켓 생성" },
];

export const RECOMMENDED_FOLLOWUPS: Followup[] = [
  { icon: "sms", label: "고객 SMS 안내 발송" },
  { icon: "flag", label: "FDS 모니터링 등록" },
];
