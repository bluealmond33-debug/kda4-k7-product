"""규정 PDF 적재 — 업로드 한 번으로 추출→청킹→카테고리 추천→검색 반영.

관리자 콘솔의 "규정 업로드" 버튼이 부르는 경로(`POST /api/v1/regulations/upload`).
팀 모노레포 `backend/app/rag/auto_ingest.py`와 **같은 응답 계약**을 지키되, 저장 대상이
다르다 — 저쪽은 pgvector에 upsert하고, 여기는 온프레미스 FAISS 코퍼스에 적재한다.

적재물은 `rag_data/regulation_chunks.jsonl`에 append되어 재시작 후에도 살아남고,
인메모리 코퍼스와 FAISS 인덱스에는 즉시 반영돼 업로드 직후 바로 검색된다.

pgvector가 준비된 환경에서는 검색이 자동으로 그쪽을 타므로(ADR-0010), 이 모듈은
FAISS 실행환경 전용 적재 경로다.
"""

import hashlib
import json
import logging
import pathlib
import re
from typing import Any

from app.config import Settings
from app.services import rag

logger = logging.getLogger(__name__)

CHUNKS_PATH = pathlib.Path(__file__).resolve().parent / "rag_data" / "regulation_chunks.jsonl"

# 청킹 크기 — 김동희 기존 청크(평균 ~1.5KB)와 비슷하게 맞춘다.
_CHUNK_CHARS = 1200
_CHUNK_OVERLAP = 150


class IngestError(RuntimeError):
    """적재 실패 — 사용자에게 그대로 보여줄 안내 문구를 담는다."""


# 부서 추천 키워드. rag._DEPT_KEYWORDS(4개)보다 넓게 8대분류를 모두 덮는다.
_DEPT_KEYWORDS: dict[str, tuple[str, ...]] = {
    "DEP": ("예금", "적금", "청약", "통장", "입출금", "수신", "만기", "발행어음"),
    "LON": ("대출", "여신", "상환", "이자", "담보", "신용", "약정", "한도"),
    "CRD": ("카드", "결제", "가맹점", "할부", "체크카드", "신용카드"),
    "FX": ("외환", "환전", "외화", "해외송금", "환율", "수출", "수입"),
    "EFN": ("전자금융", "인터넷뱅킹", "모바일", "공동인증", "OTP", "비대면", "디지털"),
    "INV": ("연금", "IRP", "퇴직연금", "ISA", "신탁", "펀드", "투자", "노후"),
    "SG": ("보이스피싱", "사고", "신고", "지급정지", "분실", "도난", "착오송금", "피해"),
    "ETC": ("민원", "제도", "약관", "공시", "안내", "기타"),
}

_BUSINESS_KEYWORDS: dict[str, tuple[str, ...]] = {
    "subscription": ("청약", "가입", "신규"),
    "termination": ("해지", "중도해지", "만기해지"),
    "repayment": ("상환", "중도상환", "연체"),
    "transfer": ("이체", "송금", "출금"),
    "report": ("신고", "지급정지", "분실", "도난"),
    "inquiry": ("조회", "확인", "안내"),
}


def _score(hay: str, keywords: tuple[str, ...]) -> tuple[int, list[str]]:
    hits = [k for k in keywords if k.lower() in hay]
    return sum(hay.count(k.lower()) for k in hits), hits


def suggest_category(filename: str, sample_text: str = "") -> dict[str, Any]:
    """파일명(가중치↑) + 앞부분 본문으로 부서·업무코드를 추천한다.

    반환 형태를 고정해 두었으니 내부만 LLM 호출로 바꾸면 그대로 "AI 추천"이 된다.
    """
    hay = ((filename + " ") * 3 + sample_text).lower()

    dept_scored = {d: _score(hay, kw) for d, kw in _DEPT_KEYWORDS.items()}
    department, (top, why) = max(dept_scored.items(), key=lambda kv: kv[1][0])
    total = sum(s for s, _ in dept_scored.values())
    if top == 0:
        department, why, confidence = "ETC", [], 0.0
    else:
        confidence = round(top / total, 2) if total else 0.0

    code_scored = {c: _score(hay, kw)[0] for c, kw in _BUSINESS_KEYWORDS.items()}
    business_code = max(code_scored.items(), key=lambda kv: kv[1])[0]
    if code_scored[business_code] == 0:
        business_code = "inquiry"

    return {
        "department": department,
        "business_code": business_code,
        "confidence": confidence,
        "why": why[:5],
    }


def _extract_pages(path: pathlib.Path) -> dict[int, str]:
    try:
        import pdfplumber
    except ImportError as exc:  # requirements에 없으면 안내 문구로 실패
        raise IngestError(
            "PDF 처리 라이브러리(pdfplumber)가 설치돼 있지 않습니다. "
            "pip install pdfplumber 후 다시 시도하세요."
        ) from exc

    pages: dict[int, str] = {}
    try:
        with pdfplumber.open(str(path)) as pdf:
            for n, page in enumerate(pdf.pages, start=1):
                pages[n] = (page.extract_text() or "").strip()
    except Exception as exc:
        raise IngestError(f"PDF를 열 수 없습니다: {exc}") from exc
    return pages


