import pytest

from backend.behaviour.lens import evaluate_behaviour
from backend.contracts.models import BoundingBox, Entity, EntityClass, FindingStatus, PerceptionFrameResult
from backend.risk.config import RiskConfig

FRAME_W = 1000
FRAME_H = 1000


def entity(entity_id, x1, y1, x2, y2, entity_class=EntityClass.PERSON, confidence=0.9):
    return Entity(
        id=entity_id,
        track_id=entity_id,
        entity_class=entity_class,
        bbox=BoundingBox(x1=x1, y1=y1, x2=x2, y2=y2),
        confidence=confidence,
        timestamp=0.0,
    )


def frame(timestamp, entities):
    return PerceptionFrameResult(source_id="vid", timestamp=timestamp, entities=entities)


def test_person_only_scene_is_insufficient_evidence_not_a_violation():
    """Regression: a missing BOX must never generate a box-related
    safety finding, no matter how confident the PERSON detection is."""
    frames = [
        frame(float(i), [entity("vid:p1", 0, 0, 100, 200, confidence=0.99)]) for i in range(5)
    ]
    findings = evaluate_behaviour(frames, frame_width=FRAME_W, frame_height=FRAME_H, timestamp=4.0)

    assert len(findings) == 1
    assert findings[0].status == FindingStatus.INSUFFICIENT_EVIDENCE
    assert findings[0].evidence["box_tracks_detected"] == 0
    assert "box" not in findings[0].scenario or findings[0].status != FindingStatus.SUPPORTED


def test_empty_scene_produces_insufficient_evidence():
    frames = [frame(0.0, [])]
    findings = evaluate_behaviour(frames, frame_width=FRAME_W, frame_height=FRAME_H, timestamp=0.0)
    assert len(findings) == 1
    assert findings[0].status == FindingStatus.INSUFFICIENT_EVIDENCE


def test_sustained_person_box_proximity_is_reported():
    frames = [
        frame(
            float(i),
            [
                entity("vid:p1", 0, 0, 100, 200, entity_class=EntityClass.PERSON, confidence=0.9),
                entity("vid:b1", 20, 0, 120, 200, entity_class=EntityClass.BOX, confidence=0.9),
            ],
        )
        for i in range(6)
    ]
    findings = evaluate_behaviour(
        frames,
        frame_width=FRAME_W,
        frame_height=FRAME_H,
        timestamp=5.0,
        config=RiskConfig(behaviour_min_common_samples=4, behaviour_sustained_fraction=0.5),
    )
    assert len(findings) == 1
    finding = findings[0]
    assert finding.scenario == "person_box_sustained_proximity"
    assert finding.status != FindingStatus.SUPPORTED  # box class reliability caps confidence
    assert set(finding.entities) == {"vid:p1", "vid:b1"}
    # The explanation may name these actions only to disclaim them, never
    # to assert one occurred.
    assert "does not identify a specific action" in finding.explanation.lower() or (
        "does not" in finding.explanation.lower()
    )


def test_far_apart_stationary_box_produces_no_finding():
    frames = [
        frame(
            float(i),
            [
                entity("vid:p1", 0, 0, 50, 50, entity_class=EntityClass.PERSON),
                entity("vid:b1", 900, 900, 950, 950, entity_class=EntityClass.BOX),
            ],
        )
        for i in range(5)
    ]
    findings = evaluate_behaviour(frames, frame_width=FRAME_W, frame_height=FRAME_H, timestamp=4.0)
    assert findings == []


def test_box_displacement_near_person_is_reported():
    frames = [
        frame(
            float(i),
            [
                entity("vid:p1", 0, 0, 100, 200, entity_class=EntityClass.PERSON),
                entity("vid:b1", 20 + i * 100, 0, 120 + i * 100, 200, entity_class=EntityClass.BOX),
            ],
        )
        for i in range(5)
    ]
    findings = evaluate_behaviour(frames, frame_width=FRAME_W, frame_height=FRAME_H, timestamp=4.0)
    assert len(findings) == 1
    assert findings[0].scenario == "box_displacement_near_person"


def test_weak_box_confidence_never_reaches_supported():
    frames = [
        frame(
            float(i),
            [
                entity("vid:p1", 0, 0, 100, 200, entity_class=EntityClass.PERSON, confidence=0.95),
                entity("vid:b1", 20, 0, 120, 200, entity_class=EntityClass.BOX, confidence=0.2),
            ],
        )
        for i in range(6)
    ]
    findings = evaluate_behaviour(frames, frame_width=FRAME_W, frame_height=FRAME_H, timestamp=5.0)
    assert len(findings) == 1
    assert findings[0].status != FindingStatus.SUPPORTED
