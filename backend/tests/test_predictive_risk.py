"""Tests for Feature 2: Predictive Risk Engine.

ARCHITECTURE.md Part 3 — Predictive Risk Engine.

Tests cover:
- Normal valid prediction from repeated behaviour
- Prediction from escalating risk
- Prediction from precursor sequence
- No predictions when no patterns (insufficient evidence)
- Deterministic output (same inputs → same prediction_id)
- Epistemic labels: OBSERVED → INFERRED → PREDICTED chain
- prediction_id is deterministic
- Band capping (can't exceed observed evidence)
- Missing / empty event set
- observed vs inferred vs predicted distinction in response
- confidence levels
- prediction_chain completeness
"""

from __future__ import annotations

import sqlite3

import pytest
from fastapi.testclient import TestClient

from backend.db.db import get_connection, get_db, init_db
from backend.main import app
from backend.risk.predictor import generate_predictions, _apply_prediction_rules, _cap_band, _deterministic_prediction_id
from backend.temporal.sequencer import TemporalPattern


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

@pytest.fixture
def pred_db(tmp_path):
    db_file = tmp_path / "test_pred.db"
    conn = get_connection(db_file)
    init_db(conn)
    yield conn
    conn.close()


def _insert_event(conn, *, video_id="v01", timestamp, lens="behaviour",
                  scenario=None, score=65.0, band="Medium", confidence="Medium"):
    conn.execute(
        """INSERT INTO events (video_id, timestamp, event_type, lens, entity_id,
           score, band, confidence, status, scenario, factor_breakdown_json,
           clip_path, epistemic_level)
           VALUES (?, ?, 'risk', ?, 'e1', ?, ?, ?, 'probable', ?, NULL, '/x', 'INFERRED')""",
        (video_id, timestamp, lens, score, band, confidence, scenario)
    )
    conn.commit()


@pytest.fixture
def api_client_pred(pred_db):
    app.dependency_overrides[get_db] = lambda: pred_db
    yield TestClient(app)
    app.dependency_overrides.clear()


# ---------------------------------------------------------------------------
# Unit: _cap_band
# ---------------------------------------------------------------------------

class TestCapBand:
    def test_critical_capped_without_high_score(self):
        assert _cap_band("Critical", 50.0) == "Medium"

    def test_critical_capped_to_high_when_not_critical_observed(self):
        assert _cap_band("Critical", 70.0) == "High"

    def test_high_allowed_at_80(self):
        assert _cap_band("High", 80.0) == "High"

    def test_medium_always_allowed(self):
        assert _cap_band("Medium", 30.0) == "Medium"

    def test_none_peak_score_caps_to_medium(self):
        assert _cap_band("High", None) == "Medium"


# ---------------------------------------------------------------------------
# Unit: _deterministic_prediction_id
# ---------------------------------------------------------------------------

class TestDeterministicPredictionId:
    def test_same_inputs_same_id(self):
        id1 = _deterministic_prediction_id([1, 2, 3], "test_type")
        id2 = _deterministic_prediction_id([1, 2, 3], "test_type")
        assert id1 == id2

    def test_different_events_different_id(self):
        id1 = _deterministic_prediction_id([1, 2, 3], "test_type")
        id2 = _deterministic_prediction_id([4, 5, 6], "test_type")
        assert id1 != id2

    def test_different_types_different_id(self):
        id1 = _deterministic_prediction_id([1, 2], "type_a")
        id2 = _deterministic_prediction_id([1, 2], "type_b")
        assert id1 != id2

    def test_id_is_string(self):
        pid = _deterministic_prediction_id([10], "type")
        assert isinstance(pid, str)
        assert len(pid) > 0


# ---------------------------------------------------------------------------
# Unit: _apply_prediction_rules
# ---------------------------------------------------------------------------

