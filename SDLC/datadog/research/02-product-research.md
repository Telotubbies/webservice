# SDLC — Product Research: Datadog (datadoghq.com)

| Field | Value |
| --- | --- |
| Product | **Datadog** — unified observability & monitoring SaaS platform |
| Site | <https://www.datadoghq.com> — app at `app.datadoghq.com` / `ap2.datadoghq.com` (AP2 region) |
| Category | Cloud-scale observability (metrics, logs, traces, RUM, synthetics, incident response, security) |
| Document purpose | Answer the guiding question *"ระบบอื่นมี Feature อะไรและแก้ปัญหาอย่างไร"* — what features do other systems have and how do they solve the problem — as input to redesigning an industrial monitoring dashboard (SCADA-lite for a simulated sorting plant with PLC support) |
| Evidence base | (a) Live-UI extraction corpus in `ref/datadog/live/` — 27 captured pages (`pages-all.txt`), per-page `*-components.json` / `*-layout.json` / `*-vocab.json`, and distilled spec `COMPONENTS.md`; (b) Datadog public docs & pricing pages; (c) third-party comparison sources (cited inline) |
| Date of research | Current as of writing; pricing figures are list prices and change frequently — verify before reuse |

---

## 0. Executive summary

Datadog is **not** an industrial product. It is a SaaS observability platform for cloud infrastructure and software applications. We study it because it is arguably the most complete reference implementation of the workflow our SCADA-lite dashboard needs to replicate:

> **collect telemetry → organize it into an asset/entity model → visualize → detect anomalies → alert → escalate → investigate → document**

Every SCADA-lite screen we need — asset list, live values, alarm rules, alarm console, downtime tracking, shift reports — has a direct Datadog analogue that has been refined against hundreds of thousands of real users. The local UI corpus (`ref/datadog/live/COMPONENTS.md`) already captures its shell anatomy, component recipes, and interaction patterns for porting into React + Tailwind.

Key takeaways:

1. **Datadog's core design trick is a single shared tag-based data model.** Every host, metric, log line, trace, event, monitor, and incident carries the same `key:value` tags, so the UI can pivot between any two views with zero re-querying friction. Our plant equivalent: a uniform `line:station:device:signal` tag taxonomy.
2. **Alerting is a first-class product area, not a feature** — Monitors have their own sub-application with 5+ screens (create wizard, manage list, triggered view, downtimes, SLOs, quality analytics). SCADA alarm management deserves the same treatment.
3. **Datadog is not an ERP**, but it plays the analogous *system-of-record* role for operations telemetry (§4). This tells us our dashboard should also own its telemetry model rather than being a thin viewer.
4. **The gap analysis (§3) shows Datadog's weaknesses are precisely our domain's requirements**: no self-hosting, no industrial protocols (OPC UA, Modbus, S7), no control-plane (write-back) capability, no deterministic hard-real-time guarantees.

---

## 1. Feature taxonomy of Datadog

Datadog's left rail (`AppRail`, 50px collapsed / 160px expanded, measured in `COMPONENTS.md` §Shell anatomy) groups the product into navigable pillars. Per Datadog's own navigation-redesign blog, the rail is organized as: **top** = search + recents + high-frequency links (Watchdog, Service Management); **middle** = product areas (Infrastructure, APM, Digital Experience, Software Delivery, Security); **bottom** = "core features" that feed everything else (Metrics, Logs, Dashboards, Monitors, Notebooks, Events) plus org/admin. The table below enumerates each pillar **as the navigation exposes it**, with the user problem it solves.

### 1.1 Product pillars

