# Datadog Reference Screenshots — Design Pattern Notes

All images sourced from docs.datadoghq.com (`docs.dd-static.net` CDN) at
`?auto=format&fit=max&w=1600` (1600px wide). Light theme — Datadog's default product UI.

Recurring UI vocabulary observed across nearly every screenshot:

- **App chrome**: dark left icon rail (~48px) + optional secondary nav column; top bar holds
  product tabs, a pill-style **time selector** (`Past 1 day`, `Past 15 Minutes`, `1w`), and
  live-pause/step controls (`◀◀ ▮▮ ▶▶`) always top-right.
- **Query/filter bar**: full-width search input accepting `key:value` tokens; rendered
  tokens shown as mono-spaced chips inside the field (e.g. `muted:true` in monitor-list).
- **Facet panel**: left column of collapsible groups (Status, Muted, Source, Service…) with
  checkboxes + right-aligned result counts (342, 285, 23…). "Hide Controls" toggles it.
- **Status palette**: Alert = saturated red, Warn = amber/orange, No Data = gray, OK = green.
  Rendered as small rounded pills in tables, a segmented full-width bar in headers,
  and colored row-tint/border in lists.
- **Typography**: sans-serif UI text; monospace for queries/tag values; tabular figures;
  uppercase micro-headers for table columns (`STATUS`, `MUTED ELAPSED`, `NAME`, `TAGS`).
- **Density**: high. Tables ~32px rows, facet counts everywhere, inline bar charts inside
  table cells, legends carry Avg/Min/Max/Sum/Value columns.
- **Widget chrome**: every widget has a header row (title left, timeframe pill + fullscreen/
  share/kebab icons right) on a hairline-bordered card.

---

## Full pages / explorers

### `dashboard-rum-out-of-box.png`
Out-of-the-box RUM dashboard. Template-variable dropdown strip across the top
(viewName, country, browser, deviceType, env, version…), global time selector top-right,
`ON High Density Mode` toggle, `Events & Logs` overlay button. Body = 12-col grid with
named **group containers** ("Overview", "XHR and Fetch Analysis (past 4 hours)",
"Core Web Vitals") that collapse. Left column = image + free-text description block.
Mix of query values (`219.24k`, `2.53s`), timeseries, top lists with inline bar cells,
and a summary-stats legend (Tags | Avg | Min | Max | Sum | Value).
**Transferable**: grouped sections with headers; template vars as global filters;
top-list rows double as bar gauges; per-widget timeframe badge (`4h`) when it differs
from global time.

### `monitor-list.png`
Monitor List page. Search bar with rendered `muted:true` token + `</>` raw-query toggle.
Left facets: Status (Triggered/Alert/Warn/No Data/OK with counts), Muted, Draft Status,
Priority, Type. Result table: checkbox column, STATUS pill (green `OK`, red `ALERT`,
amber `WARN`), muted-elapsed/muted-left columns with bell icons, truncated NAME,
TAGS as chips (`env:prod`, `d… +1` overflow chip), avatar+count column, and a
column-visibility gear dropdown. Bulk-action bar (Mute, Resolve, Delete, Edit Tags,
Edit Recipients NEW, Edit Teams, Export to Terraform) appears above results.
**Transferable**: status pill column first; facet counts; bulk actions revealed on
selection; `+N` overflow chips for tags; column-visibility control.

### `monitor-status-page.png`
Single-monitor status page. Header: red `ALERT` pill + "Monitor status since 1 minute ago"
+ timestamp; title below; `Mute`/`Resolve`/cog right. Properties card shows the query in a
monospace boxed string and the notification message template (`{{host.name}}` vars visible).
Status count chips act as filters (`Alert 1`, `Warn 0`, `No Data 0`, `OK 2`).
**Group status** = the standout pattern: each host is a row of contiguous colored
timeslots (red/green/amber/gray/striped-muted) — a status-timeline raster, not a line
chart. Below: a history timeseries with a dark draggable zoom brush, an **evaluation
graph** with shaded red (`>6`) and amber (`5<x<6`) threshold bands, then an Events feed
with tag chips and embedded mini-graph.
**Transferable**: status-timeline raster per entity; shaded alarm bands behind the
trend; explicit threshold annotations (`> 6`); separate "evaluation" vs raw-data views.

