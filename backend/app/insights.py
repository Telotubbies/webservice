"""Insight engine (doc 19 §4, UI v3) — real statistical inference over
tag_history, run as a periodic task mirroring AlarmEngine's structure.

Detectors (per numeric tag, every INSIGHT_PERIOD_S):

  anomaly   |z| >= INSIGHT_ANOM_Z vs an EWMA baseline (window INSIGHT_BASE_S,
            alpha ~0.05 per sample); INSIGHT_OPEN_N consecutive out-of-band
            good samples open, INSIGHT_CLOSE_N consecutive in-band close.
            score = |z|; |z| > 6 -> warning else info.
  drift     OLS slope over a 30-min good-sample window exceeding
            max(tag_deadband_min, 0.5*sigma_baseline) / 10 min with residual
            sigma < 0.5*sigma_baseline. score = |slope|*window/sigma; info.
  flatline  zero variance across INSIGHT_FLAT_S of good samples while at
            least one peer numeric tag in the same org moved (sensor-stuck
            suspicion). score = flat minutes; warning.
  flapping  >= INSIGHT_FLAP_N good<->non-good quality transitions inside
            INSIGHT_FLAP_S. score = transition count; info.

Cold start (no backfill): each tag's streak/window state only accumulates
samples ingested after process start (watermark `started_at`); ts_start of a
fresh open is the first offending sample's ts. Pre-start history is used ONCE
per tag to warm the EWMA baseline (statistics only — it can never open an
insight, otherwise every boot would replay an hour of findings).

Quality invariant (binding, same as the alarm engine): only q='good' samples
update the baseline and count toward open/close streaks. bad/uncertain/stale
samples are invisible to anomaly/drift/flatline — for `flapping` the quality
transition itself is the signal, so non-good samples only feed that detector.

Baseline hygiene: out-of-band samples shift the EWMA mean through a +/-3
sigma clamp (winsorized) and never update the variance — an unclamped or
variance-feeding baseline would absorb a constant outlier stream within a
few samples and the OPEN_N streak could never run. A genuine step change
still re-baselines over ~minutes and lets the insight close.

Dedupe: at most one open row per (org, tag, kind) — enforced by the partial
unique index insights_open_uq; a repeated detection while open updates
ts_end/score instead of inserting.
"""

from __future__ import annotations

import asyncio
import logging
import math
import time
from collections import deque
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from uuid import UUID

import asyncpg

from . import config
from .db import audit
from .db.context import TenantConn, tenant_tx
from .db.util import iso_z, utcnow

log = logging.getLogger("backend.insights")

INSIGHT_KINDS = ("anomaly", "drift", "flatline", "flapping")

_DRIFT_WIN_S = 1800.0      # 30-min OLS window (spec table)
_DRIFT_MIN_SPAN_S = 600.0  # need >= 10 min of post-start data before judging
_DRIFT_MIN_N = 30
_MIN_BASE_N = 10           # samples before z-scores are meaningful
_CLAMP_SIGMAS = 3.0        # winsorize out-of-band baseline feed
_SIGMA_ABS_FLOOR = 1e-3    # absolute sigma floor: on a near-zero tag
                           # (|mu| ~ 0) the relative 2%-of-mean floor alone
                           # would bottom at ~1e-9, turning sub-unit noise
                           # into astronomical z-scores


def _is_num(v) -> bool:
    return isinstance(v, (int, float)) and not isinstance(v, bool)


def _numeric(v) -> float | None:
    return float(v) if _is_num(v) else None


@dataclass
class TagStats:
    """Per-tag engine state; only populated from post-start samples."""
    seeded: bool = False
    last_ts: datetime | None = None        # history high-water mark (any q)
    # EWMA baseline over good samples
    mu: float = 0.0
    var: float = 0.0
    n: int = 0
    # anomaly streaks / open episode
    streak: int = 0                        # consecutive out-of-band samples
    streak_first: datetime | None = None
    streak_zmax: float = 0.0
    # armed episode snapshot [first_ts, last_offense_ts, zmax] — set the
    # moment a streak hits OPEN_N (which can happen mid-batch), consumed by
    # the next evaluation pass
    pending: list | None = None
    open_anomaly: bool = False             # DB row currently open (per pass)
    inband: int = 0                        # consecutive non-offending samples
    ep_zmax: float = 0.0                   # max |z| of the open episode
    ep_last_offense: datetime | None = None
    # drift window: (ts, v) good samples in the last 30 min
    win: deque = field(default_factory=deque)
    # flatline: last good value change + samples since
    last_good_ts: datetime | None = None
    last_good_v: float | None = None
    last_change_ts: datetime | None = None
    flat_n: int = 0
    # flapping: timestamps of good<->non-good quality transitions
    transitions: deque = field(default_factory=deque)
    prev_q: str | None = None


