import { useEffect, useState } from "react";
import { css } from "../../lib/css";
import { demoBus } from "../../services";
import { useAdminFeed } from "../../hooks/useAdminFeed";
import { useAdminStatus } from "../../hooks/useAdminStatus";
import SystemStatusBar from "./SystemStatusBar";
import PipelineFlowPanel from "./PipelineFlowPanel";
import RoutingFeed from "./RoutingFeed";
import DepartmentBoard from "./DepartmentBoard";
import KnowledgeBasePanel from "./KnowledgeBasePanel";
import AdminTestControls from "./AdminTestControls";
import ClassificationPolicyModal from "./ClassificationPolicyModal";

/**
 * KARI-NA 관리자 콘솔 (?role=admin) — 최고관리자용 백엔드 프로세스 대시보드.
 *
 * 상담사 탭(기본 화면)의 데모 진행이 demoBus(BroadcastChannel)로 흘러와
 * [B] 파이프라인 점등 → [C] 라우팅 피드 → [D] 부서 대기열로 실시간 반영된다.
 * [A] 상태 스트립의 램프는 연출이 아니라 실측(/health · RAG 폴링)이다.
 */
export default function AdminDashboard() {
  const feed = useAdminFeed();
  const status = useAdminStatus();
  const [explain, setExplain] = useState(false);
  const [policyOpen, setPolicyOpen] = useState(false);

  useEffect(() => {
    demoBus.setSource("admin");
    document.title = "KARI-NA 관리자 콘솔";
  }, []);

  return (
    <div style={css("min-height:100vh;background:var(--onair-bg);padding:16px 18px 20px")}>
      <div style={css("max-width:1780px;margin:0 auto;display:flex;flex-direction:column;gap:12px;min-height:calc(100vh - 36px)")}>
        <SystemStatusBar
          status={status}
          concurrent={feed.concurrent}
          explain={explain}
          onToggleExplain={() => setExplain((v) => !v)}
          onOpenPolicy={() => setPolicyOpen(true)}
        />
        <PipelineFlowPanel flowCall={feed.flowCall} ticker={feed.state.ticker} explain={explain} />
        <div style={css("flex:1;display:grid;grid-template-columns:430px 1fr;gap:12px;align-items:stretch;min-height:360px")}>
          <RoutingFeed feed={feed.feed} />
          <DepartmentBoard feed={feed} />
        </div>
        <div style={css("display:flex;gap:12px;align-items:stretch")}>
          <KnowledgeBasePanel totalCards={feed.state.totalCards} status={status} />
          <AdminTestControls onResetAll={feed.resetAll} />
        </div>
      </div>
      {policyOpen && <ClassificationPolicyModal onClose={() => setPolicyOpen(false)} />}
    </div>
  );
}
