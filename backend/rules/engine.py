"""Custom Rule Engine for TRACE — deterministic, safe, no-eval rule evaluation.

Rules operate on real TRACE event fields only. No arbitrary code execution.
All supported fields, operators, and value types are enumerated explicitly.

Epistemic integrity:
- Rule matches are labelled INFERRED (derived from observed event data by
  deterministic rule logic — not directly observed by a sensor).
- The underlying events being evaluated carry their own epistemic labels
  (OBSERVED or INFERRED) which are preserved in evaluation output.
"""

from __future__ import annotations

import json
import logging
import sqlite3
from typing import Any, Optional

logger = logging.getLogger("trace.rules.engine")

# ---------------------------------------------------------------------------
# Allowed condition vocabulary — TRACE event fields only
# ---------------------------------------------------------------------------

SUPPORTED_FIELDS = {
    "lens",
    "score",
    "band",
    "confidence",
    "scenario",
}

SUPPORTED_OPERATORS = {
    "==",
    "!=",
    ">=",
    "<=",
    ">",
    "<",
}

VALID_LENSES = {"structural", "behaviour", "conformance", "environmental"}
VALID_BANDS = {"Low", "Medium", "High", "Critical"}
VALID_CONFIDENCE = {"Low", "Medium", "High"}

# Score is stored as REAL in SQLite (0.0–100.0 in practice)
SCORE_RANGE = (0.0, 100.0)


def validate_condition(condition: dict[str, Any]) -> list[str]:
    """Returns a list of validation error strings. Empty list = valid.

    The condition schema supports two forms:
    1. Simple: {"field": "score", "operator": ">=", "value": 70}
    2. Compound: {"logic": "AND", "conditions": [...]}}

    No arbitrary code is accepted. Field names must be in SUPPORTED_FIELDS,
    operators must be in SUPPORTED_OPERATORS, and values are type-checked.
    """
    errors: list[str] = []
    _validate_node(condition, errors, depth=0)
    return errors


def _validate_node(node: Any, errors: list[str], depth: int) -> None:
    if depth > 4:
        errors.append("Condition nesting too deep (max 4 levels).")
        return
    if not isinstance(node, dict):
        errors.append(f"Condition must be a JSON object, got {type(node).__name__}.")
        return

    if "logic" in node:
        # Compound condition
        logic = node.get("logic")
        if logic not in ("AND", "OR"):
            errors.append(f"Unsupported logic operator '{logic}'. Must be 'AND' or 'OR'.")
        sub = node.get("conditions")
        if not isinstance(sub, list) or len(sub) < 2:
            errors.append("Compound condition must have 'conditions' list with at least 2 entries.")
        elif isinstance(sub, list):
            for child in sub:
                _validate_node(child, errors, depth + 1)
    else:
        # Simple condition
        field = node.get("field")
        operator = node.get("operator")
        value = node.get("value")

        if field not in SUPPORTED_FIELDS:
            errors.append(
                f"Unsupported field '{field}'. Allowed: {sorted(SUPPORTED_FIELDS)}."
            )
            return  # Can't validate further without a valid field

        if operator not in SUPPORTED_OPERATORS:
            errors.append(
                f"Unsupported operator '{operator}'. Allowed: {sorted(SUPPORTED_OPERATORS)}."
            )

        # Value type checks per field
        if field == "lens":
            if not isinstance(value, str) or value not in VALID_LENSES:
                errors.append(
                    f"Invalid lens value '{value}'. Allowed: {sorted(VALID_LENSES)}."
                )
            if operator not in ("==", "!="):
                errors.append(
                    f"Lens field only supports '==' or '!=' operators, got '{operator}'."
                )
        elif field == "band":
            if not isinstance(value, str) or value not in VALID_BANDS:
                errors.append(
                    f"Invalid band value '{value}'. Allowed: {sorted(VALID_BANDS)}."
                )
        elif field == "confidence":
            if not isinstance(value, str) or value not in VALID_CONFIDENCE:
                errors.append(
                    f"Invalid confidence value '{value}'. Allowed: {sorted(VALID_CONFIDENCE)}."
                )
        elif field == "score":
            if not isinstance(value, (int, float)):
                errors.append(
                    f"Score value must be a number (0–100), got {type(value).__name__}."
                )
            elif not (SCORE_RANGE[0] <= float(value) <= SCORE_RANGE[1]):
                errors.append(
                    f"Score value {value} out of range {SCORE_RANGE}."
                )
        elif field == "scenario":
            if not isinstance(value, str) or not value.strip():
                errors.append("Scenario value must be a non-empty string.")
            if operator not in ("==", "!="):
                errors.append(
                    f"Scenario field only supports '==' or '!=' operators, got '{operator}'."
                )


