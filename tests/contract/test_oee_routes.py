"""HTTP contract for the Phase-5 OEE/downtime routes (backend/app/production/oee.py).

Real router + real _v2_org permission check; the DB is a fake connection
keyed by the SQL the routes actually issue (same pattern as
test_model_test_route.py). The OEE numbers asserted here are the same hand
calculation as test_oee.py — the SQL layer must not distort them.
"""

from __future__ import annotations

import sys
import uuid
from contextlib import asynccontextmanager
from datetime import date, datetime, time as dtime, timedelta, timezone
from types import SimpleNamespace

import pytest

pytest.importorskip("fastapi")

from fastapi import FastAPI, Request  # noqa: E402
from fastapi.responses import JSONResponse  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from app.iam.auth import Principal
from app.iam.security import AuthError, ForbiddenError
from app.production import oee

ORG = uuid.uuid4()
SITE = uuid.uuid4()
LINE = uuid.uuid4()
DEV = uuid.uuid4()
STATE_TAG = uuid.uuid4()
COUNT_TAG = uuid.uuid4()
REJECT_TAG = uuid.uuid4()
UID = uuid.uuid4()
DT = uuid.uuid4()
REASON = uuid.uuid4()

# Hand calc for the synthetic day 08:00–12:00 UTC:
#   carry-in running at 07:55, stop 10:00–10:30 -> run = 7200+5400 = 12600 s
#   planned = 14400 s (no shifts -> continuous) -> A = 0.875
#   count 0 -> 12600 units, ideal 1.0 s -> P = 1.0
#   rejects 0 -> 630 -> Q = 0.95; OEE = 0.83125
STATE_SAMPLES = [
    (datetime(2026, 10, 16, 7, 55, tzinfo=timezone.utc), 1),
    (datetime(2026, 10, 16, 10, 0, tzinfo=timezone.utc), 0),
    (datetime(2026, 10, 16, 10, 30, tzinfo=timezone.utc), 1),
]
STATES_MAP = {"running": [1], "idle": [2], "stopped": [0], "fault": [9]}

MACHINE_ROW = {"id": uuid.uuid4(), "org_id": ORG, "site_id": SITE,
               "device_id": DEV, "state_tag_id": STATE_TAG,
               "count_tag_id": COUNT_TAG, "reject_tag_id": REJECT_TAG,
               "states": STATES_MAP, "stop_threshold_s": 300,
               "updated_at": datetime(2026, 10, 16, tzinfo=timezone.utc),
               "device_name": "Sorter", "line_id": LINE, "line_name": "Line 1"}


