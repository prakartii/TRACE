"""Phase 12 — Behaviour Recognition Test Suite.

ARCHITECTURE.md Part 3, Part 9, Part 11, and CLAUDE.md §7 & §14.

Tests:
  - Kinematic profile computation (velocity, downward velocity, acceleration, aspect-ratio oscillation)
  - Scenario 2: Throwing / Dropping (vertical descent, projectile velocity, jitter refusal, upward refusal)
  - Scenario 3: Dragging (ground translation, opposite direction refusal, elevated refusal, equipment suppression)
  - Scenario 4: Rolling (aspect ratio oscillation signature, constant aspect refusal)
  - Scenario 5: Straps as Handles (upper perimeter grip hypothesis, observed-only status, epistemic limitations)
  - Scenario 6: Stepping on Cartons (elevated alignment, ground standing refusal)
  - Scenario 12: Solo Heavy Handling (single worker, team lift suppression)
  - REST API routes (catalog list, scenario detail, evaluate video, evaluate request)
  - Epistemic safety & limitations validation
"""

import pytest
from fastapi.testclient import TestClient

from backend.behaviour.recognizer import (
    BEHAVIOUR_SCENARIOS_CATALOG,
    compute_kinematics,
    recognize_all_behaviours,
    recognize_dragging,
    recognize_rolling,
    recognize_solo_heavy_handling,
    recognize_stepping_on_carton,
    recognize_straps_as_handles,
    recognize_throwing_or_dropping,
)
from backend.contracts.models import (
    BoundingBox,
    ConfidenceLevel,
    Entity,
    EntityClass,
    FindingStatus,
    Fragility,
    MassClass,
    PerceptionFrameResult,
    ProductMetadata,
    RiskBand,
)
from backend.main import app
from backend.risk.config import DEFAULT_RISK_CONFIG, RiskConfig
from backend.world_model.temporal import TrackHistory, TrackSample, build_track_histories

FRAME_W = 1280
FRAME_H = 720


