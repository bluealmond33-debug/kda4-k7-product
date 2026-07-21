import { useEffect, useRef, useState } from "react";
import { css } from "../lib/css";
import { useCallFlow, type CallFlowConfig } from "../hooks/useCallFlow";
import Phone from "./Phone";
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
 */
export default function LiveDemo(config: CallFlowConfig = {}) {
  const vm = useCallFlow(config);
  const audioInputRef = useRef<HTMLInputElement>(null);

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
      style={css("min-height:100vh;padding:20px;display:flex;justify-content:center;align-items:center;background:#060607;box-sizing:border-box")}
    >
      <div style={{ width: vm.scaledW, height: vm.scaledH }}>
        <div
          ref={vm.stageRef}
          style={{
            width: "1420px",
            transformOrigin: "top left",
            transform: vm.scaleT,
            display: "flex",
            flexDirection: "column",
            gap: "18px",
            alignItems: "center",
          }}
        >
          {/* 상단 제어 바 — 5단계 스테퍼 알약(시연용 리모컨): 대기·접수·준비·통화·후처리.
              준비에는 ★ — 준비 카드가 이 데모의 핵심임을 늘 보이게. 클릭 = 지금 화면 투어 다시 보기 */}
          <div data-tour="topbar" style={css("display:flex;align-items:center;gap:14px;background:var(--onair-surface);border-radius:9999px;padding:10px 12px 10px 24px;box-shadow:0 10px 34px rgba(0,0,0,.28)")}>
            <div style={css("display:flex;align-items:center;gap:10px")}>
              {["대기", "접수", "준비", "통화", "후처리"].map((label, i) => {
                const active = vm.stepIndex === i;
                const done = vm.stepIndex > i;
                return (
                  <span key={label} style={css("display:inline-flex;align-items:center;gap:10px")}>
                    {i > 0 && <span style={css("width:14px;height:1.5px;background:" + (done || active ? "var(--gray-500)" : "var(--gray-300)"))} />}
                    <span
                      onClick={startTour}
                      title="지금 화면 투어 다시 보기"
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
                        {/* 대기 = 0 — 아직 콜이 시작되지 않은 상태라 단계 번호는 접수(1)부터 센다 */}
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

          {vm.micErr && (
            <div style={css("background:var(--onair-surface);border-radius:9999px;padding:8px 16px;font-size:12.5px;color:var(--amber-900);box-shadow:0 10px 34px rgba(0,0,0,.28);display:flex;align-items:center;gap:6px")}>
              <span className="mi" style={css("font-size:16px")}>info</span>
              {vm.micErr}
            </div>
          )}

          {/* 폰 + 데스크톱 — 직원 화면은 16:10 노트북 비율 */}
          <div style={css("position:relative;display:flex;gap:40px;align-items:center;justify-content:center")}>
            <Phone vm={vm} />
            <div data-tour="desk" style={css("flex:none;width:1100px;height:688px;position:relative")}>
              {vm.showWaiting && <Waiting vm={vm} />}
              {vm.showPrep && <PrepCard vm={vm} />}
              {/* 종료 후에도 통화 화면이 배경에 남고, 후처리 시트가 그 위로 올라온다 */}
              {vm.showActive && <ActiveCall vm={vm} />}
              {vm.showWrap && <WrapSheet vm={vm} />}
              {adminAvailable && <AdminQueueSheet open={adminOpen} onClose={() => setAdminOpen(false)} extras={vm.queueExtras} />}
            </div>

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
