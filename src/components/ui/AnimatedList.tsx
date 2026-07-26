import { Children, type ReactNode } from "react";

/**
 * 인입 리스트 (Magic UI AnimatedList 이식).
 *
 * 새 항목이 위에서 내려앉고 기존 항목은 자리를 내준다 — 관제에서 "방금 하나 들어왔다"를
 * 숫자가 바뀌는 것보다 먼저 알아채게 하는 장치다.
 *
 * framer-motion 없이: **React 키가 곧 등장 신호**다. 새로 mount된 항목만 CSS 애니메이션이
 * 한 번 돌고, 이미 있던 항목은 다시 돌지 않는다(리렌더마다 전부 다시 튀는 사고 방지).
 * 그래서 children의 key가 항목 정체성과 일치해야 한다 — 인덱스 키를 쓰면 목록이 밀릴 때
 * 엉뚱한 항목이 새 것처럼 튄다.
 *
 * `stagger`는 첫 렌더에서만 의미가 있다(한꺼번에 나타나는 목록을 차례로 흘려보낸다).
 */
export default function AnimatedList({
  children,
  stagger = 0,
  className,
}: {
  children: ReactNode;
  /** 항목 간 지연(ms) — 첫 렌더의 계단식 등장 */
  stagger?: number;
  className?: string;
}) {
  return (
    <>
      {Children.map(children, (child, i) => (
        <div className={"alistitem" + (className ? " " + className : "")} style={stagger ? { animationDelay: i * stagger + "ms" } : undefined}>
          {child}
        </div>
      ))}
    </>
  );
}
