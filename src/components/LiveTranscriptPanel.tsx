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
}: {
  stream: StreamItem[];
  active: boolean;
  /** 이 화면의 주인 — 이 화자의 말이 오른쪽·선명하게 그려진다 */
  self?: "customer" | "agent";
  /** 옆에 세우는 것(폰·콘솔)의 높이에 맞춘다 */
  height?: number;
}) {
  const scrollRef = useRef<HTMLDivElement | null>(null);

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
  const groups: { who: StreamItem["who"]; texts: string[]; lastId: string }[] = [];
  stream.forEach((it) => {
    const g = groups[groups.length - 1];
    if (g && g.who === it.who) {
      g.texts.push(it.text);
      g.lastId = it.id;
    } else {
      groups.push({ who: it.who, texts: [it.text], lastId: it.id });
    }
  });

  return (
    <div
      style={css(
        "flex:none;width:260px;height:" +
          height +
          "px;display:flex;flex-direction:column;background:#0a0a0e;border-radius:20px;box-shadow:0 18px 50px rgba(0,0,0,.5);overflow:hidden"
      )}
    >
      {/* 파형 — 상자 안 상자: 어두운 패널 속 더 깊은 무대, 그 위 흰 물결 */}
      <div
        style={css(
          "flex:none;margin:16px 22px 0;height:130px;position:relative;background:#000;border-radius:14px;overflow:hidden"
        )}
      >
        <div style={css("position:absolute;inset:0")}>
          <Threads getAmplitude={getAmp} amplitude={0.9} distance={0} color={[1, 1, 1]} />
        </div>
      </div>

      {/* 전사 — 검은 배경 위 코딩 글자. 오래 말하면 위로 흘러가며 상단이 점진적으로 투명해진다.
          overlay 덮개 대신 mask 그라데이션 — 글자 자체가 위 88px에 걸쳐 서서히 사라진다 */}
      <div style={css("position:relative;flex:1;min-height:0")}>
      <div
        ref={scrollRef}
        style={css(
          // justify-content:flex-end — 대화는 바닥에 붙어 위로 자란다(카톡·메신저 규칙).
          // 위로 스크롤하지 않고 항상 바닥을 보므로 flex-end의 상단 클리핑 문제는 없다.
          "height:100%;overflow:hidden;padding:18px 22px;display:flex;flex-direction:column;justify-content:flex-end;gap:12px;box-sizing:border-box;-webkit-mask-image:linear-gradient(to bottom,transparent 0,#000 88px);mask-image:linear-gradient(to bottom,transparent 0,#000 88px)"
        )}
      >
        {groups.length === 0 ? (
          <div style={css("height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;color:#565b66")}>
            <span className="mi" style={css("font-size:30px")}>graphic_eq</span>
            {/* 안내 문구는 화면마다 다르다 — 직원 화면엔 옆에 전화기가 없다 */}
            <span style={css("font:400 12.5px 'Geist Sans','Pretendard',sans-serif;text-align:center;line-height:1.6")}>
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
            <Bubble
              key={gi + ":" + g.who}
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

/** 말풍선 — 카톡 규칙: 내 말은 오른쪽·선명, 상대 말은 왼쪽·흐림.
 *  정렬과 명암이 이미 화자를 말해주므로 내 말엔 라벨을 달지 않는다(상대만 붙인다).
 *  AI 안내는 대화 참여자가 아니라 시스템이라 가운데·작게 흘린다. */
function Bubble({
  who,
  self,
  full,
  isLast,
}: {
  who: StreamItem["who"];
  self: "customer" | "agent";
  full: string;
  isLast: boolean;
}) {
  const typed = useTypewriter(full, 32, isLast);
  const text = isLast ? typed : full;
  const typing = isLast && typed.length < full.length;

  if (who === "ai") {
    return (
      <div
        style={css(
          "align-self:center;max-width:92%;text-align:center;font:400 11.5px/1.7 'Geist Sans','Pretendard',sans-serif;color:#7c828d;animation:fadeIn .2s ease-out"
        )}
      >
        {text}
      </div>
    );
  }

  const mine = who === self;
  return (
    <div style={css("display:flex;flex-direction:column;gap:3px;align-items:" + (mine ? "flex-end" : "flex-start"))}>
      {!mine && (
        <span style={css("font:600 10px 'Geist Sans','Pretendard',sans-serif;letter-spacing:.3px;color:#6d7480;padding:0 4px")}>
          {who === "agent" ? "상담원" : "고객"}
        </span>
      )}
      <div
        style={css(
          "max-width:80%;padding:8px 11px;border-radius:14px;word-break:break-all;animation:fadeIn .2s ease-out;font:400 13px/1.75 'Geist Mono','IBM Plex Mono',monospace;letter-spacing:-.2px;" +
            (mine
              ? "background:#2f6bd8;color:#f4f7ff;border-bottom-right-radius:5px"
              : "background:#1b1e25;color:#9aa1ad;border-bottom-left-radius:5px")
        )}
      >
        {text}
        {isLast && (
          <span
            style={css(
              "display:inline-block;margin-left:2px;animation:recBlink 1s infinite;color:" +
                (mine ? "#f4f7ff" : "#9aa1ad") +
                (typing ? "" : ";opacity:.5")
            )}
          >
            ▍
          </span>
        )}
      </div>
    </div>
  );
}
