import { useState } from "react";
import { css } from "../../lib/css";
import type { CallFlowVM } from "../../hooks/useCallFlow";
import BrandLogo from "../BrandLogo";

const FONT = "'Avenir Next','Pretendard',sans-serif";

/** KARI-NA 브리핑 카드 본문 — 접수(PrepCard 모달)와 통화(ActiveCall 중앙)에서 '똑같은' 디자인으로 공유한다.
 *  상단: 로고(좌) · 이번 상담 유의 칩(우). 좌: 감정온도 → 부서/업무코드(클릭=이관 예약) → 확신도+인증.
 *  우: 전화 요약(가장 큰 비중) — 한 줄 요약 → 근거 발화 → STT 불릿 → 핵심 니즈.
 *  카드 겉면(.card border/radius/overflow)은 부모가 씌운다 — 여기는 헤더+본문만. */
export default function BriefingCardBody({ vm, showAuth = true }: { vm: CallFlowVM; showAuth?: boolean }) {
  const [transferMenu, setTransferMenu] = useState(false);
  const reservedDept = vm.transferReserved ? vm.transferTarget ?? vm.suggestedDept : null;
  const confPct = vm.prepConfidencePct ?? 0;

  return (
    <>
      {/* ── 상단 ── 로고(좌) / 이번 상담 유의 칩(우) */}
      <div style={css("flex:none;padding:12px 22px;border-bottom:1px solid var(--gray-200);display:flex;align-items:center;gap:14px")}>
        <BrandLogo size={17} symbolColor="var(--blue-700)" color="var(--gray-1000)" />
        <div style={css("flex:1")} />
        {/* 이번 상담 유의 — 통화 전 스치듯 확인하는 가드레일. 헤더 우측 칩으로 스캔 빠르게 */}
        <div data-tour="prep-checks" style={css("display:flex;align-items:center;flex-wrap:wrap;justify-content:flex-end;gap:7px")}>
          <span style={css("font:700 10px " + FONT + ";letter-spacing:.2px;color:var(--gray-500);margin-right:1px;flex:none")}>이번 상담 유의</span>
          {vm.prepRows.map((r, i) => (
            <span key={i} style={css("display:inline-flex;align-items:center;gap:5px;font:600 11.5px " + FONT + ";color:var(--gray-1000);border:1px solid var(--gray-400);border-radius:9999px;padding:3px 11px;white-space:nowrap")}>
              <span className="mi" style={css("font-size:14px;color:var(--green-700)")}>check</span>{r.title}
            </span>
          ))}
        </div>
      </div>

      {/* ── 본문 ── */}
      <div style={css("flex:1;overflow:auto;padding:14px 22px 16px;display:flex;flex-direction:column;gap:12px")}>
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
          {/* ── 좌: 감정온도 → 부서/업무 → 확신도·본인인증 ── */}
          <div style={css("flex:none;width:200px;display:flex;flex-direction:column;gap:10px")}>
            {/* 감정온도 — 표정 + 당근식 36.5 기준 온도계 */}
            <div style={css("border:1px solid var(--gray-300);border-radius:10px;padding:13px 14px;display:flex;flex-direction:column;gap:10px")}>
              <div style={css("display:flex;align-items:center;gap:5px")}>
                <span style={css("font:600 10px " + FONT + ";letter-spacing:.2px;color:var(--gray-600)")}>고객 감정온도</span>
                <div style={css("flex:1")} />
                <span title={vm.prepEmotionSourceBadge.isReal ? "실제 AI 감정 모델 판정" : "데모용 값"} style={css("font:600 8px ui-monospace,'SF Mono',Menlo,Consolas,monospace;letter-spacing:.3px;padding:1.5px 5px;border-radius:9999px;border:1px solid var(--gray-300);color:var(--gray-600)")}>{vm.prepEmotionSourceBadge.label}</span>
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

            {/* 배정 부서 → 업무코드 — 감정온도 아래. 클릭 시 이관 드롭다운(종료 시 예약) */}
            <div style={css("position:relative")}>
              <div onClick={() => setTransferMenu((v) => !v)} title="배정 결과 — 클릭하면 다른 부서로 이관(종료 시 예약)" style={css("display:flex;align-items:center;gap:8px;border-radius:10px;padding:9px 12px;cursor:pointer;border:1px solid " + (reservedDept ? "var(--blue-700)" : "var(--gray-300)") + ";background:" + (reservedDept ? "var(--blue-700)" : "var(--onair-surface)"))}>
                <div style={css("flex:1;min-width:0;display:flex;flex-direction:column;gap:4px")}>
                  <div style={css("display:flex;align-items:baseline;gap:7px")}>
                    <span style={css("font:600 8.5px " + FONT + ";letter-spacing:.4px;flex:none;width:28px;color:" + (reservedDept ? "rgba(255,255,255,.7)" : "var(--gray-600)"))}>부서</span>
                    <span style={css("font:700 12px " + FONT + ";overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:" + (reservedDept ? "#fff" : "var(--gray-1000)"))}>{reservedDept ?? vm.prepRoutingTitle}</span>
                  </div>
                  <div style={css("display:flex;align-items:baseline;gap:7px;min-width:0")}>
                    <span style={css("font:600 8.5px " + FONT + ";letter-spacing:.4px;flex:none;width:28px;color:" + (reservedDept ? "rgba(255,255,255,.7)" : "var(--gray-600)"))}>업무</span>
                    <span style={css("font:800 12px " + FONT + ";letter-spacing:.3px;flex:none;color:" + (reservedDept ? "#fff" : "var(--gray-1000)"))}>{vm.prepBusinessCode}</span>
                    <span style={css("font:600 10.5px " + FONT + ";overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:" + (reservedDept ? "rgba(255,255,255,.85)" : "var(--gray-700)"))}>{vm.prepBusinessCodeLabel}</span>
                  </div>
                </div>
                <span className="mi" style={css("font-size:17px;flex:none;color:" + (reservedDept ? "#fff" : "var(--gray-500)") + ";transition:transform .2s;transform:rotate(" + (transferMenu ? 180 : 0) + "deg)")}>expand_more</span>
              </div>
              {transferMenu && (
                <>
                  <span onClick={() => setTransferMenu(false)} style={css("position:fixed;inset:0;z-index:40")} />
                  <div style={css("position:absolute;left:0;right:0;top:calc(100% + 8px);z-index:41;background:var(--onair-surface);border-radius:10px;box-shadow:var(--sh-modal);overflow:hidden")}>
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
            </div>

            {/* 확신도(도넛) [+ 본인인증] — 부서 아래. 통화 화면(showAuth=false)에선 인증을 빼고 확신도가 폭을 채운다 */}
            <div style={css("display:flex;gap:10px")}>
              {/* 확신도 — 도넛+라벨. 인증이 있을 땐 3, 없을 땐 홀로 폭을 채운다 */}
              <div title={vm.prepConfidence} style={css((showAuth ? "flex:3" : "flex:1") + ";min-width:0;border:1px solid var(--gray-300);border-radius:10px;padding:10px 11px;display:flex;align-items:center;gap:10px")}>
                <ConfidenceDonut pct={confPct} known={vm.prepConfidencePct != null} />
                <div style={css("display:flex;flex-direction:column;gap:1px;min-width:0")}>
                  <span style={css("font:600 9.5px " + FONT + ";letter-spacing:.2px;color:var(--gray-600);white-space:nowrap")}>AI 배정</span>
                  <span style={css("font:700 11.5px " + FONT + ";color:var(--gray-1000);white-space:nowrap")}>확신도</span>
                </div>
              </div>
              {showAuth && (
                <div
                  title={vm.prepVerified ? "본인인증 완료 — 고객 상세 조회가 열립니다" : "본인인증 미완료 — 연결 직후 확인하세요"}
                  style={css("flex:2;min-width:0;border-radius:10px;padding:10px 10px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:3px;border:1px solid " + (vm.prepVerified ? "var(--green-700)" : "var(--amber-700)"))}
                >
                  <span className="mi" style={css("font-size:22px;flex:none;color:" + (vm.prepVerified ? "var(--green-700)" : "var(--amber-700)"))}>{vm.prepVerified ? "lock" : "lock_open"}</span>
                  <span style={css("font:700 11px " + FONT + ";white-space:nowrap;color:" + (vm.prepVerified ? "var(--green-900)" : "var(--amber-900)"))}>인증 {vm.prepVerified ? "완료" : "미완료"}</span>
                </div>
              )}
            </div>

          </div>

          {/* ── 우: 전화 요약 (가장 큰 비중) ── */}
          <div style={css("flex:1;min-width:0;align-self:stretch;display:flex;flex-direction:column;border:1.5px solid var(--blue-700);border-radius:10px;padding:11px 18px 14px")}>
            <div style={css("display:flex;align-items:center;gap:5px;font:600 10.5px " + FONT + ";color:var(--gray-600);margin-bottom:5px")}>
              <span className="mi" style={css("font-size:14px;color:var(--blue-700)")}>summarize</span>전화 요약 · 고객 발화 STT
            </div>
            {/* 한 줄 요약 — 제목(크게). 근거 발화는 바로 아래 붙인다 */}
            <div style={css("font:700 17px/1.35 " + FONT + ";letter-spacing:-.3px;color:var(--gray-1000)")}>{vm.prepHeadline}</div>
            {/* 근거 발화 — 제목 바로 밑에 간격 없이(이탤릭 유지), 아래 구분선 */}
            <div style={css("font:400 11.5px/1.4 " + FONT + ";color:var(--gray-700);margin-top:2px;padding-bottom:8px;border-bottom:1px solid var(--gray-200)")}>
              근거 발화 · <span style={css("font-style:italic;color:var(--gray-900)")}>“{vm.transcriptQuote}”</span>
            </div>
            {/* STT 요약 불릿 — 이 박스의 주인공. 크고 또렷하게 */}
            <div style={css("flex:1;display:flex;flex-direction:column;gap:7px;margin-top:9px")}>
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
    </>
  );
}

/** AI 배정 확신도 — 도넛. 값이 없으면 트랙만 그린다. */
export function ConfidenceDonut({ pct, known }: { pct: number; known: boolean }) {
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
