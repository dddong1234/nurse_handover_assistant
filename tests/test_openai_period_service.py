from __future__ import annotations

from copy import deepcopy
import json
from pathlib import Path
from types import SimpleNamespace
import unittest

from services.handover_period_service import (
    build_deterministic_period_summary,
    build_handover_period_comparison,
)
from services.openai_period_service import rewrite_handover_period_summary


ROOT = Path(__file__).resolve().parents[1]


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


def _inputs() -> tuple[dict, dict]:
    with (ROOT / "data" / "timelines" / "P001.json").open(encoding="utf-8") as handle:
        timeline = json.load(handle)
    comparison = build_handover_period_comparison(
        timeline["snapshots"],
        timeline["defaultReturnStartAt"],
        timeline["coverageGaps"],
    )
    return comparison, build_deterministic_period_summary(comparison)


def _valid_ai_output(deterministic: dict) -> dict:
    return {
        "mode": "ai",
        "sections": deepcopy(deterministic["sections"]),
        "evidenceIds": deepcopy(deterministic["evidenceIds"]),
        "warnings": deepcopy(deterministic["warnings"]),
    }


def _expected_fallback(deterministic: dict) -> dict:
    expected = deepcopy(deterministic)
    expected["warnings"].append("AI_FALLBACK_USED")
    return expected


def _item_for_evidence(summary: dict, evidence_id: str) -> dict:
    for items in summary["sections"].values():
        for item in items:
            if evidence_id in item["evidenceIds"]:
                return item
    raise AssertionError(f"missing summary item for {evidence_id}")


def _single_modified_medication_inputs() -> tuple[dict, dict]:
    with (ROOT / "data" / "timelines" / "P001.json").open(encoding="utf-8") as handle:
        timeline = json.load(handle)
    first = deepcopy(timeline["snapshots"][0])
    current = deepcopy(first)
    first["medications"] = [
        {"name": "전환 약", "route": "PO", "frequency": "BID"}
    ]
    current["medications"] = [
        {"name": "전환 약", "route": "IV", "frequency": "BID"}
    ]
    current["updated_at"] = "2026-06-29T23:00:00+09:00"
    comparison = build_handover_period_comparison(
        [first, current],
        first["updated_at"],
        [],
    )
    return comparison, build_deterministic_period_summary(comparison)


