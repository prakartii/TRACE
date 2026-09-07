"""Near-miss classification logic for TRACE (Phase 10 / ARCHITECTURE.md §5.7 & CLAUDE.md §16).

Near-miss is a first-class operational event representing a high-risk situation
where an alert/intervention occurred and a hazard was averted or mitigated, but
not all three strict prevention conditions were cleanly met.
"""

from __future__ import annotations

from typing import Any, Optional

from backend.contracts.models import (
    ConditionCheckResult,
    FindingStatus,
    RiskBand,
    RiskEvent,
)


def evaluate_near_miss(
    event: RiskEvent,
    cond_1: ConditionCheckResult,
    cond_2: ConditionCheckResult,
    cond_3: ConditionCheckResult,
    has_correction: bool = False,
    correction_outside_window: bool = False,
    marginal_improvement: bool = False,
    human_review_status: Optional[str] = None,
) -> tuple[bool, str, dict[str, Any]]:
    """Evaluates whether an event qualifies for the 'Near-miss' classification bucket.

    ARCHITECTURE.md §5.7:
    'Near-miss — high risk + alert fired + some correction occurred, but not all
    three conditions cleanly met (e.g., correction happened but outside the
    window, or improvement was marginal).'

    CLAUDE.md §16:
    'Near-miss is a first-class event type. It represents a meaningful/high-risk
    event where:
    - TRACE alerted/intervened
    - corrective action occurred
    - no confirmed failure occurred'
    """
    # Confirmed damage can never be classified as near-miss
    if human_review_status == "confirmed_damage" or event.review_status == "confirmed_damage":
        return (
            False,
            "Event has confirmed damage verified by operator review; excluded from near-miss.",
            {"confirmed_damage": True},
        )

    # Condition 1 check: Meaningful/high risk must have been predicted
    is_high_risk = event.band in (RiskBand.HIGH, RiskBand.CRITICAL) or (
        event.score is not None and event.score >= 60.0
    )
    is_meaningful_risk = cond_1.satisfied and (
        is_high_risk
        or event.band == RiskBand.MEDIUM
        or (event.score is not None and event.score >= 40.0)
    )

    if not is_meaningful_risk:
        return (
            False,
            "Event did not present a sufficiently high or meaningful risk threshold for near-miss categorization.",
            {"is_meaningful_risk": False, "band": event.band.value if event.band else None},
        )

    # Must have had an alert / recommendation
    alert_fired = (
        event.planner_recommendation is not None
        or bool(event.recommended_action)
        or event.status in (FindingStatus.SUPPORTED, FindingStatus.PROBABLE)
    )
    if not alert_fired:
        return (
            False,
            "No proactive intervention or alert fired for this event.",
            {"alert_fired": False},
        )

    # Correction evidence
    any_correction = (
        cond_2.satisfied
        or has_correction
        or correction_outside_window
        or "correction_outside_window" in cond_2.limitations
    )

    if not any_correction:
        return (
            False,
            "No corrective adjustment, repositioning, or evasive action was evidenced.",
            {"any_correction": False},
        )

    # If all three conditions are satisfied, it is full PREVENTED, not merely near-miss
    if cond_1.satisfied and cond_2.satisfied and cond_3.satisfied:
        return (
            False,
            "All three prevention conditions were cleanly met; event qualifies as full Prevented.",
            {"all_three_satisfied": True},
        )

    # Qualified Near-miss conditions:
    # 1. High/meaningful risk alert + correction happened outside window
    # 2. High/meaningful risk alert + correction happened in window, but improvement was marginal
    # 3. High/meaningful risk alert + correction evidenced, but post-state evidence has minor ambiguity
    evidence: dict[str, Any] = {
        "is_high_risk": is_high_risk,
        "alert_fired": True,
        "correction_observed": True,
        "correction_outside_window": correction_outside_window or ("correction_outside_window" in cond_2.limitations),
        "marginal_improvement": marginal_improvement or ("marginal_improvement" in cond_3.limitations),
    }

    rationale_parts = []
    if is_high_risk:
        rationale_parts.append(f"High risk alert ({event.band.value if event.band else 'Score ' + str(event.score)}) was triggered.")
    else:
        rationale_parts.append("Meaningful risk alert was triggered.")

    if correction_outside_window or ("correction_outside_window" in cond_2.limitations):
        rationale_parts.append("Corrective action was taken, but completed outside the immediate response time window.")
    elif marginal_improvement or ("marginal_improvement" in cond_3.limitations):
        rationale_parts.append("Corrective adjustment was observed, but post-action stability improvement was marginal.")
    else:
        rationale_parts.append("Corrective action mitigated the acute hazard without confirmed failure, though full prevention conditions were not cleanly verified.")

    return True, " ".join(rationale_parts), evidence
