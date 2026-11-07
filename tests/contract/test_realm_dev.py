"""Dev realm: self-registration on (Phase 1.1), but no SMTP so no email verification;
direct grants stay on for the test harness (prod realm turns them off)."""

import json
from pathlib import Path

_r = json.loads((Path(__file__).resolve().parents[2] / "infra" / "keycloak" / "realm-wds.json").read_text(encoding="utf-8"))


def test_dev_realm_allows_registration_without_email_verification():
    assert _r["registrationAllowed"] is False  # F21: no open sign-up; people join by invitation or SSO
    assert _r["verifyEmail"] is False
    assert _r["duplicateEmailsAllowed"] is False


def test_dev_realm_still_allows_direct_grants_for_the_test_harness():
    web = next(c for c in _r["clients"] if c["clientId"] == "wds-web")
    assert web["directAccessGrantsEnabled"] is True


def test_dev_realm_social_login_only_links_existing_users():
    r = _r
    assert r["firstBrokerLoginFlow"] == "wds-link-only"
    used = {e.get("authenticator") for f in r["authenticationFlows"] if f["alias"].startswith("wds-link-only")
            for e in f["authenticationExecutions"]}
    assert "idp-create-user-if-unique" not in used and "idp-detect-existing-broker-user" in used
