"""REST API for TRACE Temporal Reasoning (Feature 1) and Predictive Risk (Feature 2).

Exposes:
  GET  /api/temporal/patterns   — temporal sequence analysis on persisted events
  GET  /api/temporal/predict    — predictive risk assessment from temporal patterns
  GET  /api/temporal/summary    — lightweight summary for dashboard widgets

These endpoints use the EXISTING events table and EXISTING risk infrastructure.
No new database tables. No duplicate risk engines.

Epistemic labels are always explicit in responses:
  OBSERVED  → event records from footage analysis (existing events table)
  INFERRED  → temporal patterns (Feature 1 — sequencer.py)
  PREDICTED → risk forecasts (Feature 2 — predictor.py)
"""

from __future__ import annotations

import sqlite3
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query

from backend.contracts.models import (
    PredictiveRiskResponse,
    TemporalSequenceResponse,
)
from backend.db.db import get_db
from backend.risk.predictor import generate_predictions
from backend.temporal.sequencer import TemporalPattern, TemporalSequenceResult, analyse_temporal_sequence

router = APIRouter(prefix="/api/temporal", tags=["temporal_reasoning"])


def _pattern_to_dict(p: TemporalPattern) -> dict:
    return {
        "pattern_type": p.pattern_type,
        "label": p.label,
        "description": p.description,
        "supporting_event_ids": p.supporting_event_ids,
        "time_window_sec": p.time_window_sec,
        "first_timestamp": p.first_timestamp,
        "last_timestamp": p.last_timestamp,
        "scenario": p.scenario,
        "lens": p.lens,
        "event_count": p.event_count,
        "score_trend": p.score_trend,
        "peak_score": p.peak_score,
        "epistemic_level": p.epistemic_level,
        "notice": p.notice,
    }


def _seq_to_response(result: TemporalSequenceResult) -> TemporalSequenceResponse:
    from backend.contracts.models import TemporalPatternModel
    return TemporalSequenceResponse(
        events_analysed=result.events_analysed,
        time_span_sec=result.time_span_sec,
        patterns=[TemporalPatternModel(**_pattern_to_dict(p)) for p in result.patterns],
        insufficient_evidence=result.insufficient_evidence,
        insufficient_evidence_reason=result.insufficient_evidence_reason,
    )


@router.get("/patterns", response_model=TemporalSequenceResponse)
def get_temporal_patterns(
    video_id: Optional[str] = Query(None, description="Filter by video ID"),
    scenario: Optional[str] = Query(None, description="Filter by scenario key"),
    lens: Optional[str] = Query(None, description="Filter by risk lens"),
    window_sec: float = Query(
        120.0, ge=10.0, le=3600.0,
        description="Time window in seconds (10–3600)"
    ),
    anchor_timestamp: Optional[float] = Query(
        None, ge=0.0,
        description="Upper bound of analysis window (defaults to latest event timestamp)"
    ),
    min_events: int = Query(
        2, ge=2, le=50,
        description="Minimum events required before pattern analysis runs"
    ),
    db: sqlite3.Connection = Depends(get_db),
) -> TemporalSequenceResponse:
    """Analyses persisted TRACE events as a temporal sequence.

    Returns INFERRED patterns (escalating risk, repeated behaviour, precursor sequences)
    grounded in OBSERVED event records. Empty patterns list = explicit insufficient
    evidence — never a fabricated result.

    Epistemic chain:
      OBSERVED events (events table) → INFERRED temporal patterns (this endpoint)
    """
    _validate_lens(lens)

    result = analyse_temporal_sequence(
        db,
        video_id=video_id,
        scenario=scenario,
        lens=lens,
        window_sec=window_sec,
        anchor_timestamp=anchor_timestamp,
        min_events=min_events,
    )
    return _seq_to_response(result)


@router.get("/predict", response_model=PredictiveRiskResponse)
def get_predictive_risk(
    video_id: Optional[str] = Query(None, description="Filter by video ID"),
    scenario: Optional[str] = Query(None, description="Filter by scenario key"),
    lens: Optional[str] = Query(None, description="Filter by risk lens"),
    window_sec: float = Query(
        120.0, ge=10.0, le=3600.0,
        description="Time window in seconds (10–3600)"
    ),
    anchor_timestamp: Optional[float] = Query(
        None, ge=0.0,
        description="Upper bound of analysis window"
    ),
    db: sqlite3.Connection = Depends(get_db),
) -> PredictiveRiskResponse:
    """Generates predictive risk assessments from temporal event patterns.

    Full traceable chain:
      OBSERVED events → INFERRED temporal patterns → PREDICTED risks

    Predictions are deterministic given the same event inputs. If no patterns
    exist, returns an explicit insufficient-evidence response — no fabrication.

    IMPORTANT: Predictions are PREDICTED epistemic level — forecasts, not
    confirmed events. Never treat a prediction as confirmed without observed
    evidence.
    """
    _validate_lens(lens)

    return generate_predictions(
        db,
        video_id=video_id,
        scenario=scenario,
        lens=lens,
        window_sec=window_sec,
        anchor_timestamp=anchor_timestamp,
    )


@router.get("/summary")
def get_temporal_summary(
    video_id: Optional[str] = Query(None),
    window_sec: float = Query(120.0, ge=10.0, le=3600.0),
    db: sqlite3.Connection = Depends(get_db),
) -> dict:
    """Lightweight summary for dashboard widgets.

    Returns pattern counts and top-level prediction status without
    full event lists — optimized for sidebar/card display.
    """
    seq = analyse_temporal_sequence(db, video_id=video_id, window_sec=window_sec)
    pred = generate_predictions(db, video_id=video_id, window_sec=window_sec)

    top_prediction = None
    if pred.predictions:
        # Pick the highest-band prediction
        band_order = {"Low": 0, "Medium": 1, "High": 2, "Critical": 3}
        best = max(pred.predictions, key=lambda p: band_order.get(p.predicted_band, 0))
        top_prediction = {
            "predicted_scenario": best.predicted_scenario,
            "predicted_band": best.predicted_band,
            "confidence": best.confidence,
            "horizon_description": best.horizon_description,
            "epistemic_level": "PREDICTED",
        }

    return {
        "events_analysed": seq.events_analysed,
        "time_span_sec": seq.time_span_sec,
        "pattern_count": len(seq.patterns),
        "patterns_by_type": _count_by_type(seq.patterns),
        "prediction_count": len(pred.predictions),
        "top_prediction": top_prediction,
        "insufficient_evidence": seq.insufficient_evidence,
        "epistemic_notice": (
            "Events are OBSERVED. Patterns are INFERRED. Predictions are PREDICTED."
        ),
    }


def _validate_lens(lens: Optional[str]) -> None:
    valid = {"structural", "behaviour", "conformance", "environmental"}
    if lens and lens not in valid:
        raise HTTPException(
            status_code=422,
            detail=f"Invalid lens '{lens}'. Allowed: {sorted(valid)}."
        )


def _count_by_type(patterns) -> dict[str, int]:
    counts: dict[str, int] = {}
    for p in patterns:
        counts[p.pattern_type] = counts.get(p.pattern_type, 0) + 1
    return counts
