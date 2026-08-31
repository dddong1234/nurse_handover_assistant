from __future__ import annotations

from collections import defaultdict
from copy import deepcopy
from datetime import datetime, timezone
import hashlib
import json
import re
from typing import Any

from services.handover_service import build_handover_comparison


_PRIORITY_ORDER = {"high": 0, "medium": 1, "low": 2}
_GROUP_NAMES = ("current", "periodOnly", "trends", "recordEvents")
_RECOMMENDATION = "간호사가 확인할 후속 항목을 입력하세요."
_MISSING = object()
_MEDICATION_FIELDS = ("name", "route", "frequency")


def _timestamp_error(field: str) -> ValueError:
    return ValueError(
        f"{field} must be an offset-aware ISO 8601 timestamp"
    )


def _parse_timestamp(value: Any, field: str) -> datetime:
    if not isinstance(value, str) or not value.strip():
        raise _timestamp_error(field)

    normalized = value.strip()
    if normalized.endswith(("Z", "z")):
        normalized = f"{normalized[:-1]}+00:00"
    try:
        parsed = datetime.fromisoformat(normalized)
    except ValueError as exc:
        raise _timestamp_error(field) from exc
    if parsed.tzinfo is None or parsed.utcoffset() is None:
        raise _timestamp_error(field)
    return parsed


def _slug(value: Any) -> str:
    text = str(value).strip().lower()
    text = re.sub(r"[^0-9a-z가-힣]+", "-", text)
    return text.strip("-") or "item"


def _identifier_fragment(value: Any) -> str:
    text = str(value).strip()
    text = re.sub(r"[^0-9A-Za-z가-힣]+", "-", text)
    return text.strip("-") or "item"


def _field_identifier(category: str, field: str) -> str:
    # Notes are free text. Keep the review/event identifiers deterministic
    # without exposing the original note content in an identifier.
    if category == "notes":
        digest = hashlib.sha256(_json_key(field).encode("utf-8")).hexdigest()[:12]
        return f"note-{digest}"
    return _identifier_fragment(field)


def _json_key(value: Any) -> str:
    try:
        return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    except (TypeError, ValueError):
        return repr(value)


def _patient_context(record: dict[str, Any]) -> dict[str, Any]:
    diagnoses = record.get("diagnosis", [])
    if not isinstance(diagnoses, list):
        diagnoses = []
    return {
        "id": record.get("patient_id", ""),
        "name": record.get("name", ""),
        "room": record.get("room_no", ""),
        "age": record.get("age"),
        "sex": record.get("sex", ""),
        "diagnoses": deepcopy(diagnoses),
    }


def _validate_records(records: Any) -> tuple[list[dict[str, Any]], list[datetime]]:
    if not isinstance(records, list) or not records:
        raise ValueError("records must be a non-empty list")

    parsed_records: list[tuple[datetime, int, dict[str, Any]]] = []
    patient_ids: list[Any] = []
    for index, record in enumerate(records):
        if not isinstance(record, dict):
            raise ValueError(f"records[{index}] must be an object")
        patient_id = record.get("patient_id")
        if patient_id is None or patient_id == "":
            raise ValueError(f"records[{index}].patient_id is required")
        if not any(patient_id == known_id for known_id in patient_ids):
            patient_ids.append(patient_id)
        parsed = _parse_timestamp(record.get("updated_at"), f"records[{index}].updated_at")
        parsed_records.append((parsed, index, record))

    if len(patient_ids) != 1:
        raise ValueError("all records must belong to the same patient")

    seen_timestamps: set[datetime] = set()
    for parsed, _, _ in parsed_records:
        if parsed in seen_timestamps:
            raise ValueError("duplicate snapshot timestamps are not allowed")
        seen_timestamps.add(parsed)

    parsed_records.sort(key=lambda item: (item[0], item[1]))
    ordered = [record for _, _, record in parsed_records]
    ordered_times = [parsed for parsed, _, _ in parsed_records]
    return ordered, ordered_times


