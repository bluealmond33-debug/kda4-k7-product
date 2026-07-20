"""Query/passage embedding for regulation search.

Production is BAAI/bge-m3 (1024-dim dense, onprem/local) via FlagEmbedding —
same model the model team already runs. It is imported lazily so the API boots
without the heavy dependency; when it is absent, ``is_available()`` is False and
regulation search degrades to placeholder documents rather than crashing.

``K7_EMBED=static`` selects a light 256-dim multilingual model (model2vec, no
torch) for offline demos. The pgvector column dimension must match the model in
use, so the demo path is only for a separately provisioned 256-dim index; the
default onprem path stays bge-m3/1024.
"""

from __future__ import annotations

import os

EMBED_DIM = 1024  # bge-m3; keep in sync with database/rag/schema.sql

_MODEL = None
_BACKEND: str | None = None
_TRIED = False


def _try_load() -> None:
    global _MODEL, _BACKEND, _TRIED
    if _TRIED:
        return
    _TRIED = True
    want = os.environ.get("K7_EMBED", "bge-m3")

    if want in ("bge-m3", "auto"):
        try:
            from FlagEmbedding import BGEM3FlagModel  # type: ignore

            _MODEL = BGEM3FlagModel("BAAI/bge-m3", use_fp16=False)
            _BACKEND = "bge-m3"
            return
        except Exception:
            if want == "bge-m3":
                return  # onprem model missing -> search unavailable

    try:
        from model2vec import StaticModel  # type: ignore

        _MODEL = StaticModel.from_pretrained("minishlab/potion-multilingual-128M")
        _BACKEND = "static"
    except Exception:
        _BACKEND = None


def is_available() -> bool:
    _try_load()
    return _MODEL is not None


def backend() -> str | None:
    _try_load()
    return _BACKEND


def dimension() -> int:
    return EMBED_DIM if backend() == "bge-m3" else 256


def embed(texts: list[str]) -> list[list[float]]:
    """L2-normalized dense vectors, one per input text."""
    _try_load()
    if _MODEL is None:
        raise RuntimeError("no embedding backend available")

    if _BACKEND == "bge-m3":
        raw = _MODEL.encode(texts, batch_size=16, max_length=1024)["dense_vecs"]
        rows = [list(map(float, v)) for v in raw]
    else:
        rows = [list(map(float, v)) for v in _MODEL.encode(list(texts))]

    out = []
    for v in rows:
        norm = sum(x * x for x in v) ** 0.5 or 1.0
        out.append([x / norm for x in v])
    return out
