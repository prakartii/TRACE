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
    EpistemicLevel,
    EventType,
    FindingStatus,
    ProductMetadata,
    RiskBand,
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


def _check_loading_sequence(
    node: SceneGraphNode,
    metadata: ProductMetadata,
    all_nodes: list[SceneGraphNode] | None = None,
    product_metadata_by_id: dict[str, ProductMetadata] | None = None,
) -> Optional[dict[str, Any] | str]:
    """Scenario 11: Evaluates loading sequence conformance against manifest plan.
    Detects out-of-order staging and inverted sequence loading."""
    if metadata.loading_sequence is None:
        return None

    node_seq = metadata.loading_sequence

    if all_nodes and product_metadata_by_id:
        for other in all_nodes:
            if other.entity_id == node.entity_id or other.entity_class != EntityClass.BOX:
                continue
            other_meta = product_metadata_by_id.get(other.product_id) if other.product_id else None
            if not other_meta or other_meta.loading_sequence is None:
                continue

            other_seq = other_meta.loading_sequence

            # Inverted vertical staging: node is on the bottom / base tier,
            # but has a higher sequence number than an item placed on top of it
            # (i.e. late sequence cargo placed first, earlier sequence cargo placed on top)
            if node.footprint and other.footprint:
                is_node_beneath = (
                    node.footprint.y2 > other.footprint.y2
                    and min(node.footprint.x2, other.footprint.x2) > max(node.footprint.x1, other.footprint.x1) - 0.05
                )
                if is_node_beneath and node_seq > other_seq:
                    return {
                        "status": FindingStatus.PROBABLE,
                        "explanation": (
                            f"Product '{metadata.product_id}' (sequence #{node_seq}) is positioned beneath "
                            f"earlier sequence product '{other_meta.product_id}' (sequence #{other_seq}). "
                            "Inverted loading sequence creates dispatch re-handling and crushing hazard."
                        ),
                        "evidence": {
                            "product_id": metadata.product_id,
                            "loading_sequence": node_seq,
                            "conflict_product_id": other_meta.product_id,
                            "conflict_sequence": other_seq,
                            "staging_inversion": "vertical_support",
                        },
                        "band": RiskBand.HIGH,
                        "limitations": [
                            "Multi-stage truck dispatch manifests are unlinked in current stream.",
                            "Sequence inferred from relative spatial staging and manifest metadata.",
                        ],
                    }

                # Lateral dock-to-vehicle staging inversion:
                # If node (higher seq) is staged forward into vehicle bed (x > 0.60)
                # while other (lower seq) is waiting unplaced behind it (x < 0.45)
                if node_seq > other_seq and node.position[0] > 0.60 and other.position[0] < 0.45:
                    return {
                        "status": FindingStatus.PROBABLE,
                        "explanation": (
                            f"Product '{metadata.product_id}' (stage #{node_seq}) is staged forward before "
                            f"earlier required stage #{other_seq} product '{other_meta.product_id}'. "
                            "Deviates from scheduled manifest loading sequence."
                        ),
                        "evidence": {
                            "product_id": metadata.product_id,
                            "loading_sequence": node_seq,
                            "conflict_product_id": other_meta.product_id,
                            "conflict_sequence": other_seq,
                            "staging_inversion": "lateral_dock",
                        },
                        "band": RiskBand.HIGH,
                        "limitations": [
                            "Multi-stage truck dispatch manifests are unlinked in current stream.",
                            "Sequence inferred from relative spatial staging and manifest metadata.",
                        ],
                    }

    return None


def _check_equipment(
    node: SceneGraphNode,
    metadata: ProductMetadata,
    all_nodes: list[SceneGraphNode] | None = None,
    product_metadata_by_id: dict[str, ProductMetadata] | None = None,
) -> Optional[dict[str, Any] | str]:
    """Scenario 13: Evaluates handling equipment compliance against product specification."""
    if not metadata.allowed_equipment:
        return None

    allowed = [eq.lower() for eq in metadata.allowed_equipment]

    # 1. Out-of-vocabulary equipment check (e.g. forklift)
    oov_classes = ("forklift", "crane", "reach_truck")
    if any(e in oov_classes for e in allowed) and not any(e in ("trolley", "pallet", "pallet_jack", "manual") for e in allowed):
        return {
            "status": FindingStatus.UNSUPPORTED,
            "explanation": (
                f"Product '{metadata.product_id}' specifies required equipment '{metadata.allowed_equipment[0]}', "
                "but equipment taxonomy is unmapped in pilot object detector."
            ),
            "evidence": {
                "product_id": metadata.product_id,
                "allowed_equipment": metadata.allowed_equipment,
            },
            "band": RiskBand.LOW,
            "limitations": [
                "Forklift and pallet jack class taxonomy is unmapped in pilot perception model.",
                "equipment_taxonomy_unmapped_in_detector",
            ],
        }

    # 2. Check observed equipment in the scene
    if all_nodes:
        # Check if a PALLET is supporting or directly touching this node, but pallet is NOT in allowed:
        pallets_near = [
            n for n in all_nodes
            if n.entity_class == EntityClass.PALLET
            and node.footprint and n.footprint
            and (
                min(node.footprint.x2, n.footprint.x2) > max(node.footprint.x1, n.footprint.x1) - 0.05
                and abs(n.footprint.y1 - node.footprint.y2) < 0.15
            )
        ]
        if pallets_near and "pallet" not in allowed and "pallet_jack" not in allowed:
            return {
                "status": FindingStatus.PROBABLE,
                "explanation": (
                    f"Product '{metadata.product_id}' requires handling equipment {metadata.allowed_equipment}, "
                    "but cargo was placed on/with pallet equipment. Equipment class mismatch."
                ),
                "evidence": {
                    "product_id": metadata.product_id,
                    "allowed_equipment": metadata.allowed_equipment,
                    "observed_equipment": "pallet",
                },
                "band": RiskBand.MEDIUM,
                "limitations": ["equipment_inferred_from_2d_scene_graph"],
            }

        # Check if a TROLLEY is near, but trolley is not in allowed:
        trolleys_near = [
            n for n in all_nodes
            if n.entity_class == EntityClass.TROLLEY
            and node.footprint and n.footprint
            and (
                min(node.footprint.x2, n.footprint.x2) > max(node.footprint.x1, n.footprint.x1) - 0.10
                and abs(n.footprint.y1 - node.footprint.y2) < 0.20
            )
        ]
        if trolleys_near and "trolley" not in allowed:
            return {
                "status": FindingStatus.PROBABLE,
                "explanation": (
                    f"Product '{metadata.product_id}' prohibits trolley transport (requires {metadata.allowed_equipment}), "
                    "but trolley equipment was observed in proximity."
                ),
                "evidence": {
                    "product_id": metadata.product_id,
                    "allowed_equipment": metadata.allowed_equipment,
                    "observed_equipment": "trolley",
                },
                "band": RiskBand.MEDIUM,
                "limitations": ["equipment_inferred_from_2d_scene_graph"],
            }

    return None


