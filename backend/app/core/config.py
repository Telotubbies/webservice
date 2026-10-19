"""Runtime configuration (env). One place, read once at import."""

from __future__ import annotations

import ipaddress
import os
from uuid import UUID

APP_ENV = os.environ.get("APP_ENV", "dev")  # dev | test | prod

MQTT_HOST = os.environ.get("MQTT_HOST", "localhost")
MQTT_PORT = int(os.environ.get("MQTT_PORT", "8883"))
MQTT_USER = os.environ.get("MQTT_USER") or None
MQTT_PASSWORD = os.environ.get("MQTT_PASSWORD") or None
# Password file wins over the env var — compose secrets land here so broker
# credentials never appear in `docker inspect` env (v4 T6, doc 17).
MQTT_PASSWORD_FILE = os.environ.get("MQTT_PASSWORD_FILE") or None
# CA bundle for the TLS listener (self-signed dev CA from `make certs`).
MQTT_CA_FILE = os.environ.get("MQTT_CA_FILE") or None
# what an enrolling gateway is told to dial (spec 5.1); host defaults to the
# hostname the enroll request arrived on
PUBLIC_MQTT_HOST = os.environ.get("PUBLIC_MQTT_HOST") or None
PUBLIC_MQTT_PORT = int(os.environ.get("PUBLIC_MQTT_PORT", "8883"))


def _read_secret(path: str | None) -> str | None:
    if not path:
        return None
    try:
        v = open(path).read().strip()  # noqa: SIM115 — one-shot read at import
        return v or None
    except OSError:
        return None


MQTT_PASSWORD = _read_secret(MQTT_PASSWORD_FILE) or MQTT_PASSWORD

# --- data-source secret box (spec 5.6) ---------------------------------------
# 32-byte AES-GCM key, stored base64 (or 64-char hex) in DATA_SOURCE_KEY_FILE.
# DEV/TEST ONLY: when the file is absent a fixed, publicly-known key is derived
# so `make up` and the tests work with zero setup. NEVER relied on in prod —
# _enforce_prod_env fails without a readable DATA_SOURCE_KEY_FILE.
def _load_data_source_key() -> bytes | None:
    import base64
    import hashlib
    raw = _read_secret(os.environ.get("DATA_SOURCE_KEY_FILE"))
    if raw:
        try:
            if len(raw) == 64:
                return bytes.fromhex(raw)
            key = base64.b64decode(raw + "=" * (-len(raw) % 4))
            if len(key) == 32:
                return key
        except ValueError:
            pass
        return hashlib.sha256(raw.encode()).digest()  # any passphrase -> 32 bytes
    if os.environ.get("APP_ENV", "dev") in ("dev", "test"):
        return hashlib.sha256(b"wds-dev-only-data-source-key").digest()
    return None


DATA_SOURCE_KEY = _load_data_source_key()

# --- vision model files and the converter spool (plan M1-04) -------------------
MODEL_DIR = os.environ.get("MODEL_DIR", "/data/models")
CONVERT_SPOOL = os.environ.get("CONVERT_SPOOL", "/data/convert")

# --- uploaded demo videos (plan M1-03) ------------------------------------------
VIDEO_DIR = os.environ.get("VIDEO_DIR", "/data/videos")
# --- uploaded plant models (.glb) — disk, or Garage/S3 when PLANT_S3_ENDPOINT is set
PLANT_DIR = os.environ.get("PLANT_DIR", "/data/plant")
PLANT_S3_ENDPOINT = os.environ.get("PLANT_S3_ENDPOINT") or None
PLANT_S3_BUCKET = os.environ.get("PLANT_S3_BUCKET", "wds-plant-models")
PLANT_S3_REGION = os.environ.get("PLANT_S3_REGION", "garage")
# durable copies of videos / model files / plant models (same Garage, own bucket)
ARTIFACT_S3_ENDPOINT = os.environ.get("ARTIFACT_S3_ENDPOINT") or PLANT_S3_ENDPOINT
ARTIFACT_S3_BUCKET = os.environ.get("ARTIFACT_S3_BUCKET", "wds-artifacts")


