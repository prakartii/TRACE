"""Phase 12 — Behaviour Recognition Engine.

ARCHITECTURE.md Part 3 & Part 9, CLAUDE.md §7 & §14.

Recognizes action patterns from temporal signals over perception frames:
  - Trajectory & path linearity
  - Translation velocity and acceleration spikes (throwing/dropping)
  - Ground-contact horizontal sliding without transport equipment (dragging)
  - Aspect-ratio oscillation / dimension alternation while translating (rolling)
  - Upper-perimeter grip without base support (straps used as handles)
  - Vertical foot alignment atop upper package boundary (stepping on cartons)
  - Single-worker handling of heavy mass-class cargo (solo heavy handling)

EPISTEMIC SAFETY & LIMITATIONS:
  - 2D image-space kinematics only: speeds and accelerations are in
    normalized-frame-units per second (no calibrated metric depth/speed).
  - No contact force or strain gauges: downward forces and physical loads
    are inferred geometric hypotheses, never asserted as measured metric forces.
  - Packaging straps are sub-pixel in standard resolution video: flagged as
    "Observed only" via upper-perimeter grip hypotheses; explicitly NOT predictable.
  - Responsible AI: Identity-blind by architecture. Actions and handling
    patterns are scored against safety rules, NOT individual worker performance.
"""

from __future__ import annotations

import math
from typing import Any, Optional

from backend.contracts.models import (
    BehaviourScenarioInfo,
    BoundingBox,
    ConfidenceLevel,
    EntityClass,
    EpistemicLevel,
    EventType,
    FindingStatus,
    KinematicProfile,
    MassClass,
    PerceptionFrameResult,
    ProductMetadata,
    RiskBand,
    RiskEvent,
    RiskLens,
)
from backend.planner.actions import recommended_action
from backend.risk.aggregation import evidence_quality, status_and_confidence
from backend.risk.config import DEFAULT_RISK_CONFIG, RiskConfig
from backend.world_model.geometry import euclidean_distance
from backend.world_model.temporal import (
    TrackHistory,
    acceleration_sequence,
    average_speed,
    build_track_histories,
    common_sample_count,
    elevation_trend,
    is_ground_sliding,
    net_displacement,
    net_speed,
    rolling_downward_speed,
    sustained_proximity_fraction,
    total_displacement,
    trajectory_linearity,
    velocity_sequence,
)

# ---------------------------------------------------------------------------
# Behaviour Scenario Catalog (ARCHITECTURE.md Part 9 & CLAUDE.md §14)
# ---------------------------------------------------------------------------

