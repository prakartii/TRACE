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
    EventType,
    FindingStatus,
    ProductMetadata,
    RiskEvent,
    RiskLens,
    SceneGraphNode,
)


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


# Empty in Phase 5 — no ConformanceRule can run yet because no metadata is
# linked to any entity. Future phases append instances here.
REGISTERED_RULES: list[ConformanceRule] = []


def evaluate_conformance(
    nodes: list[SceneGraphNode],
    product_metadata_by_id: dict[str, ProductMetadata],
    *,
    timestamp: float,
) -> list[RiskEvent]:
    findings: list[RiskEvent] = []

    for node in nodes:
        metadata = product_metadata_by_id.get(node.product_id) if node.product_id else None

        if metadata is None or not REGISTERED_RULES:
            findings.append(
                RiskEvent(
                    timestamp=timestamp,
                    event_type=EventType.RISK,
                    lens=RiskLens.CONFORMANCE,
                    entity_id=node.entity_id,
                    confidence=ConfidenceLevel.LOW,
                    status=FindingStatus.UNSUPPORTED,
                    scenario="product_conformance",
                    entities=[node.entity_id],
                    evidence={},
                    explanation=(
                        "No product metadata (orientation/mass/equipment/stacking rules) is "
                        "linked to this entity, so no conformance rule can be evaluated. This "
                        "is a structural limitation of the current build, not a checked-and-"
                        "passed rule."
                    ),
                    limitations=["no_product_metadata_linkage"],
                )
            )
            continue

        for rule in REGISTERED_RULES:
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
                    evidence={},
                    explanation=violation,
                    limitations=[],
                )
            )

    return findings
