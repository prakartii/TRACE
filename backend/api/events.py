"""REST endpoints for TRACE Event Feed, Inspection, and Responsible AI Review (Phase 9.1)."""

from __future__ import annotations

import sqlite3
from enum import Enum
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field

from backend.api.videos import get_registry
from backend.contracts.models import (
    FindingStatus,
    RiskBand,
    RiskEvent,
    RiskLens,
)
from backend.db.db import get_db
from backend.db.events import get_event_by_id, query_events, review_event
from backend.video.registry import VideoRegistry

router = APIRouter(prefix="/api/events", tags=["events"])


class ReviewStatusEnum(str, Enum):
    CONFIRMED_DAMAGE = "confirmed_damage"
    FALSE_POSITIVE = "false_positive"
    UNRESOLVED = "unresolved"


class EventReviewRequest(BaseModel):
    review_status: ReviewStatusEnum = Field(
        ...,
        description="Responsible AI review status: 'confirmed_damage', 'false_positive', or 'unresolved'",
    )
    notes: Optional[str] = Field(None, description="Optional supervisor review notes")


@router.get("", response_model=list[RiskEvent])
def list_events(
    video_id: Optional[str] = Query(None, description="Filter events by video_id"),
    lens: Optional[RiskLens] = Query(None, description="Filter by risk lens"),
    status: Optional[FindingStatus] = Query(None, description="Filter by epistemic finding status"),
    band: Optional[RiskBand] = Query(None, description="Filter by risk band"),
    reviewed: Optional[bool] = Query(None, description="Filter by reviewed state"),
    review_status: Optional[ReviewStatusEnum] = Query(None, description="Filter by review status"),
    limit: int = Query(50, ge=1, le=500, description="Max events to return"),
    offset: int = Query(0, ge=0, description="Offset for pagination"),
    order: str = Query("desc", pattern="^(asc|desc)$", description="Sort order: 'desc' or 'asc'"),
    registry: VideoRegistry = Depends(get_registry),
    db: sqlite3.Connection = Depends(get_db),
) -> list[RiskEvent]:
    """Retrieves operational risk events with structured filtering, pagination, and sorting."""
    canonical_id = None
    if video_id:
        record = registry.get(video_id)
        if record and record.duplicate_of:
            canonical_id = record.duplicate_of

    return query_events(
        db,
        video_id=video_id,
        canonical_id=canonical_id,
        lens=lens.value if lens else None,
        status=status.value if status else None,
        band=band.value if band else None,
        reviewed=reviewed,
        review_status=review_status.value if review_status else None,
        limit=limit,
        offset=offset,
        order=order,
    )


@router.get("/{event_id}", response_model=RiskEvent)
def get_event(
    event_id: int,
    db: sqlite3.Connection = Depends(get_db),
) -> RiskEvent:
    """Retrieves a single operational risk event by ID with its attached planner recommendation."""
    event = get_event_by_id(db, event_id)
    if event is None:
        raise HTTPException(status_code=404, detail=f"Event {event_id} not found")
    return event


@router.post("/{event_id}/review", response_model=RiskEvent)
def post_event_review(
    event_id: int,
    payload: EventReviewRequest,
    db: sqlite3.Connection = Depends(get_db),
) -> RiskEvent:
    """Records human operator review feedback for Responsible AI closed-loop learning."""
    updated = review_event(
        db,
        event_id=event_id,
        review_status=payload.review_status.value,
        notes=payload.notes,
    )
    if updated is None:
        raise HTTPException(status_code=404, detail=f"Event {event_id} not found")
    return updated
