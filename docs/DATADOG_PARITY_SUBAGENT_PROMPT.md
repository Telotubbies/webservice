# Datadog-parity build prompt (for implementation subagents)

Audience: engineering subagents implementing UI work in this repo, each owning one work package (WP).
Read sections 0–4 first (shared by every WP), then only your own WP in section 5.

---

## 0. Mission and ground rules

Build the remaining Datadog-style surfaces of the **Plant Ops console** (React + Vite + Tailwind v4, bilingual EN/TH, sorting-line SCADA) so that the app reaches near-full parity with the Datadog product surfaces we studied, **adapted to a plant**, not copied 1:1.

Non-negotiable rules:

1. **Reference is design-only.** `ref/datadog/` is Datadog proprietary material (see `ref/datadog/SOURCES.md`: "design reference only, do not ship"). Never embed Datadog images, logos, icon sets, copy, fonts or brand colours in the product. Study layout, information hierarchy, density, interaction. Write our own copy and use our own tokens/icons.
2. **No invented data.** Every number on screen must come from a real endpoint, the live store (`web/src/lib/live.ts`), or a pure derivation of those. If the backend has no data for a surface, build the UI against the real contract, show an honest empty/"not configured" state, and list it under "Needs backend" in your report. Do **not** add fake-looking constants. (Existing precedent: `features/security/posture.ts` computes posture from real keys/members/edges/audit.)
3. **Do not change the backend** (`backend/`, migrations) unless your WP says so. If you think you need an endpoint, write the minimal spec (method, path, auth, shape, source tables) in your report and stop for that item.
4. **Stay in your lane.** Own only the files listed in your WP. Shared files (section 3.3) are append-only edits, done last, minimal diffs.
5. **Plant context beats cloud context.** Datadog concepts that have no plant analog are skipped (the coverage table marks them `Skip`). Map the rest: host → edge gateway / machine, service → equipment, trace → none, SLO → availability SLO on a tag, incident → plant incident, monitor → alarm rule.
6. **Operate mode design.** These are task surfaces: scannability, consistency, known patterns, precise detail. No marketing flourishes, no gradient text, no hero-metric template, no eyebrow/kicker labels, no side-stripe (`border-left`/`border-right` > 1px) accents, no nested cards, no decorative glass. See 3.5.

