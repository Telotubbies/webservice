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
from urllib.parse import urlparse

from fastapi import WebSocket

from .auth import OPERATOR_ROLES

log = logging.getLogger("backend.ws")

QUEUE_MAX = 256
_DROP_LOG_EVERY = 50
AUTH_TIMEOUT_S = 5.0


_LOOPBACK = {"localhost", "127.0.0.1", "::1", "[::1]"}


def _hostname(netloc: str) -> str:
    h, sep, port = netloc.rpartition(":")
    if sep and port.isdigit():
        return h.strip("[]")
    return netloc.strip("[]")


def origin_allowed(origin: str | None, host: str | None,
                   allowlist: list[str] | None, dev: bool = False) -> bool:
    """WS Origin gate (v4 T4).

    - No Origin header -> allowed: browsers always send Origin on a WebSocket
      upgrade, so absence means a non-browser client (curl, python-websockets,
      edge tooling). Cross-site WS hijacking needs a browser — which always
      sends Origin — so this carve-out doesn't weaken the check.
    - `allowlist` (ALLOWED_ORIGINS env) entries match the Origin exactly.
    - Same-origin is always allowed: Origin's host[:port] == Host header.
    - `dev` (APP_ENV != prod): loopback-to-loopback is allowed too — vite's
      dev proxy rewrites Host but not Origin, so a dev-server page would
      otherwise 4403 forever on a random port.
    - Everything else (cross-origin, "null", unparseable) -> reject 4403.
    """
    if not origin:
        return True
    o = origin.strip().rstrip("/")
    if allowlist and o in {a.strip().rstrip("/") for a in allowlist}:
        return True
    if not host:
        return False
    netloc = urlparse(o).netloc.lower()
    host_l = host.strip().lower()
    if netloc and netloc == host_l:
        return True
    if dev and netloc:
        return (_hostname(netloc) in _LOOPBACK
                and _hostname(host_l) in _LOOPBACK)
    return False


class WSAuthError(Exception):
    """First frame wasn't a well-formed {"type":"auth"} message in time."""


async def read_auth_token(ws: WebSocket) -> str:
    """Read the first-frame auth message; returns the raw token ('' = anonymous).

    The token moved out of `?token=` (v4 T3) — query strings end up in
    access logs and proxy traces. Anything that isn't {"type":"auth"} on the
    first frame — a data frame sent pre-auth, a BINARY frame (receive_text
    raises KeyError on one; receive() is used so it's a clean WSAuthError),
    malformed JSON, disconnect, or silence past AUTH_TIMEOUT_S — raises
    WSAuthError; the endpoint closes 4401.
    """
    try:
        message = await asyncio.wait_for(ws.receive(), timeout=AUTH_TIMEOUT_S)
    except asyncio.TimeoutError as e:
        raise WSAuthError("no auth frame") from e
    # websocket.disconnect, or a receive carrying bytes instead of text
    if message.get("type") != "websocket.receive" or not isinstance(
        message.get("text"), str
    ):
        raise WSAuthError("first frame not a text frame")
    try:
        msg = json.loads(message["text"])
    except json.JSONDecodeError as e:
        raise WSAuthError("auth frame not JSON") from e
    if not isinstance(msg, dict) or msg.get("type") != "auth":
        raise WSAuthError("first frame not auth")
    token = msg.get("token", "")
    # enforced now, not just at T5: a malformed token type must be an auth
    # failure (4401), never silently coerced to anonymous
    if not isinstance(token, str):
        raise WSAuthError("token not a string")
    return token


@dataclass(eq=False)  # identity hash — instances live in a set
class Client:
    ws: WebSocket
    role: str
    sub: str = ""               # IdP subject — for wds_authz eviction (v4 T5)
    sid: str = ""               # OIDC session id — revoked_sessions eviction
    queue: asyncio.Queue = field(default_factory=lambda: asyncio.Queue(QUEUE_MAX))
    dropped: int = 0
    connected_at: float = field(default_factory=time.monotonic)


class WSManager:
    def __init__(self) -> None:
        self._clients: set[Client] = set()
        self._lock = asyncio.Lock()
        self._by_ip: dict[str, int] = {}
        self.total_dropped = 0

    async def acquire_ip(self, ip: str, limit: int) -> bool:
        """Reserve a per-IP slot counted at accept time (v4 T4). Sockets are
        counted from accept — including pre-auth ones that will churn out in
        ≤ AUTH_TIMEOUT_S — so a connect flood can't sit under the auth gate
        uncounted. Pair every acquire with release_ip."""
        async with self._lock:
            if self._by_ip.get(ip, 0) >= limit:
                return False
            self._by_ip[ip] = self._by_ip.get(ip, 0) + 1
            return True

    async def release_ip(self, ip: str) -> None:
        async with self._lock:
            n = self._by_ip.get(ip, 0)
            if n <= 1:
                self._by_ip.pop(ip, None)
            else:
                self._by_ip[ip] = n - 1

    def clients(self) -> list[Client]:
        """Snapshot of connected clients (wds_authz eviction iterates this)."""
        return list(self._clients)

    async def connect(self, ws: WebSocket, role: str,
                      sub: str = "", sid: str = "") -> Client:
        # the endpoint accepts before connect() — the socket must be open
        # to read the first-frame auth handshake
        client = Client(ws=ws, role=role, sub=sub, sid=sid)
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
            if restricted and client.role not in OPERATOR_ROLES:
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
