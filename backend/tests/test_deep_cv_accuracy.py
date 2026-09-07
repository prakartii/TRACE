"""Deep AI/CV Accuracy & Epistemic Regression Test Suite.

Validates:
1. Bounding box temporal smoothing and jitter attenuation vs fast-motion tracking.
2. ByteTrack occlusion handling & tracking status continuity (TRACKED -> TEMPORARILY_LOST -> REACQUIRED -> TRACKED).
3. 2D camera perspective ground-plane alignment rejecting false stacking.
4. Cantilever overhang and support geometry calculations.
5. Multi-frame kinematic drop acceleration vs gradual lowering.
6. Ground-sliding horizontal dragging vs elevated carry.
7. Rolling translation aspect-ratio alternation vs stationary noise.
8. Multi-worker collaborative team lift vs solo heavy handling.
9. 4-tier epistemic classification (OBSERVED, INFERRED, PREDICTED, VERIFIED) and status ceilings.
"""

from __future__ import annotations

import numpy as np
import pytest

from backend.behaviour.recognizer import (
    compute_kinematics,
    recognize_all_behaviours,
    recognize_dragging,
    recognize_rolling,
    recognize_solo_heavy_handling,
    recognize_throwing_or_dropping,
)
from backend.contracts.models import (
    BoundingBox,
    ConfidenceLevel,
    Entity,
    EntityClass,
    EpistemicLevel,
    EventType,
    FindingStatus,
    MassClass,
    PerceptionFrameResult,
    ProductMetadata,
    RiskBand,
    RiskLens,
    SceneGraphEdgeType,
)
from backend.lenses.structural import evaluate_structural
from backend.perception.config import PerceptionConfig
from backend.perception.detector import RawDetection
from backend.perception.tracker import BoundingBoxSmoother, ObjectTracker
from backend.risk.aggregation import evidence_quality, status_and_confidence
from backend.risk.config import DEFAULT_RISK_CONFIG
from backend.world_model.geometry import (
    cantilever_overhang_metrics,
    is_ground_plane_aligned,
    vertical_overlap_ratio,
)
from backend.world_model.scene_graph import WorldModel
from backend.world_model.temporal import (
    TrackHistory,
    TrackSample,
    build_track_histories,
    is_ground_sliding,
    rolling_downward_speed,
)


# ---------------------------------------------------------------------------
# 1. Bounding Box Smoother & Jitter Attenuation Tests
# ---------------------------------------------------------------------------

def test_box_smoother_attenuates_stationary_jitter():
    """Validates that detector high-frequency jitter on a stationary object is attenuated."""
    smoother = BoundingBoxSmoother(alpha_min=0.35, alpha_max=0.95)

    base_box = (100.0, 100.0, 200.0, 200.0)
    jittered_boxes = []
    smoothed_boxes = []

    # Simulate 20 frames of small pixel jitter around base_box (+- 4 pixels)
    np.random.seed(42)
    for _ in range(20):
        noise = np.random.uniform(-4.0, 4.0, size=4)
        noisy_box = (
            base_box[0] + noise[0],
            base_box[1] + noise[1],
            base_box[2] + noise[2],
            base_box[3] + noise[3],
        )
        jittered_boxes.append(noisy_box)
        smoothed = smoother.update(noisy_box)
        smoothed_boxes.append(smoothed)

    jittered_arr = np.array(jittered_boxes)
    smoothed_arr = np.array(smoothed_boxes)

    # Variance of smoothed center coordinates must be significantly smaller than raw jitter
    raw_var = np.var(jittered_arr[:, :2], axis=0).mean()
    smooth_var = np.var(smoothed_arr[:, :2], axis=0).mean()
    assert smooth_var < raw_var * 0.70, f"Expected smoother to attenuate jitter: raw_var={raw_var}, smooth_var={smooth_var}"


