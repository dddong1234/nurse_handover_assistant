from __future__ import annotations

from copy import deepcopy
import os
from typing import Any
from typing import Literal

from fastapi import FastAPI
from pydantic import BaseModel

from services.handover_service import (
    build_deterministic_summary,
    build_handover_comparison,
)
from services.openai_service import rewrite_handover_summary


class HandoverCompareRequest(BaseModel):
    previous: dict[str, Any] | None = None
    current: dict[str, Any]
    summaryMode: Literal["deterministic", "ai"] = "deterministic"


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
