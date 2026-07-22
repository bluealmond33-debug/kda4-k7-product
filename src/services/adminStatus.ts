// 관리자 대시보드의 "실측" 시스템 상태 — 데모 이벤트와 달리 여기는 진짜 백엔드를 폴링한다.
// API_BASE_URL이 비어 있으면 폴링 자체를 생략하고 offline 고정 — 데모는 백엔드 없이 완주한다.

import { API_BASE_URL, DATA_API_PREFIX, getJSON } from "./config";
import { fetchRegulationStats } from "./regulationAdmin";

export interface AdminStatus {
  backend: "online" | "offline" | "unknown";
  database: "connected" | "not_connected" | "unknown";
  rag: {
    available: boolean | null; // null = 미확인/오프라인
    /** 활성 문서·청크 실측 카운트 (stats 엔드포인트 없으면 null — 화면은 시드 상수로 폴백) */
    documents: number | null;
    chunks: number | null;
  };
  lastChecked: number | null;
}

export const OFFLINE_STATUS: AdminStatus = {
  backend: "offline",
  database: "unknown",
  rag: { available: null, documents: null, chunks: null },
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

/** RAG 실측 — 통계 엔드포인트 우선(문서·청크 수까지), 없으면 검색 1건으로 가용성만. */
export async function fetchRagStatus(): Promise<AdminStatus["rag"]> {
  const stats = await fetchRegulationStats();
  if (stats.available) {
    return { available: true, documents: stats.documents, chunks: stats.chunks };
  }
  // 구버전 백엔드(stats 없음) 폴백 — 검색 1건을 찔러 available 플래그만 읽는다
  try {
    const res = await getJSON<RegulationSearchResponse>(
      `${DATA_API_PREFIX}/regulations/search?q=${encodeURIComponent("본인확인")}&k=1`
    );
    return { available: !!res.available, documents: null, chunks: null };
  } catch {
    return { available: null, documents: null, chunks: null };
  }
}