class FakeConn:
    """Canned rows keyed by the SQL subject the routes issue."""

    def __init__(self, *, site_row=None, machines=None, shifts=None,
                 state_samples=STATE_SAMPLES, first_last=None, ideal=1.0,
                 reasons=None, dt_event=None, dt_update=True):
        self.site_row = site_row if site_row is not None else {
            "id": SITE, "timezone": "UTC"}
        self.machines = list(machines) if machines is not None else [MACHINE_ROW]
        self.shifts = list(shifts or [])
        self.state_samples = state_samples
        # tag_id -> (first v, last v) for counter windows
        self.first_last = first_last if first_last is not None else {
            COUNT_TAG: (0, 12600), REJECT_TAG: (0, 630)}
        self.ideal = ideal
        self.reasons = set(reasons if reasons is not None else [REASON])
        self.dt_event = dt_event
        self.dt_update = dt_update
        self.audit = []

    @asynccontextmanager
    async def transaction(self):
        yield self

    async def execute(self, sql, *args):
        if "audit_log" in sql:
            self.audit.append(args)
        return "OK"

    async def executemany(self, sql, args):
        return None

    async def fetchval(self, sql, *args):
        if "FROM machine_products" in sql:
            return self.ideal
        if "FROM downtime_reasons" in sql:
            return 1 if args[0] in self.reasons else None
        if "DELETE FROM" in sql:
            return None
        return None

    async def fetch(self, sql, *args):
        if "FROM machine_state_map" in sql:
            return list(self.machines)
        if "FROM shifts" in sql:
            return list(self.shifts)
        if "FROM nonworking_days" in sql:
            return []
        if "FROM tag_history" in sql and "ts >= $2" in sql:
            return [{"ts": t, "v": v} for t, v in self.state_samples
                    if args[1] <= t <= args[2]]
        if "FROM downtimes d" in sql:
            return [self.dt_event] if self.dt_event else []
        return []

    async def fetchrow(self, sql, *args):
        if "FROM sites WHERE id" in sql:
            return self.site_row
        if "SELECT ts, v FROM tag_history" in sql and "ts < $2" in sql:
            pre = [s for s in self.state_samples if s[0] < args[1]]
            s = pre[-1] if pre else None
            return {"ts": s[0], "v": s[1]} if s else None
        if "SELECT v FROM tag_history" in sql:
            pair = self.first_last.get(args[0])
            if pair is None:
                return None
            v = pair[0] if "ASC" in sql else pair[1]
            return {"v": v, "ts": args[1]}
        if "UPDATE downtimes" in sql:
            return {"id": DT} if self.dt_update else None
        if "FROM downtimes d" in sql:
            return self.dt_event
        if "FROM machine_state_map" in sql:
            return self.machines[0] if self.machines else None
        return None


class FakePool:
    def __init__(self, conn):
        self.conn = conn

    @asynccontextmanager
    async def acquire(self):
        yield self.conn


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

    app.include_router(oee.router)
    app.state.st = SimpleNamespace(
        auth=FakeAuth(_principal(role, org)),
        pools=SimpleNamespace(app=FakePool(conn)),
        mutation_limiter=FakeLimiter())
    return TestClient(app, raise_server_exceptions=True)


OEE_URL = (f"/api/v1/orgs/{ORG}/sites/{SITE}/oee"
           "?from=2026-10-16T08:00:00Z&to=2026-10-16T12:00:00Z")


# ------------------------------------------------------------------ OEE read
def test_oee_matches_hand_calc_over_http():
    r = _app(FakeConn()).get(OEE_URL)
    assert r.status_code == 200, r.text
    body = r.json()
    m = body["machines"][0]
    assert abs(m["availability"] - 0.875) < 0.005
    assert abs(m["performance"] - 1.0) < 0.005
    assert abs(m["quality"] - 0.95) < 0.005
    assert abs(m["oee"] - 0.83125) < 0.005
    t = body["totals"]
    assert abs(t["oee"] - 0.83125) < 0.005
    assert m["run_s"] == 12600 and m["planned_s"] == 14400


def test_oee_shift_windows_constrain_planned_time():
    # shift 08:00-10:00 Mon-Fri -> planned 2h of the 4h range; only the
    # running samples inside count (run = 7200 s)
    shifts = [{"id": uuid.uuid4(), "site_id": SITE, "name": "AM",
               "start_time": dtime(8, 0), "end_time": dtime(10, 0),
               "days_of_week": [1, 2, 3, 4, 5, 6, 7], "breaks": [], "enabled": True}]
    conn = FakeConn(shifts=shifts)
    r = _app(conn).get(OEE_URL)
    assert r.status_code == 200, r.text
    m = r.json()["machines"][0]
    assert m["planned_s"] == 7200 and m["run_s"] == 7200
    assert abs(m["availability"] - 1.0) < 0.005


def test_oee_bad_range_400_and_nonmember_404():
    r = _app(FakeConn()).get(f"/api/v1/orgs/{ORG}/sites/{SITE}/oee?from=nope&to=x")
    assert r.status_code == 400
    r = _app(FakeConn(), org=uuid.uuid4()).get(OEE_URL)
    assert r.status_code == 404