| # | Pillar / nav item | Sub-features (as navigated) | User problem it solves | Local evidence |
| --- | --- | --- | --- | --- |
| 1 | **Infrastructure** | Infrastructure List (host list), Host Map, Container Map, Containers view, Processes, Serverless | *"What machines do I have and are they healthy?"* — a queryable inventory of every monitored host/container with per-row status pills (`8 OK / 1 ALERT / 4 LOGS`), inline %-bar metric cells, facet panel (provider, team, tag filters), and a color-coded host map for bird's-eye density views | `infra-*` JSONs; `COMPONENTS.md` §infrastructure/hosts (omnibar, facet panel, `Default\|Metrics` segmented control, time-range stepper) |
| 2 | **Metrics** | Metrics Explorer, Metrics Summary | *"Show me any metric over time without pre-building a dashboard"* — ad-hoc query surface: pick a metric, add `group by` tags, choose aggregation, get a timeseries instantly. The "scratchpad" of the platform | `metrics-*` JSONs |
| 3 | **Dashboards** | Dashboard List, dashboard canvas (timeboards/screenboards), template variables, public/shared dashboards, presets | *"Give me a persistent, shareable, at-a-glance view for my team / NOC wall"* — widget-based canvases (timeseries, query value, top list, heatmap, treemap, table, SLO, geomap…) with auto-layout, TV-mode, and deep links into every other pillar | `dashboards-*` JSONs; list page captured (widget canvas internals noted as a coverage gap in `COMPONENTS.md`) |
| 4 | **Notebooks** | Notebook list, cell-based documents (text + live graphs + logs), templates | *"How do I write down an investigation or postmortem with live data embedded?"* — collaborative documents where every graph stays live; used for incident postmortems, runbooks, ad-hoc reports. Our analogue: shift reports / downtime analysis reports | `notebooks-*` JSONs |
| 5 | **Monitors** | New Monitor wizard, Manage (list + bulk ops + group headers), Triggered view, Downtimes, SLOs, Monitor Quality, Settings, monitor templates | *"Tell me when something is wrong — and let me manage hundreds of alert rules at scale"* — the alerting sub-application. Alert types: threshold, anomaly, forecast, outlier, change, composite, APM, log, RUM, synthetics, error-tracking, watchdog, audit-trail monitors. Manage page supports checkbox + bulk action bar (Mute / Resolve / Delete / Edit Tags / Export to template) | `monitors-*`, `monitor-create-*`, `monitor-detail-*`, `monitors-triggered/downtimes/quality/settings-*` JSONs; `COMPONENTS.md` §monitors/create + §monitors/manage |
| 6 | **Watchdog** | Watchdog Insights, Watchdog Alerts, Root Cause Analysis | *"Find problems I didn't write an alert for"* — unsupervised anomaly detection across all telemetry; surfaces "unknown unknowns" (e.g., anomalous error-rate spike on one endpoint) without any user-authored rule. This is the differentiating feature no OSS stack ships OOB | `r2/watchdog` capture dir |
| 7 | **Events** | Event Explorer, event correlation, event facets | *"What changed?"* — a queryable stream of every discrete thing that happened: deploys, config changes, monitor state transitions, integration events. Facets panel, analytics, and correlation rules (group related events into one case) | `events-*` JSONs; `r2/events/` |
| 8 | **Logs** | Log Explorer, Live Tail, Patterns, Pipelines (parse/enrich), Generate Metrics, Archives & Rehydration, Indexes | *"Search every log line from everything, right now"* — unified ingest + full-text search + facet navigation. **Live Tail** = unfiltered streaming view (tailing without indexing cost). **Patterns** = ML clustering of log shapes to tame volume. Pipelines turn unstructured lines into structured, tagged events that join the shared data model | `logs-*` JSONs (log explorer capture), `r2/logs/` |
| 9 | **APM** | Service Catalog/Service Map, Services list, Traces (trace search + flame graph), Profiler (continuous code-level), Error Tracking, Database Monitoring, Data Streams | *"Which service/code path is slow or erroring, end-to-end?"* — distributed tracing with automatic dependency mapping (service map), RED metrics per endpoint, span-to-log/metric pivot, continuous profiling for CPU/memory hotspots | `apm-*`, `apm-traces-*` JSONs; `r3/apm-services.png`, `r2/apm-sniper-raw.json` |
| 10 | **Digital Experience** | RUM (+ Session Replay), Synthetics (API/browser/mobile tests), Error Tracking | *"What do real users experience, and did we break the flow before they noticed?"* — real-user telemetry + scripted probes run from global locations on a schedule | `rum-*`, `synthetics-*`, `error-tracking-*` JSONs |
| 11 | **Service Management** | Incidents, On-Call, Case Management, Status Pages, Workflows (automation), Escalation policies | *"Who owns this alert, who's awake, and how do we run the response?"* — incident declaration with severity/commander/timeline, Slack-native response, on-call schedules & paging rotation, postmortem generation | `incidents-*` JSONs; `r2/notif*` |
| 12 | **Software Catalog** | Service/entity catalog, ownership, scorecards, dependency graph | *"Who owns this thing and what depends on it?"* — an internal developer portal: every service/resource carries owner, tier, lifecycle, docs links — the *metadata backbone* other pillars hang off | `catalog-*` JSONs |
| 13 | **Org Settings / Admin** | Users & teams, Roles (RBAC), API keys / application keys, SAML/SSO, audit trail, billing/usage, organization management | *"Control access, identity, and cost"* — in-content left admin nav (IDENTITY & ACCOUNTS / AUTHENTICATION / ACCESS), user cards with status dots, invite flow | `team-*` JSONs, `r2/org/`, `COMPONENTS.md` §organization-settings/users |
| 14 | **Integrations** | 1,000+ turnkey integrations, Datadog Agent, API/SDK | *"Get data in without plumbing"* — one agent auto-discovers services; integrations ship prebuilt dashboards + monitors + log pipelines. This is the moat: time-to-first-value is minutes | topbar/integration evidence in shell captures |
| 15 | **Bits AI** | Bits Chat, Bits Investigation (autonomous alert→RCA agent), Bits Code, Bits Security Analyst, Bits Detection, Bits Remediation | *"Do the investigation for me"* — agentic SRE teammate: auto-investigates every fired monitor, forms hypotheses, pulls telemetry, produces a verifiable root-cause narrative and suggested fix; chats in natural language; generates dashboards/notebooks/postmortems | `bits-*` JSONs (Bits AI → Investigations page captured) |
| 16 | **Command palette** | `Cmd/Ctrl+K` — search pill in topbar | *"Jump anywhere without learning the nav"* — global fuzzy search over pages *and entities* (dashboards, monitors, hosts by name). Recently-accessed pages pinned at top of rail | `COMPONENTS.md` §SearchPill; docs: "Cmd/Ctrl+K to search for pages and entities" |
| 17 | **Security** (product area) | Cloud SIEM, App & API Protection, Cloud Security, Workload Protection, Sensitive Data Scanner, Code Security | *"Detect threats in the same telemetry I already collect"* — reuses the same agent/pipeline/tags; out of scope for our redesign but proves the platform pattern (one pipeline → many products) | `security-*` JSONs |
| 18 | **Query & analysis tools** | DDSQL (SQL over telemetry), Sheets, Graph/geomap widgets | *"Ask arbitrary questions with a familiar language"* — SQL editor against observability data; spreadsheet surface for tabular analysis | `ddsql-*`, `sheets-*` JSONs |