def _secret(name: str) -> str | None:
    f = os.environ.get(f"{name}_FILE")
    if f:
        with open(f, encoding="utf-8") as fh:
            return fh.read().strip()
    return os.environ.get(name) or None


PLANT_S3_KEY_ID = _secret("PLANT_S3_KEY_ID")
PLANT_S3_SECRET = _secret("PLANT_S3_SECRET")
ARTIFACT_S3_KEY_ID = _secret("ARTIFACT_S3_KEY_ID") or PLANT_S3_KEY_ID
ARTIFACT_S3_SECRET = _secret("ARTIFACT_S3_SECRET") or PLANT_S3_SECRET
# --- owner data exports + lifecycle (roadmap §12 8.2/8.3, §10/11) -----------
EXPORT_DIR = os.environ.get("EXPORT_DIR", "/data/exports")
EXPORT_MAX_BYTES = int(os.environ.get("EXPORT_MAX_BYTES", str(512 * 1024 * 1024)))
EXPORT_TTL_DAYS = float(os.environ.get("EXPORT_TTL_DAYS", "7"))
EXPORT_HISTORY_DAYS = int(os.environ.get("EXPORT_HISTORY_DAYS", "90"))
EXPORT_HISTORY_MAX_ROWS = int(os.environ.get("EXPORT_HISTORY_MAX_ROWS", "1000000"))
ORG_PURGE_AFTER_DAYS = float(os.environ.get("ORG_PURGE_AFTER_DAYS", "30"))
WEBHOOK_SWEEP_S = float(os.environ.get("WEBHOOK_SWEEP_S", "5"))
WEBHOOK_BATCH = int(os.environ.get("WEBHOOK_BATCH", "200"))
WEBHOOK_TIMEOUT_S = float(os.environ.get("WEBHOOK_TIMEOUT_S", "10"))
EXPORT_SWEEP_S = float(os.environ.get("EXPORT_SWEEP_S", "30"))
JOBS_WORKER_S = float(os.environ.get("JOBS_WORKER_S", "5"))
# how a GATEWAY reaches this backend for video downloads (compose: the service name)
EDGE_MEDIA_BASE_URL = (os.environ.get("EDGE_MEDIA_BASE_URL") or os.environ.get("PUBLIC_URL", "")
                       or "http://backend:8000").rstrip("/")

# --- dynamic-security admin channel (doc 17 §2/§6) -------------------------
DYNSEC_ADMIN_USER = os.environ.get("DYNSEC_ADMIN_USER", "svc-dynsec-admin")
DYNSEC_ADMIN_PASSWORD = _read_secret(
    os.environ.get("DYNSEC_ADMIN_PASSWORD_FILE")) \
    or os.environ.get("DYNSEC_ADMIN_PASSWORD") or None
SVC_BACKEND_PW_FILE = os.environ.get("SVC_BACKEND_PW_FILE") or None
TESTER_PW_FILE = os.environ.get("TESTER_PW_FILE") or None
EDGE_BOOTSTRAP_PW_FILE = os.environ.get("EDGE_BOOTSTRAP_PW_FILE") or None
DYNSEC_RECONCILE_S = float(os.environ.get("DYNSEC_RECONCILE_S", "60"))
# Rotation grace: how long the superseded credential stays enabled (doc 17 §5).
EDGE_CRED_GRACE_S = float(os.environ.get("EDGE_CRED_GRACE_S", "86400"))

CORS_ORIGIN = os.environ.get("CORS_ORIGIN", "http://localhost:5173")

# --- Postgres DSNs (ADR-13) ---------------------------------------------------
# The DSN may carry the password inline (host-side dev/tests) OR be given
# password-less with the password in a mounted file / env — compose uses the
# file form so credentials never appear in `docker inspect` (v4 T7).
WDS_APP_DSN = os.environ.get("WDS_APP_DSN") or None
WDS_SYSTEM_DSN = os.environ.get("WDS_SYSTEM_DSN") or None
WDS_APP_PASSWORD = _read_secret(os.environ.get("WDS_APP_PASSWORD_FILE")) \
    or os.environ.get("WDS_APP_PASSWORD") or None
