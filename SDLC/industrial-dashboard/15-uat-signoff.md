# 15 — UAT Sign-off & Release Blockers

Date: post-attack-remediation build (backend + edge-bridge + web rebuilt after P0/P1 fixes).
Scope: demo stack — `mosquitto` (authenticated, ACL'd), `backend` (FastAPI + SQLite), `edge-bridge` (sim adapter), `web` (nginx + React build). Target = AWS deploy; this sign-off covers the **local demo readiness gate**, not production AWS acceptance.

## 1. Verification Evidence

| Layer | Result | Evidence |
|---|---|---|
| Test suite | **327 passed, 4 gated skips** | `pytest tests/` — skips are intentional gates, each verified passing separately: `test_command_timeout_edge_offline` (DISRUPTIVE), `test_retained_command_denied_on_edge_restart` (DISRUPTIVE, new), `test_alarm_survives_bad_quality` (DISRUPTIVE, new), clock-skew (`EDGE_CLOCK_SKEW_MS>500`, verified via compose override) |
| Browser UAT | **18/18 passed** | Playwright Chromium, `/tmp/uat/uat.py`, screenshots in `/tmp/uat/*.png` |
| Live adversarial probes | **Closed** | Anonymous MQTT command → denied (was exploitable pre-fix); retained cmd replay on edge resubscribe → `denied`/`retained_command`; REST command matrix anon→401 / viewer→403 / operator→200 verified live |
| Build | clean | `tsc` + `vite` pass; `python -m compileall` pass on backend + edge |

## 2. Per-Role Sign-off

| Role | Verdict | Basis |
|---|---|---|
| **OT safety** | PASS | `q=bad`/`stale` telemetry can neither clear nor raise critical alarms (alarm engine returns early on non-good quality). Verified end-to-end: inject over-temp → ACTIVE → inject `q=bad` below threshold → stays ACTIVE → UI ack → `q=good` normal → CLEARED. Retained commands dropped on reconnect. |
| **Security** | PASS (demo scope) | MQTT requires auth + ACLs; port 1883 bound to localhost; REST command reads/writes require operator; WS command events operator-only; `cmd-resp` correlated to issued commands; `issued_at` TTL-bounded, future timestamps rejected; bool-on-numeric writes rejected at adapter. Remaining caveats in §4. |
| **SRE** | PASS (demo scope) | `/api/health` reports db/mqtt/edge subsystems + 503 on failure; edge LWT + degraded heartbeat on clock failure; backend restart sweep marks in-flight commands `timeout` (no 409 brick); history dedup via unique index. |
| **QA** | PASS | Command lifecycle `sent→done` round-trip through authenticated broker verified; malformed JSON → 400 (not 500); non-finite values sanitized before REST/WS JSON; history dedup + `limit` raised to 5000 so trend seeding (2400 pts) works. |
| **Tech Lead** | PASS | Command state re-seeds on `authRev` change (late login sees history); WS command stream consistent with REST auth level; heartbeat carries `edge_id`. |
| **PO / UX** | PASS (demo scope) | Controls tab hidden for anonymous/viewer and on ≤600px viewports even for operator; alarm states display ACTIVE/ACKED/CLEARED distinctly; cam1 vision tile carries STUB badge (CV pipeline not feeding it yet); reactive auth — token entered in UI flips role without reload. |

## 3. UAT Checklist (all green)

- anon: Controls hidden, STUB badge on cam1, live tiles render — **PASS**
- viewer: Controls hidden — **PASS**
- operator: Controls visible, CommandPanel renders — **PASS**
- Cleared alarms labeled `CLEARED` (not `ACKED`) — **PASS**
- Alarm lifecycle via real MQTT injection + real UI ack — **PASS**
- `q=bad` does not clear critical alarm — **PASS**
- Reactive auth (token → Controls appears, no reload) — **PASS**
- Trend seeds via `/history` (3 tags × 2400 samples, all 200) + uPlot renders — **PASS**
- 600px viewport: Controls hidden even for operator — **PASS**
- Zero console errors, zero 4xx/5xx in full flow — **PASS**

## 4. Known Limitations / Pre-AWS Blockers

Not release blockers for the local demo; **all must be addressed in the AWS deployment track (doc 10)**:

1. **Demo tokens in repo** — `demo-viewer`/`demo-operator` are dev defaults; AWS path uses Cognito + IoT Core X.509, not bearer strings.
2. **`tester` MQTT identity is broad** (`readwrite plant1/#`) — intentional: adversarial tests must impersonate backend (`cmd/`) and edge (telemetry) or negative tests are vacuous. Production = per-device IoT policies, no shared test identity.
3. **SQLite** — fine for demo; TimescaleDB per doc 05 for production history.
4. **cam1 tile is a stub** — vision service (doc 12) not wired to live pipeline yet; labeled STUB in UI so operators aren't misled.
5. **PLC adapter** — Modbus stub path exercised; real Siemens model still undecided (S7 vs OPC UA decision deferred per 04/11).
6. **MQTT TLS** — localhost-only broker without TLS is acceptable for the demo topology; AWS IoT Core path is TLS + cert auth by design.

## 5. Sign-off

Demo release gate: **PASSED**. Stack is safe to demo with Factory I/O as the data source. Next track per doc 11: AWS deployment (IoT Core transport, Cognito auth, TimescaleDB, ECS topology) with the §4 items as its entry criteria.