BEHAVIOUR_SCENARIOS_CATALOG: list[BehaviourScenarioInfo] = [
    BehaviourScenarioInfo(
        scenario_id="dropping_or_throwing_precursor",
        name="Throwing or Dropping",
        lens=RiskLens.BEHAVIOUR,
        required_signals=["trajectory", "velocity", "acceleration"],
        description="Rapid downward descent or high-velocity projectile release of package near worker.",
        epistemic_status=FindingStatus.PROBABLE,
        confidence=ConfidenceLevel.MEDIUM,
        risk_band=RiskBand.HIGH,
        limitations=[
            "2D image-space velocity only; uncalibrated camera lacks metric depth",
            "No impact force transducer; deceleration at impact is visually inferred",
        ],
        recommended_action="Use controlled two-handed lowering technique; do not drop or toss cartons.",
    ),
    BehaviourScenarioInfo(
        scenario_id="dragging_precursor",
        name="Dragging Instead of Lifting",
        lens=RiskLens.BEHAVIOUR,
        required_signals=["trajectory", "ground_contact", "movement_direction"],
        description="Sustained ground-level horizontal translation of cargo without lifting equipment.",
        epistemic_status=FindingStatus.PROBABLE,
        confidence=ConfidenceLevel.MEDIUM,
        risk_band=RiskBand.MEDIUM,
        limitations=[
            "Floor plane contact estimated from 2D bounding-box bottom boundary",
            "Friction and abrasion forces cannot be measured directly from video",
        ],
        recommended_action="Use pallet jack or team lift; do not drag cartons across floor surfaces.",
    ),
    BehaviourScenarioInfo(
        scenario_id="rolling_precursor",
        name="Rolling Cartons or Cylindrical Cargo",
        lens=RiskLens.BEHAVIOUR,
        required_signals=["trajectory", "aspect_ratio_oscillation", "rotation"],
        description="Translation accompanied by aspect-ratio oscillation or cyclic dimension alternation.",
        epistemic_status=FindingStatus.PROBABLE,
        confidence=ConfidenceLevel.MEDIUM,
        risk_band=RiskBand.MEDIUM,
        limitations=[
            "2D bounding-box aspect-ratio oscillation heuristic; no 3D rigid-body orientation sensor",
            "Rolling is reported as displacement/aspect evidence without claiming 3D rotational mechanics",
        ],
        recommended_action="Maintain controlled physical hold of cylindrical or rotating packages; prevent roll hazard.",
    ),
    BehaviourScenarioInfo(
        scenario_id="straps_as_handles",
        name="Packaging Straps Used as Handles",
        lens=RiskLens.BEHAVIOUR,
        required_signals=["contact_region", "grip_perimeter"],
        description="Package lifted or held strictly by exterior tension straps without supporting base.",
        epistemic_status=FindingStatus.PROBABLE,
        confidence=ConfidenceLevel.LOW,
        risk_band=RiskBand.MEDIUM,
        limitations=[
            "2D image-space velocity only; uncalibrated camera lacks metric depth",
            "Packaging straps are sub-pixel in standard resolution video",
            "Observed only — explicitly not predictable in advance",
            "Upper-perimeter grip hypothesis without base contact",
        ],
        recommended_action="Grip package body directly with two hands; never lift or carry items by packaging straps.",
    ),
    BehaviourScenarioInfo(
        scenario_id="stepping_on_carton_precursor",
        name="Stepping on Cartons",
        lens=RiskLens.BEHAVIOUR,
        required_signals=["footprint_elevation", "vertical_overlap"],
        description="Worker body weight applied to carton surface; worker elevated atop cargo.",
        epistemic_status=FindingStatus.PROBABLE,
        confidence=ConfidenceLevel.MEDIUM,
        risk_band=RiskBand.HIGH,
        limitations=[
            "2D camera cannot measure downward ground-reaction force",
            "Elevation-overlap precursor hypothesis; body weight crush hazard inferred from geometry",
        ],
        recommended_action="Step off cartons immediately; packaging structure may collapse under body weight.",
    ),
    BehaviourScenarioInfo(
        scenario_id="solo_heavy_handling",
        name="Solo Heavy Handling",
        lens=RiskLens.BEHAVIOUR,
        required_signals=["mass_metadata", "worker_count", "displacement"],
        description="Single worker manually lifting or translating a heavy mass-class SKU without team assistance.",
        epistemic_status=FindingStatus.PROBABLE,
        confidence=ConfidenceLevel.MEDIUM,
        risk_band=RiskBand.HIGH,
        limitations=[
            "Requires linked product catalog metadata to determine mass class",
            "Worker proximity heuristic determines team vs solo handling",
        ],
        recommended_action="Request team lift or use mechanical pallet jack for heavy items.",
    ),
    BehaviourScenarioInfo(
        scenario_id="box_displacement_near_person",
        name="Cargo Movement Near Worker",
        lens=RiskLens.BEHAVIOUR,
        required_signals=["proximity", "displacement"],
        description="General cargo displacement observed in close proximity to worker.",
        epistemic_status=FindingStatus.PROBABLE,
        confidence=ConfidenceLevel.LOW,
        risk_band=RiskBand.LOW,
        limitations=[
            "Generic handling precursor evidence only; does not identify specific improper action",
        ],
        recommended_action="Pause carton movement and maintain clear separation from nearby worker.",
    ),
    BehaviourScenarioInfo(
        scenario_id="person_box_sustained_proximity",
        name="Sustained Worker-Cargo Proximity",
        lens=RiskLens.BEHAVIOUR,
        required_signals=["proximity"],
        description="Worker maintaining sustained close proximity to cargo without active displacement.",
        epistemic_status=FindingStatus.PROBABLE,
        confidence=ConfidenceLevel.LOW,
        risk_band=RiskBand.LOW,
        limitations=[
            "Precursor evidence only; no physical movement observed",
        ],
        recommended_action="Verify worker clearance and ensure ergonomic lifting technique before moving package.",
    ),
]


# ---------------------------------------------------------------------------
# Kinematic Profile Computation
# ---------------------------------------------------------------------------

