"""Deterministic intent router for the grounded assistant.

Maps a free-text supervisor question to one (or a few) read-only queries from
``backend.assistant.queries``. Deliberately keyword/regex based, not an LLM:
retrieval must be reproducible and must work with no API key (CLAUDE.md §25),
and the LLM — when present — only rephrases what these queries return.
"""

from __future__ import annotations

import re
import sqlite3
from dataclasses import dataclass
from typing import Callable

from backend.assistant import queries as q

QueryFn = Callable[[sqlite3.Connection], q.QueryResult]


@dataclass
class Route:
    intent: str
    run: list[QueryFn]


_EVENT_ID_RE = re.compile(r"(?:event|incident|#)\s*#?\s*(\d{1,6})", re.I)

# Small talk: the whole message (after stripping trailing punctuation), not
# just a substring match — so "hi" is a greeting but "high risk events" is
# not. A question that ends in "thanks" ("what's the highest risk, thanks?")
# still routes on its actual content since these only match the ENTIRE text.
_GREETING_RE = re.compile(
    r"^(hi|hello|hey|hiya|yo|howdy|sup|good\s?morning|good\s?afternoon|good\s?evening|greetings)"
    r"(\s?(there|team|trace|all|everyone))?[!.?, ]*$",
    re.I,
)
_THANKS_RE = re.compile(r"^(thanks|thank\s?you|thx|ty|cheers|appreciate\s?it|much\s?appreciated)[!.?, ]*$", re.I)
_BYE_RE = re.compile(r"^(bye|goodbye|good\s?night|see\s?you|see\s?ya|later|that'?s\s?all|that\s?is\s?all)[!.?, ]*$", re.I)


def _kw(text: str, *needles: str) -> bool:
    return any(n in text for n in needles)


def _entity_keyword(text: str) -> str | None:
    """A scenario-discriminating term the user named, used to pick the event to
    explain when no numeric id is given. Scenario words win over generic cargo
    nouns like "carton"/"box" (which match too many scenarios); when only a
    generic noun is present we return None and let the query fall back to the
    highest-band recent event — it says so rather than fabricating a match."""
    for scen in (
        "overhang", "bending", "unsupported", "orientation", "heavy-on-light",
        "heavy on light", "stacking", "dragging", "dragged", "throwing", "thrown",
        "dropping", "dropped", "rolling", "stepping", "strap", "wet floor",
        "dock", "equipment", "trolley", "solo", "sequence",
    ):
        if scen in text:
            return scen.split()[0]
    return None


def _asks_to_rank_a_person(text: str) -> bool:
    """True when the question invites individual blame or ranking.

    CLAUDE.md §22 forbids punitive individual worker rankings. "Who was the
    worst worker?" used to hit the generic "worst" keyword and come back with
    a ranked "X has the most" answer. Both a person noun and a ranking/blame
    term are required so ordinary questions ("which behaviour was most
    frequent?", "worst scenario") keep their existing routes.
    """
    person = _kw(
        text, "worker", "employee", "staff", "operator", "person", "people",
        "individual", "crew", "handler", "guy", "someone", "who ",
    )
    blame = _kw(
        text, "worst", "best", "blame", "fault", "responsible", "rank",
        "careless", "unsafe", "performance", "name", "which one", "most",
        # punitive action, not just ranking
        "disciplin", "punish", "reprimand", "fired", "firing", "sack",
        "write up", "written up",
    )
    return person and blame