WDS_SYSTEM_PASSWORD = _read_secret(os.environ.get("WDS_SYSTEM_PASSWORD_FILE")) \
    or os.environ.get("WDS_SYSTEM_PASSWORD") or None


# --- v1 compatibility shim (removed in phase 4, CONTRACT.v2) ---------------
# v1 topics (`plant1/...`) carry no tenant identity, so the v1 runtime is
# pinned to exactly one org/site/edge. These are the dev-seed ids (seed.py).
V1_SITE_CODE = os.environ.get("SITE", "plant1")
V1_EDGE_NAME = os.environ.get("EDGE_ID", "edge1")
V1_ORG_ID = UUID(os.environ.get("V1_ORG_ID", "0199d000-0000-7000-8000-00000000a001"))
V1_SITE_ID = UUID(os.environ.get("V1_SITE_ID", "0199d000-0000-7000-8000-00000000b001"))
V1_EDGE_ID = UUID(os.environ.get("V1_EDGE_ID", "0199d000-0000-7000-8000-00000000c001"))

# --- rate limiting (v4 T4; doc 16 row 7) -----------------------------------
# In-process token buckets (app/core/ratelimit.py) — per-process, single replica.
RATE_COMMANDS_PER_TAG = int(os.environ.get("RATE_COMMANDS_PER_TAG", "5"))   # per window, per user+tag
RATE_COMMANDS_WINDOW_S = float(os.environ.get("RATE_COMMANDS_WINDOW_S", "10"))
RATE_MUTATIONS_PER_USER = int(os.environ.get("RATE_MUTATIONS_PER_USER", "60"))  # per window, per user
RATE_MUTATIONS_WINDOW_S = float(os.environ.get("RATE_MUTATIONS_WINDOW_S", "60"))
RATE_ENROLL_PER_IP = int(os.environ.get("RATE_ENROLL_PER_IP", "10"))
RATE_ENROLL_WINDOW_S = float(os.environ.get("RATE_ENROLL_WINDOW_S", "60"))
RATE_LOGOUT_PER_IP = int(os.environ.get("RATE_LOGOUT_PER_IP", "10"))
RATE_LOGOUT_WINDOW_S = float(os.environ.get("RATE_LOGOUT_WINDOW_S", "60"))
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

# --- OIDC (v4 T5; ADR-12) ----------------------------------------------------
# The issuer is the PUBLIC URL of the realm — the same origin the browser
# uses (nginx proxies /realms/ + /resources/ + /admin/ to keycloak), so
# OIDC_ISSUER is the web origin + /realms/wds. JWKS is fetched server-side
# through OIDC_JWKS_URI, which points at the compose-internal hostname.
OIDC_ISSUER = os.environ.get("OIDC_ISSUER", "http://localhost:5173/realms/wds")
OIDC_AUDIENCE = os.environ.get("OIDC_AUDIENCE", "wds-api")
OIDC_CLIENT_ID = os.environ.get("OIDC_CLIENT_ID", "wds-web")
OIDC_JWKS_URI = os.environ.get("OIDC_JWKS_URI") or (
    f"{OIDC_ISSUER.rstrip('/')}/protocol/openid-connect/certs")
OIDC_REALM = OIDC_ISSUER.rstrip("/").rsplit("/", 1)[-1]
# Google/Microsoft sign-in is brokered by Keycloak (aliases `google` and
# `microsoft`); each is OFF unless BOTH values are set. Pushed into the realm
# by `python -m app.ops.provision_idp`.
# Public origin of the console (prod) — provision_idp adds it to wds-web.
PUBLIC_URL = os.environ.get("PUBLIC_URL", "").rstrip("/")
GOOGLE_CLIENT_ID = os.environ.get("GOOGLE_CLIENT_ID", "").strip()
# *_FILE wins (secret stays out of `docker inspect`, G9); env kept for dev.
GOOGLE_CLIENT_SECRET = (_read_secret(os.environ.get("GOOGLE_CLIENT_SECRET_FILE"))
                        or os.environ.get("GOOGLE_CLIENT_SECRET", "").strip())
