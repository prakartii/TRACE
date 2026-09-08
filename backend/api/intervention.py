"""REST and WebSocket endpoints for TRACE Operational Safety Intervention Layer.

Exposes:
- GET  /api/intervention/active             : Get active interventions
- GET  /api/intervention/list               : List all interventions with filtering
- GET  /api/intervention/{alert_id}         : Fetch a single alert
- POST /api/intervention/{alert_id}/acknowledge : Acknowledge alert
- POST /api/intervention/{alert_id}/progress    : Mark action in progress
- POST /api/intervention/{alert_id}/verify      : Supervisor verify
- POST /api/intervention/{alert_id}/resolve     : Resolve alert & link outcome
- POST /api/intervention/{alert_id}/dismiss     : Mark false positive
- POST /api/intervention/evaluate/{event_id}    : Create/update alert from DB event
- POST /api/intervention/seed-active            : Seed active alerts from real DB events
- WebSocket /api/intervention/ws                : Real-time alert stream
"""

from __future__ import annotations

import logging
import sqlite3
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, WebSocket, WebSocketDisconnect

from backend.contracts.models import (
    AlertAcknowledgeRequest,
    AlertActionProgressRequest,
    AlertDismissRequest,
    AlertResolveRequest,
    AlertVerifyRequest,
    InterventionAlert,
    InterventionFeedResponse,
)
from backend.db.db import get_connection, get_db
from backend.db.events import get_event_by_id
from backend.db.interventions import (
    count_active_interventions,
    get_active_interventions,
    get_intervention_by_id,
    list_interventions,
)
from backend.intervention.engine import intervention_engine
from backend.intervention.ws import ws_manager

logger = logging.getLogger("trace.api.intervention")

router = APIRouter(prefix="/api/intervention", tags=["intervention"])
live_ws_router = APIRouter(tags=["intervention_ws"])


@router.get("/active", response_model=list[InterventionAlert])
def get_active_alerts(
    video_id: Optional[str] = Query(None, description="Filter active alerts by video ID"),
    db: sqlite3.Connection = Depends(get_db),
) -> list[InterventionAlert]:
    """Retrieves all active intervention alerts requiring worker or supervisor attention."""
    active = get_active_interventions(db, video_id=video_id)
    # If database has no active alerts yet, automatically seed from real DB events
    if not active:
        active = intervention_engine.seed_active_from_db(video_id=video_id, conn=db)
    return active


@router.get("/list", response_model=list[InterventionAlert])
def get_interventions_list(
    video_id: Optional[str] = Query(None, description="Filter by video ID"),
    state: Optional[str] = Query(None, description="Filter by alert state"),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    db: sqlite3.Connection = Depends(get_db),
) -> list[InterventionAlert]:
    """Lists intervention alerts with filtering and pagination."""
    return list_interventions(
        conn=db,
        video_id=video_id,
        state=state,
        limit=limit,
        offset=offset,
    )


@router.get("/{alert_id}", response_model=InterventionAlert)
def get_alert_by_id(
    alert_id: str,
    db: sqlite3.Connection = Depends(get_db),
) -> InterventionAlert:
    """Fetches a specific intervention alert."""
    alert = get_intervention_by_id(alert_id, db)
    if alert is None:
        raise HTTPException(status_code=404, detail=f"Intervention alert '{alert_id}' not found.")
    return alert


@router.post("/{alert_id}/acknowledge", response_model=InterventionAlert)
def acknowledge_alert(
    alert_id: str,
    req: AlertAcknowledgeRequest = AlertAcknowledgeRequest(),
    db: sqlite3.Connection = Depends(get_db),
) -> InterventionAlert:
    """Acknowledges an active intervention alert."""
    user = req.user or "operator"
    updated = intervention_engine.acknowledge(alert_id, user=user, conn=db)
    if updated is None:
        raise HTTPException(status_code=404, detail=f"Intervention alert '{alert_id}' not found.")
    return updated


@router.post("/{alert_id}/progress", response_model=InterventionAlert)
def progress_alert(
    alert_id: str,
    req: AlertActionProgressRequest = AlertActionProgressRequest(),
    db: sqlite3.Connection = Depends(get_db),
) -> InterventionAlert:
    """Transitions an alert into ACTION_IN_PROGRESS."""
    updated = intervention_engine.progress_action(alert_id, notes=req.notes, conn=db)
    if updated is None:
        raise HTTPException(status_code=404, detail=f"Intervention alert '{alert_id}' not found.")
    return updated


