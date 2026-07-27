import logging
import uuid
from dataclasses import dataclass

from fastapi import APIRouter, Form, HTTPException, UploadFile
from openai import OpenAI
from pydantic import BaseModel

from app.config import settings
from app.routing import taxonomy
from app.services.pii_guard import PII_SCOPE, mask_transcript
from app.schemas import (
    AnalysisSource,
    AnalyzeResult,
    AttentionReasonCode,
    BriefingCard,
    ConsultGuide,
    ContinuationRequest,
    ContinuationResponse,
    EmotionResult,
    JudgeRequest,
    JudgeResult,
    LegacyAnalyzeRequest,
    LegacyAnalyzeResponse,
    LegacyEmotion,
    LegacyRouting,
    RagDocument,
    RagRequest,
    RagResult,
    ReactCallSummary,
    ReactEmotionRequest,
    ReactEmotionScore,
    ReactSummarizeRequest,
    RoutingResult,
    TextEmotionResult,
    TranscribeResult,
    VoiceAngerResult,
)
from app.schemas import GptAnalysis
from app.services.emotion import analyze_emotion
from app.services.fusion import _AROUSAL_HIGH_THRESHOLD, fuse_judgement
from app.services.gpt_analysis import analyze_transcript
from app.services.judge import judge as run_judge
from app.services.legacy_adapter import emotion_label_and_score, routing_reason, urgency_score_for
from app.services.local_llm import analyze_transcript_local
from app.services.local_stt import transcribe_audio_local
from app.services.rag import search_procedures
from app.services.react_adapter import build_call_summary, emotion_label, emotion_level_and_signals
from app.services.routing_classifier import classify_routing_safe
from app.services.stt import transcribe_audio
from app.services.consult_guide import generate_consult_guide, stub_consult_guide
from app.services.dialogue_continuation import generate_continuation
from app.services.stub_models import analyze_transcript_stub, transcribe_audio_stub
from app.services.text_emotion import TextEmotionError, classify_text_emotion
from app.services.voice_anger import analyze_voice_anger

logger = logging.getLogger(__name__)

router = APIRouter()

_REASON_LABELS: dict[AttentionReasonCode, str] = {
    AttentionReasonCode.FINANCIAL_ACCIDENT: "금융사고 발생",
    AttentionReasonCode.CREDENTIAL_EXPOSED: "인증정보 노출",
    AttentionReasonCode.REMOTE_APP_INSTALLED: "원격제어 앱 설치",
    AttentionReasonCode.CONTROL_LOST: "통제권 상실",
    AttentionReasonCode.PROTECTION_NOT_DONE: "보호조치 미완료",
    AttentionReasonCode.MISSING_CRITICAL_INFO: "핵심 정보 누락",
    AttentionReasonCode.MULTIPLE_INTENTS: "복합 상담",
    AttentionReasonCode.REPEAT_CONTACT: "반복 연락",
    AttentionReasonCode.PRIOR_RESOLUTION_FAILED: "이전 해결 실패",
    AttentionReasonCode.HIGH_EMOTIONAL_DISTRESS: "고객 감정 주의",
    AttentionReasonCode.TEXT_HIGH_RISK_SIGNAL: "텍스트 상황 고위험 신호",
}


def _get_openai_client() -> OpenAI:
    if not settings.openai_api_key:
        raise HTTPException(status_code=500, detail="OPENAI_API_KEY가 서버에 설정되어 있지 않습니다.")
    return OpenAI(api_key=settings.openai_api_key)


# 유의사항 카드에 띄울 규정의 코사인 점수 하한. 아래 analyze_text_endpoint 주석 참조.
#
# 하한이 둘인 이유: 부서 필터가 걸린 검색은 이미 대분류가 맞는 문서만 후보라, 남은 위험은
# "그 부서 안에서 덜 맞는 문서" 정도라 느슨해도 된다. 반면 필터 없는 전체 검색(일반상담팀)은
# 도메인을 넘나든 잡음이 들어올 수 있어 빡세게 잡는다. 실측상 사고·신고(SG) 절차 문서는
# 맞더라도 0.53~0.63대에 머문다(짧은 산문) — 상품설명서(0.72~0.78, 긴 PDF)와 점수대가 달라
# 단일 하한을 쓰면 사고 규정만 통째로 잘려 나간다.
_RAG_MIN_SCORE_FILTERED = 0.50
_RAG_MIN_SCORE_UNFILTERED = 0.60

