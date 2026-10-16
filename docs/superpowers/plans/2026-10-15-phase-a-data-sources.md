# Phase A — Data sources Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An admin adds PLC connections (Modbus TCP, Siemens S7, OPC UA, sim) and their tags from the web console; the gateway picks the change up over MQTT within seconds, with no file edits or restarts.

**Architecture:** Postgres is the source of truth (`data_sources` + extended `tags`). Any change bumps `edges.config_version`; the backend publishes a non-retained `cfg` message to that edge's MQTT prefix, the edge swaps adapters atomically and replies `cfg-ack`. The existing provisioning wizard gains an enrollment code so the install command carries no long-lived secret.

**Tech Stack:** FastAPI + asyncpg (backend), paho-mqtt, pymodbus 3.8, python-snap7, asyncua (edge), React + TanStack Query (web), Alembic SQL migrations with RLS.

**Spec:** `docs/superpowers/specs/2026-10-15-data-sources-and-vision-design.md` §5 (Phase A), §8.

## Global Constraints

- Every connection is opened from the plant side; the server never dials in.
- Secrets (PLC passwords, enrollment codes) are never shown twice and never stored in plaintext: AES-GCM at rest (`DATA_SOURCE_KEY_FILE`), sha256 for codes.
- `cfg` is **not retained** (Mosquitto persistence would hold plaintext secrets).
- Edge ACL stays least-privilege: only `{p}/cfg` subscribe and `{p}/cfg-req`, `{p}/cfg-ack` publish are added.
- New tables: fail-closed RLS (`tenant_isolation` USING/WITH CHECK `org_id = wds_ctx_org()`), shape of `0004_edge_identities.sql`.
- All new routes: `/api/v1/orgs/{org}/…`, non-member 404, missing `config:write` 403 (`_v2_org(..., need=_CONFIG)`), `_mutation_gate` on writes, audit row on every write.
- `protocol ∈ {'sim','modbus','s7','opcua'}`; `poll_ms` 100..60000 default 1000.
- Tag `path` regex unchanged: `^[a-z0-9_]+(/[a-z0-9_]+){1,7}$`.
- Enrollment code: 8 base32 chars shown as `XXXX-XXXX`, single use, 30 min TTL.
- The current env bootstrap path (`ORG_ID/SITE_ID/EDGE_ID` + secret files) and `tags.yaml` keep working until the edge receives its first `cfg`.

## Review Focus

1. Edge receives a `cfg` with one broken source (bad host / bad address) → other sources keep publishing; ack lists the error per source/tag; last good config is kept for that source. *(Task 6 test `test_bad_source_isolated`)*
2. Two admins edit tags at once → `config_version` strictly increases; edge never applies an older version over a newer one. *(Task 5 test `test_stale_cfg_ignored`, Task 4 test `test_version_bumps_per_write`)*
3. Tag deleted while a command to it is in flight / it has alarm rules → delete refused with 409 `tag_in_use` listing referrers, not a FK 500. *(Task 4 test `test_delete_tag_in_use`)*
4. Edge offline when config changes → on reconnect `cfg-req{have_version}` gets the latest; UI shows *Pending* until ack. *(Task 5 test `test_cfg_req_behind_gets_latest`)*
5. Address typed in Siemens/IEC text form (`DB1.DBX0.3`, `MW10`, `%IW4`, `40001`) → normalized or a 422 with a field-level message, never a stored string the edge can't parse. *(Task 3 parametrized tests)*

---

### Task 1: Edge adapter factory takes per-source config (+ fix missing `os` import)

**Files:**
- Modify: `edge-bridge/edge_bridge/adapters/__init__.py` (add `import os`; add `make_source_adapter`)
- Modify: `edge-bridge/edge_bridge/adapters/modbus.py` (accept normalized address dict as well as legacy strings; datatypes int16/uint16/int32/float32 + word_order)
- Create: `edge-bridge/edge_bridge/adapters/multi.py`
- Test: `tests/contract/test_edge_adapters.py`

**Interfaces:**
- Produces: `make_source_adapter(source: dict, site: str, now=None) -> TagAdapter` where `source = {"id", "protocol", "connection", "secrets", "poll_ms", "tags":[{"id","path","type","address","scale","offset","writable","min","max"}]}`. Adapter keys tags by `f"{site}.{path.replace('/', '.')}"` (same naming as today).
- Produces: `MultiAdapter(adapters: dict[str, TagAdapter])` — `read_all()` concatenates; a source whose `read_all` raises yields its tags as `q=bad` and records `errors[source_id]`; `write(tag, v)` routes to the owning adapter; `name = "multi"`; `.source_errors() -> dict[str, str]`.

