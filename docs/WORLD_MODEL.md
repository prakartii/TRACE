# TRACE World Model / Scene Graph (Phase 4)

How `Entity` objects (Phase 3 — detection + tracking) become a
`SceneGraphSnapshot`: nodes with spatial position/footprint, and
proximity/contact/support edges between them. See CLAUDE.md §5-6 for the
product-level Layer 2 spec and `docs/VIDEO_AUDIT.md` for the camera
geometry this operates on.

```
List[Entity] (Phase 3)
    ↓
WorldModel.build_snapshot() (backend/world_model/scene_graph.py)
    ↓
SceneGraphSnapshot (backend/contracts/models.py) — via backend/api/scene.py
```

## Coordinate system — read this first

**There is no camera calibration.** `SceneGraphNode.position` and
`.footprint` are **normalized image-space coordinates**, in `[0, 1]`,
relative to the source frame's width/height:

```
normalized_x = pixel_x / frame_width
normalized_y = pixel_y / frame_height
```

This is a different convention from `Entity.bbox`, which is absolute
pixels (Phase 3). Normalizing here makes the relationship thresholds in
`backend/world_model/config.py` meaningful as fixed constants regardless
of source resolution (all 8 challenge videos happen to be 1280x720, but
the math doesn't depend on that).

**These are not real-world/metric coordinates.** A normalized position of
`(0.5, 0.5)` means "the center of this bbox is at the center of the video
frame" — nothing more. It says nothing about distance in meters, and
nothing about 3D position. `y` increasing means "further down the image",
not "further from the camera" or "lower in physical space", except to
whatever extent the camera's own angle happens to correlate the two (true
for these elevated, downward-angled dock cameras, but not something the
system verifies or relies on numerically).

ARCHITECTURE.md's confidence model already anticipates this gap
("geometry calibration flag — has this camera's homography/scale been
calibrated?"). Nothing in Phase 4 sets that flag. A future phase could
add a per-video homography (mapping image pixels to a ground-plane
coordinate system) without changing this module's public contract — only
`entity_to_scene_node`'s internals would need to change, and `position`
would gain real metric meaning.

## Node semantics

One `SceneGraphNode` per `Entity` that has a well-formed bbox:

- `entity_id` — exactly `Entity.id` (`"<video_id>:<track_id>"`, assigned
  by `backend/perception/adapter.py`). No second tracker or identity
  scheme exists here — the same track_id across snapshots from the same
  video *is* the same node.
- `entity_class` — copied from `Entity.entity_class` (`person` only in
  the current model — see `docs/VIDEO_PIPELINE.md`).
- `position` — normalized bbox center.
- `footprint` — normalized bbox, reused as a footprint *proxy*. It is
  the entity's 2D image-space extent, not a measured physical footprint.
- `orientation` — always `None`. No pose/rotation signal exists upstream
  (`Entity.keypoints` is always `None` in Phase 3).
- `product_id` — always `None`. No product-metadata linkage exists yet.

A degenerate bbox (`x2<=x1` or `y2<=y1` — malformed input, not something
observed in real perception output but possible from adversarial/synthetic
input) is skipped, not coerced into a nonsensical node.

## Edge semantics

Every edge carries `evidence: dict[str, float]` — the exact geometric
measurement that produced it. An edge is a geometric observation, never a
semantic or behavioural claim: *"person near carton"* is not *"person is
throwing carton"* — that's a later reasoning layer's job, not this one's.

### PROXIMITY (symmetric)

Euclidean distance between normalized bbox centers, at or under
`proximity_threshold` (default `0.12`). `evidence = {"distance": ...,
"threshold": ...}`; `weight = 1 - distance/threshold` (closer = higher
weight).

Symmetric relations are recorded with `source_id`/`target_id` ordered by
`entity_id` ascending — deterministic regardless of the input entity
order — so a pair never produces two proximity edges (A→B and B→A).

### CONTACT (symmetric)

Intersection-over-union of the two normalized footprints, at or above
`contact_iou_threshold` (default `0.02`, kept deliberately low).
`evidence = {"iou": ...}`; `weight = iou`. Same canonical ordering as
proximity.

**This means "these boxes visibly overlap in the 2D image", not "these
objects are touching in 3D".** Two people at different real-world
distances from the camera can have heavily overlapping bounding boxes
just from the projection — validated directly against
`Rolling and dropping carton.mp4` (a genuinely crowded, occluded clip;
see `docs/VIDEO_AUDIT.md`), where a 9-second window produced 29 CONTACT
edges among 3-4 people versus only 5 PROXIMITY edges — i.e. in a crowd,
overlap is common and much more frequent than "merely close".

### SUPPORT (directional, image-space hypothesis only)

**Explicitly not verified 3D support.** Requires *all* of:

1. The candidate supporter's top edge and the candidate supported
   object's bottom edge are within `support_max_vertical_gap` (default
   `0.03`) of each other — a small tolerance in *either* direction, to
   allow both a genuine sliver of gap and slight bbox-overlap noise.
