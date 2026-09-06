"""Phase 8.2 Adversarial Temporal Test Suite.

Contains all 14 required adversarial temporal and tracking tests:
1. 3 FPS fast drop (insufficient samples -> INSUFFICIENT_EVIDENCE)
2. 6 FPS fast drop (>=3 samples -> kinematic evaluation supported)
3. Short 1-2 frame disappearance (explicit TEMPORARILY_LOST, no fake interpolation)
4. 3+ frame coherent trajectory (linear trajectory, verified coherence)
5. Reacquisition after temporary loss (REACQUIRED tracking state)
6. Multiple workers (track identity separation without cross-talk)
7. Crossing worker + box (independent class trackers prevent cross-class ID theft)
8. Two nearby boxes (high 0.80 matching threshold maintains distinct IDs)
9. Tracker ID fragmentation prevention (abrupt jump rejected, no drift)
10. Variable FPS (speed computed using true dt from timestamps)
11. Duplicate / uneven timestamps (safe against zero or negative dt)
12. Motion blur / low confidence (evidence quality penalizes low confidence)
13. Stationary box + camera jitter (filtered by min net displacement & linearity)
14. Fast person + stationary box (no spurious dragging finding)
"""

from __future__ import annotations

import pytest

from backend.behaviour.lens import evaluate_behaviour
from backend.contracts.models import (
    BoundingBox,
    ConfidenceLevel,
    Entity,
    EntityClass,
    FindingStatus,
    PerceptionFrameResult,
)
from backend.perception.config import PerceptionConfig
from backend.perception.detector import RawDetection
from backend.perception.tracker import ObjectTracker
from backend.risk.aggregation import evidence_quality, status_and_confidence
from backend.risk.config import DEFAULT_RISK_CONFIG, RiskConfig
from backend.world_model.geometry import normalize_bbox
from backend.world_model.temporal import (
    TrackHistory,
    TrackSample,
    average_speed,
    build_track_histories,
    net_displacement,
    total_displacement,
    trajectory_linearity,
)


def _make_entity(
    entity_id: str,
    cls: EntityClass,
    x1: float,
    y1: float,
    x2: float,
    y2: float,
    ts: float,
    conf: float = 0.90,
    tracking_status: str = "TRACKED",
) -> Entity:
    return Entity(
        id=entity_id,
        track_id=entity_id.split(":")[-1],
        entity_class=cls,
        bbox=BoundingBox(x1=x1, y1=y1, x2=x2, y2=y2),
        confidence=conf,
        timestamp=ts,
        tracking_status=tracking_status,
    )


def _make_frame_result(
    source_id: str,
    ts: float,
    entities: list[Entity],
    fps: float = 3.0,
    mode: str = "normal",
) -> PerceptionFrameResult:
    return PerceptionFrameResult(
        source_id=source_id,
        timestamp=ts,
        entities=entities,
        model_identity="trace-pilot-v1",
        analysis_fps=fps,
        source_fps=30.0,
        sampling_mode=mode,
    )


# --------------------------------------------------------------------------
# Test 1: 3 FPS fast drop (insufficient temporal samples -> INSUFFICIENT_EVIDENCE)
# --------------------------------------------------------------------------
def test_1_three_fps_fast_drop_insufficient_samples():
    """A rapid drop occurring in 0.35s sampled at 3 FPS yields only 2 samples.
    Because behaviour requires >= 3 samples for velocity evaluation, no dropping
    claim is promoted, preserving epistemic honesty."""
    w, h = 1280, 720
    # At 3 FPS: frame 0 at t=0.0, frame 1 at t=0.33
    frames = [
        _make_frame_result(
            "src",
            0.0,
            [
                _make_entity("src:1", EntityClass.PERSON, 400, 200, 500, 600, 0.0),
                _make_entity("src:2", EntityClass.BOX, 420, 250, 480, 320, 0.0),
            ],
            fps=3.0,
        ),
        _make_frame_result(
            "src",
            0.33,
            [
                _make_entity("src:1", EntityClass.PERSON, 400, 200, 500, 600, 0.33),
                _make_entity("src:2", EntityClass.BOX, 420, 450, 480, 520, 0.33),
            ],
            fps=3.0,
        ),
    ]
    findings = evaluate_behaviour(frames, frame_width=w, frame_height=h, timestamp=0.33)
    # With only 2 samples, it should not trigger dropping_or_throwing_precursor
    scenarios = [f.scenario for f in findings]
    assert "dropping_or_throwing_precursor" not in scenarios


