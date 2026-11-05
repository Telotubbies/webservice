# UX patterns from Grafana, Datadog and Databricks for an industrial operator console (vissointan)

Checked 2026-11-05. Product facts come from current official docs, read through a summarising fetch tool, so wording is paraphrased unless quoted. Anything labelled Inference is my judgement, not a sourced finding. "Unverified" means I could not confirm it.

## How does each product implement the patterns?

### Takeaway
Grafana has the most explicit documentation for time, cursor and variables. Datadog is the best model for query plus facets. Unity Catalog is the best model for asset hierarchy and lineage. I could not confirm a Datadog shared cursor from its docs.

### Cited Findings

**Global time range and synced cursor**
- Grafana: the dashboard time picker offers relative, absolute and semi-relative ranges (a fixed start with `now` as the end), and timezone and fiscal year are set from it — [Grafana: Use dashboards](https://grafana.com/docs/grafana/latest/dashboards/use-dashboards/)
- Grafana: time lives in the URL as `from`/`to`, plus `time` and `time.window` for a centred range, and `timezone` — [Grafana: Use dashboards](https://grafana.com/docs/grafana/latest/dashboards/use-dashboards/)
- Grafana: no automatic dashboard refresh by default; an interval is chosen from a dropdown; triggering a refresh cancels pending requests — [Grafana: Use dashboards](https://grafana.com/docs/grafana/latest/dashboards/use-dashboards/)
- Grafana: the "Graph tooltip" setting has three modes: default (not shared), shared crosshair, shared tooltip. Options also include hide time picker and "now delay", which shifts `now` to avoid nulls from aggregation lag — [Grafana: Dashboard settings](https://grafana.com/docs/grafana/latest/dashboards/build-dashboards/modify-dashboard-settings/)
- Datadog: Timeboards "represent a single point in time—either fixed or real-time—across the entire dashboard". On private dashboards the refresh rate depends on the window (every 10 seconds for 1 to 10 minute windows, hourly for 1 week or longer); public dashboards refresh every 30 seconds — [Datadog: Dashboards](https://docs.datadoghq.com/dashboards/)
- Datadog: there is a default timeframe applied to all users, a UTC toggle, a TV mode and a pause auto-refresh that applies to all viewers — [Datadog: Configure](https://docs.datadoghq.com/dashboards/configure/)
- Databricks: not assessed for time or cursor; the assignment scoped Databricks to catalog and lineage.

**Query and search bar**
- Datadog: `key:value` terms, `@` prefix for attributes, reserved attributes without the prefix (`service`, `host`, `status`), `AND` by default, `OR`, `-` to exclude, parentheses, and `*`/`?` wildcards. Operators and attribute searches are case sensitive — [Datadog: Search syntax](https://docs.datadoghq.com/logs/explorer/search_syntax/)
- Datadog: a Saved View stores query, columns, time horizon and facets — [Datadog: Search syntax](https://docs.datadoghq.com/logs/explorer/search_syntax/)
- Databricks: the search bar finds Unity Catalog tables by keyword or semantic search across table names, column names and comments, and returns only tables the user may see — [Databricks: Discover data](https://docs.databricks.com/aws/en/discover/)

**Facets**
- Datadog: qualitative facets list top values with counts scoped to the current query; clicking filters, and checkboxes add or remove values. Measures show a min/max slider with typed bounds — [Datadog: Facets](https://docs.datadoghq.com/logs/explorer/facets/)
- Datadog: the search bar and facet panel both scope the data, and facet values feed autocomplete. Hiding or grouping a facet changes the view only, not search; saved views can store hidden-facet state. Datadog recommends at most 1,000 facets, and a new facet only populates for logs ingested after it is created — [Datadog: Facets](https://docs.datadoghq.com/logs/explorer/facets/)

**Correlated timeline and pivot between signals**
- Grafana: correlations use a value from one data source to query another or to build an external URL. Query links open in Explore Split View, URL links in a new tab; the Logs and Table visualizations support them — [Grafana: Correlations](https://grafana.com/docs/grafana/latest/administration/correlations/)
- Datadog: logs and traces link through injected trace ID, span ID, `env`, `service` and `version` attributes. Traces and logs are sampled independently, so a log can reference a trace that was not retained — [Datadog: Connect logs and traces](https://docs.datadoghq.com/tracing/other_telemetry/connect_logs_and_traces/)
- Datadog: event overlays on widgets can be filtered by a template variable — [Datadog: Template variables](https://docs.datadoghq.com/dashboards/template_variables/) (seen through a search summary, page not opened)

**Dashboard variables and panel editing**
- Grafana: eight variable types (query, custom, text box, constant, data source, interval, filters, switch). Changing a value updates every element using it. Panels can repeat per value, nested variables narrow each other, and `skipUrlSync` keeps a value out of the URL. The docs recommend one dashboard with variables over duplicates per server or region — [Grafana: Variables](https://grafana.com/docs/grafana/latest/dashboards/variables/)
- Grafana: the panel editor has a header (Back, Discard, Save), a preview with a raw-data Table view toggle, a data section (Queries, Transformations, Alert tabs) and a display options pane with suggestions and styles — [Grafana: Panel editor](https://grafana.com/docs/grafana/latest/panels-visualizations/panel-editor-overview/)
- Datadog: template variable values follow the global time frame for most sources, with metrics and Cloud Cost on a fixed last-48-hours window — [Datadog: Template variables](https://docs.datadoghq.com/dashboards/template_variables/) (search summary)
- Datadog: on shared dashboards, setting the same default and available value locks a variable for viewers — [Datadog: Shared dashboards](https://docs.datadoghq.com/dashboards/sharing/shared_dashboards/) (search summary)
- Datadog: Powerpacks are synced, templated widget groups; edits reach all instances, only the author can edit by default, and variables either scope a pack once or stay as filters — [Datadog: Powerpacks](https://docs.datadoghq.com/dashboards/guide/powerpacks-best-practices/)

**Catalog and lineage (Unity Catalog)**
- Lineage is captured automatically down to column level and aggregated across workspaces on the metastore. UDF lineage is table level only — [Databricks: Lineage](https://docs.databricks.com/aws/en/data-governance/unity-catalog/data-lineage)
- The graph opens at one level; a plus icon on a node expands it, an edge opens a details panel, and clicking a column shows related upstream and downstream columns. Jobs and dashboards consuming a table are listed under its Lineage tab — [Databricks: Lineage](https://docs.databricks.com/aws/en/data-governance/unity-catalog/data-lineage)
- Lineage is lost on renames, and it persists even if a transaction rolls back. Catalog Explorer keeps it indefinitely (from 1 September 2024); the system tables keep 395 days — [Databricks: Lineage](https://docs.databricks.com/aws/en/data-governance/unity-catalog/data-lineage)
- Discover lets curators highlight key assets and browse by domain or type; the Insights tab shows usage; comments can be AI-generated — [Databricks: Discover data](https://docs.databricks.com/aws/en/discover/)

### Inferences
- Grafana's three-mode cursor setting and URL-held time are the most directly copyable mechanisms.
- Lineage maps to plant data well: tag to derived tag to rollup to report or dashboard. It has to expand one level at a time, as Unity Catalog does, or it becomes a hairball.

### Gaps
- Datadog shared cursor: a targeted search of Datadog's docs found nothing. It may exist in the UI. Unverified, check in a live account.
- Datadog click paths for pivoting, and search bar autocomplete behaviour beyond facet values: not described on the pages read.
- Grafana panel-level time overrides and chained variable detail: on linked pages I did not read.
- Unity Catalog's three-level namespace and tags: not on the pages read, so not cited here.
- No screenshots or hands-on testing. These notes reflect docs, not observed behaviour.

## Which patterns conflict with control-room needs, and what must change?

### Takeaway
These products assume an analyst who starts a query at their own pace. An operator is interrupted by the plant, so exploratory patterns should sit behind the live view and never replace it. The strongest study found, Laberge et al. 2014, supports a time-series alarm tracker only when paired with a trained response strategy.

### Cited Findings
- Laberge, Bullemer, Tolsma and Reising (2014), *International Journal of Industrial Ergonomics* 44(3), 395-406: 24 certified operators in a simulation compared alarm summary displays. One was a new tracker showing alarms in a time series as icons with short descriptions. With a formal response strategy focusing the tracker by equipment area, operators responded to more process events and made fewer false responses caused by plant upsets — [library record](https://bvbvf1.bib-bvb.de/vufind/PrimoRecord/cdi_proquest_miscellaneous_1534806650) (abstract level through a search summary; ScienceDirect returned 403, and the full text and effect sizes are unverified)
- ISA-101 sources commonly describe gray backgrounds and muted colours to limit glare in a bright control room, red and yellow reserved for abnormal states, and a four-level hierarchy — [Automation.com](https://www.automation.com/article/the-high-performance-hmi); [Tatsoft](https://docs.tatsoft.com/display/FX/ISA-101+HMI+Compliance+How-to) (search summary; secondary sources, ISA-101.01-2015 itself not read)
- Published gray hex values conflict between secondary sources, so treat them as illustrative — [Industrial Monitor Direct](https://industrialmonitordirect.com/blogs/knowledgebase/isa-101-high-performance-hmi-design-principles-color-strategy); [Open Exam Prep](https://open-exam-prep.com/study-guides/isa-cap/system-design-hmi-alarms-enterprise/hmi-design-isa101) (search summary; which source gave which value was not recorded, so verify both)
- Alarm rate benchmarks: about 1 alarm per 10 minutes per operator in steady state; a flood is about 10 or more per 10 minutes, ending below 5 — [IChemE](https://www.icheme.org/media/17392/lc-0151_21-lead-process-safety-metrics-alarm-rationalisation-final.pdf); [Open Exam Prep](https://open-exam-prep.com/study-guides/isa-cap/system-design-hmi-alarms-enterprise/alarm-management-isa182) (search summary; sources differ on "10 or more" versus "more than 10"; the standards themselves not read)
- In an ASM consortium deck, no console met the EEMUA flood target for the entire data collection period — [Honeywell/ASM](https://process.honeywell.com/content/dam/process/en/documents/document-lists/doc_asm-consortium/presentations/August%2023%202009%20-%20Best%20Practices%20in%20Alarm%20Management%20Presentation.pdf) (search summary; 2009 data)

### Inferences: shortlist
All verdicts below are my judgement. None has been tested with plant operators.

| # | Pattern | Source | Verdict | What must change for operators |
|---|---|---|---|---|
| 1 | Alarm tracker with equipment-area focus | Laberge 2014 | Adopt, with training | Time series of alarm icons, filterable by area (batching, aggregate feed, conveyor). Ship it with a written response procedure, since the evidence covers the pair and not the display alone. |
| 2 | Shared crosshair | Grafana | Adopt | Default to crosshair, not shared tooltip, because tooltips on every trend add clutter. Limit it to analysis and trend screens. Show alarm and batch markers on the same cursor. |
| 3 | Global time range with URL state | Grafana | Adopt, modified | Keep it off the live overview. Any non-live range gets a persistent "HISTORICAL" banner and a one-key return to live, and an alarm never gets hidden by the chosen range. Replace Grafana's manual refresh default with always-live plus a visible stale-data state. |
| 4 | "Now delay" | Grafana | Adopt | Use for historian rollups so lag does not read as a dip to zero. Never on live values. |
| 5 | Correlated pivot, split view | Grafana, Datadog | Adopt, modified | Join on plant keys: batch, recipe, equipment, truck ticket, shift. Curate one-click links from an alarm to its trend, last batch and vision event. Say so plainly when the linked record is missing. |
| 6 | Facets with counts | Datadog | Adopt for review | Use in alarm journal, batch and event history only. Limit to about 5 to 8 curated facets (area, priority, state, shift, recipe). Do not offer user-defined facets on operator roles. |
| 7 | Query bar plus saved views | Datadog | Partial | Engineer role only. Operators get saved views as named buttons ("Last shift's high priority alarms") and plain search on tag or equipment names. Make syntax case insensitive, and let Thai labels match. |
| 8 | Variables | Grafana | Adopt, restricted | Use one template per plant or line rather than duplicate screens, with at most 1 or 2 selectors. Always show the selected plant prominently, and lock the selection on a console assigned to one plant, as Datadog's locked variable does. Avoid `skipUrlSync` for plant scope, since links should reproduce what was seen. |
| 9 | Panel editor | Grafana | Engineer only | Keep the preview, raw table toggle and Save/Discard. Put it behind a role, add an audit record and version history, and do not offer free palette choice, since it would break reserved alarm colour. Grafana's panel styles can alter thresholds and colours, so do not copy that. |
| 10 | Synced reusable groups | Datadog Powerpacks | Adopt | Use for a standard equipment faceplate group across screens. Make updates a controlled change: a silent push to live consoles is unacceptable. |
| 11 | Catalog and on-demand lineage | Unity Catalog | Adopt for engineers | Tree of plant to line to equipment to tag, and impact view before editing a derived tag (P3 formulas). Expand one level at a time. Keep lineage through renames, the gap Unity Catalog documents. Operators see only "where does this value come from?" from a faceplate. |
| 12 | TV mode | Datadog | Adopt, modified | Use for the wall overview, with larger type and no controls. Alarm state must stay in it. |
| 13 | High-density mode | Datadog | Reject as a default | Automatic density on large screens works against glanceability and fixed spatial memory. Keep positions stable. |
| 14 | Auto-layout, suggested visualisations, AI comments | Grafana, Databricks | Reject at the console | Operators rely on stable layout and verified labels. AI text may be acceptable as a draft for engineers to approve. |

**Direct conflicts**
- Glanceability: query bars, facets and free dashboards all need attention and typing. Level 1 and 2 screens should work with none of them.
- Alarm response: a shared time picker or filter can silently hide live conditions. Filters must never scope the alarm banner.
- ISA-101 restraint: observability palettes use colour for series identity. In the console, chromatic colour stays reserved for abnormal state, and series are told apart by line style, label or neutral tones.
- Flood conditions: facet counts and search are too slow during a flood. The tracker and area grouping should do this work, and the facets should support the post-event review.
- Shared state: Datadog's pause auto-refresh applies to all viewers. An equivalent on a console could freeze another operator's view, so make any pause per session, visible and time limited.

### Gaps
- Peer-reviewed evidence on crosshairs, facets or query bars for process operators: none found in this pass. Those verdicts rest on reasoning, not on studies.
- Laberge effect sizes, and whether the display alone improved performance, need the full text.
- ISA-101.01-2015 and ISA-18.2 are paywalled and were not read. No direct link between Laberge 2014 and ISA-101 was found.
- No study specific to concrete or aggregate plants was found. Most alarm evidence comes from process industries, with flood patterns that may differ from batch plants.
- Claims of operator performance gains from high-performance HMIs on vendor pages were left out because they could not be traced to primary studies.

## What can be confirmed about obviously.ai (Zams) line art and maze.co scroll animation?

### Takeaway
Stack markers are confirmed from the initial HTML of both sites on 2026-11-05. The line art method and the exact motion design are not confirmed, because I did not render the pages or read their JS bundles.

### Cited Findings
- zams.com's footer reads "Obviously AI, Inc. (d/b/a Zams)" — [zams.com](https://zams.com). obviously.ai still returns HTTP 200 with the title "Data Science without Code | Obviously AI" and mentions Zams — [obviously.ai](https://obviously.ai). So Zams is a confirmed trade name, but the older site has not been replaced by a redirect.
- zams.com is on Webflow (`data-wf-site`, `website-files.com` CDN) and loads GSAP 3.15.0 from that CDN. It has a `data-lottie-url` attribute on a hero element, empty in the HTML. Images include PNG, JPEG, SVG, AVIF and WebP, with 32 inline `<svg>` tags, and some image filenames begin `Gemini_Generated_Image_` — [zams.com](https://zams.com) (page source)
- zams.com's initial HTML has no `stroke-dashoffset` — [zams.com](https://zams.com) (page source)
- maze.co is Gatsby 5.16.1 (generator tag). Its CSS includes `animation-timeline:view()` and `animation-range` utilities with Tailwind-style class names, including staggered ranges such as `contain calc(var(--i)*10%)`, and sticky utilities. There is a fixed, full-viewport `data-webgl-canvas-container`, and one `.webm` reference. Images come from DatoCMS. The hero text says "Scroll to continue" — [maze.co](https://maze.co) (page source)
- maze.co's initial HTML has no GSAP, ScrollTrigger, Lenis or Lottie string. Its only `stroke-dashoffset` belongs to a CircularProgressbar component's styles — [maze.co](https://maze.co) (page source)

### Inferences
- Maze appears to use native CSS scroll-driven animation for at least some reveals, with a per-item `--i` variable for stagger, and a WebGL layer behind the content. This is a cheap pattern to copy for a landing page, with no scroll library needed in the case of the CSS portion.
- For an SVG line-draw, Zams cannot be cited as a precedent. Its GSAP use is confirmed, but what it animates is not.
- Any such motion belongs on the marketing page only, and should respect reduced-motion. The console itself should not borrow it.

### Gaps
- How Zams' line art is made (hand-drawn SVG, raster or AI-generated): unconfirmed. No artwork was viewed.
- Whether Maze's JS bundles include a scroll or animation library, and what the WebGL layer draws: unconfirmed. Only the initial HTML was searched.
- Browser support for `animation-timeline` in 2026 was not checked. Confirm it before relying on it.
- No Maze or Zams write-up of their site build was found.
