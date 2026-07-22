// S/G/E(단순·일반·긴급) 축 — 3층 라우팅 taxonomy의 1층 (routing).
// 원본: backend/app/routing/taxonomy.py. 판정 순서는 긴급 우선: E → S → G.
//   E = incident_risk high(또는 긴급 인입) · S = 정형 조회·신청(ARS·AI 처리) · G = 나머지 일반 상담
// 주의: 이 축은 부서 8종(2층)·업무코드(3층)와 다른 층이다 — 섞지 않는다.

export type Sge = "S" | "G" | "E";

export function deriveSge(
  risk: "low" | "high",
  department: string,
  kind?: "normal" | "urgent" | "transfer",
  /** 백엔드/픽스처가 routing(1층)을 명시하면 그 값이 우선한다 */
  routing?: Sge
): Sge {
  if (risk === "high" || kind === "urgent") return "E";
  if (routing) return routing;
  if (department === "ARS") return "S"; // 구 부서 라벨 호환
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
