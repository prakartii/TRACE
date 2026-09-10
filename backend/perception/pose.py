"""Pose estimation for personnel entities (Layer 1 enhancement).

Adds 17-keypoint COCO skeletons to `person` entities so downstream
reasoning (and the UI) can see actual body geometry instead of inferring
it from bounding-box motion. Uses a YOLOv8-pose checkpoint — the same
ultralytics stack as detection — rather than MediaPipe: no extra native
dependency, and the weights auto-download the same way yolov8n.pt does.

Pose is deliberately OPTIONAL and degradable: the core detection loop must
never fail because pose is unavailable. `estimate()` returns ``[]`` when the
backend cannot be loaded, and the pipeline treats an empty result as
"no keypoints this frame" rather than an error.

Keypoint order is the COCO 17-point convention (see ``COCO_KEYPOINTS``);
coordinates are absolute pixels of the source frame, matching ``Entity.bbox``.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from pathlib import Path

import numpy as np

from backend.perception.config import PerceptionConfig

logger = logging.getLogger("trace.perception.pose")

# COCO 17-keypoint convention, index order. The frontend mirrors this order.
COCO_KEYPOINTS: tuple[str, ...] = (
    "nose", "left_eye", "right_eye", "left_ear", "right_ear",
    "left_shoulder", "right_shoulder", "left_elbow", "right_elbow",
    "left_wrist", "right_wrist", "left_hip", "right_hip",
    "left_knee", "right_knee", "left_ankle", "right_ankle",
)

# Skeleton limbs as (from, to) indices into COCO_KEYPOINTS.
COCO_LIMBS: tuple[tuple[int, int], ...] = (
    (5, 6), (5, 7), (7, 9), (6, 8), (8, 10),   # shoulders + arms
    (5, 11), (6, 12), (11, 12),                 # torso + hips
    (11, 13), (13, 15), (12, 14), (14, 16),     # legs
    (0, 1), (0, 2), (1, 3), (2, 4), (0, 5), (0, 6),  # face + neck
)


@dataclass(frozen=True)
class PersonPose:
    """One person's skeleton from a single frame.

    ``bbox`` is the pose model's own person box (absolute pixels), used to
    match it to a tracked `person` entity by IoU. ``keypoints`` is 17
    ``(x, y)`` tuples in COCO order (absolute pixels)."""
    bbox: tuple[float, float, float, float]
    keypoints: list[tuple[float, float]]
    confidence: float


class YoloPoseEstimator:
    """Loads a YOLOv8-pose model once and returns per-person keypoints."""

    def __init__(self, config: PerceptionConfig):
        self._config = config
        self._model = None
        self._failed = False

    @property
    def model_path(self) -> Path:
        return self._config.pose_model_path

    def _ensure_loaded(self) -> bool:
        """Returns True when the model is ready. Never raises: pose is optional."""
        if self._model is not None:
            return True
        if self._failed:
            return False
        if not self._config.pose_enabled:
            return False
        if not self.model_path.exists():
            logger.warning("Pose weights not found at %s; keypoints disabled.", self.model_path)
            self._failed = True
            return False
        try:
            from ultralytics import YOLO

            self._model = YOLO(str(self.model_path))
        except Exception as exc:  # noqa: BLE001 — degrade, never fail the loop
            logger.warning("Pose model failed to load: %s", exc)
            self._failed = True
            return False
        return True

    def estimate(self, image: np.ndarray) -> list[PersonPose]:
        """Returns up to one `PersonPose` per detected person, or ``[]`` when
        pose is unavailable or no person is present."""
        if not self._ensure_loaded():
            return []

        results = self._model.predict(
            image,
            conf=self._config.confidence_threshold,
            iou=self._config.iou_threshold,
            imgsz=self._config.inference_size,
            device=self._config.device,
            verbose=False,
        )
        if not results:
            return []
        r = results[0]
        if r.keypoints is None or r.keypoints.xy is None:
            return []

        xy = r.keypoints.xy
        xy = xy.cpu().numpy() if hasattr(xy, "cpu") else np.asarray(xy, dtype=float)
        conf = r.keypoints.conf
        conf = conf.cpu().numpy() if (conf is not None and hasattr(conf, "cpu")) else np.asarray(conf) if conf is not None else None

        boxes = r.boxes.xyxy if r.boxes is not None else None
        boxes = boxes.cpu().numpy() if (boxes is not None and hasattr(boxes, "cpu")) else np.asarray(boxes, dtype=float) if boxes is not None else None

        persons: list[PersonPose] = []
        for i in range(xy.shape[0]):
            kpts = [(float(p[0]), float(p[1])) for p in xy[i]]
            person_conf = float(conf[i].mean()) if conf is not None else 1.0
            bbox = tuple(float(v) for v in boxes[i]) if boxes is not None and i < len(boxes) else (0.0, 0.0, 0.0, 0.0)
            persons.append(PersonPose(bbox=bbox, keypoints=kpts, confidence=person_conf))
        return persons
