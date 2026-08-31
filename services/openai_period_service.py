from __future__ import annotations

from collections import Counter
from copy import deepcopy
import json
import re
from typing import Any, Literal, TypedDict


AI_FALLBACK_USED = "AI_FALLBACK_USED"
_MODEL = "gpt-5-mini"
_SECTIONS = ("situation", "background", "assessment", "recommendation")
_FORBIDDEN_INTERPRETATIONS = (
    "해결",
    "완료",
    "호전",
    "악화",
    "안정",
    "정상",
    "위험",
    "즉시",
    "보고",
    "권고",
    "추천",
    "우선순위",
    "공백",
    "resolved",
    "completed",
    "improved",
    "worsened",
    "stable",
    "urgent",
    "priority",
    "coverage gap",
)
_NUMBER_PATTERN = re.compile(r"(?<![\w])[-+]?\d+(?:[.,]\d+)?")
_PRIORITY_VALUE_PATTERN = re.compile(r"(?<![\w])(?:high|medium|low)(?![\w])", re.IGNORECASE)
_WORD_PATTERN = re.compile(r"[A-Za-z0-9_]+|[가-힣]+")
_FACT_BOUNDARY_PREFIX = r"(?<![A-Za-z0-9_])"
_FACT_BOUNDARY_SUFFIX = r"(?![A-Za-z0-9_])"
_SAFE_WORDS = {
    "added",
    "addition",
    "assessment",
    "background",
    "changed",
    "change",
    "current",
    "diagnosis",
    "from",
    "is",
    "medication",
    "medications",
    "modified",
    "new",
    "note",
    "notes",
    "period_only",
    "record_event",
    "removed",
    "to",
    "trend",
    "가",
    "간호",
    "격리",
    "기록",
    "까지",
    "는",
    "및",
    "메모",
    "변경",
    "변화",
    "부",
    "부터",
    "사건",
    "새",
    "새로",
    "새로운",
    "수치",
    "으로",
    "은",
    "을",
    "의",
    "이",
    "인",
    "에서",
    "추가",
    "확인",
    "현재",
    "활력징후",
    "삭제",
    "제거",
    "해제",
    "중단",
    "중",
    "종료",
    "추세",
    "진단",
    "투약",
    "약",
    "되",
    "됨",
    "됐",
    "되었",
    "습니다",
    "어요",
    "다",
    "로",
    "를",
    "반영",
    "아니",
    "또는",
}
_SAFE_WORD_STEMS = (
    "추가",
    "등록",
    "확인",
    "삭제",
    "제거",
    "해제",
    "중단",
    "변경",
    "변화",
    "조정",
    "수정",
    "되었",
    "됐",
    "되",
    "기록",
    "반영",
)


class HandoverPeriodSummaryItem(TypedDict):
    text: str
    evidenceIds: list[str]


class HandoverPeriodSummarySections(TypedDict):
    situation: list[HandoverPeriodSummaryItem]
    background: list[HandoverPeriodSummaryItem]
    assessment: list[HandoverPeriodSummaryItem]
    recommendation: list[HandoverPeriodSummaryItem]


class HandoverPeriodSummary(TypedDict):
    mode: Literal["deterministic", "ai"]
    sections: HandoverPeriodSummarySections
    evidenceIds: list[str]
    warnings: list[str]


_SUMMARY_JSON_SCHEMA: dict[str, Any] = {
    "type": "object",
    "additionalProperties": False,
    "properties": {
        "sections": {
            "type": "object",
            "additionalProperties": False,
            "properties": {
                section: {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "additionalProperties": False,
                        "properties": {
                            "text": {"type": "string"},
                            "evidenceIds": {
                                "type": "array",
                                "items": {"type": "string"},
                            },
                        },
                        "required": ["text", "evidenceIds"],
                    },
                }
                for section in _SECTIONS
            },
            "required": list(_SECTIONS),
        }
    },
    "required": ["sections"],
}

_INSTRUCTIONS = (
    "Rewrite only the wording of the deterministic return-handover summary. "
    "Use only the supplied patient, period, events, review groups, and summary. "
    "You may move evidence-backed items between SBAR sections and rephrase them, "
    "but do not add, remove, calculate, interpret, or recommend any fact. Preserve "
    "every event ID, source value, timestamp, classification, priority, gap, and "
    "evidence relationship. Return only the requested JSON object."
)


