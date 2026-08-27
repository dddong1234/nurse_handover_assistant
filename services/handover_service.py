from __future__ import annotations

import re
from typing import Any


CATEGORY_LABELS = {
    "vitals": {
        "systolic": "수축기 혈압",
        "diastolic": "이완기 혈압",
        "heartrate": "심박수",
        "respiratory": "호흡수",
        "saturation": "산소포화도",
        "body_temperature": "체온",
    }
}
PRIORITY_ORDER = {"high": 0, "medium": 1, "low": 2}

_REQUIRED_CATEGORIES = ("diagnosis", "vitals", "medications", "notes")


def _record_value(record: dict[str, Any] | None, key: str, default: Any = None) -> Any:
    if not isinstance(record, dict):
        return default
    return record.get(key, default)


def _recorded_at(record: dict[str, Any] | None) -> Any:
    return _record_value(record, "updated_at")


def _data_warnings(
    previous: dict[str, Any],
    current: dict[str, Any],
) -> list[str]:
    warnings: list[str] = []

    for side, record in (("previous", previous), ("current", current)):
        if not record.get("updated_at"):
            warnings.append(f"{side}.updated_at")

        for field in _REQUIRED_CATEGORIES:
            value = record.get(field)
            if field == "vitals":
                complete = isinstance(value, dict)
            else:
                complete = isinstance(value, list)
            if not complete:
                warnings.append(f"{side}.{field}")

    return sorted(set(warnings))


def _patient_context(current: dict[str, Any]) -> dict[str, Any]:
    diagnoses = current.get("diagnosis", [])
    if not isinstance(diagnoses, list):
        diagnoses = []

    return {
        "id": current.get("patient_id", ""),
        "name": current.get("name", ""),
        "room": current.get("room_no", ""),
        "age": current.get("age"),
        "sex": current.get("sex", ""),
        "diagnoses": list(diagnoses),
    }


def _slug(value: Any) -> str:
    """Return a deterministic, readable identifier fragment for a list item."""

    text = str(value).strip().lower()
    text = re.sub(r"[^0-9a-z가-힣]+", "-", text)
    return text.strip("-") or "item"


def _numeric_delta(previous: Any, current: Any) -> Any:
    if isinstance(previous, bool) or isinstance(current, bool):
        return None
    if isinstance(previous, (int, float)) and isinstance(current, (int, float)):
        return round(current - previous, 10)
    return None


def _change(
    *,
    change_id: str,
    category: str,
    change_type: str,
    priority: str,
    label: str,
    previous_value: Any,
    current_value: Any,
    delta: Any,
    field_path: str,
    previous_recorded_at: Any,
    current_recorded_at: Any,
) -> dict[str, Any]:
    return {
        "id": change_id,
        "category": category,
        "changeType": change_type,
        "reviewPriority": priority,
        "label": label,
        "previousValue": previous_value,
        "currentValue": current_value,
        "delta": delta,
        "evidence": {
            "fieldPath": field_path,
            "previousRecordedAt": previous_recorded_at,
            "currentRecordedAt": current_recorded_at,
        },
    }


def _compare_vitals_structured(
    previous: dict[str, Any],
    current: dict[str, Any],
    previous_recorded_at: Any,
    current_recorded_at: Any,
) -> list[dict[str, Any]]:
    previous_vitals = previous.get("vitals", {})
    current_vitals = current.get("vitals", {})
    if not isinstance(previous_vitals, dict) or not isinstance(current_vitals, dict):
        return []

    changes: list[dict[str, Any]] = []
    vital_keys = sorted(set(previous_vitals) | set(current_vitals))
    for key in vital_keys:
        previous_exists = key in previous_vitals
        current_exists = key in current_vitals
        previous_value = previous_vitals.get(key)
        current_value = current_vitals.get(key)

        if previous_exists and current_exists:
            if previous_value == current_value:
                continue
            change_type = "modified"
        elif current_exists:
            change_type = "added"
        else:
            change_type = "removed"

        changes.append(
            _change(
                change_id=f"vitals-{key}-{change_type}",
                category="vitals",
                change_type=change_type,
                priority="medium",
                label=CATEGORY_LABELS["vitals"].get(key, key),
                previous_value=previous_value if previous_exists else None,
                current_value=current_value if current_exists else None,
                delta=_numeric_delta(previous_value, current_value)
                if previous_exists and current_exists
                else None,
                field_path=f"vitals.{key}",
                previous_recorded_at=previous_recorded_at,
                current_recorded_at=current_recorded_at,
            )
        )

    return changes


