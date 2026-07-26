import { useEffect, useRef, useState, type ReactNode } from "react";
import { css } from "../../lib/css";

/**
 * 타이핑 애니메이션 (Magic UI TypingAnimation 이식).
 *
 * 두 가지 모드가 있고, 기본은 **이어치기**다.
 *
 * · 이어치기(continuous, 기본): 목표 문장이 뒤로 자라나도 **처음부터 다시 치지 않고** 치던
 *   자리에서 이어 친다. 실시간 STT는 한 문장이 통째로 오지 않고 "잘못 송금" → "잘못 송금했어요"
 *   처럼 뒤가 붙으며 자란다. 매번 처음부터 다시 치면 글자가 앞뒤로 요동쳐 읽을 수가 없다.
 * · 한 번치기(continuous=false): 다 만들어진 문장을 처음부터 끝까지 한 번 친다.
 *   AI가 방금 써 낸 카드 요약처럼 **완성된 문장이 도착하는** 자리에 쓴다.
 *
 * 커서는 치는 동안에만 깜빡인다 — 다 치고도 남아 있으면 아직 쓰는 중으로 오해된다.
 */
/** 사람이 말하는 속도에 맞춘 글자당 ms.
 *  한국어는 초당 4~5음절이라 한 글자가 200ms 안팎인데, 그대로 쓰면 시연이 늘어진다.
 *  90ms는 "말하는 대로 받아 적히는 중"으로 읽히면서 발화보다 앞서 끝나는 지점이다.
 *  ※ 전사 패널의 파형 스웰 계산도 이 값을 쓴다 — 둘이 갈리면 물결과 글자가 어긋난다. */
export const SPEECH_MS_PER_CHAR = 90;

export function useTyping(target: string, speedMs = 32, enabled = true, continuous = true) {
  const [shown, setShown] = useState(enabled ? 0 : target.length);

  // 한 번치기 — 문장이 통째로 바뀌면 처음부터 다시 친다
  const prev = useRef(target);
  useEffect(() => {
    if (!enabled) return;
    const changed = prev.current !== target;
    prev.current = target;
    if (!changed) return;
    // 이어치기는 '뒤가 자란 것'이면 그대로 잇고, 아예 다른 문장이면 처음부터
    if (continuous && target.startsWith(prev.current)) return;
    if (continuous) setShown((s) => (s > target.length ? 0 : s));
    else setShown(0);
  }, [target, enabled, continuous]);

  // 한 글자씩 — 다 치면 타이머를 두지 않는다(말풍선마다 빈 인터벌이 도는 걸 막는다)
  useEffect(() => {
    if (!enabled) {
      setShown(target.length);
      return;
    }
    if (shown >= target.length) return;
    const id = window.setTimeout(() => setShown((s) => s + 1), speedMs);
    return () => window.clearTimeout(id);
  }, [enabled, speedMs, shown, target.length]);

  return { text: target.slice(0, shown), typing: enabled && shown < target.length };
}

export default function TypingAnimation({
  text,
  speed = 32,
  enabled = true,
  continuous = true,
  showCursor = true,
  cursor = "▍",
  style,
  className,
  children,
}: {
  text: string;
  /** 글자당 ms */
  speed?: number;
  /** 꺼지면 전문이 즉시 보인다 — 애니메이션은 연출이지 정보가 아니다 */
  enabled?: boolean;
  continuous?: boolean;
  showCursor?: boolean;
  cursor?: ReactNode;
  style?: React.CSSProperties;
  className?: string;
  /** 타이핑이 끝난 뒤 뒤에 붙일 것(배지 등) */
  children?: ReactNode;
}) {
  const { text: shown, typing } = useTyping(text, speed, enabled, continuous);
  return (
    <span className={className} style={style}>
      {shown}
      {showCursor && typing && (
        <span aria-hidden="true" style={css("display:inline-block;margin-left:1px;animation:recBlink 1s infinite")}>
          {cursor}
        </span>
      )}
      {!typing && children}
    </span>
  );
}
