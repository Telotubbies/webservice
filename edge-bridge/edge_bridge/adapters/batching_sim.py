"""Concrete-batching-plant dynamics for the sim adapter (Centrale a Beton).

Pure: `tick(values, tag, dt, rnd)` mutates the `values` dict. Writable flags
(`running`, `gate_open`, `open`, `door_open`, `enabled`) and the recipe
targets are the operator's controls; read-only signals (levels, weights,
speeds, currents, pressures, positions) always derive from them. With
`batch/plant/auto/enabled` on, a sequencer drives the flags through one batch
cycle and repeats; with it off the flags hold whatever the operator last wrote.

The equipment follows the plant's 3D model part for part: four aggregate
bins over feeder belts 1-3 (bins 1-2) and 5-6 (bins 3-4), collector belt 4
to the skip hoist, the skip weigher lifted into the mixer, four cement silos
with screws into the cement weigh hopper, the water tank, liquid weigher and
admixture drums, the Roots blower that fills the silos through the DN100
pipe, the mixer dust filter, and the truck lane under the mixer.

Cycle (CYCLE_S seconds):
  aggregates  -> bins 1..4 discharge in turn, feeders + collector run, skip weigher fills
  cement      -> the screw of this cycle's silo feeds the cement weigh hopper
  liquids     -> water valve + pump fill the liquid weigher, admixture pump runs
  charge      -> skip rises and tips, weighers empty into the mixer
  mix         -> mixer runs, current follows load, a truck pulls in underneath
  discharge   -> door opens, the truck is loaded, the batch is counted
"""

from __future__ import annotations

from typing import Callable

CYCLE_S = 60.0
BATCH_M3 = 1.0

BINS = (1, 2, 3, 4)
SILOS = (1, 2, 3, 4)
FEEDERS = {1: (1, 2, 3), 2: (1, 2, 3), 3: (5, 6), 4: (5, 6)}   # bin -> belts under it
BELTS = (1, 2, 3, 4, 5, 6)
COLLECTOR = 4
DRUMS = (1, 2)

# (start, end) seconds of each stage inside the cycle
_AGG = (0.0, 12.0)
_CEM = (10.0, 20.0)
_LIQ = (14.0, 24.0)
_CHARGE = (26.0, 32.0)
_SKIP_UP = (26.0, 29.0)
_SKIP_DOWN = (32.0, 36.0)
_MIX = (32.0, 50.0)
_DISCH = (50.0, 58.0)

AGG_TARGET_KG = 1800.0
CEM_TARGET_KG = 300.0
LIQ_TARGET_KG = 160.0

STEPS = ("idle", "aggregates", "cement", "liquids", "charging", "mixing", "discharging")


def tails() -> list[str]:
    """Every tag tail this module reads or writes (for presence checks)."""
    t = ["plant/auto/enabled", "plant/auto/cycle_count", "plant/auto/stage", "plant/auto/step",
         "plant/production/m3_total", "plant/production/rate_m3h",
         "plant/recipe/agg_target_kg", "plant/recipe/cem_target_kg", "plant/recipe/water_target_kg",
         "agg/weigh1/weight_kg", "agg/skip1/position_pct", "agg/skip1/moving", "agg/skip1/motor_temp_c",
         "cem/weigh1/weight_kg", "cem/weigh1/level_pct",
         "liq/tank1/level_pct", "liq/tank1/low_level", "liq/water1/open",
         "liq/pump1/running", "liq/pump1/flow_lpm", "liq/weigh1/weight_kg", "liq/weigh1/level_pct",
         "liq/weigh1/discharging", "liq/admix1/running", "liq/admix1/flow_lpm",
         "air/blower1/running", "air/blower1/pressure_bar", "air/fill1/flowing",
         "air/filter1/active", "air/filter1/dp_mbar",
         "mix/mixer1/running", "mix/mixer1/current_a", "mix/mixer1/door_open",
         "mix/truck/present", "mix/truck/count"]
    for i in BINS:
        t += [f"agg/bin{i}/level_pct", f"agg/bin{i}/gate_open", f"agg/bin{i}/low_level"]
    for i in BELTS:
        t += [f"agg/belt{i}/running", f"agg/belt{i}/speed_mps"]
    for i in SILOS:
        t += [f"cem/silo{i}/level_pct", f"cem/silo{i}/high_level",
              f"cem/silo{i}/low_level", f"cem/silo{i}/filling", f"cem/screw{i}/running"]
    for i in DRUMS:
        t += [f"liq/drum{i}/level_pct"]
    return t