def make_entity(
    entity_id: str,
    x1: float,
    y1: float,
    x2: float,
    y2: float,
    entity_class: EntityClass = EntityClass.BOX,
    confidence: float = 0.90,
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


def make_frame(timestamp: float, entities: list[Entity], source_id: str = "test_vid") -> PerceptionFrameResult:
    return PerceptionFrameResult(
        source_id=source_id,
        timestamp=timestamp,
        entities=entities,
    )


# ---------------------------------------------------------------------------
# 1. Kinematic Profile Computation Tests
# ---------------------------------------------------------------------------

def test_compute_kinematics_stationary():
    """Stationary track produces zero displacement, zero speeds, and zero acceleration."""
    samples = [
        TrackSample(timestamp=float(i) * 0.1, position=(0.5, 0.5), confidence=0.9)
        for i in range(5)
    ]
    history = TrackHistory(entity_id="box_1", entity_class=EntityClass.BOX, samples=samples)
    profile = compute_kinematics(history)

    assert profile.sample_count == 5
    assert profile.total_displacement == 0.0
    assert profile.net_displacement == 0.0
    assert profile.trajectory_linearity == 0.0
    assert profile.peak_speed == 0.0
    assert profile.peak_downward_speed == 0.0


def test_compute_kinematics_vertical_drop():
    """Rapid downward movement records positive downward speeds and high linearity."""
    samples = [
        TrackSample(timestamp=float(i) * 0.1, position=(0.5, 0.2 + i * 0.1), confidence=0.9)
        for i in range(5)
    ]
    history = TrackHistory(entity_id="box_drop", entity_class=EntityClass.BOX, samples=samples)
    profile = compute_kinematics(history)

    assert profile.total_displacement == pytest.approx(0.4, abs=0.01)
    assert profile.net_displacement == pytest.approx(0.4, abs=0.01)
    assert profile.trajectory_linearity == pytest.approx(1.0, abs=0.01)
    assert profile.peak_downward_speed is not None
    assert profile.peak_downward_speed > 0.5


def test_compute_kinematics_aspect_ratio_oscillation():
    """Bounding box alternating width/height records aspect ratio range and oscillation count."""
    samples = [
        TrackSample(
            timestamp=0.0,
            position=(0.2, 0.6),
            confidence=0.9,
            footprint=BoundingBox(x1=0.1, y1=0.55, x2=0.3, y2=0.65),  # w=0.2, h=0.1 -> AR=2.0
        ),
        TrackSample(
            timestamp=0.1,
            position=(0.3, 0.6),
            confidence=0.9,
            footprint=BoundingBox(x1=0.25, y1=0.5, x2=0.35, y2=0.7),  # w=0.1, h=0.2 -> AR=0.5
        ),
        TrackSample(
            timestamp=0.2,
            position=(0.4, 0.6),
            confidence=0.9,
            footprint=BoundingBox(x1=0.3, y1=0.55, x2=0.5, y2=0.65),  # w=0.2, h=0.1 -> AR=2.0
        ),
    ]
    history = TrackHistory(entity_id="box_roll", entity_class=EntityClass.BOX, samples=samples)
    profile = compute_kinematics(history)

    assert profile.aspect_ratio_min == pytest.approx(0.5, abs=0.05)
    assert profile.aspect_ratio_max == pytest.approx(2.0, abs=0.05)
    assert profile.aspect_ratio_range is not None and profile.aspect_ratio_range >= 1.0
    assert profile.aspect_oscillation_count >= 1
    assert profile.ground_tier is True


# ---------------------------------------------------------------------------
# 2. Scenario 2: Throwing / Dropping Tests
# ---------------------------------------------------------------------------

def test_throwing_or_dropping_vertical_drop():
    """Downwards velocity spike over >=3 samples triggers dropping_or_throwing_precursor."""
    frames = [
        make_frame(
            float(i) * 0.2,
            [
                make_entity("p1", 400, 200, 500, 600, EntityClass.PERSON, timestamp=float(i) * 0.2),
                make_entity("b1", 420, 200 + i * 80, 480, 260 + i * 80, EntityClass.BOX, timestamp=float(i) * 0.2),
            ],
        )
        for i in range(4)
    ]
    findings, _ = recognize_all_behaviours(
        frames, frame_width=FRAME_W, frame_height=FRAME_H, timestamp=0.6
    )
    drop = next((f for f in findings if f.scenario == "dropping_or_throwing_precursor"), None)
    assert drop is not None
    assert drop.status == FindingStatus.PROBABLE
    assert drop.band == RiskBand.HIGH
    assert "downward" in drop.explanation.lower()
    assert "2d image-space velocity" in drop.limitations[0].lower()


def test_throwing_or_dropping_projectile_throw():
    """Rapid horizontal translation spike triggers projectile throwing precursor."""
    frames = [
        make_frame(
            float(i) * 0.1,
            [
                make_entity("p1", 200, 300, 300, 600, EntityClass.PERSON, timestamp=float(i) * 0.1),
                make_entity("b1", 320 + i * 150, 350, 400 + i * 150, 430, EntityClass.BOX, timestamp=float(i) * 0.1),
            ],
        )
        for i in range(4)
    ]
    findings, _ = recognize_all_behaviours(
        frames, frame_width=FRAME_W, frame_height=FRAME_H, timestamp=0.3
    )
    throw = next((f for f in findings if f.scenario == "dropping_or_throwing_precursor"), None)
    assert throw is not None
    assert "projectile" in throw.explanation.lower() or "throwing" in throw.explanation.lower()


def test_throwing_or_dropping_refuses_insufficient_samples():
    """Only 2 samples is insufficient evidence for velocity spike, avoiding jitter false alarms."""
    frames = [
        make_frame(
            float(i) * 0.1,
            [
                make_entity("p1", 400, 200, 500, 600, EntityClass.PERSON, timestamp=float(i) * 0.1),
                make_entity("b1", 420, 200 + i * 120, 480, 260 + i * 120, EntityClass.BOX, timestamp=float(i) * 0.1),
            ],
        )
        for i in range(2)  # only 2 samples
    ]
    findings, _ = recognize_all_behaviours(
        frames, frame_width=FRAME_W, frame_height=FRAME_H, timestamp=0.1
    )
    assert all(f.scenario != "dropping_or_throwing_precursor" for f in findings)


def test_throwing_or_dropping_refuses_upward_translation():
    """Upward movement (lifting cargo up) is never classified as a drop."""
    frames = [
        make_frame(
            float(i) * 0.2,
            [
                make_entity("p1", 400, 200, 500, 600, EntityClass.PERSON, timestamp=float(i) * 0.2),
                # Box moving UPWARD from y=500 to y=260
                make_entity("b1", 420, 500 - i * 80, 480, 560 - i * 80, EntityClass.BOX, timestamp=float(i) * 0.2),
            ],
        )
        for i in range(4)
    ]
    findings, _ = recognize_all_behaviours(
        frames, frame_width=FRAME_W, frame_height=FRAME_H, timestamp=0.6
    )
    assert all(f.scenario != "dropping_or_throwing_precursor" for f in findings)


# ---------------------------------------------------------------------------
# 3. Scenario 3: Dragging Tests
# ---------------------------------------------------------------------------

def test_dragging_ground_translation():
    """Box sliding horizontally across ground tier near worker triggers dragging_precursor."""
    frames = [
        make_frame(
            float(i) * 0.3,
            [
                make_entity("p1", 200 + i * 40, 380, 300 + i * 40, 680, EntityClass.PERSON, timestamp=float(i) * 0.3),
                make_entity("b1", 280 + i * 40, 520, 380 + i * 40, 650, EntityClass.BOX, timestamp=float(i) * 0.3),
            ],
        )
        for i in range(5)
    ]
    findings, _ = recognize_all_behaviours(
        frames, frame_width=FRAME_W, frame_height=FRAME_H, timestamp=1.2
    )
    drag = next((f for f in findings if f.scenario == "dragging_precursor"), None)
    assert drag is not None
    assert drag.status == FindingStatus.PROBABLE
    assert "ground-level" in drag.explanation.lower()


def test_dragging_refuses_opposite_direction():
    """Worker walking left while box translates right is NOT dragging."""
    frames = [
        make_frame(
            float(i) * 0.3,
            [
                make_entity("p1", 500 - i * 40, 380, 600 - i * 40, 680, EntityClass.PERSON, timestamp=float(i) * 0.3),
                make_entity("b1", 280 + i * 40, 520, 380 + i * 40, 650, EntityClass.BOX, timestamp=float(i) * 0.3),
            ],
        )
        for i in range(5)
    ]
    findings, _ = recognize_all_behaviours(
        frames, frame_width=FRAME_W, frame_height=FRAME_H, timestamp=1.2
    )
    assert all(f.scenario != "dragging_precursor" for f in findings)


def test_dragging_refuses_elevated_box():
    """Box carried at chest height (y < 0.50 of frame) is NOT dragging."""
    frames = [
        make_frame(
            float(i) * 0.3,
            [
                make_entity("p1", 200 + i * 40, 150, 300 + i * 40, 550, EntityClass.PERSON, timestamp=float(i) * 0.3),
                make_entity("b1", 280 + i * 40, 200, 380 + i * 40, 300, EntityClass.BOX, timestamp=float(i) * 0.3),
            ],
        )
        for i in range(5)
    ]
    findings, _ = recognize_all_behaviours(
        frames, frame_width=FRAME_W, frame_height=FRAME_H, timestamp=1.2
    )
    assert all(f.scenario != "dragging_precursor" for f in findings)


def test_dragging_suppressed_by_trolley_equipment():
    """When box moves along with a trolley entity, dragging is suppressed (equipment transport)."""
    frames = [
        make_frame(
            float(i) * 0.3,
            [
                make_entity("p1", 200 + i * 40, 380, 300 + i * 40, 680, EntityClass.PERSON, timestamp=float(i) * 0.3),
                make_entity("b1", 280 + i * 40, 520, 380 + i * 40, 650, EntityClass.BOX, timestamp=float(i) * 0.3),
                make_entity("t1", 270 + i * 40, 500, 390 + i * 40, 660, EntityClass.TROLLEY, timestamp=float(i) * 0.3),
            ],
        )
        for i in range(5)
    ]
    findings, _ = recognize_all_behaviours(
        frames, frame_width=FRAME_W, frame_height=FRAME_H, timestamp=1.2
    )
    assert all(f.scenario != "dragging_precursor" for f in findings)


# ---------------------------------------------------------------------------
# 4. Scenario 4: Rolling Tests
# ---------------------------------------------------------------------------

def test_rolling_aspect_ratio_oscillation():
    """Horizontal translation accompanied by aspect-ratio oscillation triggers rolling_precursor."""
    frames = []
    # Box alternates between wide (w=120, h=60 -> AR=2.0) and tall (w=60, h=120 -> AR=0.5)
    for i in range(5):
        t = float(i) * 0.3
        p = make_entity("p1", 100, 200, 200, 600, EntityClass.PERSON, timestamp=t)
        if i % 2 == 0:
            b = make_entity("b1", 200 + i * 50, 400, 320 + i * 50, 460, EntityClass.BOX, timestamp=t)
        else:
            b = make_entity("b1", 230 + i * 50, 370, 290 + i * 50, 490, EntityClass.BOX, timestamp=t)
        frames.append(make_frame(t, [p, b]))

    findings, _ = recognize_all_behaviours(
        frames, frame_width=FRAME_W, frame_height=FRAME_H, timestamp=1.2
    )
    roll = next((f for f in findings if f.scenario == "rolling_precursor"), None)
    assert roll is not None
    assert roll.status == FindingStatus.PROBABLE
    assert "aspect-ratio oscillation" in roll.explanation.lower()
    assert "2D_aspect_oscillation_heuristic" in roll.limitations


def test_rolling_refuses_constant_aspect_ratio():
    """Smooth horizontal sliding without aspect ratio changes does NOT trigger rolling."""
    frames = [
        make_frame(
            float(i) * 0.3,
            [
                make_entity("p1", 100, 200, 200, 600, EntityClass.PERSON, timestamp=float(i) * 0.3),
                make_entity("b1", 200 + i * 50, 350, 300 + i * 50, 450, EntityClass.BOX, timestamp=float(i) * 0.3),
            ],
        )
        for i in range(5)
    ]
    findings, _ = recognize_all_behaviours(
        frames, frame_width=FRAME_W, frame_height=FRAME_H, timestamp=1.2
    )
    assert all(f.scenario != "rolling_precursor" for f in findings)


# ---------------------------------------------------------------------------
# 5. Scenario 5: Packaging Straps Used as Handles Tests
# ---------------------------------------------------------------------------

def test_straps_as_handles_upper_perimeter_lift():
    """Worker contact strictly on upper perimeter of box without base support triggers straps_as_handles."""
    frames = []
    for i in range(5):
        t = float(i) * 0.3
        # Worker stands on floor: y1=200, y2=650. Box is lifted upward by top edge from y=350 to y=270.
        p = make_entity("p1", 120, 200, 220, 650, EntityClass.PERSON, timestamp=t)
        b = make_entity("b1", 180, 350 - i * 20, 280, 480 - i * 20, EntityClass.BOX, timestamp=t)
        frames.append(make_frame(t, [p, b]))

    findings, _ = recognize_all_behaviours(
        frames, frame_width=FRAME_W, frame_height=FRAME_H, timestamp=1.2
    )
    strap = next((f for f in findings if f.scenario == "straps_as_handles"), None)
    assert strap is not None
    assert "packaging straps" in strap.explanation.lower()
    assert "not_predictable_in_advance" in strap.limitations
    assert "straps_are_subpixel" in strap.limitations


# ---------------------------------------------------------------------------
# 6. Scenario 6: Stepping on Cartons Tests
# ---------------------------------------------------------------------------

def test_stepping_on_carton_elevated():
    """Worker elevated atop carton upper boundary triggers stepping_on_carton_precursor."""
    frames = [
        make_frame(
            float(i) * 0.3,
            [
                make_entity("p1", 400, 260, 500, 440, EntityClass.PERSON, timestamp=float(i) * 0.3),
                make_entity("b1", 410, 420, 490, 520, EntityClass.BOX, timestamp=float(i) * 0.3),
            ],
        )
        for i in range(5)
    ]
    findings, _ = recognize_all_behaviours(
        frames, frame_width=FRAME_W, frame_height=FRAME_H, timestamp=1.2
    )
    step = next((f for f in findings if f.scenario == "stepping_on_carton_precursor"), None)
    assert step is not None
    assert step.status == FindingStatus.PROBABLE
    assert "stepping on cartons" in step.explanation.lower()


def test_stepping_on_carton_refuses_ground_standing():
    """Worker standing on floor beside carton is NOT stepping on carton."""
    frames = [
        make_frame(
            float(i) * 0.3,
            [
                make_entity("p1", 400, 250, 480, 680, EntityClass.PERSON, timestamp=float(i) * 0.3),
                make_entity("b1", 380, 350, 500, 550, EntityClass.BOX, timestamp=float(i) * 0.3),
            ],
        )
        for i in range(5)
    ]
    findings, _ = recognize_all_behaviours(
        frames, frame_width=FRAME_W, frame_height=FRAME_H, timestamp=1.2
    )
    assert all(f.scenario != "stepping_on_carton_precursor" for f in findings)


# ---------------------------------------------------------------------------
# 7. Scenario 12: Solo Heavy Handling Tests
# ---------------------------------------------------------------------------

def test_solo_heavy_handling_single_worker():
    """Single worker moving heavy mass-class cargo triggers solo_heavy_handling."""
    frames = [
        make_frame(
            float(i) * 0.3,
            [
                make_entity("p1", 100, 100, 200, 300, EntityClass.PERSON, timestamp=float(i) * 0.3),
                make_entity("b1", 150 + i * 30, 100, 250 + i * 30, 200, EntityClass.BOX, timestamp=float(i) * 0.3),
            ],
        )
        for i in range(6)
    ]
    catalog = {
        "sku_heavy": ProductMetadata(
            product_id="sku_heavy",
            class_name="heavy_crate",
            mass_class=MassClass.HEAVY,
            fragility=Fragility.MEDIUM,
        )
    }
    findings, _ = recognize_all_behaviours(
        frames,
        frame_width=FRAME_W,
        frame_height=FRAME_H,
        timestamp=1.5,
        product_metadata_by_id=catalog,
        default_product_id="sku_heavy",
    )
    solo = next((f for f in findings if f.scenario == "solo_heavy_handling"), None)
    assert solo is not None
    assert solo.status == FindingStatus.PROBABLE
    assert "heavy" in solo.explanation.lower()
    assert "team assistance" in solo.explanation.lower()


def test_solo_heavy_handling_suppressed_by_team_lift():
    """When two workers handle the heavy item together, solo handling is suppressed."""
    frames = [
        make_frame(
            float(i) * 0.3,
            [
                make_entity("p1", 100, 100, 200, 300, EntityClass.PERSON, timestamp=float(i) * 0.3),
                make_entity("p2", 260, 100, 360, 300, EntityClass.PERSON, timestamp=float(i) * 0.3),
                make_entity("b1", 170 + i * 20, 100, 270 + i * 20, 200, EntityClass.BOX, timestamp=float(i) * 0.3),
            ],
        )
        for i in range(6)
    ]
    catalog = {
        "sku_heavy": ProductMetadata(
            product_id="sku_heavy",
            class_name="heavy_crate",
            mass_class=MassClass.HEAVY,
            fragility=Fragility.MEDIUM,
        )
    }
    findings, _ = recognize_all_behaviours(
        frames,
        frame_width=FRAME_W,
        frame_height=FRAME_H,
        timestamp=1.5,
        product_metadata_by_id=catalog,
        default_product_id="sku_heavy",
    )
    assert all(f.scenario != "solo_heavy_handling" for f in findings)


# ---------------------------------------------------------------------------
# 8. REST API Endpoint Tests
# ---------------------------------------------------------------------------

def test_api_behaviour_scenarios_catalog():
    """GET /api/behaviour/scenarios returns all catalog items with metadata."""
    client = TestClient(app)
    res = client.get("/api/behaviour/scenarios")
    assert res.status_code == 200
    data = res.json()
    assert len(data) == 9

    scenarios = {s["scenario_id"] for s in data}
    assert "dropping_or_throwing_precursor" in scenarios
    assert "dragging_precursor" in scenarios
    assert "rolling_precursor" in scenarios
    assert "straps_as_handles" in scenarios
    assert "stepping_on_carton_precursor" in scenarios
    assert "solo_heavy_handling" in scenarios
    assert "forklift_pedestrian_proximity" in scenarios


def test_api_behaviour_scenario_detail():
    """GET /api/behaviour/scenarios/{id} returns details or 404 for invalid."""
    client = TestClient(app)
    res = client.get("/api/behaviour/scenarios/dragging_precursor")
    assert res.status_code == 200
    assert res.json()["name"] == "Dragging Instead of Lifting"

    bad = client.get("/api/behaviour/scenarios/non_existent")
    assert bad.status_code == 404


def test_api_behaviour_evaluate_video():
    """GET /api/behaviour/video/{id} returns BehaviourEvaluationResponse."""
    client = TestClient(app)
    res = client.get("/api/behaviour/video/synthetic_straight_stack?timestamp=1.0")
    # If perception cache is present, returns 200
    if res.status_code == 200:
        data = res.json()
        assert "timestamp" in data
        assert "findings" in data
        assert "kinematics" in data
        assert "epistemic_notice" in data
    else:
        assert res.status_code in (404, 503)


def test_forklift_pedestrian_proximity():
    """Moving forklift within proximity of a pedestrian raises a High-risk finding."""
    frames = [
        make_frame(
            float(i) * 0.3,
            [
                make_entity("f1", 200 + i * 15, 300, 350 + i * 15, 450, EntityClass.FORKLIFT, timestamp=float(i) * 0.3),
                make_entity("p1", 300, 300, 380, 500, EntityClass.PERSON, timestamp=float(i) * 0.3),
            ],
        )
        for i in range(5)
    ]
    findings, _ = recognize_all_behaviours(
        frames, frame_width=FRAME_W, frame_height=FRAME_H, timestamp=1.2
    )
    fk = next((f for f in findings if f.scenario == "forklift_pedestrian_proximity"), None)
    assert fk is not None
    assert fk.band == RiskBand.HIGH
    assert fk.status == FindingStatus.PROBABLE


def test_no_forklift_when_stationary():
    """A stationary forklift does not raise the proximity finding."""
    frames = [
        make_frame(
            float(i) * 0.3,
            [
                make_entity("f1", 200, 300, 350, 450, EntityClass.FORKLIFT, timestamp=float(i) * 0.3),
                make_entity("p1", 300, 300, 380, 500, EntityClass.PERSON, timestamp=float(i) * 0.3),
            ],
        )
        for i in range(5)
    ]
    findings, _ = recognize_all_behaviours(
        frames, frame_width=FRAME_W, frame_height=FRAME_H, timestamp=1.2
    )
    assert all(f.scenario != "forklift_pedestrian_proximity" for f in findings)
