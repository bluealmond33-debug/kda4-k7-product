from enum import Enum
from typing import Optional

from pydantic import BaseModel, ConfigDict, Field


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

class AnalysisSource(str, Enum):
    """이 결과가 실제로 어디서 나왔는지 — 박정운님 2026-07-20 리뷰(P0-3) 반영.

    발표 데모 중 모델 파일이 없으면 조용히 스텁으로 대체되는데, 겉보기엔 실제 모델 결과와
    구분이 안 됐다. 이 필드로 "진짜 모델이 돈 건지"를 항상 노출한다.
    """

    REAL_MODEL = "REAL_MODEL"
    RULE_FALLBACK = "RULE_FALLBACK"
    STUB = "STUB"
    UNAVAILABLE = "UNAVAILABLE"


class EmotionResult(BaseModel):
    model_config = ConfigDict(protected_namespaces=())  # model_version 필드명이 pydantic 예약 접두사와 겹침

    anger_probability: float = Field(ge=0, le=1)
    anxiety_probability: float = Field(ge=0, le=1)
    neutral_probability: float = Field(ge=0, le=1)
    uncertainty: float = Field(ge=0, le=1)
    analysis_source: AnalysisSource = AnalysisSource.STUB
    model_version: str | None = None
    fallback_reason: str | None = None


# ---------- 음성 분노 탐지 (WavLM, 격양도와 별개 축) ----------

class VoiceAngerResult(BaseModel):
    """WavLM 음성 분노 탐지 — eGeMAPS 격양도(EmotionResult)와 '별개 축'이다.

    격양도가 '얼마나 격했나(arousal)'를 본다면 이 신호는 '분노인가(specific)'를 본다.
    fusion에서 격양도 값을 절대 덮어쓰지 않고, 주의등급만 올리는 에스컬레이션 부스터
    입력으로만 쓴다. probability는 아직 calibration되지 않은 모델 점수라 '분노일 확률'로
    해석하지 않는다(threshold와 함께 쓰는 점수). 감정 신호는 S/G/E 업무 라우팅·상담사
    자동배정을 직접 결정하지 않는다(보조 신호 전용)."""

    model_config = ConfigDict(protected_namespaces=())  # model_version 예약 접두사 회피

    detected: bool
    probability: float = Field(ge=0, le=1)
    confidence: float | None = Field(default=None, ge=0, le=1)  # 런타임이 아직 안 냄 → None 허용
    threshold: float = 0.43
    probability_calibrated: bool = False
    analysis_source: AnalysisSource = AnalysisSource.STUB
    model_version: str | None = None


# ---------- 텍스트 감정분류 (EXAONE, 음향 모델과 별도 채널) ----------

class TextEmotionResult(BaseModel):
    """전사문(글자)만으로 판단 가능한 것만 담는다 — 목소리 톤은 원리상 알 수 없으므로
    voice_tone은 항상 고정값이다. 박정운 음향 모델(EmotionResult)과 합쳐 쓰는 걸 전제로 한다."""

    content_emotion: str
    situation_severity: str
    urgency_score: int = Field(ge=0, le=100)
    voice_tone: str = "unknown_text_only"
    evidence: str


# ---------- 상담 라우팅 분류 (전형진, 규칙+로컬 ML) ----------

class RoutingResult(BaseModel):
    """전형진님 classify_transcript() 결과를 우리 스키마로 감싼 것 — 어느 업무/부서로 보낼지.

    department(GPT 자유형 추측)와 다른 축이라 대체가 아니라 병행 신호로 붙인다.
    ML 모델 파일이 없어도 규칙 기반 EMERGENCY/SIMPLE 판정은 그대로 나온다."""

    task_code: str            # S001~S117 / G001~G010 / E001~E002
    task_name: str
    classification: str       # SIMPLE / GENERAL / EMERGENCY
    handler: str              # AI_CC / HUMAN
    reason: str
    matched_keywords: list[str] = Field(default_factory=list)
    bank_topic: Optional[str] = None  # 로컬 ML 모델이 붙였을 때만
    # 본인인증 정책(형진님 KARI-NA 본인확인 적용 정책, IDENTITY_AUTH_POLICY.md) —
    # NOT_REQUIRED(접수 단계 불필요) / REQUIRED(상담사 연결 직전 실행) /
    # EXEMPT(E001·E002 — 본인확인보다 긴급 연결 우선, 실행 자체를 건너뜀). S/G/E와
    # 다른 축이라 병행 신호. task_code 명시 목록 기준(routing_classifier.py 참고).
    auth_policy: str = "NOT_REQUIRED"
    # 구 프론트 호환 필드 — auth_policy == REQUIRED일 때만 True. EXEMPT는 즉시 키패드로
    # 해석되면 안 되므로 여기 포함하지 않는다.
    auth_required: bool = False


class AnalyzeResult(BaseModel):
    gpt: GptAnalysis
    emotion: EmotionResult
    text_emotion: Optional[TextEmotionResult] = None
    routing: Optional[RoutingResult] = None


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
    # WavLM 음성 분노 부스터 — 격양도(arousal)와의 조합으로 4셀을 구분한다.
    VOICE_ANGER_WITH_AROUSAL = "VOICE_ANGER_WITH_AROUSAL"  # 격양 high + 분노 yes: 분노 격앙
    VOICE_ANGER_CALM = "VOICE_ANGER_CALM"  # 격양 low + 분노 yes: 냉정한 분노(격양도만으론 놓침)


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


