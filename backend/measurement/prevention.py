"""Prevention measurement engine for TRACE (Phase 10 / ARCHITECTURE.md §5.7).

Executes the 3-condition check to classify operational events into:
1. Prevented (all three conditions met)
2. Near-miss (high risk + alert + partial/belated correction)
3. Outcome unclear (insufficient evidence / indeterminate post-state)
4. Confirmed damage (human operator review only)
"""

from __future__ import annotations

import logging
import time
from typing import Any, Optional

from backend.contracts.models import (
    ConditionCheckResult,
    FindingStatus,
    OutcomeMeasurement,
    PreventionClassification,
    RiskBand,
    RiskEvent,
    ThreeConditionCheck,
)
from backend.measurement.nearmiss import evaluate_near_miss

logger = logging.getLogger("trace.prevention")

DEFAULT_RESPONSE_WINDOW_SEC = 5.0


def check_condition_1_risk_predicted(event: RiskEvent) -> ConditionCheckResult:
    """Condition 1: TRACE predicted a meaningful risk.

    Requires:
    - FindingStatus is SUPPORTED or PROBABLE (never UNSUPPORTED or INSUFFICIENT_EVIDENCE)
    - Severity band is at least MEDIUM, HIGH, or CRITICAL (or risk score >= 40.0)
    """
    evidence: dict[str, Any] = {
        "status": event.status.value if hasattr(event.status, "value") else str(event.status),
        "band": event.band.value if event.band and hasattr(event.band, "value") else str(event.band),
        "score": event.score,
        "scenario": event.scenario,
        "lens": event.lens.value if hasattr(event.lens, "value") else str(event.lens),
    }
    limitations: list[str] = []

    if event.status in (FindingStatus.UNSUPPORTED, FindingStatus.INSUFFICIENT_EVIDENCE):
        limitations.append("insufficient_evidence_status")
        return ConditionCheckResult(
            condition_number=1,
            name="Meaningful Risk Predicted",
            satisfied=False,
            description=(
                f"Finding status '{event.status.value}' does not meet the epistemic threshold "
                "for a verified operational risk prediction."
            ),
            evidence=evidence,
            limitations=limitations,
        )

    is_meaningful_band = event.band in (RiskBand.MEDIUM, RiskBand.HIGH, RiskBand.CRITICAL)
    is_meaningful_score = event.score is not None and event.score >= 40.0

    if not (is_meaningful_band or is_meaningful_score):
        limitations.append("risk_severity_below_threshold")
        return ConditionCheckResult(
            condition_number=1,
            name="Meaningful Risk Predicted",
            satisfied=False,
            description=(
                f"Risk severity band '{event.band.value if event.band else 'None'}' and score "
                f"{event.score} do not indicate an actionable risk event."
            ),
            evidence=evidence,
            limitations=limitations,
        )

    return ConditionCheckResult(
        condition_number=1,
        name="Meaningful Risk Predicted",
        satisfied=True,
        description=(
            f"TRACE predicted a verified operational risk ({event.scenario or event.lens.value}) "
            f"with {event.status.value.upper()} status and {event.band.value if event.band else 'elevated'} severity."
        ),
        evidence=evidence,
        limitations=limitations,
    )


def check_condition_2_action_observed(
    event: RiskEvent,
    post_event_data: Optional[dict[str, Any]] = None,
    response_window_sec: float = DEFAULT_RESPONSE_WINDOW_SEC,
) -> ConditionCheckResult:
    """Condition 2: Corrective action occurred within the defined response window.

    Requires evidence that:
    - A corrective placement, worker redirection, or stabilization occurred.
    - The action occurred within response_window_sec of the initial event timestamp.
    """
    evidence: dict[str, Any] = {"response_window_sec": response_window_sec}
    limitations: list[str] = []

    if not post_event_data:
        limitations.append("no_post_event_observation_data")
        return ConditionCheckResult(
            condition_number=2,
            name="Corrective Action Within Window",
            satisfied=False,
            description="No post-intervention observation data available to verify corrective action.",
            evidence=evidence,
            limitations=limitations,
        )

    action_observed = post_event_data.get("action_observed", False)
    action_timestamp = post_event_data.get("action_timestamp")
    followed = post_event_data.get("followed_recommendation")
    delta_t = (
        (action_timestamp - event.timestamp)
        if (action_timestamp is not None and event.timestamp is not None)
        else post_event_data.get("elapsed_sec")
    )

    evidence.update({
        "action_observed": action_observed,
        "action_timestamp": action_timestamp,
        "elapsed_sec": delta_t,
        "followed_recommendation": followed,
        "action_type": post_event_data.get("action_type", "unspecified"),
    })

    if not action_observed and not followed:
        limitations.append("no_corrective_action_detected")
        return ConditionCheckResult(
            condition_number=2,
            name="Corrective Action Within Window",
            satisfied=False,
            description="No corrective action or recommendation compliance was observed following the alert.",
            evidence=evidence,
            limitations=limitations,
        )

    if delta_t is not None and delta_t > response_window_sec:
        limitations.append("correction_outside_window")
        return ConditionCheckResult(
            condition_number=2,
            name="Corrective Action Within Window",
            satisfied=False,
            description=(
                f"Corrective action was observed at +{delta_t:.1f}s, exceeding the "
                f"{response_window_sec:.1f}s response time window."
            ),
            evidence=evidence,
            limitations=limitations,
        )

    return ConditionCheckResult(
        condition_number=2,
        name="Corrective Action Within Window",
        satisfied=True,
        description=(
            f"Corrective action ({post_event_data.get('action_type', 'corrective adjustment')}) "
            f"was observed within {delta_t:.1f}s of notification (window: {response_window_sec:.1f}s)."
            if delta_t is not None
            else f"Corrective action confirmed within the {response_window_sec:.1f}s window."
        ),
        evidence=evidence,
        limitations=limitations,
    )


