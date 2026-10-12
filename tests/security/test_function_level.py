"""OWASP API5 — Broken Function Level Authorization (v4 T13).

demo-viewer is a real member of the shim org with role=viewer: every
admin/operator function must answer 403 (member, wrong band — distinct
from the non-member 404). The admin/operator control proves the route
itself works, so a 403 is the gate firing, not a broken route.

Viewer probes are sequenced before the operator mutation burn in
test_ratelimit_proof — these POSTs are denied BEFORE the mutation gate,
so they spend no budget.
"""

from __future__ import annotations

import uuid

import pytest

pytestmark = [pytest.mark.integration, pytest.mark.security]

from conftest import (  # noqa: E402
    ORG_ID as V1_ORG, SITE_ID as V1_SITE, TAGS,
)
from security.conftest import ADMIN_UID, VIEWER_UID  # noqa: E402

O, S = str(V1_ORG), str(V1_SITE)
ANY = str(uuid.uuid4())


def _v2(suffix=""):
    return f"/api/v1/orgs/{O}/sites/{S}{suffix}"


# ------------------------------------------------------- admin band (403)

def test_viewer_denied_member_ops(viewer_api):
    assert viewer_api.get(f"/api/v1/orgs/{O}/members").status_code == 403
    assert viewer_api.patch(
        f"/api/v1/orgs/{O}/members/{VIEWER_UID}",
        json={"role": "operator"}).status_code == 403
    assert viewer_api.delete(
        f"/api/v1/orgs/{O}/members/{ADMIN_UID}").status_code == 403


def test_viewer_denied_invite_ops(viewer_api):
    assert viewer_api.get(f"/api/v1/orgs/{O}/invites").status_code == 403
    assert viewer_api.post(
        f"/api/v1/orgs/{O}/invites",
        json={"email": "x@y.z", "role": "viewer"}).status_code == 403
    assert viewer_api.delete(
        f"/api/v1/orgs/{O}/invites/{ANY}").status_code == 403


def test_viewer_denied_audit_export(viewer_api):
    r = viewer_api.get(f"/api/v1/orgs/{O}/audit")
    assert r.status_code == 403


def test_viewer_denied_rule_crud(viewer_api):
    assert viewer_api.post(
        _v2("/alarm-rules"),
        json={"name": "x", "tag_id": ANY, "kind": "hi", "threshold": 1,
              "severity": "info"}).status_code == 403
    assert viewer_api.patch(_v2(f"/alarm-rules/{ANY}"),
                            json={"enabled": False}).status_code == 403
    assert viewer_api.delete(_v2(f"/alarm-rules/{ANY}")).status_code == 403


def test_viewer_denied_edge_ops(viewer_api):
    assert viewer_api.post(_v2("/edges"),
                           json={"name": "evil"}).status_code == 403
    assert viewer_api.post(_v2(f"/edges/{ANY}/rotate")).status_code == 403
    assert viewer_api.post(_v2(f"/edges/{ANY}/disable")).status_code == 403


# ----------------------------------------------------- operator band (403)

def test_viewer_denied_commands_and_ack(viewer_api):
    assert viewer_api.post(
        "/api/commands",
        json={"tag": TAGS["running"], "value": True}).status_code == 403
    assert viewer_api.post(
        _v2("/commands"),
        json={"tag_id": ANY, "value": 1.0}).status_code == 403
    # command reads are operator-scoped too (command:read)
    assert viewer_api.get("/api/commands").status_code == 403
    assert viewer_api.get(_v2("/commands")).status_code == 403
    assert viewer_api.get(_v2(f"/commands/{ANY}")).status_code == 403
    # alarm ack is operate-band on both surfaces
    assert viewer_api.post(f"/api/alarms/{ANY}/ack").status_code == 403
    assert viewer_api.post(_v2(f"/alarms/{ANY}/ack")).status_code == 403
    # detail health is operator+ (coarse /api/health stays public)
    assert viewer_api.get("/api/system/health").status_code == 403


def test_viewer_retains_member_reads(viewer_api):
    """Control: viewer keeps site:read — a 403 matrix is only meaningful
    while reads still work."""
    assert viewer_api.get("/api/tags").status_code == 200
    assert viewer_api.get(_v2("/tags")).status_code == 200
    assert viewer_api.get(_v2("/alarms")).status_code == 200
    assert viewer_api.get(_v2("/insights")).status_code == 200
    assert viewer_api.get(_v2("/alarm-rules")).status_code == 200
    assert viewer_api.get(_v2("/edges")).status_code == 200
    assert viewer_api.get(f"/api/v1/orgs/{O}").status_code == 200


def test_admin_control_passes(admin_api):
    """The routes exist and the admin band opens them."""
    assert admin_api.get(f"/api/v1/orgs/{O}/members").status_code == 200
    assert admin_api.get(f"/api/v1/orgs/{O}/invites").status_code == 200
    assert admin_api.get(f"/api/v1/orgs/{O}/audit").status_code == 200
    assert admin_api.get("/api/system/health").status_code == 200
