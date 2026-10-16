"""Outbound notifications + alarm lifecycle (roadmap §7 Phase 3).

Channels (§3.1): email (stdlib smtplib via executor, STARTTLS), LINE Messaging
API push, generic webhook (HMAC-SHA256 over the body, header
``X-WDS-Signature: sha256=<hex>``), Teams/Slack incoming-webhook JSON. No new
dependencies — HTTP goes through urllib in the default executor.

Secrets: channel config is split at the API boundary — non-secret fields in
``config`` (jsonb), credentials in ``secrets_enc`` (AES-GCM, same box as
data-source secrets). Nothing in this module returns or logs ``secrets_enc``
contents; delivery rows store a redacted ``target`` (host / recipient count).

Delivery path: the alarm engine enqueues ``notify_send`` jobs (jobs.py queue)
on raise/clear; ``notify_jobs_worker`` claims ``notify_send`` + the contract
``send_email`` kind, resolves channels (explicit ids, team-bound channels, the
on-call member of a team), applies send-time suppression (downtime windows,
shelved alarms) and per-episode-per-channel dedup (``alarm_notify_state``),
then records every attempt in ``notification_deliveries``.

Sweepers (scheduled by main.py's ``_every``):
  - ``escalate_sweep`` — unacked, unshelved alarm past a level's
    ``after_minutes`` fires the next escalation level (§3.3);
  - ``shelve_sweep`` — re-opens alarms whose shelf expired (§3.5);
  - ``vision_alarm_sweep`` — built-in vision alarms (§9.9) evaluated against
    the frame relay's latest camera stats.

Ack links (§3.4): single-use HMAC token ``v1.<org>.<alarm>.<jti>.<exp>.<sig>``
signed with the DATA_SOURCE_KEY-derived key (same pattern as
vision.relay.stream_sig). The jti row in ``ack_tokens`` makes it single-use;
the ack still requires an authenticated operator — an expired session gets a
401 ``auth_required`` so the client can run sign-in and retry the link.
"""

from __future__ import annotations

import asyncio
import base64
import hashlib
import hmac
import json
import logging
import math
import re
import smtplib
import time
import urllib.error
import urllib.request
import uuid
from datetime import datetime, timedelta, timezone
from email.message import EmailMessage
from typing import Literal
from urllib.parse import urlsplit
from uuid import UUID

import asyncpg
from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel, Field, field_validator

from . import config, jobs
from .datasources import secretbox
from .db import audit
from .db.context import TenantConn, active_org_ids, global_tx, tenant_tx
from .db.util import iso_z, utcnow

log = logging.getLogger("backend.notify")
router = APIRouter()


def _m():
    from . import main
    return main


async def _user(request: Request):
    return await _m().require_user(request)


SEV_RANK = {"info": 0, "warning": 1, "critical": 2}
CHANNEL_TYPES = frozenset({"email", "line", "webhook", "teams", "slack"})
MAX_RECIPIENTS = 20
MAX_ATTACHMENTS = 5
MAX_ATTACHMENT_BYTES = 2 * 1024 * 1024
MAX_CHANNELS_PER_ORG = 50


# ---------------------------------------------------------------------------
# Channel config validation + secret split (write path)
# ---------------------------------------------------------------------------
def _emails(v) -> list[str]:
    if not isinstance(v, list) or not (1 <= len(v) <= MAX_RECIPIENTS):
        raise ValueError("to must be 1..20 addresses")
    out = []
    for a in v:
        a = str(a).strip()[:320]
        if not re.match(r"^[^@\s]+@[^@\s]+$", a):
            raise ValueError("invalid recipient address")
        out.append(a)
    return out


def _url_secret(v, what="url") -> str:
    if not isinstance(v, str) or len(v) > 500:
        raise ValueError(f"{what} must be a string <= 500 chars")
    u = urlsplit(v)
    if u.scheme not in ("https", "http") or not u.hostname:
        raise ValueError(f"{what} must be http(s) with a host")
    return v


def _split_config(type_: str, config: dict, secrets_in: dict | None,
                  require_secrets: bool = True) -> tuple[dict, dict]:
    """Validate + split a channel write into (public config, secret box dict).
    Raises ValueError -> caller maps to 422. All strings bounded.
    `require_secrets=False` is the PATCH-without-secrets path: public fields
    are validated, the secret box is left for the caller to keep as-is."""
    config = dict(config or {})
    secrets_in = dict(secrets_in or {})
    pub: dict = {}
    sec: dict = {}
    if type_ == "email":
        pub["to"] = _emails(config.get("to"))
        smtp = config.get("smtp")
        if isinstance(smtp, dict):
            host = str(smtp.get("host", ""))[:200]
            port = smtp.get("port", 587)
            if not isinstance(port, int) or isinstance(port, bool) or not (1 <= port <= 65535):
                raise ValueError("smtp.port out of range")
            pub["smtp"] = {"host": host, "port": port,
                           "user": str(smtp.get("user", ""))[:200],
                           "from": str(smtp.get("from", ""))[:320],
                           "tls": bool(smtp.get("tls", True))}
        if secrets_in.get("smtp_pass"):
            sec["smtp_pass"] = str(secrets_in["smtp_pass"])[:400]
    elif type_ == "line":
        to = config.get("to")
        if not isinstance(to, str) or not (1 <= len(to) <= 100):
            raise ValueError("line channel needs a `to` (user/group/room id)")
        pub["to"] = to
        tok = secrets_in.get("token")
        if require_secrets and (not isinstance(tok, str) or not (10 <= len(tok) <= 400)):
            raise ValueError("line channel needs secrets.token (channel access token)")
        if isinstance(tok, str) and 10 <= len(tok) <= 400:
            sec["token"] = tok
    elif type_ in ("webhook", "teams", "slack"):
        if require_secrets or secrets_in.get("url"):
            sec["url"] = _url_secret(secrets_in.get("url"))
        if type_ == "webhook" and secrets_in.get("secret"):
            sec["secret"] = str(secrets_in["secret"])[:200]
    else:  # guarded by CHANNEL_TYPES before this is reached
        raise ValueError("unknown channel type")
    if len(json.dumps(pub)) > 4000 or len(json.dumps(sec)) > 4000:
        raise ValueError("channel config too large")
    return pub, sec


def _target_hint(type_: str, pub: dict, sec: dict) -> str:
    """Redacted delivery target for the delivery log — never the URL/token."""
    if type_ == "email":
        return f"{len(pub.get('to') or [])} recipient(s)"
    if type_ == "line":
        return "line:push"
    u = urlsplit(sec.get("url", ""))
    return u.hostname or "webhook"


# ---------------------------------------------------------------------------
# Blocking senders — always called via run_in_executor
# ---------------------------------------------------------------------------
def _smtp_send(smtp: dict, to: list[str], subject: str, body: str,
               attachments: list[dict]) -> None:
    msg = EmailMessage()
    msg["From"] = smtp["from"]
    msg["To"] = ", ".join(to)
    msg["Subject"] = subject
    msg.set_content(body[:20000])
    for att in attachments[:MAX_ATTACHMENTS]:
        raw = base64.b64decode(att["content_b64"], validate=True)
        if len(raw) > MAX_ATTACHMENT_BYTES:
            raise ValueError("attachment too large")
        ctype = str(att.get("content_type") or "application/octet-stream")
        maintype, _, subtype = ctype.partition("/")
        msg.add_attachment(raw, maintype=maintype or "application",
                           subtype=subtype or "octet-stream",
                           filename=str(att.get("name") or "attachment")[:200])
    timeout = config.NOTIFY_HTTP_TIMEOUT_S
    with smtplib.SMTP(smtp["host"], smtp["port"], timeout=timeout) as s:
        s.ehlo()
        if smtp.get("tls"):
            s.starttls()
            s.ehlo()
        if smtp.get("user"):
            s.login(smtp["user"], smtp.get("password") or "")
        s.send_message(msg)


def _http_post(url: str, body: bytes, headers: dict) -> int:
    req = urllib.request.Request(url, data=body, headers=dict(headers), method="POST")
    with urllib.request.urlopen(req, timeout=config.NOTIFY_HTTP_TIMEOUT_S) as r:
        return r.status


async def _send_email_async(smtp: dict, to: list[str], subject: str, body: str,
                            attachments: list[dict] | None = None) -> None:
    if not smtp.get("host"):
        raise RuntimeError("smtp_not_configured")
    await asyncio.get_running_loop().run_in_executor(
        None, _smtp_send, smtp, to, subject, body, attachments or [])


async def _http_post_async(url: str, body: bytes, headers: dict) -> int:
    return await asyncio.get_running_loop().run_in_executor(
        None, _http_post, url, body, headers)


def _smtp_from_channel(pub: dict, sec: dict) -> dict:
    """Per-channel SMTP override, else the env fallback (config.SMTP_*)."""
    over = pub.get("smtp") or {}
    return {
        "host": over.get("host") or config.SMTP_HOST,
        "port": over.get("port") or config.SMTP_PORT,
        "user": over.get("user") or config.SMTP_USER,
        "password": sec.get("smtp_pass") or config.SMTP_PASSWORD,
        "from": over.get("from") or config.SMTP_FROM,
        "tls": over.get("tls", config.SMTP_TLS == "starttls"),
    }