def _fallback_summary(
    deterministic_summary: Any,
    warning: str = AI_FALLBACK_USED,
) -> HandoverPeriodSummary:
    """Return a defensive deterministic copy with one fallback warning."""

    if isinstance(deterministic_summary, dict):
        fallback: dict[str, Any] = deepcopy(deterministic_summary)
    else:
        fallback = {
            "mode": "deterministic",
            "sections": {section: [] for section in _SECTIONS},
            "evidenceIds": [],
            "warnings": [],
        }

    fallback["mode"] = "deterministic"
    raw_warnings = fallback.get("warnings", [])
    warnings = list(raw_warnings) if isinstance(raw_warnings, (list, tuple, set)) else []
    if warning not in warnings:
        warnings.append(warning)
    fallback["warnings"] = warnings
    return fallback  # type: ignore[return-value]


def _patient_identifiers(comparison: Any) -> dict[str, Any]:
    patient = comparison.get("patient", {}) if isinstance(comparison, dict) else {}
    if not isinstance(patient, dict):
        patient = {}
    return {
        "id": patient.get("id", ""),
        "name": patient.get("name", ""),
        "room": patient.get("room", ""),
    }


def _request_input(comparison: Any, deterministic_summary: Any) -> str:
    comparison_dict = comparison if isinstance(comparison, dict) else {}
    period = comparison_dict.get("period", {})
    if not isinstance(period, dict):
        period = {}
    events = comparison_dict.get("events", [])
    if not isinstance(events, list):
        events = []
    review_groups = comparison_dict.get("reviewGroups", {})
    if not isinstance(review_groups, dict):
        review_groups = {}
    payload = {
        "patient": _patient_identifiers(comparison_dict),
        "period": deepcopy(period),
        "events": deepcopy(events),
        "reviewGroups": deepcopy(review_groups),
        "deterministicSummary": deepcopy(deterministic_summary),
    }
    return json.dumps(payload, ensure_ascii=False, separators=(",", ":"))


def _request_kwargs(comparison: Any, deterministic_summary: Any) -> dict[str, Any]:
    return {
        "model": _MODEL,
        "instructions": _INSTRUCTIONS,
        "input": _request_input(comparison, deterministic_summary),
        "text": {
            "format": {
                "type": "json_schema",
                "name": "handover_period_summary",
                "strict": True,
                "schema": deepcopy(_SUMMARY_JSON_SCHEMA),
            }
        },
        "store": False,
    }


def _response_output_text(response: Any) -> str:
    if isinstance(response, str):
        output_text = response
    elif isinstance(response, dict):
        output_text = response.get("output_text")
    else:
        output_text = getattr(response, "output_text", None)
    if not isinstance(output_text, str) or not output_text.strip():
        raise ValueError("missing structured output text")
    return output_text


def _scalar_values(value: Any):
    if isinstance(value, dict):
        for nested in value.values():
            yield from _scalar_values(nested)
    elif isinstance(value, (list, tuple, set)):
        for nested in value:
            yield from _scalar_values(nested)
    elif value is not None and not isinstance(value, bool):
        yield value


def _change_values(change: dict[str, Any]) -> tuple[Any, ...]:
    change_type = change.get("changeType")
    if change_type == "added":
        return (change.get("currentValue"),)
    if change_type == "removed":
        return (change.get("previousValue"),)
    return (change.get("previousValue"), change.get("currentValue"))


def _value_facts(value: Any) -> list[str]:
    facts: list[str] = []
    for leaf in _scalar_values(value):
        fact = str(leaf)
        if fact and fact not in facts:
            facts.append(fact)
    return facts


def _required_facts(event: dict[str, Any]) -> list[str]:
    change = event.get("change", {})
    if not isinstance(change, dict):
        return []
    facts: list[str] = []
    for value in _change_values(change):
        for fact in _value_facts(value):
            if fact not in facts:
                facts.append(fact)
    return facts


