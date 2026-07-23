// 관리자 대시보드(?role=admin) 정적 콘텐츠 — 파이프라인 노드 정의, 부서 시드 대기열,
// 지식베이스 통계, 단독 시연용 테스트 콜 픽스처.
// 부서 목록의 원본은 stt-classification 규칙(rules.ts) — 여기서 재정의하지 않는다.

import { routingDepartments } from "../features/stt-classification/rules";
import type { DemoCallKind, PipelineStageId, Sge } from "../services";
import type { EmotionTemperatureLevel, MvpIncidentRisk } from "../services";

/** 노드 상세 스펙 — 설명 모드에서 노드를 클릭하면 뜨는 팝업 내용.
 *  실제 코드·hippo 문서 기준으로 정직하게: 무엇이 실가동이고 무엇이 데모·대기인지. */
export interface PipelineNodeSpec {
  engine: string;
  io: string;
  status: "실가동" | "연동 대기" | "데모 대체";
  statusNote: string;
  lines: string[];
}

/** 백엔드 프로세스 플로우의 8개 노드 — 발표에서 "이래서 이렇게 연결된다"를 말하는 자리.
 *  tech = 기술 캡션(항상 표시) · explain = 설명 모드에서 펼쳐지는 근거 문장 · spec = 클릭 상세 */
export interface PipelineNodeDef {
  id: PipelineStageId;
  label: string;
  tech: string;
  icon: string;
  explain: string;
  spec: PipelineNodeSpec;
}