async def send_channel(channel: dict, subject: str, text: str) -> str:
    """Deliver one message through one channel row (dict with config +
    secrets_enc). Returns the redacted target hint; raises on failure."""
    pub = channel["config"] if isinstance(channel["config"], dict) else {}
    sec = secretbox.open_(channel["secrets_enc"]) if channel["secrets_enc"] else {}
    t = channel["type"]
    if t == "email":
        smtp = _smtp_from_channel(pub, sec)
        await _send_email_async(smtp, pub.get("to") or [], subject, text)
    elif t == "line":
        await _http_post_async(
            "https://api.line.me/v2/bot/message/push",
            json.dumps({"to": pub["to"],
                        "messages": [{"type": "text", "text": f"{subject}\n{text}"[:4800]}]}
                       ).encode(),
            {"Content-Type": "application/json",
             "Authorization": f"Bearer {sec['token']}"})
    else:
        body = ({"text": f"{subject}\n{text}"} if t in ("teams", "slack")
                else {"subject": subject, "text": text, "at": iso_z()})
        raw = json.dumps(body).encode()
        headers = {"Content-Type": "application/json"}
        if t == "webhook" and sec.get("secret"):
            sig = hmac.new(sec["secret"].encode(), raw, hashlib.sha256).hexdigest()
            headers["X-WDS-Signature"] = f"sha256={sig}"
        await _http_post_async(sec["url"], raw, headers)
    return _target_hint(t, pub, sec)


# ---------------------------------------------------------------------------
# Ack links (§3.4) — single-use HMAC token; jti row makes replay impossible
# ---------------------------------------------------------------------------
def _ack_key() -> bytes:
    return hashlib.sha256(config.DATA_SOURCE_KEY + b"|ack-link").digest()


def _ack_sig(org_id: UUID, alarm_id: UUID, jti: UUID, exp: int) -> str:
    return hmac.new(_ack_key(), f"ack:{org_id}:{alarm_id}:{jti}:{exp}".encode(),
                    hashlib.sha256).hexdigest()


def make_ack_token(org_id: UUID, alarm_id: UUID, jti: UUID, exp: int) -> str:
    return f"v1.{org_id.hex}.{alarm_id.hex}.{jti.hex}.{exp}.{_ack_sig(org_id, alarm_id, jti, exp)}"


_TOKEN_RE = re.compile(
    r"^v1\.([0-9a-f]{32})\.([0-9a-f]{32})\.([0-9a-f]{32})\.(\d{6,14})\.([0-9a-f]{64})$")


def parse_ack_token(token: str) -> tuple[UUID, UUID, UUID, int] | None:
    """Structural + signature + expiry check. Single-use is enforced by the
    ack_tokens row, not here. Returns (org, alarm, jti, exp) or None."""
    mt = _TOKEN_RE.match(token or "")
    if not mt:
        return None
    org_id, alarm_id, jti = UUID(mt.group(1)), UUID(mt.group(2)), UUID(mt.group(3))
    exp = int(mt.group(4))
    if exp < time.time():
        return None
    if not hmac.compare_digest(mt.group(5), _ack_sig(org_id, alarm_id, jti, exp)):
        return None
    return org_id, alarm_id, jti, exp


async def _issue_ack_link(tc: TenantConn, alarm_id: UUID, created_by: UUID | None,
                          ttl_s: float | None = None) -> str:
    """Insert the jti row and return the API path (tenant tx held by caller)."""
    jti = uuid.uuid4()
    exp = int(time.time() + (ttl_s or config.ACK_TOKEN_TTL_S))
    await tc.execute(
        "INSERT INTO ack_tokens(jti, org_id, alarm_id, expires_at, created_by)"
        " VALUES ($1,$2,$3,to_timestamp($4),$5)",
        jti, tc.org_id, alarm_id, float(exp), created_by)
    return f"/api/v1/ack/{make_ack_token(tc.org_id, alarm_id, jti, exp)}"


# ---------------------------------------------------------------------------
# On-call resolution + escalation policy shape
# ---------------------------------------------------------------------------
async def resolve_oncall(tc: TenantConn, team_id: UUID) -> UUID | None:
    """Current on-call member of a team: an active override wins, else the
    weekly rotation index anchored at `anchor`."""
    row = await tc.fetchrow(
        "SELECT user_id FROM oncall_overrides WHERE team_id=$1"
        " AND starts_at <= now() AND ends_at > now() ORDER BY starts_at DESC LIMIT 1",
        team_id)
    if row:
        return row["user_id"]
    rot = await tc.fetchrow(
        "SELECT user_ids, anchor, handoff_s FROM oncall_rotations WHERE team_id=$1", team_id)
    if not rot or not rot["user_ids"]:
        return None
    ids = list(rot["user_ids"])
    weeks = math.floor((utcnow() - rot["anchor"]).total_seconds() / rot["handoff_s"])
    return ids[weeks % len(ids)]


def _levels(v) -> list[dict]:
    """Validate escalation levels: [{after_minutes, channel_ids?, team_ids?,
    oncall_team?}]; level 1's delay counts from raise, later levels from when
    the previous level fired. after_minutes 1..10080, strictly increasing."""
    if not isinstance(v, list) or not (1 <= len(v) <= 10):
        raise ValueError("levels must be 1..10 entries")
    out = []
    prev = -1
    for lv in v:
        if not isinstance(lv, dict):
            raise ValueError("level must be an object")
        m = lv.get("after_minutes")
        if not isinstance(m, (int, float)) or isinstance(m, bool) or not (1 <= m <= 10080):
            raise ValueError("after_minutes must be 1..10080")
        if m <= prev:
            raise ValueError("after_minutes must be strictly increasing")
        prev = m
        def _ids(k):
            ids = lv.get(k) or []
            if not isinstance(ids, list) or len(ids) > 20:
                raise ValueError(f"{k} must be <= 20 ids")
            try:
                return [str(UUID(str(x))) for x in ids]
            except ValueError:
                raise ValueError(f"{k} must be uuids") from None
        oncall = lv.get("oncall_team")
        out.append({"after_minutes": int(m), "channel_ids": _ids("channel_ids"),
                    "team_ids": _ids("team_ids"),
                    "oncall_team": str(UUID(str(oncall))) if oncall else None})
    return out


# ---------------------------------------------------------------------------
# Job workers — `notify_send` (alarm events) + `send_email` (contract kind)
# ---------------------------------------------------------------------------
JOB_KINDS = ("notify_send", "send_email")


# wds_app has no SELECT on secrets_enc (0026: write-only) - `SELECT *` or
# RETURNING * as the app role is "permission denied". Sealed credentials are
# read through wds_system, only on the send path and for has_secrets.
_CH_COLS = ("id, org_id, team_id, name, type, config, enabled, created_by,"
            " created_at, updated_at")


async def _sealed(pools, org_id: UUID, ids) -> dict:
    ids = list(ids)
    if not ids:
        return {}
    async with tenant_tx(pools.system, org_id) as tc:
        rows = await tc.fetch(
            "SELECT id, secrets_enc FROM notification_channels"
            " WHERE id = ANY($1::uuid[])", ids)
    return {r["id"]: r["secrets_enc"] for r in rows}


async def _attach_secrets(pools, org_id: UUID, channels: list[dict]) -> list[dict]:
    sealed = await _sealed(pools, org_id, [c["id"] for c in channels])
    for c in channels:
        c["secrets_enc"] = sealed.get(c["id"])
    return channels


async def _record_delivery(conn, org_id: UUID, channel_id, alarm_id, kind: str,
                           target: str, status: str, attempts: int = 1,
                           error: str | None = None) -> None:
    err = (error or "")[:200] if error else None
    # never persist tokens/URLs in error text — host-level detail only
    if err and ("http" in err or "token" in err.lower()):
        err = "delivery failed"
    await conn.execute(
        "INSERT INTO notification_deliveries(org_id, channel_id, alarm_id, kind,"
        " target, status, attempts, last_error) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)",
        org_id, channel_id, alarm_id, kind, target[:300], status, attempts, err)


async def _dedup(tc: TenantConn, episode: str, channel_id, kind: str) -> bool:
    """True when this episode+channel+kind was already sent."""
    return await tc.fetchval(
        "INSERT INTO alarm_notify_state(org_id, episode, channel_id, kind)"
        " VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING RETURNING 1",
        tc.org_id, episode, channel_id, kind) is None


async def _alarm_muted(tc: TenantConn, alarm_id: UUID) -> str | None:
    """Send-time suppression: shelved alarm or an active downtime covering its
    rule. Returns the reason string or None."""
    return await tc.fetchval(
        "SELECT CASE WHEN a.shelved_until IS NOT NULL AND a.shelved_until > now()"
        " THEN 'shelved'"
        " WHEN EXISTS (SELECT 1 FROM downtimes d WHERE"
        "   (d.rule_id IS NULL OR d.rule_id = a.rule_id) AND ("
        "   (now() >= d.starts_at AND now() < d.ends_at) OR (d.recurring AND now() >= d.starts_at"
        "   AND mod(extract(epoch FROM now() - d.starts_at), 604800)"
        "     < extract(epoch FROM d.ends_at - d.starts_at)))) THEN 'downtime'"
        " ELSE NULL END FROM alarms a WHERE a.id=$1", alarm_id)


