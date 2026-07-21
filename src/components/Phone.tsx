import { css } from "../lib/css";
import type { CallFlowVM } from "../hooks/useCallFlow";

/**
 * 아이폰 목업 — 프레임을 CSS로 직접 그린다.
 * 베젤 두께가 균일하려면 (바깥 반지름 − 인셋 = 안쪽 반지름)이 지켜져야 한다:
 * 티타늄 림 70px → 베젤 inset 5px(65px) → 스크린 inset 17px(53px).
 * 대기·통화 화면 모두 라이트 — 통화 종료(빨강)와 발신(초록) 버튼은 같은 자리(하단 중앙).
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

/** 실제 아이폰 통화 화면의 2×3 그리드 — 종료 버튼은 그리드가 아니라 하단 중앙 별도 */
const CONTROLS = [
  { icon: "mic_off", label: "소리 끔" }, /* iOS 음소거 = 마이크 사선 (스피커 사선 아님) */
  { icon: "dialpad", label: "키패드" },
  { icon: "volume_up", label: "스피커" },
  { icon: "add_call", label: "통화 추가" },
  { icon: "videocam", label: "FaceTime" },
  { icon: "person", label: "연락처" },
];

export default function Phone({ vm }: { vm: CallFlowVM }) {
  return (
    <div data-tour="phone" style={css("flex:none;width:260px;height:532px;position:relative")}>
      <div
        className="sf"
        style={css(
          "width:432px;height:886px;transform:scale(.6);transform-origin:top left;position:relative;filter:drop-shadow(0 30px 60px rgba(0,0,0,.55))"
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
        <div style={css("position:absolute;inset:17px;border-radius:53px;overflow:hidden;background:#f5f5f7")}>
          {/* Dynamic Island — 완전한 알약(반지름은 항상 높이/2 이상, 패널 반지름 정책과 무관) */}
          <div style={css("position:absolute;top:11px;left:50%;transform:translateX(-50%);width:122px;height:35px;border-radius:9999px;background:#000;z-index:50")} />

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
        "display:flex;align-items:center;justify-content:space-between;padding:19px 36px 0;font-size:15px;font-weight:600;color:#1c1c1e"
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

function HomeIndicator() {
  return (
    <span style={css("position:absolute;bottom:9px;left:50%;transform:translateX(-50%);width:134px;height:5px;border-radius:3px;background:rgba(0,0,0,.85)")} />
  );
}

/** 발신·종료 버튼 공용 줄 — 두 화면에서 같은 자리(하단 중앙)를 지킨다 */
function CallButtonRow({
  color,
  icon,
  onClick,
  sideRight,
  dataTour,
}: {
  color: string;
  icon: string;
  onClick?: () => void;
  sideRight?: React.ReactNode;
  /** 투어 스팟라이트 앵커 이름 — 시연용, 렌더링엔 영향 없음 */
  dataTour?: string;
}) {
  return (
    <div style={css("display:grid;grid-template-columns:repeat(3,75px);justify-content:center;column-gap:28px;align-items:center;margin-top:14px")}>
      <span />
      <div
        onClick={onClick}
        data-tour={dataTour}
        style={css(
          "width:75px;height:75px;border-radius:9999px;background:" + color + ";display:flex;align-items:center;justify-content:center;cursor:pointer"
        )}
      >
        <span className="mi" style={css("font-size:34px;color:#fff")}>{icon}</span>
      </div>
      <span style={css("justify-self:center")}>{sideRight ?? <span />}</span>
    </div>
  );
}

function IdleScreen({ vm }: { vm: CallFlowVM }) {
  return (
    <div style={css("position:absolute;inset:0;color:#1c1c1e;display:flex;flex-direction:column")}>
      <StatusBar />
      <div style={css("flex:1;display:flex;flex-direction:column;padding:0 0 34px")}>
        {/* 다이얼 대상 — 다이내믹 아일랜드와 간격 확보 */}
        <div style={css("text-align:center;margin-top:64px")}>
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
              <span style={css("font-size:36px;font-weight:400;color:#1c1c1e;line-height:1" + (k.sub ? "" : ";margin-top:6px"))}>{k.d}</span>
              <span style={css("font-size:10px;font-weight:700;letter-spacing:2px;color:#6d6d72;height:12px;margin-top:1px;text-indent:2px")}>{k.sub}</span>
            </div>
          ))}
        </div>
        <CallButtonRow
          color="#34c759"
          icon="call"
          onClick={vm.startCall}
          dataTour="phone-call"
          sideRight={<span className="mi" style={css("font-size:28px;color:#1c1c1e;opacity:.55")}>backspace</span>}
        />
      </div>
      <HomeIndicator />
    </div>
  );
}

function InCallScreen({ vm }: { vm: CallFlowVM }) {
  return (
    <div style={css("position:absolute;inset:0;color:#1c1c1e;display:flex;flex-direction:column")}>
      <StatusBar />
      <div style={css("flex:1;display:flex;flex-direction:column;align-items:center;padding:0 26px 34px")}>
        {/* 아바타 + 발신자 */}
        <div
          style={css(
            "margin-top:40px;width:92px;height:92px;border-radius:9999px;background:linear-gradient(180deg,#9aa3b2,#78818f);display:flex;align-items:center;justify-content:center"
          )}
        >
          <span style={css("font-size:38px;font-weight:600;color:#fff;letter-spacing:-1px")}>키움</span>
        </div>
        <div style={css("font-size:28px;font-weight:600;letter-spacing:-.3px;margin-top:16px")}>키움은행 고객센터</div>

        {/* 상태 표시 — 실제 고객 화면엔 없는 정보라 '시연 표기'를 명시한다 */}
        <div style={css("display:flex;align-items:center;gap:7px;margin-top:10px")}>
          <span style={css("font-size:10.5px;font-weight:700;letter-spacing:.4px;color:#8a8a8e;border:1px solid #d1d1d6;border-radius:9999px;padding:2px 8px;background:#fff")}>시연 표기</span>
          <span style={css("display:flex;align-items:center;gap:6px;font-size:15px;font-weight:500;color:#3a3a3c")}>
            {vm.showRecDot && (
              <span style={css("width:8px;height:8px;border-radius:9999px;background:#ff3b30;animation:recBlink 1.1s infinite")} />
            )}
            {vm.phoneStatus}
            {vm.showTimer && <span className="mono" style={css("color:#1c1c1e")}>{vm.clockStr}</span>}
          </span>
        </div>

        {vm.showGlass && (
          <div
            style={css(
              "margin-top:22px;width:100%;background:rgba(0,0,0,.05);border:1px solid rgba(0,0,0,.07);border-radius:18px;padding:14px 16px;text-align:center;font-size:13.5px;line-height:1.55;color:#3a3a3c"
            )}
          >
            {vm.glassText}
          </div>
        )}

        {vm.showWave && (
          <div style={css("margin-top:18px;display:flex;align-items:center;justify-content:center;gap:5px;height:24px")}>
            {/* 바 높이는 22px 고정, 신축은 scaleY(GPU) — 위상차는 delay가 만든다 */}
            <span style={css("width:4px;height:22px;border-radius:9999px;background:#8a8a8e;animation:wave 1s infinite")} />
            <span style={css("width:4px;height:22px;border-radius:9999px;background:#3a3a3c;animation:wave .9s infinite .1s")} />
            <span style={css("width:4px;height:22px;border-radius:9999px;background:#8a8a8e;animation:wave 1.1s infinite .2s")} />
            <span style={css("width:4px;height:22px;border-radius:9999px;background:#3a3a3c;animation:wave .8s infinite .15s")} />
            <span style={css("width:4px;height:22px;border-radius:9999px;background:#8a8a8e;animation:wave 1s infinite .25s")} />
          </div>
        )}

        <div style={css("flex:1")} />

        {vm.phEnded && (
          <div style={css("display:inline-flex;align-items:center;gap:7px;font-size:14px;color:#3a3a3c;margin-bottom:14px")}>
            <span className="mi" style={css("font-size:20px")}>check_circle</span>
            통화가 종료되었습니다
          </div>
        )}

        {vm.showControls && (
          <div style={css("width:100%;display:flex;flex-direction:column")}>
            {/* 2×3 컨트롤 그리드 — 실기 비율: 세로 간격은 라벨 포함 여유 있게 */}
            <div style={css("display:grid;grid-template-columns:repeat(3,75px);justify-content:center;column-gap:28px;row-gap:20px")}>
              {CONTROLS.map((c) => (
                <div key={c.label} style={css("display:flex;flex-direction:column;align-items:center;gap:7px")}>
                  <span
                    /* '통화 추가' = 데모 제어 — 관리자 대기열에 랜덤 상담카드가 새로 들어온다 */
                    onClick={c.label === "통화 추가" ? vm.addQueueCall : undefined}
                    title={c.label === "통화 추가" ? "데모: 대기열에 새 상담 인입 추가" : undefined}
                    style={css(
                      "width:75px;height:75px;border-radius:9999px;background:#e4e4e6;display:flex;align-items:center;justify-content:center" +
                        (c.label === "통화 추가" ? ";cursor:pointer" : "")
                    )}
                  >
                    <span className="mi" style={css("font-size:28px;color:#1c1c1e")}>{c.icon}</span>
                  </span>
                  <span style={css("font-size:12px;color:#3a3a3c")}>{c.label}</span>
                </div>
              ))}
            </div>
            {/* 종료 — 대기 화면의 발신 버튼과 같은 자리 */}
            <CallButtonRow color="#ff3b30" icon="call_end" onClick={vm.endCall} />
          </div>
        )}
      </div>
      <HomeIndicator />
    </div>
  );
}
