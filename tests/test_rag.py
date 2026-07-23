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


# ── 부서 추론은 '가점'이지 '배제'가 아니다 (2026-07-23) ──────────────────
# 실사례: "카드가 해외에서 250달러 결제" → '달러'가 FX를 추론시켜 외환약관만
# 반환되고, 정작 관련성이 높은 카드(CRD) 규정이 후보에서 밀려났다.

# '달러'는 FX를 추론시키지만 의미상 기여는 거의 없다 — 실사례와 같은 모양.
_FX_TRIGGER_BUT_SG_QUERY = "지급정지 보이스피싱 달러"


def test_의미없는_트리거어가_부서를_고정하지_않는다():
    """'달러' 한 단어로 FX가 추론돼도, 의미상 맞는 SG가 1위여야 한다."""
    assert rag._infer_categories(_FX_TRIGGER_BUT_SG_QUERY) == ["FX"]  # 전제 확인

    docs = rag.search_procedures(_SETTINGS, _FX_TRIGGER_BUT_SG_QUERY, top_k=3)

    assert docs
    assert docs[0].category == "SG", [(d.category, d.score) for d in docs]


def test_추론된_부서는_결과를_독점하지_않는다():
    """추론 부서(FX)가 후보를 전부 차지하면 안 된다."""
    docs = rag.search_procedures(_SETTINGS, _FX_TRIGGER_BUT_SG_QUERY, top_k=3)

    assert {d.category for d in docs} != {"FX"}, [(d.category, d.score) for d in docs]


# ── 코퍼스 지문: 영속 인덱스가 낡았는지 판별 (2026-07-23) ──────────────────
# 기존 검증은 index.ntotal == len(_DOCS) 즉 **개수만** 봤다. 재전처리로 내용이
# 바뀌었는데 청크 수가 같으면 낡은 인덱스를 조용히 로드해 벡터와 문서가 어긋난다.

def test_코퍼스_지문은_개수가_같아도_내용이_바뀌면_달라진다():
    before = rag._corpus_fingerprint()
    original = rag._DOCS[0]["text"]
    try:
        rag._DOCS[0]["text"] = original + " (재전처리로 문구 변경)"
        after = rag._corpus_fingerprint()
    finally:
        rag._DOCS[0]["text"] = original

    assert before != after
    assert rag._corpus_fingerprint() == before  # 복원되면 지문도 돌아온다


def test_가점이_붙어도_표시_점수는_내림차순이다():
    """가점은 선정에만 쓰고 순서는 원점수 기준 — 화면에서 정렬이 깨져 보이면 안 된다."""
    docs = rag.search_procedures(_SETTINGS, _FX_TRIGGER_BUT_SG_QUERY, top_k=3)

    assert all(a.score >= b.score for a, b in zip(docs, docs[1:])), \
        [(d.category, d.score) for d in docs]


def test_호출자가_지정한_부서는_여전히_하드필터다():
    """추론과 달리 호출자가 명시한 categories는 강제 필터로 남는다(김민기 설계)."""
    docs = rag.search_procedures(
        _SETTINGS, _FX_TRIGGER_BUT_SG_QUERY, top_k=5, categories=["SG"]
    )

    assert docs
    assert all(d.category == "SG" for d in docs)
