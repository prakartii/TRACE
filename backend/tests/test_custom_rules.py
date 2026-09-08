"""Tests for Custom Rule Builder — Phase 13 (ARCHITECTURE.md §16 MUST BUILD).

Tests cover:
- Valid rule creation
- Invalid rule rejection (unsupported operator, invalid lens, invalid types)
- Rule persistence and retrieval
- Rule update (partial)
- Rule deletion
- Enabled/disabled behavior
- Condition evaluation TRUE against real events
- Condition evaluation FALSE (threshold too high)
- Compound AND/OR conditions
- Evaluation epistemic labeling
- No arbitrary code execution
- Default rule seeding
- API endpoints end-to-end
"""

from __future__ import annotations

import json
import sqlite3

import pytest
from fastapi.testclient import TestClient

from backend.db.db import get_connection, get_db, init_db
from backend.main import app
from backend.rules.db import (
    create_custom_rule,
    delete_custom_rule,
    ensure_custom_rules_columns,
    get_custom_rule,
    list_custom_rules,
    seed_default_rule,
    update_custom_rule,
)
from backend.rules.engine import (
    evaluate_rule_against_events,
    validate_condition,
)


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

@pytest.fixture
def rule_db(tmp_path):
    db_file = tmp_path / "test_rules.db"
    conn = get_connection(db_file)
    init_db(conn)
    ensure_custom_rules_columns(conn)
    yield conn
    conn.close()


