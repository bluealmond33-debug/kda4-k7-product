import { useEffect, useState } from "react";
import { css } from "../lib/css";
import type { CallFlowVM } from "../hooks/useCallFlow";
import AppleIcon from "./AppleIcon";

/**
 * 아이폰 목업 — 프레임을 CSS로 직접 그린다. 실기기 스크린샷(IMG_7570~7572) 기준,
 * 아이콘은 애플 SF Symbols를 본뜬 Framework7 Icons(MIT)를 SVG로 이식(AppleIcon):
 * - 다이얼 화면: 검은 배경 + 큼직한 어두운 원형 키패드(88px) — 하단 탭바는 시연에서 제외
 * - 통화 화면: 따뜻한 갈색-주황 그라데이션 + 상단 타이머→이름 + 하단 2×3 반투명
 *   컨트롤(가운데 아래 빨간 종료). 타이머는 통화 누르자마자 00:01부터.
 * - 통화 중 다이나믹 아일랜드 왼쪽에 주황 점(마이크 사용 표시).
 *
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

/** 키패드 원형 버튼 — 포인터 다운 시 밝아지는 눌림 피드백 + 클릭 시 숫자 입력.
 *  variant: dark=다이얼 화면(어두운 원) · glass=통화 중 인콜 키패드(반투명 흰 원). */
function KeyButton({
  k,
  onPress,
  variant = "dark",
}: {
  k: { d: string; sub: string };
  onPress: (d: string) => void;
  variant?: "dark" | "glass";
}) {
  const [pressed, setPressed] = useState(false);
  const symbol = k.d === "*" || k.d === "#";
  const glass = variant === "glass";
  const bg = glass
    ? pressed
      ? "rgba(255,255,255,.42)"
      : "rgba(255,255,255,.17)"
    : pressed
    ? "#5a5a5e"
    : "#2c2c2e";
  return (
    <div
      onPointerDown={() => setPressed(true)}
      onPointerUp={() => setPressed(false)}
      onPointerLeave={() => setPressed(false)}
      onClick={() => onPress(k.d)}
      style={{
        ...css("position:relative;width:88px;height:88px;border-radius:9999px;cursor:pointer;user-select:none;transition:background .09s"),
        background: bg,
        ...(glass ? { backdropFilter: "blur(4px)" } : null),
      }}
    >
      <span
        style={css(
          "position:absolute;left:0;right:0;text-align:center;font-size:42px;font-weight:400;color:#fff;line-height:1;transform:translateY(-50%);top:" +
            (k.d === "*" ? "66%" : symbol ? "55%" : "42%")
        )}
      >
        {k.d}
      </span>
      {!symbol && (
        <span
          style={{
            ...css("position:absolute;left:0;right:0;bottom:14px;text-align:center;font-size:10.5px;font-weight:700;letter-spacing:2px;text-indent:2px"),
            color: glass ? "rgba(255,255,255,.7)" : "#9a9aa0",
          }}
        >
          {k.sub.trim()}
        </span>
      )}
    </div>
  );
}

/** clean — 고객 화면(?role=customer)용: 실제 휴대폰에 없는 시연 표기(상태·안내 유리판·파형)를
 *  숨긴다. 그 정보는 상단 상황 알약과 실시간 통화 패널이 대신 보여준다. */
