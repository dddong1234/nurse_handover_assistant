from __future__ import annotations

from copy import deepcopy
from collections import Counter
import json
import re
from typing import Any, Literal, TypedDict


AI_FALLBACK_USED = "AI_FALLBACK_USED"
_MODEL = "gpt-5-mini"
_SECTIONS = ("situation", "background", "assessment", "recommendation")


class HandoverSummaryItem(TypedDict):
    text: str
    evidenceIds: list[str]


class HandoverSummarySections(TypedDict):
    situation: list[HandoverSummaryItem]
    background: list[HandoverSummaryItem]
    assessment: list[HandoverSummaryItem]
    recommendation: list[HandoverSummaryItem]


class HandoverSummary(TypedDict):
    mode: Literal["deterministic", "ai"]
    sections: HandoverSummarySections
    evidenceIds: list[str]
    warnings: list[str]


# The model is deliberately limited to the section/item projection. The
# service derives mode, evidenceIds, and warnings from trusted server data.
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
    "Rewrite the deterministic nursing handover summary using only the facts "
    "in the supplied patient identifiers, interval, structured changes, and "
    "deterministic summary. You may change wording and move items between SBAR "
    "sections, but do not add, remove, calculate, interpret, or recommend any "
    "clinical fact. Keep every referenced evidence ID and its source values "
    "verbatim. Return only the requested JSON object."
)

_NUMBER_PATTERN = re.compile(r"(?<![\w])[-+]?\d+(?:[.,]\d+)?")


def _fallback_summary(
    deterministic_summary: Any,
    warning: str = AI_FALLBACK_USED,
) -> HandoverSummary:
    """Return a defensive deterministic copy with one machine-readable warning."""

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
    warnings = list(raw_warnings) if isinstance(raw_warnings, list) else []
    if warning not in warnings:
        warnings.append(warning)
    fallback["warnings"] = warnings
    return fallback  # type: ignore[return-value]


def _patient_identifiers(comparison: Any) -> dict[str, Any]:
    patient = comparison.get("patient", {}) if isinstance(comparison, dict) else {}
    if not isinstance(patient, dict):
        patient = {}
    # Age, sex, and diagnoses are intentionally omitted: they are not needed
    # to rewrite this summary and would expand the provider payload.
    return {
        "id": patient.get("id", ""),
        "name": patient.get("name", ""),
        "room": patient.get("room", ""),
    }


