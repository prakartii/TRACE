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

import math
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


class BoundingBoxSmoother:
    """Adaptive temporal bounding-box stabilizer.

    Suppresses high-frequency detector boundary jitter when an object is stationary
    or drifting, while dynamically adapting to fast motion (e.g. falling cartons,
    rapid projectile release, worker movements) without introducing lag.
    """

    def __init__(self, alpha_min: float = 0.35, alpha_max: float = 0.95):
        self.alpha_min = alpha_min
        self.alpha_max = alpha_max
        self.prev_box: tuple[float, float, float, float] | None = None

    def reset(self) -> None:
        self.prev_box = None

    def update(self, box: tuple[float, float, float, float]) -> tuple[float, float, float, float]:
        x1, y1, x2, y2 = box
        if self.prev_box is None:
            self.prev_box = (x1, y1, x2, y2)
            return (x1, y1, x2, y2)

        px1, py1, px2, py2 = self.prev_box
        prev_w = max(1.0, px2 - px1)
        prev_h = max(1.0, py2 - py1)

        # Relative center displacement scaled by object dimensions
        cx = (x1 + x2) / 2.0
        cy = (y1 + y2) / 2.0
        pcx = (px1 + px2) / 2.0
        pcy = (py1 + py2) / 2.0
        rel_disp = math.hypot((cx - pcx) / prev_w, (cy - pcy) / prev_h)

        # Scale alpha: stationary/jitter (rel_disp <= 0.03) uses alpha_min (strong smoothing),
        # fast motion (rel_disp >= 0.15) ramps smoothly to alpha_max (responsive, no lag).
        t = min(1.0, max(0.0, (rel_disp - 0.03) / 0.12))
        alpha = self.alpha_min + t * (self.alpha_max - self.alpha_min)

        sx1 = alpha * x1 + (1.0 - alpha) * px1
        sy1 = alpha * y1 + (1.0 - alpha) * py1
        sx2 = alpha * x2 + (1.0 - alpha) * px2
        sy2 = alpha * y2 + (1.0 - alpha) * py2

        # Sanity check: keep box non-degenerate
        if sx2 <= sx1 + 1.0:
            sx2 = sx1 + 1.0
        if sy2 <= sy1 + 1.0:
            sy2 = sy1 + 1.0

        self.prev_box = (sx1, sy1, sx2, sy2)
        return (sx1, sy1, sx2, sy2)


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
    tracking_status: str = "TRACKED"


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
        self._active_ids_prev: set[int] = set()
        self._all_seen_ids: set[int] = set()
        self._lost_ids: set[int] = set()
        self._reacquired_ids: set[int] = set()
        self._smoothers: dict[int, BoundingBoxSmoother] = {}

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
        self._active_ids_prev = set()
        self._all_seen_ids = set()
        self._lost_ids = set()
        self._reacquired_ids = set()
        self._smoothers.clear()

    def get_track_status(self, track_id: int) -> str:
        """Explicit tracking lifecycle status: TRACKED, REACQUIRED, or TEMPORARILY_LOST."""
        if track_id in self._active_ids_prev:
            return "REACQUIRED" if track_id in self._reacquired_ids else "TRACKED"
        if track_id in self._lost_ids:
            return "TEMPORARILY_LOST"
        return "UNKNOWN"

    def lost_track_ids(self) -> set[int]:
        return set(self._lost_ids)

    def reacquired_track_ids(self) -> set[int]:
        return set(self._reacquired_ids)

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
                raw_x1, raw_y1, raw_x2, raw_y2 = (float(v) for v in tracked.xyxy[i])
                track_id = class_index * ID_NAMESPACE_SIZE + int(local_id)

                if track_id in self._active_ids_prev:
                    status = "TRACKED"
                elif track_id in self._all_seen_ids:
                    status = "REACQUIRED"
                    self._reacquired_ids.add(track_id)
                    self._lost_ids.discard(track_id)
                else:
                    status = "TRACKED"
                    self._all_seen_ids.add(track_id)

                # Temporal bounding-box smoothing & jitter suppression
                if self._config.box_smoothing_enabled:
                    smoother = self._smoothers.setdefault(
                        track_id,
                        BoundingBoxSmoother(
                            self._config.box_smoothing_alpha_min,
                            self._config.box_smoothing_alpha_max,
                        ),
                    )
                    if status == "REACQUIRED":
                        smoother.reset()
                    x1, y1, x2, y2 = smoother.update((raw_x1, raw_y1, raw_x2, raw_y2))
                else:
                    x1, y1, x2, y2 = raw_x1, raw_y1, raw_x2, raw_y2

                results.append(
                    TrackedObject(
                        track_id=track_id,
                        class_name=class_name,
                        confidence=float(tracked.confidence[i]),
                        x1=x1,
                        y1=y1,
                        x2=x2,
                        y2=y2,
                        tracking_status=status,
                    )
                )

        curr_ids = {t.track_id for t in results}
        just_lost = self._active_ids_prev - curr_ids
        self._lost_ids.update(just_lost)
        # Clear reacquired ids that are now confirmed tracked in active set
        self._reacquired_ids = {tid for tid in self._reacquired_ids if tid not in curr_ids or tid not in self._active_ids_prev}
        self._active_ids_prev = curr_ids

        return results
