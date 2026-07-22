import { useEffect, useState } from "react";
import { css } from "../../lib/css";
import "dseg/css/dseg.css";

/**
 * 실물 LED 디지털 시계 — 검은 패널 + 붉은 7세그먼트, 꺼진 세그먼트(고스트)가 회색으로 비친다.
 * 좌: AM/PM + 시:분(콜론 깜빡임) + 초 · 우: DAY(요일) + TEMP(실시간 기온·날씨).
 * 날씨는 Open-Meteo(무키·실측)를 브라우저 위치(거부/실패 시 서울)로 조회, 10분마다 갱신.
 * 폰트: DSEG7/DSEG14 Classic(오픈소스) — 세그먼트 고스트는 전점등 문자('8'/'~') 레이어.
 */

const SEG7 = "'DSEG7-Classic',monospace";
const SEG14 = "'DSEG14-Classic',monospace";
const LED = "#ff2d1e"; // 점등 세그먼트
const LED_DIM = "rgba(255,45,30,.55)"; // 보조 점등(라벨)
const GHOST = "rgba(160,160,160,.14)"; // 꺼진 세그먼트 — 회색으로 살짝
const GLOW = "0 0 18px rgba(255,45,30,.35)";

const DAY_EN = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];

/** Open-Meteo weather_code → 짧은 한글 라벨 */
function weatherLabel(code: number): string {
  if (code === 0) return "맑음";
  if (code <= 2) return "구름 조금";
  if (code === 3) return "흐림";
  if (code === 45 || code === 48) return "안개";
  if (code <= 57) return "이슬비";
  if (code <= 67) return "비";
  if (code <= 77) return "눈";
  if (code <= 82) return "소나기";
  if (code <= 86) return "소낙눈";
  return "뇌우";
}

/** 세그먼트 텍스트 — 같은 자리에 고스트(전점등)를 깔고 위에 실제 값을 겹친다 */
function Seg({
  text,
  ghost,
  font,
  size,
  color = LED,
  glow = true,
}: {
  text: string;
  ghost: string;
  font: string;
  size: number;
  color?: string;
  glow?: boolean;
}) {
  return (
    <span style={{ position: "relative", display: "inline-block", fontFamily: font, fontSize: size, lineHeight: 1 }}>
      <span style={{ color: GHOST }}>{ghost}</span>
      <span
        style={{
          position: "absolute",
          inset: 0,
          color,
          textShadow: glow ? GLOW : undefined,
        }}
      >
        {text}
      </span>
    </span>
  );
}