def _request_input(comparison: Any, deterministic_summary: Any) -> str:
    comparison_dict = comparison if isinstance(comparison, dict) else {}
    interval = comparison_dict.get("interval", {})
    if not isinstance(interval, dict):
        interval = {}
    changes = comparison_dict.get("changes", [])
    if not isinstance(changes, list):
        changes = []
    payload = {
        "patient": _patient_identifiers(comparison_dict),
        "interval": deepcopy(interval),
        "changes": deepcopy(changes),
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
                "name": "handover_summary",
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
    previous = change.get("previousValue")
    current = change.get("currentValue")
    change_type = change.get("changeType")
    if change_type == "added":
        return (current,)
    if change_type == "removed":
        return (previous,)
    return (previous, current)


def _required_facts(change: dict[str, Any]) -> list[str]:
    # Facts are taken from the side(s) that the deterministic change type
    # actually references. This prevents a reversed added/removed statement
    # from passing merely because both values happen to be present elsewhere.
    values = _change_values(change)

    facts: list[str] = []
    for value in values:
        if value is None or isinstance(value, bool):
            continue
        if isinstance(value, (dict, list, tuple, set)):
            leaves = _scalar_values(value)
        else:
            leaves = (value,)
        for leaf in leaves:
            fact = str(leaf)
            if fact and fact not in facts:
                facts.append(fact)
    return facts


def _value_facts(value: Any) -> list[str]:
    if value is None or isinstance(value, bool):
        return []
    leaves = _scalar_values(value) if isinstance(value, (dict, list, tuple, set)) else (value,)
    facts: list[str] = []
    for leaf in leaves:
        fact = str(leaf)
        if fact and fact not in facts:
            facts.append(fact)
    return facts


def _modified_values_are_ordered(text: str, change: dict[str, Any]) -> bool:
    if change.get("changeType") != "modified":
        return True
    previous_facts = _value_facts(change.get("previousValue"))
    current_facts = _value_facts(change.get("currentValue"))
    if change.get("category") == "medications":
        connectors = ("->", "→", "=>")
        connector_position = -1
        connector_length = 0
        for connector in connectors:
            position = text.find(connector)
            if position >= 0 and (
                connector_position < 0 or position < connector_position
            ):
                connector_position = position
                connector_length = len(connector)
        if connector_position < 0:
            return False

        previous_position = 0
        for fact in previous_facts:
            fact_position = text.find(str(fact), previous_position, connector_position)
            if fact_position < 0:
                return False
            previous_position = fact_position + len(str(fact))

        current_position = connector_position + connector_length
        for fact in current_facts:
            fact_position = text.find(str(fact), current_position)
            if fact_position < 0:
                return False
            current_position = fact_position + len(str(fact))
        return True

    for previous_fact in previous_facts:
        for current_fact in current_facts:
            if previous_fact == current_fact:
                continue
            previous_position = text.find(previous_fact)
            current_position = text.find(current_fact)
            if previous_position >= 0 and current_position >= 0 and previous_position >= current_position:
                return False
    return True


def _numbers_for_evidence(
    evidence_ids: list[str],
    changes_by_id: dict[str, dict[str, Any]],
) -> set[str]:
    allowed: set[str] = set()
    for evidence_id in evidence_ids:
        for value in _change_values(changes_by_id[evidence_id]):
            for scalar in _scalar_values(value):
                allowed.update(_NUMBER_PATTERN.findall(str(scalar)))
    return allowed


def _deterministic_item_pairs(deterministic_summary: Any) -> set[tuple[str, tuple[str, ...]]]:
    pairs: set[tuple[str, tuple[str, ...]]] = set()
    if not isinstance(deterministic_summary, dict):
        return pairs
    sections = deterministic_summary.get("sections", {})
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
                isinstance(evidence_id, str) for evidence_id in evidence_ids
            ):
                pairs.add((text, tuple(evidence_ids)))
    return pairs


def _no_evidence_text_counts(deterministic_summary: Any) -> Counter[str]:
    counts: Counter[str] = Counter()
    if not isinstance(deterministic_summary, dict):
        return counts
    sections = deterministic_summary.get("sections", {})
    if not isinstance(sections, dict):
        return counts
    for section in _SECTIONS:
        items = sections.get(section, [])
        if not isinstance(items, list):
            continue
        for item in items:
            if not isinstance(item, dict):
                continue
            if item.get("evidenceIds") == [] and isinstance(item.get("text"), str):
                counts[item["text"]] += 1
    return counts


def _terminal_pattern() -> str:
    return r"\s*[.!?。！？]?\s*"


