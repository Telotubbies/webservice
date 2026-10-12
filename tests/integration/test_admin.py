"""Admin surface integration tests — v4 T10, CONTRACT.v2 §3.

Covers the member:manage / config:write / audit:read band end-to-end against
the running stack:

- Role gates: viewer/operator 403 on member/invite/audit admin reads and on
  alarm-rule mutations; non-member org is 404 (no existence oracle).
- Alarm-rule CRUD roundtrip, and a created rule takes effect WITHOUT a
  restart (alarm_rules_changed NOTIFY -> engine load_rules), proven by a
  live MQTT sample tripping the new rule.
- Memberships: list, PATCH role, disable (users.disabled_at wired — the
  dev-token auth path honors it), owner guards, DELETE.
- Invites: create returns the token once, accept verifies the caller's
  verified email, single-use.
- Audit export: JSON + CSV, tenant-scoped.

Requires BASE_URL + WDS_TEST_APP_DSN; the live-reload proof additionally
needs MQTT_HOST (telemetry published as the test-profile `tester`).
"""

import asyncio
import json
import os
import uuid

import pytest

pytestmark = pytest.mark.integration

from conftest import (  # noqa: E402
    ADMIN_TOKEN, OPERATOR_TOKEN, VIEWER_TOKEN, MQTT_CA_FILE, MQTT_HOST,
    MQTT_PORT, ORG_ID as V1_ORG, SITE_ID as V1_SITE, V2_PREFIX,
    mqtt_connect, wait_until,
)

APP_DSN = os.environ.get("WDS_TEST_APP_DSN", "")

ADMIN_UID = uuid.UUID("0199d000-0000-7000-8000-00000000d003")
OPERATOR_UID = uuid.UUID("0199d000-0000-7000-8000-00000000d001")
VIEWER_UID = uuid.UUID("0199d000-0000-7000-8000-00000000d002")

O, S = str(V1_ORG), str(V1_SITE)

AUDIT_EXPORT_MAX = 5000  # mirrors backend/app/main.py


def _dsn_skip():
    if not APP_DSN:
        pytest.skip("WDS_TEST_APP_DSN not set — run under `make test-integration`")


async def _app_conn(dsn):
    import asyncpg
    return await asyncpg.connect(dsn)


@pytest.fixture()
def admin_api(base_url):
    httpx = pytest.importorskip("httpx")
    with httpx.Client(base_url=base_url, timeout=10.0,
                      headers={"Authorization": f"Bearer {ADMIN_TOKEN}"}) as c:
        yield c


@pytest.fixture()
def viewer_api(base_url):
    httpx = pytest.importorskip("httpx")
    with httpx.Client(base_url=base_url, timeout=10.0,
                      headers={"Authorization": f"Bearer {VIEWER_TOKEN}"}) as c:
        yield c


def _temp_tag_id(client):
    r = client.get(f"/api/v1/orgs/{O}/sites/{S}/tags", params={"search": "temp_c"})
    assert r.status_code == 200, r.text
    tag = next(t for t in r.json()["items"] if t["path"].endswith("temp_c"))
    return tag["id"]


# --------------------------------------------------------------- role gates


def test_admin_routes_deny_viewer_and_operator(admin_api, viewer_api, api):
    foreign = str(uuid.uuid4())
    # member:manage / audit:read is admin|owner — operator AND viewer 403
    for client, label in ((viewer_api, "viewer"), (api, "operator")):
        assert client.get(f"/api/v1/orgs/{O}/members").status_code == 403, label
        assert client.get(f"/api/v1/orgs/{O}/invites").status_code == 403, label
        assert client.get(f"/api/v1/orgs/{O}/audit").status_code == 403, label
        r = client.post(f"/api/v1/orgs/{O}/sites/{S}/alarm-rules",
                        json={"name": "x", "tag_id": str(uuid.uuid4()),
                              "kind": "hi", "threshold": 1, "severity": "info"})
        assert r.status_code == 403, label
    # non-member org: 404, identical to a non-existent org (no oracle)
    assert admin_api.get(f"/api/v1/orgs/{foreign}/members").status_code == 404
    # admin passes the gates
    assert admin_api.get(f"/api/v1/orgs/{O}/members").status_code == 200
    assert admin_api.get(f"/api/v1/orgs/{O}/audit").status_code == 200


# ----------------------------------------------------- alarm-rule CRUD + reload


