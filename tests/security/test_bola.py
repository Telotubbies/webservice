"""OWASP API1 — Broken Object Level Authorization, live sweep (v4 T13).

Two assertions, both scripted (no checklist):

1. **Non-member sweep** — demo-operator is a member of ONLY the seeded
   shim org. Every v2 route family addressed at org B's real object ids
   must answer 404 — the same response as a non-existent org, so the
   surface is never an existence oracle (CONTRACT.v2 §1, ADR-13 §1).
   Families covered: org root, sites, tags (+latest/+history), alarms
   (+ack), commands (list+get+create), insights, alarm-rules (CRUD),
   edges (list+provision+rotate+disable), members, invites, audit, health.

2. **Cross-tenant id confusion** — demo-admin is a member of BOTH orgs,
   so it proves objects are scoped to the PATH org+site, not merely to
   the caller: org B's ids under shim paths (and vice versa) must 404.

Requires BASE_URL + WDS_TEST_APP_DSN (`make test-security`).
"""

from __future__ import annotations

import json
import uuid

import pytest

pytestmark = [pytest.mark.integration, pytest.mark.security]

from conftest import (  # noqa: E402
    ADMIN_TOKEN, OPERATOR_TOKEN, ORG_ID as V1_ORG, SITE_ID as V1_SITE,
    wait_until,
)
from security.conftest import ADMIN_UID, VIEWER_UID  # noqa: E402

O, S = str(V1_ORG), str(V1_SITE)


def _v2(org: str, site: str, suffix: str = "") -> str:
    return f"/api/v1/orgs/{org}/sites/{site}{suffix}"


def _v2b(b, suffix=""):
    return _v2(b["org"], b["site"], suffix)


@pytest.fixture(scope="module")
def org_b_full(org_b, base_url):
    """org_b plus objects that only exist via the API: an invite id and a
    command id (the command exercises the normal lifecycle — safety
    boundary: issued to org B's own test tag through the REST surface)."""
    import httpx
    admin = httpx.Client(base_url=base_url, timeout=10.0,
                         headers={"Authorization": f"Bearer {ADMIN_TOKEN}"})
    # invite object for the DELETE probe
    r = admin.post(f"/api/v1/orgs/{org_b['org']}/invites",
                   json={"email": f"sec-{uuid.uuid4().hex[:8]}@test.local",
                         "role": "viewer"})
    assert r.status_code == 201, r.text
    org_b["invite"] = r.json()["invite"]["id"]

    # a real command on org B's own writable tag (goes through the normal
    # lifecycle: sent -> timeout, since edge-b is a DB stub with no broker
    # client — the id is all this suite needs)
    def tag_visible():
        r = admin.post(
            _v2b(org_b, "/edges/" + org_b["edge"] + "/rotate"))
        return r.status_code in (201, 200, 409) or None
    # registry needs one refresh to learn org B's tag; rotating the
    # placeholder edge forces it (and exercises the provision path)
    wait_until(tag_visible, 45, interval_s=2.0,
               desc="org-B tag registered (registry refresh)")
    r = admin.post(_v2b(org_b, "/commands"),
                   json={"tag_id": org_b["tag"], "value": True,
                         "idempotency_key": f"sec-{uuid.uuid4().hex[:8]}"})
    assert r.status_code == 201, r.text
    org_b["command"] = r.json()["command"]["id"]
    admin.close()
    return org_b


@pytest.fixture()
def operator_api(base_url):
    httpx = pytest.importorskip("httpx")
    with httpx.Client(base_url=base_url, timeout=10.0,
                      headers={"Authorization": f"Bearer {OPERATOR_TOKEN}"}) as c:
        yield c


# ------------------------------------------------------- non-member sweep

def test_nonmember_get_routes_all_404(operator_api, org_b_full):
    b = org_b_full
    paths = [
        f"/api/v1/orgs/{b['org']}",
        f"/api/v1/orgs/{b['org']}/sites",
        _v2b(b, "/tags"),
        _v2b(b, "/tags/latest"),
        _v2b(b, f"/tags/{b['tag']}/latest"),
        _v2b(b, f"/tags/{b['tag']}/history"),
        _v2b(b, "/alarm-rules"),
        _v2b(b, "/alarms"),
        _v2b(b, "/insights"),
        _v2b(b, "/commands"),
        _v2b(b, f"/commands/{b['command']}"),
        _v2b(b, "/health"),
        _v2b(b, "/edges"),
        f"/api/v1/orgs/{b['org']}/members",
        f"/api/v1/orgs/{b['org']}/invites",
        f"/api/v1/orgs/{b['org']}/audit",
    ]
    for p in paths:
        r = operator_api.get(p)
        assert r.status_code == 404, f"GET {p} -> {r.status_code}"
        # identical-to-nonexistent: body must not leak org/object detail
        assert b["org"] not in r.text and "not found" in r.text.lower()


