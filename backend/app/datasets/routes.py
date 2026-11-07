"""Explore + datasets (F13): lagged correlation between two tags, and saved
time-bucketed datasets exported as CSV.

Exports are tenant-scoped (RLS) and never include simulated data: tags whose
data source is the built-in simulator are skipped and named in a header comment.
"""

from __future__ import annotations

import csv
import io
import math
from datetime import datetime
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import Response
from pydantic import BaseModel, Field, model_validator

from ..db import audit
from ..db.context import tenant_tx
from ..db.util import iso_z

router = APIRouter()
_S = "/api/v1/orgs/{org}/sites/{site}"
MAX_BUCKETS = 5000


def _m():
    from .. import main
    return main


async def _user(request: Request):
    return await _m().require_user(request)


def split_of(i: int, total: int, train_pct: int, val_pct: int) -> str:
    """Chronological split by bucket position: the oldest rows train, the newest test (no shuffling, no leakage)."""
    f = i / total if total else 0
    return "train" if f < train_pct / 100 else "val" if f < (train_pct + val_pct) / 100 else "test"


def pearson(a: list[float], b: list[float]) -> float | None:
    n = len(a)
    if n < 3:
        return None
    ma, mb = sum(a) / n, sum(b) / n
    va = sum((x - ma) ** 2 for x in a)
    vb = sum((y - mb) ** 2 for y in b)
    if va == 0 or vb == 0:
        return None
    return sum((x - ma) * (y - mb) for x, y in zip(a, b)) / math.sqrt(va * vb)


def lag_corr(a: dict, b: dict, max_lag: int) -> list[dict]:
    """a, b: bucket index -> value. lag k pairs a[i] with b[i+k] (b follows a for k>0)."""
    out = []
    for k in range(-max_lag, max_lag + 1):
        xs, ys = [], []
        for i, x in a.items():
            y = b.get(i + k)
            if y is not None:
                xs.append(x)
                ys.append(y)
        r = pearson(xs, ys)
        out.append({"lag": k, "r": round(r, 4) if r is not None else None, "n": len(xs)})
    return out


async def _series(tc, tag_ids, t_from, t_to, bucket_s):
    return await tc.fetch(
        "SELECT tag_id, floor(extract(epoch from ts - $2)/$4)::int AS i, avg(vn) AS av"
        " FROM tag_history WHERE tag_id = ANY($1::uuid[]) AND ts >= $2 AND ts < $3 AND q='good' AND vn IS NOT NULL"
        " GROUP BY 1, 2 ORDER BY 2", tag_ids, t_from, t_to, bucket_s)


def _check_window(t_from: datetime, t_to: datetime, bucket_s: int) -> None:
    if t_from >= t_to:
        raise HTTPException(422, "bad_range")
    if (t_to - t_from).total_seconds() / bucket_s > MAX_BUCKETS:
        raise HTTPException(422, "too_many_buckets")


@router.get(_S + "/explore/lag")
async def explore_lag(org: str, site: str, request: Request, a: UUID, b: UUID,
                      from_: datetime = Query(alias="from"), to: datetime = Query(),
                      bucket_s: int = Query(60, ge=1, le=86400), max_lag: int = Query(10, ge=0, le=100),
                      p=Depends(_user)):
    m = _m()
    org_id = m._v2_org(org, p, m._READ)
    site_id = m._uuid_or_404(site, "site")
    _check_window(from_, to, bucket_s)
    async with tenant_tx(m.st(request).pools.app, org_id) as tc:
        found = await tc.fetchval("SELECT count(*) FROM tags WHERE site_id=$1 AND id = ANY($2::uuid[])", site_id, [a, b])
        if found != len({a, b}):
            raise HTTPException(404, "tag not found")
        rows = await _series(tc, [a, b], from_, to, bucket_s)
    sa = {r["i"]: r["av"] for r in rows if r["tag_id"] == a}
    sb = {r["i"]: r["av"] for r in rows if r["tag_id"] == b}
    res = lag_corr(sa, sb, max_lag)
    best = max((x for x in res if x["r"] is not None), key=lambda x: abs(x["r"]), default=None)
    return {"bucket_s": bucket_s, "items": res, "best": best}


