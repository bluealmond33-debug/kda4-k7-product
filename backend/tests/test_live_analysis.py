import json

from app import live_stt
from app.live_stt import (
    LiveAnalysisRequest,
    LiveAnalysisTurn,
    analyze_live_stt,
    analyze_live_text,
)


class _FakeOllamaResponse:
    def __init__(self, content: str) -> None:
        self.content = content

    def raise_for_status(self) -> None:
        return None

    def json(self) -> dict:
        return {"message": {"content": self.content}}


class _FakeOllamaClient:
    def __init__(self, content: str) -> None:
        self.content = content
        self.payload: dict | None = None

    def __enter__(self):
        return self

    def __exit__(self, *_args) -> None:
        return None

    def post(self, _path: str, json: dict) -> _FakeOllamaResponse:
        self.payload = json
        return _FakeOllamaResponse(self.content)


def _install_fake_ollama(monkeypatch, content: str) -> _FakeOllamaClient:
    client = _FakeOllamaClient(content)
    monkeypatch.setattr(live_stt.httpx, "Client", lambda **_kwargs: client)
    monkeypatch.setattr(
        live_stt, "_select_ollama_model", lambda _client: "exaone3.5:2.4b"
    )
    return client


def test_live_analysis_routes_loan_from_real_text() -> None:
    result = analyze_live_text(
        "주택담보대출 만기가 다가옵니다. 연장 가능한지와 필요한 서류를 알고 싶습니다."
    )

    assert result["category"] == "대출 만기·연장·상환"
    assert result["routing"]["department"] == "여신·대출"
    assert result["routing"]["department_code"] == "LON"
    assert result["routing"]["level"] == "G"
    assert result["business_code"] == "loan"
    assert result["incident_risk"] == "low"
    assert "대출" in result["summary"]
    assert result["summary_status"] == "fallback"
    assert result["source"] == "local-rule-v2"


def test_live_analysis_marks_identity_theft_high_risk() -> None:
    result = analyze_live_text(
        "제가 신청하지 않은 대출 문자가 왔습니다. 명의도용 같아 불안합니다. 지급정지 해주세요."
    )

    assert result["category"] == "금융사기·지급정지"
    assert result["routing"]["department"] == "사고·신고"
    assert result["routing"]["department_code"] == "SG"
    assert result["routing"]["level"] == "E"
    assert result["incident_risk"] == "high"
    assert result["urgency_score"] >= 60
    assert result["emotion"]["status"] == "unavailable"
    assert result["emotion"]["score"] is None


def test_live_analysis_summary_is_extractive() -> None:
    text = (
        "안녕하세요. 오늘 카드 결제가 두 번 됐습니다. "
        "중복 결제를 취소하고 처리 결과를 확인하고 싶습니다. 감사합니다."
    )
    result = analyze_live_text(text)

    assert result["category"] == "카드 문의"
    assert "카드" in result["summary"]
    assert result["summary"] != text
    assert len(result["summary"]) < len(text)


def test_live_ollama_accepts_grounded_korean_summary_and_keeps_rule_routing(
    monkeypatch,
) -> None:
    monkeypatch.delenv("K7_OLLAMA_NUM_PREDICT", raising=False)
    content = json.dumps(
        {
            "summary": "주택담보대출 만기 연장 가능 여부와 필요한 서류를 문의함.",
            "action_items": [
                "대출 계약 상태 확인",
                "연장 조건 확인",
                "필요 서류 안내",
            ],
        },
        ensure_ascii=False,
    )
    client = _install_fake_ollama(monkeypatch, content)

    result = analyze_live_stt(
        LiveAnalysisRequest(
            text="주택담보대출 만기가 다가옵니다. 연장 가능한지와 필요한 서류를 알고 싶습니다."
        )
    )

    assert result["summary_status"] == "ready"
    assert result["source"] == "ollama:exaone3.5:2.4b"
    assert result["category"] == "대출 만기·연장·상환"
    assert result["routing"]["department"] == "여신·대출"
    assert result["incident_risk"] == "low"
    assert result["action_items"] == [
        "대출 계약 상태 확인",
        "연장·상환 조건 확인",
        "필요 서류 안내",
    ]
    assert set(client.payload["format"]["properties"]) == {"summary"}
    assert client.payload["options"]["num_predict"] == 192


