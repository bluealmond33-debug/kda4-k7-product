import { useEffect, useRef, useState } from "react";
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

  // 데모 안내 팝업 등장/퇴장 모션 — 화면 중앙에서 슉 뜨고 다시 접힌다.
  // 첫 로드엔 살짝 늦게 떠서 "여기 안내가 뜨는구나"가 읽히게. 열려 있는 동안 단계가 바뀌면
  // 딤을 유지한 채 내용만 즉시 교체(깜빡임 없음), 닫혀 있다 새로 뜰 때만 팝 애니메이션.
  const guideMounted = useRef(false);
  const [guideRender, setGuideRender] = useState(vm.guideOpen);
  const [guideIn, setGuideIn] = useState(false);
  useEffect(() => {
    if (vm.guideOpen) {
      setGuideRender(true);
      const delay = guideMounted.current ? 0 : 420; // 첫 등장만 지연
      guideMounted.current = true;
      let raf = 0;
      const t = window.setTimeout(() => {
        raf = requestAnimationFrame(() => setGuideIn(true));
      }, delay);
      return () => {
        window.clearTimeout(t);
        if (raf) cancelAnimationFrame(raf);
      };
    }
    guideMounted.current = true;
    setGuideIn(false); // 퇴장 애니메이션
    const t = window.setTimeout(() => setGuideRender(false), 300); // 끝나면 언마운트
    return () => window.clearTimeout(t);
  }, [vm.guideOpen]);

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
          {/* 상단 제어 바 — 4단계 스테퍼 알약(시연용 리모컨). 번호를 누르면 그 단계 안내가 팝업으로 뜬다 */}
          <div style={css("display:flex;align-items:center;gap:14px;background:var(--onair-surface);border-radius:9999px;padding:10px 12px 10px 24px;box-shadow:0 10px 34px rgba(0,0,0,.28)")}>
            <div style={css("display:flex;align-items:center;gap:10px")}>
              {["접수", "준비", "통화", "후처리"].map((label, i) => {
                const n = i + 1;
                const active = vm.stepIndex === n;
                const done = vm.stepIndex > n;
                return (
                  <span key={label} style={css("display:inline-flex;align-items:center;gap:10px")}>
                    {i > 0 && <span style={css("width:14px;height:1.5px;background:" + (done || active ? "var(--gray-500)" : "var(--gray-300)"))} />}
                    <span
                      onClick={() => vm.openGuideStep(["intake", "prep", "active", "wrap"][i])}
                      title={label + " 안내 보기"}
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
                        {done ? <span className="mi" style={css("font-size:13px")}>check</span> : n}
                      </span>
                      <span style={css("font:600 12.5px 'Geist Sans','Pretendard',sans-serif;color:" + (active ? "var(--gray-1000)" : "var(--gray-600)"))}>{label}</span>
                    </span>
                  </span>
                );
              })}
            </div>
            <span style={css("width:1px;height:20px;background:var(--color-border)")} />
            <span style={css("display:inline-flex;align-items:center;font-size:12.5px;font-weight:600;color:var(--blue-900);background:var(--gray-100);border-radius:9999px;padding:4px 11px")}>
              {vm.phaseLabel}
            </span>
            {/* 다음 인입 콜 유형 — 콜 유형은 접수 시점에 고정되므로 대기 중에만 바꿀 수 있다.
                진행 중에는 흐려지고 잠금 아이콘이 이유를 말한다 */}
            <span style={css("font-size:12px;color:var(--color-fg-muted)")}>다음 콜</span>
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
            <div style={css("background:var(--onair-surface);border-radius:9999px;padding:8px 16px;font-size:12.5px;color:var(--amber-900);box-shadow:0 10px 34px rgba(0,0,0,.28);display:flex;align-items:center;gap:6px")}>
              <span className="mi" style={css("font-size:16px")}>info</span>
              {vm.micErr}
            </div>
          )}

          {/* 폰 + 데스크톱 — 직원 화면은 16:10 노트북 비율. 안내 팝업은 이 영역 위 중앙 딤 모달로 뜬다 */}
          <div style={css("position:relative;display:flex;gap:40px;align-items:center;justify-content:center")}>
            <Phone vm={vm} />
            <div style={css("flex:none;width:1100px;height:688px;position:relative")}>
              {vm.showWaiting && <Waiting vm={vm} />}
              {vm.showPrep && <PrepCard vm={vm} />}
              {/* 종료 후에도 통화 화면이 배경에 남고, 후처리 시트가 그 위로 올라온다 */}
              {vm.showActive && <ActiveCall vm={vm} />}
              {vm.showWrap && <WrapSheet vm={vm} />}
            </div>

            {/* 데모 안내 팝업 — 화면 중앙 딤 모달. 폰·데스크톱은 그대로 두고(안 밀림) 뒤만 어두워진다.
                단계 도달 시 자동, 스테퍼 번호 클릭 시 그 단계. × 또는 바깥(딤) 클릭으로 닫음 */}
            {guideRender && (
              <>
                <div
                  onClick={vm.closeGuide}
                  style={css("position:absolute;inset:0;z-index:500;background:rgba(22,20,17,.42);transition:opacity .3s ease-out;cursor:pointer;opacity:" + (guideIn ? "1" : "0"))}
                />
                <div style={css("position:absolute;left:50%;top:50%;z-index:501;width:540px;max-width:92%;background:var(--onair-surface);border-radius:16px;box-shadow:var(--sh-modal);overflow:hidden;transform-origin:50% 40%;transition:transform .34s var(--ease-out),opacity .26s ease-out;" + (guideIn ? "opacity:1;transform:translate(-50%,-50%) scale(1)" : "opacity:0;transform:translate(-50%,-46%) scale(.92)"))}>
                  <div style={css("display:flex;align-items:center;gap:9px;padding:16px 18px 14px;border-bottom:1px solid var(--gray-200)")}>
                    <span className="mi" style={css("font-size:20px;color:var(--blue-700)")}>tips_and_updates</span>
                    <span style={css("font:700 13px 'Geist Sans','Pretendard',sans-serif;color:var(--gray-1000)")}>데모 안내</span>
                    <span style={css("font:600 11px 'Geist Mono','IBM Plex Mono',monospace;color:var(--blue-900);background:var(--gray-100);border-radius:9999px;padding:3px 9px")}>{vm.guide.step}</span>
                    <div style={css("flex:1")} />
                    <span onClick={vm.closeGuide} title="닫기" style={css("cursor:pointer;display:flex;width:28px;height:28px;border-radius:9999px;align-items:center;justify-content:center;background:var(--gray-100)")}>
                      <span className="mi" style={css("font-size:18px;color:var(--gray-600)")}>close</span>
                    </span>
                  </div>
                  <div style={css("padding:17px 20px 6px")}>
                    <div style={css("font:700 18px/1.35 'Geist Sans','Pretendard',sans-serif;letter-spacing:-.2px;color:var(--gray-1000);margin-bottom:13px")}>{vm.guide.title}</div>
                    <div style={css("display:flex;flex-direction:column;gap:11px")}>
                      {vm.guide.points.map((pt, i) => (
                        <div key={i} style={css("display:flex;gap:10px;align-items:flex-start")}>
                          <span style={css("flex:none;width:6px;height:6px;border-radius:9999px;background:var(--blue-500);margin-top:7px")} />
                          <span style={css("font:400 13.5px/1.6 'Geist Sans','Pretendard',sans-serif;color:var(--gray-900)")}>{pt}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                  <div style={css("margin:15px 18px 18px;display:flex;gap:9px;align-items:flex-start;background:var(--gray-100);border-radius:10px;padding:12px 14px")}>
                    <span className="mi" style={css("font-size:18px;color:var(--blue-700);margin-top:1px")}>arrow_forward</span>
                    <span style={css("font:600 13px/1.5 'Geist Sans','Pretendard',sans-serif;color:var(--gray-1000)")}>{vm.guide.next}</span>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
