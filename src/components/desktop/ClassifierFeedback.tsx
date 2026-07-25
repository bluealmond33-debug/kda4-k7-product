import { useEffect, useRef, useState } from "react";
import { css } from "../../lib/css";
import { ThumbsUp, ThumbsDown } from "lucide-react";
import type { CallFlowVM } from "../../hooks/useCallFlow";
import {
  fetchFeedbackStats,
  startFeedbackSession,
  submitClassifierFeedback,
  type Routing,
  type FeedbackStats,
} from "../../services/classifierFeedback";

/**
 * 후처리 결과 품질 평가 — 저장 직전에 누르는 엄지 두 개.
 *
 * 검수 폼(맞음/수정 필요·업무코드 교정)은 걷어냈다. 상담사에게 통화 끝의 마지막 1초는
 * '판정'이 아니라 '저장'이고, 판정 UI가 그 앞을 막으면 아무도 누르지 않는다.
 * 👍는 한 번 누르면 끝, 👎일 때만 무엇이 아쉬웠는지 선택창이 뜬다.
 *
 * 학습 신호는 그대로 백엔드로 간다 — 👎(+태그·코멘트)를 incorrect 로,
 * 👍를 correct 로 실어 보낸다. 상담사가 분류를 직접 교정하는 화면은 없앴으므로
 * 태그(부서·업무유형 등)가 '무엇이 틀렸는지'를 대신 말해 준다.
 */

const SGE_TO_ROUTING: Record<string, Routing> = { S: "SIMPLE", G: "GENERAL", E: "EMERGENCY" };
const DRAFT_TAGS = ["부서", "업무유형", "요약 내용", "위험/감정 판단", "후속조치"];
const FONT = "'Avenir Next','Pretendard',sans-serif";

function btn(extra: string) {
  return css("appearance:none;border:none;background:none;margin:0;font:inherit;color:inherit;cursor:pointer;" + extra);
}

