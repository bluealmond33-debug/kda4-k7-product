// 백엔드 실상태 폴링 훅 — /health 5초, RAG 통계 30초.
// API_BASE_URL이 없으면 폴링을 생략하고 offline 고정 — 대시보드는 "데모 모드"로 표시된다.
// refresh(): PDF 적재 직후처럼 통계가 바뀐 걸 아는 시점에 즉시 재조회.

import { useCallback, useEffect, useRef, useState } from "react";
import {
  OFFLINE_STATUS,
  fetchHealth,
  fetchRagStatus,
  statusPollingEnabled,
  type AdminStatus,
} from "../services";

export function useAdminStatus(): { status: AdminStatus; refresh: () => void } {
  const [status, setStatus] = useState<AdminStatus>(OFFLINE_STATUS);
  const alive = useRef(true);

  const tickHealth = useCallback(async () => {
    const h = await fetchHealth();
    if (alive.current) setStatus((s) => ({ ...s, ...h, lastChecked: Date.now() }));
  }, []);
  const tickRag = useCallback(async () => {
    const rag = await fetchRagStatus();
    if (alive.current) setStatus((s) => ({ ...s, rag }));
  }, []);

  useEffect(() => {
    if (!statusPollingEnabled()) return;
    alive.current = true;
    void tickHealth();
    void tickRag();
    const h = window.setInterval(() => void tickHealth(), 5000);
    const r = window.setInterval(() => void tickRag(), 30000);
    return () => {
      alive.current = false;
      clearInterval(h);
      clearInterval(r);
    };
  }, [tickHealth, tickRag]);

  const refresh = useCallback(() => {
    if (!statusPollingEnabled()) return;
    void tickHealth();
    void tickRag();
  }, [tickHealth, tickRag]);

  return { status, refresh };
}
