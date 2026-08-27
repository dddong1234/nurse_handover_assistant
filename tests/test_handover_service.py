from __future__ import annotations

from copy import deepcopy
import unittest

from services.handover_service import (
    build_handover_comparison,
    detect_changes,
    generate_handover_text,
)


PREVIOUS_VITAL_ONLY = {
    "patient_id": "P001",
    "name": "홍길동",
    "room_no": "301",
    "age": 67,
    "sex": "M",
    "diagnosis": ["acute pharyngitis", "hypertension"],
    "vitals": {
        "systolic": 138,
        "diastolic": 88,
        "heartrate": 86,
        "respiratory": 17,
        "saturation": 98,
        "body_temperature": 37.9,
    },
    "medications": [
        {"name": "이부프로펜 400mg", "route": "PO", "frequency": "TID"}
    ],
    "notes": ["인후통 호소"],
    "updated_at": "2026-07-02T07:00:00+09:00",
}

CURRENT_VITAL_ONLY = {
    "patient_id": "P001",
    "name": "홍길동",
    "room_no": "301",
    "age": 67,
    "sex": "M",
    "diagnosis": ["acute pharyngitis", "hypertension"],
    "vitals": {
        "systolic": 138,
        "diastolic": 88,
        "heartrate": 86,
        "respiratory": 17,
        "saturation": 98,
        "body_temperature": 38.2,
    },
    "medications": [
        {"name": "이부프로펜 400mg", "route": "PO", "frequency": "TID"}
    ],
    "notes": ["인후통 호소"],
    "updated_at": "2026-07-02T09:00:00+09:00",
}


def _record(**overrides):
    record = deepcopy(PREVIOUS_VITAL_ONLY)
    record.update(overrides)
    return record


