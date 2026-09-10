from backend.perception.adapter import tracked_objects_to_entities
from backend.perception.config import PerceptionConfig, TRACE_PILOT_IDENTITY
from backend.perception.pose import COCO_KEYPOINTS, COCO_LIMBS, PersonPose, YoloPoseEstimator
from backend.perception.tracker import TrackedObject


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
