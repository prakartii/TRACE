"""Tests for Phase 9.1 Event Persistence, API, Deduplication, and Responsible AI Review."""

import sqlite3
import pytest
from fastapi.testclient import TestClient

import backend.api.perception as perception_api
from backend.api.videos import get_registry
from backend.contracts.models import (
    ActionRecommendation,
    ConfidenceLevel,
    EventType,
    FindingStatus,
    RiskBand,
    RiskEvent,
    RiskLens,
)
from backend.db.db import get_connection, get_db, init_db
from backend.db.events import (
    get_event_by_id,
    make_dedup_key,
    persist_findings,
    query_events,
    review_event,
)
from backend.main import app
from backend.perception.config import PerceptionConfig
from backend.perception.detector import RawDetection
from backend.perception.pipeline import PerceptionPipeline
from backend.tests.perception_test_fixtures import ScriptedDetector
from backend.tests.video_test_fixtures import make_test_video
from backend.video.registry import VideoRegistry


@pytest.fixture
def test_db(tmp_path):
    db_file = tmp_path / "test_events.db"
    conn = get_connection(db_file)
    init_db(conn)
    yield conn
    conn.close()


def _sample_finding(
    scenario="stepping_on_carton",
    status=FindingStatus.SUPPORTED,
    confidence=ConfidenceLevel.HIGH,
    entity_id="box:1",
    lens=RiskLens.STRUCTURAL,
    band=RiskBand.HIGH,
    score=82.0,
):
    action_rec = ActionRecommendation(
        scenario_key=scenario,
        status=status,
        confidence=confidence,
        action="Immediate precaution: Clear weight from carton",
        rationale="Packaging collapse hazard",
        basis="Observed overlap > 60%",
        limitations=["image_space_only"],
        what_if_eligible=False,
    )
    return RiskEvent(
        timestamp=1.5,
        event_type=EventType.RISK,
        lens=lens,
        entity_id=entity_id,
        score=score,
        band=band,
        confidence=confidence,
        status=status,
        scenario=scenario,
        entities=["person:1", entity_id],
        evidence={"overlap_ratio": 0.72},
        explanation="Worker stepping on carton",
        recommended_action="Clear weight from carton",
        limitations=["image_space_only"],
        planner_recommendation=action_rec,
    )


def test_make_dedup_key_is_deterministic():
    k1 = make_dedup_key("vid123", "stepping_on_carton", 1.5004, "box:1")
    k2 = make_dedup_key("vid123", "stepping_on_carton", 1.5001, "box:1")
    assert k1 == k2
    assert k1 == "vid123:stepping_on_carton:1.500:box:1"


def test_event_creation_and_persistence_from_valid_finding(test_db):
    finding = _sample_finding()
    persist_findings([finding], video_id="vid1", canonical_id="vid1", timestamp=1.5, conn=test_db)

    assert finding.event_id is not None
    assert finding.video_id == "vid1"

    row = test_db.execute("SELECT * FROM events WHERE event_id = ?", (finding.event_id,)).fetchone()
    assert row is not None
    assert row["video_id"] == "vid1"
    assert row["scenario"] == "stepping_on_carton"
    assert row["status"] == "supported"
    assert row["lens"] == "structural"
    assert row["score"] == 82.0
    assert row["band"] == "High"
    assert row["confidence"] == "High"
    assert row["reviewed"] == 0
    assert row["review_status"] is None


def test_duplicate_event_prevention_on_repeated_scrubbing(test_db):
    finding1 = _sample_finding()
    persist_findings([finding1], video_id="vid1", canonical_id="vid1", timestamp=1.5, conn=test_db)
    ev_id1 = finding1.event_id

    # Simulate scrubbing back and forth to the same frame
    finding2 = _sample_finding()
    persist_findings([finding2], video_id="vid1", canonical_id="vid1", timestamp=1.5002, conn=test_db)
    ev_id2 = finding2.event_id

    assert ev_id1 == ev_id2
    total_count = test_db.execute("SELECT COUNT(*) FROM events").fetchone()[0]
    assert total_count == 1


