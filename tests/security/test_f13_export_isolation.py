"""F13: dataset export is tenant-only and never carries simulated data.

Org C is built straight in the DB (wds_app under RLS, like org_b): one real (modbus) tag and one
simulated (sim) tag, both with history. demo-admin is a member of org C and of the dev org, which
lets us prove the cross-tenant case with a valid token (RLS, not the token, must refuse).
"""

import asyncio
import csv
import io
import uuid
from datetime import datetime, timedelta, timezone

import pytest

pytestmark = [pytest.mark.integration, pytest.mark.security]

from conftest import ADMIN_TOKEN, ORG_ID, SITE_ID  # noqa: E402
from security.conftest import ADMIN_UID, _tenant_conn  # noqa: E402


@pytest.fixture(scope="module")
def org_c(app_dsn):
    async def go():
        org, site, edge = uuid.uuid4(), uuid.uuid4(), uuid.uuid4()
        conn = await _tenant_conn(app_dsn, org)
        try:
            await conn.execute("INSERT INTO organizations(id, name) VALUES ($1,$2)", org, f"f13-{uuid.uuid4().hex[:8]}")
            await conn.execute("INSERT INTO sites(id, org_id, name, code) VALUES ($1,$2,'Site C','c_site')", site, org)
            await conn.execute("INSERT INTO edges(id, org_id, site_id, name, status) VALUES ($1,$2,$3,'edge-c','active')", edge, org, site)
            ids = {}
            for proto in ("modbus", "sim"):
                ds = await conn.fetchval(
                    "INSERT INTO data_sources(org_id, site_id, edge_id, name, protocol) VALUES ($1,$2,$3,$4,$5) RETURNING id",
                    org, site, edge, f"{proto}-src", proto)
                tag = await conn.fetchval(
                    "INSERT INTO tags(org_id, site_id, edge_id, path, name, type, source_id) VALUES ($1,$2,$3,$4,$5,'number',$6) RETURNING id",
                    org, site, edge, f"c/{proto}/temp", f"c-{proto}-temp", ds)
                ids[proto] = tag
                now = datetime.now(timezone.utc)
                for i in range(1, 30):
                    await conn.execute("INSERT INTO tag_history(tag_id, ts, org_id, v, q, vn) VALUES ($1,$2,$3,$4::jsonb,'good',$5)",
                                       tag, now - timedelta(minutes=i), org, str(i), float(i))
            await conn.execute("INSERT INTO memberships(org_id, user_id, role) VALUES ($1,$2,'admin') ON CONFLICT (org_id, user_id) DO NOTHING", org, ADMIN_UID)
            await conn.execute("COMMIT")
        except Exception:
            await conn.execute("ROLLBACK")
            raise
        finally:
            await conn.close()
        return {"org": str(org), "site": str(site), **{k: str(v) for k, v in ids.items()}}

    return asyncio.run(go())


@pytest.fixture()
def api(base_url):
    httpx = pytest.importorskip("httpx")
    with httpx.Client(base_url=base_url, timeout=20.0, headers={"Authorization": f"Bearer {ADMIN_TOKEN}"}) as c:
        yield c


def _dataset(api, org_c, tags):
    now = datetime.now(timezone.utc)
    r = api.post(f"/api/v1/orgs/{org_c['org']}/sites/{org_c['site']}/datasets",
                 json={"name": "f13", "tag_ids": tags, "from_ts": (now - timedelta(minutes=40)).isoformat(),
                       "to_ts": now.isoformat(), "bucket_s": 60})
    assert r.status_code == 201, r.text
    return r.json()["dataset"]["id"]


def test_export_leaves_out_simulated_tags(api, org_c):
    ds = _dataset(api, org_c, [org_c["modbus"], org_c["sim"]])
    r = api.get(f"/api/v1/orgs/{org_c['org']}/sites/{org_c['site']}/datasets/{ds}/export.csv")
    assert r.status_code == 200
    lines = r.text.splitlines()
    assert lines[0].startswith("# skipped simulated tags") and "c/sim/temp" in lines[0]
    rows = list(csv.reader(io.StringIO("\n".join(lines[1:]))))
    assert rows[0] == ["ts", "split", "c/modbus/temp"], rows[0]
    assert len(rows) > 5 and all(len(x) == 3 for x in rows)
    assert {x[1] for x in rows[1:]} <= {"train", "val", "test"}
    assert "c/sim/temp" not in "\n".join(lines[1:])


def test_export_of_only_simulated_tags_has_no_data_columns(api, org_c):
    ds = _dataset(api, org_c, [org_c["sim"]])
    r = api.get(f"/api/v1/orgs/{org_c['org']}/sites/{org_c['site']}/datasets/{ds}/export.csv")
    assert r.status_code == 200
    body = r.text.splitlines()
    assert body[-1] == "ts,split", body          # header only, zero rows of simulated data


def test_other_tenant_cannot_export_or_list(api, org_c):
    ds = _dataset(api, org_c, [org_c["modbus"]])
    # same valid token, but asking through the dev org: RLS hides org C's dataset
    r = api.get(f"/api/v1/orgs/{ORG_ID}/sites/{SITE_ID}/datasets/{ds}/export.csv")
    assert r.status_code == 404
    assert ds not in api.get(f"/api/v1/orgs/{ORG_ID}/sites/{SITE_ID}/datasets").text
    # a tag of another org cannot be put into a dataset of this one
    r = api.post(f"/api/v1/orgs/{ORG_ID}/sites/{SITE_ID}/datasets",
                 json={"name": "x", "tag_ids": [org_c["modbus"]], "from_ts": "2026-01-01T00:00:00Z",
                       "to_ts": "2026-01-01T01:00:00Z"})
    assert r.status_code == 422 and "unknown_tag" in r.text


def test_viewer_cannot_create_but_can_not_see_foreign_dataset(base_url, org_c):
    httpx = pytest.importorskip("httpx")
    from conftest import VIEWER_TOKEN
    with httpx.Client(base_url=base_url, timeout=10.0, headers={"Authorization": f"Bearer {VIEWER_TOKEN}"}) as v:
        r = v.post(f"/api/v1/orgs/{ORG_ID}/sites/{SITE_ID}/datasets",
                   json={"name": "x", "tag_ids": [str(uuid.uuid4())], "from_ts": "2026-01-01T00:00:00Z", "to_ts": "2026-01-01T01:00:00Z"})
        assert r.status_code == 403
