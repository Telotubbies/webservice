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