ORIENTATION_RULE = ConformanceRule(
    name="wrong_product_orientation",
    required_metadata_fields=("required_orientation",),
    check=_check_orientation,
)

LOADING_SEQUENCE_RULE = ConformanceRule(
    name="unplanned_loading_sequence",
    required_metadata_fields=("loading_sequence",),
    check=_check_loading_sequence,
)

WRONG_EQUIPMENT_RULE = ConformanceRule(
    name="wrong_equipment_usage",
    required_metadata_fields=("allowed_equipment",),
    check=_check_equipment,
)

# Standard conformance rules available for runtime evaluation
STANDARD_CONFORMANCE_RULES: list[ConformanceRule] = [
    ORIENTATION_RULE,
    LOADING_SEQUENCE_RULE,
    WRONG_EQUIPMENT_RULE,
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
                        band=RiskBand.LOW,
                        scenario=rule.name,
                        entities=[node.entity_id],
                        evidence={},
                        explanation=f"Rule '{rule.name}' requires metadata that is not populated.",
                        limitations=["incomplete_product_metadata"],
                        epistemic_level=EpistemicLevel.INFERRED,
                    )
                )
                continue

            try:
                violation = rule.check(node, metadata, all_nodes=cargo_nodes, product_metadata_by_id=product_metadata_by_id)
            except TypeError:
                try:
                    violation = rule.check(node, metadata, all_nodes=cargo_nodes)
                except TypeError:
                    violation = rule.check(node, metadata)

            if violation is None:
                continue

            if isinstance(violation, dict):
                rule_status = violation.get("status", FindingStatus.PROBABLE)
                rule_explanation = violation.get("explanation", "")
                rule_evidence = violation.get("evidence", {})
                rule_band = violation.get("band", RiskBand.MEDIUM)
                rule_limits = violation.get("limitations", [])
                rule_epistemic = violation.get("epistemic_level", EpistemicLevel.INFERRED)
                rule_conf = ConfidenceLevel.MEDIUM if rule_status == FindingStatus.PROBABLE else ConfidenceLevel.LOW
            else:
                rule_status = FindingStatus.PROBABLE
                rule_explanation = str(violation)
                rule_evidence = {
                    "required_orientation": metadata.required_orientation,
                    "observed_aspect_ratio": node.orientation,
                }
                rule_band = RiskBand.MEDIUM
                rule_limits = []
                rule_epistemic = EpistemicLevel.INFERRED
                rule_conf = ConfidenceLevel.MEDIUM

            findings.append(
                RiskEvent(
                    timestamp=timestamp,
                    event_type=EventType.RISK,
                    lens=RiskLens.CONFORMANCE,
                    entity_id=node.entity_id,
                    confidence=rule_conf,
                    status=rule_status,
                    band=rule_band,
                    scenario=rule.name,
                    entities=[node.entity_id],
                    evidence=rule_evidence,
                    explanation=rule_explanation,
                    recommended_action=recommended_action(rule.name, rule_status),
                    limitations=rule_limits,
                    epistemic_level=rule_epistemic,
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
                band=RiskBand.LOW,
                scenario="product_rule_coverage",
                entities=unlinked_cargo_ids,
                evidence={"unlinked_cargo_count": count},
                explanation=(
                    f"{count} detected cargo object{'s have' if count > 1 else ' has'} no linked SKU handling rules "
                    "(orientation, mass, equipment, or stacking constraints) in the operational manifest. "
                    "This is an operational data gap, not a verified rule violation."
                ),
                limitations=["no_product_metadata_linkage"],
                epistemic_level=EpistemicLevel.OBSERVED,
            )
        )

    return findings
