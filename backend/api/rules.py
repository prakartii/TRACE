"""REST API for TRACE Custom Rule Builder (Phase 13 — Micro-training / Rule Config).

Provides full CRUD for custom operational safety rules and a safe, deterministic
rule evaluation endpoint.

Design constraints (ARCHITECTURE.md §16, CLAUDE.md §30):
- No arbitrary code execution. Conditions are structured JSON evaluated by
  the TRACE rule engine using explicit field/operator/value logic only.
- All supported fields correspond to real, available TRACE event fields.
- Evaluation results are labelled INFERRED (epistemic integrity).
- Rejection of unsupported operators, invalid lenses, and type violations.
"""

from __future__ import annotations

import sqlite3
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from backend.db.db import get_db
from backend.rules.db import (
    create_custom_rule,
    delete_custom_rule,
    get_custom_rule,
    list_custom_rules,
    update_custom_rule,
)
from backend.rules.engine import (
    VALID_BANDS,
    VALID_CONFIDENCE,
    VALID_LENSES,
    evaluate_rule_against_events,
    validate_condition,
)

router = APIRouter(prefix="/api/rules", tags=["custom_rules"])


# ---------------------------------------------------------------------------
# Pydantic request/response models
# ---------------------------------------------------------------------------

class CustomRuleCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=120, description="Short human-readable rule name")
    description: str = Field(default="", max_length=1000, description="Operational purpose of this rule")
    lens: Optional[str] = Field(None, description="Primary risk lens this rule targets (optional filter hint)")
    severity_band: Optional[str] = Field(None, description="Risk band this rule raises events to when matched")
    enabled: bool = Field(True, description="Whether the rule is active for evaluation")
    action_text: Optional[str] = Field(None, max_length=500, description="Recommended operational action when rule matches")
    condition: dict[str, Any] = Field(..., description="Structured condition tree — no executable code")
    created_by: str = Field("operator", max_length=80)


class CustomRuleUpdate(BaseModel):
    name: Optional[str] = Field(None, min_length=1, max_length=120)
    description: Optional[str] = Field(None, max_length=1000)
    lens: Optional[str] = None
    severity_band: Optional[str] = None
    enabled: Optional[bool] = None
    action_text: Optional[str] = Field(None, max_length=500)
    condition: Optional[dict[str, Any]] = None


class CustomRuleResponse(BaseModel):
    rule_id: int
    name: Optional[str]
    description: Optional[str]
    lens: Optional[str]
    severity_band: Optional[str]
    enabled: bool
    action_text: Optional[str]
    condition: Optional[dict[str, Any]]
    created_by: Optional[str]
    created_at: Optional[float]
    updated_at: Optional[float]


class RuleEvaluationResponse(BaseModel):
    rule_id: int
    rule_name: Optional[str]
    enabled: bool
    condition: dict[str, Any]
    matched_count: int
    total_evaluated: int
    matched_event_ids: list[int]
    sample_matches: list[dict[str, Any]]
    epistemic_label: str
    notice: str


class ConditionSchemaResponse(BaseModel):
    """Returns the allowed vocabulary for building conditions."""
    supported_fields: list[str]
    supported_operators: list[str]
    field_details: dict[str, Any]


# ---------------------------------------------------------------------------
# Validation helpers
# ---------------------------------------------------------------------------

def _validate_lens_field(lens: Optional[str]) -> None:
    if lens is not None and lens not in VALID_LENSES:
        raise HTTPException(
            status_code=422,
            detail=f"Invalid lens '{lens}'. Allowed: {sorted(VALID_LENSES)}."
        )


def _validate_band_field(band: Optional[str]) -> None:
    if band is not None and band not in VALID_BANDS:
        raise HTTPException(
            status_code=422,
            detail=f"Invalid severity_band '{band}'. Allowed: {sorted(VALID_BANDS)}."
        )


def _validate_and_raise(condition: dict) -> None:
    errors = validate_condition(condition)
    if errors:
        raise HTTPException(
            status_code=422,
            detail={"message": "Invalid condition structure.", "errors": errors}
        )


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@router.get("/schema", response_model=ConditionSchemaResponse)
def get_condition_schema() -> ConditionSchemaResponse:
    """Returns the complete vocabulary of allowed fields, operators, and values.

    Use this to build a condition editor UI — the frontend should never
    offer fields/operators not listed here.
    """
    return ConditionSchemaResponse(
        supported_fields=sorted(["lens", "score", "band", "confidence", "scenario"]),
        supported_operators=sorted(["==", "!=", ">=", "<=", ">", "<"]),
        field_details={
            "lens": {
                "type": "categorical",
                "allowed_values": sorted(VALID_LENSES),
                "allowed_operators": ["==", "!="],
                "description": "The risk lens that produced the event.",
            },
            "score": {
                "type": "numeric",
                "range": [0, 100],
                "allowed_operators": ["==", "!=", ">=", "<=", ">", "<"],
                "description": "Composite risk score (0–100). Higher = greater risk.",
            },
            "band": {
                "type": "ordinal",
                "allowed_values": ["Low", "Medium", "High", "Critical"],
                "ordinal_order": "Low < Medium < High < Critical",
                "allowed_operators": ["==", "!=", ">=", "<=", ">", "<"],
                "description": "Risk band derived from score. Ordinal comparisons are supported.",
            },
            "confidence": {
                "type": "ordinal",
                "allowed_values": ["Low", "Medium", "High"],
                "ordinal_order": "Low < Medium < High",
                "allowed_operators": ["==", "!=", ">=", "<=", ">", "<"],
                "description": "Detection confidence level.",
            },
            "scenario": {
                "type": "categorical",
                "allowed_operators": ["==", "!="],
                "description": "Scenario key (e.g. 'dropping_or_throwing_precursor'). Use event data for valid values.",
            },
        }
    )


