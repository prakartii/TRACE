"""Phase A: Complete 14-Scenario Intelligence Coverage Tests.

Tests all 14 operational scenarios defined in ARCHITECTURE.md:
 1. heavy-on-light stacking (Structural)
 2. throwing/dropping (Behaviour)
 3. dragging instead of lifting (Behaviour)
 4. rolling cartons/cylindrical cargo (Behaviour)
 5. packaging straps used as handles (Behaviour)
 6. stepping on cartons (Behaviour & Structural)
 7. wrong product orientation (Conformance)
 8. pallet overhang (Structural)
 9. dock/vehicle gap (Environmental)
10. wet-floor handling (Environmental)
11. improper/unplanned loading sequence (Conformance)
12. solo handling of heavy item (Behaviour)
13. wrong equipment usage (Conformance)
14. unsupported/bending product placement (Structural)

Guarantees epistemic discipline:
- Never asserts unmeasured 3D metric velocity, ground reaction force, or strain
- Explicitly tests evidence dictionaries, deterministic risk bands, and recommended actions
- Distinguishes OBSERVED, INFERRED, PREDICTED, and VERIFIED epistemic levels
- Correctly reports INSUFFICIENT_EVIDENCE or UNSUPPORTED for unlinked/OOV conditions
"""

import pytest

from backend.contracts.models import (
    BoundingBox,
    ConfidenceLevel,
    Entity,
    EntityClass,
    EpistemicLevel,
    FindingStatus,
    Fragility,
    MassClass,
    PerceptionFrameResult,
    ProductMetadata,
    RiskBand,
    RiskEvent,
    RiskLens,
    SceneGraphEdge,
    SceneGraphEdgeType,
    SceneGraphNode,
    SceneGraphSnapshot,
)
from backend.behaviour.lens import evaluate_behaviour
from backend.lenses.conformance import (
    LOADING_SEQUENCE_RULE,
    ORIENTATION_RULE,
    STANDARD_CONFORMANCE_RULES,
    WRONG_EQUIPMENT_RULE,
    evaluate_conformance,
)
from backend.lenses.environmental import (
    EnvironmentalZone,
    ZoneType,
    evaluate_environmental,
)
from backend.lenses.structural import evaluate_structural
from backend.planner.actions import plan_action, recommended_action
from backend.risk.config import RiskConfig
from backend.world_model.manifest import (
    OperationalManifest,
    PRODUCT_CATALOG,
    get_manifest_for_source,
)
from backend.world_model.scene_graph import WorldModel

FRAME_W = 1280
FRAME_H = 720


def _make_entity(
    entity_id: str,
    cls: EntityClass,
    x1: float,
    y1: float,
    x2: float,
    y2: float,
    confidence: float = 0.90,
    timestamp: float = 0.0,
) -> Entity:
    return Entity(
        id=entity_id,
        track_id=entity_id,
        entity_class=cls,
        bbox=BoundingBox(x1=x1, y1=y1, x2=x2, y2=y2),
        confidence=confidence,
        timestamp=timestamp,
    )


def _make_frame_result(source_id: str, timestamp: float, entities: list[Entity]) -> PerceptionFrameResult:
    return PerceptionFrameResult(
        source_id=source_id,
        timestamp=timestamp,
        entities=entities,
    )


