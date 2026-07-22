import { useState } from "react";
import { css } from "../../lib/css";
import { DEPARTMENTS } from "../../data/adminContent";
import { SGE_META, demoBus } from "../../services";
import type { AdminFeed } from "../../hooks/useAdminFeed";

/** [D] 부서 현황 보드 — 6개 라우팅 부서 × S/G/E 대기열.
 *  상담사 화면에서 옮겨온 운영 기능이 여기 있다: 대기 건 "연결"과 부서 간 "이관".
 *  이관도 demoBus를 타므로(transfer.requested) 라이브 콜과 같은 경로로 반영된다. */
export default function DepartmentBoard({ feed }: { feed: AdminFeed }) {
  const [expanded, setExpanded] = useState<string | null>(null);
  const [transferFrom, setTransferFrom] = useState<{ dept: string; id: string } | null>(null);

  const totalWaiting = Object.values(feed.state.queues).reduce((n, q) => n + q.length, 0);

  return (
    <div className="card" style={css("display:flex;flex-direction:column;padding:14px 16px 12px;min-height:0")}>
      <div style={css("display:flex;align-items:center;gap:10px;margin-bottom:12px")}>
        <span className="sechd">부서 현황 보드</span>
        <span style={css("font:400 11.5px 'Geist Sans','Pretendard',sans-serif;color:var(--gray-600)")}>
          부서를 누르면 대기 목록 · 연결·이관은 여기서 처리
        </span>
        <div style={css("flex:1")} />
        <span style={css("display:inline-flex;align-items:baseline;gap:5px")}>
          <span style={css("font:600 11.5px 'Geist Sans','Pretendard',sans-serif;color:var(--gray-700)")}>전체 대기</span>
          <span className="bignum" style={css("font-size:20px;color:var(--gray-1000)")}>{totalWaiting}</span>
          <span style={css("font:600 11.5px 'Geist Sans','Pretendard',sans-serif;color:var(--gray-700)")}>건</span>
        </span>
        <span style={css("display:inline-flex;align-items:baseline;gap:5px;margin-left:10px")}>
          <span style={css("font:600 11.5px 'Geist Sans','Pretendard',sans-serif;color:var(--gray-700)")}>오늘 처리</span>
          <span className="bignum" style={css("font-size:20px;color:var(--green-900)")}>{feed.state.handled}</span>
          <span style={css("font:600 11.5px 'Geist Sans','Pretendard',sans-serif;color:var(--gray-700)")}>건</span>
        </span>
      </div>

      {/* 행 높이를 패널에 꽉 채워(minmax(0,1fr)) 죽은 공간을 카드 내부 호흡으로 흡수한다 */}
      <div style={css("flex:1;display:grid;grid-template-columns:repeat(4,1fr);grid-auto-rows:minmax(0,1fr);gap:8px;min-height:0")}>
        {DEPARTMENTS.map((dept) => {
          const items = feed.state.queues[dept.name] ?? [];
          const counts = feed.queueCounts[dept.name] ?? { s: 0, g: 0, e: 0 };
          const open = expanded === dept.name;
          const urgent = counts.e > 0;
          const isIncident = dept.name === "사고·신고"; // SG — 긴급 라우팅 직결 부서
          return (
            <div
              key={dept.name}
              style={css(
                "display:flex;flex-direction:column;min-height:0;border-radius:11px;background:var(--background-200);padding:10px 12px;cursor:pointer;transition:box-shadow .25s var(--ease-out);" +
                  (open ? "box-shadow:var(--sh-focus);background:var(--onair-surface)" : "") +
                  (urgent ? ";outline:1.5px solid var(--red-400)" : "")
              )}
              onClick={() => {
                setExpanded(open ? null : dept.name);
                setTransferFrom(null);
              }}
            >
              <div style={css("display:flex;align-items:center;gap:7px")}>
                <span className="mi" style={css("font-size:16px;color:" + (urgent ? "var(--red-900)" : "var(--gray-800)"))}>
                  {isIncident ? "e911_emergency" : "groups"}
                </span>
                <span style={css("font:600 13px 'Geist Sans','Pretendard',sans-serif;color:var(--gray-1000);letter-spacing:-.1px")}>{dept.name}</span>
                {isIncident && (
                  <span style={css("font:700 10px 'Geist Sans','Pretendard',sans-serif;color:var(--red-900)")}>긴급 직결</span>
                )}
                <div style={css("flex:1")} />
                <span className="mi" style={css("font-size:16px;color:var(--gray-600);transition:transform .25s;transform:rotate(" + (open ? "180deg" : "0deg") + ")")}>expand_more</span>
              </div>
              <div style={css("margin-top:4px;font:400 10.5px 'Geist Sans','Pretendard',sans-serif;color:var(--gray-700);overflow:hidden;text-overflow:ellipsis;white-space:nowrap")}>
                {dept.tasks.slice(0, 3).join(" · ")}
              </div>

              {/* S/G/E 카운트 칩 — 0건은 흐리게. 카드 바닥에 고정(order+margin-top:auto)해
                  남는 세로 공간이 카드 내부의 호흡으로 흡수된다 */}
              <div style={css("order:3;margin-top:auto;padding-top:9px;display:flex;align-items:center;gap:6px")}>
                {/* 신호등 문법 — 켜진 점은 제 색, 꺼진 점은 흐린 제 색(.lampdots와 동일 원리). 틴트 면 금지 */}
                {(["E", "G", "S"] as const).map((k) => {
                  const n = k === "S" ? counts.s : k === "G" ? counts.g : counts.e;
                  const meta = SGE_META[k];
                  const dim = { E: "rgba(188,63,43,.4)", G: "rgba(47,95,196,.35)", S: "rgba(62,122,78,.42)" }[k];
                  return (
                    <span
                      key={k}
                      style={css(
                        "display:inline-flex;align-items:center;gap:4px;font:700 11px 'Geist Mono',monospace;transition:opacity .3s;" +
                          (n > 0 ? "color:" + meta.fg : "color:var(--gray-500)")
                      )}
                    >
                      <span style={css("width:8px;height:8px;border-radius:9999px;flex:none;background:" + (n > 0 ? meta.bar : dim))} />
                      {k} {n}
                    </span>
                  );
                })}
                <div style={css("flex:1")} />
                <span style={css("font:600 11px 'Geist Sans','Pretendard',sans-serif;color:var(--gray-700)")}>대기 {items.length}건</span>
              </div>

              {/* 펼친 대기 목록 — 카운트 행 위의 남는 공간을 차지하고 넘치면 카드 안에서 스크롤 */}
              {open && (
                <div style={css("order:2;flex:1;min-height:0;overflow-y:auto;margin-top:9px;display:flex;flex-direction:column;gap:5px;animation:dockDown .25s var(--ease-out)")} onClick={(e) => e.stopPropagation()}>
                  {items.length === 0 && (
                    <div style={css("font:400 11.5px 'Geist Sans','Pretendard',sans-serif;color:var(--gray-600);padding:6px 2px")}>대기 중인 상담이 없습니다</div>
                  )}
                  {items.map((it) => {
                    const meta = SGE_META[it.sge];
                    const pickerOpen = transferFrom?.id === it.id;
                    return (
                      <div key={it.id} style={css("position:relative;display:flex;align-items:center;gap:8px;background:var(--onair-surface);border:1px solid var(--gray-200);border-radius:8px;padding:7px 9px")}>
                        <span style={css("flex:none;width:8px;height:8px;border-radius:9999px;background:" + meta.bar)} />
                        <span style={css("flex:1;min-width:0;font:500 11.5px 'Geist Sans','Pretendard',sans-serif;color:var(--gray-1000);overflow:hidden;text-overflow:ellipsis;white-space:nowrap")}>
                          {it.label}
                        </span>
                        {it.callId && (
                          <span style={css("flex:none;font:700 9px 'Geist Mono',monospace;letter-spacing:.4px;color:var(--blue-900)")}>LIVE</span>
                        )}
                        {/* 연결 — 단순(S)은 ARS·AI가 응대, 일반·긴급은 상담사 배정 */}
                        <span
                          title={it.sge === "S" ? "AI 응대 완료 처리" : "수신 가능 상담사에게 연결"}
                          onClick={() => feed.connectItem(dept.name, it.id)}
                          style={css("flex:none;display:flex;width:24px;height:24px;border-radius:9999px;align-items:center;justify-content:center;background:var(--gray-100);cursor:pointer")}
                        >
                          <span className="mi" style={css("font-size:14px;color:var(--green-900)")}>{it.sge === "S" ? "smart_toy" : "call"}</span>
                        </span>
                        {/* 이관 — 다른 부서 대기열로 */}
                        <span
                          title="다른 부서로 이관"
                          onClick={() => setTransferFrom(pickerOpen ? null : { dept: dept.name, id: it.id })}
                          style={css("flex:none;display:flex;width:24px;height:24px;border-radius:9999px;align-items:center;justify-content:center;background:var(--gray-100);cursor:pointer")}
                        >
                          <span className="mi" style={css("font-size:14px;color:var(--gray-800)")}>sync_alt</span>
                        </span>
                        {pickerOpen && (
                          <div style={css("position:absolute;right:0;top:32px;z-index:40;background:var(--onair-surface);border-radius:10px;box-shadow:var(--sh-modal);padding:6px;min-width:172px;animation:dockDown .2s var(--ease-out)")}>
                            <div style={css("font:700 10px 'Geist Sans','Pretendard',sans-serif;color:var(--gray-600);padding:4px 8px 5px")}>이관할 부서</div>
                            {DEPARTMENTS.filter((d) => d.name !== dept.name).map((d) => (
                              <div
                                key={d.name}
                                onClick={() => {
                                  demoBus.emit("transfer.requested", {
                                    callId: it.callId ?? it.id,
                                    toDept: d.name,
                                    mode: "immediate",
                                  });
                                  setTransferFrom(null);
                                }}
                                style={css("font:500 11.5px 'Geist Sans','Pretendard',sans-serif;color:var(--gray-1000);border-radius:7px;padding:6px 8px;cursor:pointer;transition:background .15s")}
                                onMouseEnter={(e) => ((e.currentTarget as HTMLDivElement).style.background = "var(--gray-100)")}
                                onMouseLeave={(e) => ((e.currentTarget as HTMLDivElement).style.background = "transparent")}
                              >
                                {d.name}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
