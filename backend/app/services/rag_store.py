"""규정 RAG의 pgvector 저장소 — FAISS를 대체하는 벡터저장소(팀 결정 2026-07-21).

팀 모노레포(kda4-k7-product) app/rag/store.py의 하이브리드 검색(시맨틱 벡터 + 키워드
전문검색 + taxonomy/supersede 필터)을 개인 백엔드로 이식한 것. 두 백엔드가 같은 스키마
(database/rag/schema.sql)와 같은 검색 로직을 공유한다.

이식하며 바꾼 것:
- 임베딩: 모노레포의 FlagEmbedding(bge-m3) 대신, 이 백엔드에 이미 가동 중인 경로
  (rag._embed → Ollama bge-m3, 1024차원, L2정규화)를 그대로 재사용한다. 같은 BAAI/bge-m3
  모델이라 벡터가 호환된다. torch/FlagEmbedding 추가 설치 불필요.
- 반환 타입: 모노레포는 dict를 돌려주지만, 여기서는 파이프라인 계약(RagDocument)에 맞춰
  RagDocument로 매핑해 search_procedures가 시그니처 변경 없이 이걸 쓸 수 있게 한다.

pgvector 확장은 벡터(1024) 컬럼과 hnsw 인덱스에 필요하다. Smart App Control이 미서명
네이티브 DLL을 막을 수 있어, 이 저장소는 Docker(pgvector/pgvector:pg17)로 띄운 Postgres를
가리키는 것을 기본 전제로 한다. 확장/시드가 아직 없으면 pgvector_ready()가 False를 반환하고
호출부(search_procedures)는 FAISS로 자동 폴백한다 — 데모가 끊기지 않는다.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any, Mapping, Sequence

import psycopg
from psycopg.rows import dict_row

from app.config import Settings
from app.schemas import RagDocument

# 모노레포 이식(ADR-0012): 스키마 정본은 저장소 루트 database/rag/schema.sql이다.
# app/services/rag_store.py -> parents[3] == repo 루트 (김민기 store.py와 동일 위치).
# (이식 전 개인 백엔드에서는 parents[2]였으나, 모노레포에선 backend/database가 없다.)
RAG_SCHEMA_PATH = Path(__file__).resolve().parents[3] / "database" / "rag" / "schema.sql"

# 점수 융합 가중치: 시맨틱 vs 키워드. 모노레포와 동일값(튜닝 여지 위해 명시).
W_DENSE = 0.65
W_KEYWORD = 0.35

# pgvector 준비상태 캐시. 프로세스당 1회 판정(첫 호출/명시적 reset 시 재판정).
# pgvector를 새로 띄운 뒤에는 백엔드를 재시작하면 자동으로 재판정된다.
_READY: bool | None = None


class RegulationSearchUnavailable(RuntimeError):
    """규정 검색을 수행할 수 없을 때(무 DB / 무 확장 / 무 시드)."""


def reset_readiness() -> None:
    """준비상태 캐시 초기화 — 시드 스크립트/테스트가 재판정을 강제할 때 사용."""
    global _READY
    _READY = None


def _database_url(settings: Settings) -> str:
    if not settings.database_url:
        raise RegulationSearchUnavailable("DATABASE_URL이 설정되지 않았습니다")
    return settings.database_url


def _vector_literal(vec: Sequence[float]) -> str:
    """pgvector 텍스트 리터럴, 예: '[0.1,0.2,...]' — pgvector-python 의존성 회피."""
    return "[" + ",".join(f"{x:.7f}" for x in vec) + "]"


def _embed_one(settings: Settings, text: str) -> list[float]:
    """rag._embed(Ollama bge-m3)를 재사용해 단일 텍스트를 1024차원 정규화 벡터로."""
    from app.services import rag  # 지연 import — 순환참조 회피

    return rag._embed(settings, [text])[0].tolist()


def pgvector_ready(settings: Settings) -> bool:
    """pgvector 경로를 쓸 수 있는지(확장 설치 + 청크 시드 완료). 결과는 캐시된다.

    온프레미스 bge-m3(1024차원)일 때만 유효하다 — 스키마의 vector(1024)와 맞아야 하므로
    use_local_models=False(OpenAI 1536차원)면 pgvector를 쓰지 않고 FAISS로 폴백한다.
    """
    global _READY
    if _READY is not None:
        return _READY
    _READY = _probe(settings)
    return _READY


def _probe(settings: Settings) -> bool:
    if not settings.use_local_models:  # pgvector 컬럼은 bge-m3(1024) 기준
        return False
    if not settings.database_url:
        return False
    try:
        with psycopg.connect(settings.database_url, connect_timeout=3) as connection:
            ext = connection.execute(
                "SELECT 1 FROM pg_extension WHERE extname = 'vector'"
            ).fetchone()
            if not ext:
                return False
            seeded = connection.execute(
                "SELECT count(*) FROM rag_chunks WHERE embedding IS NOT NULL"
            ).fetchone()
            return bool(seeded and seeded[0] > 0)
    except psycopg.Error:
        # rag_chunks 미존재/확장 미설치/연결 실패 → 폴백
        return False


def initialize_rag(settings: Settings) -> None:
    """rag 스키마 생성(pgvector 확장 필요). DB 없으면 no-op, 확장 없으면 예외."""
    if not settings.database_url:
        return
    schema = RAG_SCHEMA_PATH.read_text(encoding="utf-8")
    try:
        with psycopg.connect(settings.database_url) as connection:
            with connection.cursor() as cursor:
                cursor.execute(schema)
    except psycopg.Error as exc:
        raise RegulationSearchUnavailable("rag 스키마 초기화 실패") from exc


def seed_demo_regulations(settings: Settings) -> int:
    """rag._DOCS(더미 규정 청크)를 pgvector에 적재. 문서 1건=청크 1개. 멱등.

    실물 은행 PDF + 김민기 ingest.py가 도착하기 전까지 데모가 pgvector로 동작하도록
    기존 FAISS 코퍼스와 동일한 _DOCS를 그대로 임베딩해 넣는다.
    """
    from app.services import rag  # 지연 import

    docs = rag._DOCS
    if not docs:
        return 0

    texts = [d["text"] for d in docs]
    vectors = rag._embed(settings, texts)  # (N, 1024) L2정규화

    try:
        with psycopg.connect(_database_url(settings)) as connection:
            with connection.cursor() as cursor:
                cursor.execute(RAG_SCHEMA_PATH.read_text(encoding="utf-8"))
                for doc in docs:
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
                            status = EXCLUDED.status
                        """,
                        (
                            doc["doc_id"],
                            doc["title"],
                            "데모규정",
                            [doc["category"]],
                            "v1",
                            None,
                            "active",
                            "demo:bank.xlsx",
                        ),
                    )
                for doc, vec in zip(docs, vectors):
                    cursor.execute(
                        """
                        INSERT INTO rag_chunks
                            (chunk_id, doc_id, page, kind, section, raw, text, embedding)
                        VALUES (%s, %s, %s, %s, %s, %s, %s, %s::vector)
                        ON CONFLICT (chunk_id) DO UPDATE SET
                            section = EXCLUDED.section,
                            raw = EXCLUDED.raw,
                            text = EXCLUDED.text,
                            embedding = EXCLUDED.embedding
                        """,
                        (
                            f"{doc['doc_id']}-c1",
                            doc["doc_id"],
                            1,
                            "text",
                            doc.get("subcategory"),
                            doc["text"],
                            doc["text"],
                            _vector_literal(vec.tolist()),
                        ),
                    )
    except psycopg.Error as exc:
        raise RegulationSearchUnavailable("rag 시드 적재 실패") from exc

    reset_readiness()  # 시드 직후 재판정되게
    return len(docs)


