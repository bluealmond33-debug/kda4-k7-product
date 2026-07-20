"""Bank PDF -> structured, tagged chunks for the regulation RAG store.

Structure-aware chunking tuned to real Hana Bank documents:
  - ◇/□/①~⑳/제N조/[heading] blocks split into chunks
  - tables extracted separately as markdown (cell relations preserved)
  - duplicate 은행용/고객용 pages de-duplicated by content hash
  - each chunk carries a `[문서 > p > 섹션]` context header for retrieval
  - NER-lite entity tags (법령·조항·서식코드) + auto revision-date detection

CLI:  python3 -m app.rag.ingest <registry.csv> <file.pdf> [more.pdf ...]
Programmatic:  from app.rag.ingest import ingest_pdf  # -> list[dict]

Output chunk dicts feed app.rag.store.upsert_documents_and_chunks directly.
pdfplumber is imported lazily so the API never needs it at runtime.
"""

from __future__ import annotations

import csv
import hashlib
import re
import sys
from pathlib import Path
from typing import Any

CLAUSE = r"[①-⑳]"
BLOCK_START = re.compile(
    rf"^\s*(◇|□|■|▶|{CLAUSE}|제\s?\d+\s?[조항]|\d+\.\s|\[[^\]]+\]|【[^】]+】)"
)
NOISE = re.compile(r"^\s*(\d+\s*/\s*\d+\s*페이지|-\s*\d+\s*-)\s*$")

RE_LAW = re.compile(r"[가-힣]{2,}법(?:\s*시행령|\s*시행규칙)?\s*제\s?\d+조(?:의\d+)?")
RE_ARTICLE = re.compile(r"(?<![가-힣])제\s?\d+조(?:의\d+)?")
RE_DOCCODE = re.compile(r"제?\s?\d{4}-[가-힣A-Za-z]+-\d+\s?호|\b\d-\d{2}-\d{4}(?:\(\d[-\d]*\))?")
RE_REVISION = re.compile(r"\(?\s*(\d{4})[.\-]\s?(\d{1,2})(?:[.\-]\s?(\d{1,2}))?\s*(?:개정|시행)")

MAX_CHARS = 1200
MIN_CHARS = 60


def load_registry(path: str | Path) -> dict[str, dict[str, str]]:
    with open(path, newline="", encoding="utf-8") as f:
        return {row["filename"]: row for row in csv.DictReader(f)}


def extract_entities(text: str) -> dict[str, list[str]]:
    ents = {
        "law": [re.sub(r"\s+", "", m) for m in RE_LAW.findall(text)],
        "article": [re.sub(r"\s+", "", m) for m in RE_ARTICLE.findall(text)],
        "doc_code": [re.sub(r"\s+", "", m) for m in RE_DOCCODE.findall(text)],
    }
    return {k: sorted(set(v)) for k, v in ents.items() if v}


def detect_revision_date(full_text: str) -> str | None:
    dates = [
        f"{int(y):04d}-{int(mth):02d}-{int(d) if d else 1:02d}"
        for y, mth, d in RE_REVISION.findall(full_text)
    ]
    return max(dates) if dates else None


def _clean_lines(text: str) -> list[str]:
    return [l.rstrip() for l in text.split("\n") if not NOISE.match(l)]


def _split_blocks(lines: list[str]) -> list[str]:
    blocks: list[str] = []
    cur: list[str] = []
    for line in lines:
        if BLOCK_START.match(line) and cur:
            blocks.append("\n".join(cur))
            cur = []
        cur.append(line)
    if cur:
        blocks.append("\n".join(cur))
    merged: list[str] = []
    for b in blocks:
        if merged and (len(b) < MIN_CHARS or len(merged[-1]) < MIN_CHARS):
            merged[-1] += "\n" + b
        else:
            merged.append(b)
    return merged


def _cap_length(block: str) -> list[str]:
    if len(block) <= MAX_CHARS:
        return [block]
    parts: list[str] = []
    cur = ""
    for sent in re.split(r"(?<=[.다음함됨\)])\s+", block):
        if cur and len(cur) + len(sent) > MAX_CHARS:
            parts.append(cur)
            cur = sent
        else:
            cur = f"{cur} {sent}".strip()
    if cur:
        parts.append(cur)
    return parts


