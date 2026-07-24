import { useEffect, useMemo, useState } from "react";
import { css } from "../../lib/css";
import type { CallFlowVM } from "../../hooks/useCallFlow";
import {
  fetchTaskCatalog,
  fetchFeedbackStats,
  startFeedbackSession,
  submitClassifierFeedback,
  type TaskCatalogItem,
  type Routing,
  type FeedbackStats,
} from "../../services/classifierFeedback";

/**
 * 후처리 화면 — AI 분류 검수·피드백 루프.
 * A) 분류 판정 맞음/수정(팀원 백엔드와 동일 스키마 → edge_cases.jsonl에 학습 데이터로 축적)
 * B) 후처리 만족도 + 아쉬운 부분 태그 + 코멘트(확장 — note/tags로 기록)
 * 백엔드 미연동이면 로컬 폴백으로 "기록됨" 처리(데모가 끊기지 않게).
 */

const ROUTINGS: { code: Routing; label: string }[] = [
  { code: "SIMPLE", label: "단순 · ARS/AI" },
  { code: "GENERAL", label: "일반 상담" },
  { code: "EMERGENCY", label: "긴급 · 사고" },
];
const SGE_TO_ROUTING: Record<string, Routing> = { S: "SIMPLE", G: "GENERAL", E: "EMERGENCY" };
const ERROR_TAGS = ["분류·라우팅", "부서", "업무유형", "요약 내용", "감정온도", "위험도", "후속조치"];

