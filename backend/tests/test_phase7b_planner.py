"""Unit tests for Phase 7B Safe Action Planner, Stability Scoring, and What-If Simulation.

Covers:
- Action recommendations across all evidence states (SUPPORTED, PROBABLE, INSUFFICIENT_EVIDENCE, UNSUPPORTED)
- Deterministic stability score formula & component breakdowns
- Heavy-on-light, overhang, and orientation candidate generation
- Feasibility constraints & collision rejection
- What-If simulation isolation (no mutation of world model)
- Supervisor configuration validation
"""

import pytest
from fastapi.testclient import TestClient

from backend.contracts.models import (
    BoundingBox,
    ConfidenceLevel,
    EntityClass,
    EnvironmentalZoneConfig,
    FindingStatus,
    Fragility,
    MassClass,
    ProductMetadata,
    ProductMetadataCreate,
    RiskBand,
    RiskEvent,
    RiskLens,
    SceneGraphEdge,
    SceneGraphEdgeType,
    SceneGraphNode,
    SceneGraphSnapshot,
)
from backend.main import app
from backend.planner.actions import plan_action, recommended_action
from backend.planner.generator import generate_placement_candidates
from backend.planner.simulation import run_what_if_simulation
from backend.planner.stability import (
    classify_stability,
    compute_stability_score,
)
from backend.world_model.manifest import PRODUCT_CATALOG

client = TestClient(app)


# ==============================================================================
# 1. Planner Actions & Epistemic Rules (Section 5 & 6)
# ==============================================================================

def test_plan_action_supported_gives_direct_precaution():
    rec = plan_action(
        scenario="heavy_on_light_stacking",
        status=FindingStatus.SUPPORTED,
        confidence=ConfidenceLevel.HIGH,
    )
    assert rec.action.startswith("Immediate precaution:")
    assert "heavier carton" in rec.action.lower()
    assert rec.what_if_eligible is True
    assert len(rec.limitations) > 0


def test_plan_action_probable_requires_verification_note():
    rec = plan_action(
        scenario="box_overhang",
        status=FindingStatus.PROBABLE,
        confidence=ConfidenceLevel.MEDIUM,
    )
    assert rec.action.startswith("Verification required:")
    assert "Verification required" in rec.rationale or "Probable evidence" in rec.rationale
    assert rec.what_if_eligible is True


def test_plan_action_insufficient_evidence_refuses_corrective_instruction():
    rec = plan_action(
        scenario="person_box_handling",
        status=FindingStatus.INSUFFICIENT_EVIDENCE,
        confidence=ConfidenceLevel.LOW,
    )
    assert rec.action == "Additional evidence is required before recommending a corrective placement."
    assert rec.what_if_eligible is False
    assert len(rec.alternative_actions) == 0


def test_plan_action_unsupported_refuses_action():
    rec = plan_action(
        scenario="unplanned_loading_sequence",
        status=FindingStatus.UNSUPPORTED,
        confidence=ConfidenceLevel.LOW,
    )
    assert rec.action == "TRACE cannot safely determine this condition from available evidence."
    assert rec.what_if_eligible is False


def test_recommended_action_backwards_compatibility():
    assert recommended_action("heavy_on_light_stacking", FindingStatus.SUPPORTED).startswith("Immediate precaution:")
    assert recommended_action("heavy_on_light_stacking", FindingStatus.PROBABLE).startswith("Verification required:")
    assert recommended_action("heavy_on_light_stacking", FindingStatus.INSUFFICIENT_EVIDENCE) is None
    assert recommended_action("heavy_on_light_stacking", FindingStatus.UNSUPPORTED) is None


# ==============================================================================
# 2. Stability Scoring Engine (Section 8 & 9)
# ==============================================================================

def test_stability_score_full_overlap_centered():
    target = BoundingBox(x1=0.3, y1=0.4, x2=0.5, y2=0.6)
    support = BoundingBox(x1=0.3, y1=0.6, x2=0.5, y2=0.8)

    stab = compute_stability_score(target, support)
    assert stab.breakdown.support_alignment == 100.0
    assert stab.breakdown.centering == 100.0
    assert stab.breakdown.overhang_penalty == 0.0
    assert stab.score >= 80.0
    assert stab.classification == "high_geometric_support"


