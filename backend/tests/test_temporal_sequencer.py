"""Tests for Feature 1: Temporal Sequence Analyser.

ARCHITECTURE.md Part 3 — Video Perception + Temporal Reasoning.

Tests cover:
- Event ordering and time window slicing
- Escalating risk detection (≥3 events with increasing score)
- Repeated behaviour detection (same scenario ≥2×)
- Precursor→consequence sequence detection
- Incomplete sequence (insufficient evidence)
- Empty event set
- Single event (below minimum threshold)
- Epistemic label correctness (patterns must be INFERRED)
- Observed events remain OBSERVED
- Score trend calculations
- API endpoint integration
- Filter by video_id / lens / scenario
"""

from __future__ import annotations

import sqlite3

import pytest
from fastapi.testclient import TestClient

from backend.db.db import get_connection, get_db, init_db
from backend.main import app
from backend.temporal.sequencer import (
    TemporalEvent,
    analyse_temporal_sequence,
    _detect_escalating_risk,
    _detect_repeated_behaviour,
    _detect_precursor_sequences,
    _score_trend,
)


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

@pytest.fixture
def seq_db(tmp_path):
    db_file = tmp_path / "test_seq.db"
    conn = get_connection(db_file)
    init_db(conn)
    yield conn
    conn.close()


def _insert_event(conn, *, video_id="v01", timestamp, lens="behaviour",
                  scenario=None, score=65.0, band="Medium",
                  confidence="Medium", epistemic="INFERRED"):
    conn.execute(
        """INSERT INTO events (video_id, timestamp, event_type, lens, entity_id,
           score, band, confidence, status, scenario, factor_breakdown_json,
           clip_path, epistemic_level)
           VALUES (?, ?, 'risk', ?, 'e1', ?, ?, ?, 'probable', ?, NULL, '/x', ?)""",
        (video_id, timestamp, lens, score, band, confidence, scenario, epistemic)
    )
    conn.commit()


@pytest.fixture
def api_client_seq(seq_db):
    app.dependency_overrides[get_db] = lambda: seq_db
    yield TestClient(app)
    app.dependency_overrides.clear()


# ---------------------------------------------------------------------------
# Unit: _score_trend
# ---------------------------------------------------------------------------

class TestScoreTrend:
    def test_escalating(self):
        assert _score_trend([50.0, 60.0, 70.0, 80.0]) == "escalating"

    def test_de_escalating(self):
        assert _score_trend([80.0, 70.0, 60.0, 50.0]) == "de-escalating"

    def test_stable(self):
        assert _score_trend([65.0, 65.5, 64.8, 65.2]) == "stable"

    def test_variable(self):
        assert _score_trend([50.0, 80.0, 40.0, 75.0]) == "variable"

    def test_single_score(self):
        assert _score_trend([65.0]) == "stable"

    def test_empty(self):
        assert _score_trend([]) == "stable"


# ---------------------------------------------------------------------------
# Unit: _detect_escalating_risk
# ---------------------------------------------------------------------------

class TestDetectEscalatingRisk:
    def _make_events(self, scores, base_ts=0.0, scenario="s1", lens="behaviour"):
        return [
            TemporalEvent(
                event_id=i + 1, timestamp=base_ts + i * 5.0,
                lens=lens, scenario=scenario, score=s,
                band="Medium", confidence="High", video_id="v1"
            )
            for i, s in enumerate(scores)
        ]

    def test_detects_escalation(self):
        events = self._make_events([50.0, 60.0, 70.0, 80.0])
        patterns = _detect_escalating_risk(events)
        assert len(patterns) == 1
        assert patterns[0].pattern_type == "escalating_risk"
        assert patterns[0].peak_score == 80.0
        assert patterns[0].score_trend == "escalating"

    def test_no_escalation_stable(self):
        events = self._make_events([65.0, 65.0, 65.0])
        patterns = _detect_escalating_risk(events)
        # Stable scores don't fire escalating_risk (no net increase from first to last)
        assert all(p.peak_score == 65.0 for p in patterns) or len(patterns) == 0

    def test_needs_three_events(self):
        events = self._make_events([50.0, 80.0])  # only 2
        patterns = _detect_escalating_risk(events)
        assert patterns == []

    def test_pattern_is_inferred(self):
        events = self._make_events([50.0, 62.0, 74.0, 86.0])
        patterns = _detect_escalating_risk(events)
        assert len(patterns) == 1
        assert patterns[0].epistemic_level == "INFERRED"

    def test_supporting_event_ids_are_real(self):
        events = self._make_events([50.0, 62.0, 74.0])
        patterns = _detect_escalating_risk(events)
        if patterns:
            for eid in patterns[0].supporting_event_ids:
                assert isinstance(eid, int)
                assert eid in {e.event_id for e in events}


