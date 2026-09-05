"""REST endpoint over the world model (Phase 4).

`GET /api/videos/{video_id}/scene?timestamp=<seconds>&model=stock|pilot`
returns a `SceneGraphSnapshot` — nodes + spatial-relationship edges — for
the sampled frame nearest `timestamp`. `model` has the same meaning and
default ("stock") as `/entities` — see backend/api/perception.py.

Reuses Phase 3/4's perception cache (`backend.api.perception`) rather
than re-running detection/tracking: this endpoint only adds the spatial
interpretation step (`backend.world_model.scene_graph.WorldModel`) on top
of already-computed entities. Same validation as `/entities` (unknown
video -> 404, out-of-range/missing timestamp -> 422, missing model
weights -> 503) since a scene graph can't exist without perception
output.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query

from backend.api.perception import (
    ModelName,
    find_nearest_result,
    get_cached_results,
    get_pipeline_registry,
)
from backend.api.videos import get_registry
from backend.contracts.models import SceneGraphSnapshot
from backend.perception.pipeline import PerceptionPipeline
from backend.video.registry import VideoRegistry
from backend.world_model.scene_graph import WorldModel

router = APIRouter(prefix="/api/videos", tags=["world_model"])

_default_world_model = WorldModel()


def get_world_model() -> WorldModel:
    return _default_world_model


@router.get("/{video_id}/scene", response_model=SceneGraphSnapshot)
def get_scene(
    video_id: str,
    timestamp: float = Query(..., ge=0.0, description="Seconds from the start"),
    model: ModelName = Query(
        "stock",
        description="'stock' (default, person-only) or 'pilot' (person+box+pallet).",
    ),
    registry: VideoRegistry = Depends(get_registry),
    pipelines: dict[str, PerceptionPipeline] = Depends(get_pipeline_registry),
    world_model: WorldModel = Depends(get_world_model),
) -> SceneGraphSnapshot:
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
        return SceneGraphSnapshot(timestamp=timestamp, nodes=[], edges=[])

    frame_result = find_nearest_result(results, timestamp)
    return world_model.build_snapshot(
        frame_result.entities,
        frame_width=record.metadata.width,
        frame_height=record.metadata.height,
        timestamp=frame_result.timestamp,
    )
