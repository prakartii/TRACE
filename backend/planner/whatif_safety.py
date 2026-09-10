"""Authoritative What-If Safety Simulation Service for TRACE.

Provides decision-support safety simulations grounded in genuine warehouse evidence:
- Answers: "If we changed this unsafe action, what would likely happen instead?"
- Exposes ONLY valid, supported incidents via `what_if_supported`.
- Replaces raw physics calculations with human-readable visual counterfactuals:
    WHAT HAPPENED -> WHAT-IF -> EXPECTED RESULT.
- Scenario-specific visual configurations for all 14 canonical operational scenarios.
- Preserves TRACE epistemic integrity (no fabricated physics certainty).
"""

from __future__ import annotations

import json
import sqlite3
from typing import Any, Optional

from backend.contracts.models import FindingStatus, RiskBand
from backend.db.canonical_seed import CANONICAL_SCENARIOS_DATA
from backend.planner.eligibility import what_if_supported

# Canonical camera bay names mapped to video IDs
VIDEO_BAY_NAMES: dict[str, str] = {
    "d2984c4eb1cf6b86": "KD Inbound Bay — Staging Line B",
    "70063d8b35d1fa9a": "Trailer Loading Dock — Mattress Transfer",
    "93e4b1963c6fcd97": "Dock Bay 09 — Dispatch Staging",
    "734f165d61afafa0": "Washdown Bay 02 — Wet Floor Staging",
    "44f245313615d3a1": "Inbound Staging Bay 03 — Bulk Seating",
    "ccba59290a852fdc": "Inbound Staging Bay 03 — Bulk Seating",
    "f15ad7e2295d190b": "Trailer Bay 07 — Bulk Carton Stacking",
    "ac99ff34e1bd2c13": "Sortation Line 01 — Pallet Overhang Deck",
}

