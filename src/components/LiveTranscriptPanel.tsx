import { useCallback, useEffect, useRef, useState } from "react";
import { css } from "../lib/css";
import SiriWave from "./SiriWave";
import { getMicLevel, useMic } from "../lib/mic";

/**
 * 실시간 통화 전사 패널 — 음성 파형(SiriWave) + 카톡형 대화 스트림.
 *
 * 2-TV 무대에서 고객 화면과 직원 화면이 이 컴포넌트를 함께 쓴다. 통화를 들리는 대로
 * 다 받아 적는 한 벌 전사다 — 문장별로 끊지 않고 이어 붙이되, **화자가 바뀌는
 * 순간에만** 말풍선을 새로 연다. 카톡 문법: 이 화면의 주인(self)은 오른쪽, 나머지는
 * 왼쪽이고 상대 말풍선 위에만 이름을 적는다. 시각은 말풍선 옆(안쪽 아래).
 * 화자는 색으로 구분한다 — 고객 파랑 · 상담원 보라 · KARI-NA 민트.
 *
 * 통화 중 대화가 읽히는 곳은 **여기뿐이다.** 휴대폰 화면에는 대화가 뜨지 않는다(실제 통화가
 * 그렇다) — 폰은 통화 시간·상대 이름·컨트롤만 보여주고, 말을 읽는 건 상담사 쪽 일이다.
 *
 * 파형은 대화 전체에 반응한다: 자기 발화엔 크게, 상대 발화엔 잔잔하게 출렁여
 * 지금 누가 말하는지를 물결로도 느끼게 한다. 파형 색은 이 화면의 주인(self) 색.
 *
 * 검은 패널 — 흰 폰보다 눈에 덜 띄어야 한다(주인공은 폰, 이건 배경 정보).
 * 상태 문구는 없다: 그건 상단 상황 알약의 몫이고, 이 패널은 "소리가 흐른다"(물결)와
 * "말이 글자가 된다"(전사) 두 감각만 보여준다.
 *
 * 같은 화자의 연속 조각은 STT답게 한 말풍선으로 이어 붙이고 화자가 바뀌면 끊는다.
 * 타이핑은 연속 타자기(useTypewriter): 목표 텍스트가 자라나도 재시작 없이
 * 이어서 따라간다 — 문장 단위로 끊기지 않는 진짜 STT 스트림 감각.
 */

export interface StreamItem {
  id: string;
  text: string;
  who: "customer" | "agent" | "ai";
}

