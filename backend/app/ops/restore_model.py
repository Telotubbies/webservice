"""Re-register an exported plant model after a database reset and bind its
parts to the concrete plant (ops/concrete.py).

    python -m app.ops.restore_model <model.json> <parts.json>

`model.json` is one `row_to_json(plant_models)` row, `parts.json` the
`json_agg` of its plant_parts. The .glb itself is not touched: the row keeps
its id and storage key, so it points at the file that is still in storage.
Dev only, like the other fixtures here.
"""

from __future__ import annotations

import asyncio
import json
import logging
import sys
import uuid
from datetime import datetime

from ..core import config
from ..db.context import tenant_tx
from ..db.pool import create_pools
from . import concrete
from ..plant import storage

log = logging.getLogger("backend.restore_model")


async def restore(model: dict, parts: list[dict]) -> tuple[int, int]:
    org, site = uuid.UUID(model["org_id"]), uuid.UUID(model["site_id"])
    mid = uuid.UUID(model["id"])
    if not storage.exists(org, mid):
        raise SystemExit(f"model file {model['storage_key']} is not in storage — restore it first")
    pools = await create_pools(min_size=1, max_size=2)
    kept = dropped = 0
    try:
        async with tenant_tx(pools.app, org) as tc:
            await tc.execute("UPDATE plant_models SET active = false WHERE site_id = $1", site)
            await tc.execute(
                "INSERT INTO plant_models(id, org_id, site_id, name, filename, size_bytes, sha256,"
                " storage_key, node_count, active, created_by, created_at)"
                " VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,true,NULL,$10)"
                " ON CONFLICT (id) DO UPDATE SET active = true, name = excluded.name",
                mid, org, site, "Concrete batching plant", model["filename"], model["size_bytes"],
                model["sha256"], model["storage_key"], model["node_count"],
                datetime.fromisoformat(model["created_at"]))
            await tc.execute("DELETE FROM plant_parts WHERE model_id = $1", mid)
            for sort, part in enumerate(parts):
                row = concrete.rebind(part, site)
                if row is None:
                    dropped += 1
                    continue
                dev = row.get("device_id")
                if dev and not await tc.fetchval("SELECT 1 FROM devices WHERE id = $1", uuid.UUID(dev)):
                    dev = None      # hierarchy not seeded (contract profile): bind by path only
                await tc.execute(
                    "INSERT INTO plant_parts(id, org_id, model_id, label, kind, nodes, bindings, sort, params, device_id)"
                    " VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9::jsonb,$10)",
                    uuid.UUID(row["id"]), org, mid, row["label"], row["kind"], row["nodes"],
                    row["bindings"], sort, row["params"], uuid.UUID(dev) if dev else None)
                kept += 1
    finally:
        await pools.close()
    return kept, dropped


def _main() -> None:
    if config.APP_ENV != "dev":
        raise SystemExit("restore_model is a dev fixture")
    model = json.loads(open(sys.argv[1], encoding="utf-8").read())
    parts = json.loads(open(sys.argv[2], encoding="utf-8").read())
    kept, dropped = asyncio.run(restore(model, parts))
    log.info("model restored", extra={"model": model["id"], "parts": kept, "dropped": dropped})
    print(f"restored model {model['id']}: {kept} parts bound, {dropped} dropped")


if __name__ == "__main__":
    logging.basicConfig(level="INFO")
    _main()
