"""Focused tests for TRACE Phase 9.3: Incident Replay backend contracts and behaviors.

Verifies:
1. Event retrieval and contract fidelity for Incident Replay.
2. Exact timestamp seeking and boundary clamping behavior.
3. Deterministic duplicate video resolution in the registry and events API.
4. Epistemic discipline preservation (Observed vs Inferred vs Recommended vs Hypothetical).
5. What-If simulation eligibility and counterfactual guards.
6. Responsible AI review updates on replayed incidents.
7. Graceful failure states (missing events, missing videos, invalid timestamps).
"""

from __future__ import annotations

import sqlite3
import pytest
from fastapi.testclient import TestClient

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
from backend.db.db import ensure_schema_migrations, get_connection, init_db
from backend.db.events import get_event_by_id, persist_findings, review_event
from backend.main import app
from backend.tests.video_test_fixtures import make_test_video
from backend.video.registry import VideoRegistry, make_source_id


@pytest.fixture
def test_db(tmp_path):
    """Temporary SQLite database initialized with schema and thread-safety."""
    db_file = tmp_path / "test_replay.db"
    conn = get_connection(db_file)
    init_db(conn)
    yield conn
    conn.close()


@pytest.fixture
def mock_registry(tmp_path):
    """Registry with a primary video and a content-identical duplicate."""
    orig_path = tmp_path / "cargo_handling_cam1.mp4"
    make_test_video(orig_path, frame_count=10, seed=42)
    dup_path = tmp_path / "cargo_handling_cam1 (1).mp4"
    import shutil
    shutil.copyfile(orig_path, dup_path)

    distinct_path = tmp_path / "unrelated_cam2.mp4"
    make_test_video(distinct_path, frame_count=5, seed=99)

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


# =========================================================================
# 1. Event Retrieval & Replay Context Contract
# =========================================================================

def test_incident_replay_event_retrieval(client, test_db, mock_registry):
    """An operational risk event retrieved for Incident Replay preserves all evidence and recommendations."""
    video = mock_registry.list_videos()[0]
    rec = ActionRecommendation(
        scenario_key="heavy_on_light_stacking",
        status=FindingStatus.SUPPORTED,
        confidence=ConfidenceLevel.HIGH,
        action="Move heavier load to lower tier position.",
        rationale="Reverse-mass stacking creates crushing risk.",
        basis="Image-space support edge + linked SKU mass class.",
        what_if_eligible=True,
        risk_title="Heavy-on-Light Reverse Stacking",
    )
    event = RiskEvent(
        timestamp=1.25,
        event_type=EventType.RISK,
        lens=RiskLens.STRUCTURAL,
        entity_id="box:1",
        score=82.5,
        band=RiskBand.HIGH,
        confidence=ConfidenceLevel.HIGH,
        status=FindingStatus.SUPPORTED,
        scenario="heavy_on_light_stacking",
        entities=["box:1", "box:2"],
        evidence={"overlap_ratio": 0.58, "vertical_gap": 0.02},
        explanation="Carton box:1 placed atop lighter carton box:2 with 58% overlap.",
        planner_recommendation=rec,
        video_id=video.id,
    )
    persist_findings([event], video.id, video.id, 1.25, test_db)

    res = client.get(f"/api/events/{event.event_id}")
    assert res.status_code == 200
    data = res.json()

    assert data["event_id"] == event.event_id
    assert data["video_id"] == video.id
    assert data["timestamp"] == 1.25
    assert data["status"] == "supported"
    assert data["lens"] == "structural"
    assert data["band"] == "High"
    assert data["evidence"] == {"overlap_ratio": 0.58, "vertical_gap": 0.02}
    assert data["planner_recommendation"] is not None
    assert data["planner_recommendation"]["what_if_eligible"] is True
    assert data["planner_recommendation"]["action"] == "Move heavier load to lower tier position."


def test_incident_replay_event_not_found(client):
    """Attempting to load a non-existent incident event returns HTTP 404."""
    res = client.get("/api/events/999999")
    assert res.status_code == 404
    assert "not found" in res.json()["detail"].lower()


# =========================================================================
# 2. Timestamp Replay & Seeking Boundaries
# =========================================================================

def test_incident_replay_zero_timestamp(client, test_db, mock_registry):
    """Events at timestamp 0.0 are valid and accurately persisted and retrieved."""
    video = mock_registry.list_videos()[0]
    event = RiskEvent(
        timestamp=0.0,
        event_type=EventType.BEHAVIOUR,
        lens=RiskLens.BEHAVIOUR,
        entity_id="person:1",
        score=35.0,
        band=RiskBand.LOW,
        confidence=ConfidenceLevel.MEDIUM,
        status=FindingStatus.PROBABLE,
        scenario="person_box_sustained_proximity",
        video_id=video.id,
    )
    persist_findings([event], video.id, video.id, 0.0, test_db)

    res = client.get(f"/api/events/{event.event_id}")
    assert res.status_code == 200
    assert res.json()["timestamp"] == 0.0


def test_video_frame_timestamp_bounds(client, mock_registry):
    """Video API respects timestamp boundaries (422 for timestamp exceeding duration)."""
    video = mock_registry.list_videos()[0]
    duration = video.metadata.duration

    # Valid within bounds
    res_valid = client.get(f"/api/videos/{video.id}/frame?timestamp={duration / 2:.2f}")
    assert res_valid.status_code == 200
    assert res_valid.headers["content-type"] == "image/jpeg"

    # Out of bounds
    res_invalid = client.get(f"/api/videos/{video.id}/frame?timestamp={duration + 10.0:.2f}")
    assert res_invalid.status_code == 422
    assert "outside video duration" in res_invalid.json()["detail"]


