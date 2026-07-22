"""3층 라우팅 taxonomy — 카드 라우터의 부서·업무코드 닫힌 집합.

1층 routing(S/G/E) → 2층 부서(department) → 3층 업무코드(business_code).

부서 코드는 규정검색 태그(app/rag/taxonomy.py의 8대분류)와 같은 코드를 쓴다.
축은 다르지만(검색 필터 ≠ 이관 라우팅) 코드를 공유해, 카드가 부서에 배정되는
순간 그 부서의 규정만 필터해 검색할 수 있게 한다(부서 → RAG category 항등 매핑).

근거: hippo 07 Outputs/2026-07-22-라우팅-부서체계-정리-및-RAG전처리-보고.md §A2,
kdh 전처리 산출물(database/rag/registry.csv)의 department/business_code 태그.
"""

from __future__ import annotations

# 1층 — 라우팅 등급
ROUTING_SIMPLE = "S"  # 단순: 상담사 없이 자동 처리(AI/ARS) 후보
ROUTING_GENERAL = "G"  # 일반: 부서 큐 배정
ROUTING_EMERGENCY = "E"  # 긴급: 사고·신고 전담 경로 (recall floor)

ROUTING_LEVELS: dict[str, str] = {
    ROUTING_SIMPLE: "단순",
    ROUTING_GENERAL: "일반",
    ROUTING_EMERGENCY: "긴급",
}

# 2층 — 부서 8종 (닫힌 집합, 코드는 rag/taxonomy.CATEGORIES와 정렬)
DEPARTMENTS: dict[str, str] = {
    "DEP": "수신·예적금",
    "LON": "여신·대출",
    "CRD": "카드·결제",
    "FX": "외환·수출입",
    "EFN": "전자금융·디지털",
    "INV": "연금·신탁·투자",
    "SG": "사고·신고",  # 긴급(E) 전담 부서 — E이면 반드시 SG
    "ETC": "제도·민원·기타",
}

EMERGENCY_DEPARTMENT_CODE = "SG"
EMERGENCY_DEPARTMENT_LABEL = DEPARTMENTS[EMERGENCY_DEPARTMENT_CODE]

_LABEL_TO_CODE = {label: code for code, label in DEPARTMENTS.items()}

# 3층 — 업무코드: code -> (부서코드, ARS 코드, 한글명)
# 예: 청약 문서는 DEP/subscription, 착오송금은 SG/misremit (kdh registry.csv와 동일)
BUSINESS_CODES: dict[str, tuple[str, str, str]] = {
    "limit": ("DEP", "G003", "이체한도"),
    "general": ("DEP", "G004", "일반·기타"),
    "txn": ("DEP", "G005", "거래내역"),
    "autopay": ("DEP", "G006", "자동이체"),
    "deposit": ("DEP", "G007", "예적금·발행어음"),
    "subscription": ("DEP", "G012", "주택청약"),
    "loan": ("LON", "G002", "대출"),
    "interest": ("LON", "G008", "금리·이자"),
    "ratecut": ("LON", "G009", "금리인하요구"),
    "fx": ("FX", "G010", "외환"),
    "pension": ("INV", "G011", "연금·IRP"),
    "misremit": ("SG", "G001", "착오송금"),
}


def department_label(code: str) -> str:
    return DEPARTMENTS.get(code, code)


def department_code(label: str) -> str | None:
    return _LABEL_TO_CODE.get(label)


def is_valid_department_label(label: str | None) -> bool:
    return label in _LABEL_TO_CODE


def is_valid_business_code(code: str | None) -> bool:
    """None(해당 없음)이거나 등록된 업무코드면 True."""
    return code is None or code in BUSINESS_CODES


def department_for_business_code(code: str) -> str | None:
    entry = BUSINESS_CODES.get(code)
    return entry[0] if entry else None