### 1.2 Cross-cutting mechanics (the "how")

These are not nav items but the machinery that makes every pillar work the same way — and are the most important patterns to steal:

- **Universal tagging.** Every entity carries `key:value` tags (`env:prod`, `service:billing`, `team:checkout`). The Omnibar query syntax (`host:web-* AND env:prod`) is the same in hosts, metrics, logs, events, monitors. *Plant analogue: `line:sorting1 AND station:divert2 AND signal:belt_speed`.*
- **Pivot-by-click.** From a host → its metrics → its logs → its traces → its monitors → the incident. Tags carry the context so every view is one click away. `COMPONENTS.md` notes the UI literally encodes this: status pills inside the host row link outward.
- **Time-range stepper everywhere** (`15m … ◀ ▶` top-right, measured on infra page): a single global time context shared by every view.
- **Templates + bulk management.** Monitors ship as templates; the manage page is a spreadsheet-like grid with multi-select bulk actions — because real deployments have hundreds of rules, and nobody edits them one at a time.
- **Everything is API-first.** Every screen above is a client of the same public API users can script against; monitors/dashboards exportable as Terraform/JSON.

---

## 2. Feature matrix

Comparison set: **Datadog**, the OSS **Grafana stack** (Grafana + Prometheus/Mimir + Loki + Tempo), **New Relic**, **Splunk Observability Cloud**, **Dynatrace**, **Elastic Observability**, plus two industrial analogues: **Ignition (Inductive Automation)** and **Siemens WinCC Unified / AVEVA PI System** (grouped as "classic SCADA + historian").

Legend: ✅ native & strong, ◐ partial/add-on/extra product, ❌ not offered OOB.

