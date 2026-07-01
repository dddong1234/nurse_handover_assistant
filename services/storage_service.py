from __future__ import annotations

import json
import shutil
from copy import deepcopy
from datetime import datetime
from pathlib import Path
from typing import Any


BASE_DIR = Path(__file__).resolve().parent.parent
DATA_DIR = BASE_DIR / "data"
PATIENTS_DIR = DATA_DIR / "patients"
HISTORY_DIR = DATA_DIR / "history"

def _demo_record(
    patient_id: str,
    name: str,
    room_no: str,
    age: int,
    sex: str,
    diagnosis: list[str],
    vitals: dict[str, Any],
    medications: list[dict[str, str]],
    notes: list[str],
    updated_at: str,
) -> dict[str, Any]:
    return {
        "patient_id": patient_id,
        "name": name,
        "room_no": room_no,
        "age": age,
        "sex": sex,
        "diagnosis": diagnosis,
        "vitals": vitals,
        "medications": medications,
        "notes": notes,
        "updated_at": updated_at,
    }


DEMO_DATASET = {
    "patients": {
        "P001": _demo_record(
            "P001",
            "홍길동",
            "301",
            67,
            "M",
            ["acute pharyngitis", "hypertension"],
            {
                "systolic": 150,
                "diastolic": 95,
                "heartrate": 92,
                "respiratory": 18,
                "saturation": 97,
                "body_temperature": 38.2,
            },
            [
                {"name": "이부프로펜 400mg", "route": "PO", "frequency": "TID"},
                {"name": "타세놀정 500mg", "route": "PO", "frequency": "TID"},
            ],
            ["인후통 호소", "미열 지속"],
            "2026-07-02T09:00:00+09:00",
        ),
        "P002": _demo_record(
            "P002",
            "김영희",
            "302",
            54,
            "F",
            ["community acquired pneumonia"],
            {
                "systolic": 128,
                "diastolic": 76,
                "heartrate": 88,
                "respiratory": 22,
                "saturation": 92,
                "body_temperature": 37.8,
            },
            [
                {"name": "세프트리악손 2g", "route": "IV", "frequency": "QD"},
                {"name": "아세틸시스테인", "route": "NEB", "frequency": "TID"},
                {"name": "산소 2L/min", "route": "NC", "frequency": "continuous"},
            ],
            ["기침과 객담 지속", "산소 유지 필요"],
            "2026-07-02T09:10:00+09:00",
        ),
        "P003": _demo_record(
            "P003",
            "박민수",
            "401",
            72,
            "M",
            ["acute decompensated heart failure", "atrial fibrillation"],
            {
                "systolic": 104,
                "diastolic": 64,
                "heartrate": 108,
                "respiratory": 20,
                "saturation": 95,
                "body_temperature": 36.7,
            },
            [
                {"name": "푸로세미드 20mg", "route": "IV", "frequency": "BID"},
                {"name": "디곡신 0.125mg", "route": "PO", "frequency": "QD"},
                {"name": "와파린 3mg", "route": "PO", "frequency": "QD"},
            ],
            ["야간 호흡곤란 호소", "하지 부종 관찰"],
            "2026-07-02T09:20:00+09:00",
        ),
        "P004": _demo_record(
            "P004",
            "최수진",
            "205",
            38,
            "F",
            ["post appendectomy"],
            {
                "systolic": 118,
                "diastolic": 72,
                "heartrate": 76,
                "respiratory": 18,
                "saturation": 99,
                "body_temperature": 36.5,
            },
            [
                {"name": "세파졸린 1g", "route": "IV", "frequency": "TID"},
                {"name": "트라마돌 50mg", "route": "IV", "frequency": "PRN"},
            ],
            ["복강경 수술 후 통증 감소", "보행 시작"],
            "2026-07-02T08:40:00+09:00",
        ),
        "P005": _demo_record(
            "P005",
            "이정호",
            "503",
            61,
            "M",
            ["type 2 diabetes mellitus", "right diabetic foot ulcer"],
            {
                "systolic": 136,
                "diastolic": 84,
                "heartrate": 82,
                "respiratory": 18,
                "saturation": 98,
                "body_temperature": 37.2,
            },
            [
                {"name": "인슐린 글라진", "route": "SC", "frequency": "HS"},
                {"name": "피페라실린/타조박탐", "route": "IV", "frequency": "Q8H"},
            ],
            ["족부 드레싱 유지", "혈당 조절 필요"],
            "2026-07-02T09:30:00+09:00",
        ),
    },
    "history": {
        "P001": {
            "2026-07-01T210000": _demo_record(
                "P001",
                "홍길동",
                "301",
                67,
                "M",
                ["acute pharyngitis"],
                {
                    "systolic": 122,
                    "diastolic": 82,
                    "heartrate": 80,
                    "respiratory": 16,
                    "saturation": 98,
                    "body_temperature": 37.4,
                },
                [{"name": "이부프로펜 400mg", "route": "PO", "frequency": "BID"}],
                ["인후통 시작"],
                "2026-07-01T21:00:00+09:00",
            ),
            "2026-07-02T070000": _demo_record(
                "P001",
                "홍길동",
                "301",
                67,
                "M",
                ["acute pharyngitis"],
                {
                    "systolic": 138,
                    "diastolic": 88,
                    "heartrate": 86,
                    "respiratory": 17,
                    "saturation": 98,
                    "body_temperature": 37.9,
                },
                [{"name": "이부프로펜 400mg", "route": "PO", "frequency": "TID"}],
                ["인후통 호소"],
                "2026-07-02T07:00:00+09:00",
            ),
        },
        "P002": {
            "2026-07-01T200000": _demo_record(
                "P002",
                "김영희",
                "302",
                54,
                "F",
                ["community acquired pneumonia"],
                {
                    "systolic": 132,
                    "diastolic": 80,
                    "heartrate": 96,
                    "respiratory": 24,
                    "saturation": 89,
                    "body_temperature": 38.4,
                },
                [
                    {"name": "세프트리악손 2g", "route": "IV", "frequency": "QD"},
                    {"name": "산소 3L/min", "route": "NC", "frequency": "continuous"},
                ],
                ["기침과 객담 지속", "발열 지속"],
                "2026-07-01T20:00:00+09:00",
            ),
            "2026-07-02T060000": _demo_record(
                "P002",
                "김영희",
                "302",
                54,
                "F",
                ["community acquired pneumonia"],
                {
                    "systolic": 130,
                    "diastolic": 78,
                    "heartrate": 92,
                    "respiratory": 23,
                    "saturation": 91,
                    "body_temperature": 38.0,
                },
                [
                    {"name": "세프트리악손 2g", "route": "IV", "frequency": "QD"},
                    {"name": "산소 2L/min", "route": "NC", "frequency": "continuous"},
                ],
                ["기침과 객담 지속"],
                "2026-07-02T06:00:00+09:00",
            ),
        },
        "P003": {
            "2026-07-01T220000": _demo_record(
                "P003",
                "박민수",
                "401",
                72,
                "M",
                ["acute decompensated heart failure"],
                {
                    "systolic": 114,
                    "diastolic": 68,
                    "heartrate": 118,
                    "respiratory": 24,
                    "saturation": 93,
                    "body_temperature": 36.8,
                },
                [
                    {"name": "푸로세미드 20mg", "route": "IV", "frequency": "QD"},
                    {"name": "와파린 3mg", "route": "PO", "frequency": "QD"},
                ],
                ["야간 호흡곤란 호소"],
                "2026-07-01T22:00:00+09:00",
            ),
            "2026-07-02T060000": _demo_record(
                "P003",
                "박민수",
                "401",
                72,
                "M",
                ["acute decompensated heart failure"],
                {
                    "systolic": 108,
                    "diastolic": 66,
                    "heartrate": 112,
                    "respiratory": 22,
                    "saturation": 94,
                    "body_temperature": 36.7,
                },
                [
                    {"name": "푸로세미드 20mg", "route": "IV", "frequency": "BID"},
                    {"name": "와파린 3mg", "route": "PO", "frequency": "QD"},
                ],
                ["야간 호흡곤란 호소", "소변량 증가"],
                "2026-07-02T06:00:00+09:00",
            ),
        },
        "P004": {
            "2026-07-01T180000": _demo_record(
                "P004",
                "최수진",
                "205",
                38,
                "F",
                ["post appendectomy"],
                {
                    "systolic": 124,
                    "diastolic": 78,
                    "heartrate": 92,
                    "respiratory": 20,
                    "saturation": 98,
                    "body_temperature": 37.1,
                },
                [
                    {"name": "세파졸린 1g", "route": "IV", "frequency": "TID"},
                    {"name": "트라마돌 50mg", "route": "IV", "frequency": "Q8H"},
                ],
                ["수술 후 통증 NRS 6"],
                "2026-07-01T18:00:00+09:00",
            ),
            "2026-07-02T060000": _demo_record(
                "P004",
                "최수진",
                "205",
                38,
                "F",
                ["post appendectomy"],
                {
                    "systolic": 120,
                    "diastolic": 74,
                    "heartrate": 84,
                    "respiratory": 18,
                    "saturation": 99,
                    "body_temperature": 36.8,
                },
                [
                    {"name": "세파졸린 1g", "route": "IV", "frequency": "TID"},
                    {"name": "트라마돌 50mg", "route": "IV", "frequency": "PRN"},
                ],
                ["통증 감소", "침상 가장자리 앉기 시행"],
                "2026-07-02T06:00:00+09:00",
            ),
        },
        "P005": {
            "2026-07-01T190000": _demo_record(
                "P005",
                "이정호",
                "503",
                61,
                "M",
                ["type 2 diabetes mellitus", "right diabetic foot ulcer"],
                {
                    "systolic": 142,
                    "diastolic": 88,
                    "heartrate": 86,
                    "respiratory": 18,
                    "saturation": 98,
                    "body_temperature": 37.9,
                },
                [{"name": "인슐린 글라진", "route": "SC", "frequency": "HS"}],
                ["족부 드레싱 유지", "상처 삼출물 관찰"],
                "2026-07-01T19:00:00+09:00",
            ),
            "2026-07-02T070000": _demo_record(
                "P005",
                "이정호",
                "503",
                61,
                "M",
                ["type 2 diabetes mellitus", "right diabetic foot ulcer"],
                {
                    "systolic": 138,
                    "diastolic": 86,
                    "heartrate": 84,
                    "respiratory": 18,
                    "saturation": 98,
                    "body_temperature": 37.5,
                },
                [
                    {"name": "인슐린 글라진", "route": "SC", "frequency": "HS"},
                    {"name": "피페라실린/타조박탐", "route": "IV", "frequency": "Q8H"},
                ],
                ["족부 드레싱 유지"],
                "2026-07-02T07:00:00+09:00",
            ),
        },
    },
}


