"""Tests for backend/video/ingest.py — the automatic upload -> incident sweep
(CLAUDE.md critical-pass Feature 3: real end-to-end video ingestion).

Runs against a real challenge video through the already-materialized on-disk
perception cache (data/.perception_cache/pilot_<id>.json), so these tests
exercise the genuine four-lens pipeline and dedup path without needing a
fresh YOLO pass. A dedicated tmp SQLite database (via TRACE_DB_PATH) keeps
every assertion isolated from the real demo database.
"""

from __future__ import annotations

import sqlite3

import pytest

from backend.db.db import create_database, get_connection
from backend.video.ingest import get_ingestion_status, run_video_ingestion
from backend.video.registry import VideoRegistry

# One of the 8 supplied challenge clips with a matching pilot perception
# cache file (data/.perception_cache/pilot_d2984c4eb1cf6b86.json) — see
# backend/db/canonical_seed.py for the same id used as the canonical
# "heavy_on_light_stacking" video.
CANONICAL_VIDEO_ID = "d2984c4eb1cf6b86"


@pytest.fixture
def isolated_db(tmp_path, monkeypatch):
    db_path = tmp_path / "ingest_test.db"
    monkeypatch.setenv("TRACE_DB_PATH", str(db_path))
    conn = create_database(db_path)
    conn.close()
    yield db_path


def test_run_video_ingestion_produces_evidence_grounded_events(isolated_db):
    registry = VideoRegistry()  # default data/challenge_videos dir -> disk cache eligible
    record = registry.get(CANONICAL_VIDEO_ID)
    assert record is not None, "expected supplied challenge video to be discoverable"

    status = run_video_ingestion(CANONICAL_VIDEO_ID, model="pilot", registry=registry)

    assert status["status"] == "complete"
    assert status["canonical_id"] == CANONICAL_VIDEO_ID
    assert status["samples_analyzed"] > 0
    # Honesty rule: never claim a scenario without evidence-backed findings.
    for scen in status["scenarios"]:
        assert scen["count"] >= 1
        assert scen["band"] in ("Low", "Medium", "High", "Critical")

    conn = get_connection(isolated_db)
    try:
        rows = conn.execute(
            "SELECT * FROM events WHERE video_id = ?", (CANONICAL_VIDEO_ID,)
        ).fetchall()
        # persist_findings keeps the full evidence trail (every epistemic
        # status, including insufficient_evidence/unsupported candidates),
        # and dedups on (canonical id, scenario, timestamp, entity) — so two
        # findings from different lenses can collapse into one stored row.
        # The ingestion summary's "events_found" (a per-finding count, before
        # any such collision) is therefore an upper bound on the persisted
        # supported/probable row count, never a lower one.
        supported_or_probable = [r for r in rows if r["status"] in ("supported", "probable")]
        assert len(rows) >= status["events_found"]
        assert 0 < len(supported_or_probable) <= status["events_found"]
    finally:
        conn.close()


def test_ingestion_status_is_persisted_and_pollable(isolated_db):
    registry = VideoRegistry()
    assert get_ingestion_status(get_connection(isolated_db), CANONICAL_VIDEO_ID) is None

    run_video_ingestion(CANONICAL_VIDEO_ID, model="pilot", registry=registry)

    conn = get_connection(isolated_db)
    try:
        status = get_ingestion_status(conn, CANONICAL_VIDEO_ID)
    finally:
        conn.close()
    assert status is not None
    assert status["status"] == "complete"
    assert "message" in status


def test_reingesting_the_same_video_does_not_duplicate_incidents(isolated_db):
    registry = VideoRegistry()

    def _row_count(conn: sqlite3.Connection) -> int:
        (n,) = conn.execute(
            "SELECT COUNT(*) FROM events WHERE video_id = ?", (CANONICAL_VIDEO_ID,)
        ).fetchone()
        return n

    first = run_video_ingestion(CANONICAL_VIDEO_ID, model="pilot", registry=registry)
    conn = get_connection(isolated_db)
    try:
        count_after_first = _row_count(conn)
    finally:
        conn.close()

    second = run_video_ingestion(CANONICAL_VIDEO_ID, model="pilot", registry=registry)
    conn = get_connection(isolated_db)
    try:
        count_after_second = _row_count(conn)
    finally:
        conn.close()

    assert first["events_found"] == second["events_found"]
    # Re-running ingestion must UPDATE existing dedup-keyed rows (same
    # timestamp/scenario/entity), not insert a second copy of every finding.
    assert count_after_second == count_after_first


def test_unknown_video_id_fails_honestly_without_fabricating_a_result(isolated_db):
    registry = VideoRegistry()
    status = run_video_ingestion("not_a_real_video_id", model="pilot", registry=registry)
    assert status["status"] == "failed"
    assert "error" in status