| Capability | Datadog | Grafana OSS (LGTM) | New Relic | Splunk Observability | Dynatrace | Elastic Obs. | Ignition SCADA | WinCC / AVEVA PI |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| **Infrastructure monitoring** | ✅ agent, host map/list, containers | ◐ via Prometheus/node_exporter + dashboards | ✅ | ✅ (SignalFx core) | ✅ OneAgent full-stack | ✅ (400+ integrations) | ◐ (device/gateway health, not IT hosts) | ◐ (channel/PLC diagnostics) |
| **Dashboards** | ✅ polished OOB dashboards per integration | ✅ best-in-class flexible panels | ✅ | ✅ | ✅ | ✅ (Lens/Kibana) | ✅ Perspective/Vision process graphics + HMI mimic screens | ✅ native process pictures, faceplates, trends |
| **Alerting / alarm mgmt** | ✅ monitors app: threshold/anomaly/forecast/composite, downtimes, templates, quality analytics | ✅ Grafana Alerting (unified alert rules, contact points, silences) — you wire receivers yourself | ✅ | ✅ | ✅ (Davis-driven) | ✅ (rules & connectors) | ✅ alarm pipelines, shelving, journaling, roster escalation | ✅ alarm classes, alarm control, logging; the domain original |
| **Logs** | ✅ indexed search, Live Tail, Patterns, pipelines, archives/rehydration | ✅ Loki (label-indexed, cheaper, less full-text power) | ✅ | ◐ (Splunk Platform is the log giant; Observability Cloud is thinner) | ◐ (Grail log mgmt) | ✅ Elasticsearch = the canonical log engine | ◐ (journal/audit log, not general log mgmt) | ◐ (alarm/archive logs only) |
| **Distributed tracing / APM** | ✅ APM + continuous profiler + service map | ◐ Tempo + manual instrumentation | ✅ (strength) | ✅ (NoSample full-fidelity) | ✅ PurePath (strength) | ✅ (OTel-native) | ❌ | ❌ |
| **RUM / Synthetics** | ✅ both | ◐ via Faro/k6 (separate projects) | ✅ both | ✅ both | ✅ both (strength) | ◐ synthetics yes, replay no | ❌ (mobile clients, not user telemetry) | ❌ |
| **Incident mgmt & On-call** | ✅ Incidents + On-Call + status pages + Slack-native | ◐ Grafana IRM (Cloud/Ent), OSS needs PagerDuty/webhooks | ◐ Applied Intelligence workflows | ◐ via Splunk On-Call (acquired VictorOps) | ◐ (problems → external ITSM) | ◐ (cases; paging via connectors) | ◐ alarm notification rosters (voice/SMS/email) | ◐ alarm escalation, not IT-style on-call |
| **AI assistance** | ✅ Watchdog (auto-anomaly) + Bits AI (agentic RCA, chat, fixes) | ◐ Grafana Assistant/Adaptive Telemetry (Cloud/Ent); OSS: none | ◐ New Relic AI / SRE agent | ◐ (Splunk AI, ITSI predictive) | ✅ Davis AI causal engine (deepest, deterministic topology-based) | ◐ AI Assistant + ML anomaly jobs (Platinum+) | ◐ no native AI; 3rd-party analytics | ◐ PI has some analytics/AF event frames; no LLM |
| **Self-host option** | ❌ SaaS only | ✅ fully self-hostable free (AGPL/Apache) | ❌ | ❌ (Obs. Cloud; Splunk Enterprise self-hostable) | ◐ Managed offering for on-prem | ✅ self-managed incl. air-gapped | ✅ on-prem gateway server | ✅ on-prem by definition (OT) |
| **Industrial protocol support** | ❌ (SNMP yes; no OPC UA/Modbus/S7) | ◐ community plugins + Node-RED/telegraf bridges | ❌ | ❌ | ❌ | ❌ | ✅ OPC UA/UA server+client, MQTT/Sparkplug, S7, Modbus via drivers | ✅ native S7/OPC UA/OPC DA, fieldbus — the reason these exist |
| **Control / write-back (SCADA)** | ❌ read-only telemetry | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ HMI writes to PLC tags, command auth | ✅ full supervisory control |
| **Pricing model** | Per-product usage: Infra ~$15–23/host/mo; APM $31–40+/host/mo; logs $0.10/GB ingest + per-M-events indexing; RUM $1.50/1k sessions; synthetics $7.20/10k tests; custom metrics $5/100. HWMP/MHP metering | OSS free; Grafana Cloud usage-based (active series, GB logs/traces, users; generous free tier) | Per-GB ingest ($0.40/GB beyond 100 GB free) + full-platform user seats | Per host (infra ~$15, APM ~$45/host/mo) | DPS capability units / DDUs (~$29 host-equiv/mo) | Resource-based (compute+storage) or serverless per-GB (~$0.07–0.12/GB); self-managed license | Perpetual per-server license, **unlimited** tags/clients/screens (platform ~$1,200; suites ~$13.5k) | License by PowerTags/options (WinCC); AVEVA Flex credit subscription for PI |
| **Target user** | DevOps/SRE/platform teams in cloud-native IT orgs | OSS-oriented platform teams wanting control & open standards | App/dev teams wanting all-in-one with simple ingest pricing | Enterprise IT/SOC already on Splunk | Large enterprises wanting auto-instrumentation + causal AI | Search/log-heavy teams, Elastic shops, regulated (air-gap) | Plant engineers/integrators building HMI/SCADA/IIoT | Manufacturing/OT on Siemens (WinCC) or heavy-process industries (AVEVA PI) |

