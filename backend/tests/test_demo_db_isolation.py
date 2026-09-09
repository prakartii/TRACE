"""The test suite must never write to the demo database (CLAUDE.md §25, §32).

Suites that build a TestClient without overriding `get_db` used to fall
through to backend/db/trace.db, the database the demo runs on: running pytest
added events and interventions to it, and deleted seeded ones.
"""

from __future__ import annotations

import os

from backend.db.db import DB_PATH_ENV_VAR, DEFAULT_DB_PATH, default_db_path, get_connection


def test_the_suite_is_redirected_away_from_the_demo_database():
    redirected = os.environ.get(DB_PATH_ENV_VAR)
    assert redirected, "conftest must redirect TRACE_DB_PATH for the whole session"
    assert default_db_path() != DEFAULT_DB_PATH
    assert str(DEFAULT_DB_PATH) not in redirected


def test_an_unoverridden_client_writes_to_the_temp_db_not_the_demo_one():
    """The exact shape that leaked: a TestClient with no get_db override."""
    from starlette.testclient import TestClient

    from backend.main import app

    demo_existed = DEFAULT_DB_PATH.exists()
    before = DEFAULT_DB_PATH.stat().st_mtime_ns if demo_existed else None

    with TestClient(app) as client:
        assert client.get("/api/events").status_code == 200

    if demo_existed:
        assert DEFAULT_DB_PATH.stat().st_mtime_ns == before, (
            "a request touched the real demo database"
        )


def test_default_db_path_follows_the_env_var(tmp_path, monkeypatch):
    target = tmp_path / "elsewhere.db"
    monkeypatch.setenv(DB_PATH_ENV_VAR, str(target))
    assert default_db_path() == target

    # resolved per call, not bound as an import-time default argument
    get_connection().close()
    assert target.exists()