def test_event_retrieval_and_filtering(test_db):
    f1 = _sample_finding(scenario="stepping_on_carton", lens=RiskLens.STRUCTURAL, status=FindingStatus.SUPPORTED, band=RiskBand.HIGH)
    f2 = _sample_finding(scenario="carton_drop", lens=RiskLens.BEHAVIOUR, status=FindingStatus.PROBABLE, band=RiskBand.MEDIUM)
    f3 = _sample_finding(scenario="dock_gap", lens=RiskLens.ENVIRONMENTAL, status=FindingStatus.INSUFFICIENT_EVIDENCE, band=RiskBand.LOW)

    persist_findings([f1], video_id="vid1", canonical_id="vid1", timestamp=1.0, conn=test_db)
    persist_findings([f2], video_id="vid1", canonical_id="vid1", timestamp=2.0, conn=test_db)
    persist_findings([f3], video_id="vid2", canonical_id="vid2", timestamp=3.0, conn=test_db)

    # Filter by video_id
    res_vid1 = query_events(test_db, video_id="vid1")
    assert len(res_vid1) == 2

    # Filter by lens
    res_struct = query_events(test_db, lens="structural")
    assert len(res_struct) == 1
    assert res_struct[0].scenario == "stepping_on_carton"

    # Filter by status
    res_supp = query_events(test_db, status="supported")
    assert len(res_supp) == 1
    assert res_supp[0].status == FindingStatus.SUPPORTED

    # Filter by band
    res_high = query_events(test_db, band="High")
    assert len(res_high) == 1

    # Pagination
    paged = query_events(test_db, limit=1, offset=0)
    assert len(paged) == 1


def test_event_detail_retrieval_and_planner_linkage(test_db):
    finding = _sample_finding()
    persist_findings([finding], video_id="vid1", canonical_id="vid1", timestamp=1.5, conn=test_db)

    retrieved = get_event_by_id(test_db, finding.event_id)
    assert retrieved is not None
    assert retrieved.event_id == finding.event_id
    assert retrieved.planner_recommendation is not None
    assert retrieved.planner_recommendation.action == "Immediate precaution: Clear weight from carton"
    assert retrieved.planner_recommendation.status == FindingStatus.SUPPORTED


def test_unsupported_insufficient_findings_remain_epistemically_honest(test_db):
    finding = _sample_finding(
        scenario="image_space_support_hypothesis",
        status=FindingStatus.INSUFFICIENT_EVIDENCE,
        confidence=ConfidenceLevel.LOW,
    )
    finding.limitations = ["image_space_only", "no_box_detected"]
    persist_findings([finding], video_id="vid1", canonical_id="vid1", timestamp=1.0, conn=test_db)

    retrieved = get_event_by_id(test_db, finding.event_id)
    assert retrieved.status == FindingStatus.INSUFFICIENT_EVIDENCE
    assert retrieved.confidence == ConfidenceLevel.LOW
    assert "no_box_detected" in retrieved.limitations


def test_review_feedback_flow(test_db):
    finding = _sample_finding()
    persist_findings([finding], video_id="vid1", canonical_id="vid1", timestamp=1.5, conn=test_db)
    ev_id = finding.event_id

    # Review as false positive
    updated = review_event(test_db, ev_id, review_status="false_positive", notes="Lighting shadow error")
    assert updated.reviewed is True
    assert updated.review_status == "false_positive"

    # Feedback table row created
    fb_row = test_db.execute("SELECT * FROM feedback WHERE event_id = ?", (ev_id,)).fetchone()
    assert fb_row is not None
    assert fb_row["flag_type"] == "false_positive"

    # Review as confirmed damage
    updated2 = review_event(test_db, ev_id, review_status="confirmed_damage")
    assert updated2.reviewed is True
    assert updated2.review_status == "confirmed_damage"


