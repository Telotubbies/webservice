"""MFA policy + step-up (spec 2026-10-19 §4): org gate, command step-up,
API key allow_control, and the realm flow that produces acr/auth_time."""

import json
import time
import uuid
from pathlib import Path

import pytest
from fastapi import HTTPException

from app import deps
from app.core import config
from app.iam.auth import Principal
from app.iam.security import ForbiddenError

ORG = uuid.uuid4()
ROOT = Path(__file__).resolve().parents[2]


def oidc(**kw) -> Principal:
    base = dict(user="u", role="operator", kind="oidc", sub="u", sid="s",
                org_roles=((ORG, "operator"),))
    return Principal(**{**base, **kw})


def test_mfa_org_rejects_password_only_token():
    with pytest.raises(HTTPException) as e:
        deps.mfa_gate(oidc(mfa_orgs=frozenset({ORG}), acr="pwd"), ORG)
    assert e.value.status_code == 401 and e.value.detail == "mfa_required"


def test_mfa_org_accepts_mfa_token_and_other_orgs_are_unaffected():
    deps.mfa_gate(oidc(mfa_orgs=frozenset({ORG}), acr="mfa"), ORG)
    deps.mfa_gate(oidc(acr="pwd"), ORG)


def test_v2_org_applies_the_gate():
    with pytest.raises(HTTPException) as e:
        deps._v2_org(str(ORG), oidc(mfa_orgs=frozenset({ORG}), acr="pwd"))
    assert e.value.detail == "mfa_required"


@pytest.fixture
def stepup_on(monkeypatch):
    monkeypatch.setattr(config, "STEPUP_REQUIRED", True)


def test_step_up_needs_fresh_mfa(stepup_on):
    deps.step_up(oidc(acr="mfa", auth_time=time.time() - 10))
    for p in (oidc(acr="pwd", auth_time=time.time()),
              oidc(acr="mfa", auth_time=time.time() - config.STEPUP_MAX_AGE_S - 5)):
        with pytest.raises(HTTPException) as e:
            deps.step_up(p)
        assert e.value.detail == "step_up_required"


def test_api_key_needs_allow_control(stepup_on):
    with pytest.raises(ForbiddenError):
        deps.step_up(oidc(kind="apikey"))
    deps.step_up(oidc(kind="apikey", allow_control=True))


def test_step_up_is_always_on_outside_dev_and_test():
    src = (ROOT / "backend/app/core/config.py").read_text(encoding="utf-8")
    assert 'STEPUP_REQUIRED = APP_ENV not in ("dev", "test") or' in src


@pytest.mark.parametrize("realm", ["keycloak", "keycloak-prod"])
def test_realm_step_up_flow(realm):
    r = json.loads((ROOT / "infra" / realm / "realm-wds.json").read_text(encoding="utf-8"))
    assert r["browserFlow"] == "browser-loa"
    assert json.loads(r["attributes"]["acr.loa.map"]) == {"pwd": 1, "mfa": 2}
    assert "length(12)" in r["passwordPolicy"]
    assert (r["otpPolicyType"], r["otpPolicyDigits"], r["otpPolicyPeriod"]) == ("totp", 6, 30)
    flows = {f["alias"]: f for f in r["authenticationFlows"]}
    l2 = [e.get("authenticator") for e in flows["browser-loa level2"]["authenticationExecutions"]]
    assert l2 == ["conditional-level-of-authentication", "auth-otp-form"]
    web = next(c for c in r["clients"] if c["clientId"] == "wds-web")
    assert "acr" in web["defaultClientScopes"]
    assert any(m["config"].get("claim.name") == "auth_time" for m in web["protocolMappers"])
