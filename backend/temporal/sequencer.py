"""Temporal Sequence Analyser for TRACE — Feature 1: Video Perception + Temporal Reasoning.

This module reasons about PERSISTED TRACE events (from the SQLite events table) as
temporal sequences rather than treating each event as an isolated point.

IMPORTANT DISTINCTION:
- backend/world_model/temporal.py  → per-entity kinematics over live perception FRAMES
- backend/temporal/sequencer.py    → temporal patterns over PERSISTED DB EVENTS

These are complementary, not competing. This module builds higher-level
behavioural conclusions from the record of what actually happened across
a time window in the event log.

EPISTEMIC RULES (never violated):
- OBSERVED  : event records directly stored from footage analysis
- INFERRED  : conclusion drawn deterministically from ≥2 observed events
- PREDICTED : forecast about what may happen, derived from an inferred pattern
  (lives in risk/predictor.py, not here)

A temporal conclusion is only INFERRED if it is grounded in ≥2 real event IDs.
If the evidence is insufficient, we return an explicit insufficient-evidence
result rather than fabricating a pattern.
"""

from __future__ import annotations

import sqlite3
from dataclasses import dataclass, field
from typing import Any, Optional


# ---------------------------------------------------------------------------
# Data structures
# ---------------------------------------------------------------------------

@dataclass
class TemporalEvent:
    """A lightweight projection of a DB event relevant for temporal analysis.

    Only carries fields needed for sequence reasoning — does not duplicate the
    full RiskEvent model.
    """
    event_id: int
    timestamp: float
    lens: str
    scenario: Optional[str]
    score: Optional[float]
    band: Optional[str]
    confidence: Optional[str]
    video_id: Optional[str]
    epistemic_level: str = "INFERRED"  # as stored; always from observed footage


@dataclass
class TemporalPattern:
    """A detected pattern over a sequence of ≥2 observed events.

    Epistemic level is always INFERRED — derived deterministically from the
    observed event records, not directly sensed.
    """
    pattern_type: str                     # e.g. 'escalating_risk' / 'repeated_behaviour' / 'precursor_sequence'
    label: str                            # human-readable
    description: str                      # what the pattern means operationally
    supporting_event_ids: list[int]       # IDs of the real events that produced this pattern
    time_window_sec: float                # total span of the sequence
    first_timestamp: float
    last_timestamp: float
    scenario: Optional[str]               # canonical scenario key if homogeneous
    lens: Optional[str]
    event_count: int
    score_trend: str                      # 'escalating' / 'stable' / 'de-escalating' / 'variable'
    peak_score: Optional[float]
    epistemic_level: str = "INFERRED"
    notice: str = (
        "Pattern is INFERRED: derived deterministically from observed event records. "
        "No new sensor observation."
    )


@dataclass
class TemporalSequenceResult:
    """Full result of temporal sequence analysis over a set of events."""
    events_analysed: int
    time_span_sec: float
    patterns: list[TemporalPattern]
    insufficient_evidence: bool
    insufficient_evidence_reason: Optional[str]
    epistemic_notice: str = (
        "Underlying events are OBSERVED (from footage analysis). "
        "Patterns are INFERRED (deterministic sequence logic). "
        "No fabrication — if evidence is insufficient, patterns list is empty."
    )


# ---------------------------------------------------------------------------
# Score trend utilities
# ---------------------------------------------------------------------------

def _score_trend(scores: list[float]) -> str:
    """Classifies the trend direction of a score sequence."""
    if len(scores) < 2:
        return "stable"
    increases = sum(1 for a, b in zip(scores, scores[1:]) if b > a + 1.0)
    decreases = sum(1 for a, b in zip(scores, scores[1:]) if b < a - 1.0)
    pairs = len(scores) - 1
    if (increases + decreases) / pairs < 0.3:
        return "stable"
    if increases / pairs >= 0.6 and decreases / pairs <= 0.2:
        return "escalating"
    if decreases / pairs >= 0.6 and increases / pairs <= 0.2:
        return "de-escalating"
    return "variable"


def _band_ordinal(band: Optional[str]) -> int:
    return {"Low": 0, "Medium": 1, "High": 2, "Critical": 3}.get(band or "", -1)


# ---------------------------------------------------------------------------
# Pattern detectors — each takes a list[TemporalEvent] and returns
# list[TemporalPattern]. All are deterministic and traceable.
# ---------------------------------------------------------------------------

def _detect_escalating_risk(events: list[TemporalEvent]) -> list[TemporalPattern]:
    """Detects monotonically escalating risk band within a sequence.

    Requires ≥3 events where band strictly increases (Low→Medium, Medium→High, etc.).
    Groups by scenario when homogeneous.
    """
    if len(events) < 3:
        return []

    patterns: list[TemporalPattern] = []
    scored = [e for e in events if e.score is not None]
    if len(scored) < 3:
        return []

    # Group into contiguous escalating runs
    run: list[TemporalEvent] = [scored[0]]
    for prev, curr in zip(scored, scored[1:]):
        if (curr.score or 0) >= (prev.score or 0) - 2.0:  # allow 2-point noise
            run.append(curr)
        else:
            if len(run) >= 3:
                _emit_escalation(run, patterns)
            run = [curr]
    if len(run) >= 3:
        _emit_escalation(run, patterns)

    return patterns