# ==============================================================================
# Scenario 1: Heavy-on-Light Stacking (Structural)
# ==============================================================================
def test_scenario_1_heavy_on_light_stacking():
    """Heavy item resting on light item triggers heavy_on_light_stacking with HIGH risk band."""
    light_meta = ProductMetadata(
        product_id="light_pkg", class_name="box", mass_class=MassClass.LIGHT, fragility=Fragility.LOW
    )
    heavy_meta = ProductMetadata(
        product_id="heavy_pkg", class_name="box", mass_class=MassClass.HEAVY, fragility=Fragility.MEDIUM
    )
    catalog = {"light_pkg": light_meta, "heavy_pkg": heavy_meta}

    supporter = SceneGraphNode(
        entity_id="base_box",
        entity_class=EntityClass.BOX,
        position=(0.5, 0.7),
        footprint=BoundingBox(x1=0.35, y1=0.60, x2=0.65, y2=0.80),
        product_id="light_pkg",
    )
    supported = SceneGraphNode(
        entity_id="top_box",
        entity_class=EntityClass.BOX,
        position=(0.5, 0.5),
        footprint=BoundingBox(x1=0.35, y1=0.40, x2=0.65, y2=0.60),
        product_id="heavy_pkg",
    )
    edge = SceneGraphEdge(
        source_id="base_box",
        target_id="top_box",
        edge_type=SceneGraphEdgeType.SUPPORT,
        weight=1.0,
        evidence={"vertical_gap": 0.0, "horizontal_overlap_ratio": 1.0},
    )
    snapshot = SceneGraphSnapshot(timestamp=1.0, nodes=[supporter, supported], edges=[edge])
    entity_conf = {"base_box": 0.90, "top_box": 0.90}

    findings = evaluate_structural(
        snapshot,
        entity_confidence=entity_conf,
        product_metadata_by_id=catalog,
    )

    f = next((x for x in findings if x.scenario == "heavy_on_light_stacking"), None)
    assert f is not None
    assert f.status == FindingStatus.PROBABLE
    assert f.band == RiskBand.HIGH
    assert f.epistemic_level == EpistemicLevel.INFERRED
    assert "Reverse-mass stacking" in f.explanation
    assert f.recommended_action is not None
    assert "Reorder stack with heavier cartons at base" in f.recommended_action
    assert f.evidence["supporter_class"] == "box"
    assert f.evidence["supported_class"] == "box"


# ==============================================================================
# Scenario 2: Throwing / Dropping (Behaviour)
# ==============================================================================
def test_scenario_2_throwing_or_dropping():
    """Rapid downward velocity spike triggers dropping_or_throwing_precursor with HIGH risk band."""
    frames = []
    # Worker stands nearby while carton drops rapidly (dy = 0.35 in 1.2s -> speed > 0.25 norm/s)
    for i in range(5):
        t = i * 0.30
        p = _make_entity("p1", EntityClass.PERSON, 100, 200, 250, 650, confidence=0.95, timestamp=t)
        b = _make_entity("b1", EntityClass.BOX, 300, 100 + i * 80, 450, 200 + i * 80, confidence=0.85, timestamp=t)
        frames.append(_make_frame_result("src", t, [p, b]))

    findings = evaluate_behaviour(
        frames,
        frame_width=FRAME_W,
        frame_height=FRAME_H,
        timestamp=1.2,
        config=RiskConfig(behaviour_min_common_samples=3),
    )

    f = next((x for x in findings if x.scenario == "dropping_or_throwing_precursor"), None)
    assert f is not None
    assert f.status == FindingStatus.PROBABLE
    assert f.band == RiskBand.HIGH
    assert f.epistemic_level == EpistemicLevel.INFERRED
    assert f.recommended_action is not None
    assert "controlled two-handed lowering" in f.recommended_action
    assert f.evidence["dy_net"] > 0.08
    assert "no_pose_signal" in f.limitations or "2D image-space velocity only" in str(f.limitations)


# ==============================================================================
# Scenario 3: Dragging Instead of Lifting (Behaviour)
# ==============================================================================
def test_scenario_3_dragging_instead_of_lifting():
    """Sustained ground-level translation without transport equipment triggers dragging_precursor."""
    frames = []
    # Worker translates carton horizontally across floor plane (y >= 0.50)
    for i in range(5):
        t = i * 0.30
        p = _make_entity("p1", EntityClass.PERSON, 100 + i * 50, 300, 200 + i * 50, 700, confidence=0.92, timestamp=t)
        b = _make_entity("b1", EntityClass.BOX, 150 + i * 50, 500, 250 + i * 50, 650, confidence=0.88, timestamp=t)
        frames.append(_make_frame_result("src", t, [p, b]))

    findings = evaluate_behaviour(
        frames,
        frame_width=FRAME_W,
        frame_height=FRAME_H,
        timestamp=1.2,
        config=RiskConfig(behaviour_min_common_samples=3),
    )

    f = next((x for x in findings if x.scenario == "dragging_precursor"), None)
    assert f is not None
    assert f.status == FindingStatus.PROBABLE
    assert f.band == RiskBand.MEDIUM
    assert f.epistemic_level == EpistemicLevel.INFERRED
    assert f.recommended_action is not None
    assert "pallet jack or team lift" in f.recommended_action
    assert f.evidence["ground_sliding_verified"] is True or f.evidence["horizontal_ratio"] >= 0.65


