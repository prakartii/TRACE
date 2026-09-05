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
    PerceptionFrameResult,
    RiskEvent,
    RiskLens,
)
from backend.planner.actions import recommended_action
from backend.risk.aggregation import evidence_quality, status_and_confidence
from backend.risk.config import DEFAULT_RISK_CONFIG, RiskConfig
from backend.world_model.temporal import (
    TrackHistory,
    build_track_histories,
    common_sample_count,
    sustained_proximity_fraction,
    total_displacement,
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
            sustained = (
                shared >= config.behaviour_min_common_samples
                and proximity_fraction >= config.behaviour_sustained_fraction
            )
            moving = displacement >= config.behaviour_box_displacement_threshold
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
