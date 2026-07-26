import { useState } from "react";
import { css } from "../../lib/css";
import { DEPARTMENTS, DEPT_AGENTS } from "../../data/adminContent";
import AvatarCircles from "../ui/AvatarCircles";
import AnimatedList from "../ui/AnimatedList";
import { SGE_META, demoBus } from "../../services";
import type { AdminFeed } from "../../hooks/useAdminFeed";

/** [D] 부서 현황 보드 — 8개 라우팅 부서 × G/E 대기열 (S는 AI 즉시 응대라 큐에 없다).
 *  대기 목록은 클릭 없이 항상 보인다 — 관제는 펼침 조작 없이 읽혀야 한다.
 *  연결·이관 액션은 행에 올렸을 때만 드러난다(.memorow 문법). 이관도 demoBus를 탄다. */
/** 아바타 정렬 순서 — 지금 콜을 받을 수 있는 사람이 맨 앞 */
const ORDER = { 대기: 0, 통화: 1, 휴식: 2 } as const;

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
      <span style={css("font:600 11.5px 'Avenir Next','Pretendard',sans-serif;color:var(--gray-700)")}>{label}</span>
      <span className="bignum" style={css("font-size:20px;color:" + valueColor)}>{value}</span>
      <span style={css("font:600 11.5px 'Avenir Next','Pretendard',sans-serif;color:var(--gray-700)")}>건</span>
    </span>
  );

  return (
    <div className="card" style={css("display:flex;flex-direction:column;padding:14px 16px 12px;min-height:0")}>
      <div style={css("display:flex;align-items:center;gap:10px;margin-bottom:12px;white-space:nowrap")}>
        <span className="sechd" style={css("white-space:nowrap")}>부서 현황 보드</span>
        {/* 설명 모드에선 이 패널의 백엔드 역할을(회색 블록 — 다른 패널과 동일 문법), 평소엔 안내를 */}
        <span
          style={css(
            "flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font:400 11px 'Avenir Next','Pretendard',sans-serif;" +
              (explain
                ? "color:var(--gray-800);background:var(--gray-100);border:1px solid var(--blue-500);border-radius:8px;padding:4px 9px;animation:dockDown .25s var(--ease-out)"
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
            /* 눈금 — 대기 건수는 정수라 눈금도 정수여야 한다(2.5건은 없다).
               최대 4칸을 넘지 않게 간격을 키운다. 눈금이 있어야 막대 높이가 뜻을 갖는다 —
               전에는 축이 없어서 "3"과 "1"의 높이 차이를 읽을 기준이 없었다. */
            const step = Math.max(1, Math.ceil(max / 4));
            const top = Math.ceil(max / step) * step;
            const ticks: number[] = [];
            for (let t = 0; t <= top; t += step) ticks.push(t);
            /* 평균 대기 — 어느 부서가 평소보다 밀렸는지는 절대값이 아니라 평균 대비로 읽힌다 */
            const avg = rows.reduce((n, r) => n + r.c.e + r.c.g, 0) / (rows.length || 1);
            const AX = 22; // y축 라벨 폭
            return (
              <>
                {/* 차트 영역 — 눈금(절대배치) 위에 막대.
                    값 라벨을 막대 위에 '쌓지' 않고 절대배치로 띄우는 게 중요하다:
                    전에는 라벨이 같은 flex 컬럼에 있어 막대의 100%가 라벨 공간까지
                    포함한 높이였다 — 그래서 눈금을 그려도 값과 어긋난다. */}
                <div style={css("flex:1;min-height:0;position:relative;padding-top:14px")}>
                  {ticks.map((t) => (
                    <div
                      key={t}
                      style={css(
                        "position:absolute;left:0;right:0;height:0;bottom:" +
                          (t / top) * 100 + "%;display:flex;align-items:center;gap:6px;pointer-events:none"
                      )}
                    >
                      <span style={css("flex:none;width:" + AX + "px;text-align:right;font:500 9px 'Avenir Next','Pretendard',sans-serif;font-variant-numeric:tabular-nums;color:var(--gray-500);transform:translateY(-1px)")}>{t}</span>
                      <span style={css("flex:1;height:1px;background:" + (t === 0 ? "var(--gray-400)" : "var(--gray-200)"))} />
                    </div>
                  ))}
                  {/* 평균선 — 눈금과 구분되게 잉크를 한 단 올리고 라벨을 붙인다 */}
                  {avg > 0 && (
                    <div style={css("position:absolute;left:" + (AX + 6) + "px;right:0;height:0;bottom:" + (avg / top) * 100 + "%;display:flex;align-items:center;pointer-events:none")}>
                      <span style={css("flex:1;height:1px;background:var(--gray-500);opacity:.7")} />
                      <span style={css("flex:none;margin-left:5px;font:600 8.5px 'Avenir Next','Pretendard',sans-serif;color:var(--gray-600);background:var(--onair-surface);padding:0 3px")}>평균 {avg.toFixed(1)}</span>
                    </div>
                  )}
                  {/* 막대 — 눈금 위에 얹는다 */}
                  <div style={css("position:absolute;left:" + (AX + 6) + "px;right:0;top:14px;bottom:0;display:flex;align-items:flex-end;gap:10px")}>
                  {rows.map((r) => {
                    const total = r.c.e + r.c.g;
                    const hPct = (total / top) * 100;
                    return (
                      <div
                        key={r.name}
                        title={r.items.length ? r.items.map((it) => (it.code ? `${it.code} ${it.label}` : it.label)).join("\n") : "대기 없음"}
                        style={css("flex:1;min-width:0;height:100%;position:relative;display:flex;align-items:flex-end;justify-content:center")}
                      >
                        {/* 값 라벨 — 막대 끝 바로 위에 절대배치(플롯 높이를 뺏지 않는다) */}
                        <span style={css("position:absolute;left:0;right:0;text-align:center;font:600 10.5px 'Avenir Next','Pretendard',sans-serif;white-space:nowrap;color:var(--gray-800);bottom:calc(" + hPct + "% + 4px)")}>
                          {r.c.e > 0 && <span style={css("color:var(--red-900)")}>E{r.c.e}</span>}
                          {r.c.e > 0 && r.c.g > 0 && "·"}
                          {r.c.g > 0 && <span style={css("color:var(--blue-900)")}>G{r.c.g}</span>}
                          {total === 0 && <span style={css("color:var(--gray-500)")}>0</span>}
                        </span>
                        {/* 스택 막대 — E(빨강)가 위, G(파랑)가 아래. 폭은 슬롯을 채우지 않는다(≤24px) */}
                        {total > 0 ? (
                          <div style={{ height: `${hPct}%`, minHeight: 6, width: 22, display: "flex", flexDirection: "column", borderRadius: "4px 4px 0 0", overflow: "hidden", transition: "height .4s var(--ease-out)" }}>
                            {r.c.e > 0 && <span style={{ flex: r.c.e, background: "var(--red-700)" }} />}
                            {r.c.g > 0 && <span style={{ flex: r.c.g, background: "var(--blue-700)" }} />}
                          </div>
                        ) : (
                          /* 0건은 막대를 세우지 않는다 — 토막을 세우면 '조금 있다'로 읽힌다 */
                          <div style={css("width:22px;height:2px;background:var(--gray-300)")} />
                        )}
                      </div>
                    );
                  })}
                  </div>
                </div>
                {/* 바닥선 + 부서명 축 */}
                <div style={css("height:0;margin:6px 0 5px")} />
                <div style={css("display:flex;gap:10px;margin-left:28px")}>
                  {rows.map((r) => (
                    <span
                      key={r.name}
                      style={css("flex:1;min-width:0;text-align:center;font:600 10px 'Avenir Next','Pretendard',sans-serif;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:" + (r.name === "사고·신고" ? "var(--red-900)" : "var(--gray-800)"))}
                    >
                      {r.name}
                    </span>
                  ))}
                </div>
                <div style={css("display:flex;justify-content:flex-end;gap:12px;padding:5px 2px 0")}>
                  {(["E", "G"] as const).map((k) => (
                    <span key={k} style={css("display:inline-flex;align-items:center;gap:4px;font:600 10px 'Avenir Next','Pretendard',sans-serif;color:var(--gray-700)")}>
                      <span style={css("width:8px;height:8px;border-radius:9999px;background:" + SGE_META[k].bar)} />
                      {k} {SGE_META[k].label}
                    </span>
                  ))}
                  <span style={css("font:400 10px 'Avenir Next','Pretendard',sans-serif;color:var(--gray-600)")}>막대에 올리면 대기 목록</span>
                </div>
              </>
            );
          })()}
        </div>
      )}

      {/* ── 카드 그리드 보기 — 대기 목록 상시 노출, 행 호버 시 연결·이관.
          컬럼도 minmax(0,1fr): 긴 항목 라벨(min-content)이 특정 칸을 넓히지 못하게 — 7칸 폭 균일 ── */}
      {view === "grid" && (
        <div style={css("flex:1;display:grid;grid-template-columns:repeat(4,minmax(0,1fr));grid-auto-rows:minmax(0,1fr);gap:8px;min-height:0")}>
          {ordered.map((dept) => {
            const items = feed.state.queues[dept.name] ?? [];
            const counts = feed.queueCounts[dept.name] ?? { s: 0, g: 0, e: 0 };
            const urgent = counts.e > 0;
            // 상담사 원 — 수신 가능한 사람이 앞에 서도록 대기 → 통화 → 휴식 순
            const agents = [...(DEPT_AGENTS[dept.name] ?? [])].sort(
              (a, b) => ORDER[a.state] - ORDER[b.state]
            );
            const free = agents.filter((a) => a.state === "대기").length;
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
                  <span className="mi" style={css("flex:none;font-size:16px;color:" + (urgent ? "var(--red-900)" : "var(--gray-800)"))}>
                    {isIncident ? "e911_emergency" : "groups"}
                  </span>
                  <span style={css("min-width:0;font:600 13px 'Avenir Next','Pretendard',sans-serif;color:var(--gray-1000);letter-spacing:-.1px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis")}>{dept.name}</span>
                  {isIncident && (
                    <span style={css("flex:none;font:700 10px 'Avenir Next','Pretendard',sans-serif;color:var(--red-900)")}>긴급 직결</span>
                  )}
                  <div style={css("flex:1")} />
                  {/* 대기 건수 — 카드에서 제일 먼저 읽혀야 할 숫자라 헤더 우측에 크게 */}
                  <span style={css("flex:none;display:inline-flex;align-items:baseline;gap:3px")}>
                    <span className="bignum" style={css("font-size:17px;color:" + (urgent ? "var(--red-900)" : items.length > 0 ? "var(--gray-1000)" : "var(--gray-500)"))}>{items.length}</span>
                    <span style={css("font:600 10.5px 'Avenir Next','Pretendard',sans-serif;color:var(--gray-700)")}>건</span>
                  </span>
                </div>

                {/* 상담사 — 대기 건수 바로 아래. "몇 건이 밀렸나" 다음 질문이 "받을 사람이 있나"라
                    두 숫자는 붙어 있어야 한다. 수신 가능 0명이면 대기 건수가 같아도 다른 상황이다. */}
                <div style={css("display:flex;align-items:center;gap:6px;margin-top:7px")}>
                  <AvatarCircles people={agents} max={4} size={20} />
                  <span style={css("font:600 10.5px 'Avenir Next','Pretendard',sans-serif;color:" + (free === 0 ? "var(--red-900)" : "var(--gray-700)"))}>
                    {free === 0 ? "수신 가능 없음" : "수신 가능 " + free + "명"}
                  </span>
                </div>

                {/* 대기 목록 — 항상 보인다. 넘치면 카드 안에서 스크롤 */}
                <div style={css("flex:1;min-height:0;overflow-y:auto;margin-top:8px;display:flex;flex-direction:column;gap:4px")}>
                  {items.length === 0 && (
                    <div style={css("font:400 11px 'Avenir Next','Pretendard',sans-serif;color:var(--gray-600);padding:2px 1px")}>대기 없음</div>
                  )}
                  <AnimatedList>
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
                          <span style={css("flex:none;font:600 9px 'Avenir Next','Pretendard',sans-serif;letter-spacing:.3px;color:var(--gray-700)")}>{it.code}</span>
                        )}
                        <span style={css("flex:1;min-width:0;font:500 11px 'Avenir Next','Pretendard',sans-serif;color:var(--gray-1000);overflow:hidden;text-overflow:ellipsis;white-space:nowrap")}>
                          {it.label}
                        </span>
                        {it.callId && (
                          <span style={css("flex:none;font:700 8.5px 'Avenir Next','Pretendard',sans-serif;letter-spacing:.4px;color:var(--blue-900)")}>LIVE</span>
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
                            <div style={css("font:700 10px 'Avenir Next','Pretendard',sans-serif;color:var(--gray-600);padding:4px 8px 5px")}>이관할 부서</div>
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
                                style={css("font:500 11.5px 'Avenir Next','Pretendard',sans-serif;color:var(--gray-1000);border-radius:7px;padding:6px 8px;cursor:pointer;transition:background .15s")}
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
                  </AnimatedList>
                </div>

                {/* 분해 램프 — E는 taxonomy상 사고·신고에만 존재(E→SG 강제)하므로 다른 부서엔 G만 */}
                <div style={css("margin-top:auto;padding-top:7px;display:flex;align-items:center;gap:10px")}>
                  {(isIncident ? (["E", "G"] as const) : (["G"] as const)).map((k) => {
                    const n = k === "G" ? counts.g : counts.e;
                    const meta = SGE_META[k];
                    const dim = { E: "rgba(188,63,43,.4)", G: "rgba(47,95,196,.35)" }[k];
                    return (
                      <span
                        key={k}
                        style={css(
                          "display:inline-flex;align-items:center;gap:5px;font:700 12.5px 'Avenir Next','Pretendard',sans-serif;transition:opacity .3s;" +
                            (n > 0 ? "color:" + meta.fg : "color:var(--gray-500)")
                        )}
                      >
                        <span style={css("width:9px;height:9px;border-radius:9999px;flex:none;background:" + (n > 0 ? meta.bar : dim))} />
                        {k} {n}
                      </span>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
