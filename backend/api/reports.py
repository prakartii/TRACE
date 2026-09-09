"""Incident report export (GEG bonus — automatic incident reports).

- GET /api/reports/incidents.csv      : one row per logged event (CSV download)
- GET /api/reports/shift-summary      : structured shift report (JSON)
- GET /api/reports/shift-summary.md   : the same, as a printable Markdown file

Every figure is a straight read/aggregation of the event store. Prevention
counters stay in their four separate buckets (CLAUDE.md §15); scorecards are
per source / process, never per worker (§22).
"""

from __future__ import annotations

import csv
import io
import sqlite3
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, Query
from fastapi.responses import Response

from backend.contracts.models import EVIDENCE_BACKED_STATUSES, EVIDENCE_BASIS_NOTE
from backend.db.db import get_db
from backend.db.events import query_events
from backend.db.outcomes import get_prevention_summary
from backend.learning import patterns as learn
from backend.video.labels import source_label

router = APIRouter(prefix="/api/reports", tags=["reports"])

_CSV_COLUMNS = [
    "event_id", "source", "video_id", "timestamp_s", "scenario", "lens", "band",
    "confidence", "epistemic_level", "status", "reviewed", "review_status",
    "recommended_action", "outcome_classification", "explanation",
]


def _now_stamp() -> str:
    return datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%SZ")


@router.get("/incidents.csv")
def incidents_csv(
    video_id: str | None = Query(None),
    lens: str | None = Query(None),
    band: str | None = Query(None),
    status: str | None = Query(None),
    # The Event Feed's review-state filter counts toward its "export CSV
    # (filtered)" label, so the export has to honour it too — without these the
    # download silently contained every event while claiming to be filtered.
    reviewed: bool | None = Query(None),
    review_status: str | None = Query(None),
    limit: int = Query(1000, ge=1, le=10000),
    db: sqlite3.Connection = Depends(get_db),
) -> Response:
    events = query_events(
        db, video_id=video_id, lens=lens, band=band, status=status,
        reviewed=reviewed, review_status=review_status, limit=limit, order="asc",
    )
    # event_id -> latest classification (rows ordered by outcome_id, last wins)
    outcomes = {
        r["event_id"]: r["classification"]
        for r in db.execute(
            "SELECT event_id, classification FROM outcome_measurements ORDER BY outcome_id"
        ).fetchall()
    }
    buf = io.StringIO()
    w = csv.DictWriter(buf, fieldnames=_CSV_COLUMNS, extrasaction="ignore")
    w.writeheader()
    for e in events:
        action = e.recommended_action or (
            e.planner_recommendation.action if e.planner_recommendation else None
        )
        w.writerow({
            "event_id": e.event_id,
            "source": source_label(e.video_id),
            "video_id": e.video_id or "",
            "timestamp_s": round(e.timestamp, 2),
            "scenario": e.scenario or "",
            "lens": e.lens.value if hasattr(e.lens, "value") else e.lens,
            "band": e.band.value if (e.band and hasattr(e.band, "value")) else (e.band or ""),
            "confidence": e.confidence.value if hasattr(e.confidence, "value") else e.confidence,
            "epistemic_level": e.epistemic_level.value if hasattr(e.epistemic_level, "value") else e.epistemic_level,
            "status": e.status.value if hasattr(e.status, "value") else e.status,
            "reviewed": "yes" if e.reviewed else "no",
            "review_status": e.review_status or "",
            "recommended_action": action or "",
            "outcome_classification": outcomes.get(e.event_id, ""),
            "explanation": (e.explanation or "").replace("\n", " ").strip(),
        })
    return Response(
        content=buf.getvalue(),
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="trace-incidents-{_now_stamp()}.csv"'},
    )