def _split(text: str) -> list[str]:
    """문단 경계를 지키며 _CHUNK_CHARS 안팎으로 자른다(겹침 포함)."""
    text = re.sub(r"\n{3,}", "\n\n", text).strip()
    if len(text) <= _CHUNK_CHARS:
        return [text] if text else []

    parts: list[str] = []
    start = 0
    while start < len(text):
        end = min(start + _CHUNK_CHARS, len(text))
        if end < len(text):
            cut = text.rfind("\n", start + _CHUNK_CHARS // 2, end)
            if cut > start:
                end = cut
        piece = text[start:end].strip()
        if piece:
            parts.append(piece)
        if end >= len(text):
            break
        start = max(end - _CHUNK_OVERLAP, start + 1)
    return parts


def normalize_filename(name: str) -> str:
    """multipart 파일명이 latin-1로 잘못 디코딩된 경우 UTF-8로 되돌린다.

    python-multipart는 RFC 7578 파일명을 latin-1로 디코딩해서 넘길 때가 있어,
    "대출약정서.pdf"가 "´ëÃâ¾àÁ¤¼­.pdf"로 도착한다. 한글 파일명은 부서 추천의
    가중치 3배 소스라(파일명 > 본문) 깨지면 추천이 통째로 ETC로 빠진다.
    되돌리기가 실패하면(원래 정상 파일명) 그대로 둔다.
    """
    try:
        restored = name.encode("latin-1").decode("utf-8")
    except (UnicodeEncodeError, UnicodeDecodeError):
        return name
    return restored if restored else name


def _doc_id(filename: str) -> str:
    """파일명 기반 안정적 문서 ID — 같은 파일 재업로드는 같은 ID(멱등 갱신)."""
    stem = pathlib.Path(filename).stem
    slug = re.sub(r"[^a-z0-9]+", "-", stem.lower()).strip("-")
    digest = hashlib.sha1(stem.encode("utf-8")).hexdigest()[:8]
    return f"{slug or 'doc'}-{digest}" if slug else f"doc-{digest}"


def ingest_pdf(settings: Settings, path: pathlib.Path) -> dict[str, Any]:
    """PDF 한 건을 적재하고 프론트 `RegulationUploadResult` 계약으로 반환한다."""
    filename = normalize_filename(path.name)
    pages = _extract_pages(path)
    body = "\n".join(t for t in pages.values() if t)
    if not body.strip():
        raise IngestError(
            "텍스트를 추출하지 못했습니다. 스캔본 PDF로 보이며, OCR이 필요합니다."
        )

    doc_id = _doc_id(filename)
    is_revision = any(rag.document_id_of(c) == doc_id for c in rag._DOCS)
    if is_revision:
        raise IngestError(
            f"같은 파일명의 규정이 이미 적재돼 있습니다(doc_id={doc_id}). "
            "개정본 처리는 pgvector 전환 후 지원됩니다."
        )

    suggestion = suggest_category(filename, body[:2000])
    title = pathlib.Path(filename).stem

    chunks: list[dict[str, Any]] = []
    for page_no, page_text in sorted(pages.items()):
        for i, piece in enumerate(_split(page_text)):
            chunk_id = f"{doc_id}-p{page_no}-{i}"
            chunks.append({
                # rag._DOCS 계약(검색·인덱스 매핑용)
                "doc_id": chunk_id,
                "category": suggestion["department"],
                "subcategory": suggestion["business_code"],
                "title": title,
                "text": f"[{title} > p{page_no}]\n{piece}",
                # 규정 API 메타(프론트 계약용)
                "chunk_id": chunk_id,
                "source_doc_id": doc_id,
                "filename": filename,
                "doc_type": "규정",
                "categories": [suggestion["department"]],
                "version": "v1",
                "effective_date": None,
                "status": "active",
                "page": page_no,
                "kind": "text",
                "section": title,
            })

    if not chunks:
        raise IngestError("추출된 본문이 비어 있어 적재할 청크가 없습니다.")

    _append_jsonl(chunks)
    rag.register_chunks(settings, chunks)

    return {
        "filename": filename,
        "title": title,
        "doc_id": doc_id,
        "is_scanned": False,
        "chunks_loaded": len(chunks),
        "n_text": len(chunks),
        "n_table": 0,
        "revision_of": None,
        "suggestion": suggestion,
    }


def _append_jsonl(chunks: list[dict[str, Any]]) -> None:
    """재시작 후에도 남도록 코퍼스 파일에 append. 실패해도 인메모리 적재는 유지한다."""
    try:
        CHUNKS_PATH.parent.mkdir(parents=True, exist_ok=True)
        with CHUNKS_PATH.open("a", encoding="utf-8") as fp:
            for c in chunks:
                fp.write(json.dumps({
                    "chunk_id": c["chunk_id"],
                    "doc_id": c["source_doc_id"],
                    "title": c["title"],
                    "filename": c["filename"],
                    "doc_type": c["doc_type"],
                    "categories": c["categories"],
                    "version": c["version"],
                    "effective_date": c["effective_date"],
                    "status": c["status"],
                    "page": c["page"],
                    "kind": c["kind"],
                    "section": c["section"],
                    "text": c["text"],
                    "raw": c["text"],
                    "department": c["category"],
                    "business_code": c["subcategory"],
                }, ensure_ascii=False) + "\n")
    except Exception:
        logger.warning("규정 청크 파일 append 실패(인메모리 적재는 유지)", exc_info=True)
