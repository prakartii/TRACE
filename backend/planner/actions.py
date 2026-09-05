"""Safe Action Planner integration for Phase 5 findings (Priority 8).

Maps a finding's (scenario, status) to an operator-facing recommended
action, centralized here so wording is reviewed/changed in one place
instead of duplicated per lens (CLAUDE.md §12's "single engine" principle
applied to action text). This is intentionally simple — the full Safe
Action Planner (candidate placement generation/scoring, ARCHITECTURE.md
Part 11) is Phase 8; this only attaches an honest, urgency-labeled action
to a finding whose status already reflects evidence quality
(backend/risk/aggregation.py), and refuses to recommend anything when the
evidence doesn't clear the bar for a real finding.
"""

from __future__ import annotations

from typing import Optional

from backend.contracts.models import FindingStatus

# Scenario -> base action text. Kept here, not per-lens.
_SCENARIO_ACTIONS: dict[str, str] = {
    "image_space_support_hypothesis": (
        "Verify the lower item's load capacity and stacking stability before continuing."
    ),
    "box_displacement_near_person": (
        "Review this clip for manual handling technique before drawing conclusions."
    ),
    "person_box_sustained_proximity": (
        "Review this clip for manual handling technique before drawing conclusions."
    ),
}


def recommended_action(scenario: Optional[str], status: FindingStatus) -> Optional[str]:
    """Returns an urgency-prefixed action string, or None when the
    evidence doesn't clear the bar for recommending anything —
    INSUFFICIENT_EVIDENCE/UNSUPPORTED findings must never carry the same
    confident phrasing as a SUPPORTED one."""
    base = _SCENARIO_ACTIONS.get(scenario or "")
    if base is None:
        return None
    if status == FindingStatus.SUPPORTED:
        return f"Immediate precaution: {base}"
    if status == FindingStatus.PROBABLE:
        return f"Verification required: {base}"
    return None