- [ ] Step 1: tests — `test_make_adapter_modbus_env_does_not_crash` (ADAPTER=modbus path imports `os`), `test_modbus_address_dict_and_legacy_equivalent` (`{"area":"holding_register","index":2,"datatype":"uint16"}` reads the same register as `"%QW2"` via a fake client), `test_float32_word_order` (registers `[0x4148, 0x0000]` big → 12.5; `word_order:"little"` with `[0x0000,0x4148]` → 12.5), `test_multi_routes_write_to_owner`, `test_multi_failing_source_yields_bad`.
- [ ] Step 2: run `cd tests && python -m pytest contract/test_edge_adapters.py -q` → FAIL.
- [ ] Step 3: implement. Tests import edge code via `sys.path.insert(0, <repo>/edge-bridge)` like tenancy conftest does for backend.
- [ ] Step 4: run → PASS; `ruff check edge-bridge`.
- [ ] Step 5: commit `fix(edge): import os in adapter factory; feat(edge): per-source adapters + MultiAdapter`.

### Task 2: Migration 0014 — data_sources, tag addressing, config versioning, enrollments

**Files:**
- Create: `backend/migrations/versions/0014_data_sources.sql`, `backend/migrations/versions/0014_data_sources.py` (same runner pattern as `0013_slos.py`)
- Test: `tests/tenancy/test_data_sources_rls.py`

Schema exactly per spec §5.2, plus: `data_sources.protocol CHECK IN ('sim','modbus','s7','opcua')`, `UNIQUE(org_id, edge_id, name)`, FK `(org_id, site_id, edge_id) → edges`; `tags.source_id` FK `(org_id, source_id) → data_sources(org_id, id) ON DELETE RESTRICT`; `tags.address jsonb`, `scale`, `offset_value` (`offset` is reserved-ish — use `offset_value`), `deadband`; `edges.config_version bigint NOT NULL DEFAULT 0`, `config_applied bigint`, `config_error text`; `edge_enrollments(id, org_id, edge_id, code_hash text UNIQUE, expires_at, used_at, created_by)`.
Data step: for each existing edge that owns tags, insert one `sim` source named `Simulator` and set `tags.source_id`, and `address = {"behavior": b, "initial": x}` copied from the `sim:` block of `edge-bridge/tags.yaml` via a literal `CASE path …` for the seeded paths (unknown paths get `{"behavior":"random_walk"}`). The sim adapter reads `behavior`/`initial` from `address` when built by `make_source_adapter`.
Policies: `tenant_isolation` on both tables; `system_ds_lookup FOR SELECT TO wds_system USING (true)` on `data_sources` (cfg publisher); `edge_enrollments`: `system_enroll FOR SELECT, UPDATE TO wds_system USING (true)` (pre-auth enroll path). Grants mirror 0013.

- [ ] Step 1: tests — `test_data_sources_isolated_between_orgs`, `test_enrollment_hash_unique`, `test_tag_source_fk_restrict`, `test_seeded_tags_have_sim_source`.
- [ ] Step 2: run with `make test-db` subset → FAIL (table missing).
- [ ] Step 3: write migration; apply in a rolled-back transaction against dev Postgres first, then `make migrate`.
- [ ] Step 4: tests PASS; `alembic_version` = `0014`.
- [ ] Step 5: commit `feat(db): 0014 data sources, tag addressing, edge config versioning`.

### Task 3: Address/connection validation (pure, backend)

**Files:**
- Create: `backend/app/datasources/addresses.py`, `backend/app/datasources/__init__.py`
- Test: `tests/contract/test_addresses.py`

**Interfaces:**
- Produces: `parse_address(protocol: str, raw: str | dict, tag_type: str) -> dict` (raises `AddressError(field, message)`); `validate_connection(protocol: str, conn: dict) -> dict` (normalized, defaults filled; raises `AddressError`).
- Modbus text: `%QX0.0`→coil index 0, `%IX1.2`→discrete_input 10, `%QW2`→holding 2, `%IW4`→input 4, `40001`→holding 0, `30005`→input 4, `10003`→discrete 2, `00017`/`17` with type bool→coil 16.
- S7 text: `DB1.DBX0.3`→`{area:"DB",db:1,byte:0,bit:3,datatype:"bool"}`, `DB1.DBW2`→int, `DB1.DBD4`→real (dint if `tag_type` hint says integer via suffix `:dint`), `M0.1`, `MW10`, `MD20`, `I0.0`, `Q0.1`, `IW64`. Bool areas require a bit; word/dword areas forbid it.
- OPC UA: `ns=<int>;(s|i|g|b)=<id>` only.
- Type check: bool tag ⇄ bit/coil address; number tag ⇄ word/register/real.

