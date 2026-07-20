"""Compatibility router for the already deployed lhc demo endpoints.

These paths remain available so existing dashboards do not break. They are
explicitly demo/placeholder behavior. New integration must use /api/v1/calls.
"""

import hashlib
import random
from uuid import uuid4

from fastapi import APIRouter, File, Form, HTTPException, UploadFile

from app.config import Settings
from app.contracts import IncidentRisk
from app.pipeline import analyze_transcript, transcribe_audio
from app.rag import RegulationSearchUnavailable, search_regulations


router = APIRouter(tags=["legacy-demo-compatibility"])

_DUMMY_DOCS = [
    {
        "doc_id": "proc-001",
        "title": "지급정지 신청 절차",
        "excerpt": "금융사고 신고 시 지급정지와 피해구제 신청 절차를 안내한다.",
        "score": 0.9,
    },
    {
        "doc_id": "proc-002",
        "title": "인증정보 노출 대응",
        "excerpt": "인증정보 노출 시 비밀번호 변경과 최근 거래내역 확인을 안내한다.",
        "score": 0.8,
    },
    {
        "doc_id": "proc-003",
        "title": "반복 민원 처리",
        "excerpt": "이전 상담 이력을 확인하고 숙련 상담사 또는 전담 부서로 이관한다.",
        "score": 0.7,
    },
]


def _demo_emotion(source: bytes) -> dict:
    seed = int(hashlib.sha256(source).hexdigest(), 16) % (2**32)
    rng = random.Random(seed)
    anger = round(rng.uniform(0.0, 0.4), 3)
    anxiety = round(rng.uniform(0.0, 0.4), 3)
    neutral = round(max(0.0, 1.0 - anger - anxiety), 3)
    uncertainty = round(rng.uniform(0.05, 0.35), 3)
    return {
        "anger_probability": anger,
        "anxiety_probability": anxiety,
        "neutral_probability": neutral,
        "uncertainty": uncertainty,
    }


def _emotion_projection(emotion: dict) -> dict:
    peak = max(emotion["anger_probability"], emotion["anxiety_probability"])
    if peak >= 0.6:
        level = 3
    elif peak >= 0.3:
        level = 2
    elif peak > 0:
        level = 1
    else:
        level = 0
    labels = ["안정", "보통", "상승", "격앙 주의"]
    signals = []
    if emotion["anxiety_probability"] >= 0.3:
        signals.append("불안·다급 발화 감지")
    if emotion["anger_probability"] >= 0.3:
        signals.append("분노 발화 감지")
    return {"level": level, "label": labels[level], "signals": signals}


def _risk_flags(is_high: bool) -> dict:
    return {
        "actual_damage_occurred": is_high,
        "credential_exposed": False,
        "remote_app_installed": False,
        "control_lost": False,
        "protection_measures_incomplete": is_high,
        "damage_amount_unknown": False,
        "transfer_time_unknown": False,
        "payment_hold_status_unknown": False,
        "protection_status_unknown": False,
        "other_critical_info_missing": False,
        "multiple_issues_present": False,
        "multiple_procedures_applicable": False,
        "repeat_contact_same_case": False,
        "prior_resolution_failed": False,
    }


def _judge(risk_flags: dict, emotion: dict) -> dict:
    high = any(
        risk_flags.get(key, False)
        for key in (
            "actual_damage_occurred",
            "credential_exposed",
            "remote_app_installed",
            "control_lost",
            "protection_measures_incomplete",
        )
    )
    emotional = max(
        float(emotion.get("anger_probability", 0)),
        float(emotion.get("anxiety_probability", 0)),
    ) >= 0.3
    reasons = []
    if high:
        reasons.append("FINANCIAL_ACCIDENT")
    if emotional:
        reasons.append("HIGH_EMOTIONAL_DISTRESS")
    return {
        "needs_attention": bool(reasons),
        "attention_level": "높음" if high else "보통" if emotional else "주의 불필요",
        "reason_codes": reasons,
        "recommended_agent_level": "사고전문" if high else "숙련" if emotional else "일반",
    }


