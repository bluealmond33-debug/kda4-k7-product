import { css } from "../lib/css";
import type { CallFlowVM } from "../hooks/useCallFlow";
import phoneFrame from "../assets/iphone.png";

const KEYS: { d: string; sub: string }[] = [
  { d: "1", sub: "" },
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
  { icon: "volume_up", label: "스피커", strong: true },
  { icon: "videocam", label: "FaceTime", strong: false },
  { icon: "mic_off", label: "소리 끔", strong: true },
  { icon: "more_horiz", label: "더 보기", strong: true },
  { icon: "__end__", label: "종료", strong: true },
  { icon: "dialpad", label: "키패드", strong: true },
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
        <img
          src={phoneFrame}
          alt=""
          style={css("position:absolute;inset:0;width:100%;height:100%;z-index:0")}
        />
        <div
          style={css(
            "position:absolute;left:15px;right:15px;top:13px;bottom:13px;border-radius:48px;overflow:hidden;background:#000;z-index:1"
          )}
        >
          <div
            style={css(
              "position:absolute;top:12px;left:50%;transform:translateX(-50%);width:120px;height:35px;border-radius:20px;background:#000;z-index:50"
            )}
          />

          {vm.phIdle && <IdleScreen vm={vm} />}
          {vm.phInCall && <InCallScreen vm={vm} />}
        </div>
      </div>
    </div>
  );
}

function StatusBar() {
  return (
    <div
      style={css(
        "display:flex;align-items:center;justify-content:space-between;padding:16px 30px 0;font-size:14px;font-weight:600"
      )}
    >
      <span className="mono">9:41</span>
      <span style={css("display:flex;align-items:center;gap:6px")}>
        <span className="mi" style={css("font-size:16px")}>
          signal_cellular_alt
        </span>
        <span className="mi" style={css("font-size:16px")}>
          wifi
        </span>
        <span className="mi" style={css("font-size:17px")}>
          battery_full
        </span>
      </span>
    </div>
  );
}

function IdleScreen({ vm }: { vm: CallFlowVM }) {
  return (
    <div
      style={css(
        "position:absolute;inset:0;background:#eef0f4;color:#1c1c1e;display:flex;flex-direction:column"
      )}
    >
      <StatusBar />
      <div style={css("flex:1;display:flex;flex-direction:column;padding:0 24px 14px")}>
        <div style={css("text-align:center;margin-top:14px")}>
          <div style={css("font-size:23px;font-weight:600;letter-spacing:-.3px")}>
            키움은행 고객센터
          </div>
          <div className="mono" style={css("font-size:15px;color:#8a8a8e;margin-top:5px")}>
            1588-0000
          </div>
        </div>
        <div style={css("flex:1")} />
        <div
          style={css(
            "display:grid;grid-template-columns:repeat(3,1fr);row-gap:13px;justify-items:center"
          )}
        >
          {KEYS.map((k) => (
            <div
              key={k.d}
              style={css(
                "display:flex;flex-direction:column;align-items:center;justify-content:center;width:72px;height:72px;border-radius:9999px;background:#e2e4e9"
              )}
            >
              <span style={css("font-size:34px;font-weight:400;color:#1c1c1e;line-height:1")}>
                {k.d}
              </span>
              <span
                style={css(
                  "font-size:8.5px;font-weight:600;letter-spacing:1.5px;color:rgba(60,60,67,.6);height:10px;margin-top:2px"
                )}
              >
                {k.sub}
              </span>
            </div>
          ))}
        </div>
        <div
          style={css(
            "display:grid;grid-template-columns:repeat(3,1fr);align-items:center;justify-items:center;margin-top:16px"
          )}
        >
          <span />
          <div
            onClick={vm.startCall}
            style={css(
              "width:72px;height:72px;border-radius:9999px;background:#34c759;display:flex;align-items:center;justify-content:center;cursor:pointer;box-shadow:0 6px 18px rgba(52,199,89,.45)"
            )}
          >
            <span className="mi" style={css("font-size:33px;color:#fff")}>
              call
            </span>
          </div>
          <span className="mi" style={css("font-size:26px;color:#8a8a8e")}>
            backspace
          </span>
        </div>
      </div>
    </div>
  );
}

