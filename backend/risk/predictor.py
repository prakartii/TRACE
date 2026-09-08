"""Predictive Risk Engine — Feature 2: Predictive Risk.

Extends the existing TRACE risk infrastructure with forward-looking predictions
grounded in temporal sequence analysis (Feature 1).

EPISTEMIC CHAIN (always explicit):
  OBSERVED events (from footage)
    ↓
  INFERRED temporal pattern (from sequencer.py)
    ↓
  PREDICTED risk (this module)

SAFETY RULES (never violated):
1. A prediction is NOT a confirmed event.
2. If no temporal pattern exists, return explicit insufficient_evidence.
3. No ML model, no probabilistic inference — deterministic rule-based logic.
4. Confidence derives from: event count, score level, pattern type strength.
5. Every prediction is traceable back to specific event IDs.
6. Predicted bands are capped by actual observed evidence — cannot claim
   Critical if no observed event reached Critical.

INTEGRATION:
- Reads from: backend/temporal/sequencer.py (TemporalPattern)
- Uses existing: risk/config.py thresholds, contracts/models.py enums
- Writes nothing to DB — predictions are ephemeral analysis results
"""

from __future__ import annotations

import hashlib
import sqlite3
from typing import Optional

from backend.contracts.models import (
    PredictiveRiskResponse,
    PredictiveRiskResult,
    TemporalPatternModel,
)
from backend.temporal.sequencer import (
    TemporalPattern,
    TemporalSequenceResult,
    analyse_temporal_sequence,
)


# ---------------------------------------------------------------------------
# Known prediction rules — each maps a temporal pattern to a predicted risk.
# These are operational judgements grounded in warehouse safety literature
# and the TRACE scenario catalog. NOT statistical models.
# ---------------------------------------------------------------------------

# (pattern_type, scenario_contains, predicted_scenario, predicted_band, confidence, horizon, explanation, limitations)
_PREDICTION_RULES: list[dict] = [
    {
        "pattern_type": "escalating_risk",
        "scenario_contains": None,  # any scenario
        "min_events": 3,
        "min_peak_score": 60.0,
        "predicted_scenario": "unresolved_escalation",
        "predicted_band_fn": lambda peak: (
            "Critical" if (peak or 0) >= 80
            else "High" if (peak or 0) >= 65
            else "Medium"
        ),
        "confidence_fn": lambda events: "High" if events >= 5 else "Medium" if events >= 3 else "Low",
        "horizon_description": "If the current handling pattern is not interrupted",
        "explanation_fn": lambda p: (
            f"Risk score escalated across {p.event_count} events to {p.peak_score:.0f}. "
            f"Unresolved escalation patterns in warehouse environments indicate that the "
            f"underlying unsafe condition persists and is likely to result in a handling incident "
            f"unless the operation is paused and corrected."
        ),
        "limitations": [
            "Prediction is based on score trend in existing event records, not live footage.",
            "TRACE cannot verify whether a corrective action was taken between events.",
            "Predicted outcome is a decision-support signal, not a confirmed future event.",
        ],
    },
    {
        "pattern_type": "repeated_behaviour",
        "scenario_contains": "dropping_or_throwing",
        "min_events": 2,
        "min_peak_score": 50.0,
        "predicted_scenario": "confirmed_drop_incident",
        "predicted_band_fn": lambda peak: "High",
        "confidence_fn": lambda events: "High" if events >= 3 else "Medium",
        "horizon_description": "Within the current shift if handling practice is not corrected",
        "explanation_fn": lambda p: (
            f"Throw/drop precursor detected {p.event_count}× in {p.time_window_sec:.0f}s. "
            f"Repeated detection of the same unsafe motion pattern indicates the behaviour "
            f"is a consistent practice rather than an isolated event, substantially elevating "
            f"the likelihood of an actual package drop or impact incident."
        ),
        "limitations": [
            "2D image-space kinematics only — no calibrated impact force sensor.",
            "Cannot confirm whether any of these events resulted in actual package damage.",
            "Prediction applies to current handling pattern; any corrective action invalidates it.",
        ],
    },
    {
        "pattern_type": "repeated_behaviour",
        "scenario_contains": "solo_heavy_handling",
        "min_events": 2,
        "min_peak_score": 50.0,
        "predicted_scenario": "musculoskeletal_injury_risk",
        "predicted_band_fn": lambda peak: "High",
        "confidence_fn": lambda events: "Medium",
        "horizon_description": "Cumulative risk within the current shift",
        "explanation_fn": lambda p: (
            f"Solo heavy-item handling detected {p.event_count}× in {p.time_window_sec:.0f}s. "
            f"Repeated solo handling of heavy loads (>25 kg equivalent) without mechanical "
            f"assist creates cumulative musculoskeletal strain — the predicted risk increases "
            f"with each additional handling cycle."
        ),
        "limitations": [
            "Mass class inferred from product catalog, not measured.",
            "Cumulative strain cannot be directly observed from video.",
            "Worker fatigue level is unknown.",
        ],
    },
    {
        "pattern_type": "repeated_behaviour",
        "scenario_contains": "dragging",
        "min_events": 2,
        "min_peak_score": 40.0,
        "predicted_scenario": "surface_damage_or_packaging_failure",
        "predicted_band_fn": lambda peak: "Medium",
        "confidence_fn": lambda events: "Medium",
        "horizon_description": "Cumulative packaging integrity risk",
        "explanation_fn": lambda p: (
            f"Dragging behaviour detected {p.event_count}× in {p.time_window_sec:.0f}s. "
            f"Repeated floor-dragging degrades packaging integrity — corner crumpling and "
            f"bottom perforations accumulate, increasing the probability of contents damage "
            f"during subsequent handling."
        ),
        "limitations": [
            "Packaging material and integrity cannot be observed directly from video.",
            "Floor surface friction is unknown.",
        ],
    },
    {
        "pattern_type": "precursor_sequence",
        "scenario_contains": "→",  # any precursor→consequence chain
        "min_events": 2,
        "min_peak_score": 0.0,
        "predicted_scenario": "precursor_consequence_materialisation",
        "predicted_band_fn": lambda peak: "High",
        "confidence_fn": lambda events: "Medium",
        "horizon_description": "Immediately following the precursor event",
        "explanation_fn": lambda p: (
            f"TRACE detected a known precursor→consequence chain: {p.scenario}. "
            f"The observed sequence matches a catalogued pattern where the precursor "
            f"behaviour significantly elevates the probability of the consequence scenario "
            f"occurring within the same handling operation."
        ),
        "limitations": [
            "Causal link is based on scenario catalog, not confirmed in this specific footage.",
            "The consequence may not materialise if handling stops or is corrected.",
            "2D video cannot confirm physical contact forces.",
        ],
    },
]


