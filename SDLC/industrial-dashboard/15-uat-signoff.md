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

## 5. Restore drill (v4 T7 — doc 18 §5 gate)

Date: 2026-10-13, on the running v4 stack (test overlay, Postgres 16 + dynsec
mosquitto + Keycloak). Performed for real, not a rehearsal of the commands.

| Step | Result | Evidence |
|---|---|---|
| `make backup` | PASS | `pg_dump -Fc` → `backups/wds-20261013010627.dump` (84K, seeded demo DB: 6 tags, memberships, rules, audit chain); on pg_dump failure the partial file is removed |
| `make restore` safety gates | PASS | bare `make restore DUMP=…` refuses and prints the compose project targets; `RESTORE_CONFIRM=1` required. A garbage file is rejected by `pg_restore -l` **before** `DROP DATABASE` runs |
| `RESTORE_CONFIRM=1 make restore DUMP=backups/wds-20261013010627.dump` | PASS in **13.7 s** wall | TOC validated → writers stopped → `DROP DATABASE wds WITH (FORCE)` → `CREATE DATABASE wds OWNER wds_owner` → `pg_restore --exit-on-error` → db-level CONNECT re-granted → backend healthy → `make verify-audit` → **"audit chains intact"** (exit 0) |
| post-restore smoke | PASS | `/api/health` = `{"status":"ok","db":"up","mqtt":"up","edge":"up"}`; `pg_class.relrowsecurity` still `t` (RLS re-applied by the dump); orgs/sites/edges/tags restored |

Note: `make restore` does NOT run `alembic upgrade head` — a dump from an
older schema revision needs `docker compose -f docker-compose.yml run --rm
migrate` afterwards (doc 18 §2).

Negative evidence also gathered: on a DB that had run the tenancy suite,
`make restore` ended with `verify-audit` exiting non-zero on the
deliberately-tampered row (`org A`, `seq=2`, `actor='attacker'` — the
`test_audit.py` fixture). I.e. the post-restore verification step detects a
broken chain rather than passing silently — the drill is honest.

## 6. Sign-off

Demo release gate: **PASSED**. Stack is safe to demo with Factory I/O as the data source. Next track per doc 11: AWS deployment (IoT Core transport, Cognito auth, TimescaleDB, ECS topology) with the §4 items as its entry criteria.

## 7. Security + performance verification suite (v4 T13)

Date: 2026-10-13, live test-overlay stack (APP_ENV=dev). Repeatable, scripted —
`make test-security` / `make test-perf`, not a manual checklist. Suite code:
`tests/security/` (54 tests), `tests/perf/` (6 tests).

### Gate results

| Gate | Result |
|---|---|
| `make test` (contract + tenancy + integration) | **380 + 26 + 134 passed** (4 integration skips: env-gated), ~8 min |
| `make test-security` | **52 passed, 2 skipped** in 52 s — skips are prod-mode probes honestly gated on `APP_ENV=prod` (dev stack; offline coverage in `contract/test_jwt_security.py` / `test_config_prod.py`) |
| `make test-perf` | **6 passed** in ~10 s |
| UAT (`tests/e2e/uat.mjs`) | **104/104 PASS** |

### Measured performance (live stack)

| Probe | Measured | Budget |
|---|---|---|
| `GET …/tags/{id}/history` 15-min window | n=200, p50=54 ms, **p95=72 ms** | p95 ≤ 300 ms |
| `GET …/tags/latest` | n=100, p50=2.2 ms, **p95=4.6 ms** | recorded |
| WS handshake, 100 concurrent | 80 ms total (0.8 ms/socket) | recorded |
| WS telemetry fan-out, 100 sockets | n=100, p50=10.5 ms, **p95=11.0 ms** | p95 ≤ 2 s |
| Insight eval pass (`wds_insight_eval_last_seconds`) | **0.056 s** | ≤ 15 s |
| Entry JS chunk (gzip) | **218 KB** | ≤ 600 KB |
| Ops-wall LCP (Playwright, local) | **108 ms** | sanity bound 10 s |

### Real findings fixed by this task

1. **nginx ops-404 block leaked no security headers** — the regex `location`
   for `/metrics /readyz /docs /redoc /openapi.json` returned bare 404s
   (nginx `add_header` isn't inherited into a block that sets its own).
   Fixed with `add_header … always` in `web/nginx.conf`; verified: those
   404s now carry CSP + nosniff + `X-Frame-Options: DENY`.
2. **`Server: nginx/x.y.z` version banner** → `server_tokens off`; response
   now `Server: nginx`.
3. **No observability for insight-eval duration** → added
   `wds_insight_eval_last_seconds` gauge (`backend/app/insights.py`,
   `observability.py`) so the 15 s SLO is continuously measurable, not
   just testable.
4. **Perf harness couldn't claim distinct client IPs** — host hits arrive
   NAT'd as the pinned gateway `172.30.10.1`, untrusted for `X-Real-IP`.
   `docker-compose.test.yml` now trusts the gateway **in the test overlay
   only** (prod keeps nginx-only trust); the per-IP cap is still proven on
   the real-peer bucket (no `X-Real-IP` sent).

### Security coverage asserted live

- **BOLA (OWASP API1):** org-A token vs org-B IDs across every v2 route
  family — orgs, sites, tags, latest, history, alarm rules, alarms, ack,
  insights, commands (+status), edges (+rotate/disable), members, invites,
  audit — all flat `404`, no existence oracle.
- **Auth bypass (API2):** missing/empty/garbage/truncated bearer → `401`;
  `alg=none`, HS256-confusion with the realm public key, RS256 wrong-key
  with real `kid`, tampered payload, master-realm token → `401` REST +
  `4401` WS. Real-signature wrong-audience (throwaway KC client) and
  real-signature expired (client lifespan shrunk to 3 s, restored in
  `finally`) → `401`/`4401`.
- **Function-level (API5):** viewer → `403` on alarm-rule CRUD, member +
  invite ops, audit export, commands, ack, edge rotate/disable.
- **Rate limits (API4):** command bucket → `429` + `Retry-After`; mutation
  bucket → `429`; backchannel logout bucket proven.
- **WS admission:** pre-auth frame → `4401`, 5 s auth timeout → `4401`,
  bad origin → `4403` (direct + through nginx), `?token=` inert, per-IP
  cap → `4403`, authenticated socket survives (control).
- **Headers:** CSP/nosniff/frame-deny on SPA, hashed asset, SPA fallback,
  API 200/401/404, asset 404, ops-path 404s; Keycloak proxied paths carry
  KC's own sniffing/framing headers; no version banner.
- **Infra:** default compose has no `:1883`; plaintext MQTT exists only in
  the test overlay on `127.0.0.1`; `docker inspect` shows no secret values
  (file indirection only); `tester` identity is test-overlay-provisioned.

### Safety boundary honored

Test org + provisioned `tester` identity only; command path exercised via
the normal guarded REST lifecycle (POST → broker → edge → `cmd-resp`);
no fuzzing of edge/PLC-facing payload surface.

### Skips (honest, by design)

- `test_dev_tokens_absent_in_prod`, `test_backend_docs_gated_by_env` —
  require `APP_ENV=prod`; the test stack runs dev by design. Both probes
  assert the env is advertised honestly via `/api/auth/config`, and the
  prod behavior is covered offline (`contract/test_jwt_security.py`,
  `contract/test_config_prod.py`).
