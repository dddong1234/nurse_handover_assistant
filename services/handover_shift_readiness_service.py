from __future__ import annotations

from collections import defaultdict
from copy import deepcopy
from datetime import datetime, timezone
import hashlib
import json
import re
from typing import Any
from urllib.parse import quote, unquote

from services.handover_period_service import _event_base_id as _period_event_base_id
from services.handover_period_service import _event_id as _period_event_id
from services.handover_period_service import build_handover_period_comparison


__all__ = ["build_shift_readiness"]


RULE_CODES = {
    "STATUS_PERIOD_CHANGE",
    "INVESTIGATION_NEW_RESULT",
    "INVESTIGATION_SCHEDULED_SHIFT",
    "INVESTIGATION_PENDING",
    "DEVICE_DUE_SHIFT",
    "DEVICE_RECENT_CHANGE",
    "MEDICATION_EFFECTIVE_SHIFT",
    "MEDICATION_RECENT_CHANGE",
    "COMMUNICATION_EXPLICIT_OPEN",
}

DOMAIN_GROUPS = {
    "patient_status": "patientStatus",
    "investigation": "investigations",
    "line_device": "lineDevices",
    "medication": "medications",
    "communication": "communications",
}

_DOMAIN_ORDER = tuple(DOMAIN_GROUPS)
_INVESTIGATION_KINDS = {"lab", "imaging"}
_INVESTIGATION_STATUSES = {
    "ordered",
    "scheduled",
    "in_progress",
    "resulted",
    "cancelled",
}
_DEVICE_STATUSES = {"active", "removal_ordered", "removed"}
_MEDICATION_ORDER_STATUSES = {"planned", "active", "stopped"}
_HANDOFF_SOURCE_TYPES = {"physician_order", "nursing_note"}
_HANDOFF_STATUSES = {"open", "communicated", "cancelled"}
_PENDING_INVESTIGATION_STATUSES = {"ordered", "scheduled", "in_progress"}
_CORE_FIELDS = (
    "patient_id",
    "name",
    "room_no",
    "age",
    "sex",
    "diagnosis",
    "vitals",
    "medications",
    "notes",
    "updated_at",
)
_MEDICATION_CORE_FIELDS = ("name", "route", "frequency")
_SOURCE_SELECTOR_RE = re.compile(
    r"^(investigations|devices|medications|handoffRequests)\[(id|name)=([^\]]+)\]$"
)
_PERCENT_ESCAPE_RE = re.compile(r"%[0-9A-F]{2}")
_PATIENT_ID_FRAGMENT_RE = re.compile(r"[^0-9A-Za-z가-힣]+")

_WARNING_SOURCE_ARRAY = {
    "investigations": "SHIFT_READINESS_INVALID_INVESTIGATIONS_ARRAY",
    "devices": "SHIFT_READINESS_INVALID_DEVICES_ARRAY",
    "handoffRequests": "SHIFT_READINESS_INVALID_HANDOFF_REQUESTS_ARRAY",
}
_WARNING_SOURCE_ITEM = {
    "investigations": "SHIFT_READINESS_INCOMPLETE_INVESTIGATION_SOURCE",
    "devices": "SHIFT_READINESS_INCOMPLETE_DEVICE_SOURCE",
    "medications": "SHIFT_READINESS_INCOMPLETE_MEDICATION_SOURCE",
    "handoffRequests": "SHIFT_READINESS_INCOMPLETE_HANDOFF_SOURCE",
}
_WARNING_ORPHAN = "SHIFT_READINESS_ORPHAN_SOURCE"
_WARNING_PERIOD = "SHIFT_READINESS_INVALID_PERIOD_SOURCE"


def _timestamp_error(field: str) -> ValueError:
    return ValueError(f"{field} must be an offset-aware ISO 8601 timestamp")


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
    return _PATIENT_ID_FRAGMENT_RE.sub("-", str(value).strip()).strip("-") or "item"


def _json_key(value: Any) -> str:
    try:
        return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    except (TypeError, ValueError):
        return repr(value)


def _digest(value: Any) -> str:
    return hashlib.sha256(_json_key(value).encode("utf-8")).hexdigest()[:12]


def _core_record(record: dict[str, Any]) -> dict[str, Any]:
    """Project one logical snapshot to the immutable period-comparison schema."""

    if not isinstance(record, dict):
        raise ValueError("records must contain objects")
    projected: dict[str, Any] = {
        key: deepcopy(record[key]) for key in _CORE_FIELDS if key in record
    }
    medications = record.get("medications")
    if isinstance(medications, list):
        projected["medications"] = []
        for medication in medications:
            if not isinstance(medication, dict):
                projected["medications"].append(deepcopy(medication))
                continue
            projected["medications"].append(
                {
                    key: deepcopy(medication[key])
                    for key in _MEDICATION_CORE_FIELDS
                    if key in medication
                }
            )
    elif "medications" in record:
        projected["medications"] = deepcopy(medications)
    return projected


def _validate_records(
    records: Any,
) -> tuple[list[dict[str, Any]], list[datetime]]:
    if not isinstance(records, list) or not records:
        raise ValueError("records must be a non-empty list")

    patient_ids: list[str] = []
    parsed: list[tuple[datetime, int, dict[str, Any]]] = []
    for index, record in enumerate(records):
        if not isinstance(record, dict):
            raise ValueError(f"records[{index}] must be an object")
        patient_id = record.get("patient_id")
        if not isinstance(patient_id, str) or not patient_id.strip():
            raise ValueError(f"records[{index}].patient_id is required")
        if patient_id not in patient_ids:
            patient_ids.append(patient_id)
        recorded_at = _parse_timestamp(
            record.get("updated_at"), f"records[{index}].updated_at"
        )
        parsed.append((recorded_at, index, record))

    if len(patient_ids) != 1:
        raise ValueError("all records must belong to the same patient")

    seen: set[datetime] = set()
    for recorded_at, _, _ in parsed:
        if recorded_at in seen:
            raise ValueError("duplicate snapshot timestamps are not allowed")
        seen.add(recorded_at)

    parsed.sort(key=lambda value: (value[0], value[1]))
    return (
        [record for _, _, record in parsed],
        [recorded_at for recorded_at, _, _ in parsed],
    )