# ---------------------------------------------------------------------------
# Confidence / band helpers
# ---------------------------------------------------------------------------

_BAND_ORDINAL = {"Low": 0, "Medium": 1, "High": 2, "Critical": 3}
_ORDINAL_BAND = {v: k for k, v in _BAND_ORDINAL.items()}


def _cap_band(predicted: str, observed_peak_score: Optional[float]) -> str:
    """Never predict a band higher than what observed evidence supports.

    If no observed event reached above 60, cap at Medium.
    If no observed event reached above 80, cap at High.
    """
    if observed_peak_score is None:
        return "Medium"
    if observed_peak_score < 60:
        return min(predicted, "Medium", key=lambda b: _BAND_ORDINAL.get(b, 0))
    if observed_peak_score < 80:
        if predicted == "Critical":
            return "High"
    return predicted


def _deterministic_prediction_id(event_ids: list[int], prediction_type: str) -> str:
    """Stable, deterministic ID for a prediction — same inputs always → same ID."""
    key = f"{prediction_type}:{sorted(event_ids)}"
    return hashlib.sha1(key.encode()).hexdigest()[:12]


def _pattern_to_model(p: TemporalPattern) -> TemporalPatternModel:
    return TemporalPatternModel(
        pattern_type=p.pattern_type,
        label=p.label,
        description=p.description,
        supporting_event_ids=p.supporting_event_ids,
        time_window_sec=p.time_window_sec,
        first_timestamp=p.first_timestamp,
        last_timestamp=p.last_timestamp,
        scenario=p.scenario,
        lens=p.lens,
        event_count=p.event_count,
        score_trend=p.score_trend,
        peak_score=p.peak_score,
    )


# ---------------------------------------------------------------------------
# Main prediction logic
# ---------------------------------------------------------------------------

