"""Sequence-Level What-If Trajectory Simulation Engine (Phase 11).

Implements ARCHITECTURE.md Part 5.6 and CLAUDE.md §13:
- Loads a temporal sequence of scene states for a past event.
- Clones the temporal sequence.
- At the intervention timestep, swaps in the alternative candidate placement.
- Re-runs the single unified stability scoring engine (CLAUDE.md §12) across
  both the original and cloned sequences.
- Returns the original and simulated stability trajectories for the Screen 9
  What-If Replay chart.

NON-NEGOTIABLE EPISTEMIC RULES:
1. NEVER mutate the original world model or perception cache.
2. Refuse simulation for UNSUPPORTED / INSUFFICIENT_EVIDENCE events, human
   workers, and non-placement scenarios — via the single shared gate in
   `backend.planner.eligibility` (same gate the single-frame engine uses).
3. The comparison is asymmetric: the observed curve is real footage after the
   intervention moment; the counterfactual curve holds the repositioned cargo
   static. `comparison_caveat` on the result states this.
4. Image-space comparative decision-support, not certified physical dynamics.
"""

from __future__ import annotations

import copy
import json
import sqlite3
from typing import Optional

from backend.api import perception
from backend.contracts.models import (
    BoundingBox,
    EntityClass,
    Fragility,
    MassClass,
    PlacementCandidate,
    ProductMetadata,
    RiskBand,
    SceneGraphNode,
    SceneGraphSnapshot,
    TrajectoryPoint,
    WhatIfTrajectoryResult,
)
from backend.planner.eligibility import whatif_refusal
from backend.planner.generator import generate_placement_candidates
from backend.planner.stability import (
    STABILITY_DISCLAIMER,
    compute_stability_score,
    risk_band_from_stability,
)
from backend.perception.pipeline import PerceptionPipeline
from backend.video.registry import VideoRegistry
from backend.world_model.manifest import get_manifest_for_source
from backend.world_model.scene_graph import WorldModel

_COMPARISON_CAVEAT = (
    "The observed curve is the real recorded footage from the intervention moment "
    "onward and may already include the actual outcome, a manual correction, or "
    "occlusion; the counterfactual curve holds the repositioned cargo static from "
    "that frame. The two halves of the comparison are therefore not symmetric."
)

# Synthetic ids used only within a single simulation run to reconstruct the
# geometry / SKU metadata the recorded finding was based on, so the observed
# baseline is scored by the SAME stability engine (CLAUDE.md §12) against the
# configuration the detector actually flagged rather than a fresh (and usually
# "fully supported") re-derivation from the perception cache.
_SYNTH_SUPPORT_EID = "__whatif_synth_deck"
_SYNTH_TARGET_PID = "__whatif_synth_target"
_SYNTH_SUPPORT_PID = "__whatif_synth_support"


def _parse_event_evidence(
    db_conn: Optional[sqlite3.Connection], event_id: Optional[int]
) -> dict:
    """Recorded `evidence` block for a seeded finding (support ratios, mass
    ratio, required orientation, …). Empty when there is no event or no JSON."""
    if not (event_id and db_conn):
        return {}
    row = db_conn.execute(
        "SELECT factor_breakdown_json FROM events WHERE event_id = ?", (event_id,)
    ).fetchone()
    if not row or not row[0]:
        return {}
    try:
        return (json.loads(row[0]) or {}).get("evidence", {}) or {}
    except (ValueError, TypeError):
        return {}


def _evidence_support_ratio(evidence: dict) -> Optional[float]:
    """Recorded fraction of the item base resting on support, from the finding
    evidence. `None` when the finding is not geometry-anchored."""
    for key in ("support_ratio", "horizontal_deck_overlap", "pre_action_support_ratio"):
        v = evidence.get(key)
        if isinstance(v, (int, float)) and 0.0 < v <= 1.0:
            return float(v)
    for key in ("overhang_ratio", "initial_overhang_ratio"):
        v = evidence.get(key)
        if isinstance(v, (int, float)) and 0.0 <= v < 1.0:
            return max(0.05, 1.0 - float(v))
    return None


