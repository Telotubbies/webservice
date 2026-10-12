# 16 — Command Safety Contract

Status: **Binding** for backend, edge-bridge and UI from CONTRACT.v2 onward.

## 1. Safety boundary

- The SaaS is a **supervisory** system. **The PLC (and any certified safety system) is the final interlock** for every equipment action: E-stop, guards, overloads, permissives.
- No code path in this system may bypass or override a PLC interlock.
- A command is a **request**. The PLC/edge may refuse it, and a refusal is a normal, audited outcome.
- **None** of the following is a safety control: the web UI, RBAC, confirmation dialogs, or hiding controls on small screens. They reduce error and abuse. They don't make the plant safe.
- The system never issues an equipment write that a human did not request. There is **no automatic retry that creates a new write**.

## 2. Server-side gates (in order; first failure wins)

Every rejection returns problem+json with a stable `code` and is written to `audit_log` as `command.rejected_by_gate`.

| # | Gate | Failure |
|---|---|---|
| 1 | Valid access token (ADR-12) | 401 `unauthenticated` |
| 2 | Membership in the path org with permission `command:issue` | 404 (non-member) / 403 `forbidden` |
| 3 | Tag exists in **that org and site** (composite FK, ADR-13) and `writable=true` | 404 / 422 `not_writable` |
| 4 | Value type matches the tag type (`bool`, `number`); no bool-on-numeric, no NaN/Inf | 422 `invalid_type` |
| 5 | Value within the registry `min`/`max`/`step` or `enum` (server-side copy of the edge registry) | 422 `out_of_range` |
| 6 | Preconditions: edge `online`, last heartbeat `clock_ok=true`, site `control_enabled=true`, plus per-tag `requires` (e.g. `no_active_alarm:{device}:critical`) | 409 `precondition_failed` with `reason` |
| 7 | Rate limit per user + tag (5 / 10 s) | 429 |
| 8 | No in-flight command on the tag (partial unique index) | 409 `command_in_flight` + `active_command_id` |
| 9 | `ttl_s` ∈ [1, 60], default 10 | 422 `invalid_ttl` |

Idempotency: if the same `(org, user, idempotency_key)` exists, return **200** with the existing command. This is checked **before** gate 8, as in the current model test `test_dedup_checked_before_conflict`.

## 3. Lifecycle

```
accepted ──(PUBACK)──► dispatched ──(edge resp ok)────► acknowledged
    │                      │       ──(edge resp deny)───► rejected
    │                      │       ──(edge resp error)──► failed
    │                      └─(no resp by issued_at+ttl)─► timeout
    └─(ttl elapsed before PUBACK / publish error)──────► failed (expired_before_dispatch | dispatch_error)
```

| Status | Exact meaning | Never means |
|---|---|---|
| `accepted` | Passed every gate. `commands` + `command_outbox` + `command_events` + `audit_log` rows were committed in **one** transaction | that anything left the server |
| `dispatched` | The broker returned **PUBACK** for the QoS1 publish | that the edge received it or the machine moved |
| `acknowledged` | The edge reports the adapter wrote the value (register/coil write returned ok) | that the process reached the requested state; the UI shows **readback** separately (§5) |
| `rejected` | The edge or PLC refused: `out_of_range`, `not_writable`, `interlock`, `ttl_expired`, `clock_untrusted`, `future_issued_at`, `retained_command` | a system error |
| `failed` | The command could not be dispatched before TTL, or the edge reported an adapter error | that the write certainly did not happen. Operators must check readback |
| `timeout` | No edge response by `issued_at + ttl_s` (+2 s grace) | that the write did not happen |

Terminal statuses: `acknowledged`, `rejected`, `failed`, `timeout`. In-flight statuses: `accepted`, `dispatched`.

Mapping from v1: `issued→accepted`, `sent→dispatched`, `acked`→(removed), `done→acknowledged`, `denied→rejected`, `failed→failed`, `timeout→timeout`.

## 4. Delivery: transactional outbox

1. The API transaction inserts `command_outbox(command_id, topic, payload, not_after = issued_at + ttl_s)`.
2. The **outbox relay** (in `wds_system`; one active relay via `pg_try_advisory_lock`) does the following:
   - Selects pending rows with `FOR UPDATE SKIP LOCKED`.
   - If `now ≥ not_after`, it marks the command `failed/expired_before_dispatch` and does not publish.
   - Otherwise it publishes QoS1 and waits for PUBACK (`wait_for_publish(timeout=2s)`).
   - On PUBACK it moves the command to `dispatched` and deletes the outbox row.
   - On publish error or PUBACK timeout it leaves the row for the next pass; this is the **same message, same `command_id`**.
3. A crash between PUBACK and marking `dispatched` means the relay publishes the same message again after restart. That is safe because **the edge deduplicates by `command_id` persistently** (edge SQLite `seen_commands`, kept for `ttl_s + 300 s`, which survives edge restarts). A duplicate gets the original response replayed.
4. This is delivery retry of one human-requested command within its TTL. It never creates a new command and never extends the TTL.
5. Restart sweep: on backend start, any `accepted`/`dispatched` command past `not_after + grace` → `timeout`. Unexpired `accepted` rows stay for the relay. This keeps invariant I9.

## 5. Responses, late and duplicate events

- `cmd-resp` is accepted only on the topic of the edge that owns the command (doc 17 ACL + topic check).
- The `command_id` must exist in that org. Otherwise: drop + security log.
- Duplicate response for a terminal command → ignored; recorded in `command_events` as `duplicate_response`.
- Response after `timeout` → recorded as `late_response` with the reported outcome. **The terminal status does not change.** The UI shows "late result: …" on the command row.
- **Readback**: for 10 s after `acknowledged`, the UI compares the tag's live value to the requested value and shows *readback ok / mismatch / unknown (stale)*. This is informational and not a status.

## 6. Edge-side checks (kept; defense in depth)

Retained flag → `rejected/retained_command`. Clock untrusted → `clock_untrusted`, checked before TTL. Future `issued_at` > 2 s → `future_issued_at`. TTL expired → `ttl_expired`. Registry writable + range + type → `not_writable` / `out_of_range`. Adapter or PLC refusal → `interlock` or `failed`.

## 7. Audit semantics

Every transition writes `command_events(org_id, command_id, from_status, to_status, actor, reason, at)`. Actor is `user:{sub}`, `relay`, `edge:{edge_id}` or `sweeper`.

The audit log row for the command links:
- actor
- `org/site/edge/tag` ids
- requested value
- `idempotency_key`
- final outcome

The audit log is append-only (doc 18 §4, ADR-13 grants).

## 8. Required tests (phase 4 exit gate)

| Test | Assertion |
|---|---|
| gates 1–9 | each gate returns its code and writes an audit row; the order is respected |
| atomic accept | killing the DB connection mid-transaction leaves no orphan outbox/command |
| broker down after commit | relay publishes when the broker returns, if still within TTL; otherwise `failed/expired_before_dispatch` |
| PUBACK timeout | stays `accepted`, re-published, ends `dispatched` once |
| crash after PUBACK | re-publish → edge replies with the same response, PLC write applied **once** (sim counter) — **also after an edge restart** |
| duplicate / late response | terminal status unchanged, event recorded |
| no auto-write | over 1000 randomized failure injections, the count of sim writes ≤ count of human commands |
| invariants I3–I9, I12, I13 | real-code tests per `tests/INVARIANTS.md` |
