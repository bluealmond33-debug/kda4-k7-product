// 규정 의미 검색 — 백엔드 pgvector 하이브리드 검색(/api/v1/regulations/search) 클라이언트.
//
// 2단 검색 UX의 2단째: 로컬 시트 필터(0ms)는 그대로 두고, 디바운스 후 이 모듈이
// "잘못 송금했어요" → "착오송금 반환" 같은 의미 매칭을 더한다.
// 백엔드가 없거나(NO VITE_API_BASE_URL) 인덱스가 비어 있으면(available:false)
// 조용히 빈 결과로 강등한다 — 로컬 필터는 계속 동작하므로 화면은 깨지지 않는다.

import { API_BASE_URL, DATA_API_PREFIX } from "./config";

export interface RegulationHit {
  chunk_id: string;
  doc_id: string;
  title: string;
  doc_type: string;
  page: number;
  section: string | null;
  kind: "text" | "table";
  categories: string[];
  version: string;
  excerpt: string;
  score: number;
  score_dense: number;
  score_keyword: number;
}

export interface RegulationSearchResponse {
  query: string;
  category: string | null;
  available: boolean;
  documents: RegulationHit[];
}

// 부서 라벨 → 규정검색 category 코드 (backend/app/routing/taxonomy.py와 동일 라벨).
// 카드의 전달부서가 확정되면 그 부서의 규정만 좁혀 검색한다(부서 → 필터 항등 매핑).
const DEPARTMENT_CATEGORY: Record<string, string> = {
  "수신·예적금": "DEP",
  "여신·대출": "LON",
  "카드·결제": "CRD",
  "외환·수출입": "FX",
  "전자금융·디지털": "EFN",
  "연금·신탁·투자": "INV",
  "사고·신고": "SG",
  "제도·민원·기타": "ETC",
};

export function categoryForDepartment(label: string | undefined | null): string | null {
  if (!label) return null;
  return DEPARTMENT_CATEGORY[label.trim()] ?? null;
}

export const semanticSearchEnabled = !!API_BASE_URL;

export async function searchRegulations(
  query: string,
  opts: {
    category?: string | null;
    docType?: string | null;
    kind?: "text" | "table" | null;
    effectiveFrom?: string | null;
    k?: number;
    signal?: AbortSignal;
  } = {}
): Promise<RegulationSearchResponse> {
  const q = query.trim();
  if (!q || !semanticSearchEnabled) {
    return { query: q, category: opts.category ?? null, available: false, documents: [] };
  }
  const params = new URLSearchParams({ q, k: String(opts.k ?? 5) });
  if (opts.category) params.set("category", opts.category);
  if (opts.docType) params.set("doc_type", opts.docType);
  if (opts.kind) params.set("kind", opts.kind);
  if (opts.effectiveFrom) params.set("effective_from", opts.effectiveFrom);
  const res = await fetch(
    `${API_BASE_URL}${DATA_API_PREFIX}/regulations/search?${params}`,
    { headers: { Accept: "application/json" }, signal: opts.signal }
  );
  if (!res.ok) throw new Error(`regulation search failed: ${res.status}`);
  return (await res.json()) as RegulationSearchResponse;
}



/**
 * 실시간 추천 검색어 — 통화 전사를 백엔드 RAG(pgvector)에 흘려, 백엔드가 '관련 있다'고
 * 판단한 규정을 짧은 라벨로 돌려준다. 어떤 용어를 띄울지는 프런트가 아니라 백엔드가 결정한다.
 * 백엔드가 꺼져 있거나(available:false) 실패하면 null — 호출부가 로컬 키워드 매칭으로 폴백한다.
 */
export interface RegSuggestion {
  term: string;
  docId: string;
  score: number;
}

function shortLabel(hit: RegulationHit): string {
  const raw = (hit.section && hit.section.trim()) || hit.title || "";
  // 절/조항 접두 제거하고 20자 내로 — 알약에 들어갈 길이
  return raw.replace(/^제?\s*\d+\s*[조절항]\s*[.·]?\s*/, "").replace(/\s+/g, " ").trim().slice(0, 20);
}

export async function fetchRegSuggests(
  transcript: string,
  opts: { category?: string | null; signal?: AbortSignal } = {}
): Promise<RegSuggestion[] | null> {
  const q = transcript.trim().slice(-600); // 최근 발화 위주
  if (!q || !semanticSearchEnabled) return null;
  try {
    const res = await searchRegulations(q, { category: opts.category, k: 8, signal: opts.signal });
    if (!res.available || res.documents.length === 0) return null;
    const seen = new Set<string>();
    const out: RegSuggestion[] = [];
    for (const h of res.documents) {
      const term = shortLabel(h);
      if (term && !seen.has(term)) {
        seen.add(term);
        out.push({ term, docId: h.doc_id, score: h.score });
      }
      if (out.length >= 5) break;
    }
    return out;
  } catch {
    return null; // 취소·오류 — 폴백
  }
}

// ── 원문 열람 — 검색 히트를 클릭하면 그 문서 전체를 '엑셀 룩' 시트로 연다 ──
export interface RegulationDocChunk {
  chunk_id: string;
  page: number;
  kind: "text" | "table";
  section: string | null;
  text: string;
}

export interface RegulationDoc {
  doc_id: string;
  title: string;
  doc_type: string;
  categories: string[];
  version: string;
  effective_date: string | null;
  source_file: string;
  chunks: RegulationDocChunk[];
}

/** 문서 메타 + 페이지순 청크 전체. 백엔드가 없거나 실패하면 null — 호출부는 더미 시트를 유지한다. */
export async function fetchRegulationDocument(
  docId: string,
  opts: { signal?: AbortSignal } = {}
): Promise<RegulationDoc | null> {
  if (!semanticSearchEnabled) return null;
  try {
    const res = await fetch(
      `${API_BASE_URL}${DATA_API_PREFIX}/regulations/documents/${encodeURIComponent(docId)}`,
      { signal: opts.signal }
    );
    if (!res.ok) return null;
    return (await res.json()) as RegulationDoc;
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") throw err;
    return null;
  }
}