def _evaluate_simple(condition: dict, event_row: dict) -> bool:
    """Evaluates a single simple condition against an event row dict.

    NEVER executes arbitrary code. Each field/operator pair is handled
    explicitly via Python's built-in comparisons.
    """
    field = condition["field"]
    operator = condition["operator"]
    rule_value = condition["value"]

    event_value = event_row.get(field)
    if event_value is None:
        return False

    if field in ("lens", "scenario"):
        # String equality only
        if operator == "==":
            return str(event_value) == str(rule_value)
        elif operator == "!=":
            return str(event_value) != str(rule_value)
        return False

    elif field == "score":
        try:
            ev = float(event_value)
            rv = float(rule_value)
        except (TypeError, ValueError):
            return False
        if operator == ">=":
            return ev >= rv
        elif operator == "<=":
            return ev <= rv
        elif operator == ">":
            return ev > rv
        elif operator == "<":
            return ev < rv
        elif operator == "==":
            return ev == rv
        elif operator == "!=":
            return ev != rv
        return False

    elif field == "band":
        # Ordinal comparison: Low < Medium < High < Critical
        order = {"Low": 0, "Medium": 1, "High": 2, "Critical": 3}
        ev_ord = order.get(str(event_value), -1)
        rv_ord = order.get(str(rule_value), -1)
        if ev_ord == -1 or rv_ord == -1:
            return False
        if operator == ">=":
            return ev_ord >= rv_ord
        elif operator == "<=":
            return ev_ord <= rv_ord
        elif operator == ">":
            return ev_ord > rv_ord
        elif operator == "<":
            return ev_ord < rv_ord
        elif operator == "==":
            return ev_ord == rv_ord
        elif operator == "!=":
            return ev_ord != rv_ord
        return False

    elif field == "confidence":
        # Ordinal comparison: Low < Medium < High
        order = {"Low": 0, "Medium": 1, "High": 2}
        ev_ord = order.get(str(event_value), -1)
        rv_ord = order.get(str(rule_value), -1)
        if ev_ord == -1 or rv_ord == -1:
            return False
        if operator == ">=":
            return ev_ord >= rv_ord
        elif operator == "<=":
            return ev_ord <= rv_ord
        elif operator == ">":
            return ev_ord > rv_ord
        elif operator == "<":
            return ev_ord < rv_ord
        elif operator == "==":
            return ev_ord == rv_ord
        elif operator == "!=":
            return ev_ord != rv_ord
        return False

    return False


def _evaluate_node(condition: dict, event_row: dict) -> bool:
    """Recursively evaluates a condition tree against an event row."""
    if "logic" in condition:
        logic = condition["logic"]
        sub_conditions = condition.get("conditions", [])
        if logic == "AND":
            return all(_evaluate_node(c, event_row) for c in sub_conditions)
        elif logic == "OR":
            return any(_evaluate_node(c, event_row) for c in sub_conditions)
        return False
    else:
        return _evaluate_simple(condition, event_row)


def evaluate_rule_against_events(
    condition: dict,
    conn: sqlite3.Connection,
    limit: int = 10,
) -> dict:
    """Evaluates a rule condition against the real TRACE event DB.

    Returns:
        {
            "matched_count": int,
            "total_evaluated": int,
            "matched_event_ids": list[int],
            "sample_matches": list[dict],  # first few matched events
            "epistemic_label": "INFERRED",
            "notice": str,
        }

    Epistemic honesty: matches are INFERRED — derived from observed event
    data by deterministic rule logic, not directly sensed.
    """
    cur = conn.cursor()
    cur.execute(
        "SELECT event_id, lens, score, band, confidence, scenario, timestamp, video_id "
        "FROM events ORDER BY timestamp DESC"
    )
    rows = cur.fetchall()

    total = len(rows)
    matched_ids: list[int] = []
    sample_matches: list[dict] = []

    for row in rows:
        event_row = {
            "lens": row[1],
            "score": row[2],
            "band": row[3],
            "confidence": row[4],
            "scenario": row[5],
        }
        try:
            if _evaluate_node(condition, event_row):
                matched_ids.append(row[0])
                if len(sample_matches) < limit:
                    sample_matches.append({
                        "event_id": row[0],
                        "lens": row[1],
                        "score": row[2],
                        "band": row[3],
                        "confidence": row[4],
                        "scenario": row[5],
                        "timestamp": row[6],
                        "video_id": row[7],
                    })
        except Exception as exc:
            logger.warning("Rule evaluation error on event %s: %s", row[0], exc)

    return {
        "matched_count": len(matched_ids),
        "total_evaluated": total,
        "matched_event_ids": matched_ids[:50],  # cap for response size
        "sample_matches": sample_matches,
        "epistemic_label": "INFERRED",
        "notice": (
            "Rule matches are INFERRED: derived from observed event records "
            "by deterministic rule logic. Match status does not constitute a "
            "new sensor observation."
        ),
    }