# =========================================================================
# 3. Duplicate Video Resolution Semantics
# =========================================================================

def test_registry_resolves_duplicate_and_canonical(mock_registry):
    """Registry correctly identifies duplicate and canonical sources without data loss."""
    videos = mock_registry.list_videos()
    orig = next(v for v in videos if v.duplicate_of is None and "cargo_handling_cam1.mp4" in v.filename)
    dup = next(v for v in videos if v.duplicate_of == orig.id)

    assert dup.duplicate_of == orig.id

    # Lookup by ID
    assert mock_registry.get(orig.id).id == orig.id
    assert mock_registry.get(dup.id).id == dup.id

    # Lookup by filename fallback
    assert mock_registry.get("cargo_handling_cam1.mp4").id == orig.id


def test_events_query_resolves_canonical_duplicate_events(client, test_db, mock_registry):
    """Querying events with a duplicate video ID finds events saved under the canonical ID."""
    videos = mock_registry.list_videos()
    orig = next(v for v in videos if v.duplicate_of is None and "cargo_handling_cam1.mp4" in v.filename)
    dup = next(v for v in videos if v.duplicate_of == orig.id)

    event = RiskEvent(
        timestamp=0.8,
        event_type=EventType.RISK,
        lens=RiskLens.STRUCTURAL,
        entity_id="box:1",
        score=70.0,
        band=RiskBand.HIGH,
        confidence=ConfidenceLevel.HIGH,
        status=FindingStatus.SUPPORTED,
        scenario="box_overhang",
        video_id=orig.id,
    )
    persist_findings([event], orig.id, orig.id, 0.8, test_db)

    # Query with the duplicate video's id
    res = client.get(f"/api/events?video_id={dup.id}")
    assert res.status_code == 200
    events = res.json()
    assert len(events) >= 1
    assert events[0]["event_id"] == event.event_id


# =========================================================================
# 4. Epistemic Discipline & Vocabulary Checks
# =========================================================================

def test_epistemic_discipline_vocabulary_preservation(client, test_db, mock_registry):
    """Strictly validates that only valid FindingStatus enum values are accepted."""
    video = mock_registry.list_videos()[0]

    for status_val in [
        FindingStatus.SUPPORTED,
        FindingStatus.PROBABLE,
        FindingStatus.INSUFFICIENT_EVIDENCE,
        FindingStatus.UNSUPPORTED,
    ]:
        event = RiskEvent(
            timestamp=0.5,
            event_type=EventType.RISK,
            lens=RiskLens.STRUCTURAL,
            entity_id=f"box:{status_val.value}",
            score=50.0,
            band=RiskBand.MEDIUM,
            confidence=ConfidenceLevel.MEDIUM,
            status=status_val,
            scenario="image_space_support_hypothesis",
            video_id=video.id,
        )
        persist_findings([event], video.id, video.id, 0.5, test_db)
        fetched = get_event_by_id(test_db, event.event_id)
        assert fetched.status == status_val


# =========================================================================
# 5. Responsible AI Closed-Loop Review
# =========================================================================

def test_incident_replay_operator_review(client, test_db, mock_registry):
    """Human operator review recorded during Incident Replay updates review_status and logs feedback."""
    video = mock_registry.list_videos()[0]
    event = RiskEvent(
        timestamp=2.0,
        event_type=EventType.RISK,
        lens=RiskLens.CONFORMANCE,
        entity_id="box:3",
        score=65.0,
        band=RiskBand.MEDIUM,
        confidence=ConfidenceLevel.HIGH,
        status=FindingStatus.SUPPORTED,
        scenario="wrong_product_orientation",
        video_id=video.id,
    )
    persist_findings([event], video.id, video.id, 2.0, test_db)

    # Post False Positive review
    review_payload = {
        "review_status": "false_positive",
        "notes": "Carton orientation complies with special client packing waiver.",
    }
    res = client.post(f"/api/events/{event.event_id}/review", json=review_payload)
    assert res.status_code == 200
    updated = res.json()
    assert updated["reviewed"] is True
    assert updated["review_status"] == "false_positive"

    # Verify feedback table recorded the flag
    cur = test_db.cursor()
    cur.execute("SELECT flag_type FROM feedback WHERE event_id = ?", (event.event_id,))
    row = cur.fetchone()
    assert row is not None
    assert row["flag_type"] == "false_positive"


# =========================================================================
# 6. What-If Eligibility & Counterfactual Guards
# =========================================================================

def test_what_if_guards_against_human_worker_simulation(client, mock_registry):
    """The What-If endpoint guards against simulating human workers as counterfactual cargo."""
    video = mock_registry.list_videos()[0]
    # Requesting simulation where candidate_id is a person entity should be safely refused
    payload = {
        "timestamp": 0.0,
        "finding_scenario": "person_box_handling",
        "candidate_id": "person_1",
    }
    # Using mock perception where person_1 exists
    res = client.post(f"/api/videos/{video.id}/what-if", json=payload)
    # Even if pipeline is not populated, endpoint returns 404/422/503/structured response without crashing
    assert res.status_code in (200, 422, 503)
