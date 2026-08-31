from __future__ import annotations

from copy import deepcopy
import json
from pathlib import Path
import unittest

from services.handover_period_service import (
    build_deterministic_period_summary,
    build_handover_period_comparison,
)


ROOT = Path(__file__).resolve().parents[1]


def load_timeline(patient_id: str) -> dict:
    with (ROOT / "data" / "timelines" / f"{patient_id}.json").open(
        encoding="utf-8"
    ) as handle:
        return json.load(handle)


def _record(
    *,
    patient_id: str = "P001",
    updated_at: str = "2026-06-29T15:00:00+09:00",
    diagnosis: list[str] | None = None,
    medications: list[dict] | None = None,
    vitals: dict | None = None,
    notes: list[str] | None = None,
) -> dict:
    return {
        "patient_id": patient_id,
        "name": "가상 환자",
        "room_no": "101",
        "age": 50,
        "sex": "F",
        "diagnosis": diagnosis if diagnosis is not None else ["기존 진단"],
        "vitals": vitals
        if vitals is not None
        else {
            "systolic": 120,
            "diastolic": 80,
            "heartrate": 72,
            "respiratory": 16,
            "saturation": 98,
            "body_temperature": 36.7,
        },
        "medications": medications
        if medications is not None
        else [{"name": "기존 약", "route": "PO", "frequency": "QD"}],
        "notes": notes if notes is not None else ["기존 메모"],
        "updated_at": updated_at,
    }


