import { useEffect, useState } from "react";
import { css } from "../../lib/css";
import "dseg/css/dseg.css";

/**
 * 디지털 시계 (라이트 · 온에어 문법) — 실물 LED의 세그먼트 문법을 우리 UI 색으로.
 * 점등 세그먼트 = 잉크(검정), 꺼진 세그먼트 = 연회색 고스트. 패널·글로우 없음(빛 금지).
 * 좌: AM/PM + 시:분(콜론 점멸) + 초 · 우: DAY(요일) + TEMP(서울 실시간 기온·날씨).
 * 날씨: Open-Meteo(무키·실측) 서울 고정, 10분 갱신 — 상태는 14세그 영문 코드로 표시.
 * 폰트: DSEG7/DSEG14 Classic(오픈소스) — 고스트는 전점등 문자('8'/'~') 레이어.
 */

const SEG7 = "'DSEG7-Classic',monospace";
const SEG14 = "'DSEG14-Classic',monospace";
const INK = "var(--gray-1000)"; // 점등
const INK_DIM = "var(--gray-700)"; // 보조 점등(초·°C)
const GHOST = "rgba(22,20,17,.08)"; // 꺼진 세그먼트 — 연회색으로 살짝
const LABEL = "var(--gray-600)";

const DAY_EN = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];

/** Open-Meteo weather_code → 14세그 영문 코드(≤5자) + 한글 라벨 */
function weatherOf(code: number): { seg: string; ko: string } {
  if (code === 0) return { seg: "SUNNY", ko: "맑음" };
  if (code <= 2) return { seg: "CLDY", ko: "구름 조금" };
  if (code === 3) return { seg: "CLDY", ko: "흐림" };
  if (code === 45 || code === 48) return { seg: "FOG", ko: "안개" };
  if (code <= 57) return { seg: "DRZL", ko: "이슬비" };
  if (code <= 67) return { seg: "RAIN", ko: "비" };
  if (code <= 77) return { seg: "SNOW", ko: "눈" };
  if (code <= 82) return { seg: "SHWR", ko: "소나기" };
  if (code <= 86) return { seg: "SNOW", ko: "소낙눈" };
  return { seg: "STORM", ko: "뇌우" };
}

/** 세그먼트 텍스트 — 같은 자리에 고스트(전점등)를 깔고 위에 실제 값을 겹친다.
 *  lit의 '!'는 빈 칸(고스트만 비침) — DSEG에서 세그먼트가 모두 꺼진 문자. */
function Seg({
  text,
  ghost,
  font,
  size,
  color = INK,
}: {
  text: string;
  ghost: string;
  font: string;
  size: number;
  color?: string;
}) {
  return (
    <span style={{ position: "relative", display: "inline-block", fontFamily: font, fontSize: size, lineHeight: 1 }}>
      <span style={{ color: GHOST }}>{ghost}</span>
      <span style={{ position: "absolute", inset: 0, color }}>{text}</span>
    </span>
  );
}

