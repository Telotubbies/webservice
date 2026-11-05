# Contract v2 — multi-tenant SaaS

Status: **Target contract — partially landed**. `CONTRACT.md` (v1) describes the v1 compatibility surface. Normative detail lives in:
- ADR-12 (auth)
- ADR-13 (isolation)
- doc 16 (commands)
- doc 17 (MQTT)
- doc 18 (release)

If this file and those disagree, those win; fix this file.

### Implementation status (v4 T9 — real multi-tenant org routing)

Landed on `ui-v4`:
- **Org routing**: `/api/v1/orgs/{org}/sites/{site}/…` resolves `org_id` from the path against the caller's memberships — never a global pin. Non-member or non-existent org → 404 (identical response, no oracle); member without the permission → 403.
- Implemented v2 routes: `GET /api/v1/me`, `GET /orgs/{org}`, `GET /orgs/{org}/sites`, site-scoped `health`, `tags` (+`/latest`, `/{tag_id}/latest`, `/{tag_id}/history`), `alarm-rules` (GET + POST/PATCH/DELETE — writes NOTIFY `alarm_rules_changed` so the engine reloads without restart), `alarms` (+`/alarms/{id}/ack`), `insights`, `commands` (POST/GET/`/{id}`), `edges` (+rotate/disable), org-scoped `members` (GET/PATCH/DELETE `{user_id}` — role change + `users.disabled_at`), `invites` (GET/POST/DELETE) + global `POST /api/v1/invites/accept` (token in the JSON body — never the URL path; verified-email match, single-use, existing members keep their role), `audit` (JSON/CSV export, `from`/`to`/`action`/`actor`/`limit`). List responses use `{items, next_cursor}`.
- **Engines are multi-org**: the registry cache, alarm rules, insight evaluation, and command lifecycle (issue/transition/watch/sweep/broadcast) all iterate or scope by real org ids; `wds_system` sweeps enumerate live orgs via `active_org_ids()`.
- **WS**: `/ws/v1` requires the `site_id` auth frame (4401 without it); the site's org must be a membership else 4403 — the site anchors authorization only. Broadcasts (`tag`, `alarm*`, `command`, `insight`, `health`) are **org-membership-scoped**: a socket receives events for every org the principal belongs to (see §5.8). `/ws` is the v1 compat socket — site anchor is the seeded site, no `site_id` needed — but a multi-org member still receives all its orgs' events. V1 events keep v1 field names plus `org_id`/`site_id`/`tag_id` extras.
- **Dev tokens** (APP_ENV=dev only): memberships hydrate from the `memberships` table, so a dev user is a member of every org it has a row in — including non-shim orgs created via admin/test paths. The nominal token role applies only as the shim-org fallback when no memberships hydrated at all.

Still v1-shim-only (not yet landed): `PATCH /api/v1/me`, org/site create+mutation (read-only in v4 admin scope), line/device mutation routes (tag mutation now lands as data-source tags, §3 *Data sources*), `history.csv`, WS snapshot frame + `seq`/`reauth` (the current stream is the v1 event shape on `/ws` and `/ws/v1`).

**v1 compatibility shim**: every `/api/*` v1 path is an alias pinned to the seeded dev org (`config.V1_*`) requiring shim-org membership; the single pin is `v1_tx()` in `backend/app/main.py`.

## 1. Tenancy & permissions

```
organization ─ membership(user, role) ─ site ─ line ─ device ─ tag
                                         └─ edge
```

| Permission | viewer | operator | admin | owner |
|---|---|---|---|---|
| `site:read` (telemetry, alarms, trends, tags, health) | ✓ | ✓ | ✓ | ✓ |
| `alarm:ack` | | ✓ | ✓ | ✓ |
| `command:issue`, `command:read` | | ✓ | ✓ | ✓ |
| `config:write` (sites, lines, devices, tags, alarm rules, edges) | | | ✓ | ✓ |
| `member:manage`, `audit:read` | | | ✓ | ✓ |
| `org:delete`, `org:transfer` | | | | ✓ |

- No anonymous access to human endpoints.
- Non-member of the path org → **404**.
- Member without the permission → **403**.

## 2. HTTP conventions