def check_condition_3_state_improved(
    event: RiskEvent,
    post_event_data: Optional[dict[str, Any]] = None,
) -> ConditionCheckResult:
    """Condition 3: Subsequent world-model state returned to a safer condition.

    Requires:
    - Post-action scene state re-evaluation confirms improved stability,
      resolved conformance violation, or cleared hazard zone.
    """
    evidence: dict[str, Any] = {}
    limitations: list[str] = []

    if not post_event_data:
        limitations.append("no_post_state_re_evaluation")
        return ConditionCheckResult(
            condition_number=3,
            name="Safer Post-Action State Confirmed",
            satisfied=False,
            description="Post-action world-model state re-evaluation is unavailable.",
            evidence=evidence,
            limitations=limitations,
        )

    outcome_score = post_event_data.get("outcome_score")
    outcome_band = post_event_data.get("outcome_band")
    initial_score = event.score if event.score is not None else post_event_data.get("initial_score")
    risk_resolved = post_event_data.get("risk_resolved", False)
    marginal = post_event_data.get("marginal_improvement", False)

    evidence.update({
        "initial_score": initial_score,
        "outcome_score": outcome_score,
        "initial_band": event.band.value if event.band else None,
        "outcome_band": outcome_band.value if hasattr(outcome_band, "value") else outcome_band,
        "risk_resolved": risk_resolved,
        "marginal_improvement": marginal,
    })

    if marginal:
        limitations.append("marginal_improvement")
        return ConditionCheckResult(
            condition_number=3,
            name="Safer Post-Action State Confirmed",
            satisfied=False,
            description=(
                f"Post-action re-evaluation showed only marginal improvement "
                f"(score {initial_score} -> {outcome_score}); insufficient for verified safe outcome."
            ),
            evidence=evidence,
            limitations=limitations,
        )

    if risk_resolved:
        return ConditionCheckResult(
            condition_number=3,
            name="Safer Post-Action State Confirmed",
            satisfied=True,
            description="Subsequent world-model state confirms complete resolution of the risk condition.",
            evidence=evidence,
            limitations=limitations,
        )

    if initial_score is not None and outcome_score is not None:
        score_delta = outcome_score - initial_score
        evidence["score_delta"] = score_delta
        if score_delta <= -15.0 or (outcome_band in ("Low", RiskBand.LOW) and event.band in (RiskBand.HIGH, RiskBand.CRITICAL, "High", "Critical")):
            return ConditionCheckResult(
                condition_number=3,
                name="Safer Post-Action State Confirmed",
                satisfied=True,
                description=(
                    f"Subsequent world-model state confirmed substantial risk reduction "
                    f"({initial_score:.1f} -> {outcome_score:.1f}, delta {score_delta:.1f})."
                ),
                evidence=evidence,
                limitations=limitations,
            )
        elif score_delta < 0:
            limitations.append("marginal_improvement")
            return ConditionCheckResult(
                condition_number=3,
                name="Safer Post-Action State Confirmed",
                satisfied=False,
                description=(
                    f"Risk score reduction was marginal ({initial_score:.1f} -> {outcome_score:.1f}); "
                    "does not meet threshold for verified safe state."
                ),
                evidence=evidence,
                limitations=limitations,
            )
        else:
            limitations.append("risk_score_worsened_or_unchanged")
            return ConditionCheckResult(
                condition_number=3,
                name="Safer Post-Action State Confirmed",
                satisfied=False,
                description=(
                    f"Subsequent state did not improve (score: {initial_score:.1f} -> {outcome_score:.1f})."
                ),
                evidence=evidence,
                limitations=limitations,
            )

    limitations.append("insufficient_metric_data")
    return ConditionCheckResult(
        condition_number=3,
        name="Safer Post-Action State Confirmed",
        satisfied=False,
        description="Insufficient quantitative metrics to confirm safe post-action state.",
        evidence=evidence,
        limitations=limitations,
    )