def _ensure_data_dirs() -> None:
    PATIENTS_DIR.mkdir(parents=True, exist_ok=True)
    HISTORY_DIR.mkdir(parents=True, exist_ok=True)


def _patient_path(patient_id: str) -> Path:
    return PATIENTS_DIR / f"{patient_id}.json"


def _history_dir(patient_id: str) -> Path:
    return HISTORY_DIR / patient_id


def _write_json(path: Path, data: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")


def clear_patient_data() -> None:
    _ensure_data_dirs()
    shutil.rmtree(PATIENTS_DIR, ignore_errors=True)
    shutil.rmtree(HISTORY_DIR, ignore_errors=True)
    _ensure_data_dirs()


def reset_demo_dataset() -> None:
    clear_patient_data()

    for patient_id, patient_data in DEMO_DATASET["patients"].items():
        _write_json(_patient_path(patient_id), patient_data)

    for patient_id, snapshots in DEMO_DATASET["history"].items():
        for snapshot_name, snapshot_data in snapshots.items():
            snapshot_path = _history_dir(patient_id) / f"{snapshot_name}.json"
            _write_json(snapshot_path, snapshot_data)


def load_patient(patient_id: str | None) -> dict[str, Any] | None:
    if not patient_id:
        return None

    _ensure_data_dirs()
    path = _patient_path(patient_id)
    if not path.exists():
        return None

    return json.loads(path.read_text(encoding="utf-8"))


def load_all_patients() -> list[dict[str, Any]]:
    _ensure_data_dirs()
    patients = []
    for path in sorted(PATIENTS_DIR.glob("*.json")):
        patients.append(json.loads(path.read_text(encoding="utf-8")))

    return sorted(patients, key=lambda item: item.get("patient_id", ""))


def save_snapshot(patient_data: dict[str, Any]) -> Path:
    patient_id = patient_data["patient_id"]
    snapshot_name = datetime.now().strftime("%Y-%m-%dT%H%M%S")
    snapshot_path = _history_dir(patient_id) / f"{snapshot_name}.json"
    _write_json(snapshot_path, deepcopy(patient_data))
    return snapshot_path


def save_patient(patient_data: dict[str, Any]) -> None:
    _ensure_data_dirs()
    existing = load_patient(patient_data["patient_id"])
    if existing is not None:
        save_snapshot(existing)

    _write_json(_patient_path(patient_data["patient_id"]), patient_data)


def get_latest_snapshot(patient_id: str) -> dict[str, Any] | None:
    _ensure_data_dirs()
    history_dir = _history_dir(patient_id)
    if not history_dir.exists():
        return None

    snapshots = sorted(history_dir.glob("*.json"))
    if not snapshots:
        return None

    return json.loads(snapshots[-1].read_text(encoding="utf-8"))


def load_patient_history(patient_id: str) -> list[dict[str, Any]]:
    _ensure_data_dirs()
    history_dir = _history_dir(patient_id)
    if not history_dir.exists():
        return []

    snapshots = []
    for path in sorted(history_dir.glob("*.json")):
        snapshots.append(json.loads(path.read_text(encoding="utf-8")))

    return sorted(snapshots, key=lambda item: item.get("updated_at", ""))


def load_patient_timeline(patient_id: str) -> list[dict[str, Any]]:
    timeline = load_patient_history(patient_id)
    current = load_patient(patient_id)
    if current is not None:
        timeline.append(current)

    return sorted(timeline, key=lambda item: item.get("updated_at", ""))
