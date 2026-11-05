"""External model endpoints (roadmap 9.6): a model of kind='external' calls a
hosted inference service instead of a file. The API key is sealed with the
same secretbox the data sources use and is write-only — GET reports has_key.
"""

from __future__ import annotations

from typing import Literal
from urllib.parse import urlsplit
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field

from ..datasources import secretbox
from ..datasources.routes import bump_config
from ..db import audit
from ..db.context import tenant_tx
from ..db.util import iso_z

router = APIRouter()

_X = "/api/v1/orgs/{org}/vision/models/{model}/endpoint"
PROVIDERS = ("roboflow", "hf", "generic")


def _m():
    from .. import main
    return main


async def _user(request: Request):
    return await _m().require_user(request)


class EndpointIn(BaseModel):
    provider: Literal["roboflow", "hf", "generic"]
    url: str = Field(min_length=8, max_length=1000)
    key: str | None = Field(default=None, min_length=1, max_length=512)


def _check_url(url: str) -> str:
    u = urlsplit(url)
    if u.scheme not in ("http", "https") or not u.hostname:
        raise HTTPException(422, "url must be http(s) with a host")
    return url


async def _model(tc, model_id: UUID):
    row = await tc.fetchrow("SELECT id, org_id, kind FROM vision_models WHERE id=$1", model_id)
    if row is None:
        raise HTTPException(404, "model not found")
    return row


def _ep_json(r, model_id: UUID) -> dict:
    return {"id": str(r["id"]), "model_id": str(model_id), "provider": r["provider"],
            "url": r["url"], "has_key": r["key_enc"] is not None,
            "created_at": iso_z(r["created_at"]), "updated_at": iso_z(r["updated_at"])}


@router.get(_X)
async def get_endpoint(org: str, model: str, request: Request, p=Depends(_user)):
    m = _m()
    org_id = m._v2_org(org, p, m._READ)
    mid = m._uuid_or_404(model, "model")
    async with tenant_tx(m.st(request).pools.app, org_id) as tc:
        await _model(tc, mid)
        r = await tc.fetchrow("SELECT * FROM external_endpoints WHERE model_id=$1", mid)
    return {"endpoint": _ep_json(r, mid) if r else None}


@router.put(_X)
async def put_endpoint(org: str, model: str, body: EndpointIn, request: Request,
                       p=Depends(_user)):
    """Create/replace the endpoint; marks the model kind='external'. The key is
    write-only: omit it to keep the stored one, send it to rotate."""
    m = _m()
    org_id = m._v2_org(org, p, m._CONFIG)
    mid = m._uuid_or_404(model, "model")
    url = _check_url(body.url)
    await m._mutation_gate(request, p.user_id)
    async with tenant_tx(m.st(request).pools.app, org_id, p.user_id) as tc:
        mod = await _model(tc, mid)
        if body.key is not None:
            enc = secretbox.seal({"key": body.key})
        else:
            enc = await tc.fetchval(
                "SELECT key_enc FROM external_endpoints WHERE model_id=$1", mid)
        row = await tc.fetchrow(
            "INSERT INTO external_endpoints(org_id, model_id, provider, url, key_enc, created_by)"
            " VALUES ($1,$2,$3,$4,$5,$6)"
            " ON CONFLICT (org_id, model_id) DO UPDATE SET provider=EXCLUDED.provider,"
            " url=EXCLUDED.url, key_enc=EXCLUDED.key_enc, updated_at=now() RETURNING *",
            org_id, mid, body.provider, url, enc, p.user_id)
        if mod["kind"] != "external":
            await tc.execute("UPDATE vision_models SET kind='external' WHERE id=$1", mid)
        # every camera pinned to this model gets a fresh cfg (the endpoint lives
        # in the cfg model block)
        eids = await tc.fetch(
            "SELECT DISTINCT c.edge_id FROM cameras c JOIN camera_models cm"
            " ON cm.camera_id=c.id JOIN vision_model_versions v ON v.id=cm.model_version_id"
            " WHERE v.model_id=$1", mid)
        ver = None
        for e in eids:
            ver = await bump_config(tc, e["edge_id"])
        await audit.append(tc, f"user:{p.user_id}", "vision.endpoint.saved",
                           {"model_id": str(mid)}, {"provider": body.provider})
    return {"endpoint": _ep_json(row, mid), "config_version": ver}


@router.delete(_X, status_code=204)
async def delete_endpoint(org: str, model: str, request: Request, p=Depends(_user)):
    m = _m()
    org_id = m._v2_org(org, p, m._CONFIG)
    mid = m._uuid_or_404(model, "model")
    await m._mutation_gate(request, p.user_id)
    async with tenant_tx(m.st(request).pools.app, org_id, p.user_id) as tc:
        gone = await tc.fetchval(
            "DELETE FROM external_endpoints WHERE model_id=$1 RETURNING id", mid)
        if gone is None:
            raise HTTPException(404, "endpoint not found")
        await audit.append(tc, f"user:{p.user_id}", "vision.endpoint.deleted",
                           {"model_id": str(mid)}, {})


@router.get("/api/v1/orgs/{org}/vision/usage")
async def inference_usage(org: str, request: Request, p=Depends(_user)):
    """Metered cloud/edge inference for the current month (9.5/9.9)."""
    m = _m()
    org_id = m._v2_org(org, p, m._READ)
    async with tenant_tx(m.st(request).pools.app, org_id) as tc:
        rows = await tc.fetch(
            "SELECT day, placement, frames, gpu_seconds FROM inference_usage"
            " WHERE day >= date_trunc('month', CURRENT_DATE)::date ORDER BY day")
    return {"items": [{"day": r["day"].isoformat(), "placement": r["placement"],
                       "frames": r["frames"], "gpu_seconds": r["gpu_seconds"]} for r in rows]}
