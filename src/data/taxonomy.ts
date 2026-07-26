/**
 * 부서 분류 — **backend/app/routing/taxonomy.py 의 거울.**
 *
 * 원본은 백엔드다. 여기 값을 고칠 일이 생기면 taxonomy.py를 먼저 고치고 그 결과를
 * 옮겨 적는다. 프런트가 독자적으로 이름을 만들지 않는다.
 *
 * 왜 굳이 미러를 두는가: 부서 이름이 네 갈래로 갈려 있던 적이 있다
 * (taxonomy / LLM 프롬프트 / 손수 매핑 / 프런트 하드코딩). 모델이 지어낸 이름이
 * 매핑에 없으면 규정 필터가 조용히 풀렸고, 사고 건 유의사항에 '주택청약종합저축'이
 * 섞여 나왔다(0724 시연). 백엔드는 500ad1e에서 닫힌 집합으로 막았고, 프런트도
 * 문자열을 흩뿌리는 대신 한 곳에서 가져다 쓴다.
 *
 * 라벨은 **분류명**이다. 고객에게 말할 때는 뒤에 '팀'을 붙인다(deptTeam) —
 * "사고·신고로 연결해 드리겠습니다"는 어색하고 "사고·신고팀"이라야 사람 말이 된다.
 */

/** 부서코드 → 분류 라벨. taxonomy.py DEPARTMENTS와 1:1. */
export const DEPARTMENTS = {
  DEP: "수신·예적금",
  LON: "여신·대출",
  CRD: "카드·결제",
  FX: "외환·수출입",
  EFN: "전자금융·디지털",
  INV: "연금·신탁·투자",
  SG: "사고·신고", // 긴급(E) 전담 — E이면 반드시 SG
} as const;

export type DeptCode = keyof typeof DEPARTMENTS;
export type DeptLabel = (typeof DEPARTMENTS)[DeptCode];

/** 긴급 전담 부서 — taxonomy.py EMERGENCY_DEPARTMENT_CODE */
export const EMERGENCY_DEPT: DeptLabel = DEPARTMENTS.SG;

/** 고객에게 말할 때의 호칭 — 분류 라벨에 '팀'을 붙인다 */
export function deptTeam(label: DeptLabel): string {
  return `${label}팀`;
}

/** 분류 라벨이 맞는지 — 모르는 이름이면 false. 호출부가 '미분류'를 의식적으로 고르게 한다. */
export function isDeptLabel(value: string): value is DeptLabel {
  return (Object.values(DEPARTMENTS) as string[]).includes(value);
}

/**
 * 백엔드·모델이 준 부서명을 라벨로 정규화한다.
 * 모르는 이름이면 **null** — 아무 이름이나 지어내지 않는다(taxonomy.py normalize_department와 같은 태도).
 */
export function normalizeDept(value: unknown): DeptLabel | null {
  const s = String(value ?? "").trim();
  return isDeptLabel(s) ? s : null;
}

/** 부서를 모를 때 화면에 쓰는 말 — 가짜 부서명 대신 '아직 정해지지 않았다'를 말한다 */
export const DEPT_UNKNOWN = "미분류";
