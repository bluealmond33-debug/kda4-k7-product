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

  // 발화 반응 파형 — Siri 파형 원리(음량 비례 진폭 + 빠른 어택·느린 릴리즈)를
  // 발화 이벤트에 적용: 새 조각마다 즉시 스파이크(3.0) 후 기저로 천천히 감쇠.
  // 기저: 대기 0.9 · 통화 중 1.1 — 가만히 있어도 물결이 살아서 흐른다.
  // (Threads 자체가 40겹 라인 + Perlin 노이즈라 겹침·랜덤 변조는 셰이더가 담당)
  const [amp, setAmp] = useState(0.9);
  const prevCount = useRef(0);
  useEffect(() => {
    if (lines.length > prevCount.current) setAmp(3.0);
    prevCount.current = lines.length;
  }, [lines]);
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
        "flex:none;width:400px;height:532px;display:flex;flex-direction:column;background:var(--onair-surface);border-radius:20px;box-shadow:0 18px 50px rgba(0,0,0,.4);overflow:hidden"
      )}
    >
      {/* 파형 — 상자 안 상자: 흰 패널 속 여백을 둔 검은 라운드 무대, 그 위 흰 물결.
          늘 흐르고, 말하면 요동친다 */}
      <div
        style={css(
          "flex:none;margin:16px 16px 0;height:180px;position:relative;background:#0a0a0e;border-radius:14px;overflow:hidden;box-shadow:inset 0 0 0 1px rgba(255,255,255,.05),0 10px 26px rgba(10,10,14,.22)"
        )}
      >
        <div style={css("position:absolute;inset:0")}>
          <Threads amplitude={amp} distance={0} color={[1, 1, 1]} />
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
          {/* 코딩 글자 — STT 원출력의 러프한 터미널 감각 */}
          <div style={css("font:400 13px/1.95 'Geist Mono','IBM Plex Mono',monospace;color:var(--gray-1000);letter-spacing:-.2px;word-break:break-all")}>
            {settled && <span style={css("color:var(--gray-700)")}>{settled + " "}</span>}
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
