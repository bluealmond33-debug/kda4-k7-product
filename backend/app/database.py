from datetime import datetime
from pathlib import Path
from uuid import UUID

import psycopg
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb

from app.config import Settings
from app.contracts import ConsultationCard, MvpCallResponse


SCHEMA_PATH = Path(__file__).resolve().parents[2] / "database" / "mvp" / "schema.sql"


class DatabaseUnavailable(RuntimeError):
    pass


def _database_url(settings: Settings) -> str:
    if not settings.database_url:
        raise DatabaseUnavailable("DATABASE_URL is not configured")
    return settings.database_url


def initialize_database(settings: Settings) -> None:
    schema = SCHEMA_PATH.read_text(encoding="utf-8")
    try:
        with psycopg.connect(_database_url(settings)) as connection:
            with connection.cursor() as cursor:
                cursor.execute(schema)
    except psycopg.Error as exc:
        raise DatabaseUnavailable("PostgreSQL schema initialization failed") from exc


def ping_database(settings: Settings) -> bool:
    if not settings.database_url:
        return False
    try:
        with psycopg.connect(settings.database_url, connect_timeout=3) as connection:
            with connection.cursor() as cursor:
                cursor.execute("SELECT 1")
                return cursor.fetchone() == (1,)
    except psycopg.Error:
        return False


def save_call(
    settings: Settings,
    response: MvpCallResponse,
    raw_model_result: dict,
    raw_emotion_result: dict | None = None,
    routing_evidence: dict | None = None,
) -> None:
    card = response.consultation_card
    transcript = response.transcript
    try:
        with psycopg.connect(_database_url(settings)) as connection:
            with connection.cursor() as cursor:
                cursor.execute(
                    """
                    INSERT INTO calls (call_id, status, source_channel, audio_filename, created_at)
                    VALUES (%s, %s, %s, %s, %s)
                    """,
                    (
                        response.call_id,
                        response.status.value,
                        response.source_channel,
                        response.audio_filename,
                        response.created_at,
                    ),
                )
                cursor.execute(
                    """
                    INSERT INTO transcripts (call_id, transcript_text, stt_model, duration_sec)
                    VALUES (%s, %s, %s, %s)
                    """,
                    (
                        response.call_id,
                        transcript.text,
                        transcript.stt_model,
                        transcript.duration_sec,
                    ),
                )
                cursor.execute(
                    """
                    INSERT INTO consultation_cards (
                        call_id, schema_version, summary, business_type, department,
                        routing_reason, incident_risk, risk_reason, routing_confidence,
                        emotion_status, emotion_score, emotion_level, emotion_reason,
                        raw_model_result, raw_emotion_result, briefing_payload
                    )
                    VALUES (
                        %s, %s, %s, %s, %s, %s, %s, %s,
                        %s, %s, %s, %s, %s, %s, %s, %s
                    )
                    """,
                    (
                        response.call_id,
                        response.schema_version,
                        card.summary,
                        card.business_type,
                        card.department,
                        card.routing_reason,
                        card.incident_risk.value,
                        card.risk_reason,
                        card.routing_confidence,
                        card.emotion.status.value,
                        card.emotion.score,
                        card.emotion.level,
                        card.emotion.reason,
                        Jsonb(raw_model_result),
                        Jsonb(raw_emotion_result or {}),
                        Jsonb(
                            {
                                "customer_requests": card.customer_requests,
                                "missing_information": card.missing_information,
                                "required_actions": [
                                    item.model_dump(mode="json")
                                    for item in card.required_actions
                                ],
                                "knowledge_references": [
                                    item.model_dump(mode="json")
                                    for item in card.knowledge_references
                                ],
                                "attention_level": card.attention_level.value,
                                "reason_codes": card.reason_codes,
                                "routing": (
                                    card.routing.model_dump(mode="json")
                                    if card.routing
                                    else None
                                ),
                                "text_emotion": (
                                    card.text_emotion.model_dump(mode="json")
                                    if card.text_emotion
                                    else None
                                ),
                                "routing_evidence": routing_evidence or {},
                            }
                        ),
                    ),
                )
    except psycopg.Error as exc:
        raise DatabaseUnavailable("PostgreSQL call save failed") from exc