def _apply_prediction_rules(pattern: TemporalPattern) -> Optional[PredictiveRiskResult]:
    """Applies the first matching prediction rule to a pattern.

    Returns None if no rule matches or evidence is insufficient.
    Deterministic — same pattern always → same prediction.
    """
    for rule in _PREDICTION_RULES:
        # Pattern type must match
        if rule["pattern_type"] != pattern.pattern_type:
            continue

        # Scenario substring filter (None = match any)
        sc_filter = rule.get("scenario_contains")
        if sc_filter and not (pattern.scenario and sc_filter in pattern.scenario):
            continue

        # Minimum event count
        if pattern.event_count < rule["min_events"]:
            continue

        # Minimum peak score
        min_peak = rule.get("min_peak_score", 0.0)
        if min_peak > 0 and (pattern.peak_score is None or pattern.peak_score < min_peak):
            continue

        # Build prediction
        raw_band = rule["predicted_band_fn"](pattern.peak_score)
        capped_band = _cap_band(raw_band, pattern.peak_score)
        confidence = rule["confidence_fn"](pattern.event_count)
        explanation = rule["explanation_fn"](pattern)
        predicted_scenario = rule["predicted_scenario"]

        pred_id = _deterministic_prediction_id(pattern.supporting_event_ids, predicted_scenario)

        chain = [
            f"OBSERVED: {pattern.event_count} event(s) from footage analysis "
            f"(IDs: {', '.join(str(i) for i in pattern.supporting_event_ids[:5])}{'…' if len(pattern.supporting_event_ids) > 5 else ''})",
            f"INFERRED: Temporal pattern '{pattern.pattern_type}' — {pattern.label} "
            f"(score trend: {pattern.score_trend}, peak: {pattern.peak_score})",
            f"PREDICTED: '{predicted_scenario}' at {capped_band} band "
            f"({rule['horizon_description']})",
        ]

        return PredictiveRiskResult(
            prediction_id=pred_id,
            predicted_scenario=predicted_scenario,
            predicted_band=capped_band,
            confidence=confidence,
            horizon_description=rule["horizon_description"],
            explanation=explanation,
            supporting_pattern=_pattern_to_model(pattern),
            supporting_event_ids=pattern.supporting_event_ids,
            prediction_chain=chain,
            limitations=rule["limitations"],
        )

    return None


def generate_predictions(
    conn: sqlite3.Connection,
    *,
    video_id: Optional[str] = None,
    scenario: Optional[str] = None,
    lens: Optional[str] = None,
    window_sec: float = 120.0,
    anchor_timestamp: Optional[float] = None,
) -> PredictiveRiskResponse:
    """Generates predictive risk assessments from persisted TRACE events.

    Steps:
    1. Call temporal sequencer to find patterns (INFERRED)
    2. Apply prediction rules to each pattern (PREDICTED)
    3. Return traceable prediction chain with epistemic labels

    Returns an explicit insufficient-evidence response if there are no
    patterns to base predictions on — never fabricates predictions.
    """
    # Step 1: Get temporal patterns
    seq_result: TemporalSequenceResult = analyse_temporal_sequence(
        conn,
        video_id=video_id,
        scenario=scenario,
        lens=lens,
        window_sec=window_sec,
        anchor_timestamp=anchor_timestamp,
    )

    if seq_result.insufficient_evidence or not seq_result.patterns:
        reason = seq_result.insufficient_evidence_reason or (
            "No temporal patterns detected in the available event data."
        )
        return PredictiveRiskResponse(
            events_analysed=seq_result.events_analysed,
            patterns_found=0,
            predictions=[],
            insufficient_evidence=True,
            insufficient_evidence_reason=reason,
        )

    # Step 2: Apply prediction rules
    predictions: list[PredictiveRiskResult] = []
    seen_ids: set[str] = set()

    for pattern in seq_result.patterns:
        pred = _apply_prediction_rules(pattern)
        if pred and pred.prediction_id not in seen_ids:
            seen_ids.add(pred.prediction_id)
            predictions.append(pred)

    if not predictions:
        return PredictiveRiskResponse(
            events_analysed=seq_result.events_analysed,
            patterns_found=len(seq_result.patterns),
            predictions=[],
            insufficient_evidence=True,
            insufficient_evidence_reason=(
                f"Found {len(seq_result.patterns)} temporal pattern(s) but none matched "
                f"prediction rules with sufficient evidence."
            ),
        )

    return PredictiveRiskResponse(
        events_analysed=seq_result.events_analysed,
        patterns_found=len(seq_result.patterns),
        predictions=predictions,
        insufficient_evidence=False,
    )
