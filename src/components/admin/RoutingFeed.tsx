import { css } from "../../lib/css";
import { SGE_META } from "../../services";
import type { AdminCallRecord } from "../../hooks/useAdminFeed";

const fmtTime = (ts: number) => {
  const d = new Date(ts);
  return ("0" + d.getHours()).slice(-2) + ":" + ("0" + d.getMinutes()).slice(-2);
};

/** [C] 실시간 라우팅 피드 — 분류가 끝난 콜이 S/G/E 컬러 카드로 쌓인다.
 *  진행 중 긴급(E)은 맨 위 고정. 분류 전 콜은 "분류 중" 스켈레톤으로 먼저 보인다. */
export default function RoutingFeed({ feed }: { feed: AdminCallRecord[] }) {
  return (
    <div className="card" style={css("display:flex;flex-direction:column;min-height:0;padding:16px 0 6px")}>
      <div style={css("display:flex;align-items:center;gap:10px;padding:0 20px 12px")}>
        <span className="sechd">실시간 라우팅 피드</span>
        <div style={css("flex:1")} />
        {(["E", "G", "S"] as const).map((k) => (
          <span key={k} style={css("display:inline-flex;align-items:center;gap:5px")}>
            <span style={css("width:8px;height:8px;border-radius:2.5px;background:" + SGE_META[k].bar)} />
            <span style={css("font:600 10.5px 'Geist Sans','Pretendard',sans-serif;color:var(--gray-700)")}>
              {k} {SGE_META[k].label}
            </span>
          </span>
        ))}
      </div>

      <div style={css("flex:1;overflow-y:auto;padding:2px 14px 10px;display:flex;flex-direction:column;gap:8px;min-height:0")}>
        {feed.length === 0 && (
          <div style={css("display:flex;flex-direction:column;align-items:center;gap:8px;padding:44px 20px;color:var(--gray-600)")}>
            <span className="mi" style={css("font-size:30px;color:var(--gray-500)")}>quickreply</span>
            <span style={css("font:400 12.5px 'Geist Sans','Pretendard',sans-serif;text-align:center;line-height:1.6")}>
              아직 분류된 콜이 없습니다.
              <br />
              상담사 화면의 콜 또는 테스트 콜이 여기로 흘러옵니다.
            </span>
          </div>
        )}
        {feed.map((r) => {
          const sge = r.sge;
          const meta = sge ? SGE_META[sge] : null;
          const live = r.endedAt === null;
          return (
            <div
              key={r.callId}
              style={css(
                "position:relative;border-radius:10px;background:var(--background-200);padding:10px 12px 10px 16px;overflow:hidden;animation:dockDown .3s var(--ease-out);transition:opacity .3s;" +
                  (live ? "" : "opacity:.6")
              )}
            >
              {/* 좌측 컬러바 — 분류 전엔 회색 */}
              <span style={css("position:absolute;left:0;top:0;bottom:0;width:4px;background:" + (meta ? meta.bar : "var(--gray-400)"))} />

              {r.card && sge && meta ? (
                <>
                  <div style={css("display:flex;align-items:center;gap:8px")}>
                    <span style={css("flex:none;font:700 10.5px 'Geist Sans','Pretendard',sans-serif;border-radius:6px;padding:2.5px 8px;background:" + meta.bg + ";color:" + meta.fg)}>
                      {sge} · {meta.label}
                    </span>
                    <span style={css("font:600 13px 'Geist Sans','Pretendard',sans-serif;color:var(--gray-1000);overflow:hidden;text-overflow:ellipsis;white-space:nowrap")}>
                      {r.card.businessType}
                    </span>
                    <div style={css("flex:1")} />
                    <span style={css("flex:none;font:500 10.5px 'Geist Mono',monospace;color:var(--gray-600)")}>{fmtTime(r.startedAt)}</span>
                  </div>
                  <div style={css("margin-top:6px;font:400 12px/1.55 'Geist Sans','Pretendard',sans-serif;color:var(--gray-900);display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden")}>
                    {r.card.summary}
                  </div>
                  <div style={css("margin-top:8px;display:flex;align-items:center;gap:6px;flex-wrap:wrap")}>
                    <span style={css("font:600 10.5px 'Geist Sans','Pretendard',sans-serif;background:var(--gray-100);color:var(--gray-900);border-radius:9999px;padding:3px 9px")}>
                      {r.department ?? r.card.department}
                    </span>
                    {r.confidence != null && (
                      <span style={css("font:600 10.5px 'Geist Mono',monospace;background:var(--gray-100);color:var(--gray-800);border-radius:9999px;padding:3px 9px")}>
                        확신 {Math.round(r.confidence * 100)}%
                      </span>
                    )}
                    {r.risk === "high" && (
                      <span style={css("display:inline-flex;align-items:center;gap:3px;font:700 10.5px 'Geist Sans','Pretendard',sans-serif;background:var(--red-100);color:var(--red-900);border-radius:9999px;padding:3px 9px")}>
                        <span className="mi" style={css("font-size:12px")}>warning</span>사고징후 높음
                      </span>
                    )}
                    {r.transferTo && (
                      <span style={css("display:inline-flex;align-items:center;gap:3px;font:600 10.5px 'Geist Sans','Pretendard',sans-serif;background:var(--blue-100);color:var(--blue-900);border-radius:9999px;padding:3px 9px")}>
                        <span className="mi" style={css("font-size:12px")}>sync_alt</span>이관 → {r.transferTo}
                      </span>
                    )}
                    <span style={css("font:600 10px 'Geist Sans','Pretendard',sans-serif;color:" + (r.card.source === "backend" ? "var(--green-900)" : "var(--gray-600)"))}>
                      {r.card.source === "backend" ? "실백엔드" : "데모"}
                    </span>
                    {!live && (
                      <span style={css("font:600 10.5px 'Geist Sans','Pretendard',sans-serif;color:var(--gray-600)")}>· 완료</span>
                    )}
                  </div>
                </>
              ) : (
                <div style={css("display:flex;align-items:center;gap:9px")}>
                  <span className="mi" style={css("font-size:15px;color:var(--blue-700);animation:spin 1.2s linear infinite")}>progress_activity</span>
                  <span style={css("font:600 12px 'Geist Sans','Pretendard',sans-serif;color:var(--gray-900)")}>분류 중…</span>
                  <span style={css("font:400 11.5px 'Geist Sans','Pretendard',sans-serif;color:var(--gray-700);overflow:hidden;text-overflow:ellipsis;white-space:nowrap")}>
                    {r.utterances[r.utterances.length - 1] ?? "발화 수신 대기"}
                  </span>
                  <div style={css("flex:1")} />
                  <span style={css("flex:none;font:500 10.5px 'Geist Mono',monospace;color:var(--gray-600)")}>{fmtTime(r.startedAt)}</span>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