# ── 실시간 통화 저장 (WS /ws/call) — 단계별 저장 ────────────────────────────
# 배치(save_call)는 통화 완료본을 한 트랜잭션에 넣지만, 실시간은 "시작 → 발화 누적
# → 종료 확정"으로 상태가 진행된다. calls.status(processing→ready)와
# transcripts.call_id UNIQUE(통화당 1행 누적 upsert)가 이 수명주기를 지원한다.
# 호출부(app/ws/call.py)는 이 함수들을 best-effort로 부른다 — DB가 없거나 실패해도
# 라이브 통화 자체는 끊기지 않아야 하므로 예외는 호출부에서 잡는다.

def create_live_call(
    settings: Settings,
    call_id: UUID,
    created_at: datetime,
    audio_filename: str = "실시간 통화",
) -> None:
    """통화 시작 — calls 행을 processing으로 생성(멱등: 재연결 시 중복 무시)."""
    with psycopg.connect(_database_url(settings)) as connection:
        with connection.cursor() as cursor:
            cursor.execute(
                """
                INSERT INTO calls (call_id, status, source_channel, audio_filename, created_at)
                VALUES (%s, 'processing', 'voice', %s, %s)
                ON CONFLICT (call_id) DO NOTHING
                """,
                (call_id, audio_filename, created_at),
            )


def append_live_transcript(
    settings: Settings,
    call_id: UUID,
    masked_text: str,
    stt_model: str,
    duration_sec: float = 0.0,
) -> None:
    """발화 하나(마스킹본)를 통화 전사에 누적 — 상담 중 실시간 저장.

    transcripts.call_id가 UNIQUE라 통화당 한 행에 append한다. 첫 발화는 INSERT,
    이후는 기존 텍스트 뒤에 이어 붙인다. 마스킹본만 저장한다(원본 전사 저장 안 함).
    """
    text = (masked_text or "").strip()
    if not text:
        return
    with psycopg.connect(_database_url(settings)) as connection:
        with connection.cursor() as cursor:
            cursor.execute(
                """
                INSERT INTO transcripts (call_id, transcript_text, stt_model, duration_sec)
                VALUES (%s, %s, %s, %s)
                ON CONFLICT (call_id) DO UPDATE SET
                    transcript_text = transcripts.transcript_text || ' ' || EXCLUDED.transcript_text,
                    duration_sec = transcripts.duration_sec + EXCLUDED.duration_sec
                """,
                (call_id, text, stt_model, duration_sec),
            )


def finalize_live_call(
    settings: Settings,
    call_id: UUID,
    card: ConsultationCard,
    raw_model_result: dict,
) -> None:
    """통화 종료 — 상담카드 저장 + calls를 ready로. 카드는 멱등 upsert."""
    with psycopg.connect(_database_url(settings)) as connection:
        with connection.cursor() as cursor:
            cursor.execute(
                """
                INSERT INTO consultation_cards (
                    call_id, schema_version, summary, business_type, department,
                    routing_reason, incident_risk, risk_reason, routing_confidence,
                    emotion_status, emotion_score, emotion_level, emotion_reason,
                    raw_model_result
                )
                VALUES (%s, 'mvp-1.1', %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                ON CONFLICT (call_id) DO UPDATE SET
                    summary = EXCLUDED.summary,
                    business_type = EXCLUDED.business_type,
                    department = EXCLUDED.department,
                    routing_reason = EXCLUDED.routing_reason,
                    incident_risk = EXCLUDED.incident_risk,
                    risk_reason = EXCLUDED.risk_reason,
                    routing_confidence = EXCLUDED.routing_confidence,
                    emotion_status = EXCLUDED.emotion_status,
                    emotion_score = EXCLUDED.emotion_score,
                    emotion_level = EXCLUDED.emotion_level,
                    emotion_reason = EXCLUDED.emotion_reason,
                    raw_model_result = EXCLUDED.raw_model_result,
                    updated_at = CURRENT_TIMESTAMP
                """,
                (
                    call_id,
                    card.summary,
                    card.business_type,
                    card.department,
                    card.routing_reason,
                    card.incident_risk.value,
                    card.risk_reason,
                    card.routing_confidence,
                    card.emotion.status.value,
                    card.emotion.score,
                    card.emotion.level,
                    card.emotion.reason,
                    Jsonb(raw_model_result),
                ),
            )
            cursor.execute(
                "UPDATE calls SET status = 'ready' WHERE call_id = %s",
                (call_id,),
            )


