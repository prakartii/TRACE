import pytest
from fastapi.testclient import TestClient

from backend.api.videos import get_registry
from backend.main import app
from backend.tests.video_test_fixtures import make_test_video
from backend.video.registry import VideoRegistry


@pytest.fixture
def client(tmp_path):
    make_test_video(tmp_path / "clip_one.mp4", frame_count=30, fps=10.0)
    test_registry = VideoRegistry(video_dir=tmp_path)

    app.dependency_overrides[get_registry] = lambda: test_registry
    try:
        yield TestClient(app)
    finally:
        app.dependency_overrides.pop(get_registry, None)


def test_list_videos_returns_discovered_source(client):
    response = client.get("/api/videos")

    assert response.status_code == 200
    body = response.json()
    assert len(body) == 1
    assert body[0]["filename"] == "clip_one.mp4"
    assert body[0]["metadata"]["fps"] == pytest.approx(10.0, abs=0.1)
    assert "path" not in body[0]


def test_get_video_by_id_returns_metadata(client):
    video_id = client.get("/api/videos").json()[0]["id"]

    response = client.get(f"/api/videos/{video_id}")

    assert response.status_code == 200
    assert response.json()["id"] == video_id


def test_get_video_unknown_id_returns_404(client):
    response = client.get("/api/videos/does-not-exist")
    assert response.status_code == 404


def test_get_frame_returns_jpeg(client):
    video_id = client.get("/api/videos").json()[0]["id"]

    response = client.get(f"/api/videos/{video_id}/frame", params={"timestamp": 1.0})

    assert response.status_code == 200
    assert response.headers["content-type"] == "image/jpeg"
    assert response.content[:2] == b"\xff\xd8"  # JPEG magic bytes


def test_get_frame_unknown_video_returns_404(client):
    response = client.get("/api/videos/does-not-exist/frame", params={"timestamp": 0})
    assert response.status_code == 404


def test_get_frame_missing_timestamp_returns_422(client):
    video_id = client.get("/api/videos").json()[0]["id"]

    response = client.get(f"/api/videos/{video_id}/frame")

    assert response.status_code == 422


def test_get_frame_negative_timestamp_returns_422(client):
    video_id = client.get("/api/videos").json()[0]["id"]

    response = client.get(
        f"/api/videos/{video_id}/frame", params={"timestamp": -1.0}
    )

    assert response.status_code == 422


def test_get_frame_timestamp_past_duration_returns_422(client):
    video_id = client.get("/api/videos").json()[0]["id"]

    response = client.get(
        f"/api/videos/{video_id}/frame", params={"timestamp": 999.0}
    )

    assert response.status_code == 422


def test_stream_returns_video_and_supports_range(client):
    video_id = client.get("/api/videos").json()[0]["id"]

    full = client.get(f"/api/videos/{video_id}/stream")
    assert full.status_code == 200
    assert full.headers["content-type"] == "video/mp4"

    partial = client.get(
        f"/api/videos/{video_id}/stream", headers={"Range": "bytes=0-99"}
    )
    assert partial.status_code == 206
    assert partial.headers["content-range"].startswith("bytes 0-99/")
    assert len(partial.content) == 100


def test_stream_unknown_video_returns_404(client):
    response = client.get("/api/videos/does-not-exist/stream")
    assert response.status_code == 404


def test_stream_supports_head_request(client):
    """Regression test: Chrome's <video> element probes with HEAD before
    ever issuing a GET, and silently never loads the video if that HEAD
    405s — this must return 200 with no body, not Method Not Allowed."""
    video_id = client.get("/api/videos").json()[0]["id"]

    response = client.head(f"/api/videos/{video_id}/stream")

    assert response.status_code == 200
    assert response.headers["content-type"] == "video/mp4"
    assert response.content == b""
