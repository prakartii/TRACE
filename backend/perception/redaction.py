"""Face / head redaction for served video pixels (Responsible AI — CLAUDE.md §22).

TRACE's structural, conformance and behaviour reasoning is worker-independent:
it never needs a recognisable face. Any frame TRACE *renders back to a user*
(the still-frame endpoint today; clip thumbnails later) therefore has personnel
head regions obscured by default.

This module is deliberately perception-local and framework-free — it takes a
BGR ndarray plus person bounding boxes and returns a redacted copy. There is no
face-recognition model here and none is wanted: the head region is derived
geometrically from the person detection the pipeline already produces, so a
missed face is a missed *detection*, never a recognised identity that leaked.

Known limitation: this covers frames TRACE encodes itself. The raw MP4 served
by ``/api/videos/{id}/stream`` is not transcoded; the live view redacts at the
presentation layer instead (see ``FaceRedactionOverlay`` on the frontend). A
server-side transcode pass is a follow-up, as is gating the disable toggle
behind supervisor RBAC (no auth layer exists yet).
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Iterable, Sequence

import numpy as np

# A person bounding box in absolute source-frame pixels: (x1, y1, x2, y2).
BBox = tuple[float, float, float, float]


@dataclass(frozen=True)
class RedactionConfig:
    """How head regions are located and obscured. Immutable; the default
    instance is the one wired into ``PerceptionConfig``."""

    enabled: bool = True
    # "pixelate" (mosaic — robustly unrecognisable) or "gaussian" (soft blur).
    method: str = "pixelate"
    # Head region = the top `head_fraction` of a person box's height.
    head_fraction: float = 0.35
    # Head region width as a fraction of the person box width (centred).
    head_width_fraction: float = 0.85
    # Extra padding around the head region, as a fraction of its own size.
    pad: float = 0.12
    # Mosaic: the head region is resampled down to this many blocks on its
    # shorter side, then back up with nearest-neighbour.
    mosaic_blocks: int = 10
    # Gaussian: kernel size as a fraction of the head region's shorter side.
    blur_strength: float = 0.35
    # Regions smaller than this (px, shorter side) are skipped — nothing
    # identifiable at that scale, and tiny kernels are just noise.
    min_region_px: int = 6


DEFAULT_REDACTION = RedactionConfig()


def head_region(box: BBox, frame_w: int, frame_h: int, config: RedactionConfig) -> tuple[int, int, int, int]:
    """Geometric head/face rectangle for one person box, clamped to the frame.

    Returns integer ``(x1, y1, x2, y2)``. A degenerate result (zero area) is
    possible for a box already outside the frame — callers skip those.
    """
    x1, y1, x2, y2 = box
    bw = max(0.0, x2 - x1)
    bh = max(0.0, y2 - y1)
    if bw <= 0.0 or bh <= 0.0:
        return (0, 0, 0, 0)

    cx = (x1 + x2) / 2.0
    aspect = bw / bh

    # Adaptive head fraction based on worker posture:
    # Upright: head is top ~35%.
    # Stooping/crouching (aspect >= 0.85): height is compressed, head/face occupies larger fraction of vertical profile.
    if aspect >= 0.85:
        head_frac = min(0.48, config.head_fraction * 1.35)
        width_frac = max(config.head_width_fraction, 0.85)
    else:
        head_frac = config.head_fraction
        width_frac = config.head_width_fraction

    head_h = max(20.0, bh * head_frac)
    half_w = max(14.0, (bw * width_frac) / 2.0)
    pad_x = half_w * 2.0 * config.pad
    pad_y = head_h * config.pad

    rx1 = cx - half_w - pad_x
    rx2 = cx + half_w + pad_x
    ry1 = y1 - pad_y
    ry2 = y1 + head_h + pad_y

    ix1 = max(0, int(round(rx1)))
    iy1 = max(0, int(round(ry1)))
    ix2 = min(frame_w, int(round(rx2)))
    iy2 = min(frame_h, int(round(ry2)))
    if ix2 <= ix1 or iy2 <= iy1:
        return (0, 0, 0, 0)
    return (ix1, iy1, ix2, iy2)



def _obscure_patch(patch: np.ndarray, config: RedactionConfig) -> np.ndarray:
    import cv2

    h, w = patch.shape[:2]
    if min(h, w) < config.min_region_px:
        return patch

    if config.method == "gaussian":
        k = int(min(h, w) * config.blur_strength)
        k = max(3, k | 1)  # force odd, >= 3
        return cv2.GaussianBlur(patch, (k, k), 0)

    # Mosaic / pixelate (default).
    blocks = max(1, config.mosaic_blocks)
    small_w = max(1, w * blocks // max(h, w))
    small_h = max(1, h * blocks // max(h, w))
    small = cv2.resize(patch, (small_w, small_h), interpolation=cv2.INTER_LINEAR)
    return cv2.resize(small, (w, h), interpolation=cv2.INTER_NEAREST)


def redact_regions(
    image: np.ndarray,
    regions: Iterable[tuple[int, int, int, int]],
    config: RedactionConfig = DEFAULT_REDACTION,
) -> np.ndarray:
    """Return a copy of ``image`` with each ``(x1, y1, x2, y2)`` region obscured.

    The input is never mutated. Regions are clamped to the image bounds and
    empty ones are skipped.
    """
    out = image.copy()
    h, w = out.shape[:2]
    for (x1, y1, x2, y2) in regions:
        x1 = max(0, min(int(x1), w))
        y1 = max(0, min(int(y1), h))
        x2 = max(0, min(int(x2), w))
        y2 = max(0, min(int(y2), h))
        if x2 <= x1 or y2 <= y1:
            continue
        out[y1:y2, x1:x2] = _obscure_patch(out[y1:y2, x1:x2], config)
    return out


def redact_person_faces(
    image: np.ndarray,
    person_boxes: Sequence[BBox],
    config: RedactionConfig = DEFAULT_REDACTION,
) -> np.ndarray:
    """Obscure the head region of every person box in ``image``.

    Returns ``image`` unchanged (a copy) when redaction is disabled or there
    are no person boxes.
    """
    if not config.enabled or not person_boxes:
        return image.copy()
    h, w = image.shape[:2]
    regions = [head_region(box, w, h, config) for box in person_boxes]
    regions = [r for r in regions if r[2] > r[0] and r[3] > r[1]]
    if not regions:
        return image.copy()
    return redact_regions(image, regions, config)