def _validate_shift(shift: Any) -> tuple[str, str, datetime, datetime]:
    if not isinstance(shift, dict):
        raise ValueError("shift must be an object")
    starts_at = shift.get("startsAt")
    ends_at = shift.get("endsAt")
    starts = _parse_timestamp(starts_at, "shift.startsAt")
    ends = _parse_timestamp(ends_at, "shift.endsAt")
    if starts >= ends:
        raise ValueError("shift.startsAt must be before shift.endsAt")
    return starts_at, ends_at, starts, ends


def _source_array(
    record: dict[str, Any],
    field: str,
    warnings: set[str],
) -> list[Any]:
    value = record.get(field, [])
    if value is None:
        return []
    if not isinstance(value, list):
        warnings.add(_WARNING_SOURCE_ARRAY.get(field, f"SHIFT_READINESS_INVALID_{field.upper()}_ARRAY"))
        return []
    return value


def _optional_timestamp(
    source: dict[str, Any],
    field: str,
    warning: str,
) -> tuple[datetime | None, bool]:
    value = source.get(field)
    if value is None:
        return None, True
    try:
        return _parse_timestamp(value, field), True
    except ValueError:
        return None, False


def _entry(
    source: dict[str, Any],
    parsed: dict[str, Any],
    recorded_at: str,
    recorded_dt: datetime,
) -> dict[str, Any]:
    return {
        "source": source,
        "parsed": parsed,
        "recordedAt": recorded_at,
        "recorded_dt": recorded_dt,
    }


def _collect_investigations(
    records: list[dict[str, Any]],
    recorded_times: list[datetime],
    warnings: set[str],
) -> tuple[dict[str, list[dict[str, Any]]], set[str]]:
    by_id: dict[str, list[dict[str, Any]]] = defaultdict(list)
    invalid_current: set[str] = set()
    for record, recorded_dt in zip(records, recorded_times):
        seen_ids: set[str] = set()
        values = _source_array(record, "investigations", warnings)
        for source in values:
            if not isinstance(source, dict):
                warnings.add(_WARNING_SOURCE_ITEM["investigations"])
                continue
            source_id = source.get("id")
            if not isinstance(source_id, str) or not source_id.strip():
                warnings.add(_WARNING_SOURCE_ITEM["investigations"])
                continue
            if source_id in seen_ids:
                raise ValueError("duplicate investigation source IDs are not allowed")
            seen_ids.add(source_id)
            kind = source.get("kind")
            if kind is None:
                warnings.add(_WARNING_SOURCE_ITEM["investigations"])
                if recorded_dt == recorded_times[-1]:
                    invalid_current.add(source_id)
                continue
            if kind not in _INVESTIGATION_KINDS:
                raise ValueError("unsupported investigation kind")
            status = source.get("status")
            if status is None:
                warnings.add(_WARNING_SOURCE_ITEM["investigations"])
                if recorded_dt == recorded_times[-1]:
                    invalid_current.add(source_id)
                continue
            if status not in _INVESTIGATION_STATUSES:
                raise ValueError("unsupported investigation status")
            if not isinstance(source.get("name"), str) or not source["name"].strip():
                warnings.add(_WARNING_SOURCE_ITEM["investigations"])
                if recorded_dt == recorded_times[-1]:
                    invalid_current.add(source_id)
                continue
            try:
                ordered_at = _parse_timestamp(source.get("orderedAt"), "investigation.orderedAt")
                scheduled_at, scheduled_ok = _optional_timestamp(
                    source, "scheduledAt", _WARNING_SOURCE_ITEM["investigations"]
                )
                resulted_at, resulted_ok = _optional_timestamp(
                    source, "resultedAt", _WARNING_SOURCE_ITEM["investigations"]
                )
            except ValueError:
                scheduled_ok = resulted_ok = False
                ordered_at = None
                scheduled_at = resulted_at = None
            result_summary = source.get("resultSummary")
            summary_ok = result_summary is None or (
                isinstance(result_summary, str) and bool(result_summary.strip())
            )
            if not scheduled_ok or not resulted_ok or not summary_ok or ordered_at is None:
                warnings.add(_WARNING_SOURCE_ITEM["investigations"])
                if recorded_dt == recorded_times[-1]:
                    invalid_current.add(source_id)
                continue
            parsed = {
                "id": source_id,
                "kind": kind,
                "name": source["name"],
                "orderedAt": ordered_at,
                "scheduledAt": scheduled_at,
                "status": status,
                "resultedAt": resulted_at,
                "resultSummary": result_summary,
            }
            by_id[source_id].append(_entry(source, parsed, record["updated_at"], recorded_dt))
    return dict(by_id), invalid_current


