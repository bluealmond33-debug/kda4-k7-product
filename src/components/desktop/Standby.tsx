import { useEffect, useState } from "react";
import { Bell, GraduationCap, History } from "lucide-react";
import { css } from "../../lib/css";
import { AGENT } from "../../data/demoContent";

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
  rows: [
    { time: "14:05", type: "수신 › 이체한도 상향", status: "후처리 완료" },
    { time: "13:40", type: "카드 › 재발급", status: "후처리 완료" },
    { time: "11:52", type: "대출 › 상환일정 문의", status: "후처리 완료" },
    { time: "10:14", type: "전자금융 › OTP 재발급", status: "콜백 예약" },
  ],
};

const ALERTS = [
  {
    title: "사고대응팀 인계 회신 도착",
    sub: "명의도용 의심 건 — 지급정지 처리 완료, 고객 안내 필요",
    time: "10분 전",
    unread: true,
  },
  {
    title: "예약 콜백 · 오늘 11:00",
    sub: "착오송금 반환 절차 안내 — 고객과 약속한 회신 전화",
    time: "예정",
    unread: true,
  },
  {
    title: "여신 업무매뉴얼 v25 개정",
    sub: "중도상환수수료 면제 기준 일부 변경",
    time: "어제",
    unread: false,
  },
];

const COACH = {
  stats: [
    { label: "어제 처리", value: "12콜" },
    { label: "감정온도", value: "안정 유지" },
    { label: "이관", value: "0건" },
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
      <span className="lampdots">
        <i className="r" />
        <i className={"a" + (tone === "a" ? " lit" : "")} />
        <i className={"g" + (tone === "g" ? " lit" : "")} />
      </span>
      <span style={css("font:600 12px 'Geist Sans','Pretendard',sans-serif;color:var(--gray-700)")}>{label}</span>
    </span>
  );
}

