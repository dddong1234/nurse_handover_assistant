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

        expected = deepcopy(deterministic)
        expected["warnings"].append("AI_FALLBACK_USED")
        self.assertEqual(result, expected)


if __name__ == "__main__":
    unittest.main()
