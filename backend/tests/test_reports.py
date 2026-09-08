"""Incident report export (GEG bonus).

CSV of logged events + a structured / printable shift summary. Every figure is a
straight read of the event store; prevention counters stay in four buckets.
"""

from __future__ import annotations

import csv
import io

import pytest
from starlette.testclient import TestClient

from backend.api.reports import _CSV_COLUMNS
from backend.db.db import get_connection, get_db, init_db
from backend.main import app


@pytest.fixture
def db():
    conn = get_connection(":memory:")
    init_db(conn)
    conn.executescript(
        r"""
        INSERT INTO events (event_id, video_id, timestamp, event_type, lens, entity_id, score, band, confidence, status, scenario, factor_breakdown_json, review_status)
        VALUES
          (1, 'bayA', 3.0, 'risk', 'structural', 'bayA:b', 45, 'High', 'High', 'supported', 'box_overhang', '{"explanation": "Carton\nover the deck edge."}', NULL),
          (2, 'bayA', 5.0, 'risk', 'structural', 'bayA:b2', 50, 'High', 'Medium', 'supported', 'box_overhang', '{}', NULL),
          (3, 'bayB', 8.0, 'behaviour', 'behaviour', 'bayB:w', 60, 'Medium', 'Medium', 'probable', 'dragging_precursor', '{}', 'false_positive');

        INSERT INTO outcome_measurements
          (outcome_id, event_id, video_id, initial_timestamp, classification,
           condition_1_satisfied, condition_2_satisfied, condition_3_satisfied, three_condition_json, evaluated_at)
        VALUES (1, 1, 'bayA', 3.0, 'prevented', 1, 1, 1, '{}', 0);
        """
    )
    conn.commit()
    yield conn
    conn.close()


@pytest.fixture
def client(db):
    app.dependency_overrides[get_db] = lambda: db
    with TestClient(app) as c:
        yield c
    app.dependency_overrides.clear()


@pytest.fixture
def empty_client():
    conn = get_connection(":memory:")
    init_db(conn)
    app.dependency_overrides[get_db] = lambda: conn
    with TestClient(app) as c:
        yield c
    app.dependency_overrides.clear()
    conn.close()


# --------------------------------------------------------------------------- #
# CSV
# --------------------------------------------------------------------------- #

def test_incidents_csv_is_a_download_with_the_expected_columns(client):
    r = client.get("/api/reports/incidents.csv")
    assert r.status_code == 200
    assert r.headers["content-type"].startswith("text/csv")
    assert r.headers["content-disposition"].startswith("attachment; filename=")

    rows = list(csv.DictReader(io.StringIO(r.text)))
    assert list(rows[0].keys()) == _CSV_COLUMNS
    assert len(rows) == 3
    by_id = {int(row["event_id"]): row for row in rows}
    assert by_id[1]["scenario"] == "box_overhang"
    assert by_id[1]["outcome_classification"] == "prevented"
    assert by_id[3]["review_status"] == "false_positive"
    # newlines in explanation are flattened so the CSV row stays intact
    assert "\n" not in by_id[1]["explanation"] and "over the deck edge" in by_id[1]["explanation"]


def test_incidents_csv_respects_filters(client):
    r = client.get("/api/reports/incidents.csv", params={"band": "High"})
    rows = list(csv.DictReader(io.StringIO(r.text)))
    assert {row["event_id"] for row in rows} == {"1", "2"}

    r2 = client.get("/api/reports/incidents.csv", params={"lens": "behaviour"})
    rows2 = list(csv.DictReader(io.StringIO(r2.text)))
    assert [row["event_id"] for row in rows2] == ["3"]


def test_incidents_csv_empty_db_is_header_only(empty_client):
    r = empty_client.get("/api/reports/incidents.csv")
    assert r.status_code == 200
    lines = [ln for ln in r.text.splitlines() if ln]
    assert len(lines) == 1  # just the header


# --------------------------------------------------------------------------- #
# shift summary
# --------------------------------------------------------------------------- #

def test_shift_summary_json(client):
    s = client.get("/api/reports/shift-summary").json()
    assert s["totals"]["evidence_backed_findings"] == 3
    assert s["totals"]["logged_observations"] == 3
    assert s["totals"]["by_band"] == {"High": 2, "Medium": 1}
    # four separate buckets, never summed
    assert s["prevention"]["prevented"] == 1
    assert s["prevention"]["near_miss"] == 0
    assert "never summed" in s["prevention"]["note"]
    assert any(r["scenario"] == "box_overhang" for r in s["recurring_scenarios"])
    assert s["training_recommendations"]
    assert {c["video_id"] for c in s["process_scorecards"]} == {"bayA", "bayB"}


def test_shift_summary_markdown_is_a_printable_download(client):
    r = client.get("/api/reports/shift-summary.md")
    assert r.status_code == 200
    assert r.headers["content-type"].startswith("text/markdown")
    assert r.headers["content-disposition"].startswith("attachment; filename=")
    body = r.text
    assert body.startswith("# TRACE — Shift Safety Summary")
    assert "## Prevention (buckets kept separate)" in body
    assert "| source | events |" in body
    assert "not certified structural engineering calculations" in body


def test_shift_summary_empty_db(empty_client):
    s = empty_client.get("/api/reports/shift-summary").json()
    assert s["totals"]["evidence_backed_findings"] == 0
    assert s["totals"]["logged_observations"] == 0
    assert s["recurring_scenarios"] == []
    assert s["process_scorecards"] == []


def test_shift_summary_separates_backed_findings_from_logged_observations(client, db):
    """An unsupported coverage probe is logged and exported in the CSV, but must
    not inflate the shift report's headline finding count."""
    db.execute(
        "INSERT INTO events (event_id, video_id, timestamp, event_type, lens, entity_id, band, confidence, status, scenario, factor_breakdown_json)"
        " VALUES (9, 'bayA', 1.0, 'risk', 'conformance', 'bayA:p', 'Low', 'Low', 'unsupported', 'product_rule_coverage', '{}')"
    )
    db.commit()

    s = client.get("/api/reports/shift-summary").json()
    assert s["totals"]["evidence_backed_findings"] == 3
    assert s["totals"]["logged_observations"] == 4
    assert "Low" not in s["totals"]["by_band"]
    assert all(r["scenario"] != "product_rule_coverage" for r in s["recurring_scenarios"])

    # the raw CSV audit trail still carries it, with its status
    rows = list(csv.DictReader(io.StringIO(client.get("/api/reports/incidents.csv").text)))
    probe = next(r for r in rows if r["event_id"] == "9")
    assert probe["status"] == "unsupported"