@router.get("", response_model=list[CustomRuleResponse])
def list_rules(db: sqlite3.Connection = Depends(get_db)) -> list[CustomRuleResponse]:
    """Returns all custom rules, most recently created first."""
    rules = list_custom_rules(db)
    return [CustomRuleResponse(**r) for r in rules]


@router.post("", response_model=CustomRuleResponse, status_code=201)
def create_rule(
    payload: CustomRuleCreate,
    db: sqlite3.Connection = Depends(get_db),
) -> CustomRuleResponse:
    """Creates a new custom operational safety rule.

    The condition must be structured JSON evaluated by the TRACE rule engine.
    Arbitrary code is rejected. Returns 422 with validation details on error.
    """
    _validate_lens_field(payload.lens)
    _validate_band_field(payload.severity_band)
    _validate_and_raise(payload.condition)

    rule = create_custom_rule(
        db,
        name=payload.name,
        description=payload.description,
        lens=payload.lens,
        severity_band=payload.severity_band,
        enabled=payload.enabled,
        action_text=payload.action_text,
        condition=payload.condition,
        created_by=payload.created_by,
    )
    return CustomRuleResponse(**rule)


@router.get("/{rule_id}", response_model=CustomRuleResponse)
def get_rule(rule_id: int, db: sqlite3.Connection = Depends(get_db)) -> CustomRuleResponse:
    """Retrieves a single custom rule by ID."""
    rule = get_custom_rule(db, rule_id)
    if rule is None:
        raise HTTPException(status_code=404, detail=f"Custom rule {rule_id} not found.")
    return CustomRuleResponse(**rule)


@router.put("/{rule_id}", response_model=CustomRuleResponse)
def update_rule(
    rule_id: int,
    payload: CustomRuleUpdate,
    db: sqlite3.Connection = Depends(get_db),
) -> CustomRuleResponse:
    """Updates an existing custom rule. Only provided fields are changed."""
    existing = get_custom_rule(db, rule_id)
    if existing is None:
        raise HTTPException(status_code=404, detail=f"Custom rule {rule_id} not found.")

    if payload.lens is not None:
        _validate_lens_field(payload.lens)
    if payload.severity_band is not None:
        _validate_band_field(payload.severity_band)
    if payload.condition is not None:
        _validate_and_raise(payload.condition)

    rule = update_custom_rule(
        db,
        rule_id,
        name=payload.name,
        description=payload.description,
        lens=payload.lens,
        severity_band=payload.severity_band,
        enabled=payload.enabled,
        action_text=payload.action_text,
        condition=payload.condition,
    )
    return CustomRuleResponse(**rule)


@router.delete("/{rule_id}", status_code=200)
def delete_rule(rule_id: int, db: sqlite3.Connection = Depends(get_db)) -> dict:
    """Deletes a custom rule permanently."""
    deleted = delete_custom_rule(db, rule_id)
    if not deleted:
        raise HTTPException(status_code=404, detail=f"Custom rule {rule_id} not found.")
    return {"status": "deleted", "rule_id": rule_id}


@router.post("/{rule_id}/evaluate", response_model=RuleEvaluationResponse)
def evaluate_rule(
    rule_id: int,
    db: sqlite3.Connection = Depends(get_db),
) -> RuleEvaluationResponse:
    """Evaluates a custom rule against the full TRACE event database.

    Returns how many real events match the rule's condition, with sample
    event IDs and metadata. Results are labelled INFERRED — they are derived
    by deterministic logic from observed event records, not from new sensor
    data.

    Disabled rules can still be evaluated (useful for testing before enabling).
    """
    rule = get_custom_rule(db, rule_id)
    if rule is None:
        raise HTTPException(status_code=404, detail=f"Custom rule {rule_id} not found.")

    condition = rule.get("condition")
    if condition is None:
        raise HTTPException(
            status_code=422,
            detail="Rule has no valid condition stored. Edit the rule to add a condition."
        )

    result = evaluate_rule_against_events(condition, db)

    return RuleEvaluationResponse(
        rule_id=rule_id,
        rule_name=rule.get("name"),
        enabled=rule.get("enabled", True),
        condition=condition,
        matched_count=result["matched_count"],
        total_evaluated=result["total_evaluated"],
        matched_event_ids=result["matched_event_ids"],
        sample_matches=result["sample_matches"],
        epistemic_label=result["epistemic_label"],
        notice=result["notice"],
    )