async def _channels_for_targets(tc: TenantConn, targets: dict) -> list[dict]:
    """Resolve notify targets to channel rows: explicit channel ids + every
    enabled channel bound to a listed team."""
    cids = [str(UUID(str(x))) for x in (targets.get("channel_ids") or [])][:20]
    tids = [str(UUID(str(x))) for x in (targets.get("team_ids") or [])][:20]
    if not cids and not tids:
        return []
    rows = await tc.fetch(
        f"SELECT {_CH_COLS} FROM notification_channels WHERE enabled AND ("
        " id = ANY($1::uuid[]) OR team_id = ANY($2::uuid[]))", cids, tids)
    return [dict(r) for r in rows][:25]


async def _alarm_message(tc: TenantConn, alarm_id: UUID, event: str,
                         level: int | None = None) -> tuple[str, str]:
    r = await tc.fetchrow(
        "SELECT a.severity, a.raised_at, a.state, r.name AS rule, t.path AS tag"
        " FROM alarms a JOIN alarm_rules r ON r.id=a.rule_id"
        " JOIN tags t ON t.id=a.tag_id AND t.org_id=a.org_id WHERE a.id=$1", alarm_id)
    if r is None:
        return "Alarm", "alarm event"
    what = {"raised": "raised", "cleared": "cleared", "escalation": "still unacknowledged"}.get(
        event, event)
    subject = f"[{r['severity']}] {r['rule']} {what}" + (
        f" (level {level})" if event == "escalation" and level else "")
    body = (f"Rule: {r['rule']}\nSignal: {r['tag']}\nSeverity: {r['severity']}\n"
            f"Raised: {iso_z(r['raised_at'])}\nState: {r['state']}")
    return subject[:300], body


async def _deliver_to_channels(tc: TenantConn, channels: list[dict], episode: str,
                               dedup_kind: str, delivery_kind: str, alarm_id,
                               subject: str, text: str) -> int:
    """Send to each channel with per-episode dedup + delivery logging.
    Returns the number of failures (caller retries the job on >0)."""
    failures = 0
    for ch in channels:
        if await _dedup(tc, episode, ch["id"], dedup_kind):
            continue
        try:
            target = await send_channel(ch, subject, text)
            await _record_delivery(tc.conn, tc.org_id, ch["id"], alarm_id,
                                   delivery_kind, target, "sent")
        except Exception as e:  # noqa: BLE001 — one bad channel must not stop the rest
            failures += 1
            log.warning("notify send failed", extra={"channel_id": str(ch["id"]),
                                                     "type": ch["type"],
                                                     "err": type(e).__name__})
            await _record_delivery(tc.conn, tc.org_id, ch["id"], alarm_id,
                                   delivery_kind, "?", "failed",
                                   error=type(e).__name__)
    return failures


async def _deliver_oncall_email(tc: TenantConn, pools, team_id: UUID, episode: str,
                                kind: str, alarm_id, subject: str, text: str) -> int:
    """Route to a team's current on-call member: their user email via the
    org's first enabled email channel."""
    uid = await resolve_oncall(tc, team_id)
    if uid is None:
        return 0
    email = await tc.fetchval("SELECT email FROM users WHERE id=$1", uid)
    ch = await tc.fetchrow(
        f"SELECT {_CH_COLS} FROM notification_channels WHERE enabled AND type='email'"
        " ORDER BY created_at LIMIT 1")
    if not email or ch is None:
        return 0
    ch = (await _attach_secrets(pools, tc.org_id, [dict(ch)]))[0]
    if await _dedup(tc, episode, ch["id"], kind):
        return 0
    pub = dict(ch["config"]) if isinstance(ch["config"], dict) else {}
    sec = secretbox.open_(ch["secrets_enc"]) if ch["secrets_enc"] else {}
    try:
        await _send_email_async(_smtp_from_channel(pub, sec), [email], subject, text)
        await _record_delivery(tc.conn, tc.org_id, ch["id"], alarm_id, kind,
                               "on-call member", "sent")
        return 0
    except Exception as e:  # noqa: BLE001
        log.warning("on-call notify failed", extra={"err": type(e).__name__})
        await _record_delivery(tc.conn, tc.org_id, ch["id"], alarm_id, kind,
                               "on-call member", "failed", error=type(e).__name__)
        return 1


async def _job_notify_send(st, payload: dict) -> None:
    org_id = UUID(str(payload["org_id"]))
    # coerce to the notification_deliveries CHECK set — a bogus event would
    # otherwise violate the constraint and retry until dead
    event = str(payload.get("event", "raised"))[:20]
    if event not in ("raised", "cleared", "escalation", "vision", "test", "email"):
        event = "raised"
    episode = str(payload.get("episode") or payload.get("alarm_id") or "")[:200]
    targets = payload.get("targets") or {}
    alarm_id = None
    if payload.get("alarm_id"):
        try:
            alarm_id = UUID(str(payload["alarm_id"]))
        except ValueError:
            alarm_id = None
    if not episode:
        raise ValueError("notify_send needs an episode key")
    # wds_app tenant tx: the worker reads users.email / memberships /
    # plan_limits which wds_system's column grants deliberately exclude.
    async with tenant_tx(st.pools.app, org_id) as tc:
        if alarm_id is not None:
            muted = await _alarm_muted(tc, alarm_id)
            if muted:
                # §3.2: suppressed during downtime, but the alarm row stands.
                await _record_delivery(tc.conn, org_id, None, alarm_id, event,
                                       muted, "suppressed")
                return
            subject, text = await _alarm_message(
                tc, alarm_id, event, payload.get("level"))
            if event in ("raised", "escalation"):
                link = await _issue_ack_link(tc, alarm_id, None)
                base = config.PUBLIC_URL or ""
                text += f"\nAcknowledge: {base}{link}"
        else:  # built-in vision alarms carry their own text
            subject = str(payload.get("title") or "Vision alarm")[:300]
            text = str(payload.get("detail") or "")[:4000]
        # dedup kinds are narrowed to the alarm_notify_state CHECK set;
        # the delivery log keeps the finer-grained kind.
        dedup_kind = "vision" if event == "vision" else (
            "cleared" if event == "cleared" else "raised")
        delivery_kind = {"vision": "vision", "cleared": "cleared",
                         "escalation": "escalation"}.get(event, "raised")
        failures = 0
        channels = await _channels_for_targets(tc, targets)
        if not channels and event == "vision":
            rows = await tc.fetch(
                f"SELECT {_CH_COLS} FROM notification_channels WHERE enabled"
                " ORDER BY created_at LIMIT 25")
            channels = [dict(r) for r in rows]
        await _attach_secrets(st.pools, org_id, channels)
        failures += await _deliver_to_channels(
            tc, channels, episode, dedup_kind, delivery_kind,
            alarm_id, subject, text)
        oncall = targets.get("oncall_team")
        if oncall:
            failures += await _deliver_oncall_email(
                tc, st.pools, UUID(str(oncall)), episode, "raised", alarm_id, subject, text)
        if failures:
            raise RuntimeError(f"{failures} channel(s) failed")


def _email_payload(p: dict) -> tuple[list[str], str, str, list[dict]]:
    """Validate the contract send_email payload (bounded)."""
    to = p.get("to")
    if isinstance(to, str):
        to = [to]
    to = _emails(to)
    subject = str(p.get("subject") or "")[:300]
    body = str(p.get("body") or "")[:20000]
    atts = []
    for a in (p.get("attachments") or [])[:MAX_ATTACHMENTS]:
        if not isinstance(a, dict) or not a.get("content_b64"):
            continue
        if len(str(a["content_b64"])) > int(MAX_ATTACHMENT_BYTES * 1.4):
            raise ValueError("attachment too large")
        atts.append({"name": str(a.get("name") or "attachment")[:200],
                     "content_b64": str(a["content_b64"]),
                     "content_type": str(a.get("content_type") or "application/octet-stream")[:100]})
    if sum(len(a["content_b64"]) for a in atts) > 3 * MAX_ATTACHMENT_BYTES:
        raise ValueError("attachments too large")
    return to, subject, body, atts


async def _job_send_email(st, payload: dict) -> None:
    """Contract kind `send_email`: {org_id?, to, subject, body, attachments[]}.
    Org-scoped jobs send via the org's first enabled email channel (its SMTP
    override or the env fallback) and record a delivery row; org-less jobs go
    straight to the env SMTP config."""
    to, subject, body, atts = _email_payload(payload)
    org_id = payload.get("org_id")
    if org_id:
        org_id = UUID(str(org_id))
        async with tenant_tx(st.pools.app, org_id) as tc:
            ch = await tc.fetchrow(
                f"SELECT {_CH_COLS} FROM notification_channels WHERE enabled AND type='email'"
                " ORDER BY created_at LIMIT 1")
            if ch:
                ch = (await _attach_secrets(st.pools, org_id, [dict(ch)]))[0]
            smtp = {"host": config.SMTP_HOST, "port": config.SMTP_PORT,
                    "user": config.SMTP_USER, "password": config.SMTP_PASSWORD,
                    "from": config.SMTP_FROM, "tls": config.SMTP_TLS == "starttls"}
            ch_id = None
            if ch:
                pub = ch["config"] if isinstance(ch["config"], dict) else {}
                sec = secretbox.open_(ch["secrets_enc"]) if ch["secrets_enc"] else {}
                smtp = _smtp_from_channel(pub, sec)
                ch_id = ch["id"]
            try:
                await _send_email_async(smtp, to, subject, body, atts)
                await _record_delivery(tc.conn, org_id, ch_id, None, "email",
                                       f"{len(to)} recipient(s)", "sent")
            except Exception as e:  # noqa: BLE001
                await _record_delivery(tc.conn, org_id, ch_id, None, "email",
                                       f"{len(to)} recipient(s)", "failed",
                                       error=type(e).__name__)
                raise
    else:
        await _send_email_async(
            {"host": config.SMTP_HOST, "port": config.SMTP_PORT,
             "user": config.SMTP_USER, "password": config.SMTP_PASSWORD,
             "from": config.SMTP_FROM, "tls": config.SMTP_TLS == "starttls"},
            to, subject, body, atts)


