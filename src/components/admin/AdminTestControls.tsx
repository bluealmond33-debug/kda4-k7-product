import { css } from "../../lib/css";
import { TEST_CALLS } from "../../data/adminContent";
import { SGE_META, type Sge } from "../../services";
import { cancelTestCalls, playTestCall } from "../../services/adminScenario";

/** [F] 테스트 콜 — 상담사 탭 없이 대시보드 단독으로 파이프라인 전체를 재생한다.
 *  라이브 콜과 같은 demoBus 경로를 타므로 수신·렌더 분기가 없다. */
export default function AdminTestControls({ onResetAll }: { onResetAll: () => void }) {
  const btn = (sge: Sge) => {
    const meta = SGE_META[sge];
    return (
      <span
        key={sge}
        onClick={() => playTestCall(sge)}
        style={css(
          "display:inline-flex;align-items:center;gap:7px;border-radius:9999px;padding:9px 16px;font:600 12.5px 'Geist Sans','Pretendard',sans-serif;color:#fff;cursor:pointer;transition:filter .15s;background:" +
            meta.bar
        )}
      >
        <span className="mi" style={css("font-size:16px")}>phone_in_talk</span>
        {sge} · {TEST_CALLS[sge].label}
      </span>
    );
  };

  return (
    <div className="card" style={css("display:flex;align-items:center;gap:10px;padding:14px 20px")}>
      <span style={css("display:flex;flex-direction:column;gap:2px;margin-right:6px")}>
        <span className="sechd">테스트 콜</span>
        <span style={css("font:400 10.5px 'Geist Sans','Pretendard',sans-serif;color:var(--gray-600)")}>단독 시연 · 실데모와 같은 이벤트 경로</span>
      </span>
      {(["S", "G", "E"] as const).map(btn)}
      <span style={css("width:1px;height:26px;background:var(--gray-200);margin:0 4px")} />
      <span
        onClick={() => {
          cancelTestCalls();
          onResetAll();
        }}
        style={css("display:inline-flex;align-items:center;gap:6px;border-radius:9999px;padding:9px 15px;font:600 12.5px 'Geist Sans','Pretendard',sans-serif;background:var(--gray-100);color:var(--gray-900);cursor:pointer")}
      >
        <span className="mi" style={css("font-size:16px")}>restart_alt</span>대시보드 초기화
      </span>
    </div>
  );
}