export const PIPELINE_NODES: PipelineNodeDef[] = [
  {
    id: "utterance",
    label: "고객 발화",
    tech: "전화 인입 · 자연어 접수",
    icon: "call",
    explain:
      "ARS 버튼 트리 없이 고객이 평소처럼 말합니다. 이 발화 하나가 뒤의 모든 처리의 입력이 됩니다.",
    spec: {
      engine: "폐쇄망 LAN · 전화 인입 (PSTN 연동은 이번 범위 외)",
      io: "고객 음성 → 오디오 스트림",
      status: "데모 대체",
      statusNote: "시연은 시나리오 발화·실마이크(고객 폰 화면) 입력으로 대체합니다.",
      lines: [
        "ARS 버튼 트리 없음 — 자연어 접수가 전체 파이프라인의 유일한 입력",
        "시연 구도: 고객 폰(?role=customer)에서 블루투스 실마이크 발화 예정",
      ],
    },
  },
  {
    id: "stt",
    label: "실시간 STT",
    tech: "faster-whisper · 문장 전사",
    icon: "graphic_eq",
    explain:
      "음성이 문장 단위 텍스트로 바뀝니다. 이 전사본이 분류·요약·규정검색의 공통 재료입니다.",
    spec: {
      engine: "faster-whisper large-v3-turbo (GPU · 온프레미스, 희창 백엔드 실가동) — 데모 백엔드는 whisper-1",
      io: "오디오 → 문장 단위 한국어 전사",
      status: "실가동",
      statusNote: "온프레미스 STT는 팀 백엔드에서 가동 중. 이 대시보드의 데모 백엔드는 whisper-1 호출 — 통합 시 일원화.",
      lines: [
        "전사본이 분류·요약·규정검색의 공통 재료",
        "침묵 감지(무응답 2단계)로 접수를 자동 종료",
      ],
    },
  },
  {
    id: "classify",
    label: "sLLM 분류·요약",
    tech: "EXAONE 3.5 · strict-JSON",
    icon: "psychology",
    explain:
      "언어모델이 발화를 요약하고 업무유형을 뽑습니다. 출력은 스키마 강제(strict-JSON) — 화면과 DB가 같은 계약(mvp-1.0)을 공유합니다.",
    spec: {
      engine: "EXAONE 3.5 7.8B (Ollama · 온프레미스, 팀 표준 sLLM — 희창 백엔드 실가동) · 데모 백엔드: gpt-4o-mini",
      io: "전사 → 요약·업무유형·부서·근거 (mvp-1.0 카드)",
      status: "실가동",
      statusNote: "요약·분류의 팀 표준은 EXAONE(한국어 특화, LG). 데모 백엔드는 gpt-4o-mini로 같은 계약(mvp-1.0)을 출력 — 온프렘 통합 시 EXAONE으로 일원화.",
      lines: [
        "부서 7종 라벨셋은 RAG 대분류와 코드 공유 — ETC는 문서 분류 전용 (부서 확정 = 검색 필터 확정)",
        "LLM 실패 시 긴급 콜 규칙 폴백",
      ],
    },
  },
  {
    id: "risk",
    label: "위험·감정 분석",
    tech: "사고징후 · 감정온도",
    icon: "warning",
    explain:
      "보이스피싱·명의도용 같은 사고 징후와 감정온도를 판단합니다. 긴급(E) 판정의 근거가 여기서 나옵니다.",
    spec: {
      engine: "사고징후: 긴급 규칙 + sLLM(EXAONE) 동시 산출 · 감정온도: eGeMAPS+LightGBM(박정운 음향 모델)",
      io: "전사·음향 → incident_risk(low/high) · 감정온도(안정/주의/고조)",
      status: "연동 대기",
      statusNote: "감정 융합 모델은 온프레미스 백엔드(이희창)에 완성·가동 — 이 파이프라인에는 미연동이라 화면 감정값은 [SOURCE=STUB] 데모값입니다.",
      lines: [
        "긴급(E) 판정의 근거가 여기서 나온다 — 사고징후 high → 긴급 게이트",
        "팀 최종안 진행 중: Urgency Score = 감정강도 + 위험신호 매칭 수 합산",
      ],
    },
  },
  {
    id: "persist",
    label: "상담카드 저장",
    tech: "PostgreSQL · mvp-1.0",
    icon: "database",
    explain:
      "STT·분류 결과가 계약 검증을 거쳐 한 트랜잭션으로 저장됩니다 — calls · transcripts · consultation_cards 3테이블.",
    spec: {
      engine: "PostgreSQL · mvp-1.0 계약(exactKeys 검증)",
      io: "카드 → calls · transcripts · consultation_cards (한 트랜잭션)",
      status: "실가동",
      statusNote: "관제의 '오늘 누적 상담카드'가 이 테이블의 실측 카운트입니다.",
      lines: [
        "계약 검증을 통과한 카드만 저장 — 프론트·백 스키마 불일치 차단",
        "raw 모델 결과(jsonb)도 함께 보관해 사후 감사 가능",
      ],
    },
  },
  {
    id: "route",
    label: "부서 라우팅",
    tech: "긴급 게이트 · 7부서 · E→S→G",
    icon: "alt_route",
    explain:
      "규칙 기반 긴급 게이트가 먼저 걸러내고(E→S→G 순 판정), 7개 부서 대기열에 배정합니다. 단순(S) 업무는 상담사 대신 ARS·AI가 받습니다.",
    spec: {
      engine: "카드 라우터 — 긴급 게이트(규칙, recall floor) → AI 분석 → 긴급 오버라이드",
      io: "카드 → S/G/E(1층) + 부서 7종(2층) + 업무코드(3층)",
      status: "실가동",
      statusNote: "hippo 7/22 확정 3층 taxonomy(부서 7종) — 긴급(E)이면 사고·신고(SG) 강제.",
      lines: [
        "S(단순)는 대기열 없이 ARS·AI 즉시 응대 — 사람 큐에는 G·E만",
        "긴급 규칙이 LLM 판단보다 먼저 건다 (안전 요건)",
      ],
    },
  },
  {
    id: "rag",
    label: "RAG 규정검색",
    tech: "pgvector · dense .65 + kw .35",
    icon: "menu_book",
    explain:
      "상담 맥락으로 규정·매뉴얼을 하이브리드 검색해 상담사 화면에 근거 조항을 띄웁니다. 라우팅과 같은 분류 축을 씁니다.",
    spec: {
      engine: "bge-m3(1024차원, 로컬) + pgvector HNSW · 하이브리드 dense .65 + keyword .35",
      io: "질의(+부서 필터) → 규정 청크(문서·페이지·조항·발췌)",
      status: "실가동",
      statusNote: "32문서 · 1,153청크 적재(실측) — PDF 업로드 시 청킹→임베딩→적재 즉시 반영.",
      lines: [
        "부서 코드 = RAG 분류 코드 — 라우팅 확정이 곧 검색 범위 확정",
        "개정본은 supersede 처리(옛 버전 보관, 삭제 없음)",
      ],
    },
  },
  {
    id: "wrap",
    label: "후처리 자동화",
    tech: "유형·결과·후속조치",
    icon: "edit_note",
    explain:
      "통화 종료와 동시에 후처리 초안이 자동 작성됩니다 — 상담사는 확인·보정만 합니다.",
    spec: {
      engine: "후처리 초안 생성 (현재 콜 유형별 프리셋 · LLM 생성 전환 계획)",
      io: "통화 → 상담 유형·결과·후속조치 초안",
      status: "데모 대체",
      statusNote: "상담사는 초안을 확인·보정만 — 저장 시 상담카드에 병합됩니다.",
      lines: [
        "통화 종료와 동시에 시트가 자동 상승 (통화→후처리 한 흐름)",
        "후속조치(콜백·SMS·이관 티켓)가 칩으로 제안된다",
      ],
    },
  },
];

