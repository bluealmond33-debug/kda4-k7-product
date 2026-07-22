import { css } from "../../lib/css";
import { PIPELINE_NODES } from "../../data/adminContent";
import type { AdminStatus } from "../../services";
import type { AdminCallRecord } from "../../hooks/useAdminFeed";

const KIND_LABEL = { normal: "일반", urgent: "긴급", transfer: "이관 수신" } as const;

/** [B] 백엔드 프로세스 플로우 — 발표의 센터피스.
 *  고객 발화→STT→분류→위험→저장→라우팅→RAG→후처리 8노드가 데모 진행에 따라 점등된다.
 *  설명 모드를 켜면 각 노드 아래 "왜 이렇게 연결되는가" 캡션이 펼쳐진다. */
export default function PipelineFlowPanel({
  flowCall,
  explain,
  concurrent,
  status,
}: {
  flowCall: AdminCallRecord | null;
  explain: boolean;
  concurrent: number;
  status: AdminStatus;
}) {
  const stages = flowCall?.stages ?? {};

  // 시스템 레일 — 관제가 흘끗 보고 안심하는 자리. 전부 초록이면 LIVE가 잔잔히 숨쉰다(실측).
  const lampBackend = status.backend === "online" ? true : status.lastChecked === null ? null : false;
  const lampDb = status.database === "connected" ? true : status.database === "unknown" ? null : false;
  const lampRag = status.rag.available;
  const allOn = lampBackend === true && lampDb === true && lampRag === true;
  const lampColor = (on: boolean | null) =>
    on === null ? "var(--gray-500)" : on ? "var(--green-700)" : "var(--red-700)";
  const railLamp = (on: boolean | null, label: string) => (
    <span style={css("display:inline-flex;align-items:center;gap:6px;white-space:nowrap")}>
      <span style={css("width:7px;height:7px;border-radius:9999px;flex:none;background:" + lampColor(on))} />
      <span style={css("font:600 10.5px 'Geist Sans','Pretendard',sans-serif;color:var(--gray-800)")}>{label}</span>
    </span>
  );

  return (
    <div className="card" style={css("flex:none;padding:14px 18px 12px")}>
      {/* 헤더 */}
      <div style={css("display:flex;align-items:center;gap:10px;margin-bottom:12px")}>
        <span className="sechd">백엔드 프로세스 플로우</span>
        <span style={css("font:400 11.5px 'Geist Sans','Pretendard',sans-serif;color:var(--gray-600)")}>
          발화부터 후처리까지 — 전 과정 온프레미스, 외부 API 0
        </span>
        <div style={css("flex:1")} />
        {/* 동시 처리 — 이 파이프라인을 지금 몇 콜이 지나는지 (알약에서 이관) */}
        <span style={css("display:inline-flex;align-items:center;gap:6px;background:var(--gray-100);border-radius:9999px;padding:5px 12px")}>
          <span className={"onairdot" + (concurrent ? "" : " off")} />
          <span style={css("font:600 11.5px 'Geist Sans','Pretendard',sans-serif;color:var(--gray-900)")}>동시 처리</span>
          <span className="bignum" style={css("font-size:14px;color:var(--gray-1000)")}>{concurrent}</span>
          <span style={css("font:600 11.5px 'Geist Sans','Pretendard',sans-serif;color:var(--gray-700)")}>건</span>
        </span>
        {flowCall ? (
          <span style={css("display:inline-flex;align-items:center;gap:8px;background:var(--gray-100);border-radius:9999px;padding:5px 12px")}>
            <span
              className={"onairdot" + (flowCall.endedAt === null ? "" : " off")}
              style={flowCall.endedAt === null ? { animation: "recBlink 1.4s infinite" } : undefined}
            />
            <span style={css("font:600 11.5px 'Geist Sans','Pretendard',sans-serif;color:var(--gray-900)")}>
              {flowCall.endedAt === null ? "처리 중" : "최근 처리"} · {KIND_LABEL[flowCall.kind]} 콜
            </span>
            <span style={css("font:500 10.5px 'Geist Mono',monospace;color:var(--gray-700)")}>{flowCall.callId}</span>
          </span>
        ) : (
          <span style={css("font:600 11.5px 'Geist Sans','Pretendard',sans-serif;color:var(--gray-600);background:var(--gray-100);border-radius:9999px;padding:5px 12px")}>
            인입 대기 — 상담사 화면에서 콜을 시작하거나 상단 테스트 콜을 눌러보세요
          </span>
        )}
      </div>

      {/* 노드 행 — 왼쪽엔 시스템 레일: 이 파이프라인을 받치는 장비가 전부 켜져 있다는 실측 신호 */}
      <div style={css("display:flex;align-items:flex-start")}>
        <div style={css("flex:none;display:flex;flex-direction:column;gap:5px;padding:2px 0 0 2px")}>
          <span style={css("display:inline-flex;align-items:center;gap:6px;white-space:nowrap")}>
            <span
              style={{
                width: 9,
                height: 9,
                borderRadius: 9999,
                flex: "none",
                background: allOn ? "var(--green-700)" : "var(--amber-700)",
                ...(allOn ? { animation: "livePulse 2.2s ease-in-out infinite" } : null),
              }}
            />
            <span style={css("font:700 11px 'Geist Mono',monospace;letter-spacing:.5px;color:" + (allOn ? "var(--green-900)" : "var(--amber-900)"))}>
              {allOn ? "LIVE" : "데모 모드"}
            </span>
          </span>
          {railLamp(lampBackend, "백엔드")}
          {railLamp(lampDb, "DB")}
          {railLamp(lampRag, "RAG")}
        </div>
        <span style={css("flex:none;width:1px;align-self:stretch;background:var(--gray-200);margin:2px 14px 2px 12px")} />
        {PIPELINE_NODES.map((node, i) => {
          const st = stages[node.id];
          const on = st === "start";
          const done = st === "done";
          return (
            <span key={node.id} style={css("display:flex;flex:1;align-items:flex-start;min-width:0")}>
              {i > 0 && (
                <span
                  className="mi"
                  style={css(
                    "flex:none;font-size:17px;margin:13px 2px 0;transition:color .3s;color:" +
                      (done || on ? "var(--gray-800)" : "var(--gray-400)")
                  )}
                >
                  arrow_forward
                </span>
              )}
              <span style={css("flex:1;min-width:0;display:flex;flex-direction:column;align-items:center;text-align:center;gap:6px")}>
                {/* 아이콘 원 — idle 회색 · 처리 중 파랑 · 완료 진초록 체크 오버레이 */}
                <span
                  style={css(
                    "position:relative;width:42px;height:42px;border-radius:13px;display:flex;align-items:center;justify-content:center;transition:background .3s,box-shadow .3s;" +
                      (on
                        ? "background:var(--blue-700);box-shadow:0 4px 14px -4px rgba(47,95,196,.55)"
                        : "background:var(--gray-100)")
                  )}
                >
                  <span
                    className="mi"
                    style={css(
                      "font-size:21px;transition:color .3s;color:" +
                        (on ? "#fff" : done ? "var(--green-900)" : "var(--gray-600)")
                    )}
                  >
                    {node.icon}
                  </span>
                  {done && (
                    <span style={css("position:absolute;right:-4px;top:-4px;width:16px;height:16px;border-radius:9999px;background:var(--green-700);display:flex;align-items:center;justify-content:center")}>
                      <span className="mi" style={css("font-size:11px;color:#fff")}>check</span>
                    </span>
                  )}
                  {on && (
                    <span
                      className="onairdot"
                      style={{
                        position: "absolute",
                        right: -3,
                        top: -3,
                        animation: "recBlink 1.2s infinite",
                      }}
                    />
                  )}
                </span>
                <span style={css("font:600 12.5px 'Geist Sans','Pretendard',sans-serif;letter-spacing:-.1px;color:" + (on || done ? "var(--gray-1000)" : "var(--gray-700)"))}>
                  {node.label}
                </span>
                {/* keep-all — 한글이 음절 중간에서 꺾이지 않게(공백·`·`에서만 개행) */}
                <span style={css("font:500 10.5px 'Geist Mono',monospace;color:var(--gray-700);line-height:1.45;word-break:keep-all")}>{node.tech}</span>
                {explain && (
                  <span style={css("font:400 10.5px/1.5 'Geist Sans','Pretendard',sans-serif;color:var(--gray-800);background:var(--gray-100);border-radius:8px;padding:7px 9px;text-align:left;animation:dockDown .25s var(--ease-out)")}>
                    {node.explain}
                  </span>
                )}
              </span>
            </span>
          );
        })}
      </div>

    </div>
  );
}
