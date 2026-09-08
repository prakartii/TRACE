"""Learning / Pattern Memory (Layer 9 — ARCHITECTURE.md §6, CLAUDE.md §20).

Deterministic aggregation over the event store: recurring risky configurations,
behaviour frequency, zone hotspots, near-miss hotspots, a source × scenario
risk-density matrix (the "heat map"), and team / process-level scorecards.

This is aggregation, not autonomous learning — there is no model that adjusts
its own weights here (CLAUDE.md §20). Scorecards are aggregated per source /
process only; there are no individual worker rankings (CLAUDE.md §22).
"""

from __future__ import annotations

import sqlite3
from typing import Optional

_BEHAVIOUR_LENS = "behaviour"
_ENV_LENS = "environmental"

# Deterministic, non-punitive coaching prompts keyed by scenario.
_COACHING = {
    "box_overhang": "Place cartons flush within the supporting footprint before adding the next tier.",
    "pallet_overhang": "Keep the load inside the pallet deck; secure the outer perimeter.",
    "heavy_on_light_stacking": "Confirm SKU mass class — heavy items belong on the base tier.",
    "unsupported_bending_placement": "Ensure at least 75% base contact, or add dunnage / an intermediate board.",
    "wrong_product_orientation": "Check the This-Side-Up marking before placing.",
    "dragging_precursor": "Use a pallet jack or team lift for floor moves instead of dragging.",
    "rolling_precursor": "Keep cartons flat on a pallet; do not roll cargo along the floor.",
    "straps_as_handles": "Grip the carton body, not the packaging strapping.",
    "solo_heavy_handling": "Request a second worker or mechanical aid above the mass threshold.",
    "dropping_or_throwing_precursor": "Set cargo down under control; do not drop or throw.",
    "stepping_on_carton": "Use a step platform — never stand on cargo.",
    "unplanned_loading_sequence": "Follow the manifest loading order.",
    "wrong_equipment_usage": "Use the equipment class the SKU requires (trolley vs. pallet).",
    "entity_in_dock_edge_zone": "Stay clear of the dock edge until the bay door is secured.",
    "entity_in_wet_floor_zone": "Relocate the operation to a dry floor area.",
}

_source_labels: dict[str, str] = {}


def _source_label(video_id: Optional[str]) -> str:
    if not video_id:
        return "unknown source"
    if video_id not in _source_labels:
        label = video_id
        try:
            from backend.api.videos import get_registry

            rec = get_registry().get(video_id)
            if rec is not None:
                label = rec.filename
        except Exception:
            pass
        _source_labels[video_id] = label
    return _source_labels[video_id]


def _rows(conn: sqlite3.Connection, sql: str, params: tuple = ()) -> list[sqlite3.Row]:
    return list(conn.execute(sql, params).fetchall())


# --------------------------------------------------------------------------- #

def recurring_scenarios(conn: sqlite3.Connection, min_count: int = 2) -> list[dict]:
    """Scenarios seen more than once — the configurations worth a coaching note."""
    rows = _rows(
        conn,
        """
        SELECT scenario,
               COUNT(*)                                            AS count,
               SUM(CASE WHEN band IN ('High','Critical') THEN 1 ELSE 0 END) AS high_count,
               ROUND(AVG(score), 1)                                AS avg_score,
               COUNT(DISTINCT video_id)                            AS source_count
        FROM events
        WHERE scenario IS NOT NULL
        GROUP BY scenario
        HAVING COUNT(*) >= ?
        ORDER BY count DESC, high_count DESC
        """,
        (min_count,),
    )
    out = []
    for r in rows:
        srcs = _rows(
            conn,
            "SELECT DISTINCT video_id FROM events WHERE scenario = ? AND video_id IS NOT NULL",
            (r["scenario"],),
        )
        ids = [x["event_id"] for x in _rows(
            conn, "SELECT event_id FROM events WHERE scenario = ? ORDER BY event_id", (r["scenario"],)
        )]
        out.append({
            "scenario": r["scenario"],
            "count": r["count"],
            "high_count": r["high_count"],
            "avg_score": r["avg_score"],
            "source_count": r["source_count"],
            "sources": [_source_label(s["video_id"]) for s in srcs],
            "event_ids": ids,
        })
    return out


def behaviour_frequency(conn: sqlite3.Connection) -> list[dict]:
    return [
        {"scenario": r["scenario"], "count": r["count"]}
        for r in _rows(
            conn,
            "SELECT scenario, COUNT(*) AS count FROM events "
            "WHERE lens = ? AND scenario IS NOT NULL GROUP BY scenario ORDER BY count DESC",
            (_BEHAVIOUR_LENS,),
        )
    ]


def zone_hotspots(conn: sqlite3.Connection) -> list[dict]:
    rows = _rows(
        conn,
        "SELECT video_id, scenario, COUNT(*) AS count FROM events "
        "WHERE lens = ? GROUP BY video_id, scenario ORDER BY count DESC",
        (_ENV_LENS,),
    )
    return [
        {"source": _source_label(r["video_id"]), "video_id": r["video_id"],
         "scenario": r["scenario"], "count": r["count"]}
        for r in rows
    ]


