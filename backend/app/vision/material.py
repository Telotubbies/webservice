"""Material (gravel / sand) decision settings, metrics and decision history.

One decision per truck dump, not per frame: the edge keeps a presence gate
(k-of-n debounce + hysteresis) and sums confidence x mask-area votes per class
over the visit (see edge_bridge/vision/material.py). This module owns the
operator-facing settings (validated here, delivered inside the camera cfg),
the AI-inference metrics history and the decision summary the dashboard reads.

Trust boundary: the settings object comes from the browser, the metrics from
the edge's own vision/stat topic. Both are validated and bounded before they
are stored or sent on.
"""

from __future__ import annotations

import re
from typing import Literal
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel, Field, field_validator, model_validator

from ..db.context import tenant_tx
from ..db.util import iso_z

router = APIRouter()

_TAG = re.compile(r"^[a-z0-9_]+(/[a-z0-9_]+){1,7}$")
RETENTION_DAYS = 7


def _m():
    from .. import main
    return main


async def _user(request: Request):
    return await _m().require_user(request)


class Outputs(BaseModel):
    """PLC tags the decision is written to. Every one is optional; each write
    goes through the edge's normal gate (control switch, AI-write switch,
    offline window, tag range, per-tag rate limit) and is audited."""
    code: str | None = None          # 0 none / 1 gravel / 2 sand (values below)
    margin_pct: str | None = None    # 0..100
    uncertain: str | None = None     # bool
    trigger: str | None = None       # bool, pulsed once per decision
    gravel_value: int = Field(default=1, ge=0, le=65535)
    sand_value: int = Field(default=2, ge=0, le=65535)
    none_value: int = Field(default=0, ge=0, le=65535)
    pulse_ms: int = Field(default=500, ge=50, le=10_000)

    @field_validator("code", "margin_pct", "uncertain", "trigger")
    @classmethod
    def _path(cls, v):
        if v is not None and not _TAG.match(v):
            raise ValueError("tag path must look like area/device/signal")
        return v


class Preprocess(BaseModel):
    clahe: bool = False
    clahe_clip: float = Field(default=2.0, ge=1.0, le=8.0)
    gamma: float = Field(default=1.0, ge=0.4, le=2.5)
    brightness: int = Field(default=0, ge=-60, le=60)
    # normalized [x0, y0, x1, y1]; pixels outside are blacked out before inference
    roi: list[float] | None = None

    @field_validator("roi")
    @classmethod
    def _roi(cls, v):
        if v is None:
            return v
        if len(v) != 4 or not all(0.0 <= x <= 1.0 for x in v) or v[2] - v[0] < 0.05 or v[3] - v[1] < 0.05:
            raise ValueError("roi must be [x0,y0,x1,y1] in 0..1 and at least 5% wide and tall")
        return [round(float(x), 4) for x in v]


class MaterialCfg(BaseModel):
    enabled: bool = True
    # dry-run: decide and log, never write to the PLC (default until the
    # operator has watched the decisions and switched it off)
    dry_run: bool = True
    gravel_class: str = Field(default="gravel", min_length=1, max_length=80)
    sand_class: str = Field(default="sand", min_length=1, max_length=80)
    conf: float = Field(default=0.25, ge=0.05, le=0.95)
    area_min: float = Field(default=0.005, ge=0.0, le=0.5)
    coverage_gate: float = Field(default=0.02, ge=0.001, le=0.9)
    k_enter: int = Field(default=3, ge=1, le=30)
    k_leave: int = Field(default=5, ge=1, le=120)
    min_margin: float = Field(default=0.30, ge=0.0, le=1.0)
    min_frames: int = Field(default=15, ge=1, le=1000)
    max_event_s: int = Field(default=180, ge=10, le=3600)
    rule: Literal["mass_vote", "frame_majority"] = "mass_vote"
    preprocess: Preprocess = Preprocess()
    outputs: Outputs = Outputs()

    @model_validator(mode="after")
    def _distinct(self):
        if self.gravel_class == self.sand_class:
            raise ValueError("gravel_class and sand_class must differ")
        return self


