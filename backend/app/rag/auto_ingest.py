"""규정 PDF 자동 적재 파이프라인 (재사용 모듈).

웹 업로드 화면 / 폴더 감시 / GitHub Action — 어떤 트리거든 이 모듈의 함수만
호출하면 아래가 이어진다. 트리거·화면은 이 모듈을 "호출"만 하면 된다.

    PDF 1개
      → (스캔본이면) OCR로 글자 추출
      → 구조 기준 청킹 (app.rag.ingest 재사용)
      → 부서·업무코드 자동 추천 (사람 확인용)
      → [사람이 확인/수정]
      → 임베딩(bge-m3) + pgvector 적재 (app.rag.store 재사용)
      → 개정본이면 옛 버전은 보관(superseded), 새 버전을 활성으로 추가

사람 확인을 중간에 끼우려고 **2단계 API**로 나눴다:

    1) preview(path)                      → PreviewResult   (DB 불필요)
         스캔 감지 + 카테고리 추천 + 청크 미리보기. 화면에 이걸 띄워 사람이 확인.
    2) commit(preview, confirmed, settings, supersede_doc_id=None) → int  (DB 필요)
         확인된 카테고리로 태그 확정 → 임베딩 + 적재. 개정본이면 옛 버전 supersede.

카테고리 추천은 지금은 키워드 규칙(오프라인, 무료)이다. `suggest_category()`만
LLM 호출로 갈아끼우면 "AI 추천"으로 업그레이드된다 (인터페이스 동일).

의존성: pdfplumber(청킹), FlagEmbedding(임베딩), psycopg(적재)는 지연 import —
preview 단계는 pdfplumber만 있으면 되고, 적재(commit)만 임베딩/DB가 필요하다.
스캔본 OCR은 별도(선택) 의존성이며 없으면 명확한 에러로 안내한다.
"""

from __future__ import annotations

import hashlib
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from app.rag import ingest

# ── 카테고리 추천 사전 (taxonomy 기반) ───────────────────────────────
# 부서(2층) 후보 키워드. 파일명·1페이지 본문에서 매칭 수를 센다.
DEPARTMENT_KEYWORDS: dict[str, list[str]] = {
    "LON": ["대출", "여신", "보금자리", "디딤돌", "중도금", "전세자금", "담보",
            "오토론", "상생플러스", "동반성장", "CD수익률", "적격대출"],
    "DEP": ["예금", "적금", "청약", "통장", "발행어음", "수신", "저축"],
    "FX": ["외화", "외환", "환전", "수출입", "양도성예금증서"],
    "INV": ["IRP", "연금", "퇴직", "신탁", "펀드", "디폴트옵션"],
    "CRD": ["카드", "결제", "리볼빙", "카드론"],
    "EFN": ["인터넷뱅킹", "모바일뱅킹", "OTP", "전자금융", "보안매체"],
    "SG": ["보이스피싱", "분실", "도난", "착오송금", "지급정지", "명의도용", "사고신고"],
}

# 업무코드(3층) 후보 키워드. 부서별 허용 코드는 아래 매핑으로 제약한다.
BUSINESS_KEYWORDS: dict[str, list[str]] = {
    "subscription": ["청약"],
    "deposit": ["예금", "적금", "발행어음", "저축", "통장"],
    "loan": ["대출", "여신", "보금자리", "디딤돌", "중도금", "전세자금", "담보", "오토론"],
    "fx": ["외화", "외환", "환전", "양도성예금증서"],
    "pension": ["IRP", "연금", "퇴직", "디폴트옵션", "신탁"],
    "card": ["카드", "리볼빙", "카드론"],
    "efn": ["인터넷뱅킹", "모바일뱅킹", "OTP", "전자금융"],
    "misremit": ["착오송금", "보이스피싱", "지급정지"],
}

# 부서 → 허용 업무코드 (부서와 코드가 어긋나지 않게)
DEPT_ALLOWED_CODES: dict[str, list[str]] = {
    "DEP": ["subscription", "deposit"],
    "LON": ["loan"],
    "FX": ["fx"],
    "INV": ["pension"],
    "CRD": ["card"],
    "EFN": ["efn"],
    "SG": ["misremit"],
}


@dataclass
class CategorySuggestion:
    department: str
    business_code: str
    confidence: float          # 0~1 (상위 점수 비중)
    why: list[str] = field(default_factory=list)   # 매칭된 근거 키워드


