import json
import re
import unittest
from datetime import datetime
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
TIMELINE_DIR = ROOT / "data" / "timelines"
READINESS_DIR = ROOT / "data" / "shift-readiness"
PATIENT_IDS = tuple(f"P{index:03d}" for index in range(1, 6))


def load_json(path: Path) -> dict:
    with path.open(encoding="utf-8") as source:
        return json.load(source)


def parse_iso(value: str) -> datetime:
    parsed = datetime.fromisoformat(value)
    if parsed.utcoffset() is None:
        raise AssertionError(f"offset-aware timestamp required: {value}")
    return parsed


TOP_LEVEL_KEYS = {"patientId", "defaultShift", "states"}
SHIFT_KEYS = {"startsAt", "endsAt"}
STATE_KEYS = {"investigations", "devices", "medicationSchedules", "handoffRequests"}
INVESTIGATION_KEYS = {
    "id",
    "kind",
    "name",
    "orderedAt",
    "scheduledAt",
    "status",
    "resultedAt",
    "resultSummary",
}
DEVICE_KEYS = {
    "id",
    "type",
    "site",
    "insertedAt",
    "changeDueAt",
    "status",
    "removedAt",
}
MEDICATION_SCHEDULE_KEYS = {
    "medicationName",
    "effectiveFrom",
    "effectiveTo",
    "orderStatus",
}
HANDOFF_REQUEST_KEYS = {
    "id",
    "topic",
    "requestedAt",
    "dueBy",
    "sourceType",
    "status",
}
INVESTIGATION_KINDS = {"lab", "imaging"}
INVESTIGATION_STATUSES = {
    "ordered",
    "scheduled",
    "in_progress",
    "resulted",
    "cancelled",
}
DEVICE_STATUSES = {"active", "removal_ordered", "removed"}
MEDICATION_ORDER_STATUSES = {"planned", "active", "stopped"}
HANDOFF_SOURCE_TYPES = {"physician_order", "nursing_note"}
HANDOFF_STATUSES = {"open", "communicated", "cancelled"}
TIMESTAMP_PATTERN = re.compile(r"(?<!\d)\d{6}[- ]?\d{7}(?!\d)")
PHONE_PATTERN = re.compile(r"(?<!\d)\d{2,3}[- ]\d{3,4}[- ]\d{4}(?!\d)")
EMAIL_PATTERN = re.compile(r"\b[^\s@]+@[^\s@]+\.[^\s@]+\b")


