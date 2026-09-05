"""Proves the existing (unmodified) world model can already represent
typed multi-class nodes/edges once upstream perception actually produces
BOX/PALLET entities (Phase 4 perception-strengthening gate).

world_model/scene_graph.py's node/edge construction is class-agnostic —
it was never restricted to PERSON, it simply had nothing else to work
with before this phase. These tests use synthetic Entity fixtures with
BOX/PALLET classes (not real pilot-model output) specifically to isolate
"does the world model handle these classes correctly" from "does the
pilot model detect them correctly" (that's training/README.md's job) —
per CLAUDE.md, a geometric edge here is never a hazard/behaviour claim.
"""

import pytest

from backend.contracts.models import BoundingBox, Entity, EntityClass, SceneGraphEdgeType
from backend.world_model.config import WorldModelConfig
from backend.world_model.scene_graph import WorldModel, entity_to_scene_node

FRAME_W = 1000
FRAME_H = 1000


def make_entity(entity_id, x1, y1, x2, y2, entity_class, track_id=None):
    return Entity(
        id=entity_id,
        track_id=track_id if track_id is not None else entity_id,
        entity_class=entity_class,
        bbox=BoundingBox(x1=x1, y1=y1, x2=x2, y2=y2),
        confidence=0.85,
        timestamp=0.0,
    )


def test_scene_node_can_represent_box_class():
    entity = make_entity("vid:1", 100, 100, 300, 300, EntityClass.BOX)
    node = entity_to_scene_node(entity, FRAME_W, FRAME_H)
    assert node.entity_class == EntityClass.BOX


def test_scene_node_can_represent_pallet_class():
    entity = make_entity("vid:1", 100, 100, 300, 300, EntityClass.PALLET)
    node = entity_to_scene_node(entity, FRAME_W, FRAME_H)
    assert node.entity_class == EntityClass.PALLET


def test_snapshot_can_contain_person_box_and_pallet_nodes_together():
    entities = [
        make_entity("vid:p1", 0, 0, 50, 50, EntityClass.PERSON),
        make_entity("vid:b1", 100, 100, 200, 200, EntityClass.BOX),
        make_entity("vid:pl1", 300, 300, 500, 400, EntityClass.PALLET),
    ]
    snapshot = WorldModel().build_snapshot(
        entities, frame_width=FRAME_W, frame_height=FRAME_H, timestamp=0.0
    )
    classes = {n.entity_class for n in snapshot.nodes}
    assert classes == {EntityClass.PERSON, EntityClass.BOX, EntityClass.PALLET}


@pytest.mark.parametrize(
    "class_a,class_b",
    [
        (EntityClass.PERSON, EntityClass.BOX),
        (EntityClass.PERSON, EntityClass.PALLET),
        (EntityClass.BOX, EntityClass.PALLET),
        (EntityClass.BOX, EntityClass.BOX),
    ],
)
def test_proximity_edge_forms_between_any_class_pair(class_a, class_b):
    """PROXIMITY is purely spatial — it must not care about entity class.
    A close BOX-PALLET or PERSON-BOX pair gets an edge exactly like a
    PERSON-PERSON pair would; the edge_type alone never implies a
    semantic relationship like "handling" or "on"."""
    config = WorldModelConfig(proximity_threshold=0.5)
    a = make_entity("vid:a", 0, 0, 50, 50, class_a)
    b = make_entity("vid:b", 60, 0, 110, 50, class_b)

    snapshot = WorldModel(config).build_snapshot(
        [a, b], frame_width=FRAME_W, frame_height=FRAME_H, timestamp=0.0
    )

    assert any(e.edge_type == SceneGraphEdgeType.PROXIMITY for e in snapshot.edges)


def test_box_can_be_supported_by_pallet():
    """A box sitting on a pallet is exactly the geometry the SUPPORT
    hypothesis was designed for — this is the scenario the person-only
    Phase 3/4 dataset could never actually exercise with real classes."""
    config = WorldModelConfig(support_max_vertical_gap=0.01, support_min_horizontal_overlap=0.5)
    pallet = make_entity("vid:pallet", 100, 500, 500, 700, EntityClass.PALLET)
    box = make_entity("vid:box", 150, 200, 450, 500, EntityClass.BOX)

    snapshot = WorldModel(config).build_snapshot(
        [pallet, box], frame_width=FRAME_W, frame_height=FRAME_H, timestamp=0.0
    )

    support_edges = [e for e in snapshot.edges if e.edge_type == SceneGraphEdgeType.SUPPORT]
    assert len(support_edges) == 1
    assert support_edges[0].source_id == "vid:pallet"
    assert support_edges[0].target_id == "vid:box"


def test_box_can_be_supported_by_another_box_stacked():
    config = WorldModelConfig(support_max_vertical_gap=0.01, support_min_horizontal_overlap=0.5)
    bottom_box = make_entity("vid:bottom", 100, 500, 500, 700, EntityClass.BOX)
    top_box = make_entity("vid:top", 150, 200, 450, 500, EntityClass.BOX)

    snapshot = WorldModel(config).build_snapshot(
        [bottom_box, top_box], frame_width=FRAME_W, frame_height=FRAME_H, timestamp=0.0
    )

    support_edges = [e for e in snapshot.edges if e.edge_type == SceneGraphEdgeType.SUPPORT]
    assert len(support_edges) == 1
    assert support_edges[0].source_id == "vid:bottom"
    assert support_edges[0].target_id == "vid:top"


def test_person_near_box_is_proximity_only_never_a_handling_claim():
    """Explicit semantic-honesty check (CLAUDE.md): a PERSON-BOX
    proximity edge is geometry only. This test exists to make the
    non-claim executable, not just documented — nothing about the edge
    object itself encodes "handling", "interacting", or any behaviour."""
    config = WorldModelConfig(proximity_threshold=0.5)
    person = make_entity("vid:person", 0, 0, 50, 50, EntityClass.PERSON)
    box = make_entity("vid:box", 60, 0, 110, 50, EntityClass.BOX)

    snapshot = WorldModel(config).build_snapshot(
        [person, box], frame_width=FRAME_W, frame_height=FRAME_H, timestamp=0.0
    )

    edge = next(e for e in snapshot.edges if e.edge_type == SceneGraphEdgeType.PROXIMITY)
    assert edge.edge_type == SceneGraphEdgeType.PROXIMITY
    assert set(edge.evidence.keys()) == {"distance", "threshold"}
