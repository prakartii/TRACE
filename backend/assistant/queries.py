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

from backend.video.labels import source_label as _source_label


@dataclass
class QueryResult:
    kind: str
    summary: str
    data: dict
    source: str
    event_ids: list[int] = field(default_factory=list)
    row_count: int = 0


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
    total = conn.execute("SELECT COUNT(*) FROM events").fetchone()[0]
    by_band = {r["band"]: r["n"] for r in _rows(conn, "SELECT band, COUNT(*) n FROM events GROUP BY band")}
    by_lens = {r["lens"]: r["n"] for r in _rows(conn, "SELECT lens, COUNT(*) n FROM events GROUP BY lens")}
    outcomes = {
        r["classification"]: r["n"]
        for r in _rows(conn, "SELECT classification, COUNT(*) n FROM outcome_measurements GROUP BY classification")
    }
    top = _rows(
        conn,
        "SELECT scenario, COUNT(*) n FROM events WHERE scenario IS NOT NULL GROUP BY scenario ORDER BY n DESC LIMIT 1",
    )
    top_scenario = top[0]["scenario"] if top else None

    high = (by_band.get("High", 0) or 0) + (by_band.get("Critical", 0) or 0)
    parts = [f"TRACE has {total} logged events ({high} High/Critical)."]
    if top_scenario:
        parts.append(f"The most frequent scenario is '{top_scenario}'.")
    if outcomes:
        parts.append(
            "Verified outcomes: "
            + ", ".join(f"{v} {k.replace('_', ' ')}" for k, v in sorted(outcomes.items()))
            + "."
        )
    return QueryResult(
        kind="overview",
        summary=" ".join(parts),
        data={"total_events": total, "by_band": by_band, "by_lens": by_lens, "outcomes": outcomes,
              "top_scenario": top_scenario},
        source="events + outcome_measurements",
        row_count=total,
    )


def top_scenarios(conn: sqlite3.Connection, limit: int = 6) -> QueryResult:
    rows = _rows(
        conn,
        """
        SELECT scenario, COUNT(*) n,
               ROUND(AVG(score), 1) avg_score,
               SUM(CASE WHEN band IN ('High','Critical') THEN 1 ELSE 0 END) high_ct
        FROM events
        WHERE scenario IS NOT NULL
        GROUP BY scenario ORDER BY n DESC, high_ct DESC LIMIT ?
        """,
        (limit,),
    )
    if not rows:
        return QueryResult("top_scenarios", "No risk events are recorded yet.", {"scenarios": []},
                           "events", row_count=0)
    listing = ", ".join(f"{r['scenario']} ({r['n']})" for r in rows)
    summary = f"The most common risks in the log are: {listing}."
    ids = [r["event_id"] for r in _rows(conn, "SELECT event_id FROM events WHERE scenario IN (%s)"
                                        % ",".join("?" * len(rows)), tuple(r["scenario"] for r in rows))]
    return QueryResult(
        kind="top_scenarios",
        summary=summary,
        data={"scenarios": [dict(r) for r in rows]},
        source="events grouped by scenario",
        event_ids=ids,
        row_count=sum(r["n"] for r in rows),
    )


def top_behaviours(conn: sqlite3.Connection, limit: int = 6) -> QueryResult:
    rows = _rows(
        conn,
        """
        SELECT scenario, COUNT(*) n
        FROM events
        WHERE lens = 'behaviour' AND scenario IS NOT NULL
        GROUP BY scenario ORDER BY n DESC LIMIT ?
        """,
        (limit,),
    )
    if not rows:
        return QueryResult("top_behaviours", "No behaviour-lens events are recorded yet.",
                           {"behaviours": []}, "events (lens='behaviour')", row_count=0)
    listing = ", ".join(f"{r['scenario']} ({r['n']})" for r in rows)
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
        """
        SELECT event_id, video_id, scenario, band, score, confidence, status
        FROM events WHERE band IN ('High','Critical')
        ORDER BY CASE band WHEN 'Critical' THEN 0 ELSE 1 END, score DESC
        """,
    )
    if not rows:
        return QueryResult("high_risk_events", "There are no High or Critical risk events in the log.",
                           {"events": []}, "events (band in High/Critical)", row_count=0)
    by_source: dict[str, int] = {}
    for r in rows:
        by_source[_source_label(r["video_id"])] = by_source.get(_source_label(r["video_id"]), 0) + 1
    worst = max(by_source.items(), key=lambda kv: kv[1])
    summary = (
        f"{len(rows)} High/Critical events are logged. "
        f"{worst[0]} has the most ({worst[1]}). "
        f"Top scenarios: {', '.join(sorted({r['scenario'] for r in rows if r['scenario']}))}."
    )
    return QueryResult(
        kind="high_risk_events",
        summary=summary,
        data={"events": [dict(r) for r in rows], "by_source": by_source},
        source="events where band in ('High','Critical')",
        event_ids=[r["event_id"] for r in rows],
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
                + ", ".join(f"#{r['event_id']} ({r['scenario']})" for r in rows) + ".",
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
    ev_bits = ", ".join(f"{k}={v}" for k, v in evidence.items()) if evidence else None
    if event_id is not None and row["event_id"] != event_id:
        prefix = f"Event #{event_id} is not in the log — showing the most significant recent finding instead. "
    elif is_fallback:
        prefix = "I could not identify a specific event from that question, so here is the most significant recent finding. "
    else:
        prefix = ""
    summary = (
        f"{prefix}Event #{row['event_id']} ({row['scenario']}, {row['lens']} lens) was flagged {row['band']} risk "
        f"with {row['confidence']} confidence; evidence status: {row['status']}."
    )
    if explanation:
        summary += f" {explanation}"
    if ev_bits:
        summary += f" Recorded evidence: {ev_bits}."
    return QueryResult(
        kind="explain_event",
        summary=summary,
        data={"event": {k: row[k] for k in row.keys() if k != "factor_breakdown_json"},
              "evidence": evidence, "explanation": explanation},
        source=f"events row #{row['event_id']}",
        event_ids=[row["event_id"]],
        row_count=1,
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
        )

    summary = f"For event #{eid} TRACE recommended: {action}"
    if steps:
        summary += " Steps: " + "; ".join(steps[:4]) + "."
    return QueryResult(
        kind="recommendation_for",
        summary=summary,
        data={"event_id": eid, "immediate_action": action, "steps": steps,
              "recommended_position": rec["recommended_position"] if rec else None,
              "expected_delta": rec["expected_delta"] if rec else None},
        source="planner_recommendations + interventions",
        event_ids=[eid],
        row_count=1,
    )