class HandoverPeriodValidationTests(unittest.TestCase):
    def test_sorts_input_but_rejects_duplicate_timestamps(self):
        later = _record(updated_at="2026-06-29T23:00:00+09:00")
        earlier = _record(updated_at="2026-06-29T15:00:00+09:00")

        result = build_handover_period_comparison(
            [later, earlier],
            "2026-06-29T15:00:00+09:00",
        )

        self.assertEqual(result["period"]["baselineRecordedAt"], earlier["updated_at"])
        self.assertEqual(result["period"]["currentRecordedAt"], later["updated_at"])
        self.assertEqual(result["period"]["snapshotCount"], 2)
        self.assertEqual(result["period"]["status"], "no_events")

        duplicate = deepcopy(earlier)
        duplicate["name"] = "다른 표시명"
        with self.assertRaisesRegex(
            ValueError,
            r"^duplicate snapshot timestamps are not allowed$",
        ):
            build_handover_period_comparison(
                [earlier, duplicate, later],
                "2026-06-29T15:00:00+09:00",
            )

    def test_rejects_mixed_patient_identity_and_naive_iso_timestamp(self):
        with self.assertRaisesRegex(
            ValueError,
            r"^all records must belong to the same patient$",
        ):
            build_handover_period_comparison(
                [
                    _record(patient_id="P001"),
                    _record(
                        patient_id="P002",
                        updated_at="2026-06-29T23:00:00+09:00",
                    ),
                ],
                "2026-06-29T15:00:00+09:00",
            )

        with self.assertRaisesRegex(
            ValueError,
            r"^records\[0\]\.updated_at must be an offset-aware ISO 8601 timestamp$",
        ):
            build_handover_period_comparison(
                [_record(updated_at="2026-06-29T15:00:00")],
                "2026-06-29T15:00:00+09:00",
            )

    def test_reports_no_baseline_but_keeps_available_post_start_events(self):
        first = _record(updated_at="2026-06-29T23:00:00+09:00", medications=[])
        current = _record(
            updated_at="2026-06-30T07:00:00+09:00",
            medications=[{"name": "새 약", "route": "IV", "frequency": "QD"}],
        )

        result = build_handover_period_comparison(
            [current, first],
            "2026-06-29T15:00:00+09:00",
        )

        self.assertEqual(result["period"]["status"], "no_baseline")
        self.assertIsNone(result["period"]["baselineRecordedAt"])
        self.assertEqual(
            result["period"]["currentRecordedAt"],
            "2026-06-30T07:00:00+09:00",
        )
        self.assertEqual(result["period"]["snapshotCount"], 2)
        self.assertEqual(result["period"]["eventCount"], 1)
        self.assertEqual(result["events"][0]["detectedAt"], current["updated_at"])
        self.assertEqual(result["events"][0]["change"]["label"], "새 약")

    def test_reports_partial_only_for_explicit_coverage_gap(self):
        first = _record(updated_at="2026-06-29T15:00:00+09:00")
        current = _record(updated_at="2026-07-02T09:00:00+09:00")
        gap = {
            "from": "2026-06-30T18:00:00+09:00",
            "to": "2026-07-01T00:00:00+09:00",
            "code": "source_unavailable",
        }

        result = build_handover_period_comparison(
            [current, first],
            "2026-06-29T15:00:00+09:00",
            [gap],
        )

        self.assertEqual(result["period"]["status"], "partial")
        self.assertEqual(result["period"]["eventCount"], 0)
        self.assertTrue(result["dataWarnings"])

        no_gap_result = build_handover_period_comparison(
            [current, first],
            "2026-06-29T15:00:00+09:00",
        )
        self.assertEqual(no_gap_result["period"]["status"], "no_events")

    def test_incomplete_nested_medication_makes_period_partial_without_invalid_events(self):
        baseline = _record(
            medications=[],
            updated_at="2026-06-29T15:00:00+09:00",
        )
        current = _record(
            medications=[
                {"name": "유효 추가 약", "route": "IV", "frequency": "BID"},
                {"name": "빈도 누락 약", "route": "PO", "frequency": ""},
            ],
            updated_at="2026-06-29T23:00:00+09:00",
        )

        result = build_handover_period_comparison(
            [baseline, current],
            "2026-06-29T15:00:00+09:00",
        )

        self.assertEqual(result["period"]["status"], "partial")
        self.assertEqual(
            result["dataWarnings"],
            ["current.medications[1].frequency"],
        )
        self.assertEqual(result["period"]["eventCount"], 1)
        self.assertEqual(len(result["events"]), 1)
        event = result["events"][0]
        self.assertEqual(event["change"]["label"], "유효 추가 약")
        self.assertEqual(
            event["change"]["currentValue"],
            {"name": "유효 추가 약", "route": "IV", "frequency": "BID"},
        )
        for returned_event in result["events"]:
            for key in ("previousValue", "currentValue"):
                value = returned_event["change"][key]
                if value is not None and returned_event["change"]["category"] == "medications":
                    self.assertEqual(set(value), {"name", "route", "frequency"})
                    self.assertTrue(
                        all(
                            isinstance(value[field], str) and value[field].strip()
                            for field in value
                        )
                    )

    def test_unhashable_incomplete_medication_does_not_abort_period_comparison(self):
        baseline = _record(
            medications=[],
            updated_at="2026-06-29T15:00:00+09:00",
        )
        current = _record(
            medications=[
                {"name": ["비문자 약명"], "route": "PO", "frequency": "QD"},
                {"name": "유효 추가 약", "route": "IV", "frequency": "BID"},
            ],
            updated_at="2026-06-29T23:00:00+09:00",
        )

        result = build_handover_period_comparison(
            [baseline, current],
            "2026-06-29T15:00:00+09:00",
        )

        self.assertEqual(result["period"]["status"], "partial")
        self.assertEqual(result["dataWarnings"], ["current.medications[0].name"])
        self.assertEqual(result["period"]["eventCount"], 1)
        self.assertEqual(result["events"][0]["change"]["label"], "유효 추가 약")


