"""Responsible-AI governance surface (ARCHITECTURE.md Screen 8 / §15, CLAUDE.md §22).

Read-only status snapshot + a real, operator-controlled retention policy with an
honest purge (dry-run by default). The purge targets only transient runtime
records — false-positive flags, session ratings, and *resolved* intervention
alerts — that carry a real wall-clock timestamp. Events and verified prevention
outcomes are never purged, so the demo's headline numbers cannot be erased.

Human review (confirmed-damage / false-positive) and the one-click FP flag are
already served by ``POST /api/events/{id}/review`` and ``GET /api/events`` — this
router does not duplicate them, it only reports their aggregate state.
"""

from __future__ import annotations

import sqlite3
import time

from fastapi import APIRouter, Depends, Query

from backend.assistant.llm import DEFAULT_MODEL, is_available as llm_available
from backend.contracts.models import RetentionPolicyUpdate
from backend.db.app_settings import get_setting, set_setting
from backend.db.db import get_db
from backend.perception.config import DEFAULT_CONFIG
from backend.planner.stability import STABILITY_DISCLAIMER

router = APIRouter(prefix="/api/responsible-ai", tags=["responsible_ai"])

_RETENTION_KEY = "retention_policy"
_LAST_PURGE_KEY = "retention_last_purge"
_DEFAULT_RETENTION = {"window_days": 30, "auto_purge": False}

# Transient runtime records that may be aged out: (table, timestamp column,
# optional extra predicate). Events and outcome_measurements are deliberately
# absent — they are the demo backbone and carry the headline metrics.
# Interventions are only purged once terminal (resolved / dismissed).
_PURGE_TARGETS = [
    ("feedback", "created_at", None),
    ("session_ratings", "created_at", None),
    ("interventions", "created_at", "state IN ('RESOLVED', 'FALSE_POSITIVE')"),
]

TRANSPARENCY_NOTICE = (
    "TRACE observes cargo geometry and worker motion to flag operational risk and "
    "suggest safer placements. It records short video context for incident review. "
    "Personnel faces are obscured by default and the structural, conformance and "
    "environmental analyses never use worker identity."
)
WORKER_INDEPENDENT_NOTICE = (
    "Structural, conformance and environmental risk are computed from image-space "
    "geometry and SKU metadata alone — this is an architectural property, not a policy "
    "toggle. Scorecards aggregate at team / process level; there are no individual "
    "worker rankings."
)
NON_PUNITIVE_NOTICE = (
    "Findings are framed as coaching and process insight. A flag is a prompt to check "
    "a placement, not a judgement of a person."
)


def _retention(conn: sqlite3.Connection) -> dict:
    pol = {**_DEFAULT_RETENTION, **(get_setting(conn, _RETENTION_KEY, {}) or {})}
    pol["window_days"] = max(1, int(pol.get("window_days", 30)))
    pol["auto_purge"] = bool(pol.get("auto_purge", False))
    pol["last_purge"] = get_setting(conn, _LAST_PURGE_KEY, None)
    return pol


def run_purge(conn: sqlite3.Connection, window_days: int, *, dry_run: bool = True) -> dict:
    """Count (and, unless dry_run, delete) transient rows older than the window.

    Only rows whose timestamp is a real positive epoch value are eligible, so
    seeded demo data (timestamp 0) is never removed; events and prevention
    outcomes are not targeted at all.
    """
    cutoff = time.time() - max(1, int(window_days)) * 86400.0
    by_table: dict[str, int] = {}
    for table, col, extra in _PURGE_TARGETS:
        where = f"{col} > 0 AND {col} < ?" + (f" AND ({extra})" if extra else "")
        try:
            n = conn.execute(f"SELECT COUNT(*) FROM {table} WHERE {where}", (cutoff,)).fetchone()[0]
        except sqlite3.OperationalError:
            continue  # table not present in this database
        by_table[table] = n
        if not dry_run and n:
            conn.execute(f"DELETE FROM {table} WHERE {where}", (cutoff,))
    total = sum(by_table.values())
    result = {
        "dry_run": dry_run,
        "window_days": int(window_days),
        "cutoff_epoch": round(cutoff, 3),
        "by_table": by_table,
        "total": total,
    }
    if not dry_run:
        conn.commit()
        result["at"] = time.time()
        set_setting(conn, _LAST_PURGE_KEY, {"at": result["at"], "deleted": by_table, "total": total})
    return result


