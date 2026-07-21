"""데모 스텁 — 로컬모델도 OpenAI 키도 없을 때(STUB_MODELS=true) UI 흐름을 보여주기 위한
canned 응답. 실제 분석/STT가 아님을 텍스트로 투명하게 드러낸다(박정운 P0-3 투명성 원칙)."""

from uuid import uuid4

from app.schemas import GptAnalysis, RiskFlags, TranscribeResult


def analyze_transcript_stub(transcript: str) -> GptAnalysis:
    """실제 LLM 없이 고정 분석을 돌려준다. 위험 플래그는 전부 False(안전 기본값)."""
    return GptAnalysis(
        summary="[데모 스텁] 실제 분석 모델이 없어 생성된 예시 요약입니다. UI 흐름 확인용입니다.",
        department="일반상담팀",
        keywords=["데모", "스텁"],
        risk_flags=RiskFlags(),
    )


def transcribe_audio_stub(filename: str, file_bytes: bytes) -> TranscribeResult:
    """실제 STT 없이 고정 텍스트를 돌려준다. 입력 오디오는 사용하지 않는다."""
    return TranscribeResult(
        call_id=str(uuid4()),
        text="[데모 스텁] 실제 음성인식 없이 UI 흐름을 보여주기 위한 예시 인식 결과입니다.",
        duration_sec=0.0,
    )