### `monitor-status-groups.png`
Same status page zoomed: per-group status rasters with legend
(Alert red, OK green, No Data gray, Warn amber, Muted striped), each row with VALUE and
UPTIME % columns, "View all" subgroup drill-down.
**Transferable**: legend for raster colors; uptime% as a compact derived KPI; muted
shown as hatch pattern — a non-color encoding worth copying for "suppressed/ shelved"
alarms under ISA-101 where color is reserved.

### `logs-explorer.png`
Log Explorer — canonical **list + density** pattern. Top: Views/Save controls + time
selector + live-tail pause. Search field with `key:value` tokens. "Group into"
Fields/Patterns/Transactions tabs + "Visualize as" List/Timeseries/Top List/Table/
Tree Map/Pie Chart switcher. A **histogram banner** (~60px tall, count-scaled bars with
red error caps) sits between controls and results — dense event-volume-over-time.
Left facet tree (Index, Source, Host, Service, Status) with checkboxes + counts
(`1.08G`, `708M`). Result table: ms-precision timestamp, host, service, content with
inline syntax highlighting (`Got message: MSG`). Watchdog Insights banner row
(pink dashed border) above the table: `5 Log anomalies`.
**Transferable**: density histogram above a list = instantly scannable event load;
facet checkboxes w/ counts; row status color only as a thin left edge stripe;
watchdog-style anomaly banner could become an "abnormal condition summary" strip.

### `containers-explorer.png`
Containers Explorer — htop-style live table. `LIVE` green pill + clock top-right,
Filter field + `Group by` facet selector side by side. Collapsible **Summary Graphs**
strip (Total CPU % and RSS Memory small-multiples) above the table. Left facets:
resource type (Processes/Containers/Pods), Cluster Name, Namespace with counts.
Table rows: k8s icon, container name, `UP` green pill, image ref, and numeric columns
where **each cell embeds a horizontal bar** (Total CPU %, RSS Memory, Bytes Sent).
`Showing 1–50 of 5K matching containers` + Display Options + Customize.
**Transferable**: in-cell bars give magnitude without a separate chart; summary strip
above the table keeps aggregates visible while scrolling rows; LIVE indicator pattern.

### `containers-filtered.png`
Containers view filtered to one cluster (25 nodes); RSS vs provisioned-limit columns
show over-provisioning at a glance via bar cells.
**Transferable**: comparison columns ("used vs allocated") as paired bars.

### `containers-scatterplot.png`
Same explorer switched to Scatter Plot mode — each dot a container, axes selectable.
**Transferable**: alternate analytic view over the same filtered dataset; cheap
mode-switch pattern (Timeseries | Scatter tabs).

### `apm-service-page.png`
APM Service page — the richest page-type. Dark icon rail; secondary nav (Service
Summary, Resources, Deployments `1 faulty` pink badge, Dependencies, Infrastructure…
Security `7 Crit`); scope chips row (env:prod, cluster-name:*, version:*); then a
**full-width segmented health bar**: red `ALERT: 75 Monitors` | amber `WARN: 7` |
gray `NO DATA: 2` | green `OK: 89 Monitors, 2 Synthetic Tests` — proportional widths.
Watchdog Insights strip (dashed pink border, `10` count chip). Summary cards row:
Deployments / Error Tracking (`33 ISSUES`, `Error Rate: 7.07%`) / SLOs (`24 BREACHED`,
`28 OK`, `10 NO DATA`) / Incidents (`12 ACTIVE`) / Security (`7 SIGNALS`,
`Vulnerabilities: 0`) — cards with problems get red left borders/accents.
Below: 2-col graph grid, each card with a dropdown metric selector in its header
("Requests and Errors ▾ 361k total (100 req/s)"), stacked bars with red error layer,
percentile legend (p50/p75/p90/p95/p99/Max), event-overlay vertical markers on the
latency chart with a highlighted range selection.
**Transferable**: aggregated health bar as a single-glance header; per-card metric
dropdowns keep grid compact; red-bordered summary cards only when attention needed.

