from __future__ import annotations

from datetime import datetime
from typing import Any


DEFAULT_VITALS = {
    "systolic": 120,
    "diastolic": 80,
    "heartrate": 72,
    "respiratory": 16,
    "saturation": 98,
    "body_temperature": 36.5,
}


def _split_multiline_text(value: str) -> list[str]:
    return [line.strip() for line in value.splitlines() if line.strip()]


def _normalize_medications(rows: Any) -> list[dict[str, str]]:
    normalized: list[dict[str, str]] = []
    iterable = rows.to_dict(orient="records") if hasattr(rows, "to_dict") else rows

    for row in iterable:
        name = str(row.get("name", "")).strip()
        route = str(row.get("route", "")).strip()
        frequency = str(row.get("frequency", "")).strip()

        if not any([name, route, frequency]):
            continue

        normalized.append(
            {
                "name": name,
                "route": route,
                "frequency": frequency,
            }
        )

    return normalized


def _normalize_vitals(raw_vitals: dict[str, Any]) -> dict[str, Any]:
    return {
        "systolic": int(raw_vitals.get("systolic", DEFAULT_VITALS["systolic"])),
        "diastolic": int(raw_vitals.get("diastolic", DEFAULT_VITALS["diastolic"])),
        "heartrate": int(raw_vitals.get("heartrate", DEFAULT_VITALS["heartrate"])),
        "respiratory": int(raw_vitals.get("respiratory", DEFAULT_VITALS["respiratory"])),
        "saturation": int(raw_vitals.get("saturation", DEFAULT_VITALS["saturation"])),
        "body_temperature": round(
            float(raw_vitals.get("body_temperature", DEFAULT_VITALS["body_temperature"])),
            1,
        ),
    }


def build_patient_data(form_values: dict[str, Any]) -> dict[str, Any]:
    patient_id = str(form_values.get("patient_id", "")).strip().upper()
    if not patient_id:
        raise ValueError("환자 ID는 필수입니다.")

    patient_data = {
        "patient_id": patient_id,
        "name": str(form_values.get("name", "")).strip(),
        "room_no": str(form_values.get("room_no", "")).strip(),
        "age": int(form_values.get("age", 0)),
        "sex": str(form_values.get("sex", "")).strip(),
        "diagnosis": _split_multiline_text(str(form_values.get("diagnosis", ""))),
        "vitals": _normalize_vitals(form_values.get("vitals", {})),
        "medications": _normalize_medications(form_values.get("medications", [])),
        "notes": _split_multiline_text(str(form_values.get("notes", ""))),
        "updated_at": datetime.now().astimezone().isoformat(timespec="seconds"),
    }

    return patient_data


def patient_to_form_data(patient: dict[str, Any] | None) -> dict[str, Any]:
    if patient is None:
        return {
            "patient_id": "",
            "name": "",
            "room_no": "",
            "age": 0,
            "sex": "",
            "diagnosis": [],
            "vitals": DEFAULT_VITALS.copy(),
            "medications": [{"name": "", "route": "", "frequency": ""}],
            "notes": [],
        }

    medications = patient.get("medications", [])
    if not medications:
        medications = [{"name": "", "route": "", "frequency": ""}]

    return {
        "patient_id": patient.get("patient_id", ""),
        "name": patient.get("name", ""),
        "room_no": patient.get("room_no", ""),
        "age": int(patient.get("age", 0)),
        "sex": patient.get("sex", ""),
        "diagnosis": patient.get("diagnosis", []),
        "vitals": {**DEFAULT_VITALS, **patient.get("vitals", {})},
        "medications": medications,
        "notes": patient.get("notes", []),
    }


def summarize_patient_row(patient: dict[str, Any]) -> dict[str, Any]:
    diagnosis = ", ".join(patient.get("diagnosis", [])) or "-"
    return {
        "patient_id": patient.get("patient_id", ""),
        "name": patient.get("name", ""),
        "room_no": patient.get("room_no", ""),
        "age": patient.get("age", ""),
        "diagnosis": diagnosis,
        "updated_at": patient.get("updated_at", ""),
    }