def test_live_ollama_rejects_unrelated_english_hallucination(monkeypatch) -> None:
    content = json.dumps(
        {
            "summary": "The customer wants a London weather forecast.",
            "action_items": ["Check tomorrow's weather"],
        }
    )
    _install_fake_ollama(monkeypatch, content)

    result = analyze_live_stt(
        LiveAnalysisRequest(text="대출 만기 연장 가능 여부와 필요한 서류를 문의합니다.")
    )

    assert result["summary_status"] == "fallback"
    assert result["source"] == "local-rule-v2"
    assert result["fallback_reason"] == "ollama_output_rejected"
    assert result["category"] == "대출 만기·연장·상환"
    assert result["routing"]["department"] == "여신·대출"
    assert "weather" not in result["summary"].casefold()


def test_live_ollama_invalid_json_falls_back_to_reviewed_rules(monkeypatch) -> None:
    _install_fake_ollama(monkeypatch, "not-json-at-all")

    result = analyze_live_stt(
        LiveAnalysisRequest(text="대출 금리와 중도상환 조건을 확인하고 싶습니다.")
    )

    assert result["summary_status"] == "fallback"
    assert result["source"] == "local-rule-v2"
    assert result["fallback_reason"] == "ollama_output_rejected"
    assert result["category"] == "대출 금리·이자"
    assert result["business_code"] == "interest"
    assert result["incident_risk"] == "low"


def test_turn_analysis_classifies_only_customer_text_and_labels_full_dialogue(
    monkeypatch,
) -> None:
    content = json.dumps(
        {
            "summary": "고객은 카드 중복 결제를 문의했고 상담원은 대출 안내를 정정함.",
            "action_items": ["카드 중복 결제 내역 확인"],
        },
        ensure_ascii=False,
    )
    client = _install_fake_ollama(monkeypatch, content)

    result = analyze_live_stt(
        LiveAnalysisRequest(
            turns=[
                LiveAnalysisTurn(
                    speaker="customer",
                    text="카드 결제가 두 번 되어 중복 결제 내역을 확인하고 싶습니다.",
                    seq=1,
                ),
                LiveAnalysisTurn(
                    speaker="agent",
                    text="대출 만기와 명의도용 지급정지 절차가 아니라 카드 담당 안내입니다.",
                    seq=2,
                ),
            ]
        )
    )

    assert result["category"] == "카드 문의"
    assert result["incident_risk"] == "low"
    prompt = client.payload["messages"][1]["content"]
    assert "고객: 카드 결제가" in prompt
    assert "상담원: 대출 만기와" in prompt


def test_agent_only_risk_words_do_not_change_customer_routing(monkeypatch) -> None:
    def unavailable(*_args, **_kwargs):
        raise RuntimeError("offline")

    monkeypatch.setattr(live_stt, "_analyze_with_ollama", unavailable)
    result = analyze_live_stt(
        LiveAnalysisRequest(
            turns=[
                LiveAnalysisTurn(
                    speaker="customer",
                    text="카드 결제 내역을 확인해 주세요.",
                ),
                LiveAnalysisTurn(
                    speaker="agent",
                    text="명의도용과 보이스피싱 지급정지는 해당되지 않습니다.",
                ),
            ]
        )
    )

    assert result["category"] == "카드 문의"
    assert result["incident_risk"] == "low"
    assert result["fallback_reason"] == "ollama_unavailable"
    assert "상담원 안내:" in result["summary"]
    assert "해당되지 않습니다" in result["agent_guidance"]


def test_live_emergency_gate_is_the_recall_floor() -> None:
    result = analyze_live_text("경찰에서 전화왔어 5000만원 보내래")

    assert result["incident_risk"] == "high"
    assert result["routing"]["level"] == "E"
    assert result["routing"]["department_code"] == "SG"
    assert result["routing"]["department"] == "사고·신고"
    assert "긴급 게이트" in result["routing"]["reason"]


def test_live_emergency_hard_negative_uses_new_taxonomy_without_overrouting() -> None:
    result = analyze_live_text("보이스피싱 아니고요 그냥 이체 한도 확인하려고요")

    assert result["incident_risk"] == "low"
    assert result["routing"]["level"] == "G"
    assert result["routing"]["department_code"] == "DEP"
    assert result["business_code"] == "limit"