def test_box_smoother_adapts_to_fast_motion_without_lag():
    """Validates that during fast motion (e.g. falling carton), smoother ramps alpha to ~0.95."""
    smoother = BoundingBoxSmoother(alpha_min=0.35, alpha_max=0.95)

    box1 = (100.0, 100.0, 200.0, 200.0)
    smoother.update(box1)

    # Sudden large drop displacement (300 pixels downward)
    box2 = (100.0, 400.0, 200.0, 500.0)
    smoothed = smoother.update(box2)

    # With alpha ~0.95, smoothed y should be close to box2 (>= 380.0), not lagging behind at ~200
    assert smoothed[1] >= 380.0, f"Expected high alpha on rapid movement, got y1={smoothed[1]}"


# ---------------------------------------------------------------------------
# 2. Tracking Lifecycle: Occlusion & Reacquisition
# ---------------------------------------------------------------------------

def test_tracker_occlusion_and_reacquisition_lifecycle():
    """Validates ByteTrack secondary association: TRACKED -> TEMPORARILY_LOST -> REACQUIRED -> TRACKED."""
    config = PerceptionConfig(
        confidence_threshold=0.10,
        track_activation_threshold=0.35,
        secondary_confidence_threshold=0.10,
        box_smoothing_enabled=True,
    )
    tracker = ObjectTracker(config=config)

    # Frame 1 & 2: Initial detection and ByteTrack track confirmation
    det = [RawDetection("box", 0.85, 100, 100, 200, 200)]
    tracker.update(det)
    t1 = tracker.update(det)
    assert len(t1) == 1
    track_id = t1[0].track_id
    assert t1[0].tracking_status == "TRACKED"

    # Frame 3: Object is temporarily occluded / not detected
    t2 = tracker.update([])
    assert len(t2) == 0
    assert tracker.get_track_status(track_id) == "TEMPORARILY_LOST"

    # Frame 4: Object reappears at same location -> status is REACQUIRED
    det_reappear = [RawDetection("box", 0.85, 102, 102, 202, 202)]
    t3 = tracker.update(det_reappear)
    assert len(t3) == 1
    assert t3[0].track_id == track_id
    assert t3[0].tracking_status == "REACQUIRED"

    # Frame 5: Object continues being tracked -> status stabilizes back to TRACKED
    det_cont = [RawDetection("box", 0.85, 104, 104, 204, 204)]
    t4 = tracker.update(det_cont)
    assert len(t4) == 1
    assert t4[0].track_id == track_id
    assert t4[0].tracking_status == "TRACKED"


# ---------------------------------------------------------------------------
# 3. Perspective Ground-Plane Alignment vs Stacking
# ---------------------------------------------------------------------------

def test_ground_plane_alignment_rejects_perspective_false_stacking():
    """In surveillance video, two boxes resting side-by-side or front-to-back on the floor
    can touch vertically in 2D image space. Validates that ground-plane alignment check
    suppresses false support edge."""
    # Box A (foreground): bottom at y=0.88, top at y=0.68
    box_a = BoundingBox(x1=0.30, y1=0.68, x2=0.50, y2=0.88)
    # Box B (co-planar floor, slightly different x or depth): bottom at y=0.86, top at y=0.66
    box_b = BoundingBox(x1=0.32, y1=0.66, x2=0.52, y2=0.86)

    # Both boxes rest on the warehouse floor (y2 >= 0.50, abs(0.88 - 0.86) = 0.02 < 0.04)
    assert is_ground_plane_aligned(box_a, box_b, threshold=0.04) is True

    # Build perception frame with both entities
    frame = PerceptionFrameResult(
        source_id="cam1",
        timestamp=1.0,
        entities=[
            Entity(
                id="box_a",
                entity_class=EntityClass.BOX,
                bbox=BoundingBox(x1=300, y1=680, x2=500, y2=880),
                confidence=0.90,
                timestamp=1.0,
            ),
            Entity(
                id="box_b",
                entity_class=EntityClass.BOX,
                bbox=BoundingBox(x1=320, y1=660, x2=520, y2=860),
                confidence=0.90,
                timestamp=1.0,
            ),
        ],
    )
    snapshot = WorldModel().build_snapshot(frame.entities, frame_width=1000, frame_height=1000, timestamp=1.0)
    support_edges = [e for e in snapshot.edges if e.edge_type == SceneGraphEdgeType.SUPPORT]

    # Ground plane alignment should reject false support edge between these two floor boxes
    assert len(support_edges) == 0


