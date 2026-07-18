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
        "width:1040px;height:640px;background:var(--onair-bg);border-radius:20px;box-shadow:var(--sh-near);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:16px;font-family:'Geist Sans','Pretendard',system-ui,sans-serif"
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
    </div>
  );
}