def near_miss_hotspots(conn: sqlite3.Connection) -> list[dict]:
    rows = _rows(
        conn,
        """
        SELECT o.video_id, e.scenario, COUNT(*) AS count
        FROM outcome_measurements o
        LEFT JOIN events e ON e.event_id = o.event_id
        WHERE o.classification = 'near_miss'
        GROUP BY o.video_id, e.scenario
        ORDER BY count DESC
        """,
    )
    return [
        {"source": _source_label(r["video_id"]), "video_id": r["video_id"],
         "scenario": r["scenario"], "count": r["count"]}
        for r in rows
    ]


def training_recommendations(conn: sqlite3.Connection, min_count: int = 2) -> list[dict]:
    recs = []
    for p in recurring_scenarios(conn, min_count=min_count):
        scen = p["scenario"]
        where = (
            f" across {p['source_count']} sources" if p["source_count"] > 1 else ""
        )
        recs.append({
            "scenario": scen,
            "count": p["count"],
            "sources": p["sources"],
            "priority": "high" if p["high_count"] >= 2 else "normal",
            "suggestion": (
                f"{p['count']} {scen.replace('_', ' ')} event(s){where}. "
                f"Coaching focus: {_COACHING.get(scen, 'review the relevant handling procedure with the team.')}"
            ),
        })
    return recs


def source_scenario_heatmap(conn: sqlite3.Connection) -> dict:
    """Risk-density matrix: rows = sources (bays), columns = scenarios, each cell
    a count and a High/Critical sub-count. Grounded entirely in the events table
    — no spatial pixel data is invented (CLAUDE.md §30)."""
    rows = _rows(
        conn,
        """
        SELECT video_id, scenario,
               COUNT(*) AS count,
               SUM(CASE WHEN band IN ('High','Critical') THEN 1 ELSE 0 END) AS high_count
        FROM events
        WHERE scenario IS NOT NULL AND video_id IS NOT NULL
        GROUP BY video_id, scenario
        """,
    )
    sources: dict[str, str] = {}
    scenarios: dict[str, int] = {}
    cells: list[dict] = []
    src_totals: dict[str, int] = {}
    scen_totals: dict[str, int] = {}
    max_count = 0
    for r in rows:
        label = _source_label(r["video_id"])
        sources[r["video_id"]] = label
        scenarios[r["scenario"]] = scenarios.get(r["scenario"], 0) + r["count"]
        scen_totals[r["scenario"]] = scen_totals.get(r["scenario"], 0) + r["count"]
        src_totals[label] = src_totals.get(label, 0) + r["count"]
        max_count = max(max_count, r["count"])
        cells.append({
            "video_id": r["video_id"],
            "source": label,
            "scenario": r["scenario"],
            "count": r["count"],
            "high_count": r["high_count"],
        })
    ordered_scenarios = sorted(scenarios, key=lambda s: scenarios[s], reverse=True)
    ordered_sources = sorted(src_totals, key=lambda s: src_totals[s], reverse=True)
    return {
        "sources": ordered_sources,
        "scenarios": ordered_scenarios,
        "cells": cells,
        "source_totals": src_totals,
        "scenario_totals": scen_totals,
        "max_cell_count": max_count,
        "basis": "events grouped by (source, scenario); intensity = event count, "
                 "High/Critical shown separately. Not a spatial pixel map.",
    }


def process_scorecards(conn: sqlite3.Connection) -> list[dict]:
    """Per-source (team / process) scorecards. CLAUDE.md §22: never per individual."""
    rows = _rows(
        conn,
        """
        SELECT video_id,
               COUNT(*) AS events,
               SUM(CASE WHEN band IN ('High','Critical') THEN 1 ELSE 0 END) AS high_events
        FROM events
        WHERE video_id IS NOT NULL
        GROUP BY video_id
        ORDER BY events DESC
        """,
    )
    cards = []
    for r in rows:
        vid = r["video_id"]
        outc = {
            x["classification"]: x["n"]
            for x in _rows(
                conn,
                "SELECT classification, COUNT(*) AS n FROM outcome_measurements "
                "WHERE video_id = ? GROUP BY classification",
                (vid,),
            )
        }
        top = _rows(
            conn,
            "SELECT scenario, COUNT(*) AS n FROM events WHERE video_id = ? AND scenario IS NOT NULL "
            "GROUP BY scenario ORDER BY n DESC LIMIT 1",
            (vid,),
        )
        cards.append({
            "source": _source_label(vid),
            "video_id": vid,
            "events": r["events"],
            "high_events": r["high_events"],
            "prevented": outc.get("prevented", 0),
            "near_miss": outc.get("near_miss", 0),
            "outcome_unclear": outc.get("outcome_unclear", 0),
            "confirmed_damage": outc.get("confirmed_damage", 0),
            "top_scenario": top[0]["scenario"] if top else None,
        })
    return cards
