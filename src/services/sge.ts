// S/G/E(단순·일반·긴급) 축 — 리터럴 enum이 계약에 없으므로 여기가 단일 파생 정의처다.
// 판정 순서는 긴급 우선: E → S → G.
//   E = incident_risk high(또는 긴급 인입) · S = ARS 셀프서비스 부서 · G = 나머지 일반 상담
// 주의: 이 축은 RAG 8대분류(categories)·이관 부서(department)와 다른 축이다 — 섞지 않는다.

export type Sge = "S" | "G" | "E";

export function deriveSge(
  risk: "low" | "high",
  department: string,
  kind?: "normal" | "urgent" | "transfer"
): Sge {
  if (risk === "high" || kind === "urgent") return "E";
  if (department === "ARS") return "S";
  return "G";
}

/** S=초록 · G=파랑 · E=빨강 — 참조 라우팅 데모와 동일한 컬러 규약 (ONAIR 토큰만 사용) */
export const SGE_META: Record<
  Sge,
  { label: string; desc: string; fg: string; bg: string; bar: string }
> = {
  S: {
    label: "단순",
    desc: "ARS·AI 셀프서비스 처리",
    fg: "var(--green-900)",
    bg: "var(--green-100)",
    bar: "var(--green-700)",
  },
  G: {
    label: "일반",
    desc: "일반 상담사 대기열 배정",
    fg: "var(--blue-900)",
    bg: "var(--blue-100)",
    bar: "var(--blue-700)",
  },
  E: {
    label: "긴급",
    desc: "사고 징후 · 긴급 우선 배정",
    fg: "var(--red-900)",
    bg: "var(--red-100)",
    bar: "var(--red-700)",
  },
};
