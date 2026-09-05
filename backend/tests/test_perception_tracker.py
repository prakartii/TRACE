"""Unit tests for backend/perception/tracker.py — deterministic mocked
detections only, no model/weights involved."""

from backend.perception.config import PerceptionConfig
from backend.perception.detector import RawDetection
from backend.perception.tracker import ObjectTracker


def test_track_id_persists_across_frames_for_same_moving_object():
    tracker = ObjectTracker(PerceptionConfig())

    ids_seen = set()
    for i in range(5):
        tracked = tracker.update(
            [RawDetection("person", 0.9, 10 + i, 10, 50 + i, 100)]
        )
        ids_seen.update(t.track_id for t in tracked)

    assert len(ids_seen) == 1


def test_empty_detections_returns_empty_list():
    tracker = ObjectTracker(PerceptionConfig())
    assert tracker.update([]) == []


def test_class_name_is_preserved_per_tracked_object():
    tracker = ObjectTracker(PerceptionConfig())
    tracker.update([RawDetection("person", 0.9, 10, 10, 50, 100)])
    tracked = tracker.update([RawDetection("person", 0.9, 12, 11, 52, 101)])

    assert all(t.class_name == "person" for t in tracked)


def test_distinct_stationary_objects_get_distinct_track_ids():
    tracker = ObjectTracker(PerceptionConfig())

    for _ in range(3):
        tracked = tracker.update(
            [
                RawDetection("person", 0.9, 10, 10, 50, 100),
                RawDetection("person", 0.85, 400, 400, 440, 500),
            ]
        )

    track_ids = {t.track_id for t in tracked}
    assert len(track_ids) == 2


def test_reset_restarts_track_id_sequence():
    tracker = ObjectTracker(PerceptionConfig())

    for _ in range(3):
        first_run = tracker.update([RawDetection("person", 0.9, 10, 10, 50, 100)])

    tracker.reset()

    for _ in range(3):
        second_run = tracker.update([RawDetection("person", 0.9, 10, 10, 50, 100)])

    assert {t.track_id for t in first_run} == {t.track_id for t in second_run}


def test_bbox_values_are_passed_through():
    tracker = ObjectTracker(PerceptionConfig())
    tracked = tracker.update([RawDetection("person", 0.9, 10.0, 20.0, 30.0, 40.0)])

    assert tracked[0].x1 == 10.0
    assert tracked[0].y1 == 20.0
    assert tracked[0].x2 == 30.0
    assert tracked[0].y2 == 40.0


# ---------------------------------------------------------------------
# Class identity across tracking (Phase 4 perception-strengthening).
#
# Phase 4 gate-audit finding: `supervision.ByteTrack`'s matching is
# purely spatial (IoU + Kalman-predicted position) and never reads
# `class_id` — confirmed by inspecting the installed package. A single
# shared tracker instance can therefore let a "person" detection inherit
# a "box" track's id (or vice versa) purely from spatial coincidence.
# ObjectTracker fixes this by running one ByteTrack instance per class —
# these tests prove that fix, not just assert it.
# ---------------------------------------------------------------------


def test_different_classes_get_ids_from_disjoint_namespaces():
    tracker = ObjectTracker(PerceptionConfig())
    tracked = tracker.update(
        [
            RawDetection("box", 0.9, 100, 100, 200, 200),
            RawDetection("person", 0.9, 500, 500, 600, 700),
        ]
    )
    by_class = {t.class_name: t.track_id for t in tracked}
    assert by_class["box"] // 1_000_000 != by_class["person"] // 1_000_000


def test_class_identity_survives_position_swap_between_classes():
    """The critical regression: if a box and a person instantaneously
    swap positions between frames, the tracker must NOT let the person
    inherit the box's track_id (or vice versa) just because it now
    occupies that spatial location — each class's identity must come
    from its own independent tracker, never from cross-class geometry."""
    tracker = ObjectTracker(PerceptionConfig())

    for _ in range(3):
        tracked = tracker.update(
            [
                RawDetection("box", 0.9, 100, 100, 200, 200),
                RawDetection("person", 0.9, 500, 500, 600, 700),
            ]
        )
    box_id_before = next(t.track_id for t in tracked if t.class_name == "box")
    person_id_before = next(t.track_id for t in tracked if t.class_name == "person")

    # Instantaneous swap: box jumps to person's old spot and vice versa.
    for _ in range(3):
        tracked_after = tracker.update(
            [
                RawDetection("box", 0.9, 500, 500, 600, 700),
                RawDetection("person", 0.9, 100, 100, 200, 200),
            ]
        )

    classes_after = {t.class_name for t in tracked_after}
    # Whatever ids get assigned after the swap (new ones, since neither
    # class's tracker had geometry supporting a match to its own prior
    # track), a box must never be labeled with an id from the person
    # namespace, and a "person" must never carry the old box_id.
    for t in tracked_after:
        if t.class_name == "box":
            assert t.track_id != person_id_before
        elif t.class_name == "person":
            assert t.track_id != box_id_before
    assert classes_after <= {"box", "person"}


def test_class_never_relabeled_mid_track():
    """A track's reported class_name must never change across updates —
    each TrackedObject's class comes from its own class-specific tracker,
    so a track can't drift from one class to another over time."""
    tracker = ObjectTracker(PerceptionConfig())
    seen_classes_by_id: dict[int, set] = {}

    for i in range(5):
        tracked = tracker.update(
            [RawDetection("box", 0.9, 10 + i, 10, 50 + i, 100)]
        )
        for t in tracked:
            seen_classes_by_id.setdefault(t.track_id, set()).add(t.class_name)

    assert all(len(classes) == 1 for classes in seen_classes_by_id.values())


def test_lost_track_buffer_ages_independently_per_class():
    """A class with zero detections for several frames must still have
    its own tracker's internal clock advance (so it ages out on its own
    schedule) rather than freezing just because another class is still
    producing detections every frame."""
    config = PerceptionConfig(lost_track_buffer_frames=2)
    tracker = ObjectTracker(config)

    tracker.update([RawDetection("box", 0.9, 10, 10, 50, 100)])
    tracker.update([RawDetection("box", 0.9, 11, 10, 51, 100)])
    box_id = tracker.update([RawDetection("box", 0.9, 12, 10, 52, 100)])[0].track_id

    # box disappears; person keeps appearing every frame in the meantime.
    for _ in range(5):
        tracked = tracker.update([RawDetection("person", 0.9, 500, 500, 600, 700)])
    assert all(t.track_id != box_id for t in tracked)

    # box reappears at the same spot after longer than lost_track_buffer —
    # must be a NEW id, not a silently-revived stale one.
    tracked = tracker.update([RawDetection("box", 0.9, 12, 10, 52, 100)])
    tracked = tracker.update([RawDetection("box", 0.9, 12, 10, 52, 100)])
    new_box_ids = {t.track_id for t in tracked if t.class_name == "box"}
    assert box_id not in new_box_ids