# "냉정한 분노" 보정 최솟값 — eGeMAPS+LightGBM 격양도가 _AROUSAL_HIGH_THRESHOLD(0.6) 미만인데
# WavLM이 분노를 감지하면, 격양도를 이 값까지 끌어올린다(더하기가 아니라 최솟값 보장 —
# fusion.py의 에스컬레이션 원칙과 동일). 0.5(중립/분노 라벨 분기점)는 살짝 넘기되 0.6(높음
# 기준선)에는 못 미치게 잡아, "WavLM 혼자 잡은 신호"를 "둘 다 높다고 본 상태"와 구분한다.
_COLD_ANGER_FLOOR = 0.55

# 라우팅 부서 → 규정 대분류(TAXONOMY) 하드 필터. 사고 계열 통화에 상품설명서(DEP/LON)가
# 섞이는 것을 막는다 — 실측: 보이스피싱 건 유의사항 3개 중 2위가 '주택청약종합저축'(0.620)
# 이었다. 점수 하한만으로는 못 거른다(하한을 그 위로 올리면 '지급정지 신청 절차' 0.601도
# 같이 날아간다).
#
# **부서명은 taxonomy.DEPARTMENTS 하나로 통일한다.** 예전엔 LLM 프롬프트가 "목록에 없으면
# OO팀 형식으로 새로 만들어라"고 시켜서, 모델이 지어낸 이름("일반상담팀" 등)이 이 표에
# 없으면 필터가 조용히 풀렸다 — 사고 건에 상품설명서가 섞이던 경로가 바로 그것이다.
# 이제 프롬프트가 7개 닫힌 집합만 답하므로 매핑은 taxonomy에서 파생된다(항등).
_DEPT_RAG_CATEGORIES: dict[str, list[str]] = {
    label: [code] for code, label in taxonomy.DEPARTMENTS.items()
}
# 사고·신고는 예외적으로 인접 대분류까지 함께 본다 — 보이스피싱·명의도용은 전자금융/카드
# 규정과 얽혀 있어 SG만 보면 정작 필요한 절차 문서를 놓친다.
_DEPT_RAG_CATEGORIES[taxonomy.EMERGENCY_DEPARTMENT_LABEL] = ["SG", "EFN", "CRD"]

# 구버전 모델·픽스처가 아직 옛 이름을 뱉을 수 있다. 조용히 필터가 풀리는 것보다
# 옛 이름을 taxonomy 라벨로 흡수하는 편이 안전하다(로그로 남긴다).
_LEGACY_DEPT_ALIASES: dict[str, str] = {
    "보이스피싱대응팀": "사고·신고",
    "계좌보안팀": "사고·신고",
    "카드분실신고팀": "카드·결제",
    "이체오류처리팀": "전자금융·디지털",
    "대출상담팀": "여신·대출",
    "일반상담팀": "수신·예적금",
    "사고대응팀": "사고·신고",
}


def normalize_department(name: str | None) -> str | None:
    """LLM이 돌려준 부서명을 taxonomy 라벨로 맞춘다.

    닫힌 집합에 있으면 그대로, 옛 이름이면 흡수, 둘 다 아니면 None을 돌려
    호출부가 '필터 없음'을 **의식적으로** 선택하게 한다(조용히 풀리지 않게).
    """
    if not name:
        return None
    if taxonomy.is_valid_department_label(name):
        return name
    alias = _LEGACY_DEPT_ALIASES.get(name.strip())
    if alias:
        logger.info("부서명 별칭 흡수: %s → %s", name, alias)
        return alias
    logger.warning("taxonomy에 없는 부서명 — 규정 필터를 걸지 않는다: %s", name)
    return None


def _rag_query(reason_codes: list[AttentionReasonCode], summary: str) -> str:
    labels = " ".join(_REASON_LABELS[code] for code in reason_codes)
    return f"{labels} {summary}".strip()


