# TRACE Pilot Perception Model — Training Workflow

Phase 4 gate audit found that Phase 3's perception layer detects `person`
only — the stock COCO-pretrained YOLOv8n has no class that corresponds to
a warehouse box, pallet, or trolley, and occasional wrong-class guesses
(`suitcase`, `book`, `skis`, ...) are discarded, never treated as boxes.
This directory documents and implements the minimum honest remediation:
a small, real, pilot-annotated fine-tune adding `box` and `pallet` as
genuinely detected classes, validated on real held-out challenge footage.

**This is explicitly a pilot, not a production model.** 52 annotated
frames is not enough data to claim general-purpose box/pallet detection.
It is enough to establish — and honestly measure — whether the
capability gap identified by the gate audit can start to close at all.
See "Real-footage validation results" in the Phase 4 remediation report
for the actual measured numbers; don't assume this file's existence
implies success.

## Class scope decision

Before annotating anything, the actual footage was re-inspected
specifically for BOX, PALLET, and TROLLEY visibility (not inferred from
filenames):

- **BOX/CARTON** — clearly, abundantly, cleanly visible across all 8
  videos. Included.
- **PALLET** — clearly visible as a distinct wooden base in most videos
  (`Dock level...`, `KD packets...`, `Rolling and dropping carton...`,
  `Throwing seating cartons...`), though often partially occluded by
  what's stacked on it. Included.
- **TROLLEY** — a pallet jack (red, wheeled) appears clearly in
  `Dock level, dragging cupboard.mp4` at several timestamps, and a
  visually distinct flatbed wheeled cart appears in
  `Throwing seating cartons, using strap to hold.mp4`. **Excluded.**
  These are two visually inconsistent equipment types, each confined to
  a single video, with too few distinct instances of either to
  "reliably" teach one coherent class — annotating them would mean
  memorizing two specific objects, not learning a generalizable
  "trolley" concept. Forcing this in would produce exactly the kind of
  unsupported, overclaimed capability this remediation exists to avoid.
  Documented here rather than silently dropped.
- **Dock edge, floor, wet floor, vehicle bed, orientation, strap,
  hands/feet** — out of scope per the task brief; these need a different
  mechanism (zone calibration, pose estimation) than object detection,
  not attempted here.

**Why person is also in the training set, even though it's not new
capability:** fine-tuning `yolov8n.pt` on a dataset.yaml naming only
`{box, pallet}` replaces the detection head entirely (a fresh N-class
head, not an extension of the 80-class COCO head) — it would not
"forget" person gradually, it would have no person output at all. So
`person` is included as a third class, with its own labels, specifically
to preserve that capability through the fine-tune rather than lose it.
Those person labels are **auto-generated from the stock, already-
validated YOLOv8n model at a strict confidence floor (0.5, well above
the 0.25 production threshold)** — see
`training/build_yolo_labels.py`. This is a standard regression-
preservation technique (distilling already-measured-good behavior into
the new training set), not a claim of new person-detection capability.

## Dataset

**52 frames**, hand-selected (not randomly sampled) from 6 of the 8 real
challenge videos for scenario/occlusion/scale diversity — full timestamp
list in `training/extract_pilot_frames.py`. Excluded:
`Throwing Mattresses.mp4` (mattresses are not cartons — forcing them into
`box` would be exactly the dishonest labeling this remediation exists to
avoid) and `Throwing seating cartons...(1).mp4` (a byte-identical
duplicate of the other `Throwing seating cartons...` file — confirmed in
`docs/VIDEO_AUDIT.md`).

**Split is by video, not by frame** — no two splits ever share footage
from the same continuous moment:

| Split | Videos |
|---|---|
| train (34 frames) | Dock level, dragging cupboard.mp4; Rolling and dragging on wet floor.mp4; Rolling and dropping carton.mp4; Stepping on cartons...mp4 |
| val (18 frames) | KD packets dragged, heavy box kept on other packets.mp4; Throwing seating cartons, using strap to hold.mp4 |

Instance counts (from the actual generated labels, `training/build_yolo_labels.py` output):

| Split | person | box | pallet |
|---|---|---|---|
| train | 93 | 59 | 12 |
| val | 36 | 46 | 6 |

**Known class imbalance:** pallet has far fewer instances than box or
person in both splits — pallets are frequently occluded by what's
stacked on them, so fewer frames had a confidently-drawable pallet
boundary. Expect pallet detection to be the weakest of the three even if
box/person come out reasonably.

Two frames (`Stepping_on_cartons__ver_t06`, `_t11`) have zero box/pallet
labels — honest negatives (people present, no defensible product
boundary visible), not omissions.

