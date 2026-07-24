import { useCallback, useEffect, useRef, useState } from "react";
import { css } from "../lib/css";
import Threads from "./Threads";

/**
 * 실시간 통화 전사 패널 — 음성 파형(Threads) + 카톡형 대화 스트림.
 *
 * 2-TV 무대에서 고객 화면과 직원 화면이 이 컴포넌트를 함께 쓴다. 같은 대화를
 * 양쪽에 똑같이 복사하면 관객이 "왜 같은 게 두 개지?"가 되므로, 카톡이 그렇듯
 * **화면마다 그 사람의 시점**으로 그린다 — self가 말한 건 오른쪽·선명하게,
 * 상대가 말한 건 왼쪽·흐리게. 두 화면은 서로의 거울이 되고, 한 대화가 두 자리를
 * 건너다니는 연출이 된다.
 *
 * 파형도 같은 원리로 방향을 갖는다: self가 말할 때만 크게 출렁이고 상대가 말할
 * 땐 잔잔하다. 관객은 자막을 읽기 전에 "지금 누가 말하는지"를 안다.
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
  // React 재렌더 없이 ampRef만 갱신 → Threads가 매 프레임 getAmplitude로 읽는다.
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
  const getAmp = useCallback(() => ampRef.current, []);

  // 라이브 자막 스크롤 — 타이핑으로 글자가 한 자씩 자라도 항상 바닥(최신)을 본다.
  // 옛 텍스트는 위로 밀려 올라가 상단 페이드 아래로 사라진다 (발표용: 스크롤바 없음)
  useEffect(() => {
    const id = window.setInterval(() => {
      const el = scrollRef.current;
      if (el) el.scrollTop = el.scrollHeight;
    }, 150);
    return () => window.clearInterval(id);
  }, []);

  // 같은 화자의 연속 조각은 한 그룹(문단)으로 묶되 고객·상담원 표시는
  // 유지한다. 두 채널이 실제로 섞이는 통화에서 발화자를 지워서는 안 된다.
  const groups: { who: StreamItem["who"]; texts: string[]; firstId: string; lastId: string; time: string }[] = [];
  stream.forEach((it) => {
    const g = groups[groups.length - 1];
    if (g && g.who === it.who) {
      g.texts.push(it.text);
      g.lastId = it.id;
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
      <div
        style={css(
          "flex:none;margin:30px 40px 0;height:120px;position:relative;background:#000;border-radius:14px;overflow:hidden"
        )}
      >
        <div style={css("position:absolute;inset:0")}>
          <Threads getAmplitude={getAmp} amplitude={0.9} distance={0} color={WAVE_COLOR[self]} />
        </div>
      </div>

      {/* 범례 — 이 화면이 누구 시점인지 + 화자 색. '고객/상담원'을 색으로 구분해 번갈아 읽힌다. */}
      <div style={css("flex:none;display:flex;align-items:center;gap:12px;padding:9px 22px 2px")}>
        {(["customer", "agent"] as const).map((w) => (
          <span key={w} style={css("display:inline-flex;align-items:center;gap:5px")}>
            <span style={css("width:7px;height:7px;border-radius:9999px;flex:none;background:" + SPK[w].color)} />
            <span style={css("font:700 10px 'Avenir Next','Geist Sans','Pretendard',sans-serif;color:" + (w === self ? SPK[w].color : "#7c828d"))}>{SPK[w].name}{w === self ? " · 이 화면" : ""}</span>
          </span>
        ))}
        <div style={css("flex:1")} />
        <span style={css("font:400 9.5px 'Avenir Next','Geist Sans','Pretendard',sans-serif;color:#565b66")}>실시간 전사 · 번갈아 표시</span>
      </div>

      {/* 전사 — 검은 배경 위 코딩 글자. 오래 말하면 위로 흘러가며 상단이 점진적으로 투명해진다.
          overlay 덮개 대신 mask 그라데이션 — 글자 자체가 위 88px에 걸쳐 서서히 사라진다 */}
      <div style={css("position:relative;flex:1;min-height:0")}>
      <div
        ref={scrollRef}
        style={css(
          // justify-content:flex-end — 대화는 바닥에 붙어 위로 자란다(카톡·메신저 규칙).
          // 위로 스크롤하지 않고 항상 바닥을 보므로 flex-end의 상단 클리핑 문제는 없다.
          "height:100%;overflow:hidden;padding:16px 20px;display:flex;flex-direction:column;justify-content:flex-end;gap:4px;box-sizing:border-box;-webkit-mask-image:linear-gradient(to bottom,transparent 0,#000 72px);mask-image:linear-gradient(to bottom,transparent 0,#000 72px)"
        )}
      >
        {groups.length === 0 ? (
          // 안내 문구를 화면 정중앙보다 조금 위로 — 파형 상자와 가깝게, 아래를 비워 균형을 맞춘다
          <div style={css("height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;color:#565b66;padding-bottom:120px")}>
            <span className="mi" style={css("font-size:30px")}>graphic_eq</span>
            {/* 안내 문구는 화면마다 다르다 — 직원 화면엔 옆에 전화기가 없다 */}
            <span style={css("font:400 12.5px 'Avenir Next','Geist Sans','Pretendard',sans-serif;text-align:center;line-height:1.6")}>
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
            <LogLine
              key={g.firstId}
              time={g.time}
              who={g.who}
              self={self}
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

/** 로그 라인 — STT 전사 로그 스타일: [시각] [화자] 텍스트, 모노폰트.
 *  말풍선 없이 한 줄. 이 화면의 주인(self)은 밝게, 상대는 흐리게, KARI-NA(AI)는 파란 강조.
 *  마지막 줄은 타자기+커서로 실시간 전사 감각을 유지한다. */
// 화자 정체성 색 — 파형·라벨이 같은 색을 써서 '누구 말인지'가 눈에 바로 든다.
const SPK: Record<StreamItem["who"], { name: string; color: string }> = {
  customer: { name: "고객", color: "#7fb0ff" },   // 파랑
  agent: { name: "상담원", color: "#b39dff" },     // 보라
  ai: { name: "KARI-NA", color: "#6ee0c8" },       // 민트
};
// 파형 색(Threads uColor) — 이 화면의 주인(self) 색. 고객 화면=파랑 물결, 직원 화면=보라 물결.
const WAVE_COLOR: Record<"customer" | "agent", [number, number, number]> = {
  customer: [0.5, 0.69, 1.0],
  agent: [0.7, 0.615, 1.0],
};
function LogLine({
  time,
  who,
  self,
  full,
  isLast,
}: {
  time: string;
  who: StreamItem["who"];
  self: "customer" | "agent";
  full: string;
  isLast: boolean;
}) {
  const typed = useTypewriter(full, 32, isLast);
  const text = isLast ? typed : full;
  const typing = isLast && typed.length < full.length;
  const mine = who === self;
  const labelColor = SPK[who].color; // 화자 정체성 색(파형과 일치)
  const textColor = mine ? "#dfe3ea" : "#828997"; // 이 화면 주인=밝게, 상대=흐리게
  return (
    <div style={css("display:flex;gap:9px;align-items:baseline;animation:fadeIn .18s ease-out;font:400 12.5px/1.65 'Geist Mono','IBM Plex Mono',monospace;letter-spacing:-.2px")}>
      <span style={css("flex:none;color:#4c515c;font-size:10.5px;font-variant-numeric:tabular-nums")}>{time}</span>
      <span style={css("flex:none;display:inline-flex;align-items:center;gap:5px;width:60px;font-weight:700;font-size:11px;color:" + labelColor)}>
        <span style={css("width:6px;height:6px;border-radius:9999px;flex:none;background:" + labelColor)} />{SPK[who].name}
      </span>
      <span style={css("flex:1;min-width:0;word-break:break-all;color:" + textColor)}>
        {text}
        {isLast && (
          <span style={css("display:inline-block;margin-left:1px;animation:recBlink 1s infinite;color:" + labelColor + (typing ? "" : ";opacity:.45"))}>▍</span>
        )}
      </span>
    </div>
  );
}
