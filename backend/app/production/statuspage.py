"""Public status (roadmap 8.4).

`GET /api/v1/status` is intentionally UNAUTHENTICATED — it feeds the public
status page and an external status domain. It reports coarse component
health only (ok/degraded/down + since-boot timestamp); never tenant data,
never internals beyond what /api/health already exposes.

Components:
  api   — answering this request at all means "ok"
  db    — bounded SELECT 1 probe (same as /readyz)
  mqtt  — broker connection flag on runtime state
  edge  — the shim org's tracked edge freshness (informational; a stale
          edge degrades but never takes the page "down")

Mounted from main.py (`app.include_router(statuspage.router)`); state is
resolved lazily via main.st().
"""

from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timezone

from fastapi import APIRouter, Request

from ..core import config
from ..db.util import iso_z

log = logging.getLogger("wds.status")

router = APIRouter()

_BOOT_TS = datetime.now(timezone.utc)


def _m():
    from .. import main
    return main


@router.get("/api/v1/status")
async def status(request: Request):
    m = _m()
    s = m.st(request)
    try:
        async with asyncio.timeout(5):
            db_ok = await m._db_up(s)
    except Exception:  # noqa: BLE001 — a sick probe IS "down"
        db_ok = False
    mqtt_ok = bool(s.mqtt.connected)
    edge = s.edge_status()
    components = [
        {"name": "api", "ok": True, "since": iso_z(_BOOT_TS)},
        {"name": "database", "ok": db_ok, "since": iso_z(_BOOT_TS) if db_ok else None},
        {"name": "mqtt", "ok": mqtt_ok, "since": iso_z(_BOOT_TS) if mqtt_ok else None},
        {"name": "edge", "ok": edge == "up",
         "since": iso_z(_BOOT_TS) if edge == "up" else None},
    ]
    if not db_ok or not mqtt_ok:
        overall = "down"
    elif edge != "up":
        overall = "degraded"
    else:
        overall = "operational"
    return {"status": overall, "env": config.APP_ENV,
            "components": components, "updated_at": iso_z()}