export default function ClassifierFeedback({ vm }: { vm: CallFlowVM }) {
  const [catalog, setCatalog] = useState<TaskCatalogItem[]>([]);
  const [stats, setStats] = useState<FeedbackStats | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [verdict, setVerdict] = useState<"correct" | "incorrect" | null>(null);
  const [corrRouting, setCorrRouting] = useState<Routing>(SGE_TO_ROUTING[vm.prepSge] ?? "GENERAL");
  const [corrTask, setCorrTask] = useState<string>("");
  const [corrReason, setCorrReason] = useState("");
  const [sat, setSat] = useState<"up" | "down" | null>(null);
  const [tags, setTags] = useState<Set<string>>(new Set());
  const [comment, setComment] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState<{ saved: boolean; local: boolean; count: number } | null>(null);

  useEffect(() => {
    fetchTaskCatalog().then(setCatalog);
    fetchFeedbackStats().then(setStats);
    startFeedbackSession().then(setSessionId);
  }, []);

  const taskOpts = useMemo(() => catalog.filter((t) => t.routing === corrRouting), [catalog, corrRouting]);
  useEffect(() => {
    if (taskOpts.length && !taskOpts.some((t) => t.code === corrTask)) setCorrTask(taskOpts[0].code);
  }, [taskOpts, corrTask]);

  const toggleTag = (t: string) =>
    setTags((s) => {
      const n = new Set(s);
      if (n.has(t)) n.delete(t);
      else n.add(t);
      return n;
    });

  const submit = async () => {
    if (!verdict || submitting) return;
    setSubmitting(true);
    const prediction: Record<string, unknown> = {
      routing: SGE_TO_ROUTING[vm.prepSge] ?? "GENERAL",
      department_name: vm.prepRoutingTitle,
      task_name: vm.prepBusinessType,
      reason: vm.prepRoutingReason,
      engine: "k7-card-routing",
    };
    const noteParts = [
      sat ? `만족도:${sat === "up" ? "만족" : "불만족"}` : "",
      tags.size ? `아쉬운 부분:${[...tags].join(",")}` : "",
      comment.trim(),
    ].filter(Boolean);
    const res = await submitClassifierFeedback({
      text: vm.transcriptQuote || vm.prepBusinessType,
      source: "wrap-up",
      session_id: sessionId,
      prediction,
      verdict,
      correction:
        verdict === "incorrect"
          ? { routing: corrRouting, task_code: corrTask, reason: corrReason || undefined }
          : null,
      tags: ["human-reviewed", verdict === "incorrect" ? "edge-case" : "confirmed", "wrap-up", ...tags],
      note: noteParts.join(" · "),
    });
    setSubmitting(false);
    setDone({ saved: res.saved, local: res.local, count: res.stats?.incorrect ?? stats?.incorrect ?? 0 });
    if (res.stats) setStats(res.stats);
  };

  const selStyle = (active: boolean) =>
    css(
      "width:100%;font:600 11.5px 'Geist Sans','Pretendard',sans-serif;color:var(--gray-1000);background:var(--onair-surface);border:1px solid " +
        (active ? "var(--blue-400)" : "var(--gray-300)") +
        ";border-radius:8px;padding:7px 9px;cursor:pointer;outline:none"
    );

  return (
    <div style={css("background:var(--gray-100);border-radius:8px;padding:11px 12px;display:flex;flex-direction:column;gap:9px")}>
      <div style={css("display:flex;align-items:center;gap:5px")}>
        <span className="mi" style={css("font-size:16px;color:var(--blue-700)")}>rate_review</span>
        <span style={css("font:700 12px 'Geist Sans','Pretendard',sans-serif;color:var(--gray-1000)")}>AI 검수 · 피드백</span>
        <div style={css("flex:1")} />
        {stats && (
          <span title="지금까지 쌓인 학습 후보(수정 사례)" style={css("font:600 9.5px 'Geist Mono',monospace;color:var(--gray-500);background:var(--onair-surface);border-radius:9999px;padding:2px 7px")}>학습 {stats.incorrect}건</span>
        )}
      </div>

      {done ? (
        <div style={css("display:flex;align-items:flex-start;gap:7px;background:var(--onair-surface);border-radius:8px;padding:10px 11px")}>
          <span className="mi" style={css("font-size:17px;color:var(--green-700);flex:none")}>{done.saved ? "check_circle" : "task_alt"}</span>
          <div>
            <div style={css("font:700 11.5px 'Geist Sans','Pretendard',sans-serif;color:var(--gray-1000)")}>
              {done.saved ? "학습 데이터로 저장됨" : done.local ? "기록됨 (로컬)" : "피드백 접수됨"}
            </div>
            <div style={css("font:400 10.5px/1.4 'Geist Sans','Pretendard',sans-serif;color:var(--gray-600);margin-top:2px")}>
              {done.saved
                ? `학습 후보 ${done.count}건 · 같은 발화 재분류 시 즉시 반영됩니다`
                : "판정이 정확한 경우는 감사 로그에만 남습니다"}
            </div>
          </div>
        </div>
      ) : (
        <>
          {/* A. 분류 판정 검수 */}
          <div style={css("font:600 10.5px 'Geist Sans','Pretendard',sans-serif;color:var(--gray-600)")}>이 상담의 AI 분류가 정확했나요?</div>
          <div style={css("display:flex;gap:6px")}>
            <span
              onClick={() => setVerdict("correct")}
              style={css("flex:1;display:flex;align-items:center;justify-content:center;gap:4px;font:700 11.5px 'Geist Sans','Pretendard',sans-serif;border-radius:8px;padding:7px 0;cursor:pointer;" + (verdict === "correct" ? "background:var(--green-700);color:#fff" : "background:var(--onair-surface);color:var(--gray-800);border:1px solid var(--gray-300)"))}
            >
              <span className="mi" style={css("font-size:15px")}>check</span>맞음
            </span>
            <span
              onClick={() => setVerdict("incorrect")}
              style={css("flex:1;display:flex;align-items:center;justify-content:center;gap:4px;font:700 11.5px 'Geist Sans','Pretendard',sans-serif;border-radius:8px;padding:7px 0;cursor:pointer;" + (verdict === "incorrect" ? "background:var(--red-800);color:#fff" : "background:var(--onair-surface);color:var(--gray-800);border:1px solid var(--gray-300)"))}
            >
              <span className="mi" style={css("font-size:15px")}>edit</span>수정 필요
            </span>
          </div>

          {verdict === "incorrect" && (
            <div style={css("display:flex;flex-direction:column;gap:6px;background:var(--onair-surface);border-radius:8px;padding:9px 10px")}>
              <span style={css("font:600 10px 'Geist Sans','Pretendard',sans-serif;color:var(--gray-500)")}>올바른 분류로 교정</span>
              <select value={corrRouting} onChange={(e) => setCorrRouting(e.target.value as Routing)} style={selStyle(true)}>
                {ROUTINGS.map((r) => (<option key={r.code} value={r.code}>{r.label}</option>))}
              </select>
              <select value={corrTask} onChange={(e) => setCorrTask(e.target.value)} style={selStyle(true)}>
                {taskOpts.length === 0 && <option value="">업무코드 불러오는 중…</option>}
                {taskOpts.map((t) => (<option key={t.code} value={t.code}>{t.code} · {t.name}</option>))}
              </select>
              <textarea
                value={corrReason}
                onChange={(e) => setCorrReason(e.target.value)}
                placeholder="왜 틀렸는지 / 올바른 판단 근거 (선택)"
                rows={2}
                style={css("width:100%;resize:none;font:400 11px/1.4 'Geist Sans','Pretendard',sans-serif;color:var(--gray-1000);background:var(--onair-surface);border:1px solid var(--gray-300);border-radius:8px;padding:7px 9px;outline:none")}
              />
            </div>
          )}

          {/* B. 후처리 만족도 + 아쉬운 부분 */}
          <div style={css("display:flex;align-items:center;gap:7px")}>
            <span style={css("font:600 10.5px 'Geist Sans','Pretendard',sans-serif;color:var(--gray-600)")}>후처리 만족도</span>
            <div style={css("flex:1")} />
            <span onClick={() => setSat((v) => (v === "up" ? null : "up"))} title="만족" style={css("display:flex;align-items:center;justify-content:center;width:30px;height:26px;border-radius:7px;cursor:pointer;" + (sat === "up" ? "background:var(--green-700);color:#fff" : "background:var(--onair-surface);color:var(--gray-600);border:1px solid var(--gray-300)"))}>
              <span className="mi" style={css("font-size:16px")}>thumb_up</span>
            </span>
            <span onClick={() => setSat((v) => (v === "down" ? null : "down"))} title="불만족" style={css("display:flex;align-items:center;justify-content:center;width:30px;height:26px;border-radius:7px;cursor:pointer;" + (sat === "down" ? "background:var(--red-800);color:#fff" : "background:var(--onair-surface);color:var(--gray-600);border:1px solid var(--gray-300)"))}>
              <span className="mi" style={css("font-size:16px")}>thumb_down</span>
            </span>
          </div>

          {sat === "down" && (
            <div style={css("display:flex;flex-wrap:wrap;gap:5px")}>
              {ERROR_TAGS.map((t) => {
                const on = tags.has(t);
                return (
                  <span key={t} onClick={() => toggleTag(t)} style={css("font:600 10px 'Geist Sans','Pretendard',sans-serif;border-radius:9999px;padding:3px 9px;cursor:pointer;" + (on ? "background:var(--blue-700);color:#fff" : "background:var(--onair-surface);color:var(--gray-700);border:1px solid var(--gray-300)"))}>
                    {t}
                  </span>
                );
              })}
            </div>
          )}

          <input
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder="코멘트 (선택)"
            style={css("width:100%;font:400 11px 'Geist Sans','Pretendard',sans-serif;color:var(--gray-1000);background:var(--onair-surface);border:1px solid var(--gray-300);border-radius:8px;padding:7px 9px;outline:none;box-sizing:border-box")}
          />

          <span
            onClick={submit}
            style={css("display:flex;align-items:center;justify-content:center;gap:5px;font:700 12px 'Geist Sans','Pretendard',sans-serif;border-radius:8px;padding:9px 0;cursor:" + (verdict && !submitting ? "pointer" : "not-allowed") + ";background:" + (verdict && !submitting ? "var(--blue-700)" : "var(--gray-300)") + ";color:#fff")}
          >
            <span className="mi" style={css("font-size:16px")}>{submitting ? "hourglass_top" : "send"}</span>
            {submitting ? "제출 중…" : "피드백 제출"}
          </span>
        </>
      )}
    </div>
  );
}
