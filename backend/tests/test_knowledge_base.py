from app.knowledge_base import apply_safety_policy, retrieve_knowledge


def test_local_rag_retrieves_financial_accident_guides() -> None:
    references = retrieve_knowledge(
        "제가 하지 않은 320만원 이체가 있어 보이스피싱 같고 계좌를 막아주세요"
    )

    assert references
    assert references[0].doc_id == "K7-DEMO-FRAUD-001"
    assert any(reference.doc_id == "K7-DEMO-FRAUD-002" for reference in references)
    assert all(0 <= reference.score <= 1 for reference in references)


def test_policy_overrides_unsafe_low_risk_model_result() -> None:
    guarded = apply_safety_policy(
        "본인 모르게 이체돼서 보이스피싱 같습니다",
        {
            "summary": "이체 문의",
            "business_type": "이체",
            "department": "전자금융",
            "routing_reason": "일반 이체 문의",
            "incident_risk": "low",
            "risk_reason": None,
            "routing_confidence": 0.5,
            "customer_requests": ["거래 확인"],
            "missing_information": [],
            "required_actions": [],
        },
    )

    assert guarded["incident_risk"] == "high"
    assert guarded["department"] == "금융사기"
    assert guarded["required_actions"][0]["source"] == "policy"


def test_policy_removes_sensitive_authentication_values_and_unsafe_promises() -> None:
    guarded = apply_safety_policy(
        "제가 하지 않은 이체라 지급정지를 요청합니다",
        {
            "missing_information": [
                "이체 시각",
                "고객 개인 인증 정보 (보안 질문 답변)",
            ],
            "required_actions": [
                {
                    "title": "피해 구제 안내",
                    "detail": "고객에게 예상 반환 시기와 예상 시간을 안내합니다.",
                    "source": "rag",
                }
            ],
        },
    )

    assert "이체 시각" in guarded["missing_information"]
    assert not any("보안 질문" in item for item in guarded["missing_information"])
    assert any("인증값 자체는 기록하지 않음" in item for item in guarded["missing_information"])
    details = " ".join(item["detail"] for item in guarded["required_actions"])
    assert "예상 반환 시기" not in details
    assert "예상 시간을 안내" not in details


def test_policy_rewrites_model_actions_that_claim_bank_execution() -> None:
    guarded = apply_safety_policy(
        "제가 하지 않은 이체라 사기 같습니다",
        {
            "required_actions": [
                {
                    "title": "피해 확인",
                    "detail": "이체 사실이 확인되면 즉시 지급정지를 진행합니다.",
                    "source": "model",
                },
                {
                    "title": "즉시 계좌에서 3,320만 원의 이체를 중지해 주세요.",
                    "detail": "사기라면 즉시 보상을 받을 수 있도록 조치해 주세요.",
                    "source": "model",
                },
            ]
        },
    )

    model_text = " ".join(
        f"{item['title']} {item['detail']}"
        for item in guarded["required_actions"]
        if item["source"] == "model"
    )
    assert "즉시 지급정지" not in model_text
    assert "이체를 중지" not in model_text
    assert "즉시 보상" not in model_text
    assert "가능 여부" in model_text
