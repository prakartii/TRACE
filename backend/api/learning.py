"""REST endpoints for Learning / Pattern Memory (Layer 9 — ARCHITECTURE.md §6).

- GET /api/learning/patterns    : recurring scenarios, behaviour frequency,
                                  zone + near-miss hotspots, training prompts
- GET /api/learning/heatmap     : source x scenario risk-density matrix
- GET /api/learning/scorecards  : team / process-level scorecards

All figures are deterministic aggregations of the event store. No autonomous
learning, no individual worker rankings.
"""

from __future__ import annotations

import sqlite3

from fastapi import APIRouter, Depends, Query

from backend.db.db import get_db
from backend.learning import patterns as p

router = APIRouter(prefix="/api/learning", tags=["learning"])


@router.get("/patterns")
def get_patterns(
    min_count: int = Query(2, ge=1, le=50),
    db: sqlite3.Connection = Depends(get_db),
) -> dict:
    return {
        "recurring_scenarios": p.recurring_scenarios(db, min_count=min_count),
        "behaviour_frequency": p.behaviour_frequency(db),
        "zone_hotspots": p.zone_hotspots(db),
        "near_miss_hotspots": p.near_miss_hotspots(db),
        "training_recommendations": p.training_recommendations(db, min_count=min_count),
        "note": "Aggregated from the event store. Recurring = seen at least "
                f"{min_count} times.",
    }


@router.get("/heatmap")
def get_heatmap(db: sqlite3.Connection = Depends(get_db)) -> dict:
    return p.source_scenario_heatmap(db)


@router.get("/scorecards")
def get_scorecards(db: sqlite3.Connection = Depends(get_db)) -> dict:
    return {
        "scorecards": p.process_scorecards(db),
        "note": "Aggregated per camera source / process — never per individual worker "
                "(CLAUDE.md §22).",
    }
