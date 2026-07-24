import { useCallback, useEffect, useRef, useState } from "react";
import { css } from "../lib/css";
import Threads from "./Threads";

/**
 * 실시간 통화 전사 패널 — 음성 파형(Threads) + 카톡형 대화 스트림.
 *
 * 2-TV 무대에서 고객 화면과 직원 화면이 이 컴포넌트를 함께 쓴다. 같은 대화를
 * 양쪽에 똑같이 복사하면 관객이 "왜 같은 게 두 개지?"가 되므로, **각 화면은 자기
 * 발화만** 그린다 — 고객 폰엔 고객 말, 직원 콘솔엔 상담원 말. 말풍선·배경·그라데이션
 * 없이 그냥 텍스트가 실시간으로 흐르고, 화자 색으로 물들여 어느 화면인지 구분된다.
 *
 * 파형은 대화 전체에 반응한다: 자기 발화엔 크게, 상대 발화엔 잔잔하게 출렁여
 * (자막엔 안 보여도) 상대가 말하는 순간을 물결로 느끼게 한다.
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

  // 말풍선 글자 크기는 패널 폭에 비례 — 화면 비율/스케일이 바뀌어도 글자가 상대적으로
  // 같은 크기로 읽힌다(폭 400 기준 13px, 좁아지면 줄고 넓어지면 커지되 11~15px로 클램프).
  const fontPx = Math.round(Math.max(11, Math.min(15, width * 0.033)) * 10) / 10;

  // 각 화면은 '자기 발화'만 그린다 — 고객 폰=고객 말, 직원 콘솔=상담원 말.
  // 먼저 전체 스트림에서 같은 화자의 연속 조각을 한 그룹(줄)으로 묶는다 — 그래야
  // 발화 '턴'이 보존된다(상대 발화가 턴 경계를 가른다). 그다음 자기 발화 그룹만 남긴다.
  // (자기 것만 먼저 걸러내면 떨어져 있던 여러 턴이 한 말풍선으로 뭉쳐버린다)
  const allGroups: { who: StreamItem["who"]; texts: string[]; firstId: string; lastId: string; time: string }[] = [];
  stream.forEach((it) => {
    const g = allGroups[allGroups.length - 1];
    if (g && g.who === it.who) {
      g.texts.push(it.text);
      g.lastId = it.id;
    } else {
      allGroups.push({ who: it.who, texts: [it.text], firstId: it.id, lastId: it.id, time: stamp(it.id) });
    }
  });
  const groups = allGroups.filter((g) => g.who === self);

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

      {/* 전사 — 검은 배경 위 실시간 텍스트. 말풍선·그라데이션 없이 그냥 글자만 흐른다.
          파형 바로 아래에서 시작해 아래로 자라고, 최신 줄이 바닥에 오도록 자동 스크롤. */}
      <div style={css("position:relative;flex:1;min-height:0")}>
      <div
        ref={scrollRef}
        style={css(
          "height:100%;overflow:hidden;padding:14px 20px;display:flex;flex-direction:column;justify-content:flex-start;gap:10px;box-sizing:border-box"
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
            <TextLine
              key={g.firstId}
              time={g.time}
              who={g.who}
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

/** 텍스트 줄 — 각 화면은 자기 발화만 그린다(고객 폰=고객, 직원 콘솔=상담원).
 *  말풍선·배경·그라데이션 없이 그냥 글자만 실시간으로 흐른다. 화자 색으로 물들이고,
 *  마지막 줄은 타자기+커서로 지금 말하는 중임을 보여준다. */
// 화자 정체성 색 — 파형·글자가 같은 계열. cursor=커서, text=본문(검은 배경에서 잘 읽히는 톤).
const SPK: Record<StreamItem["who"], { name: string; cursor: string; text: string }> = {
  customer: { name: "고객", cursor: "#7fb0ff", text: "#bcd6ff" },   // 파랑
  agent: { name: "상담원", cursor: "#b39dff", text: "#d2c6ff" },     // 보라
  ai: { name: "KARI-NA", cursor: "#6ee0c8", text: "#a9ecdc" },       // 민트
};
// 파형 색(Threads uColor) — 이 화면의 주인(self) 색. 고객 화면=파랑 물결, 직원 화면=보라 물결.
const WAVE_COLOR: Record<"customer" | "agent", [number, number, number]> = {
  customer: [0.5, 0.69, 1.0],
  agent: [0.7, 0.615, 1.0],
};
function TextLine({
  time,
  who,
  fontPx,
  full,
  isLast,
}: {
  time: string;
  who: StreamItem["who"];
  fontPx: number;
  full: string;
  isLast: boolean;
}) {
  const typed = useTypewriter(full, 32, isLast);
  const text = isLast ? typed : full;
  const typing = isLast && typed.length < full.length;
  const spk = SPK[who];
  const timePx = Math.round(Math.max(9, fontPx - 3.5) * 10) / 10;
  return (
    <div style={css("display:flex;gap:10px;align-items:baseline;animation:fadeIn .18s ease-out")}>
      <span
        style={css(
          "flex:1;min-width:0;color:" +
            spk.text +
            ";font:400 " +
            fontPx +
            "px/1.6 'Avenir Next','Pretendard',sans-serif;letter-spacing:-.1px;word-break:keep-all;overflow-wrap:anywhere"
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
      </span>
      <span
        style={css(
          "flex:none;color:#4c515c;font-variant-numeric:tabular-nums;font:400 " +
            timePx +
            "px 'Geist Mono','IBM Plex Mono',monospace"
        )}
      >
        {time}
      </span>
    </div>
  );
}
