"""Unified epistemic gate for What-If simulation.

Both the single-frame engine (`backend.planner.simulation`, Phase 7B) and the
multi-frame trajectory engine (`backend.planner.whatif`, Phase 11) route every
"should we refuse?" decision through :func:`whatif_refusal` so the two engines
can never disagree about what is eligible for counterfactual placement
simulation.

Prior to this, `simulation.py` used an *allowlist* (`WHAT_IF_ELIGIBLE_SCENARIOS`)
while `whatif.py` used an ad-hoc *denylist* of a few personnel/zone scenarios
and silently defaulted every unrecognised scenario to ``"box_overhang"``. That
divergence is removed here.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Optional

from backend.contracts.models import EntityClass, FindingStatus
from backend.planner.actions import WHAT_IF_ELIGIBLE_SCENARIOS

# Scenarios that concern worker positioning or environmental zone safety rather
# than movable cargo placement. They are already absent from
# WHAT_IF_ELIGIBLE_SCENARIOS; this set only exists to give them a clearer
# operator-facing refusal message.
PERSONNEL_ZONE_SCENARIOS: frozenset[str] = frozenset(
    {
        "entity_in_dock_edge_zone",
        "entity_in_wet_floor_zone",
        "stepping_on_carton",
        "stepping_on_carton_precursor",
        "solo_heavy_handling",
    }
)

# Authoritative set of warehouse safety scenarios supported for What-If simulation
SUPPORTED_WHAT_IF_SCENARIOS: frozenset[str] = frozenset(
    {
        "heavy_on_light_stacking",
        "dropping_or_throwing_precursor",
        "carton_drop",
        "dragging_precursor",
        "rolling_precursor",
        "straps_as_handles",
        "stepping_on_carton",
        "stepping_on_carton_precursor",
        "wrong_product_orientation",
        "box_overhang",
        "pallet_overhang",
        "unsupported_bending_placement",
        "entity_in_dock_edge_zone",
        "entity_in_wet_floor_zone",
        "unplanned_loading_sequence",
        "solo_heavy_handling",
        "wrong_equipment_usage",
    }
)



@dataclass(frozen=True)
class WhatIfRefusal:
    """Why a What-If simulation is being declined."""

    reason: str  # short machine token, also surfaced in `limitations`
    notice: str  # operator-facing sentence
    limitations: list[str] = field(default_factory=list)


def _is_person(
    target_entity_class: Optional[EntityClass],
    target_entity_id: Optional[str],
) -> bool:
    if target_entity_class is not None:
        return target_entity_class == EntityClass.PERSON
    # Fallback only when the class is unknown (e.g. the trajectory engine runs
    # this gate before it has resolved the scene node).
    return bool(target_entity_id) and "person" in target_entity_id.lower()


def whatif_refusal(
    *,
    scenario: Optional[str],
    finding_status: Optional[FindingStatus | str] = None,
    target_entity_class: Optional[EntityClass] = None,
    target_entity_id: Optional[str] = None,
) -> Optional[WhatIfRefusal]:
    """Return a :class:`WhatIfRefusal` when simulation must be declined, else None.

    Evaluation order (first match wins):
      1. Evidence status is UNSUPPORTED / INSUFFICIENT_EVIDENCE.
      2. Target entity is a human worker.
      3. Scenario is not on the structural/conformance allowlist
         (`WHAT_IF_ELIGIBLE_SCENARIOS`) — this also rejects an unspecified
         scenario, so callers must resolve the real scenario first rather than
         relying on a silent default.
    """
    status = finding_status.value if isinstance(finding_status, FindingStatus) else finding_status
    status = (status or "").lower()
    if status in ("unsupported", "insufficient_evidence"):
        label = status.upper()
        if status == "unsupported":
            notice = (
                "Simulation unavailable: TRACE cannot safely determine this condition "
                f"from available evidence (finding status {label})."
            )
        else:
            notice = (
                "Simulation unavailable: the underlying scene evidence is insufficient "
                f"(finding status {label})."
            )
        return WhatIfRefusal(
            reason="unsupported_or_insufficient_evidence",
            notice=notice,
            limitations=["unsupported_or_insufficient_evidence"],
        )

    if _is_person(target_entity_class, target_entity_id):
        return WhatIfRefusal(
            reason="worker_entity_ineligible",
            notice=(
                "Simulation unavailable: the target entity is a human worker, not cargo "
                "or a package placement. TRACE does not simulate counterfactual "
                "repositioning of workers."
            ),
            limitations=["worker_entity_ineligible"],
        )

    scen = scenario or ""
    if scen not in WHAT_IF_ELIGIBLE_SCENARIOS:
        if scen in PERSONNEL_ZONE_SCENARIOS:
            notice = (
                "Simulation unavailable: this incident concerns worker positioning or "
                "environmental zone safety, not a physical placement."
            )
        else:
            shown = scen or "unspecified"
            notice = (
                f"Simulation unavailable: scenario '{shown}' is an operational or "
                "environmental hazard, not a physical placement."
            )
        return WhatIfRefusal(
            reason="non_placement_scenario",
            notice=notice,
            limitations=["non_placement_scenario"],
        )

    return None


def what_if_supported(
    *,
    scenario: Optional[str] = None,
    finding_status: Optional[FindingStatus | str] = None,
    video_id: Optional[str] = None,
    event_id: Optional[int] = None,
    event: Optional[Any] = None,
    db_conn: Optional[Any] = None,
) -> bool:
    """Authoritative capability check for What-If Safety Simulation.

    The What-If selector and simulation engine must ONLY expose incidents
    for which TRACE has a genuinely supported and validated What-If simulation.
    Refuses:
      - UNSUPPORTED / INSUFFICIENT_EVIDENCE findings
      - Unknown or unsupported scenarios
      - Events lacking linked videos or valid evidence
    """
    if event is not None:
        if isinstance(event, dict):
            scenario = scenario or event.get("scenario")
            finding_status = finding_status or event.get("status")
            video_id = video_id or event.get("video_id")
            event_id = event_id or event.get("event_id")
        else:
            scenario = scenario or getattr(event, "scenario", None)
            finding_status = finding_status or getattr(event, "status", None)
            video_id = video_id or getattr(event, "video_id", None)
            event_id = event_id or getattr(event, "event_id", None)

    if event_id is not None and (scenario is None or finding_status is None or video_id is None):
        try:
            from backend.db.db import get_connection
            conn = db_conn or get_connection()
            row = conn.execute(
                "SELECT scenario, status, video_id FROM events WHERE event_id = ?",
                (event_id,),
            ).fetchone()
            if row is not None:
                scenario = scenario or row["scenario"]
                finding_status = finding_status or row["status"]
                video_id = video_id or row["video_id"]
        except Exception:
            pass

    status_str = (
        finding_status.value if isinstance(finding_status, FindingStatus) else (finding_status or "")
    ).lower().strip()
    if status_str in ("unsupported", "insufficient_evidence"):
        return False
    if status_str and status_str not in ("supported", "probable"):
        return False

    scen = (scenario or "").strip().lower()
    if not scen or scen not in SUPPORTED_WHAT_IF_SCENARIOS:
        return False

    if video_id is not None and not str(video_id).strip():
        return False

    return True

