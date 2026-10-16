"""Dev realm: self-registration on (Phase 1.1), but no SMTP so no email verification;
direct grants stay on for the test harness (prod realm turns them off)."""

import json
from pathlib import Path

_r = json.loads((Path(__file__).resolve().parents[2] / "infra" / "keycloak" / "realm-wds.json").read_text(encoding="utf-8"))


def test_dev_realm_allows_registration_without_email_verification():
    assert _r["registrationAllowed"] is True
    assert _r["verifyEmail"] is False
    assert _r["duplicateEmailsAllowed"] is False


def test_dev_realm_still_allows_direct_grants_for_the_test_harness():
    web = next(c for c in _r["clients"] if c["clientId"] == "wds-web")
    assert web["directAccessGrantsEnabled"] is True
