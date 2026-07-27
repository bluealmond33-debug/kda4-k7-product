import { useEffect, useState } from "react";
import { css } from "../lib/css";
import type { CallFlowVM } from "../hooks/useCallFlow";
import AppleIcon from "./AppleIcon";
import { BrandSymbol } from "./BrandLogo";
import { CUSTOMER } from "../data/demoContent";
import { useMic } from "../lib/mic";

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

/** 안내에서 '이 키를 누르세요'로 권하는 키. 실제로는 로컬 데모에서 어떤 키를 눌러도 통화가
 *  끝나지만(시연 중 오조작 방지), 안내 문구는 ARS 관례대로 우물정자를 권한다. */
const END_CALL_DIGIT = "#";

/* ── 화면별 톤 — 실기기를 그대로 따른다 ─────────────────────────────────────────────
   · 다이얼·문자 = 라이트(흰 배경 + 검은 글씨)
   · 통화·키패드 = 웜 그라데이션(연락처 배경) + 흰 글씨 + 유리 버튼
   실기기가 이렇게 나뉘어 있다. 통화 화면까지 라이트로 바꿔 봤더니 유리가 비칠 색이 없어
   유리가 유리로 보이지 않았다 — 유리는 뒤에 색이 있을 때만 유리다. */
const INK = "#1c1c1e";
const INK_SUB = "#71757f";
const RED_END = "#f0453a";

/** 통화·키패드 화면의 잉크 — 웜 배경 위라 흰 글씨다 */
const ON_WARM = "#fff";
const ON_WARM_SUB = "rgba(255,255,255,.62)";

/**
 * 통화·키패드 배경 — 실기기와 같은 웜 그라데이션.
 *
 * 실기기는 통화가 붙으면 연락처 배경(포스터/월페이퍼)을 흐려서 깔고, 그 위에 유리 버튼을
 * 얹는다. 다이얼 화면만 라이트 UI다 — 그래서 여기 둘만 웜이고 다이얼·문자는 라이트로 둔다.
 * 한때 이 둘도 라이트로 바꿨는데, 유리가 비칠 색이 없어 그냥 흰 반투명 원처럼 보였다.
 */
const GLASS_BG =
  "background:linear-gradient(168deg,#63503f 0%,#5d4536 26%,#6e4531 52%,#8a3b28 76%,#792d20 100%)";

/** 유리 원/판(웜 배경 위) — 배경이 비쳐 보이는 반투명 흰색. pressed면 밝아진다.
 *  테두리는 위쪽만 살짝 밝게 — 유리 두께가 생겨 배경에서 떠 보인다(발광은 쓰지 않는다). */
function glassSkin(pressed = false) {
  return (
    "background:rgba(255,255,255,." +
    (pressed ? "38" : "17") +
    ");backdrop-filter:blur(14px) saturate(140%);-webkit-backdrop-filter:blur(14px) saturate(140%)" +
    ";border:1px solid rgba(255,255,255,.20)" +
    ";box-shadow:inset 0 1px 1px rgba(255,255,255,.28)"
  );
}

/** 다이얼 화면 키 — 흰 배경 위 흰 원이라 그림자로만 떠 보인다(IMG 라이트 다이얼 기준) */
function dialSkin(pressed = false) {
  return pressed
    ? "background:#e8eaef;box-shadow:0 1px 2px rgba(0,0,0,.07)"
    : "background:#fff;border:1px solid rgba(0,0,0,.035);box-shadow:0 1px 2.5px rgba(16,24,40,.07),0 7px 16px rgba(16,24,40,.055)";
}

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

/** 키패드 원형 버튼(라이트) — 포인터 다운 시 눌림 피드백 + 클릭 시 숫자 입력.
 *  variant: dial=다이얼 화면(흰 원+그림자) · glass=통화 중 인콜 키패드(유리 원).
 *  숫자는 원 중앙보다 살짝 위, 알파벳은 그 아래 — 실기기의 광학 배치. */