def test_stability_score_severe_overhang():
    # Target hangs 75% over the right side of support
    target = BoundingBox(x1=0.45, y1=0.4, x2=0.65, y2=0.6)
    support = BoundingBox(x1=0.3, y1=0.6, x2=0.5, y2=0.8)

    stab = compute_stability_score(target, support)
    assert stab.breakdown.support_alignment < 50.0
    assert stab.breakdown.overhang_penalty > 50.0
    assert stab.score < 50.0
    assert stab.classification in ("weak_geometric_support", "poor_geometric_support")


def test_stability_score_mass_ordering_impact():
    target = BoundingBox(x1=0.3, y1=0.4, x2=0.5, y2=0.6)
    support = BoundingBox(x1=0.3, y1=0.6, x2=0.5, y2=0.8)

    heavy_prod = ProductMetadata(
        product_id="heavy",
        class_name="carton",
        mass_class=MassClass.HEAVY,
        fragility=Fragility.LOW,
    )
    light_prod = ProductMetadata(
        product_id="light",
        class_name="carton",
        mass_class=MassClass.LIGHT,
        fragility=Fragility.LOW,
    )

    # Heavy on light (crushing hazard)
    stab_bad = compute_stability_score(target, support, target_product=heavy_prod, support_product=light_prod)
    # Light on heavy (ideal)
    stab_good = compute_stability_score(target, support, target_product=light_prod, support_product=heavy_prod)

    assert stab_bad.breakdown.mass_order == 0.0
    assert stab_good.breakdown.mass_order == 100.0
    assert stab_good.score > stab_bad.score + 15.0


def test_stability_score_base_tier_ground_placement():
    target = BoundingBox(x1=0.2, y1=0.7, x2=0.4, y2=0.88)
    stab = compute_stability_score(target, None, is_base_tier=True)

    assert stab.breakdown.support_alignment == 100.0
    assert stab.breakdown.centering == 100.0
    assert stab.breakdown.overhang_penalty == 0.0
    assert stab.breakdown.tipping_estimate == 0.0  # nothing to tip off at floor level
    assert stab.score >= 80.0


def test_tipping_estimate_scales_with_mass_and_cog_offset():
    """ARCHITECTURE.md §5.1 — tipping-moment estimate = ordinal mass weight x
    normalized COG offset. Reported for explainability; it does not change the
    final score (which already docks the same COG offset via `centering`)."""
    support = BoundingBox(x1=0.30, y1=0.60, x2=0.50, y2=0.80)
    centered = BoundingBox(x1=0.30, y1=0.40, x2=0.50, y2=0.60)      # COG offset 0
    off_centre = BoundingBox(x1=0.42, y1=0.40, x2=0.62, y2=0.60)    # COG well off support

    heavy = ProductMetadata(product_id="h", class_name="carton", mass_class=MassClass.HEAVY, fragility=Fragility.LOW)
    light = ProductMetadata(product_id="l", class_name="carton", mass_class=MassClass.LIGHT, fragility=Fragility.LOW)

    # Perfectly centred -> zero tipping tendency regardless of mass.
    assert compute_stability_score(centered, support, target_product=heavy).breakdown.tipping_estimate == 0.0

    # Same off-centre geometry: heavier item -> higher tipping estimate than lighter.
    tip_heavy = compute_stability_score(off_centre, support, target_product=heavy).breakdown.tipping_estimate
    tip_light = compute_stability_score(off_centre, support, target_product=light).breakdown.tipping_estimate
    assert tip_heavy > tip_light > 0.0

    # It is a reported diagnostic only — the score is unchanged by mass here
    # (mass_order needs a support_product; tipping_estimate is not a score term).
    s_heavy = compute_stability_score(off_centre, support, target_product=heavy).score
    s_none = compute_stability_score(off_centre, support).score
    assert s_heavy == s_none


# ==============================================================================
# 3. Candidate Generation (Section 10 & 11)
# ==============================================================================

