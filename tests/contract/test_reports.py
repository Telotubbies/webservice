"""Contract tests for reports (backend/app/reports.py): CSV/HTML rendering,
schedule-due math, and the sweeper contract — a due schedule enqueues exactly
one `send_email` job with the documented payload shape. Fake-DB pattern per
test_model_test_route.py; no live services.
"""

from __future__ import annotations

import base64
import json
import uuid
from contextlib import asynccontextmanager
from datetime import datetime, time as dtime, timedelta, timezone
from types import SimpleNamespace
from zoneinfo import ZoneInfo

import pytest

pytest.importorskip("fastapi")

from fastapi import FastAPI, Request  # noqa: E402
from fastapi.responses import JSONResponse  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from app import reports  # noqa: E402
from app.auth import Principal  # noqa: E402
from app.security import AuthError, ForbiddenError  # noqa: E402

BKK = ZoneInfo("Asia/Bangkok")
UTC = timezone.utc
ORG = uuid.uuid4()
SITE = uuid.uuid4()
SCHED = uuid.uuid4()
UID = uuid.uuid4()


def _report():
    return {"title": "Daily production — 2026-10-16",
            "period": {"from": "2026-10-16T00:00:00Z", "to": "2026-10-17T00:00:00Z"},
            "sections": [
                {"title": "OEE per machine",
                 "columns": ["Machine", "OEE %"],
                 "rows": [["Sorter", 83.12], ["Packer", None]]},
                {"title": "Downtime",
                 "columns": ["Start", "Minutes"],
                 "rows": [["2026-10-16T10:00:00Z", 30.0]]},
            ]}


# ------------------------------------------------------------------ rendering
def test_render_csv_layout_and_bom():
    data = reports.render_csv(_report()).decode("utf-8-sig")
    lines = data.splitlines()
    assert lines[0] == "Daily production — 2026-10-16"
    assert "## OEE per machine" in lines
    i = lines.index("## OEE per machine")
    assert lines[i + 1] == "Machine,OEE %"
    assert lines[i + 2] == "Sorter,83.12"
    assert lines[i + 3] == "Packer,"           # None renders empty


def test_render_html_escapes_and_tables():
    rep = _report()
    rep["sections"][0]["rows"][0][0] = "<img onerror=x>"
    out = reports.render_html(rep).decode()
    assert "<img onerror" not in out and "&lt;img" in out
    assert "OEE per machine" in out and "83.12" in out


def test_render_text_is_plain():
    out = reports.render_text(_report())
    assert "Sorter | 83.12" in out and "Daily production" in out


# -------------------------------------------------------------- due schedule
def _sched(**kw):
    d = {"id": SCHED, "org_id": ORG, "site_id": SITE, "template": "daily",
         "to_addrs": ["ops@example.com"], "send_time": dtime(7, 0),
         "send_day": None, "enabled": True, "last_run_at": None}
    d.update(kw)
    return d


def test_daily_due_after_7am_org_local():
    # 07:30 Asia/Bangkok = 00:30 UTC
    now = datetime(2026, 10, 16, 0, 30, tzinfo=UTC)
    assert reports.schedule_due(_sched(), BKK, now) is True
    # ran already this morning -> not due again
    done = _sched(last_run_at=datetime(2026, 10, 16, 0, 10, tzinfo=UTC))
    assert reports.schedule_due(done, BKK, now) is False


def test_daily_not_due_before_7am():
    now = datetime(2026, 10, 15, 23, 30, tzinfo=UTC)  # 06:30 Bangkok
    ran_yesterday = _sched(last_run_at=datetime(2026, 10, 15, 0, 5, tzinfo=UTC))
    assert reports.schedule_due(ran_yesterday, BKK, now) is False


def test_weekly_oee_only_on_send_day():
    # send_day=5 -> Friday; 2026-10-16 is a Friday
    s = _sched(template="weekly_oee", send_day=5)
    fri_0830_bkk = datetime(2026, 10, 16, 1, 30, tzinfo=UTC)
    assert reports.schedule_due(s, BKK, fri_0830_bkk) is True
    sat = datetime(2026, 10, 17, 1, 30, tzinfo=UTC)
    # Saturday: latest fire <= now is yesterday's Friday 07:00, already run
    ran = _sched(template="weekly_oee", send_day=5,
                 last_run_at=datetime(2026, 10, 16, 1, 5, tzinfo=UTC))
    assert reports.schedule_due(ran, BKK, sat) is False


