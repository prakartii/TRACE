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


def test_upload_video_ingests_and_discovers(tmp_path, client):
    # Source lives in a subdirectory the registry does not scan, so the upload
    # (written to the registry's top-level dir) keeps its original filename.
    src_dir = tmp_path / "incoming"
    src_dir.mkdir()
    source_path = src_dir / "incoming.mp4"
    make_test_video(source_path, frame_count=12, fps=10.0)

    with source_path.open("rb") as fh:
        response = client.post(
            "/api/videos",
            files={"file": ("incoming.mp4", fh, "video/mp4")},
        )

    assert response.status_code == 201
    body = response.json()
    assert body["filename"] == "incoming.mp4"
    assert "path" not in body

    listed = client.get("/api/videos").json()
    assert any(v["filename"] == "incoming.mp4" for v in listed)


def test_upload_video_rejects_non_mp4(tmp_path, client):
    bad = tmp_path / "notes.txt"
    bad.write_text("not a video")
    with bad.open("rb") as fh:
        response = client.post(
            "/api/videos",
            files={"file": ("notes.txt", fh, "text/plain")},
        )
    assert response.status_code == 415


def test_upload_video_discards_undecodable(tmp_path, client):
    bad = tmp_path / "broken.mp4"
    bad.write_bytes(b"\x00\x00\x00\x18ftypnotavalidvideo")
    with bad.open("rb") as fh:
        response = client.post(
            "/api/videos",
            files={"file": ("broken.mp4", fh, "video/mp4")},
        )
    assert response.status_code == 422


def test_get_frame_returns_jpeg(client):
    video_id = client.get("/api/videos").json()[0]["id"]

    # redact=false: this test asserts JPEG encoding, not the (model-dependent)
    # face-redaction path, which fails closed with 503 when weights are absent.
    response = client.get(
        f"/api/videos/{video_id}/frame",
        params={"timestamp": 1.0, "redact": False},
    )

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


def test_get_sampling_policy(client):
    video_id = client.get("/api/videos").json()[0]["id"]
    response = client.get(f"/api/videos/{video_id}/sampling")
    assert response.status_code == 200
    data = response.json()
    assert "analysis_fps" in data
    assert "source_fps" in data
    assert "sampling_mode" in data
    assert data["analysis_fps"] > 0
    assert data["sampling_mode"] in ("normal", "motion_dense")

