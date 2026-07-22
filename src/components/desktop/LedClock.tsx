import { useEffect, useState } from "react";
import {
  Sun,
  CloudSun,
  Cloud,
  CloudRain,
  CloudSnow,
  CloudLightning,
  Droplets,
  type LucideIcon,
} from "lucide-react";
import { css } from "../../lib/css";
import "dseg/css/dseg.css";

/**
 * 디지털 시계 (라이트 세그먼트 · 온에어 문법) — "실물 세그먼트 시계" 컨셉.
 * 잉크 2단계만: 켜진 세그먼트=검정, 꺼진 세그먼트=옅은 고스트 (중간 회색 없음).
 * 위계는 오직 크기로 — 시간이 주인공(최대), 날씨·PM·초는 같은 검정으로 작게.
 * 위=날씨(아이콘·기온·습도) · 시간 오른쪽=PM·초 그룹. 날짜·요일은 상단 헤더에 있어 뺐다.
 * °C·%·구름조금은 켜진 값이 아니라 '인쇄 라벨' — 옅은 회색 산세리프.
 * 날씨: Open-Meteo(무키·실측) 서울, 10분 갱신. 폰트: DSEG7/DSEG14 Bold(오픈소스).
 */

const SEG7 = "'DSEG7-Classic',monospace";
const SEG14 = "'DSEG14-Classic',monospace";
const INK = "var(--gray-1000)";
const GHOST = "rgba(22,20,17,.08)";
const ICON_GHOST = "var(--gray-200)"; // 꺼진 날씨 아이콘
const LABEL = "var(--gray-500)";
const SANS = "'Geist Sans','Pretendard',sans-serif";


/** 실물 기상 LCD처럼 아이콘을 다 깔아두고 현재 날씨만 켠다(나머지는 고스트로 끔). */
const WX_ICONS: LucideIcon[] = [Sun, CloudSun, Cloud, CloudRain, CloudSnow, CloudLightning];
/** Open-Meteo weather_code → 켜둘 아이콘 인덱스 (WX_ICONS 기준) */
function activeWxIndex(code: number): number {
  if (code === 0) return 0; // 맑음
  if (code <= 2) return 1; // 구름 조금
  if (code === 3 || code === 45 || code === 48) return 2; // 흐림·안개
  if (code <= 67) return 3; // 이슬비·비
  if (code <= 77) return 4; // 눈
  if (code <= 86) return 3; // 소나기
  return 5; // 뇌우
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

export default function LedClock({ dimmed = false }: { dimmed?: boolean }) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(t);
  }, []);

  // 서울 실시간 날씨 — Open-Meteo 실측(기온·습도·상태), 10분 갱신
  const [wx, setWx] = useState<{ temp: number; humidity: number; code: number } | null>(null);
  useEffect(() => {
    let alive = true;
    const load = () => {
      fetch(
        "https://api.open-meteo.com/v1/forecast?latitude=37.5665&longitude=126.978&current=temperature_2m,relative_humidity_2m,weather_code&timezone=Asia%2FSeoul"
      )
        .then((r) => r.json())
        .then((d) => {
          if (alive && d?.current)
            setWx({
              temp: Math.round(d.current.temperature_2m),
              humidity: Math.round(d.current.relative_humidity_2m),
              code: d.current.weather_code,
            });
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
  const tempStr = wx ? (wx.temp < 0 ? "-" : "") + Math.abs(wx.temp) : "--";
  const humStr = wx ? String(wx.humidity) : "--";
  const wxIdx = wx ? activeWxIndex(wx.code) : -1;

  return (
    <div style={{ ...css("display:flex;flex-direction:column;align-items:center;gap:22px;transition:opacity .3s"), opacity: dimmed ? 0.55 : 1 }}>
      {/* ── 위: 날씨 아이콘 행(전부 깔고 현재만 켜짐) · 기온 · 습도 — 값은 전부 같은 검정, 단위만 라벨 ── */}
      <div style={css("display:flex;align-items:center;gap:16px")}>
        <div style={css("display:flex;align-items:center;gap:8px")}>
          {WX_ICONS.map((Ic, i) => (
            <Ic key={i} size={26} strokeWidth={2.4} color={i === wxIdx ? INK : ICON_GHOST} />
          ))}
        </div>
        <span style={css("width:1.5px;height:22px;background:var(--gray-200);border-radius:1px")} />
        <div style={css("display:flex;align-items:flex-start;gap:5px")}>
          <Seg text={tempStr} ghost={tempStr.replace(/[0-9-]/g, "8")} font={SEG7} size={36} />
          <span style={{ fontFamily: SANS, fontSize: 15, fontWeight: 600, color: LABEL, marginTop: 3 }}>°C</span>
        </div>
        <Droplets size={24} strokeWidth={2.2} color={INK} />
        <div style={css("display:flex;align-items:flex-start;gap:5px")}>
          <Seg text={humStr} ghost={humStr.replace(/[0-9]/g, "8")} font={SEG7} size={36} />
          <span style={{ fontFamily: SANS, fontSize: 15, fontWeight: 600, color: LABEL, marginTop: 3 }}>%</span>
        </div>
      </div>

      {/* ── 시계 — 시간이 주인공(최대). 오른쪽에 PM·초를 한 덩어리로 묶는다(같은 잉크, 위계는 크기로).
              날짜·요일은 상단 헤더에 이미 있어 여기서 뺐다(중복 제거) ── */}
      <div style={css("display:flex;align-items:center;gap:20px")}>
        <Seg text={hh} ghost="88" font={SEG7} size={196} />
        {/* 콜론 — 1초 점멸 */}
        <span style={{ position: "relative", fontFamily: SEG7, fontSize: 196, lineHeight: 1, fontWeight: "bold" }}>
          <span style={{ color: GHOST }}>:</span>
          <span style={{ position: "absolute", inset: 0, color: INK, opacity: colonOn ? 1 : 0, transition: "opacity .12s" }}>:</span>
        </span>
        <Seg text={mm} ghost="88" font={SEG7} size={196} />
        {/* PM·초 그룹 — 시(時) 높이에 맞춰 위=AM/PM, 아래=초 (실물 시계 우측 스택) */}
        <div style={css("display:flex;flex-direction:column;justify-content:space-between;align-self:stretch;padding:20px 0")}>
          <Seg text={isAm ? "AM" : "PM"} ghost="~~" font={SEG14} size={36} />
          <Seg text={ss} ghost="88" font={SEG7} size={36} />
        </div>
      </div>
    </div>
  );
}
