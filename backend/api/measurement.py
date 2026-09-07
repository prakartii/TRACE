"""REST endpoints for Phase 10: Outcome Verification & Prevention Measurement (Layer 8).

Endpoints:
- GET  /api/measurement/events/{event_id}/outcome : fetch or evaluate outcome measurement
- POST /api/measurement/events/{event_id}/verify  : perform video-sequence outcome verification
- GET  /api/measurement/summary                  : aggregate prevented / near-miss / unclear counters
- GET  /api/measurement/outcomes                 : list stored outcome records with filtering
"""

from __future__ import annotations

import sqlite3
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query

from backend.api.perception import ModelName, get_cached_results, get_pipeline_registry
from backend.api.scene import get_world_model
from backend.api.videos import get_registry
from backend.contracts.models import (
    OutcomeMeasurement,
    PreventionClassification,
    PreventionSummary,
    RiskEvent,
)
from backend.perception.pipeline import PerceptionPipeline
from backend.db.db import get_db
from backend.db.events import get_event_by_id
from backend.db.outcomes import (
    get_outcome_by_event_id,
    get_prevention_summary,
    list_outcomes,
    save_outcome_measurement,
)
from backend.measurement.prevention import (
    DEFAULT_RESPONSE_WINDOW_SEC,
    evaluate_prevention,
    verify_event_outcome_from_perception,
)
from backend.video.registry import VideoRegistry
from backend.world_model.manifest import get_manifest_for_source
from backend.world_model.scene_graph import WorldModel

router = APIRouter(prefix="/api/measurement", tags=["measurement"])


@router.get("/summary", response_model=PreventionSummary)
def get_summary(db: sqlite3.Connection = Depends(get_db)) -> PreventionSummary:
    """Returns the 3 separate outcome counters and breakdowns (ARCHITECTURE.md §5.7)."""
    return get_prevention_summary(db)


@router.get("/outcomes", response_model=list[OutcomeMeasurement])
def get_outcomes_list(
    video_id: Optional[str] = Query(None, description="Filter by video ID"),
    classification: Optional[str] = Query(None, description="Filter by classification"),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    db: sqlite3.Connection = Depends(get_db),
) -> list[OutcomeMeasurement]:
    """Lists stored outcome measurements."""
    return list_outcomes(
        video_id=video_id,
        classification=classification,
        limit=limit,
        offset=offset,
        conn=db,
    )


@router.get("/events/{event_id}/outcome", response_model=OutcomeMeasurement)
def get_event_outcome(
    event_id: int,
    db: sqlite3.Connection = Depends(get_db),
) -> OutcomeMeasurement:
    """Retrieves an existing outcome measurement for an event, or evaluates a baseline if unverified."""
    event = get_event_by_id(db, event_id)
    if event is None:
        raise HTTPException(status_code=404, detail=f"Event #{event_id} not found in ledger.")

    # 1. Check if an evaluated outcome is already stored
    stored = get_outcome_by_event_id(event_id, db)
    if stored is not None:
        return stored

    # 2. If unverified, evaluate baseline 3-condition status (no post-action data yet)
    measurement = evaluate_prevention(
        event=event,
        post_event_data=None,
        response_window_sec=DEFAULT_RESPONSE_WINDOW_SEC,
        human_review_status=event.review_status,
    )
    # Save baseline so it is indexed
    saved = save_outcome_measurement(measurement, db)
    return saved


@router.post("/events/{event_id}/verify", response_model=OutcomeMeasurement)
def verify_event_outcome(
    event_id: int,
    response_window_sec: float = Query(
        DEFAULT_RESPONSE_WINDOW_SEC,
        ge=1.0,
        le=30.0,
        description="Response window in seconds to observe corrective action",
    ),
    model: ModelName = Query("pilot", description="Model identity to inspect ('pilot' or 'stock')"),
    registry: VideoRegistry = Depends(get_registry),
    pipelines: dict[str, PerceptionPipeline] = Depends(get_pipeline_registry),
    world_model: WorldModel = Depends(get_world_model),
    db: sqlite3.Connection = Depends(get_db),
) -> OutcomeMeasurement:
    """Executes sequence verification for an event against subsequent video frames.

    Grounds outcome evidence in the video's actual post-intervention scene states.
    """
    event = get_event_by_id(db, event_id)
    if event is None:
        raise HTTPException(status_code=404, detail=f"Event #{event_id} not found in ledger.")

    video_id = event.video_id
    if not video_id:
        # Fallback to evaluating with no video
        measurement = evaluate_prevention(
            event=event,
            post_event_data=None,
            response_window_sec=response_window_sec,
            human_review_status=event.review_status,
        )
        return save_outcome_measurement(measurement, db)

    record = registry.get(video_id)
    if record is None:
        # Video not found in active library; evaluate baseline with limitation
        measurement = evaluate_prevention(
            event=event,
            post_event_data=None,
            response_window_sec=response_window_sec,
            human_review_status=event.review_status,
        )
        measurement.limitations.append("video_source_unavailable_for_verification")
        return save_outcome_measurement(measurement, db)

    pipeline = pipelines.get(model, pipelines.get("pilot"))
    if pipeline is None:
        raise HTTPException(status_code=503, detail=f"Perception pipeline '{model}' unavailable.")

    try:
        results = get_cached_results(video_id, registry, pipeline, model)
    except Exception as exc:
        # If cache fails or file unreadable, record limitation
        measurement = evaluate_prevention(
            event=event,
            post_event_data=None,
            response_window_sec=response_window_sec,
            human_review_status=event.review_status,
        )
        measurement.limitations.append(f"perception_cache_error: {str(exc)}")
        return save_outcome_measurement(measurement, db)

    manifest = get_manifest_for_source(video_id, record.filename)

    measurement = verify_event_outcome_from_perception(
        event=event,
        results=results,
        frame_width=record.metadata.width,
        frame_height=record.metadata.height,
        world_model=world_model,
        manifest=manifest,
        response_window_sec=response_window_sec,
        human_review_status=event.review_status,
    )
    saved = save_outcome_measurement(measurement, db)
    return saved
