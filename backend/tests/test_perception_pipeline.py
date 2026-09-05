"""Tests for backend/perception/pipeline.py.

Uses a scripted fake detector (no model weights) over tiny generated
video fixtures (backend/tests/video_test_fixtures.py) so the sampling
math, max-sample cap, and cross-frame track ID persistence are all
verified deterministically and cheaply.
"""

from backend.perception.config import PerceptionConfig
from backend.perception.detector import RawDetection
from backend.perception.pipeline import PerceptionPipeline
from backend.perception.tracker import ObjectTracker
from backend.tests.perception_test_fixtures import ScriptedDetector
from backend.tests.video_test_fixtures import make_test_video
from backend.video.source import LocalMP4VideoSource


def test_process_frame_returns_result_with_correct_metadata(tmp_path):
    video_path = make_test_video(tmp_path / "clip.mp4", frame_count=5, fps=10.0)
    source = LocalMP4VideoSource("clip-id", video_path)
    frame = source.get_frame(0.0)
    source.close()

    detector = ScriptedDetector([[RawDetection("person", 0.9, 1, 1, 5, 5)]])
    pipeline = PerceptionPipeline(config=PerceptionConfig(), detector=detector)
    tracker = ObjectTracker(PerceptionConfig())

    result = pipeline.process_frame(frame, tracker)

    assert result.source_id == "clip-id"
    assert result.timestamp == 0.0
    assert result.frame_index == 0


def test_process_video_maintains_stable_track_id_across_samples(tmp_path):
    video_path = make_test_video(
        tmp_path / "clip.mp4", frame_count=30, fps=10.0, width=64, height=48
    )
    source = LocalMP4VideoSource("clip-id", video_path)

    # A single slowly-moving detection, one entry per expected iter_frames call.
    scripted = [
        [RawDetection("person", 0.9, 10 + i, 10, 50 + i, 100)] for i in range(10)
    ]
    detector = ScriptedDetector(scripted)
    pipeline = PerceptionPipeline(
        config=PerceptionConfig(default_sample_fps=2.0, max_samples_per_run=50),
        detector=detector,
    )

    results = pipeline.process_video(source)
    source.close()

    assert len(results) > 0
    all_track_ids = {e.track_id for r in results for e in r.entities}
    assert len(all_track_ids) == 1


def test_process_video_sample_fps_controls_result_count(tmp_path):
    video_path = make_test_video(tmp_path / "clip.mp4", frame_count=30, fps=10.0)
    source = LocalMP4VideoSource("clip-id", video_path)

    detector = ScriptedDetector([[] for _ in range(20)])
    pipeline = PerceptionPipeline(
        config=PerceptionConfig(max_samples_per_run=50), detector=detector
    )

    # sample_fps=2 over a 3s/10fps video -> frame_step=5 -> samples at 0,5,10,15,20,25
    results = pipeline.process_video(source, sample_fps=2.0)
    source.close()

    assert len(results) == 6
    assert [r.frame_index for r in results] == [0, 5, 10, 15, 20, 25]


def test_process_video_respects_max_samples_cap(tmp_path):
    video_path = make_test_video(tmp_path / "clip.mp4", frame_count=60, fps=10.0)
    source = LocalMP4VideoSource("clip-id", video_path)

    detector = ScriptedDetector([[] for _ in range(20)])
    pipeline = PerceptionPipeline(
        config=PerceptionConfig(default_sample_fps=5.0, max_samples_per_run=3),
        detector=detector,
    )

    results = pipeline.process_video(source)
    source.close()

    assert len(results) == 3


def test_process_video_with_no_detections_returns_empty_entities(tmp_path):
    video_path = make_test_video(tmp_path / "clip.mp4", frame_count=20, fps=10.0)
    source = LocalMP4VideoSource("clip-id", video_path)

    detector = ScriptedDetector([[] for _ in range(10)])
    pipeline = PerceptionPipeline(
        config=PerceptionConfig(default_sample_fps=2.0), detector=detector
    )

    results = pipeline.process_video(source)
    source.close()

    assert len(results) > 0
    assert all(r.entities == [] for r in results)


def test_process_video_results_are_chronologically_ordered(tmp_path):
    video_path = make_test_video(tmp_path / "clip.mp4", frame_count=30, fps=10.0)
    source = LocalMP4VideoSource("clip-id", video_path)

    detector = ScriptedDetector([[] for _ in range(10)])
    pipeline = PerceptionPipeline(
        config=PerceptionConfig(default_sample_fps=2.0), detector=detector
    )

    results = pipeline.process_video(source)
    source.close()

    timestamps = [r.timestamp for r in results]
    assert timestamps == sorted(timestamps)
