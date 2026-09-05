"""Tests for backend/world_model/scene_graph.py — all synthetic Entity
fixtures, no model weights or real video involved."""

import pytest

from backend.contracts.models import BoundingBox, Entity, EntityClass, SceneGraphEdgeType
from backend.world_model.config import WorldModelConfig
from backend.world_model.scene_graph import WorldModel, entity_to_scene_node

FRAME_W = 1000
FRAME_H = 1000


def make_entity(
    entity_id,
    x1,
    y1,
    x2,
    y2,
    track_id=None,
    entity_class=EntityClass.PERSON,
    timestamp=0.0,
    confidence=0.9,
):
    return Entity(
        id=entity_id,
        track_id=track_id if track_id is not None else entity_id,
        entity_class=entity_class,
        bbox=BoundingBox(x1=x1, y1=y1, x2=x2, y2=y2),
        confidence=confidence,
        timestamp=timestamp,
    )


# ---------------------------------------------------------------------
# Entity -> SceneNode conversion
# ---------------------------------------------------------------------


def test_entity_to_scene_node_preserves_identity_and_class():
    entity = make_entity("vid:1", 100, 100, 300, 500)
    node = entity_to_scene_node(entity, FRAME_W, FRAME_H)

    assert node.entity_id == "vid:1"
    assert node.entity_class == EntityClass.PERSON


def test_entity_to_scene_node_center_position():
    entity = make_entity("vid:1", 100, 200, 300, 600)
    node = entity_to_scene_node(entity, FRAME_W, FRAME_H)

    # center px = (200, 400) -> normalized (0.2, 0.4)
    assert node.position == pytest.approx((0.2, 0.4))


def test_entity_to_scene_node_footprint_normalized():
    entity = make_entity("vid:1", 100, 200, 300, 600)
    node = entity_to_scene_node(entity, FRAME_W, FRAME_H)

    assert node.footprint.x1 == pytest.approx(0.1)
    assert node.footprint.y1 == pytest.approx(0.2)
    assert node.footprint.x2 == pytest.approx(0.3)
    assert node.footprint.y2 == pytest.approx(0.6)


def test_entity_to_scene_node_normalization_respects_non_square_frame():
    entity = make_entity("vid:1", 0, 0, 1280, 720)
    node = entity_to_scene_node(entity, frame_width=1280, frame_height=720)

    assert node.footprint == BoundingBox(x1=0.0, y1=0.0, x2=1.0, y2=1.0)


def test_entity_to_scene_node_orientation_and_product_id_are_none():
    entity = make_entity("vid:1", 0, 0, 10, 10)
    node = entity_to_scene_node(entity, FRAME_W, FRAME_H)

    assert node.orientation is None
    assert node.product_id is None


def test_entity_to_scene_node_returns_none_for_degenerate_bbox():
    entity = make_entity("vid:1", 100, 100, 100, 500)  # zero width
    assert entity_to_scene_node(entity, FRAME_W, FRAME_H) is None


# ---------------------------------------------------------------------
# WorldModel.build_snapshot: basic structure
# ---------------------------------------------------------------------


def test_empty_entity_list_produces_empty_snapshot():
    snapshot = WorldModel().build_snapshot(
        [], frame_width=FRAME_W, frame_height=FRAME_H, timestamp=5.0
    )
    assert snapshot.nodes == []
    assert snapshot.edges == []
    assert snapshot.timestamp == 5.0


def test_single_entity_produces_one_node_no_edges():
    entities = [make_entity("vid:1", 0, 0, 100, 100)]
    snapshot = WorldModel().build_snapshot(
        entities, frame_width=FRAME_W, frame_height=FRAME_H, timestamp=1.0
    )
    assert len(snapshot.nodes) == 1
    assert snapshot.edges == []


def test_timestamp_is_the_snapshot_argument_not_entity_timestamps():
    entities = [make_entity("vid:1", 0, 0, 10, 10, timestamp=99.0)]
    snapshot = WorldModel().build_snapshot(
        entities, frame_width=FRAME_W, frame_height=FRAME_H, timestamp=3.5
    )
    assert snapshot.timestamp == 3.5


