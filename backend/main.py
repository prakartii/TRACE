"""TRACE FastAPI application entrypoint.

Phase 1 scaffold: health/metadata endpoints and database initialization
only. Perception, world model, lenses, planner, and every other reasoning
layer are added in their own phase (see CLAUDE.md §4).
"""

from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from backend.db.db import create_database

APP_NAME = "TRACE"
APP_VERSION = "0.1.0"
BUILD_PHASE = "Phase 1 - foundation scaffold"


@asynccontextmanager
async def lifespan(app: FastAPI):
    create_database()
    yield


app = FastAPI(title=APP_NAME, version=APP_VERSION, lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)


@app.get("/health")
def health() -> dict:
    return {"status": "ok"}


@app.get("/meta")
def meta() -> dict:
    return {"name": APP_NAME, "version": APP_VERSION, "phase": BUILD_PHASE}
