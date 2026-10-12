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

Still v1-shim-only (not yet landed): `PATCH /api/v1/me`, org/site create+mutation (read-only in v4 admin scope), line/device/tag mutation routes, `history.csv`, WS snapshot frame + `seq`/`reauth` (the current stream is the v1 event shape on `/ws` and `/ws/v1`).

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

Site-scoped (`/api/v1/orgs/{org_id}/sites/{site_id}` prefix):

| Method | Path | Permission |
|---|---|---|
| GET | `/health` | site:read: edges (status, last_hb, clock_ok, buffer_depth), mqtt, db |
| GET / POST / PATCH / DELETE | `/lines`, `/devices` | read / config:write |
| GET / POST | `/edges` | site:read / config:write (POST returns the secret **once**) |
| POST | `/edges/{edge_id}/rotate`, `/edges/{edge_id}/disable` | config:write |
| GET | `/tags?search=&writable=` | site:read |
| POST / PATCH / DELETE | `/tags`, `/tags/{tag_id}` | config:write |
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

## 6. MQTT

Topics, identities and ACLs are defined in doc 17. Payloads:

```jsonc
TagValue (tele)    { "v": number|bool, "q": "good|bad|stale|uncertain", "ts": RFC3339, "seq"?: int }
Heartbeat (hb)     { "status": "up|degraded|down", "clock_ok": bool, "adapter": str, "ts", "buffer_depth": int, "buffer_dropped": int, "fw": str }
Command (cmd)      { "command_id", "tag_path", "value", "issued_at", "ttl_s", "idempotency_key"? }
CommandResp        { "command_id", "status": "acknowledged|rejected|failed", "reason"?: str }
```

- Telemetry with `ts` older than 8 h is dropped; newer data is stored. `tag_latest` is updated only when `ts` is newer than the current value.
- The alarm engine evaluates only samples where `now − ts ≤ 15 s`, so replayed backlog never raises or clears alarms.
- `ts` more than 5 s in the future → dropped and counted.