# --------------------------------------------------------------------------
# Test 2: 6 FPS fast drop (motion-dense sampling allows kinematic evaluation)
# --------------------------------------------------------------------------
def test_2_six_fps_fast_drop_satisfies_temporal_coherence():
    """At 6 FPS, the same rapid drop event yields 4 samples across 0.5s.
    With >= 3 samples, the kinematic trajectory is verifiable without fabricating data."""
    w, h = 1280, 720
    frames = [
        _make_frame_result(
            "src",
            0.0,
            [
                _make_entity("src:1", EntityClass.PERSON, 400, 200, 500, 600, 0.0),
                _make_entity("src:2", EntityClass.BOX, 420, 220, 480, 280, 0.0),
            ],
            fps=6.0,
            mode="motion_dense",
        ),
        _make_frame_result(
            "src",
            0.16,
            [
                _make_entity("src:1", EntityClass.PERSON, 400, 200, 500, 600, 0.16),
                _make_entity("src:2", EntityClass.BOX, 420, 280, 480, 340, 0.16),
            ],
            fps=6.0,
            mode="motion_dense",
        ),
        _make_frame_result(
            "src",
            0.33,
            [
                _make_entity("src:1", EntityClass.PERSON, 400, 200, 500, 600, 0.33),
                _make_entity("src:2", EntityClass.BOX, 420, 360, 480, 420, 0.33),
            ],
            fps=6.0,
            mode="motion_dense",
        ),
        _make_frame_result(
            "src",
            0.50,
            [
                _make_entity("src:1", EntityClass.PERSON, 400, 200, 500, 600, 0.50),
                _make_entity("src:2", EntityClass.BOX, 420, 460, 480, 520, 0.50),
            ],
            fps=6.0,
            mode="motion_dense",
        ),
    ]
    findings = evaluate_behaviour(frames, frame_width=w, frame_height=h, timestamp=0.50)
    drop_finding = next((f for f in findings if f.scenario == "dropping_or_throwing_precursor"), None)
    assert drop_finding is not None
    assert drop_finding.status in (FindingStatus.PROBABLE, FindingStatus.SUPPORTED)


# --------------------------------------------------------------------------
# Test 3: Short 1-2 frame disappearance (explicit TEMPORARILY_LOST, no fake points)
# --------------------------------------------------------------------------
def test_3_short_frame_disappearance_no_interpolation():
    """An object tracked for 2 frames disappears for 2 frames, then reappears.
    TRACE must NOT interpolate missing samples, but explicitly record the gap as TEMPORARILY_LOST."""
    w, h = 1280, 720
    frames = [
        _make_frame_result("src", 0.0, [_make_entity("src:2", EntityClass.BOX, 100, 100, 200, 200, 0.0)]),
        _make_frame_result("src", 0.33, [_make_entity("src:2", EntityClass.BOX, 110, 100, 210, 200, 0.33)]),
        # Missing at t=0.66 and t=0.99
        _make_frame_result("src", 0.66, []),
        _make_frame_result("src", 0.99, []),
        # Reacquired at t=1.32
        _make_frame_result("src", 1.32, [_make_entity("src:2", EntityClass.BOX, 130, 100, 230, 200, 1.32, tracking_status="REACQUIRED")]),
    ]
    histories = build_track_histories(frames, w, h)
    box_hist = histories["src:2"]
    # Exactly 3 observed samples — ZERO interpolated points
    assert len(box_hist.samples) == 3
    assert len(box_hist.lost_intervals) >= 1
    # State during gap is TEMPORARILY_LOST
    assert box_hist.get_state_at(0.70) == "TEMPORARILY_LOST"
    assert box_hist.get_state_at(0.0) == "TRACKED"
    assert box_hist.get_state_at(1.32) == "REACQUIRED"


# --------------------------------------------------------------------------
# Test 4: 3+ frame coherent trajectory (linear trajectory verification)
# --------------------------------------------------------------------------
def test_4_coherent_trajectory_linearity():
    """4 consecutive frames of straight-line horizontal translation yield
    trajectory linearity near 1.0, satisfying the coherent trajectory requirement."""
    w, h = 1280, 720
    frames = [
        _make_frame_result("src", i * 0.33, [_make_entity("src:2", EntityClass.BOX, 100 + i * 50, 200, 200 + i * 50, 300, i * 0.33)])
        for i in range(4)
    ]
    histories = build_track_histories(frames, w, h)
    box_hist = histories["src:2"]
    assert len(box_hist.samples) == 4
    lin = trajectory_linearity(box_hist)
    assert lin >= 0.95
    assert net_displacement(box_hist) > 0.05