function KeyButton({
  k,
  onPress,
  variant = "dial",
  size = 88,
}: {
  k: { d: string; sub: string };
  onPress: (d: string) => void;
  variant?: "dial" | "glass";
  size?: number;
}) {
  const [pressed, setPressed] = useState(false);
  const symbol = k.d === "*" || k.d === "#";
  const sub = k.sub.trim();
  // 다이얼(흰 원)은 검은 글씨, 인콜 유리(웜 배경)는 흰 글씨
  const glass = variant === "glass";
  const digitInk = glass ? ON_WARM : INK;
  const subInk = glass ? "rgba(255,255,255,.72)" : INK_SUB;
  return (
    <div
      onPointerDown={() => setPressed(true)}
      onPointerUp={() => setPressed(false)}
      onPointerLeave={() => setPressed(false)}
      onClick={() => onPress(k.d)}
      style={css(
        "position:relative;border-radius:9999px;cursor:pointer;user-select:none;transition:background .09s,box-shadow .09s;width:" +
          size +
          "px;height:" +
          size +
          "px;" +
          (glass ? glassSkin(pressed) : dialSkin(pressed))
      )}
    >
      <span
        style={css(
          "position:absolute;left:0;right:0;text-align:center;font-weight:400;line-height:1;transform:translateY(-50%);color:" +
            digitInk +
            ";font-size:" +
            Math.round(size * 0.465) +
            "px;top:" +
            (k.d === "*" ? "62%" : symbol ? "53%" : sub ? "41%" : "50%")
        )}
      >
        {k.d}
      </span>
      {sub && (
        <span
          style={css(
            "position:absolute;left:0;right:0;text-align:center;font-weight:700;letter-spacing:2px;text-indent:2px;color:" +
              subInk +
              ";font-size:" +
              (size >= 80 ? "10.5" : "9.5") +
              "px;bottom:" +
              Math.round(size * 0.17) +
              "px"
          )}
        >
          {sub}
        </span>
      )}
    </div>
  );
}

/** clean — 고객 화면(?role=customer)용: 실제 휴대폰에 없는 시연 표기(상태·안내 유리판·파형)를
 *  숨긴다. 그 정보는 상단 상황 알약과 실시간 통화 패널이 대신 보여준다. */
export default function Phone({ vm, clean = false }: { vm: CallFlowVM; clean?: boolean }) {
  // 통화 중엔 실제로 마이크를 연다(getUserMedia). 주황 점은 '켜졌다고 표시'가 아니라
  // 실제 마이크가 켜졌을 때만(권한 허용·스트림 활성) 점등한다. 통화 종료/언마운트 시 정리.
  // 주의: getUserMedia는 보안 컨텍스트(localhost·https)에서만 동작 — LAN http에선 브라우저가
  // 막아 점이 안 켜진다(그 경우 실제로 마이크가 안 켜진 게 맞으므로 의도된 동작).
  const inCall = vm.phInCall && !vm.phEnded;
  // 스트림은 전사 패널의 파형과 공유한다(lib/mic) — 마이크를 두 번 열지 않는다.
  const micOn = useMic(inCall);

  // AI 음성 안내는 여기서 틀지 않는다. 예전엔 통화가 붙으면 greeting.mp3를 한 방에 재생했는데,
  // 지금은 안내가 data/arsScript.ts의 여러 줄로 쪼개져 단계별로 나가고(전사 패널에 같은 글이
  // 뜬다) 재생은 lib/arsDialogue가 맡는다. 둘을 같이 두면 인사말이 겹쳐서 두 번 들린다.
  // 화면과 음성이 같은 스크립트 하나만 보게 하는 것이 요점이다.

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
          {/* Dynamic Island — 완전한 알약. 실제 마이크가 켜졌을 때만 왼쪽에 주황 점 */}
          <div style={css("position:absolute;top:11px;left:50%;transform:translateX(-50%);width:122px;height:35px;border-radius:9999px;background:#000;z-index:50;display:flex;align-items:center")}>
            {micOn && (
              <span style={css("width:7px;height:7px;border-radius:9999px;background:#ff9f0a;margin-left:16px")} />
            )}
          </div>

          {vm.phIdle && <IdleScreen vm={vm} />}
          {vm.phInCall && !vm.phEnded && <InCallScreen vm={vm} clean={clean} />}
          {/* 통화 종료 → 문자메시지(iMessage) 화면. 잠시 뒤 상담내용·만족도 링크 문자가 도착 */}
          {vm.phEnded && <SmsScreen vm={vm} />}
        </div>
      </div>
    </div>
  );
}

