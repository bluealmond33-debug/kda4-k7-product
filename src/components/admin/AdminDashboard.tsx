import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { css } from "../../lib/css";
import { demoBus } from "../../services";
import { useAdminFeed } from "../../hooks/useAdminFeed";
import { useAdminStatus } from "../../hooks/useAdminStatus";
import DesktopShell from "../desktop/DesktopShell";
import SystemStatusBar from "./SystemStatusBar";
import PipelineFlowPanel from "./PipelineFlowPanel";
import RoutingFeed from "./RoutingFeed";
import DepartmentBoard from "./DepartmentBoard";
import KnowledgeBasePanel from "./KnowledgeBasePanel";
import ClassificationPolicyModal from "./ClassificationPolicyModal";
import RegulationUploadModal from "./RegulationUploadModal";
import NodeDetailModal from "./NodeDetailModal";
import CallCardModal from "./CallCardModal";
import type { PipelineNodeDef } from "../../data/adminContent";
import type { AdminCallRecord } from "../../hooks/useAdminFeed";

// 직원 단독 화면(?role=employee)과 동일한 맞춤 — LiveDemo view="desktop"의 값 그대로:
// 폭 1100 스테이지를 브라우저 가로에 맞추고(좌우 24px 패드), 큰 모니터에선 최대 3배 확대.
const STAGE_W = 1100;
const MAX_SCALE = 3;
const FIT_PAD = 24;

/**
 * KARI-NA 관리자 콘솔 (?role=admin) — 최고관리자용 백엔드 프로세스 대시보드.
 *
 * 프레임은 직원 콘솔과 완전히 동일한 셸을 쓴다:
 * 검은 배경 + 상단 플로팅 알약 + DesktopShell(1100×688 카드, 내부 1440×900을 0.76389로 축소).
 * 같은 캔버스·같은 스케일이므로 폰트 크기·밀도·비율이 직원 화면과 정의상 같다 —
 * "같은 서비스의 다른 화면"으로 읽힌다.
 *
 * 상담사 탭의 데모 진행이 demoBus(BroadcastChannel)로 흘러와
 * 파이프라인 점등 → 라우팅 피드 → 부서 대기열로 실시간 반영된다.
 * 상태 알약의 램프는 연출이 아니라 실측(/health · RAG 폴링)이다.
 */
export default function AdminDashboard() {
  const feed = useAdminFeed();
  const { status, refresh: refreshStatus } = useAdminStatus();
  const [explain, setExplain] = useState(false);
  const [policyOpen, setPolicyOpen] = useState(false);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [nodeDetail, setNodeDetail] = useState<PipelineNodeDef | null>(null);
  const [cardDetail, setCardDetail] = useState<AdminCallRecord | null>(null);

  // 직원 화면과 같은 가로 맞춤 스케일 (LiveDemo view="desktop"의 fit 로직과 동일)
  const rootRef = useRef<HTMLDivElement | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const [scale, setScale] = useState(1);
  const [natH, setNatH] = useState(0);

  const fit = useCallback(() => {
    const w = rootRef.current ? rootRef.current.clientWidth : window.innerWidth;
    const natural = stageRef.current ? stageRef.current.offsetHeight : 0;
    // 가로 + 세로 둘 다 클램프 — 모니터링 화면은 스크롤 없이 한 화면에 다 보여야 한다
    // (테스트 콜·지식베이스가 폴드 아래로 내려가면 발표에서 조작 지점이 사라진다)
    const scH = natural > 0 ? (window.innerHeight - FIT_PAD) / natural : MAX_SCALE;
    const sc = Math.min(MAX_SCALE, Math.max(0.2, (w - FIT_PAD) / STAGE_W), scH);
    setScale((prev) => (Math.abs(prev - sc) > 0.0005 ? sc : prev));
    setNatH((prev) => (prev !== natural ? natural : prev));
  }, []);

  useEffect(() => {
    const onResize = () => fit();
    window.addEventListener("resize", onResize);
    const raf = requestAnimationFrame(fit);
    return () => {
      window.removeEventListener("resize", onResize);
      cancelAnimationFrame(raf);
    };
  }, [fit]);
  useLayoutEffect(() => {
    fit();
  }, [fit, explain]);

  useEffect(() => {
    demoBus.setSource("admin");
  }, []);

  return (
    <div
      ref={rootRef}
      style={css(
        "min-height:100vh;padding:12px;display:flex;justify-content:center;align-items:center;background:#060607;box-sizing:border-box"
      )}
    >
      <div style={{ width: STAGE_W * scale, height: natH ? natH * scale : "auto" }}>
        <div
          ref={stageRef}
          style={{
            width: STAGE_W,
            transformOrigin: "top left",
            transform: `scale(${scale})`,
            display: "flex",
            flexDirection: "column",
            gap: 18,
            alignItems: "center",
          }}
        >
          {/* 상단 플로팅 알약 — 직원 화면 제어 알약과 같은 위치·톤. 테스트 콜 리모컨도 여기 */}
          <SystemStatusBar
            explain={explain}
            onToggleExplain={() => setExplain((v) => !v)}
            onOpenPolicy={() => setPolicyOpen(true)}
            onResetAll={feed.resetAll}
          />
          {/* 직원 데스크톱과 동일한 캔버스 — 1100×688, 내부 1440×900 @0.76389 */}
          <DesktopShell flex>
            <div style={css("flex:1;display:flex;flex-direction:column;gap:12px;padding:16px;min-height:0")}>
              <PipelineFlowPanel
                flowCall={feed.flowCall}
                explain={explain}
                concurrent={feed.concurrent}
                status={status}
                onNodeClick={setNodeDetail}
              />
              <div style={css("flex:1;display:grid;grid-template-columns:400px 1fr;gap:12px;min-height:0")}>
                <RoutingFeed
                  feed={feed.feed}
                  totalCards={feed.state.totalCards}
                  explain={explain}
                  onOpenCard={setCardDetail}
                />
                <DepartmentBoard feed={feed} explain={explain} />
              </div>
              {/* 하단 행 — 지식베이스 풀폭 (테스트 콜 리모컨은 상단 알약으로 이동) */}
              <div style={css("display:flex;flex:none")}>
                <KnowledgeBasePanel
                  totalCards={feed.state.totalCards}
                  status={status}
                  onOpenUpload={() => setUploadOpen(true)}
                  explain={explain}
                />
              </div>
            </div>
          </DesktopShell>
        </div>
      </div>
      {/* 모달은 스테이지(transform) 밖 — position:fixed가 뷰포트 기준으로 정상 동작하도록 */}
      {policyOpen && <ClassificationPolicyModal onClose={() => setPolicyOpen(false)} />}
      {uploadOpen && (
        <RegulationUploadModal onClose={() => setUploadOpen(false)} onLoaded={refreshStatus} />
      )}
      {nodeDetail && <NodeDetailModal node={nodeDetail} onClose={() => setNodeDetail(null)} />}
      {cardDetail && <CallCardModal record={cardDetail} onClose={() => setCardDetail(null)} />}
    </div>
  );
}
