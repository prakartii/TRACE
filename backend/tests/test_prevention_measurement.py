"""Focused tests for TRACE Phase 10: Outcome Verification + Prevention Measurement.

Covers:
1. 3-condition prevention check (ARCHITECTURE.md §5.7 & CLAUDE.md §15)
   - Condition 1: Meaningful risk predicted (status, band, score thresholds)
   - Condition 2: Corrective action observed within response window
   - Condition 3: Subsequent world-model state confirms improved condition
2. Prevention classification (all 3 conditions satisfied -> PREVENTED)
3. Near-miss classification boundaries (high risk + alert + partial/belated correction)
4. Human review gate (confirmed damage takes precedence, never auto-declared)
5. Epistemic honesty (no evidence != success; missing data -> outcome unclear)
6. Outcome measurement ledger persistence and deduplication
7. Prevention summary 3-bucket counters (Prevented, Near-miss, Unclear/Damage)
8. REST API endpoints (/api/measurement/*)
"""

from __future__ import annotations

import sqlite3
import time
import pytest
from fastapi.testclient import TestClient

from backend.api.videos import get_registry
from backend.contracts.models import (
    ActionRecommendation,
    ConfidenceLevel,
    EventType,
    FindingStatus,
    OutcomeMeasurement,
    PreventionClassification,
    PreventionSummary,
    RiskBand,
    RiskEvent,
    RiskLens,
)
from backend.db.db import ensure_schema_migrations, get_connection, init_db
from backend.db.events import get_event_by_id, persist_findings
from backend.db.outcomes import (
    get_outcome_by_event_id,
    get_prevention_summary,
    list_outcomes,
    save_outcome_measurement,
)
from backend.main import app
from backend.measurement.nearmiss import evaluate_near_miss
from backend.measurement.prevention import (
    DEFAULT_RESPONSE_WINDOW_SEC,
    check_condition_1_risk_predicted,
    check_condition_2_action_observed,
    check_condition_3_state_improved,
    evaluate_prevention,
)
from backend.tests.video_test_fixtures import make_test_video
from backend.video.registry import VideoRegistry


@pytest.fixture
def test_db(tmp_path):
    """Temporary SQLite database initialized with schema and migrations."""
    db_file = tmp_path / "test_measurement.db"
    conn = get_connection(db_file)
    init_db(conn)
    yield conn
    conn.close()


@pytest.fixture
def mock_registry(tmp_path):
    """Registry with a primary video for testing."""
    orig_path = tmp_path / "cargo_handling_cam1.mp4"
    make_test_video(orig_path, frame_count=10, seed=42)
    reg = VideoRegistry(video_dir=tmp_path)
    reg.refresh()
    return reg


@pytest.fixture
def client(mock_registry, test_db):
    """FastAPI TestClient with overridden registry and database dependencies."""
    from backend.db.db import get_db

    app.dependency_overrides[get_registry] = lambda: mock_registry
    app.dependency_overrides[get_db] = lambda: test_db
    with TestClient(app) as test_client:
        yield test_client
    app.dependency_overrides.clear()


def make_sample_risk_event(
    event_id: int = 1,
    video_id: str = "test_vid",
    timestamp: float = 1.0,
    band: RiskBand = RiskBand.HIGH,
    score: float = 80.0,
    status: FindingStatus = FindingStatus.SUPPORTED,
    scenario: str = "box_overhang",
    review_status: str | None = None,
) -> RiskEvent:
    rec = ActionRecommendation(
        scenario_key=scenario,
        status=status,
        confidence=ConfidenceLevel.HIGH,
        action="Re-center carton within supporting footprint.",
        rationale="Overhang creates tipping hazard.",
        basis="Overlap ratio < 75%",
        what_if_eligible=True,
        risk_title="Box Overhang Cantilever",
    )
    return RiskEvent(
        event_id=event_id,
        video_id=video_id,
        timestamp=timestamp,
        event_type=EventType.RISK,
        lens=RiskLens.STRUCTURAL,
        entity_id="box:1",
        score=score,
        band=band,
        confidence=ConfidenceLevel.HIGH,
        status=status,
        scenario=scenario,
        entities=["box:1", "pallet:1"],
        evidence={"overlap_ratio": 0.55},
        explanation="Box 1 has 55% base overlap.",
        planner_recommendation=rec,
        reviewed=bool(review_status),
        review_status=review_status,
    )


