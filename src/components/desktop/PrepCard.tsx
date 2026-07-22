import { css } from "../../lib/css";
import type { CallFlowVM } from "../../hooks/useCallFlow";
import { AGENT } from "../../data/demoContent";
import DesktopShell from "./DesktopShell";

/** 1c — 상담 준비 카드 (dim 배경 + 모달). 유의사항 확인 시 통화 연결 활성화.
 *  인입 유형별 변주: urgent = 긴급 배지·빨간 램프·우선 배정 / transfer = 이관 배지 + AI 인수인계 블록.
 *  부서 이관 조작은 관리자 콘솔(?role=admin)로 이전 — 여기는 상담사 준비 신호만 남는다. */
export default function PrepCard({ vm }: { vm: CallFlowVM }) {
  const riskHigh = vm.prepRiskLabel === "높음"; // 위험일 때만 강한 색(빨강)

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
            <div style={css("flex:1;min-width:0")}>
              <div style={css("display:flex;align-items:center;gap:6px;margin-bottom:7px")}>
                <span className="mi" style={css("font-size:16px;color:var(--blue-700)")}>graphic_eq</span>
                <span style={css("font:800 12px 'Geist Sans','Pretendard',sans-serif;letter-spacing:.2px;color:var(--gray-1000)")}>KARI-NA 브리핑</span>
                <span style={css("font:400 11px 'Geist Sans','Pretendard',sans-serif;color:var(--gray-600)")}>· 전화 받기 전 미리 듣고 정리했어요</span>
                <div style={css("flex:1")} />
                {vm.prepConfidencePct != null && (
                  <span style={css("display:inline-flex;align-items:baseline;gap:4px;background:var(--gray-100);border-radius:9999px;padding:4px 12px;flex:none")}>
                    <span style={css("font:600 10px 'Geist Sans','Pretendard',sans-serif;color:var(--gray-600)")}>AI 배정 확신</span>
                    <span style={css("font:800 13px 'Geist Sans','Pretendard',sans-serif;letter-spacing:-.2px;color:var(--gray-1000)")}>{vm.prepConfidencePct}%</span>
                  </span>
                )}
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
            <div style={css("background:var(--gray-100);border-radius:8px;padding:14px 15px")}>
              <div style={css("display:flex;align-items:center;gap:6px;font:600 11px 'Geist Sans','Pretendard',sans-serif;color:var(--gray-700);margin-bottom:8px")}>
                고객 감정온도
                <span
                  title={vm.prepEmotionSourceBadge.isReal ? "실제 AI 감정 모델이 판정한 값입니다" : "실제 모델 미연동 — 데모용 값입니다"}
                  style={css("font:600 9px 'Geist Mono',monospace;padding:2px 6px;border-radius:5px;background:var(--gray-200);color:var(--gray-600)")}
                >{vm.prepEmotionSourceBadge.label}</span>
              </div>
              <div style={css("display:flex;align-items:center;gap:12px")}>
                <Thermometer score={vm.prepEmotionScore} color={vm.prepEmotionBar} />
                <div style={css("display:flex;align-items:baseline;gap:8px")}>
                  <span style={css("font:800 42px 'Geist Sans','Pretendard',sans-serif;letter-spacing:-1.5px;color:" + vm.prepEmotionBar)}>{vm.prepEmotionScore != null ? vm.prepEmotionScore : "--"}°</span>
                  <span style={css("font:800 18px 'Geist Sans','Pretendard',sans-serif;color:" + vm.prepEmotionBar)}>{vm.prepEmotionLabel}</span>
                </div>
              </div>
            </div>
            <div style={css("border-radius:8px;padding:14px 15px;background:" + (riskHigh ? "var(--red-800)" : "var(--gray-100)"))}>
              <div style={css("font:600 11px 'Geist Sans','Pretendard',sans-serif;margin-bottom:7px;color:" + (riskHigh ? "rgba(255,255,255,.85)" : "var(--gray-700)"))}>
                사고 징후 <span style={css("font-weight:400;opacity:.7")}>(위험도)</span>
              </div>
              <div style={css("display:flex;align-items:center;gap:9px")}>
                <span style={css("width:12px;height:12px;border-radius:9999px;flex:none;background:" + (riskHigh ? "#fff" : "var(--green-700)"))} />
                <span style={css("font:800 30px 'Geist Sans','Pretendard',sans-serif;letter-spacing:-1px;color:" + (riskHigh ? "#fff" : "var(--gray-1000)"))}>{vm.prepRiskLabel}</span>
              </div>
              <div style={css("font:400 11.5px/1.45 'Geist Sans','Pretendard',sans-serif;margin-top:6px;color:" + (riskHigh ? "rgba(255,255,255,.88)" : "var(--gray-600)"))}>{vm.prepRiskSignal}</div>
            </div>
            </div>

            {/* 우: 전화 요약 — 대기 중 고객 발화 STT를 요약한 내용 */}
            <div style={css("flex:1;min-width:0;align-self:stretch;background:var(--gray-100);border-radius:8px;padding:14px 16px")}>
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
          <div>
            <div style={css("display:flex;align-items:center;gap:8px;margin-bottom:9px")}>
              <span style={css("font:700 13px 'Geist Sans','Pretendard',sans-serif;color:var(--gray-1000)")}>이번 상담 유의사항</span>
            </div>
            <div style={css("display:flex;flex-direction:column;gap:8px;margin-bottom:12px")}>
              {vm.prepRows.map((r, i) => (
                <div key={i} style={css("display:flex;gap:9px;align-items:baseline")}>
                  <span className="mi" style={css("font-size:15px;color:var(--gray-500);flex:none;transform:translateY(3px)")}>check_circle</span>
                  <div style={css("flex:1")}>
                    <span style={css("font:700 13px 'Geist Sans','Pretendard',sans-serif;color:var(--gray-1000)")}>{r.title}</span>
                    <span style={css("font:400 12px/1.5 'Geist Sans','Pretendard',sans-serif;color:var(--gray-700);margin-left:6px")}>{r.sub}</span>
                  </div>
                </div>
              ))}
            </div>
            {/* 첫 응대 문장 — 준비의 결론. 잠금 없이 바로 보여준다 */}
            <div style={css("display:flex;align-items:baseline;gap:10px;background:var(--gray-100);border-radius:8px;padding:13px 16px")}>
              <span style={css("display:inline-flex;align-items:center;justify-content:center;width:20px;height:20px;border-radius:9999px;background:var(--gray-1000);color:var(--onair-surface);font:700 10.5px 'Geist Sans','Pretendard',sans-serif;flex:none;transform:translateY(3px)")}>온</span>
              <div>
                <div style={css("font:700 11px 'Geist Sans','Pretendard',sans-serif;color:var(--gray-700);margin-bottom:3px")}>이 문장으로 통화를 여세요</div>
                <div style={css("font:500 15px/1.55 Georgia,'Noto Serif KR','Apple SD Gothic Neo',serif;color:var(--gray-1000)")}>{vm.firstLine}</div>
              </div>
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

/** 세로 온도계 — 흰 유리관 + 회색 외곽 + 눈금 + 하이라이트, 수은 높이=감정 점수(0~100), 색은 레벨 색. */
function Thermometer({ score, color }: { score: number | null; color: string }) {
  const W = 24, H = 72, cx = 12;
  const tubeW = 9, tubeX = cx - tubeW / 2, top = 5, bulbCy = 58, bulbR = 10, tubeBot = bulbCy;
  const innerW = 4, innerX = cx - innerW / 2, innerTop = top + 3, innerBot = bulbCy - 4;
  const pct = Math.max(0, Math.min(100, score ?? 0)) / 100;
  const fillTop = innerBot - (innerBot - innerTop) * pct;
  const ticks = [0.75, 0.5, 0.25].map((t) => innerBot - (innerBot - innerTop) * t);
  return (
    <svg width={W} height={H} viewBox={"0 0 " + W + " " + H} style={{ flex: "none", display: "block" }}>
      {/* 유리관 + 구 (흰 유리, 회색 외곽) */}
      <rect x={tubeX} y={top} width={tubeW} height={tubeBot - top} rx={tubeW / 2} fill="#fff" stroke="var(--gray-300)" strokeWidth="1.5" />
      <circle cx={cx} cy={bulbCy} r={bulbR} fill="#fff" stroke="var(--gray-300)" strokeWidth="1.5" />
      {/* 눈금 */}
      {ticks.map((y, i) => (
        <line key={i} x1={tubeX + tubeW} y1={y} x2={tubeX + tubeW + 3} y2={y} stroke="var(--gray-300)" strokeWidth="1.2" strokeLinecap="round" />
      ))}
      {/* 수은 — 구는 항상, 관은 점수만큼 */}
      <circle cx={cx} cy={bulbCy} r={bulbR - 3.5} fill={color} />
      <rect x={innerX} y={fillTop} width={innerW} height={bulbCy - fillTop} rx={innerW / 2} fill={color} />
      {/* 유리 하이라이트 */}
      <rect x={tubeX + 1.5} y={top + 3} width="1.5" height={tubeBot - top - 14} rx="0.75" fill="rgba(255,255,255,.75)" />
    </svg>
  );
}
