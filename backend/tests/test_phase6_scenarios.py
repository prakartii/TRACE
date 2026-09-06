"""Unit and integration tests for Phase 6 perception and scenario improvements.

Tests:
- Manifest registration and metadata lookup
- Conformance lens orientation rule (Scenario 7)
- Structural lens overhang (Scenario 8) and cantilever (Scenario 14)
- Structural lens heavy-on-light stacking (Scenario 1)
- Behaviour lens dropping/throwing kinematic precursor (Scenario 2)
- Behaviour lens dragging precursor (Scenario 3)
- Behaviour lens stepping on cartons precursor (Scenario 6)
- Behaviour lens solo heavy handling (Scenario 12)
- Safe Action Planner action mappings for all new scenarios
"""

import pytest

from backend.contracts.models import (
    BoundingBox,
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
from backend.behaviour.lens import evaluate_behaviour
from backend.lenses.conformance import (
    ORIENTATION_RULE,
    STANDARD_CONFORMANCE_RULES,
    evaluate_conformance,
)
from backend.lenses.environmental import EnvironmentalZone, ZoneType, evaluate_environmental
from backend.lenses.structural import evaluate_structural
from backend.planner.actions import recommended_action
from backend.risk.config import RiskConfig
from backend.world_model.manifest import (
    OperationalManifest,
    PRODUCT_CATALOG,
    get_manifest_for_source,
    register_manifest,
)
from backend.world_model.scene_graph import WorldModel, entity_to_scene_node

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
        source_id="test_source",
        timestamp=timestamp,
        entities=entities,
    )


# ---------------------------------------------------------------------------
# Manifest Tests
# ---------------------------------------------------------------------------

def test_manifest_lookup_for_known_and_unknown_sources():
    # Unknown source with no filename match returns None (clean unlinked state)
    assert get_manifest_for_source("unknown_id_12345", "random_video.mp4") is None

    # Known challenge video filename match returns manifest
    manifest = get_manifest_for_source("src_1", "Dock level, dragging cupboard.mp4")
    assert manifest is not None
    assert manifest.bay_name == "Dock 09 inside"
    assert manifest.primary_product_id == "auradine_cupboard"
    assert len(manifest.environmental_zones) >= 1

    # Dynamic registration works
    custom_manifest = OperationalManifest(
        manifest_id="custom_1",
        bay_name="Bay 12",
        product_metadata=[PRODUCT_CATALOG["seating_carton"]],
    )
    register_manifest("custom_source_99", custom_manifest)
    retrieved = get_manifest_for_source("custom_source_99")
    assert retrieved == custom_manifest


# ---------------------------------------------------------------------------
# Conformance: Scenario 7 (Wrong Product Orientation)
# ---------------------------------------------------------------------------

def test_conformance_wrong_product_orientation_detected():
    # Box requires vertical (upright) orientation, but observed box is wider than tall (horizontal)
    # e.g., width 400px, height 200px -> aspect ratio 2.0 > 1.25
    e = make_entity("vid:b1", 100, 100, 500, 300, EntityClass.BOX)
    snapshot = WorldModel().build_snapshot(
        [e],
        frame_width=FRAME_W,
        frame_height=FRAME_H,
        timestamp=0.0,
        default_product_id="auradine_cupboard",
        compute_aspect_orientation=True,
    )
    assert snapshot.nodes[0].product_id == "auradine_cupboard"
    assert snapshot.nodes[0].orientation is not None
    assert snapshot.nodes[0].orientation > 1.25

    metadata_map = {"auradine_cupboard": PRODUCT_CATALOG["auradine_cupboard"]}
    findings = evaluate_conformance(
        snapshot.nodes,
        product_metadata_by_id=metadata_map,
        timestamp=0.0,
        rules=STANDARD_CONFORMANCE_RULES,
    )
    assert len(findings) == 1
    assert findings[0].scenario == "wrong_product_orientation"
    assert findings[0].status == FindingStatus.PROBABLE
    assert "vertical" in findings[0].explanation
    assert findings[0].recommended_action is not None


def test_conformance_correct_orientation_passes():
    # Box requires vertical, and observed box is taller than wide (width 200, height 400)
    e = make_entity("vid:b1", 100, 100, 300, 500, EntityClass.BOX)
    snapshot = WorldModel().build_snapshot(
        [e],
        frame_width=FRAME_W,
        frame_height=FRAME_H,
        timestamp=0.0,
        default_product_id="auradine_cupboard",
        compute_aspect_orientation=True,
    )
    metadata_map = {"auradine_cupboard": PRODUCT_CATALOG["auradine_cupboard"]}
    findings = evaluate_conformance(
        snapshot.nodes,
        product_metadata_by_id=metadata_map,
        timestamp=0.0,
        rules=STANDARD_CONFORMANCE_RULES,
    )
    assert findings == []


# ---------------------------------------------------------------------------
# Structural: Scenario 1 (Heavy-on-Light), Scenario 8 (Overhang), Scenario 14
# ---------------------------------------------------------------------------

