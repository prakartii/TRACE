"""Intervention Engine for TRACE (Operational Safety Intervention Layer).

Converts real detected RiskEvents and Safe Action Plans into actionable,
real-time intervention alerts with deterministic deduplication, lifecycle
state management, and closed-loop outcome measurement linkage.
"""

from __future__ import annotations

import asyncio
import hashlib
import json
import logging
import sqlite3
import time
from typing import Any, Optional

from backend.contracts.models import (
    AlertSeverity,
    AlertState,
    AlertUrgency,
    FindingStatus,
    InterventionAlert,
    OutcomeMeasurement,
    PreventionClassification,
    RiskBand,
    RiskEvent,
    SafeActionPlan,
)
from backend.db.db import ensure_schema_migrations, get_connection
from backend.db.events import get_event_by_id, review_event
from backend.db.interventions import (
    get_active_interventions,
    get_intervention_by_dedup_key,
    get_intervention_by_id,
    save_intervention,
)
from backend.db.outcomes import get_outcome_by_event_id, save_outcome_measurement
from backend.intervention.ws import ws_manager
from backend.measurement.prevention import DEFAULT_RESPONSE_WINDOW_SEC, evaluate_prevention
from backend.planner.safe_actions import _SAFE_ACTION_CATALOG, generate_safe_action_plan

logger = logging.getLogger("trace.intervention.engine")


def make_alert_dedup_key(video_id: str, scenario: str, entity_id: Optional[str] = None) -> str:
    """Generates a deterministic deduplication key for an active hazard.

    Ensures multiple observations of the same active scenario within a video
    update the existing alert instead of creating redundant alert cards.
    """
    vid = video_id or "global"
    scen = scenario or "unknown"
    return f"{vid}:{scen}"


def determine_qualification(event: RiskEvent) -> tuple[bool, Optional[AlertSeverity], Optional[AlertUrgency], Optional[AlertState]]:
    """Evaluates whether an event qualifies for an operational intervention alert.

    Returns:
        (qualifies, severity, urgency, initial_state)
    """
    status_str = (
        event.status.value.lower()
        if hasattr(event.status, "value")
        else str(event.status).lower()
    )
    band_str = (
        event.band.value if hasattr(event.band, "value") else str(event.band)
    ) if event.band else "Medium"
    score = event.score or 0.0

    # 1. Non-qualifying checks: unsupported or low-risk events do not trigger alerts
    if status_str == "unsupported":
        return False, None, None, None

    if band_str == "Low" and score < 50.0:
        return False, None, None, None

    # 2. Epistemic Guardrail: insufficient evidence creates a verification-required alert
    if status_str == "insufficient_evidence":
        if band_str in ("Critical", "High") or score >= 60.0:
            return True, AlertSeverity.HIGH, AlertUrgency.URGENT, AlertState.VERIFICATION_REQUIRED
        return False, None, None, None

    # 3. Critical Severity
    if band_str == "Critical" or score >= 80.0:
        return True, AlertSeverity.CRITICAL, AlertUrgency.IMMEDIATE, AlertState.NEW

    # 4. High Severity
    if band_str == "High" or score >= 65.0:
        return True, AlertSeverity.HIGH, AlertUrgency.URGENT, AlertState.NEW

    # 5. Medium Severity: qualify when score >= 50 or scenario in active operational catalog
    if band_str == "Medium" or score >= 50.0:
        if score >= 50.0 or event.scenario in _SAFE_ACTION_CATALOG:
            return True, AlertSeverity.MEDIUM, AlertUrgency.ADVISORY, AlertState.NEW

    return False, None, None, None


