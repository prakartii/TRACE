"""Safe Action Planner integration for Phase 5 findings (Priority 8).

Maps a finding's (scenario, status) to an operator-facing recommended
action, centralized here so wording is reviewed/changed in one place
instead of duplicated per lens (CLAUDE.md §12's "single engine" principle
applied to action text). This is intentionally simple — the full Safe
Action Planner (candidate placement generation/scoring, ARCHITECTURE.md
Part 11) is Phase 8; this only attaches an honest, urgency-labeled action
to a finding whose status already reflects evidence quality
(backend/risk/aggregation.py), and refuses to recommend anything when the
evidence doesn't clear the bar for a real finding.
"""

from __future__ import annotations

from typing import Optional

from backend.contracts.models import ActionRecommendation, ConfidenceLevel, FindingStatus

# Scenario -> base action text. Kept here, not per-lens.
_SCENARIO_ACTIONS: dict[str, str] = {
    "image_space_support_hypothesis": (
        "Inspect visual contact and support foundation before adding upper tiers."
    ),
    "box_displacement_near_person": (
        "Pause carton movement and maintain clear separation from nearby worker."
    ),
    "person_box_sustained_proximity": (
        "Verify worker clearance and ensure ergonomic lifting technique before moving package."
    ),
    "dropping_or_throwing_precursor": (
        "Use controlled two-handed lowering technique; do not drop or toss cartons."
    ),
    "dragging_precursor": (
        "Use pallet jack or team lift; do not drag cartons across floor surfaces."
    ),
    "stepping_on_carton_precursor": (
        "Step off cartons immediately; use access stairs or designated safety ramp."
    ),
    "stepping_on_carton": (
        "Step off cartons immediately; packaging structure may collapse under body weight."
    ),
    "solo_heavy_handling": (
        "Request team lift or use mechanical pallet jack for heavy items."
    ),
    "heavy_on_light_stacking": (
        "Reorder stack with heavier cartons at base; do not place heavy loads on lighter packages."
    ),
    "pallet_overhang": (
        "Align carton with pallet boundaries; eliminate base overhang before adding upper tiers."
    ),
    "box_overhang": (
        "Align upper carton with supporting package edges; eliminate base overhang before adding upper tiers."
    ),
    "unsupported_bending_placement": (
        "Ensure at least 75% base support beneath item before releasing."
    ),
    "wrong_product_orientation": (
        "Rotate package to specified upright orientation before placement."
    ),
    "entity_in_dock_edge_zone": (
        "Maintain safe clearance from dock edge; verify bridge plate is deployed."
    ),
    "entity_in_wet_floor_zone": (
        "Exercise extreme caution on wet surface; report spill for cleanup before continuing."
    ),
    "rolling_precursor": (
        "Maintain controlled physical hold of cylindrical or rotating packages; prevent roll hazard."
    ),
    "straps_as_handles": (
        "Grip package body directly with two hands; never lift or carry items by packaging straps."
    ),
    "unplanned_loading_sequence": (
        "Verify order of staging against operational dispatch manifest sequence."
    ),
    "wrong_equipment_usage": (
        "Use certified material handling equipment designated for this SKU load specification."
    ),
    "product_rule_coverage": (
        "Configure SKU manifest handling rules (orientation, mass class, max stack height) in Supervisor Settings."
    ),
    "product_conformance": (
        "Configure SKU manifest handling rules (orientation, mass class, max stack height) in Supervisor Settings."
    ),
    "forklift_pedestrian_proximity": (
        "Halt forklift travel; maintain pedestrian exclusion zone and verify operator line of sight."
    ),
}