def evaluate_prevention(
    event: RiskEvent,
    post_event_data: Optional[dict[str, Any]] = None,
    response_window_sec: float = DEFAULT_RESPONSE_WINDOW_SEC,
    human_review_status: Optional[str] = None,
) -> OutcomeMeasurement:
    """Performs the full Phase 10 outcome verification and 3-condition check.

    Returns an auditable OutcomeMeasurement typed record.
    """
    effective_review = human_review_status or event.review_status

    cond_1 = check_condition_1_risk_predicted(event)
    cond_2 = check_condition_2_action_observed(event, post_event_data, response_window_sec)
    cond_3 = check_condition_3_state_improved(event, post_event_data)

    all_satisfied = bool(cond_1.satisfied and cond_2.satisfied and cond_3.satisfied)

    three_check = ThreeConditionCheck(
        condition_1_risk_predicted=cond_1,
        condition_2_action_observed=cond_2,
        condition_3_state_improved=cond_3,
        all_satisfied=all_satisfied,
    )

    # 1. Human review confirmed damage always takes precedence and is NEVER self-assigned
    if effective_review == "confirmed_damage":
        classification = PreventionClassification.CONFIRMED_DAMAGE
        explanation = (
            "Confirmed damage: Event confirmed as cargo/equipment damage through human operator review. "
            "Automated prevention classification is overridden by human judgment."
        )
    # 2. All 3 conditions hold -> PREVENTED
    elif all_satisfied:
        classification = PreventionClassification.PREVENTED
        explanation = (
            "All three prevention conditions satisfied: meaningful risk predicted, "
            "corrective action observed within the response window, and subsequent "
            "world-model state confirmed return to a safe operational condition."
        )
    # 3. Near-miss evaluation
    else:
        is_near_miss, nm_rationale, nm_evidence = evaluate_near_miss(
            event=event,
            cond_1=cond_1,
            cond_2=cond_2,
            cond_3=cond_3,
            has_correction=post_event_data.get("action_observed", False) if post_event_data else False,
            correction_outside_window=("correction_outside_window" in cond_2.limitations),
            marginal_improvement=("marginal_improvement" in cond_3.limitations),
            human_review_status=effective_review,
        )
        if is_near_miss:
            classification = PreventionClassification.NEAR_MISS
            explanation = nm_rationale
        else:
            classification = PreventionClassification.OUTCOME_UNCLEAR
            reasons = []
            if not cond_1.satisfied:
                reasons.append("unverified initial risk prediction")
            if not cond_2.satisfied:
                reasons.append("unverified or missing corrective action")
            if not cond_3.satisfied:
                reasons.append("unverified subsequent world-model improvement")
            explanation = (
                f"Outcome cannot be definitively verified as prevented ({', '.join(reasons)}). "
                "Classified as Outcome Unclear preserving epistemic discipline."
            )

    all_limitations: list[str] = []
    all_limitations.extend(cond_1.limitations)
    all_limitations.extend(cond_2.limitations)
    all_limitations.extend(cond_3.limitations)

    all_evidence: dict[str, Any] = {
        "condition_1": cond_1.evidence,
        "condition_2": cond_2.evidence,
        "condition_3": cond_3.evidence,
    }
    if post_event_data:
        all_evidence["post_event_raw"] = {
            k: v for k, v in post_event_data.items() if k not in ("action_observed", "outcome_score")
        }

    initial_band = event.band
    outcome_band_val = post_event_data.get("outcome_band") if post_event_data else None
    outcome_band = RiskBand(outcome_band_val) if outcome_band_val in RiskBand._value2member_map_ else None

    return OutcomeMeasurement(
        event_id=event.event_id or 0,
        video_id=event.video_id,
        initial_timestamp=event.timestamp,
        outcome_timestamp=post_event_data.get("action_timestamp") if post_event_data else None,
        response_window_sec=response_window_sec,
        classification=classification,
        three_condition_check=three_check,
        initial_score=event.score,
        outcome_score=post_event_data.get("outcome_score") if post_event_data else None,
        initial_band=initial_band,
        outcome_band=outcome_band,
        followed_recommendation=post_event_data.get("followed_recommendation") if post_event_data else None,
        human_review_status=effective_review,
        explanation=explanation,
        evidence=all_evidence,
        limitations=list(dict.fromkeys(all_limitations)),
        evaluated_at=time.time(),
    )


