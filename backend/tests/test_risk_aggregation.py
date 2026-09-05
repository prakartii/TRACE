import pytest

from backend.contracts.models import ConfidenceLevel, EntityClass, FindingStatus
from backend.risk.aggregation import evidence_quality, status_and_confidence
from backend.risk.config import RiskConfig


def test_evidence_quality_zero_with_no_entity_classes():
    assert evidence_quality(
        mean_detection_confidence=0.99, entity_classes=[], sample_count=10, min_expected_samples=4
    ) == 0.0


def test_evidence_quality_high_person_only_is_not_automatically_high_for_box():
    # A high-confidence PERSON detection alone must not read as strong
    # evidence for a BOX-involving claim — class reliability matters, not
    # just detector confidence.
    person_only = evidence_quality(
        mean_detection_confidence=0.99,
        entity_classes=[EntityClass.PERSON],
        sample_count=10,
        min_expected_samples=4,
    )
    person_and_box = evidence_quality(
        mean_detection_confidence=0.99,
        entity_classes=[EntityClass.PERSON, EntityClass.BOX],
        sample_count=10,
        min_expected_samples=4,
    )
    assert person_and_box < person_only


def test_evidence_quality_weak_class_pulls_score_down():
    strong = evidence_quality(
        mean_detection_confidence=0.9,
        entity_classes=[EntityClass.PERSON],
        sample_count=10,
        min_expected_samples=4,
    )
    weak = evidence_quality(
        mean_detection_confidence=0.9,
        entity_classes=[EntityClass.PALLET],
        sample_count=10,
        min_expected_samples=4,
    )
    assert weak < strong


def test_evidence_quality_penalizes_low_sample_count():
    few_samples = evidence_quality(
        mean_detection_confidence=0.9,
        entity_classes=[EntityClass.PERSON],
        sample_count=1,
        min_expected_samples=10,
    )
    many_samples = evidence_quality(
        mean_detection_confidence=0.9,
        entity_classes=[EntityClass.PERSON],
        sample_count=10,
        min_expected_samples=10,
    )
    assert few_samples < many_samples


def test_status_and_confidence_thresholds():
    config = RiskConfig(
        aggregation_min_confidence_for_supported=0.6, aggregation_min_confidence_for_probable=0.3
    )
    assert status_and_confidence(0.9, config) == (FindingStatus.SUPPORTED, ConfidenceLevel.HIGH)
    assert status_and_confidence(0.4, config) == (FindingStatus.PROBABLE, ConfidenceLevel.MEDIUM)
    assert status_and_confidence(0.1, config) == (FindingStatus.INSUFFICIENT_EVIDENCE, ConfidenceLevel.LOW)
    assert status_and_confidence(0.0, config) == (FindingStatus.UNSUPPORTED, ConfidenceLevel.LOW)


def test_weak_box_detection_does_not_trigger_severe_finding():
    # A weak BOX detection (low confidence, few samples) must land as
    # INSUFFICIENT_EVIDENCE, never SUPPORTED.
    score = evidence_quality(
        mean_detection_confidence=0.3,
        entity_classes=[EntityClass.PERSON, EntityClass.BOX],
        sample_count=1,
        min_expected_samples=4,
    )
    status, _ = status_and_confidence(score)
    assert status in (FindingStatus.INSUFFICIENT_EVIDENCE, FindingStatus.UNSUPPORTED)