# ==============================================================================
# Scenario 4: Rolling Cartons / Cylindrical Cargo (Behaviour)
# ==============================================================================
def test_scenario_4_rolling_cargo():
    """Translating package with aspect-ratio alternation triggers rolling_precursor."""
    frames = []
    # Alternating dimensions (tumbling/rolling) while translating horizontally
    dims = [(100, 50), (50, 100), (100, 50), (50, 100)]
    for i, (w, h) in enumerate(dims):
        t = i * 0.30
        p = _make_entity("p1", EntityClass.PERSON, 50 + i * 30, 250, 150 + i * 30, 650, confidence=0.90, timestamp=t)
        b = _make_entity("b1", EntityClass.BOX, 100 + i * 60, 450, 100 + i * 60 + w, 450 + h, confidence=0.85, timestamp=t)
        frames.append(_make_frame_result("src", t, [p, b]))

    findings = evaluate_behaviour(
        frames,
        frame_width=FRAME_W,
        frame_height=FRAME_H,
        timestamp=0.9,
        config=RiskConfig(behaviour_min_common_samples=3),
    )

    f = next((x for x in findings if x.scenario == "rolling_precursor"), None)
    assert f is not None
    assert f.status == FindingStatus.PROBABLE
    assert f.band == RiskBand.MEDIUM
    assert f.epistemic_level == EpistemicLevel.INFERRED
    assert f.recommended_action is not None
    assert "controlled physical hold" in f.recommended_action
    assert f.evidence["aspect_oscillation_count"] >= 1 or f.evidence["aspect_ratio_range"] >= 0.25


# ==============================================================================
# Scenario 5: Packaging Straps Used as Handles (Behaviour)
# ==============================================================================
def test_scenario_5_straps_as_handles():
    """Upper-perimeter grip hypothesis without base support triggers straps_as_handles with OBSERVED status."""
    frames = []
    # Worker stands on floor with hands holding top edge of lifted box, no lower base support
    for i in range(4):
        t = i * 0.30
        p = _make_entity("p1", EntityClass.PERSON, 200, 144, 400, 612, confidence=0.95, timestamp=t)
        b = _make_entity("b1", EntityClass.BOX, 250, 300 - i * 15, 450, 480 - i * 15, confidence=0.85, timestamp=t)
        frames.append(_make_frame_result("src", t, [p, b]))

    findings = evaluate_behaviour(
        frames,
        frame_width=FRAME_W,
        frame_height=FRAME_H,
        timestamp=0.9,
        config=RiskConfig(behaviour_min_common_samples=3),
    )

    f = next((x for x in findings if x.scenario == "straps_as_handles"), None)
    assert f is not None
    assert f.status == FindingStatus.PROBABLE
    assert f.epistemic_level == EpistemicLevel.OBSERVED
    assert f.recommended_action is not None
    assert "never lift or carry items by packaging straps" in f.recommended_action
    assert "straps_are_subpixel" in f.limitations
    assert "not_predictable_in_advance" in f.limitations


# ==============================================================================
# Scenario 6: Stepping on Cartons (Behaviour & Structural)
# ==============================================================================
def test_scenario_6_stepping_on_cartons_behaviour_and_structural():
    """Worker elevated with feet on carton upper boundary triggers stepping_on_carton."""
    frames = []
    for i in range(4):
        t = i * 0.30
        p = _make_entity("p1", EntityClass.PERSON, 300, 100, 450, 360, confidence=0.95, timestamp=t)
        b = _make_entity("b1", EntityClass.BOX, 280, 360, 480, 560, confidence=0.88, timestamp=t)
        frames.append(_make_frame_result("src", t, [p, b]))

    findings = evaluate_behaviour(
        frames,
        frame_width=FRAME_W,
        frame_height=FRAME_H,
        timestamp=0.9,
        config=RiskConfig(behaviour_min_common_samples=3),
    )

    f = next((x for x in findings if x.scenario == "stepping_on_carton_precursor"), None)
    assert f is not None
    assert f.status == FindingStatus.PROBABLE
    assert f.band == RiskBand.HIGH
    assert f.epistemic_level == EpistemicLevel.INFERRED
    assert f.recommended_action is not None
    assert "Step off cartons immediately" in f.recommended_action


