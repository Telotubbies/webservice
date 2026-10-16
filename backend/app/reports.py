"""Reports (roadmap §9 Phase 5.4): shift / daily / weekly OEE / monthly alarm
reports as CSV bytes + a simple HTML summary, downloadable on demand and
emailed on a schedule.

Scheduling: `report_schedules` rows are due at `send_time` in the ORG's
timezone (weekly_oee on `send_day` 1-7, monthly_alarms on `send_day` 1-28,
shift/daily every day). `report_sweep` — registered by main.py's `_every` —
visits each live org as wds_system inside tenant_tx (same shape as
`_prune_history`), renders due reports and enqueues a `send_email` job:

    {"org_id": ..., "to": [...], "subject": ..., "body": ...,
     "attachments": [{"name", "content_b64", "content_type"}]}

The send_email consumer is owned elsewhere; this module ONLY enqueues.
"""

from __future__ import annotations

import base64
import csv
import html
import io
import logging
from datetime import date, datetime, time as dtime, timedelta
from uuid import UUID
from zoneinfo import ZoneInfo

import asyncpg
from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import Response
from pydantic import BaseModel, Field, field_validator

from . import jobs
from .db import audit
from .db.context import active_org_ids, tenant_tx
from .db.util import iso_z, utcnow
from .oee import _machines, _oee_range, _oee_windows, _site_tz, _tz, current_shift

log = logging.getLogger("wds.reports")

router = APIRouter()

TEMPLATES = ("shift", "daily", "weekly_oee", "monthly_alarms")


def _m():
    from . import main
    return main


async def _user(request: Request):
    return await _m().require_user(request)


# ---------------------------------------------------------------------------
# Pure: report document -> CSV bytes + HTML summary (contract-tested)
# ---------------------------------------------------------------------------
def render_csv(report: dict) -> bytes:
    """Sections stacked: '## title' then header row then data rows.
    utf-8-sig so Excel opens Thai text correctly."""
    buf = io.StringIO()
    w = csv.writer(buf, lineterminator="\r\n")
    w.writerow([report["title"]])
    w.writerow([report["period"]["from"], report["period"]["to"]])
    for sec in report["sections"]:
        w.writerow([])
        w.writerow([f"## {sec['title']}"])
        w.writerow(sec["columns"])
        for row in sec["rows"]:
            w.writerow(row)
    return buf.getvalue().encode("utf-8-sig")


def _cell(v) -> str:
    return html.escape("" if v is None else str(v))


def render_html(report: dict) -> bytes:
    """Minimal printable summary — tables only, neutral colours."""
    parts = [
        "<!doctype html><html><head><meta charset='utf-8'>",
        f"<title>{_cell(report['title'])}</title>",
        "<style>body{font-family:system-ui,sans-serif;color:#222;margin:24px}"
        "h1{font-size:18px}h2{font-size:14px;margin:18px 0 4px}"
        "table{border-collapse:collapse;font-size:12px}"
        "th,td{border:1px solid #ccc;padding:3px 8px;text-align:left}"
        "td.num{text-align:right;font-variant-numeric:tabular-nums}</style></head><body>",
        f"<h1>{_cell(report['title'])}</h1>",
        f"<p>{_cell(report['period']['from'])} – {_cell(report['period']['to'])}</p>",
    ]
    for sec in report["sections"]:
        parts.append(f"<h2>{_cell(sec['title'])}</h2><table><thead><tr>")
        parts += [f"<th>{_cell(c)}</th>" for c in sec["columns"]]
        parts.append("</tr></thead><tbody>")
        for row in sec["rows"]:
            parts.append("<tr>" + "".join(
                f"<td class='num'>{_cell(c)}</td>" if isinstance(c, (int, float))
                else f"<td>{_cell(c)}</td>" for c in row) + "</tr>")
        parts.append("</tbody></table>")
    if not report["sections"]:
        parts.append("<p>No data in this period.</p>")
    parts.append("</body></html>")
    return "".join(parts).encode("utf-8")