def _validate_coverage_gaps(
    coverage_gaps: Any,
    *,
    period_start: datetime,
    period_end: datetime,
) -> list[str]:
    if coverage_gaps is None:
        return []
    if not isinstance(coverage_gaps, list):
        raise ValueError("coverage_gaps must be a list")

    warnings: list[str] = []
    for index, gap in enumerate(coverage_gaps):
        if not isinstance(gap, dict):
            raise ValueError(f"coverage_gaps[{index}] must be an object")
        gap_from = _parse_timestamp(gap.get("from"), f"coverage_gaps[{index}].from")
        gap_to = _parse_timestamp(gap.get("to"), f"coverage_gaps[{index}].to")
        if gap_to < gap_from:
            raise ValueError(
                f"coverage_gaps[{index}].to must be on or after coverage_gaps[{index}].from"
            )
        if gap_from <= period_end and gap_to >= period_start:
            code = gap.get("code") or "unspecified"
            warnings.append(
                f"coverage gap: {code} ({gap['from']} -> {gap['to']})"
            )
    return warnings


def _is_complete_medication(value: Any) -> bool:
    return (
        isinstance(value, dict)
        and set(value) == set(_MEDICATION_FIELDS)
        and all(
            isinstance(value.get(field), str) and value[field].strip()
            for field in _MEDICATION_FIELDS
        )
    )


def _medication_warnings(side: str, record: dict[str, Any]) -> list[str]:
    medications = record.get("medications", [])
    if not isinstance(medications, list):
        return []

    warnings: list[str] = []
    expected_fields = set(_MEDICATION_FIELDS)
    for index, medication in enumerate(medications):
        path = f"{side}.medications[{index}]"
        if not isinstance(medication, dict):
            warnings.append(path)
            continue
        for field in _MEDICATION_FIELDS:
            value = medication.get(field)
            if not isinstance(value, str) or not value.strip():
                warnings.append(f"{path}.{field}")
        for field in sorted(set(medication) - expected_fields, key=str):
            warnings.append(f"{path}.{field}")
    return warnings


def _invalid_medication_names(record: dict[str, Any]) -> set[str]:
    medications = record.get("medications", [])
    if not isinstance(medications, list):
        return set()
    return {
        medication["name"]
        for medication in medications
        if isinstance(medication, dict)
        and isinstance(medication.get("name"), str)
        and medication["name"].strip()
        and not _is_complete_medication(medication)
    }


def _is_period_safe_change(
    change: dict[str, Any],
    invalid_medication_names: set[str],
) -> bool:
    if change.get("category") != "medications":
        return True
    if str(change.get("label", "")) in invalid_medication_names:
        return False
    return all(
        value is None or _is_complete_medication(value)
        for value in (change.get("previousValue"), change.get("currentValue"))
    )


def _period_comparable_record(record: dict[str, Any]) -> dict[str, Any]:
    medications = record.get("medications")
    if not isinstance(medications, list):
        return record
    comparable = dict(record)
    comparable["medications"] = [
        medication for medication in medications if _is_complete_medication(medication)
    ]
    return comparable


def _medication_map(record: dict[str, Any]) -> dict[Any, dict[str, Any]]:
    medications = record.get("medications", [])
    if not isinstance(medications, list):
        return {}
    return {
        str(medication.get("name")): medication
        for medication in medications
        if _is_complete_medication(medication)
    }


def _diagnosis_state(record: dict[str, Any], label: str) -> Any:
    diagnoses = record.get("diagnosis", [])
    if not isinstance(diagnoses, list):
        return _MISSING
    return True if label in diagnoses else _MISSING


def _medication_state(record: dict[str, Any], label: str) -> Any:
    medication = _medication_map(record).get(label, _MISSING)
    if medication is _MISSING:
        return _MISSING
    return _json_key(medication)


def _lifecycle_state(
    record: dict[str, Any] | None,
    category: str,
    label: str,
) -> Any:
    if record is None:
        return _MISSING
    if category == "diagnosis":
        return _diagnosis_state(record, label)
    if category == "medications":
        return _medication_state(record, label)
    return _MISSING


def _change_field(change: dict[str, Any]) -> str:
    category = str(change.get("category", ""))
    evidence = change.get("evidence")
    if isinstance(evidence, dict):
        field_path = evidence.get("fieldPath")
        if isinstance(field_path, str) and field_path:
            if category == "vitals" and field_path.startswith("vitals."):
                return field_path.split(".", 1)[1]
            match = re.match(r"[^\[]+\[\"(.*)\"\]$", field_path)
            if match:
                return match.group(1)
    return str(change.get("label", ""))


def _event_base_id(
    patient_id: Any,
    change: dict[str, Any],
    detected_at: str,
) -> str:
    category = str(change.get("category", "unknown"))
    field = _change_field(change)
    change_type = str(change.get("changeType", "modified"))
    return (
        f"event:{_identifier_fragment(patient_id)}:{_slug(category)}:{_field_identifier(category, field)}:"
        f"{detected_at}:{_slug(change_type)}"
    )


