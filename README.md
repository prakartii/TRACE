# TRACE

> See what's about to go wrong. Know what to do instead.

TRACE is an AI Decision Intelligence system for physical warehouse operations. Its core
differentiator is the **Safe Action Planner** — it doesn't just detect risk, it scores
alternative next placements and recommends one before the risky move happens.

The complete product specification lives in [`ARCHITECTURE.md`](./ARCHITECTURE.md).
The engineering/build contract lives in [`CLAUDE.md`](./CLAUDE.md). Both are the source
of truth for this project — read them before changing structure or scope.

## Current status: Phase 5 — evidence-aware risk lenses

**A spatial world model sits on top of perception**, and perception is no longer
person-only. A strict Phase 4 gate audit found that the stock COCO-pretrained model
could only ever produce `person` entities — no box, pallet, or trolley, ever — making
10 of the 14 TRACE scenarios structurally impossible to perceive. The remediation: a
small, honestly-measured pilot fine-tune (52 real, hand-annotated frames — see
`training/README.md`) adding `box` and `pallet` as genuinely detected classes,
available as an explicit opt-in (`?model=pilot` on `/entities` and `/scene`, or the
"Use pilot model" toggle in Live View) alongside the unchanged stock model. **Measured
results, not assumed:** person mAP50=0.955 (no regression), box mAP50=0.351 (real but
weak), pallet mAP50=0.040 (did not learn — only 12 training instances). The system
always states which model produced a given result (`model_identity`) and never
substitutes one for the other silently.

The Live View screen also has a scene-graph overlay showing a `SceneGraphSnapshot`:
nodes (person, and now box/pallet under the pilot model) plus proximity/contact/support
edges between them, each carrying the exact geometric evidence (distance, IoU, vertical
gap, horizontal overlap) that produced it — still only a geometric/spatial reading, not
a hazard, behaviour, or risk claim. See `docs/WORLD_MODEL.md` for the coordinate system,
edge semantics, and a real-footage finding worth reading before trusting a SUPPORT edge
from the stock (person-only) model: an observed support hypothesis there is essentially
always two people near each other in a crowd, not real physical support (a concrete
example from `Rolling and dropping carton.mp4` is documented there). The pilot model's
`box`↔`pallet` support edges are the first ones with real potential physical meaning —
see `training/README.md` for what's actually been validated.

Phase 5 adds evidence-graded findings on top of that world model: a temporal evidence
layer, a Behaviour lens (PERSON↔BOX proximity/displacement only — never labeled
throwing/dragging/lifting), a Structural lens (reinterprets Phase 4 SUPPORT edges for
PERSON/BOX/PALLET pairs, explicitly excluding PERSON↔PERSON from ever being called
stacking), an architecture-only Conformance lens (always `unsupported` — no product
metadata is linked to any entity yet), and a minimal manual-zone Environmental lens (no
automatic wet-floor/dock-edge detection). Every finding carries an explicit
`supported`/`probable`/`insufficient_evidence`/`unsupported` status driven by measured
per-class detection reliability, not raw detector confidence — see
`docs/RISK_LENSES.md` for the full semantics and known limitations. Real-footage smoke
testing confirms the stock (person-only) model never fabricates a box-related finding,
and the pilot model's weak box/pallet classes cap findings at `probable`, never
`supported`.

Still not built: predictive risk, the Safe Action Planner's candidate-placement scoring,
what-if simulation, intervention, outcome verification, near-miss analytics,
micro-training, learning/analytics, and the AI assistant.

What's implemented so far:

- A running FastAPI backend with `/health`, `/meta`, a video registry/API under
  `/api/videos`, a perception API (`/api/videos/{id}/entities`), and a world-model API
  (`/api/videos/{id}/scene`).
- A SQLite schema (`backend/db/schema.sql`) matching the product spec's data model, and
  a small `sqlite3`-based loader with no ORM.
- Typed data contracts (`backend/contracts/models.py`) that every later layer
  (perception → world model → lenses → predictive risk → planner → intervention →
  measurement) will communicate through, so no layer is coupled to detector/tracker
  internals or frontend shapes. Includes `VideoMetadata`/`VideoSourceInfo`,
  `PerceptionFrameResult`, and `SceneGraphNode`/`SceneGraphEdge`/`SceneGraphSnapshot`
  (the latter three predate Phase 4 — added in the Phase 1 scaffold and reused as-is,
  with one additive field: `SceneGraphEdge.evidence`).
- `backend/video/` — the video source abstraction: `VideoSource` (interface),
  `LocalMP4VideoSource` (OpenCV-backed implementation), and `VideoRegistry`
  (filesystem discovery + deterministic IDs + duplicate detection). See
  `docs/VIDEO_PIPELINE.md`.
- `backend/perception/` — `detector.py` (YOLO wrapper), `tracker.py` (ByteTrack wrapper,
  via `supervision`), `adapter.py` (the only place detector/tracker output becomes an
  `Entity`), `pipeline.py` (Frame → detections → tracks → Entities), `config.py`. YOLO
  and ByteTrack internals never leak past `adapter.py` — nothing downstream depends on
  them.
