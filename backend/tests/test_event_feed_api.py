"""Tests for Phase 9.2 Event Feed API Integration, Filtering, Pagination, and Review."""

import sqlite3
import pytest
from fastapi.testclient import TestClient

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
from backend.db.events import persist_findings
from backend.main import app
from backend.video.registry import VideoRecord, VideoRegistry
from backend.contracts.models import VideoMetadata


@pytest.fixture
def feed_db(tmp_path):
    db_file = tmp_path / "test_feed.db"
    conn = get_connection(db_file)
    init_db(conn)
    yield conn
    conn.close()


def _create_test_event(
    scenario="box_overhang",
    lens=RiskLens.STRUCTURAL,
    status=FindingStatus.PROBABLE,
    band=RiskBand.MEDIUM,
    confidence=ConfidenceLevel.MEDIUM,
    timestamp=2.5,
    video_id="video_alpha",
    score=65.0,
    action="Verification required: Align upper carton with supporting package edges",
):
    action_rec = ActionRecommendation(
        scenario_key=scenario,
        status=status,
        confidence=confidence,
        action=action,
        rationale="Overhang reduces base contact",
        basis="Base overhang ratio 32%",
        limitations=["image_space_only"],
        what_if_eligible=True,
        risk_title="Unstable carton overhang beyond supporting base",
    )
    return RiskEvent(
        timestamp=timestamp,
        event_type=EventType.RISK,
        lens=lens,
        entity_id="box:1",
        score=score,
        band=band,
        confidence=confidence,
        status=status,
        scenario=scenario,
        entities=["box:1", "box:2"],
        evidence={"overhang_ratio": 0.32},
        explanation="Upper carton overhangs supporting base by 32%",
        recommended_action=action,
        limitations=["image_space_only"],
        planner_recommendation=action_rec,
        video_id=video_id,
    )


def test_feed_api_shape_and_serialization(feed_db):
    app.dependency_overrides[get_db] = lambda: feed_db
    try:
        client = TestClient(app)
        finding = _create_test_event()
        persist_findings([finding], video_id="video_alpha", canonical_id="video_alpha", timestamp=2.5, conn=feed_db)

        resp = client.get("/api/events")
        assert resp.status_code == 200
        items = resp.json()
        assert len(items) == 1

        item = items[0]
        # Assert complete wire shape expected by EventFeed.jsx
        assert "event_id" in item
        assert item["video_id"] == "video_alpha"
        assert item["timestamp"] == 2.5
        assert item["scenario"] == "box_overhang"
        assert item["lens"] == "structural"
        assert item["status"] == "probable"
        assert item["band"] == "Medium"
        assert item["confidence"] == "Medium"
        assert item["reviewed"] is False
        assert item["review_status"] is None
        assert "planner_recommendation" in item
        assert item["planner_recommendation"]["action"] == "Verification required: Align upper carton with supporting package edges"
        assert item["planner_recommendation"]["what_if_eligible"] is True
    finally:
        app.dependency_overrides.pop(get_db, None)