### `apm-service-health.png`
Service health banner + dependency mini-map: `Critical`/`Warning`/`OK` rollup combining
monitors+incidents+anomalies into one state.
**Transferable**: multi-signal → single health state rollup (ISA-101 compatible:
one acknowledged-abnormal indicator per asset).

### `apm-service-monitors.png`
"Service monitors" panel: proposed/active monitor list with status pills and
one-click enable — monitor-as-list-item with state color.
**Transferable**: alarm/ interlock list pattern with enable affordance.

### `apm-summary-cards.png`
Zoom of the card row: uniform card size, icon+label header, big status number,
red accent only on breached items.
**Transferable**: equal-width KPI card strip; restrained use of accent borders.

### `service-map.png`
Service Catalog map view: left facets (Service Origin, Telemetry Type, Type, Infra Type
with counts), center canvas of circular service nodes connected by directional edges,
**node ring color = health** (green/red/yellow borders, white interior, small type icon
inside), cluster hulls around related nodes, count badges on grouped nodes (`3`, `7`,
`48`). Yellow info banner top ("new Service Map layout…"). Right inspector panel for
the selected node: status segmented bar, Team/Contacts/Source Code links, Deployments,
Error Tracking, SLOs (`22 BREACHED`), Incidents list with SEV chips
(`SEV-1 (Critical)`, `SEV-2 (High)`), and mini metric graphs.
**Transferable**: color ONLY on the ring, not filled node — color stays legible at
small size and reserves fill for hover/selection; inspector side panel pattern for
drill-down instead of navigation away.

### `service-map-inspect.png`
Focused single-service view: neighbors dimmed, upstream left → service center →
downstream right. Layout encodes directionality.
**Transferable**: "focus mode" that isolates one entity and orders context by
causality — maps directly to unit → equipment → loop hierarchies in a P&ID-style
overview.

### `incident-timeline.png`
Incident page Timeline tab: chronological event feed, flag icon to mark an event
Important, editable timestamps, typed events (Impact added, note, field update).
**Transferable**: event journal with per-event "important" flag ≈ operator logbook /
alarm journal significance marking.

### `notebook-slash-menu.png`
Notebook editor: document canvas with slash-command palette listing insertable cell
types (graphs of every widget type, text, table, image).
**Transferable**: narrative + live data in one document — postmortem/shift-report
layout precedent; slash-menu for inserting blocks.

---

## Widgets

### `widget-timeseries.png`
Single-series line graph (`avg system.cpu.user`), title + timeframe pill header,
minimal axes, light gridlines.
**Transferable**: restrained axis chrome; header pill shows deviation from global time.

### `widget-timeseries-dual-axis.png`
Two metrics on one graph: purple left axis (system.uptime), orange right axis
(system.disk.used); each side's ticks colored to match its series.
**Transferable**: axis-tick color-coding solves dual-axis ambiguity — directly
usable for e.g. flow + pressure on one trend.

### `widget-timeseries-event-overlay.png`
Timeseries with vertical event markers (deploys/alert events) and shaded overlay
bands correlating events to metric behavior.
**Transferable**: overlay operational events (batch steps, mode changes, trips) on
process trends — high value for HMI context.

### `widget-top-list.png`
Top-list editor view: query config left, live preview right; stacked vs flat display
mode, relative/absolute toggle, Visual Formatting Rules.
**Transferable**: ranked horizontal bars with conditional color thresholds.

### `widget-table.png`
Table widget, "Cluster Costs Past 1 Month": uppercase headers, sort indicator, left
identifier column, right-aligned numerics, **two conditional-format idioms** — whole
cell tinted (light green/amber bg) AND a separate column of embedded horizontal bars
(green/amber fill vs gray track). Timeframe pill `1mo` top-right.
**Transferable**: tinted-cell + bar-cell redundancy means state survives grayscale/
projector washout — good for control-room displays.

