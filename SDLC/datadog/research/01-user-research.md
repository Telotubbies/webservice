# Datadog — SDLC User Research

**Workstream question:** *"ใครใช้งาน และต้องตัดสินใจอะไรในแต่ละวัน"* — Who uses Datadog, and what decisions do they have to make every day?

**Purpose:** Study Datadog's complete user flow as reference for redesigning an industrial monitoring dashboard.

| | |
| --- | --- |
| Product | Datadog (observability SaaS, `datadoghq.com`; analyzed org on `ap2.datadoghq.com`, EU site) |
| Document | `SDLC/datadog/research/01-user-research.md` |
| Research method | Desk research: official Datadog documentation + product pages, plus live UI captures of a trial org (Oct 2025 crawl, passes r1–r3) stored under `ref/datadog/live/` |
| Status | Draft for team review |

**Sources and evidence convention:**

- **[DOC]** — official Datadog documentation/product page (URL in References).
- **[CAP]** — local capture under `ref/datadog/live/` (screenshots `*.png`, extracted DOM text `*-text.json` / `dd-text.json`, measured styles `*-components.json`, spec summary `COMPONENTS.md`).
- **[INF]** — inference: plausible and consistent with evidence, but not directly verified. Treat as a hypothesis to validate in later research.

Key local evidence:

- `ref/datadog/live/COMPONENTS.md` — measured UI spec (rail, topbar, tables, statuses, interaction states).
- `ref/datadog/live/pages.txt`, `pages-all.txt` — 27 captured product surfaces with real URLs.
- Screenshots: `r2/monitors/page.png`, `r2/monitors/app.png`, `r3/dd-monitors-1920.png`, `r2/dashboards/page.png`, `r2/infra/page.png`, `r3/infra-hosts.png`, `r2/logs/page.png`, `r2/events/page.png`, `r2/watchdog/page.png`, `r2/notebook/page.png`, `r2/org/page.png`, `r2/apm.png`, `r3/apm-services.png`, `r2/moncreate.png`, `r2/notif.png`, `r2/app-admin-users.png`, `r2/settings.png`, `r2/app-palette.png`, `r3/states.json`.

---

## 0. Product surface map (what "the app" actually is)