def test_alarm_rule_crud_roundtrip(admin_api):
    tag_id = _temp_tag_id(admin_api)
    name = f"it-rule-{uuid.uuid4().hex[:8]}"
    r = admin_api.post(f"/api/v1/orgs/{O}/sites/{S}/alarm-rules",
                       json={"name": name, "tag_id": tag_id, "kind": "hi",
                             "threshold": 9000, "severity": "warning"})
    assert r.status_code == 201, r.text
    rule = r.json()["rule"]
    try:
        assert rule["name"] == name and rule["tag_id"] == tag_id
        listed = admin_api.get(
            f"/api/v1/orgs/{O}/sites/{S}/alarm-rules").json()["items"]
        assert any(x["id"] == rule["id"] for x in listed)
        # PATCH: retune threshold + disable
        r = admin_api.patch(
            f"/api/v1/orgs/{O}/sites/{S}/alarm-rules/{rule['id']}",
            json={"threshold": 8500, "enabled": False})
        assert r.status_code == 200, r.text
        assert r.json()["rule"]["threshold"] == 8500
        assert r.json()["rule"]["enabled"] is False
        # validation: kind/stale contract enforced at 400, not a CHECK 500
        r = admin_api.patch(
            f"/api/v1/orgs/{O}/sites/{S}/alarm-rules/{rule['id']}",
            json={"kind": "stale"})
        assert r.status_code == 400
    finally:
        d = admin_api.delete(
            f"/api/v1/orgs/{O}/sites/{S}/alarm-rules/{rule['id']}")
    assert d.status_code == 204, d.text
    listed = admin_api.get(
        f"/api/v1/orgs/{O}/sites/{S}/alarm-rules").json()["items"]
    assert not any(x["id"] == rule["id"] for x in listed)


def test_alarm_rule_live_reload_without_restart(admin_api):
    """Create a hi-rule BELOW ambient, publish one fresh sample — an alarm
    against the NEW rule proves load_rules ran via NOTIFY (no restart)."""
    if not MQTT_HOST:
        pytest.skip("MQTT_HOST not set — live-reload proof needs the broker")
    tag_id = _temp_tag_id(admin_api)
    name = f"it-live-{uuid.uuid4().hex[:8]}"
    r = admin_api.post(f"/api/v1/orgs/{O}/sites/{S}/alarm-rules",
                       json={"name": name, "tag_id": tag_id, "kind": "hi",
                             "threshold": -9999, "severity": "info"})
    assert r.status_code == 201, r.text
    rule = r.json()["rule"]

    def fired():
        conn = mqtt_connect()
        try:
            conn.publish(f"{V2_PREFIX}/tele/sort/line1/conv1/temp_c",
                         json.dumps({"v": 30.0, "q": "good",
                                     "ts": __import__("datetime").datetime.now(
                                         __import__("datetime").timezone.utc)
                                         .isoformat()}), qos=1)
            import time as _t
            _t.sleep(0.5)
        finally:
            conn.loop_stop()
            conn.disconnect()
        a = admin_api.get("/api/alarms", params={"status": "active"})
        return any(x.get("rule") == name for x in a.json()) or None
    try:
        assert wait_until(fired, 30, interval_s=1.5,
                          desc="alarm raised by brand-new rule"), \
            "created rule never evaluated — NOTIFY reload broken"
    finally:
        admin_api.delete(f"/api/v1/orgs/{O}/sites/{S}/alarm-rules/{rule['id']}")


# -------------------------------------------------------------- memberships


def test_membership_patch_disable_delete(admin_api):
    _dsn_skip()

    async def mkuser():
        uid = uuid.uuid4()
        conn = await _app_conn(APP_DSN)
        try:
            await conn.execute(
                "INSERT INTO users(id, sub, email, email_verified, display_name)"
                " VALUES ($1,$2,$3,true,'it-user')", uid, f"it:{uid}",
                f"it-{uid.hex[:8]}@test.local")
            await conn.execute("BEGIN")
            await conn.execute(
                "SELECT set_config('app.org_id', $1, true)", O)
            await conn.execute(
                "INSERT INTO memberships(org_id, user_id, role)"
                " VALUES ($1,$2,'viewer')", uuid.UUID(O), uid)
            await conn.execute("COMMIT")
        finally:
            await conn.close()
        return uid

    uid = asyncio.run(mkuser())
    base = f"/api/v1/orgs/{O}/members/{uid}"
    try:
        r = admin_api.patch(base, json={"role": "operator"})
        assert r.status_code == 200, r.text
        assert r.json()["member"]["role"] == "operator"
        # disable: users.disabled_at wired through the same PATCH
        r = admin_api.patch(base, json={"disabled": True})
        assert r.status_code == 200, r.text
        assert r.json()["member"]["disabled"] is True
        r = admin_api.patch(base, json={"disabled": False})
        assert r.json()["member"]["disabled"] is False
        # an admin cannot mint an owner
        assert admin_api.patch(base, json={"role": "owner"}).status_code == 403
        listed = admin_api.get(f"/api/v1/orgs/{O}/members").json()["items"]
        assert any(m["user_id"] == str(uid) for m in listed)
    finally:
        d = admin_api.delete(base)
        assert d.status_code == 200, d.text
        # note: the users row intentionally survives — wds_app has no DELETE
        # grant on users (least privilege), and an orphan with no membership
        # is invisible to every tenant-scoped surface.
    listed = admin_api.get(f"/api/v1/orgs/{O}/members").json()["items"]
    assert not any(m["user_id"] == str(uid) for m in listed)


def test_member_self_and_last_owner_guards(admin_api):
    # self role-change / self-disable rejected
    r = admin_api.patch(f"/api/v1/orgs/{O}/members/{ADMIN_UID}",
                        json={"role": "viewer"})
    assert r.status_code == 400
    r = admin_api.patch(f"/api/v1/orgs/{O}/members/{ADMIN_UID}",
                        json={"disabled": True})
    assert r.status_code == 400


