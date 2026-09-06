"""Deterministic TRACE Stability Scoring Engine (Phase 7B).

Computes an image-space decision-support score (0-100) evaluating geometric
support alignment, footprint centering, mass ordering, orientation conformance,
and overhang penalties.

NON-NEGOTIABLE EPISTEMIC DISCLAIMER:
This score is an image-space decision-support metric, NOT a certified physical
stability measurement. No 3D depth, friction, center of gravity, or mechanical
load-bearing forces are measured by the camera.
"""

from __future__ import annotations

from typing import Optional

from backend.contracts.models import (
    BoundingBox,
    MassClass,
    ProductMetadata,
    StabilityBreakdown,
    StabilityScore,
)
from backend.world_model.geometry import horizontal_overlap_ratio

_MASS_RANK: dict[MassClass, int] = {
    MassClass.LIGHT: 1,
    MassClass.MEDIUM: 2,
    MassClass.HEAVY: 3,
}

STABILITY_DISCLAIMER = (
    "This score is an image-space decision-support metric, not a certified physical stability measurement."
)


def classify_stability(score: float) -> str:
    """Standardized interpretation bands per Phase 7B specification."""
    if score >= 80.0:
        return "high_geometric_support"
    if score >= 60.0:
        return "moderate_geometric_support"
    if score >= 40.0:
        return "weak_geometric_support"
    return "poor_geometric_support"


def compute_stability_score(
    target_footprint: BoundingBox,
    support_footprint: Optional[BoundingBox] = None,
    *,
    target_product: Optional[ProductMetadata] = None,
    support_product: Optional[ProductMetadata] = None,
    is_base_tier: bool = False,
) -> StabilityScore:
    """Deterministically scores an entity placement based on observable image-space
    geometry and linked SKU metadata.

    Score Components (0-100 scale):
    - support_alignment (40% weight): Horizontal overlap ratio with support footprint.
    - centering (20% weight): Center offset alignment relative to support deck.
    - mass_order (20% weight): Proper tiering (heavy at base, light on top).
    - orientation_alignment (20% weight): Conformance to SKU required aspect ratio.
    - overhang_penalty (-25% penalty): Cantilever protrusion extending past support boundaries.
    """
    w_target = max(1e-4, target_footprint.x2 - target_footprint.x1)
    h_target = max(1e-4, target_footprint.y2 - target_footprint.y1)
    aspect_ratio = w_target / h_target

    # 1. Support Alignment
    if is_base_tier:
        support_alignment = 100.0
        support_overlap = 1.0
    elif support_footprint is not None:
        overlap = horizontal_overlap_ratio(target_footprint, support_footprint)
        support_overlap = round(overlap, 3)
        support_alignment = round(min(1.0, max(0.0, overlap)) * 100.0, 1)
    else:
        support_alignment = 0.0
        support_overlap = 0.0

    # 2. Centering Alignment
    if is_base_tier:
        centering = 100.0
    elif support_footprint is not None:
        c_target = (target_footprint.x1 + target_footprint.x2) / 2.0
        c_supp = (support_footprint.x1 + support_footprint.x2) / 2.0
        supp_w = max(1e-4, support_footprint.x2 - support_footprint.x1)
        offset = abs(c_target - c_supp)
        max_offset = supp_w / 2.0
        centering_ratio = max(0.0, 1.0 - (offset / max(1e-4, max_offset)))
        centering = round(centering_ratio * 100.0, 1)
    else:
        centering = 0.0

    # 3. Mass Ordering
    if target_product and support_product and not is_base_tier:
        r_target = _MASS_RANK.get(target_product.mass_class, 2)
        r_supp = _MASS_RANK.get(support_product.mass_class, 2)
        if r_supp > r_target:
            mass_order = 100.0  # Light on heavy (ideal)
        elif r_supp == r_target:
            mass_order = 85.0   # Equal mass
        else:
            diff = r_target - r_supp
            mass_order = 30.0 if diff == 1 else 0.0  # Heavy on light (crushing hazard)
    elif is_base_tier:
        mass_order = 100.0  # Heavy or light at base tier is structurally preferred
    else:
        mass_order = 70.0   # Neutral baseline when metadata unlinked

    # 4. Orientation Conformance
    if target_product and target_product.required_orientation:
        req = target_product.required_orientation.lower()
        if req == "vertical":
            # Height should exceed or roughly equal width
            orientation_alignment = 100.0 if aspect_ratio <= 1.15 else 20.0
        elif req == "horizontal":
            orientation_alignment = 100.0 if aspect_ratio >= 0.85 else 20.0
        else:
            orientation_alignment = 100.0
    else:
        orientation_alignment = 100.0

    # 5. Overhang Penalty
    if is_base_tier:
        overhang_penalty = 0.0
    elif support_footprint is not None:
        left_overhang = max(0.0, support_footprint.x1 - target_footprint.x1)
        right_overhang = max(0.0, target_footprint.x2 - support_footprint.x2)
        total_overhang = left_overhang + right_overhang
        overhang_ratio = min(1.0, total_overhang / w_target)
        overhang_penalty = round(overhang_ratio * 100.0, 1)
    else:
        overhang_penalty = 100.0

    # 6. Combined Weighted TRACE Stability Score
    raw_score = (
        0.40 * support_alignment
        + 0.20 * centering
        + 0.20 * mass_order
        + 0.20 * orientation_alignment
        - 0.25 * overhang_penalty
    )
    final_score = round(max(0.0, min(100.0, raw_score)), 1)
    classification = classify_stability(final_score)

    breakdown = StabilityBreakdown(
        support_alignment=support_alignment,
        centering=centering,
        mass_order=mass_order,
        orientation_alignment=orientation_alignment,
        overhang_penalty=overhang_penalty,
    )

    limitations = [
        STABILITY_DISCLAIMER,
        "Image-space support only; actual contact forces and friction coefficients are unmeasured.",
    ]
    if target_product and target_product.mass_class:
        limitations.append("Mass ordering relies on SKU operational metadata, not real-time weight sensor.")

    return StabilityScore(
        score=final_score,
        classification=classification,
        breakdown=breakdown,
        support_overlap=support_overlap,
        limitations=limitations,
    )