@dataclass
class PreviewResult:
    path: str
    filename: str
    is_scanned: bool
    suggestion: CategorySuggestion
    chunks: list[dict[str, Any]]                    # 태그 확정 전(초안 meta) 청크
    n_text: int
    n_table: int
    revision_of: str | None = None                  # 같은 파일명이 대장에 이미 있으면 그 doc_id


# ── 1) 스캔본 감지 & OCR ──────────────────────────────────────────────
def is_scanned(path: str | Path, sample_pages: int = 2) -> bool:
    """앞쪽 몇 페이지에서 추출 텍스트가 거의 없으면 스캔본(이미지)으로 본다."""
    import pdfplumber
    with pdfplumber.open(path) as pdf:
        pages = pdf.pages[:sample_pages] or pdf.pages
        total = sum(len((p.extract_text() or "").strip()) for p in pages)
    return total < 20


def ocr_pages(path: str | Path, scale: float = 2.0) -> dict[int, str]:
    """스캔본 PDF를 페이지별 텍스트로 OCR. (온프레미스 관리자 도구 전용)

    pypdfium2로 렌더 → PaddleOCR(한국어)로 인식. 둘 다 선택 의존성이라,
    없으면 설치 안내를 담은 RuntimeError를 던진다.
    """
    try:
        import pypdfium2 as pdfium
        from paddleocr import PaddleOCR
    except ImportError as exc:  # pragma: no cover - 환경 의존
        raise RuntimeError(
            "스캔본 OCR에는 pypdfium2 + paddleocr(한국어)가 필요합니다: "
            "pip install pypdfium2 paddleocr paddlepaddle"
        ) from exc

    ocr = PaddleOCR(lang="korean", enable_mkldnn=False)
    out: dict[int, str] = {}
    doc = pdfium.PdfDocument(str(path))
    for i in range(len(doc)):
        img = doc[i].render(scale=scale).to_pil()
        tmp = Path(path).with_suffix(f".ocr_p{i + 1}.png")
        img.save(tmp)
        try:
            result = ocr.predict(str(tmp))
            lines: list[str] = []
            for res in result:
                lines.extend(res.get("rec_texts", []))
            out[i + 1] = "\n".join(lines)
        finally:
            tmp.unlink(missing_ok=True)
    return out


# ── 2) 카테고리 추천 (지금은 규칙, 나중에 LLM으로 교체 가능) ──────────
def suggest_category(filename: str, sample_text: str = "") -> CategorySuggestion:
    """파일명(가중치↑) + 앞부분 본문에서 부서·업무코드를 추천한다.

    반환 인터페이스를 고정해 두었으니, 내부만 LLM 호출로 바꾸면 "AI 추천"이 된다.
    """
    hay = (filename + " ") * 3 + sample_text

    def _score(keywords: list[str]) -> tuple[int, list[str]]:
        hits = [k for k in keywords if k in hay]
        return (sum(hay.count(k) for k in hits), hits)

    dept_scores = {d: _score(kw) for d, kw in DEPARTMENT_KEYWORDS.items()}
    dept = max(dept_scores, key=lambda d: dept_scores[d][0])
    dept_score, dept_hits = dept_scores[dept]
    if dept_score == 0:
        return CategorySuggestion("ETC", "general", 0.0, [])

    allowed = DEPT_ALLOWED_CODES.get(dept, [])
    code_scores = {c: _score(BUSINESS_KEYWORDS.get(c, []))[0] for c in allowed}
    code = max(code_scores, key=lambda c: code_scores[c]) if code_scores else "general"
    if code_scores and max(code_scores.values()) == 0:
        code = allowed[0] if allowed else "general"

    total = sum(s for s, _ in dept_scores.values()) or 1
    confidence = round(dept_score / total, 2)
    return CategorySuggestion(dept, code, confidence, dept_hits)


# ── 청킹 (본문 PDF는 ingest 재사용, OCR본은 텍스트 기반) ──────────────
def _draft_meta(filename: str, doc_id: str, sugg: CategorySuggestion) -> dict[str, Any]:
    return {
        "doc_id": doc_id,
        "title": Path(filename).stem,
        "filename": filename,
        "doc_type": "상품설명서",
        "categories": [sugg.department, sugg.business_code],
        "version": "v1",
        "effective_date": None,
        "status": "active",
    }


