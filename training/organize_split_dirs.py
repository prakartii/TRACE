"""Reorganizes data/pilot_annotations/{images,labels}/ into
{images,labels}/{train,val}/ subdirectories — the layout Ultralytics
expects for a dataset.yaml with separate train/val image directories.
Run once, after build_yolo_labels.py. Idempotent (skips already-moved
files).
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO_ROOT))

DATA_DIR = REPO_ROOT / "data" / "pilot_annotations"


def main():
    manifest = json.loads((DATA_DIR / "manifest.json").read_text())

    for entry in manifest:
        split = entry["split"]
        for kind, old_dirname in (("image_path", "images"), ("label_path", "labels")):
            old_path = DATA_DIR / entry[kind]
            new_rel = f"{old_dirname}/{split}/{old_path.name}"
            new_path = DATA_DIR / new_rel
            new_path.parent.mkdir(parents=True, exist_ok=True)
            if old_path.exists() and not new_path.exists():
                old_path.rename(new_path)
            entry[kind] = new_rel

    (DATA_DIR / "manifest.json").write_text(json.dumps(manifest, indent=2))
    print("Reorganized into images/{train,val}/ and labels/{train,val}/")


if __name__ == "__main__":
    main()