def test_generate_candidates_heavy_on_light():
    target = SceneGraphNode(
        entity_id="box_heavy",
        entity_class=EntityClass.BOX,
        position=(0.4, 0.45),
        footprint=BoundingBox(x1=0.3, y1=0.35, x2=0.5, y2=0.55),
        product_id="heavy_sku",
    )
    support = SceneGraphNode(
        entity_id="box_light",
        entity_class=EntityClass.BOX,
        position=(0.4, 0.65),
        footprint=BoundingBox(x1=0.3, y1=0.55, x2=0.5, y2=0.75),
        product_id="light_sku",
    )
    snapshot = SceneGraphSnapshot(timestamp=1.0, nodes=[target, support], edges=[])

    meta = {
        "heavy_sku": ProductMetadata(
            product_id="heavy_sku",
            class_name="heavy",
            mass_class=MassClass.HEAVY,
            fragility=Fragility.LOW,
        ),
        "light_sku": ProductMetadata(
            product_id="light_sku",
            class_name="light",
            mass_class=MassClass.LIGHT,
            fragility=Fragility.LOW,
        ),
    }

    candidates = generate_placement_candidates(
        target,
        support,
        snapshot,
        scenario_key="heavy_on_light_stacking",
        product_metadata_by_id=meta,
        current_score=40.0,
    )

    assert len(candidates) >= 2
    # Candidates should be ranked descending by score
    scores = [c.score for c in candidates]
    assert scores == sorted(scores, reverse=True)
    # The best candidate should gain significant score
    assert candidates[0].score > 70.0
    assert candidates[0].score_delta > 0.0


def test_generate_candidates_pallet_overhang():
    target = SceneGraphNode(
        entity_id="box_overhanging",
        entity_class=EntityClass.BOX,
        position=(0.55, 0.45),
        footprint=BoundingBox(x1=0.45, y1=0.35, x2=0.65, y2=0.55),
    )
    pallet = SceneGraphNode(
        entity_id="pallet_base",
        entity_class=EntityClass.PALLET,
        position=(0.4, 0.65),
        footprint=BoundingBox(x1=0.3, y1=0.55, x2=0.5, y2=0.75),
    )
    snapshot = SceneGraphSnapshot(timestamp=1.0, nodes=[target, pallet], edges=[])

    candidates = generate_placement_candidates(
        target,
        pallet,
        snapshot,
        scenario_key="pallet_overhang",
        current_score=35.0,
    )

    assert len(candidates) >= 2
    # Centered candidate should have zero overhang penalty
    centered_cand = next(c for c in candidates if "center" in c.id)
    assert centered_cand.score_breakdown.overhang_penalty == 0.0
    assert centered_cand.score > 75.0


def test_generate_candidates_rejects_person_collision():
    target = SceneGraphNode(
        entity_id="box_1",
        entity_class=EntityClass.BOX,
        position=(0.4, 0.45),
        footprint=BoundingBox(x1=0.3, y1=0.35, x2=0.5, y2=0.55),
    )
    support = SceneGraphNode(
        entity_id="box_supp",
        entity_class=EntityClass.BOX,
        position=(0.4, 0.65),
        footprint=BoundingBox(x1=0.3, y1=0.55, x2=0.5, y2=0.75),
    )
    # Person standing right at the base tier candidate area
    person = SceneGraphNode(
        entity_id="person_1",
        entity_class=EntityClass.PERSON,
        position=(0.1, 0.8),
        footprint=BoundingBox(x1=0.01, y1=0.65, x2=0.25, y2=0.95),
    )
    snapshot = SceneGraphSnapshot(timestamp=1.0, nodes=[target, support, person], edges=[])

    candidates = generate_placement_candidates(
        target,
        support,
        snapshot,
        scenario_key="heavy_on_light_stacking",
        current_score=40.0,
    )

    base_cand = next((c for c in candidates if "base_tier" in c.id), None)
    if base_cand:
        # If candidate intersects person, it should fail hard constraints
        assert base_cand.hard_constraints_passed is False or "worker" in str(base_cand.limitations)


# ==============================================================================
# 4. What-If Simulation Engine (Section 12, 13, 16)
# ==============================================================================

def test_what_if_simulation_refuses_unsupported():
    finding = RiskEvent(
        timestamp=1.0,
        event_type="risk",
        lens=RiskLens.STRUCTURAL,
        entity_id="box_1",
        confidence=ConfidenceLevel.LOW,
        status=FindingStatus.UNSUPPORTED,
        scenario="unsupported_scenario",
    )
    snapshot = SceneGraphSnapshot(timestamp=1.0, nodes=[], edges=[])

    sim = run_what_if_simulation("vid1", snapshot, finding)
    assert sim.simulation_available is False
    assert "cannot safely determine" in sim.simulation_notice.lower()


