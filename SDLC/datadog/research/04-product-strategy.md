# 04 — Product Strategy: Lessons from Datadog for a SCADA-lite Plant-Ops Platform

**Series:** `SDLC/datadog/research` · Doc 04 of the Datadog study set
**Subject:** Datadog, Inc. (datadoghq.com) — external product study, *not* a local project.
**Purpose:** derive a product strategy for our industrial monitoring dashboard —
a "SCADA-lite" web console that today drives a Factory I/O simulated sorting
plant, later a Siemens PLC line: real-time telemetry, alarms, trends, supervised
machine control, vision, multi-tenant.

**Key question (from the team, in Thai):**
> ฟีเจอร์ใดจำเป็นต่อ MVP และอะไรสร้างความแตกต่าง
> *Which features are essential for the MVP, and what creates differentiation?*

**Short answer.** MVP-essential: a trustworthy live data spine (ingest → live
tags → mimic), alarms you can acknowledge, supervised command writes with
confirmation, per-org roles, and an audit log. Differentiating: browser-native
OT console with genuine multi-tenancy, MQTT edge gateways with store-and-forward,
computer-vision context bound to alarms/equipment, and ERP-adjacent hooks
(batch records, traceability) — none of which Datadog offers, and most of which
classic SCADA delivers badly.

---

## 1. How Datadog grew — the playbook worth copying

A compressed history, because the *sequence* is the lesson (sources in §7).

| Year | Move | Why it mattered |
| --- | --- | --- |
| 2010 | Founded (Olivier Pomel, Alexis Lê-Quôc, ex-Wireless Generation) | Founding thesis: break the Dev/Ops silo with one real-time data platform. |
| 2012 | First product: **Infrastructure Monitoring** | The wedge. One agent, every host, immediate time-to-value. |
| 2017 | **APM** launched | Second product on the *same* telemetry spine — metrics, then traces. |
| 2018 | **Log Management** — first vendor to ship all "three pillars of observability" | Land-and-expand went exponential: one contract, three bills. |
| 2019 | **RUM** + Network Performance Monitoring announced; **IPO Sep 19, 2019** (Nasdaq: DDOG, $27/share) | FY2019 revenue $362.8M, +83% YoY; ~8,800 customers at IPO. |
| 2020s | Synthetics, Incident Management, SLOs, Workflow Automation, Cloud SIEM, Bits AI / Watchdog | Every product is a new *view* over the same unified data model — cheap to build, easy to cross-sell. AI came **last**, on top of data customers already trusted. |

**The mechanics underneath:**

- **Land-and-expand** (their S-1 language): make the first product trivially
  easy to adopt ("easy to adopt… very short time to value"), then let customers
  expand **self-service**, product by product. Sales org = self-serve tier +
  high-velocity inside sales + enterprise field.
- **Usage-based pricing:** metering by host-hour (high-watermark and hybrid
  monthly/hourly plans), events ingested, sessions captured. Revenue grows
  *inside* an account without a new procurement cycle.
- **Integration ecosystem as moat:** ~600+ integrations at IPO era →
  **1,000+ vendor-backed integrations** today. Each integration is a new
  land vector — the customer starts where they already are.
- **Free trial → self-serve:** 14-day trial, credit-card onboarding, product-led
  growth before sales touches the account.
- **One data model, many products:** dashboards, monitors, SLOs, notebooks all
  query the same tagged telemetry. "Pivot without losing context" (log → trace
  → metric → host in one click) is the core UX thesis — see
  `ref/datadog/PLAN.md` §1, the single most transferable pattern.

**What this means for us:** Datadog did not ship 30 products at once. It shipped
one ingest-and-visualize loop that was *credible*, then stacked views over the
same spine for a decade. Our equivalent wedge is **live telemetry + alarms**;
everything else — trends depth, workflows, AI — is expansion. And their biggest
strategic lesson is negative too: they never entered control loops, because
observability ≠ control. That gap is our differentiation space (§4).

---

## 2. Prioritized backlog for the industrial clone

Ordering follows Datadog's own sequence — **ingest & live tags first →
dashboards/trends → alarm rules → ack/workflows → roles/audit hardening →
AI-assist last** — adapted to what a plant console must prove (it can safely
*operate*, not just observe).

