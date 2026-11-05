"""Storage inventory: what each user uploaded, where it lives, is it in Garage.

Scope (the isolation contract, see docs/security/storage-threat-model.md):
  * every row comes from the database under the org's RLS context — an object
    that is not a row of THIS org is never listed;
  * an org member sees only their own uploads; admins/owners see the org with
    a per-user rollup;
  * Garage is listed under this org's prefix only; objects there without a
    row (orphans) are shown to admins, never served.
"""

from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Request

from .core import objstore
from .core import config
from .db.context import tenant_tx
from .db.util import iso_z
from .deps import CONFIG_ROLES, _effective_org_roles

router = APIRouter()
MAX_ITEMS = 500


def _m():
    from . import main
    return main


async def _user(request: Request):
    return await _m().require_user(request)


async def _rows(tc, only: UUID | None):
    """(kind, id, name, size, sha, owner, created_at, key) for the org's uploads."""
    own = " AND {col} = $1" if only else ""
    args = [only] if only else []
    out = []
    for r in await tc.fetch(
            "SELECT v.id, v.filename, v.size_bytes, v.sha256, v.uploaded_by, v.created_at FROM videos v WHERE true"
            + own.format(col="v.uploaded_by"), *args):
        out.append(("video", r["id"], r["filename"], r["size_bytes"], r["sha256"], r["uploaded_by"], r["created_at"], "videos"))
    for r in await tc.fetch(
            "SELECT v.id, m.name || ' v' || v.version AS name, v.size_bytes, v.sha256, v.created_by, v.created_at,"
            " v.source_format FROM vision_model_versions v JOIN vision_models m ON m.id=v.model_id WHERE true"
            + own.format(col="v.created_by"), *args):
        out.append(("model", r["id"], r["name"], r["size_bytes"] or 0, r["sha256"], r["created_by"], r["created_at"], "models"))
    for r in await tc.fetch(
            "SELECT id, name, size_bytes, sha256, created_by, created_at FROM plant_models WHERE true"
            + own.format(col="created_by"), *args):
        out.append(("plant", r["id"], r["name"], r["size_bytes"], r["sha256"], r["created_by"], r["created_at"], "plant-models"))
    return out


def _key(kind: str, org: UUID, i: UUID) -> str:
    if kind == "video":
        return objstore.key("videos", org, i)
    if kind == "model":
        return objstore.key("models", org, i, "onnx")
    return objstore.key("plant-models", org, i, "glb")


@router.get("/api/v1/orgs/{org}/storage")
async def inventory(org: str, request: Request, p=Depends(_user)):
    m = _m()
    org_id = m._v2_org(org, p, m._READ)
    admin = _effective_org_roles(p).get(org_id) in CONFIG_ROLES
    async with tenant_tx(m.st(request).pools.app, org_id) as tc:
        rows = await _rows(tc, None if admin else p.user_id)
        names = {r["id"]: (r["display_name"] or r["email"]) for r in
                 await tc.fetch("SELECT id, display_name, email FROM users WHERE id = ANY($1::uuid[])",
                                list({r[5] for r in rows if r[5]}))}
    listing = await objstore.list_org(org_id)           # {key: size} under this org's prefixes, or None
    garage = {"enabled": objstore.enabled(), "reachable": None if not objstore.enabled() else listing is not None,
              "bucket": config.ARTIFACT_S3_BUCKET if objstore.enabled() else None}
    items, known = [], set()
    for kind, i, name, size, sha, owner, created, _ in rows:
        k = _key(kind, org_id, i)
        known.add(k)
        # plant models live in their own bucket (or disk): not part of this listing
        in_g = None if listing is None or kind == "plant" else k in listing
        items.append({"kind": kind, "id": str(i), "name": name, "size_bytes": size, "sha256": sha,
                      "owner_id": str(owner) if owner else None, "owner": names.get(owner) if owner else None,
                      "created_at": iso_z(created), "in_garage": in_g})
    items.sort(key=lambda x: x["created_at"], reverse=True)
    by_kind: dict[str, dict] = {}
    by_user: dict[str, dict] = {}
    for it in items:
        k = by_kind.setdefault(it["kind"], {"kind": it["kind"], "objects": 0, "bytes": 0})
        k["objects"] += 1
        k["bytes"] += it["size_bytes"] or 0
        u = by_user.setdefault(it["owner_id"] or "-", {"user_id": it["owner_id"], "name": it["owner"] or "—", "objects": 0, "bytes": 0})
        u["objects"] += 1
        u["bytes"] += it["size_bytes"] or 0
    orphans = []
    if admin and listing is not None:
        orphans = [{"key": k, "size": s} for k, s in sorted(listing.items()) if k not in known][:100]
        # source checkpoints (.pt) are kept in Garage only: not orphans if their model version exists
        vids = {str(r[1]) for r in rows if r[0] == "model"}
        orphans = [o for o in orphans if not (o["key"].startswith("models-src/") and o["key"].rsplit("/", 1)[-1].split(".")[0] in vids)]
    return {"scope": "org" if admin else "mine", "garage": garage,
            "totals": {"objects": len(items), "bytes": sum(i["size_bytes"] or 0 for i in items),
                       "in_garage": sum(1 for i in items if i["in_garage"]),
                       "missing": sum(1 for i in items if i["in_garage"] is False)},
            "by_kind": sorted(by_kind.values(), key=lambda x: -x["bytes"]),
            "by_user": sorted(by_user.values(), key=lambda x: -x["bytes"]),
            "items": items[:MAX_ITEMS], "orphans": orphans}


@router.post("/api/v1/orgs/{org}/storage/sync")
async def sync(org: str, request: Request, p=Depends(_user)):
    """Admin: copy every upload of this org that is not yet in Garage."""
    from .vision import storage as vstorage
    m = _m()
    org_id = m._v2_org(org, p, m._CONFIG)
    if not objstore.enabled():
        raise HTTPException(409, "object_store_disabled")
    await m._mutation_gate(request, p.user_id)
    async with tenant_tx(m.st(request).pools.app, org_id) as tc:
        rows = await _rows(tc, None)
    have = await objstore.list_org(org_id)
    if have is None:
        raise HTTPException(502, "object_store_unreachable")
    done = skipped = 0
    for kind, i, *_rest in rows:
        if kind == "plant":
            continue
        k = _key(kind, org_id, i)
        path = vstorage.path(org_id, i) if kind == "video" else vstorage.model_path(org_id, i)
        if k in have or not path.exists():
            skipped += 1
            continue
        done += 1 if await objstore.mirror(path, k) else 0
    return {"copied": done, "skipped": skipped}