/** 상태바 우측 3종(신호 막대 · LTE · 배터리) — 실기기 스크린샷 기준.
 *  light=문자 화면(검은 글씨) · dark=통화/다이얼 화면(흰 글씨). */
function StatusIcons({ light = false }: { light?: boolean }) {
  const ink = light ? "#000" : "#fff";
  const dim = light ? "#c4c4c8" : "rgba(255,255,255,.4)";
  return (
    <span style={css("display:flex;align-items:center;gap:6px")}>
      {/* 신호 4칸 — 마지막 칸만 흐리게(실기기와 동일) */}
      <span style={css("display:flex;align-items:flex-end;gap:2px;height:11px")}>
        {[4, 6.5, 9, 11].map((h, i) => (
          <span
            key={i}
            style={css("width:3px;border-radius:1px;height:" + h + "px;background:" + (i === 3 ? dim : ink))}
          />
        ))}
      </span>
      <span style={css("font-size:14px;font-weight:500;letter-spacing:-.2px;color:" + ink)}>LTE</span>
      {/* 배터리 — iOS 16+ 스타일(본체를 채우고 % 를 안에) */}
      <span style={css("display:flex;align-items:center;gap:1px")}>
        <span
          style={css(
            "min-width:25px;height:13px;border-radius:4px;display:flex;align-items:center;justify-content:center;background:" +
              ink
          )}
        >
          <span style={css("font-size:9px;font-weight:700;letter-spacing:-.3px;color:" + (light ? "#fff" : "#000"))}>64</span>
        </span>
        <span style={css("width:1.5px;height:4px;border-radius:0 1px 1px 0;background:" + dim)} />
      </span>
    </span>
  );
}

/** iOS 말풍선 꼬리(수신·왼쪽) — 애플의 곡선 꼬리를 2겹 겹침으로 만든다.
 *  회색 원호를 말풍선 왼쪽 아래에 붙이고, 그 위에 배경색 원호로 안쪽을 깎아낸다. */
function BubbleTail() {
  return (
    <>
      <span style={css("position:absolute;bottom:0;left:-7px;width:20px;height:20px;background:#e9e9eb;border-bottom-right-radius:16px")} />
      <span style={css("position:absolute;bottom:0;left:-20px;width:21px;height:21px;background:#fff;border-bottom-right-radius:11px")} />
    </>
  );
}

/** 통화 종료 후 문자메시지 화면(iOS 메시지 라이트) — 실기기 스크린샷 기준으로 구성:
 *  상태바 → ‹+안읽음 배지 → 발신자 아바타·이름 알약 → "문자 메시지 · SMS"+시각 → 회색 수신 말풍선
 *  → 하단 작성바(+ / 플레이스홀더 / 음성 아이콘) → 홈 인디케이터.
 *
 *  잠시 뒤 ①상담 처리 안내(상담내용 카드 링크) ②만족도 조사 링크 두 통이 도착한다. 본문은 실제
 *  은행 문자 문법([키움은행] 제목 + [Web발신] + 항목)을 따르고, 부서·업무코드는 방금 라우팅된
 *  vm 값을 그대로 써서 직원 화면과 내용이 일치한다. 링크는 시각 표시만(랜딩은 데모 밖).
 *  ※ 실기기엔 낯선 발신자면 "스팸 신고"가 붙지만, 은행 자기 문자 아래 두면 오해를 사서 뺐다. */