export default function LiveTranscriptPanel({
  stream,
  active,
  self = "customer",
  height = 532,
  width = 260,
}: {
  stream: StreamItem[];
  active: boolean;
  /** 이 화면의 주인 — 이 화자의 말이 오른쪽·선명하게 그려진다 */
  self?: "customer" | "agent";
  /** 옆에 세우는 것(폰·콘솔)의 높이에 맞춘다 */
  height?: number;
  /** 옆에 세우는 것(폰·콘솔)의 폭에 맞춘다 — 고객 클린 폰=432, 분할뷰=260 */
  width?: number;
}) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  // 로그 스타일 — 각 발화 턴의 '처음 등장 시각'을 고정 캐시(재렌더에도 안 흔들리게).
  const seenAt = useRef<Map<string, string>>(new Map());
  const stamp = (id: string) => {
    if (!seenAt.current.has(id)) {
      const d = new Date();
      const p = (n: number) => (n < 10 ? "0" + n : "" + n);
      seenAt.current.set(id, p(d.getHours()) + ":" + p(d.getMinutes()) + ":" + p(d.getSeconds()));
    }
    return seenAt.current.get(id)!;
  };

  // Siri풍 파형 진폭 — 60fps rAF에서 '연속 사인 합성'으로 부드럽게 구동한다.
  // (랜덤 스텝 대신 여러 저주파 사인을 겹쳐 자연스러운 출렁임을 만든다)
  // React 재렌더 없이 ampRef만 갱신 → SiriWave가 매 프레임 getAmplitude로 읽는다.
  // 기준: "음성이 들리는 동안"(=조각 타이핑 예상 시간 + 여유)만 크게 스웰.
  const ampRef = useRef(0.9);
  const speakingUntil = useRef(0);
  // 방향성 — 지금 출렁이는 게 '내 쪽 발화'인지. 상대 발화는 같은 파형을 약하게만 흔든다.
  // 두 TV를 나란히 놓으면 말하는 쪽 화면만 살아나므로 대화의 방향이 눈에 보인다.
  const speakingGain = useRef(1);
  const prevCount = useRef(0);
  useEffect(() => {
    if (stream.length > prevCount.current) {
      const last = stream[stream.length - 1];
      speakingUntil.current = performance.now() + last.text.length * 32 + 600;
      speakingGain.current = last.who === self ? 1 : 0.34;
    }
    prevCount.current = stream.length;
  }, [stream, self]);
  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    const loop = (t: number) => {
      const dt = Math.min(0.05, (t - last) / 1000);
      last = t;
      const speaking = t < speakingUntil.current;
      // 대기: 아주 느린 호흡. 말할 때: 주기가 다른 사인 3개를 겹쳐 유기적으로 출렁.
      const idle = 0.12 * Math.sin(t * 0.0016);
      const talk = speaking
        ? speakingGain.current *
          (0.9 +
            0.5 * Math.sin(t * 0.0075) +
            0.28 * Math.sin(t * 0.0135 + 1.3) +
            0.16 * Math.sin(t * 0.022 + 2.1))
        : 0;
      const target = 0.85 + idle + talk;
      // 프레임 독립 이징(지수) — attack 빠르게, release 느리게. 계단 없이 매끄럽게 수렴.
      const rate = target > ampRef.current ? 7 : 2.5;
      ampRef.current += (target - ampRef.current) * (1 - Math.exp(-rate * dt));
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);
  // 통화 중엔 실제 마이크를 잡는다(스트림은 폰·두 패널이 공유).
  useMic(active);

  // 파형 진폭 — **실제 마이크 음량이 있으면 그걸 쓰고**, 없으면 위 시뮬레이션으로 되돌아간다.
  // 마이크가 없는 경우: LAN http(비보안 컨텍스트)·권한 거부·마이크 미탑재. 그때도 시연이
  // 죽지 않도록 대본 기반 출렁임이 그대로 살아 있다.
  //
  // 두 값 모두 0~1로 맞춘다. 마이크는 이미 0~1이라 바닥값만 얹고(대기 시 실선이 아니라
  // 살짝 숨쉬게), 시뮬레이션은 열린 값(대기 0.85 / 피크 2.8 안팎)이라 정규화한다.
  const getAmp = useCallback(() => {
    const mic = getMicLevel();
    if (mic !== null) return Math.max(0.08, Math.min(1, 0.08 + mic * 0.92));
    return Math.max(0.1, Math.min(1, (ampRef.current - 0.62) / 1.9));
  }, []);

  // 라이브 자막 스크롤 — 기본은 바닥(최신)에 붙어 따라간다. 다만 **사람이 위로 올려 읽는
  // 동안은 따라가지 않는다**: 예전엔 150ms마다 무조건 바닥으로 끌어내려 위를 올려 볼 수가
  // 없었다. 다시 바닥까지 내리면 자동 추적이 되살아난다(카톡·터미널과 같은 규칙).
  const [stick, setStick] = useState(true);
  useEffect(() => {
    const id = window.setInterval(() => {
      const el = scrollRef.current;
      if (el && stick) el.scrollTop = el.scrollHeight;
    }, 150);
    return () => window.clearInterval(id);
  }, [stick]);
  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    // 바닥에서 28px 안쪽이면 '바닥에 있다'로 본다(타이핑 중 1~2px 흔들림 허용)
    setStick(el.scrollHeight - el.scrollTop - el.clientHeight < 28);
  };

  // 말풍선 글자 크기는 패널 폭에 비례 — 화면 비율/스케일이 바뀌어도 글자가 상대적으로
  // 같은 크기로 읽힌다(폭 400 기준 13px, 좁아지면 줄고 넓어지면 커지되 11~15px로 클램프).
  const fontPx = Math.round(Math.max(11, Math.min(15, width * 0.033)) * 10) / 10;

  // 지금 말하는(=마지막으로 말한) 화자 — 파형 색이 이 사람을 따라간다.
  // 아직 아무 말도 없으면 이 화면의 주인 색으로 대기한다.
  const speakingWho: StreamItem["who"] = stream.length ? stream[stream.length - 1].who : self;

  // 들리는 대로 다 받아 적는 한 벌 전사 — 문장별로 끊지 않고 이어 붙이되, '다른 사람'이
  // 말하기 시작하면 그때만 칸을 띄운다. 즉 같은 화자의 연속 발화는 한 덩이로 묶고
  // 화자가 바뀌는 순간에만 새 문단을 연다. 화자는 글자 색으로 구분(고객 파랑·상담원 보라).
  const groups: { who: StreamItem["who"]; texts: string[]; firstId: string; lastId: string; time: string }[] = [];
  // 시각은 '말풍선이 끊어진 시각' — 그 덩이의 마지막 조각이 도착한 때다. 첫 조각 시각을
  // 쓰면 길게 말한 발화가 "말을 시작한 시각"으로 남아, 다음 말풍선과의 간격이 실제 대화의
  // 리듬과 어긋난다. 마지막 조각을 쓰면 "여기서 말이 끊겼다"가 그대로 기록된다.
  stream.forEach((it) => {
    const g = groups[groups.length - 1];
    if (g && g.who === it.who) {
      g.texts.push(it.text);
      g.lastId = it.id;
      g.time = stamp(it.id);
    } else {
      groups.push({ who: it.who, texts: [it.text], firstId: it.id, lastId: it.id, time: stamp(it.id) });
    }
  });

  return (
    <div
      style={css(
        "flex:none;width:" +
          width +
          "px;height:" +
          height +
          "px;display:flex;flex-direction:column;background:#0a0a0e;border-radius:20px;box-shadow:0 18px 50px rgba(0,0,0,.5);overflow:hidden"
      )}
    >
      {/* 파형 — 상자 안 상자: 어두운 패널 속 더 깊은 무대, 그 위 흰 물결.
          위쪽 여백을 키워 살짝 아래로 내리고, 좌우 여백을 키워 아래 텍스트 상자보다 가로를 짧게(inset) 한다. */}
      {/* 파형 자리 — 배경을 패널과 같게 둔다(전엔 #000 상자라 패널보다 더 검은 사각형이
          도려낸 것처럼 보였다). 상자를 지우면 물결만 허공에 뜬 것처럼 남는다. */}
      <div
        style={css(
          "flex:none;margin:30px 40px 0;height:180px;position:relative;background:transparent;overflow:hidden"
        )}
      >
        <div style={css("position:absolute;inset:0")}>
          {/* 파형 색은 **지금 말하는 화자**를 따라간다 — 말풍선 테두리와 같은 색이라
              "이 색이 출렁이면 이 사람이 말하는 중"이 글을 읽지 않아도 전달된다.
              색은 곡선이 한 장씩 죽고 태어나며 갈리므로 툭 끊기지 않고 스며들듯 바뀐다. */}
          <SiriWave getAmplitude={getAmp} colors={SPK[speakingWho].wave} />
        </div>
      </div>

      {/* 전사 — 파동 바로 아래. 화자별 말풍선(카톡 문법)이 아래로 자라고 최신이 바닥에 오도록
          자동 스크롤. 말풍선 색 = 파동 색 = 화자 색이라 "이 색이 움직이면 이 사람" 이 성립한다. */}
      <div style={css("position:relative;flex:1;min-height:0")}>
      <div
        ref={scrollRef}
        onScroll={onScroll}
        className="noscrollbar"
        style={css(
          // 위쪽 페이드 — 대화가 길어지면 옛 말풍선이 위로 밀려 올라가며 **스며들듯 사라진다**
          // (자르면 글자가 반쯤 잘려 남아 지저분하다). mask라 실제로는 그대로 있어서
          // 올려서 스크롤하면 다시 온전히 보인다. 스크롤바는 발표 화면이라 숨긴다.
          "height:100%;overflow-y:auto;overflow-x:hidden;padding:14px 20px;display:flex;flex-direction:column;justify-content:flex-start;gap:10px;box-sizing:border-box;" +
            "mask-image:linear-gradient(180deg,transparent 0,rgba(0,0,0,.35) 22px,#000 62px,#000 100%);" +
            "-webkit-mask-image:linear-gradient(180deg,transparent 0,rgba(0,0,0,.35) 22px,#000 62px,#000 100%)"
        )}
      >
        {groups.length === 0 ? (
          // 안내 문구를 화면 정중앙보다 조금 위로 — 파형 상자와 가깝게, 아래를 비워 균형을 맞춘다
          <div style={css("height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;color:#565b66;padding-bottom:120px")}>
            <span className="mi" style={css("font-size:30px")}>graphic_eq</span>
            {/* 안내 문구는 화면마다 다르다 — 직원 화면엔 옆에 전화기가 없다 */}
            <span style={css("font:400 12.5px 'Avenir Next','Pretendard',sans-serif;text-align:center;line-height:1.6")}>
              {self === "customer" ? (
                <>
                  전화 버튼을 누르면
                  <br />
                  주고받는 말이 여기 실시간으로 표시됩니다
                </>
              ) : (
                <>
                  통화가 연결되면
                  <br />
                  고객과 나눈 말이 여기 실시간으로 표시됩니다
                </>
              )}
            </span>
          </div>
        ) : (
          groups.map((g, gi) => (
            <BubbleLine
              key={g.firstId}
              time={g.time}
              who={g.who}
              self={self}
              fontPx={fontPx}
              full={g.texts.join(" ")}
              isLast={gi === groups.length - 1}
            />
          ))
        )}
      </div>
      </div>
    </div>
  );
}

