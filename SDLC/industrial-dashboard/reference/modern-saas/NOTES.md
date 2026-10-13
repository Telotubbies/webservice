# Modern SaaS Interface Reference — Design Pattern Notes

Real product screenshots pulled from official docs/marketing CDNs (2024–2026 state of the art).
Sources: docs.github.com / github/docs repo, docs.sentry.io, vercel.com docs (vercel-storage blob CDN),
linear.app changelog (webassets.linear.app), docs.planetscale.com, posthog.com (Cloudinary),
grafana.com, docs.honeycomb.io (mintcdn), docs.railway.com (Cloudinary), atlassian.com/statuspage (wac-cdn),
docs.stripe.com (b.stripecdn.com).

---

## Per-image notes

### `linear-initiatives-dark.avif` — Linear, Initiatives list (dark)
Linear's classic dark chrome: near-black app background, slightly raised content surface, 13px-class dense table.
Grouped rows (project name + health pill like "On track"/"At risk"/"Off track" in green/yellow/red outline badges),
tiny priority-bar glyphs, stacked avatar chips, thin horizontal separators only. Tabs ("Overview / Projects / ...")
as quiet text tabs, not boxed. **Transferable:** status pills as outlined chips with a colored dot, row height ~32–40px,
icon+text metadata columns right-aligned.

### `linear-agent-panel-dark.avif` — Linear, AI/agent side panel over document
A right-hand contextual drawer slides over a dimmed document canvas. The panel is a distinctly *different* surface
tone than the canvas beneath (layering by luminance, not by border alone). Assistant replies in a contained card,
small monospace-ish metadata, a subtle "Highlight changes" toggle control. **Transferable:** contextual tooling
lives in overlays/drawers, not new pages; dimming the base canvas keeps spatial context.

