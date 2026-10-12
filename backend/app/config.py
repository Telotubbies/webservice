"""Runtime configuration (env). One place, read once at import."""

from __future__ import annotations

import os
from uuid import UUID

APP_ENV = os.environ.get("APP_ENV", "dev")  # dev | test | prod

MQTT_HOST = os.environ.get("MQTT_HOST", "localhost")
MQTT_PORT = int(os.environ.get("MQTT_PORT", "1883"))
MQTT_USER = os.environ.get("MQTT_USER") or None
MQTT_PASSWORD = os.environ.get("MQTT_PASSWORD") or None
CORS_ORIGIN = os.environ.get("CORS_ORIGIN", "http://localhost:5173")

# --- v1 compatibility shim (removed in phase 4, CONTRACT.v2) ---------------
# v1 topics (`plant1/...`) carry no tenant identity, so the v1 runtime is
# pinned to exactly one org/site/edge. These are the dev-seed ids (seed.py).
V1_SITE_CODE = os.environ.get("SITE", "plant1")
V1_EDGE_NAME = os.environ.get("EDGE_ID", "edge1")
V1_ORG_ID = UUID(os.environ.get("V1_ORG_ID", "0199d000-0000-7000-8000-00000000a001"))
V1_SITE_ID = UUID(os.environ.get("V1_SITE_ID", "0199d000-0000-7000-8000-00000000b001"))
V1_EDGE_ID = UUID(os.environ.get("V1_EDGE_ID", "0199d000-0000-7000-8000-00000000c001"))

# --- rate limiting (v4 T4; doc 16 row 7) -----------------------------------
# In-process token buckets (app/ratelimit.py) — per-process, single replica.
RATE_COMMANDS_PER_TAG = int(os.environ.get("RATE_COMMANDS_PER_TAG", "5"))   # per window, per user+tag
RATE_COMMANDS_WINDOW_S = float(os.environ.get("RATE_COMMANDS_WINDOW_S", "10"))
RATE_MUTATIONS_PER_USER = int(os.environ.get("RATE_MUTATIONS_PER_USER", "60"))  # per window, per user
RATE_MUTATIONS_WINDOW_S = float(os.environ.get("RATE_MUTATIONS_WINDOW_S", "60"))
RATE_WS_PER_IP = int(os.environ.get("RATE_WS_PER_IP", "20"))                # concurrent /ws sockets per client IP

# WS Origin allowlist (comma-separated origins, e.g. "https://ops.example.com").
# Unset/empty -> same-origin only: the request Origin's host[:port] must match
# the Host header. A missing Origin header is allowed — browsers always send
# Origin on WebSocket upgrades, so its absence means a non-browser client
# (curl, python-websockets, edge tooling) that cross-origin browser attacks
# can't ride anyway. Documented decision (v4 T4).
_origins = os.environ.get("ALLOWED_ORIGINS", "")
ALLOWED_ORIGINS: list[str] | None = [
    o.strip() for o in _origins.split(",") if o.strip()
] or None

EDGE_STALE_AFTER_S = 15.0
ALARM_FRESH_S = 15.0        # alarm engine ignores samples older than this (doc 16 / CONTRACT.v2 §6)
HISTORY_MAX_AGE_S = 8 * 3600
FUTURE_SKEW_S = 5.0
HISTORY_FLUSH_S = 1.0
HISTORY_FLUSH_ROWS = 500
HEALTH_WATCHDOG_S = 2.0
STALE_RULE_CHECK_S = 5.0

# --- insight engine (doc 19 §4, UI v3) — periodic statistical inference ---
INSIGHT_PERIOD_S = float(os.environ.get("INSIGHT_PERIOD_S", "15"))
INSIGHT_BASE_S = float(os.environ.get("INSIGHT_BASE_S", "3600"))   # EWMA baseline window
INSIGHT_EWMA_ALPHA = float(os.environ.get("INSIGHT_EWMA_ALPHA", "0.05"))
INSIGHT_ANOM_Z = float(os.environ.get("INSIGHT_ANOM_Z", "3.0"))    # |z| open threshold
INSIGHT_OPEN_N = int(os.environ.get("INSIGHT_OPEN_N", "3"))        # out-of-band streak to open
INSIGHT_CLOSE_N = int(os.environ.get("INSIGHT_CLOSE_N", "5"))      # in-band streak to close
INSIGHT_FLAT_S = float(os.environ.get("INSIGHT_FLAT_S", "300"))    # zero-variance window
INSIGHT_FLAP_N = int(os.environ.get("INSIGHT_FLAP_N", "6"))        # quality transitions
INSIGHT_FLAP_S = float(os.environ.get("INSIGHT_FLAP_S", "600"))    # flapping window
