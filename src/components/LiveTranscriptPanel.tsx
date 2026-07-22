import { useEffect, useRef, useState } from "react";
import { css } from "../lib/css";
import TextType from "./TextType";
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
 * 마지막 조각만 커서와 함께 타이핑된다(TextType).
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

  // 발화 반응 파형 — 새 조각마다 즉시 스파이크(어택) 후 기저로 천천히 감쇠(릴리즈)
  const [amp, setAmp] = useState(0.9);
  const prevCount = useRef(0);
  useEffect(() => {
    if (stream.length > prevCount.current) setAmp(3.0);
    prevCount.current = stream.length;
  }, [stream]);
  useEffect(() => {
    const id = window.setInterval(() => {
      setAmp((a) => {
        const base = active ? 1.1 : 0.9;
        const next = a + (base - a) * 0.04;
        return Math.abs(next - base) < 0.01 ? base : next;
      });
    }, 80);
    return () => window.clearInterval(id);
  }, [active]);

  // 새 조각이 붙으면 스트림을 바닥으로 — 라이브 자막은 항상 최신이 보인다
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [stream]);

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
          "flex:none;margin:16px 16px 0;height:180px;position:relative;background:#000;border-radius:14px;overflow:hidden;box-shadow:inset 0 0 0 1px rgba(255,255,255,.07)"
        )}
      >
        <div style={css("position:absolute;inset:0")}>
          <Threads amplitude={amp} distance={0} color={[1, 1, 1]} />
        </div>
      </div>

      {/* 전사 — 검은 배경 위 코딩 글자. 고객은 이어지는 문단, AI 멘트는 별도 줄 */}
      <div ref={scrollRef} style={css("flex:1;min-height:0;overflow-y:auto;padding:18px 22px;display:flex;flex-direction:column;gap:12px")}>
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
          groups.map((g, gi) => {
            const isLastGroup = gi === groups.length - 1;
            const settled = (isLastGroup ? g.texts.slice(0, -1) : g.texts).join(" ");
            const lastText = isLastGroup ? g.texts[g.texts.length - 1] : null;
            const isAi = g.who === "ai";
            return (
              <div
                key={g.lastId}
                style={css(
                  "font:400 13px/1.9 'Geist Mono','IBM Plex Mono',monospace;letter-spacing:-.2px;word-break:break-all;animation:fadeIn .2s ease-out;color:" +
                    (isAi ? "#8a919d" : "#a9b0bb")
                )}
              >
                {isAi && (
                  <span style={css("display:inline-block;margin-right:8px;padding:1px 6px;border:1px solid #3a3f49;border-radius:5px;font-size:10px;color:#8a919d;transform:translateY(-1px)")}>
                    AI
                  </span>
                )}
                {settled && (
                  <span>{settled + (lastText ? " " : "")}</span>
                )}
                {lastText && (
                  <span style={css("color:" + (isAi ? "#c6cbd4" : "#eef1f6"))}>
                    <TextType
                      key={g.lastId}
                      as="span"
                      text={lastText}
                      typingSpeed={34}
                      loop={false}
                      showCursor
                      cursorCharacter="▍"
                      cursorBlinkDuration={0.45}
                    />
                  </span>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