### `widget-table-trend-cells.png`
Table with `trend` cell display mode: sparkline-in-cell (area/line/bars variants).
**Transferable**: sparkline cells compress history into a dense alarm/loop table.

### `widget-alert-value.png`
Three alert-value tiles: giant value centered on saturated background
(green `0.00` OK / red `3.85` ALERT / amber WARN), title below or above.
**Transferable**: full-bleed status tile — the closest thing to an ISA-101 alarm
indicator in Datadog; note they still keep title text readable (white on saturated bg).

### `widget-check-status.png`
"Agent Up" check-status: enormous white `12216` on solid green panel, header strip
with title above. Maximum glanceability, zero decoration.
**Transferable**: count + color only; no chart junk. ISA-101 would *replace* the
saturated fill with a neutral tile + colored status stripe — see final section.

### `widget-slo-list.png`
SLO list: type icon, name (truncated), time-window chip (`30d`, `7d` gray pill),
target %, STATUS as green-tinted pill (`100.00%`), ERROR BUDGET LEFT column with
percentage + inline bar.
**Transferable**: pill-in-cell status + budget bar — compact objective-tracking row
pattern (usable for production targets/KPIs).

### `widget-list.png`
List widget (error-tracking issues): compact rows, severity glyphs, count + tiny
volume sparkbar per row, facet-style column headers.
**Transferable**: feed-style rows with per-row micro-viz.

### `widget-heatmap.png`
Heatmap of host CPU over time: time × value-bucket grid, cell intensity = host count,
blue mono palette + magenta accent for the hovered bucket; tooltip reads
`17 hosts / 19.87% to 22.7%`; widget header with fullscreen/share icons + `1w` pill.
**Transferable**: mono-hue intensity scale reads cleanly; tooltip carries the exact
numbers — don't encode precision in color.

### `widget-hostmap.png`
Host-map widget embedded in a dashboard: hexagon tiles grouped into pastel-tinted
AZ panels, tile fill = metric value on a green→amber→red ramp, legend bottom-left
(`0.047% → 105.15%`), right-edge zoom rail (+/−/frame/slider).
**Transferable**: grouped tile overview scales to hundreds of entities; continuous
ramp + explicit legend; thin zoom rail keeps canvas clean.

### `query-value-change.png`
Query value with change indicator: `$148.7k` huge, `↑27.9%` in red with period
reference `vs Sep 1–9`, faint gray bar backdrop showing context.
**Transferable**: value + delta + comparison window label; muted background bars give
shape without competing with the number.

### `query-value-formats.png`
Editor "Visual Formatting Rules": `If value is > 3 → show with Custom image`, and the
resulting widget (big number over a photo background w/ min/max annotations `67.6k`,
`3.9k`).
**Transferable**: rule-builder row pattern (condition → presentation); also a cautionary
example — image backgrounds hurt readability (see below).

