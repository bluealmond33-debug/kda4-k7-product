"""classify_task_with_llm 후보 카탈로그 범위 테스트 (2026-07-28).

이 함수는 routing_classifier.classify_routing()이 규칙 기반으로 G004(기타)에 떨어졌을
때만 불려서 G0xx(+E00x) 안에서 재분류하는 게 목적이다. 예전엔 S/G/E 전체(TASK_NAMES)를
후보로 줘서, 우리카드 ARS 전용 카탈로그(S101~127)가 은행 계좌 문의에 잘못 붙는 사고가
있었다(Windows 시연 보고: "다른 계좌에서 빠져나가도록 변경" → S126 자동납부로 오분류).
SIMPLE(S) 코드는 후보에서 뺐지만 EMERGENCY(E00x)는 남겼다 — 규칙 기반 긴급 판정이
"보내라고 해요"처럼 자연어 표현을 놓쳐 G004로 떨어뜨린 사건성 발화를 다시 건져올릴 수
있는 유일한 경로라서다. 여기서는 실제 Ollama 호출 없이 응답만 흉내 내 후보 범위·검증
로직을 확인한다.
"""

from app.config import Settings
from app.services import local_llm
from app.services.routing.classifier import GENERAL_TASK_NAMES


class _FakeResponse:
    def __init__(self, content: str):
        self._content = content

    def raise_for_status(self) -> None:
        return None

    def json(self) -> dict:
        return {"message": {"content": self._content}}


def _settings() -> Settings:
    return Settings(ollama_base_url="http://fake-ollama", ollama_model="fake-model")


def test_candidate_catalog_excludes_card_ars_but_keeps_emergency(monkeypatch) -> None:
    """LLM 후보 목록에 카드 ARS 전용 코드(S1xx)는 없어야 하고, G0xx·E00x는 다 있어야 한다."""
    captured = {}

    def _fake_post(_url, json, **_kwargs):
        captured["system_prompt"] = json["messages"][0]["content"]
        return _FakeResponse("NONE")

    monkeypatch.setattr(local_llm.httpx, "post", _fake_post)
    local_llm.classify_task_with_llm(_settings(), "아무 발화")

    prompt = captured["system_prompt"]
    for code in GENERAL_TASK_NAMES:
        assert f"{code}:" in prompt
    # 우리카드 ARS 전용 카탈로그(S101~127)와 은행 SIMPLE(S001~006)은 후보에 없어야 한다.
    assert "S126" not in prompt
    assert "S001" not in prompt
    # EMERGENCY는 남아 있어야 한다 — 아래 없어져 있는지 assert
    assert "E001:" in prompt
    assert "E002:" in prompt


def test_llm_returning_card_only_code_is_rejected(monkeypatch) -> None:
    """모델이 지시를 무시하고 카드 전용 코드를 답해도(예외 상황) 후보 밖이라 거부돼야 한다."""
    monkeypatch.setattr(local_llm.httpx, "post", lambda *_a, **_k: _FakeResponse("S126"))
    result = local_llm.classify_task_with_llm(_settings(), "다른 계좌에서 빠져나가도록 변경하고 싶거든요")
    assert result is None


def test_llm_returning_valid_general_code_is_accepted(monkeypatch) -> None:
    monkeypatch.setattr(local_llm.httpx, "post", lambda *_a, **_k: _FakeResponse("G006"))
    result = local_llm.classify_task_with_llm(_settings(), "다른 계좌에서 빠져나가도록 변경하고 싶거든요")
    assert result == "G006"


def test_llm_none_response_returns_none(monkeypatch) -> None:
    monkeypatch.setattr(local_llm.httpx, "post", lambda *_a, **_k: _FakeResponse("NONE"))
    result = local_llm.classify_task_with_llm(_settings(), "그냥 문의드려요")
    assert result is None


# ── 규칙 기반 긴급판정이 놓친 사건성 발화 (2026-07-28 추가 검토) ────────────────
# "검찰이라는 사람이... 5000만원 보내라고 해요"는 SENSITIVE_DEMANDS가 정확한 단어
# ("송금"/"이체")만 찾아서 규칙 기반으로는 G004에 떨어진다(실측 확인). 이 LLM 보완이
# E001/E002를 답할 수 있어야 이런 사건성 발화를 그나마 되살릴 수 있다.

def test_llm_can_still_rescue_emergency_missed_by_rules(monkeypatch) -> None:
    monkeypatch.setattr(local_llm.httpx, "post", lambda *_a, **_k: _FakeResponse("E001"))
    result = local_llm.classify_task_with_llm(
        _settings(), "검찰이라는 사람이 전화와서 안전계좌로 5000만원 보내라고 해요"
    )
    assert result == "E001"