def test_api_events_endpoints(tmp_path):
    db_file = tmp_path / "api_test.db"
    conn = get_connection(db_file)
    init_db(conn)

    app.dependency_overrides[get_db] = lambda: conn
    try:
        client = TestClient(app)

        # Empty list initially
        resp = client.get("/api/events")
        assert resp.status_code == 200
        assert resp.json() == []

        # Persist an event
        finding = _sample_finding()
        persist_findings([finding], video_id="vid_test", canonical_id="vid_test", timestamp=2.0, conn=conn)

        # Query list
        resp = client.get("/api/events")
        assert resp.status_code == 200
        data = resp.json()
        assert len(data) == 1
        assert data[0]["event_id"] == finding.event_id

        # Query detail
        resp_detail = client.get(f"/api/events/{finding.event_id}")
        assert resp_detail.status_code == 200
        assert resp_detail.json()["scenario"] == "stepping_on_carton"
        assert resp_detail.json()["planner_recommendation"] is not None

        # Detail 404
        resp_404 = client.get("/api/events/999999")
        assert resp_404.status_code == 404

        # Review event
        rev_resp = client.post(
            f"/api/events/{finding.event_id}/review",
            json={"review_status": "false_positive", "notes": "Angle misleading"},
        )
        assert rev_resp.status_code == 200
        assert rev_resp.json()["reviewed"] is True
        assert rev_resp.json()["review_status"] == "false_positive"

        # Invalid review status rejected
        bad_resp = client.post(
            f"/api/events/{finding.event_id}/review",
            json={"review_status": "totally_invalid"},
        )
        assert bad_resp.status_code == 422
    finally:
        app.dependency_overrides.pop(get_db, None)
        conn.close()


def test_findings_endpoint_persists_events_as_side_effect(tmp_path):
    make_test_video(tmp_path / "clip.mp4", frame_count=20, fps=10.0, width=1000, height=1000)
    registry = VideoRegistry(video_dir=tmp_path)
    db_file = tmp_path / "findings_side_effect.db"
    conn = get_connection(db_file)
    init_db(conn)

    scripted = [[RawDetection("person", 0.95, 100, 100, 200, 300)] for _ in range(5)]
    pipeline = PerceptionPipeline(
        config=PerceptionConfig(default_sample_fps=2.0, max_samples_per_run=20),
        detector=ScriptedDetector(scripted),
    )

    app.dependency_overrides[get_registry] = lambda: registry
    app.dependency_overrides[perception_api.get_pipeline_registry] = lambda: {"stock": pipeline, "pilot": pipeline}
    app.dependency_overrides[get_db] = lambda: conn
    try:
        client = TestClient(app)
        video_id = client.get("/api/videos").json()[0]["id"]

        resp = client.get(f"/api/videos/{video_id}/findings", params={"timestamp": 0.0})
        assert resp.status_code == 200
        findings = resp.json()
        assert len(findings) > 0

        # Verify events were persisted to DB
        events_resp = client.get("/api/events")
        assert events_resp.status_code == 200
        events_data = events_resp.json()
        assert len(events_data) > 0
        assert events_data[0]["video_id"] == video_id
    finally:
        app.dependency_overrides.pop(get_registry, None)
        app.dependency_overrides.pop(perception_api.get_pipeline_registry, None)
        app.dependency_overrides.pop(get_db, None)
        conn.close()


def test_persistence_failure_gracefully_preserves_findings_response(tmp_path, monkeypatch):
    make_test_video(tmp_path / "clip.mp4", frame_count=20, fps=10.0, width=1000, height=1000)
    registry = VideoRegistry(video_dir=tmp_path)

    scripted = [[RawDetection("person", 0.95, 100, 100, 200, 300)] for _ in range(5)]
    pipeline = PerceptionPipeline(
        config=PerceptionConfig(default_sample_fps=2.0, max_samples_per_run=20),
        detector=ScriptedDetector(scripted),
    )

    app.dependency_overrides[get_registry] = lambda: registry
    app.dependency_overrides[perception_api.get_pipeline_registry] = lambda: {"stock": pipeline, "pilot": pipeline}

    # Simulate DB failure during persist_findings
    import backend.api.findings as findings_mod
    def broken_persist(*args, **kwargs):
        raise sqlite3.OperationalError("Simulated disk I/O failure")

    monkeypatch.setattr(findings_mod, "persist_findings", broken_persist)
    try:
        client = TestClient(app)
        video_id = client.get("/api/videos").json()[0]["id"]

        # Even with persistence failure, findings API returns 200 with valid findings
        resp = client.get(f"/api/videos/{video_id}/findings", params={"timestamp": 0.0})
        assert resp.status_code == 200
        findings = resp.json()
        assert len(findings) > 0
    finally:
        app.dependency_overrides.pop(get_registry, None)
        app.dependency_overrides.pop(perception_api.get_pipeline_registry, None)

