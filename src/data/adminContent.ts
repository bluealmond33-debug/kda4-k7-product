// 관리자 대시보드(?role=admin) 정적 콘텐츠 — 파이프라인 노드 정의, 부서 시드 대기열,
// 지식베이스 통계, 단독 시연용 테스트 콜 픽스처.
// 부서 목록의 원본은 stt-classification 규칙(rules.ts) — 여기서 재정의하지 않는다.

import { routingDepartments } from "../features/stt-classification/rules";
import type { DemoCallKind, PipelineStageId, Sge } from "../services";
import type { EmotionTemperatureLevel, MvpIncidentRisk } from "../services";

/** 백엔드 프로세스 플로우의 8개 노드 — 발표에서 "이래서 이렇게 연결된다"를 말하는 자리.
 *  tech = 기술 캡션(항상 표시) · explain = 설명 모드에서 펼쳐지는 근거 문장 */
export interface PipelineNodeDef {
  id: PipelineStageId;
  label: string;
  tech: string;
  icon: string;
  explain: string;
}

export const PIPELINE_NODES: PipelineNodeDef[] = [
  {
    id: "utterance",
    label: "고객 발화",
    tech: "전화 인입 · 자연어 접수",
    icon: "call",
    explain:
      "ARS 버튼 트리 없이 고객이 평소처럼 말합니다. 이 발화 하나가 뒤의 모든 처리의 입력이 됩니다.",
  },
  {
    id: "stt",
    label: "실시간 STT",
    tech: "Whisper · 문장 단위 전사",
    icon: "graphic_eq",
    explain:
      "음성이 문장 단위 텍스트로 바뀝니다. 이 전사본이 분류·요약·규정검색의 공통 재료입니다.",
  },
  {
    id: "classify",
    label: "sLLM 분류·요약",
    tech: "strict-JSON · 업무유형·요약",
    icon: "psychology",
    explain:
      "언어모델이 발화를 요약하고 업무유형을 뽑습니다. 출력은 스키마 강제(strict-JSON) — 화면과 DB가 같은 계약(mvp-1.0)을 공유합니다.",
  },
  {
    id: "risk",
    label: "위험·감정 분석",
    tech: "사고징후 low/high · 감정온도",
    icon: "warning",
    explain:
      "보이스피싱·명의도용 같은 사고 징후와 감정온도를 판단합니다. 긴급(E) 판정의 근거가 여기서 나옵니다.",
  },
  {
    id: "persist",
    label: "상담카드 저장",
    tech: "PostgreSQL · mvp-1.0",
    icon: "database",
    explain:
      "STT·분류 결과가 계약 검증을 거쳐 한 트랜잭션으로 저장됩니다 — calls · transcripts · consultation_cards 3테이블.",
  },
  {
    id: "route",
    label: "부서 라우팅",
    tech: "긴급 게이트 + 8부서 · E→S→G",
    icon: "alt_route",
    explain:
      "규칙 기반 긴급 게이트가 먼저 걸러내고(E→S→G 순 판정), 8개 부서 대기열에 배정합니다. 단순(S) 업무는 상담사 대신 ARS·AI가 받습니다.",
  },
  {
    id: "rag",
    label: "RAG 규정검색",
    tech: "pgvector · 밀집 0.65 + 키워드 0.35",
    icon: "menu_book",
    explain:
      "상담 맥락으로 규정·매뉴얼을 하이브리드 검색해 상담사 화면에 근거 조항을 띄웁니다. 라우팅과 같은 분류 축을 씁니다.",
  },
  {
    id: "wrap",
    label: "후처리 자동화",
    tech: "유형·결과·후속조치 초안",
    icon: "edit_note",
    explain:
      "통화 종료와 동시에 후처리 초안이 자동 작성됩니다 — 상담사는 확인·보정만 합니다.",
  },
];