def _transcribe(filename: str, audio_bytes: bytes) -> TranscribeResult:
    """온프레미스 스위치. stub_models면 canned, 아니면 로컬(faster-whisper)/OpenAI Whisper."""
    if settings.stub_models:
        return transcribe_audio_stub(filename, audio_bytes)
    if settings.use_local_models:
        return transcribe_audio_local(settings, filename, audio_bytes)
    return transcribe_audio(_get_openai_client(), filename, audio_bytes)


def _analyze(transcript: str) -> GptAnalysis:
    """온프레미스 스위치. stub_models면 canned, 아니면 Ollama 로컬 LLM/OpenAI GPT."""
    if settings.stub_models:
        return analyze_transcript_stub(transcript)
    if settings.use_local_models:
        return analyze_transcript_local(settings, transcript)
    return analyze_transcript(_get_openai_client(), transcript)


def _classify_text_emotion_safe(transcript: str) -> TextEmotionResult | None:
    """텍스트 감정분류는 음향 신호를 보완하는 부가 채널이라, 실패해도(Ollama 미기동 등)
    전체 파이프라인을 막지 않고 그냥 이 신호 없이 진행한다."""
    try:
        return classify_text_emotion(settings, transcript)
    except TextEmotionError:
        logger.warning("text_emotion 분류 실패, 융합 없이 진행", exc_info=True)
        return None


@dataclass
class _CallAnalysis:
    """오디오 한 통을 끝까지 분석한 결과 묶음 — '병합된 judgement'까지 포함한다."""

    transcribed: TranscribeResult
    gpt_result: GptAnalysis
    emotion_result: EmotionResult
    text_emotion_result: TextEmotionResult | None
    routing_result: RoutingResult | None
    voice_anger_result: VoiceAngerResult | None
    judgement: JudgeResult


def _analyze_call(filename: str, audio_bytes: bytes) -> _CallAnalysis:
    """원본 오디오 → 전사·요약·격양도(eGeMAPS)·라우팅·음성분노(WavLM)를 돌리고 judge를
    fusion으로 승격까지 끝낸 '병합된 judgement'를 만든다.

    /briefing(브리핑 카드)과 /summarize-call(CS 요약 카드)이 이 하나를 공유한다 —
    두 출력 모양이 달라도 '주의등급을 만드는 과정'은 완전히 동일해야 하기 때문이다.
    voice_anger/text_emotion이 없으면 fusion은 무동작이라 기존 동작과 같다(하위호환).
    """
    transcribed = _transcribe(filename, audio_bytes)
    # 개인정보 보호(주제 11·12): 전사 직후 마스킹 → 이후 분석(LLM)·응답은 마스킹본만.
    # mvp.py의 /api/v1/calls와 동일한 규율. 원본 오디오는 이 요청 처리 중에만 쓰고 저장하지 않는다.
    transcribed.text, _pii = mask_transcript(transcribed.text)
    gpt_result = _analyze(transcribed.text)
    emotion_result = analyze_emotion(audio_bytes)
    text_emotion_result = _classify_text_emotion_safe(transcribed.text)
    routing_result = classify_routing_safe(transcribed.text, settings)
    # 음성 분노(WavLM) 부스터 입력 — 모델/의존성 없으면 None(부스터 무동작, 하위호환).
    voice_anger_result = analyze_voice_anger(audio_bytes)

    judgement = run_judge(gpt_result.risk_flags, emotion_result)
    if text_emotion_result is not None or voice_anger_result is not None:
        judgement = fuse_judgement(
            judgement,
            text_emotion_result,
            voice_anger=voice_anger_result,
            audio_emotion=emotion_result,
        )

    return _CallAnalysis(
        transcribed=transcribed,
        gpt_result=gpt_result,
        emotion_result=emotion_result,
        text_emotion_result=text_emotion_result,
        routing_result=routing_result,
        voice_anger_result=voice_anger_result,
        judgement=judgement,
    )


@router.post("/stt", response_model=TranscribeResult)
async def stt_endpoint(audio: UploadFile) -> TranscribeResult:
    audio_bytes = await audio.read()
    return _transcribe(audio.filename or "audio.wav", audio_bytes)


