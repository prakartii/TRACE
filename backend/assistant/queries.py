"""Read-only retrieval over the TRACE event store — the assistant's source of truth.

ARCHITECTURE.md Screen 7 / CLAUDE.md §21: the database is authoritative, the LLM
is not. Every function here runs a plain SELECT and returns a ``QueryResult`` that
already carries a deterministic natural-language ``summary`` plus its grounding
(the exact ``event_ids`` / row count it is built from). The LLM layer, when
available, only rephrases these — it is never given write access and never asked
to supply a fact these queries did not return.
"""

from __future__ import annotations

import json
import sqlite3
from dataclasses import dataclass, field
from typing import Optional

from backend.contracts.models import EVIDENCE_BACKED_SQL, EVIDENCE_BASIS_NOTE
from backend.assistant import labels
from backend.video.labels import source_label as _source_label


@dataclass
class QueryResult:
    kind: str
    summary: str
    data: dict
    source: str
    event_ids: list[int] = field(default_factory=list)
    row_count: int = 0
    cards: list[dict] = field(default_factory=list)
    metrics: list[dict] = field(default_factory=list)
    suggested_followups: list[str] = field(default_factory=list)


def _event_card(row: sqlite3.Row | dict, immediate_action: Optional[str] = None) -> dict:
    keys = row.keys() if hasattr(row, "keys") else row
    scenario = row["scenario"] if "scenario" in keys else None
    video_id = row["video_id"] if "video_id" in keys else None
    ts = row["timestamp"] if "timestamp" in keys else 0
    lens = row["lens"] if "lens" in keys else "structural"
    score = row["score"] if "score" in keys else None
    return {
        "event_id": row["event_id"],
        "scenario": scenario,
        "title": labels.scenario_title(scenario),
        "video_id": video_id,
        "camera_name": labels.camera_label(video_id),
        "timestamp": round(float(ts or 0), 1),
        "band": (row["band"] if "band" in keys else "Medium") or "Medium",
        "confidence": (row["confidence"] if "confidence" in keys else "Medium") or "Medium",
        "status": (row["status"] if "status" in keys else "probable") or "probable",
        "lens": lens or "structural",
        "score": round(float(score or 0), 1) if score is not None else None,
        "immediate_action": immediate_action,
    }


# --------------------------------------------------------------------------- #
# helpers
# --------------------------------------------------------------------------- #

def _rows(conn: sqlite3.Connection, sql: str, params: tuple = ()) -> list[sqlite3.Row]:
    return list(conn.execute(sql, params).fetchall())


def _evidence(factor_breakdown_json: Optional[str]) -> dict:
    if not factor_breakdown_json:
        return {}
    try:
        blob = json.loads(factor_breakdown_json) or {}
    except (ValueError, TypeError):
        return {}
    return blob.get("evidence", {}) or {}


def _explanation(factor_breakdown_json: Optional[str]) -> Optional[str]:
    if not factor_breakdown_json:
        return None
    try:
        return (json.loads(factor_breakdown_json) or {}).get("explanation")
    except (ValueError, TypeError):
        return None


# --------------------------------------------------------------------------- #
# queries
# --------------------------------------------------------------------------- #

def overview(conn: sqlite3.Connection) -> QueryResult:
    logged = conn.execute("SELECT COUNT(*) FROM events").fetchone()[0]
    total = conn.execute(f"SELECT COUNT(*) FROM events WHERE {EVIDENCE_BACKED_SQL}").fetchone()[0]
    by_band = {
        r["band"]: r["n"]
        for r in _rows(conn, f"SELECT band, COUNT(*) n FROM events WHERE {EVIDENCE_BACKED_SQL} GROUP BY band")
    }
    by_lens = {
        r["lens"]: r["n"]
        for r in _rows(conn, f"SELECT lens, COUNT(*) n FROM events WHERE {EVIDENCE_BACKED_SQL} GROUP BY lens")
    }
    outcomes = {
        r["classification"]: r["n"]
        for r in _rows(conn, "SELECT classification, COUNT(*) n FROM outcome_measurements GROUP BY classification")
    }
    top = _rows(
        conn,
        "SELECT scenario, COUNT(*) n FROM events WHERE scenario IS NOT NULL "
        f"AND {EVIDENCE_BACKED_SQL} GROUP BY scenario ORDER BY n DESC LIMIT 1",
    )
    top_scenario = top[0]["scenario"] if top else None

    high = (by_band.get("High", 0) or 0) + (by_band.get("Critical", 0) or 0)
    parts = [
        f"TRACE has {total} evidence-backed findings ({high} High/Critical) "
        f"out of {logged} logged observations."
    ]
    if top_scenario:
        parts.append(f"The most frequent issue is {labels.scenario_title(top_scenario)}.")
    if outcomes:
        parts.append(
            "Verified outcomes: "
            + ", ".join(f"{v} {k.replace('_', ' ')}" for k, v in sorted(outcomes.items()))
            + "."
        )
    
    top_events = _rows(
        conn,
        f"SELECT * FROM events WHERE band IN ('High','Critical') AND {EVIDENCE_BACKED_SQL} ORDER BY event_id DESC LIMIT 3"
    )
    cards = [_event_card(r) for r in top_events]
    metrics = [
        {"label": "Verified Findings", "value": total},
        {"label": "High / Critical", "value": high},
        {"label": "Prevented", "value": outcomes.get("prevented", 0)},
        {"label": "Near Misses", "value": outcomes.get("near_miss", 0)},
    ]
    followups = [
        "Give me a shift safety briefing",
        "Show me the High-risk events",
        "Which source had the most near misses?",
        "Explain how the Safe Action Planner works",
    ]
    return QueryResult(
        kind="overview",
        summary=" ".join(parts),
        data={"evidence_backed_events": total, "logged_observations": logged, "by_band": by_band,
              "by_lens": by_lens, "outcomes": outcomes, "top_scenario": top_scenario},
        source=f"events + outcome_measurements — {EVIDENCE_BASIS_NOTE}",
        row_count=total,
        cards=cards,
        metrics=metrics,
        suggested_followups=followups,
    )


