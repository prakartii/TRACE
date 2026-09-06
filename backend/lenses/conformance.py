"""Process Conformance lens (Phase 5, Priority 5) — architecture only.

No product metadata (required_orientation, mass_class, allowed_equipment,
stacking_rules, loading_sequence) is linked to any entity anywhere in
TRACE yet — `SceneGraphNode.product_id` is always None (no upstream code
sets it; see backend/world_model/scene_graph.py). So every conformance
"check" here is honestly a no-op producing UNSUPPORTED /
INSUFFICIENT_EVIDENCE, never a guessed violation. This module exists so a
later phase can register real rules without redesigning the pipeline.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Callable, Optional

from backend.contracts.models import (
    ConfidenceLevel,
    EntityClass,
    EventType,
    FindingStatus,
    ProductMetadata,
    RiskEvent,
    RiskLens,
    SceneGraphNode,
)


from backend.planner.actions import recommended_action


@dataclass(frozen=True)
class ConformanceRule:
    """One product/warehouse conformance check. `required_metadata_fields`
    names the ProductMetadata attributes this rule needs populated —
    evaluate_conformance() checks they're non-None before ever calling
    `check`, so a future rule author doesn't have to hand-write that
    guard. `check` returns a violation description string, or None if the
    rule passed."""

    name: str
    required_metadata_fields: tuple[str, ...]
    check: Callable[[SceneGraphNode, ProductMetadata], Optional[str]]


def _check_orientation(node: SceneGraphNode, metadata: ProductMetadata) -> Optional[str]:
    """Evaluates whether the 2D bounding-box aspect ratio conforms to
    the product's specified orientation (Scenario 7). Uses perspective
    tolerance bands to prevent false positives on angled overhead dock camera views."""
    if not metadata.required_orientation:
        return None

    if node.footprint is not None:
        w_norm = node.footprint.x2 - node.footprint.x1
        h_norm = node.footprint.y2 - node.footprint.y1
        # Gate out tiny/distant noisy detections
        if (w_norm * h_norm) < 0.005:
            return None

    if node.orientation is not None:
        aspect = node.orientation
    elif node.footprint is not None:
        aspect = (w_norm / max(h_norm, 1e-6)) * (16.0 / 9.0)
    else:
        return None

    req = metadata.required_orientation.lower()
    # 1.35 threshold provides perspective tolerance for top-face projection in elevated views
    if req in ("vertical", "this-side-up", "upright"):
        if aspect > 1.35:
            return (
                f"Product '{metadata.product_id}' specifies required orientation 'vertical' "
                f"(this-side-up), but observed 2D bounding box is horizontally oriented (aspect ratio {aspect:.2f} > 1.35). "
                "This is an image-space aspect ratio hypothesis against SKU manifest rules; 3D object rotation pose is uncalibrated."
            )
    elif req in ("horizontal", "flat"):
        if aspect < 0.70:
            return (
                f"Product '{metadata.product_id}' specifies required orientation 'horizontal', "
                f"but observed 2D bounding box is vertically oriented (aspect ratio {aspect:.2f} < 0.70). "
                "This is an image-space aspect ratio hypothesis against SKU manifest rules; 3D object rotation pose is uncalibrated."
            )
    return None


ORIENTATION_RULE = ConformanceRule(
    name="wrong_product_orientation",
    required_metadata_fields=("required_orientation",),
    check=_check_orientation,
)

# Standard conformance rules available for runtime evaluation
STANDARD_CONFORMANCE_RULES: list[ConformanceRule] = [
    ORIENTATION_RULE,
]

# Can be populated or overridden dynamically
REGISTERED_RULES: list[ConformanceRule] = []


def evaluate_conformance(
    nodes: list[SceneGraphNode],
    product_metadata_by_id: dict[str, ProductMetadata],
    *,
    timestamp: float,
    rules: list[ConformanceRule] | None = None,
) -> list[RiskEvent]:
    active_rules = REGISTERED_RULES if rules is None else rules
    findings: list[RiskEvent] = []

    # Conformance evaluation applies strictly to cargo entities, never human workers
    cargo_nodes = [n for n in nodes if n.entity_class != EntityClass.PERSON]
    unlinked_cargo_ids: list[str] = []

    for node in cargo_nodes:
        metadata = product_metadata_by_id.get(node.product_id) if node.product_id else None

        if metadata is None or not active_rules:
            unlinked_cargo_ids.append(node.entity_id)
            continue

        for rule in active_rules:
            if any(getattr(metadata, field, None) is None for field in rule.required_metadata_fields):
                findings.append(
                    RiskEvent(
                        timestamp=timestamp,
                        event_type=EventType.RISK,
                        lens=RiskLens.CONFORMANCE,
                        entity_id=node.entity_id,
                        confidence=ConfidenceLevel.LOW,
                        status=FindingStatus.INSUFFICIENT_EVIDENCE,
                        scenario=rule.name,
                        entities=[node.entity_id],
                        evidence={},
                        explanation=f"Rule '{rule.name}' requires metadata that is not populated.",
                        limitations=["incomplete_product_metadata"],
                    )
                )
                continue

            violation = rule.check(node, metadata)
            if violation is None:
                continue

            findings.append(
                RiskEvent(
                    timestamp=timestamp,
                    event_type=EventType.RISK,
                    lens=RiskLens.CONFORMANCE,
                    entity_id=node.entity_id,
                    confidence=ConfidenceLevel.MEDIUM,
                    status=FindingStatus.PROBABLE,
                    scenario=rule.name,
                    entities=[node.entity_id],
                    evidence={"required_orientation": metadata.required_orientation},
                    explanation=violation,
                    recommended_action=recommended_action(rule.name, FindingStatus.PROBABLE),
                    limitations=[],
                )
            )

    # Consolidate all unlinked cargo items into a single operational coverage gap finding
    if unlinked_cargo_ids:
        count = len(unlinked_cargo_ids)
        findings.append(
            RiskEvent(
                timestamp=timestamp,
                event_type=EventType.RISK,
                lens=RiskLens.CONFORMANCE,
                entity_id=unlinked_cargo_ids[0],
                confidence=ConfidenceLevel.LOW,
                status=FindingStatus.UNSUPPORTED,
                scenario="product_rule_coverage",
                entities=unlinked_cargo_ids,
                evidence={"unlinked_cargo_count": count},
                explanation=(
                    f"{count} detected cargo object{'s have' if count > 1 else ' has'} no linked SKU handling rules "
                    "(orientation, mass, equipment, or stacking constraints) in the operational manifest. "
                    "This is an operational data gap, not a verified rule violation."
                ),
                limitations=["no_product_metadata_linkage"],
            )
        )

    return findings