/** 부서 대기열의 한 건 — 시드(가상)와 라이브(이벤트 유입)를 같은 모양으로 다룬다 */
export interface QueueItem {
  id: string;
  label: string;
  sge: Sge;
  /** 라이브 콜이면 callId, 시드 더미면 null */
  callId: string | null;
  /** 3층 업무코드(ARS 코드, taxonomy.py BUSINESS_CODES) — 미정의 부서(CRD·EFN·ETC)는 생략 */
  code?: string;
}

export const DEPARTMENTS = routingDepartments;

/** 구 부서 라벨 → 7부서 taxonomy 정규화.
 *  데모 픽스처(demoContent)의 카드가 아직 구 라벨을 쓰므로 보드 유입 시 여기서 흡수한다. */
const DEPT_ALIAS: Record<string, string> = {
  "대출 및 금융상담": "여신·대출",
  금융사기: "사고·신고",
  외화: "외환·수출입",
  전자금융: "전자금융·디지털",
  // 민원: 라우팅 큐 아님 — ETC는 RAG 문서 분류 전용 (7/22 확정 표)
  ARS: "카드·결제",
};

export function normalizeDeptLabel(label: string): string {
  const t = label.trim();
  return DEPT_ALIAS[t] ?? t;
}

/** 부서별 시드 대기열 — 대시보드가 비어 보이지 않게 하는 가상 현황.
 *  키는 rules.ts의 7부서 taxonomy. 라이브 이벤트(routing.assigned)가 이 위에 쌓인다.
 *  S(단순)는 상담사 대기열에 들어가지 않는다 — ARS·AI가 즉시 응대(별도 카운터). 그래서 G/E만. */
export const DEPT_SEED_QUEUES: Record<string, QueueItem[]> = {
  "수신·예적금": [{ id: "seed-dep-2", label: "이체한도 상향", sge: "G", callId: null, code: "G003" }],
  "여신·대출": [
    { id: "seed-lon-1", label: "주담대 만기 연장", sge: "G", callId: null, code: "G002" },
    { id: "seed-lon-2", label: "전세자금대출 조건변경", sge: "G", callId: null, code: "G002" },
  ],
  "카드·결제": [{ id: "seed-crd-3", label: "리볼빙 해지 문의", sge: "G", callId: null }],
  "외환·수출입": [{ id: "seed-fx-1", label: "해외송금 취소·반환", sge: "G", callId: null, code: "G010" }],
  "전자금융·디지털": [{ id: "seed-efn-2", label: "공동인증서 오류", sge: "G", callId: null }],
  "연금·신탁·투자": [{ id: "seed-inv-1", label: "IRP 디폴트옵션 안내", sge: "G", callId: null, code: "G011" }],
  "사고·신고": [
    { id: "seed-sg-1", label: "보이스피싱 의심 신고", sge: "E", callId: null, code: "G001" },
    { id: "seed-sg-2", label: "명의도용 지급정지", sge: "E", callId: null, code: "G001" },
  ],
};

/** 오늘 AI(ARS)가 자동 응대한 단순(S) 콜 시드 — S는 대기열이 아니라 이 카운터로 쌓인다 */
export const AI_HANDLED_SEED = 6;

/** 오늘 누적 상담카드 시드 — card.created 이벤트마다 +1 */
export const SEED_CARD_TOTAL = 12;

/** 피드 시드 — 켜자마자 "이미 돌아가는 시스템"으로 보이게 최근 처리분 몇 건을 깔아둔다.
 *  헤더의 누적 12건·부서 대기열 시드와 숫자 서사가 이어진다. minutesAgo = 표시 시각용. */
export interface SeedFeedItem {
  businessType: string;
  summary: string;
  department: string;
  sge: Sge;
  minutesAgo: number;
}

