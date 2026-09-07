"""Database operations for Phase 10 Outcome Verification & Prevention Measurement ledger.

Stores and queries OutcomeMeasurement records, linking evaluated outcomes to
events in the events ledger and maintaining three distinct counters:
Prevented, Near-miss, and Outcome-unclear / Confirmed-damage.
"""

from __future__ import annotations

import json
import logging
import sqlite3
import time
from typing import Any, Optional

from backend.contracts.models import (
    ConditionCheckResult,
    OutcomeMeasurement,
    PreventionClassification,
    PreventionSummary,
    RiskBand,
    ThreeConditionCheck,
)
from backend.db.db import ensure_schema_migrations, get_connection

logger = logging.getLogger("trace.outcomes")


def make_outcome_dedup_key(event_id: int, window_sec: float) -> str:
    """Deterministic deduplication key for outcome evaluation records."""
    return f"outcome:event_{event_id}:win_{float(window_sec):.2f}"


def row_to_outcome_measurement(row: sqlite3.Row) -> OutcomeMeasurement:
    """Deserializes a SQLite row into a typed OutcomeMeasurement instance."""
    three_cond_data = json.loads(row["three_condition_json"])
    evidence = json.loads(row["evidence_json"]) if row["evidence_json"] else {}
    limitations = json.loads(row["limitations_json"]) if row["limitations_json"] else []

    cond_1 = ConditionCheckResult(**three_cond_data["condition_1_risk_predicted"])
    cond_2 = ConditionCheckResult(**three_cond_data["condition_2_action_observed"])
    cond_3 = ConditionCheckResult(**three_cond_data["condition_3_state_improved"])

    three_cond_check = ThreeConditionCheck(
        condition_1_risk_predicted=cond_1,
        condition_2_action_observed=cond_2,
        condition_3_state_improved=cond_3,
        all_satisfied=bool(row["condition_1_satisfied"] and row["condition_2_satisfied"] and row["condition_3_satisfied"]),
    )

    initial_band = RiskBand(row["initial_band"]) if row["initial_band"] else None
    outcome_band = RiskBand(row["outcome_band"]) if row["outcome_band"] else None
    followed = bool(row["followed_recommendation"]) if row["followed_recommendation"] is not None else None

    return OutcomeMeasurement(
        outcome_id=row["outcome_id"],
        event_id=row["event_id"],
        video_id=row["video_id"],
        initial_timestamp=row["initial_timestamp"],
        outcome_timestamp=row["outcome_timestamp"],
        response_window_sec=row["response_window_sec"],
        classification=PreventionClassification(row["classification"]),
        three_condition_check=three_cond_check,
        initial_score=row["initial_score"],
        outcome_score=row["outcome_score"],
        initial_band=initial_band,
        outcome_band=outcome_band,
        followed_recommendation=followed,
        human_review_status=row["human_review_status"],
        explanation=row["explanation"] or "",
        evidence=evidence,
        limitations=limitations,
        evaluated_at=row["evaluated_at"],
    )


