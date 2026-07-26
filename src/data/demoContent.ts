// Static demo content for the desktop screens: the recommended call script,
// and the spreadsheet-style reference tables (manual / history / accounts).
// In production these would come from a CMS / knowledge base / core banking API.

/** 로그인한 상담사 프로필 — 대기 화면·통화 화면 프로필 영역에서 공유.
 *  level 은 부서 내 숙련도(시니어/주니어) — 이관 방향(주니어→시니어)의 기준. */
export const AGENT = {
  name: "김키움",
  role: "상담사",
  dept: "대출·금융상담팀",
  tenure: "4년차",
  level: "시니어" as "시니어" | "주니어",
  id: "K7-1042",
} as const;

/** 데모 고객 — 본인인증 전에는 마스킹된 이름만, 인증 후 실명 열람.
 *  전화번호는 항상 마스킹(최소 표시 원칙). */
export const CUSTOMER = {
  name: "김민기",
  masked: "김*기",
  phoneMasked: "010-****-4821",
  type: "개인 고객",
  /** 본인확인 대조 정답 — 불일치 경로를 데모하기 위한 기준값 (원문은 화면에 표시하지 않는다) */
  authAnswers: { phone: "4821", birth: "19880214", account: "4821" },
} as const;

/** 데모 인입 콜 유형 — 라우팅 기준 후보 문서(vault 07 Outputs 2026-07-18) 참조.
 *  urgent = 장면 A(인입 시 긴급, 대기열 우선) · transfer = 부서 내 주니어→시니어 이관 수신 */
export type IncomingKind = "normal" | "urgent" | "transfer";

/** 긴급 콜 픽스처 — 명의도용 의심(사고 징후 high), 대기열 맨 앞 점프 */
export const URGENT_RESPONSE = {
  schema_version: "mvp-1.1",
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
    attention_level: "high",
    reason_codes: ["FINANCIAL_INCIDENT", "TEXT_HIGH_RISK_SIGNAL"],
    routing: {
      task_code: "E002",
      task_name: "이상거래 신고",
      classification: "EMERGENCY",
      handler: "HUMAN",
    },
    text_emotion: {
      content_emotion: "불안",
      situation_severity: "high",
      urgency_score: 95,
    },
  },
  created_at: "2026-07-18T07:00:00Z",
} as const;

/** 긴급 카드가 대기열 맨 앞으로 온 이유 — 카드가 스스로 설명한다 (라우팅 기준 후보 문서 ①금전 피해 진행 중) */
export const URGENT_PRIORITY_REASON =
  "금전 피해 진행 가능성(본인 미신청 대출 실행) — 긴급 기준 해당, 대기열 맨 앞으로 배정됨";

/** 이관 수신 픽스처 — 주니어 상담사가 넘긴 복합 문의 */
export const TRANSFER_RESPONSE = {
  schema_version: "mvp-1.1",
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
    attention_level: "medium",
    reason_codes: ["ATTENTION_REQUIRED"],
    routing: {
      task_code: "G004",
      task_name: "기타·복합 일반 상담",
      classification: "GENERAL",
      handler: "HUMAN",
    },
    text_emotion: {
      content_emotion: "걱정",
      situation_severity: "medium",
      urgency_score: 48,
    },
  },
  created_at: "2026-07-18T07:10:00Z",
} as const;

/** 이관 인수인계 — 사람이 쓰지 않는다. 전임 상담사의 통화를 AI가 요약해 자동 작성 */
export const TRANSFER_HANDOVER = {
  from: "박민지",
  fromLevel: "주니어" as const,
  fromTenure: "1년차",
  fromDept: "수신·예금팀",
  talkTime: "07:24",
  verified: true,
  aiMemo: [
    "금리 인하 요구권 안내까지 진행됨",
    "중도상환수수료 면제 조건에서 막힘 — 약정서 특약 확인 필요",
    "고객이 재약정 절차를 오늘 안에 알고 싶어 함",
  ],
  remaining: "수수료 면제 조건 확정 · 재약정 절차 안내",
} as const;

/** 부서 내 이관 가능한 시니어 상담사 — 이관 방향은 주니어→시니어 */
export const TRANSFER_TARGETS = [
  { name: "이수진", level: "시니어", tenure: "6년차", state: "대기 중" },
  { name: "정해원", level: "시니어", tenure: "9년차", state: "통화 중 · 예약 가능" },
] as const;

