"""YOLO object detector (Phase 3).

Owns model loading and raw inference only. `RawDetection` and everything
in this module are internal to `backend/perception/` — `adapter.py` is the
only place that converts detector/tracker output into
`backend.contracts.models.Entity`. Nothing YOLO-specific escapes this
package.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Protocol

import numpy as np

from backend.perception.config import PerceptionConfig


@dataclass(frozen=True)
class RawDetection:
    """One raw detector output, in absolute pixel coordinates of the
    source frame it was detected in."""

    class_name: str
    confidence: float
    x1: float
    y1: float
    x2: float
    y2: float


class _ResultLike(Protocol):
    names: dict
    boxes: Any


def parse_result(result: _ResultLike, confidence_threshold: float) -> list[RawDetection]:
    """Converts one Ultralytics-shaped result into `RawDetection`s.

    Pulled out as a pure function (no model, no image) so confidence
    filtering and output shape are testable with a hand-built fake result
    object — no weights download required.
    """
    detections: list[RawDetection] = []
    for box in result.boxes:
        confidence = float(box.conf[0])
        if confidence < confidence_threshold:
            continue
        class_id = int(box.cls[0])
        x1, y1, x2, y2 = (float(v) for v in box.xyxy[0])
        detections.append(
            RawDetection(
                class_name=result.names[class_id],
                confidence=confidence,
                x1=x1,
                y1=y1,
                x2=x2,
                y2=y2,
            )
        )
    return detections


class YoloDetector:
    """Loads a YOLO model once and runs inference on demand.

    `ultralytics` is imported lazily inside `_ensure_loaded()` so that
    importing `backend.perception` (and running unit tests against
    `parse_result`/the tracker/the adapter with fakes) never requires
    torch/ultralytics to be importable, let alone model weights to exist.
    """

    def __init__(self, config: PerceptionConfig):
        self._config = config
        self._model = None

    def _ensure_loaded(self) -> None:
        if self._model is not None:
            return
        if not self._config.model_path.exists():
            raise FileNotFoundError(
                f"Model weights not found at '{self._config.model_path}'. "
                "See README.md for how to obtain them."
            )
        from ultralytics import YOLO

        self._model = YOLO(str(self._config.model_path))

    def detect(self, image: np.ndarray) -> list[RawDetection]:
        self._ensure_loaded()
        results = self._model.predict(
            image,
            conf=self._config.confidence_threshold,
            iou=self._config.iou_threshold,
            imgsz=self._config.inference_size,
            device=self._config.device,
            verbose=False,
        )
        return parse_result(results[0], self._config.confidence_threshold)
