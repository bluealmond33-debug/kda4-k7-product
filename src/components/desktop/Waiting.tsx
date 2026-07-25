import { useEffect, useState } from "react";
import { css } from "../../lib/css";
import type { CallFlowVM } from "../../hooks/useCallFlow";
import Standby from "./Standby";
import Spinner from "../Spinner";
import EmotionBar from "./EmotionBar";

const FONT = "'Avenir Next','Pretendard',system-ui,sans-serif";

const STEPS = ["듣는 중", "요약·정리", "카드 생성"];

/** 접수 대기 화면 — idle이면 대기(Standby). 접수 중엔 대기 화면을 가리지 않고,
 *  좌하단에 작은 접수 패널이 바텀업으로 떠서 "어느 단계·얼마나 진행됐는지"만 알린다.
 *  STT 원문은 보여주지 않는다(텍스트 최소화). */
export default function Waiting({ vm }: { vm: CallFlowVM }) {
  // 지금 어느 단계인가 — 원값. 고객이 말하면 0, 침묵이 흐르면 1, 요약이 돌면 2.
  const speaking = vm.showWave || vm.liveTranscriptLines.length === 0;
  const rawStage = vm.cardBuilding || vm.summaryPending ? 2 : speaking ? 0 : 1;

  /* 진행 표시는 **되돌아가지 않는다**(도달한 최고 단계를 붙잡는다).
     고객이 말을 멈췄다 다시 말하면 실제 상태는 '요약·정리 ↔ 듣는 중'을 오간다. 그게 사실이긴
     하지만, 진행 막대가 왕복하면 "되돌아갔다 = 뭔가 잘못됐다"로 읽혀 시연에서 불안해 보인다.
     접수는 한 방향으로 끝나는 절차이므로 표시도 한 방향으로만 간다. */
  const [stage, setStage] = useState(0);
  useEffect(() => {
    setStage((s) => Math.max(s, rawStage));
  }, [rawStage]);
  // 새 콜이면 처음부터
  const idle = vm.phIdle;
  useEffect(() => {
    if (idle) setStage(0);
  }, [idle]);

  if (idle) return <Standby />;

  const steps = STEPS;

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

      {/* 좌하단 접수 패널 — 바텀업으로 등장. 자리는 구석에 두되(대기 화면을 가리지 않는다)
          관객이 읽을 수 있는 크기로 키운다. 폭만 늘리면 늘어난 여백만 보이므로 스피너·글자·
          칩을 같은 비율로 함께 키웠다.
          위치를 중앙으로 옮기지 않는 이유: '구석에서 작게 접수 → 중앙에서 크게 카드'라는
          크기·위치 대비가 "정리되어 올라왔다"를 말한다. 접수부터 중앙이면 카드가 떠도
          자리만 바뀐 것으로 읽히고, 아래 레벨업 모션도 근거를 잃는다.
          카드 생성 단계(stage 2)에 들어가면 한 번 부풀어 오른다 — 이 패널이 곧 중앙의 준비
          카드로 '자라난다'는 예고다. 이어서 PrepCard가 이 자리에서 커지며 날아온다
          (cardArrive: 좌하단 scale .34 → 중앙 1.0). 두 모션이 한 동작으로 읽힌다. */}
      <div
        data-tour="intake-live"
        style={css(
          "position:absolute;left:24px;bottom:24px;width:392px;box-sizing:border-box;display:flex;flex-direction:column;gap:16px;padding:19px 21px;border-radius:18px;background:#fff;border:1px solid var(--gray-200);box-shadow:0 20px 50px rgba(28,32,45,.22),0 2px 9px rgba(28,32,45,.09);font-family:" +
            FONT +
            ";animation:" +
            (stage >= 2
              ? "dockUp .42s cubic-bezier(.2,.8,.2,1) both,intakeLevelUp .7s cubic-bezier(.2,.8,.2,1) .05s both"
              : "dockUp .42s cubic-bezier(.2,.8,.2,1) both")
        )}
      >
        {/* 헤더 — 얼굴 스피너 + 제목 + 접수 경과 */}
        <div style={css("display:flex;align-items:center;gap:14px")}>
          <Spinner size={52} mark speedMs={stage >= 2 ? 620 : 1050} />
          <div style={css("display:flex;flex-direction:column;gap:4px;min-width:0")}>
            <span style={css("font:700 15.5px " + FONT + ";color:var(--gray-1000);letter-spacing:-.3px")}>
              {stage >= 2 ? "상담 카드 만드는 중" : "AI가 접수·요약 중"}
            </span>
            <span style={css("font:600 13px " + FONT + ";color:var(--gray-600)")}>
              접수 경과 <span style={css("color:var(--gray-1000);font-variant-numeric:tabular-nums")}>{vm.clockStr}</span>
            </span>
          </div>
        </div>

        {/* 진행 단계 */}
        <div style={css("display:flex;align-items:center;gap:6px")}>
          {steps.map((label, i) => {
            const done = i < stage, on = i === stage;
            return (
              <span key={label} style={css("display:inline-flex;align-items:center;gap:6px")}>
                {i > 0 && <span style={css("width:14px;height:1.5px;background:" + (done || on ? "var(--blue-400)" : "var(--gray-300)"))} />}
                <span style={css("display:inline-flex;align-items:center;gap:6px;padding:5px 11px;border-radius:9999px;font:700 12.5px " + FONT + ";white-space:nowrap;" + (on ? "background:var(--blue-700);color:#fff" : done ? "background:var(--gray-1000);color:#fff" : "background:var(--gray-100);color:var(--gray-500)"))}>
                  {done ? <span className="mi" style={css("font-size:13px")}>check</span> : on ? <span style={css("width:6px;height:6px;border-radius:9999px;background:#fff;animation:recBlink 1s infinite")} /> : <span style={css("width:6px;height:6px;border-radius:9999px;background:var(--gray-400)")} />}
                  {label}
                </span>
              </span>
            );
          })}
        </div>

        {/* 상태 — 감정온도(그라데이션 축) · 무음/수신.
            신호등(점 3개)을 축 하나로 바꿨다: 점은 세 상태 중 하나만 말하는데, 감정은 계단이
            아니라 눈금 위를 오가는 값이고 상담사가 알아야 하는 건 '지금 어디쯤이며 평소보다
            얼마나 올라왔는가'다. 준비 카드의 온도계와 같은 축·같은 마커를 쓴다(EmotionBar). */}
        <div style={css("display:flex;flex-direction:column;gap:9px;padding-top:14px;border-top:1px solid var(--gray-200)")}>
          <div style={css("display:flex;align-items:center;gap:8px")}>
            <span style={css("font:600 12px " + FONT + ";color:var(--gray-600)")}>감정온도</span>
            <span style={css("font:700 12.5px " + FONT + ";color:" + (vm.emo >= 3 ? "var(--red-900)" : vm.emo >= 1 ? "var(--amber-900)" : "var(--green-900)"))}>
              {vm.emo >= 3 ? "고조" : vm.emo >= 1 ? "상승" : "안정"}
            </span>
            <span style={css("flex:1")} />
            <span style={css("font:600 12.5px " + FONT + ";color:var(--gray-600)")}>
              {vm.silenceLeft > 0 ? (
                <>무음 <span style={css("color:var(--gray-1000);font-variant-numeric:tabular-nums")}>{vm.silenceLeft}s</span></>
              ) : (
                "수신 중"
              )}
            </span>
          </div>
          <EmotionBar
            title="실시간 감정온도 — 눈금은 평소 기준선"
            height={8}
            pct={vm.prepTempC != null ? vm.prepTempPct : vm.prepTempBasePct}
            basePct={vm.prepTempBasePct}
            color={vm.prepEmotionBar}
          />
        </div>
      </div>
    </div>
  );
}
