"""v2 admin API: dashboards routes. Moved verbatim from main.py."""

from __future__ import annotations

from ..auth import Principal
from ..db import audit
from ..db.util import iso_z
from ..security import ForbiddenError
from datetime import datetime
from fastapi import Depends
from fastapi import HTTPException
from fastapi import Request
from fastapi.responses import Response
from pydantic import BaseModel
from pydantic import Field
from pydantic import field_validator
from uuid import UUID
import json
from ..deps import (
    CONFIG_ROLES,
    _OPERATE,
    _effective_org_roles,
    _mutation_gate,
    _uuid_or_404,
    _v2_org,
    org_tx,
    require_user,
)
from fastapi import APIRouter

router = APIRouter()

# ---------------------------------------------------------------------------
# Dashboards — saved boards (FR-26). Any member reads shared boards + their own;
# operators+ create; the author or an admin/owner edits and deletes.
# ---------------------------------------------------------------------------
DASH_BODY_MAX = 256_000  # bytes of JSON; a board is tens of widgets


class DashboardIn(BaseModel):
    id: UUID | None = None  # client-minted so the editor can create offline-first
    title: str = Field(min_length=1, max_length=120)
    description: str = Field(default="", max_length=500)
    shared: bool = True
    body: dict = Field(default_factory=dict)

    @field_validator("body")
    @classmethod
    def _bounded(cls, v: dict) -> dict:
        if len(json.dumps(v)) > DASH_BODY_MAX:
            raise ValueError("body too large")
        return v


_DASH_COLS = "id, author_id, title, description, shared, body, updated_at"


def _dash_json(r, me: UUID) -> dict:
    body = r["body"] if isinstance(r["body"], dict) else json.loads(r["body"])
    return {"id": str(r["id"]), "title": r["title"], "description": r["description"],
            "shared": r["shared"], "mine": r["author_id"] == me, "body": body,
            "updated_at": iso_z(r["updated_at"])}


@router.get("/api/v1/orgs/{org}/dashboards")
async def v2_list_dashboards(org: str, request: Request,
                             p: Principal = Depends(require_user)):
    org_id = _v2_org(org, p)
    async with org_tx(request, org_id, p.user_id) as tc:
        rows = await tc.fetch(
            f"SELECT {_DASH_COLS} FROM dashboards"
            " WHERE shared OR author_id=$1 ORDER BY updated_at DESC", p.user_id)
    return {"dashboards": [_dash_json(r, p.user_id) for r in rows]}


@router.post("/api/v1/orgs/{org}/dashboards", status_code=201)
async def v2_create_dashboard(org: str, body: DashboardIn, request: Request,
                              p: Principal = Depends(require_user)):
    org_id = _v2_org(org, p, need=_OPERATE)
    await _mutation_gate(request, p.user_id)
    async with org_tx(request, org_id, p.user_id) as tc:
        row = await tc.fetchrow(
            "INSERT INTO dashboards(id, org_id, author_id, title, description, shared, body)"
            f" VALUES (COALESCE($7, gen_random_uuid()),$1,$2,$3,$4,$5,$6::jsonb) RETURNING {_DASH_COLS}",
            org_id, p.user_id, body.title, body.description, body.shared,
            json.dumps(body.body), body.id)
        await audit.append(tc, f"user:{p.user_id}", "dashboard.created",
                           {"dashboard_id": str(row["id"])}, {"title": body.title})
    return {"dashboard": _dash_json(row, p.user_id)}


async def _dash_writable(tc, org: str, dash_id: str, p: Principal, org_id: UUID):
    row = await tc.fetchrow(
        f"SELECT {_DASH_COLS} FROM dashboards WHERE id=$1 AND (shared OR author_id=$2)",
        _uuid_or_404(dash_id, "dashboard"), p.user_id)
    if row is None:
        raise HTTPException(404, "dashboard not found")
    if row["author_id"] != p.user_id and _effective_org_roles(p)[org_id] not in CONFIG_ROLES:
        raise ForbiddenError("only the author or an admin can change this dashboard")
    return row


@router.put("/api/v1/orgs/{org}/dashboards/{dash_id}")
async def v2_update_dashboard(org: str, dash_id: str, body: DashboardIn,
                              request: Request, p: Principal = Depends(require_user)):
    org_id = _v2_org(org, p, need=_OPERATE)
    await _mutation_gate(request, p.user_id)
    async with org_tx(request, org_id, p.user_id) as tc:
        cur = await _dash_writable(tc, org, dash_id, p, org_id)
        row = await tc.fetchrow(
            "UPDATE dashboards SET title=$2, description=$3, shared=$4, body=$5::jsonb,"
            f" updated_at=now() WHERE id=$1 RETURNING {_DASH_COLS}",
            cur["id"], body.title, body.description, body.shared, json.dumps(body.body))
        await audit.append(tc, f"user:{p.user_id}", "dashboard.updated",
                           {"dashboard_id": str(cur["id"])}, {"title": body.title})
    return {"dashboard": _dash_json(row, p.user_id)}


