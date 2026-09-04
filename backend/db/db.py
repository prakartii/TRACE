"""Plain sqlite3 access layer for TRACE. No ORM by design (CLAUDE.md §27)."""

from __future__ import annotations

import sqlite3
from pathlib import Path

SCHEMA_PATH = Path(__file__).parent / "schema.sql"
DEFAULT_DB_PATH = Path(__file__).parent / "trace.db"


def get_connection(db_path: str | Path = DEFAULT_DB_PATH) -> sqlite3.Connection:
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def init_db(conn: sqlite3.Connection, schema_path: str | Path = SCHEMA_PATH) -> None:
    conn.executescript(Path(schema_path).read_text())
    conn.commit()


def create_database(db_path: str | Path = DEFAULT_DB_PATH) -> sqlite3.Connection:
    conn = get_connection(db_path)
    init_db(conn)
    return conn
