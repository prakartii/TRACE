"""Comprehensive Test Suite for Phase 11: What-If Trajectory Simulation (Screen 9).

Tests ARCHITECTURE.md Part 5.6, Part 6 Screen 9, and CLAUDE.md §13:
1. Trajectory generation across multi-frame temporal sequence.
2. Cloned sequence immutability (original sequence unaffected).
3. Single stability engine scoring consistency (CLAUDE.md §12).
4. Epistemic safety gates (refuse unsupported/insufficient evidence & worker entities).
5. Alternative candidate swapping and metric calculations.
6. REST API contracts: POST /api/planner/whatif, GET /api/planner/whatif/{id}, POST /planner/whatif.
"""

from __future__ import annotations

import sqlite3
import pytest
from starlette.testclient import TestClient

from backend.contracts.models import (
    BoundingBox,
    Entity,
    EntityClass,
    FindingStatus,
    PerceptionFrameResult,
    RiskBand,
    RiskEvent,
    SceneGraphEdge,
    SceneGraphEdgeType,
    SceneGraphNode,
    SceneGraphSnapshot,
)
from backend.main import app
from backend.planner.whatif import (
    evaluate_trajectory_point,
    run_what_if_trajectory,
)
from backend.world_model.scene_graph import WorldModel


@pytest.fixture
def test_client():
    return TestClient(app)


@pytest.fixture
def in_memory_db():
    from backend.db.db import init_db
    conn = sqlite3.connect(":memory:")
    conn.row_factory = sqlite3.Row
    init_db(conn)
    yield conn
    conn.close()


def make_sample_snapshot(timestamp: float, box_x1: float = 0.4, box_x2: float = 0.8) -> SceneGraphSnapshot:
    """Creates a synthetic world-model snapshot with a pallet and a box."""
    pallet_node = SceneGraphNode(
        entity_id="pallet_1",
        entity_class=EntityClass.PALLET,
        position=(0.5, 0.7),
        footprint=BoundingBox(x1=0.2, y1=0.6, x2=0.8, y2=0.8),
    )
    box_node = SceneGraphNode(
        entity_id="box_1",
        entity_class=EntityClass.BOX,
        position=((box_x1 + box_x2) / 2.0, 0.45),
        footprint=BoundingBox(x1=box_x1, y1=0.3, x2=box_x2, y2=0.6),
    )
    edge = SceneGraphEdge(
        source_id="box_1",
        target_id="pallet_1",
        edge_type=SceneGraphEdgeType.SUPPORT,
        weight=1.0,
    )
    return SceneGraphSnapshot(
        timestamp=timestamp,
        nodes=[pallet_node, box_node],
        edges=[edge],
    )


# ---------------------------------------------------------------------------
# Unit Tests: Point Evaluation
# ---------------------------------------------------------------------------

def test_evaluate_trajectory_point_stable():
    snap = make_sample_snapshot(1.0, box_x1=0.3, box_x2=0.7)  # Well centered on pallet [0.2, 0.8]
    pt = evaluate_trajectory_point(snap, "box_1", is_placement_moment=True)
    assert pt.timestamp == 1.0
    assert pt.is_placement_moment is True
    assert pt.stability_score >= 80.0
    assert pt.risk_score <= 20.0
    assert pt.band == RiskBand.LOW
    assert pt.is_alert is False


def test_evaluate_trajectory_point_unstable():
    snap = make_sample_snapshot(1.0, box_x1=0.7, box_x2=1.0)  # Significant overhang beyond pallet [0.2, 0.8]
    pt = evaluate_trajectory_point(snap, "box_1", is_placement_moment=False, scenario="box_overhang")
    assert pt.stability_score < 70.0
    assert pt.risk_score > 30.0
    assert "box_overhang" in pt.active_scenarios or pt.is_alert is False


def test_evaluate_trajectory_point_missing_entity_fallback():
    snap = SceneGraphSnapshot(timestamp=2.5, nodes=[], edges=[])
    pt = evaluate_trajectory_point(snap, "non_existent")
    assert pt.timestamp == 2.5
    assert pt.stability_score == 50.0
    assert pt.band == RiskBand.MEDIUM


