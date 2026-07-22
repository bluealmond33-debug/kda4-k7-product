import { useEffect, useRef, useState } from "react";
import { css } from "../lib/css";
import { useCallFlow, type CallFlowConfig } from "../hooks/useCallFlow";
import Phone from "./Phone";
import LiveTranscriptPanel, { type StreamItem } from "./LiveTranscriptPanel";
import Waiting from "./desktop/Waiting";
import PrepCard from "./desktop/PrepCard";
import ActiveCall from "./desktop/ActiveCall";
import WrapSheet from "./desktop/WrapSheet";

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
  // 고객 화면은 콘텐츠 폭이 좁다(폰 260 + 패널 470) — 스테이지를 콘텐츠에 맞추고
  // 확대를 허용해 큰 모니터에서 양옆 여백 없이 화면을 채운다
  const vm = useCallFlow({
    ...config,
    // phone owns the mobile ARS socket, desktop/full own the counselor socket.
    // The combined full view keeps its green handset button as the scripted
    // demo. With an explicit registered call_id, an external customer page can
    // drive the combined view's counselor side through the same server state.
    surface: view,
    // The customer route is opened on a real Galaxy, not on a presentation
    // canvas.  Keep the native 432px phone artboard, stack the transcript
    // below it, and fit by width only so controls stay finger-sized instead of
    // shrinking the whole two-column demo into a tiny thumbnail.
    ...(view === "phone"
      ? { stageW: 432, maxScale: 1, fitPad: 16, fitHeight: false }
      : null),
    // 직원 단독 화면 — 데스크톱 폭(1100)을 브라우저 가로에 100% 맞춘다(양옆 여백 없음)
    ...(view === "desktop" ? { stageW: 1100, maxScale: 3, fitPad: 24, fitHeight: false } : null),
  });
  const audioInputRef = useRef<HTMLInputElement>(null);
  // Galaxy는 자신의 /ws/call 스트림을 직접 그린다. 상담사 화면이 늦게
  // 열리거나 잠시 끊겨도 고객 자막이 중앙 demo relay에 의존하지 않는다.
  const phoneActive = vm.phInCall && !vm.phEnded;
  const phoneLines: StreamItem[] = vm.liveTranscriptLines.map((line) => ({
    id: `${line.generation ?? 0}-${line.audioSeq ?? line.seq}-${line.speaker}-${line.at}`,
    text: line.text,
    who: line.speaker,
  }));

  // 데모 안내 팝업 등장/퇴장 모션 — 중앙에서 슉 뜨고 다시 접힌다. 등장 지연은 useCallFlow(700ms)가 담당.
  // 열려 있는 동안 단계가 바뀌면 딤 유지·내용만 즉시 교체(깜빡임 없음), 닫혀 있다 새로 뜰 때만 팝.
  const [guideRender, setGuideRender] = useState(vm.guideOpen);
  const [guideIn, setGuideIn] = useState(false);
  useEffect(() => {
    if (vm.guideOpen) {
      setGuideRender(true);
      let raf = 0;
      const t = window.setTimeout(() => {
        raf = requestAnimationFrame(() => setGuideIn(true));
      }, 0);
      return () => {
        window.clearTimeout(t);
        if (raf) cancelAnimationFrame(raf);
      };
    }
    setGuideIn(false); // 퇴장 애니메이션
    const t = window.setTimeout(() => setGuideRender(false), 300); // 끝나면 언마운트
    return () => window.clearTimeout(t);
  }, [vm.guideOpen]);

  // 가이드 스텝 전환 방향(슬라이드) — 이전 인덱스 대비 앞(오른쪽서)/뒤(왼쪽서)
  const prevIdxRef = useRef(vm.guideIndex);
  const dir = vm.guideIndex >= prevIdxRef.current ? 1 : -1;
  useEffect(() => {
    prevIdxRef.current = vm.guideIndex;
  }, [vm.guideIndex]);

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
      <div style={{ width: vm.scaledW, height: vm.scaledH }}>
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
          }}
        >
          {/* 상단 제어 바 — 4단계 스테퍼 알약(시연용 리모컨). 번호를 누르면 그 단계 안내가 팝업으로 뜬다.
              고객 화면(phone)에선 데모 제어를 걷어내고 아래의 '상황 알약'으로 대체한다 */}
          {view !== "phone" && (
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
                      onClick={() => vm.jumpToStep(i + 1)}
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
          )}

          {/* 고객 화면 상황 알약 — on/off(대기·통화) + 지금 무슨 일이 일어나는지 한 줄.
              실제 휴대폰 화면은 깨끗하게, 상황은 전부 이 알약이 말한다 */}
          {view === "phone" && (
            <div style={css("display:flex;align-items:center;gap:10px;background:var(--onair-surface);border-radius:9999px;padding:8px 10px 8px 16px;box-shadow:0 10px 34px rgba(0,0,0,.28)")}>
              {/* on/off — 배경 없이 점+텍스트만. 통화 시간은 휴대폰 화면(실폰처럼)이 보여준다 */}
              <span
                style={css(
                  "display:inline-flex;align-items:center;gap:7px;font-size:12.5px;font-weight:700;padding:5px 4px;color:" +
                    (phoneActive ? "var(--green-900)" : "var(--gray-700)")
                )}
              >
                <span
                  style={css(
                    "width:7px;height:7px;border-radius:9999px;background:" +
                      (phoneActive ? "var(--green-700);animation:recBlink 1.1s infinite" : "var(--gray-400)")
                  )}
                />
                {phoneActive ? "통화 중" : "대기 중"}
              </span>
              {vm.phoneStatus && (
                <>
                  <span style={css("width:1px;height:18px;background:var(--color-border)")} />
                  <span style={css("font-size:12.5px;font-weight:600;color:var(--blue-900)")}>{vm.phoneStatus}</span>
                </>
              )}
              <span onClick={vm.reset} style={css("display:inline-flex;align-items:center;gap:5px;padding:6px 13px;background:var(--gray-100);border-radius:9999px;font-size:12.5px;font-weight:600;cursor:pointer")}>
                <span className="mi" style={css("font-size:16px")}>restart_alt</span>초기화
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
          <div
            style={css(
              "position:relative;display:flex;gap:" +
                (view === "phone" ? "16px" : "40px") +
                ";align-items:center;justify-content:center;flex-direction:" +
                (view === "phone" ? "column" : "row")
            )}
          >
            {view !== "desktop" && <Phone vm={vm} clean={view === "phone"} />}
            {/* 고객 화면 — 폰은 살짝 왼쪽, 오른쪽에 실시간 현황·발화 스트림(타이핑 애니메이션) */}
            {view === "phone" && <LiveTranscriptPanel stream={phoneLines} active={phoneActive} />}
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
    </div>
  );
}