def render_text(report: dict) -> str:
    """Plain-text body for the send_email payload."""
    lines = [report["title"],
             f"{report['period']['from']} – {report['period']['to']}", ""]
    for sec in report["sections"]:
        lines.append(sec["title"])
        lines.append("  " + " | ".join(str(c) for c in sec["columns"]))
        for row in sec["rows"]:
            lines.append("  " + " | ".join("" if c is None else str(c) for c in row))
        lines.append("")
    return "\n".join(lines)


def _pct(v) -> float | None:
    return round(v * 100, 2) if isinstance(v, (int, float)) else None


def _oee_section(machines: list[dict]) -> dict:
    return {"title": "OEE per machine",
            "columns": ["Machine", "Line", "Availability %", "Performance %",
                        "Quality %", "OEE %", "Run s", "Planned s", "Units", "Rejects"],
            "rows": [[m["name"], m["line"], _pct(m["availability"]),
                      _pct(m["performance"]), _pct(m["quality"]), _pct(m["oee"]),
                      round(m["run_s"]), round(m["planned_s"]),
                      m["units"], m["rejects"]] for m in machines]}


async def _report_site(tc, site_id: UUID | None) -> UUID:
    """Reports are site-scoped; a NULL site_id means 'the org's first site'
    (single-site orgs are the pilot shape)."""
    if site_id is not None:
        return site_id
    sid = await tc.fetchval("SELECT id FROM sites ORDER BY created_at, name LIMIT 1")
    if sid is None:
        raise HTTPException(422, "org has no site")
    return sid


async def _dt_section(tc, site_id: UUID, t_from: datetime, t_to: datetime) -> dict:
    rows = await tc.fetch(
        "SELECT d.starts_at, d.ends_at, d.state, dev.name AS device, r.name_en AS reason"
        " FROM downtimes d"
        " LEFT JOIN devices dev ON dev.org_id=d.org_id AND dev.id=d.device_id"
        " LEFT JOIN downtime_reasons r ON r.org_id=d.org_id AND r.id=d.reason_id"
        " WHERE d.site_id=$1 AND d.kind='stop' AND d.starts_at >= $2 AND d.starts_at <= $3"
        " ORDER BY d.starts_at", site_id, t_from, t_to)
    return {"title": "Downtime",
            "columns": ["Start", "End", "Minutes", "State", "Machine", "Reason"],
            "rows": [[iso_z(r["starts_at"]),
                      iso_z(r["ends_at"]) if r["ends_at"] else "ongoing",
                      round((((r["ends_at"] or utcnow()) - r["starts_at"]).total_seconds()) / 60, 1),
                      r["state"], r["device"], r["reason"] or "unclassified"] for r in rows]}


async def _oee_report(tc, site_id: UUID, tz, t_from: datetime, t_to: datetime,
                      title: str, shift_id=None) -> dict:
    shifts = await tc.fetch("SELECT * FROM shifts WHERE site_id=$1", site_id)
    shifts = [dict(s) for s in shifts]
    nonwd = {r["day"] for r in await tc.fetch(
        "SELECT day FROM nonworking_days WHERE site_id=$1 AND day >= $2::date AND day <= $3::date",
        site_id, t_from.date(), t_to.date())}
    from .oee import shift_instances
    inst = shift_instances(shifts, nonwd, tz, t_from, t_to, shift_id)
    if not shifts:
        windows, planned = [(t_from, t_to)], (t_to - t_from).total_seconds()
    else:
        windows = [(i["starts_at"], i["ends_at"]) for i in inst]
        planned = sum(i["seconds"] - i["break_s"] for i in inst)
    machines = await _machines(tc, site_id, None, None)
    res = await _oee_range(tc, machines, windows, planned, None)
    t = res["totals"]
    sections = [_oee_section(res["machines"]),
                {"title": "Totals", "columns": ["Availability %", "Performance %",
                                                "Quality %", "OEE %", "Run s",
                                                "Planned s", "Units", "Rejects"],
                 "rows": [[_pct(t["availability"]), _pct(t["performance"]),
                           _pct(t["quality"]), _pct(t["oee"]), round(t["run_s"]),
                           round(t["planned_s"]), t["units"], t["rejects"]]]},
                await _dt_section(tc, site_id, t_from, t_to)]
    return {"title": title,
            "period": {"from": iso_z(t_from), "to": iso_z(t_to)},
            "sections": sections}


