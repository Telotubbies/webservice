# tests/ — QA suite for the industrial dashboard demo

Two layers, one command runner:

| Layer | Where | Needs services? | What it proves |
|---|---|---|---|
| **contract/unit** | `contract/` | no | CONTRACT.md semantics: payload validators, tag/topic grammar, command lifecycle state machine, dedup-before-409 ordering, edge deny pipeline, RBAC matrix, WS event shapes |
| **integration** | `integration/` | yes (compose) | live backend + edge + broker: REST, commands end-to-end, alarm pipeline, WS streams, adversarial MQTT/REST attacks |
| **security** | `security/` | yes (compose) | OWASP API Top-10 sweep: BOLA over every v2 route family, auth bypass (alg=none / HS256 confusion / expired / wrong-aud / wrong-iss) on REST+WS, viewer RBAC 403 matrix, 429+Retry-After proof, response-header scan, WS admission, compose/inspect secret leak checks |
| **perf** | `perf/` | yes (compose) | SLO harness: history p95, 100-conn WS fan-out, insight eval duration, bundle gz budget, ops-wall LCP |

`security/` and `perf/` are NOT in `testpaths` — they run via their own
make targets (`make test-security` / `make test-perf`) so the standard
integration gate stays unchanged. They still carry the `integration`
marker for `-m` filtering.

Safety boundary (ICS doctrine): the security suite exercises only the
SaaS surface — org A/B REST + WS + the test-profile `tester` MQTT
identity — and the command path only through the normal guarded REST
lifecycle. Nothing fuzzes the edge/PLC-facing side.

`contract/schemas.py` is the **executable reading of CONTRACT.md** — pure
stdlib, no imports from service code. If a doc disagrees with CONTRACT.md,
CONTRACT.md wins and the divergence is marked `# DIVERGENCE` (see list below).

## Setup

```bash
pip install -r requirements.txt   # pytest, httpx, paho-mqtt, websockets (pinned)
```

## Run

```bash
cd tests/

# unit/contract only — the default, zero services needed
pytest

# everything that can run locally (integration auto-skips without env)
pytest -m "not integration"

# integration against the compose stack
docker compose -f ../docker-compose.yml up -d --wait
BASE_URL=http://localhost:8000 MQTT_HOST=localhost pytest -m integration

# REST only / MQTT only
BASE_URL=http://localhost:8000 pytest -m integration -k "not mqtt and not edge"
MQTT_HOST=localhost pytest -m integration -k "mqtt or edge or heartbeat"

# destructive scenarios (stop/start edge-bridge) — opt-in
DISRUPTIVE=1 BASE_URL=http://localhost:8000 MQTT_HOST=localhost \
    pytest -m "integration and disruptive"
```

### Env vars

| Var | Default | Used by |
|---|---|---|
| `BASE_URL` | — (skips REST/WS tests) | REST + WebSocket tests |
| `MQTT_HOST` / `MQTT_PORT` | — / `1883` | broker-level tests |
| `OPERATOR_TOKEN` / `VIEWER_TOKEN` | `demo-operator` / `demo-viewer` | auth tests |
| `DISRUPTIVE` | — | tests that stop/start compose services |
| `COMPOSE_FILE` | `../docker-compose.yml` | disruptive tests |
| `SITE` / `EDGE_ID` | `plant1` / `edge1` | topic construction |
| `KC_URL` / `KC_REALM` | `http://localhost:8080` / `wds` | real-IdP token fetches (`test_oidc.py`) |
| `KC_DEMO_PASSWORD` | `kc-demo-pass` | realm test-user password grant |
| `WDS_TEST_APP_DSN` | — (skips revocation tests) | `revoked_sessions` + `wds_authz` NOTIFY writes |

v4 T5 notes: `api` is authenticated (operator) by default — anonymous probes
use `anon_api`. `test_oidc.py` exercises the REAL Keycloak (password grant
on `wds-web`, `make seed-dev` required): token shape, member reads, viewer
403, sid revocation → REST 401 + WS 4401 within 5 s, disabled user → 401.
`contract/test_jwt_security.py` covers the offline matrix: expired/wrong
iss/aud tokens, `none`+HS256+forged-key confusion, missing claims, JWKS
refetch rate-limiting, IdP outage fail-closed, dev-token prod rejection,
logout_token validation.

