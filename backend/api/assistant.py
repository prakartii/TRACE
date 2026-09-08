"""REST endpoints for the grounded AI supervisor assistant (ARCHITECTURE.md
Screen 7, CLAUDE.md §21).

- POST /api/assistant/ask         : answer a supervisor question from the event store
- GET  /api/assistant/suggestions : the seed questions shown as chips

The database is the source of truth. Retrieval is deterministic and always
produces a full answer; the Claude phrasing layer is optional and is only ever
handed the retrieved rows (never write access, never a bare question).
"""

from __future__ import annotations

import sqlite3

from fastapi import APIRouter, Depends

from backend.assistant.engine import answer as answer_question
from backend.assistant.llm import DEFAULT_MODEL, is_available
from backend.assistant.router import SUGGESTIONS
from backend.contracts.models import AssistantAnswer, AssistantAskRequest
from backend.db.db import get_db

router = APIRouter(prefix="/api/assistant", tags=["assistant"])


@router.post("/ask", response_model=AssistantAnswer)
def ask(req: AssistantAskRequest, db: sqlite3.Connection = Depends(get_db)) -> AssistantAnswer:
    return AssistantAnswer(**answer_question(db, req.question))


@router.get("/suggestions")
def suggestions() -> dict:
    return {
        "suggestions": SUGGESTIONS,
        "llm_available": is_available(),
        "model": DEFAULT_MODEL if is_available() else None,
        "note": (
            "Answers are retrieved from the TRACE event database. "
            + ("Claude rephrases the retrieved records." if is_available()
               else "No language model is configured; answers are the retrieval layer verbatim.")
        ),
    }
