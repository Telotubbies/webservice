"""Concrete batching plant (Centrale a Beton): the demo site's ISA-95
hierarchy and the bindings of its 3D model parts, both keyed by tag path so
they line up with `edge-bridge/tags.yaml` (area `batch`) and the sim dynamics
in `edge_bridge/adapters/batching_sim.py`.

`seed_hierarchy` is idempotent (deterministic ids) and runs from the dev seed
under SEED_PROFILE=concrete. `rebind_parts` maps the parts of an uploaded
.glb (picked by hand in the mapping editor) onto the plant's real signals.
"""

from __future__ import annotations

import uuid
from typing import TypedDict

AREA = ("batch", "Batching plant")


class Equip(TypedDict):
    name: str
    kind: str        # devices.kind
    prefix: str      # tag path prefix under the site, e.g. "batch/agg/bin1"


def _eq(name: str, kind: str, prefix: str) -> Equip:
    return {"name": name, "kind": kind, "prefix": f"batch/{prefix}"}


# line name -> equipment on that line (ISA-95 units of the batching plant)
LINES: dict[str, list[Equip]] = {
    "Aggregates": [
        *[_eq(f"Aggregate bin {i}", "vessel", f"agg/bin{i}") for i in range(1, 5)],
        *[_eq(f"Belt conveyor {i}", "conveyor", f"agg/belt{i}") for i in range(1, 7)],
        _eq("Skip hoist", "other", "agg/skip1"),
        _eq("Skip weigher", "vessel", "agg/weigh1"),
    ],
    "Cement": [
        *[_eq(f"Cement silo {i}", "vessel", f"cem/silo{i}") for i in range(1, 5)],
        *[_eq(f"Cement screw {i}", "conveyor", f"cem/screw{i}") for i in range(1, 5)],
        _eq("Cement weigh hopper", "vessel", "cem/weigh1"),
    ],
    "Liquids": [
        _eq("Water tank", "vessel", "liq/tank1"),
        _eq("Water valve", "valve", "liq/water1"),
        _eq("Water pump", "pump", "liq/pump1"),
        _eq("Liquid weigher", "vessel", "liq/weigh1"),
        _eq("Admixture pump", "pump", "liq/admix1"),
        _eq("Admixture drum 1", "vessel", "liq/drum1"),
        _eq("Admixture drum 2", "vessel", "liq/drum2"),
    ],
    "Air": [
        _eq("Roots blower", "pump", "air/blower1"),
        _eq("Silo fill line", "indicator", "air/fill1"),
        _eq("Mixer dust filter", "indicator", "air/filter1"),
    ],
    "Mixing": [
        _eq("Mixer", "mixer", "mix/mixer1"),
        _eq("Truck lane", "indicator", "mix/truck"),
    ],
    "Control": [
        _eq("Batch controller", "other", "plant"),
    ],
}


def _id(site: uuid.UUID, key: str) -> uuid.UUID:
    return uuid.uuid5(site, key)


def device_id(site: uuid.UUID, prefix: str) -> uuid.UUID:
    return _id(site, f"device:{prefix}")


async def seed_hierarchy(tc, org: uuid.UUID, site: uuid.UUID) -> None:
    """Area > lines > equipment, and every batch tag attached to the
    equipment whose prefix owns its path."""
    area = _id(site, f"area:{AREA[0]}")
    await tc.execute(
        "INSERT INTO areas(id, org_id, site_id, name, code, sort) VALUES ($1,$2,$3,$4,$5,0)"
        " ON CONFLICT (org_id, site_id, code) DO UPDATE SET name = excluded.name",
        area, org, site, AREA[1], AREA[0])
    for sort, (line_name, equipment) in enumerate(LINES.items()):
        line = _id(site, f"line:{line_name}")
        await tc.execute(
            "INSERT INTO lines(id, org_id, site_id, name, area_id, kind) VALUES ($1,$2,$3,$4,$5,'unit')"
            " ON CONFLICT (org_id, site_id, name) DO UPDATE SET area_id = excluded.area_id",
            line, org, site, line_name, area)
        for e in equipment:
            dev = device_id(site, e["prefix"])
            await tc.execute(
                "INSERT INTO devices(id, org_id, line_id, name, kind) VALUES ($1,$2,$3,$4,$5)"
                " ON CONFLICT (org_id, line_id, name) DO UPDATE SET kind = excluded.kind",
                dev, org, line, e["name"], e["kind"])
            await tc.execute(
                "UPDATE tags SET device_id = $3 WHERE site_id = $1"
                " AND (path = $2 OR path LIKE $2 || '/%') AND device_id IS DISTINCT FROM $3",
                site, e["prefix"], dev)
        del sort


class PartSpec(TypedDict, total=False):
    label: str
    kind: str
    bindings: dict[str, str]
    device: str               # equipment prefix (without "batch/")
    params: dict


