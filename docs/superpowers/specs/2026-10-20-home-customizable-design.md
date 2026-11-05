# Home page: Datadog-style summary with Grafana-style panels (Design)

*Date: 2026-10-20 · Branch: `feature/plant-twin-glb` · Status: approved by the user through the clickable demo (Design canvas "Plant Home Demo"); left rail and section nav dropped at the user's request.*

## Intent

The user wants the console's first page (`/`, today `OverviewPage`) to look like the Datadog RUM summary: sections with a title and a link to the matching board, panels with a status stripe, big header values, multi-series lines, stacked bars, and big-number tiles with a sparkline or tinted background. Every panel must be customizable the way Grafana panels are: chart type, signals, series colours (any colour), line width, fill, line shape, points, axis range, unit, decimals, header value, legend, thresholds (lines or bands), big-number size/colour/background, stripe, width and height. Panels can be dragged, resized, duplicated, removed and added.

The user approved the demo as a whole ("ชอบทุกอย่าง") except two parts: the dark icon rail on the far left and the in-page section nav. The app's own Shell already provides navigation, so neither is built.

## Goals

- Replace the fixed six-card overview with the sectioned summary from the demo, fed only by real data.
- Per-panel customization with the demo's editor, applied live.
- Layout and theme remembered per org in the browser.
- A light and a dark theme for the Home content (the Shell chrome is already dark).
- Keep the onboarding card and connect guide on the page, under the live readouts as today.

## Non-goals

- Sharing a Home layout across users or machines (follow-up: store it as a private board through `dashboardApi`).
- A global dark theme for the rest of the app (redesign spec R1).
- Replacing the Dashboards feature or its widget model.

## Anti-goals

- Invented signals or numbers. The demo's crusher, screen and throughput series do not exist in this plant; the real page shows only real tags, alarms and material decisions, and says so when a source is empty.
- Dual axes. A panel holds signals of one unit; the editor enforces it.
- Recolouring on filter or hide: a series keeps its colour.

## Data mapping (demo → real)

| Section | Panel | Real source |
|---|---|---|
| Line health | Line availability | `avail:<running tag>`: share of samples with the running tag on, per bucket, ×100. Thresholds 95 / 98 as bands. Header: average with change vs the previous window. |
| Line health | Stops and alarms | `alarms:critical` + `alarms:warning`: alarms raised per bucket from the live alarm store, stacked bars, header sums. |
| Production → Conveyors | Belt speed, Motor temperature | `tag:` history + live tail through `useSeries`; thresholds from the enabled hi/hihi/lo/lolo alarm rules of the tag. |
| Production → Key readings | Bin level, Motor temperature, Gravel ratio, Speed setpoint | Big numbers on the same tags; colour from alarm-rule limits. |
| Gravel and sand AI | Trucks by decision | Material decision events (latest 200), bucketed per window, gravel vs sand. |
| | Last truck | Newest material event (`decisionOf`). |
| | Decision margin | `summary.margin_hist` (10 bins from the backend); review line = the camera's `min_margin`. |
| | Recent trucks | Latest 8 material events. |
| Alarms | Top alarm sources | Alarms raised in the window grouped by tag. |
| | Active alarms | Open alarms from `useAlarms`, Acknowledge for operator roles. |

## Builder's calls (made by Claude, not asked of the user)

- **Rendering:** SVG paths and HTML bars, the same technique as the approved demo, instead of uPlot. Every customization knob maps onto it directly, and the bucketed series stay under ~120 points per line. uPlot remains the engine for Trends.
- **Buckets:** every series is resampled into fixed buckets over the window (lines 120, bars 60): average for tag values, sum for counts, `null` for no data so offline gaps show as breaks.
- **Previous window:** history is fetched for twice the window so the header can show the change without a second request.
- **Ranges:** 15 min, 1 h, 4 h, 24 h, with pause, step back/forward one window, and zoom out.
- **Filters:** Equipment (from `EQUIPMENT`) and alarm severity. The demo's Area filter is dropped: this plant has one line.
- **Storage:** `localStorage` key `wds.home.v1:<orgId>`, wrapped in try/catch; a broken or blocked store falls back to the default layout.
- **Code layout:** new `web/src/features/home/` (model, chart math, data hooks, panel views, editor, scoped `home.css`, `i18n.ts` with EN and TH). `OverviewPage` renders it. Pure logic is covered by `bun:test`.
