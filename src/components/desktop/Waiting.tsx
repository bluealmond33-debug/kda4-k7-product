import { css } from "../../lib/css";
import type { CallFlowVM } from "../../hooks/useCallFlow";
import Standby from "./Standby";

const FONT = "'Avenir Next','Geist Sans','Pretendard',system-ui,sans-serif";
const MONO = "'Geist Mono','IBM Plex Mono',monospace";

/** Desktop placeholder shown while there is no active consultation.
 *  idle → 아침 대기 화면(Standby). connecting/recording/confirm → AI 접수 처리 중.
 *  접수 구간은 "실시간 전사 + 진행 표시"로 살려, 시계만 있던 화면이 지루하지 않게 한다. */
export default function Waiting({ vm }: { vm: CallFlowVM }) {
  if (vm.phIdle) return <Standby />;

  // 진행 3단계 — 듣는 중 → 요약·정리 → 카드 생성.
  // 연결·녹음·무음카운트 중이거나 아직 발화 전이면 '듣는 중', 발화 후 무음이 끝나면 '요약'.
  const lines = vm.liveTranscriptLines.slice(-4);
  const listening = vm.showWave || vm.silenceLeft > 0 || vm.liveTranscriptLines.length === 0;
  const stage = listening ? 0 : 1;
  const steps = ["고객 발화 듣는 중", "AI가 요약·정리 중", "상담 카드 생성"];

  return (
    <div
      style={css(
        "width:1100px;height:688px;background:var(--onair-bg);border-radius:12px;box-shadow:var(--sh-near);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:20px;font-family:" + FONT
      )}
    >
      {/* 상태 헤더 — '지금 접수가 돌아가고 있다' */}
      <div style={css("display:flex;flex-direction:column;align-items:center;gap:10px")}>
        <span style={css("display:inline-flex;align-items:center;gap:7px;font:700 11px " + FONT + ";letter-spacing:.4px;color:var(--blue-900);background:rgba(37,99,235,.08);border:1px solid rgba(37,99,235,.22);border-radius:9999px;padding:5px 13px")}>
          <span style={css("width:7px;height:7px;border-radius:9999px;background:var(--blue-700);animation:recBlink 1.1s infinite")} />
          AI 접수 진행 중
        </span>
        <div style={css("font-size:20px;font-weight:800;color:var(--gray-1000)")}>{vm.waitingText}</div>
        <div style={css("font-size:13px;color:var(--gray-600)")}>{vm.waitingSub}</div>
      </div>

      {/* 진행 3단계 스텝 */}
      <div style={css("display:flex;align-items:center;gap:10px")}>
        {steps.map((label, i) => {
          const done = i < stage, on = i === stage;
          return (
            <span key={label} style={css("display:inline-flex;align-items:center;gap:10px")}>
              {i > 0 && <span style={css("width:26px;height:1.5px;background:" + (done || on ? "var(--blue-400)" : "var(--gray-300)"))} />}
              <span style={css("display:inline-flex;align-items:center;gap:6px;padding:5px 12px;border-radius:9999px;font:700 12px " + FONT + ";" + (on ? "background:var(--blue-700);color:#fff" : done ? "background:var(--gray-1000);color:#fff" : "background:var(--gray-100);color:var(--gray-500)"))}>
                {done ? <span className="mi" style={css("font-size:13px")}>check</span> : on ? <span style={css("width:6px;height:6px;border-radius:9999px;background:#fff;animation:recBlink 1s infinite")} /> : <span style={css("width:6px;height:6px;border-radius:9999px;background:var(--gray-400)")} />}
                {label}
              </span>
            </span>
          );
        })}
      </div>

      {/* 실시간 전사 카드 — AI가 지금 무엇을 듣고 있는지 보인다(로그 스타일) */}
      <div style={css("width:600px;min-height:118px;background:#0a0a0e;border-radius:14px;box-shadow:0 14px 40px rgba(0,0,0,.45);padding:14px 18px;display:flex;flex-direction:column;justify-content:flex-end;gap:5px;box-sizing:border-box")}>
        <div style={css("display:flex;align-items:center;gap:6px;margin-bottom:4px")}>
          <span className="mi" style={css("font-size:15px;color:#6f8cff")}>graphic_eq</span>
          <span style={css("font:700 10.5px " + FONT + ";letter-spacing:.3px;color:#8b919c")}>실시간 전사</span>
        </div>
        {lines.length === 0 ? (
          <div style={css("font:400 12px " + MONO + ";color:#565b66")}>고객 발화를 기다리는 중…<span style={css("display:inline-block;margin-left:2px;animation:recBlink 1s infinite")}>▍</span></div>
        ) : (
          lines.map((l, i) => (
            <div key={l.seq} style={css("display:flex;gap:8px;align-items:baseline;font:400 12.5px/1.55 " + MONO + ";letter-spacing:-.2px")}>
              <span style={css("flex:none;width:42px;font-weight:700;font-size:10.5px;color:" + (l.speaker === "agent" ? "#8b919c" : "#c9cfda"))}>{l.speaker === "agent" ? "상담원" : "고객"}</span>
              <span style={css("flex:1;min-width:0;color:" + (i === lines.length - 1 ? "#d9dde4" : "#868c98"))}>
                {l.text}
                {i === lines.length - 1 && <span style={css("display:inline-block;margin-left:1px;color:#6f8cff;animation:recBlink 1s infinite")}>▍</span>}
              </span>
            </div>
          ))
        )}
      </div>

      {/* 라이브 신호 — 감정온도 상승 + 접수 경과 + 무음 카운트다운(기존 유지) */}
      <div data-tour="intake-live" style={css("display:flex;align-items:center;gap:22px;background:var(--onair-surface);border-radius:9999px;padding:10px 22px;box-shadow:var(--sh-far)")}>
        <span style={css("display:flex;align-items:center;gap:8px")} title="실시간 감정온도">
          <span style={css("font:600 11px " + FONT + ";color:var(--gray-700)")}>감정온도</span>
          <span className="lampdots">
            <i className={"g" + (vm.emo === 1 ? " lit" : "")} />
            <i className={"a" + (vm.emo === 2 ? " lit" : "")} />
            <i className={"r" + (vm.emo >= 3 ? " lit" : "")} />
          </span>
          <span style={css("font:600 12px " + FONT + ";color:" + (vm.emo >= 3 ? "var(--red-900)" : vm.emo >= 1 ? "var(--amber-900)" : "var(--gray-700)"))}>
            {vm.emo >= 3 ? "고조" : vm.emo >= 1 ? "상승 중" : "안정"}
          </span>
        </span>
        <span style={css("width:1.3px;height:18px;background:var(--gray-200)")} />
        <span style={css("display:flex;align-items:center;gap:5px;font:600 12px " + FONT + ";color:var(--gray-700)")}>
          접수 경과 <span className="mono" style={css("color:var(--gray-1000)")}>{vm.clockStr}</span>
        </span>
        <span style={css("width:1.3px;height:18px;background:var(--gray-200)")} />
        <span style={css("font:600 12px " + FONT + ";color:var(--gray-700)")}>
          {vm.silenceLeft > 0 ? (
            <>무음 <span className="mono" style={css("color:var(--gray-1000)")}>{vm.silenceLeft}초</span> 후 요약 시작</>
          ) : (
            "고객 발화 수신 중"
          )}
        </span>
      </div>
    </div>
  );
}
