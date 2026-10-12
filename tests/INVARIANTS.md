# Safety & correctness invariants → test map

Phase-0 baseline (2026-10-10, pre-SaaS build, stack via `make up`):

| Suite | Result | What it exercises |
|---|---|---|
| `pytest -m "not integration"` | 289 passed | **Reference model only** — `tests/contract/schemas.py` re-implements the contract; it does **not** import backend or edge code |
| `pytest -m integration` | 38 passed, 4 gated skips | Real stack over HTTP/WS/MQTT |
| `node tests/e2e/uat.mjs` | 28/28 PASS | Real browser against nginx + backend |
| `bun run build` | clean | tsc + vite |

There are no unit tests that import `backend/app` or `edge-bridge/edge_bridge`.
Any invariant marked "model only" is therefore **not proven on real code**.

| # | Invariant | Real-code coverage | Model coverage | Gap / action (phase) |
|---|---|---|---|---|
| I1 | `q=bad` telemetry cannot clear a critical alarm | `integration/test_adversarial.py::test_alarm_survives_bad_quality_telemetry` (DISRUPTIVE, gated) | — | Add an ungated unit test on the alarm engine (P2) |
| I2 | `q=stale`/`uncertain` cannot clear or raise a critical alarm | none | — | Add an alarm-engine unit test (P2) |
| I3 | Retained commands are rejected | `test_retained_command_denied_on_edge_restart` (gated) | — | Add an edge unit test (P4) |
| I4 | TTL bounds enforced; expired commands rejected | `test_edge_ttl_expired_command_denied` | `contract/test_lifecycle.py::test_edge_denied_ttl_expired`, `…ttl_boundary…` | Edge unit test (P4) |
| I5 | Future `issued_at` rejected | none | `schemas.py` only | Edge unit test (P4) |
| I6 | Untrusted clock → `clock_untrusted` | `test_clock_skew_commands_denied` (gated, needs env override) | `test_edge_denied_clock_untrusted`, `test_edge_clock_checked_before_ttl` | Edge unit test with an injected clock (P4) |
| I7 | No automatic retry of writes to equipment | none | — | Outbox relay test: never creates a new command; re-publish keeps the same `command_id` (P4) |
| I8 | One in-flight command per tag → 409 | `test_concurrent_same_tag_post_one_409`, `test_idempotent_replay_after_409` | `test_inflight_same_tag_returns_409_with_active_id` | Keep; port to v2 statuses (P4) |
| I9 | Restart sweep must not brick a tag | none | — | Backend unit test on the sweeper (P2) |
| I10 | Telemetry dedup on `(tag, ts)` | `test_telemetry_qos1_duplicate_tolerated` | — | Keep; port to `(tag_id, ts)` PK (P2) |
| I11 | Edge publishes LWT / degraded heartbeat | `test_heartbeat_present_and_shaped` (shape only) | `test_heartbeat_clock_ok_false_is_valid_shape` | Kill-edge test asserting LWT → edge `stale` (P4) |
| I12 | Duplicate command id is not applied twice at the edge | `test_edge_duplicate_req_id_no_double_apply` (in-memory cache) | — | Must also hold **across edge restart** (P4, persistent dedup) |
| I13 | Out-of-range / non-writable write is rejected | `test_edge_out_of_range_denied`, `test_edge_nonwritable_tag_denied` | payload tests | Also enforce server-side from the registry (P4 gate 5) |

Rule from phase 2 on: every PR that touches alarms, commands, ingest, or the edge
must keep each row's real-code test green. A row only counts as covered when it
has a test that imports or exercises the real code.
