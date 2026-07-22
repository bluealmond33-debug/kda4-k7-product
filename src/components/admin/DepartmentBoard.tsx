import { useState } from "react";
import { css } from "../../lib/css";
import { DEPARTMENTS } from "../../data/adminContent";
import { SGE_META, demoBus } from "../../services";
import type { AdminFeed } from "../../hooks/useAdminFeed";

/** [D] 부서 현황 보드 — 6개 라우팅 부서 × S/G/E 대기열.
 *  상담사 화면에서 옮겨온 운영 기능이 여기 있다: 대기 건 "연결"과 부서 간 "이관".
 *  이관도 demoBus를 타므로(transfer.requested) 라이브 콜과 같은 경로로 반영된다. */
export default function DepartmentBoard({ feed, explain }: { feed: AdminFeed; explain: boolean }) {
  const [expanded, setExpanded] = useState<string | null>(null);
  const [transferFrom, setTransferFrom] = useState<{ dept: string; id: string } | null>(null);
  // 보기 전환 — grid: 부서 카드(조작 포함) · load: 대기 부하 막대(한눈 비교)
  const [view, setView] = useState<"grid" | "load">("grid");

  const totalWaiting = Object.values(feed.state.queues).reduce((n, q) => n + q.length, 0);
  // 관제의 첫 번째 질문 — "지금 긴급이 몇 건인가"
  const urgentWaiting = Object.values(feed.queueCounts).reduce((n, c) => n + c.e, 0);

  return (
    <div className="card" style={css("display:flex;flex-direction:column;padding:14px 16px 12px;min-height:0")}>
      <div style={css("display:flex;align-items:center;gap:10px;margin-bottom:12px;white-space:nowrap")}>
        <span className="sechd" style={css("white-space:nowrap")}>부서 현황 보드</span>
        {/* 설명 모드에선 이 패널의 백엔드 역할을, 평소엔 조작 힌트를. 좁아지면 말줄임(줄바꿈 금지) */}
        <span style={css("flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font:400 11.5px 'Geist Sans','Pretendard',sans-serif;color:" + (explain ? "var(--gray-800)" : "var(--gray-600)"))}>
          {explain
            ? "라우팅의 종착지 — G·E는 부서 대기열로, S는 AI가 즉시 응대. 연결·이관이 여기서"
            : "부서를 누르면 대기 목록 · 연결·이관은 여기서 처리"}
        </span>
        {/* 긴급 대기 — 관제 KPI의 맨 앞. 0이면 조용히, 있으면 빨간 잉크로 */}
        <span style={css("flex:none;display:inline-flex;align-items:baseline;gap:5px")}>
          <span style={css("align-self:center;width:8px;height:8px;border-radius:9999px;flex:none;background:" + (urgentWaiting > 0 ? "var(--red-700)" : "rgba(188,63,43,.25)"))} />
          <span style={css("font:600 11.5px 'Geist Sans','Pretendard',sans-serif;color:var(--gray-700)")}>긴급 대기</span>
          <span className="bignum" style={css("font-size:20px;color:" + (urgentWaiting > 0 ? "var(--red-900)" : "var(--gray-600)"))}>{urgentWaiting}</span>
          <span style={css("font:600 11.5px 'Geist Sans','Pretendard',sans-serif;color:var(--gray-700)")}>건</span>
        </span>
        <span style={css("flex:none;display:inline-flex;align-items:baseline;gap:5px;margin-left:10px")}>
          <span style={css("font:600 11.5px 'Geist Sans','Pretendard',sans-serif;color:var(--gray-700)")}>전체 대기</span>
          <span className="bignum" style={css("font-size:20px;color:var(--gray-1000)")}>{totalWaiting}</span>
          <span style={css("font:600 11.5px 'Geist Sans','Pretendard',sans-serif;color:var(--gray-700)")}>건</span>
        </span>
        {/* S(단순)는 대기열이 아니라 AI가 즉시 받는다 — 별도 카운터 */}
        <span style={css("flex:none;display:inline-flex;align-items:baseline;gap:5px;margin-left:10px")}>
          <span className="mi" style={css("align-self:center;font-size:14px;color:var(--green-900)")}>smart_toy</span>
          <span style={css("font:600 11.5px 'Geist Sans','Pretendard',sans-serif;color:var(--gray-700)")}>AI 자동 응대</span>
          <span className="bignum" style={css("font-size:20px;color:var(--green-900)")}>{feed.state.aiHandled}</span>
          <span style={css("font:600 11.5px 'Geist Sans','Pretendard',sans-serif;color:var(--gray-700)")}>건</span>
        </span>
        <span style={css("flex:none;display:inline-flex;align-items:baseline;gap:5px;margin-left:10px")}>
          <span style={css("font:600 11.5px 'Geist Sans','Pretendard',sans-serif;color:var(--gray-700)")}>상담사 처리</span>
          <span className="bignum" style={css("font-size:20px;color:var(--gray-1000)")}>{feed.state.handled}</span>
          <span style={css("font:600 11.5px 'Geist Sans','Pretendard',sans-serif;color:var(--gray-700)")}>건</span>
        </span>
        {/* 보기 전환 — 카드 그리드 ↔ 부하 막대 */}
        <span style={css("flex:none;display:inline-flex;gap:3px;margin-left:12px;background:var(--gray-100);border-radius:9999px;padding:3px")}>
          {(
            [
              ["grid", "grid_view", "부서 카드 보기"],
              ["load", "bar_chart", "대기 부하 보기"],
            ] as const
          ).map(([v, icon, tip]) => (
            <span
              key={v}
              title={tip}
              onClick={() => setView(v)}
              style={css(
                "display:flex;width:26px;height:26px;border-radius:9999px;align-items:center;justify-content:center;cursor:pointer;transition:background .2s;" +
                  (view === v ? "background:var(--gray-1000)" : "")
              )}
            >
              <span className="mi" style={css("font-size:15px;color:" + (view === v ? "#fff" : "var(--gray-700)"))}>{icon}</span>
            </span>
          ))}
        </span>
      </div>

      {/* ── 부하 막대 보기 — 부서별 대기량을 한눈에 비교 (E 빨강 · G 파랑 세그먼트) ── */}
      {view === "load" && (
        <div style={css("flex:1;display:flex;flex-direction:column;gap:7px;min-height:0;overflow-y:auto;padding:2px 2px 0")}>
          {(() => {
            const rows = DEPARTMENTS.map((d) => ({
              name: d.name,
              c: feed.queueCounts[d.name] ?? { s: 0, g: 0, e: 0 },
            })).sort((a, b) => b.c.e + b.c.g - (a.c.e + a.c.g) || b.c.e - a.c.e);
            const max = Math.max(1, ...rows.map((r) => r.c.e + r.c.g));
            return rows.map((r) => {
              const total = r.c.e + r.c.g;
              return (
                <div key={r.name} style={css("display:flex;align-items:center;gap:10px")}>
                  <span style={css("flex:none;width:104px;font:600 11.5px 'Geist Sans','Pretendard',sans-serif;color:" + (r.name === "사고·신고" ? "var(--red-900)" : "var(--gray-1000)") + ";white-space:nowrap;overflow:hidden;text-overflow:ellipsis")}>
                    {r.name}
                  </span>
                  {/* 막대 — 가는 요소(높이 9px)라 색 허용. E가 앞(우선), G가 뒤 */}
                  <span style={css("flex:1;display:flex;align-items:center;gap:0;height:9px")}>
                    {r.c.e > 0 && (
                      <span style={{ width: `${(r.c.e / max) * 100}%`, height: 9, borderRadius: r.c.g > 0 ? "9999px 0 0 9999px" : 9999, background: "var(--red-700)", transition: "width .4s var(--ease-out)" }} />
                    )}
                    {r.c.g > 0 && (
                      <span style={{ width: `${(r.c.g / max) * 100}%`, height: 9, borderRadius: r.c.e > 0 ? "0 9999px 9999px 0" : 9999, background: "var(--blue-700)", transition: "width .4s var(--ease-out)" }} />
                    )}
                    {total === 0 && <span style={css("width:100%;height:1px;background:var(--gray-300)")} />}
                  </span>
                  <span style={css("flex:none;width:96px;font:600 10.5px 'Geist Mono',monospace;color:var(--gray-800);text-align:right;white-space:nowrap")}>
                    {r.c.e > 0 && <span style={css("color:var(--red-900)")}>E {r.c.e}</span>}
                    {r.c.e > 0 && r.c.g > 0 && " · "}
                    {r.c.g > 0 && <span style={css("color:var(--blue-900)")}>G {r.c.g}</span>}
                    {total === 0 && <span style={css("color:var(--gray-600)")}>대기 없음</span>}
                  </span>
                </div>
              );
            });
          })()}
          <div style={css("font:400 10px 'Geist Sans','Pretendard',sans-serif;color:var(--gray-600);padding-top:2px")}>
            대기량 많은 순 정렬 · 연결·이관 조작은 카드 보기에서
          </div>
        </div>
      )}

      {/* 행 높이를 패널에 꽉 채워(minmax(0,1fr)) 죽은 공간을 카드 내부 호흡으로 흡수한다.
          사고·신고(긴급 직결)는 우하단 고정 — taxonomy 순서는 rules.ts가 진실원, 표시만 재배치 */}
      {view === "grid" && (
      <div style={css("flex:1;display:grid;grid-template-columns:repeat(4,1fr);grid-auto-rows:minmax(0,1fr);gap:8px;min-height:0")}>
        {[...DEPARTMENTS.filter((d) => d.name !== "사고·신고"), ...DEPARTMENTS.filter((d) => d.name === "사고·신고")].map((dept) => {
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
                {/* 신호등 문법 — 켜진 점은 제 색, 꺼진 점은 흐린 제 색(.lampdots와 동일 원리). 틴트 면 금지.
                    S는 대기열에 없으므로(AI 즉시 응대) E·G만 */}
                {(["E", "G"] as const).map((k) => {
                  const n = k === "G" ? counts.g : counts.e;
                  const meta = SGE_META[k];
                  const dim = { E: "rgba(188,63,43,.4)", G: "rgba(47,95,196,.35)" }[k];
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
      )}
    </div>
  );
}