def _emit_escalation(run: list[TemporalEvent], out: list[TemporalPattern]) -> None:
    scores = [e.score for e in run if e.score is not None]
    if not scores or scores[-1] <= scores[0]:
        return
    scenarios = {e.scenario for e in run if e.scenario}
    lenses = {e.lens for e in run}
    scenario = list(scenarios)[0] if len(scenarios) == 1 else None
    lens = list(lenses)[0] if len(lenses) == 1 else None
    span = run[-1].timestamp - run[0].timestamp
    out.append(TemporalPattern(
        pattern_type="escalating_risk",
        label="Escalating Risk Score",
        description=(
            f"Risk score increased from {scores[0]:.0f} to {scores[-1]:.0f} "
            f"across {len(run)} events over {span:.1f}s — indicates a worsening "
            f"operational condition that has not been resolved."
        ),
        supporting_event_ids=[e.event_id for e in run],
        time_window_sec=span,
        first_timestamp=run[0].timestamp,
        last_timestamp=run[-1].timestamp,
        scenario=scenario,
        lens=lens,
        event_count=len(run),
        score_trend="escalating",
        peak_score=max(scores),
    ))


def _detect_repeated_behaviour(events: list[TemporalEvent], min_repeats: int = 2) -> list[TemporalPattern]:
    """Detects a scenario that recurs ≥min_repeats times within the window.

    A repeated unsafe behaviour is operationally significant even if each
    individual event score is not critical — repeated exposure compounds risk.
    """
    if len(events) < min_repeats:
        return []

    # Count by scenario
    by_scenario: dict[str, list[TemporalEvent]] = {}
    for e in events:
        if e.scenario:
            by_scenario.setdefault(e.scenario, []).append(e)

    patterns: list[TemporalPattern] = []
    for scenario, evs in by_scenario.items():
        if len(evs) < min_repeats:
            continue
        scores = [e.score for e in evs if e.score is not None]
        span = evs[-1].timestamp - evs[0].timestamp
        trend = _score_trend(scores) if scores else "stable"
        lenses = {e.lens for e in evs}
        lens = list(lenses)[0] if len(lenses) == 1 else None
        patterns.append(TemporalPattern(
            pattern_type="repeated_behaviour",
            label=f"Repeated Unsafe Behaviour",
            description=(
                f"Scenario '{scenario}' detected {len(evs)}× over {span:.1f}s. "
                f"Repeated occurrence indicates a persistent handling practice "
                f"rather than an isolated incident."
            ),
            supporting_event_ids=[e.event_id for e in evs],
            time_window_sec=span,
            first_timestamp=evs[0].timestamp,
            last_timestamp=evs[-1].timestamp,
            scenario=scenario,
            lens=lens,
            event_count=len(evs),
            score_trend=trend,
            peak_score=max(scores) if scores else None,
        ))
    return patterns


# Known precursor → consequence chains grounded in TRACE scenario catalog
_PRECURSOR_CHAINS: list[tuple[str, str, str]] = [
    # (precursor_scenario, consequence_scenario, description)
    (
        "dropping_or_throwing_precursor",
        "heavy_on_light_stacking",
        "Detected throw/drop behaviour preceding a structural stacking violation — "
        "unsupported package may have been displaced onto lighter cargo.",
    ),
    (
        "dragging_precursor",
        "wrong_product_orientation",
        "Dragging detected prior to an orientation conformance violation — "
        "friction-driven repositioning may have caused incorrect placement.",
    ),
    (
        "solo_heavy_handling",
        "dropping_or_throwing_precursor",
        "Solo heavy-item handling detected before a drop/throw precursor — "
        "fatigue or loss of grip during solo carry increases drop likelihood.",
    ),
    (
        "rolling_precursor",
        "entity_in_dock_edge_zone",
        "Rolling cargo detected before a dock-edge zone violation — "
        "uncontrolled rolling may propel item toward dock gap.",
    ),
    (
        "straps_as_handles",
        "dropping_or_throwing_precursor",
        "Strap-as-handle grip detected before drop precursor — "
        "strap failure mode produces sudden uncontrolled drop.",
    ),
]