- `backend/world_model/` — `geometry.py` (pure normalize/distance/IoU/overlap math),
  `scene_graph.py` (`WorldModel.build_snapshot()`: Entity → SceneGraphNode, and the
  proximity/contact/support relationship engine), `config.py`. See `docs/WORLD_MODEL.md`
  for the coordinate system and every threshold's justification.
- `backend/api/videos.py` — `GET /api/videos`, `GET /api/videos/{id}`,
  `GET /api/videos/{id}/frame?timestamp=`, `GET /api/videos/{id}/stream`.
- `backend/api/perception.py` — `GET /api/videos/{id}/entities?timestamp=`. The first
  request for a video triggers one sparse-sampled sequential pass (so track IDs are
  meaningful) and caches the result in memory for that server run; nothing is written to
  the database.
- `backend/api/scene.py` — `GET /api/videos/{id}/scene?timestamp=`. Reuses the same
  perception cache as `/entities` (no second inference pass) and layers the world model
  on top.
- `backend/world_model/temporal.py` (Phase 5) — track histories, displacement/speed/
  direction/sustained-proximity primitives built on Phase 3's `Entity.id` and Phase 4's
  geometry, over a small bounded window of already-cached samples.
- `backend/behaviour/lens.py`, `backend/lenses/{structural,conformance,environmental}.py`,
  `backend/risk/{config,aggregation}.py`, `backend/planner/actions.py` (Phase 5) — the
  four risk lenses, centralized evidence-quality thresholds, and Safe Action Planner
  action-text mapping. See `docs/RISK_LENSES.md`.
- `backend/api/findings.py` — `GET /api/videos/{id}/findings?timestamp=&model=`. Reuses
  the same perception cache and `WorldModel` as `/entities`/`/scene`.
- Empty, purpose-named backend packages for each future layer (`rules/`, `intervention/`,
  `measurement/`, `learning/`, `assistant/`) — structure only, no logic.
- A Vite + React + Tailwind frontend: header, nav rail listing the product's 10 screens,
  and a working **Live View** screen — a video source library, native playback with a
  custom control bar (play/pause, seek, timestamp), a metadata panel, an optional
  perception overlay (bounding box + class + confidence + track ID), and an optional
  scene-graph overlay (entity markers + relationship lines, with a legend explaining that
  these are geometric observations, not risk/behaviour claims). Both overlays are
  reserved as their own layers so later phases can add risk/planner overlays without
  touching either. Every other screen is still a placeholder.

## Model weights

`models/yolov8n.pt` (pretrained COCO weights, Ultralytics) is used for detection. It is
gitignored and not committed. Obtain it by running once, from the repo root with the
venv active:

```bash
python -c "from ultralytics import YOLO; YOLO('yolov8n.pt')"
```

then move the downloaded `yolov8n.pt` into `models/`. (`backend/perception/config.py`
points at `models/yolov8n.pt` via a relative path — never a hardcoded absolute path.)
Swapping in a future TRACE-fine-tuned checkpoint (box/pallet/trolley/vehicle-bed
classes) is a one-line change to that config once labeled training data exists — no
other perception code needs to change.

## Python environment

Backend dependencies include OpenCV, PyTorch, Ultralytics (YOLOv8), and `supervision`
(ByteTrack) for detection/tracking. Use a project-local virtual environment so none of
this touches Python packages outside the project:

```bash
python -m venv .venv
.venv\Scripts\activate        # Windows
# source .venv/bin/activate   # macOS/Linux

pip install -r backend/requirements.txt
```

## Backend

Run everything from the repository root, so `backend` resolves as a package
(its modules import each other as `backend.db.db`, `backend.contracts.models`, etc.):

```bash
uvicorn backend.main:app --reload
```

Runs on `http://localhost:8000`. Check `GET /health`, `GET /meta`, `GET /api/videos`,
`GET /api/videos/{id}/entities?timestamp=0`, and `GET /api/videos/{id}/scene?timestamp=0`.
The first two of those load the model on first call and can take a while (up to roughly
a minute for the longest clip) — subsequent calls for the same video, including
`/scene`, reuse the same in-memory cache and are fast.

```bash
python -m pytest backend/tests
```

## Frontend

```bash
cd frontend
npm install
npm run dev
```

Runs on `http://localhost:5173`. It calls the backend's `/health` endpoint on load to
show a live backend-status indicator; start the backend first (or expect "offline").
Open the **Live View** screen to browse and play the discovered videos.

## Challenge videos

Place the challenge-provided MP4 files in:

```
data/challenge_videos/
```

This directory is **gitignored and local-only** — the video files themselves are never
committed (only a `.gitkeep` placeholder is tracked). The backend discovers whatever
`*.mp4` files are actually present there at request time; nothing is hardcoded. See
`docs/VIDEO_AUDIT.md` for a full inventory and content audit of the current footage.

## Repository layout

See `ARCHITECTURE.md` Part 3 for the target structure and `CLAUDE.md` §4 for the
16-phase build order this project follows. Each phase is implemented, tested, and
verified before the next one starts.