async def collect_report(tc, template: str, org_id: UUID, site_id: UUID | None,
                         tz_name: str, now: datetime) -> dict:
    """Build the report document for `template` ending at `now` (org-local
    periods: daily = yesterday, weekly = last 7 days, monthly = last 30,
    shift = the most recently completed shift)."""
    tz = _tz(tz_name)
    site_id = await _report_site(tc, site_id)
    local_today = now.astimezone(tz).date()
    if template == "daily":
        ws = datetime.combine(local_today - timedelta(days=1), dtime(0, 0), tzinfo=tz)
        we = datetime.combine(local_today, dtime(0, 0), tzinfo=tz)
        return await _oee_report(tc, site_id, tz, ws, we,
                                 f"Daily production — {ws.date().isoformat()}")
    if template == "weekly_oee":
        ws = datetime.combine(local_today - timedelta(days=7), dtime(0, 0), tzinfo=tz)
        we = datetime.combine(local_today, dtime(0, 0), tzinfo=tz)
        return await _oee_report(tc, site_id, tz, ws, we,
                                 f"Weekly OEE — {ws.date().isoformat()} to {local_today.isoformat()}")
    if template == "shift":
        shifts = [dict(s) for s in await tc.fetch(
            "SELECT * FROM shifts WHERE site_id=$1", site_id)]
        # most recent COMPLETED shift window; fall back to the current one
        from .oee import shift_instances
        inst = shift_instances(shifts, set(), tz, now - timedelta(days=3), now)
        done = [i for i in inst if i["ends_at"] <= now]
        pick = done[-1] if done else None
        if pick is None:
            cur = current_shift(shifts, now, tz)
            if cur is None:
                raise HTTPException(422, "no shift covers the report period")
            ws, we, title = cur["starts_at"], cur["ends_at"], f"Shift report — {cur['shift']['name']} (in progress)"
        else:
            ws, we, title = pick["starts_at"], pick["ends_at"], f"Shift report — {pick['name']} {ws.astimezone(tz).date().isoformat()}"
        return await _oee_report(tc, site_id, tz, ws, we, title)
    if template == "monthly_alarms":
        ws = now - timedelta(days=30)
        by = await tc.fetch(
            "SELECT severity, state, count(*) AS n FROM alarms"
            " WHERE raised_at >= $1 GROUP BY severity, state ORDER BY severity, state", ws)
        top = await tc.fetch(
            "SELECT r.name, count(*) AS n FROM alarms a"
            " JOIN alarm_rules r ON r.org_id=a.org_id AND r.id=a.rule_id"
            " WHERE a.raised_at >= $1 GROUP BY r.name ORDER BY n DESC, r.name LIMIT 10", ws)
        stats = await tc.fetchrow(
            "SELECT avg(EXTRACT(EPOCH FROM (acked_at - raised_at))) AS ack_s,"
            " avg(EXTRACT(EPOCH FROM (cleared_at - raised_at))) AS clear_s"
            " FROM alarms WHERE raised_at >= $1", ws)
        return {"title": f"Monthly alarm summary — {(now - timedelta(days=30)).date().isoformat()} to {local_today.isoformat()}",
                "period": {"from": iso_z(ws), "to": iso_z(now)},
                "sections": [
                    {"title": "Alarms by severity and state",
                     "columns": ["Severity", "State", "Count"],
                     "rows": [[r["severity"], r["state"], r["n"]] for r in by]},
                    {"title": "Top alarm rules",
                     "columns": ["Rule", "Count"],
                     "rows": [[r["name"], r["n"]] for r in top]},
                    {"title": "Response",
                     "columns": ["Mean time to ack s", "Mean time to clear s"],
                     "rows": [[round(stats["ack_s"], 1) if stats and stats["ack_s"] else None,
                               round(stats["clear_s"], 1) if stats and stats["clear_s"] else None]]},
                ]}
    raise HTTPException(404, "unknown report template")