- [ ] Step 1: parametrized tests over every example above + rejections (`DB1.DBX0.8`, `MW`, `ns=x;s=a`, bool tag on `%IW4`) asserting `AddressError.field`.
- [ ] Step 2: FAIL. Step 3: implement. Step 4: PASS. Step 5: commit `feat(backend): PLC address parsing for modbus/s7/opcua`.

### Task 4: Secret box + data-source/tag CRUD routes

**Files:**
- Create: `backend/app/datasources/secretbox.py`, `backend/app/datasources/routes.py` (an `APIRouter`, included from `main.py` next to the edge routes)
- Modify: `backend/app/main.py` (include router; reuse `_v2_org`, `_mutation_gate`, `st`), `backend/app/core/config.py` (`DATA_SOURCE_KEY = _read_secret(os.environ.get("DATA_SOURCE_KEY_FILE"))`; dev fallback key derived from `APP_ENV=dev` only; `_enforce_prod_env` requires the file), `docker-compose.yml` (secret file), `Makefile secrets` (generate it)
- Test: `tests/contract/test_secretbox.py`, `tests/integration/test_data_sources.py`

**Interfaces:**
- Produces: `seal(plain: dict) -> bytes`, `open_(blob: bytes) -> dict` (AES-GCM, 12-byte nonce prefix, key 32 bytes, `cryptography` already present via `pyjwt[crypto]`).
- Produces routes (all `need=_CONFIG` for writes, `_READ` for GET):
  - `GET/POST /api/v1/orgs/{org}/edges/{edge}/sources`; `PATCH/DELETE …/sources/{source}`
  - `GET/POST …/sources/{source}/tags`; `POST …/sources/{source}/tags:bulk` (CSV text body, columns `line,device,signal,address,type,unit,writable,min,max,scale`; all-or-nothing, 422 lists row errors); `PATCH/DELETE …/tags/{tag}`
  - Source JSON never contains secrets; has `has_secret: bool`, `status`, `status_detail`, `status_at`.
- Produces: `async def bump_config(tc, edge_id: UUID) -> int` — `UPDATE edges SET config_version = config_version + 1 … RETURNING`, then `pg_notify('wds_cfg', edge_id)` and `pg_notify('wds_tags', org_id)`. Called in the same transaction as every source/tag write.
- Tag create resolves/creates `lines`/`devices` rows by name under the edge's site and builds `path = f"{line}/{device}/{signal}"` (lower-snake normalized); `device_id` set.
- Registry: `main.py` lifespan LISTENs on `wds_tags` and calls `registry.refresh()`.

- [ ] Step 1: tests — secretbox round-trip + tamper → `InvalidTag`; integration: `test_create_source_and_tag_visible_in_registry` (GET `/sites/{site}/tags` lists it within 2 s), `test_version_bumps_per_write`, `test_secret_write_only`, `test_viewer_403_nonmember_404`, `test_bulk_csv_all_or_nothing`, `test_delete_tag_in_use` (alarm rule referencing it → 409 `tag_in_use`).
- [ ] Step 2: FAIL. Step 3: implement. Step 4: rebuild backend, PASS. Step 5: commit `feat(backend): data source + tag CRUD with sealed secrets`.

### Task 5: Config delivery (backend side) + ACL

**Files:**
- Create: `backend/app/datasources/publisher.py`
- Modify: `backend/app/edge/dynsec.py:edge_acls` (+ `subscribePattern {p}/cfg`, `publishClientReceive {p}/cfg`, `publishClientSend {p}/cfg-req`, `publishClientSend {p}/cfg-ack`), `backend/app/edge/mqtt_client.py` (subscribe `$share/ingest/v2/+/+/+/cfg-req`, `…/cfg-ack`; `publish_cfg(topic, payload) -> bool`, QoS1, retain False), `backend/app/main.py:_handle_message` (route `cfg-req`, `cfg-ack`)
- Test: `tests/contract/test_cfg_payload.py`, `tests/integration/test_cfg_delivery.py`

