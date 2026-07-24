import { useState } from "react";
import { css } from "../../lib/css";
import type { CallFlowVM } from "../../hooks/useCallFlow";
import DesktopShell from "./DesktopShell";
import BriefingCardBody from "./BriefingCardBody";

const FONT = "'Avenir Next','Pretendard',sans-serif";

/** 상담 준비 카드 — 전화 받기 전 KARI-NA 브리핑.
 *  상단: 로고(좌) · 라우팅 단계 부서→업무코드(우, 클릭=부서 이관).
 *  좌측: 감정온도(표정+당근식 36.5 온도계) · 확신도 도넛 + 본인인증 · 유의사항(제목만).
 *  우측: 전화 요약(가장 큰 비중) — 한 줄 요약 → 근거 발화 → STT 불릿 → 핵심 니즈 키워드.
 *  하단 패널: '이 문장으로 통화를 여세요'(감정온도 연동) + 펼치면 전체 스크립트.
 *  색 원칙: 연한 틴트 배경을 쓰지 않는다. 흰 면 + 경계선으로 나누고, 색은 의미(온도·상태)에만. */
export default function PrepCard({ vm }: { vm: CallFlowVM }) {
  const [scriptOpen, setScriptOpen] = useState(false);

  return (
    <DesktopShell>
      {/* 뒤 배경 (인입 대기) */}
      <div style={css("position:absolute;inset:0;display:flex;flex-direction:column")}>
        <div style={css("flex:1;display:flex;gap:16px;padding:16px")}>
          <div style={css("width:312px;flex:none;background:var(--onair-surface);border-radius:12px;box-shadow:var(--sh-near)")} />
          <div style={css("flex:1;background:var(--onair-surface);border-radius:12px;box-shadow:var(--sh-far);display:flex;align-items:center;justify-content:center;font:400 14px " + FONT + ";color:var(--gray-600)")}>
            고객을 선택하면 준비 카드가 열립니다
          </div>
          <div style={css("width:372px;flex:none;background:var(--onair-surface);border-radius:12px;box-shadow:var(--sh-near)")} />
        </div>
      </div>

      <div style={css("position:absolute;inset:0;background:rgba(22,20,17,.5);animation:fadeIn .18s ease-out")} />

      <div style={css("position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);display:flex;flex-direction:column;align-items:center;gap:10px;width:860px;max-width:95%;animation:modalIn .18s cubic-bezier(0.2,0.8,0.2,1)")}>
        <div data-tour="prep-card" style={css("width:100%;max-height:620px;background:var(--onair-surface);border-radius:12px;box-shadow:var(--sh-modal);overflow:hidden;display:flex;flex-direction:column")}>

          <BriefingCardBody vm={vm} />

          {/* ── 하단 액션 ── */}
          <div style={css("flex:none;display:flex;align-items:center;gap:12px;padding:11px 22px;border-top:1px solid var(--gray-200)")}>
            <span style={css("display:flex;align-items:center;gap:5px;font:400 12px " + FONT + ";color:var(--gray-700)")}>
              <span className="mi" style={css("font-size:16px")}>info</span> {vm.prepHint}
            </span>
            <div style={css("flex:1")} />
            <span data-tour="prep-connect" onClick={vm.answerCall} style={css("padding:10px 26px;background:" + vm.connectBg + ";color:" + vm.connectFg + ";border-radius:9999px;font-weight:700;font-size:14px;display:flex;align-items:center;gap:6px;cursor:" + vm.connectCursor + ";transition:background .15s")}>
              <span className="mi" style={css("font-size:18px")}>call</span> 통화 연결
            </span>
          </div>
        </div>

        {/* ── 스크립트 패널 ── 오프닝 한 줄(감정온도 연동) + 펼치면 전체 */}
        <div data-tour="prep-firstline" style={css("width:100%;background:var(--onair-surface);border-radius:12px;box-shadow:var(--sh-near);overflow:hidden")}>
          <div onClick={() => setScriptOpen((v) => !v)} style={css("display:flex;align-items:center;gap:11px;padding:11px 18px;cursor:pointer;user-select:none")}>
            <span style={css("display:inline-flex;align-items:center;justify-content:center;width:23px;height:23px;border-radius:9999px;background:var(--gray-1000);color:#fff;flex:none")}><span className="mi" style={css("font-size:14px")}>record_voice_over</span></span>
            <span style={css("font:700 10px " + FONT + ";color:var(--gray-700);flex:none;white-space:nowrap")}>이 문장으로 여세요</span>
            {/* 문장 전체를 두 줄로 — 잘라내지 않는다 */}
            <div style={css("flex:1;min-width:0;font:500 13.5px/1.5 Georgia,'Noto Serif KR','Apple SD Gothic Neo',serif;color:var(--gray-1000);white-space:normal;word-break:keep-all")}>{vm.firstLine}</div>
            <span style={css("display:flex;align-items:center;gap:4px;font:600 12px " + FONT + ";color:var(--blue-700);flex:none")}>
              {scriptOpen ? "접기" : "펼쳐 보기"}
              <span className="mi" style={css("font-size:19px;transition:transform .25s;transform:rotate(" + (scriptOpen ? 180 : 0) + "deg)")}>expand_more</span>
            </span>
          </div>
          {scriptOpen && (
            <div style={css("padding:4px 20px 18px;display:flex;flex-direction:column;max-height:300px;overflow:auto")}>
              <div style={css("font:600 10.5px " + FONT + ";color:var(--gray-600);padding:2px 2px 10px")}>상담 스크립트 · {vm.steps.length}단계 · 통화 연결하면 상담 화면에서도 표시됩니다</div>
              {vm.steps.map((st, i) => {
                // 단계 라벨에서 앞 번호("1. ")를 떼고, 멘트는 겉따옴표를 벗겨 대사 스타일로 조판한다
                const stage = st.title.replace(/^\s*\d+\.\s*/, "");
                const say = st.text.replace(/^[\s"“”'']+|[\s"“”'']+$/g, "");
                const last = i === vm.steps.length - 1;
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
                        {i === 0 && <span style={css("font:600 8.5px " + FONT + ";letter-spacing:.2px;color:var(--blue-700);border:1px solid var(--blue-700);border-radius:9999px;padding:1px 6px")}>감정온도 연동</span>}
                      </div>
                      <div style={css("display:flex;gap:8px;align-items:flex-start")}>
                        <span className="mi" style={css("font-size:15px;color:var(--gray-400);flex:none;margin-top:2px")}>format_quote</span>
                        <div style={css("flex:1;min-width:0;font:500 13.5px/1.6 Georgia,'Noto Serif KR','Apple SD Gothic Neo',serif;color:var(--gray-1000)")}>{say}</div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </DesktopShell>
  );
}