Datadog is not one screen — it is a suite of ~30 products behind a shared shell. The left icon rail (measured: fixed, 50 px collapsed / 160 px expanded, `bg #292e39`, `z-100`; `COMPONENTS.md` §AppRail) groups products into sections. The captured DOM confirms the real rail entries **[CAP: r2/*/dd-text.json]**:

> **Incident Response · Automation · Infrastructure · Cloud Cost · APM · Digital Experience · Software Delivery · Security · Data Observability · AI Observability · Errors · Metrics · Logs · Integrations** — plus top-bar utilities: global search (Cmd-K pill), Invite, Support, Help.

Captured surfaces (from `pages-all.txt`) and their role in daily work:

| Left-rail area | Captured URL(s) | What lives there |
| --- | --- | --- |
| Dashboards | `/dashboard/lists` | Dashboard lists, preset lists (All Custom / All Hosts / All Integrations / Created By You), Teams filter, Reports **[CAP: r2/dashboards/page.png]** |
| Metrics | `/metric/explorer` | Ad-hoc metric querying **[CAP: r2/metrics/page.png]** |
| Infrastructure | `/infrastructure` (hosts) | Host list: omnibar query tokens, `Group by`, facet panel ("My Teams", provider checkboxes), status pills (`8 OK` / `1 ALERT` / `4 LOGS`), inline % bars, time stepper **[CAP: r3/infra-hosts.png; COMPONENTS.md §infrastructure/hosts]** |
| APM | `/apm/services`, `/apm/traces` | Service catalog + trace search **[CAP: r3/apm-services.png, r2/apm.png]** |
| Logs | `/logs` | Log explorer / patterns **[CAP: r2/logs/page.png]** |
| Monitors | `/monitors/manage`, `/monitors/triggered`, `/monitors/downtimes`, `/monitors/quality`, `/monitors/settings`, `/monitors/create`, `/monitors/:id` | Alert definitions + alert state. Sub-nav captured verbatim: `List \| Triggered \| Downtimes \| Quality \| Analytics \| Settings` + `Browse Templates`, `+ New Monitor`. Bulk bar: `Mute · Resolve · Delete · Edit Tags · Edit Recipients · Edit Teams · Export to Terraform` **[CAP: r3/dd-monitors-1920.png; r2/monitors/dd-text.json]** |
| Watchdog | `/watchdog` | ML anomaly feed: facets `Alert Category / Alert Type / Alert Status (Ongoing · Expired · Resolved)`, "Save to Dashboard" **[CAP: r2/watchdog/page.png, dd-text.json]** |
| Event Management | `/event/explorer` | `Triage Inbox \| All Events \| Summary`; visualize as List / Timeseries / Top List / Table / Patterns; facets Source/Host/Service/Status **[CAP: r2/events/page.png, dd-text.json]** |
| Incident Response | `/incidents` + On-Call | Incidents (SEV levels, commander, timeline, postmortem) and Pages/schedules **[CAP: incidents-*.json; DOC]** |
| Notebooks | `/notebook/list` | Collaborative docs; built-in templates captured: **Postmortem, Runbook, Incident Report, Computational Analysis** **[CAP: r2/notebook/page.png, dd-text.json]** |
| Other captured | `/slo`, `/synthetics/tests`, `/rum`, `/error-tracking`, `/containers`, `/security/home`, `/software-catalog`, `/sheets`, `/ddsql/editor`, `/bits-ai/investigations`, `/account/team` | SLOs, synthetic tests, RUM, errors, containers, Cloud SIEM/security signals, service catalog, spreadsheet-like Sheets, SQL-over-telemetry (DDSQL), Bits AI investigations, team admin |
| Org/Admin | org settings users | In-content left admin nav (`IDENTITY & ACCOUNTS / AUTHENTICATION / ACCESS`), invite users, status dots **[CAP: r2/app-admin-users.png, r2/org/page.png; COMPONENTS.md §organization-settings]** |

**Design note for our project:** every list surface shares the same grammar — omnibar query + left facet panel + bulk-capable table + right-side actions (Export / Columns / time stepper) — and the same shell (50 px rail + 36 px dark topbar + 44 px white pagebar). The product is many consoles that behave identically **[CAP: COMPONENTS.md]**.

---

## 1. Personas

Datadog's own access model frames three managed roles — **Datadog Admin**, **Datadog Standard**, **Datadog Read Only** — with custom roles/teams layered on top **[DOC: rbac, permissions]**. Real usage, however, is organized by *job*, not by the role name. The personas below are the seven jobs that matter for a monitoring-dashboard redesign. Persona names and day-in-the-life details are **[INF]**; the surfaces they live in are **[CAP]/[DOC]**.

### P1 — SRE / On-Call Responder ("the one who gets paged")

- **Profile:** Site Reliability Engineer or ops engineer carrying the pager via Datadog On-Call (Pages have lifecycle `Triggered → Acknowledged → Resolved`, driven by escalation policies and schedules) **[DOC: on-call, pages]**.
- **Goals:** Detect real problems fast, acknowledge ownership, restore service, minimize MTTR and alert fatigue.
- **Daily decisions:**
  - Is this page/alert real or noise? → *acknowledge, mute, or escalate?*
  - Is this severe enough to declare an incident (SEV-1…SEV-5, assign Incident Commander)? **[DOC: declare]**
  - Do I fix it myself or escalate to the owning team (via `team:` handle / On-Call team routing)? **[DOC: teams, on-call]**
  - Is the remediation working — did the monitor recover and the page auto-resolve? **[DOC: pages]**
- **Pain points:** alert storms / duplicate pages; context scattered across metrics+logs+traces; 3 a.m. triage with incomplete runbooks; noisy monitors eroding trust.
- **Surfaces they live in:** Monitors → **Triggered** view and bulk ack/mute bar **[CAP: r3/dd-monitors-1920.png]**; **Event Management → Triage Inbox** **[CAP: r2/events/page.png]**; **Watchdog** anomaly feed **[CAP: r2/watchdog/page.png]**; **Incidents** and **On-Call** pages; monitor notification routing **[CAP: r2/notif.png]**; Notebooks runbook template during response **[CAP: r2/notebook dd-text.json]**.

### P2 — Platform Engineer / Observability Engineer ("the one who builds the paved road")

- **Profile:** Owns the observability platform itself: agents, integrations, monitor-as-code, tagging standards, other teams' onboarding.
- **Goals:** Standardized, governed telemetry; monitors defined as code; sane org-wide defaults.
- **Daily decisions:**
  - Which integrations to enable; which tags are mandatory (e.g. `team:` required on monitors — Team Tag Enforcement exists for this) **[DOC: teams-and-access]**.
  - Does a new monitor template get rolled out to a whole "monitor pack"? **[CAP: r2/monitors — monitor packs + "Recommended templates" in dd-text.json]**
  - Export/encode monitors to Terraform (bulk bar has **Export to Terraform**) **[CAP: r2/monitors/dd-text.json]**.
  - Who is allowed to edit org-critical assets (granular access controls per dashboard/monitor) **[DOC: protecting-assets]**.
- **Pain points:** configuration drift vs. Terraform; teams creating alert spam; no visibility into *who changed what* → Audit Trail (100+ event types, API request events, per-asset diff "Inspect Changes") **[DOC: audit-trail]**.
- **Surfaces:** Monitors → Manage/Quality/Settings/Analytics **[CAP: monitors-* pages]**; Integrations; Organization Settings → users/roles/teams **[CAP: r2/app-admin-users.png, r2/org/page.png]**; Audit Trail; Software Catalog/Teams **[CAP: catalog-*, team-* json]**.

### P3 — Application Developer / Service Owner ("did my deploy break something?")

- **Profile:** Product engineer owning 1–N services; not an ops specialist. Cares about *their* service only.
- **Goals:** Ship safely; verify deploys; own their service's health end-to-end.
- **Daily decisions:**
  - After a deploy: is latency/error rate on *my* service regressed? (APM service page + deployment markers) **[CAP: r3/apm-services.png]**.
  - Which trace/span explains the slow request? (APM → Traces) **[CAP: apm-traces-* json]**.
  - Is that error new? (Error Tracking dedupes into "issues") **[CAP: error-tracking-* json]**.
  - Should I add a monitor/dashboard for my service? (template-driven monitor creation wizard) **[CAP: r2/moncreate.png; COMPONENTS.md §monitors/create]**.
- **Pain points:** query languages (the omnibar is powerful but terse); too much telemetry that isn't theirs — the **Teams / "My Teams" facet filter** exists precisely to scope views to owned assets **[CAP: r3/infra-hosts.png facet panel; DOC: teams]**.
- **Surfaces:** APM Services + Traces, Error Tracking, Logs (filtered `service:`), Dashboards (their team's), Monitors scoped to their service, Watchdog service anomalies.

### P4 — DevOps / Observability Lead or Incident Commander ("the one who runs the incident")

- **Profile:** Senior engineer/lead who coordinates response when something crosses team boundaries; may be designated **Incident Commander** on a declared incident **[DOC: declare]**.
- **Goals:** Coordinated response, accurate comms, provable postmortem.
- **Daily decisions:**
  - Declare incident vs. keep working a monitor alert? Severity level? Who is commander/responder? **[DOC: declare, response-team]**.
  - Which responders to pull in and what roles to assign them (responder types are deliberately *not* RBAC) **[DOC: response-team]**.
  - What goes in the timeline/status updates; when to move state to Resolved.
  - What the postmortem says — incidents auto-generate postmortems; Notebook "Postmortem" template exists **[DOC: incident-management; CAP: r2/notebook dd-text.json]**.
- **Pain points:** assembling evidence from 4 products into one narrative (Datadog's answer: Clipboard → declare incident with graphs attached; incident page sections Overview / Timeline / Post-Incident / Notifications) **[DOC: getting-started-incident]**.
- **Surfaces:** Incidents list/detail, Slack `/dd incident` bridge, Dashboards during war-room, Notebooks postmortem, Monitors.

### P5 — Security Engineer / SOC Analyst ("is that signal malicious?")

- **Profile:** Monitors Cloud Security/Cloud SIEM signals, audit events, sensitive-data exposure.
- **Goals:** Detect threats in cloud/app telemetry; meet compliance; govern the platform itself.
- **Daily decisions:**
  - Triage security signals: real threat vs. false positive; suppress or escalate?
  - Any anomalous *platform* behavior — who changed roles, pipelines, retention? (Audit Trail: request events + product events, "notable events" flagging config changes with billing/security impact) **[DOC: audit-trail-events, audit-trail]**.
  - Are detection rules tuned? Which rules page a team vs. log quietly?
- **Pain points:** signal volume; proving compliance for audits (Audit Trail exports support HIPAA/PCI/SOX/GDPR-style reporting) **[DOC: product-audit-trail]**.
- **Surfaces:** Security home/signals **[CAP: security-* json]**, Audit Trail, Logs/Events (security source), Monitors (log-based detection), On-Call (security signals can page teams) **[DOC: pages]**.

### P6 — Engineering Manager / Executive ("are we reliable, and what did it cost?")

- **Profile:** Director/VP, or business stakeholder. Typically **Read Only** role **[DOC: rbac — "Use for stakeholders, executives, or audit users"]** — consumes, rarely edits.
- **Goals:** Reliability posture per team/service; incident trends; cost control.
- **Daily decisions:**
  - Are we meeting SLOs? Which service/team is the risk? (SLO list + "Reliability Overview by Service / by Team" preset dashboards) **[CAP: r2/dashboards dd-text.json — preset list titles]**.
  - What did last week's incident cost / are incidents trending up? (Incidents analytics, Notebooks "Incident Report" template, dashboard Reports) **[CAP: r2/notebook dd-text.json; DOC]**.
  - Is observability spend justified? (Cloud Cost rail section; Usage/billing views) **[CAP: rail sections; INF on depth of use]**.
- **Pain points:** raw telemetry is too dense — needs roll-ups (team hierarchy roll-up filtering exists for director/VP views) **[DOC: teams-manage]**; shared-dashboard links vs. needing an account.
- **Surfaces:** Dashboards (shared/reports), SLOs, Incidents list, Cloud Cost, Reports. Rarely touches Logs/Traces.

### P7 — Org Admin / FinOps Owner ("who has access, and why is the bill growing?")

- **Profile:** Admin role holder managing users, SSO, API keys, billing/usage; sometimes a distinct FinOps function **[DOC: rbac — admin manages billing, API keys, users]**.
- **Goals:** Least-privilege access, predictable cost, auditability.
- **Daily decisions:**
  - Invite/disable users; assign roles; create custom roles/teams (Admin nav: `IDENTITY & ACCOUNTS / AUTHENTICATION / ACCESS`) **[CAP: r2/app-admin-users.png; COMPONENTS.md §organization-settings]**.
  - Which log indexes/retention drive the bill — audit events literally track "retention changed → monthly bill changed" **[DOC: audit-trail]**.
  - Approve plan/usage changes (topbar trial banner "14 days left" + Upgrade is this persona's doorway) **[CAP: r2/*/dd-text.json topbar]**.
