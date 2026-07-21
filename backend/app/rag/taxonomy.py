"""규정 분류체계 (taxonomy) — 8 대분류 닫힌 집합.

`categories` 태그의 표준 사전. AI 용건 분류기의 라벨셋이자 pgvector 검색 필터.
근거: 5대 은행 콜센터 ARS 공통 구조(용건 기준) + bank.xlsx(팀 합의 업무분류).
자세한 설계: hippo `07 Outputs/2026-07-20-RAG-규정검색-설계-및-분류체계-v0.1.md`.

축을 섞지 않는다: `categories`(검색) ≠ department(이관 라우팅) ≠ 민원유형(보고).
"""

from __future__ import annotations

# code -> 대분류 한글명
CATEGORIES: dict[str, str] = {
    "DEP": "수신·예적금",
    "LON": "여신·대출",
    "CRD": "카드·결제",
    "FX": "외환·수출입",
    "EFN": "전자금융·디지털",
    "INV": "연금·신탁·투자",
    "SG": "사고·신고",  # ⚠️ 긴급 라우팅과 직결 — 상품축에서 분리
    "ETC": "제도·민원·기타",
}

CATEGORY_CODES: frozenset[str] = frozenset(CATEGORIES)


def is_valid_category(code: str | None) -> bool:
    """None(필터 없음)이거나 8대분류 코드면 True."""
    return code is None or code in CATEGORY_CODES


def label(code: str) -> str:
    return CATEGORIES.get(code, code)