def verify_event_outcome_from_perception(
    event: RiskEvent,
    results: list[Any],
    frame_width: int,
    frame_height: int,
    world_model: Any,
    manifest: Optional[Any] = None,
    response_window_sec: float = DEFAULT_RESPONSE_WINDOW_SEC,
    human_review_status: Optional[str] = None,
) -> OutcomeMeasurement:
    """Verifies the outcome of an event by sampling subsequent perception frames in the video cache."""
    from backend.behaviour.lens import evaluate_behaviour
    from backend.lenses.conformance import STANDARD_CONFORMANCE_RULES, evaluate_conformance
    from backend.lenses.environmental import CONFIGURED_ZONES, evaluate_environmental
    from backend.lenses.structural import evaluate_structural

    # Find the frame index nearest to the event timestamp
    initial_ts = event.timestamp
    nearest_idx = 0
    min_delta = float("inf")
    for i, res in enumerate(results):
        d = abs(res.timestamp - initial_ts)
        if d < min_delta:
            min_delta = d
            nearest_idx = i

    # Look for subsequent frames within the response window
    window_end_ts = initial_ts + response_window_sec
    subsequent_frames = [
        res for res in results[nearest_idx + 1 :]
        if res.timestamp <= window_end_ts + 0.1
    ]

    if not subsequent_frames:
        # Video ended, frame was at the very end, or no subsequent samples
        post_data = {
            "action_observed": False,
            "outcome_score": None,
            "risk_resolved": False,
            "marginal_improvement": False,
        }
        return evaluate_prevention(
            event=event,
            post_event_data=post_data,
            response_window_sec=response_window_sec,
            human_review_status=human_review_status,
        )

    # Evaluate the latest frame within the response window
    post_frame = subsequent_frames[-1]
    post_ts = post_frame.timestamp

    # Build snapshot at post frame
    product_metadata_by_id = (
        {p.product_id: p for p in manifest.product_metadata} if manifest else {}
    )
    default_product_id = manifest.primary_product_id if manifest else None
    zones = manifest.environmental_zones if manifest else CONFIGURED_ZONES

    post_snapshot = world_model.build_snapshot(
        post_frame.entities,
        frame_width=frame_width,
        frame_height=frame_height,
        timestamp=post_ts,
        default_product_id=default_product_id,
        compute_aspect_orientation=True,
    )
    post_conf = {e.id: e.confidence for e in post_frame.entities}

    # Evaluate lenses at post frame
    post_findings: list[RiskEvent] = []
    post_findings.extend(
        evaluate_structural(
            post_snapshot,
            entity_confidence=post_conf,
            product_metadata_by_id=product_metadata_by_id,
        )
    )
    post_findings.extend(
        evaluate_conformance(
            post_snapshot.nodes,
            product_metadata_by_id=product_metadata_by_id,
            timestamp=post_ts,
            rules=STANDARD_CONFORMANCE_RULES,
        )
    )
    post_findings.extend(
        evaluate_environmental(
            post_snapshot.nodes,
            timestamp=post_ts,
            zones=zones,
        )
    )

    # Check if target entity still has this specific finding
    target_ent = event.entity_id
    matching_post_findings = [
        f for f in post_findings
        if f.scenario == event.scenario and (
            f.entity_id == target_ent or (target_ent and target_ent in f.entities)
        )
    ]

    initial_ent_node = None
    post_ent_node = next((n for n in post_snapshot.nodes if n.entity_id == target_ent), None)

    # Check if action was observed
    # 1. Entity position changed substantially (repositioned)
    # 2. Risk finding resolved or downgraded
    action_observed = False
    action_type = "unobserved"
    outcome_score = 0.0
    outcome_band = "Low"
    risk_resolved = False
    marginal = False

    if not matching_post_findings:
        # Risk scenario is no longer present on this entity at post frame
        risk_resolved = True
        action_observed = True
        action_type = "risk_resolved"
        outcome_score = 0.0
        outcome_band = "Low"
    else:
        # Finding still present: compare scores
        post_finding = matching_post_findings[0]
        outcome_score = post_finding.score or 0.0
        outcome_band = post_finding.band.value if post_finding.band else "Low"
        initial_score = event.score or 50.0

        if outcome_score < initial_score - 15.0:
            action_observed = True
            action_type = "hazard_reduction"
        elif outcome_score < initial_score:
            action_observed = True
            action_type = "minor_adjustment"
            marginal = True
        else:
            action_observed = False
            action_type = "no_improvement"

    post_data = {
        "action_observed": action_observed,
        "action_timestamp": post_ts,
        "action_type": action_type,
        "elapsed_sec": round(post_ts - initial_ts, 2),
        "outcome_score": outcome_score,
        "outcome_band": outcome_band,
        "risk_resolved": risk_resolved,
        "marginal_improvement": marginal,
        "post_frame_timestamp": post_ts,
        "followed_recommendation": risk_resolved,
    }

    return evaluate_prevention(
        event=event,
        post_event_data=post_data,
        response_window_sec=response_window_sec,
        human_review_status=human_review_status,
    )