def compute_kinematics(history: TrackHistory) -> KinematicProfile:
    """Computes auditable kinematic and geometric properties for a single track.
    All speeds are in normalized-frame-units per second."""
    samples = history.samples
    n_samples = len(samples)

    if n_samples < 2:
        return KinematicProfile(
            entity_id=history.entity_id,
            sample_count=n_samples,
            duration=0.0,
            total_displacement=0.0,
            net_displacement=0.0,
            trajectory_linearity=0.0,
            average_speed=None,
            net_speed=None,
            peak_speed=None,
            peak_downward_speed=None,
            peak_acceleration=None,
            aspect_ratio_min=None,
            aspect_ratio_max=None,
            aspect_ratio_range=None,
            aspect_oscillation_count=0,
            ground_tier=False,
        )

    duration = samples[-1].timestamp - samples[0].timestamp
    tot_disp = total_displacement(history)
    net_disp = net_displacement(history)
    lin = trajectory_linearity(history)
    avg_spd = average_speed(history)
    net_spd = net_speed(history)

    # Consecutive velocities and speeds
    speeds: list[float] = []
    downward_speeds: list[float] = []
    vel_vectors: list[tuple[float, float, float]] = []

    for s1, s2 in zip(samples, samples[1:]):
        dt = s2.timestamp - s1.timestamp
        if dt > 1e-4:
            vx = (s2.position[0] - s1.position[0]) / dt
            vy = (s2.position[1] - s1.position[1]) / dt
            spd = math.sqrt(vx * vx + vy * vy)
            speeds.append(spd)
            downward_speeds.append(vy)
            vel_vectors.append((vx, vy, 0.5 * (s1.timestamp + s2.timestamp)))

    peak_spd = max(speeds) if speeds else None
    peak_down_spd = max(downward_speeds) if downward_speeds else None
    rolling_down = rolling_downward_speed(history, window_size=2)
    if peak_down_spd is not None and rolling_down > 0:
        peak_down_spd = max(peak_down_spd, rolling_down)
    elif peak_down_spd is None and rolling_down > 0:
        peak_down_spd = rolling_down

    # Acceleration between consecutive velocities
    peak_acc = None
    if len(vel_vectors) >= 2:
        accs: list[float] = []
        for v1, v2 in zip(vel_vectors, vel_vectors[1:]):
            dt_acc = v2[2] - v1[2]
            if dt_acc > 1e-4:
                ax = (v2[0] - v1[0]) / dt_acc
                ay = (v2[1] - v1[1]) / dt_acc
                accs.append(math.sqrt(ax * ax + ay * ay))
        if accs:
            peak_acc = max(accs)

    # Aspect ratio sequence and oscillations
    aspect_ratios: list[float] = []
    for s in samples:
        if s.footprint:
            w = max(1e-4, s.footprint.x2 - s.footprint.x1)
            h = max(1e-4, s.footprint.y2 - s.footprint.y1)
            aspect_ratios.append(w / h)

    ar_min = min(aspect_ratios) if aspect_ratios else None
    ar_max = max(aspect_ratios) if aspect_ratios else None
    ar_range = (ar_max - ar_min) if (ar_min is not None and ar_max is not None) else None

    aspect_oscillation_count = 0
    if len(aspect_ratios) >= 3:
        for ar1, ar2 in zip(aspect_ratios, aspect_ratios[1:]):
            if (ar1 > 1.05 and ar2 < 0.95) or (ar1 < 0.95 and ar2 > 1.05):
                aspect_oscillation_count += 1

    ground_tier = (
        samples[-1].position[1] >= 0.50
        or (samples[-1].footprint is not None and samples[-1].footprint.y2 >= 0.60)
    )

    return KinematicProfile(
        entity_id=history.entity_id,
        sample_count=n_samples,
        duration=duration,
        total_displacement=tot_disp,
        net_displacement=net_disp,
        trajectory_linearity=lin,
        average_speed=avg_spd,
        net_speed=net_spd,
        peak_speed=peak_spd,
        peak_downward_speed=peak_down_spd,
        peak_acceleration=peak_acc,
        aspect_ratio_min=ar_min,
        aspect_ratio_max=ar_max,
        aspect_ratio_range=ar_range,
        aspect_oscillation_count=aspect_oscillation_count,
        ground_tier=ground_tier,
    )


# ---------------------------------------------------------------------------
# Individual Action Recognizers
# ---------------------------------------------------------------------------

