"""Onboarding checklist (roadmap 1.3).

`GET /api/v1/orgs/{org}/onboarding` derives six first-run steps from real
data — there is no "done" flag to write; the UI ticks each step when the
underlying row exists and polls for changes.

Steps:
  1 gateway        — an edge exists for the org (enrolled/provisioned)
  2 data           — a data source OR a tag exists
  3 dashboard      — a dashboard row exists
  4 alarm rule     — an alarm_rules row exists
  5 notify channel — a notification_channels row exists (table owned by the
                     Phase-3 work stream; absent table -> step just stays
                     undone, never a 500)
  6 teammate       — >1 membership OR a pending invite

Mounted from main.py; auth helpers resolved lazily (same pattern as
datasources/routes.py).
"""

from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, Request

from ..db.context import tenant_tx

log = logging.getLogger("wds.onboarding")

router = APIRouter()


def _m():
    from .. import main
    return main


async def _user(request: Request):
    return await _m().require_user(request)


STEPS = (
    ("gateway", "/infrastructure/sources"),
    ("data", "/infrastructure/sources"),
    ("dashboard", "/dashboards?new=1"),
    ("alarm_rule", "/admin/rules/new"),
    ("notify", "/settings"),
    ("teammate", "/admin/users"),
)


@router.get("/api/v1/orgs/{org}/onboarding")
async def onboarding(org: str, request: Request, p=Depends(_user)):
    m = _m()
    org_id = m._v2_org(org, p, m._READ)
    async with tenant_tx(m.st(request).pools.app, org_id) as tc:
        has_channels = await tc.fetchval(
            "SELECT to_regclass('notification_channels') IS NOT NULL")
        done = {
            "gateway": await tc.fetchval("SELECT EXISTS(SELECT 1 FROM edges)"),
            "data": await tc.fetchval(
                "SELECT EXISTS(SELECT 1 FROM data_sources)"
                " OR EXISTS(SELECT 1 FROM tags)"),
            "dashboard": await tc.fetchval(
                "SELECT EXISTS(SELECT 1 FROM dashboards)"),
            "alarm_rule": await tc.fetchval(
                "SELECT EXISTS(SELECT 1 FROM alarm_rules)"),
            "notify": has_channels and await tc.fetchval(
                "SELECT EXISTS(SELECT 1 FROM notification_channels"
                " WHERE org_id=$1)", org_id),
            "teammate": await tc.fetchval(
                "SELECT (SELECT count(*) FROM memberships) > 1"
                " OR EXISTS(SELECT 1 FROM invites"
                "          WHERE accepted_at IS NULL AND expires_at > now())"),
        }
    steps = [{"id": sid, "done": bool(done[sid]), "href": href}
             for sid, href in STEPS]
    return {"steps": steps,
            "done": sum(1 for s in steps if s["done"]),
            "total": len(steps)}
