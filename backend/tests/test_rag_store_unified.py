"""이식 후 pgvector 저장소가 하나인지 — 김민기 기능이 실행 엔진 쪽에 있어야 한다.

ADR-0012: 두 저장소(김민기 app/rag/store.py, 실행 엔진 app/services/rag_store.py)의
pgvector 구현을 rag_store 하나로 통합한다. 김민기 고유 함수(적재·문서조회·통계)가
rag_store에 흡수되고, app/rag/store.py는 하위호환 재노출만 남는다.
"""

from app.services import rag_store


def test_적재_기능이_실행엔진_저장소에_있다():
    assert hasattr(rag_store, "upsert_documents_and_chunks")


def test_문서조회_기능이_실행엔진_저장소에_있다():
    assert hasattr(rag_store, "get_regulation_document")


def test_통계_기능이_실행엔진_저장소에_있다():
    assert hasattr(rag_store, "get_regulation_stats")


def test_가용성_게이팅이_유지된다():
    assert hasattr(rag_store, "pgvector_ready")
    assert hasattr(rag_store, "search_regulations")


def test_김민기_store는_재노출_shim이다():
    """auto_ingest 등 기존 호출부가 깨지지 않도록 store가 rag_store를 재노출한다."""
    from app.rag import store

    # 같은 객체를 가리켜야 통합된 것(별도 구현이 아님)
    assert store.upsert_documents_and_chunks is rag_store.upsert_documents_and_chunks
    assert store.get_regulation_document is rag_store.get_regulation_document
    assert store.get_regulation_stats is rag_store.get_regulation_stats
    # 예외 클래스도 하나여야 catch가 어긋나지 않는다
    assert store.RegulationSearchUnavailable is rag_store.RegulationSearchUnavailable
