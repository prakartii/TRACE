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
    allowed_equipment: Optional[list[str]] = None
    loading_sequence: Optional[int] = None


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


class EpistemicLevel(str, Enum):
    """4-tier epistemic inspection taxonomy (ARCHITECTURE.md & CLAUDE.md §14).
    Distinguishes direct visual facts from mechanical deductions, counterfactuals,
    and post-intervention confirmations."""

    OBSERVED = "OBSERVED"
    INFERRED = "INFERRED"
    PREDICTED = "PREDICTED"
    VERIFIED = "VERIFIED"


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
    # 4-tier epistemic inspection taxonomy (OBSERVED, INFERRED, PREDICTED, VERIFIED)
    epistemic_level: EpistemicLevel = EpistemicLevel.INFERRED


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


class SafeActionPlan(BaseModel):
    """Structured, operational action plan produced by the Safe Action Planner (Feature 3)."""

    event_id: int
    video_id: Optional[str] = None
    timestamp: float = 0.0
    risk_band: str = "Medium"
    title: str
    immediate_action: str
    secondary_actions: list[str] = Field(default_factory=list)
    steps: list[str] = Field(default_factory=list)
    verification: str
    reason: str
    evidence_status: str = "Seen in video"
    evidence_summary: Optional[str] = None
    what_if_eligible: bool = False
    source: str = "TRACE Operational Safety Catalog (deterministic rule)"
    limitations: list[str] = Field(default_factory=list)


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


class TrajectoryPoint(BaseModel):
    """Single temporal evaluation point in a What-If stability trajectory."""

    timestamp: float
    stability_score: float  # 0-100 scale
    risk_score: float  # 0-100 scale
    band: RiskBand
    is_alert: bool = False
    is_placement_moment: bool = False
    active_scenarios: list[str] = Field(default_factory=list)
    breakdown: Optional[StabilityBreakdown] = None


class WhatIfTrajectoryRequest(BaseModel):
    """Request payload for multi-frame temporal what-if counterfactual simulation (Phase 11)."""

    event_id: Optional[int] = None
    video_id: Optional[str] = None
    timestamp: Optional[float] = None
    scenario: Optional[str] = None
    entity_id: Optional[str] = None
    alternative_candidate: Optional[str] = None
    model: str = "pilot"
    window_before: float = Field(default=3.0, ge=0.0)
    window_after: float = Field(default=4.0, ge=0.0)


class WhatIfTrajectoryResult(BaseModel):
    """Complete temporal comparison between original and counterfactual stability curves (Screen 9)."""

    event_id: Optional[int] = None
    video_id: str
    intervention_timestamp: float
    candidate_id: str
    candidate_label: str
    instruction: str
    simulation_available: bool = True
    simulation_notice: Optional[str] = None
    original_trajectory: list[TrajectoryPoint] = Field(default_factory=list)
    simulated_trajectory: list[TrajectoryPoint] = Field(default_factory=list)
    stability_gain_at_placement: float = 0.0
    overall_stability_delta: float = 0.0
    original_peak_risk: float = 0.0
    simulated_peak_risk: float = 0.0
    risk_transition: str = ""
    explanation: str = ""
    available_candidates: list[PlacementCandidate] = Field(default_factory=list)
    limitations: list[str] = Field(default_factory=list)


class ProductMetadataCreate(BaseModel):
    product_id: str
    class_name: str
    mass_class: MassClass
    fragility: Fragility = Fragility.LOW
    required_orientation: Optional[str] = None
    max_stack_height: Optional[int] = None
    allowed_equipment: Optional[list[str]] = None
    loading_sequence: Optional[int] = None


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


class ConditionCheckResult(BaseModel):
    """Result of an individual condition in the 3-condition prevention check."""

    condition_number: int
    name: str
    satisfied: bool
    description: str
    evidence: dict[str, Any] = Field(default_factory=dict)
    limitations: list[str] = Field(default_factory=list)