def recognize_throwing_or_dropping(
    box_history: TrackHistory,
    person_history: TrackHistory,
    kinematics: KinematicProfile,
    config: RiskConfig,
) -> Optional[dict[str, Any]]:
    """Scenario 2: Detects rapid downward vertical drop or projectile throw."""
    min_vel_samples = getattr(config, "behaviour_box_min_samples_for_velocity", 3)
    min_net = getattr(config, "behaviour_box_min_net_displacement", 0.04)

    if len(box_history.samples) < min_vel_samples:
        return None
    if kinematics.net_displacement < min_net:
        return None

    dy_net = box_history.last.position[1] - box_history.first.position[1]
    spd = kinematics.net_speed or kinematics.average_speed or 0.0
    tot_disp = max(kinematics.total_displacement, 1e-6)
    rolling_down = rolling_downward_speed(box_history, window_size=2)
    peak_acc = kinematics.peak_acceleration or 0.0

    # Vertical drop condition: rapid downward velocity or acceleration spike
    is_vertical_drop = (
        (dy_net >= 0.08 and (dy_net / tot_disp) >= 0.60 and spd >= 0.15)
        or (rolling_down >= 0.22 and dy_net >= 0.06 and (dy_net / tot_disp) >= 0.50)
        or (dy_net >= 0.08 and peak_acc >= 0.50 and (dy_net / tot_disp) >= 0.55)
    )

    if is_vertical_drop:
        effective_spd = max(spd, rolling_down, kinematics.peak_downward_speed or 0.0)
        return {
            "scenario": "dropping_or_throwing_precursor",
            "subtype": "vertical_drop",
            "explanation": (
                f"Box exhibited rapid downward displacement (effective speed: {effective_spd:.2f} norm/s, vertical drop: {dy_net:.3f}) "
                "near worker. Kinematic signature indicates dropping, throwing, or falling precursor hypothesis."
            ),
            "evidence": {
                "dy_net": dy_net,
                "vertical_ratio": dy_net / tot_disp,
                "speed": spd,
                "rolling_downward_speed": rolling_down,
                "peak_downward_speed": kinematics.peak_downward_speed,
                "peak_acceleration": kinematics.peak_acceleration,
            },
            "band": RiskBand.HIGH,
            "epistemic_level": EpistemicLevel.INFERRED,
            "limitations": [
                "2D image-space velocity only; uncalibrated camera lacks metric depth",
                "No impact force transducer; deceleration at impact is visually inferred",
            ],
        }

    # Projectile throw condition: speed >= 0.30 norm/s, displacement >= 0.08, not purely upward lifting (dy_net >= -0.05)
    if spd >= 0.30 and kinematics.net_displacement >= 0.08 and dy_net >= -0.05:
        return {
            "scenario": "dropping_or_throwing_precursor",
            "subtype": "projectile_throw",
            "explanation": (
                f"Box exhibited projectile translation velocity (speed: {spd:.2f} norm/s, displacement: {kinematics.total_displacement:.3f}) "
                "near worker. Kinematic signature indicates throwing or rapid release precursor hypothesis."
            ),
            "evidence": {
                "speed": spd,
                "net_displacement": kinematics.net_displacement,
                "trajectory_linearity": kinematics.trajectory_linearity,
                "peak_speed": kinematics.peak_speed,
                "peak_acceleration": kinematics.peak_acceleration,
            },
            "band": RiskBand.HIGH,
            "epistemic_level": EpistemicLevel.INFERRED,
            "limitations": [
                "2D image-space velocity only; uncalibrated camera lacks metric depth",
                "No impact force transducer; deceleration at impact is visually inferred",
            ],
        }

    return None


def recognize_rolling(
    box_history: TrackHistory,
    person_history: TrackHistory,
    kinematics: KinematicProfile,
    shared_samples: int,
) -> Optional[dict[str, Any]]:
    """Scenario 4: Detects rotation-while-translating signature (aspect-ratio oscillation)."""
    dx_net = abs(box_history.last.position[0] - box_history.first.position[0])
    has_translation = dx_net >= 0.05 or kinematics.total_displacement >= 0.08

    # Require multi-frame aspect-ratio alternation over >= 3 samples to avoid detector jitter on stationary box
    has_aspect_oscillation = (
        kinematics.aspect_oscillation_count >= 1
        or (
            kinematics.aspect_ratio_range is not None
            and kinematics.aspect_ratio_range >= 0.25
            and len(box_history.samples) >= 3
        )
    )

    if has_translation and has_aspect_oscillation and shared_samples >= 2:
        return {
            "scenario": "rolling_precursor",
            "explanation": (
                f"Box exhibited aspect-ratio oscillation ({kinematics.aspect_ratio_range:.2f} span, "
                f"{kinematics.aspect_oscillation_count} inversions) during horizontal translation ({kinematics.total_displacement:.3f} norm). "
                "Kinematic signature indicates rolling or tumbling package precursor."
            ),
            "evidence": {
                "aspect_ratio_range": kinematics.aspect_ratio_range,
                "aspect_oscillation_count": kinematics.aspect_oscillation_count,
                "displacement": kinematics.total_displacement,
                "sample_count": len(box_history.samples),
            },
            "band": RiskBand.MEDIUM,
            "epistemic_level": EpistemicLevel.INFERRED,
            "limitations": [
                "no_pose_signal",
                "no_contact_force_signal",
                "2D_aspect_oscillation_heuristic",
            ],
        }

    return None


