"""Multi-tenant org routing — HTTP/WS/MQTT level isolation (v4 T9).

Covers CONTRACT.v2 §1/§3/§5 end-to-end against the running stack:

- /api/v1/orgs/{org}/… resolves the org from the PATH and authorizes it
  against the caller's memberships — a non-member sees 404, identical to a
  non-existent org (no existence oracle).
- Members without the required role see 403 (viewer can't ack/command).
- The v1 /api/* shim stays pinned to the seeded org.
- /ws/v1 requires a site_id auth frame; the site's org must be a membership.
- A second org's edge can publish v2 telemetry that lands ONLY in that org.

Requires BASE_URL + WDS_TEST_APP_DSN (the app role — RLS is exercised, not
bypassed). MQTT tests additionally need MQTT_HOST (edge creds come from the
real dynsec provisioning route).
"""

import asyncio
import json
import os
import time
import uuid

import pytest

pytestmark = pytest.mark.integration

from conftest import (  # noqa: E402
    ADMIN_TOKEN, OPERATOR_TOKEN, VIEWER_TOKEN, V2_PREFIX,
    ORG_ID as V1_ORG, SITE_ID as V1_SITE, wait_until,
)

APP_DSN = os.environ.get("WDS_TEST_APP_DSN", "")
MQTT_HOST = os.environ.get("MQTT_HOST", "")
MQTT_PORT = int(os.environ.get("MQTT_PORT", "8883"))
MQTT_CA_FILE = os.environ.get("MQTT_CA_FILE") or os.path.join(
    os.path.dirname(__file__), "..", "..", "infra", "certs", "ca.crt")

# dev-token users (backend/app/auth.py TOKENS + seed.py DEMO_USERS)
ADMIN_UID = uuid.UUID("0199d000-0000-7000-8000-00000000d003")
VIEWER_UID = uuid.UUID("0199d000-0000-7000-8000-00000000d002")

V1_ORG_S, V1_SITE_S = str(V1_ORG), str(V1_SITE)


def _dsn_skip():
    if not APP_DSN:
        pytest.skip("WDS_TEST_APP_DSN not set — run under `make test-integration`")


async def _tenant_conn(dsn, org_id):
    """wds_app connection inside a tenant context — same RLS the app uses."""
    import asyncpg
    conn = await asyncpg.connect(dsn)
    await conn.execute("BEGIN")
    await conn.execute("SELECT set_config('app.org_id', $1, true)", str(org_id))
    return conn


@pytest.fixture(scope="module")
def org_b(base_url):
    """Org B with a real site/edge/tag/alarm + memberships for the dev
    admin (admin) and dev viewer (viewer); demo-operator stays shim-only.
    Everything is written THROUGH wds_app under tenant context."""
    _dsn_skip()
    import asyncpg  # noqa: F401 — importorskip inside

    async def go():
        org, site, edge = uuid.uuid4(), uuid.uuid4(), uuid.uuid4()
        conn = await _tenant_conn(APP_DSN, org)
        try:
            await conn.execute(
                "INSERT INTO organizations(id, name) VALUES ($1, $2)",
                org, f"pytest-org-b-{uuid.uuid4().hex[:8]}")
            await conn.execute(
                "INSERT INTO sites(id, org_id, name, code) VALUES ($1,$2,'Site B','b_site')",
                site, org)
            await conn.execute(
                "INSERT INTO edges(id, org_id, site_id, name, status)"
                " VALUES ($1,$2,$3,'edge-b','active')", edge, org, site)
            tag = await conn.fetchval(
                "INSERT INTO tags(org_id, site_id, edge_id, path, name, type,"
                " writable) VALUES ($1,$2,$3,'b/line1/motor1/run',"
                " 'b-motor-run','bool',true) RETURNING id", org, site, edge)
            rule = await conn.fetchval(
                "INSERT INTO alarm_rules(org_id, tag_id, name, kind, threshold,"
                " severity) VALUES ($1,$2,'b-hi','hi',0.5,'warning')"
                " RETURNING id", org, tag)
            alarm = await conn.fetchval(
                "INSERT INTO alarms(org_id, tag_id, rule_id, severity, state,"
                " raised_at) VALUES ($1,$2,$3,'warning','active',now())"
                " RETURNING id", org, tag, rule)
            insight = await conn.fetchval(
                "INSERT INTO insights(org_id, tag_id, kind, severity, score,"
                " ts_start) VALUES ($1,$2,'anomaly','warning',0.9,now())"
                " RETURNING id", org, tag)
            for uid, role in ((ADMIN_UID, "admin"), (VIEWER_UID, "viewer")):
                await conn.execute(
                    "INSERT INTO memberships(org_id, user_id, role)"
                    " VALUES ($1,$2,$3) ON CONFLICT (org_id, user_id) DO NOTHING",
                    org, uid, role)
            await conn.execute("COMMIT")
        except Exception:
            await conn.execute("ROLLBACK")
            raise
        finally:
            await conn.close()
        return {"org": str(org), "site": str(site), "edge": str(edge),
                "tag": str(tag), "alarm": str(alarm), "insight": str(insight)}

    return asyncio.run(go())