/* 이관은 특정 개인이 아니라 부서로 — 특정 사람에게 넘기면 책임 소재가 흐려진다는 실무 지적 반영.
   부서 대기열이 책임 주체가 되고, 그 안에서 수신 가능한 상담사에게 배정된다. */
export const TRANSFER_DEPTS = [
  { name: "사고·신고", desc: "명의도용·보이스피싱·이상거래", state: "대기 2건" },
  { name: "여신·대출", desc: "대출 심사·재약정·한도 변경", state: "대기 1건" },
  { name: "전자금융·디지털", desc: "OTP·공동인증서·이체 오류", state: "대기 0건" },
] as const;

/* AI가 콜 유형으로 추천하는 이관 부서 — 기본 이관의 목적지 */
export const SUGGESTED_DEPT: Record<IncomingKind, string> = {
  normal: "여신·대출",
  urgent: "사고·신고",
  transfer: "여신·대출",
};

/* 규정 검색 추천어 — 통화 중 검색창 아래 알약. 콜 유형별 후보를 두고,
   실제 발화에 등장한 용어가 앞으로 올라오며 점등된다(실시간 감각). */
export interface RegSuggest {
  /** 알약에 표시되고 클릭 시 검색되는 용어 */
  term: string;
  /** 통화 전사에 이 중 하나라도 등장하면 알약이 나타난다(표시어와 트리거어 분리) */
  match: string[];
}
export const REG_SUGGEST: Record<IncomingKind, RegSuggest[]> = {
  normal: [
    { term: "만기 연장", match: ["만기", "연장"] },
    { term: "재약정", match: ["재약정"] },
    { term: "소득 증빙", match: ["소득"] },
    { term: "등기부등본", match: ["등기부"] },
    { term: "비대면", match: ["비대면"] },
    { term: "연체", match: ["연체"] },
  ],
  urgent: [
    { term: "지급정지", match: ["지급정지", "정지"] },
    { term: "명의도용", match: ["명의", "도용"] },
    { term: "보이스피싱", match: ["보이스피싱", "피싱"] },
    { term: "사고 접수", match: ["사고", "접수"] },
    { term: "피해구제", match: ["피해", "구제"] },
  ],
  transfer: [
    { term: "중도상환수수료", match: ["중도상환", "수수료"] },
    { term: "금리 인하", match: ["금리"] },
    { term: "약정 변경", match: ["약정"] },
    { term: "재약정", match: ["재약정"] },
    { term: "면제 조건", match: ["면제"] },
  ],
};

/* 핵심 니즈 태그 — 고객이 무엇을 원하는지 한눈에. 준비 카드 감정온도 옆 항목. */
export const PREP_NEED_TAGS: Record<IncomingKind, string[]> = {
  normal: ["만기 연장", "필요 서류", "비대면 가능"],
  urgent: ["지급정지", "명의도용 확인", "피해 접수"],
  transfer: ["금리 인하", "재약정", "수수료 확인"],
};

/** 관리자 화면 — 부서별 실시간 대기열 픽스처. 이름은 마스킹(최소 표시 원칙),
 *  용건은 AI 사전 접수 요약 한 줄. baseSec + 열람 중 경과로 대기 시간이 실제로 흐른다.
 *  대기 건수는 TRANSFER_DEPTS의 state(대기 2·1·0건)와 같은 사건을 말한다. */
export const ADMIN_QUEUE = [
  {
    dept: "사고·신고",
    desc: "명의도용·보이스피싱·이상거래",
    available: 1,
    busy: 2,
    waiting: [
      { masked: "박*영", summary: "카드 도난 의심 — 해외 승인 문자 확인 요청", baseSec: 252 },
      { masked: "최*호", summary: "보이스피싱 의심 이체 차단 요청", baseSec: 158 },
    ],
  },
  {
    dept: "여신·대출",
    desc: "대출 심사·재약정·한도 변경",
    available: 2,
    busy: 1,
    waiting: [{ masked: "김*진", summary: "주택담보대출 금리 재약정 상담", baseSec: 65 }],
  },
  {
    dept: "전자금융·디지털",
    desc: "OTP·공동인증서·이체 오류",
    available: 3,
    busy: 0,
    waiting: [],
  },
] as const;

