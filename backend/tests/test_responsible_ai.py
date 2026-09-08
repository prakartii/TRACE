"""Responsible-AI governance surface (ARCHITECTURE.md Screen 8 / §15, CLAUDE.md §22).

Covers the read-only status snapshot, the persisted retention policy, and the
purge — which must be dry-run by default and must never remove seeded rows
(timestamp 0).
"""

from __future__ import annotations

import time

import pytest
from starlette.testclient import TestClient

from backend.api.responsible_ai import run_auto_purge_if_enabled, run_purge
from backend.db.app_settings import get_setting
from backend.db.db import get_connection, get_db, init_db
from backend.main import app


@pytest.fixture
def db():
    conn = get_connection(":memory:")
    init_db(conn)
    old = time.time() - 400 * 86400  # well outside any retention window
    conn.executescript(
        f"""
        INSERT INTO events (event_id, video_id, timestamp, band, confidence, status, scenario, review_status)
        VALUES (1, 'v', 1.0, 'High', 'Low', 'probable', 'box_overhang', NULL),
               (2, 'v', 1.0, 'Critical', 'High', 'supported', 'box_overhang', 'confirmed_damage'),
               (3, 'v', 1.0, 'Medium', 'Medium', 'supported', 'x', 'false_positive');

        -- one seeded-style row (ts 0) and one genuinely old runtime row
        INSERT INTO feedback (feedback_id, event_id, flag_type, created_at)
        VALUES (1, 3, 'false_positive', 0), (2, 3, 'false_positive', {old});

        -- outcome_measurements is NOT a purge target: both must always survive
        INSERT INTO outcome_measurements
          (outcome_id, event_id, video_id, initial_timestamp, classification,
           condition_1_satisfied, condition_2_satisfied, condition_3_satisfied, three_condition_json, evaluated_at)
        VALUES (1, 1, 'v', 1.0, 'prevented', 1, 1, 1, '{{}}', 0),
               (2, 1, 'v', 1.0, 'near_miss', 1, 1, 0, '{{}}', {old});

        -- interventions: only terminal (RESOLVED/FALSE_POSITIVE) + old ones purge
        INSERT INTO interventions
          (alert_id, event_id, video_id, timestamp, scenario, severity, urgency, state, title,
           immediate_action, secondary_actions_json, steps_json, verification, reason,
           supporting_event_ids_json, dedup_key, created_at, updated_at)
        VALUES
          ('i_old_resolved', 1, 'v', 1.0, 'box_overhang', 'HIGH', 'URGENT', 'RESOLVED', 't',
           'a', '[]', '[]', 'v', 'r', '[1]', 'd1', {old}, {old}),
          ('i_old_active',   1, 'v', 1.0, 'box_overhang', 'HIGH', 'URGENT', 'NEW', 't',
           'a', '[]', '[]', 'v', 'r', '[1]', 'd2', {old}, {old}),
          ('i_new_resolved', 1, 'v', 1.0, 'box_overhang', 'HIGH', 'URGENT', 'RESOLVED', 't',
           'a', '[]', '[]', 'v', 'r', '[1]', 'd3', {time.time()}, {time.time()});
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


# --------------------------------------------------------------------------- #
# status
# --------------------------------------------------------------------------- #

def test_status_reports_governance_state(client):
    s = client.get("/api/responsible-ai/status").json()
    assert s["face_redaction"]["enabled"] is True
    assert s["human_review"]["confirmed_damage"] == 1
    assert s["human_review"]["false_positive"] == 1
    # High/Critical + (Low confidence or probable/insufficient) + unreviewed
    assert s["human_review"]["high_risk_awaiting_review"] == 1
    assert s["confidence_distribution"] == {"Low": 1, "High": 1, "Medium": 1}
    assert "never self-confirms" in s["human_review"]["note"]
    assert s["disclosures"]["stability"]
    assert "worker identity" in s["disclosures"]["transparency_notice"]


# --------------------------------------------------------------------------- #
# retention
# --------------------------------------------------------------------------- #

def test_retention_defaults_and_update(client):
    assert client.get("/api/responsible-ai/retention").json() == {
        "window_days": 30, "auto_purge": False, "last_purge": None,
    }
    updated = client.put("/api/responsible-ai/retention", json={"window_days": 14, "auto_purge": True}).json()
    assert updated["window_days"] == 14 and updated["auto_purge"] is True
    assert client.get("/api/responsible-ai/retention").json()["window_days"] == 14


def test_retention_window_out_of_range_is_rejected(client):
    assert client.put("/api/responsible-ai/retention", json={"window_days": 0}).status_code == 422
    assert client.put("/api/responsible-ai/retention", json={"window_days": 99999}).status_code == 422
    assert client.put("/api/responsible-ai/retention", json={"window_days": "soon"}).status_code == 422


# --------------------------------------------------------------------------- #
# purge — dry-run by default; events / outcomes / active alerts never touched
# --------------------------------------------------------------------------- #

def test_purge_is_dry_run_by_default(client, db):
    r = client.post("/api/responsible-ai/retention/purge").json()
    assert r["dry_run"] is True
    assert r["by_table"]["feedback"] == 1        # old runtime row, not the ts=0 one
    assert r["by_table"]["interventions"] == 1   # old + RESOLVED only
    assert "outcome_measurements" not in r["by_table"]
    # nothing actually deleted
    assert db.execute("SELECT COUNT(*) FROM feedback").fetchone()[0] == 2
    assert db.execute("SELECT COUNT(*) FROM interventions").fetchone()[0] == 3


def test_purge_with_confirm_spares_events_outcomes_and_active_alerts(client, db):
    r = client.post("/api/responsible-ai/retention/purge", params={"confirm": "true"}).json()
    assert r["dry_run"] is False
    assert r["total"] == 2  # 1 feedback + 1 intervention (old & resolved)

    # ts=0 seeded feedback survives
    assert db.execute("SELECT COUNT(*) FROM feedback").fetchone()[0] == 1
    assert db.execute("SELECT created_at FROM feedback").fetchone()[0] == 0
    # prevention outcomes are never a purge target — BOTH rows survive
    assert db.execute("SELECT COUNT(*) FROM outcome_measurements").fetchone()[0] == 2
    assert {r[0] for r in db.execute("SELECT classification FROM outcome_measurements")} == {"prevented", "near_miss"}
    # the old-but-active alert and the new-resolved alert survive; only old+terminal goes
    kept = {r[0] for r in db.execute("SELECT alert_id FROM interventions")}
    assert kept == {"i_old_active", "i_new_resolved"}

    lp = get_setting(db, "retention_last_purge")
    assert lp["total"] == 2


def test_canonical_seed_prevented_outcome_survives_a_one_day_purge():
    """Regression for the audit finding: the demo's headline 'prevented' record
    must not be aged out by an aggressive retention window."""
    conn = get_connection(":memory:")
    init_db(conn)
    from backend.db.canonical_seed import sync_canonical_events

    sync_canonical_events(conn)
    before = conn.execute(
        "SELECT COUNT(*) FROM outcome_measurements WHERE classification = 'prevented'"
    ).fetchone()[0]
    assert before >= 1

    run_purge(conn, window_days=1, dry_run=False)

    after = conn.execute(
        "SELECT COUNT(*) FROM outcome_measurements WHERE classification = 'prevented'"
    ).fetchone()[0]
    assert after == before, "retention purge deleted the seeded 'prevented' outcome"
    conn.close()


def test_auto_purge_noop_when_disabled(db):
    assert run_auto_purge_if_enabled(db) is None
    assert db.execute("SELECT COUNT(*) FROM feedback").fetchone()[0] == 2


def test_run_purge_skips_missing_tables():
    conn = get_connection(":memory:")
    conn.execute("CREATE TABLE feedback (feedback_id INTEGER, created_at REAL)")
    conn.commit()
    # interventions / session_ratings absent -> no crash
    res = run_purge(conn, 30, dry_run=True)
    assert "feedback" in res["by_table"]
    conn.close()
