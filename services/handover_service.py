from __future__ import annotations

import hashlib
import json
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


def _item_id(category: str, value: Any, change_type: str) -> str:
    readable = _slug(value)
    fingerprint = hashlib.sha256(str(value).encode("utf-8")).hexdigest()[:12]
    return f"{category}-{readable}-{fingerprint}-{change_type}"


def _item_field_path(field: str, value: Any) -> str:
    encoded_value = json.dumps(value, ensure_ascii=False, separators=(",", ":"))
    return f"{field}[{encoded_value}]"


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
                change_id=_item_id("medications", name, change_type),
                category="medications",
                change_type=change_type,
                priority="high",
                label=str(name),
                previous_value=previous_value if previous_exists else None,
                current_value=current_value if current_exists else None,
                delta=None,
                field_path=_item_field_path("medications", name),
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
                change_id=_item_id(category, item, change_type),
                category=category,
                change_type=change_type,
                priority=priority,
                label=str(item),
                previous_value=item if previous_exists else None,
                current_value=item if current_exists else None,
                delta=None,
                field_path=_item_field_path(field, item),
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


_SUMMARY_RECOMMENDATION = "간호사가 확인할 후속 항목을 입력하세요."
_SUMMARY_BACKGROUND_CATEGORIES = {"diagnosis", "medications"}
_SUMMARY_ASSESSMENT_CATEGORIES = {"vitals", "notes"}


def _summary_value(value: Any) -> str:
    if value is None:
        return "없음"
    if isinstance(value, dict):
        return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    if isinstance(value, list):
        return json.dumps(value, ensure_ascii=False, separators=(",", ":"))
    return str(value)


def _medication_summary_value(value: Any, fallback_name: str = "") -> str:
    if not isinstance(value, dict):
        return _summary_value(value)

    name = value.get("name")
    if name is None or (isinstance(name, str) and not name):
        name = fallback_name or "이름 정보 없음"
    route = value.get("route")
    if route is None or (isinstance(route, str) and not route):
        route = "경로 정보 없음"
    frequency = value.get("frequency")
    if frequency is None or (isinstance(frequency, str) and not frequency):
        frequency = "빈도 정보 없음"
    return f"{name} · {route} · {frequency}"


def _summary_change_text(change: dict[str, Any]) -> str:
    category = str(change.get("category", "기타 변화"))
    change_type = str(change.get("changeType", "modified"))
    label = str(change.get("label", ""))
    previous_value = change.get("previousValue")
    current_value = change.get("currentValue")

    if category == "diagnosis":
        subject = "진단"
        value_for_added = label or _summary_value(current_value)
        value_for_removed = label or _summary_value(previous_value)
    elif category == "medications":
        subject = "투약"
        value_for_added = _medication_summary_value(current_value, label)
        value_for_removed = _medication_summary_value(previous_value, label)
    elif category == "vitals":
        subject = label or "활력징후"
        value_for_added = _summary_value(current_value)
        value_for_removed = _summary_value(previous_value)
    elif category == "notes":
        subject = "간호 메모"
        value_for_added = label or _summary_value(current_value)
        value_for_removed = label or _summary_value(previous_value)
    else:
        subject = label or category
        value_for_added = _summary_value(current_value)
        value_for_removed = _summary_value(previous_value)

    if change_type == "added":
        return f"{subject} 추가: {value_for_added}"
    if change_type == "removed":
        removal_action = "중단" if category == "medications" else "삭제"
        return f"{subject} {removal_action}: {value_for_removed}"
    if category == "medications":
        return f"{subject} 변경: {value_for_removed} -> {value_for_added}"
    return (
        f"{subject} 변경: {_summary_value(previous_value)}"
        f" -> {_summary_value(current_value)}"
    )


def _summary_situation_text(comparison: dict[str, Any], change_count: int) -> str:
    patient = comparison.get("patient", {})
    if not isinstance(patient, dict):
        patient = {}
    patient_id = patient.get("id")
    patient_name = patient.get("name")
    if patient_name and patient_id:
        patient_text = f"{patient_name}({patient_id})"
    else:
        patient_text = str(patient_name or patient_id or "환자")

    room = patient.get("room")
    room_text = f"{room}호" if room else "병실 정보 없음"

    interval = comparison.get("interval", {})
    if not isinstance(interval, dict):
        interval = {}
    previous_recorded_at = interval.get("previousRecordedAt") or "이전 기록 없음"
    current_recorded_at = interval.get("currentRecordedAt") or "현재 기록 시각 없음"
    status = comparison.get("status")
    if status == "no_previous":
        return (
            f"{patient_text}, {room_text}, 현재 기록 시각 {current_recorded_at} 기준으로 "
            "이전 기록을 사용할 수 없어 비교를 수행하지 않았습니다."
        )

    interval_text = f"{previous_recorded_at} -> {current_recorded_at}"
    if status == "no_changes":
        return (
            f"{patient_text}, {room_text}, {interval_text} 두 기록을 비교한 결과 "
            "총 0건의 변화가 확인되었습니다."
        )

    return (
        f"{patient_text}, {room_text}, {interval_text} 사이에 "
        f"총 {change_count}건의 변화가 확인되었습니다."
    )


def build_deterministic_summary(comparison: dict[str, Any]) -> dict[str, Any]:
    """Build an evidence-preserving SBAR summary without clinical inference."""

    if not isinstance(comparison, dict):
        comparison = {}

    raw_changes = comparison.get("changes", [])
    changes = [change for change in raw_changes if isinstance(change, dict)]
    evidence_ids = [
        change["id"]
        for change in changes
        if "id" in change and change["id"] is not None
    ]

    def item(change: dict[str, Any]) -> dict[str, Any]:
        change_id = change.get("id")
        return {
            "text": _summary_change_text(change),
            "evidenceIds": [change_id] if change_id is not None else [],
        }

    background = [
        item(change)
        for change in changes
        if change.get("category") in _SUMMARY_BACKGROUND_CATEGORIES
    ]
    assessment = [
        item(change)
        for change in changes
        if change.get("category") in _SUMMARY_ASSESSMENT_CATEGORIES
    ]
    assessment.extend(
        item(change)
        for change in changes
        if change.get("category") not in _SUMMARY_BACKGROUND_CATEGORIES
        and change.get("category") not in _SUMMARY_ASSESSMENT_CATEGORIES
    )

    raw_warnings = comparison.get("dataWarnings", [])
    if isinstance(raw_warnings, (list, tuple, set)):
        warnings = sorted({str(warning) for warning in raw_warnings if warning})
    else:
        warnings = []

    return {
        "mode": "deterministic",
        "sections": {
            "situation": [
                {
                    "text": _summary_situation_text(comparison, len(changes)),
                    "evidenceIds": evidence_ids.copy(),
                }
            ],
            "background": background,
            "assessment": assessment,
            "recommendation": [
                {"text": _SUMMARY_RECOMMENDATION, "evidenceIds": []}
            ],
        },
        "evidenceIds": evidence_ids,
        "warnings": warnings,
    }


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
        str(change["label"]),
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
