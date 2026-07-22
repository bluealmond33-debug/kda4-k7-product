import { useEffect, useState, type CSSProperties } from "react";
import { css } from "../../lib/css";
import { demoBus } from "../../services";
import { useAdminFeed } from "../../hooks/useAdminFeed";
import { useAdminStatus } from "../../hooks/useAdminStatus";
import { useStageFit } from "../../hooks/useStageFit";
import SystemStatusBar from "./SystemStatusBar";
import PipelineFlowPanel from "./PipelineFlowPanel";
import RoutingFeed from "./RoutingFeed";
import DepartmentBoard from "./DepartmentBoard";
import KnowledgeBasePanel from "./KnowledgeBasePanel";
import AdminTestControls from "./AdminTestControls";
import ClassificationPolicyModal from "./ClassificationPolicyModal";

// 고정 스테이지 — 16:9. 유동 그리드 대신 이 캔버스를 통째로 축소해 항상 같은 비율로 보인다.
const STAGE_W = 1728;
const STAGE_H = 972;

/**
 * KARI-NA 관리자 콘솔 (?role=admin) — 최고관리자용 백엔드 프로세스 대시보드.
 *
 * 상담사 탭(기본 화면)의 데모 진행이 demoBus(BroadcastChannel)로 흘러와
 * [B] 파이프라인 점등 → [C] 라우팅 피드 → [D] 부서 대기열로 실시간 반영된다.
 * [A] 상태 스트립의 램프는 연출이 아니라 실측(/health · RAG 폴링)이다.
 * 레이아웃은 STAGE_W×STAGE_H 고정 — useStageFit이 뷰포트에 맞춰 균등 축소한다.
 */
export default function AdminDashboard() {
  const feed = useAdminFeed();
  const status = useAdminStatus();
  const [explain, setExplain] = useState(false);
  const [policyOpen, setPolicyOpen] = useState(false);
  const { rootRef, scale } = useStageFit(STAGE_W, STAGE_H);

  useEffect(() => {
    demoBus.setSource("admin");
  }, []);

  const stageStyle: CSSProperties = {
    width: STAGE_W,
    height: STAGE_H,
    transformOrigin: "top left",
    transform: `scale(${scale})`,
    display: "flex",
    flexDirection: "column",
    gap: 12,
    padding: "18px 20px",
    boxSizing: "border-box",
    overflow: "hidden",
  };

  return (
    <div
      ref={rootRef}
      style={css(
        "height:100vh;display:flex;justify-content:center;align-items:center;background:var(--onair-bg);overflow:hidden"
      )}
    >
      {/* 축소된 스테이지가 레이아웃 흐름에서 차지하는 실제 크기(스크롤 방지) */}
      <div style={{ width: STAGE_W * scale, height: STAGE_H * scale, flex: "none" }}>
        <div style={stageStyle}>
          <SystemStatusBar
            status={status}
            concurrent={feed.concurrent}
            explain={explain}
            onToggleExplain={() => setExplain((v) => !v)}
            onOpenPolicy={() => setPolicyOpen(true)}
          />
          <PipelineFlowPanel flowCall={feed.flowCall} ticker={feed.state.ticker} explain={explain} />
          <div style={css("flex:1;display:grid;grid-template-columns:452px 1fr;gap:12px;min-height:0")}>
            <RoutingFeed feed={feed.feed} totalCards={feed.state.totalCards} />
            <DepartmentBoard feed={feed} />
          </div>
          <div style={css("display:flex;gap:12px;flex:none")}>
            <KnowledgeBasePanel totalCards={feed.state.totalCards} status={status} />
            <AdminTestControls onResetAll={feed.resetAll} />
          </div>
        </div>
      </div>
      {/* 모달은 스테이지(transform) 밖 — position:fixed가 뷰포트 기준으로 정상 동작하도록 */}
      {policyOpen && <ClassificationPolicyModal onClose={() => setPolicyOpen(false)} />}
    </div>
  );
}
