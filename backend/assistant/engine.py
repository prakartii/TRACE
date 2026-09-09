"""Grounded assistant orchestrator (ARCHITECTURE.md Screen 7 / CLAUDE.md §21).

answer() = route the question to read-only queries -> run them against the event
store -> assemble a grounded answer. If the optional Claude phrasing layer is
available it rewrites the retrieved rows into one paragraph; otherwise the
deterministic query summaries are the answer. Either way the response carries
its grounding (which queries ran, how many rows, which event ids) so the UI can
show "based on N records" and the user can audit it.
"""

from __future__ import annotations

import dataclasses
import sqlite3

from backend.assistant import llm
from backend.assistant.router import SUGGESTIONS, route


def answer(conn: sqlite3.Connection, question: str) -> dict:
    q = (question or "").strip()
    if not q:
        return {
            "question": q,
            "answer": "Ask about logged risks, prevented events, near misses, a specific "
                      "event's reason, or what TRACE recommended.",
            "used_llm": False,
            "intent": "empty",
            "grounding": [],
            "data": {},
            "suggestions": SUGGESTIONS,
        }

    r = route(q)
    results = [fn(conn) for fn in r.run]

    deterministic = " ".join(res.summary for res in results if res.summary).strip()
    narrated = llm.narrate(q, [dataclasses.asdict(res) for res in results])
    used_llm = narrated is not None

    grounding = [
        {
            "query": res.kind,
            "source": res.source,
            "row_count": res.row_count,
            "event_ids": res.event_ids,
        }
        for res in results
    ]
    cards = []
    metrics = []
    followups = []
    for res in results:
        if getattr(res, "cards", None):
            cards.extend(res.cards)
        if getattr(res, "metrics", None):
            metrics.extend(res.metrics)
        if getattr(res, "suggested_followups", None):
            for f in res.suggested_followups:
                if f not in followups:
                    followups.append(f)

    if not followups:
        followups = SUGGESTIONS

    total_rows = sum(res.row_count for res in results)

    return {
        "question": q,
        "answer": narrated or deterministic,
        "deterministic_answer": deterministic,
        "used_llm": used_llm,
        "intent": r.intent,
        "grounding": grounding,
        "grounded_row_count": total_rows,
        "data": {res.kind: res.data for res in results},
        "suggestions": followups,
        "suggested_followups": followups,
        "cards": cards,
        "metrics": metrics,
    }
