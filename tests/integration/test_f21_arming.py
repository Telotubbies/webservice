"""F21: AI may write to a PLC only when the plan allows it AND a person approved this site.

Offline: the gate the edge caches (gate_for_cfg) for every combination (security test T2: no arming
record -> ai_plc_write stays off). Live: the arming API (roles, evidence, double-arm, disarm, audit).
"""

import asyncio
import uuid

import pytest

from app.vision import rulecfg


class FakeTc:
    def __init__(self, control, plan_limits, armed):
        self.control, self.plan_limits, self.armed = control, plan_limits, armed

    async def fetchrow(self, sql, *a):
        return {"control_enabled": self.control}

    async def fetchval(self, sql, *a):
        return self.armed if "site_ai_arming" in sql else self.plan_limits


def _gate(control, plan_limits, armed):
    return asyncio.run(rulecfg.gate_for_cfg(FakeTc(control, plan_limits, armed), uuid.uuid4(), uuid.uuid4()))


@pytest.mark.parametrize("flag", [True, False, None])
@pytest.mark.parametrize("armed", [True, False])
def test_ai_plc_write_needs_plan_flag_and_site_approval(flag, armed):
    limits = {} if flag is None else {"ai_plc_write": flag}
    g = _gate(True, limits, armed)
    assert g["ai_plc_write"] is (flag is True and armed)


def test_missing_arming_record_blocks_ai_write_even_with_the_flag():          # T2
    assert _gate(True, {"ai_plc_write": True}, False)["ai_plc_write"] is False


def test_arming_alone_never_enables_ai_write_without_the_plan_flag():
    assert _gate(True, {}, True)["ai_plc_write"] is False


def test_site_control_switch_is_reported_independently():
    assert _gate(False, {"ai_plc_write": True}, True)["control_enabled"] is False
    assert _gate(True, {}, False)["control_enabled"] is True


# ---------------- live ----------------

def _client(base_url, token):
    httpx = pytest.importorskip("httpx")
    return httpx.Client(base_url=base_url, timeout=15.0, headers={"Authorization": f"Bearer {token}"})


@pytest.mark.integration
def test_arming_lifecycle_roles_and_audit(base_url):
    from conftest import ADMIN_TOKEN, OPERATOR_TOKEN, ORG_ID, SITE_ID, VIEWER_TOKEN
    url = f"/api/v1/orgs/{ORG_ID}/sites/{SITE_ID}/ai-arming"
    with _client(base_url, ADMIN_TOKEN) as a, _client(base_url, VIEWER_TOKEN) as v, _client(base_url, OPERATOR_TOKEN) as o:
        a.delete(url)                                                   # clean slate (404 when not armed)
        assert a.get(url).json() == {"armed": False, "arming": None}
        assert v.get(url).status_code == 200                            # anyone in the org can see the state
        assert v.post(url, json={"evidence_ref": "dry-run review"}).status_code == 403
        assert o.post(url, json={"evidence_ref": "dry-run review"}).status_code == 403      # approval is an admin act
        assert a.post(url, json={"evidence_ref": "ab"}).status_code in (400, 422)           # evidence is required
        assert a.post(url, json={}).status_code in (400, 422)
        r = a.post(url, json={"evidence_ref": "dry-run review 2026-11-03"})
        assert r.status_code == 201, r.text
        assert r.json()["arming"]["evidence_ref"] == "dry-run review 2026-11-03"
        assert a.post(url, json={"evidence_ref": "second try"}).status_code == 409           # already armed
        assert a.get(url).json()["armed"] is True
        assert v.delete(url).status_code == 403
        assert a.delete(url).status_code == 204
        assert a.delete(url).status_code == 404                                              # nothing left to withdraw
        assert a.get(url).json()["armed"] is False
        for act in ("ai.site.armed", "ai.site.disarmed"):
            rows = a.get(f"/api/v1/orgs/{ORG_ID}/audit", params={"action": act}).json()["items"]
            assert rows and rows[-1]["actor"].startswith("user:"), act


@pytest.mark.integration
def test_arming_of_another_orgs_site_is_not_possible(base_url):
    from conftest import ADMIN_TOKEN, ORG_ID
    with _client(base_url, ADMIN_TOKEN) as a:
        r = a.post(f"/api/v1/orgs/{ORG_ID}/sites/{uuid.uuid4()}/ai-arming", json={"evidence_ref": "not my site"})
    assert r.status_code == 404
