import { css } from "../../lib/css";

/**
 * 감정온도 막대 — 하나의 그라데이션 축 위에 '지금 값'이 떠 있다.
 *
 * 왜 신호등(점 3개)이 아닌가: 점 세 개는 세 상태 중 하나만 말한다. 감정은 계단이 아니라
 * 눈금 위를 오가는 값이고, 상담사가 알아야 하는 건 "지금 어디쯤이며 어느 쪽으로 가는가"다.
 * 하나의 축으로 그리면 위치가 그 자체로 정도를 말하고, 평소 기준선과의 거리가 '얼마나
 * 올라왔는지'를 보여준다 — 같은 자리에 점을 세 개 켜는 것보다 읽을 정보가 많다.
 *
 * 마커는 원이 아니라 **페이더 썸**이다: 흰 캡슐 안에 화자 색 코어가 들어 있다.
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
      {/* 평소 기준선 — 축을 가로지르는 얇은 흰 눈금. 마커가 이 선에서 얼마나 떨어졌나가 신호다 */}
      {basePct != null && (
        <span
          style={css(
            "position:absolute;top:-2px;bottom:-2px;width:2px;border-radius:2px;background:rgba(255,255,255,.9);left:" +
              clamp(basePct) +
              "%"
          )}
        />
      )}
      {/* 페이더 썸 — 흰 캡슐 + 색 코어 */}
      <span
        style={css(
          "position:absolute;top:50%;display:flex;align-items:center;justify-content:center;box-sizing:border-box;width:9px;border-radius:9999px;background:var(--onair-surface);border:1px solid rgba(16,24,40,.10);box-shadow:0 1px 4px rgba(16,24,40,.28);transform:translate(-50%,-50%);transition:left .4s cubic-bezier(.2,.8,.2,1);height:" +
            thumbH +
            "px;left:" +
            clamp(pct) +
            "%"
        )}
      >
        <span
          style={css(
            "width:3px;border-radius:9999px;background:" + color + ";height:" + (thumbH - 7) + "px"
          )}
        />
      </span>
    </div>
  );
}
