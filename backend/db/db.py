"""Plain sqlite3 access layer for TRACE. No ORM by design (CLAUDE.md §27)."""

from __future__ import annotations

import logging
import os
import sqlite3
from pathlib import Path

SCHEMA_PATH = Path(__file__).parent / "schema.sql"
DEFAULT_DB_PATH = Path(__file__).parent / "trace.db"

# Env var so the database location can be redirected without editing code.
# The test suite sets it to a temp file: several suites build a TestClient
# without overriding get_db, and were writing into the real demo database —
# adding events and interventions, and in one case deleting seeded events.
DB_PATH_ENV_VAR = "TRACE_DB_PATH"


def default_db_path() -> Path:
    """Resolved per call, not bound at import, so the env var is always honoured."""
    override = os.environ.get(DB_PATH_ENV_VAR)
    return Path(override) if override else DEFAULT_DB_PATH


def get_connection(db_path: str | Path | None = None) -> sqlite3.Connection:
    db_path = default_db_path() if db_path is None else db_path
    conn = sqlite3.connect(db_path, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def ensure_schema_migrations(conn: sqlite3.Connection) -> None:
    """Ensures existing databases have newly added columns and indexes."""
    cur = conn.cursor()
    tables = {r[0] for r in cur.execute("SELECT name FROM sqlite_master WHERE type='table'")}
    if "events" in tables:
        cols = {row["name"] if isinstance(row, sqlite3.Row) else row[1] for row in cur.execute("PRAGMA table_info(events)")}
        for col_name, col_type in [
            ("video_id", "TEXT"),
            ("status", "TEXT"),
            ("scenario", "TEXT"),
            ("dedup_key", "TEXT"),
            ("epistemic_level", "TEXT"),
        ]:
            if col_name not in cols:
                cur.execute(f"ALTER TABLE events ADD COLUMN {col_name} {col_type}")

        cur.execute("CREATE UNIQUE INDEX IF NOT EXISTS idx_events_dedup ON events(dedup_key)")
        cur.execute("CREATE INDEX IF NOT EXISTS idx_events_video_time ON events(video_id, timestamp)")
        cur.execute("CREATE INDEX IF NOT EXISTS idx_events_lens ON events(lens)")
        cur.execute("CREATE INDEX IF NOT EXISTS idx_events_status ON events(status)")
        cur.execute("CREATE INDEX IF NOT EXISTS idx_events_band ON events(band)")

    if "planner_recommendations" in tables:
        rec_cols = {row["name"] if isinstance(row, sqlite3.Row) else row[1] for row in cur.execute("PRAGMA table_info(planner_recommendations)")}
        if "recommendation_json" not in rec_cols:
            cur.execute("ALTER TABLE planner_recommendations ADD COLUMN recommendation_json TEXT")

    if "outcome_measurements" not in tables:
        cur.execute(
            """
            CREATE TABLE IF NOT EXISTS outcome_measurements (
                outcome_id INTEGER PRIMARY KEY AUTOINCREMENT,
                event_id INTEGER NOT NULL REFERENCES events(event_id),
                video_id TEXT,
                initial_timestamp REAL NOT NULL,
                outcome_timestamp REAL,
                response_window_sec REAL DEFAULT 5.0,
                classification TEXT NOT NULL,
                condition_1_satisfied INTEGER NOT NULL,
                condition_2_satisfied INTEGER NOT NULL,
                condition_3_satisfied INTEGER NOT NULL,
                three_condition_json TEXT NOT NULL,
                initial_score REAL,
                outcome_score REAL,
                initial_band TEXT,
                outcome_band TEXT,
                followed_recommendation INTEGER,
                human_review_status TEXT,
                explanation TEXT,
                evidence_json TEXT,
                limitations_json TEXT,
                evaluated_at REAL NOT NULL,
                dedup_key TEXT UNIQUE
            )
            """
        )
    cur.execute("CREATE INDEX IF NOT EXISTS idx_outcomes_event ON outcome_measurements(event_id)")
    cur.execute("CREATE INDEX IF NOT EXISTS idx_outcomes_class ON outcome_measurements(classification)")
    cur.execute("CREATE INDEX IF NOT EXISTS idx_outcomes_video ON outcome_measurements(video_id)")

    if "interventions" not in tables:
        cur.execute(
            """
            CREATE TABLE IF NOT EXISTS interventions (
                alert_id TEXT PRIMARY KEY,
                event_id INTEGER NOT NULL REFERENCES events(event_id),
                video_id TEXT NOT NULL,
                timestamp REAL NOT NULL,
                scenario TEXT NOT NULL,
                lens TEXT,
                severity TEXT NOT NULL,
                urgency TEXT NOT NULL,
                state TEXT NOT NULL,
                title TEXT NOT NULL,
                immediate_action TEXT NOT NULL,
                secondary_actions_json TEXT NOT NULL,
                steps_json TEXT NOT NULL,
                verification TEXT NOT NULL,
                reason TEXT NOT NULL,
                score REAL,
                band TEXT,
                evidence_status TEXT,
                evidence_summary TEXT,
                entity_id TEXT,
                supporting_event_ids_json TEXT NOT NULL,
                occurrence_count INTEGER DEFAULT 1,
                dedup_key TEXT UNIQUE NOT NULL,
                acknowledged_at REAL,
                acknowledged_by TEXT,
                action_in_progress_at REAL,
                verified_at REAL,
                verified_by TEXT,
                resolved_at REAL,
                resolution_notes TEXT,
                outcome_id INTEGER REFERENCES outcome_measurements(outcome_id),
                outcome_classification TEXT,
                safe_plan_json TEXT,
                created_at REAL NOT NULL,
                updated_at REAL NOT NULL
            )
            """
        )
    cur.execute("CREATE INDEX IF NOT EXISTS idx_interventions_state ON interventions(state)")
    cur.execute("CREATE INDEX IF NOT EXISTS idx_interventions_video ON interventions(video_id)")
    cur.execute("CREATE INDEX IF NOT EXISTS idx_interventions_event ON interventions(event_id)")
    cur.execute("CREATE INDEX IF NOT EXISTS idx_interventions_dedup ON interventions(dedup_key)")

    conn.commit()



def init_db(conn: sqlite3.Connection, schema_path: str | Path = SCHEMA_PATH) -> None:
    conn.executescript(Path(schema_path).read_text())
    ensure_schema_migrations(conn)
    conn.commit()


def create_database(db_path: str | Path | None = None) -> sqlite3.Connection:
    db_path = default_db_path() if db_path is None else db_path
    conn = get_connection(db_path)
    init_db(conn)
    if Path(db_path).resolve() == Path(default_db_path()).resolve():
        try:
            from backend.db.canonical_seed import sync_canonical_events
            sync_canonical_events(conn)
        except Exception as exc:
            logging.getLogger("trace.db").warning("Canonical seed sync skipped: %s", exc)
    return conn


def get_db(db_path: str | Path | None = None):
    conn = get_connection(db_path)
    try:
        yield conn
    finally:
        conn.close()