# ---------------------------------------------------------------------------
# Schedule due computation (pure — unit tested)
# ---------------------------------------------------------------------------
def _send_time(v) -> dtime:
    if isinstance(v, dtime):
        return v
    h, m, *rest = str(v).split(":")
    return dtime(int(h), int(m), int(rest[0]) if rest else 0)


def last_fire(sched: dict, tz, now_utc: datetime) -> datetime | None:
    """The most recent scheduled fire time <= now (checks today and yesterday
    local so a backend restart still catches a due report)."""
    local = now_utc.astimezone(tz)
    send_t = _send_time(sched["send_time"])
    for d in (local.date(), local.date() - timedelta(days=1)):
        tmpl, sd = sched["template"], sched["send_day"]
        if tmpl == "weekly_oee" and d.isoweekday() != (sd or 1):
            continue
        if tmpl == "monthly_alarms" and d.day != (sd or 1):
            continue
        fire = datetime.combine(d, send_t, tzinfo=tz)
        if fire <= now_utc:
            return fire
    return None


def schedule_due(sched: dict, tz, now_utc: datetime) -> bool:
    """Due when the latest fire time is past and hasn't been run yet."""
    fire = last_fire(sched, tz, now_utc)
    if fire is None:
        return False
    last = sched["last_run_at"]
    if last is not None and last.tzinfo is None:
        last = last.replace(tzinfo=ZoneInfo("UTC"))
    return last is None or last < fire


async def run_due_reports(tc, org_id: UUID, tz_name: str, now: datetime) -> int:
    """Render + enqueue every due enabled schedule for one org.
    Runs inside tenant_tx — returns the count enqueued (tests assert it)."""
    tz = _tz(tz_name)
    rows = await tc.fetch("SELECT * FROM report_schedules WHERE enabled ORDER BY id")
    sent = 0
    for r in rows:
        sched = dict(r)
        if not schedule_due(sched, tz, now):
            continue
        rep = await collect_report(tc, sched["template"], org_id,
                                   sched["site_id"], tz_name, now)
        day = now.astimezone(tz).date().isoformat()
        base = f"{sched['template']}-{day}"
        await jobs.enqueue(
            tc, "send_email",
            {"org_id": str(org_id),
             "to": list(sched["to_addrs"] or []),
             "subject": f"{rep['title']}",
             "body": render_text(rep),
             "attachments": [
                 {"name": f"{base}.csv",
                  "content_b64": base64.b64encode(render_csv(rep)).decode(),
                  "content_type": "text/csv"},
                 {"name": f"{base}.html",
                  "content_b64": base64.b64encode(render_html(rep)).decode(),
                  "content_type": "text/html"},
             ]},
            org_id=org_id)
        await tc.execute(
            "UPDATE report_schedules SET last_run_at=now() WHERE id=$1", sched["id"])
        sent += 1
    return sent


async def report_sweep(pools, now: datetime | None = None) -> int:
    """One pass over every live org — the `_every` target registered in
    main.py. Returns scheduled reports enqueued."""
    now = now or utcnow()
    total = 0
    for org_id in await active_org_ids(pools.system):
        try:
            async with tenant_tx(pools.system, org_id) as tc:
                tz = await tc.fetchval(
                    "SELECT timezone FROM organizations WHERE id=$1", org_id)
                total += await run_due_reports(tc, org_id, tz or "UTC", now)
        except Exception:  # noqa: BLE001 — one org must not stop the sweep
            log.exception("report sweep failed", extra={"org_id": str(org_id)})
    return total