class ThreeConditionCheck(BaseModel):
    """The 3-condition prevention check specified in ARCHITECTURE.md §5.7."""

    condition_1_risk_predicted: ConditionCheckResult
    condition_2_action_observed: ConditionCheckResult
    condition_3_state_improved: ConditionCheckResult
    all_satisfied: bool


class OutcomeMeasurement(BaseModel):
    """Complete auditable outcome record linking an event to its post-action verification."""

    outcome_id: Optional[int] = None
    event_id: int
    video_id: Optional[str] = None
    initial_timestamp: float
    outcome_timestamp: Optional[float] = None
    response_window_sec: float = 5.0
    classification: PreventionClassification
    three_condition_check: ThreeConditionCheck
    initial_score: Optional[float] = None
    outcome_score: Optional[float] = None
    initial_band: Optional[RiskBand] = None
    outcome_band: Optional[RiskBand] = None
    followed_recommendation: Optional[bool] = None
    human_review_status: Optional[str] = None
    explanation: str
    evidence: dict[str, Any] = Field(default_factory=dict)
    limitations: list[str] = Field(default_factory=list)
    evaluated_at: float


class PreventionSummary(BaseModel):
    """Three separate counters and breakdowns as specified in ARCHITECTURE.md §5.7 / Screen 6."""

    total_evaluated: int
    prevented_count: int
    near_miss_count: int
    outcome_unclear_count: int
    confirmed_damage_count: int
    by_lens: dict[str, dict[str, int]] = Field(default_factory=dict)
    by_band: dict[str, dict[str, int]] = Field(default_factory=dict)


# ---------------------------------------------------------------------------
# Phase 12 — Behaviour Recognition Contracts (ARCHITECTURE.md Part 3 & 9, CLAUDE.md §14)
# ---------------------------------------------------------------------------

class BehaviourScenarioInfo(BaseModel):
    """Catalog metadata for a supported behaviour scenario (Phase 12)."""

    scenario_id: str
    name: str
    lens: RiskLens = RiskLens.BEHAVIOUR
    required_signals: list[str] = Field(default_factory=list)
    description: str
    epistemic_status: FindingStatus
    confidence: ConfidenceLevel
    risk_band: RiskBand
    limitations: list[str] = Field(default_factory=list)
    recommended_action: str


class KinematicProfile(BaseModel):
    """Calculated kinematic and temporal properties for a tracked entity."""

    entity_id: str
    sample_count: int
    duration: float
    total_displacement: float
    net_displacement: float
    trajectory_linearity: float
    average_speed: Optional[float] = None
    net_speed: Optional[float] = None
    peak_speed: Optional[float] = None
    peak_downward_speed: Optional[float] = None
    peak_acceleration: Optional[float] = None
    aspect_ratio_min: Optional[float] = None
    aspect_ratio_max: Optional[float] = None
    aspect_ratio_range: Optional[float] = None
    aspect_oscillation_count: int = 0
    ground_tier: bool = False


class BehaviourEvaluationRequest(BaseModel):
    """Request to evaluate behaviour over perception frames."""

    video_id: Optional[str] = None
    timestamp: Optional[float] = None
    window_samples: Optional[int] = None
    default_product_id: Optional[str] = None


class BehaviourEvaluationResponse(BaseModel):
    """Response containing recognized behaviour events and kinematics."""

    timestamp: float
    video_id: Optional[str] = None
    findings: list[RiskEvent] = Field(default_factory=list)
    kinematics: dict[str, KinematicProfile] = Field(default_factory=dict)
    active_scenarios: list[str] = Field(default_factory=list)
    epistemic_notice: str = ""


# ---------------------------------------------------------------------------
# Feature 1 — Temporal Reasoning Contracts
# (ARCHITECTURE.md Part 3 — Video Perception + Temporal Reasoning)
# ---------------------------------------------------------------------------

