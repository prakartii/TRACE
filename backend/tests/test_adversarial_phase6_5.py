"""Adversarial and false-positive regression tests for Phase 6.5.

Validates that TRACE strictly adheres to:
    EVIDENCE > ASSUMPTION
and:
    FALSE POSITIVE > MISSED FINDING (when evidence is insufficient)

Covers:
1. Bounding-box jitter without actual movement (Brownian noise -> moving=False)
2. One-frame detection spike / velocity artifact (requires multi-sample coherence)
3. Tracker ID switch / fragmentation handled gracefully without speed explosions
4. Temporary object disappearance and reacquisition
5. Worker walking past stationary box (no dragging or displacement finding)
6. Worker walking opposite to moving box (no dragging finding)
7. Person standing on floor behind box (feet on floor -> no stepping precursor)
8. Genuine person elevated on carton (feet on carton top -> stepping precursor)
9. Perspective-distorted upright box within tolerance band (no orientation false positive)
10. Genuine toppled box exceeding tolerance (orientation finding triggers)
11. Heavy object present in manifest but not being handled (no solo heavy handling)
12. Light box handled alone while heavy SKU is in catalog (no solo heavy handling)
13. Ordinary controlled lifting motion without throwing (upward vector -> no throwing)
14. Uneven / variable frame-rate sampling robustness
"""

import pytest

from backend.contracts.models import (
    BoundingBox,
    ConfidenceLevel,
    Entity,
    EntityClass,
    FindingStatus,
    MassClass,
    PerceptionFrameResult,
    ProductMetadata,
    SceneGraphEdge,
    SceneGraphEdgeType,
    SceneGraphNode,
    SceneGraphSnapshot,
)
from backend.behaviour.lens import evaluate_behaviour
from backend.lenses.conformance import (
    STANDARD_CONFORMANCE_RULES,
    evaluate_conformance,
)
from backend.lenses.structural import evaluate_structural
from backend.risk.config import DEFAULT_RISK_CONFIG, RiskConfig
from backend.world_model.manifest import PRODUCT_CATALOG
from backend.world_model.scene_graph import WorldModel
from backend.world_model.temporal import (
    average_speed,
    build_track_histories,
    net_displacement,
    net_speed,
    total_displacement,
    trajectory_linearity,
)

FRAME_W = 1280
FRAME_H = 720


def make_entity(
    entity_id: str,
    x1: float,
    y1: float,
    x2: float,
    y2: float,
    entity_class: EntityClass = EntityClass.BOX,
    confidence: float = 0.9,
    timestamp: float = 0.0,
) -> Entity:
    return Entity(
        id=entity_id,
        track_id=entity_id,
        entity_class=entity_class,
        bbox=BoundingBox(x1=x1, y1=y1, x2=x2, y2=y2),
        confidence=confidence,
        timestamp=timestamp,
    )


def make_frame_result(timestamp: float, entities: list[Entity]) -> PerceptionFrameResult:
    return PerceptionFrameResult(
        source_id="adv_source",
        timestamp=timestamp,
        entities=entities,
    )


# ---------------------------------------------------------------------------
# 1. Bbox Jitter Without Movement
# ---------------------------------------------------------------------------

