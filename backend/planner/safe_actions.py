"""Safe Action Planner for TRACE (Feature 3).

Generates evidence-grounded, deterministic, practical operational action plans
for detected safety incidents. Adheres strictly to TRACE's epistemic boundaries:
- SUPPORTED / PROBABLE: Direct, prioritized corrective actions with verification steps.
- INSUFFICIENT_EVIDENCE / UNSUPPORTED: Flags verification requirement without fabricating certainty.
- Grounded strictly in existing scenario definitions, risk bands, and camera observations.
"""

from __future__ import annotations

from typing import Any, Optional, Union

from backend.contracts.models import (
    ConfidenceLevel,
    FindingStatus,
    RiskBand,
    RiskEvent,
    SafeActionPlan,
)
from backend.planner.actions import WHAT_IF_ELIGIBLE_SCENARIOS, _SCENARIO_ACTIONS, _SCENARIO_BASIS, _SCENARIO_RISK_TITLES

# Central deterministic catalog of safe operational action plans
# Mapping: scenario_key -> (title, immediate_action, secondary_actions, verification, reason)
_SAFE_ACTION_CATALOG: dict[str, tuple[str, str, list[str], str, str]] = {
    "stepping_on_carton": (
        "Worker standing on carton",
        "Step off the carton immediately.",
        [
            "Move to a safe standing position on the floor.",
            "Use an approved step stool or safety ladder for elevated reach.",
        ],
        "Confirm the worker is no longer standing on the carton and has stable floor footing.",
        "Cartons are not rated to support human body weight; stepping on them risks structural collapse and serious fall injuries.",
    ),
    "stepping_on_carton_precursor": (
        "Worker ascending onto carton base",
        "Step down to the floor immediately.",
        [
            "Move away from the stacked carton base.",
            "Obtain certified mobile warehouse steps before accessing upper tiers.",
        ],
        "Confirm the worker has stepped back down to the floor level.",
        "Using cartons as climbing footholds damages structural integrity and creates an immediate slip/fall hazard.",
    ),
    "box_overhang": (
        "Carton overhanging supporting base",
        "Push carton back so its base is fully supported.",
        [
            "Align carton edges flush with supporting package below.",
            "Verify tier alignment before adding upper cartons.",
        ],
        "Confirm carton footprint has at least 75% base contact and no cantilever overhang.",
        "Overhanging cartons create eccentric weight distribution that causes stack tipping and falling cargo.",
    ),
    "pallet_overhang": (
        "Carton overhang beyond pallet perimeter",
        "Reposition carton flush within pallet deck perimeter.",
        [
            "Eliminate all overhang beyond pallet edges.",
            "Secure outer perimeter with strapping or stretch wrap before transport.",
        ],
        "Confirm all cargo rests within the outer perimeter of the pallet deck.",
        "Pallet overhang snags on racking during transit and leads to cargo tipping and drop damage.",
    ),
    "heavy_on_light_stacking": (
        "Heavy carton stacked on lighter base",
        "Relocate the heavy carton down to the base tier.",
        [
            "Reorder stack with heaviest items at the bottom.",
            "Ensure lightweight cartons rest on top of heavier items only.",
        ],
        "Confirm all heavier cartons are positioned beneath lighter cartons across the tier.",
        "Heavy cargo on top of lighter packages crushes lower cartons and causes top-heavy stack collapse.",
    ),
    "unsupported_bending_placement": (
        "Unsupported carton overhang with structural bending",
        "Reposition carton to restore solid base support.",
        [
            "Center carton over supporting surface.",
            "Ensure at least 75% contact beneath the package.",
        ],
        "Confirm bottom panel is flat and fully supported without structural bending.",
        "Cantilever bending weakens corrugated packaging and leads to rupture under top load.",
    ),
    "dropping_or_throwing_precursor": (
        "Sudden downward drop or throw hazard",
        "Stop dropping or tossing packages immediately.",
        [
            "Lower package gently using controlled two-handed manual placement.",
            "Inspect carton contents for impact damage before restocking or dispatch.",
        ],
        "Confirm handler has returned to controlled two-handed lowering technique.",
        "High-velocity impact causes internal merchandise breakage and tears outer shipping boxes.",
    ),
    "carton_drop": (
        "Carton drop impact detected",
        "Quarantine dropped carton immediately for damage inspection.",
        [
            "Check carton contents for breakage or seal rupture.",
            "Repackage items if structural box integrity is compromised.",
        ],
        "Confirm carton has been inspected and either approved or tagged for damage.",
        "Drop shock causes internal merchandise destruction, seal rupture, and potential spill hazards.",
    ),
    "dragging_precursor": (
        "Carton dragged across warehouse floor",
        "Stop dragging carton across the floor.",
        [
            "Lift carton completely off the floor or use a hand truck or pallet jack.",
            "Request team lift if package weight exceeds solo lifting limits.",
        ],
        "Confirm package is transported with wheeled equipment or lifted clear of the floor.",
        "Floor dragging grinds through carton bottom panels, causing packages to burst open when lifted.",
    ),
    "rolling_precursor": (
        "Carton rolled or flipped end-over-end",
        "Stop rolling carton end-over-end.",
        [
            "Keep package upright and maneuver using a hand truck or cart.",
            "Inspect carton corners for impact damage.",
        ],
        "Confirm carton is stabilized upright and transported with handling equipment.",
        "Rolling damages box corners and inverts fragile contents violating upright shipping requirements.",
    ),
    "straps_as_handles": (
        "Packaging straps used as lifting handles",
        "Release packaging straps and grip carton body directly.",
        [
            "Lift from underneath the carton base using two hands.",
            "Use a hand truck or pallet jack for transporting heavy SKUs.",
        ],
        "Confirm worker is lifting from the package base and not holding tension straps.",
        "Packaging straps are designed for bundling, not lifting; they snap suddenly under tension causing drops.",
    ),
    "wrong_product_orientation": (
        "Package placed in wrong orientation",
        "Rotate package to upright orientation indicated by label arrows.",
        [
            "Verify this-side-up markings against manifest specification.",
            "Ensure top load is placed on approved carton orientation.",
        ],
        "Confirm this-side-up arrow points upward and matches product handling orientation.",
        "Non-compliant orientation risks internal liquid leakage, shifting, and sidewall compressive failure.",
    ),
    "max_stack_height_exceeded": (
        "Stack height exceeds product threshold",
        "Remove top tier to reduce stack height to compliant limit.",
        [
            "Stage excess cartons onto an adjacent pallet deck.",
            "Verify maximum stack height specification in SKU manifest.",
        ],
        "Confirm stack height does not exceed maximum allowable tier count.",
        "Excessive stack height causes top-heavy instability and crushes lower carton tiers.",
    ),
    "entity_in_dock_edge_zone": (
        "Entity within unprotected dock ledge zone",
        "Move at least 2 meters back from the dock edge immediately.",
        [
            "Deploy and secure dock edge safety gate or barrier chain.",
            "Verify bridge plate is locked in position before proceeding.",
        ],
        "Confirm all personnel and cargo are behind the dock safety boundary line.",
        "Unprotected dock edges create severe fall hazards into the drive gap or truck well.",
    ),
    "entity_in_wet_floor_zone": (
        "Handling within marked wet floor zone",
        "Halt handling in the wet area and step back onto dry floor.",
        [
            "Place caution cones around the wet area boundary.",
            "Reroute cargo traffic until the spill is cleaned and dry.",
        ],
        "Confirm area is barricaded with caution cones and traffic is rerouted.",
        "Wet floor surfaces severely reduce traction, creating slip and dropped load hazards.",
    ),
    "solo_heavy_handling": (
        "Solo handling of heavy SKU",
        "Pause lifting heavy cargo alone.",
        [
            "Request a second worker for team lift assistance.",
            "Use a mechanical pallet jack or hydraulic lift table.",
        ],
        "Confirm team lift is established or mechanical equipment is deployed.",
        "Solo lifting of heavy SKUs exceeds ergonomic thresholds and risks lumbar injury or dropped loads.",
    ),
    "box_displacement_near_person": (
        "Moving cargo in close proximity to worker",
        "Pause cargo movement and establish safe clearance.",
        [
            "Maintain clear visual communication before continuing transfer.",
            "Ensure worker has safe standing clearance from moving cargo.",
        ],
        "Confirm at least 1.5 m clear separation between worker and moving cargo.",
        "Moving cargo in close proximity to workers creates impact and crush pinch hazards.",
    ),
    "person_box_sustained_proximity": (
        "Sustained manual proximity to cargo",
        "Verify worker clearance and maintain ergonomic posture.",
        [
            "Ensure unobstructed walkway around staged cartons.",
            "Step back to designated packing aisle.",
        ],
        "Confirm clear walkway around cargo and unconstrained worker movement.",
        "Prolonged confined positioning near stacked cargo restricts escape paths during load shifts.",
    ),
    "unplanned_loading_sequence": (
        "Loading sequence deviates from manifest",
        "Pause staging and check sequence against manifest.",
        [
            "Reorder pallets to match dispatch delivery order.",
            "Verify dock staging lane assignment with supervisor.",
        ],
        "Confirm pallet loading order matches dispatch manifest sequence.",
        "Out-of-order staging causes double handling and unstable truck axle load distribution.",
    ),
    "wrong_equipment_usage": (
        "Unapproved handling equipment for SKU class",
        "Stop operation with unapproved equipment.",
        [
            "Switch to certified equipment designated for this SKU class.",
            "Verify equipment load rating against cargo mass.",
        ],
        "Confirm approved material handling equipment is deployed.",
        "Using unapproved equipment risks equipment tipping and mechanical load drop.",
    ),
    "product_rule_coverage": (
        "Unlinked SKU handling constraints",
        "Scan SKU barcode and link handling constraints in system.",
        [
            "Verify orientation, mass class, and max stack height in manifest.",
            "Tag uncataloged packages for supervisor review.",
        ],
        "Confirm SKU constraints are registered in operational catalog.",
        "Unlinked handling rules prevent automated safety validation during staging and tiering.",
    ),
    "product_conformance": (
        "SKU handling specification non-conformance",
        "Verify SKU constraints and adjust pallet configuration.",
        [
            "Inspect physical pallet tier against manifest rules.",
            "Consult supervisor if SKU specifications conflict with physical package.",
        ],
        "Confirm pallet tier conforms to SKU handling specification.",
        "Non-conforming pallet configurations violate customer shipping standards and tier stability limits.",
    ),
    "image_space_support_hypothesis": (
        "Support alignment under evaluation",
        "Align package edges flush with supporting tier footprint.",
        [
            "Ensure package rests square over lower tier without corner offset.",
            "Verify support stability before placing additional cargo tiers.",
        ],
        "Confirm carton base has at least 75% surface contact with supporting tier.",
        "Misaligned package tiers create eccentric load distribution and increase stack tipping risk.",
    ),
}