class TemporalPatternModel(BaseModel):
    """A detected temporal pattern over ≥2 observed events.

    Epistemic level is always INFERRED — derived from observed event records
    by deterministic sequence logic, never from new sensor data.
    """
    pattern_type: str = Field(
        ...,
        description="'escalating_risk' | 'repeated_behaviour' | 'precursor_sequence'"
    )
    label: str
    description: str
    supporting_event_ids: list[int] = Field(
        ..., description="IDs of real DB events supporting this pattern"
    )
    time_window_sec: float
    first_timestamp: float
    last_timestamp: float
    scenario: Optional[str] = None
    lens: Optional[str] = None
    event_count: int
    score_trend: str = Field(
        ...,
        description="'escalating' | 'de-escalating' | 'stable' | 'variable'"
    )
    peak_score: Optional[float] = None
    epistemic_level: str = "INFERRED"
    notice: str = (
        "Pattern is INFERRED: derived deterministically from observed event records. "
        "No new sensor observation."
    )


class TemporalSequenceResponse(BaseModel):
    """API response for temporal sequence analysis.

    OBSERVED events → INFERRED patterns.
    Empty patterns list = explicit insufficient-evidence (not an error).
    """
    events_analysed: int
    time_span_sec: float
    patterns: list[TemporalPatternModel] = Field(default_factory=list)
    insufficient_evidence: bool
    insufficient_evidence_reason: Optional[str] = None
    epistemic_notice: str = (
        "Underlying events are OBSERVED (from footage analysis). "
        "Patterns are INFERRED (deterministic sequence logic). "
        "If evidence is insufficient, patterns list is empty."
    )


# ---------------------------------------------------------------------------
# Feature 2 — Predictive Risk Contracts
# (ARCHITECTURE.md Part 3 — Predictive Risk Engine)
# ---------------------------------------------------------------------------

class PredictiveRiskResult(BaseModel):
    """A single predicted risk derived from a temporal pattern.

    Epistemic level is PREDICTED — a forecast about what may happen,
    derived from an INFERRED pattern, grounded in OBSERVED events.
    The prediction chain is fully traceable:
      OBSERVED events → INFERRED temporal pattern → PREDICTED risk.

    IMPORTANT: A prediction is NOT a confirmed event. Never claim the
    predicted outcome actually occurred unless supported by observed evidence.
    """
    prediction_id: str = Field(
        ..., description="Deterministic ID: hash of supporting event IDs + prediction type"
    )
    predicted_scenario: str = Field(
        ..., description="The scenario TRACE predicts may occur"
    )
    predicted_band: str = Field(
        ..., description="Predicted risk band: Low/Medium/High/Critical"
    )
    confidence: str = Field(
        ..., description="Confidence level: Low/Medium/High"
    )
    horizon_description: str = Field(
        ..., description="Time horizon description, e.g. 'within the next handling cycle'"
    )
    explanation: str = Field(
        ..., description="Why TRACE predicts this risk — must be traceable"
    )
    supporting_pattern: TemporalPatternModel
    supporting_event_ids: list[int]
    epistemic_level: str = "PREDICTED"
    prediction_chain: list[str] = Field(
        ...,
        description="Step-by-step chain: OBSERVED → INFERRED → PREDICTED"
    )
    limitations: list[str] = Field(
        default_factory=list,
        description="What the prediction cannot guarantee"
    )
    notice: str = (
        "This is a PREDICTED risk — a forecast derived from an inferred temporal pattern "
        "grounded in observed events. The predicted outcome has NOT been confirmed. "
        "Treat as a decision-support signal, not a confirmed hazard."
    )


class PredictiveRiskResponse(BaseModel):
    """API response for predictive risk analysis.

    Contains the full traceable chain:
    OBSERVED events → INFERRED temporal patterns → PREDICTED risks.
    """
    events_analysed: int
    patterns_found: int
    predictions: list[PredictiveRiskResult] = Field(default_factory=list)
    insufficient_evidence: bool
    insufficient_evidence_reason: Optional[str] = None
    epistemic_notice: str = (
        "Predictions are PREDICTED epistemic level — forecasts derived from INFERRED "
        "temporal patterns that are grounded in OBSERVED events. "
        "Predictions are deterministic given the same event inputs. "
        "No statistical model, no ML inference — pure rule-based sequence logic."
    )