def _collect_devices(
    records: list[dict[str, Any]],
    recorded_times: list[datetime],
    warnings: set[str],
) -> tuple[dict[str, list[dict[str, Any]]], set[str]]:
    by_id: dict[str, list[dict[str, Any]]] = defaultdict(list)
    invalid_current: set[str] = set()
    for record, recorded_dt in zip(records, recorded_times):
        seen_ids: set[str] = set()
        values = _source_array(record, "devices", warnings)
        for source in values:
            if not isinstance(source, dict):
                warnings.add(_WARNING_SOURCE_ITEM["devices"])
                continue
            source_id = source.get("id")
            if not isinstance(source_id, str) or not source_id.strip():
                warnings.add(_WARNING_SOURCE_ITEM["devices"])
                continue
            if source_id in seen_ids:
                raise ValueError("duplicate device source IDs are not allowed")
            seen_ids.add(source_id)
            status = source.get("status")
            if status is None:
                warnings.add(_WARNING_SOURCE_ITEM["devices"])
                if recorded_dt == recorded_times[-1]:
                    invalid_current.add(source_id)
                continue
            if status not in _DEVICE_STATUSES:
                raise ValueError("unsupported device status")
            if not isinstance(source.get("type"), str) or not source["type"].strip():
                warnings.add(_WARNING_SOURCE_ITEM["devices"])
                if recorded_dt == recorded_times[-1]:
                    invalid_current.add(source_id)
                continue
            if not isinstance(source.get("site"), str) or not source["site"].strip():
                warnings.add(_WARNING_SOURCE_ITEM["devices"])
                if recorded_dt == recorded_times[-1]:
                    invalid_current.add(source_id)
                continue
            try:
                inserted_at = _parse_timestamp(source.get("insertedAt"), "device.insertedAt")
                change_due_at, due_ok = _optional_timestamp(
                    source, "changeDueAt", _WARNING_SOURCE_ITEM["devices"]
                )
                removed_at, removed_ok = _optional_timestamp(
                    source, "removedAt", _WARNING_SOURCE_ITEM["devices"]
                )
            except ValueError:
                inserted_at = None
                change_due_at = removed_at = None
                due_ok = removed_ok = False
            if inserted_at is None or not due_ok or not removed_ok:
                warnings.add(_WARNING_SOURCE_ITEM["devices"])
                if recorded_dt == recorded_times[-1]:
                    invalid_current.add(source_id)
                continue
            parsed = {
                "id": source_id,
                "type": source["type"],
                "site": source["site"],
                "insertedAt": inserted_at,
                "changeDueAt": change_due_at,
                "status": status,
                "removedAt": removed_at,
            }
            by_id[source_id].append(_entry(source, parsed, record["updated_at"], recorded_dt))
    return dict(by_id), invalid_current


def _collect_medications(
    records: list[dict[str, Any]],
    recorded_times: list[datetime],
    warnings: set[str],
) -> tuple[dict[str, list[dict[str, Any]]], set[str]]:
    by_name: dict[str, list[dict[str, Any]]] = defaultdict(list)
    invalid_current: set[str] = set()
    for record, recorded_dt in zip(records, recorded_times):
        medications = record.get("medications", [])
        if medications is None:
            medications = []
        if not isinstance(medications, list):
            warnings.add(_WARNING_SOURCE_ARRAY.get("medications", "SHIFT_READINESS_INVALID_MEDICATIONS_ARRAY"))
            continue
        seen_names: set[str] = set()
        for source in medications:
            if not isinstance(source, dict):
                warnings.add(_WARNING_SOURCE_ITEM["medications"])
                continue
            name = source.get("name")
            if not isinstance(name, str) or not name.strip():
                warnings.add(_WARNING_SOURCE_ITEM["medications"])
                continue
            if name in seen_names:
                raise ValueError("duplicate medication source names are not allowed")
            seen_names.add(name)
            if any(
                not isinstance(source.get(field), str) or not source[field].strip()
                for field in _MEDICATION_CORE_FIELDS
            ):
                warnings.add(_WARNING_SOURCE_ITEM["medications"])
                if recorded_dt == recorded_times[-1]:
                    invalid_current.add(name)
                continue
            effective_from, from_ok = _optional_timestamp(
                source, "effectiveFrom", _WARNING_SOURCE_ITEM["medications"]
            )
            effective_to, to_ok = _optional_timestamp(
                source, "effectiveTo", _WARNING_SOURCE_ITEM["medications"]
            )
            order_status = source.get("orderStatus")
            if order_status is not None and order_status not in _MEDICATION_ORDER_STATUSES:
                raise ValueError("unsupported medication order status")
            if not from_ok or not to_ok or (
                effective_from is not None
                and effective_to is not None
                and effective_to < effective_from
            ):
                warnings.add(_WARNING_SOURCE_ITEM["medications"])
                if recorded_dt == recorded_times[-1]:
                    invalid_current.add(name)
                continue
            parsed = {
                "name": name,
                "route": source["route"],
                "frequency": source["frequency"],
                "effectiveFrom": effective_from,
                "effectiveTo": effective_to,
                "orderStatus": order_status or "active",
            }
            by_name[name].append(_entry(source, parsed, record["updated_at"], recorded_dt))
    return dict(by_name), invalid_current


def _collect_handoff_requests(
    records: list[dict[str, Any]],
    recorded_times: list[datetime],
    warnings: set[str],
) -> tuple[dict[str, list[dict[str, Any]]], set[str]]:
    by_id: dict[str, list[dict[str, Any]]] = defaultdict(list)
    invalid_current: set[str] = set()
    for record, recorded_dt in zip(records, recorded_times):
        seen_ids: set[str] = set()
        values = _source_array(record, "handoffRequests", warnings)
        for source in values:
            if not isinstance(source, dict):
                warnings.add(_WARNING_SOURCE_ITEM["handoffRequests"])
                continue
            source_id = source.get("id")
            if not isinstance(source_id, str) or not source_id.strip():
                warnings.add(_WARNING_SOURCE_ITEM["handoffRequests"])
                continue
            if source_id in seen_ids:
                raise ValueError("duplicate handoff request source IDs are not allowed")
            seen_ids.add(source_id)
            if source.get("sourceType") not in _HANDOFF_SOURCE_TYPES:
                raise ValueError("unsupported handoff request source type")
            status = source.get("status")
            if status is None:
                warnings.add(_WARNING_SOURCE_ITEM["handoffRequests"])
                if recorded_dt == recorded_times[-1]:
                    invalid_current.add(source_id)
                continue
            if status not in _HANDOFF_STATUSES:
                raise ValueError("unsupported handoff request status")
            if not isinstance(source.get("topic"), str) or not source["topic"].strip():
                warnings.add(_WARNING_SOURCE_ITEM["handoffRequests"])
                if recorded_dt == recorded_times[-1]:
                    invalid_current.add(source_id)
                continue
            try:
                requested_at = _parse_timestamp(source.get("requestedAt"), "handoffRequest.requestedAt")
                due_by, due_ok = _optional_timestamp(
                    source, "dueBy", _WARNING_SOURCE_ITEM["handoffRequests"]
                )
            except ValueError:
                requested_at = None
                due_by = None
                due_ok = False
            if requested_at is None or not due_ok:
                warnings.add(_WARNING_SOURCE_ITEM["handoffRequests"])
                if recorded_dt == recorded_times[-1]:
                    invalid_current.add(source_id)
                continue
            parsed = {
                "id": source_id,
                "topic": source["topic"],
                "requestedAt": requested_at,
                "dueBy": due_by,
                "sourceType": source["sourceType"],
                "status": status,
            }
            by_id[source_id].append(_entry(source, parsed, record["updated_at"], recorded_dt))
    return dict(by_id), invalid_current


