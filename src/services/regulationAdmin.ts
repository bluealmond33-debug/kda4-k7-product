// 관리자 콘솔 — 규정 PDF 자동 적재 & 지식베이스 실측 통계 클라이언트.
// 업로드 한 번으로 백엔드가 청킹→부서·업무코드 추천→bge-m3 임베딩→pgvector 적재까지 수행하고,
// 결과(추천 근거·청크 수·개정 여부)를 돌려준다. hippo RAG 설계 8장 (A) 업로드 화면 경로.

import { API_BASE_URL, DATA_API_PREFIX, getJSON } from "./config";

export interface RegulationUploadResult {
  filename: string;
  title: string;
  doc_id: string | null;
  is_scanned: boolean;
  chunks_loaded: number;
  n_text: number;
  n_table: number;
  /** 대장(registry)에 같은 파일명이 있으면 개정본 — 옛 문서 doc_id */
  revision_of: string | null;
  suggestion: {
    department: string; // 부서 코드 (DEP/LON/…)
    business_code: string;
    confidence: number; // 0~1
    why: string[]; // 매칭 근거 키워드
  };
}

export async function uploadRegulationPdf(file: File): Promise<RegulationUploadResult> {
  if (!API_BASE_URL) throw new Error("백엔드 미연결 — VITE_API_BASE_URL이 비어 있습니다");
  const body = new FormData();
  body.append("pdf", file, file.name);
  const res = await fetch(`${API_BASE_URL}${DATA_API_PREFIX}/regulations/upload`, {
    method: "POST",
    body,
  });
  if (!res.ok) {
    let detail = "";
    try {
      detail = ((await res.json()) as { detail?: string }).detail ?? "";
    } catch {
      /* 본문 없음 */
    }
    throw new Error(detail || `업로드 실패 (${res.status})`);
  }
  return (await res.json()) as RegulationUploadResult;
}

export interface RegulationStats {
  available: boolean;
  documents: number | null;
  chunks: number | null;
}

/** 활성 문서·청크 실측 카운트. 구버전 백엔드(엔드포인트 없음)·오프라인은 unavailable로 강등. */
export async function fetchRegulationStats(): Promise<RegulationStats> {
  try {
    return await getJSON<RegulationStats>(`${DATA_API_PREFIX}/regulations/stats`);
  } catch {
    return { available: false, documents: null, chunks: null };
  }
}
