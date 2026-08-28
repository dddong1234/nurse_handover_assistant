from __future__ import annotations

from copy import deepcopy
import json
from types import SimpleNamespace
import unittest

from services import handover_service
from services.openai_service import rewrite_handover_summary


PREVIOUS_RECORD = {
    "patient_id": "TEST-001",
    "name": "가상 환자",
    "room_no": "101",
    "age": 44,
    "sex": "F",
    "diagnosis": ["sample diagnosis"],
    "vitals": {
        "systolic": 120,
        "diastolic": 80,
        "heartrate": 72,
        "respiratory": 16,
        "saturation": 98,
        "body_temperature": 36.7,
    },
    "medications": [
        {"name": "기존 처방", "route": "PO", "frequency": "QD"}
    ],
    "notes": ["이전 기록"],
    "updated_at": "2026-08-28T07:00:00+09:00",
}

CURRENT_RECORD = {
    **PREVIOUS_RECORD,
    "vitals": {**PREVIOUS_RECORD["vitals"], "body_temperature": 37.4},
    "medications": [
        {"name": "추가 처방", "route": "IV", "frequency": "BID"}
    ],
    "diagnosis": ["sample diagnosis", "sample change"],
    "notes": ["이전 기록", "새 메모"],
    "updated_at": "2026-08-28T09:00:00+09:00",
}


class FakeResponses:
    def __init__(self, output: object = None, error: BaseException | None = None):
        self.output = output
        self.error = error
        self.kwargs: dict[str, object] | None = None

    def create(self, **kwargs):
        self.kwargs = kwargs
        if self.error is not None:
            raise self.error
        return SimpleNamespace(output_text=self.output)


class FakeClient:
    def __init__(self, output: object = None, error: BaseException | None = None):
        self.responses = FakeResponses(output, error)


def _inputs():
    comparison = handover_service.build_handover_comparison(
        deepcopy(PREVIOUS_RECORD), deepcopy(CURRENT_RECORD)
    )
    deterministic = handover_service.build_deterministic_summary(comparison)
    return comparison, deterministic


def _valid_ai_output(deterministic: dict[str, object]) -> dict[str, object]:
    sections = deepcopy(deterministic["sections"])
    return {
        "mode": "ai",
        "sections": sections,
        "evidenceIds": deepcopy(deterministic["evidenceIds"]),
        "warnings": [],
    }


def _expected_fallback(deterministic: dict[str, object]) -> dict[str, object]:
    expected = deepcopy(deterministic)
    expected["warnings"].append("AI_FALLBACK_USED")
    return expected


def _item_for_evidence(summary: dict[str, object], evidence_id: str) -> dict[str, object]:
    for items in summary["sections"].values():
        for item in items:
            if item["evidenceIds"] == [evidence_id]:
                return item
    for items in summary["sections"].values():
        for item in items:
            if evidence_id in item["evidenceIds"]:
                return item
    raise AssertionError(f"missing summary item for {evidence_id}")


