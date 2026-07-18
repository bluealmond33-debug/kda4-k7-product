import { css } from "../../lib/css";
import type { CallFlowVM } from "../../hooks/useCallFlow";
import Standby from "./Standby";

/** Desktop placeholder shown while there is no active consultation.
 *  idle → 아침 대기 화면(Standby). connecting/recording/confirm → AI 접수 처리 중. */
export default function Waiting({ vm }: { vm: CallFlowVM }) {
  if (vm.phIdle) return <Standby />;
  return (
    <div
      style={css(
        "width:1100px;height:688px;background:var(--onair-bg);border-radius:12px;box-shadow:var(--sh-near);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:16px;font-family:'Geist Sans','Pretendard',system-ui,sans-serif"
      )}
    >
      {vm.waitingSpin && (
        <span
          style={css(
            "width:40px;height:40px;border:3px solid var(--blue-400);border-top-color:var(--blue-700);border-radius:9999px;animation:spin .8s linear infinite"
          )}
        />
      )}
      <div style={css("font-size:18px;font-weight:700;color:var(--gray-1000)")}>{vm.waitingText}</div>
      <div style={css("font-size:13px;color:var(--gray-700)")}>{vm.waitingSub}</div>

      {/* 라이브 신호 — 접수 중에도 상담사 화면이 살아 있다: 감정온도 상승 + 무음 카운트다운 */}
      {vm.waitingSpin && (
        <div style={css("display:flex;align-items:center;gap:22px;margin-top:10px;background:var(--onair-surface);border-radius:9999px;padding:10px 22px;box-shadow:var(--sh-far)")}>
          <span style={css("display:flex;align-items:center;gap:8px")} title="실시간 감정온도">
            <span style={css("font:600 11px 'Geist Sans','Pretendard',sans-serif;color:var(--gray-700)")}>감정온도</span>
            <span className="lampdots">
              <i className={"g" + (vm.emo === 1 ? " lit" : "")} />
              <i className={"a" + (vm.emo === 2 ? " lit" : "")} />
              <i className={"r" + (vm.emo >= 3 ? " lit" : "")} />
            </span>
            <span style={css("font:600 12px 'Geist Sans','Pretendard',sans-serif;color:" + (vm.emo >= 3 ? "var(--red-900)" : vm.emo >= 1 ? "var(--amber-900)" : "var(--gray-700)"))}>
              {vm.emo >= 3 ? "고조" : vm.emo >= 1 ? "상승 중" : "안정"}
            </span>
          </span>
          <span style={css("width:1.3px;height:18px;background:var(--gray-200)")} />
          {/* 접수 경과 = 고객이 기다린 시간 — 길어지면 상담사가 개입을 판단한다 */}
          <span style={css("display:flex;align-items:center;gap:5px;font:600 12px 'Geist Sans','Pretendard',sans-serif;color:var(--gray-700)")}>
            접수 경과 <span className="mono" style={css("color:var(--gray-1000)")}>{vm.clockStr}</span>
          </span>
          <span style={css("width:1.3px;height:18px;background:var(--gray-200)")} />
          <span style={css("font:600 12px 'Geist Sans','Pretendard',sans-serif;color:var(--gray-700)")}>
            {vm.silenceLeft > 0 ? (
              <>무음 <span className="mono" style={css("color:var(--gray-1000)")}>{vm.silenceLeft}초</span> 후 요약 시작</>
            ) : (
              "고객 발화 수신 중"
            )}
          </span>
        </div>
      )}
    </div>
  );
}
