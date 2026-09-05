import pytest

from backend.contracts.models import BoundingBox
from backend.world_model.geometry import (
    bbox_center,
    bbox_is_degenerate,
    euclidean_distance,
    horizontal_overlap_ratio,
    intersection_over_union,
    normalize_bbox,
    point_in_polygon,
)


def test_normalize_bbox_scales_by_frame_size():
    bbox = BoundingBox(x1=128.0, y1=72.0, x2=640.0, y2=360.0)
    normalized = normalize_bbox(bbox, frame_width=1280, frame_height=720)

    assert normalized.x1 == pytest.approx(0.1)
    assert normalized.y1 == pytest.approx(0.1)
    assert normalized.x2 == pytest.approx(0.5)
    assert normalized.y2 == pytest.approx(0.5)


@pytest.mark.parametrize("width,height", [(0, 720), (1280, 0), (-1, 720)])
def test_normalize_bbox_rejects_non_positive_frame_size(width, height):
    bbox = BoundingBox(x1=0, y1=0, x2=10, y2=10)
    with pytest.raises(ValueError):
        normalize_bbox(bbox, frame_width=width, frame_height=height)


def test_bbox_center_is_midpoint():
    bbox = BoundingBox(x1=0.2, y1=0.4, x2=0.6, y2=0.8)
    assert bbox_center(bbox) == pytest.approx((0.4, 0.6))


@pytest.mark.parametrize(
    "bbox",
    [
        BoundingBox(x1=0.5, y1=0.0, x2=0.5, y2=1.0),  # zero width
        BoundingBox(x1=0.0, y1=0.5, x2=1.0, y2=0.5),  # zero height
        BoundingBox(x1=0.6, y1=0.0, x2=0.4, y2=1.0),  # inverted x
        BoundingBox(x1=0.0, y1=0.6, x2=1.0, y2=0.4),  # inverted y
    ],
)
def test_bbox_is_degenerate_detects_invalid_geometry(bbox):
    assert bbox_is_degenerate(bbox) is True


def test_bbox_is_degenerate_false_for_valid_box():
    bbox = BoundingBox(x1=0.1, y1=0.1, x2=0.5, y2=0.5)
    assert bbox_is_degenerate(bbox) is False


def test_euclidean_distance():
    assert euclidean_distance((0.0, 0.0), (3.0, 4.0)) == pytest.approx(5.0)


def test_euclidean_distance_zero_for_same_point():
    assert euclidean_distance((0.3, 0.7), (0.3, 0.7)) == pytest.approx(0.0)


def test_iou_of_identical_boxes_is_one():
    bbox = BoundingBox(x1=0.1, y1=0.1, x2=0.5, y2=0.5)
    assert intersection_over_union(bbox, bbox) == pytest.approx(1.0)


def test_iou_of_disjoint_boxes_is_zero():
    a = BoundingBox(x1=0.0, y1=0.0, x2=0.1, y2=0.1)
    b = BoundingBox(x1=0.5, y1=0.5, x2=0.6, y2=0.6)
    assert intersection_over_union(a, b) == 0.0


def test_iou_of_partially_overlapping_boxes():
    a = BoundingBox(x1=0.0, y1=0.0, x2=0.2, y2=0.2)  # area 0.04
    b = BoundingBox(x1=0.1, y1=0.1, x2=0.3, y2=0.3)  # area 0.04
    # intersection: [0.1,0.2]x[0.1,0.2] = 0.01; union = 0.04+0.04-0.01 = 0.07
    assert intersection_over_union(a, b) == pytest.approx(0.01 / 0.07)


def test_iou_degenerate_box_is_zero():
    a = BoundingBox(x1=0.5, y1=0.5, x2=0.5, y2=0.5)  # zero area
    b = BoundingBox(x1=0.4, y1=0.4, x2=0.6, y2=0.6)
    assert intersection_over_union(a, b) == 0.0


def test_horizontal_overlap_ratio_full_overlap_of_narrower_box():
    wide = BoundingBox(x1=0.0, y1=0.0, x2=1.0, y2=0.1)
    narrow = BoundingBox(x1=0.4, y1=0.0, x2=0.6, y2=0.1)
    assert horizontal_overlap_ratio(wide, narrow) == pytest.approx(1.0)


def test_horizontal_overlap_ratio_no_overlap_is_zero():
    a = BoundingBox(x1=0.0, y1=0.0, x2=0.2, y2=0.1)
    b = BoundingBox(x1=0.5, y1=0.0, x2=0.7, y2=0.1)
    assert horizontal_overlap_ratio(a, b) == 0.0


def test_horizontal_overlap_ratio_partial():
    a = BoundingBox(x1=0.0, y1=0.0, x2=0.4, y2=0.1)  # width 0.4
    b = BoundingBox(x1=0.2, y1=0.0, x2=0.5, y2=0.1)  # width 0.3, narrower
    # overlap = [0.2, 0.4] = 0.2; narrower width = 0.3
    assert horizontal_overlap_ratio(a, b) == pytest.approx(0.2 / 0.3)


def test_point_in_polygon_inside_square():
    square = [(0.0, 0.0), (1.0, 0.0), (1.0, 1.0), (0.0, 1.0)]
    assert point_in_polygon((0.5, 0.5), square) is True


def test_point_in_polygon_outside_square():
    square = [(0.0, 0.0), (0.2, 0.0), (0.2, 0.2), (0.0, 0.2)]
    assert point_in_polygon((0.9, 0.9), square) is False


def test_point_in_polygon_fewer_than_three_points_is_false():
    assert point_in_polygon((0.5, 0.5), [(0.0, 0.0), (1.0, 1.0)]) is False
