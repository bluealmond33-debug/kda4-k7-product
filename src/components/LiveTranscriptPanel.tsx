import { useEffect, useRef, useState } from "react";
import { css } from "../lib/css";
import TextType from "./TextType";
import Threads from "./Threads";
import type { LiveLine } from "../hooks/useLiveCallBus";

/**
 * 고객 화면(?role=customer) 오른쪽 — 음성 파형(Threads) + 발화 전사 스트림.
 *
 * 데이터는 부모(LiveDemo)의 useLiveCallBus가 demoBus에서 받아 내려준다.
 * 상태 문구는 상단 상황 알약이 담당하고, 이 패널은 "소리가 흐른다"(Threads)와
 * "말이 글자가 된다"(STT 자막 스트림) 두 가지만 보여준다.
 *
 * Threads(WebGL 유동 라인)는 발화가 도착할 때마다 amplitude가 튀었다가
 * 서서히 가라앉는다 — 고객이 말하는 동안 물결이 살아 움직이는 감각.
 * (실마이크 연동 시 AnalyserNode 데시벨로 같은 amplitude를 구동하면 된다)
 */

export default function LiveTranscriptPanel({
  lines,
  active,
}: {
  lines: LiveLine[];
  active: boolean;
}) {
  const scrollRef = useRef<HTMLDivElement | null>(null);

  // 발화 반응 파형 — 새 발화(=새 줄)마다 스파이크(1.8) 후 기저로 감쇠.
  // 통화 중 기저 0.35(잔물결), 대기 기저 0.08(수면).
  const [amp, setAmp] = useState(0.08);
  const prevCount = useRef(0);
  useEffect(() => {
    if (lines.length > prevCount.current) setAmp(1.8);
    prevCount.current = lines.length;
  }, [lines]);
  useEffect(() => {
    const id = window.setInterval(() => {
      setAmp((a) => {
        const base = active ? 0.35 : 0.08;
        const next = a + (base - a) * 0.05;
        return Math.abs(next - base) < 0.01 ? base : next;
      });
    }, 80);
    return () => window.clearInterval(id);
  }, [active]);

  // 새 발화가 붙으면 스트림을 바닥으로 — 라이브 자막은 항상 최신이 보인다
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [lines]);

  return (
    <div
      style={css(
        "flex:none;width:470px;height:532px;display:flex;flex-direction:column;background:var(--onair-surface);border-radius:20px;box-shadow:0 18px 50px rgba(0,0,0,.4);overflow:hidden"
      )}
    >
      {/* 파형 스트립 — 말할 때마다 물결이 인다 (상태 문구는 상단 알약 몫) */}
      <div style={css("flex:none;height:110px;position:relative;border-bottom:1px dashed var(--color-border)")}>
        <div style={css("position:absolute;inset:0")}>
          <Threads amplitude={amp} distance={0} color={[0.12, 0.14, 0.19]} />
        </div>
        <div style={css("position:absolute;left:20px;bottom:12px;display:flex;align-items:center;gap:7px")}>
          <span
            style={css(
              "width:7px;height:7px;border-radius:9999px;background:" +
                (active ? "var(--green-700)" : "var(--gray-400)") +
                (active ? ";animation:recBlink 1.1s infinite" : "")
            )}
          />
          <span style={css("font:700 12.5px 'Geist Sans','Pretendard',sans-serif;color:var(--gray-1000)")}>
            실시간 통화
          </span>
          <span style={css("font:400 10.5px 'Geist Mono','IBM Plex Mono',monospace;color:var(--gray-600)")}>
            LIVE TRANSCRIPT
          </span>
        </div>
      </div>

      {/* 발화 스트림 — STT 자막처럼 플레인 텍스트로 쌓인다. 마지막 줄만 타이핑 */}
      <div ref={scrollRef} style={css("flex:1;min-height:0;overflow-y:auto;padding:18px 22px;display:flex;flex-direction:column;gap:14px")}>
        {lines.length === 0 ? (
          <div style={css("flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;color:var(--gray-500)")}>
            <span className="mi" style={css("font-size:30px")}>graphic_eq</span>
            <span style={css("font:400 12.5px 'Geist Sans','Pretendard',sans-serif;text-align:center;line-height:1.6")}>
              왼쪽 전화기의 통화 버튼을 누르면
              <br />
              고객의 말이 여기 실시간으로 표시됩니다
            </span>
          </div>
        ) : (
          lines.map((line, i) => {
            const isLast = i === lines.length - 1;
            return (
              <div
                key={line.id}
                style={css(
                  "font:400 15px/1.7 'Geist Sans','Pretendard',sans-serif;animation:fadeIn .2s ease-out;color:" +
                    (isLast ? "var(--gray-1000)" : "var(--gray-700)")
                )}
              >
                {isLast ? (
                  <TextType
                    as="span"
                    text={line.text}
                    typingSpeed={34}
                    loop={false}
                    showCursor
                    cursorCharacter="▍"
                    cursorBlinkDuration={0.45}
                  />
                ) : (
                  line.text
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