def test_cantilever_overhang_metrics_accuracy():
    """Validates exact calculation of overhang ratio and cantilever dimensions."""
    # Supporter (e.g. pallet): x1=0.20, x2=0.60 (width = 0.40)
    supporter = BoundingBox(x1=0.20, y1=0.70, x2=0.60, y2=0.80)
    # Supported (e.g. carton overhangs right edge by 0.10): x1=0.30, x2=0.70 (width = 0.40)
    supported = BoundingBox(x1=0.30, y1=0.50, x2=0.70, y2=0.70)

    metrics = cantilever_overhang_metrics(supporter, supported)
    assert pytest.approx(metrics["horizontal_overlap_ratio"], abs=1e-4) == 0.75
    assert pytest.approx(metrics["overhang_ratio"], abs=1e-4) == 0.25
    assert pytest.approx(metrics["right_overhang"], abs=1e-4) == 0.25
    assert pytest.approx(metrics["max_cantilever"], abs=1e-4) == 0.25
    assert pytest.approx(metrics["left_overhang"], abs=1e-4) == 0.0


# ---------------------------------------------------------------------------
# 4. Multi-Frame Kinematics: Rapid Drop vs Gradual Lowering
# ---------------------------------------------------------------------------

def test_drop_detection_differentiates_rapid_drop_from_gradual_lowering():
    """Rapid downward descent with acceleration spike triggers vertical drop;
    slow gradual lowering does not trigger high-risk drop."""
    # Rapid drop: drops 0.20 in 0.3 seconds (speed = 0.67 norm/s)
    drop_samples = [
        TrackSample(0.0, (0.50, 0.30), 0.90, BoundingBox(x1=0.45, y1=0.25, x2=0.55, y2=0.35)),
        TrackSample(0.1, (0.50, 0.35), 0.90, BoundingBox(x1=0.45, y1=0.30, x2=0.55, y2=0.40)),
        TrackSample(0.2, (0.50, 0.45), 0.90, BoundingBox(x1=0.45, y1=0.40, x2=0.55, y2=0.50)),
        TrackSample(0.3, (0.50, 0.55), 0.90, BoundingBox(x1=0.45, y1=0.50, x2=0.55, y2=0.60)),
    ]
    drop_history = TrackHistory(entity_id="box1", entity_class=EntityClass.BOX, samples=drop_samples)
    person_history = TrackHistory(
        entity_id="p1",
        entity_class=EntityClass.PERSON,
        samples=[
            TrackSample(0.0, (0.48, 0.40), 0.90, BoundingBox(x1=0.40, y1=0.20, x2=0.56, y2=0.70)),
            TrackSample(0.3, (0.48, 0.40), 0.90, BoundingBox(x1=0.40, y1=0.20, x2=0.56, y2=0.70)),
        ],
    )
    kinematics_drop = compute_kinematics(drop_history)
    result_drop = recognize_throwing_or_dropping(
        drop_history, person_history, kinematics_drop, DEFAULT_RISK_CONFIG
    )
    assert result_drop is not None
    assert result_drop["subtype"] == "vertical_drop"
    assert result_drop["epistemic_level"] == EpistemicLevel.INFERRED

    # Gradual lowering: drops only 0.05 over 1.5 seconds (speed = 0.033 norm/s)
    slow_samples = [
        TrackSample(0.0, (0.50, 0.30), 0.90, BoundingBox(x1=0.45, y1=0.25, x2=0.55, y2=0.35)),
        TrackSample(0.5, (0.50, 0.31), 0.90, BoundingBox(x1=0.45, y1=0.26, x2=0.55, y2=0.36)),
        TrackSample(1.0, (0.50, 0.33), 0.90, BoundingBox(x1=0.45, y1=0.28, x2=0.55, y2=0.38)),
        TrackSample(1.5, (0.50, 0.35), 0.90, BoundingBox(x1=0.45, y1=0.30, x2=0.55, y2=0.40)),
    ]
    slow_history = TrackHistory(entity_id="box2", entity_class=EntityClass.BOX, samples=slow_samples)
    kinematics_slow = compute_kinematics(slow_history)
    result_slow = recognize_throwing_or_dropping(
        slow_history, person_history, kinematics_slow, DEFAULT_RISK_CONFIG
    )
    assert result_slow is None


