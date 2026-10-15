# Data sources, vision, and customer onboarding — design

Date: 2026-10-15 · Status: draft for approval · Branch: `feature/design`

## 1. Intent

Today nobody but the person who runs the stack can put data into WDS. PLC
connections live in `edge-bridge/tags.yaml` + env vars, the tag registry is
seeded (`backend/app/seed.py`), and the AI model is two env vars
(`INFERENCE_URL`, `INFERENCE_API_KEY`). A customer opening the web console
finds no place to add a PLC, a tag, a camera, or a model.

This design makes the whole path self-service from the browser, so the
system is ready for real customers even though there are none yet (this is a
thesis; it is built "to be ready").

The thesis demo that has to work end to end:

> An admin uploads a video clip (stand-in for an IP CCTV camera). The web
> console plays it with a live segmentation overlay. When the model sees the
> target class, WDS writes a value to the PLC inside **Factory I/O**, and the
> machine in the simulated plant reacts (e.g. a pusher rejects the part).

No hardware is used for the demo: Factory I/O is the plant, the uploaded clip
is the camera. Everything must still be designed so a real Siemens PLC and a
real RTSP camera drop in without redesign.

## 2. Who uses it

Everyone in a plant, from the owner to line workers. The user named them;
the split of duties is the designer's reading:

| Person | Does in this feature | Role (existing RBAC) |
|---|---|---|
| Automation engineer | enrolls gateways, adds PLCs, maps tags, adds cameras, writes vision rules | `admin` (`config:write`) |
| Supervisor | renames devices, groups by line, watches online/offline, sees camera views | `admin` or `operator` |
| Line worker | watches values and the camera view, acks alarms | `operator` / `viewer` |
| Owner / non-technical | applies a template ("Factory I/O – Sorting") and sees graphs, no addresses | `owner` |

