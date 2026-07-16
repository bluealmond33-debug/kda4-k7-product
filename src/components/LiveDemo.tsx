import { useRef } from "react";
import { css } from "../lib/css";
import { useCallFlow, type CallFlowConfig } from "../hooks/useCallFlow";
import Phone from "./Phone";
import Waiting from "./desktop/Waiting";
import PrepCard from "./desktop/PrepCard";
import ActiveCall from "./desktop/ActiveCall";
import WrapSheet from "./desktop/WrapSheet";

/**
 * K7 라이브 상담 시연 — 왼쪽 아이폰(자연어 접수) + 오른쪽 상담사 데스크톱.
 * 전화 → 안내·녹음 → 무응답 → AI 요약 → 준비 카드 → 통화 → 후처리.
 */
export default function LiveDemo(config: CallFlowConfig = {}) {
  const vm = useCallFlow(config);
  const audioInputRef = useRef<HTMLInputElement>(null);

  return (
    <div
      ref={vm.rootRef}
      style={css("min-height:100vh;padding:20px;display:flex;justify-content:center;background:#060607;box-sizing:border-box")}
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
          {/* 상단 제어 바 */}
          <div style={css("display:flex;align-items:center;gap:14px;background:#fff;border:1px solid var(--color-border);border-radius:9999px;padding:10px 12px 10px 22px;box-shadow:0 10px 34px rgba(0,0,0,.28)")}>
            <span style={css("font-weight:600;font-size:15px;letter-spacing:-.2px")}>K7 라이브 상담 시연</span>
            <span style={css("display:inline-flex;align-items:center;gap:6px;font-size:12.5px;font-weight:600;color:var(--blue-900);background:#fff;border:1px solid var(--blue-400);border-radius:9999px;padding:3px 11px")}>
              <span style={css("width:7px;height:7px;border-radius:9999px;background:var(--blue-700);animation:pulseDot 1.4s infinite")} />
              {vm.phaseLabel}
            </span>
            <span style={css("width:1px;height:20px;background:var(--color-border)")} />
            <span style={css("font-size:12px;color:var(--color-fg-muted)")}>입력</span>
            <div style={css("display:flex;border:1px solid var(--color-border);border-radius:9999px;overflow:hidden")}>
              <span onClick={vm.setSim} style={css("padding:6px 13px;font-size:12.5px;font-weight:600;cursor:pointer;background:" + vm.simBg + ";color:" + vm.simFg)}>시뮬레이션</span>
              <span onClick={vm.setMic} style={css("padding:6px 13px;font-size:12.5px;font-weight:600;cursor:pointer;background:" + vm.micBg + ";color:" + vm.micFg)}>실제 마이크</span>
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
              {vm.audioBusy ? "음성 처리 중" : "실제 음성 파일"}
            </span>
            {vm.showSkip && (
              <span onClick={vm.skipWait} style={css("display:inline-flex;align-items:center;gap:5px;padding:7px 15px;background:var(--blue-700);color:#fff;border-radius:9999px;font-size:13px;font-weight:600;cursor:pointer")}>
                <span className="mi" style={css("font-size:17px")}>skip_next</span>5초 건너뛰고 요약
              </span>
            )}
            <span onClick={vm.reset} style={css("display:inline-flex;align-items:center;gap:5px;padding:7px 15px;background:var(--gray-100);border-radius:9999px;font-size:13px;font-weight:600;cursor:pointer")}>
              <span className="mi" style={css("font-size:17px")}>restart_alt</span>초기화
            </span>
          </div>

          {vm.micErr && (
            <div style={css("background:#fff;border:1px solid var(--amber-400);border-radius:9999px;padding:8px 16px;font-size:12.5px;color:var(--amber-900);display:flex;align-items:center;gap:6px")}>
              <span className="mi" style={css("font-size:16px")}>info</span>
              {vm.micErr}
            </div>
          )}

          {/* 폰 + 데스크톱 */}
          <div style={css("display:flex;gap:80px;align-items:center;justify-content:center")}>
            <Phone vm={vm} />
            <div style={css("flex:none;width:1040px;height:679px;display:flex;align-items:center;justify-content:center")}>
              {vm.showWaiting && <Waiting vm={vm} />}
              {vm.showPrep && <PrepCard vm={vm} />}
              {vm.showActive && <ActiveCall vm={vm} />}
              {vm.showWrap && <WrapSheet vm={vm} />}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
