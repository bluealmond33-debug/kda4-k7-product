from enum import Enum
from typing import Optional

from pydantic import BaseModel, Field


# ---------- STT ----------

class TranscribeResult(BaseModel):
    call_id: str
    text: str
    duration_sec: float


# ---------- GPT 분석 ----------

class RiskFlags(BaseModel):
    """4단계 판단 로직의 입력이 되는 원자적 플래그들."""

    # 금융사고 위험
    actual_damage_occurred: bool = False
    credential_exposed: bool = False
    remote_app_installed: bool = False
    control_lost: bool = False
    protection_measures_incomplete: bool = False

    # 정보 부족
    damage_amount_unknown: bool = False
    transfer_time_unknown: bool = False
    payment_hold_status_unknown: bool = False
    protection_status_unknown: bool = False
    other_critical_info_missing: bool = False

    # 복합/반복 상담
    multiple_issues_present: bool = False
    multiple_procedures_applicable: bool = False
    repeat_contact_same_case: bool = False
    prior_resolution_failed: bool = False


class GptAnalysis(BaseModel):
    summary: str
    department: str
    keywords: list[str]
    risk_flags: RiskFlags


# ---------- 감정분석 ----------

class EmotionResult(BaseModel):
    anger_probability: float = Field(ge=0, le=1)
    anxiety_probability: float = Field(ge=0, le=1)
    neutral_probability: float = Field(ge=0, le=1)
    uncertainty: float = Field(ge=0, le=1)


# ---------- 텍스트 감정분류 (EXAONE, 음향 모델과 별도 채널) ----------

class TextEmotionResult(BaseModel):
    """전사문(글자)만으로 판단 가능한 것만 담는다 — 목소리 톤은 원리상 알 수 없으므로
    voice_tone은 항상 고정값이다. 박정운 음향 모델(EmotionResult)과 합쳐 쓰는 걸 전제로 한다."""

    content_emotion: str
    situation_severity: str
    urgency_score: int = Field(ge=0, le=100)
    voice_tone: str = "unknown_text_only"
    evidence: str


class AnalyzeResult(BaseModel):
    gpt: GptAnalysis
    emotion: EmotionResult
    text_emotion: Optional[TextEmotionResult] = None


# ---------- 주의 여부 판단 ----------

class AttentionReasonCode(str, Enum):
    FINANCIAL_ACCIDENT = "FINANCIAL_ACCIDENT"
    CREDENTIAL_EXPOSED = "CREDENTIAL_EXPOSED"
    REMOTE_APP_INSTALLED = "REMOTE_APP_INSTALLED"
    CONTROL_LOST = "CONTROL_LOST"
    PROTECTION_NOT_DONE = "PROTECTION_NOT_DONE"
    MISSING_CRITICAL_INFO = "MISSING_CRITICAL_INFO"
    MULTIPLE_INTENTS = "MULTIPLE_INTENTS"
    REPEAT_CONTACT = "REPEAT_CONTACT"
    PRIOR_RESOLUTION_FAILED = "PRIOR_RESOLUTION_FAILED"
    HIGH_EMOTIONAL_DISTRESS = "HIGH_EMOTIONAL_DISTRESS"
    TEXT_HIGH_RISK_SIGNAL = "TEXT_HIGH_RISK_SIGNAL"


class AttentionLevel(str, Enum):
    NONE = "주의 불필요"
    MEDIUM = "보통"
    HIGH = "높음"


class RecommendedAgentLevel(str, Enum):
    GENERAL = "일반"
    SPECIALIST = "전문"
    EXPERIENCED = "숙련"
    ACCIDENT_SPECIALIST = "사고전문"


class JudgeResult(BaseModel):
    needs_attention: bool
    attention_level: AttentionLevel
    reason_codes: list[AttentionReasonCode]
    recommended_agent_level: RecommendedAgentLevel


# ---------- RAG ----------

class RagDocument(BaseModel):
    doc_id: str
    title: str
    excerpt: str
    score: float


class RagResult(BaseModel):
    documents: list[RagDocument]


# ---------- 요청 바디 ----------

class JudgeRequest(BaseModel):
    gpt: GptAnalysis
    emotion: EmotionResult


class RagRequest(BaseModel):
    reason_codes: list[AttentionReasonCode]
    summary: str


# ---------- 팀 기존 api_contract.md 호환 (demo_live.html 연동용) ----------
# docs/api_contract.md의 "분석 결과(②→③)" 스키마 그대로. 이미 그 스키마를 소비하도록
# 짜여진 demo_live.html(app/lib의 fetchBackendAnalysis)을 고치지 않고 붙이기 위한 어댑터.

class LegacyAnalyzeRequest(BaseModel):
    text: str
    average_volume: float = 0


class LegacyEmotion(BaseModel):
    label: str
    score: float


class LegacyRouting(BaseModel):
    department: str
    reason: str


class LegacyAnalyzeResponse(BaseModel):
    call_id: str
    summary: str
    category: str
    emotion: LegacyEmotion
    urgency_score: int
    routing: LegacyRouting
    keywords: list[str]


# ---------- kda4-k7-product(팀 React 데모) 연동 ----------
# src/services/types.ts의 계약을 그대로 따른다. 그쪽 TS 인터페이스가 camelCase 필드명을
# JSON 키로 그대로 쓰기 때문에(별도 케이스 변환 없음), 여기서도 필드명을 camelCase로 맞춘다.

class ReactTranscriptChunk(BaseModel):
    text: str
    at: int
    isFinal: bool


class ReactTranscript(BaseModel):
    chunks: list[ReactTranscriptChunk]
    text: str


class ReactSummarizeRequest(BaseModel):
    transcript: ReactTranscript


class ReactEmotionRequest(BaseModel):
    text: str


class ReactEmotionScore(BaseModel):
    level: int = Field(ge=0, le=3)
    label: str
    signals: list[str]


class ReactCallSummary(BaseModel):
    type: str
    headline: str
    bullets: list[str]
    emotion: ReactEmotionScore
    incidentRisk: str
    recommendedAgent: str


# ---------- 브리핑 카드 (최종 출력) ----------

class BriefingCard(BaseModel):
    call_id: str
    transcript: str
    summary: str
    department: str
    emotion: EmotionResult
    text_emotion: Optional[TextEmotionResult] = None
    judgement: JudgeResult
    references: list[RagDocument]