export const SEED_FEED: SeedFeedItem[] = [
  {
    businessType: "OTP 재발급",
    summary: "고객이 모바일 OTP 재발급 절차를 문의함 — 본인확인 후 정형 처리.",
    department: "전자금융·디지털",
    sge: "S",
    minutesAgo: 4,
  },
  {
    businessType: "전세자금대출 조건변경",
    summary: "고객이 전세자금대출 금리·만기 변경과 중도상환수수료를 복합 문의함.",
    department: "여신·대출",
    sge: "G",
    minutesAgo: 11,
  },
  {
    businessType: "명의도용 지급정지",
    summary: "본인 미신청 거래 문자 수신 — 지급정지 접수 및 사고 등록 처리.",
    department: "사고·신고",
    sge: "E",
    minutesAgo: 19,
  },
  {
    businessType: "해외송금 취소·반환",
    summary: "고객이 전일 해외송금 건의 취소 가능 여부와 반환 절차를 문의함.",
    department: "외환·수출입",
    sge: "G",
    minutesAgo: 27,
  },
];

/** 지식베이스(RAG) 통계 — database/rag 전처리 산출물 기준 상수 */
export const RAG_STATS = { docs: 32, chunks: 1153, categories: 8 } as const;

/** 관리자 단독 시연용 테스트 콜 픽스처 — 상담사 탭 없이도 파이프라인 전체가 재생된다.
 *  sge = 라우팅 1층(명시), department = 2층(7부서 taxonomy). */
export interface TestCallFixture {
  label: string;
  kind: DemoCallKind;
  sge: Sge;
  utterances: string[];
  card: {
    summary: string;
    businessType: string;
    businessCode?: string;
    department: string;
    routingReason: string;
    incidentRisk: MvpIncidentRisk;
    riskReason: string | null;
    confidence: number;
    emotionLevel: EmotionTemperatureLevel;
  };
}

export const TEST_CALLS: Record<Sge, TestCallFixture> = {
  S: {
    label: "단순 업무",
    kind: "normal",
    sge: "S",
    utterances: [
      "이번 달 카드 결제 금액이 얼마인지 확인하고 싶어요.",
      "지난달 명세서도 다시 받아볼 수 있을까요?",
    ],
    card: {
      summary: "고객이 카드 결제대금과 명세서 재발송을 문의함 — 정형 조회 업무.",
      businessType: "카드 사용내역·결제대금 조회",
      businessCode: "S001",
      department: "카드·결제",
      routingReason: "본인확인 후 정형화된 조회·재발송 절차 — ARS·AI 처리 가능",
      incidentRisk: "low",
      riskReason: null,
      confidence: 0.97,
      emotionLevel: "stable",
    },
  },
  G: {
    label: "일반 상담",
    kind: "normal",
    sge: "G",
    utterances: [
      "주택담보대출 만기가 다음 달인데 연장이 되는지 궁금해요.",
      "연장하려면 어떤 서류가 필요한가요?",
      "비대면으로도 진행할 수 있나요?",
    ],
    card: {
      summary: "고객이 주택담보대출 만기 연장 가능 여부와 필요 서류를 문의함.",
      businessType: "주택담보대출 만기 연장",
      businessCode: "G002",
      department: "여신·대출",
      routingReason: "약정 변경·재약정 심사 상담에 해당",
      incidentRisk: "low",
      riskReason: null,
      confidence: 0.88,
      emotionLevel: "caution",
    },
  },
  E: {
    label: "긴급 상담",
    kind: "urgent",
    sge: "E",
    utterances: [
      "금융감독원이라고 전화가 와서 제 통장이 범죄에 연루됐다고 했어요.",
      "안전계좌로 지금 송금하라고 하는데, 이거 사기 맞죠?",
    ],
    card: {
      summary: "고객이 금융감독원 사칭 전화로 안전계좌 송금을 요구받음 — 보이스피싱 의심.",
      businessType: "보이스피싱 의심",
      businessCode: "G001",
      department: "사고·신고",
      routingReason: "긴급 게이트 — 기관 사칭 + 송금 요구 정황, 사고·신고(SG) 강제",
      incidentRisk: "high",
      riskReason: "기관 사칭·안전계좌 송금 요구 감지 · 즉시 대응 필요",
      confidence: 0.93,
      emotionLevel: "elevated",
    },
  },
};