def test_structural_heavy_on_light_stacking():
    # Supporter is light KD packets, supported is heavy overpack box
    supporter = SceneGraphNode(
        entity_id="vid:supporter",
        entity_class=EntityClass.BOX,
        position=(0.5, 0.7),
        footprint=BoundingBox(x1=0.2, y1=0.6, x2=0.8, y2=0.8),
        product_id="kd_flatpack_packets",
    )
    supported = SceneGraphNode(
        entity_id="vid:supported",
        entity_class=EntityClass.BOX,
        position=(0.5, 0.5),
        footprint=BoundingBox(x1=0.25, y1=0.4, x2=0.75, y2=0.6),
        product_id="heavy_overpack_box",
    )
    edge = SceneGraphEdge(
        source_id="vid:supporter",
        target_id="vid:supported",
        edge_type=SceneGraphEdgeType.SUPPORT,
        weight=0.9,
        evidence={"vertical_gap": 0.0, "horizontal_overlap_ratio": 1.0},
    )
    snapshot = SceneGraphSnapshot(timestamp=0.0, nodes=[supporter, supported], edges=[edge])
    metadata = {
        "kd_flatpack_packets": PRODUCT_CATALOG["kd_flatpack_packets"],
        "heavy_overpack_box": PRODUCT_CATALOG["heavy_overpack_box"],
    }
    findings = evaluate_structural(
        snapshot,
        entity_confidence={"vid:supporter": 0.9, "vid:supported": 0.9},
        product_metadata_by_id=metadata,
    )
    assert len(findings) == 1
    assert findings[0].scenario == "heavy_on_light_stacking"
    assert "crushing" in findings[0].explanation.lower()
    assert findings[0].recommended_action is not None


def test_structural_pallet_overhang():
    # Box on pallet with horizontal_overlap_ratio = 0.65 (< 0.75)
    supporter = SceneGraphNode(
        entity_id="vid:pallet",
        entity_class=EntityClass.PALLET,
        position=(0.5, 0.7),
        footprint=BoundingBox(x1=0.2, y1=0.65, x2=0.8, y2=0.75),
    )
    supported = SceneGraphNode(
        entity_id="vid:box",
        entity_class=EntityClass.BOX,
        position=(0.7, 0.55),
        footprint=BoundingBox(x1=0.4, y1=0.45, x2=1.0, y2=0.65),
    )
    edge = SceneGraphEdge(
        source_id="vid:pallet",
        target_id="vid:box",
        edge_type=SceneGraphEdgeType.SUPPORT,
        weight=0.65,
        evidence={"vertical_gap": 0.0, "horizontal_overlap_ratio": 0.65},
    )
    snapshot = SceneGraphSnapshot(timestamp=0.0, nodes=[supporter, supported], edges=[edge])
    findings = evaluate_structural(
        snapshot,
        entity_confidence={"vid:pallet": 0.9, "vid:box": 0.9},
    )
    assert len(findings) == 1
    assert findings[0].scenario == "pallet_overhang"
    assert "overhang" in findings[0].explanation.lower()


def test_structural_unsupported_bending_placement():
    # Box with < 50% horizontal support (severe overhang / bending span)
    supporter = SceneGraphNode(
        entity_id="vid:lower_box",
        entity_class=EntityClass.BOX,
        position=(0.3, 0.7),
        footprint=BoundingBox(x1=0.1, y1=0.65, x2=0.5, y2=0.75),
    )
    supported = SceneGraphNode(
        entity_id="vid:upper_box",
        entity_class=EntityClass.BOX,
        position=(0.6, 0.55),
        footprint=BoundingBox(x1=0.35, y1=0.45, x2=0.85, y2=0.65),
    )
    edge = SceneGraphEdge(
        source_id="vid:lower_box",
        target_id="vid:upper_box",
        edge_type=SceneGraphEdgeType.SUPPORT,
        weight=0.30,
        evidence={"vertical_gap": 0.0, "horizontal_overlap_ratio": 0.30},
    )
    snapshot = SceneGraphSnapshot(timestamp=0.0, nodes=[supporter, supported], edges=[edge])
    findings = evaluate_structural(
        snapshot,
        entity_confidence={"vid:lower_box": 0.9, "vid:upper_box": 0.9},
    )
    assert len(findings) == 1
    assert findings[0].scenario == "unsupported_bending_placement"
    assert "bending" in findings[0].explanation.lower()


# ---------------------------------------------------------------------------
# Behaviour: Scenario 2 (Throwing/Dropping), Scenario 3 (Dragging),
#            Scenario 6 (Stepping), Scenario 12 (Solo Heavy Handling)
# ---------------------------------------------------------------------------