@pytest.fixture()
def admin_api(base_url):
    httpx = pytest.importorskip("httpx")
    with httpx.Client(base_url=base_url, timeout=10.0,
                      headers={"Authorization": f"Bearer {ADMIN_TOKEN}"}) as c:
        yield c


@pytest.fixture()
def operator_api(base_url):
    httpx = pytest.importorskip("httpx")
    with httpx.Client(base_url=base_url, timeout=10.0,
                      headers={"Authorization": f"Bearer {OPERATOR_TOKEN}"}) as c:
        yield c


@pytest.fixture()
def viewer_api(base_url):
    httpx = pytest.importorskip("httpx")
    with httpx.Client(base_url=base_url, timeout=10.0,
                      headers={"Authorization": f"Bearer {VIEWER_TOKEN}"}) as c:
        yield c


def _v2(b, suffix=""):
    return f"/api/v1/orgs/{b['org']}/sites/{b['site']}{suffix}"


# ------------------------------------------------------------------- /api/v1/me

def test_me_lists_both_memberships(admin_api, org_b):
    r = admin_api.get("/api/v1/me")
    assert r.status_code == 200
    orgs = {m["org_id"]: m for m in r.json()["memberships"]}
    assert V1_ORG_S in orgs and org_b["org"] in orgs
    assert orgs[org_b["org"]]["role"] == "admin"
    assert "config:write" in orgs[org_b["org"]]["permissions"]


# ------------------------------------------------------------------- org routing

def test_member_sees_own_org(admin_api, org_b):
    r = admin_api.get(f"/api/v1/orgs/{org_b['org']}")
    assert r.status_code == 200
    assert r.json()["id"] == org_b["org"]
    r = admin_api.get(f"/api/v1/orgs/{org_b['org']}/sites")
    assert r.status_code == 200
    assert any(s["id"] == org_b["site"] for s in r.json()["items"])


def test_non_member_gets_404_not_oracle(operator_api, org_b):
    """demo-operator has no org-B membership — every org-B route is a flat
    404, byte-identical to a random org id."""
    for path in (f"/api/v1/orgs/{org_b['org']}",
                 f"/api/v1/orgs/{org_b['org']}/sites",
                 _v2(org_b, "/tags"),
                 _v2(org_b, "/alarms"),
                 _v2(org_b, "/insights")):
        r = operator_api.get(path)
        assert r.status_code == 404, f"{path} -> {r.status_code}"
    random_org = str(uuid.uuid4())
    assert operator_api.get(f"/api/v1/orgs/{random_org}").status_code == 404


def test_foreign_site_in_member_org_is_404(admin_api, org_b):
    """admin IS a member of org B, but the shim site isn't in it — RLS hides
    it, so site scoping can't be used to jump tenants either."""
    r = admin_api.get(f"/api/v1/orgs/{org_b['org']}/sites/{V1_SITE_S}/tags")
    assert r.status_code == 404
    # …and the reverse: org-B site under the shim org
    r = admin_api.get(
        f"/api/v1/orgs/{V1_ORG_S}/sites/{org_b['site']}/tags")
    assert r.status_code == 404


def test_foreign_tag_id_is_404(admin_api, org_b):
    """A real tag id from the OTHER org is 404 on the path org — no oracle."""
    r = admin_api.get(_v2(org_b, f"/tags/{uuid.uuid4()}/latest"))
    assert r.status_code == 404
    # shim tag id under org B's path: find one via the shim route first
    r = admin_api.get(f"/api/v1/orgs/{V1_ORG_S}/sites/{V1_SITE_S}/tags")
    assert r.status_code == 200
    shim_tag = r.json()["items"][0]["id"]
    r = admin_api.get(_v2(org_b, f"/tags/{shim_tag}/latest"))
    assert r.status_code == 404
    # and org-B's tag is 404 under the shim path
    r = admin_api.get(
        f"/api/v1/orgs/{V1_ORG_S}/sites/{V1_SITE_S}/tags/{org_b['tag']}/history")
    assert r.status_code == 404


