import { useEffect, useRef, useState } from "react";
import { css } from "../../lib/css";
import type { CallFlowVM } from "../../hooks/useCallFlow";
import DesktopShell from "./DesktopShell";
import BriefingCardBody from "./BriefingCardBody";
import ScriptTimeline from "./ScriptTimeline";

const FONT = "'Avenir Next','Pretendard',sans-serif";

/** 카드를 띄워 놓고 전화를 받지 않는 사고를 막는 안전장치 — 이 초가 지나면 자동 연결된다.
 *  동시에 상담사에게 "이 안에 카드를 읽고 들어가야 한다"는 리듬을 준다. */
const AUTO_CONNECT_SEC = 15;

/** 자동 연결 카운트다운 — 준비 카드가 떠 있는 동안만 돈다.
 *
 *  왜 자동으로 연결하나: 카드가 올라왔는데 상담사가 통화 연결을 잊으면 고객은 계속 기다린다.
 *  그건 이 제품이 없애려는 바로 그 손실이라 사람 손에만 맡기지 않는다.
 *  왜 남은 초를 보여주나: 보이면 "지금 읽고 들어가야 한다"가 몸으로 느껴진다.
 *
 *  연결 불가 상태(체크 미완·요약 대기)에서는 세지 않고 멈춰 기다린다 — 그때 0이 되면
 *  answerCall이 조용히 무시돼 '자동 연결됐다고 착각하는' 더 나쁜 사고가 된다. */
function useAutoConnect(vm: CallFlowVM) {
  const [left, setLeft] = useState(AUTO_CONNECT_SEC);
  const canConnect = vm.canConnect;

  /* answerCall을 ref로 들고 있는다 — 이 훅의 의존성에 vm을 넣으면 안 된다.
     vm은 useCallFlow가 매 렌더 새로 만드는 객체라, 의존성에 두면 **렌더마다 effect가 다시
     돌아 1초 타이머가 계속 리셋된다.** 이 화면은 시계·마이크 레벨 때문에 초당 여러 번
     리렌더되므로 타이머가 한 번도 끝나지 못하고, 카운트다운이 영원히 멈춰 있었다. */
  const answerRef = useRef(vm.answerCall);
  answerRef.current = vm.answerCall;

  useEffect(() => {
    if (!canConnect) return; // 연결 가능해질 때까지 남은 초를 그대로 붙잡고 기다린다
    if (left <= 0) {
      answerRef.current();
      return;
    }
    const id = window.setTimeout(() => setLeft((s) => s - 1), 1000);
    return () => window.clearTimeout(id);
  }, [canConnect, left]);

  return {
    left: Math.max(0, left),
    /** 남은 비율 0~1 — 버튼 안에서 줄어드는 띠의 길이 */
    pct: Math.max(0, Math.min(1, left / AUTO_CONNECT_SEC)),
    /** 마지막 5초 — 서두르라는 신호 */
    urgent: left <= 5,
    counting: canConnect,
  };
}

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
  const auto = useAutoConnect(vm);

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
            <span style={css("display:flex;align-items:center;gap:5px;font:400 12px " + FONT + ";color:var(--gray-700)")}>
              <span className="mi" style={css("font-size:16px")}>info</span> {vm.prepHint}
            </span>
            <div style={css("flex:1")} />

            {/* 이관 — 통화 연결 왼쪽의 독립 버튼. 통화 화면(ActiveCall)에서 음소거 왼쪽에 두는
                이관 버튼과 같은 자리·같은 역할이라, 두 화면의 손이 같은 곳을 찾는다.
                카드 하단이라 드롭다운은 위로 편다. */}
            <div style={css("position:relative;flex:none")}>
              <span
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
              onClick={vm.answerCall}
              title={
                auto.counting
                  ? `${auto.left}초 뒤 자동으로 연결됩니다`
                  : "요약·확인이 끝나면 자동 연결 카운트다운이 시작됩니다"
              }
              style={css(
                "position:relative;overflow:hidden;padding:10px 14px 10px 22px;background:" +
                  vm.connectBg +
                  ";color:" +
                  vm.connectFg +
                  ";border-radius:9999px;font-weight:700;font-size:14px;display:flex;align-items:center;gap:10px;cursor:" +
                  vm.connectCursor +
                  ";transition:background .15s;white-space:nowrap"
              )}
            >
              <span style={css("display:flex;align-items:center;gap:6px")}>
                <span className="mi" style={css("font-size:18px")}>call</span> 통화 연결
              </span>
              {/* 남은 초 — 숫자만 줄어든다. 바닥 띠·숫자 배경을 뺐다: 버튼 안에 띠와 알약까지
                  들어가면 장식이 셋이라 정작 읽어야 하는 숫자가 묻히고, 줄어드는 선은 오류
                  표시로 오해되기도 했다. 마지막 5초만 숫자가 굵고 밝아진다. */}
              <span
                style={css(
                  "font-variant-numeric:tabular-nums;letter-spacing:-.2px;transition:opacity .3s,font-size .3s;font-size:" +
                    (auto.urgent ? "16px" : "14px") +
                    ";opacity:" +
                    (auto.counting ? (auto.urgent ? "1" : ".72") : ".45")
                )}
              >
                {auto.left}
              </span>
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
            <div style={css("font:500 15px/1.65 Georgia,'Noto Serif KR','Apple SD Gothic Neo',serif;color:var(--gray-1000);word-break:keep-all")}>{vm.firstLine}</div>
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