MICROSOFT_CLIENT_ID = os.environ.get("MICROSOFT_CLIENT_ID", "").strip()
MICROSOFT_CLIENT_SECRET = (_read_secret(os.environ.get("MICROSOFT_CLIENT_SECRET_FILE"))
                           or os.environ.get("MICROSOFT_CLIENT_SECRET", "").strip())
IDPS: list[str] = [
    *(["google"] if GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET else []),
    *(["microsoft"] if MICROSOFT_CLIENT_ID and MICROSOFT_CLIENT_SECRET else []),
]
JWKS_TTL_S = float(os.environ.get("JWKS_TTL_S", "600"))        # ADR-12 §5
JWKS_REFETCH_MIN_S = float(os.environ.get("JWKS_REFETCH_MIN_S", "30"))
AUTHZ_TTL_S = float(os.environ.get("AUTHZ_TTL_S", "5"))        # ≤5s revocation SLA
# Step-up (spec 2026-10-19 §4): commands need acr=mfa signed in within this
# window. Always on outside dev/test; dev/test opt in (password-grant harness).
STEPUP_REQUIRED = APP_ENV not in ("dev", "test") or os.environ.get("STEPUP_REQUIRED") == "1"
STEPUP_MAX_AGE_S = int(os.environ.get("STEPUP_MAX_AGE_S", "900"))
# WS revalidation sweep (v4 T14, ADR-12 §7): a NOTIFY lost while the LISTEN
# connection reconnects is gone forever — connected clients are re-checked
# against revoked_sessions/disabled_at/memberships on this cadence, so the
# missed-notify worst case is this interval. Kept ≤ the 5 s SLA by default.
AUTHZ_SWEEP_S = float(os.environ.get("AUTHZ_SWEEP_S", "5"))
# X-Real-IP is trusted ONLY from loopback peers or these CIDRs — compose
# pins the nginx container address and lists it here (docker-compose.yml).
TRUSTED_PROXIES = [
    ipaddress.ip_network(ip.strip())
    for ip in os.environ.get("TRUSTED_PROXIES", "").split(",")
    if ip.strip()
]

EDGE_STALE_AFTER_S = 15.0
ALARM_FRESH_S = 15.0        # alarm engine ignores samples older than this (doc 16 / CONTRACT.v2 §6)
HISTORY_MAX_AGE_S = 8 * 3600
FUTURE_SKEW_S = 5.0
HISTORY_FLUSH_S = 1.0
HISTORY_FLUSH_ROWS = 500
HISTORY_PRUNE_S = float(os.environ.get("HISTORY_PRUNE_S", "300"))      # G3 retention job
HISTORY_PRUNE_BATCH = int(os.environ.get("HISTORY_PRUNE_BATCH", "10000"))
ROLLUP_REFRESH_S = float(os.environ.get("ROLLUP_REFRESH_S", "60"))  # 1m/1h rollup refresh
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


# ---------------------------------------------------------------------------
# Production fail-fast (v4 T7; doc 18 §6, doc 20 §3.5)
# ---------------------------------------------------------------------------
# `APP_ENV` keeps its dev default for DX — anything other than dev/test is
# held to PROD rules (fail-closed: a typo'd APP_ENV is strict, not silent).
# Under prod rules every required env must be present and no dev-default
# secret value may survive. This runs AT IMPORT so every entrypoint that
# touches config — uvicorn, seed_oidc, audit_cli, the migration script —
# refuses loudly instead of booting half-configured.
def _dsn_password(dsn: str) -> str | None:
    import urllib.parse
    try:
        return urllib.parse.urlsplit(dsn).password
    except ValueError:
        return None


