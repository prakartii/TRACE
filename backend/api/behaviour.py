"""REST API endpoint for Phase 12 Behaviour Recognition.

ARCHITECTURE.md Part 3 & Part 11, CLAUDE.md §7 & §14.

Exposes:
  - GET /api/behaviour/scenarios: Catalog of 7 behaviour scenarios with metadata, required signals, and limitations
  - GET /api/behaviour/scenarios/{scenario_id}: Details for an individual scenario
  - POST /api/behaviour/evaluate: Direct behaviour evaluation over cached perception frames
  - GET /api/videos/{video_id}/behaviour: Video-level behaviour analysis at timestamp
"""

from __future__ import annotations

import sqlite3
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query

from backend.api.perception import (
    ModelName,
    find_nearest_result,
    get_cached_results,
    get_pipeline_registry,
)
from backend.api.videos import get_registry
from backend.behaviour.recognizer import (
    BEHAVIOUR_SCENARIOS_CATALOG,
    recognize_all_behaviours,
)
from backend.contracts.models import (
    BehaviourEvaluationRequest,
    BehaviourEvaluationResponse,
    BehaviourScenarioInfo,
    KinematicProfile,
    PerceptionFrameResult,
    RiskEvent,
)
from backend.db.db import get_db
from backend.db.events import persist_findings
from backend.perception.pipeline import PerceptionPipeline
from backend.risk.config import DEFAULT_RISK_CONFIG
from backend.video.registry import VideoRegistry
from backend.world_model.manifest import get_manifest_for_source

router = APIRouter(prefix="/api/behaviour", tags=["behaviour"])


@router.get("/scenarios", response_model=list[BehaviourScenarioInfo])
def list_behaviour_scenarios() -> list[BehaviourScenarioInfo]:
    """Lists all 7 recognized behaviour scenarios with required signals and limitations."""
    return BEHAVIOUR_SCENARIOS_CATALOG


@router.get("/scenarios/{scenario_id}", response_model=BehaviourScenarioInfo)
def get_behaviour_scenario(scenario_id: str) -> BehaviourScenarioInfo:
    """Retrieves metadata and detection guidelines for a specific behaviour scenario."""
    for s in BEHAVIOUR_SCENARIOS_CATALOG:
        if s.scenario_id == scenario_id:
            return s
    raise HTTPException(status_code=404, detail=f"Unknown behaviour scenario '{scenario_id}'")


@router.get("/video/{video_id}", response_model=BehaviourEvaluationResponse)
def evaluate_video_behaviour(
    video_id: str,
    timestamp: float = Query(0.0, ge=0.0, description="Timestamp in seconds"),
    model: ModelName = Query("pilot", description="'stock' or 'pilot' model"),
    registry: VideoRegistry = Depends(get_registry),
    pipelines: dict[str, PerceptionPipeline] = Depends(get_pipeline_registry),
    db: sqlite3.Connection = Depends(get_db),
) -> BehaviourEvaluationResponse:
    """Evaluates behaviour recognition and computes kinematic profiles for a video at a timestamp."""
    record = registry.get(video_id)
    if record is None:
        raise HTTPException(status_code=404, detail=f"Unknown video id '{video_id}'")

    try:
        results = get_cached_results(video_id, registry, pipelines[model], model)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc

    if not results:
        return BehaviourEvaluationResponse(
            timestamp=timestamp,
            video_id=video_id,
            findings=[],
            kinematics={},
            active_scenarios=[],
            epistemic_notice="No perception frames available for video.",
        )

    nearest = find_nearest_result(results, timestamp)
    idx = results.index(nearest)
    window = results[max(0, idx - DEFAULT_RISK_CONFIG.temporal_window_samples + 1) : idx + 1]

    manifest = get_manifest_for_source(video_id, record.filename)
    product_metadata_by_id = (
        {p.product_id: p for p in manifest.product_metadata} if manifest else {}
    )
    default_product_id = manifest.primary_product_id if manifest else None

    findings, kinematics = recognize_all_behaviours(
        window,
        frame_width=record.metadata.width,
        frame_height=record.metadata.height,
        timestamp=nearest.timestamp,
        product_metadata_by_id=product_metadata_by_id,
        default_product_id=default_product_id,
    )

    # Persist findings to event store
    try:
        persist_findings(db, findings, video_id=video_id)
    except Exception:
        pass

    active = [f.scenario for f in findings if f.scenario]

    return BehaviourEvaluationResponse(
        timestamp=nearest.timestamp,
        video_id=video_id,
        findings=findings,
        kinematics=kinematics,
        active_scenarios=list(set(active)),
        epistemic_notice=(
            "Behaviour kinematics evaluated in 2D normalized image space. "
            "No calibrated 3D depth or contact force sensors; findings represent kinematic precursor hypotheses."
        ),
    )


@router.post("/evaluate", response_model=BehaviourEvaluationResponse)
def evaluate_behaviour_request(
    request: BehaviourEvaluationRequest,
    registry: VideoRegistry = Depends(get_registry),
    pipelines: dict[str, PerceptionPipeline] = Depends(get_pipeline_registry),
    db: sqlite3.Connection = Depends(get_db),
) -> BehaviourEvaluationResponse:
    """Evaluates behaviour from request payload."""
    video_id = request.video_id
    if not video_id:
        videos = registry.list_videos()
        if not videos:
            raise HTTPException(status_code=404, detail="No registered videos found.")
        video_id = videos[0].video_id

    timestamp = request.timestamp or 0.0
    return evaluate_video_behaviour(
        video_id=video_id,
        timestamp=timestamp,
        model="pilot",
        registry=registry,
        pipelines=pipelines,
        db=db,
    )
