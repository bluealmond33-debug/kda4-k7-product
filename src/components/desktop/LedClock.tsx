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

/** Open-Meteo weather_code → 한글 상태 설명 (상세 팝오버용) */
function wxLabel(code: number): string {
  if (code === 0) return "맑음";
  if (code === 1) return "대체로 맑음";
  if (code === 2) return "구름 조금";
  if (code === 3) return "흐림";
  if (code === 45 || code === 48) return "안개";
  if (code <= 55) return "이슬비";
  if (code <= 65) return "비";
  if (code <= 67) return "어는 비";
  if (code <= 77) return "눈";
  if (code <= 82) return "소나기";
  if (code <= 86) return "소낙눈";
  return "뇌우";
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

  // 서울 실시간 날씨 — Open-Meteo 실측(기온·습도·체감·풍속·강수·상태·최고최저), 10분 갱신
  const [wx, setWx] = useState<{
    temp: number;
    humidity: number;
    code: number;
    feels: number;
    wind: number;
    precip: number;
    tmax: number;
    tmin: number;
  } | null>(null);
  const [detailOpen, setDetailOpen] = useState(false); // 날씨 상세 팝오버
  useEffect(() => {
    let alive = true;
    const load = () => {
      fetch(
        "https://api.open-meteo.com/v1/forecast?latitude=37.5665&longitude=126.978&current=temperature_2m,relative_humidity_2m,apparent_temperature,weather_code,wind_speed_10m,precipitation&daily=temperature_2m_max,temperature_2m_min&timezone=Asia%2FSeoul"
      )
        .then((r) => r.json())
        .then((d) => {
          if (alive && d?.current)
            setWx({
              temp: Math.round(d.current.temperature_2m),
              humidity: Math.round(d.current.relative_humidity_2m),
              code: d.current.weather_code,
              feels: Math.round(d.current.apparent_temperature),
              wind: Math.round(d.current.wind_speed_10m),
              precip: Math.round((d.current.precipitation ?? 0) * 10) / 10,
              tmax: Math.round(d.daily?.temperature_2m_max?.[0] ?? d.current.temperature_2m),
              tmin: Math.round(d.daily?.temperature_2m_min?.[0] ?? d.current.temperature_2m),
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
      {/* ── 시계 — 시간이 주인공(최대). 오른쪽에 PM·초를 한 덩어리로 묶는다(같은 잉크, 위계는 크기로).
              날짜·요일은 상단 헤더에 이미 있어 여기서 뺐다(중복 제거) ── */}
      <div style={css("display:flex;align-items:center;gap:20px")}>
        {/* 좌측 균형 스페이서 — 오른쪽 PM·초 그룹과 동일 폭(invisible)으로 콜론을 진짜 중앙에 둔다.
            그래야 아래 날씨 줄의 가운데 바와 세로축이 정확히 맞는다 */}
        <div aria-hidden style={css("visibility:hidden;display:flex;flex-direction:column;justify-content:space-between;align-self:stretch;padding:20px 0")}>
          <Seg text={isAm ? "AM" : "PM"} ghost="~~" font={SEG14} size={36} />
          <Seg text={ss} ghost="88" font={SEG7} size={36} />
        </div>
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

      {/* ── 아래: 날씨 아이콘 행(전부 깔고 현재만 켜짐) · 기온 · 습도 — 값은 전부 같은 검정, 단위만 라벨 ──
              올리면(호버) 상세 팝오버가 열린다(체감·최고최저·풍속·강수) — 클릭·터치도 토글로 동작.
              컨테이너가 pointer-events:none이라 여기만 auto */}
      {/* 좌(아이콘)·우(온도·습도)를 같은 폭으로 나누고 가운데 바를 정중앙에 고정 */}
      <div
        style={css("position:relative")}
        onMouseEnter={wx ? () => setDetailOpen(true) : undefined}
        onMouseLeave={() => setDetailOpen(false)}
      >
        <div
          onClick={wx ? () => setDetailOpen((v) => !v) : undefined}
          title={wx ? "날씨 상세 보기" : undefined}
          style={css(
            "position:relative;display:flex;align-items:center;width:600px;border-radius:12px;padding:6px 10px;transition:background .18s;pointer-events:" +
              (wx ? "auto;cursor:pointer" : "none") +
              (detailOpen ? ";background:var(--gray-100)" : "")
          )}
        >
          {/* 상세 팝오버 — 날씨 바 "자신"을 기준으로 정중앙 바로 위에 (래퍼 폭과 무관).
              셸의 padding-bottom이 바와의 틈을 메워 호버가 끊기지 않는다 */}
          {detailOpen && wx && (
            <div
              style={{
                ...css("position:absolute;left:50%;bottom:100%;z-index:41;padding-bottom:8px;pointer-events:auto;cursor:default"),
                transform: "translateX(-50%)",
              }}
              onClick={(e) => e.stopPropagation()}
            >
              <div
                style={{
                  ...css(
                    "width:300px;background:var(--onair-surface);border:1px solid var(--gray-200);border-radius:14px;box-shadow:var(--sh-modal);padding:16px 18px;animation:dockUp .18s cubic-bezier(0.2,0.8,0.2,1)"
                  ),
                  fontFamily: SANS,
                }}
              >
                {/* 헤더 — 상태 + 현재 기온 */}
                <div style={css("display:flex;align-items:center;gap:10px;margin-bottom:14px")}>
                  {(() => {
                    const Ic = WX_ICONS[wxIdx] ?? Sun;
                    return <Ic size={30} strokeWidth={2.2} color={INK} />;
                  })()}
                  <div style={css("display:flex;flex-direction:column")}>
                    <span style={{ fontFamily: SANS, fontSize: 15, fontWeight: 700, color: "var(--gray-1000)" }}>{wxLabel(wx.code)}</span>
                    <span style={{ fontFamily: SANS, fontSize: 12, fontWeight: 500, color: LABEL }}>서울 · 지금</span>
                  </div>
                  <div style={css("flex:1")} />
                  <span style={{ fontFamily: SANS, fontSize: 28, fontWeight: 800, letterSpacing: "-1px", color: "var(--gray-1000)" }}>{wx.temp}°</span>
                </div>
                {/* 상세 그리드 */}
                <div style={css("display:grid;grid-template-columns:1fr 1fr;gap:9px 14px")}>
                  <WxStat label="체감" value={`${wx.feels}°`} />
                  <WxStat label="습도" value={`${wx.humidity}%`} />
                  <WxStat label="최고 · 최저" value={`${wx.tmax}° · ${wx.tmin}°`} />
                  <WxStat label="바람" value={`${wx.wind} km/h`} />
                  <WxStat label="강수" value={`${wx.precip} mm`} />
                </div>
                <div style={{ fontFamily: SANS, fontSize: 10.5, fontWeight: 500, color: LABEL, marginTop: 13 }}>
                  Open-Meteo 실측 · 10분 갱신
                </div>
              </div>
            </div>
          )}
          <div style={css("flex:1;display:flex;justify-content:flex-end;align-items:center;gap:8px")}>
            {WX_ICONS.map((Ic, i) => (
              <Ic key={i} size={22} strokeWidth={2.4} color={i === wxIdx ? INK : ICON_GHOST} />
            ))}
          </div>
          <span style={css("flex:none;width:1.5px;height:24px;margin:0 18px;background:var(--gray-200);border-radius:1px")} />
          <div style={css("flex:1;display:flex;justify-content:flex-start;align-items:center;gap:16px")}>
            <div style={css("display:flex;align-items:flex-start;gap:5px")}>
              <Seg text={tempStr} ghost={tempStr.replace(/[0-9-]/g, "8")} font={SEG7} size={24} />
              <span style={{ fontFamily: SANS, fontSize: 12, fontWeight: 600, color: LABEL, marginTop: 2 }}>°C</span>
            </div>
            <Droplets size={20} strokeWidth={2.2} color={INK} />
            <div style={css("display:flex;align-items:flex-start;gap:5px")}>
              <Seg text={humStr} ghost={humStr.replace(/[0-9]/g, "8")} font={SEG7} size={24} />
              <span style={{ fontFamily: SANS, fontSize: 12, fontWeight: 600, color: LABEL, marginTop: 2 }}>%</span>
            </div>
          </div>
        </div>

      </div>
    </div>
  );
}

/** 날씨 상세 팝오버 한 칸 — 라벨(작은 회색) 위, 값(굵은 검정) 아래 */
function WxStat({ label, value }: { label: string; value: string }) {
  return (
    <div style={css("display:flex;flex-direction:column;gap:2px")}>
      <span style={{ fontFamily: SANS, fontSize: 11, fontWeight: 500, color: LABEL }}>{label}</span>
      <span style={{ fontFamily: SANS, fontSize: 14, fontWeight: 700, color: "var(--gray-1000)" }}>{value}</span>
    </div>
  );
}