class OpenAIPeriodServiceTests(unittest.TestCase):
    def test_valid_structured_wording_preserves_evidence_and_uses_minimum_payload(self):
        comparison, deterministic = _inputs()
        output = _valid_ai_output(deterministic)
        client = FakeClient(json.dumps(output, ensure_ascii=False))

        result = rewrite_handover_period_summary(comparison, deterministic, client)

        self.assertEqual(result["mode"], "ai")
        self.assertEqual(result["sections"], deterministic["sections"])
        self.assertEqual(result["evidenceIds"], deterministic["evidenceIds"])
        self.assertEqual(result["warnings"], deterministic["warnings"])
        self.assertIsNotNone(client.responses.kwargs)
        kwargs = client.responses.kwargs
        payload = json.loads(kwargs["input"])
        self.assertEqual(
            set(payload), {"patient", "period", "events", "reviewGroups", "deterministicSummary"}
        )
        self.assertNotIn("records", payload)
        self.assertEqual(payload["period"], comparison["period"])
        self.assertEqual(payload["events"], comparison["events"])
        self.assertEqual(payload["reviewGroups"], comparison["reviewGroups"])
        self.assertEqual(payload["deterministicSummary"], deterministic)
        self.assertFalse(kwargs["store"])
        self.assertEqual(kwargs["text"]["format"]["type"], "json_schema")
        self.assertTrue(kwargs["text"]["format"]["strict"])

    def test_timeout_returns_deterministic_summary_with_ai_fallback_warning(self):
        comparison, deterministic = _inputs()
        result = rewrite_handover_period_summary(
            comparison,
            deterministic,
            FakeClient(error=TimeoutError("provider timeout")),
        )
        self.assertEqual(result, _expected_fallback(deterministic))

    def test_provider_exception_returns_deterministic_summary_with_ai_fallback_warning(self):
        comparison, deterministic = _inputs()
        result = rewrite_handover_period_summary(
            comparison,
            deterministic,
            FakeClient(error=RuntimeError("provider unavailable")),
        )
        self.assertEqual(result, _expected_fallback(deterministic))

    def test_malformed_json_returns_deterministic_summary_with_ai_fallback_warning(self):
        comparison, deterministic = _inputs()
        result = rewrite_handover_period_summary(
            comparison,
            deterministic,
            FakeClient("not-json"),
        )
        self.assertEqual(result, _expected_fallback(deterministic))

    def test_invented_event_id_returns_deterministic_summary_with_ai_fallback_warning(self):
        comparison, deterministic = _inputs()
        output = _valid_ai_output(deterministic)
        output["sections"]["background"][0]["evidenceIds"] = ["event:not-real"]
        result = rewrite_handover_period_summary(
            comparison,
            deterministic,
            FakeClient(json.dumps(output, ensure_ascii=False)),
        )
        self.assertEqual(result, _expected_fallback(deterministic))

    def test_changed_value_count_time_classification_priority_and_gap_fall_back(self):
        comparison, deterministic = _inputs()
        mutations = (
            ("count", lambda output: output["sections"]["situation"][0].__setitem__("text", "기간 변화 25건")),
            ("time", lambda output: output["sections"]["situation"][0].__setitem__("text", output["sections"]["situation"][0]["text"].replace("2026-07-02T09:00:00+09:00", "2026-07-03T09:00:00+09:00"))),
            ("value", lambda output: _item_for_evidence(output, comparison["events"][0]["id"]).__setitem__("text", "수치 999")),
            ("classification", lambda output: _item_for_evidence(output, comparison["events"][0]["id"]).__setitem__("text", "현재 반영")),
            ("priority", lambda output: _item_for_evidence(output, comparison["events"][0]["id"]).__setitem__("text", "우선순위 high")),
            ("gap", lambda output: output["sections"]["recommendation"][0].__setitem__("text", "공백 없음")),
        )
        for label, mutate in mutations:
            with self.subTest(label=label):
                output = _valid_ai_output(deterministic)
                mutate(output)
                result = rewrite_handover_period_summary(
                    comparison,
                    deterministic,
                    FakeClient(json.dumps(output, ensure_ascii=False)),
                )
                self.assertEqual(result, _expected_fallback(deterministic))

    def test_missing_evidence_returns_deterministic_summary_with_ai_fallback_warning(self):
        comparison, deterministic = _inputs()
        output = _valid_ai_output(deterministic)
        output["sections"]["assessment"] = []
        result = rewrite_handover_period_summary(
            comparison,
            deterministic,
            FakeClient(json.dumps(output, ensure_ascii=False)),
        )
        self.assertEqual(result, _expected_fallback(deterministic))

    def test_reworded_source_fact_can_contain_forbidden_interpretation_word(self):
        with (ROOT / "data" / "timelines" / "P001.json").open(encoding="utf-8") as handle:
            timeline = json.load(handle)
        timeline["snapshots"][-1]["notes"].append("의사 보고")
        comparison = build_handover_period_comparison(
            timeline["snapshots"],
            timeline["defaultReturnStartAt"],
            timeline["coverageGaps"],
        )
        deterministic = build_deterministic_period_summary(comparison)
        event = next(
            event
            for event in comparison["events"]
            if event["change"]["label"] == "의사 보고"
        )
        output = _valid_ai_output(deterministic)
        item = next(
            item
            for item in output["sections"]["assessment"]
            if item["evidenceIds"] == [event["id"]]
        )
        item["text"] = "간호 메모 의사 보고 · 추가 · 기록 사건"

        result = rewrite_handover_period_summary(
            comparison,
            deterministic,
            FakeClient(json.dumps(output, ensure_ascii=False)),
        )

        self.assertEqual(result["mode"], "ai")
        self.assertEqual(
            next(
                item
                for item in result["sections"]["assessment"]
                if item["evidenceIds"] == [event["id"]]
            )["text"],
            "간호 메모 의사 보고 · 추가 · 기록 사건",
        )

    def test_context_cannot_borrow_a_value_from_an_event(self):
        comparison, deterministic = _inputs()
        output = _valid_ai_output(deterministic)
        output["sections"]["situation"][0]["text"] += " · 37.4"

        result = rewrite_handover_period_summary(
            comparison,
            deterministic,
            FakeClient(json.dumps(output, ensure_ascii=False)),
        )

        self.assertEqual(result, _expected_fallback(deterministic))

    def test_context_cannot_add_an_event_classification(self):
        comparison, deterministic = _inputs()
        output = _valid_ai_output(deterministic)
        output["sections"]["situation"][0]["text"] += " · 기간 중 종료"

        result = rewrite_handover_period_summary(
            comparison,
            deterministic,
            FakeClient(json.dumps(output, ensure_ascii=False)),
        )

        self.assertEqual(result, _expected_fallback(deterministic))

    def test_detail_cannot_add_a_bare_priority_value(self):
        comparison, deterministic = _inputs()
        output = _valid_ai_output(deterministic)
        event_id = comparison["events"][0]["id"]
        item = next(
            item
            for item in output["sections"]["background"]
            if item["evidenceIds"] == [event_id]
        )
        item["text"] = f"hypertension 진단 추가 현재 반영 low"
        result = rewrite_handover_period_summary(
            comparison,
            deterministic,
            FakeClient(json.dumps(output, ensure_ascii=False)),
        )

        self.assertEqual(result, _expected_fallback(deterministic))

    def test_unsupported_added_clinical_prose_returns_deterministic_fallback(self):
        comparison, deterministic = _inputs()
        output = _valid_ai_output(deterministic)
        item = output["sections"]["background"][0]
        item["text"] = "진단 hypertension 추가 · 현재 반영 · 환자는 식사를 잘함"

        result = rewrite_handover_period_summary(
            comparison,
            deterministic,
            FakeClient(json.dumps(output, ensure_ascii=False)),
        )

        self.assertEqual(result, _expected_fallback(deterministic))

    def test_medication_route_change_with_token_boundary_returns_deterministic_fallback(self):
        comparison, deterministic = _inputs()
        output = _valid_ai_output(deterministic)
        event = next(
            event
            for event in comparison["events"]
            if event["change"]["category"] == "medications"
            and event["change"]["changeType"] == "added"
        )
        item = next(
            item
            for item in output["sections"]["background"]
            if item["evidenceIds"] == [event["id"]]
        )
        item["text"] = "투약 추가: 타세놀정 500mg · APO · TID · 현재 반영"

        result = rewrite_handover_period_summary(
            comparison,
            deterministic,
            FakeClient(json.dumps(output, ensure_ascii=False)),
        )

        self.assertEqual(result, _expected_fallback(deterministic))

    def test_reversed_medication_transition_returns_deterministic_fallback(self):
        comparison, deterministic = _single_modified_medication_inputs()
        output = _valid_ai_output(deterministic)
        event = comparison["events"][0]
        item = next(
            item
            for item in output["sections"]["background"]
            if item["evidenceIds"] == [event["id"]]
        )
        item["text"] = (
            "투약 변경: 전환 약 · IV · BID -> 전환 약 · PO · BID · 현재 반영"
        )

        result = rewrite_handover_period_summary(
            comparison,
            deterministic,
            FakeClient(json.dumps(output, ensure_ascii=False)),
        )

        self.assertEqual(result, _expected_fallback(deterministic))

    def test_cross_item_evidence_duplication_returns_deterministic_fallback(self):
        comparison, deterministic = _inputs()
        output = _valid_ai_output(deterministic)
        output["sections"]["background"].append(
            deepcopy(output["sections"]["background"][0])
        )

        result = rewrite_handover_period_summary(
            comparison,
            deterministic,
            FakeClient(json.dumps(output, ensure_ascii=False)),
        )

        self.assertEqual(result, _expected_fallback(deterministic))


if __name__ == "__main__":
    unittest.main()