# =========================================================================
# 1. Condition 1 Tests: Meaningful Risk Predicted
# =========================================================================

def test_condition_1_satisfied_on_high_supported():
    ev = make_sample_risk_event(band=RiskBand.HIGH, score=85.0, status=FindingStatus.SUPPORTED)
    res = check_condition_1_risk_predicted(ev)
    assert res.satisfied is True
    assert res.condition_number == 1
    assert "VERIFIED" in res.description.upper() or "PREDICTED" in res.description.upper()


def test_condition_1_satisfied_on_medium_probable():
    ev = make_sample_risk_event(band=RiskBand.MEDIUM, score=55.0, status=FindingStatus.PROBABLE)
    res = check_condition_1_risk_predicted(ev)
    assert res.satisfied is True


def test_condition_1_fails_on_insufficient_evidence():
    ev = make_sample_risk_event(band=RiskBand.HIGH, score=85.0, status=FindingStatus.INSUFFICIENT_EVIDENCE)
    res = check_condition_1_risk_predicted(ev)
    assert res.satisfied is False
    assert "insufficient_evidence_status" in res.limitations


def test_condition_1_fails_on_unsupported_scenario():
    ev = make_sample_risk_event(band=RiskBand.LOW, score=20.0, status=FindingStatus.UNSUPPORTED)
    res = check_condition_1_risk_predicted(ev)
    assert res.satisfied is False


def test_condition_1_fails_on_low_severity_score():
    ev = make_sample_risk_event(band=RiskBand.LOW, score=25.0, status=FindingStatus.SUPPORTED)
    res = check_condition_1_risk_predicted(ev)
    assert res.satisfied is False
    assert "risk_severity_below_threshold" in res.limitations


# =========================================================================
# 2. Condition 2 Tests: Corrective Action Within Window
# =========================================================================

def test_condition_2_satisfied_within_window():
    ev = make_sample_risk_event(timestamp=2.0)
    post_data = {
        "action_observed": True,
        "action_timestamp": 4.5,  # +2.5s, within 5.0s window
        "action_type": "reposition_carton",
        "followed_recommendation": True,
    }
    res = check_condition_2_action_observed(ev, post_data, response_window_sec=5.0)
    assert res.satisfied is True
    assert res.evidence["elapsed_sec"] == 2.5


def test_condition_2_fails_when_action_outside_window():
    ev = make_sample_risk_event(timestamp=2.0)
    post_data = {
        "action_observed": True,
        "action_timestamp": 9.5,  # +7.5s, exceeds 5.0s window
        "action_type": "reposition_carton",
    }
    res = check_condition_2_action_observed(ev, post_data, response_window_sec=5.0)
    assert res.satisfied is False
    assert "correction_outside_window" in res.limitations


def test_condition_2_fails_when_no_action_observed():
    ev = make_sample_risk_event(timestamp=2.0)
    post_data = {
        "action_observed": False,
        "followed_recommendation": False,
    }
    res = check_condition_2_action_observed(ev, post_data)
    assert res.satisfied is False
    assert "no_corrective_action_detected" in res.limitations


def test_condition_2_fails_when_no_post_data_available():
    ev = make_sample_risk_event(timestamp=2.0)
    res = check_condition_2_action_observed(ev, post_event_data=None)
    assert res.satisfied is False
    assert "no_post_event_observation_data" in res.limitations


