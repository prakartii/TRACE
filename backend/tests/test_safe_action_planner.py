"""Unit and API tests for TRACE Safe Action Planner (Feature 3).

Verifies:
- Critical incidents generate direct, prioritized immediate actions
- High-risk incidents produce grounded corrective actions
- Medium-risk incidents produce appropriate preventive actions
- Insufficient evidence / unsupported findings mandate supervisor verification without fabricated actions
- Unknown/unmapped scenarios fall back safely
- Correct event ID and scenario mapping synchronization
- API endpoint GET /api/actions/{event_id} and POST /api/actions/evaluate
"""

import pytest
from fastapi.testclient import TestClient

from backend.contracts.models import (
    ConfidenceLevel,
    FindingStatus,
    RiskBand,
    RiskEvent,
    RiskLens,
    EventType,
)
from backend.main import app
from backend.planner.safe_actions import generate_safe_action_plan

client = TestClient(app)


# ==============================================================================
# 1. Deterministic Safe Action Grounding Tests
# ==============================================================================

def test_critical_worker_stepping_action():
    """Critical incident: worker standing on carton requires immediate step off."""
    event = RiskEvent(
        event_id=1,
        timestamp=36.7,
        event_type=EventType.RISK,
        lens=RiskLens.BEHAVIOUR,
        entity_id="test_worker_1",
        scenario="stepping_on_carton",
        status=FindingStatus.SUPPORTED,
        band=RiskBand.CRITICAL,
        confidence=ConfidenceLevel.HIGH,
    )
    plan = generate_safe_action_plan(event)

    assert plan.event_id == 1
    assert plan.risk_band == "Critical"
    assert "Step off the carton immediately" in plan.immediate_action
    assert len(plan.steps) >= 2
    assert "Confirm the worker is no longer standing on the carton" in plan.verification
    assert "Cartons are not rated to support human body weight" in plan.reason
    assert plan.evidence_status == "Seen in video"


def test_high_risk_dock_edge_action():
    """High risk dock edge proximity mandates immediate safe clearance."""
    event = RiskEvent(
        event_id=2,
        timestamp=12.5,
        event_type=EventType.NEAR_MISS,
        lens=RiskLens.ENVIRONMENTAL,
        entity_id="test_person_dock",
        scenario="entity_in_dock_edge_zone",
        status=FindingStatus.SUPPORTED,
        band=RiskBand.HIGH,
        confidence=ConfidenceLevel.HIGH,
    )
    plan = generate_safe_action_plan(event)

    assert plan.event_id == 2
    assert plan.risk_band == "High"
    assert "Move at least 2 meters back from the dock edge immediately" in plan.immediate_action
    assert "Confirm all personnel" in plan.verification
    assert "dock edge" in plan.reason.lower()


def test_medium_risk_floor_dragging_action():
    """Medium risk floor dragging advises lifting or wheeled transport."""
    event = RiskEvent(
        event_id=3,
        timestamp=4.2,
        event_type=EventType.RISK,
        lens=RiskLens.BEHAVIOUR,
        entity_id="test_carton_drag",
        scenario="dragging_precursor",
        status=FindingStatus.SUPPORTED,
        band=RiskBand.MEDIUM,
        confidence=ConfidenceLevel.MEDIUM,
    )
    plan = generate_safe_action_plan(event)

    assert plan.event_id == 3
    assert plan.risk_band == "Medium"
    assert "Stop dragging carton across the floor" in plan.immediate_action
    assert any("hand truck or pallet jack" in s for s in plan.steps)
    assert "Floor dragging grinds through carton bottom panels" in plan.reason


def test_insufficient_evidence_never_fabricates_action():
    """When evidence is insufficient, planner mandates supervisor verification."""
    event = RiskEvent(
        event_id=4,
        timestamp=18.0,
        event_type=EventType.RISK,
        lens=RiskLens.STRUCTURAL,
        entity_id="test_carton_ambiguous",
        scenario="box_overhang",
        status=FindingStatus.INSUFFICIENT_EVIDENCE,
        band=RiskBand.HIGH,
        confidence=ConfidenceLevel.LOW,
    )
    plan = generate_safe_action_plan(event)

    assert plan.event_id == 4
    assert "supervisor verification" in plan.immediate_action.lower()
    assert "does not meet confidence threshold" in plan.reason.lower()
    assert plan.evidence_status == "Insufficient evidence"
    assert plan.what_if_eligible is False


