import pytest

from backend.contracts.models import BoundingBox, Entity, EntityClass, PerceptionFrameResult
from backend.world_model.temporal import (
    average_speed,
    build_track_histories,
    common_sample_count,
    direction,
    net_displacement,
    sustained_proximity_fraction,
    total_displacement,
    track_continuity_ratio,
)

FRAME_W = 1000
FRAME_H = 1000


def entity(entity_id, x1, y1, x2, y2, entity_class=EntityClass.PERSON, confidence=0.9):
    return Entity(
        id=entity_id,
        track_id=entity_id,
        entity_class=entity_class,
        bbox=BoundingBox(x1=x1, y1=y1, x2=x2, y2=y2),
        confidence=confidence,
        timestamp=0.0,
    )


def frame(timestamp, entities):
    return PerceptionFrameResult(source_id="vid", timestamp=timestamp, entities=entities)


def test_build_track_histories_groups_by_entity_id():
    frames = [
        frame(0.0, [entity("vid:1", 0, 0, 100, 100)]),
        frame(1.0, [entity("vid:1", 50, 0, 150, 100)]),
    ]
    histories = build_track_histories(frames, FRAME_W, FRAME_H)
    assert set(histories.keys()) == {"vid:1"}
    assert len(histories["vid:1"].samples) == 2


def test_build_track_histories_skips_degenerate_bbox():
    frames = [frame(0.0, [entity("vid:1", 100, 100, 100, 200)])]  # zero width
    histories = build_track_histories(frames, FRAME_W, FRAME_H)
    assert histories == {}


def test_total_displacement_sums_consecutive_distances():
    frames = [
        frame(0.0, [entity("vid:1", 0, 0, 100, 100)]),  # center (0.05, 0.05)
        frame(1.0, [entity("vid:1", 100, 0, 200, 100)]),  # center (0.15, 0.05)
        frame(2.0, [entity("vid:1", 200, 0, 300, 100)]),  # center (0.25, 0.05)
    ]
    histories = build_track_histories(frames, FRAME_W, FRAME_H)
    assert total_displacement(histories["vid:1"]) == pytest.approx(0.2)


def test_net_displacement_is_straight_line_not_path_length():
    # moves out and back to the same spot -> net displacement 0, but total > 0
    frames = [
        frame(0.0, [entity("vid:1", 0, 0, 100, 100)]),
        frame(1.0, [entity("vid:1", 200, 0, 300, 100)]),
        frame(2.0, [entity("vid:1", 0, 0, 100, 100)]),
    ]
    histories = build_track_histories(frames, FRAME_W, FRAME_H)
    assert net_displacement(histories["vid:1"]) == pytest.approx(0.0, abs=1e-9)
    assert total_displacement(histories["vid:1"]) > 0.0


def test_single_sample_track_has_zero_displacement_and_no_speed():
    frames = [frame(0.0, [entity("vid:1", 0, 0, 100, 100)])]
    histories = build_track_histories(frames, FRAME_W, FRAME_H)
    h = histories["vid:1"]
    assert total_displacement(h) == 0.0
    assert net_displacement(h) == 0.0
    assert average_speed(h) is None
    assert direction(h) is None


def test_average_speed_is_normalized_per_second():
    frames = [
        frame(0.0, [entity("vid:1", 0, 0, 100, 100)]),  # center (0.05,0.05)
        frame(2.0, [entity("vid:1", 100, 0, 200, 100)]),  # center (0.15,0.05), dt=2s
    ]
    histories = build_track_histories(frames, FRAME_W, FRAME_H)
    assert average_speed(histories["vid:1"]) == pytest.approx(0.1 / 2.0)


def test_direction_is_unit_vector():
    frames = [
        frame(0.0, [entity("vid:1", 0, 0, 100, 100)]),
        frame(1.0, [entity("vid:1", 300, 0, 400, 100)]),  # pure +x movement
    ]
    histories = build_track_histories(frames, FRAME_W, FRAME_H)
    dx, dy = direction(histories["vid:1"])
    assert dx == pytest.approx(1.0)
    assert dy == pytest.approx(0.0)


def test_direction_none_for_stationary_track():
    frames = [
        frame(0.0, [entity("vid:1", 0, 0, 100, 100)]),
        frame(1.0, [entity("vid:1", 0, 0, 100, 100)]),
    ]
    histories = build_track_histories(frames, FRAME_W, FRAME_H)
    assert direction(histories["vid:1"]) is None


def test_track_continuity_ratio():
    frames = [frame(float(i), [entity("vid:1", 0, 0, 100, 100)]) for i in range(3)]
    histories = build_track_histories(frames, FRAME_W, FRAME_H)
    assert track_continuity_ratio(histories["vid:1"], expected_sample_count=6) == pytest.approx(0.5)
    assert track_continuity_ratio(histories["vid:1"], expected_sample_count=0) == 0.0
    assert track_continuity_ratio(histories["vid:1"], expected_sample_count=1) == 1.0  # capped at 1.0


def test_sustained_proximity_fraction_all_close():
    frames = [
        frame(float(i), [entity(f"vid:a", 0, 0, 100, 100), entity(f"vid:b", 50, 0, 150, 100)])
        for i in range(4)
    ]
    histories = build_track_histories(frames, FRAME_W, FRAME_H)
    fraction = sustained_proximity_fraction(histories["vid:a"], histories["vid:b"], threshold=0.5)
    assert fraction == pytest.approx(1.0)


def test_sustained_proximity_fraction_never_close():
    frames = [
        frame(float(i), [entity("vid:a", 0, 0, 50, 50), entity("vid:b", 900, 900, 950, 950)])
        for i in range(4)
    ]
    histories = build_track_histories(frames, FRAME_W, FRAME_H)
    fraction = sustained_proximity_fraction(histories["vid:a"], histories["vid:b"], threshold=0.1)
    assert fraction == 0.0


def test_sustained_proximity_fraction_no_overlap_in_time_is_zero_not_error():
    frames = [
        frame(0.0, [entity("vid:a", 0, 0, 50, 50)]),
        frame(1.0, [entity("vid:b", 0, 0, 50, 50)]),
    ]
    histories = build_track_histories(frames, FRAME_W, FRAME_H)
    fraction = sustained_proximity_fraction(histories["vid:a"], histories["vid:b"], threshold=0.5)
    assert fraction == 0.0


def test_common_sample_count():
    frames = [
        frame(0.0, [entity("vid:a", 0, 0, 50, 50), entity("vid:b", 0, 0, 50, 50)]),
        frame(1.0, [entity("vid:a", 0, 0, 50, 50)]),  # b missing this frame
    ]
    histories = build_track_histories(frames, FRAME_W, FRAME_H)
    assert common_sample_count(histories["vid:a"], histories["vid:b"]) == 1