# ------------------------------------------------------------------- reads

def test_tags_scoped_to_site(admin_api, org_b):
    def poll():
        r = admin_api.get(_v2(org_b, "/tags"))
        if r.status_code != 200:
            return None
        items = r.json()["items"]
        return items if any(t["id"] == org_b["tag"] for t in items) else None
    # registry caches for ≤30s — poll until the refresh picks org B up
    items = wait_until(poll, 40, desc="org-B tag visible in registry")
    t = next(t for t in items if t["id"] == org_b["tag"])
    assert t["path"] == "b/line1/motor1/run" and t["writable"] is True
    assert all(t["site_id"] == org_b["site"] for t in items)


def test_alarm_visible_only_in_own_org(admin_api, org_b):
    r = admin_api.get(_v2(org_b, "/alarms"))
    assert r.status_code == 200
    ids = [a["id"] for a in r.json()["items"]]
    assert org_b["alarm"] in ids
    # the same alarm id under the shim site is invisible
    r = admin_api.get(f"/api/v1/orgs/{V1_ORG_S}/sites/{V1_SITE_S}/alarms")
    assert org_b["alarm"] not in [a["id"] for a in r.json()["items"]]
    # v1 shim list never carries org-B alarms either
    r = admin_api.get("/api/alarms")
    assert org_b["alarm"] not in [a["id"] for a in r.json()]


def test_insights_scoped(admin_api, org_b):
    r = admin_api.get(_v2(org_b, "/insights"))
    assert r.status_code == 200
    assert org_b["insight"] in [i["id"] for i in r.json()["items"]]
    r = admin_api.get(f"/api/v1/orgs/{V1_ORG_S}/sites/{V1_SITE_S}/insights")
    assert org_b["insight"] not in [i["id"] for i in r.json()["items"]]


def test_health_scoped(admin_api, org_b):
    r = admin_api.get(_v2(org_b, "/health"))
    assert r.status_code == 200
    assert r.json()["db"] == "up"
    assert [e["id"] for e in r.json()["edges"]] == [org_b["edge"]]


# ------------------------------------------------------------------- writes

def test_viewer_cannot_ack(viewer_api, org_b):
    """member but wrong role -> 403 (not 404 — the org exists for them)."""
    r = viewer_api.post(_v2(org_b, f"/alarms/{org_b['alarm']}/ack"))
    assert r.status_code == 403


def test_non_member_cannot_ack(operator_api, org_b):
    r = operator_api.post(_v2(org_b, f"/alarms/{org_b['alarm']}/ack"))
    assert r.status_code == 404


def test_cross_org_ack_id_is_404(admin_api, org_b):
    """Admin of BOTH orgs, but the org-B alarm id under the shim site path
    must be 404 — the id is scoped to the path site."""
    r = admin_api.post(
        f"/api/v1/orgs/{V1_ORG_S}/sites/{V1_SITE_S}"
        f"/alarms/{org_b['alarm']}/ack")
    assert r.status_code == 404


def test_admin_can_ack_own_org(admin_api, org_b):
    r = admin_api.post(_v2(org_b, f"/alarms/{org_b['alarm']}/ack"))
    assert r.status_code == 200
    assert r.json()["state"] == "acked"


def test_viewer_cannot_command(viewer_api, org_b):
    r = viewer_api.post(_v2(org_b, "/commands"),
                        json={"tag_id": org_b["tag"], "value": True})
    assert r.status_code == 403


def test_cross_org_command_tag_is_404(admin_api, org_b):
    """A command on org B's path with a SHIM tag id -> 404 (the tag must
    belong to the path site)."""
    shim_tags = admin_api.get(
        f"/api/v1/orgs/{V1_ORG_S}/sites/{V1_SITE_S}/tags").json()["items"]
    r = admin_api.post(_v2(org_b, "/commands"),
                       json={"tag_id": shim_tags[0]["id"], "value": 1.0})
    assert r.status_code == 404


