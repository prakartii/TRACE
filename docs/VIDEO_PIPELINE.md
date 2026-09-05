# TRACE Video Pipeline (Phase 2B, extended in Phase 3)

How video gets from a local MP4 file to a decoded frame, and from there to
detected/tracked entities. See `docs/VIDEO_AUDIT.md` for what the actual
challenge footage contains, and CLAUDE.md §5 for the layer this feeds
into.

```
Video Source (backend/video/source.py)
    ↓
Video Registry (backend/video/registry.py)
    ↓
Metadata / frame access (backend/api/videos.py)
    ↓
Frame (backend/video/source.py)
    ↓
Perception: detector.py → tracker.py → adapter.py → pipeline.py
    ↓
Entity (backend/contracts/models.py) — via backend/api/perception.py
```

## VideoSource

`backend/video/source.py` defines the abstract boundary perception must
consume through: `open()`, `metadata()`, `get_frame(timestamp)`,
`iter_frames(...)`, `close()`. `LocalMP4VideoSource` is the only
implementation today, decoding local MP4 files with OpenCV. A future
RTSP/live source implements the same interface — nothing above this layer
needs to change.

`get_frame`/`iter_frames` return `Frame` objects: a raw BGR `numpy`
image plus `timestamp`, `source_id`, `frame_index`, `width`, `height`.
Perception code never touches `cv2.VideoCapture` or a filesystem path
directly.

## VideoRegistry

`backend/video/registry.py` discovers `*.mp4` files under
`data/challenge_videos/` at scan time — filenames are never hardcoded.
Each file gets:

- a **deterministic id** (`sha256(filename)[:16]`) — stable across
  restarts and re-scans, independent of scan order.
- a **content hash** (full-file `sha256`) used to detect byte-identical
  duplicates. Duplicates are marked (`duplicate_of`), never deleted,
  renamed, or excluded from discovery.
- extracted `VideoMetadata` (duration, width, height, fps, frame_count,
  codec, has_audio) — read from the file itself via `LocalMP4VideoSource`.

Unreadable/corrupt files are skipped, not fabricated — the registry never
invents metadata for a file it couldn't actually decode.

## API

`backend/api/videos.py` exposes the registry over REST for the frontend:

- `GET /api/videos` — list of `VideoSourceInfo` (id, filename, file_size,
  duplicate_of, metadata). No filesystem path is ever included.
- `GET /api/videos/{id}` — one source's metadata.
- `GET /api/videos/{id}/frame?timestamp=<seconds>` — one decoded frame as
  JPEG. This is the endpoint future perception dev/debug tooling would
  reuse; the playback UI doesn't call it.
- `GET /api/videos/{id}/stream` — the raw MP4 via `FileResponse`, which
  natively supports HTTP Range requests — that's what gives the frontend's
  native `<video>` element seeking.

## Perception (Phase 3)

`backend/perception/` consumes `VideoSource`/`Frame` directly — never a
filesystem path, never raw YOLO/ByteTrack objects past `adapter.py`:

- `detector.py` — loads a YOLO model once (lazily, on first use) and runs
  inference on one `Frame.image`, producing internal `RawDetection`s.
- `tracker.py` — wraps `supervision.ByteTrack` behind `ObjectTracker`,
  consuming/producing this package's own `RawDetection`/`TrackedObject`
  types. One instance holds state across one sequential run.
- `adapter.py` — the only place a `TrackedObject` becomes an `Entity`.
  `CLASS_MAP` currently maps only `person`; see its module docstring for
  why the pretrained model's other classes aren't mapped onto TRACE's
  box/pallet/trolley/vehicle-bed entities.
- `pipeline.py` — `PerceptionPipeline.process_video()` sequentially
  samples a video (sparse, configurable `sample_fps`) with one tracker so
  track IDs are meaningful, returning `PerceptionFrameResult`s.

`backend/api/perception.py` exposes this as
`GET /api/videos/{id}/entities?timestamp=`: the first request per video
triggers one full sampled pass and caches it in memory (not the database)
for the rest of the process's lifetime.

## Frontend

`frontend/src/screens/LiveView.jsx` composes a video source library
(`VideoLibrary`), a playback viewport (`VideoViewport` + native `<video>` +
`PlaybackControls`), a metadata panel, and an optional
`PerceptionOverlay` — all reading from `/api/videos`. `VideoViewport`
reserves the layering later phases will add (`RiskOverlay`,
`PlannerOverlay`) without changing; those still don't exist and aren't
faked.

## Content ROI (reserved, not implemented)

`VideoMetadata.content_roi` exists as an optional field so a future
perception phase can define a region of interest — e.g. excluding the
NVMS UI chrome and burned-in hazard captions documented in
`docs/VIDEO_AUDIT.md` — without changing this API. It is `null` today;
nothing computes or sets it, and the raw source frame remains fully
accessible regardless.