_SCENARIO_RISK_TITLES: dict[str, str] = {
    "box_overhang": "Unstable carton overhang beyond supporting base",
    "pallet_overhang": "Carton overhang beyond pallet perimeter deck",
    "heavy_on_light_stacking": "Inverse mass tiering (heavy carton over lighter base)",
    "unsupported_bending_placement": "Severe cantilever bending under package overhang",
    "dropping_or_throwing_precursor": "High-velocity carton descent / impact drop precursor",
    "dragging_precursor": "Carton dragged horizontally across ground plane",
    "stepping_on_carton_precursor": "Worker stepping onto carton packaging",
    "stepping_on_carton": "Worker body weight applied to carton surface",
    "box_displacement_near_person": "Moving cargo in close proximity to worker",
    "person_box_sustained_proximity": "Sustained manual proximity to cargo",
    "solo_heavy_handling": "Ergonomic lift hazard: heavy SKU handled by single worker",
    "wrong_product_orientation": "Non-compliant package orientation against SKU manifest",
    "entity_in_dock_edge_zone": "Fall hazard: entity positioned within dock ledge boundary",
    "entity_in_wet_floor_zone": "Slip/skid hazard: entity located within wet floor zone",
    "rolling_precursor": "Uncontrolled cylindrical roll hazard across floor",
    "straps_as_handles": "Improper grip: lifting carton by exterior packaging straps",
    "unplanned_loading_sequence": "Out-of-sequence pallet staging order",
    "wrong_equipment_usage": "Equipment class mismatch for SKU handling specification",
    "product_rule_coverage": "Operational manifest gap: unlinked SKU handling constraints",
    "product_conformance": "Operational manifest gap: unlinked SKU handling constraints",
    "image_space_support_hypothesis": "Unverified visual support contact relationship",
    "forklift_pedestrian_proximity": "Powered forklift traveling near a pedestrian",
}


def recommended_action(scenario: Optional[str], status: FindingStatus) -> Optional[str]:
    """Returns an urgency-prefixed action string, or None when the
    evidence doesn't clear the bar for recommending anything —
    INSUFFICIENT_EVIDENCE/UNSUPPORTED findings must never carry the same
    confident phrasing as a SUPPORTED one."""
    base = _SCENARIO_ACTIONS.get(scenario or "")
    if base is None:
        return None
    if status == FindingStatus.SUPPORTED:
        return f"Immediate precaution: {base}"
    if status == FindingStatus.PROBABLE:
        return f"Verification required: {base}"
    return None


# Structural/conformance scenarios eligible for What-If candidate generation
WHAT_IF_ELIGIBLE_SCENARIOS = {
    "heavy_on_light_stacking",
    "pallet_overhang",
    "box_overhang",
    "unsupported_bending_placement",
    "wrong_product_orientation",
    "image_space_support_hypothesis",
}

