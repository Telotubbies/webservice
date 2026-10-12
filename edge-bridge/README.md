# edge-bridge

Protocol bridge between an OT data source and MQTT. One process = one
adapter (see `edge_bridge/adapters/`): `sim` (default, no hardware) or
`modbus` (stub — real structure, optional `pymodbus`).

Topic namespace is `v2/{org_id}/{site_id}/{edge_id}/...` — topic identity is
UUIDs only (doc 17). Every tag is published as a normalized `TagValue` every
`POLL_MS` to `v2/{org}/{site}/{edge}/tele/{tag-tail}` QoS 1; heartbeat to
`v2/{org}/{site}/{edge}/hb`. Commands arrive on
`v2/{org}/{site}/{edge}/cmd/{command_id}` and are answered on
`v2/{org}/{site}/{edge}/cmd-resp/{command_id}` — always exactly one response.

## Identity & security (doc 17)

The bridge authenticates as a **provisioned per-device identity**
(`edge-{edge_uuid}-v{n}` + secret), not a shared credential. Broker ACLs
(dynsec plugin) pin the client to its own `v2/{org}/{site}/{edge}` prefix —
it cannot publish into another org/site/edge, subscribe to `v2/#`, or touch
`$CONTROL`/`$SYS`. The listener is TLS on **8883** (`infra/gen-certs.sh` →
`make certs`); plaintext 1883 exists only under the test compose overlay.
The bridge re-reads its credential file on each reconnect so a rotation
takes over at cut-over.

Provision an edge via `POST /api/v1/orgs/{org}/sites/{site}/edges` — the
secret is returned once and stored in `infra/secrets/` (file-mounted, never
in `docker inspect` env).

## Run locally

```bash
pip install -r requirements.txt
make certs        # repo root — dev CA + server cert (once)

MQTT_HOST=localhost MQTT_PORT=8883 \
MQTT_CA_FILE=../infra/certs/ca.crt \
MQTT_USERNAME_FILE=../infra/secrets/edge_bootstrap_user \
MQTT_PASSWORD_FILE=../infra/secrets/edge_bootstrap_pw \
ORG_ID=… SITE_ID=… EDGE_ID=… \
python -m edge_bridge.main
```

(In the compose stack all of this is wired automatically.)

## Run in Docker

```bash
docker build -t edge-bridge .
docker run --rm --network webservice_default \
  -e MQTT_HOST=mosquitto -e MQTT_PORT=8883 \
  -v ../infra/certs:/mosquitto-certs:ro \
  edge-bridge
```

## Configuration (env)

| Var | Default | Meaning |
|---|---|---|
| `MQTT_HOST` / `MQTT_PORT` | `localhost` / `8883` | broker (TLS) |
| `MQTT_CA_FILE` | — | CA cert for broker verification |
| `MQTT_USERNAME_FILE` / `MQTT_PASSWORD_FILE` | — | provisioned credential files (re-read per reconnect for rotation) |
| `ORG_ID` / `SITE_ID` / `EDGE_ID` | — | UUID topic identity |
| `SITE` | `plant1` | tag-naming site code, not a topic identity |
| `ADAPTER` | `sim` | `sim` or `modbus` |
| `POLL_MS` | `1000` | tag publish cadence |
| `EDGE_CLOCK_SKEW_MS` | `0` | simulated clock offset; \|skew\|>500 → `clock_ok=false`, commands denied `clock_untrusted` |
| `TAGS_CONFIG` | `tags.yaml` | tag registry / modbus register map |

## Sim tags

| Tag | Writable | Behavior |
|---|---|---|
| `plant1.sort.line1.motor1.running` | yes | start/stop conveyor |
| `plant1.sort.line1.motor1.speed_sp` | yes | setpoint Hz 0–60, else `denied/out_of_range` |
| `plant1.sort.line1.conv1.speed_mps` | no | follows motor1, 0 stopped, + noise |
| `plant1.sort.line1.conv1.temp_c` | no | drifts up running; >80 = alarm |
| `plant1.sort.line1.bin1.level_pct` | no | ramps 0→100 running, decays stopped |
| `plant1.sort.vision.cam1.gravel_ratio` | no | slow random walk 0–1 |

Unknown or read-only tag write → `denied/not_writable`. Expired `ttl_s` →
`denied/ttl_expired`. Untrusted clock → `denied/clock_untrusted` (checked
before TTL — a TTL on an untrusted clock proves nothing).

## Modbus

`ADAPTER=modbus` loads the `modbus:` register map from `tags.yaml`
(example commented at the bottom). Without `pymodbus` installed — or with
the device unreachable — every tag publishes `q:"bad"`; install it to go
live: `pip install pymodbus`. IEC-style addresses (`%QX0.0`, `%QW2`) and
plain integers are both accepted.