def _event_ids_and_map(comparison: Any) -> tuple[list[str], dict[str, dict[str, Any]]]:
    raw_events = comparison.get("events", []) if isinstance(comparison, dict) else []
    if not isinstance(raw_events, list):
        raise ValueError("period comparison has no event list")
    ordered_ids: list[str] = []
    events_by_id: dict[str, dict[str, Any]] = {}
    for event in raw_events:
        if not isinstance(event, dict):
            raise ValueError("period comparison has an invalid event")
        event_id = event.get("id")
        if not isinstance(event_id, str) or not event_id or event_id in events_by_id:
            raise ValueError("period comparison has duplicate or invalid event IDs")
        if not isinstance(event.get("detectedAt"), str):
            raise ValueError("period comparison has an invalid event timestamp")
        if not isinstance(event.get("interval"), dict):
            raise ValueError("period comparison has an invalid event interval")
        if not isinstance(event.get("classification"), str):
            raise ValueError("period comparison has an invalid classification")
        if not isinstance(event.get("change"), dict):
            raise ValueError("period comparison has an invalid change")
        ordered_ids.append(event_id)
        events_by_id[event_id] = event
    return ordered_ids, events_by_id


def _summary_pairs(summary: Any) -> set[tuple[str, tuple[str, ...]]]:
    pairs: set[tuple[str, tuple[str, ...]]] = set()
    if not isinstance(summary, dict):
        return pairs
    sections = summary.get("sections", {})
    if not isinstance(sections, dict):
        return pairs
    for section in _SECTIONS:
        items = sections.get(section, [])
        if not isinstance(items, list):
            continue
        for item in items:
            if not isinstance(item, dict):
                continue
            text = item.get("text")
            evidence_ids = item.get("evidenceIds")
            if isinstance(text, str) and isinstance(evidence_ids, list) and all(
                isinstance(event_id, str) for event_id in evidence_ids
            ):
                pairs.add((text, tuple(evidence_ids)))
    return pairs


def _no_evidence_counts(summary: Any) -> Counter[str]:
    counts: Counter[str] = Counter()
    if not isinstance(summary, dict):
        return counts
    sections = summary.get("sections", {})
    if not isinstance(sections, dict):
        return counts
    for section in _SECTIONS:
        items = sections.get(section, [])
        if not isinstance(items, list):
            continue
        for item in items:
            if isinstance(item, dict) and item.get("evidenceIds") == []:
                text = item.get("text")
                if isinstance(text, str):
                    counts[text] += 1
    return counts


def _summary_detail_ids(summary: Any) -> set[str]:
    result: set[str] = set()
    if not isinstance(summary, dict):
        return result
    sections = summary.get("sections", {})
    if not isinstance(sections, dict):
        return result
    for section in ("background", "assessment"):
        items = sections.get(section, [])
        if not isinstance(items, list):
            continue
        for item in items:
            if not isinstance(item, dict):
                continue
            ids = item.get("evidenceIds")
            if isinstance(ids, list) and all(isinstance(event_id, str) for event_id in ids):
                result.update(ids)
    return result


def _summary_detail_counts(summary: Any) -> Counter[str]:
    counts: Counter[str] = Counter()
    if not isinstance(summary, dict):
        return counts
    sections = summary.get("sections", {})
    if not isinstance(sections, dict):
        return counts
    for section in ("background", "assessment"):
        items = sections.get(section, [])
        if not isinstance(items, list):
            continue
        for item in items:
            if not isinstance(item, dict):
                continue
            evidence_ids = item.get("evidenceIds")
            if isinstance(evidence_ids, list) and all(
                isinstance(event_id, str) for event_id in evidence_ids
            ):
                counts.update(evidence_ids)
    return counts


def _summary_context_pairs(summary: Any) -> set[tuple[str, ...]]:
    """Return the evidence-ID tuples belonging to deterministic context items."""

    pairs: set[tuple[str, ...]] = set()
    if not isinstance(summary, dict):
        return pairs
    sections = summary.get("sections", {})
    if not isinstance(sections, dict):
        return pairs
    items = sections.get("situation", [])
    if not isinstance(items, list):
        return pairs
    for item in items:
        if not isinstance(item, dict):
            continue
        evidence_ids = item.get("evidenceIds")
        if isinstance(evidence_ids, list) and all(
            isinstance(event_id, str) for event_id in evidence_ids
        ):
            pairs.add(tuple(evidence_ids))
    return pairs


