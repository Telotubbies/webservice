# ATTACK_PLAN — adversarial checklist for the red-team review

Every scenario lists the **expected system behavior per CONTRACT.md** (binding),
the attack vector, and which test covers it. Status: `unit` = contract/unit
suite (always runs), `int` = integration (needs `BASE_URL`/`MQTT_HOST`),
`disruptive` = needs `DISRUPTIVE=1` + docker, `manual` = checklist only.

Legend: ✅ covered · 🔶 partial/indirect · ⬜ not yet covered

## A. From SDLC 09 §6.6 (design-review holes)

| # | Scenario | Vector | Expected per contract | Test | Status |
|---|----------|--------|------------------------|------|--------|
| A1 | Concurrent command conflict | 2 clients POST `/api/commands` same tag simultaneously | exactly one **201**, other **409** `{"active_command_id"}` — one in-flight per tag, enforced by DB partial unique index | `test_adversarial.py::test_concurrent_same_tag_post_one_409` | ✅ int |
| A2 | Idempotent replay after 409 | resend same `idempotency_key` while other command in-flight on tag | **200** + original `command_id` — dedup checked *before* conflict | `test_adversarial.py::test_idempotent_replay_after_409`, `test_lifecycle.py::test_dedup_checked_before_conflict` | ✅ unit+int |
| A3 | Command TTL expired at edge | `issued_at` 60 s stale, `ttl_s=5` on `cmd/{edge}/{req}` | edge **drops + denies** `detail=ttl_expired`; never executes | `test_adversarial.py::test_edge_ttl_expired_command_denied`, `test_lifecycle.py::test_edge_denied_ttl_expired` | ✅ unit+int |
| A4 | WS token expiry mid-session | token `exp` passes while `/ws` open | `{"type":"auth_expiring"}` → `{"type":"auth_expired"}` → close **4401** (CONTRACT.md; 09 says 4001 — divergence) | `test_auth_ws.py::test_ws_auth_expired_close_code_is_4401`, `test_ws.py::test_ws_auth_expired_shape_documented` | 🔶 unit (demo tokens never expire — shape only) |
| A5 | WS fan-out replica / Redis down | backend replica B can't see A's events | degrade to local-only + `health` warn + metric — never silently frozen UI | — (single-replica demo; N/A in compose) | ⬜ out of demo scope |
| A6 | Edge clock skew | `EDGE_CLOCK_SKEW_MS>500` | heartbeat `clock_ok=false`; commands → `denied/clock_untrusted`; metric | `test_adversarial.py::test_clock_skew_commands_denied` (auto-skips unless compose skewed) | ✅ int (env-gated) |
| A7 | Alarm flood | 500 alarms/min spike | UI throttles popups but **no alarm record dropped**; ack still works | `test_alarms.py` covers single-alarm path; flood variant manual | 🔶 partial |
| A8 | Render bad/stale quality | tag `q=bad` or stale >15 s | UI shows `—` + badge, never renders dead value as live | frontend scope (not pytest) | ⬜ manual |
| A9 | NTP lost → uncertain | edge unsynced clock | new telemetry `q=uncertain`, heartbeat `clock_ok=false` | covered indirectly by skew test; `uncertain` quality validated in unit suite | 🔶 partial |

## B. Additional scenarios (QA-authored)