def test_malformed_entity_is_skipped_not_crashing():
    good = make_entity("vid:1", 0, 0, 100, 100)
    malformed = make_entity("vid:2", 500, 500, 400, 600)  # x2 < x1
    snapshot = WorldModel().build_snapshot(
        [good, malformed], frame_width=FRAME_W, frame_height=FRAME_H, timestamp=0.0
    )
    assert len(snapshot.nodes) == 1
    assert snapshot.nodes[0].entity_id == "vid:1"


def test_stable_track_id_maps_to_same_node_identity_across_snapshots():
    model = WorldModel()
    frame1 = [make_entity("vid:17", 10, 10, 50, 50, timestamp=0.0)]
    frame2 = [make_entity("vid:17", 15, 12, 55, 52, timestamp=0.5)]

    snap1 = model.build_snapshot(frame1, frame_width=FRAME_W, frame_height=FRAME_H, timestamp=0.0)
    snap2 = model.build_snapshot(frame2, frame_width=FRAME_W, frame_height=FRAME_H, timestamp=0.5)

    assert snap1.nodes[0].entity_id == snap2.nodes[0].entity_id == "vid:17"


# ---------------------------------------------------------------------
# Proximity
# ---------------------------------------------------------------------


def test_proximity_edge_created_when_within_threshold():
    config = WorldModelConfig(proximity_threshold=0.2)
    a = make_entity("vid:a", 0, 0, 10, 10)  # center (0.005, 0.005)
    b = make_entity("vid:b", 100, 0, 110, 10)  # center (0.105, 0.005) -> distance 0.1
    snapshot = WorldModel(config).build_snapshot(
        [a, b], frame_width=FRAME_W, frame_height=FRAME_H, timestamp=0.0
    )

    proximity_edges = [e for e in snapshot.edges if e.edge_type == SceneGraphEdgeType.PROXIMITY]
    assert len(proximity_edges) == 1
    assert proximity_edges[0].evidence["distance"] == pytest.approx(0.1)


def test_proximity_edge_absent_when_beyond_threshold():
    config = WorldModelConfig(proximity_threshold=0.05)
    a = make_entity("vid:a", 0, 0, 10, 10)
    b = make_entity("vid:b", 100, 0, 110, 10)  # distance 0.1 > 0.05
    snapshot = WorldModel(config).build_snapshot(
        [a, b], frame_width=FRAME_W, frame_height=FRAME_H, timestamp=0.0
    )

    assert not any(e.edge_type == SceneGraphEdgeType.PROXIMITY for e in snapshot.edges)


def test_proximity_threshold_boundary_is_inclusive():
    config = WorldModelConfig(proximity_threshold=0.1)
    a = make_entity("vid:a", 0, 0, 10, 10)  # center (0.005, 0.005)
    b = make_entity("vid:b", 100, 0, 110, 10)  # distance exactly 0.1
    snapshot = WorldModel(config).build_snapshot(
        [a, b], frame_width=FRAME_W, frame_height=FRAME_H, timestamp=0.0
    )

    assert any(e.edge_type == SceneGraphEdgeType.PROXIMITY for e in snapshot.edges)


# ---------------------------------------------------------------------
# Contact
# ---------------------------------------------------------------------


def test_contact_edge_created_for_overlapping_boxes():
    config = WorldModelConfig(contact_iou_threshold=0.01)
    a = make_entity("vid:a", 0, 0, 200, 200)
    b = make_entity("vid:b", 100, 100, 300, 300)
    snapshot = WorldModel(config).build_snapshot(
        [a, b], frame_width=FRAME_W, frame_height=FRAME_H, timestamp=0.0
    )

    contact_edges = [e for e in snapshot.edges if e.edge_type == SceneGraphEdgeType.CONTACT]
    assert len(contact_edges) == 1
    assert contact_edges[0].evidence["iou"] > 0


def test_contact_edge_absent_for_disjoint_boxes():
    config = WorldModelConfig(contact_iou_threshold=0.01)
    a = make_entity("vid:a", 0, 0, 50, 50)
    b = make_entity("vid:b", 900, 900, 950, 950)
    snapshot = WorldModel(config).build_snapshot(
        [a, b], frame_width=FRAME_W, frame_height=FRAME_H, timestamp=0.0
    )

    assert not any(e.edge_type == SceneGraphEdgeType.CONTACT for e in snapshot.edges)


