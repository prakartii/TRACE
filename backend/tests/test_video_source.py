import pytest

from backend.tests.video_test_fixtures import make_test_video
from backend.video.source import LocalMP4VideoSource, VideoDecodeError


@pytest.fixture
def video_path(tmp_path):
    return make_test_video(
        tmp_path / "fixture.mp4", frame_count=30, fps=10.0, width=64, height=48
    )


def test_metadata_matches_written_fixture(video_path):
    with LocalMP4VideoSource("src-1", video_path) as source:
        meta = source.metadata()

    assert meta.width == 64
    assert meta.height == 48
    assert meta.fps == pytest.approx(10.0, abs=0.1)
    assert meta.frame_count == 30
    assert meta.duration == pytest.approx(3.0, abs=0.1)
    assert meta.has_audio is False


def test_get_frame_returns_frame_contract(video_path):
    with LocalMP4VideoSource("src-1", video_path) as source:
        frame = source.get_frame(1.0)

    assert frame.source_id == "src-1"
    assert frame.timestamp == 1.0
    assert frame.frame_index == 10
    assert frame.width == 64
    assert frame.height == 48
    assert frame.image.shape == (48, 64, 3)


def test_get_frame_at_start_and_near_end(video_path):
    with LocalMP4VideoSource("src-1", video_path) as source:
        start = source.get_frame(0.0)
        end = source.get_frame(source.metadata().duration)

    assert start.frame_index == 0
    assert end.frame_index is not None


@pytest.mark.parametrize("bad_timestamp", [-1.0, 999.0])
def test_get_frame_out_of_bounds_raises(video_path, bad_timestamp):
    with LocalMP4VideoSource("src-1", video_path) as source:
        with pytest.raises(ValueError):
            source.get_frame(bad_timestamp)


def test_iter_frames_respects_step_and_range(video_path):
    with LocalMP4VideoSource("src-1", video_path) as source:
        frames = list(source.iter_frames(start_time=0.5, end_time=1.5, frame_step=2))

    indices = [f.frame_index for f in frames]
    assert indices == sorted(indices)
    assert all(i % 2 == 1 for i in indices)  # start_index=5, step=2 -> 5,7,9,...
    assert min(indices) >= 5
    assert max(indices) <= 15


def test_close_is_idempotent_and_reopen_works(video_path):
    source = LocalMP4VideoSource("src-1", video_path)
    source.open()
    source.close()
    source.close()  # must not raise

    source.open()  # must be able to reopen after close
    frame = source.get_frame(0.0)
    assert frame.frame_index == 0
    source.close()


def test_open_nonexistent_file_raises_decode_error(tmp_path):
    source = LocalMP4VideoSource("missing", tmp_path / "does_not_exist.mp4")
    with pytest.raises(VideoDecodeError):
        source.open()


def test_get_frame_auto_opens_source(video_path):
    source = LocalMP4VideoSource("src-1", video_path)
    frame = source.get_frame(0.0)  # no explicit open() call
    assert frame.frame_index == 0
    source.close()
