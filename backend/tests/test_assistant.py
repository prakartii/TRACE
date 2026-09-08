"""Grounded AI supervisor assistant (ARCHITECTURE.md Screen 7 / CLAUDE.md §21).

The retrieval layer is the source of truth: it must answer every canonical
question deterministically, with no API key, and carry its grounding. The LLM
layer is optional narration over the same rows and is not exercised here (no
key in CI).
"""

from __future__ import annotations

import sqlite3

import pytest
from starlette.testclient import TestClient

from backend.assistant import queries as q
from backend.assistant.engine import answer
from backend.assistant.router import route
from backend.db.db import get_connection, init_db
from backend.main import app


@pytest.fixture
def empty_db():
    conn = get_connection(":memory:")
    init_db(conn)
    yield conn
    conn.close()


@pytest.fixture
def seeded_db():
    """A small, explicit fixture — not the canonical seed — so assertions are
    stable regardless of what trace.db currently holds."""
    conn = get_connection(":memory:")
    init_db(conn)
    conn.executescript(
        """
        INSERT INTO events (event_id, video_id, timestamp, event_type, lens, entity_id, score, band, confidence, status, scenario, factor_breakdown_json)
        VALUES
          (1, 'vidA', 3.0, 'risk', 'structural', 'vidA:box', 76, 'High', 'High', 'supported', 'box_overhang',
           '{"explanation":"46% base overhang beyond the pallet deck.","evidence":{"overhang_ratio":0.46,"support_ratio":0.54}}'),
          (2, 'vidA', 5.0, 'risk', 'structural', 'vidA:box2', 70, 'High', 'Medium', 'supported', 'box_overhang', '{}'),
          (3, 'vidB', 8.0, 'behaviour', 'behaviour', 'vidB:worker', 60, 'Medium', 'Medium', 'probable', 'dragging_precursor', '{}'),
          (4, 'vidB', 9.0, 'behaviour', 'behaviour', 'vidB:worker', 62, 'Medium', 'Medium', 'probable', 'dragging_precursor', '{}'),
          (5, 'vidC', 1.0, 'risk', 'environmental', 'vidC:zone', 55, 'Low', 'Low', 'supported', 'entity_in_wet_floor_zone', '{}');

        INSERT INTO outcome_measurements
          (outcome_id, event_id, video_id, initial_timestamp, response_window_sec, classification,
           condition_1_satisfied, condition_2_satisfied, condition_3_satisfied, three_condition_json, evaluated_at)
        VALUES
          (1, 1, 'vidA', 3.0, 5.0, 'prevented', 1, 1, 1, '{}', 0),
          (2, 2, 'vidA', 5.0, 5.0, 'near_miss', 1, 1, 0, '{}', 0),
          (3, 3, 'vidB', 8.0, 5.0, 'near_miss', 1, 1, 0, '{}', 0),
          (4, 4, 'vidB', 9.0, 5.0, 'near_miss', 1, 1, 0, '{}', 0);

        INSERT INTO interventions
          (alert_id, event_id, video_id, timestamp, scenario, severity, urgency, state, title,
           immediate_action, secondary_actions_json, steps_json, verification, reason, supporting_event_ids_json,
           dedup_key, created_at, updated_at)
        VALUES
          ('a1', 1, 'vidA', 3.0, 'box_overhang', 'HIGH', 'URGENT', 'NEW', 'Overhang',
           'Shift carton 15cm onto the pallet deck', '[]', '["Shift carton onto deck","Check tier alignment"]',
           'Confirm full base support', 'Cantilever past deck edge', '[1]', 'd1', 0, 0);
        """
    )
    conn.commit()
    yield conn
    conn.close()


# --------------------------------------------------------------------------- #
# router
# --------------------------------------------------------------------------- #

