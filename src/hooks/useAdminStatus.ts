// 백엔드 실상태 폴링 훅 — /health 5초, RAG 가용성 30초.
// API_BASE_URL이 없으면 폴링을 생략하고 offline 고정 — 대시보드는 "데모 모드"로 표시된다.

import { useEffect, useState } from "react";
import {
  OFFLINE_STATUS,
  fetchHealth,
  fetchRagAvailability,
  statusPollingEnabled,
  type AdminStatus,
} from "../services";

export function useAdminStatus(): AdminStatus {
  const [status, setStatus] = useState<AdminStatus>(OFFLINE_STATUS);

  useEffect(() => {
    if (!statusPollingEnabled()) return;
    let alive = true;
    const tickHealth = async () => {
      const h = await fetchHealth();
      if (alive) setStatus((s) => ({ ...s, ...h, lastChecked: Date.now() }));
    };
    const tickRag = async () => {
      const available = await fetchRagAvailability();
      if (alive) setStatus((s) => ({ ...s, rag: { available } }));
    };
    void tickHealth();
    void tickRag();
    const h = window.setInterval(() => void tickHealth(), 5000);
    const r = window.setInterval(() => void tickRag(), 30000);
    return () => {
      alive = false;
      clearInterval(h);
      clearInterval(r);
    };
  }, []);

  return status;
}