def test_unsupported_finding_never_fabricates_action():
    """Unsupported scenarios state TRACE cannot determine condition."""
    event = RiskEvent(
        event_id=5,
        timestamp=0.0,
        event_type=EventType.RISK,
        lens=RiskLens.CONFORMANCE,
        entity_id="test_unknown",
        scenario="product_conformance",
        status=FindingStatus.UNSUPPORTED,
        band=RiskBand.LOW,
        confidence=ConfidenceLevel.LOW,
    )
    plan = generate_safe_action_plan(event)

    assert "supervisor verification" in plan.immediate_action.lower()
    assert plan.evidence_status == "Unsupported"


def test_unmapped_scenario_safe_fallback():
    """Unmapped scenario receives clean, non-crashing safe operational fallback."""
    event = RiskEvent(
        event_id=6,
        timestamp=5.0,
        event_type=EventType.RISK,
        lens=RiskLens.BEHAVIOUR,
        entity_id="test_entity_custom",
        scenario="unregistered_future_hazard",
        status=FindingStatus.SUPPORTED,
        band=RiskBand.MEDIUM,
        confidence=ConfidenceLevel.MEDIUM,
    )
    plan = generate_safe_action_plan(event)

    assert plan.event_id == 6
    assert "Pause operation and inspect the workstation" in plan.immediate_action
    assert "Confirm supervisor has verified handling method" in plan.verification


def test_image_space_support_with_person_class_routes_to_stepping():
    """image_space_support_hypothesis with person supporter/supported routes to stepping action."""
    event = RiskEvent(
        event_id=7,
        timestamp=20.0,
        event_type=EventType.RISK,
        lens=RiskLens.STRUCTURAL,
        entity_id="test_worker_person",
        scenario="image_space_support_hypothesis",
        status=FindingStatus.SUPPORTED,
        band=RiskBand.CRITICAL,
        confidence=ConfidenceLevel.HIGH,
        evidence={"supported_class": "person", "supporter_class": "box"},
    )
    plan = generate_safe_action_plan(event)

    assert "Step off the carton immediately" in plan.immediate_action
    assert "Cartons are not rated to support human body weight" in plan.reason


# ==============================================================================
# 2. REST API Endpoint Tests
# ==============================================================================

def test_api_get_action_plan_existing_event():
    """GET /api/actions/{event_id} retrieves a real action plan for a database event."""
    from backend.db.canonical_seed import sync_canonical_events
    from backend.db.db import get_connection
    conn = get_connection()
    sync_canonical_events(conn)
    conn.close()

    # First query an existing event from /api/events
    res_events = client.get("/api/events?limit=5")
    assert res_events.status_code == 200
    events_data = res_events.json()
    assert len(events_data) > 0

    first_event = events_data[0]
    eid = first_event["event_id"]

    res_action = client.get(f"/api/actions/{eid}")
    assert res_action.status_code == 200
    plan = res_action.json()

    assert plan["event_id"] == eid
    assert "title" in plan
    assert "immediate_action" in plan
    assert len(plan["immediate_action"]) > 5
    assert "verification" in plan
    assert "reason" in plan
    assert "steps" in plan
    assert len(plan["steps"]) >= 1


def test_api_get_action_plan_not_found():
    """GET /api/actions/{event_id} returns 404 for non-existent event."""
    res = client.get("/api/actions/99999999")
    assert res.status_code == 404
    assert "not found" in res.json()["detail"].lower()


def test_api_post_evaluate_action_plan():
    """POST /api/actions/evaluate generates action plan for synthetic parameters."""
    payload = {
        "event_id": 999,
        "video_id": "test_video_dock",
        "timestamp": 15.2,
        "scenario": "straps_as_handles",
        "status": "supported",
        "band": "High",
        "confidence": "High",
    }
    res = client.post("/api/actions/evaluate", json=payload)
    assert res.status_code == 200
    plan = res.json()

    assert plan["event_id"] == 999
    assert "Release packaging straps and grip carton body directly" in plan["immediate_action"]
    assert "Confirm worker is lifting from the package base" in plan["verification"]
    assert "Packaging straps are designed for bundling" in plan["reason"]
