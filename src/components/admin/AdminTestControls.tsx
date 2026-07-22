import { css } from "../../lib/css";
import { SGE_META, type Sge } from "../../services";
import { cancelTestCalls, playTestCall } from "../../services/adminScenario";

/** [F] 테스트 콜 — 상담사 탭 없이 대시보드 단독으로 파이프라인 전체를 재생한다.
 *  라이브 콜과 같은 demoBus 경로를 타므로 수신·렌더 분기가 없다.
 *  버튼은 S/G/E 틴트 칩 문법(부서 카드 칩과 동일) — 솔리드 컬러는 신호에 양보한다. */
export default function AdminTestControls({ onResetAll }: { onResetAll: () => void }) {
  const btn = (sge: Sge) => {
    const meta = SGE_META[sge];
    return (
      <span
        key={sge}
        onClick={() => playTestCall(sge)}
        title={`${sge} · ${meta.label} 테스트 콜 재생`}
        style={css(
          "flex:none;white-space:nowrap;display:inline-flex;align-items:center;gap:6px;border-radius:9999px;padding:7px 13px;font:700 12.5px 'Geist Sans','Pretendard',sans-serif;cursor:pointer;background:" +
            meta.bg +
            ";color:" +
            meta.fg
        )}
      >
        <span style={css("width:8px;height:8px;border-radius:2.5px;flex:none;background:" + meta.bar)} />
        {sge} {meta.label}
      </span>
    );
  };

  return (
    <div className="card" style={css("display:flex;align-items:center;gap:9px;padding:12px 16px")}>
      <span style={css("display:flex;flex-direction:column;gap:2px;margin-right:4px;flex:none")}>
        <span className="sechd" style={css("white-space:nowrap")}>테스트 콜</span>
        <span style={css("font:400 10.5px 'Geist Sans','Pretendard',sans-serif;color:var(--gray-700);white-space:nowrap")}>실데모와 같은 이벤트 경로</span>
      </span>
      {/* 나열 순서는 심각도 우선 E→G→S — 피드 범례·부서 칩과 동일 규약 */}
      {(["E", "G", "S"] as const).map(btn)}
      <span style={css("width:1px;height:24px;background:var(--gray-200);margin:0 2px;flex:none")} />
      <span
        className="cbtn"
        title="대시보드 초기화"
        onClick={() => {
          cancelTestCalls();
          onResetAll();
        }}
      >
        <span className="mi" style={css("font-size:18px")}>restart_alt</span>
      </span>
    </div>
  );
}