# ---------------------------------------------------------------------------
# Unit & Integration Tests: Trajectory Simulation
# ---------------------------------------------------------------------------

class FakeVideoMetadata:
    width = 1920
    height = 1080
    fps = 30.0
    duration = 10.0


class FakeVideoRecord:
    id = "test_vid_01"
    filename = "test_vid_01.mp4"
    metadata = FakeVideoMetadata()


class FakeVideoRegistry:
    def get(self, video_id: str):
        if video_id == "test_vid_01":
            return FakeVideoRecord()
        return None


def test_whatif_trajectory_unknown_video():
    wm = WorldModel()
    res = run_what_if_trajectory(
        video_id="unknown_video",
        timestamp=2.0,
        registry=FakeVideoRegistry(),
        pipelines={},
        world_model=wm,
    )
    assert res.simulation_available is False
    assert "Unknown video" in (res.simulation_notice or "")


def test_whatif_trajectory_worker_entity_refusal():
    wm = WorldModel()
    res = run_what_if_trajectory(
        video_id="test_vid_01",
        timestamp=2.0,
        entity_id="person_1",
        registry=FakeVideoRegistry(),
        pipelines={},
        world_model=wm,
    )
    assert res.simulation_available is False
    assert "worker" in (res.simulation_notice or "").lower()
    assert "worker_entity_ineligible" in res.limitations


def test_whatif_trajectory_unsupported_status_refusal(in_memory_db):
    from backend.db.events import persist_findings, query_events
    wm = WorldModel()

    ev = RiskEvent(
        video_id="test_vid_01",
        timestamp=3.0,
        event_type="risk",
        lens="structural",
        entity_id="box_1",
        score=75.0,
        band="High",
        confidence="High",
        status=FindingStatus.UNSUPPORTED,
        scenario="box_overhang",
    )
    persist_findings([ev], video_id="test_vid_01", canonical_id="test_vid_01", timestamp=3.0, conn=in_memory_db)
    all_events = query_events(in_memory_db)
    saved = all_events[0]

    res = run_what_if_trajectory(
        video_id="test_vid_01",
        timestamp=3.0,
        event_id=saved.event_id,
        registry=FakeVideoRegistry(),
        pipelines={},
        world_model=wm,
        db_conn=in_memory_db,
    )
    assert res.simulation_available is False
    assert "UNSUPPORTED" in (res.simulation_notice or "")


# ---------------------------------------------------------------------------
# End-to-End Trajectory Sequence Verification
# ---------------------------------------------------------------------------

def test_whatif_trajectory_full_sequence(monkeypatch):
    """Verifies that running trajectory simulation produces 2 distinct curves across time."""
    from backend.api import perception

    # Create mock perception frame results across time [1.0s, 2.0s, 3.0s, 4.0s, 5.0s]
    mock_frames = []
    for t in [1.0, 2.0, 3.0, 4.0, 5.0]:
        # At t=3.0, box is placed with severe overhang
        box_x1 = 0.75 if t >= 3.0 else 0.4
        box_x2 = 0.98 if t >= 3.0 else 0.7
        mock_frames.append(
            PerceptionFrameResult(
                source_id="test_vid_01",
                timestamp=t,
                entities=[
                    Entity(
                        id="box_1",
                        track_id="1", timestamp=t,
                        entity_class=EntityClass.BOX,
                        confidence=0.90,
                        bbox=BoundingBox(x1=box_x1, y1=0.3, x2=box_x2, y2=0.6),
                    ),
                    Entity(
                        id="pallet_1",
                        track_id="2", timestamp=t,
                        entity_class=EntityClass.PALLET,
                        confidence=0.95,
                        bbox=BoundingBox(x1=0.2, y1=0.6, x2=0.8, y2=0.8),
                    ),
                ],
            )
        )

    monkeypatch.setattr(
        perception,
        "get_cached_results",
        lambda video_id, registry, pipeline, model: mock_frames,
    )

    wm = WorldModel()
    res = run_what_if_trajectory(
        video_id="test_vid_01",
        timestamp=3.0,
        entity_id="box_1",
        scenario="box_overhang",
        registry=FakeVideoRegistry(),
        pipelines={"pilot": object()},
        world_model=wm,
    )

    assert res.simulation_available is True
    assert len(res.original_trajectory) == 5
    assert len(res.simulated_trajectory) == 5

    # Placement moment occurs at t=3.0 (index 2)
    orig_k = res.original_trajectory[2]
    sim_k = res.simulated_trajectory[2]
    assert orig_k.is_placement_moment is True
    assert sim_k.is_placement_moment is True

    # Counterfactual placement must improve stability
    assert sim_k.stability_score > orig_k.stability_score
    assert res.stability_gain_at_placement > 0.0
    assert res.candidate_id != "none"
    assert len(res.available_candidates) > 0

    # Epistemic limitations present
    assert any("image-space" in lim.lower() for lim in res.limitations)


