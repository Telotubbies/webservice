"""Offline tests for the org-scope / MFA / step-up gates in app.deps.

These are the tenancy and equipment-safety gates: a non-member must see 404
(no existence oracle), a viewer must not operate, and commands need fresh MFA.
"""

import asyncio
import sys
import time
from pathlib import Path
from types import SimpleNamespace
from uuid import uuid4

import pytest
from fastapi import HTTPException

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "backend"))

from app import deps
from app.core import config
from app.iam.auth import Principal
from app.iam.security import ForbiddenError

ORG = uuid4()
OTHER = uuid4()


def P(role="operator", **kw):
    kw.setdefault("kind", "oidc")
    return Principal(user="u", role=role, org_roles=((ORG, role),), **kw)


def test_non_member_and_bad_uuid_are_both_404():
    for org in (str(OTHER), "not-a-uuid"):
        with pytest.raises(HTTPException) as e:
            deps._v2_org(org, P())
        assert e.value.status_code == 404


def test_viewer_cannot_operate_or_configure():
    v = P("viewer")
    assert deps._v2_org(str(ORG), v) == ORG
    with pytest.raises(ForbiddenError):
        deps._v2_org(str(ORG), v, deps._OPERATE)
    with pytest.raises(ForbiddenError):
        deps._v2_org(str(ORG), P("operator"), deps._CONFIG)
    assert deps._v2_org(str(ORG), P("admin"), deps._CONFIG) == ORG


def test_mfa_required_org_rejects_non_mfa_token():
    with pytest.raises(HTTPException) as e:
        deps.mfa_gate(P(mfa_orgs=frozenset({ORG})), ORG)
    assert e.value.detail == "mfa_required"
    deps.mfa_gate(P(mfa_orgs=frozenset({ORG}), acr="mfa"), ORG)
    deps.mfa_gate(P(kind="apikey", mfa_orgs=frozenset({ORG})), ORG)


def test_step_up(monkeypatch):
    monkeypatch.setattr(config, "STEPUP_REQUIRED", True)
    monkeypatch.setattr(config, "STEPUP_MAX_AGE_S", 300)
    with pytest.raises(ForbiddenError):
        deps.step_up(P(kind="apikey", allow_control=False))
    deps.step_up(P(kind="apikey", allow_control=True))
    with pytest.raises(HTTPException) as e:
        deps.step_up(P(acr="pwd"))
    assert e.value.detail == "step_up_required"
    with pytest.raises(HTTPException):  # MFA but stale
        deps.step_up(P(acr="mfa", auth_time=time.time() - 3600))
    deps.step_up(P(acr="mfa", auth_time=time.time()))
    monkeypatch.setattr(config, "STEPUP_REQUIRED", False)
    deps.step_up(P(acr="pwd"))


def test_effective_roles_fall_back_to_shim_org():
    p = Principal(user="u", role="operator", kind="dev")
    assert deps._effective_org_roles(p) == {config.V1_ORG_ID: "operator"}
    assert deps._effective_org_roles(Principal(user="u", role="none")) == {}


class Reg:
    def __init__(self, tag=None, site_org=None):
        self.tag, self._site_org = tag, site_org

    async def maybe_refresh(self): ...
    async def refresh(self): ...
    def by_id(self, _): return self.tag
    def site_org(self, _): return self._site_org


def _req(registry, headers=None):
    st = SimpleNamespace(registry=registry)
    return SimpleNamespace(app=SimpleNamespace(state=SimpleNamespace(st=st)),
                           headers=headers or {})


def test_tag_of_another_tenant_is_404():
    site = uuid4()
    other = SimpleNamespace(org_id=OTHER, site_id=site)
    with pytest.raises(HTTPException) as e:
        asyncio.run(deps._v2_tag_or_404(_req(Reg(other)), ORG, site, str(uuid4())))
    assert e.value.status_code == 404
    mine = SimpleNamespace(org_id=ORG, site_id=site)
    assert asyncio.run(deps._v2_tag_or_404(_req(Reg(mine)), ORG, site, str(uuid4()))) is mine


def test_v1_scope_headers_pair_and_membership(monkeypatch):
    async def auth(_): return P()
    monkeypatch.setattr(deps, "_authenticate", auth)
    site = str(uuid4())
    reg = Reg(site_org=OTHER)
    with pytest.raises(HTTPException) as e:  # only one header
        asyncio.run(deps._scope(_req(reg, {"x-wds-org": str(ORG)})))
    assert e.value.status_code == 400
    with pytest.raises(HTTPException) as e:  # site belongs to a different org
        asyncio.run(deps._scope(_req(reg, {"x-wds-org": str(ORG), "x-wds-site": site})))
    assert e.value.status_code == 404
    with pytest.raises(HTTPException) as e:  # org the caller is not in
        asyncio.run(deps._scope(_req(reg, {"x-wds-org": str(OTHER), "x-wds-site": site})))
    assert e.value.status_code == 404
    sc = asyncio.run(deps._scope(_req(Reg(site_org=ORG), {"x-wds-org": str(ORG), "x-wds-site": site})))
    assert sc.org_id == ORG and sc.can_operate