def test_feed_all_filters(feed_db):
    app.dependency_overrides[get_db] = lambda: feed_db
    try:
        client = TestClient(app)

        # Seed 4 distinct events across different lenses, statuses, bands, videos, and review states
        ev1 = _create_test_event(scenario="box_overhang", lens=RiskLens.STRUCTURAL, status=FindingStatus.SUPPORTED, band=RiskBand.HIGH, video_id="vid_1", timestamp=1.0)
        ev2 = _create_test_event(scenario="carton_drop", lens=RiskLens.BEHAVIOUR, status=FindingStatus.PROBABLE, band=RiskBand.MEDIUM, video_id="vid_1", timestamp=2.0)
        ev3 = _create_test_event(scenario="wrong_orientation", lens=RiskLens.CONFORMANCE, status=FindingStatus.INSUFFICIENT_EVIDENCE, band=RiskBand.LOW, video_id="vid_2", timestamp=3.0)
        ev4 = _create_test_event(scenario="dock_edge", lens=RiskLens.ENVIRONMENTAL, status=FindingStatus.UNSUPPORTED, band=RiskBand.CRITICAL, video_id="vid_2", timestamp=4.0)

        persist_findings([ev1], video_id="vid_1", canonical_id="vid_1", timestamp=1.0, conn=feed_db)
        persist_findings([ev2], video_id="vid_1", canonical_id="vid_1", timestamp=2.0, conn=feed_db)
        persist_findings([ev3], video_id="vid_2", canonical_id="vid_2", timestamp=3.0, conn=feed_db)
        persist_findings([ev4], video_id="vid_2", canonical_id="vid_2", timestamp=4.0, conn=feed_db)

        # 1. Filter by lens
        for lens_name in ["structural", "behaviour", "conformance", "environmental"]:
            resp = client.get(f"/api/events?lens={lens_name}")
            assert resp.status_code == 200
            data = resp.json()
            assert len(data) == 1
            assert data[0]["lens"] == lens_name

        # 2. Filter by status
        for stat_name in ["supported", "probable", "insufficient_evidence", "unsupported"]:
            resp = client.get(f"/api/events?status={stat_name}")
            assert resp.status_code == 200
            data = resp.json()
            assert len(data) == 1
            assert data[0]["status"] == stat_name

        # 3. Filter by band
        for band_name in ["High", "Medium", "Low", "Critical"]:
            resp = client.get(f"/api/events?band={band_name}")
            assert resp.status_code == 200
            data = resp.json()
            assert len(data) == 1
            assert data[0]["band"] == band_name

        # 4. Filter by video_id
        resp_v1 = client.get("/api/events?video_id=vid_1")
        assert len(resp_v1.json()) == 2
        resp_v2 = client.get("/api/events?video_id=vid_2")
        assert len(resp_v2.json()) == 2

        # 5. Filter by reviewed state (initially all false)
        resp_unreviewed = client.get("/api/events?reviewed=false")
        assert len(resp_unreviewed.json()) == 4
        resp_reviewed = client.get("/api/events?reviewed=true")
        assert len(resp_reviewed.json()) == 0

        # Review ev1 as confirmed_damage
        client.post(f"/api/events/{ev1.event_id}/review", json={"review_status": "confirmed_damage"})
        resp_reviewed_after = client.get("/api/events?reviewed=true")
        assert len(resp_reviewed_after.json()) == 1
        assert resp_reviewed_after.json()[0]["event_id"] == ev1.event_id

        # Review ev2 as false_positive
        client.post(f"/api/events/{ev2.event_id}/review", json={"review_status": "false_positive"})
        resp_fp = client.get("/api/events?review_status=false_positive")
        assert len(resp_fp.json()) == 1
        assert resp_fp.json()[0]["event_id"] == ev2.event_id

        # Review ev3 as unresolved
        client.post(f"/api/events/{ev3.event_id}/review", json={"review_status": "unresolved"})
        resp_unres = client.get("/api/events?review_status=unresolved")
        assert len(resp_unres.json()) == 1
        assert resp_unres.json()[0]["event_id"] == ev3.event_id
    finally:
        app.dependency_overrides.pop(get_db, None)


def test_feed_pagination_and_ordering(feed_db):
    app.dependency_overrides[get_db] = lambda: feed_db
    try:
        client = TestClient(app)

        for i in range(10):
            ev = _create_test_event(scenario=f"scenario_{i}", timestamp=float(i), video_id="vid_seq")
            persist_findings([ev], video_id="vid_seq", canonical_id="vid_seq", timestamp=float(i), conn=feed_db)

        # Default ordering is desc (newest first)
        resp_desc = client.get("/api/events?limit=3&offset=0&order=desc")
        assert resp_desc.status_code == 200
        data_desc = resp_desc.json()
        assert len(data_desc) == 3
        assert data_desc[0]["timestamp"] == 9.0
        assert data_desc[1]["timestamp"] == 8.0
        assert data_desc[2]["timestamp"] == 7.0

        # Offset page 2
        resp_page2 = client.get("/api/events?limit=3&offset=3&order=desc")
        data_page2 = resp_page2.json()
        assert len(data_page2) == 3
        assert data_page2[0]["timestamp"] == 6.0

        # Ascending order
        resp_asc = client.get("/api/events?limit=3&offset=0&order=asc")
        data_asc = resp_asc.json()
        assert data_asc[0]["timestamp"] == 0.0
        assert data_asc[1]["timestamp"] == 1.0
    finally:
        app.dependency_overrides.pop(get_db, None)


def test_feed_empty_state_and_detail_errors(feed_db):
    app.dependency_overrides[get_db] = lambda: feed_db
    try:
        client = TestClient(app)

        # Empty DB returns empty list, not error
        resp = client.get("/api/events")
        assert resp.status_code == 200
        assert resp.json() == []

        # Filter with no matches returns empty list
        resp_filtered = client.get("/api/events?lens=behaviour")
        assert resp_filtered.status_code == 200
        assert resp_filtered.json() == []

        # Invalid event_id detail returns 404
        resp_404 = client.get("/api/events/999999")
        assert resp_404.status_code == 404
        assert "not found" in resp_404.json()["detail"].lower()

        # Review invalid event_id returns 404
        resp_rev_404 = client.post("/api/events/999999/review", json={"review_status": "confirmed_damage"})
        assert resp_rev_404.status_code == 404

        # Review with invalid status returns 422
        resp_rev_422 = client.post("/api/events/1/review", json={"review_status": "made_up_status"})
        assert resp_rev_422.status_code == 422
    finally:
        app.dependency_overrides.pop(get_db, None)