async def notify_jobs_worker(st) -> None:
    """One claim+deliver pass over the jobs queue. Scheduled by _every;
    jobs.fail's linear backoff provides the retry behaviour (§3.1)."""
    async with global_tx(st.pools.system) as conn:
        claimed = await jobs.claim_due(conn, JOB_KINDS, limit=10)
    for job in claimed:
        try:
            payload = job["payload"]
            payload = json.loads(payload) if isinstance(payload, str) else payload
            if job["kind"] == "send_email":
                await _job_send_email(st, payload)
            elif job["kind"] == "notify_send":
                await _job_notify_send(st, payload)
            async with global_tx(st.pools.system) as conn:
                await jobs.complete(conn, job["id"])
        except Exception as e:  # noqa: BLE001 — retry via backoff
            log.warning("notify job failed", extra={"job": job["id"],
                                                    "kind": job["kind"],
                                                    "err": type(e).__name__})
            async with global_tx(st.pools.system) as conn:
                await jobs.fail(conn, job["id"], type(e).__name__)


# ---------------------------------------------------------------------------
# Sweeps — escalation levels, shelf expiry, built-in vision alarms
# ---------------------------------------------------------------------------
async def escalate_sweep(st) -> None:
    """Unacked + unshelved alarm past its policy level's after_minutes ->
    notify that level. An ack stops escalation because state leaves 'active'."""
    for org_id in await active_org_ids(st.pools.system):
        async with tenant_tx(st.pools.app, org_id) as tc:
            policies = await tc.fetch(
                "SELECT rule_id, levels FROM escalation_policies WHERE enabled")
            by_rule = {p["rule_id"]: p["levels"] for p in policies if p["rule_id"]}
            default = next((p["levels"] for p in policies if p["rule_id"] is None), None)
            if not policies:
                continue
            alarms = await tc.fetch(
                "SELECT id, rule_id, raised_at, esc_level, esc_level_at FROM alarms"
                " WHERE state='active' AND (shelved_until IS NULL OR shelved_until < now())")
            for a in alarms:
                levels = by_rule.get(a["rule_id"], default)
                if not levels or a["esc_level"] >= len(levels):
                    continue
                lv = levels[a["esc_level"]]
                # level 1's delay counts from raise; later levels count from
                # when the previous level fired
                base = a["esc_level_at"] or a["raised_at"]
                due = base + timedelta(minutes=lv.get("after_minutes", 0))
                if due > utcnow():
                    continue
                level = a["esc_level"] + 1
                targets = {"channel_ids": lv.get("channel_ids") or [],
                           "team_ids": lv.get("team_ids") or []}
                if lv.get("oncall_team"):
                    targets["oncall_team"] = lv["oncall_team"]
                await jobs.enqueue(tc.conn, "notify_send", {
                    "org_id": str(org_id), "alarm_id": str(a["id"]),
                    "episode": f"{a['id']}:esc{level}", "event": "escalation",
                    "level": level, "targets": targets}, org_id=org_id)
                await tc.execute(
                    "UPDATE alarms SET esc_level=$2, esc_level_at=now() WHERE id=$1",
                    a["id"], level)
                await audit.append(tc, "escalation-sweeper", "alarm.escalated",
                                   {"alarm_id": str(a["id"])}, {"level": level})


async def shelve_sweep(st) -> None:
    """Re-open alarms whose shelf expired (§3.5): clear shelved_until, leave an
    'unshelve' event + audit row."""
    for org_id in await active_org_ids(st.pools.system):
        async with tenant_tx(st.pools.app, org_id) as tc:
            rows = await tc.fetch(
                "SELECT id FROM alarms WHERE shelved_until IS NOT NULL"
                " AND shelved_until < now()")
            for r in rows:
                await tc.execute("UPDATE alarms SET shelved_until=NULL WHERE id=$1", r["id"])
                await tc.execute(
                    "INSERT INTO alarm_events(org_id, alarm_id, kind, author)"
                    " VALUES ($1,$2,'unshelve','system')", org_id, r["id"])
                await audit.append(tc, "shelve-sweeper", "alarm.unshelved",
                                   {"alarm_id": str(r["id"])})


# §9.9 built-in vision alarms. Conditions map to severities; thresholds are
# constants in config (VISION_*). Episodes are 'vision:<camera>:<condition>';
# alarm_notify_state rows are deleted on recovery so a re-raise notifies again.
VISION_CONDITIONS = ("camera_offline", "model_load_failed", "latency_budget",
                     "cloud_fallback", "gpu_budget")
VISION_SEVERITY = {"camera_offline": "critical", "model_load_failed": "critical",
                   "latency_budget": "warning", "cloud_fallback": "warning",
                   "gpu_budget": "warning"}


def _vision_conditions(cam: dict, stat: dict, gpu_pct: float | None) -> list[str]:
    """Map one camera's row + latest relay stat to active builtin conditions.
    Offline = fresh stat missing AND the persisted status isn't 'ok', or the
    persisted status_at went stale (> VISION_OFFLINE_AFTER_S)."""
    out = []
    stale_stat = not stat
    status_at = cam.get("status_at")
    seen_old = (status_at is None
                or (utcnow() - status_at).total_seconds() > config.VISION_OFFLINE_AFTER_S)
    if stale_stat and (cam.get("status") != "ok" or seen_old):
        out.append("camera_offline")
    if stat.get("model_state") == "error":
        out.append("model_load_failed")
    lat = stat.get("latency_ms")
    if isinstance(lat, (int, float)) and lat > config.VISION_LATENCY_BUDGET_MS:
        out.append("latency_budget")
    if stat.get("placement") == "cloud":
        out.append("cloud_fallback")
    if gpu_pct is not None and gpu_pct >= config.VISION_GPU_HOURS_PCT:
        out.append("gpu_budget")
    return out


async def vision_alarm_sweep(st) -> None:
    """Evaluate builtin vision alarms per enabled camera against the frame
    relay's stats; raise/clear through the notify machinery (dedup + delivery
    log + audit)."""
    relay = getattr(st, "relay", None)
    if relay is None:
        return
    async with global_tx(st.pools.system) as conn:
        cams = await conn.fetch(
            "SELECT id, org_id, name, status, status_at FROM cameras WHERE enabled")
    by_org: dict[UUID, list] = {}
    for c in cams:
        by_org.setdefault(c["org_id"], []).append(c)
    for org_id, org_cams in by_org.items():
        async with tenant_tx(st.pools.app, org_id) as tc:
            active_rows = await tc.fetch(
                "SELECT DISTINCT episode FROM alarm_notify_state WHERE kind='vision'")
            active = {r["episode"] for r in active_rows}
            # same math as plans.usage_summary: cap = plan_limits override
            # else plans.gpu_hours_monthly; usage = this month's cloud
            # gpu_seconds from inference_usage. NULL cap => None (no alarm).
            gpu_pct = await tc.fetchval(
                "SELECT CASE WHEN cap.hours > 0 THEN"
                " 100.0 * (SELECT coalesce(sum(gpu_seconds)/3600.0, 0)"
                "          FROM inference_usage WHERE placement='cloud'"
                "          AND day >= date_trunc('month', now())::date)"
                " / cap.hours END"
                " FROM (SELECT coalesce((o.plan_limits->>'gpu_hours_monthly')::float,"
                "       p.gpu_hours_monthly) AS hours"
                "       FROM organizations o LEFT JOIN plans p ON p.code=o.plan"
                "       WHERE o.id=$1) cap", org_id)
            for cam in org_cams:
                cid = cam["id"]
                conds = set(_vision_conditions(
                    cam, relay.latest_stat(cid), gpu_pct))
                for cond in conds:
                    ep = f"vision:{cid}:{cond}"
                    if ep in active:
                        continue
                    await jobs.enqueue(tc.conn, "notify_send", {
                        "org_id": str(org_id), "event": "vision", "episode": ep,
                        "title": f"[{VISION_SEVERITY[cond]}] camera {cam['name']}: {cond}",
                        "detail": f"Built-in vision alarm '{cond}' raised for camera"
                                  f" {cam['name']} ({cid})."}, org_id=org_id)
                    await audit.append(tc, "vision-sweeper", "vision.alarm.raised",
                                       {"camera_id": str(cid), "condition": cond})
                for ep in list(active):
                    if not ep.startswith(f"vision:{cid}:"):
                        continue
                    cond = ep.rsplit(":", 1)[-1]
                    if cond in conds:
                        continue
                    await tc.execute(
                        "DELETE FROM alarm_notify_state WHERE episode=$1 AND kind='vision'", ep)
                    await audit.append(tc, "vision-sweeper", "vision.alarm.cleared",
                                       {"camera_id": str(cid), "condition": cond})