| # | Scenario | Vector | Expected per contract | Test | Status |
|---|----------|--------|------------------------|------|--------|
| B1 | Malformed MQTT payload — telemetry | garbage/`{v:"str"}`/truncated JSON on `plant1/sort/line1/conv1/temp_c` | ingest drops bad frames; `/api/health` stays ok; no poisoned rows | `test_adversarial.py::test_backend_malformed_telemetry_ignored` | ✅ int |
| B2 | Malformed MQTT payload — command | `not json`, truncated JSON, `{}` on `cmd/{edge}/{req}` | edge ignores; still answers the next well-formed command | `test_adversarial.py::test_edge_malformed_cmd_payload_ignored` | ✅ int |
| B3 | Duplicate req_id / QoS1 redelivery | same `cmd` payload published twice | edge idempotency cache (last 1000 keys) → same resp, no double write | `test_adversarial.py::test_edge_duplicate_req_id_no_double_apply` | ✅ int |
| B4 | Duplicate telemetry frame | same `(tag,ts)` published 2× QoS1 | dedupe `(tag,ts)` or tolerate; no crash, no double-counted aggregates | `test_adversarial.py::test_telemetry_qos1_duplicate_tolerated` | ✅ int |
| B5 | Command burst | 20 POSTs back-to-back across writable tags | all in {201,409} (contract has no rate limit; 429 acceptable hardening); never 5xx, never double-execute | `test_adversarial.py::test_command_burst_no_5xx` | ✅ int |
| B6 | Alarm flood 100/s | spike `temp_c` across threshold repeatedly | alarms recorded; list endpoint responsive; no event loss in audit | — (flood generator needs sim control) | ⬜ manual/follow-up |
| B7 | Edge disconnect mid-command | `docker compose stop edge-bridge` between POST and resp | command → `timeout` after `ttl_s`; no auto-retry; UI sees terminal state | `test_adversarial.py::test_command_timeout_edge_offline` | ✅ disruptive |
| B8 | Clock skew — backend vs edge | skewed edge clock | `denied/clock_untrusted`, heartbeat `clock_ok=false` (same as A6) | `test_clock_skew_commands_denied` | ✅ int (env-gated) |
| B9 | SQL-ish tag name | `a.b'; DROP TABLE--`, `' OR 1=1--` in tag fields | clean 4xx; parameterized queries; no 500; health stays ok | `test_adversarial.py::test_sqlish_tag_name_no_500`, `test_topics.py` (charset) | ✅ unit+int |
| B10 | Oversized payload | ~1 MB `idempotency_key` / body | 4xx (400/413/422); connection survives; no OOM | `test_adversarial.py::test_oversized_payload_rejected` | ✅ int |
| B11 | Malformed JSON body | `{invalid,,}` POST body | 400/415/422, never 500 | `test_adversarial.py::test_malformed_json_body` | ✅ int |
| B12 | `ttl_s` edge values | `0`, `-1`, `NaN`, `inf`, `"5"`, `true` | **400** — TTL must be finite > 0 | `test_command_payloads.py` (8 cases), `test_rest.py::test_command_ttl_zero_400` | ✅ unit+int |
| B13 | Non-writable / unknown tag write | POST on `temp_c` or ghost tag | `denied/not_writable` in lifecycle (201→denied) — see README divergence #7 | `test_rest.py::test_command_readonly_tag_denied`, `test_edge_nonwritable_tag_denied` | ✅ unit+int |
| B14 | Out-of-range setpoint | `speed_sp = 9999` / `-1` | `denied/out_of_range`; boundary 0/60 accepted | `test_lifecycle.py` range tests + `test_edge_out_of_range_denied` | ✅ unit+int |
| B15 | Value type smuggling | `value:"fast"` on num tag, `value:1` on bool tag, `value:true` on speed_sp (Python bool-is-int trap) | REST 400 or edge `error` → `failed`; never silently coerced | `test_lifecycle.py` type-mismatch tests | ✅ unit |
| B16 | Unknown-tag telemetry | publish on unregistered UNS topic | backend drops + counts `telemetry_unknown_tag`; `/latest` → 404 | `test_adversarial.py::test_backend_unknown_telemetry_tag_dropped` | ✅ int |
| B17 | Topic grammar abuse | `//`, wildcards, NUL, `plant2/` site, 6 segments, `cmd/` as area | classifier rejects all; reserved subtrees can't smuggle tags | `test_topics.py` (16 invalid cases) | ✅ unit |
| B18 | Anonymous privilege probe | POST commands/ack with no token / viewer token / `?token=` variants | 401 anonymous, 403 viewer — server-side, not UI-hidden | `test_rest.py` 401/403 tests, `test_alarms.py` ack auth | ✅ int |
| B19 | Anonymous WS command leak | anon `/ws` while commands fire | **no** `command` events (06 §2/09 §7 — CONTRACT.md silent, flagged) | `test_ws.py::test_ws_anonymous_no_command_events` | ✅ int (flagged divergence) |
| B20 | Reconnect backoff + jitter | client-side WS reconnect after drop | exponential `1→2→4…≤30 s` + ±25 % jitter (06 §4) | frontend scope | ⬜ manual |
| B21 | Poll storm / adapter crash-loop | adapter failing | exponential backoff + circuit breaker; no reconnect spam (04 §6.5) | edge-bridge internals | ⬜ out of pytest scope |
| B22 | Command to unknown site/edge | `cmd/edge9/{req}` or wrong site prefix | nobody answers → backend `timeout` at `ttl_s` | `test_command_timeout_edge_offline` (disruptive) covers timeout path | 🔶 partial |
| B23 | `idempotency_key` cross-user replay | same key, different user | contract scopes dedup to "same key + same user" → new command | — (demo tokens lack distinct user ids) | ⬜ follow-up |
| B24 | `ts` forgery — far future/past | telemetry `ts` year 3000 | stored as-is (source ts) but stale detection uses backend receive-time (05 §6) — no stale/audit corruption | — (needs ingest observation hooks) | ⬜ follow-up |
| B25 | cmd-resp spoofing | foreign publisher emits `done` on `cmd-resp` for pending req | demo has no MQTT auth (accepted risk, 08 §10) — backend maps resp blindly; document as accepted | — | ⬜ accepted risk |

## Pre-merge / pre-demo gate

- [ ] `pytest` green (unit layer, 289 tests)
- [ ] `pytest -m integration` green against `docker compose up`
- [ ] `DISRUPTIVE=1 pytest -m disruptive` passes (timeout path)
- [ ] All `xfail`/skip reasons reviewed — none hiding a contract violation
- [ ] README divergence list walked through with backend + edge owners
