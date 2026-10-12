"""Insight engine integration tests — doc 19 §4 (UI v3).

The engine is periodic (INSIGHT_PERIOD_S, default 15 s) and reads committed
tag_history rows, so an injected sample takes ~1 s (history flush) + up to
one engine period to surface. Tests inject telemetry over MQTT as `tester`
and poll the REST surface — the same pattern as the alarm/adversarial suites.

The sim publishes every tag ~1 Hz, so injection bursts run at ~0.12 s spacing:
between two sim ticks land ~8 injected samples, which is what makes
`INSIGHT_OPEN_N` consecutive out-of-band samples reachable on a live tag.
"""

import asyncio
import json
import threading
import time
from datetime import datetime, timedelta, timezone

import pytest

pytestmark = [pytest.mark.integration, pytest.mark.slow]

from conftest import TAGS, wait_until  # noqa: E402

ANOM_TAG = TAGS["gravel_ratio"]    # calm random-walk, no alarm rules
FLAP_TAG = TAGS["speed_mps"]       # steady follower of speed_sp + noise
FILTER_TAG = TAGS["level_pct"]     # exercised only by the filter test


def _iso_z(dt: datetime) -> str:
    return dt.isoformat(timespec="milliseconds").replace("+00:00", "Z")


def _ts() -> str:
    return _iso_z(datetime.now(timezone.utc))


def _pub(mqtt_client, tag_v1, v, q="good"):
    mqtt_client.publish(tag_v1.replace(".", "/"),
                        json.dumps({"v": v, "q": q, "ts": _ts()}), qos=1)


def _burst(mqtt_client, tag, v, n=14, interval=0.12, q="good"):
    for _ in range(n):
        _pub(mqtt_client, tag, v, q)
        time.sleep(interval)


def _insights(api, **params):
    r = api.get("/api/insights", params={k: v for k, v in params.items() if v is not None})
    assert r.status_code == 200, r.text
    return r.json()


def _first(api, **params):
    rows = _insights(api, **params)
    return rows[0] if rows else None


def _baseline(api, tag):
    """(mean, std) of the tag's recent good history — used to place the
    injected outlier far outside any plausible EWMA band."""
    r = api.get(f"/api/tags/{tag}/history", params={"limit": 400})
    if r.status_code != 200:
        return None, None
    vals = [row["v"] for row in r.json()
            if row["q"] == "good" and isinstance(row["v"], (int, float))]
    if len(vals) < 5:
        return None, None
    mu = sum(vals) / len(vals)
    var = sum((v - mu) ** 2 for v in vals) / len(vals)
    return mu, var ** 0.5


def _outlier(mu, sigma):
    """A value far out of band for ANY plausible engine sigma: >= 60 sigma
    AND >= one whole |mu| — the engine's sigma floor is 0.02*|mu|, so a
    near-zero-sigma tag needs a mu-scaled deviation, not a sigma-scaled one."""
    return mu + max(60.0 * sigma, max(abs(mu), 1.0))


INSIGHT_KEYS = ("id", "tag", "kind", "severity", "score",
                "state", "ts_start", "ts_end", "detail")


# ------------------------------------------------------------------ anomaly

def test_bad_quality_outliers_never_open(api, mqtt_client):
    """Invariant: q!=good samples are invisible to the engine — a burst of
    out-of-band BAD samples must produce no anomaly insight."""
    mu, sigma = _baseline(api, ANOM_TAG)
    if mu is None:
        pytest.skip("not enough history yet — stack just booted")
    v = _outlier(mu, sigma)
    _burst(mqtt_client, ANOM_TAG, v, n=5, q="bad")
    # history flush (~1 s) + at least one full engine period (15 s)
    time.sleep(20)
    assert _first(api, tag=ANOM_TAG, kind="anomaly", state="open") is None, \
        "bad-quality samples opened an anomaly insight"