@router.post("/analyze", response_model=AnalyzeResult)
async def analyze_endpoint(audio: UploadFile, transcript: str = Form(...)) -> AnalyzeResult:
    audio_bytes = await audio.read()

    gpt_result = _analyze(transcript)
    emotion_result = analyze_emotion(audio_bytes)
    text_emotion_result = _classify_text_emotion_safe(transcript)
    routing_result = classify_routing_safe(transcript, settings)

    return AnalyzeResult(
        gpt=gpt_result,
        emotion=emotion_result,
        text_emotion=text_emotion_result,
        routing=routing_result,
    )


@router.post("/judge", response_model=JudgeResult)
async def judge_endpoint(body: JudgeRequest) -> JudgeResult:
    return run_judge(body.gpt.risk_flags, body.emotion)


@router.post("/rag", response_model=RagResult)
async def rag_endpoint(body: RagRequest) -> RagResult:
    query = _rag_query(body.reason_codes, body.summary)
    documents = search_procedures(settings, query)
    return RagResult(documents=documents)


@router.post("/analyze-text", response_model=LegacyAnalyzeResponse)
async def analyze_text_endpoint(body: LegacyAnalyzeRequest) -> LegacyAnalyzeResponse:
    """demo_live.html용 어댑터 — 브라우저 STT로 이미 뽑힌 텍스트를 받아
    api_contract.md 스키마(summary/category/emotion/urgency_score/routing/keywords)로 응답한다."""
    gpt_result = _analyze(body.text)

    # 감정온도 — eGeMAPS+LightGBM을 베이스로 두고 WavLM은 "냉정한 분노"만 보정한다(fusion.py의
    # _voice_anger_target_level과 같은 원칙 — 격양도를 덮어쓰지 않고 필요할 때만 밀어올림).
    #   1) eGeMAPS+LightGBM 베이스: recording 구간 누적 오디오로 실제 모델이 돌면 이걸 쓴다.
    #      - 이미 격양도가 높으면(>=_AROUSAL_HIGH_THRESHOLD) 그대로 둔다 — WavLM이 뭘 보든
    #        이미 반영된 상태라 추가 보정이 필요 없다.
    #      - 격양도는 낮은데 WavLM이 분노를 감지했으면("냉정한 분노") _COLD_ANGER_FLOOR까지
    #        끌어올린다 — 목소리 톤은 차분해도 실제로는 격앙된 케이스를 놓치지 않기 위함.
    #   2) 위가 없으면(오디오 자체가 없거나 모델 실패) WavLM 신호 단독으로 대체한다.
    #   3) 그마저 없으면(call_id 자체가 없는 순수 프론트 데모 등) 스텁.
    # 텍스트를 가짜 WAV로 감싸 analyze_emotion에 넣던 예전 방식은 음향 모델이 텍스트를 못 읽어
    # 항상 스텁으로 떨어졌다(박정운 피드백 "감정모델 연동 안됨"의 원인).
    live_session = None
    if body.call_id:
        from app.ws.call import registry as _call_registry

        live_session = _call_registry._sessions.get(body.call_id)

    emotion_result: EmotionResult | None = None
    emotion_reason = "실시간 음성 신호 없음(텍스트만 전달됨)"

    if live_session is not None:
        from app.ws.call import _consume_recording_audio

        recorded_wav = _consume_recording_audio(live_session)
        if recorded_wav is not None:
            baseline = analyze_emotion(recorded_wav)
            if baseline.analysis_source == AnalysisSource.REAL_MODEL:
                cold_anger = (
                    baseline.anger_probability < _AROUSAL_HIGH_THRESHOLD
                    and live_session.anger_hits > 0
                )
                if cold_anger:
                    nudged = max(baseline.anger_probability, _COLD_ANGER_FLOOR)
                    emotion_result = EmotionResult(
                        anger_probability=nudged,
                        anxiety_probability=nudged,
                        neutral_probability=max(0.0, 1.0 - nudged),
                        uncertainty=baseline.uncertainty,
                        analysis_source=AnalysisSource.REAL_MODEL,
                        model_version=baseline.model_version,
                    )
                    emotion_reason = "eGeMAPS+LightGBM 분석 · WavLM 냉정한 분노 보정 적용"
                else:
                    emotion_result = baseline
                    emotion_reason = "실시간 녹음 오디오(eGeMAPS+LightGBM) 분석"

    if emotion_result is None and live_session is not None and live_session.voice_model_calls > 0:
        # 실시간 게이지는 max_anger(통화 내내 안 내려가는 역대 최고치)가 아니라
        # recent_anger(최근 발화 위주 지수이동평균)를 쓴다 — 안 그러면 초반 스파이크
        # 한 번으로 고객이 진정돼도 온도가 41도에 계속 고정된다(박정운 피드백).
        # max_anger는 통화 종료 후 판단(judge)에서는 그대로 쓴다 — "한 번이라도
        # 격했는가"는 위험판단엔 여전히 유효한 신호라 거기선 안 바꾼다.
        anger_p = min(1.0, max(0.0, live_session.recent_anger))
        emotion_result = EmotionResult(
            anger_probability=anger_p, anxiety_probability=anger_p,
            neutral_probability=max(0.0, 1.0 - anger_p), uncertainty=0.0,
            analysis_source=AnalysisSource.REAL_MODEL,
        )
        emotion_reason = f"실시간 음성분노(WavLM) 신호 · 발화 {live_session.voice_model_calls}건 분석"

    if emotion_result is None:
        emotion_result = analyze_emotion(body.text.encode("utf-8"))

    emotion_is_live = emotion_result.analysis_source == AnalysisSource.REAL_MODEL
    judgement = run_judge(gpt_result.risk_flags, emotion_result)

    # S/G/E 업무분리(전형진 classify_routing_safe) — department(GPT 자유형 추측)와 다른
    # 축이라 병행 신호로 붙인다. 보조 신호라 실패해도 None만 되고 분석 자체는 안 막힌다.
    routing_result = classify_routing_safe(body.text, settings)

    reason_labels = [_REASON_LABELS[code] for code in judgement.reason_codes]
    emotion_label, emotion_score = emotion_label_and_score(emotion_result)

    # 관련 규정(김동희 RAG) — 상담 유의사항/응대 가이드로 프론트에 넘긴다. 실패해도 분석은 유지.
    #
    # 질의는 **전사 원문이 아니라 요약+키워드**로 만든다(2026-07-23). 원문에는 "연락처는
    # 010-…", "어떻게 해야 하나요?" 같은 잡음이 섞여 있어, PDF 상품설명서 말미의 콜센터
    # 전화번호·민원접수 안내 표가 의미적으로 끌려온다. 실측: ATM 도난 건에서 원문 질의는
    # 가계대출·보금자리론·청약저축(0.585/0.580/0.569)을, 요약+키워드 질의는 명의도용·해킹
    # 신고 대응·이상금융거래 신고 처리(0.575/0.569)를 반환했다. 대출 문의에서도 요약+키워드
    # 쪽이 절차 문서("대출 만기 연장·중도상환·약정변경 상담", 0.761)를 1위로 올린다.
    # 부수효과로 개인정보가 RAG 질의에 실리지 않는다(주제 12).
    rag_query = " ".join(filter(None, [gpt_result.summary, " ".join(gpt_result.keywords)])).strip()
    dept = normalize_department(gpt_result.department)
    rag_categories = _DEPT_RAG_CATEGORIES.get(dept) if dept else None
    try:
        references = search_procedures(
            settings, rag_query or body.text, top_k=3, categories=rag_categories
        )
        # 점수 하한. 벡터검색은 항상 top_k개를 채워주므로, 맞는 규정이 없어도 "그나마 가까운"
        # 무관한 문서가 유의사항 카드에 뜬다. 하한 미달이면 비우고, 프론트는 일반 유의사항으로
        # 채운다 — 엉뚱한 규정을 근거로 안내하는 것보다 일반 원칙을 보여주는 편이 안전하다.
        floor = _RAG_MIN_SCORE_FILTERED if rag_categories else _RAG_MIN_SCORE_UNFILTERED
        references = [d for d in references if d.score >= floor]
    except Exception:
        logger.warning("규정 RAG 검색 실패 — references 없이 진행", exc_info=True)
        references = []

    # 단계별 상담 스크립트(EXAONE consult_guide)는 여기서 만들지 않는다 — 요약 카드
    # 응답 하나에 묶으면 EXAONE 2번째 호출(~5~8초)까지 끝나야 카드가 뜬다. 박정운
    # 피드백(카드 생성 대기시간 단축)으로 분리 — 프론트가 카드를 먼저 그리고, 카드
    # 표시를 막지 않는 별도 호출(POST /consult-guide)로 스크립트를 나중에 채운다.
    return LegacyAnalyzeResponse(
        call_id=str(uuid.uuid4()),
        summary=gpt_result.summary,
        category=gpt_result.department,
        emotion=LegacyEmotion(
            label=emotion_label,
            score=round(emotion_score * 100, 1),
            status="completed" if emotion_is_live else "unavailable",
            reason=emotion_reason,
        ),
        urgency_score=urgency_score_for(judgement.attention_level),
        routing=LegacyRouting(
            department=gpt_result.department,
            reason=routing_reason(reason_labels, gpt_result.department),
            task_code=routing_result.task_code if routing_result else None,
            task_name=routing_result.task_name if routing_result else None,
            classification=routing_result.classification if routing_result else None,
            handler=routing_result.handler if routing_result else None,
            auth_policy=routing_result.auth_policy if routing_result else None,
            auth_required=routing_result.auth_required if routing_result else False,
        ),
        keywords=gpt_result.keywords,
        references=references,
        script_steps=[],
        follow_ups=[],
        result_label="",
        # script_steps/follow_ups처럼 /consult-guide에서 나중에 채워지는 값이 아니라 여기서
        # 바로 채운다 — 이미 계산된 keywords를 재사용하므로 추가 지연이 없다.
        action_items=gpt_result.keywords,
    )