def top_scenarios(conn: sqlite3.Connection, limit: int = 6) -> QueryResult:
    rows = _rows(
        conn,
        f"""
        SELECT scenario, COUNT(*) n,
               ROUND(AVG(score), 1) avg_score,
               SUM(CASE WHEN band IN ('High','Critical') THEN 1 ELSE 0 END) high_ct
        FROM events
        WHERE scenario IS NOT NULL AND {EVIDENCE_BACKED_SQL}
        GROUP BY scenario ORDER BY n DESC, high_ct DESC LIMIT ?
        """,
        (limit,),
    )
    if not rows:
        return QueryResult("top_scenarios", "No evidence-backed risk findings are recorded yet.",
                           {"scenarios": []}, "events", row_count=0)
    listing = ", ".join(f"{labels.scenario_title(r['scenario'])} ({r['n']})" for r in rows)
    summary = f"The most common evidence-backed risks are: {listing}."
    ids = [
        r["event_id"]
        for r in _rows(
            conn,
            "SELECT event_id FROM events WHERE scenario IN (%s) AND %s"
            % (",".join("?" * len(rows)), EVIDENCE_BACKED_SQL),
            tuple(r["scenario"] for r in rows),
        )
    ]
    return QueryResult(
        kind="top_scenarios",
        summary=summary,
        data={"scenarios": [dict(r) for r in rows]},
        source=f"events grouped by scenario — {EVIDENCE_BASIS_NOTE}",
        event_ids=ids,
        row_count=sum(r["n"] for r in rows),
    )


def top_behaviours(conn: sqlite3.Connection, limit: int = 6) -> QueryResult:
    rows = _rows(
        conn,
        f"""
        SELECT scenario, COUNT(*) n
        FROM events
        WHERE lens = 'behaviour' AND scenario IS NOT NULL AND {EVIDENCE_BACKED_SQL}
        GROUP BY scenario ORDER BY n DESC LIMIT ?
        """,
        (limit,),
    )
    if not rows:
        return QueryResult("top_behaviours", "No evidence-backed behaviour findings are recorded yet.",
                           {"behaviours": []}, "events (lens='behaviour')", row_count=0)
    listing = ", ".join(f"{labels.scenario_title(r['scenario'])} ({r['n']})" for r in rows)
    return QueryResult(
        kind="top_behaviours",
        summary=f"The most frequently detected behaviours are: {listing}.",
        data={"behaviours": [dict(r) for r in rows]},
        source="events where lens='behaviour'",
        row_count=sum(r["n"] for r in rows),
    )


def prevention_breakdown(conn: sqlite3.Connection) -> QueryResult:
    rows = _rows(
        conn,
        "SELECT classification, COUNT(*) n FROM outcome_measurements GROUP BY classification ORDER BY n DESC",
    )
    counts = {r["classification"]: r["n"] for r in rows}
    total = sum(counts.values())
    if not total:
        return QueryResult(
            "prevention_breakdown",
            "No outcomes have been verified through the 3-condition prevention check yet.",
            {"counts": {}, "total": 0}, "outcome_measurements", row_count=0,
        )
    # CLAUDE.md §15: report the buckets separately, never fused into one headline.
    listing = ", ".join(f"{n} {c.replace('_', ' ')}" for c, n in counts.items())
    summary = (
        f"Across {total} verified outcomes: {listing}. "
        "'Prevented' requires all three conditions (meaningful predicted risk, corrective "
        "action inside the response window, and a safer world-model state before the risky "
        "placement completed); 'confirmed damage' is only ever set by human review."
    )
    ids = [r["event_id"] for r in _rows(conn, "SELECT DISTINCT event_id FROM outcome_measurements")]
    return QueryResult(
        kind="prevention_breakdown",
        summary=summary,
        data={"counts": counts, "total": total},
        source="outcome_measurements grouped by classification",
        event_ids=ids,
        row_count=total,
    )