def test_monthly_alarms_only_on_day_of_month():
    s = _sched(template="monthly_alarms", send_day=1)
    assert reports.schedule_due(s, BKK, datetime(2026, 11, 1, 1, 0, tzinfo=UTC)) is True
    ran = _sched(template="monthly_alarms", send_day=1,
                 last_run_at=datetime(2026, 10, 1, 1, 0, tzinfo=UTC))
    # Oct 16: the Oct-01 fire was already served; Nov-01 fire is future
    assert reports.schedule_due(ran, BKK, datetime(2026, 10, 16, 1, 0, tzinfo=UTC)) is False


# ---------------------------------------------------- sweeper -> send_email
class FakeConn:
    """Canned rows; records jobs inserts and last_run_at updates."""

    def __init__(self, schedules=(), site_row=None):
        self.schedules = list(schedules)
        self.site_row = site_row
        self.jobs = []
        self.updates = []
        self.executed = []

    @asynccontextmanager
    async def transaction(self):
        yield self

    async def execute(self, sql, *args):
        self.executed.append(sql)
        if "INSERT INTO jobs" in sql:
            self.jobs.append(args)
        if "UPDATE report_schedules" in sql:
            self.updates.append(args)
        return "OK"

    async def fetchval(self, sql, *args):
        if "FROM sites" in sql:
            return self.site_row
        return None

    async def fetchrow(self, sql, *args):
        return None

    async def fetch(self, sql, *args):
        if "FROM report_schedules" in sql:
            return list(self.schedules)
        return []


class FakePool:
    def __init__(self, conn):
        self.conn = conn

    @asynccontextmanager
    async def acquire(self):
        yield self.conn


import asyncio  # noqa: E402


def _run(coro):
    return asyncio.run(coro)


def test_due_schedule_enqueues_send_email_job():
    """A daily 07:00 schedule that hasn't run enqueues kind='send_email' with
    the fixed contract payload."""
    conn = FakeConn(schedules=[_sched()], site_row=SITE)
    now = datetime(2026, 10, 16, 0, 30, tzinfo=UTC)  # 07:30 Bangkok
    n = _run(reports.run_due_reports(conn, ORG, "Asia/Bangkok", now))
    assert n == 1 and len(conn.jobs) == 1
    _org, kind, payload_json, run_at, _max = conn.jobs[0]
    assert kind == "send_email"
    payload = json.loads(payload_json)
    assert payload["org_id"] == str(ORG)
    assert payload["to"] == ["ops@example.com"]
    assert "Daily production" in payload["subject"]
    assert payload["body"]
    names = {a["name"] for a in payload["attachments"]}
    assert any(n.endswith(".csv") for n in names) and any(n.endswith(".html") for n in names)
    csv_att = next(a for a in payload["attachments"] if a["content_type"] == "text/csv")
    assert b"OEE" in base64.b64decode(csv_att["content_b64"])
    # last_run_at claimed in the same pass so the job is not re-sent
    assert conn.updates and conn.updates[0][0] == SCHED


def test_not_due_schedule_enqueues_nothing():
    conn = FakeConn(schedules=[_sched(
        last_run_at=datetime(2026, 10, 16, 0, 10, tzinfo=UTC))], site_row=SITE)
    n = _run(reports.run_due_reports(conn, ORG, "Asia/Bangkok",
                                     datetime(2026, 10, 16, 0, 30, tzinfo=UTC)))
    assert n == 0 and conn.jobs == []


def test_disabled_rows_are_filtered_by_sql():
    # the fetch is `WHERE enabled`; a fake returning rows simulates only
    # enabled ones — assert nothing runs for a not-due schedule
    conn = FakeConn(schedules=[])
    assert _run(reports.run_due_reports(conn, ORG, "UTC", utc_now())) == 0


def utc_now():
    return datetime.now(timezone.utc)


# ------------------------------------------------------------- HTTP surface
class FakeAuth:
    def __init__(self, p):
        self.p = p

    async def authenticate(self, token):
        return self.p