def _readable(path: str | None) -> bool:
    """File-mounted secret is present, readable and non-empty."""
    if not path:
        return False
    try:
        return bool(open(path).read().strip())  # noqa: SIM115 — one-shot read
    except OSError:
        return False


def _enforce_prod_env() -> None:
    missing: list[str] = []
    dev_default: list[str] = []

    # Plain presence checks — endpoints + non-secret wiring that must be
    # chosen deliberately in prod (no silent localhost/dev fallbacks).
    for name in ("OIDC_ISSUER", "OIDC_JWKS_URI",
                 "WDS_APP_DSN", "WDS_SYSTEM_DSN",
                 "MQTT_USER", "MQTT_CA_FILE",
                 "KC_ADMIN", "TRUSTED_PROXIES"):
        if not os.environ.get(name):
            missing.append(name)
    # ALLOWED_ORIGINS must name at least one real origin — the same-origin
    # fallback is a dev convenience, not a prod posture.
    if not ALLOWED_ORIGINS:
        missing.append("ALLOWED_ORIGINS (non-empty origin list)")

    # File-mounted secrets (the *_FILE vars are the prod contract — an env
    # password would land in `docker inspect`, doc 17).
    for name in ("MQTT_PASSWORD_FILE", "DYNSEC_ADMIN_PASSWORD_FILE",
                 "SVC_BACKEND_PW_FILE", "EDGE_BOOTSTRAP_PW_FILE",
                 "DATA_SOURCE_KEY_FILE"):
        if not _readable(os.environ.get(name)):
            missing.append(f"{name} (missing/unreadable/empty)")

    # Effective DB passwords: file wins, DSN-embedded allowed — but neither
    # may be absent or a dev default.
    for dsn_name, file_name, dev_pw in (
            ("WDS_APP_DSN", "WDS_APP_PASSWORD_FILE", "app-dev-pass"),
            ("WDS_SYSTEM_DSN", "WDS_SYSTEM_PASSWORD_FILE", "system-dev-pass")):
        dsn = os.environ.get(dsn_name)
        if not dsn:
            continue  # already listed above
        pw = _read_secret(os.environ.get(file_name)) or _dsn_password(dsn)
        if not pw:
            missing.append(f"{file_name} (or a password embedded in {dsn_name})")
        elif "dev-pass" in pw:
            dev_default.append(f"{dsn_name}/{file_name}")

    # Keycloak admin (seed/realm bootstrap) — file or env, never the demo pw.
    kc_pw = _read_secret(os.environ.get("KC_ADMIN_PASSWORD_FILE")) \
        or os.environ.get("KC_ADMIN_PASSWORD")
    if not kc_pw:
        missing.append("KC_ADMIN_PASSWORD_FILE (or KC_ADMIN_PASSWORD)")
    elif "dev-pass" in kc_pw:
        dev_default.append("KC_ADMIN_PASSWORD")
    demo_pw = _read_secret(os.environ.get("KC_DEMO_PASSWORD_FILE")) \
        or os.environ.get("KC_DEMO_PASSWORD")
    if demo_pw == "kc-demo-pass":
        dev_default.append("KC_DEMO_PASSWORD")

    # Dev-default VALUES still configured (explicit or leaked via defaults).
    if OIDC_ISSUER == "http://localhost:5173/realms/wds":
        dev_default.append("OIDC_ISSUER")
    for file_name, dev_val in (
            ("WDS_APP_PASSWORD_FILE", "app-dev-pass"),
            ("WDS_SYSTEM_PASSWORD_FILE", "system-dev-pass"),
            ("KC_ADMIN_PASSWORD_FILE", "admin-dev-pass"),
            ("KC_DEMO_PASSWORD_FILE", "kc-demo-pass")):
        v = _read_secret(os.environ.get(file_name))
        if v and v == dev_val:
            dev_default.append(file_name)
    if _readable(MQTT_CA_FILE) is False and os.environ.get("MQTT_CA_FILE"):
        missing.append("MQTT_CA_FILE (unreadable)")

    if missing or dev_default:
        lines = [f"APP_ENV={APP_ENV} refuses to start (doc 18 §6, doc 20 §3.5):"]
        if missing:
            lines.append("  missing required env: " + ", ".join(missing))
        if dev_default:
            lines.append("  dev-default secrets still set: " + ", ".join(dev_default))
        lines.append("Set APP_ENV=dev for local development; production requires "
                     "APP_ENV=prod plus every secret above (.env.example §prod).")
        raise SystemExit("\n".join(lines))


