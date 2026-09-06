"""Plain sqlite3 access layer for TRACE. No ORM by design (CLAUDE.md §27)."""

from __future__ import annotations

import sqlite3
from pathlib import Path

SCHEMA_PATH = Path(__file__).parent / "schema.sql"
DEFAULT_DB_PATH = Path(__file__).parent / "trace.db"


def get_connection(db_path: str | Path = DEFAULT_DB_PATH) -> sqlite3.Connection:
    conn = sqlite3.connect(db_path, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def ensure_schema_migrations(conn: sqlite3.Connection) -> None:
    """Ensures existing databases have newly added columns and indexes."""
    cur = conn.cursor()
    tables = {r[0] for r in cur.execute("SELECT name FROM sqlite_master WHERE type='table'")}
    if "events" in tables:
        cols = {row["name"] for row in cur.execute("PRAGMA table_info(events)")}
        for col_name, col_type in [
            ("video_id", "TEXT"),
            ("status", "TEXT"),
            ("scenario", "TEXT"),
            ("dedup_key", "TEXT"),
        ]:
            if col_name not in cols:
                cur.execute(f"ALTER TABLE events ADD COLUMN {col_name} {col_type}")

        cur.execute("CREATE UNIQUE INDEX IF NOT EXISTS idx_events_dedup ON events(dedup_key)")
        cur.execute("CREATE INDEX IF NOT EXISTS idx_events_video_time ON events(video_id, timestamp)")
        cur.execute("CREATE INDEX IF NOT EXISTS idx_events_lens ON events(lens)")
        cur.execute("CREATE INDEX IF NOT EXISTS idx_events_status ON events(status)")
        cur.execute("CREATE INDEX IF NOT EXISTS idx_events_band ON events(band)")

    if "planner_recommendations" in tables:
        rec_cols = {row["name"] for row in cur.execute("PRAGMA table_info(planner_recommendations)")}
        if "recommendation_json" not in rec_cols:
            cur.execute("ALTER TABLE planner_recommendations ADD COLUMN recommendation_json TEXT")

    conn.commit()


def init_db(conn: sqlite3.Connection, schema_path: str | Path = SCHEMA_PATH) -> None:
    conn.executescript(Path(schema_path).read_text())
    ensure_schema_migrations(conn)
    conn.commit()


def create_database(db_path: str | Path = DEFAULT_DB_PATH) -> sqlite3.Connection:
    conn = get_connection(db_path)
    init_db(conn)
    return conn


def get_db(db_path: str | Path = DEFAULT_DB_PATH):
    conn = get_connection(db_path)
    try:
        yield conn
    finally:
        conn.close()
