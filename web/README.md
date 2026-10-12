# wds-web — industrial dashboard frontend

React 18 + Vite + TypeScript + uPlot. Implements `CONTRACT.md` (REST + WS + demo
auth) against the FastAPI backend on `:8000`, styled per
`SDLC/industrial-dashboard/19-ui-v3-design.md` (ISA-101 neutral HMI palette,
Datadog-density ops wall).

## Views (nav: Monitor / Operate / Intelligence / System)

| Route | Content |
|---|---|
| `/` Overview | Ops wall — insight rail (AI), hero mimic, metric tiles with normal/alarm bands from configured alarm rules, active alarms, insight feed |
| `/line` Line | ISA-style mimic (shade-coded equipment state, ▲◆ alarm markers, instrument bubbles); `?eq=` opens the faceplate |
| `/trends` Trends | uPlot live chart (≤6 series, ms epochs), window picker (`?w=`), CSV export, insight anomaly ribbons under the series |
| `/alarms` Alarms | ISA-18.2 list — severity color+icon+text, state filter, ACK (operator token), flood banner ≥10 active |
| `/insights` Insights | Insight engine output — state/kind filters, tag links open faceplate, trend deep links |
| `/tags` Tags | Tag inventory with live values; row click opens faceplate |
| `/commands` Commands | Recent commands + lifecycle (accepted→dispatched→acknowledged/rejected/failed/timeout) |
| `/health` Health | LIVE/WS state, MQTT, EDGE up/stale, edge clock_ok, DB, backend uptime |

Global faceplate: right-hand tag panel via `?fp=<tag>`, openable from mimic,
tiles, alarms, insights, and tags. Writable tags carry guarded controls
(type-to-confirm dialog; role/edge/clock/viewport gating — server still enforces).

Health strip (top): LIVE/WS, MQTT, EDGE, clock_ok, DB, uptime.

## Auth (demo)

Bearer token in `localStorage` (`wds.token`) — `demo-operator` can ACK/operate,
`demo-viewer` is read-only. Replaced by OIDC (ADR-12) in Phase 3.

## Dev

```bash
npm install
npm run dev        # vite dev server, proxies /api + /ws to :8000
npm run build      # tsc + vite build → dist/
npm run check      # token + i18n-parity gates
```

UAT: `node tests/e2e/uat.mjs` from the repo root (needs Playwright + the stack up).
