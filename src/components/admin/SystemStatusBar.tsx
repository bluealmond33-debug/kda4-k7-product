import { css } from "../../lib/css";
import type { AdminStatus } from "../../services";

/** 상단 플로팅 알약 — 직원 화면 제어 알약과 같은 규격(높이·글자·그림자).
 *  램프들은 연출이 아니라 실측이다(/health · RAG 폴링). 미연결이면 정직하게 "데모 모드". */
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
  const lamp = (on: boolean | null) =>
    on === null ? "var(--gray-500)" : on ? "var(--green-700)" : "var(--red-700)";

  const item = (color: string, label: string, value: string) => (
    <span style={css("display:inline-flex;align-items:center;gap:6px")}>
      <span style={css("width:8px;height:8px;border-radius:9999px;flex:none;background:" + color)} />
      <span style={css("font:600 12px 'Geist Sans','Pretendard',sans-serif;color:var(--gray-700)")}>{label}</span>
      <span style={css("font:600 12.5px 'Geist Sans','Pretendard',sans-serif;color:var(--gray-1000)")}>{value}</span>
    </span>
  );

  return (
    <div style={css("display:flex;align-items:center;gap:13px;background:var(--onair-surface);border-radius:9999px;padding:10px 12px 10px 22px;box-shadow:0 10px 34px rgba(0,0,0,.28);white-space:nowrap")}>
      {/* 타이틀 — 직원 알약의 좌측 라벨 위치 */}
      <span style={css("display:inline-flex;align-items:center;gap:8px")}>
        <span style={css("width:24px;height:24px;border-radius:7px;background:var(--gray-1000);display:flex;align-items:center;justify-content:center")}>
          <span className="mi" style={css("font-size:14px;color:#fff")}>monitoring</span>
        </span>
        <span style={css("font:700 13px 'Geist Sans','Pretendard',sans-serif;color:var(--gray-1000);letter-spacing:-.2px")}>관리자 콘솔</span>
      </span>

      <span style={css("width:1px;height:20px;background:var(--color-border)")} />

      {/* 실측 상태 램프 — 짧은 라벨로 알약 안에 들어간다 */}
      {item(lamp(status.backend === "online" ? true : status.lastChecked === null ? null : false), "백엔드", offline ? (status.lastChecked === null ? "미연결" : "오프라인") : "연결됨")}
      {item(lamp(status.database === "connected" ? true : status.database === "unknown" ? null : false), "DB", status.database === "connected" ? "연결됨" : status.database === "not_connected" ? "끊김" : "—")}
      {item(lamp(status.rag.available), "RAG", status.rag.available === null ? "—" : status.rag.available ? "가동" : "미적재")}
      <span style={css("display:inline-flex;align-items:center;gap:5px")}>
        <span style={css("font:600 12px 'Geist Sans','Pretendard',sans-serif;color:var(--gray-700)")}>감정</span>
        <span style={css("font:700 10.5px 'Geist Sans','Pretendard',sans-serif;color:var(--amber-900);background:var(--amber-100);border-radius:9999px;padding:2.5px 8px")}>데모값</span>
      </span>
      {offline && (
        <span style={css("font:600 11px 'Geist Sans','Pretendard',sans-serif;color:var(--gray-700);background:var(--gray-100);border-radius:9999px;padding:3px 10px")}>
          데모 모드
        </span>
      )}

      <span style={css("width:1px;height:20px;background:var(--color-border)")} />

      {/* 동시 처리 */}
      <span style={css("display:inline-flex;align-items:center;gap:6px;background:var(--gray-100);border-radius:9999px;padding:5px 12px")}>
        <span className={"onairdot" + (concurrent ? "" : " off")} />
        <span style={css("font:600 12px 'Geist Sans','Pretendard',sans-serif;color:var(--gray-900)")}>동시 처리</span>
        <span className="bignum" style={css("font-size:15px;color:var(--gray-1000)")}>{concurrent}</span>
        <span style={css("font:600 12px 'Geist Sans','Pretendard',sans-serif;color:var(--gray-700)")}>건</span>
      </span>

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
