import { css } from "../../lib/css";
import { PIPELINE_NODES, type PipelineNodeDef } from "../../data/adminContent";
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
  onNodeClick,
}: {
  flowCall: AdminCallRecord | null;
  explain: boolean;
  concurrent: number;
  status: AdminStatus;
  /** 설명 모드에서 노드 클릭 → 실사용 모델 상세 팝업 */
  onNodeClick: (node: PipelineNodeDef) => void;
}) {
  const stages = flowCall?.stages ?? {};

  // 노드별 live 램프 — "무엇이 어디서 실제로 살아있는지"를 해당 노드 자리에서 말한다(실측 폴링).
  // 초록(숨쉼)=실가동 · 앰버=데모값/데모 대체 · 빨강=끊김 · 회색=미확인
  const backendOn = status.backend === "online" ? true : status.lastChecked === null ? null : false;
  const dbOn = status.database === "connected" ? true : status.database === "unknown" ? null : false;
  const ragOn = status.rag.available;
  const nodeLive = (
    id: string
  ): { color: string; pulse: boolean; tip: string } => {
    const live = (on: boolean | null, tipOn: string, tipOff: string) =>
      on === true
        ? { color: "var(--green-700)", pulse: true, tip: tipOn }
        : on === false
        ? { color: "var(--red-700)", pulse: false, tip: tipOff }
        : { color: "var(--gray-500)", pulse: false, tip: "미확인 (데모 모드)" };
    switch (id) {
      case "stt":
        return live(backendOn, "STT 실가동 — 백엔드 연결됨", "백엔드 오프라인");
      case "classify":
        return live(backendOn, "분류 sLLM 실가동 — 백엔드 연결됨", "백엔드 오프라인");
      case "route":
        return live(backendOn, "카드 라우터 실가동", "백엔드 오프라인");
      case "persist":
        return live(dbOn, "PostgreSQL 연결됨 — 실측", "DB 끊김");
      case "rag":
        return live(ragOn, "pgvector 검색 실측 가동", "임베딩 미적재");
      case "risk":
        return { color: "var(--amber-700)", pulse: false, tip: "감정 모델 데모값 — 온프렘 백엔드에 완성, 이 파이프라인 미연동" };
      default: // utterance · wrap — 시연 대체 구간
        return { color: "var(--amber-700)", pulse: false, tip: "시연 대체 구간 (데모)" };
    }
  };

  return (
    <div className="card" style={css("flex:none;padding:14px 18px 12px")}>
      {/* 헤더 */}
      <div style={css("display:flex;align-items:center;gap:10px;margin-bottom:12px")}>
        <span className="sechd">백엔드 프로세스 플로우</span>
        <span style={css("font:400 11.5px 'Avenir Next','Geist Sans','Pretendard',sans-serif;color:var(--gray-600)")}>
          발화부터 후처리까지 — 전 과정 온프레미스, 외부 API 0
        </span>
        <div style={css("flex:1")} />
        {/* 동시 처리 — 이 파이프라인을 지금 몇 콜이 지나는지 (알약에서 이관) */}
        <span style={css("display:inline-flex;align-items:center;gap:6px;background:var(--gray-100);border-radius:9999px;padding:5px 12px")}>
          <span className={"onairdot" + (concurrent ? "" : " off")} />
          <span style={css("font:600 11.5px 'Avenir Next','Geist Sans','Pretendard',sans-serif;color:var(--gray-900)")}>동시 처리</span>
          <span className="bignum" style={css("font-size:14px;color:var(--gray-1000)")}>{concurrent}</span>
          <span style={css("font:600 11.5px 'Avenir Next','Geist Sans','Pretendard',sans-serif;color:var(--gray-700)")}>건</span>
        </span>
        {flowCall ? (
          <span style={css("display:inline-flex;align-items:center;gap:8px;background:var(--gray-100);border-radius:9999px;padding:5px 12px")}>
            <span
              className={"onairdot" + (flowCall.endedAt === null ? "" : " off")}
              style={flowCall.endedAt === null ? { animation: "recBlink 1.4s infinite" } : undefined}
            />
            <span style={css("font:600 11.5px 'Avenir Next','Geist Sans','Pretendard',sans-serif;color:var(--gray-900)")}>
              {flowCall.endedAt === null ? "처리 중" : "최근 처리"} · {KIND_LABEL[flowCall.kind]} 콜
            </span>
            <span style={css("font:500 10.5px 'Geist Mono',monospace;color:var(--gray-700)")}>{flowCall.callId}</span>
          </span>
        ) : (
          <span style={css("font:600 11.5px 'Avenir Next','Geist Sans','Pretendard',sans-serif;color:var(--gray-600);background:var(--gray-100);border-radius:9999px;padding:5px 12px")}>
            인입 대기 — 상담사 화면에서 콜을 시작하거나 상단 테스트 콜을 눌러보세요
          </span>
        )}
      </div>

      {/* 노드 행 — 각 노드가 제 자리에서 live 여부를 말한다 (라벨 옆 실측 램프) */}
      <div style={css("display:flex;align-items:flex-start")}>
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
              <span
                onClick={explain ? () => onNodeClick(node) : undefined}
                title={explain ? node.label + " — 클릭하면 실사용 모델 상세" : undefined}
                style={css(
                  "flex:1;min-width:0;display:flex;flex-direction:column;align-items:center;text-align:center;gap:6px" +
                    (explain ? ";cursor:pointer" : "")
                )}
              >
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
                {/* 라벨 + live 램프 — 이 단계가 실제로 살아있는지(실측). 초록은 숨쉰다 */}
                {(() => {
                  const lv = nodeLive(node.id);
                  return (
                    <span title={lv.tip} style={css("display:inline-flex;align-items:center;gap:5px")}>
                      <span
                        style={{
                          width: 7,
                          height: 7,
                          borderRadius: 9999,
                          flex: "none",
                          background: lv.color,
                          ...(lv.pulse ? { animation: "livePulse 2.2s ease-in-out infinite" } : null),
                        }}
                      />
                      <span style={css("font:600 12.5px 'Avenir Next','Geist Sans','Pretendard',sans-serif;letter-spacing:-.1px;color:" + (on || done ? "var(--gray-1000)" : "var(--gray-700)"))}>
                        {node.label}
                      </span>
                    </span>
                  );
                })()}
                {/* 기술 캡션(어떤 AI·기술인지) — 설명 모드에서만. 평소 관제 화면은 조용하게 */}
                {explain && (
                  <span style={css("font:500 10.5px 'Geist Mono',monospace;color:var(--gray-700);line-height:1.45;animation:dockDown .25s var(--ease-out)")}>
                    {node.tech.split(" · ").map((seg) => (
                      <span key={seg} style={css("display:block;white-space:nowrap")}>{seg}</span>
                    ))}
                  </span>
                )}
                {explain && (
                  <span style={css("font:400 10.5px/1.5 'Avenir Next','Geist Sans','Pretendard',sans-serif;color:var(--gray-800);background:var(--gray-100);border:1px solid var(--blue-500);border-radius:8px;padding:7px 9px;text-align:left;animation:dockDown .25s var(--ease-out)")}>
                    {node.explain}
                    <span style={css("display:block;margin-top:4px;font:600 9.5px 'Avenir Next','Geist Sans','Pretendard',sans-serif;color:var(--blue-900)")}>
                      클릭 → 실사용 모델 상세
                    </span>
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
