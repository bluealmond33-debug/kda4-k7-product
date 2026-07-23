import { useState } from "react";
import { css } from "../../lib/css";
import type { CallFlowVM } from "../../hooks/useCallFlow";
import { AGENT } from "../../data/demoContent";
import DesktopShell from "./DesktopShell";

/** 1c — 상담 준비 카드 (dim 배경 + 모달). 유의사항 확인 시 통화 연결 활성화.
 *  인입 유형별 변주: urgent = 긴급 배지·빨간 램프·우선 배정 / transfer = 이관 배지 + AI 인수인계 블록.
 *  부서 이관 조작은 관리자 콘솔(?role=admin)로 이전 — 여기는 상담사 준비 신호만 남는다. */
export default function PrepCard({ vm }: { vm: CallFlowVM }) {
  const riskHigh = vm.prepRiskLabel === "높음"; // 위험일 때만 강한 색(빨강)
  const [scriptOpen, setScriptOpen] = useState(false); // 상담 스크립트 읽어보기 — 통화 화면과 같은 아코디언(기본 접힘)
  const [transferMenu, setTransferMenu] = useState(false); // 부서 이관 드롭다운

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

      {/* 모달 — 카드 + (카드 밖) 스크립트 영역을 세로로 묶어 중앙 정렬. 스크립트는 카드에 포함되지 않은 별도 패널 */}
      <div style={css("position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);display:flex;flex-direction:column;align-items:center;gap:10px;width:800px;max-width:94%;animation:modalIn .18s cubic-bezier(0.2,0.8,0.2,1)")}>
        <div data-tour="prep-card" style={css("width:100%;max-height:600px;background:var(--onair-surface);border-radius:12px;box-shadow:var(--sh-modal);overflow:hidden;display:flex;flex-direction:column")}>
        <div style={css("padding:13px 24px 13px;border-bottom:1px solid var(--gray-200)")}>
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
          {/* KARI-NA 브리핑 헤더 — 슬림 1행: 라벨·출처 | AI 확신도 | 라우팅 경로(부서 › 업무).
              한줄 요약·근거 발화는 전화 요약 상자 상단으로 옮겼다(헤더 비대 해소). */}
          <div style={css("display:flex;align-items:center;gap:9px")}>
            <span className="mi" style={css("font-size:16px;color:var(--blue-700)")}>graphic_eq</span>
            <span style={css("font:800 12px 'Geist Sans','Pretendard',sans-serif;letter-spacing:.2px;color:var(--gray-1000)")}>KARI-NA 브리핑</span>
            <span style={css("font:400 10.5px 'Geist Sans','Pretendard',sans-serif;color:var(--gray-600)")}>· {vm.summarySourceLabel}</span>
            <div style={css("flex:1")} />
            {vm.prepConfidencePct != null && (
              <span title={vm.prepConfidence} style={css("display:inline-flex;align-items:baseline;gap:5px;background:var(--gray-100);border-radius:9999px;padding:5px 12px;flex:none")}>
                <span style={css("font:600 10px 'Geist Sans','Pretendard',sans-serif;color:var(--gray-500)")}>AI 확신도</span>
                <span style={css("font:800 13.5px 'Geist Sans','Pretendard',sans-serif;letter-spacing:-.3px;color:var(--gray-1000)")}>{vm.prepConfidencePct}%</span>
              </span>
            )}
            <span style={css("display:inline-flex;align-items:center;gap:5px;padding:5px 12px;border-radius:9999px;background:var(--gray-100);font:600 12px 'Geist Sans','Pretendard',sans-serif;white-space:nowrap")}>
              <span className="mi" style={css("font-size:15px;color:var(--blue-700)")}>alt_route</span>
              <span style={css("font-weight:700;color:var(--blue-900)")}>{vm.prepRoutingTitle}</span>
              <span className="mi" style={css("font-size:15px;color:var(--gray-400)")}>chevron_right</span>
              <span style={css("color:var(--gray-700)")}>{vm.prepBusinessType}</span>
            </span>
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
          <div style={css("display:flex;gap:12px;align-items:stretch")}>
            <div style={css("flex:none;width:238px;display:flex;flex-direction:column;gap:12px")}>
            {/* 감정온도 — 흰 카드+보더, 큰 숫자 + 상태 + 0~100 가로 게이지(온도계 대체) */}
            <div style={css("flex:1;min-height:98px;background:var(--onair-surface);border:1px solid var(--gray-200);border-radius:10px;padding:12px 14px;display:flex;flex-direction:column;justify-content:center;gap:9px")}>
              <div style={css("display:flex;align-items:center;gap:6px")}>
                <span style={css("font:600 10.5px 'Geist Sans','Pretendard',sans-serif;letter-spacing:.2px;color:var(--gray-500)")}>고객 감정온도</span>
                <div style={css("flex:1")} />
                <span
                  title={vm.prepEmotionSourceBadge.isReal ? "실제 AI 감정 모델이 판정한 값입니다" : "실제 모델 미연동 — 데모용 값입니다"}
                  style={css("font:600 8.5px 'Geist Mono',monospace;letter-spacing:.3px;padding:2px 6px;border-radius:9999px;background:var(--gray-100);color:var(--gray-400)")}
                >{vm.prepEmotionSourceBadge.label}</span>
              </div>
              <div style={css("display:flex;align-items:baseline;gap:8px")}>
                <span style={css("font:800 30px/1 'Geist Sans','Pretendard',sans-serif;letter-spacing:-1.2px;color:" + vm.prepEmotionBar)}>{vm.prepEmotionScore != null ? vm.prepEmotionScore : "--"}°</span>
                <span style={css("font:700 13px 'Geist Sans','Pretendard',sans-serif;color:" + vm.prepEmotionBar)}>{vm.prepEmotionLabel}</span>
              </div>
              <div style={css("height:6px;border-radius:9999px;background:var(--gray-200);overflow:hidden")}>
                <div style={css("height:100%;border-radius:9999px;transition:width .4s;width:" + (vm.prepEmotionScore != null ? Math.max(3, Math.min(100, vm.prepEmotionScore)) : 0) + "%;background:" + vm.prepEmotionBar)} />
              </div>
            </div>
            {/* 사고 징후 — 흰 카드+보더(위험 시 붉게), 상태 점 + 큰 라벨 + 신호 한줄 */}
            <div style={css("flex:1;min-height:98px;border-radius:10px;padding:12px 14px;display:flex;flex-direction:column;justify-content:center;gap:8px;" + (riskHigh ? "background:var(--red-800)" : "background:var(--onair-surface);border:1px solid var(--gray-200)"))}>
              <div style={css("font:600 10.5px 'Geist Sans','Pretendard',sans-serif;letter-spacing:.2px;color:" + (riskHigh ? "rgba(255,255,255,.8)" : "var(--gray-500)"))}>사고 징후 · 위험도</div>
              <div style={css("display:flex;align-items:center;gap:9px")}>
                <span style={css("width:10px;height:10px;border-radius:9999px;flex:none;background:" + (riskHigh ? "#fff" : "var(--green-700)"))} />
                <span style={css("font:800 25px/1 'Geist Sans','Pretendard',sans-serif;letter-spacing:-.6px;color:" + (riskHigh ? "#fff" : "var(--gray-1000)"))}>{vm.prepRiskLabel}</span>
              </div>
              <div style={css("font:400 11px/1.4 'Geist Sans','Pretendard',sans-serif;color:" + (riskHigh ? "rgba(255,255,255,.85)" : "var(--gray-500)"))}>{vm.prepRiskSignal}</div>
            </div>
            </div>

            {/* 우: 전화 요약 — 상단에 한줄 요약 + 근거 발화(헤더에서 옮겨옴), 아래에 STT 요약 불릿 */}
            <div style={css("flex:1;min-width:0;align-self:stretch;background:var(--onair-surface);border:1.5px solid var(--blue-500);border-radius:8px;padding:13px 16px")}>
            <div style={css("font:600 14.5px/1.4 'Geist Sans','Pretendard',sans-serif;color:var(--gray-1000)")}>{vm.prepHeadline}</div>
            <div style={css("font:400 11.5px/1.45 'Geist Sans','Pretendard',sans-serif;color:var(--gray-600);margin-top:4px;padding-bottom:10px;margin-bottom:11px;border-bottom:1px solid var(--gray-200)")}>
              근거 발화 · <span style={css("font-style:italic;color:var(--gray-800)")}>“{vm.transcriptQuote}”</span>
            </div>
            <div style={css("display:flex;align-items:center;gap:5px;font:600 11px 'Geist Sans','Pretendard',sans-serif;color:var(--gray-600);margin-bottom:10px")}>
              <span className="mi" style={css("font-size:14px;color:var(--gray-500)")}>summarize</span>전화 요약 <span style={css("font:400 10.5px 'Geist Sans','Pretendard',sans-serif;color:var(--gray-500)")}>· 고객 발화 STT 요약</span>
            </div>
            <div style={css("display:flex;flex-direction:column;gap:8px")}>
              {vm.summaryPoints.map((p, i) => (
                <div key={i} style={css("display:flex;gap:9px;align-items:baseline")}>
                  <span style={css("flex:none;width:5px;height:5px;border-radius:9999px;background:var(--gray-500);transform:translateY(-2px)")} />
                  <span style={css("font:400 13px/1.55 'Geist Sans','Pretendard',sans-serif;color:var(--gray-900)")}>{p}</span>
                </div>
              ))}
            </div>
            </div>
          </div>

          {/* 이번 상담 유의사항 — 체크 없이 한눈에(멘토 피드백: 체크 피로 제거). 응대 전 참고 정보. */}
          <div data-tour="prep-checks">
            <div style={css("display:flex;align-items:center;gap:8px;margin-bottom:7px")}>
              <span style={css("font:700 13px 'Geist Sans','Pretendard',sans-serif;color:var(--gray-1000)")}>이번 상담 유의사항</span>
              <div style={css("flex:1")} />
              {/* 본인인증 상태 — 완료=차분(회색 테두리·초록 방패), 미완료=주의(앰버) */}
              <span style={css("display:inline-flex;align-items:center;gap:7px;background:var(--gray-100);border-radius:9999px;padding:5px 12px 5px 11px")}>
                <span style={css("width:7px;height:7px;border-radius:9999px;flex:none;background:" + (vm.prepVerified ? "var(--green-700)" : "var(--amber-700)"))} />
                <span style={css("font:700 11px 'Geist Sans','Pretendard',sans-serif;color:var(--gray-900)")}>본인인증 {vm.prepVerified ? "완료" : "미완료"}</span>
                <span style={css("font:400 10px 'Geist Sans','Pretendard',sans-serif;color:var(--gray-500)")}>· {vm.prepVerified ? "전임 상담사 확인" : "연결 직후 확인"}</span>
              </span>
            </div>
            <div style={css("display:flex;flex-direction:column;gap:6px;margin-bottom:9px")}>
              {vm.prepRows.map((r, i) => (
                <div key={i} style={css("display:flex;gap:9px;align-items:baseline")}>
                  <span className="mi" style={css("font-size:15px;color:var(--gray-500);flex:none;transform:translateY(3px)")}>check_circle</span>
                  <div style={css("flex:1")}>
                    <span style={css("font:700 12.5px 'Geist Sans','Pretendard',sans-serif;color:var(--gray-1000)")}>{r.title}</span>
                    <span style={css("font:400 11.5px/1.5 'Geist Sans','Pretendard',sans-serif;color:var(--gray-700);margin-left:6px")}>{r.sub}</span>
                  </div>
                </div>
              ))}
            </div>
            {/* 첫 응대 문장 — 준비의 결론. 잠금 없이 바로 보여준다 */}
            <div data-tour="prep-firstline" style={css("display:flex;align-items:center;gap:10px;background:var(--gray-100);border-radius:8px;padding:10px 14px")}>
              <span style={css("display:inline-flex;align-items:center;justify-content:center;width:20px;height:20px;border-radius:9999px;background:var(--gray-1000);color:#fff;flex:none")}><span className="mi" style={css("font-size:13px")}>record_voice_over</span></span>
              <div>
                <div style={css("font:700 10.5px 'Geist Sans','Pretendard',sans-serif;color:var(--gray-700);margin-bottom:2px")}>이 문장으로 통화를 여세요</div>
                <div style={css("font:500 13.5px/1.45 Georgia,'Noto Serif KR','Apple SD Gothic Neo',serif;color:var(--gray-1000)")}>{vm.firstLine}</div>
              </div>
            </div>
          </div>
        </div>

        <div style={css("flex:none;display:flex;align-items:center;gap:12px;padding:11px 24px;box-shadow:var(--sh-joint);background:var(--gray-100)")}>
          <span style={css("display:flex;align-items:center;gap:5px;font:400 12px 'Geist Sans','Pretendard',sans-serif;color:var(--gray-700)")}>
            <span className="mi" style={css("font-size:16px")}>info</span> {vm.prepHint}
          </span>
          <div style={css("flex:1")} />
          {/* 부서 이관 — 통화 연결 옆. 연결 전에 다른 부서로 예약할 수 있다(종료 시 인계). 드롭다운은 위로 열린다 */}
          <span style={css("position:relative;display:inline-flex")}>
            <span
              onClick={() => setTransferMenu((v) => !v)}
              title="다른 부서로 이관 — 종료 시 예약"
              style={css("display:flex;align-items:center;gap:5px;font:600 13px 'Geist Sans','Pretendard',sans-serif;border-radius:9999px;padding:10px 18px;cursor:pointer;white-space:nowrap;" + (vm.transferReserved ? "background:var(--blue-700);color:#fff" : "background:var(--onair-surface);color:var(--blue-700);border:1px solid var(--blue-400)"))}
            >
              <span className="mi" style={css("font-size:18px")}>sync_alt</span>
              {vm.transferReserved ? (vm.transferTarget ?? vm.suggestedDept) + " 예약됨" : "부서 이관"}
              <span className="mi" style={css("font-size:16px;transition:transform .2s;transform:rotate(" + (transferMenu ? 180 : 0) + "deg)")}>expand_more</span>
            </span>
            {transferMenu && (
              <>
                <span onClick={() => setTransferMenu(false)} style={css("position:fixed;inset:0;z-index:40")} />
                <div style={css("position:absolute;left:0;bottom:calc(100% + 8px);z-index:41;width:256px;background:var(--onair-surface);border-radius:10px;box-shadow:var(--sh-modal);overflow:hidden")}>
                  <div style={css("padding:9px 13px 7px;font:700 10.5px 'Geist Sans','Pretendard',sans-serif;color:var(--gray-600);border-bottom:1px solid var(--gray-200)")}>이관 부서 선택 · 종료 시 예약</div>
                  {vm.transferReserved && (
                    <div onClick={() => { vm.toggleTransferReserve(); setTransferMenu(false); }} className="memorow" style={css("display:flex;align-items:center;gap:6px;padding:9px 13px;cursor:pointer;border-bottom:1px solid var(--gray-100);color:var(--red-800)")}>
                      <span className="mi" style={css("font-size:15px")}>close</span>
                      <span style={css("font:600 12px 'Geist Sans','Pretendard',sans-serif")}>이관 예약 취소</span>
                    </div>
                  )}
                  <div onClick={() => { vm.reserveTransfer(); setTransferMenu(false); }} className="memorow" style={css("display:flex;align-items:center;gap:6px;padding:9px 13px;cursor:pointer;border-bottom:1px solid var(--gray-100)")}>
                    <span className="mi" style={css("font-size:15px;color:var(--blue-700)")}>auto_awesome</span>
                    <span style={css("font:600 12px 'Geist Sans','Pretendard',sans-serif;color:var(--gray-1000)")}>AI 추천 — {vm.suggestedDept}</span>
                  </div>
                  {vm.transferDepts.map((d) => (
                    <div key={d.name} onClick={() => { vm.reserveTransfer(d.name); setTransferMenu(false); }} className="memorow" style={css("display:flex;flex-direction:column;gap:1px;padding:8px 13px;cursor:pointer")}>
                      <span style={css("display:flex;align-items:center;gap:6px;font:600 12px 'Geist Sans','Pretendard',sans-serif;color:var(--gray-1000)")}>{d.name}<span style={css("font:400 10px 'Geist Sans','Pretendard',sans-serif;color:var(--gray-500)")}>{d.state}</span></span>
                      <span style={css("font:400 10.5px 'Geist Sans','Pretendard',sans-serif;color:var(--gray-600)")}>{d.desc}</span>
                    </div>
                  ))}
                </div>
              </>
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

        </div>

        {/* 상담 스크립트 읽어보기 — 카드 밖 별도 패널. 통화 연결 아래에서 눌러 펼친다(통화 화면과 같은 아코디언) */}
        <div style={css("width:100%;background:var(--onair-surface);border-radius:12px;box-shadow:var(--sh-near);overflow:hidden")}>
          <div
            onClick={() => setScriptOpen((v) => !v)}
            style={css("display:flex;align-items:center;justify-content:space-between;padding:13px 20px;cursor:pointer;user-select:none")}
          >
            <span style={css("display:flex;align-items:center;gap:7px;font:700 13.5px 'Geist Sans','Pretendard',sans-serif;color:var(--gray-1000)")}>
              <span className="mi" style={css("font-size:18px;color:var(--gray-600)")}>menu_book</span> 상담 스크립트 읽어보기
              <span style={css("font:400 11.5px 'Geist Sans','Pretendard',sans-serif;color:var(--gray-500)")}>· {vm.steps.length}단계 · 통화 연결하면 상담 화면에서도 표시됩니다</span>
            </span>
            <span style={css("display:flex;align-items:center;gap:4px;font:600 12px 'Geist Sans','Pretendard',sans-serif;color:var(--blue-700)")}>
              {scriptOpen ? "접기" : "펼쳐 보기"}
              <span className="mi" style={css("font-size:19px;transition:transform .25s;transform:rotate(" + (scriptOpen ? 180 : 0) + "deg)")}>expand_more</span>
            </span>
          </div>
          {scriptOpen && (
            <div style={css("padding:2px 20px 18px;display:flex;flex-direction:column;gap:9px;max-height:260px;overflow:auto")}>
              {vm.steps.map((st, i) => (
                <div key={i} style={css("background:var(--gray-100);border-radius:8px;padding:11px 14px")}>
                  <div style={css("font:600 14px 'Geist Sans','Pretendard',sans-serif;color:var(--gray-1000);margin-bottom:4px")}>{st.title}</div>
                  <div style={css("font:400 13.5px/1.6 'Geist Sans','Pretendard',sans-serif;color:var(--gray-900)")}>{st.text}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </DesktopShell>
  );
}