def test_anomaly_open_dedupe_close(api, mqtt_client):
    mu, sigma = _baseline(api, ANOM_TAG)
    if mu is None:
        pytest.skip("not enough history yet — stack just booted")
    v = _outlier(mu, sigma)

    # 1) >= INSIGHT_OPEN_N consecutive out-of-band good samples -> open.
    # The burst must be dense (~0.12 s) so injected samples land consecutively
    # between the sim's ~1 s ticks.
    _burst(mqtt_client, ANOM_TAG, v)

    # Sparse offending (~1 sample / 1.5 s) keeps the in-band streak below
    # CLOSE_N, holding the insight open while we assert + dedupe.
    stop = threading.Event()

    def keep_offending():
        while not stop.is_set():
            _pub(mqtt_client, ANOM_TAG, v)
            time.sleep(1.5)

    offender = threading.Thread(target=keep_offending, daemon=True)
    offender.start()
    try:
        row = wait_until(
            lambda: _first(api, tag=ANOM_TAG, kind="anomaly", state="open"),
            45, desc="anomaly insight opens")
        for k in INSIGHT_KEYS:
            assert k in row, f"missing key {k} in {row}"
        assert row["tag"] == ANOM_TAG
        assert row["kind"] == "anomaly"
        assert row["state"] == "open"
        assert row["severity"] == "warning"       # injected |z| >> 6
        assert row["score"] >= 3.0
        assert row["ts_start"].endswith("Z")

        # 2) dedupe: continued detection updates the SAME row's ts_end,
        # never inserts a second open row.
        end1 = row["ts_end"] or row["ts_start"]

        def updated_same_row():
            rows = _insights(api, tag=ANOM_TAG, kind="anomaly", state="open")
            if len(rows) != 1:
                return None
            return rows[0] if (rows[0]["ts_end"] or "") > end1 else None

        row2 = wait_until(updated_same_row, 45,
                          desc="ts_end advances on the same open row")
        assert row2["id"] == row["id"], "second detection inserted a duplicate row"
    finally:
        stop.set()

    # 3) stop injecting: INSIGHT_CLOSE_N consecutive in-band sim samples close it
    def closed_same_row():
        rows = _insights(api, tag=ANOM_TAG, kind="anomaly", state="closed")
        return rows[0] if rows and rows[0]["id"] == row["id"] else None

    wait_until(closed_same_row, 60, desc="anomaly closes after in-band streak")


# ------------------------------------------------------------------ flapping

async def _collect_ws(ws_url, duration_s, predicate=None):
    websockets = pytest.importorskip("websockets")
    events = []
    try:
        async with websockets.connect(ws_url, open_timeout=10) as ws:
            await ws.send(json.dumps({"type": "auth"}))  # first-frame auth (v4 T3)
            end = asyncio.get_event_loop().time() + duration_s
            while asyncio.get_event_loop().time() < end:
                try:
                    raw = await asyncio.wait_for(
                        ws.recv(),
                        timeout=max(0.05, end - asyncio.get_event_loop().time()))
                except asyncio.TimeoutError:
                    break
                e = json.loads(raw)
                events.append(e)
                if predicate and predicate(e):
                    break
    except Exception:
        pass
    return events


def test_flapping_opens_and_broadcasts(api, mqtt_client, ws_base):
    """Isolated bad samples between good sim samples = good<->bad quality
    transitions; >= INSIGHT_FLAP_N inside INSIGHT_FLAP_S opens a flapping
    insight (severity info) and emits the WS `insight` event."""
    events: list[dict] = []

    def collect():
        events.extend(asyncio.run(
            _collect_ws(f"{ws_base}/ws", 50, lambda e: e.get("type") == "insight")))

    t = threading.Thread(target=collect, daemon=True)
    t.start()
    time.sleep(1.5)  # let the socket connect

    # each isolated bad sample is wrapped in good sim samples -> ~2 transitions
    for _ in range(5):
        _pub(mqtt_client, FLAP_TAG, 0.0, q="bad")
        time.sleep(1.5)

    row = wait_until(
        lambda: _first(api, tag=FLAP_TAG, kind="flapping", state="open"),
        45, desc="flapping insight opens")
    for k in INSIGHT_KEYS:
        assert k in row
    assert row["severity"] == "info"
    assert row["score"] >= 6.0               # transition count

    t.join(timeout=55)
    insight_events = [e for e in events if e.get("type") == "insight"]
    assert insight_events, \
        f"no WS insight event; got types {[e.get('type') for e in events]}"
    ev = insight_events[0]["insight"]
    for k in INSIGHT_KEYS:
        assert k in ev, f"WS insight missing {k}: {ev}"


