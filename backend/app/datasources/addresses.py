"""PLC address / connection validation (pure, no I/O).

Turns what an admin types into the normalized jsonb shapes in spec 5.3 that
the edge adapters execute, or raises AddressError(field, message) so the API
can return a field-level 422.
"""

from __future__ import annotations

import math
import re


class AddressError(ValueError):
    def __init__(self, field: str, message: str):
        super().__init__(f"{field}: {message}")
        self.field = field
        self.message = message


def _is_int(v: object) -> bool:
    return isinstance(v, int) and not isinstance(v, bool)


def _int_in(d: dict, key: str, lo: int, hi: int, prefix: str) -> int:
    v = d[key]
    if not _is_int(v) or not lo <= v <= hi:
        raise AddressError(f"{prefix}.{key}", f"must be an integer {lo}..{hi}")
    return v


def _check_keys(d: dict, allowed: set[str], prefix: str) -> None:
    for k in d:
        if k not in allowed:
            raise AddressError(f"{prefix}.{k}", "unknown field")


# ---------------------------------------------------------------- modbus

_MB_AREAS = ("coil", "discrete_input", "holding_register", "input_register")
_MB_BIT = ("coil", "discrete_input")
_MB_REG_DT = ("int16", "uint16", "int32", "uint32", "float32")


def _mb_build(area: str, index: int, datatype: str | None,
              word_order: str, tag_type: str) -> dict:
    is_bit = area in _MB_BIT
    if (tag_type == "bool") != is_bit:
        raise AddressError(
            "address", "bool tags need a coil/discrete-input address; "
            "numeric tags need a register address")
    return {"area": area, "index": index,
            "datatype": datatype or ("bool" if is_bit else "uint16"),
            "word_order": word_order}


def _modbus(raw: object, tag_type: str) -> dict:
    if isinstance(raw, dict):
        _check_keys(raw, {"area", "index", "datatype", "word_order"}, "address")
        if raw.get("area") not in _MB_AREAS:
            raise AddressError("address.area", f"must be one of {', '.join(_MB_AREAS)}")
        if "index" not in raw:
            raise AddressError("address.index", "required")
        index = _int_in(raw, "index", 0, 65535, "address")
        area = raw["area"]
        dt = raw.get("datatype")
        allowed = ("bool",) if area in _MB_BIT else _MB_REG_DT
        if dt is not None and dt not in allowed:
            raise AddressError("address.datatype", f"must be one of {', '.join(allowed)}")
        wo = raw.get("word_order", "big")
        if wo not in ("big", "little"):
            raise AddressError("address.word_order", "must be big or little")
        return _mb_build(area, index, dt, wo, tag_type)
    if not isinstance(raw, str):
        raise AddressError("address", "must be a string or object")
    s = raw.strip()
    m = re.fullmatch(r"%([QI])([XW])([0-9]+)(?:\.([0-9]+))?", s)
    if m:
        io, kind, n, bit = m.group(1), m.group(2), int(m.group(3)), m.group(4)
        if kind == "X":
            if bit is None or int(bit) > 7:
                raise AddressError("address", "bit address needs .0 to .7")
            idx = n * 8 + int(bit)
            area = "coil" if io == "Q" else "discrete_input"
        else:
            if bit is not None:
                raise AddressError("address", "word address takes no bit")
            idx = n
            area = "holding_register" if io == "Q" else "input_register"
        if idx > 65535:
            raise AddressError("address", "index out of range")
        return _mb_build(area, idx, None, "big", tag_type)
    if re.fullmatch(r"[0-9]{5}", s) and s[0] in "0134":
        n = int(s[1:])
        if not 1 <= n <= 65536:
            raise AddressError("address", "reference out of range")
        area = {"0": "coil", "1": "discrete_input",
                "3": "input_register", "4": "holding_register"}[s[0]]
        return _mb_build(area, n - 1, None, "big", tag_type)
    if re.fullmatch(r"[0-9]{1,4}", s) and tag_type == "bool":
        n = int(s)
        if n < 1:
            raise AddressError("address", "reference out of range")
        return _mb_build("coil", n - 1, None, "big", tag_type)
    raise AddressError("address", "unrecognized modbus address "
                       "(use %QX0.0, %IW4, 40001, ...)")


# -------------------------------------------------------------------- s7

