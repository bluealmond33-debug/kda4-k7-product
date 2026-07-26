import { useEffect, useRef, useState } from "react";
import { Bell, CalendarClock, GraduationCap, History } from "lucide-react";
import { css } from "../../lib/css";
import { useCallLog } from "../../lib/callLog";
import KeyboardMap from "./KeyboardMap";
import LedClock from "./LedClock";
import { highlight } from "../../lib/highlight";
import { AGENT, SHEETS, rowSignal, sheetColIndex } from "../../data/demoContent";
import SignalMark from "./SignalMark";

/** 표식이 붙는 칸 — 라벨로 찾는다. 이 시트는 이미 한 번 열 순서가 바뀐 적이 있다. */
const MANUAL_CONTENT_COL = sheetColIndex(SHEETS.manual.cols, "내용");

/**
 * 아침 대기 화면 (phase === "idle") — "기다리는 콜센터 → 준비되는 콜센터".
 * 큰 시계(Avenir Next — 모노의 슬래시 제로 회피) + 준비 공간 4타일:
 * 오늘 처리 내역 · 알림 · 코칭·리뷰 · 매뉴얼. 각 서브 화면은 서로 다른 구조.
 * 아이콘: Lucide(업계 표준) — 매뉴얼만 기존 Material 유지(사용자 지시).
 * 상태 표시는 우상단 램프 한 곳만. 온에어 문법: 빛 없음, 그림자가 위계.
 */

const DAYS = ["일", "월", "화", "수", "목", "금", "토"];
const two = (n: number) => (n < 10 ? "0" + n : "" + n);

type PrepKey = "today" | "alerts" | "coach" | "manual" | "keys";

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
    title: "이번 주 코칭 포인트 도착",
    sub: "대출 상담 마무리 안내 보완 — 상세는 코칭·리뷰에서",
    time: "그저께",
    unread: false,
    today: false,
    action: "",
  },
];

/* 코칭·리뷰 — 평가·순위 화면이 아니라 '다음 행동'을 알려주는 성장 지원 화면.
   구성안(KARINA_코칭리뷰_콘텐츠구성안_CSAT제외) 기준:
   · CSAT·감정온도를 점수로 쓰지 않는다 · 없는 데이터는 숫자로 만들지 않는다
   · 전체 평균이 아니라 동일 업무·유사 숙련도 안에서 비교 · 잘한 점을 반드시 함께
   · 코칭 포인트는 근거 상담과, 미션은 코칭 포인트와 연결 · AI 추천과 관리자 확정을 구분
   여기 값은 1단계(데모)에서 실제 수집 가능한 항목만 사용한다. */
const COACH = {
  // §4 상단 요약 — 전체+업무별 병기, 동일 업무 평균, 이관, 후처리 수정
  summary: [
    { label: "최근 7일 처리", value: "42건", sub: "대출 업무 18건" },
    { label: "동일 업무 평균시간", value: "7분 12초", sub: "대출 만기 연장" },
    { label: "이관", value: "2건", sub: "정상 인계 포함" },
    { label: "후처리 수정", value: "3건", sub: "업무유형 수정" },
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
  // §5 이번 주 코칭 포인트 — 근거가 가장 분명한 한 가지만
  point: {
    topic: "대출 상담 마무리 안내 보완",
    source: "AI 추천", // 관리자 확정과 구분 (§9)
    reasons: [
      "동일 업무 상담시간이 그룹 기준보다 반복적으로 길었음",
      "후처리에서 후속조치 항목이 3회 수정됨",
    ],
    basis: "대출 만기 연장 · 동일 숙련도 그룹 · 최근 7일 · 최소 10건",
    action: "통화 종료 전 처리 결과·필요 서류·다음 절차를 한 문장으로 확인",
  },
  // §6 잘한 점 — 문제점만 보이면 감시 화면이 된다
  good: {
    title: "본인확인 절차 누락 없음",
    detail: "최근 대출 상담 18건에서 승인된 본인확인 순서를 모두 준수했습니다.",
  },
  // §7 근거 상담 리뷰 — 코칭 포인트의 근거가 된 실제 상담 (원음 휘발 → 마스킹 전사·카드 근거)
  reviews: [
    { at: "어제 14:22", task: "대출 만기 연장", code: "G002", dur: "9분 04초", result: "완료", reason: "마무리에서 다음 절차 안내 누락" },
    { at: "어제 11:40", task: "대출 만기 연장", code: "G002", dur: "8분 12초", result: "완료", reason: "동일 업무 평균 대비 상담시간 김" },
  ],
  // §8 오늘의 미션 — 코칭 포인트와 직접 연결, 최대 2개
  missions: [
    { label: "대출 만기 연장 우수 상담 흐름 비교", meta: "3분" },
    { label: "처리 결과·다음 절차 마무리 문장 연습", meta: "2분" },
  ],
  // §9 진행 상태 — AI 추천을 곧바로 확정으로 쓰지 않는다
  flow: ["AI 추천", "관리자 검토", "상담사 확인", "미션 수행", "변화 확인"],
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
      <span style={css("font:600 12px 'Avenir Next','Pretendard',sans-serif;color:var(--gray-700)")}>{label}</span>
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
      <span style={css("font:700 20px 'Avenir Next','Pretendard',sans-serif;color:var(--gray-1000)")}>{title}</span>
      <span style={css("margin-left:8px;font:600 13px 'Avenir Next','Pretendard',sans-serif;color:var(--gray-700)")}>{sub}</span>
    </div>
  );
}