export default function LedClock({ dimmed = false }: { dimmed?: boolean }) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(t);
  }, []);

  // 실시간 날씨 — 위치(허용 시) 또는 서울 좌표로 Open-Meteo 조회
  const [wx, setWx] = useState<{ temp: number; code: number } | null>(null);
  useEffect(() => {
    let alive = true;
    const load = (lat: number, lon: number) => {
      fetch(
        `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,weather_code&timezone=auto`
      )
        .then((r) => r.json())
        .then((d) => {
          if (alive && d?.current)
            setWx({ temp: Math.round(d.current.temperature_2m), code: d.current.weather_code });
        })
        .catch(() => {});
    };
    const seoul = () => load(37.5665, 126.978);
    let done = false;
    const timer = window.setTimeout(() => {
      if (!done) seoul();
    }, 3000);
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          done = true;
          window.clearTimeout(timer);
          load(pos.coords.latitude, pos.coords.longitude);
        },
        () => {
          done = true;
          window.clearTimeout(timer);
          seoul();
        },
        { timeout: 2500, maximumAge: 600000 }
      );
    } else seoul();
    const refresh = window.setInterval(seoul, 600000); // 10분 갱신
    return () => {
      alive = false;
      window.clearTimeout(timer);
      window.clearInterval(refresh);
    };
  }, []);

  const h24 = now.getHours();
  const isAm = h24 < 12;
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  const hh = (h12 < 10 ? "!" : "") + h12; // DSEG '!' = 빈 자리(고스트만) — 한 자리 시는 앞칸을 끈다
  const mm = (now.getMinutes() < 10 ? "0" : "") + now.getMinutes();
  const ss = (now.getSeconds() < 10 ? "0" : "") + now.getSeconds();
  const colonOn = now.getSeconds() % 2 === 0;
  const tempStr = wx ? String(Math.abs(wx.temp)) : "--";

  return (
    <div
      style={{
        ...css(
          "position:relative;border-radius:26px;background:#0b0b0d;padding:12px;box-shadow:0 30px 70px rgba(0,0,0,.45), inset 0 1px 0 rgba(255,255,255,.06);transition:opacity .3s"
        ),
        opacity: dimmed ? 0.55 : 1,
      }}
    >
      {/* 스크린 패널 */}
      <div style={css("position:relative;border-radius:16px;background:#050505;padding:46px 54px 42px;overflow:hidden")}>
        {/* 유리 반사 — 실물의 사선 하이라이트 */}
        <div style={css("position:absolute;inset:0;background:linear-gradient(115deg,rgba(255,255,255,.055) 0%,rgba(255,255,255,.015) 34%,transparent 55%);pointer-events:none")} />

        <div style={css("display:flex;align-items:stretch;gap:44px")}>
          {/* ── 좌: AM/PM + 시:분 + 초 ── */}
          <div style={css("display:flex;flex-direction:column")}>
            <div style={css("display:flex;align-items:flex-start;gap:16px")}>
              <div style={css("display:flex;flex-direction:column;gap:8px;padding-top:6px")}>
                <span style={{ fontFamily: SEG14, fontSize: 22, color: isAm ? LED : GHOST, textShadow: isAm ? GLOW : undefined }}>AM</span>
                <span style={{ fontFamily: SEG14, fontSize: 22, color: !isAm ? LED : GHOST, textShadow: !isAm ? GLOW : undefined }}>PM</span>
              </div>
              <Seg text={hh} ghost="88" font={SEG7} size={148} />
              {/* 콜론 — 1초 간격 점멸. 고스트는 항상 비친다 */}
              <span style={{ position: "relative", fontFamily: SEG7, fontSize: 148, lineHeight: 1 }}>
                <span style={{ color: GHOST }}>:</span>
                <span style={{ position: "absolute", inset: 0, color: LED, textShadow: GLOW, opacity: colonOn ? 1 : 0, transition: "opacity .12s" }}>:</span>
              </span>
              <Seg text={mm} ghost="88" font={SEG7} size={148} />
              <div style={css("align-self:flex-end;padding-bottom:8px;margin-left:6px")}>
                <Seg text={ss} ghost="88" font={SEG7} size={40} color={LED_DIM} glow={false} />
              </div>
            </div>
          </div>

          {/* 세로 구분 — 패널 위 은은한 선 */}
          <div style={css("width:1px;background:rgba(255,255,255,.06)")} />

          {/* ── 우: DAY / TEMP ── */}
          <div style={css("display:flex;flex-direction:column;justify-content:space-between;padding:2px 0")}>
            <div>
              <div style={{ fontFamily: "'Geist Sans','Pretendard',sans-serif", fontWeight: 700, fontSize: 13, letterSpacing: 2, color: LED_DIM, marginBottom: 8 }}>DAY</div>
              <Seg text={DAY_EN[now.getDay()]} ghost="~~~" font={SEG14} size={54} />
            </div>
            <div>
              <div style={{ fontFamily: "'Geist Sans','Pretendard',sans-serif", fontWeight: 700, fontSize: 13, letterSpacing: 2, color: LED_DIM, margin: "16px 0 8px" }}>TEMP</div>
              <div style={css("display:flex;align-items:flex-start;gap:8px")}>
                {wx && wx.temp < 0 && <span style={{ fontFamily: SEG7, fontSize: 54, color: LED, textShadow: GLOW }}>-</span>}
                <Seg text={tempStr} ghost="88" font={SEG7} size={54} />
                <span style={{ fontFamily: SEG14, fontSize: 26, color: LED, textShadow: GLOW, marginTop: 2 }}>°C</span>
              </div>
              <div style={{ fontFamily: "'Geist Sans','Pretendard',sans-serif", fontWeight: 600, fontSize: 12.5, color: LED_DIM, marginTop: 9, letterSpacing: 1 }}>
                {wx ? weatherLabel(wx.code) : "수신 중…"}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