# ==============================================================================
# Scenario 7: Wrong Product Orientation (Conformance)
# ==============================================================================
def test_scenario_7_wrong_product_orientation():
    """Product specifying vertical (upright) orientation placed horizontally triggers wrong_product_orientation."""
    node = SceneGraphNode(
        entity_id="cupboard_node",
        entity_class=EntityClass.BOX,
        position=(0.5, 0.5),
        footprint=BoundingBox(x1=0.20, y1=0.40, x2=0.80, y2=0.60),
        product_id="auradine_cupboard",
    )
    catalog = {"auradine_cupboard": PRODUCT_CATALOG["auradine_cupboard"]}

    findings = evaluate_conformance(
        [node],
        product_metadata_by_id=catalog,
        timestamp=1.0,
        rules=STANDARD_CONFORMANCE_RULES,
    )

    f = next((x for x in findings if x.scenario == "wrong_product_orientation"), None)
    assert f is not None
    assert f.status == FindingStatus.PROBABLE
    assert f.band == RiskBand.MEDIUM
    assert f.epistemic_level == EpistemicLevel.INFERRED
    assert f.recommended_action is not None
    assert "Rotate package to specified upright orientation" in f.recommended_action
    assert f.evidence["required_orientation"] == "vertical"


# ==============================================================================
# Scenario 8: Pallet Overhang (Structural)
# ==============================================================================
def test_scenario_8_pallet_overhang():
    """Carton overhanging pallet boundaries (0.50 <= overlap < 0.75) triggers pallet_overhang.
    Respects pallet detector reliability ceiling (0.15) -> honestly caps at INSUFFICIENT_EVIDENCE."""
    pallet = SceneGraphNode(
        entity_id="pallet_1",
        entity_class=EntityClass.PALLET,
        position=(0.5, 0.8),
        footprint=BoundingBox(x1=0.40, y1=0.75, x2=0.80, y2=0.85),
    )
    box = SceneGraphNode(
        entity_id="box_1",
        entity_class=EntityClass.BOX,
        position=(0.5, 0.6),
        footprint=BoundingBox(x1=0.20, y1=0.55, x2=0.60, y2=0.75),
    )
    edge = SceneGraphEdge(
        source_id="pallet_1",
        target_id="box_1",
        edge_type=SceneGraphEdgeType.SUPPORT,
        weight=0.8,
        evidence={"vertical_gap": 0.0, "horizontal_overlap_ratio": 0.65},
    )
    snapshot = SceneGraphSnapshot(timestamp=1.0, nodes=[pallet, box], edges=[edge])
    findings = evaluate_structural(
        snapshot,
        entity_confidence={"pallet_1": 0.80, "box_1": 0.90},
    )

    f = next((x for x in findings if x.scenario == "pallet_overhang"), None)
    assert f is not None
    assert f.band == RiskBand.MEDIUM
    assert f.status == FindingStatus.INSUFFICIENT_EVIDENCE
    assert f.epistemic_level == EpistemicLevel.INFERRED
    # INSUFFICIENT_EVIDENCE findings honestly refuse to recommend unverified placement
    act = plan_action(f.scenario, f.status, f.confidence)
    assert "Additional evidence is required" in act.action
    assert act.what_if_eligible is False

    # Box-on-box overhang (box reliability 0.50) reaches PROBABLE and has recommended action
    base_box = SceneGraphNode(
        entity_id="base_b",
        entity_class=EntityClass.BOX,
        position=(0.5, 0.8),
        footprint=BoundingBox(x1=0.40, y1=0.75, x2=0.80, y2=0.85),
    )
    edge_box = SceneGraphEdge(
        source_id="base_b",
        target_id="box_1",
        edge_type=SceneGraphEdgeType.SUPPORT,
        weight=0.8,
        evidence={"vertical_gap": 0.0, "horizontal_overlap_ratio": 0.65},
    )
    snap_box = SceneGraphSnapshot(timestamp=1.0, nodes=[base_box, box], edges=[edge_box])
    findings_box = evaluate_structural(snap_box, entity_confidence={"base_b": 0.95, "box_1": 0.95})
    f_box = next((x for x in findings_box if x.scenario == "box_overhang"), None)
    assert f_box is not None
    assert f_box.status == FindingStatus.PROBABLE
    assert f_box.recommended_action is not None
    assert "Align upper carton with supporting package edges" in f_box.recommended_action


