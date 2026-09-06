"""REST endpoints for Safe Action Planner and What-If Simulation (Phase 7B).

POST /api/videos/{video_id}/what-if
POST /api/videos/{video_id}/simulate-placement
GET  /api/videos/{video_id}/what-if

Computes deterministic, evidence-aware counterfactual simulations comparing
the observed scene state against alternative candidate placements without
mutating the world state or re-running slow inference passes.
"""

from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query

from backend.api.perception import (
    ModelName,
    find_nearest_result,
    get_cached_results,
    get_pipeline_registry,
)
from backend.api.scene import get_world_model
from backend.api.videos import get_registry
from backend.contracts.models import (
    FindingStatus,
    RiskEvent,
    WhatIfRequest,
    WhatIfSimulation,
)
from backend.lenses.conformance import STANDARD_CONFORMANCE_RULES, evaluate_conformance
from backend.lenses.environmental import CONFIGURED_ZONES, evaluate_environmental
from backend.lenses.structural import evaluate_structural
from backend.perception.pipeline import PerceptionPipeline
from backend.planner.simulation import run_what_if_simulation
from backend.video.registry import VideoRegistry
from backend.world_model.manifest import get_manifest_for_source
from backend.world_model.scene_graph import WorldModel

router = APIRouter(prefix="/api/videos", tags=["planner_simulation"])


def _extract_frame_finding(
    snapshot,
    findings: list[RiskEvent],
    scenario_filter: Optional[str] = None,
    entity_filter: Optional[str] = None,
) -> Optional[RiskEvent]:
    """Selects the matching or highest-priority structural finding for what-if simulation."""
    if scenario_filter:
        for f in findings:
            if f.scenario == scenario_filter:
                if entity_filter is None or f.entity_id == entity_filter or entity_filter in f.entities:
                    return f

    # Priority ranking for candidate generation
    priority = [
        "heavy_on_light_stacking",
        "unsupported_bending_placement",
        "pallet_overhang",
        "box_overhang",
        "wrong_product_orientation",
        "image_space_support_hypothesis",
    ]
    for p in priority:
        for f in findings:
            if f.scenario == p:
                if entity_filter is None or f.entity_id == entity_filter or entity_filter in f.entities:
                    return f

    # Fallback to any structural or conformance finding
    for f in findings:
        if f.lens.value in ("structural", "conformance"):
            return f

    return None


@router.post("/{video_id}/what-if", response_model=WhatIfSimulation)
def simulate_what_if_post(
    video_id: str,
    req: WhatIfRequest,
    registry: VideoRegistry = Depends(get_registry),
    pipelines: dict[str, PerceptionPipeline] = Depends(get_pipeline_registry),
    world_model: WorldModel = Depends(get_world_model),
) -> WhatIfSimulation:
    return _process_what_if(
        video_id=video_id,
        timestamp=req.timestamp,
        scenario=req.finding_scenario,
        entity_id=req.entity_id,
        candidate_id=req.candidate_id,
        model=req.model,
        registry=registry,
        pipelines=pipelines,
        world_model=world_model,
    )


@router.post("/{video_id}/simulate-placement", response_model=WhatIfSimulation)
def simulate_placement_post(
    video_id: str,
    req: WhatIfRequest,
    registry: VideoRegistry = Depends(get_registry),
    pipelines: dict[str, PerceptionPipeline] = Depends(get_pipeline_registry),
    world_model: WorldModel = Depends(get_world_model),
) -> WhatIfSimulation:
    return _process_what_if(
        video_id=video_id,
        timestamp=req.timestamp,
        scenario=req.finding_scenario,
        entity_id=req.entity_id,
        candidate_id=req.candidate_id,
        model=req.model,
        registry=registry,
        pipelines=pipelines,
        world_model=world_model,
    )


@router.get("/{video_id}/what-if", response_model=WhatIfSimulation)
def simulate_what_if_get(
    video_id: str,
    timestamp: float = Query(..., ge=0.0, description="Seconds from start"),
    scenario: Optional[str] = Query(None, description="Optional scenario key"),
    entity_id: Optional[str] = Query(None, description="Optional target entity ID"),
    candidate_id: Optional[str] = Query(None, description="Optional candidate ID"),
    model: ModelName = Query("pilot", description="Model identity ('pilot' or 'stock')"),
    registry: VideoRegistry = Depends(get_registry),
    pipelines: dict[str, PerceptionPipeline] = Depends(get_pipeline_registry),
    world_model: WorldModel = Depends(get_world_model),
) -> WhatIfSimulation:
    return _process_what_if(
        video_id=video_id,
        timestamp=timestamp,
        scenario=scenario,
        entity_id=entity_id,
        candidate_id=candidate_id,
        model=model,
        registry=registry,
        pipelines=pipelines,
        world_model=world_model,
    )