def test_command_round_trip_scoped(admin_api, operator_api, org_b):
    r = admin_api.post(_v2(org_b, "/commands"),
                       json={"tag_id": org_b["tag"], "value": True,
                             "idempotency_key": f"t9-{uuid.uuid4().hex[:8]}"})
    assert r.status_code == 201, r.text
    cmd = r.json()["command"]
    assert cmd["tag_id"] == org_b["tag"]
    # visible under its own site…
    r = admin_api.get(_v2(org_b, f"/commands/{cmd['id']}"))
    assert r.status_code == 200
    # …invisible under the shim site path (same admin token — site scoping)…
    r = admin_api.get(
        f"/api/v1/orgs/{V1_ORG_S}/sites/{V1_SITE_S}/commands/{cmd['id']}")
    assert r.status_code == 404
    # …and to the non-member entirely
    assert operator_api.get(_v2(org_b, "/commands")).status_code == 404
    assert operator_api.get(
        _v2(org_b, f"/commands/{cmd['id']}")).status_code == 404


# ------------------------------------------------------------------- /ws/v1

def _ws_close(base_url, path, frame, wait_s=6):
    """Connect + send `frame`, read until close or a TOTAL `wait_s` deadline
    → close code, or None if the socket stayed open. The deadline is absolute:
    a member of several orgs legitimately keeps receiving other orgs' events,
    so a per-recv timeout would never fire on a healthy stream."""
    websockets = pytest.importorskip("websockets")

    async def go():
        url = base_url.replace("http", "ws") + path
        try:
            async with websockets.connect(url, open_timeout=10) as ws:
                await ws.send(json.dumps(frame))
                end = asyncio.get_event_loop().time() + wait_s
                while asyncio.get_event_loop().time() < end:
                    await asyncio.wait_for(
                        ws.recv(),
                        timeout=max(0.05,
                                    end - asyncio.get_event_loop().time()))
        except Exception as e:  # closed (or deadline — TimeoutError has no code)
            return getattr(getattr(e, "rcvd", None), "code", None) or getattr(
                e, "code", None)
        return None

    return asyncio.run(go())


def test_ws_v1_requires_site_id(base_url):
    code = _ws_close(base_url, "/ws/v1",
                     {"type": "auth", "token": ADMIN_TOKEN})
    assert code == 4401


def test_ws_v1_member_of_site_org_connects(base_url, org_b):
    code = _ws_close(base_url, "/ws/v1",
                     {"type": "auth", "token": ADMIN_TOKEN,
                      "site_id": org_b["site"]})
    assert code is None  # stayed open until our read timed out


def test_ws_v1_non_member_org_is_4403(base_url, org_b):
    code = _ws_close(base_url, "/ws/v1",
                     {"type": "auth", "token": OPERATOR_TOKEN,
                      "site_id": org_b["site"]})
    assert code == 4403


def test_ws_v1_unknown_site_is_4403(base_url):
    code = _ws_close(base_url, "/ws/v1",
                     {"type": "auth", "token": ADMIN_TOKEN,
                      "site_id": str(uuid.uuid4())})
    assert code == 4403


def test_ws_v1_shim_site_for_member(base_url, org_b):
    code = _ws_close(base_url, "/ws/v1",
                     {"type": "auth", "token": ADMIN_TOKEN,
                      "site_id": V1_SITE_S})
    assert code is None


def test_ws_v1_alias_still_shim(base_url):
    """The /ws compat socket needs no site_id — it serves the seeded site."""
    code = _ws_close(base_url, "/ws",
                     {"type": "auth", "token": OPERATOR_TOKEN})
    assert code is None


# ------------------------------------------- F1: dev token w/o shim membership

def test_dev_member_of_other_org_only_gets_no_shim(viewer_api, org_b, base_url):
    """T9-review F1: a dev user whose hydrated memberships EXCLUDE the shim
    org must not inherit the token's nominal role there — v1 REST -> 403 and
    /ws -> 4403, matching the OIDC path (REST and WS must agree)."""
    _dsn_skip()
    shim = uuid.UUID(V1_ORG_S)

    async def drop_shim():
        conn = await _tenant_conn(APP_DSN, shim)
        try:
            await conn.execute(
                "DELETE FROM memberships WHERE org_id=$1 AND user_id=$2",
                shim, VIEWER_UID)
            await conn.execute("COMMIT")
        finally:
            await conn.close()

    async def restore_shim():
        conn = await _tenant_conn(APP_DSN, shim)
        try:
            await conn.execute(
                "INSERT INTO memberships(org_id, user_id, role)"
                " VALUES ($1,$2,'viewer')"
                " ON CONFLICT (org_id, user_id) DO UPDATE SET role='viewer'",
                shim, VIEWER_UID)
            await conn.execute("COMMIT")
        finally:
            await conn.close()

    asyncio.run(drop_shim())
    try:
        # v1 REST — shim membership gone => 403 on reads AND mutations,
        # even though the token's nominal role is 'viewer'/'operator'-ish
        assert viewer_api.get("/api/tags").status_code == 403
        assert viewer_api.post(
            "/api/commands",
            json={"tag": "plant1.sort.line1.motor1.speed_sp",
                  "value": 1.0}).status_code == 403
        assert viewer_api.post(
            f"/api/alarms/{uuid.uuid4()}/ack").status_code == 403
        # /ws — same verdict, 4403 (previously self-corrected, REST leaked)
        assert _ws_close(base_url, "/ws",
                         {"type": "auth", "token": VIEWER_TOKEN}) == 4403
        # …while org-B v2 routes still work — THAT is their only membership
        r = viewer_api.get(f"/api/v1/orgs/{org_b['org']}")
        assert r.status_code == 200
    finally:
        asyncio.run(restore_shim())