/** '통화 추가' 데모 — 관리자 대기열에 랜덤으로 들어올 더미 인입 풀 (긴급 없음, 일반 카드만) */
export const ADMIN_QUEUE_POOL = [
  { dept: "여신·대출", masked: "정*아", summary: "신용대출 한도 증액 가능 여부 문의" },
  { dept: "여신·대출", masked: "이*준", summary: "전세자금대출 서류 재제출 절차 문의" },
  { dept: "사고·신고", masked: "한*솔", summary: "해외 결제 승인 취소 요청" },
  { dept: "사고·신고", masked: "오*택", summary: "스미싱 문자 클릭 후 계좌 점검 요청" },
  { dept: "전자금융·디지털", masked: "유*나", summary: "OTP 재발급 및 이체한도 문의" },
  { dept: "전자금융·디지털", masked: "강*민", summary: "공동인증서 갱신 오류 해결 요청" },
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

/** 유형별 AI 추천 규정 (우측 패널) — 스크립트와 같은 사건을 가리킨다.
 *  row = 열기 시 규정집 시트에서 강조할 행 인덱스(0-base, SHEETS.manual.rows 기준) */
export const REG_RECOS: Record<IncomingKind, { title: string; body: string; file: string; row: number }[]> = {
  normal: [
    { title: "주택담보대출 재약정 절차", body: "만기 연장은 재약정 심사 대상 — 소득 증빙·담보 재평가 기준을 확인한다.", file: "여신_업무매뉴얼 · 31행", row: 0 },
    { title: "만기 연장 필요 서류", body: "소득금액증명원·등기부등본·인감증명서. 비대면 접수 가능 조건 확인.", file: "여신_서류기준 · 8행", row: 3 },
    // 세 번째 추천 — 실제 RAG는 top_k=3이라 한 화면에 셋이 뜨는 게 정상 분량이다.
    // 둘만 두면 시연에서 "AI가 겨우 두 개 찾았나"로 보이고, 스크롤 여백도 남는다.
    { title: "비대면 재약정 신청 요건", body: "전자약정은 본인확인·공동인증서 필요. 담보물 변동 없을 때만 비대면 진행.", file: "여신_비대면업무기준 · 22행", row: 5 },
  ],
  urgent: [
    { title: "명의도용 대출 사고 접수", body: "본인 미신청 확인 시 즉시 지급정지 → 사고 접수 → 수사기관 신고 안내.", file: "금융사고_대응지침 · 12행", row: 2 },
    { title: "전자금융 이상거래(FDS) 대응", body: "거래 시각·기기·IP 변경 이력 확인. 의심 시 사고대응팀 연계.", file: "이상거래_대응지침 · 44행", row: 4 },
  ],
  transfer: [
    { title: "중도상환수수료 면제 조건", body: "약정서 특약 기준 — 경과 기간·상환 비율별 면제 조건을 확인한다.", file: "여신_수수료기준 · 17행", row: 1 },
    { title: "전세자금대출 재약정", body: "금리·만기 변경은 재약정 심사 대상. 보증기관 동의 요건 확인.", file: "여신_업무매뉴얼 · 42행", row: 3 },
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
/* 검색 placeholder = 시트에 실제로 존재하는 키워드 — placeholder대로 치면 진짜 찾아진다 */
export const REG_QUERY: Record<IncomingKind, string> = {
  normal: "본인확인",
  urgent: "FDS",
  transfer: "반환지원",
};

/* 준비카드 서술형 요약 — 헤드라인 한 줄만으로는 상황 파악이 어렵다는 피드백.
   헤드라인(무슨 일) → 프로즈(맥락 2문장) → 요구사항(할 일) 순서로 읽힌다 */
export const SUMMARY_PROSE: Record<IncomingKind, string> = {
  normal:
    "고객은 보유 중인 주택담보대출의 만기가 다가와 연장이 가능한지 확인하고 싶어 합니다. 연장에 필요한 서류와 비대면 접수 가능 여부까지 함께 묻고 있어, 재약정 절차 안내가 필요한 상담입니다.",
  urgent:
    "고객은 본인이 신청한 적 없는 대출 실행 문자를 받고 크게 불안해하며 즉시 확인을 요청하고 있습니다. 명의도용 가능성이 있어 지급정지 등 긴급 조치와 사고대응팀 공조가 필요한 상담입니다.",
  transfer:
    "전세자금대출 중도상환 관련 상담이 앞선 상담사에게서 이관되었습니다. 수수료 면제 조건 확인까지 진행된 상태로, 남은 절차 안내부터 이어가면 되는 상담입니다.",
};

export interface SheetColumn {
  l: string;
  w: number;
}
/** 사고 방지 신호 — 백엔드 구조화의 prohibitions/requirements에 대응한다.
 *  금지는 "하면 안 되는 것", 선행은 "먼저 해야 하는 것". */
export interface SheetSignal {
  kind: "금지" | "선행";
  text: string;
}

export interface SheetData {
  title: string;
  file: string;
  sheet: string;
  cols: SheetColumn[];
  rows: string[][];
  /** 조항 → 신호. 있는 시트에만 붙는다(과거 이력·계좌 시트에는 없다) */
  signals?: Record<string, SheetSignal>;
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
    /* 조항별 사고 방지 신호 — 백엔드 구조화(structured.prohibitions/requirements)가
       뽑아내는 값과 같은 것을 시연용으로 고정해 둔다.
       표에 열로 넣지 않는 이유: 열을 하나 더 두면 정작 읽어야 할 안내 멘트가 좁아진다.
       대신 내용 칸 앞에 표식만 세우고 자세한 문장은 올렸을 때 보여준다 —
       "확정적 표현 사용 금지" 같은 건 통화 중 가장 비싼 실수라 놓치면 안 되지만,
       상시 펼쳐 두면 정작 읽을 문장을 가린다. */
    signals: {
      "§12-1": { kind: "금지", text: "수취인 동의 없이 임의 반환 불가" },
      "§12-2": { kind: "금지", text: "「무조건 반환」 등 확정적 표현 사용 금지" },
      "§12-3": { kind: "선행", text: "반환 접수 전 본인확인 필수" },
      "§13-1": { kind: "선행", text: "이상거래 징후 시 사고대응팀 연계 후 처리" },
      "§14-1": { kind: "금지", text: "원문은 화면에 표시하지 않는다" },
      "§14-2": { kind: "금지", text: "재차 불일치면 열람 불가 · 지점 내방 안내" },
      "§14-3": { kind: "금지", text: "본인 동의 확인 전 대리인에게 열람·안내 불가" },
    },
    /* 열 순서 — 안내 멘트가 맨 앞이다.
       통화 중에 조항 번호로 찾는 일은 거의 없고, 조항은 내용이 아니라 **출처 표시**다.
       상담사가 급할 때 필요한 건 '지금 뭐라고 말해야 하나' 한 줄이라 그걸 가장 넓게
       왼쪽에 두고, 조항은 오른쪽 끝에 좁게 붙인다. */
    cols: [
      { l: "안내 멘트", w: 286 },
      { l: "항목", w: 104 },
      { l: "내용", w: 232 },
      { l: "조항", w: 58 },
    ],
    rows: [
      [
        "“수취인 동의 없이 임의로 돌려드릴 수는 없고, 반환지원 제도로 신청하실 수 있습니다.”",
        "반환지원 대상",
        "수취인 동의 없이 임의 반환 불가. 예금보험공사 반환지원 제도로 신청 접수.",
        "§12-1"],
      [
        "“반드시 돌려받는다고 말씀드리긴 어렵지만, 절차대로 최대한 도와드리겠습니다.”",
        "확정 표현 금지",
        "“무조건 반환” 등 확정적 표현 사용 금지.",
        "§12-2"],
      [
        "“접수를 위해 본인확인을 먼저 도와드릴게요.”",
        "본인확인",
        "반환 접수 전 본인확인 필수(연락처·생년월일·계좌 대조).",
        "§12-3"],
      [ "—", "정보 확인", "수취 계좌·거래 시각 등 상담 핵심정보를 확인.","§12-4"],
      [
        "“안전을 위해 사고대응팀으로 연결해 드리겠습니다.”",
        "FDS 연계",
        "이상거래 징후 시 사고대응팀 연계 후 처리.",
        "§13-1"],
      [
        "“확인을 위해 연락처 뒤 4자리를 말씀해 주시겠어요?”",
        "본인확인 방법",
        "연락처·생년월일·계좌 뒷자리 중 고객 진술값을 원문과 대조. 원문은 화면에 표시하지 않는다.",
        "§14-1"],
      [
        "“말씀해주신 정보가 일치하지 않아 다른 방법으로 한 번 더 확인하겠습니다.”",
        "본인확인 불일치",
        "불일치 시 다른 방식으로 1회 재시도. 재차 불일치면 열람 불가·지점 내방 안내.",
        "§14-2"],
      [
        "“본인 동의 확인 전에는 상세 내용을 안내드리기 어렵습니다.”",
        "대리인 상담 시 본인확인",
        "위임장·본인 동의 확인 전에는 대리인에게 계좌·상담 정보를 열람·안내할 수 없다.",
        "§14-3"],
    ],
  },
};

export interface SheetRow {
  n: number;
  cells: { text: string; w: number }[];
  /** 이 행의 사고 방지 신호(있으면). 어느 화면이든 표식은 이것 하나만 보면 된다. */
  signal?: SheetSignal;
}
export interface RenderedSheet {
  title: string;
  file: string;
  sheet: string;
  cols: SheetColumn[];
  rows: SheetRow[];
}

/** 열을 라벨로 찾는다. 열 순서는 시트마다·업로드본마다 달라 인덱스를 박으면 조용히 어긋난다. */
export function sheetColIndex(cols: SheetColumn[], label: string): number {
  return cols.findIndex((c) => c.l.replace(/\s+/g, "") === label);
}

/** 행의 조항으로 신호를 찾는다. 조항 열이 없는 시트(이력·계좌)는 신호도 없다. */
export function rowSignal(d: SheetData, row: string[]): SheetSignal | undefined {
  if (!d.signals) return undefined;
  const ci = sheetColIndex(d.cols, "조항");
  if (ci < 0) return undefined;
  return d.signals[(row[ci] ?? "").trim()];
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
      // 신호는 렌더 모델에 실어 보낸다 — 여기서 떨어뜨리면 통화 중 화면엔 표식이 영영 안 뜬다.
      signal: rowSignal(d, r),
    })),
  };
}

