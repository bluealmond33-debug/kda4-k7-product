import { css } from "../../lib/css";
import type { CallFlowVM } from "../../hooks/useCallFlow";
import Standby from "./Standby";
import Spinner from "../Spinner";

const FONT = "'Avenir Next','Pretendard',system-ui,sans-serif";

/** 접수 대기 화면 — idle이면 대기(Standby). 접수 중엔 대기 화면을 가리지 않고,
 *  좌하단에 작은 접수 패널이 바텀업으로 떠서 "어느 단계·얼마나 진행됐는지"만 알린다.
 *  STT 원문은 보여주지 않는다(텍스트 최소화). */
export default function Waiting({ vm }: { vm: CallFlowVM }) {
  if (vm.phIdle) return <Standby />;

  // 진행 단계 — 듣는 중 → 요약·정리 → 카드 생성. 무엇을 듣는지(STT)가 아니라 '단계'만.
  const listening = vm.showWave || vm.silenceLeft > 0 || vm.liveTranscriptLines.length === 0;
  const stage = listening ? 0 : 1;
  const steps = ["듣는 중", "요약·정리", "카드 생성"];

  return (
    <div
      style={css(
        "position:relative;width:1100px;height:688px;background:var(--onair-bg);border-radius:12px;box-shadow:var(--sh-near);overflow:hidden;font-family:" + FONT
      )}
    >
      {/* 대기 화면은 그대로 — 가리지 않는다 */}
      <div style={css("position:absolute;inset:0")}>
        <Standby />
      </div>

      {/* 좌하단 접수 패널 — 바텀업으로 등장(작게, 화면을 덮지 않음) */}
      <div
        data-tour="intake-live"
        style={css(
          "position:absolute;left:22px;bottom:22px;width:314px;box-sizing:border-box;display:flex;flex-direction:column;gap:13px;padding:15px 17px;border-radius:16px;background:#fff;border:1px solid var(--gray-200);box-shadow:0 18px 44px rgba(28,32,45,.20),0 2px 8px rgba(28,32,45,.08);animation:dockUp .42s cubic-bezier(.2,.8,.2,1) both;font-family:" + FONT
        )}
      >
        {/* 헤더 — 얼굴 스피너 + 제목 + 접수 경과 */}
        <div style={css("display:flex;align-items:center;gap:12px")}>
          <Spinner size={42} mark speedMs={1050} />
          <div style={css("display:flex;flex-direction:column;gap:3px;min-width:0")}>
            <span style={css("font:700 13px " + FONT + ";color:var(--gray-1000);letter-spacing:-.2px")}>AI가 접수·요약 중</span>
            <span style={css("font:600 11.5px " + FONT + ";color:var(--gray-600)")}>
              접수 경과 <span style={css("color:var(--gray-1000);font-variant-numeric:tabular-nums")}>{vm.clockStr}</span>
            </span>
          </div>
        </div>

        {/* 진행 단계 — 컴팩트 */}
        <div style={css("display:flex;align-items:center;gap:5px")}>
          {steps.map((label, i) => {
            const done = i < stage, on = i === stage;
            return (
              <span key={label} style={css("display:inline-flex;align-items:center;gap:5px")}>
                {i > 0 && <span style={css("width:12px;height:1.5px;background:" + (done || on ? "var(--blue-400)" : "var(--gray-300)"))} />}
                <span style={css("display:inline-flex;align-items:center;gap:5px;padding:4px 9px;border-radius:9999px;font:700 11px " + FONT + ";" + (on ? "background:var(--blue-700);color:#fff" : done ? "background:var(--gray-1000);color:#fff" : "background:var(--gray-100);color:var(--gray-500)"))}>
                  {done ? <span className="mi" style={css("font-size:12px")}>check</span> : on ? <span style={css("width:5px;height:5px;border-radius:9999px;background:#fff;animation:recBlink 1s infinite")} /> : <span style={css("width:5px;height:5px;border-radius:9999px;background:var(--gray-400)")} />}
                  {label}
                </span>
              </span>
            );
          })}
        </div>

        {/* 상태 — 감정온도 · 무음/수신 */}
        <div style={css("display:flex;align-items:center;gap:12px;padding-top:11px;border-top:1px solid var(--gray-200)")}>
          <span style={css("display:flex;align-items:center;gap:7px")} title="실시간 감정온도">
            <span style={css("font:600 10.5px " + FONT + ";color:var(--gray-600)")}>감정온도</span>
            <span className="lampdots">
              <i className={"g" + (vm.emo === 1 ? " lit" : "")} />
              <i className={"a" + (vm.emo === 2 ? " lit" : "")} />
              <i className={"r" + (vm.emo >= 3 ? " lit" : "")} />
            </span>
            <span style={css("font:600 11px " + FONT + ";color:" + (vm.emo >= 3 ? "var(--red-900)" : vm.emo >= 1 ? "var(--amber-900)" : "var(--gray-700)"))}>
              {vm.emo >= 3 ? "고조" : vm.emo >= 1 ? "상승" : "안정"}
            </span>
          </span>
          <span style={css("flex:1")} />
          <span style={css("font:600 11px " + FONT + ";color:var(--gray-600)")}>
            {vm.silenceLeft > 0 ? (
              <>무음 <span style={css("color:var(--gray-1000);font-variant-numeric:tabular-nums")}>{vm.silenceLeft}s</span></>
            ) : (
              "수신 중"
            )}
          </span>
        </div>
      </div>
    </div>
  );
}
