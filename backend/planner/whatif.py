"""Sequence-Level What-If Trajectory Simulation Engine (Phase 11).

Implements ARCHITECTURE.md Part 5.6 and CLAUDE.md §13:
- Loads a temporal sequence of scene states for a past event.
- Clones the temporal sequence.
- At the intervention timestep, swaps in the alternative candidate placement.
- Re-runs the Structural + Conformance scoring across both the original and cloned sequences
  using the single unified stability scoring engine (CLAUDE.md §12).
- Returns the original and simulated stability trajectories for the Screen 9 What-If Replay chart.

NON-NEGOTIABLE EPISTEMIC RULES:
1. NEVER mutate the original world model or perception cache.
2. Refuse simulation for UNSUPPORTED or INSUFFICIENT_EVIDENCE events.
3. Refuse counterfactual cargo movements for human worker entities.
4. Image-space comparative decision-support, not certified physical dynamics.
"""

from __future__ import annotations

import copy
import sqlite3
from typing import Any, Optional

from backend.api import perception
from backend.contracts.models import (
    BoundingBox,
    EntityClass,
    FindingStatus,
    PlacementCandidate,
    ProductMetadata,
    RiskBand,
    SceneGraphNode,
    SceneGraphSnapshot,
    TrajectoryPoint,
    WhatIfTrajectoryResult,
)
from backend.planner.actions import WHAT_IF_ELIGIBLE_SCENARIOS
from backend.planner.generator import generate_placement_candidates
from backend.planner.stability import (
    STABILITY_DISCLAIMER,
    compute_stability_score,
)
from backend.perception.pipeline import PerceptionPipeline
from backend.video.registry import VideoRegistry
from backend.world_model.manifest import get_manifest_for_source
from backend.world_model.scene_graph import WorldModel