/** 부서 대기열의 한 건 — 시드(가상)와 라이브(이벤트 유입)를 같은 모양으로 다룬다 */
export interface QueueItem {
  id: string;
  label: string;
  sge: Sge;
  /** 라이브 콜이면 callId, 시드 더미면 null */
  callId: string | null;
}

export const DEPARTMENTS = routingDepartments;

/** 구 부서 라벨 → 8부서 taxonomy 정규화.
 *  데모 픽스처(demoContent)의 카드가 아직 구 라벨을 쓰므로 보드 유입 시 여기서 흡수한다. */
const DEPT_ALIAS: Record<string, string> = {
  "대출 및 금융상담": "여신·대출",
  금융사기: "사고·신고",
  외화: "외환·수출입",
  전자금융: "전자금융·디지털",
  민원: "제도·민원·기타",
  ARS: "카드·결제",
};

export function normalizeDeptLabel(label: string): string {
  const t = label.trim();
  return DEPT_ALIAS[t] ?? t;
}

/** 부서별 시드 대기열 — 대시보드가 비어 보이지 않게 하는 가상 현황.
 *  키는 rules.ts의 8부서 taxonomy. 라이브 이벤트(routing.assigned)가 이 위에 쌓인다. */
export const DEPT_SEED_QUEUES: Record<string, QueueItem[]> = {
  "수신·예적금": [
    { id: "seed-dep-1", label: "잔액·거래내역 조회", sge: "S", callId: null },
    { id: "seed-dep-2", label: "이체한도 상향", sge: "G", callId: null },
  ],
  "여신·대출": [
    { id: "seed-lon-1", label: "주담대 만기 연장", sge: "G", callId: null },
    { id: "seed-lon-2", label: "전세자금대출 조건변경", sge: "G", callId: null },
  ],
  "카드·결제": [
    { id: "seed-crd-1", label: "카드 사용내역 조회", sge: "S", callId: null },
    { id: "seed-crd-2", label: "결제대금 확인", sge: "S", callId: null },
    { id: "seed-crd-3", label: "리볼빙 해지 문의", sge: "G", callId: null },
  ],
  "외환·수출입": [{ id: "seed-fx-1", label: "해외송금 취소·반환", sge: "G", callId: null }],
  "전자금융·디지털": [
    { id: "seed-efn-1", label: "OTP 재발급", sge: "S", callId: null },
    { id: "seed-efn-2", label: "공동인증서 오류", sge: "G", callId: null },
  ],
  "연금·신탁·투자": [{ id: "seed-inv-1", label: "IRP 디폴트옵션 안내", sge: "G", callId: null }],
  "사고·신고": [
    { id: "seed-sg-1", label: "보이스피싱 의심 신고", sge: "E", callId: null },
    { id: "seed-sg-2", label: "명의도용 지급정지", sge: "E", callId: null },
  ],
  "제도·민원·기타": [{ id: "seed-etc-1", label: "피해보상 요구", sge: "G", callId: null }],
};

/** 오늘 누적 상담카드 시드 — card.created 이벤트마다 +1 */
export const SEED_CARD_TOTAL = 12;

/** 지식베이스(RAG) 통계 — database/rag 전처리 산출물 기준 상수 */
export const RAG_STATS = { docs: 32, chunks: 1153, categories: 8 } as const;

/** 관리자 단독 시연용 테스트 콜 픽스처 — 상담사 탭 없이도 파이프라인 전체가 재생된다.
 *  sge = 라우팅 1층(명시), department = 2층(8부서 taxonomy). */
export interface TestCallFixture {
  label: string;
  kind: DemoCallKind;
  sge: Sge;
  utterances: string[];
  card: {
    summary: string;
    businessType: string;
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
      department: "사고·신고",
      routingReason: "긴급 게이트 — 기관 사칭 + 송금 요구 정황, 사고·신고(SG) 강제",
      incidentRisk: "high",
      riskReason: "기관 사칭·안전계좌 송금 요구 감지 · 즉시 대응 필요",
      confidence: 0.93,
      emotionLevel: "elevated",
    },
  },
};
