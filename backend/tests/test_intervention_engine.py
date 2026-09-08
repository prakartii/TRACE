"""Unit and integration tests for TRACE Intervention & Real-Time Alert Delivery.

Validates:
1. Qualifying risk creates intervention alert.
2. Non-qualifying risk (low score, unsupported) does not create alert.
3. Insufficient evidence triggers epistemic verification-required alert.
4. Correct scenario mapping and Safe Action Planner integration.
5. Deterministic duplicate alert prevention (aggregation, occurrence count, supporting IDs).
6. State transitions: NEW -> ACKNOWLEDGED -> ACTION_IN_PROGRESS -> VERIFICATION_REQUIRED -> RESOLVED.
7. Closed-loop outcome measurement creation upon resolution.
8. Responsible AI false-positive dismissal and event review integration.
9. REST API endpoints.
10. WebSocket broadcast and client connectivity.
"""

from __future__ import annotations

import json
import sqlite3
import pytest
from starlette.testclient import TestClient

from backend.contracts.models import (
    AlertSeverity,
    AlertState,
    AlertUrgency,
    ConfidenceLevel,
    EventType,
    FindingStatus,
    RiskBand,
    RiskEvent,
    RiskLens,
)
from backend.db.db import create_database, ensure_schema_migrations, get_connection
from backend.db.events import get_event_by_id, persist_findings, review_event
from backend.db.interventions import (
    get_active_interventions,
    get_intervention_by_dedup_key,
    get_intervention_by_id,
    list_interventions,
    save_intervention,
)
from backend.intervention.engine import InterventionEngine, make_alert_dedup_key
from backend.main import app


@pytest.fixture
def test_db(tmp_path):
    """Provides an isolated test database with full schema initialized."""
    db_file = tmp_path / "test_trace.db"
    conn = create_database(db_file)
    yield conn
    conn.close()