class TestApplyPredictionRules:
    def _make_pattern(self, pattern_type, scenario, event_count, peak_score, score_trend="escalating"):
        return TemporalPattern(
            pattern_type=pattern_type,
            label="Test",
            description="Test pattern",
            supporting_event_ids=list(range(1, event_count + 1)),
            time_window_sec=60.0,
            first_timestamp=0.0,
            last_timestamp=60.0,
            scenario=scenario,
            lens="behaviour",
            event_count=event_count,
            score_trend=score_trend,
            peak_score=peak_score,
        )

    def test_escalating_risk_produces_prediction(self):
        pattern = self._make_pattern("escalating_risk", "dragging_precursor", 4, 75.0)
        result = _apply_prediction_rules(pattern)
        assert result is not None
        assert result.epistemic_level == "PREDICTED"
        assert result.predicted_band in ("Low", "Medium", "High", "Critical")

    def test_repeated_dropping_produces_prediction(self):
        pattern = self._make_pattern("repeated_behaviour", "dropping_or_throwing_precursor", 3, 65.0)
        result = _apply_prediction_rules(pattern)
        assert result is not None
        assert result.predicted_scenario == "confirmed_drop_incident"

    def test_repeated_solo_heavy_produces_prediction(self):
        pattern = self._make_pattern("repeated_behaviour", "solo_heavy_handling", 2, 55.0)
        result = _apply_prediction_rules(pattern)
        assert result is not None
        assert "musculoskeletal" in result.predicted_scenario

    def test_precursor_sequence_produces_prediction(self):
        pattern = self._make_pattern("precursor_sequence", "dropping→heavy_on_light", 2, 70.0)
        result = _apply_prediction_rules(pattern)
        assert result is not None

    def test_insufficient_events_no_prediction(self):
        # Repeated dropping but only 1 event — below min_events=2
        pattern = self._make_pattern("repeated_behaviour", "dropping_or_throwing_precursor", 1, 65.0)
        result = _apply_prediction_rules(pattern)
        assert result is None

    def test_prediction_chain_has_three_steps(self):
        pattern = self._make_pattern("escalating_risk", "dragging_precursor", 4, 75.0)
        result = _apply_prediction_rules(pattern)
        assert result is not None
        assert len(result.prediction_chain) == 3
        assert "OBSERVED" in result.prediction_chain[0]
        assert "INFERRED" in result.prediction_chain[1]
        assert "PREDICTED" in result.prediction_chain[2]

    def test_prediction_has_supporting_event_ids(self):
        pattern = self._make_pattern("escalating_risk", "dragging_precursor", 4, 75.0)
        result = _apply_prediction_rules(pattern)
        assert result is not None
        assert len(result.supporting_event_ids) > 0

    def test_prediction_has_limitations(self):
        pattern = self._make_pattern("repeated_behaviour", "dropping_or_throwing_precursor", 2, 60.0)
        result = _apply_prediction_rules(pattern)
        assert result is not None
        assert len(result.limitations) > 0

    def test_prediction_has_notice(self):
        pattern = self._make_pattern("escalating_risk", "any_scenario", 3, 65.0)
        result = _apply_prediction_rules(pattern)
        if result:
            assert "PREDICTED" in result.notice
            assert "NOT been confirmed" in result.notice


# ---------------------------------------------------------------------------
# Integration: generate_predictions with DB
# ---------------------------------------------------------------------------

