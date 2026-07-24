import { useEffect, useMemo, useRef, useState } from "react";
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
 * 후처리 — AI 분류 검수·피드백 루프 (원탭 해피패스).
 * 주(主): 분류 판정. '맞음'은 한 번 탭으로 즉시 커밋(2.8초 실행취소), '수정 필요'만 폼을 펼친다.
 * 부(副): 초안 만족도(👍/👎)는 항상 보이는 선택 — 판정 커밋에 함께 실린다.
 * 팀원 백엔드와 동일 스키마(verdict + correction). 미연동이면 로컬 폴백.
 * 접근성: 모든 조작은 실제 <button> + aria-pressed + 포커스링(:focus-visible).
 */

const SGE_TO_ROUTING: Record<string, Routing> = { S: "SIMPLE", G: "GENERAL", E: "EMERGENCY" };
const ROUTINGS: { code: Routing; label: string }[] = [
  { code: "SIMPLE", label: "단순" },
  { code: "GENERAL", label: "일반" },
  { code: "EMERGENCY", label: "긴급" },
];
// '분류·라우팅'은 판정(맞음/수정)이 담당하므로 칩에서 제외. 감정온도+위험도는 하나로 병합.
const DRAFT_TAGS = ["부서", "업무유형", "요약 내용", "위험/감정 판단", "후속조치"];
const UNDO_MS = 2800;

/** 버튼 리셋 + 공통 스타일 — span onClick 대신 진짜 button 으로 키보드·포커스 확보 */
function btn(extra: string) {
  return css("appearance:none;border:none;background:none;margin:0;font:inherit;color:inherit;cursor:pointer;" + extra);
}