export default function ClassifierFeedback({ vm }: { vm: CallFlowVM }) {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [stats, setStats] = useState<FeedbackStats | null>(null);
  const [sat, setSat] = useState<"up" | "down" | null>(null);
  const [open, setOpen] = useState(false);
  const [tags, setTags] = useState<Set<string>>(new Set());
  const [comment, setComment] = useState("");
  const [sent, setSent] = useState(false);
  const sending = useRef(false);

  useEffect(() => {
    startFeedbackSession().then(setSessionId);
    fetchFeedbackStats().then(setStats);
  }, []);

  const toggleTag = (t: string) =>
    setTags((s) => {
      const n = new Set(s);
      if (n.has(t)) n.delete(t);
      else n.add(t);
      return n;
    });

  const send = async (verdict: "correct" | "incorrect", extraTags: string[], note: string) => {
    if (sending.current) return;
    sending.current = true;
    const res = await submitClassifierFeedback({
      text: vm.transcriptQuote || vm.prepBusinessType,
      source: "wrap-up",
      session_id: sessionId,
      prediction: {
        routing: SGE_TO_ROUTING[vm.prepSge] ?? "GENERAL",
        department_name: vm.prepRoutingTitle,
        task_name: vm.prepBusinessType,
        reason: vm.prepRoutingReason,
        engine: "k7-card-routing",
      },
      verdict,
      correction: null,
      tags: ["human-reviewed", "wrap-up", verdict === "incorrect" ? "draft-poor" : "draft-good", ...extraTags],
      note,
    });
    if (res.stats) setStats(res.stats);
    sending.current = false;
    setSent(true);
  };

  const thumb = (active: boolean, tone: "up" | "down") =>
    btn(
      "display:flex;align-items:center;justify-content:center;width:36px;height:32px;border-radius:9px;transition:background .12s;" +
        (active
          ? "background:" + (tone === "up" ? "var(--green-700)" : "var(--red-800)") + ";color:#fff"
          : "background:var(--onair-surface);color:var(--gray-700);border:1px solid var(--gray-300)")
    );

  /** 엄지 아이콘 — lucide(둥근 라인캡·라운드 조인). 머티리얼 심볼의 각진 엄지 대신 부드러운 형태.
   *  고르면 같은 색으로 채워 선택 상태를 굵기가 아니라 면으로 말한다. */
  const Thumb = ({ dir, active }: { dir: "up" | "down"; active: boolean }) => {
    const Icon = dir === "up" ? ThumbsUp : ThumbsDown;
    return (
      <Icon
        size={17}
        strokeWidth={2}
        absoluteStrokeWidth
        fill={active ? "currentColor" : "none"}
        style={{ display: "block" }}
      />
    );
  };

  return (
    <span style={css("display:inline-flex;align-items:center;gap:7px;flex:none")}>
      <span style={css("font:600 11.5px " + FONT + ";color:var(--gray-700);white-space:nowrap")}>
        {sent ? "평가 감사합니다" : "결과 품질"}
      </span>
      <button
        type="button"
        aria-pressed={sat === "up"}
        aria-label="후처리 결과 만족"
        title="후처리 결과가 쓸 만했어요"
        onClick={() => {
          setSat("up");
          setOpen(false);
          void send("correct", [], "초안:만족");
        }}
        style={thumb(sat === "up", "up")}
      >
        <Thumb dir="up" active={sat === "up"} />
      </button>
      <span style={css("position:relative;display:inline-flex")}>
        <button
          type="button"
          aria-pressed={sat === "down"}
          aria-label="후처리 결과 불만족"
          title="아쉬운 점을 알려주세요"
          onClick={() => {
            setSat("down");
            setOpen(true);
          }}
          style={thumb(sat === "down", "down")}
        >
          <Thumb dir="down" active={sat === "down"} />
        </button>
        {open && (
          <>
            <span onClick={() => setOpen(false)} style={css("position:fixed;inset:0;z-index:40")} />
            <div style={css("position:absolute;right:0;bottom:calc(100% + 10px);z-index:41;width:286px;background:var(--onair-surface);border-radius:10px;box-shadow:var(--sh-modal);padding:13px;display:flex;flex-direction:column;gap:9px")}>
              <span style={css("font:700 11.5px " + FONT + ";color:var(--gray-1000)")}>
                어떤 점이 아쉬웠나요? <span style={css("font-weight:400;color:var(--gray-600)")}>· 선택</span>
              </span>
              <div style={css("display:flex;flex-wrap:wrap;gap:5px")}>
                {DRAFT_TAGS.map((t) => {
                  const on = tags.has(t);
                  return (
                    <button key={t} type="button" aria-pressed={on} onClick={() => toggleTag(t)} style={btn("font:600 10.5px " + FONT + ";border-radius:9999px;padding:5px 11px;" + (on ? "background:var(--gray-1000);color:#fff" : "background:var(--onair-surface);color:var(--gray-800);border:1px solid var(--gray-300)"))}>{t}</button>
                  );
                })}
              </div>
              <input
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                placeholder="추가 의견 (선택)"
                style={css("width:100%;box-sizing:border-box;font:400 11.5px " + FONT + ";color:var(--gray-1000);background:var(--onair-surface);border:1px solid var(--gray-300);border-radius:8px;padding:8px 10px;outline:none")}
              />
              <button
                type="button"
                onClick={() => {
                  setOpen(false);
                  void send(
                    "incorrect",
                    [...tags],
                    ["초안:불만족", tags.size ? `아쉬운 부분:${[...tags].join(",")}` : "", comment.trim()].filter(Boolean).join(" · ")
                  );
                }}
                style={btn("font:700 12px " + FONT + ";color:#fff;background:var(--blue-700);border-radius:8px;padding:9px 0")}
              >
                보내기
              </button>
            </div>
          </>
        )}
      </span>
      {stats && sent && (
        <span title="상담사 피드백이 학습 데이터로 쌓입니다" style={css("font:600 10px " + FONT + ";color:var(--gray-700);white-space:nowrap")}>
          누적 {stats.total}건
        </span>
      )}
    </span>
  );
}
