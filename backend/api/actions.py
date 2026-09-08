"""FastAPI REST endpoints for TRACE Safe Action Planner (Feature 3).

Endpoints:
- GET /api/actions/{event_id}: Generates structured SafeActionPlan for a recorded event.
- POST /api/actions/evaluate: Generates SafeActionPlan from custom operational parameters.
"""

from __future__ import annotations

import sqlite3
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from backend.contracts.models import (
    FindingStatus,
    RiskBand,
    SafeActionPlan,
)
from backend.db.db import get_db
from backend.db.events import get_event_by_id
from backend.planner.safe_actions import generate_safe_action_plan

router = APIRouter(prefix="/api/actions", tags=["actions"])


class ActionEvaluationRequest(BaseModel):
    """Payload for evaluating an action plan for synthetic or simulated events."""

    event_id: Optional[int] = 0
    video_id: Optional[str] = None
    timestamp: float = 0.0
    scenario: str = Field(..., description="Operational hazard scenario key")
    status: FindingStatus = FindingStatus.SUPPORTED
    band: RiskBand = RiskBand.MEDIUM
    confidence: str = "High"
    evidence: dict[str, Any] = Field(default_factory=dict)
    limitations: list[str] = Field(default_factory=list)


@router.get("/{event_id}", response_model=SafeActionPlan)
def get_safe_action_plan(
    event_id: int,
    db: sqlite3.Connection = Depends(get_db),
) -> SafeActionPlan:
    """Retrieves an evidence-grounded, prioritized SafeActionPlan for a recorded event."""
    event = get_event_by_id(db, event_id)
    if event is None:
        raise HTTPException(status_code=404, detail=f"Event #{event_id} not found.")

    return generate_safe_action_plan(event)


@router.post("/evaluate", response_model=SafeActionPlan)
def evaluate_safe_action_plan(
    req: ActionEvaluationRequest,
) -> SafeActionPlan:
    """Evaluates and returns a SafeActionPlan for arbitrary operational parameters."""
    event_dict = {
        "event_id": req.event_id or 0,
        "video_id": req.video_id,
        "timestamp": req.timestamp,
        "scenario": req.scenario,
        "status": req.status.value,
        "band": req.band.value,
        "confidence": req.confidence,
        "evidence": req.evidence,
        "limitations": req.limitations,
    }
    return generate_safe_action_plan(event_dict)
