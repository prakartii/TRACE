"""REST endpoints over the video registry (Phase 2B).

This router exists for the frontend video workspace. Perception (Phase 3+)
will consume `VideoSource`/`VideoRegistry` directly in-process — it has no
reason to go through HTTP.
"""

from __future__ import annotations

import cv2
from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import FileResponse, Response

from backend.contracts.models import VideoSourceInfo
from backend.video.registry import VideoRegistry
from backend.video.source import VideoDecodeError

router = APIRouter(prefix="/api/videos", tags=["videos"])

_default_registry = VideoRegistry()


def get_registry() -> VideoRegistry:
    return _default_registry


def _get_record_or_404(registry: VideoRegistry, video_id: str):
    record = registry.get(video_id)
    if record is None:
        raise HTTPException(status_code=404, detail=f"Unknown video id '{video_id}'")
    return record


@router.get("", response_model=list[VideoSourceInfo])
def list_videos(
    registry: VideoRegistry = Depends(get_registry),
) -> list[VideoSourceInfo]:
    return [record.to_public() for record in registry.list_videos()]


@router.get("/{video_id}", response_model=VideoSourceInfo)
def get_video(
    video_id: str, registry: VideoRegistry = Depends(get_registry)
) -> VideoSourceInfo:
    record = _get_record_or_404(registry, video_id)
    return record.to_public()


@router.get("/{video_id}/frame")
def get_frame(
    video_id: str,
    timestamp: float = Query(..., ge=0.0, description="Seconds from the start"),
    registry: VideoRegistry = Depends(get_registry),
) -> Response:
    record = _get_record_or_404(registry, video_id)

    if timestamp > record.metadata.duration + 1e-3:
        raise HTTPException(
            status_code=422,
            detail=(
                f"timestamp {timestamp}s is outside video duration "
                f"[0, {record.metadata.duration}]s"
            ),
        )

    source = registry.open_source(video_id)
    try:
        source.open()
        frame = source.get_frame(timestamp)
    except VideoDecodeError as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    finally:
        source.close()

    ok, buffer = cv2.imencode(".jpg", frame.image)
    if not ok:
        raise HTTPException(status_code=500, detail="Failed to encode frame as JPEG")

    return Response(content=buffer.tobytes(), media_type="image/jpeg")


@router.api_route("/{video_id}/stream", methods=["GET", "HEAD"])
def stream_video(
    video_id: str, registry: VideoRegistry = Depends(get_registry)
) -> FileResponse:
    record = _get_record_or_404(registry, video_id)
    # Starlette's FileResponse honors Range request headers natively, which
    # is what gives the HTML5 <video> element seeking support.
    # content_disposition_type="inline" so the browser plays it rather than
    # offering a file download.
    # HEAD must be accepted (methods=["GET", "HEAD"] above): Chrome's
    # <video> element probes with a HEAD request before ever issuing a
    # GET, and silently never loads the video if that HEAD 405s.
    # FileResponse itself already suppresses the body correctly for HEAD
    # based on the ASGI scope — no other change needed here.
    return FileResponse(
        record.path,
        media_type="video/mp4",
        filename=record.filename,
        content_disposition_type="inline",
    )
