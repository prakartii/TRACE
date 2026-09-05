import pytest

from backend.contracts.models import BoundingBox, Entity, EntityClass, FindingStatus
from backend.lenses.structural import evaluate_structural
from backend.world_model.scene_graph import WorldModel

FRAME_W = 1000
FRAME_H = 1000

SUPPORTER_BBOX = (100, 500, 900, 900)  # normalized (0.1, 0.5, 0.9, 0.9)
SUPPORTED_BBOX = (200, 470, 800, 500)  # normalized (0.2, 0.47, 0.8, 0.5) -> sits on top


def entity(entity_id, bbox, entity_class, confidence=0.9):
    x1, y1, x2, y2 = bbox
    return Entity(
        id=entity_id,
        track_id=entity_id,
        entity_class=entity_class,
        bbox=BoundingBox(x1=x1, y1=y1, x2=x2, y2=y2),
        confidence=confidence,
        timestamp=0.0,
    )


def build_snapshot(supporter_class, supported_class, supporter_conf=0.9, supported_conf=0.9):
    supporter = entity("vid:supporter", SUPPORTER_BBOX, supporter_class, supporter_conf)
    supported = entity("vid:supported", SUPPORTED_BBOX, supported_class, supported_conf)
    snapshot = WorldModel().build_snapshot(
        [supporter, supported], frame_width=FRAME_W, frame_height=FRAME_H, timestamp=0.0
    )
    confidences = {"vid:supporter": supporter_conf, "vid:supported": supported_conf}
    return snapshot, confidences


def test_person_person_support_is_never_reported_as_stacking():
    """Regression: two people close together, one bbox partly above the
    other, must never become a box-stacking structural finding."""
    snapshot, confidences = build_snapshot(EntityClass.PERSON, EntityClass.PERSON)
    assert any(e.edge_type.value == "support" for e in snapshot.edges)  # sanity: geometry did fire

    findings = evaluate_structural(snapshot, entity_confidence=confidences)
    assert findings == []


def test_box_on_box_produces_structural_finding():
    snapshot, confidences = build_snapshot(EntityClass.BOX, EntityClass.BOX)
    findings = evaluate_structural(snapshot, entity_confidence=confidences)
    assert len(findings) == 1
    assert findings[0].scenario == "image_space_support_hypothesis"
    assert "hypothesis" in findings[0].explanation.lower()
    assert "verified" in findings[0].explanation.lower()


def test_box_on_pallet_produces_structural_finding():
    snapshot, confidences = build_snapshot(EntityClass.PALLET, EntityClass.BOX)
    findings = evaluate_structural(snapshot, entity_confidence=confidences)
    assert len(findings) == 1


def test_person_on_pallet_produces_structural_finding():
    snapshot, confidences = build_snapshot(EntityClass.PALLET, EntityClass.PERSON)
    findings = evaluate_structural(snapshot, entity_confidence=confidences)
    assert len(findings) == 1


def test_weak_pallet_confidence_stays_below_supported():
    snapshot, confidences = build_snapshot(
        EntityClass.PALLET, EntityClass.BOX, supporter_conf=0.9, supported_conf=0.9
    )
    findings = evaluate_structural(snapshot, entity_confidence=confidences)
    assert len(findings) == 1
    # pallet's class reliability (0.15) caps this well under SUPPORTED
    assert findings[0].status != FindingStatus.SUPPORTED


def test_no_support_edges_produces_no_findings():
    person_a = entity("vid:a", (0, 0, 50, 50), EntityClass.PERSON)
    person_b = entity("vid:b", (900, 900, 950, 950), EntityClass.PERSON)
    snapshot = WorldModel().build_snapshot(
        [person_a, person_b], frame_width=FRAME_W, frame_height=FRAME_H, timestamp=0.0
    )
    findings = evaluate_structural(snapshot, entity_confidence={"vid:a": 0.9, "vid:b": 0.9})
    assert findings == []