def _process_what_if(
    video_id: str,
    timestamp: float,
    scenario: Optional[str],
    entity_id: Optional[str],
    candidate_id: Optional[str],
    model: str,
    registry: VideoRegistry,
    pipelines: dict[str, PerceptionPipeline],
    world_model: WorldModel,
) -> WhatIfSimulation:
    record = registry.get(video_id)
    if record is None:
        raise HTTPException(status_code=404, detail=f"Unknown video id '{video_id}'")

    if timestamp > record.metadata.duration + 1e-3:
        raise HTTPException(
            status_code=422,
            detail=f"timestamp {timestamp}s is outside video duration [0, {record.metadata.duration}]s",
        )

    pipeline = pipelines.get(model, pipelines.get("pilot"))
    if pipeline is None:
        raise HTTPException(status_code=503, detail=f"Pipeline model '{model}' unavailable.")

    try:
        results = get_cached_results(video_id, registry, pipeline, model)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc

    if not results:
        return WhatIfSimulation(
            video_id=video_id,
            timestamp=timestamp,
            finding_scenario=scenario or "none",
            finding_status=FindingStatus.UNSUPPORTED,
            simulation_available=False,
            simulation_notice="No perception frames available for this video.",
            current=None,
            alternatives=[],
            limitations=["no_perception_frames"],
        )

    frame_result = find_nearest_result(results, timestamp)
    manifest = get_manifest_for_source(video_id, record.filename)
    product_metadata_by_id = (
        {p.product_id: p for p in manifest.product_metadata} if manifest else {}
    )
    default_product_id = manifest.primary_product_id if manifest else None

    snapshot = world_model.build_snapshot(
        frame_result.entities,
        frame_width=record.metadata.width,
        frame_height=record.metadata.height,
        timestamp=frame_result.timestamp,
        default_product_id=default_product_id,
        compute_aspect_orientation=True,
    )
    entity_confidence = {e.id: e.confidence for e in frame_result.entities}

    # Early guard: if the candidate/target entity is a human worker, refuse immediately.
    # Human workers cannot be simulated as cargo placement counterfactuals.
    if candidate_id or entity_id:
        nodes_by_id = {n.entity_id: n for n in snapshot.nodes}
        probe_id = candidate_id or entity_id
        probe_node = nodes_by_id.get(probe_id)
        if probe_node is not None and probe_node.entity_class.value == "person":
            return WhatIfSimulation(
                video_id=video_id,
                timestamp=frame_result.timestamp,
                finding_scenario=scenario or "none",
                finding_status=FindingStatus.UNSUPPORTED,
                simulation_available=False,
                simulation_notice=(
                    "Simulation unavailable: the target entity is a human worker, "
                    "not cargo or a package placement. TRACE does not simulate counterfactual "
                    "repositioning of workers."
                ),
                current=None,
                alternatives=[],
                limitations=["target_is_person_not_cargo"],
            )

    # Evaluate structural & conformance lenses
    frame_findings: list[RiskEvent] = []
    frame_findings.extend(
        evaluate_structural(
            snapshot,
            entity_confidence=entity_confidence,
            product_metadata_by_id=product_metadata_by_id,
        )
    )
    frame_findings.extend(
        evaluate_conformance(
            snapshot.nodes,
            product_metadata_by_id=product_metadata_by_id,
            timestamp=frame_result.timestamp,
            rules=STANDARD_CONFORMANCE_RULES,
        )
    )

    finding = _extract_frame_finding(snapshot, frame_findings, scenario, entity_id)
    if finding is None:
        # Check if an unsupported or no-finding state should be returned
        return WhatIfSimulation(
            video_id=video_id,
            timestamp=frame_result.timestamp,
            finding_scenario=scenario or "unsupported_placement",
            finding_status=FindingStatus.UNSUPPORTED,
            simulation_available=False,
            simulation_notice="No structural or placement finding present at this frame to simulate.",
            current=None,
            alternatives=[],
            limitations=["no_active_structural_finding"],
        )

    return run_what_if_simulation(
        video_id=video_id,
        snapshot=snapshot,
        finding=finding,
        product_metadata_by_id=product_metadata_by_id,
        candidate_id=candidate_id,
    )