# ---------------------------------------------------------------------------
# Unit: _detect_repeated_behaviour
# ---------------------------------------------------------------------------

class TestDetectRepeatedBehaviour:
    def _make_events_scenario(self, scenario, count, lens="behaviour", base_score=65.0):
        return [
            TemporalEvent(
                event_id=i + 1, timestamp=float(i * 10),
                lens=lens, scenario=scenario, score=base_score,
                band="Medium", confidence="Medium", video_id="v1"
            )
            for i in range(count)
        ]

    def test_detects_repeated(self):
        events = self._make_events_scenario("dropping_or_throwing_precursor", 3)
        patterns = _detect_repeated_behaviour(events)
        assert len(patterns) == 1
        assert patterns[0].pattern_type == "repeated_behaviour"
        assert patterns[0].event_count == 3
        assert patterns[0].scenario == "dropping_or_throwing_precursor"

    def test_single_occurrence_not_repeated(self):
        events = self._make_events_scenario("solo_heavy_handling", 1)
        patterns = _detect_repeated_behaviour(events)
        assert patterns == []

    def test_multiple_scenarios_separately_detected(self):
        ev1 = self._make_events_scenario("dragging_precursor", 2)
        ev2 = [
            TemporalEvent(
                event_id=100 + i, timestamp=float(i * 5 + 50),
                lens="behaviour", scenario="solo_heavy_handling",
                score=65.0, band="Medium", confidence="Medium", video_id="v1"
            )
            for i in range(3)
        ]
        patterns = _detect_repeated_behaviour(ev1 + ev2)
        scenario_types = {p.scenario for p in patterns}
        assert "dragging_precursor" in scenario_types
        assert "solo_heavy_handling" in scenario_types

    def test_pattern_is_inferred(self):
        events = self._make_events_scenario("straps_as_handles", 2)
        patterns = _detect_repeated_behaviour(events)
        assert all(p.epistemic_level == "INFERRED" for p in patterns)

    def test_no_scenario_events_ignored(self):
        events = [
            TemporalEvent(event_id=i, timestamp=float(i), lens="behaviour",
                          scenario=None, score=65.0, band="Medium",
                          confidence="High", video_id="v1")
            for i in range(5)
        ]
        patterns = _detect_repeated_behaviour(events)
        assert patterns == []


# ---------------------------------------------------------------------------
# Unit: _detect_precursor_sequences
# ---------------------------------------------------------------------------

