"""Behaviour Recognition lens (Phase 5, Priority 3 / Phase 12).

ARCHITECTURE.md Part 3 & Part 9, CLAUDE.md §7 & §14.

Evaluates behaviour findings across perception frame samples by delegating
to the modular Action Recognizer engine (backend.behaviour.recognizer).

Covers all 7 behaviour scenarios:
  1. Throwing / Dropping (Scenario 2)
  2. Dragging instead of lifting (Scenario 3)
  3. Rolling cartons or cylindrical cargo (Scenario 4)
  4. Packaging straps used as handles (Scenario 5)
  5. Stepping on cartons (Scenario 6)
  6. Solo heavy handling (Scenario 12)
  7. Handling precursors (proximity & displacement)
"""

from __future__ import annotations

from backend.behaviour.recognizer import (
    BEHAVIOUR_SCENARIOS_CATALOG,
    compute_kinematics,
    recognize_all_behaviours,
)
from backend.contracts.models import (
    ConfidenceLevel,
    EntityClass,
    EventType,
    FindingStatus,
    KinematicProfile,
    PerceptionFrameResult,
    ProductMetadata,
    RiskEvent,
    RiskLens,
)
from backend.risk.config import DEFAULT_RISK_CONFIG, RiskConfig


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
    findings, _ = recognize_all_behaviours(
        frame_results,
        frame_width=frame_width,
        frame_height=frame_height,
        timestamp=timestamp,
        config=config,
        product_metadata_by_id=product_metadata_by_id,
        default_product_id=default_product_id,
    )
    return findings