def _chunk_from_text(pages: dict[int, str], meta: dict[str, Any]) -> list[dict[str, Any]]:
    import re
    chunks, seen = [], set()
    for pageno, text in pages.items():
        blocks = ingest._split_blocks(ingest._clean_lines(text))
        for b in blocks:
            for part in ingest._cap_length(b):
                if len(part) < 30:
                    continue
                key = hashlib.md5(re.sub(r"\s+", "", part).encode()).hexdigest()
                if key in seen:
                    continue
                seen.add(key)
                chunks.append(ingest._make_chunk(meta, pageno, "text", part, meta["title"]))
    return chunks


def _auto_doc_id(filename: str) -> str:
    return "auto-" + hashlib.md5(filename.encode("utf-8")).hexdigest()[:10]


# ── 공개 API 1: 미리보기 (DB 불필요) ─────────────────────────────────
def preview(path: str | Path, registry_path: str | Path | None = None) -> PreviewResult:
    """PDF 한 개를 스캔감지·OCR·청킹·카테고리추천까지 처리해 미리보기를 돌려준다.

    DB/임베딩은 건드리지 않는다. 화면은 이 결과를 사람에게 보여주고 확인받는다.
    registry_path를 주면 같은 파일명이 이미 대장에 있는지(=개정본 후보) 알려준다.
    """
    path = Path(path)
    filename = path.name
    scanned = is_scanned(path)

    if scanned:
        pages = ocr_pages(path)
        sample_text = pages.get(1, "")[:1500]
    else:
        import pdfplumber
        with pdfplumber.open(path) as pdf:
            sample_text = (pdf.pages[0].extract_text() or "")[:1500] if pdf.pages else ""

    sugg = suggest_category(filename, sample_text)
    doc_id = _auto_doc_id(filename)
    meta = _draft_meta(filename, doc_id, sugg)

    if scanned:
        chunks = _chunk_from_text(pages, meta)
    else:
        chunks = ingest.ingest_pdf(path, meta)

    revision_of = None
    if registry_path and Path(registry_path).exists():
        reg = ingest.load_registry(registry_path)
        if filename in reg:
            revision_of = reg[filename].get("doc_id")

    kinds = [c["kind"] for c in chunks]
    return PreviewResult(
        path=str(path), filename=filename, is_scanned=scanned, suggestion=sugg,
        chunks=chunks, n_text=kinds.count("text"), n_table=kinds.count("table"),
        revision_of=revision_of,
    )


# ── 공개 API 2: 확정 적재 (DB 필요) ──────────────────────────────────
def _mark_superseded(settings, doc_id: str) -> None:
    """개정 시 옛 문서를 삭제하지 않고 status='superseded'로 보관 처리."""
    import psycopg
    from app.rag.store import _database_url
    with psycopg.connect(_database_url(settings)) as conn:
        with conn.cursor() as cur:
            cur.execute(
                "UPDATE rag_documents SET status='superseded' WHERE doc_id=%s",
                (doc_id,),
            )


def commit(
    preview_result: PreviewResult,
    settings,
    *,
    department: str | None = None,
    business_code: str | None = None,
    effective_date: str | None = None,
    supersede_doc_id: str | None = None,
) -> int:
    """확인/수정된 카테고리로 태그를 확정하고 임베딩+적재한다. 적재된 청크 수 반환.

    - department/business_code를 주면 추천값을 덮어쓴다(사람 확인 결과).
    - supersede_doc_id(또는 preview.revision_of)를 주면 그 옛 문서를 보관 처리(superseded)
      하고, 이 문서는 새 버전으로 활성 적재한다. (옛 버전 삭제 안 함)
    """
    from app.rag.store import upsert_documents_and_chunks

    dept = department or preview_result.suggestion.department
    code = business_code or preview_result.suggestion.business_code
    old = supersede_doc_id or preview_result.revision_of

    chunks = preview_result.chunks
    for c in chunks:
        c["categories"] = [dept, code]
        c["department"] = dept
        c["business_code"] = code
        if effective_date:
            c["effective_date"] = effective_date

    if old:
        # 개정본: 새 문서를 별도 doc_id(활성)로, 옛 문서는 보관(superseded)
        new_id = f"{old}-rev-{_auto_doc_id(preview_result.filename)[-4:]}"
        for c in chunks:
            c["doc_id"] = new_id
            c["chunk_id"] = c["chunk_id"].replace(c["chunk_id"].split("-p")[0], new_id, 1)
        _mark_superseded(settings, old)

    return upsert_documents_and_chunks(settings, chunks)