# ---------------------------------------------------------------------------
# 5. Ground-Sliding Dragging vs Elevated Carry
# ---------------------------------------------------------------------------

def test_ground_sliding_vs_elevated_carry():
    """Validates that floor sliding is confirmed when bottom y2 stays on ground tier
    with low vertical variance, and rejected when elevated."""
    # Ground sliding track: y2 stays strictly around 0.85 +- 0.01
    sliding_samples = [
        TrackSample(0.0, (0.20, 0.75), 0.90, BoundingBox(x1=0.15, y1=0.65, x2=0.25, y2=0.85)),
        TrackSample(0.3, (0.25, 0.75), 0.90, BoundingBox(x1=0.20, y1=0.65, x2=0.30, y2=0.85)),
        TrackSample(0.6, (0.30, 0.75), 0.90, BoundingBox(x1=0.25, y1=0.65, x2=0.35, y2=0.85)),
        TrackSample(0.9, (0.35, 0.75), 0.90, BoundingBox(x1=0.30, y1=0.65, x2=0.40, y2=0.85)),
    ]
    sliding_hist = TrackHistory(entity_id="box_slide", entity_class=EntityClass.BOX, samples=sliding_samples)
    assert is_ground_sliding(sliding_hist, min_ground_y2=0.50, max_y2_variance=0.035) is True

    # Elevated carry track: y2 starts at 0.40 (chest height) and shifts around
    carry_samples = [
        TrackSample(0.0, (0.20, 0.35), 0.90, BoundingBox(x1=0.15, y1=0.25, x2=0.25, y2=0.45)),
        TrackSample(0.3, (0.25, 0.33), 0.90, BoundingBox(x1=0.20, y1=0.23, x2=0.30, y2=0.43)),
        TrackSample(0.6, (0.30, 0.36), 0.90, BoundingBox(x1=0.25, y1=0.26, x2=0.35, y2=0.46)),
    ]
    carry_hist = TrackHistory(entity_id="box_carry", entity_class=EntityClass.BOX, samples=carry_samples)
    assert is_ground_sliding(carry_hist, min_ground_y2=0.50, max_y2_variance=0.035) is False


# ---------------------------------------------------------------------------
# 6. Rolling Aspect Ratio Alternation vs Stationary Noise
# ---------------------------------------------------------------------------

