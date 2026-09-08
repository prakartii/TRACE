"""Learning / Pattern Memory (Layer 9 — ARCHITECTURE.md §6, CLAUDE.md §20/§22).

Deterministic aggregation only: recurring configs, the source x scenario heat
map, behaviour frequency, hotspots, training prompts, and team/process-level
scorecards. No individual worker data anywhere.
"""

from __future__ import annotations

import pytest
from starlette.testclient import TestClient

from backend.db.db import get_connection, get_db, init_db
from backend.learning import patterns as p
from backend.main import app


@pytest.fixture
def db():
    conn = get_connection(":memory:")
    init_db(conn)
    conn.executescript(
        """
        INSERT INTO events (event_id, video_id, timestamp, event_type, lens, entity_id, score, band, confidence, status, scenario)
        VALUES
          (1, 'bayA', 1, 'risk', 'structural', 'bayA:b1', 45, 'High', 'High', 'supported', 'box_overhang'),
          (2, 'bayA', 2, 'risk', 'structural', 'bayA:b2', 50, 'High', 'High', 'supported', 'box_overhang'),
          (3, 'bayB', 3, 'risk', 'structural', 'bayB:b3', 55, 'Medium', 'Medium', 'supported', 'box_overhang'),
          (4, 'bayB', 4, 'behaviour', 'behaviour', 'bayB:w1', 60, 'Medium', 'Medium', 'probable', 'dragging_precursor'),
          (5, 'bayB', 5, 'behaviour', 'behaviour', 'bayB:w1', 61, 'Medium', 'Medium', 'probable', 'dragging_precursor'),
          (6, 'bayC', 6, 'risk', 'environmental', 'bayC:z1', 40, 'Low', 'Low', 'supported', 'entity_in_wet_floor_zone'),
          -- Below the evidence bar: a coverage probe and an unverifiable guess.
          -- These are logged (honest audit trail) but must never drive an insight.
          (7, 'bayA', 7, 'risk', 'conformance', 'bayA:p', 10, 'Low', 'Low', 'unsupported', 'product_rule_coverage'),
          (8, 'bayA', 8, 'risk', 'conformance', 'bayA:p', 10, 'Low', 'Low', 'unsupported', 'product_rule_coverage'),
          (9, 'bayB', 9, 'behaviour', 'behaviour', 'bayB:w9', 20, 'High', 'Low', 'insufficient_evidence', 'dragging_precursor'),
          (10, 'bayC', 10, 'risk', 'environmental', 'bayC:z2', 15, 'High', 'Low', 'insufficient_evidence', 'entity_in_wet_floor_zone');

        INSERT INTO outcome_measurements
          (outcome_id, event_id, video_id, initial_timestamp, classification,
           condition_1_satisfied, condition_2_satisfied, condition_3_satisfied, three_condition_json, evaluated_at)
        VALUES
          (1, 1, 'bayA', 1, 'prevented', 1, 1, 1, '{}', 0),
          (2, 3, 'bayB', 3, 'near_miss', 1, 1, 0, '{}', 0);
        """
    )
    conn.commit()
    yield conn
    conn.close()


@pytest.fixture
def empty_db():
    conn = get_connection(":memory:")
    init_db(conn)
    yield conn
    conn.close()


# --------------------------------------------------------------------------- #

def test_recurring_scenarios(db):
    r = p.recurring_scenarios(db, min_count=2)
    assert len(r) == 2
    overhang = next(x for x in r if x["scenario"] == "box_overhang")
    assert overhang["count"] == 3
    assert overhang["high_count"] == 2
    assert overhang["source_count"] == 2
    assert overhang["event_ids"] == [1, 2, 3]


def test_recurring_scenarios_respects_min_count(db):
    # entity_in_wet_floor_zone appears once -> excluded at min_count=2
    r = p.recurring_scenarios(db, min_count=2)
    assert all(x["scenario"] != "entity_in_wet_floor_zone" for x in r)


def test_heatmap_matrix(db):
    hm = p.source_scenario_heatmap(db)
    assert set(hm["scenarios"]) == {"box_overhang", "dragging_precursor", "entity_in_wet_floor_zone"}
    assert hm["scenario_totals"]["box_overhang"] == 3
    assert hm["max_cell_count"] == 2  # bayA has 2 box_overhang
    cell = next(c for c in hm["cells"] if c["video_id"] == "bayA" and c["scenario"] == "box_overhang")
    assert cell["count"] == 2 and cell["high_count"] == 2
    assert "Not a spatial pixel map" in hm["basis"]


def test_behaviour_frequency(db):
    bf = p.behaviour_frequency(db)
    assert bf == [{"scenario": "dragging_precursor", "count": 2}]


