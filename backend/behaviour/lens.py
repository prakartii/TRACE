"""Behaviour Recognition lens (Phase 5, Priority 3).

Implements ONLY the behaviour evidence TRACE's current perception/temporal
layers can genuinely produce:
  - sustained PERSON<->BOX proximity (a BOX is actually, currently
    detected near a PERSON for a meaningful fraction of a time window)
  - repeated BOX displacement while that BOX is near a PERSON

Neither is ever labeled "throwing"/"dragging"/"lifting"/"rolling" — those
require pose/contact-force signals that do not exist anywhere upstream
(Entity.keypoints is always None). They are reported as generic
handling-precursor evidence only, and both are gated through
backend/risk/aggregation.py so a weak/absent BOX detection can never
produce a high-confidence finding.

Of ARCHITECTURE.md's 14 scenarios, this lens can only ever supply
supporting evidence toward #2 (throwing/dropping), #3 (dragging), #4
(rolling), and #12 (solo heavy handling) — it cannot conclusively resolve
any of them alone; multi-person-around-a-heavy-object (part of #12) is
NOT implemented because no product/mass metadata is linked to any entity
yet (see backend/lenses/conformance.py).
"""

from __future__ import annotations

from backend.contracts.models import (
    ConfidenceLevel,
    EntityClass,
    EventType,
    FindingStatus,
    MassClass,
    PerceptionFrameResult,
    ProductMetadata,
    RiskEvent,
    RiskLens,
)
from backend.planner.actions import recommended_action
from backend.risk.aggregation import evidence_quality, status_and_confidence
from backend.risk.config import DEFAULT_RISK_CONFIG, RiskConfig
from backend.world_model.temporal import (
    TrackHistory,
    average_speed,
    build_track_histories,
    common_sample_count,
    net_displacement,
    net_speed,
    sustained_proximity_fraction,
    total_displacement,
    trajectory_linearity,
)


def _mean_confidence(history: TrackHistory) -> float:
    if not history.samples:
        return 0.0
    return sum(s.confidence for s in history.samples) / len(history.samples)


