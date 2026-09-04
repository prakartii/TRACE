"""Typed data contracts shared across TRACE's backend layers.

perception -> world model -> lenses -> predictive risk -> planner ->
intervention -> measurement communicate only through these types. No
downstream module should depend on raw YOLO/ByteTrack output shapes or on
frontend-specific structures. These are data contracts only — no scoring,
detection, or reasoning logic lives here.
"""

from __future__ import annotations

from enum import Enum
from typing import Optional

from pydantic import BaseModel, Field


class EntityClass(str, Enum):
    BOX = "box"
    PALLET = "pallet"
    TROLLEY = "trolley"
    PERSON = "person"
    VEHICLE_BED = "vehicle_bed"


class MassClass(str, Enum):
    LIGHT = "light"
    MEDIUM = "medium"
    HEAVY = "heavy"


class Fragility(str, Enum):
    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"


class RiskBand(str, Enum):
    LOW = "Low"
    MEDIUM = "Medium"
    HIGH = "High"
    CRITICAL = "Critical"


class ConfidenceLevel(str, Enum):
    HIGH = "High"
    MEDIUM = "Medium"
    LOW = "Low"


class RiskLens(str, Enum):
    STRUCTURAL = "structural"
    BEHAVIOUR = "behaviour"
    CONFORMANCE = "conformance"
    ENVIRONMENTAL = "environmental"


class EventType(str, Enum):
    RISK = "risk"
    PLANNER_REC = "planner_rec"
    BEHAVIOUR = "behaviour"
    NEAR_MISS = "near_miss"
    PREVENTED = "prevented"
    CONFIRMED_DAMAGE = "confirmed_damage"


class PreventionClassification(str, Enum):
    """Output of the 3-condition check (ARCHITECTURE.md Part 5.7). Never
    self-assigned as CONFIRMED_DAMAGE — that requires human review."""

    PREVENTED = "prevented"
    NEAR_MISS = "near_miss"
    OUTCOME_UNCLEAR = "outcome_unclear"
    CONFIRMED_DAMAGE = "confirmed_damage"


class RuleKind(str, Enum):
    PRODUCT = "product"
    CUSTOM = "custom"


class ProductRuleType(str, Enum):
    MAX_STACK_HEIGHT = "max_stack_height"
    REQUIRED_ORIENTATION = "required_orientation"


class SceneGraphEdgeType(str, Enum):
    SUPPORT = "support"
    CONTACT = "contact"
    PROXIMITY = "proximity"


class BoundingBox(BaseModel):
    x1: float
    y1: float
    x2: float
    y2: float


class Entity(BaseModel):
    """A single per-frame detection/tracking result — Layer 1's contract
    with the world model."""

    id: str
    track_id: Optional[str] = None
    entity_class: EntityClass
    bbox: BoundingBox
    confidence: float = Field(ge=0.0, le=1.0)
    timestamp: float
    keypoints: Optional[list[tuple[float, float]]] = None


class ProductMetadata(BaseModel):
    product_id: str
    class_name: str
    mass_class: MassClass
    fragility: Fragility
    required_orientation: Optional[str] = None
    max_stack_height: Optional[int] = None


class SceneGraphNode(BaseModel):
    entity_id: str
    entity_class: EntityClass
    position: tuple[float, float]
    footprint: Optional[BoundingBox] = None
    orientation: Optional[float] = None
    product_id: Optional[str] = None


class SceneGraphEdge(BaseModel):
    source_id: str
    target_id: str
    edge_type: SceneGraphEdgeType
    weight: float = Field(ge=0.0, le=1.0)


class SceneGraphSnapshot(BaseModel):
    timestamp: float
    nodes: list[SceneGraphNode]
    edges: list[SceneGraphEdge]


class RiskEvent(BaseModel):
    event_id: Optional[int] = None
    timestamp: float
    event_type: EventType
    lens: RiskLens
    entity_id: str
    score: float
    band: RiskBand
    confidence: ConfidenceLevel
    factor_breakdown: dict[str, float] = Field(default_factory=dict)
    clip_path: Optional[str] = None


class PlacementCandidate(BaseModel):
    """One scored hypothetical placement. Shared by the Safe Action Planner
    and what-if simulation so both reuse the same stability engine
    (CLAUDE.md §12) instead of two contradictory scoring paths."""

    position: tuple[float, float]
    orientation: Optional[float] = None
    score: float
    band: RiskBand
    hard_constraints_passed: bool
    factor_breakdown: dict[str, float] = Field(default_factory=dict)


class PlannerRecommendation(BaseModel):
    event_id: Optional[int] = None
    candidates: list[PlacementCandidate]
    recommended_position: tuple[float, float]
    expected_delta: float
    confidence: ConfidenceLevel
    instruction_text: str


class Rule(BaseModel):
    rule_id: Optional[int] = None
    kind: RuleKind
    product_id: Optional[str] = None
    rule_type: Optional[ProductRuleType] = None
    rule_value: Optional[str] = None
    description: Optional[str] = None
    condition: Optional[dict] = None
    created_by: str
    created_at: float
