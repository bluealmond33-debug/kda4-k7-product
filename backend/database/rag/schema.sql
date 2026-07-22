-- K7 규정 RAG 스키마 (pgvector) — 개인 백엔드(HeeChang50/kda4-k7-backend)판.
-- 팀 모노레포(kda4-k7-product) database/rag/schema.sql과 "동일"하게 유지한다.
--   → 벡터저장소 통일(FAISS→pgvector) 결정(2026-07-21)에 따라 두 백엔드가 같은 스키마를 공유.
-- calls/transcripts/consultation_cards(mvp) 스키마와는 별개이며, 기동 시 함께 초기화한다.
-- 임베딩 차원은 반드시 임베딩 모델과 일치해야 한다(온프레미스 bge-m3 = 1024).

CREATE EXTENSION IF NOT EXISTS vector;

-- 원본 문서 1건 = 1행 (문서 대장)
CREATE TABLE IF NOT EXISTS rag_documents (
    doc_id         text PRIMARY KEY,
    title          text NOT NULL CHECK (btrim(title) <> ''),
    doc_type       text NOT NULL,                 -- 핵심설명서 | 상품설명서 | 업무매뉴얼 | 데모규정 ...
    categories     text[] NOT NULL DEFAULT '{}',  -- {LON, ...} (taxonomy 8대분류 코드)
    version        text NOT NULL DEFAULT 'v1',
    effective_date date,
    status         text NOT NULL DEFAULT 'active' -- active | superseded (규정 개정 관리)
        CHECK (status IN ('active', 'superseded')),
    source_file    text NOT NULL,
    ingested_at    timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 청크 1개 = 1행. raw는 화면 표시용, text/embedding/tsv는 검색용.
-- section 컬럼에 데모 청크의 subcategory(중분류)를 담아 RagDocument.subcategory로 되돌린다.
CREATE TABLE IF NOT EXISTS rag_chunks (
    chunk_id   text PRIMARY KEY,
    doc_id     text NOT NULL REFERENCES rag_documents (doc_id) ON DELETE CASCADE,
    page       int NOT NULL DEFAULT 1,
    kind       text NOT NULL DEFAULT 'text' CHECK (kind IN ('text', 'table')),
    section    text,                              -- 데모: subcategory(중분류)
    raw        text NOT NULL CHECK (btrim(raw) <> ''),
    text       text NOT NULL,                     -- 문맥헤더 + raw (임베딩 대상 형태)
    embedding  vector(1024),
    tsv        tsvector GENERATED ALWAYS AS (to_tsvector('simple', text)) STORED
);

CREATE INDEX IF NOT EXISTS rag_chunks_embedding_idx
    ON rag_chunks USING hnsw (embedding vector_cosine_ops);
CREATE INDEX IF NOT EXISTS rag_chunks_tsv_idx
    ON rag_chunks USING gin (tsv);
CREATE INDEX IF NOT EXISTS rag_documents_status_idx
    ON rag_documents (status);
