import { useEffect, useState } from "react";
import { Bell, GraduationCap, History } from "lucide-react";
import { css } from "../../lib/css";
import { AGENT, SHEETS } from "../../data/demoContent";

/**
 * 아침 대기 화면 (phase === "idle") — "기다리는 콜센터 → 준비되는 콜센터".
 * 큰 시계(Geist Sans — 모노의 슬래시 제로 회피) + 준비 공간 4타일:
 * 오늘 처리 내역 · 알림 · 코칭·리뷰 · 매뉴얼. 각 서브 화면은 서로 다른 구조.
 * 아이콘: Lucide(업계 표준) — 매뉴얼만 기존 Material 유지(사용자 지시).
 * 상태 표시는 우상단 램프 한 곳만. 온에어 문법: 빛 없음, 그림자가 위계.
 */

const DAYS = ["일", "월", "화", "수", "목", "금", "토"];
const two = (n: number) => (n < 10 ? "0" + n : "" + n);

type PrepKey = "today" | "alerts" | "coach" | "manual";

const TODAY = {
  count: 12,
  wrapDone: 11,
  avgTalk: "03:42",
  rows: [
    { time: "14:05", type: "수신 › 이체한도 상향", status: "후처리 완료" },
    { time: "13:40", type: "카드 › 재발급", status: "후처리 완료" },
    { time: "11:52", type: "대출 › 상환일정 문의", status: "후처리 완료" },
    { time: "10:14", type: "전자금융 › OTP 재발급", status: "콜백 예약" },
    { time: "09:47", type: "대출 › 중도상환수수료", status: "후처리 완료" },
    { time: "09:12", type: "수신 › 예금 만기 안내", status: "후처리 완료" },
  ],
};

const ALERTS = [
  {
    title: "사고대응팀 인계 회신 도착",
    sub: "명의도용 의심 건 — 지급정지 처리 완료, 고객 안내 필요",
    time: "10분 전",
    unread: true,
    today: true,
    action: "안내 전화 걸기",
  },
  {
    title: "예약 콜백 · 오늘 11:00",
    sub: "착오송금 반환 절차 안내 — 고객과 약속한 회신 전화",
    time: "예정",
    unread: true,
    today: true,
    action: "콜백 시작",
  },
  {
    title: "여신 업무매뉴얼 v25 개정",
    sub: "중도상환수수료 면제 기준 일부 변경",
    time: "어제",
    unread: false,
    today: false,
    action: "",
  },
  {
    title: "품질 평가 결과 도착 · 6월",
    sub: "상담 품질 A등급 — 상세는 코칭·리뷰에서",
    time: "그저께",
    unread: false,
    today: false,
    action: "",
  },
];

const COACH = {
  stats: [
    { label: "어제 처리", value: "12콜" },
    { label: "감정온도", value: "안정 유지" },
    { label: "이관", value: "0건" },
  ],
  /* 최근 7일 처리량 — 막대 미니 차트용 */
  trend: [
    { day: "토", n: 8 },
    { day: "일", n: 0 },
    { day: "월", n: 11 },
    { day: "화", n: 9 },
    { day: "수", n: 13 },
    { day: "목", n: 10 },
    { day: "금", n: 12 },
  ],
  warmup: [
    { label: "오프닝 멘트 3종 낭독 — 공감·사실확인·마무리", meta: "3분" },
    { label: "발성·속도 체크 (권장 속도 대비)", meta: "2분" },
  ],
  good: "사실확인 단계 누락 없음 — 전 콜에서 유지",
  improve: "마무리 후속 안내 문장을 한 호흡 짧게",
};

const MANUAL_ROWS = [
  { icon: "gavel", label: "착오송금 반환지원 제도 — 예금보험공사 절차", meta: "규정" },
  { icon: "shield", label: "본인확인·고위험 인계 기준 (ADR-0009)", meta: "규정" },
  { icon: "block", label: "카드 금지정보 — DTMF·OTP·전체 계좌번호", meta: "필독" },
];

