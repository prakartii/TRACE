"""Perception layer configuration (Phase 3).

One place to change the model, thresholds, and sampling rate — nothing
below this should be hardcoded elsewhere in backend/perception/ or
backend/api/.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path

from backend.perception.redaction import DEFAULT_REDACTION, RedactionConfig

# backend/perception/config.py -> backend/perception -> backend -> repo root
REPO_ROOT = Path(__file__).resolve().parents[2]
STOCK_MODEL_PATH = REPO_ROOT / "models" / "yolov8n.pt"
PILOT_MODEL_PATH = REPO_ROOT / "models" / "trace_pilot_v1.pt"
PILOT_V2_MODEL_PATH = REPO_ROOT / "models" / "trace_pilot_v2.pt"
POSE_MODEL_PATH = REPO_ROOT / "models" / "yolov8n-pose.pt"
DEFAULT_MODEL_PATH = STOCK_MODEL_PATH  # backwards-compat alias, used below

# Identifies which model produced a given detection/Entity — never
# inferred from the weights file, always stated explicitly, so the
# system never silently substitutes one model for another (Phase 4
# perception-strengthening gate). backend/perception/adapter.py's
# CLASS_MAP_BY_MODEL_IDENTITY looks up the class vocabulary by this exact
# string — keep the two in sync when adding a model.
STOCK_COCO_IDENTITY = "stock-coco-yolov8n"
TRACE_PILOT_IDENTITY = "trace-pilot-v1"
TRACE_PILOT_V2_IDENTITY = "trace-pilot-v2"


@dataclass(frozen=True)
class PerceptionConfig:
    # Pretrained COCO nano weights by default (person-only capability —
    # see adapter.py). Use PILOT_CONFIG below to run the TRACE pilot
    # fine-tune (person+box+pallet) instead. `model_identity` must match
    # whichever weights `model_path` actually points at — see
    # adapter.py's CLASS_MAP_BY_MODEL_IDENTITY, which selects the class
    # vocabulary from this field, not from the filename.
    model_path: Path = DEFAULT_MODEL_PATH
    model_identity: str = STOCK_COCO_IDENTITY
    device: str = "cpu"

    # Pose estimation (Layer 1 enhancement). Optional and degradable — when
    # disabled, or the weights are absent, entities simply carry no keypoints
    # and the core detection loop is unaffected. Off by default so the stock
    # (test) pipeline stays dependency-light; enabled on the pilot config.
    pose_enabled: bool = False
    pose_model_path: Path = POSE_MODEL_PATH

    confidence_threshold: float = 0.25
    iou_threshold: float = 0.45
    inference_size: int = 640

    # ByteTrack (via `supervision`) settings. `track_frame_rate` should
    # match the video's actual fps for its internal occlusion-buffer
    # timing to mean what it says (see backend/perception/tracker.py).
    track_activation_threshold: float = 0.25
    lost_track_buffer_frames: int = 30
    minimum_matching_threshold: float = 0.8
    track_frame_rate: int = 30

    # How densely to sample a video for sequential processing.
    # Deliberately sparse relative to native fps (CLAUDE.md: avoid
    # decoding/inferring every frame unnecessarily) — this is a real
    # tradeoff, not a free parameter: measured against the actual
    # challenge footage, ByteTrack's IoU matching (tuned for small
    # inter-frame motion) loses track continuity when consecutive
    # *samples* are far apart in time, because a walking person moves a
    # large fraction of their own bounding-box size between samples.
    # 3.0 (one inference every ~0.33s) is a middle ground; raising it
    # measurably improves track ID persistence (verified: at 8.0, a
    # single worker's ID stayed constant for 4+ consecutive seconds) at
    # the cost of proportionally longer first-view processing time.
    default_sample_fps: float = 3.0
    # Hard cap on samples per pipeline.process_video() call, independent
    # of sample_fps/duration, so a single request can't trigger an
    # unbounded amount of CPU inference.
    max_samples_per_run: int = 300

    # Bounding-box temporal smoothing & stabilization
    box_smoothing_enabled: bool = True
    box_smoothing_alpha_min: float = 0.35  # Jitter suppression when stationary / slow
    box_smoothing_alpha_max: float = 0.95  # Fast response during rapid motion / drops
    secondary_confidence_threshold: float = 0.10  # Low-confidence threshold for ByteTrack 2nd stage

    # Responsible AI (CLAUDE.md §22): personnel head regions are obscured on
    # every frame TRACE encodes back to a user. On by default — see
    # backend/perception/redaction.py.
    redaction: RedactionConfig = field(default_factory=lambda: DEFAULT_REDACTION)


DEFAULT_CONFIG = PerceptionConfig()

# TRACE pilot fine-tune (Phase 4 remediation) — person + box + pallet.
# See training/README.md for the dataset/training methodology and
# validated real-footage results before treating this as a drop-in
# replacement for DEFAULT_CONFIG anywhere.
PILOT_CONFIG = PerceptionConfig(
    model_path=PILOT_MODEL_PATH,
    model_identity=TRACE_PILOT_IDENTITY,
    pose_enabled=True,
)

# v2 vocabulary (person + box + pallet + trolley + forklift + vehicle_bed).
# Not yet trained — defined here so the class vocabulary and downstream maps
# (adapter) are ready the moment a labelled v2 dataset exists. See
# training/README.md "v2 classes" for the honesty note: no weights imply no
# detection, and mapping must never claim otherwise.
PILOT_V2_CONFIG = PerceptionConfig(
    model_path=PILOT_V2_MODEL_PATH,
    model_identity=TRACE_PILOT_V2_IDENTITY,
    pose_enabled=True,
)
