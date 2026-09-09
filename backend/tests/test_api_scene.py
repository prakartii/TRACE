import pytest
from fastapi.testclient import TestClient

import backend.api.perception as perception_api
from backend.api.videos import get_registry
from backend.contracts.models import SceneGraphEdgeType
from backend.main import app
from backend.perception.config import PerceptionConfig
from backend.perception.detector import RawDetection
from backend.perception.pipeline import PerceptionPipeline
from backend.tests.perception_test_fixtures import ScriptedDetector
from backend.tests.video_test_fixtures import make_test_video
from backend.video.registry import VideoRegistry


@pytest.fixture(autouse=True)
def clear_perception_cache():
    perception_api._cache.clear()
    yield
    perception_api._cache.clear()


@pytest.fixture
def client(tmp_path):
    make_test_video(tmp_path / "clip_one.mp4", frame_count=30, fps=10.0, width=1000, height=1000)
    test_registry = VideoRegistry(video_dir=tmp_path)

    # Two people close together at t=0 -> should produce at least a
    # proximity edge once run through the world model.
    # Centers 110 units apart on a 1000x1000 frame -> normalized distance
    # 0.11, safely under the default proximity_threshold (0.12) with
    # margin for floating-point rounding.
    scripted = [
        [
            RawDetection("person", 0.9, 100, 100, 200, 300),
            RawDetection("person", 0.85, 210, 100, 310, 300),
        ]
        for _ in range(10)
    ]
    fake_pipeline = PerceptionPipeline(
        config=PerceptionConfig(default_sample_fps=2.0, max_samples_per_run=50),
        detector=ScriptedDetector(scripted),
    )

    app.dependency_overrides[get_registry] = lambda: test_registry
    app.dependency_overrides[perception_api.get_pipeline_registry] = lambda: {
        "stock": fake_pipeline,
        "pilot": fake_pipeline,
    }
    try:
        yield TestClient(app)
    finally:
        app.dependency_overrides.pop(get_registry, None)
        app.dependency_overrides.pop(perception_api.get_pipeline_registry, None)


def _video_id(client):
    return client.get("/api/videos").json()[0]["id"]


def test_get_scene_returns_nodes_and_edges(client):
    video_id = _video_id(client)

    response = client.get(f"/api/videos/{video_id}/scene", params={"timestamp": 1.0})

    assert response.status_code == 200
    body = response.json()
    assert "nodes" in body and "edges" in body
    assert "timestamp" in body


def test_get_scene_node_positions_are_normalized(client):
    video_id = _video_id(client)

    response = client.get(f"/api/videos/{video_id}/scene", params={"timestamp": 0.0})
    body = response.json()

    for node in body["nodes"]:
        x, y = node["position"]
        assert 0.0 <= x <= 1.0
        assert 0.0 <= y <= 1.0


def test_get_scene_no_internal_objects_leaked(client):
    """The response must be exactly the SceneGraphSnapshot contract —
    no raw detection/tracker fields, no filesystem paths."""
    video_id = _video_id(client)

    response = client.get(f"/api/videos/{video_id}/scene", params={"timestamp": 0.0})
    body = response.json()

    assert set(body.keys()) == {"timestamp", "nodes", "edges"}
    for node in body["nodes"]:
        assert set(node.keys()) == {
            "entity_id",
            "entity_class",
            "position",
            "footprint",
            "orientation",
            "product_id",
        }


def test_get_scene_unknown_video_returns_404(client):
    response = client.get("/api/videos/does-not-exist/scene", params={"timestamp": 0})
    assert response.status_code == 404


def test_get_scene_missing_timestamp_returns_422(client):
    video_id = _video_id(client)
    response = client.get(f"/api/videos/{video_id}/scene")
    assert response.status_code == 422


def test_get_scene_negative_timestamp_returns_422(client):
    video_id = _video_id(client)
    response = client.get(f"/api/videos/{video_id}/scene", params={"timestamp": -1.0})
    assert response.status_code == 422


def test_get_scene_timestamp_past_duration_returns_422(client):
    video_id = _video_id(client)
    response = client.get(f"/api/videos/{video_id}/scene", params={"timestamp": 999.0})
    assert response.status_code == 422


def test_get_scene_reuses_perception_cache(client):
    """A prior /entities call and a /scene call for the same timestamp
    should hit the same cached perception pass (same frame_index)."""
    video_id = _video_id(client)

    entities_response = client.get(
        f"/api/videos/{video_id}/entities", params={"timestamp": 0.5}
    )
    scene_response = client.get(
        f"/api/videos/{video_id}/scene", params={"timestamp": 0.5}
    )

    assert entities_response.json()["frame_index"] is not None
    # Both requests resolve to the same nearest sampled frame.
    assert len(scene_response.json()["nodes"]) == len(
        entities_response.json()["entities"]
    )


def test_get_scene_close_people_produce_proximity_edge(client):
    video_id = _video_id(client)

    response = client.get(f"/api/videos/{video_id}/scene", params={"timestamp": 0.0})
    body = response.json()

    edge_types = {e["edge_type"] for e in body["edges"]}
    assert SceneGraphEdgeType.PROXIMITY.value in edge_types


def test_get_scenes_timeline_returns_all_snapshots(client):
    video_id = _video_id(client)

    response = client.get(f"/api/videos/{video_id}/scenes")
    assert response.status_code == 200
    snapshots = response.json()
    assert isinstance(snapshots, list)
    assert len(snapshots) > 0
    # Every snapshot has timestamp and nodes
    for s in snapshots:
        assert "timestamp" in s
        assert "nodes" in s
        assert "edges" in s
