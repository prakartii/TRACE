"""Alternative Placement Generator (Phase 7B).

Generates scene-aware, geometrically feasible alternative placement candidates
for structural and conformance risk findings.

NON-NEGOTIABLE EPISTEMIC RULES:
1. No impossible candidates (outside frame, through other objects, degenerate).
2. Pure deterministic candidate generation from observed world model geometry.
3. Every candidate is scored with TRACE Stability Scoring Engine and ranked.
"""

from __future__ import annotations

from typing import Optional

from backend.contracts.models import (
    BoundingBox,
    EntityClass,
    PlacementCandidate,
    RiskBand,
    SceneGraphNode,
    SceneGraphSnapshot,
    ProductMetadata,
)
from backend.planner.stability import compute_stability_score
from backend.world_model.geometry import (
    bbox_center,
    bbox_is_degenerate,
    intersection_over_union,
)


def _clamp_bbox(bbox: BoundingBox) -> BoundingBox:
    """Ensures bounding box stays strictly within normalized [0, 1] frame bounds."""
    w = bbox.x2 - bbox.x1
    h = bbox.y2 - bbox.y1
    x1 = max(0.01, min(0.99 - w, bbox.x1))
    y1 = max(0.01, min(0.99 - h, bbox.y1))
    x2 = min(0.99, x1 + w)
    y2 = min(0.99, y1 + h)
    return BoundingBox(x1=round(x1, 4), y1=round(y1, 4), x2=round(x2, 4), y2=round(y2, 4))


# Support-deck margin: a candidate whose footprint extends past the support
# node's horizontal extent by more than this (normalized) is off the deck.
_SUPPORT_EXTENT_MARGIN = 0.05


def _check_person_collision(candidate_box: BoundingBox, snapshot: SceneGraphSnapshot) -> bool:
    """Returns True if candidate collides significantly with any person in the scene."""
    for node in snapshot.nodes:
        if node.entity_class == EntityClass.PERSON and node.footprint:
            if intersection_over_union(candidate_box, node.footprint) > 0.20:
                return True
    return False


def _check_cargo_collision(
    candidate_box: BoundingBox,
    snapshot: SceneGraphSnapshot,
    *,
    target_id: str,
    support_id: Optional[str],
) -> bool:
    """True if the candidate overlaps another cargo/structural entity (not the
    target being moved and not its own support deck)."""
    for node in snapshot.nodes:
        if node.entity_class == EntityClass.PERSON or not node.footprint:
            continue
        if node.entity_id in (target_id, support_id):
            continue
        if intersection_over_union(candidate_box, node.footprint) > 0.10:
            return True
    return False


def _off_support_deck(candidate_box: BoundingBox, support_box: Optional[BoundingBox]) -> bool:
    """True if the candidate protrudes past the support deck's horizontal extent
    by more than the allowed margin (an unsupported cantilever placement)."""
    if support_box is None:
        return False
    left = support_box.x1 - candidate_box.x1
    right = candidate_box.x2 - support_box.x2
    return max(left, 0.0) + max(right, 0.0) > _SUPPORT_EXTENT_MARGIN