def test_nonmember_mutation_routes_all_404(operator_api, org_b_full):
    """Writes get the same flat 404 — the org check precedes the role
    check and the rate-limit gate, so a non-member learns nothing and
    spends nothing."""
    b = org_b_full
    probes = [
        ("post", _v2b(b, "/commands"),
         {"tag_id": b["tag"], "value": True}),
        ("post", _v2b(b, f"/alarms/{b['alarm']}/ack"), None),
        ("post", _v2b(b, "/alarm-rules"),
         {"name": "x", "tag_id": b["tag"], "kind": "hi", "threshold": 1,
          "severity": "info"}),
        ("patch", _v2b(b, f"/alarm-rules/{b['rule']}"), {"enabled": False}),
        ("delete", _v2b(b, f"/alarm-rules/{b['rule']}"), None),
        ("post", _v2b(b, "/edges"), {"name": "evil-edge"}),
        ("post", _v2b(b, f"/edges/{b['edge']}/rotate"), None),
        ("post", _v2b(b, f"/edges/{b['edge']}/disable"), None),
        ("patch", f"/api/v1/orgs/{b['org']}/members/{VIEWER_UID}",
         {"role": "owner"}),
        ("delete", f"/api/v1/orgs/{b['org']}/members/{VIEWER_UID}", None),
        ("post", f"/api/v1/orgs/{b['org']}/invites",
         {"email": "x@y.z", "role": "admin"}),
        ("delete", f"/api/v1/orgs/{b['org']}/invites/{b['invite']}", None),
    ]
    for method, path, payload in probes:
        r = getattr(operator_api, method)(path, json=payload) \
            if payload is not None else getattr(operator_api, method)(path)
        assert r.status_code == 404, \
            f"{method.upper()} {path} -> {r.status_code} {r.text[:100]}"


# ------------------------------------------- cross-tenant id confusion

def test_foreign_ids_under_member_paths_are_404(admin_api, org_b_full):
    """Admin belongs to BOTH orgs. org-B object ids addressed through the
    shim org's path (and shim ids through org B's path) must 404 — the id
    is scoped to the path site, not to the caller."""
    b = org_b_full
    shim_tag = admin_api.get(_v2(O, S, "/tags")).json()["items"][0]["id"]
    probes = [
        ("get", _v2(O, S, f"/tags/{b['tag']}/latest")),
        ("get", _v2(O, S, f"/tags/{b['tag']}/history")),
        ("post", _v2(O, S, f"/alarms/{b['alarm']}/ack"), None),
        ("patch", _v2(O, S, f"/alarm-rules/{b['rule']}"),
         {"enabled": False}),
        ("delete", _v2(O, S, f"/alarm-rules/{b['rule']}"), None),
        ("get", _v2(O, S, f"/commands/{b['command']}")),
        ("post", _v2(O, S, f"/edges/{b['edge']}/rotate"), None),
        ("post", _v2(O, S, f"/edges/{b['edge']}/disable"), None),
        ("post", _v2(O, S, "/commands"),
         {"tag_id": b["tag"], "value": True}),
        # org-B site addressed under the shim org, and the shim site
        # under org B
        ("get", f"/api/v1/orgs/{O}/sites/{b['site']}/tags"),
        ("get", f"/api/v1/orgs/{b['org']}/sites/{S}/tags"),
        # shim tag under org-B path
        ("get", _v2b(b, f"/tags/{shim_tag}/latest")),
        ("post", _v2b(b, "/commands"),
         {"tag_id": shim_tag, "value": 1.0}),
    ]
    for method, path, *rest in probes:
        payload = rest[0] if rest else None
        r = getattr(admin_api, method)(path, json=payload) \
            if payload is not None else getattr(admin_api, method)(path)
        assert r.status_code == 404, \
            f"{method.upper()} {path} -> {r.status_code} {r.text[:100]}"


def test_non_uuid_and_missing_paths_are_404(operator_api, admin_api):
    assert operator_api.get("/api/v1/orgs/not-a-uuid").status_code == 404
    assert operator_api.get(
        f"/api/v1/orgs/{O}/sites/not-a-uuid/tags").status_code == 404
    assert admin_api.get(
        f"/api/v1/orgs/{O}/sites/{uuid.uuid4()}/tags").status_code == 404