def _synth_product_meta(
    scenario: Optional[str], evidence: dict
) -> tuple[Optional[ProductMetadata], Optional[ProductMetadata]]:
    """`(target_meta, support_meta)` reconstructed from the finding evidence so
    the mass-order / orientation terms of the shared engine fire the way the
    recorded finding says they should. `(None, None)` when not applicable."""
    if scenario == "heavy_on_light_stacking":
        mr = evidence.get("mass_ratio")
        if isinstance(mr, (int, float)) and mr > 1.3:
            support_class = MassClass.LIGHT if mr >= 2.0 else MassClass.MEDIUM
            return (
                ProductMetadata(
                    product_id=_SYNTH_TARGET_PID,
                    class_name="carton",
                    mass_class=MassClass.HEAVY,
                    fragility=Fragility.LOW,
                ),
                ProductMetadata(
                    product_id=_SYNTH_SUPPORT_PID,
                    class_name="carton",
                    mass_class=support_class,
                    fragility=Fragility.LOW,
                ),
            )
    if scenario == "wrong_product_orientation":
        req = evidence.get("required_orientation")
        if isinstance(req, str) and req:
            return (
                ProductMetadata(
                    product_id=_SYNTH_TARGET_PID,
                    class_name="carton",
                    mass_class=MassClass.MEDIUM,
                    fragility=Fragility.LOW,
                    required_orientation=req,
                ),
                None,
            )
    return (None, None)


def _synth_support_box(target_fp: BoundingBox, support_ratio: float) -> BoundingBox:
    """A support footprint directly beneath `target_fp` whose horizontal overlap
    with the target equals `support_ratio` (same width as the target, shifted so
    that `(1 - ratio)` of the base cantilevers past one edge). Feeding this to
    `compute_stability_score` reproduces the recorded overhang geometry."""
    tw = target_fp.x2 - target_fp.x1
    shift = max(0.0, (1.0 - support_ratio)) * tw
    return BoundingBox(
        x1=min(0.98, target_fp.x1 + shift),
        y1=max(0.0, target_fp.y2 - 0.02),
        x2=min(0.999, target_fp.x2 + shift),
        y2=min(0.999, target_fp.y2 + 0.06),
    )


def _reshape_to_aspect(fp: BoundingBox, aspect: float) -> BoundingBox:
    """Same centre and area as `fp`, resized to width/height == `aspect`. Used
    to restore the recorded footprint aspect ratio for a wrong-orientation
    finding so the shared engine's orientation term reflects it."""
    cx = (fp.x1 + fp.x2) / 2.0
    cy = (fp.y1 + fp.y2) / 2.0
    area = max(1e-6, (fp.x2 - fp.x1) * (fp.y2 - fp.y1))
    h = max(1e-3, (area / aspect) ** 0.5)
    w = max(1e-3, aspect * h)
    return BoundingBox(
        x1=max(0.0, cx - w / 2.0),
        y1=max(0.0, cy - h / 2.0),
        x2=min(1.0, cx + w / 2.0),
        y2=min(1.0, cy + h / 2.0),
    )


def _score_to_point(
    timestamp: float,
    stab,
    *,
    is_placement_moment: bool,
    scenario: Optional[str],
) -> TrajectoryPoint:
    """Wrap a `StabilityScore` from the shared engine as a `TrajectoryPoint`,
    using the same stability→risk→band mapping as `evaluate_trajectory_point`."""
    stability = stab.score
    risk_score = round(max(0.0, min(100.0, 100.0 - stability)), 2)
    band = risk_band_from_stability(stability)
    is_alert = band in (RiskBand.HIGH, RiskBand.CRITICAL)
    return TrajectoryPoint(
        timestamp=round(timestamp, 3),
        stability_score=round(stability, 2),
        risk_score=risk_score,
        band=band,
        is_alert=is_alert,
        is_placement_moment=is_placement_moment,
        active_scenarios=[scenario] if (scenario and is_alert) else [],
        breakdown=stab.breakdown,
        evidence="observed",
    )


def _refusal_result(
    *,
    reason_notice: str,
    limitations: list[str],
    event_id: Optional[int],
    video_id: str,
    timestamp: float,
    instruction: str = "Simulation unavailable.",
) -> WhatIfTrajectoryResult:
    return WhatIfTrajectoryResult(
        event_id=event_id,
        video_id=video_id,
        intervention_timestamp=timestamp,
        candidate_id="none",
        candidate_label="None",
        instruction=instruction,
        simulation_available=False,
        simulation_notice=reason_notice,
        limitations=limitations,
    )


