import { css } from "../lib/css";
import type { CallFlowVM } from "../hooks/useCallFlow";

/**
 * 아이폰 목업 — 프레임을 CSS로 직접 그린다.
 * 베젤 두께가 균일하려면 (바깥 반지름 − 인셋 = 안쪽 반지름)이 지켜져야 한다:
 * 티타늄 림 70px → 베젤 inset 5px(65px) → 스크린 inset 17px(53px).
 */

const KEYS: { d: string; sub: string }[] = [
  { d: "1", sub: " " },
  { d: "2", sub: "ABC" },
  { d: "3", sub: "DEF" },
  { d: "4", sub: "GHI" },
  { d: "5", sub: "JKL" },
  { d: "6", sub: "MNO" },
  { d: "7", sub: "PQRS" },
  { d: "8", sub: "TUV" },
  { d: "9", sub: "WXYZ" },
  { d: "*", sub: "" },
  { d: "0", sub: "+" },
  { d: "#", sub: "" },
];

const CONTROLS = [
  { icon: "volume_up", label: "스피커" },
  { icon: "videocam", label: "FaceTime" },
  { icon: "mic_off", label: "소리 끔" },
  { icon: "more_horiz", label: "더 보기" },
  { icon: "__end__", label: "종료" },
  { icon: "dialpad", label: "키패드" },
];

export default function Phone({ vm }: { vm: CallFlowVM }) {
  return (
    <div style={css("flex:none;width:300px;height:615px")}>
      <div
        className="sf"
        style={css(
          "width:432px;height:886px;transform:scale(.694);transform-origin:top left;position:relative;filter:drop-shadow(0 30px 60px rgba(0,0,0,.55))"
        )}
      >
        {/* 사이드 버튼 — 프레임 뒤에서 살짝 돌출 */}
        <span style={css("position:absolute;left:-2.5px;top:186px;width:3px;height:26px;border-radius:2px 0 0 2px;background:#3c3c40")} />
        <span style={css("position:absolute;left:-2.5px;top:248px;width:3px;height:52px;border-radius:2px 0 0 2px;background:#3c3c40")} />
        <span style={css("position:absolute;left:-2.5px;top:312px;width:3px;height:52px;border-radius:2px 0 0 2px;background:#3c3c40")} />
        <span style={css("position:absolute;right:-2.5px;top:272px;width:3px;height:84px;border-radius:0 2px 2px 0;background:#3c3c40")} />

        {/* 티타늄 림 */}
        <div style={css("position:absolute;inset:0;border-radius:70px;background:linear-gradient(145deg,#55555a 0%,#38383c 45%,#2b2b2f 100%)")} />
        {/* 검은 베젤 */}
        <div style={css("position:absolute;inset:5px;border-radius:65px;background:#000")} />

        {/* 스크린 */}
        <div style={css("position:absolute;inset:17px;border-radius:53px;overflow:hidden;background:#000")}>
          {/* Dynamic Island */}
          <div style={css("position:absolute;top:11px;left:50%;transform:translateX(-50%);width:125px;height:37px;border-radius:20px;background:#000;z-index:50")} />

          {vm.phIdle && <IdleScreen vm={vm} />}
          {vm.phInCall && <InCallScreen vm={vm} />}
        </div>
      </div>
    </div>
  );
}

function StatusBar({ light = false }: { light?: boolean }) {
  return (
    <div
      style={css(
        "display:flex;align-items:center;justify-content:space-between;padding:19px 36px 0;font-size:15px;font-weight:600" +
          (light ? ";color:#fff" : "")
      )}
    >
      <span style={css("letter-spacing:-.2px")}>9:41</span>
      <span style={css("display:flex;align-items:center;gap:6px")}>
        <span className="mi" style={css("font-size:16px")}>signal_cellular_alt</span>
        <span className="mi" style={css("font-size:16px")}>wifi</span>
        <span className="mi" style={css("font-size:17px")}>battery_full</span>
      </span>
    </div>
  );
}

function HomeIndicator({ light = false }: { light?: boolean }) {
  return (
    <span
      style={css(
        "position:absolute;bottom:9px;left:50%;transform:translateX(-50%);width:134px;height:5px;border-radius:3px;background:" +
          (light ? "rgba(255,255,255,.9)" : "rgba(0,0,0,.85)")
      )}
    />
  );
}

function IdleScreen({ vm }: { vm: CallFlowVM }) {
  return (
    <div style={css("position:absolute;inset:0;background:#f5f5f7;color:#1c1c1e;display:flex;flex-direction:column")}>
      <StatusBar />
      <div style={css("flex:1;display:flex;flex-direction:column;padding:0 0 34px")}>
        {/* 다이얼 대상 영역 */}
        <div style={css("text-align:center;margin-top:26px")}>
          <div style={css("font-size:26px;font-weight:500;letter-spacing:.2px")}>키움은행 고객센터</div>
          <div style={css("font-size:14px;color:#3478f6;margin-top:6px;font-weight:400")}>1588-0000</div>
        </div>
        <div style={css("flex:1")} />
        {/* 키패드 — 실기기 비율: 버튼 75px, 열 간격 28px */}
        <div style={css("display:grid;grid-template-columns:repeat(3,75px);justify-content:center;column-gap:28px;row-gap:14px")}>
          {KEYS.map((k) => (
            <div
              key={k.d}
              style={css(
                "display:flex;flex-direction:column;align-items:center;justify-content:center;width:75px;height:75px;border-radius:9999px;background:#e4e4e6"
              )}
            >
              <span
                style={css(
                  "font-size:36px;font-weight:400;color:#1c1c1e;line-height:1" +
                    (k.sub ? "" : ";margin-top:6px")
                )}
              >
                {k.d}
              </span>
              <span style={css("font-size:10px;font-weight:700;letter-spacing:2px;color:#6d6d72;height:12px;margin-top:1px;text-indent:2px")}>
                {k.sub}
              </span>
            </div>
          ))}
        </div>
        {/* 통화 버튼 줄 */}
        <div style={css("display:grid;grid-template-columns:repeat(3,75px);justify-content:center;column-gap:28px;align-items:center;margin-top:14px")}>
          <span />
          <div
            onClick={vm.startCall}
            style={css(
              "width:75px;height:75px;border-radius:9999px;background:#34c759;display:flex;align-items:center;justify-content:center;cursor:pointer"
            )}
          >
            <span className="mi" style={css("font-size:34px;color:#fff")}>call</span>
          </div>
          <span className="mi" style={css("font-size:28px;color:#1c1c1e;justify-self:center;opacity:.55")}>backspace</span>
        </div>
      </div>
      <HomeIndicator />
    </div>
  );
}