- **Pain points:** cost attribution per team; RBAC granularity vs. manageability; admins locking themselves out of team-restricted assets **[DOC: protecting-assets — warns about exactly this]**.
- **Surfaces:** Organization Settings (users, roles, teams, auth), Usage & billing, Audit Trail, Cloud Cost.

### Persona → surface matrix (summary)

| Persona | Dashboards | Monitors | Events/Triage | APM/Traces | Logs | Watchdog | Incidents/On-Call | Notebooks | Admin/Audit |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| P1 SRE on-call | ○ | ● | ● | ◐ | ◐ | ● | ● | ◐ | – |
| P2 Platform eng | ◐ | ● | ○ | ○ | ○ | ◐ | ○ | ○ | ● |
| P3 App dev | ◐ | ◐ | – | ● | ● | ○ | ○ | ○ | – |
| P4 Incident cmdr | ● | ◐ | ◐ | ◐ | ◐ | ○ | ● | ● | – |
| P5 Security eng | ○ | ◐ | ● | – | ◐ | ○ | ◐ | ○ | ● |
| P6 Exec | ● | – | – | – | – | – | ○ | ○ | – |
| P7 Admin/FinOps | – | ○ | – | – | – | – | – | – | ● |

(● primary home, ◐ regular, ○ occasional, – rare) — **[INF]** from product structure, not measured usage data.

