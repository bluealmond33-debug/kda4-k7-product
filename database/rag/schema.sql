-- K7 regulation RAG schema (pgvector).
-- Separate from the mvp call/card schema; initialized alongside it at startup.
-- Scope: bank manual PDFs -> chunks -> hybrid (semantic + keyword) search.
-- Embedding column dimension must match app/rag/embedder.EMBED_DIM (bge-m3 = 1024).

CREATE EXTENSION IF NOT EXISTS vector;

-- one row per registered source document (the 문서 대장)
CREATE TABLE IF NOT EXISTS rag_documents (
    doc_id         text PRIMARY KEY,
    title          text NOT NULL CHECK (btrim(title) <> ''),
    doc_type       text NOT NULL,                 -- 핵심설명서 | 상품설명서 | 업무매뉴얼 ...
    categories     text[] NOT NULL DEFAULT '{}',  -- {LON, 중도금대출, ...} (taxonomy)
    version        text NOT NULL DEFAULT 'v1',
    effective_date date,
    status         text NOT NULL DEFAULT 'active' -- active | superseded (규정 개정 관리)
        CHECK (status IN ('active', 'superseded')),
    source_file    text NOT NULL,
    ingested_at    timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- one row per chunk; `raw` renders on screen, `text`/`embedding`/`tsv` power search
CREATE TABLE IF NOT EXISTS rag_chunks (
    chunk_id   text PRIMARY KEY,
    doc_id     text NOT NULL REFERENCES rag_documents (doc_id) ON DELETE CASCADE,
    page       int NOT NULL DEFAULT 1,
    kind       text NOT NULL DEFAULT 'text' CHECK (kind IN ('text', 'table')),
    section    text,
    raw        text NOT NULL CHECK (btrim(raw) <> ''),
    text       text NOT NULL,                      -- contextual-header + raw (embedded form)
    embedding  vector(1024),
    tsv        tsvector GENERATED ALWAYS AS (to_tsvector('simple', text)) STORED
);

CREATE INDEX IF NOT EXISTS rag_chunks_embedding_idx
    ON rag_chunks USING hnsw (embedding vector_cosine_ops);
CREATE INDEX IF NOT EXISTS rag_chunks_tsv_idx
    ON rag_chunks USING gin (tsv);
CREATE INDEX IF NOT EXISTS rag_documents_status_idx
    ON rag_documents (status);
