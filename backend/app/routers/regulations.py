"""규정 지식베이스 API — /api/v1/regulations/*

팀 프론트(`kda4-k7-product`)의 두 화면이 이 엔드포인트를 부른다.

- 상담사 화면 "관련 규정 및 매뉴얼" 패널 → `search`, `documents/{doc_id}`
- 관리자 콘솔 "DB·지식베이스" 패널     → `stats`, `upload`

계약은 팀 모노레포 `backend/app/main.py`의 같은 경로와 **동일**하다
(프론트 `src/services/regulationSearch.ts` · `regulationAdmin.ts` 기준).
그래야 프론트가 `VITE_API_BASE_URL`만 이 온프레미스 백엔드로 돌리면
관제 대시보드까지 그대로 동작한다 — ADR-0011 §2 "실행 엔진" 역할.

검색 실체는 `app/services/rag.search_procedures()`이므로 pgvector가 준비되면
자동으로 그 경로를, 아니면 FAISS 폴백을 탄다(ADR-0010 실행환경 단서).
"""

import logging
import re
import shutil
import tempfile
from pathlib import Path

from fastapi import APIRouter, File, HTTPException, UploadFile, status

from app.config import settings
from app.services import rag

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/regulations", tags=["regulations"])

_SECTION_PREFIX_RE = re.compile(r"^제?\s*\d+\s*[조절항]\s*[.·]?\s*")


def _hit(doc, meta: dict | None) -> dict:
    """RagDocument + 원본 메타 → 프론트 `RegulationHit`.

    메타는 김동희 실규정 청크에만 있다. 시드 더미(sg-001 등)는 문서=청크 1:1이라
    page=1 / kind=text / version=v1로 채운다 — 프론트는 값이 있기만 하면 된다.
    """
    meta = meta or {}
    categories = meta.get("categories") or ([doc.category] if doc.category else [])
    return {
        "chunk_id": meta.get("chunk_id") or doc.doc_id,
        "doc_id": rag.document_id_of(meta) if meta else doc.doc_id,
        "title": doc.title,
        "page": meta.get("page") or 1,
        "section": meta.get("section") or doc.subcategory,
        "kind": meta.get("kind") or "text",
        "categories": categories,
        "version": meta.get("version") or "v1",
        "excerpt": doc.excerpt,
        "score": doc.score,
        # FAISS 폴백은 코사인 dense 단일 점수다. pgvector 하이브리드로 전환되면
        # 여기에 실제 키워드 점수가 실린다(0.65/0.35 가중, ADR-0010).
        "score_dense": doc.score,
        "score_keyword": 0.0,
        # 조항/항목/내용/안내멘트 — 화면이 정리된 표로 보여 주려면 여기 실려야 한다.
        # 없는 청크(시드 더미·구버전 적재분)도 있으므로 **선택 필드**다: 값이 없으면
        # None으로 나가고 화면은 excerpt로 폴백한다 — 재적재 없이도 검색은 계속 돈다.
        "structured": meta.get("structured"),
    }


def _short_label(doc) -> str:
    """RagDocument → 추천 칩용 짧은 라벨. 프론트 regulationSearch.ts의 shortLabel()과 동일 규칙."""
    raw = (doc.subcategory or doc.title or "").strip()
    cleaned = _SECTION_PREFIX_RE.sub("", raw)
    return re.sub(r"\s+", " ", cleaned).strip()[:20]


@router.get("/suggest")
def suggest_regulation_terms(q: str, category: str | None = None) -> dict:
    """관련 규정 추천 칩(자동완성) — search()와 별개 엔드포인트다.

    후보를 넉넉히(top_k=12) 뽑은 뒤 로컬 LLM(EXAONE)이 지금 발화와 관련된 것만 추리고
    순서를 매긴다 — 상위 5개를 그대로 보여주던 예전 방식은 문서 제목이 우연히 걸리느냐에
    따라 매번 다르게 나왔다(현장 피드백: "어떤 건 나오고 어떤 건 안 나와"). LLM이 실패하거나
    설치 안 됐으면 의미검색 점수순 그대로 폴백한다 — 화면은 항상 뭔가 뜬다.
    """
    query = q.strip()
    if not query:
        raise HTTPException(status_code=400, detail="q is required")
    if category is not None and category not in rag.TAXONOMY:
        raise HTTPException(status_code=400, detail=f"unknown category: {category}")

    try:
        docs = rag.search_procedures(
            settings, query, top_k=12, categories=[category] if category else None,
        )
    except Exception:
        logger.warning("규정 추천 검색 실패 — available=false로 강등", exc_info=True)
        return {"query": query, "category": category, "available": False, "terms": []}

    seen: set[str] = set()
    candidates: list[dict] = []
    for d in docs:
        label = _short_label(d)
        if label and label not in seen:
            seen.add(label)
            candidates.append({"term": label, "doc_id": d.doc_id, "score": d.score})

    if not candidates:
        return {"query": query, "category": category, "available": True, "terms": []}

    from app.services.local_llm import suggest_reg_terms_with_llm

    picked = suggest_reg_terms_with_llm(settings, query, [c["term"] for c in candidates])
    by_term = {c["term"]: c for c in candidates}
    terms = [by_term[t] for t in picked if t in by_term] if picked else candidates[:5]

    return {"query": query, "category": category, "available": True, "terms": terms[:5]}


