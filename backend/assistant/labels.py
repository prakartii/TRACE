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
        "title": "Box Overhanging Pallet Edge",
        "description": "The box is sticking out over the edge of the pallet by more than 30%. Any bump or vibration can cause it to tip over and fall.",
        "prevention": "Push the box at least 15cm inward so it sits securely on the pallet before stacking more boxes on top.",
    },
    "heavy_on_light": {
        "title": "Heavy Box Placed on Light Box",
        "description": "A heavy package is stacked on top of a lighter, crushable box. This can crush the bottom box and cause the whole stack to collapse.",
        "prevention": "Always place the heaviest boxes on the bottom tier and lighter, fragile items on upper tiers.",
    },
    "stack_lean": {
        "title": "Leaning Stack of Boxes",
        "description": "The stack is tilting sideways by more than 6 degrees, putting it at high risk of falling over onto workers.",
        "prevention": "Take down the top boxes immediately, align the bottom boxes flat and square, and restack straight.",
    },
    "base_support_deficit": {
        "title": "Box Not Supported Properly",
        "description": "Less than half of the box base is resting on the pallet or box beneath it, making it unstable.",
        "prevention": "Make sure the box spans across at least two pallet deck boards or two underlying boxes.",
    },
    "dock_edge_proximity": {
        "title": "Too Close to Dock Edge",
        "description": "A worker, box, or cart is within 1 meter of an open loading dock ledge without a safety barrier.",
        "prevention": "Step back immediately. Keep all people and cargo at least 1.5 meters away from the dock ledge.",
    },
    "wet_floor_transit": {
        "title": "Moving Across a Wet Floor",
        "description": "Workers or carts moving across wet floor areas, risking slipping, falling, or cart tip-overs.",
        "prevention": "Place yellow caution cones, slow down to a walking pace, and wipe up spills before wheeling heavy carts through.",
    },
    "dropping_carton": {
        "title": "Dropping or Throwing Boxes",
        "description": "Package dropped from waist height or higher, risking damaged goods and broken packaging.",
        "prevention": "Lower boxes gently with two hands all the way down. Ask a coworker for help with packages over 15kg.",
    },
    "dragging_heavy_box": {
        "title": "Dragging Boxes on Concrete",
        "description": "Dragging cardboard boxes across rough concrete scrapes open bottom tape and damages merchandise.",
        "prevention": "Use a pallet jack, hand truck, or team lift. Never drag cardboard boxes along the floor.",
    },
    "stepping_on_cartons": {
        "title": "Standing or Stepping on Boxes",
        "description": "Worker standing on boxes to reach higher items. Cardboard crushes easily and will cause a fall.",
        "prevention": "Use a certified rolling warehouse stepladder. Never stand or climb on boxes.",
    },
    "throwing_cartons": {
        "title": "Tossing Boxes Between Stations",
        "description": "Throwing boxes across aisles damages corners, breaks internal contents, and risks hitting coworkers.",
        "prevention": "Hand boxes directly to coworkers or slide them along roller conveyors.",
    },
    "throwing_mattresses": {
        "title": "Throwing Heavy Items into Trucks",
        "description": "Throwing mattresses or bulky goods roughly can knock over neighboring stacks of boxes.",
        "prevention": "Use a two-person carry and set bulky items down carefully against truck walls.",
    },
    "strap_lift_hazard": {
        "title": "Lifting by Plastic Straps",
        "description": "Lifting heavy boxes by their plastic packaging bands instead of from underneath. Straps can snap and drop cargo.",
        "prevention": "Lift from underneath the box base. Plastic straps are only for bundling, not lifting handles.",
    },
    "vertical_orientation_violation": {
        "title": "Box on its Side or Upside Down",
        "description": "A package marked 'This Side Up' is lying on its side, risking leaks or internal breakage.",
        "prevention": "Check the arrows on the box and keep it standing upright as labeled.",
    },
    "unstable_pallet_pyramid": {
        "title": "Top-Heavy Pyramid Stacking",
        "description": "Upper tiers stick out wider than the bottom pallet base, making the stack top-heavy and ready to tip.",
        "prevention": "Stack boxes straight up or narrower toward the top. Never make upper layers wider than the base.",
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

