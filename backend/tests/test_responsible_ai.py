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
    # one seeded-style row (ts 0) and one genuinely old live row per purge target
    old = time.time() - 400 * 86400
    conn.executescript(
        f"""
        INSERT INTO events (event_id, video_id, timestamp, band, confidence, status, scenario, review_status)
        VALUES (1, 'v', 1.0, 'High', 'Low', 'probable', 'box_overhang', NULL),
               (2, 'v', 1.0, 'Critical', 'High', 'supported', 'box_overhang', 'confirmed_damage'),
               (3, 'v', 1.0, 'Medium', 'Medium', 'supported', 'x', 'false_positive');

        INSERT INTO feedback (feedback_id, event_id, flag_type, created_at)
        VALUES (1, 3, 'false_positive', 0), (2, 3, 'false_positive', {old});

        INSERT INTO outcome_measurements
          (outcome_id, event_id, video_id, initial_timestamp, classification,
           condition_1_satisfied, condition_2_satisfied, condition_3_satisfied, three_condition_json, evaluated_at)
        VALUES (1, 1, 'v', 1.0, 'prevented', 1, 1, 1, '{{}}', 0),
               (2, 1, 'v', 1.0, 'near_miss', 1, 1, 0, '{{}}', {old});
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


def test_retention_window_is_clamped(client):
    assert client.put("/api/responsible-ai/retention", json={"window_days": 0}).json()["window_days"] == 1
    assert client.put("/api/responsible-ai/retention", json={"window_days": 99999}).json()["window_days"] == 3650


# --------------------------------------------------------------------------- #
# purge — dry-run by default, never touches ts=0
# --------------------------------------------------------------------------- #

def test_purge_is_dry_run_by_default(client, db):
    r = client.post("/api/responsible-ai/retention/purge").json()
    assert r["dry_run"] is True
    assert r["by_table"]["feedback"] == 1  # the old one, not the ts=0 one
    assert r["by_table"]["outcome_measurements"] == 1
    # nothing actually deleted
    assert db.execute("SELECT COUNT(*) FROM feedback").fetchone()[0] == 2
    assert db.execute("SELECT COUNT(*) FROM outcome_measurements").fetchone()[0] == 2


def test_purge_with_confirm_deletes_only_aged_rows(client, db):
    r = client.post("/api/responsible-ai/retention/purge", params={"confirm": "true"}).json()
    assert r["dry_run"] is False
    assert r["total"] == 2
    # the ts=0 seeded rows survive
    assert db.execute("SELECT COUNT(*) FROM feedback").fetchone()[0] == 1
    assert db.execute("SELECT created_at FROM feedback").fetchone()[0] == 0
    assert db.execute("SELECT COUNT(*) FROM outcome_measurements").fetchone()[0] == 1
    assert db.execute("SELECT evaluated_at FROM outcome_measurements").fetchone()[0] == 0
    # last purge recorded
    lp = get_setting(db, "retention_last_purge")
    assert lp["total"] == 2


def test_auto_purge_noop_when_disabled(db):
    assert run_auto_purge_if_enabled(db) is None
    assert db.execute("SELECT COUNT(*) FROM feedback").fetchone()[0] == 2


def test_run_purge_skips_missing_tables():
    conn = get_connection(":memory:")
    conn.execute("CREATE TABLE feedback (feedback_id INTEGER, created_at REAL)")
    conn.commit()
    # interventions / outcome_measurements / session_ratings absent -> no crash
    res = run_purge(conn, 30, dry_run=True)
    assert "feedback" in res["by_table"]
    conn.close()
