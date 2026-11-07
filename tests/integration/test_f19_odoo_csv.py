"""F19: the Odoo connector is read-only (fake XML-RPC transport) and CSV import is dry-run first.

Offline: OdooConnector with an injected fake transport records every call; only login, version and
search_read may appear. Live: csv-import dry_run changes nothing; apply writes once; a re-import skips.
"""

import asyncio
import uuid

import pytest

from app.integration.connectors import csv_connector
from app.integration.connectors.odoo import PAGE, OdooConnector

# ---- offline: Odoo through a fake transport ----


class FakeOdoo:
    """Records (endpoint, method, args). Serves 2 pages of products to prove the cursor logic."""

    calls: list = []

    def __init__(self, rows, login_ok=True):
        self.rows, self.login_ok = rows, login_ok

    def factory(self, url):
        path = url.rsplit("/", 1)[-1]
        outer = self

        class P:
            def __getattr__(self, method):
                def call(*a):
                    FakeOdoo.calls.append((path, method, a))
                    if path == "common" and method == "version":
                        return {"server_version": "17.0"}
                    if path == "common" and method == "authenticate":
                        return 7 if outer.login_ok else False
                    if path == "object" and method == "execute_kw":
                        _db, _uid, _key, _model, op, args, kw = a
                        assert op == "search_read"
                        cur = [d for d in args[0] if d[0] == "write_date"]
                        rows = [r for r in outer.rows if not cur or r["write_date"] > cur[0][2]]
                        return rows[:kw["limit"]]
                    raise AssertionError(f"unexpected call {path}.{method}")
                return call
        return P()


def _conn(rows, login_ok=True):
    FakeOdoo.calls = []
    return OdooConnector("https://odoo.example.test", "db", "bot", "key", proxy_factory=FakeOdoo(rows, login_ok).factory, check_egress=False)


def _products(n, start=0):
    return [{"id": start + i, "default_code": f"P{start + i}", "name": f"Prod {i}", "active": True,
             "write_date": f"2026-11-0{1 + (start + i) // PAGE} 10:00:{(start + i) % 60:02d}"} for i in range(n)]


def test_odoo_connector_only_reads():
    conn = _conn(_products(3))
    assert asyncio.run(conn.healthcheck()).ok
    for entity in ("product", "work_center", "work_order"):
        asyncio.run(conn.pull(entity, None))
    methods = {(p, m) for p, m, _ in FakeOdoo.calls}
    assert methods <= {("common", "version"), ("common", "authenticate"), ("object", "execute_kw")}, methods
    ops = {a[4] for p, m, a in FakeOdoo.calls if m == "execute_kw"}
    assert ops == {"search_read"}                       # never create / write / unlink / action_*


def test_odoo_wrong_key_is_reported_not_raised_by_healthcheck():
    h = asyncio.run(_conn([], login_ok=False).healthcheck())
    assert h.ok is False and "rejected" in h.detail.lower()


def test_odoo_pull_maps_fields_and_pages_by_write_date():
    full = _products(PAGE)
    conn = _conn(full)
    page = asyncio.run(conn.pull("product", None))
    assert len(page.records) == PAGE and page.next_cursor is not None
    assert page.records[0].fields == {"code": "P0", "name": "Prod 0", "active": True}
    assert page.records[0].version == full[0]["write_date"]
    short = asyncio.run(_conn(_products(5)).pull("product", None))
    assert short.next_cursor is None                    # a short page is the end


def test_odoo_cursor_is_sent_as_a_write_date_filter():
    conn = _conn(_products(3))
    asyncio.run(conn.pull("product", "2026-11-01 10:00:01"))
    dom = [a for p, m, a in FakeOdoo.calls if m == "execute_kw"][0][5][0]
    assert ["write_date", ">", "2026-11-01 10:00:01"] in dom


def test_odoo_url_to_private_host_is_refused():
    from app.core import egress
    with pytest.raises(egress.EgressError):
        OdooConnector("http://10.0.0.5:8069", "db", "u", "k")


def test_csv_parse_requires_the_key_column_and_hashes_rows():
    with pytest.raises(ValueError):
        csv_connector.parse("product", b"name\nx\n")
    a = csv_connector.parse("product", b"code,name\nP1,Gravel\n")[0]
    b = csv_connector.parse("product", b"code,name\nP1,Gravel\n")[0]
    c = csv_connector.parse("product", b"code,name\nP1,Gravel 2\n")[0]
    assert a.version == b.version != c.version