_S7_AREAS = ("DB", "M", "I", "Q")
_S7_DT = ("bool", "int", "dint", "real", "word")


def _s7_check_type(datatype: str, tag_type: str) -> None:
    if (tag_type == "bool") != (datatype == "bool"):
        raise AddressError(
            "address", "bool tags need a bit address; numeric tags need a "
            "word/dword address")


def _s7(raw: object, tag_type: str) -> dict:
    if isinstance(raw, dict):
        _check_keys(raw, {"area", "db", "byte", "bit", "datatype"}, "address")
        area = raw.get("area")
        if area not in _S7_AREAS:
            raise AddressError("address.area", f"must be one of {', '.join(_S7_AREAS)}")
        dt = raw.get("datatype")
        if dt not in _S7_DT:
            raise AddressError("address.datatype", f"must be one of {', '.join(_S7_DT)}")
        out: dict = {"area": area}
        if area == "DB":
            if "db" not in raw:
                raise AddressError("address.db", "required for DB area")
            out["db"] = _int_in(raw, "db", 1, 65535, "address")
        elif "db" in raw:
            raise AddressError("address.db", "only valid for DB area")
        if "byte" not in raw:
            raise AddressError("address.byte", "required")
        out["byte"] = _int_in(raw, "byte", 0, 65535, "address")
        if dt == "bool":
            if "bit" not in raw:
                raise AddressError("address.bit", "required for bool")
            out["bit"] = _int_in(raw, "bit", 0, 7, "address")
        elif "bit" in raw:
            raise AddressError("address.bit", "only valid for bool")
        out["datatype"] = dt
        _s7_check_type(dt, tag_type)
        return out
    if not isinstance(raw, str):
        raise AddressError("address", "must be a string or object")
    s = raw.strip()
    suffix = None
    if ":" in s:
        s, suffix = s.split(":", 1)
        suffix = suffix.lower()
        if suffix not in ("int", "dint", "real", "word"):
            raise AddressError("address", "type suffix must be :int, :dint, :real or :word")
    m = re.fullmatch(r"DB([0-9]+)\.DB([XWD])([0-9]+)(?:\.([0-9]+))?", s, re.I)
    if m:
        area, db = "DB", int(m.group(1))
        kind, byte, bit = m.group(2).upper(), int(m.group(3)), m.group(4)
        if db < 1 or db > 65535:
            raise AddressError("address", "DB number out of range")
    else:
        m = re.fullmatch(r"([MIQ])([WD])?([0-9]+)(?:\.([0-9]+))?", s, re.I)
        if not m:
            raise AddressError("address", "unrecognized S7 address "
                               "(use DB1.DBX0.3, DB1.DBD4, MW10, I0.0, ...)")
        area, db = m.group(1).upper(), None
        kind = (m.group(2) or "X").upper()
        byte, bit = int(m.group(3)), m.group(4)
    if byte > 65535:
        raise AddressError("address", "byte offset out of range")
    if kind == "X":
        if suffix:
            raise AddressError("address", "bit addresses take no type suffix")
        if bit is None or int(bit) > 7:
            raise AddressError("address", "bit address needs .0 to .7")
        dt = "bool"
    else:
        if bit is not None:
            raise AddressError("address", "word/dword address takes no bit")
        if kind == "W":
            dt = suffix or "int"
            if dt not in ("int", "word"):
                raise AddressError("address", "W addresses allow :int or :word")
        else:
            dt = suffix or "real"
            if dt not in ("dint", "real"):
                raise AddressError("address", "D addresses allow :dint or :real")
    _s7_check_type(dt, tag_type)
    out = {"area": area}
    if db is not None:
        out["db"] = db
    out["byte"] = byte
    if dt == "bool":
        out["bit"] = int(bit)
    out["datatype"] = dt
    return out


# ------------------------------------------------------------------ opcua

_NODE_ID = re.compile(r"ns=[0-9]+;(?:s=.+|i=[0-9]+|g=[0-9A-Fa-f-]{36}|b=[A-Za-z0-9+/=]+)")


def _opcua(raw: object, tag_type: str) -> dict:
    if isinstance(raw, dict):
        _check_keys(raw, {"node_id"}, "address")
        if "node_id" not in raw:
            raise AddressError("address.node_id", "required")
        raw = raw["node_id"]
    if not isinstance(raw, str) or not _NODE_ID.fullmatch(raw.strip()):
        raise AddressError("address", "node id must look like ns=3;s=Name "
                           "(also i=, g=, b=)")
    return {"node_id": raw.strip()}


