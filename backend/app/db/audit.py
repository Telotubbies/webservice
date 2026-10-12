"""Append-only audit log helpers (doc 18 §4).

Writes go through the DB trigger `audit_chain`, which assigns the per-org
`seq` and the sha256 chain under an advisory lock — application code cannot
choose `seq`, `at`, `prev_hash` or `hash`.
"""

from __future__ import annotations

from dataclasses import dataclass
from uuid import UUID

import asyncpg

from .context import TenantConn, global_tx, tenant_tx


async def append(tc: TenantConn, actor: str, action: str,
                 target: dict | None = None, detail: dict | None = None) -> None:
    await tc.execute(
        "INSERT INTO audit_log(org_id, actor, action, target, detail) VALUES ($1,$2,$3,$4,$5)",
        tc.org_id, actor, action, target, detail,
    )


@dataclass
class ChainBreak:
    org_id: UUID
    seq: int
    reason: str


async def verify(system_pool: asyncpg.Pool) -> list[ChainBreak]:
    """Recompute every org's chain. Returns breaks (empty = intact)."""
    async with global_tx(system_pool) as conn:
        orgs = [r["id"] for r in await conn.fetch("SELECT id FROM organizations")]
    breaks: list[ChainBreak] = []
    for org in orgs:
        async with tenant_tx(system_pool, org) as tc:
            rows = await tc.fetch(
                "SELECT seq, prev_hash, hash,"
                " audit_row_hash(prev_hash, org_id, seq, at, actor, action, target, detail)"
                "   AS recomputed"
                " FROM audit_log WHERE org_id = $1 ORDER BY seq", org)
        prev, expect_seq = None, 1
        for r in rows:
            if r["seq"] != expect_seq:
                breaks.append(ChainBreak(org, r["seq"], f"gap: expected seq {expect_seq}"))
            if r["prev_hash"] != prev:
                breaks.append(ChainBreak(org, r["seq"], "prev_hash does not link"))
            if r["recomputed"] != r["hash"]:
                breaks.append(ChainBreak(org, r["seq"], "hash mismatch (row altered)"))
            prev, expect_seq = r["hash"], r["seq"] + 1
    return breaks
