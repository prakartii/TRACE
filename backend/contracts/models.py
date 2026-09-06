"""Typed data contracts shared across TRACE's backend layers.

perception -> world model -> lenses -> predictive risk -> planner ->
intervention -> measurement communicate only through these types. No
downstream module should depend on raw YOLO/ByteTrack output shapes or on
frontend-specific structures. These are data contracts only — no scoring,
detection, or reasoning logic lives here.
"""

from __future__ import annotations

from enum import Enum
from typing import Any, Optional

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


class VideoMetadata(BaseModel):
    """Technical media metadata for one decoded video source (Phase 2B —
    video ingestion). Read from the file itself, never from a filename."""

    duration: float = Field(ge=0.0)
    width: int = Field(ge=0)
    height: int = Field(ge=0)
    fps: float = Field(ge=0.0)
    frame_count: Optional[int] = None
    codec: Optional[str] = None
    has_audio: Optional[bool] = None
    # Reserved for a future perception-defined content region of interest
    # (e.g. excluding NVMS UI chrome/burned-in captions on the challenge
    # footage — see docs/VIDEO_AUDIT.md). Not computed or set in Phase 2B.
    content_roi: Optional[BoundingBox] = None


class VideoSourceInfo(BaseModel):
    """Registry entry returned by the video API. Deliberately excludes any
    filesystem path — the frontend and future perception code address a
    video only by its stable `id`."""

    id: str
    filename: str
    file_size: int
    duplicate_of: Optional[str] = None
    metadata: VideoMetadata


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
    tracking_status: str = "TRACKED"


class PerceptionFrameResult(BaseModel):
    """One sampled frame's perception output (Phase 3) — the wire shape
    for GET /api/videos/{id}/entities. A thin envelope around a list of
    `Entity`, analogous to `SceneGraphSnapshot`; it does not compete with
    or replace the `Entity` contract itself."""

    source_id: str
    timestamp: float
    frame_index: Optional[int] = None
    entities: list[Entity] = Field(default_factory=list)
    # Which model produced `entities` (e.g. "stock-coco-yolov8n" or
    # "trace-pilot-v1" — see backend/perception/config.py). Always
    # explicit, never inferred by a client from what classes happen to be
    # present, so a stock-model response can never be mistaken for a
    # pilot-model one (Phase 4 perception-strengthening gate).
    model_identity: str = "stock-coco-yolov8n"
    analysis_fps: float = 3.0
    source_fps: float = 30.0
    sampling_mode: str = "normal"


class ProductMetadata(BaseModel):
    product_id: str
    class_name: str
    mass_class: MassClass
    fragility: Fragility
    required_orientation: Optional[str] = None
    max_stack_height: Optional[int] = None


class SceneGraphNode(BaseModel):
    """One tracked entity's spatial state at a snapshot's timestamp
    (Phase 4 — world model). `position` and `footprint` are normalized
    image-space coordinates in [0, 1] relative to the source frame's
    width/height — NOT the absolute-pixel convention `Entity.bbox` uses,
    and NOT real-world/metric coordinates (no camera calibration exists
    yet). See docs/WORLD_MODEL.md."""

    entity_id: str
    entity_class: EntityClass
    position: tuple[float, float]
    footprint: Optional[BoundingBox] = None
    # None in Phase 4: no pose/orientation signal is produced anywhere
    # upstream (Entity.keypoints is always None — see backend/perception).
    orientation: Optional[float] = None
    # None in Phase 4: no product-metadata linkage exists yet.
    product_id: Optional[str] = None


class SceneGraphEdge(BaseModel):
    source_id: str
    target_id: str
    edge_type: SceneGraphEdgeType
    weight: float = Field(ge=0.0, le=1.0)
    # Auditable basis for the relationship (e.g. {"iou": 0.34} for
    # CONTACT, {"distance": 0.08, "threshold": 0.12} for PROXIMITY,
    # {"vertical_gap": 0.01, "horizontal_overlap_ratio": 0.6} for
    # SUPPORT) — see docs/WORLD_MODEL.md. Never a semantic claim, only
    # the geometric measurement that produced this edge.
    evidence: dict[str, float] = Field(default_factory=dict)


class SceneGraphSnapshot(BaseModel):
    timestamp: float
    nodes: list[SceneGraphNode]
    edges: list[SceneGraphEdge]


class FindingStatus(str, Enum):
    """How much the evidence actually backs a finding — never inflate
    this because a detector was confident about one thing (CLAUDE.md
    honesty rule): a strong PERSON detection with no BOX detection is
    INSUFFICIENT_EVIDENCE for a box-handling finding, not SUPPORTED."""

    SUPPORTED = "supported"
    PROBABLE = "probable"
    INSUFFICIENT_EVIDENCE = "insufficient_evidence"
    UNSUPPORTED = "unsupported"


