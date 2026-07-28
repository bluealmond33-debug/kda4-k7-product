import { useState } from "react";
import { css } from "../../lib/css";
import type { CallFlowVM } from "../../hooks/useCallFlow";
import DesktopShell from "./DesktopShell";
import BriefingCardBody from "./BriefingCardBody";
import ScriptTimeline from "./ScriptTimeline";
import { KEYS, KeyHint, useShortcuts } from "../../lib/shortcuts";

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

  /* 준비 카드 단축키 — 통화 연결(C)과 이관(T). 전화를 받기 직전이라 손이 마우스에
     가 있지 않을 수 있다. 연결 불가 상태에서는 C를 먹지 않는다(조용히 무시되면
     '눌렀는데 왜 안 되지'가 된다 — 아예 배선하지 않는다). */
  useShortcuts({
    [KEYS.connect]: vm.canConnect ? vm.answerCall : undefined,
    [KEYS.transfer]: () => setTransferMenu((v) => !v),
  });

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

      {/* 등장(F1) — 좌하단에서 커지며 중앙으로 날아와 잠깐 멈췄다 안착한다.
          "AI가 분류해서 이 카드를 나에게 보냈다"를 문장이 아니라 움직임으로 말한다. */}
      <div style={css("position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);display:flex;flex-direction:column;align-items:center;gap:10px;width:760px;max-width:95%;animation:cardArrive .9s cubic-bezier(0.2,0.8,0.2,1) both")}>
        <div style={css("position:relative;width:100%")}>
          <div data-tour="prep-card" style={css("width:100%;max-height:620px;background:var(--onair-surface);border-radius:12px;box-shadow:var(--sh-modal);overflow:hidden;display:flex;flex-direction:column")}>

          <BriefingCardBody vm={vm} arriving />

          {/* ── 하단 액션 ── */}
          <div style={css("flex:none;display:flex;align-items:center;gap:12px;padding:11px 22px;border-top:1px solid var(--gray-200)")}>
            {vm.customerEnded ? (
              /* 고객이 먼저 끊은 카드 — 지우지 않는다. 접수는 끝났고 담당자가 콜백할 건이라,
                 카드를 지우면 그 사실까지 지워진다. 지금 무엇을 해야 하는지만 바꿔 말한다. */
              <span style={css("display:flex;align-items:center;gap:6px;font:600 12.5px " + FONT + ";color:var(--red-900)")}>
                <span className="mi" style={css("font-size:17px")}>call_end</span>
                고객이 통화를 종료했습니다 · 콜백 대상
              </span>
            ) : (
              <span style={css("display:flex;align-items:center;gap:5px;font:400 12px " + FONT + ";color:var(--gray-700)")}>
                <span className="mi" style={css("font-size:16px")}>info</span> {vm.prepHint}
              </span>
            )}
            <div style={css("flex:1")} />

            {/* 이관 — 통화 연결 왼쪽의 독립 버튼. 통화 화면(ActiveCall)에서 음소거 왼쪽에 두는
                이관 버튼과 같은 자리·같은 역할이라, 두 화면의 손이 같은 곳을 찾는다.
                카드 하단이라 드롭다운은 위로 편다. */}
            <div style={css("position:relative;flex:none")}>
              <span
                className="keyreveal"
                onClick={() => setTransferMenu((v) => !v)}
                title={reservedDept ? "이관 예약됨 — 종료 시 " + reservedDept + "로" : "다른 부서로 이관 — 종료 시 예약"}
                style={css(
                  "padding:10px 20px;border-radius:9999px;font-weight:700;font-size:14px;display:flex;align-items:center;gap:6px;cursor:pointer;user-select:none;transition:background .15s;white-space:nowrap;" +
                    (reservedDept
                      ? "background:var(--blue-700);color:#fff;border:1px solid var(--blue-700)"
                      : "background:var(--onair-surface);color:var(--gray-900);border:1px solid var(--gray-400)")
                )}
              >
                <span className="mi" style={css("font-size:18px")}>sync_alt</span>
                {reservedDept ? "이관 · " + reservedDept : "이관"}
                {/* 화살표 — 누르면 창이 열린다는 신호. 열리면 뒤집혀 상태를 말한다 */}
                <span className="mi" style={css("font-size:17px;margin-left:-1px;transition:transform .2s;transform:rotate(" + (transferMenu ? 180 : 0) + "deg)")}>expand_more</span>
                <KeyHint k={KEYS.transfer} tone={reservedDept ? "on" : "off"} />
              </span>
              {transferMenu && (
                <>
                  <span onClick={() => setTransferMenu(false)} style={css("position:fixed;inset:0;z-index:40")} />
                  {/* 팝오버 — 꼬리(caret)로 이관 버튼과 이어 붙여 '이 버튼에서 나온 창'으로 읽히게 한다.
                      꼬리가 잘리면 안 되므로 overflow:hidden은 안쪽 패널에만 건다. */}
                  <div style={css("position:absolute;right:0;bottom:calc(100% + 10px);z-index:41;width:262px")}>
                    <div style={css("background:var(--onair-surface);border-radius:10px;box-shadow:var(--sh-modal);overflow:hidden")}>
                      <div style={css("padding:9px 13px 7px;font:700 10.5px " + FONT + ";color:var(--gray-700);border-bottom:1px solid var(--gray-200)")}>어느 부서로 넘길까요 · 종료 시 이관</div>
                      {/* AI 추천 행은 두지 않는다 — 이 버튼을 눌렀다는 건 상담원이 'AI가 우리 부서로 보낸 게
                          틀렸다'고 판단했다는 뜻이다. 그 자리에서 again AI 추천을 내미는 건 앞뒤가 안 맞는다.
                          상담원이 직접 고르는 목록만 남긴다. */}
                      {vm.transferDepts.map((d) => (
                        <div key={d.name} onClick={() => { vm.reserveTransfer(d.name); setTransferMenu(false); }} className="deptrow" style={css("display:flex;flex-direction:column;gap:1px;padding:9px 13px;cursor:pointer")}>
                          <span style={css("display:flex;align-items:center;gap:6px;font:600 12px " + FONT + ";color:var(--gray-1000)")}>{d.name}<span style={css("font:400 10px " + FONT + ";color:var(--gray-600)")}>{d.state}</span></span>
                          <span style={css("font:400 10.5px " + FONT + ";color:var(--gray-700)")}>{d.desc}</span>
                        </div>
                      ))}
                      {vm.transferReserved && (
                        <div onClick={() => { vm.toggleTransferReserve(); setTransferMenu(false); }} className="deptrow-quiet" style={css("display:flex;align-items:center;gap:6px;padding:9px 13px;cursor:pointer;border-top:1px solid var(--gray-200);color:var(--red-800)")}>
                          <span className="mi" style={css("font-size:15px")}>close</span>
                          <span style={css("font:600 12px " + FONT)}>이관 예약 취소</span>
                        </div>
                      )}
                    </div>
                    {/* 꼬리 — 이관 버튼 가운데를 향해 아래로 뾰족하게 */}
                    <span style={css("position:absolute;right:44px;bottom:-5px;width:11px;height:11px;background:var(--onair-surface);transform:rotate(45deg);border-radius:0 0 2px 0")} />
                  </div>
                </>
              )}
            </div>

            {/* 통화 연결 — 남은 초를 버튼 **안**에 담는다. 버튼 밖에 링을 따로 두면 눈이
                두 군데로 갈리는데, 정작 그 초가 다 되면 눌리는 건 이 버튼이다.
                바닥의 흰 띠가 줄어들며 "이 버튼이 스스로 눌린다"를 말한다. */}
            <span
              data-tour="prep-connect"
              className="keyreveal"
              onClick={vm.answerCall}
              title={vm.canConnect ? "통화를 연결합니다" : "요약·확인이 끝나면 연결할 수 있습니다"}
              style={css(
                "position:relative;overflow:hidden;padding:10px 20px;background:" +
                  vm.connectBg +
                  ";color:" +
                  vm.connectFg +
                  ";border-radius:9999px;font-weight:700;font-size:14px;display:flex;align-items:center;gap:10px;cursor:" +
                  vm.connectCursor +
                  ";transition:background .15s;white-space:nowrap"
              )}
            >
              <span style={css("display:flex;align-items:center;gap:6px")}>
                <span className="mi" style={css("font-size:18px")}>{vm.customerEnded ? "phone_callback" : "call"}</span>{" "}
                {vm.customerEnded ? "콜백 걸기" : "통화 연결"}
              </span>
              {/* 단축키 배지 — 연결 가능할 때만. 못 누르는 상태에서 키를 알려 주면
                  눌러 보고 아무 일도 안 일어나 더 헷갈린다. */}
              {vm.canConnect && <KeyHint k={KEYS.connect} tone="on" />}
            </span>
          </div>
          </div>
          {/* 안착 링 — 카드 도착 직후 테두리에서 한 번 퍼지고 사라진다.
              blur 0인 '선'이라 글로우가 아니다(빛은 칠하지 않는다). 클릭은 통과시킨다. */}
          <span
            aria-hidden="true"
            style={css(
              "position:absolute;inset:0;border-radius:12px;pointer-events:none;animation:ringSettle .7s ease-out .58s both"
            )}
          />
        </div>

        {/* ── 스크립트 패널 ── 오프닝 한 줄(감정온도 연동) + 펼치면 전체 */}
        <div data-tour="prep-firstline" style={css("width:100%;background:var(--onair-surface);border-radius:12px;box-shadow:var(--sh-near);overflow:hidden")}>
          {/* 캡션 줄 → 문장 순서로 쌓는다. 한 줄에 나란히 두면 주인공인 문장이 좁은 칸에 갇혀
              어색하게 접히고, 파란 토글이 정작 읽어야 할 문장보다 먼저 눈에 들어온다.
              토글은 '펼쳐 보기'라는 지시문 대신 뒤에 뭐가 있는지(단계 수)를 알려주고,
              색은 빼서 회색으로 물러난다 — 파랑은 통화 연결 같은 진짜 행동에만 쓴다. */}
          <div onClick={() => setScriptOpen((v) => !v)} style={css("display:flex;flex-direction:column;gap:7px;padding:13px 18px 14px;cursor:pointer;user-select:none")}>
            <div style={css("display:flex;align-items:center;gap:7px")}>
              <span className="mi" style={css("font-size:15px;flex:none;color:var(--gray-600)")}>record_voice_over</span>
              <span style={css("font:600 10.5px " + FONT + ";letter-spacing:.2px;color:var(--gray-600)")}>첫 응대 문장</span>
              <div style={css("flex:1")} />
              <span style={css("display:flex;align-items:center;gap:3px;font:600 10.5px " + FONT + ";color:var(--gray-600);flex:none")}>
                전체 스크립트 {vm.steps.length}단계
                <span className="mi" style={css("font-size:17px;transition:transform .25s;transform:rotate(" + (scriptOpen ? 180 : 0) + "deg)")}>expand_more</span>
              </span>
            </div>
            {/* 문장 — 이 패널의 주인공. 폭을 다 쓰게 두고 크기를 키운다 */}
            <div style={css("font:500 15px/1.65 " + FONT + ";color:var(--gray-1000);word-break:keep-all")}>{vm.firstLine}</div>
          </div>
          {scriptOpen && (
            <div style={css("padding:4px 20px 18px;display:flex;flex-direction:column;max-height:300px;overflow:auto")}>
              {/* 단계 수는 위 토글이 이미 말했다 — 여기선 겹치지 않게 맥락만 */}
              <div style={css("font:600 10.5px " + FONT + ";color:var(--gray-600);padding:2px 2px 10px")}>통화를 연결하면 상담 화면에서도 이어서 표시됩니다</div>
              <ScriptTimeline steps={vm.steps} />
            </div>
          )}
        </div>
      </div>
    </DesktopShell>
  );
}