## Annotation method

Manual, by visual inspection — **not** computed, not copied from a
model, not inferred from filenames. Each selected frame was rendered
with an 80px coordinate grid overlay (`training/extract_pilot_frames.py`
`draw_grid()`) and reviewed directly; box/pallet coordinates in
`training/pilot_annotations_data.py` were read off that grid. This is
approximate (~80px grid resolution) by construction — a pilot annotation
set, explicitly not survey-grade ground truth. Every annotated frame
retains its source video id and timestamp in
`data/pilot_annotations/manifest.json` for full provenance.

## Reproducing this from scratch

```bash
# 1. Extract frames + grid overlays for the hand-picked timestamps
python training/extract_pilot_frames.py

# 2. (Manual step, already done — see pilot_annotations_data.py) Review
#    each grid-overlaid frame and record box/pallet pixel coordinates.

# 3. Merge manual box/pallet annotations with auto-generated person
#    labels into YOLO-format .txt files
python training/build_yolo_labels.py

# 4. Reorganize into images/{train,val}/ + labels/{train,val}/
python training/organize_split_dirs.py

# 5. Fine-tune yolov8n.pt on the result
python training/train_pilot_model.py
```

All local artifacts (`data/pilot_annotations/`, `training/runs/`,
`models/trace_pilot_v1.pt`) are gitignored — only the scripts here are
tracked, so the workflow is reproducible without committing the
challenge videos, extracted frames, or trained weights.

## Training configuration

- Base weights: `models/yolov8n.pt` (stock COCO pretrained — same file
  Phase 3 uses)
- Ultralytics version: 8.3.40 (already pinned in `backend/requirements.txt`;
  inspected before writing any training code, not upgraded)
- imgsz=640 (matches `PerceptionConfig.inference_size`), batch=8,
  epochs=100 with patience=20 (34 training images overfits/plateaus
  quickly; early stopping avoids wasting time past that point), device=cpu
  (no GPU available), seed=0
- **NumPy compatibility note:** `ultralytics==8.3.40`'s validation metrics
  call the removed `np.trapz` (dropped in NumPy 2.0, replaced by
  `np.trapezoid` with an identical signature). The project venv resolves
  `numpy==2.5.2` transitively via torch/ultralytics with no pin of our
  own. Rather than downgrade numpy project-wide (risking torch/opencv
  compatibility — a much bigger, unrelated change), `train_pilot_model.py`
  adds a two-line shim (`np.trapz = np.trapezoid`) scoped to that one
  script. `backend/` is untouched by this.

Output: `training/runs/trace_pilot/` (full Ultralytics run — metrics,
plots, weights), best weights copied to `models/trace_pilot_v1.pt`.

## Model identity

`backend/perception/config.py` defines `STOCK_COCO_IDENTITY` and
`TRACE_PILOT_IDENTITY` as explicit, named model identities —
`PerceptionConfig.model_identity` always states which one is active, and
`PerceptionFrameResult.model_identity` carries it through to the API
response. The system never infers which model is running from a
filename or from which classes happen to appear; nothing silently
substitutes one model for the other. `backend/perception/adapter.py`'s
`CLASS_MAP_BY_MODEL_IDENTITY` is keyed by this same identity string, so
the stock model's output can never accidentally be interpreted through
the pilot's (wider) class vocabulary or vice versa.

## v2 classes (trolley / forklift / vehicle_bed) — plumbed, not trained

The v2 vocabulary adds `trolley`, `forklift`, `vehicle_bed` on top of the
pilot's `person`/`box`/`pallet`. The plumbing is complete and committed:

- `training/dataset.yaml` + `build_yolo_labels.py` + `train_pilot_model.py`
  declare class ids 0–5 (person, box, pallet, trolley, forklift, vehicle_bed).
- `backend/perception/config.py` defines `TRACE_PILOT_V2_IDENTITY` +
  `PILOT_V2_CONFIG` (points at `models/trace_pilot_v2.pt`, which does not exist yet).
- `backend/perception/adapter.py` maps the v2 vocabulary via
  `TRACE_PILOT_V2_CLASS_MAP`.
- `backend/contracts.models.EntityClass.FORKLIFT` was added.

**No v2 weights exist**, so no detector can produce `trolley`/`forklift`/
`vehicle_bed` yet — the maps exist to define the contract, not to claim
detection. Producing the model requires manually labelling frames for these
classes (the honest bottleneck). `training/auto_label.py` bootstraps more
`person`/`box`/`pallet` frames at a strict confidence floor, marked for review,
but it is deliberately NOT used for the new classes: a weak teacher would just
propagate noise into ground truth.
