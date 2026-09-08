"""Database persistence and retrieval for TRACE Intervention Alerts.

Supports persistence, indexing, deduplication, state transitions, and querying
of operational InterventionAlert records in SQLite.
"""

from __future__ import annotations

import json
import logging
import sqlite3
import time
from typing import Any, Optional

from backend.contracts.models import (
    AlertSeverity,
    AlertState,
    AlertUrgency,
    InterventionAlert,
    SafeActionPlan,
)
from backend.db.db import ensure_schema_migrations, get_connection

logger = logging.getLogger("trace.interventions")


def row_to_intervention_alert(row: sqlite3.Row | dict[str, Any]) -> InterventionAlert:
    """Converts a SQLite row or dictionary into a validated InterventionAlert model."""
    secondary_actions = []
    if row["secondary_actions_json"]:
        try:
            secondary_actions = json.loads(row["secondary_actions_json"])
        except Exception:
            secondary_actions = []

    steps = []
    if row["steps_json"]:
        try:
            steps = json.loads(row["steps_json"])
        except Exception:
            steps = []

    supporting_event_ids = []
    if row["supporting_event_ids_json"]:
        try:
            supporting_event_ids = json.loads(row["supporting_event_ids_json"])
        except Exception:
            supporting_event_ids = []

    safe_plan = None
    if "safe_plan_json" in row.keys() and row["safe_plan_json"]:
        try:
            safe_plan = SafeActionPlan.model_validate_json(row["safe_plan_json"])
        except Exception:
            safe_plan = None

    return InterventionAlert(
        alert_id=row["alert_id"],
        event_id=row["event_id"],
        video_id=row["video_id"],
        timestamp=row["timestamp"],
        scenario=row["scenario"],
        lens=row["lens"] or "structural",
        severity=AlertSeverity(row["severity"]),
        urgency=AlertUrgency(row["urgency"]),
        state=AlertState(row["state"]),
        title=row["title"],
        immediate_action=row["immediate_action"],
        secondary_actions=secondary_actions,
        steps=steps,
        verification=row["verification"],
        reason=row["reason"],
        score=row["score"],
        band=row["band"] or "Medium",
        evidence_status=row["evidence_status"] or "Seen in video",
        evidence_summary=row["evidence_summary"],
        entity_id=row["entity_id"],
        supporting_event_ids=supporting_event_ids,
        occurrence_count=row["occurrence_count"] or 1,
        dedup_key=row["dedup_key"],
        acknowledged_at=row["acknowledged_at"],
        acknowledged_by=row["acknowledged_by"],
        action_in_progress_at=row["action_in_progress_at"],
        verified_at=row["verified_at"],
        verified_by=row["verified_by"],
        resolved_at=row["resolved_at"],
        resolution_notes=row["resolution_notes"],
        outcome_id=row["outcome_id"],
        outcome_classification=row["outcome_classification"],
        safe_plan=safe_plan,
        created_at=row["created_at"],
        updated_at=row["updated_at"],
    )


