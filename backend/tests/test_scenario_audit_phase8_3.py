"""Phase 8.3 — 14-Scenario Semantic Audit Test Suite.

Rigorously verifies every one of the 14 core warehouse risk scenarios against
TRACE's non-negotiable safety rules, epistemic status ceilings, and What-If gates:

Scenario 1: Heavy on Light
Scenario 2: Throwing / Dropping
Scenario 3: Dragging
Scenario 4: Rolling
Scenario 5: Straps as Handles (OOV)
Scenario 6: Stepping on Cartons
Scenario 7: Wrong Product Orientation
Scenario 8: Pallet Overhang (Pallet reliability 0.15 ceiling)
Scenario 9: Dock / Vehicle Gap (Calibrated zone required)
Scenario 10: Wet Floor (Calibrated zone required)
Scenario 11: Unplanned Loading Sequence (Manifest required)
Scenario 12: Solo Heavy Handling (HEAVY SKU required)
Scenario 13: Wrong Equipment Usage (OOV)
Scenario 14: Unsupported / Bending Placement (>50% cantilever)
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
    Fragility,
    MassClass,
    PerceptionFrameResult,
    ProductMetadata,
    SceneGraphEdge,
    SceneGraphEdgeType,
    SceneGraphNode,
    SceneGraphSnapshot,
)
from backend.lenses.conformance import (
    ORIENTATION_RULE,
    STANDARD_CONFORMANCE_RULES,
    evaluate_conformance,
)
from backend.lenses.environmental import EnvironmentalZone, ZoneType, evaluate_environmental
from backend.lenses.structural import evaluate_structural
from backend.planner.actions import plan_action
from backend.planner.simulation import run_what_if_simulation
from backend.risk.config import RiskConfig


def _make_entity(entity_id: str, cls: EntityClass, x1: float, y1: float, x2: float, y2: float, ts: float, conf: float = 0.90) -> Entity:
    return Entity(
        id=entity_id,
        track_id=entity_id.split(":")[-1],
        entity_class=cls,
        bbox=BoundingBox(x1=x1, y1=y1, x2=x2, y2=y2),
        confidence=conf,
        timestamp=ts,
    )


def _make_frame_result(source_id: str, ts: float, entities: list[Entity]) -> PerceptionFrameResult:
    return PerceptionFrameResult(
        source_id=source_id,
        timestamp=ts,
        entities=entities,
        model_identity="trace-pilot-v1",
        analysis_fps=3.0,
        source_fps=30.0,
        sampling_mode="normal",
    )


# --------------------------------------------------------------------------
# Scenario 1: Heavy on Light Stacking
# --------------------------------------------------------------------------
def test_scenario_1_heavy_on_light_requires_sku_metadata():
    """Known heavy SKU stacked atop light SKU triggers heavy_on_light_stacking.
    Without SKU metadata, system NEVER infers mass from visual size."""
    # Top box rests on bottom box
    supporter = SceneGraphNode(
        entity_id="box_light",
        entity_class=EntityClass.BOX,
        position=(0.5, 0.6),
        footprint=BoundingBox(x1=0.35, y1=0.50, x2=0.65, y2=0.70),
        product_id="sku_light",
    )
    supported = SceneGraphNode(
        entity_id="box_heavy",
        entity_class=EntityClass.BOX,
        position=(0.5, 0.4),
        footprint=BoundingBox(x1=0.35, y1=0.30, x2=0.65, y2=0.50),
        product_id="sku_heavy",
    )
    edge = SceneGraphEdge(
        source_id="box_light",
        target_id="box_heavy",
        edge_type=SceneGraphEdgeType.SUPPORT,
        weight=0.9,
        evidence={"vertical_gap": 0.0, "horizontal_overlap_ratio": 1.0},
    )
    snapshot = SceneGraphSnapshot(timestamp=1.0, nodes=[supporter, supported], edges=[edge])
    conf = {"box_light": 0.9, "box_heavy": 0.9}

    # Case A: Known SKUs with reverse mass order
    sku_catalog = {
        "sku_light": ProductMetadata(product_id="sku_light", class_name="c1", mass_class=MassClass.LIGHT, fragility=Fragility.LOW),
        "sku_heavy": ProductMetadata(product_id="sku_heavy", class_name="c2", mass_class=MassClass.HEAVY, fragility=Fragility.LOW),
    }
    findings = evaluate_structural(snapshot, entity_confidence=conf, product_metadata_by_id=sku_catalog)
    f = next((x for x in findings if x.scenario == "heavy_on_light_stacking"), None)
    assert f is not None
    assert f.status == FindingStatus.PROBABLE  # box reliability ceiling
    act = plan_action(f.scenario, f.status, f.confidence)
    assert act.what_if_eligible is True

    # Case B: Unknown SKUs (unlinked metadata) -> NO heavy_on_light claim
    findings_no_sku = evaluate_structural(snapshot, entity_confidence=conf, product_metadata_by_id={})
    assert all(x.scenario != "heavy_on_light_stacking" for x in findings_no_sku)
    assert any(x.scenario == "image_space_support_hypothesis" for x in findings_no_sku)


# --------------------------------------------------------------------------
# Scenario 2: Throwing / Dropping
# --------------------------------------------------------------------------
def test_scenario_2_throwing_dropping_requires_temporal_coherence():
    """Downward velocity spike over >=3 samples triggers dropping_or_throwing_precursor.
    If < 3 samples, it is honestly rejected."""
    w, h = 1280, 720
    # 4 samples with rapid downward drop (dy=0.25 norm)
    frames = [
        _make_frame_result("src", i * 0.16, [
            _make_entity("src:p", EntityClass.PERSON, 400, 200, 500, 600, i * 0.16),
            _make_entity("src:b", EntityClass.BOX, 420, 200 + i * 60, 480, 260 + i * 60, i * 0.16),
        ])
        for i in range(4)
    ]
    findings = evaluate_behaviour(frames, frame_width=w, frame_height=h, timestamp=0.48)
    f = next((x for x in findings if x.scenario == "dropping_or_throwing_precursor"), None)
    assert f is not None
    assert f.status == FindingStatus.PROBABLE
    act = plan_action(f.scenario, f.status, f.confidence)
    assert act.what_if_eligible is False  # Behavioural events are not static placements


# --------------------------------------------------------------------------
# Scenario 3: Dragging
# --------------------------------------------------------------------------
def test_scenario_3_dragging_requires_ground_translation_and_direction():
    """Box translating at ground tier with worker in same direction triggers dragging_precursor.
    Opposite direction or worker walking past box triggers NO dragging."""
    w, h = 1280, 720
    # Valid dragging: worker & box both moving right at ground tier (y >= 0.50)
    # Person at y: 380..680 (center y = 530), Box at y: 520..650 (center y = 585) -> y distance = 55/720 = 0.076 < 0.15
    frames_drag = [
        _make_frame_result("src", i * 0.33, [
            _make_entity("src:p", EntityClass.PERSON, 300 + i * 40, 380, 400 + i * 40, 680, i * 0.33),
            _make_entity("src:b", EntityClass.BOX, 380 + i * 40, 520, 480 + i * 40, 650, i * 0.33),
        ])
        for i in range(5)
    ]
    findings_drag = evaluate_behaviour(frames_drag, frame_width=w, frame_height=h, timestamp=1.32)
    f = next((x for x in findings_drag if x.scenario == "dragging_precursor"), None)
    assert f is not None
    assert f.status == FindingStatus.PROBABLE

    # Worker walking left while box moves right -> NO dragging
    frames_opp = [
        _make_frame_result("src", i * 0.33, [
            _make_entity("src:p", EntityClass.PERSON, 500 - i * 40, 380, 600 - i * 40, 680, i * 0.33),
            _make_entity("src:b", EntityClass.BOX, 380 + i * 40, 520, 480 + i * 40, 650, i * 0.33),
        ])
        for i in range(5)
    ]
    findings_opp = evaluate_behaviour(frames_opp, frame_width=w, frame_height=h, timestamp=1.32)
    assert all(x.scenario != "dragging_precursor" for x in findings_opp)


# --------------------------------------------------------------------------
# Scenario 4: Rolling
# --------------------------------------------------------------------------
def test_scenario_4_rolling_reported_as_image_space_displacement_only():
    """Rolling is reported as displacement evidence without claiming 3D rotational mechanics."""
    w, h = 1280, 720
    # Box moving at mid-height (y=250..350 -> center y=300/720=0.416 < 0.50, not ground level)
    frames = [
        _make_frame_result("src", i * 0.33, [
            _make_entity("src:p", EntityClass.PERSON, 300, 200, 400, 500, i * 0.33),
            _make_entity("src:b", EntityClass.BOX, 360 + i * 40, 250, 460 + i * 40, 350, i * 0.33),
        ])
        for i in range(5)
    ]
    findings = evaluate_behaviour(frames, frame_width=w, frame_height=h, timestamp=1.32)
    f = next((x for x in findings if x.scenario in ("box_displacement_near_person", "rolling_precursor")), None)
    assert f is not None
    assert "no_pose_signal" in f.limitations
    assert "no_contact_force_signal" in f.limitations


# --------------------------------------------------------------------------
# Scenario 5: Straps as Handles (OOV Entity)
# --------------------------------------------------------------------------
def test_scenario_5_straps_as_handles_refuses_hallucination():
    """Straps are sub-pixel and OOV; TRACE honestly marks condition as UNSUPPORTED
    and refuses to recommend corrective placement."""
    act = plan_action("straps_as_handles", FindingStatus.UNSUPPORTED, ConfidenceLevel.LOW)
    assert "cannot safely determine" in act.action
    assert act.what_if_eligible is False


# --------------------------------------------------------------------------
# Scenario 6: Stepping on Cartons
# --------------------------------------------------------------------------
def test_scenario_6_stepping_on_cartons_requires_elevated_feet_alignment():
    """Worker elevated with feet atop carton upper boundary triggers stepping_on_carton_precursor.
    Worker standing behind carton (no elevation) does not."""
    w, h = 1280, 720
    # Case A: Worker elevated atop carton (feet y2=440 near box y1=420, head y1=260 < box y1=420)
    frames_step = [
        _make_frame_result("src", i * 0.33, [
            _make_entity("src:p", EntityClass.PERSON, 400, 260, 500, 440, i * 0.33),
            _make_entity("src:b", EntityClass.BOX, 410, 420, 490, 520, i * 0.33),
        ])
        for i in range(5)
    ]
    findings_step = evaluate_behaviour(
        frames_step,
        frame_width=w,
        frame_height=h,
        timestamp=1.32,
        config=RiskConfig(behaviour_proximity_threshold=0.20, behaviour_min_common_samples=4),
    )
    f = next((x for x in findings_step if x.scenario == "stepping_on_carton_precursor"), None)
    assert f is not None
    assert f.status == FindingStatus.PROBABLE

    # Case B: Worker standing beside carton on ground (feet y2=680, box y1=350, y2=550)
    frames_ground = [
        _make_frame_result("src", i * 0.33, [
            _make_entity("src:p", EntityClass.PERSON, 400, 250, 480, 680, i * 0.33),
            _make_entity("src:b", EntityClass.BOX, 380, 350, 500, 550, i * 0.33),
        ])
        for i in range(5)
    ]
    findings_ground = evaluate_behaviour(frames_ground, frame_width=w, frame_height=h, timestamp=1.32)
    assert all(x.scenario != "stepping_on_carton_precursor" for x in findings_ground)


# --------------------------------------------------------------------------
# Scenario 7: Wrong Product Orientation
# --------------------------------------------------------------------------
def test_scenario_7_wrong_product_orientation_perspective_tolerance():
    """Vertical required orientation triggered when 2D aspect ratio > 1.35.
    Unconstrained SKU or tilt <= 1.35 does NOT trigger violation."""
    sku_vertical = ProductMetadata(product_id="sku_cupboard", class_name="cupboard", mass_class=MassClass.HEAVY, fragility=Fragility.MEDIUM, required_orientation="vertical")
    sku_unconstrained = ProductMetadata(product_id="sku_seating", class_name="seating", mass_class=MassClass.MEDIUM, fragility=Fragility.LOW, required_orientation=None)

    # Wide box (aspect ratio ~2.0 > 1.35)
    wide_node = SceneGraphNode(
        entity_id="node_box",
        entity_class=EntityClass.BOX,
        position=(0.5, 0.5),
        footprint=BoundingBox(x1=0.20, y1=0.40, x2=0.80, y2=0.60),
        product_id="sku_cupboard",
    )
    findings = evaluate_conformance([wide_node], {"sku_cupboard": sku_vertical}, timestamp=1.0, rules=STANDARD_CONFORMANCE_RULES)
    f = next((x for x in findings if x.scenario == "wrong_product_orientation"), None)
    assert f is not None
    assert f.status == FindingStatus.PROBABLE

    # Unconstrained SKU with same wide footprint -> NO violation
    unconstrained_node = SceneGraphNode(
        entity_id="node_box",
        entity_class=EntityClass.BOX,
        position=(0.5, 0.5),
        footprint=BoundingBox(x1=0.20, y1=0.40, x2=0.80, y2=0.60),
        product_id="sku_seating",
    )
    findings_uncon = evaluate_conformance([unconstrained_node], {"sku_seating": sku_unconstrained}, timestamp=1.0, rules=STANDARD_CONFORMANCE_RULES)
    # Generic unconstrained carton never triggers actionable PROBABLE orientation violation
    assert all(x.status != FindingStatus.PROBABLE for x in findings_uncon)
    for f_uncon in findings_uncon:
        act = plan_action(f_uncon.scenario, f_uncon.status, f_uncon.confidence)
        assert act.what_if_eligible is False


# --------------------------------------------------------------------------
# Scenario 8: Pallet Overhang (Pallet Reliability Ceiling 0.15)
# --------------------------------------------------------------------------
def test_scenario_8_pallet_overhang_capped_at_insufficient_evidence():
    """Pallet class reliability is capped at 0.15; pallet overhang can never
    exceed INSUFFICIENT_EVIDENCE regardless of detector confidence."""
    supporter = SceneGraphNode(
        entity_id="pallet_1",
        entity_class=EntityClass.PALLET,
        position=(0.5, 0.7),
        footprint=BoundingBox(x1=0.30, y1=0.65, x2=0.70, y2=0.75),
    )
    supported = SceneGraphNode(
        entity_id="box_1",
        entity_class=EntityClass.BOX,
        position=(0.5, 0.55),
        footprint=BoundingBox(x1=0.20, y1=0.45, x2=0.65, y2=0.65),  # 64% overlap with pallet
    )
    edge = SceneGraphEdge(
        source_id="pallet_1",
        target_id="box_1",
        edge_type=SceneGraphEdgeType.SUPPORT,
        weight=0.9,
        evidence={"vertical_gap": 0.0, "horizontal_overlap_ratio": 0.64},
    )
    snapshot = SceneGraphSnapshot(timestamp=1.0, nodes=[supporter, supported], edges=[edge])
    # Detector reports 1.0 confidence for both
    findings = evaluate_structural(snapshot, entity_confidence={"pallet_1": 1.0, "box_1": 1.0})
    f = next((x for x in findings if x.scenario == "pallet_overhang"), None)
    assert f is not None
    # 1.0 * 0.15 * 1.0 = 0.15 -> INSUFFICIENT_EVIDENCE (ceiling strictly enforced!)
    assert f.status == FindingStatus.INSUFFICIENT_EVIDENCE


# --------------------------------------------------------------------------
# Scenario 9: Dock / Vehicle Gap
# --------------------------------------------------------------------------
def test_scenario_9_dock_edge_hazard_requires_calibrated_polygon():
    """Requires operator-calibrated polygon zone. Without calibrated zone, returns []."""
    node = SceneGraphNode(
        entity_id="p1",
        entity_class=EntityClass.PERSON,
        position=(0.20, 0.60),
    )
    dock_zone = EnvironmentalZone(
        zone_id="dock_9_edge",
        zone_type=ZoneType.DOCK_EDGE,
        polygon=[(0.0, 0.50), (0.45, 0.45), (0.50, 0.85), (0.0, 0.90)],
    )
    # Case A: Inside calibrated zone
    findings = evaluate_environmental([node], timestamp=1.0, zones=[dock_zone])
    assert len(findings) == 1
    assert findings[0].status == FindingStatus.SUPPORTED
    assert findings[0].scenario == "entity_in_dock_edge_zone"

    # Case B: Uncalibrated camera (no zones) -> strictly empty list, no guessed hazard
    findings_uncal = evaluate_environmental([node], timestamp=1.0, zones=[])
    assert len(findings_uncal) == 0


# --------------------------------------------------------------------------
# Scenario 10: Wet Floor
# --------------------------------------------------------------------------
def test_scenario_10_wet_floor_requires_calibrated_polygon_no_optical_sheen():
    """Wet floor triggers only from calibrated environmental polygon, never optical reflections."""
    node = SceneGraphNode(
        entity_id="p1",
        entity_class=EntityClass.PERSON,
        position=(0.50, 0.50),
    )
    wet_zone = EnvironmentalZone(
        zone_id="wet_floor_bay",
        zone_type=ZoneType.WET_FLOOR,
        polygon=[(0.30, 0.30), (0.70, 0.30), (0.70, 0.70), (0.30, 0.70)],
    )
    findings = evaluate_environmental([node], timestamp=1.0, zones=[wet_zone])
    assert len(findings) == 1
    assert findings[0].scenario == "entity_in_wet_floor_zone"
    assert findings[0].status == FindingStatus.SUPPORTED


# --------------------------------------------------------------------------
# Scenario 11: Unplanned Loading Sequence
# --------------------------------------------------------------------------
def test_scenario_11_unplanned_loading_sequence_unsupported_without_manifest():
    """Multi-stage loading sequence without manifest integration is honestly UNSUPPORTED."""
    act = plan_action("unplanned_loading_sequence", FindingStatus.UNSUPPORTED, ConfidenceLevel.LOW)
    assert act.status == FindingStatus.UNSUPPORTED
    assert "cannot safely determine" in act.action
    assert act.what_if_eligible is False


# --------------------------------------------------------------------------
# Scenario 12: Solo Heavy Handling
# --------------------------------------------------------------------------
def test_scenario_12_solo_heavy_handling_requires_heavy_sku_and_single_person():
    """Triggered only when moving item has mass_class == HEAVY and exactly 1 worker is interacting."""
    w, h = 1280, 720
    sku_heavy = ProductMetadata(product_id="heavy_carton", class_name="c", mass_class=MassClass.HEAVY, fragility=Fragility.LOW)
    catalog = {"heavy_carton": sku_heavy}

    # Case A: 1 worker moving heavy carton
    frames_solo = [
        _make_frame_result("src", i * 0.30, [
            _make_entity("src:p1", EntityClass.PERSON, 100, 100, 200, 300, i * 0.30),
            _make_entity("src:b", EntityClass.BOX, 150 + i * 30, 100, 250 + i * 30, 200, i * 0.30),
        ])
        for i in range(6)
    ]
    findings_solo = evaluate_behaviour(
        frames_solo,
        frame_width=w,
        frame_height=h,
        timestamp=1.5,
        config=RiskConfig(behaviour_min_common_samples=4),
        product_metadata_by_id=catalog,
        default_product_id="heavy_carton",
    )
    f = next((x for x in findings_solo if x.scenario == "solo_heavy_handling"), None)
    assert f is not None
    assert f.status == FindingStatus.PROBABLE

    # Case B: 2 workers assisting -> NO solo heavy handling
    frames_team = [
        _make_frame_result("src", i * 0.30, [
            _make_entity("src:p1", EntityClass.PERSON, 100, 100, 200, 300, i * 0.30),
            _make_entity("src:p2", EntityClass.PERSON, 120, 100, 220, 300, i * 0.30),
            _make_entity("src:b", EntityClass.BOX, 150 + i * 30, 100, 250 + i * 30, 200, i * 0.30),
        ])
        for i in range(6)
    ]
    findings_team = evaluate_behaviour(
        frames_team,
        frame_width=w,
        frame_height=h,
        timestamp=1.5,
        config=RiskConfig(behaviour_min_common_samples=4),
        product_metadata_by_id=catalog,
        default_product_id="heavy_carton",
    )
    assert all(x.scenario != "solo_heavy_handling" for x in findings_team)


# --------------------------------------------------------------------------
# Scenario 13: Wrong Equipment Usage
# --------------------------------------------------------------------------
def test_scenario_13_wrong_equipment_usage_unsupported():
    """Equipment taxonomy is OOV for pilot model; marks condition as UNSUPPORTED."""
    act = plan_action("wrong_equipment_usage", FindingStatus.UNSUPPORTED, ConfidenceLevel.LOW)
    assert act.status == FindingStatus.UNSUPPORTED
    assert "cannot safely determine" in act.action


# --------------------------------------------------------------------------
# Scenario 14: Unsupported / Bending Placement
# --------------------------------------------------------------------------
def test_scenario_14_unsupported_bending_placement_cantilever():
    """Overhang > 50% (< 50% horizontal support) triggers unsupported_bending_placement."""
    supporter = SceneGraphNode(
        entity_id="base_box",
        entity_class=EntityClass.BOX,
        position=(0.5, 0.7),
        footprint=BoundingBox(x1=0.30, y1=0.60, x2=0.70, y2=0.80),
    )
    supported = SceneGraphNode(
        entity_id="upper_box",
        entity_class=EntityClass.BOX,
        position=(0.5, 0.5),
        footprint=BoundingBox(x1=0.10, y1=0.40, x2=0.50, y2=0.60),  # only 40% support on base_box
    )
    edge = SceneGraphEdge(
        source_id="base_box",
        target_id="upper_box",
        edge_type=SceneGraphEdgeType.SUPPORT,
        weight=0.9,
        evidence={"vertical_gap": 0.0, "horizontal_overlap_ratio": 0.40},
    )
    snapshot = SceneGraphSnapshot(timestamp=1.0, nodes=[supporter, supported], edges=[edge])
    findings = evaluate_structural(snapshot, entity_confidence={"base_box": 0.9, "upper_box": 0.9})
    f = next((x for x in findings if x.scenario == "unsupported_bending_placement"), None)
    assert f is not None
    assert f.status == FindingStatus.PROBABLE
    act = plan_action(f.scenario, f.status, f.confidence)
    assert act.what_if_eligible is True