class ConsultGuideRequest(BaseModel):
    summary: str
    department: str
    keywords: list[str] = []
    references: list[RagDocument] = []


@router.post("/consult-guide", response_model=ConsultGuide)
async def consult_guide_endpoint(body: ConsultGuideRequest) -> ConsultGuide:
    """단계별 상담 스크립트 전용 생성 — /analyze-text가 요약 카드를 먼저 반환한 뒤,
    프론트가 카드 렌더를 막지 않는 별도 호출로 이걸 불러 나중에 채운다(박정운 피드백:
    카드 생성 대기시간 단축). 실패해도 프론트는 기존 콜 유형 픽스처(SCRIPTS)로 유지."""
    if settings.stub_models:
        return stub_consult_guide(body.summary, body.department)
    try:
        return generate_consult_guide(
            settings, body.summary, body.department, body.keywords, body.references
        )
    except Exception as exc:
        logger.warning("상담 가이드 생성 실패", exc_info=True)
        raise HTTPException(status_code=502, detail="상담 가이드 생성 실패") from exc


@router.post("/simulate-continuation", response_model=ContinuationResponse)
async def simulate_continuation_endpoint(body: ContinuationRequest) -> ContinuationResponse:
    """상담사 연결 후 대화 시뮬레이션 — 현장 요청으로 # 접수완료 이후 실마이크를 안 잡는
    대신, 접수 발화를 이어서 있을 법한 고객↔상담원 대화를 만들어 프론트가 전사 패널에
    스트리밍한다. 실패하면 빈 turns를 돌려 프론트가 조용히 건너뛴다(화면이 안 깨지게)."""
    try:
        return generate_continuation(
            settings, body.opening_text, body.summary, body.keywords, body.department
        )
    except Exception as exc:
        logger.warning("대화 시뮬레이션 생성 실패", exc_info=True)
        return ContinuationResponse(turns=[])


