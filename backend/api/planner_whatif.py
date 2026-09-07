"""FastAPI endpoints for Phase 11 What-If Trajectory Simulation.

ARCHITECTURE.md Part 5.6 & Part 6 Screen 9:
- POST /api/planner/whatif: Runs multi-frame temporal what-if counterfactual simulation.
- GET /api/planner/whatif/{event_id}: Runs what-if trajectory simulation for a specific event.
- POST /planner/whatif: Canonical path alias.
"""

from __future__ import annotations

import sqlite3
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query

from backend.api.perception import get_pipeline_registry
from backend.api.scene import get_world_model
from backend.api.videos import get_registry
from backend.contracts.models import (
    WhatIfTrajectoryRequest,
    WhatIfTrajectoryResult,
)
from backend.db.db import get_db
from backend.db.events import get_event_by_id
from backend.perception.pipeline import PerceptionPipeline
from backend.planner.whatif import run_what_if_trajectory
from backend.video.registry import VideoRegistry
from backend.world_model.scene_graph import WorldModel

router = APIRouter(prefix="/api/planner", tags=["whatif_trajectory"])
canonical_router = APIRouter(prefix="/planner", tags=["whatif_canonical"])


@router.post("/whatif", response_model=WhatIfTrajectoryResult)
def simulate_trajectory_whatif(
    req: WhatIfTrajectoryRequest,
    registry: VideoRegistry = Depends(get_registry),
    pipelines: dict[str, PerceptionPipeline] = Depends(get_pipeline_registry),
    world_model: WorldModel = Depends(get_world_model),
    conn: sqlite3.Connection = Depends(get_db),
) -> WhatIfTrajectoryResult:
    """Computes multi-frame temporal stability trajectories for original vs counterfactual."""
    video_id = req.video_id
    timestamp = req.timestamp
    scenario = req.scenario
    entity_id = req.entity_id

    # If event_id is given, resolve parameters from stored event
    if req.event_id is not None:
        ev = get_event_by_id(conn, req.event_id)
        if ev is None:
            raise HTTPException(status_code=404, detail=f"Event #{req.event_id} not found.")
        if not video_id:
            video_id = ev.video_id
        if timestamp is None:
            timestamp = ev.timestamp
        if not scenario:
            scenario = ev.scenario
        if not entity_id:
            entity_id = ev.entity_id

    if not video_id:
        raise HTTPException(status_code=422, detail="Either video_id or a valid event_id must be provided.")

    if timestamp is None:
        timestamp = 0.0

    return run_what_if_trajectory(
        video_id=video_id,
        timestamp=timestamp,
        event_id=req.event_id,
        scenario=scenario,
        entity_id=entity_id,
        alternative_candidate=req.alternative_candidate,
        model=req.model,
        window_before=req.window_before,
        window_after=req.window_after,
        registry=registry,
        pipelines=pipelines,
        world_model=world_model,
        db_conn=conn,
    )


@router.get("/whatif/{event_id}", response_model=WhatIfTrajectoryResult)
def get_event_trajectory_whatif(
    event_id: int,
    candidate_id: Optional[str] = Query(default=None, description="Alternative candidate ID to simulate"),
    model: str = Query(default="pilot", description="Perception model ('pilot' or 'stock')"),
    window_before: float = Query(default=3.0, ge=0.0),
    window_after: float = Query(default=4.0, ge=0.0),
    registry: VideoRegistry = Depends(get_registry),
    pipelines: dict[str, PerceptionPipeline] = Depends(get_pipeline_registry),
    world_model: WorldModel = Depends(get_world_model),
    conn: sqlite3.Connection = Depends(get_db),
) -> WhatIfTrajectoryResult:
    """Retrieves multi-frame temporal what-if trajectory simulation for a recorded event."""
    ev = get_event_by_id(conn, event_id)
    if ev is None:
        raise HTTPException(status_code=404, detail=f"Event #{event_id} not found.")

    if not ev.video_id:
        raise HTTPException(status_code=422, detail=f"Event #{event_id} does not have a linked video.")

    return run_what_if_trajectory(
        video_id=ev.video_id,
        timestamp=ev.timestamp or 0.0,
        event_id=event_id,
        scenario=ev.scenario,
        entity_id=ev.entity_id,
        alternative_candidate=candidate_id,
        model=model,
        window_before=window_before,
        window_after=window_after,
        registry=registry,
        pipelines=pipelines,
        world_model=world_model,
        db_conn=conn,
    )


@canonical_router.post("/whatif", response_model=WhatIfTrajectoryResult)
def simulate_trajectory_whatif_canonical(
    req: WhatIfTrajectoryRequest,
    registry: VideoRegistry = Depends(get_registry),
    pipelines: dict[str, PerceptionPipeline] = Depends(get_pipeline_registry),
    world_model: WorldModel = Depends(get_world_model),
    conn: sqlite3.Connection = Depends(get_db),
) -> WhatIfTrajectoryResult:
    """Canonical path alias for POST /planner/whatif (ARCHITECTURE.md Part 6 Screen 9)."""
    return simulate_trajectory_whatif(
        req=req,
        registry=registry,
        pipelines=pipelines,
        world_model=world_model,
        conn=conn,
    )