# ==============================================================================
# Scenario 9: Dock / Vehicle Gap (Environmental)
# ==============================================================================
def test_scenario_9_dock_vehicle_gap():
    """Worker positioned inside calibrated dock threshold zone triggers entity_in_dock_edge_zone."""
    node = SceneGraphNode(
        entity_id="p1",
        entity_class=EntityClass.PERSON,
        position=(0.20, 0.65),
    )
    dock_zone = EnvironmentalZone(
        zone_id="dock_09_threshold_gap",
        zone_type=ZoneType.DOCK_EDGE,
        polygon=[(0.0, 0.50), (0.45, 0.45), (0.50, 0.85), (0.0, 0.90)],
        severity_multiplier=1.5,
    )
    findings = evaluate_environmental([node], timestamp=1.0, zones=[dock_zone])

    assert len(findings) == 1
    f = findings[0]
    assert f.scenario == "entity_in_dock_edge_zone"
    assert f.status == FindingStatus.SUPPORTED
    assert f.band == RiskBand.HIGH
    assert f.epistemic_level == EpistemicLevel.OBSERVED
    assert f.confidence == ConfidenceLevel.HIGH
    assert f.evidence["zone_type"] == "dock_edge"
    assert f.evidence["severity_multiplier"] == 1.5
    assert f.recommended_action is not None
    assert "Maintain safe clearance from dock edge" in f.recommended_action


# ==============================================================================
# Scenario 10: Wet-Floor Handling (Environmental)
# ==============================================================================
def test_scenario_10_wet_floor_handling():
    """Entity positioned inside calibrated wet-floor polygon triggers entity_in_wet_floor_zone."""
    node = SceneGraphNode(
        entity_id="p1",
        entity_class=EntityClass.PERSON,
        position=(0.40, 0.60),
    )
    wet_zone = EnvironmentalZone(
        zone_id="dock_08_wet_floor",
        zone_type=ZoneType.WET_FLOOR,
        polygon=[(0.10, 0.30), (0.70, 0.30), (0.70, 0.80), (0.10, 0.80)],
        severity_multiplier=1.3,
    )
    findings = evaluate_environmental([node], timestamp=1.0, zones=[wet_zone])

    assert len(findings) == 1
    f = findings[0]
    assert f.scenario == "entity_in_wet_floor_zone"
    assert f.status == FindingStatus.SUPPORTED
    assert f.band == RiskBand.MEDIUM
    assert f.epistemic_level == EpistemicLevel.OBSERVED
    assert f.confidence == ConfidenceLevel.HIGH
    assert f.evidence["zone_type"] == "wet_floor"
    assert f.evidence["severity_multiplier"] == 1.3
    assert f.recommended_action is not None
    assert "Exercise extreme caution on wet surface" in f.recommended_action

    manifest = get_manifest_for_source("src_wf", "Rolling and dragging on wet floor.mp4")
    assert manifest is not None
    assert any(z.zone_type == ZoneType.WET_FLOOR for z in manifest.environmental_zones)


# ==============================================================================
# Scenario 11: Improper / Unplanned Loading Sequence (Conformance)
# ==============================================================================
def test_scenario_11_improper_loading_sequence():
    """Inverted sequence staging (stage #2 placed beneath stage #1) triggers unplanned_loading_sequence."""
    meta_early = ProductMetadata(
        product_id="foundation_carton", class_name="box", mass_class=MassClass.HEAVY, fragility=Fragility.LOW, loading_sequence=1
    )
    meta_late = ProductMetadata(
        product_id="top_carton", class_name="box", mass_class=MassClass.LIGHT, fragility=Fragility.LOW, loading_sequence=2
    )
    catalog = {"foundation_carton": meta_early, "top_carton": meta_late}

    base_node = SceneGraphNode(
        entity_id="base_box",
        entity_class=EntityClass.BOX,
        position=(0.5, 0.70),
        footprint=BoundingBox(x1=0.35, y1=0.60, x2=0.65, y2=0.80),
        product_id="top_carton",
    )
    top_node = SceneGraphNode(
        entity_id="top_box",
        entity_class=EntityClass.BOX,
        position=(0.5, 0.50),
        footprint=BoundingBox(x1=0.35, y1=0.40, x2=0.65, y2=0.60),
        product_id="foundation_carton",
    )

    findings = evaluate_conformance(
        [base_node, top_node],
        product_metadata_by_id=catalog,
        timestamp=1.0,
        rules=[LOADING_SEQUENCE_RULE],
    )

    f = next((x for x in findings if x.scenario == "unplanned_loading_sequence"), None)
    assert f is not None
    assert f.status == FindingStatus.PROBABLE
    assert f.band == RiskBand.HIGH
    assert f.epistemic_level == EpistemicLevel.INFERRED
    assert f.recommended_action is not None
    assert "Verify order of staging against operational dispatch manifest sequence" in f.recommended_action
    assert f.evidence["loading_sequence"] == 2
    assert f.evidence["conflict_sequence"] == 1