---

## 2. Jobs-to-be-Done

Format: *When [situation], I want to [job], so I can [outcome].* Mapped to the real surface where the job happens.

| # | Job statement | Primary surface / UI evidence |
| --- | --- | --- |
| 1 | **Alert triage** — When a monitor fires (or a Page arrives), I want to see what's triggering, grouped and filterable, so I can decide to acknowledge, mute, or escalate within minutes. | Monitors → **Triggered** list; bulk bar `Mute / Resolve / Edit Recipients` **[CAP: r3/dd-monitors-1920.png]**; On-Call Pages `Triggered→Acknowledged→Resolved` **[DOC: pages]** |
| 2 | **Noise control** — When the same alert storms during maintenance, I want to schedule downtime or mute by tag, so the team isn't paged for known work. | Monitors → **Downtimes** sub-tab **[CAP: pages.txt monitors-downtimes]**; Mute bulk action **[CAP]** |
| 3 | **Incident investigation** — When an alert looks real, I want to pivot from the alert to related metrics/logs/traces/events with time preserved, so I can find the blast radius and root cause without re-typing queries. | Monitor detail → linked telemetry; Event Explorer facets `Source/Host/Service/Status` **[CAP: r2/events dd-text.json]**; APM traces **[CAP: apm-traces-*.json]**; Watchdog "Save to Dashboard" **[CAP: r2/watchdog dd-text.json]** |
| 4 | **Escalation & ownership** — When I can't fix it, I want to see *who owns* this service/monitor and page that team, so the right humans get involved. | `team:`/`teams:` handles as facets everywhere **[DOC: teams]**; On-Call team routing rules + escalation policies **[DOC: on-call]**; bulk `Edit Teams` on monitors **[CAP]** |
| 5 | **Incident declaration & coordination** — When impact crosses teams or touches customers, I want to declare an incident with severity + commander and run response in one place, so comms and timeline are automatic. | Incidents; declare from monitor/graph/On-Call page; SEV-1…SEV-5; Overview/Timeline/Post-Incident/Notifications **[DOC: declare, incident-management]** |
| 6 | **Deploy verification** — When I ship a change, I want to watch my service's latency/errors and new error issues right after deploy, so I can roll back fast if it regressed. | APM service view + deployment markers **[CAP: r3/apm-services.png]**; Error Tracking **[CAP: error-tracking-*.json]**; RUM for client side **[CAP: rum-*.json]** |
| 7 | **Capacity planning** — When planning next quarter, I want historical host/container utilization trends, so I can right-size infrastructure. | Infra host list % bars + Metrics explorer; `Group by` + Export **[CAP: r3/infra-hosts.png; COMPONENTS.md §infrastructure/hosts]** |
| 8 | **Cost review** — When the bill grows, I want usage/telemetry cost per team/product and an audit of who changed billable config (indexes, retention), so I can attribute and reduce spend. | Cloud Cost rail section; Org usage; Audit Trail "retention change → bill" events **[DOC: audit-trail]** |
| 9 | **On-call handoff** — When my shift ends, I want the schedule, open pages, and ongoing incidents visible to the next responder, so nothing is dropped at handoff. | On-Call schedules/rotations (Interrupt Handler / Primary / Secondary proposal) **[DOC: on-call-teams]**; Incidents `state:active` query **[DOC: incident-management]** |
| 10 | **Postmortem / review** — When an incident resolves, I want the timeline, graphs, and root cause assembled into a shareable record, so we learn and can prove the fix. | Incident Post-Incident section + generated postmortem **[DOC: getting-started-incident]**; Notebook **Postmortem** template **[CAP: r2/notebook dd-text.json]** |
| 11 | **Governance check** — When onboarding a new team, I want their monitors tagged, alert quality visible, and edit rights scoped, so standards hold as the org scales. | Monitors → **Quality** + **Analytics** sub-tabs **[CAP: pages.txt]**; Team Tag Enforcement; per-asset access **[DOC: teams-and-access, protecting-assets]** |

