import { useRef, useState } from "react";
import { css } from "../../lib/css";
import type { CallFlowVM } from "../../hooks/useCallFlow";
import { AGENT } from "../../data/demoContent";
import DesktopShell from "./DesktopShell";

/** 1c — 상담 준비 카드 (dim 배경 + 모달). 유의사항 확인 시 통화 연결 활성화.
 *  인입 유형별 변주: urgent = 긴급 배지·빨간 램프·우선 배정 / transfer = 이관 배지 + AI 인수인계 블록. */
export default function PrepCard({ vm }: { vm: CallFlowVM }) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickDeep, setPickDeep] = useState(false); // 다른 부서 선택 목록(한 단계 더)
  const [sentTo, setSentTo] = useState("");
  const resetT = useRef<number | null>(null);
  const sendTo = (name: string) => {
    setPickerOpen(false);
    setPickDeep(false);
    setSentTo(name);
    if (resetT.current) window.clearTimeout(resetT.current);
    resetT.current = window.setTimeout(() => vm.reset(), 2000);
  };
  return (
    <DesktopShell>
      {/* 뒤 배경 (인입 대기) — 상태는 모달 배지 줄이 말하므로 여기는 침묵 */}
      <div style={css("position:absolute;inset:0;display:flex;flex-direction:column")}>
        <div style={css("flex:1;display:flex;gap:16px;padding:16px")}>
          <div style={css("width:312px;flex:none;background:var(--onair-surface);border-radius:12px;box-shadow:var(--sh-near)")} />
          <div style={css("flex:1;background:var(--onair-surface);border-radius:12px;box-shadow:var(--sh-far);display:flex;align-items:center;justify-content:center;font:400 14px 'Geist Sans','Pretendard',sans-serif;color:var(--gray-600)")}>
            고객을 선택하면 준비 카드가 열립니다
          </div>
          <div style={css("width:372px;flex:none;background:var(--onair-surface);border-radius:12px;box-shadow:var(--sh-near)")} />
        </div>
      </div>

      {/* dim — 광원이 모달에 있으므로 뒤는 웜 블랙으로 가라앉는다 */}
      <div style={css("position:absolute;inset:0;background:rgba(22,20,17,.5);animation:fadeIn .18s ease-out")} />

      {/* 모달 */}
      <div data-tour="prep-card" style={css("position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);width:800px;max-height:840px;background:var(--onair-surface);border-radius:12px;box-shadow:var(--sh-modal);overflow:hidden;display:flex;flex-direction:column;animation:modalIn .18s cubic-bezier(0.2,0.8,0.2,1)")}>
        <div style={css("padding:22px 28px 20px;border-bottom:1px solid var(--gray-200)")}>
          {/* 배지 = 콜 유형 신호. 떴다는 것 자체가 의미이므로 긴급·이관일 때만 표시(일반=배지 없음) */}
          {vm.isUrgent ? (
            <span style={css("display:inline-flex;align-items:center;gap:6px;font:700 11px 'Geist Sans','Pretendard',sans-serif;color:#fff;background:var(--red-800);border-radius:9999px;padding:4px 11px;margin-bottom:13px")}>
              <span className="mi" style={css("font-size:13px")}>priority_high</span>
              긴급 · 사고 징후 감지
            </span>
          ) : vm.isTransfer ? (
            <span style={css("display:inline-flex;align-items:center;gap:6px;font:700 11px 'Geist Sans','Pretendard',sans-serif;color:var(--blue-900);background:var(--gray-100);border-radius:9999px;padding:4px 11px;margin-bottom:13px")}>
              <span className="mi" style={css("font-size:13px")}>sync_alt</span>
              {vm.handover.fromDept} → {AGENT.dept}
            </span>
          ) : null}
          {/* AI 사전 녹음 요약 = 이 카드의 히어로. 라벨을 붙여 '제목'이 아니라 '요약'으로 읽히게 한다 */}
          <div style={css("display:flex;gap:13px;align-items:flex-start")}>
            <span style={css("width:4px;border-radius:2px;background:var(--blue-500);flex:none;align-self:stretch")} />
            <div style={css("flex:1;min-width:0")}>
              <div style={css("display:flex;align-items:center;gap:5px;font:700 11px 'Geist Sans','Pretendard',sans-serif;color:var(--gray-700);margin-bottom:7px")}>
                <span className="mi" style={css("font-size:15px;color:var(--blue-700)")}>graphic_eq</span>AI 사전 녹음 요약
              </div>
              <div style={css("font:600 23px/1.35 'Geist Sans','Pretendard',sans-serif;letter-spacing:-.3px;color:var(--gray-1000)")}>
                {vm.prepHeadline}
              </div>
              <div style={css("font:400 12.5px/1.55 'Geist Sans','Pretendard',sans-serif;color:var(--gray-600);margin-top:7px")}>
                근거 발화 · <span style={css("font-style:italic;color:var(--gray-800)")}>“{vm.transcriptQuote}”</span>
              </div>
            </div>
            {/* 라우팅 배지 — AI가 배정한 담당 부서(우측 상단) */}
            <div style={css("flex:none;align-self:flex-start;display:flex;flex-direction:column;align-items:flex-end;gap:4px")}>
              <span style={css("display:inline-flex;align-items:center;gap:5px;padding:6px 12px;border-radius:9999px;background:rgba(37,99,235,.1);border:1px solid rgba(37,99,235,.28);font:700 12px 'Geist Sans','Pretendard',sans-serif;color:var(--blue-900);white-space:nowrap")}>
                <span className="mi" style={css("font-size:15px;color:var(--blue-700)")}>alt_route</span>
                {vm.prepRoutingTitle} 라우팅
              </span>
              <span style={css("font:600 10px 'Geist Mono','Geist Sans',monospace;color:var(--blue-900);opacity:.7")}>{vm.prepConfidence}</span>
            </div>
          </div>
        </div>

        <div style={css("flex:1;overflow:auto;padding:18px 24px;display:flex;flex-direction:column;gap:16px")}>
          {/* 인수인계 블록 — 이관 수신 시에만. 메모는 사람이 아니라 AI가 전임 통화를 요약해 작성 */}
          {vm.isTransfer && (
            <div style={css("background:var(--gray-100);border-radius:8px;padding:14px 16px")}>
              <div style={css("display:flex;align-items:center;gap:6px;margin-bottom:10px")}>
                <span className="mi" style={css("font-size:16px;color:var(--blue-700)")}>sync_alt</span>
                <span style={css("font:700 12.5px 'Geist Sans','Pretendard',sans-serif;color:var(--gray-1000)")}>
                  인수인계 — {vm.handover.from} {vm.handover.fromLevel}·{vm.handover.fromTenure}
                </span>
                <span style={css("font:400 11px 'Geist Sans','Pretendard',sans-serif;color:var(--gray-600)")}>
                  통화 {vm.handover.talkTime}{vm.handover.verified ? " · 본인확인 완료" : ""} · AI 자동 작성
                </span>
              </div>
              <div style={css("display:flex;flex-direction:column;gap:7px;margin-bottom:10px")}>
                {vm.handover.aiMemo.map((m, i) => (
                  <div key={i} style={css("display:flex;gap:10px")}>
                    <span style={css("width:3px;border-radius:2px;background:var(--blue-500);flex:none")} />
                    <span style={css("font:400 12.5px/1.5 'Geist Sans','Pretendard',sans-serif;color:var(--gray-900)")}>{m}</span>
                  </div>
                ))}
              </div>
              <div style={css("display:flex;align-items:center;gap:6px;font:600 11.5px 'Geist Sans','Pretendard',sans-serif;color:var(--blue-900)")}>
                <span className="mi" style={css("font-size:14px")}>flag</span>
                남은 액션 · {vm.handover.remaining}
              </div>
            </div>
          )}

          {/* 신호 밴드 — 요약 바로 다음. 감정온도·사고징후를 나란히, 값은 크게(색줄 없이 값 색으로만) */}
          <div style={css("display:flex;gap:12px")}>
            <div style={css("flex:1;background:var(--gray-100);border-radius:8px;padding:13px 15px")}>
              <div style={css("font:600 11px 'Geist Sans','Pretendard',sans-serif;color:var(--gray-700);margin-bottom:7px")}>고객 감정온도</div>
              <div style={css("display:flex;align-items:center;gap:8px")}>
                <span className="lampdots">
                  <i className={"g" + (vm.prepEmotionBars === 1 ? " lit" : "")} />
                  <i className={"a" + (vm.prepEmotionBars === 2 ? " lit" : "")} />
                  <i className={"r" + (vm.prepEmotionBars >= 3 ? " lit" : "")} />
                </span>
                <span style={css("font:700 18px 'Geist Sans','Pretendard',sans-serif;letter-spacing:-.2px;color:" + vm.prepEmotionFg)}>{vm.prepEmotionLabel}</span>
                <span
                  title={vm.prepEmotionSourceBadge.isReal ? "실제 AI 감정 모델이 판정한 값입니다" : "실제 모델 미연동 — 데모용 값입니다"}
                  style={css(
                    "font:600 9.5px 'Geist Mono',monospace;letter-spacing:.2px;padding:2px 6px;border-radius:5px;" +
                      (vm.prepEmotionSourceBadge.isReal
                        ? "background:var(--blue-50,#eef4ff);color:var(--blue-900,#1a3a6b)"
                        : "background:var(--gray-200);color:var(--gray-600)")
                  )}
                >
                  {vm.prepEmotionSourceBadge.label}
                </span>
              </div>
              <div style={css("font:400 11.5px/1.45 'Geist Sans','Pretendard',sans-serif;color:" + vm.prepEmotionFg + ";margin-top:4px")}>{vm.prepEmotionSignal}</div>
            </div>
            <div style={css("flex:1;background:var(--gray-100);border-radius:8px;padding:13px 15px")}>
              <div style={css("display:flex;align-items:center;gap:5px;font:600 11px 'Geist Sans','Pretendard',sans-serif;color:var(--gray-700);margin-bottom:7px")}>
                <span className="mi" style={css("font-size:14px;color:" + vm.prepRiskFg)}>gpp_maybe</span>사고 징후
              </div>
              <div style={css("font:700 18px 'Geist Sans','Pretendard',sans-serif;letter-spacing:-.2px;color:" + vm.prepRiskFg)}>{vm.prepRiskLabel}</div>
              <div style={css("font:400 11.5px/1.45 'Geist Sans','Pretendard',sans-serif;color:" + vm.prepRiskFg + ";margin-top:4px")}>{vm.prepRiskSignal}</div>
            </div>
          </div>

          {/* 해야 할 일 — 요약을 실행 항목으로 분해(프로즈는 헤드라인과 중복이라 제거) + AI 배정 */}
          <div style={css("background:var(--gray-100);border-radius:8px;padding:14px 16px")}>
            <div style={css("display:flex;align-items:center;gap:5px;font:600 11px 'Geist Sans','Pretendard',sans-serif;color:var(--gray-600);margin-bottom:9px")}>
              <span className="mi" style={css("font-size:14px;color:var(--gray-500)")}>checklist</span>해야 할 일
            </div>
            <div style={css("display:flex;flex-direction:column;gap:6px")}>
              {vm.summaryPoints.map((p, i) => (
                <div key={i} style={css("display:flex;gap:9px;align-items:baseline")}>
                  <span style={css("font:700 11px 'Geist Mono',monospace;color:var(--blue-900);flex:none")}>{i + 1}</span>
                  <span style={css("font:400 13px/1.5 'Geist Sans','Pretendard',sans-serif;color:var(--gray-900)")}>{p}</span>
                </div>
              ))}
            </div>
            <div style={css("margin-top:11px;padding-top:10px;border-top:1px solid var(--gray-200);display:flex;align-items:baseline;gap:7px;flex-wrap:wrap")}>
              <span style={css("font:700 11px 'Geist Sans','Pretendard',sans-serif;color:var(--gray-700)")}>AI 배정</span>
              <span style={css("font:600 13px 'Geist Sans','Pretendard',sans-serif;color:var(--gray-1000)")}>{vm.prepRoutingTitle}</span>
              <span style={css("font:600 10.5px 'Geist Mono','Geist Sans',monospace;color:var(--blue-900)")}>{vm.prepConfidence}</span>
            </div>
          </div>

          {/* 유의사항 — 순차 확인: 한 번에 하나만, 클릭할 때마다 게이지가 찬다.
              4/4가 되면 이 자리가 첫 응대 문장으로 바뀌며 통화 연결이 열린다 */}
          <div data-tour="prep-checks">
            <div style={css("display:flex;align-items:center;gap:8px;margin-bottom:8px")}>
              <span style={css("font:700 13px 'Geist Sans','Pretendard',sans-serif;color:var(--gray-1000)")}>이번 상담 유의사항</span>
              <span style={css("font:400 11px 'Geist Sans','Pretendard',sans-serif;color:var(--gray-600)")}>클릭해 하나씩 확인 · 모두 확인하면 연결 가능</span>
              <span style={css("margin-left:auto;font:600 11px 'Geist Mono','IBM Plex Mono',monospace;color:var(--gray-700)")}>{vm.prepDone}/{vm.prepTotal}</span>
            </div>
            {/* 진행 바 — 가로 전체로 길게. 왼쪽 텍스트 흐름과 같은 폭이라 눈에 바로 들어온다 */}
            <div style={css("display:flex;gap:4px;margin-bottom:10px")}>
              {vm.prepRows.map((r, i) => (
                <span key={i} style={css("flex:1;height:5px;border-radius:2px;transition:background .3s;background:" + (r.on ? "var(--green-700)" : "var(--gray-200)"))} />
              ))}
            </div>
            {/* 높이 고정 — 확인 완료 시 첫 응대 문장으로 바뀌어도 카드 크기가 변하지 않는다 */}
            <div style={css("min-height:78px;display:flex;flex-direction:column;justify-content:center")}>
            {vm.prepDone < vm.prepTotal ? (
              /* 현재 항목만 고정 위치에 — 확인 버튼이 늘 같은 자리라 리듬이 안 깨진다.
                 이전 항목은 ← 뒤로 가기로 다시 본다 */
              <div style={css("display:flex;gap:6px;align-items:stretch")}>
                <span
                  onClick={vm.prepDone > 0 ? vm.prepRows[vm.prepDone - 1].toggle : undefined}
                  title={vm.prepDone > 0 ? "이전 항목 다시 확인" : ""}
                  style={css(
                    "width:36px;flex:none;display:flex;align-items:center;justify-content:center;border-radius:8px;transition:background .2s,color .2s,opacity .2s;" +
                      (vm.prepDone > 0
                        ? "background:var(--gray-100);color:var(--gray-700);cursor:pointer"
                        : "background:var(--gray-100);color:var(--gray-400);opacity:.45;cursor:default")
                  )}
                >
                  <span className="mi" style={css("font-size:19px")}>arrow_back</span>
                </span>
                {(() => {
                  const cur = vm.prepRows[vm.prepDone];
                  return (
                    <div
                      onClick={cur.toggle}
                      style={css(
                        "flex:1;min-height:64px;display:flex;gap:12px;align-items:center;background:var(--background-200);border-radius:8px;padding:13px 15px;cursor:pointer;user-select:none"
                      )}
                    >
                      <span style={css("width:22px;height:22px;flex:none;border-radius:9999px;border:1.5px solid var(--gray-500);background:var(--onair-surface);box-sizing:border-box")} />
                      <div style={css("flex:1")}>
                        <div style={css("font-weight:700;font-size:14px;color:var(--gray-1000)")}>{cur.title}</div>
                        <div style={css("font:400 12px/1.5 'Geist Sans','Pretendard',sans-serif;color:var(--gray-700)")}>{cur.sub}</div>
                      </div>
                      <span style={css("display:flex;align-items:center;gap:4px;font:600 12px 'Geist Sans','Pretendard',sans-serif;color:var(--blue-700);flex:none")}>
                        확인 <span className="mi" style={css("font-size:16px")}>check</span>
                      </span>
                    </div>
                  );
                })()}
              </div>
            ) : (
              /* 4/4 완료 — 유의사항 자리가 첫 응대 문장이 된다. ← 로 유의사항을 다시 확인할 수 있다 */
              <div style={css("display:flex;gap:6px;align-items:stretch")}>
                <span
                  onClick={vm.prepRows[vm.prepDone - 1].toggle}
                  title="이전 항목 다시 확인"
                  style={css("width:36px;flex:none;display:flex;align-items:center;justify-content:center;border-radius:8px;transition:background .2s;background:var(--gray-100);color:var(--gray-700);cursor:pointer")}
                >
                  <span className="mi" style={css("font-size:19px")}>arrow_back</span>
                </span>
                <div data-tour="prep-firstline" style={css("flex:1;display:flex;align-items:baseline;gap:10px;background:var(--gray-100);border-radius:8px;padding:13px 16px")}>
                  <span style={css("display:inline-flex;align-items:center;justify-content:center;width:20px;height:20px;border-radius:9999px;background:var(--gray-1000);color:var(--onair-surface);font:700 10.5px 'Geist Sans','Pretendard',sans-serif;flex:none;transform:translateY(3px)")}>온</span>
                  <div>
                    <div style={css("font:700 11px 'Geist Sans','Pretendard',sans-serif;color:var(--gray-700);margin-bottom:3px")}>확인 완료 — 이 문장으로 통화를 여세요</div>
                    <div style={css("font:500 15px/1.55 Georgia,'Noto Serif KR','Apple SD Gothic Neo',serif;color:var(--gray-1000)")}>{vm.firstLine}</div>
                  </div>
                </div>
              </div>
            )}
            </div>
          </div>
        </div>

        <div style={css("flex:none;display:flex;align-items:center;gap:12px;padding:15px 24px;box-shadow:var(--sh-joint);background:var(--gray-100)")}>
          <span style={css("display:flex;align-items:center;gap:5px;font:400 12.5px 'Geist Sans','Pretendard',sans-serif;color:var(--gray-700)")}>
            <span className="mi" style={css("font-size:16px")}>info</span> {vm.prepHint}
          </span>
          <div style={css("flex:1")} />
          <span style={css("position:relative")}>
            <span
              onClick={() => setPickerOpen((v) => !v)}
              style={css("display:inline-flex;align-items:center;gap:6px;padding:10px 18px;border:1px solid var(--gray-500);border-radius:9999px;font-size:14px;color:var(--gray-900);cursor:pointer;background:var(--onair-surface)")}
            >
              <span className="mi" style={css("font-size:17px")}>alt_route</span> 다른 부서로 이관
            </span>
            {pickerOpen && (
              <div style={css("position:absolute;bottom:52px;right:0;width:300px;background:var(--onair-surface);border-radius:12px;box-shadow:var(--sh-modal);padding:12px;z-index:20;animation:dockUp .18s cubic-bezier(0.2,0.8,0.2,1)")}>
                <div style={css("font:700 11.5px 'Geist Sans','Pretendard',sans-serif;color:var(--gray-800);margin-bottom:3px")}>담당 부서로 이관</div>
                <div style={css("font:400 10.5px 'Geist Sans','Pretendard',sans-serif;color:var(--gray-600);margin-bottom:9px")}>개인이 아닌 부서 대기열로 넘겨 책임 소재를 분명히 합니다 · AI 인계 메모 자동 첨부</div>
                {/* 기본이 먼저 — AI 추천 부서로 한 번 클릭. 다른 부서는 한 단계 더 */}
                <span
                  onClick={() => sendTo(vm.suggestedDept)}
                  style={css("display:flex;align-items:center;gap:9px;padding:11px 12px;border-radius:8px;background:var(--blue-700);color:#fff;cursor:pointer;margin-bottom:6px")}
                >
                  <span className="mi" style={css("font-size:18px")}>auto_awesome</span>
                  <span style={css("flex:1")}>
                    <span style={css("display:block;font:700 12.5px 'Geist Sans','Pretendard',sans-serif")}>AI 추천 — {vm.suggestedDept}</span>
                    <span style={css("font:400 10.5px 'Geist Sans','Pretendard',sans-serif;opacity:.85")}>부서 대기열로 이관 · 수신 가능 상담사에게 자동 배정</span>
                  </span>
                </span>
                <span
                  onClick={() => setPickDeep((v) => !v)}
                  style={css("display:flex;align-items:center;gap:6px;padding:8px 11px;border-radius:8px;cursor:pointer;font:600 12px 'Geist Sans','Pretendard',sans-serif;color:var(--gray-800);background:" + (pickDeep ? "var(--gray-100)" : "transparent"))}
                >
                  다른 부서 선택
                  <span className="mi" style={css("font-size:16px;color:var(--gray-600);transition:transform .2s;transform:rotate(" + (pickDeep ? "180deg" : "0deg") + ")")}>expand_more</span>
                </span>
                {pickDeep && (
                  <div style={css("display:flex;flex-direction:column;gap:6px;margin-top:5px")}>
                    {vm.transferDepts.map((d) => (
                      <span
                        key={d.name}
                        onClick={() => sendTo(d.name)}
                        style={css("display:flex;align-items:center;gap:9px;padding:9px 11px;border-radius:8px;background:var(--gray-100);cursor:pointer")}
                      >
                        <span className="av" style={css("width:30px;height:30px;font-size:15px;background:var(--onair-surface)")}><span className="mi">groups</span></span>
                        <span style={css("flex:1")}>
                          <span style={css("display:block;font:700 12.5px 'Geist Sans','Pretendard',sans-serif;color:var(--gray-1000)")}>{d.name} <span style={css("font:600 10.5px;color:var(--gray-600)")}>{d.state}</span></span>
                          <span style={css("font:400 10.5px 'Geist Sans','Pretendard',sans-serif;color:var(--gray-600)")}>{d.desc}</span>
                        </span>
                        <span className="mi" style={css("font-size:16px;color:var(--gray-500)")}>chevron_right</span>
                      </span>
                    ))}
                  </div>
                )}
              </div>
            )}
          </span>
          <span
            data-tour="prep-connect"
            onClick={vm.answerCall}
            style={css(
              "padding:10px 26px;background:" +
                vm.connectBg +
                ";color:" +
                vm.connectFg +
                ";border-radius:9999px;font-weight:700;font-size:14px;display:flex;align-items:center;gap:6px;cursor:" +
                vm.connectCursor +
                ";transition:background .15s"
            )}
          >
            <span className="mi" style={css("font-size:18px")}>call</span> 통화 연결
          </span>
        </div>

        {/* 이관 완료 — 카드가 상대에게 넘어가고 화면은 대기로 복귀 */}
        {sentTo && (
          <div style={css("position:absolute;inset:0;background:rgba(248,249,249,.94);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;z-index:30")}>
            <span style={css("width:52px;height:52px;border-radius:9999px;background:var(--green-700);color:#fff;display:flex;align-items:center;justify-content:center")}>
              <span className="mi" style={css("font-size:28px")}>sync_alt</span>
            </span>
            <div style={css("font:700 16px 'Geist Sans','Pretendard',sans-serif;color:var(--gray-1000)")}>{sentTo}로 이관 완료</div>
            <div style={css("font:400 12.5px 'Geist Sans','Pretendard',sans-serif;color:var(--gray-700)")}>부서 대기열에 배정 · AI 인계 메모가 함께 전달되었습니다</div>
          </div>
        )}
      </div>
    </DesktopShell>
  );
}