// 상담 유형·결과 드롭다운 선택지 — 콜 유형별 기본값(WRAP_DEFAULTS)도 이 목록 안에 들어 있어야
// 선택 표시가 메뉴 항목과 일치한다.
export const WRAP_TYPE_OPTIONS = [
  "대출 › 만기연장·재약정",
  "대출 › 전세자금 조건변경",
  "전자금융 › 명의도용 의심",
  "전자금융 › 착오송금",
  "카드 › 분실·정지",
  "수신 › 이체한도",
];

export const WRAP_RESULT_OPTIONS = [
  "상담 완료 · 안내",
  "상담 완료 · 재약정 접수",
  "재상담 예약",
  "추가 확인 필요",
  "타 부서 이관 · 사고대응팀",
];

export interface Followup {
  icon: string;
  label: string;
}

/** 콜 유형별 후처리 프리셋 — 상담 유형·결과·후속조치가 실제 통화 내용과 어긋나지 않게 한다.
 *  (구: 정적 기본값이 모든 콜에 착오송금/사고대응팀을 물려, 주담대 상담이 사고팀 이관으로
 *   끝나는 자기모순을 만들었다) */
export interface WrapPreset {
  type: string;
  result: string;
  /** 종료 시 이미 걸려 있는 후속조치 칩 */
  followups: Followup[];
  /** '+' 로 추가할 수 있는 추천 후속조치 */
  recommended: Followup[];
}