def recognize_dragging(
    box_history: TrackHistory,
    person_history: TrackHistory,
    kinematics: KinematicProfile,
    proximity_fraction: float,
    all_histories: dict[str, TrackHistory],
    config: RiskConfig,
) -> Optional[dict[str, Any]]:
    """Scenario 3: Detects sustained ground-level translation without equipment."""
    min_net = getattr(config, "behaviour_box_min_net_displacement", 0.04)
    tot_disp = max(kinematics.total_displacement, 1e-6)

    dx_net = box_history.last.position[0] - box_history.first.position[0]
    p_dx = person_history.last.position[0] - person_history.first.position[0]

    is_ground = box_history.last.position[1] >= 0.50
    horiz_ratio = abs(dx_net) / tot_disp

    # Suppress dragging if rolling signature is present
    if kinematics.aspect_oscillation_count >= 1 or (
        kinematics.aspect_ratio_range is not None and kinematics.aspect_ratio_range >= 0.35
    ):
        return None

    # Temporal ground-sliding check: bottom boundary y2 stays on floor plane with low vertical variance
    ground_sliding = is_ground_sliding(box_history, min_ground_y2=0.50, max_y2_variance=0.035)

    if (
        (horiz_ratio >= 0.65 or ground_sliding)
        and kinematics.total_displacement >= 0.08
        and kinematics.net_displacement >= min_net
        and (is_ground or ground_sliding)
    ):
        same_direction = (p_dx * dx_net) >= -0.01
        if same_direction and proximity_fraction >= 0.40:
            for h in all_histories.values():
                if h.entity_class in (EntityClass.TROLLEY, EntityClass.PALLET):
                    if h.samples and box_history.samples:
                        eq_box_dist = euclidean_distance(h.last.position, box_history.last.position)
                        if eq_box_dist <= 0.15 and total_displacement(h) >= 0.04:
                            return None

            return {
                "scenario": "dragging_precursor",
                "explanation": (
                    f"Box exhibited sustained ground-level translation (displacement {kinematics.total_displacement:.3f}, horizontal ratio "
                    f"{horiz_ratio:.0%}) near worker without elevation. "
                    "Kinematic signature indicates dragging precursor hypothesis."
                ),
                "evidence": {
                    "dx_net": dx_net,
                    "horizontal_ratio": horiz_ratio,
                    "box_y_position": box_history.last.position[1],
                    "ground_sliding_verified": ground_sliding,
                    "worker_box_direction_alignment": True,
                    "sustained_proximity": proximity_fraction,
                },
                "band": RiskBand.MEDIUM,
                "epistemic_level": EpistemicLevel.INFERRED,
                "limitations": [
                    "no_pose_signal",
                    "no_contact_force_signal",
                    "box_detection_confidence_is_weak_pilot_class",
                ],
            }

    return None


def recognize_straps_as_handles(
    box_history: TrackHistory,
    person_history: TrackHistory,
    kinematics: KinematicProfile,
    proximity_fraction: float,
) -> Optional[dict[str, Any]]:
    """Scenario 5: Detects lifting/holding strictly from upper perimeter/strap boundary."""
    p_foot = person_history.last.footprint
    b_foot = box_history.last.footprint

    if not p_foot or not b_foot:
        return None

    # Upward lift or suspension, NOT downward drop
    dy_net = box_history.last.position[1] - box_history.first.position[1]
    if dy_net > 0.02:
        return None

    # If translating predominantly horizontally along ground, it is dragging/rolling, not strap lift
    dx_net = abs(box_history.last.position[0] - box_history.first.position[0])
    if dx_net >= 0.08 and box_history.last.position[1] >= 0.50:
        return None

    # Worker is standing on floor with feet at/below box bottom (not stepping on carton)
    standing_ground = p_foot.y2 >= (b_foot.y2 - 0.05)
    # Box top is within worker's torso/hand reach region
    within_hand_reach = p_foot.y1 <= b_foot.y1 <= (p_foot.y1 + 0.80 * (p_foot.y2 - p_foot.y1))
    horiz_contact = min(p_foot.x2, b_foot.x2) > max(p_foot.x1, b_foot.x1) - 0.08

    is_lifted = dy_net <= -0.02 or kinematics.total_displacement >= 0.04

    if standing_ground and within_hand_reach and horiz_contact and is_lifted and proximity_fraction >= 0.30:
        return {
            "scenario": "straps_as_handles",
            "explanation": (
                "Packaging straps used as lifting handles. Straps are sub-pixel in 2D video; "
                "detected via upper-perimeter grip hypothesis without base support. Not predictable in advance."
            ),
            "evidence": {
                "hands_top_edge_alignment": True,
                "box_vertical_lift": -dy_net,
                "base_support_detected": False,
            },
            "band": RiskBand.MEDIUM,
            "epistemic_level": EpistemicLevel.OBSERVED,
            "limitations": [
                "2D image-space velocity only; uncalibrated camera lacks metric depth",
                "straps_are_subpixel",
                "not_predictable_in_advance",
                "no_pose_signal",
            ],
        }

    return None


