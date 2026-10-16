"""Production KPIs (roadmap §9 Phase 5.1–5.3): shifts + working calendar,
machine state mapping, downtime auto-records + operator classification, and
OEE (availability / performance / quality) from tag_history.

Layout: pure functions on plain rows first (contract-tested with synthetic
data, no DB), then the thin SQL/HTTP layer on the v2 org/site routes, then
the `downtime_sweep` that main.py schedules with `_every` (wds_system inside
tenant_tx per org, like `_prune_history`).

Machines are `devices` rows (sites → lines → devices → tags). A machine's
`machine_state_map` row names the state tag plus the raw→state mapping, the
production counter tag and the reject counter tag.
"""

from __future__ import annotations

import logging
import re
from datetime import date, datetime, time as dtime, timedelta, timezone
from uuid import UUID
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

import asyncpg
from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel, Field, field_validator

from .db import audit
from .db.context import active_org_ids, tenant_tx
from .db.util import iso_z, parse_ts, utcnow

log = logging.getLogger("wds.oee")

router = APIRouter()

STATES = ("running", "idle", "stopped", "fault")
STOP_STATES = ("stopped", "fault")
RUN_STATES = ("running", "idle")

_HHMM = re.compile(r"^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$")


def _m():
    from . import main
    return main


async def _user(request: Request):
    return await _m().require_user(request)


def _tz(name: str | None) -> ZoneInfo:
    try:
        return ZoneInfo(name or "UTC")
    except (ZoneInfoNotFoundError, ValueError, OSError):
        return ZoneInfo("UTC")


# ---------------------------------------------------------------------------
# Pure functions — no DB, contract-tested against hand calculations.
# ---------------------------------------------------------------------------
def to_time(v) -> dtime:
    """Accept datetime.time (asyncpg) or 'HH:MM[:SS]' strings."""
    if isinstance(v, dtime):
        return v
    if isinstance(v, str) and _HHMM.match(v):
        parts = [int(x) for x in v.split(":")]
        return dtime(parts[0], parts[1], parts[2] if len(parts) > 2 else 0)
    raise ValueError(f"bad time value {v!r}")


def shift_window(shift: dict, day: date, tz) -> tuple[datetime, datetime]:
    """Absolute [start, end) of the shift instance that STARTS on `day`.
    end_time <= start_time means the window crosses midnight."""
    st = datetime.combine(day, to_time(shift["start_time"]), tzinfo=tz)
    en = datetime.combine(
        day + timedelta(days=1) if to_time(shift["end_time"]) <= to_time(shift["start_time"]) else day,
        to_time(shift["end_time"]), tzinfo=tz)
    return st, en


def current_shift(shifts: list[dict], now_utc: datetime, tz) -> dict | None:
    """The enabled shift covering `now_utc`, plus its absolute window.
    Overnight shifts belong to the weekday they START on."""
    local = now_utc.astimezone(tz)
    for s in shifts:
        if not s.get("enabled", True):
            continue
        days = set(s.get("days_of_week") or [])
        for d in (local.date(), local.date() - timedelta(days=1)):
            if d.isoweekday() not in days:
                continue
            st, en = shift_window(s, d, tz)
            if st <= now_utc < en:
                return {"shift": s, "starts_at": st, "ends_at": en}
    return None


def _break_window(br: dict, day: date, tz) -> tuple[datetime, datetime] | None:
    try:
        bs, be = to_time(br.get("start")), to_time(br.get("end"))
    except (ValueError, AttributeError, TypeError):
        return None
    st = datetime.combine(day, bs, tzinfo=tz)
    en = datetime.combine(day + timedelta(days=1) if be <= bs else day, be, tzinfo=tz)
    return st, en


def _break_cuts(shift: dict, a: datetime, b: datetime, day: date,
                tz) -> list[tuple[datetime, datetime]]:
    """Break intervals clipped to [a, b), sorted and merged. Each break is
    anchored on the shift's start `day` AND the day after, so breaks past
    midnight of an overnight shift land inside its actual span instead of
    being clipped away."""
    cuts: list[tuple[datetime, datetime]] = []
    for br in shift.get("breaks") or []:
        for d in (day, day + timedelta(days=1)):
            w = _break_window(br, d, tz)
            if w is None:
                continue
            lo, hi = max(w[0], a), min(w[1], b)
            if hi > lo:
                cuts.append((lo, hi))
    cuts.sort()
    merged: list[tuple[datetime, datetime]] = []
    for lo, hi in cuts:
        if merged and lo <= merged[-1][1]:
            if hi > merged[-1][1]:
                merged[-1] = (merged[-1][0], hi)
        else:
            merged.append((lo, hi))
    return merged


def break_seconds(shift: dict, a: datetime, b: datetime, day: date, tz) -> float:
    """Seconds of the shift's breaks inside absolute window [a, b); the shift
    instance started on local `day`."""
    return sum((hi - lo).total_seconds() for lo, hi in _break_cuts(shift, a, b, day, tz))


def _net_windows(a: datetime, b: datetime, cuts) -> list[tuple[datetime, datetime]]:
    """[a, b) minus the break cuts — the spans where production is expected.
    Measuring run time over these keeps availability <= 1 when a machine
    stays 'running' through a scheduled break."""
    out: list[tuple[datetime, datetime]] = []
    cur = a
    for cs, ce in cuts:
        if cs > cur:
            out.append((cur, cs))
        cur = max(cur, ce)
    if cur < b:
        out.append((cur, b))
    return out


def shift_instances(shifts: list[dict], nonworking: set[date], tz,
                    t_from: datetime, t_to: datetime,
                    only_shift_id=None) -> list[dict]:
    """Enabled shift windows intersecting [t_from, t_to), clipped to it, with
    breaks subtracted. Days in `nonworking` are skipped entirely."""
    out: list[dict] = []
    only = str(only_shift_id) if only_shift_id else None
    day = t_from.astimezone(tz).date() - timedelta(days=1)
    last = t_to.astimezone(tz).date()
    while day <= last:
        wd = day.isoweekday()
        for s in shifts:
            if not s.get("enabled", True):
                continue
            if only and str(s["id"]) != only:
                continue
            if wd not in set(s.get("days_of_week") or []):
                continue
            if day in nonworking:
                continue
            st, en = shift_window(s, day, tz)
            a, b = max(st, t_from), min(en, t_to)
            if b <= a:
                continue
            brk = break_seconds(s, a, b, day, tz)
            out.append({"shift_id": str(s["id"]), "name": s["name"],
                        "starts_at": a, "ends_at": b,
                        "seconds": (b - a).total_seconds(), "break_s": brk})
        day += timedelta(days=1)
    return out


