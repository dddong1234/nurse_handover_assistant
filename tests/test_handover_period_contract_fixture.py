from __future__ import annotations

from datetime import datetime, timedelta
import json
from pathlib import Path
import re
import unittest

from services.handover_period_service import (
    build_deterministic_period_summary,
    build_handover_period_comparison,
)


ROOT = Path(__file__).resolve().parents[1]
TIMELINE_PATH = ROOT / "data" / "timelines" / "P001.json"
FIXTURE_PATH = ROOT / "data" / "contracts" / "P001_return_period_states.json"

_FICTIONAL_COVERAGE_GAP = {
    "from": "2026-06-30T12:00:00+09:00",
    "to": "2026-06-30T14:00:00+09:00",
    "code": "fictional_source_unavailable",
}


def load_timeline() -> dict:
    with TIMELINE_PATH.open(encoding="utf-8") as handle:
        return json.load(handle)


def build_api_response(
    timeline: dict,
    review_start_at: str,
    coverage_gaps: list[dict[str, str]],
) -> dict:
    comparison = build_handover_period_comparison(
        timeline["snapshots"],
        review_start_at,
        coverage_gaps,
    )
    return {
        "patient": comparison["patient"],
        "period": comparison["period"],
        "dataWarnings": comparison["dataWarnings"],
        "events": comparison["events"],
        "reviewGroups": comparison["reviewGroups"],
        "summary": build_deterministic_period_summary(comparison),
    }


def build_expected_states(timeline: dict) -> dict[str, dict]:
    earliest = datetime.fromisoformat(timeline["snapshots"][0]["updated_at"])
    no_baseline_start = (earliest - timedelta(hours=1)).isoformat()
    latest = timeline["snapshots"][-1]["updated_at"]
    default_start = timeline["defaultReturnStartAt"]

    return {
        "ready": build_api_response(timeline, default_start, []),
        "partial": build_api_response(
            timeline,
            default_start,
            [_FICTIONAL_COVERAGE_GAP],
        ),
        "no_baseline": build_api_response(timeline, no_baseline_start, []),
        "no_events": build_api_response(timeline, latest, []),
    }


def load_contract_fixture() -> dict:
    if not FIXTURE_PATH.exists():
        raise AssertionError(f"generated contract fixture is missing: {FIXTURE_PATH}")
    with FIXTURE_PATH.open(encoding="utf-8") as handle:
        return json.load(handle)


class HandoverPeriodContractFixtureTests(unittest.TestCase):
    def test_fixture_is_exactly_rebuilt_by_production_period_functions(self):
        timeline = load_timeline()
        expected = build_expected_states(timeline)
        fixture = load_contract_fixture()

        self.assertEqual(set(fixture), {"ready", "partial", "no_baseline", "no_events"})
        self.assertEqual(fixture, expected)

    def test_states_have_expected_statuses_counts_and_summary_warning_parity(self):
        states = load_contract_fixture()

        self.assertEqual(
            {name: state["period"]["status"] for name, state in states.items()},
            {
                "ready": "ready",
                "partial": "partial",
                "no_baseline": "no_baseline",
                "no_events": "no_events",
            },
        )
        self.assertEqual(states["ready"]["period"]["eventCount"], 24)
        self.assertEqual(len(states["ready"]["events"]), 24)
        self.assertEqual(len(states["ready"]["summary"]["evidenceIds"]), 24)
        self.assertEqual(states["partial"]["period"]["eventCount"], 24)
        self.assertEqual(states["no_baseline"]["period"]["eventCount"], 24)
        self.assertEqual(states["no_events"]["period"]["eventCount"], 0)
        self.assertEqual(states["no_events"]["events"], [])
        self.assertIsNone(states["no_baseline"]["period"]["baselineRecordedAt"])

        for name, state in states.items():
            with self.subTest(state=name):
                self.assertEqual(state["summary"]["warnings"], state["dataWarnings"])
                self.assertEqual(state["patient"]["id"], "P001")

    def test_ready_preserves_saline_and_ibuprofen_lifecycle_facts(self):
        timeline = load_timeline()
        ready = load_contract_fixture()["ready"]
        events = ready["events"]

        saline_events = sorted(
            (
                event
                for event in events
                if event["change"]["label"] == "생리식염주 500mL"
            ),
            key=lambda event: event["detectedAt"],
        )
        self.assertEqual(
            [event["change"]["changeType"] for event in saline_events],
            ["added", "removed"],
        )
        self.assertTrue(
            all(event["classification"] == "period_only" for event in saline_events)
        )
        saline_group = next(
            item
            for item in ready["reviewGroups"]["periodOnly"]
            if item["label"] == "생리식염주 500mL"
        )
        self.assertEqual(
            saline_group["eventIds"], [event["id"] for event in saline_events]
        )

        saline_snapshot = next(
            snapshot
            for snapshot in timeline["snapshots"]
            if snapshot["updated_at"] == "2026-06-29T23:00:00+09:00"
        )
        saline_value = next(
            medication
            for medication in saline_snapshot["medications"]
            if medication["name"] == "생리식염주 500mL"
        )
        self.assertIsNone(saline_events[0]["change"]["previousValue"])
        self.assertEqual(saline_events[0]["change"]["currentValue"], saline_value)
        self.assertEqual(saline_events[1]["change"]["previousValue"], saline_value)
        self.assertIsNone(saline_events[1]["change"]["currentValue"])

        ibuprofen_events = sorted(
            (
                event
                for event in events
                if event["change"]["label"] == "이부프로펜 400mg"
            ),
            key=lambda event: event["detectedAt"],
        )
        self.assertEqual(len(ibuprofen_events), 3)
        self.assertEqual(
            [event["change"]["changeType"] for event in ibuprofen_events],
            ["modified", "modified", "modified"],
        )
        self.assertTrue(
            all(event["classification"] == "current" for event in ibuprofen_events)
        )
        self.assertEqual(
            [event["change"]["currentValue"]["frequency"] for event in ibuprofen_events],
            ["TID", "BID", "TID"],
        )
        ibuprofen_group = next(
            item
            for item in ready["reviewGroups"]["current"]
            if item["label"] == "이부프로펜 400mg"
        )
        self.assertEqual(
            ibuprofen_group["eventIds"], [event["id"] for event in ibuprofen_events]
        )

    def test_fixture_contains_no_real_identifier_fields_or_contact_patterns(self):
        load_contract_fixture()
        raw = FIXTURE_PATH.read_text(encoding="utf-8")
        lowered = raw.lower()
        forbidden_keys = (
            "resident_registration_number",
            "주민등록번호",
            "phone",
            "telephone",
            "email",
            "address",
            "ssn",
        )
        for key in forbidden_keys:
            self.assertNotIn(key.lower(), lowered)
        self.assertIsNone(re.search(r"(?<!\d)\d{2,3}[- ]\d{3,4}[- ]\d{4}(?!\d)", raw))
        self.assertIsNone(re.search(r"\b[^\s@]+@[^\s@]+\.[^\s@]+\b", raw))


if __name__ == "__main__":
    unittest.main()
