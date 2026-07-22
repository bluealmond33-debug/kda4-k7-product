"""Regulation RAG — hybrid search over bank manuals for the 상담 콘솔.

Public surface used by the app:
    from app.rag import search_regulations, initialize_rag
    from app.rag.store import RegulationSearchUnavailable

Everything degrades gracefully: without a database or embedding backend the
caller gets ``RegulationSearchUnavailable`` and can fall back to placeholders.
"""

from app.rag.store import (
    RegulationSearchUnavailable,
    initialize_rag,
    search_regulations,
    get_regulation_document,
)

__all__ = [
    "RegulationSearchUnavailable",
    "initialize_rag",
    "search_regulations",
    "get_regulation_document",
]