def save_outcome_measurement(
    measurement: OutcomeMeasurement,
    conn: Optional[sqlite3.Connection] = None,
) -> OutcomeMeasurement:
    """Idempotently saves or updates an outcome measurement record in SQLite."""
    should_close = False
    if conn is None:
        conn = get_connection()
        should_close = True

    try:
        ensure_schema_migrations(conn)
        cur = conn.cursor()

        dedup_key = make_outcome_dedup_key(measurement.event_id, measurement.response_window_sec)
        three_cond_json = measurement.three_condition_check.model_dump_json()
        evidence_json = json.dumps(measurement.evidence)
        limitations_json = json.dumps(measurement.limitations)
        initial_band_str = measurement.initial_band.value if measurement.initial_band else None
        outcome_band_str = measurement.outcome_band.value if measurement.outcome_band else None
        followed_int = 1 if measurement.followed_recommendation is True else (0 if measurement.followed_recommendation is False else None)

        cur.execute(
            "SELECT outcome_id FROM outcome_measurements WHERE dedup_key = ? OR event_id = ?",
            (dedup_key, measurement.event_id),
        )
        existing = cur.fetchone()

        if existing:
            outcome_id = existing["outcome_id"]
            cur.execute(
                """
                UPDATE outcome_measurements
                SET video_id = ?, initial_timestamp = ?, outcome_timestamp = ?,
                    response_window_sec = ?, classification = ?,
                    condition_1_satisfied = ?, condition_2_satisfied = ?, condition_3_satisfied = ?,
                    three_condition_json = ?, initial_score = ?, outcome_score = ?,
                    initial_band = ?, outcome_band = ?, followed_recommendation = ?,
                    human_review_status = ?, explanation = ?, evidence_json = ?,
                    limitations_json = ?, evaluated_at = ?, dedup_key = ?
                WHERE outcome_id = ?
                """,
                (
                    measurement.video_id,
                    measurement.initial_timestamp,
                    measurement.outcome_timestamp,
                    measurement.response_window_sec,
                    measurement.classification.value,
                    1 if measurement.three_condition_check.condition_1_risk_predicted.satisfied else 0,
                    1 if measurement.three_condition_check.condition_2_action_observed.satisfied else 0,
                    1 if measurement.three_condition_check.condition_3_state_improved.satisfied else 0,
                    three_cond_json,
                    measurement.initial_score,
                    measurement.outcome_score,
                    initial_band_str,
                    outcome_band_str,
                    followed_int,
                    measurement.human_review_status,
                    measurement.explanation,
                    evidence_json,
                    limitations_json,
                    measurement.evaluated_at,
                    dedup_key,
                    outcome_id,
                ),
            )
            measurement.outcome_id = outcome_id
        else:
            cur.execute(
                """
                INSERT INTO outcome_measurements (
                    event_id, video_id, initial_timestamp, outcome_timestamp,
                    response_window_sec, classification,
                    condition_1_satisfied, condition_2_satisfied, condition_3_satisfied,
                    three_condition_json, initial_score, outcome_score,
                    initial_band, outcome_band, followed_recommendation,
                    human_review_status, explanation, evidence_json,
                    limitations_json, evaluated_at, dedup_key
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    measurement.event_id,
                    measurement.video_id,
                    measurement.initial_timestamp,
                    measurement.outcome_timestamp,
                    measurement.response_window_sec,
                    measurement.classification.value,
                    1 if measurement.three_condition_check.condition_1_risk_predicted.satisfied else 0,
                    1 if measurement.three_condition_check.condition_2_action_observed.satisfied else 0,
                    1 if measurement.three_condition_check.condition_3_state_improved.satisfied else 0,
                    three_cond_json,
                    measurement.initial_score,
                    measurement.outcome_score,
                    initial_band_str,
                    outcome_band_str,
                    followed_int,
                    measurement.human_review_status,
                    measurement.explanation,
                    evidence_json,
                    limitations_json,
                    measurement.evaluated_at,
                    dedup_key,
                ),
            )
            measurement.outcome_id = cur.lastrowid

        # Update planner_recommendations followed column if present
        if followed_int is not None:
            cur.execute(
                "UPDATE planner_recommendations SET followed = ? WHERE event_id = ?",
                (followed_int, measurement.event_id),
            )

        # Update events event_type unless it was human-confirmed damage
        if measurement.classification == PreventionClassification.CONFIRMED_DAMAGE:
            cur.execute(
                "UPDATE events SET reviewed = 1, review_status = 'confirmed_damage' WHERE event_id = ?",
                (measurement.event_id,),
            )
        elif measurement.classification == PreventionClassification.PREVENTED:
            cur.execute(
                "UPDATE events SET event_type = 'prevented' WHERE event_id = ? AND (review_status IS NULL OR review_status != 'confirmed_damage')",
                (measurement.event_id,),
            )
        elif measurement.classification == PreventionClassification.NEAR_MISS:
            cur.execute(
                "UPDATE events SET event_type = 'near_miss' WHERE event_id = ? AND (review_status IS NULL OR review_status != 'confirmed_damage')",
                (measurement.event_id,),
            )

        conn.commit()
        return measurement
    finally:
        if should_close:
            conn.close()


def get_outcome_by_event_id(
    event_id: int,
    conn: Optional[sqlite3.Connection] = None,
) -> Optional[OutcomeMeasurement]:
    """Retrieves an outcome measurement for a given event ID, if evaluated."""
    should_close = False
    if conn is None:
        conn = get_connection()
        should_close = True

    try:
        ensure_schema_migrations(conn)
        cur = conn.cursor()
        cur.execute(
            "SELECT * FROM outcome_measurements WHERE event_id = ? ORDER BY outcome_id DESC LIMIT 1",
            (event_id,),
        )
        row = cur.fetchone()
        if not row:
            return None
        return row_to_outcome_measurement(row)
    finally:
        if should_close:
            conn.close()


def list_outcomes(
    video_id: Optional[str] = None,
    classification: Optional[str] = None,
    limit: int = 50,
    offset: int = 0,
    conn: Optional[sqlite3.Connection] = None,
) -> list[OutcomeMeasurement]:
    """Lists outcome measurements with optional filtering."""
    should_close = False
    if conn is None:
        conn = get_connection()
        should_close = True

    try:
        ensure_schema_migrations(conn)
        cur = conn.cursor()

        query = "SELECT * FROM outcome_measurements WHERE 1=1"
        params: list[Any] = []

        if video_id:
            query += " AND video_id = ?"
            params.append(video_id)
        if classification:
            query += " AND classification = ?"
            params.append(classification)

        query += " ORDER BY outcome_id DESC LIMIT ? OFFSET ?"
        params.extend([limit, offset])

        cur.execute(query, params)
        return [row_to_outcome_measurement(r) for r in cur.fetchall()]
    finally:
        if should_close:
            conn.close()


def get_prevention_summary(conn: Optional[sqlite3.Connection] = None) -> PreventionSummary:
    """Computes aggregate prevention, near-miss, and outcome counts across the ledger."""
    should_close = False
    if conn is None:
        conn = get_connection()
        should_close = True

    try:
        ensure_schema_migrations(conn)
        cur = conn.cursor()

        # Classification counts
        cur.execute(
            """
            SELECT classification, COUNT(*) as count
            FROM outcome_measurements
            GROUP BY classification
            """
        )
        counts = {r["classification"]: r["count"] for r in cur.fetchall()}

        prevented = counts.get(PreventionClassification.PREVENTED.value, 0)
        near_miss = counts.get(PreventionClassification.NEAR_MISS.value, 0)
        outcome_unclear = counts.get(PreventionClassification.OUTCOME_UNCLEAR.value, 0)
        confirmed_damage = counts.get(PreventionClassification.CONFIRMED_DAMAGE.value, 0)

        # Breakdowns joined with events table
        cur.execute(
            """
            SELECT e.lens, o.classification, COUNT(*) as count
            FROM outcome_measurements o
            JOIN events e ON o.event_id = e.event_id
            GROUP BY e.lens, o.classification
            """
        )
        by_lens: dict[str, dict[str, int]] = {}
        for r in cur.fetchall():
            by_lens.setdefault(r["lens"], {})[r["classification"]] = r["count"]

        cur.execute(
            """
            SELECT e.band, o.classification, COUNT(*) as count
            FROM outcome_measurements o
            JOIN events e ON o.event_id = e.event_id
            WHERE e.band IS NOT NULL
            GROUP BY e.band, o.classification
            """
        )
        by_band: dict[str, dict[str, int]] = {}
        for r in cur.fetchall():
            by_band.setdefault(r["band"], {})[r["classification"]] = r["count"]

        total = sum([prevented, near_miss, outcome_unclear, confirmed_damage])

        return PreventionSummary(
            total_evaluated=total,
            prevented_count=prevented,
            near_miss_count=near_miss,
            outcome_unclear_count=outcome_unclear,
            confirmed_damage_count=confirmed_damage,
            by_lens=by_lens,
            by_band=by_band,
        )
    finally:
        if should_close:
            conn.close()
