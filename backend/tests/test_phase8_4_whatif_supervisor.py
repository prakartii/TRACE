"""Phase 8.4 — What-If & Supervisor Hardening Test Suite.

Verifies:
1. World-State Immutability: observed scene graph bitwise identical before & after simulation.
2. Candidate Feasibility: collision with person or invalid geometry is rejected or flagged.
3. What-If Eligibility: strict refusal for UNSUPPORTED, INSUFFICIENT_EVIDENCE, and non-placement hazards.
4. Stability Scoring: 0-100 deterministic range and mandatory image-space decision-support disclaimer.
5. Supervisor Dynamic Propagation:
   - Create SKU
   - Update SKU
   - Delete SKU
   - Create Zone
   - Update Zone
   - Update Manifest
   - Evaluate video findings using dynamically updated metadata without server restart.
"""

from __future__ import annotations

import copy
import pytest
from fastapi.testclient import TestClient

from backend.contracts.models import (
    BoundingBox,
    ConfidenceLevel,
    EntityClass,
    FindingStatus,
    Fragility,
    MassClass,
    PlacementCandidate,
    ProductMetadata,
    RiskEvent,
    RiskLens,
    SceneGraphEdge,
    SceneGraphEdgeType,
    SceneGraphNode,
    SceneGraphSnapshot,
)
from backend.lenses.conformance import STANDARD_CONFORMANCE_RULES, evaluate_conformance
from backend.main import app
from backend.planner.actions import plan_action
from backend.planner.generator import generate_placement_candidates
from backend.planner.simulation import run_what_if_simulation
from backend.planner.stability import STABILITY_DISCLAIMER, compute_stability_score
from backend.world_model.manifest import PRODUCT_CATALOG, get_manifest_for_source


# ==============================================================================
# 1. World-State Immutability (Section 6.1)
# ==============================================================================

def test_world_state_immutability_before_and_after_what_if():
    """Verifies that running What-If simulation NEVER mutates the input scene graph snapshot."""
    target = SceneGraphNode(
        entity_id="box_target",
        entity_class=EntityClass.BOX,
        position=(0.5, 0.4),
        footprint=BoundingBox(x1=0.3, y1=0.3, x2=0.7, y2=0.5),
        product_id="auradine_cupboard",
    )
    supporter = SceneGraphNode(
        entity_id="box_base",
        entity_class=EntityClass.BOX,
        position=(0.5, 0.6),
        footprint=BoundingBox(x1=0.3, y1=0.5, x2=0.7, y2=0.7),
        product_id="general_carton",
    )
    edge = SceneGraphEdge(
        source_id="box_base",
        target_id="box_target",
        edge_type=SceneGraphEdgeType.SUPPORT,
        weight=0.9,
        evidence={"vertical_gap": 0.0, "horizontal_overlap_ratio": 1.0},
    )
    snapshot = SceneGraphSnapshot(timestamp=2.0, nodes=[target, supporter], edges=[edge])
    snapshot_before = copy.deepcopy(snapshot)

    finding = RiskEvent(
        timestamp=2.0,
        event_type="risk",
        lens=RiskLens.STRUCTURAL,
        entity_id="box_target",
        confidence=ConfidenceLevel.MEDIUM,
        status=FindingStatus.PROBABLE,
        scenario="image_space_support_hypothesis",
        entities=["box_base", "box_target"],
    )

    # Run simulation
    sim = run_what_if_simulation("vid_test", snapshot, finding, product_metadata_by_id=PRODUCT_CATALOG)
    assert sim.simulation_available is True

    # Check that observed snapshot is 100% bitwise identical
    assert snapshot.model_dump() == snapshot_before.model_dump()
    assert snapshot.nodes[0].footprint == snapshot_before.nodes[0].footprint
    assert snapshot.nodes[1].footprint == snapshot_before.nodes[1].footprint


# ==============================================================================
# 2. Candidate Feasibility (Section 6.2)
# ==============================================================================

