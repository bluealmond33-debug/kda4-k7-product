"""텍스트 기반 감정분류 — Ollama(EXAONE)로 STT 전사문에서 감정·상황심각도를 뽑는다.

박정운 음향 모델(app/services/emotion.py)과 서로 다른 걸 잰다: 이쪽은 "무슨 일이고 얼마나
위험한가"(내용)를, 음향 모델은 "목소리가 얼마나 격앙됐나"(톤)를 본다. 그래서 voice_tone은
텍스트로 절대 추측하지 않고 항상 고정값으로 둔다 — 이전 버전(v1)이 "arousal_level"을
텍스트에 물어봤다가 두 가지로 틀렸다: 단순 사실 문의를 감정으로 과대해석했고, 차분한
목소리로 위험한 내용을 말하는 경우를 "격앙됐다"고 착각했다(실측 기반 발견, 2026-07-20).
"""

import json

import httpx

from app.config import Settings
from app.schemas import TextEmotionResult

_SYSTEM_PROMPT = """너는 금융 콜센터 상담 전사문(텍스트)만 보고 분석하는 AI다.
너는 목소리를 들을 수 없다 — 오직 글자만 본다. 이 한계를 반드시 지켜라.

아래 JSON만 출력(설명 금지):
{
  "content_emotion": "분노|불안|당황|불만|중립|만족 중 하나 (단어·문맥에서 드러난 것만, 안 드러나면 중립)",
  "situation_severity": "low|medium|high (상황 자체가 얼마나 위험한 사안인지 - 사실관계로만 판단)",
  "urgency_score": 0~100 (업무 처리가 얼마나 급한지 - 상황 심각도 기준),
  "voice_tone": "unknown_text_only",
  "evidence": "판단 근거가 된 표현 1~2개, 없으면 근거 없음이라고 표시"
}

규칙:
1. 감정 단어("화나요","불안해요" 등)가 없으면 content_emotion은 문맥·화행(반복 항의, 요구 강도)으로만 판단하고, 없으면 "중립"으로 둔다.
2. situation_severity는 고객이 흥분했는지와 무관하게, 사안 자체(금전피해·사기·개인정보 노출 등)로만 판단한다.
3. 절대로 목소리 톤·격앙 정도를 추측해서 쓰지 않는다. voice_tone은 항상 "unknown_text_only"로 고정한다.
4. 단순 정보 문의(영업시간, 이용방법 등)는 situation_severity=low, urgency_score를 20 이하로 유지한다.
5. 이미 발생한 무단거래·사기·명의도용처럼 "확정된 금전 피해"가 언급되면, 고객 어조와 무관하게
   situation_severity=high, urgency_score 80 이상으로 판단한다. 아직 피해가 확정 안 된 단순 지연·문의
   (배송지연, 처리시간 등)는 severity를 medium 이하로 유지한다.

예시:
입력: "3일 전 신청한 카드가 아직 안 왔는데요, 언제 오나요"
출력: {"content_emotion":"중립","situation_severity":"low","urgency_score":25,"voice_tone":"unknown_text_only","evidence":"단순 배송 지연 문의, 확정 피해 없음"}

입력: "제 통장에서 모르는 출금이 세 건 있었어요"
출력: {"content_emotion":"불안","situation_severity":"high","urgency_score":90,"voice_tone":"unknown_text_only","evidence":"확정된 무단출금 발생 - 어조와 무관하게 고위험"}
"""


class TextEmotionError(RuntimeError):
    pass


def classify_text_emotion(settings: Settings, transcript: str) -> TextEmotionResult:
    try:
        response = httpx.post(
            f"{settings.ollama_base_url}/api/chat",
            json={
                "model": settings.ollama_model,
                "messages": [
                    {"role": "system", "content": _SYSTEM_PROMPT},
                    {"role": "user", "content": transcript},
                ],
                "format": "json",
                "stream": False,
                "options": {"temperature": 0},
            },
            timeout=120,
        )
        response.raise_for_status()
    except httpx.HTTPError as exc:
        raise TextEmotionError(f"Ollama 호출 실패 (모델 '{settings.ollama_model}' 로딩됐는지 확인): {exc}") from exc

    content = response.json().get("message", {}).get("content", "")
    try:
        payload = json.loads(content)
        return TextEmotionResult(
            content_emotion=payload["content_emotion"],
            situation_severity=payload["situation_severity"],
            urgency_score=payload["urgency_score"],
            voice_tone=payload.get("voice_tone", "unknown_text_only"),
            evidence=payload.get("evidence", ""),
        )
    except (json.JSONDecodeError, KeyError, TypeError) as exc:
        raise TextEmotionError(f"텍스트 감정분류 응답 파싱 실패: {exc}\n원본: {content[:500]}") from exc
