"""Concrete-batching-plant dynamics for the sim adapter (Centrale a Beton).

Pure: `tick(values, tag, dt, rnd)` mutates the `values` dict. Writable flags
(`running`, `gate_open`, `open`, `door_open`, `enabled`) are the operator's
controls; read-only signals (levels, weights, speeds, currents, pressure)
always derive from those flags. With `batch/plant/auto/enabled` on, a
sequencer drives the flags through one batch cycle and repeats; with it off
the flags hold whatever the operator last wrote.

Cycle (CYCLE_S seconds):
  aggregates  -> bins 1..4 discharge in turn onto belt1, weigh1 climbs
  cement      -> screw1 feeds cem weigh hopper
  liquids     -> water valve + pump, admixture pump
  charge      -> weigh hoppers empty into the mixer (belt1 + screws run)
  mix         -> mixer runs, current follows load
  discharge   -> door opens, mixer empties, back to idle
"""

from __future__ import annotations

from typing import Callable

CYCLE_S = 60.0

BINS = (1, 2, 3, 4)
SILOS = (1, 2, 3, 4)

# (start, end) seconds of each stage inside the cycle
_AGG = (0.0, 12.0)
_CEM = (10.0, 20.0)
_LIQ = (14.0, 24.0)
_CHARGE = (26.0, 32.0)
_MIX = (32.0, 50.0)
_DISCH = (50.0, 58.0)

AGG_TARGET_KG = 1800.0
CEM_TARGET_KG = 300.0
LIQ_TARGET_KG = 160.0


def tails() -> list[str]:
    """Every tag tail this module reads or writes (for presence checks)."""
    t = ["plant/auto/enabled", "plant/auto/cycle_count", "plant/auto/stage",
         "agg/belt1/running", "agg/belt1/speed_mps", "agg/weigh1/weight_kg",
         "cem/weigh1/weight_kg", "liq/weigh1/weight_kg", "liq/water1/open",
         "liq/pump1/running", "liq/pump1/flow_lpm", "liq/admix1/running",
         "liq/admix1/flow_lpm", "air/blower1/running", "air/blower1/pressure_bar",
         "mix/mixer1/running", "mix/mixer1/current_a", "mix/mixer1/door_open"]
    for i in BINS:
        t += [f"agg/bin{i}/level_pct", f"agg/bin{i}/gate_open"]
    for i in SILOS:
        t += [f"cem/silo{i}/level_pct", f"cem/silo{i}/high_level",
              f"cem/silo{i}/low_level", f"cem/screw{i}/running"]
    return t


def _between(x: float, win: tuple[float, float]) -> bool:
    return win[0] <= x < win[1]


def _follow(cur: float, target: float, dt: float, lag: float) -> float:
    return cur + (target - cur) * min(dt / lag, 1.0)