@router.post("/emotion", response_model=ReactEmotionScore)
async def react_emotion_endpoint(body: ReactEmotionRequest) -> ReactEmotionScore:
    """kda4-k7-product 연동 — 텍스트 하나로 감정온도(EmotionScore)를 반환한다."""
    emotion_result = analyze_emotion(body.text.encode("utf-8"))
    level, signals = emotion_level_and_signals(emotion_result)
    return ReactEmotionScore(level=level, label=emotion_label(level), signals=signals)


@router.post("/summarize", response_model=ReactCallSummary)
async def react_summarize_endpoint(body: ReactSummarizeRequest) -> ReactCallSummary:
    """kda4-k7-product 연동 — 전사문 하나로 AI 사전요약(CallSummary)을 반환한다."""
    transcript_text = body.transcript.text

    gpt_result = _analyze(transcript_text)
    emotion_result = analyze_emotion(transcript_text.encode("utf-8"))
    judgement = run_judge(gpt_result.risk_flags, emotion_result)

    return build_call_summary(
        department=gpt_result.department,
        summary=gpt_result.summary,
        emotion=emotion_result,
        attention_level=judgement.attention_level,
        recommended_agent_level=judgement.recommended_agent_level,
    )


@router.post("/summarize-call", response_model=ReactCallSummary)
async def react_summarize_call_endpoint(audio: UploadFile) -> ReactCallSummary:
    """kda4-k7-product 연동 — 원본 오디오로 AI 사전요약 카드(CallSummary)를 반환한다.

    텍스트 전용 /summarize와 달리 실제 음성을 받아 격양도(eGeMAPS)·음성분노(WavLM)를 함께
    돌리고, fusion으로 '병합된 주의등급'을 카드에 싣는다 — 격양도가 낮아 감정온도는 '안정'
    이어도, WavLM이 분노를 잡으면 incidentRisk가 상향돼 상담사 화면에 '주의 상향'이 뜬다
    ('냉정한 분노'). 감정온도(emotion)는 격양도 원본 그대로 두고 덮어쓰지 않는다.
    """
    audio_bytes = await audio.read()
    analysis = _analyze_call(audio.filename or "audio.wav", audio_bytes)

    return build_call_summary(
        department=analysis.gpt_result.department,
        summary=analysis.gpt_result.summary,
        emotion=analysis.emotion_result,
        attention_level=analysis.judgement.attention_level,
        recommended_agent_level=analysis.judgement.recommended_agent_level,
    )