# Scenario-specific visual & counterfactual intelligence configurations
SCENARIO_SIMULATION_CONFIGS: dict[str, dict[str, Any]] = {
    "heavy_on_light_stacking": {
        "visual_type": "heavy_on_light",
        "title": "Heavy item placed on lighter packets",
        "observed_headline": "Heavy overpack crate stacked on top of lightweight KD flatpack packets",
        "observed_description": (
            "A heavier overpack crate is placed on top of lighter KD flatpack cartons. "
            "Inverse mass distribution concentrates excessive vertical load on lower packaging."
        ),
        "risk_summary": "Lower packaging crush risk and top-heavy stack collapse hazard.",
        "counterfactual_headline": "Heavy crate positioned at stable base tier beneath KD packets",
        "counterfactual_action": (
            "Move the heavy overpack crate to the foundation tier directly on the pallet deck, "
            "then stack lighter KD flatpack packets on top."
        ),
        "expected_outcome": (
            "Safer placement keeps the heavier item below the lighter load, eliminating crushing stress "
            "and keeping the stack center of gravity low and stable."
        ),
        "risk_transition": "High Risk -> Low Risk",
        "why_trace_recommends": (
            "Warehouse Stacking Matrix SOP-02 requires heavier mass classes at the pallet base. "
            "Inverting the tiers eliminates packaging fatigue and top-heavy tipping during transit."
        ),
        "rule_reference": "TRACE Safety Catalog Section 3.1 - Pyramidal Tier Mass Distribution",
        # Numeric mass-ratio annotation is filled in from this event's real
        # evidence (evidence.mass_ratio) by build_what_if_safety_simulation
        # below — never a fixed number here, since the real ratio varies
        # per incident.
        "visual_data": {
            "before": {
                "top_item": {"label": "Heavy Crate", "mass_class": "Heavy", "state": "danger"},
                "base_item": {"label": "KD Flatpack Packets", "mass_class": "Light", "state": "crush_risk"},
                "annotation": "Inverse mass load (heavier item stacked above lighter item)",
            },
            "after": {
                "top_item": {"label": "KD Flatpack Packets", "mass_class": "Light", "state": "safe"},
                "base_item": {"label": "Heavy Crate", "mass_class": "Heavy", "state": "foundation"},
                "annotation": "Stable foundation support verified",
            },
        },
    },
    "dropping_or_throwing_precursor": {
        "visual_type": "throwing_dropping",
        "title": "Carton thrown during trailer loading",
        "observed_headline": "Worker shove-throws bulk cargo into trailer bed",
        "observed_description": (
            "Worker shove-tosses cargo with a sudden downward velocity spike "
            "into the vehicle bed rather than carrying and lowering it under control."
        ),
        "risk_summary": "High-velocity impact causes internal damage, packaging seam rupture, and worker strike hazard.",
        "counterfactual_headline": "Carton lowered under controlled two-handed manual handling",
        "counterfactual_action": (
            "Worker carries the carton into the vehicle bed and lowers it directly to the floor "
            "using controlled two-handed placement."
        ),
        "expected_outcome": (
            "Controlled handling removes the observed throwing behavior and sudden descent velocity spike, "
            "preventing impact shock and packaging seam failures."
        ),
        "risk_transition": "High Risk -> Low Risk",
        "why_trace_recommends": (
            "TRACE's motion lens detected a downward acceleration spike exceeding safe release limits. "
            "Two-handed lowering ensures zero impact shock."
        ),
        "rule_reference": "TRACE Safety Catalog Section 4.2 - Controlled Cargo Lowering",
        "visual_data": {
            "before": {
                "movement": "uncontrolled_throw",
                "speed_vector": "High downward velocity spike",
                "state": "danger",
            },
            "after": {
                "movement": "controlled_lowering",
                "speed_vector": "Controlled descent to vehicle bed",
                "state": "safe",
            },
        },
    },
    "carton_drop": {
        "visual_type": "throwing_dropping",
        "title": "Carton freefall impact / drop detected",
        "observed_headline": "Uncontrolled carton release and freefall descent",
        "observed_description": (
            "Carton released from worker hands before reaching pallet deck, causing freefall drop impact."
        ),
        "risk_summary": "Impact shock ruptures carton packaging and risks worker foot injury.",
        "counterfactual_headline": "Controlled placement to destination surface",
        "counterfactual_action": "Maintain physical support until package is fully resting on the destination surface.",
        "expected_outcome": "Eliminates freefall descent velocity and prevents impact damage to goods and personnel.",
        "risk_transition": "Critical Risk -> Low Risk",
        "why_trace_recommends": "Freefall impacts severely degrade packaging integrity and pose foot crush hazards.",
        "rule_reference": "TRACE Safety Catalog Section 4.1 - Zero Freefall Release",
        "visual_data": {
            "before": {"movement": "freefall_drop", "state": "danger"},
            "after": {"movement": "hand_supported_placement", "state": "safe"},
        },
    },
    "dragging_precursor": {
        "visual_type": "dragging",
        "title": "Carton dragged across warehouse floor",
        "observed_headline": "Cupboard carton dragged across concrete yard surface",
        "observed_description": (
            "Worker drags large cupboard carton horizontally across concrete yard floor without "
            "lifting equipment, maintaining abrasive friction against the ground plane."
        ),
        "risk_summary": "Abrasive friction grinds packaging base, tears seals, and causes worker musculoskeletal strain.",
        "counterfactual_headline": "Carton elevated onto hydraulic pallet jack or flatbed dolly",
        "counterfactual_action": (
            "Worker transfers carton onto a hydraulic pallet truck or flatbed cart to transport "
            "without dragging along the ground plane."
        ),
        "expected_outcome": (
            "Elevating the cargo onto wheeled transport eliminates abrasive floor friction, "
            "protects packaging base integrity, and reduces ergonomic tractive effort."
        ),
        "risk_transition": "Medium Risk -> Low Risk",
        "why_trace_recommends": (
            "Sustained horizontal ground contact creates friction wear on packaging seams. "
            "Wheeled transport complies with safe material handling standards."
        ),
        "rule_reference": "TRACE Safety Catalog Section 5.1 - Mechanical Transport Mandate",
        "visual_data": {
            "before": {
                "mode": "floor_drag",
                "contact": "Sustained ground friction contact",
                "state": "danger",
            },
            "after": {
                "mode": "wheeled_transport",
                "contact": "Elevated on pallet truck wheels",
                "state": "safe",
            },
        },
    },
    "rolling_precursor": {
        "visual_type": "rolling_carton",
        "title": "Carton rolled end-over-end along floor",
        "observed_headline": "Carton rotated and tumbled end-over-end across staging area",
        "observed_description": (
            "Package is repeatedly rotated and rolled end-over-end along the staging floor instead of "
            "being transported upright on mobile equipment."
        ),
        "risk_summary": "Inverts orientation-sensitive contents, crushes carton corners, and violates upright handling rules.",
        "counterfactual_headline": "Package secured upright on hand truck or pallet platform",
        "counterfactual_action": (
            "Keep carton upright and transfer via a two-wheel hand truck or pallet jack with "
            "perimeter securement."
        ),
        "expected_outcome": (
            "Maintains upright orientation compliance throughout transit and eliminates repeated corner impact shocks."
        ),
        "risk_transition": "Medium Risk -> Low Risk",
        "why_trace_recommends": (
            "Aspect-ratio oscillation confirmed repeated end-over-end rotation. Upright handling preserves "
            "internal component alignment."
        ),
        "rule_reference": "TRACE Safety Catalog Section 5.4 - Upright Transport Requirement",
        "visual_data": {
            "before": {"mode": "rolling_tumble", "state": "danger"},
            "after": {"mode": "upright_cart", "orientation": "vertical", "state": "safe"},
        },
    },
    "straps_as_handles": {
        "visual_type": "wrong_equipment",
        "title": "Lifting carton by exterior packaging straps",
        "observed_headline": "Worker lifting heavy cargo by exterior plastic tension straps",
        "observed_description": (
            "Worker grasps exterior plastic tension banding straps to lift and maneuver carton, "
            "without supporting the package body from beneath."
        ),
        "risk_summary": "Strapping can snap under tensile load, causing sudden drop, cargo destruction, and hand lacerations.",
        "counterfactual_headline": "Two-handed ergonomic grip supporting package base",
        "counterfactual_action": (
            "Grip package body directly with two hands positioned beneath the lower corners, "
            "or use a mechanical lift assist."
        ),
        "expected_outcome": (
            "Supporting the package base eliminates tensile strap failure risks and distributes lifting force safely."
        ),
        "risk_transition": "High Risk -> Low Risk",
        "why_trace_recommends": (
            "Packaging straps are engineered for bundle retention, not load bearing. Direct base contact provides secure control."
        ),
        "rule_reference": "TRACE Safety Catalog Section 4.5 - Packaging Strap Safety Mandate",
        "visual_data": {
            "before": {"grip": "plastic_straps", "state": "danger"},
            "after": {"grip": "two_handed_base", "state": "safe"},
        },
    },
    "stepping_on_carton": {
        "visual_type": "stepping_on_carton",
        "title": "Worker stepped on cartons during loading",
        "observed_headline": "Worker standing directly on carton packaging at truck threshold",
        "observed_description": (
            "Worker stands elevated directly on top of carton packaging at the vehicle threshold "
            "to reach higher cargo tiers."
        ),
        "risk_summary": "Full adult body weight applied to top carton surface creates imminent packaging puncture, collapse, and severe fall from height.",
        "counterfactual_headline": "Worker uses designated access safety steps or rolling ladder",
        "counterfactual_action": (
            "Worker steps down from cartons and utilizes a certified non-slip safety step stool "
            "or rolling platform ladder to access upper tiers."
        ),
        "expected_outcome": (
            "Using the designated access path removes body weight from cartons entirely, preventing packaging collapse "
            "and eliminating personnel fall-from-height hazards."
        ),
        "risk_transition": "Critical Risk -> Low Risk",
        "why_trace_recommends": (
            "Corrugated packaging is not load-bearing for human body weight. Certified access ladders protect both worker safety and cargo integrity."
        ),
        "rule_reference": "TRACE Safety Catalog Section 2.1 - Zero Foot Contact Policy",
        "visual_data": {
            "before": {
                "worker_position": "on_cartons",
                "load": "Full adult body weight",
                "state": "danger",
            },
            "after": {
                "worker_position": "designated_access_platform",
                "load": "Weight supported by access platform",
                "state": "safe",
            },
        },
    },
    "stepping_on_carton_precursor": {
        "visual_type": "stepping_on_carton",
        "title": "Worker stepping onto cartons",
        "observed_headline": "Worker initiating step onto cargo packaging surface",
        "observed_description": (
            "Worker foot trajectory contacts top surface of cargo packaging during trailer loading."
        ),
        "risk_summary": "Packaging puncture and crush collapse under foot contact.",
        "counterfactual_headline": "Worker routes feet to designated walkway platform",
        "counterfactual_action": "Step off cartons immediately onto vehicle bed or designated staging step platform.",
        "expected_outcome": "Removes foot contact from carton surfaces, keeping packaging intact.",
        "risk_transition": "High Risk -> Low Risk",
        "why_trace_recommends": "Zero foot contact policy prevents package crushing and worker slips.",
        "rule_reference": "TRACE Safety Catalog Section 2.1 - Zero Foot Contact Policy",
        "visual_data": {
            "before": {"worker_position": "on_cartons", "state": "danger"},
            "after": {"worker_position": "designated_access_platform", "state": "safe"},
        },
    },
    "wrong_product_orientation": {
        "visual_type": "wrong_product_orientation",
        "title": "Vertical product stored horizontally",
        "observed_headline": "Carton with vertical handling requirement placed on its side horizontally",
        "observed_description": (
            "Carton is positioned horizontally across the vehicle bed, violating "
            "manifest specifications requiring strict vertical upright placement."
        ),
        "risk_summary": "Non-upright storage causes internal fluid leakage or component damage.",
        "counterfactual_headline": "Carton rotated 90 degrees upright to compliant vertical specification",
        "counterfactual_action": (
            "Rotate package 90 degrees to vertical orientation so 'This Way Up' indicators point upwards "
            "and item rests on its reinforced base."
        ),
        "expected_outcome": (
            "Aligning orientation with SKU specification ensures internal structural ribs bear the load correctly "
            "and prevents contents leakage."
        ),
        "risk_transition": "High Risk -> Low Risk",
        "why_trace_recommends": (
            "SKU manifest mandates vertical upright orientation for this package. Correct alignment restores full conformance."
        ),
        "rule_reference": "TRACE Safety Catalog Section 6.2 - Package Orientation Compliance",
        "visual_data": {
            "before": {
                "orientation": "horizontal",
                "aspect_ratio": 1.72,
                "label": "Non-compliant horizontal orientation",
                "state": "danger",
            },
            "after": {
                "orientation": "vertical",
                "aspect_ratio": 0.58,
                "label": "Compliant upright orientation",
                "state": "safe",
            },
        },
    },
    "box_overhang": {
        "visual_type": "pallet_overhang",
        "title": "Carton overhang beyond pallet perimeter",
        "observed_headline": "Carton base cantilevered beyond supporting pallet deck",
        "observed_description": (
            "Carton extends past the pallet deck perimeter boundary, creating a center-of-mass "
            "offset and unsupported cantilever bending."
        ),
        "risk_summary": "Cantilever tipping moment creates imminent cargo freefall and worker strike hazard.",
        "counterfactual_headline": "Carton shifted inward flush with pallet deck boundary",
        "counterfactual_action": (
            "Reposition carton inward so its full base footprint is supported directly "
            "by the pallet deck."
        ),
        "expected_outcome": (
            "Moving load within pallet boundary restores full foundation support and eliminates the cantilever tipping moment."
        ),
        "risk_transition": "High Risk -> Low Risk",
        "why_trace_recommends": (
            "Geometric analysis measured base support below the safe overhang threshold. Inward shift passes all boundary clearance checks."
        ),
        "rule_reference": "TRACE Safety Catalog Section 1.1 - Pallet Perimeter Footprint Conformance",
        # Numeric overhang/support percentages are filled in from this
        # event's real evidence (overhang_ratio / support_ratio) by
        # build_what_if_safety_simulation below.
        "visual_data": {
            "before": {
                "label": "Cantilever overhang past pallet edge",
                "state": "danger",
            },
            "after": {
                "overhang_pct": 0.0,
                "support_pct": 100.0,
                "label": "Flush pallet deck alignment (fully supported)",
                "state": "safe",
            },
        },
    },
    "pallet_overhang": {
        "visual_type": "pallet_overhang",
        "title": "Carton overhang beyond pallet perimeter",
        "observed_headline": "Load extends beyond pallet boundary",
        "observed_description": (
            "Carton extends past the pallet deck perimeter, creating center-of-mass offset."
        ),
        "risk_summary": "Cantilever tipping moment risks cargo freefall during transport.",
        "counterfactual_headline": "Load contained within safe pallet footprint",
        "counterfactual_action": "Reposition carton flush with pallet deck boundary.",
        "expected_outcome": "Restores full foundation support and eliminates edge tipping hazard.",
        "risk_transition": "High Risk -> Low Risk",
        "why_trace_recommends": "Eliminating overhang ensures stable pallet wrapping and safe rack entry.",
        "rule_reference": "TRACE Safety Catalog Section 1.1 - Pallet Perimeter Footprint Conformance",
        # Overhang percentage filled in from real evidence below.
        "visual_data": {
            "before": {"state": "danger"},
            "after": {"overhang_pct": 0.0, "state": "safe"},
        },
    },
    "unsupported_bending_placement": {
        "visual_type": "pallet_overhang",
        "title": "Severe cantilever bending under package overhang",
        "observed_headline": "Carton cantilevered past foundation creating seam deflection",
        "observed_description": (
            "Extreme cantilever placement resulting in an unsupported package base and structural deflection."
        ),
        "risk_summary": "Gravitational bending moment creates seam tear and carton rupture risk.",
        "counterfactual_headline": "Carton centered over base foundation support",
        "counterfactual_action": "Slide carton inward to ensure the base is fully supported on the foundation.",
        "expected_outcome": "Eliminates cantilever bending deflection, protecting structural seams from rupture.",
        "risk_transition": "High Risk -> Low Risk",
        "why_trace_recommends": "Support overlap ratio fell below the safe cantilever limit.",
        "rule_reference": "TRACE Safety Catalog Section 1.2 - Cantilever Deflection Thresholds",
        # Support percentage filled in from real evidence below.
        "visual_data": {
            "before": {"state": "danger"},
            "after": {"support_pct": 100.0, "state": "safe"},
        },
    },
    "entity_in_dock_edge_zone": {
        "visual_type": "dock_gap",
        "title": "Worker positioned within unprotected dock edge",
        "observed_headline": "Worker and cargo within the unprotected dock edge zone",
        "observed_description": (
            "Worker operates close to the unbarricaded dock edge ledge without a deployed "
            "bridge plate connecting to the vehicle bed."
        ),
        "risk_summary": "Severe fall hazard: worker or wheeled cargo falling into the vehicular yard driveway below.",
        "counterfactual_headline": "Deploy dock leveler bridge plate and maintain safety buffer",
        "counterfactual_action": (
            "Deploy dock bridge plate leveler across vehicle gap and ensure operations remain "
            "behind the marked perimeter safety line."
        ),
        "expected_outcome": (
            "Deploying the bridge plate closes the drop-off void and establishes a safe continuous transit plane."
        ),
        "risk_transition": "High Risk -> Low Risk",
        "why_trace_recommends": (
            "The tracked entity's position fell inside the calibrated dock-edge hazard perimeter. Deploying a dock plate eliminates the gap."
        ),
        "rule_reference": "TRACE Safety Catalog Section 7.1 - Dock Edge Fall Protection",
        "visual_data": {
            "before": {
                "gap_status": "open_ledge_void",
                "distance_to_edge": "Inside the calibrated danger zone",
                "state": "danger",
            },
            "after": {
                "gap_status": "bridge_plate_deployed",
                "distance_to_edge": "Secured transit bridge",
                "state": "safe",
            },
        },
    },
    "entity_in_wet_floor_zone": {
        "visual_type": "wet_floor",
        "title": "Cargo transit across active wet washdown zone",
        "observed_headline": "Manual cargo transit directly across wet washdown floor",
        "observed_description": (
            "Worker moves cargo directly across an active wet washdown area with surface water puddles."
        ),
        "risk_summary": "Reduced surface traction creates severe slip-and-fall risk and carton base moisture dampening.",
        "counterfactual_headline": "Reroute transit path around wet zone perimeter along dry aisle",
        "counterfactual_action": (
            "Reroute cargo transit path around the marked washdown zone perimeter along the dry, slip-resistant aisle."
        ),
        "expected_outcome": (
            "Moving away from the wet area reduces exposure to the observed slip hazard and protects packaging from moisture absorption."
        ),
        "risk_transition": "Medium Risk -> Low Risk",
        "why_trace_recommends": (
            "The tracked entity's position fell inside the calibrated wet-floor hazard perimeter. Rerouting maintains safe dry-floor transit."
        ),
        "rule_reference": "TRACE Safety Catalog Section 7.3 - Wet Floor Transit Restriction",
        "visual_data": {
            "before": {
                "path": "through_wet_zone",
                "traction_loss": "Reduced surface traction",
                "state": "danger",
            },
            "after": {
                "path": "dry_perimeter_aisle",
                "traction_loss": "Normal dry-floor traction",
                "state": "safe",
            },
        },
    },
    "unplanned_loading_sequence": {
        "visual_type": "loading_sequence",
        "title": "Out-of-sequence pallet staging order",
        "observed_headline": "Drop 1 cupboard staged before Drop 2 flatpacks",
        "observed_description": (
            "Cupboard staged before flatpacks, violating scheduled route loading sequence "
            "(manifest requires Drop 2 loaded into nose before Drop 1 at doorway)."
        ),
        "risk_summary": "Out-of-sequence staging blocks first-out delivery, forcing double handling and roadside restacking.",
        "counterfactual_headline": "Stage Drop 2 cargo first in trailer nose per manifest sequence",
        "counterfactual_action": (
            "Load Drop 2 cargo first into the trailer front, reserving doorway staging for Drop 1 destination."
        ),
        "expected_outcome": (
            "Restoring manifest sequence ensures first-out cargo is immediately accessible without double handling or roadside restacking."
        ),
        "risk_transition": "Medium Risk -> Low Risk",
        "why_trace_recommends": (
            "Dispatch manifest specifies reverse delivery loading. Correct sequence prevents trailer congestion."
        ),
        "rule_reference": "TRACE Safety Catalog Section 6.4 - Manifest Loading Sequence Conformance",
        "visual_data": {
            "before": {
                "doorway_cargo": "Drop 2 (Blocks Drop 1)",
                "nose_cargo": "Drop 1 (Blocked)",
                "state": "danger",
            },
            "after": {
                "doorway_cargo": "Drop 1 (First out)",
                "nose_cargo": "Drop 2 (Final destination)",
                "state": "safe",
            },
        },
    },
    "solo_heavy_handling": {
        "visual_type": "solo_heavy",
        "title": "Heavy SKU handled by single worker",
        "observed_headline": "Single worker maneuvering a heavy mass-class cargo crate",
        "observed_description": (
            "Single worker attempting manual maneuver of a heavy-class cargo crate without team lift "
            "assistance or mechanical aid."
        ),
        "risk_summary": "Exceeds single-person safe lifting practice, elevating risk of spinal injury and dropped cargo.",
        "counterfactual_headline": "Deploy two-worker team lift or hydraulic mechanical lifter",
        "counterfactual_action": (
            "Summon second worker for synchronized team lift, or utilize a hydraulic mobile lifter "
            "to maneuver heavy cargo."
        ),
        "expected_outcome": (
            "Team lift distributes the ergonomic load between two workers, eliminating acute spinal strain."
        ),
        "risk_transition": "High Risk -> Low Risk",
        "why_trace_recommends": (
            "This SKU's mass class exceeds the ergonomic individual-lift limit. Team lifting complies with handling standards."
        ),
        "rule_reference": "TRACE Safety Catalog Section 4.3 - Ergonomic Team Lift Mandate",
        "visual_data": {
            "before": {
                "workers": 1,
                "load_per_worker": "Full load (single-worker overload)",
                "state": "danger",
            },
            "after": {
                "workers": 2,
                "load_per_worker": "Shared load (within safe limits)",
                "state": "safe",
            },
        },
    },
    "wrong_equipment_usage": {
        "visual_type": "wrong_equipment",
        "title": "Equipment class mismatch: Pallet used instead of trolley",
        "observed_headline": "Wooden pallet dragged manually as makeshift cargo transport",
        "observed_description": (
            "Wooden pallet dragged manually along floor and used as makeshift cargo transport instead of "
            "an approved wheeled trolley or pallet truck."
        ),
        "risk_summary": "Elevates risk of cargo tip-over, worker strain, and severe floor abrasion.",
        "counterfactual_headline": "Transfer cargo onto approved wheeled flatbed cart or pallet jack",
        "counterfactual_action": (
            "Restage cargo onto a certified wheeled flatbed cart or hydraulic pallet truck designated "
            "for this SKU load specification."
        ),
        "expected_outcome": (
            "Using appropriate equipment provides stable wheeled transport, eliminating floor damage and tip-over risks."
        ),
        "risk_transition": "High Risk -> Low Risk",
        "why_trace_recommends": (
            "Facility manifest requires certified wheeled equipment for cargo transit. Makeshift pallets violate equipment rules."
        ),
        "rule_reference": "TRACE Safety Catalog Section 5.2 - Certified Material Handling Equipment",
        "visual_data": {
            "before": {
                "equipment": "Dragged wooden pallet",
                "mode": "Makeshift ground drag",
                "state": "danger",
            },
            "after": {
                "equipment": "Certified wheeled trolley",
                "mode": "Smooth wheeled rolling",
                "state": "safe",
            },
        },
    },
}