def test_adversarial_bbox_jitter_without_actual_movement():
    """A stationary box jiggles back and forth by +/- 6px over 8 frames.
    Total displacement accumulates > 0.08, but net displacement is tiny (< 0.025).
    TRACE must NOT classify this stationary box as moving or claim handling."""
    frames = []
    jitter_offsets = [0, 6, -5, 7, -6, 5, -4, 2]
    for i, offset in enumerate(jitter_offsets):
        t = float(i) * 0.3
        p = make_entity("vid:p1", 200, 350, 320, 600, EntityClass.PERSON, timestamp=t)
        b = make_entity("vid:b1", 400 + offset, 400 + offset, 550 + offset, 550 + offset, EntityClass.BOX, timestamp=t)
        frames.append(make_frame_result(t, [p, b]))

    histories = build_track_histories(frames, FRAME_W, FRAME_H)
    box_hist = histories["vid:b1"]
    tot_disp = total_displacement(box_hist)
    net_disp = net_displacement(box_hist)
    lin = trajectory_linearity(box_hist)

    assert tot_disp > 0.05, "Jitter should accumulate cumulative displacement"
    assert net_disp < 0.025, "Stationary box net displacement must remain small"
    assert lin < 0.35, "Jitter path linearity must be low"

    findings = evaluate_behaviour(
        frames,
        frame_width=FRAME_W,
        frame_height=FRAME_H,
        timestamp=2.1,
        config=RiskConfig(behaviour_min_common_samples=4),
    )
    for f in findings:
        assert f.scenario != "box_displacement_near_person"
        assert f.scenario != "dragging_precursor"
        assert f.scenario != "dropping_or_throwing_precursor"


# ---------------------------------------------------------------------------
# 2. One-Frame Detection Spike
# ---------------------------------------------------------------------------

def test_adversarial_one_frame_detection_spike_rejected():
    """A single-frame detector glitch shifts box position drastically for 1 frame.
    Velocity gate requires multi-sample coherence (min 3 samples); a single
    spike must NOT produce a throwing or dropping finding."""
    frames = []
    frames.append(make_frame_result(0.0, [
        make_entity("vid:p1", 100, 100, 200, 300, EntityClass.PERSON, timestamp=0.0),
        make_entity("vid:b1", 250, 200, 350, 300, EntityClass.BOX, timestamp=0.0),
    ]))
    frames.append(make_frame_result(0.1, [
        make_entity("vid:p1", 100, 100, 200, 300, EntityClass.PERSON, timestamp=0.1),
        make_entity("vid:b1", 250, 500, 350, 600, EntityClass.BOX, timestamp=0.1),
    ]))

    findings = evaluate_behaviour(
        frames,
        frame_width=FRAME_W,
        frame_height=FRAME_H,
        timestamp=0.1,
        config=RiskConfig(behaviour_min_common_samples=2),
    )
    for f in findings:
        assert f.scenario != "dropping_or_throwing_precursor"


# ---------------------------------------------------------------------------
# 3. Tracker ID Switch / Fragmentation
# ---------------------------------------------------------------------------

def test_adversarial_tracker_id_switch_handled_cleanly():
    """Tracker drops b1 and creates b2 at t=0.6s.
    Neither fragmented track has sufficient temporal history to falsely claim throwing."""
    frames = []
    for i in range(2):
        t = float(i) * 0.3
        p = make_entity("vid:p1", 100, 100, 200, 300, EntityClass.PERSON, timestamp=t)
        b = make_entity("vid:b1", 250, 200, 350, 300, EntityClass.BOX, timestamp=t)
        frames.append(make_frame_result(t, [p, b]))

    for i in range(2, 4):
        t = float(i) * 0.3
        p = make_entity("vid:p1", 100, 100, 200, 300, EntityClass.PERSON, timestamp=t)
        b = make_entity("vid:b2", 280, 250, 380, 350, EntityClass.BOX, timestamp=t)
        frames.append(make_frame_result(t, [p, b]))

    findings = evaluate_behaviour(
        frames,
        frame_width=FRAME_W,
        frame_height=FRAME_H,
        timestamp=0.9,
    )
    for f in findings:
        assert f.scenario != "dropping_or_throwing_precursor"


# ---------------------------------------------------------------------------
# 4. Temporary Object Disappearance
# ---------------------------------------------------------------------------

def test_adversarial_temporary_object_disappearance():
    """Box is visible at t=0, missing at t=0.3, visible again at t=0.6 and t=0.9."""
    frames = [
        make_frame_result(0.0, [make_entity("vid:b1", 200, 200, 300, 300, timestamp=0.0)]),
        make_frame_result(0.3, []),
        make_frame_result(0.6, [make_entity("vid:b1", 205, 202, 305, 302, timestamp=0.6)]),
        make_frame_result(0.9, [make_entity("vid:b1", 208, 205, 308, 305, timestamp=0.9)]),
    ]
    histories = build_track_histories(frames, FRAME_W, FRAME_H)
    assert "vid:b1" in histories
    assert len(histories["vid:b1"].samples) == 3
    spd = average_speed(histories["vid:b1"])
    assert spd is not None
    assert spd >= 0.0