def _regulation_references(settings: Settings, query: str) -> list[dict]:
    """Real regulation hits when the RAG index is provisioned; else placeholders.

    Keeps the legacy {doc_id, title, excerpt, score} shape (enriched with
    page/section when available) so existing dashboards do not break.
    """
    query = (query or "").strip()
    if query:
        try:
            hits = search_regulations(settings, query, limit=3)
        except (RegulationSearchUnavailable, ValueError):
            hits = []
        if hits:
            return [
                {
                    "doc_id": h["doc_id"],
                    "title": h["title"],
                    "excerpt": h["excerpt"],
                    "score": h["score"],
                    "page": h["page"],
                    "section": h["section"],
                }
                for h in hits
            ]
    return _DUMMY_DOCS


def build_compat_router(settings: Settings) -> APIRouter:
    @router.post("/stt", deprecated=True)
    def legacy_stt(audio: UploadFile = File(...)) -> dict:
        result = transcribe_audio(settings, audio.filename or "audio.wav", audio.file.read())
        return {"call_id": str(uuid4()), **result.model_dump()}

    @router.post("/emotion", deprecated=True)
    def legacy_emotion(body: dict) -> dict:
        return _emotion_projection(_demo_emotion(str(body.get("text", "")).encode("utf-8")))

    @router.post("/summarize", deprecated=True)
    def legacy_summarize(body: dict) -> dict:
        text = str(body.get("transcript", {}).get("text", "")).strip()
        if not text:
            raise HTTPException(status_code=400, detail="transcript.text is required")
        analysis, _ = analyze_transcript(settings, text)
        emotion = _emotion_projection(_demo_emotion(text.encode("utf-8")))
        return {
            "type": analysis.department,
            "headline": analysis.summary,
            "bullets": [analysis.summary, analysis.routing_reason],
            "emotion": emotion,
            "incidentRisk": "high" if analysis.incident_risk == IncidentRisk.HIGH else "none",
            "recommendedAgent": "사고전문 상담사 우선" if analysis.incident_risk == IncidentRisk.HIGH else "일반 상담사 우선",
        }

    @router.post("/analyze-text", deprecated=True)
    def legacy_analyze_text(body: dict) -> dict:
        text = str(body.get("text", "")).strip()
        if not text:
            raise HTTPException(status_code=400, detail="text is required")
        analysis, _ = analyze_transcript(settings, text)
        emotion = _demo_emotion(text.encode("utf-8"))
        peak = max(emotion["anger_probability"], emotion["anxiety_probability"])
        return {
            "call_id": str(uuid4()),
            "summary": analysis.summary,
            "category": analysis.business_type,
            "emotion": {"label": _emotion_projection(emotion)["label"], "score": peak},
            "urgency_score": 80 if analysis.incident_risk == IncidentRisk.HIGH else 30,
            "routing": {"department": analysis.department, "reason": analysis.routing_reason},
            "keywords": [analysis.business_type, analysis.department],
        }

    @router.post("/analyze", deprecated=True)
    def legacy_analyze(
        audio: UploadFile = File(...), transcript: str = Form(...)
    ) -> dict:
        analysis, _ = analyze_transcript(settings, transcript)
        emotion = _demo_emotion(audio.file.read())
        return {
            "gpt": {
                "summary": analysis.summary,
                "department": analysis.department,
                "keywords": [analysis.business_type],
                "risk_flags": _risk_flags(analysis.incident_risk == IncidentRisk.HIGH),
            },
            "emotion": emotion,
        }

    @router.post("/judge", deprecated=True)
    def legacy_judge(body: dict) -> dict:
        return _judge(body.get("gpt", {}).get("risk_flags", {}), body.get("emotion", {}))

    @router.post("/rag", deprecated=True)
    def legacy_rag(body: dict) -> dict:
        query = str(
            body.get("query")
            or body.get("text")
            or body.get("summary")
            or ""
        )
        return {"documents": _regulation_references(settings, query)}

    @router.post("/briefing", deprecated=True)
    def legacy_briefing(audio: UploadFile = File(...)) -> dict:
        audio_bytes = audio.file.read()
        transcript = transcribe_audio(settings, audio.filename or "audio.wav", audio_bytes)
        analysis, _ = analyze_transcript(settings, transcript.text)
        emotion = _demo_emotion(audio_bytes)
        risk_flags = _risk_flags(analysis.incident_risk == IncidentRisk.HIGH)
        return {
            "call_id": str(uuid4()),
            "transcript": transcript.text,
            "summary": analysis.summary,
            "department": analysis.department,
            "emotion": emotion,
            "judgement": _judge(risk_flags, emotion),
            "references": _regulation_references(settings, analysis.summary),
        }

    return router
