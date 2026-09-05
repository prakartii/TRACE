import shutil

from backend.tests.video_test_fixtures import make_test_video
from backend.video.registry import VideoRegistry, make_source_id


def test_discovers_only_mp4_files(tmp_path):
    make_test_video(tmp_path / "one.mp4", frame_count=5)
    make_test_video(tmp_path / "two.mp4", frame_count=5, seed=1)
    (tmp_path / "readme.txt").write_text("not a video")

    registry = VideoRegistry(video_dir=tmp_path)
    filenames = {r.filename for r in registry.list_videos()}

    assert filenames == {"one.mp4", "two.mp4"}


def test_registry_never_hardcodes_filenames(tmp_path):
    """Discovery must reflect whatever is on disk, not a fixed filename list."""
    make_test_video(tmp_path / "totally_unexpected_name_123.mp4", frame_count=5)

    registry = VideoRegistry(video_dir=tmp_path)
    filenames = {r.filename for r in registry.list_videos()}

    assert filenames == {"totally_unexpected_name_123.mp4"}


def test_source_id_is_deterministic_across_rescans(tmp_path):
    make_test_video(tmp_path / "stable.mp4", frame_count=5)

    registry = VideoRegistry(video_dir=tmp_path)
    id_first_scan = registry.list_videos()[0].id
    registry.refresh()
    id_second_scan = registry.list_videos()[0].id

    assert id_first_scan == id_second_scan
    assert id_first_scan == make_source_id("stable.mp4")


def test_duplicate_content_is_marked_not_treated_as_unique(tmp_path):
    make_test_video(tmp_path / "a_original.mp4", frame_count=8, seed=42)
    shutil.copyfile(tmp_path / "a_original.mp4", tmp_path / "z_copy.mp4")

    registry = VideoRegistry(video_dir=tmp_path)
    by_name = {r.filename: r for r in registry.list_videos()}

    assert by_name["a_original.mp4"].duplicate_of is None
    assert by_name["z_copy.mp4"].duplicate_of == by_name["a_original.mp4"].id


def test_distinct_content_is_not_marked_duplicate(tmp_path):
    make_test_video(tmp_path / "one.mp4", frame_count=8, seed=1)
    make_test_video(tmp_path / "two.mp4", frame_count=8, seed=99)

    registry = VideoRegistry(video_dir=tmp_path)
    for record in registry.list_videos():
        assert record.duplicate_of is None


def test_unreadable_file_is_skipped_without_crashing(tmp_path):
    make_test_video(tmp_path / "good.mp4", frame_count=5)
    (tmp_path / "corrupt.mp4").write_bytes(b"this is not a real video file")

    registry = VideoRegistry(video_dir=tmp_path)
    filenames = {r.filename for r in registry.list_videos()}

    assert filenames == {"good.mp4"}


def test_empty_directory_returns_no_videos(tmp_path):
    registry = VideoRegistry(video_dir=tmp_path)
    assert registry.list_videos() == []


def test_missing_directory_returns_no_videos(tmp_path):
    registry = VideoRegistry(video_dir=tmp_path / "does_not_exist")
    assert registry.list_videos() == []


def test_get_returns_none_for_unknown_id(tmp_path):
    make_test_video(tmp_path / "one.mp4", frame_count=5)
    registry = VideoRegistry(video_dir=tmp_path)

    assert registry.get("not-a-real-id") is None


def test_get_returns_record_with_no_filesystem_path_in_public_contract(tmp_path):
    make_test_video(tmp_path / "one.mp4", frame_count=5)
    registry = VideoRegistry(video_dir=tmp_path)
    record = registry.list_videos()[0]

    public = record.to_public()

    assert not hasattr(public, "path")
    assert "path" not in public.model_dump()


def test_open_source_returns_working_source(tmp_path):
    make_test_video(tmp_path / "one.mp4", frame_count=5)
    registry = VideoRegistry(video_dir=tmp_path)
    record = registry.list_videos()[0]

    source = registry.open_source(record.id)
    frame = source.get_frame(0.0)
    source.close()

    assert frame.source_id == record.id