def tick(values: dict, tag: Callable[[str], str], dt: float,
         rnd: Callable[[float, float], float]) -> None:
    g = lambda t: values[tag(t)]           # noqa: E731
    s = lambda t, v: values.__setitem__(tag(t), v)  # noqa: E731

    # ---- sequencer ----------------------------------------------------
    auto = bool(g("plant/auto/enabled"))
    if auto:
        phase = float(values.get(tag("plant/auto/stage"), 0.0))   # seconds into the cycle
        phase += dt
        if phase >= CYCLE_S:
            phase -= CYCLE_S
            s("plant/auto/cycle_count", float(g("plant/auto/cycle_count")) + 1)
        s("plant/auto/stage", round(phase, 2))
        s("air/blower1/running", True)
        # bins discharge one after another inside the aggregate window
        slot = (_AGG[1] - _AGG[0]) / len(BINS)
        for i in BINS:
            win = (_AGG[0] + (i - 1) * slot, _AGG[0] + i * slot)
            s(f"agg/bin{i}/gate_open", _between(phase, win))
        charge = _between(phase, _CHARGE)
        s("agg/belt1/running", _between(phase, _AGG) or charge)
        s("cem/screw1/running", _between(phase, _CEM) or charge)
        s("liq/water1/open", _between(phase, _LIQ) or charge)
        s("liq/pump1/running", _between(phase, _LIQ))
        s("liq/admix1/running", _between(phase, (_LIQ[0] + 2, _LIQ[1] - 2)))
        s("mix/mixer1/running", _between(phase, (_CHARGE[0], _DISCH[1])))
        s("mix/mixer1/door_open", _between(phase, _DISCH))
    else:
        s("plant/auto/stage", 0.0)

    # ---- aggregates ---------------------------------------------------
    belt = bool(g("agg/belt1/running"))
    s("agg/belt1/speed_mps", round(max(_follow(float(g("agg/belt1/speed_mps")),
                                                1.6 if belt else 0.0, dt, 1.5)
                                       + rnd(-0.01, 0.01), 0.0), 3))
    open_bins = [i for i in BINS if g(f"agg/bin{i}/gate_open")]
    for i in BINS:
        lvl = float(g(f"agg/bin{i}/level_pct"))
        if i in open_bins:
            lvl -= 2.2 * dt                       # discharging
        elif lvl < 100.0:
            lvl += 0.25 * dt                      # loader keeps topping up
        s(f"agg/bin{i}/level_pct", round(min(max(lvl, 0.0), 100.0), 2))
    w = float(g("agg/weigh1/weight_kg"))
    if open_bins and belt:
        w += (AGG_TARGET_KG / (_AGG[1] - _AGG[0])) * dt
    elif auto and _between(float(g("plant/auto/stage")), _CHARGE):
        w -= (AGG_TARGET_KG / (_CHARGE[1] - _CHARGE[0])) * dt
    s("agg/weigh1/weight_kg", round(min(max(w, 0.0), AGG_TARGET_KG * 1.1), 1))

    # ---- cement -------------------------------------------------------
    screws = [i for i in SILOS if g(f"cem/screw{i}/running")]
    cw = float(g("cem/weigh1/weight_kg"))
    if screws and not _charging(auto, g):
        cw += (CEM_TARGET_KG / (_CEM[1] - _CEM[0])) * dt * len(screws)
    elif _charging(auto, g):
        cw -= (CEM_TARGET_KG / (_CHARGE[1] - _CHARGE[0])) * dt
    s("cem/weigh1/weight_kg", round(min(max(cw, 0.0), CEM_TARGET_KG * 1.1), 1))
    for i in SILOS:
        lvl = float(g(f"cem/silo{i}/level_pct"))
        lvl += -0.9 * dt if i in screws else 0.02 * dt   # screw draws, bulk tanker refills slowly
        lvl = min(max(lvl, 0.0), 100.0)
        s(f"cem/silo{i}/level_pct", round(lvl, 2))
        s(f"cem/silo{i}/high_level", lvl >= 90.0)
        s(f"cem/silo{i}/low_level", lvl <= 10.0)

    # ---- liquids ------------------------------------------------------
    pump = bool(g("liq/pump1/running"))
    admix = bool(g("liq/admix1/running"))
    s("liq/pump1/flow_lpm", round(max(_follow(float(g("liq/pump1/flow_lpm")),
                                              180.0 if pump and g("liq/water1/open") else 0.0, dt, 1.0)
                                      + rnd(-0.3, 0.3), 0.0), 1))
    s("liq/admix1/flow_lpm", round(max(_follow(float(g("liq/admix1/flow_lpm")),
                                               12.0 if admix else 0.0, dt, 1.0)
                                       + rnd(-0.05, 0.05), 0.0), 2))
    lw = float(g("liq/weigh1/weight_kg"))
    if pump and g("liq/water1/open"):
        lw += (LIQ_TARGET_KG / (_LIQ[1] - _LIQ[0])) * dt
    elif _charging(auto, g):
        lw -= (LIQ_TARGET_KG / (_CHARGE[1] - _CHARGE[0])) * dt
    s("liq/weigh1/weight_kg", round(min(max(lw, 0.0), LIQ_TARGET_KG * 1.1), 1))

    # ---- air ----------------------------------------------------------
    blower = bool(g("air/blower1/running"))
    s("air/blower1/pressure_bar", round(_follow(float(g("air/blower1/pressure_bar")),
                                                0.8 if blower else 0.0, dt, 3.0)
                                        + rnd(-0.005, 0.005), 3))

    # ---- mixer --------------------------------------------------------
    mixer = bool(g("mix/mixer1/running"))
    loaded = float(g("agg/weigh1/weight_kg")) + float(g("cem/weigh1/weight_kg")) > 1.0
    target = 0.0
    if mixer:
        target = 70.0 if g("mix/mixer1/door_open") else 95.0 if loaded else 55.0
    s("mix/mixer1/current_a", round(max(_follow(float(g("mix/mixer1/current_a")), target, dt, 2.0)
                                        + rnd(-0.3, 0.3), 0.0), 1))


def _charging(auto: bool, g) -> bool:
    return auto and _between(float(g("plant/auto/stage")), _CHARGE)
