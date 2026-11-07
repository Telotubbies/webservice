"""Archive before drop (F20). A month of an org's raw telemetry is written as gzip CSV, read
back, hashed and counted, and only then recorded in archive_manifest. retention_prune drops a
partition only if every org's rows in it have a verified archive.

The target is a local directory (EXPORT_DIR/<org>/archive). Moving the same files to the object
store (Garage/S3) is the next step; the manifest already carries the path and sha256 for it.
"""

from __future__ import annotations

import csv
import gzip
import hashlib
import io
from datetime import date, datetime, timezone
from pathlib import Path
from uuid import UUID

from ..core import config
from ..db.context import active_org_ids, tenant_tx


def month_bounds(m: date) -> tuple[datetime, datetime]:
    a = datetime(m.year, m.month, 1, tzinfo=timezone.utc)
    b = datetime(m.year + (m.month == 12), m.month % 12 + 1, 1, tzinfo=timezone.utc)
    return a, b


def write_gz_csv(path: Path, rows) -> tuple[int, str]:
    """Write rows (iterable of tuples) -> (row_count, sha256 of the file)."""
    path.parent.mkdir(parents=True, exist_ok=True)
    n = 0
    with gzip.open(path, "wt", encoding="utf-8", newline="") as f:
        w = csv.writer(f)
        w.writerow(["tag_id", "ts", "q", "v"])
        for r in rows:
            w.writerow(r)
            n += 1
    return n, hashlib.sha256(path.read_bytes()).hexdigest()


def verify(path: Path, expect_rows: int, expect_sha: str) -> bool:
    """Read the archive back: same bytes, and exactly the rows we meant to keep."""
    try:
        raw = path.read_bytes()
        if hashlib.sha256(raw).hexdigest() != expect_sha:
            return False
        text = gzip.decompress(raw).decode("utf-8")
        return sum(1 for _ in csv.reader(io.StringIO(text))) - 1 == expect_rows
    except (OSError, EOFError, UnicodeDecodeError):
        return False


async def archive_org_month(tc, org_id: UUID, month: date) -> bool:
    """Archive + verify one org-month. True when a verified archive exists afterwards."""
    if await tc.fetchval("SELECT 1 FROM archive_manifest WHERE month=$1 AND verified_at IS NOT NULL", month):
        return True
    a, b = month_bounds(month)
    rows = await tc.fetch("SELECT tag_id, ts, q, v FROM tag_history WHERE ts >= $1 AND ts < $2 ORDER BY ts, tag_id", a, b)
    if not rows:
        return True                                    # nothing to keep
    path = Path(config.EXPORT_DIR) / str(org_id) / "archive" / f"{month:%Y-%m}.csv.gz"
    n, sha = write_gz_csv(path, ((str(r["tag_id"]), r["ts"].isoformat(), r["q"], r["v"]) for r in rows))
    if n != len(rows) or not verify(path, n, sha):
        path.unlink(missing_ok=True)
        return False
    await tc.execute(
        "INSERT INTO archive_manifest(org_id, month, path, row_count, sha256, verified_at) VALUES ($1,$2,$3,$4,$5,now())"
        " ON CONFLICT (org_id, month) DO UPDATE SET path=EXCLUDED.path, row_count=EXCLUDED.row_count,"
        " sha256=EXCLUDED.sha256, verified_at=now()", org_id, month, str(path), n, sha)
    return True


def months_before(cutoff: datetime, earliest: datetime | None) -> list[date]:
    """Whole months that end on or before cutoff (the partitions that would be dropped)."""
    if earliest is None:
        return []
    out, m = [], date(earliest.year, earliest.month, 1)
    while month_bounds(m)[1] <= cutoff:
        out.append(m)
        m = date(m.year + (m.month == 12), m.month % 12 + 1, 1)
    return out


async def archive_before_drop(pools, cutoff: datetime) -> bool:
    """True only if every org-month that the drop would remove has a verified archive."""
    async with pools.system.acquire() as conn:
        earliest = await conn.fetchval("SELECT min(ts) FROM tag_history")
    ok = True
    for m in months_before(cutoff, earliest):
        for org_id in await active_org_ids(pools.system):
            async with tenant_tx(pools.system, org_id) as tc:
                ok = await archive_org_month(tc, org_id, m) and ok
    return ok