**Interfaces:**
- Produces: `async def build_cfg(pool, org_id, edge_id) -> dict` → `{"version", "sources":[…opened secrets…]}` (disabled sources omitted); `class CfgPublisher` with `start()` (LISTEN `wds_cfg` → publish), `on_request(edge, have_version:int|None)`, `on_ack(edge, payload)` updating `config_applied`, `config_error`, and per-source `status/status_detail/status_at`.
- Reconciler re-applies ACLs to existing edge roles on startup (already reconciles roles — verify it diffs ACLs; if not, add `ensure_role` call for each active edge).

- [ ] Step 1: tests — `test_cfg_payload_shape` (pure, from rows), `test_cfg_req_behind_gets_latest`, `test_cfg_req_current_gets_nothing`, `test_ack_updates_applied_and_source_status` (integration with a fake edge MQTT client using a provisioned credential).
- [ ] Step 2: FAIL. Step 3: implement. Step 4: PASS. Step 5: commit `feat(backend): push edge config over MQTT with ack`.

### Task 6: Edge consumes `cfg`

**Files:**
- Create: `edge-bridge/edge_bridge/cfg.py`
- Modify: `edge-bridge/edge_bridge/main.py` (swap adapter via a holder object read by poll loop + command handler), `edge-bridge/edge_bridge/commands.py` (adapter via holder), `edge-bridge/edge_bridge/config.py` (`state_dir`, default `/var/lib/wds-edge`)
- Test: `tests/contract/test_edge_cfg.py`

**Interfaces:**
- Consumes: `make_source_adapter`, `MultiAdapter` (Task 1).
- Produces: `class AdapterHolder: get() -> TagAdapter; swap(new) -> None` (closes old after swap); `class CfgClient(cfg, holder, bridge, site_code)` — on connect publishes `cfg-req {"have_version": n|None}`; `handle(msg)`: ignore retained, ignore `version <= current`, build all adapters (per-source failures isolated), swap, persist sealed copy to `state_dir/cfg.bin` (key `state_key` from the enrollment identity, Task 9; until then plain JSON with 0600 when no key), publish `cfg-ack {"version", "ok", "errors":[{"source_id"|"tag_id","detail"}]}`; on start loads cached cfg if present, else `tags.yaml` path.

- [ ] Step 1: tests — `test_apply_then_ack`, `test_stale_cfg_ignored`, `test_bad_source_isolated`, `test_retained_cfg_ignored`, `test_cached_cfg_loaded_on_start`.
- [ ] Step 2: FAIL. Step 3: implement. Step 4: PASS; run the dev stack: `docker compose up -d --build edge-bridge`, add a Modbus source via API → edge log shows `cfg applied version=N`. Step 5: commit `feat(edge): apply backend-pushed config atomically`.

### Task 7: Siemens S7 adapter

**Files:**
- Create: `edge-bridge/edge_bridge/adapters/s7.py`
- Modify: `edge-bridge/requirements.txt` (`python-snap7==2.0.2`), `edge-bridge/edge_bridge/adapters/__init__.py` (register `s7`)
- Test: `tests/contract/test_s7_adapter.py` (uses `snap7.server.Server` on a random port with a registered DB1 area; skip if `snap7` import fails)

**Interfaces:** `S7Adapter(site, source, now)`: `connection {host, rack, slot, timeout_ms}`; groups reads per area/DB into one `read_area` span per poll (max 200 bytes gap merge); decodes `bool/int/dint/real/word` with `snap7.util`; `write` enforces writable + min/max like modbus, uses read-modify-write for bits.

- [ ] Step 1: tests — `test_read_real_from_db`, `test_read_bit_m`, `test_write_bit_preserves_neighbours`, `test_unreachable_gives_bad`, `test_out_of_range_denied`.
- [ ] Step 2–4: FAIL → implement → PASS. Step 5: commit `feat(edge): Siemens S7 adapter (snap7)`.

### Task 8: OPC UA adapter, test-connection and browse ops

**Files:**
- Create: `edge-bridge/edge_bridge/adapters/opcua.py`, `edge-bridge/edge_bridge/ops.py`
- Modify: `edge-bridge/requirements.txt` (`asyncua==1.1.5`), `adapters/__init__.py`, `edge-bridge/edge_bridge/commands.py` (payload with `op` ∈ `test_source|browse` → `ops.run(op, payload)`; response `cmd-resp` with `result`), `backend/app/datasources/routes.py` (`POST …/edges/{edge}/sources:test` body = draft source; `POST …/sources/{source}/browse` body `{node_id?}`; both wait ≤10 s for the cmd-resp via a new `commands.request_op(...)` that does not create `commands` rows; audit `source.test` / `source.browse`)
- Test: `tests/contract/test_opcua_adapter.py` (asyncua `Server` in a thread, port 0), `tests/contract/test_edge_ops.py`