def _between(x: float, win: tuple[float, float]) -> bool:
    return win[0] <= x < win[1]


def _follow(cur: float, target: float, dt: float, lag: float) -> float:
    return cur + (target - cur) * min(dt / lag, 1.0)


def _clamp(x: float, lo: float, hi: float) -> float:
    return min(max(x, lo), hi)


def _step_of(phase: float) -> int:
    for idx, win in ((6, _DISCH), (5, _MIX), (4, _CHARGE), (3, _LIQ), (2, _CEM), (1, _AGG)):
        if _between(phase, win):
            return idx
    return 0


def tick(values: dict, tag: Callable[[str], str], dt: float,
         rnd: Callable[[float, float], float]) -> None:
    g = lambda t: values[tag(t)]           # noqa: E731
    s = lambda t, v: values.__setitem__(tag(t), v)  # noqa: E731
    num = lambda t, d: float(values.get(tag(t), d) or d)  # noqa: E731

    agg_target = num("plant/recipe/agg_target_kg", AGG_TARGET_KG)
    cem_target = num("plant/recipe/cem_target_kg", CEM_TARGET_KG)
    liq_target = num("plant/recipe/water_target_kg", LIQ_TARGET_KG)

    # ---- sequencer ----------------------------------------------------
    auto = bool(g("plant/auto/enabled"))
    cycle = int(float(g("plant/auto/cycle_count")))
    phase = float(values.get(tag("plant/auto/stage"), 0.0))
    if auto:
        prev = phase
        phase += dt
        if prev < _DISCH[1] <= phase:                  # discharge finished: one truck loaded
            s("mix/truck/count", float(g("mix/truck/count")) + 1)
            s("plant/production/m3_total", round(float(g("plant/production/m3_total")) + BATCH_M3, 3))
        if phase >= CYCLE_S:
            phase -= CYCLE_S
            cycle += 1
            s("plant/auto/cycle_count", float(cycle))
        s("plant/auto/stage", round(phase, 2))
        s("plant/auto/step", float(_step_of(phase)))
        slot = (_AGG[1] - _AGG[0]) / len(BINS)
        for i in BINS:
            win = (_AGG[0] + (i - 1) * slot, _AGG[0] + i * slot)
            s(f"agg/bin{i}/gate_open", _between(phase, win))
        active_silo = cycle % len(SILOS) + 1
        for i in SILOS:
            s(f"cem/screw{i}/running", i == active_silo and _between(phase, _CEM))
        s("liq/water1/open", _between(phase, _LIQ))
        s("liq/pump1/running", _between(phase, _LIQ))
        s("liq/admix1/running", _between(phase, (_LIQ[0] + 2, _LIQ[1] - 2)))
        s("mix/mixer1/running", _between(phase, (_CHARGE[0], _DISCH[1])))
        s("mix/mixer1/door_open", _between(phase, _DISCH))
    else:
        s("plant/auto/stage", 0.0)
        s("plant/auto/step", 0.0)
    charging = auto and _between(phase, _CHARGE)

    # ---- aggregates ---------------------------------------------------
    open_bins = [i for i in BINS if g(f"agg/bin{i}/gate_open")]
    if auto:
        feeding = {b for i in open_bins for b in FEEDERS[i]}
        for b in BELTS:
            s(f"agg/belt{b}/running", b in feeding or (b == COLLECTOR and _between(phase, _AGG)))
    for b in BELTS:
        on = bool(g(f"agg/belt{b}/running"))
        s(f"agg/belt{b}/speed_mps", round(max(_follow(float(g(f"agg/belt{b}/speed_mps")),
                                                      (1.6 if b == COLLECTOR else 0.9) if on else 0.0, dt, 1.5)
                                              + rnd(-0.01, 0.01), 0.0), 3))
    for i in BINS:
        lvl = float(g(f"agg/bin{i}/level_pct"))
        if i in open_bins:
            lvl -= 2.2 * dt                       # discharging
        elif lvl < 100.0:
            lvl += 0.25 * dt                      # loader keeps topping up
        lvl = _clamp(lvl, 0.0, 100.0)
        s(f"agg/bin{i}/level_pct", round(lvl, 2))
        s(f"agg/bin{i}/low_level", lvl <= 15.0)
    w = float(g("agg/weigh1/weight_kg"))
    if open_bins and g(f"agg/belt{COLLECTOR}/running"):
        w += (agg_target / (_AGG[1] - _AGG[0])) * dt
    elif charging:
        w -= (agg_target / (_CHARGE[1] - _CHARGE[0])) * dt
    s("agg/weigh1/weight_kg", round(_clamp(w, 0.0, agg_target * 1.1), 1))

    # skip hoist: up, tip into the mixer, back down
    pos = float(g("agg/skip1/position_pct"))
    if auto:
        if _between(phase, _SKIP_UP):
            pos += 100.0 / (_SKIP_UP[1] - _SKIP_UP[0]) * dt
        elif _between(phase, _SKIP_DOWN):
            pos -= 100.0 / (_SKIP_DOWN[1] - _SKIP_DOWN[0]) * dt
        elif not _between(phase, (_SKIP_UP[1], _SKIP_DOWN[0])):
            pos -= 100.0 / (_SKIP_DOWN[1] - _SKIP_DOWN[0]) * dt   # park at the bottom
    pos = _clamp(pos, 0.0, 100.0)
    moving = auto and (_between(phase, _SKIP_UP) or _between(phase, _SKIP_DOWN))
    s("agg/skip1/position_pct", round(pos, 2))
    s("agg/skip1/moving", moving)
    s("agg/skip1/motor_temp_c", round(_follow(float(g("agg/skip1/motor_temp_c")),
                                              68.0 if moving else 34.0, dt, 40.0) + rnd(-0.02, 0.02), 2))

    # ---- cement -------------------------------------------------------
    screws = [i for i in SILOS if g(f"cem/screw{i}/running")]
    cw = float(g("cem/weigh1/weight_kg"))
    if screws and not charging:
        cw += (cem_target / (_CEM[1] - _CEM[0])) * dt * len(screws)
    elif charging:
        cw -= (cem_target / (_CHARGE[1] - _CHARGE[0])) * dt
    cw = _clamp(cw, 0.0, cem_target * 1.1)
    s("cem/weigh1/weight_kg", round(cw, 1))
    s("cem/weigh1/level_pct", round(_clamp(cw / (cem_target * 1.15) * 100.0, 0.0, 100.0), 1))

    # bulk tanker refills a low silo pneumatically: the blower pushes cement up DN100
    filling = {}
    for i in SILOS:
        lvl = float(g(f"cem/silo{i}/level_pct"))
        f = bool(g(f"cem/silo{i}/filling"))
        if lvl <= 10.0:
            f = True
        elif lvl >= 90.0:
            f = False
        filling[i] = f
    if auto:
        s("air/blower1/running", any(filling.values()))
    blower = bool(g("air/blower1/running"))
    for i in SILOS:
        lvl = float(g(f"cem/silo{i}/level_pct"))
        if i in screws:
            lvl -= 0.9 * dt                        # screw draws
        if filling[i] and blower:
            lvl += 3.0 * dt
        lvl = _clamp(lvl, 0.0, 100.0)
        s(f"cem/silo{i}/level_pct", round(lvl, 2))
        s(f"cem/silo{i}/high_level", lvl >= 90.0)
        s(f"cem/silo{i}/low_level", lvl <= 10.0)
        s(f"cem/silo{i}/filling", filling[i])
    s("air/fill1/flowing", blower and any(filling.values()))

    # ---- liquids ------------------------------------------------------
    pump = bool(g("liq/pump1/running"))
    valve = bool(g("liq/water1/open"))
    admix = bool(g("liq/admix1/running"))
    s("liq/pump1/flow_lpm", round(max(_follow(float(g("liq/pump1/flow_lpm")),
                                              180.0 if pump and valve else 0.0, dt, 1.0)
                                      + rnd(-0.3, 0.3), 0.0), 1))
    s("liq/admix1/flow_lpm", round(max(_follow(float(g("liq/admix1/flow_lpm")),
                                               12.0 if admix else 0.0, dt, 1.0)
                                       + rnd(-0.05, 0.05), 0.0), 2))
    lw = float(g("liq/weigh1/weight_kg"))
    if pump and valve:
        lw += (liq_target / (_LIQ[1] - _LIQ[0])) * dt
    elif charging:
        lw -= (liq_target / (_CHARGE[1] - _CHARGE[0])) * dt
    lw = _clamp(lw, 0.0, liq_target * 1.1)
    s("liq/weigh1/weight_kg", round(lw, 1))
    s("liq/weigh1/level_pct", round(_clamp(lw / (liq_target * 1.15) * 100.0, 0.0, 100.0), 1))
    s("liq/weigh1/discharging", charging and lw > 0.5)
    tank = float(g("liq/tank1/level_pct"))
    tank += (-0.45 if pump and valve else 0.15) * dt    # mains refill is slower than the pump
    tank = _clamp(tank, 0.0, 100.0)
    s("liq/tank1/level_pct", round(tank, 2))
    s("liq/tank1/low_level", tank <= 20.0)
    drum = cycle % len(DRUMS) + 1
    for i in DRUMS:
        lvl = float(g(f"liq/drum{i}/level_pct"))
        if admix and i == drum:
            lvl -= 0.35 * dt
        if lvl <= 3.0:
            lvl = 100.0                            # operator swaps in a full drum
        s(f"liq/drum{i}/level_pct", round(_clamp(lvl, 0.0, 100.0), 2))

    # ---- air ----------------------------------------------------------
    s("air/blower1/pressure_bar", round(max(_follow(float(g("air/blower1/pressure_bar")),
                                                    0.8 if blower else 0.0, dt, 3.0)
                                            + rnd(-0.005, 0.005), 0.0), 3))
    dusty = bool(screws) or charging
    s("air/filter1/active", dusty)
    s("air/filter1/dp_mbar", round(max(_follow(float(g("air/filter1/dp_mbar")),
                                               14.0 if dusty else 3.0, dt, 4.0) + rnd(-0.05, 0.05), 0.0), 2))

    # ---- mixer --------------------------------------------------------
    mixer = bool(g("mix/mixer1/running"))
    door = bool(g("mix/mixer1/door_open"))
    loaded = float(g("agg/weigh1/weight_kg")) + float(g("cem/weigh1/weight_kg")) > 1.0 or \
        (auto and _between(phase, (_CHARGE[0], _DISCH[0])))
    target = 0.0
    if mixer:
        target = 70.0 if door else 95.0 if loaded else 55.0
    s("mix/mixer1/current_a", round(max(_follow(float(g("mix/mixer1/current_a")), target, dt, 2.0)
                                        + rnd(-0.3, 0.3), 0.0), 1))
    if auto:
        s("mix/truck/present", _between(phase, (_MIX[0], _DISCH[1])))

    # ---- production rate ----------------------------------------------
    rate = BATCH_M3 * 3600.0 / CYCLE_S if auto else 0.0
    s("plant/production/rate_m3h", round(max(_follow(float(g("plant/production/rate_m3h")), rate, dt, 10.0), 0.0), 2))
