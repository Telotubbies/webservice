"""Sync Keycloak runtime settings with env — `make idp`.

1. PUBLIC_URL set -> the `wds-web` client accepts redirects/origins for that
   origin (the realm JSON only knows localhost, so a real domain would fail
   with "Invalid redirect_uri").
2. The `google` and `microsoft` identity providers, as below.

Runs inside the backend container (`docker compose exec backend python -m
app.ops.provision_idp`). <PROVIDER>_CLIENT_ID + <PROVIDER>_CLIENT_SECRET set ->
create or update that IdP; unset -> delete it, so social sign-in is OFF by
default and the realm JSON never carries a secret. Idempotent.

Keycloak brokers the provider and issues OUR realm tokens, so JWT
verification is unchanged. A first social login creates a realm user
(email/name imported by the built-in mapper); authorization still requires
a `memberships` row — no roles are granted here.
"""

from __future__ import annotations

import logging
import urllib.error

from ..core import config
from .seed_oidc import ADMIN, ADMIN_PW, KC_URL, REALM, _admin_req, _post_form, _wait_keycloak

log = logging.getLogger("backend.provision_idp")


def idp_representation(alias: str, client_id: str, client_secret: str) -> dict:
    return {
        "alias": alias,
        "providerId": alias,
        "enabled": True,
        # Google/Microsoft return verified addresses; without this Keycloak
        # would demand an email verification step and we ship no SMTP.
        "trustEmail": True,
        "firstBrokerLoginFlowAlias": "first broker login",
        "config": {
            "clientId": client_id,
            "clientSecret": client_secret,
            "defaultScope": "openid email profile",
            "syncMode": "IMPORT",
        },
    }


# alias -> (client id, client secret) from env; empty pair = disabled
def _wanted_idps() -> dict[str, tuple[str, str]]:
    out: dict[str, tuple[str, str]] = {}
    if config.GOOGLE_CLIENT_ID and config.GOOGLE_CLIENT_SECRET:
        out["google"] = (config.GOOGLE_CLIENT_ID, config.GOOGLE_CLIENT_SECRET)
    if config.MICROSOFT_CLIENT_ID and config.MICROSOFT_CLIENT_SECRET:
        out["microsoft"] = (config.MICROSOFT_CLIENT_ID, config.MICROSOFT_CLIENT_SECRET)
    return out


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


def _sync_idp(tok: str, base: str, alias: str, wanted: tuple[str, str] | None) -> None:
    try:
        _admin_req("GET", f"{base}/{alias}", tok)
        exists = True
    except urllib.error.HTTPError as e:
        if e.code != 404:
            raise
        exists = False

    if wanted is None:
        if exists:
            _admin_req("DELETE", f"{base}/{alias}", tok)
            log.info("%s idp removed (env unset)", alias)
        else:
            log.info("%s idp disabled (env unset)", alias)
        return

    rep = idp_representation(alias, *wanted)
    if exists:
        _admin_req("PUT", f"{base}/{alias}", tok, rep)
    else:
        _admin_req("POST", base, tok, rep)
    log.info("%s idp provisioned", alias)


def main() -> None:
    _wait_keycloak()
    tok = _post_form(
        f"{KC_URL}/realms/master/protocol/openid-connect/token",
        {"grant_type": "password", "client_id": "admin-cli",
         "username": ADMIN, "password": ADMIN_PW})["access_token"]
    if config.PUBLIC_URL:
        sync_web_client(tok, config.PUBLIC_URL)
    base = f"{KC_URL}/admin/realms/{REALM}/identity-provider/instances"
    wanted = _wanted_idps()
    for alias in ("google", "microsoft"):
        _sync_idp(tok, base, alias, wanted.get(alias))


if __name__ == "__main__":
    logging.basicConfig(level="INFO")
    main()