# --------------------------------------------------------------------------
# Test 5: Reacquisition after temporary loss in ObjectTracker
# --------------------------------------------------------------------------
def test_5_reacquisition_after_temporary_loss_in_tracker():
    """ByteTrack keeps lost tracks for lost_track_buffer_frames. When reacquired,
    it retains track_id and marks status as REACQUIRED."""
    config = PerceptionConfig(lost_track_buffer_frames=5, minimum_matching_threshold=0.8)
    tracker = ObjectTracker(config)

    # Track object for 2 frames
    tracker.update([RawDetection("box", 0.9, 100, 100, 200, 200)])
    t1 = tracker.update([RawDetection("box", 0.9, 102, 100, 202, 200)])
    tid = t1[0].track_id

    # Disappears for 1 frame
    t_empty = tracker.update([])
    assert len(t_empty) == 0
    assert tracker.get_track_status(tid) == "TEMPORARILY_LOST"

    # Reappears at close position
    t_reacquired = tracker.update([RawDetection("box", 0.9, 104, 100, 204, 200)])
    assert len(t_reacquired) == 1
    assert t_reacquired[0].track_id == tid
    assert t_reacquired[0].tracking_status == "REACQUIRED"
    assert tracker.get_track_status(tid) == "REACQUIRED"


# --------------------------------------------------------------------------
# Test 6: Multiple workers (track identity separation without cross-talk)
# --------------------------------------------------------------------------
def test_6_multiple_workers_track_identity_separation():
    """Two workers moving simultaneously maintain separate tracks without ID collisions."""
    tracker = ObjectTracker(PerceptionConfig())
    for i in range(4):
        tracked = tracker.update([
            RawDetection("person", 0.9, 100 + i * 5, 200, 180 + i * 5, 500),
            RawDetection("person", 0.9, 500 - i * 5, 200, 580 - i * 5, 500),
        ])
        assert len(tracked) == 2

    person_ids = {t.track_id for t in tracked}
    assert len(person_ids) == 2


# --------------------------------------------------------------------------
# Test 7: Crossing worker + box (independent per-class trackers prevent class transfer)
# --------------------------------------------------------------------------
def test_7_crossing_worker_and_box_class_integrity():
    """When a person and a box cross paths and overlap spatially, independent
    per-class trackers ensure the person track never takes the box track ID or vice versa."""
    tracker = ObjectTracker(PerceptionConfig())
    # Person moving right, box moving left
    for i in range(5):
        tracked = tracker.update([
            RawDetection("person", 0.9, 200 + i * 20, 200, 300 + i * 20, 500),
            RawDetection("box", 0.9, 350 - i * 20, 350, 450 - i * 20, 450),
        ])
    classes = {t.class_name for t in tracked}
    assert "person" in classes and "box" in classes
    by_class = {t.class_name: t.track_id for t in tracked}
    # Ensure they have disjoint class ID namespaces
    assert by_class["box"] // 1_000_000 != by_class["person"] // 1_000_000


# --------------------------------------------------------------------------
# Test 8: Two nearby boxes (0.80 matching threshold maintains distinct IDs)
# --------------------------------------------------------------------------
def test_8_two_nearby_boxes_maintain_distinct_ids():
    """Two boxes placed right next to each other maintain two distinct track IDs."""
    tracker = ObjectTracker(PerceptionConfig(minimum_matching_threshold=0.8))
    for _ in range(4):
        tracked = tracker.update([
            RawDetection("box", 0.9, 100, 200, 200, 300),
            RawDetection("box", 0.9, 205, 200, 305, 300),
        ])
    assert len(tracked) == 2
    assert tracked[0].track_id != tracked[1].track_id


# --------------------------------------------------------------------------
# Test 9: Tracker ID fragmentation prevention (abrupt jump creates new track)
# --------------------------------------------------------------------------
def test_9_abrupt_jump_creates_new_track_no_drift():
    """An object jumping across the frame (> 0.80 IoU displacement) is rejected
    by ByteTrack's 0.80 matching threshold and assigned a new track rather than corrupting identity."""
    tracker = ObjectTracker(PerceptionConfig(minimum_matching_threshold=0.8))
    for _ in range(3):
        t1 = tracker.update([RawDetection("box", 0.9, 100, 100, 200, 200)])
    old_id = t1[0].track_id

    # Instantaneous leap to distant coordinates (IoU = 0)
    for _ in range(3):
        t2 = tracker.update([RawDetection("box", 0.9, 700, 500, 800, 600)])
    new_id = t2[0].track_id

    assert old_id != new_id


