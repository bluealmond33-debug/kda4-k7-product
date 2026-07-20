"""Regulation RAG store on PostgreSQL + pgvector.

Owns the rag schema, chunk upsert, and hybrid retrieval (semantic vector +
keyword full-text) with taxonomy filtering and supersede (active-only) filtering.

Mirrors app/database.py conventions (psycopg3, explicit transactions). Degrades
gracefully: when the database or an embedding backend is unavailable, callers get
``RegulationSearchUnavailable`` and can fall back to placeholder documents.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any, Mapping, Sequence

import psycopg
from psycopg.rows import dict_row

from app.config import Settings
from app.rag import embedder
from app.rag.taxonomy import is_valid_category

# backend/app/rag/store.py -> parents[3] == repo root (matches app/database.py)
RAG_SCHEMA_PATH = (
    Path(__file__).resolve().parents[3] / "database" / "rag" / "schema.sql"
)

# score fusion weights: semantic vs keyword. Kept explicit for tuning.
W_DENSE = 0.65
W_KEYWORD = 0.35


class RegulationSearchUnavailable(RuntimeError):
    """Raised when regulation search cannot run (no DB / no embedding model)."""


def _database_url(settings: Settings) -> str:
    if not settings.database_url:
        raise RegulationSearchUnavailable("DATABASE_URL is not configured")
    return settings.database_url


def _vector_literal(vec: Sequence[float]) -> str:
    """pgvector text literal, e.g. '[0.1,0.2,...]' — avoids a pgvector-python dep."""
    return "[" + ",".join(f"{x:.7f}" for x in vec) + "]"


def initialize_rag(settings: Settings) -> None:
    """Create the rag schema (requires the pgvector extension). No-op without DB."""
    if not settings.database_url:
        return
    schema = RAG_SCHEMA_PATH.read_text(encoding="utf-8")
    try:
        with psycopg.connect(settings.database_url) as connection:
            with connection.cursor() as cursor:
                cursor.execute(schema)
    except psycopg.Error as exc:
        # pgvector extension may be unavailable on the instance; do not block boot.
        raise RegulationSearchUnavailable(
            "regulation schema initialization failed"
        ) from exc


def upsert_documents_and_chunks(
    settings: Settings, chunks: Sequence[Mapping[str, Any]]
) -> int:
    """Load ingest.py output (chunk dicts) into rag_documents + rag_chunks.

    Idempotent: re-running replaces text/embedding for existing chunk_ids and
    refreshes document version/status/effective_date (supports supersede).
    Returns the number of chunks written.
    """
    if not chunks:
        return 0
    dim = embedder.dimension()
    vectors = embedder.embed([c["text"] for c in chunks])

    documents: dict[str, Mapping[str, Any]] = {}
    for c in chunks:
        documents.setdefault(c["doc_id"], c)

    try:
        with psycopg.connect(_database_url(settings)) as connection:
            with connection.cursor() as cursor:
                cursor.execute(RAG_SCHEMA_PATH.read_text(encoding="utf-8"))
                for d in documents.values():
                    cursor.execute(
                        """
                        INSERT INTO rag_documents
                            (doc_id, title, doc_type, categories, version,
                             effective_date, status, source_file)
                        VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
                        ON CONFLICT (doc_id) DO UPDATE SET
                            title = EXCLUDED.title,
                            doc_type = EXCLUDED.doc_type,
                            categories = EXCLUDED.categories,
                            version = EXCLUDED.version,
                            effective_date = EXCLUDED.effective_date,
                            status = EXCLUDED.status
                        """,
                        (
                            d["doc_id"],
                            d["title"],
                            d.get("doc_type", ""),
                            list(d.get("categories", [])),
                            d.get("version", "v1"),
                            d.get("effective_date"),
                            d.get("status", "active"),
                            d.get("filename", d["doc_id"]),
                        ),
                    )
                for chunk, vec in zip(chunks, vectors):
                    if len(vec) != dim:
                        raise RegulationSearchUnavailable(
                            f"embedding dim {len(vec)} != schema {dim}"
                        )
                    cursor.execute(
                        """
                        INSERT INTO rag_chunks
                            (chunk_id, doc_id, page, kind, section, raw, text, embedding)
                        VALUES (%s, %s, %s, %s, %s, %s, %s, %s::vector)
                        ON CONFLICT (chunk_id) DO UPDATE SET
                            text = EXCLUDED.text,
                            raw = EXCLUDED.raw,
                            section = EXCLUDED.section,
                            embedding = EXCLUDED.embedding
                        """,
                        (
                            chunk["chunk_id"],
                            chunk["doc_id"],
                            chunk.get("page", 1),
                            chunk.get("kind", "text"),
                            chunk.get("section"),
                            chunk["raw"],
                            chunk["text"],
                            _vector_literal(vec),
                        ),
                    )
    except psycopg.Error as exc:
        raise RegulationSearchUnavailable("regulation upsert failed") from exc
    return len(chunks)


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
  AND (%(category)s IS NULL OR %(category)s = ANY (d.categories))
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
    """Hybrid regulation search. Raises RegulationSearchUnavailable on any gap.

    Each hit carries doc/page/section provenance so the UI can open the source
    at the right place ("31행 · 열기"), plus the fused score components.
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
