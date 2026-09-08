"""TRACE FastAPI application entrypoint.

Phase 4 (+ perception-strengthening remediation): health/metadata
endpoints, database initialization, the video registry/ingestion API,
the perception (detection + tracking) API — now with an explicit,
opt-in pilot model adding box/pallet alongside the stock person-only
model, see training/README.md — and the world model / scene graph API.
Risk lenses, predictive risk, the planner, and every later reasoning
layer are added in their own phase (see CLAUDE.md §4).
"""

from contextlib import asynccontextmanager
import logging

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from backend.api.assistant import router as assistant_router
from backend.api.behaviour import router as behaviour_router
from backend.api.actions import router as actions_router
from backend.api.events import router as events_router
from backend.api.findings import router as findings_router
from backend.api.perception import router as perception_router
from backend.api.measurement import router as measurement_router
from backend.api.planner_whatif import canonical_router as canonical_whatif_router
from backend.api.planner_whatif import router as planner_whatif_router
from backend.api.intervention import live_ws_router as intervention_ws_router
from backend.api.intervention import router as intervention_router
from backend.api.learning import router as learning_router
from backend.api.responsible_ai import router as responsible_ai_router
from backend.api.rules import router as rules_router
from backend.api.scene import router as scene_router
from backend.api.simulation import router as simulation_router
from backend.api.supervisor import router as supervisor_router
from backend.api.temporal import router as temporal_router
from backend.api.videos import router as videos_router
from backend.db.db import create_database

APP_NAME = "TRACE"
APP_VERSION = "0.10.0"
BUILD_PHASE = "Phase 12 - Behaviour Recognition & Real-Time Intervention"



@asynccontextmanager
async def lifespan(app: FastAPI):
    conn = create_database()
    try:
        from backend.rules.db import seed_default_rule
        seed_default_rule(conn)
    except Exception as exc:
        logging.getLogger("trace.rules").warning("Rules seed skipped: %s", exc)
    try:
        from backend.api.responsible_ai import run_auto_purge_if_enabled

        result = run_auto_purge_if_enabled(conn)
        if result and result.get("total"):
            logging.getLogger("trace.retention").info(
                "Retention auto-purge removed %s aged record(s): %s", result["total"], result["by_table"]
            )
    except Exception as exc:
        logging.getLogger("trace.retention").warning("Retention auto-purge skipped: %s", exc)
    finally:
        conn.close()
    yield


app = FastAPI(title=APP_NAME, version=APP_VERSION, lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_methods=["GET", "POST", "PUT", "DELETE"],
    allow_headers=["*"],
)

app.include_router(videos_router)
app.include_router(perception_router)
app.include_router(scene_router)
app.include_router(findings_router)
app.include_router(events_router)
app.include_router(actions_router)
app.include_router(simulation_router)
app.include_router(planner_whatif_router)
app.include_router(canonical_whatif_router)
app.include_router(supervisor_router)
app.include_router(measurement_router)
app.include_router(behaviour_router)
app.include_router(rules_router)
app.include_router(temporal_router)
app.include_router(intervention_router)
app.include_router(intervention_ws_router)
app.include_router(assistant_router)
app.include_router(responsible_ai_router)
app.include_router(learning_router)



@app.get("/health")
def health() -> dict:
    return {"status": "ok"}


@app.get("/meta")
def meta() -> dict:
    return {"name": APP_NAME, "version": APP_VERSION, "phase": BUILD_PHASE}
