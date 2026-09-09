"""Human-readable label maps for the grounded assistant.

The event store records machine keys (``scenario``, ``lens``, ``status``,
``evidence`` keys). The assistant's job is to say them in plain language, so
these maps turn raw keys into the wording a supervisor reads aloud. They are
presentation-only: the underlying keys are still returned in ``data`` for the
UI to link back to real records.
"""

from __future__ import annotations

from backend.planner.actions import _SCENARIO_RISK_TITLES

LENS_LABELS = {
    "structural": "structural stability",
    "behaviour": "worker handling behaviour",
    "conformance": "process conformance",
    "environmental": "environmental safety",
}

STATUS_LABELS = {
    "supported": "supported by evidence",
    "probable": "probable (needs verification)",
    "insufficient_evidence": "insufficient evidence",
    "unsupported": "unsupported by available evidence",
}

EVIDENCE_LABELS = {
    "overlap_ratio": "base overlap",
    "horizontal_overlap_ratio": "horizontal deck overlap",
    "vertical_overlap_ratio": "vertical overlap",
    "vertical_gap": "vertical gap",
    "overhang_ratio": "overhang fraction",
    "support_ratio": "support coverage",
    "mass_ordering": "weight distribution",
    "mass_ratio": "mass ratio",
    "velocity_norm": "movement speed",
    "acceleration": "acceleration",
    "duration_s": "duration observed",
    "displacement_px": "pixel displacement",
    "distance_to_edge": "distance to edge",
    "zone_type": "zone classification",
    "iou": "spatial overlap",
    "angle_deg": "tilt angle",
    "tier_count": "stack tier count",
    "sku_id": "product SKU",
    "equipment_type": "equipment type",
    "step_count": "frame occurrences",
    "persistence_frames": "consecutive frames tracked",
}


CAMERA_LABELS = {
    "93e4b1963c6fcd97": "Camera 1 - Loading Dock Bay",
    "d2984c4eb1cf6b86": "Camera 2 - Pallet Staging Deck",
    "734f165d61afafa0": "Camera 3 - Inbound Transit Aisle (Wet Zone)",
    "ac99ff34e1bd2c13": "Camera 4 - Carton Unloading Bay",
    "f15ad7e2295d190b": "Camera 5 - High-Density Racking Area",
    "70063d8b35d1fa9a": "Camera 6 - Bulk Cargo Dispatch",
    "44f245313615d3a1": "Camera 7 - Furniture & Seating Prep",
}