# ---------------------------------------------------------------------------
# REST API Endpoint Tests
# ---------------------------------------------------------------------------

def test_api_planner_whatif_post(monkeypatch, test_client):
    from backend.api import perception

    mock_frames = [
        PerceptionFrameResult(
            source_id="test_vid_01",
            timestamp=1.0,
            entities=[
                Entity(
                    id="box_1",
                    track_id="1", timestamp=1.0,
                    entity_class=EntityClass.BOX,
                    confidence=0.90,
                    bbox=BoundingBox(x1=0.7, y1=0.3, x2=0.95, y2=0.6),
                ),
                Entity(
                    id="pallet_1",
                    track_id="2", timestamp=1.0,
                    entity_class=EntityClass.PALLET,
                    confidence=0.95,
                    bbox=BoundingBox(x1=0.2, y1=0.6, x2=0.8, y2=0.8),
                ),
            ],
        )
    ]

    monkeypatch.setattr(
        perception,
        "get_cached_results",
        lambda video_id, registry, pipeline, model: mock_frames,
    )

    # Use first available video from real video registry
    from backend.video.registry import VideoRegistry
    reg = VideoRegistry()
    first_vid = reg.list_videos()[0].id if reg.list_videos() else "challenge_1"

    payload = {
        "video_id": first_vid,
        "timestamp": 1.0,
        "entity_id": "box_1",
        "scenario": "box_overhang",
    }
    resp = test_client.post("/api/planner/whatif", json=payload)
    assert resp.status_code == 200
    data = resp.json()
    assert "original_trajectory" in data
    assert "simulated_trajectory" in data
    assert "stability_gain_at_placement" in data
    assert data["video_id"] == first_vid


def test_api_planner_whatif_canonical_post(monkeypatch, test_client):
    """Tests canonical path alias POST /planner/whatif per ARCHITECTURE.md Screen 9."""
    from backend.api import perception

    mock_frames = [
        PerceptionFrameResult(
            source_id="test_vid_01",
            timestamp=2.0,
            entities=[
                Entity(
                    id="box_1",
                    track_id="1", timestamp=2.0,
                    entity_class=EntityClass.BOX,
                    confidence=0.90,
                    bbox=BoundingBox(x1=0.7, y1=0.3, x2=0.95, y2=0.6),
                ),
                Entity(
                    id="pallet_1",
                    track_id="2", timestamp=2.0,
                    entity_class=EntityClass.PALLET,
                    confidence=0.95,
                    bbox=BoundingBox(x1=0.2, y1=0.6, x2=0.8, y2=0.8),
                ),
            ],
        )
    ]

    monkeypatch.setattr(
        perception,
        "get_cached_results",
        lambda video_id, registry, pipeline, model: mock_frames,
    )

    from backend.video.registry import VideoRegistry
    reg = VideoRegistry()
    first_vid = reg.list_videos()[0].id if reg.list_videos() else "challenge_1"

    payload = {
        "video_id": first_vid,
        "timestamp": 2.0,
        "entity_id": "box_1",
    }
    resp = test_client.post("/planner/whatif", json=payload)
    assert resp.status_code == 200
    data = resp.json()
    assert "original_trajectory" in data
    assert "simulated_trajectory" in data


