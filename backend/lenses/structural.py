"""Structural Intelligence lens (Phase 5, Priority 4).

Reuses backend/world_model/scene_graph.py's SUPPORT edges directly — no
second geometry engine, no duplicate stability calculation. This lens only
reinterprets an already-computed image-space support hypothesis as an
evidence-aware RiskEvent, for class pairs where "stacking" is even a
coherent concept.

CLAUDE.md/Phase 5 honesty rule: SceneGraphEdge(SUPPORT) is already labeled
an "image-space hypothesis, not verified physical support" in
docs/WORLD_MODEL.md — this lens preserves that distinction rather than
upgrading it. A PERSON<->PERSON support edge (two people standing close,
one bbox partly above the other in a crowd — the exact false-positive
documented in docs/WORLD_MODEL.md) is NEVER reported as carton/pallet
stacking; that pair is simply not in `_VALID_SUPPORT_PAIRS`.
"""

from __future__ import annotations

from backend.contracts.models import (
    EntityClass,
    EventType,
    MassClass,
    ProductMetadata,
    RiskEvent,
    RiskLens,
    SceneGraphEdgeType,
    SceneGraphSnapshot,
)
from backend.planner.actions import recommended_action
from backend.risk.aggregation import evidence_quality, status_and_confidence
from backend.risk.config import DEFAULT_RISK_CONFIG, RiskConfig

# The only class pairs for which an image-space SUPPORT edge is even
# treated as a structural stacking hypothesis. Order-independent —
# PERSON<->PERSON is deliberately absent (Phase 5 spec: "must NOT treat
# PERSON-PERSON support as carton stacking").
_VALID_SUPPORT_PAIRS = {
    frozenset({EntityClass.PERSON, EntityClass.BOX}),
    frozenset({EntityClass.BOX, EntityClass.BOX}),
    frozenset({EntityClass.BOX, EntityClass.PALLET}),
    frozenset({EntityClass.PERSON, EntityClass.PALLET}),
}


def evaluate_structural(
    snapshot: SceneGraphSnapshot,
    *,
    entity_confidence: dict[str, float],
    config: RiskConfig = DEFAULT_RISK_CONFIG,
    product_metadata_by_id: dict[str, ProductMetadata] | None = None,
) -> list[RiskEvent]:
    """`entity_confidence` maps Entity.id -> detection confidence for the
    same frame the snapshot was built from — SceneGraphNode itself carries
    no confidence field, so the caller (the findings API) passes it in
    alongside the snapshot."""
    nodes_by_id = {node.entity_id: node for node in snapshot.nodes}
    findings: list[RiskEvent] = []

    for edge in snapshot.edges:
        if edge.edge_type != SceneGraphEdgeType.SUPPORT:
            continue

        supporter = nodes_by_id.get(edge.source_id)
        supported = nodes_by_id.get(edge.target_id)
        if supporter is None or supported is None:
            continue

        pair = frozenset({supporter.entity_class, supported.entity_class})
        if pair not in _VALID_SUPPORT_PAIRS:
            continue  # e.g. PERSON<->PERSON — never reported as stacking

        mean_conf = (
            entity_confidence.get(supporter.entity_id, 0.0)
            + entity_confidence.get(supported.entity_id, 0.0)
        ) / 2.0
        score = evidence_quality(
            mean_detection_confidence=mean_conf,
            entity_classes=[supporter.entity_class, supported.entity_class],
            sample_count=1,
            min_expected_samples=1,
        )
        status, confidence = status_and_confidence(score, config)

        overlap_ratio = edge.evidence.get("horizontal_overlap_ratio", 1.0)
        scenario = "image_space_support_hypothesis"
        explanation = (
            f"{supported.entity_class.value} appears, in 2D image space, to rest on "
            f"{supporter.entity_class.value} (vertical_gap="
            f"{edge.evidence.get('vertical_gap')}, horizontal_overlap_ratio="
            f"{edge.evidence.get('horizontal_overlap_ratio')}). This is an image-space "
            "support HYPOTHESIS, not verified physical support — no camera calibration "
            "or depth exists to confirm actual contact."
        )

        # Scenario 1: Heavy-on-light stacking when product metadata is linked
        if product_metadata_by_id and supporter.product_id and supported.product_id:
            supporter_meta = product_metadata_by_id.get(supporter.product_id)
            supported_meta = product_metadata_by_id.get(supported.product_id)
            if supporter_meta and supported_meta:
                mass_order = {MassClass.LIGHT: 1, MassClass.MEDIUM: 2, MassClass.HEAVY: 3}
                supp_rank = mass_order.get(supporter_meta.mass_class, 0)
                suppd_rank = mass_order.get(supported_meta.mass_class, 0)
                if suppd_rank > supp_rank:
                    scenario = "heavy_on_light_stacking"
                    explanation = (
                        f"Heavy item '{supported.product_id}' ({supported_meta.mass_class.value}) rests on "
                        f"lighter item '{supporter.product_id}' ({supporter_meta.mass_class.value}). "
                        "Reverse-mass stacking creates severe carton crushing and stack instability risk."
                    )

        # Scenario 8 & 14: Pallet/Box Overhang and Unsupported Bending Placement
        if scenario == "image_space_support_hypothesis" and supported.entity_class == EntityClass.BOX and supporter.entity_class in (EntityClass.PALLET, EntityClass.BOX):
            if overlap_ratio < 0.50:
                scenario = "unsupported_bending_placement"
                explanation = (
                    f"Box has only {overlap_ratio:.0%} horizontal support on {supporter.entity_class.value} "
                    "(greater than 50% overhang), leaving the span unsupported and subject to excessive bending and tipping. "
                    "This is an image-space projection hypothesis, not verified physical load-bearing contact."
                )
            elif overlap_ratio < 0.75:
                scenario = "pallet_overhang" if supporter.entity_class == EntityClass.PALLET else "box_overhang"
                explanation = (
                    f"Box has significant base overhang past {supporter.entity_class.value} support "
                    f"({overlap_ratio:.0%} horizontal overlap ratio). Base overhang creates eccentric loading and tipping risk. "
                    "This is an image-space projection hypothesis, not verified physical load-bearing contact."
                )
        elif scenario == "image_space_support_hypothesis" and supported.entity_class == EntityClass.PERSON and supporter.entity_class == EntityClass.BOX:
            scenario = "stepping_on_carton"
            explanation = (
                f"Worker appears, in 2D image space, to rest on box (vertical_gap="
                f"{edge.evidence.get('vertical_gap')}, horizontal_overlap_ratio="
                f"{edge.evidence.get('horizontal_overlap_ratio')}). Worker body weight "
                "applied to carton creates packaging collapse and personnel fall hazards. "
                "This is an image-space support hypothesis, not verified physical contact."
            )

        findings.append(
            RiskEvent(
                timestamp=snapshot.timestamp,
                event_type=EventType.RISK,
                lens=RiskLens.STRUCTURAL,
                entity_id=supported.entity_id,
                confidence=confidence,
                status=status,
                scenario=scenario,
                entities=[supporter.entity_id, supported.entity_id],
                evidence={
                    **edge.evidence,
                    "supporter_class": supporter.entity_class.value,
                    "supported_class": supported.entity_class.value,
                    "mean_detection_confidence": mean_conf,
                },
                explanation=explanation,
                recommended_action=recommended_action(scenario, status),
                limitations=["image_space_only", "no_depth_or_calibration"],
            )
        )

    return findings