function SmsScreen({ vm }: { vm: CallFlowVM }) {
  const [shown, setShown] = useState(0); // 도착한 문자 수
  const [typing, setTyping] = useState(false);
  // 문자 도착 시각 = 화면에 들어온 시각(상태바 시계와 같은 값을 쓴다)
  const [now] = useState(() => new Date());
  useEffect(() => {
    const t: number[] = [];
    t.push(window.setTimeout(() => setTyping(true), 900));
    t.push(window.setTimeout(() => { setTyping(false); setShown(1); }, 2100));
    t.push(window.setTimeout(() => setTyping(true), 3200));
    t.push(window.setTimeout(() => { setTyping(false); setShown(2); }, 4600));
    return () => t.forEach((id) => clearTimeout(id));
  }, []);

  const h24 = now.getHours();
  const clock = `${h24 % 12 === 0 ? 12 : h24 % 12}:${String(now.getMinutes()).padStart(2, "0")}`;
  const stamp = `${h24 < 12 ? "오전" : "오후"} ${clock}`;

  const BUBBLE =
    "position:relative;max-width:78%;align-self:flex-start;background:#e9e9eb;color:#000;border-radius:19px;padding:9px 14px 10px;font-size:15.5px;line-height:1.36;white-space:pre-wrap;word-break:break-all;animation:cardDeal .32s ease-out";
  const LINK = "color:#0a7cff;text-decoration:underline;text-underline-offset:2px";
  const META = "font-size:12px;color:#8a8a8e;text-align:center";

  return (
    <div style={css("position:absolute;inset:0;background:#fff;color:#000;display:flex;flex-direction:column")}>
      {/* 상태바(라이트) — 다이나믹 아일랜드를 피해 좌우로 벌린다 */}
      <div style={css("display:flex;align-items:center;justify-content:space-between;padding:20px 34px 0")}>
        <span style={css("font-size:16px;font-weight:600;letter-spacing:-.2px")}>{clock}</span>
        <StatusIcons light />
      </div>

      {/* 헤더 — ‹ + 안읽음 배지(알약) / 발신자 아바타 / 이름 알약. ‹ 를 누르면 새 상담 */}
      {/* 상태바와 붙지 않게 위를 띄우고, ‹ 알약은 아바타와 세로 중앙을 맞춘다(실기기 배치).
          left도 상태바 시계(34px)와 비슷한 눈금으로 물려 모서리에 붙지 않게 한다. */}
      <div style={css("position:relative;display:flex;flex-direction:column;align-items:center;padding:18px 0 12px")}>
        {/* ‹ + 안읽음 배지 — 실기기처럼 손가락으로 누를 만한 두께(높이 38)를 준다.
            padding만 키우면 배지가 알약 안에서 위아래로 끼여 얇아 보이므로 높이를 직접 잡고
            배지도 같이 키운다(알약 높이의 절반쯤). */}
        <div
          onClick={vm.startCall}
          style={css("position:absolute;left:22px;top:24px;height:38px;box-sizing:border-box;display:flex;align-items:center;gap:4px;background:#eeeef0;border-radius:9999px;padding:0 11px 0 7px;cursor:pointer")}
        >
          <span className="mi" style={css("font-size:25px;color:#000;line-height:1")}>chevron_left</span>
          <span style={css("display:flex;align-items:center;justify-content:center;min-width:26px;height:21px;box-sizing:border-box;background:#1c1c1e;color:#fff;border-radius:9999px;padding:0 7px;font-size:13px;font-weight:600;letter-spacing:-.2px")}>12</span>
        </div>
        {/* 발신자 아바타 — 키움/KARI-NA 마크 */}
        <div style={css("width:52px;height:52px;border-radius:9999px;background:#f2f2f5;display:flex;align-items:center;justify-content:center")}>
          <BrandSymbol size={30} />
        </div>
        {/* 발신자명 — RCS 브랜드 메시지는 번호가 아니라 브랜드를 표시한다. 은행명만 두면
            "무슨 문자인지"가 안 드러나므로 서비스명을 함께 적는다(KARI-NA가 보낸 접수 결과). */}
        <span style={css("margin-top:7px;display:flex;align-items:center;gap:1px;background:#eeeef0;border-radius:9999px;padding:4px 9px 4px 12px")}>
          <span style={css("font-size:14.5px;font-weight:600;letter-spacing:-.2px")}>키움은행 KARI-NA</span>
          <span className="mi" style={css("font-size:16px;color:#7c7c80;margin:-3px -2px -3px 0")}>chevron_right</span>
        </span>
      </div>

      {/* 메시지 목록 — 실기기처럼 위에서부터 쌓이고 아래는 비어 있다 */}
      <div style={css("flex:1;min-height:0;overflow:auto;display:flex;flex-direction:column;gap:8px;padding:6px 15px 8px")}>
        <div style={css(META + ";margin-bottom:4px;line-height:1.45")}>
          문자 메시지 · SMS
          <br />
          오늘 {stamp}
        </div>
        {shown >= 1 && (
          <div style={css(BUBBLE)}>
            <span style={css("font-weight:700")}>[키움은행] 상담 처리 안내</span>
            {"\n[Web발신]\n\n"}
            {CUSTOMER.name}님, 방금 상담해 주셔서 감사합니다.
            {"\n\n접수번호 9F2A\n담당 부서 "}
            {vm.prepRoutingTitle}
            {/* 업무는 분류가 됐을 때만 적는다 — 고객 문자에 '미분류'를 보낼 수는 없다.
                내부 진단은 상담사 화면의 몫이고, 여기선 줄을 통째로 뺀다. */}
            {vm.prepBusinessCode && (
              <>
                {"\n업무 "}
                {vm.prepBusinessCodeLabel} ({vm.prepBusinessCode})
              </>
            )}
            {"\n\n상담 내용·처리 결과 확인\n"}
            <span style={css(LINK)}>https://k7.kiwoom.com/c/9F2A</span>
            <BubbleTail />
          </div>
        )}
        {shown >= 2 && (
          <div style={css(BUBBLE)}>
            <span style={css("font-weight:700")}>[키움은행] 상담 만족도 조사</span>
            {"\n[Web발신]\n\n오늘 상담은 어떠셨나요?\n30초면 끝나는 3문항입니다.\n\n참여하기\n"}
            <span style={css(LINK)}>https://k7.kiwoom.com/s/9F2A</span>
            <BubbleTail />
          </div>
        )}
        {typing && (
          <div style={css("position:relative;align-self:flex-start;background:#e9e9eb;border-radius:19px;padding:13px 16px;display:flex;gap:5px")}>
            {[0, 1, 2].map((i) => (
              <span key={i} style={css("width:8px;height:8px;border-radius:9999px;background:#a3a3a8;animation:recBlink 1s infinite;animation-delay:" + i * 0.15 + "s")} />
            ))}
            <BubbleTail />
          </div>
        )}
      </div>

      {/* 작성바(시각용) — + 원형 버튼 / 플레이스홀더 / 음성 입력 아이콘.
          좌우를 20px까지 물려 둥근 모서리에 붙지 않게 하고, 홈 인디케이터와도 충분히 띄운다
          (붙어 있으면 화면 아래가 끼인 것처럼 보인다). */}
      <div style={css("display:flex;align-items:center;gap:9px;padding:6px 20px 0")}>
        <span style={css("width:35px;height:35px;flex:none;border-radius:9999px;background:#eeeef0;display:flex;align-items:center;justify-content:center;font-size:23px;font-weight:300;color:#3c3c40;line-height:1;padding-bottom:2px;box-sizing:border-box")}>
          +
        </span>
        <div style={css("flex:1;display:flex;align-items:center;gap:9px;border:1px solid #d5d5da;border-radius:9999px;padding:9px 14px 9px 16px")}>
          <span style={css("flex:1;font-size:15.5px;color:#a0a0a5;letter-spacing:-.2px")}>문자 메시지 · SMS</span>
          {/* 음성 입력(파형) */}
          <span style={css("display:flex;align-items:center;gap:2px;height:17px")}>
            {[5, 10, 16, 10, 5].map((h, i) => (
              <span key={i} style={css("width:2.5px;border-radius:1.5px;background:#b0b0b6;height:" + h + "px")} />
            ))}
          </span>
        </div>
      </div>

      {/* 홈 인디케이터(라이트 화면 → 검정 바) */}
      <span style={css("align-self:center;width:134px;height:5px;border-radius:3px;background:rgba(0,0,0,.82);margin:22px 0 9px")} />
    </div>
  );
}

