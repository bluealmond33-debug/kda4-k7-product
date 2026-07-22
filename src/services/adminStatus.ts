// 관리자 대시보드의 "실측" 시스템 상태 — 데모 이벤트와 달리 여기는 진짜 백엔드를 폴링한다.
// API_BASE_URL이 비어 있으면 폴링 자체를 생략하고 offline 고정 — 데모는 백엔드 없이 완주한다.

import { API_BASE_URL, DATA_API_PREFIX, getJSON } from "./config";

export interface AdminStatus {
  backend: "online" | "offline" | "unknown";
  database: "connected" | "not_connected" | "unknown";
  rag: { available: boolean | null }; // null = 미확인/오프라인
  lastChecked: number | null;
}

export const OFFLINE_STATUS: AdminStatus = {
  backend: "offline",
  database: "unknown",
  rag: { available: null },
  lastChecked: null,
};

export function statusPollingEnabled(): boolean {
  return !!API_BASE_URL;
}

interface HealthResponse {
  status: string;
  database: "connected" | "not_connected";
}

interface RegulationSearchResponse {
  available: boolean;
}

/** GET /health — 실패는 offline으로 삼킨다 (throw 금지: 대시보드는 백엔드 없이도 살아야 한다) */
export async function fetchHealth(): Promise<Pick<AdminStatus, "backend" | "database">> {
  try {
    const res = await getJSON<HealthResponse>("/health");
    return {
      backend: res.status === "ok" ? "online" : "unknown",
      database: res.database === "connected" ? "connected" : "not_connected",
    };
  } catch {
    return { backend: "offline", database: "unknown" };
  }
}

/** RAG 가용성 — 검색 1건을 찔러 available 플래그만 읽는다 (미프로비저닝이면 false, 에러 아님) */
export async function fetchRagAvailability(): Promise<boolean | null> {
  try {
    const res = await getJSON<RegulationSearchResponse>(
      `${DATA_API_PREFIX}/regulations/search?q=${encodeURIComponent("본인확인")}&k=1`
    );
    return !!res.available;
  } catch {
    return null;
  }
}