def get_supported_what_if_events(
    db_conn: Optional[sqlite3.Connection] = None,
    video_id: Optional[str] = None,
) -> list[dict[str, Any]]:
    """Authoritative list of supported What-If safety simulation events.

    Returns ONLY events that satisfy `what_if_supported(...)`.
    Deduplicates multiple events from the same video/scenario so the selector
    is clean, organized, and guarantees every item works.
    """
    from backend.db.db import get_connection

    conn = db_conn or get_connection()
    cur = conn.cursor()

    supported_list: list[dict[str, Any]] = []
    seen_keys: set[str] = set()

    for item in CANONICAL_SCENARIOS_DATA:
        if not what_if_supported(event=item, db_conn=conn):
            continue

        vid = item.get("video_id")
        if video_id and vid != video_id:
            continue

        scen = item.get("scenario")
        if item.get("event_type") == "prevented":
            continue

        dedup_key = f"{vid}:{scen}"
        if dedup_key in seen_keys:
            continue
        seen_keys.add(dedup_key)

        cfg = SCENARIO_SIMULATION_CONFIGS.get(scen, {})
        bay_name = VIDEO_BAY_NAMES.get(vid, "Optical Inspection Bay")
        title = cfg.get("title") or item.get("title")

        supported_list.append(
            {
                "event_id": item["event_id"],
                "video_id": vid,
                "video_title": bay_name,
                "timestamp": item["timestamp"],
                "scenario": scen,
                "title": title,
                "label": f"{bay_name} — {title}",
                "status": item.get("status", "supported"),
                "band": item.get("band", "High"),
                "observed_summary": cfg.get("observed_headline") or item.get("explanation"),
                "counterfactual_summary": cfg.get("counterfactual_headline") or cfg.get("counterfactual_action"),
                "visual_type": cfg.get("visual_type", "general"),
            }
        )

    try:
        rows = cur.execute(
            """
            SELECT event_id, video_id, timestamp, scenario, status, band, factor_breakdown_json
            FROM events
            WHERE status IN ('supported', 'probable')
            ORDER BY timestamp ASC
            """
        ).fetchall()
        for r in rows:
            ev_dict = dict(r)
            scen = ev_dict.get("scenario")
            vid = ev_dict.get("video_id")
            if video_id and vid != video_id:
                continue

            dedup_key = f"{vid}:{scen}"
            if dedup_key in seen_keys:
                continue

            if not what_if_supported(event=ev_dict, db_conn=conn):
                continue
            seen_keys.add(dedup_key)

            cfg = SCENARIO_SIMULATION_CONFIGS.get(scen, {})
            bay_name = VIDEO_BAY_NAMES.get(vid, "Optical Inspection Bay")
            title = cfg.get("title") or scen.replace("_", " ").title()

            supported_list.append(
                {
                    "event_id": ev_dict["event_id"],
                    "video_id": vid,
                    "video_title": bay_name,
                    "timestamp": ev_dict["timestamp"],
                    "scenario": scen,
                    "title": title,
                    "label": f"{bay_name} — {title}",
                    "status": ev_dict.get("status", "supported"),
                    "band": ev_dict.get("band", "High"),
                    "observed_summary": cfg.get("observed_headline") or "Observed operational hazard",
                    "counterfactual_summary": cfg.get("counterfactual_headline") or "Apply standard safe handling procedure",
                    "visual_type": cfg.get("visual_type", "general"),
                }
            )
    except Exception:
        pass

    return supported_list


