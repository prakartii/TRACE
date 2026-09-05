"""Extracts the pilot annotation dataset's source frames from the real
challenge videos, plus a grid-overlaid copy of each for manual bounding-
box estimation (temporary, not committed).

Timestamps below were hand-selected (not auto-sampled) by first reviewing
each video for scenario/occlusion/scale diversity per video — see
training/README.md for the reasoning and the resulting train/val video
split. This script only does the mechanical extraction + provenance
bookkeeping; it does not decide what's "diverse", a human judgment call
already made when picking the timestamp list below.

Outputs:
  data/pilot_annotations/images/<frame_id>.jpg   (real frame, kept)
  data/pilot_annotations/manifest.json           (provenance, kept)
  <grid_dir>/<frame_id>_grid.jpg                  (annotation aid, NOT kept —
                                                    written to a scratch dir,
                                                    not the repo)
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import cv2

REPO_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO_ROOT))

from backend.video.registry import VideoRegistry  # noqa: E402

OUT_DIR = REPO_ROOT / "data" / "pilot_annotations"
IMAGES_DIR = OUT_DIR / "images"
GRID_DIR = Path(
    r"C:\Users\prakarti\AppData\Local\Temp\claude\C--Users-prakarti-Desktop-projects-TRACE"
    r"\78bbbcc6-827b-4fb4-9ea4-f63ba07006d8\scratchpad\annotation_grids"
)

# (video filename substring, split, [(frame_id_suffix, timestamp_seconds), ...])
PLAN = [
    (
        "Dock level, dragging cupboard.mp4",
        "train",
        [
            ("t00", 0.5), ("t01", 3.1), ("t02", 8.0), ("t03", 12.4), ("t04", 16.0),
            ("t05", 19.0), ("t06", 21.7), ("t07", 24.0), ("t08", 27.9), ("t09", 30.0),
        ],
    ),
    (
        "Rolling and dragging on wet floor.mp4",
        "train",
        [("t00", 0.6), ("t01", 2.4), ("t02", 4.3), ("t03", 5.5)],
    ),
    (
        "Rolling and dropping carton.mp4",
        "train",
        [
            ("t00", 0.3), ("t01", 1.5), ("t02", 3.8),
            ("t03", 5.5), ("t04", 6.6), ("t05", 8.5),
        ],
    ),
    (
        "Stepping on cartons, vertical product kept horizontally, heavy product kept on top.mp4",
        "train",
        [
            ("t00", 2.0), ("t01", 4.9), ("t02", 8.0), ("t03", 12.0), ("t04", 17.0),
            ("t05", 20.0), ("t06", 25.0), ("t07", 30.0), ("t08", 34.3), ("t09", 38.0),
            ("t10", 40.0), ("t11", 44.1), ("t12", 46.0), ("t13", 48.0),
        ],
    ),
    (
        "KD packets dragged, heavy box kept on other packets.mp4",
        "val",
        [
            ("t00", 0.0), ("t01", 3.4), ("t02", 5.0), ("t03", 7.0), ("t04", 10.0),
            ("t05", 13.5), ("t06", 20.0), ("t07", 23.6), ("t08", 27.0), ("t09", 30.4),
        ],
    ),
    (
        "Throwing seating cartons, using strap to hold.mp4",
        "val",
        [
            ("t00", 0.0), ("t01", 1.5), ("t02", 3.5), ("t03", 6.0),
            ("t04", 8.0), ("t05", 10.5), ("t06", 13.5), ("t07", 14.5),
        ],
    ),
]


def draw_grid(image, step: int = 80):
    grid = image.copy()
    h, w = grid.shape[:2]
    color = (0, 255, 255)
    for x in range(0, w, step):
        cv2.line(grid, (x, 0), (x, h), color, 1, cv2.LINE_AA)
        cv2.putText(grid, str(x), (x + 2, 14), cv2.FONT_HERSHEY_SIMPLEX, 0.4, color, 1)
    for y in range(0, h, step):
        cv2.line(grid, (0, y), (w, y), color, 1, cv2.LINE_AA)
        cv2.putText(grid, str(y), (2, y + 14), cv2.FONT_HERSHEY_SIMPLEX, 0.4, color, 1)
    return grid


def main():
    IMAGES_DIR.mkdir(parents=True, exist_ok=True)
    GRID_DIR.mkdir(parents=True, exist_ok=True)

    registry = VideoRegistry()
    by_name = {r.filename: r for r in registry.list_videos()}

    manifest = []
    for video_filename, split, timestamps in PLAN:
        record = by_name[video_filename]
        source = registry.open_source(record.id)
        prefix = "".join(c if c.isalnum() else "_" for c in video_filename[:24]).strip("_")
        for suffix, ts in timestamps:
            frame = source.get_frame(ts)
            frame_id = f"{prefix}_{suffix}"
            img_path = IMAGES_DIR / f"{frame_id}.jpg"
            cv2.imwrite(str(img_path), frame.image)

            grid_img = draw_grid(frame.image)
            cv2.imwrite(str(GRID_DIR / f"{frame_id}_grid.jpg"), grid_img)

            manifest.append(
                {
                    "frame_id": frame_id,
                    "video_id": record.id,
                    "video_filename": video_filename,
                    "timestamp": ts,
                    "split": split,
                    "width": record.metadata.width,
                    "height": record.metadata.height,
                    "image_path": f"images/{frame_id}.jpg",
                    "label_path": f"labels/{frame_id}.txt",
                    "annotated_by": None,  # filled in during annotation
                    "notes": None,
                }
            )
        source.close()
        print(f"{video_filename}: {len(timestamps)} frames extracted ({split})")

    with open(OUT_DIR / "manifest.json", "w") as f:
        json.dump(manifest, f, indent=2)

    print(f"\nTotal frames: {len(manifest)}")
    print(f"Images: {IMAGES_DIR}")
    print(f"Grid overlays (annotation aid, not committed): {GRID_DIR}")
    print(f"Manifest: {OUT_DIR / 'manifest.json'}")


if __name__ == "__main__":
    main()
