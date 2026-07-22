import { css } from "../../lib/css";
import type { AdminStatus } from "../../services";

/** [A] 시스템 상태 스트립 — 여기 램프들은 연출이 아니라 실측이다(/health · RAG 폴링).
 *  백엔드 미연결이면 정직하게 "데모 모드"로 표시한다. */
export default function SystemStatusBar({
  status,
  concurrent,
  explain,
  onToggleExplain,
  onOpenPolicy,
}: {
  status: AdminStatus;
  concurrent: number;
  explain: boolean;
  onToggleExplain: () => void;
  onOpenPolicy: () => void;
}) {
  const offline = status.backend !== "online";
  const lamp = (on: boolean | null, okColor = "var(--green-700)") =>
    on === null
      ? "var(--gray-500)"
      : on
      ? okColor
      : "var(--red-700)";

  const item = (color: string, label: string, value: string) => (
    <span style={css("display:inline-flex;align-items:center;gap:7px")}>
      <span style={css("width:8px;height:8px;border-radius:9999px;flex:none;background:" + color)} />
      <span style={css("font:600 12px 'Geist Sans','Pretendard',sans-serif;color:var(--gray-700)")}>{label}</span>
      <span style={css("font:600 12px 'Geist Sans','Pretendard',sans-serif;color:var(--gray-1000)")}>{value}</span>
    </span>
  );

  return (
    <div className="card" style={css("display:flex;align-items:center;gap:18px;padding:12px 20px;white-space:nowrap")}>
      {/* 타이틀 */}
      <span style={css("display:inline-flex;align-items:center;gap:10px")}>
        <span style={css("width:30px;height:30px;border-radius:9px;background:var(--gray-1000);display:flex;align-items:center;justify-content:center")}>
          <span className="mi" style={css("font-size:17px;color:#fff")}>monitoring</span>
        </span>
        <span>
          <div style={css("font:700 15px 'Geist Sans','Pretendard',sans-serif;color:var(--gray-1000);letter-spacing:-.2px")}>KARI-NA 관리자 콘솔</div>
          <div style={css("font:500 10.5px 'Geist Mono',monospace;color:var(--gray-600);letter-spacing:.2px")}>BACKEND PROCESS · LIVE ROUTING</div>
        </span>
      </span>

      <span style={css("width:1px;height:26px;background:var(--color-border)")} />

      {/* 실측 상태 램프 */}
      {item(lamp(status.backend === "online" ? true : offline && status.lastChecked === null ? null : false), "백엔드 API", offline ? (status.lastChecked === null ? "미연결" : "오프라인") : "연결됨")}
      {item(lamp(status.database === "connected" ? true : status.database === "unknown" ? null : false), "PostgreSQL", status.database === "connected" ? "connected" : status.database === "not_connected" ? "끊김" : "—")}
      {item(lamp(status.rag.available, "var(--green-700)"), "RAG 검색", status.rag.available === null ? "—" : status.rag.available ? "검색 가능" : "미적재")}

      {/* 감정 모델 — 실모델 미연동을 정직하게 배지로 */}
      <span style={css("display:inline-flex;align-items:center;gap:6px")}>
        <span style={css("font:600 12px 'Geist Sans','Pretendard',sans-serif;color:var(--gray-700)")}>감정 모델</span>
        <span style={css("font:700 10.5px 'Geist Sans','Pretendard',sans-serif;color:var(--amber-900);background:var(--amber-100);border-radius:9999px;padding:3px 9px")}>데모값</span>
      </span>

      {offline && (
        <span style={css("font:600 11px 'Geist Sans','Pretendard',sans-serif;color:var(--gray-700);background:var(--gray-100);border-radius:9999px;padding:4px 11px")}>
          백엔드 미연결 · 데모 모드
        </span>
      )}

      <div style={css("flex:1")} />

      {/* 동시 처리 */}
      <span style={css("display:inline-flex;align-items:center;gap:7px;background:var(--gray-100);border-radius:9999px;padding:6px 13px")}>
        <span className={"onairdot" + (concurrent ? "" : " off")} />
        <span style={css("font:600 12px 'Geist Sans','Pretendard',sans-serif;color:var(--gray-900)")}>동시 처리</span>
        <span className="bignum" style={css("font-size:14px;color:var(--gray-1000)")}>{concurrent}</span>
        <span style={css("font:600 12px 'Geist Sans','Pretendard',sans-serif;color:var(--gray-700)")}>건</span>
      </span>

      {/* 분류 정책 */}
      <span
        onClick={onOpenPolicy}
        style={css("display:inline-flex;align-items:center;gap:6px;border:1px solid var(--color-border);border-radius:9999px;padding:7px 14px;font:600 12.5px 'Geist Sans','Pretendard',sans-serif;color:var(--gray-900);cursor:pointer;background:var(--onair-surface)")}
      >
        <span className="mi" style={css("font-size:16px")}>rule</span>분류 정책
      </span>

      {/* 설명 모드 — 발표에서 "이래서 이렇게 연결된다"를 켜는 스위치 */}
      <span
        onClick={onToggleExplain}
        style={css(
          "display:inline-flex;align-items:center;gap:6px;border-radius:9999px;padding:7px 14px;font:600 12.5px 'Geist Sans','Pretendard',sans-serif;cursor:pointer;transition:background .2s,color .2s;" +
            (explain
              ? "background:var(--blue-700);color:#fff"
              : "background:var(--onair-surface);border:1px solid var(--color-border);color:var(--gray-900)")
        )}
      >
        <span className="mi" style={css("font-size:16px")}>tips_and_updates</span>설명 모드
      </span>
    </div>
  );
}
