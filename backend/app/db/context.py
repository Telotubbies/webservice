"""Tenant / user context — the ONLY module allowed to write `app.*` settings.

ADR-13 §2: context is set with set_config(name, value, is_local => true)
inside an explicit transaction, so it ends with the transaction and can never
leak to the next user of a pooled connection.
`tests/tenancy/test_rls.py::test_single_call_site` enforces that no other
source file calls set_config on these settings.

Repository code receives a `TenantConn` (only constructible here), which makes
"forgot to scope" a type error instead of a silent cross-tenant query.
"""

from __future__ import annotations

from contextlib import asynccontextmanager
from dataclasses import dataclass
from typing import AsyncIterator
from uuid import UUID

import asyncpg


@dataclass(frozen=True)
class TenantConn:
    conn: asyncpg.Connection
    org_id: UUID

    # thin pass-throughs so call sites read naturally
    async def fetch(self, sql: str, *args):
        return await self.conn.fetch(sql, *args)

    async def fetchrow(self, sql: str, *args):
        return await self.conn.fetchrow(sql, *args)

    async def fetchval(self, sql: str, *args):
        return await self.conn.fetchval(sql, *args)

    async def execute(self, sql: str, *args):
        return await self.conn.execute(sql, *args)

    async def executemany(self, sql: str, args):
        return await self.conn.executemany(sql, args)


def _require_uuid(value: UUID, what: str) -> str:
    # Refuse str/None/empty: an empty setting would fail closed anyway, but a
    # caller passing junk is a bug we want loudly, not as "0 rows".
    if not isinstance(value, UUID):
        raise TypeError(f"{what} must be uuid.UUID, got {type(value).__name__}")
    return str(value)


@asynccontextmanager
async def tenant_tx(pool: asyncpg.Pool, org_id: UUID,
                    user_id: UUID | None = None) -> AsyncIterator[TenantConn]:
    """Transaction scoped to one organization (RLS `tenant_isolation`)."""
    org = _require_uuid(org_id, "org_id")
    async with pool.acquire() as conn:
        async with conn.transaction():
            await conn.execute("SELECT set_config('app.org_id', $1, true)", org)
            if user_id is not None:
                await conn.execute("SELECT set_config('app.user_id', $1, true)",
                                   _require_uuid(user_id, "user_id"))
            yield TenantConn(conn, org_id)


@asynccontextmanager
async def user_tx(pool: asyncpg.Pool, user_id: UUID) -> AsyncIterator[asyncpg.Connection]:
    """Transaction scoped to one user: own memberships + member orgs only."""
    uid = _require_uuid(user_id, "user_id")
    async with pool.acquire() as conn:
        async with conn.transaction():
            await conn.execute("SELECT set_config('app.user_id', $1, true)", uid)
            yield conn


@asynccontextmanager
async def invite_tx(pool: asyncpg.Pool, token_hash: str) -> AsyncIterator[asyncpg.Connection]:
    """Transaction that may read exactly the invite matching `token_hash`."""
    if not (isinstance(token_hash, str) and len(token_hash) == 64):
        raise ValueError("token_hash must be a sha256 hex digest")
    async with pool.acquire() as conn:
        async with conn.transaction():
            await conn.execute("SELECT set_config('app.invite_hash', $1, true)", token_hash)
            yield conn


@asynccontextmanager
async def global_tx(pool: asyncpg.Pool) -> AsyncIterator[asyncpg.Connection]:
    """No tenant context: only global tables (users, revoked_sessions) and the
    wds_system pre-context lookups are visible. Tenant tables return 0 rows."""
    async with pool.acquire() as conn:
        async with conn.transaction():
            yield conn


async def active_org_ids(system_pool: asyncpg.Pool) -> list[UUID]:
    """Every live (non-deleted) org id — the wds_system pre-context
    enumeration (``system_org_list`` policy + ``SELECT (id, deleted_at)``
    column grant, ADR-13 §3.3). Used by system sweeps that must visit each
    tenant: registry refresh, alarm/insight engines, command restart sweep.
    Must be called on the SYSTEM pool — on ``wds_app`` this returns [] (fail
    closed), never a leak."""
    async with global_tx(system_pool) as conn:
        rows = await conn.fetch(
            "SELECT id FROM organizations WHERE deleted_at IS NULL ORDER BY id")
    return [r["id"] for r in rows]