class HandoverPeriodLifecycleTests(unittest.TestCase):
    def test_p001_produces_exactly_24_stable_events(self):
        timeline = load_timeline("P001")

        result = build_handover_period_comparison(
            timeline["snapshots"],
            timeline["defaultReturnStartAt"],
            timeline["coverageGaps"],
        )
        repeated = build_handover_period_comparison(
            list(reversed(timeline["snapshots"])),
            timeline["defaultReturnStartAt"],
            timeline["coverageGaps"],
        )

        self.assertEqual(24, result["period"]["eventCount"])
        self.assertEqual(24, len(result["events"]))
        self.assertEqual(result, repeated)

        for event in result["events"]:
            self.assertEqual(
                set(event), {"id", "detectedAt", "interval", "classification", "change"}
            )
            self.assertEqual(
                set(event["interval"]),
                {"previousRecordedAt", "currentRecordedAt"},
            )
            self.assertEqual(
                event["detectedAt"], event["interval"]["currentRecordedAt"]
            )
            self.assertEqual(
                set(event["change"]),
                {
                    "id",
                    "category",
                    "changeType",
                    "reviewPriority",
                    "label",
                    "previousValue",
                    "currentValue",
                    "delta",
                    "evidence",
                },
            )

    def test_transient_saline_add_and_remove_are_period_only(self):
        baseline = _record(
            updated_at="2026-06-29T15:00:00+09:00",
            medications=[],
        )
        added = _record(
            updated_at="2026-06-29T23:00:00+09:00",
            medications=[
                {"name": "생리식염주 500mL", "route": "IV", "frequency": "QD"}
            ],
        )
        removed = _record(
            updated_at="2026-06-30T07:00:00+09:00",
            medications=[],
        )

        result = build_handover_period_comparison(
            [removed, added, baseline],
            "2026-06-29T15:00:00+09:00",
        )
        saline_events = [
            event
            for event in result["events"]
            if event["change"]["label"] == "생리식염주 500mL"
        ]
        saline_events.sort(key=lambda event: event["detectedAt"])

        self.assertEqual([event["change"]["changeType"] for event in saline_events], [
            "added",
            "removed",
        ])
        self.assertTrue(
            all(event["classification"] == "period_only" for event in saline_events)
        )
        self.assertEqual(
            saline_events[0]["id"],
            "event:P001:medications:생리식염주-500mL:2026-06-29T23:00:00+09:00:added",
        )
        self.assertEqual(
            saline_events[0]["interval"],
            {
                "previousRecordedAt": "2026-06-29T15:00:00+09:00",
                "currentRecordedAt": "2026-06-29T23:00:00+09:00",
            },
        )
        self.assertEqual(
            saline_events[0]["change"],
            {
                "id": "medications-생리식염주-500ml-51e5191a00a4-added",
                "category": "medications",
                "changeType": "added",
                "reviewPriority": "high",
                "label": "생리식염주 500mL",
                "previousValue": None,
                "currentValue": {
                    "name": "생리식염주 500mL",
                    "route": "IV",
                    "frequency": "QD",
                },
                "delta": None,
                "evidence": {
                    "fieldPath": 'medications["생리식염주 500mL"]',
                    "previousRecordedAt": "2026-06-29T15:00:00+09:00",
                    "currentRecordedAt": "2026-06-29T23:00:00+09:00",
                },
            },
        )

    def test_reverted_ibuprofen_frequency_keeps_each_event_and_links_history(self):
        baseline = _record(
            medications=[{"name": "이부프로펜", "route": "PO", "frequency": "BID"}],
            updated_at="2026-06-29T15:00:00+09:00",
        )
        changed = _record(
            medications=[{"name": "이부프로펜", "route": "PO", "frequency": "TID"}],
            updated_at="2026-06-29T23:00:00+09:00",
        )
        reverted = _record(
            medications=[{"name": "이부프로펜", "route": "PO", "frequency": "BID"}],
            updated_at="2026-06-30T07:00:00+09:00",
        )

        result = build_handover_period_comparison(
            [reverted, baseline, changed],
            "2026-06-29T15:00:00+09:00",
        )
        events = [
            event
            for event in result["events"]
            if event["change"]["label"] == "이부프로펜"
        ]
        events.sort(key=lambda event: event["detectedAt"])
        group = next(
            item
            for item in result["reviewGroups"]["periodOnly"]
            if item["label"] == "이부프로펜"
        )

        self.assertEqual(len(events), 2)
        self.assertEqual(
            [event["change"]["currentValue"]["frequency"] for event in events],
            ["TID", "BID"],
        )
        self.assertTrue(all(event["classification"] == "period_only" for event in events))
        self.assertEqual(group["eventIds"], [event["id"] for event in events])
        self.assertEqual(
            {
                event["interval"]["previousRecordedAt"] for event in events
            },
            {
                "2026-06-29T15:00:00+09:00",
                "2026-06-29T23:00:00+09:00",
            },
        )

    def test_current_removed_item_is_classified_current(self):
        baseline = _record(
            diagnosis=["유지 진단", "삭제 진단"],
            medications=[
                {"name": "중단 약", "route": "IV", "frequency": "QD"},
            ],
            updated_at="2026-06-29T15:00:00+09:00",
        )
        current = _record(
            diagnosis=["유지 진단"],
            medications=[],
            updated_at="2026-06-30T07:00:00+09:00",
        )

        result = build_handover_period_comparison(
            [current, baseline],
            "2026-06-29T15:00:00+09:00",
        )
        removed = [
            event
            for event in result["events"]
            if event["change"]["changeType"] == "removed"
        ]

        self.assertEqual(len(removed), 2)
        self.assertTrue(all(event["classification"] == "current" for event in removed))
        self.assertEqual(
            {item["label"] for item in result["reviewGroups"]["current"]},
            {"삭제 진단", "중단 약"},
        )
        self.assertFalse(result["reviewGroups"]["periodOnly"])

    def test_review_items_reference_existing_event_ids_only(self):
        timeline = load_timeline("P001")
        result = build_handover_period_comparison(
            timeline["snapshots"],
            timeline["defaultReturnStartAt"],
            timeline["coverageGaps"],
        )
        event_ids = {event["id"] for event in result["events"]}

        self.assertEqual(
            set(result["reviewGroups"]),
            {"current", "periodOnly", "trends", "recordEvents"},
        )
        for group_name, items in result["reviewGroups"].items():
            with self.subTest(group=group_name):
                for item in items:
                    self.assertEqual(
                        set(item), {"id", "category", "label", "classification", "eventIds"}
                    )
                    self.assertTrue(item["eventIds"])
                    self.assertTrue(set(item["eventIds"]).issubset(event_ids))
                    self.assertIn(
                        item["classification"],
                        {"current", "period_only", "trend", "record_event"},
                    )

        grouped_ids = [
            event_id
            for items in result["reviewGroups"].values()
            for item in items
            for event_id in item["eventIds"]
        ]
        self.assertEqual(sorted(grouped_ids), sorted(event_ids))


