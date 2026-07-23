"""규정 지식베이스 API(/api/v1/regulations/*) 계약 테스트.

팀 프론트(`kda4-k7-product`의 regulationSearch.ts · regulationAdmin.ts)가 기대하는
응답 형태를 고정한다 — 이 계약이 깨지면 상담사 화면의 "관련 규정" 패널과 관리자
콘솔의 "DB·지식베이스" 패널이 조용히 빈 화면이 된다.

test_rag.py와 같이 라이브 임베딩 없이 돌도록 _embed를 결정적 가짜로 대체한다.
"""

import numpy as np
import pytest
from fastapi.testclient import TestClient

from app.services import rag
from app.services.regulation_ingest import normalize_filename, suggest_category

_VOCAB = [
    "지급정지", "보이스피싱", "대출", "만기", "연장", "해외송금",
    "착오송금", "이체", "한도", "청약", "예금", "연금",
]


def _fake_embed(_settings, texts):
    vecs = np.zeros((len(texts), len(_VOCAB)), dtype="float32")
    for i, text in enumerate(texts):
        for j, word in enumerate(_VOCAB):
            if word in text:
                vecs[i, j] = 1.0
    norms = np.linalg.norm(vecs, axis=1, keepdims=True)
    norms[norms == 0] = 1.0
    return (vecs / norms).astype("float32")


@pytest.fixture(autouse=True)
def _stub_embedding(monkeypatch, tmp_path):
    # 디스크에 영속된 실제 인덱스(bge-m3 1024차원)를 로드하면 가짜 임베딩과 차원이
    # 어긋난다. 인덱스 디렉터리를 임시경로로 돌려 항상 새로 빌드하게 하고,
    # 테스트가 실제 코퍼스 인덱스를 덮어쓰지 않도록 격리한다.
    monkeypatch.setattr(rag, "_INDEX_DIR", tmp_path)
    monkeypatch.setattr(rag, "_embed", _fake_embed)
    rag._index_cache.clear()
    yield
    rag._index_cache.clear()


@pytest.fixture
def client():
    from app.main import app

    return TestClient(app)


# ── 통계 ────────────────────────────────────────────────────────────────────

def test_stats_returns_positive_counts(client):
    body = client.get("/api/v1/regulations/stats").json()
    assert body["available"] is True
    assert body["chunks"] >= body["documents"] >= 1


# ── 검색 ────────────────────────────────────────────────────────────────────

def test_search_response_matches_frontend_contract(client):
    body = client.get(
        "/api/v1/regulations/search", params={"q": "착오송금", "k": 3}
    ).json()

    assert set(body) == {"query", "category", "available", "documents"}
    assert body["available"] is True
    assert body["documents"], "검색 결과가 비어 있으면 프론트 패널이 빈 화면이 된다"

    # RegulationHit — 하나라도 빠지면 프론트가 undefined를 렌더한다.
    for hit in body["documents"]:
        assert set(hit) == {
            "chunk_id", "doc_id", "title", "page", "section", "kind",
            "categories", "version", "excerpt", "score",
            "score_dense", "score_keyword",
        }
        assert isinstance(hit["categories"], list)
        assert isinstance(hit["page"], int)
        assert hit["kind"] in {"text", "table"}


def test_search_honours_category_filter(client):
    body = client.get(
        "/api/v1/regulations/search", params={"q": "대출", "category": "SG", "k": 5}
    ).json()
    for hit in body["documents"]:
        assert "SG" in hit["categories"]


def test_search_rejects_empty_query_and_unknown_category(client):
    assert client.get("/api/v1/regulations/search", params={"q": "  "}).status_code == 400
    res = client.get(
        "/api/v1/regulations/search", params={"q": "대출", "category": "NOPE"}
    )
    assert res.status_code == 400
    assert "NOPE" in res.json()["detail"]


# ── 원문 열람 ───────────────────────────────────────────────────────────────

def test_document_returns_meta_and_ordered_chunks(client):
    doc_id = rag.document_id_of(rag._DOCS[0])
    body = client.get(f"/api/v1/regulations/documents/{doc_id}").json()

    assert set(body) == {
        "doc_id", "title", "doc_type", "categories", "version",
        "effective_date", "source_file", "chunks",
    }
    pages = [c["page"] for c in body["chunks"]]
    assert pages == sorted(pages), "원문 시트는 페이지순이어야 한다"


def test_unknown_document_is_404(client):
    assert client.get("/api/v1/regulations/documents/nope-999").status_code == 404


# ── 적재 보조 로직 ──────────────────────────────────────────────────────────

def test_normalize_filename_restores_mojibake():
    broken = "대출약정서.pdf".encode("utf-8").decode("latin-1")
    assert normalize_filename(broken) == "대출약정서.pdf"


@pytest.mark.parametrize("name,expected", [
    ("대출약정서.pdf", "LON"),
    ("주택청약예금규정.pdf", "DEP"),
    ("보이스피싱_지급정지_절차.pdf", "SG"),
    ("해외송금_서류안내.pdf", "FX"),
])
def test_suggest_category_from_filename(name, expected):
    assert suggest_category(name)["department"] == expected


def test_suggest_category_falls_back_to_etc():
    sugg = suggest_category("untitled.pdf")
    assert sugg["department"] == "ETC"
    assert sugg["confidence"] == 0.0


def test_upload_rejects_non_pdf(client):
    res = client.post(
        "/api/v1/regulations/upload",
        files={"pdf": ("note.txt", b"not a pdf", "text/plain")},
    )
    assert res.status_code == 415
