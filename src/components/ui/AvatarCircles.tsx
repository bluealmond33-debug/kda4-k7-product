import { css } from "../../lib/css";

export type AvatarState = "대기" | "통화" | "휴식";

/** 상태별 테두리 — 색은 테두리에만. 면을 채우면 알약·카드가 색 덩어리로 읽힌다(온에어 문법). */
const RING: Record<AvatarState, string> = {
  대기: "var(--green-700)",
  통화: "var(--blue-700)",
  휴식: "var(--gray-500)",
};

/**
 * 겹친 아바타 원 (Magic UI AvatarCircles 이식).
 *
 * 원본은 프로필 사진을 겹쳐 쌓지만, 여기 상담사는 사진이 없고 **이름도 최소 표시** 대상이라
 * 이니셜 원으로 대신한다. 사진을 쓰면 관제 화면이 인사 정보 열람 화면이 되어 버린다.
 *
 * 겹치는 이유는 장식이 아니라 밀도다 — 부서 카드 헤더에 상담사 6명을 나란히 놓으면
 * 정작 먼저 읽혀야 할 대기 건수를 밀어낸다. 겹쳐 쌓아 한 덩이로 만들고, 넘치면 +N으로 접는다.
 */
export default function AvatarCircles({
  people,
  max = 4,
  size = 20,
  overlap = 4,
}: {
  people: { name: string; state: AvatarState }[];
  /** 이 수를 넘으면 나머지는 +N 한 덩이로 접는다 */
  max?: number;
  size?: number;
  /** 겹침 폭(px) — 사진이 아니라 글자라 많이 겹치면 못 읽는다.
   *  다음 원의 흰 테두리가 앞 원의 글자를 덮지 않는 선이 4px다(원 20 · 글자 폭 ~10). */
  overlap?: number;
}) {
  const shown = people.slice(0, max);
  const rest = people.length - shown.length;
  const font = Math.round(size * 0.42);
  return (
    <span
      style={css("display:inline-flex;align-items:center;flex:none")}
      title={people.map((p) => p.name + " · " + p.state).join("\n")}
    >
      {shown.map((p, i) => (
        <span
          key={p.name}
          style={{
            ...css(
              "display:flex;align-items:center;justify-content:center;border-radius:9999px;background:var(--onair-surface);flex:none;font-family:'Avenir Next','Pretendard',sans-serif;font-weight:600"
            ),
            width: size,
            height: size,
            fontSize: font,
            color: p.state === "휴식" ? "var(--gray-600)" : "var(--gray-1000)",
            boxShadow: `0 0 0 1.5px ${RING[p.state]}, 0 0 0 2px var(--background-200)`,
            marginLeft: i === 0 ? 0 : -overlap,
            zIndex: shown.length - i,
            // 휴식은 한 겹 뒤로 물러난다 — 지금 콜을 받을 수 있는 사람이 앞에 서야 한다
            opacity: p.state === "휴식" ? 0.55 : 1,
          }}
        >
          {/* 한 글자만 — 두 글자를 넣으면 겹침에 왼쪽이 잘려 오히려 못 읽는다.
              성(김·이·박)은 겹치는 사람이 너무 많아 이름 끝 글자를 쓴다. 전체 이름은 title에 있다 */}
          {p.name.slice(-1)}
        </span>
      ))}
      {rest > 0 && (
        <span
          style={{
            ...css(
              "display:flex;align-items:center;justify-content:center;border-radius:9999px;background:var(--gray-100);flex:none;font-family:'Avenir Next','Pretendard',sans-serif;font-weight:700;color:var(--gray-800)"
            ),
            width: size,
            height: size,
            fontSize: Math.round(size * 0.38),
            boxShadow: "0 0 0 1.5px var(--gray-400), 0 0 0 2px var(--background-200)",
            marginLeft: -overlap,
          }}
        >
          +{rest}
        </span>
      )}
    </span>
  );
}
