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
    pending_first: datetime | None = None  # streak hit OPEN_N mid-batch
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


class InsightEngine:
    def __init__(self, pools, ws, registry):
        self.pools = pools
        self.ws = ws
        self.registry = registry
        self.started_at = utcnow()
        self._tags: dict[UUID, TagStats] = {}

    async def run_forever(self) -> None:
        while True:
            await asyncio.sleep(config.INSIGHT_PERIOD_S)
            try:
                await self.evaluate_once()
            except Exception:  # noqa: BLE001 — one bad pass must not kill the loop
                log.exception("insight evaluation failed")

    # ---------------------------------------------------------- evaluation
    async def evaluate_once(self) -> None:
        """One evaluation pass over every numeric tag of the v1 org. Exposed
        so tests can force a pass without waiting INSIGHT_PERIOD_S."""
        await self.registry.maybe_refresh()
        now = utcnow()
        tags = [t for t in self.registry.all() if t.type == "number"]
        if not tags:
            return
        async with tenant_tx(self.pools.system, config.V1_ORG_ID) as tc:
            deadband_min = {
                r["tag_id"]: r["dmin"] for r in await tc.fetch(
                    "SELECT tag_id, min(deadband) AS dmin FROM alarm_rules"
                    " WHERE enabled GROUP BY tag_id")}
            for tag in tags:
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
                        "SELECT id, kind, ts_end FROM insights"
                        " WHERE tag_id=$1 AND state='open'", tag.id)}
                await self._eval_anomaly(tc, tag, st, opens)
                await self._eval_windowed(tc, tag, st, opens, now,
                                          deadband_min.get(tag.id, 0.0), tags)

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
                # streak can hit OPEN_N and reset inside one pass — capture
                # the opening the moment it happens, not at pass end.
                if st.streak >= config.INSIGHT_OPEN_N and st.pending_first is None:
                    st.pending_first = st.streak_first
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
        return max(0.02 * abs(st.mu), 1e-9)

    # ---------------------------------------------------------- detectors
    async def _eval_anomaly(self, tc: TenantConn, tag, st: TagStats,
                            opens: dict) -> None:
        row = opens.get("anomaly")
        if row is None:
            if st.pending_first is not None and self._fresh(st):
                await self._open(tc, tag, "anomaly",
                                 "warning" if st.ep_zmax > 6 else "info",
                                 st.ep_zmax, st.pending_first,
                                 st.ep_last_offense,
                                 {"mu": st.mu, "sigma": math.sqrt(st.var),
                                  "z": st.ep_zmax})
            st.pending_first = None
            # an insight opened this pass is never re-evaluated for close in
            # the same pass — one full period of open state is guaranteed.
            return
        st.pending_first = None
        if st.ep_last_offense and (row["ts_end"] is None
                                   or st.ep_last_offense > row["ts_end"]):
            await self._update(tc, row["id"], tag, st.ep_last_offense, st.ep_zmax,
                               {"mu": st.mu, "sigma": math.sqrt(st.var),
                                "z": st.ep_zmax})
        if st.inband >= config.INSIGHT_CLOSE_N:
            await self._close(tc, row["id"], tag, st.ep_last_offense)
            st.ep_zmax = 0.0

    async def _eval_windowed(self, tc: TenantConn, tag, st: TagStats,
                             opens: dict, now: datetime, deadband_min: float,
                             all_tags) -> None:
        # ---- drift: OLS on the 30-min good-sample window
        cutoff = now - timedelta(seconds=_DRIFT_WIN_S)
        while st.win and st.win[0][0] < cutoff:
            st.win.popleft()
        drift_on = False
        slope = resid = span = 0.0
        sigma_b = math.sqrt(st.var)
        if (len(st.win) >= _DRIFT_MIN_N and sigma_b > 0
                and (st.win[-1][0] - st.win[0][0]).total_seconds() >= _DRIFT_MIN_SPAN_S):
            t0 = st.win[0][0]
            xs = [(t - t0).total_seconds() for t, _ in st.win]
            ys = [v for _, v in st.win]
            n = len(xs)
            sx, sy = sum(xs), sum(ys)
            sxx = sum(x * x for x in xs)
            sxy = sum(x * y for x, y in zip(xs, ys))
            denom = n * sxx - sx * sx
            if denom > 0:
                slope = (n * sxy - sx * sy) / denom
                ybar = sy / n
                resid = math.sqrt(max(
                    sum((y - (ybar + slope * (x - sx / n))) ** 2
                        for x, y in zip(xs, ys)) / n, 0.0))
                thresh = max(deadband_min, 0.5 * sigma_b) / 600.0  # per 10 min
                drift_on = abs(slope) > thresh and resid < 0.5 * sigma_b
                span = xs[-1]
        row = opens.get("drift")
        if drift_on:
            score = abs(slope) * span / sigma_b
            detail = {"slope_per_s": slope, "window_s": span,
                      "sigma_baseline": sigma_b, "residual_sigma": resid,
                      "n": len(st.win)}
            if row is None:
                if self._fresh(st):
                    await self._open(tc, tag, "drift", "info", score,
                                     st.win[0][0], st.win[-1][0], detail)
            elif st.win[-1][0] != row["ts_end"]:
                await self._update(tc, row["id"], tag, st.win[-1][0], score, detail)
        elif row is not None:
            await self._close(tc, row["id"], tag, st.win[-1][0] if st.win else now)

        # ---- flatline: zero variance for INSIGHT_FLAT_S while a peer moved
        flat_on = (
            st.last_good_ts is not None
            and st.last_change_ts is not None
            and (now - st.last_good_ts).total_seconds() <= config.ALARM_FRESH_S
            and (now - st.last_change_ts).total_seconds() >= config.INSIGHT_FLAT_S
            and st.flat_n >= 2
            and any(o.id != tag.id
                    and (s := self._tags.get(o.id)) is not None
                    and s.last_change_ts is not None
                    and (now - s.last_change_ts).total_seconds() < config.INSIGHT_FLAT_S
                    for o in all_tags))
        row = opens.get("flatline")
        if flat_on:
            score = (now - st.last_change_ts).total_seconds() / 60.0
            detail = {"flat_minutes": score}
            if row is None:
                await self._open(tc, tag, "flatline", "warning", score,
                                 st.last_change_ts, st.last_good_ts, detail)
            elif st.last_good_ts != row["ts_end"]:
                await self._update(tc, row["id"], tag, st.last_good_ts, score, detail)
        elif row is not None:
            await self._close(tc, row["id"], tag, st.last_good_ts or now)

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
                                     st.transitions[0], st.transitions[-1], detail)
            elif st.transitions[-1] != row["ts_end"]:
                await self._update(tc, row["id"], tag, st.transitions[-1],
                                   float(len(st.transitions)), detail)
        elif row is not None:
            await self._close(tc, row["id"], tag,
                              st.transitions[-1] if st.transitions else now)

    @staticmethod
    def _fresh(st: TagStats) -> bool:
        """Stale tags produce no insights — a detector may only OPEN while the
        tag keeps delivering samples (closes always proceed)."""
        return (st.last_ts is not None
                and (utcnow() - st.last_ts).total_seconds() <= config.ALARM_FRESH_S)

    # ------------------------------------------------------------- writes
    async def _open(self, tc: TenantConn, tag, kind: str, severity: str,
                    score: float, ts_start: datetime, ts_end: datetime,
                    detail: dict) -> None:
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
        log.info("insight opened", extra={"insight_id": str(iid), "kind": kind,
                                          "tag": tag.v1_name})
        self.ws.broadcast({"type": "insight",
                           "insight": await self._serialize(tc, iid)})

    async def _update(self, tc: TenantConn, insight_id: UUID, tag,
                      ts_end: datetime, score: float, detail: dict) -> None:
        n = await tc.execute(
            "UPDATE insights SET ts_end=$2, score=$3, detail=$4, updated_at=now()"
            " WHERE id=$1 AND state='open'", insight_id, ts_end, score, detail)
        if n == "UPDATE 0":
            return
        self.ws.broadcast({"type": "insight",
                           "insight": await self._serialize(tc, insight_id)})

    async def _close(self, tc: TenantConn, insight_id: UUID, tag,
                     ts_end: datetime) -> None:
        n = await tc.execute(
            "UPDATE insights SET state='closed', ts_end=$2, updated_at=now()"
            " WHERE id=$1 AND state='open'", insight_id, ts_end)
        if n == "UPDATE 0":
            return
        await audit.append(tc, "insight-engine", "insight.close",
                           {"insight_id": str(insight_id), "tag_id": str(tag.id)})
        self.ws.broadcast({"type": "insight",
                           "insight": await self._serialize(tc, insight_id)})

    # -------------------------------------------------------------- queries
    async def list_insights(self, tc: TenantConn, state: str | None,
                            kind: str | None, tag_id: UUID | None,
                            t_from: datetime | None, t_to: datetime | None,
                            limit: int = 200) -> list[dict]:
        # from/to select windows OVERLAPPING the range (trends-page ribbons):
        # starts before the range ends AND (open or ends after range start).
        rows = await tc.fetch(
            INSIGHT_SQL +
            " WHERE ($1::text IS NULL OR state=$1)"
            " AND ($2::text IS NULL OR kind=$2)"
            " AND ($3::uuid IS NULL OR tag_id=$3)"
            " AND ($4::timestamptz IS NULL OR ts_start <= $4)"
            " AND ($5::timestamptz IS NULL OR ts_end IS NULL OR ts_end >= $5)"
            " ORDER BY ts_start DESC LIMIT $6",
            state, kind, tag_id, t_to, t_from, limit)
        return [self._v1(r) for r in rows]

    async def _serialize(self, tc: TenantConn, insight_id: UUID) -> dict:
        return self._v1(await tc.fetchrow(INSIGHT_SQL + " WHERE id=$1", insight_id))

    def _v1(self, r) -> dict:
        tag = self.registry.by_id(r["tag_id"])
        return {
            "id": str(r["id"]),
            "tag": tag.v1_name if tag else str(r["tag_id"]),
            "kind": r["kind"],
            "severity": r["severity"],
            "score": r["score"],
            "state": r["state"],
            "ts_start": iso_z(r["ts_start"]),
            "ts_end": iso_z(r["ts_end"]) if r["ts_end"] else None,
            "detail": r["detail"],
        }
