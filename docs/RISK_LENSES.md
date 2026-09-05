# Phase 5 — Risk Lenses / Evidence-Aware Decision Engine

Adds evidence-graded findings on top of Phase 4's world model. Pipeline:

```
cached PerceptionFrameResults -> temporal evidence -> world model (Phase 4)
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

## What's genuinely supported

- **Behaviour lens** (`backend/behaviour/lens.py`): sustained PERSON↔BOX proximity, and
  BOX displacement while near a PERSON — both reported as generic "handling precursor"
  evidence only. **Never** labeled throwing/dragging/lifting/rolling — no pose or
  contact-force signal exists upstream. Caps at PROBABLE in practice because BOX is a weak
  pilot class (see below).
- **Structural lens** (`backend/lenses/structural.py`): reinterprets Phase 4's SUPPORT
  edges as findings, only for PERSON↔BOX, BOX↔BOX, BOX↔PALLET, PERSON↔PALLET pairs.
  PERSON↔PERSON support geometry (common in crowds) is never reported as stacking.
  Explanation text always says "image-space hypothesis, not verified physical support."
- **Environmental lens** (`backend/lenses/environmental.py`): a manual, config-driven
  zone registry (`CONFIGURED_ZONES`, empty by default). TRACE does not automatically
  detect wet floors or dock edges — zones must be calibrated by an operator.

## What's architecture-only / not yet active

- **Conformance lens** (`backend/lenses/conformance.py`): the rule-engine shape exists
  (`ConformanceRule`, `REGISTERED_RULES`) but is empty — no product metadata
  (`required_orientation`/`mass_class`/`allowed_equipment`/`stacking_rules`) is linked to
  any entity anywhere in the system (`SceneGraphNode.product_id` is always `None`). Every
  conformance finding is therefore `UNSUPPORTED`.
- Multi-person-around-a-heavy-object behaviour evidence (part of ARCHITECTURE.md scenario
  #12) is **not implemented** — it needs product mass metadata that doesn't exist yet.

Of the 14 ARCHITECTURE.md scenarios, Phase 5 can only ever supply *supporting evidence*
toward #2, #3, #4, #12 (via the behaviour lens) and #1/#8/#14-adjacent structural
hypotheses (via the structural lens) — it does not conclusively resolve any scenario, and
does not touch #5, #6, #7, #9, #10, #11, #13 at all (equipment/orientation/sequence/wet-
floor/dock-gap all need metadata or perception TRACE doesn't have yet).

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
- No pose, contact-force, or 3D/depth signal exists — behaviour findings are proximity/
  displacement evidence only, and structural findings are 2D image-space hypotheses only.
- No product metadata pipeline exists — conformance is architecture-only.
- Environmental zones require manual calibration; none are configured by default.
- Temporal evidence only covers a small bounded window of already-cached samples
  (`RiskConfig.temporal_window_samples`, default 8) ending at the requested timestamp —
  not the whole video's history.

## Frontend

`frontend/src/components/video/FindingsPanel.jsx`, toggled from Live View, shows each
finding's status badge (SUPPORTED/PROBABLE/INSUFFICIENT EVIDENCE/UNSUPPORTED), lens,
scenario, explanation, entities, confidence, and recommended action — reusing the
existing plain border/neutral visual language, no new dashboard.