def _safe_change_patterns(change: dict[str, Any]) -> tuple[str, ...]:
    """Return the finite sentence templates allowed for one change."""

    category = change.get("category")
    change_type = change.get("changeType")
    facts = _required_facts(change)
    if not facts:
        return ()

    value = re.escape(facts[0])
    terminal = _terminal_pattern()
    if category == "diagnosis":
        if change_type == "added":
            return (
                rf"(?:새로운|새|신규)\s+진단(?:으로|이|은|는|[:：])?\s*{value}"
                rf"(?:가|이|은|는|을)?\s*(?:추가|등록|확인)"
                rf"(?:되었습니다|됐습니다|되었어요|됨|되었다)?{terminal}",
                rf"{value}\s*진단(?:이|은|는|으로)?\s*(?:추가|등록|확인)"
                rf"(?:되었습니다|됐습니다|되었어요|됨|되었다)?{terminal}",
                rf"진단\s*(?:추가|신규)\s*[:：]?\s*{value}{terminal}",
            )
        if change_type == "removed":
            return (
                rf"(?:기존\s+)?진단(?:이|은|는|을|[:：])?\s*{value}"
                rf"(?:가|이|은|는|을)?\s*(?:삭제|제거|해제)"
                rf"(?:되었습니다|됐습니다|되었어요|됨|되었다)?{terminal}",
                rf"{value}\s*진단(?:이|은|는|으로)?\s*(?:삭제|제거|해제)"
                rf"(?:되었습니다|됐습니다|되었어요|됨|되었다)?{terminal}",
                rf"진단\s*(?:삭제|제거)\s*[:：]?\s*{value}{terminal}",
            )
    elif category == "vitals" and change_type == "modified" and len(facts) >= 2:
        label = re.escape(str(change.get("label", "활력징후")))
        previous = re.escape(facts[0])
        current = re.escape(facts[1])
        unit = r"\s*(?:°C|℃|도|mmHg|%|bpm)?"
        connector = r"\s*(?:에서|부터|->|→|=>)\s*"
        action = r"(?:변경|변화|조정|수정|changed|modified)"
        ending = r"(?:되었습니다|됐습니다|되었음|됨|되었다)?"
        return (
            rf"{label}\s*(?:은|는|이|가)?\s*{previous}{unit}{connector}"
            rf"{current}{unit}\s*(?:로|으로)?\s*{action}{ending}{terminal}",
            rf"{label}\s*(?:은|는|이|가)?\s*{action}\s*[:：]?\s*"
            rf"{previous}\s*(?:->|→|=>|에서|부터)\s*{current}{unit}{terminal}",
        )
    elif category == "notes":
        note = value
        if change_type == "added":
            return (
                rf"(?:새로운|새|신규)?\s*(?:간호\s*)?메모(?:로|이|은|는|[:：])?\s*{note}"
                rf"(?:가|이|은|는|을)?\s*(?:추가|등록|기록)"
                rf"(?:되었습니다|됐습니다|되었어요|됨|되었다)?{terminal}",
                rf"{note}\s*(?:간호\s*)?메모(?:가|이|은|는)?\s*(?:추가|등록|기록)"
                rf"(?:되었습니다|됐습니다|되었어요|됨|되었다)?{terminal}",
                rf"(?:메모|note)\s*(?:추가|신규)\s*[:：]?\s*{note}{terminal}",
            )
        if change_type == "removed":
            return (
                rf"(?:기존\s*)?(?:간호\s*)?메모(?:로|이|은|는|[:：])?\s*{note}"
                rf"(?:가|이|은|는|을)?\s*(?:삭제|제거)"
                rf"(?:되었습니다|됐습니다|되었어요|됨|되었다)?{terminal}",
                rf"{note}\s*(?:간호\s*)?메모(?:가|이|은|는)?\s*(?:삭제|제거)"
                rf"(?:되었습니다|됐습니다|되었어요|됨|되었다)?{terminal}",
                rf"(?:메모|note)\s*(?:삭제|제거)\s*[:：]?\s*{note}{terminal}",
            )
    elif category == "medications":
        medication = r"(?:투약|약|medication|medications)"
        separator = r"\s*(?:[,/()\[\]:：·])?\s*"
        value_separator = r"\s*(?:[,/·])\s*"
        if change_type == "added":
            medication_facts = _value_facts(change.get("currentValue"))
            if len(medication_facts) < 3:
                return ()
            name, route, frequency = (
                re.escape(fact) for fact in medication_facts[:3]
            )
            action = r"(?:추가|신규|새로)"
            ending = r"(?:되었습니다|됐습니다|되었어요|됨|되었다)?"
            return (
                rf"{medication}\s*{action}\s*[:：]?\s*{name}{separator}{route}"
                rf"{value_separator}{frequency}\s*(?:\)|\])?{ending}{terminal}",
                rf"{name}{separator}{route}{value_separator}{frequency}\s*"
                rf"(?:투약|약)\s*(?:이|은|는)?\s*{action}{ending}{terminal}",
            )
        if change_type == "removed":
            medication_facts = _value_facts(change.get("previousValue"))
            if len(medication_facts) < 3:
                return ()
            name, route, frequency = (
                re.escape(fact) for fact in medication_facts[:3]
            )
            action = r"(?:삭제|제거|중단)"
            ending = r"(?:되었습니다|됐습니다|되었어요|됨|되었다)?"
            return (
                rf"{medication}\s*{action}\s*[:：]?\s*{name}{separator}{route}"
                rf"{value_separator}{frequency}\s*(?:\)|\])?{ending}{terminal}",
                rf"{name}{separator}{route}{value_separator}{frequency}\s*"
                rf"(?:투약|약)\s*(?:이|은|는)?\s*{action}{ending}{terminal}",
            )
        if change_type == "modified":
            previous_facts = _value_facts(change.get("previousValue"))
            current_facts = _value_facts(change.get("currentValue"))
            if len(previous_facts) < 3 or len(current_facts) < 3:
                return ()
            previous_name, previous_route, previous_frequency = (
                re.escape(fact) for fact in previous_facts[:3]
            )
            current_name, current_route, current_frequency = (
                re.escape(fact) for fact in current_facts[:3]
            )
            connector = r"\s*(?:->|→|=>)\s*"
            ending = r"(?:되었습니다|됐습니다|되었어요|됨|되었다)?"
            before = (
                f"{previous_name}{separator}{previous_route}{value_separator}"
                f"{previous_frequency}"
            )
            after = (
                f"{current_name}{separator}{current_route}{value_separator}"
                f"{current_frequency}"
            )
            return (
                rf"{medication}\s*변경\s*[:：]?\s*{before}{connector}{after}"
                rf"{terminal}",
                rf"{before}{connector}{after}\s*{medication}\s*변경"
                rf"{ending}{terminal}",
            )
    return ()


