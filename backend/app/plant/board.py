"""Plant board: the 2D SCADA board built from side captures of each 3D part.

One draft per (site, model) is edited; publish freezes it as the next version
and rollback re-publishes an older one. Every change is audited. Reads are open
to any org member; writes need config:write. The board only stores positions
and pictures — it never issues a command: clicking a part just opens the
control page, which goes through the normal guarded command path.

Not mounted yet: main.py needs `from .plant.board import router as board_router`
and `app.include_router(board_router)` (integration note in the F07 report).
"""

from __future__ import annotations

import base64
import binascii
import json
import re
from typing import Literal
from uuid import UUID

import asyncpg
from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, ConfigDict, Field, field_validator

from ..db import audit
from ..db.context import tenant_tx
from ..db.util import iso_z

router = APIRouter()

_SHA = r"^[A-Za-z0-9_-]{4,64}$"
_KEY = r"^[A-Za-z0-9_.-]{1,40}$"
_MAX_ITEMS = 400
_MAX_PNG = 512 * 1024
_PNG_MAGIC = b"\x89PNG\r\n\x1a\n"
_COORD = Field(ge=-1000, le=20000)
_SIDE = Field(gt=0, le=2000)


def _m():
    from .. import main
    return main


async def _user(request: Request):
    return await _m().require_user(request)


class _Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")


class ItemIn(_Strict):
    x: float = _COORD
    y: float = _COORD
    w: float = _SIDE
    h: float = _SIDE
    locked: bool | None = None
    hidden: bool | None = None


class LaneIn(_Strict):
    id: str = Field(pattern=_KEY)
    y: float = _COORD
    h: float = Field(ge=0, le=20000)


class LinksIn(_Strict):
    add: list[tuple[str, str]] = Field(default_factory=list, max_length=_MAX_ITEMS)
    remove: list[tuple[str, str]] = Field(default_factory=list, max_length=_MAX_ITEMS)

    @field_validator("add", "remove")
    @classmethod
    def _keys(cls, v: list[tuple[str, str]]) -> list[tuple[str, str]]:
        for a, b in v:
            if not (re.fullmatch(_KEY, a) and re.fullmatch(_KEY, b)):
                raise ValueError("bad part key in link")
        return v


class LayoutIn(_Strict):
    v: Literal[1]
    w: float = Field(gt=0, le=20000)
    h: float = Field(gt=0, le=20000)
    items: dict[str, ItemIn] = Field(max_length=_MAX_ITEMS)
    lanes: list[LaneIn] = Field(default_factory=list, max_length=60)
    links: LinksIn = Field(default_factory=LinksIn)

    @field_validator("items")
    @classmethod
    def _item_keys(cls, v: dict[str, ItemIn]) -> dict[str, ItemIn]:
        if any(not re.fullmatch(_KEY, k) for k in v):
            raise ValueError("bad part key")
        return v


class DraftIn(_Strict):
    model_sha: str = Field(pattern=_SHA)
    model_id: UUID | None = None
    layout: LayoutIn


class ShaIn(_Strict):
    model_sha: str = Field(pattern=_SHA)


class RollbackIn(ShaIn):
    version: int = Field(ge=1, le=100000)


class BoxIn(_Strict):
    min: list[float] = Field(min_length=3, max_length=3)
    max: list[float] = Field(min_length=3, max_length=3)