def _has_target(snapshot: SceneGraphSnapshot, target_id: str) -> bool:
    return any(n.entity_id == target_id and n.footprint for n in snapshot.nodes)


def _contiguous_present_window(
    snapshots: list[SceneGraphSnapshot], target_id: str, k: int
) -> tuple[int, int]:
    """Largest index range containing `k` in which `target_id` is detected in
    every snapshot. Guarantees every plotted point scores the *same* entity in
    both the observed and counterfactual curves (like-for-like)."""
    lo = k
    while lo - 1 >= 0 and _has_target(snapshots[lo - 1], target_id):
        lo -= 1
    hi = k
    while hi + 1 < len(snapshots) and _has_target(snapshots[hi + 1], target_id):
        hi += 1
    return lo, hi


def _find_supporting_node(target: SceneGraphNode, snapshot: SceneGraphSnapshot) -> Optional[SceneGraphNode]:
    """Finds supporting node for target using edges or vertical adjacency."""
    if not target.footprint:
        return None

    # Check edges
    for edge in snapshot.edges:
        if edge.source_id == target.entity_id and "SUPPORT" in edge.edge_type.value:
            for n in snapshot.nodes:
                if n.entity_id == edge.target_id:
                    return n

    # Check geometric vertical contact / floor
    target_bottom = target.footprint.y2
    best_sup = None
    best_gap = float("inf")
    for n in snapshot.nodes:
        if n.entity_id == target.entity_id or not n.footprint:
            continue
        # Support should be below target
        gap = n.footprint.y1 - target_bottom
        if -0.05 <= gap <= 0.15:
            # Overlap in X
            ox = max(0.0, min(target.footprint.x2, n.footprint.x2) - max(target.footprint.x1, n.footprint.x1))
            if ox > 0.1 * (target.footprint.x2 - target.footprint.x1):
                if abs(gap) < best_gap:
                    best_gap = abs(gap)
                    best_sup = n
    return best_sup


def evaluate_trajectory_point(
    snapshot: SceneGraphSnapshot,
    target_entity_id: str,
    *,
    product_metadata_by_id: Optional[dict[str, ProductMetadata]] = None,
    is_placement_moment: bool = False,
    scenario: Optional[str] = None,
) -> TrajectoryPoint:
    """Scores a single scene snapshot for stability and composite risk using the unified stability engine."""
    meta_by_id = product_metadata_by_id or {}
    nodes_by_id = {n.entity_id: n for n in snapshot.nodes}
    target_node = nodes_by_id.get(target_entity_id)
    evidence = "observed" if (target_node is not None and target_node.footprint) else "target_absent"

    # If specific target not found in this frame, look for any box/cargo node
    if target_node is None:
        for n in snapshot.nodes:
            if n.entity_class in (EntityClass.BOX, EntityClass.PALLET):
                target_node = n
                break

    if target_node is None or target_node.footprint is None:
        # Non-evidential baseline: the requested track is not in this frame.
        return TrajectoryPoint(
            timestamp=round(snapshot.timestamp, 3),
            stability_score=50.0,
            risk_score=50.0,
            band=risk_band_from_stability(50.0),
            is_alert=False,
            is_placement_moment=is_placement_moment,
            active_scenarios=[],
            breakdown=None,
            evidence="target_absent",
        )

    supporting_node = _find_supporting_node(target_node, snapshot)
    target_meta = meta_by_id.get(target_node.product_id) if target_node.product_id else None
    support_meta = meta_by_id.get(supporting_node.product_id) if (supporting_node and supporting_node.product_id) else None

    # Compute using single stability scoring engine (CLAUDE.md §12)
    stab_score_res = compute_stability_score(
        target_footprint=target_node.footprint,
        support_footprint=supporting_node.footprint if supporting_node else None,
        target_product=target_meta,
        support_product=support_meta,
        is_base_tier=(supporting_node is None),
    )

    stability = stab_score_res.score
    risk_score = round(max(0.0, min(100.0, 100.0 - stability)), 2)
    band = risk_band_from_stability(stability)
    is_alert = band in (RiskBand.HIGH, RiskBand.CRITICAL)

    active_scens = []
    if scenario and is_alert:
        active_scens.append(scenario)

    return TrajectoryPoint(
        timestamp=round(snapshot.timestamp, 3),
        stability_score=round(stability, 2),
        risk_score=risk_score,
        band=band,
        is_alert=is_alert,
        is_placement_moment=is_placement_moment,
        active_scenarios=active_scens,
        breakdown=stab_score_res.breakdown,
        evidence=evidence,
    )


