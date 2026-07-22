import { css } from "../../lib/css";
import { SGE_META, type AdminStatus, type Sge } from "../../services";
import { cancelTestCalls, playTestCall } from "../../services/adminScenario";

/** 상단 플로팅 알약 — 직원 화면 제어 알약과 같은 규격·같은 역할 분담:
 *  왼쪽 = 정체성·실측 상태(램프는 /health·RAG 폴링 실측), 오른쪽 = 시연 리모컨(테스트 콜·초기화)과 모드.
 *  동시 처리는 플로우 패널 헤더로, 감정모델 배지는 지식베이스 패널로 옮겨 알약 폭 예산을 지킨다. */
export default function SystemStatusBar({
  status,
  explain,
  onToggleExplain,
  onOpenPolicy,
  onResetAll,
}: {
  status: AdminStatus;
  explain: boolean;
  onToggleExplain: () => void;
  onOpenPolicy: () => void;
  onResetAll: () => void;
}) {
  const offline = status.backend !== "online";
  const lamp = (on: boolean | null) =>
    on === null ? "var(--gray-500)" : on ? "var(--green-700)" : "var(--red-700)";

  const item = (color: string, label: string, value: string) => (
    <span style={css("display:inline-flex;align-items:center;gap:6px")}>
      <span style={css("width:8px;height:8px;border-radius:9999px;flex:none;background:" + color)} />
      <span style={css("font:600 12px 'Geist Sans','Pretendard',sans-serif;color:var(--gray-700)")}>{label}</span>
      <span style={css("font:600 12.5px 'Geist Sans','Pretendard',sans-serif;color:var(--gray-1000)")}>{value}</span>
    </span>
  );

  // 시연 리모컨 — 직원 알약의 '다음 콜' 선택기와 같은 자리. ONAIR: 면은 중립, 색은 점·잉크로만
  const testBtn = (sge: Sge) => {
    const meta = SGE_META[sge];
    return (
      <span
        key={sge}
        onClick={() => playTestCall(sge)}
        title={`${sge} · ${meta.label} 테스트 콜 재생`}
        style={css(
          "flex:none;white-space:nowrap;display:inline-flex;align-items:center;gap:5px;border-radius:9999px;padding:6px 11px;font:700 12px 'Geist Sans','Pretendard',sans-serif;cursor:pointer;background:var(--gray-100);color:" +
            meta.fg
        )}
      >
        <span style={css("width:7px;height:7px;border-radius:9999px;flex:none;background:" + meta.bar)} />
        {sge} {meta.label}
      </span>
    );
  };

  return (
    <div style={css("display:flex;align-items:center;gap:11px;background:var(--onair-surface);border-radius:9999px;padding:10px 12px 10px 22px;box-shadow:0 10px 34px rgba(0,0,0,.28);white-space:nowrap")}>
      {/* 타이틀 — 이 화면의 정체는 '관제': AI 콜센터가 실제로 돌아가는 것을 실시간으로 증명하는 방 */}
      <span style={css("display:inline-flex;align-items:center;gap:8px")}>
        <span style={css("width:24px;height:24px;border-radius:7px;background:var(--gray-1000);display:flex;align-items:center;justify-content:center")}>
          <span className="mi" style={css("font-size:14px;color:#fff")}>monitoring</span>
        </span>
        <span>
          <span style={css("display:block;font:700 13px 'Geist Sans','Pretendard',sans-serif;color:var(--gray-1000);letter-spacing:-.2px;line-height:1.15")}>관제 대시보드</span>
          <span style={css("display:block;font:500 8.5px 'Geist Mono',monospace;color:var(--gray-700);letter-spacing:.4px")}>LIVE OPERATIONS</span>
        </span>
      </span>

      <span style={css("width:1px;height:20px;background:var(--color-border)")} />

      {/* 실측 상태 램프 */}
      {item(lamp(status.backend === "online" ? true : status.lastChecked === null ? null : false), "백엔드", offline ? (status.lastChecked === null ? "미연결" : "오프라인") : "연결됨")}
      {item(lamp(status.database === "connected" ? true : status.database === "unknown" ? null : false), "DB", status.database === "connected" ? "연결됨" : status.database === "not_connected" ? "끊김" : "—")}
      {item(lamp(status.rag.available), "RAG", status.rag.available === null ? "—" : status.rag.available ? "가동" : "미적재")}
      {offline && (
        <span style={css("font:600 11px 'Geist Sans','Pretendard',sans-serif;color:var(--gray-700);background:var(--gray-100);border-radius:9999px;padding:3px 10px")}>
          데모 모드
        </span>
      )}

      <span style={css("width:1px;height:20px;background:var(--color-border)")} />

      {/* 테스트 콜 — 나열은 심각도 우선 E→G→S (피드 범례·부서 칩과 동일 규약) */}
      <span style={css("font:600 12px 'Geist Sans','Pretendard',sans-serif;color:var(--gray-700)")}>테스트 콜</span>
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
        style={css("display:inline-flex;align-items:center;gap:5px;border:1px solid var(--color-border);border-radius:9999px;padding:6px 13px;font:600 12.5px 'Geist Sans','Pretendard',sans-serif;color:var(--gray-900);cursor:pointer;background:var(--onair-surface)")}
      >
        <span className="mi" style={css("font-size:15px")}>rule</span>분류 정책
      </span>

      {/* 설명 모드 — 발표에서 "이래서 이렇게 연결된다"를 켜는 스위치 */}
      <span
        onClick={onToggleExplain}
        style={css(
          "display:inline-flex;align-items:center;gap:5px;border-radius:9999px;padding:6px 13px;font:600 12.5px 'Geist Sans','Pretendard',sans-serif;cursor:pointer;transition:background .2s,color .2s;" +
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