/** 연속 타자기 — 목표 텍스트가 자라나도 타이핑이 재시작 없이 이어서 따라간다.
 *  조각(문장) 단위로 끊기지 않는 진짜 STT 스트림 감각의 핵심. */
function useTypewriter(target: string, speedMs: number, enabled: boolean) {
  const [shown, setShown] = useState(0);
  const targetRef = useRef(target);
  targetRef.current = target;
  useEffect(() => {
    if (!enabled) {
      setShown(target.length);
      return;
    }
    const id = window.setInterval(() => {
      setShown((s) => (s < targetRef.current.length ? s + 1 : s));
    }, speedMs);
    return () => window.clearInterval(id);
  }, [enabled, speedMs, target.length]);
  // 새 콜로 목표가 짧아지면 처음부터
  useEffect(() => {
    setShown((s) => (s > target.length ? 0 : s));
  }, [target.length]);
  return target.slice(0, shown);
}

/** 왼쪽에 서는 화자 — 고객뿐이다. 반대편(오른쪽)은 은행 쪽, 즉 KARI-NA와 상담원이 함께 선다.
 *  AI가 접수하다 상담원이 이어받아도 고객에게는 '같은 은행'과 계속 말하는 한 줄기 대화다 —
 *  좌우가 그 구조를 그대로 보여준다. 규칙이 하나뿐이라 고객 창·직원 창이 같은 코드로 같은
 *  그림을 그린다(창마다 좌우를 뒤집지 않는다). */
