# edge-bridge

Protocol bridge between an OT data source and MQTT. One process = one
adapter family (see `edge_bridge/adapters/`): `sim` (default, no hardware),
`modbus`, `s7` or `opcua`. Enrolled gateways get their sources and tags from
the web console (**Data sources**), pushed over MQTT; the env/`tags.yaml`
path below still works for bootstrap.

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

## Enroll a gateway (recommended)

1. Web console: **Devices → Add device** → copy the one-time enrollment code (30 min, single-use; *New code* issues another).
2. Start the gateway with the backend URL, the code and a persistent state volume:

```bash
docker run -d --restart unless-stopped --name edge-bridge   -e WDS_URL=https://wds.example.com -e ENROLL_CODE=<code>   -v edge-state:/var/lib/wds-edge   edge-bridge
```

| Var | Meaning |
|---|---|
| `WDS_URL` | backend base URL. **https only** — the enroll answer carries the MQTT password |
| `WDS_INSECURE_TLS=1` | dev only: skip certificate verification and allow a plain `http://` `WDS_URL` (credentials then travel in cleartext) |
| `ENROLL_CODE` | used once; ignored after `identity.json` exists, so leaving it in the env is harmless |
| `STATE_DIR` | default `/var/lib/wds-edge` — mount it as a volume |

On first start the bridge POSTs the code to `/api/v1/edge/enroll` and writes `identity.json` (0600: org/site/edge ids, broker host/port, MQTT credential, at-rest `state_key`) and `ca.pem` into the state dir. A failed enroll (bad/used/expired code, HTTP) exits non-zero and the restart policy retries; a used or expired code needs a new one from the UI.

After enrollment the adapter is **idle** (publishes nothing) until the first `cfg` arrives. The bridge then asks for it (`cfg-req`), applies it live without restart, acks (`cfg-ack`), and caches the applied config in the state dir (`cfg.json`, AES-GCM sealed with `state_key` since it holds source secrets) so it can start before the backend is reachable.

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

This env-bootstrap path (provisioned credential files + `tags.yaml`) remains supported and is what the compose stack wires; no `cfg` has ever been applied, so the yaml-driven adapter keeps running (a `version 0` cfg is ignored).

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
| `ADAPTER` | `sim` | `sim`, `modbus`, `s7` or `opcua` (env bootstrap only; enrolled gateways take sources from `cfg`) |
| `STATE_DIR` | `/var/lib/wds-edge` | identity, CA and config cache |
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

## Adapters

Every adapter reports `q:"bad"` (never a fake value) when the device is unreachable or a read fails, and range-checks writes against `min`/`max`.

| Protocol | Notes / limits |
|---|---|
| `sim` | no hardware; table above |
| `modbus` | coils, discrete inputs, holding/input registers; `int16/uint16/int32/uint32/float32`, big/little word order. IEC addresses (`%QX0.0`, `%QW2`, `%IW4`) and plain integers both accepted. Needs `pymodbus` |
| `s7` | Siemens via `python-snap7`; reads batched per area/DB. The PLC must allow **PUT/GET** access and data blocks must be **non-optimized** (absolute offsets). Needs a reachable rack/slot |
| `opcua` | `asyncua`; node ids per tag, one-level browse from the console. Security mode **none** only for now (`sign`/`signencrypt` report `security_mode_not_supported_yet`); user/password auth is refused on an unencrypted channel (`user_auth_requires_encryption`), so for now use anonymous |

The console can also **test** a draft source and **browse** OPC UA nodes through the gateway (`test_source` / `browse` ops, time-bounded, read-only).

## Credential rotation

Rotating an edge in the console issues a new credential version and pushes it in-band on `v2/{org}/{site}/{edge}/cred` (QoS 1, not retained). The gateway writes it into `identity.json` atomically and reconnects; the old credential stays valid for a grace window (`EDGE_CRED_GRACE_S`, default 24 h) and retires early once the gateway is live on the new one. A gateway that was **offline longer than the grace window** misses the push and can no longer connect: wipe its state volume (`docker volume rm edge-state`) and enroll again with a new code from **Devices**. Env-bootstrap gateways are unaffected: they re-read their credential files per reconnect.
