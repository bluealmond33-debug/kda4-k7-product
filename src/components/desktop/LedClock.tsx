import { useEffect, useState } from "react";
import { css } from "../../lib/css";
import "dseg/css/dseg.css";

/**
 * LCD 디지털 시계 (라이트 · 온에어 문법) — 실물 벽걸이 LCD처럼 모든 정보가
 * 한 직사각형 패널 안에: 좌 = AM/PM + 시:분 + 초, 우 = DATE · DAY · TEMP 3칸 스택.
 * 점등 세그먼트 = 잉크(검정), 꺼진 세그먼트 = 연회색 고스트. 패널은 살짝 파인(inset) LCD 면.
 * 날씨: Open-Meteo(무키·실측) SEOUL 고정, 10분 갱신. 폰트: DSEG7/DSEG14(오픈소스).
 */

const SEG7 = "'DSEG7-Classic',monospace";
const SEG14 = "'DSEG14-Classic',monospace";
const INK = "var(--gray-1000)"; // 점등
const INK_DIM = "var(--gray-700)"; // 보조 점등(초·°C·날씨)
const GHOST = "rgba(22,20,17,.08)"; // 꺼진 세그먼트
const LABEL = "var(--gray-500)";
const FONT = "'Geist Sans','Pretendard',sans-serif";

const DAY_EN = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];

/** Open-Meteo weather_code → 14세그 영문 코드(≤5자) */
function weatherSeg(code: number): string {
  if (code === 0) return "SUNNY";
  if (code <= 3) return "CLDY";
  if (code === 45 || code === 48) return "FOG";
  if (code <= 57) return "DRZL";
  if (code <= 67) return "RAIN";
  if (code <= 77) return "SNOW";
  if (code <= 86) return "SHWR";
  return "STORM";
}

/** 세그먼트 텍스트 — 고스트(전점등)를 깔고 위에 실제 값을 겹친다. '!' = 빈 칸(고스트만) */
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
    <span style={{ position: "relative", display: "inline-block", fontFamily: font, fontSize: size, lineHeight: 1, fontWeight: "bold" }}>
      <span style={{ color: GHOST }}>{ghost}</span>
      <span style={{ position: "absolute", inset: 0, color }}>{text}</span>
    </span>
  );
}

/** 우측 스택 셀 — 실물 LCD의 구획: 상단에 작은 라벨, 아래 세그먼트 값 */
function Cell({ label, children, last = false }: { label: string; children: React.ReactNode; last?: boolean }) {
  return (
    <div style={css("padding:15px 22px 16px" + (last ? "" : ";border-bottom:1.5px solid var(--gray-300)"))}>
      <div style={{ fontFamily: FONT, fontWeight: 700, fontSize: 11, letterSpacing: 2, color: LABEL, marginBottom: 7 }}>{label}</div>
      {children}
    </div>
  );
}

export default function LedClock({ dimmed = false }: { dimmed?: boolean }) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(t);
  }, []);

  // SEOUL 실시간 날씨 — Open-Meteo 실측, 10분 갱신
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
  const dateStr = `${now.getMonth() + 1}/${now.getDate()}`;
  const tempStr = wx ? (wx.temp < 0 ? "-" : "") + Math.abs(wx.temp) : "--";

  return (
    /* LCD 패널 — 모든 정보가 한 직사각형 안에. 살짝 파인 면(inset)과 얇은 베젤 */
    <div
      style={{
        ...css(
          "display:flex;align-items:stretch;border-radius:22px;background:var(--gray-100);box-shadow:inset 0 2px 12px rgba(22,20,17,.05);overflow:hidden;transition:opacity .3s"
        ),
        opacity: dimmed ? 0.55 : 1,
      }}
    >
      {/* ── 좌: AM/PM + 시:분 + 초 ── */}
      <div style={css("display:flex;align-items:center;gap:16px;padding:44px 40px 44px 34px")}>
        <div style={css("display:flex;flex-direction:column;gap:8px;align-self:flex-start;padding-top:4px")}>
          <span style={{ fontFamily: SEG14, fontSize: 24, fontWeight: "bold", color: isAm ? INK : GHOST }}>AM</span>
          <span style={{ fontFamily: SEG14, fontSize: 24, fontWeight: "bold", color: !isAm ? INK : GHOST }}>PM</span>
        </div>
        <Seg text={hh} ghost="88" font={SEG7} size={172} />
        {/* 콜론 — 1초 점멸 */}
        <span style={{ position: "relative", fontFamily: SEG7, fontSize: 172, lineHeight: 1, fontWeight: "bold" }}>
          <span style={{ color: GHOST }}>:</span>
          <span style={{ position: "absolute", inset: 0, color: INK, opacity: colonOn ? 1 : 0, transition: "opacity .12s" }}>:</span>
        </span>
        <Seg text={mm} ghost="88" font={SEG7} size={172} />
        <div style={css("align-self:flex-end;padding-bottom:6px")}>
          <Seg text={ss} ghost="88" font={SEG7} size={40} color={INK_DIM} />
        </div>
      </div>

      {/* ── 우: DATE · DAY · TEMP 스택 — 구분선으로 나뉜 실물 LCD 구획 ── */}
      <div style={css("display:flex;flex-direction:column;justify-content:center;border-left:1.5px solid var(--gray-300);min-width:225px")}>
        <Cell label="DATE">
          <Seg text={dateStr} ghost={dateStr.replace(/\d/g, "8")} font={SEG14} size={44} />
        </Cell>
        <Cell label="DAY">
          <Seg text={DAY_EN[now.getDay()]} ghost="~~~" font={SEG14} size={44} />
        </Cell>
        <Cell label="TEMP · SEOUL" last>
          <div style={css("display:flex;align-items:flex-start;gap:7px")}>
            <Seg text={tempStr} ghost={tempStr.replace(/[0-9-]/g, "8")} font={SEG7} size={44} />
            <span style={{ fontFamily: SEG14, fontSize: 20, fontWeight: "bold", color: INK_DIM, marginTop: 2 }}>°C</span>
          </div>
          <div style={css("margin-top:8px")}>
            <Seg text={(wx ? weatherSeg(wx.code) : "").padEnd(5, "!")} ghost="~~~~~" font={SEG14} size={21} color={INK_DIM} />
          </div>
        </Cell>
      </div>
    </div>
  );
}