def _event_id(
    patient_id: Any,
    change: dict[str, Any],
    detected_at: str,
    duplicate_base: bool,
) -> str:
    base = _event_base_id(patient_id, change, detected_at)
    if not duplicate_base:
        return base
    fingerprint = hashlib.sha256(_json_key(change).encode("utf-8")).hexdigest()[:12]
    return f"{base}:{fingerprint}"


def _event_group_key(event: dict[str, Any]) -> tuple[str, str]:
    change = event["change"]
    category = str(change.get("category", "unknown"))
    return category, _change_field(change)


def _review_group_name(classification: str) -> str:
    return {
        "current": "current",
        "period_only": "periodOnly",
        "trend": "trends",
        "record_event": "recordEvents",
    }.get(classification, "recordEvents")


def _priority(event: dict[str, Any]) -> int:
    priority = event.get("change", {}).get("reviewPriority")
    return _PRIORITY_ORDER.get(priority, len(_PRIORITY_ORDER))


def _event_datetime(event: dict[str, Any]) -> datetime:
    return _parse_timestamp(event["detectedAt"], "event.detectedAt")


def _event_sort_key(event: dict[str, Any]) -> tuple[Any, ...]:
    timestamp = _event_datetime(event).astimezone(timezone.utc).timestamp()
    change = event["change"]
    return (
        _priority(event),
        -timestamp,
        str(change.get("category", "")),
        str(event.get("id", "")),
    )


def _chronological_event_key(event: dict[str, Any]) -> tuple[Any, ...]:
    timestamp = _event_datetime(event).astimezone(timezone.utc).timestamp()
    return (timestamp, str(event.get("id", "")))


def _review_item_id(patient_id: Any, category: str, field: str) -> str:
    return f"review:{_slug(patient_id)}:{_slug(category)}:{_field_identifier(category, field)}"


def _review_item_id_with_collision_guard(
    patient_id: Any,
    category: str,
    field: str,
    duplicate_base: bool,
) -> str:
    base = _review_item_id(patient_id, category, field)
    if not duplicate_base:
        return base
    fingerprint = hashlib.sha256(
        _json_key([category, field]).encode("utf-8")
    ).hexdigest()[:12]
    return f"{base}:{fingerprint}"


def _build_review_groups(
    events: list[dict[str, Any]],
    patient_id: Any,
) -> dict[str, list[dict[str, Any]]]:
    grouped: dict[tuple[str, str], list[dict[str, Any]]] = defaultdict(list)
    for event in events:
        grouped[_event_group_key(event)].append(event)

    sortable: dict[str, list[tuple[tuple[Any, ...], dict[str, Any]]]] = {
        name: [] for name in _GROUP_NAMES
    }
    base_counts: dict[str, int] = defaultdict(int)
    for category, field in grouped:
        base_counts[_review_item_id(patient_id, category, field)] += 1

    for (category, field), grouped_events in grouped.items():
        grouped_events = sorted(grouped_events, key=_chronological_event_key)
        classification = grouped_events[0]["classification"]
        group_name = _review_group_name(classification)
        latest_event = max(grouped_events, key=_chronological_event_key)
        item = {
            "id": _review_item_id_with_collision_guard(
                patient_id,
                category,
                field,
                base_counts[_review_item_id(patient_id, category, field)] > 1,
            ),
            "category": category,
            "label": str(grouped_events[0]["change"].get("label", field)),
            "classification": classification,
            "eventIds": [event["id"] for event in grouped_events],
        }
        # The item deliberately contains no copied value or evidence. The event
        # list remains the single source of those facts.
        sortable[group_name].append(
            (
                (
                    _priority(latest_event),
                    -_event_datetime(latest_event)
                    .astimezone(timezone.utc)
                    .timestamp(),
                    category,
                    item["id"],
                ),
                item,
            )
        )

    result: dict[str, list[dict[str, Any]]] = {}
    for group_name in _GROUP_NAMES:
        result[group_name] = [
            item for _, item in sorted(sortable[group_name], key=lambda pair: pair[0])
        ]
    return result


def _classify_event(
    change: dict[str, Any],
    *,
    lifecycle_baseline: dict[str, Any] | None,
    current: dict[str, Any],
) -> str:
    category = change.get("category")
    if category in {"diagnosis", "medications"}:
        label = str(change.get("label", ""))
        baseline_state = _lifecycle_state(lifecycle_baseline, category, label)
        current_state = _lifecycle_state(current, category, label)
        return "period_only" if baseline_state == current_state else "current"
    if category == "vitals":
        return "trend"
    if category == "notes":
        return "record_event"
    return "record_event"