def test_scenario_11_compliant_sequence_passes():
    """Compliant loading sequence (stage #1 at base, stage #2 on top) passes without violation."""
    meta_early = ProductMetadata(
        product_id="foundation_carton", class_name="box", mass_class=MassClass.HEAVY, fragility=Fragility.LOW, loading_sequence=1
    )
    meta_late = ProductMetadata(
        product_id="top_carton", class_name="box", mass_class=MassClass.LIGHT, fragility=Fragility.LOW, loading_sequence=2
    )
    catalog = {"foundation_carton": meta_early, "top_carton": meta_late}

    base_node = SceneGraphNode(
        entity_id="base_box",
        entity_class=EntityClass.BOX,
        position=(0.5, 0.70),
        footprint=BoundingBox(x1=0.35, y1=0.60, x2=0.65, y2=0.80),
        product_id="foundation_carton",
    )
    top_node = SceneGraphNode(
        entity_id="top_box",
        entity_class=EntityClass.BOX,
        position=(0.5, 0.50),
        footprint=BoundingBox(x1=0.35, y1=0.40, x2=0.65, y2=0.60),
        product_id="top_carton",
    )

    findings = evaluate_conformance(
        [base_node, top_node],
        product_metadata_by_id=catalog,
        timestamp=1.0,
        rules=[LOADING_SEQUENCE_RULE],
    )
    assert all(x.scenario != "unplanned_loading_sequence" for x in findings)


# ==============================================================================
# Scenario 12: Solo Handling of Heavy Item (Behaviour)
# ==============================================================================
def test_scenario_12_solo_heavy_handling():
    """Single worker manually translating heavy SKU triggers solo_heavy_handling."""
    meta = ProductMetadata(
        product_id="heavy_carton", class_name="box", mass_class=MassClass.HEAVY, fragility=Fragility.LOW
    )
    catalog = {"heavy_carton": meta}

    frames = []
    for i in range(5):
        t = i * 0.30
        p = _make_entity("p1", EntityClass.PERSON, 100, 200, 220, 600, confidence=0.95, timestamp=t)
        b = _make_entity("b1", EntityClass.BOX, 150 + i * 35, 350, 280 + i * 35, 500, confidence=0.90, timestamp=t)
        frames.append(_make_frame_result("src", t, [p, b]))

    findings = evaluate_behaviour(
        frames,
        frame_width=FRAME_W,
        frame_height=FRAME_H,
        timestamp=1.2,
        config=RiskConfig(behaviour_min_common_samples=3),
        product_metadata_by_id=catalog,
        default_product_id="heavy_carton",
    )

    f = next((x for x in findings if x.scenario == "solo_heavy_handling"), None)
    assert f is not None
    assert f.status == FindingStatus.PROBABLE
    assert f.band == RiskBand.HIGH
    assert f.epistemic_level == EpistemicLevel.INFERRED
    assert f.recommended_action is not None
    assert "Request team lift or use mechanical pallet jack" in f.recommended_action
    assert f.evidence["workers_handling_count"] == 1


