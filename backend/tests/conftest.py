"""Keeps the test suite off the real demo database.

Several suites build a `TestClient(app)` without overriding the `get_db`
dependency, so requests fell through to `backend/db/trace.db` — the database
the demo runs on. Running `pytest` mutated it: test_api_findings and
test_phase11_whatif_trajectory persisted extra events into the event feed,
test_intervention_engine created 14 interventions, and test_incident_replay
deleted seeded events. A presenter who ran the tests before demoing got a
different event log than the runbook documents (CLAUDE.md §25, §32).

Pointing TRACE_DB_PATH at a per-run temp file fixes every such suite at once,
including ones added later, without each having to remember the override.
Suites that pass an explicit path or override `get_db` are unaffected.
"""

from __future__ import annotations

import os

import pytest


@pytest.fixture(scope="session", autouse=True)
def _isolate_demo_database(tmp_path_factory):
    from backend.db.db import DB_PATH_ENV_VAR, DEFAULT_DB_PATH

    previous = os.environ.get(DB_PATH_ENV_VAR)
    target = tmp_path_factory.mktemp("trace-db") / "trace.db"
    os.environ[DB_PATH_ENV_VAR] = str(target)

    # Give it the schema: the app never runs against an uninitialised database,
    # so leaving one here would fail tests for a reason production never has.
    from backend.db.db import get_connection, init_db

    conn = get_connection(target)
    init_db(conn)
    conn.close()

    try:
        yield
    finally:
        if previous is None:
            os.environ.pop(DB_PATH_ENV_VAR, None)
        else:
            os.environ[DB_PATH_ENV_VAR] = previous


@pytest.fixture
def demo_db_path():
    """The real demo database path, for the test that guards it."""
    from backend.db.db import DEFAULT_DB_PATH

    return DEFAULT_DB_PATH