def _summary_context_counts(summary: Any) -> Counter[tuple[str, ...]]:
    counts: Counter[tuple[str, ...]] = Counter()
    if not isinstance(summary, dict):
        return counts
    sections = summary.get("sections", {})
    if not isinstance(sections, dict):
        return counts
    items = sections.get("situation", [])
    if not isinstance(items, list):
        return counts
    for item in items:
        if not isinstance(item, dict):
            continue
        evidence_ids = item.get("evidenceIds")
        if isinstance(evidence_ids, list) and all(
            isinstance(event_id, str) for event_id in evidence_ids
        ):
            if evidence_ids:
                counts[tuple(evidence_ids)] += 1
    return counts


def _numbers_in(values: Any) -> set[str]:
    numbers: set[str] = set()
    for value in _scalar_values(values):
        numbers.update(_NUMBER_PATTERN.findall(str(value)))
    return numbers


def _event_allowed_numbers(event: dict[str, Any]) -> set[str]:
    allowed = set(_numbers_in(_change_values(event.get("change", {}))))
    for value in (
        event.get("detectedAt"),
        event.get("interval", {}).get("previousRecordedAt")
        if isinstance(event.get("interval"), dict)
        else None,
        event.get("interval", {}).get("currentRecordedAt")
        if isinstance(event.get("interval"), dict)
        else None,
    ):
        allowed.update(_NUMBER_PATTERN.findall(str(value)))
    return allowed


def _classification_markers(classification: str) -> tuple[str, ...]:
    return {
        "current": ("현재 반영", "current"),
        "period_only": ("기간 중 종료", "period_only"),
        "trend": ("추세", "trend"),
        "record_event": ("기록 사건", "record_event"),
    }.get(classification, (classification,))


def _contains_any(text: str, markers: tuple[str, ...]) -> bool:
    lowered = text.casefold()
    return any(marker.casefold() in lowered for marker in markers)


def _fact_pattern(fact: str) -> str:
    return f"{_FACT_BOUNDARY_PREFIX}{re.escape(fact)}{_FACT_BOUNDARY_SUFFIX}"


def _find_fact(text: str, fact: str, start: int = 0) -> re.Match[str] | None:
    if not fact:
        return None
    return re.search(_fact_pattern(fact), text[start:], flags=re.IGNORECASE)


def _contains_fact(text: str, fact: str) -> bool:
    return _find_fact(text, fact) is not None


def _ordered_facts(text: str, facts: list[str], start: int = 0) -> int | None:
    position = start
    for fact in facts:
        match = _find_fact(text, fact, position)
        if match is None:
            return None
        position += match.start() + len(match.group(0))
    return position


def _strip_facts(text: str, facts: list[str]) -> str:
    remaining = text
    for fact in sorted(set(facts), key=len, reverse=True):
        if fact:
            remaining = re.sub(
                _fact_pattern(fact),
                " ",
                remaining,
                flags=re.IGNORECASE,
            )
    return remaining


def _contains_forbidden_outside_facts(text: str, facts: list[str]) -> bool:
    """Treat words inside source facts as data, not as added interpretation."""

    remaining = _strip_facts(text, facts)
    lowered = remaining.casefold()
    return any(term.casefold() in lowered for term in _FORBIDDEN_INTERPRETATIONS)


def _safe_wording_remainder(text: str, event: dict[str, Any]) -> str:
    change = event.get("change", {})
    if not isinstance(change, dict):
        return text
    facts = _required_facts(event)
    label = str(change.get("label", ""))
    remainder = _strip_facts(text, facts + [label])
    category = str(change.get("category", ""))
    category_words = {
        "diagnosis": ("진단", "diagnosis"),
        "medications": ("투약", "약", "medication", "medications"),
        "vitals": ("활력징후", "수치", "vital", "vitals"),
        "notes": ("간호", "메모", "기록", "note", "notes"),
    }.get(category, ())
    removable = list(category_words)
    removable.extend(_classification_markers(str(event.get("classification", ""))))
    change_type = str(change.get("changeType", ""))
    removable.extend(
        {
            "added": ("추가", "등록", "확인", "신규", "새", "새로", "added", "addition", "new"),
            "removed": ("삭제", "제거", "해제", "중단", "removed"),
            "modified": ("변경", "변화", "조정", "수정", "changed", "change", "modified"),
        }.get(change_type, ())
    )
    for word in sorted(set(removable), key=len, reverse=True):
        remainder = re.sub(
            _fact_pattern(word),
            " ",
            remainder,
            flags=re.IGNORECASE,
        )
    return remainder


