"""Semi-automatic bootstrap labelling — grow the pilot dataset past 52 frames.

The honest bottleneck for the v2 fine-tune is labelled data, not code. This
script uses the current pilot model (person/box/pallet) as a *teacher* to
propose labels on freshly extracted frames at a STRICT confidence floor, then
writes them flagged for human review (``annotated_by = "auto-bootstrap"``).

Deliberate honesty guard: auto-box/pallet labels are only proposals — the pilot
box class tests at mAP50 ~0.22, so its low-confidence output is thrown away and
even its high-confidence output is marked "review", never treated as ground
truth. This is a bootstrap to shrink manual effort, not a replacement for it.

Usage (repo root, venv active):
    python training/auto_label.py --frames-per-video 20 --confidence 0.5

Output: data/pilot_annotations/images/*.jpg + labels/*.txt (auto-labeled),
plus a manifest.json entry per frame with provenance.
"""

from __future__ import annotations

import argparse
import json
import sys
from dataclasses import replace
from pathlib import Path

import cv2

REPO_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO_ROOT))

from backend.perception.config import PILOT_CONFIG  # noqa: E402
from backend.perception.detector import YoloDetector  # noqa: E402
from backend.video.registry import VideoRegistry  # noqa: E402

DATA_DIR = REPO_ROOT / "data" / "pilot_annotations"
IMAGES_DIR = DATA_DIR / "images"
LABELS_DIR = DATA_DIR / "labels"

CLASS_IDS = {"person": 0, "box": 1, "pallet": 2}


def to_yolo_line(class_id, x1, y1, x2, y2, w, h):
    cx = ((x1 + x2) / 2) / w
    cy = ((y1 + y2) / 2) / h
    bw = (x2 - x1) / w
    bh = (y2 - y1) / h
    return f"{class_id} {cx:.6f} {cy:.6f} {bw:.6f} {bh:.6f}"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--frames-per-video", type=int, default=20)
    ap.add_argument("--confidence", type=float, default=0.5)
    ap.add_argument("--split", default="train", choices=["train", "val"])
    args = ap.parse_args()

    IMAGES_DIR.mkdir(parents=True, exist_ok=True)
    LABELS_DIR.mkdir(parents=True, exist_ok=True)

    detector = YoloDetector(replace(PILOT_CONFIG, confidence_threshold=args.confidence))
    registry = VideoRegistry()

    manifest = []
    for record in registry.list_videos():
        if record.duplicate_of:
            continue
        source = registry.open_source(record.id)
        meta = record.metadata
        duration = meta.duration
        if duration <= 0:
            source.close()
            continue
        n = args.frames_per_video
        prefix = "".join(c if c.isalnum() else "_" for c in record.filename[:24]).strip("_")
        for k in range(n):
            ts = duration * (k + 1) / (n + 1)
            frame = source.get_frame(ts)
            frame_id = f"{prefix}_auto{k:02d}"
            img_path = IMAGES_DIR / f"{frame_id}.jpg"
            cv2.imwrite(str(img_path), frame.image)

            lines = []
            for det in detector.detect(frame.image):
                if det.class_name in CLASS_IDS:
                    lines.append(
                        to_yolo_line(CLASS_IDS[det.class_name], det.x1, det.y1, det.x2, det.y2, meta.width, meta.height)
                    )
            (LABELS_DIR / f"{frame_id}.txt").write_text("\n".join(lines) + ("\n" if lines else ""))

            manifest.append({
                "frame_id": frame_id,
                "video_id": record.id,
                "video_filename": record.filename,
                "timestamp": round(ts, 3),
                "split": args.split,
                "width": meta.width,
                "height": meta.height,
                "image_path": f"images/{frame_id}.jpg",
                "label_path": f"labels/{frame_id}.txt",
                "annotated_by": f"auto-bootstrap (pilot model, conf>={args.confidence}) — REQUIRES REVIEW",
            })
        source.close()
        print(f"{record.filename}: {n} frames auto-labeled")

    out = DATA_DIR / "manifest_auto.json"
    out.write_text(json.dumps(manifest, indent=2))
    print(f"\n{len(manifest)} frames written; provenance: {out}")


if __name__ == "__main__":
    main()
