"""Small, auditable local RAG layer for the laptop demo.

The bundled documents are demonstration operating guides, not a bank's live
internal regulations. Retrieval is deterministic and runs without a network.
The selected passages are sent to the analysis model and returned to the UI so
the counselor can see what grounded the briefing.
"""

import json
import re
import re
from functools import lru_cache
from pathlib import Path
from typing import Any, Mapping

from app.contracts import KnowledgeReference


KNOWLEDGE_PATH = (
    Path(__file__).resolve().parents[2] / "database" / "knowledge" / "demo_guides.ko.json"
)


@lru_cache(maxsize=1)
def load_knowledge_documents() -> list[dict[str, Any]]:
    documents = json.loads(KNOWLEDGE_PATH.read_text(encoding="utf-8"))
    if not isinstance(documents, list) or not documents:
        raise ValueError("local knowledge base must contain documents")
    return documents


def _tokens(text: str) -> set[str]:
    return {
        token.casefold()
        for token in re.findall(r"[0-9A-Za-z가-힣]{2,}", text)
        if token.strip()
    }


def retrieve_knowledge(query: str, limit: int = 3) -> list[KnowledgeReference]:
    documents = load_knowledge_documents()
    query_tokens = _tokens(query)
    ranked: list[tuple[float, dict[str, Any]]] = []
    for document in documents:
        keywords = {str(value).casefold() for value in document.get("keywords", [])}
        body_tokens = _tokens(
            " ".join(
                [
                    str(document.get("title", "")),
                    str(document.get("section", "")),
                    str(document.get("excerpt", "")),
                ]
            )
        )
        keyword_hits = sum(
            1 for keyword in keywords if keyword in query.casefold()
        )
        token_hits = len(query_tokens & body_tokens)
        raw_score = keyword_hits * 4 + token_hits
        if raw_score:
            ranked.append((raw_score, document))

    ranked.sort(key=lambda item: (-item[0], str(item[1].get("doc_id", ""))))
    if not ranked:
        ranked = [(1.0, documents[0])]

    # If a domain guide matched, include its sibling checklist as supporting
    # context even when the caller did not happen to utter every keyword.
    top_family = str(ranked[0][1].get("doc_id", "")).rsplit("-", 1)[0]
    ranked_ids = {str(document.get("doc_id", "")) for _, document in ranked}
    related_score = max(ranked[0][0] * 0.55, 1.0)
    for document in documents:
        doc_id = str(document.get("doc_id", ""))
        if doc_id.startswith(top_family + "-") and doc_id not in ranked_ids:
            ranked.append((related_score, document))
            ranked_ids.add(doc_id)

    ranked.sort(key=lambda item: (-item[0], str(item[1].get("doc_id", ""))))
    max_score = ranked[0][0]
    return [
        KnowledgeReference(
            doc_id=document["doc_id"],
            title=document["title"],
            section=document["section"],
            excerpt=document["excerpt"],
            source=document["source"],
            score=round(min(1.0, score / max_score), 3),
        )
        for score, document in ranked[:limit]
    ]


_HIGH_RISK_TERMS = (
    "보이스피싱",
    "내가 하지 않은 이체",
    "본인 모르게 이체",
    "무단 이체",
    "무단거래",
    "명의도용",
    "원격제어",
    "악성앱",
    "지급정지",
    "계좌를 막아",
    "계좌 차단",
    "사기",
)

_SENSITIVE_INFORMATION_TERMS = (
    "비밀번호",
    "보안카드",
    "otp",
    "인증번호",
    "보안 질문",
    "개인 인증 정보",
)

_ACTION_REPLACEMENTS = (
    ("즉시 지급정지 조치를 요청", "지급정지 가능 여부와 접수 절차를 확인"),
    (
        "지급정지 신청을 진행하고, 신청 결과를 확인",
        "지급정지 가능 여부와 접수 절차를 확인하고, 접수된 경우 상태를 확인",
    ),
    ("예상 반환 시기", "반환 가능 여부와 절차"),
    ("반환될 예정", "반환 가능 여부"),
    ("예상 시간을 안내", "처리 기준과 확인 가능한 범위를 안내"),
)

