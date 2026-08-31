from __future__ import annotations

from datetime import datetime, timedelta
import json
from pathlib import Path
import re
import unittest


ROOT = Path(__file__).resolve().parents[1]
TIMELINE_DIR = ROOT / "data" / "timelines"
PATIENT_DIR = ROOT / "data" / "patients"
HISTORY_DIR = ROOT / "data" / "history"
PATIENT_IDS = ("P001", "P002", "P003", "P004", "P005")

P001_TIMESTAMPS = (
    "2026-06-29T15:00:00+09:00",
    "2026-06-29T23:00:00+09:00",
    "2026-06-30T07:00:00+09:00",
    "2026-06-30T15:00:00+09:00",
    "2026-07-01T07:00:00+09:00",
    "2026-07-01T21:00:00+09:00",
    "2026-07-02T07:00:00+09:00",
    "2026-07-02T09:00:00+09:00",
)


def _load_json(path: Path) -> dict:
    with path.open(encoding="utf-8") as handle:
        return json.load(handle)


def load_timeline(patient_id: str) -> dict:
    path = TIMELINE_DIR / f"{patient_id}.json"
    if not path.exists():
        raise AssertionError(f"timeline fixture is missing: {path}")
    return _load_json(path)


def load_patient(patient_id: str) -> dict:
    return _load_json(PATIENT_DIR / f"{patient_id}.json")


def load_history(patient_id: str, recorded_at: str) -> dict:
    filename = recorded_at.replace(":", "").split("+")[0] + ".json"
    return _load_json(HISTORY_DIR / patient_id / filename)


def parse_iso(value: str) -> datetime:
    parsed = datetime.fromisoformat(value)
    if parsed.tzinfo is None or parsed.utcoffset() is None:
        raise AssertionError(f"timestamp must include an offset: {value!r}")
    return parsed


def _without_timestamp(record: dict) -> dict:
    return {key: value for key, value in record.items() if key != "updated_at"}


class HandoverTimelineFixtureTests(unittest.TestCase):
    def test_each_timeline_has_eight_ordered_snapshots_and_66_hour_span(self):
        for patient_id in PATIENT_IDS:
            with self.subTest(patient_id=patient_id):
                timeline = load_timeline(patient_id)
                self.assertEqual(8, len(timeline["snapshots"]))
                stamps = [
                    parse_iso(item["updated_at"])
                    for item in timeline["snapshots"]
                ]
                self.assertEqual(stamps, sorted(stamps))
                self.assertGreaterEqual(
                    stamps[-1] - stamps[0], timedelta(hours=66)
                )

    def test_last_snapshot_matches_current_patient_fixture(self):
        for patient_id in PATIENT_IDS:
            with self.subTest(patient_id=patient_id):
                self.assertEqual(
                    load_patient(patient_id),
                    load_timeline(patient_id)["snapshots"][-1],
                )

    def test_all_snapshots_keep_the_same_patient_identity(self):
        for patient_id in PATIENT_IDS:
            with self.subTest(patient_id=patient_id):
                timeline = load_timeline(patient_id)
                self.assertEqual(patient_id, timeline["patientId"])
                expected = load_patient(patient_id)
                identity_fields = ("patient_id", "name", "room_no", "age", "sex")
                for index, snapshot in enumerate(timeline["snapshots"], start=1):
                    with self.subTest(snapshot=index):
                        self.assertEqual(patient_id, snapshot["patient_id"])
                        for field in identity_fields:
                            self.assertEqual(expected[field], snapshot[field])

    def test_default_return_start_at_matches_one_snapshot(self):
        for patient_id in PATIENT_IDS:
            with self.subTest(patient_id=patient_id):
                timeline = load_timeline(patient_id)
                self.assertIn(
                    timeline["defaultReturnStartAt"],
                    [item["updated_at"] for item in timeline["snapshots"]],
                )
                parse_iso(timeline["defaultReturnStartAt"])

    def test_only_p003_has_one_explicit_coverage_gap_inside_its_period(self):
        expected_gap = {
            "from": "2026-06-30T18:00:00+09:00",
            "to": "2026-07-01T00:00:00+09:00",
            "code": "source_unavailable",
        }
        for patient_id in PATIENT_IDS:
            with self.subTest(patient_id=patient_id):
                gaps = load_timeline(patient_id)["coverageGaps"]
                if patient_id == "P003":
                    self.assertEqual([expected_gap], gaps)
                    timeline = load_timeline(patient_id)
                    period_start = parse_iso(timeline["defaultReturnStartAt"])
                    period_end = parse_iso(
                        timeline["snapshots"][-1]["updated_at"]
                    )
                    self.assertGreater(parse_iso(expected_gap["from"]), period_start)
                    self.assertLess(parse_iso(expected_gap["to"]), period_end)
                else:
                    self.assertEqual([], gaps)

    def test_timeline_files_contain_no_real_person_identifiers(self):
        forbidden_keys = (
            "resident_registration_number",
            "주민등록번호",
            "phone",
            "telephone",
            "email",
            "address",
            "ssn",
        )
        phone_pattern = re.compile(r"(?<!\d)\d{2,3}[- ]\d{3,4}[- ]\d{4}(?!\d)")
        email_pattern = re.compile(r"\b[^\s@]+@[^\s@]+\.[^\s@]+\b")

        for patient_id in PATIENT_IDS:
            with self.subTest(patient_id=patient_id):
                raw = (
                    TIMELINE_DIR / f"{patient_id}.json"
                ).read_text(encoding="utf-8")
                lowered = raw.lower()
                for key in forbidden_keys:
                    self.assertNotIn(key.lower(), lowered)
                self.assertIsNone(phone_pattern.search(raw))
                self.assertIsNone(email_pattern.search(raw))

    def test_p001_has_the_exact_eight_binding_timestamps(self):
        timeline = load_timeline("P001")
        self.assertEqual(
            P001_TIMESTAMPS,
            tuple(item["updated_at"] for item in timeline["snapshots"]),
        )

    def test_p002_p004_p005_each_exercise_at_least_two_categories(self):
        from services.handover_service import build_handover_comparison

        for patient_id in ("P002", "P004", "P005"):
            with self.subTest(patient_id=patient_id):
                snapshots = load_timeline(patient_id)["snapshots"]
                categories = {
                    change["category"]
                    for previous, current in zip(snapshots, snapshots[1:])
                    for change in build_handover_comparison(previous, current)[
                        "changes"
                    ]
                }
                self.assertGreaterEqual(len(categories), 2)

    def test_p001_reuses_history_states_and_preserves_24_adjacent_events(self):
        timeline = load_timeline("P001")
        snapshots = timeline["snapshots"]
        history_2100 = load_history("P001", "2026-07-01T21:00:00+09:00")
        history_0700 = load_history("P001", "2026-07-02T07:00:00+09:00")

        self.assertEqual(_without_timestamp(history_2100), _without_timestamp(snapshots[0]))
        self.assertEqual(history_2100, snapshots[5])
        self.assertEqual(history_0700, snapshots[6])
        self.assertEqual(load_patient("P001"), snapshots[7])

        from services.handover_service import build_handover_comparison

        event_count = sum(
            len(
                build_handover_comparison(previous, current)["changes"]
            )
            for previous, current in zip(snapshots, snapshots[1:])
        )
        self.assertEqual(24, event_count)


if __name__ == "__main__":
    unittest.main()
