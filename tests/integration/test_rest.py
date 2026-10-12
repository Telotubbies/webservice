"""REST integration tests — CONTRACT.md "REST" + "Command lifecycle".

Requires: BASE_URL (e.g. http://localhost:8000). All tests skip cleanly
when the backend isn't up.
"""

import uuid

import pytest

pytestmark = pytest.mark.integration

from conftest import TAGS, wait_until  # noqa: E402


def _wait_command_status(api, command_id, headers, timeout_s=20):
    """Poll GET /api/commands/{id} until terminal status."""
    def poll():
        r = api.get(f"/api/commands/{command_id}", headers=headers)
        if r.status_code != 200:
            return None
        body = r.json()
        return body if body.get("status") in (
            "done", "denied", "failed", "timeout"
        ) else None
    return wait_until(poll, timeout_s, desc=f"command {command_id} terminal")


# ------------------------------------------------------------------- health

def test_health(api):
    r = api.get("/api/health")
    assert r.status_code == 200
    body = r.json()
    assert body["status"] == "ok"
    assert body["db"] == "up"
    assert body["mqtt"] == "up"
    assert body["edge"] in ("up", "stale")  # contract: up|stale


def test_system_health(api):
    r = api.get("/api/system/health")
    assert r.status_code == 200
    body = r.json()
    assert "mqtt" in body and "edge" in body and "backend" in body
    assert "connected" in body["mqtt"]
    assert "clock_ok" in body["edge"]


def test_health_allows_anonymous(anon_api):
    # /api/health is the machine-level probe — the ONE public read left.
    assert anon_api.get("/api/health").status_code == 200


# --------------------------------------------------- anonymous reads -> 401
# v4 T5: every /api/* read requires a member principal (ADR-12).

@pytest.mark.parametrize("path", [
    "/api/tags",
    "/api/tags/latest",
    "/api/alarms",
    "/api/insights",
    "/api/alarm-rules",
    "/api/commands",
    "/api/system/health",
    "/api/me",
])
def test_anonymous_reads_are_401(anon_api, path):
    assert anon_api.get(path).status_code == 401, path


def test_garbage_bearer_is_401(anon_api):
    r = anon_api.get("/api/tags",
                     headers={"Authorization": "Bearer not-a-jwt"})
    assert r.status_code == 401


def test_auth_config_is_public(anon_api):
    """The unauthenticated bootstrap endpoint the sign-in wall needs."""
    r = anon_api.get("/api/auth/config")
    assert r.status_code == 200
    body = r.json()
    assert body["env"] == "dev"
    assert body["dev_tokens"] is True
    assert body["oidc"]["client_id"] == "wds-web"
    assert body["oidc"]["realm"] == "wds"


def test_me_returns_member_role(api):
    r = api.get("/api/me")
    assert r.status_code == 200
    body = r.json()
    assert body["role"] == "operator"
    assert body["kind"] == "dev"          # dev-token path (APP_ENV=dev)
    assert body["user"]["sub"].startswith("dev:")


# --------------------------------------------------------------------- tags

def test_tags_list_contains_seed_tags(api):
    r = api.get("/api/tags")
    assert r.status_code == 200
    tags = {t["name"]: t for t in r.json()}
    for name in TAGS.values():
        assert name in tags, f"seed tag {name} missing from /api/tags"
    assert tags[TAGS["running"]]["writable"] is True
    assert tags[TAGS["speed_sp"]]["writable"] is True
    assert tags[TAGS["temp_c"]]["writable"] is False


def test_latest_tag_exists(api):
    def poll():
        r = api.get(f"/api/tags/{TAGS['temp_c']}/latest")
        return r.json() if r.status_code == 200 else None
    body = wait_until(poll, 20, desc="latest temp_c (edge publishes every ~1s)")
    assert body["name"] == TAGS["temp_c"]
    assert isinstance(body["v"], (int, float))
    assert body["q"] in ("good", "bad", "stale", "uncertain")
    assert body["ts"].endswith("Z")


def test_latest_unknown_tag_404(api):
    r = api.get("/api/tags/plant1.sort.line1.ghost1.sig/latest")
    assert r.status_code == 404


def test_history_shape(api):
    r = api.get(f"/api/tags/{TAGS['temp_c']}/history", params={"limit": 10})
    assert r.status_code == 200
    rows = r.json()
    assert isinstance(rows, list)
    if rows:  # history may be empty right after boot
        assert {"v", "q", "ts"} <= rows[0].keys()