export const WRAP_DEFAULTS: Record<IncomingKind, WrapPreset> = {
  normal: {
    type: "대출 › 만기연장·재약정",
    result: "상담 완료 · 재약정 접수",
    followups: [
      { icon: "sms", label: "필요 서류 목록 SMS 발송" },
      { icon: "event", label: "심사 담당자 콜백 · 오늘 16:00" },
    ],
    recommended: [
      { icon: "description", label: "재약정 심사 접수 등록" },
      { icon: "flag", label: "만기 도래 관리 대상 등록" },
    ],
  },
  urgent: {
    type: "전자금융 › 명의도용 의심",
    result: "타 부서 이관 · 사고대응팀",
    followups: [
      { icon: "confirmation_number", label: "사고대응팀 이관 티켓 생성" },
      { icon: "block", label: "지급정지 요청 접수" },
    ],
    recommended: [
      { icon: "sms", label: "사고 접수번호 SMS 발송" },
      { icon: "flag", label: "FDS 모니터링 등록" },
    ],
  },
  transfer: {
    type: "대출 › 전세자금 조건변경",
    result: "상담 완료 · 재약정 접수",
    followups: [
      { icon: "sms", label: "재약정 절차·수수료 기준 SMS 발송" },
      { icon: "event", label: "재약정 심사 결과 콜백 예약" },
    ],
    recommended: [
      { icon: "description", label: "중도상환수수료 면제 검토 등록" },
      { icon: "flag", label: "재약정 접수 등록" },
    ],
  },
};
