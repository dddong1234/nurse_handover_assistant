from __future__ import annotations

from copy import deepcopy
import os
from typing import Any
from typing import Literal

from fastapi import FastAPI
from fastapi import HTTPException
from pydantic import BaseModel
from pydantic import ConfigDict
from pydantic import Field

from services.handover_service import (
    build_deterministic_summary,
    build_handover_comparison,
)
from services.handover_period_service import (
    build_deterministic_period_summary,
    build_handover_period_comparison,
)
from services.handover_shift_readiness_service import build_shift_readiness
from services.openai_service import rewrite_handover_summary
from services.openai_period_service import rewrite_handover_period_summary


class HandoverCompareRequest(BaseModel):
    previous: dict[str, Any] | None = None
    current: dict[str, Any]
    summaryMode: Literal["deterministic", "ai"] = "deterministic"


class CoverageGap(BaseModel):
    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    from_: str = Field(alias="from")
    to: str
    code: str | None = None


class HandoverPeriodCompareRequest(BaseModel):
    reviewStartAt: str
    records: list[dict[str, Any]]
    coverageGaps: list[CoverageGap] = Field(default_factory=list)
    summaryMode: Literal["deterministic", "ai"] = "deterministic"


class ShiftWindow(BaseModel):
    model_config = ConfigDict(extra="forbid")

    startsAt: str
    endsAt: str


class ShiftReadinessRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    reviewStartAt: str
    shift: ShiftWindow
    records: list[dict[str, Any]]
    coverageGaps: list[CoverageGap] = Field(default_factory=list)


app = FastAPI(title="Nurse Handover Assistant API")


def _create_openai_client(api_key: str):
    """Create the provider client only after an AI request opts in."""

    from openai import OpenAI

    return OpenAI(api_key=api_key, timeout=10.0, max_retries=0)


def _summary_with_warning(summary: dict[str, Any], warning: str) -> dict[str, Any]:
    result = deepcopy(summary)
    result["mode"] = "deterministic"
    raw_warnings = result.get("warnings", [])
    warnings = list(raw_warnings) if isinstance(raw_warnings, list) else []
    if warning not in warnings:
        warnings.append(warning)
    result["warnings"] = warnings
    return result


@app.get("/api/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/api/handover/compare")
def compare_handover(request: HandoverCompareRequest) -> dict[str, Any]:
    comparison = build_handover_comparison(request.previous, request.current)
    deterministic_summary = build_deterministic_summary(comparison)
    if request.summaryMode == "deterministic":
        summary = deterministic_summary
    else:
        # The environment is intentionally read inside this opt-in request
        # path. It is never sent to the client or included in provider input.
        api_key = os.environ.get("OPENAI_API_KEY", "").strip()
        if not api_key:
            summary = _summary_with_warning(
                deterministic_summary,
                "AI_KEY_UNAVAILABLE",
            )
        else:
            try:
                client = _create_openai_client(api_key)
            except Exception:
                summary = _summary_with_warning(
                    deterministic_summary,
                    "AI_FALLBACK_USED",
                )
            else:
                summary = rewrite_handover_summary(
                    comparison,
                    deterministic_summary,
                    client,
                )
    return {"comparison": comparison, "summary": summary}


@app.post("/api/handover/period-compare")
def compare_handover_period(request: HandoverPeriodCompareRequest) -> dict[str, Any]:
    try:
        comparison = build_handover_period_comparison(
            request.records,
            request.reviewStartAt,
            [gap.model_dump(by_alias=True) for gap in request.coverageGaps],
        )
    except (KeyError, TypeError, ValueError) as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    deterministic_summary = build_deterministic_period_summary(comparison)
    if request.summaryMode == "deterministic":
        summary = deterministic_summary
    else:
        # Keep key access inside this explicit opt-in request path. The key is
        # never returned to the caller or included in the deterministic payload.
        api_key = os.environ.get("OPENAI_API_KEY", "").strip()
        if not api_key:
            summary = _summary_with_warning(
                deterministic_summary,
                "AI_KEY_UNAVAILABLE",
            )
        else:
            try:
                client = _create_openai_client(api_key)
            except Exception:
                summary = _summary_with_warning(
                    deterministic_summary,
                    "AI_FALLBACK_USED",
                )
            else:
                summary = rewrite_handover_period_summary(
                    comparison,
                    deterministic_summary,
                    client,
                )

    return {
        "patient": comparison["patient"],
        "period": comparison["period"],
        "dataWarnings": comparison["dataWarnings"],
        "events": comparison["events"],
        "reviewGroups": comparison["reviewGroups"],
        "summary": summary,
    }


@app.post("/api/handover/shift-readiness")
def compare_handover_shift_readiness(
    request: ShiftReadinessRequest,
) -> dict[str, Any]:
    try:
        return build_shift_readiness(
            request.records,
            request.reviewStartAt,
            request.shift.model_dump(),
            [gap.model_dump(by_alias=True) for gap in request.coverageGaps],
        )
    except (KeyError, TypeError, ValueError) as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except Exception:
        raise HTTPException(
            status_code=500,
            detail="Shift Readiness 처리 중 오류가 발생했습니다",
        ) from None
