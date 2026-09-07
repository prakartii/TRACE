"""Event persistence and retrieval service for TRACE (Phase 9.1).

Handles saving, deduplication, filtering, retrieval, and review of operational
RiskEvents in SQLite.
"""

from __future__ import annotations

import json
import logging
import sqlite3
import time
from typing import Any, Optional

from backend.contracts.models import (
    ActionRecommendation,
    ConfidenceLevel,
    EpistemicLevel,
    EventType,
    FindingStatus,
    RiskBand,
    RiskEvent,
    RiskLens,
)
from backend.db.db import DEFAULT_DB_PATH, ensure_schema_migrations, get_connection

logger = logging.getLogger("trace.events")


def make_dedup_key(canonical_id: str, scenario: Optional[str], timestamp: float, entity_id: str) -> str:
    """Deterministic deduplication key for risk events.

    Prevents duplicate database rows during video scrubbing or repeated analysis.
    """
    scen = scenario or "unknown_scenario"
    ent = entity_id or "global"
    ts = round(float(timestamp), 3)
    return f"{canonical_id}:{scen}:{ts:.3f}:{ent}"


def persist_findings(
    findings: list[RiskEvent],
    video_id: str,
    canonical_id: str,
    timestamp: float,
    conn: Optional[sqlite3.Connection] = None,
) -> None:
    """Persists operational risk findings into SQLite, respecting deduplication.

    If SQLite persistence fails, catches the error and logs a warning to ensure
    live video analysis is never interrupted.
    """
    if not findings:
        return

    should_close = False
    if conn is None:
        conn = get_connection()
        should_close = True

    try:
        ensure_schema_migrations(conn)
        cur = conn.cursor()

        for f in findings:
            scenario = f.scenario or (
                f.planner_recommendation.scenario_key
                if f.planner_recommendation
                else None
            )
            if not scenario:
                continue

            entity_str = f.entity_id or (
                "_".join(sorted(f.entities)) if f.entities else "global"
            )
            dedup_key = make_dedup_key(canonical_id, scenario, timestamp, entity_str)

            cur.execute(
                "SELECT event_id, reviewed, review_status FROM events WHERE dedup_key = ?",
                (dedup_key,),
            )
            existing = cur.fetchone()

            factor_payload = {
                "factor_breakdown": f.factor_breakdown,
                "evidence": f.evidence,
                "explanation": f.explanation,
                "limitations": f.limitations,
                "entities": f.entities,
                "recommended_action": f.recommended_action,
            }
            factor_json = json.dumps(factor_payload)
            clip_ref = f.clip_path or f"/api/videos/{video_id}/stream"

            event_type_str = (
                f.event_type.value
                if hasattr(f.event_type, "value")
                else str(f.event_type)
            )
            lens_str = f.lens.value if hasattr(f.lens, "value") else str(f.lens)
            band_str = (
                f.band.value
                if f.band and hasattr(f.band, "value")
                else (str(f.band) if f.band else None)
            )
            conf_str = (
                f.confidence.value
                if hasattr(f.confidence, "value")
                else str(f.confidence)
            )
            status_str = f.status.value if hasattr(f.status, "value") else str(f.status)
            epistemic_str = (
                f.epistemic_level.value
                if hasattr(f.epistemic_level, "value")
                else str(f.epistemic_level)
            )

            if existing:
                event_id = existing["event_id"]
                f.event_id = event_id
                f.video_id = video_id
                f.reviewed = bool(existing["reviewed"])
                f.review_status = existing["review_status"]
                cur.execute(
                    """
                    UPDATE events
                    SET score = ?, band = ?, confidence = ?, status = ?, factor_breakdown_json = ?, epistemic_level = ?
                    WHERE event_id = ?
                    """,
                    (f.score, band_str, conf_str, status_str, factor_json, epistemic_str, event_id),
                )
            else:
                cur.execute(
                    """
                    INSERT INTO events (
                        video_id, timestamp, event_type, lens, entity_id, score, band,
                        confidence, status, scenario, factor_breakdown_json, clip_path,
                        reviewed, review_status, dedup_key, epistemic_level
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, NULL, ?, ?)
                    """,
                    (
                        video_id,
                        float(timestamp),
                        event_type_str,
                        lens_str,
                        entity_str,
                        f.score,
                        band_str,
                        conf_str,
                        status_str,
                        scenario,
                        factor_json,
                        clip_ref,
                        dedup_key,
                        epistemic_str,
                    ),
                )
                event_id = cur.lastrowid
                f.event_id = event_id
                f.video_id = video_id
                f.reviewed = False
                f.review_status = None

            if f.planner_recommendation and event_id:
                cur.execute(
                    "SELECT rec_id FROM planner_recommendations WHERE event_id = ?",
                    (event_id,),
                )
                existing_rec = cur.fetchone()
                rec_json = f.planner_recommendation.model_dump_json()
                if existing_rec:
                    cur.execute(
                        "UPDATE planner_recommendations SET recommendation_json = ? WHERE rec_id = ?",
                        (rec_json, existing_rec["rec_id"]),
                    )
                else:
                    cur.execute(
                        """
                        INSERT INTO planner_recommendations (
                            event_id, candidates_json, recommended_position, expected_delta,
                            followed, outcome_state_id, recommendation_json
                        ) VALUES (?, ?, NULL, NULL, NULL, NULL, ?)
                        """,
                        (event_id, "[]", rec_json),
                    )

        conn.commit()
    except Exception as exc:
        logger.warning(f"Error persisting findings to SQLite: {exc}", exc_info=True)
    finally:
        if should_close:
            conn.close()