# =========================================================================
# 3. Condition 3 Tests: Subsequent State Confirms Improved Condition
# =========================================================================

def test_condition_3_satisfied_when_risk_resolved():
    ev = make_sample_risk_event(score=80.0)
    post_data = {
        "risk_resolved": True,
        "outcome_score": 0.0,
        "outcome_band": "Low",
    }
    res = check_condition_3_state_improved(ev, post_data)
    assert res.satisfied is True


def test_condition_3_satisfied_when_score_substantially_reduced():
    ev = make_sample_risk_event(score=85.0, band=RiskBand.HIGH)
    post_data = {
        "outcome_score": 30.0,  # delta = -55.0 <= -15.0
        "outcome_band": "Low",
    }
    res = check_condition_3_state_improved(ev, post_data)
    assert res.satisfied is True
    assert res.evidence["score_delta"] == -55.0


def test_condition_3_fails_when_improvement_is_only_marginal():
    ev = make_sample_risk_event(score=85.0, band=RiskBand.HIGH)
    post_data = {
        "outcome_score": 80.0,  # delta = -5.0, marginal
        "outcome_band": "High",
        "marginal_improvement": True,
    }
    res = check_condition_3_state_improved(ev, post_data)
    assert res.satisfied is False
    assert "marginal_improvement" in res.limitations


def test_condition_3_fails_when_score_worsened():
    ev = make_sample_risk_event(score=60.0)
    post_data = {
        "outcome_score": 75.0,  # delta = +15.0
        "outcome_band": "Critical",
    }
    res = check_condition_3_state_improved(ev, post_data)
    assert res.satisfied is False
    assert "risk_score_worsened_or_unchanged" in res.limitations


def test_condition_3_fails_when_post_state_unobserved():
    ev = make_sample_risk_event()
    res = check_condition_3_state_improved(ev, post_event_data=None)
    assert res.satisfied is False
    assert "no_post_state_re_evaluation" in res.limitations


# =========================================================================
# 4. 3-Condition Prevention Evaluation & Classification
# =========================================================================

def test_evaluation_all_conditions_satisfied_yields_prevented():
    ev = make_sample_risk_event(timestamp=1.0, score=85.0, band=RiskBand.HIGH, status=FindingStatus.SUPPORTED)
    post_data = {
        "action_observed": True,
        "action_timestamp": 3.0,  # delta = 2.0s <= 5.0s
        "risk_resolved": True,
        "outcome_score": 0.0,
        "outcome_band": "Low",
        "followed_recommendation": True,
    }
    meas = evaluate_prevention(ev, post_data, response_window_sec=5.0)

    assert meas.classification == PreventionClassification.PREVENTED
    assert meas.three_condition_check.all_satisfied is True
    assert meas.three_condition_check.condition_1_risk_predicted.satisfied is True
    assert meas.three_condition_check.condition_2_action_observed.satisfied is True
    assert meas.three_condition_check.condition_3_state_improved.satisfied is True


def test_evaluation_near_miss_when_correction_outside_window():
    """High risk + alert fired + correction happened outside window -> NEAR_MISS (ARCHITECTURE.md §5.7)."""
    ev = make_sample_risk_event(timestamp=1.0, score=85.0, band=RiskBand.HIGH, status=FindingStatus.SUPPORTED)
    post_data = {
        "action_observed": True,
        "action_timestamp": 8.0,  # delta = 7.0s > 5.0s window
        "risk_resolved": True,
        "outcome_score": 0.0,
    }
    meas = evaluate_prevention(ev, post_data, response_window_sec=5.0)

    assert meas.classification == PreventionClassification.NEAR_MISS
    assert meas.three_condition_check.all_satisfied is False
    assert meas.three_condition_check.condition_2_action_observed.satisfied is False


