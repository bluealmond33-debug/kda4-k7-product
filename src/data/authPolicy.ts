// 본인인증 필요 여부·시점·음성 매칭 기준. backend/app/routing/auth_policy.py 와 정책을 맞춘다.
// 초안 정책 — 실제 규정·컴플라이언스 확정 전까지는 화면 안내용이며 상담사 판단이 최종 기준이다.

/** 본인확인 불필요 — 특정 고객 정보 열람 없이 답할 수 있는 일반 안내성 문의.
 *  나머지 business_type은 안전 우선(recall floor)으로 전부 필요 처리한다. */
const AUTH_NOT_REQUIRED_BUSINESS_TYPES = new Set<string>([
  "고객 민원",
  "예적금 안내",
  "일반 상담",
]);

/** business_type으로 본인확인 필요 여부를 판정한다. */
export function requiresIdentityVerification(businessType: string | null | undefined): boolean {
  if (!businessType || AUTH_NOT_REQUIRED_BUSINESS_TYPES.has(businessType)) return false;
  return true;
}

/** 오답 재시도 임계값 — 2회 오답에서 재안내, 3회 오답에서 확인 어려움으로 전환 */
export const AUTH_RETRY_LIMIT = 3;

/** 6개 음성 안내 슬롯과 트리거 조건. 실제 TTS/오디오 연결 시 이 키로 음성을 매핑한다. */
export type AuthVoiceCue =
  | "request" // 본인확인 요청 — active 진입 직후, 인증 전 최초 1회
  | "digit_guide" // 8자리 안내 — request 직후, 입력 자릿수·형식 안내
  | "retry_guide" // 재시도 안내 — 1회차 오답(부드러운 재확인)
  | "mismatch" // 정보 불일치 — 2회차 오답(명확한 불일치 경고)
  | "verified" // 확인 완료 — 대조 성공
  | "verify_failed"; // 확인 어려움 — 3회차 오답(포기·다른 방식 유도/이관)

export const AUTH_VOICE_LABELS: Record<AuthVoiceCue, string> = {
  request: "본인확인 요청",
  digit_guide: "8자리 안내",
  retry_guide: "재시도 안내",
  mismatch: "정보 불일치",
  verified: "확인 완료",
  verify_failed: "확인 어려움",
};

/** 시도 횟수(1부터 시작)와 이번 시도의 일치 여부로 재생할 음성을 정한다.
 *  matched=true 이면 시도 횟수와 무관하게 "확인 완료". */
export function resolveAuthVoiceCue(attempt: number, matched: boolean): AuthVoiceCue {
  if (matched) return "verified";
  if (attempt >= AUTH_RETRY_LIMIT) return "verify_failed";
  if (attempt >= 2) return "mismatch";
  return "retry_guide";
}