/** 상태바 — 세 화면이 모두 라이트라 기본이 검은 글씨다.
 *  시계는 실제 시각(문자 도착 시각과 어긋나면 시연에서 티가 난다). */
function StatusBar({ light = true }: { light?: boolean }) {
  const now = new Date();
  const h = now.getHours() % 12 === 0 ? 12 : now.getHours() % 12;
  return (
    <div
      style={css(
        "display:flex;align-items:center;justify-content:space-between;padding:20px 34px 0;position:relative;z-index:60;color:" +
          (light ? INK : "#fff")
      )}
    >
      <span style={css("font-size:16px;font-weight:600;letter-spacing:-.2px")}>
        {h}:{String(now.getMinutes()).padStart(2, "0")}
      </span>
      <StatusIcons light={light} />
    </div>
  );
}

function HomeIndicator({ light = true }: { light?: boolean }) {
  return (
    <span
      style={css(
        "position:absolute;bottom:9px;left:50%;transform:translateX(-50%);width:134px;height:5px;border-radius:3px;background:" +
          (light ? "rgba(0,0,0,.82)" : "rgba(255,255,255,.85)")
      )}
    />
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

/** 다이얼 화면(라이트) — 실기기 라이트 다이얼: 흰 배경, 그림자로만 떠 보이는 흰 원, 초록 발신.
 *  키패드는 클릭 가능 — 누르면 눌리고(KeyButton) 입력한 번호가 위에 표시된다. */
function IdleScreen({ vm }: { vm: CallFlowVM }) {
  // 입력한 번호 — 비어 있으면 기본 대상(키움은행)을 보여주고, 누르기 시작하면 입력값으로 바뀐다
  const [dialed, setDialed] = useState("");
  const hasInput = dialed.length > 0;
  return (
    <div style={css("position:absolute;inset:0;background:#fff;display:flex;flex-direction:column;color:" + INK)}>
      <StatusBar />
      <div style={css("flex:1;display:flex;flex-direction:column;padding:0 0 30px")}>
        {/* 다이얼 대상 — 실기기처럼 번호가 크게 위, 이름은 작게 아래 (다이내믹 아일랜드와 간격 확보) */}
        <div style={css("text-align:center;margin-top:60px")}>
          <div style={css("font-size:40px;font-weight:400;letter-spacing:.5px;line-height:1.1;min-height:44px;color:" + INK)}>{hasInput ? dialed : "1588-0000"}</div>
          <div style={css("font-size:15px;margin-top:10px;font-weight:400;color:" + INK_SUB)}>
            키움은행 고객센터 <span style={css("font-weight:700;color:" + INK)}>mobile</span>
          </div>
        </div>
        <div style={css("flex:1")} />
        {/* 키패드 — 클릭 시 입력·눌림 피드백(KeyButton). 실기기 비율: 큼직한 원 88px */}
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
            style={css("width:88px;height:88px;border-radius:9999px;background:#31d158;display:flex;align-items:center;justify-content:center;cursor:pointer;box-shadow:0 6px 18px rgba(49,209,88,.35)")}
          >
            <AppleIcon name="call" size={42} />
          </div>
          <span
            onClick={hasInput ? () => setDialed((s) => s.slice(0, -1)) : undefined}
            style={css("justify-self:center;transition:opacity .12s;opacity:" + (hasInput ? "1;cursor:pointer" : ".3"))}
          >
            <AppleIcon name="backspace" size={34} color={INK_SUB} />
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

/** FaceTime 버튼 글리프 — 비디오 카메라(본체 + 오른쪽 렌즈).
 *
 *  실기기는 FaceTime을 못 쓰는 번호에 본체에 '?'를 뚫은 아이콘을 쓰는데, 그대로 옮겨 보니
 *  버튼 안에서 '물음표 달린 검은 덩어리'로 보여 무슨 기능인지 오히려 안 읽혔다. 시연에서
 *  중요한 건 "여기가 FaceTime 자리"이므로 통상의 비디오 카메라 글리프로 바꿨다. */
function FaceTimeGlyph({ size = 38, color = "#fff" }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 56 56" fill={color} aria-hidden>
      <rect x="7" y="17" width="30" height="22" rx="7" />
      {/* 렌즈 — 본체와 살짝 띄워 두 덩이로 읽히게(붙이면 화살표처럼 보인다) */}
      <path d="M40 24.6 L49.2 18.6 A1.6 1.6 0 0 1 51.5 20 v16 a1.6 1.6 0 0 1 -2.3 1.4 L40 31.4 Z" />
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

  // 합본 화면(clean=false)에서도 열리게 한다 — 실기기엔 없는 제약이고, 시연 중 어느 창에서든
  // 키패드를 눌러 볼 수 있어야 한다.
  if (keypadOpen && !vm.phEnded) {
    return <CustomerKeypadScreen vm={vm} close={() => setKeypadOpen(false)} />;
  }

  return (
    <div style={css("position:absolute;inset:0;display:flex;flex-direction:column;color:" + ON_WARM + ";" + GLASS_BG)}>
      <StatusBar light={false} />
      <div style={css("flex:1;display:flex;flex-direction:column;align-items:center;padding:0 24px 30px;min-height:0")}>
        {/* 타이머 → 이름 — 실기기 순서. 타이머는 통화 누르자마자 00:01부터 */}
        <div style={css("margin-top:56px;font-size:23px;font-weight:400;letter-spacing:.5px;color:" + ON_WARM_SUB)}>
          {vm.phEnded ? "통화 종료" : vm.phoneClockStr}
        </div>
        <div style={css("font-size:32px;font-weight:700;letter-spacing:-.4px;margin-top:5px;color:" + ON_WARM)}>
          키움은행 고객센터
        </div>

        {/* 상태 표시 — 실제 고객 화면엔 없는 정보라 '시연 표기'를 명시한다.
            clean(고객 화면)에선 통째로 숨기고 상단 상황 알약이 대신 보여준다 */}
        {!clean && (
          <div style={css("display:flex;align-items:center;gap:7px;margin-top:11px")}>
            <span style={css("font-size:10.5px;font-weight:700;letter-spacing:.4px;border-radius:9999px;padding:2px 8px;color:#3f5aa6;border:1px solid rgba(47,95,196,.3);background:rgba(255,255,255,.55)")}>시연 표기</span>
            <span style={css("display:flex;align-items:center;gap:6px;font-size:13.5px;font-weight:500;color:" + ON_WARM_SUB)}>
              {vm.showRecDot && (
                <span style={css("width:8px;height:8px;border-radius:9999px;background:#ff453a;animation:recBlink 1.1s infinite")} />
              )}
              {vm.phoneStatus}
            </span>
          </div>
        )}

        {/* 여기는 비워 둔다. 실제 통화 화면엔 대화 내용이 뜨지 않는다 — 전화 중에 폰 화면으로
            대화창이 올라오는 일은 없다. 주고받는 말은 오른쪽 전사 패널(파동 아래)이 보여준다.
            폰이 보여줄 건 실기기와 같은 것뿐: 통화 시간 · 상대 이름 · 컨트롤. */}
        <div style={css("flex:1")} />

        {/* 마이크 입력 세기 — 실기기엔 없는 시연 표기라 고객 화면(clean)에선 숨긴다.
            마이크가 켜졌는지 자체는 다이나믹 아일랜드의 주황 점이 이미 알려준다 */}
        {!clean && vm.showWave && vm.micActive && (
          <div style={css("margin-bottom:14px;width:74%;height:6px;border-radius:3px;overflow:hidden;flex:none;background:rgba(28,40,66,.10)")}>
            <div style={css("height:100%;border-radius:3px;transition:width .08s;background:#31d158;width:" + Math.min(100, vm.micLevel * 500) + "%")} />
          </div>
        )}

        {vm.phEnded && (
          <div style={css("display:inline-flex;align-items:center;gap:7px;font-size:14px;margin-bottom:14px;color:" + ON_WARM_SUB)}>
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
                    (c.icon === "keypad" && !vm.customerKeypadEnabled ? "opacity:.42" : "")
                )}
              >
                <span
                  onClick={
                    c.end
                      ? vm.endCall
                      : c.icon === "keypad" && vm.customerKeypadEnabled
                      ? () => setKeypadOpen(true)
                      : undefined
                  }
                  style={css(
                    "width:88px;height:88px;border-radius:9999px;display:flex;align-items:center;justify-content:center;" +
                      (c.end
                        ? "background:" + RED_END + ";cursor:pointer;box-shadow:0 8px 22px rgba(240,69,58,.42)"
                        : glassSkin() + ";") +
                      (c.icon === "keypad"
                        ? vm.customerKeypadEnabled
                          ? "cursor:pointer"
                          : "cursor:not-allowed"
                        : "")
                  )}
                >
                  {c.icon === "facetime" ? (
                    <FaceTimeGlyph size={c.size ?? 38} color={ON_WARM} />
                  ) : (
                    <AppleIcon
                      name={c.icon}
                      size={c.size ?? 36}
                      color={c.end ? "#fff" : ON_WARM}
                      style={c.dy ? { transform: `translateY(${c.dy}px)` } : undefined}
                    />
                  )}
                </span>
                <span style={css("font-size:13px;font-weight:500;color:" + ON_WARM)}>{c.label}</span>
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
      <HomeIndicator light={false} />
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
    // 로컬 데모: #만 통화 종료 → 종료 화면(문자메시지)으로. 한때 '아무 키나 종료'로 뒀더니
    // 숫자를 눌러 보는 것 자체가 불가능해져(누르는 순간 끊김) 키패드를 시연할 수 없었다.
    // 실서버 모드에선 #이 '발화 종료(접수 완료)' 신호라 의미가 달라 건드리지 않는다.
    if (digit === END_CALL_DIGIT && !vm.customerLiveMode) vm.endCall();
  };
  const prompt = vm.mobileAgentConnected
    ? "상담원 통화 중 · 번호를 입력하세요"
    : vm.mobileIntakePending
    ? "마지막 발화를 처리하고 있습니다"
    : vm.mobileIntakeComplete
    ? "상담사가 통화를 준비하고 있습니다"
    : vm.customerLiveMode
    ? `용건을 모두 말씀하셨으면 ${END_CALL_DIGIT}을 눌러 주세요`
    : `상담을 마치시려면 ${END_CALL_DIGIT}을 눌러 주세요`;

  return (
    // 배경을 통화 화면과 똑같이 깐다 — 전엔 배경이 없어 폰의 검은 스크린이 그대로 비쳐
    // 어두운 바탕에 어두운 제목이 얹혀 글씨가 안 보였다(그게 '디자인이 이상한' 원인).
    <div style={css("position:absolute;inset:0;display:flex;flex-direction:column;color:" + ON_WARM + ";" + GLASS_BG)}>
      <StatusBar light={false} />
      {/* 상대 정보 — 실기기는 키패드를 열어도 상단 상대 정보가 그대로 남는다(닫기 X는 없다).
          닫기는 아래 '숨기기'가 맡는다. */}
      <div style={css("text-align:center;margin-top:52px;padding:0 24px")}>
        <div style={css("font-size:23px;font-weight:400;letter-spacing:.5px;color:" + ON_WARM_SUB)}>{vm.phoneClockStr}</div>
        <div style={css("font-size:27px;font-weight:700;letter-spacing:-.4px;margin-top:4px;color:" + ON_WARM)}>키움은행 고객센터</div>
        <div style={css("font-size:13.5px;margin-top:7px;color:" + ON_WARM_SUB)}>{prompt}</div>
      </div>
      {/* 누른 번호 — 실기기는 상대 정보 자리에 입력이 크게 쌓인다 */}
      <div style={css("height:46px;display:flex;align-items:center;justify-content:center;font-size:29px;font-weight:400;letter-spacing:8px;text-indent:8px;color:" + ON_WARM)}>
        {vm.arsDigits || " "}
      </div>
      {/* 키패드는 화면 중간보다 조금 아래에 앉는다 — 실기기 비율은 상대 정보와 키패드 사이가
          키패드와 종료 버튼 사이보다 두 배쯤 넓다(2:1). 위쪽에 붙여 두면 화면 아래가 텅 빈
          것처럼 보이고 엄지가 닿는 자리와도 어긋난다. */}
      <div style={css("flex:2")} />
      <div style={css("display:grid;grid-template-columns:repeat(3,78px);justify-content:center;column-gap:26px;row-gap:15px;flex:none;opacity:" + (vm.customerKeypadEnabled ? "1" : ".45"))}>
        {KEYS.map((key) => (
          <KeyButton
            key={key.d}
            k={key}
            variant="glass"
            size={78}
            onPress={vm.customerKeypadEnabled ? press : () => {}}
          />
        ))}
      </div>
      <div style={css("flex:1")} />
      {/* 하단 — 빨간 종료가 가운데, 오른쪽에 '숨기기'(실기기의 Hide Keypad) */}
      <div style={css("flex:none;padding-bottom:38px;display:grid;grid-template-columns:repeat(3,88px);justify-content:center;column-gap:24px;align-items:center")}>
        <span />
        <div
          onClick={vm.endCall}
          style={css("width:88px;height:88px;border-radius:9999px;display:flex;align-items:center;justify-content:center;cursor:pointer;background:" + RED_END + ";box-shadow:0 8px 22px rgba(240,69,58,.42)")}
        >
          <AppleIcon name="callEnd" size={42} />
        </div>
        <span
          onClick={close}
          style={css("justify-self:center;font-size:14.5px;font-weight:500;cursor:pointer;color:" + ON_WARM)}
        >
          숨기기
        </span>
      </div>
      <HomeIndicator light={false} />
    </div>
  );
}