Sources: Datadog pricing & billing docs; monitoringcost.com cross-vendor table (June 2026 verification); vendorbenchmark.com; inductiveautomation.com pricing; Siemens WinCC Unified V19 system manual; aveva.com PI System pages; multiple vendor-comparison write-ups. Figures are list-price approximations.

### Reading the matrix for our project

- **No IT observability tool can natively talk to a PLC**, and **no SCADA tool does fleet-scale telemetry analytics** — our dashboard sits in the gap between the two rows at the bottom and the rest.
- The "on-call" column shows the only industrial analogue is *alarm notification rosters* (Ignition) — Datadog's On-Call/incident model is far richer and worth borrowing wholesale for shift-based escalation.
- Datadog is the **only** column where every row is ✅/◐ without external plumbing — its advantage is integration, not any single feature.

---

## 3. Gap analysis: Datadog vs the Grafana OSS stack

### 3.1 What Datadog gives you that Grafana OSS does not (out of the box)

| Datadog capability | Grafana OSS equivalent | The gap |
| --- | --- | --- |
| **Watchdog** — unsupervised anomaly detection across all telemetry, zero config | Nothing shipped. Grafana Cloud/Enterprise offers Adaptive Metrics & some ML; OSS requires you to author recording rules + alert rules for everything | DD surfaces "unknown unknowns"; OSS only finds what you thought to alert on. *Design lesson: a small auto-anomaly layer (e.g., rate-of-change or 3σ baselines computed per PLC tag) is high-value and cheap to add.* |
| **Managed, multi-channel notification pipeline** | Grafana Alerting routes to contact points you configure yourself (SMTP, webhooks); on-call paging needs Grafana IRM (paid) or PagerDuty | OSS alert *detection* is fine; the *notification→escalation→ack* chain is DIY. Datadog sells the whole chain. |
| **Correlation across signals by shared tags** | PromQL/LogQL/TraceQL are separate languages; correlation works but is manual (label discipline is on you) | DD enforces one tag model at ingestion so pivoting is structural, not a convention. |
| **1,000+ turnkey integrations w/ prebuilt dashboards + monitors** | ~150 data-source plugins; dashboards come from community gallery, uneven quality | Time-to-first-value: minutes vs days. |
| **SLO product** (error budgets, burn-rate alerts, SLO widgets) | Community patterns + Grafana Cloud SLO (limited) | SLOs as a managed object with dedicated UI — maps to our OEE/availability targets. |
| **Bits AI agentic investigation** | Nothing comparable in OSS; Grafana Assistant is Cloud-only | Auto-RCA is a SaaS differentiator. |
| **Downtimes / monitor mute windows as objects** | Silences exist but are simpler (no recurring schedules tied to maintenance windows as first-class) | Direct analogue: planned-maintenance windows suppressing alarms. |
| **Zero-ops operation** (retention, scaling, upgrades handled) | You run and scale Loki/Mimir/Tempo yourself (~0.1–1.5 FTE real cost) | The actual price of "free". |

### 3.2 What Grafana OSS / self-hosting gives you that Datadog does not

