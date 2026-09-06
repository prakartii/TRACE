"""Safe Action Planner and What-If Simulation Engine (Phase 7B)."""

from backend.planner.actions import (
    WHAT_IF_ELIGIBLE_SCENARIOS,
    plan_action,
    recommended_action,
)
from backend.planner.generator import generate_placement_candidates
from backend.planner.simulation import run_what_if_simulation
from backend.planner.stability import (
    STABILITY_DISCLAIMER,
    classify_stability,
    compute_stability_score,
)

__all__ = [
    "WHAT_IF_ELIGIBLE_SCENARIOS",
    "plan_action",
    "recommended_action",
    "generate_placement_candidates",
    "run_what_if_simulation",
    "STABILITY_DISCLAIMER",
    "classify_stability",
    "compute_stability_score",
]