function InCallScreen({ vm }: { vm: CallFlowVM }) {
  return (
    <div
      style={css(
        "position:absolute;inset:0;color:#fff;display:flex;flex-direction:column;" +
          "background:radial-gradient(140% 90% at 50% -10%,#3a4152 0%,#252a36 46%,#16181f 100%)"
      )}
    >
      <StatusBar light />
      <div style={css("flex:1;display:flex;flex-direction:column;align-items:center;padding:0 26px 30px")}>
        {/* 아바타 + 발신자 */}
        <div
          style={css(
            "margin-top:46px;width:92px;height:92px;border-radius:9999px;background:linear-gradient(180deg,#8e97a8,#6b7488);display:flex;align-items:center;justify-content:center"
          )}
        >
          <span style={css("font-size:38px;font-weight:600;color:rgba(255,255,255,.95);letter-spacing:-1px")}>키움</span>
        </div>
        <div style={css("font-size:28px;font-weight:600;letter-spacing:-.3px;margin-top:16px")}>키움은행 고객센터</div>
        <div style={css("display:flex;align-items:center;justify-content:center;gap:6px;margin-top:7px;font-size:14px;color:rgba(255,255,255,.65)")}>
          {vm.showRecDot && (
            <span style={css("width:7px;height:7px;border-radius:9999px;background:#ff5a5f;animation:recBlink 1.1s infinite")} />
          )}
          {vm.showTimer ? (
            <>
              <span>{vm.phoneStatus}</span>
              <span className="mono" style={css("color:rgba(255,255,255,.8)")}>{vm.clockStr}</span>
            </>
          ) : (
            vm.phoneStatus
          )}
        </div>

        {vm.showGlass && (
          <div
            style={css(
              "margin-top:24px;width:100%;background:rgba(255,255,255,.12);backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);border:1px solid rgba(255,255,255,.16);border-radius:18px;padding:14px 16px;text-align:center;font-size:13.5px;line-height:1.55;color:rgba(255,255,255,.92)"
            )}
          >
            {vm.glassText}
          </div>
        )}

        {vm.showWave && (
          <div style={css("margin-top:18px;display:flex;align-items:center;justify-content:center;gap:5px;height:24px")}>
            <span style={css("width:4px;height:8px;border-radius:9999px;background:rgba(255,255,255,.85);animation:wave 1s infinite")} />
            <span style={css("width:4px;height:18px;border-radius:9999px;background:#fff;animation:wave .9s infinite .1s")} />
            <span style={css("width:4px;height:22px;border-radius:9999px;background:rgba(255,255,255,.85);animation:wave 1.1s infinite .2s")} />
            <span style={css("width:4px;height:12px;border-radius:9999px;background:#fff;animation:wave .8s infinite .15s")} />
            <span style={css("width:4px;height:16px;border-radius:9999px;background:rgba(255,255,255,.85);animation:wave 1s infinite .25s")} />
          </div>
        )}

        <div style={css("flex:1")} />

        {vm.showControls && (
          <div style={css("display:grid;grid-template-columns:repeat(3,86px);justify-content:center;column-gap:26px;row-gap:24px")}>
            {CONTROLS.map((c) =>
              c.icon === "__end__" ? (
                <div key={c.label} style={css("display:flex;flex-direction:column;align-items:center;gap:8px")}>
                  <span
                    onClick={vm.endCall}
                    style={css(
                      "width:68px;height:68px;border-radius:9999px;background:#ff3b30;display:flex;align-items:center;justify-content:center;cursor:pointer"
                    )}
                  >
                    <span className="mi" style={css("font-size:30px;color:#fff")}>call_end</span>
                  </span>
                  <span style={css("font-size:12px;color:rgba(255,255,255,.85)")}>{c.label}</span>
                </div>
              ) : (
                <div key={c.label} style={css("display:flex;flex-direction:column;align-items:center;gap:8px")}>
                  <span
                    style={css(
                      "width:68px;height:68px;border-radius:9999px;background:rgba(255,255,255,.14);backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px);display:flex;align-items:center;justify-content:center"
                    )}
                  >
                    <span className="mi" style={css("font-size:27px;color:#fff")}>{c.icon}</span>
                  </span>
                  <span style={css("font-size:12px;color:rgba(255,255,255,.85)")}>{c.label}</span>
                </div>
              )
            )}
          </div>
        )}

        {vm.phEnded && (
          <div style={css("display:inline-flex;align-items:center;gap:7px;font-size:14px;color:rgba(255,255,255,.85);margin-bottom:14px")}>
            <span className="mi" style={css("font-size:20px")}>check_circle</span>
            통화가 종료되었습니다
          </div>
        )}
      </div>
      <HomeIndicator light />
    </div>
  );
}
