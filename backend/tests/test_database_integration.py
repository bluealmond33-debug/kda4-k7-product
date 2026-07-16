import os
from datetime import datetime, timezone
from uuid import uuid4

import psycopg
import pytest

from app.config import Settings
from app.contracts import (
    CallStatus,
    ConsultationCard,
    EmotionResult,
    IncidentRisk,
    MvpCallResponse,
    TranscriptResult,
)
from app.database import get_call, initialize_database, save_call


DATABASE_URL_ENV = "K7_TEST_DATABASE_URL"


@pytest.mark.integration
def test_postgresql_round_trip_preserves_korean_contract() -> None:
    database_url = os.getenv(DATABASE_URL_ENV)
    if not database_url:
        pytest.skip(f"{DATABASE_URL_ENV} is not configured")

    settings = Settings(database_url=database_url)
    response = MvpCallResponse(
        call_id=uuid4(),
        status=CallStatus.READY,
        audio_filename="통합검증.wav",
        transcript=TranscriptResult(
            text="주택담보대출 만기 연장과 필요한 서류를 문의합니다.",
            stt_model="integration-test",
            duration_sec=3.25,
        ),
        consultation_card=ConsultationCard(
            summary="주택담보대출 만기 연장 및 필요 서류 문의",
            business_type="주택담보대출 만기 연장",
            department="대출 및 금융상담",
            routing_reason="대출 만기 연장과 약정 변경 상담에 해당",
            incident_risk=IncidentRisk.LOW,
            routing_confidence=0.96,
            emotion=EmotionResult(
                status="unavailable",
                reason="감정 모델은 아직 MVP 통합 전입니다.",
            ),
        ),
        created_at=datetime.now(timezone.utc),
    )

    initialize_database(settings)
    try:
        with psycopg.connect(database_url) as connection:
            with connection.cursor() as cursor:
                cursor.execute("SHOW server_encoding")
                assert cursor.fetchone() == ("UTF8",)
                cursor.execute(
                    """
                    SELECT table_name
                    FROM information_schema.tables
                    WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
                    """
                )
                assert {row[0] for row in cursor.fetchall()} == {
                    "calls",
                    "transcripts",
                    "consultation_cards",
                }
                cursor.execute(
                    """
                    SELECT conname
                    FROM pg_constraint
                    WHERE conrelid IN (
                        'calls'::regclass,
                        'transcripts'::regclass,
                        'consultation_cards'::regclass
                    )
                    """
                )
                constraints = {row[0] for row in cursor.fetchall()}
                assert {
                    "calls_audio_filename_not_blank_chk",
                    "transcripts_stt_model_not_blank_chk",
                    "consultation_cards_schema_version_chk",
                    "consultation_cards_available_emotion_chk",
                } <= constraints

        save_call(settings, response, {"source": "postgres-integration-test"})
        stored = get_call(settings, response.call_id)

        assert stored is not None
        assert stored.model_dump(mode="json") == response.model_dump(mode="json")
    finally:
        with psycopg.connect(database_url) as connection:
            with connection.cursor() as cursor:
                cursor.execute("DELETE FROM calls WHERE call_id = %s", (response.call_id,))