/** 서브 화면 공통 헤더 (뒤로가기 + 제목 + 부제) */
function SubHead({ onBack, title, sub }: { onBack: () => void; title: string; sub: string }) {
  return (
    <div style={css("display:flex;align-items:center;gap:10px;margin-bottom:16px")}>
      <span className="cbtn" onClick={onBack} title="대기 화면으로" style={css("cursor:pointer")}>
        <span className="mi" style={css("font-size:20px")}>arrow_back</span>
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
          <SubHead onBack={back} title="오늘 처리 내역" sub={`${TODAY.count}건 처리 · 후처리 ${TODAY.wrapDone}건 완료`} />
          {/* 시간축 리스트 — 최근 콜이 위 */}
          <div style={css("background:var(--background-200);border-radius:8px;overflow:hidden")}>
            {TODAY.rows.map((r, i) => (
              <div key={i} style={css("display:flex;align-items:center;gap:14px;padding:13px 18px" + (i < TODAY.rows.length - 1 ? ";border-bottom:1px solid var(--gray-200)" : ""))}>
                <span style={css("font:600 12.5px 'Geist Mono',monospace;color:var(--gray-700);width:44px;flex:none")}>{r.time}</span>
                <span style={css("flex:1;font:600 14px 'Geist Sans','Pretendard',sans-serif;color:var(--gray-1000)")}>{r.type}</span>
                <span style={css("font:600 11px 'Geist Sans','Pretendard',sans-serif;color:" + (r.status === "후처리 완료" ? "var(--green-900)" : "var(--amber-900)"))}>{r.status}</span>
              </div>
            ))}
          </div>
          <div style={css("margin-top:10px;font:500 12px 'Geist Sans','Pretendard',sans-serif;color:var(--gray-600)")}>
            최근 4건 표시 · 전체 내역은 후처리 화면에서
          </div>
        </div>
      )}

      {view === "alerts" && (
        <div style={css("flex:1;display:flex;flex-direction:column;padding:6px 26px 26px;min-height:0")}>
          <SubHead onBack={back} title="알림" sub={`읽지 않음 ${ALERTS.filter((a) => a.unread).length}건`} />
          <div style={css("display:flex;flex-direction:column;gap:8px")}>
            {ALERTS.map((a, i) => (
              <div
                key={i}
                style={css(
                  "display:flex;align-items:flex-start;gap:12px;padding:14px 16px;border-radius:8px;" +
                    (a.unread ? "background:var(--onair-surface);box-shadow:var(--sh-near)" : "background:var(--background-200);opacity:.75")
                )}
              >
                <span style={css("width:8px;height:8px;border-radius:9999px;margin-top:5px;flex:none;background:" + (a.unread ? "var(--blue-700)" : "var(--gray-300)"))} />
                <div style={css("flex:1")}>
                  <div style={css("font:700 13.5px 'Geist Sans','Pretendard',sans-serif;color:var(--gray-1000)")}>{a.title}</div>
                  <div style={css("font:400 12px/1.5 'Geist Sans','Pretendard',sans-serif;color:var(--gray-700);margin-top:2px")}>{a.sub}</div>
                </div>
                <span style={css("font:600 11px 'Geist Mono',monospace;color:var(--gray-600);flex:none")}>{a.time}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {view === "coach" && (
        <div style={css("flex:1;display:flex;flex-direction:column;padding:6px 26px 26px;min-height:0")}>
          <SubHead onBack={back} title="코칭·리뷰" sub="어제 성과 + 오늘의 워밍업" />
          {/* 성과 스탯 3장 */}
          <div style={css("display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px;margin-bottom:14px")}>
            {COACH.stats.map((s) => (
              <div key={s.label} style={css("background:var(--background-200);border-radius:8px;padding:14px 16px")}>
                <div style={css("font:600 11px 'Geist Sans','Pretendard',sans-serif;color:var(--gray-700)")}>{s.label}</div>
                <div style={css("font:700 18px 'Geist Sans','Pretendard',sans-serif;color:var(--gray-1000);margin-top:4px")}>{s.value}</div>
              </div>
            ))}
          </div>
          {/* AI 코칭 두 줄 */}
          <div style={css("display:flex;flex-direction:column;gap:7px;margin-bottom:14px")}>
            <div style={css("display:flex;align-items:baseline;gap:8px")}>
              <span style={css("font:700 11px 'Geist Sans','Pretendard',sans-serif;color:var(--green-900);flex:none")}>잘한 점</span>
              <span style={css("font:400 13px 'Geist Sans','Pretendard',sans-serif;color:var(--gray-900)")}>{COACH.good}</span>
            </div>
            <div style={css("display:flex;align-items:baseline;gap:8px")}>
              <span style={css("font:700 11px 'Geist Sans','Pretendard',sans-serif;color:var(--amber-900);flex:none")}>개선</span>
              <span style={css("font:400 13px 'Geist Sans','Pretendard',sans-serif;color:var(--gray-900)")}>{COACH.improve}</span>
            </div>
          </div>
          {/* 오늘의 워밍업 */}
          <div style={css("font:700 12px 'Geist Sans','Pretendard',sans-serif;color:var(--gray-800);margin-bottom:8px")}>오늘의 워밍업</div>
          <div style={css("display:flex;flex-direction:column;gap:8px")}>
            {COACH.warmup.map((w, i) => (
              <div key={i} style={css("display:flex;align-items:center;gap:12px;padding:12px 16px;background:var(--background-200);border-radius:8px")}>
                <span style={css("width:18px;height:18px;border-radius:9999px;border:1.5px solid var(--gray-500);flex:none;box-sizing:border-box")} />
                <span style={css("flex:1;font:500 13.5px 'Geist Sans','Pretendard',sans-serif;color:var(--gray-1000)")}>{w.label}</span>
                <span style={css("font:600 12px 'Geist Mono',monospace;color:var(--gray-700)")}>{w.meta}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {view === "manual" && (
        <div style={css("flex:1;display:flex;flex-direction:column;padding:6px 26px 26px;min-height:0")}>
          <SubHead onBack={back} title="매뉴얼" sub="규정·업무 가이드" />
          {/* 검색 우선 — 매뉴얼은 찾는 화면 */}
          <div style={css("display:flex;align-items:center;gap:8px;border:1px solid var(--gray-400);border-radius:9999px;padding:11px 16px;background:var(--onair-surface);margin-bottom:12px")}>
            <span className="mi" style={css("font-size:18px;color:var(--gray-700)")}>search</span>
            <span style={css("font:400 13px 'Geist Sans','Pretendard',sans-serif;color:var(--gray-600)")}>규정·절차 검색</span>
          </div>
          <div style={css("display:flex;flex-direction:column;gap:8px")}>
            {MANUAL_ROWS.map((r, i) => (
              <div key={i} style={css("display:flex;align-items:center;gap:14px;padding:14px 16px;background:var(--background-200);border-radius:8px")}>
                <span className="av" style={css("width:36px;height:36px;font-size:17px;background:var(--onair-surface)")}>
                  <span className="mi">{r.icon}</span>
                </span>
                <span style={css("flex:1;font:500 13.5px 'Geist Sans','Pretendard',sans-serif;color:var(--gray-1000)")}>{r.label}</span>
                <span style={css("font:600 11px 'Geist Sans','Pretendard',sans-serif;color:var(--gray-700)")}>{r.meta}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {!view && (
        /* ── 대기(시계) 화면 ── */
        <div style={css("flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:0")}>
          {/* 시계 — Geist Sans 고정폭 숫자 (모노의 슬래시 제로 회피) */}
          <div
            style={css(
              "display:flex;align-items:baseline;gap:4px;line-height:1;font-family:'Geist Sans','Pretendard',sans-serif;font-weight:600;letter-spacing:-4px;font-variant-numeric:tabular-nums;" +
                (onBreak ? "color:var(--gray-600)" : "color:var(--gray-1000)")
            )}
          >
            <span style={css("font-size:108px")}>{hh}</span>
            <span style={css("font-size:96px;transform:translateY(-8px)")}>:</span>
            <span style={css("font-size:108px")}>{mm}</span>
            <span style={css("font-size:38px;color:var(--gray-500);margin-left:10px;letter-spacing:-1px")}>{ss}</span>
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
              {/* 오늘 처리 내역 */}
              <div onClick={() => setView("today")} className="card" style={css("width:170px;padding:18px 16px;cursor:pointer;display:flex;flex-direction:column;gap:9px;box-shadow:var(--sh-far)")}>
                <div style={css("display:flex;align-items:center;justify-content:space-between")}>
                  <History size={24} color="var(--blue-700)" strokeWidth={1.8} />
                  <span style={css("font:700 15px 'Geist Sans',sans-serif;font-variant-numeric:tabular-nums;color:var(--gray-1000)")}>{TODAY.count}<span style={css("font:600 11px;color:var(--gray-600)")}>건</span></span>
                </div>
                <span style={css("font:700 14px 'Geist Sans','Pretendard',sans-serif;color:var(--gray-1000)")}>오늘 처리 내역</span>
                <span style={css("font:500 11.5px 'Geist Sans','Pretendard',sans-serif;color:var(--gray-700);line-height:1.4")}>후처리 {TODAY.wrapDone}건 완료</span>
              </div>
              {/* 알림 */}
              <div onClick={() => setView("alerts")} className="card" style={css("width:170px;padding:18px 16px;cursor:pointer;display:flex;flex-direction:column;gap:9px;box-shadow:var(--sh-far)")}>
                <div style={css("display:flex;align-items:center;justify-content:space-between")}>
                  <Bell size={24} color="var(--blue-700)" strokeWidth={1.8} />
                  <span style={css("width:18px;height:18px;border-radius:9999px;background:var(--red-700);color:#fff;font:700 10.5px 'Geist Sans',sans-serif;display:flex;align-items:center;justify-content:center")}>{ALERTS.filter((a) => a.unread).length}</span>
                </div>
                <span style={css("font:700 14px 'Geist Sans','Pretendard',sans-serif;color:var(--gray-1000)")}>알림</span>
                <span style={css("font:500 11.5px 'Geist Sans','Pretendard',sans-serif;color:var(--gray-700);line-height:1.4")}>사고대응팀 회신 · 콜백 예약</span>
              </div>
              {/* 코칭·리뷰 */}
              <div onClick={() => setView("coach")} className="card" style={css("width:170px;padding:18px 16px;cursor:pointer;display:flex;flex-direction:column;gap:9px;box-shadow:var(--sh-far)")}>
                <GraduationCap size={24} color="var(--blue-700)" strokeWidth={1.8} />
                <span style={css("font:700 14px 'Geist Sans','Pretendard',sans-serif;color:var(--gray-1000)")}>코칭·리뷰</span>
                <span style={css("font:500 11.5px 'Geist Sans','Pretendard',sans-serif;color:var(--gray-700);line-height:1.4")}>어제 피드백 · 워밍업</span>
              </div>
              {/* 매뉴얼 — 아이콘 유지 */}
              <div onClick={() => setView("manual")} className="card" style={css("width:170px;padding:18px 16px;cursor:pointer;display:flex;flex-direction:column;gap:9px;box-shadow:var(--sh-far)")}>
                <span className="mi" style={css("font-size:24px;color:var(--blue-700)")}>menu_book</span>
                <span style={css("font:700 14px 'Geist Sans','Pretendard',sans-serif;color:var(--gray-1000)")}>매뉴얼</span>
                <span style={css("font:500 11.5px 'Geist Sans','Pretendard',sans-serif;color:var(--gray-700);line-height:1.4")}>규정·업무 가이드</span>
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