### `vercel-deployments-dark.png` — Vercel dashboard, deployment resources (dark)
Full-app dark chrome: narrow top bar, left nav collapsed to a slim strip, main content on near-black (#000-#0a0a).
Cards are *bordered, not filled* — the signature Vercel/Geist look: `1px` hairline borders (`rgba(255,255,255,0.1)`),
transparent card backgrounds, 6–8px radii. Geist typeface, generous letter spacing on all-caps section labels,
muted gray secondary text (#888/#999). **Transferable:** border-defined surfaces instead of fill-defined; single
accent color (white for primary action, blue links only when interactive).

### `vercel-observability-dark.png` — Vercel Observability tab (dark)
Monitoring view: stat header row ("Errors", "Timeouts") with big light numerals + small colored delta dots, then a
step-chart area, then a dense log table using a monospace font for resource paths and colored status dots.
Minimal chrome — almost no decorative color; data itself carries the color. **Transferable:** number-first stat
cards; mono font for identifiers/URLs; status communicated by dots + muted red/amber, not alarm-red floods.

### `vercel-error-rate-dark.png` — Vercel Error Rate metric card (dark)
Single metric tile: label top-left, two series stats top-right (dot + value, `%` formatted), sparse chart with
visible gridlines only where needed, hover state shows a floating tooltip card with time range and a "Zoom In"
action. **Transferable:** charts explain themselves — legend is *inside* the card header; tooltip is actionable
("Zoom In"), not just informational; Y-axis only shows 2–3 tick labels.

### `github-projects-table.png` — GitHub Projects, table view (light)
Dense editable table with grouped sections (collapsible group headers with count chips), inline editable cells,
label pills with soft pastel backgrounds (light theme token colors), numeric fields right-aligned, a column of
segmented progress bars. Filter query bar on top with `is:open` token syntax shown as colored tokens.
**Transferable:** query-as-tokens filter bar; group headers with counts; progress as multi-segment bars.

### `github-projects-board.png` — GitHub Projects, kanban (light)
Column board: columns headed by status name + count + estimate, cards are compact — title line, issue number in
mono, label pills, avatar cluster. A long horizontal ribbon of view tabs (saved views) above the board, plus a
filter token bar (`cycle:@current` in purple). **Transferable:** saved views as a tab strip; card chrome reduced
to title + 1–2 metadata rows; column headers carry counts and WIP-style numbers.

### `sentry-issues-list.png` — Sentry Issues stream (light)
The archetypal triage list: leftmost column is a slim icon rail, then a search/filter bar spanning the width.
Each row: severity color square, bold issue title, secondary line with project badge + location + counts, a
sparkline of event volume, "last seen" relative time, events/users counts right-aligned. Tabs for
Unresolved/For Review/Regressed/Archived. **Transferable:** sparkline-in-row for trend-at-a-glance; severity as a
small colored square (not a full-width strip); every row answers *what/where/how much/when* in one glance.

### `sentry-issue-levels.png` — Sentry row detail (level tooltip)
Close crop of rows: color-coded level bar (orange "Error") + tooltip chip "Level: Error", mono-ish issue titles,
project icon chips, sparkline with "Ongoing"/"Escalating" caption, assignee dropdown chip ("AT" initials in a
green rounded rect). **Transferable:** escalation state as a caption under the sparkline; severity legend lives
in the element itself via hover, not a page-level legend.

### `grafana-dashboard.png` — Grafana dashboard (dark)
The industrial-adjacent baseline: pure-dark dashboard of tiled panels — time series, gauges, stat tiles — on a
uniform dark background; each panel is a bordered region with a small title bar; grid layout is strict and
repeating. Colors used sparingly per-series (green/blue/amber/red for thresholds). **Transferable:** panel-grid
regularity, threshold colors, and the fact that dense grids stay readable when every panel uses the *same*
internal padding and title style. **Caution:** Grafana's rainbow palette per-series is more than needed.

### `posthog-trends-dark.png` — PostHog Trends insight (dark)
Dark analytic view: breadcrumb-ish title row ("PostHog / App + Website / Product analytics"), editable insight
title, description line, "Last modified" relative timestamp, toolbar with "Last 90 days" + "Add to notebook" +
notification badge + Edit button. Graph area dark navy; table below with checkboxes and colored series.
**Transferable:** self-describing saved-object chrome — title, modified time, actions — all in one header band.

### `posthog-funnel-dark.png` — PostHog funnel (dark)
Funnel insight: numbered step rows beneath the chart with person counts and conversion percentages, hatched
ghost bars projecting drop-off between steps, conversion rate + avg time as headline stats. **Transferable:**
hatched/outline fill for "projected/missing" state vs solid fill for actuals — a great vocabulary for
estimated vs measured industrial values.

### `posthog-analytics-dark.png` — PostHog stacked area (dark)
Dense stacked-area chart with dozens of series; still legible because chrome is minimal: only range picker,
"grouped by" select, chart-type select, "Computed 4 minutes ago · Refresh" provenance line. **Transferable:**
data-freshness provenance ("computed N min ago") is first-class chrome — essential for control-room trust.

### `planetscale-dashboard-dark.avif` — PlanetScale console home (dark)
Full dark console: slim top breadcrumb ("org / project"), left icon+label nav, main area split into a network/
topology diagram card, stat cards row (connections, storage, latency), an area latency chart, and an activity
feed list on the right. Deep charcoal surfaces with slightly lighter cards; green/teal accents for healthy
metrics. **Transferable:** dashboard = topology + stats + activity feed triptych; activity feeds are terse
one-liners with relative timestamps.

### `railway-dashboard.png` — Railway project dashboard (dark)
Card-grid project overview on dark chrome: each service is a card with a status dot, name, repo, and deployment
state; a "Latest Activity" panel lists deployments with avatars and times. **Transferable:** entity cards that
double as nav targets; deployment/activity log as a first-class column.

### `railway-project-canvas.png` — Railway canvas view (dark)
Freeform topology canvas: dark background, service nodes as rounded tiles with status dots and small metrics,
edges drawn as connections; right-side "Latest Activity" panel. Feels like an ops map. **Transferable:** for a
control room, a spatial canvas of machines/lines/PLCs with status dots is the single most direct pattern;
nodes are tiles, not icons-in-circles.

### `honeycomb-trace-detail.png` — Honeycomb trace waterfall (light)
Trace waterfall: left = span names in a tree, right = horizontal duration bars color-keyed by service; a row
expands to show field table (key/value). Header toolbar carries query chips. **Transferable:** waterfall layout
for sequences/jobs; expand-in-place row detail instead of drill-down navigation.

### `statuspage-components.png` — Statuspage component list + uptime bars
Component rows each showing current status label ("Operational" green, right-aligned) and a 90-day uptime bar —
a strip of ~90 vertical ticks, green normally, amber/red on incident days. Hover shows per-day status.
**Transferable:** the 90-tick uptime bar is the single most compact long-horizon health visualization; perfect
per-machine/per-line widget. Status words are plain text labels, not icons alone.

### `statuspage-uptime.png` — Statuspage uptime calendar view
Grid of day-squares across months, green nominal, amber/red for incidents, with date axis. Similar vocabulary
to GitHub's contribution graph. **Transferable:** calendar heatmap for long-history availability per asset.

### `stripe-payments-hero.png` — Stripe Checkout page
Real Stripe UI: split layout, dark left panel (order summary) + white right form panel; form fields with floating
labels, generous input padding, one primary CTA. Illustrates Stripe's restraint: two surfaces, zero decoration.
**Transferable:** high-trust forms = two-tone split, big click targets, minimal ornament. (Least relevant to
control room; kept as typography/form reference.)

---

## Cross-cutting patterns observed

**Navigation**
- Dominant 2024–2026 pattern: **slim left icon rail or narrow sidebar + optional top breadcrumb bar** (Sentry, PlanetScale, Linear, Vercel). Topnav-only layouts are marketing sites, not tools.
- Breadcrumb trails at content top (PostHog, PlanetScale) replace heavy page titles.
- Saved views/filters as a **tab strip directly above the data** (GitHub Projects, Sentry tabs) — "views as first-class objects."

**Command palettes**
- Linear's agent drawer + the ubiquity of `Cmd+K` (Linear, Vercel, GitHub `cycle:@current` token search): the palette is an *overlay*, results are rows with icons + keyboard hints. GitHub's tokenized filter bar (`is:open`, `cycle:@current`) is the same idea embedded inline.

**Data-dense tables**
- Row heights 32–40px, 13–14px body type, single hairline separators, no zebra striping.
- Right-aligned numeric columns; mono font for IDs/paths; icons used as *column type* indicators.
- Group headers with counts; severity is a small colored square/dot, never a full tinted row.
- Sparklines inside rows (Sentry) replace separate detail pages for trend checks.

**Dark theme surface hierarchy**
- True blacks are rare; Vercel/Linear use `#000`/`#0a0a`/`#111`-family surfaces.
- Surfaces are separated by **1px borders at ~8–10% white**, not shadows, not big luminance jumps. Elevation = subtle lighten + hairline border.
- Primary action = solid white or brand color button; everything else ghost/bordered.

**Typography scale**
- ~3-step scale: 12–13px labels/meta (often `letter-spacing` + uppercase or muted gray), 13–15px body/table, 18–24px page titles, plus monospace for code/IDs.
- Inter/Geist-class grotesques; numerals often tabular.

**Status/badge systems**
- Pill badges: outlined or soft-fill, colored dot + text; palette limited to green/amber/red/blue/gray.
- Status everywhere uses **dot + word**, never color alone (accessibility) — e.g., "Operational" + green dot.
- Freshness metadata ("computed N min ago", "last seen 7min ago") is standard chrome.

**What makes these feel 2026 not 2020**
- Hairline-border cards on near-black instead of heavy shadows/elevation.
- Tokenized search/filter bars and Cmd+K overlays instead of filter sidebars.
- Flat, dense tables with sparklines instead of paginated detail pages.
- AI/agent panels docked as contextual drawers rather than separate products.
- Restrained color: data carries the palette; chrome is monochrome.
- Squarer radii (4–8px) and less "consumer bubbly" rounding than 2020-era SaaS.

---

## What to adopt vs avoid for an industrial control room

**Adopt**
- Density: 32–40px rows, 13px data type, hairline separators — operators need more on screen.
- Surface hierarchy by hairline border + slight luminance lift (Vercel/Linear model) — reads well on dim control-room walls and large displays.
- Status as dot + word pills; a fixed semantic palette (green/amber/red/gray + one accent).
- Inline sparklines and 90-tick uptime bars for per-asset health history.
- Provenance/freshness chips ("updated 12s ago", "computed 4 min ago") — builds operator trust.
- Tokenized filter bar + Cmd+K palette for jumping to machines/lines/alerts.
- Topology canvas with status-tile nodes (Railway) for line/plant overview.
- Expand-in-place row detail (Honeycomb waterfall) — keep context, reduce navigation.

**Avoid**
- Marketing gradients, glow effects, hero imagery (Stripe/incident.io marketing chrome) — noise in a control room.
- Consumer roundedness: big 16–24px radii, bubbly cards, playful illustration.
- Engagement loops: notification badges, feeds optimized for "activity", gamified elements.
- Rainbow per-series chart palettes (full-Grafana mode) — reserve color for meaning.
- Full-page drill-downs for routine inspection; prefer drawers/overlays to preserve situational context.
- Light-only design: assume dark-first, on large/wall displays, with high-contrast mode for glare.
