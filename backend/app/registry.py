"""Tag + edge registry cache (read via wds_system, ADR-13 §3).

v1 tag naming: `{site_code}.{area}.{line}.{device}.{signal}` ↔ v2 `tags.path`
`area/line/device/signal` within the site. The edge map backs the doc 17 §4
trust rules: org/site/edge parsed from the v2 topic are verified against the
`edges` identity view before any payload is trusted. Refreshed periodically
and on provisioning, so new edges work without a restart.
"""

import time
from dataclasses import dataclass
from uuid import UUID

from . import config
from .db.context import global_tx, tenant_tx

REFRESH_S = 30.0


@dataclass(frozen=True)
class Tag:
    id: UUID
    edge_id: UUID | None
    path: str
    type: str
    unit: str | None
    writable: bool
    min_value: float | None
    max_value: float | None

    @property
    def v1_name(self) -> str:
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
        self._by_path: dict[str, Tag] = {}
        self._by_id: dict[UUID, Tag] = {}
        self._edges: dict[UUID, Edge] = {}
        self._loaded_at = 0.0

    async def refresh(self) -> None:
        async with tenant_tx(self.pool, config.V1_ORG_ID) as tc:
            rows = await tc.fetch(
                "SELECT id, edge_id, path, type, unit, writable, min_value, max_value"
                " FROM tags WHERE site_id = $1 ORDER BY path", config.V1_SITE_ID)
        # edges come from the pre-context identity view (doc 17 §4 rule 2 —
        # org/site/edge in the topic must match a real, active edge row)
        async with global_tx(self.pool) as conn:
            erows = await conn.fetch(
                "SELECT id, org_id, site_id, status, mqtt_username FROM edges")
        tags = [Tag(**dict(r)) for r in rows]
        self._by_path = {t.path: t for t in tags}
        self._by_id = {t.id: t for t in tags}
        self._edges = {r["id"]: Edge(**dict(r)) for r in erows}
        self._loaded_at = time.monotonic()

    async def maybe_refresh(self) -> None:
        if time.monotonic() - self._loaded_at > REFRESH_S:
            await self.refresh()

    def by_path(self, path: str) -> Tag | None:
        return self._by_path.get(path)

    def by_v1_name(self, name: str) -> Tag | None:
        path = v1_name_to_path(name)
        return self._by_path.get(path) if path else None

    def by_id(self, tag_id: UUID) -> Tag | None:
        return self._by_id.get(tag_id)

    def edge(self, edge_id: UUID) -> Edge | None:
        return self._edges.get(edge_id)

    def edges(self) -> list[Edge]:
        return list(self._edges.values())

    def all(self) -> list[Tag]:
        return list(self._by_path.values())