# ---------------------------------------------------------------------------
# HTTP surface
# ---------------------------------------------------------------------------
_EMAIL = r"^[^@\s]{1,64}@[^@\s]{1,190}$"


class ScheduleIn(BaseModel):
    template: str
    site_id: UUID | None = None
    to_addrs: list[str] = Field(min_length=1, max_length=20)
    send_time: str = "07:00"
    send_day: int | None = Field(default=None, ge=1, le=31)
    enabled: bool = True

    @field_validator("template")
    @classmethod
    def _tmpl(cls, v: str) -> str:
        if v not in TEMPLATES:
            raise ValueError("template must be one of " + ", ".join(TEMPLATES))
        return v

    @field_validator("to_addrs")
    @classmethod
    def _addrs(cls, v: list[str]) -> list[str]:
        import re as _re
        if any(not _re.match(_EMAIL, a) for a in v):
            raise ValueError("to_addrs must be email addresses")
        return v

    @field_validator("send_time")
    @classmethod
    def _st(cls, v: str) -> str:
        from .oee import _HHMM
        if not _HHMM.match(v):
            raise ValueError("send_time must be HH:MM")
        return v[:5]

    @field_validator("send_day")
    @classmethod
    def _sd(cls, v):
        return v


class SchedulePatch(BaseModel):
    site_id: UUID | None = None
    to_addrs: list[str] | None = Field(default=None, min_length=1, max_length=20)
    send_time: str | None = None
    send_day: int | None = Field(default=None, ge=1, le=31)
    enabled: bool | None = None

    @field_validator("to_addrs")
    @classmethod
    def _addrs(cls, v):
        if v is None:
            return v
        return ScheduleIn._addrs(v)

    @field_validator("send_time")
    @classmethod
    def _st(cls, v):
        return ScheduleIn._st(v) if v is not None else v


def _sched_json(r) -> dict:
    return {"id": str(r["id"]), "site_id": str(r["site_id"]) if r["site_id"] else None,
            "template": r["template"], "to_addrs": list(r["to_addrs"]),
            "send_time": _send_time(r["send_time"]).strftime("%H:%M"),
            "send_day": r["send_day"], "enabled": r["enabled"],
            "last_run_at": iso_z(r["last_run_at"]) if r["last_run_at"] else None,
            "created_at": iso_z(r["created_at"])}


@router.get("/api/v1/orgs/{org}/report-schedules")
async def list_schedules(org: str, request: Request, p=Depends(_user)):
    m = _m()
    org_id = m._v2_org(org, p)
    async with tenant_tx(m.st(request).pools.app, org_id) as tc:
        rows = await tc.fetch("SELECT * FROM report_schedules ORDER BY template, id")
    return {"items": [_sched_json(r) for r in rows], "next_cursor": None}


@router.post("/api/v1/orgs/{org}/report-schedules", status_code=201)
async def create_schedule(org: str, body: ScheduleIn, request: Request, p=Depends(_user)):
    m = _m()
    org_id = m._v2_org(org, p, need=m._CONFIG)
    await m._mutation_gate(request, p.user_id)
    _check_day(body.template, body.send_day)
    async with tenant_tx(m.st(request).pools.app, org_id, p.user_id) as tc:
        if body.site_id is not None:
            await _site_tz(tc, body.site_id)
        try:
            row = await tc.fetchrow(
                "INSERT INTO report_schedules(org_id, site_id, template, to_addrs,"
                " send_time, send_day, enabled, created_by)"
                " VALUES ($1,$2,$3,$4,$5::time,$6,$7,$8) RETURNING *",
                org_id, body.site_id, body.template, body.to_addrs,
                body.send_time, body.send_day, body.enabled, p.user_id)
        except asyncpg.ForeignKeyViolationError:
            raise HTTPException(404, "site not found") from None
        await audit.append(tc, f"user:{p.user_id}", "report_schedule.created",
                           {"schedule_id": str(row["id"])}, {"template": body.template})
    return {"schedule": _sched_json(row)}