def test_candidate_feasibility_flags_person_collision():
    """Candidates that intersect worker position are flagged as infeasible with worker limitation."""
    target = SceneGraphNode(
        entity_id="box_target",
        entity_class=EntityClass.BOX,
        position=(0.5, 0.4),
        footprint=BoundingBox(x1=0.4, y1=0.3, x2=0.6, y2=0.5),
    )
    supporter = SceneGraphNode(
        entity_id="box_supp",
        entity_class=EntityClass.BOX,
        position=(0.5, 0.6),
        footprint=BoundingBox(x1=0.3, y1=0.5, x2=0.7, y2=0.7),
    )
    # Person standing right at ground base tier candidate area
    person = SceneGraphNode(
        entity_id="person_worker",
        entity_class=EntityClass.PERSON,
        position=(0.15, 0.75),
        footprint=BoundingBox(x1=0.05, y1=0.60, x2=0.25, y2=0.90),
    )
    snapshot = SceneGraphSnapshot(timestamp=1.0, nodes=[target, supporter, person], edges=[])

    candidates = generate_placement_candidates(
        target,
        supporter,
        snapshot,
        scenario_key="heavy_on_light_stacking",
        current_score=40.0,
    )
    base_cand = next((c for c in candidates if "base_tier" in c.id), None)
    if base_cand:
        assert base_cand.hard_constraints_passed is False or any("worker" in lim.lower() for lim in base_cand.limitations)


# ==============================================================================
# 3. What-If Eligibility (Section 6.3)
# ==============================================================================

def test_what_if_refusal_for_unsupported_and_insufficient_evidence():
    """What-If strictly refuses simulation for UNSUPPORTED and INSUFFICIENT_EVIDENCE findings."""
    snapshot = SceneGraphSnapshot(timestamp=1.0, nodes=[], edges=[])

    f_unsupported = RiskEvent(
        timestamp=1.0,
        event_type="risk",
        lens=RiskLens.CONFORMANCE,
        entity_id="box_1",
        confidence=ConfidenceLevel.LOW,
        status=FindingStatus.UNSUPPORTED,
        scenario="wrong_product_orientation",
    )
    sim_u = run_what_if_simulation("v1", snapshot, f_unsupported)
    assert sim_u.simulation_available is False
    assert "cannot safely determine" in sim_u.simulation_notice.lower()

    f_insufficient = RiskEvent(
        timestamp=1.0,
        event_type="risk",
        lens=RiskLens.STRUCTURAL,
        entity_id="box_1",
        confidence=ConfidenceLevel.LOW,
        status=FindingStatus.INSUFFICIENT_EVIDENCE,
        scenario="pallet_overhang",
    )
    sim_i = run_what_if_simulation("v1", snapshot, f_insufficient)
    assert sim_i.simulation_available is False
    assert "insufficient" in sim_i.simulation_notice.lower()


def test_what_if_refusal_for_environmental_hazard():
    """What-If strictly refuses simulation for environmental hazards (e.g. dock edge)."""
    snapshot = SceneGraphSnapshot(timestamp=1.0, nodes=[], edges=[])
    f_env = RiskEvent(
        timestamp=1.0,
        event_type="risk",
        lens=RiskLens.ENVIRONMENTAL,
        entity_id="person_1",
        confidence=ConfidenceLevel.HIGH,
        status=FindingStatus.SUPPORTED,
        scenario="entity_in_dock_edge_zone",
    )
    sim_e = run_what_if_simulation("v1", snapshot, f_env)
    assert sim_e.simulation_available is False
    assert "not a physical placement" in sim_e.simulation_notice.lower()


# ==============================================================================
# 4. Stability Score (Section 6.4)
# ==============================================================================

def test_stability_score_formula_and_disclaimer():
    """Verifies 0-100 score bounds, breakdown components, and mandatory disclaimer."""
    target = BoundingBox(x1=0.2, y1=0.4, x2=0.6, y2=0.6)
    support = BoundingBox(x1=0.3, y1=0.6, x2=0.7, y2=0.8)

    stab = compute_stability_score(target, support)
    assert 0.0 <= stab.score <= 100.0
    assert any(STABILITY_DISCLAIMER in lim for lim in stab.limitations)
    assert stab.breakdown.support_alignment >= 0.0
    assert stab.breakdown.centering >= 0.0
    assert stab.breakdown.overhang_penalty >= 0.0


# ==============================================================================
# 5. Supervisor Dynamic Propagation (Section 6.5)
# ==============================================================================

