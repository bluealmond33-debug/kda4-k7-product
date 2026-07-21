"""End-to-end regulation RAG against a real PostgreSQL + pgvector instance.

Skipped unless K7_TEST_DATABASE_URL points at a pgvector-enabled database AND an
embedding backend is installed (bge-m3, or K7_EMBED=static). Mirrors the skip
convention in test_database_integration.py.
"""

import os

import pytest

from app.config import Settings
from app.rag import embedder, search_regulations
from app.rag.ingest import ingest_pdf
from app.rag.store import initialize_rag, upsert_documents_and_chunks

DATABASE_URL_ENV = "K7_TEST_DATABASE_URL"

_IRP = {
    "doc_id": "test-irp",
    "title": "개인형IRP 핵심설명서",
    "filename": "irp.pdf",
    "doc_type": "핵심설명서",
    "categories": ["INV", "퇴직연금", "IRP"],
    "version": "v1",
    "status": "active",
}
_LOAN = {
    "doc_id": "test-jungdogeum",
    "title": "중도금대출 상품설명서",
    "filename": "loan.pdf",
    "doc_type": "상품설명서",
    "categories": ["LON", "중도금대출"],
    "version": "v1",
    "status": "active",
}


def _requirements() -> Settings:
    database_url = os.getenv(DATABASE_URL_ENV)
    if not database_url:
        pytest.skip(f"{DATABASE_URL_ENV} is not configured")
    if not embedder.is_available():
        pytest.skip("no embedding backend installed")
    irp = os.getenv("K7_TEST_IRP_PDF")
    loan = os.getenv("K7_TEST_LOAN_PDF")
    if not (irp and loan and os.path.exists(irp) and os.path.exists(loan)):
        pytest.skip("set K7_TEST_IRP_PDF and K7_TEST_LOAN_PDF to real PDFs")
    return Settings(database_url=database_url)


@pytest.mark.integration
def test_category_filter_scopes_results_to_the_loan_document() -> None:
    settings = _requirements()
    initialize_rag(settings)
    chunks = ingest_pdf(os.environ["K7_TEST_IRP_PDF"], _IRP)
    chunks += ingest_pdf(os.environ["K7_TEST_LOAN_PDF"], _LOAN)
    written = upsert_documents_and_chunks(settings, chunks)
    assert written == len(chunks)

    # LON filter must not return any INV(연금) chunk
    hits = search_regulations(settings, "대출 상환 의무", category="LON", limit=5)
    assert hits, "expected at least one loan regulation hit"
    assert all(h["doc_id"] == "test-jungdogeum" for h in hits)
    assert all("LON" in h["categories"] for h in hits)


@pytest.mark.integration
def test_hybrid_ranks_the_relevant_clause_first() -> None:
    settings = _requirements()
    initialize_rag(settings)
    chunks = ingest_pdf(os.environ["K7_TEST_IRP_PDF"], _IRP)
    upsert_documents_and_chunks(settings, chunks)

    hits = search_regulations(settings, "세액공제 받고 중도해지하면 세금", limit=3)
    assert hits
    assert "세액공제" in hits[0]["excerpt"] or "중도해지" in hits[0]["excerpt"]
    # provenance for the "원본 열기" UX
    assert hits[0]["page"] >= 1 and "doc_id" in hits[0]
