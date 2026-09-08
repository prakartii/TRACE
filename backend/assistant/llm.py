"""Optional Claude phrasing layer for the grounded assistant.

The retrieval layer (``backend.assistant.queries``) is the source of truth and
always produces a complete, deterministic answer. When an Anthropic API key and
the ``anthropic`` SDK are both available, this module rephrases those retrieved
rows into one fluent paragraph — nothing more. It is handed ONLY the query
results as a DATA block and instructed never to introduce a number, name, id,
or claim that is not present there; on any error it returns ``None`` and the
caller falls back to the deterministic summary.

There is no tool that writes, and the model is never given database access —
per ARCHITECTURE.md Screen 7 the LLM's function-calling surface is read-only,
and here it does not even call functions: the read already happened.
"""

from __future__ import annotations

import json
import os
from typing import Optional

# Per the claude-api guidance: default to the current flagship unless the
# operator pins another model via the environment.
DEFAULT_MODEL = os.environ.get("TRACE_ASSISTANT_MODEL", "claude-opus-5")

_SYSTEM = (
    "You are the TRACE warehouse-safety assistant. You answer a supervisor's question "
    "using ONLY the DATA block provided in the user's message, which was retrieved from "
    "TRACE's event database. Rules:\n"
    "- Never state a count, id, name, score, scenario, or outcome that is not present in DATA.\n"
    "- If DATA is empty or does not contain the answer, say so plainly and stop.\n"
    "- Do not speculate about the footage, causes, or fixes beyond what DATA records.\n"
    "- Keep 'prevented', 'near-miss', 'outcome unclear' and 'confirmed damage' as distinct "
    "categories; never merge them into a single headline number.\n"
    "- Be concise: 1-4 sentences, plain operational language, no preamble."
)


def is_available() -> bool:
    if not os.environ.get("ANTHROPIC_API_KEY"):
        return False
    try:
        import anthropic  # noqa: F401
    except Exception:
        return False
    return True


def narrate(question: str, results: list[dict], *, model: str = DEFAULT_MODEL) -> Optional[str]:
    """Return a one-paragraph answer grounded in ``results`` (each a QueryResult
    as a dict), or ``None`` if the LLM is unavailable or the call fails."""
    if not is_available():
        return None
    try:
        import anthropic

        client = anthropic.Anthropic()
        data_block = json.dumps(results, indent=2, default=str)
        user = (
            f"QUESTION: {question}\n\n"
            f"DATA (retrieved from the TRACE database — this is everything you may use):\n{data_block}"
        )
        resp = client.messages.create(
            model=model,
            max_tokens=1024,
            system=_SYSTEM,
            thinking={"type": "adaptive"},
            messages=[{"role": "user", "content": user}],
        )
        if getattr(resp, "stop_reason", None) == "refusal":
            return None
        text = "".join(b.text for b in resp.content if getattr(b, "type", None) == "text").strip()
        return text or None
    except Exception:
        return None