def run_auto_purge_if_enabled(conn: sqlite3.Connection) -> dict | None:
    """Called from app startup. Runs a real purge when the operator has enabled
    auto-purge; otherwise a no-op."""
    pol = _retention(conn)
    if not pol["auto_purge"]:
        return None
    return run_purge(conn, pol["window_days"], dry_run=False)


@router.get("/status")
def status(db: sqlite3.Connection = Depends(get_db)) -> dict:
    def group(sql: str) -> dict:
        return {(r[0] or "unspecified"): r[1] for r in db.execute(sql).fetchall()}

    red = DEFAULT_CONFIG.redaction
    confirmed = db.execute(
        "SELECT COUNT(*) FROM events WHERE review_status = 'confirmed_damage'"
    ).fetchone()[0]
    false_pos = db.execute(
        "SELECT COUNT(*) FROM events WHERE review_status = 'false_positive'"
    ).fetchone()[0]
    needs_review = db.execute(
        "SELECT COUNT(*) FROM events WHERE band IN ('High','Critical') AND COALESCE(reviewed,0) = 0 "
        "AND (confidence = 'Low' OR status IN ('probable','insufficient_evidence'))"
    ).fetchone()[0]

    return {
        "face_redaction": {
            "enabled": red.enabled,
            "method": red.method,
            "applies_to": "still-frame endpoint (server-side) + live-view / replay overlay",
            "response_header": "X-TRACE-Redaction: faces-blurred | no-faces-detected | disabled",
            "note": "The still-frame endpoint blurs server-side and fails closed if perception "
                    "is unavailable. The streamed MP4 is not transcoded; the live view and "
                    "incident replay redact at the presentation layer and fall back to a "
                    "full-frame blur when person detections are unavailable. Disabling is a "
                    "supervisor action (no auth layer yet).",
        },
        "human_review": {
            "confirmed_damage": confirmed,
            "false_positive": false_pos,
            "high_risk_awaiting_review": needs_review,
            "note": "'Confirmed damage' is only ever set by a human clicking review on an event; "
                    "TRACE never self-confirms.",
        },
        "confidence_distribution": group("SELECT confidence, COUNT(*) FROM events GROUP BY confidence"),
        "epistemic_distribution": group("SELECT status, COUNT(*) FROM events GROUP BY status"),
        "retention": _retention(db),
        "assistant": {
            "grounded": True,
            "llm_available": llm_available(),
            "model": DEFAULT_MODEL if llm_available() else None,
            "note": "Answers are retrieved from the event store; the language model, when "
                    "configured, only rephrases retrieved rows.",
        },
        "disclosures": {
            "stability": STABILITY_DISCLAIMER,
            "transparency_notice": TRANSPARENCY_NOTICE,
            "worker_independent": WORKER_INDEPENDENT_NOTICE,
            "non_punitive": NON_PUNITIVE_NOTICE,
        },
    }


@router.get("/retention")
def get_retention(db: sqlite3.Connection = Depends(get_db)) -> dict:
    return _retention(db)


@router.put("/retention")
def put_retention(
    payload: RetentionPolicyUpdate,
    db: sqlite3.Connection = Depends(get_db),
) -> dict:
    current = _retention(db)
    window = current["window_days"] if payload.window_days is None else int(payload.window_days)
    window = max(1, min(window, 3650))
    auto = current["auto_purge"] if payload.auto_purge is None else bool(payload.auto_purge)
    set_setting(db, _RETENTION_KEY, {"window_days": window, "auto_purge": auto})
    return _retention(db)


@router.post("/retention/purge")
def purge(
    confirm: bool = Query(False, description="Without confirm=true this is a dry run and deletes nothing."),
    db: sqlite3.Connection = Depends(get_db),
) -> dict:
    return run_purge(db, _retention(db)["window_days"], dry_run=not confirm)
