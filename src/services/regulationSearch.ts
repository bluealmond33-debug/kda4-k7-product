// 규정 의미 검색 — 백엔드 pgvector 하이브리드 검색(/api/v1/regulations/search) 클라이언트.
//
// 2단 검색 UX의 2단째: 로컬 시트 필터(0ms)는 그대로 두고, 디바운스 후 이 모듈이
// "잘못 송금했어요" → "착오송금 반환" 같은 의미 매칭을 더한다.
// 백엔드가 없거나(NO VITE_API_BASE_URL) 인덱스가 비어 있으면(available:false)
// 조용히 빈 결과로 강등한다 — 로컬 필터는 계속 동작하므로 화면은 깨지지 않는다.

import { API_BASE_URL, DATA_API_PREFIX } from "./config";

/** 전처리로 뽑아낸 정리본 — 조항/항목/내용/안내 멘트 + 사고 방지 신호.
 *
 *  **선택 필드다.** 시드 더미와 구버전 적재분에는 없으므로, 없으면 화면이 excerpt로
 *  폴백해야 한다 — 그래야 코퍼스를 다시 넣지 않아도 검색이 계속 돈다. */
export interface RegulationStructured {
  clause: string | null;
  item: string | null;
  content: string | null;
  /** 고객에게 그대로 읽는 문장. 통화 중 가장 먼저 봐야 하는 값이라 표에서도 맨 앞 열이다 */
  scripts: string[];
  /** "확정적 표현 사용 금지" — 하면 안 되는 것 */
  prohibitions: string[];
  /** "반환 접수 전 본인확인 필수" — 먼저 해야 하는 것 */
  requirements: string[];
  note: string | null;
  row: number | null;
}

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
  /** 없을 수 있다 — 위 주석 참고 */
  structured?: RegulationStructured | null;
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

// 다른 서비스(useCallFlow의 /analyze-text·/ws/call 등)와 같은 폴백 규칙 — .env의
// VITE_API_BASE_URL이 옛 IP로 남아 있어도(와이파이·장소 이동) 지금 이 페이지를 연 주소로
// 자동 복구한다. 이 파일만 폴백이 없어서 "다른 건 다 되는데 규정검색만 안 됨" 버그가 났었다.
const RESOLVED_API_BASE =
  API_BASE_URL ||
  (typeof location !== "undefined" ? `${location.protocol}//${location.hostname}:8000` : "");

export const semanticSearchEnabled = !!RESOLVED_API_BASE;

/** 규정 검색 응답을 기다리는 한계(ms) — 넘으면 포기하고 로컬 필터 결과만 보여준다 */
const SEARCH_TIMEOUT_MS = 8000;

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
  /* 타임아웃 — 백엔드 주소가 틀리거나(옛 LAN IP 등) 죽어 있으면 fetch가 TCP 타임아웃까지
     수십 초를 매달린다. 그동안 화면은 "검색 중…" 스피너로 멈춰 있어 고장으로 보인다.
     8초면 정상 검색(하이브리드 pgvector)에는 충분하고, 죽은 주소는 빨리 포기한다.
     호출부의 abort와 함께 걸어야 연타 취소도 계속 동작한다. */
  const timeout = AbortSignal.timeout(SEARCH_TIMEOUT_MS);
  const signal = opts.signal ? AbortSignal.any([opts.signal, timeout]) : timeout;
  const res = await fetch(
    `${RESOLVED_API_BASE}${DATA_API_PREFIX}/regulations/search?${params}`,
    { headers: { Accept: "application/json" }, signal }
  );
  if (!res.ok) throw new Error(`regulation search failed: ${res.status}`);
  return (await res.json()) as RegulationSearchResponse;
}



/**
 * 실시간 추천 검색어 — 통화 전사를 백엔드 RAG(pgvector)에 흘려, 백엔드가 '관련 있다'고
 * 판단한 규정을 짧은 라벨로 돌려준다. 어떤 용어를 띄울지는 프런트가 아니라 백엔드가 결정한다.
 *
 * search()와 별개 엔드포인트(/suggest)를 쓴다 — 백엔드가 후보를 넉넉히 뽑은 뒤 로컬
 * LLM(EXAONE)으로 지금 발화와 관련된 것만 추리고 순서를 매긴다. 예전엔 여기서 상위 5개
 * 문서의 제목을 그대로 잘라 썼는데, 문서 제목이 우연히 걸리느냐에 따라 매번 다르게 나왔다
 * (현장 피드백: "어떤 건 나오고 어떤 건 안 나와").
 *
 * 백엔드가 꺼져 있거나(available:false) 실패하면 null — 호출부가 로컬 키워드 매칭으로 폴백한다.
 */
export interface RegSuggestion {
  term: string;
  docId: string;
  score: number;
}

export async function fetchRegSuggests(
  transcript: string,
  opts: { category?: string | null; signal?: AbortSignal } = {}
): Promise<RegSuggestion[] | null> {
  const q = transcript.trim().slice(-600); // 최근 발화 위주
  if (!q || !semanticSearchEnabled) return null;
  const params = new URLSearchParams({ q });
  if (opts.category) params.set("category", opts.category);
  const timeout = AbortSignal.timeout(SEARCH_TIMEOUT_MS);
  const signal = opts.signal ? AbortSignal.any([opts.signal, timeout]) : timeout;
  try {
    const res = await fetch(
      `${RESOLVED_API_BASE}${DATA_API_PREFIX}/regulations/suggest?${params}`,
      { headers: { Accept: "application/json" }, signal }
    );
    if (!res.ok) return null;
    const data = (await res.json()) as {
      available: boolean;
      terms: { term: string; doc_id: string; score: number }[];
    };
    if (!data.available || !data.terms?.length) return null;
    return data.terms.map((t) => ({ term: t.term, docId: t.doc_id, score: t.score }));
  } catch {
    return null; // 취소·오류·타임아웃 — 폴백
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
      `${RESOLVED_API_BASE}${DATA_API_PREFIX}/regulations/documents/${encodeURIComponent(docId)}`,
      { signal: opts.signal }
    );
    if (!res.ok) return null;
    return (await res.json()) as RegulationDoc;
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") throw err;
    return null;
  }
}
