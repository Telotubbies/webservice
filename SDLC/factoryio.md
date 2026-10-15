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
