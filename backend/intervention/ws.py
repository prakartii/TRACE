"""WebSocket connection manager for TRACE Real-Time Alert Delivery.

Supports real-time bidirectional messaging, client lifecycle management,
graceful error handling, and broadcast to active frontend subscribers.
"""

from __future__ import annotations

import asyncio
import logging
from typing import Any

from fastapi import WebSocket, WebSocketDisconnect

logger = logging.getLogger("trace.intervention.ws")


class AlertWebSocketManager:
    """Manages active WebSocket connections for intervention alert broadcasting."""

    def __init__(self) -> None:
        self.active_connections: set[WebSocket] = set()
        self._lock = asyncio.Lock()

    async def connect(self, websocket: WebSocket) -> None:
        """Accepts and registers a new WebSocket client."""
        await websocket.accept()
        async with self._lock:
            self.active_connections.add(websocket)
        logger.info("WebSocket client connected. Total clients: %d", len(self.active_connections))

    async def disconnect(self, websocket: WebSocket) -> None:
        """Unregisters a disconnecting WebSocket client."""
        async with self._lock:
            self.active_connections.discard(websocket)
        logger.info("WebSocket client disconnected. Total clients: %d", len(self.active_connections))

    async def broadcast(self, message: dict[str, Any]) -> None:
        """Broadcasts a JSON message to all active WebSocket clients safely."""
        async with self._lock:
            dead_connections = set()
            for connection in self.active_connections:
                try:
                    await connection.send_json(message)
                except Exception as exc:
                    logger.warning("Failed to deliver WebSocket message to client: %s", exc)
                    dead_connections.add(connection)
            for dead in dead_connections:
                self.active_connections.discard(dead)

    async def send_personal_message(self, message: dict[str, Any], websocket: WebSocket) -> None:
        """Sends a JSON message directly to a specific connected client."""
        try:
            await websocket.send_json(message)
        except Exception as exc:
            logger.warning("Failed to send direct WebSocket message: %s", exc)


ws_manager = AlertWebSocketManager()