export default function Standby() {
  const [now, setNow] = useState(() => new Date());
  const [view, setView] = useState<PrepKey | null>(null);
  const [onBreak, setOnBreak] = useState(false);
  /* 토스트 — 내 조작 없이 상태가 바뀌었을 때만 띄운다. 조용히 바뀌면 큐에서 빠진 걸
     모른 채 앉아 있게 된다. */
  const [toast, setToast] = useState<{ icon: string; text: string; sub?: string } | null>(null);
  /* 자동으로 켠 휴식인지 — 코칭 화면을 나갈 때 되돌릴지 판단하는 기준이다.
     **직접 '휴식하기'를 눌러 둔 사람의 휴식은 건드리지 않는다.** 자기가 켠 걸 화면
     이동만으로 꺼 버리면 그게 더 놀랍다. */
  const autoBreak = useRef(false);
  // 알림 읽음 처리 + 필터 (읽으면 타일 배지도 줄어든다)
  const [readSet, setReadSet] = useState<Set<number>>(new Set());
  const [alertFilter, setAlertFilter] = useState<"all" | "unread">("all");
  const [manualSearch, setManualSearch] = useState(""); // 매뉴얼 실검색 — 우측 시트 필터
  // 워밍업 체크
  const [warmDone, setWarmDone] = useState<Set<number>>(new Set());
  const isUnread = (i: number) => ALERTS[i].unread && !readSet.has(i);
  const unreadCount = ALERTS.filter((_, i) => isUnread(i)).length;

  useEffect(() => {
    const t = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(t);
  }, []);

  /* 코칭·리뷰에 들어가면 자동으로 휴식으로 전환한다.
     오늘의 미션이 3분·2분짜리라 수신 가능 상태로 시작하면 도중에 콜이 들어와 끊긴다.
     대신 **조용히 바꾸지 않는다** — 토스트로 알리고, 화면을 나가면 되돌린다. */
  useEffect(() => {
    if (view === "coach") {
      if (!onBreak) {
        autoBreak.current = true;
        setOnBreak(true);
        setToast({
          icon: "self_improvement",
          text: "휴식 중으로 전환했습니다",
          sub: "미션에 집중하도록 콜을 받지 않습니다 · 나가면 수신 대기로 돌아갑니다",
        });
      }
      return;
    }
    // 코칭에서 나왔다 — 자동으로 켠 휴식만 되돌린다
    if (autoBreak.current) {
      autoBreak.current = false;
      setOnBreak(false);
      setToast({ icon: "play_arrow", text: "수신 대기로 돌아왔습니다" });
    }
  }, [view, onBreak]);

  /* 토스트는 잠깐만 — 상태 표시는 우상단 램프가 상시로 맡는다 */
  useEffect(() => {
    if (!toast) return;
    const id = window.setTimeout(() => setToast(null), 3600);
    return () => window.clearTimeout(id);
  }, [toast]);

  const hh = two(now.getHours());
  const mm = two(now.getMinutes());
  const ss = two(now.getSeconds());
  const dateStr = `${now.getMonth() + 1}월 ${now.getDate()}일 (${DAYS[now.getDay()]})`;
  const back = () => setView(null);

  // 오늘 저장한 후처리 — 픽스처(TODAY.rows) 위에 쌓인다. 방금 저장한 콜이 맨 위에 보여야
  // '저장됐다'가 눈으로 확인된다. 미상담 종료는 처리 건수·후처리 완료 수에는 넣지 않는다.
  const logged = useCallLog();
  const doneCount = logged.filter((e) => e.status !== "미상담 종료").length;
  const wrapDoneCount = logged.filter((e) => e.status === "후처리 완료").length;
  // 네 번째 지표는 '콜백 예약'으로 둔다. 앞의 셋은 전부 지나간 일(처리·완료·평균)이라
  // 훑어도 할 일이 안 남는다 — 콜백만이 **아직 남은 약속**이라 오늘 행동을 바꾼다.
  const callbackCount =
    logged.filter((e) => e.status === "콜백 예약").length +
    TODAY.rows.filter((r) => r.status === "콜백 예약").length;
  const rows = [
    ...logged.map((e) => ({
      time: e.time,
      type: e.type,
      status: e.status as string,
      result: e.result,
      talk: e.talk,
      followups: e.followups ?? [],
      live: true,
    })),
    ...TODAY.rows.map((r) => ({
      time: r.time,
      type: r.type,
      status: r.status as string,
      result: undefined as string | undefined,
      talk: undefined as string | undefined,
      followups: [] as { icon: string; label: string }[],
      live: false,
    })),
  ];

  return (
    <div
      style={css(
        "width:1100px;height:688px;position:relative;background:var(--onair-surface);border-radius:12px;box-shadow:var(--sh-near);display:flex;flex-direction:column;font-family:'Avenir Next','Pretendard',system-ui,sans-serif;overflow:hidden"
      )}
    >
      {/* ── 상단: 프로필(좌, 작게) + 날짜·상태·운영정보(우, 작게) — 시계가 주인공이 되도록 모두 물러난다 ── */}
      <div style={css("flex:none;display:flex;align-items:flex-start;justify-content:space-between;padding:18px 24px")}>
        <div style={css("display:flex;align-items:center;gap:10px")}>
          <span className="av" style={css("width:32px;height:32px;font-size:16px")}>
            <span className="mi">account_circle</span>
          </span>
          <div>
            <div style={css("display:flex;align-items:center;gap:7px")}>
              <span style={css("font:600 13px 'Avenir Next','Pretendard',sans-serif;color:var(--gray-900)")}>
                {AGENT.name} {AGENT.role}
              </span>
              {/* 숙련도 — 틴트 없이 잉크만 */}
              <span
                title="부서 내 숙련도 — 이관 방향(주니어→시니어)의 기준"
                style={css(
                  "display:inline-flex;align-items:center;gap:2px;font:700 10.5px 'Avenir Next','Pretendard',sans-serif;color:" +
                    (AGENT.level === "시니어" ? "var(--green-900)" : "var(--amber-900)")
                )}
              >
                <span className="mi" style={css("font-size:12px")}>
                  {AGENT.level === "시니어" ? "workspace_premium" : "school"}
                </span>
                {AGENT.level}
              </span>
            </div>
            <div style={css("font:400 11px 'Avenir Next','Pretendard',sans-serif;color:var(--gray-600);margin-top:2px")}>
              {AGENT.dept} · {AGENT.tenure} · {AGENT.id}
            </div>
          </div>
        </div>
        <div style={css("display:flex;flex-direction:column;align-items:flex-end;gap:5px")}>
          <div style={css("display:flex;align-items:center;gap:10px")}>
            <span style={css("font:500 12px 'Avenir Next','Pretendard',sans-serif;color:var(--gray-700)")}>{dateStr}</span>
            {onBreak ? <Lamp tone="a" label="휴식 중" /> : <Lamp tone="g" label="대기 중 · 수신 가능" />}
          </div>
          {!onBreak && !view && (
            <>
              {/* 개인 일정만 — 대기열(집계)은 관리자 콘솔 몫, 여기는 내 다음 콜백만 남긴다 */}
              <div style={css("display:flex;align-items:center;gap:6px;font:500 11.5px 'Avenir Next','Pretendard',sans-serif;color:var(--gray-600)")}>
                <CalendarClock size={12} color="var(--gray-500)" strokeWidth={2} />
                다음 콜백 <span className="bignum" style={css("font-size:11.5px;color:var(--gray-800)")}>11:00</span>
              </div>
              <div style={css("font:400 11px 'Avenir Next','Pretendard',sans-serif;color:var(--gray-500)")}>
                전화가 오면 준비 카드가 이 자리에 도착합니다
              </div>
            </>
          )}
        </div>
      </div>

      {view === "today" && (
        <div style={css("flex:1;display:flex;flex-direction:column;padding:6px 26px 26px;min-height:0")}>
          <SubHead onBack={back} title="처리 내역" sub="오늘" />
          {/* 요약 스탯 4장 — 아이콘 + bignum 타일. 넷째(콜백 예약)만 앞을 보는 지표라
              값이 있을 때 앰버로 든다: 색은 '아직 남은 약속'이라는 신호에만 쓴다. */}
          <div style={css("display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:14px")}>
            {[
              { icon: <History size={17} color="var(--blue-700)" strokeWidth={2} />, label: "처리", value: `${TODAY.count + doneCount}`, unit: "건", tone: "" },
              { icon: <span className="mi" style={css("font-size:17px;color:var(--blue-700)")}>task_alt</span>, label: "후처리 완료", value: `${TODAY.wrapDone + wrapDoneCount}`, unit: "건", tone: "" },
              { icon: <span className="mi" style={css("font-size:17px;color:var(--blue-700)")}>timer</span>, label: "평균 통화", value: TODAY.avgTalk, unit: "", tone: "" },
              {
                icon: <span className="mi" style={css("font-size:17px;color:" + (callbackCount ? "var(--amber-700)" : "var(--blue-700)"))}>event</span>,
                label: "콜백 예약",
                value: `${callbackCount}`,
                unit: "건",
                tone: callbackCount ? "var(--amber-900)" : "",
              },
            ].map((s) => (
              <div key={s.label} className="card" style={css("padding:13px 16px;box-shadow:var(--sh-near)")}>
                <div style={css("display:flex;align-items:center;gap:6px;font:600 11px 'Avenir Next','Pretendard',sans-serif;color:var(--gray-700)")}>{s.icon}{s.label}</div>
                <div style={css("margin-top:6px")}>
                  <span className="bignum" style={css("font-size:24px;color:" + (s.tone || "var(--gray-1000)"))}>{s.value}</span>
                  {s.unit && <span style={css("font:600 12px 'Avenir Next','Pretendard',sans-serif;color:var(--gray-600);margin-left:2px")}>{s.unit}</span>}
                </div>
              </div>
            ))}
          </div>
          {/* 시간축 타임라인 — 좌측 레일(점+선), 최근 콜이 위 */}
          <div style={css("flex:1;min-height:0;overflow:auto")}>
            {rows.map((r, i) => {
              const last = i === rows.length - 1;
              const cb = r.status === "콜백 예약";
              // 미상담 종료 — 상담이 없었던 콜. 완료와 같은 초록으로 보이면 안 된다(회색으로 물러남).
              const noTalk = r.status === "미상담 종료";
              const dot = noTalk ? "var(--gray-500)" : cb ? "var(--amber-700)" : "var(--gray-400)";
              const chip = noTalk
                ? "color:var(--gray-800);background:var(--gray-100)"
                : cb
                ? "color:var(--amber-900);background:rgba(178,116,0,.10)"
                : "color:var(--green-900);background:rgba(29,122,72,.10)";
              const icon = noTalk ? "call_end" : cb ? "event" : "check";
              return (
                <div key={i} className="ptile" style={css("display:flex;gap:10px;padding:0 4px;border-radius:8px")}>
                  {/* 레일 — 점은 시각 바로 왼쪽에 붙고, 선은 위아래 행까지 끊김 없이 이어진다.
                      전에는 레일이 행마다 독립된 세로 상자라 행 사이(패딩·구분선)에서 선이
                      끊겨 점만 흩어져 보였다. 이제 선을 절대배치로 행 높이 전체에 걸치고,
                      첫 행은 점에서 시작 · 마지막 행은 점에서 끝나게 잘라 준다. */}
                  <div style={css("position:relative;flex:none;width:9px;align-self:stretch")}>
                    {/* 첫 행은 점에서 아래로, 마지막 행은 위에서 점까지, 가운데 행은 위아래로 관통.
                        행이 하나뿐이면 이을 곳이 없으므로 선을 그리지 않는다. */}
                    {!(i === 0 && last) && (
                      <span
                        style={css(
                          "position:absolute;left:50%;transform:translateX(-50%);width:1.5px;background:var(--gray-200);" +
                            (i === 0 ? "top:26px;bottom:0" : last ? "top:0;height:26px" : "top:0;bottom:0")
                        )}
                      />
                    )}
                    <span
                      style={css(
                        "position:absolute;left:50%;top:26px;transform:translate(-50%,-50%);width:9px;height:9px;border-radius:9999px;background:" +
                          dot
                      )}
                    />
                  </div>
                  <div style={css("flex:1;display:flex;align-items:center;gap:12px;padding:12px 4px" + (last ? "" : ";border-bottom:1px solid var(--gray-200)"))}>
                    <span style={css("font:600 12.5px 'Avenir Next','Pretendard',sans-serif;color:var(--gray-600);width:44px;flex:none")}>{r.time}</span>
                    <div style={css("flex:1;min-width:0;display:flex;flex-direction:column;gap:2px")}>
                      <span style={css("font:600 13.5px 'Avenir Next','Pretendard',sans-serif;color:var(--gray-1000)")}>{r.type}</span>
                      {/* 방금 저장한 콜만 상세를 한 줄 더 — 결과·통화시간·후속 조치 수.
                          '저장 후 다음 콜'이 실제로 무엇을 남겼는지 여기서 확인된다. */}
                      {r.live && (r.result || r.talk || r.followups.length > 0) && (
                        <span style={css("font:400 11.5px 'Avenir Next','Pretendard',sans-serif;color:var(--gray-600);overflow:hidden;text-overflow:ellipsis;white-space:nowrap")}>
                          {[r.result, r.talk && "통화 " + r.talk, r.followups.length > 0 && "후속 조치 " + r.followups.length + "건"]
                            .filter(Boolean)
                            .join(" · ")}
                        </span>
                      )}
                    </div>
                    <span style={css("display:inline-flex;align-items:center;gap:4px;font:600 11px 'Avenir Next','Pretendard',sans-serif;border-radius:9999px;padding:4px 10px;flex:none;" + chip)}>
                      <span className="mi" style={css("font-size:13px")}>{icon}</span>{r.status}
                    </span>
                  </div>
                </div>
              );
            })}
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
                  "padding:6px 14px;border-radius:9999px;font:600 12px 'Avenir Next','Pretendard',sans-serif;cursor:pointer;" +
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
                style={css("margin-left:auto;font:600 12px 'Avenir Next','Pretendard',sans-serif;color:var(--blue-700);cursor:pointer")}
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
                  <div style={css("font:700 11px 'Avenir Next','Pretendard',sans-serif;color:var(--gray-600);letter-spacing:.4px;margin-bottom:7px")}>{label}</div>
                  <div style={css("display:flex;flex-direction:column;gap:8px")}>
                    {visible.map(({ a, i }) => {
                      const un = isUnread(i);
                      return (
                        <div
                          key={i}
                          className="hoverraise"
                          onClick={() => setReadSet((s) => new Set(s).add(i))}
                          style={css(
                            "display:flex;align-items:flex-start;gap:12px;padding:13px 16px;border-radius:8px;cursor:pointer;transition:opacity .25s,box-shadow .25s;" +
                              (un ? "background:var(--onair-surface);box-shadow:var(--sh-near)" : "background:var(--background-200);opacity:.72")
                          )}
                        >
                          <span style={css("width:8px;height:8px;border-radius:9999px;margin-top:5px;flex:none;transition:background .25s;background:" + (un ? "var(--blue-700)" : "var(--gray-300)"))} />
                          <div style={css("flex:1")}>
                            <div style={css("font:700 13px 'Avenir Next','Pretendard',sans-serif;color:var(--gray-1000)")}>{a.title}</div>
                            <div style={css("font:400 12px/1.5 'Avenir Next','Pretendard',sans-serif;color:var(--gray-700);margin-top:2px")}>{a.sub}</div>
                          </div>
                          {a.action && un && (
                            <span style={css("flex:none;display:inline-flex;align-items:center;gap:4px;padding:6px 12px;border-radius:9999px;border:1px solid var(--blue-400);color:var(--blue-700);font:600 11.5px 'Avenir Next','Pretendard',sans-serif")}>
                              <span className="mi" style={css("font-size:14px")}>call</span>
                              {a.action}
                            </span>
                          )}
                          <span style={css("font:600 11px 'Avenir Next','Pretendard',sans-serif;color:var(--gray-600);flex:none;margin-top:2px")}>{a.time}</span>
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
        <div style={css("flex:1;display:flex;flex-direction:column;padding:6px 26px 22px;min-height:0")}>
          <SubHead onBack={back} title="코칭·리뷰" sub="무엇을 잘했고 · 오늘 무엇을 연습할지" />
          {/* 좌: 요약·추이·코칭 포인트·잘한 점 / 우: 근거 상담·오늘의 미션·진행 상태 (§12 순서) */}
          <div style={css("flex:1;display:flex;gap:14px;min-height:0;overflow:auto")}>

            {/* ── 좌 열 ── */}
            <div style={css("flex:1.35;display:flex;flex-direction:column;gap:12px;min-width:0")}>
              {/* §4 최근 7일 요약 — 전체+업무별 병기, 동일 업무 평균, 이관, 후처리 수정 */}
              <div style={css("display:grid;grid-template-columns:1fr 1fr;gap:10px")}>
                {COACH.summary.map((s) => (
                  <div key={s.label} style={css("background:var(--background-200);border-radius:8px;padding:12px 14px")}>
                    <div style={css("font:600 11px 'Avenir Next','Pretendard',sans-serif;color:var(--gray-700)")}>{s.label}</div>
                    <div className="bignum" style={css("font-size:19px;color:var(--gray-1000);margin-top:4px")}>{s.value}</div>
                    <div style={css("font:500 10.5px 'Avenir Next','Pretendard',sans-serif;color:var(--gray-600);margin-top:3px")}>{s.sub}</div>
                  </div>
                ))}
              </div>

              {/* 최근 7일 처리량 — 막대 미니 차트.
                  막대는 슬롯을 꽉 채우지 않고 폭을 캡한다(≤22px). 전에는 width:100%라
                  칸마다 통짜 블록이 서서 차트가 아니라 벽돌담처럼 뚱뚱해 보였다 —
                  남는 자리는 여백으로 두는 게 막대의 높이 차이를 읽게 만든다.
                  값 라벨은 오늘 하나만: 모든 막대에 숫자를 얹으면 라벨이 작동을 멈춘다.
                  나머지 값은 각 칸에 올리면(title) 나온다. */}
              <div style={css("background:var(--background-200);border-radius:8px;padding:13px 16px")}>
                <div style={css("font:600 11px 'Avenir Next','Pretendard',sans-serif;color:var(--gray-700);margin-bottom:10px")}>최근 7일 처리량</div>
                <div style={css("display:flex;align-items:flex-end;gap:10px;height:74px")}>
                  {COACH.trend.map((d, i) => {
                    const max = Math.max(...COACH.trend.map((x) => x.n));
                    const isLast = i === COACH.trend.length - 1;
                    const h = Math.round((d.n / max) * 46);
                    return (
                      <div
                        key={i}
                        title={d.day + "요일 · " + d.n + "건"}
                        style={css("flex:1;display:flex;flex-direction:column;align-items:center;gap:5px;height:100%;justify-content:flex-end")}
                      >
                        <span className="bignum" style={css("font-size:11px;height:13px;color:var(--gray-1000)")}>{isLast ? d.n : ""}</span>
                        {/* 0건인 날은 막대를 세우지 않는다 — 3px짜리 토막을 세우면 '조금 했다'로 읽힌다.
                            바닥에 가는 눈금만 남겨 '그날이 존재하지만 0이었다'를 표시한다. */}
                        <span
                          style={css(
                            "width:100%;max-width:22px;border-radius:4px 4px 0 0;background:" +
                              (d.n === 0 ? "var(--gray-300)" : isLast ? "var(--blue-700)" : "var(--gray-400)") +
                              ";height:" + (d.n === 0 ? 2 : Math.max(4, h)) + "px"
                          )}
                        />
                        <span style={css("font:600 10px 'Avenir Next','Pretendard',sans-serif;color:" + (isLast ? "var(--gray-900)" : "var(--gray-600)"))}>{d.day}</span>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* §5 이번 주 코칭 포인트 — 근거가 가장 분명한 한 가지 */}
              <div style={css("background:var(--onair-surface);border:1px solid var(--blue-500);border-radius:8px;padding:14px 16px;display:flex;flex-direction:column;gap:9px")}>
                <div style={css("display:flex;align-items:center;gap:7px")}>
                  <span className="mi" style={css("font-size:16px;color:var(--blue-700)")}>tips_and_updates</span>
                  <span style={css("font:700 12px 'Avenir Next','Pretendard',sans-serif;color:var(--gray-1000)")}>이번 주 코칭 포인트</span>
                  {/* AI 추천 vs 관리자 확정 — 곧바로 확정으로 쓰지 않는다(§9) */}
                  <span style={css("margin-left:auto;font:600 9.5px 'Avenir Next','Pretendard',sans-serif;color:var(--blue-900);border:1px solid var(--blue-400);border-radius:9999px;padding:2px 8px")}>{COACH.point.source}</span>
                </div>
                <div style={css("font:700 15px/1.4 'Avenir Next','Pretendard',sans-serif;color:var(--gray-1000)")}>{COACH.point.topic}</div>
                <div>
                  <div style={css("font:600 10px 'Avenir Next','Pretendard',sans-serif;color:var(--gray-600);margin-bottom:4px")}>선정 근거</div>
                  {COACH.point.reasons.map((r, i) => (
                    <div key={i} style={css("display:flex;gap:7px;align-items:baseline;margin-bottom:3px")}>
                      <span style={css("flex:none;width:4px;height:4px;border-radius:9999px;background:var(--gray-500);transform:translateY(-2px)")} />
                      <span style={css("font:400 12px/1.5 'Avenir Next','Pretendard',sans-serif;color:var(--gray-900)")}>{r}</span>
                    </div>
                  ))}
                </div>
                <div style={css("display:flex;align-items:baseline;gap:6px")}>
                  <span style={css("font:600 10px 'Avenir Next','Pretendard',sans-serif;color:var(--gray-600);flex:none")}>비교 기준</span>
                  <span style={css("font:500 11px 'Avenir Next','Pretendard',sans-serif;color:var(--gray-700)")}>{COACH.point.basis}</span>
                </div>
                <div style={css("display:flex;gap:8px;align-items:flex-start;background:var(--gray-100);border-radius:7px;padding:9px 11px")}>
                  <span className="mi" style={css("font-size:15px;color:var(--blue-700);flex:none")}>arrow_forward</span>
                  <div>
                    <div style={css("font:600 10px 'Avenir Next','Pretendard',sans-serif;color:var(--gray-600);margin-bottom:2px")}>권장 행동</div>
                    <div style={css("font:600 12.5px/1.5 'Avenir Next','Pretendard',sans-serif;color:var(--gray-1000)")}>{COACH.point.action}</div>
                  </div>
                </div>
              </div>

              {/* §6 잘한 점 — 반드시 함께 (감시 화면이 되지 않게).
                  한쪽만 색 넣은 테두리(side rail)는 쓰지 않는다 — 상자를 반쪽만 칠한 것처럼
                  보이고, 우리 규칙에서 금지한 형태다. 초록은 아이콘과 제목 글자에만 남긴다:
                  '잘한 점'이라는 신호는 색 한 점으로 충분하고, 면은 다른 카드와 같아야 한다. */}
              <div style={css("background:var(--onair-surface);border:1px solid var(--gray-300);border-radius:8px;padding:12px 16px")}>
                <div style={css("display:flex;align-items:center;gap:6px;margin-bottom:5px")}>
                  <span className="mi" style={css("font-size:15px;color:var(--green-700)")}>verified</span>
                  <span style={css("font:700 12px 'Avenir Next','Pretendard',sans-serif;color:var(--green-900)")}>잘한 점 · {COACH.good.title}</span>
                </div>
                <div style={css("font:400 12.5px/1.55 'Avenir Next','Pretendard',sans-serif;color:var(--gray-900)")}>{COACH.good.detail}</div>
              </div>
            </div>

            {/* ── 우 열 ── */}
            <div style={css("flex:1;display:flex;flex-direction:column;gap:12px;min-width:0")}>
              {/* §7 근거 상담 리뷰 — 코칭 포인트의 근거가 된 실제 상담 */}
              <div style={css("display:flex;flex-direction:column;gap:8px")}>
                <div style={css("display:flex;align-items:center;gap:6px")}>
                  <span style={css("font:700 12px 'Avenir Next','Pretendard',sans-serif;color:var(--gray-800)")}>근거 상담 리뷰</span>
                  <span style={css("font:500 10px 'Avenir Next','Pretendard',sans-serif;color:var(--gray-600)")}>· 마스킹 전사·상담카드 기준</span>
                </div>
                {COACH.reviews.map((r, i) => (
                  <div key={i} className="hoverraise" style={css("background:var(--background-200);border-radius:8px;padding:11px 13px;cursor:pointer;transition:box-shadow .28s")}>
                    <div style={css("display:flex;align-items:center;gap:6px;margin-bottom:4px")}>
                      <span style={css("font:700 12px 'Avenir Next','Pretendard',sans-serif;color:var(--gray-1000)")}>{r.task}</span>
                      <span style={css("font:600 10px 'Avenir Next','Pretendard',sans-serif;color:var(--gray-600)")}>{r.code}</span>
                      <span style={css("margin-left:auto;display:inline-flex;align-items:center;gap:4px;font:600 10px 'Avenir Next','Pretendard',sans-serif;color:var(--gray-700)")}>
                        {r.result}<span className="mi" style={css("font-size:15px;color:var(--gray-500)")}>chevron_right</span>
                      </span>
                    </div>
                    <div style={css("display:flex;align-items:center;gap:8px;font:500 10.5px 'Avenir Next','Pretendard',sans-serif;color:var(--gray-600);margin-bottom:5px")}>
                      <span>{r.at}</span><span>·</span><span>{r.dur}</span>
                    </div>
                    <div style={css("font:400 11.5px/1.5 'Avenir Next','Pretendard',sans-serif;color:var(--gray-800)")}>{r.reason}</div>
                  </div>
                ))}
              </div>

              {/* §8 오늘의 미션 — 코칭 포인트와 직접 연결, 체크 인터랙션 + 게이지 */}
              <div style={css("display:flex;flex-direction:column;gap:8px")}>
                <div style={css("display:flex;align-items:center;gap:8px")}>
                  <span style={css("font:700 12px 'Avenir Next','Pretendard',sans-serif;color:var(--gray-800)")}>오늘의 미션</span>
                  <span style={css("font:500 10px 'Avenir Next','Pretendard',sans-serif;color:var(--gray-600)")}>· 코칭 포인트 연습</span>
                  <span style={css("margin-left:auto;display:flex;align-items:center;gap:6px")}>
                    <span style={css("display:flex;gap:3px")}>
                      {COACH.missions.map((_, i) => (
                        <span key={i} style={css("width:20px;height:5px;border-radius:2px;transition:background .25s;background:" + (warmDone.has(i) ? "var(--green-700)" : "var(--gray-200)"))} />
                      ))}
                    </span>
                    <span style={css("font:600 11px 'Avenir Next','Pretendard',sans-serif;color:var(--gray-700)")}>{warmDone.size}/{COACH.missions.length}</span>
                  </span>
                </div>
                {COACH.missions.map((w, i) => {
                  const on = warmDone.has(i);
                  return (
                    <div
                      key={i}
                      className="hoverraise"
                      onClick={() =>
                        setWarmDone((set) => {
                          const next = new Set(set);
                          if (on) next.delete(i);
                          else next.add(i);
                          return next;
                        })
                      }
                      style={css(
                        "display:flex;align-items:center;gap:12px;padding:12px 14px;border-radius:8px;cursor:pointer;user-select:none;transition:background .2s,box-shadow .28s;background:" +
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
                      <span style={css("flex:1;font:500 12.5px/1.45 'Avenir Next','Pretendard',sans-serif;color:var(--gray-1000)" + (on ? ";text-decoration:line-through;opacity:.6" : ""))}>{w.label}</span>
                      <span style={css("font:600 11.5px 'Avenir Next','Pretendard',sans-serif;color:var(--gray-700)")}>{w.meta}</span>
                    </div>
                  );
                })}
                {warmDone.size === COACH.missions.length && (
                  <div style={css("display:flex;align-items:center;gap:6px;font:600 12px 'Avenir Next','Pretendard',sans-serif;color:var(--green-900)")}>
                    <span className="mi" style={css("font-size:15px")}>check_circle</span>
                    오늘의 미션 완료 — 첫 콜 받을 준비가 됐어요
                  </div>
                )}
              </div>

              {/* §9 진행 상태 — AI 추천을 곧바로 확정으로 쓰지 않는다 */}
              <div style={css("margin-top:auto;background:var(--background-200);border-radius:8px;padding:11px 14px")}>
                <div style={css("font:600 10px 'Avenir Next','Pretendard',sans-serif;color:var(--gray-600);margin-bottom:8px")}>진행 상태</div>
                <div style={css("display:flex;align-items:center;gap:5px;flex-wrap:wrap")}>
                  {COACH.flow.map((f, i) => (
                    <span key={f} style={css("display:inline-flex;align-items:center;gap:5px")}>
                      {i > 0 && <span className="mi" style={css("font-size:14px;color:var(--gray-400)")}>chevron_right</span>}
                      <span style={css("font:600 10.5px 'Avenir Next','Pretendard',sans-serif;color:" + (i === 0 ? "var(--blue-900)" : "var(--gray-600)"))}>{f}</span>
                    </span>
                  ))}
                </div>
                <div style={css("display:flex;gap:7px;margin-top:11px")}>
                  <span className="hoverraise" style={css("display:inline-flex;align-items:center;gap:5px;font:600 11.5px 'Avenir Next','Pretendard',sans-serif;color:#fff;background:var(--blue-700);border-radius:9999px;padding:7px 14px;cursor:pointer")}>
                    <span className="mi" style={css("font-size:15px")}>check</span>코칭 확인
                  </span>
                  <span className="hoverraise" style={css("display:inline-flex;align-items:center;gap:5px;font:600 11.5px 'Avenir Next','Pretendard',sans-serif;color:var(--gray-900);border:1px solid var(--gray-400);border-radius:9999px;padding:7px 14px;cursor:pointer")}>
                    <span className="mi" style={css("font-size:15px")}>edit_note</span>의견 남기기
                  </span>
                </div>
              </div>
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
              {/* 실검색 — 오른쪽 시트가 바로 필터링된다 */}
              <div style={css("display:flex;align-items:center;gap:8px;border:1px solid var(--gray-400);border-radius:9999px;padding:9px 14px;background:var(--onair-surface);margin-bottom:2px")}>
                <span className="mi" style={css("font-size:17px;color:var(--gray-700)")}>search</span>
                <input
                  value={manualSearch}
                  onChange={(e) => setManualSearch(e.target.value)}
                  placeholder="규정·절차 검색"
                  style={css("flex:1;min-width:0;border:none;outline:none;background:transparent;font:400 13px 'Avenir Next','Pretendard',sans-serif;color:var(--gray-1000)")}
                />
                {manualSearch && (
                  <span className="mi" onClick={() => setManualSearch("")} style={css("font-size:15px;color:var(--gray-500);cursor:pointer")}>close</span>
                )}
              </div>
              {MANUAL_ROWS.map((r, i) => (
                <div key={i} className="ptile" style={css("display:flex;align-items:center;gap:11px;padding:12px 14px;background:var(--background-200);border-radius:8px;box-shadow:none")}>
                  <span className="mi" style={css("font-size:18px;color:var(--gray-700);flex:none")}>{r.icon}</span>
                  <span style={css("flex:1;font:500 13px/1.45 'Avenir Next','Pretendard',sans-serif;color:var(--gray-1000)")}>{r.label}</span>
                  <span style={css("font:600 10.5px 'Avenir Next','Pretendard',sans-serif;color:var(--gray-700);flex:none")}>{r.meta}</span>
                </div>
              ))}
            </div>
            {/* 우: 엑셀 시트 뷰 (통화 화면의 규정 확장과 같은 문법 — 크롬은 엑셀 초록) */}
            <div style={css("flex:1;min-width:0;background:var(--onair-surface);border-radius:8px;box-shadow:var(--sh-near);overflow:hidden;display:flex;flex-direction:column")}>
              <div style={css("display:flex;align-items:center;gap:8px;padding:9px 14px;background:var(--excel-green);color:#fff;flex:none")}>
                <span className="mi" style={css("font-size:17px")}>grid_on</span>
                <span style={css("font:600 12.5px 'Avenir Next','Pretendard',sans-serif")}>{SHEETS.manual.file}</span>
                <span style={css("font:400 11px 'Avenir Next','Pretendard',sans-serif;opacity:.8")}>· {SHEETS.manual.sheet} 시트</span>
              </div>
              <div style={css("flex:1;min-height:0;overflow:auto;background:#fff")}>
                <div style={css("display:flex;flex-direction:column;min-width:max-content")}>
                  <div style={css("display:flex;position:sticky;top:0")}>
                    <span style={css("width:34px;flex:none;background:var(--gray-100);border-right:1px solid var(--gray-300);border-bottom:1px solid var(--gray-300)")} />
                    {SHEETS.manual.cols.map((c, i) => (
                      <span key={i} style={css("width:" + c.w + "px;flex:none;padding:8px 10px;background:var(--gray-100);border-right:1px solid var(--gray-300);border-bottom:1px solid var(--gray-300);font:700 12px 'Avenir Next','Pretendard',sans-serif;color:var(--gray-900)")}>{c.l}</span>
                    ))}
                  </div>
                  {SHEETS.manual.rows
                    .map((row, ri) => [row, ri] as const)
                    .filter(([row]) =>
                      !manualSearch.trim() ||
                      row.some((cell) => cell.toLowerCase().includes(manualSearch.trim().toLowerCase()))
                    )
                    .map(([row, ri]) => (
                    <div key={ri} style={css("display:flex")}>
                      <span style={css("width:34px;flex:none;padding:8px 0;text-align:center;background:var(--gray-100);border-right:1px solid var(--gray-300);border-bottom:1px solid var(--gray-200);font:400 11px 'Avenir Next','Pretendard',sans-serif;color:var(--gray-600)")}>{ri + 1}</span>
                      {row.map((cell, ci) => {
                        // 사고 방지 신호는 열을 늘리지 않고 내용 칸 앞에 표식으로만 세운다.
                        // 통화 중 규정 패널과 같은 표식(SignalMark)·같은 조회(rowSignal)를 쓴다.
                        const sig = ci === MANUAL_CONTENT_COL ? rowSignal(SHEETS.manual, row) : undefined;
                        return (
                        <span key={ci} style={css("width:" + SHEETS.manual.cols[ci].w + "px;flex:none;padding:8px 10px;border-right:1px solid var(--gray-200);border-bottom:1px solid var(--gray-200);font:400 12px/1.5 'Avenir Next','Pretendard',sans-serif;color:var(--gray-1000)")}>
                          {sig && <SignalMark sig={sig} />}
                          {highlight(cell, manualSearch)}
                        </span>
                        );
                      })}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {view === "keys" && (
        <div style={css("flex:1;display:flex;flex-direction:column;padding:6px 26px 26px;min-height:0;overflow:auto")}>
          <SubHead onBack={back} title="단축키" sub="눌러 보면서 익히기" />
          <KeyboardMap />
        </div>
      )}

      {!view && (
        /* ── 대기(시계) 화면 — 시계가 정중앙의 유일한 주인공. 나머지는 가장자리로 ── */
        <div style={css("flex:1;min-height:0")}>
          {/* 시계 — 헤더 아래 영역이 아니라 화면(루트) 전체 기준 정중앙 (루트가 position:relative) */}
          <div style={css("position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;pointer-events:none")}>
            {/* 실물 LED 디지털 시계 — 요일·실시간 기온까지 (LedClock) */}
            <LedClock dimmed={onBreak} />
            {onBreak && (
              <>
                <div style={css("margin-top:18px;display:flex;align-items:center;gap:8px;font:600 14px 'Avenir Next','Pretendard',sans-serif;color:var(--gray-800)")}>
                  <span style={css("width:8px;height:8px;border-radius:9999px;background:var(--amber-700)")} />
                  휴식 중 — 복귀하면 수신 대기로 전환됩니다
                </div>
                <span
                  onClick={() => { autoBreak.current = false; setOnBreak(false); }}
                  style={css(
                    "margin-top:16px;display:inline-flex;align-items:center;gap:5px;padding:7px 16px;border-radius:9999px;background:var(--blue-700);color:#fff;font:600 12px 'Avenir Next','Pretendard',sans-serif;cursor:pointer;box-shadow:var(--sh-focus);pointer-events:auto"
                  )}
                >
                  <span className="mi" style={css("font-size:15px")}>play_arrow</span>복귀하기
                </span>
              </>
            )}
          </div>

          {/* 하단 — 입구들은 고스트 칩으로 조용히. 카드는 어차피 자동으로 도착한다 */}
          {!onBreak && (
            <div style={css("position:absolute;left:0;right:0;bottom:16px;display:flex;align-items:center;justify-content:center;gap:2px")}>
              <span onClick={() => setView("today")} className="ghosttile">
                <History size={15} strokeWidth={2} />처리 내역
                <span className="bignum" style={css("font-size:11.5px;color:var(--gray-500)")}>{TODAY.count + doneCount}</span>
              </span>
              <span onClick={() => setView("manual")} className="ghosttile">
                <span className="mi" style={css("font-size:16px")}>menu_book</span>매뉴얼
              </span>
              <span onClick={() => setView("coach")} className="ghosttile">
                <GraduationCap size={15} strokeWidth={2} />코칭·리뷰
              </span>
              <span onClick={() => setView("alerts")} className="ghosttile">
                <span style={css("position:relative;display:inline-flex")}>
                  <Bell size={15} strokeWidth={2} />
                  {unreadCount > 0 && (
                    <span style={css("position:absolute;top:-5px;right:-7px;min-width:13px;height:13px;padding:0 3px;border-radius:9999px;background:var(--red-700);color:#fff;font:700 9px 'Avenir Next','Pretendard',sans-serif;display:flex;align-items:center;justify-content:center;box-sizing:border-box")}>{unreadCount}</span>
                  )}
                </span>
                알림
              </span>
              <span style={css("width:1px;height:14px;background:var(--gray-300);margin:0 8px")} />
              <span onClick={() => setView("keys")} className="ghosttile">
                <span className="mi" style={css("font-size:16px")}>keyboard</span>단축키
              </span>
              <span onClick={() => { autoBreak.current = false; setOnBreak(true); }} className="ghosttile">
                <span className="mi" style={css("font-size:16px")}>local_cafe</span>휴식하기
              </span>
            </div>
          )}
        </div>
      )}

      {/* 상태 전환 토스트 — 화면 아래 가운데. 내 조작 없이 바뀐 것만 알린다.
          상시 상태는 우상단 램프가 맡으므로 여기는 잠깐 떴다 사라진다. */}
      {toast && (
        <div
          style={css(
            "position:absolute;left:50%;bottom:26px;z-index:60;display:flex;align-items:center;gap:10px;" +
              "background:var(--gray-1000);color:#fff;border-radius:9999px;padding:10px 18px 10px 14px;" +
              "box-shadow:var(--sh-modal);animation:toastIn .26s cubic-bezier(.2,.8,.2,1) both;max-width:calc(100% - 48px)"
          )}
        >
          <span className="mi" style={css("font-size:19px;flex:none;color:var(--amber-500)")}>{toast.icon}</span>
          <span style={css("display:flex;flex-direction:column;gap:1px;min-width:0")}>
            <span style={css("font:700 12.5px 'Avenir Next','Pretendard',sans-serif;white-space:nowrap")}>{toast.text}</span>
            {toast.sub && (
              <span style={css("font:400 11px 'Avenir Next','Pretendard',sans-serif;color:rgba(255,255,255,.72)")}>{toast.sub}</span>
            )}
          </span>
          <span
            onClick={() => setToast(null)}
            className="mi"
            title="닫기"
            style={css("font-size:16px;flex:none;margin-left:2px;color:rgba(255,255,255,.6);cursor:pointer")}
          >
            close
          </span>
        </div>
      )}
    </div>
  );
}
