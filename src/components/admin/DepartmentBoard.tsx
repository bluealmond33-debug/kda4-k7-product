import { useState } from "react";
import { css } from "../../lib/css";
import { DEPARTMENTS } from "../../data/adminContent";
import { SGE_META, demoBus } from "../../services";
import type { AdminFeed } from "../../hooks/useAdminFeed";

/** [D] 부서 현황 보드 — 8개 라우팅 부서 × G/E 대기열 (S는 AI 즉시 응대라 큐에 없다).
 *  대기 목록은 클릭 없이 항상 보인다 — 관제는 펼침 조작 없이 읽혀야 한다.
 *  연결·이관 액션은 행에 올렸을 때만 드러난다(.memorow 문법). 이관도 demoBus를 탄다. */
export default function DepartmentBoard({ feed, explain }: { feed: AdminFeed; explain: boolean }) {
  const [transferFrom, setTransferFrom] = useState<{ dept: string; id: string } | null>(null);
  // 보기 전환 — grid: 부서 카드(목록·조작) · load: 대기 부하 막대(한눈 비교)
  const [view, setView] = useState<"grid" | "load">("grid");

  const totalWaiting = Object.values(feed.state.queues).reduce((n, q) => n + q.length, 0);
  // 관제의 첫 번째 질문 — "지금 긴급이 몇 건인가"
  const urgentWaiting = Object.values(feed.queueCounts).reduce((n, c) => n + c.e, 0);
  // 사고·신고(긴급 직결)는 우하단 고정 — taxonomy 순서는 rules.ts가 진실원, 표시만 재배치
  const ordered = [
    ...DEPARTMENTS.filter((d) => d.name !== "사고·신고"),
    ...DEPARTMENTS.filter((d) => d.name === "사고·신고"),
  ];

  const kpi = (label: string, value: number, valueColor: string, lead?: "lamp" | "ai") => (
    <span style={css("flex:none;display:inline-flex;align-items:baseline;gap:5px;margin-left:10px")}>
      {lead === "lamp" && (
        <span style={css("align-self:center;width:8px;height:8px;border-radius:9999px;flex:none;background:" + (value > 0 ? "var(--red-700)" : "rgba(188,63,43,.25)"))} />
      )}
      {lead === "ai" && <span className="mi" style={css("align-self:center;font-size:14px;color:var(--green-900)")}>smart_toy</span>}
      <span style={css("font:600 11.5px 'Geist Sans','Pretendard',sans-serif;color:var(--gray-700)")}>{label}</span>
      <span className="bignum" style={css("font-size:20px;color:" + valueColor)}>{value}</span>
      <span style={css("font:600 11.5px 'Geist Sans','Pretendard',sans-serif;color:var(--gray-700)")}>건</span>
    </span>
  );

  return (
    <div className="card" style={css("display:flex;flex-direction:column;padding:14px 16px 12px;min-height:0")}>
      <div style={css("display:flex;align-items:center;gap:10px;margin-bottom:12px;white-space:nowrap")}>
        <span className="sechd" style={css("white-space:nowrap")}>부서 현황 보드</span>
        {/* 설명 모드에선 이 패널의 백엔드 역할을(회색 블록 — 다른 패널과 동일 문법), 평소엔 안내를 */}
        <span
          style={css(
            "flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font:400 11px 'Geist Sans','Pretendard',sans-serif;" +
              (explain
                ? "color:var(--gray-800);background:var(--gray-100);border-radius:8px;padding:4px 9px;animation:dockDown .25s var(--ease-out)"
                : "color:var(--gray-600)")
          )}
        >
          {explain
            ? "라우팅의 종착지 — G·E는 부서 대기열로, S는 AI가 즉시 응대. 연결·이관이 여기서"
            : "행에 올리면 연결·이관 · S(단순)는 AI가 즉시 응대"}
        </span>
        {kpi("긴급 대기", urgentWaiting, urgentWaiting > 0 ? "var(--red-900)" : "var(--gray-600)", "lamp")}
        {kpi("전체 대기", totalWaiting, "var(--gray-1000)")}
        {kpi("AI 자동 응대", feed.state.aiHandled, "var(--green-900)", "ai")}
        {kpi("상담사 처리", feed.state.handled, "var(--gray-1000)")}
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

      {/* ── 부하 보기 — 세로 막대 그래프: 부서별 대기량(E 빨강이 위, G 파랑이 아래) ── */}
      {view === "load" && (
        <div style={css("flex:1;display:flex;flex-direction:column;min-height:0;padding:4px 6px 0")}>
          {(() => {
            const rows = ordered.map((d) => ({
              name: d.name,
              items: feed.state.queues[d.name] ?? [],
              c: feed.queueCounts[d.name] ?? { s: 0, g: 0, e: 0 },
            }));
            const max = Math.max(1, ...rows.map((r) => r.c.e + r.c.g));
            return (
              <>
                {/* 차트 영역 — 바닥 정렬 컬럼 8개 */}
                <div style={css("flex:1;min-height:0;display:flex;align-items:stretch;gap:10px")}>
                  {rows.map((r) => {
                    const total = r.c.e + r.c.g;
                    const hPct = (total / max) * 100;
                    return (
                      <div
                        key={r.name}
                        title={r.items.length ? r.items.map((it) => (it.code ? `${it.code} ${it.label}` : it.label)).join("\n") : "대기 없음"}
                        style={css("flex:1;min-width:0;display:flex;flex-direction:column;align-items:center;gap:6px")}
                      >
                        {/* 값 라벨 — 막대 바로 위 */}
                        <div style={css("flex:1;min-height:0;width:100%;display:flex;flex-direction:column;align-items:center;justify-content:flex-end;gap:5px")}>
                          <span style={css("font:600 10.5px 'Geist Mono',monospace;white-space:nowrap;color:var(--gray-800)")}>
                            {r.c.e > 0 && <span style={css("color:var(--red-900)")}>E{r.c.e}</span>}
                            {r.c.e > 0 && r.c.g > 0 && "·"}
                            {r.c.g > 0 && <span style={css("color:var(--blue-900)")}>G{r.c.g}</span>}
                            {total === 0 && <span style={css("color:var(--gray-500)")}>0</span>}
                          </span>
                          {/* 스택 막대 — E(빨강)가 위, G(파랑)가 아래. 폭 26px = 가는 요소 */}
                          {total > 0 ? (
                            <div style={{ height: `${hPct}%`, minHeight: 10, width: 26, display: "flex", flexDirection: "column", borderRadius: 7, overflow: "hidden", transition: "height .4s var(--ease-out)" }}>
                              {r.c.e > 0 && <span style={{ flex: r.c.e, background: "var(--red-700)" }} />}
                              {r.c.g > 0 && <span style={{ flex: r.c.g, background: "var(--blue-700)" }} />}
                            </div>
                          ) : (
                            <div style={css("width:26px;height:3px;border-radius:2px;background:var(--gray-300)")} />
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
                {/* 바닥선 + 부서명 축 */}
                <div style={css("height:1px;background:var(--gray-300);margin:6px 0 5px")} />
                <div style={css("display:flex;gap:10px")}>
                  {rows.map((r) => (
                    <span
                      key={r.name}
                      style={css("flex:1;min-width:0;text-align:center;font:600 10px 'Geist Sans','Pretendard',sans-serif;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:" + (r.name === "사고·신고" ? "var(--red-900)" : "var(--gray-800)"))}
                    >
                      {r.name}
                    </span>
                  ))}
                </div>
                <div style={css("display:flex;justify-content:flex-end;gap:12px;padding:5px 2px 0")}>
                  {(["E", "G"] as const).map((k) => (
                    <span key={k} style={css("display:inline-flex;align-items:center;gap:4px;font:600 10px 'Geist Sans','Pretendard',sans-serif;color:var(--gray-700)")}>
                      <span style={css("width:8px;height:8px;border-radius:9999px;background:" + SGE_META[k].bar)} />
                      {k} {SGE_META[k].label}
                    </span>
                  ))}
                  <span style={css("font:400 10px 'Geist Sans','Pretendard',sans-serif;color:var(--gray-600)")}>막대에 올리면 대기 목록</span>
                </div>
              </>
            );
          })()}
        </div>
      )}

      {/* ── 카드 그리드 보기 — 대기 목록 상시 노출, 행 호버 시 연결·이관 ── */}
      {view === "grid" && (
        <div style={css("flex:1;display:grid;grid-template-columns:repeat(4,1fr);grid-auto-rows:minmax(0,1fr);gap:8px;min-height:0")}>
          {ordered.map((dept) => {
            const items = feed.state.queues[dept.name] ?? [];
            const counts = feed.queueCounts[dept.name] ?? { s: 0, g: 0, e: 0 };
            const urgent = counts.e > 0;
            const isIncident = dept.name === "사고·신고"; // SG — 긴급 라우팅 직결 부서
            return (
              <div
                key={dept.name}
                style={css(
                  "display:flex;flex-direction:column;min-height:0;border-radius:11px;background:var(--background-200);padding:10px 12px" +
                    (urgent ? ";outline:1.5px solid var(--red-400)" : "")
                )}
              >
                <div style={css("display:flex;align-items:center;gap:7px")}>
                  <span className="mi" style={css("font-size:16px;color:" + (urgent ? "var(--red-900)" : "var(--gray-800)"))}>
                    {isIncident ? "e911_emergency" : "groups"}
                  </span>
                  <span style={css("font:600 13px 'Geist Sans','Pretendard',sans-serif;color:var(--gray-1000);letter-spacing:-.1px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis")}>{dept.name}</span>
                  {isIncident && (
                    <span style={css("flex:none;font:700 10px 'Geist Sans','Pretendard',sans-serif;color:var(--red-900)")}>긴급 직결</span>
                  )}
                </div>

                {/* 대기 목록 — 항상 보인다. 넘치면 카드 안에서 스크롤 */}
                <div style={css("flex:1;min-height:0;overflow-y:auto;margin-top:8px;display:flex;flex-direction:column;gap:4px")}>
                  {items.length === 0 && (
                    <div style={css("font:400 11px 'Geist Sans','Pretendard',sans-serif;color:var(--gray-600);padding:2px 1px")}>대기 없음</div>
                  )}
                  {items.map((it) => {
                    const meta = SGE_META[it.sge];
                    const pickerOpen = transferFrom?.id === it.id;
                    return (
                      <div
                        key={it.id}
                        className="memorow"
                        style={css("position:relative;display:flex;align-items:center;gap:7px;background:var(--onair-surface);border:1px solid var(--gray-200);border-radius:8px;padding:5.5px 8px")}
                      >
                        <span style={css("flex:none;width:8px;height:8px;border-radius:9999px;background:" + meta.bar)} />
                        {/* 3층 업무코드 — taxonomy의 ARS 코드 (미정의 부서는 생략) */}
                        {it.code && (
                          <span style={css("flex:none;font:600 9px 'Geist Mono',monospace;letter-spacing:.3px;color:var(--gray-700)")}>{it.code}</span>
                        )}
                        <span style={css("flex:1;min-width:0;font:500 11px 'Geist Sans','Pretendard',sans-serif;color:var(--gray-1000);overflow:hidden;text-overflow:ellipsis;white-space:nowrap")}>
                          {it.label}
                        </span>
                        {it.callId && (
                          <span style={css("flex:none;font:700 8.5px 'Geist Mono',monospace;letter-spacing:.4px;color:var(--blue-900)")}>LIVE</span>
                        )}
                        {/* 액션 — 행에 올렸을 때만 (연결 · 이관) */}
                        <span className="memoact" style={css("flex:none;display:inline-flex;gap:4px")}>
                          <span
                            title="수신 가능 상담사에게 연결"
                            onClick={() => feed.connectItem(dept.name, it.id)}
                            style={css("display:flex;width:22px;height:22px;border-radius:9999px;align-items:center;justify-content:center;background:var(--gray-100);cursor:pointer")}
                          >
                            <span className="mi" style={css("font-size:13px;color:var(--green-900)")}>call</span>
                          </span>
                          <span
                            title="다른 부서로 이관"
                            onClick={() => setTransferFrom(pickerOpen ? null : { dept: dept.name, id: it.id })}
                            style={css("display:flex;width:22px;height:22px;border-radius:9999px;align-items:center;justify-content:center;background:var(--gray-100);cursor:pointer")}
                          >
                            <span className="mi" style={css("font-size:13px;color:var(--gray-800)")}>sync_alt</span>
                          </span>
                        </span>
                        {pickerOpen && (
                          <div style={css("position:absolute;right:0;top:30px;z-index:40;background:var(--onair-surface);border-radius:10px;box-shadow:var(--sh-modal);padding:6px;min-width:172px;animation:dockDown .2s var(--ease-out)")}>
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

                {/* E/G 카운트 — 신호등 문법, 카드 바닥 고정 */}
                <div style={css("margin-top:auto;padding-top:7px;display:flex;align-items:center;gap:6px")}>
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
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