# ---------------------------------------------------------------------------
# 5. Worker Walking Past Stationary Box (Not Dragging)
# ---------------------------------------------------------------------------

def test_adversarial_worker_walking_past_stationary_box():
    """Worker walks past a stationary box at ground level.
    The box never translates; worker motion alone must NEVER trigger dragging."""
    frames = []
    for i in range(6):
        t = float(i) * 0.3
        p = make_entity("vid:p1", 100 + i * 80, 450, 200 + i * 80, 680, EntityClass.PERSON, timestamp=t)
        b = make_entity("vid:b1", 300, 520, 420, 640, EntityClass.BOX, timestamp=t)
        frames.append(make_frame_result(t, [p, b]))

    findings = evaluate_behaviour(
        frames,
        frame_width=FRAME_W,
        frame_height=FRAME_H,
        timestamp=1.5,
        config=RiskConfig(behaviour_min_common_samples=4),
    )
    for f in findings:
        assert f.scenario != "dragging_precursor"
        assert f.scenario != "box_displacement_near_person"


# ---------------------------------------------------------------------------
# 6. Worker Walking Opposite to Moving Box (Not Dragging)
# ---------------------------------------------------------------------------

def test_adversarial_worker_walking_opposite_to_moving_box():
    """Worker walks left while a box moves right (e.g. on a mechanical conveyor).
    Since motions are in opposite directions, this worker is NOT dragging the box."""
    frames = []
    for i in range(6):
        t = float(i) * 0.3
        p = make_entity("vid:p1", 500 - i * 30, 450, 600 - i * 30, 680, EntityClass.PERSON, timestamp=t)
        b = make_entity("vid:b1", 200 + i * 40, 520, 320 + i * 40, 640, EntityClass.BOX, timestamp=t)
        frames.append(make_frame_result(t, [p, b]))

    findings = evaluate_behaviour(
        frames,
        frame_width=FRAME_W,
        frame_height=FRAME_H,
        timestamp=1.5,
        config=RiskConfig(behaviour_min_common_samples=4),
    )
    for f in findings:
        assert f.scenario != "dragging_precursor"


# ---------------------------------------------------------------------------
# 7. Person Standing on Floor Behind Box (Not Stepping On It)
# ---------------------------------------------------------------------------

def test_adversarial_person_standing_on_floor_behind_box():
    """Worker stands on the floor behind a carton in elevated camera view.
    Worker feet (y2=650) touch ground, well below carton top (y1=450).
    TRACE must NOT report this as stepping on cartons."""
    frames = []
    for i in range(6):
        t = float(i) * 0.3
        p = make_entity("vid:p1", 400, 200, 500, 650, EntityClass.PERSON, timestamp=t)
        b = make_entity("vid:b1", 410, 450, 510, 650, EntityClass.BOX, timestamp=t)
        frames.append(make_frame_result(t, [p, b]))

    findings = evaluate_behaviour(
        frames,
        frame_width=FRAME_W,
        frame_height=FRAME_H,
        timestamp=1.5,
        config=RiskConfig(behaviour_proximity_threshold=0.25, behaviour_min_common_samples=4),
    )
    for f in findings:
        assert f.scenario != "stepping_on_carton_precursor"


# ---------------------------------------------------------------------------
# 8. Genuine Person Elevated On Carton (Stepping Precursor Detected)
# ---------------------------------------------------------------------------