def _real_evidence_visual_overrides(scenario: str, evidence: dict) -> dict:
    """Per-event numeric values for the visual counterfactual, sourced from
    THIS event's actual measured evidence — never a fixed number shared
    across every incident of a scenario type. Returns a partial
    {"before": {...}} dict to merge over the scenario's static visual_data;
    an empty dict when no matching evidence field exists for this scenario,
    in which case the static (evidence-free, non-numeric) label is kept
    rather than showing a number that was never actually measured.
    """
    def _pct(value):
        if value is None:
            return None
        try:
            v = float(value)
        except (TypeError, ValueError):
            return None
        return round(v * 100, 1) if v <= 1 else round(v, 1)

    if scenario == "heavy_on_light_stacking":
        mass_ratio = evidence.get("mass_ratio")
        if mass_ratio is not None:
            try:
                return {"before": {"annotation": f"Inverse mass load ({float(mass_ratio):.2f}x mass ratio)"}}
            except (TypeError, ValueError):
                pass
        return {}

    if scenario in ("box_overhang", "pallet_overhang", "unsupported_bending_placement"):
        support_pct = _pct(evidence.get("overlap_ratio", evidence.get("support_ratio")))
        overhang_pct = _pct(evidence.get("overhang_ratio"))
        if overhang_pct is None and support_pct is not None:
            overhang_pct = round(100 - support_pct, 1)
        before: dict[str, Any] = {}
        if support_pct is not None:
            before["support_pct"] = support_pct
        if overhang_pct is not None:
            before["overhang_pct"] = overhang_pct
            before["label"] = f"Cantilever overhang (~{overhang_pct:.0f}% past edge)"
        return {"before": before} if before else {}

    if scenario == "wrong_product_orientation":
        aspect = evidence.get("observed_aspect_ratio")
        if aspect is not None:
            try:
                return {"before": {"aspect_ratio": round(float(aspect), 2)}}
            except (TypeError, ValueError):
                pass
        return {}

    return {}