def _b(**roles: str) -> dict[str, str]:
    return {k: f"batch/{v}" for k, v in roles.items()}


# part label in the uploaded model -> its role in the plant; None drops a part
# that auto-setup picked up but is not equipment (a walkway railing).
PARTS: dict[str, PartSpec | None] = {
    "Skip hoist": {"label": "Skip hoist", "kind": "slider", "device": "agg/skip1",
                   "bindings": _b(position="agg/skip1/position_pct", run="agg/skip1/moving")},
    "Mixer": {"label": "Mixer", "kind": "mixer", "device": "mix/mixer1",
              "bindings": _b(run="mix/mixer1/running", current="mix/mixer1/current_a", door="mix/mixer1/door_open")},
    "Weigh hopper": {"label": "Cement weigh hopper", "kind": "vessel", "device": "cem/weigh1",
                     "bindings": _b(level="cem/weigh1/level_pct", weight="cem/weigh1/weight_kg")},
    "Liquid tank 2": {"label": "Liquid weigher", "kind": "vessel", "device": "liq/weigh1",
                      "bindings": _b(level="liq/weigh1/level_pct", weight="liq/weigh1/weight_kg")},
    "Liquid tank 1": {"label": "Water tank", "kind": "vessel", "device": "liq/tank1",
                      "bindings": _b(level="liq/tank1/level_pct", low="liq/tank1/low_level")},
    "Blower": {"label": "Roots blower", "kind": "pump", "device": "air/blower1",
               "bindings": _b(run="air/blower1/running", pressure="air/blower1/pressure_bar")},
    "Motor": {"label": "Skip winch motor", "kind": "indicator", "device": "agg/skip1",
              "bindings": _b(state="agg/skip1/moving", value="agg/skip1/motor_temp_c"), "params": {}},
    "Dust filter 2": {"label": "Mixer dust filter", "kind": "indicator", "device": "air/filter1",
                      "bindings": _b(state="air/filter1/active", value="air/filter1/dp_mbar")},
    "Dust filter 1": None,
    "Pipe line DN100": {"label": "Silo fill line DN100", "kind": "pipe", "device": "air/fill1",
                        "bindings": _b(run="air/fill1/flowing"), "params": {"color": "cement"}},
    "Pipe line DN125": {"label": "Blower air line DN125", "kind": "pipe", "device": "air/blower1",
                        "bindings": _b(run="air/blower1/running"), "params": {"color": "air"}},
    "Pipe line DN40": {"label": "Water line DN40", "kind": "pipe", "device": "liq/weigh1",
                       "bindings": _b(run="liq/weigh1/discharging", flow="liq/pump1/flow_lpm"),
                       "params": {"color": "water"}},
    **{f"Drum emptier {i}": {"label": f"Admixture drum {i}", "kind": "vessel", "device": f"liq/drum{i}",
                             "bindings": _b(level=f"liq/drum{i}/level_pct")} for i in (1, 2)},
    **{f"Belt conveyor {i}": {"label": f"Belt conveyor {i}", "kind": "conveyor", "device": f"agg/belt{i}",
                              "bindings": _b(run=f"agg/belt{i}/running", speed=f"agg/belt{i}/speed_mps")}
       for i in range(1, 7)},
    **{f"Belt conveyor {i}": {"label": f"Truck lane {i - 6}", "kind": "indicator", "device": "mix/truck",
                              "bindings": _b(state="mix/truck/present"), "params": {}} for i in (7, 8)},
    **{f"Aggregate bin {i}": {"label": f"Aggregate bin {i}", "kind": "vessel", "device": f"agg/bin{i}",
                              "bindings": _b(level=f"agg/bin{i}/level_pct", low=f"agg/bin{i}/low_level")}
       for i in range(1, 5)},
    **{f"Cement silo {i}": {"label": f"Cement silo {i}", "kind": "vessel", "device": f"cem/silo{i}",
                            "bindings": _b(level=f"cem/silo{i}/level_pct", high=f"cem/silo{i}/high_level",
                                           low=f"cem/silo{i}/low_level")} for i in range(1, 5)},
}


def rebind(part: dict, site: uuid.UUID) -> dict | None:
    """New row values for one exported part, or None to drop it. Unknown
    labels keep their bindings (nothing is guessed)."""
    spec = PARTS.get(part["label"], part)
    if spec is None:
        return None
    if spec is part:
        return dict(part)
    # same kind: keep the motion settings tuned in the editor; new kind: its own params only
    extra = spec.get("params") or {}
    params = {**(part.get("params") or {}), **extra} if spec["kind"] == part["kind"] else dict(extra)
    return {**part, "label": spec["label"], "kind": spec["kind"], "bindings": spec["bindings"],
            "params": params, "device_id": str(device_id(site, f"batch/{spec['device']}"))}
