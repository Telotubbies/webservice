"""v2 admin API: alarm rules routes. Moved verbatim from main.py."""

from __future__ import annotations

from ..alarming.alarms import RULES_NOTIFY_CHANNEL
from ..alarming.alarms import Rule
from ..iam.auth import Principal
from ..db import audit
from fastapi import Depends
from fastapi import HTTPException
from fastapi import Request
from fastapi.responses import Response
from pydantic import BaseModel
from pydantic import Field
from uuid import UUID
import asyncpg
from ..deps import (
    _CONFIG,
    _mutation_gate,
    _site_or_404,
    _v2_scope,
    _v2_tag_or_404,
    org_tx,
    require_user,
    st,
)
from fastapi import APIRouter

router = APIRouter()

RULE_KINDS = frozenset({"hi", "hihi", "lo", "lolo", "stale", "roc", "anomaly", "forecast"})
TREND_RULE_KINDS = frozenset({"roc", "anomaly", "forecast"})
RULE_SEVERITIES = frozenset({"info", "warning", "critical"})


class AlarmRuleIn(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    tag_id: str
    kind: str
    threshold: float | None = None
    stale_s: int | None = None
    window_s: int | None = None
    deadband: float = Field(default=0, ge=0)
    severity: str
    enabled: bool = True


class AlarmRulePatch(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    kind: str | None = None
    threshold: float | None = None
    stale_s: int | None = None
    window_s: int | None = None
    deadband: float | None = Field(default=None, ge=0)
    severity: str | None = None
    enabled: bool | None = None


def _validate_rule(kind: str, threshold, stale_s, severity: str,
                   deadband: float, window_s=None) -> None:
    """Mirror the alarm_rules CHECK constraints in request terms (400, not a
    500 from a violated CHECK)."""
    if kind not in RULE_KINDS:
        raise HTTPException(400, "invalid_request: kind")
    if severity not in RULE_SEVERITIES:
        raise HTTPException(400, "invalid_request: severity")
    if deadband is not None and deadband < 0:
        raise HTTPException(400, "invalid_request: deadband")
    if kind == "stale":
        if stale_s is None or not (5 <= stale_s <= 86400):
            raise HTTPException(400, "invalid_request: stale rule needs stale_s 5..86400")
    elif threshold is None:
        raise HTTPException(400, "invalid_request: threshold rule needs a threshold")
    elif kind in TREND_RULE_KINDS and (window_s is None or not (30 <= window_s <= 86400)):
        raise HTTPException(400, "invalid_request: trend rule needs window_s 30..86400")


def _rule_json(r) -> dict:
    return {"id": str(r["id"]), "tag_id": str(r["tag_id"]), "name": r["name"],
            "kind": r["kind"], "threshold": r["threshold"],
            "stale_s": r["stale_s"], "window_s": r["window_s"],
            "deadband": r["deadband"],
            "severity": r["severity"], "enabled": r["enabled"]}


def _row_to_rule(row, org_id: UUID) -> Rule:
    """_RULE_COLS row -> engine Rule (the row carries `enabled`, which the
    engine dataclass does not)."""
    d = {k: v for k, v in dict(row).items() if k != "enabled"}
    return Rule(org_id=org_id, **d)


_RULE_COLS = ("id, tag_id, name, kind, threshold, stale_s, deadband,"
              " severity, window_s, enabled")


async def _rule_or_404(tc, rule_id: str, site_id: UUID):
    """Rule resolved inside the path site — a foreign-site rule id is 404,
    never a cross-tenant leak (same oracle rule as _v2_tag_or_404)."""
    try:
        rid = UUID(rule_id)
    except ValueError:
        raise HTTPException(404, "alarm rule not found") from None
    row = await tc.fetchrow(
        f"SELECT {_RULE_COLS} FROM alarm_rules WHERE id=$1"
        " AND tag_id IN (SELECT id FROM tags WHERE site_id=$2)", rid, site_id)
    if row is None:
        raise HTTPException(404, "alarm rule not found")
    return row


@router.post("/api/v1/orgs/{org}/sites/{site}/alarm-rules", status_code=201)
async def v2_create_alarm_rule(org: str, site: str, body: AlarmRuleIn,
                               request: Request,
                               p: Principal = Depends(require_user)):
    """config:write in the path org. NOTIFYs alarm_rules_changed so the
    engine reloads its rule set without a restart (v4 T10)."""
    org_id, site_id = _v2_scope(org, site, p, need=_CONFIG)
    await _site_or_404(st(request).pools, org_id, site_id)
    tag = await _v2_tag_or_404(request, org_id, site_id, body.tag_id)
    _validate_rule(body.kind, body.threshold, body.stale_s,
                   body.severity, body.deadband, body.window_s)
    await _mutation_gate(request, p.user_id)
    async with org_tx(request, org_id, p.user_id) as tc:
        try:
            row = await tc.fetchrow(
                "INSERT INTO alarm_rules(org_id, tag_id, name, kind, threshold,"
                " stale_s, deadband, severity, window_s, enabled)"
                " VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING " + _RULE_COLS,
                org_id, tag.id, body.name, body.kind, body.threshold,
                body.stale_s, body.deadband, body.severity, body.window_s,
                body.enabled)
        except asyncpg.UniqueViolationError:
            raise HTTPException(409, "alarm rule name already exists on this tag")
        await audit.append(tc, f"user:{p.user_id}", "alarm_rule.created",
                           {"rule_id": str(row["id"]), "tag_id": str(tag.id)},
                           {"name": body.name, "kind": body.kind})
        await tc.execute("SELECT pg_notify($1, $2)",
                         RULES_NOTIFY_CHANNEL, str(org_id))
    return {"rule": _rule_json(row)}


@router.patch("/api/v1/orgs/{org}/sites/{site}/alarm-rules/{rule_id}")
async def v2_patch_alarm_rule(org: str, site: str, rule_id: str,
                              body: AlarmRulePatch, request: Request,
                              p: Principal = Depends(require_user)):
    org_id, site_id = _v2_scope(org, site, p, need=_CONFIG)
    await _mutation_gate(request, p.user_id)
    changes = body.model_dump(exclude_unset=True)
    if not changes:
        raise HTTPException(400, "invalid_request: empty patch")
    async with org_tx(request, org_id, p.user_id) as tc:
        cur = await _rule_or_404(tc, rule_id, site_id)
        merged = {
            "name": changes.get("name", cur["name"]),
            "kind": changes.get("kind", cur["kind"]),
            "threshold": changes.get("threshold", cur["threshold"]),
            "stale_s": changes.get("stale_s", cur["stale_s"]),
            "window_s": changes.get("window_s", cur["window_s"]),
            "deadband": changes.get("deadband", cur["deadband"]),
            "severity": changes.get("severity", cur["severity"]),
            "enabled": changes.get("enabled", cur["enabled"]),
        }
        _validate_rule(merged["kind"], merged["threshold"], merged["stale_s"],
                       merged["severity"], merged["deadband"], merged["window_s"])
        try:
            row = await tc.fetchrow(
                "UPDATE alarm_rules SET name=$2, kind=$3, threshold=$4, stale_s=$5,"
                " deadband=$6, severity=$7, enabled=$8, window_s=$9 WHERE id=$1"
                " RETURNING " + _RULE_COLS,
                cur["id"], merged["name"], merged["kind"], merged["threshold"],
                merged["stale_s"], merged["deadband"], merged["severity"],
                merged["enabled"], merged["window_s"])
        except asyncpg.UniqueViolationError:
            raise HTTPException(409, "alarm rule name already exists on this tag")
        if merged["enabled"] is False:
            # T10-review F6: a disabled rule can never evaluate-clear again —
            # resolve its open alarms now, through the engine's close path.
            await st(request).alarms.close_for_rule(
                tc, _row_to_rule(row, org_id))
        await audit.append(tc, f"user:{p.user_id}", "alarm_rule.updated",
                           {"rule_id": str(cur["id"])}, changes)
        await tc.execute("SELECT pg_notify($1, $2)",
                         RULES_NOTIFY_CHANNEL, str(org_id))
    return {"rule": _rule_json(row)}


@router.delete("/api/v1/orgs/{org}/sites/{site}/alarm-rules/{rule_id}",
            status_code=204)
async def v2_delete_alarm_rule(org: str, site: str, rule_id: str,
                               request: Request,
                               p: Principal = Depends(require_user)):
    """Deletes the rule; its alarms cascade away with it (schema FK)."""
    org_id, site_id = _v2_scope(org, site, p, need=_CONFIG)
    await _mutation_gate(request, p.user_id)
    async with org_tx(request, org_id, p.user_id) as tc:
        cur = await _rule_or_404(tc, rule_id, site_id)
        # T10-review F6: resolve open alarms BEFORE the row disappears —
        # _clear's serialize joins alarm_rules for the broadcast payload.
        await st(request).alarms.close_for_rule(
            tc, _row_to_rule(cur, org_id))
        await tc.execute("DELETE FROM alarm_rules WHERE id=$1", cur["id"])
        await audit.append(tc, f"user:{p.user_id}", "alarm_rule.deleted",
                           {"rule_id": str(cur["id"])},
                           {"name": cur["name"]})
        await tc.execute("SELECT pg_notify($1, $2)",
                         RULES_NOTIFY_CHANNEL, str(org_id))
    return Response(status_code=204)