def _direct_path(collection: str, selector: str, value: str) -> str:
    return f"{collection}[{selector}={quote(value, safe='-._~')}]"


def _direct_ref(collection: str, selector: str, value: str, entry: dict[str, Any], label: str) -> dict[str, Any]:
    return {
        "recordedAt": entry["recordedAt"],
        "path": _direct_path(collection, selector, value),
        "label": label,
    }


def _period_ref(event: dict[str, Any]) -> dict[str, Any] | None:
    event_id = event.get("id")
    interval = event.get("interval")
    change = event.get("change")
    if not isinstance(event_id, str) or not event_id:
        return None
    if not isinstance(interval, dict) or not isinstance(change, dict):
        return None
    evidence = change.get("evidence")
    if not isinstance(evidence, dict):
        return None
    recorded_at = interval.get("currentRecordedAt")
    field_path = evidence.get("fieldPath")
    if not isinstance(recorded_at, str) or not isinstance(field_path, str) or not field_path:
        return None
    return {
        "recordedAt": recorded_at,
        "path": field_path,
        "label": str(change.get("label") or field_path),
        "periodEventId": event_id,
    }


def _time_in_window(value: datetime | None, starts: datetime, ends: datetime) -> bool:
    return value is not None and starts <= value < ends


def _time_after_review(value: datetime | None, review_start: datetime, current: datetime) -> bool:
    return value is not None and review_start < value <= current


def _current_entries(
    entries: list[dict[str, Any]],
    current_dt: datetime,
) -> list[dict[str, Any]]:
    return [entry for entry in entries if entry["recorded_dt"] == current_dt]


def _source_time_text(entry: dict[str, Any], field: str, fallback: datetime | None) -> str | None:
    value = entry["source"].get(field)
    if isinstance(value, str) and value.strip():
        return value.strip()
    return fallback.isoformat() if fallback is not None else None


def _source_refs(entries: list[dict[str, Any]], collection: str, selector: str, value: str, label: str) -> list[dict[str, Any]]:
    refs: list[dict[str, Any]] = []
    seen: set[tuple[str, str]] = set()
    for entry in sorted(entries, key=lambda item: (item["recorded_dt"], item["recordedAt"])):
        ref = _direct_ref(collection, selector, value, entry, label)
        key = (ref["recordedAt"], ref["path"])
        if key not in seen:
            seen.add(key)
            refs.append(ref)
    return refs


def _make_item(
    *,
    patient_id: str,
    domain: str,
    fact_status: str,
    title: str,
    detail: str,
    relevant_at: str | None,
    source_refs: list[dict[str, Any]],
    rule_code: str,
    id_seed: Any,
) -> dict[str, Any]:
    if rule_code not in RULE_CODES:
        raise ValueError("unsupported Shift Readiness rule code")
    return {
        "id": f"readiness:{_slug(patient_id)}:{_slug(domain)}:{_digest([id_seed, fact_status, relevant_at])}",
        "patientId": patient_id,
        "domain": domain,
        "factStatus": fact_status,
        "title": title,
        "detail": detail,
        "relevantAt": relevant_at,
        "sourceRefs": source_refs,
        "ruleCode": rule_code,
    }


def _display_value(value: Any) -> str:
    if value is None:
        return "없음"
    if isinstance(value, (dict, list)):
        return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return str(value)


def _valid_period_field_path(category: Any, path: Any) -> bool:
    if not isinstance(category, str) or not isinstance(path, str):
        return False
    if category == "vitals":
        return path.startswith("vitals.") and path.count(".") == 1 and bool(path[7:])
    if category not in {"diagnosis", "notes", "medications"}:
        return False
    prefix = f"{category}["
    if not path.startswith(prefix) or not path.endswith("]"):
        return False
    encoded_value = path[len(prefix) : -1]
    try:
        value = json.loads(encoded_value)
    except (TypeError, ValueError):
        return False
    return isinstance(value, str) and (
        f"{category}[{json.dumps(value, ensure_ascii=False, separators=(',', ':'))}]"
        == path
    )