# Auditable evidence basis and limitations per scenario
_SCENARIO_BASIS: dict[str, tuple[str, list[str], list[str]]] = {
    "heavy_on_light_stacking": (
        "Image-space vertical support edge + linked SKU mass class.",
        [
            "Mass classification originates from operational metadata, not measured scale weight.",
            "Contact is an image-space projection hypothesis; 3D load bearing is unmeasured.",
        ],
        [
            "Verify pallet weight distribution.",
            "Consult warehouse stacking tier matrix.",
        ],
    ),
    "unsupported_bending_placement": (
        "Bounding box horizontal support overlap ratio < 50%.",
        [
            "Image-space footprint overlap is a 2D approximation of 3D contact area.",
            "Carton tensile/bending stiffness is not measured.",
        ],
        [
            "Align item center of mass over base support.",
            "Use dunnage or intermediate support boards.",
        ],
    ),
    "pallet_overhang": (
        "Carton footprint extends past detected pallet boundary (overlap ratio < 75%).",
        [
            "Pallet runner detection has lower empirical reliability (0.15 reliability weight).",
            "Camera perspective distortion may exaggerate edge protrusion.",
        ],
        [
            "Reposition cartons flush with pallet deck.",
            "Secure outer perimeter with strapping or stretch wrap.",
        ],
    ),
    "box_overhang": (
        "Upper carton footprint extends past supporting carton boundary (overlap ratio < 75%).",
        [
            "2D image projection does not capture true 3D depth alignment.",
        ],
        [
            "Re-center upper tier cartons.",
            "Interlock carton layers to distribute cantilever loads.",
        ],
    ),
    "wrong_product_orientation": (
        "Observed bounding box aspect ratio conflicts with SKU required orientation.",
        [
            "Orientation is estimated from 2D bounding box aspect ratio (width/height).",
            "This-side-up markings are not read via OCR.",
        ],
        [
            "Inspect physical 'This Side Up' orientation labels.",
            "Reorient package vertically before stacking.",
        ],
    ),
    "image_space_support_hypothesis": (
        "2D vertical adjacency and horizontal overlap between detected bounding boxes.",
        [
            "No depth sensor or metric camera calibration available.",
            "Physical load transfer cannot be verified from monocular video alone.",
        ],
        [
            "Inspect physical contact before adding upper tiers.",
        ],
    ),
    "dropping_or_throwing_precursor": (
        "Downward velocity spike and trajectory continuity across consecutive frames.",
        [
            "Velocity is measured in normalized frame space per second, not m/s.",
            "Motion blur during rapid manual handling may impact boundary accuracy.",
        ],
        [
            "Reinforce controlled two-handed handling protocol.",
            "Audit transfer speeds during peak throughput shifts.",
        ],
    ),
    "dragging_precursor": (
        "Horizontal displacement near floor plane across consecutive frames.",
        [
            "Ground contact is inferred from bottom boundary proximity to floor.",
        ],
        [
            "Deploy pallet jack or hand truck for ground transport.",
        ],
    ),
    "stepping_on_carton_precursor": (
        "Person footprint overlapping upper boundary of carton node near floor.",
        [
            "Image-space overlap does not verify full body weight application.",
        ],
        [
            "Provide mobile safety steps at workstation.",
        ],
    ),
    "stepping_on_carton": (
        "Person footprint overlapping upper boundary of carton node near floor.",
        [
            "Image-space overlap does not verify full body weight application.",
        ],
        [
            "Provide mobile safety steps at workstation.",
        ],
    ),
    "entity_in_dock_edge_zone": (
        "Entity bounding box intersects calibrated dock threshold hazard polygon.",
        [
            "Zone boundary is manually calibrated to camera view coordinates.",
        ],
        [
            "Verify safety barrier deployment and interlock signals.",
        ],
    ),
    "entity_in_wet_floor_zone": (
        "Entity bounding box intersects calibrated wet floor zone polygon.",
        [
            "Floor wetness is configured via environmental manifest; no optical moisture sensor exists.",
        ],
        [
            "Place physical warning signage and dispatch floor scrubber.",
        ],
    ),
    "solo_heavy_handling": (
        "Single person handling entity linked to HEAVY mass class metadata.",
        [
            "Worker count inferred from active person tracks in proximity window.",
        ],
        [
            "Request team lift assistance or mechanical lift assist.",
        ],
    ),
    "rolling_precursor": (
        "Image-space translation of carton across floor plane.",
        [
            "Rotational torque and angular velocity cannot be measured from monocular 2D video.",
        ],
        [
            "Stabilize rolling items on flat pallet surface.",
        ],
    ),
    "straps_as_handles": (
        "Packaging strap handling identification.",
        [
            "Packaging straps are sub-pixel webbing out-of-vocabulary for pilot object detector.",
            "Hand grasp forces and strap tension are unmeasurable.",
        ],
        [
            "Lift by bottom carton edges only.",
        ],
    ),
    "unplanned_loading_sequence": (
        "Multi-stage pallet staging sequence check against manifest.",
        [
            "Multi-stage truck dispatch manifests are unlinked in current stream.",
        ],
        [
            "Cross-reference warehouse staging manifest.",
        ],
    ),
    "wrong_equipment_usage": (
        "Material handling equipment classification.",
        [
            "Forklift and pallet jack class taxonomy is unmapped in pilot perception model.",
        ],
        [
            "Verify equipment inspection logs.",
        ],
    ),
    "product_rule_coverage": (
        "Detected cargo entities without linked SKU product metadata or handling constraints.",
        [
            "Entities detected without linked product barcode/SKU ID in operational manifest.",
        ],
        [
            "Review SKU catalog in Supervisor Settings.",
            "Scan or associate SKU IDs to tracked pallet/carton items.",
        ],
    ),
    "product_conformance": (
        "Detected cargo entities without linked SKU product metadata or handling constraints.",
        [
            "Entities detected without linked product barcode/SKU ID in operational manifest.",
        ],
        [
            "Review SKU catalog in Supervisor Settings.",
            "Scan or associate SKU IDs to tracked pallet/carton items.",
        ],
    ),
}


