# 17 — MQTT Security Contract (edge identity, ACL lifecycle, topic ownership)

Status: **Binding** from CONTRACT.v2. Broker: `eclipse-mosquitto:2` with the **dynamic-security** plugin (`mosquitto_dynamic_security.so`). This replaces the static `passwd` + `mosquitto.acl` for edges.

## 1. Topic namespace (immutable ids only)

```
v2/{org_id}/{site_id}/{edge_id}/tele/{area}/{line}/{device}/{signal}   edge → broker   TagValue
v2/{org_id}/{site_id}/{edge_id}/hb                                     edge → broker   Heartbeat (+ LWT)
v2/{org_id}/{site_id}/{edge_id}/cmd/{command_id}                       backend → edge  Command
v2/{org_id}/{site_id}/{edge_id}/cmd-resp/{command_id}                  edge → backend  CommandResponse
```

- `org_id`, `site_id`, `edge_id` are UUIDs. Slugs/names never appear in topics; renaming a site changes nothing.
- The tag path (`area/line/device/signal`) maps to `tags.path` within the site.

## 2. Identities

| Client | Username | Created by | Purpose |
|---|---|---|---|
| backend | `svc-backend` | compose bootstrap | ingest, command publish |
| reconciler | `svc-dynsec-admin` | compose bootstrap | **only** identity allowed on `$CONTROL/dynamic-security/#` |
| edge | `edge-{edge_id}-v{n}` | reconciler on provisioning | one per edge per credential version |
| tester | `tester` | **test profile only** (`docker compose --profile test`) | fault injection; never present in the default profile |

## 3. ACLs (default deny: `publishClientSend`, `subscribe`, `publishClientReceive` all denied unless allowed)

Edge role `edge-{edge_id}`:

| Type | Topic | Allow |
|---|---|---|
| publishClientSend | `v2/{o}/{s}/{e}/tele/#` | ✓ |
| publishClientSend | `v2/{o}/{s}/{e}/hb` | ✓ |
| publishClientSend | `v2/{o}/{s}/{e}/cmd-resp/+` | ✓ |
| subscribePattern | `v2/{o}/{s}/{e}/cmd/+` | ✓ |
| publishClientReceive | `v2/{o}/{s}/{e}/cmd/+` | ✓ |
| everything else (`#`, `+/#`, `v2/#`, other prefixes, `$SYS/#`, `$CONTROL/#`) | — | ✗ |

Backend role `svc-backend`:
- subscribe `v2/+/+/+/tele/#`, `v2/+/+/+/hb` (fan-out to every replica);
- subscribe `$share/ingest/v2/+/+/+/tele/#`, `$share/ingest/v2/+/+/+/hb`, `$share/ingest/v2/+/+/+/cmd-resp/+` (single writer per message);
- publish `v2/+/+/+/cmd/+`;
- deny `$CONTROL/#`.

Retained messages: the backend publishes commands with `retain=false`. The edge rejects any retained command (doc 16 §6).

## 4. Trust rules in the backend

1. Org, site and edge are parsed **from the topic**. Payloads never carry or override them.
2. The topic `edge_id` is looked up in `edges` through the `wds_system` identity view (ADR-13 §3). It must exist, have `status='active'`, and match both topic `org_id` and `site_id`. Otherwise the message is dropped and the security event `mqtt.topic_identity_mismatch` is logged and counted.
3. The tag path must resolve to a tag of that site **bound to that edge** (`tags.edge_id`). Otherwise `telemetry_unknown_tag`.
4. `cmd-resp` is accepted only if the command belongs to that edge (doc 16 §5).
5. The broker ACL already prevents an edge from publishing outside its prefix. Rule 2 is defense in depth for broker misconfiguration or drift.

## 5. Credential lifecycle

| Operation | Steps | Effect on live connection |
|---|---|---|
| **Provision** | admin `POST /orgs/{o}/sites/{s}/edges` → edge row `status=pending` → reconciler creates the role and client with a 32-byte random password (`secrets.token_urlsafe(32)`) → DB stores `credential_version` and `credential_fingerprint` (sha256 of the password; **never the password**) → `status=active` → the API returns the secret **once** | — |
| **Rotate** | `POST …/edges/{e}/rotate` → new client `edge-{e}-v{n+1}`, same role → secret shown once → old client stays enabled for a grace window (default 24 h) or until the edge connects with v{n+1}, then `disableClient` | old connection kicked when disabled |
| **Disable** | `POST …/edges/{e}/disable` → `status=disabled` → `disableClient` for every version | kicked immediately (dynsec disconnects disabled clients) |
| **Delete** | disable + `deleteClient` + `deleteRole`; tags keep history but are unbound | kicked |
| **Move site** | not supported in place: provision a new edge in the target site, rebind tags, delete the old one | — |

## 6. Reconciliation and failure modes

- Desired state lives in Postgres (`edges` + `credential_version`). The broker's dynsec JSON is a cache.
- The reconciler runs at startup, every 60 s, and on `NOTIFY wds_edges`. It issues `listClients`/`listRoles`, then creates, updates, disables or deletes until the broker matches the DB. It never re-enables a client the DB marks disabled.
- Reconciler identity: only `svc-dynsec-admin` may publish `$CONTROL/dynamic-security/v1`.

| Failure | Behaviour |
|---|---|
| Broker restart | dynsec state persists in its JSON; reconcile on reconnect repairs any drift |
| Provisioning call fails/times out | edge stays `pending`, the API returns 503 `provisioning_failed`, retry is safe (idempotent by client name) |
| Broker has a client the DB doesn't know | disabled and reported as `mqtt.orphan_client` |
| DB says active but the broker lacks it | recreated **with a new credential version**; the old secret can't be recovered, so the edge shows `needs_rotation` in the UI |
| Backend ↔ broker disconnected | health `mqtt: down`; the command outbox holds commands until TTL (doc 16 §4) |