# ------------------------------------------------------- classify from phone
def test_classify_stop_sets_reason_and_clears_needs_reason():
    ev = {"id": DT, "device_id": DEV, "device_name": "Sorter", "state": "stopped",
          "starts_at": datetime(2026, 10, 16, 10, tzinfo=timezone.utc),
          "ends_at": datetime(2026, 10, 16, 10, 30, tzinfo=timezone.utc),
          "needs_reason": False, "reason_id": REASON, "reason_code": "jam",
          "reason_en": "Jam", "note": "box stuck",
          "classified_at": datetime(2026, 10, 16, 10, 40, tzinfo=timezone.utc)}
    conn = FakeConn(dt_event=ev)
    r = _app(conn).post(
        f"/api/v1/orgs/{ORG}/sites/{SITE}/downtime-events/{DT}/classify",
        json={"reason_id": str(REASON), "note": "box stuck"})
    assert r.status_code == 200, r.text
    assert r.json()["downtime"]["reason"] == "Jam"
    assert conn.audit and conn.audit[0][2] == "downtime.classified"


def test_classify_unknown_reason_404():
    r = _app(FakeConn()).post(
        f"/api/v1/orgs/{ORG}/sites/{SITE}/downtime-events/{DT}/classify",
        json={"reason_id": str(uuid.uuid4())})
    assert r.status_code == 404


def test_classify_missing_downtime_404():
    conn = FakeConn(dt_update=False)
    r = _app(conn).post(
        f"/api/v1/orgs/{ORG}/sites/{SITE}/downtime-events/{DT}/classify",
        json={"reason_id": str(REASON)})
    assert r.status_code == 404


def test_viewer_cannot_classify():
    r = _app(FakeConn(), role="viewer").post(
        f"/api/v1/orgs/{ORG}/sites/{SITE}/downtime-events/{DT}/classify",
        json={"reason_id": str(REASON)})
    assert r.status_code == 403


# ------------------------------------------------------------ shifts/current
def test_current_shift_endpoint():
    shifts = [{"id": uuid.uuid4(), "site_id": SITE, "name": "Day",
               "start_time": dtime(0, 0), "end_time": dtime(23, 59),
               "days_of_week": [1, 2, 3, 4, 5, 6, 7], "breaks": [], "enabled": True}]
    r = _app(FakeConn(shifts=shifts)).get(
        f"/api/v1/orgs/{ORG}/sites/{SITE}/shifts/current")
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["shift"]["name"] == "Day" and body["timezone"] == "UTC"


def test_current_shift_none_off_shift():
    shifts = [{"id": uuid.uuid4(), "site_id": SITE, "name": "Never",
               "start_time": dtime(0, 0), "end_time": dtime(0, 1),
               "days_of_week": [], "breaks": [], "enabled": True}]
    r = _app(FakeConn(shifts=shifts)).get(
        f"/api/v1/orgs/{ORG}/sites/{SITE}/shifts/current")
    assert r.status_code == 200 and r.json()["shift"] is None


# -------------------------------------------------------------- pareto read
def test_pareto_endpoint_orders_by_seconds():
    rows = [{"reason_id": None, "code": None, "name_en": None, "name_th": None,
             "n": 3, "secs": 900},
            {"reason_id": REASON, "code": "jam", "name_en": "Jam",
             "name_th": "ติด", "n": 1, "secs": 300}]

    class PConn(FakeConn):
        async def fetch(self, sql, *args):
            if "GROUP BY d.reason_id" in sql:
                return rows
            return await super().fetch(sql, *args)

    r = _app(PConn()).get(
        f"/api/v1/orgs/{ORG}/sites/{SITE}/oee/pareto"
        "?from=2026-10-16T00:00:00Z&to=2026-10-17T00:00:00Z")
    assert r.status_code == 200, r.text
    items = r.json()["items"]
    assert items[0]["seconds"] == 900 and items[0]["reason_id"] is None
    assert items[1]["code"] == "jam" and abs(items[1]["cum_pct"] - 1.0) < 1e-9
