import { css } from "../../lib/css";
import type { CallFlowVM } from "../../hooks/useCallFlow";
import { AGENT } from "../../data/demoContent";
import DesktopShell from "./DesktopShell";

/** 1c — 상담 준비 카드 (dim 배경 + 모달). 유의사항 확인 시 통화 연결 활성화.
 *  인입 유형별 변주: urgent = 긴급 배지·빨간 램프·우선 배정 / transfer = 이관 배지 + AI 인수인계 블록.
 *  부서 이관 조작은 관리자 콘솔(?role=admin)로 이전 — 여기는 상담사 준비 신호만 남는다. */
export default function PrepCard({ vm }: { vm: CallFlowVM }) {
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
      <div style={css("position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);width:800px;max-height:840px;background:var(--onair-surface);border-radius:12px;box-shadow:var(--sh-modal);overflow:hidden;display:flex;flex-direction:column;animation:modalIn .18s cubic-bezier(0.2,0.8,0.2,1)")}>
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
          <div style={css("display:flex;gap:13px")}>
            <span style={css("width:4px;border-radius:2px;background:var(--blue-500);flex:none")} />
            <div>
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

          {/* 좌: 감정온도·사고징후 세로 스택 / 우: 해야 할 일(상담 중 가장 중요한 실행 항목) */}
          <div style={css("display:flex;gap:12px;align-items:flex-start")}>
            <div style={css("flex:none;width:238px;display:flex;flex-direction:column;gap:12px")}>
            <div style={css("background:var(--gray-100);border-radius:8px;padding:13px 15px")}>
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
            <div style={css("background:var(--gray-100);border-radius:8px;padding:13px 15px")}>
              <div style={css("display:flex;align-items:center;gap:5px;font:600 11px 'Geist Sans','Pretendard',sans-serif;color:var(--gray-700);margin-bottom:7px")}>
                <span className="mi" style={css("font-size:14px;color:" + vm.prepRiskFg)}>gpp_maybe</span>사고 징후
              </div>
              <div style={css("font:700 18px 'Geist Sans','Pretendard',sans-serif;letter-spacing:-.2px;color:" + vm.prepRiskFg)}>{vm.prepRiskLabel}</div>
              <div style={css("font:400 11.5px/1.45 'Geist Sans','Pretendard',sans-serif;color:" + vm.prepRiskFg + ";margin-top:4px")}>{vm.prepRiskSignal}</div>
            </div>
            </div>

            {/* 우: 해야 할 일 — 상담 중 가장 중요한 실행 항목 + AI 배정 */}
            <div style={css("flex:1;min-width:0;align-self:stretch;background:var(--gray-100);border-radius:8px;padding:14px 16px")}>
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
          </div>

          {/* 유의사항 — 순차 확인: 한 번에 하나만, 클릭할 때마다 게이지가 찬다.
              4/4가 되면 이 자리가 첫 응대 문장으로 바뀌며 통화 연결이 열린다 */}
          <div>
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
                <div style={css("flex:1;display:flex;align-items:baseline;gap:10px;background:var(--gray-100);border-radius:8px;padding:13px 16px")}>
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
          {/* 이관 조작 자리 → 안내 노트. 상담사는 응대 준비에 집중, 배정·이관은 관리자 콘솔이 맡는다 */}
          <span style={css("display:flex;align-items:center;gap:5px;font:500 11.5px 'Geist Sans','Pretendard',sans-serif;color:var(--gray-600)")}>
            <span className="mi" style={css("font-size:14px")}>sync_alt</span> 부서 이관은 관제 대시보드에서 실시간 처리됩니다
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

      </div>
    </DesktopShell>
  );
}