## 7. Required tests (phase 4 exit gate)

| Test | Assertion |
|---|---|
| `test_acl.py::test_edge_cannot_publish_other_prefix` | edge A publishes to B's `tele`, `hb`, `cmd-resp` → not delivered (the backend subscriber sees nothing) |
| `test_acl.py::test_edge_cannot_subscribe_wildcards` | edge A subscribes `#`, `v2/#`, `v2/+/+/+/cmd/+`, `$SYS/#` → receives nothing from B |
| `test_acl.py::test_edge_cannot_publish_cmd` | edge A publishes to its own `cmd/+` → not delivered to subscribers |
| `test_acl.py::test_disable_kicks` | after disable, the connection drops within 2 s and reconnecting fails |
| `test_acl.py::test_rotation` | v2 connects, v1 is disabled after cut-over |
| `test_trust.py::test_topic_identity_mismatch_dropped` | (tester identity) message on a valid-shaped prefix with a mismatched site → dropped + security counter |
| `test_reconcile.py` | delete a dynsec client by hand → recreated with a new version; add an orphan → disabled |

## 8. Implementation status (v4 T6, branch `ui-v4`)

Implemented per this contract:

- **Broker**: `eclipse-mosquitto:2` + `mosquitto_dynamic_security.so`
  (`infra/mosquitto.conf`). TLS listener `8883` only; plaintext `1883`
  exists solely under the test overlay
  (`infra/mosquitto-extras-test/test.conf`, mounted by
  `docker-compose.test.yml`). `infra/gen-certs.sh` (`make certs`) issues a
  dev CA + broker cert with SAN `localhost`/`mosquitto`.
- **Identities**: `svc-backend`, `svc-dynsec-admin`, per-edge
  `edge-{edge_id}-v{n}`, and `tester` (test overlay only — the reconciler
  creates it iff `TESTER_PW_FILE` is mounted and disables it when absent).
  Secrets live in `infra/secrets/` (`make secrets`), mounted as compose
  secrets; nothing secret-bearing appears in env or `docker inspect`.
- **Dynsec channel**: `svc-dynsec-admin` is the only `$CONTROL` identity;
  `backend/app/dynsec.py::DynsecAdmin` is an MQTTv5 request/response
  client over `$CONTROL/dynamic-security/v1`. Correlation data is sent but
  mosquitto does NOT echo it on responses — calls are single-flight under
  a lock, so the lone outstanding request claims each response.
- **Reconciler**: `backend/app/dynsec.py::Reconciler`, in-process with the
  backend (listens on `NOTIFY wds_edges` + 60 s cadence). One-way
  Postgres→broker; never re-enables DB-disabled clients; orphan `edge-*`
  clients are disabled + counted (`mqtt.orphan_client`); a broker-missing
  active credential is recreated as `v{n+1}` with `needs_rotation` unless
  the mounted bootstrap secret's fingerprint matches (seed-edge fast path).
- **DB**: `edge_identities` table (`0004_edge_identities`, RLS mirroring
  `edges`); stores sha256 fingerprint only — never the secret.
- **API**: `POST /api/v1/orgs/{o}/sites/{s}/edges` (201 + one-time
  secret), `…/rotate`, `…/disable` — admin/owner only (`config:write`),
  audited (`edge.provisioned|rotated|disabled`), `wds_edges` NOTIFY.
  Provision is broker-first: a broker-side create that the DB write never
  confirms is an orphan the reconciler disables.
- **Ingest trust**: `backend/app/main.py::_handle_message` parses
  org/site/edge from the topic only; UUID check, active-edge + org/site
  match → `mqtt_topic_identity_mismatch` counter; tag path must be bound
  to that edge; `cmd-resp` honoured only for commands of that edge.
- **Edge bridge**: file-based provisioned credentials re-read on every
  reconnect (rotation rides cut-over), TLS, v2 topics + contract
  heartbeat/LWT, `cmd-resp` vocabulary `acknowledged|rejected|failed` with
  `reason`.
- **UAT/injection**: `tests/e2e/uat.mjs` and the integration suite publish
  as `tester` over TLS `:8883` on v2 topics.

Deviations / notes:

- §5 "Provision" says `status=pending → status=active`: the API writes the
  edge row only after the broker client exists, so the committed row is
  born `active`; a broker failure is a 503 with NO row (the would-be
  pending state is carried by nothing — retry is idempotent by client
  name). This is stricter than the letter of the table (no half-live
  credential can ever exist in the DB).
- Reconcile cadence default is `DYNSEC_RECONCILE_S=60` per §6; `NOTIFY
  wds_edges` makes lifecycle ops near-instant in practice.
- `getClient`-based cut-over check observes the *new* credential's live
  connection, then disables the grace-window predecessor (§5 "or until the
  edge connects with v{n+1}").
- Edge **delete** lifecycle is deferred: `disable` fully covers credential
  revocation (all versions disabled at the broker, reconnects refused,
  never re-enabled). Orphan `edge-*` roles/clients from a hard delete are
  not yet garbage-collected — they are disabled, never deleted, and a
  cleanup pass is tracked for later.
- Role ACL drift is repaired every reconcile pass (`getRole` diff →
  add-missing-then-remove-extra), and `svc-backend` — a service identity
  with no DB lifecycle — is re-enabled if found disabled. The init-seeded
  `admin` role converges to `$CONTROL/dynamic-security/#` only.