SCENARIO_DESCRIPTIONS = {
    "box_overhang": {
        "title": "Unstable Carton Overhang Beyond Base",
        "description": "Carton center-of-mass overhangs the supporting pallet deck edge by >30%. Cantilever gravity moment will cause package tipping and falling under minimal vibration.",
        "prevention": "Shift carton inward by at least 15cm; ensure at least 70% of carton surface rests securely on the deck before placing subsequent layers.",
    },
    "heavy_on_light": {
        "title": "Heavy Cargo Placed on Top of Light/Fragile Cartons",
        "description": "Top-heavy mass inversion where heavy cartons rest on lighter or crushable packages, exceeding structural compression limits.",
        "prevention": "Re-sequence stacking order: heavy and rigid items form the foundation tier; light, crushable, and fragile merchandise must only occupy upper tiers.",
    },
    "stack_lean": {
        "title": "Vertical Carton Stack Leaning Past Critical Tilt",
        "description": "Stack lean exceeds safe threshold (>6°). Vertical projection of center-of-gravity shifts outside the footprint base, causing collapse.",
        "prevention": "De-stack upper tiers immediately, square bottom cartons flush against alignment guides, and re-stack with interlocking pattern.",
    },
    "base_support_deficit": {
        "title": "Inadequate Base Surface Support Coverage",
        "description": "Carton base has less than 50% contact with supporting pallets or underlying tiers, creating localized shear stress points.",
        "prevention": "Ensure cartons span at least two pallet deck boards or an underlying carton pair to distribute downward load evenly.",
    },
    "dock_edge_proximity": {
        "title": "Hazardous Proximity to Open Dock Edge",
        "description": "Worker or unbraked equipment observed within 1.0m of an open loading dock edge without fall protection barriers.",
        "prevention": "Halt operation immediately, maintain minimum 1.5m safety perimeter from dock drop-offs, and engage dock safety nets or barriers.",
    },
    "wet_floor_transit": {
        "title": "Rapid Transit Across Slippery Wet Zone",
        "description": "Personnel or material transport carts moving across active wet floor spill areas, risking loss of traction and tip-overs.",
        "prevention": "Erect caution cones, slow transit speed to walking pace (<0.5m/s), and deploy absorbent cleanup pads prior to heavy cart passage.",
    },
    "dropping_carton": {
        "title": "Sudden Carton Drop / Freefall Impact",
        "description": "Package released in freefall with downward acceleration spikes (>2.0g) leading to high-impact shock and structural carton fracture.",
        "prevention": "Maintain two-handed controlled lowering to floor level; use mechanical lift assists or scissor tables for parcels above 15kg.",
    },
    "dragging_heavy_box": {
        "title": "Dragging Heavy Packaging Across Concrete Floor",
        "description": "Abrasive friction against concrete rips carton bottom seams, destabilizing interior contents and causing structural box collapse.",
        "prevention": "Use hand trucks, pallet jacks, or team lifting; never drag corrugated packaging across unpolished warehouse concrete.",
    },
    "stepping_on_cartons": {
        "title": "Stepping or Standing Directly on Cartons",
        "description": "Worker using stored merchandise as makeshift stepladder. Concentrated point load instantly crushes carton top flaps.",
        "prevention": "Use certified warehouse rolling ladders or step stools; stepping on inventory is strictly prohibited.",
    },
    "throwing_cartons": {
        "title": "Tossing / Throwing Parcels Between Stations",
        "description": "Parabolic ballistic package trajectory. Uncontrolled kinetic energy upon landing crushes carton corners and compromises contents.",
        "prevention": "Enforce hand-to-hand parcel transfer or use roller conveyors rather than tossing packages across aisles.",
    },
    "throwing_mattresses": {
        "title": "Uncontrolled Bulk Mattress Throwing into Hold",
        "description": "Heaving large mattresses into truck beds causes unpredictable rebound impact against adjacent fragile carton stacks.",
        "prevention": "Two-person coordinated carry with controlled set-down against bulkheads.",
    },
    "strap_lift_hazard": {
        "title": "Lifting Cargo Solely by External Straps",
        "description": "Hoisting heavy merchandise by plastic shipping bands rather than product base. High risk of strap snapping and dropped cargo.",
        "prevention": "Support product from underneath; straps are binding materials, not load-bearing handles.",
    },
    "vertical_orientation_violation": {
        "title": "Orientation Violation (Upright Product Placed Horizontally)",
        "description": "Products labeled 'This Side Up' or tall items placed on their side, risking internal component shifting and fluid leaks.",
        "prevention": "Verify SKU orientation markings on packaging; maintain vertical aspect ratio as specified in warehouse product manifest.",
    },
    "unstable_pallet_pyramid": {
        "title": "Top-Heavy Pyramid Stacking Geometry",
        "description": "Upper tiers exceed lower tier dimensions, creating an inverted pyramid configuration prone to rotational tip-over.",
        "prevention": "Build column or interlocking chimney stacks where each tier is equal to or narrower than the supporting base tier.",
    },
}


def scenario_title(key: str | None) -> str:
    if not key:
        return "an observed condition"
    return _SCENARIO_RISK_TITLES.get(key) or key.replace("_", " ")


def lens_label(key: str | None) -> str:
    if not key:
        return "operational"
    return LENS_LABELS.get(key, key)


def status_label(key: str | None) -> str:
    if not key:
        return "unknown"
    return STATUS_LABELS.get(key, key)


def evidence_label(key: str) -> str:
    if not key:
        return "measurement"
    return EVIDENCE_LABELS.get(key, key.replace("_", " "))


def format_evidence_value(key: str, value: object) -> str:
    """Render an evidence value in plain units (ratios become percentages)."""
    if value is None:
        return "—"
    if isinstance(value, bool):
        return "yes" if value else "no"
    if isinstance(value, (int, float)):
        k = (key or "").lower()
        if any(t in k for t in ("ratio", "overlap", "fraction", "percent", "coverage")):
            v = float(value)
            pct = v * 100 if v <= 1 else v
            return f"{pct:.0f}%"
        if "speed" in k or "velocity" in k:
            return f"{value:.2f}/s"
        if "duration" in k or k.endswith("_s"):
            return f"{value:.1f}s"
        return str(value)
    return str(value)


def camera_label(video_id: str | None) -> str:
    if not video_id:
        return "Warehouse Camera Feed"
    for vid, name in CAMERA_LABELS.items():
        if vid in video_id:
            return name
    return f"Camera ({video_id[:8]})"


def scenario_description(key: str | None) -> dict:
    if not key:
        return {"title": "Operational Condition", "description": "Standard warehouse handling protocol.", "prevention": "Follow standard safety guidelines."}
    return SCENARIO_DESCRIPTIONS.get(key, {
        "title": scenario_title(key),
        "description": f"Operational hazard flagged under {scenario_title(key)}.",
        "prevention": "Follow standard warehouse safety protocol and ergonomic handling guidelines.",
    })