def _period_status_events(
    period: dict[str, Any],
    patient_id: str,
    recorded_values: set[str],
    warnings: set[str],
) -> tuple[dict[str, dict[str, Any]], list[dict[str, Any]]]:
    events = period.get("events")
    if not isinstance(events, list):
        raise ValueError("period.events must be a list")
    expected_prefix = f"event:{_identifier_fragment(patient_id)}:"
    event_map: dict[str, dict[str, Any]] = {}
    status_events: list[dict[str, Any]] = []
    base_ids: list[str] = []
    base_counts: dict[str, int] = defaultdict(int)
    for event in events:
        if not isinstance(event, dict) or not isinstance(event.get("change"), dict):
            continue
        detected_at = event.get("detectedAt")
        if not isinstance(detected_at, str):
            continue
        base_id = _period_event_base_id(patient_id, event["change"], detected_at)
        base_ids.append(base_id)
        base_counts[base_id] += 1
    expected_ids: set[str] = set()
    base_index = 0
    for event in events:
        if not isinstance(event, dict) or not isinstance(event.get("change"), dict):
            continue
        detected_at = event.get("detectedAt")
        if not isinstance(detected_at, str):
            continue
        base_id = base_ids[base_index]
        base_index += 1
        expected_ids.add(
            _period_event_id(
                patient_id,
                event["change"],
                detected_at,
                base_counts[base_id] > 1,
            )
        )
    for event in events:
        if not isinstance(event, dict):
            warnings.add(_WARNING_PERIOD)
            continue
        event_id = event.get("id")
        interval = event.get("interval")
        change = event.get("change")
        evidence = change.get("evidence") if isinstance(change, dict) else None
        current_recorded_at = interval.get("currentRecordedAt") if isinstance(interval, dict) else None
        previous_recorded_at = interval.get("previousRecordedAt") if isinstance(interval, dict) else None
        path = evidence.get("fieldPath") if isinstance(evidence, dict) else None
        if (
            not isinstance(event_id, str)
            or not event_id.startswith(expected_prefix)
            or event_id not in expected_ids
            or not isinstance(interval, dict)
            or not isinstance(current_recorded_at, str)
            or current_recorded_at not in recorded_values
            or not isinstance(previous_recorded_at, str)
            or previous_recorded_at not in recorded_values
            or not isinstance(change, dict)
            or not isinstance(evidence, dict)
            or not isinstance(path, str)
            or not path
        ):
            warnings.add(_WARNING_PERIOD)
            continue
        if event_id in event_map:
            raise ValueError("duplicate period event IDs are not allowed")
        category = change.get("category")
        if category not in {"diagnosis", "vitals", "notes", "medications"}:
            warnings.add(_WARNING_PERIOD)
            continue
        if not _valid_period_field_path(category, path):
            warnings.add(_WARNING_PERIOD)
            continue
        event_map[event_id] = event
        if category == "medications":
            continue
        status_events.append(event)
    return event_map, status_events


def _build_patient_status_items(
    events: list[dict[str, Any]],
    patient_id: str,
    warnings: set[str],
) -> list[dict[str, Any]]:
    grouped: dict[tuple[str, str], list[dict[str, Any]]] = defaultdict(list)
    for event in events:
        change = event["change"]
        grouped[(str(change["category"]), str(change["evidence"]["fieldPath"]))].append(event)

    items: list[dict[str, Any]] = []
    for (category, path), group in grouped.items():
        group.sort(
            key=lambda event: (
                _parse_timestamp(event["interval"]["currentRecordedAt"], "event.interval.currentRecordedAt"),
                str(event["id"]),
            )
        )
        refs: list[dict[str, Any]] = []
        for event in group:
            ref = _period_ref(event)
            if ref is not None:
                refs.append(ref)
            else:
                warnings.add(_WARNING_PERIOD)
        if not refs:
            warnings.add(_WARNING_ORPHAN)
            continue
        latest = group[-1]
        change = latest["change"]
        label = str(change.get("label") or path)
        title = f"{label} 변경"
        detail = (
            f"{label}: {_display_value(change.get('previousValue'))}"
            f" → {_display_value(change.get('currentValue'))}"
        )
        relevant_at = latest["interval"]["currentRecordedAt"]
        refs.sort(key=lambda ref: (ref["recordedAt"], ref["periodEventId"], ref["path"]))
        items.append(
            _make_item(
                patient_id=patient_id,
                domain="patient_status",
                fact_status="recent_change",
                title=title,
                detail=detail,
                relevant_at=relevant_at,
                source_refs=refs,
                rule_code="STATUS_PERIOD_CHANGE",
                id_seed=["patient_status", category, path],
            )
        )
    return items


def _build_investigation_items(
    entries_by_id: dict[str, list[dict[str, Any]]],
    invalid_current: set[str],
    patient_id: str,
    current_dt: datetime,
    review_start: datetime,
    shift_starts: datetime,
    shift_ends: datetime,
) -> list[dict[str, Any]]:
    items: list[dict[str, Any]] = []
    for source_id in sorted(entries_by_id):
        if source_id in invalid_current:
            continue
        entries = entries_by_id[source_id]
        current_entries = _current_entries(entries, current_dt)
        if not current_entries:
            continue
        current = max(current_entries, key=lambda entry: entry["recorded_dt"])
        source = current["parsed"]
        status = source["status"]
        if status == "cancelled":
            continue
        scheduled = (
            status in _PENDING_INVESTIGATION_STATUSES
            and source["resultedAt"] is None
            and _time_in_window(source["scheduledAt"], shift_starts, shift_ends)
        )
        new_result = (
            status == "resulted"
            and _time_after_review(source["resultedAt"], review_start, current_dt)
        )
        pending = status in _PENDING_INVESTIGATION_STATUSES and not scheduled
        if scheduled:
            fact_status = "scheduled_this_shift"
            rule_code = "INVESTIGATION_SCHEDULED_SHIFT"
            relevant_at = _source_time_text(current, "scheduledAt", source["scheduledAt"])
            title = f"{source['name']} 예정"
            detail = f"{source['name']} · 예정 시각 {relevant_at}"
        elif new_result:
            fact_status = "new_result"
            rule_code = "INVESTIGATION_NEW_RESULT"
            relevant_at = _source_time_text(current, "resultedAt", source["resultedAt"])
            title = f"{source['name']} 새 결과"
            detail = f"{source['name']} · {source['resultSummary'] or '결과 기록 있음'}"
        elif pending:
            fact_status = "pending_result"
            rule_code = "INVESTIGATION_PENDING"
            relevant_time = source["scheduledAt"] or source["orderedAt"]
            relevant_field = "scheduledAt" if source["scheduledAt"] is not None else "orderedAt"
            relevant_at = _source_time_text(current, relevant_field, relevant_time)
            title = f"{source['name']} 결과 대기"
            detail = f"{source['name']} · 현재 상태 {status}"
        else:
            continue
        label = str(source["name"])
        refs = _source_refs(entries, "investigations", "id", source_id, label)
        items.append(
            _make_item(
                patient_id=patient_id,
                domain="investigation",
                fact_status=fact_status,
                title=title,
                detail=detail,
                relevant_at=relevant_at,
                source_refs=refs,
                rule_code=rule_code,
                id_seed=["investigation", source_id, fact_status],
            )
        )
    return items