---

## 3. End-to-end user journey: Detect → Triage → Investigate → Remediate → Review

This is the canonical operational loop. Each stage maps to concrete Datadog surfaces/nav entries.

### Stage map

| Stage | Trigger | Datadog surface(s) — left rail / nav | Key decision | Exit |
| --- | --- | --- | --- | --- |
| **1. Detect** | Monitor threshold crossed; Watchdog anomaly; security signal; synthetic failure; external report | **Monitors** (state change), **Watchdog**, **Event Management → Triage Inbox**, **On-Call Page** delivered via routing rules | "Did we see it?" (detection coverage is itself configured here — "monitor packs", recommended templates) **[CAP: r2/monitors]** | Alert/Page exists |
| **2. Triage** | Page/alert notification (Slack, email, mobile) or human scanning Triggered list | Monitors → **Triggered** (bulk Mute/Resolve), On-Call page **Ack**, Triage Inbox severity facets | Real or noise? Mine or another team's? Severity? Declare incident or not? | Alert owned, muted, or escalated → declared incident |
| **3. Investigate** | Acknowledged alert/incident open | Pivot: Monitor detail → **Metrics explorer**, **Logs**, **APM services/traces**, **Error Tracking**, **Infra hosts/containers**; compare against **Dashboards**; **Bits AI** investigations optional; gather into Clipboard/Notebook | What's the blast radius? What's the root cause? Who else is impacted? | Hypothesis confirmed; fix identified |
| **4. Remediate** | Fix identified | Action happens *outside* Datadog (deploy, config, restart); inside Datadog: **declare/update Incident** (severity, responders, status), notification rules to stakeholders, watch monitors for recovery → Page auto-`Resolved` **[DOC: pages]** | Fix or rollback? Who needs notifying? Is it actually recovering? | Monitors recover; incident state → Resolved |
| **5. Review / Postmortem** | Incident resolved / weekly review | **Incidents → Post-Incident** + generated postmortem; **Notebooks** (Postmortem / Incident Report templates); **Monitors → Quality & Analytics** to tune noisy alerts; **SLO** error-budget impact; **Audit Trail** if change-related | What do we change — alerts, runbooks, code, capacity? Was detection fast enough? | New/edited monitors, runbooks, follow-up tasks; better coverage next loop |