const LEFT_SIDE: StreamItem["who"] = "customer";

/** 화자 정체성 색 — 파형·말풍선 테두리·글자가 같은 계열이라 "이 색이 움직이면 이 사람이
 *  말한다"가 한눈에 잡힌다. cursor=커서, text=본문, rgb=테두리를 알파로 깔 때 쓰는 원색,
 *  wave=파형 3겹(겹치는 교차부가 밝아지며 시리 특유의 발광이 난다).
 *
 *  KARI-NA는 브랜드 메인 컬러(--blue-700 #2f5fc4) 계열 — 우리 서비스가 말하는 자리다.
 *  고객은 민트, 상담원은 보라. 세 색을 **같은 밝기·채도 대역**으로 맞춰 한 가족처럼 보이게
 *  하고(따로 고른 색처럼 튀지 않게), 구분은 색상(hue)이 맡는다. 브랜드 블루와 하늘색을
 *  나란히 두면 어두운 패널에서 거의 같아 보이므로 고객은 파랑을 쓰지 않는다. */
const SPK: Record<
  StreamItem["who"],
  { name: string; cursor: string; text: string; rgb: string; wave: string[] }
> = {
  customer: {
    name: "고객",
    cursor: "#6ee0c8",
    text: "#9df0e0",
    rgb: "111,224,200",
    wave: ["#6ee0c8", "#3bbfa4", "#a7f0e2"],
  },
  agent: {
    name: "상담원",
    cursor: "#c9a6ff",
    text: "#ddc8ff",
    rgb: "201,166,255",
    wave: ["#c9a6ff", "#9a6fe8", "#ddc8ff"],
  },
  ai: {
    name: "KARI-NA",
    cursor: "#8fb0e8",
    text: "#b9cdf1",
    rgb: "143,176,232",
    wave: ["#8fb0e8", "#2f5fc4", "#b9cdf1"],
  },
};
// 파형 색 — 이 화면의 주인(self) 색 계열의 명도 3단계. 고객 화면=파랑 물결, 직원 화면=보라 물결.
// 시리 원본의 무지개 대신 화자 색으로 번안했다(ONAIR: 색은 신호에만). 무지개빛이 아니라
// 세 장이 겹치는 교차부가 밝아지면서 시리 특유의 발광이 나온다.
const WAVE_COLORS: Record<"customer" | "agent", string[]> = {
  customer: ["#7db2ff", "#4d8fe8", "#a8ccff"],
  agent: ["#c9a6ff", "#9a6fe8", "#ddc8ff"],
};
/** 말풍선 한 덩이 — 화자가 바뀔 때마다 한 개. 카톡 문법을 그대로 쓴다:
 *  이 화면의 주인(self)은 오른쪽, 나머지는 왼쪽. 상대 말풍선 위에만 화자 이름을 한 번 적고,
 *  시각은 말풍선 **옆 아래**(안쪽)에 붙인다 — 줄 앞에 붙이면 로그처럼 보인다.
 *  마지막 덩이는 타자기+커서로 지금 말하는 중임을 보여준다.
 *  색은 화자 색을 알파로 깐다 — 검은 패널에서 채도를 올리면 글자가 눈을 때린다. */