class RiskEvent(BaseModel):
    """Phase 1 risk-event contract, extended in Phase 5 for evidence-
    aware findings. All Phase 5 fields are additive/defaulted so the
    original shape (event_id..clip_path) stays backward compatible."""

    event_id: Optional[int] = None
    timestamp: float
    event_type: EventType
    lens: RiskLens
    entity_id: str
    score: Optional[float] = None
    band: Optional[RiskBand] = None
    confidence: ConfidenceLevel
    factor_breakdown: dict[str, float] = Field(default_factory=dict)
    clip_path: Optional[str] = None
    # Phase 5 — evidence-aware finding fields.
    status: FindingStatus = FindingStatus.INSUFFICIENT_EVIDENCE
    scenario: Optional[str] = None
    entities: list[str] = Field(default_factory=list)
    evidence: dict[str, Any] = Field(default_factory=dict)
    explanation: str = ""
    recommended_action: Optional[str] = None
    limitations: list[str] = Field(default_factory=list)
    # Phase 7B — Structured ActionRecommendation contract
    planner_recommendation: Optional[ActionRecommendation] = None
    # Phase 9.1 — Event persistence and review extensions
    video_id: Optional[str] = None
    reviewed: bool = False
    review_status: Optional[str] = None


class StabilityBreakdown(BaseModel):
    """Component scores of the TRACE Stability Score (0-100 scale)."""

    support_alignment: float = 0.0
    centering: float = 0.0
    mass_order: float = 0.0
    orientation_alignment: float = 0.0
    overhang_penalty: float = 0.0


class StabilityScore(BaseModel):
    """TRACE Stability Score — an image-space decision-support metric,
    not a certified physical stability measurement."""

    score: float = Field(ge=0.0, le=100.0)
    classification: str
    breakdown: StabilityBreakdown
    support_overlap: float = 0.0
    limitations: list[str] = Field(default_factory=list)


class PlacementCandidate(BaseModel):
    """One scored hypothetical placement. Shared by the Safe Action Planner
    and what-if simulation so both reuse the same stability engine
    (CLAUDE.md §12) instead of two contradictory scoring paths."""

    position: tuple[float, float]
    orientation: Optional[float] = None
    score: float
    band: RiskBand = RiskBand.LOW
    hard_constraints_passed: bool = True
    factor_breakdown: dict[str, float] = Field(default_factory=dict)
    # Phase 7B extensions
    id: Optional[str] = None
    description: Optional[str] = None
    footprint: Optional[BoundingBox] = None
    support_relationship: Optional[str] = None
    score_breakdown: Optional[StabilityBreakdown] = None
    score_delta: Optional[float] = None
    feasibility: bool = True
    limitations: list[str] = Field(default_factory=list)


class ActionRecommendation(BaseModel):
    """Evidence-aware recommended action produced by the Safe Action Planner."""

    scenario_key: Optional[str] = None
    status: FindingStatus
    confidence: ConfidenceLevel
    action: str
    rationale: str
    basis: str
    limitations: list[str] = Field(default_factory=list)
    alternative_actions: list[str] = Field(default_factory=list)
    what_if_eligible: bool = False
    risk_title: Optional[str] = None


class WhatIfCurrentState(BaseModel):
    """Observed placement state before hypothetical intervention."""

    stability_score: float
    classification: str
    support_overlap: float
    breakdown: StabilityBreakdown
    entity_id: str
    footprint: Optional[BoundingBox] = None
    supporting_entity_id: Optional[str] = None
    supporting_footprint: Optional[BoundingBox] = None


class WhatIfSimulation(BaseModel):
    """Transparent comparison between observed state and candidate placements."""

    video_id: str
    timestamp: float
    finding_scenario: str
    finding_status: FindingStatus
    simulation_available: bool
    simulation_notice: str
    current: Optional[WhatIfCurrentState] = None
    alternatives: list[PlacementCandidate] = Field(default_factory=list)
    limitations: list[str] = Field(default_factory=list)


class WhatIfRequest(BaseModel):
    timestamp: float = Field(ge=0.0)
    finding_scenario: Optional[str] = None
    entity_id: Optional[str] = None
    candidate_id: Optional[str] = None
    model: str = "pilot"


class ProductMetadataCreate(BaseModel):
    product_id: str
    class_name: str
    mass_class: MassClass
    fragility: Fragility = Fragility.LOW
    required_orientation: Optional[str] = None
    max_stack_height: Optional[int] = None


class EnvironmentalZoneConfig(BaseModel):
    zone_id: str
    zone_type: str
    polygon: list[tuple[float, float]]
    severity_multiplier: float = 1.0


class ManifestAssignmentRequest(BaseModel):
    source_id: str
    manifest_id: str
    bay_name: str
    product_ids: list[str] = Field(default_factory=list)
    primary_product_id: Optional[str] = None
    zone_ids: list[str] = Field(default_factory=list)


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