# ---------- 상담 가이드 (EXAONE 생성 — 단계별 스크립트·후속 조치) ----------

class ConsultScriptStep(BaseModel):
    """단계별 상담 스크립트 한 단계. 상담사가 그대로 읽을 수 있는 문장."""

    title: str
    text: str


class ConsultGuide(BaseModel):
    """통화 내용 기반 상담 가이드 — EXAONE이 요약·키워드·RAG 근거로 생성.

    프론트의 '단계별 상담 스크립트'(script_steps), 후처리 시트의 '후속 조치' 칩
    (follow_ups), '상담 결과' 기본값(result_label)을 채운다. 생성 실패 시 프론트는
    기존 데모 픽스처로 폴백하므로 세 필드 모두 비어 있을 수 있다.
    """

    script_steps: list[ConsultScriptStep] = []
    follow_ups: list[str] = []
    result_label: str = ""


# ---------- RAG ----------

class RagDocument(BaseModel):
    doc_id: str
    title: str
    excerpt: str
    score: float
    # 김민기 RAG 설계 v0.1의 8대분류(taxonomy) 태그. 검색 필터·근거 표시용.
    # 청크가 어느 대분류/중분류 규정인지. 없을 수도 있어 옵셔널.
    category: Optional[str] = None
    subcategory: Optional[str] = None


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
    # 있으면 백엔드가 이 통화의 실시간 WavLM 음성분노 신호를 감정으로 쓴다(텍스트만
    # 있을 때의 가짜 감정 대신 진짜 음성 기반 신호 — 박정운 피드백).
    call_id: str | None = None


class LegacyEmotion(BaseModel):
    label: str
    score: float
    # 프론트(useCallFlow.ts)가 emotion.status==="completed"일 때만 게이지를 표시한다.
    # 이 필드가 없으면 항상 "미연결"로 보인다 — 박정운 피드백("감정모델 연동이 안됨")의 원인.
    status: str = "unavailable"
    reason: str = ""


class LegacyRouting(BaseModel):
    department: str
    reason: str
    # S/G/E(전형진 classify_routing_safe) — department(GPT 자유형 추측)와 다른 축이라
    # 병행 신호로 붙인다. 분류 실패/미판정이면 전부 None(프론트는 데모 픽스처로 폴백).
    task_code: str | None = None
    task_name: str | None = None
    classification: str | None = None  # EMERGENCY / SIMPLE / GENERAL
    handler: str | None = None  # AI_CC / HUMAN
    # 본인인증 정책 — NOT_REQUIRED/REQUIRED/EXEMPT. 분류 실패 시 None(프론트는 인증 요구 안 함).
    auth_policy: str | None = None
    auth_required: bool = False


class LegacyAnalyzeResponse(BaseModel):
    call_id: str
    summary: str
    category: str
    emotion: LegacyEmotion
    urgency_score: int
    routing: LegacyRouting
    keywords: list[str]
    references: list[RagDocument] = []  # 관련 규정(RAG) — 상담 유의사항/응대 가이드용
    # 상담 가이드(EXAONE 생성) — 단계별 스크립트·후속 조치·상담 결과. 실패 시 빈 값(프론트 폴백).
    script_steps: list[ConsultScriptStep] = []
    follow_ups: list[str] = []
    result_label: str = ""
    # 준비 카드 "STT 요약 불릿" — 프론트 vm.summaryPoints가 이 필드를 읽는데 원래 이 스키마에
    # 없어서 라이브 콜에서 그 자리가 항상 비어 보였다. 상담 가이드의 follow_ups를 재사용한다
    # (이미 계산돼 있어 추가 LLM 호출 없이 채울 수 있다).
    action_items: list[str] = []


# ---------- 상담사 연결 후 대화 시뮬레이션(실마이크 대신) ----------
# 현장 요청: # 접수완료 후로는 실마이크를 더 안 잡는다. 그 대신 고객이 접수 때 실제로
# 한 말을 이어서, 있을 법한 상담사↔고객 대화를 만들어 전사 패널에 스트리밍하고, 그걸로
# 후처리(요약)까지 만든다.

class DialogueTurn(BaseModel):
    speaker: str  # "agent" | "customer"
    text: str


class ContinuationRequest(BaseModel):
    opening_text: str  # 고객이 접수 때 실제로 한 발화(전체 또는 요약)
    summary: str = ""
    keywords: list[str] = []
    department: str = ""
    # 20분 실시간 재생을 여러 배치로 이어 생성할 때, 직전까지 오간 대화(최근 일부) —
    # 없으면 반복·모순 없이 자연스럽게 이어 쓸 근거가 없어 매 배치가 처음부터 다시 인사한다.
    prior_turns: list[DialogueTurn] = []
    # True면 이 배치를 상담원의 마무리 인사로 끝맺는다(남은 시간이 얼마 안 남았을 때만 서버가 지정).
    conclude: bool = False


class ContinuationResponse(BaseModel):
    turns: list[DialogueTurn]


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
    routing: Optional[RoutingResult] = None
    judgement: JudgeResult
    references: list[RagDocument]