def recognize_stepping_on_carton(
    box_history: TrackHistory,
    person_history: TrackHistory,
    sustained: bool,
) -> Optional[dict[str, Any]]:
    """Scenario 6: Detects worker elevated with feet atop carton upper boundary.
    Distinguishes sustained stepping / elevation from momentary 1-frame crossing occlusion."""
    # Check across common samples to ensure persistence or elevation
    timestamps_box = {s.timestamp: s for s in box_history.samples}
    common_pairs = [
        (s_p, timestamps_box[s_p.timestamp])
        for s_p in person_history.samples
        if s_p.timestamp in timestamps_box
    ]

    stepping_sample_count = 0
    for s_p, s_b in common_pairs:
        p_foot = s_p.footprint
        b_foot = s_b.footprint
        if p_foot and b_foot:
            feet_near_top = (b_foot.y1 - 0.08) <= p_foot.y2 <= (b_foot.y1 + 0.14)
            body_elevated = p_foot.y1 < b_foot.y1
            horiz_overlap = min(p_foot.x2, b_foot.x2) > max(p_foot.x1, b_foot.x1)
            if feet_near_top and body_elevated and horiz_overlap:
                stepping_sample_count += 1
        else:
            if s_p.position[1] < s_b.position[1] and abs(s_p.position[0] - s_b.position[0]) < 0.08:
                stepping_sample_count += 1

    # Fallback check on last sample if common_pairs has < 2 samples
    if len(common_pairs) < 2:
        p_foot = person_history.last.footprint
        b_foot = box_history.last.footprint
        if p_foot and b_foot:
            feet_near_top = (b_foot.y1 - 0.08) <= p_foot.y2 <= (b_foot.y1 + 0.12)
            body_elevated = p_foot.y1 < b_foot.y1
            horiz_overlap = min(p_foot.x2, b_foot.x2) > max(p_foot.x1, b_foot.x1)
            if feet_near_top and body_elevated and horiz_overlap:
                stepping_sample_count = 1
        else:
            person_pos = person_history.last.position
            box_pos = box_history.last.position
            if person_pos[1] < box_pos[1] and abs(person_pos[0] - box_pos[0]) < 0.08:
                stepping_sample_count = 1

    # Multi-sample persistence filter: if multiple shared samples exist, require >= 2 samples
    # to reject single-frame passing occlusions
    is_stepping = False
    if len(common_pairs) >= 3:
        is_stepping = stepping_sample_count >= 2
    elif len(common_pairs) >= 1:
        is_stepping = stepping_sample_count >= 1

    if is_stepping:
        return {
            "scenario": "stepping_on_carton_precursor",
            "explanation": (
                "Worker footprint vertically overlaps upper carton tier in 2D projection "
                "(elevation-overlap precursor hypothesis; 2D camera cannot measure downward ground-reaction force). "
                "Stepping on cartons crushes contents and creates worker fall hazard."
            ),
            "evidence": {
                "elevation_overlap": True,
                "feet_at_top_boundary": True,
                "stepping_samples": stepping_sample_count,
            },
            "band": RiskBand.HIGH,
            "epistemic_level": EpistemicLevel.INFERRED,
            "limitations": [
                "no_contact_force_signal",
                "2D_projection_overlap",
            ],
        }

    return None