| Grafana stack capability | Datadog | Why it matters for industrial monitoring |
| --- | --- | --- |
| **Self-hosting / air-gapped deployment** | ❌ SaaS only | OT networks are frequently isolated (IEC 62443 zones); a plant floor cannot depend on `ap2.datadoghq.com`. This alone disqualifies Datadog for real SCADA. |
| **No per-host/per-GB metered bill** | Usage pricing compounds (hosts + custom metrics + indexed spans + GB + sessions) | Telemetry volume in plants is continuous and unbounded; an unmetered local historian is predictable cost. |
| **Data stays in your infrastructure** (audit-grade, immutable stores possible) | Data leaves the site | Regulatory/IP reasons (process data is trade-secret in many plants). |
| **Open standards end-to-end** (Prometheus exposition, OTLP, PromQL) | Proprietary agent, storage, query (lock-in) | Industrial data must outlive any vendor. |
| **Community/industrial bridges** — Telegraf/Node-RED edge collectors with Modbus/OPC UA inputs feeding Prometheus/Influx | None native | The realistic path to PLC data in a Grafana-style stack. |
| **Full source access** (AGPL/Apache) | Closed | Extensibility, offline operation, education (this is a thesis project). |

### 3.3 The synthesis gap (what neither gives us)

| Needed for SCADA-lite | Datadog | Grafana OSS | Conclusion for our design |
| --- | --- | --- | --- |
| PLC protocol ingestion (Modbus/S7/OPC UA) | ❌ | ◐ via third-party bridges | Must build a gateway/edge-collector layer ourselves |
| Deterministic low-latency display (<1 s poll) | ~15 s metric granularity | scrape-interval dependent | Design for local WebSocket push, not pull-metrics semantics |
| Control/write-back with safety interlocks | ❌ | ❌ | If any control is simulated, it needs its own auth + audit path, modeled on SCADA not observability |
| Alarm states as a first-class lifecycle (active/acked/shelved/RTN) | ◐ (monitor states approximate it; no shelving) | ◐ | Adopt ISA-18.2 alarm semantics; Datadog's monitor state machine is a good simplified model |
| Process graphics / mimic screens | ❌ | ◐ (custom SVG panels/canvas) | Datadog has no analogue — borrow the *chrome*, not the canvas |

---

## 4. "Is Datadog an ERP?"

**Direct answer: No.** Datadog is not an Enterprise Resource Planning system — it manages no business transactions (orders, procurement, inventory, invoices, general ledger, HR, payroll). But the question is worth taking seriously because **Datadog occupies the same architectural slot for operations telemetry that an ERP occupies for business transactions**: it is the *system of record* around which an organization's operational workflows, object model, and access control cohere. The analogy is instructive for our redesign.

### 4.1 Role analogy

| Dimension | ERP (SAP/Dynamics/Odoo) | Datadog | Our SCADA-lite dashboard |
| --- | --- | --- | --- |
| Domain of record | Business transactions & resources | Operational telemetry & incidents | Plant telemetry & alarms |
| Single source of truth for | "What did we sell/buy/owe/make" | "What is the system doing / what broke / who responded" | "What is the line doing / what alarmed / what did the operator do" |
| Core workflow | Order-to-cash, procure-to-pay, plan-to-produce | Detect → triage → escalate → resolve → postmortem | Sense → alarm → acknowledge → correct → log/report |
| User classes | Finance, procurement, warehouse, sales — each with role-scoped screens | SRE, dev, manager, exec — each with role-scoped views | Operator, supervisor, maintenance, admin |
| Master data | Customers, items, BOMs, GL accounts | Hosts, services, teams, monitors, SLOs (Software Catalog = master data) | Lines, stations, devices, PLC tags, alarm definitions, shifts |
| Audit trail | Immutable journal of transactions | Event stream + monitor state history + incident timeline + org audit trail | Alarm/event journal + operator action log |
| Multi-tenant/roles | Company → org units → users → permission sets | Org → teams → roles (Admin/Standard/Read-only) → scoped API keys | Plant → areas → roles (operator/supervisor/admin) |

### 4.2 Object-model comparison

