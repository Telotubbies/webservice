"""CSV connector (F19): the same sync path as Odoo, fed by an uploaded file.
Columns per entity:  product: code,name,active   work_center: code,name
work_order: code,product_code,qty_planned,due_at,status,work_center
"""

from __future__ import annotations

import csv
import hashlib
import io

from ..connector import ExtRecord, Health, Page

MAX_BYTES = 2 * 1024 * 1024
MAX_ROWS = 20000
KEY = {"product": "code", "work_center": "code", "work_order": "code"}
REQUIRED = {"product": ("code",), "work_center": ("code",), "work_order": ("code", "product_code")}


def parse(entity: str, raw: bytes) -> list[ExtRecord]:
    if len(raw) > MAX_BYTES:
        raise ValueError("file too large")
    rd = csv.DictReader(io.StringIO(raw.decode("utf-8-sig")))
    if not rd.fieldnames or any(c not in rd.fieldnames for c in REQUIRED[entity]):
        raise ValueError(f"missing column: {', '.join(REQUIRED[entity])}")
    out: list[ExtRecord] = []
    for i, row in enumerate(rd):
        if i >= MAX_ROWS:
            raise ValueError("too many rows")
        f = {k: (v or "").strip() for k, v in row.items() if k}
        if "active" in f:
            f["active"] = f["active"].lower() not in ("0", "false", "no", "n")
        ext = f.get(KEY[entity]) or f"row{i + 1}"
        # the content hash is the version: an unchanged row is skipped on re-import
        out.append(ExtRecord(external_id=ext, version=hashlib.sha256(repr(sorted(f.items())).encode()).hexdigest()[:16], fields=f))
    return out


class CsvConnector:
    kind = "csv"

    def __init__(self, records: list[ExtRecord]):
        self._records = records

    async def healthcheck(self) -> Health:
        return Health(True, f"{len(self._records)} rows")

    async def pull(self, entity: str, cursor: str | None) -> Page:
        return Page(self._records, None)
