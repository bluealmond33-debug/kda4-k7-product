import { css } from "../../lib/css";
import type { CallFlowVM } from "../../hooks/useCallFlow";
import DesktopShell from "./DesktopShell";

const HISTORY = [
  { date: "2026.07.02", label: "카드 › 분실신고" },
  { date: "2026.05.18", label: "수신 › 이체한도 상향" },
  { date: "2026.03.09", label: "전자금융 › OTP 재발급" },
  { date: "2026.02.14", label: "대출 › 상환일정 문의" },
];

/** 1a — 통화 중. 좌: 상담사·고객(본인인증 1d)·이력 / 중: 요약·스크립트·메모 / 우: 규정. */
export default function ActiveCall({ vm }: { vm: CallFlowVM }) {
  return (
    <DesktopShell flex>
      {/* 상단 알약 */}
      <div style={css("height:74px;flex:none;position:relative;z-index:5")}>
        <div className="pill" style={css("position:absolute;left:50%;top:50%;transform:translate(-50%,-50%)")}>
          <span style={css("display:flex;align-items:center;gap:10px")}>
            <span className="lampdots"><i className="r" /><i className="a lit" /><i className="g" /></span>
            <span style={css("font-weight:700;font-size:15px")}>온에어 · 통화중</span>
          </span>
          <span style={css("display:flex;align-items:center;gap:4px;font:600 12px 'Geist Sans','Pretendard',sans-serif;color:var(--red-800)")}>
            <span className="mi" style={css("font-size:13px;animation:recBlink 1.6s infinite")}>fiber_manual_record</span> 녹취 중
          </span>
          <span style={css("width:1.3px;height:22px;background:var(--gray-200)")} />
          <span style={css("font:400 13px 'Geist Sans','Pretendard',sans-serif;color:var(--gray-900)")}>
            {vm.inquiryLabel}
          </span>
          <span style={css("width:1.3px;height:22px;background:var(--gray-200)")} />
          <span style={css("display:flex;align-items:center;gap:6px;font:400 13px 'Geist Sans','Pretendard',sans-serif;color:var(--gray-900)")}>
            <span className="mi" style={css("font-size:17px;color:var(--green-700)")}>call</span>{vm.customerPhone}
          </span>
          <span style={css("font:500 15px 'Geist Mono','IBM Plex Mono',monospace")}>{vm.clockStr}</span>
          <span style={css("width:1.3px;height:22px;background:var(--gray-200)")} />
          <span style={css("display:flex;gap:5px")}>
            <span className="cbtn" title="음소거"><span className="mi" style={css("font-size:19px")}>mic_off</span></span>
            <span className="cbtn" title="보류"><span className="mi" style={css("font-size:19px")}>pause</span></span>
            <span className="cbtn" title="이관"><span className="mi" style={css("font-size:19px")}>phone_forwarded</span></span>
          </span>
          <span
            title="통화 종료"
            onClick={vm.endCall}
            style={css("width:38px;height:38px;border-radius:9999px;background:var(--red-800);color:#fff;display:flex;align-items:center;justify-content:center;cursor:pointer")}
          >
            <span className="mi" style={css("font-size:20px")}>call_end</span>
          </span>
        </div>
      </div>

      <div style={css("flex:1;display:flex;gap:16px;padding:16px;min-height:0")}>
        {/* ── 좌 컬럼 ── */}
        <div style={css("width:320px;flex:none;display:flex;flex-direction:column;gap:14px;min-height:0")}>
          <div className="card" style={css("padding:13px 15px;display:flex;align-items:center;gap:12px" + (vm.verified ? ";box-shadow:var(--sh-away-l);opacity:.93" : ""))}>
            <span className="av" style={css("width:42px;height:42px")}><span className="mi" style={css("font-size:22px")}>headset_mic</span></span>
            <div style={css("flex:1;min-width:0")}>
              <div style={css("display:flex;align-items:center;gap:6px")}>
                <span style={css("font-weight:700;font-size:15px")}>상담사 김키움</span>
                <span style={css("width:7px;height:7px;border-radius:9999px;background:var(--green-700)")} />
                <span style={css("font:400 11px 'Geist Sans','Pretendard',sans-serif;color:var(--green-700)")}>통화 중</span>
              </div>
              <div style={css("font:400 11px 'Geist Sans','Pretendard',sans-serif;color:var(--gray-700);margin-top:1px")}>전자금융팀 · 사번 A-2231</div>
            </div>
            <div style={css("text-align:right;flex:none;padding-left:10px;border-left:1px solid var(--gray-200)")}>
              <div style={css("font:700 16px 'Geist Mono','IBM Plex Mono',monospace;color:var(--blue-700)")}>12</div>
              <div className="lbl">오늘 후처리</div>
            </div>
          </div>

          {/* 고객 카드 + 본인인증 (1d) — 본인확인 전에는 광원이 여기에 있다 */}
          <div className="card" style={css("padding:16px" + (vm.verified ? "" : ";box-shadow:var(--sh-focus)"))}>
            <div style={css("display:flex;align-items:center;justify-content:space-between;margin-bottom:12px")}>
              <span className="sechd">고객</span>
              <span style={css("font:400 10.5px 'Geist Sans','Pretendard',sans-serif;color:var(--amber-900);background:var(--gray-100);border-radius:9999px;padding:4px 10px")}>고객 동의 시 열람</span>
            </div>
            <div style={css("display:flex;align-items:center;gap:12px")}>
              <span className="av" style={css("width:46px;height:46px")}><span className="mi" style={css("font-size:26px")}>person</span></span>
              <div>
                <div style={css("font-weight:700;font-size:18px;line-height:1.2")}>{vm.customerName}</div>
                <div style={css("font:400 12px 'Geist Sans','Pretendard',sans-serif;color:var(--gray-700);margin-top:2px")}>
                  개인 고객 · <span style={css("font-family:'Geist Mono','IBM Plex Mono',monospace")}>{vm.customerNumber}</span>
                </div>
              </div>
            </div>

            {vm.verified ? (
              <div style={css("margin-top:13px;background:var(--gray-100);border-radius:14px;overflow:hidden")}>
                <div style={css("display:flex;align-items:center;gap:9px;padding:10px 12px;border-bottom:1px solid var(--gray-300)")}>
                  <span style={css("width:22px;height:22px;border-radius:9999px;background:var(--green-900);color:#fff;display:flex;align-items:center;justify-content:center")}>
                    <span className="mi" style={css("font-size:15px")}>check</span>
                  </span>
                  <div style={css("flex:1")}>
                    <span style={css("font:700 12.5px 'Geist Sans','Pretendard',sans-serif;color:var(--green-900)")}>본인인증 완료</span>
                    <span style={css("font:400 11px 'Geist Mono','IBM Plex Mono',monospace;color:var(--green-600);margin-left:6px")}>{vm.authTime}</span>
                  </div>
                  <span onClick={vm.resetAuth} style={css("display:flex;align-items:center;gap:2px;font:400 11px 'Geist Sans','Pretendard',sans-serif;color:var(--gray-600);cursor:pointer")}>
                    재인증 <span className="mi" style={css("font-size:15px")}>restart_alt</span>
                  </span>
                </div>
                <div style={css("padding:10px 12px;font:400 12px 'Geist Sans','Pretendard',sans-serif;color:var(--gray-900)")}>
                  {vm.authMethodLabel} · 일치 <span style={css("color:var(--gray-600)")}>(입력 자동 대조)</span>
                </div>
              </div>
            ) : (
              <div style={css("margin-top:13px;background:var(--gray-100);border-radius:14px;padding:12px")}>
                <div style={css("font:700 12.5px 'Geist Sans','Pretendard',sans-serif;color:var(--amber-900);margin-bottom:3px")}>본인확인 · 미완료</div>
                <div style={css("font:400 11px 'Geist Sans','Pretendard',sans-serif;color:var(--gray-700);margin-bottom:10px")}>고객이 말한 값을 입력하면 자동 대조됩니다</div>
                <div className="lbl" style={css("margin-bottom:6px")}>대조 방식</div>
                <div style={css("display:flex;gap:6px;flex-wrap:wrap;margin-bottom:11px")}>
                  <span onClick={vm.setAuthPhone} style={css("font:600 11.5px 'Geist Sans','Pretendard',sans-serif;border-radius:9999px;padding:5px 11px;cursor:pointer;background:" + vm.mPhoneBg + ";color:" + vm.mPhoneFg + ";border:1px solid " + vm.mPhoneBd)}>연락처 뒷 4자리</span>
                  <span onClick={vm.setAuthBirth} style={css("font:600 11.5px 'Geist Sans','Pretendard',sans-serif;border-radius:9999px;padding:5px 11px;cursor:pointer;background:" + vm.mBirthBg + ";color:" + vm.mBirthFg + ";border:1px solid " + vm.mBirthBd)}>생년월일</span>
                  <span onClick={vm.setAuthAcct} style={css("font:600 11.5px 'Geist Sans','Pretendard',sans-serif;border-radius:9999px;padding:5px 11px;cursor:pointer;background:" + vm.mAcctBg + ";color:" + vm.mAcctFg + ";border:1px solid " + vm.mAcctBd)}>계좌 뒷 4자리</span>
                </div>
                <div style={css("display:flex;gap:7px;align-items:center")}>
                  <input
                    value={vm.authInput}
                    onChange={vm.onAuthInput}
                    placeholder={vm.authPlaceholder}
                    inputMode="numeric"
                    style={css("flex:1;min-width:0;border:1px solid var(--gray-400);border-radius:9999px;padding:8px 14px;background:var(--onair-surface);font:600 14px 'Geist Mono','IBM Plex Mono',monospace;letter-spacing:2px;outline:none;color:var(--gray-1000)")}
                  />
                  <span onClick={vm.runVerify} style={css("flex:none;padding:9px 16px;background:var(--blue-700);color:#fff;border-radius:9999px;font:700 12.5px 'Geist Sans','Pretendard',sans-serif;cursor:pointer")}>대조</span>
                </div>
                {vm.authErr && (
                  <div style={css("margin-top:7px;font:400 11px 'Geist Sans','Pretendard',sans-serif;color:var(--red-800)")}>입력값이 부족합니다 · 자릿수를 확인하세요</div>
                )}
                <div style={css("display:flex;align-items:center;gap:5px;margin-top:9px;font:400 10.5px 'Geist Sans','Pretendard',sans-serif;color:var(--gray-600)")}>
                  <span className="mi" style={css("font-size:13px")}>lock</span> 원문은 표시되지 않으며 입력값과 자동 대조됩니다
                </div>
              </div>
            )}

            <div style={css("margin-top:12px")}>
              <div style={css("font:700 11px 'Geist Sans','Pretendard',sans-serif;color:var(--gray-700);margin-bottom:7px")}>
                고객 상세 조회 <span style={css("font-weight:400;color:var(--gray-600)")}>· 본인인증 후 열람</span>
              </div>
              {vm.verified ? (
                <div style={css("display:flex;flex-direction:column;gap:7px")}>
                  <span onClick={vm.openHistory} className="qlink" style={css("border-color:var(--blue-400);background:#fff;color:var(--blue-700);font-weight:700;cursor:pointer")}>
                    과거 상담 이력 <span className="mi" style={css("font-size:17px")}>open_in_new</span>
                  </span>
                  <span onClick={vm.openAccounts} className="qlink" style={css("cursor:pointer")}>
                    보유 계좌 및 카드 현황 <span className="mi" style={css("font-size:17px;color:var(--gray-600)")}>open_in_new</span>
                  </span>
                </div>
              ) : (
                <div style={css("display:flex;flex-direction:column;gap:7px;opacity:.6")}>
                  <span className="qlink" style={css("border-color:var(--gray-200);background:var(--gray-100);color:var(--gray-600)")}>과거 상담 이력 <span className="mi" style={css("font-size:16px")}>lock</span></span>
                  <span className="qlink" style={css("border-color:var(--gray-200);background:var(--gray-100);color:var(--gray-600)")}>보유 계좌 및 카드 현황 <span className="mi" style={css("font-size:16px")}>lock</span></span>
                </div>
              )}
            </div>
          </div>

          {vm.verified ? (
            <div className="card" style={css("flex:1;min-height:0;display:flex;flex-direction:column;overflow:hidden;box-shadow:var(--sh-away-l);opacity:.93")}>
              <div style={css("display:flex;align-items:center;justify-content:space-between;padding:12px 15px;border-bottom:1px dashed var(--color-border)")}>
                <span className="sechd">과거 상담 이력</span>
                <span style={css("font:500 11px 'Geist Mono','IBM Plex Mono',monospace;color:var(--gray-700)")}>최근 6개월 · 4건</span>
              </div>
              <div style={css("overflow:auto")}>
                {HISTORY.map((h, i) => (
                  <div key={i} style={css("padding:11px 14px" + (i < HISTORY.length - 1 ? ";border-bottom:1px solid var(--gray-200)" : ""))}>
                    <div style={css("display:flex;align-items:center;gap:8px")}>
                      <span style={css("font:500 11px 'Geist Mono','IBM Plex Mono',monospace;color:var(--gray-700)")}>{h.date}</span>
                      <span style={css("font:400 10px 'Geist Sans','Pretendard',sans-serif;color:var(--green-900);margin-left:auto;background:var(--gray-100);border-radius:9999px;padding:2px 8px")}>완결</span>
                    </div>
                    <div style={css("font:600 13px 'Geist Sans','Pretendard',sans-serif;color:var(--gray-1000);margin-top:4px")}>{h.label}</div>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="card" style={css("flex:1;min-height:0;display:flex;align-items:center;justify-content:center;padding:16px")}>
              <div style={css("text-align:center")}>
                <span className="mi" style={css("font-size:26px;color:var(--gray-400)")}>lock</span>
                <div style={css("font:400 12.5px/1.6 'Geist Sans','Pretendard',sans-serif;color:var(--gray-600);margin-top:6px")}>
                  본인인증 후<br />과거 상담 이력이 표시됩니다
                </div>
              </div>
            </div>
          )}
        </div>

        {/* ── 중 컬럼 ── */}
        <div style={css("flex:1;min-width:0;display:flex;flex-direction:column;gap:14px")}>
          <div className="card" style={css("flex:none;padding:11px 16px;display:flex;align-items:center;gap:14px;flex-wrap:wrap" + (vm.verified ? "" : ";box-shadow:var(--sh-away-r)"))}>
            <span style={css("display:flex;align-items:center;gap:6px")}>
              <span className="mi" style={css("font-size:15px;color:var(--blue-700)")}>auto_awesome</span>
              <span style={css("font:600 11px 'Geist Sans','Pretendard',sans-serif;color:var(--gray-700)")}>AI 배정</span>
              <span style={css("font:600 13px 'Geist Sans','Pretendard',sans-serif;color:var(--gray-1000)")}>{vm.prepRoutingTitle}</span>
            </span>
            <span style={css("width:1px;height:16px;background:var(--gray-200)")} />
            <span style={css("display:flex;align-items:center;gap:7px")} title="고객 감정온도">
              <span style={css("font:600 11px 'Geist Sans','Pretendard',sans-serif;color:var(--gray-700)")}>감정온도</span>
              <span style={css("display:flex;gap:2px")}>
                {[1, 2, 3].map((bar) => (
                  <span
                    key={bar}
                    className="seg"
                    style={css(
                      "background:" +
                        (bar <= vm.prepEmotionBars
                          ? "var(--amber-700)"
                          : "var(--gray-200)")
                    )}
                  />
                ))}
              </span>
              <span style={css("font:600 13px 'Geist Sans','Pretendard',sans-serif;color:var(--amber-900)")}>{vm.prepEmotionLabel}</span>
            </span>
            <span style={css("width:1px;height:16px;background:var(--gray-200)")} />
            <span style={css("display:flex;align-items:center;gap:6px")}>
              <span className="mi" style={css("font-size:15px;color:var(--red-700)")}>gpp_maybe</span>
              <span style={css("font:600 11px 'Geist Sans','Pretendard',sans-serif;color:var(--gray-700)")}>사고 징후</span>
              <span style={css("font:600 13px 'Geist Sans','Pretendard',sans-serif;color:var(--red-900)")}>{vm.prepRiskLabel}</span>
            </span>
            <div style={css("flex:1")} />
            <span style={css("display:flex;align-items:center;gap:4px;font:600 11px 'Geist Sans','Pretendard',sans-serif;color:var(--green-900)")}>
              <span className="mi" style={css("font-size:14px")}>check_circle</span> 준비 카드 확인 완료
            </span>
          </div>

          <div className="card" style={css("flex:none;padding:15px 17px" + (vm.verified ? "" : ";box-shadow:var(--sh-away-r)"))}>
            <div style={css("display:flex;align-items:center;gap:6px;margin-bottom:9px")}>
              <span className="mi" style={css("font-size:17px;color:var(--blue-700)")}>auto_awesome</span>
              <span style={css("font:600 13px 'Geist Sans','Pretendard',sans-serif;color:var(--gray-1000)")}>AI 사전 요약</span>
              <span style={css("font:400 11px 'Geist Sans','Pretendard',sans-serif;color:var(--gray-600)")}>대기 중 고객 진술 기반</span>
            </div>
            <div style={css("font:600 15px 'Geist Sans','Pretendard',sans-serif;color:var(--gray-1000);margin-bottom:10px")}>{vm.prepHeadline}</div>
            <div style={css("display:flex;flex-direction:column;gap:8px")}>
              {[
                "오늘 오전 지인에게 30만원 이체 중 다른 계좌로 착오송금했다고 진술.",
                "거래 시각·수취 계좌 확인 및 반환 절차 안내 요청.",
                "보이스피싱 의심 정황 없음 · 단, 고객 불안·다급 발화 감지됨.",
              ].map((t, i) => (
                <div key={i} style={css("display:flex;gap:11px")}>
                  <span style={css("width:3px;border-radius:2px;background:var(--blue-500);flex:none")} />
                  <span style={css("font:400 13px/1.55 'Geist Sans','Pretendard',sans-serif;color:var(--gray-900)")}>{t}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="card" style={css("flex:1;min-height:0;display:flex;flex-direction:column;overflow:hidden" + (vm.verified ? ";box-shadow:var(--sh-focus)" : ";box-shadow:var(--sh-away-r)"))}>
            <div style={css("display:flex;align-items:center;justify-content:space-between;padding:12px 16px;border-bottom:1px dashed var(--color-border)")}>
              <span className="sechd" style={css("display:flex;align-items:center;gap:6px")}>
                <span className="mi" style={css("font-size:18px")}>menu_book</span> 단계별 상담 스크립트
              </span>
              <span style={css("font:600 11px 'Geist Sans','Pretendard',sans-serif;color:var(--gray-600)")}>AI 추천 흐름 · 전체 표시</span>
            </div>
            <div style={css("flex:1;overflow:auto;padding:14px 16px;display:flex;flex-direction:column;gap:9px")}>
              {vm.steps.map((st, i) => (
                <div key={i} style={css("background:var(--gray-100);border-radius:14px;padding:11px 13px")}>
                  <div style={css("font:700 12.5px 'Geist Sans','Pretendard',sans-serif;color:var(--gray-1000);margin-bottom:5px")}>{st.title}</div>
                  <div style={css("font:400 13px/1.6 'Geist Sans','Pretendard',sans-serif;color:var(--gray-900)")}>{st.text}</div>
                </div>
              ))}
            </div>
          </div>

          <div className="card" style={css("flex:none;height:196px;display:flex;flex-direction:column" + (vm.verified ? "" : ";box-shadow:var(--sh-away-r);opacity:.93"))}>
            <div style={css("display:flex;align-items:center;justify-content:space-between;padding:11px 16px;border-bottom:1px dashed var(--color-border)")}>
              <span className="sechd" style={css("display:flex;align-items:center;gap:5px")}>
                <span className="mi" style={css("font-size:17px")}>edit_note</span> 상담원 메모
              </span>
              <span style={css("font:400 11px 'Geist Sans','Pretendard',sans-serif;color:var(--gray-600)")}>불릿 자동 · 종료 시 후처리에 반영</span>
            </div>
            <div style={css("flex:1;overflow:auto;padding:10px 16px;display:flex;flex-direction:column;gap:6px")}>
              {vm.memoItems.map((m, i) => (
                <div key={i} style={css("display:flex;gap:8px;align-items:baseline")}>
                  <span style={css("color:var(--blue-700);font-weight:700;flex:none")}>•</span>
                  <span style={css("font:400 13px/1.5 'Geist Sans','Pretendard',sans-serif;color:var(--gray-1000)")}>{m}</span>
                </div>
              ))}
              {vm.memoEmpty && (
                <div style={css("font:400 12.5px 'Geist Sans','Pretendard',sans-serif;color:var(--gray-500)")}>특이사항을 입력하면 불릿으로 기록됩니다</div>
              )}
            </div>
            <div style={css("flex:none;display:flex;align-items:center;gap:8px;padding:9px 14px;border-top:1px solid var(--gray-200)")}>
              <span style={css("color:var(--blue-700);font-weight:700")}>•</span>
              <input
                value={vm.memoDraft}
                onChange={vm.onMemoDraft}
                onKeyDown={vm.onMemoKey}
                placeholder="메모 입력 후 Enter"
                style={css("flex:1;border:none;outline:none;font:400 13px 'Geist Sans','Pretendard',sans-serif;color:var(--gray-1000);background:transparent")}
              />
            </div>
          </div>
        </div>

        {/* ── 우 컬럼 : 규정 ── */}
        <div style={css("width:" + vm.regW + "px;flex:none;display:flex;flex-direction:column;gap:14px;min-height:0")}>
          <div className="card" style={css("flex:1;min-height:0;display:flex;flex-direction:column;overflow:hidden;box-shadow:" + (vm.verified ? "var(--sh-away-r);opacity:.95" : "var(--sh-away-r-far);opacity:.9"))}>
            <div style={css("display:flex;align-items:center;justify-content:space-between;padding:12px 15px;border-bottom:1px dashed var(--color-border)")}>
              <span className="sechd" style={css("display:flex;align-items:center;gap:6px")}>
                <span className="mi" style={css("font-size:18px")}>gavel</span> 관련 규정 및 매뉴얼
              </span>
              {vm.regCollapsed ? (
                <span style={css("font:600 10px 'Geist Sans','Pretendard',sans-serif;color:var(--gray-700);background:var(--gray-100);border:1px solid var(--gray-200);border-radius:9999px;padding:2px 8px")}>규정집 · 매뉴얼</span>
              ) : (
                <span onClick={vm.closeReg} style={css("display:inline-flex;align-items:center;gap:4px;font:600 11.5px 'Geist Sans','Pretendard',sans-serif;color:var(--blue-700);border:1px solid var(--blue-400);border-radius:9999px;padding:5px 12px;cursor:pointer")}>
                  <span className="mi" style={css("font-size:15px")}>close_fullscreen</span> 축소
                </span>
              )}
            </div>

            {vm.regCollapsed ? (
              <div style={css("flex:1;min-height:0;overflow:auto")}>
                <div style={css("padding:12px 15px;border-bottom:1px solid var(--gray-200)")}>
                  <div style={css("display:flex;align-items:center;gap:8px;border:1px solid var(--gray-400);border-radius:9999px;padding:9px 14px;background:var(--onair-surface)")}>
                    <span className="mi" style={css("font-size:18px;color:var(--gray-700)")}>search</span>
                    <span style={css("flex:1;font:400 13px 'Geist Sans','Pretendard',sans-serif;color:var(--gray-1000)")}>착오송금 반환</span>
                  </div>
                  <div style={css("display:flex;align-items:center;gap:5px;margin-top:7px;font:400 11px 'Geist Sans','Pretendard',sans-serif;color:var(--gray-600)")}>
                    <span className="mi" style={css("font-size:14px")}>info</span> 열기를 누르면 오른쪽에서 규정집이 펼쳐집니다
                  </div>
                </div>
                <div style={css("padding:13px 15px;display:flex;flex-direction:column;gap:14px")}>
                  <div>
                    <div style={css("display:flex;align-items:center;gap:5px;font:700 11px 'Geist Sans','Pretendard',sans-serif;color:var(--amber-900);margin-bottom:8px")}>
                      <span className="mi" style={css("font-size:14px")}>auto_awesome</span> 이번 상담 예상 규정 · AI 추천
                    </div>
                    <div style={css("display:flex;flex-direction:column;gap:9px")}>
                      <RegReco vm={vm} title="착오송금 반환지원 제도" body="“수취인 동의 없이 임의로 돌려드릴 수는 없고, 예금보험공사 반환지원 제도로 신청하실 수 있습니다.”" file="전자금융_업무매뉴얼 · 12행" />
                      <RegReco vm={vm} title="전자금융 이상거래(FDS) 대응" body="거래 시각·기기·IP 변경 이력 확인. 의심 시 사고대응팀 연계." file="이상거래_대응지침 · 44행" />
                    </div>
                  </div>
                  <div>
                    <div style={css("font:700 11px 'Geist Sans','Pretendard',sans-serif;color:var(--gray-700);margin-bottom:8px")}>규정집 파일 바로가기</div>
                    <div style={css("display:flex;flex-direction:column;gap:7px")}>
                      <RegFile vm={vm} name="전자금융거래 업무매뉴얼_v24" />
                      <RegFile vm={vm} name="착오송금_반환지원_안내" />
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              <>
                <div style={css("display:flex;align-items:center;gap:8px;padding:9px 14px;background:#1f7a44;color:#fff")}>
                  <span className="mi" style={css("font-size:18px")}>grid_on</span>
                  <span style={css("font:600 12.5px 'Geist Sans','Pretendard',sans-serif")}>{vm.regFile}</span>
                  <span style={css("font:400 11px 'Geist Mono','IBM Plex Mono',monospace;opacity:.85")}>· {vm.regSheet} 시트</span>
                </div>
                <div style={css("flex:1;min-height:0;overflow:auto;background:#fff")}>
                  <div style={css("display:flex;flex-direction:column;min-width:max-content")}>
                    <div style={css("display:flex;position:sticky;top:0")}>
                      <span style={css("width:36px;flex:none;background:var(--gray-100);border-right:1px solid var(--gray-300);border-bottom:1px solid var(--gray-300)")} />
                      {vm.regCols.map((c, i) => (
                        <span key={i} style={css("width:" + c.w + "px;flex:none;padding:8px 10px;background:var(--gray-100);border-right:1px solid var(--gray-300);border-bottom:1px solid var(--gray-300);font:700 12px 'Geist Sans','Pretendard',sans-serif;color:var(--gray-900)")}>{c.l}</span>
                      ))}
                    </div>
                    {vm.regRows.map((r) => (
                      <div key={r.n} style={css("display:flex")}>
                        <span style={css("width:36px;flex:none;padding:8px 0;text-align:center;background:var(--gray-100);border-right:1px solid var(--gray-300);border-bottom:1px solid var(--gray-200);font:400 11px 'Geist Mono','IBM Plex Mono',monospace;color:var(--gray-600)")}>{r.n}</span>
                        {r.cells.map((cell, ci) => (
                          <span key={ci} style={css("width:" + cell.w + "px;flex:none;padding:8px 10px;border-right:1px solid var(--gray-200);border-bottom:1px solid var(--gray-200);font:400 12px/1.5 'Geist Sans','Pretendard',sans-serif;color:var(--gray-1000)")}>{cell.text}</span>
                        ))}
                      </div>
                    ))}
                  </div>
                </div>
                <div style={css("display:flex;align-items:center;gap:2px;padding:6px 10px;background:var(--gray-100);border-top:1px solid var(--gray-300)")}>
                  <span style={css("font:600 11.5px 'Geist Sans','Pretendard',sans-serif;background:#fff;border:1px solid var(--gray-300);border-bottom:none;border-radius:4px 4px 0 0;padding:5px 12px;color:var(--gray-1000)")}>{vm.regSheet}</span>
                  <span style={css("font:400 11.5px 'Geist Sans','Pretendard',sans-serif;padding:5px 12px;color:var(--gray-600)")}>Sheet2</span>
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {/* 상세조회 dock */}
      {vm.dockOpen && (
        <div style={css("position:absolute;left:0;right:0;bottom:0;height:430px;background:#fff;border-top:2px solid var(--blue-700);box-shadow:0 -12px 32px rgba(0,0,0,.16);z-index:30;display:flex;flex-direction:column;animation:dockUp .2s ease")}>
          <div style={css("display:flex;align-items:center;gap:10px;padding:13px 20px;border-bottom:1px solid var(--gray-200)")}>
            <span className="mi" style={css("font-size:20px;color:var(--gray-700)")}>grid_on</span>
            <span style={css("font:700 15px 'Geist Sans','Pretendard',sans-serif;color:var(--gray-1000)")}>{vm.dockTitle}</span>
            <span style={css("font:400 11.5px 'Geist Mono','IBM Plex Mono',monospace;color:var(--gray-600)")}>{vm.dockFile}</span>
            <div style={css("flex:1")} />
            <span onClick={vm.closeDock} style={css("display:inline-flex;align-items:center;gap:4px;font:600 12px 'Geist Sans','Pretendard',sans-serif;color:var(--gray-700);border:1px solid var(--gray-300);border-radius:9999px;padding:6px 13px;cursor:pointer")}>
              <span className="mi" style={css("font-size:16px")}>expand_more</span> 닫기
            </span>
          </div>
          <div style={css("flex:1;overflow:auto;background:#fff")}>
            <div style={css("display:flex;flex-direction:column;min-width:max-content")}>
              <div style={css("display:flex;position:sticky;top:0")}>
                <span style={css("width:40px;flex:none;background:var(--gray-100);border-right:1px solid var(--gray-300);border-bottom:1px solid var(--gray-300)")} />
                {vm.dockCols.map((c, i) => (
                  <span key={i} style={css("width:" + c.w + "px;flex:none;padding:9px 12px;background:var(--gray-100);border-right:1px solid var(--gray-300);border-bottom:1px solid var(--gray-300);font:700 12px 'Geist Sans','Pretendard',sans-serif;color:var(--gray-900)")}>{c.l}</span>
                ))}
              </div>
              {vm.dockRows.map((r) => (
                <div key={r.n} style={css("display:flex")}>
                  <span style={css("width:40px;flex:none;padding:9px 0;text-align:center;background:var(--gray-100);border-right:1px solid var(--gray-300);border-bottom:1px solid var(--gray-200);font:400 11px 'Geist Mono','IBM Plex Mono',monospace;color:var(--gray-600)")}>{r.n}</span>
                  {r.cells.map((cell, ci) => (
                    <span key={ci} style={css("width:" + cell.w + "px;flex:none;padding:9px 12px;border-right:1px solid var(--gray-200);border-bottom:1px solid var(--gray-200);font:400 12.5px/1.5 'Geist Sans','Pretendard',sans-serif;color:var(--gray-1000)")}>{cell.text}</span>
                  ))}
                </div>
              ))}
            </div>
          </div>
          <div style={css("display:flex;align-items:center;gap:2px;padding:6px 12px;background:var(--gray-100);border-top:1px solid var(--gray-300)")}>
            <span style={css("font:600 11.5px 'Geist Sans','Pretendard',sans-serif;background:#fff;border:1px solid var(--gray-300);border-bottom:none;border-radius:4px 4px 0 0;padding:5px 12px;color:var(--gray-1000)")}>{vm.dockSheet}</span>
            <span style={css("margin-left:auto;font:400 11px 'Geist Sans','Pretendard',sans-serif;color:var(--gray-600)")}>읽기 전용 · 고객 동의 하 열람</span>
          </div>
        </div>
      )}
    </DesktopShell>
  );
}

function RegReco({ vm, title, body, file }: { vm: CallFlowVM; title: string; body: string; file: string }) {
  return (
    <div style={css("background:var(--gray-100);border-radius:14px;padding:11px 13px")}>
      <div style={css("font:700 12.5px 'Geist Sans','Pretendard',sans-serif;color:var(--gray-1000);margin-bottom:5px")}>{title}</div>
      <div style={css("font:400 12px/1.5 'Geist Sans','Pretendard',sans-serif;color:var(--gray-900)")}>{body}</div>
      <div style={css("display:flex;align-items:center;justify-content:space-between;margin-top:8px")}>
        <span style={css("font:400 10.5px 'Geist Mono','IBM Plex Mono',monospace;color:var(--gray-600)")}>{file}</span>
        <span onClick={vm.openManual} style={css("display:inline-flex;align-items:center;gap:4px;font:600 11.5px 'Geist Sans','Pretendard',sans-serif;color:var(--blue-700);border:1px solid var(--blue-400);background:var(--onair-surface);border-radius:9999px;padding:4px 11px;cursor:pointer")}>
          <span className="mi" style={css("font-size:14px")}>open_in_new</span> 열기
        </span>
      </div>
    </div>
  );
}

function RegFile({ vm, name }: { vm: CallFlowVM; name: string }) {
  return (
    <span onClick={vm.openManual} style={css("display:flex;align-items:center;gap:8px;background:var(--gray-100);border-radius:9999px;padding:9px 14px;font:600 12px 'Geist Sans','Pretendard',sans-serif;color:var(--gray-1000);cursor:pointer")}>
      <span style={css("flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap")}>{name}</span>
      <span className="mi" style={css("font-size:16px;color:var(--gray-600)")}>open_in_new</span>
    </span>
  );
}