**Scoring:** MoSCoW + RICE-ish. `Score = (R × I × C) / E` where
R = % of weekly active users touching it (5–100), I = impact
(3 massive / 2 high / 1 medium / 0.5 low), C = confidence (0.5–1.0),
E = effort guess in person-weeks. Scores are relative, not absolute truth —
they exist to force the argument, not end it. "Status" cites existing surface
where the codebase already carries it (`ref/datadog/PARITY.md`).

### Phase A — "Land" (MVP spine)

| # | Item | Problem it solves | Datadog analogue | MoSCoW | R | I | C | E | Score | Status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| B1 | Telemetry ingest: edge → MQTT → backend → WS push, live tag values w/ quality+ts | Without trusted live data nothing else exists. DD's entire company rests on this loop. | Agent + metrics ingest + Live Tail | **M** | 100 | 3 | 0.9 | 6 | 45 | Exists: `WS /ws` `tag` events, `live.buffers` (PARITY §0.2/0.3) |
| B2 | Tag registry + tag list/explorer page | Operators need the addressable universe: name, unit, writable, quality. | Infra host list + tag facets | **M** | 80 | 2 | 0.9 | 3 | 48 | Exists: `GET /api/tags`, `/tags` page |
| B3 | Live mimic / line schematic (status-colored equipment, click→drill) | A SCADA without a mimic isn't SCADA — it's a chart tool. | USM Service Map / host map | **M** | 90 | 3 | 0.8 | 4 | 54 | Exists: `/line` (2D), `/line3d` (3D twin) |
| B4 | Alarm rules engine (threshold, deadband, severity, stale-data timeout) | Raw telemetry is noise; rules convert it to signal. | Monitors (threshold/anomaly/no-data) | **M** | 70 | 3 | 0.9 | 3 | 63 | Exists: `GET /api/alarm-rules`, rules CRUD in admin |
| B5 | Alarm list + acknowledge workflow (state: raised→acked→cleared, actor-stamped) | Regulatory & safety floor: someone must own an alarm. | Triggered monitors + ack/dedup | **M** | 80 | 3 | 0.9 | 3 | 72 | Exists: `POST /api/alarms/{id}/ack`; F01 timeline pending |
| B6 | Trends — multi-series history charts (uPlot), window zoom, legend stats | "Show me what it did" is the #2 question after "what's happening". | Metrics explorer / timeseries widget | **M** | 70 | 2 | 0.9 | 3 | 42 | Exists: `/trends` + `GET …/history` |
| B7 | Supervised command writes (setpoint/start/stop) — confirm dialog, TTL, idempotency key, role gate | Machine control is the difference vs every IT-monitoring tool — and the riskiest feature. Must be deliberate, logged, reversible. | Workflow Automation w/ approval gate | **M** | 50 | 3 | 0.8 | 4 | 30 | Exists: `POST /api/commands`, `.cmd-panel`, operator-gated |
| B8 | Multi-tenant org model + RBAC (viewer / operator / admin) | SaaS economics + plant reality: one deployment, many orgs/sites, least privilege. Commands invisible to viewers — enforced server-side, REST **and** WS. | Orgs + RBAC + audit tiers | **M** | 60 | 3 | 0.9 | 4 | 40 | Exists: `memberships`, v2 `/orgs/{org}/sites/*` surface |
| B9 | Audit log — immutable who/what/when for commands, acks, rule & membership changes | Industrial trust contract; also our regulatory story later. | Audit Trail | **M** | 30 | 3 | 0.9 | 3 | 27 | Exists: admin audit export wired (`adminApi`) |
| B10 | AuthN via OIDC (Keycloak), memory-only tokens | Enterprise SSO floor; sessions never persist secrets. | SAML/OIDC SSO | **M** | 100 | 2 | 0.9 | 3 | 60 | Exists: `/api/auth/config`, Keycloak in `infra/` |

### Phase B — "Expand" (post-MVP credibility)