# ---------------------------------------------------------------------------
# API — channel CRUD / test / delivery log
# ---------------------------------------------------------------------------
class ChannelIn(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    type: str
    team_id: UUID | None = None
    config: dict = Field(default_factory=dict)
    secrets: dict = Field(default_factory=dict)
    enabled: bool = True

    @field_validator("type")
    @classmethod
    def _type(cls, v: str) -> str:
        if v not in CHANNEL_TYPES:
            raise ValueError("type must be email|line|webhook|teams|slack")
        return v


class ChannelPatch(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    team_id: UUID | None = None
    config: dict | None = None
    secrets: dict | None = None
    enabled: bool | None = None


def _channel_json(r, has_secrets: bool) -> dict:
    """Never returns config/secrets — only the write-time redacted shape."""
    pub = r["config"] if isinstance(r["config"], dict) else {}
    return {"id": str(r["id"]), "name": r["name"], "type": r["type"],
            "team_id": str(r["team_id"]) if r["team_id"] else None,
            "enabled": r["enabled"], "has_secrets": has_secrets,
            "config": pub,
            "created_at": iso_z(r["created_at"])}


async def _team_ok(tc: TenantConn, team_id: UUID | None) -> None:
    if team_id is not None and await tc.fetchval(
            "SELECT 1 FROM teams WHERE id=$1", team_id) is None:
        raise HTTPException(404, "team not found")


@router.get("/api/v1/orgs/{org}/notification-channels")
async def list_channels(org: str, request: Request, p=Depends(_user)):
    m = _m()
    org_id = m._v2_org(org, p, m._READ)
    async with tenant_tx(m.st(request).pools.app, org_id) as tc:
        rows = await tc.fetch(
            f"SELECT {_CH_COLS} FROM notification_channels ORDER BY lower(name) LIMIT 200")
    sealed = await _sealed(m.st(request).pools, org_id, [r["id"] for r in rows])
    return {"items": [_channel_json(r, sealed.get(r["id"]) is not None) for r in rows]}


@router.post("/api/v1/orgs/{org}/notification-channels", status_code=201)
async def create_channel(org: str, body: ChannelIn, request: Request, p=Depends(_user)):
    m = _m()
    org_id = m._v2_org(org, p, m._CONFIG)
    try:
        pub, sec = _split_config(body.type, body.config, body.secrets)
    except ValueError as e:
        raise HTTPException(422, str(e)) from None
    await m._mutation_gate(request, p.user_id)
    async with tenant_tx(m.st(request).pools.app, org_id, p.user_id) as tc:
        n = await tc.fetchval("SELECT count(*) FROM notification_channels")
        if n >= MAX_CHANNELS_PER_ORG:
            raise HTTPException(422, "channel limit reached")
        await _team_ok(tc, body.team_id)
        try:
            row = await tc.fetchrow(
                "INSERT INTO notification_channels(org_id, team_id, name, type,"
                " config, secrets_enc, enabled, created_by)"
                f" VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING {_CH_COLS}",
                org_id, body.team_id, body.name.strip(), body.type, pub,
                secretbox.seal(sec) if sec else None, body.enabled, p.user_id)
        except asyncpg.UniqueViolationError:
            raise HTTPException(409, "channel_name_exists") from None
        await audit.append(tc, f"user:{p.user_id}", "notify.channel.created",
                           {"channel_id": str(row["id"])}, {"type": body.type})
    return {"channel": _channel_json(row, bool(sec))}


@router.patch("/api/v1/orgs/{org}/notification-channels/{channel}")
async def patch_channel(org: str, channel: str, body: ChannelPatch, request: Request,
                        p=Depends(_user)):
    m = _m()
    org_id = m._v2_org(org, p, m._CONFIG)
    cid = m._uuid_or_404(channel, "channel")
    ch = body.model_dump(exclude_unset=True)
    if not ch:
        raise HTTPException(422, "nothing to change")
    await m._mutation_gate(request, p.user_id)
    async with tenant_tx(m.st(request).pools.app, org_id, p.user_id) as tc:
        cur = await tc.fetchrow(
            f"SELECT {_CH_COLS} FROM notification_channels WHERE id=$1", cid)
        if cur is None:
            raise HTTPException(404, "channel not found")
        had_secrets = (await _sealed(m.st(request).pools, org_id, [cid])).get(cid) is not None
        sets, args = [], []

        def put(col, val):
            args.append(val)
            sets.append(f"{col}=${len(args)}")
        if "name" in ch and ch["name"] is not None:
            put("name", ch["name"].strip())
        if "enabled" in ch and ch["enabled"] is not None:
            put("enabled", ch["enabled"])
        if "team_id" in ch:
            await _team_ok(tc, ch["team_id"])
            put("team_id", ch["team_id"])
        if "config" in ch or "secrets" in ch:
            try:
                pub, sec = _split_config(cur["type"], ch.get("config") or {},
                                         ch.get("secrets") or {},
                                         require_secrets="secrets" in ch)
            except ValueError as e:
                raise HTTPException(422, str(e)) from None
            put("config", pub)
            # credentials are write-only: leave secrets_enc alone unless the
            # caller actually sent a `secrets` object
            if "secrets" in ch:
                put("secrets_enc", secretbox.seal(sec) if sec else None)
        args.append(cid)
        try:
            row = await tc.fetchrow(
                f"UPDATE notification_channels SET {', '.join(sets)}, updated_at=now()"
                f" WHERE id=${len(args)} RETURNING {_CH_COLS}", *args)
        except asyncpg.UniqueViolationError:
            raise HTTPException(409, "channel_name_exists") from None
        except ValueError as e:
            raise HTTPException(422, str(e)) from None
        await audit.append(tc, f"user:{p.user_id}", "notify.channel.updated",
                           {"channel_id": str(cid)}, {"fields": sorted(ch)})
    return {"channel": _channel_json(
        row, bool(sec) if "secrets" in ch else had_secrets)}


@router.delete("/api/v1/orgs/{org}/notification-channels/{channel}", status_code=204)
async def delete_channel(org: str, channel: str, request: Request, p=Depends(_user)):
    m = _m()
    org_id = m._v2_org(org, p, m._CONFIG)
    cid = m._uuid_or_404(channel, "channel")
    await m._mutation_gate(request, p.user_id)
    async with tenant_tx(m.st(request).pools.app, org_id, p.user_id) as tc:
        gone = await tc.fetchval(
            "DELETE FROM notification_channels WHERE id=$1 RETURNING id", cid)
        if gone is None:
            raise HTTPException(404, "channel not found")
        await audit.append(tc, f"user:{p.user_id}", "notify.channel.deleted",
                           {"channel_id": str(cid)})


class TestIn(BaseModel):
    text: str = Field(default="WDS test notification", max_length=500)


@router.post("/api/v1/orgs/{org}/notification-channels/{channel}/test")
async def test_channel(org: str, channel: str, body: TestIn, request: Request,
                       p=Depends(_user)):
    """Send a test message through the channel now (not queued) and record the
    attempt in the delivery log."""
    m = _m()
    org_id = m._v2_org(org, p, m._CONFIG)
    cid = m._uuid_or_404(channel, "channel")
    await m._mutation_gate(request, p.user_id)
    async with tenant_tx(m.st(request).pools.app, org_id, p.user_id) as tc:
        ch = await tc.fetchrow(
            f"SELECT {_CH_COLS} FROM notification_channels WHERE id=$1", cid)
        if ch is None:
            raise HTTPException(404, "channel not found")
        ch = (await _attach_secrets(m.st(request).pools, org_id, [dict(ch)]))[0]
        try:
            target = await send_channel(ch, "WDS test", body.text)
            status = "sent"
        except Exception as e:  # noqa: BLE001 — outward error is generic
            log.warning("test notify failed", extra={"channel_id": str(cid),
                                                     "err": type(e).__name__})
            target = "?"
            status = "failed"
            err_type = type(e).__name__
        await _record_delivery(tc.conn, org_id, cid, None, "test", target, status,
                               error=None if status == "sent" else err_type)
        await audit.append(tc, f"user:{p.user_id}", "notify.channel.tested",
                           {"channel_id": str(cid)}, {"status": status})
    if status == "failed":
        raise HTTPException(502, "send_failed")
    return {"status": status}


@router.get("/api/v1/orgs/{org}/notification-deliveries")
async def list_deliveries(org: str, request: Request,
                          channel_id: str | None = None,
                          limit: int = Query(100, ge=1, le=500),
                          p=Depends(_user)):
    m = _m()
    org_id = m._v2_org(org, p, m._READ)
    cid = m._uuid_or_404(channel_id, "channel") if channel_id else None
    async with tenant_tx(m.st(request).pools.app, org_id) as tc:
        rows = await tc.fetch(
            "SELECT d.id, d.channel_id, c.name AS channel, c.type, d.alarm_id,"
            " d.kind, d.target, d.status, d.attempts, d.created_at"
            " FROM notification_deliveries d"
            " LEFT JOIN notification_channels c ON c.id = d.channel_id AND c.org_id = d.org_id"
            " WHERE ($1::uuid IS NULL OR d.channel_id=$1)"
            " ORDER BY d.created_at DESC, d.id DESC LIMIT $2", cid, limit)
    return {"items": [{
        "id": r["id"], "channel_id": str(r["channel_id"]) if r["channel_id"] else None,
        "channel": r["channel"], "type": r["type"],
        "alarm_id": str(r["alarm_id"]) if r["alarm_id"] else None,
        "kind": r["kind"], "target": r["target"], "status": r["status"],
        "attempts": r["attempts"], "at": iso_z(r["created_at"])} for r in rows]}


# ---------------------------------------------------------------------------
# API — per-rule notify routing (§3.2)
# ---------------------------------------------------------------------------
class RuleNotifyIn(BaseModel):
    channel_ids: list[UUID] = Field(default_factory=list, max_length=20)
    team_ids: list[UUID] = Field(default_factory=list, max_length=20)
    oncall_team: UUID | None = None
    min_severity: Literal["info", "warning", "critical"] = "info"
    on_clear: bool = False


def _rule_notify_json(r) -> dict:
    return {"channel_ids": [str(x) for x in (r["notify_channel_ids"] or [])],
            "team_ids": [str(x) for x in (r["notify_team_ids"] or [])],
            "oncall_team": str(r["notify_oncall_team"]) if r["notify_oncall_team"] else None,
            "min_severity": r["notify_min_severity"], "on_clear": r["notify_on_clear"]}


@router.get("/api/v1/orgs/{org}/alarm-rules/{rule}/notify")
async def get_rule_notify(org: str, rule: str, request: Request, p=Depends(_user)):
    m = _m()
    org_id = m._v2_org(org, p, m._READ)
    rid = m._uuid_or_404(rule, "alarm rule")
    async with tenant_tx(m.st(request).pools.app, org_id) as tc:
        r = await tc.fetchrow(
            "SELECT notify_channel_ids, notify_team_ids, notify_oncall_team,"
            " notify_min_severity, notify_on_clear FROM alarm_rules WHERE id=$1", rid)
    if r is None:
        raise HTTPException(404, "alarm rule not found")
    return {"notify": _rule_notify_json(r)}


@router.put("/api/v1/orgs/{org}/alarm-rules/{rule}/notify")
async def put_rule_notify(org: str, rule: str, body: RuleNotifyIn, request: Request,
                          p=Depends(_user)):
    m = _m()
    org_id = m._v2_org(org, p, m._CONFIG)
    rid = m._uuid_or_404(rule, "alarm rule")
    await m._mutation_gate(request, p.user_id)
    async with tenant_tx(m.st(request).pools.app, org_id, p.user_id) as tc:
        if await tc.fetchval("SELECT 1 FROM alarm_rules WHERE id=$1", rid) is None:
            raise HTTPException(404, "alarm rule not found")
        for cid in body.channel_ids:
            if await tc.fetchval(
                    "SELECT 1 FROM notification_channels WHERE id=$1", cid) is None:
                raise HTTPException(422, "unknown channel")
        for tid in body.team_ids:
            await _team_ok(tc, tid)
        await _team_ok(tc, body.oncall_team)
        await tc.execute(
            "UPDATE alarm_rules SET notify_channel_ids=$2, notify_team_ids=$3,"
            " notify_oncall_team=$4, notify_min_severity=$5, notify_on_clear=$6"
            " WHERE id=$1",
            rid, [str(x) for x in body.channel_ids], [str(x) for x in body.team_ids],
            body.oncall_team, body.min_severity, body.on_clear)
        await audit.append(tc, f"user:{p.user_id}", "alarm_rule.notify_set",
                           {"rule_id": str(rid)},
                           {"channels": len(body.channel_ids), "teams": len(body.team_ids)})
        # engine picks routing up through the same NOTIFY channel as rule CRUD
        await tc.execute("SELECT pg_notify($1, $2)", m.RULES_NOTIFY_CHANNEL, str(org_id))
    return {"notify": body.model_dump(mode="json")}


# ---------------------------------------------------------------------------
# API — ack links (§3.4) + lifecycle actions (§3.5)
# ---------------------------------------------------------------------------
class AckLinkIn(BaseModel):
    ttl_s: int | None = Field(default=None, ge=60, le=30 * 86400)


@router.post("/api/v1/orgs/{org}/alarms/{alarm}/ack-link", status_code=201)
async def issue_ack_link(org: str, alarm: str, body: AckLinkIn, request: Request,
                         p=Depends(_user)):
    """Operator+ mints a signed single-use ack link for an alarm episode."""
    m = _m()
    org_id = m._v2_org(org, p, m._OPERATE)
    aid = m._uuid_or_404(alarm, "alarm")
    await m._mutation_gate(request, p.user_id)
    async with tenant_tx(m.st(request).pools.app, org_id, p.user_id) as tc:
        if await tc.fetchval("SELECT 1 FROM alarms WHERE id=$1", aid) is None:
            raise HTTPException(404, "alarm not found")
        path = await _issue_ack_link(tc, aid, p.user_id, body.ttl_s)
        await audit.append(tc, f"user:{p.user_id}", "alarm.ack_link.issued",
                           {"alarm_id": str(aid)})
    return {"url": path, "expires_in": body.ttl_s or int(config.ACK_TOKEN_TTL_S)}


@router.post("/api/v1/ack/{token}")
async def ack_by_token(token: str, request: Request):
    """Single-use ack link. The token authorizes the *alarm identity*; the ack
    itself still needs an authenticated operator of that org — an expired
    session gets 401 auth_required so the client can sign in and retry."""
    m = _m()
    parsed = parse_ack_token(token)
    if parsed is None:
        raise HTTPException(404, "link not found")
    org_id, alarm_id, jti, exp = parsed
    try:
        p = await m._authenticate(request)
    except Exception:
        raise HTTPException(401, "auth_required") from None
    m._v2_org(str(org_id), p, m._OPERATE)
    await m._mutation_gate(request, p.user_id)
    async with tenant_tx(m.st(request).pools.app, org_id, p.user_id) as tc:
        used = await tc.fetchval(
            "UPDATE ack_tokens SET used_at=now(), used_by=$3"
            " WHERE jti=$1 AND alarm_id=$2 AND used_at IS NULL AND expires_at > now()"
            " RETURNING jti", jti, alarm_id, p.user_id)
        if used is None:
            raise HTTPException(410, "link_used_or_expired")
        alarm = await m.st(request).alarms.ack(tc, alarm_id, p.user_id,
                                              f"user:{p.user_id}")
        await tc.execute(
            "INSERT INTO alarm_events(org_id, alarm_id, kind, author)"
            " VALUES ($1,$2,'ack',$3)", org_id, alarm_id, f"user:{p.user_id}")
    if alarm is None:
        raise HTTPException(404, "alarm not found")
    return {"alarm": alarm}


class ShelveIn(BaseModel):
    minutes: int = Field(ge=1, le=30 * 24 * 60)   # silence up to 30 days
    reason: str = Field(default="", max_length=500)


async def _alarm_or_404(tc: TenantConn, alarm_id: UUID):
    if await tc.fetchval("SELECT 1 FROM alarms WHERE id=$1", alarm_id) is None:
        raise HTTPException(404, "alarm not found")


@router.post("/api/v1/orgs/{org}/alarms/{alarm}/shelve")
async def shelve_alarm(org: str, alarm: str, body: ShelveIn, request: Request,
                       p=Depends(_user)):
    m = _m()
    org_id = m._v2_org(org, p, m._OPERATE)
    aid = m._uuid_or_404(alarm, "alarm")
    await m._mutation_gate(request, p.user_id)
    async with tenant_tx(m.st(request).pools.app, org_id, p.user_id) as tc:
        await _alarm_or_404(tc, aid)
        await tc.execute(
            "UPDATE alarms SET shelved_until = now() + ($2 || ' minutes')::interval,"
            " version=version+1 WHERE id=$1", aid, body.minutes)
        await tc.execute(
            "INSERT INTO alarm_events(org_id, alarm_id, kind, author, body)"
            " VALUES ($1,$2,'shelve',$3,$4)", org_id, aid, f"user:{p.user_id}",
            body.reason[:500])
        await audit.append(tc, f"user:{p.user_id}", "alarm.shelved",
                           {"alarm_id": str(aid)}, {"minutes": body.minutes})
        until = await tc.fetchval("SELECT shelved_until FROM alarms WHERE id=$1", aid)
    return {"shelved_until": iso_z(until)}


@router.post("/api/v1/orgs/{org}/alarms/{alarm}/unshelve")
async def unshelve_alarm(org: str, alarm: str, request: Request, p=Depends(_user)):
    m = _m()
    org_id = m._v2_org(org, p, m._OPERATE)
    aid = m._uuid_or_404(alarm, "alarm")
    await m._mutation_gate(request, p.user_id)
    async with tenant_tx(m.st(request).pools.app, org_id, p.user_id) as tc:
        n = await tc.execute(
            "UPDATE alarms SET shelved_until=NULL, version=version+1"
            " WHERE id=$1 AND shelved_until IS NOT NULL", aid)
        if n == "UPDATE 0":
            raise HTTPException(404, "alarm not found or not shelved")
        await tc.execute(
            "INSERT INTO alarm_events(org_id, alarm_id, kind, author)"
            " VALUES ($1,$2,'unshelve',$3)", org_id, aid, f"user:{p.user_id}")
        await audit.append(tc, f"user:{p.user_id}", "alarm.unshelved",
                           {"alarm_id": str(aid)})
    return {"ok": True}


class CommentIn(BaseModel):
    body: str = Field(min_length=1, max_length=2000)


@router.post("/api/v1/orgs/{org}/alarms/{alarm}/comments", status_code=201)
async def comment_alarm(org: str, alarm: str, body: CommentIn, request: Request,
                        p=Depends(_user)):
    m = _m()
    org_id = m._v2_org(org, p, m._OPERATE)
    aid = m._uuid_or_404(alarm, "alarm")
    await m._mutation_gate(request, p.user_id)
    async with tenant_tx(m.st(request).pools.app, org_id, p.user_id) as tc:
        await _alarm_or_404(tc, aid)
        await tc.execute(
            "INSERT INTO alarm_events(org_id, alarm_id, kind, author, body)"
            " VALUES ($1,$2,'comment',$3,$4)", org_id, aid, f"user:{p.user_id}",
            body.body.strip())
        await audit.append(tc, f"user:{p.user_id}", "alarm.commented",
                           {"alarm_id": str(aid)})
    return {"ok": True}


class AssignIn(BaseModel):
    user_id: UUID | None = None   # null unassigns


@router.post("/api/v1/orgs/{org}/alarms/{alarm}/assign")
async def assign_alarm(org: str, alarm: str, body: AssignIn, request: Request,
                       p=Depends(_user)):
    m = _m()
    org_id = m._v2_org(org, p, m._OPERATE)
    aid = m._uuid_or_404(alarm, "alarm")
    await m._mutation_gate(request, p.user_id)
    async with tenant_tx(m.st(request).pools.app, org_id, p.user_id) as tc:
        await _alarm_or_404(tc, aid)
        if body.user_id is not None and await tc.fetchval(
                "SELECT 1 FROM memberships WHERE user_id=$1", body.user_id) is None:
            raise HTTPException(422, "assignee must be an org member")
        await tc.execute("UPDATE alarms SET assigned_to=$2, version=version+1 WHERE id=$1",
                         aid, body.user_id)
        who = f"user:{body.user_id}" if body.user_id else ""
        await tc.execute(
            "INSERT INTO alarm_events(org_id, alarm_id, kind, author, body)"
            " VALUES ($1,$2,'assign',$3,$4)", org_id, aid, f"user:{p.user_id}", who)
        await audit.append(tc, f"user:{p.user_id}", "alarm.assigned",
                           {"alarm_id": str(aid)}, {"assignee": who})
    return {"ok": True}


@router.get("/api/v1/orgs/{org}/alarms/{alarm}/events")
async def alarm_events(org: str, alarm: str, request: Request, p=Depends(_user)):
    m = _m()
    org_id = m._v2_org(org, p, m._READ)
    aid = m._uuid_or_404(alarm, "alarm")
    async with tenant_tx(m.st(request).pools.app, org_id) as tc:
        await _alarm_or_404(tc, aid)
        rows = await tc.fetch(
            "SELECT kind, author, body, at FROM alarm_events WHERE alarm_id=$1"
            " ORDER BY at, id LIMIT 500", aid)
    return {"items": [{"kind": r["kind"], "author": r["author"], "body": r["body"],
                       "at": iso_z(r["at"])} for r in rows]}


# ---------------------------------------------------------------------------
# API — on-call rotations + overrides (§3.3)
# ---------------------------------------------------------------------------
class RotationIn(BaseModel):
    user_ids: list[UUID] = Field(max_length=50)
    anchor: datetime | None = None
    handoff_s: int = Field(default=604800, ge=3600, le=2592000)


@router.get("/api/v1/orgs/{org}/oncall")
async def oncall_now(org: str, request: Request, p=Depends(_user)):
    """Current on-call member per team (rotation or active override)."""
    m = _m()
    org_id = m._v2_org(org, p, m._READ)
    async with tenant_tx(m.st(request).pools.app, org_id) as tc:
        teams = await tc.fetch("SELECT id, name FROM teams ORDER BY lower(name)")
        rots = {r["team_id"]: r for r in await tc.fetch(
            "SELECT team_id, user_ids, anchor, handoff_s FROM oncall_rotations")}
        overs = await tc.fetch(
            "SELECT team_id, user_id, starts_at, ends_at FROM oncall_overrides"
            " WHERE starts_at <= now() AND ends_at > now() ORDER BY starts_at DESC")
        out = []
        for t in teams:
            uid, src = None, None
            ov = next((o for o in overs if o["team_id"] == t["id"]), None)
            if ov:
                uid, src = ov["user_id"], "override"
            elif t["id"] in rots and rots[t["id"]]["user_ids"]:
                r = rots[t["id"]]
                wk = math.floor((utcnow() - r["anchor"]).total_seconds() / r["handoff_s"])
                uid, src = list(r["user_ids"])[wk % len(r["user_ids"])], "rotation"
            name = await tc.fetchval(
                "SELECT display_name FROM users WHERE id=$1", uid) if uid else None
            out.append({"team_id": str(t["id"]), "team": t["name"],
                        "user_id": str(uid) if uid else None,
                        "name": name, "source": src,
                        "rotation": [str(u) for u in (rots[t["id"]]["user_ids"]
                                     if t["id"] in rots else [])]})
    return {"items": out}


@router.put("/api/v1/orgs/{org}/teams/{team}/oncall")
async def set_rotation(org: str, team: str, body: RotationIn, request: Request,
                       p=Depends(_user)):
    m = _m()
    org_id = m._v2_org(org, p, m._CONFIG)
    tid = m._uuid_or_404(team, "team")
    await m._mutation_gate(request, p.user_id)
    async with tenant_tx(m.st(request).pools.app, org_id, p.user_id) as tc:
        await _team_ok(tc, tid)
        for uid in body.user_ids:
            if await tc.fetchval("SELECT 1 FROM memberships WHERE user_id=$1", uid) is None:
                raise HTTPException(422, "rotation members must be org members")
        await tc.execute(
            "INSERT INTO oncall_rotations(org_id, team_id, user_ids, anchor, handoff_s)"
            " VALUES ($1,$2,$3,$4,$5)"
            " ON CONFLICT (team_id) DO UPDATE SET user_ids=EXCLUDED.user_ids,"
            " anchor=EXCLUDED.anchor, handoff_s=EXCLUDED.handoff_s, updated_at=now()",
            org_id, tid, [str(u) for u in body.user_ids],
            body.anchor or utcnow(), body.handoff_s)
        await audit.append(tc, f"user:{p.user_id}", "oncall.rotation_set",
                           {"team_id": str(tid)}, {"members": len(body.user_ids)})
    return {"ok": True}


class OverrideIn(BaseModel):
    user_id: UUID
    starts_at: datetime
    ends_at: datetime

    @field_validator("ends_at")
    @classmethod
    def _window(cls, v: datetime, info):
        if info.data.get("starts_at") and v <= info.data["starts_at"]:
            raise ValueError("ends_at must be after starts_at")
        return v


@router.get("/api/v1/orgs/{org}/teams/{team}/oncall/overrides")
async def list_overrides(org: str, team: str, request: Request, p=Depends(_user)):
    m = _m()
    org_id = m._v2_org(org, p, m._READ)
    tid = m._uuid_or_404(team, "team")
    async with tenant_tx(m.st(request).pools.app, org_id) as tc:
        rows = await tc.fetch(
            "SELECT o.id, o.user_id, u.display_name, o.starts_at, o.ends_at"
            " FROM oncall_overrides o LEFT JOIN users u ON u.id=o.user_id"
            " WHERE o.team_id=$1 ORDER BY o.starts_at DESC LIMIT 200", tid)
    return {"items": [{"id": str(r["id"]), "user_id": str(r["user_id"]),
                       "name": r["display_name"],
                       "starts_at": iso_z(r["starts_at"]),
                       "ends_at": iso_z(r["ends_at"])} for r in rows]}


@router.post("/api/v1/orgs/{org}/teams/{team}/oncall/overrides", status_code=201)
async def add_override(org: str, team: str, body: OverrideIn, request: Request,
                       p=Depends(_user)):
    m = _m()
    org_id = m._v2_org(org, p, m._CONFIG)
    tid = m._uuid_or_404(team, "team")
    await m._mutation_gate(request, p.user_id)
    async with tenant_tx(m.st(request).pools.app, org_id, p.user_id) as tc:
        await _team_ok(tc, tid)
        if await tc.fetchval("SELECT 1 FROM memberships WHERE user_id=$1",
                             body.user_id) is None:
            raise HTTPException(422, "override member must be an org member")
        oid = await tc.fetchval(
            "INSERT INTO oncall_overrides(org_id, team_id, user_id, starts_at,"
            " ends_at, created_by) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id",
            org_id, tid, body.user_id, body.starts_at, body.ends_at, p.user_id)
        await audit.append(tc, f"user:{p.user_id}", "oncall.override_added",
                           {"team_id": str(tid), "override_id": str(oid)})
    return {"id": str(oid)}


@router.delete("/api/v1/orgs/{org}/teams/{team}/oncall/overrides/{ov}", status_code=204)
async def del_override(org: str, team: str, ov: str, request: Request, p=Depends(_user)):
    m = _m()
    org_id = m._v2_org(org, p, m._CONFIG)
    tid = m._uuid_or_404(team, "team")
    oid = m._uuid_or_404(ov, "override")
    await m._mutation_gate(request, p.user_id)
    async with tenant_tx(m.st(request).pools.app, org_id, p.user_id) as tc:
        gone = await tc.fetchval(
            "DELETE FROM oncall_overrides WHERE id=$1 AND team_id=$2 RETURNING id", oid, tid)
        if gone is None:
            raise HTTPException(404, "override not found")
        await audit.append(tc, f"user:{p.user_id}", "oncall.override_removed",
                           {"team_id": str(tid), "override_id": str(oid)})


# ---------------------------------------------------------------------------
# API — escalation policies (§3.3)
# ---------------------------------------------------------------------------
class PolicyIn(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    rule_id: UUID | None = None
    levels: list[dict] = Field(min_length=1, max_length=10)
    enabled: bool = True


class PolicyPatch(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    levels: list[dict] | None = None
    enabled: bool | None = None


def _policy_json(r) -> dict:
    lv = r["levels"] if isinstance(r["levels"], list) else json.loads(r["levels"])
    return {"id": str(r["id"]), "name": r["name"],
            "rule_id": str(r["rule_id"]) if r["rule_id"] else None,
            "levels": lv, "enabled": r["enabled"],
            "created_at": iso_z(r["created_at"])}


@router.get("/api/v1/orgs/{org}/escalation-policies")
async def list_policies(org: str, request: Request, p=Depends(_user)):
    m = _m()
    org_id = m._v2_org(org, p, m._READ)
    async with tenant_tx(m.st(request).pools.app, org_id) as tc:
        rows = await tc.fetch(
            "SELECT * FROM escalation_policies ORDER BY created_at LIMIT 100")
    return {"items": [_policy_json(r) for r in rows]}


@router.post("/api/v1/orgs/{org}/escalation-policies", status_code=201)
async def create_policy(org: str, body: PolicyIn, request: Request, p=Depends(_user)):
    m = _m()
    org_id = m._v2_org(org, p, m._CONFIG)
    try:
        levels = _levels(body.levels)
    except ValueError as e:
        raise HTTPException(422, str(e)) from None
    await m._mutation_gate(request, p.user_id)
    async with tenant_tx(m.st(request).pools.app, org_id, p.user_id) as tc:
        if body.rule_id and await tc.fetchval(
                "SELECT 1 FROM alarm_rules WHERE id=$1", body.rule_id) is None:
            raise HTTPException(404, "alarm rule not found")
        try:
            row = await tc.fetchrow(
                "INSERT INTO escalation_policies(org_id, rule_id, name, levels,"
                " enabled, created_by) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *",
                org_id, body.rule_id, body.name.strip(), json.dumps(levels),
                body.enabled, p.user_id)
        except asyncpg.UniqueViolationError:
            raise HTTPException(409, "a policy already exists for that rule") from None
        await audit.append(tc, f"user:{p.user_id}", "escalation.policy_created",
                           {"policy_id": str(row["id"])})
    return {"policy": _policy_json(row)}


@router.patch("/api/v1/orgs/{org}/escalation-policies/{policy}")
async def patch_policy(org: str, policy: str, body: PolicyPatch, request: Request,
                       p=Depends(_user)):
    m = _m()
    org_id = m._v2_org(org, p, m._CONFIG)
    pid = m._uuid_or_404(policy, "policy")
    ch = body.model_dump(exclude_unset=True)
    if not ch:
        raise HTTPException(422, "nothing to change")
    await m._mutation_gate(request, p.user_id)
    sets, args = [], []

    def put(col, val):
        args.append(val)
        sets.append(f"{col}=${len(args)}")
    if "name" in ch and ch["name"] is not None:
        put("name", ch["name"].strip())
    if "enabled" in ch and ch["enabled"] is not None:
        put("enabled", ch["enabled"])
    if "levels" in ch:
        try:
            put("levels", json.dumps(_levels(ch["levels"])))
        except ValueError as e:
            raise HTTPException(422, str(e)) from None
    if not sets:
        raise HTTPException(422, "nothing to change")
    args.append(pid)
    async with tenant_tx(m.st(request).pools.app, org_id, p.user_id) as tc:
        row = await tc.fetchrow(
            f"UPDATE escalation_policies SET {', '.join(sets)}, updated_at=now()"
            f" WHERE id=${len(args)} RETURNING *", *args)
        if row is None:
            raise HTTPException(404, "policy not found")
        await audit.append(tc, f"user:{p.user_id}", "escalation.policy_updated",
                           {"policy_id": str(pid)}, {"fields": sorted(ch)})
    return {"policy": _policy_json(row)}


@router.delete("/api/v1/orgs/{org}/escalation-policies/{policy}", status_code=204)
async def delete_policy(org: str, policy: str, request: Request, p=Depends(_user)):
    m = _m()
    org_id = m._v2_org(org, p, m._CONFIG)
    pid = m._uuid_or_404(policy, "policy")
    await m._mutation_gate(request, p.user_id)
    async with tenant_tx(m.st(request).pools.app, org_id, p.user_id) as tc:
        gone = await tc.fetchval(
            "DELETE FROM escalation_policies WHERE id=$1 RETURNING id", pid)
        if gone is None:
            raise HTTPException(404, "policy not found")
        await audit.append(tc, f"user:{p.user_id}", "escalation.policy_deleted",
                           {"policy_id": str(pid)})


# ---------------------------------------------------------------------------
# API — ISA-18.2 alarm quality (§3.5 acceptance: real data, not demo)
# ---------------------------------------------------------------------------
def _quality(rows: list, hours: float, operators: int) -> dict:
    """ISA-18.2 metrics from raw alarm rows:
    (rule_id, rule, severity, state, raised_at, acked_at, cleared_at)."""
    now = utcnow()
    total = len(rows)
    per_hour = total / hours if hours else 0.0
    per_op_hour = per_hour / max(1, operators)

    times = sorted(r["raised_at"] for r in rows)
    peak = 0  # max activations in any 10-minute window (flood check)
    for i, t in enumerate(times):
        j = i
        while j >= 0 and (t - times[j]).total_seconds() <= 600:
            j -= 1
        peak = max(peak, i - j)

    hourly = [0] * 24
    for t in times:
        back = int((now - t).total_seconds() // 3600)
        if 0 <= back < 24:
            hourly[23 - back] += 1

    standing = sum(1 for r in rows if r["state"] in ("active", "acked")
                   and (now - r["raised_at"]).total_seconds() > 86400)
    unacked = sum(1 for r in rows
                  if r["state"] == "active" and r["acked_at"] is None)

    by_rule: dict = {}
    for r in rows:
        by_rule.setdefault(r["rule_id"], []).append(r)
    rule_rows = []
    for rid, lst in by_rule.items():
        lst.sort(key=lambda x: x["raised_at"])
        # chattering: >= 3 activations inside any 60 s window
        chatter = 0
        ts_ = [x["raised_at"] for x in lst]
        for i, t in enumerate(ts_):
            j = i
            while j >= 0 and (t - ts_[j]).total_seconds() <= 60:
                j -= 1
            if i - j >= 2:
                chatter += 1
        acks = [(x["acked_at"] - x["raised_at"]).total_seconds()
                for x in lst if x["acked_at"]]
        rule_rows.append({
            "rule_id": str(rid), "rule": lst[0]["rule"],
            "severity": lst[0]["severity"], "count": len(lst),
            "share": len(lst) / total if total else 0.0,
            "chatter": chatter,
            "standing": sum(1 for x in lst if x["state"] in ("active", "acked")
                            and (now - x["raised_at"]).total_seconds() > 86400),
            "unacked": sum(1 for x in lst
                           if x["state"] == "active" and x["acked_at"] is None),
            "mtta_s": (sum(acks) / len(acks)) if acks else None,
        })
    rule_rows.sort(key=lambda x: -x["count"])
    top = rule_rows[:10]
    for i, r in enumerate(rule_rows):
        flags = []
        if i < 10 and len(rule_rows) > 10:
            flags.append("frequent")
        if r["chatter"]:
            flags.append("chatter")
        if r["standing"]:
            flags.append("standing")
        if r["unacked"]:
            flags.append("unacked")
        r["flags"] = flags
    return {
        "hours": hours, "operators": operators, "total": total,
        "alarms_per_hour": round(per_hour, 2),
        "alarms_per_operator_hour": round(per_op_hour, 3),
        "peak_10m": peak, "hourly": hourly,
        "standing": standing, "unacked": unacked,
        "top10_share": round(sum(r["share"] for r in top), 3),
        "rules": rule_rows[:200],
    }


@router.get("/api/v1/orgs/{org}/alarm-quality")
async def alarm_quality(org: str, request: Request,
                        hours: float = Query(24.0, ge=1, le=24 * 31),
                        site_id: str | None = None,
                        p=Depends(_user)):
    """ISA-18.2 metrics computed from the alarms table (acceptance: matches a
    hand count on a test dataset)."""
    m = _m()
    org_id = m._v2_org(org, p, m._READ)
    sid = m._uuid_or_404(site_id, "site") if site_id else None
    async with tenant_tx(m.st(request).pools.app, org_id) as tc:
        rows = await tc.fetch(
            "SELECT a.rule_id, r.name AS rule, a.severity, a.state, a.raised_at,"
            " a.acked_at, a.cleared_at FROM alarms a"
            " JOIN alarm_rules r ON r.id = a.rule_id"
            " WHERE a.raised_at > now() - ($1 || ' hours')::interval"
            " AND ($2::uuid IS NULL OR a.tag_id IN"
            "      (SELECT id FROM tags WHERE site_id=$2))",
            float(hours), sid)
        operators = await tc.fetchval(
            "SELECT count(*) FROM memberships WHERE role IN ('operator','admin','owner')")
    return _quality(list(rows), float(hours), int(operators or 0))
