from __future__ import annotations

import copy
import importlib
import unittest
from unittest.mock import patch

from fastapi.testclient import TestClient

from tests.test_handover_shift_readiness_service import (
    BASELINE_REVIEW_START,
    REVIEW_START,
    SHIFT,
    minimal_record,
    p001_records,
    records_with_medication_effective_and_period_change,
    records_with_missing_source_collections,
    records_with_scheduled_investigation,
)


def p001_request() -> dict:
    return {
        "reviewStartAt": REVIEW_START,
        "shift": copy.deepcopy(SHIFT),
        "records": p001_records(),
        "coverageGaps": [],
    }


def _client() -> TestClient:
    api_module = importlib.import_module("api.index")
    return TestClient(api_module.app)


class ShiftReadinessApiTests(unittest.TestCase):
    def test_effective_medication_api_keeps_matching_period_evidence(self):
        request = {
            "reviewStartAt": BASELINE_REVIEW_START,
            "shift": copy.deepcopy(SHIFT),
            "records": records_with_medication_effective_and_period_change(),
            "coverageGaps": [],
        }
        response = _client().post("/api/handover/shift-readiness", json=request)
        self.assertEqual(200, response.status_code)
        medication_items = [
            item for item in response.json()["items"] if item["domain"] == "medication"
        ]
        self.assertEqual(1, len(medication_items))
        self.assertEqual("MEDICATION_EFFECTIVE_SHIFT", medication_items[0]["ruleCode"])
        self.assertEqual(
            {
                "event:P-TEST:medications:기존-처방:2026-07-02T09:00:00+09:00:modified"
            },
            {
                ref["periodEventId"]
                for ref in medication_items[0]["sourceRefs"]
                if ref.get("periodEventId")
            },
        )

    def test_shift_readiness_endpoint_returns_p001_contract(self):
        response = _client().post("/api/handover/shift-readiness", json=p001_request())
        self.assertEqual(200, response.status_code)
        body = response.json()
        self.assertEqual("P001", body["patient"]["id"])
        self.assertEqual(body["metrics"]["itemCount"], len(body["items"]))

    def test_bad_shift_and_future_record_return_422(self):
        request = p001_request()
        request["shift"] = {
            "startsAt": request["shift"]["endsAt"],
            "endsAt": request["shift"]["startsAt"],
        }
        self.assertEqual(
            422,
            _client().post("/api/handover/shift-readiness", json=request).status_code,
        )

        future = p001_request()
        future["records"][-1]["updated_at"] = "2026-07-02T16:00:00+09:00"
        self.assertEqual(
            422,
            _client().post("/api/handover/shift-readiness", json=future).status_code,
        )

    def test_empty_records_patient_mismatch_invalid_enum_and_duplicate_timestamp_return_422(self):
        client = _client()
        empty = p001_request()
        empty["records"] = []
        self.assertEqual(422, client.post("/api/handover/shift-readiness", json=empty).status_code)

        mismatch = p001_request()
        mismatch["records"][0]["patient_id"] = "P999"
        self.assertEqual(422, client.post("/api/handover/shift-readiness", json=mismatch).status_code)

        invalid = p001_request()
        invalid["records"][-1]["investigations"][0]["status"] = "bad"
        self.assertEqual(422, client.post("/api/handover/shift-readiness", json=invalid).status_code)

        duplicate = p001_request()
        duplicate["records"].append(copy.deepcopy(duplicate["records"][-1]))
        self.assertEqual(422, client.post("/api/handover/shift-readiness", json=duplicate).status_code)

    def test_status_contract_supports_no_items_and_partial(self):
        client = _client()
        record = minimal_record()
        request = {
            "reviewStartAt": BASELINE_REVIEW_START,
            "shift": copy.deepcopy(SHIFT),
            "records": [record],
            "coverageGaps": [],
        }
        response = client.post("/api/handover/shift-readiness", json=request)
        self.assertEqual(200, response.status_code)
        self.assertEqual("no_baseline", response.json()["status"])

        request["coverageGaps"] = [
            {
                "from": "2026-07-02T07:00:00+09:00",
                "to": "2026-07-02T08:00:00+09:00",
                "code": "missing",
            }
        ]
        request["reviewStartAt"] = "2026-07-02T08:00:00+09:00"
        response = client.post("/api/handover/shift-readiness", json=request)
        self.assertEqual(200, response.status_code)
        self.assertEqual("partial", response.json()["status"])

    def test_available_status_is_explicit_for_baseline_with_a_valid_item(self):
        request = {
            "reviewStartAt": BASELINE_REVIEW_START,
            "shift": copy.deepcopy(SHIFT),
            "records": records_with_scheduled_investigation(),
            "coverageGaps": [],
        }
        response = _client().post("/api/handover/shift-readiness", json=request)
        self.assertEqual(200, response.status_code)
        self.assertEqual("available", response.json()["status"])
        self.assertGreater(response.json()["metrics"]["itemCount"], 0)

    def test_no_baseline_status_is_explicit_without_prior_snapshot(self):
        request = {
            "reviewStartAt": BASELINE_REVIEW_START,
            "shift": copy.deepcopy(SHIFT),
            "records": [minimal_record(recorded_at="2026-07-02T09:00:00+09:00")],
            "coverageGaps": [],
        }
        response = _client().post("/api/handover/shift-readiness", json=request)
        self.assertEqual(200, response.status_code)
        self.assertEqual("no_baseline", response.json()["status"])

    def test_no_items_status_is_explicit_for_baseline_without_matching_rules(self):
        baseline = minimal_record(recorded_at="2026-06-29T15:00:00+09:00")
        current = copy.deepcopy(baseline)
        current["updated_at"] = "2026-07-02T09:00:00+09:00"
        request = {
            "reviewStartAt": BASELINE_REVIEW_START,
            "shift": copy.deepcopy(SHIFT),
            "records": [baseline, current],
            "coverageGaps": [],
        }
        response = _client().post("/api/handover/shift-readiness", json=request)
        self.assertEqual(200, response.status_code)
        self.assertEqual("no_items", response.json()["status"])
        self.assertEqual(0, response.json()["metrics"]["itemCount"])

    def test_partial_status_is_explicit_for_missing_source_collections(self):
        request = {
            "reviewStartAt": BASELINE_REVIEW_START,
            "shift": copy.deepcopy(SHIFT),
            "records": records_with_missing_source_collections(),
            "coverageGaps": [],
        }
        response = _client().post("/api/handover/shift-readiness", json=request)
        self.assertEqual(200, response.status_code)
        body = response.json()
        self.assertEqual("partial", body["status"])
        self.assertEqual(0, body["metrics"]["itemCount"])
        self.assertTrue(
            {
                "SHIFT_READINESS_INVALID_INVESTIGATIONS_ARRAY",
                "SHIFT_READINESS_INVALID_DEVICES_ARRAY",
                "SHIFT_READINESS_INVALID_MEDICATIONS_ARRAY",
                "SHIFT_READINESS_INVALID_HANDOFF_REQUESTS_ARRAY",
            }.issubset(set(body["dataWarnings"]))
        )

    def test_route_does_not_mutate_request_or_fixture_payload(self):
        request = p001_request()
        before = copy.deepcopy(request)
        response = _client().post("/api/handover/shift-readiness", json=request)
        self.assertEqual(200, response.status_code)
        self.assertEqual(before, request)

    def test_unexpected_shift_readiness_error_is_sanitized_500(self):
        api_module = importlib.import_module("api.index")
        with patch.object(
            api_module,
            "build_shift_readiness",
            side_effect=RuntimeError("secret internal detail"),
        ):
            response = TestClient(api_module.app).post(
                "/api/handover/shift-readiness", json=p001_request()
            )
        self.assertEqual(500, response.status_code)
        self.assertEqual(
            {"detail": "Shift Readiness 처리 중 오류가 발생했습니다"}, response.json()
        )
        self.assertNotIn("secret internal detail", response.text)

    def test_existing_pair_and_period_routes_remain_available(self):
        client = _client()
        records = p001_records()
        pair = client.post(
            "/api/handover/compare",
            json={"previous": records[-2], "current": records[-1]},
        )
        self.assertEqual(200, pair.status_code)
        period = client.post(
            "/api/handover/period-compare",
            json={
                "reviewStartAt": REVIEW_START,
                "records": [
                    {
                        **{
                            key: value
                            for key, value in record.items()
                            if key not in {"investigations", "devices", "handoffRequests"}
                        },
                        "medications": [
                            {
                                key: value
                                for key, value in medication.items()
                                if key in {"name", "route", "frequency"}
                            }
                            for medication in record.get("medications", [])
                        ],
                    }
                    for record in records
                ],
                "coverageGaps": [],
            },
        )
        self.assertEqual(200, period.status_code)
        self.assertEqual(24, period.json()["period"]["eventCount"])

if __name__ == "__main__":
    unittest.main()
