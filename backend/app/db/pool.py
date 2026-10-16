"""asyncpg pools — one per runtime DB role (ADR-13 §1).

asyncpg resets every connection on release (`RESET ALL`, `UNLISTEN *`,
advisory unlock), so a pooled connection can't carry `app.*` settings into
the next borrower even if a transaction were somehow skipped. Context is
transaction-local anyway (context.py); the reset is defense in depth.
"""

from __future__ import annotations

import json
import os
from dataclasses import dataclass

import asyncpg

from ..core import config


async def _init_conn(conn: asyncpg.Connection) -> None:
    for typ in ("json", "jsonb"):
        await conn.set_type_codec(
            typ, schema="pg_catalog",
            encoder=lambda v: json.dumps(v, separators=(",", ":"), allow_nan=False),
            decoder=json.loads,
        )


@dataclass
class Pools:
    app: asyncpg.Pool       # wds_app — API request path
    system: asyncpg.Pool    # wds_system — ingest, sweeper, relay, reconciler

    async def close(self) -> None:
        await self.app.close()
        await self.system.close()


def _dsn_password(dsn: str) -> str | None:
    import urllib.parse
    try:
        return urllib.parse.urlsplit(dsn).password
    except ValueError:
        return None


async def create_pools(app_dsn: str | None = None, system_dsn: str | None = None,
                       min_size: int = 1, max_size: int = 10) -> Pools:
    # Passwords can come from a mounted file / env instead of the DSN string
    # (v4 T7: compose ships password-less DSNs so `docker inspect` stays
    # clean). The override applies whenever the DSN doesn't embed one.
    app_dsn = app_dsn or os.environ["WDS_APP_DSN"]
    system_dsn = system_dsn or os.environ["WDS_SYSTEM_DSN"]
    app_pw = None if _dsn_password(app_dsn) else config.WDS_APP_PASSWORD
    sys_pw = None if _dsn_password(system_dsn) else config.WDS_SYSTEM_PASSWORD
    kw = dict(min_size=min_size, max_size=max_size, init=_init_conn,
              command_timeout=10, server_settings={"application_name": "wds-backend"})
    return Pools(
        app=await asyncpg.create_pool(app_dsn, password=app_pw, **kw),
        system=await asyncpg.create_pool(system_dsn, password=sys_pw, **kw),
    )