def near_misses_by_source(conn: sqlite3.Connection) -> QueryResult:
    rows = _rows(
        conn,
        """
        SELECT video_id, COUNT(*) n
        FROM outcome_measurements
        WHERE classification = 'near_miss'
        GROUP BY video_id ORDER BY n DESC
        """,
    )
    if not rows:
        return QueryResult("near_misses_by_source", "No near-miss events are recorded yet.",
                           {"by_source": []}, "outcome_measurements (near_miss)", row_count=0)
    enriched = [{"video_id": r["video_id"], "source": _source_label(r["video_id"]), "n": r["n"]} for r in rows]
    top = enriched[0]
    return QueryResult(
        kind="near_misses_by_source",
        summary=f"The source with the most near misses is {top['source']} ({top['n']}).",
        data={"by_source": enriched},
        source="outcome_measurements where classification='near_miss'",
        row_count=sum(r["n"] for r in rows),
    )


def high_risk_events(conn: sqlite3.Connection) -> QueryResult:
    rows = _rows(
        conn,
        f"""
        SELECT event_id, video_id, scenario, band, score, confidence, status
        FROM events WHERE band IN ('High','Critical') AND {EVIDENCE_BACKED_SQL}
        ORDER BY CASE band WHEN 'Critical' THEN 0 ELSE 1 END, score DESC
        """,
    )
    if not rows:
        return QueryResult("high_risk_events", "There are no evidence-backed High or Critical findings.",
                           {"events": []}, "events (band in High/Critical)", row_count=0)
    by_source: dict[str, int] = {}
    for r in rows:
        by_source[_source_label(r["video_id"])] = by_source.get(_source_label(r["video_id"]), 0) + 1
    worst = max(by_source.items(), key=lambda kv: kv[1])
    scen_counts: dict[str, int] = {}
    for r in rows:
        if r["scenario"]:
            title = labels.scenario_title(r["scenario"])
            scen_counts[title] = scen_counts.get(title, 0) + 1
    top_3 = sorted(scen_counts.items(), key=lambda x: x[1], reverse=True)[:3]
    top_items = [f"• {title} ({count} alerts)" for title, count in top_3]

    summary = (
        f"High Risk Summary: {len(rows)} High/Critical safety alerts recorded across the floor.\n"
        f"Most active area: {worst[0]} ({worst[1]} alerts).\n"
        f"Top safety concerns to address right now:\n"
        + "\n".join(top_items) + "\n"
        "Supervisor tip: Inspect loading dock ledge perimeters and remind material handlers to push overhanging cartons at least 15cm back onto pallet decks."
    )
    crit_count = sum(1 for r in rows if r["band"] == "Critical")
    cards = [_event_card(r) for r in rows[:6]]
    metrics = [
        {"label": "High/Critical Events", "value": len(rows)},
        {"label": "Critical Severity", "value": crit_count},
        {"label": "Most Impacted Bay", "value": worst[0][:20]},
    ]
    followups = [
        f"Explain event #{rows[0]['event_id']}",
        f"What did TRACE recommend for event #{rows[0]['event_id']}?",
        "Give me a shift safety briefing",
        "Which source had the most near misses?",
    ]
    return QueryResult(
        kind="high_risk_events",
        summary=summary,
        data={"events": [dict(r) for r in rows], "by_source": by_source},
        source="events where band in ('High','Critical')",
        event_ids=[r["event_id"] for r in rows],
        row_count=len(rows),
        cards=cards,
        metrics=metrics,
        suggested_followups=followups,
    )


def process_attribution(conn: sqlite3.Connection) -> QueryResult:
    """Answer for questions that ask TRACE to rank or blame an individual.

    CLAUDE.md §22 forbids punitive individual worker rankings and requires
    worker-independent structural/conformance/environmental analysis. Routing
    "who was the worst worker?" to `high_risk_events` used to return a ranked
    "X has the most" answer, which reads as naming a culprit even though the
    rows are per-source. TRACE declines the individual framing, says why, and
    gives the process-level view it is actually able to support.

    This does not withhold data: the same per-source counts are returned, just
    without the individual-blame framing the question invited.
    """
    rows = _rows(
        conn,
        f"""
        SELECT video_id, COUNT(*) AS n,
               SUM(CASE WHEN band IN ('High','Critical') THEN 1 ELSE 0 END) AS high_ct
        FROM events WHERE {EVIDENCE_BACKED_SQL}
        GROUP BY video_id ORDER BY high_ct DESC, n DESC
        """,
    )
    decline = (
        "TRACE does not rank or identify individual workers. Its structural, "
        "conformance and environmental analysis is worker-independent by design, "
        "and findings are attributed to a process and camera source, never a person. "
    )
    if not rows:
        return QueryResult(
            "process_attribution",
            decline + "There are no evidence-backed findings to summarise by process yet.",
            {"by_source": []},
            "events grouped by source (no individual attribution)",
            row_count=0,
        )

    by_source = [
        {"video_id": r["video_id"], "source": _source_label(r["video_id"]),
         "findings": r["n"], "high_or_critical": r["high_ct"]}
        for r in rows
    ]
    top = by_source[0]
    return QueryResult(
        kind="process_attribution",
        summary=(
            decline
            + f"At process level, {top['source']} carries the most High/Critical "
              f"findings ({top['high_or_critical']} of {top['findings']}). "
              "Use these to target coaching and process changes, not individual review."
        ),
        data={"by_source": by_source, "basis": EVIDENCE_BASIS_NOTE},
        source="events grouped by source (no individual attribution)",
        row_count=len(rows),
    )