INSIGHT_SQL = """
SELECT id, tag_id, kind, severity, score, state, ts_start, ts_end, detail
FROM insights
"""


def drift_detect(points, sigma_b: float, deadband_min: float):
    """OLS slope over the good-sample window (doc 19 §4.1 `drift` row).

    `points` = [(ts, v)] oldest->newest inside the drift window.
    Returns (triggered, score, slope_per_s, residual_sigma)."""
    if len(points) < _DRIFT_MIN_N or sigma_b <= 0:
        return False, 0.0, 0.0, 0.0
    t0 = points[0][0]
    xs = [(t - t0).total_seconds() for t, _ in points]
    span = xs[-1]
    if span < _DRIFT_MIN_SPAN_S:   # too little post-start data to call a trend
        return False, 0.0, 0.0, 0.0
    ys = [v for _, v in points]
    n = len(xs)
    sx, sy = sum(xs), sum(ys)
    sxx = sum(x * x for x in xs)
    sxy = sum(x * y for x, y in zip(xs, ys))
    denom = n * sxx - sx * sx
    if denom <= 0:
        return False, 0.0, 0.0, 0.0
    xbar, ybar = sx / n, sy / n
    slope = (n * sxy - sx * sy) / denom
    resid = math.sqrt(max(
        sum((y - (ybar + slope * (x - xbar))) ** 2 for x, y in zip(xs, ys)) / n,
        0.0))
    thresh = max(deadband_min, 0.5 * sigma_b) / 600.0      # "per 10 min" rate
    on = abs(slope) > thresh and resid < 0.5 * sigma_b
    return on, abs(slope) * span / sigma_b, slope, resid


def flatline_on(now: datetime, last_good_ts: datetime | None,
                last_change_ts: datetime | None, flat_n: int,
                peer_moved: bool) -> bool:
    """Zero variance for INSIGHT_FLAT_S on a tag that still samples, while
    >=1 peer moved — the sensor-stuck suspicion (doc 19 §4.1)."""
    return (
        last_good_ts is not None
        and last_change_ts is not None
        and (now - last_good_ts).total_seconds() <= config.ALARM_FRESH_S
        and (now - last_change_ts).total_seconds() >= config.INSIGHT_FLAT_S
        and flat_n >= 2
        and peer_moved)


