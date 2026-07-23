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
 * phone/desktop은 등록된 call_id를 공유하면 ARS·STT와 DemoEnvelope WS 릴레이로 동기화된다.
 * call_id가 없는 full 화면은 기존 단일 브라우저 스크립트 데모를 유지한다.
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

  // 고객 화면은 폰+전사 패널을 '항상 가로로 나란히' 둔다 — 화면 폭이 줄어도 세로로
  // 쌓지 않고(패널이 폰 아래로 내려가지 않게) 스테이지를 통째로 축소해 맞춘다.
  const compactCustomer = false;
  // 고객 화면은 콘텐츠 폭이 좁다(폰 260 + 패널 470) — 스테이지를 콘텐츠에 맞추고
  // 확대를 허용해 큰 모니터에서 양옆 여백 없이 화면을 채운다
  const vm = useCallFlow({
    ...config,
    // phone owns the mobile ARS socket, desktop/full own the counselor socket.
    // The combined full view keeps its green handset button as the scripted
    // demo. With an explicit registered call_id, an external customer page can
    // drive the combined view's counselor side through the same server state.
    surface: view,
    // 실제 Galaxy에서는 터치 크기를 유지하며 세로로 쌓고, 발표용 데스크톱에서는
    // 전화기와 전사 패널을 나란히 배치한다.
    ...(view === "phone"
      ? compactCustomer
        ? { stageW: 432, maxScale: 1, fitPad: 16, fitHeight: false }
        : { stageW: 840, maxScale: 1.7 } // 폰 400 + 간격 40 + 패널 400 = 840 (가로 나란히)
      : null),
    // 직원 단독 화면 — 가로·세로 모두 뷰포트에 맞춘다(fitHeight 기본 true).
    // 가로만 맞추면(fitHeight:false) 낮은 창에서 하단이 잘린다 — 33115b3에서 고친 부분이라 유지.
    // 분할 뷰에선 좌측 STT 패널(260) + 간격(40)만큼 넓어져 본체가 상대적으로 작아진다.
    ...(view === "desktop" ? { stageW: deskSplit ? 1540 : 1100, maxScale: 3, fitPad: 24 } : null),
  });
  const audioInputRef = useRef<HTMLInputElement>(null);
  // Galaxy는 자신의 /ws/call 스트림을 직접 그린다. 상담사 화면이 늦게
  // 열리거나 잠시 끊겨도 고객 자막이 중앙 demo relay에 의존하지 않는다.
  const phoneActive = vm.phInCall && !vm.phEnded;
  // 전사 소스는 둘이다 — 실통화는 이 탭의 /ws/call 관측 스트림(vm.liveTranscriptLines),
  // 대본 데모·다른 탭에서 건 콜은 demoBus(stt.utterance)로 온다. 실통화 스트림이
  // 있으면 그쪽이 정본이다(실통화도 demoBus에 같은 발화를 흘리므로 합치면 중복된다).
  // 이렇게 둬야 희창이형 서버 없이 리허설할 때도 패널이 살아 있다.
  const bus = useLiveCallBus();
  const phoneLines: StreamItem[] = vm.liveTranscriptLines.length
    ? vm.liveTranscriptLines.map((line) => ({
        id: `${line.generation ?? 0}-${line.audioSeq ?? line.seq}-${line.speaker}-${line.at}`,
        text: line.text,
        who: line.speaker,
      }))
    : bus.lines.map((line) => ({ id: line.id, text: line.text, who: line.speaker }));

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
  // 고객 폰 화면(phone)은 무대에서 키오스크처럼 혼자 돌아가야 하므로 안내 모달을 띄우지 않는다
  // — 관제 화면과 같은 취급으로 바로 자유 체험(off)에서 시작한다.
  const [tourMode, setTourMode] = useState<"pending" | "on" | "off">(
    view === "phone" ? "off" : "pending"
  );
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
      style={css(
        "min-height:100vh;padding:" +
          (view === "phone" ? "8px" : view === "desktop" ? "12px" : "20px") +
          ";display:flex;justify-content:center;align-items:" +
          (view === "phone" ? "flex-start" : "center") +
          ";background:#060607;box-sizing:border-box"
      )}
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
            gap: view === "phone" ? "10px" : "18px",
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
          <div
            data-tour="topbar"
            style={{
              ...css("display:flex;align-items:center;gap:14px;background:var(--onair-surface);border-radius:9999px;padding:10px 12px 10px 24px;box-shadow:0 10px 34px rgba(0,0,0,.28)"),
              // 분할 뷰 — 좌측 STT 패널(260)+간격(40)만큼 오른쪽으로 밀어 리모컨이 오른쪽 직원 화면 위에 정렬되게
              marginLeft: view === "desktop" && deskSplit ? 440 : 0,
              transition: view === "desktop" ? "margin-left .45s cubic-bezier(.2,.8,.2,1)" : undefined,
            }}
          >
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
                      <span style={css("font:600 12.5px 'Avenir Next','Geist Sans','Pretendard',sans-serif;color:" + (active ? "var(--gray-1000)" : "var(--gray-600)"))}>{label}</span>
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
            <button
              type="button"
              data-testid="audio-file-button"
              aria-label={vm.audioBusy ? "음성 처리 중" : "음성 파일 선택"}
              disabled={vm.audioBusy}
              onClick={() => !vm.audioBusy && audioInputRef.current?.click()}
              style={css(
                "display:inline-flex;align-items:center;gap:5px;padding:7px 15px;background:" +
                  (vm.audioBusy ? "var(--gray-200)" : "var(--green-700)") +
                  ";color:" +
                  (vm.audioBusy ? "var(--gray-600)" : "#fff") +
                  ";border:0;border-radius:9999px;font-size:13px;font-weight:600;cursor:" +
                  (vm.audioBusy ? "wait" : "pointer")
              )}
            >
              <span className="mi" style={css("font-size:17px")}>audio_file</span>
              {vm.audioBusy ? "음성 처리 중" : "음성 파일 선택"}
            </button>
            {/* '5초 건너뛰고 요약' — 실제 직원 화면에는 없는 데모 제어라 리모컨(여기)에 둔다 */}
            {vm.showSkip && (
              <span data-tour="skip" onClick={vm.skipWait} style={css("display:inline-flex;align-items:center;gap:5px;padding:7px 15px;background:var(--blue-700);color:#fff;border-radius:9999px;font-size:13px;font-weight:600;cursor:pointer")}>
                <span className="mi" style={css("font-size:17px")}>skip_next</span>건너뛰기
              </span>
            )}
            {/* 직원 분할 뷰 토글 — 통화 연결 시 자동 켜지지만, 발표자가 화면을 다시 키우고 싶으면 여기서 끈다.
                켜짐=본체 축소+좌측 고객 발화(STT) / 꺼짐=본체 전체 화면 */}
            {view === "desktop" && (
              <span
                onClick={() => setDeskSplit((v) => !v)}
                title={deskSplit ? "화면을 다시 키우고 대화 패널을 숨깁니다" : "본체를 줄이고 왼쪽에 고객·상담원 대화(STT)를 표시합니다"}
                style={css(
                  "display:inline-flex;align-items:center;gap:5px;padding:7px 15px;border-radius:9999px;font-size:13px;font-weight:600;cursor:pointer;background:" +
                    (deskSplit ? "var(--blue-700);color:#fff" : "var(--gray-100);color:var(--gray-1000)")
                )}
              >
                <span className="mi" style={css("font-size:17px")}>{deskSplit ? "close_fullscreen" : "call_split"}</span>
                {deskSplit ? "화면 키우기" : "대화 보기"}
              </span>
            )}
            {/* 초기화 — 아이콘만(바 혼잡 방지). 5초 건너뛰기 등과 겹칠 때 텍스트가 줄바꿈되던 문제 해소 */}
            <span onClick={vm.reset} title="초기화" style={css("display:inline-flex;align-items:center;justify-content:center;width:33px;height:33px;background:var(--gray-100);border-radius:9999px;cursor:pointer;flex:none")}>
              <span className="mi" style={css("font-size:18px;color:var(--gray-700)")}>restart_alt</span>
            </span>
            {/* 관리자 버튼 제거 — 부서별 대기열은 관제 대시보드(?role=admin)에서 본다 */}
          </div>
          )}

          {/* 연결 상태(서버 미연결·call_id 안내·STT 채널 오류)는 화면에 띄우지 않는다.
              무대에 서는 건 상담 장면이지 배관이 아니고, 연결은 백엔드가 알아서 한다.
              진단이 필요하면 vm.micErr을 콘솔·개발 도구에서 본다. */}

          {/* 폰 + 데스크톱 — 직원 화면은 16:10 노트북 비율. 안내 팝업은 이 영역 위 중앙 딤 모달로 뜬다.
              view에 따라 한쪽만 남긴다: customer=폰, employee=데스크톱 (스테이지·스케일은 공유) */}
          <div
            style={css(
              "position:relative;display:flex;gap:" +
                (view === "phone" && compactCustomer ? "16px" : "40px") +
                ";align-items:center;justify-content:center;flex-direction:" +
                (view === "phone" && compactCustomer ? "column" : "row")
            )}
          >
            {view !== "desktop" && <Phone vm={vm} clean={view === "phone"} />}
            {/* 고객 화면 — 폰 오른쪽에 대화 스트림. 이 화면의 주인은 고객이라
                고객 말이 오른쪽·선명하고 상담원 말은 왼쪽·흐리다(직원 화면과 정확히 거울).
                높이는 옆의 폰(clean=886)에 맞춘다 */}
            {view === "phone" && (
              <LiveTranscriptPanel
                stream={phoneLines}
                active={phoneActive}
                self="customer"
                height={compactCustomer ? 532 : 820}
                width={400}
              />
            )}
            {/* 직원 분할 뷰 — 통화 연결 시 본체 왼쪽에 실시간 전사 패널.
                항상 마운트해 두고 max-width·이동·투명도를 본체와 같은 커브로 접었다 편다 —
                패널이 왼쪽에서 미끄러져 들어오는 동안 본체는 오른쪽으로 밀리며 줄어든다(한 호흡).
                접힘 시 margin-right:-40이 flex gap을 상쇄해 본체가 정확히 제자리로 복원된다 */}
            {view === "desktop" && (
              <div
                style={{
                  overflow: "hidden",
                  maxWidth: deskSplit ? 400 : 0,
                  opacity: deskSplit ? 1 : 0,
                  marginRight: deskSplit ? 0 : -40,
                  transform: deskSplit ? "translateX(0)" : "translateX(-28px)",
                  transition:
                    "max-width .45s cubic-bezier(.2,.8,.2,1), opacity .3s ease-out, margin-right .45s cubic-bezier(.2,.8,.2,1), transform .45s cubic-bezier(.2,.8,.2,1)",
                }}
              >
                {/* 이 화면의 주인은 상담원 — 고객 화면과 좌우가 뒤집힌다.
                    높이는 옆의 콘솔 본체(688)에 맞춘다 */}
                <LiveTranscriptPanel
                  stream={phoneLines}
                  active={phoneActive}
                  self="agent"
                  height={688}
                  width={400}
                />
              </div>
            )}
            {view !== "phone" && (
              <div data-tour="desk" style={css("flex:none;width:1100px;height:688px;position:relative")}>
                {vm.showWaiting && <Waiting vm={vm} />}
                {vm.showPrep && <PrepCard vm={vm} />}
                {/* 종료 후에도 통화 화면이 배경에 남고, 후처리 시트가 그 위로 올라온다 */}
                {vm.showActive && <ActiveCall vm={vm} />}
                {vm.showWrap && <WrapSheet vm={vm} />}
                {adminAvailable && <AdminQueueSheet open={adminOpen} onClose={() => setAdminOpen(false)} extras={vm.queueExtras} />}
              </div>
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