def test_evaluation_near_miss_when_improvement_marginal():
    """High risk + alert fired + correction in window but marginal improvement -> NEAR_MISS."""
    ev = make_sample_risk_event(timestamp=1.0, score=85.0, band=RiskBand.HIGH, status=FindingStatus.SUPPORTED)
    post_data = {
        "action_observed": True,
        "action_timestamp": 2.5,
        "outcome_score": 80.0,
        "marginal_improvement": True,
    }
    meas = evaluate_prevention(ev, post_data, response_window_sec=5.0)

    assert meas.classification == PreventionClassification.NEAR_MISS
    assert meas.three_condition_check.all_satisfied is False
    assert meas.three_condition_check.condition_3_state_improved.satisfied is False


def test_evaluation_outcome_unclear_when_no_post_data():
    """Missing post-action evidence results in OUTCOME_UNCLEAR (no evidence != success)."""
    ev = make_sample_risk_event(timestamp=1.0, score=85.0, band=RiskBand.HIGH)
    meas = evaluate_prevention(ev, post_event_data=None)

    assert meas.classification == PreventionClassification.OUTCOME_UNCLEAR
    assert meas.three_condition_check.all_satisfied is False
    assert "no_post_event_observation_data" in meas.limitations


def test_evaluation_confirmed_damage_takes_precedence():
    """Human-confirmed damage overrides automated conditions (never self-assigned, CLAUDE.md §15)."""
    ev = make_sample_risk_event(review_status="confirmed_damage")
    post_data = {
        "action_observed": True,
        "action_timestamp": 2.0,
        "risk_resolved": True,
    }
    meas = evaluate_prevention(ev, post_data, human_review_status="confirmed_damage")

    assert meas.classification == PreventionClassification.CONFIRMED_DAMAGE
    assert "confirmed damage" in meas.explanation.lower()


# =========================================================================
# 5. Database Ledger & Deduplication Tests
# =========================================================================

def test_outcome_ledger_persistence_and_retrieval(test_db):
    ev = make_sample_risk_event(event_id=101, video_id="video_abc")
    persist_findings([ev], "video_abc", "video_abc", 1.0, test_db)

    post_data = {
        "action_observed": True,
        "action_timestamp": 2.5,
        "risk_resolved": True,
        "outcome_score": 0.0,
        "outcome_band": "Low",
        "followed_recommendation": True,
    }
    meas = evaluate_prevention(ev, post_data)
    saved = save_outcome_measurement(meas, test_db)

    assert saved.outcome_id is not None
    assert saved.classification == PreventionClassification.PREVENTED

    fetched = get_outcome_by_event_id(ev.event_id, test_db)
    assert fetched is not None
    assert fetched.event_id == ev.event_id
    assert fetched.classification == PreventionClassification.PREVENTED
    assert fetched.three_condition_check.all_satisfied is True
    assert fetched.three_condition_check.condition_1_risk_predicted.satisfied is True

    # Check that events table was updated with event_type = 'prevented'
    updated_ev = get_event_by_id(test_db, ev.event_id)
    assert updated_ev.event_type.value == "prevented"


def test_outcome_ledger_idempotency_prevents_duplicates(test_db):
    ev = make_sample_risk_event(event_id=102, video_id="video_abc")
    persist_findings([ev], "video_abc", "video_abc", 1.0, test_db)

    meas = evaluate_prevention(ev, None)
    saved1 = save_outcome_measurement(meas, test_db)
    saved2 = save_outcome_measurement(meas, test_db)

    assert saved1.outcome_id == saved2.outcome_id

    cur = test_db.cursor()
    cur.execute("SELECT COUNT(*) FROM outcome_measurements WHERE event_id = ?", (ev.event_id,))
    assert cur.fetchone()[0] == 1