def test_adversarial_genuine_person_elevated_on_carton():
    """Worker feet rest directly atop carton top tier (person y2 ~ box y1).
    Worker upper body is elevated above carton. Correctly triggers stepping precursor."""
    frames = []
    for i in range(6):
        t = float(i) * 0.3
        p = make_entity("vid:p1", 400, 250, 500, 440, EntityClass.PERSON, timestamp=t)
        b = make_entity("vid:b1", 410, 430, 510, 550, EntityClass.BOX, timestamp=t)
        frames.append(make_frame_result(t, [p, b]))

    findings = evaluate_behaviour(
        frames,
        frame_width=FRAME_W,
        frame_height=FRAME_H,
        timestamp=1.5,
        config=RiskConfig(behaviour_proximity_threshold=0.25, behaviour_min_common_samples=4),
    )
    assert any(f.scenario == "stepping_on_carton_precursor" for f in findings)


# ---------------------------------------------------------------------------
# 9. Perspective-Distorted Box Within Tolerance Band (No False Violation)
# ---------------------------------------------------------------------------

def test_adversarial_perspective_distorted_box_within_tolerance():
    """An upright box viewed from an elevated 40-degree overhead angle
    projects with 2D aspect ratio 1.30 (width slightly greater than height
    due to top facet projection). Within tolerance band (<= 1.35) -> NO violation."""
    e = make_entity("vid:b1", 100, 100, 360, 300, EntityClass.BOX)
    snapshot = WorldModel().build_snapshot(
        [e],
        frame_width=FRAME_W,
        frame_height=FRAME_H,
        timestamp=0.0,
        default_product_id="auradine_cupboard",
        compute_aspect_orientation=True,
    )
    metadata = {"auradine_cupboard": PRODUCT_CATALOG["auradine_cupboard"]}
    findings = evaluate_conformance(
        snapshot.nodes,
        product_metadata_by_id=metadata,
        timestamp=0.0,
        rules=STANDARD_CONFORMANCE_RULES,
    )
    assert findings == [], "Aspect ratio 1.30 is within perspective tolerance; must not trigger violation"


# ---------------------------------------------------------------------------
# 10. Genuine Toppled Box Exceeding Tolerance (Violation Detected)
# ---------------------------------------------------------------------------

def test_adversarial_genuine_toppled_box_detected():
    """A box that specifies upright vertical orientation is lying on its side
    with aspect ratio 2.20. Well exceeds tolerance (> 1.35) -> triggers finding."""
    e = make_entity("vid:b1", 100, 100, 540, 300, EntityClass.BOX)
    snapshot = WorldModel().build_snapshot(
        [e],
        frame_width=FRAME_W,
        frame_height=FRAME_H,
        timestamp=0.0,
        default_product_id="auradine_cupboard",
        compute_aspect_orientation=True,
    )
    metadata = {"auradine_cupboard": PRODUCT_CATALOG["auradine_cupboard"]}
    findings = evaluate_conformance(
        snapshot.nodes,
        product_metadata_by_id=metadata,
        timestamp=0.0,
        rules=STANDARD_CONFORMANCE_RULES,
    )
    assert len(findings) == 1
    assert findings[0].scenario == "wrong_product_orientation"
    assert findings[0].status == FindingStatus.PROBABLE


# ---------------------------------------------------------------------------
# 11. Heavy Object in Catalog But Not Being Handled (No Solo Heavy Alert)
# ---------------------------------------------------------------------------

def test_adversarial_heavy_object_present_but_not_handled():
    """Manifest has heavy overpack box. Heavy box is stationary on the dock.
    A lone worker walks around 1 meter away. Since the box is not moving,
    TRACE must NOT alert on solo heavy handling."""
    frames = []
    for i in range(6):
        t = float(i) * 0.3
        p = make_entity("vid:p1", 100 + i * 20, 100, 200 + i * 20, 300, EntityClass.PERSON, timestamp=t)
        b = make_entity("vid:b1", 350, 100, 450, 200, EntityClass.BOX, timestamp=t)
        frames.append(make_frame_result(t, [p, b]))

    metadata = {"heavy_box": PRODUCT_CATALOG["heavy_overpack_box"]}
    findings = evaluate_behaviour(
        frames,
        frame_width=FRAME_W,
        frame_height=FRAME_H,
        timestamp=1.5,
        config=RiskConfig(behaviour_min_common_samples=4),
        product_metadata_by_id=metadata,
        default_product_id="heavy_box",
    )
    for f in findings:
        assert f.scenario != "solo_heavy_handling"