_UNSAFE_ACTION_PATTERNS = (
    (
        re.compile(r"즉시[^.\n]*(?:이체|송금)[^.\n]*(?:중지|취소)[^.\n]*"),
        "의심 거래의 지급정지 가능 여부와 접수 절차를 확인",
    ),
    (
        re.compile(r"[^.\n]*(?:즉시\s*)?(?:보상|환불)[^.\n]*(?:조치|진행|처리)[^.\n]*"),
        "피해구제 접수 가능 여부와 절차를 확인",
    ),
    (
        re.compile(r"[^.\n]*(?:이체 사실|거래)[^.\n]*확인[^.\n]*즉시 지급정지[^.\n]*"),
        "의심 거래 사실을 확인하고 지급정지 가능 여부와 접수 절차를 확인",
    ),
    (
        re.compile(r"언제까지[^.\n]*(?:돌려받|반환|환불)[^.\n]*"),
        "피해금 반환 가능 여부와 처리 절차를 확인 가능한 범위에서 안내",
    ),
)


def _sanitize_model_text(value: object) -> str:
    text = str(value or "").strip()
    for unsafe, safe in _ACTION_REPLACEMENTS:
        text = text.replace(unsafe, safe)
    for pattern, safe in _UNSAFE_ACTION_PATTERNS:
        text = pattern.sub(safe, text)
    return text


def apply_safety_policy(
    transcript: str,
    raw_result: Mapping[str, Any],
) -> dict[str, Any]:
    """Apply deterministic minimum safeguards after model generation."""

    result = dict(raw_result)
    matched = [term for term in _HIGH_RISK_TERMS if term in transcript]
    if matched:
        result["incident_risk"] = "high"
        result["risk_reason"] = "고객 발화에서 금융사고 징후 확인: " + ", ".join(matched[:4])
        result["department"] = "금융사기"
        result["routing_reason"] = (
            "무단거래·보이스피싱 의심 발화가 있어 금융사고 대응 절차를 우선 적용"
        )

    sanitized_actions: list[dict[str, str]] = []
    for item in result.get("required_actions") or []:
        if not isinstance(item, Mapping):
            continue
        title = _sanitize_model_text(item.get("title"))
        detail = _sanitize_model_text(item.get("detail"))
        source = str(item.get("source") or "model")
        if title and detail and source in {"model", "policy", "rag"}:
            sanitized_actions.append(
                {"title": title, "detail": detail, "source": source}
            )
    actions = sanitized_actions

    safe_missing: list[str] = []
    removed_sensitive = False
    for value in result.get("missing_information") or []:
        item = str(value).strip()
        if any(term in item.casefold() for term in _SENSITIVE_INFORMATION_TERMS):
            removed_sensitive = True
            continue
        if item:
            safe_missing.append(item)
    if removed_sensitive:
        safe_missing.append(
            "승인된 본인확인 절차 완료 여부(인증값 자체는 기록하지 않음)"
        )
    result["missing_information"] = safe_missing[:8]
    if matched:
        policy_actions = [
            {
                "title": "본인확인 우선 진행",
                "detail": "고객 상세정보 조회나 업무 처리 전에 승인된 수단으로 본인확인을 완료합니다.",
                "source": "policy",
            },
            {
                "title": "거래 핵심정보 확인",
                "detail": "이체 시각·금액·수취계좌·고객이 취한 보호조치를 확인합니다.",
                "source": "policy",
            },
            {
                "title": "금융사고 절차 우선 안내",
                "detail": "지급정지 가능 여부와 피해구제 접수 절차를 확인하되 처리 완료를 단정하지 않습니다.",
                "source": "policy",
            },
        ]
        policy_titles = {item["title"] for item in policy_actions}
        actions = policy_actions + [
            item
            for item in actions
            if isinstance(item, Mapping) and str(item.get("title", "")) not in policy_titles
        ]
    result["required_actions"] = actions[:8]
    return result


def references_for_prompt(references: list[KnowledgeReference]) -> str:
    return "\n\n".join(
        f"[{ref.doc_id}] {ref.title} / {ref.section}\n{ref.excerpt}"
        for ref in references
    )
