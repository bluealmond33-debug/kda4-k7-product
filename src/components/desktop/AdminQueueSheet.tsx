import { useEffect, useRef, useState } from "react";
import { css } from "../../lib/css";
import { ADMIN_QUEUE } from "../../data/demoContent";

const FONT = "'Geist Sans','Pretendard',sans-serif";
const MONO = "'Geist Mono','IBM Plex Mono',monospace";

const fmt = (s: number) => {
  const m = Math.floor(s / 60);
  const r = s % 60;
  return (m < 10 ? "0" : "") + m + ":" + (r < 10 ? "0" : "") + r;
};

/**
 * 관리자 대기열 시트 — 상단 '관리자' 토글로 여닫는 왼쪽 바텀업 시트(후처리 시트와 같은 승강 문법).
 * 상담사 화면과 딱 하나 다른 정보 = 지금 대기열: 부서별 대기 인원·상담사 배정 현황·
 * 각 콜의 마스킹 이름·AI 용건 요약·실시간 대기 시간.
 * 어느 데모 단계에서든 열 수 있고, 뒤 화면은 그대로 진행된다(딤 없음).
 */
export default function AdminQueueSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  // 대기 시간이 실제로 흐른다 — 벽시계 기준 경과라 닫았다 열어도 이어진다
  const startRef = useRef(Date.now());
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    if (!open) return;
    const tick = () => setElapsed(Math.floor((Date.now() - startRef.current) / 1000));
    tick();
    const t = window.setInterval(tick, 1000);
    return () => window.clearInterval(t);
  }, [open]);

  const total = ADMIN_QUEUE.reduce((n, d) => n + d.waiting.length, 0);

  return (
    <div
      style={{
        ...css(
          "position:absolute;left:14px;bottom:0;width:412px;max-height:620px;z-index:80;background:var(--onair-surface);border-radius:12px 12px 0 0;box-shadow:var(--sh-modal);display:flex;flex-direction:column;overflow:hidden;transition:transform .5s var(--ease-drawer);font-family:" +
            FONT
        ),
        transform: open ? "translateY(0)" : "translateY(105%)",
        pointerEvents: open ? "auto" : "none",
      }}
    >
      {/* 헤더 */}
      <div style={css("flex:none;display:flex;align-items:center;gap:9px;padding:14px 16px 12px;border-bottom:1px solid var(--gray-200)")}>
        <span className="mi" style={css("font-size:19px;color:var(--blue-700)")}>monitoring</span>
        <div style={css("flex:1;min-width:0")}>
          <div style={css("font:700 14px " + FONT + ";color:var(--gray-1000)")}>실시간 대기열</div>
          <div style={css("font:400 11px " + FONT + ";color:var(--gray-600)")}>관리자 보기 · 부서별 대기 현황</div>
        </div>
        <span style={css("display:inline-flex;align-items:baseline;gap:5px;background:var(--gray-100);border-radius:9999px;padding:5px 11px")}>
          <span style={css("font:600 10.5px " + FONT + ";color:var(--gray-700)")}>전체 대기</span>
          <span style={css("font:700 13px " + MONO + ";color:var(--blue-700)")}>{total}건</span>
        </span>
        <span onClick={onClose} title="닫기" style={css("cursor:pointer;display:flex;width:26px;height:26px;border-radius:9999px;align-items:center;justify-content:center;background:var(--gray-100)")}>
          <span className="mi" style={css("font-size:16px;color:var(--gray-600)")}>close</span>
        </span>
      </div>

      {/* 부서별 섹션 */}
      <div style={css("flex:1;min-height:0;overflow:auto;padding:6px 12px 12px")}>
        {ADMIN_QUEUE.map((d) => (
          <div key={d.dept} style={css("margin-top:8px")}>
            {/* 부서 헤더 — 대기 건수 + 상담사 배정 현황(수신 가능·통화 중) */}
            <div style={css("display:flex;align-items:center;gap:7px;padding:7px 4px 6px")}>
              <span style={css("font:700 12.5px " + FONT + ";color:var(--gray-1000)")}>{d.dept}</span>
              <span style={css("font:400 10.5px " + FONT + ";color:var(--gray-600)")}>{d.desc}</span>
              <div style={css("flex:1")} />
              <span style={css("display:inline-flex;align-items:center;gap:4px;font:600 10.5px " + FONT + ";color:var(--green-900)")}>
                <span style={css("width:6px;height:6px;border-radius:9999px;background:var(--green-700)")} />수신 가능 {d.available}
              </span>
              <span style={css("font:600 10.5px " + FONT + ";color:var(--gray-600)")}>통화 중 {d.busy}</span>
            </div>
            {d.waiting.length === 0 ? (
              <div style={css("background:var(--gray-100);border-radius:8px;padding:10px 12px;font:400 11.5px " + FONT + ";color:var(--gray-500)")}>대기 없음</div>
            ) : (
              <div style={css("display:flex;flex-direction:column;gap:6px")}>
                {d.waiting.map((w) => (
                  <div key={w.masked} style={css("background:var(--gray-100);border-radius:8px;padding:10px 12px")}>
                    <div style={css("display:flex;align-items:center;gap:8px")}>
                      <span style={css("font:700 12.5px " + FONT + ";color:var(--gray-1000)")}>{w.masked} 고객</span>
                      <div style={css("flex:1")} />
                      {/* 대기 시간 — 실시간으로 흐른다 */}
                      <span style={css("display:inline-flex;align-items:center;gap:4px;font:600 11px " + FONT + ";color:var(--gray-700)")}>
                        <span className="mi" style={css("font-size:13px;color:var(--gray-600)")}>schedule</span>
                        대기 <span style={css("font:700 12px " + MONO + ";color:var(--gray-1000)")}>{fmt(w.baseSec + elapsed)}</span>
                      </span>
                    </div>
                    {/* AI 사전 접수 요약 한 줄 — 관리자도 '무슨 일인지'를 받기 전에 안다 */}
                    <div style={css("display:flex;align-items:center;gap:5px;margin-top:5px")}>
                      <span className="mi" style={css("font-size:13px;color:var(--blue-700);flex:none")}>auto_awesome</span>
                      <span style={css("font:400 12px/1.45 " + FONT + ";color:var(--gray-900)")}>{w.summary}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
        <div style={css("display:flex;align-items:center;gap:5px;margin-top:12px;padding:0 4px;font:400 10.5px " + FONT + ";color:var(--gray-500)")}>
          <span className="mi" style={css("font-size:13px")}>lock</span>
          이름은 마스킹 표시 — 상세는 배정된 상담사만 본인확인 후 열람합니다
        </div>
      </div>
    </div>
  );
}
