import { forwardRef, type CSSProperties, type ReactNode } from "react";

type Dir = "up" | "down" | "left" | "right";

/**
 * 블러 페이드 (Magic UI BlurFade 이식).
 *
 * 흐릿하게, 조금 비켜서, 투명하게 있던 것이 제자리로 선명해진다.
 * 준비 카드가 통화 화면에 안착할 때 좌우 콘솔이 이 모션으로 따라 선다 —
 * 카드가 주인공이고 나머지는 그 뒤에 정돈되는 순서가 눈에 보인다.
 *
 * framer-motion 없이 CSS 변수를 키프레임 안에서 읽는다(`--bf-x/--bf-y/--bf-blur`).
 * 그래서 키프레임 하나로 네 방향·임의 거리·임의 블러를 다 쓴다.
 *
 * 감싸는 게 아니라 **그 자리에 서는** 컴포넌트다: style을 그대로 받아 자기 자신에 얹는다.
 * 레이아웃(flex 폭·min-height)을 쥔 요소를 한 겹 더 감싸면 그 계산이 깨지기 때문이다.
 */
const OFFSETS: Record<Dir, (n: number) => { x: string; y: string }> = {
  up: (n) => ({ x: "0", y: `${n}px` }),
  down: (n) => ({ x: "0", y: `${-n}px` }),
  left: (n) => ({ x: `${-n}px`, y: "0" }),
  right: (n) => ({ x: `${n}px`, y: "0" }),
};

const BlurFade = forwardRef<
  HTMLDivElement,
  {
    children: ReactNode;
    /** 시작 지연(s) — 여러 개를 조금씩 밀어 순서를 만든다 */
    delay?: number;
    duration?: number;
    /** 비켜서는 거리(px) */
    offset?: number;
    /** 어느 쪽에서 들어오는가 */
    direction?: Dir;
    blur?: string;
    style?: CSSProperties;
    className?: string;
  } & Record<`data-${string}`, unknown>
>(function BlurFade(
  { children, delay = 0, duration = 0.8, offset = 16, direction = "up", blur = "8px", style, className, ...rest },
  ref
) {
  const { x, y } = OFFSETS[direction](offset);
  return (
    <div
      ref={ref}
      className={className}
      style={{
        ...style,
        // 커스텀 속성은 타입상 CSSProperties에 없어 캐스팅한다
        ["--bf-x" as string]: x,
        ["--bf-y" as string]: y,
        ["--bf-blur" as string]: blur,
        animation: `blurFadeIn ${duration}s cubic-bezier(.16,1,.3,1) ${delay}s both`,
      }}
      {...rest}
    >
      {children}
    </div>
  );
});

export default BlurFade;
