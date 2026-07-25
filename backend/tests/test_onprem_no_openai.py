"""온프레미스 모드에서 OpenAI를 단 한 번도 호출하지 않는다는 것을 강제한다.

ADR-0011(완전 온프레미스 전면 전환)의 회귀 방지 장치이자 발표 근거다.
"금융 민감정보를 외부로 보내지 않는다"가 이 프로젝트의 핵심 주장이므로,
누군가 실수로 클라우드 경로를 되살리면 여기서 바로 깨져야 한다.

방식: OpenAI 클라이언트 생성 자체를 폭탄으로 바꾼 뒤 파이프라인을 태운다.
use_local_models=True에서 통과하면 그 경로에 OpenAI가 없다는 뜻이다.
"""

import numpy as np
import pytest

from app.config import Settings
from app.services import rag


class OpenAICalled(AssertionError):
    """온프레미스 경로에서 OpenAI가 호출되면 터진다."""


@pytest.fixture
def onprem(monkeypatch):
    """OpenAI 진입점을 전부 폭탄으로 교체한 온프레미스 설정."""

    def boom(*_args, **_kwargs):
        raise OpenAICalled("온프레미스 경로에서 OpenAI를 호출했다 — ADR-0011 위반")

    monkeypatch.setattr("app.services.rag.OpenAI", boom)
    monkeypatch.setattr("app.services.rag._embed_openai", boom)
    return Settings(
        openai_api_key="",          # 키가 아예 없는 상태를 재현
        use_local_models=True,
    )


@pytest.fixture
def cloud():
    return Settings(openai_api_key="sk-test", use_local_models=False)


def _fake_ollama_embed(_settings, texts):
    """Ollama bge-m3 대역 — 네트워크 없이 로컬 경로만 확인한다."""
    vecs = np.zeros((len(texts), 8), dtype="float32")
    for i, text in enumerate(texts):
        for j, word in enumerate(["착오송금", "지급정지", "대출", "예금",
                                  "해외송금", "연금", "카드", "인증"]):
            if word in text:
                vecs[i, j] = 1.0
    norms = np.linalg.norm(vecs, axis=1, keepdims=True)
    norms[norms == 0] = 1.0
    return (vecs / norms).astype("float32")


def test_embedding_uses_ollama_not_openai(onprem, monkeypatch):
    """임베딩 분기가 로컬(bge-m3)로 간다 — _embed_openai가 불리면 폭탄."""
    called = {}

    def fake_ollama(settings, texts):
        called["yes"] = True
        return _fake_ollama_embed(settings, texts)

    monkeypatch.setattr(rag, "_embed_ollama", fake_ollama)
    rag._embed(onprem, ["착오송금 반환 절차"])
    assert called.get("yes"), "온프레미스인데 Ollama 임베딩을 타지 않았다"


def test_regulation_search_completes_without_openai(onprem, monkeypatch, tmp_path):
    """규정 검색 전체가 OpenAI 없이 완주한다."""
    monkeypatch.setattr(rag, "_INDEX_DIR", tmp_path)
    monkeypatch.setattr(rag, "_embed", _fake_ollama_embed)
    rag._index_cache.clear()
    try:
        docs = rag.search_procedures(onprem, "착오송금", top_k=3)
    finally:
        rag._index_cache.clear()
    assert docs, "온프레미스 규정 검색이 빈손으로 끝났다"


def test_cloud_path_still_reaches_openai(cloud, monkeypatch):
    """폴백(클라우드) 경로는 살아 있어야 한다 — ADR-0011 §5.

    온프레미스를 지키자고 폴백을 지워버리면 장비 장애 시 대안이 없다.
    이 테스트는 '폴백이 제거되지 않았음'을 보장한다.
    """
    def boom(*_args, **_kwargs):
        raise OpenAICalled("cloud 경로가 OpenAI에 도달함(정상)")

    monkeypatch.setattr(rag, "_embed_openai", boom)
    with pytest.raises(OpenAICalled):
        rag._embed(cloud, ["텍스트"])


def test_local_stt_and_llm_modules_have_no_openai_import():
    """온프레미스 STT·LLM 모듈에 OpenAI 의존이 섞여 들어오지 않았는지 확인.

    주석·docstring의 "OpenAI 미사용" 같은 언급은 걸러야 하므로 실제 import 문만
    AST로 본다.
    """
    import ast
    import inspect

    from app.services import local_llm, local_stt

    for module in (local_stt, local_llm):
        tree = ast.parse(inspect.getsource(module))
        imported: list[str] = []
        for node in ast.walk(tree):
            if isinstance(node, ast.Import):
                imported += [a.name for a in node.names]
            elif isinstance(node, ast.ImportFrom) and node.module:
                imported.append(node.module)
        offenders = [m for m in imported if "openai" in m.lower()]
        assert not offenders, (
            f"{module.__name__}이 {offenders}를 import한다 — 온프레미스 경로가 오염됐다"
        )
