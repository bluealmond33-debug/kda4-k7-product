import { useEffect, useState } from "react";
import { css } from "../../lib/css";
import { AGENT } from "../../data/demoContent";

/**
 * 아침 대기 화면 (phase === "idle") — "기다리는 콜센터 → 준비되는 콜센터".
 * 큰 시계로 대기 상태를 붙잡아두되, 상담사가 첫 콜 전에 워밍업·밀린 작업·
 * 이전 상담 리뷰·매뉴얼로 들어갈 수 있는 준비 공간을 함께 연다.
 * 휴식은 같은 시계 화면을 "휴식 중"으로 전환(램프 앰버) — 대기와 한 몸.
 * 온에어 문법: 빛 없음, 그림자가 위계. 색은 램프 점·글자만.
 */

const DAYS = ["일", "월", "화", "수", "목", "금", "토"];
const two = (n: number) => (n < 10 ? "0" + n : "" + n);

type Prep = {
  key: string;
  icon: string;
  title: string;
  sub: string;
  head: string;
  rows: { icon: string; label: string; meta: string }[];
};

const PREPS: Prep[] = [
  {
    key: "warmup",
    icon: "graphic_eq",
    title: "워밍업",
    sub: "발성·오프닝 멘트 점검",
    head: "오늘의 워밍업",
    rows: [
      { icon: "campaign", label: "오프닝 멘트 3종 낭독 — 공감·사실확인·마무리", meta: "3분" },
      { icon: "sentiment_satisfied", label: "감정 대응 표현 리마인드 — 확정적 반환 표현 금지", meta: "안내" },
      { icon: "record_voice_over", label: "발성·속도 체크 (권장 속도 대비)", meta: "2분" },
    ],
  },
  {
    key: "backlog",
    icon: "assignment_late",
    title: "밀린 작업",
    sub: "미처리 콜백·후처리 메모",
    head: "처리 대기 3건",
    rows: [
      { icon: "phone_callback", label: "예약 콜백 — 착오송금 반환 절차 안내", meta: "오늘 11:00" },
      { icon: "edit_note", label: "후처리 메모 미완 — 전세자금대출 상환 문의 건", meta: "어제" },
      { icon: "forward_to_inbox", label: "사고대응팀 인계 회신 대기", meta: "D-1" },
    ],
  },
  {
    key: "review",
    icon: "history_edu",
    title: "이전 상담 리뷰",
    sub: "어제 통화 피드백",
    head: "어제 상담 요약",
    rows: [
      { icon: "insights", label: "평균 감정온도 낮음 유지 · 이관 0건", meta: "12콜" },
      { icon: "thumb_up", label: "잘한 점 — 사실확인 단계 누락 없음", meta: "AI 코칭" },
      { icon: "tips_and_updates", label: "개선 — 마무리 후속 안내 문장 짧게", meta: "AI 코칭" },
    ],
  },
  {
    key: "manual",
    icon: "menu_book",
    title: "매뉴얼",
    sub: "규정·업무 가이드",
    head: "자주 찾는 규정",
    rows: [
      { icon: "gavel", label: "착오송금 반환지원 제도 — 예금보험공사 절차", meta: "규정" },
      { icon: "shield", label: "본인확인·고위험 인계 기준 (ADR-0009)", meta: "규정" },
      { icon: "block", label: "카드 금지정보 — DTMF·OTP·전체 계좌번호", meta: "필독" },
    ],
  },
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

export default function Standby() {
  const [now, setNow] = useState(() => new Date());
  const [view, setView] = useState<Prep | null>(null);
  const [onBreak, setOnBreak] = useState(false);

  useEffect(() => {
    const t = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(t);
  }, []);

  const hh = two(now.getHours());
  const mm = two(now.getMinutes());
  const ss = two(now.getSeconds());
  const dateStr = `${now.getMonth() + 1}월 ${now.getDate()}일 (${DAYS[now.getDay()]})`;

  return (
    <div
      style={css(
        "width:1100px;height:688px;background:var(--onair-surface);border-radius:12px;box-shadow:var(--sh-near);display:flex;flex-direction:column;font-family:'Geist Sans','Pretendard',system-ui,sans-serif;overflow:hidden"
      )}
    >
      {/* ── 상단: 프로필 + 날짜/상태 ── */}
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
              <span
                title="부서 내 숙련도 — 이관 방향(초보→경력)의 기준"
                style={css(
                  "display:inline-flex;align-items:center;gap:4px;padding:2px 9px;border-radius:9999px;font:700 11px 'Geist Sans','Pretendard',sans-serif;" +
                    (AGENT.level === "경력"
                      ? "color:var(--green-900);background:var(--green-100)"
                      : "color:var(--amber-900);background:var(--amber-100)")
                )}
              >
                <span className="mi" style={css("font-size:13px")}>
                  {AGENT.level === "경력" ? "workspace_premium" : "school"}
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

      {view ? (
        /* ── 준비 공간 서브 화면 ── */
        <div style={css("flex:1;display:flex;flex-direction:column;padding:6px 26px 26px;min-height:0")}>
          <div style={css("display:flex;align-items:center;gap:10px;margin-bottom:16px")}>
            <span
              className="cbtn"
              onClick={() => setView(null)}
              title="대기 화면으로"
              style={css("cursor:pointer")}
            >
              <span className="mi" style={css("font-size:20px")}>arrow_back</span>
            </span>
            <span className="mi" style={css("font-size:22px;color:var(--blue-700)")}>{view.icon}</span>
            <span style={css("font:700 20px 'Geist Sans','Pretendard',sans-serif;color:var(--gray-1000)")}>{view.title}</span>
            <span style={css("margin-left:8px;font:600 13px 'Geist Sans','Pretendard',sans-serif;color:var(--gray-700)")}>
              {view.head}
            </span>
          </div>
          <div style={css("display:flex;flex-direction:column;gap:10px")}>
            {view.rows.map((r, i) => (
              <div
                key={i}
                style={css(
                  "display:flex;align-items:center;gap:14px;padding:16px 18px;background:var(--background-200);border-radius:8px"
                )}
              >
                <span
                  className="av"
                  style={css("width:38px;height:38px;font-size:18px;background:var(--onair-surface)")}
                >
                  <span className="mi">{r.icon}</span>
                </span>
                <span style={css("flex:1;font:500 14px 'Geist Sans','Pretendard',sans-serif;color:var(--gray-1000)")}>
                  {r.label}
                </span>
                <span style={css("font:600 12px 'Geist Mono','Geist Sans',monospace;color:var(--gray-700)")}>{r.meta}</span>
              </div>
            ))}
          </div>
          <div style={css("margin-top:auto;font:500 12.5px 'Geist Sans','Pretendard',sans-serif;color:var(--gray-600);display:flex;align-items:center;gap:6px")}>
            <span className="mi" style={css("font-size:16px")}>bolt</span>
            전화가 오면 이 화면은 자동으로 접수 카드로 전환됩니다.
          </div>
        </div>
      ) : (
        /* ── 대기(시계) 화면 ── */
        <div style={css("flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:0")}>
          <div
            className="mono"
            style={css(
              "display:flex;align-items:baseline;gap:4px;line-height:1;font-weight:600;letter-spacing:-2px;" +
                (onBreak ? "color:var(--gray-600)" : "color:var(--gray-1000)")
            )}
          >
            <span style={css("font-size:104px")}>{hh}</span>
            <span style={css("font-size:104px")}>:</span>
            <span style={css("font-size:104px")}>{mm}</span>
            <span style={css("font-size:40px;color:var(--gray-600);margin-left:6px")}>{ss}</span>
          </div>
          <div style={css("margin-top:14px;font:600 15px 'Geist Sans','Pretendard',sans-serif;color:var(--gray-800)")}>
            {onBreak ? "휴식 중입니다 — 복귀하면 다시 수신 대기로 전환됩니다" : "상담 대기 중 — 전화가 오면 자연어 접수가 시작됩니다"}
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
            <div style={css("margin-top:34px;display:flex;gap:12px")}>
              {PREPS.map((p) => (
                <div
                  key={p.key}
                  onClick={() => setView(p)}
                  className="card"
                  style={css(
                    "width:158px;padding:18px 16px;cursor:pointer;display:flex;flex-direction:column;gap:9px;box-shadow:var(--sh-far)"
                  )}
                >
                  <span className="mi" style={css("font-size:26px;color:var(--blue-700)")}>{p.icon}</span>
                  <span style={css("font:700 14px 'Geist Sans','Pretendard',sans-serif;color:var(--gray-1000)")}>{p.title}</span>
                  <span style={css("font:500 11.5px 'Geist Sans','Pretendard',sans-serif;color:var(--gray-700);line-height:1.4")}>
                    {p.sub}
                  </span>
                </div>
              ))}
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