def test_zone_and_near_miss_hotspots(db):
    zones = p.zone_hotspots(db)
    assert zones[0]["scenario"] == "entity_in_wet_floor_zone"
    nm = p.near_miss_hotspots(db)
    assert nm[0]["scenario"] == "box_overhang" and nm[0]["count"] == 1


def test_training_recommendations_are_deterministic_and_non_punitive(db):
    recs = p.training_recommendations(db, min_count=2)
    overhang = next(r for r in recs if r["scenario"] == "box_overhang")
    assert overhang["priority"] == "high"  # 2 High/Critical
    assert "Coaching focus" in overhang["suggestion"]
    assert "worker failed" not in overhang["suggestion"].lower()


def test_process_scorecards_are_per_source_not_per_worker(db):
    cards = p.process_scorecards(db)
    a = next(c for c in cards if c["video_id"] == "bayA")
    assert a["events"] == 2 and a["high_events"] == 2 and a["prevented"] == 1
    b = next(c for c in cards if c["video_id"] == "bayB")
    assert b["near_miss"] == 1
    # keys are source/process oriented — no entity_id / worker fields
    assert "entity_id" not in a and "worker" not in a


def test_aggregations_are_honest_on_empty_db(empty_db):
    assert p.recurring_scenarios(empty_db) == []
    assert p.behaviour_frequency(empty_db) == []
    assert p.training_recommendations(empty_db) == []
    hm = p.source_scenario_heatmap(empty_db)
    assert hm["sources"] == [] and hm["cells"] == [] and hm["max_cell_count"] == 0
    assert p.process_scorecards(empty_db) == []


# --------------------------------------------------------------------------- #
# endpoints
# --------------------------------------------------------------------------- #

@pytest.fixture
def client(db):
    app.dependency_overrides[get_db] = lambda: db
    with TestClient(app) as c:
        yield c
    app.dependency_overrides.clear()


def test_patterns_endpoint(client):
    d = client.get("/api/learning/patterns").json()
    assert {r["scenario"] for r in d["recurring_scenarios"]} == {"box_overhang", "dragging_precursor"}
    assert d["training_recommendations"]


def test_heatmap_endpoint(client):
    d = client.get("/api/learning/heatmap").json()
    assert "box_overhang" in d["scenarios"]
    assert d["max_cell_count"] == 2


def test_scorecards_endpoint(client):
    d = client.get("/api/learning/scorecards").json()
    assert len(d["scorecards"]) == 3
    assert "never per individual worker" in d["note"]


# --------------------------------------------------------------------------- #
# Evidence bar — aggregates must never be built from unsupported /
# insufficient-evidence observations (CLAUDE.md §20/§30).
# --------------------------------------------------------------------------- #

def test_recurring_scenarios_excludes_below_evidence_bar(db):
    """A coverage probe logged twice as `unsupported` is not a recurring
    configuration and must not earn a coaching note."""
    scen = {r["scenario"] for r in p.recurring_scenarios(db, min_count=2)}
    assert "product_rule_coverage" not in scen
    assert "box_overhang" in scen

    recs = {r["scenario"] for r in p.training_recommendations(db, min_count=2)}
    assert "product_rule_coverage" not in recs


def test_recurring_counts_ignore_insufficient_evidence_rows(db):
    """dragging_precursor has 2 probable + 1 insufficient_evidence rows."""
    r = next(x for x in p.recurring_scenarios(db, min_count=2) if x["scenario"] == "dragging_precursor")
    assert r["count"] == 2
    assert 9 not in r["event_ids"]


def test_behaviour_frequency_respects_the_evidence_bar(db):
    assert p.behaviour_frequency(db) == [{"scenario": "dragging_precursor", "count": 2}]


def test_zone_hotspots_respect_the_evidence_bar(db):
    zones = p.zone_hotspots(db)
    assert sum(z["count"] for z in zones) == 1  # the supported one only


def test_heatmap_excludes_below_evidence_bar(db):
    hm = p.source_scenario_heatmap(db)
    assert "product_rule_coverage" not in hm["scenarios"]
    assert hm["scenario_totals"]["dragging_precursor"] == 2
    assert "evidence-backed" in hm["basis"]


def test_scorecards_count_only_evidence_backed_findings(db):
    cards = {c["video_id"]: c for c in p.process_scorecards(db)}
    # bayA: 2 supported box_overhang (+2 unsupported probes that must not count)
    assert cards["bayA"]["events"] == 2
    assert cards["bayA"]["top_scenario"] == "box_overhang"
    # bayC: 1 supported wet-floor (+1 insufficient_evidence that must not count)
    assert cards["bayC"]["events"] == 1
