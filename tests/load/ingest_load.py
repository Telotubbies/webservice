"""Ingest load test: N orgs x M tags/s over MQTT against the ttest stack. ~60 s end to end.

    BASE_URL=http://localhost:18100 MQTT_HOST=localhost MQTT_PORT=8883 MQTT_CA_FILE=infra/certs/ca.crt \
    WDS_TEST_APP_DSN=postgresql://wds_app:app-dev-pass@127.0.0.1:5433/wds \
    python -I tests/load/ingest_load.py [--orgs 3] [--rate 20] [--seconds 25]

Every org gets its own site, a real enrolled edge identity (so broker ACLs and the per-org budget apply),
a modbus source and M tags. Each org publishes M samples per second, one per tag, value = sequence number.
Reported:
  e2e lag   time from publish to the sample being readable at GET .../tags/latest (polled every 0.25 s)
  backend   wds_ingest_lag_seconds histogram delta from /metrics (bucket upper bounds)
  errors    publish failures + samples never seen + HTTP errors, as a share of samples sent
Exit 1 when the error rate is above --max-error-pct (default 1) or p95 e2e lag above --max-p95-s (default 5).
"""
from __future__ import annotations

import argparse
import asyncio
import json
import os
import statistics
import sys
import threading
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path

import httpx

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
BASE = os.environ.get("BASE_URL", "http://localhost:18100").rstrip("/")
MQTT_HOST, MQTT_PORT = os.environ.get("MQTT_HOST", "localhost"), int(os.environ.get("MQTT_PORT", "8883"))
CA = os.environ.get("MQTT_CA_FILE", str(Path(__file__).resolve().parents[2] / "infra/certs/ca.crt"))
DSN = os.environ.get("WDS_TEST_APP_DSN", "postgresql://wds_app:app-dev-pass@127.0.0.1:5433/wds")
ADMIN = {"Authorization": "Bearer demo-admin"}
ADMIN_UID = uuid.UUID("0199d000-0000-7000-8000-00000000d003")        # demo-admin (backend/app/ops/seed.py)
CSV_HDR = "line,device,signal,address,type,unit,writable,min,max,scale\n"