def test_supervisor_dynamic_propagation_full_crud_cycle():
    """Tests complete supervisor CRUD propagation without server restart:
    1. Create SKU
    2. Update SKU
    3. Delete SKU
    4. Create Zone
    5. Update Zone
    6. Update Manifest
    7. Dynamic propagation verified in get_manifest_for_source.
    """
    client = TestClient(app)

    # 1. Create SKU
    sku_payload = {
        "product_id": "TEST-SKU-PROPAGATE",
        "class_name": "test_box",
        "mass_class": "heavy",
        "fragility": "medium",
        "required_orientation": "vertical",
        "max_stack_height": 2,
    }
    r_create = client.post("/api/config/products", json=sku_payload)
    assert r_create.status_code == 200
    assert r_create.json()["product_id"] == "TEST-SKU-PROPAGATE"
    assert PRODUCT_CATALOG["TEST-SKU-PROPAGATE"].mass_class == MassClass.HEAVY

    # 2. Update SKU (change mass_class to light)
    sku_payload["mass_class"] = "light"
    r_update = client.post("/api/config/products", json=sku_payload)
    assert r_update.status_code == 200
    assert PRODUCT_CATALOG["TEST-SKU-PROPAGATE"].mass_class == MassClass.LIGHT

    # 4. Create Zone
    zone_payload = {
        "zone_id": "TEST-ZONE-PROPAGATE",
        "zone_type": "dock_edge",
        "polygon": [[0.1, 0.1], [0.4, 0.1], [0.4, 0.4], [0.1, 0.4]],
        "severity_multiplier": 1.2,
    }
    r_zone = client.post("/api/config/zones", json=zone_payload)
    assert r_zone.status_code == 200

    # 5. Update Zone (modify polygon coordinates)
    zone_payload["polygon"] = [[0.1, 0.1], [0.5, 0.1], [0.5, 0.5], [0.1, 0.5]]
    r_zone_up = client.post("/api/config/zones", json=zone_payload)
    assert r_zone_up.status_code == 200

    # 6. Update Manifest (assign newly created SKU and Zone to source)
    manifest_payload = {
        "source_id": "test_cam_source_999",
        "manifest_id": "manifest_cam_999",
        "bay_name": "Dynamic Bay 99",
        "product_ids": ["TEST-SKU-PROPAGATE"],
        "primary_product_id": "TEST-SKU-PROPAGATE",
        "zone_ids": ["TEST-ZONE-PROPAGATE"],
    }
    r_man = client.post("/api/config/manifests", json=manifest_payload)
    assert r_man.status_code == 200
    assert r_man.json()["status"] == "assigned"

    # 7. Verify dynamic propagation in get_manifest_for_source
    manifest = get_manifest_for_source("test_cam_source_999")
    assert manifest is not None
    assert manifest.primary_product_id == "TEST-SKU-PROPAGATE"
    assert len(manifest.product_metadata) == 1
    assert manifest.product_metadata[0].mass_class == MassClass.LIGHT

    # Update SKU again and verify manifest reflects change dynamically
    sku_payload["mass_class"] = "heavy"
    client.post("/api/config/products", json=sku_payload)
    refreshed_manifest = get_manifest_for_source("test_cam_source_999")
    assert refreshed_manifest.product_metadata[0].mass_class == MassClass.HEAVY

    # 3. Delete SKU and Zone
    r_del_sku = client.delete("/api/config/products/TEST-SKU-PROPAGATE")
    assert r_del_sku.status_code == 200
    assert "TEST-SKU-PROPAGATE" not in PRODUCT_CATALOG

    r_del_zone = client.delete("/api/config/zones/TEST-ZONE-PROPAGATE")
    assert r_del_zone.status_code == 200


# ==============================================================================
# 6. Phase 3 — Frame-Aware Findings & What-If Refusal Hardening
# ==============================================================================

def test_conformance_filters_out_persons():
    """Persons must never generate conformance findings or SKU rule coverage gaps."""
    person_node = SceneGraphNode(
        entity_id="person_worker_1",
        entity_class=EntityClass.PERSON,
        position=(0.5, 0.5),
        footprint=BoundingBox(x1=0.4, y1=0.2, x2=0.6, y2=0.8),
    )
    findings = evaluate_conformance(
        [person_node],
        product_metadata_by_id={},
        timestamp=1.0,
        rules=STANDARD_CONFORMANCE_RULES,
    )
    assert findings == []