### Walkthrough (P1 + P4 collaboration — the "bad Tuesday" path)

1. **Detect:** A host-pack monitor (`CPU usage is high for host {{host.name}}` — real captured monitor name **[CAP: r2/monitors dd-text.json]**) crosses ALERT → Page routed through team escalation policy to on-call SRE **[DOC: on-call]**.
2. **Triage:** SRE opens **Monitors → Triggered**, sees 14 correlated alerts, bulk-acks the pack, checks **Watchdog** for a related anomaly card, decides blast radius is customer-facing → clicks **Declare Incident** from the monitor, sets SEV-2, assigns themselves Incident Commander **[DOC: declare]**.
3. **Investigate:** Incident timeline collects evidence. SRE pivots monitor → **APM services** (error rate spike on `payments`), drills to **Traces**, then **Logs** filtered `service:payments`, confirms a bad deploy via deployment markers. Adds `payments-team` responder type; posts status update that fans out via notification rules **[DOC: incident-management]**.
4. **Remediate:** `payments` owner rolls back. SRE watches the monitor recover; Page auto-resolves; incident state → Resolved; customer-impact fields filled in.
5. **Review:** Postmortem auto-generated into a Notebook (Postmortem template). DevOps lead tunes the noisy CPU pack in **Monitors → Quality**; capacity concern logged for P7; exec reads the "Reliability Overview by Service" dashboard next morning **[CAP: r2/dashboards dd-text.json]**.

