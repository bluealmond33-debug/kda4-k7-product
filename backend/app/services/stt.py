"""1단계: STT — OpenAI Whisper API(whisper-1)로 음성을 텍스트로 변환."""

import uuid

from openai import OpenAI

from app.schemas import TranscribeResult


def transcribe_audio(client: OpenAI, filename: str, file_bytes: bytes) -> TranscribeResult:
    response = client.audio.transcriptions.create(
        model="whisper-1",
        file=(filename, file_bytes),
        language="ko",
        response_format="verbose_json",
    )

    return TranscribeResult(
        call_id=str(uuid.uuid4()),
        text=response.text,
        duration_sec=getattr(response, "duration", 0.0) or 0.0,
    )