def test_contact_threshold_boundary_is_inclusive():
    # Two 200x200 boxes overlapping in a 20x200 strip: intersection=20*200=4000,
    # each area=40000, union=40000+40000-4000=76000, iou = 4000/76000
    a = make_entity("vid:a", 0, 0, 200, 200)
    b = make_entity("vid:b", 180, 0, 380, 200)
    iou = 4000 / 76000
    config = WorldModelConfig(contact_iou_threshold=iou)
    snapshot = WorldModel(config).build_snapshot(
        [a, b], frame_width=FRAME_W, frame_height=FRAME_H, timestamp=0.0
    )

    assert any(e.edge_type == SceneGraphEdgeType.CONTACT for e in snapshot.edges)


def test_contact_not_produced_indiscriminately_for_merely_close_boxes():
    """Proximity != contact: two boxes close but not overlapping should
    get a proximity edge without a contact edge."""
    config = WorldModelConfig(proximity_threshold=0.5, contact_iou_threshold=0.01)
    a = make_entity("vid:a", 0, 0, 50, 50)
    b = make_entity("vid:b", 100, 0, 150, 50)  # separated, not overlapping
    snapshot = WorldModel(config).build_snapshot(
        [a, b], frame_width=FRAME_W, frame_height=FRAME_H, timestamp=0.0
    )

    types = {e.edge_type for e in snapshot.edges}
    assert SceneGraphEdgeType.PROXIMITY in types
    assert SceneGraphEdgeType.CONTACT not in types


# ---------------------------------------------------------------------
# Support
# ---------------------------------------------------------------------


def test_support_detected_for_stacked_geometry():
    config = WorldModelConfig(support_max_vertical_gap=0.01, support_min_horizontal_overlap=0.5)
    # supporter (pallet-like) lower in the frame (larger y), supported sits directly above it
    supporter = make_entity("vid:base", 100, 500, 500, 700)  # top edge y1=0.5
    supported = make_entity("vid:top", 150, 200, 450, 500)  # bottom edge y2=0.5
    snapshot = WorldModel(config).build_snapshot(
        [supporter, supported], frame_width=FRAME_W, frame_height=FRAME_H, timestamp=0.0
    )

    support_edges = [e for e in snapshot.edges if e.edge_type == SceneGraphEdgeType.SUPPORT]
    assert len(support_edges) == 1
    assert support_edges[0].source_id == "vid:base"
    assert support_edges[0].target_id == "vid:top"


def test_support_direction_is_independent_of_input_order():
    config = WorldModelConfig(support_max_vertical_gap=0.01, support_min_horizontal_overlap=0.5)
    supporter = make_entity("vid:base", 100, 500, 500, 700)
    supported = make_entity("vid:top", 150, 200, 450, 500)

    snap_ab = WorldModel(config).build_snapshot(
        [supporter, supported], frame_width=FRAME_W, frame_height=FRAME_H, timestamp=0.0
    )
    snap_ba = WorldModel(config).build_snapshot(
        [supported, supporter], frame_width=FRAME_W, frame_height=FRAME_H, timestamp=0.0
    )

    edge_ab = next(e for e in snap_ab.edges if e.edge_type == SceneGraphEdgeType.SUPPORT)
    edge_ba = next(e for e in snap_ba.edges if e.edge_type == SceneGraphEdgeType.SUPPORT)
    assert edge_ab.source_id == edge_ba.source_id == "vid:base"
    assert edge_ab.target_id == edge_ba.target_id == "vid:top"


def test_support_rejected_for_excessive_vertical_gap():
    config = WorldModelConfig(support_max_vertical_gap=0.01, support_min_horizontal_overlap=0.5)
    supporter = make_entity("vid:base", 100, 500, 500, 700)  # top edge y1=0.5
    far_above = make_entity("vid:top", 150, 100, 450, 300)  # bottom edge y2=0.3, gap=0.2
    snapshot = WorldModel(config).build_snapshot(
        [supporter, far_above], frame_width=FRAME_W, frame_height=FRAME_H, timestamp=0.0
    )

    assert not any(e.edge_type == SceneGraphEdgeType.SUPPORT for e in snapshot.edges)


