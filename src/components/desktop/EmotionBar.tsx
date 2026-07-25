import { css } from "../../lib/css";

/**
 * 감정온도 막대 — 하나의 그라데이션 축 위에 '지금 값'이 떠 있다.
 *
 * 왜 신호등(점 3개)이 아닌가: 점 세 개는 세 상태 중 하나만 말한다. 감정은 계단이 아니라
 * 눈금 위를 오가는 값이고, 상담사가 알아야 하는 건 "지금 어디쯤이며 어느 쪽으로 가는가"다.
 * 하나의 축으로 그리면 위치가 그 자체로 정도를 말하고, 평소 기준선과의 거리가 '얼마나
 * 올라왔는지'를 보여준다 — 같은 자리에 점을 세 개 켜는 것보다 읽을 정보가 많다.
 *
 * 마커는 원이 아니라 세로 캡슐이다 — 가로 축에서 '가리키는 위치'가 원보다 정확히 읽힌다.
 * · 세로로 긴 캡슐이라 가로 축 위에서 '가리키는 위치'가 원보다 정확히 읽힌다(원은 면적이
 *   넓어 중심이 흐려진다).
 * · 흰 면 + 그림자로 축 위에 떠 있고, 색은 안쪽 코어에만 — ONAIR 문법대로 색은 의미에만
 *   쓰고 위계는 그림자가 만든다(발광·후광 없음).
 * · 방송 콘솔의 페이더를 닮아 "계기를 읽는다"는 감각이 남는다.
 */
export default function EmotionBar({
  pct,
  basePct,
  color,
  height = 8,
  title,
}: {
  /** 지금 값의 위치(0~100) */
  pct: number;
  /** 평소 기준선 위치(0~100) — 여기서 얼마나 벗어났는지가 상승/고조의 근거다 */
  basePct?: number;
  /** 마커 코어 색 — 감정 단계 색을 그대로 받는다 */
  color: string;
  /** 축 두께 */
  height?: number;
  title?: string;
}) {
  const clamp = (n: number) => Math.max(0, Math.min(100, n));
  const thumbH = height + 10;
  return (
    <div
      title={title}
      style={css(
        "position:relative;border-radius:9999px;height:" +
          height +
          "px;background:linear-gradient(90deg,var(--green-700) 0%,var(--green-700) 26%,var(--amber-700) 58%,var(--red-700) 100%)"
      )}
    >
      {/* 마커 — 잉크 캡슐 하나.
          전에는 흰 캡슐 안에 색 코어를 넣었는데, 흰 면이 초록·주황 위에서 배경과 뭉개져
          "어디를 가리키는지"가 안 읽혔다. 축이 이미 색을 다 쓰고 있으므로 마커는 색을 보태지
          않고 가장 어두운 잉크로 대비만 준다 — 축 어느 지점에 있든 또렷하게 보인다.
          흰 테두리 한 겹은 잉크가 진한 빨강 끝에서 배경에 먹히지 않게 띄워 준다. */}
      <span
        style={css(
          "position:absolute;top:50%;box-sizing:border-box;width:5px;border-radius:9999px;background:var(--gray-1000);border:1.5px solid var(--onair-surface);box-shadow:0 1px 3px rgba(16,24,40,.35);transform:translate(-50%,-50%);transition:left .4s cubic-bezier(.2,.8,.2,1);height:" +
            thumbH +
            "px;left:" +
            clamp(pct) +
            "%"
        )}
      />
    </div>
  );
}