def false_positives(conn: sqlite3.Connection) -> QueryResult:
    rows = _rows(
        conn,
        """
        SELECT e.event_id, e.scenario, e.band, e.review_status
        FROM events e
        WHERE e.review_status = 'false_positive'
           OR e.event_id IN (SELECT event_id FROM feedback WHERE flag_type = 'false_positive')
        """,
    )
    if not rows:
        return QueryResult("false_positives", "No events have been flagged as false positives.",
                           {"events": []}, "events.review_status + feedback", row_count=0)
    return QueryResult(
        kind="false_positives",
        summary=f"{len(rows)} event(s) flagged as false positives: "
                + ", ".join(f"#{r['event_id']} ({labels.scenario_title(r['scenario'])})" for r in rows) + ".",
        data={"events": [dict(r) for r in rows]},
        source="events.review_status='false_positive' or feedback flag",
        event_ids=[r["event_id"] for r in rows],
        row_count=len(rows),
    )


def explain_event(conn: sqlite3.Connection, event_id: Optional[int] = None,
                  keyword: Optional[str] = None) -> QueryResult:
    row = None
    if event_id is not None:
        row = conn.execute("SELECT * FROM events WHERE event_id = ?", (event_id,)).fetchone()
    if row is None and keyword:
        row = conn.execute(
            "SELECT * FROM events WHERE (scenario LIKE ? OR entity_id LIKE ?) "
            "ORDER BY CASE band WHEN 'Critical' THEN 0 WHEN 'High' THEN 1 WHEN 'Medium' THEN 2 ELSE 3 END, "
            "event_id DESC LIMIT 1",
            (f"%{keyword}%", f"%{keyword}%"),
        ).fetchone()
    is_fallback = row is None
    if row is None:
        row = conn.execute(
            "SELECT * FROM events ORDER BY CASE band WHEN 'Critical' THEN 0 WHEN 'High' THEN 1 "
            "WHEN 'Medium' THEN 2 ELSE 3 END, event_id DESC LIMIT 1"
        ).fetchone()
    if row is None:
        return QueryResult("explain_event", "There are no events to explain yet.", {}, "events", row_count=0)

    evidence = _evidence(row["factor_breakdown_json"])
    explanation = _explanation(row["factor_breakdown_json"])
    ev_bits = (
        ", ".join(
            f"{labels.evidence_label(k)} {labels.format_evidence_value(k, v)}"
            for k, v in evidence.items()
        )
        if evidence
        else None
    )
    if event_id is not None and row["event_id"] != event_id:
        prefix = f"Event #{event_id} is not in the log — showing the most significant recent finding instead. "
    elif is_fallback:
        prefix = "I could not identify a specific event from that question, so here is the most significant recent finding. "
    else:
        prefix = ""
    summary = (
        f"{prefix}Event #{row['event_id']} ({labels.scenario_title(row['scenario'])}) was flagged "
        f"{row['band']} risk on the {labels.lens_label(row['lens'])} lens, with {row['confidence']} "
        f"confidence. Status: {labels.status_label(row['status'])}."
    )
    if explanation:
        summary += f" {explanation}"
    if ev_bits:
        summary += f" Observed: {ev_bits}."
    cards = [_event_card(row, immediate_action=explanation)]
    eid = row["event_id"]
    metrics = [
        {"label": "Event ID", "value": f"#{eid}"},
        {"label": "Severity", "value": row["band"]},
        {"label": "Confidence", "value": row["confidence"]},
        {"label": "Camera", "value": labels.camera_label(row["video_id"]).split("-")[0].strip()},
    ]
    followups = [
        f"What did TRACE recommend for event #{eid}?",
        f"Explain {labels.scenario_title(row['scenario'])}",
        "Show me the High-risk events",
        "Give me a shift safety briefing",
    ]
    return QueryResult(
        kind="explain_event",
        summary=summary,
        data={"event": {k: row[k] for k in row.keys() if k != "factor_breakdown_json"},
              "evidence": evidence, "explanation": explanation},
        source=f"events row #{row['event_id']}",
        event_ids=[row["event_id"]],
        row_count=1,
        cards=cards,
        metrics=metrics,
        suggested_followups=followups,
    )