No new role. `config:write` (admin/owner) gates every create/edit here.
*(Designer's call — an `engineer` role can be added later without schema change.)*

## 3. Goals, non-goals, anti-goals

**Goals**
- G1 Enroll a gateway from the web: one copy-paste command on the gateway host, then it shows *online*.
- G2 Add a PLC connection (Modbus TCP, Siemens S7, OPC UA) and its tags from the web; values appear within one poll cycle; no file edits, no restarts.
- G3 Tags created in the UI are first-class: dashboards, alarm rules, SLOs, commands, inference all see them.
- G4 Add a camera: RTSP URL (real) or uploaded video file (demo). Watch it live in the browser with the segmentation overlay on/off.
- G5 Vision rules: "class X detected (score ≥ t, optional zone) → write value V to tag Y", executed through the existing command path (audited, rate-limited, range-checked).
- G6 A non-technical user can get to a working dashboard via a template without knowing an address.
- G7 Per-org AI model settings in the UI (URL, key, model name, test button) replacing the env-only setup.

**Goals added by the user on review ("these must all be doable") — Phases D/E**
- G8 GPU inference: the model server runs on CUDA when a GPU is present
  (`onnxruntime-gpu` image variant, auto-fallback to CPU), selectable per edge.
- G9 Labeling: in-browser labeling of frames sampled from cameras/videos
  (polygon + class), stored as datasets per org.
- G10 Training: start a fine-tune job (YOLO‑seg) from a dataset; runs on a
  GPU training worker; progress + metrics in the UI.
- G11 Model registry: versions per org (`model_versions`: artifact, classes,
  metrics, source dataset, status `draft|staged|production`); a camera pins a
  version; rollout = edges download the artifact via `cfg`.
- G12 Tag discovery for S7: S7 has no on-wire symbol browse, so "browse" is
  (a) import of a TIA Portal tag-table / DB export (xlsx/csv/`.db` source)
  that resolves symbols to absolute addresses, and (b) an area scanner that
  reads M/I/Q/DB ranges and shows changing values. Modbus gets (b) too.
  Constraint shown in the UI: S7-1200/1500 need PUT/GET enabled and
  **non-optimized** DBs for absolute access.
- G13 Recording: per-camera continuous or event-triggered recording
  (segments of 60 s, H.264 passthrough, pre/post-roll around vision events),
  retention per org (days / GB cap), playback with overlay of stored
  detections.
- G14 Multi-replica fan-out: frames and WS events go through a broker
  (Redis pub/sub, or Postgres LISTEN/NOTIFY for events only), so any backend
  replica can serve any viewer; the in-memory caches (`inference.py`, frame
  buffer) move behind the same interface.
- G15 Remote access to plant devices: optional WireGuard sidecar on the edge
  that dials the WDS server (still outbound), giving admins an audited,
  time-boxed tunnel to a camera's or PLC's web UI; off by default.

**Anti-goals (would be a failure even if it works)**
- A1 Any path where AI writes to a PLC without an audit row, a range check, and an off switch.
- A2 A secret (PLC password, RTSP credentials, model API key, enrollment code) shown again after creation or stored in plaintext.
- A3 A non-technical user being forced through a register-address form to see anything.
- A4 Breaking the doc-17 MQTT trust model (edge can only speak on its own prefix).

## 4. Architecture

```
 PLANT LAN (or the dev laptop)                    WDS server
 ┌──────────────────────────────────┐            ┌───────────────────────────────┐
 │ PLC / Factory I/O ──Modbus/S7/UA─┐│            │ backend (FastAPI)             │
 │                                  ▼│  MQTT/TLS  │  ├ edge config publisher      │
 │                            edge-bridge ◀──────▶│  ├ registry (tags from DB)    │
 │                                   │  outbound  │  ├ commands (existing)        │
 │ IP camera ──RTSP──┐               │            │  ├ vision rule engine         │
 │                   ▼               │  WSS       │  └ frame relay → browsers     │
 │              vision-worker ◀──────┼───────────▶│                               │
 │                   │ HTTP          │  outbound  │ Postgres  (RLS, per org)      │
 │            model server (ONNX)    │            │ web (React)                   │
 └──────────────────────────────────┘            └───────────────────────────────┘
```

Rule: **every connection is opened from the plant side** (MQTT and WSS
outbound). The server never dials into the plant. A demo stack runs all boxes
on one machine via docker compose; the upload path makes the camera optional.

### Components (new or changed)

| Component | Status | Change |
|---|---|---|
| `edge-bridge` | changed | multi-source; config pulled from backend over MQTT; adapters `modbus` (exists), `s7` (new), `opcua` (new); `test`/`browse` ops; enrollment |
| `vision-worker` | **new** service (Python) | reads RTSP or an uploaded file, samples frames, calls model, sends overlay frames + detections to backend over WSS |
| model server | **new**, reference impl | HTTP contract (§7.3); reference = YOLO‑seg ONNX on CPU in its own container; any server speaking the contract can replace it |
| backend | changed | data-source + tag CRUD, edge config publisher, enrollment, cameras, uploads, frame relay, vision rules, per-org model settings |
| web | changed | *Data sources*, *Cameras*, *Vision rules*, *AI model* settings, getting-started checklist |

## 5. Phase A — Data sources (gateways, PLC connections, tags)

### 5.1 Enrollment (G1)

1. Admin: **Data sources → Add gateway** → name + site. Backend creates the
   `edges` row (existing `POST …/edges` path) and an **enrollment code**:
   8 chars, base32, single use, 30 min TTL, stored as sha256 only.
2. UI shows a copy-paste command, e.g.
   `docker run -d --name wds-edge -e WDS_URL=https://… -e ENROLL_CODE=K7QX-3MPA ghcr.io/…/wds-edge`
   plus a compose snippet; dev stack uses the existing `edge-bridge` service.
3. On first start with no stored identity, edge-bridge calls
   `POST /api/v1/edge/enroll {code}` (unauthenticated, rate-limited per IP,
   code-only). Response: `org_id, site_id, edge_id, mqtt_host, mqtt_port,
   ca_pem, mqtt_username, mqtt_password` — the credential minted by the
   existing dynsec provisioning. Edge writes them to its data volume (0600) and
   never calls enroll again; rotate/disable keep working as today.
4. UI polls the edge; it flips *pending → online* on first heartbeat.

The existing bootstrap env path (`ORG_ID/SITE_ID/EDGE_ID` + secret files)
stays as a fallback so CI and the current dev stack don't break.

### 5.2 Data model (migration 0014)

```
data_sources                       -- one PLC / server connection, owned by one edge
  id, org_id, site_id, edge_id
  name                text
  protocol            'modbus' | 's7' | 'opcua'
  connection          jsonb        -- protocol-specific, validated (§5.3); no secrets
  secret_enc          bytea NULL   -- encrypted secrets (OPC UA password etc.)
  poll_ms             int  (100..60000, default 1000)
  enabled             bool
  status              'unknown'|'ok'|'error'   -- reported by edge
  status_detail       text, status_at timestamptz
  created_at, updated_at

tags  (existing) + columns:
  source_id           uuid NULL REFERENCES data_sources   -- NULL = legacy/sim
  address             jsonb NULL   -- protocol-specific (§5.3)
  scale, offset       double precision NULL
  deadband            double precision NULL

edges (existing) + columns:
  config_version      bigint NOT NULL DEFAULT 0   -- bumps on any source/tag change
  config_applied      bigint NULL                 -- version the edge acked
  config_error        text NULL

edge_enrollments
  id, org_id, edge_id, code_hash (sha256), expires_at, used_at, created_by
```

All new tables: same fail-closed RLS shape as `edge_identities` (0004) and a
`wds_system` lookup policy where the publisher/enroll path needs it.
`secret_enc`: AES-GCM with a key from a mounted secret file
(`DATA_SOURCE_KEY_FILE`), same handling style as other secrets in `config.py`.

Tag `path` keeps today's rule (`area/line/device/signal`); the UI builds it
from the line/device the user picks plus a signal name, so users never type a
slash path.

### 5.3 Protocol shapes

| | `connection` | tag `address` | browse | lib |
|---|---|---|---|---|
| Modbus TCP | `{host, port=502, unit_id=1, timeout_ms}` | `{area: coil\|discrete_input\|holding_register\|input_register, index, datatype: bool\|int16\|uint16\|int32\|float32, word_order}` | no | `pymodbus` (exists) |
| Siemens S7 | `{host, rack=0, slot=1, timeout_ms}` | `{area: DB\|M\|I\|Q, db, byte, bit?, datatype: bool\|int\|dint\|real\|word}`; UI also accepts the text form `DB1.DBD4`, `M0.1`, `I0.0` | no | `python-snap7` |
| OPC UA | `{endpoint, security: none\|sign\|signencrypt, auth: anonymous\|user}` (+ user/password in `secret_enc`) | `{node_id: "ns=3;s=Motor1.Speed"}` | **yes** | `asyncua` |

The current string address forms in `modbus.py` (`%QX0.0`, `%IW4`) are still
accepted by the UI parser and normalized into the jsonb shape.

### 5.4 Edge config delivery

- New topic `v2/{org}/{site}/{edge}/cfg`, **not retained** (a retained
  message would sit in Mosquitto's on-disk persistence with decrypted
  secrets, violating A2), published by `svc-backend`, QoS 1. Delivery:
  the edge publishes `cfg-req {have_version}` on every (re)connect; the
  backend answers with the full config if the edge is behind, and pushes
  a new one whenever `config_version` bumps. The edge caches the last good
  config on its data volume encrypted with a per-edge key handed out at
  enrollment. Payload: `{version, sources:[{id, protocol,
  connection, secrets, poll_ms, enabled, tags:[{id, path, type, address,
  scale, offset, writable, min, max}]}], cameras:[…] (Phase B)}`. Secrets
  are decrypted only into this payload, which travels on TLS and an ACL
  only that edge can read.
- Edge ACL (doc 17 §3) gains `subscribePattern {p}/cfg`,
  `publishClientSend {p}/cfg-req` and `{p}/cfg-ack`; `edge_acls()` in
  `dynsec.py` changes and the reconciler re-applies it to existing edges.
- `sim` is a fourth `protocol` value (no connection fields; tags carry the
  existing `behavior` metadata in `address`). Migration 0014 converts the
  seeded sim tags into one `sim` source on the seeded edge, so CI, seeded
  dashboards and `tests/` keep working after the edge switches to `cfg`.
- Edge on receive: validate, build adapters per source, swap atomically, then
  publish `cfg-ack {version, ok, errors:[{source_id|tag_id, detail}]}`.
  On a bad config it keeps running the last good one.
- Backend: any write to `data_sources`/`tags` bumps `edges.config_version`
  in the same transaction and NOTIFYs; a publisher task publishes the
  retained message. `cfg-ack` updates `config_applied/config_error` and per
  source `status`. UI shows *Applied v12* / *Pending* / the error.
- Edge falls back to `tags.yaml` only when it has never received a `cfg`
  (keeps the sim/dev path alive).
- Telemetry: edge keeps publishing on `tele/{path}` as today, so the ingest
  path, history, alarms and WS fan-out don't change.

### 5.5 Test & browse (G2)

Request/response over the existing command channel with a new op type,
not a tag write: `cmd/{id}` payload `{op: "test_source"|"browse",
source: {...draft connection...}, node_id?}` → `cmd-resp/{id}`. Backend
exposes `POST …/data-sources/test` and `POST …/data-sources/{id}/browse`
(returns OPC UA children, max 500, one level per call). These do not create
`commands` rows (no PLC write happens); they are audited as `source.test`.

### 5.6 Registry (G3)

`registry.py` already loads tags from the DB per org; the change is
NOTIFY-driven refresh (`wds_tags`) on tag CRUD instead of only the 30 s timer,
and `seed.py` stops being the only creator of tags. Nothing downstream
(dashboards, alarms, SLO, inference) needs changes because they read the
registry.

### 5.7 UI — *Data sources* (Infrastructure group)

- **Gateways list**: name, site, status (online/stale/offline from
  heartbeat), adapter(s), config *Applied vN / Pending / Error*, actions
  (rotate, disable — existing).
- **Gateway → Sources**: add source wizard: protocol → connection form →
  **Test connection** (must pass or be explicitly skipped) → save.
- **Source → Tags**: table with inline add/edit; bulk add by CSV paste
  (columns: line, device, signal, address, type, unit, writable, min, max,
  scale); OPC UA: tree browser with checkboxes → "Add selected".
  Each row shows live value + quality so the engineer sees a wrong address
  immediately.
- **Templates** (G6): "Factory I/O – Sorting by Height (Modbus)" and the
  existing sim layout. A template = lines, devices, tags with addresses,
  plus a dashboard (reuse `templates.ts`) and default alarm rules. The owner
  applies it to a gateway with one click; engineers can edit after.

## 6. Phase B — Cameras and vision

### 6.1 Data model (migration 0015)

```
cameras
  id, org_id, site_id, name
  kind             'rtsp' | 'upload'
  rtsp_url_enc     bytea NULL        -- full URL incl. credentials, encrypted
  video_id         uuid NULL REFERENCES videos
  edge_id          uuid              -- the gateway whose worker runs it
  fps_sample       real  (0.5..15, default 5)
  enabled          bool
  status, status_detail, status_at
videos
  id, org_id, filename, content_type, size_bytes, sha256, duration_s,
  storage_key, uploaded_by, created_at
vision_rules
  id, org_id, camera_id, name, enabled
  class_name       text
  min_score        real (0..1)
  zone             jsonb NULL        -- polygon in normalized 0..1 coords
  min_area_pct     real NULL
  debounce_ms      int  (default 1000)  -- re-arm time, one action per object pass
  action_tag_id    uuid REFERENCES tags (must be writable)
  action_value     jsonb
  pulse_ms         int NULL          -- write value, then write reset_value after pulse
  reset_value      jsonb NULL
vision_events
  id, org_id, camera_id, rule_id NULL, ts, class_name, score,
  bbox jsonb, thumbnail_key, command_id NULL, blocked_reason text NULL
```

RLS on all, same shape as above. `vision_events` is pruned after 30 days
*(designer's call)*.

### 6.2 Upload (demo camera)

- Admin only. `POST …/videos` multipart, mp4/webm (H.264/VP9), max 200 MB
  *(designer's call)*, validated by sniffing the container with `ffprobe`,
  stored on the `backend-data` volume under `videos/{org}/{id}` (object store
  later; the code goes through one `storage` module).
- Camera of kind `upload` loops the file at real-time speed, so the demo
  behaves like a live feed.

### 6.3 vision-worker

- **A camera belongs to an edge** (`cameras.edge_id`, same site rule as
  tags). The vision-worker is a sidecar of edge-bridge on the same host and
  uses the edge's enrolled identity — no new identity type, no cross-org
  worker. Camera config arrives in the edge's `cfg` (`cameras:[…]`, incl.
  decrypted RTSP URL); edge-bridge hands it to the worker over localhost.
  The demo stack's dev edge runs a worker too.
- Uploaded videos are downloaded by the worker over HTTPS from
  `GET …/edges/{edge}/videos/{id}` authenticated with an **edge token**
  (short-lived JWT the backend mints for the edge over MQTT
  `cfg`, scoped to that edge's org and cameras). Frames go up over WSS with
  the same token. No shared volumes between services.
- Model server URL: env `VISION_MODEL_URL` on the worker in Phase B
  (defaults to the reference container); Phase C lets the org override it
  per org, delivered in `cfg`. The model server runs next to the worker
  (plant LAN), so frames never leave the plant just for inference.
- Class list for the rule editor comes from the model server's
  `GET /classes`, cached per camera; there is no `model_profile` column.
- Per camera: OpenCV/ffmpeg reads RTSP (TCP transport, reconnect with
  backoff) or the uploaded file; samples at `fps_sample`; resizes to model
  input; calls the model server; draws masks + labels onto the frame;
  JPEG-encodes (quality ~70, ≤ 960 px wide).
- Sends to backend over one outbound WSS: `{camera_id, ts, jpeg_raw,
  jpeg_overlay, detections:[{class, score, bbox, polygon}]}`. Raw and
  overlay frames are both sent so the viewer can toggle.
- Where it runs: in the dev/demo compose stack for uploaded videos; at the
  plant (next to edge-bridge, same host) for RTSP cameras. Same image.

### 6.4 Browser view

- `GET /api/v1/orgs/{org}/cameras/{id}/stream?overlay=1` → MJPEG
  (`multipart/x-mixed-replace`) from the backend relay's latest-frame
  buffer; drops frames for slow viewers (never queues). Auth by the normal
  session; `<img>` can't send headers, so the page fetches a short-lived
  (60 s) signed stream URL first.
- Detections also go out on the existing WS as `vision` events (for the
  event list and counters).
- *(Designer's call: MJPEG is chosen over WebRTC/HLS because it is the
  simplest thing that works through the existing nginx and is enough for
  5–10 fps at demo scale. WebRTC is a later swap behind the same relay.)*

### 6.5 Vision rules → PLC (G5, A1)

- Evaluated **in the backend** on each detection message: class match,
  score ≥ min, bbox centre in zone, area ≥ min, rule not inside its debounce
  window.
- Fire = issue a command through `commands.py` exactly like a human write:
  `actor_user_id` = the org's **vision service user** (a service account like
  the 0012 API keys), `note = "vision rule <name> score 0.93"`. So it gets
  the audit row, range check, one-in-flight-per-tag, rate limit, and TTL for
  free.
- **Pulse is one command, executed on the edge**: command payload gains
  `pulse_ms` + `reset_value`; the adapter writes the value, waits, writes the
  reset, and only then acks. The reset is therefore not subject to backend
  gates (no 409/rate-limit can leave a pusher extended). If the edge loses
  the PLC mid-pulse it retries the reset until the connection returns and
  reports `failed: reset_pending` meanwhile.
- A fire blocked by a gate (in-flight, rate limit, switch off) is **dropped,
  not queued**, and recorded as a `vision_events` row with
  `blocked_reason`. Queued actuation from stale frames is unsafe.
- The vision service user (role `operator`, `kind=service` like 0012) is
  created the first time an admin turns on "AI may write to PLC" and is
  disabled when it is turned off.
- Off switches, any one blocks writes: rule `enabled`, camera `enabled`,
  site `control_enabled` (exists), and a per-org **"AI may write to PLC"**
  toggle (default **off**, owner/admin only, audited).
- `vision_events` records every fire with the resulting `command_id` and a
  thumbnail, so a reviewer can see what the model saw when it acted.
- Latency budget for the demo (designer's estimate, to be measured): sample
  interval 200 ms + model 100–300 ms CPU + relay/rule <50 ms + command
  publish→edge→Modbus write ~100 ms ⇒ ~0.5–0.7 s. Factory I/O conveyor speed
  and sensor position are tuned to that; rule placement in the backend is
  chosen for auditability over the lower latency of an edge-local rule.

### 6.6 UI

- **Cameras** (new nav item under Infrastructure): grid of live tiles;
  add camera (RTSP URL or pick/upload a video); per camera: live view,
  overlay toggle, status, recent events with thumbnails.
- **Vision rules** inside the camera page: class dropdown (from the model
  profile's class list), score slider, draw zone on a still frame, pick a
  writable tag, value/pulse; "Dry run" mode shows what would fire without
  writing.

## 7. Phase C — Onboarding and per-org AI settings

### 7.1 Getting-started checklist (G6)

On the Overview page for a new org: *Add gateway → Add PLC source → Add tags
or apply template → Create dashboard → Add a camera (optional) → Invite your
team*. Each step links to the page and ticks itself from real state.

### 7.2 AI model settings (G7)

`Settings → AI models`: per org, two entries: **Tag inference** (today's
`INFERENCE_URL`) and **Vision model** (the §7.3 server). Fields: URL, API key
(write-only, encrypted with the same key as `secret_enc`), model name,
timeout; **Test** button. Env vars stay as the default when the org has no
row. Migration 0016 `org_ai_settings`.

### 7.3 Vision model contract

```
POST {url}   Content-Type: image/jpeg   (Authorization: Bearer <key> optional)
200 {"model": "yolov8n-seg", "classes": ["box","defect",...],
     "detections": [{"class": "defect", "score": 0.93,
                     "bbox": [x,y,w,h] (0..1), "polygon": [[x,y],...] (0..1)}]}
GET {url}/classes → {"classes": [...]}   (used by the rule editor)
```

Output is treated as untrusted exactly like `inference.py::_clean`
(caps on count, lengths, clamped scores).

Reference model server: YOLOv8n-seg exported to ONNX, `onnxruntime` CPU,
COCO classes by default. *(Designer's call; the user's own model replaces it
by pointing the URL elsewhere.)*

## 8. Security summary

- Enrollment code: one use, 30 min, sha256 only, rate-limited endpoint.
- Secrets (PLC, RTSP, model keys): AES-GCM at rest, write-only in API/UI,
  only decrypted into the per-edge retained `cfg` (TLS + ACL) or the worker.
- RTSP URLs are never echoed back; the UI shows host only.
- Uploads: size cap, ffprobe sniff, stored outside the web root, served only
  through the authenticated relay.
- AI→PLC: §6.5 off switches + audit; default off.
- All new routes follow CONTRACT.v2 404/403 rules and RLS.

## 9. Demo setup (Factory I/O)

- Factory I/O: *Drivers → Modbus TCP/IP Server*, port 502. Scene: Sorting
  station with a pusher on the conveyor.
- In WDS: enroll the dev edge-bridge, add a Modbus source
  `host.docker.internal:502`, apply the "Factory I/O – Sorting" template
  (tags incl. `pusher.extend` coil).
- Upload the demo clip, add camera (kind upload), add rule
  "class=defect score≥0.7 → pusher.extend = true, pulse 500 ms".
- Turn on "AI may write to PLC". Clip plays with overlay, pusher fires in
  Factory I/O, event + command + audit rows appear.

Siemens path for the thesis report: the S7 adapter is tested against
`snap7`'s built-in server in CI (real S7 protocol on the wire); Factory I/O's
S7-PLCSIM driver needs TIA Portal + PLCSIM, which the demo does not depend on.
OPC UA adapter is tested against an `asyncua` test server.

## 10. Phasing and order

1. **A** Data sources (enrollment, 0014, cfg delivery, modbus refactor, s7,
   opcua, UI, templates). Required by B because B writes to PLC tags.
2. **B** Cameras + vision (0015, upload, worker, model server, relay, rules).
3. **C** Checklist + per-org AI settings (0016).

4. **D** Recording (G13), S7/Modbus discovery (G12), GPU variant (G8),
   multi-replica fan-out (G14).
5. **E** Labeling (G9), training (G10), model registry (G11), remote
   access tunnel (G15).

Each phase is a separate implementation plan; A is planned first.

## 11. Left to the builder

Library versions; exact JSON schemas for `connection`/`address` validation;
UI component layout within the existing console style; how the edge stores
its enrolled identity on disk; CSV column parsing details; MJPEG relay
implementation; test layout (follow `tests/` conventions: contract tests for
adapters/parsers, integration tests for routes, RLS tests in `tests/tenancy`).