| # | Item | Problem | Datadog analogue | MoSCoW | R | I | C | E | Score | Status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| B11 | Overview / command-center KPI tiles (value, delta, staleness) | 10-second situational picture on shift start. | Dashboards + query-value widgets | **S** | 90 | 2 | 0.9 | 3 | 54 | Exists ≥5 tiles; F09 configurator pending |
| B12 | Notification bell + session event journal | Alarm/command/health events reach the operator without page-hopping. | Notification center / Watchdog feed | **S** | 80 | 2 | 0.8 | 3 | 43 | Spec'd: F05 |
| B13 | Alarm flood control — group by rule/equipment, density strip | Alarm floods cause real incidents (ISA-18.2). | Event Mgmt intelligent correlation | **S** | 40 | 3 | 0.8 | 3 | 32 | Spec'd: F02, F03 |
| B14 | Edge gateway fleet table + health hop matrix | MQTT/edge is our ingest differentiator — its health must be first-class. | Infrastructure inventory / agent fleet | **S** | 40 | 2 | 0.9 | 2 | 36 | API-ready: F22, `/sites/{site}/edges` |
| B15 | Command lifecycle trail (queued→sent→ack→done, per-step actors) | "Who told the machine to do that, and did it?" | Workflow run view | **S** | 40 | 2 | 0.9 | 2 | 36 | API-ready: F19, `_v2` command events |
| B16 | Saved views + URL-shareable filter state everywhere | Operators send links, not screenshots. | Saved Views | **S** | 60 | 1 | 0.9 | 2 | 27 | Spec'd: F12; URL params already the view |
| B17 | CSV export on every data page | Auditors and Excel still run industry. | Export everywhere | **S** | 50 | 1 | 1.0 | 1 | 50 | Spec'd: F14 |
| B18 | Unified activity timeline (shift log: alarms+commands+insights+health) | Shift handover is a daily industrial ritual DD never needed. | Incident timeline + Notebooks | **S/C** | 40 | 2 | 0.7 | 3 | 19 | Spec'd: F20 (nav count → 14, update uat.mjs) |
| B19 | ISA-101 HMI styling pass (calm grayscale, redundant-coded alarms, situational hierarchy) | DD's colorful density reads as "marketing" in a control room; credibility = restraint. | — (no analogue; see §4.3) | **S** | 100 | 2 | 0.7 | 4 | 35 | Partial: calm mode + `wds.calm` exists |

### Phase C — "Platform" (differentiators, post-PMF signals)

| # | Item | Problem | Datadog analogue | MoSCoW | R | I | C | E | Score | Status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| B20 | Uptime/availability + SLO burn tiles | OEE-adjacent numbers management asks for. | SLOs + error budgets | **C** | 30 | 2 | 0.7 | 3 | 14 | Spec'd: F07/F08 (needs 1 aggregate endpoint) |
| B21 | Live tail per tag (scrolling raw values in faceplate) | Commissioning & sensor-debug superpower. | Live Tail | **C** | 20 | 1 | 0.9 | 1 | 18 | Spec'd: F13 |
| B22 | Vision integration — camera tiles pinned to equipment/alarms | "Show me the conveyor when the jam alarm fired." Nobody in observability does this; SCADA does it with DVR bolt-ons. | Session Replay (spiritual) | **C** | 30 | 3 | 0.6 | 6 | 9 | Not started — differentiator §4.2 |
| B23 | Batch/traceability records — run start/stop context bound to telemetry windows | ERP-adjacent hook: every production run gets a queryable record. | Notebooks/Reports (weak) | **C** | 20 | 3 | 0.5 | 6 | 5 | Not started — differentiator §4.2 |
| B24 | Omnibar grammar v2 (boolean ops, negation, wildcards) | Power users outgrow single-token filter. | Explorer query syntax | **C** | 30 | 1 | 0.9 | 2 | 14 | Spec'd: F11 |

### Phase D — AI last, and explicitly deferred

| # | Item | Verdict | Why |
| --- | --- | --- | --- |
| B25 | ML anomaly detection / forecast bands on tags | **Won't (MVP)** | DD shipped Watchdog ~7 years after ingest. Our rule-based insights (`/api/insights`, `/insights` page) already cover "something looks off"; ML before trusted history produces false-confidence theater. Revisit once ≥3 months of real line data exists. |
| B26 | AI-suggested operator actions (propose→approve) | **Won't (MVP)** | Requires B25 + hard guardrails on the command path. The *flow* is designed (DD's propose→preview→approve→execute→audit, PLAN §2.7); the brain is not. |
| B27 | SLA/uptime **reporting** for customers | **Won't (MVP)** | Contract artifact, not operator value. B20 tiles cover the internal need. |
| B28 | Native mobile app | **Won't** | Responsive web + `?kiosk=1` covers floor displays and phone triage. DD itself is desktop-first. |
| B29 | Log explorer / APM / distributed tracing | **Dropped** | PARITY §3: no log store, MQTT has no span model. These are IT-observability tools, not OT. |
| B30 | Deterministic control loops, safety interlocks, IEC-61131 logic in the web tier | **Never** | Belongs in PLC/edge hardware. Our layer is *supervisory* — see §4.3. |