def _device_transition_candidates(
    entries: list[dict[str, Any]],
    ordered_times: list[datetime],
) -> list[tuple[datetime, dict[str, Any], dict[str, Any]]]:
    by_time = {entry["recorded_dt"]: entry for entry in entries}
    transitions: list[tuple[datetime, dict[str, Any], dict[str, Any]]] = []
    for previous_at, current_at in zip(ordered_times, ordered_times[1:]):
        previous = by_time.get(previous_at)
        current = by_time.get(current_at)
        if previous is None or current is None:
            continue
        if previous["parsed"]["status"] != current["parsed"]["status"]:
            transitions.append((current_at, previous, current))
    return transitions


def _build_device_items(
    entries_by_id: dict[str, list[dict[str, Any]]],
    invalid_current: set[str],
    patient_id: str,
    current_dt: datetime,
    review_start: datetime,
    shift_starts: datetime,
    shift_ends: datetime,
    ordered_times: list[datetime],
) -> list[dict[str, Any]]:
    items: list[dict[str, Any]] = []
    for source_id in sorted(entries_by_id):
        if source_id in invalid_current:
            continue
        entries = entries_by_id[source_id]
        current_entries = _current_entries(entries, current_dt)
        if not current_entries:
            continue
        current = max(current_entries, key=lambda entry: entry["recorded_dt"])
        source = current["parsed"]
        due = (
            source["status"] == "active"
            and _time_in_window(source["changeDueAt"], shift_starts, shift_ends)
        )
        recent_candidates: list[tuple[datetime, str | None]] = []
        if _time_after_review(source["insertedAt"], review_start, current_dt):
            recent_candidates.append(
                (source["insertedAt"], _source_time_text(current, "insertedAt", source["insertedAt"]))
            )
        if _time_after_review(source["removedAt"], review_start, current_dt):
            recent_candidates.append(
                (source["removedAt"], _source_time_text(current, "removedAt", source["removedAt"]))
            )
        transitions = _device_transition_candidates(entries, ordered_times)
        recent_candidates.extend(
            (transition_at, later["recordedAt"])
            for transition_at, _, later in transitions
            if review_start < transition_at <= current_dt
        )
        if due:
            fact_status = "scheduled_this_shift"
            rule_code = "DEVICE_DUE_SHIFT"
            relevant_at = _source_time_text(current, "changeDueAt", source["changeDueAt"])
            title = f"{source['type']} 교체 예정"
            detail = f"{source['type']} · {source['site']} · 예정 시각 {relevant_at}"
        elif recent_candidates:
            fact_status = "recent_change"
            rule_code = "DEVICE_RECENT_CHANGE"
            latest_recent, relevant_at = max(
                recent_candidates,
                key=lambda candidate: (candidate[0], candidate[1] or ""),
            )
            title = f"{source['type']} 최근 변경"
            detail = f"{source['type']} · {source['site']} · 현재 상태 {source['status']}"
        else:
            continue
        refs = _source_refs(entries, "devices", "id", source_id, f"{source['type']} · {source['site']}")
        items.append(
            _make_item(
                patient_id=patient_id,
                domain="line_device",
                fact_status=fact_status,
                title=title,
                detail=detail,
                relevant_at=relevant_at,
                source_refs=refs,
                rule_code=rule_code,
                id_seed=["line_device", source_id, fact_status],
            )
        )
    return items


def _build_medication_items(
    entries_by_name: dict[str, list[dict[str, Any]]],
    invalid_current: set[str],
    period_events: list[dict[str, Any]],
    patient_id: str,
    current_dt: datetime,
    shift_starts: datetime,
    shift_ends: datetime,
) -> list[dict[str, Any]]:
    medication_events: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for event in period_events:
        change = event.get("change", {})
        if change.get("category") == "medications":
            medication_events[str(change.get("label", ""))].append(event)

    items: list[dict[str, Any]] = []
    for name in sorted(entries_by_name):
        if name in invalid_current:
            continue
        entries = entries_by_name[name]
        current_entries = _current_entries(entries, current_dt)
        if not current_entries:
            continue
        current = max(current_entries, key=lambda entry: entry["recorded_dt"])
        source = current["parsed"]
        active = source["orderStatus"] != "stopped"
        effective_shift = active and _time_in_window(
            source["effectiveFrom"], shift_starts, shift_ends
        )
        matched_events = sorted(
            medication_events.get(name, []),
            key=lambda event: (
                _parse_timestamp(event["interval"]["currentRecordedAt"], "event.interval.currentRecordedAt"),
                str(event["id"]),
            ),
        )
        recent_change = active and bool(matched_events)
        if effective_shift:
            fact_status = "scheduled_this_shift"
            rule_code = "MEDICATION_EFFECTIVE_SHIFT"
            relevant_at = _source_time_text(current, "effectiveFrom", source["effectiveFrom"])
            title = f"{name} 적용"
            detail = f"{name} · 적용 시각 {relevant_at} · {source['route']} · {source['frequency']}"
        elif recent_change:
            fact_status = "recent_change"
            rule_code = "MEDICATION_RECENT_CHANGE"
            latest_event = matched_events[-1]
            relevant_at = latest_event["interval"]["currentRecordedAt"]
            title = f"{name} 최근 변경"
            detail = f"{name} · {source['route']} · {source['frequency']}"
        else:
            continue
        refs = _source_refs(entries, "medications", "name", name, name)
        if recent_change and not effective_shift:
            refs.extend(
                ref
                for event in matched_events
                if (ref := _period_ref(event)) is not None
            )
        items.append(
            _make_item(
                patient_id=patient_id,
                domain="medication",
                fact_status=fact_status,
                title=title,
                detail=detail,
                relevant_at=relevant_at,
                source_refs=refs,
                rule_code=rule_code,
                id_seed=["medication", name, fact_status],
            )
        )
    return items


