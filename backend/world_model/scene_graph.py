"""Entity -> SceneGraphSnapshot (Phase 4 — world model / scene graph).

`WorldModel.build_snapshot()` is the only entry point: it is pure and
deterministic (same entities + frame size + timestamp in, same
SceneGraphSnapshot out) and knows nothing about video decoding, YOLO,
tracking, HTTP, or persistence — see CLAUDE.md's layer-boundary rule.

Track identity: `SceneGraphNode.entity_id` is exactly `Entity.id`
(`"<source_id>:<track_id>"`, assigned in backend/perception/adapter.py).
This module does not run a second tracker or invent new identities —
the same track_id across snapshots from the same video is the same node.

Relationship semantics (see docs/WORLD_MODEL.md for the full write-up):
  - PROXIMITY and CONTACT are symmetric. To avoid emitting both (A, B)
    and (B, A) for the same pair, they're always recorded with
    source_id/target_id ordered by `entity_id` ascending.
  - SUPPORT is directional (supporter -> supported) and image-space only
    — this is a 2D camera projection, not verified 3D contact. Both
    orderings of a pair are tested; at most one can pass given the
    vertical-ordering check is asymmetric by construction.
None of these edges are a semantic/behavioural claim (CLAUDE.md: "person
near carton" is not "person is throwing carton") — that's a later layer.
"""

from __future__ import annotations

from backend.contracts.models import (
    Entity,
    SceneGraphEdge,
    SceneGraphEdgeType,
    SceneGraphNode,
    SceneGraphSnapshot,
)
from backend.world_model.config import DEFAULT_CONFIG, WorldModelConfig
from backend.world_model.geometry import (
    bbox_center,
    bbox_is_degenerate,
    euclidean_distance,
    horizontal_overlap_ratio,
    intersection_over_union,
    normalize_bbox,
)


def entity_to_scene_node(
    entity: Entity, frame_width: int, frame_height: int
) -> SceneGraphNode | None:
    """Deterministic Entity -> SceneGraphNode conversion. Returns None for
    a degenerate bbox (x2<=x1 or y2<=y1) rather than fabricating a node
    with a nonsensical position/footprint — malformed input is skipped,
    not silently coerced into something misleading."""
    if bbox_is_degenerate(entity.bbox):
        return None

    footprint = normalize_bbox(entity.bbox, frame_width, frame_height)
    position = bbox_center(footprint)

    return SceneGraphNode(
        entity_id=entity.id,
        entity_class=entity.entity_class,
        position=position,
        footprint=footprint,
        orientation=None,  # no pose signal exists upstream in Phase 3/4
        product_id=None,  # no product-metadata linkage exists yet
    )


def _evaluate_support(
    supporter: SceneGraphNode, supported: SceneGraphNode, config: WorldModelConfig
) -> dict[str, float] | None:
    """Tests the hypothesis that `supporter` holds up `supported` — i.e.
    `supported` sits directly on top of `supporter` in image space.
    Directional: call with arguments swapped to test the other way.
    Returns the evidence dict if the geometry supports the hypothesis,
    else None."""
    supporter_box = supporter.footprint
    supported_box = supported.footprint
    if supporter_box is None or supported_box is None:
        return None

    # supported's bottom edge (y2) should sit close to supporter's top
    # edge (y1) — near zero gap, allowing a small tolerance both for a
    # genuine sliver of space and for bbox imprecision causing slight
    # overlap (negative gap).
    vertical_gap = supporter_box.y1 - supported_box.y2
    if abs(vertical_gap) > config.support_max_vertical_gap:
        return None

    overlap_ratio = horizontal_overlap_ratio(supporter_box, supported_box)
    if overlap_ratio < config.support_min_horizontal_overlap:
        return None

    return {"vertical_gap": vertical_gap, "horizontal_overlap_ratio": overlap_ratio}


class WorldModel:
    """Builds one SceneGraphSnapshot per call. Stateless across calls —
    Phase 3's tracker is the only tracking state; this class re-derives
    the graph fresh from whatever Entity list it's given."""

    def __init__(self, config: WorldModelConfig = DEFAULT_CONFIG):
        self._config = config

    def build_snapshot(
        self,
        entities: list[Entity],
        *,
        frame_width: int,
        frame_height: int,
        timestamp: float,
    ) -> SceneGraphSnapshot:
        nodes: list[SceneGraphNode] = []
        for entity in entities:
            node = entity_to_scene_node(entity, frame_width, frame_height)
            if node is not None:
                nodes.append(node)

        edges = self._build_edges(nodes)
        return SceneGraphSnapshot(timestamp=timestamp, nodes=nodes, edges=edges)

    def _build_edges(self, nodes: list[SceneGraphNode]) -> list[SceneGraphEdge]:
        edges: list[SceneGraphEdge] = []
        for i in range(len(nodes)):
            for j in range(i + 1, len(nodes)):
                a, b = nodes[i], nodes[j]
                first, second = (a, b) if a.entity_id <= b.entity_id else (b, a)

                proximity = self._proximity_edge(first, second)
                if proximity is not None:
                    edges.append(proximity)

                contact = self._contact_edge(first, second)
                if contact is not None:
                    edges.append(contact)

                support = self._support_edge(a, b)
                if support is not None:
                    edges.append(support)
        return edges

    def _proximity_edge(
        self, first: SceneGraphNode, second: SceneGraphNode
    ) -> SceneGraphEdge | None:
        distance = euclidean_distance(first.position, second.position)
        if distance > self._config.proximity_threshold:
            return None
        weight = 1.0 - distance / self._config.proximity_threshold
        return SceneGraphEdge(
            source_id=first.entity_id,
            target_id=second.entity_id,
            edge_type=SceneGraphEdgeType.PROXIMITY,
            weight=max(0.0, min(1.0, weight)),
            evidence={"distance": distance, "threshold": self._config.proximity_threshold},
        )

    def _contact_edge(
        self, first: SceneGraphNode, second: SceneGraphNode
    ) -> SceneGraphEdge | None:
        if first.footprint is None or second.footprint is None:
            return None
        iou = intersection_over_union(first.footprint, second.footprint)
        if iou < self._config.contact_iou_threshold:
            return None
        return SceneGraphEdge(
            source_id=first.entity_id,
            target_id=second.entity_id,
            edge_type=SceneGraphEdgeType.CONTACT,
            weight=max(0.0, min(1.0, iou)),
            evidence={"iou": iou},
        )

    def _support_edge(
        self, a: SceneGraphNode, b: SceneGraphNode
    ) -> SceneGraphEdge | None:
        evidence = _evaluate_support(a, b, self._config)
        if evidence is not None:
            supporter, supported = a, b
        else:
            evidence = _evaluate_support(b, a, self._config)
            if evidence is None:
                return None
            supporter, supported = b, a

        weight = max(0.0, min(1.0, evidence["horizontal_overlap_ratio"]))
        return SceneGraphEdge(
            source_id=supporter.entity_id,
            target_id=supported.entity_id,
            edge_type=SceneGraphEdgeType.SUPPORT,
            weight=weight,
            evidence=evidence,
        )
