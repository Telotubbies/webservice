"""Onboard a customer on a production deployment (idempotent).

    docker compose exec backend python -m app.ops.bootstrap \\
        --org "Acme Aggregates" --site "Plant 1" --site-code P1 \\
        --timezone Asia/Bangkok --owner-email boss@acme.com

Creates the organization and its first site, then makes the owner: the
person must have signed in once (Google or company SSO) so a `users` row with
that VERIFIED email exists — invites can't grant `owner` (schema CHECK), and
binding by verified email is the same rule invite-accept uses. If they haven't
signed in yet the command says so; run it again afterwards. Re-running never
duplicates anything and never demotes an existing member.
"""

from __future__ import annotations

import argparse
import asyncio
import logging
import uuid

from ..db.context import global_tx, tenant_tx
from ..db.pool import create_pools

log = logging.getLogger("backend.bootstrap")
ORG_NS = uuid.UUID("6f1c2a52-6a0e-4a77-9b1e-3c5d0f7e8a10")  # fixed namespace for org ids


async def run(org_name: str, site_name: str, site_code: str, tz: str, owner_email: str) -> int:
    pools = await create_pools()
    try:
        async with global_tx(pools.app) as conn:
            user = await conn.fetchrow(
                "SELECT id, email_verified FROM users WHERE lower(email)=lower($1)", owner_email)
        # Deterministic id: re-runs hit the same org without a cross-tenant
        # lookup (RLS hides organizations outside a tenant transaction).
        org_id = uuid.uuid5(ORG_NS, org_name.casefold())
        async with tenant_tx(pools.app, org_id) as tc:
            await tc.execute("INSERT INTO organizations(id, name) VALUES ($1,$2)"
                             " ON CONFLICT (id) DO NOTHING", org_id, org_name)
            site_id = await tc.fetchval(
                "SELECT id FROM sites WHERE org_id=$1 AND code=$2", org_id, site_code)
            if not site_id:
                site_id = uuid.uuid4()
                await tc.execute("INSERT INTO sites(id, org_id, name, code, timezone)"
                                 " VALUES ($1,$2,$3,$4,$5)", site_id, org_id, site_name, site_code, tz)
            print(f"organization {org_name}: {org_id}\nsite {site_code}: {site_id}")
            if not user:
                print(f"owner pending: {owner_email} has not signed in yet — ask them to sign in "
                      "once, then run this command again.")
                return 2
            if not user["email_verified"]:
                print(f"owner refused: {owner_email} is not a verified email in the identity provider.")
                return 3
            # keep an existing member's role (never demote); otherwise owner
            await tc.execute("INSERT INTO memberships(org_id, user_id, role) VALUES ($1,$2,'owner')"
                             " ON CONFLICT (org_id, user_id) DO NOTHING", org_id, user["id"])
            role = await tc.fetchval("SELECT role FROM memberships WHERE org_id=$1 AND user_id=$2",
                                     org_id, user["id"])
            print(f"owner: {owner_email} is {role} of {org_name}")
            return 0
    finally:
        await pools.close()


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--org", required=True)
    ap.add_argument("--site", required=True)
    ap.add_argument("--site-code", required=True)
    ap.add_argument("--timezone", default="UTC")
    ap.add_argument("--owner-email", required=True)
    a = ap.parse_args()
    logging.basicConfig(level="INFO")
    raise SystemExit(asyncio.run(run(a.org.strip(), a.site.strip(), a.site_code.strip(),
                                     a.timezone.strip(), a.owner_email.strip())))


if __name__ == "__main__":
    main()
