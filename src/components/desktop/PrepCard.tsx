import { useState } from "react";
import { css } from "../../lib/css";
import type { CallFlowVM } from "../../hooks/useCallFlow";
import { AGENT } from "../../data/demoContent";
import DesktopShell from "./DesktopShell";
import BrandLogo from "../BrandLogo";

const FONT = "'Avenir Next','Pretendard',sans-serif";

/** 상담 준비 카드 — 전화 받기 전 KARI-NA 브리핑.
 *  상단: 로고(좌) · 라우팅 단계 부서→업무코드(우, 클릭=부서 이관).
 *  좌측: 감정온도(표정+당근식 36.5 온도계) · 확신도 도넛 + 본인인증 · 유의사항(제목만).
 *  우측: 전화 요약(가장 큰 비중) — 한 줄 요약 → 근거 발화 → STT 불릿 → 핵심 니즈 키워드.
 *  하단 패널: '이 문장으로 통화를 여세요'(감정온도 연동) + 펼치면 전체 스크립트.
 *  색 원칙: 연한 틴트 배경을 쓰지 않는다. 흰 면 + 경계선으로 나누고, 색은 의미(온도·상태)에만. */
export default function PrepCard({ vm }: { vm: CallFlowVM }) {
  const [scriptOpen, setScriptOpen] = useState(false);
  const [transferMenu, setTransferMenu] = useState(false);

  const reservedDept = vm.transferReserved ? vm.transferTarget ?? vm.suggestedDept : null;
  const confPct = vm.prepConfidencePct ?? 0;

  return (
    <DesktopShell>
      {/* 뒤 배경 (인입 대기) */}
      <div style={css("position:absolute;inset:0;display:flex;flex-direction:column")}>
        <div style={css("flex:1;display:flex;gap:16px;padding:16px")}>
          <div style={css("width:312px;flex:none;background:var(--onair-surface);border-radius:12px;box-shadow:var(--sh-near)")} />
          <div style={css("flex:1;background:var(--onair-surface);border-radius:12px;box-shadow:var(--sh-far);display:flex;align-items:center;justify-content:center;font:400 14px " + FONT + ";color:var(--gray-600)")}>
            고객을 선택하면 준비 카드가 열립니다
          </div>
          <div style={css("width:372px;flex:none;background:var(--onair-surface);border-radius:12px;box-shadow:var(--sh-near)")} />
        </div>
      </div>

      <div style={css("position:absolute;inset:0;background:rgba(22,20,17,.5);animation:fadeIn .18s ease-out")} />

      <div style={css("position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);display:flex;flex-direction:column;align-items:center;gap:10px;width:820px;max-width:95%;animation:modalIn .18s cubic-bezier(0.2,0.8,0.2,1)")}>
        <div data-tour="prep-card" style={css("width:100%;max-height:620px;background:var(--onair-surface);border-radius:12px;box-shadow:var(--sh-modal);overflow:hidden;display:flex;flex-direction:column")}>

          {/* ── 상단 ── 로고(좌) / 라우팅 단계: 부서 → 업무코드 (클릭=이관) */}
          <div style={css("flex:none;padding:14px 22px;border-bottom:1px solid var(--gray-200);display:flex;align-items:center;gap:14px")}>
            <div style={css("display:flex;align-items:center;gap:10px;flex:none")}>
              <div style={css("display:flex;flex-direction:column;gap:2px")}>
                <div style={css("display:flex;align-items:center;gap:7px")}>
                  <BrandLogo size={15} color="var(--gray-1000)" />
                  <span style={css("font:700 12.5px " + FONT + ";letter-spacing:.2px;color:var(--gray-500)")}>브리핑</span>
                </div>
                <span style={css("font:400 10px " + FONT + ";color:var(--gray-600)")}>{vm.summarySourceLabel} · 전화 받기 전 미리 정리했어요</span>
              </div>
            </div>

            <div style={css("flex:1")} />

            {/* 라우팅 단계 — 부서 → 업무코드. 각 단계에 라벨을 달아 '어디로, 무슨 업무로' 갔는지 보인다 */}
            <span style={css("position:relative;display:inline-flex;flex:none")}>
              <span
                onClick={() => setTransferMenu((v) => !v)}
                title="배정 결과 — 클릭하면 다른 부서로 이관(종료 시 예약)"
                style={css(
                  "display:inline-flex;align-items:center;gap:10px;border-radius:10px;padding:6px 10px;cursor:pointer;border:1px solid " +
                    (reservedDept ? "var(--blue-700)" : "var(--gray-300)") +
                    ";background:" + (reservedDept ? "var(--blue-700)" : "var(--onair-surface)")
                )}
              >
                <span style={css("display:flex;flex-direction:column;gap:1px")}>
                  <span style={css("font:600 8.5px " + FONT + ";letter-spacing:.4px;color:" + (reservedDept ? "rgba(255,255,255,.7)" : "var(--gray-600)"))}>배정 부서</span>
                  <span style={css("font:700 12.5px " + FONT + ";color:" + (reservedDept ? "#fff" : "var(--gray-1000)"))}>{reservedDept ?? vm.prepRoutingTitle}</span>
                </span>
                <span className="mi" style={css("font-size:16px;color:" + (reservedDept ? "rgba(255,255,255,.55)" : "var(--gray-400)"))}>arrow_forward</span>
                <span style={css("display:flex;flex-direction:column;gap:1px")}>
                  <span style={css("font:600 8.5px " + FONT + ";letter-spacing:.4px;color:" + (reservedDept ? "rgba(255,255,255,.7)" : "var(--gray-600)"))}>업무 코드</span>
                  {/* 코드만 보면 무슨 업무인지 모른다 — 코드 옆에 업무명을 함께 */}
                  <span style={css("display:flex;align-items:baseline;gap:5px")}>
                    <span style={css("font:700 12.5px 'Geist Mono',monospace;letter-spacing:.3px;color:" + (reservedDept ? "#fff" : "var(--gray-1000)"))}>{vm.prepBusinessCode}</span>
                    <span style={css("font:600 11px " + FONT + ";color:" + (reservedDept ? "rgba(255,255,255,.85)" : "var(--gray-700)"))}>{vm.prepBusinessCodeLabel}</span>
                  </span>
                </span>
                <span className="mi" style={css("font-size:17px;color:" + (reservedDept ? "#fff" : "var(--gray-500)") + ";transition:transform .2s;transform:rotate(" + (transferMenu ? 180 : 0) + "deg)")}>expand_more</span>
              </span>
              {transferMenu && (
                <>
                  <span onClick={() => setTransferMenu(false)} style={css("position:fixed;inset:0;z-index:40")} />
                  <div style={css("position:absolute;right:0;top:calc(100% + 8px);z-index:41;width:272px;background:var(--onair-surface);border-radius:10px;box-shadow:var(--sh-modal);overflow:hidden")}>
                    <div style={css("padding:9px 13px 7px;font:700 10.5px " + FONT + ";color:var(--gray-700);border-bottom:1px solid var(--gray-200)")}>부서 이관 · 종료 시 예약</div>
                    {vm.transferReserved && (
                      <div onClick={() => { vm.toggleTransferReserve(); setTransferMenu(false); }} className="memorow" style={css("display:flex;align-items:center;gap:6px;padding:9px 13px;cursor:pointer;border-bottom:1px solid var(--gray-200);color:var(--red-800)")}>
                        <span className="mi" style={css("font-size:15px")}>close</span>
                        <span style={css("font:600 12px " + FONT)}>이관 예약 취소</span>
                      </div>
                    )}
                    <div onClick={() => { vm.reserveTransfer(); setTransferMenu(false); }} className="memorow" style={css("display:flex;align-items:center;gap:6px;padding:9px 13px;cursor:pointer;border-bottom:1px solid var(--gray-200)")}>
                      <span className="mi" style={css("font-size:15px;color:var(--blue-700)")}>auto_awesome</span>
                      <span style={css("font:600 12px " + FONT + ";color:var(--gray-1000)")}>AI 추천 — {vm.suggestedDept}</span>
                    </div>
                    {vm.transferDepts.map((d) => (
                      <div key={d.name} onClick={() => { vm.reserveTransfer(d.name); setTransferMenu(false); }} className="memorow" style={css("display:flex;flex-direction:column;gap:1px;padding:8px 13px;cursor:pointer")}>
                        <span style={css("display:flex;align-items:center;gap:6px;font:600 12px " + FONT + ";color:var(--gray-1000)")}>{d.name}<span style={css("font:400 10px " + FONT + ";color:var(--gray-600)")}>{d.state}</span></span>
                        <span style={css("font:400 10.5px " + FONT + ";color:var(--gray-700)")}>{d.desc}</span>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </span>
          </div>

          {/* ── 본문 ── */}
          <div style={css("flex:1;overflow:auto;padding:14px 22px 16px;display:flex;flex-direction:column;gap:12px")}>
            {/* 유의사항 — 카드 최상단 한 줄 칩. 통화 전 스치듯 확인하는 가드레일이라 세로 목록보다 스캔이 빠르다 */}
            <div data-tour="prep-checks" style={css("display:flex;align-items:center;flex-wrap:wrap;gap:7px")}>
              <span className="mi" style={css("font-size:15px;color:var(--gray-700);flex:none")}>info</span>
              <span style={css("font:700 10.5px " + FONT + ";letter-spacing:.2px;color:var(--gray-700);margin-right:2px;flex:none")}>이번 상담 유의</span>
              {vm.prepRows.map((r, i) => (
                <span key={i} style={css("display:inline-flex;align-items:center;gap:5px;font:600 11.5px " + FONT + ";color:var(--gray-1000);border:1px solid var(--gray-400);border-radius:9999px;padding:3px 11px;white-space:nowrap")}>
                  <span className="mi" style={css("font-size:13px;color:var(--gray-700)")}>check</span>{r.title}
                </span>
              ))}
            </div>

            {vm.isTransfer && (
              <div style={css("border:1px solid var(--gray-300);border-radius:8px;padding:13px 15px")}>
                <div style={css("display:flex;align-items:center;gap:6px;margin-bottom:9px")}>
                  <span className="mi" style={css("font-size:16px;color:var(--blue-700)")}>sync_alt</span>
                  <span style={css("font:700 12.5px " + FONT + ";color:var(--gray-1000)")}>인수인계 — {vm.handover.from} {vm.handover.fromLevel}·{vm.handover.fromTenure}</span>
                  <span style={css("font:400 11px " + FONT + ";color:var(--gray-700)")}>통화 {vm.handover.talkTime}{vm.handover.verified ? " · 본인확인 완료" : ""} · AI 자동 작성</span>
                </div>
                <div style={css("display:flex;flex-direction:column;gap:6px;margin-bottom:9px")}>
                  {vm.handover.aiMemo.map((m, i) => (
                    <div key={i} style={css("display:flex;gap:9px")}>
                      <span style={css("width:3px;border-radius:2px;background:var(--blue-700);flex:none")} />
                      <span style={css("font:400 12.5px/1.5 " + FONT + ";color:var(--gray-900)")}>{m}</span>
                    </div>
                  ))}
                </div>
                <div style={css("display:flex;align-items:center;gap:6px;font:600 11.5px " + FONT + ";color:var(--blue-900)")}>
                  <span className="mi" style={css("font-size:14px")}>flag</span>남은 액션 · {vm.handover.remaining}
                </div>
              </div>
            )}

            <div style={css("display:flex;gap:12px;align-items:stretch")}>
              {/* ── 좌: 감정온도 → 확신도·본인인증 → 유의사항 ── */}
              <div style={css("flex:none;width:228px;display:flex;flex-direction:column;gap:10px")}>
                {/* 감정온도 — 표정 + 당근식 36.5 기준 온도계 */}
                <div style={css("border:1px solid var(--gray-300);border-radius:10px;padding:13px 14px;display:flex;flex-direction:column;gap:10px")}>
                  <div style={css("display:flex;align-items:center;gap:5px")}>
                    <span style={css("font:600 10px " + FONT + ";letter-spacing:.2px;color:var(--gray-600)")}>고객 감정온도</span>
                    <div style={css("flex:1")} />
                    <span title={vm.prepEmotionSourceBadge.isReal ? "실제 AI 감정 모델 판정" : "데모용 값"} style={css("font:600 8px 'Geist Mono',monospace;letter-spacing:.3px;padding:1.5px 5px;border-radius:9999px;border:1px solid var(--gray-300);color:var(--gray-600)")}>{vm.prepEmotionSourceBadge.label}</span>
                  </div>
                  <div style={css("display:flex;align-items:center;gap:9px")}>
                    {/* 표정 — 숫자보다 얼굴이 먼저 읽힌다 */}
                    <span className="mi" style={css("font-size:34px;line-height:1;color:" + vm.prepEmotionBar)}>{vm.prepEmotionFace}</span>
                    <span style={css("display:flex;align-items:baseline;gap:6px")}>
                      <span style={css("font:800 28px/1 " + FONT + ";letter-spacing:-1.2px;color:" + vm.prepEmotionBar)}>{vm.prepTempC != null ? vm.prepTempC.toFixed(1) : "--"}<span style={css("font:800 17px " + FONT)}>°</span></span>
                      <span style={css("font:700 12.5px " + FONT + ";color:" + vm.prepEmotionBar)}>{vm.prepEmotionLabel}</span>
                    </span>
                  </div>
                  <div style={css("position:relative;height:7px;border-radius:9999px;background:linear-gradient(90deg,var(--green-700) 0%,var(--green-700) 30%,var(--amber-700) 58%,var(--red-700) 100%)")}>
                    <span style={css("position:absolute;top:-3px;bottom:-3px;width:2px;border-radius:2px;background:#fff;left:" + vm.prepTempBasePct + "%")} />
                    <span style={css("position:absolute;top:50%;width:13px;height:13px;border-radius:9999px;background:#fff;border:2.5px solid " + vm.prepEmotionBar + ";box-shadow:0 1px 4px rgba(0,0,0,.28);transform:translate(-50%,-50%);transition:left .4s;left:" + (vm.prepTempC != null ? vm.prepTempPct : vm.prepTempBasePct) + "%")} />
                  </div>
                </div>

                {/* 확신도(도넛) + 본인인증 — 감정온도 바로 아래, 좌/우 */}
                <div style={css("display:flex;gap:10px")}>
                  {/* 확신도 3 : 본인인증 2 — 도넛+라벨이 한 줄에 들어가도록 넓게 */}
                  <div title={vm.prepConfidence} style={css("flex:3;min-width:0;border:1px solid var(--gray-300);border-radius:10px;padding:10px 11px;display:flex;align-items:center;gap:10px")}>
                    <ConfidenceDonut pct={confPct} known={vm.prepConfidencePct != null} />
                    <div style={css("display:flex;flex-direction:column;gap:1px;min-width:0")}>
                      <span style={css("font:600 9.5px " + FONT + ";letter-spacing:.2px;color:var(--gray-600);white-space:nowrap")}>AI 배정</span>
                      <span style={css("font:700 11.5px " + FONT + ";color:var(--gray-1000);white-space:nowrap")}>확신도</span>
                    </div>
                  </div>
                  <div
                    title={vm.prepVerified ? "본인인증 완료 — 고객 상세 조회가 열립니다" : "본인인증 미완료 — 연결 직후 확인하세요"}
                    style={css("flex:2;min-width:0;border-radius:10px;padding:10px 10px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:3px;border:1px solid " + (vm.prepVerified ? "var(--green-700)" : "var(--amber-700)"))}
                  >
                    <span className="mi" style={css("font-size:22px;flex:none;color:" + (vm.prepVerified ? "var(--green-700)" : "var(--amber-700)"))}>{vm.prepVerified ? "lock_open" : "lock"}</span>
                    <span style={css("font:700 11px " + FONT + ";white-space:nowrap;color:" + (vm.prepVerified ? "var(--green-900)" : "var(--amber-900)"))}>인증 {vm.prepVerified ? "완료" : "미완료"}</span>
                  </div>
                </div>

                {/* 사고 징후 — 좌측 하단 빈 공간을 채운다(flex로 우측 요약과 높이 맞춤, 위험 시 붉게) */}
                {(() => { const risk = vm.prepRiskLabel === "높음"; return (
                <div style={css("flex:1;min-height:66px;border-radius:10px;padding:12px 14px;display:flex;flex-direction:column;justify-content:center;gap:6px;border:1px solid " + (risk ? "var(--red-700)" : "var(--gray-300)") + ";background:" + (risk ? "var(--red-800)" : "var(--onair-surface)"))}>
                  <div style={css("font:600 10px " + FONT + ";letter-spacing:.2px;color:" + (risk ? "rgba(255,255,255,.8)" : "var(--gray-600)"))}>사고 징후 · 위험도</div>
                  <div style={css("display:flex;align-items:center;gap:9px")}>
                    <span style={css("width:10px;height:10px;border-radius:9999px;flex:none;background:" + (risk ? "#fff" : "var(--green-700)"))} />
                    <span style={css("font:800 22px/1 " + FONT + ";letter-spacing:-.6px;color:" + (risk ? "#fff" : "var(--gray-1000)"))}>{vm.prepRiskLabel}</span>
                  </div>
                  <div style={css("font:400 11px/1.4 " + FONT + ";color:" + (risk ? "rgba(255,255,255,.85)" : "var(--gray-600)"))}>{vm.prepRiskSignal}</div>
                </div>
                ); })()}
              </div>

              {/* ── 우: 전화 요약 (가장 큰 비중) ── */}
              <div style={css("flex:1;min-width:0;align-self:stretch;display:flex;flex-direction:column;border:1.5px solid var(--blue-700);border-radius:10px;padding:16px 18px")}>
                <div style={css("display:flex;align-items:center;gap:5px;font:600 10.5px " + FONT + ";color:var(--gray-600);margin-bottom:8px")}>
                  <span className="mi" style={css("font-size:14px;color:var(--blue-700)")}>summarize</span>전화 요약 · 고객 발화 STT
                </div>
                {/* 한 줄 요약 — 짧게 참고용(주인공은 아래 STT 요약 내용) */}
                <div style={css("font:700 14.5px/1.45 " + FONT + ";letter-spacing:-.2px;color:var(--gray-1000)")}>{vm.prepHeadline}</div>
                {/* 근거 발화 — 한 줄로 작게(이탤릭 유지), 아래 구분선 */}
                <div style={css("font:400 11.5px/1.5 " + FONT + ";color:var(--gray-700);margin-top:8px;padding-bottom:11px;border-bottom:1px solid var(--gray-200)")}>
                  근거 발화 · <span style={css("font-style:italic;color:var(--gray-900)")}>“{vm.transcriptQuote}”</span>
                </div>
                {/* STT 요약 불릿 — 이 박스의 주인공. 크고 또렷하게 */}
                <div style={css("flex:1;display:flex;flex-direction:column;gap:11px;margin-top:12px")}>
                  {vm.summaryPoints.map((p, i) => (
                    <div key={i} style={css("display:flex;gap:10px;align-items:baseline")}>
                      <span style={css("flex:none;width:6px;height:6px;border-radius:9999px;background:var(--blue-700);transform:translateY(-2px)")} />
                      <span style={css("font:400 14.5px/1.6 " + FONT + ";color:var(--gray-1000)")}>{p}</span>
                    </div>
                  ))}
                </div>
                {/* 핵심 니즈 키워드 — 요약 맨 아래 */}
                <div style={css("display:flex;align-items:center;flex-wrap:wrap;gap:6px;margin-top:12px;padding-top:10px;border-top:1px solid var(--gray-200)")}>
                  <span style={css("font:500 9.5px " + FONT + ";letter-spacing:.2px;color:var(--gray-500);margin-right:2px")}>핵심 니즈</span>
                  {vm.prepNeedTags.map((t, i) => (
                    <span key={i} style={css("font:500 10.5px " + FONT + ";color:var(--gray-700);border:1px solid var(--gray-300);border-radius:9999px;padding:2px 9px")}>{t}</span>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* ── 하단 액션 ── */}
          <div style={css("flex:none;display:flex;align-items:center;gap:12px;padding:11px 22px;border-top:1px solid var(--gray-200)")}>
            <span style={css("display:flex;align-items:center;gap:5px;font:400 12px " + FONT + ";color:var(--gray-700)")}>
              <span className="mi" style={css("font-size:16px")}>info</span> {vm.prepHint}
            </span>
            <div style={css("flex:1")} />
            <span data-tour="prep-connect" onClick={vm.answerCall} style={css("padding:10px 26px;background:" + vm.connectBg + ";color:" + vm.connectFg + ";border-radius:9999px;font-weight:700;font-size:14px;display:flex;align-items:center;gap:6px;cursor:" + vm.connectCursor + ";transition:background .15s")}>
              <span className="mi" style={css("font-size:18px")}>call</span> 통화 연결
            </span>
          </div>
        </div>

        {/* ── 스크립트 패널 ── 오프닝 한 줄(감정온도 연동) + 펼치면 전체 */}
        <div data-tour="prep-firstline" style={css("width:100%;background:var(--onair-surface);border-radius:12px;box-shadow:var(--sh-near);overflow:hidden")}>
          <div onClick={() => setScriptOpen((v) => !v)} style={css("display:flex;align-items:center;gap:11px;padding:9px 18px;cursor:pointer;user-select:none")}>
            <span style={css("display:inline-flex;align-items:center;justify-content:center;width:23px;height:23px;border-radius:9999px;background:var(--gray-1000);color:#fff;flex:none")}><span className="mi" style={css("font-size:14px")}>record_voice_over</span></span>
            <span style={css("font:700 10px " + FONT + ";color:var(--gray-700);flex:none;white-space:nowrap")}>이 문장으로 여세요</span>
            <div style={css("flex:1;min-width:0;font:500 13.5px/1.35 Georgia,'Noto Serif KR','Apple SD Gothic Neo',serif;color:var(--gray-1000);white-space:nowrap;overflow:hidden;text-overflow:ellipsis")}>{vm.firstLine}</div>
            <span style={css("display:flex;align-items:center;gap:4px;font:600 12px " + FONT + ";color:var(--blue-700);flex:none")}>
              {scriptOpen ? "접기" : "펼쳐 보기"}
              <span className="mi" style={css("font-size:19px;transition:transform .25s;transform:rotate(" + (scriptOpen ? 180 : 0) + "deg)")}>expand_more</span>
            </span>
          </div>
          {scriptOpen && (
            <div style={css("padding:2px 20px 18px;display:flex;flex-direction:column;gap:9px;max-height:250px;overflow:auto")}>
              <div style={css("font:600 10.5px " + FONT + ";color:var(--gray-600);padding:2px 2px 4px")}>상담 스크립트 · {vm.steps.length}단계 · 통화 연결하면 상담 화면에서도 표시됩니다</div>
              {vm.steps.map((st, i) => (
                <div key={i} style={css("border:1px solid var(--gray-300);border-radius:8px;padding:11px 14px")}>
                  <div style={css("font:600 14px " + FONT + ";color:var(--gray-1000);margin-bottom:4px")}>{st.title}</div>
                  <div style={css("font:400 13.5px/1.6 " + FONT + ";color:var(--gray-900)")}>{st.text}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </DesktopShell>
  );
}

/** AI 배정 확신도 — 도넛. 값이 없으면 트랙만 그린다. */
function ConfidenceDonut({ pct, known }: { pct: number; known: boolean }) {
  const r = 17;
  const c = 2 * Math.PI * r;
  const on = Math.max(0, Math.min(100, pct));
  return (
    <svg viewBox="0 0 44 44" width="46" height="46" style={{ display: "block", flex: "none" }} aria-hidden="true">
      <circle cx="22" cy="22" r={r} fill="none" stroke="var(--gray-300)" strokeWidth="5" />
      {known && (
        <circle
          cx="22"
          cy="22"
          r={r}
          fill="none"
          stroke="var(--blue-700)"
          strokeWidth="5"
          strokeLinecap="round"
          strokeDasharray={`${(c * on) / 100} ${c}`}
          transform="rotate(-90 22 22)"
        />
      )}
      <text x="22" y="26" textAnchor="middle" style={{ font: "800 14px 'Avenir Next',sans-serif", fill: "var(--gray-1000)" }}>
        {known ? on : "--"}
      </text>
    </svg>
  );
}