function Lamp({ tone, label }: { tone: "g" | "a"; label: string }) {
  return (
    <span style={css("display:inline-flex;align-items:center;gap:8px")}>
      <span
        style={css(
          "width:9px;height:9px;border-radius:9999px;flex:none;background:" +
            (tone === "g" ? "var(--green-700)" : "var(--amber-700)")
        )}
      />
      <span style={css("font:600 12px 'Geist Sans','Pretendard',sans-serif;color:var(--gray-700)")}>{label}</span>
    </span>
  );
}

/** 서브 화면 공통 헤더 — 뒤로가기는 각진 버튼(원형은 프로필 아바타와 충돌) */
function SubHead({ onBack, title, sub }: { onBack: () => void; title: string; sub: string }) {
  return (
    <div style={css("display:flex;align-items:center;gap:10px;margin-bottom:16px")}>
      <span
        onClick={onBack}
        title="대기 화면으로"
        style={css(
          "width:34px;height:34px;border-radius:8px;border:1px solid var(--gray-300);background:var(--onair-surface);display:flex;align-items:center;justify-content:center;color:var(--gray-900);cursor:pointer"
        )}
      >
        <span className="mi" style={css("font-size:19px")}>arrow_back</span>
      </span>
      <span style={css("font:700 20px 'Geist Sans','Pretendard',sans-serif;color:var(--gray-1000)")}>{title}</span>
      <span style={css("margin-left:8px;font:600 13px 'Geist Sans','Pretendard',sans-serif;color:var(--gray-700)")}>{sub}</span>
    </div>
  );
}