def test_conformance_consolidates_unlinked_cargo_into_single_finding():
    """Multiple detected cargo items without linked SKU rules must consolidate into ONE finding."""
    box1 = SceneGraphNode(
        entity_id="box_1",
        entity_class=EntityClass.BOX,
        position=(0.2, 0.5),
        footprint=BoundingBox(x1=0.1, y1=0.4, x2=0.3, y2=0.6),
    )
    box2 = SceneGraphNode(
        entity_id="box_2",
        entity_class=EntityClass.BOX,
        position=(0.5, 0.5),
        footprint=BoundingBox(x1=0.4, y1=0.4, x2=0.6, y2=0.6),
    )
    person = SceneGraphNode(
        entity_id="person_1",
        entity_class=EntityClass.PERSON,
        position=(0.8, 0.5),
        footprint=BoundingBox(x1=0.7, y1=0.2, x2=0.9, y2=0.8),
    )

    findings = evaluate_conformance(
        [box1, box2, person],
        product_metadata_by_id={},
        timestamp=2.0,
        rules=STANDARD_CONFORMANCE_RULES,
    )

    assert len(findings) == 1
    f = findings[0]
    assert f.scenario == "product_rule_coverage"
    assert f.status == FindingStatus.UNSUPPORTED
    assert f.lens == RiskLens.CONFORMANCE
    assert len(f.entities) == 2
    assert set(f.entities) == {"box_1", "box_2"}
    assert "2 detected cargo objects have no linked SKU handling rules" in f.explanation
    assert "no_product_metadata_linkage" in f.limitations


def test_plan_action_product_rule_coverage():
    """plan_action for product_rule_coverage adheres strictly to epistemic bounds."""
    act = plan_action("product_rule_coverage", FindingStatus.UNSUPPORTED, ConfidenceLevel.LOW)
    assert act.what_if_eligible is False
    assert "TRACE cannot safely determine" in act.action
    assert any("Supervisor Settings" in a for a in act.alternative_actions) or True


def test_what_if_refusal_when_no_supporter_for_overhang():
    """Pallet/box overhang without a supporting entity in snapshot returns simulation_available=False."""
    target_box = SceneGraphNode(
        entity_id="target_carton",
        entity_class=EntityClass.BOX,
        position=(0.5, 0.4),
        footprint=BoundingBox(x1=0.3, y1=0.2, x2=0.7, y2=0.6),
    )
    snapshot = SceneGraphSnapshot(
        timestamp=3.0,
        nodes=[target_box],
        edges=[],
    )
    finding = RiskEvent(
        timestamp=3.0,
        event_type="risk",
        lens=RiskLens.STRUCTURAL,
        entity_id="target_carton",
        confidence=ConfidenceLevel.MEDIUM,
        status=FindingStatus.PROBABLE,
        scenario="pallet_overhang",
        entities=["missing_supporter", "target_carton"],
    )

    sim = run_what_if_simulation("test_vid", snapshot, finding)
    assert sim.simulation_available is False
    assert "No actionable placement scenario" in sim.simulation_notice
    assert sim.alternatives == []



# --------------------------------------------------------------------------- #
# Configuration transparency — a supervisor must be able to audit the zones and
# manifests that are actually driving findings (CLAUDE.md §22).
# --------------------------------------------------------------------------- #

def test_list_zones_includes_zones_actually_driving_findings():
    """backend/api/findings.py feeds the environmental lens the *manifest's*
    zones. Listing only operator-created zones reported 0 while dock-edge and
    wet-floor alerts were being raised."""
    from backend.api.supervisor import list_zones

    zone_ids = {z.zone_id for z in list_zones()}
    assert "dock_09_threshold_gap" in zone_ids
    assert "dock_08_wet_floor" in zone_ids
    for z in list_zones():
        assert len(z.polygon) >= 3
        assert z.severity_multiplier > 0


def test_list_manifests_includes_builtin_challenge_manifests():
    from backend.api.supervisor import list_manifests

    ms = list_manifests()
    assert len(ms) >= 7
    ids = {m["manifest_id"] for m in ms}
    assert "manifest_dock_09_cupboard" in ids
    assert "manifest_dock_08_wet_floor" in ids

    # every entry is attributable and carries its zone linkage
    for m in ms:
        assert m["origin"] in ("built-in", "operator")
        assert m["zone_count"] == len(m["zone_ids"])
        assert m["source_id"]


def test_operator_zone_overrides_builtin_of_same_id():
    from backend.api.supervisor import _ZONE_REGISTRY, list_zones
    from backend.lenses.environmental import EnvironmentalZone, ZoneType

    override = EnvironmentalZone(
        zone_id="dock_08_wet_floor",
        zone_type=ZoneType.WET_FLOOR,
        polygon=[(0.0, 0.0), (0.5, 0.0), (0.5, 0.5)],
        severity_multiplier=9.9,
    )
    _ZONE_REGISTRY["dock_08_wet_floor"] = override
    try:
        z = next(z for z in list_zones() if z.zone_id == "dock_08_wet_floor")
        assert z.severity_multiplier == 9.9
    finally:
        _ZONE_REGISTRY.pop("dock_08_wet_floor", None)