**Interfaces:** `OpcUaAdapter` uses `asyncua.sync.Client`; one subscription-free batched `read_values`; `browse(node_id|None) -> list[{node_id, name, node_class, data_type, writable}]` max 500; `ops.run("test_source", {"source": …}) -> {"ok": bool, "detail": str, "sample": [{path, v, q}] (≤5)}`.

- [ ] Step 1: tests — `test_opcua_read_write`, `test_browse_objects_children`, `test_test_source_unreachable_detail`, `test_test_source_ok_returns_sample`, and integration `test_test_route_roundtrip` (sim source).
- [ ] Step 2–4. Step 5: commit `feat(edge): OPC UA adapter + test/browse ops`.

### Task 9: Enrollment code

**Files:**
- Modify: `backend/app/main.py` (`provision_edge` also creates an `edge_enrollments` row and returns `enroll_code`; new `POST /api/v1/edge/enroll` — no auth, `ratelimit` 10/min/IP, looks up `sha256(code)` via `wds_system`, marks used, returns `{org_id, site_id, edge_id, mqtt_host, mqtt_port, ca_pem, mqtt_username, mqtt_password, state_key}` where the MQTT secret is **rotated** at enroll time so the code alone yields a fresh credential; `POST …/edges/{edge}/enroll-code` re-issues a code for a pending edge)
- Modify: `edge-bridge/edge_bridge/config.py` + new `edge-bridge/edge_bridge/enroll.py` (if `ENROLL_CODE` + `WDS_URL` set and `state_dir/identity.json` absent → call enroll, write identity 0600, then run normally)
- Modify: `web/src/features/devices/devices.ts` (`dockerRun`/`envFile` use `WDS_URL` + `ENROLL_CODE`; no secret in the command), `AddDeviceWizard.tsx` (show code with 30-min countdown; mark `opcua`, `s7` ready)
- Test: `tests/integration/test_enroll.py`, `tests/contract/test_edge_enroll.py`

- [ ] Step 1: tests — `test_enroll_once` (second use 410), `test_enroll_expired_410`, `test_enroll_wrong_code_404_and_rate_limited`, `test_enrolled_credential_connects_mqtt`, edge-side `test_enroll_writes_identity_0600`.
- [ ] Step 2–4. Step 5: commit `feat: one-time enrollment codes for gateways`.

### Task 10: Web — Data sources UI + Factory I/O template

**Files:**
- Create: `web/src/features/datasources/` — `DataSourcesPage.tsx` (gateway list with *Applied vN / Pending / Error*), `GatewayPage.tsx` (sources), `SourceWizard.tsx` (protocol → connection → Test → save), `TagTable.tsx` (inline edit, live value+quality, CSV paste dialog), `OpcBrowser.tsx`, `templates.ts` (`factoryioSorting`: Modbus source + tags + dashboard id from `features/dashboards/templates.ts` + alarm rules), `api.ts`, `i18n.ts` (th + en)
- Modify: `web/src/App.tsx` (routes `/infrastructure/sources`, `/infrastructure/sources/:edgeId`), `web/src/features/devices/tabs.ts` (tab "Data sources"), `web/src/lib/api.ts` (types)
- Test: `web/src/features/datasources/*.test.ts` for address hint + CSV parsing (vitest, if present; else `bun test`), plus Playwright check via `webapp-testing` skill.

- [ ] Step 1: unit tests for client-side CSV parsing and address placeholder per protocol.
- [ ] Step 2–3: implement pages; non-admins see read-only views; S7 page shows the PUT/GET + non-optimized DB notice.
- [ ] Step 4: `bun run tsc --noEmit` clean for new files; browser walk-through: add Modbus source → Test → add 3 tags by CSV → values appear; apply Factory I/O template.
- [ ] Step 5: commit `feat(web): data sources console`.

### Task 11: Docs + coverage

**Files:** `SDLC/factoryio.md` (replace yaml-editing steps with the web flow), `CONTRACT.v2.md` (new routes + `cfg` topics), `edge-bridge/README.md`.
- [ ] Update, commit `docs: data sources flow`.