# ------------------------------------------------- MQTT e2e: second-org ingest

def test_second_org_telemetry_isolated(admin_api, org_b, base_url):
    """Provision a real edge on org B (dynsec creds), publish v2 telemetry,
    confirm it lands ONLY in org B."""
    if not MQTT_HOST:
        pytest.skip("MQTT_HOST not set — run under `make test-integration`")
    import paho.mqtt.client as mqtt

    # 1) provision the edge via the v2 route — returns the secret once
    r = admin_api.post(_v2(org_b, "/edges"), json={"name": "edge-b-e2e"})
    assert r.status_code == 201, r.text
    edge_id = r.json()["edge"]["id"]
    secret = r.json()["secret"]

    # 2) bind a fresh tag to that edge (app role, org-B tenant context)
    async def mk_tag():
        conn = await _tenant_conn(APP_DSN, uuid.UUID(org_b["org"]))
        try:
            tid = await conn.fetchval(
                "INSERT INTO tags(org_id, site_id, edge_id, path, name, type)"
                " VALUES ($1,$2,$3,'e2e/line1/sensor/temp','b-temp','number')"
                " RETURNING id",
                uuid.UUID(org_b["org"]), uuid.UUID(org_b["site"]),
                uuid.UUID(edge_id))
            await conn.execute("COMMIT")
            return str(tid)
        finally:
            await conn.close()
    tag_id = asyncio.run(mk_tag())

    # 3) force a registry refresh (disable the DB-created placeholder edge —
    #    any provisioning mutation refreshes the cache)
    admin_api.post(_v2(org_b, f"/edges/{org_b['edge']}/disable"))

    # 4) connect to the broker AS the provisioned edge and publish
    username = f"edge-{edge_id}-v1"
    topic = f"v2/{org_b['org']}/{org_b['site']}/{edge_id}/tele/e2e/line1/sensor/temp"
    payload = json.dumps({"v": 42.5, "q": "good",
                          "ts": time.strftime("%Y-%m-%dT%H:%M:%S",
                                              time.gmtime()) + "Z"})

    def publish_once():
        c = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2,
                        client_id=f"pytest-{uuid.uuid4().hex[:8]}")
        c.username_pw_set(username, secret)
        c.tls_set(ca_certs=MQTT_CA_FILE)
        c.connect(MQTT_HOST, MQTT_PORT, keepalive=10)
        c.loop_start()
        info = c.publish(topic, payload, qos=1)
        info.wait_for_publish(timeout=5)
        time.sleep(0.3)
        c.loop_stop()
        c.disconnect()

    # 5) it must appear under org B only — republish until the ingest tick
    #    picks it up (broker ACL + registry may need a beat)
    def visible_in_b():
        publish_once()
        r = admin_api.get(_v2(org_b, "/tags/latest"))
        if r.status_code != 200:
            return None
        items = {i["tag_id"]: i for i in r.json()["items"]}
        return items.get(tag_id)

    item = wait_until(visible_in_b, 45, desc="org-B telemetry ingested")
    assert item["v"] == 42.5 and item["q"] == "good"

    # 6) never in the shim org — not via the v2 route, not via the v1 alias
    r = admin_api.get(
        f"/api/v1/orgs/{V1_ORG_S}/sites/{V1_SITE_S}/tags/latest")
    assert tag_id not in {i["tag_id"] for i in r.json()["items"]}
    names = {t["name"] for t in admin_api.get("/api/tags").json()}
    assert not any(n.endswith("sensor.temp") or "b.line1" in n or "b_site" in n
                   for n in names)