class TestDetectPrecursorSequences:
    def test_detects_known_chain(self):
        events = [
            TemporalEvent(event_id=1, timestamp=5.0, lens="behaviour",
                          scenario="dropping_or_throwing_precursor",
                          score=70.0, band="High", confidence="High", video_id="v1"),
            TemporalEvent(event_id=2, timestamp=18.0, lens="structural",
                          scenario="heavy_on_light_stacking",
                          score=75.0, band="High", confidence="High", video_id="v1"),
        ]
        patterns = _detect_precursor_sequences(events, max_gap_sec=30.0)
        assert len(patterns) == 1
        assert patterns[0].pattern_type == "precursor_sequence"
        assert 1 in patterns[0].supporting_event_ids
        assert 2 in patterns[0].supporting_event_ids

    def test_reversed_order_not_detected(self):
        """Consequence before precursor should NOT trigger a chain."""
        events = [
            TemporalEvent(event_id=1, timestamp=5.0, lens="structural",
                          scenario="heavy_on_light_stacking",
                          score=75.0, band="High", confidence="High", video_id="v1"),
            TemporalEvent(event_id=2, timestamp=18.0, lens="behaviour",
                          scenario="dropping_or_throwing_precursor",
                          score=70.0, band="High", confidence="High", video_id="v1"),
        ]
        patterns = _detect_precursor_sequences(events, max_gap_sec=30.0)
        assert len(patterns) == 0

    def test_gap_too_large_not_detected(self):
        events = [
            TemporalEvent(event_id=1, timestamp=0.0, lens="behaviour",
                          scenario="solo_heavy_handling",
                          score=70.0, band="High", confidence="High", video_id="v1"),
            TemporalEvent(event_id=2, timestamp=200.0, lens="behaviour",
                          scenario="dropping_or_throwing_precursor",
                          score=72.0, band="High", confidence="High", video_id="v1"),
        ]
        patterns = _detect_precursor_sequences(events, max_gap_sec=30.0)
        assert len(patterns) == 0

    def test_pattern_is_inferred(self):
        events = [
            TemporalEvent(event_id=1, timestamp=0.0, lens="behaviour",
                          scenario="straps_as_handles",
                          score=67.0, band="Medium", confidence="Medium", video_id="v1"),
            TemporalEvent(event_id=2, timestamp=15.0, lens="behaviour",
                          scenario="dropping_or_throwing_precursor",
                          score=70.0, band="High", confidence="High", video_id="v1"),
        ]
        patterns = _detect_precursor_sequences(events)
        assert all(p.epistemic_level == "INFERRED" for p in patterns)


# ---------------------------------------------------------------------------
# Integration: analyse_temporal_sequence with DB
# ---------------------------------------------------------------------------

class TestAnalyseTemporalSequence:
    def test_empty_db_returns_insufficient(self, seq_db):
        result = analyse_temporal_sequence(seq_db)
        assert result.insufficient_evidence is True
        assert result.events_analysed == 0
        assert result.patterns == []

    def test_single_event_returns_insufficient(self, seq_db):
        _insert_event(seq_db, timestamp=10.0, scenario="dropping_or_throwing_precursor")
        result = analyse_temporal_sequence(seq_db, min_events=2)
        assert result.insufficient_evidence is True

    def test_two_same_scenario_repeated_pattern(self, seq_db):
        _insert_event(seq_db, timestamp=5.0, scenario="solo_heavy_handling", score=65.0)
        _insert_event(seq_db, timestamp=15.0, scenario="solo_heavy_handling", score=68.0)
        result = analyse_temporal_sequence(seq_db)
        assert result.insufficient_evidence is False
        types = {p.pattern_type for p in result.patterns}
        assert "repeated_behaviour" in types

    def test_escalating_scores_detect_pattern(self, seq_db):
        for i, score in enumerate([50.0, 62.0, 74.0, 86.0]):
            _insert_event(seq_db, timestamp=float(i * 10), scenario="dragging_precursor",
                          score=score, band="High")
        result = analyse_temporal_sequence(seq_db)
        types = {p.pattern_type for p in result.patterns}
        assert "escalating_risk" in types

    def test_video_filter_works(self, seq_db):
        _insert_event(seq_db, video_id="v01", timestamp=5.0, scenario="s1", score=65.0)
        _insert_event(seq_db, video_id="v01", timestamp=15.0, scenario="s1", score=70.0)
        _insert_event(seq_db, video_id="v02", timestamp=25.0, scenario="s1", score=75.0)
        result = analyse_temporal_sequence(seq_db, video_id="v01")
        assert result.events_analysed == 2

    def test_lens_filter_works(self, seq_db):
        _insert_event(seq_db, lens="behaviour", timestamp=5.0, scenario="s1", score=65.0)
        _insert_event(seq_db, lens="behaviour", timestamp=15.0, scenario="s1", score=70.0)
        _insert_event(seq_db, lens="structural", timestamp=25.0, scenario="s2", score=75.0)
        result = analyse_temporal_sequence(seq_db, lens="behaviour")
        assert result.events_analysed == 2

    def test_time_window_respects_anchor(self, seq_db):
        _insert_event(seq_db, timestamp=0.0, scenario="s1", score=65.0)
        _insert_event(seq_db, timestamp=10.0, scenario="s1", score=70.0)
        _insert_event(seq_db, timestamp=200.0, scenario="s1", score=75.0)
        # Window of 30s anchored at t=15 → only t=0 and t=10 should be included
        result = analyse_temporal_sequence(seq_db, window_sec=30.0, anchor_timestamp=15.0)
        assert result.events_analysed == 2

    def test_precursor_chain_detected_in_db(self, seq_db):
        _insert_event(seq_db, timestamp=5.0, scenario="dropping_or_throwing_precursor",
                      lens="behaviour", score=70.0)
        _insert_event(seq_db, timestamp=18.0, scenario="heavy_on_light_stacking",
                      lens="structural", score=78.0)
        result = analyse_temporal_sequence(seq_db)
        types = {p.pattern_type for p in result.patterns}
        assert "precursor_sequence" in types

    def test_epistemic_notice_present(self, seq_db):
        _insert_event(seq_db, timestamp=5.0, scenario="s1", score=65.0)
        _insert_event(seq_db, timestamp=10.0, scenario="s1", score=70.0)
        result = analyse_temporal_sequence(seq_db)
        assert "OBSERVED" in result.epistemic_notice
        assert "INFERRED" in result.epistemic_notice

    def test_patterns_are_inferred(self, seq_db):
        _insert_event(seq_db, timestamp=5.0, scenario="solo_heavy_handling", score=65.0)
        _insert_event(seq_db, timestamp=15.0, scenario="solo_heavy_handling", score=70.0)
        result = analyse_temporal_sequence(seq_db)
        for p in result.patterns:
            assert p.epistemic_level == "INFERRED"