def _matches_safe_change_sentence(text: str, change: dict[str, Any]) -> bool:
    candidate = text.strip()
    return any(
        re.fullmatch(pattern, candidate, flags=re.IGNORECASE) is not None
        for pattern in _safe_change_patterns(change)
    )


def _validate_text(
    text: str,
    evidence_ids: list[str],
    changes_by_id: dict[str, dict[str, Any]],
    trusted_pairs: set[tuple[str, tuple[str, ...]]],
) -> None:
    # Exact deterministic items are safe even when they are aggregate
    # situation text that does not repeat every change value.
    if (text, tuple(evidence_ids)) in trusted_pairs:
        return

    if len(evidence_ids) != 1:
        raise ValueError("reworded items must cite one evidence ID")

    allowed_numbers = _numbers_for_evidence(evidence_ids, changes_by_id)
    observed_numbers = set(_NUMBER_PATTERN.findall(text))
    if not observed_numbers.issubset(allowed_numbers):
        raise ValueError("summary contains an unsupported number")

    required_facts: list[str] = []
    for evidence_id in evidence_ids:
        required_facts.extend(_required_facts(changes_by_id[evidence_id]))
    required_facts = list(dict.fromkeys(required_facts))

    if evidence_ids and required_facts and not all(fact in text for fact in required_facts):
        raise ValueError("summary omits an evidence value")

    change = changes_by_id[evidence_ids[0]]
    if not _modified_values_are_ordered(text, change):
        raise ValueError("summary reverses deterministic change values")
    if not _matches_safe_change_sentence(text, change):
        raise ValueError("summary does not match an approved change sentence")


def _comparison_changes(comparison: Any) -> tuple[list[str], dict[str, dict[str, Any]]]:
    raw_changes = comparison.get("changes", []) if isinstance(comparison, dict) else []
    if not isinstance(raw_changes, list):
        raw_changes = []
    changes_by_id: dict[str, dict[str, Any]] = {}
    ordered_ids: list[str] = []
    for change in raw_changes:
        if not isinstance(change, dict):
            continue
        change_id = change.get("id")
        if not isinstance(change_id, str) or not change_id or change_id in changes_by_id:
            continue
        ordered_ids.append(change_id)
        changes_by_id[change_id] = change
    return ordered_ids, changes_by_id