if APP_ENV not in ("dev", "test"):
    _enforce_prod_env()

# --- outbound notifications (roadmap §7 Phase 3; app/alarming/notify.py) ------------
# Env-level SMTP is the fallback sender when an org has no email channel row;
# per-org channel config (SMTP overrides, tokens, webhook URLs) lives sealed in
# notification_channels.secrets_enc and never leaves the API.
SMTP_HOST = os.environ.get("SMTP_HOST", "").strip()
SMTP_PORT = int(os.environ.get("SMTP_PORT", "587"))
SMTP_USER = os.environ.get("SMTP_USER") or None
SMTP_PASSWORD = _read_secret(os.environ.get("SMTP_PASSWORD_FILE")) \
    or os.environ.get("SMTP_PASSWORD") or None
SMTP_FROM = os.environ.get("SMTP_FROM", "wds-alarms@localhost").strip()
SMTP_TLS = os.environ.get("SMTP_TLS", "starttls").strip().lower()  # starttls | none
NOTIFY_HTTP_TIMEOUT_S = float(os.environ.get("NOTIFY_HTTP_TIMEOUT_S", "10"))
NOTIFY_POLL_S = float(os.environ.get("NOTIFY_POLL_S", "5"))       # job-worker cadence
NOTIFY_MAX_CHANNELS = int(os.environ.get("NOTIFY_MAX_CHANNELS", "50"))
# Signed single-use ack links (§3.4): HMAC over alarm_id+jti+expiry, keyed by
# DATA_SOURCE_KEY like stream_sig/media_sig. Default validity 7 days.
ACK_TOKEN_TTL_S = float(os.environ.get("ACK_TOKEN_TTL_S", "604800"))
# Sweeper cadences (scheduled via main.py's _every)
ESCALATE_SWEEP_S = float(os.environ.get("ESCALATE_SWEEP_S", "30"))
SHELVE_SWEEP_S = float(os.environ.get("SHELVE_SWEEP_S", "60"))
VISION_ALARM_SWEEP_S = float(os.environ.get("VISION_ALARM_SWEEP_S", "30"))
# Built-in vision alarm thresholds (§9.9) — constants, not per-camera config.
VISION_OFFLINE_AFTER_S = float(os.environ.get("VISION_OFFLINE_AFTER_S", "60"))
VISION_LATENCY_BUDGET_MS = float(os.environ.get("VISION_LATENCY_BUDGET_MS", "500"))
VISION_GPU_HOURS_PCT = float(os.environ.get("VISION_GPU_HOURS_PCT", "80"))

# --- external AI inference (inference.py) — empty URL = feature off ---
INFERENCE_URL = os.environ.get("INFERENCE_URL", "").strip()
INFERENCE_API_KEY = _read_secret(os.environ.get("INFERENCE_API_KEY_FILE")) or os.environ.get("INFERENCE_API_KEY", "")
INFERENCE_PERIOD_S = float(os.environ.get("INFERENCE_PERIOD_S", "10"))
INFERENCE_TIMEOUT_S = float(os.environ.get("INFERENCE_TIMEOUT_S", "5"))

# --- legal consent (roadmap 8.1) — the doc versions a user must have on
# file before creating an org; bumping a version re-asks every user ---
CONSENT_VERSION = {
    "tos": os.environ.get("CONSENT_TOS_VERSION", "2026-10-16"),
    "privacy": os.environ.get("CONSENT_PRIVACY_VERSION", "2026-10-16"),
}
