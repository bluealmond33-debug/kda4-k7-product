import { useCallback, useEffect, useRef, useState } from "react";
import { css } from "../lib/css";
import Threads from "./Threads";

/**
 * 고객 화면(?role=customer) 오른쪽 — 음성 파형(Threads) + STT 전사 스트림.
 *
 * 검은 패널 — 흰 폰보다 눈에 덜 띄어야 한다(주인공은 폰, 이건 배경 정보).
 * 라벨·상태 문구는 없다: 그건 상단 상황 알약의 몫이고, 이 패널은
 * "소리가 흐른다"(물결)와 "말이 글자가 된다"(전사) 두 감각만 보여준다.
 *
 * 스트림에는 고객 발화(cust)와 AI 안내 멘트(ai)가 도착 순서로 섞인다 —
 * 고객 조각들은 STT답게 한 문단으로 이어 붙고, AI 멘트는 별도 줄로 끊는다.
 * 타이핑은 연속 타자기(useTypewriter): 목표 텍스트가 자라나도 재시작 없이
 * 이어서 따라간다 — 문장 단위로 끊기지 않는 진짜 STT 스트림 감각.
 *
 * 물결은 가만히 있어도 잔잔히 흐르고(기저 0.9/1.1), 발화가 도착하면
 * 크게 요동(3.0)쳤다가 천천히 가라앉는다 — Siri 파형의 어택·릴리즈 원리.
 */

export interface StreamItem {
  id: string;
  text: string;
  who: "cust" | "ai";
}

export default function LiveTranscriptPanel({
  stream,
  active,
}: {
  stream: StreamItem[];
  active: boolean;
}) {
  const scrollRef = useRef<HTMLDivElement | null>(null);

  // Siri풍 파형 진폭 — 60fps rAF에서 '연속 사인 합성'으로 부드럽게 구동한다.
  // (랜덤 스텝 대신 여러 저주파 사인을 겹쳐 자연스러운 출렁임을 만든다)
  // React 재렌더 없이 ampRef만 갱신 → Threads가 매 프레임 getAmplitude로 읽는다.
  // 기준: "음성이 들리는 동안"(=조각 타이핑 예상 시간 + 여유)만 크게 스웰.
  const ampRef = useRef(0.9);
  const speakingUntil = useRef(0);
  const prevCount = useRef(0);
  useEffect(() => {
    if (stream.length > prevCount.current) {
      const last = stream[stream.length - 1];
      speakingUntil.current = performance.now() + last.text.length * 32 + 600;
    }
    prevCount.current = stream.length;
  }, [stream]);
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
        ? 0.9 +
          0.5 * Math.sin(t * 0.0075) +
          0.28 * Math.sin(t * 0.0135 + 1.3) +
          0.16 * Math.sin(t * 0.022 + 2.1)
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

  // 같은 화자의 연속 조각은 한 그룹(문단)으로 — 고객은 이어지는 STT, AI는 별도 줄
  const groups: { who: "cust" | "ai"; texts: string[]; lastId: string }[] = [];
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
        "flex:none;width:260px;height:532px;display:flex;flex-direction:column;background:#0a0a0e;border-radius:20px;box-shadow:0 18px 50px rgba(0,0,0,.5);overflow:hidden"
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
          "height:100%;overflow:hidden;padding:18px 22px;display:flex;flex-direction:column;gap:12px;box-sizing:border-box;-webkit-mask-image:linear-gradient(to bottom,transparent 0,#000 88px);mask-image:linear-gradient(to bottom,transparent 0,#000 88px)"
        )}
      >
        {groups.length === 0 ? (
          <div style={css("height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;color:#565b66")}>
            <span className="mi" style={css("font-size:30px")}>graphic_eq</span>
            <span style={css("font:400 12.5px 'Geist Sans','Pretendard',sans-serif;text-align:center;line-height:1.6")}>
              왼쪽 전화기의 통화 버튼을 누르면
              <br />
              고객의 말이 여기 실시간으로 표시됩니다
            </span>
          </div>
        ) : (
          groups.map((g, gi) => (
            <GroupLine
              key={gi + ":" + g.who}
              who={g.who}
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

function GroupLine({
  who,
  full,
  isLast,
}: {
  who: "cust" | "ai";
  full: string;
  isLast: boolean;
}) {
  const typed = useTypewriter(full, 32, isLast);
  const text = isLast ? typed : full;
  const typing = isLast && typed.length < full.length;
  const isAi = who === "ai";
  return (
    <div
      style={css(
        "font:400 13px/1.9 'Geist Mono','IBM Plex Mono',monospace;letter-spacing:-.2px;word-break:break-all;animation:fadeIn .2s ease-out;color:" +
          (isAi ? "#8a919d" : "#dfe3ea")
      )}
    >
      {isAi && (
        <span style={css("display:inline-block;margin-right:8px;padding:1px 6px;border:1px solid #3a3f49;border-radius:5px;font-size:10px;color:#8a919d;transform:translateY(-1px)")}>
          AI
        </span>
      )}
      {text}
      {isLast && (
        <span style={css("display:inline-block;margin-left:2px;color:#eef1f6;animation:recBlink 1s infinite" + (typing ? "" : ";opacity:.5"))}>▍</span>
      )}
    </div>
  );
}