def test_what_if_simulation_refuses_insufficient_evidence():
    finding = RiskEvent(
        timestamp=1.0,
        event_type="risk",
        lens=RiskLens.STRUCTURAL,
        entity_id="box_1",
        confidence=ConfidenceLevel.LOW,
        status=FindingStatus.INSUFFICIENT_EVIDENCE,
        scenario="image_space_support_hypothesis",
    )
    snapshot = SceneGraphSnapshot(timestamp=1.0, nodes=[], edges=[])

    sim = run_what_if_simulation("vid1", snapshot, finding)
    assert sim.simulation_available is False
    assert "insufficient" in sim.simulation_notice.lower()


def test_what_if_simulation_preserves_world_state_immutability():
    target = SceneGraphNode(
        entity_id="box_target",
        entity_class=EntityClass.BOX,
        position=(0.4, 0.45),
        footprint=BoundingBox(x1=0.3, y1=0.35, x2=0.5, y2=0.55),
    )
    support = SceneGraphNode(
        entity_id="box_supp",
        entity_class=EntityClass.BOX,
        position=(0.4, 0.65),
        footprint=BoundingBox(x1=0.3, y1=0.55, x2=0.5, y2=0.75),
    )
    snapshot = SceneGraphSnapshot(timestamp=1.0, nodes=[target, support], edges=[])
    original_target_fp = target.footprint.model_copy()

    finding = RiskEvent(
        timestamp=1.0,
        event_type="risk",
        lens=RiskLens.STRUCTURAL,
        entity_id="box_target",
        confidence=ConfidenceLevel.MEDIUM,
        status=FindingStatus.PROBABLE,
        scenario="box_overhang",
        entities=["box_supp", "box_target"],
    )

    sim = run_what_if_simulation("vid1", snapshot, finding)
    assert sim.simulation_available is True
    assert sim.current is not None
    assert len(sim.alternatives) > 0

    # Ensure snapshot was NEVER mutated
    assert target.footprint == original_target_fp
    assert snapshot.nodes[0].footprint == original_target_fp


# ==============================================================================
# 5. Supervisor Configuration API (Section 17 & 18)
# ==============================================================================

def test_supervisor_products_crud():
    # 1. List products
    res = client.get("/api/config/products")
    assert res.status_code == 200
    assert len(res.json()) >= 3

    # 2. Create valid product
    payload = {
        "product_id": "test_appliance_crate",
        "class_name": "appliance",
        "mass_class": "heavy",
        "fragility": "medium",
        "required_orientation": "vertical",
        "max_stack_height": 2,
    }
    create_res = client.post("/api/config/products", json=payload)
    assert create_res.status_code == 200
    assert create_res.json()["product_id"] == "test_appliance_crate"

    # 3. Reject invalid orientation
    bad_payload = {
        "product_id": "bad_sku",
        "class_name": "bad",
        "mass_class": "light",
        "required_orientation": "diagonal_invalid",
    }
    bad_res = client.post("/api/config/products", json=bad_payload)
    assert bad_res.status_code == 422


def test_supervisor_zones_validation():
    # 1. List zones
    res = client.get("/api/config/zones")
    assert res.status_code == 200

    # 2. Reject polygon with < 3 vertices
    bad_zone = {
        "zone_id": "bad_line",
        "zone_type": "dock_edge",
        "polygon": [[0.1, 0.1], [0.2, 0.2]],
    }
    bad_res = client.post("/api/config/zones", json=bad_zone)
    assert bad_res.status_code == 422

    # 3. Reject vertices outside [0, 1]
    oob_zone = {
        "zone_id": "out_of_bounds",
        "zone_type": "dock_edge",
        "polygon": [[0.1, 0.1], [0.2, 0.2], [1.5, 0.5]],
    }
    oob_res = client.post("/api/config/zones", json=oob_zone)
    assert oob_res.status_code == 422

    # 4. Accept valid zone
    good_zone = {
        "zone_id": "staging_bay_zone",
        "zone_type": "dock_edge",
        "polygon": [[0.1, 0.1], [0.3, 0.1], [0.3, 0.3], [0.1, 0.3]],
        "severity_multiplier": 1.2,
    }
    good_res = client.post("/api/config/zones", json=good_zone)
    assert good_res.status_code == 200