class DeterministicPeriodSummaryTests(unittest.TestCase):
    def test_period_only_summary_uses_neutral_change_wording(self):
        timeline = load_timeline("P001")
        comparison = build_handover_period_comparison(
            timeline["snapshots"],
            timeline["defaultReturnStartAt"],
            timeline["coverageGaps"],
        )

        summary = build_deterministic_period_summary(comparison)
        summary_text = " ".join(
            item["text"]
            for items in summary["sections"].values()
            for item in items
        )

        self.assertIn("기간 중 변경", summary_text)
        self.assertNotIn("기간 중 종료", summary_text)

    def test_summary_is_deterministic_sbar_and_every_detail_item_has_event_ids(self):
        timeline = load_timeline("P001")
        comparison = build_handover_period_comparison(
            timeline["snapshots"],
            timeline["defaultReturnStartAt"],
            timeline["coverageGaps"],
        )

        summary = build_deterministic_period_summary(comparison)
        event_ids = [event["id"] for event in comparison["events"]]

        self.assertEqual(set(summary), {"mode", "sections", "evidenceIds", "warnings"})
        self.assertEqual(summary["mode"], "deterministic")
        self.assertEqual(
            set(summary["sections"]),
            {"situation", "background", "assessment", "recommendation"},
        )
        self.assertEqual(summary["evidenceIds"], event_ids)
        self.assertEqual(
            summary["sections"]["recommendation"],
            [{"text": "간호사가 확인할 후속 항목을 입력하세요.", "evidenceIds": []}],
        )
        self.assertIn("홍길동", summary["sections"]["situation"][0]["text"])
        self.assertIn("301호", summary["sections"]["situation"][0]["text"])
        self.assertIn("24", summary["sections"]["situation"][0]["text"])
        self.assertIn("2026-06-29T15:00:00+09:00", summary["sections"]["situation"][0]["text"])
        self.assertIn("2026-07-02T09:00:00+09:00", summary["sections"]["situation"][0]["text"])

        for section_name in ("situation", "background", "assessment", "recommendation"):
            for item in summary["sections"][section_name]:
                self.assertEqual(set(item), {"text", "evidenceIds"})
                self.assertIsInstance(item["text"], str)
                self.assertTrue(set(item["evidenceIds"]).issubset(set(event_ids)))

        self.assertTrue(summary["sections"]["background"])
        self.assertTrue(summary["sections"]["assessment"])
        self.assertEqual(
            summary["warnings"], comparison["dataWarnings"]
        )


if __name__ == "__main__":
    unittest.main()