- Base path `/api/v1`. JSON only. Auth via `Authorization: Bearer <access JWT>` (ADR-12).
- Mutating requests (`POST`/`PUT`/`PATCH`/`DELETE` under `/api`) that carry an `Origin` header must satisfy the Origin policy — `ALLOWED_ORIGINS` match or same-origin (the Origin's `host[:port]` equals the request `Host`) — or the request is refused **403** before routing. A *missing* `Origin` is allowed: browsers always send `Origin` on cross-origin mutations, so its absence means a non-browser client (curl, tests, the IdP's server-side back-channel POST), and bearer-token auth carries no ambient credentials for a forged form to ride. This is the same documented carve-out the WS upgrade gate applies (§5.1); `GET`/`HEAD`/`OPTIONS` are never Origin-checked.
- IDs are UUIDv7 strings. Timestamps are RFC 3339 UTC with a `Z` suffix.
- Errors use `application/problem+json`: `{type, title, status, code, detail?, request_id, errors?}`. `code` is stable and machine-readable.
- Lists use cursor pagination: `?limit=` (default 50, max 500) and `?cursor=`. The response is `{items, next_cursor}` — `next_cursor: null` is a contract-permitted empty page meaning "no more results". As of T9, `GET …/commands` implements keyset pagination on `cursor`; the other list routes return their full (bounded) page with `next_cursor: null` until T10+ adds cursors.
- Every response carries an `X-Request-Id` header.

## 3. Endpoints

Machine (no auth, minimal):

| Method | Path | Notes |
|---|---|---|
| GET | `/healthz` | `{"status":"ok"}`, liveness only |
| GET | `/readyz` | db/mqtt/idp reachability; **not proxied by nginx** (internal only) |

Identity:

| Method | Path | Permission |
|---|---|---|
| GET | `/api/v1/me` | any valid token → `{user, memberships:[{org_id, org_name, role, permissions[]}]}` |
| PATCH | `/api/v1/me` | self (`display_name`, `locale` ∈ `th`/`en`) |
| POST | `/api/v1/auth/backchannel-logout` | Keycloak only (verified `logout_token`) |
| POST | `/api/v1/orgs` | any valid token (creates the org; caller becomes owner; respects `plan_limits`) |
| POST | `/api/v1/invites/accept` | body `{"token": "…"}` whose **verified** email (`email_verified=true`) matches the invite email. The invite token is 32 random bytes, stored as sha256 only, single-use, expires after 7 days; accepting an invite as an existing member is a membership no-op (role preserved) |

Org-scoped (`/api/v1/orgs/{org_id}` prefix):

