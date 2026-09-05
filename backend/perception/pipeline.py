"""Frame -> detections -> tracks -> Entities (Phase 3).

The only perception entry point other packages (backend/api/) should use.
Keeps inference logic independent of HTTP/UI: nothing here knows about
FastAPI, JSON, or the frontend.
"""

from __future__ import annotations

from backend.contracts.models import PerceptionFrameResult
from backend.perception.adapter import tracked_objects_to_entities
from backend.perception.config import DEFAULT_CONFIG, PerceptionConfig
from backend.perception.detector import YoloDetector
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
        self, frame: Frame, tracker: ObjectTracker
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
        )

    def process_video(
        self,
        source: VideoSource,
        *,
        start_time: float = 0.0,
        end_time: float | None = None,
        sample_fps: float | None = None,
    ) -> list[PerceptionFrameResult]:
        """Sequentially samples `source` and runs ONE tracker across the
        whole run, so track IDs are meaningful within the returned list.
        Deliberately sparse by default (`sample_fps`, not every frame) and
        hard-capped (`max_samples_per_run`) so one call can't trigger
        unbounded CPU inference."""
        sample_fps = sample_fps or self._config.default_sample_fps
        meta = source.metadata()
        frame_step = max(1, round(meta.fps / sample_fps)) if meta.fps > 0 else 1

        tracker = ObjectTracker(self._config)
        results: list[PerceptionFrameResult] = []
        for frame in source.iter_frames(
            start_time=start_time, end_time=end_time, frame_step=frame_step
        ):
            if len(results) >= self._config.max_samples_per_run:
                break
            results.append(self.process_frame(frame, tracker))
        return results