## Known contract divergences (for the red-team review)

These are `# DIVERGENCE` / `AMBIGUITY` flags in `contract/schemas.py` — places
where docs disagree or are silent, and the choice this suite encodes:

1. **Denied detail `out_of_range`** — CONTRACT.md sim table uses it for
   speed_sp outside 0–60 Hz; the 05 §3 fixed set
   (`not_writable|interlock|ttl_expired|clock_untrusted`) omits it.
   → included (CONTRACT.md wins).
2. **WS auth-expired close code** — CONTRACT.md: **4401**; 09 §6.6: 4001.
   → 4401.
3. **Heartbeat cadence** — CONTRACT.md: every **5 s**; 04 §6: 10 s. → 5 s.
4. **cmd/cmd-resp topic prefix** — CONTRACT.md: `plant1/cmd/edge1/{req}`;
   05 §1: `cmd/{edge_id}/{req}` (no site). → site-prefixed.
5. **Alarm `state`** — CONTRACT.md shape: `active|acked`; 05 §3 DB CHECK adds
   `cleared`. → strict `active|acked`.
6. **Anonymous WS + command events** — RESOLVED in v4 T5: anonymous
   connections (and anonymous REST reads) are gone entirely; `command`
   events additionally stay operator-scoped on authenticated sockets.
7. **Non-writable tag POST** — 06 §1 says `403` upfront; CONTRACT.md expects
   `denied/not_writable` in the lifecycle. → 201→denied preferred; a 4xx
   upfront is `xfail`ed, not failed.
8. **Clock vs TTL order** at the edge (both bad) — we check
   `clock_untrusted` first (untrusted clock makes TTL math meaningless).
9. **Value type mismatch** at the edge — no `denied` detail exists in the
   contract set → edge `error` (`bad_value_type`) → backend `failed`.
10. **`sent → done` direct transition** — allowed (`acked` is observational;
    the single cmd-resp can collapse ack+terminal into one write).
11. **Rate limiting** — 06 §6 defines 30/min on commands; CONTRACT.md omits
    it → burst test accepts 201/409/429, never 5xx.
12. **Malformed/expired token on mutating endpoint** — treated as anonymous
    → 401 (fail-closed).

## Layout

```
tests/
├── pytest.ini              # markers: integration, disruptive, slow
├── requirements.txt        # pinned deps
├── conftest.py             # env gating, fixtures, wait_until helper
├── ATTACK_PLAN.md          # adversarial checklist → test mapping
├── contract/
│   ├── schemas.py          # executable contract (stdlib only)
│   ├── test_topics.py      # UNS topic/tag grammar
│   ├── test_tagvalue.py    # telemetry + heartbeat payloads, ISO8601-Z
│   ├── test_command_payloads.py  # REST/MQTT cmd + cmd-resp + alarm shapes
│   ├── test_lifecycle.py   # state machine, dedup ordering, edge pipeline
│   ├── test_auth_ws.py     # tokens, RBAC matrix, WS event scope/shape
│   └── test_jwt_security.py# offline JWT matrix: bad/expired/iss/aud,
│                           #   alg-confusion, JWKS, logout_token (v4 T5)
├── integration/
│   ├── test_rest.py        # health, tags, commands, auth 401/403, idempotency
│   ├── test_adversarial.py # 409 race, replay-after-409, MQTT attacks, skew
│   ├── test_ws.py          # tag/command event streams, WS auth frames
│   ├── test_oidc.py        # real Keycloak: token shape, revocation ≤5s
│   ├── test_ratelimit.py   # 429/Retry-After, WS origin + per-IP cap
│   ├── test_insights.py    # insights API + filters
│   └── test_alarms.py      # temp>80 → alarm → ack (slow)
├── e2e/uat.mjs             # browser UAT incl. Keycloak round-trip smoke
├── security/               # OWASP sweep — `make test-security` (v4 T13)
├── perf/                   # SLO harness — `make test-perf` (v4 T13)
└── tenancy/                # RLS + audit tests as the runtime DB roles
```
