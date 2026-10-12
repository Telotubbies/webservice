#!/usr/bin/env python3
"""v1 SQLite → Postgres (SaaS schema) one-time migration — doc 18 §3.

    scripts/migrate_sqlite_to_pg.py --sqlite backend/data/app.db --dry-run
    scripts/migrate_sqlite_to_pg.py --sqlite backend/data/app.db \
        --dsn postgresql://wds_app:…@127.0.0.1:5433/wds

What it does (doc 18 §3):

1. Creates org "--org-name" (default "Demo"), site "<site-code>" (the
   dominant first dotted segment of tag names, default-detection falls back
   to plant1) and edge "edge1" (status=pending, NO credential — the edge
   must be provisioned fresh per doc 17 §5). Lines/devices are derived from
   the tag names ({site}.{area}.{line}.{device}.{signal}, doc 05 §1).
2. Maps tag name → tags.id and copies tags, tags_latest, tags_history,
   alarm_rules, alarms, commands (status mapping doc 16 §3) and audit_log.
3. The new audit chain opens with a genesis row `migration.import`
   recording the source row counts and the sha256 of the SQLite file.
4. Idempotent: every insert is ON CONFLICT DO NOTHING / deterministic ids,
   and the audit copy is skipped once a genesis row for this file exists.
   Rerunning inserts nothing new. --dry-run prints per-table counts and
   exits without touching Postgres (or requiring a connection).
5. Rollback: the SQLite file is opened READ-ONLY and never modified.

Target DSN resolution: --dsn, then WDS_APP_DSN / WDS_SYSTEM_DSN /
WDS_TEST_APP_DSN. The script runs as a runtime role inside a tenant
transaction — it gets no privileges the API doesn't have (ADR-13).

Expected v1 SQLite schema (reconstructed from doc 05 §3 + doc 18 §3 — the
Phase-1 `backend/data/app.db` is gitignored, not committed):

    tags(id INTEGER PK, name TEXT UNIQUE, description, unit, writable INT,
         adapter, stale_after_s INT, created_at TEXT)
    alarm_rules(id INTEGER PK, tag_id INT, name, condition TEXT
                'value > 80' | 'stale > 30', severity, enabled INT)
    alarms(id INTEGER PK, rule_id INT, tag_id INT, raised_at, acked_at,
           acked_by, cleared_at, snapshot_url, status active|acked|cleared)
    commands(id TEXT PK uuid, idempotency_key, user_id, tag, value JSON,
             status issued|sent|acked|done|failed|timeout|denied,
             issued_at, completed_at, result JSON)
    audit_log(id INTEGER PK, ts, user_id, action, detail JSON, ip)
    tags_latest(tag TEXT PK | tag_id INT, v, q, ts, src)
    tags_history(tag TEXT | tag_id INT, ts, v, q, src)

Tables/columns that don't exist in the source are skipped with a note.
"""

from __future__ import annotations

import argparse
import asyncio
import hashlib
import json
import os
import re
import sqlite3
import sys
import uuid
from datetime import datetime, timezone
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO / "backend"))

Q_OK = {"good", "bad", "stale", "uncertain"}
SEVERITIES = {"info", "warning", "critical"}

# doc 16 §3 mapping from v1 command status vocabulary
COMMAND_STATUS = {
    "issued": "accepted", "sent": "dispatched", "acked": "acknowledged",
    "done": "acknowledged", "denied": "rejected", "failed": "failed",
    "timeout": "timeout",
}
_OP_KIND = {">": "hi", ">=": "hi", "<": "lo", "<=": "lo"}


# --------------------------------------------------------------------------
# sqlite side
# --------------------------------------------------------------------------
def open_ro(path: Path) -> sqlite3.Connection:
    if not path.is_file():
        raise SystemExit(f"sqlite file not found: {path}")
    conn = sqlite3.connect(f"file:{path}?mode=ro", uri=True)
    conn.row_factory = sqlite3.Row
    return conn