# -------------------------------------------------------------------- sim

def _sim(raw: object, tag_type: str) -> dict:
    if not isinstance(raw, dict):
        raise AddressError("address", "must be an object")
    _check_keys(raw, {"behavior", "initial", "follows", "invert", "gain", "offset",
                      "lag", "period", "lo", "hi"}, "address")
    if not isinstance(raw.get("behavior"), str) or not raw["behavior"]:
        raise AddressError("address.behavior", "required string")
    for k in ("gain", "offset", "lag", "period", "lo", "hi"):
        v = raw.get(k)
        if v is not None and (isinstance(v, bool) or not isinstance(v, (int, float))
                              or not math.isfinite(v)):
            raise AddressError(f"address.{k}", "must be a finite number")
    f = raw.get("follows")
    if f is not None and (not isinstance(f, str)
                          or not re.fullmatch(r"[a-z0-9_]+(/[a-z0-9_]+){1,7}", f)):
        raise AddressError("address.follows", "must be a tag path")
    if "invert" in raw and not isinstance(raw["invert"], bool):
        raise AddressError("address.invert", "must be true or false")
    return dict(raw)


_PARSERS = {"modbus": _modbus, "s7": _s7, "opcua": _opcua, "sim": _sim}


def parse_address(protocol: str, raw: str | dict, tag_type: str) -> dict:
    """Normalize user input into the jsonb address for `protocol`.

    tag_type == "bool" requires a bit/coil address; anything else a
    word/register address.
    """
    parser = _PARSERS.get(protocol)
    if parser is None:
        raise AddressError("protocol", f"unknown protocol {protocol!r}")
    return parser(raw, tag_type)


# ------------------------------------------------------------- connection

def _host(conn: dict) -> str:
    h = conn.get("host")
    if not isinstance(h, str) or not h.strip() or any(c.isspace() for c in h.strip()):
        raise AddressError("connection.host", "required hostname or IP")
    return h.strip()


def validate_connection(protocol: str, conn: dict) -> dict:
    if protocol not in _PARSERS:
        raise AddressError("protocol", f"unknown protocol {protocol!r}")
    if not isinstance(conn, dict):
        raise AddressError("connection", "must be an object")
    if protocol == "sim":
        _check_keys(conn, set(), "connection")
        return {}
    if protocol == "opcua":
        _check_keys(conn, {"endpoint", "security", "auth"}, "connection")
        ep = conn.get("endpoint")
        if not isinstance(ep, str) or not re.fullmatch(r"opc\.tcp://\S+", ep.strip()):
            raise AddressError("connection.endpoint", "must start with opc.tcp://")
        sec = conn.get("security", "none")
        if sec not in ("none", "sign", "signencrypt"):
            raise AddressError("connection.security", "must be none, sign or signencrypt")
        auth = conn.get("auth", "anonymous")
        if auth not in ("anonymous", "user"):
            raise AddressError("connection.auth", "must be anonymous or user")
        if auth == "user" and sec == "none":
            raise AddressError("connection.auth",
                               "user auth requires security sign or signencrypt "
                               "(passwords are never sent unencrypted)")
        return {"endpoint": ep.strip(), "security": sec, "auth": auth}
    if protocol == "modbus":
        _check_keys(conn, {"host", "port", "unit_id", "timeout_ms"}, "connection")
        out = {"host": _host(conn), "port": conn.get("port", 502),
               "unit_id": conn.get("unit_id", 1),
               "timeout_ms": conn.get("timeout_ms", 2000)}
        bounds = {"port": (1, 65535), "unit_id": (0, 255), "timeout_ms": (100, 60000)}
    else:  # s7
        _check_keys(conn, {"host", "rack", "slot", "timeout_ms"}, "connection")
        out = {"host": _host(conn), "rack": conn.get("rack", 0),
               "slot": conn.get("slot", 1),
               "timeout_ms": conn.get("timeout_ms", 2000)}
        bounds = {"rack": (0, 7), "slot": (0, 31), "timeout_ms": (100, 60000)}
    for k, (lo, hi) in bounds.items():
        _int_in(out, k, lo, hi, "connection")
    return out
