"""Odoo connector (F19), READ-ONLY. Uses Odoo's external XML-RPC API with an API key of a
dedicated Odoo user. Written against the documented models (product.product, mrp.workcenter,
mrp.production); NOT yet checked against a real Odoo (version still to be confirmed with the
customer), so the transport is injectable and the tests use a fake server.

Writing back to Odoo is deliberately absent: it needs the customer's explicit approval.
"""

from __future__ import annotations

import asyncio
import xmlrpc.client

from ...core import egress
from ..connector import ExtRecord, Health, Page

PAGE = 200
# entity -> (model, fields, domain) ; write_date is the cursor (UTC, "YYYY-MM-DD HH:MM:SS")
SPEC = {
    "product": ("product.product", ["default_code", "name", "active", "write_date"], []),
    "work_center": ("mrp.workcenter", ["code", "name", "write_date"], []),
    "work_order": ("mrp.production", ["name", "product_id", "product_qty", "date_start", "state", "workcenter_id", "write_date"],
                   [["state", "in", ["confirmed", "progress"]]]),
}


def _many2one(v):
    return v[0] if isinstance(v, (list, tuple)) and v else None


def to_record(entity: str, row: dict) -> ExtRecord:
    ver = str(row.get("write_date") or "")
    if entity == "product":
        f = {"code": row.get("default_code") or "", "name": row.get("name") or "", "active": bool(row.get("active", True))}
    elif entity == "work_center":
        f = {"code": row.get("code") or "", "name": row.get("name") or ""}
    else:
        prod = row.get("product_id")
        f = {"code": row.get("name"), "product_code": (prod[1] if isinstance(prod, (list, tuple)) and len(prod) > 1 else ""),   # display name; replaced by the real code via the product map
             "product_ext": str(_many2one(prod) or ""), "qty_planned": row.get("product_qty"), "due_at": row.get("date_start") or None, "status": row.get("state"),
             "work_center": str(_many2one(row.get("workcenter_id")) or "")}
    return ExtRecord(external_id=str(row["id"]), version=ver, fields=f)


class OdooConnector:
    kind = "odoo"

    def __init__(self, url: str, db: str, login: str, api_key: str, *, proxy_factory=xmlrpc.client.ServerProxy,
                 check_egress: bool = True):
        if check_egress:
            egress.check_url(url)                     # same SSRF policy as webhooks
        self.url, self.db, self.login, self._key = url.rstrip("/"), db, login, api_key
        self._proxy = proxy_factory
        self._uid: int | None = None

    def _call(self, path: str, method: str, *args):
        return getattr(self._proxy(f"{self.url}/xmlrpc/2/{path}"), method)(*args)

    async def _run(self, *a):
        return await asyncio.get_running_loop().run_in_executor(None, lambda: self._call(*a))

    async def _auth(self) -> int:
        if self._uid is None:
            uid = await self._run("common", "authenticate", self.db, self.login, self._key, {})
            if not uid:
                raise PermissionError("Odoo rejected the login or API key")
            self._uid = uid
        return self._uid

    async def healthcheck(self) -> Health:
        try:
            v = await self._run("common", "version")
            await self._auth()
            return Health(True, str(v.get("server_version", "")))
        except Exception as exc:  # noqa: BLE001
            return Health(False, str(exc)[:200])

    async def pull(self, entity: str, cursor: str | None) -> Page:
        model, fields, domain = SPEC[entity]
        dom = list(domain) + ([["write_date", ">", cursor]] if cursor else [])
        uid = await self._auth()
        rows = await self._run("object", "execute_kw", self.db, uid, self._key, model, "search_read", [dom],
                               {"fields": fields, "limit": PAGE, "order": "write_date asc, id asc",
                                "context": {"active_test": False}})
        recs = [to_record(entity, r) for r in rows]
        nxt = max((r.version for r in recs), default=None)
        # a full page may continue after the same write_date; a short page is the end
        return Page(recs, nxt if len(rows) == PAGE and nxt != cursor else None) if rows else Page([], None)
