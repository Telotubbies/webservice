"""WebSocket fan-out manager.

Each connected client owns a bounded asyncio.Queue. broadcast() is
non-blocking: if a client's queue is full the OLDEST message is dropped (a
slow consumer must not stall the fan-out loop — see SDLC 06 §4 backpressure).
Drop-oldest events are counted and logged (throttled).
"""

from __future__ import annotations

import asyncio
import json
import logging
import time
from dataclasses import dataclass, field

from fastapi import WebSocket, WebSocketDisconnect

log = logging.getLogger("backend.ws")

QUEUE_MAX = 256
_DROP_LOG_EVERY = 50
AUTH_TIMEOUT_S = 5.0


class WSAuthError(Exception):
    """First frame wasn't a well-formed {"type":"auth"} message in time."""


async def read_auth_token(ws: WebSocket) -> str:
    """Read the first-frame auth message; returns the raw token ('' = anonymous).

    The token moved out of `?token=` (v4 T3) — query strings end up in
    access logs and proxy traces. Anything that isn't {"type":"auth"} on the
    first frame — a data frame sent pre-auth, malformed JSON, or silence
    past AUTH_TIMEOUT_S — raises WSAuthError; the endpoint closes 4401.
    """
    try:
        raw = await asyncio.wait_for(ws.receive_text(), timeout=AUTH_TIMEOUT_S)
    except (asyncio.TimeoutError, WebSocketDisconnect) as e:
        raise WSAuthError("no auth frame") from e
    try:
        msg = json.loads(raw)
    except json.JSONDecodeError as e:
        raise WSAuthError("auth frame not JSON") from e
    if not isinstance(msg, dict) or msg.get("type") != "auth":
        raise WSAuthError("first frame not auth")
    token = msg.get("token", "")
    return token if isinstance(token, str) else ""


@dataclass(eq=False)  # identity hash — instances live in a set
class Client:
    ws: WebSocket
    role: str
    queue: asyncio.Queue = field(default_factory=lambda: asyncio.Queue(QUEUE_MAX))
    dropped: int = 0
    connected_at: float = field(default_factory=time.monotonic)


class WSManager:
    def __init__(self) -> None:
        self._clients: set[Client] = set()
        self._lock = asyncio.Lock()
        self.total_dropped = 0

    async def connect(self, ws: WebSocket, role: str) -> Client:
        # the endpoint accepts before connect() — the socket must be open
        # to read the first-frame auth handshake
        client = Client(ws=ws, role=role)
        async with self._lock:
            self._clients.add(client)
        log.info(
            "ws client connected",
            extra={"role": role, "clients": len(self._clients)},
        )
        return client

    async def disconnect(self, client: Client) -> None:
        async with self._lock:
            self._clients.discard(client)
        log.info("ws client disconnected", extra={"clients": len(self._clients)})

    async def pump(self, client: Client) -> None:
        """Drain the client's queue onto the socket. Runs as a task per client."""
        try:
            while True:
                event = await client.queue.get()
                await client.ws.send_text(json.dumps(event, separators=(",", ":")))
        except asyncio.CancelledError:
            raise
        except Exception:  # socket died mid-send; endpoint cleanup handles it
            log.debug("ws pump ended (send failed)", exc_info=True)

    def broadcast(self, event: dict) -> None:
        """Offer event to every client; drop-oldest when a queue is full.

        Command lifecycle events go to operators only — the public stream
        (anonymous + viewer) carries tag/alarm/health only (least privilege:
        a read-only viewer must not learn which tags are being driven, when,
        or by whom — that's operational intel for an attacker).
        """
        restricted = event.get("type") == "command"
        for client in list(self._clients):
            if restricted and client.role != "operator":
                continue
            try:
                client.queue.put_nowait(event)
            except asyncio.QueueFull:
                try:
                    client.queue.get_nowait()  # drop oldest
                    client.queue.put_nowait(event)
                except (asyncio.QueueEmpty, asyncio.QueueFull):
                    pass
                client.dropped += 1
                self.total_dropped += 1
                if client.dropped % _DROP_LOG_EVERY == 1:
                    log.warning(
                        "slow ws consumer — dropping oldest messages",
                        extra={
                            "client_dropped": client.dropped,
                            "queue_max": QUEUE_MAX,
                        },
                    )

    def client_count(self) -> int:
        return len(self._clients)