def _make_dummy_event(
    event_id: int = 1001,
    scenario: str = "stepping_on_carton",
    video_id: str = "f15ad7e2295d190b",
    timestamp: float = 36.7,
    score: float = 95.0,
    band: RiskBand = RiskBand.CRITICAL,
    status: FindingStatus = FindingStatus.PROBABLE,
    lens: RiskLens = RiskLens.BEHAVIOUR,
    conn: Optional[sqlite3.Connection] = None,
) -> RiskEvent:
    ev = RiskEvent(
        event_id=event_id,
        timestamp=timestamp,
        video_id=video_id,
        event_type=EventType.RISK,
        lens=lens,
        score=score,
        band=band,
        confidence=ConfidenceLevel.HIGH,
        status=status,
        scenario=scenario,
        entity_id="person_1",
        explanation="Worker observed standing directly on corrugated carton.",
        entities=["person_1", "box_4"],
        factor_breakdown={"structural": 0.9, "behaviour": 0.95},
        evidence={"supported_class": "person", "supporter_class": "box"},
        limitations=["Camera angle restricts lower pallet view."],
    )
    if conn is not None:
        cur = conn.cursor()
        cur.execute(
            """
            INSERT OR REPLACE INTO events (
                event_id, video_id, timestamp, event_type, lens, entity_id,
                score, band, confidence, status, scenario, factor_breakdown_json,
                reviewed, dedup_key
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                ev.event_id,
                ev.video_id,
                ev.timestamp,
                ev.event_type.value,
                ev.lens.value,
                ev.entity_id,
                ev.score,
                ev.band.value if ev.band else None,
                ev.confidence.value,
                ev.status.value,
                ev.scenario,
                json.dumps(ev.factor_breakdown),
                0,
                f"{ev.video_id}:{ev.scenario}:{ev.timestamp}:{ev.entity_id}",
            ),
        )
        conn.commit()
    return ev




class TestInterventionEngineCore:
    """Core logic tests for qualification, deduplication, and Safe Action Planner integration."""

    def test_qualifying_critical_event_creates_alert(self, test_db):
        engine = InterventionEngine()
        ev = _make_dummy_event(
            event_id=101,
            scenario="stepping_on_carton",
            score=95.0,
            band=RiskBand.CRITICAL,
            conn=test_db,
        )

        alert = engine.process_event(ev, conn=test_db)
        assert alert is not None
        assert alert.event_id == 101
        assert alert.video_id == "f15ad7e2295d190b"
        assert alert.severity == AlertSeverity.CRITICAL
        assert alert.urgency == AlertUrgency.IMMEDIATE
        assert alert.state == AlertState.NEW
        # Safe Action Planner integration check
        assert alert.title == "Worker standing on carton"
        assert "Step off the carton immediately" in alert.immediate_action
        assert "Confirm the worker is no longer standing on the carton" in alert.verification
        assert "Cartons are not rated to support human body weight" in alert.reason
        assert alert.occurrence_count == 1
        assert 101 in alert.supporting_event_ids

    def test_non_qualifying_low_risk_does_not_create_alert(self, test_db):
        engine = InterventionEngine()
        ev = _make_dummy_event(
            event_id=102,
            scenario="box_displacement_near_person",
            score=20.0,
            band=RiskBand.LOW,
            status=FindingStatus.PROBABLE,
            conn=test_db,
        )

        alert = engine.process_event(ev, conn=test_db)
        assert alert is None

    def test_unsupported_finding_does_not_create_alert(self, test_db):
        engine = InterventionEngine()
        ev = _make_dummy_event(
            event_id=103,
            scenario="product_rule_coverage",
            score=80.0,
            band=RiskBand.HIGH,
            status=FindingStatus.UNSUPPORTED,
            conn=test_db,
        )

        alert = engine.process_event(ev, conn=test_db)
        assert alert is None

    def test_insufficient_evidence_creates_verification_required_alert(self, test_db):
        engine = InterventionEngine()
        ev = _make_dummy_event(
            event_id=104,
            scenario="unsupported_bending_placement",
            score=70.0,
            band=RiskBand.HIGH,
            status=FindingStatus.INSUFFICIENT_EVIDENCE,
            conn=test_db,
        )

        alert = engine.process_event(ev, conn=test_db)
        assert alert is not None
        assert alert.state == AlertState.VERIFICATION_REQUIRED
        assert "Supervisor verification required" in alert.immediate_action
        assert "Insufficient evidence" in alert.evidence_status

    def test_deduplication_aggregates_repeated_events(self, test_db):
        engine = InterventionEngine()
        ev1 = _make_dummy_event(
            event_id=201,
            scenario="box_overhang",
            video_id="ac99ff34e1bd2c13",
            timestamp=3.0,
            score=70.0,
            band=RiskBand.HIGH,
            conn=test_db,
        )
        alert1 = engine.process_event(ev1, conn=test_db)
        assert alert1 is not None
        assert alert1.occurrence_count == 1
        assert alert1.supporting_event_ids == [201]

        # Second observation of same hazard 2 seconds later with higher score
        ev2 = _make_dummy_event(
            event_id=202,
            scenario="box_overhang",
            video_id="ac99ff34e1bd2c13",
            timestamp=5.0,
            score=85.0,
            band=RiskBand.CRITICAL,
            conn=test_db,
        )
        alert2 = engine.process_event(ev2, conn=test_db)
        assert alert2 is not None
        assert alert2.alert_id == alert1.alert_id
        assert alert2.occurrence_count == 2
        assert alert2.supporting_event_ids == [201, 202]
        assert alert2.timestamp == 5.0
        assert alert2.score == 85.0
        assert alert2.severity == AlertSeverity.CRITICAL

        # Verify database only has 1 active alert for this deduplication key
        active = get_active_interventions(test_db, video_id="ac99ff34e1bd2c13")
        assert len([a for a in active if a.scenario == "box_overhang"]) == 1


class TestInterventionLifecycleAndStateTransitions:
    """Lifecycle workflow: Acknowledge -> Progress -> Verify -> Resolve -> False Positive."""

    def test_full_operational_lifecycle(self, test_db):
        engine = InterventionEngine()
        ev = _make_dummy_event(event_id=301, scenario="heavy_on_light_stacking", conn=test_db)
        alert = engine.process_event(ev, conn=test_db)
        assert alert.state == AlertState.NEW

        # 1. Supervisor acknowledges
        ack = engine.acknowledge(alert.alert_id, user="supervisor_dan", conn=test_db)
        assert ack.state == AlertState.ACKNOWLEDGED
        assert ack.acknowledged_by == "supervisor_dan"
        assert ack.acknowledged_at is not None

        # 2. Worker begins action
        prog = engine.progress_action(alert.alert_id, notes="Worker restacking base tier", conn=test_db)
        assert prog.state == AlertState.ACTION_IN_PROGRESS
        assert prog.action_in_progress_at is not None

        # 3. Physical safety verification
        ver = engine.verify_alert(alert.alert_id, verified_by="supervisor_dan", notes="Verified heavy boxes on ground tier", conn=test_db)
        assert ver.state == AlertState.VERIFICATION_REQUIRED
        assert ver.verified_by == "supervisor_dan"

        # 4. Resolve & link closed-loop outcome

        res = engine.resolve(alert.alert_id, notes="Resolved and re-stacked safely", outcome_classification="prevented", conn=test_db)
        assert res.state == AlertState.RESOLVED
        assert res.resolved_at is not None
        assert res.outcome_classification == "prevented"

        # Resolved alert is no longer in active interventions
        active = get_active_interventions(test_db)
        assert not any(a.alert_id == alert.alert_id for a in active)

    def test_dismiss_as_false_positive(self, test_db):
        engine = InterventionEngine()
        ev = _make_dummy_event(event_id=401, scenario="wrong_product_orientation", conn=test_db)
        alert = engine.process_event(ev, conn=test_db)
        assert alert.state == AlertState.NEW

        # Operator flags false positive
        dismissed = engine.dismiss_as_false_positive(alert.alert_id, reason="Orientation markings intentionally reversed for custom customer", conn=test_db)
        assert dismissed.state == AlertState.FALSE_POSITIVE

        assert dismissed.resolution_notes == "Orientation markings intentionally reversed for custom customer"

        # Verify events table was updated for Responsible AI loop
        db_ev = get_event_by_id(test_db, 401)
        assert db_ev.reviewed is True
        assert db_ev.review_status == "false_positive"


class TestInterventionAPIEndpoints:
    """Integration tests on FastAPI REST and WebSocket endpoints."""

    def test_get_active_alerts_endpoint(self):
        client = TestClient(app)
        res = client.get("/api/intervention/active")
        assert res.status_code == 200
        data = res.json()
        assert isinstance(data, list)
        if data:
            first = data[0]
            assert "alert_id" in first
            assert "severity" in first
            assert "immediate_action" in first
            assert "verification" in first

    def test_acknowledge_endpoint(self):
        client = TestClient(app)
        active = client.get("/api/intervention/active").json()
        if not active:
            pytest.skip("No active alerts in DB")
        alert_id = active[0]["alert_id"]

        res = client.post(f"/api/intervention/{alert_id}/acknowledge", json={"user": "shift_lead"})
        assert res.status_code == 200
        data = res.json()
        assert data["state"] == "ACKNOWLEDGED"
        assert data["acknowledged_by"] == "shift_lead"

    def test_websocket_connection_and_ping(self):
        client = TestClient(app)
        with client.websocket_connect("/api/intervention/ws") as websocket:
            # Initial payload should arrive
            init_msg = websocket.receive_json()
            assert init_msg["type"] == "init"
            assert "alerts" in init_msg

            # Ping-pong heartbeat
            websocket.send_text("ping")
            pong = websocket.receive_text()
            assert pong == "pong"
