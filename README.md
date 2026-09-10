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

- **Structural 2D View (Digital Twin):** Synchronized frame-by-frame 2D top-down blueprint alongside CCTV video, dense 5.0 FPS tracking, precomputed zero-latency disk cache (<50ms retrieval), continuous linear interpolation with nearest-neighbor track-recovery fallback, SVG depth layering (pallets on floor deck -> depth-ordered cartons -> workers on top), and real-time inventory count badge (`screens/StructuralView.jsx`).
- **Grounded AI Safety Assistant:** Direct auditable assistant connected to SQLite audit logs and safety protocols. Formatted warehouse cards (Safety Protocol, Immediate Action, Supervisor Tip & Recommendation), 3-factor counterfactual stability formula, and interactive collapsible dropdown accordion for Related Event Records with single-record `<select>` filter (`screens/AiAssistant.jsx`, `backend/assistant/`).
- **Operational Dashboard & Heat Maps:** Real-time KPI dashboard tracking verified damage preventions, near-miss events, hourly risk heatmaps, and bay risk distribution (`screens/Dashboard.jsx`).
- **Supervisor Rules & Catalog:** Live SKU catalog management, polygon hazard zone editor, and custom operational safety rules (`screens/SupervisorSettings.jsx`, `backend/rules/`).
- **Worker Privacy & Responsible AI:** Dynamic face redaction toggle, auto-purge retention scheduler, and identity-blind ethics preventing punitive worker profiling (`screens/ResponsibleAiPanel.jsx`).

#### 2. Advanced / Roadmap Extensions
- Multi-frame continuous sequence generative What-If video trajectory replay.
- Edge device hardware deployment package for embedded warehouse camera gateways.

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

## Docker

Container definitions are provided for both services:

| File | Purpose |
| --- | --- |
| `Dockerfile` | Backend API image. Multi-stage: a builder installs the CPU-only PyTorch / OpenCV / Ultralytics stack into a venv and pre-fetches `yolov8n.pt` + `yolov8n-pose.pt`; the runtime stage carries only the venv, weights, and code. Runs as non-root on port `8000`. |
| `frontend/Dockerfile` | Frontend image. Builds the Vite bundle (Node stage) and serves the static assets with nginx on port `80`. `VITE_API_BASE_URL` is baked in at build time — it must be the URL the **browser** uses to reach the backend, not a Docker network name. |
| `docker-compose.yml` | Runs the full stack: `backend` on `http://localhost:8000`, `frontend` on `http://localhost:5173`. |

```bash
docker compose up --build
```

Then open `http://localhost:5173`. Notes:

- The backend image is large (~2–3 GB) because of the ML dependency tree; the first
  build downloads it all.
- The SQLite event ledger persists in the `backend-db` named volume and is re-seeded
  from `backend/db/canonical_seed.py` on startup, so the demo data survives restarts.
- `./data` is bind-mounted into the backend container — drop challenge MP4s into
  `./data/challenge_videos/` on the host and the backend picks them up (see below).
- Optional environment (create a `.env` next to `docker-compose.yml`):
  `ANTHROPIC_API_KEY` enables the assistant's LLM phrasing layer (it falls back to
  deterministic retrieval without one); `VITE_API_BASE_URL` overrides the baked-in
  backend URL for the frontend build.
- The image build needs working DNS / registry access. On networks that filter
  outbound DNS, build from a different network (e.g. a phone hotspot) once — the
  layers are then cached locally.

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
