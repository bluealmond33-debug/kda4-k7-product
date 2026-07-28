"""feedback_demo.save_feedback() 계약 테스트 (2026-07-28).

배경: 프론트(ClassifierFeedback.tsx, 통화 후처리 👍/👎 위젯)는 교정 드롭다운 UI가 없어
verdict="incorrect"여도 correction을 항상 null로 보낸다. 예전 코드는 이 경우를 무조건
ValueError로 거부해 오답(👎) 피드백이 edge_cases.jsonl에 단 한 건도 저장되지 않았다.
correction을 선택 사항으로 완화하되, correction을 실제로 보낸 호출부(예: 별도 교정
드롭다운 도구)의 기존 검증은 그대로 유지되는지 함께 확인한다.
"""

import json

import pytest

from app.classification import feedback_demo


@pytest.fixture
def feedback_file(tmp_path, monkeypatch):
    path = tmp_path / "edge_cases.jsonl"
    monkeypatch.setattr(feedback_demo, "feedback_path", lambda: path)
    return path


def test_incorrect_without_correction_is_saved(feedback_file):
    """wrap-up 위젯과 동일한 payload(태그·코멘트만, correction 없음) — 이제 저장돼야 한다."""
    result = feedback_demo.save_feedback(
        {
            "text": "자동이체 등록하고 싶어요",
            "source": "wrap-up",
            "prediction": {"routing": "GENERAL", "task_name": "자동이체 상담"},
            "verdict": "incorrect",
            "correction": None,
            "tags": ["human-reviewed", "wrap-up", "draft-poor", "업무유형"],
            "note": "코드가 이상해요",
        }
    )

    assert result["saved"] is True
    assert result["path"] is not None
    assert feedback_file.exists()

    lines = feedback_file.read_text(encoding="utf-8").strip().splitlines()
    assert len(lines) == 1
    record = json.loads(lines[0])
    assert record["verdict"] == "incorrect"
    assert record["correction"] is None
    assert record["tags"] == ["human-reviewed", "wrap-up", "draft-poor", "업무유형"]
    assert record["note"] == "코드가 이상해요"


def test_correct_is_never_saved(feedback_file):
    """👍(correct)는 재학습 후보가 아니므로 이전과 동일하게 저장되지 않아야 한다."""
    result = feedback_demo.save_feedback(
        {
            "text": "잔액 조회해주세요",
            "prediction": {"routing": "SIMPLE"},
            "verdict": "correct",
            "correction": None,
            "tags": [],
        }
    )

    assert result["saved"] is False
    assert result["path"] is None
    assert not feedback_file.exists()


def test_incorrect_with_valid_correction_still_validated_and_saved(feedback_file):
    """correction을 실제로 보낸 호출부(교정 드롭다운 등)의 기존 동작은 그대로 유지."""
    result = feedback_demo.save_feedback(
        {
            "text": "자동이체 등록하고 싶어요",
            "prediction": {"routing": "GENERAL"},
            "verdict": "incorrect",
            "correction": {"routing": "GENERAL", "task_code": "G006"},
            "tags": [],
        }
    )

    assert result["saved"] is True
    record = result["record"]
    assert record["correction"]["task_code"] == "G006"
    assert record["correction"]["department"] == "DEP"
    assert record["correction"]["handler"] == "HUMAN"


def test_incorrect_with_invalid_correction_still_rejected(feedback_file):
    """엉뚱한 routing/S-G-E 불일치 등 실제 correction 검증은 여전히 살아있어야 한다."""
    with pytest.raises(ValueError):
        feedback_demo.save_feedback(
            {
                "text": "자동이체 등록하고 싶어요",
                "verdict": "incorrect",
                "correction": {"routing": "SIMPLE", "task_code": "G006"},  # G006은 GENERAL
                "tags": [],
            }
        )
    assert not feedback_file.exists()


def test_incorrect_with_non_dict_correction_is_rejected(feedback_file):
    with pytest.raises(ValueError):
        feedback_demo.save_feedback(
            {
                "text": "자동이체 등록하고 싶어요",
                "verdict": "incorrect",
                "correction": "그냥 문자열",
                "tags": [],
            }
        )
