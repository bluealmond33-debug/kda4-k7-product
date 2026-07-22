import { css } from "../../lib/css";
import { RAG_STATS } from "../../data/adminContent";
import type { AdminStatus } from "../../services";

/** [E] DB·지식베이스 상태 — 카드 누적(라이브 +1)과 RAG 전처리 산출물 통계.
 *  숫자는 데모 시드 + 이벤트 누적, RAG 램프는 실측(폴링)이다. */
export default function KnowledgeBasePanel({
  totalCards,
  status,
}: {
  totalCards: number;
  status: AdminStatus;
}) {
  const stat = (value: string, label: string, accent = "var(--gray-1000)") => (
    <span style={css("display:flex;flex-direction:column;gap:3px;align-items:flex-start")}>
      <span className="bignum" style={css("font-size:23px;color:" + accent)}>{value}</span>
      <span style={css("font:600 10.5px 'Geist Sans','Pretendard',sans-serif;color:var(--gray-700);white-space:nowrap")}>{label}</span>
    </span>
  );
  const divider = <span style={css("width:1px;align-self:stretch;background:var(--gray-200)")} />;

  const rag = status.rag.available;

  return (
    <div className="card" style={css("flex:1;display:flex;align-items:center;gap:22px;padding:14px 22px")}>
      <span style={css("display:inline-flex;align-items:center;gap:8px;flex:none")}>
        <span className="mi" style={css("font-size:19px;color:var(--gray-800)")}>database</span>
        <span className="sechd">DB · 지식베이스</span>
      </span>
      {divider}
      {stat(String(totalCards), "오늘 누적 상담카드", "var(--blue-900)")}
      {divider}
      {stat(String(RAG_STATS.docs), "규정 문서")}
      {stat(RAG_STATS.chunks.toLocaleString(), "전처리 청크")}
      {stat(String(RAG_STATS.categories), "분류 체계(대분류)")}
      {divider}
      <span style={css("display:flex;flex-direction:column;gap:5px")}>
        <span style={css("display:inline-flex;align-items:center;gap:7px")}>
          <span style={css("width:8px;height:8px;border-radius:9999px;background:" + (rag ? "var(--green-700)" : rag === false ? "var(--amber-700)" : "var(--gray-500)"))} />
          <span style={css("font:600 12px 'Geist Sans','Pretendard',sans-serif;color:var(--gray-1000)")}>
            {rag ? "pgvector 하이브리드 검색 가동" : rag === false ? "임베딩 미적재 — 폴백 표시" : "RAG 실측 대기 (데모 모드)"}
          </span>
        </span>
        <span style={css("font:400 10.5px 'Geist Mono',monospace;color:var(--gray-600)")}>
          dense 0.65 + keyword 0.35 · bge-m3 1024d · HNSW
        </span>
      </span>
    </div>
  );
}
