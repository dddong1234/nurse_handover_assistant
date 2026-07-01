from __future__ import annotations

import re
from datetime import datetime, timedelta
from typing import Any

from services.handover_service import detect_changes, generate_handover_text
from services.storage_service import load_all_patients, load_patient, load_patient_timeline


UNSUPPORTED_KEYWORDS = [
    "ct",
    "mri",
    "x-ray",
    "xray",
    "초음파",
    "검사",
    "lab",
    "수술 일정",
    "시술",
    "consult",
]

QUERY_HINTS = "조회 가능 항목: 환자별 변동사항, 발열 환자, 투약 키워드, 진단명, 메모"


def _parse_iso_datetime(value: str) -> datetime:
    return datetime.fromisoformat(value)


def _latest_record_datetime() -> datetime | None:
    timestamps: list[datetime] = []

    for patient in load_all_patients():
        updated_at = patient.get("updated_at")
        if updated_at:
            timestamps.append(_parse_iso_datetime(updated_at))

    if not timestamps:
        return None

    return max(timestamps)


def _contains_unsupported_keyword(question: str) -> str | None:
    lowered = question.lower()
    for keyword in UNSUPPORTED_KEYWORDS:
        if keyword in lowered:
            return keyword
    return None


def _extract_patient_id(question: str) -> str | None:
    match = re.search(r"\bP\d{3}\b", question.upper())
    return match.group(0) if match else None


def _extract_keyword(question: str) -> str | None:
    normalized = question.strip().rstrip("?.!")

    patterns = [
        r"([A-Za-z0-9가-힣/+.\-%]+)\s*(?:투약|처방)[^\n]*환자",
        r"([A-Za-z0-9가-힣/+.\-%]+)\s*(?:진단|메모)[^\n]*환자",
        r"([A-Za-z0-9가-힣/+.\-%]+)\s*(?:있는|중인)\s*환자",
    ]

    for pattern in patterns:
        match = re.search(pattern, normalized, flags=re.IGNORECASE)
        if match:
            return match.group(1).strip()

    filler_words = [
        "찾아줘",
        "보여줘",
        "알려줘",
        "환자",
        "중인",
        "있는",
        "투약",
        "처방",
        "진단",
        "메모",
    ]
    keyword = normalized
    for filler in filler_words:
        keyword = keyword.replace(filler, " ")

    tokens = [token for token in keyword.split() if token]
    return tokens[0] if tokens else None


def _patient_result(patient: dict[str, Any], reason: str) -> dict[str, str]:
    diagnosis = ", ".join(patient.get("diagnosis", [])) or "-"
    return {
        "patient_id": patient.get("patient_id", ""),
        "name": patient.get("name", ""),
        "room_no": patient.get("room_no", ""),
        "reason": reason,
        "updated_at": patient.get("updated_at", ""),
        "diagnosis": diagnosis,
    }


def _search_patients_by_keyword(keyword: str) -> list[dict[str, str]]:
    results: list[dict[str, str]] = []
    lowered_keyword = keyword.lower()

    for patient in load_all_patients():
        medications = patient.get("medications", [])
        notes = patient.get("notes", [])
        diagnoses = patient.get("diagnosis", [])

        if any(lowered_keyword in medication.get("name", "").lower() for medication in medications):
            results.append(_patient_result(patient, f"투약: {keyword}"))
            continue

        if any(lowered_keyword in note.lower() for note in notes):
            results.append(_patient_result(patient, f"메모: {keyword}"))
            continue

        if any(lowered_keyword in diagnosis.lower() for diagnosis in diagnoses):
            results.append(_patient_result(patient, f"진단: {keyword}"))

    return results


def _search_fever_patients_for_demo_yesterday() -> list[dict[str, str]]:
    reference = _latest_record_datetime()
    if reference is None:
        return []

    target_date = (reference - timedelta(days=1)).date()
    results: list[dict[str, str]] = []

    for patient in load_all_patients():
        for record in load_patient_timeline(patient["patient_id"]):
            updated_at = record.get("updated_at")
            if not updated_at:
                continue

            recorded_at = _parse_iso_datetime(updated_at)
            temperature = record.get("vitals", {}).get("body_temperature")
            if recorded_at.date() != target_date or temperature is None or temperature < 38.0:
                continue

            results.append(
                _patient_result(
                    patient,
                    f"어제 발열 기록 {temperature}C ({recorded_at.strftime('%Y-%m-%d %H:%M')})",
                )
            )
            break

    return results


def _get_patient_changes(patient_id: str) -> dict[str, Any]:
    timeline = load_patient_timeline(patient_id)
    patient = load_patient(patient_id)

    if patient is None:
        return {
            "status": "no_results",
            "title": "환자 조회 결과",
            "message": f"{patient_id} 환자를 찾지 못했습니다.",
        }

    if len(timeline) < 2:
        return {
            "status": "no_results",
            "title": "환자 변동사항",
            "message": f"{patient_id} 환자는 비교 가능한 이전 기록이 없습니다.",
        }

    previous_record = timeline[-2]
    current_record = timeline[-1]
    changes = detect_changes(previous_record, current_record)

    return {
        "status": "success",
        "title": f"{patient_id} 변동사항",
        "message": generate_handover_text(changes),
        "results": [
            {
                "patient_id": patient_id,
                "name": patient.get("name", ""),
                "room_no": patient.get("room_no", ""),
                "reason": f"{previous_record.get('updated_at')} -> {current_record.get('updated_at')}",
            }
        ],
    }


def run_query(question: str) -> dict[str, Any]:
    cleaned = question.strip()
    if not cleaned:
        return {
            "status": "invalid",
            "title": "질의 조회",
            "message": "질문을 입력하세요.",
        }

    unsupported = _contains_unsupported_keyword(cleaned)
    if unsupported is not None:
        return {
            "status": "unsupported",
            "title": "질의 조회",
            "message": f"데이터베이스에 조회되지 않는 항목입니다: {unsupported.upper() if unsupported.isascii() else unsupported}",
            "details": QUERY_HINTS,
        }

    patient_id = _extract_patient_id(cleaned)
    if patient_id and any(token in cleaned for token in ["변동", "인수인계", "상태", "요약"]):
        return _get_patient_changes(patient_id)

    if "어제" in cleaned and any(token in cleaned for token in ["열", "발열", "체온"]):
        results = _search_fever_patients_for_demo_yesterday()
        if results:
            return {
                "status": "success",
                "title": "어제 발열 환자",
                "message": f"어제 발열 기록이 있었던 환자 {len(results)}명입니다.",
                "results": results,
            }

        return {
            "status": "no_results",
            "title": "어제 발열 환자",
            "message": "어제 발열 기록이 있는 환자가 없습니다.",
        }

    keyword = _extract_keyword(cleaned)
    if keyword:
        results = _search_patients_by_keyword(keyword)
        if results:
            return {
                "status": "success",
                "title": f"'{keyword}' 관련 환자",
                "message": f"'{keyword}' 키워드와 일치하는 환자 {len(results)}명입니다.",
                "results": results,
            }

        return {
            "status": "no_results",
            "title": f"'{keyword}' 관련 환자",
            "message": f"'{keyword}' 키워드와 일치하는 환자가 없습니다.",
        }

    return {
        "status": "unsupported",
        "title": "질의 조회",
        "message": "현재 지원하지 않는 질의 형식입니다.",
        "details": QUERY_HINTS,
    }
