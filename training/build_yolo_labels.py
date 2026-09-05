"""Merges manual BOX/PALLET annotations (training/pilot_annotations_data.py)
with auto-generated PERSON labels (from the stock, already-validated
YOLOv8n COCO model, at a strict confidence floor) into final YOLO-format
label files for the pilot fine-tune.

Why auto-label PERSON instead of only manually drawing box/pallet: fine-
tuning on a dataset.yaml with only {box, pallet} would train a brand new
2-class detection head from scratch, discarding the pretrained person
capability entirely (catastrophic forgetting by construction, not just in
practice) — see training/README.md's "why 3 classes" section. Reusing the
stock detector's own high-confidence output (>=0.5, well above the 0.25
production threshold, chosen specifically to avoid propagating any of the
low-confidence noise the Phase 4 gate audit documented) as person ground
truth is a standard regression-preservation technique: it is not claiming
new capability, only carrying forward behavior already measured as good.

Class ids: 0=person, 1=box, 2=pallet.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import cv2

REPO_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO_ROOT))

from backend.perception.config import PerceptionConfig  # noqa: E402
from backend.perception.detector import YoloDetector  # noqa: E402
from training.pilot_annotations_data import ANNOTATIONS  # noqa: E402

DATA_DIR = REPO_ROOT / "data" / "pilot_annotations"
IMAGES_DIR = DATA_DIR / "images"
LABELS_DIR = DATA_DIR / "labels"

CLASS_IDS = {"person": 0, "box": 1, "pallet": 2}
PERSON_LABEL_CONFIDENCE_FLOOR = 0.5  # well above the 0.25 production threshold


def to_yolo_line(class_id: int, x1: float, y1: float, x2: float, y2: float, w: int, h: int) -> str:
    cx = ((x1 + x2) / 2) / w
    cy = ((y1 + y2) / 2) / h
    bw = (x2 - x1) / w
    bh = (y2 - y1) / h
    return f"{class_id} {cx:.6f} {cy:.6f} {bw:.6f} {bh:.6f}"


def main():
    LABELS_DIR.mkdir(parents=True, exist_ok=True)
    manifest = json.loads((DATA_DIR / "manifest.json").read_text())

    person_detector = YoloDetector(PerceptionConfig(confidence_threshold=PERSON_LABEL_CONFIDENCE_FLOOR))

    instance_counts = {"train": {"person": 0, "box": 0, "pallet": 0}, "val": {"person": 0, "box": 0, "pallet": 0}}
    frames_with_no_labels = []

    for entry in manifest:
        frame_id = entry["frame_id"]
        split = entry["split"]
        w, h = entry["width"], entry["height"]
        image_path = DATA_DIR / entry["image_path"]
        image = cv2.imread(str(image_path))

        lines = []

        # Auto person labels (regression-preservation, not new capability).
        person_boxes = 0
        for det in person_detector.detect(image):
            if det.class_name != "person":
                continue
            lines.append(to_yolo_line(CLASS_IDS["person"], det.x1, det.y1, det.x2, det.y2, w, h))
            person_boxes += 1

        # Manual box/pallet annotations.
        manual = ANNOTATIONS.get(frame_id, {})
        box_boxes = len(manual.get("box", []))
        pallet_boxes = len(manual.get("pallet", []))
        for x1, y1, x2, y2 in manual.get("box", []):
            lines.append(to_yolo_line(CLASS_IDS["box"], x1, y1, x2, y2, w, h))
        for x1, y1, x2, y2 in manual.get("pallet", []):
            lines.append(to_yolo_line(CLASS_IDS["pallet"], x1, y1, x2, y2, w, h))

        label_path = DATA_DIR / entry["label_path"]
        label_path.write_text("\n".join(lines) + ("\n" if lines else ""))

        entry["annotated_by"] = (
            f"person: auto-labeled from stock YOLOv8n COCO model (conf>={PERSON_LABEL_CONFIDENCE_FLOOR}); "
            "box/pallet: manual visual annotation (grid-overlay pixel estimation) by the reviewing session"
        )
        entry["instance_counts"] = {"person": person_boxes, "box": box_boxes, "pallet": pallet_boxes}

        instance_counts[split]["person"] += person_boxes
        instance_counts[split]["box"] += box_boxes
        instance_counts[split]["pallet"] += pallet_boxes

        if not lines:
            frames_with_no_labels.append(frame_id)

    (DATA_DIR / "manifest.json").write_text(json.dumps(manifest, indent=2))

    print("Instance counts by split/class:")
    for split, counts in instance_counts.items():
        print(f"  {split}: {counts}")
    print(f"\nFrames with zero labels of any class (honest negatives / auto-label misses): {frames_with_no_labels}")


if __name__ == "__main__":
    main()