_HYBRID_SQL = """
WITH sem AS (
    SELECT chunk_id, 1 - (embedding <=> %(qvec)s::vector) AS dense
    FROM rag_chunks
    WHERE embedding IS NOT NULL
    ORDER BY embedding <=> %(qvec)s::vector
    LIMIT 50
)
SELECT
    c.doc_id, d.title, c.section, c.raw, d.categories,
    (%(wd)s * sem.dense
     + %(wk)s * ts_rank(c.tsv, plainto_tsquery('simple', %(q)s))) AS score
FROM sem
JOIN rag_chunks c USING (chunk_id)
JOIN rag_documents d ON d.doc_id = c.doc_id
WHERE d.status = 'active'
  AND (%(cats)s::text[] IS NULL OR d.categories && %(cats)s::text[])
ORDER BY score DESC
LIMIT %(limit)s
"""


def search_regulations(
    settings: Settings,
    query: str,
    top_k: int = 3,
    categories: list[str] | None = None,
) -> list[RagDocument]:
    """하이브리드 규정 검색(시맨틱 <=> 코사인 + 키워드 ts_rank). RagDocument로 반환.

    search_procedures와 동일한 필터 의미: categories가 주어지면 그 대분류(taxonomy 코드)로
    좁힌다(배열 겹침). status='active'로 supersede된 옛 규정은 제외한다.
    """
    query = (query or "").strip()
    if not query:
        return []

    cats = [c.upper() for c in categories] if categories else None
    qvec = _vector_literal(_embed_one(settings, query))
    params = {
        "qvec": qvec,
        "q": query,
        "wd": W_DENSE,
        "wk": W_KEYWORD,
        "cats": cats,
        "limit": top_k,
    }
    with psycopg.connect(_database_url(settings), row_factory=dict_row) as connection:
        with connection.cursor() as cursor:
            cursor.execute(_HYBRID_SQL, params)
            rows = cursor.fetchall()

    documents: list[RagDocument] = []
    for r in rows:
        cats_row = list(r["categories"] or [])
        documents.append(
            RagDocument(
                doc_id=r["doc_id"],
                title=r["title"],
                excerpt=r["raw"] or "",
                score=round(float(r["score"]), 3),
                category=cats_row[0] if cats_row else None,
                subcategory=r["section"],
            )
        )
    return documents


