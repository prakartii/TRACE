"""World model configuration (Phase 4).

All thresholds operate on the normalized [0, 1] image-space coordinates
`backend/world_model/geometry.py` produces (position/footprint scaled by
the source frame's width/height) — never raw pixels, and never metric
units. This keeps a single threshold meaningful across different videos
even though none of the 8 challenge clips actually differ in resolution
(all 1280x720 — see docs/VIDEO_AUDIT.md). See docs/WORLD_MODEL.md for the
full reasoning behind each default.
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class WorldModelConfig:
    # PROXIMITY: Euclidean distance between normalized bbox centers, at
    # or under which two entities are considered "close". Chosen against
    # the actual challenge footage (docs/VIDEO_AUDIT.md): people in these
    # elevated dock-camera shots are typically ~0.15-0.35 of frame height
    # tall. 0.12 is roughly one person-width — noticeably nearer than
    # "somewhere in the same wide shot" without being so large that most
    # of a crowded frame counts as "close".
    proximity_threshold: float = 0.12

    # CONTACT: minimum IoU between two normalized footprints to count as
    # meaningful overlap. Kept low deliberately: two bboxes from a single
    # 2D camera projection can overlap substantially without the objects
    # physically touching (e.g. one person partially behind another), so
    # this only claims "these boxes visibly overlap in the image", never
    # "these objects are touching in 3D" — see docs/WORLD_MODEL.md.
    contact_iou_threshold: float = 0.02

    # SUPPORT (image-space hypothesis only — see docs/WORLD_MODEL.md):
    # max normalized vertical gap between the candidate supporter's top
    # edge and the candidate supported object's bottom edge. Small and
    # symmetric (allows slight overlap from bbox imprecision as well as a
    # small gap) since a genuinely stacked item's contact edge should
    # line up closely with what's beneath it.
    support_max_vertical_gap: float = 0.03

    # SUPPORT: minimum horizontal overlap, as a fraction of the narrower
    # of the two footprints' widths, for a support hypothesis. Using the
    # narrower width (not the average or the wider one) is the physically
    # meaningful test: a small item resting on a large pallet only needs
    # *its own* footprint mostly covered, not the pallet's.
    support_min_horizontal_overlap: float = 0.3


DEFAULT_CONFIG = WorldModelConfig()