def _summary(db: sqlite3.Connection) -> dict:
    events = query_events(db, limit=10000, order="asc")
    backed = [
        e
        for e in events
        if (e.status.value if hasattr(e.status, "value") else e.status) in EVIDENCE_BACKED_STATUSES
    ]
    by_band: dict[str, int] = {}
    by_lens: dict[str, int] = {}
    for e in backed:
        b = e.band.value if (e.band and hasattr(e.band, "value")) else (e.band or "unspecified")
        ln = e.lens.value if hasattr(e.lens, "value") else str(e.lens)
        by_band[b] = by_band.get(b, 0) + 1
        by_lens[ln] = by_lens.get(ln, 0) + 1

    prev = get_prevention_summary(db)
    return {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "window": "all logged events (demo dataset)",
        "totals": {
            "evidence_backed_findings": len(backed),
            "logged_observations": len(events),
            "high_or_critical": (by_band.get("High", 0) + by_band.get("Critical", 0)),
            "by_band": by_band,
            "by_lens": by_lens,
            "basis": EVIDENCE_BASIS_NOTE,
        },
        "prevention": {
            "total_evaluated": prev.total_evaluated,
            "prevented": prev.prevented_count,
            "near_miss": prev.near_miss_count,
            "outcome_unclear": prev.outcome_unclear_count,
            "confirmed_damage": prev.confirmed_damage_count,
            "note": "Buckets are reported separately and never summed into one headline; "
                    "'confirmed damage' is set only by human review.",
        },
        "recurring_scenarios": learn.recurring_scenarios(db, min_count=2),
        "training_recommendations": learn.training_recommendations(db, min_count=2),
        "behaviour_frequency": learn.behaviour_frequency(db),
        "process_scorecards": learn.process_scorecards(db),
        "disclosure": "Comparative operational risk indicators from observed geometry and product "
                      "metadata — not certified structural engineering calculations.",
    }


@router.get("/shift-summary")
def shift_summary(db: sqlite3.Connection = Depends(get_db)) -> dict:
    return _summary(db)


@router.get("/shift-summary.md")
def shift_summary_md(db: sqlite3.Connection = Depends(get_db)) -> Response:
    s = _summary(db)
    t = s["totals"]
    p = s["prevention"]
    lines = [
        "# TRACE — Shift Safety Summary",
        "",
        f"_Generated {s['generated_at']} · {s['window']}_",
        "",
        "## Totals",
        f"- Evidence-backed findings: **{t['evidence_backed_findings']}** "
        f"({t['high_or_critical']} High/Critical), from {t['logged_observations']} logged observations",
        "- By band: " + ", ".join(f"{k} {v}" for k, v in sorted(t["by_band"].items())),
        "- By lens: " + ", ".join(f"{k} {v}" for k, v in sorted(t["by_lens"].items())),
        "",
        "## Prevention (buckets kept separate)",
        f"- Evaluated: {p['total_evaluated']}",
        f"- Prevented: {p['prevented']}",
        f"- Near-miss: {p['near_miss']}",
        f"- Outcome unclear: {p['outcome_unclear']}",
        f"- Confirmed damage (human-reviewed): {p['confirmed_damage']}",
        "",
        "## Recurring configurations",
    ]
    if s["recurring_scenarios"]:
        for r in s["recurring_scenarios"]:
            lines.append(
                f"- {r['scenario']} — {r['count']}× ({r['high_count']} High/Crit) "
                f"across {r['source_count']} source(s)"
            )
    else:
        lines.append("- none")

    lines += ["", "## Training recommendations"]
    if s["training_recommendations"]:
        for r in s["training_recommendations"]:
            tag = "PRIORITY — " if r["priority"] == "high" else ""
            lines.append(f"- {tag}{r['suggestion']}")
    else:
        lines.append("- none")

    lines += ["", "## Process scorecards (per source, not per worker)", "",
              "| source | events | High/Crit | prevented | near-miss | most common |",
              "|---|---:|---:|---:|---:|---|"]
    for c in s["process_scorecards"]:
        lines.append(
            f"| {c['source']} | {c['events']} | {c['high_events']} | "
            f"{c['prevented']} | {c['near_miss']} | {c['top_scenario'] or '—'} |"
        )

    lines += ["", "---", f"_{s['disclosure']}_", ""]
    return Response(
        content="\n".join(lines),
        media_type="text/markdown",
        headers={"Content-Disposition": f'attachment; filename="trace-shift-summary-{_now_stamp()}.md"'},
    )
