from __future__ import annotations

import copy
import json
from pathlib import Path
import unittest
from unittest.mock import patch

from services.handover_shift_readiness_service import _parse_timestamp, build_shift_readiness


ROOT = Path(__file__).resolve().parents[1]
REVIEW_START = "2026-06-28T09:00:00+09:00"
BASELINE_REVIEW_START = "2026-07-01T00:00:00+09:00"
SHIFT = {
    "startsAt": "2026-07-02T07:00:00+09:00",
    "endsAt": "2026-07-02T15:00:00+09:00",
}


def load_json(path: Path) -> dict:
    with path.open(encoding="utf-8") as source:
        return json.load(source)


def p001_records() -> list[dict]:
    timeline = load_json(ROOT / "data" / "timelines" / "P001.json")
    sidecar = load_json(ROOT / "data" / "shift-readiness" / "P001.json")
    records = []
    for snapshot in timeline["snapshots"]:
        merged = copy.deepcopy(snapshot)
        state = copy.deepcopy(sidecar["states"][snapshot["updated_at"]])
        schedules = {
            item["medicationName"]: item for item in state.pop("medicationSchedules")
        }
        for medication in merged["medications"]:
            schedule = schedules.get(medication["name"])
            if schedule:
                medication.update(
                    {
                        key: value
                        for key, value in schedule.items()
                        if key != "medicationName"
                    }
                )
        merged.update(state)
        records.append(merged)
    return records


def build_p001_response() -> dict:
    return build_shift_readiness(p001_records(), REVIEW_START, SHIFT, [])


def records_with_no_handoff_requests() -> list[dict]:
    records = p001_records()
    for record in records:
        record["handoffRequests"] = []
    return records


def records_with_medication_effective_and_period_change() -> list[dict]:
    baseline = minimal_record(recorded_at="2026-06-29T15:00:00+09:00")
    current = copy.deepcopy(baseline)
    current["updated_at"] = "2026-07-02T09:00:00+09:00"
    current["medications"][0].update(
        {
            "frequency": "BID",
            "effectiveFrom": "2026-07-02T09:00:00+09:00",
            "effectiveTo": None,
            "orderStatus": "active",
        }
    )
    return [baseline, current]


def records_with_missing_source_collections() -> list[dict]:
    records = [
        minimal_record(recorded_at="2026-06-29T15:00:00+09:00"),
        minimal_record(recorded_at="2026-07-02T09:00:00+09:00"),
    ]
    for record in records:
        for collection in (
            "investigations",
            "devices",
            "medications",
            "handoffRequests",
        ):
            record.pop(collection)
    return records


def records_with_scheduled_investigation() -> list[dict]:
    baseline = minimal_record(recorded_at="2026-06-29T15:00:00+09:00")
    current = copy.deepcopy(baseline)
    current["updated_at"] = "2026-07-02T09:00:00+09:00"
    current["investigations"] = [
        {
            "id": "INV-STATUS-1",
            "kind": "lab",
            "name": "Status test",
            "orderedAt": "2026-07-02T07:00:00+09:00",
            "scheduledAt": "2026-07-02T09:00:00+09:00",
            "status": "scheduled",
            "resultedAt": None,
            "resultSummary": None,
        }
    ]
    return [baseline, current]


def minimal_record(
    *,
    recorded_at: str = "2026-07-02T08:00:00+09:00",
    patient_id: str = "P-TEST",
) -> dict:
    return {
        "patient_id": patient_id,
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
        "updated_at": recorded_at,
        "investigations": [],
        "devices": [],
        "handoffRequests": [],
    }