export default function Phone({ vm, clean = false }: { vm: CallFlowVM; clean?: boolean }) {
  return (
    <div
      data-tour="phone"
      style={css(
        "flex:none;position:relative;width:" +
          (clean ? "400px" : "260px") +
          ";height:" +
          (clean ? "820px" : "532px")
      )}
    >
      <div
        className="sf"
        style={css(
          "width:432px;height:886px;transform:scale(" +
            (clean ? "0.9259" : ".6") +
            ");transform-origin:top left;position:relative;filter:drop-shadow(0 30px 60px rgba(0,0,0,.55))"
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
          {/* Dynamic Island — 완전한 알약. 통화 중엔 왼쪽에 주황 점(마이크 사용 표시) */}
          <div style={css("position:absolute;top:11px;left:50%;transform:translateX(-50%);width:122px;height:35px;border-radius:9999px;background:#000;z-index:50;display:flex;align-items:center")}>
            {vm.phInCall && !vm.phEnded && (
              <span style={css("width:7px;height:7px;border-radius:9999px;background:#ff9f0a;margin-left:16px")} />
            )}
          </div>

          {vm.phIdle && <IdleScreen vm={vm} />}
          {vm.phInCall && <InCallScreen vm={vm} clean={clean} />}
        </div>
      </div>
    </div>
  );
}

/** 상태바 — 다크 화면(흰 글씨) 전용. 두 화면 모두 어두워졌다 */
function StatusBar() {
  return (
    <div
      style={css(
        "display:flex;align-items:center;justify-content:space-between;padding:19px 36px 0;font-size:15px;font-weight:600;color:#fff;position:relative;z-index:60"
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
    <span style={css("position:absolute;bottom:9px;left:50%;transform:translateX(-50%);width:134px;height:5px;border-radius:3px;background:rgba(255,255,255,.85)")} />
  );
}

function CallButtonRow({
  color,
  icon,
  onClick,
}: {
  color: string;
  icon: "call" | "call_end";
  onClick?: () => void;
}) {
  return (
    <div style={css("display:grid;grid-template-columns:repeat(3,88px);justify-content:center;column-gap:24px;align-items:center;margin-top:16px")}>
      <span />
      <div
        onClick={onClick}
        style={css(
          "width:88px;height:88px;border-radius:9999px;background:" +
            color +
            ";display:flex;align-items:center;justify-content:center;cursor:pointer"
        )}
      >
        <AppleIcon name={icon === "call_end" ? "callEnd" : "call"} size={42} />
      </div>
      <span />
    </div>
  );
}

/** 다이얼 화면 — IMG_7572: 검은 배경, 큼직한 키패드 원, 초록 발신 (애플 글리프).
 *  키패드는 클릭 가능 — 누르면 밝아지고(KeyButton) 입력한 번호가 위에 표시된다. */
function IdleScreen({ vm }: { vm: CallFlowVM }) {
  // 입력한 번호 — 비어 있으면 기본 대상(키움은행)을 보여주고, 누르기 시작하면 입력값으로 바뀐다
  const [dialed, setDialed] = useState("");
  const hasInput = dialed.length > 0;
  return (
    <div style={css("position:absolute;inset:0;background:#000;color:#fff;display:flex;flex-direction:column")}>
      <StatusBar />
      <div style={css("flex:1;display:flex;flex-direction:column;padding:0 0 30px")}>
        {/* 다이얼 대상 — 실기기처럼 번호가 크게 위, 이름은 작게 아래 (다이내믹 아일랜드와 간격 확보) */}
        <div style={css("text-align:center;margin-top:60px")}>
          <div style={css("font-size:40px;font-weight:500;letter-spacing:.5px;color:#fff;line-height:1.1;min-height:44px")}>{hasInput ? dialed : "1588-0000"}</div>
          <div style={css("font-size:15px;color:#fff;margin-top:10px;font-weight:400")}>
            키움은행 고객센터 <span style={css("font-weight:700")}>mobile</span>
          </div>
        </div>
        <div style={css("flex:1")} />
        {/* 키패드 — 클릭 시 입력·눌림 피드백(KeyButton). 실기기 비율(IMG_7572): 큼직한 원 88px */}
        <div style={css("display:grid;grid-template-columns:repeat(3,88px);justify-content:center;column-gap:24px;row-gap:16px")}>
          {KEYS.map((k) => (
            <KeyButton key={k.d} k={k} onPress={(d) => setDialed((s) => s + d)} />
          ))}
        </div>
        {/* 발신 — 키패드 아래 중앙 초록 원 (애플 핸드셋 글리프). 우측 백스페이스는 입력이 있을 때만 지운다.
            margin-bottom 29 = 통화 화면 빨간 종료 버튼과 화면상 같은 위치(중심 y 정렬) */}
        <div style={css("display:grid;grid-template-columns:repeat(3,88px);justify-content:center;column-gap:24px;align-items:center;margin-top:16px;margin-bottom:29px")}>
          <span />
          <div
            data-tour="phone-call"
            onClick={vm.startCall}
            style={css("width:88px;height:88px;border-radius:9999px;background:#30d158;display:flex;align-items:center;justify-content:center;cursor:pointer")}
          >
            <AppleIcon name="call" size={42} />
          </div>
          <span
            onClick={hasInput ? () => setDialed((s) => s.slice(0, -1)) : undefined}
            style={css("justify-self:center;transition:opacity .12s;opacity:" + (hasInput ? "1;cursor:pointer" : ".35"))}
          >
            <AppleIcon name="backspace" size={34} />
          </span>
        </div>
      </div>
      <HomeIndicator />
    </div>
  );
}

/** 통화 컨트롤 2×3 — IMG_7570/7571: 반투명 원, 가운데 아래 빨간 종료.
 *  글리프마다 56박스 안 여백이 달라 광학 보정(size·dy)으로 원 중심에 맞춘다 —
 *  FaceTime 카메라는 박스를 꽉 채우는 글리프라 축소+살짝 내림 */
const CALL_CONTROLS: {
  icon: "speaker" | "facetime" | "micSlash" | "more" | "callEnd" | "keypad";
  label: string;
  end?: boolean;
  size?: number;
  dy?: number;
}[] = [
  { icon: "speaker", label: "오디오" },
  { icon: "facetime", label: "FaceTime", size: 48 },
  { icon: "micSlash", label: "소리 끔" },
  { icon: "more", label: "기타" },
  { icon: "callEnd", label: "종료", end: true },
  { icon: "keypad", label: "키패드" },
];

/** FaceTime 버튼 글리프 — 실기기(IMG_7571): 카메라 본체 + 오른쪽 렌즈 + 본체에 '?' 녹아웃.
 *  (iOS가 FaceTime 미지원 번호에 표시하는 아이콘). mask로 '?'를 뚫어 배경이 비치게 한다. */
function FaceTimeGlyph({ size = 38 }: { size?: number }) {
  const mid = "ftcam"; // 단일 인스턴스라 고정 id로 충분
  return (
    <svg width={size} height={size} viewBox="0 0 56 56" aria-hidden>
      <defs>
        <mask id={mid}>
          <rect width="56" height="56" fill="black" />
          <rect x="8" y="18" width="29" height="21" rx="6.5" fill="white" />
          <polygon points="39,24 49,18 49,38 39,32" fill="white" />
          <text
            x="21.5"
            y="34.5"
            fontSize="17"
            fontWeight="800"
            textAnchor="middle"
            fill="black"
            fontFamily="'Avenir Next','Pretendard',system-ui,sans-serif"
          >
            ?
          </text>
        </mask>
      </defs>
      <rect width="56" height="56" fill="#fff" mask={`url(#${mid})`} />
    </svg>
  );
}

/** 통화 화면 — IMG_7570/7571: 웜 그라데이션, 상단 타이머→이름, 하단 컨트롤 */
function InCallScreen({ vm, clean = false }: { vm: CallFlowVM; clean?: boolean }) {
  // 통화 중 키패드 — 고객 화면에서만 열리고(ARS 게이트가 열렸을 때), 누른 숫자는
  // vm.customerPressDigit으로 백엔드 DTMF 저장까지 간다. 통화가 끝나면 자동으로 닫는다.
  const [keypadOpen, setKeypadOpen] = useState(false);
  useEffect(() => {
    if (vm.phEnded) setKeypadOpen(false);
  }, [vm.phEnded]);

  if (clean && keypadOpen && !vm.phEnded) {
    return <CustomerKeypadScreen vm={vm} close={() => setKeypadOpen(false)} />;
  }

  return (
    <div
      style={css(
        "position:absolute;inset:0;color:#fff;display:flex;flex-direction:column;background:linear-gradient(168deg,#63503f 0%,#5d4536 26%,#6e4531 52%,#8a3b28 76%,#792d20 100%)"
      )}
    >
      <StatusBar />
      <div style={css("flex:1;display:flex;flex-direction:column;align-items:center;padding:0 26px 30px")}>
        {/* 타이머 → 이름 — 실기기 순서. 타이머는 통화 누르자마자 00:01부터 */}
        <div style={css("margin-top:58px;font-size:23px;font-weight:400;color:rgba(255,255,255,.62);letter-spacing:.5px")}>
          {vm.phEnded ? "통화 종료" : vm.phoneClockStr}
        </div>
        <div style={css("font-size:33px;font-weight:600;letter-spacing:-.3px;margin-top:6px;color:#fff;text-shadow:0 1px 8px rgba(0,0,0,.25)")}>
          키움은행 고객센터
        </div>

        {/* 상태 표시 — 실제 고객 화면엔 없는 정보라 '시연 표기'를 명시한다.
            clean(고객 화면)에선 통째로 숨기고 상단 상황 알약이 대신 보여준다 */}
        {!clean && (
          <div style={css("display:flex;align-items:center;gap:7px;margin-top:12px")}>
            <span style={css("font-size:10.5px;font-weight:700;letter-spacing:.4px;color:rgba(255,255,255,.75);border:1px solid rgba(255,255,255,.35);border-radius:9999px;padding:2px 8px;background:rgba(255,255,255,.12)")}>시연 표기</span>
            <span style={css("display:flex;align-items:center;gap:6px;font-size:14px;font-weight:500;color:rgba(255,255,255,.85)")}>
              {vm.showRecDot && (
                <span style={css("width:8px;height:8px;border-radius:9999px;background:#ff453a;animation:recBlink 1.1s infinite")} />
              )}
              {vm.phoneStatus}
            </span>
          </div>
        )}

        {!clean && vm.showGlass && (
          <div
            style={css(
              "margin-top:20px;width:100%;background:rgba(255,255,255,.14);border:1px solid rgba(255,255,255,.18);border-radius:18px;padding:14px 16px;text-align:center;font-size:13.5px;line-height:1.55;color:rgba(255,255,255,.92);backdrop-filter:blur(6px)"
            )}
          >
            {vm.glassText}
          </div>
        )}

        {!clean && vm.showWave && (
          <div style={css("margin-top:18px;display:flex;align-items:center;justify-content:center;gap:5px;height:24px")}>
            {/* 바 높이는 22px 고정, 신축은 scaleY(GPU) — 위상차는 delay가 만든다 */}
            <span style={css("width:4px;height:22px;border-radius:9999px;background:rgba(255,255,255,.55);animation:wave 1s infinite")} />
            <span style={css("width:4px;height:22px;border-radius:9999px;background:rgba(255,255,255,.9);animation:wave .9s infinite .1s")} />
            <span style={css("width:4px;height:22px;border-radius:9999px;background:rgba(255,255,255,.55);animation:wave 1.1s infinite .2s")} />
            <span style={css("width:4px;height:22px;border-radius:9999px;background:rgba(255,255,255,.9);animation:wave .8s infinite .15s")} />
            <span style={css("width:4px;height:22px;border-radius:9999px;background:rgba(255,255,255,.55);animation:wave 1s infinite .25s")} />
          </div>
        )}

        {vm.showWave && vm.micActive && (
          <div style={css("margin-top:14px;width:100%;display:flex;flex-direction:column;gap:8px;align-items:center")}>
            <div style={css("display:flex;align-items:center;gap:7px;font-size:12.5px;font-weight:600;color:#ff3b30")}>
              <span style={css("width:9px;height:9px;border-radius:50%;background:#ff3b30;animation:recBlink 1.1s infinite")} />
              마이크 녹음 중 — 말해보세요
            </div>
            <div style={css("width:80%;height:8px;background:rgba(0,0,0,.08);border-radius:4px;overflow:hidden")}>
              <div style={css("height:100%;background:#22c55e;border-radius:4px;transition:width .08s;width:" + Math.min(100, vm.micLevel * 500) + "%")} />
            </div>
          </div>
        )}

        {vm.showWave && vm.liveCaption && (
          <div
            style={css(
              "margin-top:16px;width:100%;background:rgba(0,0,0,.05);border:1px solid rgba(0,0,0,.07);border-radius:14px;padding:12px 14px;font-size:14px;line-height:1.55;color:#1c1c1e;text-align:center"
            )}
          >
            {vm.liveCaption}
          </div>
        )}

        <div style={css("flex:1")} />

        {vm.phEnded && (
          <div style={css("display:inline-flex;align-items:center;gap:7px;font-size:14px;color:rgba(255,255,255,.85);margin-bottom:14px")}>
            <span className="mi" style={css("font-size:20px")}>check_circle</span>
            통화가 종료되었습니다
          </div>
        )}

        {/* 통화 컨트롤 2×3 — '키패드'를 누르면 인콜 키패드로 전환된다 */}
        {vm.showControls && !keypadOpen && (
          <div style={css("display:grid;grid-template-columns:repeat(3,88px);justify-content:center;column-gap:24px;row-gap:22px;margin-bottom:5px")}>
            {CALL_CONTROLS.map((c) => (
              <div
                key={c.label}
                style={css(
                  "display:flex;flex-direction:column;align-items:center;gap:8px;" +
                    (c.icon === "keypad" && clean && !vm.customerKeypadEnabled ? "opacity:.42" : "")
                )}
              >
                <span
                  onClick={
                    c.end
                      ? vm.endCall
                      : c.icon === "keypad" && clean && vm.customerKeypadEnabled
                      ? () => setKeypadOpen(true)
                      : undefined
                  }
                  style={css(
                    "width:88px;height:88px;border-radius:9999px;display:flex;align-items:center;justify-content:center;" +
                      (c.end
                        ? "background:#eb332a;cursor:pointer;box-shadow:0 0 26px rgba(235,51,42,.45)"
                        : "background:rgba(255,255,255,.17);backdrop-filter:blur(4px);") +
                      (c.icon === "keypad" && clean
                        ? vm.customerKeypadEnabled
                          ? "cursor:pointer"
                          : "cursor:not-allowed"
                        : "")
                  )}
                >
                  {c.icon === "facetime" ? (
                    <FaceTimeGlyph size={c.size ?? 38} />
                  ) : (
                    <AppleIcon
                      name={c.icon}
                      size={c.size ?? 36}
                      style={c.dy ? { transform: `translateY(${c.dy}px)` } : undefined}
                    />
                  )}
                </span>
                <span style={css("font-size:13px;color:rgba(255,255,255,.92)")}>{c.label}</span>
              </div>
            ))}
          </div>
        )}
        {vm.phEnded && vm.isCustomerSurface && (
          <div style={css("display:flex;flex-direction:column;align-items:center;gap:7px")}>
            <span style={css("font-size:13px;color:#8a8a8e")}>새 상담을 시작할 수 있습니다</span>
            <CallButtonRow color="#34c759" icon="call" onClick={vm.startCall} />
          </div>
        )}
      </div>
      <HomeIndicator />
    </div>
  );
}

function CustomerKeypadScreen({
  vm,
  close,
}: {
  vm: CallFlowVM;
  close: () => void;
}) {
  const press = (digit: string) => {
    if (!vm.customerKeypadEnabled) return;
    if (vm.customerPressDigit(digit)) navigator.vibrate?.(22);
  };
  const prompt = vm.mobileAgentConnected
    ? "상담원 통화 중 · 번호를 입력하세요"
    : vm.mobileIntakePending
    ? "마지막 발화를 처리하고 있습니다"
    : vm.mobileIntakeComplete
    ? "상담사가 통화를 준비하고 있습니다"
    : "용건을 모두 말씀하셨으면 #을 눌러 주세요";

  return (
    <div style={css("position:absolute;inset:0;color:#1c1c1e;display:flex;flex-direction:column")}>
      <StatusBar />
      <div style={css("display:flex;align-items:center;justify-content:center;position:relative;margin-top:47px")}>
        <span
          onClick={close}
          style={css("position:absolute;left:31px;width:42px;height:42px;border-radius:9999px;background:#e4e4e6;display:flex;align-items:center;justify-content:center;cursor:pointer")}
        >
          <span className="mi" style={css("font-size:22px")}>close</span>
        </span>
        <div style={css("text-align:center")}>
          <div style={css("font-size:21px;font-weight:600")}>키움은행 고객센터</div>
          <div style={css("font-size:13px;color:#8a8a8e;margin-top:5px")}>{prompt}</div>
        </div>
      </div>
      <div style={css("height:48px;display:flex;align-items:center;justify-content:center;font:500 24px 'Geist Mono',monospace;letter-spacing:7px;color:#3478f6")}>
        {vm.arsDigits || " "}
      </div>
      <div style={css("display:grid;grid-template-columns:repeat(3,75px);justify-content:center;column-gap:28px;row-gap:14px;opacity:" + (vm.customerKeypadEnabled ? "1" : ".42"))}>
        {KEYS.map((key) => (
          <div
            key={key.d}
            onClick={() => press(key.d)}
            style={css("display:flex;flex-direction:column;align-items:center;justify-content:center;width:75px;height:75px;border-radius:9999px;background:#e4e4e6;cursor:" + (vm.customerKeypadEnabled ? "pointer" : "not-allowed"))}
          >
            <span style={css("font-size:36px;font-weight:400;color:#1c1c1e;line-height:1" + (key.sub ? "" : ";margin-top:6px"))}>{key.d}</span>
            <span style={css("font-size:10px;font-weight:700;letter-spacing:2px;color:#6d6d72;height:12px;margin-top:1px;text-indent:2px")}>{key.sub}</span>
          </div>
        ))}
      </div>
      <div style={css("margin-top:auto;padding-bottom:34px")}>
        <CallButtonRow color="#ff3b30" icon="call_end" onClick={vm.endCall} />
      </div>
      <HomeIndicator />
    </div>
  );
}
