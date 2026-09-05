"""Minimal, dependency-free MP4 box (atom) reader.

This exists to answer one narrow question — does this MP4 have an audio
track? — without pulling in a general media-parsing library for a single
boolean field. It is not a general-purpose MP4 parser: it walks top-level
boxes only far enough to find `moov`, then does a bounded substring search
inside it for an audio handler declaration. Any structure this doesn't
recognize returns None (unknown) rather than guessing, since has_audio is
informational metadata, not something downstream reasoning depends on.
"""

from __future__ import annotations

from pathlib import Path
from typing import BinaryIO, Optional

# moov boxes hold only metadata (never sample data), so real-world files
# are at most a few hundred KB here — this cap is a safety bound, not a
# realistic ceiling.
_MAX_MOOV_BYTES = 8 * 1024 * 1024
_MAX_BOXES_SCANNED = 64


def probe_has_audio_track(path: Path) -> Optional[bool]:
    """Best-effort check for an audio track in a local MP4 file."""
    try:
        with open(path, "rb") as f:
            moov = _read_top_level_box(f, b"moov")
    except OSError:
        return None
    if moov is None:
        return None
    return b"soun" in moov


def _read_top_level_box(f: BinaryIO, target_type: bytes) -> Optional[bytes]:
    for _ in range(_MAX_BOXES_SCANNED):
        header = f.read(8)
        if len(header) < 8:
            return None
        size = int.from_bytes(header[0:4], "big")
        box_type = header[4:8]
        header_len = 8

        if size == 1:  # 64-bit extended size follows the type field
            extended = f.read(8)
            if len(extended) < 8:
                return None
            size = int.from_bytes(extended, "big")
            header_len = 16

        if size != 0 and size < header_len:
            return None  # malformed box; bail rather than guess

        body_len = None if size == 0 else size - header_len

        if box_type == target_type:
            if body_len is None or body_len > _MAX_MOOV_BYTES:
                return None
            body = f.read(body_len)
            return body if len(body) == body_len else None

        if body_len is None:
            return None  # target box extends to EOF and wasn't found first
        f.seek(body_len, 1)

    return None