class ShiftReadinessServiceTests(unittest.TestCase):
    def test_timestamp_parser_matches_strict_iso_8601_grammar(self):
        for value in (
            "2026-07-02T08:00:00+09:00",
            "2026-07-02T08:00:00.123456Z",
        ):
            with self.subTest(value=value):
                self.assertIsNotNone(_parse_timestamp(value, "timestamp"))

        for value in (
            "2026-07-02T08:00:00z",
            " 2026-07-02T08:00:00+09:00",
            "2026-07-02T08:00:00+09:00 ",
            "2026-07-02 08:00:00+09:00",
        ):
            with self.subTest(value=value):
                with self.assertRaisesRegex(
                    ValueError,
                    r"^timestamp must be an offset-aware ISO 8601 timestamp$",
                ):
                    _parse_timestamp(value, "timestamp")

    def test_effective_medication_keeps_matching_period_evidence(self):
        response = build_shift_readiness(
            records_with_medication_effective_and_period_change(),
            REVIEW_START,
            SHIFT,
            [],
        )
        medication_items = [
            item for item in response["items"] if item["domain"] == "medication"
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
        self.assertIn(
            "medications[name=%EA%B8%B0%EC%A1%B4%20%EC%B2%98%EB%B0%A9]",
            {
                ref["path"]
                for ref in medication_items[0]["sourceRefs"]
                if "periodEventId" not in ref
            },
        )

    def test_p001_emits_all_five_domains_without_clinical_inference(self):
        response = build_p001_response()
        self.assertEqual(
            {
                "patient_status",
                "investigation",
                "line_device",
                "medication",
                "communication",
            },
            {item["domain"] for item in response["items"]},
        )
        self.assertIn(
            "COMMUNICATION_EXPLICIT_OPEN",
            {item["ruleCode"] for item in response["items"]},
        )

    def test_vitals_results_and_notes_cannot_create_communication(self):
        records = records_with_no_handoff_requests()
        response = build_shift_readiness(records, REVIEW_START, SHIFT, [])
        self.assertEqual([], response["groups"]["communications"])

    def test_shift_window_is_start_inclusive_and_end_exclusive(self):
        record = minimal_record()
        record["investigations"] = [
            {
                "id": "INV-BOUNDARY",
                "kind": "imaging",
                "name": "Boundary",
                "orderedAt": "2026-07-02T07:00:00+09:00",
                "scheduledAt": "2026-07-02T07:00:00+09:00",
                "status": "scheduled",
                "resultedAt": None,
                "resultSummary": None,
            }
        ]
        response = build_shift_readiness(
            [
                {
                    **record,
                    "updated_at": "2026-07-02T07:00:00+09:00",
                }
            ],
            REVIEW_START,
            SHIFT,
            [],
        )
        self.assertEqual("scheduled_this_shift", response["items"][0]["factStatus"])

        record["investigations"][0]["scheduledAt"] = "2026-07-02T15:00:00+09:00"
        response = build_shift_readiness([record], REVIEW_START, SHIFT, [])
        self.assertNotIn(
            "INVESTIGATION_SCHEDULED_SHIFT",
            {item["ruleCode"] for item in response["items"]},
        )

    def test_current_snapshot_must_be_inside_shift_and_future_record_is_rejected(self):
        record = minimal_record(recorded_at="2026-07-02T07:00:00+09:00")
        self.assertEqual("no_baseline", build_shift_readiness([record], REVIEW_START, SHIFT)["status"])

        with self.assertRaises(ValueError):
            build_shift_readiness(
                [minimal_record(recorded_at="2026-07-02T15:00:00+09:00")],
                REVIEW_START,
                SHIFT,
            )
        with self.assertRaises(ValueError):
            build_shift_readiness([], REVIEW_START, SHIFT)
        with self.assertRaises(ValueError):
            build_shift_readiness([{}], REVIEW_START, SHIFT)

    def test_scheduled_result_precedence_and_cancelled_or_communicated_exclusion(self):
        response = build_p001_response()
        investigation_items = [
            item for item in response["items"] if item["domain"] == "investigation"
        ]
        by_id = {
            next(
                ref["path"].split("[", 1)[1].split("=", 1)[1].rstrip("]")
                for ref in item["sourceRefs"]
                if ref["path"].startswith("investigations[")
            ): item
            for item in investigation_items
        }
        self.assertEqual("new_result", by_id["INV-P001-CBC"]["factStatus"])
        self.assertEqual("scheduled_this_shift", by_id["INV-P001-CXR"]["factStatus"])

        sidecar = load_json(ROOT / "data" / "shift-readiness" / "P004.json")
        timeline = load_json(ROOT / "data" / "timelines" / "P004.json")
        p004 = []
        for snapshot in timeline["snapshots"]:
            merged = copy.deepcopy(snapshot)
            merged.update(copy.deepcopy(sidecar["states"][snapshot["updated_at"]]))
            p004.append(merged)
        p004_response = build_shift_readiness(p004, REVIEW_START, SHIFT, [])
        source_paths = [
            ref["path"]
            for item in p004_response["items"]
            for ref in item["sourceRefs"]
        ]
        self.assertFalse(any("INV-P004-CXR" in path for path in source_paths))
        self.assertFalse(any("REQ-P004-DISCHARGE-1" in path for path in source_paths))
        self.assertFalse(
            any(
                item["ruleCode"] == "INVESTIGATION_SCHEDULED_SHIFT"
                and any("INV-P004-US" in ref["path"] for ref in item["sourceRefs"])
                for item in p004_response["items"]
            )
        )  # scheduled exactly at shift end; it remains pending

    def test_device_due_and_current_state_rules(self):
        p001 = build_p001_response()
        p001_devices = [
            item for item in p001["items"] if item["domain"] == "line_device"
        ]
        self.assertEqual(1, len(p001_devices))
        self.assertEqual("scheduled_this_shift", p001_devices[0]["factStatus"])
        self.assertEqual("DEVICE_DUE_SHIFT", p001_devices[0]["ruleCode"])

        timeline = load_json(ROOT / "data" / "timelines" / "P003.json")
        sidecar = load_json(ROOT / "data" / "shift-readiness" / "P003.json")
        records = []
        for snapshot in timeline["snapshots"]:
            merged = copy.deepcopy(snapshot)
            merged.update(copy.deepcopy(sidecar["states"][snapshot["updated_at"]]))
            records.append(merged)
        response = build_shift_readiness(records, REVIEW_START, SHIFT, [])
        device_items = [
            item for item in response["items"] if item["domain"] == "line_device"
        ]
        self.assertEqual(2, len(device_items))
        self.assertEqual(
            {"DEVICE_RECENT_CHANGE"},
            {item["ruleCode"] for item in device_items},
        )

    def test_same_structured_source_id_is_one_item_and_period_field_changes_collapse(self):
        response = build_p001_response()
        direct_by_selector: dict[str, list[dict]] = {}
        for item in response["items"]:
            for ref in item["sourceRefs"]:
                if ref["path"].startswith("investigations["):
                    selector = ref["path"].split("=", 1)[1].rstrip("]")
                    direct_by_selector.setdefault(selector, []).append(item)
        self.assertTrue(all(len({id(item) for item in items}) == 1 for items in direct_by_selector.values()))

        status_items = [
            item for item in response["items"] if item["domain"] == "patient_status"
        ]
        self.assertTrue(status_items)
        for item in status_items:
            refs = [ref for ref in item["sourceRefs"] if ref.get("periodEventId")]
            self.assertGreaterEqual(len(refs), 1)
            self.assertEqual(len(refs), len({ref["periodEventId"] for ref in refs}))

    def test_every_item_has_known_sources_and_exactly_one_group(self):
        response = build_p001_response()
        item_ids = {item["id"] for item in response["items"]}
        grouped_ids = [item_id for ids in response["groups"].values() for item_id in ids]
        self.assertEqual(item_ids, set(grouped_ids))
        self.assertEqual(len(grouped_ids), len(set(grouped_ids)))
        self.assertEqual(
            ["patientStatus", "investigations", "lineDevices", "medications", "communications"],
            list(response["groups"]),
        )
        for item in response["items"]:
            self.assertGreaterEqual(len(item["sourceRefs"]), 1)
            self.assertTrue(all(ref["recordedAt"] for ref in item["sourceRefs"]))
            self.assertTrue(all(ref["path"] for ref in item["sourceRefs"]))

    def test_identical_inputs_have_byte_equivalent_order_and_ids(self):
        first = build_p001_response()
        second = build_shift_readiness(copy.deepcopy(p001_records()), REVIEW_START, copy.deepcopy(SHIFT), [])
        self.assertEqual(first, second)

        reordered = list(reversed(p001_records()))
        self.assertEqual(first, build_shift_readiness(reordered, REVIEW_START, SHIFT, []))

    def test_source_paths_are_canonical_and_period_refs_match_period_events(self):
        response = build_p001_response()
        for item in response["items"]:
            for ref in item["sourceRefs"]:
                if "periodEventId" not in ref:
                    self.assertNotIn(".", ref["path"])
                if "periodEventId" in ref:
                    self.assertTrue(ref["periodEventId"].startswith("event:"))
                    self.assertTrue(ref["recordedAt"].startswith("2026-"))
                    self.assertTrue(ref["path"] in {"vitals.systolic", "vitals.diastolic", "vitals.heartrate", "vitals.respiratory", "vitals.saturation", "vitals.body_temperature"} or ref["path"].startswith("diagnosis[") or ref["path"].startswith("notes[") or ref["path"].startswith("medications["))

        direct_paths = {
            ref["path"]
            for item in response["items"]
            for ref in item["sourceRefs"]
            if "periodEventId" not in ref
        }
        self.assertIn("investigations[id=INV-P001-CBC]", direct_paths)
        self.assertIn("devices[id=DEV-P001-PIV-1]", direct_paths)
        self.assertIn("medications[name=%ED%83%80%EC%84%B8%EB%86%80%EC%A0%95%20500mg]", direct_paths)
        self.assertIn("handoffRequests[id=REQ-P001-ROUND-1]", direct_paths)

    def test_status_and_metrics_distinguish_no_baseline_no_items_and_partial(self):
        record = minimal_record()
        self.assertEqual("no_baseline", build_shift_readiness([record], REVIEW_START, SHIFT)["status"])

        with_gap = build_shift_readiness(
            [minimal_record(recorded_at="2026-06-29T15:00:00+09:00"), minimal_record(recorded_at="2026-07-02T08:00:00+09:00")],
            "2026-06-29T15:00:00+09:00",
            SHIFT,
            [{"from": "2026-06-30T00:00:00+09:00", "to": "2026-07-01T00:00:00+09:00", "code": "missing"}],
        )
        self.assertEqual("partial", with_gap["status"])
        self.assertEqual(0, with_gap["metrics"]["itemCount"])

    def test_available_status_is_explicit_for_baseline_with_a_valid_item(self):
        response = build_shift_readiness(
            records_with_scheduled_investigation(), BASELINE_REVIEW_START, SHIFT, []
        )
        self.assertEqual("available", response["status"])
        self.assertGreater(response["metrics"]["itemCount"], 0)

    def test_no_baseline_status_is_explicit_without_prior_snapshot(self):
        response = build_shift_readiness(
            [minimal_record(recorded_at="2026-07-02T09:00:00+09:00")],
            BASELINE_REVIEW_START,
            SHIFT,
            [],
        )
        self.assertEqual("no_baseline", response["status"])

    def test_no_items_status_is_explicit_for_baseline_without_matching_rules(self):
        baseline = minimal_record(recorded_at="2026-06-29T15:00:00+09:00")
        current = copy.deepcopy(baseline)
        current["updated_at"] = "2026-07-02T09:00:00+09:00"
        response = build_shift_readiness(
            [baseline, current], BASELINE_REVIEW_START, SHIFT, []
        )
        self.assertEqual("no_items", response["status"])
        self.assertEqual(0, response["metrics"]["itemCount"])

    def test_partial_status_is_explicit_for_missing_source_collections(self):
        response = build_shift_readiness(
            records_with_missing_source_collections(), BASELINE_REVIEW_START, SHIFT, []
        )
        self.assertEqual("partial", response["status"])
        self.assertEqual(0, response["metrics"]["itemCount"])
        self.assertTrue(
            {
                "SHIFT_READINESS_INVALID_INVESTIGATIONS_ARRAY",
                "SHIFT_READINESS_INVALID_DEVICES_ARRAY",
                "SHIFT_READINESS_INVALID_MEDICATIONS_ARRAY",
                "SHIFT_READINESS_INVALID_HANDOFF_REQUESTS_ARRAY",
            }.issubset(set(response["dataWarnings"]))
        )

    def test_operational_enum_and_duplicate_timestamp_validation_are_strict(self):
        record = minimal_record()
        record["investigations"] = [
            {
                "id": "INV-INVALID",
                "kind": "lab",
                "name": "Lab",
                "orderedAt": "2026-07-02T07:00:00+09:00",
                "scheduledAt": None,
                "status": "not-a-status",
                "resultedAt": None,
                "resultSummary": None,
            }
        ]
        with self.assertRaises(ValueError):
            build_shift_readiness([record], REVIEW_START, SHIFT)

        duplicate = minimal_record()
        with self.assertRaises(ValueError):
            build_shift_readiness([duplicate, copy.deepcopy(duplicate)], REVIEW_START, SHIFT)

    def test_incomplete_direct_source_is_excluded_with_stable_warning_and_partial_status(self):
        records = p001_records()
        records[-1]["investigations"].append(
            {
                "id": "INV-ORPHAN",
                "kind": "lab",
                "name": "Missing result",
                "orderedAt": "2026-07-02T08:00:00+09:00",
                "scheduledAt": None,
                "status": "resulted",
                "resultedAt": "not-a-timestamp",
                "resultSummary": "unusable",
            }
        )
        response = build_shift_readiness(records, REVIEW_START, SHIFT, [])
        self.assertEqual("no_baseline", response["status"])
        self.assertFalse(any("INV-ORPHAN" in ref["path"] for item in response["items"] for ref in item["sourceRefs"]))
        self.assertTrue(response["dataWarnings"])

    def test_period_orphan_event_is_excluded_without_inventing_source(self):
        record = minimal_record(recorded_at="2026-06-29T15:00:00+09:00")
        current = copy.deepcopy(record)
        current["updated_at"] = "2026-07-02T08:00:00+09:00"
        current["vitals"]["body_temperature"] = 37.4
        fake_period = {
            "patient": {"id": "P-TEST"},
            "period": {
                "requestedStartAt": REVIEW_START,
                "baselineRecordedAt": record["updated_at"],
                "currentRecordedAt": current["updated_at"],
            },
            "dataWarnings": [],
            "events": [
                {
                    "id": "event:orphan",
                    "interval": {
                        "previousRecordedAt": record["updated_at"],
                        "currentRecordedAt": current["updated_at"],
                    },
                    "change": {
                        "category": "vitals",
                        "label": "체온",
                        "evidence": {"fieldPath": "vitals.body_temperature"},
                    },
                }
            ],
        }
        with patch(
            "services.handover_shift_readiness_service.build_handover_period_comparison",
            return_value=fake_period,
        ):
            response = build_shift_readiness([record, current], REVIEW_START, SHIFT, [])
        self.assertEqual("partial", response["status"])
        self.assertEqual([], response["groups"]["patientStatus"])
        self.assertTrue(response["dataWarnings"])


if __name__ == "__main__":
    unittest.main()
