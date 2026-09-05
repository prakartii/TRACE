"""REST endpoint over the perception pipeline (Phase 3, extended in
Phase 4 with an explicit, opt-in pilot-model mode).

`GET /api/videos/{video_id}/entities?timestamp=<seconds>&model=stock|pilot`
returns the detected + tracked `Entity` list for the sampled frame
nearest `timestamp`. `model` defaults to `stock` — the well-understood,
person-only production model (backend/perception/config.py's
DEFAULT_CONFIG) — so every existing caller's behavior is unchanged
unless it explicitly asks for `pilot` (PILOT_CONFIG: person+box+pallet,
see training/README.md for what that pilot fine-tune has and hasn't been
validated to do). The system never silently substitutes one for the
other — `PerceptionFrameResult.model_identity` states plainly which one
produced a given response.

The FIRST request for a given (video, model) pair triggers one
sequential, sparse-sampled pass over that whole video (backend/
perception/config.py controls the sample rate) so track IDs are
meaningful across the run; the result is cached in memory per (model,
video id) and reused for every later request, including different
timestamps and different clients scrubbing the same video. Nothing is
persisted to the database — CLAUDE.md's "don't store bulk detections in
SQLite in this phase" — the cache is purely in-process and lives only
for this server run.

Route handlers here are plain `def` (not `async def`) so FastAPI runs
them in its threadpool, keeping the event loop free during (possibly
slow, first-time) CPU inference.
"""

from __future__ import annotations

import bisect
import threading
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query

from backend.api.videos import get_registry
from backend.contracts.models import PerceptionFrameResult
from backend.perception.config import DEFAULT_CONFIG, PILOT_CONFIG
from backend.perception.pipeline import PerceptionPipeline
from backend.video.registry import VideoRegistry

router = APIRouter(prefix="/api/videos", tags=["perception"])

ModelName = Literal["stock", "pilot"]

_pipelines: dict[str, PerceptionPipeline] = {
    "stock": PerceptionPipeline(DEFAULT_CONFIG),
    "pilot": PerceptionPipeline(PILOT_CONFIG),
}
# Keyed by (model_name, video_id) — the two models' results for the same
# video are never mixed, and switching `model` never sees stale results
# computed under the other model.
_cache: dict[tuple[str, str], list[PerceptionFrameResult]] = {}
_cache_lock = threading.Lock()


def get_pipeline_registry() -> dict[str, PerceptionPipeline]:
    return _pipelines


def get_pipeline() -> PerceptionPipeline:
    """Backwards-compatible accessor some existing tests override —
    returns the stock pipeline specifically."""
    return _pipelines["stock"]


def find_nearest_result(
    results: list[PerceptionFrameResult], timestamp: float
) -> PerceptionFrameResult:
    """Public (not `_`-prefixed) because backend/api/scene.py (Phase 4)
    reuses this exact nearest-sample lookup — one source of truth rather
    than a second copy of the same logic."""
    timestamps = [r.timestamp for r in results]
    idx = bisect.bisect_left(timestamps, timestamp)
    if idx == 0:
        return results[0]
    if idx == len(results):
        return results[-1]
    before, after = results[idx - 1], results[idx]
    if (timestamp - before.timestamp) <= (after.timestamp - timestamp):
        return before
    return after


def get_cached_results(
    video_id: str,
    registry: VideoRegistry,
    pipeline: PerceptionPipeline,
    model_name: str = "stock",
) -> list[PerceptionFrameResult]:
    """Public for the same reason as `find_nearest_result` above —
    backend/api/scene.py builds scene graphs from these same cached
    per-frame entities rather than re-running perception."""
    cache_key = (model_name, video_id)
    with _cache_lock:
        cached = _cache.get(cache_key)
    if cached is not None:
        return cached

    source = registry.open_source(video_id)
    try:
        results = pipeline.process_video(source)
    finally:
        source.close()

    # Note: two concurrent first-requests for the same uncached
    # (model, video) pair can each trigger a full (redundant) pass — last
    # write wins here. Not worth a per-key lock/future for a demo-scale,
    # single-user app.
    with _cache_lock:
        _cache[cache_key] = results
    return results


@router.get("/{video_id}/entities", response_model=PerceptionFrameResult)
def get_entities(
    video_id: str,
    timestamp: float = Query(..., ge=0.0, description="Seconds from the start"),
    model: ModelName = Query(
        "stock",
        description=(
            "'stock' (default, person-only, production) or 'pilot' "
            "(experimental person+box+pallet fine-tune — see "
            "training/README.md)."
        ),
    ),
    registry: VideoRegistry = Depends(get_registry),
    pipelines: dict[str, PerceptionPipeline] = Depends(get_pipeline_registry),
) -> PerceptionFrameResult:
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
        return PerceptionFrameResult(
            source_id=video_id, timestamp=timestamp, frame_index=None, entities=[]
        )

    return find_nearest_result(results, timestamp)
