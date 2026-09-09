"""REST endpoints over the video registry (Phase 2B).

This router exists for the frontend video workspace. Perception (Phase 3+)
will consume `VideoSource`/`VideoRegistry` directly in-process — it has no
reason to go through HTTP.
"""

from __future__ import annotations

import shutil
from pathlib import Path

import cv2
from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile
from fastapi.responses import FileResponse, Response

from backend.contracts.models import VideoSourceInfo
from backend.perception.sampling import resolve_sampling_policy
from backend.video.registry import VideoRegistry, make_source_id
from backend.video.source import VideoDecodeError

router = APIRouter(prefix="/api/videos", tags=["videos"])

_default_registry = VideoRegistry()


def get_registry() -> VideoRegistry:
    return _default_registry


def _deduped_upload_path(video_dir: Path, filename: str) -> Path:
    """Return a non-colliding destination path inside the video directory."""
    video_dir.mkdir(parents=True, exist_ok=True)
    name = Path(filename).name
    dest = video_dir / name
    stem, suffix = Path(name).stem, Path(name).suffix
    counter = 1
    while dest.exists():
        dest = video_dir / f"{stem} ({counter}){suffix}"
        counter += 1
    return dest


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


@router.post("", response_model=VideoSourceInfo, status_code=201)
def upload_video(
    file: UploadFile = File(...),
    registry: VideoRegistry = Depends(get_registry),
) -> VideoSourceInfo:
    """Ingest a new MP4 into the monitored video set.

    Saves the upload into the same directory the registry already scans,
    re-scans so the new file becomes a first-class source, then returns its
    public record. Detection, tracking and risk analysis run on demand the
    moment the frontend selects it — no separate processing step needed.

    A file that cannot be decoded as video is refused and deleted rather than
    left behind as a broken registry entry (CLAUDE.md honesty rule).
    """
    original_name = file.filename or "upload.mp4"
    if not original_name.lower().endswith(".mp4"):
        raise HTTPException(status_code=415, detail="Only .mp4 files are accepted")

    dest = _deduped_upload_path(registry.video_dir, original_name)
    try:
        with dest.open("wb") as out:
            shutil.copyfileobj(file.file, out)
    except OSError as exc:
        raise HTTPException(status_code=500, detail=f"Failed to store upload: {exc}") from exc

    registry.refresh()
    record = registry.get(make_source_id(dest.name))
    meta = record.metadata if record is not None else None
    meta_ok = (
        meta is not None
        and meta.fps > 0
        and meta.duration > 0
        and meta.width > 0
        and meta.height > 0
    )
    if not meta_ok:
        dest.unlink(missing_ok=True)
        registry.refresh()
        raise HTTPException(
            status_code=422,
            detail="Uploaded file could not be decoded as MP4 video and was discarded.",
        )
    return record.to_public()


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
    model: str = Query("stock", description="Perception model used to locate faces for redaction ('stock' or 'pilot')."),
    redact: bool = Query(
        True,
        description=(
            "Obscure personnel head regions (Responsible AI — on by default). "
            "Disabling is a supervisor action; there is no auth layer yet, so "
            "this is currently an honest toggle, not an enforced permission."
        ),
    ),
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

    image = frame.image
    redaction_state = "disabled"
    if redact:
        # Lazy import: backend.api.perception imports get_registry from this
        # module, so a top-level import here would be circular.
        from backend.api.perception import get_pipeline_registry

        pipelines = get_pipeline_registry()
        pipeline = pipelines.get(model) or pipelines["stock"]
        try:
            image, region_count = pipeline.redact_frame_image(frame.image)
            redaction_state = "faces-blurred" if region_count else "no-faces-detected"
        except Exception as exc:
            # Fail closed on privacy: ANY redactor failure refuses the frame.
            # This deliberately catches Exception rather than enumerating
            # types. The tuple here was (FileNotFoundError, ImportError,
            # OSError), which covers missing weights and an absent
            # torch/ultralytics, but not what inference actually raises in
            # practice — a torch RuntimeError, a cv2.error, a shape mismatch —
            # so the common failures escaped as an opaque 500 with a stack
            # trace instead of this privacy-specific 503. No frame was ever
            # leaked either way, but the operator could not tell redaction was
            # the reason.
            raise HTTPException(
                status_code=503,
                detail=(
                    "Face redaction is enabled but the perception pipeline is unavailable "
                    f"({type(exc).__name__}); refusing to serve an un-redacted frame. Retry "
                    "with redact=false only if you are authorised to view raw footage."
                ),
            ) from exc

    ok, buffer = cv2.imencode(".jpg", image)
    if not ok:
        raise HTTPException(status_code=500, detail="Failed to encode frame as JPEG")

    return Response(
        content=buffer.tobytes(),
        media_type="image/jpeg",
        headers={"X-TRACE-Redaction": redaction_state},
    )


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


@router.get("/{video_id}/sampling")
def get_sampling_policy(
    video_id: str, registry: VideoRegistry = Depends(get_registry)
) -> dict:
    """Returns the deterministic adaptive temporal sampling policy for the video."""
    _get_record_or_404(registry, video_id)
    source = registry.open_source(video_id)
    try:
        decision = resolve_sampling_policy(source)
        return {
            "video_id": video_id,
            "analysis_fps": decision.analysis_fps,
            "source_fps": decision.source_fps,
            "sampling_mode": decision.sampling_mode.value,
            "frame_step": decision.frame_step,
            "rationale": decision.rationale,
        }
    finally:
        source.close()