@router.delete("/api/v1/orgs/{org}/dashboards/{dash_id}", status_code=204)
async def v2_delete_dashboard(org: str, dash_id: str, request: Request,
                              p: Principal = Depends(require_user)):
    org_id = _v2_org(org, p, need=_OPERATE)
    await _mutation_gate(request, p.user_id)
    async with org_tx(request, org_id, p.user_id) as tc:
        cur = await _dash_writable(tc, org, dash_id, p, org_id)
        await tc.execute("DELETE FROM dashboards WHERE id=$1", cur["id"])
        await audit.append(tc, f"user:{p.user_id}", "dashboard.deleted",
                           {"dashboard_id": str(cur["id"])}, {"title": cur["title"]})
    return Response(status_code=204)


# ---------------------------------------------------------------------------
# Notebooks — markdown notes. Same access shape as dashboards: members read
# shared + their own; operators+ create; author or admin/owner edits/deletes.
# ---------------------------------------------------------------------------
class NotebookIn(BaseModel):
    id: UUID | None = None
    title: str = Field(min_length=1, max_length=120)
    body: str = Field(default="", max_length=100_000)
    shared: bool = True
    # optimistic concurrency: the updated_at the editor loaded; stale -> 409
    base_updated_at: datetime | None = None


_NB_COLS = "id, author_id, title, body, shared, updated_at"


def _nb_json(r, me: UUID) -> dict:
    return {"id": str(r["id"]), "title": r["title"], "body": r["body"],
            "shared": r["shared"], "mine": r["author_id"] == me,
            "updated_at": iso_z(r["updated_at"])}


@router.get("/api/v1/orgs/{org}/notebooks")
async def v2_list_notebooks(org: str, request: Request,
                            p: Principal = Depends(require_user)):
    org_id = _v2_org(org, p)
    async with org_tx(request, org_id, p.user_id) as tc:
        rows = await tc.fetch(
            f"SELECT {_NB_COLS} FROM notebooks"
            " WHERE shared OR author_id=$1 ORDER BY updated_at DESC LIMIT 500", p.user_id)
    return {"notebooks": [_nb_json(r, p.user_id) for r in rows]}


@router.post("/api/v1/orgs/{org}/notebooks", status_code=201)
async def v2_create_notebook(org: str, body: NotebookIn, request: Request,
                             p: Principal = Depends(require_user)):
    org_id = _v2_org(org, p, need=_OPERATE)
    await _mutation_gate(request, p.user_id)
    async with org_tx(request, org_id, p.user_id) as tc:
        row = await tc.fetchrow(
            "INSERT INTO notebooks(id, org_id, author_id, title, body, shared)"
            f" VALUES (COALESCE($6, gen_random_uuid()),$1,$2,$3,$4,$5) RETURNING {_NB_COLS}",
            org_id, p.user_id, body.title, body.body, body.shared, body.id)
        await audit.append(tc, f"user:{p.user_id}", "notebook.created",
                           {"notebook_id": str(row["id"])}, {"title": body.title})
    return {"notebook": _nb_json(row, p.user_id)}


async def _nb_writable(tc, nb_id: str, p: Principal, org_id: UUID):
    row = await tc.fetchrow(
        f"SELECT {_NB_COLS} FROM notebooks WHERE id=$1 AND (shared OR author_id=$2)",
        _uuid_or_404(nb_id, "notebook"), p.user_id)
    if row is None:
        raise HTTPException(404, "notebook not found")
    if row["author_id"] != p.user_id and _effective_org_roles(p)[org_id] not in CONFIG_ROLES:
        raise ForbiddenError("only the author or an admin can change this notebook")
    return row


@router.put("/api/v1/orgs/{org}/notebooks/{nb_id}")
async def v2_update_notebook(org: str, nb_id: str, body: NotebookIn, request: Request,
                             p: Principal = Depends(require_user)):
    org_id = _v2_org(org, p, need=_OPERATE)
    await _mutation_gate(request, p.user_id)
    async with org_tx(request, org_id, p.user_id) as tc:
        cur = await _nb_writable(tc, nb_id, p, org_id)
        # wire timestamps are ms-precision; the column is µs
        if body.base_updated_at is not None and                 cur["updated_at"].replace(microsecond=cur["updated_at"].microsecond // 1000 * 1000)                 != body.base_updated_at:
            raise HTTPException(409, "notebook changed since you opened it")
        row = await tc.fetchrow(
            "UPDATE notebooks SET title=$2, body=$3, shared=$4, updated_at=now()"
            f" WHERE id=$1 RETURNING {_NB_COLS}", cur["id"], body.title, body.body, body.shared)
        await audit.append(tc, f"user:{p.user_id}", "notebook.updated",
                           {"notebook_id": str(cur["id"])}, {"title": body.title})
    return {"notebook": _nb_json(row, p.user_id)}


@router.delete("/api/v1/orgs/{org}/notebooks/{nb_id}", status_code=204)
async def v2_delete_notebook(org: str, nb_id: str, request: Request,
                             p: Principal = Depends(require_user)):
    org_id = _v2_org(org, p, need=_OPERATE)
    await _mutation_gate(request, p.user_id)
    async with org_tx(request, org_id, p.user_id) as tc:
        cur = await _nb_writable(tc, nb_id, p, org_id)
        await tc.execute("DELETE FROM notebooks WHERE id=$1", cur["id"])
        await audit.append(tc, f"user:{p.user_id}", "notebook.deleted",
                           {"notebook_id": str(cur["id"])}, {"title": cur["title"]})
    return Response(status_code=204)