function BubbleLine({
  time,
  who,
  self,
  fontPx,
  full,
  isLast,
}: {
  time: string;
  who: StreamItem["who"];
  self: "customer" | "agent";
  fontPx: number;
  full: string;
  isLast: boolean;
}) {
  const typed = useTypewriter(full, 32, isLast);
  const text = isLast ? typed : full;
  const typing = isLast && typed.length < full.length;
  const spk = SPK[who];
  const mine = who !== LEFT_SIDE;
  const timePx = Math.round(Math.max(9, fontPx - 3.5) * 10) / 10;
  const stampEl = (
    <span
      style={css(
        "flex:none;color:#565b66;font-variant-numeric:tabular-nums;font:400 " +
          timePx +
          "px ui-monospace,'SF Mono',Menlo,Consolas,monospace"
      )}
    >
      {time}
    </span>
  );
  return (
    <div style={css("display:flex;flex-direction:column;gap:3px;animation:fadeIn .18s ease-out;align-items:" + (mine ? "flex-end" : "flex-start"))}>
      {/* 이름은 양쪽 다 적는다 — 오른쪽에 KARI-NA와 상담원이 함께 서므로 위치만으로는
          둘을 가를 수 없다. 색이 이미 말하지만, 누가 말했는지는 글자로도 분명해야 한다.
          AI가 접수하다 상담원이 이어받는 순간이 이 이름으로 눈에 보인다. */}
      <span
        style={css(
          "font:600 " +
            timePx +
            "px 'Avenir Next','Pretendard',sans-serif;letter-spacing:.2px;color:" +
            spk.cursor +
            (mine ? ";padding-right:3px" : ";padding-left:3px")
        )}
      >
        {spk.name}
      </span>
      <div style={css("display:flex;align-items:flex-end;gap:6px;max-width:100%;justify-content:" + (mine ? "flex-end" : "flex-start"))}>
        {mine && stampEl}
        <div
          style={css(
            // 배경은 아예 없다(투명). 옅게라도 면을 깔면 검은 패널 위에 회색 상자가 떠서
            // 글자보다 상자가 먼저 읽혔다. 남는 건 테두리와 글자뿐이고 둘 다 화자 색이다 —
            // 테두리를 진하게(.62) 잡아 배경 없이도 말풍선의 윤곽이 분명하다.
            "max-width:82%;border-radius:14px;padding:8px 11px;word-break:keep-all;overflow-wrap:anywhere;background:transparent;border:1px solid rgba(" +
              spk.rgb +
              ",.62);color:" +
              spk.text +
              ";font:400 " +
              fontPx +
              "px/1.6 'Avenir Next','Pretendard',sans-serif;letter-spacing:-.1px;" +
              // 꼬리 대신 말풍선의 '뿌리쪽' 한 귀퉁이만 각지게 — 방향은 남고 소음은 없다
              (mine ? "border-bottom-right-radius:5px" : "border-bottom-left-radius:5px")
          )}
        >
          {text}
          {isLast && (
            <span
              style={css(
                "display:inline-block;margin-left:1px;animation:recBlink 1s infinite;color:" +
                  spk.cursor +
                  (typing ? "" : ";opacity:.45")
              )}
            >
              ▍
            </span>
          )}
        </div>
        {!mine && stampEl}
      </div>
    </div>
  );
}