| ERP objects | Datadog objects | Nature of equivalence |
| --- | --- | --- |
| Chart of accounts / GL | Metric namespace + tag schema | Both are the *taxonomic backbone*: everything posts against them |
| Items / inventory | Hosts, containers, services (Infrastructure List + Software Catalog) | Enumerated assets with attributes, ownership, state |
| Orders / invoices (transactional records) | Metrics points, log events, spans (time-series facts) | Append-only fact streams |
| Business rules / validations (credit limits, approval chains) | Monitors + thresholds + composite rules + downtimes | Declarative rules evaluated continuously against the fact stream |
| Exception queues (blocked orders, failed invoices) | Triggered monitors view, Watchdog anomalies, incidents | Work queues of things needing human action |
| Period close / reports | SLOs, notebooks/postmortems, usage reports | Periodic rollups that become management artifacts |
| Users, roles, cost centers | Users, teams, RBAC, usage attribution | Identity + accountability + cost allocation |

### 4.3 Where the analogy breaks

- **Transactions vs telemetry.** ERP facts are discrete, human-authored, and legally meaningful; Datadog facts are machine-generated, high-volume, and statistical. An ERP needs ACID; Datadog needs append throughput and retention tiers.
- **State mutation.** ERPs *change* business state (post, ship, pay). Datadog only observes state — it is deliberately read-only over the systems it watches (which is exactly why it can never replace SCADA: no control plane).
- **Latency regime.** ERP batch/OLTP seconds; Datadog near-real-time (~15 s metric granularity); SCADA hard real-time sub-second. Each layer down the Purdue model tightens the clock.

### 4.4 Design implication

