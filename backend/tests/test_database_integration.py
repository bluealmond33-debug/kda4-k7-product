import os
import psycopg
import pytest

from app.config import Settings
from app.contracts import TranscriptResult
from app.database import get_call, initialize_database
from app.integration_service import persist_pipeline_result


DATABASE_URL_ENV = "K7_TEST_DATABASE_URL"


@pytest.mark.integration
def test_postgresql_round_trip_preserves_korean_contract() -> None:
    database_url = os.getenv(DATABASE_URL_ENV)
    if not database_url:
        pytest.skip(f"{DATABASE_URL_ENV} is not configured")

    settings = Settings(database_url=database_url)
    raw_model_result = {
        "summary": "주택담보대출 만기 연장 및 필요 서류 문의",
        "task_category": "대출",
        "consulting_situation": "만기 연장 문의",
        "qa_topic": "주택담보대출 만기 연장",
        "model_version": "postgres-integration-test",
    }
    transcript = TranscriptResult(
        text="주택담보대출 만기 연장과 필요한 서류를 문의합니다.",
        stt_model="integration-test",
        duration_sec=3.25,
    )

    initialize_database(settings)
    response = None
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

        response = persist_pipeline_result(
            settings,
            audio_filename="통합검증.wav",
            transcript=transcript,
            raw_model_result=raw_model_result,
        )
        stored = get_call(settings, response.call_id)

        assert stored is not None
        assert stored.model_dump(mode="json") == response.model_dump(mode="json")
    finally:
        if response is not None:
            with psycopg.connect(database_url) as connection:
                with connection.cursor() as cursor:
                    cursor.execute("DELETE FROM calls WHERE call_id = %s", (response.call_id,))