**Build order (compressed):** B1→B2→B3→B6 (see it live) → B4→B5 (act on it) →
B7→B8→B9→B10 (operate it safely) = **MVP**. Then B11–B19 by score, then C
items gated on real deployments, then D only with accumulated history.

---

## 3. MVP definition — the smallest *credible* SCADA-lite

"Credible" test: a plant manager opens the console and sees the line **running
live**; an operator **acknowledges** a real alarm and issues a **confirmed
setpoint write** that actually reaches the simulator; an auditor can later prove
**who did it**. Anything not serving that loop is deferred.

### 3.1 In scope (MVP)

| MVP element | Acceptance bar |
| --- | --- |
| **Live mimic** (2D line schematic, `/line`) | Equipment states update ≤1s cadence from WS `tag` events; click equipment → drill panel; stale/dead tags visibly degraded (quality marks `.qmark`), never silently frozen. |
| **Tag list** (`/tags`) | Full registry w/ name, unit, writable flag, latest value+quality+ts; facet filter; deep-linkable `?q=`. |
| **Alarm list + ack** (`/alarms`) | Severity-coded rows, raised→acked→cleared states, `POST /ack` operator-gated, unacked-criticals banner persistent (no toast-only alarms — ISA-18.2). |
| **Command write with confirm** (`/commands`, faceplate) | Operator role only; typed/entered confirmation; TTL + idempotency key; visible lifecycle status; viewers see nothing (REST+WS gated — zero-4xx UAT gate holds). |
| **Per-org roles** | viewer / operator / admin; server-enforced on every endpoint; memberships per org+site. |
| **Audit log** | Immutable record: command writes, acks, rule edits, membership changes; exportable. |
| Supporting plumbing | OIDC login, WS auto-reconnect, edge health pill, EN/TH i18n shell (Thai strings are longer — icon+label collapsible rail per COMPONENTS.md AppRail). |

### 3.2 Explicitly deferred (and why that's defensible)

| Deferred | Rationale |
| --- | --- |
| Anomaly-detection AI | DD sequenced it ~7 years post-ingest; we have rule-based insights today. |
| SLA reporting / customer-facing uptime reports | Contract tooling; internal uptime tile (B20) suffices. |
| Native mobile app | Responsive + kiosk mode covers the floor. |
| Alarm shelving / full ISA-18.2 rationalization workflow | Grouping (B13) covers floods at MVP scale. |
| Historian-grade retention (>8h window) | Design intent is an 8h live horizon (`HISTORY_MAX_AGE_S`); long-term archive is an ERP/data-lake integration, not an MVP blocker — but note the pruning gap in §6. |
| Synthetic/robotic "tests" of the plant | DD Synthetics analogue doesn't exist for physical lines; Factory I/O *is* our synthetic environment. |

---

## 4. Differentiation — where we win, where copying stops

### 4.1 vs Datadog (IT observability)

| Axis | Datadog | Us | Our edge |
| --- | --- | --- | --- |
| Domain | Cloud infra/apps (IT) | Physical plant (OT) | DD will never write to a PLC. **Control is the moat.** |
| Tenancy | Orgs exist, but one global SaaS | Per-org + per-site multi-tenant from day 1 | Sell to one factory group, expand site by site — DD's land-and-expand pattern applied to plants. |
| Ingest | Agent → cloud | Edge gateway → MQTT → cloud | Store-and-forward edge survives plant networks; DD assumes always-on cloud connectivity. |
| Data model | Metrics/logs/traces | Tags/alarms/commands/insights + **vision frames** | Camera context bound to alarms is a category DD doesn't have. |
| Output | Dashboards, alerts | Dashboards, alarms, **machine control**, batch records | Telemetry tied to *production runs* (ERP-adjacent traceability) is industrial-native, not IT-native. |
| Buyer | DevOps/SRE | Plant manager, line operator, integrator | Different persona, different sales motion — less crowded. |

