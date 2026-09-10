from fastapi.testclient import TestClient

from backend.api.live import LiveSource, register_live_source
from backend.main import app
from backend.tests.video_test_fixtures import make_test_video
from backend.video.source import RTSPVideoSource


def test_rtsp_source_decodes_a_url(tmp_path):
    """RTSPVideoSource is cv2.VideoCapture-based; pointing it at a local MP4
    (which VideoCapture also opens) proves open/metadata/read_next/close work."""
    clip = tmp_path / "live.mp4"
    make_test_video(clip, frame_count=12, fps=10.0)

    source = RTSPVideoSource("cam1", str(clip))
    try:
        source.open()
        meta = source.metadata()
        assert meta.width > 0 and meta.height > 0
        frame = source.read_next()
        assert frame is not None and frame.image is not None
    finally:
        source.close()


def test_live_frame_endpoint(tmp_path):
    clip = tmp_path / "live.mp4"
    make_test_video(clip, frame_count=12, fps=10.0)
    register_live_source(LiveSource(id="cam1", url=str(clip), label="Test camera"))

    client = TestClient(app)
    res = client.get("/api/live/cam1/frame")
    assert res.status_code == 200
    assert res.headers["content-type"] == "image/jpeg"
    assert res.content[:2] == b"\xff\xd8"


def test_live_list_and_unknown_source(tmp_path):
    clip = tmp_path / "live.mp4"
    make_test_video(clip, frame_count=12, fps=10.0)
    register_live_source(LiveSource(id="cam1", url=str(clip), label="Test camera"))

    client = TestClient(app)
    listing = client.get("/api/live").json()
    assert any(s["id"] == "cam1" and s["label"] == "Test camera" for s in listing)

    assert client.get("/api/live/nope/frame").status_code == 404


def test_live_websocket_streams_jpeg(tmp_path):
    clip = tmp_path / "live.mp4"
    make_test_video(clip, frame_count=12, fps=10.0)
    register_live_source(LiveSource(id="cam1", url=str(clip), label="Test camera"))

    client = TestClient(app)
    with client.websocket_connect("/api/live/cam1/stream") as ws:
        data = ws.receive()
        # First message should be a bytes (JPEG) frame, not text.
        assert isinstance(data, dict) and data.get("bytes") is not None
        assert data["bytes"][:2] == b"\xff\xd8"