class DatasetIn(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    tag_ids: list[UUID] = Field(min_length=1, max_length=50)
    from_ts: datetime
    to_ts: datetime
    bucket_s: int = Field(default=60, ge=1, le=86400)
    train_pct: int = Field(default=70, ge=1, le=98)
    val_pct: int = Field(default=15, ge=0, le=98)

    @model_validator(mode="after")
    def _w(self):
        _check_window(self.from_ts, self.to_ts, self.bucket_s)
        if self.train_pct + self.val_pct >= 100:
            raise ValueError("train_pct + val_pct must leave room for a test split")
        return self


def _json(r) -> dict:
    return {"id": str(r["id"]), "name": r["name"], "tag_ids": [str(t) for t in r["tag_ids"]],
            "from_ts": iso_z(r["from_ts"]), "to_ts": iso_z(r["to_ts"]), "bucket_s": r["bucket_s"],
            "train_pct": r["train_pct"], "val_pct": r["val_pct"], "created_at": iso_z(r["created_at"])}


@router.get(_S + "/datasets")
async def list_datasets(org: str, site: str, request: Request, p=Depends(_user)):
    m = _m()
    org_id = m._v2_org(org, p, m._READ)
    site_id = m._uuid_or_404(site, "site")
    async with tenant_tx(m.st(request).pools.app, org_id) as tc:
        rows = await tc.fetch("SELECT * FROM datasets WHERE site_id=$1 ORDER BY created_at DESC LIMIT 200", site_id)
    return {"items": [_json(r) for r in rows]}


@router.post(_S + "/datasets", status_code=201)
async def create_dataset(org: str, site: str, body: DatasetIn, request: Request, p=Depends(_user)):
    m = _m()
    org_id = m._v2_org(org, p, m._OPERATE)
    site_id = m._uuid_or_404(site, "site")
    await m._mutation_gate(request, p.user_id)
    async with tenant_tx(m.st(request).pools.app, org_id, p.user_id) as tc:
        n = await tc.fetchval("SELECT count(*) FROM tags WHERE site_id=$1 AND id = ANY($2::uuid[])", site_id, body.tag_ids)
        if n != len(set(body.tag_ids)):
            raise HTTPException(422, "unknown_tag")
        r = await tc.fetchrow(
            "INSERT INTO datasets(org_id, site_id, name, tag_ids, from_ts, to_ts, bucket_s, created_by, train_pct, val_pct)"
            " VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *",
            org_id, site_id, body.name, list(set(body.tag_ids)), body.from_ts, body.to_ts, body.bucket_s, p.user_id,
            body.train_pct, body.val_pct)
        await audit.append(tc, f"user:{p.user_id}", "dataset.created", {"dataset_id": str(r["id"])}, {"name": body.name})
    return {"dataset": _json(r)}


@router.delete(_S + "/datasets/{ds}", status_code=204)
async def delete_dataset(org: str, site: str, ds: str, request: Request, p=Depends(_user)):
    m = _m()
    org_id = m._v2_org(org, p, m._OPERATE)
    did = m._uuid_or_404(ds, "dataset")
    await m._mutation_gate(request, p.user_id)
    async with tenant_tx(m.st(request).pools.app, org_id, p.user_id) as tc:
        if await tc.fetchval("DELETE FROM datasets WHERE id=$1 RETURNING 1", did) is None:
            raise HTTPException(404, "dataset not found")
        await audit.append(tc, f"user:{p.user_id}", "dataset.deleted", {"dataset_id": str(did)}, {})


@router.get(_S + "/datasets/{ds}/export.csv")
async def export_dataset(org: str, site: str, ds: str, request: Request, p=Depends(_user)):
    m = _m()
    org_id = m._v2_org(org, p, m._READ)
    did = m._uuid_or_404(ds, "dataset")
    async with tenant_tx(m.st(request).pools.app, org_id, p.user_id) as tc:
        d = await tc.fetchrow("SELECT * FROM datasets WHERE id=$1", did)
        if d is None:
            raise HTTPException(404, "dataset not found")
        tags = await tc.fetch(
            "SELECT t.id, t.path, (s.protocol = 'sim') AS simulated FROM tags t"
            " LEFT JOIN data_sources s ON s.org_id=t.org_id AND s.id=t.source_id"
            " WHERE t.site_id=$1 AND t.id = ANY($2::uuid[]) ORDER BY t.path", d["site_id"], d["tag_ids"])
        real = [t for t in tags if not t["simulated"]]
        rows = await _series(tc, [t["id"] for t in real], d["from_ts"], d["to_ts"], d["bucket_s"]) if real else []
        await audit.append(tc, f"user:{p.user_id}", "dataset.exported", {"dataset_id": str(did)},
                           {"tags": len(real), "skipped_simulated": len(tags) - len(real)})
    grid: dict[int, dict] = {}
    for r in rows:
        grid.setdefault(r["i"], {})[r["tag_id"]] = r["av"]
    buf = io.StringIO()
    skipped = [t["path"] for t in tags if t["simulated"]]
    if skipped:
        buf.write("# skipped simulated tags: " + ", ".join(skipped) + "\n")
    w = csv.writer(buf)
    w.writerow(["ts", "split"] + [t["path"] for t in real])
    total = max(1, int((d["to_ts"] - d["from_ts"]).total_seconds() // d["bucket_s"]))
    for i in sorted(grid):
        ts = d["from_ts"].timestamp() + i * d["bucket_s"]
        w.writerow([iso_z(datetime.fromtimestamp(ts, d["from_ts"].tzinfo)),
                    split_of(i, total, d["train_pct"], d["val_pct"])] + [grid[i].get(t["id"]) for t in real])
    return Response(buf.getvalue(), media_type="text/csv", headers={
        "Content-Disposition": 'attachment; filename="dataset.csv"'})