def map_state(v, states_map: dict) -> str:
    """Raw tag value -> running|idle|stopped|fault, else 'unknown'.
    Tolerates int-vs-string mismatches from JSONB (1 vs "1", true vs "true")."""
    for name in STATES:
        for item in (states_map or {}).get(name) or []:
            if v == item or str(v).lower() == str(item).lower():
                return name
    return "unknown"


def state_intervals(samples, states_map: dict,
                    t_from: datetime, t_to: datetime) -> list[tuple[str, datetime, datetime]]:
    """Piecewise-constant state over [t_from, t_to). `samples` = [(ts, v)]
    ascending; a sample BEFORE t_from carries its state into the window, the
    unmeasured head of the window reports 'unknown'."""
    seq = sorted(samples, key=lambda s: s[0])
    i, carry = 0, None
    while i < len(seq) and seq[i][0] < t_from:
        carry, i = seq[i], i + 1
    prev_state = map_state(carry[1], states_map) if carry else "unknown"
    prev_start = t_from
    out: list[tuple[str, datetime, datetime]] = []
    for ts, v in seq[i:]:
        if ts >= t_to:
            break
        st = map_state(v, states_map)
        if st != prev_state:
            if ts > prev_start:
                out.append((prev_state, prev_start, ts))
            prev_state, prev_start = st, ts
    if t_to > prev_start:
        out.append((prev_state, prev_start, t_to))
    return out


def state_durations(samples, states_map, t_from: datetime, t_to: datetime) -> dict:
    out = {s: 0.0 for s in STATES}
    out["unknown"] = 0.0
    for st, a, b in state_intervals(samples, states_map, t_from, t_to):
        out[st] += (b - a).total_seconds()
    return out


def durations_in_windows(samples, states_map, windows: list[tuple[datetime, datetime]]) -> dict:
    """State seconds inside the union of windows only (shift-filtered OEE)."""
    out = {s: 0.0 for s in STATES}
    out["unknown"] = 0.0
    for ws, we in windows:
        for st, a, b in state_intervals(samples, states_map, ws, we):
            out[st] += (b - a).total_seconds()
    return out


def counter_delta(first, last) -> float:
    """Units produced = counter last − first inside the window; a reset
    (last < first) counts only what ran after it."""
    try:
        f, l = float(first), float(last)
    except (TypeError, ValueError):
        return 0.0
    return max(0.0, l - f) if l >= f else max(0.0, l)


def compute_oee(*, run_s: float, planned_s: float, units: float,
                rejects: float, ideal_cycle_s: float | None) -> dict:
    """availability = run/planned · performance = ideal_cycle*units/run ·
    quality = (units−rejects)/units. None where a factor has no basis."""
    a = run_s / planned_s if planned_s > 0 else None
    p = (ideal_cycle_s * units) / run_s if run_s > 0 and ideal_cycle_s else None
    q = (units - rejects) / units if units > 0 else None
    oee = a * p * q if None not in (a, p, q) else None
    return {"availability": a, "performance": p, "quality": q, "oee": oee,
            "run_s": run_s, "planned_s": planned_s,
            "units": units, "rejects": rejects, "ideal_cycle_s": ideal_cycle_s}


def pareto(rows: list[dict]) -> list[dict]:
    """Rank downtime buckets by total seconds desc with cumulative share."""
    total = sum(r["seconds"] for r in rows)
    out = sorted(rows, key=lambda r: -r["seconds"])
    cum = 0.0
    for r in out:
        cum += r["seconds"]
        r["pct"] = (r["seconds"] / total) if total > 0 else None
        r["cum_pct"] = (cum / total) if total > 0 else None
    return out


def sweep_decision(samples, states_map: dict, open_start: datetime | None,
                   threshold_s: float, now: datetime) -> dict:
    """Downtime auto-record decision for one machine (roadmap 5.2).

    samples = [(ts, v)] ascending over the look-back window; `open_start` is
    the starts_at of the device's open downtime row if one exists.
    Returns {"action": "open"|"close"|"none", ...}."""
    seq = sorted(samples, key=lambda s: s[0])
    if not seq:
        return {"action": "none"}
    last_state = map_state(seq[-1][1], states_map)
    if last_state in STOP_STATES:
        # walk back to where the contiguous stop run began
        j = len(seq) - 1
        while j - 1 >= 0 and map_state(seq[j - 1][1], states_map) in STOP_STATES:
            j -= 1
        start = seq[j][0]
        if open_start is None and (now - start).total_seconds() >= threshold_s:
            return {"action": "open", "starts_at": start, "state": last_state}
        return {"action": "none"}
    if last_state in RUN_STATES and open_start is not None:
        # first running/idle sample after the recorded stop start = resume time
        end = seq[-1][0]
        for ts, v in seq:
            if ts > open_start and map_state(v, states_map) in RUN_STATES:
                end = ts
                break
        return {"action": "close", "ends_at": end}
    return {"action": "none"}  # unknown state: never open or close on it


# ---------------------------------------------------------------------------
# Wire shapes
# ---------------------------------------------------------------------------
def _shift_json(r) -> dict:
    return {"id": str(r["id"]), "site_id": str(r["site_id"]), "name": r["name"],
            "start_time": r["start_time"].strftime("%H:%M"), "end_time": r["end_time"].strftime("%H:%M"),
            "days_of_week": list(r["days_of_week"]), "breaks": r["breaks"],
            "enabled": r["enabled"]}


def _machine_json(r) -> dict:
    return {"device_id": str(r["id"]), "name": r["name"],
            "line_id": str(r["line_id"]), "line": r["line_name"],
            "configured": r["map_id"] is not None}


def _reason_json(r) -> dict:
    return {"id": str(r["id"]), "parent_id": str(r["parent_id"]) if r["parent_id"] else None,
            "code": r["code"], "name_en": r["name_en"], "name_th": r["name_th"],
            "sort": r["sort"], "enabled": r["enabled"]}


def _dt_event_json(r) -> dict:
    dur = ((r["ends_at"] or utcnow()) - r["starts_at"]).total_seconds()
    return {"id": str(r["id"]), "device_id": str(r["device_id"]),
            "device": r["device_name"], "state": r["state"],
            "starts_at": iso_z(r["starts_at"]),
            "ends_at": iso_z(r["ends_at"]) if r["ends_at"] else None,
            "seconds": round(dur), "needs_reason": r["needs_reason"],
            "reason_id": str(r["reason_id"]) if r["reason_id"] else None,
            "reason": r["reason_en"] or r["reason_code"],
            "note": r["note"],
            "classified_at": iso_z(r["classified_at"]) if r["classified_at"] else None}