def run_what_if_trajectory(
    video_id: str,
    timestamp: float,
    *,
    event_id: Optional[int] = None,
    scenario: Optional[str] = None,
    entity_id: Optional[str] = None,
    alternative_candidate: Optional[str] = None,
    model: str = "pilot",
    window_before: float = 3.0,
    window_after: float = 4.0,
    registry: VideoRegistry,
    pipelines: dict[str, PerceptionPipeline],
    world_model: WorldModel,
    db_conn: Optional[sqlite3.Connection] = None,
) -> WhatIfTrajectoryResult:
    """Executes a multi-frame temporal what-if counterfactual simulation.

    Loads a temporal sequence, clones it, swaps in the alternative placement
    at the intervention timestamp, and re-computes the stability trajectory
    across the timeline for both original and counterfactual paths.
    """
    # 1. Resolve missing parameters from the recorded event, if supplied.
    event_status: Optional[str] = None
    if event_id and db_conn:
        cur = db_conn.cursor()
        cur.execute(
            "SELECT video_id, timestamp, scenario, entity_id, status, band FROM events WHERE event_id = ?",
            (event_id,),
        )
        row = cur.fetchone()
        if row:
            if not video_id:
                video_id = row[0]
            if timestamp is None:
                timestamp = float(row[1])
            if not scenario:
                scenario = row[2]
            if not entity_id:
                entity_id = row[3]
            event_status = row[4]

    # 2. Unified epistemic gate (same gate the single-frame engine uses).
    #    Applicability is decided before anything else: telling the operator
    #    "this kind of incident cannot be simulated" is more useful than a
    #    downstream "video not found" when both are true. The scenario allowlist
    #    here also means an unspecified / non-structural scenario is refused
    #    rather than silently coerced to "box_overhang".
    refusal = whatif_refusal(
        scenario=scenario,
        finding_status=event_status,
        target_entity_id=entity_id,
    )
    if refusal is not None:
        notice = refusal.notice
        limitations = list(refusal.limitations)
        # Manual timestamp mode (no event, no scenario) gets a specific,
        # actionable message instead of the generic "unspecified scenario is an
        # operational hazard" — the issue is a missing incident context, not the
        # incident's nature. Worker / personnel / behaviour refusals still win
        # because the gate matches those first.
        if event_id is None and not scenario and refusal.reason == "non_placement_scenario":
            notice = (
                "Manual timestamp mode needs a structural or conformance incident "
                "context. Select a recorded structural incident (overhang, unsupported "
                "placement, heavy-on-light, wrong orientation) to run a placement "
                "counterfactual."
            )
            limitations = ["manual_mode_requires_incident_context"]
        return _refusal_result(
            reason_notice=notice,
            limitations=limitations,
            event_id=event_id,
            video_id=video_id,
            timestamp=timestamp if timestamp is not None else 0.0,
            instruction="Simulation not applicable to this incident.",
        )

    # 3. Resource existence.
    record = registry.get(video_id)
    if record is None:
        return _refusal_result(
            reason_notice=f"Unknown video id '{video_id}'",
            limitations=["video_not_found"],
            event_id=event_id,
            video_id=video_id,
            timestamp=timestamp if timestamp is not None else 0.0,
            instruction="Video not found",
        )

    pipeline = pipelines.get(model, pipelines.get("pilot"))
    if pipeline is None:
        return _refusal_result(
            reason_notice=f"Perception model '{model}' unavailable.",
            limitations=["pipeline_unavailable"],
            event_id=event_id,
            video_id=video_id,
            timestamp=timestamp,
            instruction="Perception pipeline unavailable",
        )

    try:
        results = perception.get_cached_results(video_id, registry, pipeline, model)
    except Exception as exc:
        return _refusal_result(
            reason_notice=str(exc),
            limitations=["perception_cache_error"],
            event_id=event_id,
            video_id=video_id,
            timestamp=timestamp,
            instruction="Could not load perception cache",
        )

    if not results:
        return _refusal_result(
            reason_notice="No perception frames available for this video.",
            limitations=["no_frames"],
            event_id=event_id,
            video_id=video_id,
            timestamp=timestamp,
            instruction="No frames available",
        )

    # 3. Extract Temporal Sequence in window [t - window_before, t + window_after]
    t_start = max(0.0, timestamp - window_before)
    t_end = min(record.metadata.duration, timestamp + window_after)

    window_results = [r for r in results if t_start - 1e-3 <= r.timestamp <= t_end + 1e-3]
    if not window_results:
        nearest = perception.find_nearest_result(results, timestamp)
        window_results = [nearest] if nearest else []

    if not window_results:
        return _refusal_result(
            reason_notice="No sequence frames found within requested time window.",
            limitations=["empty_time_window"],
            event_id=event_id,
            video_id=video_id,
            timestamp=timestamp,
            instruction="No frames in window",
        )

    window_results.sort(key=lambda r: r.timestamp)

    manifest = get_manifest_for_source(video_id, record.filename)
    product_metadata_by_id = (
        {p.product_id: p for p in manifest.product_metadata} if manifest else {}
    )
    default_product_id = manifest.primary_product_id if manifest else None

    original_snapshots: list[SceneGraphSnapshot] = []
    for fr in window_results:
        snap = world_model.build_snapshot(
            fr.entities,
            frame_width=record.metadata.width,
            frame_height=record.metadata.height,
            timestamp=fr.timestamp,
            default_product_id=default_product_id,
            compute_aspect_orientation=True,
        )
        original_snapshots.append(snap)

    # Snapshot closest to the requested intervention moment.
    k = min(range(len(original_snapshots)), key=lambda i: abs(original_snapshots[i].timestamp - timestamp))
    intervention_snapshot = original_snapshots[k]

    # 4. Resolve the target cargo node in the intervention snapshot.
    target_node: Optional[SceneGraphNode] = None
    if entity_id:
        target_node = next((n for n in intervention_snapshot.nodes if n.entity_id == entity_id), None)
    if target_node is None:
        target_node = next((n for n in intervention_snapshot.nodes if n.entity_class == EntityClass.BOX), None)
    if target_node is None:
        target_node = next(
            (n for n in intervention_snapshot.nodes if n.entity_class != EntityClass.PERSON and n.footprint),
            None,
        )

    adjusted_intervention = False
    if target_node is None or not target_node.footprint:
        # Substitute the nearest frame that does contain a cargo entity.
        best = None
        best_k = k
        best_dist = float("inf")
        for idx, snap in enumerate(original_snapshots):
            for n in snap.nodes:
                if n.entity_class in (EntityClass.BOX, EntityClass.PALLET) and n.footprint:
                    d = abs(snap.timestamp - timestamp)
                    if d < best_dist:
                        best_dist, best, best_k = d, n, idx
        if best is not None:
            target_node = best
            k = best_k
            intervention_snapshot = original_snapshots[k]
            adjusted_intervention = True

    if target_node is None or not target_node.footprint:
        return _refusal_result(
            reason_notice="No cargo or carton entity available in this frame for a placement counterfactual.",
            limitations=["no_target_entity"],
            event_id=event_id,
            video_id=video_id,
            timestamp=timestamp,
            instruction="No cargo entity detected to reposition",
        )

    target_id = target_node.entity_id
    used_timestamp = round(intervention_snapshot.timestamp, 3)

    # 5. Restrict the whole comparison to the contiguous run of frames where the
    #    SAME target track is present, so observed vs counterfactual are always
    #    like-for-like on the same entity.
    lo, hi = _contiguous_present_window(original_snapshots, target_id, k)
    original_snapshots = original_snapshots[lo : hi + 1]
    k -= lo
    intervention_snapshot = original_snapshots[k]
    usable_frames = len(original_snapshots)
    # Low confidence when the usable same-track run is short OR there is no
    # pre-intervention context (k == 0 → the "before" side of the transition is
    # empty and the shape of the curve leading into the placement is unknown).
    confidence = "low" if (usable_frames < 3 or k < 1) else "normal"

    # 5b. Evidence anchor. Reconstruct the geometry / SKU metadata the recorded
    #     finding was based on so the observed baseline is scored — by the SAME
    #     stability engine (CLAUDE.md §12) — against the configuration the
    #     detector actually flagged, not a fresh "fully supported" re-derivation
    #     from the perception cache. Only frames at/after the intervention are
    #     anchored; earlier frames stay live perception.
    event_evidence = _parse_event_evidence(db_conn, event_id)
    anchor_target_meta, anchor_support_meta = _synth_product_meta(scenario, event_evidence)
    anchor_ratio = _evidence_support_ratio(event_evidence)
    anchored = anchor_ratio is not None or anchor_target_meta is not None
    anchor_as_pallet = scenario == "pallet_overhang"
    if anchor_target_meta is not None:
        product_metadata_by_id[_SYNTH_TARGET_PID] = anchor_target_meta
    if anchor_support_meta is not None:
        product_metadata_by_id[_SYNTH_SUPPORT_PID] = anchor_support_meta
    # A finding anchored only by SKU metadata (heavy-on-light) still needs a
    # mostly-overlapping deck so the tier scores as a stacked tier, not base.
    effective_ratio = anchor_ratio if anchor_ratio is not None else (0.9 if anchored else None)

    # Reconstructed geometry, fixed for the whole post-intervention window: a
    # support deck sized/placed so the shared engine reproduces the recorded
    # overhang, and (for a wrong-orientation finding) the target footprint
    # reshaped to the recorded aspect ratio so the orientation term fires.
    reshaped = False
    anchored_target_fp = target_node.footprint
    if scenario == "wrong_product_orientation":
        ar = event_evidence.get("aspect_ratio")
        if isinstance(ar, (int, float)) and ar > 0:
            anchored_target_fp = _reshape_to_aspect(target_node.footprint, float(ar))
            reshaped = True

    synth_deck_fp = (
        _synth_support_box(anchored_target_fp, effective_ratio)
        if effective_ratio is not None
        else None
    )
    synth_target_meta = product_metadata_by_id.get(_SYNTH_TARGET_PID)
    synth_support_meta = product_metadata_by_id.get(_SYNTH_SUPPORT_PID)

    if anchored and synth_deck_fp is not None:
        _c = ((synth_deck_fp.x1 + synth_deck_fp.x2) / 2.0, (synth_deck_fp.y1 + synth_deck_fp.y2) / 2.0)
        supporting_node = SceneGraphNode(
            entity_id=_SYNTH_SUPPORT_EID,
            entity_class=EntityClass.PALLET if anchor_as_pallet else EntityClass.BOX,
            position=_c,
            footprint=synth_deck_fp,
            product_id=_SYNTH_SUPPORT_PID if synth_support_meta is not None else None,
        )
    else:
        supporting_node = _find_supporting_node(target_node, intervention_snapshot)

    # 6. Observed baseline at the intervention frame via the shared engine —
    #    candidate deltas are computed against this, not a hardcoded constant.
    if anchored:
        baseline = compute_stability_score(
            target_footprint=anchored_target_fp,
            support_footprint=synth_deck_fp,
            target_product=synth_target_meta,
            support_product=synth_support_meta,
            is_base_tier=synth_deck_fp is None,
        )
    else:
        baseline = compute_stability_score(
            target_footprint=target_node.footprint,
            support_footprint=supporting_node.footprint if supporting_node else None,
            target_product=(
                product_metadata_by_id.get(target_node.product_id) if target_node.product_id else None
            ),
            support_product=(
                product_metadata_by_id.get(supporting_node.product_id)
                if (supporting_node and supporting_node.product_id)
                else None
            ),
            is_base_tier=supporting_node is None,
        )

    # 7. Generate + select the alternative placement candidate. When anchored,
    #    candidates are generated against the reconstructed deck / reshaped
    #    footprint so they address the geometry the finding recorded.
    #    `scenario` is guaranteed non-None and on the allowlist by the gate above.
    gen_target = (
        target_node.model_copy(update={"footprint": anchored_target_fp})
        if reshaped
        else target_node
    )
    candidates = generate_placement_candidates(
        target_node=gen_target,
        supporting_node=supporting_node,
        snapshot=intervention_snapshot,
        scenario_key=scenario or "box_overhang",
        product_metadata_by_id=product_metadata_by_id,
        current_score=baseline.score,
    )

    if not candidates:
        return _refusal_result(
            reason_notice="No alternative placement coordinates could be generated for this frame.",
            limitations=["no_candidates_generated"],
            event_id=event_id,
            video_id=video_id,
            timestamp=used_timestamp,
            instruction="No feasible placement alternatives",
        )

    # A candidate is only a recommendation if it actually passes the generator's
    # physical + boundary feasibility checks. If none do, refuse rather than
    # headline an improvement computed from a placement the operator cannot make.
    feasible_candidates = [
        c for c in candidates if c.feasibility and c.hard_constraints_passed
    ]
    if not feasible_candidates:
        return _refusal_result(
            reason_notice=(
                f"{len(candidates)} alternative placement(s) were generated but none satisfy "
                "the physical and boundary constraints (for example the item's footprint "
                "exceeds the available supporting surface, or the placement would collide "
                "with another entity). No safe alternative can be recommended for this frame."
            ),
            limitations=["no_feasible_candidate"],
            event_id=event_id,
            video_id=video_id,
            timestamp=used_timestamp,
            instruction="No feasible placement alternative for this frame.",
        )

    # Honour an explicit candidate selection (the operator asked to see that
    # one), otherwise auto-select the best *feasible* candidate.
    selected_candidate: Optional[PlacementCandidate] = None
    if alternative_candidate:
        for c in candidates:
            if c.id == alternative_candidate or (
                c.description and alternative_candidate.lower() in c.description.lower()
            ):
                selected_candidate = c
                break
    if selected_candidate is None:
        selected_candidate = feasible_candidates[0]

    cand_label = selected_candidate.description or selected_candidate.id or "Alternative Candidate"
    instruction = selected_candidate.description or "Shift position to improve geometric support"
    cand_fp = selected_candidate.footprint
    if cand_fp is None:  # generator always sets a footprint; defensive only
        return _refusal_result(
            reason_notice="Selected placement candidate has no geometry.",
            limitations=["candidate_without_geometry"],
            event_id=event_id,
            video_id=video_id,
            timestamp=used_timestamp,
            instruction="No feasible placement alternatives",
        )

    # 8. Clone the sequence. The counterfactual holds the repositioned item
    #    STATIC at the candidate footprint from the intervention frame onward —
    #    it is NOT translated along the observed motion path (doing so used to
    #    slide the box into other stacks and manufacture spurious instability).
    cloned_snapshots = [copy.deepcopy(s) for s in original_snapshots]
    for j in range(k, len(cloned_snapshots)):
        for n in cloned_snapshots[j].nodes:
            if n.entity_id == target_id and n.footprint is not None:
                n.footprint = copy.deepcopy(cand_fp)

    # 9. Score both trajectories across the (same-track) timeline.
    #    - Pre-intervention frames: live perception, identical on both curves.
    #    - From the intervention frame onward (when anchored): both curves are a
    #      forward projection from fixed geometry held static — the recorded
    #      finding (observed) versus the candidate placement (counterfactual),
    #      each scored once against the reconstructed deck by the shared engine.
    _TIERED_RELATIONSHIPS = {
        "centered_tier",
        "centered_support",
        "aligned_flush_support",
        "rotated_support",
        "centered_upright_support",
    }
    cand_is_tiered = (selected_candidate.support_relationship or "") in _TIERED_RELATIONSHIPS

    obs_hold: Optional[object] = None
    sim_hold: Optional[object] = None
    if anchored:
        obs_hold = compute_stability_score(
            target_footprint=anchored_target_fp,
            support_footprint=synth_deck_fp,
            target_product=synth_target_meta,
            support_product=synth_support_meta,
            is_base_tier=synth_deck_fp is None,
        )
        sim_hold = compute_stability_score(
            target_footprint=cand_fp,
            support_footprint=synth_deck_fp if cand_is_tiered else None,
            target_product=synth_target_meta,
            support_product=synth_support_meta if cand_is_tiered else None,
            is_base_tier=not cand_is_tiered,
        )

    orig_trajectory: list[TrajectoryPoint] = []
    sim_trajectory: list[TrajectoryPoint] = []
    for idx in range(len(original_snapshots)):
        is_moment = idx == k
        ts = original_snapshots[idx].timestamp
        if anchored and idx >= k:
            orig_trajectory.append(
                _score_to_point(ts, obs_hold, is_placement_moment=is_moment, scenario=scenario)
            )
            sim_trajectory.append(
                _score_to_point(ts, sim_hold, is_placement_moment=is_moment, scenario=scenario)
            )
        else:
            orig_trajectory.append(
                evaluate_trajectory_point(
                    original_snapshots[idx],
                    target_id,
                    product_metadata_by_id=product_metadata_by_id,
                    is_placement_moment=is_moment,
                    scenario=scenario,
                )
            )
            sim_trajectory.append(
                evaluate_trajectory_point(
                    cloned_snapshots[idx],
                    target_id,
                    product_metadata_by_id=product_metadata_by_id,
                    is_placement_moment=is_moment,
                    scenario=scenario,
                )
            )

    # 10. Comparative metrics.
    orig_point_k = orig_trajectory[k]
    sim_point_k = sim_trajectory[k]
    stability_gain_at_placement = round(sim_point_k.stability_score - orig_point_k.stability_score, 2)

    post_orig = [p.stability_score for p in orig_trajectory[k:]]
    post_sim = [p.stability_score for p in sim_trajectory[k:]]
    overall_delta = (
        round(sum(post_sim) / len(post_sim) - sum(post_orig) / len(post_orig), 2)
        if post_orig
        else stability_gain_at_placement
    )

    orig_peak_risk = max((p.risk_score for p in orig_trajectory), default=orig_point_k.risk_score)
    sim_peak_risk = max((p.risk_score for p in sim_trajectory), default=sim_point_k.risk_score)

    risk_transition = (
        f"{orig_point_k.band.value.title()} Risk ({orig_point_k.risk_score:.1f}) -> "
        f"{sim_point_k.band.value.title()} Risk ({sim_point_k.risk_score:.1f})"
    )
    explanation = (
        f"Simulating alternative placement '{cand_label}' ({instruction}) changes the "
        f"stability score at the intervention frame from {orig_point_k.stability_score:.1f} "
        f"to {sim_point_k.stability_score:.1f} ({stability_gain_at_placement:+.1f} pts). "
        f"Peak observed risk across the usable {usable_frames}-frame window moves from "
        f"{orig_peak_risk:.1f} to {sim_peak_risk:.1f}."
    )

    limitations = [
        STABILITY_DISCLAIMER,
        "Simulated trajectory projects image-space 2D coordinates; physical friction, "
        "rigid-body contact dynamics, and 3D depth forces are uncalibrated.",
        "The counterfactual holds the repositioned cargo static from the intervention "
        "frame onward without subsequent human disturbance.",
    ]
    if anchored:
        bits = []
        if anchor_ratio is not None:
            bits.append(f"support ratio {anchor_ratio:.2f}")
        if anchor_target_meta is not None:
            bits.append("recorded SKU mass / orientation metadata")
        limitations.append(
            "Observed stability at and after the intervention frame is reconstructed "
            f"from the recorded finding evidence ({', '.join(bits)}) via the shared "
            "stability engine; frames before the intervention remain live perception."
        )
    if usable_frames < 3:
        limitations.append("sparse_or_discontinuous_track")
    if k < 1:
        limitations.append("no_pre_intervention_frames")
    if adjusted_intervention:
        limitations.append("intervention_frame_substituted")

    return WhatIfTrajectoryResult(
        event_id=event_id,
        video_id=video_id,
        intervention_timestamp=used_timestamp,
        candidate_id=selected_candidate.id or "candidate_1",
        candidate_label=cand_label,
        instruction=instruction,
        simulation_available=True,
        simulation_notice=None,
        original_trajectory=orig_trajectory,
        simulated_trajectory=sim_trajectory,
        stability_gain_at_placement=stability_gain_at_placement,
        overall_stability_delta=overall_delta,
        original_peak_risk=round(orig_peak_risk, 2),
        simulated_peak_risk=round(sim_peak_risk, 2),
        risk_transition=risk_transition,
        explanation=explanation,
        available_candidates=candidates,
        limitations=limitations,
        confidence=confidence,
        comparison_caveat=_COMPARISON_CAVEAT,
        adjusted_intervention=adjusted_intervention,
    )
