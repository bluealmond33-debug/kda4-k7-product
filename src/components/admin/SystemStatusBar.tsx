import { css } from "../../lib/css";
import { SGE_META, type Sge } from "../../services";
import { cancelTestCalls, playTestCall } from "../../services/adminScenario";

/** 상단 플로팅 알약 — 직원 화면 제어 알약과 같은 규격·같은 역할 분담:
 *  왼쪽 = 정체성(타이틀), 오른쪽 = 시연 리모컨(테스트 콜·초기화)과 모드.
 *  시스템 램프는 프로세스 플로우 왼쪽 레일로, 동시 처리는 플로우 헤더로,
 *  감정모델 배지는 지식베이스 패널로 — 각자 제자리. */
export default function SystemStatusBar({
  explain,
  onToggleExplain,
  onOpenPolicy,
  onResetAll,
}: {
  explain: boolean;
  onToggleExplain: () => void;
  onOpenPolicy: () => void;
  onResetAll: () => void;
}) {

  // 시연 리모컨 — 색 테두리(가는 선) 버튼. ONAIR: 색은 점·글자·가는 요소에만 — 1.5px 선이 그 '가는 요소'
  const testBtn = (sge: Sge) => {
    const meta = SGE_META[sge];
    return (
      <span
        key={sge}
        onClick={() => playTestCall(sge)}
        title={`${sge} · ${meta.label} 테스트 콜 재생`}
        style={css(
          "flex:none;white-space:nowrap;display:inline-flex;align-items:center;border-radius:9999px;padding:5px 12px;font:700 12px 'Avenir Next','Geist Sans','Pretendard',sans-serif;cursor:pointer;background:var(--onair-surface);border:1.5px solid " +
            meta.bar +
            ";color:" +
            meta.fg
        )}
      >
        {sge} {meta.label}
      </span>
    );
  };

  return (
    <div style={css("display:flex;align-items:center;gap:11px;background:var(--onair-surface);border-radius:9999px;padding:10px 12px 10px 22px;box-shadow:0 10px 34px rgba(0,0,0,.28);white-space:nowrap")}>
      {/* 타이틀 — 이 화면의 정체는 '관제'. 시스템 램프는 프로세스 플로우 왼쪽 레일로 이관 */}
      <span>
        <span style={css("display:block;font:700 13px 'Avenir Next','Geist Sans','Pretendard',sans-serif;color:var(--gray-1000);letter-spacing:-.2px;line-height:1.15")}>관제 대시보드</span>
        <span style={css("display:block;font:500 8.5px 'Geist Mono',monospace;color:var(--gray-700);letter-spacing:.4px")}>LIVE OPERATIONS</span>
      </span>

      <span style={css("width:1px;height:20px;background:var(--color-border)")} />

      {/* 테스트 콜 — 나열은 심각도 우선 E→G→S (피드 범례·부서 칩과 동일 규약) */}
      <span style={css("font:600 12px 'Avenir Next','Geist Sans','Pretendard',sans-serif;color:var(--gray-700)")}>테스트 콜</span>
      {(["E", "G", "S"] as const).map(testBtn)}
      <span
        className="cbtn"
        title="대시보드 초기화"
        onClick={() => {
          cancelTestCalls();
          onResetAll();
        }}
        style={{ width: 30, height: 30 }}
      >
        <span className="mi" style={css("font-size:16px")}>restart_alt</span>
      </span>

      <span style={css("width:1px;height:20px;background:var(--color-border)")} />

      {/* 분류 정책 */}
      <span
        onClick={onOpenPolicy}
        style={css("display:inline-flex;align-items:center;gap:5px;border:1px solid var(--color-border);border-radius:9999px;padding:6px 13px;font:600 12.5px 'Avenir Next','Geist Sans','Pretendard',sans-serif;color:var(--gray-900);cursor:pointer;background:var(--onair-surface)")}
      >
        <span className="mi" style={css("font-size:15px")}>rule</span>분류 정책
      </span>

      {/* 설명 모드 — 발표에서 "이래서 이렇게 연결된다"를 켜는 스위치 */}
      <span
        onClick={onToggleExplain}
        style={css(
          "display:inline-flex;align-items:center;gap:5px;border-radius:9999px;padding:6px 13px;font:600 12.5px 'Avenir Next','Geist Sans','Pretendard',sans-serif;cursor:pointer;transition:background .2s,color .2s;" +
            (explain
              ? "background:var(--blue-700);color:#fff"
              : "background:var(--onair-surface);border:1px solid var(--color-border);color:var(--gray-900)")
        )}
      >
        <span className="mi" style={css("font-size:15px")}>tips_and_updates</span>설명 모드
      </span>
    </div>
  );
}