# ----------------------------------------------------------------- invites


def test_invite_create_accept_single_use(admin_api, viewer_api):
    # demo-viewer has a seeded verified dev email (seed.py backfill, T10)
    r = admin_api.post(f"/api/v1/orgs/{O}/invites",
                       json={"email": "demo-viewer@dev.local", "role": "viewer"})
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["token"] and len(body["token"]) == 64
    invite_id = body["invite"]["id"]
    assert body["invite"]["email"] == "demo-viewer@dev.local"
    # the token is never re-served
    listed = admin_api.get(f"/api/v1/orgs/{O}/invites").json()["items"]
    inv = next(i for i in listed if i["id"] == invite_id)
    assert "token" not in inv and inv["accepted_at"] is None
    # accept as the matching user (same role — membership unchanged);
    # the token travels in the body, never the URL path (T10-review F1)
    r = viewer_api.post("/api/v1/invites/accept",
                        json={"token": body["token"]})
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "accepted"
    # single-use
    assert viewer_api.post("/api/v1/invites/accept",
                           json={"token": body["token"]}).status_code == 404
    # bogus token is the same 404 (no oracle)
    assert viewer_api.post("/api/v1/invites/accept",
                           json={"token": uuid.uuid4().hex * 2}
                           ).status_code == 404


def test_invite_email_mismatch(admin_api, viewer_api):
    r = admin_api.post(f"/api/v1/orgs/{O}/invites",
                       json={"email": f"nobody-{uuid.uuid4().hex[:8]}@test.local",
                             "role": "viewer"})
    assert r.status_code == 201, r.text
    invite_id, token = r.json()["invite"]["id"], r.json()["token"]
    try:
        # demo-viewer's verified email does not match
        r = viewer_api.post("/api/v1/invites/accept", json={"token": token})
        assert r.status_code == 403, r.text
    finally:
        d = admin_api.delete(f"/api/v1/orgs/{O}/invites/{invite_id}")
        assert d.status_code == 200, d.text


def test_invite_accept_preserves_existing_role(admin_api, viewer_api):
    """T10-review F3: an existing member's accept is a safe no-op — the
    invite confirms membership but never overwrites the current role
    (a blind upsert would let an admin demote the last owner by inviting
    their email)."""
    r = admin_api.post(f"/api/v1/orgs/{O}/invites",
                       json={"email": "demo-viewer@dev.local", "role": "operator"})
    assert r.status_code == 201, r.text
    token = r.json()["token"]
    r = viewer_api.post("/api/v1/invites/accept", json={"token": token})
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "accepted"
    assert r.json()["role"] == "viewer"  # the PRESERVED role, not the invite's
    mem = admin_api.get(f"/api/v1/orgs/{O}/members").json()["items"]
    v = next(m for m in mem if m["user_id"] == str(VIEWER_UID))
    assert v["role"] == "viewer"


# -------------------------------------------------------------- audit export


def test_audit_export_json_and_csv(admin_api):
    # guaranteed rows: these very tests write audit entries; also make one now
    tag_id = _temp_tag_id(admin_api)
    r = admin_api.post(f"/api/v1/orgs/{O}/sites/{S}/alarm-rules",
                       json={"name": f"it-audit-{uuid.uuid4().hex[:8]}",
                             "tag_id": tag_id, "kind": "hi",
                             "threshold": 9000, "severity": "info"})
    assert r.status_code == 201, r.text
    rule_id = r.json()["rule"]["id"]
    try:
        r = admin_api.get(f"/api/v1/orgs/{O}/audit",
                          params={"format": "json",
                                  "action": "alarm_rule.created",
                                  "limit": AUDIT_EXPORT_MAX})
        assert r.status_code == 200, r.text
        items = r.json()["items"]
        assert len(items) > 0
        # target is a JSON object — match our rule by id
        ours = [i for i in items
                if (i["target"] or {}).get("rule_id") == rule_id]
        assert ours, "no alarm_rule.created row for our rule"
        last = ours[-1]
        assert last["actor"].startswith("user:")
        assert isinstance(last["seq"], int) and last["hash"]
        # filter by action
        r = admin_api.get(f"/api/v1/orgs/{O}/audit",
                          params={"action": "alarm_rule.created"})
        assert all(i["action"] == "alarm_rule.created" for i in r.json()["items"])
        # CSV export
        r = admin_api.get(f"/api/v1/orgs/{O}/audit", params={"format": "csv"})
        assert r.status_code == 200
        assert "text/csv" in r.headers["content-type"]
        lines = r.text.splitlines()
        assert lines[0] == "seq,at,actor,action,target,detail,hash"
        assert len(lines) > 1
        # bad format is a 400
        assert admin_api.get(f"/api/v1/orgs/{O}/audit",
                             params={"format": "xml"}).status_code == 400
    finally:
        admin_api.delete(f"/api/v1/orgs/{O}/sites/{S}/alarm-rules/{rule_id}")