def row_to_risk_event(row: sqlite3.Row, conn: Optional[sqlite3.Connection] = None) -> RiskEvent:
    """Reconstructs a high-fidelity RiskEvent contract instance from a SQLite row."""
    factor_data: dict[str, Any] = {}
    if row["factor_breakdown_json"]:
        try:
            factor_data = json.loads(row["factor_breakdown_json"])
        except Exception:
            factor_data = {}

    factor_breakdown = factor_data.get("factor_breakdown", {})
    evidence = factor_data.get("evidence", {})
    explanation = factor_data.get("explanation", "")
    limitations = factor_data.get("limitations", [])
    entities = factor_data.get("entities", [])
    recommended_action = factor_data.get("recommended_action", None)

    row_keys = set(row.keys())
    status_str = (
        row["status"]
        if "status" in row_keys and row["status"]
        else factor_data.get("status", "insufficient_evidence")
    )
    scenario_str = (
        row["scenario"]
        if "scenario" in row_keys and row["scenario"]
        else factor_data.get("scenario", None)
    )
    video_id = row["video_id"] if "video_id" in row_keys else None

    planner_rec = None
    if conn is not None:
        cur = conn.cursor()
        cur.execute(
            "SELECT recommendation_json FROM planner_recommendations WHERE event_id = ?",
            (row["event_id"],),
        )
        rec_row = cur.fetchone()
        if rec_row and rec_row["recommendation_json"]:
            try:
                planner_rec = ActionRecommendation.model_validate_json(
                    rec_row["recommendation_json"]
                )
            except Exception:
                planner_rec = None

    epistemic_level = EpistemicLevel.INFERRED
    if "epistemic_level" in row.keys() and row["epistemic_level"]:
        try:
            epistemic_level = EpistemicLevel(row["epistemic_level"])
        except ValueError:
            epistemic_level = EpistemicLevel.INFERRED

    return RiskEvent(
        event_id=row["event_id"],
        timestamp=row["timestamp"],
        event_type=EventType(row["event_type"]),
        lens=RiskLens(row["lens"]),
        entity_id=row["entity_id"],
        score=row["score"],
        band=RiskBand(row["band"]) if row["band"] else None,
        confidence=ConfidenceLevel(row["confidence"])
        if row["confidence"]
        else ConfidenceLevel.LOW,
        factor_breakdown=factor_breakdown,
        clip_path=row["clip_path"],
        status=FindingStatus(status_str),
        scenario=scenario_str,
        entities=entities,
        evidence=evidence,
        explanation=explanation,
        recommended_action=recommended_action,
        limitations=limitations,
        planner_recommendation=planner_rec,
        video_id=video_id,
        reviewed=bool(row["reviewed"]),
        review_status=row["review_status"],
        epistemic_level=epistemic_level,
    )


def query_events(
    conn: sqlite3.Connection,
    *,
    video_id: Optional[str] = None,
    canonical_id: Optional[str] = None,
    lens: Optional[str] = None,
    status: Optional[str] = None,
    band: Optional[str] = None,
    reviewed: Optional[bool] = None,
    review_status: Optional[str] = None,
    limit: int = 50,
    offset: int = 0,
    order: str = "desc",
) -> list[RiskEvent]:
    """Queries persisted risk events with flexible filtering and sorting."""
    ensure_schema_migrations(conn)
    cur = conn.cursor()

    clauses = []
    params: list[Any] = []

    if video_id:
        if canonical_id and canonical_id != video_id:
            clauses.append("(video_id = ? OR video_id = ?)")
            params.extend([video_id, canonical_id])
        else:
            clauses.append("video_id = ?")
            params.append(video_id)

    if lens:
        clauses.append("lens = ?")
        params.append(lens)

    if status:
        clauses.append("status = ?")
        params.append(status)

    if band:
        clauses.append("band = ?")
        params.append(band)

    if reviewed is not None:
        clauses.append("reviewed = ?")
        params.append(1 if reviewed else 0)

    if review_status:
        clauses.append("review_status = ?")
        params.append(review_status)

    where_sql = ("WHERE " + " AND ".join(clauses)) if clauses else ""
    order_direction = "ASC" if order.lower() == "asc" else "DESC"
    sql = f"""
        SELECT * FROM events
        {where_sql}
        ORDER BY timestamp {order_direction}, event_id {order_direction}
        LIMIT ? OFFSET ?
    """
    params.extend([limit, offset])

    cur.execute(sql, params)
    rows = cur.fetchall()
    return [row_to_risk_event(row, conn) for row in rows]


def get_event_by_id(conn: sqlite3.Connection, event_id: int) -> Optional[RiskEvent]:
    """Retrieves a single persisted event by ID with its linked planner recommendation."""
    ensure_schema_migrations(conn)
    cur = conn.cursor()
    cur.execute("SELECT * FROM events WHERE event_id = ?", (event_id,))
    row = cur.fetchone()
    if not row:
        return None
    return row_to_risk_event(row, conn)


def review_event(
    conn: sqlite3.Connection,
    event_id: int,
    review_status: str,
    notes: Optional[str] = None,
) -> Optional[RiskEvent]:
    """Records human operator review feedback for Responsible AI closed-loop learning."""
    ensure_schema_migrations(conn)
    cur = conn.cursor()
    cur.execute("SELECT event_id FROM events WHERE event_id = ?", (event_id,))
    if not cur.fetchone():
        return None

    reviewed_val = 1 if review_status in ("confirmed_damage", "false_positive") else 0
    cur.execute(
        "UPDATE events SET reviewed = ?, review_status = ? WHERE event_id = ?",
        (reviewed_val, review_status, event_id),
    )

    if review_status == "false_positive":
        cur.execute(
            "INSERT INTO feedback (event_id, flag_type, created_at) VALUES (?, ?, ?)",
            (event_id, "false_positive", time.time()),
        )

    conn.commit()
    return get_event_by_id(conn, event_id)
