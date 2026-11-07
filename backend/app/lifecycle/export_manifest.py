"""Complete tenant export (F20): every org table is either exported or declared exempt, the
telemetry goes out as one CSV per month (no row cap), and manifest.json lists every file with
its row count and sha256, plus anything that could not be exported. Sites whose data_origin is
not 'production' are left out by default.
"""

from __future__ import annotations

import csv
import hashlib
import io
import json
from datetime import datetime, timedelta, timezone

from ..core import config

# Tables beyond workers._EXPORT_QUERIES. Secret-bearing / binary columns are never selected.
EXTRA_QUERIES = {
    "downtimes": "SELECT * FROM downtimes",
    "downtime_reasons": "SELECT * FROM downtime_reasons",
    "shifts": "SELECT * FROM shifts",
    "machine_state_map": "SELECT * FROM machine_state_map",
    "machine_products": "SELECT * FROM machine_products",
    "tag_formulas": "SELECT * FROM tag_formulas",
    "data_sources": "SELECT id, org_id, site_id, edge_id, name, protocol, connection, poll_ms, enabled, status, created_at FROM data_sources",
    "vision_events": "SELECT id, camera_id, rule_id, kind, class_id, score, bbox, model_version_id, severity, blocked_reason, detail, fired_at FROM vision_events",
    "datasets": "SELECT * FROM datasets",
    "shift_summary": "SELECT * FROM shift_summary",
    "hour_summary": "SELECT * FROM hour_summary",
    "erp_connections": "SELECT id, kind, name, config, enabled, status, last_ok_at FROM erp_connections",
    "erp_id_map": "SELECT * FROM erp_id_map",
    "erp_work_order": "SELECT * FROM erp_work_order",
    "erp_product": "SELECT * FROM erp_product",
    "webhook_endpoints": "SELECT id, url, events, enabled, created_at FROM webhook_endpoints",
    "archive_manifest": "SELECT * FROM archive_manifest",
}
# org tables intentionally not exported (secrets, bulk binaries, or derived/ephemeral)
EXEMPT = {"api_keys", "tag_latest", "tag_rollup_1m", "tag_rollup_1h", "plant_board_captures", "integration_outbox",
          "erp_sync_run", "erp_sync_cursor", "erp_staging", "org_exports", "webhook_deliveries", "webhook_cursor",
          "edge_logs", "edge_enrollments", "notification_deliveries", "jobs"}


def sha256(b: bytes) -> str:
    return hashlib.sha256(b).hexdigest()


async def uncovered(tc, exported: set[str]) -> list[str]:
    """Org-scoped tables that are neither exported nor exempt. The manifest lists them so a new
    table cannot be silently left out of an export."""
    rows = await tc.fetch(
        "SELECT table_name FROM information_schema.columns WHERE table_schema='public' AND column_name='org_id'"
        " AND table_name NOT LIKE 'tag_history%' GROUP BY 1")
    return sorted(r["table_name"] for r in rows if r["table_name"] not in exported | EXEMPT)


async def collect_extra(tc, base_exported: set[str]) -> tuple[dict[str, list[dict]], dict[str, str], list[dict]]:
    """-> (json tables, csv files by name, errors). One table failing never fails the export."""
    tables: dict[str, list[dict]] = {}
    errors: list[dict] = []
    for name, q in EXTRA_QUERIES.items():
        try:
            async with tc.conn.transaction():
                tables[name] = [dict(r) for r in await tc.fetch(q)]
        except Exception as exc:  # noqa: BLE001 - missing table/grant: report it, keep going
            errors.append({"table": name, "error": str(exc)[:200]})
    files: dict[str, str] = {}
    first = await tc.fetchval(
        "SELECT min(h.ts) FROM tag_history h JOIN tags t ON t.id=h.tag_id JOIN sites s ON s.id=t.site_id"
        " WHERE s.data_origin='production'")
    if first is not None:
        m = datetime(first.year, first.month, 1, tzinfo=timezone.utc)
        end = datetime.now(timezone.utc)
        while m <= end:
            nxt = datetime(m.year + (m.month == 12), m.month % 12 + 1, 1, tzinfo=timezone.utc)
            buf = io.StringIO()
            w = csv.writer(buf)
            w.writerow(["tag_id", "ts", "q", "v"])
            day = m
            while day < nxt:                                   # one day at a time keeps memory bounded
                rows = await tc.fetch(
                    "SELECT h.tag_id, h.ts, h.q, h.v FROM tag_history h JOIN tags t ON t.id=h.tag_id JOIN sites s ON s.id=t.site_id"
                    " WHERE s.data_origin='production' AND h.ts >= $1 AND h.ts < $2 ORDER BY h.ts, h.tag_id",
                    day, min(day + timedelta(days=1), nxt))
                for r in rows:
                    w.writerow([r["tag_id"], r["ts"].isoformat(), r["q"], json.dumps(r["v"])])
                day += timedelta(days=1)
            if buf.tell() > len("tag_id,ts,q,v\r\n"):
                files[f"telemetry/{m:%Y-%m}.csv"] = buf.getvalue()
            m = nxt
    return tables, files, errors


def manifest(json_tables: dict[str, list], csv_files: dict[str, str], errors: list[dict], missing: list[str]) -> str:
    files = [{"file": f"{n}.json", "rows": len(r), "sha256": sha256(json.dumps(r, default=str, ensure_ascii=False).encode())}
             for n, r in json_tables.items()]
    files += [{"file": n, "rows": c.count("\n") - 1, "sha256": sha256(c.encode())} for n, c in csv_files.items()]
    return json.dumps({"generated_at": datetime.now(timezone.utc).isoformat(), "files": files,
                       "includes_non_production": False, "not_exported_errors": errors, "undeclared_tables": missing,
                       "exempt_tables": sorted(EXEMPT)}, indent=2)