def save_intervention(
    alert: InterventionAlert,
    conn: Optional[sqlite3.Connection] = None,
) -> InterventionAlert:
    """Saves or updates an InterventionAlert in SQLite."""
    should_close = False
    if conn is None:
        conn = get_connection()
        should_close = True

    try:
        ensure_schema_migrations(conn)
        cur = conn.cursor()

        sec_json = json.dumps(alert.secondary_actions)
        steps_json = json.dumps(alert.steps)
        support_json = json.dumps(alert.supporting_event_ids)
        safe_plan_json = alert.safe_plan.model_dump_json() if alert.safe_plan else None

        cur.execute(
            """
            INSERT INTO interventions (
                alert_id, event_id, video_id, timestamp, scenario, lens,
                severity, urgency, state, title, immediate_action,
                secondary_actions_json, steps_json, verification, reason,
                score, band, evidence_status, evidence_summary, entity_id,
                supporting_event_ids_json, occurrence_count, dedup_key,
                acknowledged_at, acknowledged_by, action_in_progress_at,
                verified_at, verified_by, resolved_at, resolution_notes,
                outcome_id, outcome_classification, safe_plan_json,
                created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(dedup_key) DO UPDATE SET
                event_id=excluded.event_id,
                timestamp=excluded.timestamp,
                severity=excluded.severity,
                urgency=excluded.urgency,
                state=excluded.state,
                title=excluded.title,
                immediate_action=excluded.immediate_action,
                secondary_actions_json=excluded.secondary_actions_json,
                steps_json=excluded.steps_json,
                verification=excluded.verification,
                reason=excluded.reason,
                score=excluded.score,
                band=excluded.band,
                evidence_status=excluded.evidence_status,
                evidence_summary=excluded.evidence_summary,
                entity_id=excluded.entity_id,
                supporting_event_ids_json=excluded.supporting_event_ids_json,
                occurrence_count=excluded.occurrence_count,
                acknowledged_at=excluded.acknowledged_at,
                acknowledged_by=excluded.acknowledged_by,
                action_in_progress_at=excluded.action_in_progress_at,
                verified_at=excluded.verified_at,
                verified_by=excluded.verified_by,
                resolved_at=excluded.resolved_at,
                resolution_notes=excluded.resolution_notes,
                outcome_id=excluded.outcome_id,
                outcome_classification=excluded.outcome_classification,
                safe_plan_json=excluded.safe_plan_json,
                updated_at=excluded.updated_at
            """,
            (
                alert.alert_id,
                alert.event_id,
                alert.video_id,
                alert.timestamp,
                alert.scenario,
                alert.lens,
                alert.severity.value,
                alert.urgency.value,
                alert.state.value,
                alert.title,
                alert.immediate_action,
                sec_json,
                steps_json,
                alert.verification,
                alert.reason,
                alert.score,
                alert.band,
                alert.evidence_status,
                alert.evidence_summary,
                alert.entity_id,
                support_json,
                alert.occurrence_count,
                alert.dedup_key,
                alert.acknowledged_at,
                alert.acknowledged_by,
                alert.action_in_progress_at,
                alert.verified_at,
                alert.verified_by,
                alert.resolved_at,
                alert.resolution_notes,
                alert.outcome_id,
                alert.outcome_classification,
                safe_plan_json,
                alert.created_at,
                alert.updated_at,
            ),
        )
        conn.commit()
        return alert
    finally:
        if should_close:
            conn.close()


def get_intervention_by_id(
    alert_id: str,
    conn: Optional[sqlite3.Connection] = None,
) -> Optional[InterventionAlert]:
    """Fetches an intervention alert by its unique alert_id."""
    should_close = False
    if conn is None:
        conn = get_connection()
        should_close = True

    try:
        cur = conn.cursor()
        cur.execute("SELECT * FROM interventions WHERE alert_id = ?", (alert_id,))
        row = cur.fetchone()
        if not row:
            return None
        return row_to_intervention_alert(row)
    finally:
        if should_close:
            conn.close()


def get_intervention_by_dedup_key(
    dedup_key: str,
    conn: Optional[sqlite3.Connection] = None,
) -> Optional[InterventionAlert]:
    """Fetches an intervention alert by its deduplication key."""
    should_close = False
    if conn is None:
        conn = get_connection()
        should_close = True

    try:
        cur = conn.cursor()
        cur.execute("SELECT * FROM interventions WHERE dedup_key = ?", (dedup_key,))
        row = cur.fetchone()
        if not row:
            return None
        return row_to_intervention_alert(row)
    finally:
        if should_close:
            conn.close()


def get_intervention_by_event_id(
    event_id: int,
    conn: Optional[sqlite3.Connection] = None,
) -> Optional[InterventionAlert]:
    """Fetches an intervention alert associated with a specific root event ID."""
    should_close = False
    if conn is None:
        conn = get_connection()
        should_close = True

    try:
        cur = conn.cursor()
        cur.execute("SELECT * FROM interventions WHERE event_id = ?", (event_id,))
        row = cur.fetchone()
        if not row:
            return None
        return row_to_intervention_alert(row)
    finally:
        if should_close:
            conn.close()


