"""rag.py — 김민기 taxonomy 이식분 회귀 테스트.

라이브 임베딩(OpenAI/Ollama) 없이 돌도록 _embed를 결정적 가짜로 대체한다.
가짜 임베딩은 청크 텍스트의 키워드 겹침을 코사인 유사도처럼 흉내낸다.
"""

import numpy as np
import pytest

from app.config import Settings
from app.services import rag

_VOCAB = [
    "지급정지", "보이스피싱", "피싱", "대출", "만기", "연장", "해외송금",
    "OTP", "인증서", "압류", "착오송금", "해지", "이체", "한도", "휴면",
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
def _mock_embed(monkeypatch):
    # 인덱스 캐시를 비워 가짜 임베딩으로 새로 만들게 한다.
    rag._index_cache.clear()
    monkeypatch.setattr(rag, "_embed", _fake_embed)
    yield
    rag._index_cache.clear()


_SETTINGS = Settings(openai_api_key="test", use_local_models=False)


def test_taxonomy_has_eight_closed_categories():
    assert len(rag.TAXONOMY) == 8
    assert set(rag.TAXONOMY) == {"DEP", "LON", "CRD", "FX", "EFN", "INV", "SG", "ETC"}


def test_every_chunk_uses_a_valid_taxonomy_code():
    for doc in rag._DOCS:
        assert doc["category"] in rag.TAXONOMY, doc["doc_id"]


def test_search_returns_scored_documents_with_category():
    docs = rag.search_procedures(_SETTINGS, "보이스피싱 지급정지 피싱", top_k=3)
    assert docs
    assert len(docs) <= 3
    assert docs[0].category == "SG"
    # 점수 내림차순
    assert all(a.score >= b.score for a, b in zip(docs, docs[1:]))


def test_category_filter_returns_only_allowed_categories():
    # 쿼리가 외환/전자금융 쪽이라도 SG로 강제 필터되면 전부 SG여야 한다.
    docs = rag.search_procedures(
        _SETTINGS, "해외송금 OTP 인증서", top_k=5, categories=["SG"]
    )
    assert docs
    assert all(d.category == "SG" for d in docs)


def test_unfiltered_search_can_reach_non_sg_category():
    docs = rag.search_procedures(_SETTINGS, "대출 만기 연장 한도", top_k=3)
    assert docs
    assert docs[0].category == "LON"