def generate_safe_action_plan(event: Union[RiskEvent, dict[str, Any]]) -> SafeActionPlan:
    """Generates a practical, grounded SafeActionPlan from an operational RiskEvent or dict.

    Adheres strictly to TRACE's safety principles:
    - No LLM hallucinations or invented rules.
    - Honest epistemic behavior: if evidence is insufficient, explicit verification is mandated.
    - Immediate action prioritized first, followed by clean verification criteria.
    """
    # Normalize input fields
    if isinstance(event, dict):
        event_id = event.get("event_id") or 0
        video_id = event.get("video_id")
        timestamp = float(event.get("timestamp") or 0.0)
        scenario = event.get("scenario") or ""
        status_val = event.get("status") or "supported"
        band_val = event.get("band") or "Medium"
        confidence_val = event.get("confidence") or "Medium"
        evidence = event.get("evidence") or {}
        limitations = list(event.get("limitations") or [])
        planner_rec = event.get("planner_recommendation")
    else:
        event_id = event.event_id or 0
        video_id = event.video_id
        timestamp = float(event.timestamp or 0.0)
        scenario = event.scenario or ""
        status_val = event.status.value if hasattr(event.status, "value") else str(event.status)
        band_val = event.band.value if hasattr(event.band, "value") else (str(event.band) if event.band else "Medium")
        confidence_val = event.confidence.value if hasattr(event.confidence, "value") else str(event.confidence)
        evidence = event.evidence or {}
        limitations = list(event.limitations or [])
        planner_rec = event.planner_recommendation

    status_str = str(status_val).lower()

    # Determine person interaction on image_space_support_hypothesis
    is_person_support = (
        evidence.get("supported_class") == "person"
        or evidence.get("supporter_class") == "person"
        or (isinstance(evidence, dict) and "person" in str(evidence).lower())
    )

    effective_scenario = scenario
    if scenario == "image_space_support_hypothesis" and is_person_support:
        effective_scenario = "stepping_on_carton"

    catalog_entry = _SAFE_ACTION_CATALOG.get(effective_scenario)
    if catalog_entry is not None:
        title, immediate, secondary, verification, reason = catalog_entry
    elif planner_rec is not None and getattr(planner_rec, "action", None):
        rec_action = planner_rec.action.replace("Immediate precaution: ", "").replace("Verification required: ", "")
        title = getattr(planner_rec, "risk_title", None) or effective_scenario.replace("_", " ").title()
        immediate = rec_action
        secondary = list(getattr(planner_rec, "alternative_actions", []))[:2]
        verification = f"Confirm {immediate.lower().rstrip('.')}"
        reason = getattr(planner_rec, "rationale", "Uncorrected handling hazards directly escalate risk.")
    else:
        # Generic safe fallback for unmapped scenario
        title = effective_scenario.replace("_", " ").title() if effective_scenario else "Recorded Operational Hazard"
        immediate = "Pause operation and inspect the workstation."
        secondary = ["Consult supervisor for task-specific handling procedure."]
        verification = "Confirm supervisor has verified handling method before resuming."
        reason = "Unmapped scenario requires standard supervisor verification to ensure handling safety."

    # 1. Epistemic Guardrail: Handle Insufficient Evidence or Unsupported findings
    if status_str in ("insufficient_evidence", "unsupported"):
        is_insufficient = status_str == "insufficient_evidence"
        status_label = "Insufficient evidence" if is_insufficient else "Unsupported"
        immediate_action = f"Supervisor verification required: {immediate.rstrip('.')}"
        steps = [immediate_action] + list(secondary)
        reason_guardrail = (
            f"{reason} (Available sensor evidence does not meet confidence threshold to justify automated physical intervention)."
            if is_insufficient
            else f"{reason} (TRACE cannot determine this condition from available camera evidence)."
        )
        return SafeActionPlan(
            event_id=event_id,
            video_id=video_id,
            timestamp=timestamp,
            risk_band=band_val,
            title=title,
            immediate_action=immediate_action,
            secondary_actions=secondary,
            steps=steps,
            verification=(
                f"Confirm supervisor has physically verified: {verification.lower().replace('confirm ', '', 1).rstrip('.')}."
                if verification.lower().startswith("confirm ")
                else f"Confirm supervisor has physically verified: {verification.lower().rstrip('.')}."
            ),
            reason=reason_guardrail,
            evidence_status=status_label,
            evidence_summary=(
                f"Camera observation at {int(timestamp // 60):02d}:{(timestamp % 60):04.1f} flagged for supervisor confirmation"
                if timestamp > 0
                else "Preliminary camera detection requiring supervisor confirmation"
            ),
            what_if_eligible=False,
            source="TRACE Epistemic Guardrail (supervisor verification required)",
            limitations=limitations or ["Preliminary observation flagged for human verification."],
        )

    # Format structured steps (Immediate first, followed by secondary actions)
    steps = [immediate] + list(secondary)

    # Human-readable evidence status
    evidence_status = "Seen in video" if status_str == "supported" else "Probable"

    # What-if eligibility
    what_if_eligible = effective_scenario in WHAT_IF_ELIGIBLE_SCENARIOS and not is_person_support

    # Clean evidence summary
    evidence_summary = (
        f"Video observation at {int(timestamp // 60):02d}:{(timestamp % 60):04.1f}"
        if timestamp > 0
        else "Video observation in monitored warehouse footage"
    )

    return SafeActionPlan(
        event_id=event_id,
        video_id=video_id,
        timestamp=timestamp,
        risk_band=band_val,
        title=title,
        immediate_action=immediate,
        secondary_actions=secondary,
        steps=steps,
        verification=verification,
        reason=reason,
        evidence_status=evidence_status,
        evidence_summary=evidence_summary,
        what_if_eligible=what_if_eligible,
        source="TRACE Operational Safety Catalog (deterministic rule)",
        limitations=limitations,
    )