# ------------------------------------------------------- flatline / no-op

@pytest.mark.timeout(420)
def test_flatline_opens_and_closes(api, mqtt_client):
    """A numeric tag publishing an unchanged value for INSIGHT_FLAT_S while
    peers move opens a `flatline` warning; a changed sample closes it.

    The sim's constant tags (speed_sp / level_pct idle) flatline naturally at
    backend-uptime >= 300 s — this test usually finds a row quickly but is
    allowed to wait out a fresh boot."""
    row = wait_until(
        lambda: _first(api, kind="flatline", state="open"),
        340, desc="a constant numeric tag flatlines")
    for k in INSIGHT_KEYS:
        assert k in row, f"missing key {k} in {row}"
    assert row["kind"] == "flatline"
    assert row["severity"] == "warning"          # spec: flatline -> warning
    assert row["score"] > 0                      # flat minutes

    # a single changed good sample refreshes last_change_ts -> next pass closes
    tag_name = row["tag"]
    r = api.get(f"/api/tags/{tag_name}/latest")
    cur = r.json()["v"] if r.status_code == 200 else 0.0
    newv = (cur if isinstance(cur, (int, float)) else 0.0) + 0.37
    _pub(mqtt_client, tag_name, newv)

    def closed_same_row():
        rows = _insights(api, tag=tag_name, kind="flatline", state="closed")
        return rows[0] if rows and rows[0]["id"] == row["id"] else None

    wait_until(closed_same_row, 45, desc="flatline closes after value changes")


def test_unknown_and_bool_tags_produce_no_insights(api, mqtt_client):
    """Unknown tag telemetry is dropped at ingest (zero history) and bool
    tags are never evaluated — neither may produce rows nor break the pass."""
    ghost = "plant1.sort.line1.ghost9.sig"
    _burst(mqtt_client, ghost, 999.0, n=6)
    _burst(mqtt_client, TAGS["running"], True, n=6)
    time.sleep(20)                    # history flush + >=1 full engine pass
    assert _insights(api, tag=ghost) == []
    assert _insights(api, tag=TAGS["running"]) == []
    assert api.get("/api/health").json()["db"] == "up"


# -------------------------------------------------------------- API filters

def test_insights_api_filters(api, mqtt_client):
    mu, sigma = _baseline(api, FILTER_TAG)
    if mu is None:
        pytest.skip("not enough history yet — stack just booted")
    _burst(mqtt_client, FILTER_TAG, _outlier(mu, sigma))
    wait_until(
        lambda: _first(api, tag=FILTER_TAG, kind="anomaly", state="open"),
        45, desc="seed anomaly for filter assertions")

    rows = _insights(api)
    assert isinstance(rows, list) and rows
    assert all(set(INSIGHT_KEYS) <= set(r) for r in rows)
    # newest first
    starts = [r["ts_start"] for r in rows]
    assert starts == sorted(starts, reverse=True)

    for r in _insights(api, state="open"):
        assert r["state"] == "open"
    for r in _insights(api, state="closed"):
        assert r["state"] == "closed"
    for r in _insights(api, kind="flapping"):
        assert r["kind"] == "flapping"
    tag_rows = _insights(api, tag=FILTER_TAG)
    assert tag_rows and all(r["tag"] == FILTER_TAG for r in tag_rows)

    # from/to window semantics: rows whose window starts after `to` are
    # excluded; unknown tags and bad params are clean.
    to_past = _iso_z(datetime.now(timezone.utc) - timedelta(hours=1))
    for r in _insights(api, **{"to": to_past}):
        assert r["ts_start"] <= to_past
    assert _insights(api, tag="plant1.sort.line1.ghost9.sig") == []

    assert api.get("/api/insights", params={"state": "bogus"}).status_code == 400
    assert api.get("/api/insights", params={"kind": "bogus"}).status_code == 400
    assert api.get("/api/insights", params={"from": "not-a-date"}).status_code == 400


def test_insights_anonymous_read(api):
    """Same anonymous-read policy as /api/alarms — no Authorization header."""
    assert api.get("/api/insights").status_code == 200
    assert api.get("/api/insights", params={"state": "open"}).status_code == 200