### 4.2 vs classic SCADA (WinCC, iFIX, Ignition, FTView)

| Axis | Classic SCADA | Us |
| --- | --- | --- |
| Client | Installed thick client / per-seat licensing | **Browser-native**, zero-install, kiosk URL for floor displays |
| Tenancy | One install per site, siloed | **Multi-tenant**: N orgs, M sites, one deployment |
| UX | Engineering-workspace aesthetic, steep training | Observability-grade UX: omnibar, facets, deep links, saved views — DD's "usable by anyone, no query language" claim |
| Extensibility | Proprietary scripting (VBA, proprietary tag DBs) | REST + WS API-first (`/api/v1/orgs/{org}/sites/…`), MQTT standard ingest |
| Vision | Bolt-on DVR, separate system | Vision frames as first-class telemetry beside tags |
| ERP coupling | Custom middleware projects | Batch records/traceability hooks designed in, not bolted on |
| Pricing | Capex + integrator hours | Usage-based potential (tags/site/alarm volume) — DD's HWMP lesson: meter the unit that grows |

### 4.3 Where copying Datadog *stops helping* — honest boundary

- **Deterministic control.** DD never actuates. Our command path must degrade
  safely: TTL expiry, idempotency, edge-side interlocks. The web tier is
  *supervisory* — safety interlocks and control loops live in PLC/edge
  hardware, forever. No UX cleverness overrides that.
- **ISA-101 HMI conventions.** DD's visual richness (color-dense dashboards,
  marketing-dark heroes) violates high-performance HMI doctrine: grayscale
  surfaces, alarm color *reserved* for abnormal states, redundant coding
  (color+icon+label). Our "calm mode" (`wds.calm`) is the direction of travel;
  B19 formalizes it.
- **ISA-18.2 alarm management.** DD's "intelligent correlation" is heuristic;
  industrial alarm floods have a named discipline (rationalization, shelving,
  priority by consequence). We borrow the grouping UX, not the complacency.
- **Store-and-forward semantics.** DD agents buffer opportunistically; OT
  assumes planned outages. Edge buffer depth is a monitored, audited
  first-class metric for us (`/sites/{site}/health` exposes `buffer_depth`,
  `clock_ok`), not an implementation detail.
- **Latency contract.** DD tolerates ~15s ingest lag. Operators expect
  scan-cycle honesty: sub-second tag→screen at 1s cadence, with explicit
  staleness display when the edge is behind.

---

## 5. Product Requirements Document — skeleton

(Condensed PRD; expands into a full doc as Phase A contracts lock.)

### 5.1 Goals

1. A single browser console where an operator can **see → decide → act → be
   audited** on a live sorting line (Factory I/O now, Siemens PLC later).
2. Multi-tenant by construction: org → sites → edges → tags; no single-tenant
   shortcuts that block SaaS economics later.
3. Time-to-first-live-tag under 30 minutes on a new site (DD's TTV discipline:
   the first demo sells the second site).
4. Alarm → acknowledgment → resolution loop measurably faster than a radio call.

### 5.2 Non-goals

- Replacing the PLC (supervisory layer only; no real-time control loops).
- Historian replacement (8h live window by design; archive via integration).
- Full ISA-18.2 rationalization suite, native mobile app, customer SLA portal —
  all deferred per §3.2.
- Competing on DD's home turf: log management, APM, RUM (dropped, PARITY §3).

### 5.3 Personas

See **[`01-personas.md`](./01-personas.md)** in this series. Quick anchor:
**Line Operator** (acknowledge, command within envelope, kiosk view) ·
**Shift Supervisor** (trends, activity timeline, batch context) ·
**Maintenance Engineer** (tag health, live tail, edge fleet) ·
**Plant Manager / Admin** (org, rules, users, audit export) ·
**Viewer** (read-only stakeholder — must never touch command surface).

### 5.4 Functional requirements