export default function LedClock({ dimmed = false }: { dimmed?: boolean }) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(t);
  }, []);

  // 서울 실시간 날씨 — Open-Meteo 실측, 10분 갱신
  const [wx, setWx] = useState<{ temp: number; code: number } | null>(null);
  useEffect(() => {
    let alive = true;
    const load = () => {
      fetch(
        "https://api.open-meteo.com/v1/forecast?latitude=37.5665&longitude=126.978&current=temperature_2m,weather_code&timezone=Asia%2FSeoul"
      )
        .then((r) => r.json())
        .then((d) => {
          if (alive && d?.current)
            setWx({ temp: Math.round(d.current.temperature_2m), code: d.current.weather_code });
        })
        .catch(() => {});
    };
    load();
    const t = window.setInterval(load, 600000);
    return () => {
      alive = false;
      window.clearInterval(t);
    };
  }, []);

  const h24 = now.getHours();
  const isAm = h24 < 12;
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  const hh = (h12 < 10 ? "!" : "") + h12; // 한 자리 시 — 앞칸은 고스트만
  const mm = (now.getMinutes() < 10 ? "0" : "") + now.getMinutes();
  const ss = (now.getSeconds() < 10 ? "0" : "") + now.getSeconds();
  const colonOn = now.getSeconds() % 2 === 0;
  const tempStr = wx ? String(Math.abs(wx.temp)) : "--";
  const weather = wx ? weatherOf(wx.code) : null;
  const wxSeg = (weather?.seg ?? "!!!!!").padEnd(5, "!");

  return (
    <div style={{ ...css("display:flex;align-items:stretch;gap:44px;transition:opacity .3s"), opacity: dimmed ? 0.55 : 1 }}>
      {/* ── 좌: AM/PM + 시:분 + 초 ── */}
      <div style={css("display:flex;align-items:flex-start;gap:18px")}>
        <div style={css("display:flex;flex-direction:column;gap:9px;padding-top:8px")}>
          <span style={{ fontFamily: SEG14, fontSize: 23, color: isAm ? INK : GHOST }}>AM</span>
          <span style={{ fontFamily: SEG14, fontSize: 23, color: !isAm ? INK : GHOST }}>PM</span>
        </div>
        <Seg text={hh} ghost="88" font={SEG7} size={150} />
        {/* 콜론 — 1초 점멸, 고스트는 항상 비친다 */}
        <span style={{ position: "relative", fontFamily: SEG7, fontSize: 150, lineHeight: 1 }}>
          <span style={{ color: GHOST }}>:</span>
          <span style={{ position: "absolute", inset: 0, color: INK, opacity: colonOn ? 1 : 0, transition: "opacity .12s" }}>:</span>
        </span>
        <Seg text={mm} ghost="88" font={SEG7} size={150} />
        <div style={css("align-self:flex-end;padding-bottom:9px;margin-left:8px")}>
          <Seg text={ss} ghost="88" font={SEG7} size={38} color={INK_DIM} />
        </div>
      </div>

      {/* 세로 구분 — 은은한 회색 선 */}
      <div style={css("width:1.5px;background:var(--gray-200);border-radius:1px")} />

      {/* ── 우: DAY / TEMP ── */}
      <div style={css("display:flex;flex-direction:column;justify-content:space-between;padding:4px 0")}>
        <div>
          <div style={{ fontFamily: "'Geist Sans','Pretendard',sans-serif", fontWeight: 700, fontSize: 12.5, letterSpacing: 2, color: LABEL, marginBottom: 8 }}>DAY</div>
          <Seg text={DAY_EN[now.getDay()]} ghost="~~~" font={SEG14} size={48} />
        </div>
        <div>
          <div style={{ fontFamily: "'Geist Sans','Pretendard',sans-serif", fontWeight: 700, fontSize: 12.5, letterSpacing: 2, color: LABEL, margin: "14px 0 8px" }}>
            TEMP <span style={{ fontWeight: 500, letterSpacing: 0, color: "var(--gray-500)" }}>· 서울</span>
          </div>
          <div style={css("display:flex;align-items:flex-start;gap:9px")}>
            {wx && wx.temp < 0 && <span style={{ fontFamily: SEG7, fontSize: 48, color: INK }}>-</span>}
            <Seg text={tempStr} ghost="88" font={SEG7} size={48} />
            <span style={{ fontFamily: SEG14, fontSize: 22, color: INK_DIM, marginTop: 2 }}>°C</span>
          </div>
          {/* 날씨 상태 — 14세그 영문 코드(디지털 시계 문법) + 작은 한글 보조 라벨 */}
          <div style={css("margin-top:12px")}>
            <Seg text={wxSeg} ghost="~~~~~" font={SEG14} size={24} color={INK_DIM} />
            <div style={{ fontFamily: "'Geist Sans','Pretendard',sans-serif", fontWeight: 500, fontSize: 11.5, color: "var(--gray-500)", marginTop: 5 }}>
              {weather?.ko ?? "수신 중…"}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
