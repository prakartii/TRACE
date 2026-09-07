# Phase 6 — Risk Lenses & Operational Reasoning Engine

Adds evidence-graded findings on top of Phase 4's world model and Phase 6's operational manifest. Pipeline:

```
cached PerceptionFrameResults -> temporal kinematics -> world model & operational manifest
  -> lenses (behaviour / structural / conformance / environmental)
  -> evidence-quality aggregation -> RiskEvent findings -> planner action text
```

`GET /api/videos/{id}/findings?timestamp=&model=stock|pilot` (`backend/api/findings.py`)
returns `list[RiskEvent]` (`backend/contracts/models.py`) for the sampled frame nearest
`timestamp`, reusing the exact same perception cache and `WorldModel` as `/entities` and
`/scene` — no second inference pass, no second geometry engine.

## Status semantics (`FindingStatus`)

Every finding is exactly one of:

- **SUPPORTED** — evidence quality clears the high bar (`RiskConfig.aggregation_min_confidence_for_supported`, default 0.6).
- **PROBABLE** — clears the lower bar (default 0.3) but not the high one.
- **INSUFFICIENT_EVIDENCE** — some evidence exists but too little/weak to call it either of the above (e.g. required entity detected but at low confidence, or too few temporal samples).
- **UNSUPPORTED** — the scenario has no evidence path at all with current perception (e.g. conformance with no product metadata, or a disallowed class pair).

`confidence` (High/Medium/Low) is derived from the same evidence-quality score
(`backend/risk/aggregation.py`), not from a raw detector score — see below.

## What's Genuinely Supported (Phase 6 & 6.5 Hardening)

- **Operational Manifest Linkage** (`backend/world_model/manifest.py`): Links video sources/bays
  to real product catalog entries (`ProductMetadata`: `mass_class`, `required_orientation`,
  `fragility`, `max_stack_height`) and operator-calibrated `EnvironmentalZone`s (`dock_09_threshold_gap`,
  `dock_10_threshold_gap`, `wet_floor_zone`). Unverified orientation constraints on standard cartons
  are set to `None` to prevent false positives on ordinary horizontal boxes.
- **Behaviour lens** (`backend/behaviour/lens.py`): Evaluates temporal window kinematics
  (`RiskConfig.temporal_window_samples`, default 8) with jitter and spike hardening:
  - Bbox Jitter Rejection: Requires cumulative displacement $\ge 0.08$ AND net straight-line displacement $\ge 0.04$ or trajectory linearity $\ge 0.35$, completely eliminating false moving alarms on stationary jiggling boxes.
  - Dropping/throwing precursor (`dropping_or_throwing_precursor`, Scenario 2): Gated by multi-sample coherence (minimum 3 samples), eliminating single-frame velocity spikes.
  - Dragging precursor (`dragging_precursor`, Scenario 3): Requires ground-level elevation ($y \ge 0.50$), net translation $\ge 0.04$, sustained worker contact ($\ge 0.40$), and coordinated direction ($\Delta x_{\text{person}} \times \Delta x_{\text{box}} \ge 0$).
  - Stepping on carton precursor (`stepping_on_carton_precursor`, Scenario 6): Hardened geometric check requiring worker feet near carton top ($|y2_{\text{person}} - y1_{\text{box}}| \le 0.12$) and elevated body, preventing people standing on the ground behind boxes from falsely triggering alerts.
  - Solo heavy handling (`solo_heavy_handling`, Scenario 12): Evaluates the specific SKU's `mass_class == HEAVY` when net displacement $\ge 0.04$ and a single worker handles the item.
- **Structural lens** (`backend/lenses/structural.py`):
  - Support hypothesis (`image_space_support_hypothesis`) for stacked items.
  - Heavy-on-light stacking (`heavy_on_light_stacking`, Scenario 1) comparing upper vs lower `mass_class` (`LIGHT < MEDIUM < HEAVY`).
  - Pallet/box overhang (`pallet_overhang`, `box_overhang`, Scenario 8) when horizontal overlap ratio is between 0.50 and 0.75.
  - Unsupported/bending placement (`unsupported_bending_placement`, Scenario 14) when horizontal overlap ratio is $< 0.50$.
  - All overhang and bending findings are explicitly labeled as 2D image-space hypotheses.
- **Conformance lens** (`backend/lenses/conformance.py`):
  - Product orientation rule (`wrong_product_orientation`, Scenario 7) with 3D perspective projection tolerance ($w/h > 1.35$ for vertical, $< 0.70$ for horizontal) and minimum box area gate ($0.005$).
  - Fallback to `UNSUPPORTED` / `INSUFFICIENT_EVIDENCE` when product metadata is unlinked or incomplete.