| ID | Requirement | Priority | Maps to |
| --- | --- | --- | --- |
| FR-1 | System ingests tag telemetry from edge gateways via MQTT at ≥1 Hz/tag, with quality+timestamp preserved end-to-end | M | B1 |
| FR-2 | Live values pushed to browser over WS (`tag` events); UI renders stale state when quality ≠ good or ts ages out | M | B1/B3 |
| FR-3 | Tag registry lists all tags with name/unit/writable/latest; filterable, URL-shareable | M | B2 |
| FR-4 | Mimic view renders equipment state live; click→faceplate with value, trend, quality, (if writable) command control | M | B3/B7 |
| FR-5 | Alarm rules evaluated on ingest: threshold kind, deadband, stale_s, severity, enable flag; CRUD admin-only | M | B4 |
| FR-6 | Alarm lifecycle raised→acked→cleared; ack requires operator role and records actor+ts; unacked criticals persistently surfaced | M | B5 |
| FR-7 | History query per tag (window, ≤5000 rows/req) rendered as multi-series trend with legend stats and alarm-zone shading | M | B6 |
| FR-8 | Command writes: operator-only, confirm step, TTL, idempotency key, lifecycle events visible (`queued→sent→ack→done/timeout`) | M | B7/B15 |
| FR-9 | RBAC: viewer (read telemetry/alarms/insights), operator (+ack/+command), admin (+rules/users/audit). Command data invisible to viewers on REST **and** WS | M | B8 |
| FR-10 | Immutable audit events for command, ack, rule change, membership change, login; org-scoped export | M | B9 |
| FR-11 | OIDC authentication; tokens memory-only, localStorage for UI prefs only | M | B10 |
| FR-12 | Multi-tenancy: every resource scoped `org → site`; cross-org access impossible by construction | M | B8 |
| FR-13 | Edge health surface: per-edge heartbeat, buffer depth, adapter, `needs_rotation` flag | S | B14 |
| FR-14 | Notification journal of session events (alarm/insight/command/health), role-filtered | S | B12 |
| FR-15 | Alarm grouping by state/rule/equipment; density strip over trailing 4h | S | B13 |
| FR-16 | CSV export respecting active filters on all data pages | S | B17 |
| FR-17 | Unified activity timeline (shift log) merging alarms/commands/insights/health | S | B18 |
| FR-18 | KPI tile overview with staleness captions | S | B11 |
| FR-19 | EN/TH i18n on all user-facing strings; kiosk mode (`?kiosk=1`) suppresses overlays | M | shell |
| FR-20 | Vision tile binds camera feed to equipment; alarm rows link to captured frames | C | B22 |
| FR-21 | Batch record: named run window capturing tags+alarms+commands, exportable | C | B23 |
| FR-22 | Rule-based insight cards (existing insights engine); dismiss/feedback control | S→C | — |

### 5.5 Non-functional requirements

| Category | Requirement |
| --- | --- |
| Latency | Tag sample → screen ≤1 s end-to-end at 1 s cadence; WS reconnect ≤5 s with visible state pill. |
| Offline/buffer | Edge buffers telemetry on WAN loss and forwards on restore; buffer depth observable (`/health` hop matrix); history ingest accepts backfill up to 8 h (`HISTORY_MAX_AGE_S`). |
| Auditability | No mutable path to audit records; every mutating API call records actor, org, site, reason where applicable; `version` fields order alarm transitions. |
| Availability | Console degrades read-only when edge down (last values + staleness), never blanks; health endpoint public for probes. |
| Security | OIDC only; operator endpoints never fetched under viewer session (zero-4xx UAT gate); `/metrics` loopback-only in prod. |
| Capacity bounds | Per-tag live ring `BUFFER_CAP=3600` (~1 h @1 s); alarm/insight live caps 500; these are *documented design bounds*, surfaced honestly in UI. |
| i18n/a11y | EN/TH; redundant coding for all severity states (color+icon+label); Esc layering single-level contract preserved. |
| UAT contract | `.side-nav a.tab` counts (13 desktop/5 mobile), selector inventory in `tests/e2e/uat.mjs` are binding — new surfaces update it deliberately (see F20 note). |

### 5.6 Success metrics

| Metric | Target (Phase A) |
| --- | --- |
| Time-to-first-live-tag on new site | < 30 min |
| Tag→screen latency p95 | ≤ 1 s |
| Alarm ack latency (raise→ack) | < 2 min median during staffed shifts |
| Command success rate | ≥ 99% reaching `done`; 100% of attempts audited |
| Alarm flood ratio | ≤ 10 alarms / 10 min sustained (ISA-18.2 acceptable band) |
| UAT | Zero console errors, zero ≥400 responses |
| Viewer-mode leak test | 0 command payloads observed under viewer session |
| Retention honesty | UI never displays data beyond documented horizon without a window caption |