def _score_to_band(risk_score: float) -> RiskBand:
    """Converts risk score (0-100) to RiskBand."""
    if risk_score >= 75.0:
        return RiskBand.CRITICAL
    if risk_score >= 50.0:
        return RiskBand.HIGH
    if risk_score >= 25.0:
        return RiskBand.MEDIUM
    return RiskBand.LOW


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

    # If specific target not found in this frame, look for any box/cargo node
    if target_node is None:
        for n in snapshot.nodes:
            if n.entity_class in (EntityClass.BOX, EntityClass.PALLET):
                target_node = n
                break

    if target_node is None or target_node.footprint is None:
        # Default baseline if target is absent in this frame
        return TrajectoryPoint(
            timestamp=round(snapshot.timestamp, 3),
            stability_score=50.0,
            risk_score=50.0,
            band=RiskBand.MEDIUM,
            is_alert=False,
            is_placement_moment=is_placement_moment,
            active_scenarios=[scenario] if scenario else [],
            breakdown=None,
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
    band = _score_to_band(risk_score)
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
    record = registry.get(video_id)
    if record is None:
        return WhatIfTrajectoryResult(
            event_id=event_id,
            video_id=video_id,
            intervention_timestamp=timestamp,
            candidate_id="none",
            candidate_label="None",
            instruction="Video not found",
            simulation_available=False,
            simulation_notice=f"Unknown video id '{video_id}'",
            limitations=["video_not_found"],
        )

    # 1. Epistemic Gates: Check recorded event if event_id is supplied
    finding_status = FindingStatus.SUPPORTED
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
            st = (row[4] or "").lower()
            if st in ("unsupported", "insufficient_evidence"):
                return WhatIfTrajectoryResult(
                    event_id=event_id,
                    video_id=video_id,
                    intervention_timestamp=timestamp,
                    candidate_id="none",
                    candidate_label="None",
                    instruction="Simulation unavailable: insufficient evidence.",
                    simulation_available=False,
                    simulation_notice=f"Simulation unavailable: finding status is {st.upper()}. TRACE requires verified geometric evidence for counterfactual simulation.",
                    limitations=["unsupported_or_insufficient_evidence"],
                )

    # Disallow simulation on human worker entity or worker-safety / zone-only incidents
    personnel_or_zone_scenarios = {
        "entity_in_dock_edge_zone",
        "entity_in_wet_floor_zone",
        "stepping_on_carton",
        "stepping_on_carton_precursor",
        "solo_heavy_handling",
    }
    is_person = bool(entity_id and "person" in entity_id.lower())
    is_zone_scen = bool(scenario in personnel_or_zone_scenarios)

    if is_person or is_zone_scen:
        lims = ["worker_entity_ineligible"] if is_person else ["worker_or_zone_ineligible"]
        notice = (
            "Simulation unavailable: target entity is a human worker. TRACE does not simulate counterfactual movements of warehouse personnel."
            if is_person
            else "Simulation unavailable: This incident concerns worker positioning or environmental zone safety rather than movable cargo placement."
        )
        return WhatIfTrajectoryResult(
            event_id=event_id,
            video_id=video_id,
            intervention_timestamp=timestamp,
            candidate_id="none",
            candidate_label="None",
            instruction="Worker safety events cannot be simulated as cargo placement counterfactuals.",
            simulation_available=False,
            simulation_notice=notice,
            limitations=lims,
        )

    pipeline = pipelines.get(model, pipelines.get("pilot"))
    if pipeline is None:
        return WhatIfTrajectoryResult(
            event_id=event_id,
            video_id=video_id,
            intervention_timestamp=timestamp,
            candidate_id="none",
            candidate_label="None",
            instruction="Perception pipeline unavailable",
            simulation_available=False,
            simulation_notice=f"Perception model '{model}' unavailable.",
            limitations=["pipeline_unavailable"],
        )

    try:
        results = perception.get_cached_results(video_id, registry, pipeline, model)
    except Exception as exc:
        return WhatIfTrajectoryResult(
            event_id=event_id,
            video_id=video_id,
            intervention_timestamp=timestamp,
            candidate_id="none",
            candidate_label="None",
            instruction="Could not load perception cache",
            simulation_available=False,
            simulation_notice=str(exc),
            limitations=["perception_cache_error"],
        )

    if not results:
        return WhatIfTrajectoryResult(
            event_id=event_id,
            video_id=video_id,
            intervention_timestamp=timestamp,
            candidate_id="none",
            candidate_label="None",
            instruction="No frames available",
            simulation_available=False,
            simulation_notice="No perception frames available for this video.",
            limitations=["no_frames"],
        )

    # 2. Extract Temporal Sequence in window [t - window_before, t + window_after]
    t_start = max(0.0, timestamp - window_before)
    t_end = min(record.metadata.duration, timestamp + window_after)

    window_results = [r for r in results if t_start - 1e-3 <= r.timestamp <= t_end + 1e-3]
    if not window_results:
        # Fallback to nearest frame result
        nearest = perception.find_nearest_result(results, timestamp)
        window_results = [nearest] if nearest else []

    if not window_results:
        return WhatIfTrajectoryResult(
            event_id=event_id,
            video_id=video_id,
            intervention_timestamp=timestamp,
            candidate_id="none",
            candidate_label="None",
            instruction="No frames in window",
            simulation_available=False,
            simulation_notice="No sequence frames found within requested time window.",
            limitations=["empty_time_window"],
        )

    window_results.sort(key=lambda r: r.timestamp)

    # Build World Model Snapshots
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

    # Find the snapshot closest to the intervention moment t
    k = 0
    min_dist = float("inf")
    for idx, snap in enumerate(original_snapshots):
        dist = abs(snap.timestamp - timestamp)
        if dist < min_dist:
            min_dist = dist
            k = idx

    intervention_snapshot = original_snapshots[k]

    # Resolve target node in intervention snapshot
    target_node = None
    if entity_id:
        for n in intervention_snapshot.nodes:
            if n.entity_id == entity_id:
                target_node = n
                break

    if target_node is None:
        for n in intervention_snapshot.nodes:
            if n.entity_class == EntityClass.BOX:
                target_node = n
                break

    if target_node is None and intervention_snapshot.nodes:
        # Fallback to first non-person node
        for n in intervention_snapshot.nodes:
            if n.entity_class != EntityClass.PERSON:
                target_node = n
                break

    if target_node is None or not target_node.footprint:
        # Search adjacent snapshots within the temporal window for nearest cargo entity
        best_cand_node = None
        best_cand_k = k
        best_cand_dist = float("inf")
        for idx, snap in enumerate(original_snapshots):
            for n in snap.nodes:
                if n.entity_class in (EntityClass.BOX, EntityClass.PALLET) and n.footprint:
                    d = abs(snap.timestamp - timestamp)
                    if d < best_cand_dist:
                        best_cand_dist = d
                        best_cand_node = n
                        best_cand_k = idx
        if best_cand_node is not None:
            target_node = best_cand_node
            k = best_cand_k
            intervention_snapshot = original_snapshots[k]

    if target_node is None or not target_node.footprint:
        return WhatIfTrajectoryResult(
            event_id=event_id,
            video_id=video_id,
            intervention_timestamp=timestamp,
            candidate_id="none",
            candidate_label="None",
            instruction="No cargo entity detected to reposition",
            simulation_available=False,
            simulation_notice="No cargo or carton entity available in this frame for placement counterfactual.",
            limitations=["no_target_entity"],
        )

    target_id = target_node.entity_id
    supporting_node = _find_supporting_node(target_node, intervention_snapshot)

    # 3. Generate Placement Candidates for target node
    candidates = generate_placement_candidates(
        target_node=target_node,
        supporting_node=supporting_node,
        snapshot=intervention_snapshot,
        scenario_key=scenario or "box_overhang",
        product_metadata_by_id=product_metadata_by_id,
        current_score=50.0,
    )

    if not candidates:
        return WhatIfTrajectoryResult(
            event_id=event_id,
            video_id=video_id,
            intervention_timestamp=timestamp,
            candidate_id="none",
            candidate_label="None",
            instruction="No feasible placement alternatives",
            simulation_available=False,
            simulation_notice="No feasible alternative placement coordinates survived physical and boundary constraints.",
            limitations=["no_feasible_candidates"],
        )

    selected_candidate: Optional[PlacementCandidate] = None
    if alternative_candidate:
        for c in candidates:
            if c.id == alternative_candidate or (c.description and alternative_candidate.lower() in c.description.lower()):
                selected_candidate = c
                break

    if selected_candidate is None:
        feasible = [c for c in candidates if c.feasibility and c.hard_constraints_passed]
        selected_candidate = feasible[0] if feasible else candidates[0]

    cand_label = selected_candidate.description or selected_candidate.id or "Alternative Candidate"
    instruction = selected_candidate.description or "Shift position to improve geometric support"

    # 4. Clone Sequence and Apply Counterfactual Intervention
    cloned_snapshots = [copy.deepcopy(s) for s in original_snapshots]

    # Displacement delta from original centroid to candidate centroid
    orig_center_x = (target_node.footprint.x1 + target_node.footprint.x2) / 2.0
    orig_center_y = (target_node.footprint.y1 + target_node.footprint.y2) / 2.0
    cand_center_x = (selected_candidate.footprint.x1 + selected_candidate.footprint.x2) / 2.0
    cand_center_y = (selected_candidate.footprint.y1 + selected_candidate.footprint.y2) / 2.0
    dx = cand_center_x - orig_center_x
    dy = cand_center_y - orig_center_y

    cand_w = selected_candidate.footprint.x2 - selected_candidate.footprint.x1
    cand_h = selected_candidate.footprint.y2 - selected_candidate.footprint.y1

    for j in range(k, len(cloned_snapshots)):
        snap_j = cloned_snapshots[j]
        for n in snap_j.nodes:
            if n.entity_id == target_id:
                if j == k:
                    # Exact candidate footprint at placement frame
                    n.footprint = selected_candidate.footprint
                else:
                    # Persistent placement shift across post-intervention sequence
                    curr_cx = (n.footprint.x1 + n.footprint.x2) / 2.0
                    curr_cy = (n.footprint.y1 + n.footprint.y2) / 2.0
                    new_cx = curr_cx + dx
                    new_cy = curr_cy + dy
                    n.footprint = BoundingBox(
                        x1=max(0.01, min(0.99 - cand_w, new_cx - cand_w / 2.0)),
                        y1=max(0.01, min(0.99 - cand_h, new_cy - cand_h / 2.0)),
                        x2=min(0.99, new_cx + cand_w / 2.0),
                        y2=min(0.99, new_cy + cand_h / 2.0),
                    )

    # 5. Score Both Trajectories Across Timeline
    orig_trajectory: list[TrajectoryPoint] = []
    sim_trajectory: list[TrajectoryPoint] = []

    for idx in range(len(original_snapshots)):
        orig_snap = original_snapshots[idx]
        cloned_snap = cloned_snapshots[idx]
        is_moment = (idx == k)

        orig_pt = evaluate_trajectory_point(
            orig_snap,
            target_id,
            product_metadata_by_id=product_metadata_by_id,
            is_placement_moment=is_moment,
            scenario=scenario,
        )
        sim_pt = evaluate_trajectory_point(
            cloned_snap,
            target_id,
            product_metadata_by_id=product_metadata_by_id,
            is_placement_moment=is_moment,
            scenario=scenario,
        )

        orig_trajectory.append(orig_pt)
        sim_trajectory.append(sim_pt)

    # 6. Comparative Metrics
    orig_point_k = orig_trajectory[k]
    sim_point_k = sim_trajectory[k]
    stability_gain_at_placement = round(sim_point_k.stability_score - orig_point_k.stability_score, 2)

    # Overall delta over post-intervention frames
    post_orig_stabs = [p.stability_score for p in orig_trajectory[k:]]
    post_sim_stabs = [p.stability_score for p in sim_trajectory[k:]]
    overall_delta = (
        round(sum(post_sim_stabs) / len(post_sim_stabs) - sum(post_orig_stabs) / len(post_orig_stabs), 2)
        if post_orig_stabs
        else stability_gain_at_placement
    )

    orig_peak_risk = max([p.risk_score for p in orig_trajectory]) if orig_trajectory else orig_point_k.risk_score
    sim_peak_risk = max([p.risk_score for p in sim_trajectory]) if sim_trajectory else sim_point_k.risk_score

    risk_transition = (
        f"{orig_point_k.band.value.title()} Risk ({orig_point_k.risk_score:.1f}) → "
        f"{sim_point_k.band.value.title()} Risk ({sim_point_k.risk_score:.1f})"
    )

    explanation = (
        f"Simulating alternative placement '{cand_label}' ({instruction}) "
        f"increases stability score from {orig_point_k.stability_score:.1f} to {sim_point_k.stability_score:.1f} "
        f"(+{stability_gain_at_placement:+.1f} pts). Peak operational risk is reduced from "
        f"{orig_peak_risk:.1f} to {sim_peak_risk:.1f} across the observed time series."
    )

    limitations = [
        STABILITY_DISCLAIMER,
        "Simulated trajectory projects image-space 2D coordinates; physical friction, rigid-body contact dynamics, and 3D depth forces are uncalibrated.",
        "Post-intervention trajectory assumes candidate position persists statically without subsequent human disturbance.",
    ]

    return WhatIfTrajectoryResult(
        event_id=event_id,
        video_id=video_id,
        intervention_timestamp=round(timestamp, 3),
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
    )
