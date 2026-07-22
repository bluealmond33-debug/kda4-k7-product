import { useEffect, useRef, useState } from "react";
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

  // 발화 반응 파형 — 기준: "음성이 들리는 동안"(=STT 타이핑이 진행되는 동안)
  // 랜덤 목표(1.4~2.9)를 계속 갈아끼우며 요동친다. 소리 크기와 무관한 랜덤 변조.
  // 조각 도착 → 그 텍스트의 타이핑 예상 시간만큼 '말하는 중'으로 간주(+여유 0.5s),
  // 끝나면 기저(0.9)로 천천히 가라앉는다 — 빠른 어택, 느린 릴리즈.
  const [amp, setAmp] = useState(0.9);
  const prevCount = useRef(0);
  const speakingUntil = useRef(0);
  useEffect(() => {
    if (stream.length > prevCount.current) {
      const last = stream[stream.length - 1];
      speakingUntil.current = Date.now() + last.text.length * 32 + 500;
      setAmp(2.6); // 어택 — 말이 시작되는 순간 즉시 출렁
    }
    prevCount.current = stream.length;
  }, [stream]);
  useEffect(() => {
    const id = window.setInterval(() => {
      const speaking = Date.now() < speakingUntil.current;
      setAmp((a) => {
        const target = speaking ? 1.4 + Math.random() * 1.5 : 0.9;
        const k = speaking ? 0.3 : 0.04; // 말할 땐 빠르게 요동, 멈추면 천천히 릴리즈
        return a + (target - a) * k;
      });
    }, 160);
    return () => window.clearInterval(id);
  }, []);

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
        "flex:none;width:400px;height:532px;display:flex;flex-direction:column;background:#0a0a0e;border-radius:20px;box-shadow:0 18px 50px rgba(0,0,0,.5);overflow:hidden"
      )}
    >
      {/* 파형 — 상자 안 상자: 어두운 패널 속 더 깊은 무대, 그 위 흰 물결 */}
      <div
        style={css(
          "flex:none;margin:16px 38px 0;height:180px;position:relative;background:#000;border-radius:14px;overflow:hidden"
        )}
      >
        <div style={css("position:absolute;inset:0")}>
          <Threads amplitude={amp} distance={0} color={[1, 1, 1]} />
        </div>
      </div>

      {/* 전사 — 검은 배경 위 코딩 글자. 오래 말하면 위로 흘러가며 상단 페이드로 사라진다 */}
      <div style={css("position:relative;flex:1;min-height:0")}>
      <div ref={scrollRef} style={css("height:100%;overflow:hidden;padding:18px 22px;display:flex;flex-direction:column;gap:12px;box-sizing:border-box")}>
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
      {/* 상단 페이드 — 올라간 텍스트가 어둠 속으로 잦아든다 */}
      <div style={css("position:absolute;top:0;left:0;right:0;height:64px;background:linear-gradient(#0a0a0e,rgba(10,10,14,0));pointer-events:none")} />
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