def build_handover_period_comparison(
    records: list[dict[str, Any]],
    review_start_at: str,
    coverage_gaps: list[dict[str, str]] | None = None,
) -> dict[str, Any]:
    """Return the validated deterministic period comparison."""

    review_start = _parse_timestamp(review_start_at, "review_start_at")
    ordered, ordered_times = _validate_records(records)
    baseline_index: int | None = None
    for index, recorded_at in enumerate(ordered_times):
        if recorded_at <= review_start:
            baseline_index = index
        else:
            break

    if baseline_index is None:
        included_records = [
            record
            for record, recorded_at in zip(ordered, ordered_times)
            if recorded_at > review_start
        ]
        lifecycle_baseline = included_records[0] if included_records else None
    else:
        included_records = ordered[baseline_index:]
        lifecycle_baseline = included_records[0]

    current_record = ordered[-1]
    current_recorded_at = current_record.get("updated_at")
    baseline_recorded_at = (
        included_records[0].get("updated_at") if baseline_index is not None else None
    )
    period_end = ordered_times[-1]

    warnings = _validate_coverage_gaps(
        coverage_gaps,
        period_start=review_start,
        period_end=period_end,
    )

    raw_events: list[dict[str, Any]] = []
    for previous, current in zip(included_records, included_records[1:]):
        invalid_medication_names = (
            _invalid_medication_names(previous)
            | _invalid_medication_names(current)
        )
        pair_result = build_handover_comparison(
            _period_comparable_record(previous),
            _period_comparable_record(current),
        )
        warnings.extend(pair_result.get("dataWarnings", []))
        warnings.extend(_medication_warnings("previous", previous))
        warnings.extend(_medication_warnings("current", current))
        for change in pair_result.get("changes", []):
            if not isinstance(change, dict):
                continue
            if not _is_period_safe_change(change, invalid_medication_names):
                continue
            change_copy = deepcopy(change)
            detected_at = str(current.get("updated_at"))
            raw_events.append(
                {
                    "detectedAt": detected_at,
                    "interval": {
                        "previousRecordedAt": previous.get("updated_at"),
                        "currentRecordedAt": current.get("updated_at"),
                    },
                    "change": change_copy,
                }
            )

    if len(included_records) < 2:
        warnings.extend(_medication_warnings("current", current_record))

    base_ids = [
        _event_base_id(
            current_record.get("patient_id", ""),
            raw_event["change"],
            raw_event["detectedAt"],
        )
        for raw_event in raw_events
    ]
    base_counts: dict[str, int] = defaultdict(int)
    for base_id in base_ids:
        base_counts[base_id] += 1

    events: list[dict[str, Any]] = []
    for raw_event, base_id in zip(raw_events, base_ids):
        change = raw_event["change"]
        event_id = _event_id(
            current_record.get("patient_id", ""),
            change,
            raw_event["detectedAt"],
            base_counts[base_id] > 1,
        )
        events.append(
            {
                "id": event_id,
                "detectedAt": raw_event["detectedAt"],
                "interval": raw_event["interval"],
                "classification": _classify_event(
                    change,
                    lifecycle_baseline=lifecycle_baseline,
                    current=current_record,
                ),
                "change": change,
            }
        )

    events.sort(key=_event_sort_key)
    review_groups = _build_review_groups(
        events,
        current_record.get("patient_id", ""),
    )

    warnings = sorted({str(warning) for warning in warnings if warning})
    if warnings:
        status = "partial"
    elif baseline_index is None:
        status = "no_baseline"
    elif not events:
        status = "no_events"
    else:
        status = "ready"

    return {
        "patient": _patient_context(current_record),
        "period": {
            "requestedStartAt": review_start_at,
            "baselineRecordedAt": baseline_recorded_at,
            "currentRecordedAt": current_recorded_at,
            "snapshotCount": len(included_records),
            "eventCount": len(events),
            "status": status,
        },
        "dataWarnings": warnings,
        "events": events,
        "reviewGroups": review_groups,
    }


def _summary_value(value: Any) -> str:
    if value is None:
        return "없음"
    if isinstance(value, dict):
        return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    if isinstance(value, list):
        return json.dumps(value, ensure_ascii=False, separators=(",", ":"))
    return str(value)


