from __future__ import annotations

from typing import Any

from fastapi import FastAPI
from pydantic import BaseModel

from services.handover_service import (
    build_deterministic_summary,
    build_handover_comparison,
)


class HandoverCompareRequest(BaseModel):
    previous: dict[str, Any] | None = None
    current: dict[str, Any]


app = FastAPI(title="Nurse Handover Assistant API")


@app.get("/api/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/api/handover/compare")
def compare_handover(request: HandoverCompareRequest) -> dict[str, Any]:
    comparison = build_handover_comparison(request.previous, request.current)
    summary = build_deterministic_summary(comparison)
    return {"comparison": comparison, "summary": summary}
