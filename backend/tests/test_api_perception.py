import pytest
from fastapi.testclient import TestClient

import backend.api.perception as perception_api
from backend.api.videos import get_registry
from backend.contracts.models import EntityClass
from backend.main import app
from backend.perception.adapter import CLASS_MAP
from backend.perception.config import (
    STOCK_COCO_IDENTITY,
    TRACE_PILOT_IDENTITY,
    PerceptionConfig,
)
from backend.perception.detector import RawDetection
from backend.perception.pipeline import PerceptionPipeline
from backend.tests.perception_test_fixtures import ScriptedDetector
from backend.tests.video_test_fixtures import make_test_video
from backend.video.registry import VideoRegistry


@pytest.fixture(autouse=True)
def clear_perception_cache():
    """The in-memory results cache is keyed by video id alone (deliberately
    stable across a real registry's rescans — see registry.py), but that
    means two *different* tests using a fixture file with the same name
    would otherwise collide on the same cache key. Reset it around every
    test in this module."""
    perception_api._cache.clear()
    yield
    perception_api._cache.clear()


@pytest.fixture
def client(tmp_path):
    make_test_video(tmp_path / "clip_one.mp4", frame_count=30, fps=10.0)
    test_registry = VideoRegistry(video_dir=tmp_path)

    def make_fake_pipeline(model_identity, class_names):
        scripted = [
            [RawDetection(name, 0.9, 10 + i, 10, 50 + i, 100) for name in class_names]
            for i in range(10)
        ]
        return PerceptionPipeline(
            config=PerceptionConfig(
                default_sample_fps=2.0,
                max_samples_per_run=50,
                model_identity=model_identity,
            ),
            detector=ScriptedDetector(scripted),
        )

    stock_pipeline = make_fake_pipeline(STOCK_COCO_IDENTITY, ["person"])
    pilot_pipeline = make_fake_pipeline(TRACE_PILOT_IDENTITY, ["person", "box"])

    app.dependency_overrides[get_registry] = lambda: test_registry
    app.dependency_overrides[perception_api.get_pipeline_registry] = lambda: {
        "stock": stock_pipeline,
        "pilot": pilot_pipeline,
    }
    try:
        yield TestClient(app)
    finally:
        app.dependency_overrides.pop(get_registry, None)
        app.dependency_overrides.pop(perception_api.get_pipeline_registry, None)


def _video_id(client):
    return client.get("/api/videos").json()[0]["id"]


def test_get_entities_returns_person_entities(client):
    video_id = _video_id(client)

    response = client.get(
        f"/api/videos/{video_id}/entities", params={"timestamp": 1.0}
    )

    assert response.status_code == 200
    body = response.json()
    assert body["source_id"] == video_id
    assert isinstance(body["entities"], list)
    if body["entities"]:
        assert body["entities"][0]["entity_class"] == EntityClass.PERSON.value


def test_get_entities_unknown_video_returns_404(client):
    response = client.get(
        "/api/videos/does-not-exist/entities", params={"timestamp": 0}
    )
    assert response.status_code == 404


def test_get_entities_missing_timestamp_returns_422(client):
    video_id = _video_id(client)
    response = client.get(f"/api/videos/{video_id}/entities")
    assert response.status_code == 422


def test_get_entities_negative_timestamp_returns_422(client):
    video_id = _video_id(client)
    response = client.get(
        f"/api/videos/{video_id}/entities", params={"timestamp": -1.0}
    )
    assert response.status_code == 422


def test_get_entities_timestamp_past_duration_returns_422(client):
    video_id = _video_id(client)
    response = client.get(
        f"/api/videos/{video_id}/entities", params={"timestamp": 999.0}
    )
    assert response.status_code == 422


def test_get_entities_second_request_uses_cache(client):
    video_id = _video_id(client)

    first = client.get(f"/api/videos/{video_id}/entities", params={"timestamp": 0.5})
    second = client.get(f"/api/videos/{video_id}/entities", params={"timestamp": 0.6})

    assert first.status_code == 200
    assert second.status_code == 200
    # Both nearest-lookups should resolve to the same cached sampled frame.
    assert first.json()["frame_index"] == second.json()["frame_index"]


def test_only_person_is_mapped_by_default():
    """Documents the current, deliberate class-coverage limitation —
    see adapter.py's module docstring."""
    assert set(CLASS_MAP.keys()) == {"person"}


# ---------------------------------------------------------------------
# Explicit model selection (Phase 4 perception-strengthening) — the
# system must never silently substitute one model for the other.
# ---------------------------------------------------------------------


def test_default_model_is_stock_and_labeled_as_such(client):
    video_id = _video_id(client)

    response = client.get(f"/api/videos/{video_id}/entities", params={"timestamp": 0.0})

    assert response.status_code == 200
    assert response.json()["model_identity"] == STOCK_COCO_IDENTITY
    classes = {e["entity_class"] for e in response.json()["entities"]}
    assert classes <= {EntityClass.PERSON.value}


def test_explicit_pilot_model_is_labeled_as_such(client):
    video_id = _video_id(client)

    response = client.get(
        f"/api/videos/{video_id}/entities",
        params={"timestamp": 0.0, "model": "pilot"},
    )

    assert response.status_code == 200
    assert response.json()["model_identity"] == TRACE_PILOT_IDENTITY


def test_pilot_model_can_return_box_entities(client):
    video_id = _video_id(client)

    response = client.get(
        f"/api/videos/{video_id}/entities",
        params={"timestamp": 0.0, "model": "pilot"},
    )

    classes = {e["entity_class"] for e in response.json()["entities"]}
    assert EntityClass.BOX.value in classes


def test_stock_and_pilot_results_are_cached_independently(client):
    """Switching `model` must never see the other model's cached
    results — they are computed and cached under separate keys."""
    video_id = _video_id(client)

    stock_response = client.get(
        f"/api/videos/{video_id}/entities", params={"timestamp": 0.0, "model": "stock"}
    )
    pilot_response = client.get(
        f"/api/videos/{video_id}/entities", params={"timestamp": 0.0, "model": "pilot"}
    )

    stock_classes = {e["entity_class"] for e in stock_response.json()["entities"]}
    pilot_classes = {e["entity_class"] for e in pilot_response.json()["entities"]}
    assert EntityClass.BOX.value not in stock_classes
    assert EntityClass.BOX.value in pilot_classes


def test_invalid_model_name_returns_422(client):
    video_id = _video_id(client)

    response = client.get(
        f"/api/videos/{video_id}/entities",
        params={"timestamp": 0.0, "model": "not-a-real-model"},
    )

    assert response.status_code == 422


def test_get_tracks_returns_timeline_frames(client):
    video_id = _video_id(client)

    response = client.get(f"/api/videos/{video_id}/tracks", params={"model": "stock"})
    assert response.status_code == 200
    frames = response.json()
    assert isinstance(frames, list)
    if frames:
        assert "timestamp" in frames[0]
        assert "entities" in frames[0]


def test_get_tracks_unknown_video_returns_404(client):
    response = client.get("/api/videos/unknown-nonexistent/tracks")
    assert response.status_code == 404

