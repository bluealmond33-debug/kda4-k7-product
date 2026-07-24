// 분류기 개선 피드백 루프 — 후처리 화면에서 상담사가 AI 분류 판정을 검수/교정하면
// 백엔드(/api/v1/classifier/*)로 보내 edge_cases.jsonl에 학습 데이터로 축적된다.
// 팀원 "K7 분류기 실험실"과 동일 스키마: verdict(correct/incorrect) + correction(routing/task_code/reason).
// 백엔드가 없으면(available:false) 조용히 로컬 폴백 — 화면은 그대로 동작한다.

import { API_BASE_URL, DATA_API_PREFIX } from "./config";

export type Routing = "SIMPLE" | "GENERAL" | "EMERGENCY";

export interface TaskCatalogItem {
  code: string;
  name: string;
  routing: Routing;
  department: string;
  business_code: string;
}

export interface FeedbackStats {
  total: number;
  incorrect: number;
  reusable_edge_cases: number;
}

/** 상담사가 교정한 올바른 분류 — 서버가 task_code로 부서·업무명·handler를 재파생한다 */
export interface FeedbackCorrection {
  routing: Routing;
  task_code: string;
  department?: string;
  reason?: string;
}

export interface FeedbackPayload {
  text: string;
  source: string;
  session_id?: string | null;
  prediction: Record<string, unknown>;
  verdict: "correct" | "incorrect";
  correction: FeedbackCorrection | null;
  tags: string[];
  note?: string;
}

const base = () => `${API_BASE_URL}${DATA_API_PREFIX}/classifier`;
export const feedbackEnabled = !!API_BASE_URL;

/** 검토 세션 시작 — session_id를 받아 이후 feedback에 함께 보낸다(없어도 저장은 됨) */
export async function startFeedbackSession(): Promise<string | null> {
  if (!feedbackEnabled) return null;
  try {
    const res = await fetch(`${base()}/session/start`, { method: "POST" });
    if (!res.ok) return null;
    const d = (await res.json()) as { session_id?: string };
    return d.session_id ?? null;
  } catch {
    return null;
  }
}

/** 교정 드롭다운용 업무 카탈로그 — routing으로 필터해 task_code 후보를 좁힌다 */
export async function fetchTaskCatalog(): Promise<TaskCatalogItem[]> {
  if (!feedbackEnabled) return [];
  try {
    const res = await fetch(`${base()}/catalog`);
    if (!res.ok) return [];
    const d = (await res.json()) as { tasks?: TaskCatalogItem[] };
    return d.tasks ?? [];
  } catch {
    return [];
  }
}

export async function fetchFeedbackStats(): Promise<FeedbackStats | null> {
  if (!feedbackEnabled) return null;
  try {
    const res = await fetch(`${base()}/stats`);
    if (!res.ok) return null;
    return (await res.json()) as FeedbackStats;
  } catch {
    return null;
  }
}

export interface FeedbackResult {
  saved: boolean;
  stats: FeedbackStats | null;
  /** 백엔드 미연동/실패 시 true — 로컬 폴백으로 처리됨 */
  local: boolean;
}

/** 피드백 제출 — 실패/미연동이면 local:true 로 폴백(데모가 끊기지 않게) */
export async function submitClassifierFeedback(
  payload: FeedbackPayload
): Promise<FeedbackResult> {
  if (!feedbackEnabled) return { saved: false, stats: null, local: true };
  try {
    const res = await fetch(`${base()}/feedback`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) return { saved: false, stats: null, local: true };
    const d = (await res.json()) as { saved: boolean; stats: FeedbackStats };
    return { saved: d.saved, stats: d.stats, local: false };
  } catch {
    return { saved: false, stats: null, local: true };
  }
}