function InCallScreen({ vm }: { vm: CallFlowVM }) {
  return (
    <div
      style={css(
        "position:absolute;inset:0;background:linear-gradient(180deg,#3d7f9e 0%,#3f6d8c 32%,#455e78 68%,#4a586d 100%);color:#fff;display:flex;flex-direction:column"
      )}
    >
      <StatusBar />
      <div
        style={css(
          "flex:1;display:flex;flex-direction:column;align-items:center;padding:0 26px 24px"
        )}
      >
        <div style={css("text-align:center;margin-top:52px")}>
          {vm.showTimer && (
            <div className="mono" style={css("font-size:17px;color:rgba(255,255,255,.85)")}>
              {vm.clockStr}
            </div>
          )}
          <div style={css("font-size:30px;font-weight:600;letter-spacing:-.3px;margin-top:4px")}>
            키움은행 고객센터
          </div>
          <div
            style={css(
              "display:flex;align-items:center;justify-content:center;gap:6px;margin-top:8px;font-size:13px;color:rgba(255,255,255,.75)"
            )}
          >
            {vm.showRecDot && (
              <span
                style={css(
                  "width:8px;height:8px;border-radius:9999px;background:#ff5a5f;animation:recBlink 1.1s infinite"
                )}
              />
            )}
            {vm.phoneStatus}
          </div>
        </div>

        {vm.showGlass && (
          <div
            style={css(
              "margin-top:26px;width:100%;background:rgba(255,255,255,.16);backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);border:1px solid rgba(255,255,255,.22);border-radius:16px;padding:14px 16px;text-align:center;font-size:13.5px;line-height:1.55;color:#fff"
            )}
          >
            {vm.glassText}
          </div>
        )}

        {vm.showWave && (
          <div
            style={css(
              "margin-top:18px;display:flex;align-items:center;justify-content:center;gap:5px;height:24px"
            )}
          >
            <span style={css("width:4px;height:8px;border-radius:9999px;background:rgba(255,255,255,.85);animation:wave 1s infinite")} />
            <span style={css("width:4px;height:18px;border-radius:9999px;background:#fff;animation:wave .9s infinite .1s")} />
            <span style={css("width:4px;height:22px;border-radius:9999px;background:rgba(255,255,255,.85);animation:wave 1.1s infinite .2s")} />
            <span style={css("width:4px;height:12px;border-radius:9999px;background:#fff;animation:wave .8s infinite .15s")} />
            <span style={css("width:4px;height:16px;border-radius:9999px;background:rgba(255,255,255,.85);animation:wave 1s infinite .25s")} />
          </div>
        )}

        <div style={css("flex:1")} />

        {vm.showControls && (
          <div
            style={css(
              "width:100%;display:grid;grid-template-columns:repeat(3,1fr);row-gap:20px;justify-items:center"
            )}
          >
            {CONTROLS.map((c) =>
              c.icon === "__end__" ? (
                <div key={c.label} style={css("display:flex;flex-direction:column;align-items:center;gap:7px")}>
                  <span
                    onClick={vm.endCall}
                    style={css(
                      "width:64px;height:64px;border-radius:9999px;background:#ff3b30;display:flex;align-items:center;justify-content:center;cursor:pointer;box-shadow:0 6px 18px rgba(255,59,48,.4)"
                    )}
                  >
                    <span className="mi" style={css("font-size:28px;color:#fff")}>
                      call_end
                    </span>
                  </span>
                  <span style={css("font-size:12px;color:#fff")}>{c.label}</span>
                </div>
              ) : (
                <div key={c.label} style={css("display:flex;flex-direction:column;align-items:center;gap:7px")}>
                  <span
                    style={css(
                      "width:64px;height:64px;border-radius:9999px;background:rgba(255,255,255," +
                        (c.strong ? ".22" : ".16") +
                        ");backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px);display:flex;align-items:center;justify-content:center"
                    )}
                  >
                    <span
                      className="mi"
                      style={css("font-size:26px;color:" + (c.strong ? "#fff" : "rgba(255,255,255,.7)"))}
                    >
                      {c.icon}
                    </span>
                  </span>
                  <span style={css("font-size:12px;color:" + (c.strong ? "#fff" : "rgba(255,255,255,.85)"))}>
                    {c.label}
                  </span>
                </div>
              )
            )}
          </div>
        )}

        {vm.phEnded && (
          <div
            style={css(
              "display:inline-flex;align-items:center;gap:7px;font-size:14px;color:rgba(255,255,255,.85);margin-bottom:18px"
            )}
          >
            <span className="mi" style={css("font-size:20px")}>
              check_circle
            </span>
            통화가 종료되었습니다
          </div>
        )}
      </div>
    </div>
  );
}
