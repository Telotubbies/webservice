"""Tag input normalization + bulk CSV parsing (pure, no I/O)."""

from __future__ import annotations

import csv
import io
import math
import re

from pydantic import BaseModel, Field

from .addresses import AddressError, parse_address

BULK_MAX_ROWS = 1000
BULK_COLUMNS = ("line", "device", "signal", "address", "type", "unit",
                "writable", "min", "max", "scale")
_REQUIRED = ("line", "device", "signal", "address")


class BulkError(Exception):
    def __init__(self, errors: list[dict]):
        super().__init__(f"{len(errors)} invalid rows")
        self.errors = errors


class TagSpec(BaseModel):
    line: str = Field(min_length=1, max_length=120)
    device: str = Field(min_length=1, max_length=120)
    signal: str = Field(min_length=1, max_length=120)
    address: str | dict
    type: str = "number"
    unit: str | None = Field(default=None, max_length=32)
    writable: bool = False
    min: float | None = None
    max: float | None = None
    scale: float | None = None
    offset: float | None = None
    deadband: float | None = Field(default=None, ge=0)


def norm_name(s: str, field: str = "name") -> str:
    out = re.sub(r"[^a-z0-9]+", "_", str(s).lower()).strip("_")
    if not out or len(out) > 40:
        raise AddressError(field, "must contain 1-40 letters/digits")
    return out


def _finite(v: float | None, field: str) -> None:
    if v is not None and not math.isfinite(v):
        raise AddressError(field, "must be finite")


def build_tag(protocol: str, spec: TagSpec) -> dict:
    """Validate a TagSpec and return the normalized column values.

    Keys: line, device (normalized), path, name, type, unit, writable,
    min_value, max_value, scale, offset_value, deadband, address.
    """
    if spec.type not in ("bool", "number"):
        raise AddressError("type", "must be bool or number")
    for f in ("min", "max", "scale", "offset", "deadband"):
        _finite(getattr(spec, f), f)
    if spec.min is not None and spec.max is not None and spec.min > spec.max:
        raise AddressError("min", "must be <= max")
    if spec.scale == 0:
        raise AddressError("scale", "must not be 0")
    if spec.type == "bool" and (spec.scale is not None or spec.offset is not None):
        raise AddressError("scale", "not applicable to bool tags")
    line = norm_name(spec.line, "line")
    device = norm_name(spec.device, "device")
    signal = norm_name(spec.signal, "signal")
    address = parse_address(protocol, spec.address, spec.type)
    return {
        "line": line, "device": device,
        "path": f"{line}/{device}/{signal}", "name": signal,
        "type": spec.type, "unit": spec.unit or None, "writable": spec.writable,
        "min_value": spec.min, "max_value": spec.max,
        "scale": spec.scale, "offset_value": spec.offset,
        "deadband": spec.deadband, "address": address,
    }


_TRUE = {"true", "1", "yes", "y"}
_FALSE = {"false", "0", "no", "n", ""}


def _num(cell: str, field: str) -> float | None:
    cell = cell.strip()
    if not cell:
        return None
    try:
        return float(cell)
    except ValueError:
        raise AddressError(field, "must be a number") from None


def parse_bulk_csv(protocol: str, text: str) -> list[dict]:
    """All-or-nothing: returns the built tags or raises BulkError listing
    every bad row (row numbers are 1-based file lines; header is row 1)."""
    reader = csv.reader(io.StringIO(text.lstrip("﻿")))
    try:
        header = [h.strip().lower() for h in next(reader)]
    except StopIteration:
        raise BulkError([{"row": 1, "field": "header", "message": "empty body"}]) from None
    missing = [c for c in _REQUIRED if c not in header]
    unknown = [c for c in header if c not in BULK_COLUMNS]
    if missing or unknown:
        msg = (f"missing columns: {', '.join(missing)}" if missing else
               f"unknown columns: {', '.join(unknown)}")
        raise BulkError([{"row": 1, "field": "header", "message": msg}])
    data = [(i, r) for i, r in enumerate(reader, start=2) if any(c.strip() for c in r)]
    if not data:
        raise BulkError([{"row": 1, "field": "header", "message": "no data rows"}])
    if len(data) > BULK_MAX_ROWS:
        raise BulkError([{"row": 1, "field": "rows",
                          "message": f"at most {BULK_MAX_ROWS} rows"}])
    out: list[dict] = []
    errors: list[dict] = []
    seen: set[str] = set()
    for rown, cells in data:
        cell = {h: (cells[i].strip() if i < len(cells) else "")
                for i, h in enumerate(header)}
        try:
            for f in _REQUIRED:
                if not cell[f]:
                    raise AddressError(f, "required")
            w = cell.get("writable", "").lower()
            if w not in _TRUE and w not in _FALSE:
                raise AddressError("writable", "must be true or false")
            spec = TagSpec(
                line=cell["line"], device=cell["device"],
                signal=cell["signal"], address=cell["address"],
                type=cell.get("type") or "number", unit=cell.get("unit") or None,
                writable=w in _TRUE, min=_num(cell.get("min", ""), "min"),
                max=_num(cell.get("max", ""), "max"),
                scale=_num(cell.get("scale", ""), "scale"))
            t = build_tag(protocol, spec)
            if t["path"] in seen:
                raise AddressError("signal", f"duplicate tag {t['path']}")
            seen.add(t["path"])
            out.append(t)
        except AddressError as e:
            errors.append({"row": rown, "field": e.field, "message": e.message})
        except ValueError as e:  # pydantic
            errors.append({"row": rown, "field": "row", "message": str(e)[:200]})
    if errors:
        raise BulkError(errors)
    return out
