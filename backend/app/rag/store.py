"""규정 RAG pgvector 저장소 — 구현은 app/services/rag_store.py로 통합됐다(ADR-0012).

김민기 원본이 담당하던 적재·문서조회·통계·예외·스키마초기화는 실행 엔진 이식으로
`app.services.rag_store`에 흡수됐다. 이 모듈은 기존 호출부(app/rag/__init__.py,
app/rag/auto_ingest.py 등)가 깨지지 않도록 그 이름들을 **재노출**한다.

예외로 남긴 것: `search_regulations`(list[dict], `limit=`/`category=` 시그니처)는
레거시 compat 라우터(`app/compat.py`)가 그 형태로 쓰고 있어 여기 유지한다. 실행 엔진의
`rag_store.search_regulations`(list[RagDocument], `top_k=`/`categories=`)와는 별개다.

⚠️ 이 compat용 search는 아직 FlagEmbedding(embedder)로 질의를 임베딩한다. rag_store는
Ollama bge-m3로 통일돼 있으므로, pgvector를 실가동할 때는 compat.py도 rag_store 경로로
옮겨 임베딩 백엔드를 일원화해야 한다. 현재 데모는 FAISS 폴백이라 이 경로는 휴면 상태다.
"""

from __future__ import annotations

from typing import Any

import psycopg
from psycopg.rows import dict_row

from app.config import Settings
from app.rag import embedder
from app.rag.taxonomy import is_valid_category

# 통합 구현 재노출 — 하위호환. auto_ingest는 upsert_documents_and_chunks·_database_url을,
# app/rag/__init__.py는 아래 이름들을 이 모듈에서 import한다.
from app.services.rag_store import (  # noqa: F401
    RegulationSearchUnavailable,
    get_regulation_document,
    get_regulation_stats,
    initialize_rag,
    upsert_documents_and_chunks,
)

# score fusion weights: semantic vs keyword. Kept explicit for tuning.
W_DENSE = 0.65
W_KEYWORD = 0.35


def _database_url(settings: Settings) -> str:
    if not settings.database_url:
        raise RegulationSearchUnavailable("DATABASE_URL is not configured")
    return settings.database_url


def _vector_literal(vec) -> str:
    """pgvector text literal, e.g. '[0.1,0.2,...]' — avoids a pgvector-python dep."""
    return "[" + ",".join(f"{x:.7f}" for x in vec) + "]"


_HYBRID_SQL = """
WITH sem AS (
    SELECT chunk_id, 1 - (embedding <=> %(qvec)s::vector) AS dense
    FROM rag_chunks
    WHERE embedding IS NOT NULL
    ORDER BY embedding <=> %(qvec)s::vector
    LIMIT 50
)
SELECT
    c.chunk_id, c.doc_id, d.title, c.page, c.section, c.kind, c.raw,
    d.categories, d.version, d.effective_date,
    sem.dense,
    ts_rank(c.tsv, plainto_tsquery('simple', %(q)s)) AS keyword,
    (%(wd)s * sem.dense
     + %(wk)s * ts_rank(c.tsv, plainto_tsquery('simple', %(q)s))) AS score
FROM sem
JOIN rag_chunks c USING (chunk_id)
JOIN rag_documents d ON d.doc_id = c.doc_id
WHERE d.status = 'active'
  AND (%(category)s::text IS NULL OR %(category)s::text = ANY (d.categories))
ORDER BY score DESC
LIMIT %(limit)s
"""


def search_regulations(
    settings: Settings,
    query: str,
    *,
    category: str | None = None,
    limit: int = 5,
) -> list[dict[str, Any]]:
    """레거시 compat 라우터용 하이브리드 검색(list[dict], FlagEmbedding 질의).

    실행 엔진 경로는 rag_store.search_regulations / rag.search_procedures를 쓴다.
    이 함수는 app/compat.py의 `_regulation_references`가 그 반환 형태로 의존하고 있어
    유지한다. DB·임베딩이 없으면 RegulationSearchUnavailable을 던져 호출부가 폴백한다.
    """
    query = (query or "").strip()
    if not query:
        raise ValueError("query must be a non-empty string")
    if not is_valid_category(category):
        raise ValueError(f"unknown category: {category}")
    if not embedder.is_available():
        raise RegulationSearchUnavailable("embedding backend is not available")

    qvec = _vector_literal(embedder.embed([query])[0])
    params = {
        "qvec": qvec,
        "q": query,
        "wd": W_DENSE,
        "wk": W_KEYWORD,
        "category": category,
        "limit": limit,
    }
    try:
        with psycopg.connect(
            _database_url(settings), row_factory=dict_row
        ) as connection:
            with connection.cursor() as cursor:
                cursor.execute(_HYBRID_SQL, params)
                rows = cursor.fetchall()
    except psycopg.Error as exc:
        raise RegulationSearchUnavailable("regulation query failed") from exc

    return [
        {
            "chunk_id": r["chunk_id"],
            "doc_id": r["doc_id"],
            "title": r["title"],
            "page": r["page"],
            "section": r["section"],
            "kind": r["kind"],
            "categories": list(r["categories"] or []),
            "version": r["version"],
            "excerpt": (r["raw"] or "")[:200],
            "score": round(float(r["score"]), 4),
            "score_dense": round(float(r["dense"]), 4),
            "score_keyword": round(float(r["keyword"]), 4),
        }
        for r in rows
    ]
