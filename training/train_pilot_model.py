"""Reproducible fine-tuning run for the TRACE pilot perception model.

Starts from stock, pretrained yolov8n.pt (COCO weights — same file used
by the production PerceptionConfig default) and fine-tunes on the small
person+box+pallet pilot dataset built by build_yolo_labels.py +
organize_split_dirs.py. See training/README.md for the full methodology,
class-scope decision, and honesty notes about what this pilot does and
does not prove.

Usage (from repo root, with the project venv active):
    python training/train_pilot_model.py

Output: training/runs/trace_pilot/weights/best.pt, then copied to
models/trace_pilot_v1.pt (gitignored, same as models/yolov8n.pt).
"""

from __future__ import annotations

import shutil
import sys
import tempfile
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO_ROOT))

import numpy as np  # noqa: E402

# Compatibility shim: ultralytics==8.3.40's validation metrics call the
# removed `np.trapz` (dropped in NumPy 2.0, replaced by `np.trapezoid`
# with an identical signature). Our venv resolves numpy==2.5.2
# transitively via torch/ultralytics with no pin of our own, and
# downgrading numpy project-wide risks destabilizing torch/opencv, which
# is a much bigger change than this one call site needs. Scoped to this
# training script only — does not touch backend/ or its dependency pins.
if not hasattr(np, "trapz"):
    np.trapz = np.trapezoid

from ultralytics import YOLO  # noqa: E402

STOCK_WEIGHTS = REPO_ROOT / "models" / "yolov8n.pt"
DATASET_DIR = REPO_ROOT / "data" / "pilot_annotations"
RUNS_DIR = REPO_ROOT / "training" / "runs"
OUTPUT_WEIGHTS = REPO_ROOT / "models" / "trace_pilot_v1.pt"


def _write_resolved_dataset_yaml() -> Path:
    """training/dataset.yaml uses a `path: ../data/pilot_annotations`
    relative reference for readability/portability, but Ultralytics
    resolves a relative `path:` against its own global `datasets_dir`
    setting, not the yaml file's own location — not what we want for a
    project-local dataset. Writes a temp copy with an absolute path
    instead, computed fresh each run so nothing here hardcodes a
    machine-specific path in a committed file."""
    content = (
        f"path: {DATASET_DIR.as_posix()}\n"
        "train: images/train\n"
        "val: images/val\n"
        "names:\n"
        "  0: person\n"
        "  1: box\n"
        "  2: pallet\n"
    )
    tmp = Path(tempfile.gettempdir()) / "trace_pilot_dataset_resolved.yaml"
    tmp.write_text(content)
    return tmp


DATASET_YAML = _write_resolved_dataset_yaml()

TRAIN_CONFIG = dict(
    data=str(DATASET_YAML),
    epochs=100,
    patience=20,  # early stop if val loss plateaus — 34 train images overfits fast
    imgsz=640,  # matches PerceptionConfig.inference_size
    batch=8,
    device="cpu",
    seed=0,
    project=str(RUNS_DIR),
    name="trace_pilot",
    exist_ok=True,
    verbose=True,
)


def main():
    if not STOCK_WEIGHTS.exists():
        raise FileNotFoundError(
            f"Stock weights not found at {STOCK_WEIGHTS}. See README.md for how to "
            "obtain models/yolov8n.pt before fine-tuning from it."
        )

    print(f"Starting from: {STOCK_WEIGHTS}")
    print(f"Dataset: {DATASET_YAML}")
    print(f"Config: {TRAIN_CONFIG}")

    model = YOLO(str(STOCK_WEIGHTS))
    model.train(**TRAIN_CONFIG)

    best = RUNS_DIR / "trace_pilot" / "weights" / "best.pt"
    if not best.exists():
        raise FileNotFoundError(f"Expected trained weights at {best}, not found.")

    shutil.copyfile(best, OUTPUT_WEIGHTS)
    print(f"\nBest weights copied to: {OUTPUT_WEIGHTS}")


if __name__ == "__main__":
    main()