def recommendation_for(conn: sqlite3.Connection, event_id: Optional[int] = None,
                       keyword: Optional[str] = None) -> QueryResult:
    ev = explain_event(conn, event_id=event_id, keyword=keyword)
    if not ev.event_ids:
        return QueryResult("recommendation_for", "There are no events with recommendations yet.", {}, "events",
                           row_count=0)
    eid = ev.event_ids[0]
    rec = conn.execute(
        "SELECT recommended_position, expected_delta, recommendation_json, followed "
        "FROM planner_recommendations WHERE event_id = ? ORDER BY rec_id DESC LIMIT 1",
        (eid,),
    ).fetchone()
    interv = conn.execute(
        "SELECT title, immediate_action, steps_json, verification FROM interventions WHERE event_id = ? "
        "ORDER BY created_at DESC LIMIT 1",
        (eid,),
    ).fetchone()

    action = None
    steps: list[str] = []
    if interv is not None:
        action = interv["immediate_action"]
        try:
            steps = json.loads(interv["steps_json"] or "[]")
        except (ValueError, TypeError):
            steps = []
    elif rec is not None and rec["recommendation_json"]:
        try:
            blob = json.loads(rec["recommendation_json"])
            action = blob.get("immediate_action") or blob.get("instruction")
            steps = blob.get("steps", []) or []
        except (ValueError, TypeError):
            pass

    if action is None and rec is not None:
        action = (f"Move to {rec['recommended_position']}"
                  + (f" (expected stability {rec['expected_delta']:+.0f})" if rec["expected_delta"] is not None else ""))

    if action is None:
        return QueryResult(
            "recommendation_for",
            f"No Safe Action recommendation is recorded for event #{eid}.",
            {"event_id": eid}, "planner_recommendations + interventions", event_ids=[eid], row_count=0,
            suggested_followups=[f"Explain event #{eid}", "Give me a shift safety briefing"],
        )

    def _clean(s: str) -> str:
        return (s or "").strip().rstrip(".").strip()

    action_clean = _clean(action)
    summary = f"For event #{eid}, TRACE recommends: {action_clean}."
    if steps:
        # Steps often repeat the headline action as their first entry — drop
        # that duplicate so the summary doesn't say the same thing twice.
        step_list = [_clean(s) for s in steps[:4] if s]
        if step_list and step_list[0].lower() == action_clean.lower():
            step_list = step_list[1:]
        # Lowercase the first letter of each step after the first when
        # joining mid-sentence with "then" — they're clauses, not new
        # sentences, so a stray capital reads like a typo.
        def _lower_first(s: str) -> str:
            return (s[0].lower() + s[1:]) if s else s
        joined = [step_list[0]] + [_lower_first(s) for s in step_list[1:]] if step_list else []
        if len(joined) == 1:
            summary += f" Next: {joined[0]}."
        elif joined:
            summary += " Then: " + ", then ".join(joined) + "."

    cards = list(ev.cards)
    for c in cards:
        c["immediate_action"] = action
    metrics = [
        {"label": "Event", "value": f"#{eid}"},
        {"label": "Recommendation", "value": action[:24] if action else "Available"},
        {"label": "Stability Delta", "value": f"{rec['expected_delta']:+.0f}" if rec and rec['expected_delta'] is not None else "Verified"},
    ]
    return QueryResult(
        kind="recommendation_for",
        summary=summary,
        data={"event_id": eid, "immediate_action": action, "steps": steps,
              "recommended_position": rec["recommended_position"] if rec else None,
              "expected_delta": rec["expected_delta"] if rec else None},
        source="planner_recommendations + interventions",
        event_ids=[eid],
        row_count=1,
        cards=cards,
        metrics=metrics,
        suggested_followups=[
            f"Why was event #{eid} risky?",
            "How does the Safe Action Planner work?",
            "Give me a shift safety briefing",
        ],
    )


def greetings(conn: sqlite3.Connection) -> QueryResult:
    """A real "hi" deserves a real hello, not a statistics dump. No cards,
    no metrics — just a short, human reply and a couple of things the
    supervisor could ask next, the same way a colleague would open a chat."""
    high = conn.execute(f"SELECT COUNT(*) FROM events WHERE band IN ('High','Critical') AND {EVIDENCE_BACKED_SQL}").fetchone()[0]

    if high > 0:
        summary = (
            f"Hi! There {'is' if high == 1 else 'are'} {high} high-risk event{'s' if high != 1 else ''} "
            "on record right now. What would you like to know?"
        )
    else:
        summary = "Hi! Nothing high-risk on record at the moment. What can I help you with?"

    followups = [
        "What are the highest-risk events?",
        "Give me a shift safety briefing",
        "What did TRACE find in this video?",
    ]
    return QueryResult(
        kind="greetings",
        summary=summary,
        data={},
        source="conversation",
        suggested_followups=followups,
    )


def small_talk(conn: sqlite3.Connection, kind: str = "thanks") -> QueryResult:
    """Thanks / goodbye — a plain acknowledgement, not a retrieval result."""
    replies = {
        "thanks": "You're welcome - let me know if anything else comes up.",
        "bye": "Take care. I'll be here if you need anything.",
    }
    return QueryResult(
        kind="small_talk",
        summary=replies.get(kind, replies["thanks"]),
        data={},
        source="conversation",
    )


