# tests/ — QA suite for the industrial dashboard demo

Two layers, one command runner:

| Layer | Where | Needs services? | What it proves |
|---|---|---|---|
| **contract/unit** | `contract/` | no | CONTRACT.md semantics: payload validators, tag/topic grammar, command lifecycle state machine, dedup-before-409 ordering, edge deny pipeline, RBAC matrix, WS event shapes |
| **integration** | `integration/` | yes (compose) | live backend + edge + broker: REST, commands end-to-end, alarm pipeline, WS streams, adversarial MQTT/REST attacks |

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
6. **Anonymous WS + command events** — CONTRACT.md lists `command` events
   without scoping; 06 §2 / 08 §2 / 09 §7 forbid leaking them to anonymous.
   → restrictive reading encoded; `test_ws_anonymous_no_command_events`
   failing is a red-team finding.
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
│   └── test_auth_ws.py     # tokens, RBAC matrix, WS event scope/shape
└── integration/
    ├── test_rest.py        # health, tags, commands, auth 401/403, idempotency
    ├── test_adversarial.py # 409 race, replay-after-409, MQTT attacks, skew
    ├── test_ws.py          # tag/command event streams, anonymous scoping
    └── test_alarms.py      # temp>80 → alarm → ack (slow)
```