def route(question: str, video_id: str | None = None) -> Route:
    t = (question or "").lower().strip()

    # Small talk short-circuits everything else — a "hi" should get a hi
    # back, not a statistics dump (CLAUDE.md §21 UI intent: this is a
    # conversation, not a report generator).
    if _GREETING_RE.match(t):
        return Route("greetings", [q.greetings])
    if _THANKS_RE.match(t):
        return Route("small_talk", [lambda c: q.small_talk(c, "thanks")])
    if _BYE_RE.match(t):
        return Route("small_talk", [lambda c: q.small_talk(c, "bye")])

    m = _EVENT_ID_RE.search(t)
    event_id = int(m.group(1)) if m else None
    kw = _entity_keyword(t)

    # §22 guard runs before every other route: no individual rankings.
    if _asks_to_rank_a_person(t):
        return Route("process_attribution", [q.process_attribution])

    # "what did TRACE recommend / what should we do" ---------------------------
    if _kw(t, "recommend", "what did trace recommend", "safe action", "what should", "advice", "mitigat"):
        return Route("recommendation_for",
                     [lambda c: q.recommendation_for(c, event_id=event_id, keyword=kw)])

    # "why was X risky / explain event N" ------------------------------------
    if _kw(t, "why was", "why is", "why did", "explain", "what made", "reason") or (
        event_id is not None and _kw(t, "risk", "danger", "flag")
    ) or (event_id is not None and len(t.split()) <= 6):
        return Route("explain_event",
                     [lambda c: q.explain_event(c, event_id=event_id, keyword=kw)])

    # prevention / outcomes --------------------------------------------------
    if _kw(t, "prevent", "how many were stopped", "how many did trace stop", "outcome", "damage"):
        return Route("prevention_breakdown", [q.prevention_breakdown])

    # near-miss (+ which bay/zone/source) ----------------------------------
    if _kw(t, "near miss", "near-miss", "nearmiss"):
        return Route("near_misses_by_source", [q.near_misses_by_source])

    # most common risks / scenarios --------------------------------------
    if _kw(t, "most common", "common risk", "top risk", "which risks", "what risks",
           "frequent risk", "biggest risk", "main risk"):
        return Route("top_scenarios", [q.top_scenarios])

    # most frequent behaviour ------------------------------------------
    if _kw(t, "behaviour", "behavior") and _kw(t, "most", "frequent", "common", "which", "often"):
        return Route("top_behaviours", [q.top_behaviours])
    if _kw(t, "throwing", "dragging", "dropping", "rolling", "stepping", "strap"):
        return Route("top_behaviours", [q.top_behaviours])

    # high-risk events / by bay --------------------------------------
    if _kw(t, "high risk", "high-risk", "highest risk", "highest-risk", "critical", "most dangerous", "worst"):
        return Route("high_risk_events", [q.high_risk_events])

    # false positives ---------------------------------------------
    if _kw(t, "false positive", "false-positive", "wrong", "misfire", "incorrect"):
        return Route("false_positives", [q.false_positives])

    # shift handover briefing / daily report ----------------------------------
    if _kw(t, "briefing", "handover", "daily report", "morning report", "executive summary", "daily summary", "shift safety", "shift briefing"):
        return Route("shift_briefing", [q.shift_briefing])

    # active alerts & interventions ------------------------------------------
    if _kw(t, "active alert", "active alerts", "intervention", "interventions", "alarms", "urgent alert"):
        return Route("active_interventions", [q.active_interventions])

    # safe action planner & stability formula --------------------------------
    if _kw(t, "how does the planner", "how does planner", "how is stability",
           "stability formula", "calculate stability", "what-if simulation", "counterfactual"):
        return Route("planner_methodology", [q.planner_methodology])

    # product rules & SKU catalog --------------------------------------------
    if _kw(t, "sku", "catalog", "custom rule", "product rule", "max stack", "rules for", "orientation rule"):
        return Route("product_rules_summary", [q.product_rules_summary])

    # specific camera / bay analysis -----------------------------------------
    if _kw(t, "camera 1", "camera 2", "camera 3", "camera 4", "camera 5", "camera 6", "camera 7",
           "camera", "loading dock", "staging deck", "transit aisle", "unloading bay", "racking area", "dispatch bay",
           "video", "in this video", "this video", "footage", "find in this video", "what did trace find"):
        return Route("camera_events", [lambda c: q.camera_events(c, t, context_video_id=video_id)])

    # scenario explanations / protocols --------------------------------------
    if (_kw(t, "what is", "tell me about", "describe", "explain") and kw) or _kw(t, "14 scenario", "all scenarios", "scenarios"):
        return Route("scenario_info", [lambda c: q.scenario_info(c, t)])

    # default: a grounded overview + the two headline aggregates -----------
    return Route("overview", [q.overview, q.top_scenarios, q.prevention_breakdown])


SUGGESTIONS = [
    "What are the highest-risk events?",
    "What unsafe behaviour occurred most often?",
    "Why was this incident high risk?",
    "What should the supervisor do next?",
    "What did TRACE find in this video?",
    "Give me a shift safety briefing",
    "Are there any active alerts?",
    "How does the Safe Action Planner work?",
]
