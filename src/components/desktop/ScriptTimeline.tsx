import { css } from "../../lib/css";

const FONT = "'Avenir Next','Pretendard',sans-serif";

/** 단계별 상담 스크립트 — '실제 대본'처럼. 좌측 번호 타임라인(원+세로선) + 단계명 + 상담원 멘트(대사체 세리프).
 *  접수(PrepCard 펼침)와 통화(ActiveCall 아코디언)에서 똑같이 쓴다.
 *  st.title 앞 번호("1. ")는 떼고, 멘트는 겉따옴표를 벗겨 대사처럼 조판한다. */
export default function ScriptTimeline({
  steps,
  openingBadge,
}: {
  steps: { title: string; text: string }[];
  /** 첫 단계(오프닝)에 붙일 뱃지 — 예: '감정온도 연동'. 없으면 안 붙는다. */
  openingBadge?: string;
}) {
  return (
    <>
      {steps.map((st, i) => {
        const stage = st.title.replace(/^\s*\d+\.\s*/, "");
        const say = st.text.replace(/^[\s"“”'']+|[\s"“”'']+$/g, "");
        const last = i === steps.length - 1;
        return (
          <div key={i} style={css("display:flex;gap:11px")}>
            {/* 좌측 타임라인 — 단계 번호 + 세로선 */}
            <div style={css("display:flex;flex-direction:column;align-items:center;flex:none")}>
              <span style={css("display:inline-flex;align-items:center;justify-content:center;width:22px;height:22px;border-radius:9999px;background:var(--blue-700);color:#fff;font:800 11px " + FONT)}>{i + 1}</span>
              {!last && <span style={css("flex:1;width:2px;background:var(--gray-200);margin:3px 0")} />}
            </div>
            {/* 우측 — 단계명 + 상담원 멘트(대사체) */}
            <div style={css("flex:1;min-width:0;padding-bottom:" + (last ? "0" : "14px"))}>
              <div style={css("display:flex;align-items:center;gap:6px;margin-bottom:6px")}>
                <span style={css("font:700 12px " + FONT + ";color:var(--gray-1000)")}>{stage}</span>
                {i === 0 && openingBadge && <span style={css("font:600 8.5px " + FONT + ";letter-spacing:.2px;color:var(--blue-700);border:1px solid var(--blue-700);border-radius:9999px;padding:1px 6px")}>{openingBadge}</span>}
              </div>
              <div style={css("display:flex;gap:8px;align-items:flex-start")}>
                <span className="mi" style={css("font-size:15px;color:var(--gray-400);flex:none;margin-top:2px")}>format_quote</span>
                <div style={css("flex:1;min-width:0;font:500 13.5px/1.6 Georgia,'Noto Serif KR','Apple SD Gothic Neo',serif;color:var(--gray-1000)")}>{say}</div>
              </div>
            </div>
          </div>
        );
      })}
    </>
  );
}