def _tables(conn: sqlite3.Connection) -> set[str]:
    return {r[0] for r in conn.execute(
        "SELECT name FROM sqlite_master WHERE type='table'")}


def _cols(conn: sqlite3.Connection, table: str) -> list[str]:
    return [r[1] for r in conn.execute(f"PRAGMA table_info({table})")]


def _rows(conn: sqlite3.Connection, table: str) -> list[sqlite3.Row]:
    try:
        return conn.execute(f"SELECT * FROM {table}").fetchall()
    except sqlite3.Error as e:
        # A corrupt/unreadable table must not silently import as "empty".
        print(f"WARNING: failed to read source table {table!r}: {e} "
              f"— importing it as empty", file=sys.stderr)
        return []


def _parse_ts(v) -> datetime | None:
    if v is None:
        return None
    if isinstance(v, (int, float)):
        return datetime.fromtimestamp(v, tz=timezone.utc)
    s = str(v).strip()
    if not s:
        return None
    try:
        dt = datetime.fromisoformat(s.replace("Z", "+00:00"))
    except ValueError:
        try:
            return datetime.fromtimestamp(float(s), tz=timezone.utc)
        except ValueError:
            return None
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def _jsonable(v):
    """jsonb-safe scalar: non-finite floats can't serialize (jsonb has no NaN)."""
    if isinstance(v, float) and (v != v or v in (float("inf"), float("-inf"))):
        return None
    return v


class Source:
    """Read + summarize the v1 sqlite file."""

    def __init__(self, path: Path):
        self.path = path
        self.sha256 = hashlib.sha256(path.read_bytes()).hexdigest()
        conn = open_ro(path)
        try:
            self.tables = _tables(conn)
            self.tags = _rows(conn, "tags")
            self.rules = _rows(conn, "alarm_rules")
            self.alarms = _rows(conn, "alarms")
            self.commands = _rows(conn, "commands")
            self.audit = _rows(conn, "audit_log")
            self.latest = _rows(conn, "tags_latest")
            self.history = _rows(conn, "tags_history")
            self._latest_cols = _cols(conn, "tags_latest") \
                if "tags_latest" in self.tables else []
            self._history_cols = _cols(conn, "tags_history") \
                if "tags_history" in self.tables else []
        finally:
            conn.close()
        self.tag_by_id = {t["id"]: t for t in self.tags}
        self.tag_names = [t["name"] for t in self.tags]
        # site code = dominant first dotted segment of tag names
        from collections import Counter
        firsts = Counter(n.split(".", 1)[0] for n in self.tag_names if "." in n)
        self.site_code = firsts.most_common(1)[0][0] if firsts else "plant1"

    def counts(self) -> dict:
        return {k: len(v) for k, v in (
            ("tags", self.tags), ("alarm_rules", self.rules),
            ("alarms", self.alarms), ("commands", self.commands),
            ("tags_latest", self.latest), ("tags_history", self.history),
            ("audit_log", self.audit))}

    def tag_key(self, row: sqlite3.Row, cols: list[str]):
        """telemetry rows may key by tag name ('tag') or id ('tag_id')."""
        if "tag" in cols:
            return row["tag"]
        if "tag_id" in cols:
            t = self.tag_by_id.get(row["tag_id"])
            return t["name"] if t else None
        return None


def tag_path(name: str, site_code: str) -> str | None:
    """plant1.sort.line1.conv1.speed -> sort/line1/conv1/speed (doc 05 §1)."""
    parts = name.split(".")
    if parts and parts[0] == site_code:
        parts = parts[1:]
    if len(parts) < 2:
        return None
    if not all(re.fullmatch(r"[a-z0-9_]+", p) for p in parts):
        return None
    return "/".join(parts)