@router.post("/briefing", response_model=BriefingCard)
async def briefing_endpoint(audio: UploadFile) -> BriefingCard:
    audio_bytes = await audio.read()
    analysis = _analyze_call(audio.filename or "audio.wav", audio_bytes)

    # 김민기 RAG 설계: 긴급(EMERGENCY=사고·신고) 통화면 SG 대분류 규정만 좁혀 추천.
    # 그 외에는 전체 검색(기존 동작 유지). 에스컬레이션 안전 — 확실한 신호일 때만 필터.
    rag_categories = (
        ["SG"]
        if analysis.routing_result is not None
        and analysis.routing_result.classification == "EMERGENCY"
        else None
    )
    references = search_procedures(
        settings,
        _rag_query(analysis.judgement.reason_codes, analysis.gpt_result.summary),
        categories=rag_categories,
    )

    return BriefingCard(
        call_id=analysis.transcribed.call_id,
        transcript=analysis.transcribed.text,
        summary=analysis.gpt_result.summary,
        department=analysis.gpt_result.department,
        emotion=analysis.emotion_result,
        text_emotion=analysis.text_emotion_result,
        routing=analysis.routing_result,
        judgement=analysis.judgement,
        references=references,
    )


# ── 개인정보 보호 데모 도구 (발표 C. 개인정보·보안) ──────────────────
class PiiScanRequest(BaseModel):
    text: str


@router.post("/pii/scan")
async def pii_scan_endpoint(body: PiiScanRequest) -> dict:
    """정규식 기반 개인정보 탐지·마스킹 시연(주제 12).

    임의 문장을 넣으면 무엇을 개인정보로 보고(주제 10) 어떻게 마스킹했는지 돌려준다.
    발표에서 "정규식/NER 탐지, 애매하면 마스킹" 원칙을 라이브로 보여주는 용도.
    """
    masked, hits = mask_transcript(body.text)
    return {
        "scope": list(PII_SCOPE.values()),  # 주제 10: 무엇을 개인정보로 보는가
        "masked": masked,                     # 주제 12: 마스킹 결과 (저장·AI 입력은 이것만)
        "count": len(hits),
        "hits": [
            {"type": h.type, "label": h.label, "original": h.original, "masked": h.masked}
            for h in hits
        ],
    }