def generate_placement_candidates(
    target_node: SceneGraphNode,
    supporting_node: Optional[SceneGraphNode],
    snapshot: SceneGraphSnapshot,
    *,
    scenario_key: str,
    product_metadata_by_id: Optional[dict[str, ProductMetadata]] = None,
    current_score: float = 0.0,
) -> list[PlacementCandidate]:
    """Generates 2-3 scene-aware, geometrically feasible alternative placements."""
    if target_node.footprint is None or bbox_is_degenerate(target_node.footprint):
        return []

    target_box = target_node.footprint
    target_w = target_box.x2 - target_box.x1
    target_h = target_box.y2 - target_box.y1
    support_box = supporting_node.footprint if (supporting_node and supporting_node.footprint) else None

    target_meta = (
        product_metadata_by_id.get(target_node.product_id)
        if (product_metadata_by_id and target_node.product_id)
        else None
    )
    support_meta = (
        product_metadata_by_id.get(supporting_node.product_id)
        if (product_metadata_by_id and supporting_node and supporting_node.product_id)
        else None
    )

    raw_candidates: list[dict] = []

    # --------------------------------------------------------------------------
    # Scenario 1: Heavy on light stacking
    # --------------------------------------------------------------------------
    if scenario_key == "heavy_on_light_stacking":
        # Candidate A: Move heavy item to base tier (ground level adjacent to stack)
        floor_y2 = 0.88
        base_box = BoundingBox(
            x1=max(0.05, target_box.x1 - target_w - 0.05),
            y1=floor_y2 - target_h,
            x2=max(0.05, target_box.x1 - target_w - 0.05) + target_w,
            y2=floor_y2,
        )
        raw_candidates.append({
            "id": "cand_base_tier",
            "desc": "Reposition heavy carton to base tier directly on floor level",
            "footprint": _clamp_bbox(base_box),
            "is_base": True,
            "supp_box": None,
            "supp_meta": None,
            "relationship": "ground_support",
        })

        # Candidate B: Invert stack order (place heavy item as base, light on top)
        if support_box:
            inverted_box = BoundingBox(
                x1=support_box.x1,
                y1=support_box.y1,
                x2=support_box.x1 + target_w,
                y2=support_box.y1 + target_h,
            )
            raw_candidates.append({
                "id": "cand_invert_stack",
                "desc": "Place heavy carton as base support with lighter package on top",
                "footprint": _clamp_bbox(inverted_box),
                "is_base": True,
                "supp_box": None,
                "supp_meta": None,
                "relationship": "base_foundation",
            })

        # Candidate C: Center on base support deck
        if support_box:
            supp_cx = (support_box.x1 + support_box.x2) / 2.0
            centered_box = BoundingBox(
                x1=supp_cx - target_w / 2.0,
                y1=support_box.y1 - target_h,
                x2=supp_cx + target_w / 2.0,
                y2=support_box.y1,
            )
            raw_candidates.append({
                "id": "cand_center_support",
                "desc": "Center heavy carton footprint evenly on supporting foundation",
                "footprint": _clamp_bbox(centered_box),
                "is_base": False,
                "supp_box": support_box,
                "supp_meta": support_meta,
                "relationship": "centered_tier",
            })

    # --------------------------------------------------------------------------
    # Scenario 8, 9, 14: Overhang and Unsupported Bending Placement
    # --------------------------------------------------------------------------
    elif scenario_key in ("pallet_overhang", "box_overhang", "unsupported_bending_placement", "image_space_support_hypothesis"):
        if support_box:
            supp_cx = (support_box.x1 + support_box.x2) / 2.0
            supp_w = support_box.x2 - support_box.x1

            # Candidate A: Centered on support deck (eliminates overhang)
            centered_box = BoundingBox(
                x1=supp_cx - target_w / 2.0,
                y1=support_box.y1 - target_h,
                x2=supp_cx + target_w / 2.0,
                y2=support_box.y1,
            )
            raw_candidates.append({
                "id": "cand_center_support",
                "desc": "Center carton on supporting deck footprint to eliminate cantilever overhang",
                "footprint": _clamp_bbox(centered_box),
                "is_base": False,
                "supp_box": support_box,
                "supp_meta": support_meta,
                "relationship": "centered_support",
            })

            # Candidate B: Inward translation with 10% safety margin
            if target_box.x1 < support_box.x1:
                # Left overhang: shift right
                shift = (support_box.x1 - target_box.x1) + 0.05 * supp_w
            else:
                # Right overhang: shift left
                shift = (support_box.x2 - target_box.x2) - 0.05 * supp_w

            inward_box = BoundingBox(
                x1=target_box.x1 + shift,
                y1=target_box.y1,
                x2=target_box.x2 + shift,
                y2=target_box.y2,
            )
            raw_candidates.append({
                "id": "cand_inward_shift",
                "desc": "Translate carton inward past support boundary with positive margin",
                "footprint": _clamp_bbox(inward_box),
                "is_base": False,
                "supp_box": support_box,
                "supp_meta": support_meta,
                "relationship": "aligned_flush_support",
            })

            # Candidate C: Rotate 90 degrees if rotated width fits support deck better
            rotated_w, rotated_h = target_h, target_w
            rotated_box = BoundingBox(
                x1=supp_cx - rotated_w / 2.0,
                y1=support_box.y1 - rotated_h,
                x2=supp_cx + rotated_w / 2.0,
                y2=support_box.y1,
            )
            raw_candidates.append({
                "id": "cand_rotate_90",
                "desc": "Rotate carton 90° to optimize footprint aspect ratio against support deck",
                "footprint": _clamp_bbox(rotated_box),
                "is_base": False,
                "supp_box": support_box,
                "supp_meta": support_meta,
                "relationship": "rotated_support",
            })

    # --------------------------------------------------------------------------
    # Scenario 7: Wrong product orientation
    # --------------------------------------------------------------------------
    elif scenario_key == "wrong_product_orientation":
        # Upright vertical orientation: swap width and height around center
        cx, cy = bbox_center(target_box)
        vert_w = min(target_w, target_h)
        vert_h = max(target_w, target_h)

        upright_box = BoundingBox(
            x1=cx - vert_w / 2.0,
            y1=cy - vert_h / 2.0,
            x2=cx + vert_w / 2.0,
            y2=cy + vert_h / 2.0,
        )
        raw_candidates.append({
            "id": "cand_upright_orientation",
            "desc": "Rotate package upright to required vertical 'This-Side-Up' orientation",
            "footprint": _clamp_bbox(upright_box),
            "is_base": support_box is None,
            "supp_box": support_box,
            "supp_meta": support_meta,
            "relationship": "upright_placement",
        })

        if support_box:
            supp_cx = (support_box.x1 + support_box.x2) / 2.0
            centered_upright = BoundingBox(
                x1=supp_cx - vert_w / 2.0,
                y1=support_box.y1 - vert_h,
                x2=supp_cx + vert_w / 2.0,
                y2=support_box.y1,
            )
            raw_candidates.append({
                "id": "cand_upright_centered",
                "desc": "Rotate upright and center on supporting base deck",
                "footprint": _clamp_bbox(centered_upright),
                "is_base": False,
                "supp_box": support_box,
                "supp_meta": support_meta,
                "relationship": "centered_upright_support",
            })

    # --------------------------------------------------------------------------
    # Fallback generic candidate generation
    # --------------------------------------------------------------------------
    if not raw_candidates:
        if support_box:
            supp_cx = (support_box.x1 + support_box.x2) / 2.0
            centered_box = BoundingBox(
                x1=supp_cx - target_w / 2.0,
                y1=support_box.y1 - target_h,
                x2=supp_cx + target_w / 2.0,
                y2=support_box.y1,
            )
            raw_candidates.append({
                "id": "cand_center_support",
                "desc": "Center item on supporting footprint",
                "footprint": _clamp_bbox(centered_box),
                "is_base": False,
                "supp_box": support_box,
                "supp_meta": support_meta,
                "relationship": "centered_support",
            })
        else:
            # Base-tier / floor-level candidate when no support box was identified
            floor_y2 = min(0.92, max(0.70, target_box.y2))
            cand_box = BoundingBox(
                x1=max(0.02, min(0.98 - target_w, target_box.x1)),
                y1=max(0.02, floor_y2 - target_h),
                x2=max(0.02, min(0.98 - target_w, target_box.x1)) + target_w,
                y2=floor_y2,
            )
            raw_candidates.append({
                "id": "cand_floor_staging",
                "desc": "Place carton safely at ground/floor level in designated staging footprint",
                "footprint": _clamp_bbox(cand_box),
                "is_base": True,
                "supp_box": None,
                "supp_meta": None,
                "relationship": "ground_support",
            })
            adj_x1 = max(0.05, min(0.90 - target_w, target_box.x1 + 0.12))
            adj_box = BoundingBox(
                x1=adj_x1,
                y1=max(0.02, floor_y2 - target_h),
                x2=adj_x1 + target_w,
                y2=floor_y2,
            )
            raw_candidates.append({
                "id": "cand_floor_adjacent",
                "desc": "Translate carton to clear floor footprint with adequate clearance",
                "footprint": _clamp_bbox(adj_box),
                "is_base": True,
                "supp_box": None,
                "supp_meta": None,
                "relationship": "ground_support",
            })

    # Evaluate each candidate deterministically
    target_id = target_node.entity_id
    support_id = supporting_node.entity_id if supporting_node else None
    candidates: list[PlacementCandidate] = []
    for cand in raw_candidates:
        fp = cand["footprint"]

        # Hard feasibility constraints — a candidate that fails any of these is
        # kept (so the operator sees why) but flagged infeasible so it is never
        # auto-selected as the recommendation.
        person_collision = _check_person_collision(fp, snapshot)
        cargo_collision = _check_cargo_collision(
            fp, snapshot, target_id=target_id, support_id=support_id
        )
        off_deck = not cand["is_base"] and _off_support_deck(fp, cand["supp_box"])
        at_frame_edge = fp.x1 <= 0.011 or fp.y1 <= 0.011 or fp.x2 >= 0.989 or fp.y2 >= 0.989
        degenerate = bbox_is_degenerate(fp)
        feasible = not (
            person_collision or cargo_collision or off_deck or at_frame_edge or degenerate
        )

        # Compute stability score for candidate
        stab = compute_stability_score(
            fp,
            cand["supp_box"],
            target_product=target_meta,
            support_product=cand["supp_meta"],
            is_base_tier=cand["is_base"],
        )

        cx, cy = bbox_center(fp)
        band = RiskBand.LOW if stab.score >= 70.0 else (RiskBand.MEDIUM if stab.score >= 40.0 else RiskBand.HIGH)
        delta = round(stab.score - current_score, 1)

        limitations = list(stab.limitations)
        if person_collision:
            limitations.append("Candidate footprint intersects a detected worker position.")
        if cargo_collision:
            limitations.append("Candidate footprint overlaps another cargo or structural entity.")
        if off_deck:
            limitations.append("Candidate protrudes past the supporting deck's extent (unsupported cantilever).")
        if at_frame_edge:
            limitations.append("Candidate is pinned against the frame boundary; the placement may not physically fit.")

        candidates.append(
            PlacementCandidate(
                id=cand["id"],
                description=cand["desc"],
                position=(round(cx, 4), round(cy, 4)),
                footprint=fp,
                score=stab.score,
                band=band,
                hard_constraints_passed=feasible,
                feasibility=feasible,
                support_relationship=cand["relationship"],
                score_breakdown=stab.breakdown,
                score_delta=delta,
                limitations=limitations,
                factor_breakdown={
                    "support_alignment": stab.breakdown.support_alignment,
                    "centering": stab.breakdown.centering,
                    "mass_order": stab.breakdown.mass_order,
                    "overhang_penalty": stab.breakdown.overhang_penalty,
                    "tipping_estimate": stab.breakdown.tipping_estimate,
                },
            )
        )

    # Rank feasible candidates first, then by stability score descending, so the
    # top of the list is always a placement the operator can actually make.
    candidates.sort(key=lambda c: (not c.feasibility, -c.score))
    return candidates
