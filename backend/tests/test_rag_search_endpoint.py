"""Regulation search endpoint + legacy /rag route.

Panel endpoint(/api/v1/regulations/search) degrades gracefully: without a
provisioned pgvector index or embedding model it reports available=false
(not an error). The legacy /rag route runs the engine's search_procedures
(FAISS fallback) and returns RagDocuments.

ADR-0012 이식: compat 라우터를 걷어내 /rag는 이제 엔진 pipeline 라우터가
RagRequest(reason_codes+summary) 계약으로 제공한다. 임베딩은 결정적 가짜로
대체해 Ollama 없이 검증한다.
"""

import numpy as np
import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.services import rag


@pytest.fixture
def fake_embedding(monkeypatch, tmp_path):
    """Ollama 없이 FAISS 검색이 돌도록 임베딩을 결정적 가짜로 대체한다."""
    vocab = ["지급정지", "보이스피싱", "대출", "착오송금", "해외송금", "예금"]

    def _fake(_settings, texts):
        vecs = np.zeros((len(texts), len(vocab)), dtype="float32")
        for i, t in enumerate(texts):
            for j, w in enumerate(vocab):
                if w in t:
                    vecs[i, j] = 1.0
        norms = np.linalg.norm(vecs, axis=1, keepdims=True)
        norms[norms == 0] = 1.0
        return (vecs / norms).astype("float32")

    monkeypatch.setattr(rag, "_INDEX_DIR", tmp_path)
    monkeypatch.setattr(rag, "_embed", _fake)
    rag._index_cache.clear()
    yield
    rag._index_cache.clear()


def test_regulation_search_degrades_gracefully_without_index() -> None:
    with TestClient(app) as client:
        response = client.get("/api/v1/regulations/search", params={"q": "만기 연장"})
    assert response.status_code == 200
    body = response.json()
    assert body["available"] is False       # no DB/model in CI
    assert body["documents"] == []
    assert body["query"] == "만기 연장"


def test_regulation_search_rejects_unknown_category() -> None:
    with TestClient(app) as client:
        response = client.get(
            "/api/v1/regulations/search", params={"q": "대출", "category": "ZZZ"}
        )
    assert response.status_code == 400


def test_regulation_search_requires_query() -> None:
    with TestClient(app) as client:
        response = client.get("/api/v1/regulations/search", params={"q": "  "})
    assert response.status_code == 400


def test_rag_route_returns_documents(fake_embedding) -> None:
    """엔진 /rag: RagRequest(reason_codes+summary) → search_procedures → RagDocuments."""
    with TestClient(app) as client:
        response = client.post(
            "/rag",
            json={"reason_codes": ["FINANCIAL_ACCIDENT"], "summary": "지급정지 신청"},
        )
    assert response.status_code == 200
    docs = response.json()["documents"]
    assert isinstance(docs, list) and docs  # 코퍼스가 있어 비지 않는다
    assert {"doc_id", "title", "excerpt", "score"} <= set(docs[0])


def test_rag_route_rejects_legacy_body() -> None:
    """옛 compat 계약({query})은 이제 422 — 엔진 RagRequest 스키마로 바뀌었다."""
    with TestClient(app) as client:
        response = client.post("/rag", json={"query": "지급정지"})
    assert response.status_code == 422
