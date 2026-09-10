"""Live camera sources (RTSP/HLS/HTTP) — Layer 1's non-file ingestion path.

ARCHITECTURE.md §17 / §11 ("RTSP/live source can implement the same interface").
A live source is decoded by ``RTSPVideoSource`` (same ``VideoSource`` contract as
MP4 files) and streamed to the browser as a JPEG-over-WebSocket feed.

Live sources are configured via the ``TRACE_LIVE_SOURCES`` env var — a JSON list
of ``{"id": ..., "url": ..., "label": ...}`` — and default to empty (honest: no
camera is assumed to exist). Nothing here fabricates a feed.
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import time
from dataclasses import dataclass
from typing import Optional

import cv2
from fastapi import APIRouter, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.responses import Response

from backend.video.source import RTSPVideoSource, VideoDecodeError

logger = logging.getLogger("trace.live")

router = APIRouter(prefix="/api/live", tags=["live_sources"])


@dataclass(frozen=True)
class LiveSource:
    id: str
    url: str
    label: str


def load_live_sources() -> dict[str, LiveSource]:
    """Read configured live sources from ``TRACE_LIVE_SOURCES`` (JSON). Empty
    when unset — the system never invents a camera."""
    raw = os.environ.get("TRACE_LIVE_SOURCES", "")
    if not raw:
        return {}
    try:
        items = json.loads(raw)
    except (ValueError, TypeError):
        logger.warning("TRACE_LIVE_SOURCES is not valid JSON; ignoring.")
        return {}
    sources: dict[str, LiveSource] = {}
    for item in items:
        if not isinstance(item, dict) or not item.get("id") or not item.get("url"):
            continue
        sources[item["id"]] = LiveSource(
            id=item["id"], url=item["url"], label=item.get("label", item["id"])
        )
    return sources


# Test override point: tests can swap this dict without touching env.
_registry: dict[str, LiveSource] = {}


def get_live_sources() -> dict[str, LiveSource]:
    if not _registry:
        _registry.update(load_live_sources())
    return _registry


def register_live_source(source: LiveSource) -> None:
    _registry[source.id] = source


@router.get("")
def list_live_sources() -> list[dict]:
    return [
        {"id": s.id, "label": s.label}
        for s in get_live_sources().values()
    ]


@router.get("/{source_id}/frame")
def get_live_frame(source_id: str) -> Response:
    """Single JPEG frame from a live source (fallback / no-WebSocket client)."""
    source = get_live_sources().get(source_id)
    if source is None:
        raise HTTPException(status_code=404, detail=f"Unknown live source '{source_id}'")
    cap = RTSPVideoSource(source_id, source.url)
    try:
        cap.open()
        frame = cap.read_next()
    except VideoDecodeError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    finally:
        cap.close()
    if frame is None:
        raise HTTPException(status_code=503, detail="Live source produced no frame")
    return _frame_response(frame)


def _frame_response(frame) -> Response:
    ok, buf = cv2.imencode(".jpg", frame.image)
    if not ok:
        raise HTTPException(status_code=500, detail="Failed to encode frame as JPEG")
    return Response(content=buf.tobytes(), media_type="image/jpeg")


@router.websocket("/{source_id}/stream")
async def stream_live(websocket: WebSocket, source_id: str) -> None:
    """JPEG-over-WebSocket stream of a live source. Each message is a raw JPEG
    frame (``send_bytes``); the client renders them into a canvas/<img>."""
    await websocket.accept()
    source = get_live_sources().get(source_id)
    if source is None:
        await websocket.send_text(json.dumps({"error": f"Unknown live source '{source_id}'"}))
        await websocket.close()
        return

    cap = RTSPVideoSource(source_id, source.url)
    target_fps = 10.0
    frame_interval = 1.0 / target_fps
    try:
        cap.open()
        last = 0.0
        while True:
            # Peek for a client close / control message without blocking the loop.
            try:
                msg = await asyncio.wait_for(websocket.receive(), timeout=frame_interval)
                if msg.get("type") == "websocket.disconnect":
                    break
                # ignore other client messages (keep-alive pings etc.)
            except asyncio.TimeoutError:
                pass

            frame = cap.read_next()
            if frame is None:
                await asyncio.sleep(0.05)
                continue
            ok, buf = cv2.imencode(".jpg", frame.image)
            if not ok:
                continue
            await websocket.send_bytes(buf.tobytes())
            now = time.monotonic()
            if now - last < frame_interval:
                await asyncio.sleep(frame_interval - (now - last))
            last = time.monotonic()
    except (WebSocketDisconnect, RuntimeError):
        pass
    except VideoDecodeError as exc:
        try:
            await websocket.send_text(json.dumps({"error": str(exc)}))
        except Exception:  # noqa: BLE001
            pass
    finally:
        cap.close()