def test_csv_too_large_or_not_utf8_is_refused():
    with pytest.raises(ValueError):
        csv_connector.parse("product", b"code\n" + b"x" * (csv_connector.MAX_BYTES + 1))
    with pytest.raises(UnicodeDecodeError):
        csv_connector.parse("product", b"code\n\xff\xfe\n")


# ---- live: dry-run first, apply once, re-import skips ----

pytestmark_live = pytest.mark.integration


def _admin(base_url):
    httpx = pytest.importorskip("httpx")
    from conftest import ADMIN_TOKEN
    return httpx.Client(base_url=base_url, timeout=30.0, headers={"Authorization": f"Bearer {ADMIN_TOKEN}"})


@pytest.mark.integration
def test_csv_dry_run_changes_nothing_then_apply_then_skip(base_url):
    from conftest import ORG_ID
    url = f"/api/v1/orgs/{ORG_ID}/integration/csv-import"
    tag = uuid.uuid4().hex[:6]
    body = f"code,name\nT{tag}-1,Gravel\nT{tag}-2,Sand\n".encode()
    hdr = {"Content-Type": "text/csv"}
    with _admin(base_url) as a:
        d1 = a.post(url, params={"entity": "product", "dry_run": "true"}, content=body, headers=hdr).json()
        d2 = a.post(url, params={"entity": "product", "dry_run": "true"}, content=body, headers=hdr).json()
        assert d1["dry_run"] is True and d1["added"] == 2 and d1["error"] is None
        assert d2["added"] == 2, "a dry run must not remember anything"
        default = a.post(url, params={"entity": "product"}, content=body, headers=hdr).json()
        assert default["dry_run"] is True                  # dry run is the default
        applied = a.post(url, params={"entity": "product", "dry_run": "false"}, content=body, headers=hdr).json()
        assert applied["dry_run"] is False and applied["added"] == 2
        again = a.post(url, params={"entity": "product", "dry_run": "false"}, content=body, headers=hdr).json()
        assert again["added"] == 0 and again["skipped"] == 2
        changed = body.replace(b"Sand", b"Sand fine")
        upd = a.post(url, params={"entity": "product", "dry_run": "false"}, content=changed, headers=hdr).json()
        assert upd["updated"] == 1 and upd["skipped"] == 1


@pytest.mark.integration
def test_csv_work_centers_wait_in_staging_until_mapped(base_url):
    from conftest import ORG_ID
    base = f"/api/v1/orgs/{ORG_ID}/integration"
    code = f"WC-{uuid.uuid4().hex[:6]}"
    with _admin(base_url) as a:
        r = a.post(f"{base}/csv-import", params={"entity": "work_center", "dry_run": "false"},
                   content=f"code,name\n{code},Belt\n".encode(), headers={"Content-Type": "text/csv"}).json()
        assert r["staged"] == 1 and r["added"] == 0         # never guessed onto a machine
        items = a.get(f"{base}/staging").json()["items"]
        assert any(i["external_id"] == code for i in items)


@pytest.mark.integration
def test_csv_import_rejects_bad_input_and_non_admins(base_url):
    from conftest import ORG_ID, VIEWER_TOKEN
    httpx = pytest.importorskip("httpx")
    url = f"/api/v1/orgs/{ORG_ID}/integration/csv-import"
    with _admin(base_url) as a:
        assert a.post(url, params={"entity": "product"}, content=b"name\nx\n", headers={"Content-Type": "text/csv"}).status_code == 422
        assert a.post(url, params={"entity": "nonsense"}, content=b"code\nx\n").status_code in (400, 422)
        r = a.post(url, params={"entity": "product", "dry_run": "false"},
                   content="code,name\n,No code\n".encode(), headers={"Content-Type": "text/csv"}).json()
        assert r["bad"] == 1 and r["added"] == 0
    with httpx.Client(base_url=base_url, timeout=10.0, headers={"Authorization": f"Bearer {VIEWER_TOKEN}"}) as v:
        assert v.post(url, params={"entity": "product"}, content=b"code\nx\n").status_code == 403
