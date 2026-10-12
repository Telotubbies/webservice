# edge-bridge

Protocol bridge between an OT data source and MQTT. One process = one
adapter (see `edge_bridge/adapters/`): `sim` (default, no hardware) or
`modbus` (stub — real structure, optional `pymodbus`).

Every tag is published as a normalized `TagValue` every `POLL_MS` to
`{site}/{area}/{line}/{device}/{signal}` QoS 1; heartbeat every 5 s to
`{site}/edge/{edge_id}/heartbeat`. Commands arrive on
`{site}/cmd/{edge_id}/{req_id}` and are answered on
`{site}/cmd-resp/{edge_id}/{req_id}` — always exactly one response.

## Run locally

```bash
pip install -r requirements.txt

# terminal 1 — a broker (any of):
docker run -p 1883:1883 eclipse-mosquitto:2     # or the repo's compose

# terminal 2
MQTT_HOST=localhost python -m edge_bridge.main
```

Watch it work:

```bash
mosquitto_sub -t 'plant1/#' -v
mosquitto_pub -t plant1/cmd/edge1/req-1 -m \
  '{"command_id":"c1","tag":"plant1.sort.line1.motor1.running","value":true,"issued_at":"2025-01-01T00:00:00Z","ttl_s":60,"idempotency_key":"k1","user":"op1"}'
```

## Run in Docker

```bash
docker build -t edge-bridge .
docker run --rm --network host edge-bridge          # talks to localhost:1883
# or attached to the compose network:
docker run --rm --network webservice_default -e MQTT_HOST=mosquitto edge-bridge
```

## Configuration (env)

| Var | Default | Meaning |
|---|---|---|
| `MQTT_HOST` / `MQTT_PORT` | `localhost` / `1883` | broker |
| `EDGE_ID` / `SITE` | `edge1` / `plant1` | topic identity |
| `ADAPTER` | `sim` | `sim` or `modbus` |
| `POLL_MS` | `1000` | tag publish cadence |
| `EDGE_CLOCK_SKEW_MS` | `0` | simulated clock offset; \|skew\|>500 → `clock_ok=false`, commands denied `clock_untrusted` |
| `TAGS_CONFIG` | `tags.yaml` | tag registry / modbus register map |

## Sim tags (contract §Sim tags)

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
