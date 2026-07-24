import { css } from "../../lib/css";
import type { CallFlowVM } from "../../hooks/useCallFlow";
import Standby from "./Standby";
import Spinner from "../Spinner";

const FONT = "'Avenir Next','Pretendard',system-ui,sans-serif";

/** 접수 대기 화면 — idle이면 대기(Standby). 접수 중엔 대기 화면을 '흐릿하게만' 두고,
 *  로고(얼굴) 스피너 위주로 "지금 어느 단계인지"만 가볍게 알린다.
 *  STT 원문·상세 신호바는 보여주지 않는다(텍스트 최소화 · 대기 화면을 덮지 않음). */
export default function Waiting({ vm }: { vm: CallFlowVM }) {
  if (vm.phIdle) return <Standby />;

  // 진행 단계 — 듣는 중 → 요약·정리 → 카드 생성. 무엇을 듣는지(STT)가 아니라 '단계'만 보여준다.
  const listening = vm.showWave || vm.silenceLeft > 0 || vm.liveTranscriptLines.length === 0;
  const stage = listening ? 0 : 1;
  const steps = ["고객 발화 듣는 중", "AI가 요약·정리 중", "상담 카드 생성"];

  return (
    <div
      style={css(
        "position:relative;width:1100px;height:688px;background:var(--onair-bg);border-radius:12px;box-shadow:var(--sh-near);overflow:hidden;font-family:" + FONT
      )}
    >
      {/* 대기 화면(시계)은 그대로 살려 두고 흐릿하게만 — 접수 중에도 무대는 사라지지 않는다 */}
      <div style={css("position:absolute;inset:0;filter:blur(5px) saturate(1.03);transform:scale(1.03);opacity:.82;pointer-events:none")} aria-hidden="true">
        <Standby />
      </div>
      {/* 아주 옅은 스크림 — 전경 가독성만 확보(대기 화면이 계속 비친다) */}
      <div style={css("position:absolute;inset:0;background:radial-gradient(120% 90% at 50% 44%,rgba(233,235,239,.26) 0%,rgba(228,231,236,.5) 100%);pointer-events:none")} />

      {/* 전경 — 얼굴 스피너 위주. 큰 카드로 화면을 덮지 않고 컴팩트하게 띄운다 */}
      <div style={css("position:absolute;inset:0;display:flex;align-items:center;justify-content:center")}>
        <div
          data-tour="intake-live"
          style={css(
            "display:flex;flex-direction:column;align-items:center;gap:18px;padding:30px 46px;border-radius:24px;background:rgba(255,255,255,.55);border:1px solid rgba(255,255,255,.7);box-shadow:0 24px 60px rgba(28,32,45,.16),0 2px 8px rgba(28,32,45,.05);backdrop-filter:blur(18px) saturate(1.4);-webkit-backdrop-filter:blur(18px) saturate(1.4)"
          )}
        >
          {/* 로고(얼굴) 스피너 — 이 화면의 주인공 */}
          <Spinner size={86} mark speedMs={1050} />

          <span style={css("display:inline-flex;align-items:center;gap:7px;font:700 12px " + FONT + ";letter-spacing:.4px;color:var(--blue-900);background:rgba(37,99,235,.08);border:1px solid rgba(37,99,235,.22);border-radius:9999px;padding:6px 15px")}>
            <span style={css("width:7px;height:7px;border-radius:9999px;background:var(--blue-700);animation:recBlink 1.1s infinite")} />
            AI 접수 진행 중
          </span>

          {/* 진행 단계 — 지금 어디쯤인지만 */}
          <div style={css("display:flex;align-items:center;gap:9px")}>
            {steps.map((label, i) => {
              const done = i < stage, on = i === stage;
              return (
                <span key={label} style={css("display:inline-flex;align-items:center;gap:9px")}>
                  {i > 0 && <span style={css("width:22px;height:1.5px;background:" + (done || on ? "var(--blue-400)" : "var(--gray-300)"))} />}
                  <span style={css("display:inline-flex;align-items:center;gap:6px;padding:5px 12px;border-radius:9999px;font:700 12px " + FONT + ";" + (on ? "background:var(--blue-700);color:#fff" : done ? "background:var(--gray-1000);color:#fff" : "background:rgba(255,255,255,.7);color:var(--gray-500)"))}>
                    {done ? <span className="mi" style={css("font-size:13px")}>check</span> : on ? <span style={css("width:6px;height:6px;border-radius:9999px;background:#fff;animation:recBlink 1s infinite")} /> : <span style={css("width:6px;height:6px;border-radius:9999px;background:var(--gray-400)")} />}
                    {label}
                  </span>
                </span>
              );
            })}
          </div>

          <span style={css("font:400 12.5px " + FONT + ";color:var(--gray-600)")}>완료되면 상담 준비 카드가 표시됩니다</span>
        </div>
      </div>
    </div>
  );
}