- **Environmental lens** (`backend/lenses/environmental.py`):
  - Calibrated dock edge zone containment (`entity_in_dock_edge_zone`, Scenario 9) achieving `SUPPORTED` status with high-reliability person detections.
  - Calibrated wet floor zone containment (`entity_in_wet_floor_zone`, Scenario 10).

## What Remains Unsupported / Architectural Only

- Packaging straps used as handles (Scenario 5): Straps are sub-pixel packaging features without hand-grasp pose estimation.
- In-flight carton/mattress rolling rotation (Scenario 4): 2D displacement is tracked as a handling precursor, but true rolling requires rotational pose.
- Unplanned loading sequence (Scenario 11): Requires order manifest tracking against multi-truck schedules.
- Wrong equipment usage (Scenario 13): Generic pallet jack vs motorized equipment classification is not in the object detector.

## Evidence-quality confidence (`backend/risk/aggregation.py`)

`evidence_quality()` combines three factors, so a confident detection of an unreliable
class still scores low:

1. mean detection confidence of the involved entities
2. **measured** per-class reliability (`CLASS_EVIDENCE_RELIABILITY`, from
   `training/README.md`'s real numbers: person 1.0, box 0.5, pallet 0.15) — not the
   detector's own confidence
3. how many independent temporal samples back the claim

A strong PERSON detection with no BOX detection scores 0.0 for a box-handling claim
regardless of how confident PERSON was — this is enforced structurally (empty
`entity_classes` list), not by a threshold that could be tuned away.

## Known limitations (do not overstate)

- Box detection is real but weak (mAP50=0.351); pallet detection did not learn
  (mAP50=0.040) — see `training/README.md`. This is why box findings cap at PROBABLE and
  pallet findings are effectively never SUPPORTED in practice.
- No body pose, contact-force, or 3D/depth signal exists — behaviour findings are 2D trajectory/
  displacement evidence, and structural findings are 2D image-space hypotheses.
- Operational manifests link SKU metadata and environmental zones per source, but cannot
  bridge missing classes (e.g. mattresses or straps).
- Environmental zones require manual calibration; unknown sources fall back to unconfigured.
- Temporal evidence covers a bounded window of cached samples
  (`RiskConfig.temporal_window_samples`, default 8) ending at the requested timestamp.

## 14-Scenario Coverage & Status Capability Matrix

| # | Scenario | Lens | Phase 6 Status Capability | Evidence Basis & Active Mechanics |
|---|---|---|---|---|
| 1 | Heavy-on-light stacking | Structural | `PROBABLE` / `SUPPORTED` (metadata) | Compares upper vs lower `mass_class` on support edges. |
| 2 | Throwing / dropping | Behaviour | `PROBABLE` / `INSUFFICIENT_EVIDENCE` | Downward vertical velocity & projectile speed in temporal window. |
| 3 | Dragging instead of lifting | Behaviour | `PROBABLE` | Ground-level horizontal trajectory with worker contact. |
| 4 | Rolling cartons/mattresses | Behaviour | `INSUFFICIENT_EVIDENCE` | Trajectory displacement observed; rotation angle requires 3D/pose. |
| 5 | Packaging straps used as handles | Behaviour | `UNSUPPORTED` | Packaging straps are sub-pixel / out-of-vocabulary; no grasp pose. |
| 6 | Stepping on cartons | Behaviour | `PROBABLE` | Worker footprint superimposed vertically atop carton bbox. |
| 7 | Wrong product orientation | Conformance | `PROBABLE` | 2D aspect ratio check against SKU `required_orientation`. |
| 8 | Pallet overhang | Structural | `INSUFFICIENT_EVIDENCE` | Overhang ratio $< 0.75$; capped by pallet detector reliability ($0.15$). |
| 9 | Dock / vehicle gap | Environmental | `SUPPORTED` | Worker polygon containment in calibrated dock edge zone. |
| 10 | Wet-floor handling | Environmental | `SUPPORTED` (if zone calibrated) | Calibrated wet floor zone polygon containment. |
| 11 | Unplanned loading sequence | Conformance | `UNSUPPORTED` | Loading plan sequence tracking requires multi-stage manifest order. |
| 12 | Solo heavy handling | Behaviour | `PROBABLE` | Single worker proximity/displacement + SKU `mass_class == HEAVY`. |
| 13 | Wrong equipment usage | Conformance | `UNSUPPORTED` | Equipment taxonomy (pallet truck vs forklift) not in detector. |
| 14 | Unsupported / bending placement | Structural | `PROBABLE` | Overlap ratio $< 0.50$ (over 50% cantilevered overhang). |

## Frontend

`frontend/src/components/video/FindingsPanel.jsx`, toggled from Live View, shows each
finding's status badge (SUPPORTED/PROBABLE/INSUFFICIENT EVIDENCE/UNSUPPORTED), lens,
scenario, explanation, entities, confidence, and recommended action — reusing the
existing plain border/neutral visual language, no new dashboard.

