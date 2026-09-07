"""Video registry — discovers local MP4 sources under a directory and
exposes stable, deterministic identifiers and metadata.

Perception and the API layer depend only on this registry, never on raw
filenames or filesystem paths (CLAUDE.md video-safety requirement: source
files are read-only — this module never renames, deletes, moves, or
otherwise modifies them).
"""

from __future__ import annotations

import hashlib
from dataclasses import dataclass
from pathlib import Path
from typing import Optional

from backend.contracts.models import VideoMetadata, VideoSourceInfo
from backend.video.source import LocalMP4VideoSource, VideoDecodeError

# backend/video/registry.py -> backend/video -> backend -> repo root
DEFAULT_VIDEO_DIR = Path(__file__).resolve().parents[2] / "data" / "challenge_videos"


def make_source_id(filename: str) -> str:
    """Deterministic id derived from the filename alone — stable across
    process restarts and directory re-scans, regardless of scan order."""
    return hashlib.sha256(filename.encode("utf-8")).hexdigest()[:16]


def _file_content_hash(path: Path, chunk_size: int = 1024 * 1024) -> str:
    digest = hashlib.sha256()
    with open(path, "rb") as f:
        while True:
            chunk = f.read(chunk_size)
            if not chunk:
                break
            digest.update(chunk)
    return digest.hexdigest()


@dataclass
class VideoRecord:
    """Internal registry entry. `path` is intentionally never sent to the
    API — see `to_public()` / `VideoSourceInfo` for the public contract."""

    id: str
    filename: str
    path: Path
    file_size: int
    metadata: VideoMetadata
    content_hash: str
    duplicate_of: Optional[str] = None

    def to_public(self) -> VideoSourceInfo:
        return VideoSourceInfo(
            id=self.id,
            filename=self.filename,
            file_size=self.file_size,
            duplicate_of=self.duplicate_of,
            metadata=self.metadata,
        )


class VideoRegistry:
    """Discovers `*.mp4` files under a directory. Filenames are never
    hardcoded — the set of available videos is whatever is actually on
    disk when `refresh()` runs."""

    def __init__(self, video_dir: Path = DEFAULT_VIDEO_DIR):
        self._video_dir = Path(video_dir)
        self._records: dict[str, VideoRecord] = {}
        self._scanned = False

    def refresh(self) -> None:
        records: dict[str, VideoRecord] = {}
        if self._video_dir.is_dir():
            paths = sorted(
                p
                for p in self._video_dir.iterdir()
                if p.is_file() and p.suffix.lower() == ".mp4"
            )
            for path in paths:
                record = self._build_record(path)
                if record is not None:
                    records[record.id] = record
            self._mark_duplicates(records)
        self._records = records
        self._scanned = True

    def _ensure_scanned(self) -> None:
        if not self._scanned:
            self.refresh()

    @staticmethod
    def _build_record(path: Path) -> Optional[VideoRecord]:
        try:
            source_id = make_source_id(path.name)
            file_size = path.stat().st_size
            content_hash = _file_content_hash(path)
            source = LocalMP4VideoSource(source_id, path)
            try:
                source.open()
                metadata = source.metadata()
            finally:
                source.close()
        except (VideoDecodeError, OSError):
            # Unreadable/corrupt file: skip it rather than fail the whole
            # scan, and never fabricate metadata for a file that can't
            # actually be decoded (CLAUDE.md honesty rule).
            return None

        return VideoRecord(
            id=source_id,
            filename=path.name,
            path=path,
            file_size=file_size,
            metadata=metadata,
            content_hash=content_hash,
        )

    @staticmethod
    def _mark_duplicates(records: dict[str, VideoRecord]) -> None:
        by_hash: dict[str, list[VideoRecord]] = {}
        for record in records.values():
            by_hash.setdefault(record.content_hash, []).append(record)

        for group in by_hash.values():
            if len(group) < 2:
                continue
            # Canonical should prefer clean original names without copy suffixes like " (1)"
            def _canonical_key(r: VideoRecord) -> tuple[int, str]:
                has_copy_suffix = 1 if (" (" in r.filename or "copy" in r.filename.lower()) else 0
                return (has_copy_suffix, r.filename)

            group.sort(key=_canonical_key)
            canonical = group[0]
            for duplicate in group[1:]:
                duplicate.duplicate_of = canonical.id

    def list_videos(self) -> list[VideoRecord]:
        self._ensure_scanned()
        return sorted(self._records.values(), key=lambda r: r.filename)

    def get(self, video_id: str) -> Optional[VideoRecord]:
        self._ensure_scanned()
        rec = self._records.get(video_id)
        if rec is not None:
            return rec
        for r in self._records.values():
            if r.filename == video_id:
                return r
        return None

    def open_source(self, video_id: str) -> LocalMP4VideoSource:
        record = self.get(video_id)
        if record is None:
            raise KeyError(video_id)
        return LocalMP4VideoSource(record.id, record.path)
