from __future__ import annotations

from typing import Any


def _medication_map(medications: list[dict[str, str]]) -> dict[str, dict[str, str]]:
    return {med["name"]: med for med in medications if med.get("name")}


def compare_vitals(prev_data: dict[str, Any], curr_data: dict[str, Any]) -> list[str]:
    messages = []
    prev_vitals = prev_data.get("vitals", {})
    curr_vitals = curr_data.get("vitals", {})

    for key, prev_value in prev_vitals.items():
        curr_value = curr_vitals.get(key)
        if prev_value != curr_value:
            messages.append(f"{key} 변화: {prev_value} -> {curr_value}")

    return messages


def compare_medications(prev_data: dict[str, Any], curr_data: dict[str, Any]) -> list[str]:
    messages = []
    prev_map = _medication_map(prev_data.get("medications", []))
    curr_map = _medication_map(curr_data.get("medications", []))

    prev_names = set(prev_map)
    curr_names = set(curr_map)

    for name in sorted(curr_names - prev_names):
        medication = curr_map[name]
        messages.append(
            f"투약 추가: {name} ({medication.get('route', '-')}, {medication.get('frequency', '-')})"
        )

    for name in sorted(prev_names - curr_names):
        messages.append(f"투약 중단: {name}")

    for name in sorted(prev_names & curr_names):
        prev_med = prev_map[name]
        curr_med = curr_map[name]
        if prev_med != curr_med:
            messages.append(
                "투약 변경: "
                f"{name} "
                f"({prev_med.get('route', '-')}, {prev_med.get('frequency', '-')}) -> "
                f"({curr_med.get('route', '-')}, {curr_med.get('frequency', '-')})"
            )

    return messages


def compare_diagnosis(prev_data: dict[str, Any], curr_data: dict[str, Any]) -> list[str]:
    prev = set(prev_data.get("diagnosis", []))
    curr = set(curr_data.get("diagnosis", []))
    return [f"신규 진단: {item}" for item in sorted(curr - prev)]


def compare_notes(prev_data: dict[str, Any], curr_data: dict[str, Any]) -> list[str]:
    prev = set(prev_data.get("notes", []))
    curr = set(curr_data.get("notes", []))
    return [f"신규 메모: {item}" for item in sorted(curr - prev)]


def detect_changes(prev_data: dict[str, Any], curr_data: dict[str, Any]) -> list[str]:
    changes: list[str] = []
    changes.extend(compare_vitals(prev_data, curr_data))
    changes.extend(compare_medications(prev_data, curr_data))
    changes.extend(compare_diagnosis(prev_data, curr_data))
    changes.extend(compare_notes(prev_data, curr_data))
    return changes


def generate_handover_text(changes: list[str]) -> str:
    if not changes:
        return "변화 없음"

    return "\n".join(f"- {change}" for change in changes)