| Method | Path | Permission |
|---|---|---|
| GET / PATCH / DELETE | `` | site:read / config:write / org:delete |
| GET | `/members` | member:manage |
| PATCH / DELETE | `/members/{user_id}` | member:manage (an owner can't be removed by an admin; there must always be ≥1 owner) |
| POST / GET / DELETE | `/invites`, `/invites/{id}` | member:manage |
| GET | `/audit?action=&actor=&from=&to=` | audit:read |
| GET / POST | `/sites` | site:read / config:write |
| GET / PATCH / DELETE | `/sites/{site_id}` | site:read / config:write |

Edge enrollment (machine, no user auth):

| Method | Path | Notes |
|---|---|---|
| POST | `/api/v1/edge/enroll` | body `{"code"}` (≤1 KiB). The one-time code is the credential: per-IP rate limited (429 + `Retry-After`), single-use, 30 min. 404 `unknown_code`; 410 `code_used` / `code_expired` / `edge_disabled`; 503 `provisioning_failed` (code is returned for retry). Rotates the MQTT credential and answers `Cache-Control: no-store` `{org_id, site_id, edge_id, mqtt_host, mqtt_port, ca_pem, mqtt_username, mqtt_password, state_key}`; `state_key` is a fresh at-rest key that is not stored server-side. Clients must use https |

Data sources (`/api/v1/orgs/{org_id}/edges/{edge_id}` prefix; list = site:read, everything else config:write; every mutation bumps the edge's `config_version` and republishes `cfg`):

| Method | Path | Notes |
|---|---|---|
| GET / POST | `/sources` | `{items}` with `tag_count` / POST `{name, protocol: sim\|modbus\|s7\|opcua, connection, secrets?, poll_ms, enabled}` → 201 `{source, config_version}`; 409 `source_name_exists`; 422 field-level on bad connection |
| PATCH / DELETE | `/sources/{source_id}` | secrets are sealed (AES-GCM, `DATA_SOURCE_KEY_FILE`) and never returned |
| GET / POST | `/sources/{source_id}/tags` | tag with PLC `address` (normalized per protocol), `scale`, `offset`, `writable`, `min`, `max` |
| POST | `/sources/{source_id}/tags:bulk` | CSV/TSV body, UTF-8, size-capped (413 `csv_too_large`, 422 `csv_not_utf8`) |
| PATCH / DELETE | `/sources/{source_id}/tags/{tag_id}` | |
| POST | `/sources:test` | dry-run a **draft** source through the edge (read-only, never writes to a PLC); config:write |
| POST | `/sources/{source_id}/browse` | body `{node_id}`; one-level OPC UA browse via the edge using stored secrets; 409 `browse_requires_opcua` |

Site-scoped (`/api/v1/orgs/{org_id}/sites/{site_id}` prefix):

| Method | Path | Permission |
|---|---|---|
| GET | `/health` | site:read: edges (status, last_hb, clock_ok, buffer_depth), mqtt, db |
| GET / POST / PATCH / DELETE | `/lines`, `/devices` | read / config:write |
| GET / POST | `/edges` | site:read / config:write (POST returns the secret **once** plus a one-time `enroll_code` + `enroll_expires_at`). Edge rows carry `config_version`, `config_applied` (last version the gateway acked, null = never) and `config_error` (ack error summary, null = ok) |
| POST | `/edges/{edge_id}/enroll-code` | config:write → `{enroll_code, enroll_expires_at}` (30 min, single-use; supersedes unused codes; 409 `edge_not_active`) |
| POST | `/edges/{edge_id}/rotate`, `/edges/{edge_id}/disable` | config:write (rotate also pushes the new credential in-band on `cred`, §6) |
| GET | `/tags?search=&writable=` | site:read |
| POST / PATCH / DELETE | `/tags`, `/tags/{tag_id}` | config:write (v1-shim tag registry; PLC-addressed tags use the data-source routes below) |
| GET | `/tags/latest` | site:read: **bulk** latest for every tag of the site (replaces the v1 N+1 calls) |
| GET | `/tags/{tag_id}/history?from=&to=&limit=` (max 5000) | site:read |
| GET | `/tags/{tag_id}/history.csv?from=&to=` | site:read |
| GET / POST / PATCH / DELETE | `/alarm-rules` | read / config:write |
| GET | `/alarms?state=&severity=` | site:read |
| POST | `/alarms/{alarm_id}/ack` | alarm:ack |
| POST | `/commands` | command:issue (gates per doc 16 §2) → **201** `{command}`; idempotent replay → **200** |
| GET | `/commands`, `/commands/{command_id}` | command:read (includes `events[]`) |

## 4. Resource shapes

```jsonc
Tag      { "id", "site_id", "edge_id", "path": "sort/line1/motor1/running", "name": "motor1 running",
           "type": "bool|number", "unit"?, "writable", "min"?, "max"?, "step"?, "enum"?, "requires"?: [string] }
TagValue { "tag_id", "v", "q": "good|bad|stale|uncertain", "ts" }
Alarm    { "id", "tag_id", "rule_id", "severity": "info|warning|critical",
           "state": "active|acked|cleared", "raised_at", "acked_at"?, "acked_by"?, "cleared_at"?, "version" }
AlarmRule{ "id", "tag_id", "kind": "hi|hihi|lo|lolo|stale", "threshold"?, "stale_s"?, "deadband"?, "severity", "enabled" }
Command  { "id", "tag_id", "value", "status": "accepted|dispatched|acknowledged|rejected|failed|timeout",
           "reason"?, "ttl_s", "issued_at", "updated_at", "actor": {"user_id","display_name"}, "version",
           "events"?: [{ "from", "to", "actor", "reason"?, "at" }] }
```

POST `/commands` body: `{ "tag_id", "value", "ttl_s"?: 1..60 (default 10), "idempotency_key"?: string ≤64, "note"?: string ≤200 }`.

## 5. WebSocket `/ws/v1`

1. Connect with **no query parameters**. The server checks `Origin` against `ALLOWED_ORIGINS`; on mismatch it closes with **4403** (a policy refusal, like the permission-lost case below — 4400 is not used).
2. Within 5 s the client sends `{"type":"auth","token":"<access JWT>","site_id":"…"}`. If it doesn't, the server closes with **4401**. The site must belong to an org where the user has `site:read`; otherwise **4403**.
3. The server replies `{"type":"snapshot","as_of","tags":[TagValue],"alarms":[Alarm active|acked],"commands":[Command in-flight]}`. Commands are included only with `command:read`.
4. The server then streams events. Each frame carries `seq`, a per-connection counter that starts at 1:
   - `{"type":"tag","seq","tag_id","v","q","ts"}`: coalesced per tag under backpressure (latest wins)
   - `{"type":"alarm","seq","alarm":Alarm}`: never dropped
   - `{"type":"command","seq","command":Command}`: only with `command:read`; never dropped
   - `{"type":"health","seq","edges":[…],"mqtt"}`
5. Re-authentication: the client sends `{"type":"reauth","token":"…"}` before `exp`. Otherwise the server closes with **4401** at `exp + 30 s`.
6. Server-initiated close codes:

   | Code | Cause | Client action |
   |---|---|---|
   | 4401 | session revoked, user disabled, or token expired | sign in again |
   | 4403 | membership or permission lost | — |
   | 4408 | the client's control-event queue overflowed | reconnect + snapshot |
   | 1012 | server restart | reconnect |

7. Ordering: per tag, `ts` decides (newer wins). For alarms and commands, `version` decides. On any gap in `seq`, the client reconnects.
8. `site_id` anchors the connection's authorization: the named site must belong to an org where the user has `site:read`, and switching anchor means closing the socket and opening a new one. The event stream itself is **org-membership-scoped** — a client receives events for every org it belongs to (each event carries `org_id`/`site_id`/`tag_id` for client-side filtering), not only the anchored site's org.
9. The UI shows **LIVE** only after it has received a snapshot and the connection is open. Each tag is shown STALE when `now − ts > 15 s`.

**Reconnect (ADR-0003).** Server→client `{"type":"resync","reason":"overflow"}` means events were dropped for this socket (slow consumer, at most one per 5 s): re-fetch `/api/tags/latest`, `/api/alarms`, `/api/commands`, `/api/insights?state=open` and replace local state. Clients also do this after every reconnect. Client→server `{"type":"ping"}` is answered by `{"type":"pong","ts"}`; a client treats 30 s without any frame as a dead socket. Close 4403 is not retried automatically.

## 6. MQTT

Topics, identities and ACLs are defined in doc 17. Payloads:

```jsonc
TagValue (tele)    { "v": number|bool, "q": "good|bad|stale|uncertain", "ts": RFC3339, "seq"?: int }
Heartbeat (hb)     { "status": "up|degraded|down", "clock_ok": bool, "adapter": str, "ts", "buffer_depth": int, "buffer_dropped": int, "fw": str }
Command (cmd)      { "command_id", "tag_path", "value", "issued_at", "ttl_s", "idempotency_key"? }
CommandResp        { "command_id", "status": "acknowledged|rejected|failed", "reason"?: str }
```

Data-source config (backend ↔ edge, `v2/{org}/{site}/{edge}/…`; edge ACLs in `dynsec.edge_acls`):

| Topic | Dir | QoS / retain | Payload |
|---|---|---|---|
| `cfg` | backend → edge | 1, **not retained** | `{ "version": int, "sources": [{ "id", "protocol", "connection", "secrets"?: object, "poll_ms", "enabled", "tags": [{ "id", "path", "type", "address", "scale", "offset", "writable", "min", "max" }] }] }` — full config, only enabled sources; secrets are opened only to build this message |
| `cfg-req` | edge → backend | 1 | `{ "have_version": int \| null }` on every (re)connect; the backend answers with `cfg` when `have_version` is null or older |
| `cfg-ack` | edge → backend | 1 | `{ "version": int, "ok": bool, "errors"?: [{ "source_id"?, "tag_id"?, "detail" }] }` → `edges.config_applied` / `config_error` |
| `cred` | backend → edge | 1, **not retained** | `{ "version": int, "username", "password" }` — in-band credential rotation for enrolled gateways; the edge ignores retained, malformed or not-newer messages |

- Edge role ACL: subscribe `cfg` and `cred`; publish `cfg-req` and `cfg-ack`. Backend publishes `cfg`/`cred`; ingest subscribes `cfg-req`/`cfg-ack` via `$share/ingest`.
- An edge ignores a `cfg` with `version` ≤ the applied one. Each source is applied independently; a bad source is reported in `errors` and keeps its previous adapter.
- `cred` carries a secret: never logged, never retained.

- Telemetry with `ts` older than 8 h is dropped; newer data is stored. `tag_latest` is updated only when `ts` is newer than the current value.
- The alarm engine evaluates only samples where `now − ts ≤ 15 s`, so replayed backlog never raises or clears alarms.
- `ts` more than 5 s in the future → dropped and counted.

## Cameras and frame relay (plan M1-03)

REST (all `/api/v1/orgs/{org}/…`; non-member 404; writes need `config:write`, one audit row each):

| Route | Notes |
|---|---|
| `POST …/sites/{site}/videos?filename=x.mp4` | raw body (mp4 or webm, sniffed from magic bytes, max 200 MB) → 201 `{id, filename, size_bytes, sha256}`; 415 not a video, 413 too large |
| `GET …/sites/{site}/videos`, `DELETE …/videos/{id}` | 409 `video_in_use` while a camera pins it |
| `GET/POST …/edges/{edge}/cameras`, `PATCH/DELETE …/cameras/{camera}` | `kind` `rtsp` (needs `rtsp_url`, `rtsp(s)://` + host) or `upload` (needs `video_id`); `fps_sample` 0.5–15; the URL is write-only (`has_rtsp_url`); every write bumps `edges.config_version` |
| `POST …/cameras/{camera}/stream-url` | → `{url, expires_in: 60}`, a signed MJPEG URL |
| `GET …/cameras/{camera}/stream?exp&sig` | `multipart/x-mixed-replace`, credential = the signature (an `<img>` cannot send headers); 401 on any failure |
| `GET …/cameras/{camera}/snapshot` | latest JPEG, session auth, 404 before the first frame |
| `GET /api/v1/edge-media/{video}?edge&sig` | gateway download, no session; `sig = HMAC(edge, video, sha256)`, 404 on any failure |

`cfg` gains `cameras: [{id, name, kind, fps_sample, enabled, rtsp_url? | video: {url, sha256, size_bytes}}]`.

| Topic | Dir | QoS | Payload |
|---|---|---|---|
| `vision/frame/{camera_id}` | edge → backend | 0 | one JPEG, ≤ 960 px wide, ≤ 100 000 bytes (relay accepts ≤ 150 000) |
| `vision/stat` | edge → backend | 0 | `{camera_id: {status: "ok"\|"error", detail, fps, engine?, latency_ms?, bench_fps?, model_state?, model_detail?, model_version?}}` every 10 s → `cameras.status*` + in-memory latest-stat (30 s freshness) |
| `vision/caps` | edge → backend | 0 | `{cpu_cores, ram_mb, device, providers[], loaded[]}` at startup, on (re)connect and every 300 s → upsert `edge_capabilities` (migration 0020) |

- Edge role ACL adds publish on `vision/frame/+`, `vision/stat` and the exact `vision/caps` only. The backend ignores a frame whose camera does not belong to the publishing edge.
- `vision/caps` payloads are untrusted: ≤ 64 KiB, `cpu_cores` integer 1–4096 required, `ram_mb` 0–2⁵⁰, strings ≤ 80 chars, `providers` ≤ 32 entries, `loaded` ≤ 256 UUID strings. Malformed payloads are dropped, edge identity comes only from the validated topic.
- Frames are shed first when the ingest queue is more than half full, so they never delay telemetry.
- The relay keeps only the newest frame per camera; a slow viewer skips frames. Single backend replica (the shared subscription would otherwise split frames across replicas).

## Vision models (plan M1-04)

REST under `/api/v1/orgs/{org}/vision/models` (non-member 404, writes need `config:write`, audited):

| Route | Notes |
|---|---|
| `POST …/models` `{name, task: detect\|segment}` / `GET` / `DELETE …/{id}` | 409 `model_name_exists`, 409 `version_pinned` |
| `POST …/{id}/versions?filename=x.onnx\|x.pt&notes=` | raw body ≤ 500 MB. `.onnx` is inspected inline → `draft` (422 `{detail: code, message}` on `not_onnx`, `unsupported_output`, `no_classes`, `task_mismatch`; the file is not stored). `.pt` → `processing`, converted in the sandbox → `draft` or `failed` (`failure_reason`) |
| `GET …/{id}/versions[/{v}]` | poll a `processing` version |
| `POST …/versions/{v}/classes` `{names}` | only when the file had none; 422 `class_count_mismatch` shows both counts when the export declared one |
| `POST …/versions/{v}/activate` `{attest: true}` | needs classes; stores who/when; 400 without attestation; 409 `classes_required`/`bad_state` |
| `POST …/versions/{v}/archive`, `DELETE …/versions/{v}` | archive only when unpinned; delete only draft/failed/archived and unpinned |
| `GET/POST …/{id}/presets`, `DELETE …/presets/{p}` | named class sets for one model |
| `GET/PUT/DELETE /api/v1/orgs/{org}/cameras/{camera}/model` | pin an `active` version; `PUT` keeps class settings only where the id keeps its name and returns `diff {added, removed, renamed}`; `placement` `auto\|edge\|cloud` |
| `PATCH …/cameras/{camera}/classes` `{class_config}` | per class id: `enabled`, `names{en,th}`, `min_score` 0.05–0.95, `colour #rrggbb`, `alert` |
| `POST …/cameras/{camera}/classes/apply-preset` `{preset_id}` | preset must belong to the pinned model |
| `GET /api/v1/edge-models/{version}?edge&sig` | gateway download, no session; `sig = HMAC(edge, version, sha256)`; `active`/`archived`/`draft` (draft needed by the pre-activation model test); 404 on any failure |

`cfg.cameras[i].model = {version_id, sha256, size_bytes, task, imgsz, stride, classes, class_config, placement, url}`.

## Edge inference + model test (plan M1-05)

| Route | Notes |
|---|---|
| `GET …/edges/{edge}/capabilities` | member `READ`; `{capabilities: null \| {reported_at, cpu_cores, ram_mb, device, providers, loaded}}` from `edge_capabilities` (migration 0020, fail-closed RLS, `wds_system` writes inside `tenant_tx`) |
| `POST …/vision/models/{m}/versions/{v}/test?edge={uuid}` | `config:write` + mutation gate. Raw JPEG/PNG body streamed ≤ 5 MiB (413), magic checked (422 `invalid_image`). Version must be `draft`/`active` with classes; edge must be `active` and checked in within `EDGE_STALE_AFTER_S` (else 409 `edge_offline`). The model URL is built server-side (`EDGE_MEDIA_BASE_URL` + `HMAC` sig — the download route permits `draft` in addition to `active`/`archived`). Audited `vision.model.tested` with target ids + outcome code only, never the image/reason |
| Op `model_test` on `v2/{org}/{site}/{edge}/cmd/{command_id}` | payload `{model: <model_cfg block>, image_b64}`; the bridge validates base64 + magic + `cv2.imdecode`, loads via `ModelClient` against `MODEL_SERVER_URL`, polls `loading` inside one ≤ 9 s monotonic budget (every request consumes the remaining deadline), infers all classes at conf 0.05 — no benchmark. Response `{ms, engine, detections}` |
| Result shape | `{ms 0..3600000, engine ≤80 chars, detections ≤300}` — every detection sanitized at the backend boundary (`class_id < len(classes)`, score ≥ 0.05 clamped ≤ 1, normalized bbox clipped to the image, polygon ≤ 64 sampled points) |
| Errors | timeout → 504 `edge_timeout`; decode failures → 422 `invalid_image`; other edge failures → generic 502 `edge_op_failed` (raw reasons can embed URLs and are never returned or audited) |

The image is transient: streamed through memory to MQTT (base64) and never persisted or logged. Broker `max_packet_size` is 8 MiB to admit ~6.67 MiB base64 + envelope.

**Internal model server** (`MODEL_SERVER_URL`, no host port — edge-bridge only): `GET /v1/health` `{device, providers[], loaded[], failed{}}`, `PUT /v1/models/{vid}` `{url, sha256, task, imgsz, classes[]}` (202 → loading/loaded/failed), `POST /v1/infer?model=&conf=&classes=` `{detections[], ms}`, `POST /v1/benchmark?model=&frames=` `{fps}` (run off the camera thread, once per detector). Output is untrusted and bounded at both edges.

**Converter spool** (volume shared with the `model-converter` container, which has no network, a read-only root, tmpfs scratch, 3 GB / 2 CPU / 256 PIDs, no capabilities): in `{id}.pt` + `{id}.json {id, task_hint, queued_at}`; out `{id}.onnx` + `{id}.result.json {ok, error?}`. The `.pt` and the job file are deleted in every case. The backend never opens a `.pt` and never talks to Docker.