def test_rolling_requires_translation_and_multi_frame_aspect_alternation():
    """Rolling requires actual translation + cyclic aspect ratio changes over multiple frames,
    rejecting stationary jitter."""
    # Stationary jitter: box oscillates aspect ratio slightly without translating
    stat_samples = [
        TrackSample(0.0, (0.50, 0.50), 0.90, BoundingBox(x1=0.45, y1=0.45, x2=0.55, y2=0.55)),
        TrackSample(0.1, (0.50, 0.50), 0.90, BoundingBox(x1=0.44, y1=0.45, x2=0.56, y2=0.55)),
        TrackSample(0.2, (0.50, 0.50), 0.90, BoundingBox(x1=0.45, y1=0.45, x2=0.55, y2=0.55)),
    ]
    stat_hist = TrackHistory(entity_id="stat_box", entity_class=EntityClass.BOX, samples=stat_samples)
    person_hist = TrackHistory(
        entity_id="p1",
        entity_class=EntityClass.PERSON,
        samples=[
            TrackSample(0.0, (0.45, 0.50), 0.90, BoundingBox(x1=0.40, y1=0.30, x2=0.50, y2=0.70)),
            TrackSample(0.2, (0.45, 0.50), 0.90, BoundingBox(x1=0.40, y1=0.30, x2=0.50, y2=0.70)),
        ],
    )
    stat_kin = compute_kinematics(stat_hist)
    assert recognize_rolling(stat_hist, person_hist, stat_kin, shared_samples=2) is None

    # Rolling: translates dx = 0.15 while aspect ratio alternates between wide and tall
    roll_samples = [
        TrackSample(0.0, (0.30, 0.70), 0.90, BoundingBox(x1=0.20, y1=0.65, x2=0.40, y2=0.75)),  # w=0.20, h=0.10, ar=2.0
        TrackSample(0.3, (0.38, 0.70), 0.90, BoundingBox(x1=0.33, y1=0.60, x2=0.43, y2=0.80)),  # w=0.10, h=0.20, ar=0.5
        TrackSample(0.6, (0.45, 0.70), 0.90, BoundingBox(x1=0.35, y1=0.65, x2=0.55, y2=0.75)),  # w=0.20, h=0.10, ar=2.0
    ]
    roll_hist = TrackHistory(entity_id="roll_box", entity_class=EntityClass.BOX, samples=roll_samples)
    roll_kin = compute_kinematics(roll_hist)
    roll_res = recognize_rolling(roll_hist, person_hist, roll_kin, shared_samples=3)
    assert roll_res is not None
    assert roll_res["scenario"] == "rolling_precursor"
    assert roll_res["epistemic_level"] == EpistemicLevel.INFERRED


# ---------------------------------------------------------------------------
# 7. Team Lift vs Solo Heavy Handling
# ---------------------------------------------------------------------------

def test_collaborative_team_lift_suppresses_solo_heavy_handling():
    """When two workers are in sustained proximity to a heavy item during displacement,
    collaborative team lift is compliant and solo_heavy_handling is NOT triggered."""
    heavy_meta = {
        "SKU-HEAVY": ProductMetadata(
            product_id="SKU-HEAVY",
            class_name="heavy_engine_part",
            mass_class=MassClass.HEAVY,
            fragility="low",
        )
    }
    # Box moving horizontally
    box_samples = [
        TrackSample(0.0, (0.30, 0.70), 0.90, BoundingBox(x1=0.25, y1=0.60, x2=0.35, y2=0.80)),
        TrackSample(0.3, (0.35, 0.70), 0.90, BoundingBox(x1=0.30, y1=0.60, x2=0.40, y2=0.80)),
        TrackSample(0.6, (0.40, 0.70), 0.90, BoundingBox(x1=0.35, y1=0.60, x2=0.45, y2=0.80)),
    ]
    box_hist = TrackHistory(entity_id="b1", entity_class=EntityClass.BOX, samples=box_samples)
    kinematics = compute_kinematics(box_hist)

    # Worker 1 (on left)
    w1_samples = [
        TrackSample(0.0, (0.22, 0.70), 0.90, BoundingBox(x1=0.17, y1=0.40, x2=0.27, y2=0.90)),
        TrackSample(0.6, (0.32, 0.70), 0.90, BoundingBox(x1=0.27, y1=0.40, x2=0.37, y2=0.90)),
    ]
    w1 = TrackHistory(entity_id="w1", entity_class=EntityClass.PERSON, samples=w1_samples)

    # Worker 2 (on right)
    w2_samples = [
        TrackSample(0.0, (0.38, 0.70), 0.90, BoundingBox(x1=0.33, y1=0.40, x2=0.43, y2=0.90)),
        TrackSample(0.6, (0.48, 0.70), 0.90, BoundingBox(x1=0.43, y1=0.40, x2=0.53, y2=0.90)),
    ]
    w2 = TrackHistory(entity_id="w2", entity_class=EntityClass.PERSON, samples=w2_samples)

    # Case A: Both workers assisting -> team lift, solo handling suppressed
    team_result = recognize_solo_heavy_handling(
        box_hist, [w1, w2], heavy_meta, "SKU-HEAVY", kinematics, DEFAULT_RISK_CONFIG
    )
    assert team_result is None

    # Case B: Only one worker assisting -> violation flagged
    solo_result = recognize_solo_heavy_handling(
        box_hist, [w1], heavy_meta, "SKU-HEAVY", kinematics, DEFAULT_RISK_CONFIG
    )
    assert solo_result is not None
    assert solo_result["scenario"] == "solo_heavy_handling"
    assert solo_result["epistemic_level"] == EpistemicLevel.INFERRED


