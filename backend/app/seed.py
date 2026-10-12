"""Idempotent dev seed: demo org / site plant1 / edge1 / tags / alarm rules / demo users.

Runs only when APP_ENV=dev (or via `python -m app.seed`). Ids are fixed so the
v1 compatibility shim (config.V1_*) can find them. Tag registry comes from
edge-bridge/tags.yaml (single source shared with the edge); alarm rules from
alarm_rules.yaml. Everything is written through the wds_app role inside
tenant_tx — the seed gets no privileges the API doesn't have.
"""

from __future__ import annotations

import asyncio
import logging
import os
import uuid
from pathlib import Path

import yaml

from . import config
from .db.context import global_tx, tenant_tx
from .db.pool import Pools, create_pools
from .dynsec import edge_client_name

log = logging.getLogger("backend.seed")

BASE = Path(__file__).resolve().parent.parent

# demo bearer token (v1 shim) -> (fixed user id, role)
DEMO_USERS = {
    "demo-operator": (uuid.UUID("0199d000-0000-7000-8000-00000000d001"), "operator"),
    "demo-viewer": (uuid.UUID("0199d000-0000-7000-8000-00000000d002"), "viewer"),
    # admin exists for the edge provisioning API (doc 17 §5 needs config:write)
    "demo-admin": (uuid.UUID("0199d000-0000-7000-8000-00000000d003"), "admin"),
}


def _tag_id(path: str) -> uuid.UUID:
    # deterministic so re-seeding upserts the same row
    return uuid.uuid5(config.V1_SITE_ID, path)


def _bootstrap_fingerprint() -> str:
    """sha256 of the mounted edge bootstrap secret, or '' if unmounted."""
    try:
        from .dynsec import _read_secret_file, fingerprint  # local import
        pw = _read_secret_file(config.EDGE_BOOTSTRAP_PW_FILE)
        return fingerprint(pw) if pw else ""
    except Exception:  # noqa: BLE001 — seed must not depend on secret mounts
        return ""


def load_tag_specs(path: str | None = None) -> list[dict]:
    cfg = Path(path or os.environ.get("TAGS_CONFIG") or BASE.parent / "edge-bridge" / "tags.yaml")
    data = yaml.safe_load(cfg.read_text()) or {}
    specs = []
    for dotted, spec in ((data.get("sim") or {}).get("tags") or {}).items():
        is_bool = spec.get("unit") == "bool" or isinstance(spec.get("initial"), bool)
        unit = None if spec.get("unit") in (None, "", "bool") else spec["unit"]
        specs.append({
            "path": dotted.replace(".", "/"),
            "name": " ".join(dotted.split(".")[-2:]),
            "type": "bool" if is_bool else "number",
            "unit": unit,
            "writable": bool(spec.get("writable")),
            "min": spec.get("min"),
            "max": spec.get("max"),
            "description": str(spec.get("behavior") or ""),
        })
    return specs


_OP_KIND = {">": "hi", ">=": "hi", "<": "lo", "<=": "lo"}


def load_rule_specs(path: str | None = None) -> list[dict]:
    cfg = Path(path or os.environ.get("ALARM_RULES_CONFIG") or BASE / "alarm_rules.yaml")
    data = yaml.safe_load(cfg.read_text()) or {}
    out = []
    for r in data.get("rules") or []:
        op, threshold = r["condition"].replace("value", "").split()
        if op not in _OP_KIND:
            raise ValueError(f"unsupported alarm condition {r['condition']!r}")
        site_prefix = f"{config.V1_SITE_CODE}."
        if not r["tag"].startswith(site_prefix):
            raise ValueError(f"rule tag {r['tag']!r} is not under site {config.V1_SITE_CODE}")
        out.append({"name": r["name"], "path": r["tag"][len(site_prefix):].replace(".", "/"),
                    "kind": _OP_KIND[op], "threshold": float(threshold),
                    "severity": r["severity"]})
    return out


