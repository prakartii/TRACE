"""Pure image-space geometry helpers (Phase 4).

No knowledge of Entity, SceneGraph, video, or HTTP here — just numbers.
Kept separate from scene_graph.py so the coordinate math is trivially
unit-testable and reusable if the relationship engine changes shape.

Coordinate convention: everything here operates on normalized [0, 1]
coordinates (a fraction of frame width/height), not pixels and not
metric units — see docs/WORLD_MODEL.md.
"""

from __future__ import annotations

import math

from backend.contracts.models import BoundingBox


def normalize_bbox(bbox: BoundingBox, frame_width: int, frame_height: int) -> BoundingBox:
    """Converts an absolute-pixel bbox (Entity.bbox's convention) into a
    normalized [0, 1] bbox (SceneGraphNode.footprint's convention)."""
    if frame_width <= 0 or frame_height <= 0:
        raise ValueError(
            f"frame_width/frame_height must be positive, got "
            f"({frame_width}, {frame_height})"
        )
    return BoundingBox(
        x1=bbox.x1 / frame_width,
        y1=bbox.y1 / frame_height,
        x2=bbox.x2 / frame_width,
        y2=bbox.y2 / frame_height,
    )


def bbox_center(bbox: BoundingBox) -> tuple[float, float]:
    return ((bbox.x1 + bbox.x2) / 2.0, (bbox.y1 + bbox.y2) / 2.0)


def bbox_is_degenerate(bbox: BoundingBox) -> bool:
    """True if the box has zero or negative width/height — not a usable
    footprint. Malformed input should be skipped, never fabricated into a
    node with a nonsensical position."""
    return bbox.x2 <= bbox.x1 or bbox.y2 <= bbox.y1


def euclidean_distance(a: tuple[float, float], b: tuple[float, float]) -> float:
    return math.hypot(a[0] - b[0], a[1] - b[1])


def intersection_over_union(a: BoundingBox, b: BoundingBox) -> float:
    ix1, iy1 = max(a.x1, b.x1), max(a.y1, b.y1)
    ix2, iy2 = min(a.x2, b.x2), min(a.y2, b.y2)
    intersection = max(0.0, ix2 - ix1) * max(0.0, iy2 - iy1)
    if intersection <= 0.0:
        return 0.0

    area_a = max(0.0, a.x2 - a.x1) * max(0.0, a.y2 - a.y1)
    area_b = max(0.0, b.x2 - b.x1) * max(0.0, b.y2 - b.y1)
    union = area_a + area_b - intersection
    if union <= 0.0:
        return 0.0
    return intersection / union


def point_in_polygon(point: tuple[float, float], polygon: list[tuple[float, float]]) -> bool:
    """Standard ray-casting point-in-polygon test, operating on the same
    normalized [0, 1] coordinates as everything else here. `polygon` needs
    >=3 points; fewer always returns False rather than raising, since an
    unconfigured/malformed zone should just match nothing."""
    if len(polygon) < 3:
        return False
    x, y = point
    inside = False
    n = len(polygon)
    for i in range(n):
        x1, y1 = polygon[i]
        x2, y2 = polygon[(i + 1) % n]
        if (y1 > y) != (y2 > y):
            x_intersect = x1 + (y - y1) * (x2 - x1) / (y2 - y1)
            if x < x_intersect:
                inside = not inside
    return inside


def horizontal_overlap_ratio(a: BoundingBox, b: BoundingBox) -> float:
    """Horizontal overlap as a fraction of the narrower box's width. 0.0
    if the boxes don't overlap horizontally at all."""
    overlap = min(a.x2, b.x2) - max(a.x1, b.x1)
    if overlap <= 0.0:
        return 0.0
    width_a = a.x2 - a.x1
    width_b = b.x2 - b.x1
    narrower = min(width_a, width_b)
    if narrower <= 0.0:
        return 0.0
    return overlap / narrower


def vertical_overlap_ratio(a: BoundingBox, b: BoundingBox) -> float:
    """Vertical overlap as a fraction of the shorter box's height. 0.0
    if the boxes don't overlap vertically at all."""
    overlap = min(a.y2, b.y2) - max(a.y1, b.y1)
    if overlap <= 0.0:
        return 0.0
    h_a = a.y2 - a.y1
    h_b = b.y2 - b.y1
    shorter = min(h_a, h_b)
    if shorter <= 0.0:
        return 0.0
    return overlap / shorter


def cantilever_overhang_metrics(supporter: BoundingBox, supported: BoundingBox) -> dict[str, float]:
    """Computes exact 2D cantilever overhang ratios relative to the supported box width.
    Distinguishes centered stacking from eccentric overhangs on the left or right edges."""
    supported_w = max(1e-6, supported.x2 - supported.x1)
    overlap = max(0.0, min(supporter.x2, supported.x2) - max(supporter.x1, supported.x1))
    overlap_ratio = min(1.0, overlap / supported_w)

    left_overhang = max(0.0, supporter.x1 - supported.x1) / supported_w
    right_overhang = max(0.0, supported.x2 - supporter.x2) / supported_w
    max_cantilever = max(left_overhang, right_overhang)

    is_centered = abs(left_overhang - right_overhang) < 0.10

    return {
        "horizontal_overlap_ratio": overlap_ratio,
        "overhang_ratio": max(0.0, 1.0 - overlap_ratio),
        "max_cantilever": max_cantilever,
        "left_overhang": left_overhang,
        "right_overhang": right_overhang,
        "is_centered": 1.0 if is_centered else 0.0,
    }


def is_ground_plane_aligned(a: BoundingBox, b: BoundingBox, threshold: float = 0.04) -> bool:
    """Returns True if both boxes have bottom edges (y2) resting at the same ground tier
    in perspective (lower half of the frame). Distinguishes true vertical stacking from
    two objects co-located on the warehouse floor whose 2D boxes overlap in camera perspective."""
    return abs(a.y2 - b.y2) <= threshold and min(a.y2, b.y2) >= 0.45
