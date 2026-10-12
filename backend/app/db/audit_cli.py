"""`python -m app.db.audit_cli` — verify every org's audit hash chain (doc 18 §4)."""

from __future__ import annotations

import asyncio
import sys

from . import audit
from .pool import create_pools


async def _main() -> int:
    pools = await create_pools(min_size=1, max_size=2)
    try:
        breaks = await audit.verify(pools.system)
    finally:
        await pools.close()
    for b in breaks:
        print(f"BREAK org={b.org_id} seq={b.seq}: {b.reason}")
    print("audit chains intact" if not breaks else f"{len(breaks)} break(s) found")
    return 1 if breaks else 0


if __name__ == "__main__":
    sys.exit(asyncio.run(_main()))