2. Horizontal overlap between the two footprints, as a fraction of the
   *narrower* footprint's width, is at or above
   `support_min_horizontal_overlap` (default `0.3`).

`evidence = {"vertical_gap": ..., "horizontal_overlap_ratio": ...}`;
`weight = horizontal_overlap_ratio`. Direction is `source_id` = supporter,
`target_id` = supported. Both orderings of every pair are tested; the
vertical-gap check is asymmetric by construction (only the geometrically
correct ordering can satisfy it), so at most one direction ever passes —
never both.

**Real-footage finding worth being explicit about:** because Phase 3 only
detects `person`, any SUPPORT edge observed today is between two people,
which is never literally true (people don't support each other by
standing near one another). One did fire during real-footage validation,
in `Rolling and dropping carton.mp4` at t=6.33s: two person entities
(bboxes `(745,138)-(930,435)` and `(749,430)-(974,668)` in a 1280x720
frame) with a -0.007 normalized vertical gap and 0.98 horizontal overlap
— i.e. one person's box sits almost exactly atop the other's, purely
because of where they stood relative to the elevated camera in a crowd,
not because either was physically supporting the other. This is exactly
why the type is called a *hypothesis*: the geometry test does what it
claims to do (find image-space vertical stacking), but image-space
stacking has causes other than physical support, and this module has no
way to distinguish them without real 3D information. It will become far
more meaningful once box/pallet/trolley detection exists and stacked-item
geometry is actually what's being measured.

### Not attempted

**Overlap alone is never support.** Two boxes overlapping at the same
vertical level (side-by-side, not stacked) is CONTACT, and CONTACT only
— there is no code path that promotes a contact edge into a support edge
without independently passing the vertical-ordering test.

## Snapshots, not history

`WorldModel` is stateless across calls — it rebuilds a graph fresh from
whatever `Entity` list it's given each time via
`backend/api/scene.py`, which reuses Phase 3's perception cache
(`backend.api.perception.get_cached_results`) rather than re-running
detection. No long-term object memory or graph persistence exists (or is
needed) in this phase — see CLAUDE.md's snapshot-based-is-sufficient
note.

## Performance

Trivial compared to YOLO inference: scene graph construction is O(n²) in
the number of entities per frame (a handful, in practice — at most 6
people observed in any single sampled frame across the 8 challenge
videos), all closed-form arithmetic. No graph library is used.
`networkx` is in CLAUDE.md/ARCHITECTURE.md's recommended stack and may be
adopted later for actual graph algorithms (e.g. walking a support chain
for the Structural lens), but nothing in Phase 4 needs traversal beyond
"iterate all pairs once" — introducing the dependency now would be
premature. `SceneGraphSnapshot` is a plain typed contract, not a
`networkx.Graph`, and trivially convertible to one later without changing
this public contract.

## Known limitations

- No camera calibration — everything is image-space, not metric (see
  above).
- SUPPORT is a hypothesis, not a verified fact, and — with only `person`
  detected today — is essentially always a coincidental crowd geometry
  observation rather than a real support relationship. See the
  real-footage finding above.
- CONTACT frequently fires in crowded/occluded scenes for the same
  projection reason; do not read it as "these two people are touching".
- No orientation, no product metadata — both fields exist on
  `SceneGraphNode` for forward compatibility (ARCHITECTURE.md's full
  contract) but are always `None` until pose estimation and product
  metadata exist.
- Thresholds (`backend/world_model/config.py`) were chosen against the
  actual challenge footage's camera framing, not derived from a rig
  measurement — they're documented, reasonable defaults, not a
  calibrated fit.
