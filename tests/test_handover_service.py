from __future__ import annotations

from copy import deepcopy
import unittest

from services.handover_service import (
    build_deterministic_summary,
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
                {"name": "추가약2", "route": "PO", "frequency": "Q8H"},
                {"name": "기존약", "route": "PO", "frequency": "QD"},
                {"name": "변경약", "route": "IV", "frequency": "BID"},
            ],
            updated_at="2026-07-02T09:00:00+09:00",
        )

        changes = build_handover_comparison(previous, current)["changes"]

        medication_changes = [
            change for change in changes if change["category"] == "medications"
        ]
        self.assertEqual(len(medication_changes), 4)
        by_label = {change["label"]: change for change in medication_changes}
        self.assertEqual(by_label["중단약"]["id"], "medications-중단약-a8c38b7f45b5-removed")
        self.assertEqual(by_label["추가약2"]["id"], "medications-추가약2-b9fb21f19138-added")
        self.assertEqual(by_label["변경약"]["id"], "medications-변경약-e7c2791131b4-modified")
        self.assertEqual(by_label["추가약"]["id"], "medications-추가약-93b870a256d3-added")
        self.assertEqual(
            by_label["중단약"]["previousValue"],
            {"name": "중단약", "route": "IV", "frequency": "BID"},
        )
        self.assertIsNone(by_label["중단약"]["currentValue"])
        self.assertIsNone(by_label["추가약2"]["previousValue"])
        self.assertEqual(
            by_label["추가약2"]["currentValue"],
            {"name": "추가약2", "route": "PO", "frequency": "Q8H"},
        )
        self.assertEqual(
            by_label["변경약"]["previousValue"],
            {"name": "변경약", "route": "PO", "frequency": "QD"},
        )
        self.assertEqual(
            by_label["변경약"]["currentValue"],
            {"name": "변경약", "route": "IV", "frequency": "BID"},
        )
        self.assertIsNone(by_label["추가약"]["previousValue"])
        self.assertEqual(
            by_label["추가약"]["currentValue"],
            {"name": "추가약", "route": "SC", "frequency": "HS"},
        )
        for change in medication_changes:
            self.assertEqual(change["reviewPriority"], "high")
            self.assertEqual(change["category"], "medications")
            item = change["label"]
            self.assertEqual(change["evidence"], {
                "fieldPath": f'medications["{item}"]',
                "previousRecordedAt": "2026-07-02T07:00:00+09:00",
                "currentRecordedAt": "2026-07-02T09:00:00+09:00",
            })

    def test_arbitrary_unicode_items_have_unique_ids_and_encoded_evidence_paths(self):
        previous = _record(medications=[], diagnosis=["기존 진단"], notes=["기존 메모"])
        current = _record(
            medications=[
                {"name": "A B", "route": "PO", "frequency": "QD"},
                {"name": "A-B", "route": "PO", "frequency": "QD"},
            ],
            diagnosis=["기존 진단", "추가 진단"],
            notes=["기존 메모", "메모.슬래시/값"],
            updated_at="2026-07-02T09:00:00+09:00",
        )

        changes = build_handover_comparison(previous, current)["changes"]
        medication_changes = [
            change for change in changes if change["category"] == "medications"
        ]

        self.assertEqual(
            [change["id"] for change in medication_changes],
            [
                "medications-a-b-77101aaa54e6-added",
                "medications-a-b-fea4c5ce720c-added",
            ],
        )
        self.assertEqual(len({change["id"] for change in medication_changes}), 2)
        self.assertEqual(
            [change["evidence"]["fieldPath"] for change in medication_changes],
            ['medications["A-B"]', 'medications["A B"]'],
        )
        note_changes = [change for change in changes if change["category"] == "notes"]
        self.assertEqual(len(note_changes), 1)
        self.assertEqual(note_changes[0]["id"], "notes-메모-슬래시-값-b35173899401-added")
        self.assertEqual(note_changes[0]["evidence"]["fieldPath"], 'notes["메모.슬래시/값"]')
        self.assertEqual(
            [change["evidence"]["previousRecordedAt"] for change in changes],
            ["2026-07-02T07:00:00+09:00"] * len(changes),
        )
        self.assertEqual(
            [change["evidence"]["currentRecordedAt"] for change in changes],
            ["2026-07-02T09:00:00+09:00"] * len(changes),
        )

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
        by_type = {change["changeType"]: change for change in changes}
        self.assertEqual(by_type["added"]["id"], "diagnosis-추가-진단-61e7083d07c0-added")
        self.assertEqual(by_type["removed"]["id"], "diagnosis-삭제-진단-2db7ae149f9d-removed")
        self.assertEqual(by_type["added"]["evidence"], {
            "fieldPath": 'diagnosis["추가 진단"]',
            "previousRecordedAt": "2026-07-02T07:00:00+09:00",
            "currentRecordedAt": "2026-07-02T09:00:00+09:00",
        })
        self.assertEqual(by_type["removed"]["evidence"], {
            "fieldPath": 'diagnosis["삭제 진단"]',
            "previousRecordedAt": "2026-07-02T07:00:00+09:00",
            "currentRecordedAt": "2026-07-02T09:00:00+09:00",
        })

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
        by_type = {change["changeType"]: change for change in changes}
        self.assertEqual(by_type["added"]["id"], "notes-추가-메모-21e92115633d-added")
        self.assertEqual(by_type["removed"]["id"], "notes-삭제-메모-30d354f47cb9-removed")
        self.assertEqual(by_type["added"]["evidence"], {
            "fieldPath": 'notes["추가 메모"]',
            "previousRecordedAt": "2026-07-02T07:00:00+09:00",
            "currentRecordedAt": "2026-07-02T09:00:00+09:00",
        })
        self.assertEqual(by_type["removed"]["evidence"], {
            "fieldPath": 'notes["삭제 메모"]',
            "previousRecordedAt": "2026-07-02T07:00:00+09:00",
            "currentRecordedAt": "2026-07-02T09:00:00+09:00",
        })

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

    def test_deterministic_summary_renders_added_medication_without_serialized_object(self):
        previous = _record(medications=[])
        current = _record(
            medications=[
                {"name": "타세놀정 500mg", "route": "PO", "frequency": "TID"}
            ],
        )

        comparison = build_handover_comparison(previous, current)
        summary = build_deterministic_summary(comparison)

        self.assertEqual(
            summary["sections"]["background"],
            [
                {
                    "text": "투약 추가: 타세놀정 500mg · PO · TID",
                    "evidenceIds": [
                        "medications-타세놀정-500mg-3abed59ec690-added"
                    ],
                }
            ],
        )
        medication_text = summary["sections"]["background"][0]["text"]
        for forbidden in ("{", "}", '"name"', '"route"', '"frequency"'):
            self.assertNotIn(forbidden, medication_text)

    def test_deterministic_summary_renders_removed_medication_with_source_facts(self):
        previous = _record(
            medications=[
                {"name": "타세놀정 500mg", "route": "PO", "frequency": "TID"}
            ],
        )
        current = _record(medications=[])

        comparison = build_handover_comparison(previous, current)
        summary = build_deterministic_summary(comparison)

        self.assertEqual(
            summary["sections"]["background"],
            [
                {
                    "text": "투약 중단: 타세놀정 500mg · PO · TID",
                    "evidenceIds": [
                        "medications-타세놀정-500mg-3abed59ec690-removed"
                    ],
                }
            ],
        )
        medication_text = summary["sections"]["background"][0]["text"]
        for fact in ("타세놀정 500mg", "PO", "TID"):
            self.assertIn(fact, medication_text)
        for forbidden in ("{", "}", '"name"', '"route"', '"frequency"'):
            self.assertNotIn(forbidden, medication_text)

    def test_deterministic_summary_renders_modified_medication_before_and_after(self):
        previous = _record(
            medications=[
                {"name": "타세놀정 500mg", "route": "PO", "frequency": "QD"}
            ],
        )
        current = _record(
            medications=[
                {"name": "타세놀정 500mg", "route": "IV", "frequency": "BID"}
            ],
        )

        comparison = build_handover_comparison(previous, current)
        summary = build_deterministic_summary(comparison)

        self.assertEqual(
            summary["sections"]["background"],
            [
                {
                    "text": (
                        "투약 변경: 타세놀정 500mg · PO · QD"
                        " -> 타세놀정 500mg · IV · BID"
                    ),
                    "evidenceIds": [
                        "medications-타세놀정-500mg-3abed59ec690-modified"
                    ],
                }
            ],
        )
        medication_text = summary["sections"]["background"][0]["text"]
        for fact in ("타세놀정 500mg", "PO", "QD", "IV", "BID"):
            self.assertIn(fact, medication_text)
        for forbidden in ("{", "}", '"name"', '"route"', '"frequency"'):
            self.assertNotIn(forbidden, medication_text)

    def test_deterministic_summary_keeps_non_medication_removals_as_deletions(self):
        previous = _record(diagnosis=["삭제 진단"], notes=["삭제 메모"])
        current = _record(diagnosis=[], notes=[])

        comparison = build_handover_comparison(previous, current)
        summary = build_deterministic_summary(comparison)

        self.assertEqual(
            summary["sections"]["background"],
            [
                {
                    "text": "진단 삭제: 삭제 진단",
                    "evidenceIds": [
                        "diagnosis-삭제-진단-2db7ae149f9d-removed"
                    ],
                }
            ],
        )
        self.assertEqual(
            summary["sections"]["assessment"],
            [
                {
                    "text": "간호 메모 삭제: 삭제 메모",
                    "evidenceIds": [
                        "notes-삭제-메모-30d354f47cb9-removed"
                    ],
                }
            ],
        )

    def test_deterministic_summary_preserves_falsey_medication_fields(self):
        previous = _record(medications=[])
        current = _record(
            medications=[
                {"name": "경계 처방", "route": 0, "frequency": False}
            ],
        )

        comparison = build_handover_comparison(previous, current)
        summary = build_deterministic_summary(comparison)

        self.assertEqual(
            summary["sections"]["background"][0]["text"],
            "투약 추가: 경계 처방 · 0 · False",
        )

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

    def test_legacy_projection_sorts_raw_medication_labels_before_hashed_ids(self):
        previous = _record(medications=[])
        current = _record(
            medications=[
                {"name": "A B", "route": "PO", "frequency": "QD"},
                {"name": "A-B", "route": "PO", "frequency": "QD"},
            ]
        )

        self.assertEqual(
            detect_changes(previous, current),
            [
                "투약 추가: A B (PO, QD)",
                "투약 추가: A-B (PO, QD)",
            ],
        )


if __name__ == "__main__":
    unittest.main()