def test_prevention_summary_counters(test_db):
    """Verifies the three distinct counters specified in ARCHITECTURE.md §5.7 & Screen 6."""
    # 1. Prevented event
    ev1 = make_sample_risk_event(event_id=201, video_id="v1", score=80.0, band=RiskBand.HIGH)
    persist_findings([ev1], "v1", "v1", 1.0, test_db)
    meas1 = evaluate_prevention(ev1, {"action_observed": True, "action_timestamp": 2.0, "risk_resolved": True})
    save_outcome_measurement(meas1, test_db)

    # 2. Near-miss event
    ev2 = make_sample_risk_event(event_id=202, video_id="v1", score=75.0, band=RiskBand.HIGH)
    persist_findings([ev2], "v1", "v1", 2.0, test_db)
    meas2 = evaluate_prevention(ev2, {"action_observed": True, "action_timestamp": 8.0, "risk_resolved": True}) # outside window
    save_outcome_measurement(meas2, test_db)

    # 3. Outcome unclear event
    ev3 = make_sample_risk_event(event_id=203, video_id="v1", score=70.0, band=RiskBand.HIGH)
    persist_findings([ev3], "v1", "v1", 3.0, test_db)
    meas3 = evaluate_prevention(ev3, None)
    save_outcome_measurement(meas3, test_db)

    # 4. Confirmed damage event
    ev4 = make_sample_risk_event(event_id=204, video_id="v1", review_status="confirmed_damage")
    persist_findings([ev4], "v1", "v1", 4.0, test_db)
    meas4 = evaluate_prevention(ev4, None, human_review_status="confirmed_damage")
    save_outcome_measurement(meas4, test_db)

    summary = get_prevention_summary(test_db)
    assert summary.total_evaluated == 4
    assert summary.prevented_count == 1
    assert summary.near_miss_count == 1
    assert summary.outcome_unclear_count == 1
    assert summary.confirmed_damage_count == 1
    assert "structural" in summary.by_lens


# =========================================================================
# 6. REST API Endpoints Tests
# =========================================================================

def test_api_get_outcome_unverified_baseline(client, test_db, mock_registry):
    video = mock_registry.list_videos()[0]
    ev = make_sample_risk_event(event_id=301, video_id=video.id)
    persist_findings([ev], video.id, video.id, 1.0, test_db)

    res = client.get(f"/api/measurement/events/{ev.event_id}/outcome")
    assert res.status_code == 200
    data = res.json()
    assert data["event_id"] == ev.event_id
    assert data["classification"] in ("outcome_unclear", "prevented", "near_miss")
    assert "three_condition_check" in data
    assert "condition_1_risk_predicted" in data["three_condition_check"]


def test_api_get_outcome_event_not_found(client):
    res = client.get("/api/measurement/events/999999/outcome")
    assert res.status_code == 404
    assert "not found" in res.json()["detail"].lower()


def test_api_get_summary(client, test_db, mock_registry):
    video = mock_registry.list_videos()[0]
    ev = make_sample_risk_event(event_id=401, video_id=video.id)
    persist_findings([ev], video.id, video.id, 1.0, test_db)
    meas = evaluate_prevention(ev, {"action_observed": True, "action_timestamp": 2.0, "risk_resolved": True})
    save_outcome_measurement(meas, test_db)

    res = client.get("/api/measurement/summary")
    assert res.status_code == 200
    data = res.json()
    assert data["total_evaluated"] >= 1
    assert "prevented_count" in data
    assert "near_miss_count" in data
    assert "outcome_unclear_count" in data
    assert "confirmed_damage_count" in data


def test_api_list_outcomes_with_filter(client, test_db, mock_registry):
    video = mock_registry.list_videos()[0]
    ev = make_sample_risk_event(event_id=501, video_id=video.id)
    persist_findings([ev], video.id, video.id, 1.0, test_db)
    meas = evaluate_prevention(ev, {"action_observed": True, "action_timestamp": 2.0, "risk_resolved": True})
    save_outcome_measurement(meas, test_db)

    res = client.get(f"/api/measurement/outcomes?classification=prevented")
    assert res.status_code == 200
    items = res.json()
    assert len(items) >= 1
    assert items[0]["classification"] == "prevented"