# ---------------------------------------------------------------------------
# 8. Epistemic Classification & Status Ceilings
# ---------------------------------------------------------------------------

def test_epistemic_level_and_status_ceilings():
    """Validates epistemic honesty:
    - Findings clearly distinguish OBSERVED vs INFERRED
    - A confident detection on weak sample count cannot upgrade status to SUPPORTED
    """
    # 1. Evidence quality score on single sample:
    score_single = evidence_quality(
        mean_detection_confidence=0.99,
        entity_classes=[EntityClass.PERSON, EntityClass.BOX],
        sample_count=1,
        min_expected_samples=5,
    )
    status_single, conf_single = status_and_confidence(score_single, DEFAULT_RISK_CONFIG)
    # Even with 0.99 detector confidence, 1 sample must NOT be SUPPORTED
    assert status_single != FindingStatus.SUPPORTED
    assert status_single in (FindingStatus.PROBABLE, FindingStatus.INSUFFICIENT_EVIDENCE)

    # 2. Structural lens epistemic assignments:
    # Direct 2D alignment without metadata -> OBSERVED support hypothesis
    frame = PerceptionFrameResult(
        source_id="cam1",
        timestamp=0.0,
        entities=[
            Entity(
                id="box_base",
                entity_class=EntityClass.BOX,
                bbox=BoundingBox(x1=200, y1=500, x2=400, y2=700),
                confidence=0.95,
                timestamp=0.0,
            ),
            Entity(
                id="box_top",
                entity_class=EntityClass.BOX,
                bbox=BoundingBox(x1=200, y1=300, x2=400, y2=500),
                confidence=0.95,
                timestamp=0.0,
            ),
        ],
    )
    snapshot = WorldModel().build_snapshot(frame.entities, frame_width=1000, frame_height=1000, timestamp=0.0)
    conf_map = {"box_base": 0.95, "box_top": 0.95}

    findings = evaluate_structural(snapshot, entity_confidence=conf_map, config=DEFAULT_RISK_CONFIG)
    assert len(findings) == 1
    assert findings[0].epistemic_level == EpistemicLevel.OBSERVED
    assert findings[0].scenario == "image_space_support_hypothesis"

    # With heavy-on-light metadata -> INFERRED mechanical hazard
    meta = {
        "P_LIGHT": ProductMetadata(product_id="P_LIGHT", class_name="c1", mass_class=MassClass.LIGHT, fragility="low"),
        "P_HEAVY": ProductMetadata(product_id="P_HEAVY", class_name="c2", mass_class=MassClass.HEAVY, fragility="low"),
    }
    snapshot.nodes[0].product_id = "P_LIGHT"  # base
    snapshot.nodes[1].product_id = "P_HEAVY"  # top
    findings_meta = evaluate_structural(
        snapshot, entity_confidence=conf_map, config=DEFAULT_RISK_CONFIG, product_metadata_by_id=meta
    )
    assert len(findings_meta) == 1
    assert findings_meta[0].epistemic_level == EpistemicLevel.INFERRED
    assert findings_meta[0].scenario == "heavy_on_light_stacking"