### `hostmap-landing.png`
Full Host Map page: question-style header ("What is the CPU usage across my
infrastructure?"), toolbar of Fill by / Group by / Filter dropdowns with a live
min–max ramp legend in the fill control, pastel group panels of hexagons, right-edge
zoom rail.
**Transferable**: the toolbar *is* the query builder — every control visible, no
hidden state; group panels tinted (not outlined) to cluster without heavy borders.

### `rum-performance-summary.png`
RUM Performance Summary: tab strip (Performance Monitoring / Session Replay / Error
Tracking…), filter dropdown row, **treemap** of pages block-colored by Core Web Vitals
threshold (green Good ≤2.5s / amber Needs improvement / red Poor >4s) with counts, and
a "Optimize Vitals" card row — each card: metric name, big value, delta %, and a
sparkline **with good/warn/poor horizontal threshold bands**.
**Transferable**: threshold-banded sparkline cards (exactly the ISA-101
normal-range + limit-band idea); treemap groups by qualitative state, not continuous
color.

### `create-dashboard.png`
"Create a Dashboard" modal: name field, three layout choices as radio-cards with
miniature layout glyphs (grid / automatic / freeform) + one-line descriptions +
primary button each.
**Transferable**: option cards with schematic previews — good pattern for our own
"new display" flow.

---

## What Datadog does that we should / shouldn't copy for an ISA-101 industrial HMI

Constraints: alarm colors reserved (ISA-101 gray-scale background, color = meaning),
dark-first, IBM Plex (Sans/Mono), no engagement loops, operators not "users".

### Copy

- **Global scope bar**: template-variable chips + time selector + live/pause controls
  pinned top. Maps cleanly to Area/Unit filters and a shift-relative time window.
- **Status-timeline raster** (monitor-status-page): per-equipment row of contiguous
  state blocks is arguably better than a trend for alarm/operating-mode history.
  Pair it with a muted = hatch pattern for shelved alarms instead of a color.
- **Segmented health bar** (apm-service-page): ALERT/WARN/NO DATA/OK proportional
  strip = perfect "unit alarm summary" header. Under ISA-101 use the reserved alarm
  palette only for real abnormal states; NO DATA → distinct "comm loss" treatment.
- **In-cell bars and sparkline cells** (containers-explorer, widget-table,
  widget-slo-list): dense tabular process data with magnitude bars. Keep bars
  neutral (single hue); let only the alarm column carry reserved color.
- **Threshold-banded trends** (rum-performance-summary cards, monitor evaluation
  graph): shaded normal/limit regions behind the trend = the ISA-101 "operating
  envelope" analog. Copy with muted band fills.
- **Facet counts + search tokens**: `key:value` tokenized search and checkbox facets
  with counts translate to tag/area/equipment-type filtering in alarm and asset lists.
- **Inspector side-panel** (service-map): click an entity → right rail with health,
  sub-alarms, mini-trends. Avoids page navigation during abnormal situations.
- **Event overlay markers** on trends: batch/phase/trip events as vertical markers —
  high operator value, zero cost to palette.
- **Widget header discipline**: title left, timeframe-deviation pill + actions right.
  Adopt verbatim.
- **Colored axis ticks for dual-axis trends**: cheap fix for the classic two-scale
  ambiguity problem on process trends.

### Don't copy (or adapt heavily)

- **Saturated full-bleed status fills** (check-status green panel, alert-value tiles):
  ISA-101 reserves saturated color for alarm states; a green wall tile for "OK" burns
  the palette and pumps light into a dark control room. Use neutral tile + status
  stripe/text; keep large numerals.
- **Continuous green→amber→red ramps** (host map fill, treemap): continuous color
  implies a gradient of urgency and conflicts with discrete alarm priority. Use
  single-hue intensity for magnitude and *discrete* reserved colors only for states.
- **Light theme**: all reference shots are light. We must re-derive every pattern
  dark-first — hairlines become lighter strokes, tints become ~8–15% overlays, text
  contrast re-checked at distance.
- **Typography**: Datadog uses a geometric sans + system mono. Substitute IBM Plex
  Sans for UI text and **IBM Plex Mono for all numeric/tag/query values**; keep their
  uppercase-microheader and tabular-figure conventions.
- **Engagement/popularity mechanics**: popularity bars, favorites, "most viewed",
  marketing banners, learning-center CTAs, `NEW` feature badges — none of this belongs
  in an HMI. Strip entirely.
- **Purple/blue categorical palettes** for series: fine on desktop SaaS, but in a
  dark HMI keep categorical series muted and low-saturation so alarm colors always
  win attention.
- **Custom image backgrounds on widgets** (query-value-formats): decorative
  backgrounds behind values are a readability hazard — disallow.
- **Hover-dependent information** (heatmap tooltips, hover-only actions): operators
  on touch/wall displays can't hover — surface the equivalent on tap/selection and
  keep critical values always visible.
- **Free-form screenboard layout**: pixel-perfect freeform invites inconsistent
  displays; keep the strict 12-col snap grid only.
- **Anomaly/"Watchdog" auto-insights banners**: concept is fine (abnormal-condition
  summary), but don't replicate the pink marketing-styled banner — render as a
  neutral informational strip, never competing with alarm color.