def _build_communication_items(
    entries_by_id: dict[str, list[dict[str, Any]]],
    invalid_current: set[str],
    patient_id: str,
    current_dt: datetime,
    shift_ends: datetime,
) -> list[dict[str, Any]]:
    items: list[dict[str, Any]] = []
    for source_id in sorted(entries_by_id):
        if source_id in invalid_current:
            continue
        entries = entries_by_id[source_id]
        current_entries = _current_entries(entries, current_dt)
        if not current_entries:
            continue
        current = max(current_entries, key=lambda entry: entry["recorded_dt"])
        source = current["parsed"]
        if source["status"] != "open":
            continue
        if source["dueBy"] is not None and source["dueBy"] > shift_ends:
            continue
        if source["requestedAt"] > current_dt:
            continue
        relevant_time = source["dueBy"] or source["requestedAt"]
        relevant_at = _source_time_text(current, "dueBy", source["dueBy"])
        if source["dueBy"] is None:
            relevant_at = _source_time_text(current, "requestedAt", source["requestedAt"])
        refs = _source_refs(entries, "handoffRequests", "id", source_id, source["topic"])
        items.append(
            _make_item(
                patient_id=patient_id,
                domain="communication",
                fact_status="explicit_follow_up",
                title=f"전달 요청 · {source['topic']}",
                detail=f"{source['topic']} · {source['sourceType']} · 기한 {relevant_at}",
                relevant_at=relevant_at,
                source_refs=refs,
                rule_code="COMMUNICATION_EXPLICIT_OPEN",
                id_seed=["communication", source_id, "explicit_follow_up"],
            )
        )
    return items


def _parse_selector(path: Any) -> tuple[str, str, str] | None:
    if not isinstance(path, str):
        return None
    match = _SOURCE_SELECTOR_RE.fullmatch(path)
    if match is None:
        return None
    collection, selector, encoded = match.groups()
    if not encoded or re.fullmatch(
        r"(?:[A-Za-z0-9\-._~]|%[0-9A-F]{2})+", encoded
    ) is None:
        return None
    decoded = unquote(encoded)
    if quote(decoded, safe="-._~") != encoded:
        return None
    expected_selector = "name" if collection == "medications" else "id"
    if selector != expected_selector:
        return None
    return collection, selector, decoded


def _direct_ref_matches_record(
    ref: dict[str, Any],
    records_by_time: dict[str, dict[str, Any]],
) -> bool:
    parsed = _parse_selector(ref.get("path"))
    if parsed is None:
        return False
    collection, selector, target = parsed
    recorded_at = ref.get("recordedAt")
    if not isinstance(recorded_at, str) or recorded_at not in records_by_time:
        return False
    values = records_by_time[recorded_at].get(collection, [])
    if not isinstance(values, list):
        return False
    key = "name" if selector == "name" else "id"
    return any(isinstance(value, dict) and value.get(key) == target for value in values)


def _validate_source_refs(
    items: list[dict[str, Any]],
    records_by_time: dict[str, dict[str, Any]],
    period_events: dict[str, dict[str, Any]],
    warnings: set[str],
) -> list[dict[str, Any]]:
    valid_items: list[dict[str, Any]] = []
    for item in items:
        refs = item.get("sourceRefs")
        if not isinstance(refs, list):
            warnings.add(_WARNING_ORPHAN)
            continue
        valid_refs: list[dict[str, Any]] = []
        seen_refs: set[tuple[Any, ...]] = set()
        had_invalid_ref = False
        for ref in refs:
            if not isinstance(ref, dict):
                had_invalid_ref = True
                continue
            recorded_at = ref.get("recordedAt")
            path = ref.get("path")
            label = ref.get("label")
            if (
                not isinstance(recorded_at, str)
                or not isinstance(path, str)
                or not isinstance(label, str)
                or not label.strip()
            ):
                had_invalid_ref = True
                continue
            period_event_id = ref.get("periodEventId")
            if period_event_id is not None:
                event = period_events.get(period_event_id)
                if event is None:
                    had_invalid_ref = True
                    continue
                expected = _period_ref(event)
                if expected is None or (
                    expected["recordedAt"] != recorded_at
                    or expected["path"] != path
                ):
                    had_invalid_ref = True
                    continue
                key = ("period", period_event_id, recorded_at, path)
            else:
                if not _direct_ref_matches_record(ref, records_by_time):
                    had_invalid_ref = True
                    continue
                if _parse_selector(path) is None:
                    had_invalid_ref = True
                    continue
                key = ("direct", recorded_at, path)
            if key not in seen_refs:
                seen_refs.add(key)
                clean_ref = {
                    "recordedAt": recorded_at,
                    "path": path,
                    "label": label,
                }
                if period_event_id is not None:
                    clean_ref["periodEventId"] = period_event_id
                valid_refs.append(clean_ref)
        if not valid_refs:
            warnings.add(_WARNING_ORPHAN)
            continue
        if had_invalid_ref:
            warnings.add(_WARNING_ORPHAN)
        valid_refs.sort(
            key=lambda ref: (
                _parse_timestamp(ref["recordedAt"], "sourceRef.recordedAt"),
                str(ref.get("periodEventId", "")),
                ref["path"],
            )
        )
        item["sourceRefs"] = valid_refs
        valid_items.append(item)
    return valid_items


def _source_sort_id(item: dict[str, Any]) -> str:
    refs = item.get("sourceRefs", [])
    if item.get("domain") == "patient_status":
        period_ids = sorted(
            str(ref["periodEventId"])
            for ref in refs
            if isinstance(ref, dict) and ref.get("periodEventId")
        )
        if period_ids:
            return period_ids[0]
    for ref in refs:
        if isinstance(ref, dict):
            parsed = _parse_selector(ref.get("path"))
            if parsed is not None:
                return parsed[2]
    raise ValueError("source ID is required for deterministic ordering")