def recognize_solo_heavy_handling(
    box_history: TrackHistory,
    persons: list[TrackHistory],
    product_metadata_by_id: dict[str, ProductMetadata] | None,
    default_product_id: str | None,
    kinematics: KinematicProfile,
    config: RiskConfig,
) -> Optional[dict[str, Any]]:
    """Scenario 12: Detects single worker handling heavy item without team assistance.
    Distinguishes solo handling from multi-worker collaborative team lift."""
    min_net = getattr(config, "behaviour_box_min_net_displacement", 0.04)
    if kinematics.net_displacement < min_net or not product_metadata_by_id:
        return None

    heavy_meta: Optional[ProductMetadata] = None
    if default_product_id and default_product_id in product_metadata_by_id:
        target_meta = product_metadata_by_id[default_product_id]
        if target_meta.mass_class == MassClass.HEAVY:
            heavy_meta = target_meta
    elif len(product_metadata_by_id) == 1:
        target_meta = next(iter(product_metadata_by_id.values()))
        if target_meta.mass_class == MassClass.HEAVY:
            heavy_meta = target_meta

    if not heavy_meta:
        return None

    persons_near = [
        p
        for p in persons
        if common_sample_count(p, box_history) >= 2
        and sustained_proximity_fraction(p, box_history, config.behaviour_proximity_threshold) >= 0.30
    ]

    # Exactly 1 worker handling -> solo heavy handling violation
    # >= 2 workers handling -> collaborative team lift compliant, do NOT trigger solo violation
    if len(persons_near) == 1:
        return {
            "scenario": "solo_heavy_handling",
            "worker_id": persons_near[0].entity_id,
            "explanation": (
                f"Single worker handling heavy item '{heavy_meta.product_id}' ({heavy_meta.mass_class.value} mass class) "
                f"without team assistance (box displacement: {kinematics.total_displacement:.3f}). "
                "Exceeds single-person safe handling guidelines."
            ),
            "evidence": {
                "product_id": heavy_meta.product_id,
                "mass_class": heavy_meta.mass_class.value,
                "box_displacement": kinematics.total_displacement,
                "workers_handling_count": 1,
            },
            "band": RiskBand.HIGH,
            "epistemic_level": EpistemicLevel.INFERRED,
            "limitations": [
                "Requires linked product catalog metadata to determine mass class",
                "Worker proximity heuristic determines team vs solo handling",
            ],
        }

    return None


# ---------------------------------------------------------------------------
# Master Behaviour Recognition Pipeline
# ---------------------------------------------------------------------------