@router.get("/search")
def search_regulations(q: str, category: str | None = None, k: int = 5) -> dict:
    """규정 의미 검색 — 상담사 화면 "관련 규정 및 매뉴얼" 패널.

    `available=false`는 오류가 아니라 "인덱스가 아직 없다"는 뜻이다. 프론트는
    이때 로컬 시트 필터로 조용히 강등하므로 화면이 깨지지 않는다.
    """
    query = q.strip()
    if not query:
        raise HTTPException(status_code=400, detail="q is required")
    if category is not None and category not in rag.TAXONOMY:
        raise HTTPException(status_code=400, detail=f"unknown category: {category}")

    try:
        docs = rag.search_procedures(
            settings,
            query,
            top_k=max(1, min(k, 20)),
            categories=[category] if category else None,
        )
    except Exception:
        logger.warning("규정 검색 실패 — available=false로 강등", exc_info=True)
        return {"query": query, "category": category, "available": False, "documents": []}

    return {
        "query": query,
        "category": category,
        "available": True,
        "documents": [_hit(d, rag.get_chunk(d.doc_id)) for d in docs],
    }


@router.get("/stats")
def regulation_stats() -> dict:
    """활성 문서·청크 실측 통계 — 관리자 콘솔 'DB·지식베이스' 패널."""
    try:
        return {"available": True, **rag.corpus_stats()}
    except Exception:
        logger.warning("규정 통계 조회 실패", exc_info=True)
        return {"available": False, "documents": None, "chunks": None}


@router.get("/documents/{doc_id}")
def read_regulation_document(doc_id: str) -> dict:
    """문서 메타 + 페이지순 청크 전체 — 프론트 원문 열람 시트."""
    doc = rag.get_document(doc_id)
    if doc is None:
        raise HTTPException(status_code=404, detail=f"unknown document: {doc_id}")
    return doc


@router.post("/upload", status_code=status.HTTP_201_CREATED)
def upload_regulation(pdf: UploadFile = File(...)) -> dict:
    """규정 적재 — 업로드 한 번으로 추출→청킹→구조화→카테고리 추천→임베딩→검색 반영.

    PDF뿐 아니라 **xlsx·csv 업무매뉴얼**도 받는다. 어떤 형식이든 app.rag.ingest의 같은
    경로를 지나므로 청크 스키마와 조항/항목/내용/안내멘트 구조화가 동일하게 붙는다.

    필드 이름이 `pdf`인 것은 기존 API 계약이라 유지한다 — 프런트(regulationAdmin.ts)가
    그 이름으로 보내고 있어 바꾸면 배포 순서에 따라 업로드가 깨진다.

    적재된 청크는 `rag_data/regulation_chunks.jsonl`에 append되어 재시작 후에도
    남고, 인메모리 코퍼스와 FAISS 인덱스에도 즉시 반영돼 바로 검색된다.
    """
    from app.rag.readers import supported_suffixes

    filename = Path(pdf.filename or "").name
    allowed = supported_suffixes()
    if not filename.lower().endswith(allowed):
        raise HTTPException(
            status_code=415,
            detail=f"지원하는 형식이 아닙니다. 업로드 가능: {', '.join(allowed)}",
        )

    from app.services import regulation_ingest  # pdfplumber/openpyxl — 요청 시에만 로드

    with tempfile.TemporaryDirectory() as tmp:
        path = Path(tmp) / filename
        with path.open("wb") as out:
            shutil.copyfileobj(pdf.file, out)
        try:
            return regulation_ingest.ingest_document(settings, path)
        except regulation_ingest.IngestError as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc
        except Exception as exc:
            logger.exception("규정 적재 실패")
            raise HTTPException(status_code=500, detail=f"적재 실패: {exc}") from exc
