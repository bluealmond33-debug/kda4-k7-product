import { css } from "../../lib/css";
import { RAG_STATS } from "../../data/adminContent";
import type { AdminStatus } from "../../services";

/** [E] DB·지식베이스 상태 — 카드 누적(라이브 +1)과 RAG 통계.
 *  문서·청크 수는 백엔드 실측(stats)이 있으면 그 값을, 없으면 전처리 산출물 상수를 쓴다.
 *  'PDF 업로드'가 여기서 열린다 — 적재 즉시 실측 카운트가 올라간다. */
export default function KnowledgeBasePanel({
  totalCards,
  status,
  onOpenUpload,
  explain,
}: {
  totalCards: number;
  status: AdminStatus;
  onOpenUpload: () => void;
  explain: boolean;
}) {
  const live = status.rag.documents != null;
  const docs = status.rag.documents ?? RAG_STATS.docs;
  const chunks = status.rag.chunks ?? RAG_STATS.chunks;

  // min-width 고정 — "1,153"처럼 넓은 숫자가 있어도 컬럼 간격이 고르게 유지된다
  const stat = (value: string, label: string, accent = "var(--gray-1000)") => (
    <span style={css("display:flex;flex-direction:column;gap:3px;align-items:flex-start;min-width:82px")}>
      <span className="bignum" style={css("font-size:21px;color:" + accent)}>{value}</span>
      <span style={css("font:600 10.5px 'Geist Sans','Pretendard',sans-serif;color:var(--gray-700);white-space:nowrap")}>{label}</span>
    </span>
  );
  const divider = <span style={css("width:1px;align-self:stretch;background:var(--gray-200)")} />;

  const rag = status.rag.available;

  return (
    <div className="card" style={css("flex:1;display:flex;align-items:center;gap:16px;padding:12px 18px")}>
      <span style={css("display:inline-flex;align-items:center;gap:8px;flex:none")}>
        <span className="mi" style={css("font-size:19px;color:var(--gray-800)")}>database</span>
        <span>
          <span className="sechd" style={css("display:block;white-space:nowrap")}>DB · 지식베이스</span>
          {/* 설명 모드 — 다른 패널과 같은 회색 블록 캡션 문법 */}
          {explain && (
            <span style={css("display:inline-block;margin-top:4px;font:400 10.5px/1.5 'Geist Sans','Pretendard',sans-serif;color:var(--gray-800);background:var(--gray-100);border:1px solid var(--blue-500);border-radius:8px;padding:4px 9px;white-space:nowrap;animation:dockDown .25s var(--ease-out)")}>
              모든 규정검색의 지식원 — PDF를 올리면 즉시 자랍니다
            </span>
          )}
        </span>
      </span>
      {divider}
      {stat(String(totalCards), "오늘 누적 상담카드", "var(--blue-900)")}
      {divider}
      {stat(String(docs), live ? "규정 문서 · 실측" : "규정 문서")}
      {stat(chunks.toLocaleString(), live ? "청크 · 실측" : "전처리 청크")}
      {stat(String(RAG_STATS.categories), "분류 체계(대분류)")}
      {divider}
      <span style={css("display:flex;flex-direction:column;gap:5px;min-width:0")}>
        <span style={css("display:inline-flex;align-items:center;gap:7px;white-space:nowrap")}>
          <span style={css("width:8px;height:8px;border-radius:9999px;flex:none;background:" + (rag ? "var(--green-700)" : rag === false ? "var(--amber-700)" : "var(--gray-500)"))} />
          <span style={css("font:600 12px 'Geist Sans','Pretendard',sans-serif;color:var(--gray-1000);white-space:nowrap")}>
            {rag ? "pgvector 하이브리드 가동" : rag === false ? "임베딩 미적재 — 폴백" : "RAG 실측 대기 (데모)"}
          </span>
        </span>
        <span style={css("font:400 10.5px 'Geist Mono',monospace;color:var(--gray-700);white-space:nowrap")}>
          dense .65 + kw .35 · bge-m3 · HNSW
        </span>
      </span>
      <div style={css("flex:1")} />
      {/* PDF 업로드 — 청킹→추천→임베딩→적재→검색 반영까지 한 번에. CTA는 ONAIR 규약대로 파랑 */}
      <span
        onClick={onOpenUpload}
        style={css("flex:none;white-space:nowrap;display:inline-flex;align-items:center;gap:6px;border-radius:9999px;padding:8px 15px;font:600 12.5px 'Geist Sans','Pretendard',sans-serif;background:var(--blue-700);color:#fff;cursor:pointer")}
      >
        <span className="mi" style={css("font-size:16px")}>upload_file</span>PDF 업로드
      </span>
    </div>
  );
}