def mark_live_call_failed(settings: Settings, call_id: UUID) -> None:
    """발화 없이 끝났거나 카드 확정 실패 — 아직 processing이면 failed로."""
    with psycopg.connect(_database_url(settings)) as connection:
        with connection.cursor() as cursor:
            cursor.execute(
                "UPDATE calls SET status = 'failed' WHERE call_id = %s AND status = 'processing'",
                (call_id,),
            )


def get_call(settings: Settings, call_id: UUID) -> MvpCallResponse | None:
    try:
        with psycopg.connect(_database_url(settings), row_factory=dict_row) as connection:
            with connection.cursor() as cursor:
                cursor.execute(
                    """
                    SELECT
                        c.call_id, c.status, c.source_channel, c.audio_filename, c.created_at,
                        t.transcript_text, t.stt_model, t.duration_sec,
                        card.schema_version, card.summary, card.business_type, card.department,
                        card.routing_reason, card.incident_risk, card.risk_reason,
                        card.routing_confidence, card.emotion_status, card.emotion_score,
                        card.emotion_level, card.emotion_reason, card.briefing_payload
                    FROM calls AS c
                    JOIN transcripts AS t ON t.call_id = c.call_id
                    JOIN consultation_cards AS card ON card.call_id = c.call_id
                    WHERE c.call_id = %s
                    """,
                    (call_id,),
                )
                row = cursor.fetchone()
    except psycopg.Error as exc:
        raise DatabaseUnavailable("PostgreSQL call lookup failed") from exc
    if row is None:
        return None
    briefing = row["briefing_payload"] or {}
    return MvpCallResponse.model_validate(
        {
            "schema_version": row["schema_version"],
            "call_id": row["call_id"],
            "status": row["status"],
            "source_channel": row["source_channel"],
            "audio_filename": row["audio_filename"],
            "transcript": {
                "text": row["transcript_text"],
                "stt_model": row["stt_model"],
                "duration_sec": float(row["duration_sec"] or 0),
            },
            "consultation_card": {
                "summary": row["summary"],
                "business_type": row["business_type"],
                "department": row["department"],
                "routing_reason": row["routing_reason"],
                "incident_risk": row["incident_risk"],
                "risk_reason": row["risk_reason"],
                "routing_confidence": row["routing_confidence"],
                "customer_requests": briefing.get("customer_requests", []),
                "missing_information": briefing.get("missing_information", []),
                "required_actions": briefing.get("required_actions", []),
                "knowledge_references": briefing.get("knowledge_references", []),
                "attention_level": briefing.get(
                    "attention_level",
                    "high" if row["incident_risk"] == "high" else "none",
                ),
                "reason_codes": briefing.get(
                    "reason_codes",
                    ["FINANCIAL_INCIDENT"]
                    if row["incident_risk"] == "high"
                    else [],
                ),
                "routing": briefing.get("routing"),
                "text_emotion": briefing.get("text_emotion"),
                "emotion": {
                    "status": row["emotion_status"],
                    "score": row["emotion_score"],
                    "level": row["emotion_level"],
                    "reason": row["emotion_reason"],
                },
            },
            "created_at": row["created_at"],
        }
    )