def test_support_rejected_for_insufficient_horizontal_overlap():
    config = WorldModelConfig(support_max_vertical_gap=0.02, support_min_horizontal_overlap=0.5)
    supporter = make_entity("vid:base", 0, 500, 200, 700)  # x range [0, 0.2]
    supported = make_entity("vid:top", 800, 300, 1000, 500)  # x range [0.8, 1.0], no overlap
    snapshot = WorldModel(config).build_snapshot(
        [supporter, supported], frame_width=FRAME_W, frame_height=FRAME_H, timestamp=0.0
    )

    assert not any(e.edge_type == SceneGraphEdgeType.SUPPORT for e in snapshot.edges)


def test_support_not_hypothesized_from_overlap_alone():
    """Two heavily overlapping boxes at the same vertical level (no
    stacking evidence) must not produce a support edge — CLAUDE.md:
    overlap alone is not support."""
    config = WorldModelConfig(support_max_vertical_gap=0.01, support_min_horizontal_overlap=0.3)
    a = make_entity("vid:a", 100, 100, 300, 300)
    b = make_entity("vid:b", 150, 150, 350, 350)  # heavy overlap, same level
    snapshot = WorldModel(config).build_snapshot(
        [a, b], frame_width=FRAME_W, frame_height=FRAME_H, timestamp=0.0
    )

    assert not any(e.edge_type == SceneGraphEdgeType.SUPPORT for e in snapshot.edges)


# ---------------------------------------------------------------------
# Deterministic direction / duplicate prevention
# ---------------------------------------------------------------------


def test_proximity_edge_direction_is_deterministic_regardless_of_input_order():
    config = WorldModelConfig(proximity_threshold=0.5)
    a = make_entity("vid:a", 0, 0, 10, 10)
    b = make_entity("vid:b", 20, 0, 30, 10)

    snap_ab = WorldModel(config).build_snapshot(
        [a, b], frame_width=FRAME_W, frame_height=FRAME_H, timestamp=0.0
    )
    snap_ba = WorldModel(config).build_snapshot(
        [b, a], frame_width=FRAME_W, frame_height=FRAME_H, timestamp=0.0
    )

    edge_ab = next(e for e in snap_ab.edges if e.edge_type == SceneGraphEdgeType.PROXIMITY)
    edge_ba = next(e for e in snap_ba.edges if e.edge_type == SceneGraphEdgeType.PROXIMITY)
    assert (edge_ab.source_id, edge_ab.target_id) == (edge_ba.source_id, edge_ba.target_id)
    assert edge_ab.source_id == "vid:a"  # "vid:a" < "vid:b" lexicographically


def test_no_duplicate_proximity_edges_for_a_pair():
    config = WorldModelConfig(proximity_threshold=0.5)
    a = make_entity("vid:a", 0, 0, 10, 10)
    b = make_entity("vid:b", 20, 0, 30, 10)
    snapshot = WorldModel(config).build_snapshot(
        [a, b], frame_width=FRAME_W, frame_height=FRAME_H, timestamp=0.0
    )

    proximity_edges = [e for e in snapshot.edges if e.edge_type == SceneGraphEdgeType.PROXIMITY]
    assert len(proximity_edges) == 1


def test_no_duplicate_support_edges_for_a_pair():
    config = WorldModelConfig(support_max_vertical_gap=0.01, support_min_horizontal_overlap=0.5)
    supporter = make_entity("vid:base", 100, 500, 500, 700)
    supported = make_entity("vid:top", 150, 200, 450, 500)
    snapshot = WorldModel(config).build_snapshot(
        [supporter, supported], frame_width=FRAME_W, frame_height=FRAME_H, timestamp=0.0
    )

    support_edges = [e for e in snapshot.edges if e.edge_type == SceneGraphEdgeType.SUPPORT]
    assert len(support_edges) == 1


# ---------------------------------------------------------------------
# Multiple entities
# ---------------------------------------------------------------------


def test_multiple_entities_produce_expected_node_count():
    entities = [
        make_entity("vid:1", 0, 0, 50, 50),
        make_entity("vid:2", 200, 200, 250, 250),
        make_entity("vid:3", 800, 800, 850, 850),
    ]
    snapshot = WorldModel().build_snapshot(
        entities, frame_width=FRAME_W, frame_height=FRAME_H, timestamp=0.0
    )
    assert len(snapshot.nodes) == 3
    assert {n.entity_id for n in snapshot.nodes} == {"vid:1", "vid:2", "vid:3"}