def test_behaviour_dropping_precursor_detected():
    # Rapid downward vertical displacement of box while near person
    # (dy_net >= 0.08, dy ratio >= 0.6, speed >= 0.15)
    frames = []
    for i in range(6):
        t = float(i) * 0.3
        p = make_entity("vid:p1", 100, 100, 200, 300, EntityClass.PERSON, timestamp=t)
        # Box starts near person and drops rapidly from y=150 to y=500
        b_y1 = 150 + i * 70  # normalized: 150/720=0.208 to 500/720=0.694 (dy_net ~ 0.48)
        b = make_entity("vid:b1", 220, b_y1, 320, b_y1 + 100, EntityClass.BOX, timestamp=t)
        frames.append(make_frame_result(t, [p, b]))

    findings = evaluate_behaviour(
        frames,
        frame_width=FRAME_W,
        frame_height=FRAME_H,
        timestamp=1.5,
        config=RiskConfig(behaviour_min_common_samples=4),
    )
    assert len(findings) == 1
    assert findings[0].scenario == "dropping_or_throwing_precursor"
    assert "downward" in findings[0].explanation.lower()
    assert findings[0].recommended_action is not None


def test_behaviour_dragging_precursor_detected():
    # Sustained horizontal displacement near ground level (y > 0.45 of frame, dx ratio >= 0.7)
    frames = []
    for i in range(6):
        t = float(i) * 0.3
        p = make_entity("vid:p1", 100 + i * 40, 350, 200 + i * 40, 650, EntityClass.PERSON, timestamp=t)
        # Box is at bottom of frame (y=500..600, > 0.45) moving horizontally with person
        b_x1 = 220 + i * 40
        b = make_entity("vid:b1", b_x1, 500, b_x1 + 120, 620, EntityClass.BOX, timestamp=t)
        frames.append(make_frame_result(t, [p, b]))

    findings = evaluate_behaviour(
        frames,
        frame_width=FRAME_W,
        frame_height=FRAME_H,
        timestamp=1.5,
        config=RiskConfig(behaviour_min_common_samples=4),
    )
    assert len(findings) == 1
    assert findings[0].scenario == "dragging_precursor"
    assert "ground-level" in findings[0].explanation.lower()


def test_behaviour_solo_heavy_handling_detected():
    # Exactly one worker near a moving HEAVY box
    frames = []
    for i in range(6):
        t = float(i) * 0.3
        p = make_entity("vid:p1", 100, 100, 200, 300, EntityClass.PERSON, timestamp=t)
        # Displacement: 5 * 30 = 150 px / 1280 = 0.117 > 0.08
        b = make_entity("vid:b1", 150 + i * 30, 100, 250 + i * 30, 200, EntityClass.BOX, timestamp=t)
        frames.append(make_frame_result(t, [p, b]))

    metadata = {"heavy_box": PRODUCT_CATALOG["heavy_overpack_box"]}
    findings = evaluate_behaviour(
        frames,
        frame_width=FRAME_W,
        frame_height=FRAME_H,
        timestamp=1.5,
        config=RiskConfig(behaviour_min_common_samples=4),
        product_metadata_by_id=metadata,
    )
    assert len(findings) == 1
    assert findings[0].scenario == "solo_heavy_handling"
    assert "heavy" in findings[0].explanation.lower()


def test_behaviour_stepping_on_carton_precursor():
    # Worker position is vertically above box in image-space with tight horizontal alignment
    frames = []
    for i in range(6):
        t = float(i) * 0.3
        # Person at x=400..500, y=260..440 (center y = 350)
        p = make_entity("vid:p1", 400, 260, 500, 440, EntityClass.PERSON, timestamp=t)
        # Box directly underneath person at x=410..490, y=420..520 (center y = 470)
        # Center distance: |470 - 350| / 720 = 0.166 <= 0.20
        b = make_entity("vid:b1", 410, 420, 490, 520, EntityClass.BOX, timestamp=t)
        frames.append(make_frame_result(t, [p, b]))

    findings = evaluate_behaviour(
        frames,
        frame_width=FRAME_W,
        frame_height=FRAME_H,
        timestamp=1.5,
        config=RiskConfig(behaviour_proximity_threshold=0.20, behaviour_min_common_samples=4),
    )
    assert len(findings) == 1
    assert findings[0].scenario == "stepping_on_carton_precursor"
    assert "stepping" in findings[0].explanation.lower()


# ---------------------------------------------------------------------------
# Safe Action Planner Mappings
# ---------------------------------------------------------------------------

def test_planner_action_mappings_exist_for_all_phase6_scenarios():
    scenarios = [
        "dropping_or_throwing_precursor",
        "dragging_precursor",
        "stepping_on_carton_precursor",
        "solo_heavy_handling",
        "heavy_on_light_stacking",
        "pallet_overhang",
        "box_overhang",
        "unsupported_bending_placement",
        "wrong_product_orientation",
        "entity_in_dock_edge_zone",
        "entity_in_wet_floor_zone",
    ]
    for sc in scenarios:
        action_supported = recommended_action(sc, FindingStatus.SUPPORTED)
        action_probable = recommended_action(sc, FindingStatus.PROBABLE)
        assert action_supported is not None, f"Missing action for {sc} (SUPPORTED)"
        assert action_probable is not None, f"Missing action for {sc} (PROBABLE)"
        assert "Immediate precaution:" in action_supported
        assert "Verification required:" in action_probable
