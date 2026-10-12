"""Dev provisioning for the Keycloak realm — `make seed-dev` (ADR-12 §10).

Runs INSIDE the backend container (`docker compose exec backend python -m
app.seed_oidc`) so it can reach both the compose-internal Keycloak and the
Postgres pools. For each realm test user it:

1. Sets the demo password via the admin API (passwords come from env —
   `KC_DEMO_PASSWORD` — never from code; realm JSON ships no credentials).
2. Upserts `users(sub=<kc user id>)` and a `memberships` row in the dev org
   — authorization lives in our tables, not in token claims (ADR-12 §4/§6).

Idempotent: safe to re-run after a fresh `up` or a realm re-import.
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import time
import urllib.error
import urllib.parse
import urllib.request

from . import config
from .db.context import global_tx, tenant_tx
from .db.pool import create_pools

log = logging.getLogger("backend.seed_oidc")

KC_URL = (os.environ.get("KC_INTERNAL_URL")
          or os.environ.get("KC_URL", "http://localhost:8080")).rstrip("/")
REALM = os.environ.get("KC_REALM", "wds")
ADMIN = os.environ.get("KC_ADMIN", "admin")
ADMIN_PW = os.environ.get("KC_ADMIN_PASSWORD", "admin-dev-pass")
DEMO_PW = os.environ.get("KC_DEMO_PASSWORD", "kc-demo-pass")

# realm test user -> role in the dev org (memberships table, not claims)
USERS = {
    "admin@demo": "admin",
    "operator@demo": "operator",
    "viewer@demo": "viewer",
}


def _post_form(url: str, fields: dict) -> dict:
    body = urllib.parse.urlencode(fields).encode()
    req = urllib.request.Request(
        url, data=body,
        headers={"Content-Type": "application/x-www-form-urlencoded"})
    with urllib.request.urlopen(req, timeout=10) as r:
        return json.loads(r.read())


def _admin_req(method: str, url: str, token: str, payload=None):
    data = json.dumps(payload).encode() if payload is not None else None
    req = urllib.request.Request(
        url, data=data, method=method,
        headers={"Authorization": f"Bearer {token}",
                 "Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=10) as r:
        raw = r.read()
        return json.loads(raw) if raw else None


def _wait_keycloak(timeout_s: float = 90) -> None:
    deadline = time.monotonic() + timeout_s
    url = f"{KC_URL}/realms/{REALM}/.well-known/openid-configuration"
    while True:
        try:
            with urllib.request.urlopen(url, timeout=5) as r:
                if r.status == 200:
                    return
        except Exception:  # noqa: BLE001
            pass
        if time.monotonic() > deadline:
            raise TimeoutError(f"keycloak realm '{REALM}' not reachable at {url}")
        time.sleep(2)


def _provision_users() -> dict[str, str]:
    """Set demo passwords; return username -> KC user id (the token `sub`)."""
    tok = _post_form(
        f"{KC_URL}/realms/master/protocol/openid-connect/token",
        {"grant_type": "password", "client_id": "admin-cli",
         "username": ADMIN, "password": ADMIN_PW})["access_token"]
    out = {}
    for username in USERS:
        rows = _admin_req(
            "GET", f"{KC_URL}/admin/realms/{REALM}/users"
                   f"?username={urllib.parse.quote(username)}&exact=true", tok)
        if not rows:
            raise RuntimeError(f"realm user {username!r} not found — "
                               f"is infra/keycloak/realm-wds.json imported?")
        uid = rows[0]["id"]
        _admin_req("PUT", f"{KC_URL}/admin/realms/{REALM}/users/{uid}/reset-password",
                   tok, {"type": "password", "value": DEMO_PW, "temporary": False})
        out[username] = uid
    return out


async def _grant_memberships(subs: dict[str, str]) -> None:
    pools = await create_pools(min_size=1, max_size=2)
    try:
        org = config.V1_ORG_ID
        async with global_tx(pools.app) as conn:
            for username, sub in subs.items():
                await conn.execute(
                    "INSERT INTO users(sub, email, email_verified, display_name)"
                    " VALUES ($1,$2,true,$3)"
                    " ON CONFLICT (sub) DO UPDATE SET email=excluded.email",
                    sub, username, f"Demo {username.split('@')[0].title()}")
        async with tenant_tx(pools.app, org) as tc:
            for username, sub in subs.items():
                uid = await tc.fetchval("SELECT id FROM users WHERE sub=$1", sub)
                await tc.execute(
                    "INSERT INTO memberships(org_id, user_id, role)"
                    " VALUES ($1,$2,$3)"
                    " ON CONFLICT (org_id, user_id) DO UPDATE SET role=excluded.role",
                    org, uid, USERS[username])
    finally:
        await pools.close()


async def _main() -> None:
    if config.APP_ENV != "dev":
        raise SystemExit("seed_oidc is a dev fixture — refusing under "
                         f"APP_ENV={config.APP_ENV}")
    await asyncio.to_thread(_wait_keycloak)
    subs = await asyncio.to_thread(_provision_users)
    await _grant_memberships(subs)
    for username, sub in subs.items():
        log.info("seeded oidc user", extra={"user": username, "role": USERS[username],
                                            "sub": sub})


if __name__ == "__main__":
    logging.basicConfig(level="INFO")
    asyncio.run(_main())
