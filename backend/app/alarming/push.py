"""Web Push: subscription API and alarm delivery (spec 2026-10-19 §8).

A member enables push on a device (browser PushManager subscription); the org's
`webpush` notification channel then delivers alarm events to the subscribed
members. The message is a short, translated sentence plus a link — no process
values and no tag names — because it crosses Google's / Apple's push services.
Real data loads after the app opens, behind login.
"""

from __future__ import annotations

import asyncio
import logging
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field

from ..core import config, egress
from ..db.context import TenantConn, tenant_tx
from ..db.util import iso_z
from . import webpush

log = logging.getLogger("wds.push")
router = APIRouter()

MAX_PER_USER = 5
DEFAULT_CHANNEL = "Mobile push"
PUSH_EVENTS = ("raised", "escalation")      # clearing an alarm is not worth a buzz


def _m():
    from .. import main
    return main


async def _user(request: Request):
    return await _m().require_user(request)


def subject() -> str:
    """VAPID `sub`: a https URL of this deployment, else a mailto."""
    if config.PUBLIC_URL.startswith("https://"):
        return config.PUBLIC_URL
    return "mailto:" + config.SMTP_FROM.split("<")[-1].rstrip(">").strip()


# ── message ──────────────────────────────────────────────────────────────

_SEV = {"en": {"critical": "critical", "warning": "warning", "info": "info"},
        "th": {"critical": "วิกฤต", "warning": "เตือน", "info": "ข้อมูล"}}
_TITLE = {"en": "Alarm", "th": "สัญญาณเตือน"}
_BODY = {
    "en": {"raised": "New {sev} alarm in {area}",
           "escalation": "Unacknowledged {sev} alarm in {area}",
           "test": "Notifications are working on this device"},
    "th": {"raised": "มี alarm ระดับ {sev} ใหม่ที่ {area}",
           "escalation": "alarm ระดับ {sev} ที่ {area} ยังไม่มีคนรับทราบ",
           "test": "การแจ้งเตือนบนอุปกรณ์นี้ใช้งานได้"},
}
_PLANT = {"en": "the plant", "th": "โรงงาน"}


def build_message(locale: str, kind: str, severity: str | None, area: str | None,
                  alarm_id: UUID | None) -> dict:
    """The push payload. Deliberately free of tag names and values."""
    loc = locale if locale in _TITLE else "en"
    sev = _SEV[loc].get(severity or "", _SEV[loc]["warning"])
    body = _BODY[loc].get(kind, _BODY[loc]["raised"]).format(sev=sev, area=area or _PLANT[loc])
    out = {"title": _TITLE[loc], "body": body, "url": "/alarms", "kind": kind}
    if alarm_id is not None:
        out["tag"] = str(alarm_id)              # a repeat for the same alarm replaces the card
        out["url"] = f"/alarms?id={alarm_id}"
    return out


# ── delivery ─────────────────────────────────────────────────────────────

async def _alarm_context(tc: TenantConn, alarm_id: UUID | None) -> tuple[str | None, str | None]:
    if alarm_id is None:
        return None, None
    r = await tc.fetchrow(
        "SELECT a.severity, ar.name AS area FROM alarms a"
        " JOIN tags t ON t.org_id=a.org_id AND t.id=a.tag_id"
        " LEFT JOIN devices d ON d.org_id=t.org_id AND d.id=t.device_id"
        " LEFT JOIN lines l ON l.org_id=d.org_id AND l.id=d.line_id"
        " LEFT JOIN areas ar ON ar.org_id=l.org_id AND ar.id=l.area_id WHERE a.id=$1", alarm_id)
    return (r["severity"], r["area"]) if r else (None, None)


async def _post(url: str, body: bytes, headers: dict) -> int:
    egress.check_url(url, https_only=True)
    return await asyncio.get_running_loop().run_in_executor(
        None, egress.post_no_redirect, url, body, headers, config.NOTIFY_HTTP_TIMEOUT_S)


async def deliver(tc: TenantConn, subs: list, kind: str, severity: str | None,
                  area: str | None, alarm_id: UUID | None) -> tuple[int, int]:
    """Send to every subscription row; returns (sent, transient failures).
    404/410 mean the browser dropped the subscription: it is deleted."""
    sent = failed = 0
    for s in subs:
        msg = build_message(s["locale"], kind, severity, area, alarm_id)
        try:
            url, body, headers = webpush.build_request(dict(s), msg, subject(),
                                                       urgency="high" if kind != "test" else "normal")
            code = await _post(url, body, headers)
        except Exception as e:  # noqa: BLE001 — one device must not stop the rest
            log.warning("push send failed", extra={"err": type(e).__name__})
            failed += 1
            continue
        if code in (404, 410):
            await tc.execute("DELETE FROM push_subscriptions WHERE id=$1", s["id"])
        elif 200 <= code < 300:
            sent += 1
            await tc.execute("UPDATE push_subscriptions SET last_ok_at=now() WHERE id=$1", s["id"])
        else:
            failed += 1
            log.warning("push service refused", extra={"status": code})
    return sent, failed