class InterventionEngine:
    """Operational Intervention Engine for TRACE."""

    def __init__(self) -> None:
        pass

    def process_event(
        self,
        event: RiskEvent,
        conn: Optional[sqlite3.Connection] = None,
    ) -> Optional[InterventionAlert]:
        """Processes an observed RiskEvent into an InterventionAlert with deduplication."""
        qualifies, severity, urgency, initial_state = determine_qualification(event)
        if not qualifies or severity is None or urgency is None or initial_state is None:
            return None

        should_close = False
        if conn is None:
            conn = get_connection()
            should_close = True

        try:
            ensure_schema_migrations(conn)

            video_id = event.video_id or "global"
            scenario = event.scenario or "unspecified_hazard"
            dedup_key = make_alert_dedup_key(video_id, scenario, event.entity_id)

            # Check if an active alert already exists for this hazard
            existing = get_intervention_by_dedup_key(dedup_key, conn)
            now = time.time()

            if existing is not None and existing.state in (
                AlertState.NEW,
                AlertState.ACKNOWLEDGED,
                AlertState.ACTION_IN_PROGRESS,
                AlertState.VERIFICATION_REQUIRED,
            ):
                # Update existing alert (deduplication without evidence loss)
                supporting = list(existing.supporting_event_ids)
                if event.event_id and event.event_id not in supporting:
                    supporting.append(event.event_id)

                new_count = existing.occurrence_count + 1
                latest_ts = max(existing.timestamp, float(event.timestamp or 0.0))

                # Escalate score/severity if higher
                new_score = existing.score
                new_severity = existing.severity
                new_urgency = existing.urgency
                new_band = existing.band

                if event.score and (existing.score is None or event.score > existing.score):
                    new_score = event.score
                    new_severity = severity
                    new_urgency = urgency
                    new_band = event.band.value if hasattr(event.band, "value") else str(event.band)

                updated_alert = existing.model_copy(
                    update={
                        "timestamp": latest_ts,
                        "supporting_event_ids": supporting,
                        "occurrence_count": new_count,
                        "score": new_score,
                        "severity": new_severity,
                        "urgency": new_urgency,
                        "band": new_band,
                        "updated_at": now,
                    }
                )
                saved = save_intervention(updated_alert, conn)
                self._safely_broadcast({"type": "alert_updated", "alert": saved.model_dump()})
                return saved

            # Generate authoritative Safe Action Plan from existing planner
            safe_plan = generate_safe_action_plan(event)

            # Deterministic alert ID based on video, scenario, and root event
            alert_id = f"alert_{video_id}_{scenario}_{event.event_id or int(now)}"

            alert = InterventionAlert(
                alert_id=alert_id,
                event_id=event.event_id or 0,
                video_id=video_id,
                timestamp=float(event.timestamp or 0.0),
                scenario=scenario,
                lens=event.lens.value if hasattr(event.lens, "value") else str(event.lens),
                severity=severity,
                urgency=urgency,
                state=initial_state,
                title=safe_plan.title,
                immediate_action=safe_plan.immediate_action,
                secondary_actions=list(safe_plan.secondary_actions),
                steps=list(safe_plan.steps),
                verification=safe_plan.verification,
                reason=safe_plan.reason,
                score=event.score,
                band=event.band.value if hasattr(event.band, "value") else (str(event.band) if event.band else "Medium"),
                evidence_status=safe_plan.evidence_status,
                evidence_summary=safe_plan.evidence_summary,
                entity_id=event.entity_id,
                supporting_event_ids=[event.event_id] if event.event_id else [],
                occurrence_count=1,
                dedup_key=dedup_key,
                safe_plan=safe_plan,
                created_at=now,
                updated_at=now,
            )

            saved = save_intervention(alert, conn)
            self._safely_broadcast({"type": "alert_created", "alert": saved.model_dump()})
            return saved
        finally:
            if should_close:
                conn.close()

    def acknowledge(
        self,
        alert_id: str,
        user: str = "operator",
        conn: Optional[sqlite3.Connection] = None,
    ) -> Optional[InterventionAlert]:
        """Marks an alert as acknowledged by supervisor or warehouse operator."""
        should_close = False
        if conn is None:
            conn = get_connection()
            should_close = True

        try:
            alert = get_intervention_by_id(alert_id, conn)
            if alert is None:
                return None

            now = time.time()
            updated = alert.model_copy(
                update={
                    "state": AlertState.ACKNOWLEDGED,
                    "acknowledged_at": now,
                    "acknowledged_by": user,
                    "updated_at": now,
                }
            )
            saved = save_intervention(updated, conn)
            self._safely_broadcast({"type": "alert_updated", "alert": saved.model_dump()})
            return saved
        finally:
            if should_close:
                conn.close()

    def progress_action(
        self,
        alert_id: str,
        notes: Optional[str] = None,
        conn: Optional[sqlite3.Connection] = None,
    ) -> Optional[InterventionAlert]:
        """Transitions alert into ACTION_IN_PROGRESS state."""
        should_close = False
        if conn is None:
            conn = get_connection()
            should_close = True

        try:
            alert = get_intervention_by_id(alert_id, conn)
            if alert is None:
                return None

            now = time.time()
            updated = alert.model_copy(
                update={
                    "state": AlertState.ACTION_IN_PROGRESS,
                    "action_in_progress_at": now,
                    "resolution_notes": notes or alert.resolution_notes,
                    "updated_at": now,
                }
            )
            saved = save_intervention(updated, conn)
            self._safely_broadcast({"type": "alert_updated", "alert": saved.model_dump()})
            return saved
        finally:
            if should_close:
                conn.close()

    def verify_alert(
        self,
        alert_id: str,
        verified_by: str = "supervisor",
        notes: Optional[str] = None,
        conn: Optional[sqlite3.Connection] = None,
    ) -> Optional[InterventionAlert]:
        """Records physical supervisor safety verification."""
        should_close = False
        if conn is None:
            conn = get_connection()
            should_close = True

        try:
            alert = get_intervention_by_id(alert_id, conn)
            if alert is None:
                return None

            now = time.time()
            updated = alert.model_copy(
                update={
                    "state": AlertState.VERIFICATION_REQUIRED,
                    "verified_at": now,
                    "verified_by": verified_by,
                    "resolution_notes": notes or alert.resolution_notes,
                    "updated_at": now,
                }
            )
            saved = save_intervention(updated, conn)
            self._safely_broadcast({"type": "alert_updated", "alert": saved.model_dump()})
            return saved
        finally:
            if should_close:
                conn.close()

    def resolve(
        self,
        alert_id: str,
        notes: Optional[str] = None,
        outcome_classification: str = "prevented",
        conn: Optional[sqlite3.Connection] = None,
    ) -> Optional[InterventionAlert]:
        """Resolves an alert and completes the closed-loop link to outcome measurement."""
        should_close = False
        if conn is None:
            conn = get_connection()
            should_close = True

        try:
            alert = get_intervention_by_id(alert_id, conn)
            if alert is None:
                return None

            now = time.time()
            outcome_id = alert.outcome_id

            # Closed loop: link to outcome_measurements if event exists
            if alert.event_id:
                existing_outcome = get_outcome_by_event_id(alert.event_id, conn)
                if existing_outcome is not None:
                    outcome_id = existing_outcome.outcome_id
                else:
                    event = get_event_by_id(conn, alert.event_id)
                    if event is not None:
                        post_data = {
                            "action_observed": True,
                            "action_timestamp": now,
                            "action_type": "intervention_resolved",
                            "elapsed_sec": round(now - alert.created_at, 2),
                            "outcome_score": 0.0,
                            "outcome_band": "Low",
                            "risk_resolved": True,
                            "followed_recommendation": True,
                        }
                        measurement = evaluate_prevention(
                            event=event,
                            post_event_data=post_data,
                            response_window_sec=DEFAULT_RESPONSE_WINDOW_SEC,
                            human_review_status=event.review_status,
                        )
                        saved_outcome = save_outcome_measurement(measurement, conn)
                        outcome_id = saved_outcome.outcome_id

            updated = alert.model_copy(
                update={
                    "state": AlertState.RESOLVED,
                    "resolved_at": now,
                    "resolution_notes": notes or "Intervention executed and verified safe.",
                    "outcome_id": outcome_id,
                    "outcome_classification": outcome_classification,
                    "updated_at": now,
                }
            )
            saved = save_intervention(updated, conn)
            self._safely_broadcast({"type": "alert_resolved", "alert": saved.model_dump()})
            return saved
        finally:
            if should_close:
                conn.close()

    def dismiss_as_false_positive(
        self,
        alert_id: str,
        reason: str = "Marked as false positive by operator",
        conn: Optional[sqlite3.Connection] = None,
    ) -> Optional[InterventionAlert]:
        """Dismisses an alert as a false positive, updating Responsible AI feedback."""
        should_close = False
        if conn is None:
            conn = get_connection()
            should_close = True

        try:
            alert = get_intervention_by_id(alert_id, conn)
            if alert is None:
                return None

            now = time.time()
            if alert.event_id:
                # Link to existing human review and feedback tables
                review_event(conn, alert.event_id, review_status="false_positive", notes=reason)

            updated = alert.model_copy(
                update={
                    "state": AlertState.FALSE_POSITIVE,
                    "resolved_at": now,
                    "resolution_notes": reason,
                    "updated_at": now,
                }
            )
            saved = save_intervention(updated, conn)
            self._safely_broadcast({"type": "alert_dismissed", "alert": saved.model_dump()})
            return saved
        finally:
            if should_close:
                conn.close()

    def seed_active_from_db(
        self,
        video_id: Optional[str] = None,
        conn: Optional[sqlite3.Connection] = None,
    ) -> list[InterventionAlert]:
        """Loads qualifying events from SQLite and initializes active intervention alerts.

        Ensures that live monitoring has genuine data grounded in actual DB records.
        """
        should_close = False
        if conn is None:
            conn = get_connection()
            should_close = True

        try:
            ensure_schema_migrations(conn)
            cur = conn.cursor()

            query = """
                SELECT * FROM events
                WHERE (band IN ('Critical', 'High') OR (band = 'Medium' AND score >= 50))
                  AND status IN ('supported', 'probable', 'insufficient_evidence')
                  AND (reviewed = 0 OR review_status IS NULL OR review_status != 'false_positive')
            """
            params = []
            if video_id:
                query += " AND video_id = ?"
                params.append(video_id)

            query += " ORDER BY score DESC, timestamp ASC"
            cur.execute(query, params)
            rows = cur.fetchall()

            from backend.db.events import row_to_risk_event

            alerts = []
            for r in rows:
                ev = row_to_risk_event(r, conn)
                alert = self.process_event(ev, conn)
                if alert is not None and alert not in alerts:
                    alerts.append(alert)

            return alerts
        finally:
            if should_close:
                conn.close()

    def _safely_broadcast(self, message: dict[str, Any]) -> None:
        """Schedules WebSocket broadcast in running event loop if available."""
        try:
            loop = asyncio.get_running_loop()
            loop.create_task(ws_manager.broadcast(message))
        except RuntimeError:
            # No running event loop in synchronous test or thread
            pass


intervention_engine = InterventionEngine()
