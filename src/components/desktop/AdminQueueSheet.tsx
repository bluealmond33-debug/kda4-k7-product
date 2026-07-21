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
 * 관리자 대기열 시트 — 통화 화면 전용, 왼쪽 바텀업(후처리 시트와 같은 승강 문법).
 * 상단 '관리자' 토글을 켜면 헤더만 살짝 고개를 내밀고(peek), 그 헤더를 클릭하면 전체가 올라온다.
 * 기본은 부서 하나씩(칩 선택) — '전체'는 한 단계 더 눌러서 본다.
 */
export default function AdminQueueSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const H = 560; // 시트 전체 높이
  const PEEK = 56; // 접힌 상태 = 헤더만
  const [expanded, setExpanded] = useState(false);
  useEffect(() => {
    if (!open) setExpanded(false); // 토글을 끄면 다음에 켤 때 다시 peek부터
  }, [open]);

  // 기본 = 부서 하나씩 · '전체'는 한 단계 더
  const [dept, setDept] = useState<number | "all">(0);
  const shown = dept === "all" ? [...ADMIN_QUEUE] : [ADMIN_QUEUE[dept]];

  // 대기 시간이 실제로 흐른다 — 벽시계 기준 경과라 접었다 펴도 이어진다
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
    /* 클리핑 래퍼 — 내려간(숨은) 부분이 데스크톱 화면 밖으로 삐져나오지 않게 잘라낸다 */
    <div style={css("position:absolute;inset:0;overflow:hidden;border-radius:12px;pointer-events:none;z-index:80")}>
    <div
      style={{
        ...css(
          "position:absolute;left:14px;bottom:0;width:412px;height:" +
            H +
            "px;background:var(--onair-surface);border-radius:12px 12px 0 0;box-shadow:var(--sh-modal);display:flex;flex-direction:column;overflow:hidden;transition:transform .5s var(--ease-drawer);font-family:" +
            FONT
        ),
        transform: !open ? "translateY(105%)" : expanded ? "translateY(0)" : "translateY(" + (H - PEEK) + "px)",
        pointerEvents: open ? "auto" : "none",
      }}
    >
      {/* 헤더 = peek에서 보이는 부분. 클릭하면 전체 펼침/접힘 */}
      <div onClick={() => setExpanded((v) => !v)} style={css("flex:none;cursor:pointer;user-select:none;border-bottom:1px solid var(--gray-200)")}>
        <div style={css("display:flex;align-items:center;justify-content:center;padding:6px 0 0")}>
          <span style={css("width:44px;height:5px;border-radius:9999px;background:var(--color-border)")} />
        </div>
        <div style={css("display:flex;align-items:center;gap:9px;padding:3px 16px 10px")}>
          <span className="mi" style={css("font-size:19px;color:var(--blue-700)")}>monitoring</span>
          <div style={css("flex:1;min-width:0")}>
            <span style={css("font:700 13.5px " + FONT + ";color:var(--gray-1000)")}>실시간 대기열</span>
            <span style={css("font:400 11px " + FONT + ";color:var(--gray-600);margin-left:8px")}>
              {expanded ? "관리자 보기 · 부서별 대기 현황" : "클릭해 펼치기"}
            </span>
          </div>
          <span style={css("display:inline-flex;align-items:baseline;gap:5px;background:var(--gray-100);border-radius:9999px;padding:4px 10px")}>
            <span style={css("font:600 10.5px " + FONT + ";color:var(--gray-700)")}>전체 대기</span>
            <span style={css("font:700 12.5px " + MONO + ";color:var(--blue-700)")}>{total}건</span>
          </span>
          <span className="mi" style={css("font-size:20px;color:var(--gray-500);transition:transform .3s var(--ease-drawer);transform:rotate(" + (expanded ? 0 : 180) + "deg)")}>expand_more</span>
          <span
            onClick={(e) => {
              e.stopPropagation();
              onClose();
            }}
            title="관리자 보기 끄기"
            style={css("cursor:pointer;display:flex;width:26px;height:26px;border-radius:9999px;align-items:center;justify-content:center;background:var(--gray-100)")}
          >
            <span className="mi" style={css("font-size:16px;color:var(--gray-600)")}>close</span>
          </span>
        </div>
      </div>

      {/* 부서 선택 칩 — 기본은 부서 하나씩, '전체'는 한 단계 더 */}
      <div style={css("flex:none;display:flex;gap:6px;padding:10px 14px 4px;flex-wrap:wrap")}>
        {ADMIN_QUEUE.map((d, i) => {
          const on = dept === i;
          return (
            <span
              key={d.dept}
              onClick={() => setDept(i)}
              style={css(
                "display:inline-flex;align-items:center;gap:5px;font:600 11.5px " + FONT +
                  ";border-radius:9999px;padding:6px 12px;cursor:pointer;border:1px solid " +
                  (on ? "var(--blue-700);background:var(--blue-700);color:#fff" : "var(--gray-300);background:var(--onair-surface);color:var(--gray-800)")
              )}
            >
              {d.dept}
              <span style={css("font:700 10.5px " + MONO + (on ? "" : ";color:var(--blue-700)"))}>{d.waiting.length}</span>
            </span>
          );
        })}
        <span
          onClick={() => setDept("all")}
          style={css(
            "display:inline-flex;align-items:center;gap:4px;font:600 11.5px " + FONT +
              ";border-radius:9999px;padding:6px 12px;cursor:pointer;border:1px dashed " +
              (dept === "all" ? "var(--gray-1000);background:var(--gray-1000);color:#fff" : "var(--gray-400);background:var(--onair-surface);color:var(--gray-700)")
          )}
        >
          <span className="mi" style={css("font-size:13px")}>stacks</span>전체 부서
        </span>
      </div>

      {/* 부서 섹션 */}
      <div style={css("flex:1;min-height:0;overflow:auto;padding:2px 12px 12px")}>
        {shown.map((d) => (
          <div key={d.dept} style={css("margin-top:8px")}>
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
                      <span style={css("display:inline-flex;align-items:center;gap:4px;font:600 11px " + FONT + ";color:var(--gray-700)")}>
                        <span className="mi" style={css("font-size:13px;color:var(--gray-600)")}>schedule</span>
                        대기 <span style={css("font:700 12px " + MONO + ";color:var(--gray-1000)")}>{fmt(w.baseSec + elapsed)}</span>
                      </span>
                    </div>
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
    </div>
  );
}
