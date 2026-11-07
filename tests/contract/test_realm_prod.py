"""Prod Keycloak realm must carry no dev allowances (roadmap 0.5)."""

from __future__ import annotations

import json
from pathlib import Path

REALM = Path(__file__).resolve().parents[2] / "infra" / "keycloak-prod" / "realm-wds.json"
_r = json.loads(REALM.read_text(encoding="utf-8"))


def _web():
    return next(c for c in _r["clients"] if c["clientId"] == "wds-web")


def test_prod_realm_has_no_dev_origins():
    raw = REALM.read_text(encoding="utf-8")
    for bad in ("localhost", "127.0.0.1", ":5199", ":5173"):
        assert bad not in raw, bad


def test_prod_realm_origins_come_from_one_variable():
    w = _web()
    assert w["redirectUris"] == ["${WDS_WEB_ORIGIN}/*"]
    assert w["webOrigins"] == ["${WDS_WEB_ORIGIN}"]


def test_prod_realm_disables_direct_grants():
    assert all(c["directAccessGrantsEnabled"] is False for c in _r["clients"])


def test_prod_realm_requires_pkce():
    assert _web()["attributes"]["pkce.code.challenge.method"] == "S256"


def test_prod_realm_requires_verified_email_and_https():
    assert _r["verifyEmail"] is True
    assert _r["sslRequired"] == "all"
    assert _r["registrationAllowed"] is False  # F21: no open sign-up; people join by invitation or SSO
    assert _r["duplicateEmailsAllowed"] is False


def test_prod_realm_has_no_seeded_users():
    assert not _r.get("users")


def test_prod_realm_social_login_only_links_existing_users():
    flows = {f["alias"]: f for f in _r["authenticationFlows"]}
    assert _r["firstBrokerLoginFlow"] == "wds-link-only"
    used = {e.get("authenticator") for f in flows.values() if f["alias"].startswith("wds-link-only")
            for e in f["authenticationExecutions"]}
    assert "idp-create-user-if-unique" not in used and "idp-detect-existing-broker-user" in used