class ShiftIn(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    start_time: str
    end_time: str
    days_of_week: list[int] = Field(default_factory=list, max_length=7)
    breaks: list[dict] = Field(default_factory=list, max_length=16)
    enabled: bool = True

    @field_validator("start_time", "end_time")
    @classmethod
    def _t(cls, v: str) -> str:
        if not _HHMM.match(v):
            raise ValueError("HH:MM required")
        return v

    @field_validator("days_of_week")
    @classmethod
    def _dow(cls, v: list[int]) -> list[int]:
        if any(d < 1 or d > 7 for d in v):
            raise ValueError("days_of_week are ISO 1..7")
        return sorted(set(v))

    @field_validator("breaks")
    @classmethod
    def _brk(cls, v: list[dict]) -> list[dict]:
        out = []
        for b in v:
            s, e = str(b.get("start", "")), str(b.get("end", ""))
            if not _HHMM.match(s) or not _HHMM.match(e):
                raise ValueError("break start/end must be HH:MM")
            out.append({"start": s[:5], "end": e[:5],
                        "name": str(b.get("name", ""))[:80]})
        return out


class NonworkingIn(BaseModel):
    day: date
    reason: str = Field(default="", max_length=200)


class StateMapIn(BaseModel):
    state_tag_id: UUID
    count_tag_id: UUID | None = None
    reject_tag_id: UUID | None = None
    states: dict = Field(default_factory=dict)
    stop_threshold_s: int = Field(default=300, ge=30, le=86400)

    @field_validator("states")
    @classmethod
    def _states(cls, v: dict) -> dict:
        out = {}
        for k, vals in (v or {}).items():
            if k not in STATES:
                raise ValueError(f"unknown state {k!r}")
            if not isinstance(vals, list) or len(vals) > 32:
                raise ValueError("state values must be a list of <=32")
            out[k] = vals[:32]
        return out


class ProductIn(BaseModel):
    product: str = Field(min_length=1, max_length=80)
    ideal_cycle_s: float = Field(gt=0, le=86400)
    active: bool = True


class ReasonIn(BaseModel):
    code: str = Field(min_length=1, max_length=40, pattern=r"^[a-z0-9][a-z0-9_-]*$")
    name_en: str = Field(min_length=1, max_length=120)
    name_th: str = Field(min_length=1, max_length=120)
    parent_id: UUID | None = None
    sort: int = 0
    enabled: bool = True


class ReasonPatch(BaseModel):
    name_en: str | None = Field(default=None, min_length=1, max_length=120)
    name_th: str | None = Field(default=None, min_length=1, max_length=120)
    parent_id: UUID | None = None
    sort: int | None = None
    enabled: bool | None = None


class ClassifyIn(BaseModel):
    reason_id: UUID | None = None
    note: str | None = Field(default=None, max_length=500)


# ---------------------------------------------------------------------------
# DB helpers (thin)
# ---------------------------------------------------------------------------
async def _site_tz(tc, site_id: UUID):
    """Site must live in the tx org (RLS) — returns (timezone-name, row)."""
    row = await tc.fetchrow("SELECT id, timezone FROM sites WHERE id=$1", site_id)
    if row is None:
        raise HTTPException(404, "site not found")
    return row["timezone"] or "UTC"


async def _shifts(tc, site_id: UUID) -> list[dict]:
    rows = await tc.fetch(
        "SELECT * FROM shifts WHERE site_id=$1 ORDER BY start_time, name", site_id)
    return [dict(r) for r in rows]


async def _nonworking(tc, site_id: UUID, t_from: datetime, t_to: datetime) -> set[date]:
    rows = await tc.fetch(
        "SELECT day FROM nonworking_days WHERE site_id=$1 AND day >= $2::date AND day <= $3::date",
        site_id, t_from.date(), t_to.date())
    return {r["day"] for r in rows}


async def _machines(tc, site_id: UUID, device: UUID | None, line: UUID | None) -> list[dict]:
    rows = await tc.fetch(
        "SELECT m.*, d.name AS device_name, d.line_id, l.name AS line_name"
        " FROM machine_state_map m"
        " JOIN devices d ON d.org_id=m.org_id AND d.id=m.device_id"
        " JOIN lines l ON l.org_id=d.org_id AND l.id=d.line_id"
        " WHERE m.site_id=$1 AND ($2::uuid IS NULL OR m.device_id=$2)"
        " AND ($3::uuid IS NULL OR d.line_id=$3)"
        " ORDER BY d.name", site_id, device, line)
    return [dict(r) for r in rows]


async def _state_samples(tc, tag_id: UUID,
                         windows: list[tuple[datetime, datetime]]) -> list[tuple[datetime, object]]:
    """History rows inside every window plus the carry-in sample before each."""
    out: list[tuple[datetime, object]] = []
    for ws, we in windows:
        pre = await tc.fetchrow(
            "SELECT ts, v FROM tag_history WHERE tag_id=$1 AND ts < $2"
            " ORDER BY ts DESC LIMIT 1", tag_id, ws)
        if pre:
            out.append((pre["ts"], pre["v"]))
        rows = await tc.fetch(
            "SELECT ts, v FROM tag_history WHERE tag_id=$1 AND ts >= $2 AND ts <= $3"
            " ORDER BY ts", tag_id, ws, we)
        out.extend((r["ts"], r["v"]) for r in rows)
    return out


async def _counter_sum(tc, tag_id: UUID | None,
                       windows: list[tuple[datetime, datetime]]) -> float:
    """Sum of positive counter deltas over each window."""
    if tag_id is None:
        return 0.0
    total = 0.0
    for ws, we in windows:
        first = await tc.fetchrow(
            "SELECT v FROM tag_history WHERE tag_id=$1 AND ts >= $2 AND ts <= $3"
            " ORDER BY ts ASC LIMIT 1", tag_id, ws, we)
        last = await tc.fetchrow(
            "SELECT v FROM tag_history WHERE tag_id=$1 AND ts >= $2 AND ts <= $3"
            " ORDER BY ts DESC LIMIT 1", tag_id, ws, we)
        if first and last:
            total += counter_delta(first["v"], last["v"])
    return total


async def _ideal_cycle(tc, device_id: UUID, product: str | None) -> float | None:
    return await tc.fetchval(
        "SELECT ideal_cycle_s FROM machine_products WHERE device_id=$1 AND active"
        " AND ($2::text IS NULL OR product=$2) ORDER BY product LIMIT 1",
        device_id, product)


async def _oee_range(tc, machines: list[dict], windows: list[tuple[datetime, datetime]],
                     planned_s: float, product: str | None) -> dict:
    """Per-machine OEE + org totals over `windows`. `planned_s` is the same
    for every machine (per-site planned time)."""
    items = []
    for m in machines:
        samples = await _state_samples(tc, m["state_tag_id"], windows)
        durs = durations_in_windows(samples, m["states"], windows)
        units = await _counter_sum(tc, m["count_tag_id"], windows)
        rejects = await _counter_sum(tc, m["reject_tag_id"], windows)
        ideal = await _ideal_cycle(tc, m["device_id"], product)
        r = compute_oee(run_s=durs["running"], planned_s=planned_s,
                        units=units, rejects=rejects, ideal_cycle_s=ideal)
        items.append({"device_id": str(m["device_id"]), "name": m["device_name"],
                      "line_id": str(m["line_id"]), "line": m["line_name"],
                      "state_s": durs, **r})
    tot = compute_oee(
        run_s=sum(i["run_s"] for i in items),
        planned_s=planned_s * len(items),
        units=sum(i["units"] for i in items),
        rejects=sum(i["rejects"] for i in items),
        ideal_cycle_s=None)
    # aggregate performance needs Σideal*units / Σrun — recompute honestly
    run_tot = tot["run_s"]
    num = sum((i["ideal_cycle_s"] or 0) * i["units"] for i in items)
    tot["performance"] = num / run_tot if run_tot > 0 and num > 0 else None
    tot["oee"] = (tot["availability"] or 0) * (tot["performance"] or 0) * (tot["quality"] or 0) \
        if None not in (tot["availability"], tot["performance"], tot["quality"]) else None
    return {"machines": items, "totals": tot}


# ---------------------------------------------------------------------------
# Shifts + calendar
# ---------------------------------------------------------------------------
@router.get("/api/v1/orgs/{org}/sites/{site}/shifts")
async def list_shifts(org: str, site: str, request: Request, p=Depends(_user)):
    m = _m()
    org_id, site_id = m._v2_scope(org, site, p)
    async with tenant_tx(m.st(request).pools.app, org_id) as tc:
        await _site_tz(tc, site_id)
        rows = await tc.fetch("SELECT * FROM shifts WHERE site_id=$1 ORDER BY start_time, name", site_id)
    return {"items": [_shift_json(r) for r in rows], "next_cursor": None}


@router.post("/api/v1/orgs/{org}/sites/{site}/shifts", status_code=201)
async def create_shift(org: str, site: str, body: ShiftIn, request: Request, p=Depends(_user)):
    m = _m()
    org_id, site_id = m._v2_scope(org, site, p, need=m._CONFIG)
    await m._mutation_gate(request, p.user_id)
    if body.start_time == body.end_time:
        raise HTTPException(422, "start_time and end_time must differ")
    async with tenant_tx(m.st(request).pools.app, org_id, p.user_id) as tc:
        await _site_tz(tc, site_id)
        try:
            row = await tc.fetchrow(
                "INSERT INTO shifts(org_id, site_id, name, start_time, end_time,"
                " days_of_week, breaks, enabled) VALUES ($1,$2,$3,$4::time,$5::time,$6,$7,$8)"
                " RETURNING *",
                org_id, site_id, body.name, body.start_time, body.end_time,
                body.days_of_week, body.breaks, body.enabled)
        except asyncpg.UniqueViolationError:
            raise HTTPException(409, "shift_name_exists") from None
        await audit.append(tc, f"user:{p.user_id}", "shift.created",
                           {"shift_id": str(row["id"])}, {"name": body.name})
    return {"shift": _shift_json(row)}


@router.patch("/api/v1/orgs/{org}/sites/{site}/shifts/{shift}")
async def patch_shift(org: str, site: str, shift: str, body: ShiftIn,
                      request: Request, p=Depends(_user)):
    m = _m()
    org_id, site_id = m._v2_scope(org, site, p, need=m._CONFIG)
    sid = m._uuid_or_404(shift, "shift")
    await m._mutation_gate(request, p.user_id)
    if body.start_time == body.end_time:
        raise HTTPException(422, "start_time and end_time must differ")
    async with tenant_tx(m.st(request).pools.app, org_id, p.user_id) as tc:
        try:
            row = await tc.fetchrow(
                "UPDATE shifts SET name=$2, start_time=$3::time, end_time=$4::time,"
                " days_of_week=$5, breaks=$6, enabled=$7 WHERE id=$1 AND site_id=$8"
                " RETURNING *",
                sid, body.name, body.start_time, body.end_time,
                body.days_of_week, body.breaks, body.enabled, site_id)
        except asyncpg.UniqueViolationError:
            raise HTTPException(409, "shift_name_exists") from None
        if row is None:
            raise HTTPException(404, "shift not found")
        await audit.append(tc, f"user:{p.user_id}", "shift.updated",
                           {"shift_id": str(sid)}, {"name": body.name})
    return {"shift": _shift_json(row)}


@router.delete("/api/v1/orgs/{org}/sites/{site}/shifts/{shift}", status_code=204)
async def delete_shift(org: str, site: str, shift: str, request: Request, p=Depends(_user)):
    m = _m()
    org_id, site_id = m._v2_scope(org, site, p, need=m._CONFIG)
    await m._mutation_gate(request, p.user_id)
    async with tenant_tx(m.st(request).pools.app, org_id, p.user_id) as tc:
        gone = await tc.fetchval(
            "DELETE FROM shifts WHERE id=$1 AND site_id=$2 RETURNING id",
            m._uuid_or_404(shift, "shift"), site_id)
        if gone is None:
            raise HTTPException(404, "shift not found")
        await audit.append(tc, f"user:{p.user_id}", "shift.deleted", {"shift_id": str(gone)}, {})


@router.get("/api/v1/orgs/{org}/sites/{site}/shifts/current")
async def shift_now(org: str, site: str, request: Request, p=Depends(_user)):
    """Current shift for the top bar (roadmap 5.1 acceptance)."""
    m = _m()
    org_id, site_id = m._v2_scope(org, site, p)
    async with tenant_tx(m.st(request).pools.app, org_id) as tc:
        tz_name = await _site_tz(tc, site_id)
        shifts = await _shifts(tc, site_id)
    cur = current_shift(shifts, utcnow(), _tz(tz_name))
    if cur is None:
        return {"shift": None, "timezone": tz_name}
    s = cur["shift"]
    return {"timezone": tz_name,
            "shift": {"id": str(s["id"]), "name": s["name"],
                      "start_time": s["start_time"].strftime("%H:%M"),
                      "end_time": s["end_time"].strftime("%H:%M")},
            "starts_at": iso_z(cur["starts_at"]), "ends_at": iso_z(cur["ends_at"])}


@router.get("/api/v1/orgs/{org}/sites/{site}/nonworking-days")
async def list_nonworking(org: str, site: str, request: Request,
                          p=Depends(_user)):
    m = _m()
    org_id, site_id = m._v2_scope(org, site, p)
    async with tenant_tx(m.st(request).pools.app, org_id) as tc:
        await _site_tz(tc, site_id)
        rows = await tc.fetch(
            "SELECT day, reason FROM nonworking_days WHERE site_id=$1 ORDER BY day",
            site_id)
    return {"items": [{"day": r["day"].isoformat(), "reason": r["reason"]} for r in rows],
            "next_cursor": None}


@router.post("/api/v1/orgs/{org}/sites/{site}/nonworking-days", status_code=201)
async def add_nonworking(org: str, site: str, body: NonworkingIn,
                         request: Request, p=Depends(_user)):
    m = _m()
    org_id, site_id = m._v2_scope(org, site, p, need=m._CONFIG)
    await m._mutation_gate(request, p.user_id)
    async with tenant_tx(m.st(request).pools.app, org_id, p.user_id) as tc:
        await _site_tz(tc, site_id)
        await tc.execute(
            "INSERT INTO nonworking_days(org_id, site_id, day, reason) VALUES ($1,$2,$3,$4)"
            " ON CONFLICT (site_id, day) DO UPDATE SET reason=excluded.reason",
            org_id, site_id, body.day, body.reason)
        await audit.append(tc, f"user:{p.user_id}", "calendar.nonworking",
                           {"site_id": str(site_id), "day": body.day.isoformat()},
                           {"reason": body.reason})
    return {"day": body.day.isoformat(), "reason": body.reason}


@router.delete("/api/v1/orgs/{org}/sites/{site}/nonworking-days/{day}", status_code=204)
async def del_nonworking(org: str, site: str, day: str, request: Request, p=Depends(_user)):
    m = _m()
    org_id, site_id = m._v2_scope(org, site, p, need=m._CONFIG)
    try:
        d = date.fromisoformat(day)
    except ValueError:
        raise HTTPException(404, "day not found") from None
    await m._mutation_gate(request, p.user_id)
    async with tenant_tx(m.st(request).pools.app, org_id, p.user_id) as tc:
        gone = await tc.fetchval(
            "DELETE FROM nonworking_days WHERE site_id=$1 AND day=$2 RETURNING day",
            site_id, d)
        if gone is None:
            raise HTTPException(404, "day not found")
        await audit.append(tc, f"user:{p.user_id}", "calendar.working",
                           {"site_id": str(site_id), "day": d.isoformat()}, {})


# ---------------------------------------------------------------------------
# Machines: state map, products, timeline
# ---------------------------------------------------------------------------
@router.get("/api/v1/orgs/{org}/sites/{site}/machines")
async def list_machines(org: str, site: str, request: Request, p=Depends(_user)):
    m = _m()
    org_id, site_id = m._v2_scope(org, site, p)
    async with tenant_tx(m.st(request).pools.app, org_id) as tc:
        await _site_tz(tc, site_id)
        rows = await tc.fetch(
            "SELECT d.id, d.name, d.line_id, l.name AS line_name, mm.id AS map_id"
            " FROM devices d JOIN lines l ON l.org_id=d.org_id AND l.id=d.line_id"
            " LEFT JOIN machine_state_map mm ON mm.org_id=d.org_id AND mm.device_id=d.id"
            " WHERE l.site_id=$1 ORDER BY l.name, d.name", site_id)
        tags = await tc.fetch(
            "SELECT id, path, name, type FROM tags WHERE site_id=$1 ORDER BY path", site_id)
    return {"items": [_machine_json(r) for r in rows],
            "tags": [{"id": str(t["id"]), "path": t["path"], "name": t["name"],
                      "type": t["type"]} for t in tags],
            "next_cursor": None}


@router.get("/api/v1/orgs/{org}/sites/{site}/machines/{device}/state-map")
async def get_state_map(org: str, site: str, device: str, request: Request, p=Depends(_user)):
    m = _m()
    org_id, site_id = m._v2_scope(org, site, p)
    dev = m._uuid_or_404(device, "machine")
    async with tenant_tx(m.st(request).pools.app, org_id) as tc:
        r = await tc.fetchrow(
            "SELECT * FROM machine_state_map WHERE device_id=$1 AND site_id=$2", dev, site_id)
        if r is None:
            raise HTTPException(404, "state map not found")
    return {"map": _map_json(r)}


def _map_json(r) -> dict:
    return {"device_id": str(r["device_id"]),
            "state_tag_id": str(r["state_tag_id"]),
            "count_tag_id": str(r["count_tag_id"]) if r["count_tag_id"] else None,
            "reject_tag_id": str(r["reject_tag_id"]) if r["reject_tag_id"] else None,
            "states": r["states"], "stop_threshold_s": r["stop_threshold_s"],
            "updated_at": iso_z(r["updated_at"])}


@router.put("/api/v1/orgs/{org}/sites/{site}/machines/{device}/state-map")
async def put_state_map(org: str, site: str, device: str, body: StateMapIn,
                        request: Request, p=Depends(_user)):
    m = _m()
    org_id, site_id = m._v2_scope(org, site, p, need=m._CONFIG)
    dev = m._uuid_or_404(device, "machine")
    await m._mutation_gate(request, p.user_id)
    async with tenant_tx(m.st(request).pools.app, org_id, p.user_id) as tc:
        await _site_tz(tc, site_id)
        ok = await tc.fetchval(
            "SELECT 1 FROM devices d JOIN lines l ON l.org_id=d.org_id AND l.id=d.line_id"
            " WHERE d.id=$1 AND l.site_id=$2", dev, site_id)
        if not ok:
            raise HTTPException(404, "machine not found")
        tag_ids = [t for t in (body.state_tag_id, body.count_tag_id, body.reject_tag_id) if t]
        found = await tc.fetch(
            "SELECT id FROM tags WHERE site_id=$1 AND id = ANY($2::uuid[])",
            site_id, tag_ids)
        if len({r["id"] for r in found}) != len(set(tag_ids)):
            raise HTTPException(422, "tag_id must name a tag of this site")
        row = await tc.fetchrow(
            "INSERT INTO machine_state_map(org_id, site_id, device_id, state_tag_id,"
            " count_tag_id, reject_tag_id, states, stop_threshold_s)"
            " VALUES ($1,$2,$3,$4,$5,$6,$7,$8)"
            " ON CONFLICT (org_id, device_id) DO UPDATE SET site_id=excluded.site_id,"
            " state_tag_id=excluded.state_tag_id, count_tag_id=excluded.count_tag_id,"
            " reject_tag_id=excluded.reject_tag_id, states=excluded.states,"
            " stop_threshold_s=excluded.stop_threshold_s, updated_at=now() RETURNING *",
            org_id, site_id, dev, body.state_tag_id, body.count_tag_id,
            body.reject_tag_id, body.states, body.stop_threshold_s)
        await audit.append(tc, f"user:{p.user_id}", "machine.state_map",
                           {"device_id": str(dev)}, {"states": sorted(body.states)})
    return {"map": _map_json(row)}


@router.get("/api/v1/orgs/{org}/sites/{site}/machines/{device}/timeline")
async def machine_timeline(org: str, site: str, device: str, request: Request,
                           from_: str = Query(..., alias="from"),
                           to: str = Query(...),
                           p=Depends(_user)):
    """Machine state timeline built from the state tag's history (5.2)."""
    m = _m()
    org_id, site_id = m._v2_scope(org, site, p)
    dev = m._uuid_or_404(device, "machine")
    try:
        t_from, t_to = parse_ts(from_), parse_ts(to)
    except ValueError:
        raise HTTPException(400, "invalid_request") from None
    if t_to <= t_from or (t_to - t_from) > timedelta(days=31):
        raise HTTPException(400, "invalid_range")
    async with tenant_tx(m.st(request).pools.app, org_id) as tc:
        mp = await tc.fetchrow(
            "SELECT * FROM machine_state_map WHERE device_id=$1 AND site_id=$2", dev, site_id)
        if mp is None:
            raise HTTPException(404, "state map not found")
        samples = await _state_samples(tc, mp["state_tag_id"], [(t_from, t_to)])
    iv = [{"state": s, "from": iso_z(a), "to": iso_z(b),
           "seconds": round((b - a).total_seconds())}
          for s, a, b in state_intervals(samples, mp["states"], t_from, t_to)]
    return {"items": iv, "next_cursor": None}


@router.get("/api/v1/orgs/{org}/sites/{site}/machines/{device}/products")
async def list_products(org: str, site: str, device: str, request: Request, p=Depends(_user)):
    m = _m()
    org_id, site_id = m._v2_scope(org, site, p)
    dev = m._uuid_or_404(device, "machine")
    async with tenant_tx(m.st(request).pools.app, org_id) as tc:
        rows = await tc.fetch(
            "SELECT id, product, ideal_cycle_s, active FROM machine_products"
            " WHERE device_id=$1 ORDER BY product", dev)
    return {"items": [{"id": str(r["id"]), "product": r["product"],
                       "ideal_cycle_s": r["ideal_cycle_s"], "active": r["active"]}
                      for r in rows], "next_cursor": None}


@router.put("/api/v1/orgs/{org}/sites/{site}/machines/{device}/products", status_code=201)
async def upsert_product(org: str, site: str, device: str, body: ProductIn,
                         request: Request, p=Depends(_user)):
    m = _m()
    org_id, site_id = m._v2_scope(org, site, p, need=m._CONFIG)
    dev = m._uuid_or_404(device, "machine")
    await m._mutation_gate(request, p.user_id)
    async with tenant_tx(m.st(request).pools.app, org_id, p.user_id) as tc:
        try:
            row = await tc.fetchrow(
                "INSERT INTO machine_products(org_id, device_id, product, ideal_cycle_s, active)"
                " VALUES ($1,$2,$3,$4,$5)"
                " ON CONFLICT (org_id, device_id, product) DO UPDATE SET"
                " ideal_cycle_s=excluded.ideal_cycle_s, active=excluded.active,"
                " updated_at=now() RETURNING id",
                org_id, dev, body.product, body.ideal_cycle_s, body.active)
        except asyncpg.ForeignKeyViolationError:
            raise HTTPException(404, "machine not found") from None
        await audit.append(tc, f"user:{p.user_id}", "machine.product",
                           {"device_id": str(dev)},
                           {"product": body.product, "ideal_cycle_s": body.ideal_cycle_s})
    return {"id": str(row["id"]), "product": body.product,
            "ideal_cycle_s": body.ideal_cycle_s, "active": body.active}


@router.delete("/api/v1/orgs/{org}/sites/{site}/machines/{device}/products/{prod}", status_code=204)
async def delete_product(org: str, site: str, device: str, prod: str,
                         request: Request, p=Depends(_user)):
    m = _m()
    org_id, site_id = m._v2_scope(org, site, p, need=m._CONFIG)
    dev, pid = m._uuid_or_404(device, "machine"), m._uuid_or_404(prod, "product")
    await m._mutation_gate(request, p.user_id)
    async with tenant_tx(m.st(request).pools.app, org_id, p.user_id) as tc:
        gone = await tc.fetchval(
            "DELETE FROM machine_products WHERE id=$1 AND device_id=$2 RETURNING id", pid, dev)
        if gone is None:
            raise HTTPException(404, "product not found")
        await audit.append(tc, f"user:{p.user_id}", "machine.product_deleted",
                           {"device_id": str(dev), "product_id": str(pid)}, {})


# ---------------------------------------------------------------------------
# Downtime reason tree (org-level) + stop classification (site-level)
# ---------------------------------------------------------------------------
@router.get("/api/v1/orgs/{org}/downtime-reasons")
async def list_reasons(org: str, request: Request, p=Depends(_user)):
    m = _m()
    org_id = m._v2_org(org, p)
    async with tenant_tx(m.st(request).pools.app, org_id) as tc:
        rows = await tc.fetch(
            "SELECT * FROM downtime_reasons ORDER BY sort, lower(code)")
    return {"items": [_reason_json(r) for r in rows], "next_cursor": None}


@router.post("/api/v1/orgs/{org}/downtime-reasons", status_code=201)
async def create_reason(org: str, body: ReasonIn, request: Request, p=Depends(_user)):
    m = _m()
    org_id = m._v2_org(org, p, need=m._CONFIG)
    await m._mutation_gate(request, p.user_id)
    async with tenant_tx(m.st(request).pools.app, org_id, p.user_id) as tc:
        try:
            row = await tc.fetchrow(
                "INSERT INTO downtime_reasons(org_id, parent_id, code, name_th, name_en, sort, enabled)"
                " VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *",
                org_id, body.parent_id, body.code, body.name_th, body.name_en,
                body.sort, body.enabled)
        except asyncpg.UniqueViolationError:
            raise HTTPException(409, "reason_code_exists") from None
        except asyncpg.ForeignKeyViolationError:
            raise HTTPException(404, "parent reason not found") from None
        await audit.append(tc, f"user:{p.user_id}", "reason.created",
                           {"reason_id": str(row["id"])}, {"code": body.code})
    return {"reason": _reason_json(row)}


@router.patch("/api/v1/orgs/{org}/downtime-reasons/{reason}")
async def patch_reason(org: str, reason: str, body: ReasonPatch, request: Request,
                       p=Depends(_user)):
    m = _m()
    org_id = m._v2_org(org, p, need=m._CONFIG)
    rid = m._uuid_or_404(reason, "reason")
    await m._mutation_gate(request, p.user_id)
    ch = body.model_dump(exclude_unset=True)
    if not ch:
        raise HTTPException(422, "nothing to change")
    if ch.get("parent_id") == rid:
        raise HTTPException(422, "a reason cannot be its own parent")
    sets, args = [], []
    for col in ("name_en", "name_th", "parent_id", "sort", "enabled"):
        if col in ch:
            args.append(ch[col])
            sets.append(f"{col}=${len(args) + 1}")
    async with tenant_tx(m.st(request).pools.app, org_id, p.user_id) as tc:
        try:
            row = await tc.fetchrow(
                f"UPDATE downtime_reasons SET {', '.join(sets)} WHERE id=$1 RETURNING *",
                rid, *args)
        except asyncpg.ForeignKeyViolationError:
            raise HTTPException(404, "parent reason not found") from None
        if row is None:
            raise HTTPException(404, "reason not found")
        await audit.append(tc, f"user:{p.user_id}", "reason.updated",
                           {"reason_id": str(rid)}, {"fields": sorted(ch)})
    return {"reason": _reason_json(row)}


@router.delete("/api/v1/orgs/{org}/downtime-reasons/{reason}", status_code=204)
async def delete_reason(org: str, reason: str, request: Request, p=Depends(_user)):
    m = _m()
    org_id = m._v2_org(org, p, need=m._CONFIG)
    await m._mutation_gate(request, p.user_id)
    async with tenant_tx(m.st(request).pools.app, org_id, p.user_id) as tc:
        gone = await tc.fetchval(
            "DELETE FROM downtime_reasons WHERE id=$1 RETURNING id",
            m._uuid_or_404(reason, "reason"))
        if gone is None:
            raise HTTPException(404, "reason not found")
        await audit.append(tc, f"user:{p.user_id}", "reason.deleted", {"reason_id": str(gone)}, {})


_DT_EV = (
    "SELECT d.id, d.device_id, dev.name AS device_name, d.state, d.starts_at, d.ends_at,"
    " d.needs_reason, d.reason_id, r.code AS reason_code, r.name_en AS reason_en,"
    " d.note, d.classified_at"
    " FROM downtimes d"
    " LEFT JOIN devices dev ON dev.org_id=d.org_id AND dev.id=d.device_id"
    " LEFT JOIN downtime_reasons r ON r.org_id=d.org_id AND r.id=d.reason_id")


@router.get("/api/v1/orgs/{org}/sites/{site}/downtime-events")
async def list_dt_events(org: str, site: str, request: Request,
                         needs_reason: bool | None = Query(None),
                         from_: str | None = Query(None, alias="from"),
                         to: str | None = Query(None),
                         p=Depends(_user)):
    """Auto-recorded machine stops (kind='stop'), newest first. The phone
    classify screen polls this with needs_reason=true."""
    m = _m()
    org_id, site_id = m._v2_scope(org, site, p)
    try:
        t_from = parse_ts(from_) if from_ else None
        t_to = parse_ts(to) if to else None
    except ValueError:
        raise HTTPException(400, "invalid_request") from None
    async with tenant_tx(m.st(request).pools.app, org_id) as tc:
        await _site_tz(tc, site_id)
        rows = await tc.fetch(
            _DT_EV + " WHERE d.site_id=$1 AND d.kind='stop'"
            " AND ($2::bool IS NULL OR d.needs_reason=$2)"
            " AND ($3::timestamptz IS NULL OR d.starts_at >= $3)"
            " AND ($4::timestamptz IS NULL OR d.starts_at <= $4)"
            " ORDER BY d.starts_at DESC LIMIT 300",
            site_id, needs_reason, t_from, t_to)
    return {"items": [_dt_event_json(r) for r in rows], "next_cursor": None}


@router.post("/api/v1/orgs/{org}/sites/{site}/downtime-events/{dt}/classify")
async def classify_dt(org: str, site: str, dt: str, body: ClassifyIn,
                      request: Request, p=Depends(_user)):
    """Operator classifies a stop: reason code from the org tree + free note.
    Works from the phone (single POST, idempotent for the same reason)."""
    m = _m()
    org_id, site_id = m._v2_scope(org, site, p, need=m._OPERATE)
    dtid = m._uuid_or_404(dt, "downtime")
    await m._mutation_gate(request, p.user_id)
    async with tenant_tx(m.st(request).pools.app, org_id, p.user_id) as tc:
        if body.reason_id is not None:
            ok = await tc.fetchval(
                "SELECT 1 FROM downtime_reasons WHERE id=$1", body.reason_id)
            if not ok:
                raise HTTPException(404, "reason not found")
        try:
            row = await tc.fetchrow(
                "UPDATE downtimes SET reason_id=$2, note=COALESCE($3, note),"
                " classified_by=$4, classified_at=now(), needs_reason=false"
                " WHERE id=$1 AND site_id=$5 AND kind='stop' RETURNING id",
                dtid, body.reason_id, body.note, p.user_id, site_id)
        except asyncpg.ForeignKeyViolationError:
            raise HTTPException(404, "reason not found") from None
        if row is None:
            raise HTTPException(404, "downtime not found")
        await audit.append(tc, f"user:{p.user_id}", "downtime.classified",
                           {"downtime_id": str(dtid)},
                           {"reason_id": str(body.reason_id) if body.reason_id else None})
        full = await tc.fetchrow(_DT_EV + " WHERE d.id=$1", dtid)
    return {"downtime": _dt_event_json(full)}


# ---------------------------------------------------------------------------
# OEE
# ---------------------------------------------------------------------------
def _range(from_: str | None, to: str | None, default_days: int = 1):
    try:
        t_to = parse_ts(to) if to else utcnow()
        t_from = parse_ts(from_) if from_ else t_to - timedelta(days=default_days)
    except ValueError:
        raise HTTPException(400, "invalid_request") from None
    if t_to <= t_from or (t_to - t_from) > timedelta(days=93):
        raise HTTPException(400, "invalid_range")
    return t_from, t_to


async def _oee_windows(tc, site_id, tz, t_from, t_to, shift_id):
    """Effective measurement windows + per-machine planned seconds.
    No enabled shifts → the site runs continuously (planned = range)."""
    shifts = await _shifts(tc, site_id)
    nonwd = await _nonworking(tc, site_id, t_from, t_to)
    inst = shift_instances(shifts, nonwd, tz, t_from, t_to, shift_id)
    if not shifts:
        return [(t_from, t_to)], (t_to - t_from).total_seconds(), inst
    windows = [(i["starts_at"], i["ends_at"]) for i in inst]
    planned = sum(i["seconds"] - i["break_s"] for i in inst)
    return windows, planned, inst


@router.get("/api/v1/orgs/{org}/sites/{site}/oee")
async def get_oee(org: str, site: str, request: Request,
                  device: str | None = Query(None),
                  line: str | None = Query(None),
                  shift: str | None = Query(None),
                  product: str | None = Query(None),
                  from_: str | None = Query(None, alias="from"),
                  to: str | None = Query(None),
                  p=Depends(_user)):
    """A/P/Q per machine + totals, grouped by shift/range via query params."""
    m = _m()
    org_id, site_id = m._v2_scope(org, site, p)
    t_from, t_to = _range(from_, to)
    dev = m._uuid_or_404(device, "machine") if device else None
    ln = m._uuid_or_404(line, "line") if line else None
    sh = m._uuid_or_404(shift, "shift") if shift else None
    async with tenant_tx(m.st(request).pools.app, org_id) as tc:
        tz_name = await _site_tz(tc, site_id)
        tz = _tz(tz_name)
        machines = await _machines(tc, site_id, dev, ln)
        windows, planned_s, inst = await _oee_windows(tc, site_id, tz, t_from, t_to, sh)
        out = await _oee_range(tc, machines, windows, planned_s, product)
    out.update({"from": iso_z(t_from), "to": iso_z(t_to), "timezone": tz_name,
                "shift_windows": len(inst)})
    return out


@router.get("/api/v1/orgs/{org}/sites/{site}/oee/pareto")
async def oee_pareto(org: str, site: str, request: Request,
                     device: str | None = Query(None),
                     from_: str | None = Query(None, alias="from"),
                     to: str | None = Query(None),
                     p=Depends(_user)):
    """Pareto of downtime reasons over the range (unclassified grouped)."""
    m = _m()
    org_id, site_id = m._v2_scope(org, site, p)
    t_from, t_to = _range(from_, to, default_days=7)
    dev = m._uuid_or_404(device, "machine") if device else None
    async with tenant_tx(m.st(request).pools.app, org_id) as tc:
        await _site_tz(tc, site_id)
        rows = await tc.fetch(
            "SELECT d.reason_id, r.code, r.name_en, r.name_th,"
            " count(*) AS n, sum(EXTRACT(EPOCH FROM (COALESCE(d.ends_at, now()) - d.starts_at))) AS secs"
            " FROM downtimes d LEFT JOIN downtime_reasons r"
            "  ON r.org_id=d.org_id AND r.id=d.reason_id"
            " WHERE d.site_id=$1 AND d.kind='stop' AND d.starts_at >= $2 AND d.starts_at <= $3"
            " AND ($4::uuid IS NULL OR d.device_id=$4)"
            " GROUP BY d.reason_id, r.code, r.name_en, r.name_th",
            site_id, t_from, t_to, dev)
    items = pareto([{"reason_id": str(r["reason_id"]) if r["reason_id"] else None,
                     "code": r["code"], "name_en": r["name_en"], "name_th": r["name_th"],
                     "count": r["n"], "seconds": round(float(r["secs"] or 0))}
                    for r in rows])
    return {"items": items, "from": iso_z(t_from), "to": iso_z(t_to), "next_cursor": None}


@router.get("/api/v1/orgs/{org}/sites/{site}/oee/trend")
async def oee_trend(org: str, site: str, request: Request,
                  device: str | None = Query(None),
                  line: str | None = Query(None),
                  weeks: int = Query(8, ge=1, le=13),
                  p=Depends(_user)):
    """Weekly OEE buckets (ISO weeks in the site timezone)."""
    m = _m()
    org_id, site_id = m._v2_scope(org, site, p)
    dev = m._uuid_or_404(device, "machine") if device else None
    ln = m._uuid_or_404(line, "line") if line else None
    async with tenant_tx(m.st(request).pools.app, org_id) as tc:
        tz_name = await _site_tz(tc, site_id)
        tz = _tz(tz_name)
        machines = await _machines(tc, site_id, dev, ln)
        shifts = await _shifts(tc, site_id)
        now = utcnow()
        local_today = now.astimezone(tz).date()
        this_monday = local_today - timedelta(days=local_today.isoweekday() - 1)
        items = []
        for w in range(weeks - 1, -1, -1):
            ws_local = this_monday - timedelta(weeks=w)
            ws = datetime.combine(ws_local, dtime(0, 0), tzinfo=tz)
            we = min(datetime.combine(ws_local + timedelta(days=7), dtime(0, 0), tzinfo=tz), now)
            if we <= ws:
                continue
            nonwd = await _nonworking(tc, site_id, ws, we)
            inst = shift_instances(shifts, nonwd, tz, ws, we)
            if not shifts:
                windows, planned = [(ws, we)], (we - ws).total_seconds()
            else:
                windows = [(i["starts_at"], i["ends_at"]) for i in inst]
                planned = sum(i["seconds"] - i["break_s"] for i in inst)
            res = await _oee_range(tc, machines, windows, planned, None)
            t = res["totals"]
            items.append({"week": ws_local.isoformat(),
                          "availability": t["availability"], "performance": t["performance"],
                          "quality": t["quality"], "oee": t["oee"],
                          "run_s": t["run_s"], "planned_s": t["planned_s"],
                          "units": t["units"], "rejects": t["rejects"]})
    return {"items": items, "timezone": tz_name, "next_cursor": None}


# ---------------------------------------------------------------------------
# Downtime auto-record sweep — scheduled by main.py via _every (wds_system,
# one tenant_tx per org like _prune_history). Opens a kind='stop' row when a
# mapped machine has been in stopped|fault for >= its stop_threshold_s, and
# closes the open row when the machine runs again.
# ---------------------------------------------------------------------------
async def _sweep_machine(tc, mp: dict, now: datetime) -> None:
    open_dt = await tc.fetchrow(
        "SELECT id, starts_at FROM downtimes"
        " WHERE kind='stop' AND device_id=$1 AND ends_at IS NULL", mp["device_id"])
    horizon = now - timedelta(seconds=max(4 * mp["stop_threshold_s"], 3600))
    rows = await tc.fetch(
        "SELECT ts, v FROM tag_history WHERE tag_id=$1 AND ts >= $2 ORDER BY ts",
        mp["state_tag_id"], horizon)
    act = sweep_decision(
        [(r["ts"], r["v"]) for r in rows], mp["states"],
        open_dt["starts_at"] if open_dt else None, mp["stop_threshold_s"], now)
    if act["action"] == "open":
        await tc.execute(
            "INSERT INTO downtimes(org_id, kind, site_id, device_id, state,"
            " starts_at, ends_at, needs_reason, created_by, description)"
            " VALUES ($1,'stop',$2,$3,$4,$5,NULL,true,NULL,'')",
            tc.org_id, mp["site_id"], mp["device_id"], act["state"], act["starts_at"])
    elif act["action"] == "close" and open_dt is not None:
        await tc.execute(
            "UPDATE downtimes SET ends_at=$2 WHERE id=$1", open_dt["id"], act["ends_at"])


async def downtime_sweep(pools, now: datetime | None = None) -> int:
    """One pass over every live org. Returns rows touched (for tests/logs)."""
    now = now or utcnow()
    touched = 0
    for org_id in await active_org_ids(pools.system):
        try:
            async with tenant_tx(pools.system, org_id) as tc:
                maps = await tc.fetch(
                    "SELECT id, site_id, device_id, state_tag_id, states, stop_threshold_s"
                    " FROM machine_state_map")
                for mp in maps:
                    await _sweep_machine(tc, dict(mp))
                    touched += 1
        except Exception:  # noqa: BLE001 — one org must not stop the sweep
            log.exception("downtime sweep failed", extra={"org_id": str(org_id)})
    return touched
