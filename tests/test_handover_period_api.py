from __future__ import annotations

from copy import deepcopy
import importlib
import json
import os
from pathlib import Path
from unittest.mock import patch
import unittest

from fastapi.testclient import TestClient

from services import handover_service


ROOT = Path(__file__).resolve().parents[1]


def load_timeline(patient_id: str) -> dict:
    with (ROOT / "data" / "timelines" / f"{patient_id}.json").open(
        encoding="utf-8"
    ) as handle:
        return json.load(handle)


def _client() -> TestClient:
    api_module = importlib.import_module("api.index")
    return TestClient(api_module.app)


class HandoverPeriodApiTests(unittest.TestCase):
    def test_period_compare_returns_deterministic_p001_response(self):
        timeline = load_timeline("P001")
        client = _client()

        with patch.dict(os.environ, {"OPENAI_API_KEY": "server-only-test-key"}):
            response = client.post(
                "/api/handover/period-compare",
                json={
                    "reviewStartAt": timeline["defaultReturnStartAt"],
                    "records": timeline["snapshots"],
                    "coverageGaps": timeline["coverageGaps"],
                    "summaryMode": "deterministic",
                },
            )

        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(
            set(body),
            {"patient", "period", "dataWarnings", "events", "reviewGroups", "summary"},
        )
        self.assertEqual(body["patient"]["id"], "P001")
        self.assertEqual(body["period"]["baselineRecordedAt"], "2026-06-29T15:00:00+09:00")
        self.assertEqual(body["period"]["currentRecordedAt"], "2026-07-02T09:00:00+09:00")
        self.assertEqual(body["period"]["snapshotCount"], 8)
        self.assertEqual(body["period"]["eventCount"], 24)
        self.assertEqual(body["period"]["status"], "ready")
        self.assertEqual(len(body["events"]), 24)
        self.assertEqual(
            set(body["reviewGroups"]),
            {"current", "periodOnly", "trends", "recordEvents"},
        )

        event_ids = {event["id"] for event in body["events"]}
        self.assertEqual(body["summary"]["mode"], "deterministic")
        self.assertEqual(body["summary"]["evidenceIds"], [event["id"] for event in body["events"]])
        for event in body["events"]:
            self.assertEqual(event["detectedAt"], event["interval"]["currentRecordedAt"])
            self.assertTrue(event["interval"]["previousRecordedAt"])
            self.assertTrue(event["interval"]["currentRecordedAt"])
        for items in body["reviewGroups"].values():
            for item in items:
                self.assertTrue(set(item["eventIds"]).issubset(event_ids))
        for section_items in body["summary"]["sections"].values():
            for item in section_items:
                self.assertTrue(set(item["evidenceIds"]).issubset(event_ids))

        self.assertNotIn("server-only-test-key", json.dumps(body, ensure_ascii=False))

    def test_unsorted_records_are_sorted_and_duplicate_times_return_422(self):
        timeline = load_timeline("P001")
        client = _client()
        reversed_records = list(reversed(deepcopy(timeline["snapshots"])))

        response = client.post(
            "/api/handover/period-compare",
            json={
                "reviewStartAt": timeline["defaultReturnStartAt"],
                "records": reversed_records,
            },
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["period"]["baselineRecordedAt"], "2026-06-29T15:00:00+09:00")
        self.assertEqual(response.json()["period"]["currentRecordedAt"], "2026-07-02T09:00:00+09:00")

        duplicate_records = deepcopy(timeline["snapshots"])
        duplicate_records.append(deepcopy(duplicate_records[0]))
        duplicate_response = client.post(
            "/api/handover/period-compare",
            json={
                "reviewStartAt": timeline["defaultReturnStartAt"],
                "records": duplicate_records,
            },
        )

        self.assertEqual(duplicate_response.status_code, 422)

    def test_mixed_patient_or_invalid_current_record_returns_422(self):
        timeline = load_timeline("P001")
        client = _client()
        mixed_records = deepcopy(timeline["snapshots"])
        mixed_records[-1]["patient_id"] = "P999"

        mixed_response = client.post(
            "/api/handover/period-compare",
            json={
                "reviewStartAt": timeline["defaultReturnStartAt"],
                "records": mixed_records,
            },
        )
        self.assertEqual(mixed_response.status_code, 422)

        invalid_current_records = deepcopy(timeline["snapshots"])
        del invalid_current_records[-1]["updated_at"]
        invalid_response = client.post(
            "/api/handover/period-compare",
            json={
                "reviewStartAt": timeline["defaultReturnStartAt"],
                "records": invalid_current_records,
            },
        )
        self.assertEqual(invalid_response.status_code, 422)

    def test_no_baseline_and_partial_are_successful_domain_states(self):
        timeline = load_timeline("P001")
        client = _client()

        no_baseline_response = client.post(
            "/api/handover/period-compare",
            json={
                "reviewStartAt": "2026-06-28T15:00:00+09:00",
                "records": timeline["snapshots"],
            },
        )
        self.assertEqual(no_baseline_response.status_code, 200)
        no_baseline_body = no_baseline_response.json()
        self.assertEqual(no_baseline_body["period"]["status"], "no_baseline")
        self.assertIsNone(no_baseline_body["period"]["baselineRecordedAt"])

        partial_timeline = load_timeline("P003")
        partial_response = client.post(
            "/api/handover/period-compare",
            json={
                "reviewStartAt": partial_timeline["defaultReturnStartAt"],
                "records": partial_timeline["snapshots"],
                "coverageGaps": partial_timeline["coverageGaps"],
            },
        )
        self.assertEqual(partial_response.status_code, 200)
        partial_body = partial_response.json()
        self.assertEqual(partial_body["period"]["status"], "partial")
        self.assertTrue(partial_body["dataWarnings"])
        self.assertEqual(partial_body["summary"]["warnings"], partial_body["dataWarnings"])

    def test_existing_pair_compare_contract_is_unchanged(self):
        previous = {
            "patient_id": "TEST-PAIR-001",
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
            "medications": [{"name": "기존 처방", "route": "PO", "frequency": "QD"}],
            "notes": ["이전 기록"],
            "updated_at": "2026-08-28T07:00:00+09:00",
        }
        current = deepcopy(previous)
        current["vitals"]["body_temperature"] = 37.4
        current["updated_at"] = "2026-08-28T09:00:00+09:00"
        client = _client()

        response = client.post(
            "/api/handover/compare",
            json={"previous": previous, "current": current},
        )

        expected_comparison = handover_service.build_handover_comparison(previous, current)
        expected_summary = handover_service.build_deterministic_summary(expected_comparison)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"comparison": expected_comparison, "summary": expected_summary})
        self.assertNotIn("patient", response.json())
        self.assertNotIn("period", response.json())


if __name__ == "__main__":
    unittest.main()