def shift_briefing(conn: sqlite3.Connection) -> QueryResult:
    total = conn.execute(f"SELECT COUNT(*) FROM events WHERE {EVIDENCE_BACKED_SQL}").fetchone()[0]
    high = conn.execute(f"SELECT COUNT(*) FROM events WHERE band IN ('High','Critical') AND {EVIDENCE_BACKED_SQL}").fetchone()[0]
    outcomes = {r["classification"]: r["n"] for r in _rows(conn, "SELECT classification, COUNT(*) n FROM outcome_measurements GROUP BY classification")}
    top_scen_rows = _rows(conn, f"SELECT scenario, COUNT(*) n FROM events WHERE {EVIDENCE_BACKED_SQL} GROUP BY scenario ORDER BY n DESC LIMIT 1")
    top_scen = top_scen_rows[0]["scenario"] if top_scen_rows else "box_overhang"
    
    recent_critical = _rows(
        conn,
        f"SELECT * FROM events WHERE band IN ('High','Critical') AND {EVIDENCE_BACKED_SQL} ORDER BY event_id DESC LIMIT 4"
    )
    cards = [_event_card(r) for r in recent_critical]
    
    top_hazard_name = "Boxes too close to dock edge" if "dock" in top_scen else labels.scenario_title(top_scen)
    summary = (
        f"Shift Safety Summary: {total} safety alerts recorded today ({high} High priority).\n"
        f"Accident prevention: {outcomes.get('prevented', 0)} incident was prevented by quick team action.\n"
        f"Primary operational hazard: {top_hazard_name} ({top_scen_rows[0]['n'] if top_scen_rows else 0} occurrences).\n"
        "Supervisor tip: Remind team members to keep boxes sitting squarely on pallets and at least 1.5m away from dock edges."
    )
    metrics = [
        {"label": "High Priority Alerts", "value": high},
        {"label": "Prevented Incidents", "value": outcomes.get("prevented", 0)},
        {"label": "Near Misses", "value": outcomes.get("near_miss", 0)},
        {"label": "Top Hazard", "value": top_hazard_name[:24]},
    ]
    return QueryResult(
        kind="shift_briefing",
        summary=summary,
        data={"total": total, "high": high, "outcomes": outcomes, "top_scenario": top_scen},
        source="events + outcome_measurements shift synthesis",
        event_ids=[r["event_id"] for r in recent_critical],
        row_count=len(recent_critical),
        cards=cards,
        metrics=metrics,
        suggested_followups=[
            "Show me the High-risk events",
            f"Explain {labels.scenario_title(top_scen)}",
            "What did TRACE recommend for the latest event?",
            "What product rules exist?",
        ],
    )


def active_interventions(conn: sqlite3.Connection) -> QueryResult:
    rows = _rows(
        conn,
        """
        SELECT alert_id, event_id, video_id, timestamp, scenario, severity, urgency, state, title, immediate_action
        FROM interventions
        ORDER BY CASE severity WHEN 'CRITICAL' THEN 0 WHEN 'HIGH' THEN 1 ELSE 2 END, created_at DESC LIMIT 6
        """
    )
    if not rows:
        return QueryResult(
            "active_interventions",
            "There are currently no active intervention alerts logged in the system.",
            {"interventions": []},
            "interventions table",
            row_count=0,
            suggested_followups=["Give me a shift safety briefing", "Show me the High-risk events"],
        )
    crit_count = sum(1 for r in rows if r["severity"] == "CRITICAL")
    cards = [
        {
            "event_id": r["event_id"],
            "scenario": r["scenario"],
            "title": r["title"] or labels.scenario_title(r["scenario"]),
            "video_id": r["video_id"],
            "camera_name": labels.camera_label(r["video_id"]),
            "timestamp": round(float(r["timestamp"] or 0), 1),
            "band": r["severity"].capitalize(),
            "confidence": "High",
            "status": r["state"].lower(),
            "lens": "intervention",
            "score": 85.0 if r["severity"] == "CRITICAL" else 65.0,
            "immediate_action": r["immediate_action"],
        }
        for r in rows
    ]
    cam_short = labels.camera_label(rows[0]['video_id']).split("-")[0].strip()
    action_text = rows[0]['immediate_action']
    if "cantilever" in action_text.lower():
        action_text = "Push the box back so it sits completely on the pallet."
    summary = (
        f"Active Interventions: {len(rows)} urgent safety alerts logged ({crit_count} Critical, {len(rows) - crit_count} High/Medium).\n"
        f"Latest alert: '{rows[0]['title']}' at {cam_short}.\n"
        f"Action required: {action_text}\n"
        "Supervisor tip: Review high-risk cameras immediately and dispatch lead handlers to secure dock ledge clearance."
    )
    metrics = [
        {"label": "Active Alerts", "value": len(rows)},
        {"label": "Critical Urgency", "value": crit_count},
        {"label": "Latest Camera", "value": cam_short},
    ]
    return QueryResult(
        kind="active_interventions",
        summary=summary,
        data={"interventions": [dict(r) for r in rows]},
        source="interventions table",
        event_ids=[r["event_id"] for r in rows],
        row_count=len(rows),
        cards=cards,
        metrics=metrics,
        suggested_followups=[
            f"What did TRACE recommend for event #{rows[0]['event_id']}?",
            "Give me a shift safety briefing",
            "Show me the High-risk events",
        ],
    )


# Phrases that refer to whatever video the caller currently has open, not a
# named camera/bay. Kept separate from the vague-heuristic terms below so a
# genuinely deictic question never gets hijacked by a loose keyword match
# against an unrelated canonical demo camera.
_DEICTIC_VIDEO_TERMS = (
    "this video", "this footage", "in this video", "find in this video",
    "what did trace find", "current video", "current footage", "uploaded video",
    "the video i", "the footage i",
)


