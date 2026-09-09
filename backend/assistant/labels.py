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
