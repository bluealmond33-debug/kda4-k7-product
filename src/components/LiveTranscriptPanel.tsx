import { useEffect, useRef, useState } from "react";
import { css } from "../lib/css";
import TextType from "./TextType";
import Threads from "./Threads";
import type { LiveLine } from "../hooks/useLiveCallBus";

/**
 * 고객 화면(?role=customer) 오른쪽 — 음성 파형(Threads) + STT 전사 스트림.
 *
 * 라벨·상태 문구는 없다 — 그건 전부 상단 상황 알약의 몫이고, 이 패널은
 * "소리가 흐른다"(물결)와 "말이 글자가 된다"(전사) 두 감각만 보여준다.
 *
 * 물결은 가만히 있어도 잔잔하게 흐르고(기저 0.5), 발화가 도착하면
 * 크게 요동쳤다가(2.3) 서서히 가라앉는다 — 말의 에너지가 물결로 보인다.
 * (실마이크 연동 시 AnalyserNode 데시벨로 같은 amplitude를 구동하면 된다)
 *
 * 전사는 STT답게 문장별로 끊지 않고 한 흐름으로 이어 붙인다 —
 * 확정된 텍스트 뒤에 새 조각이 계속 타이핑되며 자라나는 하나의 문단.
 */

export default function LiveTranscriptPanel({
  lines,
  active,
}: {
  lines: LiveLine[];
  active: boolean;
}) {
  const scrollRef = useRef<HTMLDivElement | null>(null);

  // 발화 반응 파형 — 새 조각마다 스파이크(2.3) 후 기저로 감쇠.
  // 기저: 대기 0.5(잔잔한 물결) · 통화 중 0.7(살아있는 물결)
  const [amp, setAmp] = useState(0.5);
  const prevCount = useRef(0);
  useEffect(() => {
    if (lines.length > prevCount.current) setAmp(2.3);
    prevCount.current = lines.length;
  }, [lines]);
  useEffect(() => {
    const id = window.setInterval(() => {
      setAmp((a) => {
        const base = active ? 0.7 : 0.5;
        const next = a + (base - a) * 0.045;
        return Math.abs(next - base) < 0.01 ? base : next;
      });
    }, 80);
    return () => window.clearInterval(id);
  }, [active]);

  // 새 조각이 붙으면 스트림을 바닥으로 — 라이브 자막은 항상 최신이 보인다
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [lines]);

  // STT 흐름 — 마지막 조각만 타이핑, 앞 조각들은 확정 텍스트로 이어 붙는다
  const settled = lines
    .slice(0, -1)
    .map((l) => l.text)
    .join(" ");
  const lastLine = lines.length > 0 ? lines[lines.length - 1] : null;

  return (
    <div
      style={css(
        "flex:none;width:470px;height:532px;display:flex;flex-direction:column;background:var(--onair-surface);border-radius:20px;box-shadow:0 18px 50px rgba(0,0,0,.4);overflow:hidden"
      )}
    >
      {/* 파형 — 늘 흐르고, 말하면 요동친다 */}
      <div style={css("flex:none;height:110px;position:relative;border-bottom:1px dashed var(--color-border)")}>
        <div style={css("position:absolute;inset:0")}>
          <Threads amplitude={amp} distance={0} color={[0.12, 0.14, 0.19]} />
        </div>
      </div>

      {/* 전사 — 끊기지 않는 한 문단. 마지막 조각만 커서와 함께 타이핑 */}
      <div ref={scrollRef} style={css("flex:1;min-height:0;overflow-y:auto;padding:20px 24px")}>
        {!lastLine ? (
          <div style={css("height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;color:var(--gray-500)")}>
            <span className="mi" style={css("font-size:30px")}>graphic_eq</span>
            <span style={css("font:400 12.5px 'Geist Sans','Pretendard',sans-serif;text-align:center;line-height:1.6")}>
              왼쪽 전화기의 통화 버튼을 누르면
              <br />
              고객의 말이 여기 실시간으로 표시됩니다
            </span>
          </div>
        ) : (
          <div style={css("font:400 15.5px/1.85 'Geist Sans','Pretendard',sans-serif;color:var(--gray-1000)")}>
            {settled && <span style={css("color:var(--gray-800)")}>{settled + " "}</span>}
            <TextType
              key={lastLine.id}
              as="span"
              text={lastLine.text}
              typingSpeed={34}
              loop={false}
              showCursor
              cursorCharacter="▍"
              cursorBlinkDuration={0.45}
            />
          </div>
        )}
      </div>
    </div>
  );
}