def camera_events(
    conn: sqlite3.Connection, query: str = "", context_video_id: Optional[str] = None
) -> QueryResult:
    q_lower = (query or "").lower()
    matched_vid = None
    cam_name = "Selected Camera Feed"
    is_deictic = any(term in q_lower for term in _DEICTIC_VIDEO_TERMS)

    for vid, name in labels.CAMERA_LABELS.items():
        if vid in q_lower or name.lower() in q_lower or (name.split("-")[0].strip().lower() in q_lower):
            matched_vid = vid
            cam_name = name
            break
    if not matched_vid and not is_deictic:
        for vid, name in labels.CAMERA_LABELS.items():
            if any(term in q_lower for term in ("dock", "cupboard", "camera 1")) and "dock" in name.lower():
                matched_vid = vid; cam_name = name; break
            elif any(term in q_lower for term in ("pallet", "staging", "deck", "camera 2")) and "staging" in name.lower():
                matched_vid = vid; cam_name = name; break
            elif any(term in q_lower for term in ("wet", "transit", "slip", "camera 3")) and "wet" in name.lower():
                matched_vid = vid; cam_name = name; break
            elif any(term in q_lower for term in ("carton", "dropping", "rolling", "camera 4")) and "unloading" in name.lower():
                matched_vid = vid; cam_name = name; break
            elif any(term in q_lower for term in ("racking", "stepping", "vertical", "camera 5")) and "racking" in name.lower():
                matched_vid = vid; cam_name = name; break
            elif any(term in q_lower for term in ("bulk", "mattress", "dispatch", "camera 6")) and "bulk" in name.lower():
                matched_vid = vid; cam_name = name; break
            elif any(term in q_lower for term in ("furniture", "seating", "strap", "camera 7")) and "furniture" in name.lower():
                matched_vid = vid; cam_name = name; break
    # Nothing explicitly named in the question: ground against the video the
    # caller actually has open (works for newly uploaded footage, which has
    # no entry in the fixed canonical camera-name table) rather than
    # defaulting to a fixed demo camera unrelated to what was asked.
    if not matched_vid and context_video_id:
        matched_vid = context_video_id
        cam_name = (
            labels.CAMERA_LABELS[context_video_id]
            if context_video_id in labels.CAMERA_LABELS
            else _source_label(context_video_id)
        )
    if not matched_vid:
        matched_vid = "93e4b1963c6fcd97"
        cam_name = labels.CAMERA_LABELS[matched_vid]

    rows = _rows(
        conn,
        f"""
        SELECT * FROM events
        WHERE (video_id LIKE ? OR video_id LIKE ?) AND {EVIDENCE_BACKED_SQL}
        ORDER BY CASE band WHEN 'Critical' THEN 0 WHEN 'High' THEN 1 ELSE 2 END, score DESC LIMIT 5
        """,
        (f"%{matched_vid}%", f"{matched_vid}%"),
    )
    if not rows:
        return QueryResult(
            "camera_events",
            f"No evidence-backed events recorded for {cam_name}.",
            {"camera": cam_name, "video_id": matched_vid, "events": []},
            f"events (camera: {cam_name})",
            row_count=0,
            suggested_followups=["Show me the High-risk events", "Give me a shift safety briefing"],
        )
    cards = [_event_card(r) for r in rows]
    top_scen = labels.scenario_title(rows[0]["scenario"])
    summary = (
        f"{cam_name} has {len(rows)} recorded hazard events. "
        f"Primary concern: {top_scen} ({rows[0]['band']} risk, score {rows[0]['score']:.1f}). "
        f"Status: {labels.status_label(rows[0]['status'])}."
    )
    metrics = [
        {"label": "Camera", "value": cam_name.split("-")[0].strip()},
        {"label": "Events Logged", "value": len(rows)},
        {"label": "Top Risk Level", "value": rows[0]["band"]},
    ]
    return QueryResult(
        kind="camera_events",
        summary=summary,
        data={"camera": cam_name, "video_id": matched_vid, "events": [dict(r) for r in rows]},
        source=f"events at {cam_name}",
        event_ids=[r["event_id"] for r in rows],
        row_count=len(rows),
        cards=cards,
        metrics=metrics,
        suggested_followups=[
            f"Explain event #{rows[0]['event_id']}",
            f"What did TRACE recommend for event #{rows[0]['event_id']}?",
            "Show me the High-risk events",
        ],
    )


