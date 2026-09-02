from __future__ import annotations

import copy
import importlib
import os
import unittest
from unittest.mock import patch

from fastapi.testclient import TestClient

from tests.test_handover_shift_readiness_service import (
    REVIEW_START,
    SHIFT,
    minimal_record,
    p001_records,
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
            "reviewStartAt": REVIEW_START,
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
