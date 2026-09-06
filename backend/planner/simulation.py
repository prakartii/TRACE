"""Evidence-Guided What-If Simulation Engine (Phase 7B).

Computes deterministic, image-space counterfactual simulations comparing
the observed scene state against alternative candidate placements.

NON-NEGOTIABLE EPISTEMIC RULES:
1. NEVER mutate the actual recorded world model or perception cache.
2. Respect evidence status: refuse simulation for UNSUPPORTED or INSUFFICIENT_EVIDENCE.
3. Every score comparison exposes its full breakdown for auditable explanation.
4. Clearly state that simulation is image-space decision-support, not physical dynamics.
"""

from __future__ import annotations

from typing import Optional

from backend.contracts.models import (
    EntityClass,
    FindingStatus,
    ProductMetadata,
    RiskEvent,
    SceneGraphNode,
    SceneGraphSnapshot,
    WhatIfCurrentState,
    WhatIfSimulation,
)
from backend.planner.actions import WHAT_IF_ELIGIBLE_SCENARIOS
from backend.planner.generator import generate_placement_candidates
from backend.planner.stability import STABILITY_DISCLAIMER, compute_stability_score


def run_what_if_simulation(
    video_id: str,
    snapshot: SceneGraphSnapshot,
    finding: RiskEvent,
    *,
    product_metadata_by_id: Optional[dict[str, ProductMetadata]] = None,
    candidate_id: Optional[str] = None,
) -> WhatIfSimulation:
    """Executes a deterministic what-if comparative simulation for a given finding.
    Operates strictly on an isolated deep copy to guarantee world model immutability."""
    import copy

    snapshot = copy.deepcopy(snapshot)
    meta_by_id = product_metadata_by_id or {}
    scen = finding.scenario or "unknown_scenario"

    # 1. Epistemic Safety Gates (Section 16)
    if finding.status == FindingStatus.UNSUPPORTED:
        return WhatIfSimulation(
            video_id=video_id,
            timestamp=snapshot.timestamp,
            finding_scenario=scen,
            finding_status=finding.status,
            simulation_available=False,
            simulation_notice="Simulation unavailable: TRACE cannot safely determine this condition from available evidence.",
            current=None,
            alternatives=[],
            limitations=["unsupported_evidence"],
        )

    if finding.status == FindingStatus.INSUFFICIENT_EVIDENCE:
        return WhatIfSimulation(
            video_id=video_id,
            timestamp=snapshot.timestamp,
            finding_scenario=scen,
            finding_status=finding.status,
            simulation_available=False,
            simulation_notice="Simulation unavailable because the underlying scene evidence is insufficient.",
            current=None,
            alternatives=[],
            limitations=["insufficient_scene_evidence"],
        )

    if scen not in WHAT_IF_ELIGIBLE_SCENARIOS:
        return WhatIfSimulation(
            video_id=video_id,
            timestamp=snapshot.timestamp,
            finding_scenario=scen,
            finding_status=finding.status,
            simulation_available=False,
            simulation_notice=f"Simulation unavailable: scenario '{scen}' is an operational or environmental hazard, not a physical placement.",
            current=None,
            alternatives=[],
            limitations=["non_placement_scenario"],
        )

    notice = (
        "Evidence-based what-if — image-space decision-support simulation, not physical physics simulation."
        if finding.status == FindingStatus.PROBABLE
        else "Image-space decision-support simulation — physical load capacity and 3D forces are not measured."
    )

    # 2. Identify target and supporter nodes from finding entities
    nodes_by_id: dict[str, SceneGraphNode] = {n.entity_id: n for n in snapshot.nodes}
    target_node: Optional[SceneGraphNode] = None
    supporter_node: Optional[SceneGraphNode] = None

    if len(finding.entities) >= 2:
        # By convention in structural lens: entities = [supporter_id, supported_id]
        supporter_node = nodes_by_id.get(finding.entities[0])
        target_node = nodes_by_id.get(finding.entities[1])
    elif len(finding.entities) == 1:
        target_node = nodes_by_id.get(finding.entities[0])
    elif finding.entity_id:
        target_node = nodes_by_id.get(finding.entity_id)

    # If target node not found or missing footprint, fallback gracefully
    if target_node is None or target_node.footprint is None:
        return WhatIfSimulation(
            video_id=video_id,
            timestamp=snapshot.timestamp,
            finding_scenario=scen,
            finding_status=finding.status,
            simulation_available=False,
            simulation_notice="Simulation unavailable: target entity geometry not found in scene snapshot.",
            current=None,
            alternatives=[],
            limitations=["missing_entity_geometry"],
        )

    # Human workers cannot be simulated as cargo placement counterfactuals
    if target_node.entity_class == EntityClass.PERSON:
        return WhatIfSimulation(
            video_id=video_id,
            timestamp=snapshot.timestamp,
            finding_scenario=scen,
            finding_status=finding.status,
            simulation_available=False,
            simulation_notice="Simulation unavailable: target entity is a human worker, not cargo or package placement.",
            current=None,
            alternatives=[],
            limitations=["target_is_person_not_cargo"],
        )

    # Multi-tier placement scenarios require a supporting foundation
    if scen in ("pallet_overhang", "box_overhang", "heavy_on_light_stacking") and (
        supporter_node is None or supporter_node.footprint is None
    ):
        return WhatIfSimulation(
            video_id=video_id,
            timestamp=snapshot.timestamp,
            finding_scenario=scen,
            finding_status=finding.status,
            simulation_available=False,
            simulation_notice="No actionable placement scenario: TRACE found no supported object-placement relationship in this frame that can be safely simulated.",
            current=None,
            alternatives=[],
            limitations=["no_supporting_entity_in_snapshot"],
        )

    # 3. Calculate current observed stability score and breakdown
    target_meta = meta_by_id.get(target_node.product_id) if target_node.product_id else None
    supp_meta = (
        meta_by_id.get(supporter_node.product_id)
        if (supporter_node and supporter_node.product_id)
        else None
    )
    supp_footprint = supporter_node.footprint if (supporter_node and supporter_node.footprint) else None

    current_stab = compute_stability_score(
        target_node.footprint,
        supp_footprint,
        target_product=target_meta,
        support_product=supp_meta,
        is_base_tier=supporter_node is None,
    )

    current_state = WhatIfCurrentState(
        stability_score=current_stab.score,
        classification=current_stab.classification,
        support_overlap=current_stab.support_overlap,
        breakdown=current_stab.breakdown,
        entity_id=target_node.entity_id,
        footprint=target_node.footprint,
        supporting_entity_id=supporter_node.entity_id if supporter_node else None,
        supporting_footprint=supp_footprint,
    )

    # 4. Generate scene-aware alternative candidates
    alternatives = generate_placement_candidates(
        target_node,
        supporter_node,
        snapshot,
        scenario_key=scen,
        product_metadata_by_id=meta_by_id,
        current_score=current_stab.score,
    )

    if not alternatives:
        return WhatIfSimulation(
            video_id=video_id,
            timestamp=snapshot.timestamp,
            finding_scenario=scen,
            finding_status=finding.status,
            simulation_available=False,
            simulation_notice="No actionable placement scenario: TRACE found no supported object-placement relationship in this frame that can be safely simulated.",
            current=current_state,
            alternatives=[],
            limitations=[
                STABILITY_DISCLAIMER,
                "No geometrically feasible alternative placement could be safely generated for this frame.",
            ],
        )

    # If specific candidate requested, prioritize it
    if candidate_id:
        alternatives.sort(key=lambda c: (c.id != candidate_id, -c.score))

    limitations = [
        STABILITY_DISCLAIMER,
        "Image-space 2D decision-support only; 3D forces, torque, and friction are not measured.",
    ]
    if target_meta:
        limitations.append("Mass classification originates from SKU manifest, not physical scale.")

    return WhatIfSimulation(
        video_id=video_id,
        timestamp=snapshot.timestamp,
        finding_scenario=scen,
        finding_status=finding.status,
        simulation_available=True,
        simulation_notice=notice,
        current=current_state,
        alternatives=alternatives,
        limitations=limitations,
    )