def _compare_medications_structured(
    previous: dict[str, Any],
    current: dict[str, Any],
    previous_recorded_at: Any,
    current_recorded_at: Any,
) -> list[dict[str, Any]]:
    previous_medications = _medication_map(previous.get("medications", []))
    current_medications = _medication_map(current.get("medications", []))
    changes: list[dict[str, Any]] = []

    for name in sorted(set(previous_medications) | set(current_medications)):
        previous_exists = name in previous_medications
        current_exists = name in current_medications
        previous_value = previous_medications.get(name)
        current_value = current_medications.get(name)

        if previous_exists and current_exists:
            if previous_value == current_value:
                continue
            change_type = "modified"
        elif current_exists:
            change_type = "added"
        else:
            change_type = "removed"

        changes.append(
            _change(
                change_id=f"medications-{_slug(name)}-{change_type}",
                category="medications",
                change_type=change_type,
                priority="high",
                label=str(name),
                previous_value=previous_value if previous_exists else None,
                current_value=current_value if current_exists else None,
                delta=None,
                field_path=f"medications.{name}",
                previous_recorded_at=previous_recorded_at,
                current_recorded_at=current_recorded_at,
            )
        )

    return changes


def _compare_list_structured(
    previous: dict[str, Any],
    current: dict[str, Any],
    *,
    field: str,
    category: str,
    priority: str,
    previous_recorded_at: Any,
    current_recorded_at: Any,
) -> list[dict[str, Any]]:
    previous_items = set(previous.get(field, []))
    current_items = set(current.get(field, []))
    changes: list[dict[str, Any]] = []

    for item in sorted(previous_items | current_items):
        previous_exists = item in previous_items
        current_exists = item in current_items
        if previous_exists and current_exists:
            continue

        change_type = "added" if current_exists else "removed"
        changes.append(
            _change(
                change_id=f"{category}-{_slug(item)}-{change_type}",
                category=category,
                change_type=change_type,
                priority=priority,
                label=str(item),
                previous_value=item if previous_exists else None,
                current_value=item if current_exists else None,
                delta=None,
                field_path=field,
                previous_recorded_at=previous_recorded_at,
                current_recorded_at=current_recorded_at,
            )
        )

    return changes


