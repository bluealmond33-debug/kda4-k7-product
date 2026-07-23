"""카드 라우터 — 상담카드를 부서 큐로 보내는 라우팅 계층.

카드 라우팅 파이프라인(app/card_routing_pipeline.py)의 규칙·taxonomy 부품:
1단계 긴급 게이트(emergency_gate, 규칙 recall floor) →
2단계 AI 분석(card_routing_pipeline의 LLM 호출) →
(3단계 위험 감시는 후속: 통화 중 위험 신호로 긴급 승격)

taxonomy: 1층 routing(S/G/E) · 2층 부서 · 3층 업무코드 표준.
근거 문서: hippo 07 Outputs/2026-07-22-라우팅-부서체계-정리-및-RAG전처리-보고.md
"""

from app.routing.emergency_gate import EmergencyGateResult, check_emergency
from app.routing.taxonomy import (
    BUSINESS_CODES,
    DEPARTMENTS,
    EMERGENCY_DEPARTMENT_CODE,
    EMERGENCY_DEPARTMENT_LABEL,
    ROUTING_LEVELS,
    department_label,
    is_valid_business_code,
    is_valid_department_label,
)

__all__ = [
    "BUSINESS_CODES",
    "DEPARTMENTS",
    "EMERGENCY_DEPARTMENT_CODE",
    "EMERGENCY_DEPARTMENT_LABEL",
    "EmergencyGateResult",
    "ROUTING_LEVELS",
    "check_emergency",
    "department_label",
    "is_valid_business_code",
    "is_valid_department_label",
]
