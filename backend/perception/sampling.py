"""Adaptive temporal sampling policy for TRACE perception (Phase 8.2).

Deterministic, explainable sampling policy that selects analysis frame rate
based on video dynamics without modifying or transcoding the source video.
Preserves original source FPS and source immutability.

Policy:
- NORMAL: 3.0 FPS (standard dock operations, continuous steady movement)
- MOTION_DENSE: 6.0 FPS (rapid handling, throwing, dropping, tumbling)
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import Enum
from pathlib import Path
from typing import Optional

from backend.contracts.models import VideoMetadata
from backend.video.source import VideoSource


class SamplingMode(str, Enum):
    NORMAL = "normal"
    MOTION_DENSE = "motion_dense"


@dataclass(frozen=True)
class SamplingDecision:
    analysis_fps: float
    source_fps: float
    sampling_mode: SamplingMode
    frame_step: int
    rationale: str


# Filename tokens indicating high-dynamics or brief kinematic events (< 1.0s)
MOTION_DENSE_KEYWORDS = (
    "throwing",
    "dropping",
    "rolling",
    "tumbling",
    "toss",
    "fall",
)


def resolve_sampling_policy(
    source: VideoSource,
    *,
    requested_mode: Optional[str] = None,
    requested_fps: Optional[float] = None,
) -> SamplingDecision:
    """Determines the analysis sampling policy deterministically.
    
    Source video remains 100% immutable; only the frame-stepping iterator
    is configured.
    """
    meta: VideoMetadata = source.metadata()
    src_fps = float(meta.fps) if meta.fps > 0 else 30.0

    # 1. Explicit FPS requested
    if requested_fps is not None and requested_fps > 0:
        mode = (
            SamplingMode.MOTION_DENSE
            if requested_fps >= 5.0
            else SamplingMode.NORMAL
        )
        step = max(1, round(src_fps / requested_fps))
        eff_fps = round(src_fps / step, 2)
        return SamplingDecision(
            analysis_fps=eff_fps,
            source_fps=src_fps,
            sampling_mode=mode,
            frame_step=step,
            rationale=f"Explicitly configured analysis sampling rate: {eff_fps} FPS.",
        )

    # 2. Explicit mode requested
    if requested_mode:
        normalized_mode = requested_mode.lower().strip()
        if normalized_mode in (SamplingMode.MOTION_DENSE.value, "motion-dense", "dense"):
            target_fps = 6.0
            step = max(1, round(src_fps / target_fps))
            eff_fps = round(src_fps / step, 2)
            return SamplingDecision(
                analysis_fps=eff_fps,
                source_fps=src_fps,
                sampling_mode=SamplingMode.MOTION_DENSE,
                frame_step=step,
                rationale="Explicitly requested motion_dense sampling mode for high-frequency kinematics.",
            )
        elif normalized_mode in (SamplingMode.NORMAL.value, "standard"):
            target_fps = 3.0
            step = max(1, round(src_fps / target_fps))
            eff_fps = round(src_fps / step, 2)
            return SamplingDecision(
                analysis_fps=eff_fps,
                source_fps=src_fps,
                sampling_mode=SamplingMode.NORMAL,
                frame_step=step,
                rationale="Explicitly requested normal sampling mode for steady warehouse operations.",
            )

    # 3. Deterministic video classification based on source filename / metadata
    source_name = ""
    p = getattr(source, "path", None) or getattr(source, "_path", None)
    if p:
        source_name = Path(p).name.lower()
    elif hasattr(source, "source_id"):
        source_name = str(source.source_id).lower()

    is_motion_dense = any(kw in source_name for kw in MOTION_DENSE_KEYWORDS)

    if is_motion_dense:
        target_fps = 6.0
        step = max(1, round(src_fps / target_fps))
        eff_fps = round(src_fps / step, 2)
        return SamplingDecision(
            analysis_fps=eff_fps,
            source_fps=src_fps,
            sampling_mode=SamplingMode.MOTION_DENSE,
            frame_step=step,
            rationale=(
                f"Motion-dense clip detected ('{source_name}'). "
                f"Sampled at {eff_fps} FPS (source {src_fps} FPS) to satisfy "
                "temporal coherence across rapid manual handling and dropping events."
            ),
        )

    # Default: NORMAL 3.0 FPS
    target_fps = 3.0
    step = max(1, round(src_fps / target_fps))
    eff_fps = round(src_fps / step, 2)
    return SamplingDecision(
        analysis_fps=eff_fps,
        source_fps=src_fps,
        sampling_mode=SamplingMode.NORMAL,
        frame_step=step,
        rationale=(
            f"Standard operational clip ('{source_name}'). "
            f"Sampled at {eff_fps} FPS (source {src_fps} FPS) to balance CPU inference "
            "and track persistence for steady dock operations."
        ),
    )