class InsightEngine:
    def __init__(self, pools, ws, registry):
        self.pools = pools
        self.ws = ws
        self.registry = registry
        self.started_at = utcnow()
        self._tags: dict[UUID, TagStats] = {}
        # evaluate_once is also called by tests to force a pass — serialize
        # so a concurrent call can't double-process a batch of rows.
        self._lock = asyncio.Lock()
        # v4 T8 — engine counters, exported by /metrics + /api/system/health
        self.counters = {"insight_eval_passes": 0, "insight_eval_errors": 0,
                         "insights_opened": 0, "insights_closed": 0}
        # v4 T13 — duration of the last completed pass (a real gauge, read
        # by the perf suite via wds_insight_eval_last_seconds — the 15 s
        # SLO on an eval pass needs a measured number, not a cadence guess)
        self.last_eval_s = 0.0

    async def run_forever(self) -> None:
        while True:
            await asyncio.sleep(config.INSIGHT_PERIOD_S)
            try:
                await self.evaluate_once()
            except Exception:  # noqa: BLE001 — one bad pass must not kill the loop
                self.counters["insight_eval_errors"] += 1
                log.exception("insight evaluation failed")

    # ---------------------------------------------------------- evaluation
    async def evaluate_once(self) -> None:
        """One evaluation pass over every numeric tag of every org (v4 T9 —
        multi-tenant). Exposed so tests can force a pass without waiting
        INSIGHT_PERIOD_S."""
        async with self._lock:
            t0 = time.monotonic()
            try:
                await self._evaluate()
            finally:
                self.last_eval_s = time.monotonic() - t0

    async def _evaluate(self) -> None:
        await self.registry.maybe_refresh()
        now = utcnow()
        # Serialized insight rows broadcast AFTER the pass commits — an event
        # emitted mid-transaction would still reach clients if a later tag's
        # work rolled the writes back.
        events: list[tuple[UUID, dict]] = []
        for org_id in self.registry.org_ids():
            tags = [t for t in self.registry.for_org(org_id)
                    if t.type == "number"]
            if not tags:
                continue
            async with tenant_tx(self.pools.system, org_id) as tc:
                deadband_min = {
                    r["tag_id"]: r["dmin"] for r in await tc.fetch(
                        "SELECT tag_id, min(deadband) AS dmin FROM alarm_rules"
                        " WHERE enabled GROUP BY tag_id")}
                for tag in tags:
                    tag_events: list[dict] = []
                    try:
                        # per-tag savepoint: one bad tag rolls back only its
                        # own writes, never the whole pass
                        async with tc.conn.transaction():
                            await self._eval_tag(tc, tag, now,
                                                 deadband_min.get(tag.id, 0.0),
                                                 tags, tag_events)
                        # only committed tag work
                        events.extend((org_id, e) for e in tag_events)
                    except Exception:  # noqa: BLE001 — isolate, keep evaluating
                        self.counters["insight_eval_errors"] += 1
                        log.exception("insight evaluation failed for tag %s",
                                      getattr(tag, "v1_name", tag.id))
        self.counters["insight_eval_passes"] += 1
        for org_id, insight in events:
            self.ws.broadcast({"type": "insight", "insight": insight},
                              org_id=org_id)

    async def _eval_tag(self, tc: TenantConn, tag, now: datetime,
                        deadband_min: float, all_tags,
                        events: list[dict]) -> None:
        """One tag's pass: ingest new samples, evaluate all detectors. Runs
        inside the caller's per-tag savepoint; serialized insight events are
        appended to `events` and broadcast by the caller post-commit."""
        st = self._tags.setdefault(tag.id, TagStats())
        if not st.seeded:
            await self._seed_baseline(tc, tag, st)
        rows = await tc.fetch(
            "SELECT ts, v, q FROM tag_history WHERE tag_id=$1 AND ts > $2"
            " ORDER BY ts", tag.id, st.last_ts or self.started_at)
        for r in rows:
            self._process_sample(st, r["ts"], r["v"], r["q"])
        opens = {
            r["kind"]: r for r in await tc.fetch(
                "SELECT id, kind, ts_end, score FROM insights"
                " WHERE tag_id=$1 AND state='open'", tag.id)}
        await self._eval_anomaly(tc, tag, st, opens, now, events)
        await self._eval_windowed(tc, tag, st, opens, now, deadband_min,
                                  all_tags, events)

    async def _seed_baseline(self, tc: TenantConn, tag, st: TagStats) -> None:
        """Warm the EWMA from pre-start history — statistics only, never an
        insight (cold start: no backfill)."""
        st.seeded = True
        rows = await tc.fetch(
            "SELECT v FROM tag_history WHERE tag_id=$1 AND q='good'"
            " AND ts >= $2 AND ts <= $3 ORDER BY ts",
            tag.id, self.started_at - timedelta(seconds=config.INSIGHT_BASE_S),
            self.started_at)
        for r in rows:
            v = _numeric(r["v"])
            if v is not None:
                self._ewma_update(st, v)

    def _process_sample(self, st: TagStats, ts: datetime, v, q: str) -> None:
        st.last_ts = ts
        good = q == "good"
        # flapping: any good<->non-good quality transition
        if st.prev_q is not None and (st.prev_q == "good") != good:
            st.transitions.append(ts)
        st.prev_q = q
        if not good:
            return
        x = _numeric(v)
        if x is None:
            return
        st.win.append((ts, x))
        if st.last_good_v is None or x != st.last_good_v:
            st.last_change_ts = ts
            st.flat_n = 1
        else:
            st.flat_n += 1
        st.last_good_v = x
        st.last_good_ts = ts
        self._score_sample(st, ts, x)

    def _score_sample(self, st: TagStats, ts: datetime, x: float) -> None:
        sigma = math.sqrt(st.var)
        sigma_eff = max(sigma, self._sigma_floor(st))
        if st.n >= _MIN_BASE_N and sigma_eff > 0:
            z = abs(x - st.mu) / sigma_eff
            if z >= config.INSIGHT_ANOM_Z:
                if st.streak == 0:
                    st.streak_first = ts
                    st.streak_zmax = 0.0
                st.streak += 1
                st.streak_zmax = max(st.streak_zmax, z)
                st.ep_zmax = max(st.ep_zmax, z)
                st.ep_last_offense = ts
                st.inband = 0
                # An evaluation pass replays a whole batch of rows, so the
                # streak can hit OPEN_N and reset inside one pass — arm an
                # episode snapshot the moment it happens, not at pass end.
                if st.streak >= config.INSIGHT_OPEN_N:
                    if st.pending is None:
                        st.pending = [st.streak_first, ts, st.streak_zmax]
                    else:
                        st.pending[1] = ts
                        st.pending[2] = max(st.pending[2], st.streak_zmax)
                # Winsorized mean shift: the outlier nudges mu by at most
                # 3 sigma but is never allowed to grow var — otherwise the
                # band inflates ~x1.4 per offense and absorbs its own signal
                # after a handful of samples (and OPEN_N can never run).
                # A genuine step change still re-baselines over ~minutes and
                # lets the insight close.
                dev = max(-_CLAMP_SIGMAS * sigma_eff,
                          min(_CLAMP_SIGMAS * sigma_eff, x - st.mu))
                st.mu += config.INSIGHT_EWMA_ALPHA * dev
                st.n += 1
                return
        # in-band / unscored sample: the streak collapses here. Episode
        # accumulators from a streak that never armed (sub-OPEN_N, no pending
        # snapshot, no open row) must not leak into a later episode's score.
        if (0 < st.streak < config.INSIGHT_OPEN_N and st.pending is None
                and not st.open_anomaly):
            st.ep_zmax = 0.0
            st.ep_last_offense = None
        st.streak = 0
        st.inband += 1
        self._ewma_update(st, x)

    def _ewma_update(self, st: TagStats, x: float) -> None:
        a = config.INSIGHT_EWMA_ALPHA
        d = x - st.mu
        st.mu += a * d
        st.var = (1.0 - a) * st.var + a * d * d
        st.n += 1

    @staticmethod
    def _sigma_floor(st: TagStats) -> float:
        return max(0.02 * abs(st.mu), _SIGMA_ABS_FLOOR, 1e-9)

    # ---------------------------------------------------------- detectors
    async def _eval_anomaly(self, tc: TenantConn, tag, st: TagStats,
                            opens: dict, now: datetime,
                            events: list[dict]) -> None:
        row = opens.get("anomaly")
        st.open_anomaly = row is not None
        if row is None:
            if st.pending is not None and self._fresh(st):
                first_ts, last_ts, zmax = st.pending
                await self._open(tc, tag, "anomaly",
                                 "warning" if zmax > 6 else "info",
                                 zmax, first_ts, last_ts,
                                 {"mu": st.mu, "sigma": math.sqrt(st.var),
                                  "z": zmax}, events)
                st.ep_zmax = zmax
                st.ep_last_offense = last_ts
            st.pending = None
            # an insight opened this pass is never re-evaluated for close in
            # the same pass — one full period of open state is guaranteed.
            return
        st.pending = None
        if st.ep_last_offense is None:
            # post-restart: the episode accumulators are empty but the row is
            # still open — re-seed them from the row's last known peak/window
            # so the score can't regress and a close never writes NULL ts_end.
            st.ep_zmax = max(st.ep_zmax, float(row["score"] or 0.0))
            st.ep_last_offense = row["ts_end"]
        if st.ep_last_offense and (row["ts_end"] is None
                                   or st.ep_last_offense > row["ts_end"]):
            # severity rides on the episode peak: a row opened at z~4 (info)
            # escalates to warning when a later offense pushes zmax past 6
            await self._update(tc, row["id"], tag, st.ep_last_offense, st.ep_zmax,
                               {"mu": st.mu, "sigma": math.sqrt(st.var),
                                "z": st.ep_zmax},
                               "warning" if st.ep_zmax > 6 else "info", events)
        if st.inband >= config.INSIGHT_CLOSE_N:
            await self._close(tc, row["id"], tag, st.ep_last_offense or now,
                              events)
            st.ep_zmax = 0.0

    async def _eval_windowed(self, tc: TenantConn, tag, st: TagStats,
                             opens: dict, now: datetime, deadband_min: float,
                             all_tags, events: list[dict]) -> None:
        # ---- drift: OLS on the 30-min good-sample window
        cutoff = now - timedelta(seconds=_DRIFT_WIN_S)
        while st.win and st.win[0][0] < cutoff:
            st.win.popleft()
        sigma_b = math.sqrt(st.var)
        drift_on, score, slope, resid = drift_detect(list(st.win), sigma_b,
                                                     deadband_min)
        row = opens.get("drift")
        if drift_on:
            span = (st.win[-1][0] - st.win[0][0]).total_seconds()
            detail = {"slope_per_s": slope, "window_s": span,
                      "sigma_baseline": sigma_b, "residual_sigma": resid,
                      "n": len(st.win)}
            if row is None:
                if self._fresh(st):
                    await self._open(tc, tag, "drift", "info", score,
                                     st.win[0][0], st.win[-1][0], detail, events)
            elif st.win[-1][0] != row["ts_end"]:
                await self._update(tc, row["id"], tag, st.win[-1][0], score,
                                   detail, "info", events)
        elif row is not None:
            await self._close(tc, row["id"], tag,
                              st.win[-1][0] if st.win else now, events)

        # ---- flatline: zero variance for INSIGHT_FLAT_S while a peer moved
        peer_moved = any(
            o.id != tag.id
            and (s := self._tags.get(o.id)) is not None
            and s.last_change_ts is not None
            and (now - s.last_change_ts).total_seconds() < config.INSIGHT_FLAT_S
            for o in all_tags)
        flat_on = flatline_on(now, st.last_good_ts, st.last_change_ts,
                              st.flat_n, peer_moved)
        row = opens.get("flatline")
        if flat_on:
            score = (now - st.last_change_ts).total_seconds() / 60.0
            detail = {"flat_minutes": score}
            if row is None:
                await self._open(tc, tag, "flatline", "warning", score,
                                 st.last_change_ts, st.last_good_ts, detail,
                                 events)
            elif st.last_good_ts != row["ts_end"]:
                await self._update(tc, row["id"], tag, st.last_good_ts, score,
                                   detail, "warning", events)
        elif row is not None:
            await self._close(tc, row["id"], tag, st.last_good_ts or now, events)

        # ---- flapping: good<->non-good quality transitions in INSIGHT_FLAP_S
        cutoff = now - timedelta(seconds=config.INSIGHT_FLAP_S)
        while st.transitions and st.transitions[0] < cutoff:
            st.transitions.popleft()
        flap_on = len(st.transitions) >= config.INSIGHT_FLAP_N
        row = opens.get("flapping")
        if flap_on:
            detail = {"transitions": len(st.transitions),
                      "window_s": config.INSIGHT_FLAP_S}
            if row is None:
                if self._fresh(st):
                    await self._open(tc, tag, "flapping", "info",
                                     float(len(st.transitions)),
                                     st.transitions[0], st.transitions[-1],
                                     detail, events)
            elif st.transitions[-1] != row["ts_end"]:
                await self._update(tc, row["id"], tag, st.transitions[-1],
                                   float(len(st.transitions)), detail, "info",
                                   events)
        elif row is not None:
            await self._close(tc, row["id"], tag,
                              st.transitions[-1] if st.transitions else now,
                              events)

    @staticmethod
    def _fresh(st: TagStats) -> bool:
        """Stale tags produce no insights — a detector may only OPEN while the
        tag keeps delivering samples (closes always proceed)."""
        return (st.last_ts is not None
                and (utcnow() - st.last_ts).total_seconds() <= config.ALARM_FRESH_S)

    # ------------------------------------------------------------- writes
    async def _open(self, tc: TenantConn, tag, kind: str, severity: str,
                    score: float, ts_start: datetime, ts_end: datetime,
                    detail: dict, events: list[dict]) -> None:
        try:
            async with tc.conn.transaction():  # savepoint: losing the race is fine
                iid = await tc.fetchval(
                    "INSERT INTO insights(org_id, tag_id, kind, severity, score,"
                    " state, ts_start, ts_end, detail)"
                    " VALUES ($1,$2,$3,$4,$5,'open',$6,$7,$8) RETURNING id",
                    tc.org_id, tag.id, kind, severity, score, ts_start, ts_end, detail)
        except asyncpg.UniqueViolationError:
            return  # insights_open_uq: another writer holds the open row
        await audit.append(tc, "insight-engine", "insight.open",
                           {"insight_id": str(iid), "tag_id": str(tag.id)},
                           {"kind": kind, "severity": severity, "score": score})
        self.counters["insights_opened"] += 1
        log.info("insight opened", extra={"insight_id": str(iid), "kind": kind,
                                          "tag": tag.v1_name})
        events.append(await self._serialize(tc, iid))

    async def _update(self, tc: TenantConn, insight_id: UUID, tag,
                      ts_end: datetime, score: float, detail: dict,
                      severity: str, events: list[dict]) -> None:
        # severity is re-written on every update so an episode's peak can
        # escalate (or settle) — e.g. an anomaly opened at z~4 as info that
        # later peaks at z~9 becomes warning.
        n = await tc.execute(
            "UPDATE insights SET ts_end=$2, score=$3, detail=$4, severity=$5,"
            " updated_at=now() WHERE id=$1 AND state='open'",
            insight_id, ts_end, score, detail, severity)
        if n == "UPDATE 0":
            return
        events.append(await self._serialize(tc, insight_id))

    async def _close(self, tc: TenantConn, insight_id: UUID, tag,
                     ts_end: datetime | None, events: list[dict]) -> None:
        # ts_end=None must never be written: a closed row with NULL ts_end
        # reads as still-open in every overlap query (list_insights, trends
        # ribbons). Fall back to now.
        n = await tc.execute(
            "UPDATE insights SET state='closed', ts_end=$2, updated_at=now()"
            " WHERE id=$1 AND state='open'", insight_id, ts_end or utcnow())
        if n == "UPDATE 0":
            return
        await audit.append(tc, "insight-engine", "insight.close",
                           {"insight_id": str(insight_id), "tag_id": str(tag.id)})
        self.counters["insights_closed"] += 1
        events.append(await self._serialize(tc, insight_id))

    # -------------------------------------------------------------- queries
    async def list_insights(self, tc: TenantConn, state: str | None,
                            kind: str | None, tag_id: UUID | None,
                            t_from: datetime | None, t_to: datetime | None,
                            limit: int = 200,
                            site_id: UUID | None = None) -> list[dict]:
        # from/to select windows OVERLAPPING the range (trends-page ribbons):
        # starts before the range ends AND (open or ends after range start).
        rows = await tc.fetch(
            INSIGHT_SQL +
            " WHERE ($1::text IS NULL OR state=$1)"
            " AND ($2::text IS NULL OR kind=$2)"
            " AND ($3::uuid IS NULL OR tag_id=$3)"
            " AND ($4::timestamptz IS NULL OR ts_start <= $4)"
            " AND ($5::timestamptz IS NULL OR ts_end IS NULL OR ts_end >= $5)"
            " AND ($7::uuid IS NULL OR tag_id IN"
            "      (SELECT id FROM tags WHERE site_id=$7))"
            " ORDER BY ts_start DESC LIMIT $6",
            state, kind, tag_id, t_to, t_from, limit, site_id)
        return [self._v1(r) for r in rows]

    async def _serialize(self, tc: TenantConn, insight_id: UUID) -> dict:
        return self._v1(await tc.fetchrow(INSIGHT_SQL + " WHERE id=$1", insight_id))

    def _v1(self, r) -> dict:
        tag = self.registry.by_id(r["tag_id"])
        return {
            "id": str(r["id"]),
            "tag_id": str(r["tag_id"]),
            # real site code — multi-org members see other orgs' insights on
            # the same socket (v4 T9)
            "tag": self.registry.display_name(tag) if tag else str(r["tag_id"]),
            "kind": r["kind"],
            "severity": r["severity"],
            "score": r["score"],
            "state": r["state"],
            "ts_start": iso_z(r["ts_start"]),
            "ts_end": iso_z(r["ts_end"]) if r["ts_end"] else None,
            "detail": r["detail"],
        }