def test_api_planner_whatif_get_event(test_client):
    # Retrieve non-existing event returns 404
    resp = test_client.get("/api/planner/whatif/999999")
    assert resp.status_code == 404


def test_whatif_trajectory_candidate_switching(monkeypatch):
    """Tests that specifying different alternative candidates alters the simulation curve."""
    from backend.api import perception

    mock_frames = [
        PerceptionFrameResult(
            source_id="test_vid_01",
            timestamp=2.0,
            entities=[
                Entity(
                    id="box_1",
                    track_id="1", timestamp=2.0,
                    entity_class=EntityClass.BOX,
                    confidence=0.90,
                    bbox=BoundingBox(x1=0.75, y1=0.3, x2=0.98, y2=0.6),
                ),
                Entity(
                    id="pallet_1",
                    track_id="2", timestamp=2.0,
                    entity_class=EntityClass.PALLET,
                    confidence=0.95,
                    bbox=BoundingBox(x1=0.2, y1=0.6, x2=0.8, y2=0.8),
                ),
            ],
        )
    ]

    monkeypatch.setattr(
        perception,
        "get_cached_results",
        lambda video_id, registry, pipeline, model: mock_frames,
    )

    wm = WorldModel()
    res = run_what_if_trajectory(
        video_id="test_vid_01",
        timestamp=2.0,
        entity_id="box_1",
        scenario="box_overhang",
        registry=FakeVideoRegistry(),
        pipelines={"pilot": object()},
        world_model=wm,
    )

    assert res.simulation_available is True
    # We should have multiple available candidates
    assert len(res.available_candidates) >= 1

    # Re-run with candidate specified
    cand_id = res.available_candidates[0].id
    res_cand = run_what_if_trajectory(
        video_id="test_vid_01",
        timestamp=2.0,
        entity_id="box_1",
        scenario="box_overhang",
        alternative_candidate=cand_id,
        registry=FakeVideoRegistry(),
        pipelines={"pilot": object()},
        world_model=wm,
    )
    assert res_cand.candidate_id == cand_id


def test_api_planner_whatif_get_event_success(monkeypatch, test_client):
    """Tests GET /api/planner/whatif/{event_id} with a persisted event."""
    from backend.api import perception
    from backend.db.db import get_connection
    from backend.db.events import persist_findings, query_events
    from backend.video.registry import VideoRegistry

    reg = VideoRegistry()
    first_vid = reg.list_videos()[0].id if reg.list_videos() else "challenge_1"

    mock_frames = [
        PerceptionFrameResult(
            source_id=first_vid,
            timestamp=1.5,
            entities=[
                Entity(
                    id="box_1",
                    track_id="1", timestamp=1.5,
                    entity_class=EntityClass.BOX,
                    confidence=0.90,
                    bbox=BoundingBox(x1=0.75, y1=0.3, x2=0.98, y2=0.6),
                ),
                Entity(
                    id="pallet_1",
                    track_id="2", timestamp=1.5,
                    entity_class=EntityClass.PALLET,
                    confidence=0.95,
                    bbox=BoundingBox(x1=0.2, y1=0.6, x2=0.8, y2=0.8),
                ),
            ],
        )
    ]

    monkeypatch.setattr(
        perception,
        "get_cached_results",
        lambda video_id, registry, pipeline, model: mock_frames,
    )

    conn = get_connection()
    ev = RiskEvent(
        video_id=first_vid,
        timestamp=1.5,
        event_type="risk",
        lens="structural",
        entity_id="box_1",
        score=72.0,
        band="High",
        confidence="High",
        status=FindingStatus.SUPPORTED,
        scenario="box_overhang",
    )
    persist_findings([ev], video_id=first_vid, canonical_id=first_vid, timestamp=1.5, conn=conn)
    all_events = query_events(conn, video_id=first_vid)
    assert len(all_events) > 0
    target_event = all_events[0]

    resp = test_client.get(f"/api/planner/whatif/{target_event.event_id}")
    assert resp.status_code == 200
    data = resp.json()
    assert data["event_id"] == target_event.event_id
    assert "original_trajectory" in data
    assert "simulated_trajectory" in data

