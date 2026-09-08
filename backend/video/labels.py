"""Human-readable label for a camera/bay source id.

Lives in the video layer so reasoning/analytics modules
(``backend.assistant``, ``backend.learning``) don't have to import
``backend.api`` just to name a source.
"""

from __future__ import annotations

from typing import Optional

_CACHE: dict[str, str] = {}
_REGISTRY = None


def _registry():
    global _REGISTRY
    if _REGISTRY is None:
        from backend.video.registry import VideoRegistry

        _REGISTRY = VideoRegistry()
    return _REGISTRY


def source_label(video_id: Optional[str]) -> str:
    """Filename for ``video_id`` if the registry knows it, else the id itself.
    Memoised — the registry scans the media directory once, lazily."""
    if not video_id:
        return "unknown source"
    if video_id not in _CACHE:
        label = video_id
        try:
            rec = _registry().get(video_id)
            if rec is not None:
                label = rec.filename
        except Exception:
            pass
        _CACHE[video_id] = label
    return _CACHE[video_id]