def count_status(items: list[dict[str, Any]], status: str) -> int:
    return sum(item["factStatus"] == status for item in items)


def _ordered_items(items: list[dict[str, Any]]) -> tuple[list[dict[str, Any]], dict[str, list[str]]]:
    grouped: dict[str, list[dict[str, Any]]] = {domain: [] for domain in _DOMAIN_ORDER}
    seen_ids: set[str] = set()
    for item in items:
        item_id = item.get("id")
        domain = item.get("domain")
        if not isinstance(item_id, str) or not item_id or item_id in seen_ids:
            raise ValueError("Shift Readiness item IDs must be unique")
        if domain not in grouped:
            raise ValueError("unsupported Shift Readiness domain")
        seen_ids.add(item_id)
        grouped[domain].append(item)

    def sort_key(item: dict[str, Any]) -> tuple[Any, ...]:
        relevant_at = item.get("relevantAt")
        if relevant_at is None:
            relevant_key: tuple[Any, ...] = (1, 0.0)
        else:
            relevant_key = (
                0,
                _parse_timestamp(relevant_at, "item.relevantAt")
                .astimezone(timezone.utc)
                .timestamp(),
            )
        return relevant_key + (_source_sort_id(item), str(item["id"]))

    ordered: list[dict[str, Any]] = []
    groups: dict[str, list[str]] = {}
    for domain in _DOMAIN_ORDER:
        grouped[domain].sort(key=sort_key)
        ordered.extend(grouped[domain])
        groups[DOMAIN_GROUPS[domain]] = [item["id"] for item in grouped[domain]]
    return ordered, groups


def build_shift_readiness(
    records: list[dict[str, Any]],
    review_start_at: str,
    shift: dict[str, str],
    coverage_gaps: list[dict[str, str]] | None = None,
) -> dict[str, Any]:
    """Project logical snapshots into deterministic, source-backed shift tasks."""

    review_start = _parse_timestamp(review_start_at, "review_start_at")
    shift_starts_text, shift_ends_text, shift_starts, shift_ends = _validate_shift(shift)
    ordered_records, ordered_times = _validate_records(records)
    current_record = ordered_records[-1]
    current_dt = ordered_times[-1]
    if not (shift_starts <= current_dt < shift_ends):
        raise ValueError("current snapshot must be inside the shift window")
    patient_id = current_record["patient_id"]

    warnings: set[str] = set()
    investigation_entries, invalid_investigations = _collect_investigations(
        ordered_records, ordered_times, warnings
    )
    device_entries, invalid_devices = _collect_devices(
        ordered_records, ordered_times, warnings
    )
    medication_entries, invalid_medications = _collect_medications(
        ordered_records, ordered_times, warnings
    )
    handoff_entries, invalid_requests = _collect_handoff_requests(
        ordered_records, ordered_times, warnings
    )

    core_records = [_core_record(record) for record in ordered_records]
    period = build_handover_period_comparison(
        core_records,
        review_start_at,
        deepcopy(coverage_gaps or []),
    )
    if not isinstance(period, dict):
        raise ValueError("period comparison must return an object")
    period_data_warnings = period.get("dataWarnings", [])
    if not isinstance(period_data_warnings, list):
        raise ValueError("period.dataWarnings must be a list")
    warnings.update(str(warning) for warning in period_data_warnings if warning)
    period_meta = period.get("period")
    if not isinstance(period_meta, dict):
        raise ValueError("period comparison metadata is required")
    if period_meta.get("currentRecordedAt") != current_record.get("updated_at"):
        raise ValueError("period current timestamp does not match logical current snapshot")

    records_by_time = {
        record["updated_at"]: record for record in ordered_records
    }
    event_map, status_events = _period_status_events(
        period,
        patient_id,
        set(records_by_time),
        warnings,
    )
    all_period_events = list(event_map.values())

    items: list[dict[str, Any]] = []
    items.extend(_build_patient_status_items(status_events, patient_id, warnings))
    items.extend(
        _build_investigation_items(
            investigation_entries,
            invalid_investigations,
            patient_id,
            current_dt,
            review_start,
            shift_starts,
            shift_ends,
        )
    )
    items.extend(
        _build_device_items(
            device_entries,
            invalid_devices,
            patient_id,
            current_dt,
            review_start,
            shift_starts,
            shift_ends,
            ordered_times,
        )
    )
    items.extend(
        _build_medication_items(
            medication_entries,
            invalid_medications,
            all_period_events,
            patient_id,
            current_dt,
            shift_starts,
            shift_ends,
        )
    )
    items.extend(
        _build_communication_items(
            handoff_entries,
            invalid_requests,
            patient_id,
            current_dt,
            shift_ends,
        )
    )

    items = _validate_source_refs(items, records_by_time, event_map, warnings)
    ordered_items, groups = _ordered_items(items)
    baseline_recorded_at = period_meta.get("baselineRecordedAt")
    review_period = {
        "requestedStartAt": review_start_at,
        "baselineRecordedAt": baseline_recorded_at,
        "currentRecordedAt": current_record.get("updated_at"),
    }
    metrics = {
        "itemCount": len(ordered_items),
        "newResultCount": count_status(ordered_items, "new_result"),
        "scheduledThisShiftCount": count_status(ordered_items, "scheduled_this_shift"),
        "pendingResultCount": count_status(ordered_items, "pending_result"),
        "domainCounts": {
            domain: len(groups[group_name])
            for domain, group_name in DOMAIN_GROUPS.items()
        },
    }
    if baseline_recorded_at is None:
        status = "no_baseline"
    elif warnings:
        status = "partial"
    elif not ordered_items:
        status = "no_items"
    else:
        status = "available"
    return {
        "patient": deepcopy(period.get("patient", {})),
        "reviewPeriod": review_period,
        "shift": {"startsAt": shift_starts_text, "endsAt": shift_ends_text},
        "status": status,
        "dataWarnings": sorted(warnings),
        "items": ordered_items,
        "groups": groups,
        "metrics": metrics,
    }
