"""Regulation search endpoint + legacy /rag fallback (no DB / no model needed).

Verifies graceful degradation: without a provisioned pgvector index or embedding
model, the panel endpoint reports available=false (not an error) and the legacy
/rag keeps returning placeholder documents so nothing breaks.
"""

from fastapi.testclient import TestClient

from app.main import app


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


def test_legacy_rag_falls_back_to_placeholder_documents() -> None:
    with TestClient(app) as client:
        response = client.post("/rag", json={"query": "지급정지"})
    assert response.status_code == 200
    docs = response.json()["documents"]
    assert isinstance(docs, list) and docs  # placeholder docs, never empty
    assert {"doc_id", "title", "excerpt", "score"} <= set(docs[0])