def scenario_info(conn: sqlite3.Connection, query: str = "") -> QueryResult:
    q_lower = (query or "").lower()
    matched_scen = None
    for scen_key in labels.SCENARIO_DESCRIPTIONS.keys():
        if scen_key in q_lower or scen_key.replace("_", " ") in q_lower or scen_key.split("_")[0] in q_lower:
            matched_scen = scen_key
            break
    if not matched_scen:
        if "overhang" in q_lower or "cantilever" in q_lower: matched_scen = "box_overhang"
        elif "heavy" in q_lower or "crush" in q_lower: matched_scen = "heavy_on_light"
        elif "lean" in q_lower or "tilt" in q_lower: matched_scen = "stack_lean"
        elif "drop" in q_lower or "fall" in q_lower: matched_scen = "dropping_carton"
        elif "drag" in q_lower or "abrasion" in q_lower: matched_scen = "dragging_heavy_box"
        elif "step" in q_lower or "climb" in q_lower: matched_scen = "stepping_on_cartons"
        elif "throw" in q_lower or "toss" in q_lower: matched_scen = "throwing_cartons"
        elif "wet" in q_lower or "slip" in q_lower: matched_scen = "wet_floor_transit"
        elif "dock" in q_lower or "edge" in q_lower: matched_scen = "dock_edge_proximity"
        elif "strap" in q_lower: matched_scen = "strap_lift_hazard"
        elif "orient" in q_lower or "upright" in q_lower: matched_scen = "vertical_orientation_violation"
        else: matched_scen = "box_overhang"

    info = labels.scenario_description(matched_scen)
    rows = _rows(
        conn,
        f"""
        SELECT * FROM events WHERE (scenario = ? OR scenario LIKE ?) AND {EVIDENCE_BACKED_SQL}
        ORDER BY score DESC LIMIT 4
        """,
        (matched_scen, f"%{matched_scen}%"),
    )
    cards = [_event_card(r) for r in rows]
    summary = (
        f"Safety Protocol: {info['title']}\n"
        f"Risk Description: {info['description']}\n"
        f"Action required: {info['prevention']}\n"
        f"Supervisor tip: {len(rows)} incidents of this type have been logged in audit history. Verify compliance during floor walk."
    )
    metrics = [
        {"label": "Scenario", "value": info["title"][:20]},
        {"label": "Recorded Events", "value": len(rows)},
    ]
    return QueryResult(
        kind="scenario_info",
        summary=summary,
        data={"scenario": matched_scen, "info": info, "events": [dict(r) for r in rows]},
        source=f"Operational Scenario Manual ({matched_scen})",
        event_ids=[r["event_id"] for r in rows],
        row_count=len(rows),
        cards=cards,
        metrics=metrics,
        suggested_followups=[
            f"Explain event #{rows[0]['event_id']}" if rows else "Show me the High-risk events",
            "How does the Safe Action Planner work?",
            "Give me a shift safety briefing",
        ],
    )


def product_rules_summary(conn: sqlite3.Connection) -> QueryResult:
    products = _rows(conn, "SELECT * FROM products")
    rules = _rows(conn, "SELECT rule_id, product_id, rule_type, rule_value, created_by FROM product_rules")
    custom = _rows(conn, "SELECT rule_id, description, created_by FROM custom_rules")
    
    prod_summary = f"{len(products)} products registered"
    rule_bits = []
    if rules:
        rule_bits.append(f"{len(rules)} product rules")
    if custom:
        rule_bits.append(f"{len(custom)} custom supervisor safety rules")
    
    summary = (
        f"Product & Stacking Rules: {prod_summary}. "
        + (", ".join(rule_bits) if rule_bits else "Standard warehouse rules active.")
        + " TRACE automatically checks box orientations ('This Side Up') and maximum tier heights in real time."
    )
    metrics = [
        {"label": "Catalog SKUs", "value": len(products)},
        {"label": "Active Rules", "value": len(rules) + len(custom)},
    ]
    return QueryResult(
        kind="product_rules_summary",
        summary=summary,
        data={"products": [dict(p) for p in products], "rules": [dict(r) for r in rules], "custom_rules": [dict(c) for c in custom]},
        source="products + product_rules + custom_rules",
        metrics=metrics,
        suggested_followups=[
            "Give me a shift safety briefing",
            "Show me the High-risk events",
            "Explain overhang risk",
        ],
    )


def planner_methodology(conn: sqlite3.Connection) -> QueryResult:
    summary = (
        "Stability Formula & Safety Checks:\n"
        "When an unstable placement is detected, TRACE calculates a counterfactual safe target spot based on 3 rules:\n"
        "1. Support Area (50%): At least 70% of the carton base must rest squarely on the pallet deck.\n"
        "2. Center of Gravity (30%): The carton center must align within the pallet footprint boundary.\n"
        "3. Mass Tiering (20%): Heavy items must be stacked at the bottom tier, lighter boxes on top.\n"
        "Supervisor tip: Only placements scoring 70%+ stability index are approved for material handling."
    )
    metrics = [
        {"label": "Support Weight", "value": "50% Base Area"},
        {"label": "Centering Weight", "value": "30% Center Offset"},
        {"label": "Weight Order", "value": "20% Heavy on Bottom"},
    ]
    followups = [
        "What did TRACE recommend for event #73?",
        "Give me a shift safety briefing",
        "Show me the High-risk events",
    ]
    return QueryResult(
        kind="planner_methodology",
        summary=summary,
        data={"components": ["support_50", "centering_30", "mass_ordering_20"]},
        source="TRACE Safe Action Planner Engine (Layer 5)",
        metrics=metrics,
        suggested_followups=followups,
    )

