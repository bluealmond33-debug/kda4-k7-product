import { useEffect, useState } from "react";
import {
  Sun,
  CloudSun,
  Cloud,
  CloudFog,
  CloudDrizzle,
  CloudRain,
  CloudSnow,
  CloudLightning,
  Droplets,
  type LucideIcon,
} from "lucide-react";
import { css } from "../../lib/css";
import "dseg/css/dseg.css";

/**
 * 디지털 시계 (라이트 세그먼트 · 온에어 문법) — 시계가 정중앙 히어로.
 * 위 한 줄 = 날씨(아이콘)·기온·습도 · 아래 한 줄 = 요일·날짜. 초는 없다(대기 화면 잔노이즈 제거).
 * DATE는 상단 헤더의 '7월 N일(요일)'과 중복되지 않게 세그먼트 M/D로만.
 * 점등 = 잉크(검정, 볼드 세그먼트), 꺼진 세그먼트 = 연회색 고스트.
 * 날씨: Open-Meteo(무키·실측) 서울, 10분 갱신. 폰트: DSEG7/DSEG14 Bold(오픈소스).
 */

const SEG7 = "'DSEG7-Classic',monospace";
const SEG14 = "'DSEG14-Classic',monospace";
const INK = "var(--gray-1000)";
const INK_DIM = "var(--gray-700)";
const GHOST = "rgba(22,20,17,.08)";
const LABEL = "var(--gray-500)";

const DAY_EN = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];

/** Open-Meteo weather_code → 해/구름 아이콘 + 한글 라벨 */
function weatherOf(code: number): { Icon: LucideIcon; ko: string } {
  if (code === 0) return { Icon: Sun, ko: "맑음" };
  if (code <= 2) return { Icon: CloudSun, ko: "구름 조금" };
  if (code === 3) return { Icon: Cloud, ko: "흐림" };
  if (code === 45 || code === 48) return { Icon: CloudFog, ko: "안개" };
  if (code <= 57) return { Icon: CloudDrizzle, ko: "이슬비" };
  if (code <= 67) return { Icon: CloudRain, ko: "비" };
  if (code <= 77) return { Icon: CloudSnow, ko: "눈" };
  if (code <= 82) return { Icon: CloudRain, ko: "소나기" };
  if (code <= 86) return { Icon: CloudSnow, ko: "소낙눈" };
  return { Icon: CloudLightning, ko: "뇌우" };
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
  const colonOn = now.getSeconds() % 2 === 0;
  const dateStr = `${now.getMonth() + 1}/${now.getDate()}`;
  const tempStr = wx ? (wx.temp < 0 ? "-" : "") + Math.abs(wx.temp) : "--";
  const humStr = wx ? String(wx.humidity) : "--";
  const weather = wx ? weatherOf(wx.code) : null;
  const WxIcon = weather?.Icon ?? Cloud;

  return (
    <div style={{ ...css("display:flex;flex-direction:column;align-items:center;gap:24px;transition:opacity .3s"), opacity: dimmed ? 0.55 : 1 }}>
      {/* ── 위: 날씨 · 기온 · 습도 (세그먼트 한 줄) ── */}
      <div style={css("display:flex;align-items:center;gap:16px")}>
        <div style={css("display:flex;align-items:center;gap:11px")}>
          <WxIcon size={38} strokeWidth={2.2} color={wx ? INK : "var(--gray-300)"} />
          <div style={css("display:flex;align-items:flex-start;gap:6px")}>
            <Seg text={tempStr} ghost={tempStr.replace(/[0-9-]/g, "8")} font={SEG7} size={40} />
            <span style={{ fontFamily: SEG14, fontSize: 19, fontWeight: "bold", color: INK_DIM, marginTop: 2 }}>°C</span>
          </div>
        </div>
        <span style={css("width:1.5px;height:26px;background:var(--gray-200);border-radius:1px")} />
        <div style={css("display:flex;align-items:center;gap:10px")}>
          <Droplets size={30} strokeWidth={2.2} color={INK_DIM} />
          <div style={css("display:flex;align-items:flex-start;gap:6px")}>
            <Seg text={humStr} ghost={humStr.replace(/[0-9]/g, "8")} font={SEG7} size={40} color={INK_DIM} />
            <span style={{ fontFamily: SEG14, fontSize: 19, fontWeight: "bold", color: INK_DIM, marginTop: 2 }}>%</span>
          </div>
        </div>
      </div>

      {/* ── 시계 — 정중앙 히어로 ── */}
      <div style={css("display:flex;align-items:center;gap:18px")}>
        <div style={css("display:flex;flex-direction:column;gap:10px;align-self:flex-start;padding-top:8px")}>
          <span style={{ fontFamily: SEG14, fontSize: 26, fontWeight: "bold", color: isAm ? INK : GHOST }}>AM</span>
          <span style={{ fontFamily: SEG14, fontSize: 26, fontWeight: "bold", color: !isAm ? INK : GHOST }}>PM</span>
        </div>
        <Seg text={hh} ghost="88" font={SEG7} size={196} />
        {/* 콜론 — 1초 점멸 */}
        <span style={{ position: "relative", fontFamily: SEG7, fontSize: 196, lineHeight: 1, fontWeight: "bold" }}>
          <span style={{ color: GHOST }}>:</span>
          <span style={{ position: "absolute", inset: 0, color: INK, opacity: colonOn ? 1 : 0, transition: "opacity .12s" }}>:</span>
        </span>
        <Seg text={mm} ghost="88" font={SEG7} size={196} />
      </div>

      {/* ── 아래: 요일 · 날짜 (세그먼트 한 줄) ── */}
      <div style={css("display:flex;align-items:center;gap:16px")}>
        <Seg text={DAY_EN[now.getDay()]} ghost="~~~" font={SEG14} size={44} />
        <span style={css("width:1.5px;height:30px;background:var(--gray-200);border-radius:1px")} />
        <Seg text={dateStr} ghost={dateStr.replace(/\d/g, "8")} font={SEG14} size={44} />
      </div>

      {/* 날씨 상태 한글 보조 라벨 — 작게 */}
      <div style={{ fontFamily: "'Geist Sans','Pretendard',sans-serif", fontWeight: 500, fontSize: 12.5, color: LABEL, marginTop: -8 }}>
        {weather?.ko ?? "날씨 수신 중…"}
      </div>
    </div>
  );
}