async def send_for_channel(tc: TenantConn, channel: dict, kind: str,
                           alarm_id: UUID | None) -> str:
    """Deliver an alarm event through a `webpush` channel. Returns the delivery-log
    hint; raises when a send failed for a reason worth retrying."""
    if kind not in PUSH_EVENTS and kind != "test":
        return "skipped"
    if channel.get("team_id"):
        subs = await tc.fetch(
            "SELECT s.id, s.endpoint, s.p256dh, s.auth, u.locale FROM push_subscriptions s"
            " JOIN users u ON u.id=s.user_id JOIN team_members m ON m.user_id=s.user_id"
            " WHERE m.team_id=$1", channel["team_id"])
    else:
        subs = await tc.fetch(
            "SELECT s.id, s.endpoint, s.p256dh, s.auth, u.locale FROM push_subscriptions s"
            " JOIN users u ON u.id=s.user_id")
    severity, area = await _alarm_context(tc, alarm_id)
    sent, failed = await deliver(tc, subs, kind, severity, area, alarm_id)
    hint = f"{sent}/{len(subs)} device(s)"
    if failed and not sent:
        raise RuntimeError(f"push failed for {failed} device(s)")
    return hint


# ── API ──────────────────────────────────────────────────────────────────

class Keys(BaseModel):
    p256dh: str = Field(max_length=120)
    auth: str = Field(max_length=60)


class SubIn(BaseModel):
    endpoint: str = Field(max_length=1000)
    keys: Keys
    ua: str | None = Field(default=None, max_length=300)


@router.get("/api/v1/push/vapid-key")
async def vapid_key(p=Depends(_user)):
    return {"key": webpush.vapid_public_key_b64()}


@router.get("/api/v1/orgs/{org}/push-subscriptions")
async def my_subscriptions(org: str, request: Request, p=Depends(_user)):
    m = _m()
    org_id = m._v2_org(org, p)
    async with tenant_tx(m.st(request).pools.app, org_id, p.user_id) as tc:
        rows = await tc.fetch(
            "SELECT id, ua, created_at, last_ok_at FROM push_subscriptions"
            " WHERE user_id=$1 ORDER BY created_at", p.user_id)
    return {"items": [{"id": str(r["id"]), "ua": r["ua"], "created_at": iso_z(r["created_at"]),
                       "last_ok_at": iso_z(r["last_ok_at"]) if r["last_ok_at"] else None}
                      for r in rows]}


@router.post("/api/v1/orgs/{org}/push-subscriptions", status_code=201)
async def subscribe(org: str, body: SubIn, request: Request, p=Depends(_user)):
    m = _m()
    org_id = m._v2_org(org, p)
    if p.kind == "apikey" or p.user_id is None:
        raise HTTPException(403, "push needs a signed-in member")
    if not webpush.endpoint_allowed(body.endpoint):
        raise HTTPException(422, "endpoint_not_allowed")
    try:
        ua_pub, auth = webpush.b64d(body.keys.p256dh), webpush.b64d(body.keys.auth)
    except ValueError:
        raise HTTPException(422, "bad_keys") from None
    if len(ua_pub) != 65 or ua_pub[0] != 4 or len(auth) != 16:
        raise HTTPException(422, "bad_keys")
    await m._mutation_gate(request, p.user_id)
    async with tenant_tx(m.st(request).pools.app, org_id, p.user_id) as tc:
        # the same device signing in as someone else takes the subscription over
        sid = await tc.fetchval(
            "INSERT INTO push_subscriptions(org_id, user_id, endpoint, p256dh, auth, ua)"
            " VALUES ($1,$2,$3,$4,$5,$6)"
            " ON CONFLICT (org_id, endpoint) DO UPDATE SET user_id=EXCLUDED.user_id,"
            " p256dh=EXCLUDED.p256dh, auth=EXCLUDED.auth, ua=EXCLUDED.ua RETURNING id",
            org_id, p.user_id, body.endpoint, body.keys.p256dh, body.keys.auth,
            (body.ua or "")[:300] or None)
        await tc.execute(
            "DELETE FROM push_subscriptions WHERE user_id=$1 AND id NOT IN ("
            " SELECT id FROM push_subscriptions WHERE user_id=$1"
            " ORDER BY created_at DESC LIMIT $2)", p.user_id, MAX_PER_USER)
        # make sure there is a channel for admins to point rules at
        await tc.execute(
            "INSERT INTO notification_channels(org_id, name, type, created_by)"
            " SELECT $1, $2, 'webpush', $3 WHERE NOT EXISTS"
            " (SELECT 1 FROM notification_channels WHERE type='webpush')"
            " ON CONFLICT DO NOTHING", org_id, DEFAULT_CHANNEL, p.user_id)
    return {"id": str(sid)}


@router.delete("/api/v1/orgs/{org}/push-subscriptions", status_code=204)
async def unsubscribe(org: str, endpoint: str, request: Request, p=Depends(_user)):
    """Remove this device's subscription (called on sign-out and when the user
    turns notifications off)."""
    m = _m()
    org_id = m._v2_org(org, p)
    async with tenant_tx(m.st(request).pools.app, org_id, p.user_id) as tc:
        await tc.execute("DELETE FROM push_subscriptions WHERE user_id=$1 AND endpoint=$2",
                         p.user_id, endpoint)


@router.post("/api/v1/orgs/{org}/push-subscriptions/test")
async def test_push(org: str, request: Request, p=Depends(_user)):
    """Send a test notification to the caller's own devices."""
    m = _m()
    org_id = m._v2_org(org, p)
    await m._mutation_gate(request, p.user_id)
    async with tenant_tx(m.st(request).pools.app, org_id, p.user_id) as tc:
        subs = await tc.fetch(
            "SELECT s.id, s.endpoint, s.p256dh, s.auth, u.locale FROM push_subscriptions s"
            " JOIN users u ON u.id=s.user_id WHERE s.user_id=$1", p.user_id)
        sent, failed = await deliver(tc, subs, "test", None, None, None)
    return {"sent": sent, "failed": failed, "devices": len(subs)}