# ── 김민기 store.py에서 흡수한 함수 (ADR-0012 pgvector 단일화) ─────────────────
# 적재/문서조회/통계. 이식하며 upsert의 임베딩을 이 모듈 표준(rag._embed → Ollama
# bge-m3)으로 통일했다 — 위 seed_demo_regulations·search_regulations와 같은 벡터
# 공간이라야 검색이 맞는다. (김민기 원본은 FlagEmbedding이었음.)
#
# ⚠️ 현재 데모는 FAISS 폴백으로 돌고 pgvector 경로는 휴면 상태다(pgvector_ready()=False).
#    app/rag/store.py에 남아 있는 김민기 search_regulations(compat.py 전용)는 아직
#    FlagEmbedding 질의라, pgvector를 실가동할 때 그 경로도 이 모듈로 일원화해야 한다.

def upsert_documents_and_chunks(
    settings: Settings, chunks: Sequence[Mapping[str, Any]]
) -> int:
    """ingest.py 산출 청크(dict)를 rag_documents + rag_chunks에 적재. 반환=적재 청크 수.

    멱등: 같은 chunk_id 재실행 시 text/embedding 교체, 문서 version/status/effective_date
    갱신(supersede 지원). 임베딩은 rag._embed(Ollama bge-m3, 1024차원 L2정규화)로 배치.
    """
    if not chunks:
        return 0

    from app.services import rag  # 지연 import — 순환참조 회피

    vectors = rag._embed(settings, [c["text"] for c in chunks])  # (N, 1024)

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
                            _vector_literal(vec.tolist()),
                        ),
                    )
    except psycopg.Error as exc:
        raise RegulationSearchUnavailable("regulation upsert failed") from exc
    reset_readiness()  # 적재 직후 재판정되게
    return len(chunks)


def get_regulation_document(settings: Settings, doc_id: str) -> dict[str, Any] | None:
    """문서 메타 + 페이지순 청크 전체 — 프론트 '원문 열람 시트'(엑셀 룩) 데이터."""
    try:
        with psycopg.connect(
            _database_url(settings), row_factory=dict_row
        ) as connection:
            with connection.cursor() as cursor:
                cursor.execute(
                    "SELECT doc_id, title, doc_type, categories, version, effective_date, source_file "
                    "FROM rag_documents WHERE doc_id = %s AND status = 'active'",
                    (doc_id,),
                )
                doc = cursor.fetchone()
                if doc is None:
                    return None
                cursor.execute(
                    "SELECT chunk_id, page, kind, section, raw "
                    "FROM rag_chunks WHERE doc_id = %s ORDER BY page, chunk_id",
                    (doc_id,),
                )
                chunks = cursor.fetchall()
    except psycopg.Error as exc:
        raise RegulationSearchUnavailable("regulation document query failed") from exc
    return {
        "doc_id": doc["doc_id"],
        "title": doc["title"],
        "doc_type": doc["doc_type"],
        "categories": list(doc["categories"] or []),
        "version": doc["version"],
        "effective_date": str(doc["effective_date"]) if doc["effective_date"] else None,
        "source_file": doc["source_file"],
        "chunks": [
            {
                "chunk_id": c["chunk_id"],
                "page": c["page"],
                "kind": c["kind"],
                "section": c["section"],
                "text": c["raw"],
            }
            for c in chunks
        ],
    }


def get_regulation_stats(settings: Settings) -> dict[str, int]:
    """활성 문서·청크 수 — 관리자 콘솔 'DB·지식베이스' 패널의 실측 통계."""
    try:
        with psycopg.connect(_database_url(settings)) as connection:
            with connection.cursor() as cursor:
                cursor.execute(
                    "SELECT count(*) FROM rag_documents WHERE status = 'active'"
                )
                documents = cursor.fetchone()[0]
                cursor.execute(
                    """
                    SELECT count(*)
                    FROM rag_chunks c
                    JOIN rag_documents d ON d.doc_id = c.doc_id
                    WHERE d.status = 'active'
                    """
                )
                chunks = cursor.fetchone()[0]
    except psycopg.Error as exc:
        raise RegulationSearchUnavailable("regulation stats query failed") from exc
    return {"documents": documents, "chunks": chunks}