# ---------------------------------------------------------------------------
# 12. Light Box Handled Alone While Heavy SKU Exists in Manifest
# ---------------------------------------------------------------------------

def test_adversarial_light_box_handled_alone_no_heavy_alert():
    """Manifest has both light packets and heavy overpack box.
    Worker handles a LIGHT packet alone. TRACE must NOT mistakenly match
    the heavy SKU to the light packet."""
    frames = []
    for i in range(6):
        t = float(i) * 0.3
        p = make_entity("vid:p1", 100, 100, 200, 300, EntityClass.PERSON, timestamp=t)
        b = make_entity("vid:b1", 150 + i * 30, 100, 250 + i * 30, 200, EntityClass.BOX, timestamp=t)
        frames.append(make_frame_result(t, [p, b]))

    metadata = {
        "kd_flatpack_packets": PRODUCT_CATALOG["kd_flatpack_packets"],
        "heavy_overpack_box": PRODUCT_CATALOG["heavy_overpack_box"],
    }
    findings = evaluate_behaviour(
        frames,
        frame_width=FRAME_W,
        frame_height=FRAME_H,
        timestamp=1.5,
        config=RiskConfig(behaviour_min_common_samples=4),
        product_metadata_by_id=metadata,
        default_product_id="kd_flatpack_packets",
    )
    for f in findings:
        assert f.scenario != "solo_heavy_handling", "Must not attribute heavy handling to light packet"


# ---------------------------------------------------------------------------
# 13. Ordinary Controlled Lifting Motion (Not Dropping or Throwing)
# ---------------------------------------------------------------------------

def test_adversarial_ordinary_lifting_without_throwing():
    """Worker lifts a box upwards from floor level (y goes from 500 to 350, dy_net < 0).
    Upward vertical displacement must NEVER trigger dropping."""
    frames = []
    for i in range(6):
        t = float(i) * 0.3
        p = make_entity("vid:p1", 100, 300, 200, 600, EntityClass.PERSON, timestamp=t)
        b_y = 500 - i * 30
        b = make_entity("vid:b1", 150, b_y, 250, b_y + 100, EntityClass.BOX, timestamp=t)
        frames.append(make_frame_result(t, [p, b]))

    findings = evaluate_behaviour(
        frames,
        frame_width=FRAME_W,
        frame_height=FRAME_H,
        timestamp=1.5,
        config=RiskConfig(behaviour_min_common_samples=4),
    )
    for f in findings:
        assert f.scenario != "dropping_or_throwing_precursor"


# ---------------------------------------------------------------------------
# 14. Uneven / Variable Frame-Rate Sampling Robustness
# ---------------------------------------------------------------------------

def test_adversarial_variable_frame_rate_sampling():
    """Frames sampled at non-uniform intervals (t=0.0, 0.15, 0.55, 0.60, 1.10).
    Pipeline must cleanly compute speeds without division by zero or crashing."""
    timestamps = [0.0, 0.15, 0.55, 0.60, 1.10]
    frames = []
    for i, t in enumerate(timestamps):
        p = make_entity("vid:p1", 100, 100, 200, 300, EntityClass.PERSON, timestamp=t)
        b = make_entity("vid:b1", 150 + i * 20, 100, 250 + i * 20, 200, EntityClass.BOX, timestamp=t)
        frames.append(make_frame_result(t, [p, b]))

    findings = evaluate_behaviour(
        frames,
        frame_width=FRAME_W,
        frame_height=FRAME_H,
        timestamp=1.10,
        config=RiskConfig(behaviour_min_common_samples=3),
    )
    assert isinstance(findings, list)
    assert len(findings) >= 1