@pytest.fixture
def rule_db_with_events(tmp_path):
    """DB with schema + 4 real-world-like events for evaluation tests."""
    db_file = tmp_path / "test_rules_events.db"
    conn = get_connection(db_file)
    init_db(conn)
    ensure_custom_rules_columns(conn)

    # Insert representative events matching TRACE's real event schema
    events = [
        # behaviour, High score — should match High-Risk Behaviour Escalation rule
        ("v01", 5.0, "risk", "behaviour", "entity_1", 75.0, "High", "High",
         "supported", "dropping_or_throwing_precursor", None, "/api/videos/v01/stream", "INFERRED"),
        # behaviour, Low score — should NOT match score >= 70
        ("v01", 10.0, "risk", "behaviour", "entity_2", 45.0, "Low", "Medium",
         "probable", "dragging_precursor", None, "/api/videos/v01/stream", "INFERRED"),
        # structural, High — should not match behaviour lens rule
        ("v02", 3.0, "risk", "structural", "box_1", 80.0, "High", "High",
         "supported", "heavy_on_light_stacking", None, "/api/videos/v02/stream", "INFERRED"),
        # conformance, Medium — tests conformance lens targeting
        ("v03", 8.0, "risk", "conformance", "box_3", 70.0, "Medium", "High",
         "probable", "wrong_product_orientation", None, "/api/videos/v03/stream", "INFERRED"),
    ]

    conn.executemany(
        """
        INSERT INTO events (video_id, timestamp, event_type, lens, entity_id,
            score, band, confidence, status, scenario, factor_breakdown_json,
            clip_path, epistemic_level)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        events,
    )
    conn.commit()
    yield conn
    conn.close()


@pytest.fixture
def api_client(rule_db_with_events):
    app.dependency_overrides[get_db] = lambda: rule_db_with_events
    yield TestClient(app)
    app.dependency_overrides.clear()


# ---------------------------------------------------------------------------
# Engine — validate_condition
# ---------------------------------------------------------------------------

class TestValidateCondition:

    def test_valid_simple_score(self):
        errors = validate_condition({"field": "score", "operator": ">=", "value": 70})
        assert errors == []

    def test_valid_simple_lens(self):
        errors = validate_condition({"field": "lens", "operator": "==", "value": "behaviour"})
        assert errors == []

    def test_valid_simple_band(self):
        errors = validate_condition({"field": "band", "operator": ">=", "value": "High"})
        assert errors == []

    def test_valid_simple_confidence(self):
        errors = validate_condition({"field": "confidence", "operator": "==", "value": "High"})
        assert errors == []

    def test_valid_simple_scenario(self):
        errors = validate_condition({"field": "scenario", "operator": "==", "value": "box_overhang"})
        assert errors == []

    def test_valid_compound_and(self):
        condition = {
            "logic": "AND",
            "conditions": [
                {"field": "lens", "operator": "==", "value": "behaviour"},
                {"field": "score", "operator": ">=", "value": 70},
            ],
        }
        assert validate_condition(condition) == []

    def test_valid_compound_or(self):
        condition = {
            "logic": "OR",
            "conditions": [
                {"field": "lens", "operator": "==", "value": "structural"},
                {"field": "lens", "operator": "==", "value": "environmental"},
            ],
        }
        assert validate_condition(condition) == []

    def test_invalid_field(self):
        errors = validate_condition({"field": "arbitrary_field", "operator": "==", "value": "x"})
        assert any("Unsupported field" in e for e in errors)

    def test_invalid_operator(self):
        errors = validate_condition({"field": "score", "operator": "LIKE", "value": 70})
        assert any("Unsupported operator" in e for e in errors)

    def test_invalid_lens_value(self):
        errors = validate_condition({"field": "lens", "operator": "==", "value": "fake_lens"})
        assert any("Invalid lens value" in e for e in errors)

    def test_lens_disallows_comparison_operators(self):
        errors = validate_condition({"field": "lens", "operator": ">=", "value": "behaviour"})
        assert any("only supports" in e for e in errors)

    def test_invalid_score_type(self):
        errors = validate_condition({"field": "score", "operator": ">=", "value": "high"})
        assert any("must be a number" in e for e in errors)

    def test_score_out_of_range(self):
        errors = validate_condition({"field": "score", "operator": ">=", "value": 150})
        assert any("out of range" in e for e in errors)

    def test_invalid_band_value(self):
        errors = validate_condition({"field": "band", "operator": "==", "value": "VeryHigh"})
        assert any("Invalid band value" in e for e in errors)

    def test_invalid_confidence_value(self):
        errors = validate_condition({"field": "confidence", "operator": "==", "value": "VeryHigh"})
        assert any("Invalid confidence value" in e for e in errors)

    def test_compound_needs_two_conditions(self):
        condition = {
            "logic": "AND",
            "conditions": [{"field": "score", "operator": ">=", "value": 70}],
        }
        errors = validate_condition(condition)
        assert any("at least 2" in e for e in errors)

    def test_invalid_logic_operator(self):
        condition = {
            "logic": "XOR",
            "conditions": [
                {"field": "score", "operator": ">=", "value": 70},
                {"field": "lens", "operator": "==", "value": "behaviour"},
            ],
        }
        errors = validate_condition(condition)
        assert any("Unsupported logic" in e for e in errors)

    def test_no_arbitrary_code_in_field(self):
        # Attempt to inject Python/JS style executable payloads — all must fail
        bad_fields = [
            "__import__('os').system",
            "eval(x)",
            "exec",
            "lambda",
        ]
        for bad_field in bad_fields:
            errors = validate_condition({"field": bad_field, "operator": "==", "value": "x"})
            assert errors, f"Expected validation error for field '{bad_field}'"


# ---------------------------------------------------------------------------
# Engine — evaluate_rule_against_events
# ---------------------------------------------------------------------------

class TestEvaluateRule:

    def test_high_behaviour_rule_matches(self, rule_db_with_events):
        """Default GEG example rule: behaviour AND score >= 70 should match 1 event."""
        condition = {
            "logic": "AND",
            "conditions": [
                {"field": "lens", "operator": "==", "value": "behaviour"},
                {"field": "score", "operator": ">=", "value": 70},
            ],
        }
        result = evaluate_rule_against_events(condition, rule_db_with_events)
        assert result["matched_count"] == 1
        assert result["total_evaluated"] == 4
        match = result["sample_matches"][0]
        assert match["lens"] == "behaviour"
        assert match["score"] >= 70

    def test_no_match_when_threshold_too_high(self, rule_db_with_events):
        condition = {"field": "score", "operator": ">=", "value": 95}
        result = evaluate_rule_against_events(condition, rule_db_with_events)
        assert result["matched_count"] == 0
        assert result["sample_matches"] == []

    def test_lens_filter_structural(self, rule_db_with_events):
        condition = {"field": "lens", "operator": "==", "value": "structural"}
        result = evaluate_rule_against_events(condition, rule_db_with_events)
        assert result["matched_count"] == 1
        assert result["sample_matches"][0]["lens"] == "structural"

    def test_or_condition_matches_multiple_lenses(self, rule_db_with_events):
        condition = {
            "logic": "OR",
            "conditions": [
                {"field": "lens", "operator": "==", "value": "behaviour"},
                {"field": "lens", "operator": "==", "value": "structural"},
            ],
        }
        result = evaluate_rule_against_events(condition, rule_db_with_events)
        # Events 1 (behaviour high), 2 (behaviour low), 3 (structural) => 3
        assert result["matched_count"] == 3

    def test_band_comparison_ge(self, rule_db_with_events):
        condition = {"field": "band", "operator": ">=", "value": "High"}
        result = evaluate_rule_against_events(condition, rule_db_with_events)
        # Events with High band: event 1 (High) and event 3 (High) = 2
        assert result["matched_count"] == 2

    def test_epistemic_label_is_inferred(self, rule_db_with_events):
        condition = {"field": "score", "operator": ">=", "value": 50}
        result = evaluate_rule_against_events(condition, rule_db_with_events)
        assert result["epistemic_label"] == "INFERRED"
        assert "INFERRED" in result["notice"]

    def test_scenario_exact_match(self, rule_db_with_events):
        condition = {"field": "scenario", "operator": "==", "value": "wrong_product_orientation"}
        result = evaluate_rule_against_events(condition, rule_db_with_events)
        assert result["matched_count"] == 1
        assert result["sample_matches"][0]["scenario"] == "wrong_product_orientation"

    def test_confidence_high_filter(self, rule_db_with_events):
        condition = {"field": "confidence", "operator": "==", "value": "High"}
        result = evaluate_rule_against_events(condition, rule_db_with_events)
        # Events 1 (High), 3 (High), 4 (High) = 3
        assert result["matched_count"] == 3


# ---------------------------------------------------------------------------
# DB layer — CRUD
# ---------------------------------------------------------------------------

class TestRulesDBCRUD:

    def test_create_and_retrieve(self, rule_db):
        condition = {"field": "score", "operator": ">=", "value": 70}
        rule = create_custom_rule(
            rule_db,
            name="Test Rule",
            description="A test rule",
            lens="behaviour",
            severity_band="High",
            enabled=True,
            action_text="Review immediately",
            condition=condition,
        )
        assert rule["rule_id"] is not None
        assert rule["name"] == "Test Rule"
        assert rule["lens"] == "behaviour"
        assert rule["condition"] == condition
        assert rule["enabled"] is True

        retrieved = get_custom_rule(rule_db, rule["rule_id"])
        assert retrieved["rule_id"] == rule["rule_id"]
        assert retrieved["condition"] == condition

    def test_list_rules(self, rule_db):
        create_custom_rule(
            rule_db, name="R1", description="", lens=None, severity_band=None,
            enabled=True, action_text=None, condition={"field": "score", "operator": ">=", "value": 60},
        )
        create_custom_rule(
            rule_db, name="R2", description="", lens=None, severity_band=None,
            enabled=False, action_text=None, condition={"field": "score", "operator": ">=", "value": 80},
        )
        rules = list_custom_rules(rule_db)
        assert len(rules) == 2
        names = {r["name"] for r in rules}
        assert names == {"R1", "R2"}

    def test_update_name_and_threshold(self, rule_db):
        rule = create_custom_rule(
            rule_db, name="Old Name", description="", lens=None, severity_band=None,
            enabled=True, action_text=None,
            condition={"field": "score", "operator": ">=", "value": 50},
        )
        updated = update_custom_rule(
            rule_db, rule["rule_id"],
            name="New Name",
            condition={"field": "score", "operator": ">=", "value": 80},
        )
        assert updated["name"] == "New Name"
        assert updated["condition"]["value"] == 80

    def test_update_enabled_toggle(self, rule_db):
        rule = create_custom_rule(
            rule_db, name="Toggle", description="", lens=None, severity_band=None,
            enabled=True, action_text=None,
            condition={"field": "lens", "operator": "==", "value": "behaviour"},
        )
        updated = update_custom_rule(rule_db, rule["rule_id"], enabled=False)
        assert updated["enabled"] is False

    def test_delete_rule(self, rule_db):
        rule = create_custom_rule(
            rule_db, name="Delete Me", description="", lens=None, severity_band=None,
            enabled=True, action_text=None,
            condition={"field": "score", "operator": ">=", "value": 50},
        )
        rule_id = rule["rule_id"]
        deleted = delete_custom_rule(rule_db, rule_id)
        assert deleted is True
        assert get_custom_rule(rule_db, rule_id) is None

    def test_delete_nonexistent_returns_false(self, rule_db):
        assert delete_custom_rule(rule_db, 99999) is False

    def test_get_nonexistent_returns_none(self, rule_db):
        assert get_custom_rule(rule_db, 99999) is None

    def test_seed_default_rule(self, rule_db):
        seed_default_rule(rule_db)
        rules = list_custom_rules(rule_db)
        assert len(rules) == 1
        assert rules[0]["name"] == "High-Risk Behaviour Escalation"
        assert rules[0]["condition"]["logic"] == "AND"
        assert rules[0]["enabled"] is True

    def test_seed_does_not_duplicate(self, rule_db):
        seed_default_rule(rule_db)
        seed_default_rule(rule_db)
        rules = list_custom_rules(rule_db)
        assert len(rules) == 1


# ---------------------------------------------------------------------------
# API endpoints — HTTP integration
# ---------------------------------------------------------------------------

class TestRulesAPI:

    def test_get_schema(self, api_client):
        r = api_client.get("/api/rules/schema")
        assert r.status_code == 200
        data = r.json()
        assert "supported_fields" in data
        assert "score" in data["supported_fields"]
        assert "lens" in data["supported_fields"]

    def test_create_valid_rule(self, api_client):
        payload = {
            "name": "High Score Behaviour",
            "description": "Flags high-risk behaviour events",
            "lens": "behaviour",
            "severity_band": "High",
            "enabled": True,
            "action_text": "Review immediately",
            "condition": {
                "logic": "AND",
                "conditions": [
                    {"field": "lens", "operator": "==", "value": "behaviour"},
                    {"field": "score", "operator": ">=", "value": 70},
                ],
            },
            "created_by": "judge_demo",
        }
        r = api_client.post("/api/rules", json=payload)
        assert r.status_code == 201
        data = r.json()
        assert data["rule_id"] is not None
        assert data["name"] == "High Score Behaviour"
        assert data["enabled"] is True

    def test_create_rule_invalid_lens_rejected(self, api_client):
        payload = {
            "name": "Bad",
            "condition": {"field": "lens", "operator": "==", "value": "behaviour"},
            "lens": "nonexistent_lens",
            "created_by": "test",
        }
        r = api_client.post("/api/rules", json=payload)
        assert r.status_code == 422
        assert "nonexistent_lens" in r.text

    def test_create_rule_unsupported_operator_rejected(self, api_client):
        payload = {
            "name": "Bad Op",
            "condition": {"field": "score", "operator": "LIKE", "value": 70},
            "created_by": "test",
        }
        r = api_client.post("/api/rules", json=payload)
        assert r.status_code == 422

    def test_create_rule_invalid_field_rejected(self, api_client):
        payload = {
            "name": "Bad Field",
            "condition": {"field": "__import__", "operator": "==", "value": "os"},
            "created_by": "test",
        }
        r = api_client.post("/api/rules", json=payload)
        assert r.status_code == 422

    def test_get_rule_by_id(self, api_client):
        create_r = api_client.post("/api/rules", json={
            "name": "Retrieve Test",
            "condition": {"field": "score", "operator": ">=", "value": 60},
            "created_by": "test",
        })
        rule_id = create_r.json()["rule_id"]
        r = api_client.get(f"/api/rules/{rule_id}")
        assert r.status_code == 200
        assert r.json()["rule_id"] == rule_id

    def test_get_nonexistent_rule_404(self, api_client):
        r = api_client.get("/api/rules/99999")
        assert r.status_code == 404

    def test_update_rule(self, api_client):
        create_r = api_client.post("/api/rules", json={
            "name": "Original",
            "condition": {"field": "score", "operator": ">=", "value": 60},
            "created_by": "test",
        })
        rule_id = create_r.json()["rule_id"]
        r = api_client.put(f"/api/rules/{rule_id}", json={"name": "Updated", "enabled": False})
        assert r.status_code == 200
        data = r.json()
        assert data["name"] == "Updated"
        assert data["enabled"] is False

    def test_delete_rule(self, api_client):
        create_r = api_client.post("/api/rules", json={
            "name": "Delete Me",
            "condition": {"field": "score", "operator": ">=", "value": 60},
            "created_by": "test",
        })
        rule_id = create_r.json()["rule_id"]
        r = api_client.delete(f"/api/rules/{rule_id}")
        assert r.status_code == 200
        assert api_client.get(f"/api/rules/{rule_id}").status_code == 404

    def test_evaluate_rule_matches_real_events(self, api_client):
        """Test the GEG example rule against the 4 seeded events."""
        create_r = api_client.post("/api/rules", json={
            "name": "GEG Example Rule",
            "condition": {
                "logic": "AND",
                "conditions": [
                    {"field": "lens", "operator": "==", "value": "behaviour"},
                    {"field": "score", "operator": ">=", "value": 70},
                ],
            },
            "created_by": "judge",
        })
        assert create_r.status_code == 201
        rule_id = create_r.json()["rule_id"]

        r = api_client.post(f"/api/rules/{rule_id}/evaluate")
        assert r.status_code == 200
        data = r.json()
        assert data["matched_count"] == 1
        assert data["total_evaluated"] == 4
        assert data["epistemic_label"] == "INFERRED"
        assert "INFERRED" in data["notice"]
        assert len(data["sample_matches"]) == 1
        match = data["sample_matches"][0]
        assert match["lens"] == "behaviour"
        assert match["score"] >= 70

    def test_evaluate_nonexistent_rule_404(self, api_client):
        r = api_client.post("/api/rules/99999/evaluate")
        assert r.status_code == 404

    def test_list_rules_empty_then_populated(self, api_client):
        r = api_client.get("/api/rules")
        assert r.status_code == 200
        initial_count = len(r.json())

        api_client.post("/api/rules", json={
            "name": "List Test",
            "condition": {"field": "score", "operator": ">=", "value": 60},
            "created_by": "test",
        })
        r2 = api_client.get("/api/rules")
        assert len(r2.json()) == initial_count + 1

    def test_rule_persistence_across_get(self, api_client):
        """Rule created via POST is retrievable via GET."""
        create_r = api_client.post("/api/rules", json={
            "name": "Persist Check",
            "description": "Verify persistence",
            "severity_band": "High",
            "condition": {
                "logic": "AND",
                "conditions": [
                    {"field": "lens", "operator": "==", "value": "conformance"},
                    {"field": "confidence", "operator": "==", "value": "High"},
                ],
            },
            "action_text": "Escalate to supervisor",
            "created_by": "auditor",
        })
        rule_id = create_r.json()["rule_id"]
        r = api_client.get(f"/api/rules/{rule_id}")
        data = r.json()
        assert data["description"] == "Verify persistence"
        assert data["severity_band"] == "High"
        assert data["action_text"] == "Escalate to supervisor"
        assert data["created_by"] == "auditor"