def get_active_interventions(
    conn: Optional[sqlite3.Connection] = None,
    video_id: Optional[str] = None,
) -> list[InterventionAlert]:
    """Returns all active interventions (NEW, ACKNOWLEDGED, ACTION_IN_PROGRESS, VERIFICATION_REQUIRED)."""
    should_close = False
    if conn is None:
        conn = get_connection()
        should_close = True

    try:
        cur = conn.cursor()
        active_states = (
            AlertState.NEW.value,
            AlertState.ACKNOWLEDGED.value,
            AlertState.ACTION_IN_PROGRESS.value,
            AlertState.VERIFICATION_REQUIRED.value,
        )
        placeholders = ",".join("?" for _ in active_states)

        if video_id:
            cur.execute(
                f"""
                SELECT * FROM interventions
                WHERE state IN ({placeholders}) AND video_id = ?
                ORDER BY
                    CASE severity
                        WHEN 'CRITICAL' THEN 1
                        WHEN 'HIGH' THEN 2
                        WHEN 'MEDIUM' THEN 3
                        ELSE 4
                    END,
                    timestamp DESC
                """,
                (*active_states, video_id),
            )
        else:
            cur.execute(
                f"""
                SELECT * FROM interventions
                WHERE state IN ({placeholders})
                ORDER BY
                    CASE severity
                        WHEN 'CRITICAL' THEN 1
                        WHEN 'HIGH' THEN 2
                        WHEN 'MEDIUM' THEN 3
                        ELSE 4
                    END,
                    timestamp DESC
                """,
                active_states,
            )
        rows = cur.fetchall()
        return [row_to_intervention_alert(r) for r in rows]
    finally:
        if should_close:
            conn.close()


def list_interventions(
    conn: Optional[sqlite3.Connection] = None,
    video_id: Optional[str] = None,
    state: Optional[str] = None,
    limit: int = 50,
    offset: int = 0,
) -> list[InterventionAlert]:
    """Lists intervention alerts with filtering and pagination."""
    should_close = False
    if conn is None:
        conn = get_connection()
        should_close = True

    try:
        cur = conn.cursor()
        clauses = []
        params: list[Any] = []

        if video_id:
            clauses.append("video_id = ?")
            params.append(video_id)

        if state:
            clauses.append("state = ?")
            params.append(state)

        where_str = f"WHERE {' AND '.join(clauses)}" if clauses else ""
        query = f"""
            SELECT * FROM interventions
            {where_str}
            ORDER BY updated_at DESC
            LIMIT ? OFFSET ?
        """
        params.extend([limit, offset])
        cur.execute(query, params)
        rows = cur.fetchall()
        return [row_to_intervention_alert(r) for r in rows]
    finally:
        if should_close:
            conn.close()


def count_active_interventions(
    conn: Optional[sqlite3.Connection] = None,
    video_id: Optional[str] = None,
) -> int:
    """Counts active alerts."""
    should_close = False
    if conn is None:
        conn = get_connection()
        should_close = True

    try:
        cur = conn.cursor()
        active_states = (
            AlertState.NEW.value,
            AlertState.ACKNOWLEDGED.value,
            AlertState.ACTION_IN_PROGRESS.value,
            AlertState.VERIFICATION_REQUIRED.value,
        )
        placeholders = ",".join("?" for _ in active_states)
        if video_id:
            cur.execute(
                f"SELECT COUNT(*) FROM interventions WHERE state IN ({placeholders}) AND video_id = ?",
                (*active_states, video_id),
            )
        else:
            cur.execute(
                f"SELECT COUNT(*) FROM interventions WHERE state IN ({placeholders})",
                active_states,
            )
        return cur.fetchone()[0]
    finally:
        if should_close:
            conn.close()