Treating our dashboard as "the ERP-shaped system of record for the plant's telemetry" — rather than "a Grafana clone" — is the right frame. Concretely: own the **asset master data** (lines/stations/devices/signals), the **event journal** (alarms + operator actions as an immutable append-only log), the **rules** (alarm definitions as manageable objects with bulk ops, like Datadog's monitor manager), and the **periodic artifacts** (shift/production reports like Notebooks/SLOs). Datadog shows what that looks like when done well.

---

## 5. Feature relevance mapping: Datadog → industrial plant monitoring

| Datadog feature | Industrial analogue in our SCADA-lite system | What to borrow | Effort |
| --- | --- | --- | --- |
| Datadog Agent + integrations | **PLC gateway / edge collector** polling Modbus/S7/OPC UA registers into the backend | Agent auto-registration, heartbeat health, version reporting; tag-based identity for each collector | High (protocol work) |
| Infrastructure List / Host Map | **Asset list & plant overview map** — machines, stations, conveyors as "hosts" | Table with status pills (`OK/ALERT/LOGS`), inline %-bar cells, facet filters (line, station, vendor), group-by, host-map-style density grid for "all stations at a glance" | Medium — *already partially ported*: `COMPONENTS.md` maps infra/hosts → our pages |
| Metrics Explorer + tags | **Signal explorer** — ad-hoc trends of any PLC tag (`belt_speed`, `sensor_count`) | Omnibar tag query `line:sorting1 signal:temp`, group-by, time-range stepper | Medium |
| Dashboards + template variables | **Process overview & per-line dashboards** | Dashboard lists, shareable layouts; but canvas widgets → process graphics (mimic) instead of pure charts | Medium–High |
| Monitors (create wizard) | **Alarm rule editor** (Hi/HiHi/Lo/LoLo, deviation, rate-of-change, stale-value) | Numbered-step wizard, detection-method card grid, right sticky live preview, bottom action bar — directly ported already (`COMPONENTS.md` → `RuleCreatePage.tsx`, `/admin/rules/new`) | Low (pattern exists) |
| Monitors Manage (list/bulk) | **Alarm rule administration** — hundreds of rules | Checkbox bulk actions, group-header rows per alarm pack, mute/delete/tag-edit; our subset = **Ack** (ported to `AlarmsPage.tsx`) | Low (pattern exists) |
| Triggered monitors view | **Active alarm console** (ISA-18.2 list) | Filter by state/severity/priority; add ack/shelve semantics Datadog lacks | Medium |
| Downtimes | **Maintenance windows / planned suppression** | Recurring schedules that mute rules — essential to avoid alarm floods during PM | Low |
| SLOs | **OEE / availability & quality targets** per line | Error-budget framing → "availability budget"; SLO widgets → OEE tiles | Medium |
| Monitor Quality / Analytics | **Alarm system performance metrics** (alarms/hr, standing alarms, chattering) — Datadog's "Monitor Quality" answers "is our alerting itself healthy?" | Direct steal: alarm-rate KPIs are an ISA-18.2 requirement | Medium |
| Events Explorer | **Event/alarm journal** — every state change, setpoint change, operator action | Faceted event search + correlation grouping; becomes the audit trail | Medium |
| Logs Explorer + Live Tail + Patterns | **PLC/gateway message stream** — raw device comms, errors, operator notes | Live Tail = "message window" every HMI has; Patterns = auto-clustering repeated faults | Medium |
| Notebooks | **Shift reports, downtime analyses, experiment docs** | Documents embedding live plant charts — report generation without a reporting module | Medium |
| Incidents + On-Call | **Downtime events + escalation rosters** | Incident = extended alarm→cause→timeline→resolution record; on-call = shift/maintenance roster with paging | Medium |
| Watchdog | **Auto-anomaly hints** — e.g., "sensor drift on station 3", "unusual reject rate" | Cheap baseline stats per signal, surface as suggestions not alarms | Medium–High |
| Bits AI | (future) natural-language plant queries, auto-shift-summary | Out of scope for core; keep chat-shaped slot in IA | Deferred |
| Software Catalog | **Asset registry metadata** — owner, manual links, criticality per machine | Entity pages linking asset → its signals/alarms/incidents | Medium |
| Org settings / users / keys | **Plant admin** — users, roles (operator/supervisor/admin), API tokens for gateway | In-content admin nav + user cards (ported: `AdminNav.tsx`) | Low |
| Integrations page | **Device/driver catalog** — which PLC drivers/connections configured | Cards per connection with config state | Medium |
| Command palette (⌘K) | **Global jump** — to any station/alarm/dashboard by name | Search pill in topbar; recents | Low |
| Synthetics | **Simulated transactions on the line** — e.g., inject a test piece through the simulated sorter on a schedule to verify end-to-end health | Scheduled end-to-end probes; nice match for a *simulated* plant | Low–Medium |
| RUM / Session Replay / APM traces / Profiler / DDSQL | — | No plant analogue; omit | — |

### 5.1 Patterns already absorbed (from `COMPONENTS.md` R2/R3 notes)

The corpus records the porting work already done: monitor-create wizard → `/admin/rules/new` (`RuleCreatePage.tsx`); org-settings in-content nav → `AdminNav.tsx`; manage-list bulk-select + Ack bar + group headers → `AlarmsPage.tsx`; measured hover deltas → `Shell.tsx`. The remaining high-value captures to port next: **infra host-list pattern** (omnibar + facets + status-pill cells + %-bars) → asset list; **triggered-monitors view** → alarm console; **downtimes** → maintenance windows; **notebooks** → shift reports.

---

## 6. Risks & caveats

- **Pricing numbers are volatile** — all $ figures are list-price approximations from mid-2026 vendor pages/third-party benchmarks; re-verify if quoted in the thesis.
- **Captured evidence is one tenant/one region (ap2) and partial** — `COMPONENTS.md` lists known gaps: dashboard widget internals, monitor-detail drawer internals, keyboard-shortcut sheet, dark-mode content surface (app is light-themed; dark exists only in chrome).
- **Datadog ≠ SCADA** — it has no control plane, no sub-second latency, no OT protocols, and no offline operation. We borrow UX architecture and workflows, not suitability.
- **Watchdog/Bits AI claims are vendor marketing** — treat "90% faster MTTR" style numbers as directional.

## 7. Sources

- Local corpus: `E:\03_Thesis\webservice\ref\datadog\live\COMPONENTS.md`, `pages-all.txt`, `*-components/vocab/layout/text.json` (27 pages), `r1–r3/` screenshots & states.
- Datadog docs: getting-started/application, infrastructure, monitors, bits_ai, incident AI, billing/pricing (`docs.datadoghq.com`).
- Datadog blog: "A closer look at our navigation redesign" (datadoghq.com/blog).
- Pricing: datadog.com/pricing; cloudzero.com & vendorbenchmark.com Datadog breakdowns; monitoringcost.com 7-vendor comparison (verified June 2026).
- Grafana comparisons: tech-insider.org, founding.dev, fastero.com, groundcover.com, stribog.com guides.
- Industrial: inductiveautomation.com (Ignition pricing/editions/unlimited licensing, OPC UA/MQTT); Siemens WinCC Unified V19 system manual & product page (PowerTags, alarm classes, OPC UA/GraphQL, redundancy); aveva.com (PI System / PI Server, Flex credits).