def _validate_ai_summary(
    payload: Any,
    comparison: Any,
    deterministic_summary: Any,
) -> HandoverSummary:
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

    ordered_ids, changes_by_id = _comparison_changes(comparison)
    valid_ids = set(ordered_ids)
    trusted_pairs = _deterministic_item_pairs(deterministic_summary)
    normalized_sections: dict[str, list[dict[str, Any]]] = {}
    collected_ids: list[str] = []
    fact_covered_ids: set[str] = set()
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
                isinstance(evidence_id, str) for evidence_id in evidence_ids
            ):
                raise ValueError("structured output item has invalid evidence IDs")
            if len(set(evidence_ids)) != len(evidence_ids):
                raise ValueError("structured output item repeats evidence IDs")
            if not set(evidence_ids).issubset(valid_ids):
                raise ValueError("structured output references unknown evidence ID")
            if not evidence_ids:
                # An item without evidence is only safe when it is copied from
                # the deterministic no-evidence text (normally recommendation,
                # no-previous, or no-change situation text).
                if (text, tuple()) not in trusted_pairs:
                    raise ValueError("unsupported ungrounded summary item")
                no_evidence_counts[text] += 1
            _validate_text(
                text,
                evidence_ids,
                changes_by_id,
                trusted_pairs,
            )
            for evidence_id in evidence_ids:
                required_facts = _required_facts(changes_by_id[evidence_id])
                if not required_facts or all(fact in text for fact in required_facts):
                    fact_covered_ids.add(evidence_id)
            collected_ids.extend(evidence_ids)
            normalized_items.append({"text": text, "evidenceIds": list(evidence_ids)})
        normalized_sections[section] = normalized_items

    if set(collected_ids) != valid_ids:
        raise ValueError("structured output omits or adds evidence IDs")
    if fact_covered_ids != valid_ids:
        raise ValueError("structured output omits evidence facts")
    if no_evidence_counts != _no_evidence_text_counts(deterministic_summary):
        raise ValueError("structured output omits or duplicates deterministic context")
    if "evidenceIds" in payload:
        top_ids = payload["evidenceIds"]
        if not isinstance(top_ids, list) or not all(
            isinstance(evidence_id, str) for evidence_id in top_ids
        ):
            raise ValueError("structured output has invalid top-level evidence IDs")
        if top_ids != ordered_ids:
            raise ValueError("structured output has mismatched top-level evidence IDs")
    if "warnings" in payload:
        warnings = payload["warnings"]
        if not isinstance(warnings, list) or not all(isinstance(warning, str) for warning in warnings):
            raise ValueError("structured output has invalid warnings")

    deterministic_warnings = []
    if isinstance(deterministic_summary, dict):
        raw_warnings = deterministic_summary.get("warnings", [])
        if isinstance(raw_warnings, list):
            deterministic_warnings = [str(warning) for warning in raw_warnings]

    return {
        "mode": "ai",
        "sections": normalized_sections,  # type: ignore[typeddict-item]
        "evidenceIds": ordered_ids,
        "warnings": deterministic_warnings,
    }


def rewrite_handover_summary(
    comparison: dict[str, Any],
    deterministic_summary: HandoverSummary,
    client: Any,
) -> HandoverSummary:
    """Rewrite a trusted deterministic summary, falling back on any failure."""

    if client is None:
        return _fallback_summary(deterministic_summary)
    try:
        responses = getattr(client, "responses")
        response = responses.create(**_request_kwargs(comparison, deterministic_summary))
        output_text = _response_output_text(response)
        payload = json.loads(output_text)
        return _validate_ai_summary(payload, comparison, deterministic_summary)
    except Exception:
        # Provider errors and untrusted output are intentionally indistinguishable
        # to callers; neither should expose payloads, secrets, or model details.
        return _fallback_summary(deterministic_summary)


__all__ = [
    "AI_FALLBACK_USED",
    "HandoverSummary",
    "rewrite_handover_summary",
]
