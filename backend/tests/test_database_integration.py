import os
from uuid import uuid4

import psycopg
import pytest
from psycopg.types.json import Jsonb

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
        duration_sec=10.100000381469727,
    )
    call_id = uuid4()
    raw_emotion_result = {
        "schema_version": "1.0",
        "external_session_key": str(call_id),
        "result_key": "postgres-emotion-test",
        "model_name": "team-audio-emotion",
        "model_version": "0.1.0",
        "analysis_status": "completed",
        "emotion_temperature_score": 58,
        "emotion_temperature_level": "caution",
        "voice_arousal_score": 60,
        "voice_dominance_score": 50,
        "voice_valence_score": 35,
        "negative_activation_score": 45,
        "audio_quality": "normal",
        "failure_code": None,
        "generated_at": "2026-07-16T08:00:00Z",
    }

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
                    "consultation_cards_active_emotion_status_chk",
                    "consultation_cards_emotion_level_chk",
                    "consultation_cards_temperature_band_chk",
                } <= constraints
                cursor.execute(
                    """
                    SELECT data_type
                    FROM information_schema.columns
                    WHERE table_schema = 'public'
                      AND table_name = 'consultation_cards'
                      AND column_name = 'raw_emotion_result'
                    """
                )
                assert cursor.fetchone() == ("jsonb",)

        invalid_call_id = uuid4()
        with pytest.raises(psycopg.errors.CheckViolation):
            with psycopg.connect(database_url) as connection:
                connection.execute(
                    """
                    INSERT INTO calls (
                        call_id, status, source_channel, audio_filename
                    )
                    VALUES (%s, 'ready', 'voice', 'invalid-emotion.wav')
                    """,
                    (invalid_call_id,),
                )
                connection.execute(
                    """
                    INSERT INTO transcripts (
                        call_id, transcript_text, stt_model, duration_sec
                    )
                    VALUES (%s, '감정 제약 검증', 'integration-test', 1)
                    """,
                    (invalid_call_id,),
                )
                connection.execute(
                    """
                    INSERT INTO consultation_cards (
                        call_id, summary, business_type, department,
                        routing_reason, incident_risk, emotion_status,
                        emotion_score, emotion_level, raw_model_result,
                        raw_emotion_result
                    )
                    VALUES (
                        %s, '잘못된 감정 조합', '테스트', '테스트',
                        'DB 제약 검증', 'low', 'completed',
                        74, 'stable', %s, %s
                    )
                    """,
                    (
                        invalid_call_id,
                        Jsonb({}),
                        Jsonb({"test": "invalid score-level pair"}),
                    ),
                )

        demo_call_id = uuid4()
        with pytest.raises(psycopg.errors.CheckViolation):
            with psycopg.connect(database_url) as connection:
                connection.execute(
                    """
                    INSERT INTO calls (
                        call_id, status, source_channel, audio_filename
                    )
                    VALUES (%s, 'ready', 'voice', 'demo-emotion.wav')
                    """,
                    (demo_call_id,),
                )
                connection.execute(
                    """
                    INSERT INTO transcripts (
                        call_id, transcript_text, stt_model, duration_sec
                    )
                    VALUES (%s, '데모 감정 차단 검증', 'integration-test', 1)
                    """,
                    (demo_call_id,),
                )
                connection.execute(
                    """
                    INSERT INTO consultation_cards (
                        call_id, summary, business_type, department,
                        routing_reason, incident_risk, emotion_status,
                        emotion_score, emotion_level, raw_model_result,
                        raw_emotion_result
                    )
                    VALUES (
                        %s, '데모 감정 차단', '테스트', '테스트',
                        'DB 상태 제약 검증', 'low', 'demo',
                        50, 'caution', %s, %s
                    )
                    """,
                    (
                        demo_call_id,
                        Jsonb({}),
                        Jsonb({"test": "demo status"}),
                    ),
                )

        response = persist_pipeline_result(
            settings,
            call_id=call_id,
            audio_filename="통합검증.wav",
            transcript=transcript,
            raw_model_result=raw_model_result,
            raw_emotion_result=raw_emotion_result,
            emotion_source="audio",
        )
        stored = get_call(settings, response.call_id)

        assert stored is not None
        assert stored.model_dump(mode="json") == response.model_dump(mode="json")
        assert response.transcript.duration_sec == 10.1
        assert response.consultation_card.emotion.status.value == "completed"
        assert response.consultation_card.emotion.score == 58
        assert response.consultation_card.emotion.level.value == "caution"
        with psycopg.connect(database_url) as connection:
            raw_emotion = connection.execute(
                """
                SELECT raw_emotion_result
                FROM consultation_cards
                WHERE call_id = %s
                """,
                (response.call_id,),
            ).fetchone()
            assert raw_emotion is not None
            assert raw_emotion[0]["external_session_key"] == str(response.call_id)
            assert raw_emotion[0]["emotion_temperature_score"] == 58
    finally:
        if response is not None:
            with psycopg.connect(database_url) as connection:
                with connection.cursor() as cursor:
                    cursor.execute("DELETE FROM calls WHERE call_id = %s", (response.call_id,))