# --------------------------------------------------------------------------
# Test 10: Variable FPS (speed computed using true dt from timestamps)
# --------------------------------------------------------------------------
def test_10_variable_fps_uses_true_timestamps():
    """Uneven inter-sample durations (dt = 0.1s, 0.4s, 0.2s) compute speed
    accurately from total duration rather than assuming constant dt."""
    w, h = 1280, 720
    frames = [
        _make_frame_result("src", 0.00, [_make_entity("src:1", EntityClass.BOX, 100, 100, 200, 200, 0.00)]),
        _make_frame_result("src", 0.10, [_make_entity("src:1", EntityClass.BOX, 110, 100, 210, 200, 0.10)]),
        _make_frame_result("src", 0.50, [_make_entity("src:1", EntityClass.BOX, 150, 100, 250, 200, 0.50)]),
        _make_frame_result("src", 0.70, [_make_entity("src:1", EntityClass.BOX, 170, 100, 270, 200, 0.70)]),
    ]
    histories = build_track_histories(frames, w, h)
    box_hist = histories["src:1"]
    spd = average_speed(box_hist)
    assert spd is not None
    duration = 0.70 - 0.00
    assert abs(spd - (total_displacement(box_hist) / duration)) < 1e-6


# --------------------------------------------------------------------------
# Test 11: Duplicate / uneven timestamps (safe against zero or negative dt)
# --------------------------------------------------------------------------
def test_11_duplicate_timestamps_handled_safely():
    """Duplicate timestamps (duration <= 0) must return None for speed rather than crashing."""
    sample_a = TrackSample(timestamp=1.0, position=(0.5, 0.5), confidence=0.9)
    sample_b = TrackSample(timestamp=1.0, position=(0.5, 0.5), confidence=0.9)
    hist = TrackHistory(entity_id="e1", entity_class=EntityClass.BOX, samples=[sample_a, sample_b])
    assert average_speed(hist) is None


# --------------------------------------------------------------------------
# Test 12: Motion blur / low detection confidence
# --------------------------------------------------------------------------
def test_12_motion_blur_reduces_evidence_quality():
    """Motion blur degrades detector confidence to 0.26. Evidence quality formula
    multiplies mean confidence, capping status below SUPPORTED."""
    # Box class reliability = 0.5
    score = evidence_quality(
        mean_detection_confidence=0.26,
        entity_classes=[EntityClass.PERSON, EntityClass.BOX],
        sample_count=5,
        min_expected_samples=4,
    )
    # 0.26 * 0.5 * 1.0 = 0.13 < 0.30
    status, conf = status_and_confidence(score, DEFAULT_RISK_CONFIG)
    assert status == FindingStatus.INSUFFICIENT_EVIDENCE
    assert conf == ConfidenceLevel.LOW


# --------------------------------------------------------------------------
# Test 13: Stationary box + camera jitter (filtered by net displacement & linearity)
# --------------------------------------------------------------------------
def test_13_stationary_box_camera_jitter_filtered():
    """A stationary box vibrating ±2 pixels around a fixed point generates cumulative
    displacement, but net displacement < 0.04 and linearity < 0.35 filter it out."""
    w, h = 1280, 720
    # Jitter oscillation around x=400, y=300
    frames = []
    offsets = [0, 4, -4, 3, -3, 2, -2, 0]
    for i, off in enumerate(offsets):
        frames.append(
            _make_frame_result(
                "src",
                i * 0.33,
                [
                    _make_entity("src:1", EntityClass.PERSON, 380, 200, 460, 500, i * 0.33),
                    _make_entity("src:2", EntityClass.BOX, 400 + off, 300, 480 + off, 380, i * 0.33),
                ],
            )
        )
    findings = evaluate_behaviour(frames, frame_width=w, frame_height=h, timestamp=len(offsets) * 0.33)
    # Must NOT report box_displacement_near_person, dragging, or dropping
    scenarios = [f.scenario for f in findings]
    assert "box_displacement_near_person" not in scenarios
    assert "dragging_precursor" not in scenarios
    assert "dropping_or_throwing_precursor" not in scenarios


# --------------------------------------------------------------------------
# Test 14: Fast person + stationary box (no false dragging claim)
# --------------------------------------------------------------------------
def test_14_fast_person_past_stationary_box_no_dragging():
    """A worker walks rapidly past a stationary box. The box does not translate,
    so no dragging finding is generated."""
    w, h = 1280, 720
    frames = []
    for i in range(5):
        frames.append(
            _make_frame_result(
                "src",
                i * 0.33,
                [
                    # Person walks quickly from left to right (x: 100 -> 700)
                    _make_entity("src:1", EntityClass.PERSON, 100 + i * 150, 200, 180 + i * 150, 600, i * 0.33),
                    # Box remains stationary at x=400
                    _make_entity("src:2", EntityClass.BOX, 400, 400, 480, 480, i * 0.33),
                ],
            )
        )
    findings = evaluate_behaviour(frames, frame_width=w, frame_height=h, timestamp=4 * 0.33)
    scenarios = [f.scenario for f in findings]
    assert "dragging_precursor" not in scenarios
    assert "dropping_or_throwing_precursor" not in scenarios