@pytest.mark.parametrize(
    "question, expected",
    [
        ("What were the most common risks?", "top_scenarios"),
        ("How many events were prevented?", "prevention_breakdown"),
        ("Which bay had the most near misses?", "near_misses_by_source"),
        ("Why was event #73 risky?", "explain_event"),
        ("What did TRACE recommend for event #12?", "recommendation_for"),
        ("Which behaviour occurred most frequently?", "top_behaviours"),
        ("Show me the high-risk events", "high_risk_events"),
        ("Any false positives?", "false_positives"),
        ("hello there", "overview"),
    ],
)
def test_router_maps_canonical_questions(question, expected):
    assert route(question).intent == expected


# --------------------------------------------------------------------------- #
# queries — grounded, deterministic, honest on empty
# --------------------------------------------------------------------------- #

def test_top_scenarios(seeded_db):
    r = q.top_scenarios(seeded_db)
    assert r.data["scenarios"][0]["scenario"] == "box_overhang"
    assert r.data["scenarios"][0]["n"] == 2
    assert "box_overhang (2)" in r.summary


def test_prevention_breakdown_keeps_buckets_separate(seeded_db):
    r = q.prevention_breakdown(seeded_db)
    assert r.data["counts"] == {"near_miss": 3, "prevented": 1}
    assert "1 prevented" in r.summary and "3 near miss" in r.summary
    # never fused into one number
    assert "4 prevented" not in r.summary


def test_near_misses_by_source_picks_the_top_source(seeded_db):
    r = q.near_misses_by_source(seeded_db)
    assert r.data["by_source"][0]["video_id"] == "vidB"
    assert r.data["by_source"][0]["n"] == 2


def test_explain_event_uses_recorded_evidence(seeded_db):
    r = q.explain_event(seeded_db, event_id=1)
    assert r.event_ids == [1]
    assert "box_overhang" in r.summary
    assert "overhang_ratio=0.46" in r.summary
    assert "46% base overhang" in r.summary


def test_explain_event_falls_back_without_fabricating(seeded_db):
    r = q.explain_event(seeded_db, event_id=99999)  # does not exist
    assert r.row_count == 1
    assert r.event_ids[0] in (1, 2, 3, 4, 5)  # a real row, highest band first


def test_recommendation_for_reads_the_intervention(seeded_db):
    r = q.recommendation_for(seeded_db, event_id=1)
    assert "Shift carton 15cm onto the pallet deck" in r.summary
    assert r.data["steps"]


def test_queries_are_honest_on_empty_db(empty_db):
    for fn in (q.top_scenarios, q.top_behaviours, q.prevention_breakdown,
               q.near_misses_by_source, q.high_risk_events, q.false_positives):
        r = fn(empty_db)
        assert r.row_count == 0
        assert r.summary  # a real "nothing recorded" sentence, not a crash


# --------------------------------------------------------------------------- #
# engine
# --------------------------------------------------------------------------- #

def test_engine_answer_is_grounded_and_llm_free_by_default(seeded_db):
    res = answer(seeded_db, "How many events were prevented?")
    assert res["used_llm"] is False
    assert res["intent"] == "prevention_breakdown"
    assert res["answer"] == res["deterministic_answer"]
    assert res["grounded_row_count"] == 4
    assert res["grounding"][0]["query"] == "prevention_breakdown"


def test_engine_blank_question(seeded_db):
    res = answer(seeded_db, "   ")
    assert res["intent"] == "empty"
    assert res["suggestions"]


# --------------------------------------------------------------------------- #
# endpoint
# --------------------------------------------------------------------------- #

def test_ask_endpoint_answers_and_carries_grounding():
    client = TestClient(app)
    r = client.post("/api/assistant/ask", json={"question": "What were the most common risks?"})
    assert r.status_code == 200
    body = r.json()
    assert body["intent"] == "top_scenarios"
    assert body["answer"]
    assert isinstance(body["grounding"], list)
    assert body["used_llm"] is False  # no ANTHROPIC_API_KEY in CI


def test_suggestions_endpoint():
    client = TestClient(app)
    r = client.get("/api/assistant/suggestions")
    assert r.status_code == 200
    assert r.json()["suggestions"]