def iso(t: float) -> str:
    return datetime.fromtimestamp(t, timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


async def make_orgs(n: int) -> list[dict]:
    import asyncpg
    out = []
    for i in range(n):
        org, site = uuid.uuid4(), uuid.uuid4()
        conn = await asyncpg.connect(DSN)
        try:
            await conn.execute("BEGIN")
            await conn.execute("SELECT set_config('app.org_id', $1, true)", str(org))
            await conn.execute("INSERT INTO organizations(id, name) VALUES ($1,$2)", org, f"load-{i}-{uuid.uuid4().hex[:6]}")
            await conn.execute("INSERT INTO sites(id, org_id, name, code) VALUES ($1,$2,$3,$4)", site, org, f"Load {i}", f"load{i}")
            await conn.execute("INSERT INTO memberships(org_id, user_id, role) VALUES ($1,$2,'admin')", org, ADMIN_UID)
            await conn.execute("COMMIT")
        finally:
            await conn.close()
        out.append({"org": str(org), "site": str(site)})
    return out


def provision(o: dict, tags: int) -> None:
    with httpx.Client(base_url=BASE, timeout=30.0, headers=ADMIN) as a:
        r = a.post(f"/api/v1/orgs/{o['org']}/sites/{o['site']}/edges", json={"name": "load-edge"})
        r.raise_for_status()
        edge = r.json()
        o["edge"] = edge["edge"]["id"]
        ident = httpx.post(f"{BASE}/api/v1/edge/enroll", json={"code": edge["enroll_code"]}, timeout=30.0)
        ident.raise_for_status()
        o["mqtt_user"], o["mqtt_pw"] = ident.json()["mqtt_username"], ident.json()["mqtt_password"]
        src = a.post(f"/api/v1/orgs/{o['org']}/edges/{o['edge']}/sources", json={"name": "load", "protocol": "modbus", "connection": {"host": "10.0.0.5"}})
        src.raise_for_status()
        body = CSV_HDR + "".join(f"load,dev,s{i},{40001 + i},number,,false,,,\n" for i in range(tags))
        b = a.post(f"/api/v1/orgs/{o['org']}/edges/{o['edge']}/sources/{src.json()['source']['id']}/tags:bulk",
                   content=body, headers={"Content-Type": "text/csv"})
        b.raise_for_status()
        o["paths"] = [f"load/dev/s{i}" for i in range(tags)]


def latest(a: httpx.Client, o: dict) -> dict[str, float]:
    if "idmap" not in o:
        t = a.get(f"/api/v1/orgs/{o['org']}/sites/{o['site']}/tags")
        t.raise_for_status()
        o["idmap"] = {x["id"]: x["path"] for x in t.json()["items"]}
    r = a.get(f"/api/v1/orgs/{o['org']}/sites/{o['site']}/tags/latest")
    r.raise_for_status()
    return {o["idmap"][x["tag_id"]]: x["v"] for x in r.json()["items"] if x.get("v") is not None and x["tag_id"] in o["idmap"]}


def metrics() -> dict:
    t = httpx.get(f"{BASE}/metrics", timeout=10.0).text
    out = {"buckets": {}, "throttled": 0.0, "count": 0.0}
    for ln in t.splitlines():
        if ln.startswith("wds_ingest_lag_seconds_bucket"):
            le = ln.split('le="')[1].split('"')[0]
            out["buckets"][le] = float(ln.split()[-1])
        elif ln.startswith("wds_ingest_lag_seconds_count"):
            out["count"] = float(ln.split()[-1])
        elif ln.startswith("wds_ingest_throttled_total"):
            out["throttled"] = float(ln.split()[-1])
    return out


def bucket_quantile(before: dict, after: dict, q: float) -> str:
    n = after["count"] - before["count"]
    if n <= 0:
        return "n/a"
    for le in sorted((k for k in after["buckets"] if k != "+Inf"), key=float):
        if after["buckets"][le] - before["buckets"].get(le, 0) >= q * n:
            return f"<= {le} s"
    return "> 3600 s"


def pct(xs: list[float], q: float) -> float:
    xs = sorted(xs)
    return xs[min(len(xs) - 1, int(q * len(xs)))] if xs else float("nan")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--orgs", type=int, default=3)
    ap.add_argument("--rate", type=int, default=20, help="tags per second per org")
    ap.add_argument("--seconds", type=int, default=25)
    ap.add_argument("--max-error-pct", type=float, default=1.0)
    ap.add_argument("--max-p95-s", type=float, default=5.0)
    args = ap.parse_args()
    t0 = time.time()
    import paho.mqtt.client as mqtt

    orgs = asyncio.run(make_orgs(args.orgs))
    for o in orgs:
        provision(o, args.rate)
    print(f"provisioned {args.orgs} orgs x {args.rate} tags in {time.time() - t0:.1f}s")
    time.sleep(3)                                    # registry refresh after the bulk insert

    sent: dict[tuple[int, str, int], float] = {}     # (org idx, path, seq) -> publish time
    pub_err = [0]
    stop = threading.Event()
    lock = threading.Lock()

    def publisher(idx: int, o: dict) -> None:
        c = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2, client_id=f"load-{idx}-{uuid.uuid4().hex[:6]}")
        c.username_pw_set(o["mqtt_user"], o["mqtt_pw"])
        c.tls_set(ca_certs=CA)
        c.connect(MQTT_HOST, MQTT_PORT, keepalive=30)
        c.loop_start()
        prefix = f"v2/{o['org']}/{o['site']}/{o['edge']}/tele/"
        seq, nxt = 0, time.time()
        while not stop.is_set():
            seq += 1
            now = time.time()
            for p in o["paths"]:
                info = c.publish(prefix + p, json.dumps({"v": seq, "q": "good", "ts": iso(now)}), qos=1)
                if info.rc != 0:
                    pub_err[0] += 1
                with lock:
                    sent[(idx, p, seq)] = now
            nxt += 1.0
            time.sleep(max(0.0, nxt - time.time()))
        c.loop_stop()
        c.disconnect()

    before = metrics()
    threads = [threading.Thread(target=publisher, args=(i, o), daemon=True) for i, o in enumerate(orgs)]
    for t in threads:
        t.start()
    lags, seen, http_err = [], set(), 0
    deadline = time.time() + args.seconds
    clients = [httpx.Client(base_url=BASE, timeout=10.0, headers=ADMIN) for _ in orgs]

    def poll() -> None:
        nonlocal http_err
        for idx, (a, o) in enumerate(zip(clients, orgs)):
            try:
                snap = latest(a, o)
            except Exception:  # noqa: BLE001
                http_err += 1
                continue
            at = time.time()
            for p, v in snap.items():
                for s in range(int(v), 0, -1):              # a newer value implies every older seq was overwritten
                    k = (idx, p, s)
                    if k in seen:
                        break
                    seen.add(k)
                    with lock:
                        t_pub = sent.get(k)
                    if t_pub is not None:
                        lags.append(at - t_pub)

    while time.time() < deadline:
        poll()
        time.sleep(0.25)
    stop.set()
    for t in threads:
        t.join(timeout=5)
    for _ in range(12):                                      # drain: let the last samples land
        poll()
        time.sleep(0.25)
    after = metrics()
    total = len(sent)
    # a sample counts as delivered when it was observed, or a later one for the same tag was (latest is last-write-wins)
    missing = 0
    last_seen = {}
    for (idx, p, s) in seen:
        last_seen[(idx, p)] = max(last_seen.get((idx, p), 0), s)
    for (idx, p, s) in sent:
        if s > last_seen.get((idx, p), 0):
            missing += 1
    errs = pub_err[0] + missing + http_err
    err_pct = 100.0 * errs / max(1, total)
    p50, p95 = pct(lags, 0.5), pct(lags, 0.95)
    thr = after["throttled"] - before["throttled"]
    print(f"samples sent      {total}  ({args.orgs} orgs x {args.rate} tags/s x ~{args.seconds}s)")
    print(f"e2e lag p50/p95   {p50:.2f}s / {p95:.2f}s   (mean {statistics.mean(lags) if lags else float('nan'):.2f}s, n={len(lags)})")
    print(f"backend lag p50   {bucket_quantile(before, after, .5)}   p95 {bucket_quantile(before, after, .95)}  (histogram buckets)")
    print(f"throttled         {thr:.0f}   publish errors {pub_err[0]}   never seen {missing}   http errors {http_err}")
    print(f"error rate        {err_pct:.2f}%   total time {time.time() - t0:.0f}s")
    ok = err_pct <= args.max_error_pct and p95 <= args.max_p95_s
    print("RESULT", "PASS" if ok else "FAIL")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