def evaluate_behaviour(
    frame_results: list[PerceptionFrameResult],
    *,
    frame_width: int,
    frame_height: int,
    timestamp: float,
    config: RiskConfig = DEFAULT_RISK_CONFIG,
    product_metadata_by_id: dict[str, ProductMetadata] | None = None,
    default_product_id: str | None = None,
) -> list[RiskEvent]:
    """Evaluates behaviour evidence over `frame_results` — a window of
    already-cached, already-sampled perception output (no reprocessing).
    Always returns RiskLens.BEHAVIOUR events, `timestamp`-stamped."""
    histories = build_track_histories(frame_results, frame_width, frame_height)
    persons = [h for h in histories.values() if h.entity_class == EntityClass.PERSON]
    boxes = [h for h in histories.values() if h.entity_class == EntityClass.BOX]

    if not boxes:
        # Explicit, honest no-op: a missing BOX must never be upgraded
        # into a box-handling finding just because PERSON was detected
        # confidently (Phase 5 regression requirement).
        return [
            RiskEvent(
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
            )
        ]

    findings: list[RiskEvent] = []
    for person in persons:
        for box in boxes:
            shared = common_sample_count(person, box)
            if shared == 0:
                continue

            proximity_fraction = sustained_proximity_fraction(
                person, box, threshold=config.behaviour_proximity_threshold
            )
            displacement = total_displacement(box)
            box_net = net_displacement(box)
            box_lin = trajectory_linearity(box)
            min_net = getattr(config, "behaviour_box_min_net_displacement", 0.04)
            min_lin = getattr(config, "behaviour_box_min_linearity", 0.35)

            sustained = (
                shared >= config.behaviour_min_common_samples
                and proximity_fraction >= config.behaviour_sustained_fraction
            )
            # True physical motion requires cumulative displacement >= threshold AND
            # (net straight-line displacement >= min_net or high trajectory linearity),
            # filtering out stationary in-place bounding-box jitter loops.
            moving = (
                displacement >= config.behaviour_box_displacement_threshold
                and (box_net >= min_net or box_lin >= min_lin)
                and len(box.samples) >= 2
            )
            if not sustained and not moving:
                continue  # no meaningful evidence for this pair at all

            mean_conf = min(_mean_confidence(person), _mean_confidence(box))
            score = evidence_quality(
                mean_detection_confidence=mean_conf,
                entity_classes=[EntityClass.PERSON, EntityClass.BOX],
                sample_count=shared,
                min_expected_samples=config.behaviour_min_common_samples,
            )
            status, confidence = status_and_confidence(score, config)

            spd = net_speed(box) or average_speed(box)
            dx_net = box.last.position[0] - box.first.position[0]
            dy_net = box.last.position[1] - box.first.position[1]

            scenario = "box_displacement_near_person" if moving else "person_box_sustained_proximity"
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

            # Scenario 12: Solo heavy handling if metadata indicates this item is heavy and only 1 person handling
            if moving and product_metadata_by_id and box_net >= min_net:
                heavy_meta = None
                if default_product_id and default_product_id in product_metadata_by_id:
                    target_meta = product_metadata_by_id[default_product_id]
                    if target_meta.mass_class == MassClass.HEAVY:
                        heavy_meta = target_meta
                elif len(product_metadata_by_id) == 1:
                    target_meta = next(iter(product_metadata_by_id.values()))
                    if target_meta.mass_class == MassClass.HEAVY:
                        heavy_meta = target_meta

                if heavy_meta:
                    persons_near = [
                        p
                        for p in persons
                        if common_sample_count(p, box) >= 2
                        and sustained_proximity_fraction(p, box, config.behaviour_proximity_threshold) >= 0.3
                    ]
                    if len(persons_near) == 1 and persons_near[0].entity_id == person.entity_id:
                        scenario = "solo_heavy_handling"
                        explanation = (
                            f"Single worker handling heavy item '{heavy_meta.product_id}' ({heavy_meta.mass_class.value} mass class) "
                            f"without team assistance (box displacement: {displacement:.3f}). Exceeds single-person safe handling guidelines."
                        )

            # Scenario 6: Stepping on carton precursor (worker vertically elevated with feet atop carton)
            if scenario == "person_box_sustained_proximity" and sustained:
                p_foot = person.last.footprint
                b_foot = box.last.footprint
                is_stepping = False
                if p_foot and b_foot:
                    # Feet of person (y2) rests near top tier of box (y1) with body elevated above box
                    feet_near_top = (b_foot.y1 - 0.08) <= p_foot.y2 <= (b_foot.y1 + 0.12)
                    body_elevated = p_foot.y1 < b_foot.y1
                    horiz_overlap = min(p_foot.x2, b_foot.x2) > max(p_foot.x1, b_foot.x1)
                    if feet_near_top and body_elevated and horiz_overlap:
                        is_stepping = True
                else:
                    person_pos = person.last.position
                    box_pos = box.last.position
                    if person_pos[1] < box_pos[1] and abs(person_pos[0] - box_pos[0]) < 0.08:
                        is_stepping = True

                if is_stepping:
                    scenario = "stepping_on_carton_precursor"
                    explanation = (
                        "Worker footprint vertically overlaps upper carton tier in 2D projection "
                        "(elevation-overlap precursor hypothesis; 2D camera cannot measure downward ground-reaction force). "
                        "Stepping on cartons crushes contents and creates worker fall hazard."
                    )

            # Scenario 2: Throwing/dropping kinematic precursor
            if moving and scenario == "box_displacement_near_person":
                min_vel_samples = getattr(config, "behaviour_box_min_samples_for_velocity", 3)
                if len(box.samples) >= min_vel_samples and box_net >= min_net:
                    if dy_net >= 0.08 and (dy_net / max(displacement, 1e-6)) >= 0.60 and (spd is not None and spd >= 0.15):
                        scenario = "dropping_or_throwing_precursor"
                        explanation = (
                            f"Box exhibited rapid downward displacement (speed: {spd:.2f} norm/s, vertical drop: {dy_net:.3f}) "
                            "near worker. Kinematic signature indicates dropping, throwing, or falling precursor hypothesis."
                        )
                    elif spd is not None and spd >= 0.30 and box_net >= 0.08:
                        scenario = "dropping_or_throwing_precursor"
                        explanation = (
                            f"Box exhibited projectile translation velocity (speed: {spd:.2f} norm/s, displacement: {displacement:.3f}) "
                            "near worker. Kinematic signature indicates throwing or rapid release precursor hypothesis."
                        )
                    # Scenario 3: Dragging precursor (sustained horizontal translation near ground level with worker contact)
                    elif (
                        abs(dx_net) / max(displacement, 1e-6) >= 0.65
                        and displacement >= 0.08
                        and box_net >= min_net
                        and box.last.position[1] >= 0.50
                    ):
                        p_dx = person.last.position[0] - person.first.position[0]
                        same_direction = (p_dx * dx_net) >= -0.01
                        if same_direction and proximity_fraction >= 0.40:
                            scenario = "dragging_precursor"
                            explanation = (
                                f"Box exhibited sustained ground-level translation (displacement {displacement:.3f}, horizontal ratio "
                                f"{abs(dx_net)/displacement:.0%}) near worker without elevation. "
                                "Kinematic signature indicates dragging precursor hypothesis."
                            )

            findings.append(
                RiskEvent(
                    timestamp=timestamp,
                    event_type=EventType.BEHAVIOUR,
                    lens=RiskLens.BEHAVIOUR,
                    entity_id=person.entity_id,
                    confidence=confidence,
                    status=status,
                    scenario=scenario,
                    entities=[person.entity_id, box.entity_id],
                    evidence={
                        "sustained_proximity_fraction": proximity_fraction,
                        "common_sample_count": shared,
                        "box_total_displacement": displacement,
                        "mean_detection_confidence": mean_conf,
                    },
                    explanation=explanation,
                    recommended_action=recommended_action(scenario, status),
                    limitations=[
                        "no_pose_signal",
                        "no_contact_force_signal",
                        "box_detection_confidence_is_weak_pilot_class",
                    ],
                )
            )

    return findings
