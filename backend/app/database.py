from pathlib import Path
from uuid import UUID

import psycopg
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb

from app.config import Settings
from app.contracts import MvpCallResponse


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


def save_call(settings: Settings, response: MvpCallResponse, raw_model_result: dict) -> None:
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
                        raw_model_result
                    )
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
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
                    ),
                )
    except psycopg.Error as exc:
        raise DatabaseUnavailable("PostgreSQL call save failed") from exc


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
                        card.emotion_level, card.emotion_reason
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