def _check_day(template: str, send_day: int | None) -> None:
    if template == "weekly_oee" and not (send_day and 1 <= send_day <= 7):
        raise HTTPException(422, "weekly_oee needs send_day 1..7")
    if template == "monthly_alarms" and not (send_day and 1 <= send_day <= 28):
        raise HTTPException(422, "monthly_alarms needs send_day 1..28")


@router.patch("/api/v1/orgs/{org}/report-schedules/{sched}")
async def patch_schedule(org: str, sched: str, body: SchedulePatch,
                         request: Request, p=Depends(_user)):
    m = _m()
    org_id = m._v2_org(org, p, need=m._CONFIG)
    sid = m._uuid_or_404(sched, "schedule")
    await m._mutation_gate(request, p.user_id)
    ch = body.model_dump(exclude_unset=True)
    if not ch:
        raise HTTPException(422, "nothing to change")
    sets, args = [], []
    for col in ("site_id", "send_time", "send_day", "enabled"):
        if col in ch:
            args.append(ch[col])
            sets.append(f"{col}=${len(args) + 1}")
    if "to_addrs" in ch:
        args.append(ch["to_addrs"])
        sets.append(f"to_addrs=${len(args) + 1}")
    async with tenant_tx(m.st(request).pools.app, org_id, p.user_id) as tc:
        if ch.get("site_id") is not None:
            await _site_tz(tc, ch["site_id"])
        row = await tc.fetchrow(
            f"UPDATE report_schedules SET {', '.join(sets)} WHERE id=$1 RETURNING *",
            sid, *args)
        if row is None:
            raise HTTPException(404, "schedule not found")
        _check_day(row["template"], row["send_day"])
        await audit.append(tc, f"user:{p.user_id}", "report_schedule.updated",
                           {"schedule_id": str(sid)}, {"fields": sorted(ch)})
    return {"schedule": _sched_json(row)}


@router.delete("/api/v1/orgs/{org}/report-schedules/{sched}", status_code=204)
async def delete_schedule(org: str, sched: str, request: Request, p=Depends(_user)):
    m = _m()
    org_id = m._v2_org(org, p, need=m._CONFIG)
    await m._mutation_gate(request, p.user_id)
    async with tenant_tx(m.st(request).pools.app, org_id, p.user_id) as tc:
        gone = await tc.fetchval(
            "DELETE FROM report_schedules WHERE id=$1 RETURNING id",
            m._uuid_or_404(sched, "schedule"))
        if gone is None:
            raise HTTPException(404, "schedule not found")
        await audit.append(tc, f"user:{p.user_id}", "report_schedule.deleted",
                           {"schedule_id": str(gone)}, {})


_CT = {"csv": ("text/csv", "csv"), "html": ("text/html", "html")}


@router.get("/api/v1/orgs/{org}/reports/{template}")
async def download_report(org: str, template: str, request: Request,
                          site: str | None = Query(None),
                          format: str = Query("csv"),
                          p=Depends(_user)):
    """On-demand report download (CSV or HTML summary)."""
    m = _m()
    org_id = m._v2_org(org, p)
    if template not in TEMPLATES:
        raise HTTPException(404, "unknown report template")
    if format not in _CT:
        raise HTTPException(422, "format must be csv or html")
    site_id = m._uuid_or_404(site, "site") if site else None
    async with tenant_tx(m.st(request).pools.app, org_id) as tc:
        if site_id is not None:
            await _site_tz(tc, site_id)
        tz = await tc.fetchval("SELECT timezone FROM organizations WHERE id=$1", org_id)
        rep = await collect_report(tc, template, org_id, site_id, tz or "UTC", utcnow())
    body = render_csv(rep) if format == "csv" else render_html(rep)
    ct, ext = _CT[format]
    day = utcnow().date().isoformat()
    return Response(
        content=body, media_type=ct,
        headers={"Content-Disposition":
                 f'attachment; filename="{template}-{day}.{ext}"'})
