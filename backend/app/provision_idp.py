"""Sync Keycloak runtime settings with env — `make idp`.

1. PUBLIC_URL set -> the `wds-web` client accepts redirects/origins for that
   origin (the realm JSON only knows localhost, so a real domain would fail
   with "Invalid redirect_uri").
2. The `google` identity provider, as below.

Runs inside the backend container (`docker compose exec backend python -m
app.provision_idp`). GOOGLE_CLIENT_ID + GOOGLE_CLIENT_SECRET set -> create or
update the IdP; unset -> delete it, so Google sign-in is OFF by default and
the realm JSON never carries a secret. Idempotent.

Keycloak brokers Google and issues OUR realm tokens, so JWT verification is
unchanged. A first Google login creates a realm user (email/name imported by
the built-in Google mapper); authorization still requires a `memberships`
row — no roles are granted here.
"""

from __future__ import annotations

import logging
import urllib.error

from . import config
from .seed_oidc import ADMIN, ADMIN_PW, KC_URL, REALM, _admin_req, _post_form, _wait_keycloak

log = logging.getLogger("backend.provision_idp")
ALIAS = "google"


def idp_representation(client_id: str, client_secret: str) -> dict:
    return {
        "alias": ALIAS,
        "providerId": "google",
        "enabled": True,
        # Google only returns verified addresses; without this Keycloak would
        # demand an email verification step and we ship no SMTP.
        "trustEmail": True,
        "firstBrokerLoginFlowAlias": "first broker login",
        "config": {
            "clientId": client_id,
            "clientSecret": client_secret,
            "defaultScope": "openid email profile",
            "syncMode": "IMPORT",
        },
    }


def web_client_with_origin(rep: dict, public_url: str) -> dict:
    """Return the wds-web client rep with public_url added (idempotent)."""
    origin = public_url.rstrip("/")
    out = dict(rep)
    out["redirectUris"] = sorted(set(rep.get("redirectUris") or []) | {f"{origin}/*"})
    out["webOrigins"] = sorted(set(rep.get("webOrigins") or []) | {origin})
    attrs = dict(rep.get("attributes") or {})
    logout = set(filter(None, (attrs.get("post.logout.redirect.uris") or "").split("##")))
    attrs["post.logout.redirect.uris"] = "##".join(sorted(logout | {f"{origin}/*"}))
    out["attributes"] = attrs
    return out


def sync_web_client(tok: str, public_url: str) -> None:
    clients = _admin_req("GET", f"{KC_URL}/admin/realms/{REALM}/clients?clientId=wds-web", tok)
    if not clients:
        raise SystemExit("wds-web client missing from realm — was the realm imported?")
    url = f"{KC_URL}/admin/realms/{REALM}/clients/{clients[0]['id']}"
    _admin_req("PUT", url, tok, web_client_with_origin(_admin_req("GET", url, tok), public_url))
    log.info("wds-web client allows %s", public_url)


def main() -> None:
    _wait_keycloak()
    tok = _post_form(
        f"{KC_URL}/realms/master/protocol/openid-connect/token",
        {"grant_type": "password", "client_id": "admin-cli",
         "username": ADMIN, "password": ADMIN_PW})["access_token"]
    if config.PUBLIC_URL:
        sync_web_client(tok, config.PUBLIC_URL)
    base = f"{KC_URL}/admin/realms/{REALM}/identity-provider/instances"
    try:
        _admin_req("GET", f"{base}/{ALIAS}", tok)
        exists = True
    except urllib.error.HTTPError as e:
        if e.code != 404:
            raise
        exists = False

    if not config.IDPS:
        if exists:
            _admin_req("DELETE", f"{base}/{ALIAS}", tok)
        log.info("google idp disabled (GOOGLE_CLIENT_ID/SECRET unset)")
        return
    rep = idp_representation(config.GOOGLE_CLIENT_ID, config.GOOGLE_CLIENT_SECRET)
    if exists:
        _admin_req("PUT", f"{base}/{ALIAS}", tok, rep)
    else:
        _admin_req("POST", base, tok, rep)
    log.info("google idp provisioned")


if __name__ == "__main__":
    logging.basicConfig(level="INFO")
    main()
