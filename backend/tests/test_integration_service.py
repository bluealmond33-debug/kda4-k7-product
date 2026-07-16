from datetime import datetime, timezone

import pytest

from app.config import Settings
from app.contracts import EmotionResult, TranscriptResult
from app.integration_service import persist_pipeline_result


FINANCIAL_RESULT = {
    "summary": "주택담보대출 만기 연장과 필요 서류를 문의함.",
    "task_category": "대출",
    "consulting_situation": "만기 연장 문의",
    "qa_topic": "주택담보대출 만기 연장",
    "model_version": "team-model-test",
}


def test_existing_pipeline_can_inject_results_without_running_stt_or_model(
    monkeypatch,
) -> None:
    captured = {}

    def fake_save_call(settings, response, raw_model_result):
        captured["settings"] = settings
        captured["response"] = response
        captured["raw"] = raw_model_result

    monkeypatch.setattr("app.integration_service.save_call", fake_save_call)
    settings = Settings(database_url="postgresql://not-used-in-unit-test")
    transcript = TranscriptResult(
        text="주택담보대출 만기 연장과 필요 서류를 문의합니다.",
        stt_model="heechang-stt",
        duration_sec=4.2,
    )
    created_at = datetime(2026, 7, 16, tzinfo=timezone.utc)

    response = persist_pipeline_result(
        settings,
        audio_filename="customer.wav",
        transcript=transcript,
        raw_model_result=FINANCIAL_RESULT,
        created_at=created_at,
    )

    assert response.transcript is transcript
    assert response.consultation_card.business_type == "주택담보대출 만기 연장"
    assert response.consultation_card.department == "대출 및 금융상담"
    assert response.consultation_card.incident_risk.value == "low"
    assert response.consultation_card.emotion.status.value == "unavailable"
    assert response.created_at == created_at
    assert captured["raw"] == FINANCIAL_RESULT
    assert captured["response"] is response


def test_existing_pipeline_can_supply_real_emotion_result(monkeypatch) -> None:
    monkeypatch.setattr("app.integration_service.save_call", lambda *_args: None)
    emotion = EmotionResult(
        status="completed",
        score=72,
        level="elevated",
        reason="실제 감정 모델 결과",
    )

    response = persist_pipeline_result(
        Settings(database_url="postgresql://not-used-in-unit-test"),
        audio_filename="fraud.wav",
        transcript=TranscriptResult(
            text="본인 모르게 계좌가 개설되었습니다.",
            stt_model="heechang-stt",
        ),
        raw_model_result={
            "summary": "본인 미승인 계좌 개설 신고",
            "task_category": "전자금융",
            "consulting_situation": "명의도용 의심",
            "qa_topic": "무단 계좌 개설",
        },
        emotion=emotion,
        emotion_source="audio",
    )

    assert response.consultation_card.emotion is emotion
    assert response.consultation_card.incident_risk.value == "high"


def test_stt_duration_is_normalized_to_postgresql_precision(monkeypatch) -> None:
    captured = {}

    def fake_save_call(_settings, response, _raw_model_result):
        captured["response"] = response

    monkeypatch.setattr("app.integration_service.save_call", fake_save_call)
    transcript = TranscriptResult(
        text="주택담보대출 만기 연장을 문의합니다.",
        stt_model="whisper-1",
        duration_sec=10.100000381469727,
    )

    response = persist_pipeline_result(
        Settings(database_url="postgresql://not-used-in-unit-test"),
        audio_filename="customer.wav",
        transcript=transcript,
        raw_model_result=FINANCIAL_RESULT,
    )

    assert transcript.duration_sec == 10.100000381469727
    assert response.transcript.duration_sec == 10.1
    assert captured["response"].transcript.duration_sec == 10.1


def test_completed_emotion_rejects_non_audio_source(monkeypatch) -> None:
    monkeypatch.setattr("app.integration_service.save_call", lambda *_args: None)

    with pytest.raises(
        ValueError,
        match="completed emotion must be produced from customer audio",
    ):
        persist_pipeline_result(
            Settings(database_url="postgresql://not-used-in-unit-test"),
            audio_filename="customer.wav",
            transcript=TranscriptResult(
                text="상담 문의입니다.",
                stt_model="whisper-1",
            ),
            raw_model_result=FINANCIAL_RESULT,
            emotion=EmotionResult(
                status="completed",
                score=55,
                level="caution",
                reason="텍스트 키워드 기반 결과",
            ),
        )