---

## 6. Risks & assumptions

### 6.1 Assumptions

1. Factory I/O simulator semantics approximate Siemens PLC tag behavior closely
   enough that adapters differ in transport, not in tag/alarm/command model.
2. 1 s cadence is sufficient for a sorting-line MVP (not a motion-control
   application).
3. One seeded site per org is acceptable for MVP; multi-site UX arrives with
   Phase B.
4. Keycloak remains the IdP; no LDAP/AD bridge needed in Phase A.
5. Operators are staffed during runs — unacked-critical escalation to
   SMS/on-call is Phase C, not MVP.
6. Rule-based insights (`/api/insights`) satisfy the "AI" demo story until real
   history justifies ML.

### 6.2 Risks

| Risk | Likelihood | Impact | Mitigation |
| --- | --- | --- | --- |
| Simulator → Siemens PLC gap: real scan cycles, addressing (DB/offset), and write semantics differ; tag model built too tightly to the sim | M | H | Adapter boundary already exists (edge `adapter` field in `/health`); spike a Siemens connector early in Phase B, before the model calcifies. |
| Command safety: a mis-sent write moves real hardware | M | **Critical** | Confirm + TTL + idempotency + role gate shipped; add envelope validation (min/max per tag) and edge-side interlock spec before first real PLC. Never browser-tier safety logic (§4.3). |
| History table grows unbounded (ingest caps *age* but **no pruning job exists** — PARITY §0.3) | H | M | Ship a retention/prune job before first long-running deployment; monitor table size in `/metrics`. |
| MQTT broker / single backend becomes multi-tenant bottleneck | M | M | Mosquitto already in `infra/`; meter per-org tag rates early; DD's usage-based model doubles as a load signal. |
| Alarm fatigue via naive threshold rules | M | M | Deadband + stale_s already in rule model; B13 grouping lands Phase B; resist shipping more rules than operators can rationalize. |
| Multi-tenant data bleed (bug or config) | L | **Critical** | Org scoping at query layer + viewer/command WS gate already exist; add cross-org penetration test to UAT before external users. |
| Scope creep toward "mini-Datadog" | M | M | §4.3 boundary + dropped list (B25–B30) are the contract; revisit quarterly, not per-sprint. |
| Vision/batch hooks ballooning MVP | M | M | Held at C-priority (B22/B23); validate with one pilot customer before building. |

---

## 7. Sources & local evidence

**Web:**

- Datadog S-1/A & 424B4 (SEC, Aug–Sep 2019) — founding narrative, product launch
  years (infra 2012, APM 2017, logs 2018, RUM/NPM 2019), land-and-expand model,
  ~8,800 customers at IPO.
- Nasdaq IPO pricing release (Sep 18, 2019) — DDOG, $27/share, Sep 19 debut.
- FY2019 10-K — revenue $362.8M, +83% YoY.
- docs.datadoghq.com/account_management/billing/pricing — usage-based metering
  (HWMP / hybrid monthly-hourly host plans).
- datadoghq.com blog "1k integrations milestone" + pricing page — 600+ → 1,000+
  vendor-backed integrations.

**Local:**

- `ref/datadog/features.md` — scraped catalog of ~30 DD products (IA + pitches).
- `ref/datadog/PLAN.md` — DD patterns → our page mapping (IA groups, query
  pattern, KPI cards, alarm UX, supervised commands, sidebar).
- `ref/datadog/PARITY.md` — ground-truth API/WS surface, hard bounds
  (`BUFFER_CAP=3600`, `HISTORY_MAX_AGE_S=8h`, no pruning job), UAT selector
  contract, F01–F22 feature specs, §3 explicit drops.
- `ref/datadog/live/COMPONENTS.md` — measured DD chrome (rail/topbar/pagebar,
  13px data-dense type, status pills, monitor-create → our rule-create flow).
- `web/src/app/nav.ts` — actual nav model (Monitor / Operate / Intelligence /
  System / Admin-gated) this strategy sequences around.
- `infra/` — mosquitto (MQTT), postgres, keycloak compose assets confirming the
  edge→broker→backend→browser topology assumed throughout.

*Prepared as doc 04 of the SDLC Datadog research series. Personas: `01-personas.md` (sibling).*