# ----------------------------------------------------------------- commands

def test_command_happy_path_bool_tag(api, operator_headers):
    r = api.post(
        "/api/commands",
        headers=operator_headers,
        json={"tag": TAGS["running"], "value": True, "ttl_s": 15},
    )
    assert r.status_code == 201, r.text
    command_id = r.json()["command_id"]
    final = _wait_command_status(api, command_id, operator_headers)
    assert final["status"] == "done", final
    assert final["tag"] == TAGS["running"]


def test_command_happy_path_setpoint(api, operator_headers):
    r = api.post(
        "/api/commands",
        headers=operator_headers,
        json={"tag": TAGS["speed_sp"], "value": 30.0, "ttl_s": 15},
    )
    assert r.status_code == 201, r.text
    final = _wait_command_status(api, r.json()["command_id"], operator_headers)
    assert final["status"] == "done", final


def test_command_no_token_401(anon_api):
    r = anon_api.post("/api/commands", json={"tag": TAGS["running"], "value": True})
    assert r.status_code == 401


def test_command_viewer_token_403(api, viewer_headers):
    r = api.post(
        "/api/commands",
        headers=viewer_headers,
        json={"tag": TAGS["running"], "value": True},
    )
    assert r.status_code == 403


def test_command_bad_payload_400(api, operator_headers):
    r = api.post("/api/commands", headers=operator_headers, json={"tag": "x"})
    assert r.status_code == 400


def test_command_ttl_zero_400(api, operator_headers):
    r = api.post(
        "/api/commands",
        headers=operator_headers,
        json={"tag": TAGS["running"], "value": True, "ttl_s": 0},
    )
    assert r.status_code == 400


def test_command_readonly_tag_denied(api, operator_headers):
    # CONTRACT.md: read-only tag write → denied/not_writable (edge decides).
    # AMBIGUITY: 06 §1 says non-writable tag → 403 at POST time; the binding
    # contract puts the denial in the command lifecycle, so we accept either
    # a 4xx reject or 201→denied/not_writable — flagged for review.
    r = api.post(
        "/api/commands",
        headers=operator_headers,
        json={"tag": TAGS["temp_c"], "value": 12.0, "ttl_s": 15},
    )
    if r.status_code in (400, 403):
        pytest.xfail(f"backend rejected upfront with {r.status_code} "
                     "(06 §1 reading; CONTRACT.md expects lifecycle denial)")
    assert r.status_code == 201, r.text
    final = _wait_command_status(api, r.json()["command_id"], operator_headers)
    assert final["status"] == "denied"
    # detail is optional in the GET shape (`detail?`) — verify only if surfaced
    if final.get("detail"):
        assert "not_writable" in str(final["detail"])


def test_command_out_of_range_denied(api, operator_headers):
    r = api.post(
        "/api/commands",
        headers=operator_headers,
        json={"tag": TAGS["speed_sp"], "value": 999.0, "ttl_s": 15},
    )
    assert r.status_code == 201, r.text
    final = _wait_command_status(api, r.json()["command_id"], operator_headers)
    assert final["status"] == "denied"
    if final.get("detail"):
        assert "out_of_range" in str(final["detail"])


def test_idempotency_key_replay(api, operator_headers):
    key = f"test-{uuid.uuid4()}"
    body = {"tag": TAGS["running"], "value": True,
            "idempotency_key": key, "ttl_s": 15}
    r1 = api.post("/api/commands", headers=operator_headers, json=body)
    assert r1.status_code == 201, r1.text
    id1 = r1.json()["command_id"]
    r2 = api.post("/api/commands", headers=operator_headers, json=body)
    assert r2.status_code == 200, r2.text          # replay → 200, not 201
    assert r2.json()["command_id"] == id1           # same command_id, no new row
    _wait_command_status(api, id1, operator_headers)  # settle for later tests


def test_commands_list_authz(api, anon_api, operator_headers, viewer_headers):
    # Command data is operator-only (consistent with WS command events):
    # anonymous -> 401, viewer -> 403, operator -> 200.
    assert anon_api.get("/api/commands").status_code == 401
    assert api.get("/api/commands", headers=viewer_headers).status_code == 403
    r = api.get("/api/commands", params={"limit": 5}, headers=operator_headers)
    assert r.status_code == 200
    assert isinstance(r.json(), list)