class ShiftReadinessFixtureTests(unittest.TestCase):
    def _sidecar_path(self, patient_id: str) -> Path:
        return READINESS_DIR / f"{patient_id}.json"

    def _load_sidecar_and_timeline(self, patient_id: str) -> tuple[dict, dict]:
        sidecar_path = self._sidecar_path(patient_id)
        self.assertTrue(
            sidecar_path.is_file(),
            f"missing Shift Readiness sidecar: {sidecar_path}",
        )
        return (
            load_json(sidecar_path),
            load_json(TIMELINE_DIR / f"{patient_id}.json"),
        )

    def test_every_sidecar_matches_all_eight_timeline_timestamps(self):
        for patient_id in PATIENT_IDS:
            with self.subTest(patient_id=patient_id):
                sidecar, timeline = self._load_sidecar_and_timeline(patient_id)
                self.assertEqual(patient_id, sidecar["patientId"])
                self.assertEqual(
                    {item["updated_at"] for item in timeline["snapshots"]},
                    set(sidecar["states"]),
                )

    def test_default_shift_contains_the_current_snapshot(self):
        for patient_id in PATIENT_IDS:
            with self.subTest(patient_id=patient_id):
                sidecar, timeline = self._load_sidecar_and_timeline(patient_id)
                current = parse_iso(timeline["snapshots"][-1]["updated_at"])
                self.assertLessEqual(
                    parse_iso(sidecar["defaultShift"]["startsAt"]), current
                )
                self.assertLess(
                    current, parse_iso(sidecar["defaultShift"]["endsAt"])
                )

    def test_sidecars_have_exact_keys_and_supported_enums(self):
        for patient_id in PATIENT_IDS:
            with self.subTest(patient_id=patient_id):
                sidecar, timeline = self._load_sidecar_and_timeline(patient_id)
                self.assertEqual(TOP_LEVEL_KEYS, set(sidecar))
                self.assertEqual(SHIFT_KEYS, set(sidecar["defaultShift"]))
                parse_iso(sidecar["defaultShift"]["startsAt"])
                parse_iso(sidecar["defaultShift"]["endsAt"])
                self.assertLess(
                    parse_iso(sidecar["defaultShift"]["startsAt"]),
                    parse_iso(sidecar["defaultShift"]["endsAt"]),
                )

                snapshots = {
                    snapshot["updated_at"]: snapshot
                    for snapshot in timeline["snapshots"]
                }
                for recorded_at, state in sidecar["states"].items():
                    with self.subTest(recorded_at=recorded_at):
                        parse_iso(recorded_at)
                        self.assertEqual(STATE_KEYS, set(state))
                        self.assertEqual(
                            {"investigations", "devices", "medicationSchedules", "handoffRequests"},
                            set(state),
                        )
                        self.assertIsInstance(state["investigations"], list)
                        self.assertIsInstance(state["devices"], list)
                        self.assertIsInstance(state["medicationSchedules"], list)
                        self.assertIsInstance(state["handoffRequests"], list)

                        investigation_ids = []
                        for investigation in state["investigations"]:
                            self.assertEqual(INVESTIGATION_KEYS, set(investigation))
                            investigation_ids.append(investigation["id"])
                            self.assertIsInstance(investigation["id"], str)
                            self.assertTrue(investigation["id"])
                            self.assertIn(investigation["kind"], INVESTIGATION_KINDS)
                            self.assertIn(
                                investigation["status"], INVESTIGATION_STATUSES
                            )
                            parse_iso(investigation["orderedAt"])
                            for field in ("scheduledAt", "resultedAt"):
                                if investigation[field] is not None:
                                    parse_iso(investigation[field])
                            if investigation["resultSummary"] is not None:
                                self.assertIsInstance(
                                    investigation["resultSummary"], str
                                )
                                self.assertTrue(investigation["resultSummary"])
                        self.assertEqual(
                            len(investigation_ids), len(set(investigation_ids))
                        )

                        device_ids = []
                        for device in state["devices"]:
                            self.assertEqual(DEVICE_KEYS, set(device))
                            device_ids.append(device["id"])
                            self.assertIsInstance(device["id"], str)
                            self.assertTrue(device["id"])
                            self.assertIn(device["status"], DEVICE_STATUSES)
                            parse_iso(device["insertedAt"])
                            for field in ("changeDueAt", "removedAt"):
                                if device[field] is not None:
                                    parse_iso(device[field])
                        self.assertEqual(len(device_ids), len(set(device_ids)))

                        medication_names = []
                        available_medications = {
                            medication["name"]
                            for medication in snapshots[recorded_at]["medications"]
                        }
                        for schedule in state["medicationSchedules"]:
                            self.assertEqual(MEDICATION_SCHEDULE_KEYS, set(schedule))
                            medication_names.append(schedule["medicationName"])
                            self.assertIn(
                                schedule["medicationName"], available_medications
                            )
                            self.assertIsInstance(schedule["medicationName"], str)
                            self.assertTrue(schedule["medicationName"])
                            for field in ("effectiveFrom", "effectiveTo"):
                                if schedule[field] is not None:
                                    parse_iso(schedule[field])
                            self.assertIn(
                                schedule["orderStatus"], MEDICATION_ORDER_STATUSES
                            )
                        self.assertEqual(
                            len(medication_names), len(set(medication_names))
                        )

                        request_ids = []
                        for request in state["handoffRequests"]:
                            self.assertEqual(HANDOFF_REQUEST_KEYS, set(request))
                            request_ids.append(request["id"])
                            self.assertIsInstance(request["id"], str)
                            self.assertTrue(request["id"])
                            self.assertIsInstance(request["topic"], str)
                            self.assertTrue(request["topic"])
                            parse_iso(request["requestedAt"])
                            if request["dueBy"] is not None:
                                parse_iso(request["dueBy"])
                            self.assertIn(
                                request["sourceType"], HANDOFF_SOURCE_TYPES
                            )
                            self.assertIn(request["status"], HANDOFF_STATUSES)
                        self.assertEqual(len(request_ids), len(set(request_ids)))

    def test_all_sidecar_timestamps_and_item_times_are_offset_aware(self):
        for patient_id in PATIENT_IDS:
            with self.subTest(patient_id=patient_id):
                sidecar, _ = self._load_sidecar_and_timeline(patient_id)
                for recorded_at, state in sidecar["states"].items():
                    parse_iso(recorded_at)
                    for investigation in state["investigations"]:
                        parse_iso(investigation["orderedAt"])
                        for field in ("scheduledAt", "resultedAt"):
                            if investigation[field] is not None:
                                parse_iso(investigation[field])
                    for device in state["devices"]:
                        parse_iso(device["insertedAt"])
                        for field in ("changeDueAt", "removedAt"):
                            if device[field] is not None:
                                parse_iso(device[field])
                    for schedule in state["medicationSchedules"]:
                        for field in ("effectiveFrom", "effectiveTo"):
                            if schedule[field] is not None:
                                parse_iso(schedule[field])
                    for request in state["handoffRequests"]:
                        parse_iso(request["requestedAt"])
                        if request["dueBy"] is not None:
                            parse_iso(request["dueBy"])

    def test_sidecars_contain_no_real_person_identifier_patterns(self):
        forbidden_keys = (
            "resident_registration_number",
            "주민등록번호",
            "phone",
            "telephone",
            "email",
            "address",
            "ssn",
        )
        for patient_id in PATIENT_IDS:
            with self.subTest(patient_id=patient_id):
                sidecar_path = self._sidecar_path(patient_id)
                self.assertTrue(
                    sidecar_path.is_file(),
                    f"missing Shift Readiness sidecar: {sidecar_path}",
                )
                raw = sidecar_path.read_text(encoding="utf-8")
                lowered = raw.lower()
                for key in forbidden_keys:
                    self.assertNotIn(key.lower(), lowered)
                self.assertIsNone(PHONE_PATTERN.search(raw))
                self.assertIsNone(EMAIL_PATTERN.search(raw))
                self.assertIsNone(TIMESTAMP_PATTERN.search(raw))

    def test_p001_current_state_matches_the_binding_facts_exactly(self):
        sidecar, _ = self._load_sidecar_and_timeline("P001")
        self.assertEqual(
            {
                "investigations": [
                    {
                        "id": "INV-P001-CBC",
                        "kind": "lab",
                        "name": "CBC",
                        "orderedAt": "2026-07-01T08:00:00+09:00",
                        "scheduledAt": None,
                        "status": "resulted",
                        "resultedAt": "2026-07-02T08:20:00+09:00",
                        "resultSummary": "WBC 12.1 ×10³/μL",
                    },
                    {
                        "id": "INV-P001-CXR",
                        "kind": "imaging",
                        "name": "Chest AP",
                        "orderedAt": "2026-07-02T07:30:00+09:00",
                        "scheduledAt": "2026-07-02T11:00:00+09:00",
                        "status": "scheduled",
                        "resultedAt": None,
                        "resultSummary": None,
                    },
                ],
                "devices": [
                    {
                        "id": "DEV-P001-PIV-1",
                        "type": "말초정맥관",
                        "site": "좌측 전완",
                        "insertedAt": "2026-06-29T14:00:00+09:00",
                        "changeDueAt": "2026-07-02T14:00:00+09:00",
                        "status": "active",
                        "removedAt": None,
                    }
                ],
                "medicationSchedules": [
                    {
                        "medicationName": "타세놀정 500mg",
                        "effectiveFrom": "2026-07-02T09:00:00+09:00",
                        "effectiveTo": None,
                        "orderStatus": "active",
                    }
                ],
                "handoffRequests": [
                    {
                        "id": "REQ-P001-ROUND-1",
                        "topic": "회진 전 발열 경과 전달",
                        "requestedAt": "2026-07-02T07:40:00+09:00",
                        "dueBy": "2026-07-02T10:30:00+09:00",
                        "sourceType": "physician_order",
                        "status": "open",
                    }
                ],
            },
            sidecar["states"]["2026-07-02T09:00:00+09:00"],
        )

    def test_p001_operational_items_appear_only_after_their_recorded_lifecycle_time(self):
        sidecar, _ = self._load_sidecar_and_timeline("P001")
        states = sidecar["states"]
        self.assertEqual([], states["2026-06-29T15:00:00+09:00"]["investigations"])
        self.assertEqual(
            ["DEV-P001-PIV-1"],
            [item["id"] for item in states["2026-06-29T15:00:00+09:00"]["devices"]],
        )
        self.assertEqual([], states["2026-07-01T07:00:00+09:00"]["investigations"])
        self.assertEqual(
            ["INV-P001-CBC"],
            [item["id"] for item in states["2026-07-01T21:00:00+09:00"]["investigations"]],
        )
        self.assertEqual(
            "ordered",
            states["2026-07-02T07:00:00+09:00"]["investigations"][0]["status"],
        )
        self.assertEqual(
            {"INV-P001-CBC", "INV-P001-CXR"},
            {item["id"] for item in states["2026-07-02T09:00:00+09:00"]["investigations"]},
        )
        self.assertEqual([], states["2026-07-02T07:00:00+09:00"]["handoffRequests"])

    def test_p002_keeps_pending_investigation_and_absence_medication_change_explicit(self):
        sidecar, timeline = self._load_sidecar_and_timeline("P002")
        current_at = timeline["snapshots"][-1]["updated_at"]
        current = sidecar["states"][current_at]
        self.assertEqual(
            ["INV-P002-CXR"],
            [item["id"] for item in current["investigations"]],
        )
        self.assertEqual("ordered", current["investigations"][0]["status"])
        self.assertEqual(
            "2026-07-03T09:00:00+09:00",
            current["investigations"][0]["scheduledAt"],
        )
        self.assertEqual(
            ["아세틸시스테인"],
            [item["medicationName"] for item in current["medicationSchedules"]],
        )
        self.assertEqual(
            "2026-07-01T21:00:00+09:00",
            current["medicationSchedules"][0]["effectiveFrom"],
        )
        self.assertEqual([], current["handoffRequests"])

    def test_p003_carries_recent_device_insert_and_remove_states(self):
        sidecar, timeline = self._load_sidecar_and_timeline("P003")
        states = sidecar["states"]
        current = states[timeline["snapshots"][-1]["updated_at"]]
        self.assertEqual(
            {"DEV-P003-PIV-1", "DEV-P003-PIV-2"},
            {item["id"] for item in current["devices"]},
        )
        by_id = {item["id"]: item for item in current["devices"]}
        self.assertEqual("removed", by_id["DEV-P003-PIV-1"]["status"])
        self.assertEqual(
            "2026-07-02T08:00:00+09:00", by_id["DEV-P003-PIV-1"]["removedAt"]
        )
        self.assertEqual("active", by_id["DEV-P003-PIV-2"]["status"])
        self.assertEqual(
            "2026-07-02T08:15:00+09:00", by_id["DEV-P003-PIV-2"]["insertedAt"]
        )
        self.assertEqual(
            ["DEV-P003-PIV-1"],
            [item["id"] for item in states["2026-07-01T22:00:00+09:00"]["devices"]],
        )

    def test_p004_keeps_cancelled_and_communicated_items_without_boundary_false_positive(self):
        sidecar, timeline = self._load_sidecar_and_timeline("P004")
        current = sidecar["states"][timeline["snapshots"][-1]["updated_at"]]
        investigations = {item["id"]: item for item in current["investigations"]}
        self.assertEqual("cancelled", investigations["INV-P004-CXR"]["status"])
        self.assertEqual(
            "2026-07-02T15:00:00+09:00",
            investigations["INV-P004-US"]["scheduledAt"],
        )
        self.assertEqual(
            "communicated", current["handoffRequests"][0]["status"]
        )
        self.assertEqual(
            "2026-07-02T15:00:00+09:00",
            current["handoffRequests"][0]["dueBy"],
        )

    def test_p005_keeps_imaging_result_and_cancelled_request_source_state(self):
        sidecar, timeline = self._load_sidecar_and_timeline("P005")
        current = sidecar["states"][timeline["snapshots"][-1]["updated_at"]]
        self.assertEqual("resulted", current["investigations"][0]["status"])
        self.assertEqual("imaging", current["investigations"][0]["kind"])
        self.assertEqual(
            "2026-07-02T08:30:00+09:00", current["investigations"][0]["resultedAt"]
        )
        self.assertEqual(
            "removal_ordered", current["devices"][0]["status"]
        )
        self.assertIsNone(current["devices"][0]["changeDueAt"])
        self.assertEqual("cancelled", current["handoffRequests"][0]["status"])


if __name__ == "__main__":
    unittest.main()
