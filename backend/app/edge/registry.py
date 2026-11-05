"""Tag / site / edge registry cache (read via wds_system, ADR-13 §3).

Multi-tenant (v4 T9): the cache spans EVERY org — the system pool enumerates
live org ids via the `system_org_list` policy, then loads each org's sites +
tags inside its own `tenant_tx`. Lookups are keyed by (site_id, path) — tag
paths are only unique per site, so a path-only map would let two orgs collide.

v1 tag naming: `{site_code}.{area}.{line}.{device}.{signal}` ↔ v2 `tags.path`
`area/line/device/signal` within the site. `v1_name`/`by_v1_name` stay pinned
to the seeded site (the `/api/*` compat shim); other orgs get the real site
code via `display_name`.

The edge map backs the doc 17 §4 trust rules: org/site/edge parsed from the
v2 topic are verified against the `edges` identity view before any payload is
trusted. Refreshed periodically and on provisioning, so new edges work
without a restart.
"""

import time
from dataclasses import dataclass
from uuid import UUID

from ..core import config
from ..db.context import active_org_ids, global_tx, tenant_tx

REFRESH_S = 30.0


@dataclass(frozen=True)
class Tag:
    id: UUID
    org_id: UUID
    site_id: UUID
    edge_id: UUID | None
    path: str
    name: str
    type: str
    unit: str | None
    writable: bool
    min_value: float | None
    max_value: float | None

    @property
    def v1_name(self) -> str:
        """Shim-site display name (`plant1.<dotted path>`). Correct only for
        tags of the seeded site — the v1 REST/WS surface is pinned to that
        site, so this is never emitted for another org's tag. Everything
        org-aware uses `Registry.display_name` (real site code)."""
        return f"{config.V1_SITE_CODE}.{self.path.replace('/', '.')}"


@dataclass(frozen=True)
class Edge:
    """The doc-17 identity-view fields ingest needs (wds_system is column-
    limited on edges — `name` is deliberately not selected)."""
    id: UUID
    org_id: UUID
    site_id: UUID
    status: str
    mqtt_username: str | None


def v1_name_to_path(name: str) -> str | None:
    prefix = f"{config.V1_SITE_CODE}."
    if not name.startswith(prefix):
        return None
    return name[len(prefix):].replace(".", "/")


class Registry:
    def __init__(self, pool):
        self.pool = pool
        self._by_key: dict[tuple[UUID, str], Tag] = {}   # (site_id, path)
        self._by_id: dict[UUID, Tag] = {}
        self._edges: dict[UUID, Edge] = {}
        self._sites: dict[UUID, tuple[UUID, str]] = {}   # site_id -> (org_id, code)
        self._org_ids: tuple[UUID, ...] = ()
        self._loaded_at = 0.0

    async def refresh(self) -> None:
        # orgs + edges come from pre-context identity views (doc 17 §4 rule 2
        # — org/site/edge in the topic must match a real, active edge row);
        # sites + tags load per-org inside tenant_tx (tenant_isolation).
        org_ids = await active_org_ids(self.pool)
        async with global_tx(self.pool) as conn:
            erows = await conn.fetch(
                "SELECT id, org_id, site_id, status, mqtt_username FROM edges")
        by_key: dict[tuple[UUID, str], Tag] = {}
        by_id: dict[UUID, Tag] = {}
        sites: dict[UUID, tuple[UUID, str]] = {}
        for org_id in org_ids:
            async with tenant_tx(self.pool, org_id) as tc:
                for r in await tc.fetch("SELECT id, code FROM sites"):
                    sites[r["id"]] = (org_id, r["code"])
                rows = await tc.fetch(
                    "SELECT id, org_id, site_id, edge_id, path, name, type,"
                    " unit, writable, min_value, max_value FROM tags"
                    " ORDER BY path")
                for r in rows:
                    t = Tag(**dict(r))
                    by_key[(t.site_id, t.path)] = t
                    by_id[t.id] = t
        self._by_key = by_key
        self._by_id = by_id
        self._edges = {r["id"]: Edge(**dict(r)) for r in erows}
        self._sites = sites
        self._org_ids = tuple(org_ids)
        self._loaded_at = time.monotonic()

    async def maybe_refresh(self) -> None:
        if time.monotonic() - self._loaded_at > REFRESH_S:
            await self.refresh()

    def by_path(self, site_id: UUID, path: str) -> Tag | None:
        return self._by_key.get((site_id, path))

    def by_v1_name(self, name: str) -> Tag | None:
        """v1 compat: `{v1_site_code}.{dotted path}` resolves ONLY inside the
        seeded shim site — another org's tag can never shadow it."""
        path = v1_name_to_path(name)
        if path is None:
            return None
        return self._by_key.get((config.V1_SITE_ID, path))

    def by_display_name(self, site_id: UUID, name: str) -> Tag | None:
        """`{site_code}.{dotted path}` within ONE site (org-scoped v1 shim).
        The code prefix must match that site's own code, so a name can never
        resolve into another site."""
        code = (self._sites.get(site_id) or (None, None))[1]
        if not code or not name.startswith(code + "."):
            return None
        return self._by_key.get((site_id, name[len(code) + 1:].replace(".", "/")))

    def by_id(self, tag_id: UUID) -> Tag | None:
        return self._by_id.get(tag_id)

    def edge(self, edge_id: UUID) -> Edge | None:
        return self._edges.get(edge_id)

    def edges(self) -> list[Edge]:
        return list(self._edges.values())

    def all(self) -> list[Tag]:
        return list(self._by_key.values())

    def for_site(self, site_id: UUID) -> list[Tag]:
        return [t for t in self._by_key.values() if t.site_id == site_id]

    def for_org(self, org_id: UUID) -> list[Tag]:
        return [t for t in self._by_key.values() if t.org_id == org_id]

    def org_ids(self) -> tuple[UUID, ...]:
        """Live org ids as of the last refresh (engines' sweep driver)."""
        return self._org_ids

    def site_org(self, site_id: UUID) -> UUID | None:
        """site_id -> owning org (WS auth-frame site resolution)."""
        hit = self._sites.get(site_id)
        return hit[0] if hit else None

    def display_name(self, tag: Tag) -> str:
        """`{site_code}.{dotted path}` — the v1 name for the shim site, the
        real site code for everyone else."""
        code = (self._sites.get(tag.site_id) or (None, "?"))[1]
        return f"{code}.{tag.path.replace('/', '.')}"
