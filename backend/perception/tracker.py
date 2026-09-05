"""Multi-object tracking (Phase 3, corrected in Phase 4) — ByteTrack via
`supervision`.

Wraps `supervision.ByteTrack` behind a small, stateful `ObjectTracker`
that consumes/produces this package's own `RawDetection`/`TrackedObject`
types. `supervision.Detections` and ByteTrack internals never escape this
module (CLAUDE.md: "YOLO/ByteTrack internals must NOT leak outside the
perception package").

One `ObjectTracker` instance holds state across a single sequential run
over one video — track IDs are only meaningful within the lifetime of one
instance. See pipeline.py for how a run is scoped per video.

Phase 4 gate-audit finding, and why this file runs ONE ByteTrack instance
PER CLASS rather than one shared instance: `supervision.ByteTrack`'s
matching logic is purely spatial (IoU + Kalman-predicted position) and
never reads `class_id` at all — confirmed by inspecting the installed
package (supervision/tracker/ has no reference to `class_id` anywhere).
Passing distinct class_id values into a single shared tracker, as an
earlier version of this file did, has no effect on matching: a "box" and
a "person" that happen to swap positions between frames CAN still get
their track_ids swapped, because the tracker only ever looks at
geometry. The only way to make different classes structurally unable to
inherit each other's tracks with this library is to give each class its
own independent tracker instance, so a person detection is never even
compared against a box detection at the assignment stage. This is
verified directly in test_perception_tracker.py's swap-position
regression test.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np

from backend.perception.config import PerceptionConfig
from backend.perception.detector import RawDetection

# Track ids are namespaced per class as `class_index * ID_NAMESPACE_SIZE +
# local_id` so ids from different classes' independent trackers can never
# collide, while remaining a single plain int (TrackedObject.track_id's
# existing type — no contract change needed downstream). 1,000,000 local
# ids per class is far beyond anything a single video run could produce.
ID_NAMESPACE_SIZE = 1_000_000


@dataclass(frozen=True)
class TrackedObject:
    """A `RawDetection` with a persistent track id assigned by the
    tracker. `track_id` is stable for as long as the tracker can keep
    associating new detections with this object (including brief
    occlusion, per `lost_track_buffer_frames`) — it is scoped to one
    `ObjectTracker` instance/run, not globally unique across videos."""

    track_id: int
    class_name: str
    confidence: float
    x1: float
    y1: float
    x2: float
    y2: float


class ObjectTracker:
    """Stateful ByteTrack wrapper. Create one instance per sequential
    video-processing run; do not share an instance across unrelated
    videos or reuse it after a gap without resetting.

    Internally holds one independent ByteTrack instance per class_name
    (lazily created on first sight of that class) — see module docstring
    for why a single shared instance cannot give class-safe tracking with
    this library."""

    def __init__(self, config: PerceptionConfig):
        self._config = config
        self._trackers_by_class: dict[str, "object"] = {}
        self._class_index: dict[str, int] = {}

    def _new_backend(self):
        import supervision as sv

        return sv.ByteTrack(
            track_activation_threshold=self._config.track_activation_threshold,
            lost_track_buffer=self._config.lost_track_buffer_frames,
            minimum_matching_threshold=self._config.minimum_matching_threshold,
            frame_rate=self._config.track_frame_rate,
        )

    def _tracker_for_class(self, class_name: str):
        if class_name not in self._trackers_by_class:
            self._trackers_by_class[class_name] = self._new_backend()
            self._class_index[class_name] = len(self._class_index)
        return self._trackers_by_class[class_name]

    def reset(self) -> None:
        """Starts a fresh tracking run — clears all per-class trackers and
        the class_name<->index namespace assignment."""
        self._trackers_by_class = {}
        self._class_index = {}

    def update(self, detections: list[RawDetection]) -> list[TrackedObject]:
        """Advances every class's tracker by one frame and returns the
        currently-confirmed tracked objects across all classes (may be
        empty, and may lag a newly-appeared object by one frame — that's
        ByteTrack's normal track-confirmation behavior, not a bug).

        Every class tracker seen so far is advanced every call — including
        classes with zero detections this frame — so each class's own
        lost-track-buffer timing stays correct; a class that stops
        appearing still ages out on schedule rather than freezing."""
        import supervision as sv

        by_class: dict[str, list[RawDetection]] = {}
        for d in detections:
            by_class.setdefault(d.class_name, []).append(d)

        # Deterministic order: sorted by class_name, not dict/set iteration
        # order, so results are reproducible regardless of detection order.
        classes_to_advance = sorted(set(by_class) | set(self._trackers_by_class))

        results: list[TrackedObject] = []
        for class_name in classes_to_advance:
            tracker = self._tracker_for_class(class_name)
            class_detections = by_class.get(class_name, [])

            if class_detections:
                sv_detections = sv.Detections(
                    xyxy=np.array(
                        [[d.x1, d.y1, d.x2, d.y2] for d in class_detections],
                        dtype=np.float32,
                    ),
                    confidence=np.array(
                        [d.confidence for d in class_detections], dtype=np.float32
                    ),
                    class_id=np.zeros(len(class_detections), dtype=int),
                )
            else:
                sv_detections = sv.Detections.empty()

            tracked = tracker.update_with_detections(sv_detections)
            class_index = self._class_index[class_name]

            for i in range(len(tracked)):
                local_id = tracked.tracker_id[i]
                if local_id is None:
                    continue
                x1, y1, x2, y2 = (float(v) for v in tracked.xyxy[i])
                results.append(
                    TrackedObject(
                        track_id=class_index * ID_NAMESPACE_SIZE + int(local_id),
                        class_name=class_name,
                        confidence=float(tracked.confidence[i]),
                        x1=x1,
                        y1=y1,
                        x2=x2,
                        y2=y2,
                    )
                )
        return results
