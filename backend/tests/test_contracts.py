import pytest
from pydantic import ValidationError

from backend.contracts.models import (
    BoundingBox,
    ConfidenceLevel,
    Entity,
    EntityClass,
    EventType,
    Fragility,
    MassClass,
    PlacementCandidate,
    PlannerRecommendation,
    PreventionClassification,
    ProductMetadata,
    RiskBand,
    RiskEvent,
    RiskLens,
    Rule,
    RuleKind,
    SceneGraphEdge,
    SceneGraphEdgeType,
    SceneGraphNode,
    SceneGraphSnapshot,
)


def test_entity_round_trip_through_json():
    entity = Entity(
        id="e1",
        track_id="t1",
        entity_class=EntityClass.BOX,
        bbox=BoundingBox(x1=0, y1=0, x2=10, y2=10),
        confidence=0.92,
        timestamp=1.0,
    )
    restored = Entity.model_validate_json(entity.model_dump_json())
    assert restored == entity


def test_entity_confidence_out_of_range_rejected():
    with pytest.raises(ValidationError):
        Entity(
            id="e1",
            entity_class=EntityClass.BOX,
            bbox=BoundingBox(x1=0, y1=0, x2=10, y2=10),
            confidence=1.5,
            timestamp=1.0,
        )


def test_product_metadata_round_trip():
    product = ProductMetadata(
        product_id="p1",
        class_name="carton",
        mass_class=MassClass.MEDIUM,
        fragility=Fragility.LOW,
        max_stack_height=4,
    )
    assert ProductMetadata.model_validate(product.model_dump()) == product


def test_scene_graph_snapshot_round_trip():
    node = SceneGraphNode(
        entity_id="e1", entity_class=EntityClass.PALLET, position=(0.0, 0.0)
    )
    edge = SceneGraphEdge(
        source_id="e1",
        target_id="e2",
        edge_type=SceneGraphEdgeType.SUPPORT,
        weight=0.8,
    )
    snapshot = SceneGraphSnapshot(timestamp=1.0, nodes=[node], edges=[edge])
    restored = SceneGraphSnapshot.model_validate_json(snapshot.model_dump_json())
    assert restored == snapshot


def test_risk_event_round_trip():
    event = RiskEvent(
        timestamp=1.0,
        event_type=EventType.RISK,
        lens=RiskLens.STRUCTURAL,
        entity_id="e1",
        score=42.0,
        band=RiskBand.HIGH,
        confidence=ConfidenceLevel.MEDIUM,
        factor_breakdown={"support_ratio": 0.3},
    )
    restored = RiskEvent.model_validate_json(event.model_dump_json())
    assert restored == event


def test_planner_recommendation_round_trip():
    candidate = PlacementCandidate(
        position=(1.0, 2.0),
        score=86.0,
        band=RiskBand.LOW,
        hard_constraints_passed=True,
    )
    rec = PlannerRecommendation(
        candidates=[candidate],
        recommended_position=(1.0, 2.0),
        expected_delta=44.0,
        confidence=ConfidenceLevel.HIGH,
        instruction_text="Rotate 90 degrees and shift left.",
    )
    restored = PlannerRecommendation.model_validate_json(rec.model_dump_json())
    assert restored == rec


def test_rule_rejects_invalid_kind():
    with pytest.raises(ValidationError):
        Rule(kind="not-a-kind", created_by="supervisor", created_at=1.0)


def test_rule_accepts_valid_kind():
    rule = Rule(kind=RuleKind.CUSTOM, description="Do not place A on B", created_by="supervisor", created_at=1.0)
    assert rule.kind == RuleKind.CUSTOM


def test_prevention_classification_has_exactly_four_buckets():
    assert {c.value for c in PreventionClassification} == {
        "prevented",
        "near_miss",
        "outcome_unclear",
        "confirmed_damage",
    }