def plan_action(
    scenario: Optional[str],
    status: FindingStatus,
    confidence: ConfidenceLevel,
    evidence: Optional[dict] = None,
    limitations: Optional[list[str]] = None,
) -> ActionRecommendation:
    """Produces an evidence-aware, auditable ActionRecommendation adhering
    strictly to TRACE's epistemic boundaries:
    - SUPPORTED: Direct operational recommendation.
    - PROBABLE: Evidence-based recommendation noting verification requirement.
    - INSUFFICIENT_EVIDENCE: States additional evidence required before advising action.
    - UNSUPPORTED: Explicitly states TRACE cannot determine condition from available evidence.
    """
    scen = scenario or "unknown_scenario"
    base_action = _SCENARIO_ACTIONS.get(scen, "Review handling operation.")
    basis_info = _SCENARIO_BASIS.get(
        scen,
        (
            "Visual tracking and spatial relationship evidence.",
            ["Monocular camera observations; no physical contact sensor."],
            ["Review operational procedure."],
        ),
    )
    basis_text, default_limits, alt_actions = basis_info

    # Compile auditable limitations
    merged_limits = list(default_limits)
    if limitations:
        for lim in limitations:
            if lim not in merged_limits:
                merged_limits.append(lim)

    # Check if this finding represents person-cargo interaction rather than carton stacking
    is_person_support = (
        evidence is not None
        and (evidence.get("supported_class") == "person" or evidence.get("supporter_class") == "person")
    )
    if scen == "image_space_support_hypothesis" and is_person_support:
        base_action = "Step off cartons immediately; packaging structure may collapse under body weight."
        basis_text = "Image-space vertical support edge with person upper node."
        default_limits = [
            "Image-space vertical projection hypothesis; downward contact force is not measured.",
            "No 3D depth sensor or ground-reaction force sensor available.",
        ]
        alt_actions = [
            "Use designated safety steps or mobile workstation platform.",
            "Verify stable floor footing away from stacked cargo.",
        ]
        merged_limits = list(default_limits)
        if limitations:
            for lim in limitations:
                if lim not in merged_limits:
                    merged_limits.append(lim)

    # Apply non-negotiable evidence status rules
    if status == FindingStatus.SUPPORTED:
        action_text = f"Immediate precaution: {base_action}"
        rationale = f"Sufficient multi-frame visual and operational evidence supports this condition: {basis_text}"
        what_if_eligible = scen in WHAT_IF_ELIGIBLE_SCENARIOS and not is_person_support
    elif status == FindingStatus.PROBABLE:
        action_text = f"Verification required: {base_action}"
        rationale = f"Probable evidence observed ({basis_text}). Action recommended as precaution pending physical verification."
        what_if_eligible = scen in WHAT_IF_ELIGIBLE_SCENARIOS and not is_person_support
    elif status == FindingStatus.INSUFFICIENT_EVIDENCE:
        action_text = "Additional evidence is required before recommending a corrective placement."
        rationale = f"Preliminary observation flagged for review ({basis_text}). Additional sample persistence or manifest linkage required before automated physical intervention."
        what_if_eligible = False
    else:  # UNSUPPORTED
        action_text = "TRACE cannot safely determine this condition from available evidence."
        rationale = "Required perception channels or operational metadata are unlinked or unmapped."
        what_if_eligible = False

    risk_title = (
        "Worker standing or resting on packaging (stepping/fall hazard)"
        if (scen == "image_space_support_hypothesis" and is_person_support)
        else _SCENARIO_RISK_TITLES.get(scen, scen.replace("_", " ").title())
    )

    return ActionRecommendation(
        scenario_key=scenario,
        status=status,
        confidence=confidence,
        action=action_text,
        rationale=rationale,
        basis=basis_text,
        limitations=merged_limits,
        alternative_actions=alt_actions if status in (FindingStatus.SUPPORTED, FindingStatus.PROBABLE) else [],
        what_if_eligible=what_if_eligible,
        risk_title=risk_title,
    )