def _validate_safe_wording(text: str, event: dict[str, Any]) -> None:
    remainder = _safe_wording_remainder(text, event)
    for token in _WORD_PATTERN.findall(remainder):
        lowered = token.casefold()
        if lowered in {word.casefold() for word in _SAFE_WORDS}:
            continue
        if any(lowered.startswith(stem.casefold()) for stem in _SAFE_WORD_STEMS):
            continue
        raise ValueError("summary contains unsupported clinical prose")


def _validate_change_text(text: str, event: dict[str, Any]) -> None:
    change = event.get("change", {})
    if not isinstance(change, dict):
        raise ValueError("summary references an invalid change")
    category = str(change.get("category", ""))
    change_type = str(change.get("changeType", ""))
    label = str(change.get("label", ""))
    if not label or not _contains_fact(text, label):
        raise ValueError("summary omits the changed field label")
    facts = _required_facts(event)
    if not facts or not all(_contains_fact(text, fact) for fact in facts):
        raise ValueError("summary omits a source value")
    if _contains_forbidden_outside_facts(text, facts):
        raise ValueError("summary contains an unsupported clinical interpretation")
    if _PRIORITY_VALUE_PATTERN.search(text):
        remaining = _strip_facts(text, facts + [label])
        if _PRIORITY_VALUE_PATTERN.search(remaining):
            raise ValueError("summary changes the event priority")

    observed_numbers = set(_NUMBER_PATTERN.findall(text))
    if not observed_numbers.issubset(_event_allowed_numbers(event)):
        raise ValueError("summary contains an unsupported number")
    if not _contains_any(text, _classification_markers(str(event.get("classification", "")))):
        raise ValueError("summary changes the event classification")
    classification_remainder = _strip_facts(text, facts + [label])
    for classification, markers in (
        ("current", _classification_markers("current")),
        ("period_only", _classification_markers("period_only")),
        ("trend", _classification_markers("trend")),
        ("record_event", _classification_markers("record_event")),
    ):
        if classification != str(event.get("classification", "")) and _contains_any(
            classification_remainder,
            markers,
        ):
            raise ValueError("summary contains a conflicting event classification")

    if change_type == "added":
        actions = {
            "diagnosis": ("추가", "등록", "확인", "added", "new"),
            "medications": ("추가", "신규", "새로", "added", "new"),
            "notes": ("추가", "등록", "기록", "added", "new"),
        }.get(category, ("추가", "added", "new"))
    elif change_type == "removed":
        actions = {
            "diagnosis": ("삭제", "제거", "해제", "removed"),
            "medications": ("삭제", "제거", "중단", "removed"),
            "notes": ("삭제", "제거", "removed"),
        }.get(category, ("삭제", "제거", "removed"))
    elif change_type == "modified":
        actions = ("변경", "변화", "조정", "수정", "changed", "modified")
    else:
        raise ValueError("summary references an unsupported change type")
    if not _contains_any(text, tuple(actions)):
        raise ValueError("summary changes the event action")

    if category == "medications" and change_type == "modified":
        previous_facts = _value_facts(change.get("previousValue"))
        current_facts = _value_facts(change.get("currentValue"))
        if not previous_facts or not current_facts:
            raise ValueError("summary references an invalid medication change")
        connector_match = re.search(r"(?:->|→|=>)", text)
        if connector_match is not None:
            if _ordered_facts(text[: connector_match.start()], previous_facts) is None:
                raise ValueError("summary reverses medication values")
            if _ordered_facts(
                text[connector_match.end() :],
                current_facts,
            ) is None:
                raise ValueError("summary reverses medication values")
        else:
            previous_end = _ordered_facts(text, previous_facts)
            if previous_end is None or _ordered_facts(text, current_facts, previous_end) is None:
                raise ValueError("summary reverses medication values")

    if category == "vitals" and change_type == "modified":
        previous_facts = _value_facts(change.get("previousValue"))
        current_facts = _value_facts(change.get("currentValue"))
        if not previous_facts or not current_facts:
            raise ValueError("summary references an invalid vital change")
        previous_end = _ordered_facts(text, previous_facts)
        if previous_end is None or _ordered_facts(text, current_facts, previous_end) is None:
            raise ValueError("summary reverses vital values")

    _validate_safe_wording(text, event)


