import { css } from "../../lib/css";
import type { CallFlowVM } from "../../hooks/useCallFlow";
import DesktopShell from "./DesktopShell";

/** 1c — 상담 준비 카드 (dim 배경 + 모달). 유의사항 3개 확인 시 통화 연결 활성화. */
export default function PrepCard({ vm }: { vm: CallFlowVM }) {
  return (
    <DesktopShell>
      {/* 뒤 배경 (인입 대기) */}
      <div style={css("position:absolute;inset:0;display:flex;flex-direction:column")}>
        <div style={css("height:74px;flex:none;position:relative")}>
          <div className="pill" style={css("position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);padding:8px 20px;gap:11px")}>
            <span className="lampdots"><i className="r" /><i className="a lit" /><i className="g" /></span>
            <span style={css("font-weight:700;font-size:15px;color:var(--gray-1000)")}>인입 대기 · 연결 준비</span>
          </div>
        </div>
        <div style={css("flex:1;display:flex;gap:16px;padding:16px")}>
          <div style={css("width:312px;flex:none;background:var(--onair-surface);border-radius:20px;box-shadow:var(--sh-far)")} />
          <div style={css("flex:1;background:var(--onair-surface);border-radius:20px;box-shadow:var(--sh-far);display:flex;align-items:center;justify-content:center;font:400 14px 'Geist Sans','Pretendard',sans-serif;color:var(--gray-600)")}>
            고객을 선택하면 준비 카드가 열립니다
          </div>
          <div style={css("width:372px;flex:none;background:var(--onair-surface);border-radius:20px;box-shadow:var(--sh-far)")} />
        </div>
      </div>

      {/* dim — 광원이 모달에 있으므로 뒤는 웜 블랙으로 가라앉는다 */}
      <div style={css("position:absolute;inset:0;background:rgba(22,20,17,.5)")} />

      {/* 모달 */}
      <div style={css("position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);width:800px;max-height:860px;background:var(--onair-surface);border-radius:20px;box-shadow:var(--sh-modal);overflow:hidden;display:flex;flex-direction:column")}>
        <div style={css("padding:22px 28px 18px;border-bottom:1px solid var(--gray-200)")}>
          <div style={css("display:flex;align-items:center;gap:8px;margin-bottom:12px")}>
            <span style={css("display:inline-flex;align-items:center;gap:6px;font:600 11px 'Geist Sans','Pretendard',sans-serif;color:var(--blue-900);background:var(--gray-100);border-radius:9999px;padding:4px 11px")}>
              <span style={css("width:6px;height:6px;border-radius:9999px;background:var(--blue-700);animation:pulseDot 1.4s infinite")} />
              인입 콜 · 우선 연결 대상
            </span>
            <span style={css("font:600 11px 'Geist Sans','Pretendard',sans-serif;color:var(--gray-700);background:var(--gray-100);border-radius:9999px;padding:4px 10px")}>
              순번 1 · 대기 05:30
            </span>
            <span className="mi" style={css("margin-left:auto;font-size:22px;color:var(--gray-600);cursor:pointer")}>close</span>
          </div>
          <div style={css("font:600 22px/1.3 'Geist Sans','Pretendard',sans-serif;letter-spacing:-.3px;color:var(--gray-1000)")}>
            {vm.prepHeadline}
          </div>
          <div style={css("font:400 13px 'Geist Sans','Pretendard',sans-serif;color:var(--gray-700);margin-top:5px")}>
            고객 {vm.prepCustomerLine}
          </div>
        </div>

        <div style={css("flex:1;overflow:auto;padding:18px 24px;display:flex;flex-direction:column;gap:16px")}>
          {/* 3 지표 */}
          <div style={css("display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px")}>
            <div style={css("background:var(--gray-100);border-radius:14px;padding:14px 16px")}>
              <div style={css("display:flex;align-items:center;gap:5px;font:600 11px 'Geist Sans','Pretendard',sans-serif;color:var(--gray-700);margin-bottom:8px")}>
                <span className="mi" style={css("font-size:14px;color:var(--blue-700)")}>auto_awesome</span>AI 배정 권고
              </div>
              <div style={css("font:600 15px 'Geist Sans','Pretendard',sans-serif;color:var(--gray-1000)")}>{vm.prepRoutingTitle}</div>
              <div style={css("font:400 11.5px 'Geist Sans','Pretendard',sans-serif;color:var(--gray-600);margin-top:4px")}>{vm.prepRoutingReason}</div>
            </div>
            <div style={css("background:var(--gray-100);border-radius:14px;padding:14px 16px")}>
              <div style={css("font:600 11px 'Geist Sans','Pretendard',sans-serif;color:var(--amber-900);margin-bottom:8px")}>고객 감정온도</div>
              <div style={css("display:flex;align-items:center;gap:8px")}>
                <span style={css("display:flex;gap:2px")}>
                  {[1, 2, 3].map((bar) => (
                    <span
                      key={bar}
                      style={css(
                        "width:18px;height:6px;border-radius:2px;background:" +
                          (bar <= vm.prepEmotionBars
                            ? "var(--amber-700)"
                            : "var(--gray-200)")
                      )}
                    />
                  ))}
                </span>
                <span style={css("font:600 15px 'Geist Sans','Pretendard',sans-serif;color:var(--amber-900)")}>{vm.prepEmotionLabel}</span>
              </div>
              <div style={css("font:400 11.5px 'Geist Sans','Pretendard',sans-serif;color:var(--amber-900);margin-top:4px")}>{vm.prepEmotionSignal}</div>
            </div>
            <div style={css("background:var(--gray-100);border-radius:14px;padding:14px 16px")}>
              <div style={css("display:flex;align-items:center;gap:5px;font:600 11px 'Geist Sans','Pretendard',sans-serif;color:var(--red-900);margin-bottom:8px")}>
                <span className="mi" style={css("font-size:14px")}>gpp_maybe</span>사고 징후
              </div>
              <div style={css("font:600 15px 'Geist Sans','Pretendard',sans-serif;color:var(--red-900)")}>{vm.prepRiskLabel}</div>
              <div style={css("font:400 11.5px 'Geist Sans','Pretendard',sans-serif;color:var(--red-900);margin-top:4px")}>{vm.prepRiskSignal}</div>
            </div>
          </div>

          {/* AI 사전 요약 */}
          <div style={css("background:var(--gray-100);border-radius:14px;padding:16px 18px")}>
            <div style={css("display:flex;align-items:center;gap:6px;margin-bottom:12px")}>
              <span className="mi" style={css("font-size:17px;color:var(--blue-700)")}>auto_awesome</span>
              <span style={css("font:600 13px 'Geist Sans','Pretendard',sans-serif;color:var(--gray-1000)")}>AI 사전 요약</span>
              <span style={css("font:400 11px 'Geist Sans','Pretendard',sans-serif;color:var(--gray-600)")}>대기 중 고객 진술 기반 · 방금 생성됨</span>
            </div>
            <div style={css("display:flex;flex-direction:column;gap:10px")}>
              {vm.prepSummaryBullets.map((t, i) => (
                <div key={i} style={css("display:flex;gap:11px")}>
                  <span style={css("width:3px;border-radius:2px;background:var(--blue-500);flex:none")} />
                  <span style={css("font:400 13.5px/1.55 'Geist Sans','Pretendard',sans-serif;color:var(--gray-900)")}>{t}</span>
                </div>
              ))}
            </div>
          </div>

          {/* 유의사항 체크 */}
          <div>
            <div style={css("display:flex;align-items:baseline;gap:8px;margin-bottom:10px")}>
              <span style={css("font:700 13px 'Geist Sans','Pretendard',sans-serif;color:var(--gray-1000)")}>이번 상담 유의사항</span>
              <span style={css("font:400 11px 'Geist Sans','Pretendard',sans-serif;color:var(--gray-600)")}>상담 유형·감정온도에 따라 자동 구성 · 모두 확인해야 연결 가능</span>
              <span style={css("margin-left:auto;font:600 11px 'Geist Mono','IBM Plex Mono',monospace;color:var(--gray-700)")}>{vm.prepDone} / {vm.prepTotal} 확인</span>
            </div>
            <div style={css("display:flex;flex-direction:column;gap:9px")}>
              {vm.prepRows.map((r, i) => (
                <div
                  key={i}
                  onClick={r.toggle}
                  style={css(
                    "display:flex;gap:11px;align-items:center;background:" +
                      r.bg +
                      ";border:1px solid " +
                      r.bd +
                      ";border-radius:14px;padding:11px 13px;cursor:pointer;user-select:none;transition:background .15s,border-color .15s"
                  )}
                >
                  <span
                    style={css(
                      "width:20px;height:20px;flex:none;border-radius:9999px;background:" +
                        r.boxBg +
                        ";border:1.5px solid " +
                        r.boxBd +
                        ";color:#fff;display:flex;align-items:center;justify-content:center;box-sizing:border-box;transition:background .15s"
                    )}
                  >
                    <span className="mi" style={css("font-size:14px")}>{r.icon}</span>
                  </span>
                  <div>
                    <div style={css("font-weight:700;font-size:13px")}>{r.title}</div>
                    <div style={css("font:400 11.5px/1.5 'Geist Sans','Pretendard',sans-serif;color:var(--gray-700)")}>{r.sub}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div style={css("flex:none;display:flex;align-items:center;gap:12px;padding:15px 24px;box-shadow:var(--sh-joint);background:var(--gray-100)")}>
          <span style={css("display:flex;align-items:center;gap:5px;font:400 12.5px 'Geist Sans','Pretendard',sans-serif;color:var(--gray-700)")}>
            <span className="mi" style={css("font-size:16px")}>info</span> {vm.prepHint}
          </span>
          <div style={css("flex:1")} />
          <span
            onClick={vm.reset}
            style={css("display:inline-flex;align-items:center;gap:6px;padding:10px 18px;border:1px solid var(--gray-500);border-radius:9999px;font-size:14px;color:var(--gray-900);cursor:pointer;background:var(--onair-surface)")}
          >
            <span className="mi" style={css("font-size:17px")}>phone_forwarded</span> 다른 상담사에게 이관
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