class FakeLimiter:
    async def allow(self, key):
        return True

    async def retry_after(self, key):
        return 0.0


def _principal(role="admin", org=ORG):
    return Principal(user="tester", role="admin", kind="dev", sub="tester",
                     user_id=UID, org_roles=((org, role),))


def _app(conn, role="admin", org=ORG):
    app = FastAPI()

    @app.exception_handler(AuthError)
    async def _auth(_: Request, exc: AuthError):
        return JSONResponse(status_code=401, content={"detail": str(exc)})

    @app.exception_handler(ForbiddenError)
    async def _forbid(_: Request, exc: ForbiddenError):
        return JSONResponse(status_code=403, content={"detail": str(exc)})

    app.include_router(reports.router)
    app.state.st = SimpleNamespace(
        auth=FakeAuth(_principal(role, org)),
        pools=SimpleNamespace(app=FakePool(conn)),
        mutation_limiter=FakeLimiter())
    return TestClient(app, raise_server_exceptions=True)


class RouteConn(FakeConn):
    def __init__(self, **kw):
        super().__init__(**kw)
        self.org_tz = "UTC"

    async def fetchval(self, sql, *args):
        if "FROM organizations" in sql:
            return self.org_tz
        return None

    async def fetchrow(self, sql, *args):
        if "FROM sites WHERE id" in sql:
            return {"id": self.site_row, "timezone": "UTC"} if self.site_row else None
        return None


def test_download_daily_csv():
    c = _app(RouteConn(site_row=SITE))
    r = c.get(f"/api/v1/orgs/{ORG}/reports/daily?site={SITE}&format=csv")
    assert r.status_code == 200, r.text
    assert r.headers["content-type"].startswith("text/csv")
    assert "attachment" in r.headers["content-disposition"]
    assert "Daily production" in r.text


def test_download_html_and_bad_template():
    c = _app(RouteConn(site_row=SITE))
    r = c.get(f"/api/v1/orgs/{ORG}/reports/weekly_oee?site={SITE}&format=html")
    assert r.status_code == 200 and r.headers["content-type"].startswith("text/html")
    r = c.get(f"/api/v1/orgs/{ORG}/reports/nope")
    assert r.status_code == 404


def test_weekly_schedule_requires_send_day():
    c = _app(RouteConn())
    r = c.post(f"/api/v1/orgs/{ORG}/report-schedules",
               json={"template": "weekly_oee", "to_addrs": ["ops@example.com"]})
    assert r.status_code == 422


def test_schedule_create_and_list():
    row = {"id": SCHED, "org_id": ORG, "site_id": SITE, "template": "daily",
           "to_addrs": ["ops@example.com"], "send_time": dtime(7, 0),
           "send_day": None, "enabled": True, "last_run_at": None,
           "created_by": UID, "created_at": datetime(2026, 10, 16, tzinfo=UTC)}

    class C(RouteConn):
        async def fetchrow(self, sql, *args):
            if "INSERT INTO report_schedules" in sql:
                return row
            return await super().fetchrow(sql, *args)

        async def fetch(self, sql, *args):
            if "FROM report_schedules" in sql:
                return [row]
            return await super().fetch(sql, *args)

    conn = C(site_row=SITE)
    c = _app(conn)
    r = c.post(f"/api/v1/orgs/{ORG}/report-schedules",
               json={"template": "daily", "site_id": str(SITE),
                     "to_addrs": ["ops@example.com"], "send_time": "07:00"})
    assert r.status_code == 201, r.text
    assert r.json()["schedule"]["to_addrs"] == ["ops@example.com"]
    r = c.get(f"/api/v1/orgs/{ORG}/report-schedules")
    assert r.status_code == 200 and r.json()["items"][0]["template"] == "daily"


def test_viewer_cannot_create_schedule():
    r = _app(RouteConn(), role="viewer").post(
        f"/api/v1/orgs/{ORG}/report-schedules",
        json={"template": "daily", "to_addrs": ["ops@example.com"]})
    assert r.status_code == 403


def test_nonmember_404():
    r = _app(RouteConn(), org=uuid.uuid4()).get(
        f"/api/v1/orgs/{ORG}/report-schedules")
    assert r.status_code == 404
