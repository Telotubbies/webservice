"""Model quality (F12): label the true material of a decision, confusion matrix
from real reviewed decisions, camera drift, per-model activation gate, rollback.

Predicted = the edge's `detail.decision`; true = what a reviewer saw.
"""

from __future__ import annotations

from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel, Field

from ..db import audit
from ..db.context import tenant_tx

router = APIRouter()
LABELS = ("gravel", "sand", "no-material")
DRIFT_MIN_N = 10
DRIFT_SHIFT = 0.15            # |mean sand_frac now - baseline| that is worth a look
_B = "/api/v1/orgs/{org}/vision"


def _m():
    from .. import main
    return main


async def _user(request: Request):
    return await _m().require_user(request)


class TrueIn(BaseModel):
    true_material: Literal["gravel", "sand", "no-material"]


@router.put(_B + "/events/{event}/true-material")
async def set_true_material(org: str, event: str, body: TrueIn, request: Request, p=Depends(_user)):
    m = _m()
    org_id = m._v2_org(org, p, m._OPERATE)
    eid = m._uuid_or_404(event, "event")
    await m._mutation_gate(request, p.user_id)
    async with tenant_tx(m.st(request).pools.app, org_id, p.user_id) as tc:
        pred = await tc.fetchval("SELECT detail->>'decision' FROM vision_events WHERE id=$1 AND kind='material'", eid)
        if pred is None:
            raise HTTPException(404, "material event not found")
        verdict = "correct" if pred == body.true_material else "wrong"
        await tc.execute(
            "INSERT INTO vision_event_reviews(event_id, org_id, verdict, true_material, reviewed_by, reviewed_at)"
            " VALUES ($1,$2,$3,$4,$5,now()) ON CONFLICT (event_id) DO UPDATE SET verdict=EXCLUDED.verdict,"
            " true_material=EXCLUDED.true_material, reviewed_by=EXCLUDED.reviewed_by, reviewed_at=now()",
            eid, org_id, verdict, body.true_material, p.user_id)
        await audit.append(tc, f"user:{p.user_id}", "vision.event.true_material",
                           {"event_id": str(eid)}, {"predicted": pred, "true": body.true_material})
    return {"ok": True, "verdict": verdict}


def matrix(pairs) -> dict:
    """pairs: (predicted, true). Rows = true, columns = predicted."""
    cells = {t: {pr: 0 for pr in LABELS} for t in LABELS}
    n = ok = 0
    for pr, t in pairs:
        if pr in LABELS and t in LABELS:
            cells[t][pr] += 1
            n += 1
            ok += pr == t
    return {"labels": list(LABELS), "cells": cells, "n": n, "accuracy": round(ok / n, 4) if n else None}


async def _pairs(tc, camera=None, version=None, model=None):
    rows = await tc.fetch(
        "SELECT e.detail->>'decision' AS pred, rv.true_material AS tru FROM vision_events e"
        " JOIN vision_event_reviews rv ON rv.event_id=e.id AND rv.true_material IS NOT NULL"
        " WHERE e.kind='material' AND ($1::uuid IS NULL OR e.camera_id=$1)"
        " AND ($2::uuid IS NULL OR e.model_version_id=$2)"
        " AND ($3::uuid IS NULL OR e.model_version_id IN (SELECT id FROM vision_model_versions WHERE model_id=$3))",
        camera, version, model)
    return [(r["pred"], r["tru"]) for r in rows]


@router.get(_B + "/material/confusion")
async def confusion(org: str, request: Request, camera: str | None = None, version: str | None = None,
                    p=Depends(_user)):
    m = _m()
    org_id = m._v2_org(org, p, m._READ)
    async with tenant_tx(m.st(request).pools.app, org_id) as tc:
        pairs = await _pairs(tc, m._uuid_or_404(camera, "camera") if camera else None,
                             m._uuid_or_404(version, "version") if version else None)
    return matrix(pairs)


def drift_flag(now_vals: list[float], base_vals: list[float]) -> dict:
    if len(now_vals) < DRIFT_MIN_N or len(base_vals) < DRIFT_MIN_N:
        return {"status": "insufficient", "shift": None}
    shift = sum(now_vals) / len(now_vals) - sum(base_vals) / len(base_vals)
    return {"status": "drift" if abs(shift) >= DRIFT_SHIFT else "ok", "shift": round(shift, 4)}