def defaults() -> dict:
    return MaterialCfg().model_dump()


def schema() -> dict:
    """Defaults + ranges for the settings form — one source of truth."""
    js = MaterialCfg.model_json_schema()
    rng = {}
    for k, f in MaterialCfg.model_fields.items():
        meta = {m.__class__.__name__: m for m in f.metadata}
        rng[k] = {"min": getattr(meta.get("Ge"), "ge", None), "max": getattr(meta.get("Le"), "le", None)}
    for k, f in Preprocess.model_fields.items():
        meta = {m.__class__.__name__: m for m in f.metadata}
        rng[f"preprocess.{k}"] = {"min": getattr(meta.get("Ge"), "ge", None), "max": getattr(meta.get("Le"), "le", None)}
    return {"defaults": defaults(), "ranges": rng, "title": js.get("title")}


async def check_output_tags(tc, site_id: UUID, outputs: dict) -> None:
    """Every configured output must be an existing WRITABLE tag of this site."""
    paths = [outputs[k] for k in ("code", "margin_pct", "uncertain", "trigger") if outputs.get(k)]
    if not paths:
        return
    rows = await tc.fetch("SELECT path, writable FROM tags WHERE site_id=$1 AND path = ANY($2::text[])",
                          site_id, paths)
    have = {r["path"]: r["writable"] for r in rows}
    for p in paths:
        if p not in have:
            raise HTTPException(422, f"output tag not found: {p}")
        if not have[p]:
            raise HTTPException(422, f"output tag is read-only: {p}")


# ------------------------------------------------------------------ metrics
def clean_material_stat(v) -> dict | None:
    """The `material` block of one camera's vision/stat entry, bounded."""
    if not isinstance(v, dict):
        return None
    out: dict = {}
    gate = v.get("gate")
    if gate in ("empty", "present"):
        out["gate"] = gate
    for k, lo, hi in (("sand_frac", 0.0, 1.0), ("coverage", 0.0, 1.0)):
        x = v.get(k)
        if isinstance(x, (int, float)) and not isinstance(x, bool) and lo <= x <= hi:
            out[k] = round(float(x), 4)
    for k in ("frames", "decisions"):
        x = v.get(k)
        if isinstance(x, int) and not isinstance(x, bool) and 0 <= x <= 10_000_000:
            out[k] = x
    last = v.get("last")
    if isinstance(last, dict) and last.get("decision") in ("gravel", "sand", "no-material"):
        out["last"] = {"decision": last["decision"],
                       "margin": float(last["margin"]) if isinstance(last.get("margin"), (int, float))
                       and not isinstance(last.get("margin"), bool) and 0 <= last["margin"] <= 1 else None,
                       "uncertain": last.get("uncertain") is True}
    return out or None


_MET = "/api/v1/orgs/{org}/vision/metrics"


@router.get("/api/v1/vision/material-schema")
async def material_schema(request: Request, p=Depends(_user)):
    return schema()


