"""Tiny key/value store for operator-configurable app settings.

Currently only the Responsible-AI retention policy lives here. Values are JSON
strings so a setting can be a scalar or a small object.
"""

from __future__ import annotations

import json
import sqlite3
from typing import Any

_CREATE = """
CREATE TABLE IF NOT EXISTS app_settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at REAL NOT NULL
)
"""


def ensure_table(conn: sqlite3.Connection) -> None:
    conn.execute(_CREATE)
    conn.commit()


def get_setting(conn: sqlite3.Connection, key: str, default: Any = None) -> Any:
    ensure_table(conn)
    row = conn.execute("SELECT value FROM app_settings WHERE key = ?", (key,)).fetchone()
    if row is None:
        return default
    try:
        return json.loads(row[0] if not isinstance(row, sqlite3.Row) else row["value"])
    except (ValueError, TypeError):
        return default


def set_setting(conn: sqlite3.Connection, key: str, value: Any) -> None:
    import time

    ensure_table(conn)
    conn.execute(
        "INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, ?) "
        "ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
        (key, json.dumps(value), time.time()),
    )
    conn.commit()
