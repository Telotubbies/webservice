"""Equipment kinds a plant-model part can be mapped to, and the signal roles
each kind exposes. The browser draws behaviour from this table (served by
GET /api/v1/plant-kinds), so there is one source of truth.

A role is bound to ONE tag path of the site. `writable` roles may only be
bound to a writable tag: the faceplate then offers the command through the
normal command path (RBAC, interlocks, audit) — a binding never writes by
itself.
"""

from __future__ import annotations

from typing import TypedDict


class Role(TypedDict):
    type: str          # 'bool' | 'number' — the tag type this role accepts
    label: str
    writable: bool     # role is a control: needs a writable tag


class Param(TypedDict, total=False):
    type: str          # 'number' | 'vec3' | 'enum' | 'bool'
    label: str
    min: float
    max: float
    default: object
    options: list[str]


class Kind(TypedDict):
    label: str
    behavior: str      # what the 3D/2D twin does with it
    roles: dict[str, Role]
    params: dict[str, Param]


def _r(type_: str, label: str, writable: bool = False) -> Role:
    return {"type": type_, "label": label, "writable": writable}


def _num(label: str, lo: float, hi: float, default: float) -> Param:
    return {"type": "number", "label": label, "min": lo, "max": hi, "default": default}


_SPIN: dict[str, Param] = {
    "self": {"type": "bool", "label": "Rotate the model nodes themselves", "default": False},
    "axis": {"type": "enum", "label": "Rotation axis", "options": ["x", "y", "z"], "default": "y"},
    "rpm": _num("Speed (rpm)", 1, 300, 60),
}


KINDS: dict[str, Kind] = {
    "motor": {
        "label": "Motor / blower", "behavior": "spin",
        "roles": {"run": _r("bool", "Run", True), "speed": _r("number", "Speed setpoint", True),
                  "fault": _r("bool", "Fault"), "temp": _r("number", "Temperature")},
        "params": _SPIN,
    },
    "conveyor": {
        "label": "Belt / screw conveyor", "behavior": "belt",
        "roles": {"run": _r("bool", "Run", True), "speed": _r("number", "Belt speed"),
                  "temp": _r("number", "Temperature"), "fault": _r("bool", "Fault")},
        "params": {"axis": {"type": "enum", "label": "Travel axis", "options": ["auto", "x", "z"], "default": "auto"},
                   "reverse": {"type": "bool", "label": "Reverse direction", "default": False}},
    },
    "vessel": {
        "label": "Bin / silo / hopper / tank", "behavior": "level",
        "roles": {"level": _r("number", "Level %"), "weight": _r("number", "Weight"),
                  "high": _r("bool", "High-level switch"), "low": _r("bool", "Low-level switch")},
        "params": {"fill": {"type": "bool", "label": "Show material inside", "default": True}},
    },
    "valve": {
        "label": "Valve / gate", "behavior": "open",
        "roles": {"open": _r("bool", "Open", True), "position": _r("number", "Position %")},
        "params": {},
    },
    "pump": {
        "label": "Pump / compressor", "behavior": "spin",
        "roles": {"run": _r("bool", "Run", True), "flow": _r("number", "Flow"),
                  "pressure": _r("number", "Pressure"), "fault": _r("bool", "Fault")},
        "params": _SPIN,
    },
    "mixer": {
        "label": "Mixer", "behavior": "spin",
        "roles": {"run": _r("bool", "Run", True), "current": _r("number", "Motor current"),
                  "door": _r("bool", "Discharge door open", True)},
        "params": {**_SPIN, "mix": {"type": "bool", "label": "Show concrete mixing inside", "default": True}},
    },
    "indicator": {
        "label": "Indicator only", "behavior": "tint",
        "roles": {"state": _r("bool", "State"), "value": _r("number", "Value")},
        "params": {},
    },
    "pipe": {
        "label": "Pipe line (shows flow)", "behavior": "flow",
        "roles": {"run": _r("bool", "Flowing"), "flow": _r("number", "Flow rate")},
        "params": {"reverse": {"type": "bool", "label": "Reverse direction", "default": False},
                   "color": {"type": "enum", "label": "Fluid", "options": ["water", "air", "cement", "admixture"],
                             "default": "water"}},
    },
    "slider": {
        "label": "Moving carriage / skip / bucket", "behavior": "slide",
        "roles": {"position": _r("number", "Position %"), "run": _r("bool", "Moving")},
        "params": {"dir": {"type": "vec3", "label": "Travel direction (x, y, z)", "default": [0, 1, 0]},
                   "dist": _num("Travel distance (% of plant width)", 0.5, 100, 20),
                   "period": _num("Cycle time when only `run` is bound (s)", 2, 120, 12)},
    },
}

MAX_BINDINGS = 8


def clean_params(kind: str, params: dict) -> dict:
    """Keep only the kind's declared params, coerced and clamped. Raises
    ValueError with a client-safe message on a bad value."""
    spec = KINDS[kind]["params"]
    out: dict = {}
    for k, v in params.items():
        p = spec.get(k)
        if p is None:
            raise ValueError(f"unknown param {k!r} for {kind}")
        t = p["type"]
        if t == "number":
            if isinstance(v, bool) or not isinstance(v, (int, float)):
                raise ValueError(f"{k} must be a number")
            out[k] = min(max(float(v), p["min"]), p["max"])
        elif t == "bool":
            if not isinstance(v, bool):
                raise ValueError(f"{k} must be true or false")
            out[k] = v
        elif t == "enum":
            if v not in p["options"]:
                raise ValueError(f"{k} must be one of {p['options']}")
            out[k] = v
        elif t == "vec3":
            if (not isinstance(v, list) or len(v) != 3
                    or any(isinstance(x, bool) or not isinstance(x, (int, float)) for x in v)):
                raise ValueError(f"{k} must be three numbers")
            out[k] = [max(-1.0, min(1.0, float(x))) for x in v]
    return out
