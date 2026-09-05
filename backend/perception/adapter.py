"""Converts tracked detections into TRACE's Entity contract (Phase 3,
extended in Phase 4 for multi-model class vocabularies).

This is the ONLY place perception output is allowed to become an `Entity`.
Nothing upstream of here (detector.py, tracker.py) may be imported by
world_model/ or the API layer directly — everything downstream consumes
`backend.contracts.models.Entity`.

Bbox coordinate convention: `Entity.bbox` is in absolute pixel coordinates
of the source frame, i.e. the same space as `Frame.width`/`Frame.height`
(backend/video/source.py) — NOT normalized 0..1. A frontend overlay must
scale by (displayed_size / frame.width, displayed_size / frame.height).

Class coverage: the class vocabulary a detection's class_name can map to
depends entirely on which model produced it — see
`CLASS_MAP_BY_MODEL_IDENTITY` below, keyed by `PerceptionConfig.
model_identity` (never inferred from a filename). The stock COCO-
pretrained model (`STOCK_COCO_IDENTITY`) has no class that faithfully
corresponds to TRACE's box/pallet/trolley/vehicle-bed entities — COCO's
"truck"/"car"/"suitcase"/"backpack" are not reliable proxies for those,
and mapping them would misrepresent detection precision the model
doesn't have, so only `person` is mapped for it. The TRACE pilot fine-
tune (`TRACE_PILOT_IDENTITY`, see training/README.md) additionally
supports `box` and `pallet`, validated on real held-out footage — see
training/README.md for exactly what was and wasn't validated.
`TROLLEY`/`VEHICLE_BED` are not in either map: no model here has ever
been trained or validated to detect them (see training/README.md's
class-scope decision for why trolley was excluded from the pilot).
"""

from __future__ import annotations

from backend.contracts.models import BoundingBox, Entity, EntityClass
from backend.perception.config import STOCK_COCO_IDENTITY, TRACE_PILOT_IDENTITY
from backend.perception.tracker import TrackedObject

STOCK_COCO_CLASS_MAP: dict[str, EntityClass] = {
    "person": EntityClass.PERSON,
}

# Validated against real held-out challenge-video frames — see
# training/README.md's "Real-footage validation" section for exact
# per-class results before assuming this is production-grade.
TRACE_PILOT_CLASS_MAP: dict[str, EntityClass] = {
    "person": EntityClass.PERSON,
    "box": EntityClass.BOX,
    "pallet": EntityClass.PALLET,
}

CLASS_MAP_BY_MODEL_IDENTITY: dict[str, dict[str, EntityClass]] = {
    STOCK_COCO_IDENTITY: STOCK_COCO_CLASS_MAP,
    TRACE_PILOT_IDENTITY: TRACE_PILOT_CLASS_MAP,
}

# Backwards-compatible name some existing tests/call sites reference —
# equal to the stock map, since that's still the system-wide default
# (PerceptionConfig.model_identity defaults to STOCK_COCO_IDENTITY).
CLASS_MAP = STOCK_COCO_CLASS_MAP


def tracked_objects_to_entities(
    tracked_objects: list[TrackedObject],
    *,
    source_id: str,
    timestamp: float,
    model_identity: str = STOCK_COCO_IDENTITY,
) -> list[Entity]:
    """Converts one frame's `TrackedObject`s into `Entity`s, silently
    dropping any object whose class isn't in the active model's class map
    (see module docstring) rather than fabricating a TRACE class for it.
    An unrecognized `model_identity` falls back to the stock map — the
    safe default is "detect nothing new", never "guess"."""
    class_map = CLASS_MAP_BY_MODEL_IDENTITY.get(model_identity, STOCK_COCO_CLASS_MAP)
    entities: list[Entity] = []
    for obj in tracked_objects:
        entity_class = class_map.get(obj.class_name)
        if entity_class is None:
            continue
        entities.append(
            Entity(
                id=f"{source_id}:{obj.track_id}",
                track_id=str(obj.track_id),
                entity_class=entity_class,
                bbox=BoundingBox(x1=obj.x1, y1=obj.y1, x2=obj.x2, y2=obj.y2),
                confidence=min(max(obj.confidence, 0.0), 1.0),
                timestamp=timestamp,
                keypoints=None,  # pose estimation is not implemented in Phase 3/4
            )
        )
    return entities
