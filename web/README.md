# wds-web — industrial dashboard frontend

React 18 + Vite + TypeScript + uPlot. Implements `CONTRACT.md` (REST + WS + demo
auth) against the FastAPI backend on `:8000`, styled per
`SDLC/industrial-dashboard/07-ui-design-system.md` (ISA-101 dark palette,
Datadog-density layout).

## Views

| Tab | Content |
|---|---|
| Overview | HMI tiles for the 6 sim tags (value, unit, quality icon, status dot, last-update age, STALE >15s) + alarm list |
| Trend | uPlot live chart, multi-tag chips (≤6 series), 2 Hz aligned sampling, 20 min ring buffer, rAF-flushed |
| Alarms | ISA-18.2 list — severity color+icon+text, Active/Acked/All filter, ACK button (operator token), flood banner ≥10 active |
| Controls | writable-tag picker, value input (ON/OFF segmented for bool tags), type-to-confirm modal, `POST /api/commands`, live lifecycle `issued→sent→acked→done/denied/failed/timeout` + recent commands |

Health strip (top): LIVE/WS state, MQTT, EDGE up/stale, edge `clock_ok`, DB,
backend uptime, last heartbeat.

## Auth (demo)

Bearer token input in the topbar, persisted in `localStorage` (`wds.token`).
`demo-operator` → read+command+ack, `demo-viewer` → read-only, empty → anon
(GETs still work; mutating calls 401/403). Changing the token reconnects the WS.
Close code `4401` / `auth_expired` event → "session expired" banner.

## Run

```bash
bun install        # canonical: bun.lock (npm install still works — package.json compatible)
bun run dev        # http://localhost:5173, proxies /api + /ws -> localhost:8000
bun run build      # tsc --noEmit + vite build -> dist/
bun run preview    # serve dist on :5173 (same proxies configured)
```

## Docker

Multi-stage: `oven/bun:1-alpine` build (`bun install --frozen-lockfile`) → `nginx:1.27-alpine` serve, **port 80**.
nginx proxies `/api` and `/ws` (upgrade headers) to `http://backend:8000`
(compose service DNS name) — see `nginx.conf`.

```bash
docker build -t wds-web .
docker run -p 8080:80 wds-web   # requires a reachable `backend` host or compose network
```

## Layout / responsive

- ≥1280px: dense tile grid; 768–1279px: 2-col / stacked; <768px (`xs`):
  read-only — **Controls tab is removed entirely** (safety per spec §7);
  <480px: "screen too small" placeholder, no UI rendered.

## Simplifications vs design doc 07 (demo scope)

- Tabs instead of sidebar; no Mimic/Tags/Admin pages, no inspector drawer.
- No webfont download — `Inter`/`Roboto Mono` fall back to system stacks
  (tabular-nums enforced via CSS + mono for values).
- Type-to-confirm chosen for the 2-step command confirm (hold-to-confirm not
  implemented). Confirm word = leaf tag name.
- Trend plots live samples only — no history backfill, time-range picker, CSV
  export, or compare mode.
- No alarm sound toggle, kiosk/wallboard mode, or `?density=compact` override.
- Command status is tracked via WS `command` events + 2s REST poll fallback on
  the tracked command.