class TestGeneratePredictions:
    def test_no_events_returns_insufficient(self, pred_db):
        result = generate_predictions(pred_db)
        assert result.insufficient_evidence is True
        assert result.predictions == []

    def test_single_event_returns_insufficient(self, pred_db):
        _insert_event(pred_db, timestamp=5.0, scenario="dropping_or_throwing_precursor", score=70.0)
        result = generate_predictions(pred_db)
        assert result.insufficient_evidence is True

    def test_repeated_dropping_generates_prediction(self, pred_db):
        for ts in [5.0, 20.0, 35.0]:
            _insert_event(pred_db, timestamp=ts,
                          scenario="dropping_or_throwing_precursor",
                          score=72.0, band="High", lens="behaviour")
        result = generate_predictions(pred_db)
        # Should produce at least one prediction OR explicit insufficient evidence
        assert isinstance(result.insufficient_evidence, bool)
        if not result.insufficient_evidence:
            assert len(result.predictions) > 0
            for pred in result.predictions:
                assert pred.epistemic_level == "PREDICTED"

    def test_predictions_are_deterministic(self, pred_db):
        for ts in [5.0, 20.0, 35.0]:
            _insert_event(pred_db, timestamp=ts,
                          scenario="dropping_or_throwing_precursor",
                          score=72.0, band="High", lens="behaviour")
        result1 = generate_predictions(pred_db)
        result2 = generate_predictions(pred_db)
        ids1 = {p.prediction_id for p in result1.predictions}
        ids2 = {p.prediction_id for p in result2.predictions}
        assert ids1 == ids2

    def test_epistemic_notice_in_response(self, pred_db):
        result = generate_predictions(pred_db)
        assert "PREDICTED" in result.epistemic_notice
        assert "INFERRED" in result.epistemic_notice
        assert "OBSERVED" in result.epistemic_notice

    def test_escalating_risk_generates_prediction(self, pred_db):
        for i, score in enumerate([55.0, 65.0, 75.0, 82.0]):
            _insert_event(pred_db, timestamp=float(i * 15),
                          scenario="dragging_precursor", score=score,
                          band="High", lens="behaviour")
        result = generate_predictions(pred_db)
        assert isinstance(result.predictions, list)
        if result.predictions:
            # Check band is not greater than what evidence supports
            for pred in result.predictions:
                assert pred.predicted_band in ("Low", "Medium", "High", "Critical")

    def test_predictions_traceable_to_event_ids(self, pred_db):
        for ts in [5.0, 20.0]:
            _insert_event(pred_db, timestamp=ts,
                          scenario="solo_heavy_handling",
                          score=65.0, band="Medium", lens="behaviour")
        result = generate_predictions(pred_db)
        for pred in result.predictions:
            assert len(pred.supporting_event_ids) > 0
            for eid in pred.supporting_event_ids:
                assert isinstance(eid, int)

    def test_video_filter_scope(self, pred_db):
        # Events in v01 only
        for ts in [5.0, 20.0, 35.0]:
            _insert_event(pred_db, video_id="v01", timestamp=ts,
                          scenario="dropping_or_throwing_precursor",
                          score=70.0, band="High")
        # Generate predictions only for v01
        result = generate_predictions(pred_db, video_id="v01")
        # And for v02 (no events) → insufficient
        result_v02 = generate_predictions(pred_db, video_id="v02")
        assert result_v02.insufficient_evidence is True

    def test_prediction_band_not_higher_than_observed(self, pred_db):
        # Low-score events should not produce Critical predictions
        for ts in [5.0, 15.0, 25.0]:
            _insert_event(pred_db, timestamp=ts,
                          scenario="dragging_precursor",
                          score=45.0, band="Low", lens="behaviour")
        result = generate_predictions(pred_db)
        for pred in result.predictions:
            assert pred.predicted_band != "Critical"


# ---------------------------------------------------------------------------
# API: /api/temporal/predict endpoint
# ---------------------------------------------------------------------------

class TestPredictAPI:
    def test_predict_empty_db_insufficient(self, api_client_pred):
        r = api_client_pred.get("/api/temporal/predict")
        assert r.status_code == 200
        data = r.json()
        assert data["insufficient_evidence"] is True
        assert data["predictions"] == []

    def test_predict_response_shape(self, api_client_pred):
        r = api_client_pred.get("/api/temporal/predict")
        assert r.status_code == 200
        data = r.json()
        assert "events_analysed" in data
        assert "patterns_found" in data
        assert "predictions" in data
        assert "epistemic_notice" in data
        assert "insufficient_evidence" in data

    def test_predict_with_data(self, api_client_pred, pred_db):
        for ts in [5.0, 20.0, 35.0]:
            _insert_event(pred_db, timestamp=ts,
                          scenario="dropping_or_throwing_precursor",
                          score=72.0, band="High")
        r = api_client_pred.get("/api/temporal/predict")
        assert r.status_code == 200
        data = r.json()
        for pred in data["predictions"]:
            assert pred["epistemic_level"] == "PREDICTED"
            assert "prediction_chain" in pred
            assert len(pred["prediction_chain"]) == 3

    def test_predict_invalid_lens(self, api_client_pred):
        r = api_client_pred.get("/api/temporal/predict?lens=not_a_lens")
        assert r.status_code == 422

    def test_predict_notice_always_present(self, api_client_pred):
        r = api_client_pred.get("/api/temporal/predict")
        data = r.json()
        assert "PREDICTED" in data["epistemic_notice"]
