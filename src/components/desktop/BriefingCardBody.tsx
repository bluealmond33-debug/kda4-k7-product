import { css } from "../../lib/css";
import type { CallFlowVM } from "../../hooks/useCallFlow";
import { BRAND_LOCKUP_PNG, BRAND_LOCKUP_RATIO } from "../../assets/brandLockup";
import EmotionBar from "./EmotionBar";

const FONT = "'Avenir Next','Pretendard',sans-serif";

/** KARI-NA 브리핑 카드 본문 — 접수(PrepCard 모달)와 통화(ActiveCall 중앙)에서 '똑같은' 디자인으로 공유한다.
 *  상단: 로고(좌) · 이번 상담 유의 칩(우). 좌: 감정온도 → 부서/업무코드(클릭=이관 예약) → 확신도+인증.
 *  우: 전화 요약(가장 큰 비중) — 한 줄 요약 → 근거 발화 → STT 불릿 → 핵심 니즈.
 *  카드 겉면(.card border/radius/overflow)은 부모가 씌운다 — 여기는 헤더+본문만. */
export default function BriefingCardBody({
  vm,
  showAuth = true,
  arriving = false,
}: {
  vm: CallFlowVM;
  showAuth?: boolean;
  /** 카드가 막 날아와 안착하는 중(접수 화면). 라우팅 체인이 순서대로 점등된다.
   *  통화 화면에서는 카드가 이미 자리에 있으므로 켜지 않는다 — 매번 깜빡이면 잔소리가 된다. */
  arriving?: boolean;
}) {
  // 부서 → 업무코드 순으로 켜진다. 카드 이동이 끝나갈 무렵(0.5s)부터 차례로.
  const chain = (order: number) =>
    arriving ? ";animation:chainLight .5s ease-out " + (0.5 + order * 0.16) + "s both" : "";
  const reservedDept = vm.transferReserved ? vm.transferTarget ?? vm.suggestedDept : null;
  const confPct = vm.prepConfidencePct ?? 0;

  return (
    <>
      {/* ── 상단 ── 로고+설명(좌) / AI 정확도(우).
          카드의 '표지'다 — 본문보다 두껍게 두고 로고를 크게 세워 어떤 카드인지 먼저 읽히게 한다. */}
      <div style={css("flex:none;padding:13px 22px;border-bottom:1px solid var(--gray-200);display:flex;align-items:center;gap:13px")}>
        {/* 공식 아트워크 락업 — CSS로 조판한 글자가 아니라 실제 로고 이미지다(자간·자형 그대로).
            카드에서 가장 먼저 읽혀야 하는 건 "이게 KARI-NA 카드"라는 사실이라 로고를 키웠다.
            19px에서는 심볼이 점처럼 보이고 워드마크가 뭉쳐 무슨 글자인지 안 읽혔다. */}
        <img
          src={BRAND_LOCKUP_PNG}
          alt="KARI-NA"
          style={{ display: "block", flex: "none", height: 27, width: 27 * BRAND_LOCKUP_RATIO }}
        />
        {/* 워드마크 오른쪽에 가는 선 하나 두고 설명을 잇는다 — 한 줄로 눕히면 헤더가 훨씬 얇아진다 */}
        <span style={css("flex:none;width:1px;height:17px;background:var(--gray-300)")} />
        <span style={css("font:600 11.5px " + FONT + ";letter-spacing:.2px;color:var(--gray-600);white-space:nowrap")}>카드 브리핑 요약</span>
        <div style={css("flex:1")} />
        {/* AI 정확도 — 도넛을 뺐다. 22px 고리는 94라는 값을 더 잘 읽히게 하지 못하면서
            헤더에 원 하나를 더 얹을 뿐이었다. %를 붙이면 '100점 만점 중 94'가 기호로 끝난다. */}
        <div title={vm.prepConfidence} style={css("flex:none;display:flex;align-items:baseline;gap:7px")}>
          <span style={css("font:600 10.5px " + FONT + ";letter-spacing:.2px;color:var(--gray-600);white-space:nowrap")}>AI 정확도</span>
          <span style={css("font:800 17px/1 " + FONT + ";letter-spacing:-.4px;font-variant-numeric:tabular-nums;color:var(--gray-1000)")}>
            {vm.prepConfidencePct != null ? confPct : "--"}
            <span style={css("font:700 11.5px " + FONT + ";margin-left:1px;color:var(--gray-700)")}>%</span>
          </span>
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
              </div>
              <div style={css("display:flex;align-items:center;gap:9px")}>
                {/* 표정 — 숫자보다 얼굴이 먼저 읽힌다 */}
                <span className="mi" style={css("font-size:34px;line-height:1;color:" + vm.prepEmotionBar)}>{vm.prepEmotionFace}</span>
                <span style={css("display:flex;align-items:baseline;gap:6px")}>
                  <span style={css("font:600 32px/1 " + FONT + ";letter-spacing:-1.4px;font-variant-numeric:tabular-nums;color:" + vm.prepEmotionBar)}>{vm.prepTempC != null ? vm.prepTempC.toFixed(1) : "--"}<span style={css("font:500 18px " + FONT + ";margin-left:1px")}>°</span></span>
                  <span style={css("font:700 12.5px " + FONT + ";color:" + vm.prepEmotionBar)}>{vm.prepEmotionLabel}</span>
                </span>
              </div>
              {/* 접수 화면(Waiting)과 같은 축·같은 마커 — 두 화면이 다른 감정온도 그림을 쓰면
                  같은 값을 두 번 배워야 한다. 마커는 원이 아니라 페이더 썸(EmotionBar 참조) */}
              <EmotionBar
                height={7}
                pct={vm.prepTempC != null ? vm.prepTempPct : vm.prepTempBasePct}
                color={vm.prepEmotionBar}
              />
            </div>

            {/* 배정 부서 → 업무코드 — 감정온도 아래. 읽기 전용이다:
                이관은 별도 버튼(접수=하단 '이관', 통화=음소거 왼쪽 원형 버튼)이 맡는다.
                예약이 걸리면 여기가 파랗게 채워져 '어디로 갈지'를 보여준다. */}
            <div style={css("position:relative")}>
              <div title={reservedDept ? "이관 예약됨 — 종료 시 " + reservedDept + "로" : "AI 배정 결과"} style={css("display:flex;align-items:center;gap:8px;border-radius:10px;padding:9px 12px;border:1px solid " + (reservedDept ? "var(--blue-700)" : "var(--gray-300)") + ";background:" + (reservedDept ? "var(--blue-700)" : "var(--onair-surface)"))}>
                <div style={css("flex:1;min-width:0;display:flex;flex-direction:column;gap:4px")}>
                  <div style={css("display:flex;align-items:baseline;gap:7px")}>
                    <span style={css("font:600 8.5px " + FONT + ";letter-spacing:.4px;flex:none;width:28px;color:" + (reservedDept ? "rgba(255,255,255,.7)" : "var(--gray-600)"))}>부서</span>
                    <span style={css("font:700 12px " + FONT + ";overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:" + (reservedDept ? "#fff" : "var(--gray-1000)") + chain(0))}>{reservedDept ?? vm.prepRoutingTitle}</span>
                  </div>
                  <div style={css("display:flex;align-items:baseline;gap:7px;min-width:0")}>
                    <span style={css("font:600 8.5px " + FONT + ";letter-spacing:.4px;flex:none;width:28px;color:" + (reservedDept ? "rgba(255,255,255,.7)" : "var(--gray-600)"))}>업무</span>
                    {/* 분류 실패(routing=null)는 숨기지 않는다 — 코드 자리를 '미분류'로 비워 두면
                        상담사가 스스로 업무를 판단해야 한다는 걸 알 수 있다. 예전처럼 기본값을
                        찍으면 틀린 코드를 맞는 코드로 착각한다. */}
                    <span style={css("font:800 12px " + FONT + ";letter-spacing:.3px;flex:none;color:" + (reservedDept ? "#fff" : vm.prepBusinessCode ? "var(--gray-1000)" : "var(--gray-600)") + chain(1))}>
                      {vm.prepBusinessCode ?? "미분류"}
                    </span>
                    <span style={css("font:600 10.5px " + FONT + ";overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:" + (reservedDept ? "rgba(255,255,255,.85)" : "var(--gray-700)"))}>
                      {vm.prepBusinessCodeLabel ?? "자동 분류 실패 · 직접 확인"}
                    </span>
                  </div>
                </div>
                {reservedDept && <span className="mi" style={css("font-size:16px;flex:none;color:#fff")}>sync_alt</span>}
              </div>
            </div>

            {/* 상담 유의사항 — 통화 전 스치듯 훑는 가드레일. 헤더에 있던 칩을 여기로 내렸다
                (헤더 우측은 AI 정확도 자리). 체크 조작은 없다 — 읽기만 하는 목록. */}
            <div data-tour="prep-checks" style={css("border:1px solid var(--gray-300);border-radius:10px;padding:11px 13px;display:flex;flex-direction:column;gap:7px")}>
              <span style={css("font:600 10px " + FONT + ";letter-spacing:.2px;color:var(--gray-600)")}>상담 유의사항</span>
              {vm.prepRows.map((r, i) => (
                <div key={i} style={css("display:flex;gap:7px;align-items:flex-start")}>
                  <span className="mi" style={css("font-size:14px;flex:none;color:var(--green-700);transform:translateY(1px)")}>check</span>
                  <span style={css("font:600 11.5px/1.45 " + FONT + ";color:var(--gray-1000);word-break:keep-all")}>{r.title}</span>
                </div>
              ))}
            </div>

            {/* 본인인증 — 통화 화면(showAuth=false)에선 감춘다.
                미완료는 회색으로 조용히 둔다: '아직 안 된 상태'지 경고가 아니다. 완료만 초록으로 신호. */}
            {showAuth && (
              <div
                title={vm.prepVerified ? "본인인증 완료 — 고객 상세 조회가 열립니다" : "본인인증 미완료 — 연결 직후 확인하세요"}
                style={css("border-radius:10px;padding:9px 12px;display:flex;align-items:center;gap:8px;border:1px solid " + (vm.prepVerified ? "var(--green-700)" : "var(--gray-400)"))}
              >
                <span className="mi" style={css("font-size:19px;flex:none;color:" + (vm.prepVerified ? "var(--green-700)" : "var(--gray-600)"))}>{vm.prepVerified ? "lock" : "lock_open"}</span>
                <span style={css("font:700 11.5px " + FONT + ";white-space:nowrap;color:" + (vm.prepVerified ? "var(--green-900)" : "var(--gray-800)"))}>인증 {vm.prepVerified ? "완료" : "미완료"}</span>
              </div>
            )}

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