def recognize_all_behaviours(
    frame_results: list[PerceptionFrameResult],
    *,
    frame_width: int,
    frame_height: int,
    timestamp: float,
    config: RiskConfig = DEFAULT_RISK_CONFIG,
    product_metadata_by_id: dict[str, ProductMetadata] | None = None,
    default_product_id: str | None = None,
) -> tuple[list[RiskEvent], dict[str, KinematicProfile]]:
    """Full Behaviour Recognition evaluation across cached perception samples.
    Returns (findings, kinematics_by_entity_id)."""
    histories = build_track_histories(frame_results, frame_width, frame_height)
    persons = [h for h in histories.values() if h.entity_class == EntityClass.PERSON]
    boxes = [h for h in histories.values() if h.entity_class == EntityClass.BOX]

    kinematics_by_id: dict[str, KinematicProfile] = {
        h.entity_id: compute_kinematics(h) for h in histories.values()
    }

    if not boxes:
        insufficient = RiskEvent(
            timestamp=timestamp,
            event_type=EventType.BEHAVIOUR,
            lens=RiskLens.BEHAVIOUR,
            entity_id=persons[0].entity_id if persons else "unknown",
            confidence=ConfidenceLevel.LOW,
            status=FindingStatus.INSUFFICIENT_EVIDENCE,
            scenario="person_box_handling",
            entities=[p.entity_id for p in persons],
            evidence={"box_tracks_detected": 0},
            explanation=(
                "No BOX entity was detected in this window, so no box-handling "
                "behaviour finding can be supported — a confident PERSON detection "
                "alone is not evidence of box handling."
            ),
            limitations=["no_box_detection"],
            epistemic_level=EpistemicLevel.INFERRED,
        )
        return [insufficient], kinematics_by_id

    findings: list[RiskEvent] = []

    for person in persons:
        for box in boxes:
            shared = common_sample_count(person, box)
            if shared == 0:
                continue

            proximity_fraction = sustained_proximity_fraction(
                person, box, threshold=config.behaviour_proximity_threshold
            )
            kinematics = kinematics_by_id.get(box.entity_id) or compute_kinematics(box)

            displacement = kinematics.total_displacement
            box_net = kinematics.net_displacement
            box_lin = kinematics.trajectory_linearity
            min_net = getattr(config, "behaviour_box_min_net_displacement", 0.04)
            min_lin = getattr(config, "behaviour_box_min_linearity", 0.35)

            stepping_action = recognize_stepping_on_carton(box, person, sustained=True)
            has_stepping = stepping_action is not None

            sustained = (
                (shared >= config.behaviour_min_common_samples and proximity_fraction >= config.behaviour_sustained_fraction)
                or has_stepping
            )
            moving = (
                displacement >= config.behaviour_box_displacement_threshold
                and (box_net >= min_net or box_lin >= min_lin)
                and len(box.samples) >= 2
            )

            if not sustained and not moving:
                continue

            mean_conf = min(
                sum(s.confidence for s in person.samples) / len(person.samples) if person.samples else 0.0,
                sum(s.confidence for s in box.samples) / len(box.samples) if box.samples else 0.0,
            )
            score = evidence_quality(
                mean_detection_confidence=mean_conf,
                entity_classes=[EntityClass.PERSON, EntityClass.BOX],
                sample_count=shared,
                min_expected_samples=config.behaviour_min_common_samples,
            )
            status, confidence = status_and_confidence(score, config)

            detected_action: Optional[dict[str, Any]] = None

            # Priority 1: Solo heavy handling (Scenario 12)
            if moving and product_metadata_by_id:
                solo = recognize_solo_heavy_handling(
                    box, persons, product_metadata_by_id, default_product_id, kinematics, config
                )
                if solo and solo.get("worker_id") == person.entity_id:
                    detected_action = solo

            # Priority 2: Stepping on cartons (Scenario 6)
            if not detected_action and has_stepping:
                detected_action = stepping_action

            # Priority 3: Throwing / Dropping (Scenario 2)
            if not detected_action and moving:
                detected_action = recognize_throwing_or_dropping(box, person, kinematics, config)

            # Priority 4: Dragging (Scenario 3)
            if not detected_action and moving:
                detected_action = recognize_dragging(
                    box, person, kinematics, proximity_fraction, histories, config
                )

            # Priority 5: Rolling (Scenario 4)
            if not detected_action and moving:
                detected_action = recognize_rolling(box, person, kinematics, shared)

            # Priority 6: Packaging straps as handles (Scenario 5)
            if not detected_action:
                detected_action = recognize_straps_as_handles(box, person, kinematics, proximity_fraction)

            # Priority 7: Fallback generic handling precursors
            if detected_action:
                scenario = detected_action["scenario"]
                explanation = detected_action["explanation"]
                band = detected_action.get("band", RiskBand.MEDIUM)
                custom_evidence = detected_action.get("evidence", {})
                limitations = detected_action.get("limitations", [
                    "no_pose_signal",
                    "no_contact_force_signal",
                    "box_detection_confidence_is_weak_pilot_class",
                ])
                epistemic_level = detected_action.get("epistemic_level", EpistemicLevel.INFERRED)
                action_status = detected_action.get("status") or (
                    FindingStatus.PROBABLE if status == FindingStatus.INSUFFICIENT_EVIDENCE else status
                )
                action_conf = detected_action.get("confidence") or (
                    ConfidenceLevel.MEDIUM if confidence == ConfidenceLevel.LOW else confidence
                )
            else:
                action_status = status
                action_conf = confidence
                scenario = "box_displacement_near_person" if moving else "person_box_sustained_proximity"
                band = RiskBand.LOW
                custom_evidence = {}
                parts = []
                if sustained:
                    parts.append(
                        f"person and box stayed within {config.behaviour_proximity_threshold} "
                        f"normalized distance for {proximity_fraction:.0%} of {shared} shared samples"
                    )
                if moving:
                    parts.append(f"box moved {displacement:.3f} normalized units total over the window")
                explanation = (
                    "; ".join(parts)
                    + ". This is proximity/displacement evidence only — it does NOT identify a "
                    "specific action such as throwing, dragging, or lifting."
                )
                limitations = [
                    "no_pose_signal",
                    "no_contact_force_signal",
                    "box_detection_confidence_is_weak_pilot_class",
                ]
                epistemic_level = EpistemicLevel.OBSERVED

            ev_dict: dict[str, Any] = {
                "sustained_proximity_fraction": proximity_fraction,
                "common_sample_count": shared,
                "box_total_displacement": displacement,
                "box_net_displacement": box_net,
                "trajectory_linearity": box_lin,
                "mean_detection_confidence": mean_conf,
            }
            ev_dict.update(custom_evidence)

            findings.append(
                RiskEvent(
                    timestamp=timestamp,
                    event_type=EventType.BEHAVIOUR,
                    lens=RiskLens.BEHAVIOUR,
                    entity_id=person.entity_id,
                    confidence=action_conf,
                    status=action_status,
                    band=band,
                    scenario=scenario,
                    entities=[person.entity_id, box.entity_id],
                    evidence=ev_dict,
                    explanation=explanation,
                    recommended_action=recommended_action(scenario, action_status),
                    limitations=limitations,
                    epistemic_level=epistemic_level,
                )
            )

    return findings, kinematics_by_id