class HandoverComparisonTests(unittest.TestCase):
    def test_vital_change_has_exact_patient_interval_and_evidence_contract(self):
        comparison = build_handover_comparison(
            deepcopy(PREVIOUS_VITAL_ONLY), deepcopy(CURRENT_VITAL_ONLY)
        )

        self.assertEqual(comparison["status"], "ready")
        self.assertEqual(
            comparison["patient"],
            {
                "id": "P001",
                "name": "홍길동",
                "room": "301",
                "age": 67,
                "sex": "M",
                "diagnoses": ["acute pharyngitis", "hypertension"],
            },
        )
        self.assertEqual(
            comparison["interval"],
            {
                "previousRecordedAt": "2026-07-02T07:00:00+09:00",
                "currentRecordedAt": "2026-07-02T09:00:00+09:00",
            },
        )
        self.assertEqual(comparison["changes"][0], {
            "id": "vitals-body_temperature-modified",
            "category": "vitals",
            "changeType": "modified",
            "reviewPriority": "medium",
            "label": "체온",
            "previousValue": 37.9,
            "currentValue": 38.2,
            "delta": 0.3,
            "evidence": {
                "fieldPath": "vitals.body_temperature",
                "previousRecordedAt": "2026-07-02T07:00:00+09:00",
                "currentRecordedAt": "2026-07-02T09:00:00+09:00",
            },
        })

    def test_medication_add_remove_and_modify_are_high_priority_changes(self):
        previous = _record(
            medications=[
                {"name": "기존약", "route": "PO", "frequency": "QD"},
                {"name": "중단약", "route": "IV", "frequency": "BID"},
                {"name": "변경약", "route": "PO", "frequency": "QD"},
            ]
        )
        current = _record(
            medications=[
                {"name": "추가약", "route": "SC", "frequency": "HS"},
                {"name": "기존약", "route": "PO", "frequency": "QD"},
                {"name": "변경약", "route": "IV", "frequency": "BID"},
            ],
            updated_at="2026-07-02T09:00:00+09:00",
        )

        changes = build_handover_comparison(previous, current)["changes"]

        by_type = {change["changeType"]: change for change in changes}
        self.assertIsNone(by_type["added"]["previousValue"])
        self.assertEqual(
            by_type["added"]["currentValue"],
            {"name": "추가약", "route": "SC", "frequency": "HS"},
        )
        self.assertEqual(
            by_type["removed"]["previousValue"],
            {"name": "중단약", "route": "IV", "frequency": "BID"},
        )
        self.assertIsNone(by_type["removed"]["currentValue"])
        self.assertEqual(
            by_type["modified"]["previousValue"],
            {"name": "변경약", "route": "PO", "frequency": "QD"},
        )
        self.assertEqual(
            by_type["modified"]["currentValue"],
            {"name": "변경약", "route": "IV", "frequency": "BID"},
        )
        self.assertTrue(all(change["reviewPriority"] == "high" for change in changes))
        self.assertTrue(all(change["category"] == "medications" for change in changes))

    def test_diagnosis_additions_and_removals_are_first_class_changes(self):
        previous = _record(diagnosis=["유지 진단", "삭제 진단"])
        current = _record(
            diagnosis=["유지 진단", "추가 진단"],
            updated_at="2026-07-02T09:00:00+09:00",
        )

        changes = build_handover_comparison(previous, current)["changes"]

        self.assertEqual({change["changeType"] for change in changes}, {"added", "removed"})
        self.assertEqual({change["previousValue"] for change in changes}, {None, "삭제 진단"})
        self.assertEqual({change["currentValue"] for change in changes}, {None, "추가 진단"})
        self.assertTrue(all(change["category"] == "diagnosis" for change in changes))
        self.assertTrue(all(change["reviewPriority"] == "high" for change in changes))

    def test_note_additions_and_removals_are_low_priority_changes(self):
        previous = _record(notes=["유지 메모", "삭제 메모"])
        current = _record(
            notes=["유지 메모", "추가 메모"],
            updated_at="2026-07-02T09:00:00+09:00",
        )

        changes = build_handover_comparison(previous, current)["changes"]

        self.assertEqual({change["changeType"] for change in changes}, {"added", "removed"})
        self.assertEqual({change["previousValue"] for change in changes}, {None, "삭제 메모"})
        self.assertEqual({change["currentValue"] for change in changes}, {None, "추가 메모"})
        self.assertTrue(all(change["category"] == "notes" for change in changes))
        self.assertTrue(all(change["reviewPriority"] == "low" for change in changes))

    def test_changes_are_ordered_by_priority_then_category_and_id(self):
        previous = _record(
            vitals={"systolic": 120, "body_temperature": 36.5},
            medications=[
                {"name": "나중 약", "route": "PO", "frequency": "QD"},
                {"name": "먼저 약", "route": "PO", "frequency": "QD"},
            ],
            diagnosis=["기존 진단"],
            notes=["기존 메모"],
        )
        current = _record(
            vitals={"systolic": 121, "body_temperature": 37.0},
            medications=[
                {"name": "나중 약", "route": "IV", "frequency": "BID"},
                {"name": "먼저 약", "route": "PO", "frequency": "QD"},
                {"name": "추가 약", "route": "SC", "frequency": "HS"},
            ],
            diagnosis=["기존 진단", "추가 진단"],
            notes=["기존 메모", "추가 메모"],
            updated_at="2026-07-02T09:00:00+09:00",
        )

        changes = build_handover_comparison(previous, current)["changes"]
        sort_key = {"high": 0, "medium": 1, "low": 2}
        self.assertEqual(
            changes,
            sorted(changes, key=lambda change: (
                sort_key[change["reviewPriority"]],
                change["category"],
                change["id"],
            )),
        )

    def test_unchanged_records_have_no_changes_status(self):
        record = deepcopy(PREVIOUS_VITAL_ONLY)

        comparison = build_handover_comparison(deepcopy(record), deepcopy(record))

        self.assertEqual(comparison["status"], "no_changes")
        self.assertEqual(comparison["changes"], [])
        self.assertEqual(comparison["dataWarnings"], [])

    def test_missing_previous_record_has_no_previous_status(self):
        comparison = build_handover_comparison(None, deepcopy(CURRENT_VITAL_ONLY))

        self.assertEqual(comparison["status"], "no_previous")
        self.assertEqual(comparison["changes"], [])
        self.assertEqual(comparison["dataWarnings"], [])
        self.assertEqual(comparison["interval"]["previousRecordedAt"], None)
        self.assertEqual(
            comparison["interval"]["currentRecordedAt"],
            "2026-07-02T09:00:00+09:00",
        )

    def test_incomplete_records_are_partial_with_sorted_warnings_and_safe_changes(self):
        previous = _record(
            updated_at=None,
            medications=None,
        )
        previous.pop("updated_at")
        previous.pop("medications")
        current = deepcopy(CURRENT_VITAL_ONLY)
        current.pop("notes")

        comparison = build_handover_comparison(previous, current)

        self.assertEqual(comparison["status"], "partial")
        self.assertEqual(
            comparison["dataWarnings"],
            ["current.notes", "previous.medications", "previous.updated_at"],
        )
        self.assertEqual([change["id"] for change in comparison["changes"]], [
            "vitals-body_temperature-modified",
        ])

    def test_legacy_projection_keeps_korean_prefixes_and_medication_format(self):
        previous = _record(
            vitals={"body_temperature": 37.9},
            medications=[
                {"name": "중단약", "route": "IV", "frequency": "BID"},
                {"name": "변경약", "route": "PO", "frequency": "QD"},
            ],
            diagnosis=["삭제 진단"],
            notes=["삭제 메모"],
        )
        current = _record(
            vitals={"body_temperature": 38.2},
            medications=[
                {"name": "추가약", "route": "SC", "frequency": "HS"},
                {"name": "변경약", "route": "IV", "frequency": "BID"},
            ],
            diagnosis=["추가 진단"],
            notes=["추가 메모"],
        )

        self.assertEqual(
            detect_changes(previous, current),
            [
                "body_temperature 변화: 37.9 -> 38.2",
                "투약 추가: 추가약 (SC, HS)",
                "투약 중단: 중단약",
                "투약 변경: 변경약 (PO, QD) -> (IV, BID)",
                "신규 진단: 추가 진단",
                "삭제 진단: 삭제 진단",
                "신규 메모: 추가 메모",
                "삭제 메모: 삭제 메모",
            ],
        )
        self.assertEqual(
            generate_handover_text([]),
            "변화 없음",
        )


if __name__ == "__main__":
    unittest.main()