export default function Standby() {
  const [now, setNow] = useState(() => new Date());
  const [view, setView] = useState<PrepKey | null>(null);
  const [onBreak, setOnBreak] = useState(false);
  // 알림 읽음 처리 + 필터 (읽으면 타일 배지도 줄어든다)
  const [readSet, setReadSet] = useState<Set<number>>(new Set());
  const [alertFilter, setAlertFilter] = useState<"all" | "unread">("all");
  // 워밍업 체크
  const [warmDone, setWarmDone] = useState<Set<number>>(new Set());
  const isUnread = (i: number) => ALERTS[i].unread && !readSet.has(i);
  const unreadCount = ALERTS.filter((_, i) => isUnread(i)).length;

  useEffect(() => {
    const t = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(t);
  }, []);

  const hh = two(now.getHours());
  const mm = two(now.getMinutes());
  const ss = two(now.getSeconds());
  const dateStr = `${now.getMonth() + 1}월 ${now.getDate()}일 (${DAYS[now.getDay()]})`;
  const back = () => setView(null);

  return (
    <div
      style={css(
        "width:1100px;height:688px;background:var(--onair-surface);border-radius:12px;box-shadow:var(--sh-near);display:flex;flex-direction:column;font-family:'Geist Sans','Pretendard',system-ui,sans-serif;overflow:hidden"
      )}
    >
      {/* ── 상단: 프로필 + 날짜/상태 (상태 표시는 여기 한 곳만) ── */}
      <div style={css("flex:none;display:flex;align-items:center;justify-content:space-between;padding:22px 26px")}>
        <div style={css("display:flex;align-items:center;gap:13px")}>
          <span className="av" style={css("width:44px;height:44px;font-size:20px")}>
            <span className="mi">account_circle</span>
          </span>
          <div>
            <div style={css("display:flex;align-items:center;gap:8px")}>
              <span style={css("font:700 16px 'Geist Sans','Pretendard',sans-serif;color:var(--gray-1000)")}>
                {AGENT.name} {AGENT.role}
              </span>
              {/* 숙련도 — 틴트 없이 잉크만 */}
              <span
                title="부서 내 숙련도 — 이관 방향(주니어→시니어)의 기준"
                style={css(
                  "display:inline-flex;align-items:center;gap:3px;font:700 11.5px 'Geist Sans','Pretendard',sans-serif;color:" +
                    (AGENT.level === "시니어" ? "var(--green-900)" : "var(--amber-900)")
                )}
              >
                <span className="mi" style={css("font-size:13px")}>
                  {AGENT.level === "시니어" ? "workspace_premium" : "school"}
                </span>
                {AGENT.level}
              </span>
            </div>
            <div style={css("font:500 12px 'Geist Sans','Pretendard',sans-serif;color:var(--gray-700);margin-top:3px")}>
              {AGENT.dept} · {AGENT.tenure} · {AGENT.id}
            </div>
          </div>
        </div>
        <div style={css("display:flex;flex-direction:column;align-items:flex-end;gap:7px")}>
          <span style={css("font:600 13px 'Geist Sans','Pretendard',sans-serif;color:var(--gray-800)")}>{dateStr}</span>
          {onBreak ? <Lamp tone="a" label="휴식 중" /> : <Lamp tone="g" label="대기 중 · 수신 가능" />}
        </div>
      </div>

      {view === "today" && (
        <div style={css("flex:1;display:flex;flex-direction:column;padding:6px 26px 26px;min-height:0")}>
          <SubHead onBack={back} title="처리 내역" sub="오늘" />
          {/* 요약 스탯 3장 */}
          <div style={css("display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px;margin-bottom:12px")}>
            {[
              { label: "처리", value: `${TODAY.count}건` },
              { label: "후처리 완료", value: `${TODAY.wrapDone}건` },
              { label: "평균 통화", value: TODAY.avgTalk },
            ].map((s) => (
              <div key={s.label} style={css("background:var(--background-200);border-radius:8px;padding:13px 16px")}>
                <div style={css("font:600 11px 'Geist Sans','Pretendard',sans-serif;color:var(--gray-700)")}>{s.label}</div>
                <div className="bignum" style={css("font-size:19px;color:var(--gray-1000);margin-top:4px")}>{s.value}</div>
              </div>
            ))}
          </div>
          {/* 시간축 리스트 — 최근 콜이 위 */}
          <div style={css("background:var(--background-200);border-radius:8px;overflow:auto;min-height:0")}>
            {TODAY.rows.map((r, i) => (
              <div key={i} style={css("display:flex;align-items:center;gap:14px;padding:12px 18px" + (i < TODAY.rows.length - 1 ? ";border-bottom:1px solid var(--gray-200)" : ""))}>
                <span style={css("font:600 12.5px 'Geist Mono',monospace;color:var(--gray-700);width:44px;flex:none")}>{r.time}</span>
                <span style={css("flex:1;font:600 14px 'Geist Sans','Pretendard',sans-serif;color:var(--gray-1000)")}>{r.type}</span>
                <span style={css("font:600 11px 'Geist Sans','Pretendard',sans-serif;color:" + (r.status === "후처리 완료" ? "var(--green-900)" : "var(--amber-900)"))}>{r.status}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {view === "alerts" && (
        <div style={css("flex:1;display:flex;flex-direction:column;padding:6px 26px 26px;min-height:0")}>
          <SubHead onBack={back} title="알림" sub={unreadCount > 0 ? `읽지 않음 ${unreadCount}건` : "모두 읽음"} />
          {/* 필터 칩 + 모두 읽음 */}
          <div style={css("display:flex;align-items:center;gap:6px;margin-bottom:12px")}>
            {([
              ["all", "전체"],
              ["unread", `안 읽음 ${unreadCount}`],
            ] as const).map(([key, label]) => (
              <span
                key={key}
                onClick={() => setAlertFilter(key)}
                style={css(
                  "padding:6px 14px;border-radius:9999px;font:600 12px 'Geist Sans','Pretendard',sans-serif;cursor:pointer;" +
                    (alertFilter === key
                      ? "background:var(--gray-1000);color:var(--onair-surface)"
                      : "background:var(--gray-100);color:var(--gray-800)")
                )}
              >
                {label}
              </span>
            ))}
            {unreadCount > 0 && (
              <span
                onClick={() => setReadSet(new Set(ALERTS.map((_, i) => i)))}
                style={css("margin-left:auto;font:600 12px 'Geist Sans','Pretendard',sans-serif;color:var(--blue-700);cursor:pointer")}
              >
                모두 읽음 처리
              </span>
            )}
          </div>
          {/* 오늘 / 이전 섹션 */}
          <div style={css("flex:1;overflow:auto;min-height:0;display:flex;flex-direction:column;gap:14px")}>
            {([
              ["오늘", ALERTS.map((a, i) => ({ a, i })).filter(({ a }) => a.today)],
              ["이전", ALERTS.map((a, i) => ({ a, i })).filter(({ a }) => !a.today)],
            ] as const).map(([label, items]) => {
              const visible = items.filter(({ i }) => alertFilter === "all" || isUnread(i));
              if (!visible.length) return null;
              return (
                <div key={label}>
                  <div style={css("font:700 11px 'Geist Sans','Pretendard',sans-serif;color:var(--gray-600);letter-spacing:.4px;margin-bottom:7px")}>{label}</div>
                  <div style={css("display:flex;flex-direction:column;gap:8px")}>
                    {visible.map(({ a, i }) => {
                      const un = isUnread(i);
                      return (
                        <div
                          key={i}
                          onClick={() => setReadSet((s) => new Set(s).add(i))}
                          style={css(
                            "display:flex;align-items:flex-start;gap:12px;padding:13px 16px;border-radius:8px;cursor:pointer;transition:opacity .25s,box-shadow .25s;" +
                              (un ? "background:var(--onair-surface);box-shadow:var(--sh-near)" : "background:var(--background-200);opacity:.72")
                          )}
                        >
                          <span style={css("width:8px;height:8px;border-radius:9999px;margin-top:5px;flex:none;transition:background .25s;background:" + (un ? "var(--blue-700)" : "var(--gray-300)"))} />
                          <div style={css("flex:1")}>
                            <div style={css("font:700 13.5px 'Geist Sans','Pretendard',sans-serif;color:var(--gray-1000)")}>{a.title}</div>
                            <div style={css("font:400 12px/1.5 'Geist Sans','Pretendard',sans-serif;color:var(--gray-700);margin-top:2px")}>{a.sub}</div>
                          </div>
                          {a.action && un && (
                            <span style={css("flex:none;display:inline-flex;align-items:center;gap:4px;padding:6px 12px;border-radius:9999px;border:1px solid var(--blue-400);color:var(--blue-700);font:600 11.5px 'Geist Sans','Pretendard',sans-serif")}>
                              <span className="mi" style={css("font-size:14px")}>call</span>
                              {a.action}
                            </span>
                          )}
                          <span style={css("font:600 11px 'Geist Mono',monospace;color:var(--gray-600);flex:none;margin-top:2px")}>{a.time}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {view === "coach" && (
        <div style={css("flex:1;display:flex;flex-direction:column;padding:6px 26px 26px;min-height:0")}>
          <SubHead onBack={back} title="코칭·리뷰" sub="어제 성과 + 오늘의 워밍업" />
          <div style={css("flex:1;display:flex;gap:14px;min-height:0")}>
            {/* 좌 — 성과: 스탯 + 7일 추이 + AI 코칭 */}
            <div style={css("flex:1.3;display:flex;flex-direction:column;gap:12px;min-width:0")}>
              <div style={css("display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px")}>
                {COACH.stats.map((s) => (
                  <div key={s.label} style={css("background:var(--background-200);border-radius:8px;padding:13px 16px")}>
                    <div style={css("font:600 11px 'Geist Sans','Pretendard',sans-serif;color:var(--gray-700)")}>{s.label}</div>
                    <div className="bignum" style={css("font-size:19px;color:var(--gray-1000);margin-top:4px")}>{s.value}</div>
                  </div>
                ))}
              </div>
              {/* 최근 7일 처리량 — 막대 미니 차트 */}
              <div style={css("background:var(--background-200);border-radius:8px;padding:14px 16px")}>
                <div style={css("font:600 11px 'Geist Sans','Pretendard',sans-serif;color:var(--gray-700);margin-bottom:12px")}>최근 7일 처리량</div>
                <div style={css("display:flex;align-items:flex-end;gap:10px;height:64px")}>
                  {COACH.trend.map((d, i) => {
                    const max = Math.max(...COACH.trend.map((x) => x.n));
                    const isLast = i === COACH.trend.length - 1;
                    return (
                      <div key={i} style={css("flex:1;display:flex;flex-direction:column;align-items:center;gap:5px;height:100%;justify-content:flex-end")}>
                        <span className="bignum" style={css("font-size:10.5px;color:" + (isLast ? "var(--gray-1000)" : "var(--gray-600)"))}>{d.n || ""}</span>
                        <span style={css("width:100%;border-radius:3px 3px 0 0;background:" + (isLast ? "var(--blue-700)" : "var(--gray-400)") + ";height:" + Math.max(3, Math.round((d.n / max) * 38)) + "px")} />
                        <span style={css("font:600 10px 'Geist Sans','Pretendard',sans-serif;color:var(--gray-600)")}>{d.day}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
              {/* AI 코칭 */}
              <div style={css("background:var(--background-200);border-radius:8px;padding:14px 16px;display:flex;flex-direction:column;gap:8px")}>
                <div style={css("font:600 11px 'Geist Sans','Pretendard',sans-serif;color:var(--gray-700)")}>AI 코칭 — 어제 12콜 기반</div>
                <div style={css("display:flex;align-items:baseline;gap:8px")}>
                  <span style={css("font:700 11px 'Geist Sans','Pretendard',sans-serif;color:var(--green-900);flex:none")}>잘한 점</span>
                  <span style={css("font:400 13px/1.5 'Geist Sans','Pretendard',sans-serif;color:var(--gray-900)")}>{COACH.good}</span>
                </div>
                <div style={css("display:flex;align-items:baseline;gap:8px")}>
                  <span style={css("font:700 11px 'Geist Sans','Pretendard',sans-serif;color:var(--amber-900);flex:none")}>개선</span>
                  <span style={css("font:400 13px/1.5 'Geist Sans','Pretendard',sans-serif;color:var(--gray-900)")}>{COACH.improve}</span>
                </div>
              </div>
            </div>
            {/* 우 — 오늘의 워밍업 (체크 인터랙션 + 게이지) */}
            <div style={css("flex:1;display:flex;flex-direction:column;min-width:0")}>
              <div style={css("display:flex;align-items:center;gap:8px;margin-bottom:8px")}>
                <span style={css("font:700 12px 'Geist Sans','Pretendard',sans-serif;color:var(--gray-800)")}>오늘의 워밍업</span>
                <span style={css("margin-left:auto;display:flex;align-items:center;gap:6px")}>
                  <span style={css("display:flex;gap:3px")}>
                    {COACH.warmup.map((_, i) => (
                      <span key={i} style={css("width:20px;height:5px;border-radius:2px;transition:background .25s;background:" + (warmDone.has(i) ? "var(--green-700)" : "var(--gray-200)"))} />
                    ))}
                  </span>
                  <span style={css("font:600 11px 'Geist Mono',monospace;color:var(--gray-700)")}>{warmDone.size}/{COACH.warmup.length}</span>
                </span>
              </div>
              <div style={css("display:flex;flex-direction:column;gap:8px")}>
                {COACH.warmup.map((w, i) => {
                  const on = warmDone.has(i);
                  return (
                    <div
                      key={i}
                      onClick={() =>
                        setWarmDone((s) => {
                          const next = new Set(s);
                          if (on) next.delete(i);
                          else next.add(i);
                          return next;
                        })
                      }
                      style={css(
                        "display:flex;align-items:center;gap:12px;padding:13px 16px;border-radius:8px;cursor:pointer;user-select:none;transition:background .2s;background:" +
                          (on ? "var(--gray-100)" : "var(--background-200)")
                      )}
                    >
                      <span
                        style={css(
                          "width:19px;height:19px;border-radius:9999px;flex:none;box-sizing:border-box;display:flex;align-items:center;justify-content:center;transition:background .2s;" +
                            (on ? "background:var(--green-700);color:#fff" : "border:1.5px solid var(--gray-500);background:var(--onair-surface)")
                        )}
                      >
                        {on && <span className="mi" style={css("font-size:13px")}>check</span>}
                      </span>
                      <span style={css("flex:1;font:500 13.5px/1.45 'Geist Sans','Pretendard',sans-serif;color:var(--gray-1000)" + (on ? ";text-decoration:line-through;opacity:.6" : ""))}>{w.label}</span>
                      <span style={css("font:600 12px 'Geist Mono',monospace;color:var(--gray-700)")}>{w.meta}</span>
                    </div>
                  );
                })}
              </div>
              {warmDone.size === COACH.warmup.length && (
                <div style={css("margin-top:10px;display:flex;align-items:center;gap:6px;font:600 12.5px 'Geist Sans','Pretendard',sans-serif;color:var(--green-900)")}>
                  <span className="mi" style={css("font-size:16px")}>check_circle</span>
                  워밍업 완료 — 첫 콜 받을 준비가 됐어요
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {view === "manual" && (
        <div style={css("flex:1;display:flex;flex-direction:column;padding:6px 26px 26px;min-height:0")}>
          <SubHead onBack={back} title="매뉴얼" sub="규정·업무 가이드" />
          {/* 좌: 검색+목록(고정폭) / 우: 규정집 시트가 바로 펼쳐진다 */}
          <div style={css("flex:1;display:flex;gap:14px;min-height:0")}>
            <div style={css("width:330px;flex:none;display:flex;flex-direction:column;gap:8px")}>
              <div style={css("display:flex;align-items:center;gap:8px;border:1px solid var(--gray-400);border-radius:9999px;padding:9px 14px;background:var(--onair-surface);margin-bottom:2px")}>
                <span className="mi" style={css("font-size:17px;color:var(--gray-700)")}>search</span>
                <span style={css("font:400 13px 'Geist Sans','Pretendard',sans-serif;color:var(--gray-600)")}>규정·절차 검색</span>
              </div>
              {MANUAL_ROWS.map((r, i) => (
                <div key={i} className="ptile" style={css("display:flex;align-items:center;gap:11px;padding:12px 14px;background:var(--background-200);border-radius:8px;box-shadow:none")}>
                  <span className="mi" style={css("font-size:18px;color:var(--gray-700);flex:none")}>{r.icon}</span>
                  <span style={css("flex:1;font:500 13px/1.45 'Geist Sans','Pretendard',sans-serif;color:var(--gray-1000)")}>{r.label}</span>
                  <span style={css("font:600 10.5px 'Geist Sans','Pretendard',sans-serif;color:var(--gray-700);flex:none")}>{r.meta}</span>
                </div>
              ))}
            </div>
            {/* 우: 엑셀 시트 뷰 (통화 화면의 규정 확장과 같은 문법) */}
            <div style={css("flex:1;min-width:0;background:var(--onair-surface);border-radius:8px;box-shadow:var(--sh-near);overflow:hidden;display:flex;flex-direction:column")}>
              <div style={css("display:flex;align-items:center;gap:8px;padding:9px 14px;background:var(--gray-1000);color:#fff;flex:none")}>
                <span className="mi" style={css("font-size:17px")}>grid_on</span>
                <span style={css("font:600 12.5px 'Geist Sans','Pretendard',sans-serif")}>{SHEETS.manual.file}</span>
                <span style={css("font:400 11px 'Geist Mono',monospace;opacity:.8")}>· {SHEETS.manual.sheet} 시트</span>
              </div>
              <div style={css("flex:1;min-height:0;overflow:auto;background:#fff")}>
                <div style={css("display:flex;flex-direction:column;min-width:max-content")}>
                  <div style={css("display:flex;position:sticky;top:0")}>
                    <span style={css("width:34px;flex:none;background:var(--gray-100);border-right:1px solid var(--gray-300);border-bottom:1px solid var(--gray-300)")} />
                    {SHEETS.manual.cols.map((c, i) => (
                      <span key={i} style={css("width:" + c.w + "px;flex:none;padding:8px 10px;background:var(--gray-100);border-right:1px solid var(--gray-300);border-bottom:1px solid var(--gray-300);font:700 12px 'Geist Sans','Pretendard',sans-serif;color:var(--gray-900)")}>{c.l}</span>
                    ))}
                  </div>
                  {SHEETS.manual.rows.map((row, ri) => (
                    <div key={ri} style={css("display:flex")}>
                      <span style={css("width:34px;flex:none;padding:8px 0;text-align:center;background:var(--gray-100);border-right:1px solid var(--gray-300);border-bottom:1px solid var(--gray-200);font:400 11px 'Geist Mono',monospace;color:var(--gray-600)")}>{ri + 1}</span>
                      {row.map((cell, ci) => (
                        <span key={ci} style={css("width:" + SHEETS.manual.cols[ci].w + "px;flex:none;padding:8px 10px;border-right:1px solid var(--gray-200);border-bottom:1px solid var(--gray-200);font:400 12px/1.5 'Geist Sans','Pretendard',sans-serif;color:var(--gray-1000)")}>{cell}</span>
                      ))}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {!view && (
        /* ── 대기(시계) 화면 ── */
        <div style={css("flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:0")}>
          {/* 시계 — .bignum 규칙(Geist Sans 600 · tabular · 자간 -2%), 콜론 양옆 숨 쉴 간격 */}
          <div
            className="bignum"
            style={css(
              "display:flex;align-items:baseline;" + (onBreak ? "color:var(--gray-600)" : "color:var(--gray-1000)")
            )}
          >
            <span style={css("font-size:108px")}>{hh}</span>
            <span style={css("font-size:92px;margin:0 10px;transform:translateY(-6px);color:var(--gray-500)")}>:</span>
            <span style={css("font-size:108px")}>{mm}</span>
            <span style={css("font-size:36px;color:var(--gray-500);margin-left:16px")}>{ss}</span>
          </div>
          <div style={css("margin-top:16px;font:500 15px 'Geist Sans','Pretendard',sans-serif;color:var(--gray-700)")}>
            {onBreak
              ? "휴식 중입니다 — 복귀하면 다시 수신 대기로 전환됩니다"
              : "전화가 오면 AI가 용건을 정리해, 준비 카드가 이 자리에 도착합니다"}
          </div>
          {onBreak ? (
            <span
              onClick={() => setOnBreak(false)}
              style={css(
                "margin-top:26px;display:inline-flex;align-items:center;gap:7px;padding:12px 26px;border-radius:9999px;background:var(--blue-700);color:#fff;font:600 14px 'Geist Sans','Pretendard',sans-serif;cursor:pointer;box-shadow:var(--sh-focus)"
              )}
            >
              <span className="mi" style={css("font-size:19px")}>play_arrow</span>복귀하기
            </span>
          ) : (
            <div style={css("margin-top:36px;display:flex;gap:12px")}>
              {/* 처리 내역 */}
              <div onClick={() => setView("today")} className="card ptile" style={css("width:170px;padding:18px 16px;display:flex;flex-direction:column;gap:9px;box-shadow:var(--sh-far)")}>
                <div style={css("display:flex;align-items:center;justify-content:space-between")}>
                  <History size={24} color="var(--blue-700)" strokeWidth={1.8} />
                  <span className="bignum" style={css("font-size:15px;color:var(--gray-1000)")}>{TODAY.count}<span style={css("font:600 11px 'Geist Sans','Pretendard',sans-serif;color:var(--gray-600)")}>건</span></span>
                </div>
                <span style={css("font:700 14px 'Geist Sans','Pretendard',sans-serif;color:var(--gray-1000)")}>처리 내역</span>
                <span style={css("font:500 11.5px 'Geist Sans','Pretendard',sans-serif;color:var(--gray-700);line-height:1.4")}>후처리 {TODAY.wrapDone}건 완료</span>
              </div>
              {/* 매뉴얼 — 아이콘 유지 */}
              <div onClick={() => setView("manual")} className="card ptile" style={css("width:170px;padding:18px 16px;display:flex;flex-direction:column;gap:9px;box-shadow:var(--sh-far)")}>
                <span className="mi" style={css("font-size:24px;color:var(--blue-700)")}>menu_book</span>
                <span style={css("font:700 14px 'Geist Sans','Pretendard',sans-serif;color:var(--gray-1000)")}>매뉴얼</span>
                <span style={css("font:500 11.5px 'Geist Sans','Pretendard',sans-serif;color:var(--gray-700);line-height:1.4")}>규정·업무 가이드</span>
              </div>
              {/* 코칭·리뷰 */}
              <div onClick={() => setView("coach")} className="card ptile" style={css("width:170px;padding:18px 16px;display:flex;flex-direction:column;gap:9px;box-shadow:var(--sh-far)")}>
                <GraduationCap size={24} color="var(--blue-700)" strokeWidth={1.8} />
                <span style={css("font:700 14px 'Geist Sans','Pretendard',sans-serif;color:var(--gray-1000)")}>코칭·리뷰</span>
                <span style={css("font:500 11.5px 'Geist Sans','Pretendard',sans-serif;color:var(--gray-700);line-height:1.4")}>어제 피드백 · 워밍업</span>
              </div>
              {/* 알림 — 카운트는 종 아이콘 우상단 배지로 */}
              <div onClick={() => setView("alerts")} className="card ptile" style={css("width:170px;padding:18px 16px;display:flex;flex-direction:column;gap:9px;box-shadow:var(--sh-far)")}>
                <span style={css("position:relative;display:inline-flex;width:24px")}>
                  <Bell size={24} color="var(--blue-700)" strokeWidth={1.8} />
                  {unreadCount > 0 && (
                    <span style={css("position:absolute;top:-5px;right:-8px;min-width:16px;height:16px;padding:0 4px;border-radius:9999px;background:var(--red-700);color:#fff;font:700 10px 'Geist Sans',sans-serif;display:flex;align-items:center;justify-content:center;box-sizing:border-box")}>{unreadCount}</span>
                  )}
                </span>
                <span style={css("font:700 14px 'Geist Sans','Pretendard',sans-serif;color:var(--gray-1000)")}>알림</span>
                <span style={css("font:500 11.5px 'Geist Sans','Pretendard',sans-serif;color:var(--gray-700);line-height:1.4")}>사고대응팀 회신 · 콜백 예약</span>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── 하단: 휴식 토글 ── */}
      {!view && !onBreak && (
        <div style={css("flex:none;display:flex;justify-content:center;padding-bottom:22px")}>
          <span
            onClick={() => setOnBreak(true)}
            style={css(
              "display:inline-flex;align-items:center;gap:7px;padding:10px 20px;border-radius:9999px;background:var(--onair-surface);box-shadow:var(--sh-near);color:var(--gray-800);font:600 13px 'Geist Sans','Pretendard',sans-serif;cursor:pointer"
            )}
          >
            <span className="mi" style={css("font-size:18px")}>local_cafe</span>휴식하기
          </span>
        </div>
      )}
    </div>
  );
}
