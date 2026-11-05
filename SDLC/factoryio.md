# Factory I/O and AI inference

## Factory I/O as the data source (simulation stage of the SDLC)

dev (`ADAPTER=sim`) → **simulation (Factory I/O over Modbus TCP)** → staging/real PLC. Same bridge, same tags — only the adapter changes.

1. In Factory I/O: *File → Drivers → Modbus TCP/IP Server*, port 502, then map the scene's sensors/actuators (see the address table below).
2. In the web console: **Devices → Add device**. Copy the one-time enrollment code (valid 30 min; *New code* issues another) and start the gateway with it — see `edge-bridge/README.md` (`WDS_URL`, `ENROLL_CODE`).
3. Open **Data sources** for that device and either click **Use Factory I/O - Sorting template** (creates the source, the tags below, the *Process metrics* dashboard and two alarm rules), or **Add source → Modbus** with host `host.docker.internal`, port 502, unit id 1, then add tags one by one or with **Paste CSV** (`tags:bulk`).
4. The backend pushes the config to the gateway over MQTT; the source shows *applied* with its config version within a few seconds. No restart, no yaml.
5. Unreachable Factory I/O ⇒ every tag is published `q=bad` (never a fake value); alarms/insights ignore it.
6. Writes (`motor1.running`, `speed_sp`, `pusher1.extend`) go back through `write_coil` / `write_register`, range-checked by `min`/`max`.

### Scene I/O the template expects

The Modbus addresses are fixed by the template; map the scene's I/O to the same addresses (IEC `%QX`/`%QW` = coils / holding registers, `%IW` = input registers).

| Tag | Address | Type | Scale | Writable |
|---|---|---|---|---|
| `motor1/running` | `%QX0.0` | bool | | yes |
| `pusher1/extend` | `%QX0.1` | bool | | yes |
| `motor1/speed_sp` | `%QW2` | number (Hz, 0–60) | 0.1 | yes |
| `conv1/speed_mps` | `%IW4` | number | 0.01 | no |
| `conv1/temp_c` | `%IW6` | number | 0.1 | no |
| `bin1/level_pct` | `%IW8` | number | 1 | no |
| `cam1/gravel_ratio` | `%IW10` | number | 0.001 | no |

To use different addresses, edit the tag's *address* on the Data sources page (or re-paste the CSV) — the change is pushed to the gateway on save. Scale is applied as `value × scale + offset` on read and inverted on write.

## AI inference (your model server)

Set `INFERENCE_URL` (and optionally `INFERENCE_API_KEY_FILE`, `INFERENCE_PERIOD_S`, `INFERENCE_TIMEOUT_S`). The backend POSTs the org's latest tags and shows the answer on **Assistant** (`GET /api/v1/orgs/{org}/inference`, cached for the period).

    POST  {"org_id", "ts", "tags": [{"name", "v", "q", "ts"}]}
    200   {"model": "...", "results": [{"tag"?, "label", "score": 0..1, "severity"?: "info|warning|critical", "detail"?}]}

Try it: `python scripts/mock_inference.py` and `INFERENCE_URL=http://host.docker.internal:9100/predict`.

## Vision on the edge (plan M1-05 demo)

> Not run this session — commands below are the intended path, verified code-wise only.

1. Intended commands — apply the capabilities migration (take a DB backup first), then rebuild the touched services and recreate mosquitto so the new 8 MiB packet cap takes effect:
   ```bash
   make migrate                      # applies migrations/versions/0020_edge_capabilities
   docker compose up -d --build backend edge-bridge model-server web
   docker compose up -d --force-recreate mosquitto
   ```
   `MODEL_SERVER_URL` is wired to `http://model-server:9000` inside the compose network — the model server has no host port.
2. **Infrastructure → Models**: create a model, upload a `.onnx` version, activate it (draft also works for testing).
3. **Cameras**: add a camera on the gateway, open *Model and classes*, pin the version and keep placement *On the gateway*.
4. **Models → version row → Test**: pick an online gateway, drop a JPEG/PNG (≤ 5 MB) or *Use latest frame* from a camera, then *Run test*. Detections are drawn on the image; latency/engine come from the gateway. The image is streamed to the edge over MQTT (base64) and never persisted or logged; the broker packet cap is 8 MiB for this reason.
5. The camera tile shows the measured engine/latency once the model reports `ready`; FPS appears only after the gateway's benchmark finishes (there is no estimated FPS).