@router.post("/{alert_id}/verify", response_model=InterventionAlert)
def verify_alert(
    alert_id: str,
    req: AlertVerifyRequest = AlertVerifyRequest(),
    db: sqlite3.Connection = Depends(get_db),
) -> InterventionAlert:
    """Records supervisor physical safety verification."""
    verified_by = req.verified_by or "supervisor"
    updated = intervention_engine.verify_alert(alert_id, verified_by=verified_by, notes=req.notes, conn=db)
    if updated is None:
        raise HTTPException(status_code=404, detail=f"Intervention alert '{alert_id}' not found.")
    return updated


@router.post("/{alert_id}/resolve", response_model=InterventionAlert)
def resolve_alert(
    alert_id: str,
    req: AlertResolveRequest = AlertResolveRequest(),
    db: sqlite3.Connection = Depends(get_db),
) -> InterventionAlert:
    """Resolves an intervention alert and links to outcome measurement."""
    classification = req.outcome_classification or "prevented"
    updated = intervention_engine.resolve(alert_id, notes=req.notes, outcome_classification=classification, conn=db)
    if updated is None:
        raise HTTPException(status_code=404, detail=f"Intervention alert '{alert_id}' not found.")
    return updated


@router.post("/{alert_id}/dismiss", response_model=InterventionAlert)
def dismiss_alert(
    alert_id: str,
    req: AlertDismissRequest = AlertDismissRequest(),
    db: sqlite3.Connection = Depends(get_db),
) -> InterventionAlert:
    """Marks an alert as false positive, recording operator feedback in Responsible AI loop."""
    reason = req.reason or "Marked as false positive by operator"
    updated = intervention_engine.dismiss_as_false_positive(alert_id, reason=reason, conn=db)
    if updated is None:
        raise HTTPException(status_code=404, detail=f"Intervention alert '{alert_id}' not found.")
    return updated


@router.post("/evaluate/{event_id}", response_model=Optional[InterventionAlert])
def evaluate_event_intervention(
    event_id: int,
    db: sqlite3.Connection = Depends(get_db),
) -> Optional[InterventionAlert]:
    """Evaluates an existing database event into an InterventionAlert if it qualifies."""
    event = get_event_by_id(db, event_id)
    if event is None:
        raise HTTPException(status_code=404, detail=f"Event #{event_id} not found in database.")

    alert = intervention_engine.process_event(event, conn=db)
    if alert is None:
        raise HTTPException(status_code=422, detail=f"Event #{event_id} does not meet intervention threshold.")
    return alert


@router.post("/seed-active", response_model=list[InterventionAlert])
def seed_active_alerts(
    video_id: Optional[str] = Query(None, description="Optional video ID to seed"),
    db: sqlite3.Connection = Depends(get_db),
) -> list[InterventionAlert]:
    """Populates active intervention alerts from genuine database events."""
    return intervention_engine.seed_active_from_db(video_id=video_id, conn=db)


async def handle_websocket(websocket: WebSocket) -> None:
    """Generic WebSocket connection handler for real-time alert broadcasts."""
    await ws_manager.connect(websocket)
    try:
        conn = get_connection()
        try:
            active = get_active_interventions(conn)
            if not active:
                active = intervention_engine.seed_active_from_db(conn=conn)
            init_payload = {
                "type": "init",
                "alerts": [a.model_dump() for a in active],
                "active_count": len(active),
            }
            await ws_manager.send_personal_message(init_payload, websocket)
        finally:
            conn.close()

        while True:
            data = await websocket.receive_text()
            if data == "ping":
                await websocket.send_text("pong")
    except WebSocketDisconnect:
        await ws_manager.disconnect(websocket)
    except Exception as exc:
        logger.warning("WebSocket error: %s", exc)
        await ws_manager.disconnect(websocket)


@router.websocket("/ws")
async def websocket_intervention_endpoint(websocket: WebSocket) -> None:
    await handle_websocket(websocket)


@live_ws_router.websocket("/ws/live")
async def websocket_live_endpoint(websocket: WebSocket) -> None:
    await handle_websocket(websocket)


@live_ws_router.websocket("/ws/alerts")
async def websocket_alerts_endpoint(websocket: WebSocket) -> None:
    await handle_websocket(websocket)

