from backend.tests.video_test_fixtures import (
    make_moov_with_handler,
    make_test_video,
)
from backend.video.mp4_probe import probe_has_audio_track


def test_detects_audio_handler_in_synthetic_moov(tmp_path):
    path = tmp_path / "fake_with_audio.mp4"
    path.write_bytes(make_moov_with_handler(b"soun"))

    assert probe_has_audio_track(path) is True


def test_video_only_handler_reports_no_audio(tmp_path):
    path = tmp_path / "fake_video_only.mp4"
    path.write_bytes(make_moov_with_handler(b"vide"))

    assert probe_has_audio_track(path) is False


def test_real_generated_video_without_audio_track(tmp_path):
    path = make_test_video(tmp_path / "silent.mp4", frame_count=5)

    assert probe_has_audio_track(path) is False


def test_missing_file_returns_none(tmp_path):
    assert probe_has_audio_track(tmp_path / "does_not_exist.mp4") is None


def test_empty_file_returns_none(tmp_path):
    path = tmp_path / "empty.mp4"
    path.write_bytes(b"")

    assert probe_has_audio_track(path) is None


def test_garbage_bytes_return_none(tmp_path):
    path = tmp_path / "garbage.mp4"
    path.write_bytes(b"not an mp4 file" * 10)

    assert probe_has_audio_track(path) is None