def _table_to_markdown(table: list[list[Any]]) -> str:
    rows = [[(c or "").replace("\n", " ").strip() for c in row] for row in table]
    rows = [r for r in rows if any(r)]
    if not rows:
        return ""
    md = ["| " + " | ".join(rows[0]) + " |", "|" + "---|" * len(rows[0])]
    md += ["| " + " | ".join(r) + " |" for r in rows[1:]]
    return "\n".join(md)


def _nearest_heading(prior_blocks: list[str], doc_title: str) -> str:
    for b in reversed(prior_blocks):
        m = re.match(r"^\s*(\[[^\]]+\]|【[^】]+】)", b)
        if m:
            return m.group(1).strip("[]【】")
        if b.lstrip().startswith("◇"):
            return b.lstrip("◇ ").split("\n")[0][:40]
    return doc_title


def _make_chunk(meta: dict[str, Any], page: int, kind: str, body: str, section: str) -> dict[str, Any]:
    header = f"[{meta['title']} > p{page} > {section}]"
    return {
        "chunk_id": f"{meta['doc_id']}-p{page}-{hashlib.md5(body.encode()).hexdigest()[:8]}",
        "doc_id": meta["doc_id"],
        "title": meta["title"],
        "filename": meta.get("filename", meta["doc_id"]),
        "doc_type": meta.get("doc_type", ""),
        "categories": meta["categories"],
        "version": meta.get("version", "v1"),
        "effective_date": meta.get("effective_date"),
        "status": meta.get("status", "active"),
        "page": page,
        "kind": kind,
        "section": section,
        "entities": extract_entities(body),
        "text": f"{header}\n{body}",
        "raw": body,
    }


def ingest_pdf(path: str | Path, meta: dict[str, Any]) -> list[dict[str, Any]]:
    """Parse one PDF into chunk dicts. `meta` needs doc_id/title/categories(list)."""
    import pdfplumber  # lazy: keeps the API free of this dependency

    path = Path(path)
    with pdfplumber.open(path) as pdf:
        full_text = "\n".join((p.extract_text() or "") for p in pdf.pages)
    rev = detect_revision_date(full_text)
    if rev:
        meta = {**meta, "effective_date": rev}

    chunks: list[dict[str, Any]] = []
    seen: set[str] = set()
    with pdfplumber.open(path) as pdf:
        for pageno, page in enumerate(pdf.pages, 1):
            tables = []
            for t in page.find_tables():
                md = _table_to_markdown(t.extract())
                if md and md.count("\n") >= 2 and len(md) >= 60:
                    tables.append(md)

            blocks = _split_blocks(_clean_lines(page.extract_text() or ""))
            for b in blocks:
                for part in _cap_length(b):
                    if len(part) < 30:
                        continue
                    key = hashlib.md5(re.sub(r"\s+", "", part).encode()).hexdigest()
                    if key in seen:
                        continue
                    seen.add(key)
                    section = _nearest_heading(blocks[: blocks.index(b)], meta["title"])
                    chunks.append(_make_chunk(meta, pageno, "text", part, section))
            for md in tables:
                key = hashlib.md5(re.sub(r"\s+", "", md).encode()).hexdigest()
                if key in seen:
                    continue
                seen.add(key)
                section = _nearest_heading(blocks, meta["title"])
                chunks.append(_make_chunk(meta, pageno, "table", md, section))
    return chunks


def ingest_files(registry_path: str | Path, paths: list[str]) -> list[dict[str, Any]]:
    registry = load_registry(registry_path)
    out: list[dict[str, Any]] = []
    for p in paths:
        row = registry.get(Path(p).name)
        if not row:
            raise SystemExit(f"'{Path(p).name}' not in {registry_path} — add it first")
        meta = dict(row)
        meta["categories"] = [c for c in row.get("categories", "").split(";") if c]
        out.extend(ingest_pdf(p, meta))
    return out


def main(argv: list[str]) -> None:
    if len(argv) < 2:
        raise SystemExit("usage: python3 -m app.rag.ingest <registry.csv> <file.pdf> ...")
    chunks = ingest_files(argv[0], argv[1:])
    kinds = [c["kind"] for c in chunks]
    print(f"{len(chunks)} chunks (text={kinds.count('text')}, table={kinds.count('table')})")
    # emit JSONL to stdout for piping / inspection
    import json

    for c in chunks:
        print(json.dumps(c, ensure_ascii=False))


if __name__ == "__main__":
    main(sys.argv[1:])