def rule_kind(condition: str) -> tuple[str, float | None, int | None]:
    """'value > 80' -> ('hi', 80.0, None); 'stale > 30' -> ('stale', None, 30)."""
    m = re.match(r"\s*(value|stale)\s*(>=|<=|>|<|==|!=)\s*(\S+)", condition or "")
    if not m:
        return "hi", None, None
    field, op, raw = m.groups()
    if field == "stale":
        try:
            return "stale", None, max(5, int(float(raw)))
        except ValueError:
            return "stale", None, 30
    return _OP_KIND.get(op, "hi"), float(raw), None


# --------------------------------------------------------------------------
# postgres side — everything through tenant_tx (ADR-13 §2 single call site)
# --------------------------------------------------------------------------
def _n(status: str) -> int:
    """'INSERT 0 3' -> 3."""
    try:
        return int(status.rsplit(" ", 1)[-1])
    except (ValueError, IndexError):
        return 0


async def migrate(src: Source, dsn: str, org_id: uuid.UUID | None,
                  org_name: str, site_code: str | None) -> int:
    from app.db.context import tenant_tx
    from app.db.pool import create_pools

    site_code = site_code or src.site_code
    if not re.fullmatch(r"[a-z0-9][a-z0-9_-]{0,31}", site_code):
        site_code = "plant1"
    org = org_id or uuid.uuid5(uuid.NAMESPACE_URL, f"wds-migration:{src.sha256}")

    pools = await create_pools(dsn, dsn, min_size=1, max_size=2)
    try:
        async with tenant_tx(pools.app, org) as conn:
            n = await conn.fetchval(
                "INSERT INTO organizations(id, name) VALUES ($1,$2)"
                " ON CONFLICT (id) DO NOTHING RETURNING 1", org, org_name)
            created_org = bool(n)
            site = await conn.fetchval(
                "INSERT INTO sites(org_id, name, code) VALUES ($1,$2,$3)"
                " ON CONFLICT (org_id, code) DO NOTHING RETURNING id",
                org, org_name, site_code)
            if site is None:
                site = await conn.fetchval(
                    "SELECT id FROM sites WHERE org_id=$1 AND code=$2", org, site_code)
            edge_id = uuid.uuid5(site, "edge1")
            edge = await conn.fetchval(
                "INSERT INTO edges(id, org_id, site_id, name, status)"
                " VALUES ($1,$2,$3,'edge1','pending')"
                " ON CONFLICT (id) DO NOTHING RETURNING id",
                edge_id, org, site)
            if edge is None:
                edge = await conn.fetchval(
                    "SELECT id FROM edges WHERE org_id=$1 AND site_id=$2 AND name='edge1'",
                    org, site) or edge_id

            # ---- tags + derived lines/devices ---------------------------
            tag_id_by_name: dict[str, uuid.UUID] = {}
            lines_seen: dict[str, uuid.UUID] = {}
            dev_seen: dict[tuple, uuid.UUID] = {}
            tag_type: dict[str, str] = {}
            skipped_tags = 0
            for t in src.tags:
                path = tag_path(t["name"], site_code)
                if not path:
                    skipped_tags += 1
                    continue
                segs = path.split("/")
                device_name = segs[-2] if len(segs) >= 3 else None
                line_name = "/".join(segs[:-2]) if len(segs) >= 3 else "imported"
                line_id = None
                if line_name not in lines_seen:
                    line_id = await conn.fetchval(
                        "INSERT INTO lines(org_id, site_id, name)"
                        " VALUES ($1,$2,$3)"
                        " ON CONFLICT (org_id, site_id, name) DO NOTHING RETURNING id",
                        org, site, line_name)
                    if line_id is None:
                        line_id = await conn.fetchval(
                            "SELECT id FROM lines WHERE org_id=$1 AND site_id=$2 AND name=$3",
                            org, site, line_name)
                    lines_seen[line_name] = line_id
                line_id = lines_seen[line_name]
                dev_id = None
                if device_name:
                    if (line_id, device_name) not in dev_seen:
                        dev_id = await conn.fetchval(
                            "INSERT INTO devices(org_id, line_id, name)"
                            " VALUES ($1,$2,$3)"
                            " ON CONFLICT (org_id, line_id, name) DO NOTHING RETURNING id",
                            org, line_id, device_name)
                        if dev_id is None:
                            dev_id = await conn.fetchval(
                                "SELECT id FROM devices WHERE org_id=$1 AND line_id=$2 AND name=$3",
                                org, line_id, device_name)
                        dev_seen[(line_id, device_name)] = dev_id
                    dev_id = dev_seen[(line_id, device_name)]
                # v1 sqlite has no tag type: unit 'bool' (tags.yaml
                # convention) marks booleans; everything else is numeric.
                ttype = "bool" if t["unit"] == "bool" else "number"
                tag_type[t["name"]] = ttype
                tid = uuid.uuid5(site, path)
                got = await conn.fetchval(
                    "INSERT INTO tags(id, org_id, site_id, edge_id, device_id, path,"
                    " name, type, unit, writable, description)"
                    " VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)"
                    " ON CONFLICT (org_id, site_id, path) DO NOTHING RETURNING id",
                    tid, org, site, edge, dev_id, path,
                    " ".join(path.split("/")[-2:]), ttype,
                    None if t["unit"] in (None, "", "bool") else t["unit"],
                    bool(t["writable"]), t["description"])
                tag_id_by_name[t["name"]] = got or tid

            # stale/duplicate safety: resolve any missed ids
            rows = await conn.fetch(
                "SELECT id, path FROM tags WHERE org_id=$1 AND site_id=$2", org, site)
            id_by_path = {r["path"]: r["id"] for r in rows}
            for t in src.tags:
                p = tag_path(t["name"], site_code)
                if p and t["name"] not in tag_id_by_name:
                    tag_id_by_name[t["name"]] = id_by_path.get(p) \
                        or uuid.uuid5(site, p)

            # ---- alarm rules --------------------------------------------
            rule_new: dict[int, uuid.UUID] = {}
            rule_sev: dict[int, str] = {}
            for r in src.rules:
                t = src.tag_by_id.get(r["tag_id"])
                if not t or t["name"] not in tag_id_by_name:
                    continue
                tid = tag_id_by_name[t["name"]]
                kind, threshold, stale_s = rule_kind(r["condition"])
                sev = r["severity"] if r["severity"] in SEVERITIES else "warning"
                rid = uuid.uuid5(tid, f"rule:{r['name']}")
                await conn.execute(
                    "INSERT INTO alarm_rules(id, org_id, tag_id, name, kind,"
                    " threshold, stale_s, severity, enabled)"
                    " VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)"
                    " ON CONFLICT (org_id, tag_id, name) DO NOTHING",
                    rid, org, tid, r["name"], kind, threshold, stale_s, sev,
                    bool(r["enabled"]))
                rule_new[r["id"]] = rid
                rule_sev[r["id"]] = sev

            # ---- users for legacy actors (needed before alarms/commands) -
            actors = {str(c["user_id"]) for c in src.commands if c["user_id"]}
            actors |= {str(r["user_id"]) for r in src.audit if r["user_id"]}
            actors |= {str(a["acked_by"]) for a in src.alarms if a["acked_by"]}
            user_map: dict[str, uuid.UUID] = {}
            for uid_text in sorted(actors):
                sub = f"imported:{uid_text}"
                uid = await conn.fetchval(
                    "INSERT INTO users(sub, display_name, email_verified)"
                    " VALUES ($1,$2,false) ON CONFLICT (sub) DO NOTHING RETURNING id",
                    sub, uid_text)
                if uid is None:
                    uid = await conn.fetchval("SELECT id FROM users WHERE sub=$1", sub)
                user_map[uid_text] = uid

            # ---- alarms --------------------------------------------------
            for a in src.alarms:
                tid_old = a["tag_id"]
                t = src.tag_by_id.get(tid_old)
                tid = tag_id_by_name.get(t["name"]) if t else None
                rid = rule_new.get(a["rule_id"])
                if not tid or not rid:
                    continue
                state = a["status"] if a["status"] in ("active", "acked", "cleared") \
                    else "cleared"
                await conn.execute(
                    "INSERT INTO alarms(id, org_id, tag_id, rule_id, severity,"
                    " state, raised_at, acked_at, acked_by, cleared_at)"
                    " VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT (id) DO NOTHING",
                    uuid.uuid5(org, f"v1alarm:{a['id']}"), org, tid, rid,
                    rule_sev.get(a["rule_id"], "warning"), state,
                    _parse_ts(a["raised_at"]) or datetime.now(timezone.utc),
                    _parse_ts(a["acked_at"]),
                    user_map.get(str(a["acked_by"])) if a["acked_by"] else None,
                    _parse_ts(a["cleared_at"]))

            # ---- telemetry ----------------------------------------------
            latest_n = hist_n = 0
            for r in src.latest:
                name = src.tag_key(r, src._latest_cols)
                tid = tag_id_by_name.get(name)
                ts = _parse_ts(r["ts"])
                if not tid or not ts:
                    continue
                v = _jsonable(r["v"])
                if tag_type.get(name) == "bool" and isinstance(v, (int, float)):
                    v = bool(v)
                st = await conn.execute(
                    "INSERT INTO tag_latest(tag_id, org_id, v, q, ts)"
                    " VALUES ($1,$2,$3,$4,$5) ON CONFLICT (tag_id) DO NOTHING",
                    tid, org, v,
                    r["q"] if r["q"] in Q_OK else "uncertain", ts)
                latest_n += _n(st)
            for r in src.history:
                name = src.tag_key(r, src._history_cols)
                tid = tag_id_by_name.get(name)
                ts = _parse_ts(r["ts"])
                if not tid or not ts:
                    continue
                v = _jsonable(r["v"])
                if tag_type.get(name) == "bool" and isinstance(v, (int, float)):
                    v = bool(v)
                st = await conn.execute(
                    "INSERT INTO tag_history(tag_id, ts, org_id, v, q)"
                    " VALUES ($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING",
                    tid, ts, org, v,
                    r["q"] if r["q"] in Q_OK else "uncertain")
                hist_n += _n(st)

            # ---- commands ------------------------------------------------
            cmd_n = 0
            for c in src.commands:
                tid = tag_id_by_name.get(c["tag"])
                actor = user_map.get(str(c["user_id"]))
                if not tid or not actor:
                    continue
                try:
                    cid = uuid.UUID(str(c["id"]))
                except (ValueError, TypeError):
                    cid = uuid.uuid5(org, f"v1cmd:{c['id']}")
                status = COMMAND_STATUS.get(c["status"], "failed")
                reason = None
                try:
                    res = json.loads(c["result"]) if c["result"] else None
                    if isinstance(res, dict):
                        reason = res.get("detail") or res.get("reason")
                except (json.JSONDecodeError, TypeError):
                    pass
                try:
                    value = json.loads(c["value"]) if isinstance(c["value"], str) \
                        else c["value"]
                except (json.JSONDecodeError, TypeError):
                    value = c["value"]
                issued = _parse_ts(c["issued_at"]) or datetime.now(timezone.utc)
                updated = _parse_ts(c["completed_at"]) or issued
                # commands.id is globally unique (PK) — a re-run or a second
                # import of the same file hits the pk, not (org_id, id).
                st = await conn.execute(
                    "INSERT INTO commands(id, org_id, site_id, edge_id, tag_id,"
                    " value, status, reason, ttl_s, idempotency_key,"
                    " actor_user_id, issued_at, updated_at)"
                    " VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)"
                    " ON CONFLICT (id) DO NOTHING",
                    cid, org, site, edge, tid, _jsonable(value),
                    status, reason, 10, c["idempotency_key"], actor, issued, updated)
                cmd_n += _n(st)

            # ---- audit: genesis row then legacy rows ---------------------
            already = await conn.fetchval(
                "SELECT 1 FROM audit_log WHERE org_id=$1"
                " AND action='migration.import' AND detail->>'sqlite_sha256'=$2",
                org, src.sha256)
            audit_n = 0
            if already:
                pass  # genesis exists → audit copy already done (idempotent)
            else:
                detail = {"sqlite_sha256": src.sha256, "source": str(src.path),
                          "counts": src.counts()}
                await conn.execute(
                    "INSERT INTO audit_log(org_id, actor, action, detail)"
                    " VALUES ($1,'migrate_sqlite_to_pg','migration.import',$2)",
                    org, detail)
                for r in src.audit:
                    try:
                        d = json.loads(r["detail"]) if r["detail"] else None
                    except (json.JSONDecodeError, TypeError):
                        d = r["detail"]
                    det = {"imported_from": "sqlite", "orig_ts": r["ts"],
                           "ip": r["ip"], "detail": d}
                    await conn.execute(
                        "INSERT INTO audit_log(org_id, actor, action, detail)"
                        " VALUES ($1,$2,$3,$4)",
                        org, str(r["user_id"] or "migration"),
                        str(r["action"]), det)
                    audit_n += 1

        print(f"org={org} ({'created' if created_org else 'existing'})"
              f" site={site} edge={edge}")
        print(f"tags: {len(tag_id_by_name)} mapped, {skipped_tags} skipped"
              f" | lines={len(lines_seen)} devices={len(dev_seen)}"
              f" | rules={len(rule_new)} alarms={len(src.alarms)}")
        print(f"tag_latest +{latest_n}  tag_history +{hist_n}  commands +{cmd_n}"
              f"  audit_log +{audit_n if not already else 0}"
              f"{' (audit skipped: genesis exists)' if already else ''}")
        return 0
    finally:
        await pools.close()


