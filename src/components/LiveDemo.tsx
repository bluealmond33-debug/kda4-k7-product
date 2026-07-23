import { useEffect, useRef, useState } from "react";
import { css } from "../lib/css";
import { useCallFlow, type CallFlowConfig } from "../hooks/useCallFlow";
import { useLiveCallBus } from "../hooks/useLiveCallBus";
import Phone from "./Phone";
import LiveTranscriptPanel, { type StreamItem } from "./LiveTranscriptPanel";
import Waiting from "./desktop/Waiting";
import PrepCard from "./desktop/PrepCard";
import ActiveCall from "./desktop/ActiveCall";
import WrapSheet from "./desktop/WrapSheet";
import AdminQueueSheet from "./desktop/AdminQueueSheet";
import DemoTour, { TourChooser } from "../tour/DemoTour";
import { SCREEN_ORDER } from "../tour/steps";

/**
 * K7 라이브 상담 시연 — 왼쪽 아이폰(자연어 접수) + 오른쪽 상담사 데스크톱.
 * 전화 → 안내·녹음 → 무응답 → AI 요약 → 준비 카드 → 통화 → 후처리.
 *
 * view — 시연 구도 4화면 중 셋을 이 컴포넌트가 담당한다:
 *   "full"    시연화면(기본): 폰 + 데스크톱 합본. 라이브 시연은 이 화면에서.
 *   "phone"   고객 핸드폰 단독 (?role=customer)
 *   "desktop" 직원 데스크톱 단독 (?role=employee)
 * phone/desktop은 탭별 독립 인스턴스다(탭 간 통화 상태 동기화는 후속 — demoBus 확장).
 */
export type LiveDemoView = "full" | "phone" | "desktop";