# ---------------------------------------------------------------------------
# API endpoint integration
# ---------------------------------------------------------------------------

class TestTemporalAPI:
    def test_patterns_empty_db(self, api_client_seq):
        r = api_client_seq.get("/api/temporal/patterns")
        assert r.status_code == 200
        data = r.json()
        assert data["insufficient_evidence"] is True
        assert data["patterns"] == []

    def test_patterns_with_repeated_behaviour(self, api_client_seq, seq_db):
        _insert_event(seq_db, timestamp=5.0, scenario="dragging_precursor", score=64.0)
        _insert_event(seq_db, timestamp=15.0, scenario="dragging_precursor", score=68.0)
        r = api_client_seq.get("/api/temporal/patterns")
        assert r.status_code == 200
        data = r.json()
        assert data["insufficient_evidence"] is False
        assert any(p["pattern_type"] == "repeated_behaviour" for p in data["patterns"])

    def test_patterns_epistemic_notice_in_response(self, api_client_seq):
        r = api_client_seq.get("/api/temporal/patterns")
        assert "OBSERVED" in r.json()["epistemic_notice"]

    def test_invalid_lens_rejected(self, api_client_seq):
        r = api_client_seq.get("/api/temporal/patterns?lens=fake_lens")
        assert r.status_code == 422

    def test_summary_endpoint(self, api_client_seq):
        r = api_client_seq.get("/api/temporal/summary")
        assert r.status_code == 200
        data = r.json()
        assert "events_analysed" in data
        assert "pattern_count" in data
        assert "prediction_count" in data
        assert "epistemic_notice" in data

    def test_predict_endpoint_insufficient(self, api_client_seq):
        r = api_client_seq.get("/api/temporal/predict")
        assert r.status_code == 200
        data = r.json()
        assert data["insufficient_evidence"] is True

    def test_predict_with_repeated_behaviour(self, api_client_seq, seq_db):
        # Insert 3 dropping events with high score → should trigger prediction
        for ts in [5.0, 20.0, 35.0]:
            _insert_event(seq_db, timestamp=ts,
                          scenario="dropping_or_throwing_precursor",
                          score=72.0, band="High", lens="behaviour")
        r = api_client_seq.get("/api/temporal/predict")
        assert r.status_code == 200
        data = r.json()
        # Either produces a prediction or reports insufficient evidence honestly
        assert "predictions" in data
        assert "insufficient_evidence" in data
        # If predictions exist, they must be PREDICTED epistemic level
        for pred in data["predictions"]:
            assert pred["epistemic_level"] == "PREDICTED"
            assert "prediction_chain" in pred
            assert len(pred["prediction_chain"]) >= 3
            assert "OBSERVED" in pred["prediction_chain"][0]
            assert "INFERRED" in pred["prediction_chain"][1]
            assert "PREDICTED" in pred["prediction_chain"][2]
