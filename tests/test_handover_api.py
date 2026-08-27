from __future__ import annotations

from copy import deepcopy
import importlib
from pathlib import Path
import unittest

from fastapi.testclient import TestClient

from services import handover_service


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


def _build_comparison():
    return handover_service.build_handover_comparison(
        deepcopy(PREVIOUS_RECORD), deepcopy(CURRENT_RECORD)
    )


def _summary_or_fail(test_case: unittest.TestCase, comparison):
    builder = getattr(handover_service, "build_deterministic_summary", None)
    test_case.assertIsNotNone(
        builder,
        "services.handover_service.build_deterministic_summary is required",
    )
    return builder(comparison)


def _client_or_fail(test_case: unittest.TestCase) -> TestClient:
    try:
        api_module = importlib.import_module("api.index")
    except ModuleNotFoundError as exc:
        test_case.fail(f"api.index must export a FastAPI app: {exc}")
    test_case.assertTrue(hasattr(api_module, "app"), "api.index must export app")
    return TestClient(api_module.app)


class DeterministicSummaryTests(unittest.TestCase):
    def test_summary_has_exact_sbar_container_and_all_change_evidence(self):
        comparison = _build_comparison()

        summary = _summary_or_fail(self, comparison)

        self.assertEqual(
            set(summary), {"mode", "sections", "evidenceIds", "warnings"}
        )
        self.assertEqual(summary["mode"], "deterministic")
        self.assertEqual(
            set(summary["sections"]),
            {"situation", "background", "assessment", "recommendation"},
        )
        self.assertEqual(
            summary["sections"]["recommendation"],
            [{"text": "간호사가 확인할 후속 항목을 입력하세요.", "evidenceIds": []}],
        )
        self.assertEqual(
            summary["evidenceIds"],
            [change["id"] for change in comparison["changes"]],
        )

    def test_summary_items_are_evidence_backed_and_grouped_by_change_category(self):
        comparison = _build_comparison()

        summary = _summary_or_fail(self, comparison)

        changes_by_id = {change["id"]: change for change in comparison["changes"]}
        all_change_ids = [change["id"] for change in comparison["changes"]]
        self.assertEqual(
            summary["sections"]["situation"][0]["evidenceIds"],
            all_change_ids,
        )
        for section_name in ("situation", "background", "assessment", "recommendation"):
            for item in summary["sections"][section_name]:
                self.assertEqual(set(item), {"text", "evidenceIds"})
                self.assertIsInstance(item["text"], str)
                self.assertIsInstance(item["evidenceIds"], list)
                self.assertTrue(
                    set(item["evidenceIds"]).issubset(changes_by_id)
                    or item["evidenceIds"] == []
                )

        for section_name in ("background", "assessment"):
            self.assertTrue(summary["sections"][section_name])
            self.assertTrue(
                all(
                    item["evidenceIds"]
                    for item in summary["sections"][section_name]
                )
            )
        self.assertEqual(
            [
                item
                for section_name in ("situation", "background", "assessment", "recommendation")
                for item in summary["sections"][section_name]
                if not item["evidenceIds"]
            ],
            summary["sections"]["recommendation"],
        )

        background_ids = {
            evidence_id
            for item in summary["sections"]["background"]
            for evidence_id in item["evidenceIds"]
        }
        self.assertTrue(
            background_ids
            and all(
                changes_by_id[evidence_id]["category"] in {"diagnosis", "medications"}
                for evidence_id in background_ids
            )
        )

        assessment_ids = {
            evidence_id
            for item in summary["sections"]["assessment"]
            for evidence_id in item["evidenceIds"]
        }
        self.assertTrue(
            assessment_ids
            and all(
                changes_by_id[evidence_id]["category"] in {"vitals", "notes"}
                for evidence_id in assessment_ids
            )
        )

    def test_no_previous_situation_explains_missing_baseline_without_zero_change_claim(self):
        comparison = handover_service.build_handover_comparison(
            None, deepcopy(CURRENT_RECORD)
        )

        summary = _summary_or_fail(self, comparison)
        situation_text = summary["sections"]["situation"][0]["text"]

        self.assertIn("가상 환자", situation_text)
        self.assertIn("101호", situation_text)
        self.assertIn("2026-08-28T09:00:00+09:00", situation_text)
        self.assertIn("이전 기록을 사용할 수 없어 비교를 수행하지 않았습니다.", situation_text)
        for forbidden in ("총 0건", "변화 없음", "변화가 없습니다", "안정"):
            self.assertNotIn(forbidden, situation_text)
        self.assertEqual(summary["sections"]["situation"][0]["evidenceIds"], [])

    def test_no_changes_situation_states_two_timestamp_comparison_and_zero_changes(self):
        comparison = handover_service.build_handover_comparison(
            deepcopy(CURRENT_RECORD), deepcopy(CURRENT_RECORD)
        )

        summary = _summary_or_fail(self, comparison)
        situation_text = summary["sections"]["situation"][0]["text"]

        self.assertIn("가상 환자", situation_text)
        self.assertIn("101호", situation_text)
        self.assertIn("2026-08-28T09:00:00+09:00 -> 2026-08-28T09:00:00+09:00", situation_text)
        self.assertIn("두 기록을 비교한 결과 총 0건의 변화가 확인되었습니다.", situation_text)
        self.assertNotIn("이전 기록을 사용할 수 없어 비교를 수행하지 않았습니다.", situation_text)
        self.assertEqual(summary["sections"]["situation"][0]["evidenceIds"], [])


class HandoverApiTests(unittest.TestCase):
    def test_health_endpoint_returns_ok(self):
        client = _client_or_fail(self)

        response = client.get("/api/health")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"status": "ok"})

    def test_compare_endpoint_returns_comparison_and_summary_for_valid_records(self):
        client = _client_or_fail(self)

        response = client.post(
            "/api/handover/compare",
            json={"previous": PREVIOUS_RECORD, "current": CURRENT_RECORD},
        )

        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(set(body), {"comparison", "summary"})
        self.assertEqual(body["comparison"]["status"], "ready")
        self.assertEqual(body["summary"]["mode"], "deterministic")

    def test_compare_endpoint_rejects_missing_current_record(self):
        client = _client_or_fail(self)

        response = client.post("/api/handover/compare", json={"previous": None})

        self.assertEqual(response.status_code, 422)

    def test_compare_endpoint_does_not_mutate_fixture_files(self):
        client = _client_or_fail(self)
        fixture_paths = sorted((Path(__file__).parents[1] / "data").rglob("*.json"))
        fixture_before = {fixture_path: fixture_path.read_bytes() for fixture_path in fixture_paths}

        response = client.post(
            "/api/handover/compare",
            json={"previous": PREVIOUS_RECORD, "current": CURRENT_RECORD},
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            {fixture_path: fixture_path.read_bytes() for fixture_path in fixture_paths},
            fixture_before,
        )


if __name__ == "__main__":
    unittest.main()