def test_ollama_cannot_publish_unsupported_action_items(monkeypatch) -> None:
    content = json.dumps(
        {
            "summary": "고객은 카드 분실과 본인이 모르는 결제를 신고하고 즉시 정지를 요청함.",
            # Older/small models may ignore the summary-only schema. Pydantic
            # deliberately ignores this field and reviewed rules own actions.
            "action_items": [
                "이메일로 접수 결과 발송",
                "문자로 재발급 링크 전송",
                "카드를 자동 재발급",
            ],
        },
        ensure_ascii=False,
    )
    client = _install_fake_ollama(monkeypatch, content)

    result = analyze_live_stt(
        LiveAnalysisRequest(
            text="카드를 분실했고 제가 모르는 결제가 있어 즉시 정지해 주세요."
        )
    )

    assert result["source"] == "ollama:exaone3.5:2.4b"
    assert "카드 분실" in result["summary"]
    assert result["action_items"] == [
        "본인 거래 여부 확인",
        "지급정지 필요성 확인",
        "사고대응 절차 안내",
    ]
    assert not any(
        term in " ".join(result["action_items"])
        for term in ("이메일", "문자", "재발급")
    )
    assert set(client.payload["format"]["properties"]) == {"summary"}


def test_grounded_urgent_card_paraphrase_does_not_need_exact_routing_keyword(
    monkeypatch,
) -> None:
    _install_fake_ollama(
        monkeypatch,
        json.dumps(
            {"summary": "신용카드 도난과 미승인 거래 차단을 요청한 긴급 문의임."},
            ensure_ascii=False,
        ),
    )

    result = analyze_live_stt(
        LiveAnalysisRequest(
            text="카드를 분실했고 제가 모르는 결제가 있어 즉시 정지해 주세요."
        )
    )

    assert result["summary_status"] == "ready"
    assert result["source"] == "ollama:exaone3.5:2.4b"
    assert result["summary"] == "신용카드 도난과 미승인 거래 차단을 요청한 긴급 문의임."
    assert result["routing"]["level"] == "E"


def test_summary_with_unsupported_procedure_is_rejected_even_with_shared_card_word(
    monkeypatch,
) -> None:
    _install_fake_ollama(
        monkeypatch,
        json.dumps(
            {
                "summary": (
                    "고객은 카드 분실을 신고했고 이메일로 재발급 링크를 "
                    "받기로 확정함."
                )
            },
            ensure_ascii=False,
        ),
    )

    result = analyze_live_stt(
        LiveAnalysisRequest(text="카드를 분실해서 정지하고 싶습니다.")
    )

    assert result["summary_status"] == "fallback"
    assert result["fallback_reason"] == "ollama_output_rejected"
    assert result["source"] == "local-rule-v2"
    assert "이메일" not in result["summary"]
    assert "재발급" not in result["summary"]


def test_full_call_analysis_returns_five_grounded_post_call_sections(monkeypatch) -> None:
    client = _install_fake_ollama(
        monkeypatch,
        json.dumps(
            {
                "summary": "고객은 대출 만기 연장을 문의했고 상담원은 서류 제출과 심사 필요성을 안내함.",
                "customer_request": "고객은 대출 만기 연장을 문의함.",
                "agent_guidance": "상담원은 소득 증빙 서류 제출이 필요하다고 안내함.",
                "confirmed_items": "대출 만기 연장 상담을 접수했습니다.",
                "unresolved_items": "연장 가능 여부는 심사가 필요합니다.",
                "follow_up_actions": "소득 증빙 서류를 제출해 주세요.",
            },
            ensure_ascii=False,
        ),
    )

    result = analyze_live_stt(
        LiveAnalysisRequest(
            scope="full",
            turns=[
                LiveAnalysisTurn(
                    speaker="customer",
                    text="대출 만기 연장을 문의합니다.",
                ),
                LiveAnalysisTurn(
                    speaker="agent",
                    text=(
                        "소득 증빙 서류 제출이 필요합니다. 대출 만기 연장 상담을 "
                        "접수했습니다. 연장 가능 여부는 심사가 필요합니다. "
                        "소득 증빙 서류를 제출해 주세요."
                    ),
                ),
            ],
        )
    )

    assert result["summary_status"] == "ready"
    assert result["post_call_summary"] == {
        "customer_request": "고객은 대출 만기 연장을 문의함.",
        "agent_guidance": "상담원은 소득 증빙 서류 제출이 필요하다고 안내함.",
        "confirmed_items": "대출 만기 연장 상담을 접수했습니다.",
        "unresolved_items": "연장 가능 여부는 심사가 필요합니다.",
        "follow_up_actions": "소득 증빙 서류를 제출해 주세요.",
    }
    assert set(client.payload["format"]["properties"]) == {
        "summary",
        "customer_request",
        "agent_guidance",
        "confirmed_items",
        "unresolved_items",
        "follow_up_actions",
    }
