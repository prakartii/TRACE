# TRACE

> See what's about to go wrong. Know what to do instead.

TRACE is an AI Decision Intelligence system for physical warehouse operations. Its core
differentiator is the **Safe Action Planner** — it doesn't just detect risk, it scores
alternative next placements and recommends one before the risky move happens.

The complete product specification lives in [`ARCHITECTURE.md`](./ARCHITECTURE.md).
The engineering/build contract lives in [`CLAUDE.md`](./CLAUDE.md). Both are the source
of truth for this project — read them before changing structure or scope.

## Current status: Phase 8 — Hardened Pipeline, Safe Action Planner & What-If Studio

TRACE has completed **Phase 8.6** of its developmental roadmap. The system features a functional, evidence-aware perception-to-decision pipeline with strict epistemic honesty ceilings, fast-motion tracking hardening, a Safe Action Planner, a single-frame What-If simulation studio, and a Supervisor configuration interface.

For the exhaustive gap analysis between target specification (`ARCHITECTURE.md`) and runtime reality, see:
👉 **[`SPEC_VS_IMPLEMENTATION_AUDIT.md`](./SPEC_VS_IMPLEMENTATION_AUDIT.md)** (Full 14-topic audit, gap matrix, and phased completion roadmap).

### Current Implementation State

#### 1. Implemented & Verified End-to-End
- **Video Ingestion & Streaming:** Discovers local MP4 files, hashes contents (SHA-256) for deduplication, provides frame-seeking and HTTP 206 chunked streaming (`backend/video/`).
- **Perception Pipeline:** Multi-model detection via stock YOLOv8n (person) and fine-tuned pilot weights (person, box, pallet) with ByteTrack multi-object tracking hardened with temporal continuity buffers (`backend/perception/`).
- **Spatial World Model:** 2D normalized bounding geometry, IoU, center distance, overlap ratio, support/proximity/contact scene graph edges with exact geometric evidence payloads (`backend/world_model/`).
- **Temporal & Motion Tracking:** Trajectory history, displacement vectors, velocity, fast-motion acceleration detection, and adaptive temporal sampling (3.0 FPS normal, 6.0 FPS motion-dense) (`backend/world_model/temporal.py`, `backend/perception/sampling.py`).
- **4 Evidence-Aware Risk Lenses:** Behaviour, Structural, Conformance, and Environmental lenses with strict epistemic ceilings (`supported`, `probable`, `insufficient_evidence`, `unsupported`) preventing false certainty on weak detector classes (`backend/lenses/`, `backend/behaviour/`).
- **Safe Action Planner:** Rule-based prescriptive safety engine generating counter-proposals with spatial coordinates, required agents, and geometric rationale (`backend/planner/actions.py`).
- **Supervisor Configuration:** Live SKU registration, catalog management with deletion, and calibrated hazard zone CRUD linked to in-memory manifest synchronization (`backend/api/supervisor.py`, `backend/world_model/manifest.py`).
- **Operational Event Feed (Phase 9.1 - 9.2):** Continuous SQLite audit ledger with multi-criteria filtering, pagination, deduplication, and Responsible AI human operator review (`backend/db/events.py`, `backend/api/events.py`, `screens/EventFeed.jsx`).
- **Incident Replay (Phase 9.3):** Dedicated forensic replay workflow linking operational events directly to exact video moments with surrounding context, 4-tier epistemic classification (Observed, Inferred, Recommended, Hypothetical), Safe Action Planner inspection, What-If simulation integration, and duplicate video handling (`screens/IncidentReplay.jsx`, `backend/tests/test_incident_replay.py`).
- **Tracking Lifecycle & Adaptive Sampling UI:** Bounding box badges render `TRACKED`, `REACQUIRED` (prominent emerald highlight), and `TEMPORARILY_LOST` states; Live View and Metadata Panel expose backend-resolved 3.0 FPS / 6.0 FPS adaptive rates with kinematic rationale.
- **Validated Challenge Scenarios:** 14 audited operational scenarios systematically benchmarked across 8 real warehouse challenge videos (`PHASE_8_REPORT.md`).

#### 2. Partially Implemented
- **Safe Action Planner Screen:** Standalone `PlannerView.jsx` reads active findings from Live View; the operational counter-proposal planner is actively integrated within `LiveView.jsx` and `IncidentReplay.jsx`.
- **Structural 2D Canvas View:** Vectors and scene graph nodes render directly over video in Live View and Incident Replay; standalone 2D canvas is a placeholder.

#### 3. Placeholders / Future Phases
- Aggregate operational **Dashboard & Heat Maps** (`DashboardView.jsx`).
- **Grounded AI Assistant** chat interface (`AssistantView.jsx`).
- Interactive **Micro-Training** custom rule builder (`MicroTrainingView.jsx`).
- Multi-frame continuous sequence What-If video trajectory replay.

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