def _sort_changes(changes: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return sorted(
        changes,
        key=lambda change: (
            PRIORITY_ORDER[change["reviewPriority"]],
            change["category"],
            change["id"],
        ),
    )


def build_handover_comparison(
    previous: dict[str, Any] | None,
    current: dict[str, Any],
) -> dict[str, Any]:
    """Build a deterministic, evidence-preserving comparison of two records."""

    current_record = current if isinstance(current, dict) else {}
    previous_recorded_at = _recorded_at(previous)
    current_recorded_at = _recorded_at(current_record)
    result: dict[str, Any] = {
        "patient": _patient_context(current_record),
        "interval": {
            "previousRecordedAt": previous_recorded_at,
            "currentRecordedAt": current_recorded_at,
        },
        "status": "no_previous" if previous is None else "no_changes",
        "dataWarnings": [],
        "changes": [],
    }

    if previous is None:
        return result

    previous_record = previous if isinstance(previous, dict) else {}
    warnings = _data_warnings(previous_record, current_record)
    result["dataWarnings"] = warnings

    changes: list[dict[str, Any]] = []
    if isinstance(previous_record.get("vitals"), dict) and isinstance(
        current_record.get("vitals"), dict
    ):
        changes.extend(
            _compare_vitals_structured(
                previous_record,
                current_record,
                previous_recorded_at,
                current_recorded_at,
            )
        )
    if isinstance(previous_record.get("medications"), list) and isinstance(
        current_record.get("medications"), list
    ):
        changes.extend(
            _compare_medications_structured(
                previous_record,
                current_record,
                previous_recorded_at,
                current_recorded_at,
            )
        )
    if isinstance(previous_record.get("diagnosis"), list) and isinstance(
        current_record.get("diagnosis"), list
    ):
        changes.extend(
            _compare_list_structured(
                previous_record,
                current_record,
                field="diagnosis",
                category="diagnosis",
                priority="high",
                previous_recorded_at=previous_recorded_at,
                current_recorded_at=current_recorded_at,
            )
        )
    if isinstance(previous_record.get("notes"), list) and isinstance(
        current_record.get("notes"), list
    ):
        changes.extend(
            _compare_list_structured(
                previous_record,
                current_record,
                field="notes",
                category="notes",
                priority="low",
                previous_recorded_at=previous_recorded_at,
                current_recorded_at=current_recorded_at,
            )
        )

    result["changes"] = _sort_changes(changes)
    if warnings:
        result["status"] = "partial"
    elif changes:
        result["status"] = "ready"
    else:
        result["status"] = "no_changes"
    return result


def _medication_map(medications: list[dict[str, Any]]) -> dict[str, dict[str, Any]]:
    return {
        med.get("name"): med
        for med in medications
        if isinstance(med, dict) and med.get("name")
    }


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
    messages = [f"신규 진단: {item}" for item in sorted(curr - prev)]
    messages.extend(f"삭제 진단: {item}" for item in sorted(prev - curr))
    return messages


def compare_notes(prev_data: dict[str, Any], curr_data: dict[str, Any]) -> list[str]:
    prev = set(prev_data.get("notes", []))
    curr = set(curr_data.get("notes", []))
    messages = [f"신규 메모: {item}" for item in sorted(curr - prev)]
    messages.extend(f"삭제 메모: {item}" for item in sorted(prev - curr))
    return messages


def _legacy_change_sort_key(
    change: dict[str, Any],
    previous: dict[str, Any],
) -> tuple[int, int, str]:
    """Keep the original category/type order for the Streamlit string API."""

    category_order = {"vitals": 0, "medications": 1, "diagnosis": 2, "notes": 3}
    type_order = {"added": 0, "removed": 1, "modified": 2}
    category = change["category"]
    change_type = change["changeType"]

    if category == "vitals":
        field_path = change["evidence"]["fieldPath"]
        field = field_path.split(".", 1)[-1]
        previous_vitals = previous.get("vitals", {})
        if isinstance(previous_vitals, dict):
            try:
                field_order = list(previous_vitals).index(field)
            except ValueError:
                field_order = len(previous_vitals)
        else:
            field_order = 0
        return (category_order[category], field_order, change["id"])

    # The old projection grouped medication/list additions, removals and
    # modifications separately. Preserve that ordering while using structured
    # changes as the source of the rendered messages.
    return (
        category_order[category],
        type_order.get(change_type, len(type_order)),
        change["id"],
    )


def _format_legacy_change(change: dict[str, Any]) -> str:
    category = change["category"]
    change_type = change["changeType"]
    label = change["label"]

    if category == "vitals":
        field = change["evidence"]["fieldPath"].split(".", 1)[-1]
        return f"{field} 변화: {change['previousValue']} -> {change['currentValue']}"

    if category == "medications":
        if change_type == "added":
            medication = change["currentValue"] or {}
            return (
                f"투약 추가: {label} "
                f"({medication.get('route', '-')}, {medication.get('frequency', '-')})"
            )
        if change_type == "removed":
            return f"투약 중단: {label}"

        previous_medication = change["previousValue"] or {}
        current_medication = change["currentValue"] or {}
        return (
            "투약 변경: "
            f"{label} "
            f"({previous_medication.get('route', '-')}, "
            f"{previous_medication.get('frequency', '-')}) -> "
            f"({current_medication.get('route', '-')}, "
            f"{current_medication.get('frequency', '-')})"
        )

    if category == "diagnosis":
        prefix = "신규 진단" if change_type == "added" else "삭제 진단"
        return f"{prefix}: {label}"

    if category == "notes":
        prefix = "신규 메모" if change_type == "added" else "삭제 메모"
        return f"{prefix}: {label}"

    return str(label)


def detect_changes(prev_data: dict[str, Any], curr_data: dict[str, Any]) -> list[str]:
    if not isinstance(prev_data, dict) or not isinstance(curr_data, dict):
        return []

    structured_changes = build_handover_comparison(prev_data, curr_data)["changes"]
    ordered_changes = sorted(
        structured_changes,
        key=lambda change: _legacy_change_sort_key(change, prev_data),
    )
    return [_format_legacy_change(change) for change in ordered_changes]


def generate_handover_text(changes: list[str]) -> str:
    if not changes:
        return "변화 없음"

    return "\n".join(f"- {change}" for change in changes)
