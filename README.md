# TRACE

> See what's about to go wrong. Know what to do instead.

TRACE is an AI Decision Intelligence system for physical warehouse operations. Its core
differentiator is the **Safe Action Planner** — it doesn't just detect risk, it scores
alternative next placements and recommends one before the risky move happens.

The complete product specification lives in [`ARCHITECTURE.md`](./ARCHITECTURE.md).
The engineering/build contract lives in [`CLAUDE.md`](./CLAUDE.md). Both are the source
of truth for this project — read them before changing structure or scope.

## Current status: Phase 1 — foundation scaffold

Nothing beyond the scaffold is implemented yet. Specifically **not yet built**:
perception (YOLO/tracking), world model, the four risk lenses, predictive risk, the
Safe Action Planner, what-if simulation, intervention, outcome verification, near-miss
analytics, micro-training, learning/analytics, and the AI assistant.

What Phase 1 does provide:

- A running FastAPI backend with a `/health` and `/meta` endpoint.
- A SQLite schema (`backend/db/schema.sql`) matching the product spec's data model, and
  a small `sqlite3`-based loader with no ORM.
- Typed data contracts (`backend/contracts/models.py`) that every later layer
  (perception → world model → lenses → predictive risk → planner → intervention →
  measurement) will communicate through, so no layer is coupled to detector/tracker
  internals or frontend shapes.
- Empty, purpose-named backend packages for each future layer (`perception/`,
  `world_model/`, `lenses/`, `behaviour/`, `risk/`, `planner/`, `rules/`,
  `intervention/`, `measurement/`, `learning/`, `assistant/`) — structure only, no logic.
- A running Vite + React + Tailwind frontend shell: header, nav rail listing the
  product's 10 screens, and a placeholder content panel. No screen is implemented yet.

## Backend

Run everything from the repository root, so `backend` resolves as a package
(its modules import each other as `backend.db.db`, `backend.contracts.models`, etc.):

```bash
pip install -r backend/requirements.txt
uvicorn backend.main:app --reload
```

Runs on `http://localhost:8000`. Check `GET /health` and `GET /meta`.

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

## Repository layout

See `ARCHITECTURE.md` Part 3 for the target structure and `CLAUDE.md` §4 for the
16-phase build order this project follows. Each phase is implemented, tested, and
verified before the next one starts.