def _summary_item(text: str, event_ids: list[str], known_ids: set[str]) -> dict[str, Any]:
    return {
        "text": text,
        "evidenceIds": [event_id for event_id in event_ids if event_id in known_ids],
    }


def _summary_situation(period_comparison: dict[str, Any], event_ids: list[str]) -> str:
    patient = period_comparison.get("patient", {})
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

    period = period_comparison.get("period", {})
    if not isinstance(period, dict):
        period = {}
    baseline = period.get("baselineRecordedAt")
    current = period.get("currentRecordedAt") or "현재 기록 시각 없음"
    count = period.get("eventCount", len(event_ids))
    if baseline:
        interval = f"기준 {baseline} → 현재 {current}"
    else:
        interval = f"기준 기록 없음 · 현재 {current}"
    return f"{patient_text} · {room_text} · {interval} · 기간 변화 {count}건"


def _classification_text(classification: str) -> str:
    return {
        "current": "현재 반영",
        "period_only": "기간 중 변경",
        "trend": "추세",
        "record_event": "기록 사건",
    }.get(classification, classification)


def _background_text(item: dict[str, Any]) -> str:
    subject = "진단" if item.get("category") == "diagnosis" else "투약"
    return (
        f"{subject} {item.get('label', '')} · "
        f"{_classification_text(str(item.get('classification', '')))}"
    )


def _assessment_text(item: dict[str, Any], events_by_id: dict[str, dict[str, Any]]) -> str:
    classification = item.get("classification")
    label = item.get("label", "")
    event_ids = item.get("eventIds", [])
    item_events = [events_by_id[event_id] for event_id in event_ids if event_id in events_by_id]
    if classification == "trend":
        values: list[str] = []
        if item_events:
            first_change = item_events[0].get("change", {})
            values.append(_summary_value(first_change.get("previousValue")))
            values.extend(
                _summary_value(event.get("change", {}).get("currentValue"))
                for event in item_events
            )
        return f"{label} 추세: {' → '.join(values)}"

    actions = []
    for event in item_events:
        change_type = event.get("change", {}).get("changeType")
        if change_type == "added":
            actions.append("추가")
        elif change_type == "removed":
            actions.append("삭제")
        else:
            actions.append(str(change_type or "변경"))
    action_text = ", ".join(actions) if actions else "기록"
    return f"간호 메모 {label} · {action_text}"


def build_deterministic_period_summary(
    period_comparison: dict[str, Any],
) -> dict[str, Any]:
    """Return SBAR items that reference period event IDs."""

    if not isinstance(period_comparison, dict):
        period_comparison = {}
    raw_events = period_comparison.get("events", [])
    events = [event for event in raw_events if isinstance(event, dict) and event.get("id")]
    event_ids = [str(event["id"]) for event in events]
    known_ids = set(event_ids)
    events_by_id = {str(event["id"]): event for event in events}

    groups = period_comparison.get("reviewGroups", {})
    if not isinstance(groups, dict):
        groups = {}
    background_items: list[dict[str, Any]] = []
    for group_name in ("current", "periodOnly"):
        items = groups.get(group_name, [])
        if not isinstance(items, list):
            continue
        for item in items:
            if not isinstance(item, dict):
                continue
            ids = [str(event_id) for event_id in item.get("eventIds", [])]
            background_items.append(
                _summary_item(_background_text(item), ids, known_ids)
            )

    assessment_items: list[dict[str, Any]] = []
    for group_name in ("trends", "recordEvents"):
        items = groups.get(group_name, [])
        if not isinstance(items, list):
            continue
        for item in items:
            if not isinstance(item, dict):
                continue
            ids = [str(event_id) for event_id in item.get("eventIds", [])]
            assessment_items.append(
                _summary_item(_assessment_text(item, events_by_id), ids, known_ids)
            )

    warnings = period_comparison.get("dataWarnings", [])
    if not isinstance(warnings, (list, tuple, set)):
        warnings = []

    return {
        "mode": "deterministic",
        "sections": {
            "situation": [
                _summary_item(
                    _summary_situation(period_comparison, event_ids),
                    event_ids,
                    known_ids,
                )
            ],
            "background": background_items,
            "assessment": assessment_items,
            "recommendation": [
                {"text": _RECOMMENDATION, "evidenceIds": []}
            ],
        },
        "evidenceIds": event_ids,
        "warnings": sorted({str(warning) for warning in warnings if warning}),
    }