def main() -> int:
    ap = argparse.ArgumentParser(description="v1 SQLite → Postgres migration (doc 18 §3)")
    ap.add_argument("--sqlite", required=True, help="path to the v1 app.db (read-only)")
    ap.add_argument("--dsn", help="target Postgres DSN "
                    "(default: $WDS_APP_DSN / $WDS_SYSTEM_DSN / $WDS_TEST_APP_DSN)")
    ap.add_argument("--org-id", help="import into this org uuid (default: derived "
                    "from the sqlite sha256 → deterministic, idempotent)")
    ap.add_argument("--org-name", default="Demo")
    ap.add_argument("--site-code", help="site code to create (default: dominant "
                    "first dotted segment of tag names, else 'plant1')")
    ap.add_argument("--dry-run", action="store_true",
                    help="print per-table counts + plan, write nothing")
    args = ap.parse_args()

    src = Source(Path(args.sqlite))
    print(f"sqlite sha256: {src.sha256}")
    print("source counts:", " ".join(f"{k}={v}" for k, v in src.counts().items()))

    # plan summary
    site_code = args.site_code or src.site_code
    paths = {t["name"]: tag_path(t["name"], site_code) for t in src.tags}
    good = [p for p in paths.values() if p]
    lines = {"/".join(p.split("/")[:-2]) if len(p.split("/")) >= 3 else "imported"
             for p in good}
    devs = {p.split("/")[-2] for p in good if len(p.split("/")) >= 3}
    print(f"plan: org '{args.org_name}' site '{site_code}' edge 'edge1'"
          f" (pending) | {len(good)} tags, {len(lines)} lines, {len(devs)} devices"
          f" | {len(src.tags) - len(good)} tags skipped (bad path)")
    if args.dry_run:
        print("dry-run — nothing written")
        return 0

    dsn = args.dsn or os.environ.get("WDS_APP_DSN") \
        or os.environ.get("WDS_SYSTEM_DSN") or os.environ.get("WDS_TEST_APP_DSN")
    if not dsn:
        raise SystemExit("no target DSN — pass --dsn or set WDS_APP_DSN")
    org_id = uuid.UUID(args.org_id) if args.org_id else None
    return asyncio.run(migrate(src, dsn, org_id, args.org_name, site_code))


if __name__ == "__main__":
    sys.exit(main())