# ==============================================================================
# Scenario 13: Wrong Equipment Usage (Conformance)
# ==============================================================================
def test_scenario_13_wrong_equipment_usage():
    """Product requiring trolley transported using pallet triggers wrong_equipment_usage."""
    meta = ProductMetadata(
        product_id="heavy_appliance",
        class_name="box",
        mass_class=MassClass.HEAVY,
        fragility=Fragility.MEDIUM,
        allowed_equipment=["trolley"],
    )
    catalog = {"heavy_appliance": meta}

    pallet_node = SceneGraphNode(
        entity_id="pallet_1",
        entity_class=EntityClass.PALLET,
        position=(0.5, 0.75),
        footprint=BoundingBox(x1=0.30, y1=0.70, x2=0.70, y2=0.80),
    )
    cargo_node = SceneGraphNode(
        entity_id="cargo_1",
        entity_class=EntityClass.BOX,
        position=(0.5, 0.60),
        footprint=BoundingBox(x1=0.35, y1=0.50, x2=0.65, y2=0.70),
        product_id="heavy_appliance",
    )

    findings = evaluate_conformance(
        [cargo_node, pallet_node],
        product_metadata_by_id=catalog,
        timestamp=1.0,
        rules=[WRONG_EQUIPMENT_RULE],
    )

    f = next((x for x in findings if x.scenario == "wrong_equipment_usage"), None)
    assert f is not None
    assert f.status == FindingStatus.PROBABLE
    assert f.band == RiskBand.MEDIUM
    assert f.epistemic_level == EpistemicLevel.INFERRED
    assert f.recommended_action is not None
    assert "Use certified material handling equipment" in f.recommended_action
    assert f.evidence["observed_equipment"] == "pallet"


def test_scenario_13_out_of_vocabulary_equipment_is_unsupported():
    """Product requiring forklift (OOV class) honestly returns UNSUPPORTED with clear limitation."""
    meta = ProductMetadata(
        product_id="steel_crate",
        class_name="box",
        mass_class=MassClass.HEAVY,
        fragility=Fragility.LOW,
        allowed_equipment=["forklift"],
    )
    catalog = {"steel_crate": meta}

    cargo_node = SceneGraphNode(
        entity_id="cargo_1",
        entity_class=EntityClass.BOX,
        position=(0.5, 0.60),
        footprint=BoundingBox(x1=0.35, y1=0.50, x2=0.65, y2=0.70),
        product_id="steel_crate",
    )

    findings = evaluate_conformance(
        [cargo_node],
        product_metadata_by_id=catalog,
        timestamp=1.0,
        rules=[WRONG_EQUIPMENT_RULE],
    )

    f = next((x for x in findings if x.scenario == "wrong_equipment_usage"), None)
    assert f is not None
    assert f.status == FindingStatus.UNSUPPORTED
    assert f.band == RiskBand.LOW
    assert "Forklift and pallet jack class taxonomy is unmapped" in str(f.limitations)


# ==============================================================================
# Scenario 14: Unsupported / Bending Placement (Structural)
# ==============================================================================
def test_scenario_14_unsupported_bending_placement():
    """Severe cantilever overhang (< 50% horizontal support) triggers unsupported_bending_placement."""
    base_box = SceneGraphNode(
        entity_id="base_box",
        entity_class=EntityClass.BOX,
        position=(0.5, 0.70),
        footprint=BoundingBox(x1=0.40, y1=0.60, x2=0.80, y2=0.80),
    )
    overhang_box = SceneGraphNode(
        entity_id="top_box",
        entity_class=EntityClass.BOX,
        position=(0.3, 0.50),
        footprint=BoundingBox(x1=0.10, y1=0.40, x2=0.50, y2=0.60),
    )
    edge = SceneGraphEdge(
        source_id="base_box",
        target_id="top_box",
        edge_type=SceneGraphEdgeType.SUPPORT,
        weight=0.6,
        evidence={"vertical_gap": 0.0, "horizontal_overlap_ratio": 0.25},
    )
    snapshot = SceneGraphSnapshot(timestamp=1.0, nodes=[base_box, overhang_box], edges=[edge])
    findings = evaluate_structural(
        snapshot,
        entity_confidence={"base_box": 0.90, "top_box": 0.90},
    )

    f = next((x for x in findings if x.scenario == "unsupported_bending_placement"), None)
    assert f is not None
    assert f.status == FindingStatus.PROBABLE
    assert f.band == RiskBand.HIGH
    assert f.epistemic_level == EpistemicLevel.INFERRED
    assert f.recommended_action is not None
    assert "Ensure at least 75% base support" in f.recommended_action

