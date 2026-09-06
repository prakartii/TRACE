"""Video source abstraction — the perception boundary (CLAUDE.md Layer 1).

Future perception code (Phase 3+) must consume frames only through the
`VideoSource` interface below, never through `cv2.VideoCapture` or a
hardcoded filesystem path directly. Today only local MP4 files are
supported (`LocalMP4VideoSource`); an RTSP/live source can implement the
same interface later without perception code changing.
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass
from pathlib import Path
from typing import Iterator, Optional

import cv2
import numpy as np

from backend.contracts.models import VideoMetadata
from backend.video.mp4_probe import probe_has_audio_track


class VideoDecodeError(RuntimeError):
    """Raised when a source cannot be opened or a frame cannot be decoded."""


@dataclass
class Frame:
    """One decoded frame — the small contract perception will consume.

    `image` is a raw BGR ndarray (OpenCV convention), never a filesystem
    path or an encoded byte stream — encoding to JPEG/PNG is an API-layer
    concern, not part of this contract.
    """

    image: np.ndarray
    timestamp: float
    source_id: str
    frame_index: Optional[int]
    width: int
    height: int


class VideoSource(ABC):
    """Abstract source of decoded frames."""

    source_id: str

    @abstractmethod
    def open(self) -> None: ...

    @abstractmethod
    def metadata(self) -> VideoMetadata: ...

    @abstractmethod
    def get_frame(self, timestamp: float) -> Frame: ...

    @abstractmethod
    def iter_frames(
        self,
        start_time: float = 0.0,
        end_time: Optional[float] = None,
        frame_step: int = 1,
    ) -> Iterator[Frame]: ...

    @abstractmethod
    def close(self) -> None: ...

    def __enter__(self) -> "VideoSource":
        self.open()
        return self

    def __exit__(self, *exc_info: object) -> None:
        self.close()


def _decode_fourcc(fourcc_int: int) -> Optional[str]:
    chars = [chr((fourcc_int >> 8 * i) & 0xFF) for i in range(4)]
    codec = "".join(chars).strip()
    return codec or None


class LocalMP4VideoSource(VideoSource):
    """Decodes a single local MP4 file with OpenCV."""

    def __init__(self, source_id: str, path: Path):
        self.source_id = source_id
        self._path = path
        self._cap: Optional[cv2.VideoCapture] = None
        self._metadata: Optional[VideoMetadata] = None

    @property
    def path(self) -> Path:
        return self._path

    def open(self) -> None:
        if self._cap is not None:
            return
        cap = cv2.VideoCapture(str(self._path))
        if not cap.isOpened():
            cap.release()
            raise VideoDecodeError(
                f"Could not open video source '{self.source_id}' ({self._path.name})"
            )
        self._cap = cap

    def _ensure_open(self) -> "cv2.VideoCapture":
        if self._cap is None:
            self.open()
        assert self._cap is not None
        return self._cap

    def metadata(self) -> VideoMetadata:
        if self._metadata is not None:
            return self._metadata

        cap = self._ensure_open()
        fps = cap.get(cv2.CAP_PROP_FPS) or 0.0
        width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
        height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
        frame_count_raw = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
        frame_count = frame_count_raw if frame_count_raw > 0 else None
        duration = (frame_count_raw / fps) if fps > 0 and frame_count_raw > 0 else 0.0

        self._metadata = VideoMetadata(
            duration=round(duration, 3),
            width=width,
            height=height,
            fps=round(fps, 3),
            frame_count=frame_count,
            codec=_decode_fourcc(int(cap.get(cv2.CAP_PROP_FOURCC))),
            has_audio=probe_has_audio_track(self._path),
        )
        return self._metadata

    def get_frame(self, timestamp: float) -> Frame:
        cap = self._ensure_open()
        meta = self.metadata()

        if timestamp < 0 or timestamp > meta.duration + 1e-3:
            raise ValueError(
                f"timestamp {timestamp}s is outside video duration "
                f"[0, {meta.duration}]s for source '{self.source_id}'"
            )

        last_index = (meta.frame_count - 1) if meta.frame_count else 0
        frame_index = min(int(round(timestamp * meta.fps)), max(last_index, 0))

        cap.set(cv2.CAP_PROP_POS_FRAMES, frame_index)
        ok, image = cap.read()
        if not ok or image is None:
            raise VideoDecodeError(
                f"Failed to decode frame at {timestamp}s (index {frame_index}) "
                f"for source '{self.source_id}'"
            )

        return Frame(
            image=image,
            timestamp=timestamp,
            source_id=self.source_id,
            frame_index=frame_index,
            width=meta.width,
            height=meta.height,
        )

    def iter_frames(
        self,
        start_time: float = 0.0,
        end_time: Optional[float] = None,
        frame_step: int = 1,
    ) -> Iterator[Frame]:
        if frame_step < 1:
            raise ValueError("frame_step must be >= 1")

        cap = self._ensure_open()
        meta = self.metadata()
        if meta.fps <= 0:
            return

        end_time = meta.duration if end_time is None else min(end_time, meta.duration)
        start_index = max(0, int(round(start_time * meta.fps)))
        end_index = int(round(end_time * meta.fps))

        cap.set(cv2.CAP_PROP_POS_FRAMES, start_index)
        index = start_index
        while index <= end_index:
            ok, image = cap.read()
            if not ok or image is None:
                return
            yield Frame(
                image=image,
                timestamp=index / meta.fps,
                source_id=self.source_id,
                frame_index=index,
                width=meta.width,
                height=meta.height,
            )
            index += 1
            for _ in range(frame_step - 1):
                if not cap.grab():
                    return
                index += 1

    def close(self) -> None:
        if self._cap is not None:
            self._cap.release()
            self._cap = None
