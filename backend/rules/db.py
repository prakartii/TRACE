"""Database CRUD layer for TRACE custom rules.

All custom rules are persisted in the existing `custom_rules` SQLite table,
extended with new columns via the migration in db.py.

The condition is stored as JSON — always structured data, never executable code.
"""

from __future__ import annotations

import json
import logging
import sqlite3
import time
from typing import Any, Optional

logger = logging.getLogger("trace.rules.db")


def ensure_custom_rules_columns(conn: sqlite3.Connection) -> None:
    """Adds new columns to custom_rules if they don't exist (safe migration)."""
    cur = conn.cursor()
    existing_cols = {row[1] for row in cur.execute("PRAGMA table_info(custom_rules)")}

    migrations = [
        ("name", "TEXT"),
        ("lens", "TEXT"),
        ("severity_band", "TEXT"),
        ("enabled", "INTEGER DEFAULT 1"),
        ("action_text", "TEXT"),
        ("updated_at", "REAL"),
    ]
    for col_name, col_def in migrations:
        if col_name not in existing_cols:
            cur.execute(f"ALTER TABLE custom_rules ADD COLUMN {col_name} {col_def}")

    conn.commit()


def _row_to_rule(row: sqlite3.Row) -> dict[str, Any]:
    """Converts a sqlite3.Row to a plain dict for API serialization."""
    condition = None
    if row["condition_json"]:
        try:
            condition = json.loads(row["condition_json"])
        except Exception:
            condition = None

    return {
        "rule_id": row["rule_id"],
        "name": row["name"] if "name" in row.keys() else None,
        "description": row["description"],
        "lens": row["lens"] if "lens" in row.keys() else None,
        "severity_band": row["severity_band"] if "severity_band" in row.keys() else None,
        "enabled": bool(row["enabled"]) if "enabled" in row.keys() else True,
        "action_text": row["action_text"] if "action_text" in row.keys() else None,
        "condition": condition,
        "created_by": row["created_by"],
        "created_at": row["created_at"],
        "updated_at": row["updated_at"] if "updated_at" in row.keys() else None,
    }


def list_custom_rules(conn: sqlite3.Connection) -> list[dict[str, Any]]:
    ensure_custom_rules_columns(conn)
    cur = conn.cursor()
    cur.execute("SELECT * FROM custom_rules ORDER BY created_at DESC")
    return [_row_to_rule(row) for row in cur.fetchall()]


def get_custom_rule(conn: sqlite3.Connection, rule_id: int) -> Optional[dict[str, Any]]:
    ensure_custom_rules_columns(conn)
    cur = conn.cursor()
    cur.execute("SELECT * FROM custom_rules WHERE rule_id = ?", (rule_id,))
    row = cur.fetchone()
    return _row_to_rule(row) if row else None


def create_custom_rule(
    conn: sqlite3.Connection,
    *,
    name: str,
    description: str,
    lens: Optional[str],
    severity_band: Optional[str],
    enabled: bool,
    action_text: Optional[str],
    condition: dict[str, Any],
    created_by: str = "operator",
) -> dict[str, Any]:
    ensure_custom_rules_columns(conn)
    now = time.time()
    cur = conn.cursor()
    cur.execute(
        """
        INSERT INTO custom_rules
            (name, description, lens, severity_band, enabled, action_text,
             condition_json, created_by, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            name,
            description,
            lens,
            severity_band,
            1 if enabled else 0,
            action_text,
            json.dumps(condition),
            created_by,
            now,
            now,
        ),
    )
    conn.commit()
    rule_id = cur.lastrowid
    return get_custom_rule(conn, rule_id)


def update_custom_rule(
    conn: sqlite3.Connection,
    rule_id: int,
    *,
    name: Optional[str] = None,
    description: Optional[str] = None,
    lens: Optional[str] = None,
    severity_band: Optional[str] = None,
    enabled: Optional[bool] = None,
    action_text: Optional[str] = None,
    condition: Optional[dict[str, Any]] = None,
) -> Optional[dict[str, Any]]:
    ensure_custom_rules_columns(conn)
    existing = get_custom_rule(conn, rule_id)
    if existing is None:
        return None

    updates: list[str] = []
    params: list[Any] = []

    if name is not None:
        updates.append("name = ?")
        params.append(name)
    if description is not None:
        updates.append("description = ?")
        params.append(description)
    if lens is not None:
        updates.append("lens = ?")
        params.append(lens)
    if severity_band is not None:
        updates.append("severity_band = ?")
        params.append(severity_band)
    if enabled is not None:
        updates.append("enabled = ?")
        params.append(1 if enabled else 0)
    if action_text is not None:
        updates.append("action_text = ?")
        params.append(action_text)
    if condition is not None:
        updates.append("condition_json = ?")
        params.append(json.dumps(condition))

    if not updates:
        return existing

    updates.append("updated_at = ?")
    params.append(time.time())
    params.append(rule_id)

    conn.cursor().execute(
        f"UPDATE custom_rules SET {', '.join(updates)} WHERE rule_id = ?",
        params,
    )
    conn.commit()
    return get_custom_rule(conn, rule_id)


def delete_custom_rule(conn: sqlite3.Connection, rule_id: int) -> bool:
    ensure_custom_rules_columns(conn)
    cur = conn.cursor()
    cur.execute("DELETE FROM custom_rules WHERE rule_id = ?", (rule_id,))
    conn.commit()
    return cur.rowcount > 0


def seed_default_rule(conn: sqlite3.Connection) -> None:
    """Seeds one default custom rule if no rules exist yet.

    This satisfies the GEG MUST BUILD requirement for 'one custom rule'.
    The rule uses real TRACE event fields and is immediately evaluable.

    Rule: High-score Behaviour events (score >= 70) warrant immediate
    supervisor review — grounded in actual behaviour events in trace.db.
    """
    ensure_custom_rules_columns(conn)
    count = conn.execute("SELECT COUNT(*) FROM custom_rules").fetchone()[0]
    if count > 0:
        return  # Default already seeded or user has added their own

    create_custom_rule(
        conn,
        name="High-Risk Behaviour Escalation",
        description=(
            "Flag any Behaviour lens event with a risk score of 70 or higher for "
            "immediate supervisor review. Grounded in observed kinematics — e.g., "
            "detected throwing/dropping precursors, straps-as-handles, or solo heavy "
            "handling — where the score threshold indicates elevated physical risk."
        ),
        lens="behaviour",
        severity_band="High",
        enabled=True,
        action_text=(
            "Immediate supervisor review required. Halt operation if worker is at risk. "
            "Review Incident Replay footage before resuming handling."
        ),
        condition={
            "logic": "AND",
            "conditions": [
                {"field": "lens", "operator": "==", "value": "behaviour"},
                {"field": "score", "operator": ">=", "value": 70},
            ],
        },
        created_by="system_default",
    )