@router.get(_MET)
async def metrics(org: str, request: Request, camera: str | None = None,
                  minutes: int = Query(default=60, ge=5, le=RETENTION_DAYS * 1440),
                  p=Depends(_user)):
    """Per-bucket AI inference series (fps, latency p50/p95, detections) of the org's cameras."""
    m = _m()
    org_id = m._v2_org(org, p, m._READ)
    args: list = [org_id, minutes]
    cam = ""
    if camera is not None:
        args.append(m._uuid_or_404(camera, "camera"))
        cam = " AND camera_id=$3"
    # ~120 buckets whatever the window, so the chart cost is flat
    step = max(10, minutes * 60 // 120)
    sql = (
        "SELECT to_timestamp(floor(extract(epoch FROM ts) / %d) * %d) AS t,"
        " avg(fps) AS fps, avg(latency_ms) AS lat_avg,"
        " percentile_cont(0.5) WITHIN GROUP (ORDER BY latency_ms) AS lat_p50,"
        " percentile_cont(0.95) WITHIN GROUP (ORDER BY latency_ms) AS lat_p95,"
        " sum(infer_n)::bigint AS infer_n, sum(det_n)::bigint AS det_n,"
        " count(*) FILTER (WHERE gate = 'present')::int AS present_n, count(*)::int AS n"
        " FROM vision_metrics WHERE org_id=$1 AND ts > now() - make_interval(mins => $2)%s"
        " GROUP BY 1 ORDER BY 1" % (step, step, cam))
    async with tenant_tx(m.st(request).pools.app, org_id) as tc:
        rows = await tc.fetch(sql, *args)
    f = lambda x: None if x is None else round(float(x), 2)  # noqa: E731
    return {"step_s": step, "items": [
        {"t": iso_z(r["t"]), "fps": f(r["fps"]), "lat_avg": f(r["lat_avg"]), "lat_p50": f(r["lat_p50"]),
         "lat_p95": f(r["lat_p95"]), "infer_n": r["infer_n"], "det_n": r["det_n"],
         "present_n": r["present_n"], "n": r["n"]} for r in rows]}


@router.get("/api/v1/orgs/{org}/vision/material/cameras")
async def cameras(org: str, request: Request, p=Depends(_user)):
    """Every camera of the org with its decision settings and live runtime (relay), for the dashboard."""
    m = _m()
    org_id = m._v2_org(org, p, m._READ)
    async with tenant_tx(m.st(request).pools.app, org_id) as tc:
        rows = await tc.fetch(
            "SELECT c.*, e.name AS edge_name FROM cameras c JOIN edges e ON e.id=c.edge_id ORDER BY c.name")
    from .cameras import camera_json
    relay = m.st(request).relay
    return {"items": [dict(camera_json(r, relay.latest_stat(r["id"])), edge_name=r["edge_name"]) for r in rows]}


@router.get("/api/v1/orgs/{org}/vision/material/summary")
async def summary(org: str, request: Request,
                  minutes: int = Query(default=1440, ge=5, le=RETENTION_DAYS * 1440),
                  p=Depends(_user)):
    """Decision counts, class mix, margin histogram and review outcome for the window."""
    m = _m()
    org_id = m._v2_org(org, p, m._READ)
    async with tenant_tx(m.st(request).pools.app, org_id) as tc:
        rows = await tc.fetch(
            "SELECT e.id, e.camera_id, e.fired_at, e.detail, rv.verdict FROM vision_events e"
            " LEFT JOIN vision_event_reviews rv ON rv.event_id=e.id"
            " WHERE e.org_id=$1 AND e.kind='material' AND e.fired_at > now() - make_interval(mins => $2)"
            " ORDER BY e.fired_at DESC LIMIT 5000", org_id, minutes)
    by = {"gravel": 0, "sand": 0, "no-material": 0}
    mass = {"gravel": 0.0, "sand": 0.0}
    hist = [0] * 10
    unc = wrong = reviewed = 0
    for r in rows:
        d = r["detail"] if isinstance(r["detail"], dict) else {}
        dec = d.get("decision")
        if dec in by:
            by[dec] += 1
        gw, sw = d.get("gravel_w"), d.get("sand_w")
        if isinstance(gw, (int, float)) and isinstance(sw, (int, float)):
            mass["gravel"] += gw
            mass["sand"] += sw
        mg = d.get("margin")
        if isinstance(mg, (int, float)) and 0 <= mg <= 1:
            hist[min(9, int(mg * 10))] += 1
        unc += d.get("uncertain") is True
        if r["verdict"]:
            reviewed += 1
            wrong += r["verdict"] == "wrong"
    return {"total": len(rows), "by_decision": by, "mass": mass, "margin_hist": hist,
            "uncertain": unc, "reviewed": reviewed, "wrong": wrong}