class OpenAIServiceTests(unittest.TestCase):
    def test_success_sends_only_minimum_fictional_payload_and_returns_ai_summary(self):
        comparison, deterministic = _inputs()
        output = _valid_ai_output(deterministic)
        client = FakeClient(json.dumps(output, ensure_ascii=False))

        result = rewrite_handover_summary(comparison, deterministic, client)

        self.assertEqual(result["mode"], "ai")
        self.assertEqual(result["sections"], deterministic["sections"])
        self.assertEqual(result["evidenceIds"], deterministic["evidenceIds"])
        self.assertEqual(result["warnings"], deterministic["warnings"])
        self.assertIsNotNone(client.responses.kwargs)
        kwargs = client.responses.kwargs
        self.assertEqual(kwargs["model"], "gpt-5-mini")
        self.assertFalse(kwargs["store"])
        payload = json.loads(kwargs["input"])
        self.assertEqual(
            set(payload), {"patient", "interval", "changes", "deterministicSummary"}
        )
        self.assertEqual(
            payload["patient"], {"id": "TEST-001", "name": "가상 환자", "room": "101"}
        )
        self.assertEqual(payload["interval"], comparison["interval"])
        self.assertEqual(payload["changes"], comparison["changes"])
        self.assertEqual(payload["deterministicSummary"], deterministic)
        self.assertNotIn("previous", payload)
        self.assertNotIn("current", payload)
        self.assertEqual(kwargs["text"]["format"]["type"], "json_schema")
        self.assertTrue(kwargs["text"]["format"]["strict"])

    def test_timeout_returns_deterministic_summary_with_ai_fallback_warning(self):
        comparison, deterministic = _inputs()
        client = FakeClient(error=TimeoutError("provider timeout"))

        result = rewrite_handover_summary(comparison, deterministic, client)

        expected = deepcopy(deterministic)
        expected["warnings"].append("AI_FALLBACK_USED")
        self.assertEqual(result, expected)

    def test_provider_exception_returns_deterministic_summary_with_ai_fallback_warning(self):
        comparison, deterministic = _inputs()
        client = FakeClient(error=RuntimeError("provider unavailable"))

        result = rewrite_handover_summary(comparison, deterministic, client)

        expected = deepcopy(deterministic)
        expected["warnings"].append("AI_FALLBACK_USED")
        self.assertEqual(result, expected)

    def test_malformed_json_returns_deterministic_summary_with_ai_fallback_warning(self):
        comparison, deterministic = _inputs()
        client = FakeClient("not-json")

        result = rewrite_handover_summary(comparison, deterministic, client)

        expected = deepcopy(deterministic)
        expected["warnings"].append("AI_FALLBACK_USED")
        self.assertEqual(result, expected)

    def test_unknown_evidence_id_returns_deterministic_summary_with_ai_fallback_warning(self):
        comparison, deterministic = _inputs()
        output = _valid_ai_output(deterministic)
        output["sections"]["situation"][0]["evidenceIds"] = ["not-a-change-id"]
        client = FakeClient(json.dumps(output, ensure_ascii=False))

        result = rewrite_handover_summary(comparison, deterministic, client)

        expected = deepcopy(deterministic)
        expected["warnings"].append("AI_FALLBACK_USED")
        self.assertEqual(result, expected)

    def test_changed_numeric_value_returns_deterministic_summary_with_ai_fallback_warning(self):
        comparison, deterministic = _inputs()
        output = _valid_ai_output(deterministic)
        output["sections"]["assessment"][0]["text"] = "체온 변경: 36.7 -> 37.5"
        client = FakeClient(json.dumps(output, ensure_ascii=False))

        result = rewrite_handover_summary(comparison, deterministic, client)

        expected = deepcopy(deterministic)
        expected["warnings"].append("AI_FALLBACK_USED")
        self.assertEqual(result, expected)

    def test_additional_unsupported_statement_returns_deterministic_summary_with_ai_fallback_warning(self):
        comparison, deterministic = _inputs()
        output = _valid_ai_output(deterministic)
        output["sections"]["assessment"][0][
            "text"
        ] += ". 또한 환자는 안정적이며 즉시 의사에게 보고해야 합니다."
        client = FakeClient(json.dumps(output, ensure_ascii=False))

        result = rewrite_handover_summary(comparison, deterministic, client)

        self.assertEqual(result, _expected_fallback(deterministic))

    def test_reversed_added_removed_meaning_falls_back(self):
        previous = deepcopy(PREVIOUS_RECORD)
        previous["diagnosis"] = []
        comparison = handover_service.build_handover_comparison(previous, deepcopy(CURRENT_RECORD))
        deterministic = handover_service.build_deterministic_summary(comparison)
        added_diagnosis_id = next(
            change["id"]
            for change in comparison["changes"]
            if change["category"] == "diagnosis" and change["changeType"] == "added"
        )
        output = _valid_ai_output(deterministic)
        diagnosis_item = _item_for_evidence(output, added_diagnosis_id)
        diagnosis_item["text"] = "진단 삭제: sample change"
        client = FakeClient(json.dumps(output, ensure_ascii=False))

        result = rewrite_handover_summary(comparison, deterministic, client)

        self.assertEqual(result, _expected_fallback(deterministic))

    def test_number_borrowed_from_unrelated_patient_data_falls_back(self):
        previous = deepcopy(PREVIOUS_RECORD)
        current = deepcopy(CURRENT_RECORD)
        previous["vitals"]["body_temperature"] = 37
        current["vitals"]["body_temperature"] = 38
        comparison = handover_service.build_handover_comparison(previous, current)
        deterministic = handover_service.build_deterministic_summary(comparison)
        vital_id = next(
            change["id"]
            for change in comparison["changes"]
            if change["category"] == "vitals"
        )
        output = _valid_ai_output(deterministic)
        vital_item = _item_for_evidence(output, vital_id)
        vital_item["text"] = "체온 변경: 37 -> 38, 심박수 44"
        client = FakeClient(json.dumps(output, ensure_ascii=False))

        result = rewrite_handover_summary(comparison, deterministic, client)

        self.assertEqual(result, _expected_fallback(deterministic))

    def test_medication_route_and_numeric_frequency_omission_falls_back(self):
        previous = deepcopy(PREVIOUS_RECORD)
        current = deepcopy(CURRENT_RECORD)
        current["medications"] = [
            {"name": "추가 처방", "route": "IV", "frequency": "Q24H"}
        ]
        comparison = handover_service.build_handover_comparison(previous, current)
        deterministic = handover_service.build_deterministic_summary(comparison)
        added_medication_id = next(
            change["id"]
            for change in comparison["changes"]
            if change["category"] == "medications" and change["changeType"] == "added"
        )
        output = _valid_ai_output(deterministic)
        medication_item = _item_for_evidence(output, added_medication_id)
        medication_item["text"] = "투약 추가: 추가 처방"
        client = FakeClient(json.dumps(output, ensure_ascii=False))

        result = rewrite_handover_summary(comparison, deterministic, client)

        self.assertEqual(result, _expected_fallback(deterministic))

    def test_empty_no_previous_and_no_changes_sections_require_deterministic_context(self):
        cases = (
            (None, deepcopy(CURRENT_RECORD)),
            (deepcopy(CURRENT_RECORD), deepcopy(CURRENT_RECORD)),
        )
        for previous, current in cases:
            with self.subTest(previous_is_none=previous is None):
                comparison = handover_service.build_handover_comparison(previous, current)
                deterministic = handover_service.build_deterministic_summary(comparison)
                output = _valid_ai_output(deterministic)
                output["sections"]["situation"] = []
                client = FakeClient(json.dumps(output, ensure_ascii=False))

                result = rewrite_handover_summary(comparison, deterministic, client)

                self.assertEqual(result, _expected_fallback(deterministic))

    def test_reworded_decimal_vital_preserves_meaning_and_evidence(self):
        comparison, deterministic = _inputs()
        vital_id = next(
            change["id"]
            for change in comparison["changes"]
            if change["category"] == "vitals"
        )
        output = _valid_ai_output(deterministic)
        vital_item = _item_for_evidence(output, vital_id)
        vital_item["text"] = "체온이 36.7에서 37.4로 변경되었습니다."
        client = FakeClient(json.dumps(output, ensure_ascii=False))

        result = rewrite_handover_summary(comparison, deterministic, client)

        self.assertEqual(result["mode"], "ai")
        self.assertEqual(result["sections"]["assessment"][0]["text"], vital_item["text"])
        self.assertEqual(result["sections"]["assessment"][0]["evidenceIds"], [vital_id])
        self.assertEqual(result["warnings"], deterministic["warnings"])

    def test_aggregate_situation_cannot_replace_evidence_specific_change_items(self):
        comparison, deterministic = _inputs()
        output = _valid_ai_output(deterministic)
        output["sections"]["background"] = []
        output["sections"]["assessment"] = []
        client = FakeClient(json.dumps(output, ensure_ascii=False))

        result = rewrite_handover_summary(comparison, deterministic, client)

        self.assertEqual(result, _expected_fallback(deterministic))

    def test_negated_added_diagnosis_with_trailing_cancel_falls_back(self):
        previous = deepcopy(PREVIOUS_RECORD)
        previous["diagnosis"] = []
        comparison = handover_service.build_handover_comparison(previous, deepcopy(CURRENT_RECORD))
        deterministic = handover_service.build_deterministic_summary(comparison)
        added_diagnosis_id = next(
            change["id"]
            for change in comparison["changes"]
            if change["category"] == "diagnosis" and change["changeType"] == "added"
        )
        output = _valid_ai_output(deterministic)
        diagnosis_item = _item_for_evidence(output, added_diagnosis_id)
        diagnosis_item["text"] = "진단 추가 취소: sample change"
        client = FakeClient(json.dumps(output, ensure_ascii=False))

        result = rewrite_handover_summary(comparison, deterministic, client)

        self.assertEqual(result, _expected_fallback(deterministic))

    def test_negated_added_diagnosis_with_reversed_clause_falls_back(self):
        previous = deepcopy(PREVIOUS_RECORD)
        previous["diagnosis"] = []
        comparison = handover_service.build_handover_comparison(previous, deepcopy(CURRENT_RECORD))
        deterministic = handover_service.build_deterministic_summary(comparison)
        added_diagnosis_id = next(
            change["id"]
            for change in comparison["changes"]
            if change["category"] == "diagnosis" and change["changeType"] == "added"
        )
        output = _valid_ai_output(deterministic)
        diagnosis_item = _item_for_evidence(output, added_diagnosis_id)
        diagnosis_item["text"] = "sample change 진단은 추가가 아니라 삭제되었습니다."
        client = FakeClient(json.dumps(output, ensure_ascii=False))

        result = rewrite_handover_summary(comparison, deterministic, client)

        self.assertEqual(result, _expected_fallback(deterministic))

    def test_safe_reworded_added_diagnosis_sentence_is_accepted(self):
        previous = deepcopy(PREVIOUS_RECORD)
        previous["diagnosis"] = []
        comparison = handover_service.build_handover_comparison(previous, deepcopy(CURRENT_RECORD))
        deterministic = handover_service.build_deterministic_summary(comparison)
        added_diagnosis_id = next(
            change["id"]
            for change in comparison["changes"]
            if change["category"] == "diagnosis" and change["changeType"] == "added"
        )
        output = _valid_ai_output(deterministic)
        diagnosis_item = _item_for_evidence(output, added_diagnosis_id)
        diagnosis_item["text"] = "새로운 진단으로 sample change가 확인되었습니다."
        client = FakeClient(json.dumps(output, ensure_ascii=False))

        result = rewrite_handover_summary(comparison, deterministic, client)

        self.assertEqual(result["mode"], "ai")
        self.assertEqual(
            result["sections"]["background"][0]["text"],
            "새로운 진단으로 sample change가 확인되었습니다.",
        )
        self.assertEqual(
            result["sections"]["background"][0]["evidenceIds"],
            [added_diagnosis_id],
        )


if __name__ == "__main__":
    unittest.main()