def _period_context_values(comparison: Any) -> tuple[list[str], set[str]]:
    patient = comparison.get("patient", {}) if isinstance(comparison, dict) else {}
    if not isinstance(patient, dict):
        patient = {}
    period = comparison.get("period", {}) if isinstance(comparison, dict) else {}
    if not isinstance(period, dict):
        period = {}
    anchors: list[str] = []
    for key in ("name", "id"):
        value = patient.get(key)
        if value not in (None, ""):
            anchors.append(str(value))
    room = patient.get("room")
    if room not in (None, ""):
        anchors.extend((str(room), f"{room}호"))
    baseline = period.get("baselineRecordedAt")
    current = period.get("currentRecordedAt")
    if baseline:
        anchors.append(str(baseline))
    else:
        anchors.append("기준 기록 없음")
    if current:
        anchors.append(str(current))
    count = period.get("eventCount")
    if count is not None:
        anchors.extend((str(count), f"{count}건"))

    allowed_numbers = _numbers_in(anchors)
    return anchors, allowed_numbers


def _validate_context_text(text: str, comparison: Any) -> None:
    lowered = text.casefold()
    if any(term.casefold() in lowered for term in _FORBIDDEN_INTERPRETATIONS):
        raise ValueError("summary contains an unsupported context interpretation")
    if any(_contains_any(text, markers) for markers in (
        _classification_markers("current"),
        _classification_markers("period_only"),
        _classification_markers("trend"),
        _classification_markers("record_event"),
    )):
        raise ValueError("summary changes an event classification")
    anchors, allowed_numbers = _period_context_values(comparison)
    if not all(anchor in text for anchor in anchors):
        raise ValueError("summary changes deterministic period context")
    observed_numbers = set(_NUMBER_PATTERN.findall(text))
    if not observed_numbers.issubset(allowed_numbers):
        raise ValueError("summary contains an unsupported context number")