export default function ClassifierFeedback({ vm }: { vm: CallFlowVM }) {
  const [catalog, setCatalog] = useState<TaskCatalogItem[]>([]);
  const [stats, setStats] = useState<FeedbackStats | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [mode, setMode] = useState<"idle" | "correcting">("idle");
  const [corrRouting, setCorrRouting] = useState<Routing>(SGE_TO_ROUTING[vm.prepSge] ?? "GENERAL");
  const [corrTask, setCorrTask] = useState<string>("");
  const [corrReason, setCorrReason] = useState("");
  const [sat, setSat] = useState<"up" | "down" | null>(null);
  const [tags, setTags] = useState<Set<string>>(new Set());
  const [comment, setComment] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [pending, setPending] = useState(false); // '맞음' 커밋 대기(실행취소 가능)
  const [done, setDone] = useState<{ saved: boolean; local: boolean; count: number } | null>(null);
  const undoTimer = useRef<number | null>(null);

  useEffect(() => {
    fetchTaskCatalog().then(setCatalog);
    fetchFeedbackStats().then(setStats);
    startFeedbackSession().then(setSessionId);
    return () => {
      if (undoTimer.current) window.clearTimeout(undoTimer.current);
    };
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

  const doCommit = async (verdict: "correct" | "incorrect") => {
    setSubmitting(true);
    const prediction: Record<string, unknown> = {
      routing: SGE_TO_ROUTING[vm.prepSge] ?? "GENERAL",
      department_name: vm.prepRoutingTitle,
      task_name: vm.prepBusinessType,
      reason: vm.prepRoutingReason,
      engine: "k7-card-routing",
    };
    const noteParts = [
      sat ? `초안:${sat === "up" ? "만족" : "불만족"}` : "",
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
    setPending(false);
    setDone({ saved: res.saved, local: res.local, count: res.stats?.incorrect ?? stats?.incorrect ?? 0 });
    if (res.stats) setStats(res.stats);
  };

  // '맞음' = 원탭 커밋. 즉시 확인 상태로 넘어가고 2.8초 안에 실행취소하면 커밋을 취소한다.
  const tapCorrect = () => {
    setPending(true);
    undoTimer.current = window.setTimeout(() => {
      undoTimer.current = null;
      void doCommit("correct");
    }, UNDO_MS);
  };
  const undo = () => {
    if (undoTimer.current) window.clearTimeout(undoTimer.current);
    undoTimer.current = null;
    setPending(false);
  };

  const satBtn = (active: boolean, tone: "up" | "down") =>
    btn(
      "display:flex;align-items:center;justify-content:center;width:34px;height:30px;border-radius:8px;transition:background .12s;" +
        (active
          ? "background:" + (tone === "up" ? "var(--green-700)" : "var(--red-800)") + ";color:#fff"
          : "background:var(--onair-surface);color:var(--gray-600);border:1px solid var(--gray-300)")
    );

  return (
    <div style={css("background:var(--gray-100);border-radius:8px;padding:11px 12px;display:flex;flex-direction:column;gap:10px")}>
      <div style={css("display:flex;align-items:center;gap:5px")}>
        <span className="mi" style={css("font-size:16px;color:var(--blue-700)")}>rate_review</span>
        <span style={css("font:700 12.5px 'Geist Sans','Pretendard',sans-serif;color:var(--gray-1000)")}>AI 분류 검수</span>
        <div style={css("flex:1")} />
        {stats && (
          <span title="지금까지 상담사들이 교정한 사례 수 — 학습 데이터로 쌓입니다" style={css("font:600 10px 'Geist Sans','Pretendard',sans-serif;color:var(--gray-600);background:var(--onair-surface);border-radius:9999px;padding:2px 8px")}>수정 사례 {stats.incorrect}</span>
        )}
      </div>

      {done ? (
        <div style={css("display:flex;align-items:flex-start;gap:7px;background:var(--onair-surface);border-radius:8px;padding:10px 11px")}>
          <span className="mi" style={css("font-size:17px;color:var(--green-700);flex:none")}>{done.saved ? "check_circle" : "task_alt"}</span>
          <div>
            <div style={css("font:700 12px 'Geist Sans','Pretendard',sans-serif;color:var(--gray-1000)")}>
              {done.saved ? "학습 데이터로 반영됨" : done.local ? "기록됨 (로컬)" : "검수 완료"}
            </div>
            <div style={css("font:400 10.5px/1.4 'Geist Sans','Pretendard',sans-serif;color:var(--gray-600);margin-top:2px")}>
              {done.saved ? `수정 사례 ${done.count}건 · 같은 발화 재분류 시 즉시 반영` : "정확한 분류는 감사 로그에만 남습니다"}
            </div>
          </div>
        </div>
      ) : pending ? (
        // '맞음' 원탭 후 — 실행취소 가능한 확인 상태
        <div style={css("display:flex;align-items:center;gap:8px;background:var(--onair-surface);border-radius:8px;padding:10px 11px")}>
          <span className="mi" style={css("font-size:18px;color:var(--green-700)")}>check_circle</span>
          <span style={css("flex:1;font:700 12px 'Geist Sans','Pretendard',sans-serif;color:var(--gray-1000)")}>정확한 분류로 확인</span>
          <button type="button" onClick={undo} style={btn("font:700 11.5px 'Geist Sans','Pretendard',sans-serif;color:var(--blue-700);padding:4px 8px;border-radius:7px")}>실행취소</button>
        </div>
      ) : (
        <>
          <div style={css("font:600 10.5px 'Geist Sans','Pretendard',sans-serif;color:var(--gray-600)")}>이 상담의 AI 분류가 정확했나요?</div>
          <div style={css("display:flex;gap:6px")}>
            <button
              type="button"
              onClick={tapCorrect}
              disabled={submitting}
              style={btn("flex:1;display:flex;align-items:center;justify-content:center;gap:5px;font:700 12.5px 'Geist Sans','Pretendard',sans-serif;border-radius:8px;padding:9px 0;color:var(--green-900);background:var(--green-100);border:1px solid var(--green-400)")}
            >
              <span className="mi" style={css("font-size:16px")}>check</span>맞음
            </button>
            <button
              type="button"
              aria-pressed={mode === "correcting"}
              onClick={() => setMode(mode === "correcting" ? "idle" : "correcting")}
              style={btn("flex:1;display:flex;align-items:center;justify-content:center;gap:5px;font:700 12.5px 'Geist Sans','Pretendard',sans-serif;border-radius:8px;padding:9px 0;" + (mode === "correcting" ? "color:#fff;background:var(--red-800);border:1px solid var(--red-800)" : "color:var(--red-900);background:var(--red-100);border:1px solid var(--red-400)"))}
            >
              <span className="mi" style={css("font-size:16px")}>edit</span>수정 필요
            </button>
          </div>

          {mode === "correcting" && (
            <div style={css("display:flex;flex-direction:column;gap:7px;background:var(--onair-surface);border-radius:8px;padding:9px 10px")}>
              <span style={css("font:600 10px 'Geist Sans','Pretendard',sans-serif;color:var(--gray-500)")}>올바른 분류로 교정</span>
              {/* 라우팅 3개 — 네이티브 select 대신 필 토글(좁은 칼럼·a11y) */}
              <div style={css("display:flex;gap:4px")} role="group" aria-label="처리 유형">
                {ROUTINGS.map((r) => {
                  const on = corrRouting === r.code;
                  return (
                    <button key={r.code} type="button" aria-pressed={on} onClick={() => setCorrRouting(r.code)} style={btn("flex:1;font:700 11px 'Geist Sans','Pretendard',sans-serif;border-radius:7px;padding:6px 0;" + (on ? "background:var(--gray-1000);color:#fff" : "background:var(--gray-100);color:var(--gray-700);border:1px solid var(--gray-300)"))}>{r.label}</button>
                  );
                })}
              </div>
              <select value={corrTask} onChange={(e) => setCorrTask(e.target.value)} aria-label="업무 코드" style={css("width:100%;font:600 11.5px 'Geist Sans','Pretendard',sans-serif;color:var(--gray-1000);background:var(--gray-100);border:1px solid var(--gray-300);border-radius:8px;padding:7px 9px;cursor:pointer;outline:none")}>
                {taskOpts.length === 0 && <option value="">업무코드 불러오는 중…</option>}
                {taskOpts.map((t) => (<option key={t.code} value={t.code}>{t.code} · {t.name}</option>))}
              </select>
              <textarea value={corrReason} onChange={(e) => setCorrReason(e.target.value)} placeholder="왜 틀렸는지 / 올바른 근거 (선택)" rows={2} style={css("width:100%;resize:none;box-sizing:border-box;font:400 11px/1.4 'Geist Sans','Pretendard',sans-serif;color:var(--gray-1000);background:var(--gray-100);border:1px solid var(--gray-300);border-radius:8px;padding:7px 9px;outline:none")} />
              <button type="button" onClick={() => void doCommit("incorrect")} disabled={submitting || !corrTask} style={btn("display:flex;align-items:center;justify-content:center;gap:5px;font:700 12px 'Geist Sans','Pretendard',sans-serif;border-radius:8px;padding:9px 0;color:#fff;background:" + (submitting || !corrTask ? "var(--gray-300)" : "var(--blue-700)"))}>
                <span className="mi" style={css("font-size:15px")}>send</span>{submitting ? "저장 중…" : "교정 저장 · 학습에 반영"}
              </button>
            </div>
          )}

          {/* 부(副): 초안 만족도 — 항상 보이는 선택. 판정 커밋에 함께 실린다 */}
          <div style={css("display:flex;align-items:center;gap:7px;padding-top:2px;border-top:1px solid var(--gray-200)")}>
            <span style={css("font:600 10.5px 'Geist Sans','Pretendard',sans-serif;color:var(--gray-500)")}>초안 품질</span>
            <span style={css("font:400 9.5px 'Geist Sans','Pretendard',sans-serif;color:var(--gray-400)")}>선택</span>
            <div style={css("flex:1")} />
            <button type="button" aria-pressed={sat === "up"} aria-label="초안 만족" onClick={() => setSat((v) => (v === "up" ? null : "up"))} style={satBtn(sat === "up", "up")}><span className="mi" style={css("font-size:16px")}>thumb_up</span></button>
            <button type="button" aria-pressed={sat === "down"} aria-label="초안 불만족" onClick={() => setSat((v) => (v === "down" ? null : "down"))} style={satBtn(sat === "down", "down")}><span className="mi" style={css("font-size:16px")}>thumb_down</span></button>
          </div>

          {sat === "down" && (
            <>
              <div style={css("display:flex;flex-wrap:wrap;gap:5px")}>
                {DRAFT_TAGS.map((t) => {
                  const on = tags.has(t);
                  return (
                    <button key={t} type="button" aria-pressed={on} onClick={() => toggleTag(t)} style={btn("font:600 10px 'Geist Sans','Pretendard',sans-serif;border-radius:9999px;padding:4px 10px;" + (on ? "background:var(--gray-1000);color:#fff" : "background:var(--onair-surface);color:var(--gray-700);border:1px solid var(--gray-300)"))}>{t}</button>
                  );
                })}
              </div>
              <input value={comment} onChange={(e) => setComment(e.target.value)} placeholder="코멘트 (선택)" style={css("width:100%;box-sizing:border-box;font:400 11px 'Geist Sans','Pretendard',sans-serif;color:var(--gray-1000);background:var(--onair-surface);border:1px solid var(--gray-300);border-radius:8px;padding:7px 9px;outline:none")} />
            </>
          )}
        </>
      )}
    </div>
  );
}