**Pattern that matters for our redesign:** the loop is *state-machine-like at the edges* (alert → page → incident → resolved) but *free-form exploratory in the middle* (investigate/remediate hop across any surface via links, facets, and a shared query language). The navigation supports both: permanent rail for jumping, cross-links/Clipboard for pivoting **[INF, strongly suggested by cross-product deep links in DOC]**.

---

## 4. Is Datadog's user model an ERP? — Operations console with ERP traits

**Short answer: No.** Datadog is not ERP-shaped. It is an **operations console** — event/stream-driven, exploratory, telemetry-centric — that has deliberately imported several ERP-style governance features for enterprise scale.

### Why it is not an ERP

| ERP characteristic | In Datadog? | Evidence |
| --- | --- | --- |
| Transactional master records (orders, invoices, BOMs) as the core objects | **No** — core objects are *telemetry streams* (metrics, logs, traces, events) and *detectors* (monitors, SLOs). Even "Incidents" and "Pages" are lightweight state machines over streams, not ledger records. | Product taxonomy in rail **[CAP]**; docs describe data model as telemetry + tags **[DOC]** |
| Form-driven, role-determined workflows (create → approve → post) | **Mostly no** — the dominant interaction is *query → facet → visualize → pivot*, not form-filling. Monitors → Create is a wizard (numbered steps + live preview) **[CAP: r2/moncreate.png; COMPONENTS.md §monitors/create]**, and incident declaration is a modal, but these are exceptions that *enter* the exploratory flow, not the substance of it. | Omnibar + facets pattern on infra/logs/events **[CAP]** |
| Users "do their job" inside predetermined screens per role | **No** — the same person roams the whole rail during one incident (§3 walkthrough). Roles gate *capabilities*, not *which screens exist*. | RBAC modifies permissions on assets, not workflow steps **[DOC: rbac]** |

What Datadog *is*: closer to a **network-operations-center console / IDE-for-telemetry**:

- **Event/stream-driven:** primary data arrives unbidden (agent push, monitor state changes, pages). UI is built for scanning *streams* — Event Explorer, Triggered monitors, Watchdog feed — rather than completing records **[CAP: r2/events, r2/watchdog, r3/dd-monitors-1920.png]**.
- **Exploratory, query-first:** every surface shares the omnibar + facet + visualization-mode grammar (`List / Timeseries / Top List / Table / Patterns` on Events **[CAP: r2/events dd-text.json]**; `Group by` + query tokens on Infra **[CAP: r3/infra-hosts.png]**). Skill = composing queries and pivoting, like an analyst tool.
- **Time as the universal join key:** a global time-range stepper (15m … ◀ ▶ **[CAP: r3/infra-hosts.png]**) and shared tags/`team:` handles let users carry context across products — an ERP joins on document IDs; Datadog joins on *time + tags*.

