"""REST endpoint over Phase 5's evidence-aware risk lenses.

`GET /api/videos/{video_id}/findings?timestamp=<seconds>&model=stock|pilot`
returns the list of `RiskEvent` findings for the sampled frame nearest
`timestamp`, from every lens that can genuinely run given current
perception capability (Behaviour, Structural, Conformance, Environmental).

Reuses Phase 3/4's perception cache and world model exactly like
backend/api/scene.py — no second inference pass, no second geometry
engine. The temporal (Behaviour) lens gets a small, bounded trailing
window of already-cached samples ending at the resolved frame
(`RiskConfig.temporal_window_samples`), never the whole video and never a
fresh decode.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query

from backend.api.perception import (
    ModelName,
    find_nearest_result,
    get_cached_results,
    get_pipeline_registry,
)
from backend.api.scene import get_world_model
from backend.api.videos import get_registry
from backend.behaviour.lens import evaluate_behaviour
from backend.contracts.models import RiskEvent
from backend.db.db import get_db
from backend.db.events import persist_findings
from backend.lenses.conformance import STANDARD_CONFORMANCE_RULES, evaluate_conformance
from backend.lenses.environmental import CONFIGURED_ZONES, evaluate_environmental
from backend.lenses.structural import evaluate_structural
from backend.planner.actions import plan_action
from backend.risk.config import DEFAULT_RISK_CONFIG
from backend.video.registry import VideoRegistry
from backend.world_model.manifest import get_manifest_for_source
from backend.world_model.scene_graph import WorldModel

router = APIRouter(prefix="/api/videos", tags=["findings"])


@router.get("/{video_id}/findings", response_model=list[RiskEvent])
def get_findings(
    video_id: str,
    timestamp: float = Query(..., ge=0.0, description="Seconds from the start"),
    model: ModelName = Query(
        "stock",
        description="'stock' (default, person-only) or 'pilot' (person+box+pallet).",
    ),
    registry: VideoRegistry = Depends(get_registry),
    pipelines: dict[str, PerceptionPipeline] = Depends(get_pipeline_registry),
    world_model: WorldModel = Depends(get_world_model),
    db: sqlite3.Connection = Depends(get_db),
) -> list[RiskEvent]:
    record = registry.get(video_id)
    if record is None:
        raise HTTPException(status_code=404, detail=f"Unknown video id '{video_id}'")

    if timestamp > record.metadata.duration + 1e-3:
        raise HTTPException(
            status_code=422,
            detail=(
                f"timestamp {timestamp}s is outside video duration "
                f"[0, {record.metadata.duration}]s"
            ),
        )

    try:
        results = get_cached_results(video_id, registry, pipelines[model], model)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc

    if not results:
        return []

    frame_result = find_nearest_result(results, timestamp)
    frame_index = results.index(frame_result)
    window = results[max(0, frame_index - DEFAULT_RISK_CONFIG.temporal_window_samples + 1) : frame_index + 1]

    manifest = get_manifest_for_source(video_id, record.filename)
    product_metadata_by_id = (
        {p.product_id: p for p in manifest.product_metadata} if manifest else {}
    )
    default_product_id = manifest.primary_product_id if manifest else None
    zones = manifest.environmental_zones if manifest else CONFIGURED_ZONES

    snapshot = world_model.build_snapshot(
        frame_result.entities,
        frame_width=record.metadata.width,
        frame_height=record.metadata.height,
        timestamp=frame_result.timestamp,
        default_product_id=default_product_id,
        compute_aspect_orientation=True,
    )
    entity_confidence = {e.id: e.confidence for e in frame_result.entities}

    findings: list[RiskEvent] = []
    findings.extend(
        evaluate_behaviour(
            window,
            frame_width=record.metadata.width,
            frame_height=record.metadata.height,
            timestamp=frame_result.timestamp,
            product_metadata_by_id=product_metadata_by_id,
            default_product_id=default_product_id,
        )
    )
    findings.extend(
        evaluate_structural(
            snapshot,
            entity_confidence=entity_confidence,
            product_metadata_by_id=product_metadata_by_id,
        )
    )
    findings.extend(
        evaluate_conformance(
            snapshot.nodes,
            product_metadata_by_id=product_metadata_by_id,
            timestamp=frame_result.timestamp,
            rules=STANDARD_CONFORMANCE_RULES,
        )
    )
    findings.extend(
        evaluate_environmental(
            snapshot.nodes,
            timestamp=frame_result.timestamp,
            zones=zones,
        )
    )
    for f in findings:
        if f.planner_recommendation is None:
            f.planner_recommendation = plan_action(
                f.scenario,
                f.status,
                f.confidence,
                evidence=f.evidence,
                limitations=f.limitations,
            )

    try:
        canonical_id = record.duplicate_of or record.id
        persist_findings(
            findings=findings,
            video_id=video_id,
            canonical_id=canonical_id,
            timestamp=frame_result.timestamp,
            conn=db,
        )
    except Exception:
        # Persistence failure must NOT turn a valid risk finding into a failed analysis response
        pass

    return findings
