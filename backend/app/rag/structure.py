"""규정 청크 구조화 — 어떤 원본 형식이 들어와도 **같은 모양**으로 정리한다.

왜 별도 단계인가
----------------
지금 인제스트는 PDF에 직결돼 있어서, xlsx·csv가 들어오면 붙일 자리가 없었다. 그리고 화면이
`조항 / 항목 / 내용 / 안내 멘트`로 보여 주려면 그 네 칸이 **데이터에 있어야** 하는데, 지금
청크에는 뭉개진 `text` 한 덩이뿐이라 화면을 아무리 잘 그려도 뭉개진 채로 나온다.

그래서 파이프라인을 두 단으로 나눈다:

    [포맷별 리더]  PDF · XLSX · CSV  →  Record(공통 중간형)
    [구조화기]     Record            →  구조화 필드(조항/항목/내용/안내멘트 + 신호)

**구조화기는 형식을 모른다.** 그래서 나중에 어떤 형식을 추가해도 리더만 쓰면 되고,
화면이 기대하는 필드 모양은 이 파일 하나가 보장한다.

표(엑셀·CSV)는 열 이름이 곧 구조라 매핑만 하면 되고, PDF 본문은 문장에서 조항 번호와
안내 멘트(따옴표로 묶인 화법)를 뽑아낸다.

추출하는 신호
-------------
`조항/항목/내용/안내멘트/시행일` 외에 상담사가 사고를 피하려면 꼭 필요한 두 가지를 함께 뽑는다:

- `prohibitions` — "확정적 표현 사용 금지"처럼 **하면 안 되는 것**. 통화 중 가장 비싼 실수라
  본문에 묻어 두면 안 되고 별도 신호로 올려야 한다.
- `requirements` — "반환 접수 전 본인확인 필수"처럼 **먼저 해야 하는 것**. 순서를 틀리면
  그 뒤 절차가 전부 무효가 되는 종류다.

둘 다 규칙 기반이다 — LLM 없이 오프라인에서 결정적으로 돌아야 인제스트를 재현할 수 있다.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Any

# ── 표 열 이름 동의어 ────────────────────────────────────────────────
# 부서마다 엑셀 서식이 달라 열 이름이 제각각이다. 정규화해서 같은 칸으로 모은다.
# 비교는 공백·괄호를 지운 소문자 기준.
_COLUMN_SYNONYMS: dict[str, tuple[str, ...]] = {
    "clause": ("조항", "조", "조문", "조항번호", "근거조항", "근거", "clause", "article"),
    "item": ("항목", "항목명", "구분", "제목", "분류", "item", "subject"),
    "content": ("내용", "본문", "설명", "규정내용", "상세", "content", "body"),
    "script": ("안내멘트", "멘트", "안내문구", "스크립트", "화법", "응대멘트", "script"),
    "effective_date": ("시행일", "개정일", "적용일", "발효일", "effectivedate", "date"),
    "note": ("비고", "참고", "메모", "note", "remark"),
}

_NORM = re.compile(r"[\s()（）\[\]/·:：]")


def normalize_header(name: str) -> str:
    """열 이름을 비교용으로 납작하게 만든다 ("안내 멘트" → "안내멘트")."""
    return _NORM.sub("", str(name or "")).strip().lower()


def map_columns(headers: list[str]) -> dict[str, int]:
    """헤더 행 → {표준필드: 열 인덱스}. 못 찾은 필드는 아예 안 담는다."""
    out: dict[str, int] = {}
    for idx, raw in enumerate(headers):
        key = normalize_header(raw)
        if not key:
            continue
        for std, syns in _COLUMN_SYNONYMS.items():
            if std in out:
                continue
            if key in syns or any(key.startswith(s) for s in syns):
                out[std] = idx
                break
    return out


# ── 본문에서 뽑아내는 패턴 ──────────────────────────────────────────
# 조항: §12-1 · 제12조 · 제12조제1항 · 12-1 (문두에 올 때만 — 본문 중간 숫자를 조항으로 오인하지 않게)
_CLAUSE_PATTERNS = (
    re.compile(r"^\s*(§\s?\d+(?:-\d+)*)"),
    re.compile(r"^\s*(제\s?\d+\s?조(?:\s?제\s?\d+\s?항)?)"),
    re.compile(r"^\s*(\d+\s?-\s?\d+)(?=[\s.)])"),
)

# 안내 멘트: 따옴표로 묶인 고객 응대 화법. 한글 큰따옴표(“ ”)와 ASCII 모두 받는다.
_SCRIPT_PATTERN = re.compile(r"[“\"']([^”\"']{6,200}?)[”\"']")

# 따옴표만으로는 부족하다 — 상품설명서에는 서식 이름이 따옴표에 들어 있어
# `“각서(청약통장가입용)”` 같은 문서명이 안내 멘트로 잘못 잡혔다(실측 오탐).
# 안내 멘트는 **고객에게 말하는 문장**이므로 한국어 종결어미로 끝난다. 그걸로 가른다.
_SPEECH_ENDING = re.compile(
    r"(?:습니다|합니다|입니다|됩니다|드립니다|세요|십시오|주세요|어요|아요|네요|까요|나요)[.?!]?\s*$"
)

# 금지 — "…금지", "…할 수 없다", "…해서는 안 된다", "표시하지 않는다"
_PROHIBIT_PATTERN = re.compile(
    r"[^.\n]*?(?:금지|할\s?수\s?없다|하지\s?않는다|해서는\s?안\s?[되된]|불가)[^.\n]*"
)
# 선행 조건 — "…필수", "…먼저", "…전에는", "…후 처리"
_REQUIRE_PATTERN = re.compile(
    r"[^.\n]*?(?:필수|반드시|먼저|선행|전에는|후\s?처리|확인\s?후)[^.\n]*"
)


def extract_clause(text: str) -> str | None:
    """문두의 조항 번호. 없으면 None — 없는 걸 지어내지 않는다."""
    for pat in _CLAUSE_PATTERNS:
        m = pat.search(text or "")
        if m:
            return re.sub(r"\s+", "", m.group(1))
    return None


def extract_scripts(text: str) -> list[str]:
    """따옴표로 묶인 안내 멘트. 규정 문장과 화법을 갈라내는 가장 확실한 신호다."""
    out: list[str] = []
    for m in _SCRIPT_PATTERN.finditer(text or ""):
        s = m.group(1).strip()
        # 종결어미가 없으면 화법이 아니라 서식명·인용어다 — 버린다
        if not s or not _SPEECH_ENDING.search(s) or s in out:
            continue
        out.append(s)
    return out


def _sentences(text: str, pattern: re.Pattern[str], limit: int = 4) -> list[str]:
    out: list[str] = []
    for m in pattern.finditer(text or ""):
        s = re.sub(r"\s+", " ", m.group(0)).strip(" ·-—")
        if len(s) < 4 or s in out:
            continue
        out.append(s)
        if len(out) >= limit:
            break
    return out


@dataclass
class Record:
    """포맷별 리더가 만들어 내는 공통 중간형.

    PDF는 페이지의 한 블록, 엑셀·CSV는 한 행이 하나의 Record가 된다.
    `fields`에는 표에서 직접 온 값이 들어오고(있으면 추출보다 우선), `body`는 본문 원문이다.
    """

    body: str
    page: int = 1
    section: str = ""
    kind: str = "text"
    fields: dict[str, str] = field(default_factory=dict)
    source_row: int | None = None


def structure_record(rec: Record) -> dict[str, Any]:
    """Record → 구조화 필드.

    **표에서 온 값이 언제나 추출값을 이긴다.** 사람이 정리해 둔 열을 정규식 추측으로
    덮어쓰면 품질이 내려간다 — 추출은 그 칸이 비어 있을 때만 채운다.
    """
    f = {k: (v or "").strip() for k, v in rec.fields.items()}
    body = rec.body or ""

    content = f.get("content") or body
    scripts = [f["script"]] if f.get("script") else extract_scripts(body)
    # 멘트를 본문에서 뽑았다면 내용에서는 빼 준다 — 같은 문장이 두 칸에 겹쳐 보이면
    # 상담사가 어느 쪽을 읽어야 할지 헷갈린다.
    if not f.get("content") and scripts:
        for s in scripts:
            content = content.replace(f"“{s}”", "").replace(f'"{s}"', "")
    content = re.sub(r"\s{2,}", " ", content).strip()

    return {
        "clause": f.get("clause") or extract_clause(body),
        "item": f.get("item") or (rec.section or None),
        "content": content or None,
        "scripts": scripts,
        "prohibitions": _sentences(body if not f.get("content") else f["content"], _PROHIBIT_PATTERN),
        "requirements": _sentences(body if not f.get("content") else f["content"], _REQUIRE_PATTERN),
        "note": f.get("note") or None,
        "row": rec.source_row,
    }


def structured_is_empty(s: dict[str, Any]) -> bool:
    """구조화가 실제로 뭔가 건졌는지.

    `item`은 세지 않는다 — 값이 없으면 section으로 폴백하는데 section은 항상 있어서,
    이걸 성공으로 치면 지표가 늘 100%로 나와 아무것도 못 잰다(실측에서 걸러낸 함정).
    조항·안내멘트·금지·선행조건 중 하나라도 잡혀야 '정리됐다'고 본다.
    """
    return not (
        s.get("clause") or s.get("scripts") or s.get("prohibitions") or s.get("requirements")
    )
