# Factory I/O and AI inference

## Factory I/O as the data source (simulation stage of the SDLC)

dev (`ADAPTER=sim`) → **simulation (Factory I/O over Modbus TCP)** → staging/real PLC. Same bridge, same tags — only the adapter changes.

1. In Factory I/O: *File → Drivers → Modbus TCP/IP Server*, port 502, then map the scene's sensors/actuators.
2. Edit the `modbus.tags` map in `edge-bridge/tags.yaml` so each tag's `address`/`type` matches the scene's I/O. Tag names must stay equal to the `sim.tags` names (the backend registry is seeded from those).
3. Run: `EDGE_ADAPTER=modbus` (+ `MODBUS_HOST`, default `host.docker.internal`, `MODBUS_PORT`) then `docker compose up -d --build edge-bridge`.
4. Unreachable Factory I/O ⇒ every tag is published `q=bad` (never a fake value); alarms/insights ignore it.
5. Writes (`motor1.running`, `speed_sp`) go back through `write_coil` / `write_register`, range-checked by `min`/`max`.

## AI inference (your model server)

Set `INFERENCE_URL` (and optionally `INFERENCE_API_KEY_FILE`, `INFERENCE_PERIOD_S`, `INFERENCE_TIMEOUT_S`). The backend POSTs the org's latest tags and shows the answer on **Assistant** (`GET /api/v1/orgs/{org}/inference`, cached for the period).

    POST  {"org_id", "ts", "tags": [{"name", "v", "q", "ts"}]}
    200   {"model": "...", "results": [{"tag"?, "label", "score": 0..1, "severity"?: "info|warning|critical", "detail"?}]}

Try it: `python scripts/mock_inference.py` and `INFERENCE_URL=http://host.docker.internal:9100/predict`.