def _detect_precursor_sequences(events: list[TemporalEvent], max_gap_sec: float = 30.0) -> list[TemporalPattern]:
    """Detects known precursor→consequence chains within a time window.

    Uses TRACE's canonical scenario catalog — only flags known chains,
    never fabricates a causal link that isn't in the catalog.
    """
    scenarios_by_ts: list[tuple[float, str, int]] = [
        (e.timestamp, e.scenario, e.event_id)
        for e in events if e.scenario
    ]
    patterns: list[TemporalPattern] = []

    for precursor_key, consequence_key, description in _PRECURSOR_CHAINS:
        precursors = [(ts, eid) for ts, s, eid in scenarios_by_ts if s == precursor_key]
        consequences = [(ts, eid) for ts, s, eid in scenarios_by_ts if s == consequence_key]

        for pre_ts, pre_eid in precursors:
            for con_ts, con_eid in consequences:
                if 0 < (con_ts - pre_ts) <= max_gap_sec:
                    span = con_ts - pre_ts
                    patterns.append(TemporalPattern(
                        pattern_type="precursor_sequence",
                        label="Precursor→Consequence Sequence",
                        description=description,
                        supporting_event_ids=[pre_eid, con_eid],
                        time_window_sec=span,
                        first_timestamp=pre_ts,
                        last_timestamp=con_ts,
                        scenario=f"{precursor_key}→{consequence_key}",
                        lens=None,
                        event_count=2,
                        score_trend="escalating",
                        peak_score=None,
                    ))
    return patterns


# ---------------------------------------------------------------------------
# Main public API
# ---------------------------------------------------------------------------

def analyse_temporal_sequence(
    conn: sqlite3.Connection,
    *,
    video_id: Optional[str] = None,
    scenario: Optional[str] = None,
    lens: Optional[str] = None,
    window_sec: float = 120.0,
    anchor_timestamp: Optional[float] = None,
    min_events: int = 2,
) -> TemporalSequenceResult:
    """Queries persisted events and identifies temporal patterns.

    Parameters
    ----------
    conn : sqlite3.Connection
    video_id : optional filter — only events for this video
    scenario : optional filter — only events for this scenario key
    lens : optional filter — only events for this lens
    window_sec : time window to analyse (seconds before anchor or latest event)
    anchor_timestamp : upper bound of the window; defaults to the latest event timestamp
    min_events : minimum events required before pattern analysis runs

    Returns
    -------
    TemporalSequenceResult with patterns list (empty if insufficient evidence).
    All patterns are INFERRED. Underlying events are OBSERVED.
    """
    cur = conn.cursor()

    clauses = []
    params: list[Any] = []

    if video_id:
        clauses.append("video_id = ?")
        params.append(video_id)
    if scenario:
        clauses.append("scenario = ?")
        params.append(scenario)
    if lens:
        clauses.append("lens = ?")
        params.append(lens)

    where = ("WHERE " + " AND ".join(clauses)) if clauses else ""
    cur.execute(
        f"SELECT event_id, timestamp, lens, scenario, score, band, confidence, "
        f"video_id, epistemic_level FROM events {where} ORDER BY timestamp ASC",
        params,
    )
    rows = cur.fetchall()

    if not rows:
        return TemporalSequenceResult(
            events_analysed=0,
            time_span_sec=0.0,
            patterns=[],
            insufficient_evidence=True,
            insufficient_evidence_reason="No events found matching the specified filters.",
        )

    # Apply time window
    anchor = anchor_timestamp
    if anchor is None:
        anchor = rows[-1][1]  # latest timestamp

    window_start = anchor - window_sec
    windowed = [
        TemporalEvent(
            event_id=row[0],
            timestamp=row[1],
            lens=row[2] or "",
            scenario=row[3],
            score=row[4],
            band=row[5],
            confidence=row[6],
            video_id=row[7],
            epistemic_level=row[8] or "INFERRED",
        )
        for row in rows
        if window_start <= row[1] <= anchor
    ]

    if len(windowed) < min_events:
        return TemporalSequenceResult(
            events_analysed=len(windowed),
            time_span_sec=0.0,
            patterns=[],
            insufficient_evidence=True,
            insufficient_evidence_reason=(
                f"Only {len(windowed)} event(s) in the {window_sec:.0f}s window — "
                f"minimum {min_events} required for temporal pattern analysis."
            ),
        )

    time_span = windowed[-1].timestamp - windowed[0].timestamp

    # Run all detectors
    patterns: list[TemporalPattern] = []
    patterns += _detect_repeated_behaviour(windowed)
    patterns += _detect_escalating_risk(windowed)
    patterns += _detect_precursor_sequences(windowed)

    # Deduplicate: same (pattern_type, event_set) → keep first
    seen: set[tuple] = set()
    unique_patterns: list[TemporalPattern] = []
    for p in patterns:
        key = (p.pattern_type, frozenset(p.supporting_event_ids))
        if key not in seen:
            seen.add(key)
            unique_patterns.append(p)

    return TemporalSequenceResult(
        events_analysed=len(windowed),
        time_span_sec=time_span,
        patterns=unique_patterns,
        insufficient_evidence=False,
        insufficient_evidence_reason=None,
    )