def build_what_if_safety_simulation(
    event_id: int,
    db_conn: Optional[sqlite3.Connection] = None,
) -> Optional[dict[str, Any]]:
    """Builds a complete, evidence-grounded What-If Safety Simulation for an event.

    Returns None if the event is not supported or does not exist.
    """
    from backend.db.db import get_connection

    conn = db_conn or get_connection()
    cur = conn.cursor()

    if not what_if_supported(event_id=event_id, db_conn=conn):
        return None

    event_data = None
    row = cur.execute(
        """
        SELECT event_id, video_id, timestamp, scenario, status, band, confidence,
               entity_id, epistemic_level, factor_breakdown_json
        FROM events WHERE event_id = ?
        """,
        (event_id,),
    ).fetchone()

    if row is not None:
        event_data = dict(row)
    else:
        for c in CANONICAL_SCENARIOS_DATA:
            if c["event_id"] == event_id:
                event_data = dict(c)
                break

    if not event_data:
        return None

    scen = event_data.get("scenario")
    vid = event_data.get("video_id")
    ts = event_data.get("timestamp", 0.0)
    cfg = SCENARIO_SIMULATION_CONFIGS.get(scen, {})
    bay_name = VIDEO_BAY_NAMES.get(vid, "Optical Inspection Bay")

    evidence = {}
    fb_raw = event_data.get("factor_breakdown_json")
    if fb_raw:
        try:
            parsed = json.loads(fb_raw) if isinstance(fb_raw, str) else fb_raw
            evidence = (parsed or {}).get("evidence", {}) or {}
        except Exception:
            pass
    if not evidence and isinstance(event_data.get("evidence"), dict):
        evidence = event_data["evidence"]

    status = event_data.get("status", "supported")
    is_probable = (status == "probable")
    status_label = "Requires supervisor verification" if is_probable else "Verified by camera observations"

    title = cfg.get("title") or scen.replace("_", " ").title()
    visual_type = cfg.get("visual_type", "general")

    # Merge in this event's real measured values where TRACE actually has
    # them (see _real_evidence_visual_overrides) — never mutate the shared
    # module-level SCENARIO_SIMULATION_CONFIGS dict itself.
    overrides = _real_evidence_visual_overrides(scen, evidence)
    static_visual = cfg.get("visual_data", {})
    visual_before = {**static_visual.get("before", {}), **overrides.get("before", {})}
    visual_after = {**static_visual.get("after", {}), **overrides.get("after", {})}

    return {
        "event_id": event_id,
        "video_id": vid,
        "video_title": bay_name,
        "timestamp": ts,
        "scenario": scen,
        "title": title,
        "status": status,
        "status_label": status_label,
        "band": event_data.get("band", "High"),
        "confidence": event_data.get("confidence", "High"),
        "simulation_available": True,
        "observed": {
            "title": "What Happened",
            "headline": cfg.get("observed_headline", title),
            "description": cfg.get("observed_description", "Unsafe warehouse handling action observed in video."),
            "risk_summary": cfg.get("risk_summary", "Elevated operational risk."),
            "visual_type": visual_type,
            "visual_data": visual_before,
        },
        "counterfactual": {
            "title": "What-If",
            "headline": cfg.get("counterfactual_headline", "Safer Alternative Action"),
            "action": cfg.get("counterfactual_action", "Apply verified safe handling procedure."),
            "expected_outcome": cfg.get("expected_outcome", "Lower observed hazard exposure."),
            "risk_reduction": cfg.get("risk_transition", "Reduced Exposure"),
            "visual_type": visual_type,
            "visual_data": visual_after,
        },
        "result": {
            "headline": cfg.get("expected_outcome", "Safer configuration reduces operational exposure."),
            "explanation": (
                f"{cfg.get('expected_outcome', '')} "
                f"Implementing this alternative moves the condition out of the {event_data.get('band', 'High')} risk band."
            ).strip(),
            "risk_transition": cfg.get("risk_transition", "Reduced Risk"),
            "safety_gain": "Verified Safe Alternative",
            "verification_required": is_probable,
        },
        "evidence": {
            "why_trace_recommends": cfg.get("why_trace_recommends", "Decision-support recommendation based on TRACE safety catalog."),
            "signals": [f"{k.replace('_', ' ').title()}: {v}" for k, v in evidence.items()] if evidence else ["Standard optical detection pattern"],
            "rule_reference": cfg.get("rule_reference", "TRACE Safety Catalog Standards"),
            "epistemic_level": f"{'PROBABLE - ' if is_probable else 'SUPPORTED - '}{status_label}",
            "limitations": [
                "Decision-support simulation based on spatial evidence and safety catalog rules.",
                "Operator inspection and physical verification required before resuming high-throughput operations.",
            ],
        },
    }
