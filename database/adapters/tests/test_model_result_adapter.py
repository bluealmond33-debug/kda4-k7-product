from __future__ import annotations

import json
import unittest
from copy import deepcopy
from pathlib import Path

from database.adapters import AdapterError, load_mapping, normalize_model_result


DATABASE_DIR = Path(__file__).resolve().parents[2]
EXAMPLES_DIR = DATABASE_DIR / "contracts" / "examples"


def read_example(name: str) -> dict:
    with (EXAMPLES_DIR / name).open("r", encoding="utf-8") as handle:
        return json.load(handle)


class ModelResultAdapterTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.mapping = load_mapping()

    def test_high_risk_identity_theft_is_ready(self) -> None:
        payload = read_example("model_consultation_result_input.example.json")
        result = normalize_model_result(
            payload,
            external_session_key="K7-ADAPTER-0001",
            mapping=self.mapping,
            generated_at="2026-07-16T00:00:00Z",
        )

        self.assertEqual(result["status"], "ready")
        self.assertEqual(result["consultation_card"]["inquiry_type"], "other")
        self.assertEqual(result["consultation_card"]["risk_level"], "high")
        self.assertEqual(result["consultation_card"]["urgency_level"], "critical")
        self.assertEqual(
            result["routing_candidate"]["department_code"], "fraud_response"
        )

    def test_loan_without_risk_uses_versioned_business_policy(self) -> None:
        payload = read_example(
            "model_consultation_result_input_no_risk.example.json"
        )
        result = normalize_model_result(
            payload,
            external_session_key="K7-ADAPTER-0002",
            mapping=self.mapping,
            generated_at="2026-07-16T00:00:00Z",
        )

        self.assertEqual(result["status"], "ready")
        self.assertEqual(result["consultation_card"]["inquiry_type"], "loan")
        self.assertEqual(result["consultation_card"]["risk_level"], "low")
        self.assertEqual(
            result["routing_candidate"]["department_code"], "general_banking"
        )

    def test_unknown_business_type_stops_for_enrichment(self) -> None:
        payload = {
            "summary": "새로운 업무 문의",
            "business_type": "새로운 미정 업무",
            "department": "새로운 미정 부서",
            "routing_reason": "모델의 임시 추천",
        }
        result = normalize_model_result(
            payload,
            external_session_key="K7-ADAPTER-0003",
            mapping=self.mapping,
            generated_at="2026-07-16T00:00:00Z",
        )

        self.assertEqual(result["status"], "needs_enrichment")
        self.assertIsNone(result["consultation_card"])
        self.assertIsNone(result["routing_candidate"])
        self.assertIn("risk_level", result["pending_fields"])
        self.assertIn("department_code", result["pending_fields"])

    def test_unknown_extra_fields_are_reported_not_persisted(self) -> None:
        payload = read_example("model_consultation_result_input.example.json")
        payload["future_model_field"] = {"score": 0.9}
        result = normalize_model_result(
            payload,
            external_session_key="K7-ADAPTER-0004",
            mapping=self.mapping,
            generated_at="2026-07-16T00:00:00Z",
        )

        self.assertEqual(result["ignored_fields"], ["future_model_field"])
        self.assertNotIn("future_model_field", result["consultation_card"])

    def test_new_business_type_is_added_by_mapping_only(self) -> None:
        mapping = deepcopy(self.mapping)
        mapping["department_aliases"]["신규상담부서"] = "general_banking"
        mapping["business_types"]["신규 상품 문의"] = {
            "inquiry_type": "general_inquiry",
            "department_code": "general_banking",
            "default_risk_level": "low",
            "default_urgency_level": "low",
            "routing_confidence": 1.0,
        }
        payload = {
            "summary": "신규 상품의 가입 조건을 문의함.",
            "business_type": "신규 상품 문의",
            "department": "신규상담부서",
            "routing_reason": "신규 상품 일반 상담에 해당",
        }
        result = normalize_model_result(
            payload,
            external_session_key="K7-ADAPTER-0007",
            mapping=mapping,
            generated_at="2026-07-16T00:00:00Z",
        )

        self.assertEqual(result["status"], "ready")
        self.assertEqual(
            result["consultation_card"]["inquiry_type"], "general_inquiry"
        )
        self.assertEqual(
            result["routing_candidate"]["department_code"], "general_banking"
        )

    def test_session_key_mismatch_is_rejected(self) -> None:
        payload = read_example("model_consultation_result_input.example.json")
        payload["external_session_key"] = "K7-OTHER"
        with self.assertRaises(AdapterError):
            normalize_model_result(
                payload,
                external_session_key="K7-ADAPTER-0005",
                mapping=self.mapping,
            )

    def test_risk_label_requires_reason(self) -> None:
        payload = read_example("model_consultation_result_input.example.json")
        payload.pop("risk_reason")
        with self.assertRaises(AdapterError):
            normalize_model_result(
                payload,
                external_session_key="K7-ADAPTER-0006",
                mapping=self.mapping,
            )

    def test_canonical_english_risk_label_is_supported(self) -> None:
        payload = read_example("model_consultation_result_input.example.json")
        payload["incident_risk"] = "high"
        result = normalize_model_result(
            payload,
            external_session_key="K7-ADAPTER-0008",
            mapping=self.mapping,
            generated_at="2026-07-16T00:00:00Z",
        )

        self.assertEqual(result["status"], "ready")
        self.assertEqual(result["consultation_card"]["risk_level"], "high")


if __name__ == "__main__":
    unittest.main()