Branch and merge model:
- Base branch: `feature/datadog-parity` (already contains commit `864bf8d` and later polish).
- Each subagent works in its own git worktree/branch `feature/dd-<wp-slug>` created from `feature/datadog-parity`, commits there, and reports. The controller merges. Never push, never force-push, never edit another WP's files.
- Commit message footer required by the harness: `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.

---

## 1. What already exists (do not rebuild)

Already shipped on `feature/datadog-parity`:

| Area | What exists | Where |
|---|---|---|
| Flyout nav | Dark mega-menu, one colour token `--color-flyout #15171e` shared by the open rail row and the panel; panel starts flush at the rail's right edge; the group title is a `NavLink` that turns blue with an arrow on hover and goes to `group.href ?? items[0].to` | `web/src/app/Shell.tsx`, `nav.ts`, `dd-theme.css` |
| Monitors landing | `/monitors`: facet sidebar (status, muted, priority, rule type, equipment, signal) + omnibar + status-grouped table; tabs List / Triggered / Downtimes / Quality; phone collapses facets behind a Filters button | `web/src/features/monitors/*` |
| Facet component | `FacetSidebar`, `toggleFacet`, `passesFacets` (OR within a facet, AND across; counts ignore the facet's own selection) | `web/src/shared/ui/Facets.tsx` |
| Security | `/security` Overview (posture score, top failures, severity breakdown, control sections), `/security/issues` (inbox + side panel), `/security/findings` (facet explorer, group by rule/resource/none, same panel), `/security/api` (business-logic events from the audit log, API clients tab), `/security/access` (the old page) | `web/src/features/security/*` |
| Dashboards | New widget kinds `group` (blue header bar) and `treemap`, `fill` option on `value` (solid conditional tile), percentile histogram with stats column, built-in board `line-performance`; grid runs on half-rows (`UNIT = 2`, `ROW_H = 50`) | `web/src/features/dashboards/*` |
| Severity tokens | `--color-sev-critical/high/medium/low/info` (+ `-soft`, `--color-sev-ink`) with AA text pairs | `web/src/dd-theme.css` |
| Mock API | Dev mock now serves api-keys, edges, audit | `web/mock/devApi.ts` |

Already built before this work (spec in `ref/datadog/PARITY.md`, status "Done" in `COVERAGE.md`): alarms list/detail/quality, downtimes, SLO CRUD + corrections, incidents, events + correlation, notebooks, metric summary, trends (metric explorer), DDSQL-style query, audit trail, API keys, teams, settings, devices list + add wizard, infrastructure map, profiles, error tracking, activity timeline, notification bell + journal.

Decisions already made (confirm with the user in your report if you disagree, do not silently reverse):
- Datadog "Vulnerabilities" is implemented as **Findings** (failing rule × resource) because the project has no CVE scanner.
- "Central dashboard" is implemented as a **board** in the Dashboards system (`line-performance`), not as a rewrite of Overview (`/`).

---

## 2. Research sources you must use

Read these before designing. They are the spec; this prompt only organises them.

| File | What it gives you |
|---|---|
| `ref/datadog/COVERAGE.md` | 273 mirrored pages → our route → `Done / Partial / Gap / Skip` with a note. Your WP lists the rows it covers. |
| `ref/datadog/PARITY.md` | F01–F22 feature specs with files, acceptance and i18n keys; real endpoint inventory (section 0.1); WS event shapes (0.2); hard bounds (0.3); **UAT selector contract (0.4, binding)**. |
| `ref/datadog/PLAN.md` | Pattern mapping Datadog → plant, KPI/timeseries/alarm UX rules, drill-down rules, supervised commands model, sidebar organisation. |
| `ref/datadog/features.md` | Product-by-product feature digest (30 products). |
| `ref/datadog/mirror/<slug>/` | Full-page captures of the real Datadog app (`index.html`, `shot.png`, `manifest.json`). `mirror/README.md` is the catalogue. Use `shot.png` first. |
| `ref/datadog/live/*-{layout,text,vocab,components,icons}.json` | Computed styles/vocabulary captured from the live app (dimensions, spacing, copy). Use for exact density and wording patterns. `live/COMPONENTS.md` indexes them. |
| `ref/datadog/img/*.png` | Marketing/docs screenshots (183). Section 5 names the ones each WP must open. |
| `docs/scada-platform-research.md` | Plant-side requirements: section 3 feature tiers (Tier 0 core, Tier 1 production-grade, Tier 2 differentiators, Tier 3 regulated), section 4 gap analysis. Use it to decide *plant adaptation* and priorities. |

Internet research: only where a page is not mirrored. Use the **scrapling** skill's CLI (`scrapling extract get|fetch <url> out.md --ai-targeted`, always pass `--ai-targeted`) for `docs.datadoghq.com` pages, write the result into your scratchpad (not the repo), and never copy text into the product. Respect robots.txt and ToS.

---

## 3. Shared engineering context

### 3.1 Stack and layout

- `web/` — React 19, react-router, @tanstack/react-query, Tailwind v4 (`@theme` tokens in `web/src/dd-theme.css`), i18next, lucide icons via `DdIcon` (`web/src/shared/ui/ddicons.ts` — **semantic names**; add a name there if you need a new lucide glyph), uPlot charts, react-grid-layout dashboards.
- Routes: `web/src/App.tsx` (lazy pages inside `AuthedApp`). Nav model: `web/src/app/nav.ts` (one source for sidebar, palette and flyout). Page header: `PageBar`/`PageBody` in `shared/ui/Page.tsx`. Feedback states: `shared/ui/Feedback.tsx` (`EmptyState`, `ErrorState`, `Notice`, `SkeletonRows`). Status chips: `shared/ui/Status.tsx`. Facets: `shared/ui/Facets.tsx`.
- Data: `web/src/lib/api.ts` (`api`, `adminApi`, `sloApi`, `notifyApi`, `v2()` helper). Org/site scope: `useAdminOrg()`, `useAdminSite(orgId)`, `usePrimaryScope()` in `features/admin/admin.ts`. Roles: `useRole()`, `canOperate`, `canAdmin` in `app/session.ts` — **never fetch an operator/admin endpoint for a lower role** (zero-4xx gate; see PARITY 0.3).
- Live data: `live` store (`lib/live.ts`): `live.latest`, `live.alarms`, `live.insights`, `live.buffers`; hooks `useStore`, `useNow` in `lib/hooks.ts`.
- Backend facts you can rely on (from `backend/app`): org-scoped v2 routes for alarm-rules CRUD, alarms (ack/assign/shelve/comments/events), downtimes + downtime-reasons, SLOs + corrections + status, incidents (+notes, status), notebooks, dashboards (+shared flag), report-schedules, notification-channels/deliveries, escalation-policies, oncall + overrides, teams, members/invites/api-keys, audit (+export), edges/sources/tags/cameras, sites/shifts/machines/oee/pareto/trend, tag-stats, tag history/latest/availability, inference, edge-logs, onboarding, vision usage.

### 3.2 i18n (hard gate: every key must exist in EN **and** TH)

- Feature-local bundles, never edit another feature's keys: create `features/<x>/i18n.ts` and `import i18n from '../../lib/i18n'` then `i18n.addResourceBundle('en'|'th', 'translation', { <ns>: {...} })`. Namespaces already taken: `mon`, `sec`, `alx`, `dash`, `nav`, `px`, `alarms`, `access`, `admin`, `notify`, `insights`, `viz`, `common`, `state`, `overview`, `line`, `roles`, `auth`, `shell`, `ui`. Pick a new short namespace per WP.
- Plurals use `_one` / `_other` and **must** be called with `count`.
- Thai copy: short, plain control-room words, no transliterated English where a Thai word is normal ("รับทราบ" = acknowledge). Thai needs more width: test every label at EN and TH, truncate with title attribute, never rely on text fitting.
- `nav.ts` labels are keys under `nav.*` in `web/src/lib/i18n.ts` (append-only).

### 3.3 Shared files (append-only, last, minimal)

`web/src/App.tsx` (routes), `web/src/app/nav.ts`, `web/src/lib/i18n.ts` (`nav.*` only), `web/src/lib/api.ts` (add functions at the end of the relevant object), `web/src/shared/ui/ddicons.ts` (add names), `web/mock/devApi.ts` (add mock routes). The UAT contract (PARITY 0.4) says `.side-nav a.tab` count is 13 desktop / 5 mobile: adding rail items changes it. Prefer adding pages inside existing flyout groups (flyout links are not `a.tab`); if you add a rail group, update `tests/e2e/uat.mjs` and say so.

### 3.4 Dev, mock and verification workflow (hard-won pitfalls)

- Type-check with **`cd web && npx tsc -b`** (plain `tsc --noEmit` does not check the project references and misses errors). Lint: `npx oxlint src/<your dirs>`. Design detector: `C:/Users/Gigabyte/.claude/skills/impeccable/scripts/impeccable detect --json <files>` — fix everything it reports in your files (it currently flags two pre-existing files outside our scope: `alarms/AlarmDetailPage.tsx` `border-l-4`, `auth/auth.css` font; leave those).
- Mock dev server (no backend needed): `cd web && MOCK_API=1 npx vite --port 5210` (port 5199 is the user's own server; do not kill it). Mock fixtures live in `web/mock/devApi.ts`; extend them for your WP so every state is viewable.
- The session token is **memory-only**: a full page reload logs you out. In Playwright: open `/signin`, click `button.dev-demo` (`nth(0)` operator, `nth(1)` viewer, `nth(2)` admin), then navigate **client-side** with `history.pushState({}, '', path); dispatchEvent(new PopStateEvent('popstate'))`.
- Playwright (Python) must launch **`channel='msedge'`** (bundled chromium is not installed). Check at least 1440×900 and 390×800, EN and TH (`localStorage 'wds.lang'` or the EN/TH switch).
- On this Windows box, in Git Bash: export `MSYS_NO_PATHCONV=1` before passing paths that start with `/`; **do not use `<<'E'` heredocs** (the shell tool mangles them) — write files with the editor tool or a heredoc with a longer unique terminator (e.g. `PYEOF`) and no `${}` inside; python via `python -I`.
- The Docker web container serves a built bundle on `http://localhost:5173`: after changes, the controller rebuilds it (`docker compose up -d --build web`). Do not run it yourself unless asked.
- Backend/integration tests are in `tests/` (pytest) and `tests/e2e/uat.mjs`; do not break their selectors (PARITY 0.4). Do not claim e2e passes if you did not run it.

### 3.5 Design contract (Operate mode)

Tokens first (`web/src/dd-theme.css`): ink/line neutrals, `--color-blue` accent, `--color-rail/--color-flyout` dark chrome, severity ramp `--color-sev-*`, status `--color-ok/--color-warn/--color-danger*`. Add a token when a colour is used more than once; no raw hex in components except one-off data-viz fills.

- Contrast: text ≥ 4.5:1 (large ≥ 3:1). White on amber/gold fails — use `--color-sev-ink`. Never convey state by colour alone: pair colour with a glyph/shape and text (ISA-101: amber/red only for abnormal).
- Density: 13px body, 36px rows (28px in dense tables), 44px page bar, 16px page padding (12 on phone), 12px grid gap. Tables: sticky header only when it earns it; row click opens a **side panel** (right drawer, `FindingPanel` pattern) rather than navigating away when the user is triaging.
- Every interactive row: `tabIndex=0`, Enter opens, visible `focus-visible` outline, hover tint `bg-info-soft`.
- States, all of them: loading skeleton, empty (invite an action), error with retry, permission-limited (explain who can do it; never a bare 403), long content, Thai text.
- Responsive: phone (390), tablet, wide. Facet sidebars collapse behind a "Filters" button below `md`. Tables scroll horizontally inside a bordered container, never the page.
- Motion: only to show a change (open/close). Respect `prefers-reduced-motion`. No entrance animations on sections.
- Kiosk mode (`?kiosk=1`) and the single-Esc-single-layer rule apply to any overlay you add (PARITY 0.4).

Definition of done for every WP: `tsc -b` clean; oxlint has no new warnings in your files; detector clean in your files; all new copy in EN+TH; screenshots at 1440 and 390 for each new page in EN and one in TH inspected by you (state what you saw, including defects you fixed); empty/loading/error/permission states exercised; mock data extended; no console errors; no new ≥400 responses under a viewer or operator session; a short report listing files changed, endpoints used, "Needs backend" items, and anything intentionally skipped.

---

## 4. Order of work and dependencies

Parallel-safe WPs (disjoint file ownership): A, B, C, D, E, G, H. Sequence-dependent: F after E (shares the case/incident panel), L after the security core (done), M last (audit pass), N advisory.

Suggested priority (user value × feasibility without backend): **A → C → B → E → D → G → F → H → L → I → J/K (need backend decisions) → M**.

---

## 5. Work packages

Convention per WP: **Goal**, **Study** (open these files; `✔` = already inspected by the author of this prompt, so the observations below are real; others you must open), **Build**, **Data**, **Files**, **Acceptance**.

### WP-A — Monitors family completion (route `/monitors/*`)

Goal: make Monitoring feel like Datadog's Monitors product, on our alarm-rule data.

Study:
- ✔ `img/datadog-alerts-monitor-overview-ios.png` — mobile monitor detail: severity eyebrow (ALERT + age), title, chart with warn/alert threshold bands, collapsible "Threshold conditions", then "N of M groups selected" with per-group status bars (green/orange/red hatched segments over time) and "Warning for 2 min • 9.69".
- ✔ `img/datadog-watchdog-feed.png` — alert feed: facet sidebar (category, type, status, env, …), cards with ONGOING/RESOLVED chip, anomaly title, duration chip, small chart with dashed highlighted window, "top patterns contributing".
- `img/datadog-monitor-threshold.png`, `img/datadog-alerts-screen*.jpg`, `img/datadog-alerts-platform-alerts-250813-dark.png`, `img/datadog-alert-graph.png`.
- `ref/datadog/mirror/monitors-settings-{general,notifications,policies,archive}`, `monitors-templates`, `monitors-triggered`, `monitors-manage`, `live/monitors-settings-*.json`, `live/monitors-triggered-*.json`.
- COVERAGE rows: `monitors-templates` (Gap), `monitors-settings*` (Partial: "single page, not per sub-section"), `monitors-triggered` (Partial: "no onboarding banner"), `monitors-create-*` (Gap: need backend rule kinds → **do not build**, only list in report).

Build:
1. **Templates** `/monitors/templates`: curated plant rule packs (e.g. "Conveyor health", "Bin level", "Vision pipeline stale") shown as cards; "Preview" shows each rule, the signal it would bind to, and status = will create / already exists (same name) / no matching tag; "Install pack" creates real rules via `adminApi.createRule(org, site, body)`. Tag binding by suffix/regex over `adminApi.siteTags` (e.g. `/temp/`). Admin only; others see the preview read-only. Confirm before creating; report per-rule success/failure; invalidate `['admin-rules']` and `['alarm-rules']`.
2. **Settings sub-sections** `/alarms/settings/{general|notifications|policies|archive}` (tabs inside the existing settings page, deep-linkable): move today's single page into General; Notifications = default channels/escalation policy (`notifyApi`, escalation-policies); Policies = alarm policy knobs the backend already exposes (read what `features/alarmsettings` uses; do not invent); Archive = cleared/disabled rules list with restore (`patchRule enabled`).
3. **Triggered onboarding banner** when there are zero rules or zero alarms ever (links to templates and new rule).
4. **Monitor detail upgrade** (`features/alarms/AlarmDetailPage.tsx` is Done; only add): threshold bands on the chart (use rule `threshold`, `kind`), collapsible "Threshold conditions", and a per-group status bar strip (ok/warn/alarm over the visible window) built from `live.alarms` history for that rule/tag.
5. Monitors list: add saved views (`shared/ui/SavedViews.tsx`), CSV export, and `?status=`/`?q=` URL round-tripping for the facet state.

Data: `api.alarmRules`, `adminApi.rules|siteTags|createRule|patchRule`, `live.alarms`, `api.alarms`. Files: `features/monitors/*`, `features/alarmsettings/*`.
Acceptance: installing a pack on mock creates N rules and the list reflects them; re-installing shows "already exists"; settings tabs deep-link; Thai OK; no admin endpoint fetched for operator/viewer.

### WP-B — Metrics suite (`/metrics/*`, `/trends`)

Goal: Metrics Summary/Explorer parity.

Study:
- ✔ `img/datadog-metrics-explorer.png` — query rows `a`, `b` (source dropdown, metric, `from`, `avg by`), "Add Query", "Add Formula", Display (Bars/Lines) and Color palette, stacked bars, legend table with Tags / Metric / Avg / Min / Max / Sum / Value, "Split graph in Notebook", "Export".
- `img/datadog-metrics-cost-control.png`, `datadog-metrics-hero-dark.png`, `datadog-metrics-seamless-collaboration.png`.
- Mirror/live: `metric-summary` (Done), `metric-overview`, `metric-volume`, `metric-settings`, `metric-derived-metrics` (Gap), `live/metrics-*.json`.

Build:
1. Tabs on `/metrics`: **Summary** (existing), **Overview** (counts: tags, by equipment, by quality good/stale/bad, freshest/stalest, tags with no data in 24h), **Volume** (samples per tag per window from `tag-stats`; top-N bar list; estimated rows/day; flag silent and chatty tags), **Settings** (read-only tag config table from `adminApi.siteTags` + datasource/profile deep links; no writes).
2. **Derived metrics** are a backend gap (needs expression tags) → build only the *client-side formula* in Trends: "Add formula" (`a+b`, `a-b`, `a/b`, `a*b`, constants, `abs`, `avg`) evaluated over fetched series with explicit alignment (resample to the coarser step); show the formula text in the legend. Label it "calculated in your browser, not stored".
3. Trends legend table with Avg/Min/Max/Sum/Last per series, Display Bars/Lines toggle, palette selector (`SERIES_COLORS` order, no red/orange/amber/green per ISA-101), "Export CSV" (`lib/csv.ts`), "Add to dashboard".

Data: `api.tags`, `/api/tags/{name}/history|availability`, v2 `tag-stats`, `adminApi.siteTags`. Files: `features/metrics/*`, `features/trends/*`.
Acceptance: Volume numbers match `tag-stats` response; formulas handle mismatched cadences without NaN rows; 5000-row history cap (PARITY 0.3) respected and labelled.

### WP-C — SLO detail, list facets, settings

Goal: SLO product parity.

Study:
- ✔ `img/datadog-slo-s-202508-dark.png` — list with facet sidebar (Creator, Type, State with counts; `state:breached` omnibar token; "BREACHED 173" summary tile), row select checkboxes, right **side panel**: header (name, TIME window, TARGET, STATUS pill, ERROR BUDGET with bar), tabs Overview / Alerts / Corrections / Audit History; Overview = creator/service/team/tags then **Performance** with time-range control and two tiles (STATUS big %, ERROR BUDGET LEFT big % with bar) then "Error budget burndown" (step line, dashed "out of budget" at 0) and "Burn rate" charts.
- `img/datadog-slo-section-2-v2.png`, `datadog-slo-section-3-v2.png`, `datadog-slo-service-level-objective-slo-product-hero-desktop.png`, `datadog-alerts-slo-uptime-graphs.png`.
- Mirror: `slo`, `slo-manage`, `slo-new`, `slo-corrections`, `slo-settings` (Gap), `live/slo-*.json`.

Build: (1) SLO list with facet sidebar + summary tiles (Breached/Warning/OK counts) + `state:` omnibar; (2) side panel with the four tabs: Overview (burndown + burn-rate charts computed from `sloApi` status/history — if the API only returns the current window, say so and show what exists), Alerts (alarms on the SLO tag in the window), Corrections (existing correction CRUD), Audit history (`audit?action=slo.*`); (3) **Settings** page `/slos/settings` (archive = deleted/ended SLOs if the API exposes them, else window defaults and target presets stored as org preferences **only if** an existing preferences endpoint exists — otherwise read-only); (4) "SLO widget" (`slo` kind exists on dashboards: align its look with the panel tiles).

Data: `sloApi` (list/status/create/patch/delete/corrections), `/api/tags/{name}/availability`, audit export. Files: `features/slo/*`.
Acceptance: burndown crosses the dashed zero line visually when budget is exhausted and the colour+text say "out of budget"; panel opens/closes with Esc; deep link `?slo=<id>`.

### WP-D — Dashboards: lists, shared, reports, variables

Goal: the rest of the Dashboards product around the new widgets.

Study:
- ✔ `img/datadog-ci-visibility-intelligent-test-runner-dashboard.png` — blue group bars, big solid tile, distribution + percentile column, treemaps, ranked tables with inline bars (already adopted).
- ✔ `img/datadog-incident-management-ir-incident-management-overview-2026.png` — **pastel group headers per theme** (Summary purple, Response Breakdown blue, Outage Tracking orange, Organizational & Service green), each with a one-paragraph description row, then KPI tiles ("193", "3.31 days", "6 %"), top-N lists with bars, weekly bar/line charts; board header: Share, Show Overlays, Configure, Add Widgets; "Add Variable".
- ✔ `img/datadog-infrastructure-section-1-v2.png` — "Global Performance Dashboard": **template-variable bar** (`$Service`, `$Zone`… each `name | value ▾`), "Saved Views" select, solid conditional-colour tiles (green/red/amber), SLO widget "Past 7 Days / Past 30 Days vs target", forecast timeseries with shaded band and "NOW" marker, geomap (skip: no site coordinates).
- `img/datadog-dashboards-*.png`, `datadog-ci-visibility-pipeline-visibility-dashboard.png`, `datadog-ci-visibility-change-duration-widget.png`, `datadog-timeseries-widget.png`, `datadog-query-value-kpi.png`.
- Mirror: `dashboard-lists`, `dashboard-shared`, `dashboard-reports` (Gap), `dash-integration-*` (Partial: 8 plant templates), `live/dashboards-*.json`.

Build:
1. Dashboards index tabs: **All / Mine / Shared / Starred**, plus **Lists** (named collections of boards, stored per user in `localStorage 'wds.dashLists'` — label "saved in this browser" unless an API exists), search + sort.
2. **Reports**: schedules UI on `report-schedules` (list/create/patch/delete; real endpoints exist): pick a board, cadence, recipients/channel, format; show last run if the API returns it. Admin gating per backend.
3. **Pastel group header variants** + optional description row on the `group` widget (field `tone: 'blue'|'purple'|'orange'|'green'`, `note`). Persist in widget JSON (opaque to backend). Update `makeWidget` defaults and the editor.
4. **Template variables**: board-level `$line`, `$equipment` chips that filter alarm/treemap/toplist widgets by equipment and set the default tag for widgets that opt in; variable bar above the grid; URL-synced.
5. **Pause/rewind time controls** (⏮ ⏸ ⏭) and "Show overlays" (alarm markers on timeseries, reusing trends markers).
6. **Forecast timeseries** option using the existing `forecast` rule logic (client-side linear/seasonal naive, labelled "estimate").
7. New built-in boards (seed in `dashboards/model.ts`, ids stable): "Incident management overview" (counts by severity, MTTR/mean time to resolve from `incidents` API, top equipment, weekly counts) and "Alarm management KPIs" (ISA-18.2: alarm rate per 10 min, top offenders, standing alarms, flood windows — Tier-2 differentiator in `scada-platform-research.md`).

Data: dashboards REST (`/dashboards`, shared flag), report-schedules, incidents, alarms/live. Files: `features/dashboards/*` (the `/reports` page lives under `features/production/`; search `report-schedules` in `web/src` before creating anything).
Acceptance: seeds sync for existing users (loadDashboards appends unseen seeds); variable change updates widgets without refetch storms; legacy boards unchanged (stored y/h are whole-row units; layout multiplies by `UNIT=2`).

### WP-E — Incidents: settings, overview, detail

Goal: Incident Management parity on the plant incident model.

Study:
- ✔ `img/datadog-incident-management-ir-incident-management-overview-2026.png` (see WP-D) and ✔ `img/datadog-event-management-eventmanagement-250806-dark.png` (case page: **Next steps** row with Set Priority [P], Set Status [S], Assign [A], Escalate [!] — dropdowns with keyboard shortcut hints; grouped alerts Gantt/timeline; Timeline/Table toggle).
- `img/datadog-incident-management-ir-*-2026.png` (on-call schedules, status pages, bits-ai investigation, incident automation), `datadog-incident-management-incidentresponse-250806-dark.png`.
- Mirror: `incidents`, `incidents-settings` (Gap), `on-call*`, `status-pages`, `live/incidents-*.json`.

Build:
1. `/incidents/settings`: severity ladder (names, descriptions, response expectation) and status vocabulary **exactly as the backend enum defines them** (read `backend/app/api/incidents.py`; if severities are fixed, show them read-only with explanatory copy and an "Edit vocabulary needs backend" note), escalation policies (CRUD against real `escalation-policies`), notification channel defaults, on-call link.
2. Incident detail: **Next steps** bar with P/S/A/! shortcuts (only for roles that can mutate), notes timeline (`/incidents/{id}/notes`), linked alarms/assets, time-in-status strip.
3. Incidents list facets (severity, status, equipment, assignee) using `FacetSidebar`; CSV export.
4. Overview board seed lives in WP-D; link to it from the page header.

Data: `/incidents`, `/incidents/{id}`, notes, status, escalation-policies, oncall, teams. Files: `features/incidents/*`, `features/teams/*` (read-only).
Acceptance: keyboard shortcuts do not fire inside inputs; status change reflected without reload; viewers get read-only.

### WP-F — Event management cases (after WP-E)

Goal: group alarms/events into **cases** the way Event Management correlates alerts.

Study: ✔ `img/datadog-event-management-eventmanagement-250806-dark.png` (case header "TOPOLOGY CORRELATION", title "service has multiple alerts for team", tag chips, Next steps, Gantt of alert states Ok/Warn/Error with time ruler, zoom, Reset view), `datadog-event-management-{enrichment,unify-data-alerts,product-hero-desktop,empty-state-intelligent-correlation-v2}.png`, mirror `event-management*`, `event-correlation` (Done), `event-settings` (Partial).

Build: a **Cases** view in `/events` — auto-group open alarms by equipment/time window (existing `bucketAlarms`/`correlate.ts`), each case: title ("N alarms on <equipment>"), chips (equipment, rules), Next steps (ack all / assign / open incident), and the **state Gantt**: one row per alarm, segments coloured ok/warn/alarm over the window with a time ruler, Timeline/Table toggle, zoom + reset. Settings = grouping window/field (per-browser preference as the coverage note says).

Data: `live.alarms`, `api.alarms`, alarm events endpoint (`/alarms/{id}/events`). Files: `features/events/*`.
Acceptance: Gantt segments derive from real raise/ack/clear timestamps; ranges with missing timestamps show "—", not zero-length bars.

### WP-G — Equipment catalog (Software Catalog analog) and infrastructure

Goal: Infrastructure/Catalog parity: List ⇄ Map, facets, details drawer.

Study:
- ✔ `img/datadog-service-catalog-software-catalog-section-1-v3.png` — header with tabs Explore / Setup & Config / Scorecards, **List | Map** toggle, "Search for … / Group by", Hide Controls, env/cluster dropdowns, "Showing 172 services", Map layout Cluster|Flow, facet sidebar (Language, Telemetry Type, Origin, …), nodes as rings coloured by health with name labels, hover card "Requests / Latency / Error", minimap, node-size legend.
- ✔ `img/datadog-service-catalog-software-catalog-section-2-v3.png` — side panel: header with ALERT: 3 Monitors (red) | OK: 9 Monitors (green) bar, Team/Contacts/Source code, "Service Overview Data" cards (Deployments, Error Tracking, SLOs, Incidents), Metrics charts (Requests and errors, Latency p50…max).
- `img/datadog-usm-*.png` (service map/page/flame graph), `datadog-infrastructure-*.png`, `datadog-container-monitoring-*.png`, `datadog-network-*-feature-*.png`.
- Mirror: `software*`, `infrastructure*`, `devices*`, `network*`, `idp-*`, `containers`, `processes`; COVERAGE Gap: `infrastructure-catalog-{changes,configuration,governance}`, `idp-surveys`, `devices-maps-geomap` (needs coordinates — skip).

Build: (1) Catalog page (`/catalog`, feature-flagged today): List|Map toggle, facet sidebar (equipment type, line, status, adapter, edge), map built on the existing line schematic data (ring colour = worst open alarm / stale; hover card = live value + alarm count + last update); (2) right drawer per asset: alarm bar (ALERT n | OK n), live value cards, SLO and incident cards (link out), 2 charts (value + alarms markers), owner team; (3) **Governance/Changes** from real data only: change feed built from audit actions on tags/sources/rules (`audit?action=tag.*|source.*|alarm_rule.*`), "Configuration" = read-only edge/profile config; (4) scorecards: per-asset readiness checks computed from real data (has alarm rule? has SLO? owner team? heartbeat OK?) with pass/total like the CSPM rule table.

Data: `adminApi.devices|siteTags|rules`, `sloApi`, teams, audit, live. Files: `features/catalog/*`, `features/devices/*` (UI only), `features/line/*` (read-only reuse).
Acceptance: map handles 0, 1, 200 nodes; keyboard focus on nodes; list and map share the same filtered set.

### WP-H — Logs / Errors explorer polish

Goal: Logs Explorer shape on the data we really have (`edge-logs`, journal, audit).

Study: ✔ `img/datadog-logs-explorer.png` (Views, Save, Indexes selector, "Search for" bar, **Group into** Fields/Patterns/Transactions, **Visualize as** List/Timeseries/Top List/Table/Tree Map/Pie Chart, volume histogram with red error cap, facet sidebar with CORE group and per-facet filter boxes, Watchdog insight strip, columns DATE/HOST/SERVICE/CONTENT, severity bar per row, Download as CSV, Options), ✔ `img/datadog-error-tracking-section-1-aggregate-similar-errors-into-issues.png` (issue rows: kind icon, class + location, message, "last seen … – N months old", service chip, COUNT + sparkbar VOLUME), `datadog-logs-*.png`; mirror `logs`, `logs-livetail`, `error-tracking`.

Build: add Visualize-as switcher to `/logs` (list / timeseries of count by level / top list by source / table / treemap / pie — reuse dashboard widget bodies), volume histogram on top with brush-to-filter, Group into Fields/Patterns (cluster identical messages after masking numbers/ids; show count + sparkbar), CSV download, column options persisted per browser. Errors: align list row anatomy with the screenshot.

Data: `edge-logs`, `/api/commands`, journal, audit. Files: `features/logs/*`, `features/errors/*`.

### WP-L — Security: remaining Partial rows

Goal: cover `security-*`/`sensitive-data-scanner*` Partial rows where plant data exists.

Study: ✔ `img/datadog-cloud-security-{cspm-new-2,misconfigs,vulnerabilities}.png` and ✔ `datadog-app-api-protection-aap-business-logic.png` (already built — compare your result to them for drift first), `datadog-cloud-security-cloud-infrastructure-entitlement-management.png`, `datadog-cloud-security-agentless.png`, `datadog-cloud-security-csm-hero-screenshot.png`, `datadog-cloud-siem-*.png`, `datadog-app-api-protection-aap-{ato,setup,hero-dark}.png`, `datadog-session-replay-*.png`; mirror `security-*`, `sensitive-data-scanner-*`.

Build: **Entitlements** tab (who/what can do what: members × roles × permissions matrix, API keys × role, edge credentials × scope, with "over-privileged" flags driving new posture rules); **Signals/Feed** (`/security/signals`): failed sign-ins, role changes, key creation/revocation, edge rotations as a severity-tagged signal list with facets and the side panel; **Coverage** (which controls ran, which need admin); posture **trend** (store daily score in `localStorage` per org and say so, or `audit`-derived only); "Download as PDF" via print stylesheet. ATO/Setup images → "Account protection" rules: threshold rules over `auth.login` failure counts raising real alarms is **backend**: list only.

Files: `features/security/*`.

### WP-I — Assistant (Bits AI) settings/usage/credits

Study: `img/datadog-bits-ai-*.png`, `datadog-bits-investigation-*.png`, `datadog-incident-management-ir-bits-ai-investigation-2026.png`; mirror `ask-settings`, `ask-usage`, `bits-ai-*` (Gap/Partial). Build only what the existing assistant/inference endpoints support: Settings (model/connection state from `/inference`), Usage (calls/latency from what the API returns), Investigations list = saved assistant conversations in `localStorage` labelled as such. Everything else → "Needs backend". Files: `features/assistant/*`.

### WP-J — Synthetics (flagged feature) — decision needed

Study: `img/datadog-synthetics-*.png`, mirror `synthetics-*` (Gap: settings, test coverage, suite create). There is no probe backend. Options to ask the controller: (a) skip; (b) map to **edge heartbeat & source reachability checks** (real data: `sources:test`, heartbeat) as "Checks" with coverage = % of sources with a check. Do not build until the controller picks.

### WP-K — Recipes / datastores — decision needed

Study: ✔ `img/datadog-workflow-stateful-workflows.png` (Datastores table, row modal with JSON / Raw text tabs, Add Data, Columns, Create, Table options), `datadog-workflow-*.png`; research doc Tier 1 "Recipes" (ISA-88-adjacent parameter sets downloaded to controllers). Needs a recipe table + versioned write path: **backend**. Deliver only a UI spec + mock-backed prototype if the controller approves.

### WP-M — Audit of PARITY F01–F22

For each feature in `ref/datadog/PARITY.md` section 1, verify in the running app (mock) whether it exists and meets its acceptance; produce a table (F-id, present?, evidence screenshot/route, gap). Implement only gaps that are small and frontend-only; list the rest. Respect the UAT selector contract.

### WP-N — SCADA-research adaptation (advisory, no code unless asked)

From `docs/scada-platform-research.md` sections 3–4, list which Tier 0/1/2/3 items are visible in the UI today and which have a Datadog analog already in the plan: alarm engine depth (shelving/suppression/flood KPIs → WP-D "Alarm management KPIs"), audit/e-signature on writes and acks (Tier 3: propose a confirm-with-reason dialog pattern for commands/acks and where it mounts), per-tag/area RBAC visibility, reporting (WP-D reports), recipes (WP-K), redundancy/store-and-forward health (Health page edge buffer already exists), ISA-101 colour discipline. Output: a prioritised backlog with UI sketches, not code.

---

## 6. Report format (each subagent)

1. WP id, branch, commit hashes.
2. Files added/changed (grouped), shared-file edits listed separately.
3. Endpoints/live-store fields used; roles gating.
4. What you verified and how (commands, viewports, languages) and what you saw — include defects found and fixed.
5. "Needs backend" and "Skipped (with reason)" lists.
6. Open questions for the user (max 5, each with your recommended default).
