from backend.behaviour.recognizer import _ankles_on_carton, recognize_stepping_on_carton
from backend.contracts.models import (
    BoundingBox,
    Entity,
    EntityClass,
    EpistemicLevel,
    PerceptionFrameResult,
)
from backend.perception.adapter import tracked_objects_to_entities
from backend.perception.config import PerceptionConfig, TRACE_PILOT_IDENTITY
from backend.perception.pose import COCO_KEYPOINTS, COCO_LIMBS, PersonPose, YoloPoseEstimator
from backend.perception.tracker import TrackedObject
from backend.world_model.temporal import TrackHistory, TrackSample, build_track_histories


def _keypoints_with_ankles(ankle_l, ankle_r):
    """Build 17 COCO keypoints with given ankle positions; the rest at origin."""
    kpts = [(0.0, 0.0)] * 17
    kpts[15] = ankle_l
    kpts[16] = ankle_r
    return tuple(kpts)


def test_coco_keypoints_have_17_entries():
    assert len(COCO_KEYPOINTS) == 17
    for a, b in COCO_LIMBS:
        assert 0 <= a < 17 and 0 <= b < 17


def test_pose_attached_to_person_by_iou():
    tracked = [
        TrackedObject(track_id=1, class_name="person", confidence=0.8, x1=10, y1=10, x2=110, y2=310)
    ]
    kpts = [(float(i), float(i)) for i in range(17)]
    pose_persons = [PersonPose(bbox=(10.0, 10.0, 110.0, 310.0), keypoints=kpts, confidence=0.9)]

    entities = tracked_objects_to_entities(
        tracked, source_id="vid1", timestamp=0.0, pose_persons=pose_persons
    )

    assert entities[0].keypoints == kpts


def test_pose_not_attached_when_no_overlap():
    tracked = [
        TrackedObject(track_id=1, class_name="person", confidence=0.8, x1=10, y1=10, x2=110, y2=310)
    ]
    pose_persons = [
        PersonPose(bbox=(500.0, 500.0, 600.0, 600.0), keypoints=[(0.0, 0.0)] * 17, confidence=0.9)
    ]

    entities = tracked_objects_to_entities(
        tracked, source_id="vid1", timestamp=0.0, pose_persons=pose_persons
    )

    assert entities[0].keypoints is None


def test_pose_not_attached_to_non_person():
    tracked = [
        TrackedObject(track_id=2, class_name="box", confidence=0.7, x1=10, y1=10, x2=110, y2=110)
    ]
    pose_persons = [
        PersonPose(bbox=(10.0, 10.0, 110.0, 110.0), keypoints=[(0.0, 0.0)] * 17, confidence=0.9)
    ]

    entities = tracked_objects_to_entities(
        tracked,
        source_id="vid1",
        timestamp=0.0,
        model_identity=TRACE_PILOT_IDENTITY,
        pose_persons=pose_persons,
    )

    assert entities[0].keypoints is None


def test_pose_estimator_degrades_when_disabled(tmp_path):
    cfg = PerceptionConfig(pose_enabled=False, pose_model_path=tmp_path / "nope.pt")
    est = YoloPoseEstimator(cfg)
    import numpy as np

    assert est.estimate(np.zeros((64, 64, 3), dtype="uint8")) == []


def test_build_track_histories_normalizes_keypoints():
    entity = Entity(
        id="vid:1",
        track_id="1",
        entity_class=EntityClass.PERSON,
        bbox=BoundingBox(x1=100, y1=100, x2=200, y2=300),
        confidence=0.9,
        timestamp=0.0,
        keypoints=[(128.0, 72.0)] * 17,
    )
    frame = PerceptionFrameResult(source_id="vid", timestamp=0.0, entities=[entity])

    histories = build_track_histories([frame], frame_width=1280, frame_height=720)

    sample = histories["vid:1"].samples[0]
    assert sample.keypoints is not None
    assert len(sample.keypoints) == 17
    assert sample.keypoints[0] == (128.0 / 1280, 72.0 / 720)


def test_ankles_on_carton_detects_feet_on_box_top():
    box = BoundingBox(x1=0.3, y1=0.5, x2=0.5, y2=0.6)
    sample = TrackSample(
        timestamp=0.0,
        position=(0.4, 0.3),
        confidence=0.9,
        keypoints=_keypoints_with_ankles((0.4, 0.48), (0.42, 0.49)),
    )
    assert _ankles_on_carton(sample, box) is True


def test_ankles_on_carton_rejects_ankles_on_floor():
    box = BoundingBox(x1=0.3, y1=0.5, x2=0.5, y2=0.6)
    sample = TrackSample(
        timestamp=0.0,
        position=(0.4, 0.7),
        confidence=0.9,
        keypoints=_keypoints_with_ankles((0.4, 0.9), (0.42, 0.91)),
    )
    assert _ankles_on_carton(sample, box) is False


def test_stepping_on_carton_observed_when_pose_confirms():
    person = TrackHistory(
        entity_id="vid:p",
        entity_class=EntityClass.PERSON,
        samples=[
            TrackSample(
                timestamp=0.0,
                position=(0.4, 0.3),
                confidence=0.9,
                footprint=BoundingBox(x1=0.35, y1=0.2, x2=0.45, y2=0.55),
                keypoints=_keypoints_with_ankles((0.4, 0.48), (0.42, 0.49)),
            )
        ],
    )
    box = TrackHistory(
        entity_id="vid:b",
        entity_class=EntityClass.BOX,
        samples=[
            TrackSample(
                timestamp=0.0,
                position=(0.4, 0.55),
                confidence=0.8,
                footprint=BoundingBox(x1=0.3, y1=0.5, x2=0.5, y2=0.6),
            )
        ],
    )

    finding = recognize_stepping_on_carton(box, person, sustained=True)

    assert finding is not None
    assert finding["scenario"] == "stepping_on_carton_precursor"
    assert finding["epistemic_level"] == EpistemicLevel.OBSERVED
    assert finding["evidence"]["pose_confirmed"] is True
