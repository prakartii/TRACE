"""Evidence-quality-based confidence/status aggregation (Phase 5, Priority
7 — Finding aggregation / severity).

Every lens computes its own domain evidence (temporal, geometric) but
calls into this single, shared function to turn that evidence into a
FindingStatus/ConfidenceLevel — one scoring path, not one invented per
lens (CLAUDE.md §12's "single stability engine" principle applied to
evidence scoring). This is the mechanism that prevents a strong PERSON
detection with no BOX detection from ever becoming a SUPPORTED
box-handling finding: `entity_classes` for that case is empty/missing BOX,
so evidence_quality() returns 0.0 regardless of how confident PERSON was.
"""

from __future__ import annotations

from backend.contracts.models import ConfidenceLevel, EntityClass, FindingStatus
from backend.risk.config import CLASS_EVIDENCE_RELIABILITY, DEFAULT_RISK_CONFIG, RiskConfig


def class_reliability(entity_class: EntityClass) -> float:
    return CLASS_EVIDENCE_RELIABILITY.get(entity_class.value, 0.3)


def evidence_quality(
    *,
    mean_detection_confidence: float,
    entity_classes: list[EntityClass],
    sample_count: int,
    min_expected_samples: int,
) -> float:
    """Combines three honesty-relevant factors into one [0, 1] score:
    - how confident the detector was on the involved detections
    - how reliable that entity class actually is (measured mAP, not the
      detector's self-reported confidence)
    - how many independent temporal samples back the claim (2 shared
      samples is much weaker evidence than 20)
    Returns 0.0 if no entity classes are given at all — "no relevant
    entity was involved" is zero evidence, not merely low evidence."""
    if not entity_classes:
        return 0.0
    class_score = min(class_reliability(c) for c in entity_classes)
    sample_score = min(1.0, sample_count / max(1, min_expected_samples))
    return max(0.0, min(1.0, mean_detection_confidence)) * class_score * sample_score


def status_and_confidence(
    evidence_score: float, config: RiskConfig = DEFAULT_RISK_CONFIG
) -> tuple[FindingStatus, ConfidenceLevel]:
    if evidence_score >= config.aggregation_min_confidence_for_supported:
        return FindingStatus.SUPPORTED, ConfidenceLevel.HIGH
    if evidence_score >= config.aggregation_min_confidence_for_probable:
        return FindingStatus.PROBABLE, ConfidenceLevel.MEDIUM
    if evidence_score > 0.0:
        return FindingStatus.INSUFFICIENT_EVIDENCE, ConfidenceLevel.LOW
    return FindingStatus.UNSUPPORTED, ConfidenceLevel.LOW
