"""Vision rule CRUD (roadmap 9.7). Rules live ONLY in the backend — every
mutation bumps the edge config_version so the gateway receives the new rule
set inside its next cfg (cameras[].rules); the gateway never edits them.

New rules start in dry_run: they record "would fire" events until an admin
explicitly turns dry_run off (U5/spec: a plant-affecting action starts safe).
"""

from __future__ import annotations

from typing import Literal
from uuid import UUID

import asyncpg
from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from ..datasources.routes import bump_config
from ..db import audit
from ..db.context import tenant_tx
from .rulecfg import has_plc_action, rule_json, validate_actions, validate_conditions

router = APIRouter()

_R = "/api/v1/orgs/{org}/vision/rules"


def _m():
    from .. import main
    return main


async def _user(request: Request):
    return await _m().require_user(request)


class RuleIn(BaseModel):
    camera_id: UUID
    name: str = Field(min_length=1, max_length=120)
    enabled: bool = True
    dry_run: bool = True                      # 9.7: new rules start safe
    allow_cloud_write: bool = False
    conditions: dict
    actions: list
    offline_write_window_s: int | None = Field(default=None, ge=0, le=86400)


class RulePatch(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    enabled: bool | None = None
    dry_run: bool | None = None
    allow_cloud_write: bool | None = None
    conditions: dict | None = None
    actions: list | None = None
    offline_write_window_s: int | None = Field(default=None, ge=0, le=86400)


def _bad(e: ValueError) -> JSONResponse:
    return JSONResponse(status_code=422,
                        content={"detail": "invalid_rule", "message": str(e)[:300]})


async def _camera(tc, cam_id: UUID):
    row = await tc.fetchrow(
        "SELECT id, edge_id, site_id FROM cameras WHERE id=$1", cam_id)
    if row is None:
        raise HTTPException(404, "camera not found")
    return row


async def _check_write_tags(tc, site_id: UUID, actions: list[dict]) -> None:
    """plc_write/counter actions must name a writable tag in the camera's site;
    a numeric plc_write is range-checked against the tag limits at save time
    (the edge re-checks at fire time — defense in depth)."""
    for a in actions:
        if a["kind"] not in ("plc_write", "counter"):
            continue
        tag = await tc.fetchrow(
            "SELECT id, writable, type, min_value, max_value FROM tags"
            " WHERE site_id=$1 AND path=$2", site_id, a["tag_path"])
        if tag is None:
            raise HTTPException(422, f"tag_path not found in this site: {a['tag_path']}")
        if not tag["writable"]:
            raise HTTPException(422, f"tag is not writable: {a['tag_path']}")
        if a["kind"] == "plc_write" and isinstance(a["value"], (int, float)) \
                and not isinstance(a["value"], bool):
            lo, hi, v = tag["min_value"], tag["max_value"], float(a["value"])
            if (lo is not None and v < lo) or (hi is not None and v > hi):
                raise HTTPException(422, f"value out of range for {a['tag_path']}")


async def _pinned_version(tc, cam_id: UUID):
    return await tc.fetchval(
        "SELECT model_version_id FROM camera_models WHERE camera_id=$1", cam_id)


@router.get("/api/v1/orgs/{org}/cameras/{camera}/rules")
async def list_camera_rules(org: str, camera: str, request: Request, p=Depends(_user)):
    m = _m()
    org_id = m._v2_org(org, p, m._READ)
    cam_id = m._uuid_or_404(camera, "camera")
    async with tenant_tx(m.st(request).pools.app, org_id) as tc:
        await _camera(tc, cam_id)
        rows = await tc.fetch(
            "SELECT * FROM vision_rules WHERE camera_id=$1 ORDER BY created_at", cam_id)
    return {"items": [rule_json(r) for r in rows]}


@router.get(_R)
async def list_rules(org: str, request: Request, camera: str | None = None,
                     p=Depends(_user)):
    m = _m()
    org_id = m._v2_org(org, p, m._READ)
    async with tenant_tx(m.st(request).pools.app, org_id) as tc:
        if camera is not None:
            cam_id = m._uuid_or_404(camera, "camera")
            rows = await tc.fetch(
                "SELECT * FROM vision_rules WHERE camera_id=$1 ORDER BY created_at", cam_id)
        else:
            rows = await tc.fetch("SELECT * FROM vision_rules ORDER BY created_at")
    return {"items": [rule_json(r) for r in rows]}


@router.get(_R + "/{rule}")
async def get_rule(org: str, rule: str, request: Request, p=Depends(_user)):
    m = _m()
    org_id = m._v2_org(org, p, m._READ)
    rid = m._uuid_or_404(rule, "rule")
    async with tenant_tx(m.st(request).pools.app, org_id) as tc:
        r = await tc.fetchrow("SELECT * FROM vision_rules WHERE id=$1", rid)
    if r is None:
        raise HTTPException(404, "rule not found")
    return {"rule": rule_json(r)}


@router.post(_R, status_code=201)
async def create_rule(org: str, body: RuleIn, request: Request, p=Depends(_user)):
    m = _m()
    org_id = m._v2_org(org, p, m._CONFIG)
    await m._mutation_gate(request, p.user_id)
    try:
        cond = validate_conditions(body.conditions)
        acts = validate_actions(body.actions)
    except ValueError as e:
        return _bad(e)
    async with tenant_tx(m.st(request).pools.app, org_id, p.user_id) as tc:
        cam = await _camera(tc, body.camera_id)
        await _check_write_tags(tc, cam["site_id"], acts)
        n = await tc.fetchval(
            "SELECT count(*) FROM vision_rules WHERE camera_id=$1", cam["id"])
        if n >= 32:
            raise HTTPException(409, "rule_limit_reached")
        try:
            row = await tc.fetchrow(
                "INSERT INTO vision_rules(org_id, camera_id, model_version_id, name, enabled,"
                " dry_run, allow_cloud_write, conditions, actions, offline_write_window_s,"
                " created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *",
                org_id, cam["id"], await _pinned_version(tc, cam["id"]), body.name,
                body.enabled, body.dry_run, body.allow_cloud_write, cond, acts,
                body.offline_write_window_s, p.user_id)
        except asyncpg.UniqueViolationError:
            raise HTTPException(409, "rule_name_exists") from None
        ver = await bump_config(tc, cam["edge_id"])
        await audit.append(tc, f"user:{p.user_id}", "vision.rule.created",
                           {"rule_id": str(row["id"]), "camera_id": str(cam["id"])},
                           {"name": body.name, "dry_run": body.dry_run,
                            "plc": has_plc_action(acts)})
    return {"rule": rule_json(row), "config_version": ver}


def _merge_patch(cur, body: RulePatch):
    """Validated (conditions, actions, ...) after applying a patch to `cur`."""
    ch = body.model_dump(exclude_unset=True)
    out = {}
    if "name" in ch:
        out["name"] = ch["name"]
    for f in ("enabled", "dry_run", "allow_cloud_write", "offline_write_window_s"):
        if f in ch:
            out[f] = ch[f]
    cond = cur["conditions"] if "conditions" not in ch else \
        validate_conditions(ch["conditions"] or {})
    acts = cur["actions"] if "actions" not in ch else \
        validate_actions(ch["actions"] or [])
    return out, cond, acts


@router.patch(_R + "/{rule}")
async def patch_rule(org: str, rule: str, body: RulePatch, request: Request,
                     p=Depends(_user)):
    m = _m()
    org_id = m._v2_org(org, p, m._CONFIG)
    rid = m._uuid_or_404(rule, "rule")
    await m._mutation_gate(request, p.user_id)
    async with tenant_tx(m.st(request).pools.app, org_id, p.user_id) as tc:
        cur = await tc.fetchrow("SELECT * FROM vision_rules WHERE id=$1 FOR UPDATE", rid)
        if cur is None:
            raise HTTPException(404, "rule not found")
        try:
            sets, cond, acts = _merge_patch(cur, body)
        except ValueError as e:
            return _bad(e)
        sets["conditions"], sets["actions"] = cond, acts
        cam = await _camera(tc, cur["camera_id"])
        await _check_write_tags(tc, cam["site_id"], acts)
        cols, args = [], []
        for k, v in sets.items():
            args.append(v)
            cols.append(f"{k}=${len(args)}")
        args.append(rid)
        try:
            row = await tc.fetchrow(
                f"UPDATE vision_rules SET {', '.join(cols)}, updated_at=now()"
                f" WHERE id=${len(args)} RETURNING *", *args)
        except asyncpg.UniqueViolationError:
            raise HTTPException(409, "rule_name_exists") from None
        ver = await bump_config(tc, cam["edge_id"])
        await audit.append(tc, f"user:{p.user_id}", "vision.rule.updated",
                           {"rule_id": str(rid), "camera_id": str(cur["camera_id"])},
                           {"fields": sorted(k for k in sets
                                             if k not in ("conditions", "actions"))
                            + (["conditions"] if "conditions" in sets else [])
                            + (["actions"] if "actions" in sets else [])})
    return {"rule": rule_json(row), "config_version": ver}


@router.delete(_R + "/{rule}", status_code=204)
async def delete_rule(org: str, rule: str, request: Request, p=Depends(_user)):
    m = _m()
    org_id = m._v2_org(org, p, m._CONFIG)
    rid = m._uuid_or_404(rule, "rule")
    await m._mutation_gate(request, p.user_id)
    async with tenant_tx(m.st(request).pools.app, org_id, p.user_id) as tc:
        gone = await tc.fetchrow(
            "DELETE FROM vision_rules WHERE id=$1 RETURNING id, camera_id", rid)
        if gone is None:
            raise HTTPException(404, "rule not found")
        cam = await tc.fetchrow("SELECT edge_id FROM cameras WHERE id=$1", gone["camera_id"])
        if cam is not None:
            await bump_config(tc, cam["edge_id"])
        await audit.append(tc, f"user:{p.user_id}", "vision.rule.deleted",
                           {"rule_id": str(rid)}, {})
