"""Unit tests for backend/perception/detector.py.

Uses hand-built fake result objects shaped like Ultralytics output — no
model weights or `ultralytics` import required.
"""

from types import SimpleNamespace

import pytest

from backend.perception.config import PerceptionConfig
from backend.perception.detector import RawDetection, YoloDetector, parse_result


def _fake_box(cls_id, conf, xyxy):
    return SimpleNamespace(cls=[cls_id], conf=[conf], xyxy=[xyxy])


def _fake_result(boxes, names):
    return SimpleNamespace(boxes=boxes, names=names)


def test_parse_result_converts_boxes_to_detections():
    names = {0: "person", 1: "truck"}
    boxes = [
        _fake_box(0, 0.9, [10.0, 20.0, 30.0, 40.0]),
        _fake_box(1, 0.5, [1.0, 2.0, 3.0, 4.0]),
    ]
    result = _fake_result(boxes, names)

    detections = parse_result(result, confidence_threshold=0.0)

    assert detections == [
        RawDetection(
            class_name="person", confidence=0.9, x1=10.0, y1=20.0, x2=30.0, y2=40.0
        ),
        RawDetection(
            class_name="truck", confidence=0.5, x1=1.0, y1=2.0, x2=3.0, y2=4.0
        ),
    ]


def test_parse_result_filters_below_confidence_threshold():
    names = {0: "person"}
    boxes = [
        _fake_box(0, 0.9, [0.0, 0.0, 1.0, 1.0]),
        _fake_box(0, 0.1, [0.0, 0.0, 1.0, 1.0]),
    ]
    result = _fake_result(boxes, names)

    detections = parse_result(result, confidence_threshold=0.5)

    assert len(detections) == 1
    assert detections[0].confidence == 0.9


def test_parse_result_confidence_threshold_boundary_is_inclusive():
    names = {0: "person"}
    boxes = [_fake_box(0, 0.5, [0.0, 0.0, 1.0, 1.0])]
    result = _fake_result(boxes, names)

    detections = parse_result(result, confidence_threshold=0.5)

    assert len(detections) == 1


def test_parse_result_empty_boxes_returns_empty_list():
    result = _fake_result([], {})
    assert parse_result(result, confidence_threshold=0.25) == []


def test_yolo_detector_raises_clean_error_for_missing_weights(tmp_path):
    config = PerceptionConfig(model_path=tmp_path / "does_not_exist.pt")
    detector = YoloDetector(config)

    with pytest.raises(FileNotFoundError):
        detector.detect(image=None)
