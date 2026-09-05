import pytest
from fastapi.testclient import TestClient

import backend.api.perception as perception_api
from backend.api.videos import get_registry
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


def _make_client(tmp_path, scripted):
    make_test_video(tmp_path / "clip_one.mp4", frame_count=30, fps=10.0, width=1000, height=1000)
    test_registry = VideoRegistry(video_dir=tmp_path)
    fake_pipeline = PerceptionPipeline(
        config=PerceptionConfig(default_sample_fps=2.0, max_samples_per_run=50),
        detector=ScriptedDetector(scripted),
    )
    app.dependency_overrides[get_registry] = lambda: test_registry
    app.dependency_overrides[perception_api.get_pipeline_registry] = lambda: {
        "stock": fake_pipeline,
        "pilot": fake_pipeline,
    }
    return TestClient(app)


def _teardown():
    app.dependency_overrides.pop(get_registry, None)
    app.dependency_overrides.pop(perception_api.get_pipeline_registry, None)


def _video_id(client):
    return client.get("/api/videos").json()[0]["id"]


def test_person_only_scene_gives_insufficient_evidence_not_a_violation(tmp_path):
    scripted = [[RawDetection("person", 0.95, 100, 100, 200, 300)] for _ in range(10)]
    client = _make_client(tmp_path, scripted)
    try:
        video_id = _video_id(client)
        response = client.get(f"/api/videos/{video_id}/findings", params={"timestamp": 1.0})
        assert response.status_code == 200
        findings = response.json()
        behaviour_findings = [f for f in findings if f["lens"] == "behaviour"]
        assert len(behaviour_findings) == 1
        assert behaviour_findings[0]["status"] == "insufficient_evidence"
        assert all(f["status"] != "supported" or f["lens"] != "behaviour" for f in findings)
    finally:
        _teardown()


def test_unknown_video_returns_404(tmp_path):
    client = _make_client(tmp_path, [[RawDetection("person", 0.9, 100, 100, 200, 300)]])
    try:
        response = client.get("/api/videos/does-not-exist/findings", params={"timestamp": 0})
        assert response.status_code == 404
    finally:
        _teardown()


def test_missing_timestamp_returns_422(tmp_path):
    client = _make_client(tmp_path, [[RawDetection("person", 0.9, 100, 100, 200, 300)]])
    try:
        video_id = _video_id(client)
        response = client.get(f"/api/videos/{video_id}/findings")
        assert response.status_code == 422
    finally:
        _teardown()


def test_findings_response_shape(tmp_path):
    scripted = [[RawDetection("person", 0.9, 100, 100, 200, 300)] for _ in range(5)]
    client = _make_client(tmp_path, scripted)
    try:
        video_id = _video_id(client)
        response = client.get(f"/api/videos/{video_id}/findings", params={"timestamp": 0.0})
        assert response.status_code == 200
        for finding in response.json():
            assert set(
                [
                    "timestamp",
                    "event_type",
                    "lens",
                    "entity_id",
                    "confidence",
                    "status",
                    "scenario",
                    "entities",
                    "evidence",
                    "explanation",
                    "recommended_action",
                    "limitations",
                ]
            ).issubset(finding.keys())
    finally:
        _teardown()