def _validate_ai_summary(
    payload: Any,
    comparison: Any,
    deterministic_summary: Any,
) -> HandoverPeriodSummary:
    if not isinstance(payload, dict):
        raise ValueError("structured output must be an object")
    allowed_top_level = {"sections", "mode", "evidenceIds", "warnings"}
    if set(payload) - allowed_top_level:
        raise ValueError("structured output has unsupported fields")
    if "mode" in payload and payload["mode"] not in (None, "ai"):
        raise ValueError("structured output has unsupported mode")

    sections = payload.get("sections")
    if not isinstance(sections, dict) or set(sections) != set(_SECTIONS):
        raise ValueError("structured output has invalid SBAR sections")
    ordered_ids, events_by_id = _event_ids_and_map(comparison)
    valid_ids = set(ordered_ids)
    trusted_pairs = _summary_pairs(deterministic_summary)
    context_pairs = _summary_context_pairs(deterministic_summary)
    expected_detail_counts = _summary_detail_counts(deterministic_summary)
    expected_context_counts = _summary_context_counts(deterministic_summary)
    normalized_sections: dict[str, list[dict[str, Any]]] = {}
    collected_ids: list[str] = []
    detail_counts: Counter[str] = Counter()
    context_counts: Counter[tuple[str, ...]] = Counter()
    no_evidence_counts: Counter[str] = Counter()

    for section in _SECTIONS:
        raw_items = sections[section]
        if not isinstance(raw_items, list):
            raise ValueError("structured output section is not a list")
        normalized_items: list[dict[str, Any]] = []
        for raw_item in raw_items:
            if not isinstance(raw_item, dict) or set(raw_item) != {"text", "evidenceIds"}:
                raise ValueError("structured output item has unsupported fields")
            text = raw_item.get("text")
            evidence_ids = raw_item.get("evidenceIds")
            if not isinstance(text, str) or not text.strip():
                raise ValueError("structured output item has invalid text")
            if not isinstance(evidence_ids, list) or not all(
                isinstance(event_id, str) for event_id in evidence_ids
            ):
                raise ValueError("structured output item has invalid evidence IDs")
            if len(set(evidence_ids)) != len(evidence_ids):
                raise ValueError("structured output item repeats evidence IDs")
            if not set(evidence_ids).issubset(valid_ids):
                raise ValueError("structured output references unknown evidence ID")
            pair = (text, tuple(evidence_ids))
            if not evidence_ids:
                if pair not in trusted_pairs:
                    raise ValueError("unsupported ungrounded summary item")
                no_evidence_counts[text] += 1
            elif pair not in trusted_pairs:
                if tuple(evidence_ids) in context_pairs:
                    _validate_context_text(text, comparison)
                else:
                    if len(evidence_ids) != 1:
                        raise ValueError("reworded items must cite one evidence ID")
                    event = events_by_id[evidence_ids[0]]
                    _validate_change_text(text, event)
            if evidence_ids:
                collected_ids.extend(evidence_ids)
                evidence_tuple = tuple(evidence_ids)
                if evidence_tuple in context_pairs:
                    context_counts[evidence_tuple] += 1
                else:
                    detail_counts.update(evidence_ids)
            normalized_items.append({"text": text, "evidenceIds": list(evidence_ids)})
        normalized_sections[section] = normalized_items

    if set(collected_ids) != valid_ids:
        raise ValueError("structured output omits or adds evidence IDs")
    if detail_counts != expected_detail_counts:
        raise ValueError("structured output omits evidence-specific detail")
    if context_counts != expected_context_counts:
        raise ValueError("structured output duplicates or omits deterministic context")
    if no_evidence_counts != _no_evidence_counts(deterministic_summary):
        raise ValueError("structured output omits or changes deterministic context")

    if "evidenceIds" in payload:
        top_ids = payload["evidenceIds"]
        if not isinstance(top_ids, list) or not all(isinstance(event_id, str) for event_id in top_ids):
            raise ValueError("structured output has invalid top-level evidence IDs")
        if top_ids != ordered_ids:
            raise ValueError("structured output has mismatched top-level evidence IDs")
    deterministic_warnings: list[str] = []
    if isinstance(deterministic_summary, dict):
        raw_warnings = deterministic_summary.get("warnings", [])
        if isinstance(raw_warnings, (list, tuple, set)):
            deterministic_warnings = [str(warning) for warning in raw_warnings]
    if "warnings" in payload:
        warnings = payload["warnings"]
        if not isinstance(warnings, list) or not all(isinstance(warning, str) for warning in warnings):
            raise ValueError("structured output has invalid warnings")
        if warnings != deterministic_warnings:
            raise ValueError("structured output changes deterministic warnings")

    return {
        "mode": "ai",
        "sections": normalized_sections,  # type: ignore[typeddict-item]
        "evidenceIds": ordered_ids,
        "warnings": deterministic_warnings,
    }


def rewrite_handover_period_summary(
    period_comparison: dict[str, Any],
    deterministic_summary: dict[str, Any],
    client: Any,
) -> dict[str, Any]:
    """Return validated AI wording or the deterministic fallback."""

    if client is None:
        return _fallback_summary(deterministic_summary)
    try:
        responses = getattr(client, "responses")
        response = responses.create(**_request_kwargs(period_comparison, deterministic_summary))
        output_text = _response_output_text(response)
        payload = json.loads(output_text)
        return _validate_ai_summary(payload, period_comparison, deterministic_summary)
    except Exception:
        # Provider errors and untrusted output intentionally share one safe result.
        return _fallback_summary(deterministic_summary)


__all__ = [
    "AI_FALLBACK_USED",
    "HandoverPeriodSummary",
    "rewrite_handover_period_summary",
]
