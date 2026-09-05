"""Environmental Risk lens (Phase 5, Priority 6) — minimal, manual-config
abstraction only.

TRACE does NOT automatically detect wet floors, dock edges, or any other
environmental condition from video — no perception model or geometry
routine anywhere in this codebase classifies surface/zone conditions. What
this module provides is a static, manually-calibrated zone registry
(polygon coordinates in the same normalized [0, 1] image-space as
SceneGraphNode.position) that an operator would configure once per camera.
If no zones are configured, this lens returns nothing — never a guessed
environmental hazard. `severity_multiplier` is a scaling hook for a future
aggregation step; this lens does not itself apply it to anything yet.
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import Enum

from backend.contracts.models import (
    ConfidenceLevel,
    EventType,
    FindingStatus,
    RiskEvent,
    RiskLens,
    SceneGraphNode,
)
from backend.world_model.geometry import point_in_polygon


class ZoneType(str, Enum):
    WET_FLOOR = "wet_floor"
    DOCK_EDGE = "dock_edge"


@dataclass(frozen=True)
class EnvironmentalZone:
    """A manually calibrated, static zone. `polygon` is a list of
    normalized (x, y) points (>=3), same coordinate system as
    SceneGraphNode.position."""

    zone_id: str
    zone_type: ZoneType
    polygon: list[tuple[float, float]]
    severity_multiplier: float = 1.0


# Empty by default — no zones exist until an operator configures them for
# a specific camera/video. This is the honest default: TRACE has no
# environmental perception, only this manual-calibration hook.
CONFIGURED_ZONES: list[EnvironmentalZone] = []


def evaluate_environmental(
    nodes: list[SceneGraphNode],
    *,
    timestamp: float,
    zones: list[EnvironmentalZone] = CONFIGURED_ZONES,
) -> list[RiskEvent]:
    """Reports which entities currently sit inside a configured zone —
    purely geometric membership against operator-supplied coordinates,
    never an automatically classified condition. Returns [] whenever no
    zones are configured."""
    findings: list[RiskEvent] = []
    for node in nodes:
        for zone in zones:
            if not point_in_polygon(node.position, zone.polygon):
                continue
            findings.append(
                RiskEvent(
                    timestamp=timestamp,
                    event_type=EventType.RISK,
                    lens=RiskLens.ENVIRONMENTAL,
                    entity_id=node.entity_id,
                    confidence=ConfidenceLevel.HIGH,  # geometry, not detection
                    status=FindingStatus.SUPPORTED,
                    scenario=f"entity_in_{zone.zone_type.value}_zone",
                    entities=[node.entity_id],
                    evidence={"zone_id": zone.zone_id, "zone_type": zone.zone_type.value},
                    explanation=(
                        f"{node.entity_class.value} is inside manually configured zone "
                        f"'{zone.zone_id}' ({zone.zone_type.value}). This zone is operator-"
                        "calibrated, not automatically detected from video."
                    ),
                    recommended_action=None,
                    limitations=["zone_is_manually_calibrated_not_perceived"],
                )
            )
    return findings