class CaptureIn(_Strict):
    key: str = Field(pattern=_KEY)
    w: int = Field(ge=1, le=2048)
    h: int = Field(ge=1, le=2048)
    view: Literal["side", "front"]
    png_b64: str = Field(max_length=_MAX_PNG * 4 // 3 + 8)
    box: BoxIn


class CapturesIn(ShaIn):
    items: list[CaptureIn] = Field(min_length=1, max_length=120)


def _board_json(r: asyncpg.Record | None) -> dict | None:
    if r is None:
        return None
    lay = r["layout"]
    if isinstance(lay, str):
        lay = json.loads(lay)
    return {"id": str(r["id"]), "version": r["version"], "status": r["status"], "layout": lay,
            "model_sha": r["model_sha"], "created_by": str(r["created_by"]) if r["created_by"] else None,
            "created_at": iso_z(r["created_at"])}


def _scope(org: str, site: str, p, write: bool):
    m = _m()
    return m._v2_scope(org, site, p, m._CONFIG) if write else m._v2_scope(org, site, p)


BASE = "/api/v1/orgs/{org}/sites/{site}/plant-board"


@router.get(BASE)
async def get_board(org: str, site: str, request: Request, model_sha: str, p=Depends(_user)):
    """Draft, latest published layout and the version list for one model."""
    _check_sha(model_sha)
    m = _m()
    org_id, site_id = _scope(org, site, p, False)
    async with tenant_tx(m.st(request).pools.app, org_id) as tc:
        rows = await tc.fetch(
            "SELECT * FROM plant_boards WHERE site_id=$1 AND model_sha=$2"
            " ORDER BY version DESC NULLS FIRST", site_id, model_sha)
    draft = next((r for r in rows if r["status"] == "draft"), None)
    pub = [r for r in rows if r["status"] == "published"]
    return {"draft": _board_json(draft), "published": _board_json(pub[0] if pub else None),
            "versions": [{"version": r["version"], "created_at": iso_z(r["created_at"]),
                          "created_by": str(r["created_by"]) if r["created_by"] else None} for r in pub]}


@router.put(BASE + "/draft")
async def save_draft(org: str, site: str, body: DraftIn, request: Request, p=Depends(_user)):
    m = _m()
    org_id, site_id = _scope(org, site, p, True)
    await m._mutation_gate(request, p.user_id)
    layout = body.layout.model_dump(exclude_none=True)
    async with tenant_tx(m.st(request).pools.app, org_id, p.user_id) as tc:
        await _check_model(tc, site_id, body.model_id, body.model_sha)
        row = await tc.fetchrow(
            "INSERT INTO plant_boards(org_id, site_id, model_id, model_sha, status, layout, created_by)"
            " VALUES ($1,$2,$3,$4,'draft',$5::jsonb,$6)"
            " ON CONFLICT (org_id, site_id, model_sha) WHERE status = 'draft'"
            " DO UPDATE SET layout=EXCLUDED.layout, model_id=EXCLUDED.model_id,"
            " created_by=EXCLUDED.created_by, created_at=now() RETURNING *",
            org_id, site_id, body.model_id, body.model_sha, layout, p.user_id)
        await audit.append(tc, f"user:{p.user_id}", "plant_board.draft_saved",
                           {"model_sha": body.model_sha}, {"parts": len(layout["items"])})
    return {"draft": _board_json(row)}


@router.post(BASE + "/publish")
async def publish(org: str, site: str, body: ShaIn, request: Request, p=Depends(_user)):
    m = _m()
    org_id, site_id = _scope(org, site, p, True)
    await m._mutation_gate(request, p.user_id)
    async with tenant_tx(m.st(request).pools.app, org_id, p.user_id) as tc:
        d = await tc.fetchrow(
            "SELECT id FROM plant_boards WHERE site_id=$1 AND model_sha=$2 AND status='draft' FOR UPDATE",
            site_id, body.model_sha)
        if d is None:
            raise HTTPException(409, "no draft to publish")
        row = await _next_version(tc, site_id, body.model_sha, "UPDATE", d["id"], p.user_id)
        await audit.append(tc, f"user:{p.user_id}", "plant_board.published",
                           {"model_sha": body.model_sha}, {"version": row["version"]})
    return {"published": _board_json(row)}


@router.post(BASE + "/rollback")
async def rollback(org: str, site: str, body: RollbackIn, request: Request, p=Depends(_user)):
    """Re-publish an older version as the newest one (history is never rewritten)."""
    m = _m()
    org_id, site_id = _scope(org, site, p, True)
    await m._mutation_gate(request, p.user_id)
    async with tenant_tx(m.st(request).pools.app, org_id, p.user_id) as tc:
        old = await tc.fetchrow(
            "SELECT * FROM plant_boards WHERE site_id=$1 AND model_sha=$2 AND status='published' AND version=$3",
            site_id, body.model_sha, body.version)
        if old is None:
            raise HTTPException(404, "version not found")
        row = await _next_version(tc, site_id, body.model_sha, "INSERT", old, p.user_id)
        await tc.execute("DELETE FROM plant_boards WHERE site_id=$1 AND model_sha=$2 AND status='draft'",
                         site_id, body.model_sha)
        await audit.append(tc, f"user:{p.user_id}", "plant_board.rolled_back",
                           {"model_sha": body.model_sha},
                           {"to_version": body.version, "new_version": row["version"]})
    return {"published": _board_json(row)}


async def _next_version(tc, site_id: UUID, sha: str, how: str, src, user_id) -> asyncpg.Record:
    await tc.execute("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", f"{site_id}:{sha}")
    nxt = await tc.fetchval(
        "SELECT coalesce(max(version), 0) + 1 FROM plant_boards"
        " WHERE site_id=$1 AND model_sha=$2 AND status='published'", site_id, sha)
    if how == "UPDATE":
        return await tc.fetchrow(
            "UPDATE plant_boards SET status='published', version=$2, created_by=$3, created_at=now()"
            " WHERE id=$1 RETURNING *", src, nxt, user_id)
    return await tc.fetchrow(
        "INSERT INTO plant_boards(org_id, site_id, model_id, model_sha, version, status, layout, created_by)"
        " VALUES ($1,$2,$3,$4,$5,'published',$6::jsonb,$7) RETURNING *",
        tc.org_id, site_id, src["model_id"], sha, nxt,
        src["layout"] if isinstance(src["layout"], str) else json.dumps(src["layout"]), user_id)


@router.get(BASE + "/captures")
async def get_captures(org: str, site: str, request: Request, model_sha: str, p=Depends(_user)):
    _check_sha(model_sha)
    m = _m()
    org_id, site_id = _scope(org, site, p, False)
    async with tenant_tx(m.st(request).pools.app, org_id) as tc:
        rows = await tc.fetch(
            "SELECT part_key, w, h, view, png, box FROM plant_board_captures"
            " WHERE site_id=$1 AND model_sha=$2 ORDER BY part_key", site_id, model_sha)
    return {"items": [{"key": r["part_key"], "w": r["w"], "h": r["h"], "view": r["view"],
                       "url": "data:image/png;base64," + base64.b64encode(r["png"]).decode(),
                       "box": json.loads(r["box"]) if isinstance(r["box"], str) else r["box"]} for r in rows]}


@router.put(BASE + "/captures")
async def put_captures(org: str, site: str, body: CapturesIn, request: Request, p=Depends(_user)):
    m = _m()
    org_id, site_id = _scope(org, site, p, True)
    await m._mutation_gate(request, p.user_id)
    pngs: list[bytes] = []
    for it in body.items:
        try:
            raw = base64.b64decode(it.png_b64, validate=True)
        except (binascii.Error, ValueError):
            raise HTTPException(422, f"{it.key}: image is not base64") from None
        if not raw.startswith(_PNG_MAGIC) or len(raw) > _MAX_PNG:
            raise HTTPException(422, f"{it.key}: image must be a PNG up to {_MAX_PNG // 1024} KB")
        pngs.append(raw)
    async with tenant_tx(m.st(request).pools.app, org_id, p.user_id) as tc:
        for it, raw in zip(body.items, pngs, strict=True):
            await tc.execute(
                "INSERT INTO plant_board_captures(org_id, site_id, model_sha, part_key, w, h, view, png, box)"
                " VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb)"
                " ON CONFLICT (org_id, site_id, model_sha, part_key) DO UPDATE SET"
                " w=EXCLUDED.w, h=EXCLUDED.h, view=EXCLUDED.view, png=EXCLUDED.png, box=EXCLUDED.box,"
                " created_at=now()",
                org_id, site_id, body.model_sha, it.key, it.w, it.h, it.view, raw, it.box.model_dump())
        await audit.append(tc, f"user:{p.user_id}", "plant_board.captured",
                           {"model_sha": body.model_sha}, {"parts": len(body.items)})
    return {"saved": len(body.items)}


def _check_sha(sha: str) -> None:
    if not re.fullmatch(_SHA, sha):
        raise HTTPException(422, "bad model_sha")


async def _check_model(tc, site_id: UUID, model_id: UUID | None, sha: str) -> None:
    """A board that names a model must name this site's model with that sha."""
    if model_id is None:
        return
    got = await tc.fetchval("SELECT sha256 FROM plant_models WHERE id=$1 AND site_id=$2", model_id, site_id)
    if got is None:
        raise HTTPException(404, "plant model not found")
    if got != sha:
        raise HTTPException(422, "model_sha does not match the model")