### ERP traits it *does* share — and we should copy deliberately

| ERP-like trait | Datadog implementation | Relevance to industrial dashboard |
| --- | --- | --- |
| Role-based access | 3 managed roles + custom roles, permission catalog, inheritance **[DOC: rbac, permissions]** | Same need: operator vs. engineer vs. admin |
| Org/team scoping of assets | Teams + `team:` handles, team filter on every list, team-based edit restrictions, hierarchy roll-ups **[DOC: teams, teams-manage]** | Map to shifts/areas/production lines |
| Audit trails | Audit Trail: 100+ event types, API request events, per-asset change diffs, compliance exports **[DOC: audit-trail]** | Regulatory traceability for who-acknowledged-what |
| Governance of "records" | Monitor Quality/Analytics, tag enforcement policies, per-asset granular ACLs **[CAP: pages.txt monitors-quality; DOC: teams-and-access]** | Alarm rationalization / governance of alarm rules |
| Scheduled workflows | On-Call schedules, escalation policies, downtimes (maintenance windows) **[DOC: on-call; CAP: monitors-downtimes]** | Shift handoff + planned-maintenance suppression — near-identical need |

### Implication for our industrial monitoring redesign **[INF]**

The right model to borrow is the **console**: stream-first alarm feed (Triggered/Triage Inbox pattern), global time context, facet-driven scoping by `team`/area/asset, and pivot links from alarm → trend → asset detail. Layer the **ERP traits** only where they earn their complexity: RBAC + team scoping + audit trail for acknowledgements and alarm-rule edits. Resist ERP-style record forms as the primary interaction — Datadog's own evidence shows operators live in lists, facets, and graphs, not forms.

---

## 5. Open questions / gaps for next research steps

1. Real usage frequency per surface — we have captures, not analytics. **[INF] persona↔surface matrix needs validation against practitioner reports or Datadog case studies.**
2. Monitor detail drawer and dashboard widget internals were never captured (`COMPONENTS.md` coverage gaps) — investigate→pivot UX details inferred from docs.
3. On-Call mobile experience / actual page-notification UX not captured (only `r2/notif.png` settings).
4. Bits AI (automated investigation) is emerging — its effect on persona P1's decisions is undocumented here.

---

## References

**Local captures** — `E:\03_Thesis\webservice\ref\datadog\live\`: `COMPONENTS.md`; `pages.txt`; `pages-all.txt`; `r2/{monitors,dashboards,infra,logs,metrics,events,watchdog,notebook,org}/page.png` + `dd-text.json`; `r2/{apm,moncreate,notif,app-admin-users,settings,app-palette}.png`; `r3/{dd-monitors-1920,infra-hosts,apm-services,app-alarms-1920,diff-1920}.png`, `r3/states.json`; `*-{components,layout,vocab}.json` per surface.

**Datadog documentation:**

- RBAC: `docs.datadoghq.com/account_management/rbac/` · `/rbac/permissions/` · `/getting_started/access_for_enterprises/permissions/` · `/getting_started/access_for_enterprises/protecting_assets/`
- Incident Response: `docs.datadoghq.com/incident_response/incident_management/` · `/investigate/declare/` · `/investigate/response_team/` · `docs.datadoghq.com/getting_started/incident_management/`
- On-Call: `docs.datadoghq.com/incident_response/on-call/` · `/pages/` · `/escalation_policies/` · `/schedules/` · `/teams/`
- Teams: `docs.datadoghq.com/account_management/teams/` · `/teams/manage/` · `/account_management/guide/teams-and-access/` · `docs.datadoghq.com/getting_started/teams/`
- Audit Trail: `docs.datadoghq.com/account_management/audit_trail/` · `/audit_trail/events/` · `/audit_trail/guides/track_monitor_access_and_configuration_changes/` · `datadoghq.com/product/audit-trail/`
