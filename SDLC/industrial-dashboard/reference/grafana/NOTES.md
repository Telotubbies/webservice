# Grafana — Reference Screenshots & Design Analysis

Real product screenshots pulled from official Grafana documentation
(`grafana.com/static/img/docs/...` and `grafana.com/media/docs/...`, sourced from
the `grafana/grafana` docs sources on GitHub). Grafana v11–v13 era UI, dark theme
(Grafana's default). All files verified as real images ≥ ~32 KB.

## Per-image inventory

### Full product / navigation

| File | What it shows | Patterns worth noting |
|---|---|---|
| `dashboard-overview-annotated.png` | Complete Grafana v13.1 dashboard ("Population stats") in dark mode. Top bar: breadcrumb (`Dashboards › Population stats`), favorite star, Public badge, global search (⌘K), invite button. Second bar: variable dropdowns, ad-hoc filter chips (`+ label = value`, `Group by:`), dashboard links, time picker (`Last 6 hours GMT`) with zoom-out/refresh/share/edit controls. Panels grouped under a named row ("Population") with tabs (`1980-2020`, `1900-1979`) — active tab underlined in orange accent. | Two-tier chrome: global nav, then context controls. Time range is a single prominent chip with relative range + timezone. Panels are cards with ~8px radius, thin 1px borders on a slightly lighter surface than the app background. Right-edge icon rail for panel-level tools. |
| `explore-split-view.png` | Explore mode split into two side-by-side panes (metrics query left, Loki logs right). Each pane is fully self-contained: own datasource picker, query editor, run button, visualization + table/logs result stack. Toggle chips (`Lines / Bars / Points / Stacked lines / Stacked bars`), toggle switches for log options, Builder/Code switch. | Side-by-side comparison as first-class pattern. Each pane = complete mini-workflow (query → visualize → inspect). Pill/segmented controls for mutually exclusive options; real toggle switches for boolean options. Logs panel exposes lots of inline toggles — information-dense but grouped. |
| `alerting-rules-list.png` | Alert rules list, grouped view: folder → evaluation group → rule rows. Each rule row: state icon (green check circle = normal, yellow ! = pending, red circle = firing), rule name, summary line with template text, label chips (`1 label`, `3 labels`, `1 instance`), inline Edit/More actions. Overflow menu shows Pause evaluation / Silence notifications / Duplicate / Copy link / Export / Delete (Delete in red). | State encoded by small icon + color, not full-row background — row stays neutral dark. Destructive action (Delete) is the only red text in a neutral menu. Hierarchical grouping (folder/group/rule) gives scannable structure. |

### Visualization panels

| File | What it shows | Patterns worth noting |
|---|---|---|
| `panel-timeseries-v12.png` | Time series panel v12: multi-series line chart on dark card, legend, axes. | The workhorse viz. Subtle grid lines, colored series lines at consistent stroke width, legend doubles as series selector. |
| `panel-gauge-v13.png` | Three radial gauges side by side (A/B/C-series). Gradient-filled arc (green→yellow→red thresholds), big numeric value centered (~3–4× label size), series name below in dimmed text, tiny sparkline under each value. Threshold bands rendered as arc segments. | Radial gauge + sparkline combo. Value is dominant; unit/name subordinate. Threshold gradient baked INTO the arc — color communicates state continuously, not only at alarm. |
| `panel-bar-gauge.png` | Multi-row horizontal bar gauges, each labeled, filled proportionally. | Linear alternative to radial gauge — more space-efficient, easier to compare many values. Bars left-aligned labels, right-aligned values. |
| `panel-stat-multiple.png` | Grid of 6 stat cells ("House locations"). Each cell: label top-left, huge number, unit subscripted, sparkline area fill along bottom. **Entire cell background is threshold-colored** (reds/oranges). | Stat = biggest-type-size number on the dashboard. Sparkline adds trend context at near-zero cost. Full-bleed colored background = Grafana's aggressive use of color for status. |
| `panel-table.png` / `panel-table-v11.png` | Table visualization — header row, striped cells, per-cell background coloring by value/threshold, column sorting. | Tables support cell-level conditional formatting (background pills). Dense but readable; header slightly lighter surface. |
| `panel-state-timeline.png` | State timeline: Server A/B rows, contiguous color blocks (green Up, red Down, orange Warning) spanning time on x-axis, state name inscribed inside each region, shared legend + time axis. | Discrete-state-over-time encoding. Regions merge consecutive equal states. Color IS the data channel — the primary place Grafana's palette aligns with alarm semantics. |
| `panel-state-timeline-v11.png` | Additional v11.4 state timeline example (denser state regions). | Same encoding at higher data density — thin slivers still readable thanks to saturated fills + gaps for nulls. |
| `panel-status-history.png` | Status history: SensorA/SensorB rows of discrete boxes (green True / red False), one box per evaluation interval, value text inside each box, irregular time axis ticks. | Unlike state timeline, does NOT merge consecutive values — every interval gets a box, so periodicity is visible. Nulls render as gaps. |
| `panel-node-graph.png` | Node graph in grid layout: circles sized by metric, ring split into Success (green) / Errors (red) arcs, two stats inside each node, title+subtitle below. Legend bar at bottom (`Transactions per second ↓`, `Average duration`, Success/Errors swatches), zoom +/- buttons bottom-right. | Radial arc on node edge encodes composition (success vs errors) — double-encoding: ring color + node fill for worst offenders. Size encodes volume. Layout switch between graph/grid. |
| `panel-geomap.png` | Geomap with marker layers over a basemap. | Layered map: basemap + data layers (markers, routes, heatmap, networks). |
| `geomap-dark-basemap.png` / `geomap-light-basemap.png` | Same data on CARTO dark vs light basemaps. | Grafana supports both themes; dark is default and clearly the primary design target. On dark basemap, saturated data colors pop harder — relevant for control-room display. |
| `panel-bar-chart-v11.png` | Bar chart with categorical x-axis, colored bars. | Per-bar or per-threshold coloring. |
| `panel-pie-chart-v11.png` | Pie/donut chart with legend and labels. | Proportion viz; donut variant shows center total. |
| `panel-heatmap.jpg` | Heatmap panel: 2D color-intensity grid over time. | Color ramp encodes magnitude — one of few places a continuous ramp (not threshold steps) is used. |

### Alerting

| File | What it shows | Patterns worth noting |
|---|---|---|
| `alerting-rule-editor.png` | Alert rule definition UI: query section with datasource picker, expression/condition blocks, threshold input with preview. | Rule config is a vertical form with collapsible sections (query → condition → evaluation → labels → notifications). |
| `alerting-notification-policies.png` | Notification routing diagram: default policy → child policies matched by label matchers (`team=operations`, `severity`), routing example alerts through the tree. | Tree-structure routing; child policies override/inherit parent contact point, grouping, timing. |
| `alerting-notification-inheritance.png` | Same policy tree showing contact-point inheritance from parent to children. | Inheritance avoids re-specifying contact points; "Continue matching siblings" escape hatch. |
| `alerting-saved-searches.png` | Saved-search dropdown on the alert rules list. | Filter state can be named, saved, and set as default view — useful for large alert volumes. |

## Transferable design patterns

1. **Two-tier chrome.** Slim global top bar (breadcrumb, search ⌘K, global actions) + context bar directly under it (variables/filters left, time picker + refresh + share + edit right). The time picker is always the visual anchor of the context bar.
2. **Card-on-dark layering.** App background is the darkest surface (~#111217); panels sit on a slightly lighter surface (~#181b1f) with a 1px border and ~8px radius. Three surface levels max: app, panel, raised controls.
3. **Type hierarchy inside panels.** Panel title small/medium weight; the data does the talking — stat values are 3–4× the label size; units rendered smaller/dimmer next to the number.
4. **State icons > colored surfaces (in lists).** Alert rule rows keep neutral backgrounds; a small colored icon (check/!/dot) carries state. Only the destructive menu item is red.
5. **Legend as control.** Legends aren't just keys — they filter series, sort node-graph nodes, and toggle y-axes.
6. **Sparklines as ambient context.** Stat and gauge panels embed micro-trendlines behind/under the headline value — trend context without extra panels.
7. **Discrete state grids.** State timeline (merge consecutive) vs status history (box per interval) are two complementary encodings for the same data — great fit for equipment state monitoring.
8. **Progressive disclosure.** Explore and the alert-rule editor stack collapsible sections; panel chrome (menu, links) only appears on hover/focus.
9. **Keyboard-first ops.** `?` shortcut overlay, ⌘K command palette, `d+k` kiosk mode, panel hotkeys — kiosk mode exists specifically for control-room wallboards.
10. **Filter chips + saved searches.** Ad-hoc label filters render as chips near the top; saved searches make filtered alert views persistent.

## Grafana vs our Mission Surface direction

| Aspect | Grafana | Mission Surface (industrial / ISA-101) |
|---|---|---|
| **Primary use of color** | Liberal. Thresholds paint entire stat-cell backgrounds, gauge arcs are green→red gradients, table cells get colored pills, series get a wide categorical palette (green/yellow/blue/red side by side — see `panel-stat-multiple.png`, `dashboard-overview-annotated.png`). | Alarm colors **reserved for alarms only** (ISA-101 / high-performance HMI). Normal state = neutral gray; data series = muted, distinguishable hues that do NOT read as alarm colors. Red means "act now," never "series #4." |
| **Background encoding of severity** | Stat panel's full-bleed red/orange backgrounds make every elevated metric look like an alarm — desensitizing in a plant context. | Colored surfaces only for acknowledged/unacknowledged alarms; normal KPI tiles stay dark-neutral with thin borders. |
| **Gauge philosophy** | Radial gauge with saturated threshold gradient is Grafana's signature "single value vs range" widget. | Prefer bar/indicators with subtle threshold *markers* (tick lines), not filled alarm-colored zones; color appears only when a limit is actually violated. |
| **Dark theme** | Dark is default and well-executed: ~#111217 app bg, ~#181b1f panels, near-white text, thin borders, low-luminance chrome. Directly aligned with control-room practice. | Same direction — adopt Grafana's surface/luminance discipline almost verbatim, but with IBM Plex Sans/Mono type. |
| **Typography** | Inter; sentence case; medium-weight titles; monospace only in code/query areas. | IBM Plex Sans for UI/labels, **IBM Plex Mono** for all numeric readouts, setpoints, timestamps, units — numbers must be tabular and monospaced for scan alignment in columns. |
| **Alarm language** | Red/yellow/green used both for health AND for arbitrary thresholds and categorical series — semantically overloaded. | Strict lexicon: red = unacknowledged alarm; amber/orange = acknowledged alarm or warning; green reserved for "in service / running" where conventional; cyan/blue = selected or informational. |
| **Density** | Moderate density; generous padding; panels designed for glanceability on TVs (kiosk mode). | Higher density tolerated (operator stations), but keep Grafana's rule: one visual hierarchy — big numbers, small labels, minimal chrome. |
| **Alert list semantics** | Alert list panel shows firing/pending/normal inline on dashboards — close to an alarm banner concept. | Adopt the pattern but per ISA-18.2: include acknowledged state, priority ordering, and shelving — richer than Grafana's list. |
| **Where Grafana is a good model** | Surface elevation, panel card geometry, time-picker chrome, explore split panes, state timeline/status history encodings, node-graph ring composition, legend-as-control, kiosk mode. | Borrow freely. |
| **Where to deliberately diverge** | Threshold-gradient arcs, full-bleed colored stat tiles, categorical palette that includes alarm hues, and colored backgrounds for anything that isn't an alarm. | Keep chrome dark and quiet; let alarm colors stay rare so they retain meaning. |