export default function LiveDemo({
  view = "full",
  ...config
}: CallFlowConfig & { view?: LiveDemoView } = {}) {
  // 직원 콘솔 통화 연결 시 좌측에 실시간 발화(STT) 패널을 붙이는 분할 뷰.
  // 켜지면 데스크톱 본체(1100)가 오른쪽으로 축소되고 왼쪽에 고객 발화 패널이 들어온다.
  // 통화 연결(answerCall) 시 자동 on, 상단 알약 토글로 끌 수 있다(발표자가 화면을 다시 키우고 싶을 때).
  const [deskSplit, setDeskSplit] = useState(false);

  // 고객 화면은 콘텐츠 폭이 좁다(폰 260 + 패널 470) — 스테이지를 콘텐츠에 맞추고
  // 확대를 허용해 큰 모니터에서 양옆 여백 없이 화면을 채운다
  const vm = useCallFlow({
    ...config,
    ...(view === "phone" ? { stageW: 600, maxScale: 1.9 } : null),
    // 직원 단독 화면 — 가로·세로 모두 뷰포트에 맞춘다(fitHeight 기본 true).
    // 가로만 맞추면(구 fitHeight:false) 낮은 창에서 하단이 잘렸다 — 넓은 화면에선 양옆 레터박스.
    // 분할 뷰에선 좌측 STT 패널(260) + 간격(40)만큼 넓어져 본체가 상대적으로 작아진다.
    ...(view === "desktop" ? { stageW: deskSplit ? 1400 : 1100, maxScale: 3, fitPad: 24 } : null),
  });
  const audioInputRef = useRef<HTMLInputElement>(null);
  // 고객 화면 실시간 상태 — demoBus 단일 소스 (알약 상태문구 + 패널 자막이 함께 쓴다)
  const live = useLiveCallBus();

  // 고객 화면 전사 스트림 — 고객 발화(demoBus)와 AI 안내 멘트(vm.glassText)를
  // 도착 순서대로 합친다. AI 멘트는 폰의 유리판에서 걷어내 패널로 옮긴 것.
  const [stream, setStream] = useState<StreamItem[]>([]);
  const custCount = useRef(0);
  const lastGlass = useRef("");
  useEffect(() => {
    if (live.lines.length < custCount.current) {
      // 새 콜/리셋 — 스트림도 함께 비운다
      custCount.current = 0;
      lastGlass.current = "";
      setStream([]);
    }
    if (live.lines.length > custCount.current) {
      const fresh = live.lines
        .slice(custCount.current)
        .map((l) => ({ ...l, who: "cust" as const }));
      custCount.current = live.lines.length;
      setStream((s) => [...s, ...fresh]);
    }
  }, [live.lines]);
  useEffect(() => {
    if (view !== "phone") return;
    const g = vm.showGlass ? vm.glassText : "";
    if (g && g !== lastGlass.current) {
      lastGlass.current = g;
      setStream((s) => [...s, { id: "ai-" + Date.now(), text: g, who: "ai" }]);
    }
  }, [view, vm.showGlass, vm.glassText]);
  useEffect(() => {
    if (vm.phIdle) {
      custCount.current = 0;
      lastGlass.current = "";
      setStream([]);
    }
  }, [vm.phIdle]);

  // 직원 분할 뷰 — 통화 연결(active 진입)의 상승엣지에 자동 on. 리셋(idle)이면 off.
  // 상승엣지로만 켜므로, 통화 중 알약 토글로 끈 뒤 다시 켜지지 않는다(발표자 제어 유지).
  const wasActive = useRef(false);
  useEffect(() => {
    if (view === "desktop" && vm.showActive && !wasActive.current) setDeskSplit(true);
    wasActive.current = vm.showActive;
  }, [view, vm.showActive]);
  useEffect(() => {
    if (vm.phIdle) setDeskSplit(false);
  }, [vm.phIdle]);

  // 데모 투어링 — 시연·발표용 안내 레이어(src/tour, 분리 모듈).
  // pending = 시작 선택 전 · on = 투어 진행 · off = 자유 체험. 실제 제품에선 이 상태와 아래 마운트만 지우면 된다.
  const [tourMode, setTourMode] = useState<"pending" | "on" | "off">("pending");
  const [tourRun, setTourRun] = useState(0); // 재시작 키 — 알약 클릭 시 지금 화면 투어부터 다시
  const startTour = () => {
    setTourMode("on");
    setTourRun((k) => k + 1);
  };
  const screenKey = SCREEN_ORDER[vm.stepIndex];

  // 관리자 보기 — 통화 화면 전용. 토글을 켜면 왼쪽 아래에 시트 헤더만 고개를 내밀고(peek),
  // 그 헤더를 클릭해야 전체가 올라온다. 평소(통화 밖·토글 꺼짐)에는 아예 안 보인다.
  const [adminOpen, setAdminOpen] = useState(false);
  const adminAvailable = vm.showActive && !vm.showWrap; // 통화 중 화면에서만
  useEffect(() => {
    if (!adminAvailable) setAdminOpen(false);
  }, [adminAvailable]);

  return (
    <div
      ref={vm.rootRef}
      style={css("min-height:100vh;padding:" + (view === "desktop" ? "12px" : "20px") + ";display:flex;justify-content:center;align-items:center;background:#060607;box-sizing:border-box")}
    >
      <div
        style={{
          width: vm.scaledW,
          height: vm.scaledH,
          // 분할 전환 시 바깥 사이징 박스도 같은 커브로 — 리센터가 점프 없이 미끄러진다
          transition: view === "desktop" ? "width .45s cubic-bezier(.2,.8,.2,1), height .45s cubic-bezier(.2,.8,.2,1)" : undefined,
        }}
      >
        <div
          ref={vm.stageRef}
          style={{
            width: vm.stageWpx,
            transformOrigin: "top left",
            transform: vm.scaleT,
            display: "flex",
            flexDirection: "column",
            gap: "18px",
            alignItems: "center",
            // 직원 분할 뷰 진입/해제 — 스케일·폭이 한 커브로 움직여
            // "오른쪽으로 가며 작아지고, 왼쪽으로 오며 커지는" 연속 모션이 된다
            transition:
              view === "desktop"
                ? "transform .45s cubic-bezier(.2,.8,.2,1), width .45s cubic-bezier(.2,.8,.2,1)"
                : undefined,
          }}
        >
          {/* 상단 제어 바 — 4단계 스테퍼 알약(시연용 리모컨). 번호를 누르면 그 단계 안내가 팝업으로 뜬다.
              고객 화면(phone)에선 데모 제어를 걷어내고 아래의 '상황 알약'으로 대체한다 */}
          {view !== "phone" && (
          <div style={css("display:flex;align-items:center;gap:14px;background:var(--onair-surface);border-radius:9999px;padding:10px 12px 10px 24px;box-shadow:0 10px 34px rgba(0,0,0,.28)")}>
            <div style={css("display:flex;align-items:center;gap:10px")}>
              {["대기", "접수", "준비", "통화", "후처리"].map((label, i) => {
                const active = vm.stepIndex === i;
                const done = vm.stepIndex > i;
                return (
                  <span key={label} style={css("display:inline-flex;align-items:center;gap:10px")}>
                    {i > 0 && <span style={css("width:14px;height:1.5px;background:" + (done || active ? "var(--gray-500)" : "var(--gray-300)"))} />}
                    <span
                      onClick={() => vm.jumpToStep(i)}
                      title={label + " 화면으로 바로 이동"}
                      style={css("display:inline-flex;align-items:center;gap:6px;cursor:pointer")}
                    >
                      <span
                        style={css(
                          "width:21px;height:21px;border-radius:9999px;display:flex;align-items:center;justify-content:center;font:700 11px 'Geist Mono',monospace;" +
                            (active
                              ? "background:var(--blue-700);color:#fff"
                              : done
                              ? "background:var(--gray-1000);color:#fff"
                              : "background:var(--gray-100);color:var(--gray-600)")
                        )}
                      >
                        {/* 대기 = 0(아직 콜 시작 전). 접수부터 1 */}
                        {done ? <span className="mi" style={css("font-size:13px")}>check</span> : i}
                      </span>
                      <span style={css("font:600 12.5px 'Geist Sans','Pretendard',sans-serif;color:" + (active ? "var(--gray-1000)" : "var(--gray-600)"))}>{label}</span>
                      {label === "준비" && (
                        <span className="mi" title="이 데모의 핵심 — 상담 준비 카드" style={css("font-size:13px;color:var(--amber-700);margin-left:-3px")}>star</span>
                      )}
                    </span>
                  </span>
                );
              })}
            </div>
            <span style={css("width:1px;height:20px;background:var(--color-border)")} />
            {/* 다음 인입 콜 유형 — 콜 유형은 접수 시점에 고정되므로 대기 중에만 바꿀 수 있다.
                진행 중에는 흐려지고 잠금 아이콘이 이유를 말한다 */}
            <div
              title={vm.canPickIncoming ? "다음 콜의 인입 유형을 고릅니다" : "콜 유형은 접수 시점에 정해져요 — 이번 콜을 마치면 바꿀 수 있습니다"}
              style={css("display:flex;align-items:center;border:1px solid var(--color-border);border-radius:9999px;overflow:hidden;transition:opacity .2s" + (vm.canPickIncoming ? "" : ";opacity:.45"))}
            >
              {([
                ["normal", "일반", vm.pickNormal],
                ["urgent", "긴급", vm.pickUrgent],
                ["transfer", "이관 수신", vm.pickTransfer],
              ] as const).map(([key, label, pick]) => {
                const on = vm.incoming === key;
                const accent = key === "urgent" ? "var(--red-800)" : "var(--blue-700)";
                return (
                  <span
                    key={key}
                    onClick={pick}
                    style={css(
                      "padding:6px 12px;font-size:12.5px;font-weight:600;background:" +
                        (on ? accent : "#fff") +
                        ";color:" +
                        (on ? "#fff" : "var(--color-fg-secondary)") +
                        ";cursor:" + (vm.canPickIncoming ? "pointer" : "not-allowed")
                    )}
                  >
                    {label}
                  </span>
                );
              })}
              {!vm.canPickIncoming && (
                <span className="mi" style={css("font-size:13px;color:var(--color-fg-muted);padding:0 8px 0 2px")}>lock</span>
              )}
            </div>
            <input
              ref={audioInputRef}
              type="file"
              accept="audio/*,.wav,.mp3,.m4a,.webm"
              hidden
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void vm.submitAudio(file);
                event.target.value = "";
              }}
            />
            <span
              onClick={() => !vm.audioBusy && audioInputRef.current?.click()}
              style={css(
                "display:inline-flex;align-items:center;gap:5px;padding:7px 15px;background:" +
                  (vm.audioBusy ? "var(--gray-200)" : "var(--green-700)") +
                  ";color:" +
                  (vm.audioBusy ? "var(--gray-600)" : "#fff") +
                  ";border-radius:9999px;font-size:13px;font-weight:600;cursor:" +
                  (vm.audioBusy ? "wait" : "pointer")
              )}
            >
              <span className="mi" style={css("font-size:17px")}>audio_file</span>
              {vm.audioBusy ? "음성 처리 중" : "음성 파일 선택"}
            </span>
            {/* '5초 건너뛰고 요약' — 실제 직원 화면에는 없는 데모 제어라 리모컨(여기)에 둔다 */}
            {vm.showSkip && (
              <span data-tour="skip" onClick={vm.skipWait} style={css("display:inline-flex;align-items:center;gap:5px;padding:7px 15px;background:var(--blue-700);color:#fff;border-radius:9999px;font-size:13px;font-weight:600;cursor:pointer")}>
                <span className="mi" style={css("font-size:17px")}>skip_next</span>5초 건너뛰고 요약
              </span>
            )}
            {/* 직원 분할 뷰 토글 — 통화 연결 시 자동 켜지지만, 발표자가 화면을 다시 키우고 싶으면 여기서 끈다.
                켜짐=본체 축소+좌측 고객 발화(STT) / 꺼짐=본체 전체 화면 */}
            {view === "desktop" && (
              <span
                onClick={() => setDeskSplit((v) => !v)}
                title={deskSplit ? "화면을 다시 키우고 고객 발화 패널을 숨깁니다" : "본체를 줄이고 왼쪽에 고객 발화(STT)를 표시합니다"}
                style={css(
                  "display:inline-flex;align-items:center;gap:5px;padding:7px 15px;border-radius:9999px;font-size:13px;font-weight:600;cursor:pointer;background:" +
                    (deskSplit ? "var(--blue-700);color:#fff" : "var(--gray-100);color:var(--gray-1000)")
                )}
              >
                <span className="mi" style={css("font-size:17px")}>{deskSplit ? "close_fullscreen" : "call_split"}</span>
                {deskSplit ? "화면 키우기" : "고객 발화 보기"}
              </span>
            )}
            <span onClick={vm.reset} style={css("display:inline-flex;align-items:center;gap:5px;padding:7px 15px;background:var(--gray-100);border-radius:9999px;font-size:13px;font-weight:600;cursor:pointer")}>
              <span className="mi" style={css("font-size:17px")}>restart_alt</span>초기화
            </span>
            {adminAvailable && (
            <span
              onClick={() => setAdminOpen((v) => !v)}
              title="관리자 보기 — 부서별 실시간 대기열"
              style={css(
                "display:inline-flex;align-items:center;gap:5px;padding:7px 15px;border-radius:9999px;font-size:13px;font-weight:600;cursor:pointer;background:" +
                  (adminOpen ? "var(--gray-1000)" : "var(--gray-100)") +
                  ";color:" + (adminOpen ? "#fff" : "var(--gray-800)")
              )}
            >
              <span className="mi" style={css("font-size:17px")}>monitoring</span>관리자
            </span>
            )}
          </div>
          )}

          {/* 고객 화면 상황 알약 — 발표용 화면: on/off(● 대기·통화)만. 상태 문구·초기화 없음.
              (리셋은 새로고침 또는 폰의 통화 버튼 — 새 콜 시작이 곧 리셋) */}
          {view === "phone" && (
            <div style={css("display:flex;align-items:center")}>
              {/* 발표용: 테두리·배경 없이 점 + 상태 텍스트만. 검은 스테이지 위라 텍스트는 밝게 */}
              <span
                style={css(
                  "display:inline-flex;align-items:center;gap:7px;font-size:12.5px;font-weight:700;color:" +
                    (live.active ? "var(--green-400)" : "var(--gray-400)")
                )}
              >
                <span
                  style={css(
                    "width:7px;height:7px;border-radius:9999px;background:" +
                      (live.active ? "var(--green-500);animation:recBlink 1.1s infinite" : "var(--gray-500)")
                  )}
                />
                {live.active ? "통화 중" : "대기 중"}
              </span>
            </div>
          )}

          {vm.micErr && (
            <div style={css("background:var(--onair-surface);border-radius:9999px;padding:8px 16px;font-size:12.5px;color:var(--amber-900);box-shadow:0 10px 34px rgba(0,0,0,.28);display:flex;align-items:center;gap:6px")}>
              <span className="mi" style={css("font-size:16px")}>info</span>
              {vm.micErr}
            </div>
          )}

          {/* 폰 + 데스크톱 — 직원 화면은 16:10 노트북 비율. 안내 팝업은 이 영역 위 중앙 딤 모달로 뜬다.
              view에 따라 한쪽만 남긴다: customer=폰, employee=데스크톱 (스테이지·스케일은 공유) */}
          <div style={css("position:relative;display:flex;gap:40px;align-items:center;justify-content:center")}>
            {view !== "desktop" && <Phone vm={vm} clean={view === "phone"} />}
            {/* 고객 화면 — 폰은 살짝 왼쪽, 오른쪽에 실시간 현황·발화 스트림(타이핑 애니메이션) */}
            {view === "phone" && <LiveTranscriptPanel stream={stream} active={live.active} />}
            {/* 직원 분할 뷰 — 통화 연결 시 본체 왼쪽에 고객 발화(STT) 패널.
                항상 마운트해 두고 max-width·이동·투명도를 본체와 같은 커브로 접었다 편다 —
                패널이 왼쪽에서 미끄러져 들어오는 동안 본체는 오른쪽으로 밀리며 줄어든다(한 호흡).
                접힘 시 margin-right:-40이 flex gap을 상쇄해 본체가 정확히 제자리로 복원된다 */}
            {view === "desktop" && (
              <div
                style={{
                  overflow: "hidden",
                  maxWidth: deskSplit ? 300 : 0,
                  opacity: deskSplit ? 1 : 0,
                  marginRight: deskSplit ? 0 : -40,
                  transform: deskSplit ? "translateX(0)" : "translateX(-28px)",
                  transition:
                    "max-width .45s cubic-bezier(.2,.8,.2,1), opacity .3s ease-out, margin-right .45s cubic-bezier(.2,.8,.2,1), transform .45s cubic-bezier(.2,.8,.2,1)",
                }}
              >
                <LiveTranscriptPanel stream={stream} active={live.active} />
              </div>
            )}
            {view !== "phone" && (
              <div style={css("flex:none;width:1100px;height:688px;position:relative")}>
                {vm.showWaiting && <Waiting vm={vm} />}
                {vm.showPrep && <PrepCard vm={vm} />}
                {/* 종료 후에도 통화 화면이 배경에 남고, 후처리 시트가 그 위로 올라온다 */}
                {vm.showActive && <ActiveCall vm={vm} />}
                {vm.showWrap && <WrapSheet vm={vm} />}
              </div>
            )}

            {/* 데모 안내 팝업 — 화면 중앙 딤 모달. 폰·데스크톱은 그대로 두고(안 밀림) 뒤만 어두워진다.
                단계 도달 시 자동, 스테퍼 번호 클릭 시 그 단계. × 또는 바깥(딤) 클릭으로 닫음.
                단독 뷰(customer/employee)에선 안 띄운다 — 안내는 시연 합본의 것 */}
            {view === "full" && guideRender && (
              <>
                <div
                  onClick={vm.closeGuide}
                  style={css("position:absolute;inset:0;z-index:500;background:rgba(22,20,17,.42);transition:opacity .3s ease-out;cursor:pointer;opacity:" + (guideIn ? "1" : "0"))}
                />
                <div style={css("position:absolute;left:50%;top:50%;z-index:501;width:560px;max-width:92%;background:var(--onair-surface);border-radius:16px;box-shadow:var(--sh-modal);overflow:hidden;transform-origin:50% 40%;transition:transform .34s var(--ease-out),opacity .26s ease-out;" + (guideIn ? "opacity:1;transform:translate(-50%,-50%) scale(1)" : "opacity:0;transform:translate(-50%,-46%) scale(.92)"))}>
                  {/* 헤더 */}
                  <div style={css("display:flex;align-items:center;gap:9px;padding:15px 18px 13px")}>
                    <span className="mi" style={css("font-size:20px;color:var(--blue-700)")}>tips_and_updates</span>
                    <span style={css("font:700 13px 'Geist Sans','Pretendard',sans-serif;color:var(--gray-1000)")}>데모 안내</span>
                    <span style={css("font:400 11.5px 'Geist Sans','Pretendard',sans-serif;color:var(--gray-600)")}>· 화면별 소개</span>
                    <div style={css("flex:1")} />
                    <span onClick={vm.closeGuide} title="닫기" style={css("cursor:pointer;display:flex;width:28px;height:28px;border-radius:9999px;align-items:center;justify-content:center;background:var(--gray-100)")}>
                      <span className="mi" style={css("font-size:18px;color:var(--gray-600)")}>close</span>
                    </span>
                  </div>

                  {/* 단계 인디케이터 — 대기·접수·준비·통화·후처리. 클릭하면 그 단계 안내로 */}
                  <div style={css("display:flex;align-items:flex-start;padding:2px 18px 15px")}>
                    {vm.guideSteps.map((s, i) => {
                      const cur = i === vm.guideIndex;
                      const done = i < vm.guideIndex;
                      return (
                        <span key={s.key} style={css("display:flex;align-items:flex-start;" + (i > 0 ? "flex:1" : "flex:none"))}>
                          {i > 0 && (
                            <span style={css("flex:1;height:2px;margin:10px 6px 0;border-radius:2px;transition:background .3s;background:" + (i <= vm.guideIndex ? "var(--gray-500)" : "var(--gray-200)"))} />
                          )}
                          <span
                            onClick={() => vm.openGuideStep(s.key)}
                            title={s.label + " 안내 보기"}
                            style={css("display:flex;flex-direction:column;align-items:center;gap:5px;flex:none;cursor:pointer")}
                          >
                            <span style={css("width:22px;height:22px;border-radius:9999px;display:flex;align-items:center;justify-content:center;font:700 10.5px 'Geist Mono',monospace;transition:background .25s,color .25s;" + (cur ? "background:var(--blue-700);color:#fff" : done ? "background:var(--gray-1000);color:#fff" : "background:var(--gray-100);color:var(--gray-500)"))}>
                              {done ? <span className="mi" style={css("font-size:13px")}>check</span> : i + 1}
                            </span>
                            <span style={css("font:600 10.5px 'Geist Sans','Pretendard',sans-serif;white-space:nowrap;color:" + (cur ? "var(--gray-1000)" : "var(--gray-500)"))}>{s.label}</span>
                          </span>
                        </span>
                      );
                    })}
                  </div>

                  {/* 슬라이드 콘텐츠 — 단계 전환 시 방향성 슬라이드(key=guideStep 재마운트로 애니 재생) */}
                  <div style={css("padding:0 20px;min-height:174px")}>
                    <div key={vm.guideStep} style={{ animation: (dir >= 0 ? "guideSlideFwd" : "guideSlideBack") + " .34s cubic-bezier(0.2,0.8,0.2,1)" }}>
                      <div style={css("font:700 18px/1.35 'Geist Sans','Pretendard',sans-serif;letter-spacing:-.2px;color:var(--gray-1000);margin-bottom:12px")}>{vm.guide.title}</div>
                      <div style={css("display:flex;flex-direction:column;gap:10px")}>
                        {vm.guide.points.map((pt, i) => (
                          <div key={i} style={css("display:flex;gap:10px;align-items:flex-start")}>
                            <span style={css("flex:none;width:6px;height:6px;border-radius:9999px;background:var(--blue-500);margin-top:7px")} />
                            <span style={css("font:400 13px/1.55 'Geist Sans','Pretendard',sans-serif;color:var(--gray-900)")}>{pt}</span>
                          </div>
                        ))}
                      </div>
                      <div style={css("margin-top:13px;display:flex;gap:9px;align-items:flex-start;background:var(--gray-100);border-radius:10px;padding:11px 13px")}>
                        <span className="mi" style={css("font-size:17px;color:var(--blue-700);margin-top:1px")}>arrow_forward</span>
                        <span style={css("font:600 12.5px/1.5 'Geist Sans','Pretendard',sans-serif;color:var(--gray-1000)")}>{vm.guide.next}</span>
                      </div>
                    </div>
                  </div>

                  {/* 푸터 — 이전 / N·M / 다음(마지막은 완료). 데모는 안 움직이고 안내만 넘긴다 */}
                  <div style={css("display:flex;align-items:center;gap:10px;padding:15px 18px 16px")}>
                    <span
                      onClick={vm.guidePrev}
                      style={css("display:inline-flex;align-items:center;gap:3px;font:600 12.5px 'Geist Sans','Pretendard',sans-serif;border-radius:9999px;padding:8px 14px 8px 11px;background:var(--gray-100);transition:opacity .2s;" + (vm.guideIndex > 0 ? "color:var(--gray-800);cursor:pointer" : "color:var(--gray-400);opacity:.5;cursor:default"))}
                    >
                      <span className="mi" style={css("font-size:17px")}>arrow_back</span>이전
                    </span>
                    <div style={css("flex:1;text-align:center;font:600 11px 'Geist Mono','IBM Plex Mono',monospace;color:var(--gray-500)")}>{vm.guideIndex + 1} / {vm.guideSteps.length}</div>
                    {vm.guideIndex < vm.guideSteps.length - 1 ? (
                      <span onClick={vm.guideNext} style={css("display:inline-flex;align-items:center;gap:3px;font:600 12.5px 'Geist Sans','Pretendard',sans-serif;background:var(--blue-700);color:#fff;border-radius:9999px;padding:8px 12px 8px 15px;cursor:pointer")}>
                        다음 <span className="mi" style={css("font-size:17px")}>arrow_forward</span>
                      </span>
                    ) : (
                      <span onClick={vm.guideNext} style={css("display:inline-flex;align-items:center;gap:4px;font:600 12.5px 'Geist Sans','Pretendard',sans-serif;background:var(--gray-1000);color:#fff;border-radius:9999px;padding:8px 15px;cursor:pointer")}>
                        완료 <span className="mi" style={css("font-size:16px")}>check</span>
                      </span>
                    )}
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {/* 데모 투어링 마운트 — 스테이지(transform: scale) 바깥이라 fixed 오버레이가 정확히 얹힌다.
          실제 제품에선 이 두 줄과 src/tour 폴더만 지우면 투어가 완전히 사라진다. (src/tour/README.md) */}
      {tourMode === "pending" && <TourChooser onPick={(t) => setTourMode(t ? "on" : "off")} />}
      {tourMode === "on" && <DemoTour key={tourRun} vm={vm} screen={screenKey} onExit={() => setTourMode("off")} />}
    </div>
  );
}
