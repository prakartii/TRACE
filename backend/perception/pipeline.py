"""Frame -> detections -> tracks -> Entities (Phase 3).

The only perception entry point other packages (backend/api/) should use.
Keeps inference logic independent of HTTP/UI: nothing here knows about
FastAPI, JSON, or the frontend.
"""

from __future__ import annotations

import numpy as np

from backend.contracts.models import PerceptionFrameResult
from backend.perception.adapter import tracked_objects_to_entities
from backend.perception.config import DEFAULT_CONFIG, PerceptionConfig
from backend.perception.detector import YoloDetector
from backend.perception.redaction import redact_person_faces
from backend.perception.sampling import resolve_sampling_policy
from backend.perception.tracker import ObjectTracker
from backend.video.source import Frame, VideoSource


class PerceptionPipeline:
    """Owns a detector (loaded once, reused across calls). Tracking state
    is scoped separately per `process_video()` run — see that method."""

    def __init__(
        self,
        config: PerceptionConfig = DEFAULT_CONFIG,
        detector: YoloDetector | None = None,
    ):
        self._config = config
        self._detector = detector or YoloDetector(config)

    def process_frame(
        self,
        frame: Frame,
        tracker: ObjectTracker,
        *,
        analysis_fps: float = 3.0,
        source_fps: float = 30.0,
        sampling_mode: str = "normal",
    ) -> PerceptionFrameResult:
        """Detects + advances `tracker` by exactly one frame. The caller
        owns the tracker's lifetime/scope (see `process_video` for the
        common sequential-run case) — track IDs are only comparable across
        calls that share the same tracker instance."""
        detections = self._detector.detect(frame.image)
        tracked = tracker.update(detections)
        entities = tracked_objects_to_entities(
            tracked,
            source_id=frame.source_id,
            timestamp=frame.timestamp,
            model_identity=self._config.model_identity,
        )
        return PerceptionFrameResult(
            source_id=frame.source_id,
            timestamp=frame.timestamp,
            frame_index=frame.frame_index,
            entities=entities,
            model_identity=self._config.model_identity,
            analysis_fps=analysis_fps,
            source_fps=source_fps,
            sampling_mode=sampling_mode,
        )

    def redact_frame_image(self, image: np.ndarray) -> tuple[np.ndarray, int]:
        """Return ``(redacted_copy, region_count)`` for a decoded BGR frame
        (Responsible AI — CLAUDE.md §22). ``region_count`` is how many head
        regions were actually obscured — 0 means no person was detected, which
        the caller must not report as "faces blurred".

        Runs a single detection pass to locate person boxes; TRACE's own
        reasoning never needs a face. A no-op (count 0) when redaction is off.
        """
        cfg = self._config.redaction
        if not cfg.enabled:
            return image.copy(), 0
        detections = self._detector.detect(image)
        person_boxes = [
            (d.x1, d.y1, d.x2, d.y2)
            for d in detections
            if d.class_name == "person"
        ]
        return redact_person_faces(image, person_boxes, cfg), len(person_boxes)

    def process_video(
        self,
        source: VideoSource,
        *,
        start_time: float = 0.0,
        end_time: float | None = None,
        sample_fps: float | None = None,
        sampling_mode: str | None = None,
    ) -> list[PerceptionFrameResult]:
        """Sequentially samples `source` using adaptive sampling policy and runs
        ONE tracker across the whole run, so track IDs are meaningful within the returned list.
        Deliberately deterministic and hard-capped (`max_samples_per_run`) so one call
        can't trigger unbounded CPU inference."""
        decision = resolve_sampling_policy(
            source,
            requested_mode=sampling_mode,
            requested_fps=sample_fps,
        )
        frame_step = decision.frame_step

        tracker = ObjectTracker(self._config)
        results: list[PerceptionFrameResult] = []
        for frame in source.iter_frames(
            start_time=start_time, end_time=end_time, frame_step=frame_step
        ):
            if len(results) >= self._config.max_samples_per_run:
                break
            results.append(
                self.process_frame(
                    frame,
                    tracker,
                    analysis_fps=decision.analysis_fps,
                    source_fps=decision.source_fps,
                    sampling_mode=decision.sampling_mode.value,
                )
            )
        return results
