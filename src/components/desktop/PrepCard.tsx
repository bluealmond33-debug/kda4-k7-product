import { useRef, useState } from "react";
import { css } from "../../lib/css";
import type { CallFlowVM } from "../../hooks/useCallFlow";
import { AGENT } from "../../data/demoContent";
import DesktopShell from "./DesktopShell";

/** 1c — 상담 준비 카드 (dim 배경 + 모달). 유의사항 확인 시 통화 연결 활성화.
 *  인입 유형별 변주: urgent = 긴급 배지·빨간 램프·우선 배정 / transfer = 이관 배지 + AI 인수인계 블록. */
export default function PrepCard({ vm }: { vm: CallFlowVM }) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [sentTo, setSentTo] = useState("");
  const resetT = useRef<number | null>(null);
  const sendTo = (name: string) => {
    setPickerOpen(false);
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
      <div style={css("position:absolute;inset:0;background:rgba(22,20,17,.5)")} />

      {/* 모달 */}
      <div style={css("position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);width:800px;max-height:840px;background:var(--onair-surface);border-radius:12px;box-shadow:var(--sh-modal);overflow:hidden;display:flex;flex-direction:column")}>
        <div style={css("padding:22px 28px 20px;border-bottom:1px solid var(--gray-200)")}>
          <div style={css("display:flex;align-items:center;gap:8px;margin-bottom:14px")}>
            {vm.isUrgent ? (
              <span style={css("display:inline-flex;align-items:center;gap:6px;font:700 11px 'Geist Sans','Pretendard',sans-serif;color:#fff;background:var(--red-800);border-radius:9999px;padding:4px 11px")}>
                <span className="mi" style={css("font-size:13px")}>priority_high</span>
                긴급 · 사고 징후 감지
              </span>
            ) : vm.isTransfer ? (
              <span style={css("display:inline-flex;align-items:center;gap:6px;font:700 11px 'Geist Sans','Pretendard',sans-serif;color:var(--blue-900);background:var(--gray-100);border-radius:9999px;padding:4px 11px")}>
                <span className="mi" style={css("font-size:13px")}>sync_alt</span>
                이관됨 · {vm.handover.from}({vm.handover.fromLevel}) → {AGENT.name}
              </span>
            ) : (
              <span style={css("display:inline-flex;align-items:center;gap:6px;font:600 11px 'Geist Sans','Pretendard',sans-serif;color:var(--blue-900);background:var(--gray-100);border-radius:9999px;padding:4px 11px")}>
                <span style={css("width:6px;height:6px;border-radius:9999px;background:var(--blue-700)")} />
                인입 콜 · 우선 연결 대상
              </span>
            )}
            <span
              style={css(
                "font:600 11px 'Geist Sans','Pretendard',sans-serif;border-radius:9999px;padding:4px 10px;" +
                  (vm.isUrgent || vm.isTransfer
                    ? "color:var(--red-900);background:rgba(188,63,43,.10)"
                    : "color:var(--gray-700);background:var(--gray-100)")
              )}
            >
              {vm.isUrgent ? "우선 배정 · 대기열 1순위" : vm.isTransfer ? "이관 인계 · 우선 배정" : "순번 1 · 대기 05:30"}
            </span>
          </div>
          {/* 헤드라인 — 라벨 없이 한 줄이 곧 요약 */}
          <div style={css("display:flex;gap:13px")}>
            <span style={css("width:4px;border-radius:2px;background:var(--blue-500);flex:none")} />
            <div>
              <div style={css("font:600 23px/1.35 'Geist Sans','Pretendard',sans-serif;letter-spacing:-.3px;color:var(--gray-1000)")}>
                {vm.prepHeadline}
              </div>
              <div style={css("font:400 12.5px/1.55 'Geist Sans','Pretendard',sans-serif;color:var(--gray-600);margin-top:7px")}>
                근거 발화 · <span style={css("font-style:italic;color:var(--gray-800)")}>“{vm.transcriptQuote}”</span>
              </div>
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

          {/* 요약 2/3 + 신호 1/3 — 왼쪽은 읽는 영역, 오른쪽은 훑는 영역 */}
          <div style={css("display:flex;gap:12px")}>
            {/* 좌 2/3 — 요구사항 분해 + AI 배정(한 줄로 흡수) */}
            <div style={css("flex:2;background:var(--gray-100);border-radius:8px;padding:14px 16px;display:flex;flex-direction:column")}>
              <div style={css("display:flex;align-items:center;gap:5px;font:700 11px 'Geist Sans','Pretendard',sans-serif;color:var(--gray-700);margin-bottom:8px")}>
                <span className="mi" style={css("font-size:14px;color:var(--blue-700)")}>checklist</span>요구사항 분해
              </div>
              <div style={css("display:flex;flex-direction:column;gap:6px")}>
                {vm.summaryPoints.map((p, i) => (
                  <div key={i} style={css("display:flex;gap:9px;align-items:baseline")}>
                    <span style={css("font:700 11px 'Geist Mono',monospace;color:var(--blue-900);flex:none")}>{i + 1}</span>
                    <span style={css("font:400 14px/1.5 'Geist Sans','Pretendard',sans-serif;color:var(--gray-900)")}>{p}</span>
                  </div>
                ))}
              </div>
              <div style={css("margin-top:auto;padding-top:10px;border-top:1px solid var(--gray-200);display:flex;align-items:baseline;gap:7px;flex-wrap:wrap")}>
                <span style={css("font:700 11px 'Geist Sans','Pretendard',sans-serif;color:var(--gray-700)")}>AI 배정</span>
                <span style={css("font:600 13px 'Geist Sans','Pretendard',sans-serif;color:var(--gray-1000)")}>{vm.prepRoutingTitle}</span>
                <span style={css("font:600 10.5px 'Geist Mono','Geist Sans',monospace;color:var(--blue-900)")}>{vm.prepConfidence}</span>
              </div>
            </div>
            {/* 우 1/3 — 감정온도 + 사고징후 스택 */}
            <div style={css("flex:1;display:flex;flex-direction:column;gap:10px")}>
              <div style={css("flex:1;background:var(--gray-100);border-radius:8px;padding:12px 14px")}>
                <div style={css("font:600 11px 'Geist Sans','Pretendard',sans-serif;color:var(--gray-700);margin-bottom:6px")}>고객 감정온도</div>
                <div style={css("display:flex;align-items:center;gap:7px")}>
                  <span className="lampdots">
                    <i className={"g" + (vm.prepEmotionBars === 1 ? " lit" : "")} />
                    <i className={"a" + (vm.prepEmotionBars === 2 ? " lit" : "")} />
                    <i className={"r" + (vm.prepEmotionBars >= 3 ? " lit" : "")} />
                  </span>
                  <span style={css("font:600 14px 'Geist Sans','Pretendard',sans-serif;color:" + vm.prepEmotionFg)}>{vm.prepEmotionLabel}</span>
                </div>
                <div style={css("font:400 11px 'Geist Sans','Pretendard',sans-serif;color:" + vm.prepEmotionFg + ";margin-top:3px")}>{vm.prepEmotionSignal}</div>
              </div>
              <div style={css("flex:1;background:var(--gray-100);border-radius:8px;padding:12px 14px")}>
                <div style={css("display:flex;align-items:center;gap:5px;font:600 11px 'Geist Sans','Pretendard',sans-serif;color:var(--gray-700);margin-bottom:6px")}>
                  <span className="mi" style={css("font-size:14px;color:" + vm.prepRiskFg)}>gpp_maybe</span>사고 징후
                </div>
                <div style={css("font:600 14px 'Geist Sans','Pretendard',sans-serif;color:" + vm.prepRiskFg)}>{vm.prepRiskLabel}</div>
                <div style={css("font:400 11px 'Geist Sans','Pretendard',sans-serif;color:" + vm.prepRiskFg + ";margin-top:3px")}>{vm.prepRiskSignal}</div>
              </div>
            </div>
          </div>

          {/* 유의사항 — 순차 확인: 한 번에 하나만, 클릭할 때마다 게이지가 찬다.
              4/4가 되면 이 자리가 첫 응대 문장으로 바뀌며 통화 연결이 열린다 */}
          <div>
            <div style={css("display:flex;align-items:center;gap:8px;margin-bottom:9px")}>
              <span style={css("font:700 13px 'Geist Sans','Pretendard',sans-serif;color:var(--gray-1000)")}>이번 상담 유의사항</span>
              <span style={css("font:400 11px 'Geist Sans','Pretendard',sans-serif;color:var(--gray-600)")}>클릭해 하나씩 확인 · 모두 확인하면 연결 가능</span>
              <span style={css("margin-left:auto;display:flex;align-items:center;gap:6px")}>
                <span style={css("display:flex;gap:3px")}>
                  {vm.prepRows.map((r, i) => (
                    <span key={i} style={css("width:22px;height:5px;border-radius:2px;transition:background .25s;background:" + (r.on ? "var(--green-700)" : "var(--gray-200)"))} />
                  ))}
                </span>
                <span style={css("font:600 11px 'Geist Mono','IBM Plex Mono',monospace;color:var(--gray-700)")}>{vm.prepDone}/{vm.prepTotal}</span>
              </span>
            </div>
            {vm.prepDone < vm.prepTotal ? (
              (() => {
                const cur = vm.prepRows[vm.prepDone];
                return (
                  <div
                    onClick={cur.toggle}
                    style={css(
                      "display:flex;gap:12px;align-items:center;background:var(--background-200);border-radius:8px;padding:13px 15px;cursor:pointer;user-select:none"
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
              })()
            ) : (
              /* 4/4 완료 — 유의사항 자리가 첫 응대 문장이 된다 */
              <div style={css("display:flex;align-items:baseline;gap:10px;background:var(--gray-100);border-radius:8px;padding:13px 16px")}>
                <span style={css("display:inline-flex;align-items:center;justify-content:center;width:20px;height:20px;border-radius:9999px;background:var(--gray-1000);color:var(--onair-surface);font:700 10.5px 'Geist Sans','Pretendard',sans-serif;flex:none;transform:translateY(3px)")}>온</span>
                <div>
                  <div style={css("font:700 11px 'Geist Sans','Pretendard',sans-serif;color:var(--gray-700);margin-bottom:3px")}>확인 완료 — 이 문장으로 통화를 여세요</div>
                  <div style={css("font:500 15px/1.55 Georgia,'Noto Serif KR','Apple SD Gothic Neo',serif;color:var(--gray-1000)")}>{vm.firstLine}</div>
                </div>
              </div>
            )}
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
              <span className="mi" style={css("font-size:17px")}>phone_forwarded</span> 다른 상담사에게 이관
            </span>
            {pickerOpen && (
              <div style={css("position:absolute;bottom:52px;right:0;width:290px;background:var(--onair-surface);border-radius:12px;box-shadow:var(--sh-modal);padding:12px;z-index:20;animation:dockUp .18s ease")}>
                <div style={css("font:700 11.5px 'Geist Sans','Pretendard',sans-serif;color:var(--gray-800);margin-bottom:3px")}>부서 내 시니어 상담사에게 이관</div>
                <div style={css("font:400 10.5px 'Geist Sans','Pretendard',sans-serif;color:var(--gray-600);margin-bottom:9px")}>AI 인계 메모가 자동 작성되어 함께 전달됩니다</div>
                <div style={css("display:flex;flex-direction:column;gap:6px")}>
                  {vm.transferTargets.map((t) => (
                    <span
                      key={t.name}
                      onClick={() => sendTo(t.name)}
                      style={css("display:flex;align-items:center;gap:9px;padding:9px 11px;border-radius:8px;background:var(--gray-100);cursor:pointer")}
                    >
                      <span className="av" style={css("width:30px;height:30px;font-size:15px;background:var(--onair-surface)")}><span className="mi">headset_mic</span></span>
                      <span style={css("flex:1")}>
                        <span style={css("display:block;font:700 12.5px 'Geist Sans','Pretendard',sans-serif;color:var(--gray-1000)")}>{t.name} <span style={css("font:600 10.5px;color:var(--green-900)")}>{t.level} {t.tenure}</span></span>
                        <span style={css("font:400 10.5px 'Geist Sans','Pretendard',sans-serif;color:var(--gray-600)")}>{t.state}</span>
                      </span>
                      <span className="mi" style={css("font-size:16px;color:var(--gray-500)")}>chevron_right</span>
                    </span>
                  ))}
                </div>
              </div>
            )}
          </span>
          <span
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
            <div style={css("font:700 16px 'Geist Sans','Pretendard',sans-serif;color:var(--gray-1000)")}>{sentTo} 상담사에게 이관 완료</div>
            <div style={css("font:400 12.5px 'Geist Sans','Pretendard',sans-serif;color:var(--gray-700)")}>AI 인계 메모가 자동 작성되어 함께 전달되었습니다</div>
          </div>
        )}
      </div>
    </DesktopShell>
  );
}