async def seed(pools: Pools) -> None:
    org, site, edge = config.V1_ORG_ID, config.V1_SITE_ID, config.V1_EDGE_ID
    async with global_tx(pools.app) as conn:
        for token, (uid, _role) in DEMO_USERS.items():
            # email_verified + a stable dev email so the invite-accept path
            # (CONTRACT.v2 §3: verified-email match) is exercisable in dev —
            # ON CONFLICT UPDATE backfills rows seeded before v4 T10.
            await conn.execute(
                "INSERT INTO users(id, sub, display_name, email, email_verified)"
                " VALUES ($1,$2,$3,$4,true)"
                " ON CONFLICT (id) DO UPDATE SET email=excluded.email",
                uid, f"dev:{token}", token, f"{token}@dev.local")
    async with tenant_tx(pools.app, org) as tc:
        await tc.execute("INSERT INTO organizations(id, name) VALUES ($1,'Demo')"
                         " ON CONFLICT (id) DO NOTHING", org)
        await tc.execute("INSERT INTO sites(id, org_id, name, code) VALUES ($1,$2,'Plant 1',$3)"
                         " ON CONFLICT (id) DO NOTHING", site, org, config.V1_SITE_CODE)
        await tc.execute(
            "INSERT INTO edges(id, org_id, site_id, name, status, mqtt_username,"
            " credential_version)"
            " VALUES ($1,$2,$3,'Edge 1','active',$4,1) ON CONFLICT (id) DO NOTHING",
            edge, org, site, edge_client_name(edge, 1))
        # identity row for the reconciler. The DB stores ONLY the sha256
        # fingerprint of the bootstrap secret (the secret itself lives in
        # infra/secrets/edge_bootstrap_pw, mounted file-only — doc 17 §5).
        # Fingerprint may be '' when no secret file is mounted (bare local
        # dev): the reconciler then adopts whatever it mints.
        fp = _bootstrap_fingerprint()
        await tc.execute(
            "INSERT INTO edge_identities(org_id, edge_id, version, username,"
            " fingerprint, status, secret_issued)"
            " VALUES ($1,$2,1,$3,$4,'active',false)"
            " ON CONFLICT (org_id, edge_id, version) DO NOTHING",
            org, edge, edge_client_name(edge, 1), fp)
        for token, (uid, role) in DEMO_USERS.items():
            await tc.execute("INSERT INTO memberships(org_id, user_id, role) VALUES ($1,$2,$3)"
                             " ON CONFLICT (org_id, user_id) DO UPDATE SET role = excluded.role",
                             org, uid, role)
        for t in load_tag_specs():
            # self-healing upsert: tags.yaml edits take effect on next boot
            await tc.execute(
                "INSERT INTO tags(id, org_id, site_id, edge_id, path, name, type, unit, writable,"
                "  min_value, max_value, description)"
                " VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)"
                " ON CONFLICT (org_id, site_id, path) DO UPDATE SET name=excluded.name,"
                "  type=excluded.type, unit=excluded.unit, writable=excluded.writable,"
                "  min_value=excluded.min_value, max_value=excluded.max_value,"
                "  description=excluded.description, edge_id=excluded.edge_id",
                _tag_id(t["path"]), org, site, edge, t["path"], t["name"], t["type"], t["unit"],
                t["writable"], t["min"], t["max"], t["description"])
        for r in load_rule_specs():
            tag_id = await tc.fetchval("SELECT id FROM tags WHERE site_id=$1 AND path=$2",
                                       site, r["path"])
            if tag_id is None:
                raise ValueError(f"alarm rule {r['name']} references unknown tag {r['path']}")
            await tc.execute(
                "INSERT INTO alarm_rules(org_id, tag_id, name, kind, threshold, severity)"
                " VALUES ($1,$2,$3,$4,$5,$6)"
                " ON CONFLICT (org_id, tag_id, name) DO UPDATE SET kind=excluded.kind,"
                "  threshold=excluded.threshold, severity=excluded.severity",
                org, tag_id, r["name"], r["kind"], r["threshold"], r["severity"])
    log.info("dev seed applied", extra={"org_id": str(org), "site_id": str(site)})


async def _main() -> None:
    pools = await create_pools(min_size=1, max_size=2)
    try:
        await seed(pools)
    finally:
        await pools.close()


if __name__ == "__main__":
    logging.basicConfig(level="INFO")
    asyncio.run(_main())
