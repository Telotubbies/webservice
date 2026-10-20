# ADR-0003: Live reconnect — snapshot resync, heartbeat, no server replay

Status: proposed (2026-10-20) · Touches: `web/src/lib/ws.ts`, `web/src/lib/live.ts`, `backend/app/edge/ws.py`, `backend/app/main.py` (`ws_endpoint`)

## Context

The browser already reconnects: `ws.ts` backs off 0.5 s → 15 s with ±25 % jitter, renews the token once on close code 4401, and re-fetches open insights on every `onopen`. What it does not do:

| Gap | Effect today |
|---|---|
| Only insights are resynced | Tags, alarms, command status and edge health missed during an outage stay stale until the next event for the same key. An alarm that cleared while offline shows as active indefinitely. |
| No client heartbeat | A half-open socket (Wi-Fi roam, NAT timeout, laptop sleep) never fires `onclose`; the UI says "open" while receiving nothing. The server already answers `ping` with `pong`; nothing sends it. |
| Overflow is silent | `WSManager.broadcast` drops the oldest queued event for a slow client and only logs. The client cannot know it lost data. |
| Tab/network state ignored | A backgrounded tab keeps retrying at up to 15 s; coming back online or foregrounding waits for the current backoff timer. |
| Close codes treated alike | 4403 (forbidden origin/site/cap) retries forever; it never succeeds. |
| Trend charts keep a hole | The live ring buffer has a gap for the outage window. |

## Decision

**Reconnect = reconnect + resync from authoritative REST snapshots.** The server keeps no per-client replay buffer and adds no event sequence numbers.

Why not a replay log: the backend runs as several replicas behind a load balancer, so a client may land on a replica that never saw its missed events; a shared log (Redis stream or table) is new infrastructure and new retention rules for data the REST API already serves authoritatively. Snapshots are idempotent, tenant-scoped by the existing RLS paths, and bound the cost of a long outage to one fetch instead of a replay of its length.

### 1. Connection state machine (client)

```
connecting ─open─▶ open ─no frame 30 s─▶ stale ─▶ (close) ─▶ reconnecting ─open─▶ resyncing ─done─▶ open
                    │                                              ▲
                    └──onclose──────────────────────────────────────┘
auth_expired and forbidden are terminal until the user acts.
```

`WSState` gains `stale` and `resyncing` (today: connecting, open, reconnecting, closed, auth_expired). The banner shows only after 3 s outside `open`, so sub-second blips are invisible.

### 2. Heartbeat

- Client sends `{"type":"ping"}` every 20 s when `open` and idle.
- Any inbound frame (tag, pong, …) resets the watchdog. No frame for 30 s → `sock.close()` → normal reconnect path.
- Server unchanged (it already replies `pong` with `ts`). 30 s stays under the common 60 s proxy idle timeout.

### 3. Resync on reconnect (the core)

Race to avoid: fetch a snapshot, then subscribe, and events published between the two are lost. So the order is **subscribe first, buffer, snapshot, apply, drain**:

1. Socket opens and the auth frame is sent (state `resyncing`).
2. Inbound events go to a bounded buffer (cap 2 000, oldest dropped, which just forces step 4's snapshot to win) instead of straight into the store.
3. In parallel, fetch `GET /api/tags/latest`, `/api/alarms`, `/api/commands`, `/api/insights?state=open`. One failure retries that endpoint with backoff; the others still apply.
4. Apply snapshots with `setTags / setAlarms / setCommands / syncOpenInsights` (replace, not merge, so cleared items disappear).
5. Drain the buffer through `dispatch`, skipping any event whose timestamp (`ts` / `updated_at`) is older than the snapshot row for that key.
6. State → `open`.

First connect of a page load is not a reconnect, because the app's initial seed already does steps 3–4. Resync runs only when a socket was previously `open` in this page's life.

Health (`edge`/`mqtt`) is not fetched; the server already pushes `health_event()` right after connect.

### 4. Server-signalled resync (overflow)

`WSManager.broadcast` already counts `client.dropped`. Add: when a client's `dropped` rises, enqueue at most one `{"type":"resync","reason":"overflow"}` per 5 s (placed after the drop, with its own reserved slot so it cannot itself be dropped). The client runs step 3–6 without reconnecting. This turns silent loss into a bounded, self-healing event.

### 5. Triggers that skip the backoff timer

| Event | Action |
|---|---|
| `window` `online` | reconnect now, reset attempt to 0 |
| `visibilitychange` → visible, and not `open` | reconnect now |
| `visibilitychange` → hidden for > 60 s | close socket, stop retrying; on visible do a reconnect + resync |
| `offline` | stop timers, state `reconnecting` without spinning the backoff |

### 6. Close-code policy

| Code | Meaning | Client |
|---|---|---|
| 4401 | token missing/expired/revoked | renew once (existing); fail → `auth_expired` |
| 4403 | origin, per-IP cap, site not visible | terminal `forbidden`, no auto-retry; manual "Retry" only. (A per-IP cap can clear, so the manual button stays.) |
| 1000/1001/1006/1011/1012/1013 and others | normal drop, restart, try-again-later | backoff as today |

### 7. Stale data is visible

After 2× the tag's expected period, or 30 s when unknown, with no frame, the tag's quality shown in the UI becomes `stale` (client-side only, never written back). Resync clears it. Values are never silently presented as live.

### 8. Trend backfill

When a chart is mounted during a resync, it calls `/api/tags/{name}/history?from=<last point ts>&to=now` for its visible series and splices the result into its buffer. Charts not mounted do nothing; they fetch history on mount as they do now.

## Backend changes

Small, all additive and backward compatible:

- `ws.py`: overflow notice (§4).
- Nothing else. The `/ws` and `/ws/v1` auth frame and `ping`/`pong` are unchanged, so CONTRACT.v2 §5 gains only one server→client message type, `resync`. Clients that ignore unknown types are unaffected.

## Consequences

- Correctness after any outage is independent of its length and of which replica serves the new socket.
- Cost on reconnect: four small GETs per client. With a restart of N clients this arrives as a burst; the existing jitter spreads the sockets, and the snapshot fetches ride the existing per-principal rate limits. If this proves heavy, add `If-None-Match` ETags to `/api/tags/latest` first.
- Events can be applied twice (buffered + snapshot); handled by the timestamp compare in step 5 and the idempotent store merges.
- Memory: the resync buffer is bounded and exists only while resyncing.

## Tests

- `web`: unit tests for the state machine with a fake WebSocket and fake timers: watchdog fires at 30 s, backoff curve, 4403 is terminal, `online`/`visible` skip the timer, resync orders subscribe → snapshot → drain, stale-event skip.
- `tests/integration/test_ws.py`: slow consumer receives `resync` once per window; `ping` still returns `pong`.
- `tests/security/test_ws_admission.py` stays green: nothing here weakens origin, auth-frame, per-IP or org-scope checks, and the snapshots use the normal authenticated REST path.
- Manual: kill the backend container for 20 s, restart it, confirm an alarm cleared during the outage disappears and the banner shows then clears.

## Rollout

1. Heartbeat + close-code policy + online/visibility triggers (client only, no contract change).
2. Snapshot resync (§3) and stale quality (§7).
3. Server `resync` notice (§4) and chart backfill (§8).

Each step ships independently.

## Out of scope

Server-side replay or event sequence numbers, MQTT-level QoS between backend and browser, multi-tab socket sharing (SharedWorker).
