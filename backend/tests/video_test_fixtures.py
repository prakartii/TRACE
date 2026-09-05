"""Generated test-only media fixtures for the video ingestion tests.

Nothing here is a real challenge video. These are tiny, synthetically
generated MP4s (a handful of solid-color frames) created on the fly so the
video tests are hermetic and don't depend on `data/challenge_videos/`
contents or commit real footage as fixtures.
"""

from __future__ import annotations

from pathlib import Path

import cv2
import numpy as np


def make_test_video(
    path: Path,
    frame_count: int = 20,
    fps: float = 10.0,
    width: int = 64,
    height: int = 48,
    seed: int = 0,
) -> Path:
    """Writes a tiny synthetic, silent MP4 to `path` and returns it."""
    fourcc = cv2.VideoWriter_fourcc(*"mp4v")
    writer = cv2.VideoWriter(str(path), fourcc, fps, (width, height))
    try:
        for i in range(frame_count):
            value = (i + seed) * 5 % 255
            frame = np.full((height, width, 3), value, dtype=np.uint8)
            writer.write(frame)
    finally:
        writer.release()
    return path


def make_box(box_type: bytes, payload: bytes) -> bytes:
    """Builds one raw MP4 box (atom): 4-byte size + 4-byte type + payload."""
    size = 8 + len(payload)
    return size.to_bytes(4, "big") + box_type + payload


def make_hdlr_box(handler_type: bytes) -> bytes:
    payload = (
        b"\x00\x00\x00\x00"  # version + flags
        + b"\x00\x00\x00\x00"  # pre_defined
        + handler_type  # handler_type, e.g. b"soun" or b"vide"
        + b"\x00" * 12  # reserved
        + b"TestHandler\x00"  # name
    )
    return make_box(b"hdlr", payload)


def make_moov_with_handler(handler_type: bytes) -> bytes:
    """A minimal (non-playable) moov>trak>mdia>hdlr box tree, used only to
    exercise the dependency-free MP4 box reader against a known handler
    type — not a decodable video."""
    mdia = make_box(b"mdia", make_hdlr_box(handler_type))
    trak = make_box(b"trak", mdia)
    return make_box(b"moov", trak)
