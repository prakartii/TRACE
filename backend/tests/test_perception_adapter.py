from backend.contracts.models import EntityClass
from backend.perception.adapter import (
    CLASS_MAP_BY_MODEL_IDENTITY,
    STOCK_COCO_CLASS_MAP,
    TRACE_PILOT_CLASS_MAP,
    tracked_objects_to_entities,
)
from backend.perception.config import STOCK_COCO_IDENTITY, TRACE_PILOT_IDENTITY
from backend.perception.tracker import TrackedObject


def test_person_maps_to_person_entity():
    tracked = [
        TrackedObject(
            track_id=1, class_name="person", confidence=0.8, x1=1, y1=2, x2=3, y2=4
        )
    ]

    entities = tracked_objects_to_entities(tracked, source_id="vid1", timestamp=1.5)

    assert len(entities) == 1
    entity = entities[0]
    assert entity.entity_class == EntityClass.PERSON
    assert entity.track_id == "1"
    assert entity.id == "vid1:1"
    assert entity.confidence == 0.8
    assert entity.timestamp == 1.5
    assert (entity.bbox.x1, entity.bbox.y1, entity.bbox.x2, entity.bbox.y2) == (
        1,
        2,
        3,
        4,
    )
    assert entity.keypoints is None


def test_unmapped_class_is_dropped_not_fabricated():
    tracked = [
        TrackedObject(
            track_id=2, class_name="truck", confidence=0.7, x1=0, y1=0, x2=10, y2=10
        )
    ]

    entities = tracked_objects_to_entities(tracked, source_id="vid1", timestamp=0.0)

    assert entities == []


def test_empty_input_returns_empty_list():
    assert tracked_objects_to_entities([], source_id="vid1", timestamp=0.0) == []


def test_mixed_mapped_and_unmapped_only_returns_mapped():
    tracked = [
        TrackedObject(
            track_id=1, class_name="person", confidence=0.9, x1=0, y1=0, x2=1, y2=1
        ),
        TrackedObject(
            track_id=2, class_name="backpack", confidence=0.6, x1=0, y1=0, x2=1, y2=1
        ),
    ]

    entities = tracked_objects_to_entities(tracked, source_id="vid1", timestamp=0.0)

    assert len(entities) == 1
    assert entities[0].track_id == "1"


def test_confidence_above_one_is_clamped():
    tracked = [
        TrackedObject(
            track_id=1, class_name="person", confidence=1.2, x1=0, y1=0, x2=1, y2=1
        )
    ]
    entities = tracked_objects_to_entities(tracked, source_id="vid1", timestamp=0.0)
    assert entities[0].confidence == 1.0


def test_confidence_below_zero_is_clamped():
    tracked = [
        TrackedObject(
            track_id=1, class_name="person", confidence=-0.2, x1=0, y1=0, x2=1, y2=1
        )
    ]
    entities = tracked_objects_to_entities(tracked, source_id="vid1", timestamp=0.0)
    assert entities[0].confidence == 0.0


# ---------------------------------------------------------------------
# Multi-model class mapping (Phase 4 perception-strengthening)
# ---------------------------------------------------------------------


def test_stock_model_maps_only_person():
    assert set(STOCK_COCO_CLASS_MAP.keys()) == {"person"}
    assert STOCK_COCO_CLASS_MAP["person"] == EntityClass.PERSON


def test_pilot_model_maps_person_box_pallet():
    assert set(TRACE_PILOT_CLASS_MAP.keys()) == {"person", "box", "pallet"}
    assert TRACE_PILOT_CLASS_MAP["box"] == EntityClass.BOX
    assert TRACE_PILOT_CLASS_MAP["pallet"] == EntityClass.PALLET


def test_class_map_registry_covers_both_known_identities():
    assert CLASS_MAP_BY_MODEL_IDENTITY[STOCK_COCO_IDENTITY] == STOCK_COCO_CLASS_MAP
    assert CLASS_MAP_BY_MODEL_IDENTITY[TRACE_PILOT_IDENTITY] == TRACE_PILOT_CLASS_MAP


def test_default_model_identity_only_produces_person_entities():
    """Regression: without specifying model_identity, box/pallet-class
    detections must still be dropped — the stock model is still active
    unless a caller explicitly opts into the pilot identity."""
    tracked = [
        TrackedObject(track_id=1, class_name="person", confidence=0.9, x1=0, y1=0, x2=1, y2=1),
        TrackedObject(track_id=2, class_name="box", confidence=0.9, x1=0, y1=0, x2=1, y2=1),
    ]
    entities = tracked_objects_to_entities(tracked, source_id="vid1", timestamp=0.0)
    assert len(entities) == 1
    assert entities[0].entity_class == EntityClass.PERSON


def test_pilot_model_identity_produces_box_and_pallet_entities():
    tracked = [
        TrackedObject(track_id=1, class_name="person", confidence=0.9, x1=0, y1=0, x2=1, y2=1),
        TrackedObject(track_id=2, class_name="box", confidence=0.8, x1=0, y1=0, x2=1, y2=1),
        TrackedObject(track_id=3, class_name="pallet", confidence=0.7, x1=0, y1=0, x2=1, y2=1),
    ]
    entities = tracked_objects_to_entities(
        tracked, source_id="vid1", timestamp=0.0, model_identity=TRACE_PILOT_IDENTITY
    )
    classes = {e.entity_class for e in entities}
    assert classes == {EntityClass.PERSON, EntityClass.BOX, EntityClass.PALLET}


def test_pilot_model_still_rejects_unrecognized_classes():
    """Even under the pilot identity, a class outside its trained/
    validated vocabulary (e.g. a raw COCO class the pilot head doesn't
    output) must be dropped, not fabricated into a TRACE class."""
    tracked = [
        TrackedObject(track_id=1, class_name="skis", confidence=0.9, x1=0, y1=0, x2=1, y2=1),
    ]
    entities = tracked_objects_to_entities(
        tracked, source_id="vid1", timestamp=0.0, model_identity=TRACE_PILOT_IDENTITY
    )
    assert entities == []


def test_unknown_model_identity_falls_back_to_stock_map():
    """An unrecognized model_identity string must never be treated as
    'detect everything' — it falls back to the narrowest (stock) map."""
    tracked = [
        TrackedObject(track_id=1, class_name="box", confidence=0.9, x1=0, y1=0, x2=1, y2=1),
    ]
    entities = tracked_objects_to_entities(
        tracked, source_id="vid1", timestamp=0.0, model_identity="some-unknown-model"
    )
    assert entities == []