@router.get(_B + "/material/drift")
async def drift(org: str, request: Request, hours: int = Query(default=24, ge=1, le=168),
                p=Depends(_user)):
    """Per camera: mean sand fraction of the last `hours` against the 7 days before."""
    m = _m()
    org_id = m._v2_org(org, p, m._READ)
    async with tenant_tx(m.st(request).pools.app, org_id) as tc:
        rows = await tc.fetch(
            "SELECT camera_id, (detail->>'sand_frac')::float AS f, fired_at >= now() - make_interval(hours => $1) AS recent"
            " FROM vision_events WHERE kind='material' AND detail->>'sand_frac' IS NOT NULL"
            " AND fired_at >= now() - make_interval(hours => $1) - interval '7 days'", hours)
    by: dict = {}
    for r in rows:
        d = by.setdefault(str(r["camera_id"]), ([], []))
        d[0 if r["recent"] else 1].append(r["f"])
    return {"hours": hours, "items": [{"camera_id": c, "n_recent": len(a), "n_base": len(b), **drift_flag(a, b)}
                                      for c, (a, b) in sorted(by.items())]}


class GateIn(BaseModel):
    min_accuracy: float | None = Field(default=None, ge=0, le=1)
    min_samples: int | None = Field(default=None, ge=1, le=100000)


@router.get(_B + "/models/{model}/versions/{version}/quality")
async def quality(org: str, model: str, version: str, request: Request, p=Depends(_user)):
    m = _m()
    org_id = m._v2_org(org, p, m._READ)
    mid, vid = m._uuid_or_404(model, "model"), m._uuid_or_404(version, "version")
    async with tenant_tx(m.st(request).pools.app, org_id) as tc:
        return await gate_state(tc, mid, vid)


async def gate_state(tc, model_id, version_id) -> dict:
    g = await tc.fetchrow("SELECT gate_min_accuracy, gate_min_samples FROM vision_models WHERE id=$1", model_id)
    if g is None:
        raise HTTPException(404, "model not found")
    mx = matrix(await _pairs(tc, version=version_id))
    lo, ns = g["gate_min_accuracy"], g["gate_min_samples"]
    passed = None
    if lo is not None and mx["n"] >= (ns or 1):
        passed = mx["accuracy"] >= lo
    return {"confusion": mx, "gate": {"min_accuracy": lo, "min_samples": ns, "passed": passed}}


@router.put(_B + "/models/{model}/gate")
async def set_gate(org: str, model: str, body: GateIn, request: Request, p=Depends(_user)):
    m = _m()
    org_id = m._v2_org(org, p, m._CONFIG)
    mid = m._uuid_or_404(model, "model")
    await m._mutation_gate(request, p.user_id)
    async with tenant_tx(m.st(request).pools.app, org_id, p.user_id) as tc:
        if await tc.fetchval("UPDATE vision_models SET gate_min_accuracy=$2, gate_min_samples=$3 WHERE id=$1 RETURNING 1",
                             mid, body.min_accuracy, body.min_samples) is None:
            raise HTTPException(404, "model not found")
        await audit.append(tc, f"user:{p.user_id}", "vision.model.gate", {"model_id": str(mid)}, body.model_dump())
    return {"ok": True}


class RollbackIn(BaseModel):
    to_version: str


@router.post(_B + "/models/{model}/versions/{version}/rollback")
async def rollback(org: str, model: str, version: str, body: RollbackIn, request: Request, p=Depends(_user)):
    """Re-pin every camera on `version` to `to_version` (same model, active, same class count)."""
    m = _m()
    org_id = m._v2_org(org, p, m._CONFIG)
    mid, vid, to = m._uuid_or_404(model, "model"), m._uuid_or_404(version, "version"), m._uuid_or_404(body.to_version, "version")
    await m._mutation_gate(request, p.user_id)
    async with tenant_tx(m.st(request).pools.app, org_id, p.user_id) as tc:
        rows = await tc.fetch("SELECT id, status, class_count FROM vision_model_versions WHERE model_id=$1 AND id = ANY($2::uuid[])",
                              mid, [vid, to])
        by = {r["id"]: r for r in rows}
        if vid not in by or to not in by:
            raise HTTPException(404, "version not found")
        if by[to]["status"] != "active" or by[to]["class_count"] != by[vid]["class_count"]:
            raise HTTPException(409, "rollback_target_unusable")
        res = await tc.execute("UPDATE camera_models SET model_version_id=$2 WHERE model_version_id=$1", vid, to)
        await audit.append(tc, f"user:{p.user_id}", "vision.version.rolled_back",
                           {"version_id": str(vid)}, {"to": str(to)})
    return {"ok": True, "cameras": int(res.split()[-1])}
