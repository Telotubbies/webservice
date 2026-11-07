"""Closed shift / hour totals (F18). Reuses the OEE helpers (no second formula).

A period is closed one hour after it ends, so late samples can still arrive. If the
total later changes, a NEW version row is written and a new event is enqueued with
`supersedes`; a closed version is never updated (the table grants no UPDATE).
"""

from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone

from ..db.context import active_org_ids, tenant_tx
from ..db.util import iso_z, utcnow
from ..production import oee
from . import outbox

log = logging.getLogger("wds.integration.summary")
SETTLE = timedelta(hours=1)
LOOKBACK = timedelta(days=3)
EPS_UNITS = 0.5               # a total that moves by less than this is the same total


def totals(item: dict, seconds: float) -> dict:
    s = item["state_s"]
    stop = s.get("stopped", 0.0) + s.get("fault", 0.0)
    return {"qty_total": item["units"], "qty_scrap": item["rejects"], "qty_good": item["units"] - item["rejects"],
            "run_s": round(item["run_s"]), "stop_s": round(stop),
            "coverage_pct": round(100.0 * (1 - s.get("unknown", 0.0) / seconds), 1) if seconds > 0 else 0.0}


def changed(old, new: dict) -> bool:
    return (old is None or abs(float(old["qty_total"] or 0) - new["qty_total"]) >= EPS_UNITS
            or abs(float(old["qty_scrap"] or 0) - new["qty_scrap"]) >= EPS_UNITS
            or abs((old["run_s"] or 0) - new["run_s"]) >= 60)


async def _close_one(tc, kind: str, site, m: dict, start: datetime, end: datetime, planned_s: float,
                     label: dict, origin: str) -> int:
    res = await oee._oee_range(tc, [m], [(start, end)], planned_s, None)
    item = res["machines"][0]
    new = totals(item, (end - start).total_seconds())
    if kind == "shift":
        key = (m["device_id"], label["name"], label["date"])
        old = await tc.fetchrow(
            "SELECT * FROM shift_summary WHERE device_id=$1 AND shift_name=$2 AND shift_date=$3"
            " ORDER BY version DESC LIMIT 1", *key)
    else:
        key = (m["device_id"], start)
        old = await tc.fetchrow("SELECT * FROM hour_summary WHERE device_id=$1 AND hour_start=$2"
                                " ORDER BY version DESC LIMIT 1", *key)
    if not changed(old, new):
        return 0
    version = (old["version"] + 1) if old else 1
    if kind == "shift":
        await tc.execute(
            "INSERT INTO shift_summary(org_id, site_id, device_id, shift_name, shift_date, from_ts, to_ts, version,"
            " qty_total, qty_good, qty_scrap, run_s, stop_s, coverage_pct, data_origin)"
            " VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)",
            tc.org_id, site["id"], m["device_id"], label["name"], label["date"], start, end, version,
            new["qty_total"], new["qty_good"], new["qty_scrap"], new["run_s"], new["stop_s"], new["coverage_pct"], origin)
        nat = f"{site['id']}:{m['device_id']}:{label['date']}:{label['name']}"
        data = {"machine": {"local_id": str(m["device_id"]), "name": m["device_name"]}, "work_order": None,
                "shift": {"name": label["name"], "from": iso_z(start), "to": iso_z(end), "tz": site["timezone"]}}
    else:
        await tc.execute(
            "INSERT INTO hour_summary(org_id, site_id, device_id, hour_start, version,"
            " qty_total, qty_good, qty_scrap, run_s, stop_s, coverage_pct, data_origin)"
            " VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)",
            tc.org_id, site["id"], m["device_id"], start, version,
            new["qty_total"], new["qty_good"], new["qty_scrap"], new["run_s"], new["stop_s"], new["coverage_pct"], origin)
        nat = f"{site['id']}:{m['device_id']}:{iso_z(start)}"
        data = {"machine": {"local_id": str(m["device_id"]), "name": m["device_name"]}, "hour": iso_z(start)}
    payload = {"site": str(site["id"]), "data": {**data, **new, "data_quality": {
        "coverage_pct": new["coverage_pct"], "origin": origin}}}
    if old:
        payload["supersedes"] = outbox.idem_key(tc.org_id, f"{kind}_summary.closed", nat, old["version"])
    await outbox.enqueue(tc, tc.org_id, f"{kind}_summary.closed", nat, version, payload, site_origin=origin)
    return 1


async def close_periods(pools, now: datetime | None = None) -> int:
    """One pass over every live org. Returns summary rows written."""
    now = now or utcnow()
    horizon = now - SETTLE
    wrote = 0
    for org_id in await active_org_ids(pools.system):
        try:
            async with tenant_tx(pools.system, org_id) as tc:
                for site in await tc.fetch("SELECT id, timezone, data_origin FROM sites"):
                    tz = oee._tz(site["timezone"] or "UTC")
                    machines = await oee._machines(tc, site["id"], None, None)
                    if not machines:
                        continue
                    shifts = await oee._shifts(tc, site["id"])
                    t_from = horizon - LOOKBACK
                    nonwd = await oee._nonworking(tc, site["id"], t_from, horizon)
                    insts = [i for i in oee.shift_instances(shifts, nonwd, tz, t_from, horizon)
                             if i["starts_at"] > t_from]       # skip the one clipped by the look-back edge
                    for i in insts:
                        label = {"name": i["name"], "date": i["starts_at"].astimezone(tz).date()}
                        for m in machines:
                            wrote += await _close_one(tc, "shift", site, m, i["starts_at"], i["ends_at"],
                                                      i["seconds"] - i["break_s"], label, site["data_origin"])
                    h = horizon.replace(minute=0, second=0, microsecond=0)
                    for k in range(1, 7):
                        a = h - timedelta(hours=k)
                        for m in machines:
                            wrote += await _close_one(tc, "hour", site, m, a, a + timedelta(hours=1), 3600.0,
                                                      {}, site["data_origin"])
        except Exception:  # noqa: BLE001 - one org must not stop the sweep
            log.exception("summary close failed", extra={"org_id": str(org_id)})
    return wrote
