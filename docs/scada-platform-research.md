# SCADA Platform Research — Top Platforms, Features & Standards

*Compiled 2026-10-16 for the `webservice` project (Edge → MQTT/TLS → FastAPI → React web SCADA). Research was produced by six parallel research agents (~120 web searches + official documentation fetches); every section cites source URLs. This file is a merge of six part-reports; the synthesis below is the controller's own analysis.*

**Contents**

1. This section — market overview, the top-10 list, cross-platform patterns, and a build checklist
2. [Part I — Ignition, GE Vernova Proficy, VTScada](#part-i--ignition-ge-vernova-proficy-vtscada)
3. [Part II — Siemens WinCC, Rockwell FactoryTalk, AVEVA](#part-ii--siemens-rockwell-aveva)
4. [Part III — ICONICS, zenon, Honeywell, Emerson, Yokogawa, ABB, Omron](#part-iii--iconics-zenon-honeywell-emerson-yokogawa-abb-omron)
5. [Part IV — Web-native & open-source SCADA](#part-iv--web-native--open-source-scada)
6. [Part V — Standards landscape (IEC/ISA/ISO)](#part-v--standards-landscape)
7. [Part VI — Academic literature](#part-vi--academic-literature)

---

## 1. Market overview & how "top 10" was chosen

Two different rankings exist, and they are not the same:

**By automation-vendor revenue** (YH Research, QY Research, ABI Research coverage): Schneider Electric, ABB, Siemens, Emerson, Rockwell, Honeywell, Mitsubishi Electric, Omron, GE (Vernova), Yokogawa, Eaton, Hitachi, Toshiba. These are the companies whose SCADA/HMI/DCS revenue dominates globally — but much of it rides on hardware ecosystems, not SCADA software merit.

**By SCADA software relevance to a web-SCADA build** (what this document uses for the detailed top-10):

| # | Platform | Vendor | Why it's in the top 10 |
|---|---|---|---|
| 1 | **Ignition** (Perspective/Vision, Edge, Cloud) | Inductive Automation | The reference web-native SCADA. Server-centric, HTML5 clients, unlimited-tag licensing, huge integrator community. The product to beat. |
| 2 | **SIMATIC WinCC** (Classic / Unified / OA) | Siemens | Largest industrial install base; WinCC Unified is genuinely HTML5; WinCC OA powers CERN-scale systems. |
| 3 | **AVEVA System Platform / InTouch / Plant SCADA + PI System** | AVEVA (Schneider Electric) | Dominant in process industries; ArchestrA object model; PI System is *the* industrial data infrastructure. |
| 4 | **FactoryTalk View SE/Optix + Historian** | Rockwell | Dominant in North-American discrete/Allen-Bradley shops; Optix is the new web/cloud line. |
| 5 | **Proficy iFIX / CIMPLICITY / Historian / Ops Hub** | GE Vernova | Legacy enterprise installed base; Proficy Historian is best-in-class scale. |
| 6 | **ICONICS GENESIS64 / GENESIS** | ICONICS (Mitsubishi Electric) | OPC-native suite, strongest BACnet/building automation story, HTML5 WebHMI/Anywhere. |
| 7 | **zenon** | COPA-DATA | European stronghold; best-in-class energy features (IEC 61850 GOOSE, command processing, process recorder); WVS HTML5 thin client. |
| 8 | **VTScada** | Trihedral (Delta Electronics) | All-in-one integrated SCADA; water/wastewater telemetry leader; IEC 62443-4-1 ML3 certified. |
| 9 | **Experion PKS / HS** | Honeywell | DCS-SCADA hybrid for oil & gas / pipelines; DynAMo alarm tooling; read-only eServer web tier. |
| 10 | **DeltaV + Ovation** | Emerson | Batch-centric DCS (ISA-88 native); **DeltaV Live = first native-HTML5 DCS HMI**; ISASecure SSA/SDLA certified. |

**Honorable mentions just outside the cut:** Yokogawa CENTUM VP / FAST/TOOLS (genuinely web-centric SCADA, ISASecure leader — arguably belongs in the top 10 over Experion for a *web* comparison), ABB Ability System 800xA (aspect-object architecture, HTML5 Operations Client, integrated IEC 61850), Schneider EcoStruxure Geo SCADA (utilities telemetry), Omron (CX-Supervisor legacy / AVEVA Edge rebrand — no first-tier SCADA).

**Web-native / open-source tier (Part IV)** — the actual peer set for this project: FUXA, ScadaBR/Scada-LTS, Rapid SCADA, Node-RED dashboards, Grafana, ThingsBoard, Tatsoft FrameworX, Advantech WebAccess, atvise, SpiderControl, OAS.

---

## 2. Cross-platform architecture patterns (what the research shows)

Six patterns repeat across every incumbent — they define the bar:

1. **Web is almost always a bolt-on.** WinCC WebNavigator, AVEVA Access Anywhere (WebSocket→RDP translation!), Honeywell eServer, GE Webspace all render or mirror legacy Windows applications into the browser. **Read-only enterprise web tiers are the norm; write-capable web operation is a differentiator.** Only Ignition Perspective, WinCC Unified, DeltaV Live, zenon WVS, ABB Operations Client, and atvise are natively HTML5 end-to-end.
2. **Server-side session models dominate.** Nobody rewrites projects for the web; the server renders and streams to thin clients (ICONICS AnyGlass per-session, Perspective server-side React+MobX over WebSocket, zenon WVS multi-session). A pure client-side React SPA consuming a tagged-data API — this project's model — is architecturally *leaner* than all of them.
3. **Tag engine is the product.** UDTs/templates (Ignition UDTs, CIMPLICITY classes, ArchestrA objects, WinCC OA datapoint types), quality+timestamp+value tuples, per-tag alarm/history config. A tag engine is the irreducible core.
4. **Historian is a separate business.** PI System, Proficy Historian (100M tags, 1B samples/min on AWS), Canary — purpose-built time-series stores with swinging-door compression. Ignition 8.3 moved to QuestDB internally; the direction of travel is real TSDBs, not relational tables.
5. **Alarm management is a lifecycle, not a threshold.** ISA-18.2/IEC 62682: shelving, suppression, out-of-service, rationalization, KPI dashboards (~150 alarms/day/operator acceptable; flood <1% of time; 80/15/5 priority split). OSS alarms are thresholds + lists; commercial is a discipline.
6. **Licensing is shifting to subscriptions and unlimited-client models.** Ignition's per-server unlimited-everything is the disruptor; everyone else is moving from per-tag/per-client to term bundles (AVEVA Operations Control, DeltaV Flex) or concurrent-user models (ICONICS CALs, DeltaV Enterprise View).

---

## 3. Feature checklist — what a web SCADA must have

Distilled from the vendor specs (Siemens water-industry functional spec, Rockwell VIEWSE-SR001 site-level spec, N3uron spec) plus every platform review. Grouped by tier; the right column maps it to this project's existing stack.

### Tier 0 — the irreducible core (without it, it's a dashboard, not SCADA)

| Feature | Detail | This repo today |
|---|---|---|
| Tag engine | Typed tags (analog/digital/string), value+quality+timestamp, engineering units, scaling, deadbands, derived/expression tags, tag hierarchy or asset model | `edge-bridge` publishes telemetry; backend needs a tag abstraction with quality/timestamp semantics |
| Real-time distribution | Push updates to clients (WebSocket/SSE), subscription model per tag/mimic, delta streams | `/ws` WebSocket exists — needs per-tag subscription scoping |
| Write/command path | Operator setpoint writes + start/stop commands with **confirmation, role checks, and audit** | `cmd`/`cmd-resp` topics exist on the bridge; needs auth-gated command lifecycle with audit |
| Alarm engine | Per-tag threshold + deviation + ROC alarms, priorities, state machine (active→ack→clear→rtn-normal), alarm list + journal, notifications | `alarm` engine exists in backend — verify shelving/suppression/notification depth vs ISA-18.2 |
| Historian | Time-series persistence with compression, configurable retention, fast range queries, store-and-forward at the edge | Postgres works at prototype scale; plan for TimescaleDB/QuestDB-class TSDB for production |
| HMI/mimic displays | Synoptic diagrams bound to live tags; symbol library (ISA-5.1); animation bindings; faceplates | Open: needs a browser mimic editor (FUXA's SVG editor is the open-source precedent) |

### Tier 1 — what makes it production-grade

| Feature | Detail |
|---|---|
| Trends | Multi-pen real-time + historical trends, ad-hoc queries, replay, export CSV |
| RBAC + SSO | Role-based access control mapped to tag areas/screens; OIDC/SAML; per-area write permissions (Keycloak already gives OIDC/RBAC — extend to tag-level scoping) |
| Audit trail | Tamper-evident log of every operator action, login, config change (IEC 62443 FR6; 21 CFR 11) |
| Reporting | Scheduled/ad-hoc reports (PDF/Excel/CSV), alarm reports, shift/production reports |
| Recipes | Parameter sets downloaded to controllers (ISA-88-adjacent) |
| Redundancy | Hot-standby server pair, store-and-forward at edge, client failover |
| Protocol breadth | OPC UA client **and server**, MQTT + Sparkplug B, Modbus TCP/RTU, EtherNet/IP, S7, BACnet, DNP3/IEC-104 (utilities) |
| Multi-tenant/site | Site→area→line hierarchy, UNS-style namespace (this project's `v2/{org}/{site}/{edge}` topics already is a UNS shape) |
| Diagnostics | Comm health, driver diagnostics, stale-data detection, heartbeat |

### Tier 2 — differentiators (where a new web-native product can beat incumbents)

| Feature | Why it wins |
|---|---|
| **Browser-native engineering** | Only FUXA and Advantech WebAccess do full browser-side engineering; even Ignition requires an installed Designer. A browser mimic/tag editor is a genuine gap. |
| Write-capable web everywhere | Incumbents gate control behind thick clients or read-only web tiers. |
| Modern UX | ISA-101 high-performance-HMI template library out of the box (gray-scale, four-level display hierarchy). |
| Open API-first | REST + GraphQL + WebSocket + MQTT for everything, so third parties build on it (Ignition's module ecosystem is why it won). |
| Unlimited-tag/simple pricing | Per-tag licensing is the industry's most-hated artifact (AVEVA, Siemens PowerTags, GE I/O tiers). |
| Edge-native store-and-forward | MQTT Sparkplug B birth/death certs + edge buffering (this project's edge-bridge already has the skeleton). |
| Built-in alarm analytics | ISA-18.2 KPI dashboards (flood analysis, top offenders, standing alarms) — most platforms need add-ons. |
| Git/versioned config | VTScada's built-in version control + Ignition's project files point the way; nobody does git-native config well. |

### Tier 3 — enterprise/regulated (needed for pharma, utilities, oil & gas)

- Electronic signatures (21 CFR Part 11 / EU Annex 11): performs/verified-by on writes and alarm acks
- ISA-88 batch records, ISA-95 B2MML ERP integration
- IEC 62443 posture: documented SDL (4-1), component SAR profile (4-2), zones-and-conduits deployability (3-3), SL2+ target
- IEC 61850 / DNP3 / IEC 60870-5-104 for energy; NERC CIP evidence reporting for utilities
- Multi-site federation, hub-and-spoke gateway architectures
- ISO 50001 energy dashboards; ISO 27001-certified cloud ops if SaaS

---

## 4. Gap analysis — where a self-built web SCADA can actually win

From the cross-platform research (details in Parts I–IV):

1. **Full browser engineering.** FUXA proves it works (5.2k stars, MIT); almost no commercial product does it. Even Ignition's Designer is a Java desktop app.
2. **Honest web architecture.** AVEVA literally translates WebSocket→RDP for browser access. A React SPA + real API is a better architecture than every bolt-on — the opportunity is matching *depth*, not architecture.
3. **The moat is in the boring parts:** driver breadth (Tatsoft 70+, WebAccess 450+ maintained drivers), ISA-18.2 alarm lifecycle depth, redundancy/failover, certifications (62443-4-1/-4-2, OPC lab cert, BTL), and reporting. None are glamorous; all are what procurement checks.
4. **Security defaults as a differentiator.** FUXA ships auth-disabled; Node-RED needed advisories. A web SCADA that ships TLS+OIDC+RBAC+audit *on by default* (as this project already does: Keycloak, dynsec MQTT, Postgres RLS) is ahead of the open-source field on day one.
5. **Licensing honesty.** The universal complaint is per-tag/per-client pricing opacity. Simple pricing is a wedge.

**What not to under-scope:** redundancy & failover semantics (hot standby, store-and-forward backfill), alarm lifecycle state machine, historian compression/retention, and the driver library. These are where open-source SCADAs die in procurement (see Part IV's "what OSS lacks" list — it is effectively your enterprise roadmap).

---

*The remaining parts are the raw research: platform deep-dives (I–IV), the standards landscape (V), and the citable academic literature (VI).*

---


---

# Part I — Ignition, GE Vernova Proficy, VTScada

# SCADA Platform Competitive Analysis: Ignition, GE Vernova Proficy, VTScada

*Compiled from official vendor documentation, datasheets, price lists, and release materials. All claims carry a source URL. Prices are public list/MSRP figures and subject to change.*

---

## 1. Inductive Automation — Ignition

### 1.1 Overview & Positioning

- Ignition is a Java-based, server-centric "industrial application platform" for SCADA, HMI, MES, and IIoT, released by Inductive Automation in January 2010. The platform has three main components — the **Ignition Gateway**, the **Designer**, and **runtime clients** — with independent modules providing functionality (status/control, alarming, reporting, data acquisition, scripting, scheduling, MES, mobile) in any or all components. (https://en.wikipedia.org/wiki/Ignition_SCADA)
- Positioning: "the world's first truly universal industrial application platform," built on IT-standard technologies (SQL, Python, MQTT, OPC UA), sold by the server with unlimited tags, clients, screens, devices, and designer seats. (https://inductiveautomation.com/ignition/platform, https://inductiveautomation.com/ignition/unlimited)
- Market traction claims: used in more than 140 countries and implemented at **65% of Fortune 100 companies**; 40%+ of Fortune 500 cited in a company webcast; "trusted by over 15,000 organizations worldwide." (https://inductiveautomation.com/news/inductive-automation-releases-ignition-83, https://inductiveautomation.com/resources/webinar/ignition-community-live-with-carl-gould-colby-clegg, https://inductiveautomation.com/pricing/ignition)
- Editions: **Ignition** (standard), **Ignition Edge** (edge-of-network data collection), **Ignition Cloud Edition** (AWS/Azure marketplace, pay-as-you-go), **Ignition Maker Edition** (free, non-commercial). (https://inductiveautomation.com/pricing/edition, https://inductiveautomation.com/ignition/maker-edition)
- Community ecosystem: free full-featured trial, Inductive University (free training), community forum, Ignition Exchange (free community-built resources), Ignition Community Conference (ICC), third-party module SDK/showcase. (https://inductiveautomation.com/ignition/maker-edition)

### 1.2 Architecture (Client Types, Server)

- **Server-centric web deployment**: a central Ignition Gateway (a single application that *is* a web server, configured entirely through a browser interface) hosts all projects, tags, device connections, and databases; unlimited zero-install clients launch from it. Gateway can be on-prem, cloud, distributed across servers, or at the edge. (https://inductiveautomation.com/ignition/architectures, https://www.docs.inductiveautomation.com/docs/8.3/platform/gateway)
- **Client types**:
  - **Perspective** (recommended for all new projects): pure HTML5/CSS3 sessions running in any modern browser (Chrome 92+, Firefox 90+, Safari 15+), the Ignition Perspective mobile app (iOS/Android), or Perspective Workstation (a kiosk-capable desktop wrapper). No Java or plug-ins. Minimum browser versions published in docs. (https://www.docs.inductiveautomation.com/docs/8.3/ignition-modules/perspective/perspective-sessions, https://inductiveautomation.com/ignition/modules/perspective)
  - Internally, Perspective is a **server-side runtime**: the Gateway performs all processing and pushes a live model to the browser over a WebSocket; the front end is React + MobX (confirmed by IA's own module SDK examples and community internals analysis). Gateway-side rendering means client count is bounded by server resources; Vision offloads work to client CPUs instead. (https://github.com/inductiveautomation/ignition-sdk-examples/blob/aafc6c3ce2c93841f2856c8e0124c7cec33167ea/perspective-component/web/packages/client/typescript/components/Messenger.tsx, https://github.com/EckmanTechLLC/perspective-cookbook, https://corsosystems.com/posts/vision-vs-perspective-shoot-out)
  - **Vision**: Java Swing thick client launched via the Vision Client Launcher (web-launch); runs where Java runs. Still used for mission-critical local client fallback — Perspective has no local-client-fallback equivalent. (https://www.docs.inductiveautomation.com/docs/8.3/launchers-and-workstation, https://corsosystems.com/posts/vision-vs-perspective-shoot-out)
- **Designer**: a desktop (Java) application launched via the Designer Launcher / "web-launch" from the Gateway; drag-and-drop panels (Project Browser, Tag Browser, Component Palette, Property Editor); all projects saved centrally on the Gateway. Note: despite the "web-launched" model, the Designer itself is *not* a pure browser app in 8.3 — it requires the installed launcher. In 8.3, designers/Vision clients/Perspective sessions can be deep-link launched from the Gateway homepage. (https://www.docs.inductiveautomation.com/docs/8.3/platform/designer, https://inductiveautomation.com/ignition/whatsnew)
- **Reference architectures**: Basic (single server + SQL DB + PLCs + clients), Scale-Out (linked gateways, front-end/back-end split), Hub & Spoke, Enterprise, IIoT (MQTT message-oriented middleware), Cloud Hybrid. (https://inductiveautomation.com/ignition/architectures)
- **Gateway Network (GAN)**: gateways interconnect to share tags, alarm notification pipelines, and remote services over TCP (default 8088 / 8060 TLS). Enterprise Administration Module (EAM) manages fleets of gateways (agent tasks, license/project push). (https://www.docs.inductiveautomation.com/docs/8.3/platform/ignition-redundancy, https://www.docs.inductiveautomation.com/docs/8.1/platform/gateway/config)
- **Ignition Edge**: runs a limited module set on embedded devices; no SQL database connectivity; one project and one tag provider; 35 days of internal historical/event storage; max 2 concurrent client views; unlimited tags/devices; includes OPC UA server + native drivers (AB, Siemens, Mitsubishi, Modbus, DNP3, Omron, BACnet, IEC 61850, serial, UDP/TCP); syncs to central server via Gateway Network and/or MQTT (Sparkplug). (https://inductiveautomation.com/pricing/ignition, https://inductiveautomation.com/ignition/edge)
- **Ignition Cloud Edition**: sold through AWS/Azure marketplaces as VM image or EKS container; usage-based hourly billing = base rate + CPU cores + heap GB; **no direct PLC/device drivers** (cloud must not connect to plant devices); pre-packaged modules; detects paid image so no license key needed. (https://www.docs.inductiveautomation.com/docs/8.3/other-editions/ignition-cloud-edition, https://inductiveautomation.com/ignition/cloud-edition)
- **Module system**: everything is a module plugging into Gateway/Designer/client scopes; open module SDK for third parties (Sepasoft, Cirrus Link, 50+ community modules). (https://en.wikipedia.org/wiki/Ignition_SCADA, https://inductiveautomation.com/ignition/modules)

### 1.3 Tag & Data Model

- **Tag providers**: Internal (stored in Gateway) and Remote (share tags from another gateway — enables hub/spoke tag fan-in). Real-time providers vs historian providers. Configured globally on the Gateway, usable by all projects. (https://www.docs.inductiveautomation.com/docs/8.3/platform/tags)
- Tag types: OPC, Memory, Expression, Query, Derived, Reference; each tag carries value + quality + timestamp.
- **UDTs** (User Defined Types): object-oriented parameterized types with inheritance/override — change the definition and all instances update; first-class support for drag-and-drop binding into Vision templates. (https://www.docs.inductiveautomation.com/docs/8.3/platform/tags)
- **Tag Groups** (formerly scan classes) define execution rates driving polling, history sampling, and expression evaluation. Alarms, history, and events are configured per-tag. (https://www.docs.inductiveautomation.com/docs/8.3/ignition-modules/tag-historian/configuring-tag-history)

### 1.4 Historian

- **Classic model (7.x–8.1)**: Tag Historian writes to a standard SQL database — no proprietary historian required; per-tag history enablement, millisecond timestamps, quality, deadband, sample modes (Periodic, On-Change, Tag Group), min/max timers. (https://www.docs.inductiveautomation.com/docs/8.3/ignition-modules/tag-historian/configuring-tag-history, https://www.docs.inductiveautomation.com/docs/8.1/ignition-modules/tag-historian/how-the-tag-historian-system-works)
- **Store & Forward**: reliable delivery pipeline with memory buffer + local disk cache, multi-threaded, up to 6 concurrent data-type streams (Alarming, Auditing, Scripting, SECS/GEM, Tag History, Transaction Groups). (https://www.docs.inductiveautomation.com/docs/8.3/platform/store-and-forward)
- **8.3 "Universal Historian Solution"**: two new modules — **Historian Core** (includes the QuestDB-powered **Core Historian**: zero-config, native aggregation, archiving, dedup, partitioning, aliasing, metadata; ~10× faster storage/query than the legacy internal SQLite provider) and **SQL Historian** (high-performance external SQL storage with compression/partitioning/interpolation/aggregation). New **public Historian API** lets third-party modules implement custom historians — "Ignition isn't just a historian; it's a platform for building historians." (https://inductiveautomation.com/ignition/whatsnew, https://inductiveautomation.com/blog/ignition-830-universal-historian-solution-event-streams-new-perspective-drawing-tools-so-much-more, https://www.docs.inductiveautomation.com/docs/8.3/getting-started/modules-overview/core-modules/tag-historian-module)
- **SQL Bridge (Transaction Groups)**: bidirectional PLC↔SQL bridge; group types: Historical, Standard (two-way), Block (multi-row), Stored Procedure; triggers, schedules, handshakes — used for event logging, recipes, batching. (https://www.docs.inductiveautomation.com/docs/8.3/ignition-modules/sql-bridge-transaction-groups, https://inductiveautomation.com/ignition/modules/sql-bridge)

### 1.5 Alarms & Events

- Alarms configured on individual tags (with setpoints/modes); **Alarm Journal** records alarm lifecycle to SQL; shelving, priorities, display paths; ISA-18.2-style alarm metrics aggregation at UDT/folder level. (https://inductiveautomation.com/ignition/modules/alarm-notification)
- **Alarm Notification Pipelines**: drag-and-drop logic diagrams (global Gateway resources) controlling who is notified, when — blocks for delay, escalation, consolidation, parallel delivery; pipelines can loop and span remote gateways; three entry events (Active, Clear, Ack). (https://www.docs.inductiveautomation.com/docs/8.3/ignition-modules/alarm-notification/alarm-notification-pipelines)
- **Notification profiles**: Email (two-way ack via links), SMS (Twilio), Voice (phone ack), Twilio WhatsApp; on-call rosters and schedules; SMS/Voice shipped as separate modules extending the Alarm Notification module. (https://www.docs.inductiveautomation.com/docs/8.3/ignition-modules/alarm-notification/notification-profile-types, https://inductiveautomation.com/ignition/modules/alarm-notification)
- **8.3 Event Streams Module**: routes event-driven data from sources (tag changes, Kafka topics, alarm metrics) to handlers (scripts, DB tables) as a central unifying pipeline — a DataOps-oriented eventing layer. (https://inductiveautomation.com/ignition/whatsnew, https://inductiveautomation.com/news/inductive-automation-releases-ignition-83)

### 1.6 Graphics & HMI Editor

- **Perspective**: mobile-first, responsive design (breakpoint + flex/coordinate containers), CSS3 styling, message handling between components, params/embedded views, page URLs; **8.3 Drawing Editor** — native SVG vector illustration with tag binding, snapping/layers/paths, form generator, and **offline mode** for the mobile app (data entry/storage when disconnected). (https://inductiveautomation.com/ignition/modules/perspective, https://inductiveautomation.com/ignition/whatsnew, https://www.docs.inductiveautomation.com/docs/8.3/ignition-modules/perspective/perspective-sessions)
- **Vision**: window/template/component model optimized for control-room desktops; Symbol Factory graphics.
- Extensibility: third parties can author Perspective components via the module SDK (React front end + Java/Gateway model + WebSocket delegate API). (https://github.com/inductiveautomation/ignition-sdk-examples)

### 1.7 Scripting & Extensibility

- **Jython (Python 2.7)** everywhere: Gateway scope (timer/tag-change/message scripts — run once, always-on), Session/Client scope, Designer scope; Project Library scripts shared within a project; one project can be designated the **Gateway Scripting Project** for global scope. Large `system.*` API library (tags, DB, alarms, reports, files, navigation). Jython can call into Java standard/third-party libraries. (https://www.docs.inductiveautomation.com/docs/8.3/platform/scripting/scripting-in-ignition/project-library, https://forum.inductiveautomation.com/t/import-os-in-script/98765)
- Expression language, property bindings with transforms; Perspective message handlers; WebDev module exposes custom REST/HTTP resources (HTML resources, Python endpoints); project **inheritance** (template projects cascade to children). (https://www.docs.inductiveautomation.com/docs/8.3/ignition-modules, https://forum.inductiveautomation.com/t/updated-project-library-scripts-not-reflecting-in-gateway-ignition-8-1-48/110770)

### 1.8 Protocols & Connectivity

- **OPC UA**: module provides both a built-in cross-platform **OPC UA server** (with pluggable driver API — third parties can write drivers) and **client** (connects to any compliant third-party UA server; client capability built into Gateway even without the module). OPC COM DA+HDA bridge module for legacy (Windows-only). (https://inductiveautomation.com/ignition/modules/ignition-opc-ua, https://www.docs.inductiveautomation.com/docs/8.3/ignition-modules/opc-ua)
- **Native drivers** (core, bundled with platform): Allen-Bradley suite, Siemens S7-300/400/1200/1500 (S7 protocol; Siemens Enhanced driver adds symbolic addressing, extra cost), Modbus TCP & RTU-over-TCP, DNP3 (DNP3-L3; event polling, unsolicited, explicit reads; **no DNP3 Secure Authentication**), BACnet/IP, Omron, Mitsubishi, IEC 61850, UDP/TCP, serial. (https://www.docs.inductiveautomation.com/docs/8.3/getting-started/modules-overview/core-modules/opc-ua-module/driver-modules, https://inductiveautomation.com/ignition/modules, https://links.inductiveautomation.com/pricing/solution-suites)
- **MQTT/Sparkplug B** via Cirrus Link modules: MQTT Engine, Distributor (embedded broker), Transmission (edge publish), Recorder (auto-table population). IIoT architecture built around MQTT MOM. (https://inductiveautomation.com/ignition/modules, https://inductiveautomation.com/ignition/architectures)
- SQL connectivity to any major database; Kafka Connector + MongoDB Connector in the Enterprise Integration suite; WebDev for custom web APIs. (https://inductiveautomation.com/pricing/ignition)

### 1.9 Security & Authentication

- Two authentication strategies: **Classic** (User Sources: internal, SQL DB, Active Directory + hybrid) and **Identity Provider** (OIDC 1.0, SAML 2.0; Ignition can itself act as an IdP for isolated systems). (https://www.docs.inductiveautomation.com/docs/8.3/platform/security, https://www.docs.inductiveautomation.com/docs/8.3/platform/security/identity-provider-authentication-strategy/configuring-identity-providers)
- **Security Levels**: hierarchical tree (reserved: Public, Authenticated, Authenticated/Roles, Security Zones) with expression-based rules mapping IdP attributes/roles to levels; badge authentication option; applies across Perspective Sessions, Vision Clients, Designer, Gateway. 2FA and federated identity supported. (https://www.docs.inductiveautomation.com/docs/8.3/platform/security/identity-provider-authentication-strategy/security-levels, https://www.docs.inductiveautomation.com/docs/8.3/getting-started/perspective-and-vision)
- **Audit Profile**: DB-logged audit trail of user/gateway actions; Designer auth token TTL controls; per-section access limits by security level; SSL/TLS cert management. (https://www.docs.inductiveautomation.com/docs/8.3/platform/security/gateway-general-security-settings)
- **Electronic signatures**: Perspective "Authentication Challenge" session event (8.1.16+, Apr 2022) enables 21 CFR Part 11-style performed/verified-by signatures; Vision needs custom work. (https://corsosystems.com/posts/gmp-compliance-using-ignition, https://inductiveautomation.com/resources/article/21-cfr-part-11-compliance-with-inductive-automations-ignition-platform)

### 1.10 Reporting & Analytics

- **Reporting Module**: dynamic PDF/CSV/HTML reports; drag-and-drop SQL query builder nesting relational + tag-historian + alarm-journal data; schedule → email/network-drive delivery or display in clients. (https://inductiveautomation.com/ignition/modules/reporting)
- **MES via Sepasoft** (separate vendor, Ignition-native modules): OEE Downtime, Track & Trace (ISA-95), SPC, Batch Procedure (ISA-88 with electronic batch records + audit trails supporting 21 CFR 11), Settings & Changeover, Document Management, Web Services, Business Connector, SAP ERP interface; Production module is the required base. (https://docs.sepasoft.com/articles/user-manual/mes-modules, https://www.sepasoft.com/products/, https://www.sepasoft.com/products/batch-procedure/)

### 1.11 Redundancy & Scale

- **2-node redundancy**: master/backup gateways; backup synchronizes full config state over Gateway Network (default port 8088 non-SSL / 8060 SSL); manual "Request Failover" supported even across differing platform versions (for rolling upgrades); clients auto-redirect; Edge pairs only with Edge. (https://www.docs.inductiveautomation.com/docs/8.3/platform/ignition-redundancy, https://www.docs.inductiveautomation.com/docs/8.1/platform/ignition-redundancy/setting-up-redundancy)
- Scale-out via front-end/back-end gateway split behind load balancers; EAM for fleets; redundancy not applied to front-end gateways when a load balancer is used. Perspective lacks Vision's local-client-fallback for mission-critical local availability. (https://www.docs.inductiveautomation.com/docs/8.3/system-architectures/redundancy-architecture, https://corsosystems.com/posts/vision-vs-perspective-shoot-out)
- Unlimited licensing means ceiling is hardware; a dedicated cheaper **backup license** is sold. (https://inductiveautomation.com/ignition/unlimited, https://www.docs.inductiveautomation.com/docs/8.3/system-architectures/redundancy-architecture)

### 1.12 Licensing & Pricing (public figures)

- **Sold per server**; one license = unlimited tags, clients, screens, device connections, designer seats. Standard + Edge are **perpetual**; Cloud Edition is usage-based. Backup-node license cheaper. (https://inductiveautomation.com/ignition/unlimited, https://inductiveautomation.com/pricing/ignition)
- Published prices (inductiveautomation.com pricing pages, USD, one-time): **Ignition Platform $1,200**; Perspective Module (unlimited) **$11,225**; Vision Module **$8,330**; Reporting Module ~$3,900; à-la-carte builds "starting as low as $3,280." Solution Suites: Application Building **$13,500**, Industrial Historian **$3,500**, Alarm Management **$3,200**, DataOps **$5,500**, Enterprise Integration **$4,100**. Packages: **Basic $15,925 / Pro $24,370 / Ultimate $34,990**. Annual support typically ~$900–$1,500 (third-party estimate). (https://inductiveautomation.com/pricing/list, https://inductiveautomation.com/pricing/ignition, https://www.operametrix.com/en/licensing/, https://www.sourcebyspec.com/news/scada-licensing-and-tag-limits-how-to-compare-platforms-before-you-sign.html)
- **Maker Edition**: free, full platform, non-commercial use only. (https://inductiveautomation.com/ignition/maker-edition)

### 1.13 Standards Compliance Claimed

- 21 CFR Part 11-capable (audit trails, e-signatures in Perspective, ALCOA+ guidance — vendor white paper); Active Directory integration supports unique-account requirements. (https://inductiveautomation.com/resources/article/21-cfr-part-11-compliance-with-inductive-automations-ignition-platform, https://inductiveautomation.com/resources/casestudy/pharma-company-meets-standards-for-21-cfr-11-with-ignition)
- ISA-18.2-aligned alarm metrics; ISA-88/ISA-95 via Sepasoft; OPC UA implemented (note: per an IA staff forum post, the UA server is *not* OPC-Foundation lab-certified as of early 2025). Vendor publishes a Security Hardening Guide; aligns customer deployments with IEC 62443/NIST practices but does not itself claim IEC 62443 product certification. (https://inductiveautomation.com/ignition/modules/alarm-notification, https://forum.inductiveautomation.com/t/opc-ua-question/104466, https://www.inflexionpoint.ai/assets/docs/sb/InflexionPoint_SB_Ignition.pdf)

### 1.14 Ignition Sources

- https://inductiveautomation.com/ignition/platform
- https://inductiveautomation.com/ignition/architectures
- https://inductiveautomation.com/ignition/unlimited
- https://inductiveautomation.com/pricing/ignition and https://inductiveautomation.com/pricing/list and https://inductiveautomation.com/pricing/edition
- https://inductiveautomation.com/ignition/modules (+ /perspective, /alarm-notification, /reporting, /sql-bridge, /ignition-opc-ua)
- https://inductiveautomation.com/ignition/edge, /ignition/cloud-edition, /ignition/maker-edition, /ignition/whatsnew
- https://www.docs.inductiveautomation.com/docs/8.3/platform/{gateway,designer,tags,store-and-forward,security,ignition-redundancy} and module docs (alarm-notification, tag-historian, sql-bridge, perspective, opc-ua)
- https://inductiveautomation.com/blog/ignition-830-universal-historian-solution-event-streams-new-perspective-drawing-tools-so-much-more
- https://inductiveautomation.com/news/inductive-automation-releases-ignition-83
- https://corsosystems.com/posts/vision-vs-perspective-shoot-out and /posts/gmp-compliance-using-ignition
- https://github.com/inductiveautomation/ignition-sdk-examples; https://github.com/EckmanTechLLC/perspective-cookbook
- https://docs.sepasoft.com/articles/user-manual/mes-modules; https://www.sepasoft.com/products/
- https://forum.inductiveautomation.com/t/opc-ua-question/104466 (OPC certification status)
- https://en.wikipedia.org/wiki/Ignition_SCADA

---

## 2. GE Vernova — Proficy Suite (iFIX, CIMPLICITY, Proficy Historian, Operations Hub, Web HMI/Webspace)

### 2.1 Overview & Positioning

- Legacy enterprise SCADA lineage: iFIX (orig. Intellution) and CIMPLICITY (orig. GE Fanuc), now under **GE Vernova** (software business spun out of GE in the April 2024 GE Vernova separation; formerly "GE Digital"). Reseller materials claim 400k+ iFIX licenses worldwide. (https://www.vix.com.pl/ifix/wp-content/uploads/sites/2/2025/11/ulotka-ifix-2025.pdf, https://www.gevernova.com/software/product-documentation)
- Portfolio positioning: iFIX/CIMPLICITY for plant HMI/SCADA; **Proficy Historian** as the flagship time-series historian; **Operations Hub** as the web-native operations-intelligence layer; **Webspace** and **Web HMI** as browser clients; Proficy Smart Factory/Plant Applications for MES. (https://www.gevernova.com/software/product-documentation)
- iFIX vs CIMPLICITY split (per GE partner guidance): iFIX for single-site/centralized plants with high-performance HMI; CIMPLICITY for distributed, multi-site enterprises with node-based architecture and "Active Update" zero-downtime deployment (headline CIMPLICITY 2025 feature). (https://www.alliedsolutionsglobal.com/en/news/ifix-scada-proficy-guide-singapore-vietnam, https://www.alliedsolutionsglobal.com/en/news/proficy-cimplicity-hmi-scada-guide-singapore-vietnam)

### 2.2 Architecture (Client Types, Server)

- **iFIX node model**: any computer running iFIX is a node — SCADA Server (owns the in-memory Process Database and I/O drivers), Blind SCADA Server (no display), iClient (thick client), iClientTS (Terminal Services thin client), plus Webspace/Web HMI browsers. Classic, non-server-centric architecture: each node runs iFIX services locally; the SCADA node polls I/O. (https://www.infoplc.net/files/descargas/ge/infoplc_net_Intro_to_iFIX.pdf, https://automatechinc.atlassian.net/wiki/spaces/GPI/pages/1363804189)
- **CIMPLICITY**: client–server architecture of Servers (data collection/distribution) + Viewers (CimView); servers/viewers network seamlessly without replicating the point database per node; Web Client option; distributed multi-node roll-up is a design point. (https://www.gevernova.com/software/documentation/cimplicity/version2024/pdf/bm_cimplicity_getting_started_master.pdf)
- **Configuration Hub**: shared, centralized web-based configuration/admin plane across iFIX, CIMPLICITY, Historian, Operations Hub; integrates **Proficy Authentication** (common UAA) and asset modeling. (https://www.gevernova.com/software/documentation/ifix/version2023/pdf/Getting%20Started%20with%20iFIX.pdf, https://graymattersystems.com/wp-content/uploads/2024/02/CBS-455_Operations_Hub_Automation.pdf)
- **Web clients (three generations)**:
  - **Proficy Webspace 6.2**: "zero-install" HTML5 client that extends 100% of an existing iFIX/CIMPLICITY application (screens unconverted) into a browser/tablet; own embedded web server (no IIS/Apache since 2023); SSL/TLS up to 256-bit AES; **up to 70 simultaneous clients**; free iPad/Android app; sandbox/whitelisting. (https://www.gevernova.com/software/products/hmi-scada/proficy-webspace, https://www.gevernova.com/software/documentation/ifix/version2023/pdf/Important%20Product%20Information%20for%20iFIX%202023.pdf, https://www.servitecno.it/wp-content/uploads/2023/07/webspace-6.2-from-ge-digital.pdf)
  - **Proficy Web HMI (2.0)**: model-based native HTML5 HMI client that auto-generates runtime apps over iFIX/CIMPLICITY/Historian data; no client install; works across multiple data sources. (https://metronik.rs/equipment/ge-digital/, https://vix.com.pl/webhmi2-2/, https://indusoft.ru/products/proficy-hmi-scada/proficy-web-hmi/)
  - **Operations Hub**: pure native-HTML5 apps (no client install) built from widget library + queries; also embeds a Webspace widget to display legacy iFIX/CIMPLICITY screens. (https://automatech.com/wp-content/uploads/3-Operations-Hub-2023-datasheet.pdf, https://www.gevernova.com/software/documentation/ifix/version2023/pdf/Important%20Product%20Information%20for%20iFIX%202023.pdf)
- Thick iClient remains 100%-feature client (VBA, ActiveX); Webspace supports VBA/ActiveX in-browser; Ops Hub/Web HMI are the strategic HTML5 path. (https://automatechinc.atlassian.net/wiki/spaces/GPI/pages/1363804189)

### 2.3 Tag & Data Model

- **iFIX**: Process Database (PDB) — in-memory block database on each SCADA node; primary blocks (I/O) chained to secondary blocks (calculations, alarms, SPC, recipes); tags with alarm areas; Database Manager spreadsheet editing. (https://www.gevernova.com/software/documentation/ifix/version2024/pdf/iFIX%20Database%20Reference.pdf)
- **CIMPLICITY**: point-based model with **Classes and Objects** (template classes carrying attributes, points, actions, events, scripts, screens — analogous to UDTs); Event Manager; global points for cross-node sharing. (https://www.gevernova.com/software/documentation/cimplicity/version2023/pdf/bm_cimplicity_advanced_features_master.pdf)
- Shared **Proficy asset model** across Historian/Ops Hub/SCADA for context (tag ↔ asset association, model-based navigation). (https://automatech.com/wp-content/uploads/5-Historian-2023-datasheet.pdf)

### 2.4 Historian

- **Proficy Historian** (separate product, best-in-class positioning): collects time-series + A&E at high speed; claims: compression ~2× more efficient than the leading competitor and ~30× more efficient than relational DBs; scales to **100 million tags/data points**; up to **150,000 values/sec per interface** into cloud; **Proficy Historian for Cloud (AWS)** claims **1 billion samples/minute ingestion**; hundreds of users. (https://www.gevernova.com/software/products/proficy/historian, https://www.gevernova.com/software/products/proficy/historian/cloud, https://seicosoft.com/wp-content/uploads/2025/01/Historian-Datasheet-Source-Files-1.pdf)
- Features: HTML5 admin, remote collector management, disaster-recovery data replication/failover, Parquet export, MQTT V5/Sparkplug B ingestion, asset model, Python-based calculation collector, CSense analytics, Historian Edge edition. (https://automatech.com/wp-content/uploads/5-Historian-2023-datasheet.pdf, https://seicosoft.com/wp-content/uploads/2025/01/Historian-Datasheet-Source-Files-1.pdf)
- iFIX bundles **Historian Essentials** (e.g., 100–1,000 permanent tags + 2,500–10,000-tag 200-day buffer, scaled with license tier). (https://vix.com.pl/cennik/, https://www.novotek.com/co-uk/wp-content/uploads/sites/7/Automation-iFIX-2022-Configuration-Guide.pdf)

### 2.5 Alarms & Events

- iFIX alarm subsystem: alarms generated per database block; priorities INFO/LOLO/LOW/MEDIUM/HIGH/HIHI/CRITICAL; **alarm areas** route to alarm destinations; alarm tasks on each node; Alarm ODBC service writes alarm history to relational DB; operator messages (incl. e-signature messages); alarm horn; FilterAlm.ini for per-node filtering; Auto Alarm Manager; OPC A&E support. (https://www.gevernova.com/software/documentation/ifix/version65/pdf/implementing_alarms_and_messages.pdf, https://www.gevernova.com/software/documentation/ifix/version2023/pdf/Understanding%20iFIX.pdf)
- Alarm notification to email/SMS/phone is **not native** — bundled/integrated third-party **WIN-911 Essentials** covers it (per iFIX config guide). (https://www.novotek.com/co-uk/wp-content/uploads/sites/7/Automation-iFIX-2022-Configuration-Guide.pdf)
- Historian ingests A&E data natively. (https://www.gevernova.com/software/products/proficy/historian)

### 2.6 Graphics & HMI Editor

- iFIX WorkSpace + **CimEdit-style picture editor** (pictures, dynamos reusable graphic objects, animations, schedules, experts/wizards); high-performance HMI guidance; classic desktop editing model — no browser-based screen designer for the core SCADA. (https://automatech.com/wp-content/uploads/CBS-154_HMI_SCADA_iFIX_Fundamentals-3.pdf)
- CIMPLICITY **CimEdit/CimView**; new-generation **native HTML5 Graphics Designer and lightweight runtime** introduced with CIMPLICITY 2023+ (Web HMI direction). (https://www.gevernova.com/software/resources/webinar/proficy-2023-webinars-cimplicity-2023)
- **Operations Hub designer**: runs inside Configuration Hub (HMI-powered designer layout since 2023); drag-and-drop **widget/card** model, queries, asset model binding, **SVG editor** for custom graphics, reusable components/faceplates, runtime substitution, responsive design for PC/tablet/phone; no-code/low-code for non-developers. (https://www.gevernova.com/software/documentation/opshub/version20231/pdf/bm_opshub_infoset_win.pdf, https://automatech.com/wp-content/uploads/3-Operations-Hub-2023-datasheet.pdf, https://www.velotic.com/products/proficy/operations-hub)

### 2.7 Scripting & Extensibility

- **iFIX: VBA** (Visual Basic for Applications embedded in the WorkSpace) — time/event schedules, object scripting, Experts/wizards generate code; deep object model access (System tree); scripts resolve tag data at runtime. (https://www.gevernova.com/software/documentation/ifix/version2022/pdf/Writing%20Scripts.pdf, https://www.gevernova.com/software/documentation/ifix/version2024/pdf/Mastering%20iFIX.pdf)
- **CIMPLICITY: Basic Control Engine (CimBasic)** plus **CimScriptIDE for C#/VB.NET** (debug in Visual Studio, attach .NET assemblies); Python available via the Historian calculation collector and APIs. (https://www.gevernova.com/software/documentation/cimplicity/version2024/pdf/bm_cimplicity_basic_control_engine_and_scripting_reference_master.pdf, https://automatech.com/wp-content/uploads/CIMPHistorianAutomatechEvent_V2_AT_FINAL.pdf)
- Operations Hub extensible via custom widgets/plug-ins; SDK documented in docs portal. (https://www.gevernova.com/software/documentation/opshub/version2025/index.html)

### 2.8 Protocols & Connectivity

- **iFIX native drivers**: ABR (Allen-Bradley via RSLinx OPC), OPC client driver, S17 (Siemens S7), MBE/MB1 (Modbus Ethernet/serial), GE9 (GE SNP), STRP, EGD. (https://automatech.com/wp-content/uploads/Native-iFIX-Drivers.pdf)
- **IGS — Industrial Gateway Server** (GE-branded OPC connectivity layer): Basic edition = "100s of protocols" (Allen-Bradley families, Modbus, Siemens, GE, Honeywell, Mitsubishi, Omron, Yokogawa, ODBC, MTConnect…); **Premium drivers** incl. MQTT, DNP3, IEC 61850, IEC 60870-5-104; OPC UA server+client, OPC DA/A&E, XML-DA; TLS 1.2 / Basic256Sha256 defaults. IGS Basic included in some iFIX licenses. (https://www.catapultsoftware.com/images/ProductDocuments/industrial-gateway-server-from-ge-digital-2022.pdf, https://automatechinc.atlassian.net/wiki/spaces/IGOS/pages/1352892499, https://www.novotek.com/co-uk/wp-content/uploads/sites/7/Automation-iFIX-2022-Configuration-Guide.pdf)
- iFIX itself is OPC UA client + server (via Configuration Hub); OPC DA client + server; Discover & Auto-Configure agent scans IGS/PLC networks to build the PDB. CIMPLICITY has native OPC client + OPC UA client + its own OPC server; **CIMPLICITY MQTT Client** (MQTT 5) for IIoT. (https://www.gevernova.com/software/documentation/cimplicity/version2023/pdf/bm_cimplicity_device_communications_master.pdf, https://www.gevernova.com/software/documentation/ifix/version2022/pdf/Discover%20and%20Auto%20Configure.pdf, https://www.gevernova.com/software/documentation/cimplicity/version2024)

### 2.9 Security & Authentication

- iFIX security: security areas group blocks; user/group accounts; app-feature rights; write-access control to PDB; **Electronic Signatures** (Performs/Verified-By per tag, for writes and alarm ack) targeting 21 CFR Part 11; security logging; Security Synchronizer distributes accounts; optional and off by default. (https://www.gevernova.com/software/documentation/ifix/version2023/pdf/Configuring%20Security%20Features.pdf, https://www.novotek.com/dk/wp-content/uploads/sites/4/iFIX-Secure-Deployment-Guide.pdf)
- Cross-product **Proficy Authentication (UAA)** — shared user-account authentication, LDAP-integrated, used by Historian/Ops Hub/Config Hub; SSL cert management; published **Secure Deployment Guides** for iFIX and CIMPLICITY with zone/firewall reference architectures. (https://automatech.com/wp-content/uploads/5-Historian-2023-datasheet.pdf, https://www.novotek.com/at/wp-content/uploads/sites/13/CIMPLICITY_Secure_Deployment_Guide_24_08.pdf)

### 2.10 Reporting & Analytics

- **Dream Report** bundled as the common reporting component; Historian trending/analysis web clients; **Proficy CSense** for AI/ML analytics; Plant Applications (MES), Tracker, Workflow, Batch Execution as the broader analytics/MES stack. (https://www.gevernova.com/software/product-documentation, https://seicosoft.com/wp-content/uploads/2025/01/Historian-Datasheet-Source-Files-1.pdf)

### 2.11 Redundancy & Scale

- **iFIX Enhanced Failover**: licensed option; Active/Standby SCADA pair functioning as one logical node; active continuously pushes PDB image to standby via SCADASync.exe; SCADARoleMgr.exe arbitrates; TCP/UDP sync port 53014 (TCP default since iFIX 2023, removing same-location requirement); dedicated network recommended; iClients auto-follow the active node. Failover is a separately keyed (paid) option. (https://www.gevernova.com/software/documentation/ifix/version2022/pdf/Enhanced%20Failover.pdf, https://www.novotek.com/dk/wp-content/uploads/sites/4/iFIX-Secure-Deployment-Guide.pdf)
- **CIMPLICITY server redundancy**: primary/secondary point-manager failover (RtrPing, TCP 4000 default), computer and cable redundancy; viewers auto-failover (trend-buffer caveat). (https://www.gevernova.com/software/documentation/cimplicity/version11/pdf/bm_cimplicity_networking_master.pdf)
- Scale claims: iFIX improved single-server scale to 64,000 tags per data type (iFIX 2022); CIMPLICITY tested at 1M points on a single server, designed for >500K-point distributed systems, hundreds of viewers per server; Historian to 100M tags / 1B samples-per-minute on AWS. (https://www.novotek.com/co-uk/wp-content/uploads/sites/7/Automation-iFIX-2022-Configuration-Guide.pdf, https://automatech.com/wp-content/uploads/CIMPHistorianAutomatechEvent_V2_AT_FINAL.pdf, https://www.gevernova.com/software/products/proficy/historian/cloud)

### 2.12 Licensing & Pricing (public figures)

- Traditional **per-node, I/O-point-tier licensing**: iFIX tiers 75 / 150 / 300 / 900 / 1,500 / 10,000 / 30,000 / Unlimited points; levels: Embedded, **Standard** (standalone — no networking/clients) and **Plus** (networked SCADA). Clients (iClient/iClientTS) licensed separately; **term-based licensing and unlimited-client options** added ~2021. Failover/SCADA Sync, Electronic Signature (~30% of server+TS price), and iPower (~64% of server price) are separately keyed options. Historian Essentials bundled per tier. Public list prices are not posted on gevernova.com — quotes via distributors; a 2014-era leaked sheet showed iFIX Plus 75-I/O Dev ≈ $3,899 (historical reference only). (https://www.novotek.com/co-uk/wp-content/uploads/sites/7/Automation-iFIX-2022-Configuration-Guide.pdf, https://vix.com.pl/cennik/, https://studylib.net/doc/5304913/proficyproficyifix_58licensingchanges)
- Third-party pricing guides peg typical Proficy deployments at ~$4k–$16k server + $15k–$35k for Proficy Historian (unverified industry estimate). (https://industrialmonitordirect.com/blogs/knowledgebase/scada-system-pricing-comparison-total-cost-components-guide)

### 2.13 Standards Compliance Claimed

- 21 CFR Part 11 support via iFIX Electronic Signatures + e-sig logging. (https://www.gevernova.com/software/documentation/ifix/version2023/pdf/Configuring%20Security%20Features.pdf)
- OPC UA client/server across iFIX, CIMPLICITY, IGS, Historian; OPC Classic DA/A&E. IEC 60870-5-104, DNP3, IEC 61850 via IGS premium drivers. (https://www.catapultsoftware.com/images/ProductDocuments/industrial-gateway-server-from-ge-digital-2022.pdf)
- Vendor publishes Secure Deployment Guides aligned to ICS best practice; no IEC 62443 product certification claim found in public materials. (https://www.novotek.com/at/wp-content/uploads/sites/13/CIMPLICITY_Secure_Deployment_Guide_24_08.pdf)

### 2.14 GE Proficy Sources

- https://www.gevernova.com/software/product-documentation
- https://www.gevernova.com/software/products/hmi-scada/operations-hub
- https://www.gevernova.com/software/products/hmi-scada/proficy-webspace
- https://www.gevernova.com/software/products/proficy/historian and /historian/cloud
- https://www.gevernova.com/software/documentation/ifix/version2024 (and 2022/2023) — Configuring Security, Enhanced Failover, Writing Scripts, Database Reference, Discover & Auto Configure PDFs
- https://www.gevernova.com/software/documentation/cimplicity/version2024 — Getting Started, Advanced Features, Basic Control Engine, Device Communications PDFs
- https://www.gevernova.com/software/documentation/opshub/version2025/index.html
- https://automatech.com/wp-content/uploads/3-Operations-Hub-2023-datasheet.pdf; /5-Historian-2023-datasheet.pdf; /Native-iFIX-Drivers.pdf; /CIMPHistorianAutomatechEvent_V2_AT_FINAL.pdf
- https://www.catapultsoftware.com/images/ProductDocuments/industrial-gateway-server-from-ge-digital-2022.pdf
- https://seicosoft.com/wp-content/uploads/2025/01/Historian-Datasheet-Source-Files-1.pdf
- https://www.novotek.com/co-uk/wp-content/uploads/sites/7/Automation-iFIX-2022-Configuration-Guide.pdf; https://www.novotek.com/dk/wp-content/uploads/sites/4/iFIX-Secure-Deployment-Guide.pdf; https://www.novotek.com/at/wp-content/uploads/sites/13/CIMPLICITY_Secure_Deployment_Guide_24_08.pdf
- https://www.alliedsolutionsglobal.com/en/news/ifix-scada-proficy-guide-singapore-vietnam; /proficy-cimplicity-hmi-scada-guide-singapore-vietnam
- https://automatechinc.atlassian.net/wiki/spaces/GPI/pages/1363804189 (client comparison); /IGOS/pages/1352892499 (IGS protocols)
- https://www.gevernova.com/software/resources/webinar/proficy-2023-webinars-cimplicity-2023
- https://metronik.rs/equipment/ge-digital/; https://www.velotic.com/products/proficy/web-hmi-scada-clients and /operations-hub
- https://vix.com.pl/cennik/; https://studylib.net/doc/5304913/proficyproficyifix_58licensingchanges

---

## 3. VTScada (Trihedral — Delta Electronics)

### 3.1 Overview & Positioning

- VTScada by **Trihedral Engineering** (founded 1986, Canada); **acquired 100% by Delta Electronics in Nov 2020 for CAD 45M** — keeps its brand and management team; "A Delta Group Company." Serves 100+ countries. (https://www.delta-americas.com/en-US/news/21641, https://www.vtscada.com/about-trihedral/)
- Positioning: **"instantly intuitive," fully integrated all-in-one SCADA** — historian, alarms, trends, reports, polling, redundancy, version control, web/mobile clients all in one install and license philosophy (no third-party components to buy/integrate/re-integrate). Distinctive strength in **water/wastewater** telemetry across North America/UK; also oil & gas, power, broadcasting. (https://www.vtscada.com/what-is-vtscada/, https://www.vtscada.com/fully-integrated-scada-features/, https://www.vtscada.com/water-and-wastewater-scada/)

### 3.2 Architecture (Client Types, Server)

- **Integrated monolith** (by design): every mission-critical component is built in — I/O drivers + native polling engine, historian, alarm notification, trends, reports, Internet server, version control, backup — "one file installs all components." Optional features unlock via license-key update. (https://www.vtscada.com/what-is-vtscada/, https://www.vtscada.com/fully-integrated-scada-features/)
- **Server architecture**: distributed fault-tolerant network of VTScada servers — "no-compromise load-balancing and hot-backup failover using fewer computers"; real-time synchronization of configuration + history across any number of servers; runs on Windows (can run as a Windows service). Everything is a tag/module under the hood — the product is largely written in its own language. (https://www.vtscada.com/what-is-vtscada/, https://www.vtscada.com/, https://www.vtscada.com/help/Content/Scripting/API/S_Welcome.htm, https://www.vtscada.com/help/Content/D_Customize/Dev_SecurityBestPractices.htm)
- **Client types**:
  - **Full installation client** — same VTScada install serves as operator station (any node can be full client + server).
  - **VIC (VTScada Internet Client / Thin Client)**: served by VTScada's own built-in web server — "no third-party webserver or remote desktop software required"; screens auto-translated exactly as on full clients (no conversion); updates pushed only on change; config syncs automatically on connect. (https://www.vtscada.com/scada-thin-clients/)
  - **VTScada Anywhere Client**: HTML5 browser client for smartphones/tablets/PCs/Macs — zero footprint, no Java, push-based real-time data. (https://www.vtscada.com/scada-thin-clients/)
  - **MIC (Mobile Internet Client)**: HTML5 touch-optimized navigation for sites/process; manual or timed refresh. (https://www.vtscada.com/scada-thin-clients/)

### 3.3 Tag & Data Model

- Tag-centric object model: typed I/O tags (analog/digital) carry **built-in alarms, logging, and reports**; Context tags group related drivers/tags; calculated tags don't consume licensed tag count; expressions embedded in tag dialogs and widget properties; tag-scope rules bound to security privileges. (https://www.vtscada.com/fully-integrated-scada-features/, https://www.vtscada.com/scada-software-pricing/, https://www.vtscada.com/help/Content/D_Customize/dev_SystemPrivilegeRef.htm)
- **Real-time application version control**: integrated change tracking permitting auditing and instant online rollback of configuration changes — a distinctive, deeply integrated feature. (https://www.vtscada.com/what-is-vtscada/)

### 3.4 Historian

- **Built-in binary-file Historian**, included free, zero config/DB management; standardized schema; compact binary storage, keeps *all* data by default (optional FIFO retention); **any number of Historians per app** (mixed back-ends, e.g., file-based + MS SQL); redundant historian configuration; history import when migrating from other SCADA (v11.3.14+); **Historical Data Viewer** for trends/tables/annotation/export. ODBC/REST interfaces for third-party analytics. (https://www.vtscada.com/scada-historian/)

### 3.5 Alarms & Events

- Integrated alarm subsystem with **ISA 18.2-aligned Alarms Manager** (shelving, filtering, integrated reports); current/unacknowledged/historical views; **integrated notification** (email, SMS, text-to-speech voice over any phone) with contact rosters; alarm notification is a licensed add-on tier; seamless notification failover across servers. (https://www.vtscada.com/, https://www.vtscada.com/images/documents/PriceLists/VTScada_US_Small_to_Medium_Systems.pdf)

### 3.6 Graphics & HMI Editor

- **Idea Studio**: drag-and-drop page/widget designer (pages, widgets, maps, trends, operator notes); auto-generates a display (with alarms) per RTU; every page compiles to a `.SRC` module in the VTScada language; user-defined widgets supported; display auto-conversion to Thin/Anywhere clients. (https://www.vtscada.com/scada-thin-clients/, https://www.vtscada.com/help/Content/Scripting/Tasks/pro_WorkWithPages.htm, https://www.vtscada.com/fully-integrated-scada-features/)

### 3.7 Scripting & Extensibility

- **Proprietary VTScada language**: object-oriented, state-based, reactive scripting used to build everything in the product (pages, widgets, tags, tools, drivers, reports, wizards). Vendor actively discourages custom code in favor of standard features (maintainability philosophy). Expressions embed in tags/widgets; full scripts in text files. (https://www.vtscada.com/help/Content/Scripting/API/S_Welcome.htm)
- Extensibility also via ODBC server, OPC server (DA), and Web Services (SOAP/REST) for third-party integration; drivers can be custom-written by Trihedral. (https://www.vtscada.com/, https://www.vtscada.com/device-driver-library/)

### 3.8 Protocols & Connectivity

- **100+ native drivers** included in base price: Modbus ASCII/RTU/Plus/TCP, DNP3 (incl. Emerson FBx flow computers), IEC 60870-5 (master + slave/virtual PLC), SNMP, Enron Modbus, Allen-Bradley DF1/Ethernet (SLC-500/PLC-5/ControlLogix/MicroLogix), Siemens S7, plus numerous proprietary RTU drivers (SCADAPack, Motorola ACE, Flygt, ION meters…). OPC **DA client + DA server**, OPC **UA client** (TCP binary 1.04). Driver support for store-and-forward/logged data retrieval on some drivers; DDE for PI/Excel. (https://www.vtscada.com/device-driver-library/, https://www.vtscada.com/documents/datasheets/Datasheet-VTScada-12-2-DriverList.pdf)
- **Native Polling Driver** (distinctive): replaces master-PLC polling hardware — polling groups, ordered/scheduled cycles, on-demand fast-scan per site, poll-by-trigger, per-driver scan rates, min/max/stats display; telemetry-grade (radio/serial WAN) design, ideal for municipal distributed sites. (https://www.vtscada.com/help/Content/D_Tags/Dev_PollingDriver.htm, https://www.vtscada.com/fully-integrated-scada-features/)

### 3.9 Security & Authentication

- Privilege/role system (page-level privileges, tag-scope rules, per-user privileges); **Windows Security Integration**; **OAuth 2.0 / OpenID Connect** options; auto sign-out, password-complexity rules; thin clients use Basic Auth (must be protected by TLS/X.509 cert — documented honestly); can run headless as Windows service with only thin-client access. (https://www.vtscada.com/help/Content/D_Customize/dev_SystemPrivilegeRef.htm, https://www.vtscada.com/help/Content/D_Customize/Dev_SecurityBestPractices.htm)
- Security Guidelines manual embedded in every license for IEC 62443-aligned hardening. (https://www.vtscada.com/application-security/)

### 3.10 Reporting & Analytics

- Built-in scheduled/ad-hoc report generation (pre-defined types incl. water/wastewater dailies — flow totals, pump runtime discrepancy, comm-error summaries); third-party connectors to **XLReporter and Dream Report**; Historian accessible via ODBC (REST) for BI/analytics. (https://www.vtscada.com/, https://www.vtscada.com/fully-integrated-scada-features/)

### 3.11 Redundancy & Scale

- **Unlimited redundant servers** — add any number; automatic real-time sync of history + configuration; seamless failover for comms, data logging, alarm notification, and thin clients; **backfill** of missed data when a server returns; load distribution of SCADA services across servers; MUX/multiwrite tags for device and communication-path redundancy; redundant historians. (https://www.vtscada.com/, https://www.vtscada.com/water-and-wastewater-scada/)
- Scale: "support for over 1 million data points"; license tiers to **2,500,000 I/O tags**; enterprise price list beyond 100,000 I/O. (https://www.vtscada.com/water-and-wastewater-scada/, https://www.vtscada.com/documents/datasheets/Datasheet-VTScada-LicenseDescription.pdf, https://www.vtscada.com/scada-software-pricing/)

### 3.12 Licensing & Pricing (public figures)

- **Per-PC, per-I/O-tag, perpetual** (one-time) licensing. Only tags reading/writing external equipment count (all apps on that PC counted); Thin Clients licensed per concurrent user (single / 5-pack / unlimited); add-ons: Alarm Notification, third-party data sharing (ODBC/OPC Server/Web Services), Development licenses; back-up server runtimes are cheaper; multi-server discounts; SupportPlus annual support. Free **VTScadaLIGHT** entry edition exists. Public US price list (in effect May 2021): 1,000 I/O — Dev Runtime $5,595 / Runtime $2,895; 5k $7,395/$3,795; 10k $9,095/$4,595; 25k $10,995/$5,395; 50k $12,795/$6,295; Notification $1,395–$3,695; thin clients $7,295 (single) up to $53,195 (unlimited at 50k); 100k+ → Enterprise list. Euro 2025 list shows bundle pricing (e.g., 5k-I/O bundles €15,553–€43,174; 50k €24,675–€92,458 depending on features). (https://www.vtscada.com/scada-software-pricing/, https://www.vtscada.com/images/documents/PriceLists/VTScada_US_Small_to_Medium_Systems.pdf, https://www.vtscada.com/downloads/pricelists_2025/2025_VTScada_Euro%20Pricing.pdf, https://www.vtscada.com/application-security/)

### 3.13 Standards Compliance Claimed

- **IEC 62443-4-1 Secure Product Development Lifecycle certified at Maturity Level 3** by exida (ML2 in April 2022 → ML3 July 2024) — a certification differentiator; vendor notes ML3 covers VTScada's *integrated* components end-to-end (unlike suites relying on third-party historians/dialers). (https://www.vtscada.com/vtscadas-iec-62443-cybersecurity-certification-upgraded-to-maturity-level-3/, https://www.vtscada.com/application-security/)
- ISA 18.2 alarm-management alignment; protocol standards: DNP3, IEC 60870-5, OPC DA/UA. (https://www.vtscada.com/, https://www.vtscada.com/documents/datasheets/Datasheet-VTScada-12-2-DriverList.pdf)

### 3.14 VTScada Sources

- https://www.vtscada.com/; /what-is-vtscada/; /fully-integrated-scada-features/; /scada-historian/; /scada-thin-clients/; /device-driver-library/; /water-and-wastewater-scada/; /application-security/; /about-trihedral/
- https://www.vtscada.com/scada-software-pricing/; /images/documents/PriceLists/VTScada_US_Small_to_Medium_Systems.pdf; /downloads/pricelists_2025/2025_VTScada_Euro%20Pricing.pdf; /documents/datasheets/Datasheet-VTScada-LicenseDescription.pdf
- https://www.vtscada.com/documents/datasheets/Datasheet-VTScada-12-2-DriverList.pdf; Datasheet-VTScada-ApplicationSecurity.pdf
- https://www.vtscada.com/help/Content/Scripting/API/S_Welcome.htm; /Content/Scripting/Tasks/pro_WorkWithPages.htm; /Content/D_Tags/Dev_PollingDriver.htm; /Content/D_Customize/{Dev_SecurityBestPractices,dev_ProtectPages,dev_SystemPrivilegeRef}.htm
- https://www.vtscada.com/vtscadas-iec-62443-cybersecurity-certification-upgraded-to-maturity-level-3/; /delta-acquires-trihedral/
- https://www.delta-americas.com/en-US/news/21641

---

## Cross-Platform Snapshot (for gap analysis)

| Dimension | Ignition | GE Proficy | VTScada |
|---|---|---|---|
| Architecture | Server-centric Gateway; web-deployed clients | Node-based (per-node services + shared config via Config Hub) | Integrated all-in-one; distributed sync'd servers |
| Web client | Perspective = native HTML5/WebSocket, server-rendered | Webspace (screen-mirror HTML5), Web HMI, Ops Hub | Anywhere/HTML5 + VIC thin client |
| Designer | Installed Java Designer (web-launched); 8.3 deep-link launch | WorkSpace/CimEdit (desktop); Ops Hub designer in Config Hub (web) | Idea Studio (in-product) |
| Historian | SQL-DB historian + new QuestDB Core Historian (8.3) | Separate Proficy Historian (100M tags, AWS hyperscale) | Built-in binary historian (free) |
| Scripting | Jython/Python | VBA / CimBasic / C#/VB.NET | Proprietary VTScada language |
| Alarm notify | Native pipelines (email/SMS/voice/WhatsApp) | Via bundled WIN-911 | Integrated (add-on license) |
| Licensing | Per-server unlimited (perpetual, ~$3.3k+) | Per-node per-I/O-point tiers + client seats | Per-PC per-I/O-tag perpetual |
| Flagship cert | 21 CFR 11-capable; OPC UA impl. (not lab-certified) | 21 CFR 11 e-signatures; OPC UA | IEC 62443-4-1 ML3 (exida) |
| Sweet spot | Modern web-native SCADA/IIoT/MES platform | Legacy enterprise plants, historian-centric | Water/wastewater telemetry, integrated simplicity |

**Key differentiators for the gap analysis:**
- Ignition: only platform where the *runtime visualization itself* is truly web-native end-to-end (Designer remains a Java app; web server is the product's center of gravity).
- Proficy: web is bolted on three ways (mirror client, model-based client, dashboard layer) around a 25+-year-old node architecture; its historian is the crown jewel.
- VTScada: no modularity to bolt on — everything (historian, dialer, web server, version control) is in-process; weakest on modern web/mobile depth and open ecosystem, strongest on integrated simplicity and telemetry.

**Issues/caveats:** Ignition suite/module prices were captured from live pricing pages but the à-la-carte module list beyond the first item was truncated by the fetcher; the "$15,925 Basic / $24,370 Pro / $34,990 Ultimate" package figures and $3,280 entry come from distributor pages mirroring the official list. GE publishes no public US price list — pricing data is from reseller/configuration-guide sources. One third-party blog erroneously labeled Proficy as an Emerson product; GE Vernova ownership was used throughout (per gevernova.com).


---

# Part II — Siemens, Rockwell, AVEVA

# Competitive Analysis — Major SCADA/HMI Vendor Platforms

**Purpose:** In-depth technical and commercial analysis of the three dominant automation-vendor SCADA/HMI ecosystems — Siemens (WinCC family), Rockwell Automation (FactoryTalk), and AVEVA/Schneider Electric (System Platform / InTouch / PI System) — as a competitive reference for a new web-based SCADA product.

> All factual claims cite source URLs inline and are collected in a per-product **Sources** section. Pricing figures are publicly visible list/MSRP or street prices and are indicative only.

---

## 1. SIEMENS — WinCC family

Siemens ships **three distinct SCADA product lines** under the WinCC brand:

| Product | Origin | Target |
|---|---|---|
| **WinCC Classic (V7.x / V8.x)** | Original WinCC (1990s), Windows/COM-era | Plant-level SCADA on Windows, legacy STEP 7 / classic ecosystem |
| **WinCC Unified** | New ground-up HTML5 platform (~2019, SPS launch) | Unified Comfort Panels → PC-based SCADA, TIA Portal engineering |
| **WinCC OA** (SIMATIC WinCC Open Architecture) | ETM PVSS (Austria), acquired by Siemens | Very large, distributed, multi-site infrastructure SCADA (CERN, tunnels, rail, utilities) |

### 1.1 WinCC Classic (V7.x / V8.x)

#### Overview & positioning
Windows-native, full-featured plant SCADA: "an innovative, scalable process visualization system… from a single-user system or a distributed multi-user system with redundant servers." Still actively sold (V8.x is current); positioned for classic Windows-based plants and the STEP 7 ecosystem. Uses Microsoft SQL Server for configuration and archive data. (https://assets.new.siemens.com/siemens/assets/api/uuid:eac06c86-f121-48f8-874f-30355aa6b111/DIFA-I10159-00-7600-SIMATIC-WinnCC-V7.pdf ; https://www.ad.siemens.com.cn/download/documentdetail_4100.html)

#### Architecture & client types
- **Single-user station** → **multi-user client/server** → **distributed multi-server** topologies.
- **UNI-Clients (standard clients, no own project):** up to **64 clients per server**.
- **MULTI-Clients (own project):** up to **50** in a distributed system; each multi-client can read from **up to 18 servers/redundant pairs** simultaneously; max **36 servers = 18 redundant pairs**.
- **WebNavigator clients:** up to **150 web clients** (mixed-system weighting rules apply: WebClient=1, Client=2, remote-configuring client=4; ≤120 points/server without operating function, ≤32 with).
- **WebUX:** HTML5 browser client (device-independent, incl. mobile).
- **DataMonitor:** view-only web client + Excel-based reporting (Webcenter, trends/alarms views, Excel workbooks).
- Server-server communication: a server can pull data from up to ~17–18 other servers.
- WebNavigator server is IIS-based; licensing packs: 1/3/10/30/100 clients + load-balancing option.
- Sources: https://assets.new.siemens.com/siemens/assets/api/uuid:eaaf1232-b641-464b-8849-2280eaf3f424/2021-07-17-simatic-wincc-v75-sp2-architectures-en.pdf ; https://cache.industry.siemens.com/dl/files/224/109736224/att_879803/v1/WinCC_Configuration_en-US_en-US.pdf ; https://cache.industry.siemens.com/dl/files/754/109760754/att_962186/v1/WinCC_BasicOptions_en-US_en-US.pdf

#### Tag & data model
Flat **external (process) tags** bound to driver channels + **internal tags**; structure tags; tag groups. Licensed externally-connected tags = "PowerTags." Configuration via WinCC Configuration Studio; mass-data tools.

#### Historian
- **Tag Logging:** process-value archives into MS SQL Server segments (compressed time-series "archive databases"), configurable cycles, long-term **Central Archive Server** option.
- **User Archives:** recipe/record sets.
- Read-back via WinCC OLE DB provider (special `TAG:R,,,` / `ALARMVIEW:` query syntax), OPC HDA, or Connectivity Pack.
- Separate **Process Historian** product exists for enterprise long-term archiving.

#### Alarms & events
- **Alarm Logging** editor: message classes/types, single/group messages, limit monitoring, alarm control runtime object, hit lists/statistics functions.
- **Event Notifier** option (email/SMS notification), **Basic Process Control** option (PCS 7-style alarm behavior, horn, alarm hiding).
- No dedicated ISA-18.2 rationalization suite in Classic itself (alarm shelving/management-of-change tooling largely lives in PCS 7).

#### Graphics & HMI editor
**Graphics Designer** (classic Windows GDI-style editor): picture windows, faceplates, dynamization (tag connections, dynamic dialog, direct connection, C/VBS actions), libraries, Basic Process Control objects. OLE/ActiveX/.NET control embedding.

#### Scripting
- **ANSI-C scripts:** project functions, standard functions, actions triggered acyclic/cyclic/tag-triggered — run in runtime + global script engine.
- **VBScript:** screen/object dynamization and screen-independent actions.
- **VBA:** engineering-time automation inside Graphics Designer.
- **ODK (Open Development Kit):** C++ API.
- Source: https://cache.industry.siemens.com/dl/files/206/109773206/att_1026568/v1/109773206_WinCC_Scripting_en.pdf

#### Protocols & connectivity
- Native channels: **SIMATIC S7** (S7-300/400/1200/1500, PROFIBUS/Industrial Ethernet), Modbus TCP/IP, OPC channel, PROFIBUS FMS/DP, Allen Bradley (via channel), telecontrol (SINAUT/TM historically).
- **OPC DA server built-in**; OPC DA client channel; **OPC UA WinCC Channel (client)** incl. importing OPC UA nodes as tags/structure types and OPC UA alarms→WinCC messages (V7.4+/V8).
- OPC HDA / A&E / XML-DA server access via **Connectivity Pack**.
- Sources: https://support.industry.siemens.com/dl/files/381/109986381/att_1320207/v2/WinCC_Communication_Part2_en-US_en-US.pdf ; https://www.ad.siemens.com.cn/download/documentdetail_4100.html

#### Security & auth
- Integrated user administration (SIMATIC Logon option for AD/centralized users), area-based authorization levels.
- HTTPS/SSL for web options; WinCC/Audit for traceability.
- Siemens positions TIA/WinCC under IEC 62443-aligned development processes (Siemens has IEC 62443-4-1 certified development; product-level SL claims are made primarily for S7/PCS 7 lines).

#### Reporting & analytics
- WinCC/Report Designer (print jobs, layouts); **DataMonitor** web reports & Excel integration; long-term analytics via Process Historian/DataMonitor.

#### Redundancy & scale
- **WinCC/Redundancy option:** two synchronized servers (hot standby) — archive synchronization after failover, client auto-switch.
- Scale ceiling: 18 redundant server pairs / 36 servers, 64 standard clients/server, 150 web clients.
- Options listed for V7.5 SP2: Server, Redundancy, Archive, UserArchives, WebNavigator, DataMonitor, Connectivity Pack/Station, WebUX, ODK, IndustrialDataBridge, Audit, SES, Calendar Scheduler, Event Notifier, PerformanceMonitor, ProAgent. (https://assets.new.siemens.com/siemens/assets/api/uuid:eaaf1232-b641-464b-8849-2280eaf3f424/2021-07-17-simatic-wincc-v75-sp2-architectures-en.pdf)

#### Licensing & pricing
- RT licenses tiered by **PowerTag count** (128/512/2k/8k/64k/…/unlimited), plus per-option licenses (WebNavigator per concurrent client count, redundancy pair, Audit, etc.). Engineering licenses tied to TIA Portal edition.
- No public list pricing on Siemens Mall (login-gated); typical mid-size systems run in the five-figure EUR range all-in.

#### Standards & certifications
- OPC DA/HDA/A&E (Connectivity Pack), OPC UA client; **WinCC/Audit** for FDA 21 CFR Part 11 / EU GMP Annex 11 compliance (audit trails, electronic signatures, document control, project versioning) — documented in Siemens' ERES compliance response.
- Sources: https://cache.industry.siemens.com/dl/files/112/109977112/att_1306183/v1/InformationSystemAUDITenUS_en-US.pdf ; https://assets.new.siemens.com/siemens/assets/api/uuid:125b9aa8-0ec1-4816-a0f1-e1e5a6bd7cec/ERES-WinCC-V81-en-en-US_original.pdf

---

### 1.2 WinCC Unified

#### Overview & positioning
Completely re-engineered visualization system "based on native Web technologies" — runtime rendering is **HTML5 + SVG + JavaScript**, engineered inside **TIA Portal**. Runs on **SIMATIC HMI Unified Comfort Panels** (Linux-based) and **WinCC Unified PC** (Windows); scalable "from machine-level applications all the way to the SCADA system," with edge/cloud ambitions. Announced at SPS 2019. (https://press.siemens.com/global/en/pressrelease/web-based-visualization-system-sets-new-standards-industrial-operator-control-and)

#### Architecture & client types
- The **runtime IS a web application**: every client is a browser (Chrome preferred; Edge/Firefox/Safari supported; Android/iOS).
- **"Zero-installation" web clients** — tested to **150 concurrent clients** per PC server (one local + remote); "in principle more clients are possible."
- **Collaboration** feature for session sharing between operators.
- SIMATIC **Industrial Thin Clients / WebPanels** (Chromium embedded) act as dedicated web terminals.
- Sources: https://assets.new.siemens.com/siemens/assets/api/uuid:680f6b71-4beb-439b-b631-b11867bd3bc8/simatic-wincc-unified-v17-architectures--techslides-2021-07-07-e.pdf ; https://docs.tia.siemens.cloud/r/en-us/v20/readme-wincc-unified/wincc-unified-pc/remote-access-to-a-unified-device

#### Tag & data model
HMI tags linked to PLC connections; **PowerTags** = tags with PLC connection counted for licensing ("the number of Power Tags used is decisive for licensing" on PC; panels count PowerTags + internal tags against system limit). HMI UDTs; per-user sessions/collaboration state. (https://docs.tia.siemens.cloud/r/en-us/v21/compiling-and-loading-rt-unified/basics-rt-unified/power-tags-rt-unified)

#### Historian
- **SQL-based data archiving** (tag logging) + alarm logging; marketing claim of "virtually unlimited scalability… SQL-based data archiving."
- Historical + online data exposed via **GraphQL** and OPC UA interfaces for IT integration.
- Sources: https://www.siemens.com/global/en/products/automation/simatic-hmi/wincc-unified/view-of-things-web-hmi.html ; https://www.siemens.com/wincc-unified

#### Alarms & events
Integrated alarm system with alarm classes; full scripting access: `HMIRuntime.Alarming.GetActiveAlarms()`, `Alarming.CreateSubscription()`, `AlarmLogging.Read(dateFrom, dateTo, filter, …)` with SQL-style filtering. Alarm logged-data readout to CSV demonstrated in docs. (https://docs.tia.siemens.cloud/r/en-us/v20/wincc-unified-javascript-object-model-rt-unified/hmiruntime-rt-unified/alarmlogging-rt-unified/alarmlogging.read-rt-unified)

#### Graphics & HMI editor
TIA Portal screen editor; web-style dynamization; **custom web controls** (own HTML/JS controls integrated natively into RT); faceplates; screen geometry/script via object model; SVG graphics.

#### Scripting
- **JavaScript (ECMAScript), Google V8 engine**, executed **server-side on Node.js**; object model `HMIRuntime.*` (Tags, Screens, Alarming, TagLogging, FileSystem, DatabaseConnection, Audit…).
- Optimized for mass data (e.g., writing 1000 tags in one pass via special set objects); Promise-based async API; debugging in Chrome.
- **TIA Portal Openness** for automated engineering; **ODK/OpenPipe** and Runtime API (full read/write access to the Unified object model from external apps).
- Sources: https://docs.tia.siemens.cloud/r/en-us/v20/runtime-scripting-rt-unified/basics-rt-unified ; https://cache.industry.siemens.com/dl/files/536/109758536/att_1070913/v1/109758536_Unified_TipsScripting_V31_en.pdf

#### Protocols & connectivity
- Native **S7** driver; native third-party drivers for **Modbus** and **Allen-Bradley**; **OPC UA client + OPC UA DA server** (no separate license for the client); **MQTT** data exchange; **GraphQL** for online + historical data; REST/ODK-style extensibility.
- Sources: https://www.siemens.com/wincc-unified ; architectures PDF above.

#### Security & auth
- HTTPS/SSL + certificate-based web communication, "certificates ensure maximum security against unauthorized access"; user management per role; Unified Certificate Manager; redundant-pair certificate trust requirements.
- **WinCC Unified Audit** option (Basis/Enhanced): audit trail logging, process-data change recording, simple + multiple electronic signatures — GMP/21 CFR Part 11-oriented, available on Unified Comfort Panels and Unified PC.
- Source: https://docs.tia.siemens.cloud/r/en-us/v21/wincc-audit-rt-unified/basics-rt-unified/gmp-compliant-configuration-rt-unified

#### Reporting & analytics
Logged-alarm/tag readout via JS; Excel/report tooling thinner than Classic — relies on open interfaces (GraphQL, OPC UA HDA-style reads) plus partner/reporting options.

#### Redundancy & scale
- **Hot-standby redundant server pair** with continuous sync (logs, alarms, users, project); **health-index**-based active/passive decision (`@SystemHealthIndex`), automatic web-client switchover on failure, ≤3 s time-sync tolerance between partners.
- Scale: "unlimited data points," "unlimited clients" (marketing); practically 150 tested concurrent web clients per PC.
- Sources: https://docs.tia.siemens.cloud/r/en-us/v21/wincc-redundancy-rt-unified/basics-rt-unified/functions-of-redundancy-rt-unified ; https://docs.tia.siemens.cloud/r/en-us/v20/what-s-new-in-tia-portal/what-s-new-in-tia-portal-v20/simatic-wincc/redundancy

#### Licensing & pricing
- **Engineering:** Unified Basic / Comfort / PC 10k / 100k / max ES licenses (a higher ES license also covers classic device targets).
- **Runtime:** WinCC Unified PC Runtime sold in PowerTag packages — **150 / 500 / 1k / 2.5k / 5k / 10k / 50k / 100k+**. Street pricing (UK distributor, V19 IPC packages): **£620 (150 tags) → £7,219 (50k tags)**. Options (Audit, redundancy, clients) licensed separately.
- Sources: https://docs.tia.siemens.cloud/r/en-us/v20/installation/licensing/licensing-step-7-and-wincc ; https://www.parmley-graham.co.uk/simatic-wincc-unified-v19-pc-runtime ; https://mall.industry.siemens.com/mall/EN/US/Catalog/Product/?mlfb=6AV2154-2FB01-8LA0

#### Standards & certifications
OPC UA (client+server), HTTPS/TLS, FDA 21 CFR Part 11 / EU GMP via Audit option; Siemens IEC 62443-aligned SDL.

#### Market position
Siemens ranked **#1 in ABI Research's SCADA/HMI supplier ranking** (implementation + innovation); third-party estimates put Siemens around ~12–21% global SCADA share depending on methodology; dominant in **automotive/discrete manufacturing** and anywhere TIA Portal/S7 is the control standard. (https://www.abiresearch.com/press/siemens-ge-digital-and-rockwell-automation-take-the-lead-in-abi-researchs-scadahmi-software-competitive-ranking ; https://www.controlglobal.com/industry-news/news/33003183/scada-hmi-software-market-to-reach-113-billion-by-2033 ; https://www.verifiedmarketresearch.com/blog/leading-scada-companies/)

---

### 1.3 SIMATIC WinCC OA (Open Architecture, formerly ETM PVSS)

#### Overview & positioning
Object-oriented, manager-process-based SCADA for **very large, geographically distributed, mission-critical** systems — tunnels, rail, power distribution, oil & gas pipelines, and notably **science**: ~**800 mission-critical WinCC OA systems at CERN**; each LHC experiment (ATLAS, CMS, LHCb, ALICE) runs >100 systems handling **millions of signals**. ALICE DCS alone: 100 WinCC OA systems, ~2,700 managers, ~170 servers, ~200,000 OPC items. Cross-platform Windows/Linux. (https://indico.cern.ch/event/1587839/contributions/6917266/attachments/3230433/5760156/NextGenerationArchiver2026.pdf ; https://proceedings.jacow.org/ICALEPCS2013/talks/frcoaab07_talk.pdf)

#### Architecture & client types
- **Everything is a "manager" (separate OS process)** communicating over a neutral TCP/IP protocol; managers can run distributed across machines/OSes and be started/stopped online:
  - **Event Manager (EV):** single per-system central hub — holds the in-memory process image of all process variables, distributes data to all other managers, runs alert handling.
  - **Data Manager (DM):** config database + historical data link.
  - **Drivers (D), CTRL managers, UI managers, API, Dist manager** — multiple instances allowed.
- **Dist Manager** links autonomous WinCC OA systems into a **distributed system** — each system keeps a unique name/number; remote datapoints are accessed live (NOT copied); hierarchical and same-level topologies; sub-systems may each be redundant or not.
- Client types: **VISION** native UI (Windows/Linux), **Desktop UI** remote full client, **ULC UX** HTML5 browser client (reuses existing panels incl. CTRL scripts; SSL; SSO; ~35 connections/web server recommended, multi-webserver configs for 70+), **Mobile UI** (iOS/Android), **Dashboard** (widget web app), Siemens ITC thin clients, PARA engineering UI.
- Sources: https://www.winccoa.com/documentation/WinCCOA/latest/en_US/GettingStarted/GettingStarted-06.html ; https://www.winccoa.com/documentation/WinCCOA/latest/en_US/Distributed_systems/Distributed_systems-01.html ; https://www.winccoa.com/documentation/WinCCOA/latest/en_US/ULC_UX/ulc_ux_basics.html ; https://www.winccoa.com/documentation/WinCCOA/latest/en_US/_resources/toc/user_interfaces.html

#### Tag & data model
- **Datapoint Types (DPT) → Datapoints (DP) → Datapoint Elements (DPE)** — a typed object tree edited via the **PARA** module; DPEs carry *configs* (peripheral address `_address`, alert handling `_alert_hdl`, archiving `_archive`, etc.).
- Internal DPEs unlimited; external DPEs (with periphery address config) count as **PowerTags (I/O)** for licensing.
- Distributed-system licensing math: hierarchical systems sum subordinate systems' PowerTags; same-level distributed systems each license the sum of all connected systems.

#### Historian
- Pluggable archivers: **RAIMA/HDB** standard archive, **RDB** (Oracle — ~250 CERN systems still on it), **NextGen Archiver (NGA)** with TimescaleDB backend (CERN piloted, production 2027). Value + alert archives; queries via Data Manager/dpGetPeriod.
- Source: https://indico.cern.ch/event/1587839/contributions/6917266/attachments/3230433/5760156/NextGenerationArchiver2026.pdf

#### Alarms & events
Alert handling is a core EV function: alert classes, multi-instance alert handling per DPE (`_alert_hdl` configs), alert queries across distributed systems; alarm states survive redundancy sync.

#### Graphics & HMI editor
Panel-based editor (`.pnl` files), panel topology/nesting, GEDI editor, symbol/catalog management; same panels render in VISION UI and ULC UX web client; Dashboard provides widget-based web visualization (Lit Web Components, Siemens IX design system, WebSocket/`OaRxJsApi` real-time binding).

#### Scripting
- **CTRL:** ANSI-C-like interpreted language with multithreading — event scripts on graphics, standalone `main()` runtime scripts in CTRL managers (`dpConnect`, `dpSet`, `dpQuery`…); **CTRL++** OO extensions; ASCII `.ctl` libraries.
- **API:** C++ manager API.
- **Manager Service API (MSA):** polyglot service layer (vRPC now; gRPC/GraphQL roadmap) — services in **C++, C#, TypeScript/JavaScript, CTRL**.
- **JavaScript Manager for Node.js**; HTTP server add-on; REST Reporting API; COM; XML-RPC; Prometheus interface; XMPP push.
- Sources: https://www.winccoa.com/documentation/WinCCOA/latest/en_US/GettingStarted/GettingStarted-78.html ; https://www.winccoa.com/documentation/WinCCOA/latest/en_US/manager_service_api/topics/manager_service_api_basics_2.html ; https://www.winccoa.com/documentation/WinCCOA/latest/en_US/Dashboard/topics/Dashboard_Basics.html

#### Protocols & connectivity
Very broad native driver set: serial (RK512, 3964R…), PROFIBUS DP/FMS, **Modbus TCP**, **S7 / S7 Plus** industrial Ethernet, **EtherNet/IP**, telecontrol (**IEC 60870-5-101/-104**, DNP3, SSI), BACnet (licensed object packages), SNMP, plus **OPC DA/AE/HDA and OPC UA client & server** — OPC servers expose remote systems' data via **CNS views** in distributed deployments; MQTT and REST interfaces; custom drivers implementable via API (CERN maintains its own, e.g. a RAMS/S7-200 driver on GitHub).
- Sources: https://www.winccoa.com/documentation/WinCCOA/latest/en_US/GettingStarted/GettingStarted-79.html ; https://www.winccoa.com/documentation/WinCCOA/latest/en_US/Treiber_OPCServer/opc_s_dist.html ; https://github.com/cern-hse-computing/WCCOARAMS7200

#### Security & auth
SSL/TLS encrypted manager and web communication, SSO for ULC UX, user management UI; Siemens hardening guides; widely deployed in critical infrastructure (utilities, transport) with corresponding security guidance.

#### Reporting & analytics
Built-in reporting (REST Reporting API, report manager), Dashboard analytics widgets, trend objects; heavy reliance on exports/APIs for BI integration.

#### Redundancy & scale
- **Hot-standby server pairs** (redundant EV on 2 hosts; passive discards writes; `fwdDp` config to forward DPEs from passive scripts; `-connectToRedundantHosts` option).
- Distributed systems scale horizontally essentially without hard ceiling — the largest real-world proof is CERN (~800 systems; >100 systems/experiment; millions of signals).
- Sources: https://www.winccoa.com/forum-archive/viewtopic.php@t=4291.html ; https://www.winccoa.com/documentation/WinCCOA/latest/en_US/GettingStarted/GettingStarted-09.html

#### Licensing & pricing
- **Server Basic license** (Event Manager + alerts, extended trend, local archiving, S7/S7+ driver with 8 connections, OPC UA client, OPC client/server) **+ PowerTag (I/O) packages sized to external DPEs**; separate feature licenses for archives (NGA/RDB), CTRL managers, redundancy, drivers (e.g., IEC 60870, BACnet objects), distribution, UI Client vs UI Light clients.
- Perpetual project licenses; low-fee annual development licenses; OEM lump-sum deals. **No public price list** — quote-based; "as expensive or cheap as other SCADA products in typical SCADA applications."
- Sources: https://www.winccoa.com/documentation/WinCCOA/latest/en_US/licensing/topics/licensing_basics.html ; https://www.winccoa.com/knowledge-base/detail/how-is-wincc-oa-licensed.html ; https://www.winccoa.com/documentation/WinCCOA/latest/en_US/Installation/WinCCOA_licensing/licensing_options.html ; https://www.winccoa.com/documentation/WinCCOA/latest/en_US/licensing/topics/licensing_licenses_overview_ios.html

#### Standards & certifications
OPC DA/AE/HDA/UA certified components; IEC 60870/61850-family telecontrol standards; deployed at regulated/critical sites (CERN, rail, power). Full ISO-cert list at winccoa.com docs.

---

## 2. ROCKWELL AUTOMATION — FactoryTalk

### 2.1 FactoryTalk View SE / ME + ViewPoint

#### Overview & positioning
The mainstream HMI/SCADA line tightly integrated with **Studio 5000 Logix** controllers — strongest in **North America** (VMR cites ~34% NA share; ABI ranks Rockwell #3 overall SCADA/HMI). **Site Edition (SE)** = plant/distributed SCADA; **Machine Edition (ME)** = machine-level HMI on **PanelView Plus** terminals or ME Station on PCs. **PlantPAx** DCS is built on this stack (Logix + View SE + Historian + Batch) and is certified to **IEC 62443-3-3 SL1**. (https://www.verifiedmarketresearch.com/blog/leading-scada-companies/ ; https://www.abiresearch.com/press/siemens-ge-digital-and-rockwell-automation-take-the-lead-in-abi-researchs-scadahmi-software-competitive-ranking ; https://compatibility.rockwellautomation.com/GeneratedReleaseNote.aspx?o=&pdf=0&v1=59645&v2=59645)

#### Architecture & client types
- **FactoryTalk Services Platform** backbone: **FactoryTalk Directory** (central lookup service — "loosely comparable to a Windows Domain Controller"; Local FTD for standalone, **Network FTD** for distributed; one FTD per node, no cross-FTD federation), **FactoryTalk Security**, **Diagnostics**, **Live Data**, Administration Console.
- View SE application types: **Network Distributed** (HMI server(s) + data server(s) + clients across machines, organized in *areas* — one HMI server per area), **Network Station**, **Local Station** (single PC).
- Clients: **SE Client** (rich runtime), **SE Station**, **FactoryTalk ViewPoint** (web — see below), mobile HMI apps (iOS/Android), **ThinManager**-delivered RDS sessions.
- Sources: https://www.rockwellautomation.com/en-us/docs/factorytalk-services-platform/6-60/factorytalk-services-platform-help-ditamap/-ftsp--help/-ft--systems/-ftdir--types.html ; https://www.rockwellautomation.com/en-us/docs/factorytalk-view/16-00-00/se-help-ditamap/factorytalk-view-site-edition-help/factorytalk-view-se-applications/create-a-network-distributed-app.html ; https://support.rockwellautomation.com/cc/okcsFattachCustom/get/32549_18

**FactoryTalk ViewPoint:** add-on that publishes View SE/ME displays as **fully animated, read-and-write** web HMI — "no additional Rockwell software required" on the browser side. For ME, the web server is the **PanelView Plus terminal itself**; for SE, a dedicated ViewPoint server. Since View v13, **unlimited ViewPoint web clients are bundled** into every SE server/station license. (https://www.rockwellautomation.com/en-us/docs/factorytalk-viewpoint/16-00-00/ftvpme-help-ditamap/ftvwpt-help-me.html ; https://literature.rockwellautomation.com/idc/groups/literature/documents/qr/ftalk-qr003_-en-p.pdf)

**ThinManager:** centralized thin-client/RDS content-delivery platform — manages terminals ("ThinManager Ready/Compatible"), users (AD sync), per-role/location content, multi-factor auth incl. badge sign-on passed through to View SE; full server failover/redundancy; terminals replaceable "in under 2 minutes"; new TMC mobile apps extend delivery to tablets/phones. (https://www.rockwellautomation.com/en-us/products/software/factorytalk/operationsuite/thinmanager.html ; https://thinmanager.com/media/datasheets/RA-v14-2024/ThinManager-Full-Profile-v141_TM-PP001I-EN-P.pdf)

#### Tag & data model
- **No HMI tag database required**: HMI references **Logix controller tags directly** via FactoryTalk Live Data/FactoryTalk Linx — "define tags once in the Logix controller, then access them throughout your system"; controller-resident extended tag properties (incl. translated text) surface in the HMI. Optional HMI tags for local/client-specific data.
- Source: https://literature.rockwellautomation.com/idc/groups/literature/documents/pp/ftalk-pp013_-en-p.pdf

#### Historian
- Built-in lightweight **data log models** in View SE.
- **FactoryTalk Historian SE** — an OEM of the **AVEVA/OSIsoft PI System** ("builds off industry-leading technology licensed from OSIsoft, now part of AVEVA"): PI Data Archive + **Asset Framework, Event Frames, Analysis engine, Notifications**, bundled **FactoryTalk Live Data Interface + FactoryTalk Linx** for RA controllers; 3rd-party via OPC UA/DA servers; **Advanced Server add-on** adds OPC DA/HDA servers, OLE DB/ODBC/JDBC, Web API, ACE. Client tooling incl. PI Vision web client. Also Historian ME for machine-level.
- Sources: https://www.aveva.com/en/about/partners/embedded-solutions/industrial-automation/aveva-and-rockwell-automation/ ; https://literature.rockwellautomation.com/idc/groups/literature/documents/sp/hist-sp001_-en-p.pdf

#### Alarms & events
- **FactoryTalk Alarms & Events** service: **device-based** (Logix alarm instructions in the controller — alarm state computed in controller, no polling; Logix tag-based alarms on 5580-class CPUs) and **server tag-based** (A&E servers monitoring tags via data servers/OPC, incl. 3rd-party controllers and HMI tags). Redundant A&E server support; **OPC UA alarm monitoring** since v6.30.
- Explicit **ISA-18.2 alignment**: alarm groups, shelving/suppression, filtering/annunciation objects, and alarm-analysis white papers/product (FactoryTalk VantagePoint standard alarm reports).
- Sources: https://literature.rockwellautomation.com/idc/groups/literature/documents/rm/ftae-rm001_-en-e.pdf ; https://literature.rockwellautomation.com/idc/groups/literature/documents/wp/proces-wp014_-en-p.pdf

#### Graphics & HMI editor
**FactoryTalk View Studio Enterprise** (also builds ME apps): displays, global objects, Symbol Factory library, **Rockwell Process Object Library faceplates** (PlantPAx), ISA-101-style objects (v13+), TrendPro/RecipePro Plus, data grid, XY plot, **web-browser object**, .SVG support, multi-monitor framework.

#### Scripting
- **VBA display code** on SE Client via the SE Client object model (manipulate graphics, read/write tags, tag-change notifications, custom forms/validation, ActiveX integration).
- v13+ adds **server-side scripts** (HMI tag access), client-specific tags, native .NET control object; commands/macros for navigation and writes.
- Sources: https://www.rockwellautomation.com/en-us/docs/factorytalk-view/16-00-00/se-help-ditamap/ftvse-client-object-model.html ; https://res.cloudinary.com/mcrey/image/upload/v1663273829/trc/documents/User%20Group/Sep-HMI_Guide-0922_pda6wu.pdf

#### Protocols & connectivity
- Native optimized path to Logix via **EtherNet/IP / FactoryTalk Linx** (Live Data); third-party via **OPC DA/UA data servers**; OPC UA A&E client; FactoryTalk Linx Gateway for programmatic access.
- Control-level security: **CIP Security** (device authentication, integrity, optional encryption) recommended inside PlantPAx/CPwE architectures.

#### Security & auth
- FactoryTalk Security (centralized, AD-integrated), product/area-level permissions; ThinManager auth passthrough incl. badge readers.
- **IEC 62443:** Rockwell SDL certified to 62443-4-1; **PlantPAx system certified to IEC 62443-3-3 SL1**; CPwE defense-in-depth guides aligned to IEC 62443 + NIST 800-82.
- Sources: https://www.rockwellautomation.com/en-us/trust-center/product-security-certifications.html ; https://literature.rockwellautomation.com/idc/groups/literature/documents/sg/proces-sg001_-en-p.pdf ; https://literature.rockwellautomation.com/idc/groups/literature/documents/td/enet-td022_-en-p.pdf

#### Reporting & analytics
Historian client tools (trends, PI Vision web dashboards, DataLink Excel), FactoryTalk VantagePoint (alarm/KPI reports), FactoryTalk Metrics/ProductionCentre MES line.

#### Redundancy & scale
- Redundant **HMI server pairs** (primary/secondary; manual display replication + automatic alarm replication), redundant Live Data, A&E and OPC servers; dedicated cheaper **redundant-server license** since v11/12.
- Scale: multiple areas/HMI servers per application; classic deployments commonly 10–50+ clients/server.
- Sources: https://support.rockwellautomation.com/cc/okcsFattachCustom/get/32549_20 ; https://support.rockwellautomation.com/app/answers/answer_view/a_id/1127832

#### Licensing & pricing
- **Since v13 (2022): simplified bundles** — SE server bundle = HMI server + **5/10/25 clients + unlimited displays + unlimited ViewPoint web clients**; SE Station (unlimited) or Station Lite (25 displays); add-ons: Studio, extra/read-only clients, redundant server. Subscription or perpetual+maintenance. ME Station has volume pricing.
- Source: https://literature.rockwellautomation.com/idc/groups/literature/documents/qr/ftalk-qr003_-en-p.pdf ; https://www.rockwellautomation.com/en-us/company/news/press-releases/Rockwell-Automation-Provides-Lowered-Cost-HMI-Software-with-New-Features.html

#### Standards & certifications
IEC 62443-4-1 (SDL), PlantPAx IEC 62443-3-3 SL1, OPC DA/UA/A&E, CIP Security, ISA-18.2-aligned alarming, ISA-101-style graphics library, FDA-relevant features via electronic signatures in View/Historian + PlantPAx pharma track record.

---

### 2.2 FactoryTalk Optix

#### Overview & positioning
Rockwell's **new-generation, cloud-native HMI/visualization platform** (technology rooted in the ASEM acquisition) — positioned for IIoT/edge, OEMs, and as the long-term successor trajectory alongside View SE. Runs on **OptixPanel** terminals, industrial PCs, VMs — **Windows AND Linux**. Object-oriented, OPC-UA-native. (https://www.rockwellautomation.com/en-us/products/software/factorytalk/optix.html ; https://www.rockwellautomation.com/en-us/solutions/hmi/optix.html)

#### Architecture & client types
- Deployments: dedicated **Panel** (OptixPanel), **Station** (PC), and **HTML5 Web Clients** ("empowering operators to view an HMI application on any browser"; can run headless serving only web clients).
- **FactoryTalk Optix Studio Standard:** free local desktop IDE. **Studio Pro:** subscription, **browser-based editor** — cloud code repositories (Git), cloud-hosted version control, multi-user collaboration, remote deployment via FactoryTalk Remote Access (VPN).
- **3-node high-availability runtime cluster** keeps apps running through node failures.
- Sources: https://www.rockwellautomation.com/en-us/docs/factorytalk-optix/current/technical-content/optix-at001/web_optix-at001-ditamap/factorytalk-optix-overview/ftoptix-studio/ftoptix-studio-options.html ; https://www.rockwellautomation.com/en-us/docs/factorytalk-optix/current/contents-ditamap/getting-started/overview/system-features.html

#### Tag & data model
"Built entirely upon **OPC UA specifications** and natively integrates the OPC UA information model" — the runtime address space IS an OPC UA server; apps are object-oriented types/instances with reusable libraries; can auto-generate projects via scripting at design and runtime.

#### Historian
Embedded **SQLite** datalogging, **ODBC** (MySQL/MS SQL Server), **InfluxDB** (embedded + external), store-and-forward to larger databases; event streaming to MQTT brokers. No built-in enterprise historian — pairs with Historian SE/PI or cloud.

#### Alarms & events
Object-model alarms (alarms defined on types), alarm viewer controls, event data streamed to MQTT/cloud; less ISA-18.2 tooling than View SE today.

#### Graphics & HMI editor
Optix Studio: modern object-oriented screen editor, libraries/reusable types, style sheets, localization, recipes, datalogging; multi-user cloud collaboration w/ change tracking ("who did what and when").

#### Scripting
- **C# scripting** ("NetLogic") — full .NET, incl. browsing/importing Logix controller tags programmatically at design time via the RA EtherNet/IP C# API.

#### Protocols & connectivity
- **Native OPC UA client+server** (any OPC UA peer).
- **RA EtherNet/IP driver** (ControlLogix/CompactLogix/Micro800/MicroLogix/SLC), PowerFlex drives over EtherNet/IP.
- 3rd-party drivers: **Modbus, Siemens S7 TCP & S7 TIA PROFINET, Omron EtherNet/IP & FINS, Mitsubishi MELSEC FX3U / Q/FX5U, Beckhoff TwinCAT, CODESYS, custom serial**.
- **MQTT client (pub/sub) + embedded MQTT broker** (Azure IoT Hub, Mosquitto…); complex datatypes over MQTT; REST/Web APIs; secure web server.
- OptixEdge variant adds Docker engine + Portainer for containerized edge apps.
- Sources: https://www.rockwellautomation.com/en-us/docs/factorytalk-optix/current/technical-content/optix-at001/web_optix-at001-ditamap/reference-architectures-overview/edge-connectivity.html ; https://ultech-engineering.com/wp-content/uploads/2024/11/FactoryTalk-Optix-Reference-Architectures-200324.pdf ; https://cdn-m4m.chd01.com/pro/uploads/account_711/723817/OptixEdge_Reference_Architectures.pdf

#### Security & auth
Secure web server, user/role management, certificate-secured OPC UA & MQTT-TLS; cloud entitlement/allow-list model (`*.cloud.rockwellautomation.com`); sits under the FactoryTalk Hub org model.

#### Reporting & analytics
Via embedded DBs, MQTT event streams, FactoryTalk Hub/Insights cloud services; no dedicated report engine — use FactoryTalk Historian/3rd-party.

#### Redundancy & scale
3-node HA runtime cluster; distributed station+web-client topologies; edge→cloud reference architectures documented.

#### Licensing & pricing
- **Runtime entitlements = feature-token packages** — "any combination of features… total feature tokens used defines the runtime license size"; sized via Runtime Sizing Calculator; perpetual or subscription; unlimited-station entitlements exist; unlicensed = 2-hour demo.
- **Studio Standard free**; Studio Pro subscription-only (user entitlement, org-allocated via FactoryTalk Hub). Marketing: "pay only for the features you use."
- Sources: https://www.rockwellautomation.com/en-us/docs/factorytalk-optix/current/technical-content/optix-at001/web_optix-at001-ditamap/allocate-activate-ftoptix-runtime.html ; https://www.rockwellautomation.com/en-us/docs/factorytalk-optix/technical-content/optix-at001/factorytalk-optix-solutions-application-technique-/factorytalk-optix-overview/runtime-licenses.html

#### Standards & certifications
OPC UA native (information-model integrated); MQTT/Sparkplug-style IIoT; inherits FactoryTalk/Rockwell IEC 62443 program at platform level.

---

## 3. AVEVA (Schneider Electric) — System Platform / InTouch / Edge / PI System

### 3.1 AVEVA System Platform (formerly Wonderware System Platform / ArchestrA Application Server)

#### Overview & positioning
Flagship distributed SCADA/MES platform built on **ArchestrA**, the industry-standard object-oriented automation framework — huge installed base in **process industries, oil & gas, water/wastewater, marine, F&B**. Pitched as "the world's only responsive, scalable solution for supervisory, advanced SCADA, MES and IIoT" — claims up to **80% engineering-effort reduction** via templates/objects and abnormal-situation resolution **5× faster** than traditional HMIs. (https://www.aveva.com/content/dam/aveva/documents/perspectives/datasheets/Datasheet_SystemPlatform.pdf)

#### Architecture & client types
- **Galaxy** = one logical namespace/DB for the whole application: centralized **Galaxy Repository (GR)** stores all objects/config; engineering via **ArchestrA IDE** / Development Studio.
- **Runtime nodes:** WinPlatform (system object representing a host) → hosts **AppEngines** (real-time execution engines) → host AutomationObjects + DIObjects. Deployment = model/derive/deploy from IDE; objects can migrate between engines.
- **Client options:** **OMI (Operations Management Interface)** ViewApps — responsive layout/pane framework, context-aware navigation; **InTouch for System Platform** (managed apps); **InTouch Web Client** (HTML5 browser incl. mobile — built-in web server, "without RDP or IIS"); **InTouch Access Anywhere** (HTML5-over-RDS); Historian Client.
- Sources: https://docs.aveva.com/bundle/system-platform/page/661411.html ; https://gunnerabuzaki2.github.io/aveva-application-server/lessons/L01-System-Platform-Galaxy.html ; https://docs.aveva.com/bundle/sp-omi-awc-2023r2/page/488382.html

#### Tag & data model
- **AutomationObjects** = typed templates → instances with attributes (references, arrays, richer types than InTouch tags). Object classes: **Application objects** (assets: pumps, valves, PID loops…), **Device Integration objects (DIObjects:** PLCClient, DDESuiteLinkClient, InTouchProxy, OIGW…), **System objects** (WinPlatform, AppEngine, **Area** = alarm concentrator mapping to physical plant).
- Attributes carry extensions: I/O mapping, **alarm extension, history extension, security**; single global namespace `object.attribute`; template inheritance + derivation view; check-in/out versioning per object.
- Sources: https://docs.aveva.com/bundle/system-platform/page/661411.html ; https://learningacademy.aveva.com/courses/aveva-system-platform-types-of-automation-objects-1

#### Historian
- **AVEVA Historian** (ex-Wonderware): MS SQL Server shell + proprietary high-speed time-series storage/compression; **tiered replication** — tier-1 plant historians replicate to tier-2 corporate (simple replication full-resolution + **analog/state summary replication**), multi-tier chains to **AVEVA Insight/CONNECT** cloud; store-and-forward; redundant historian failover with automatic client switchback.
- Objects historize via history extension; integrated Historian Client (trend/query/report) and OMI historical playback.
- Sources: https://www.aveva.com/content/dam/aveva/documents/datasheets/Datasheet_AVEVA_Historian_04-20.pdf.coredownload.inline.pdf ; https://docs.aveva.com/bundle/sp-historian/page/72387.html ; https://cdn.logic-control.com/docs/aveva/historian/HistorianConcepts.pdf

#### Alarms & events
Alarm extensions on attributes; **Area objects aggregate alarms** plant-hierarchically; distributed alarm providers/consumer model; alarm states (incl. Ack/RTN/Silenced/Disabled) **synchronized across redundant engine pairs**; suppression API; alarm DB logger to SQL; OMI alarm clients. ISA-18.2-style features (shelving, suppression, grouping) plus guidance in deployment docs.

#### Graphics & HMI editor
- **Industrial Graphic Editor**: element-based graphics stored in a shared **Visualization folder library**, in object **templates** (edit once → cascade to all instances), or instances; **Situational Awareness Library** (ISA-101 style, "up to 70% design-time saving"); symbol wizards; embed in OMI panes or InTouch windows.
- Sources: https://docs.aveva.com/bundle/sp-omi/page/258414.html ; https://www.aveva.com/en/solutions/operations/situational-awareness/

#### Scripting
- **QuickScript .NET** on object attributes — execution types: Startup/OnScan/**Execute**/OffScan/Shutdown/Deploy; .NET function support, script-function libraries, color-coded editor w/ autocomplete.
- **ArchestrA symbol scripts** (predefined/named/action scripts, `ShowGraphic()` navigation) in graphics; InTouch QuickScript/QuickFunctions legacy; client-side OMI script behavior documented.
- Sources: https://cdn.logic-control.com/docs/aveva/hmi-scada/application-server/Scripting.pdf ; https://community.aveva.com/heroes-hq/m/aveva-intouch-hmi---beg---symbols/21994

#### Protocols & connectivity
- **AVEVA Communication Drivers** (ex-OI Servers, "Communication Drivers Pack" — single installer, activated licensing): **ABCIP** (Logix + legacy PLC-5/SLC), **SIDIRECT** (S7-300/400/1200/1500), **MBTCP** (Modbus TCP/Modicon), **DNP3, IEC 60870, BACnet/IP, CODESYS, OMRON FINS**, telecontrol family; **GATEWAY/Device Integration Gateway** bridges SuiteLink/OPC DA/OPC UA/InTouch data sources and acts as **OPC UA client**; **MQTT driver** (JSON payloads + **Sparkplug B** publish/subscribe, Azure IoT Hub & AWS IoT Core).
- **OPC UA server** exposure (InTouch can itself be an OPC UA server); SuiteLink internal transport; unlimited independent driver instances per node; side-by-side version upgrades.
- Sources: https://www.aveva.com/en/products/communication-drivers/ ; https://www.ace-iss.com/aveva-communication-drivers ; https://industrial-software.com/wp-content/uploads/Communication_Drivers/2023_r2/Readme_MQTT.html ; https://cdn.logic-control.com/docs/aveva/communications-pack/OICore.pdf

#### Security & auth
- Galaxy-level object security model (item/attribute-level), AD/SSO (**single sign-on via CONNECT** or 3rd-party IdP), OCMC role groups.
- **Certificate-based TLS 1.2 node-to-node encryption** for all internal comms ("most secure industrial platform with node-to-node TLS encryption" claim); security layers can't be bypassed by public interfaces; DMZ patterns for OPC/OI gateways; deployment guide covers DCOM/domain hardening and **21 CFR Part 11** architecture.
- Sources: https://cdn.mediavalet.com/eunl/content/vV_0HgBgEkCurusErDOJUg/6_5PkqLZAUORlNhC_7q3Ng/Original/Cybersecurity%20best%20practices%20with%20AVEVA%20%20System%20Platform.pdf ; https://cdn.mediavalet.com/eunl/content/9zu3PNn1IEeRHy4LQ1h2DQ/2riUqUSTvEWxiGaqqCdmUA/Original/Insights%20from%20the%20updated%20AVEVA%20System%20Platform%20deployment%20guide.pdf

#### Reporting & analytics
Historian Client reports; **AVEVA Reports for Operations** (built on Dream Report — no-code drag-and-drop, scheduling/distribution, dashboards, **Python + LUA** scripting, SSO; 100+ connectors incl. System Platform, InTouch, Plant SCADA/Citect, Edge, GeoSCADA, **PI System**; life-sciences/SPC/batch modules included, MES module extra). (https://www.aveva.com/en/products/reports-for-operations/ ; https://www.aveva.com/en/perspectives/blog/aveva-introduces-an-operations-control-reporting-software/)

#### Redundancy & scale
- **Redundant AppEngine pairs** (Active/Standby over a dedicated Redundancy Message Channel): heartbeat (1 s default), checkpoint sync of calculations/values/**alarm states**/store-forward history; failover on missed heartbeats (tuned by I/O size — e.g., 40k I/O ≈ 3.5-min failover QA figure); handles planned (patch) + unplanned downtime.
- **Native "unique centralized deployment"**, distributed Galaxies scale to very large multi-node plants; "unlimited IO, unlimited clients" positioning.
- Sources: https://docs.aveva.com/bundle/sp-appserver/page/249029.html ; https://cdn.logic-control.com/docs/aveva/Tech%20Notes/Tech%20Note%20401%20-%20Fine-Tuning%20AppEngine%20Redundancy%20Settings.pdf

#### Licensing & pricing
- Strategic model: **AVEVA Operations Control** — a single **subscription** covering the whole ops portfolio (System Platform, InTouch, Edge, Plant SCADA, Historian, Reports, drivers, CONNECT cloud) with **unlimited tags, I/O, servers and clients**; includes CONNECT entitlements (e.g., 200 daily data streams, 5 monthly visualization MAUs); Flex-credit subscription program underneath.
- Legacy: per-tag/IO server licenses + client licenses still exist for perpetual buyers.
- Sources: https://www.aveva.com/en/products/aveva-operations-control/ ; https://www.aveva.com/en/solutions/flex-subscription/

#### Standards & certifications
OPC DA/UA, MQTT/Sparkplug B, ISA-101 situational-awareness graphics, 21 CFR Part 11 deployment guidance, TLS 1.2/62443-aligned hardening docs; part of Schneider Electric's certified development practices.

---

### 3.2 AVEVA InTouch HMI (standalone) & AVEVA Edge (ex-InduSoft)

#### Overview & positioning
- **InTouch HMI**: the classic standalone tag-based HMI ("the world's most popular HMI") — usable standalone via InTouch Application Manager (WindowMaker/WindowViewer) or as managed/visualization layer inside System Platform.
- **AVEVA Edge** (formerly InduSoft Web Studio): lightweight "develop once, deploy anywhere" HMI/SCADA/IoT-edge for OEMs — runtimes: **Edge SCADA** (Windows), **Embedded HMI** (Win Embedded Std), **Compact HMI** (WinCE), **IoT View** (Linux, incl. Raspberry Pi). (https://www.aveva.com/en/products/edge/ ; https://industrial-software.com/wp-content/uploads/InTouch-Edge-2020-ReadMe.html)

#### Architecture & client types
- InTouch: standalone tag DB apps, managed Galaxy apps, or **InTouch Web Client** — "view AVEVA InTouch HMI applications on **any HTML5 web browser**… without RDP or IIS" (built-in web server); mobile supported; Access Anywhere for full-fidelity remote desktop.
- Edge: HTML5 web publishing + **Mobile Access** thin clients; same project deploys across all runtimes.
- Sources: https://docs.aveva.com/bundle/sp-omi-awc-2023r2/page/488382.html ; https://docs.aveva.com/bundle/intouch-hmi-2023/page/321228.html

#### Tag & data model
InTouch: flat **tagname dictionary** (memory/I/O tags, supertags in 2023), alarm groups. Edge: tag database with classes/templates, project DB.

#### Historian
InTouch local logging + direct AVEVA Historian integration (Historian tags bundled per license tier — see pricing). Edge: built-in trends/history, SQL support.

#### Alarms & events
InTouch distributed alarm system (groups, priorities, suppression API, alarm queries, AlarmViewer controls); Edge alarm subsystem incl. remote ack.

#### Graphics & HMI editor
WindowMaker classic editor + Industrial/ArchestrA graphics embedding + Situational Awareness library; Edge Studio IDE (250+ driver-aware project dev).

#### Scripting
InTouch QuickScript/QuickFunctions + ArchestrA symbol scripts + .NET interop in managed apps; Edge has VBScript-based scripting + .NET/DB functions.

#### Protocols & connectivity
Same **Communication Drivers Pack** as System Platform (OPC UA/DA, MQTT/Sparkplug, DNP3, IEC 60870, Modbus, ABCIP, SIDirect…); InTouch can act as **OPC UA server**; Edge: 250+ drivers incl. legacy serial, OPC UA/DA, MQTT Sparkplug B publisher.

#### Security & auth
OS/AD-integrated security, e-signatures, runtime user levels; Edge adds project-level encryption options.

#### Reporting & analytics
AVEVA Reports for Operations connectors for both; Edge built-in reports.

#### Redundancy & scale
InTouch: redundant nodes/Network Application Development; terminal-services scaling. Edge: lightweight redundancy options for embedded.

#### Licensing & pricing (public MSRP — rare transparency)
| Package | Price (USD, MSRP) | Includes |
|---|---|---|
| InTouch Workstation | **$1,850** | 1,000 tags, 1 workstation, 1 HTML5 web client |
| InTouch Unlimited **Standard** | **$12,360** | Unlimited tags/clients, 500 historian tags, 1 RDS session |
| InTouch Unlimited **Professional** | **$20,600** | Unlimited tags/clients, 5,000 historian tags, Reports incl. |
| AVEVA Operations Control | subscription only | Unlimited everything + CONNECT SaaS entitlements |
- Edge: simple per-runtime licenses, all main features included in every license.
- Source: https://www.aveva.com/en/info/intouch-hmi-pricing/

---

### 3.3 AVEVA PI System (ex-OSIsoft)

#### Overview & positioning
The de-facto **enterprise real-time data infrastructure** in process industries (oil & gas, power, pharma, mining) — often deployed *underneath/alongside* competitor SCADA (e.g., FactoryTalk Historian SE is PI under the hood). Positioned as the "single trusted source of truth" for operations data. (https://www.aveva.com/en/products/aveva-pi-system/)

#### Architecture & client types
- **PI Server = PI Data Archive** (high-volume time-series store) + **Asset Framework (AF)** — asset/context model, event frames, analyses, notifications.
- **PI Vision** — web-based dashboards/trends/gauges/XY (desktop + mobile); **PI DataLink** (Excel); PI ProcessBook (legacy→Vision); **PI Integrator** (analysis-ready data publishing to BI/cloud).
- **PI Web API / PI SDK / AF SDK / ODBC-JDBC-SQL providers** — full developer stack.
- **PI Data Infrastructure** = hybrid offering: on-prem PI + **CONNECT data services** (cloud-native SaaS historian/data hub) via **PI to CONNECT Agent** (daily tag-count reporting for licensing); edge collection via Adapters.
- Sources: https://www.aveva.com/en/products/aveva-pi-system-developer-technologies/ ; https://www.aveva.com/content/dam/aveva/documents/legal/service-documents/AVEVA-PI-Data-Infrastructure.pdf

#### Tag & data model
**PI points (tags)** time-series streams + **AF element/attribute hierarchy** with templates, UOMs, event frames — the industry reference model for data contextualization.

#### Historian
PI IS the historian: decades-scale storage, sub-second retrieval, HA PI Data Archive collectives, buffering interfaces; multi-site aggregation through CONNECT Data Hub.

#### Alarms & events
Event Frames + Notifications (alarm-ish state tracking, alerts); not an operator alarm system — pairs with SCADA.

#### Graphics & HMI editor
PI Vision ad-hoc displays; AF drives reusable asset-based symbols.

#### Scripting / APIs
AF SDK (.NET), PI Web API (REST), SQL Data Access (RTQP), PI ACE/Analyses, PowerShell tools.

#### Protocols & connectivity
**Hundreds of PI Interfaces/Connectors** (OPC DA/HDA/UA, Modbus, DNP3, IEC 60870/61850, MQTT, RDBMS, files, UFL custom…); node- or connection-licensed.

#### Security & auth
Windows/AD-integrated mappings/claims, PI-to-CONNECT secured egress, IT-compliance focus.

#### Reporting & analytics
PI Vision, DataLink, PI Integrator → Power BI/SQL, AVEVA Reports connectors; CONNECT analytics/AI services.

#### Redundancy & scale
HA server collectives; the largest industrial data estates on earth (millions of tags/site, global multi-site federations).

#### Licensing & pricing
- Now **subscription/Flex credits** (token pool across products); PI Data Infrastructure adds **Aggregate Tag licensing** — monthly tier benchmark + daily overage rate, CONNECT agent reports tag counts; HA/test/ancillary servers excluded.
- Legacy: per-tag tiers on PI Server + named client/product licenses (PI Vision per user, DataLink per user).
- Real-world datapoint: City of Lakeland FL — **$325,710 / 3-year** PI System subscription (~$108.5k/yr) for a utility-scale deployment (public procurement record).
- Sources: https://www.aveva.com/content/dam/aveva/documents/legal/policies/AVEVA-Software-Schedule-PI-System-v1-3-3-July-2024.pdf ; https://wiki.licenseware.io/catalog/programs/aveva-aggregate-tag-licensing-model/ ; https://www.flow-software.com/articles/migrating-from-pi-af-to-a-timebase-and-infohub-architecture

#### Standards & certifications
OPC UA/DA/HDA, MQTT, ISO-27001-grade cloud services via CONNECT; ubiquitous compliance use in pharma/energy (21 CFR Part 11-aligned deployments).

---

## Cross-vendor summary for a web-SCADA challenger

| Axis | Siemens | Rockwell | AVEVA |
|---|---|---|---|
| Web story | Unified = **native HTML5 runtime**; Classic = WebNavigator/WebUX bolt-ons; OA = ULC UX + Dashboard | ViewPoint bolt-on web (read+write) + ThinManager RDS; **Optix = HTML5 web clients + cloud IDE** | InTouch Web Client (HTML5, no IIS), OMI responsive client, CONNECT cloud |
| Data model | Flat tags (Classic/Unified); **DPT/DP/DPE object tree (OA)** | Direct Logix tag browse (unique strength) | **ArchestrA objects/templates** (deepest OO model) + AF on PI |
| Scripting | C/VBS (Classic) → **JavaScript/V8+Node (Unified)**; CTRL/MSA polyglot (OA) | VBA + server scripts (SE); **C#/.NET (Optix)** | QuickScript .NET, symbol scripts |
| Historian | Tag Logging/SQL; OA: NGA/TimescaleDB | **OEM'd PI** (Historian SE) | AVEVA Historian + **PI System** (category king) |
| Alarm mgmt | Alarm Logging; ISA-18.2 weakest | **ISA-18.2 alignment explicit** (A&E + Logix device alarms) | Area-object alarm aggregation, suppression |
| Licensing | PowerTags + options; mid-to-high cost | Client-bundles + feature tokens (Optix); unlimited web clients now | **Unlimited-everything subscription** (Operations Control) is the boldest move |
| Sweet spot | Discrete/automotive (TIA ecosystem); OA for mega-infrastructure | North America, Logix-centric plants, DCS (PlantPAx) | Process, O&G, marine, utilities; enterprise data layer |
| Open gaps | Steep complexity/price; fragmented 3-line portfolio | Web-first only on Optix (immature SCADA depth); Windows+RDS heritage | Heavy install footprint; subscription lock-in backlash |

**Key takeaway for a web-native entrant:** the incumbents' web options are either (a) bolt-on rendering of legacy Windows apps (ViewPoint, WebNavigator, InTouch Web Client), or (b) new platforms still filling feature gaps (Unified, Optix). None combine *native-web architecture + deep SCADA feature parity + simple pricing* — that combination is the competitive opening.


---

# Part III — ICONICS, zenon, Honeywell, Emerson, Yokogawa, ABB, Omron

# SCADA / Automation Platform Competitive Analysis

**Purpose:** In-depth competitive research for a web-based SCADA product. Web/HTML5 client architecture details are emphasized throughout.

---

## 1. ICONICS GENESIS64 (Mitsubishi Electric Iconics Digital Solutions)

### Overview & positioning
- 64-bit, OPC-centric HMI/SCADA suite built entirely on the Microsoft stack (.NET, WPF, WCF, OPC UA). First shipped April 2008; owned by Mitsubishi Electric since 2011 (acquired ~2019 fully; now "Mitsubishi Electric Iconics Digital Solutions"). Strong in building automation (BMS), plus manufacturing, energy, utilities, and federal government.
- Current versions: GENESIS64 v10.97.x (the long-standing suite) and the newer consolidated **GENESIS** v11 platform, which folds Hyper Historian and newer alarm/IoT components into one product.
- Suite components: GraphWorX64 (graphics), AlarmWorX64 (alarming), TrendWorX64 (trends), EarthWorX (GIS mapping — Bing/Google/Esri), ScheduleWorX64, Hyper Historian, Workbench (unified config), plus AnalytiX products (Energy AnalytiX, Facility AnalytiX, Quality AnalytiX, ReportWorX), BridgeWorX (data bridging), IoTWorX (edge), KPIWorX (dashboards), MobileHMI, CFSWorX (connected field service).

### Architecture & client types
- All client communications pass through a communications layer called **FrameWorX** plus per-module Configuration Services (Workbench-based). Licensing, security and OPC data all flow through FrameWorX.
- Client types: full desktop install (Workbench, GraphWorX64 WPF runtime), **GenBrowser** (mid-weight browser node, can run AlarmWorX64/TrendWorX64 locally), **WebHMI** (thin client served via IIS), **MobileHMI** (native apps + HTML5), and **KPIWorX** self-service web dashboards.
- **WebHMI / HTML5:** two publish paths historically — WPF/XBAP in Internet Explorer (legacy) and **HTML5 publishing** for Chrome/Safari/Edge (now the standard path). Displays authored in GraphWorX64 are published to an IIS-hosted WebHMI server; HTML5 is the recommended deployment because most customers require non-IE browsers. Read/write capable, not view-only.
- HTML5/WebHMI redundancy is achieved via **Microsoft Application Request Routing (ARR)** + IIS Network Load Balancing with cookie-based client affinity (sticky sessions required for HTML5 clients).
- MobileHMI HTML5 architecture uses a server-side "AnyGlass" server per session — each device session talks to a dedicated server-side instance that holds the FrameWorX client (i.e., server-side session state model).

### Tag & data model
- OPC-UA-centric tag model; AssetWorX / "Unified Data Manager" provides an ISA-95-compliant asset hierarchy (equipment properties as tag containers) — ICONICS markets this as its Unified Namespace implementation.
- Basic SCADA license tier requires all tags to be modeled as AssetWorX equipment properties.

### Historian
- **Hyper Historian**: 64-bit high-speed time-series historian with advanced compression; integrates with ISA-95 asset model and big-data targets (Azure SQL, Data Lakes, Kafka, Hadoop). Remote collectors can store-and-forward (local buffering) across unreliable links. Included in new GENESIS; optional in GENESIS64.

### Alarms
- AlarmWorX64 Server (legacy) and the newer v11 Alarm Server (FrameWorX-integrated, active/standby redundancy). Implements the **ISA-18.2 alarm state machine** (Normal/Active/Acknowledged/Shelved etc.), alarm shelving, hierarchical area model, Hyper Alarm Server for enterprise distribution. AlarmWorX64 Viewer is a pre-built control embeddable in any display and on all client platforms. Alarm collectors feed a separate Alarm Historian for historical alarm queries.

### Graphics & HMI editor
- GraphWorX64: WPF-based design-time + runtime with hardware-accelerated 2D/3D graphics (genuine 3D viewport, not pseudo-3D), hierarchical object model, templates, multitouch support. Displays publish to WebHMI (HTML5) and MobileHMI without format conversion (some scripting/3D limitations on HTML5).
- EarthWorX provides GIS visualization using Bing/Google/Esri tiles with geo-located assets.

### Scripting
- **JScript.NET** scripting inside GraphWorX64 displays (event-driven: button clicks, display load); can call .NET framework and arbitrary .NET DLLs and the GENESIS64 API. Scripting can be disabled via Gwx.config.xml (`ScriptingEnabled=false`) for hardening.

### Protocols & connectivity
- OPC UA/DA/AE/HDA/XML-DA/Batch client and server, BACnet (full workstation profile — see certifications), Modbus, SNMP, plus relational DB connectivity. BridgeWorX for point-to-point data bridging. IoT: MQTT publish/subscribe incl. Sparkplug-B, Azure IoT Hub/Event Hub, REST.

### Security
- Secure-by-default install since 10.97 (non-demo). Central Security Server, Windows authentication/UAC integration, certificate-based OPC UA, IIS TLS for WebHMI. GENESIS64 has historically held government/defense approvals (widely used in US federal buildings; ICONICS advertises high-assurance deployments).

### Reporting & analytics
- ReportWorX (Excel-based report generation), Energy AnalytiX (energy dashboards/consumption analysis), Facility AnalytiX (FDD — fault detection & diagnostics for buildings), Quality AnalytiX (SPC), KPIWorX (self-service BI dashboards).

### Redundancy & scale
- Redundant application-server pairs (discounted bundle model numbers e.g. `GEN64-HH-R-xxx`), redundant WebHMI via ARR/NLB, Hyper Historian redundancy, Alarm Server active/standby, store-and-forward collectors.

### Licensing
- Perpetual licensing via serial number + site key, License Monitor WCF service; floating/concurrent client CALs reclaimed automatically when sessions end. Separate licenses per application (WebHMI server `WEBHMI64-BRWSR`, redundant variants `-R`, alarm bundles `MMX-xx`). New in 10.97: **GENESIS64 Basic SCADA** (economical tag-counted tier) and GENESIS64 Advanced. Cloud deployment sold as Azure Marketplace VMs.

### Standards & certifications
- **BACnet BTL certified at B-AWS profile** (BACnet Advanced Operator Workstation — the most demanding workstation profile): GENESIS64 10.97.310 listing BTL-31200 (May 2024, Protocol Revision 19); GENESIS v11.04 listing BTL-31551. Genuine strength — BACnet is first-class, not an add-on driver.
- OPC Foundation member; OPC DA/AE/HDA/UA compliance. ISA-18.2 alarm state machine; ISA-95 asset model.

### Sources
- https://documentation.iconics.com/v10.97.3/Content/Com/Intro/GENESIS64_-_Architecture_Overview.htm
- https://iconics.com/iconics-institute/clients/web-browser-deployment
- https://docs.iconics.com/V10.97.2/GENESIS64/Help/Com/Arch/DA/HTML5_WebHMI_Redundancy_and_Network_Load_Balancing.htm
- https://docs.iconics.com/v10.96.2/genesis64/help/Com/Intro/Using_Application_Desktop_or_WebHMI_Client.htm
- https://docs.iconics.com/V10.97.1/GENESIS64/Help/Apps/MobileHMI/Architecture_Overview.htm
- https://iconics.com/products/hyper-historian
- https://documentation.iconics.com/v11/Content/Alarming/Alarm-Server/alarm-server-architecture.htm
- https://documentation.iconics.com/v10.98/Content/Com/Tools/IoTWorX/Information_Broker_MQTT_Quick_Start.htm
- https://documentation.iconics.com/v10.98/Content/Apps/GWX/Scripting_Basics.htm
- https://documentation.iconics.com/v11/Content/Data-Connectivity/BACnet/Getting-Started-with-BACnet/bacnet-conformance-and-certification.htm
- https://iconics.com/news/press-releases/2024/iconics-genesis64-recertified-against-bacnet-b-aws
- https://www.bacnetinternational.net/btl/listings/iconics,%20inc./BTL_Listing_31200_ICONICS_GENESIS64.pdf
- https://docs.iconics.com/V10.97.1/GENESIS64/Help/Com/Arch/LIC/Licensing_Options.htm
- https://docs.iconics.com/v10.97.2/genesis64/help/com/arch/lic/LIC10001001_Licensing_Overview.htm
- https://dl.mitsubishielectric.com/dl/fa/document/catalog/scada/l08785eng/l08785engd.pdf
- https://azuremarketplace.microsoft.com/en-uk/marketplace/apps/iconics.iconics-suite-10973

---

## 2. COPA-DATA zenon (zenon Software Platform)

### Overview & positioning
- Independent Austrian vendor (Salzburg), hardware-agnostic HMI/SCADA platform with strong positions in **energy/utilities** (substation automation is a flagship use case — zenon is one of the market leaders for IEC 61850 SCADA), manufacturing, automotive, pharma/food & beverage. Recent versions: zenon 11/12, platform renamed around "Service Engine" terminology.
- Single platform: HMI + SCADA + reporting + soft-PLC (straton) + DMS/GIS for utilities.

### Architecture & client types
- zenon Runtime ("Service Engine") runs projects compiled by the Engineering Studio. Multi-project architecture: integration projects + subprojects; a single engineering environment for all projects.
- Client types: **native zenon client**, **zenon Smart Client** (thin-ish client — zero-admin deployment pulled from server), **zenon Terminal Server** (RDS/terminal services), **Web Visualization Service (WVS)**, and **HTML Web Engine**.
- **WVS (zenon 11+):** thin-client HTML5 visualization served directly by Service Engine — multi-session capable, per-session isolation (incl. local internal variables), TLS-encrypted Service Engine↔browser channel, Ops Manager web front-end for session/instance administration. Supports AML/CEL with filters, integration projects/subprojects, auto-scaling to browser/device (incl. rotation on mobile). Choose classic DirectX or WVS at Service Engine launch.
- **HTML Web Engine (older path):** renders zenon screens as HTML5 via a web server (can sit in DMZ), HTTPS/SSL, user auth/levels; historically more limited (e.g., Extended Trend not dynamically updated; some screen types unsupported). Available as Docker image in zenon 10+; can pair with zenon IIoT Services for cloud deployment.
- Engineering requires no extra compiler for WVS — direct from Engineering Studio.

### Tag & data model
- Variable-based tags with rich status/quality bits (64-bit status: `PR_NR`, `T_UNSYNC`, `CB_TRIP`, driver-specific states). Data model supports structures, Smart Objects (reusable composite templates), equipment modeling, reaction matrices, language tables.

### Historian
- Built-in **zenon Historian** (archives in Service Engine) plus **zenon Historian 360** (newer standalone process historian product). Extended Trend (ETM), Archive Server module (short/long-term archives, evacuation), redundancy-aware gapless archiving (status handling prevents spurious values on failover).

### Alarms
- Alarm Message List (AML) + Chronological Event List (CEL), alarm groups/classes, alarm causes, reaction matrices; Sequence-of-Events (SoE) with high-resolution timestamps for energy. Alarm management, event-triggered functions, message control (SMS/email notification), lockout-tagout support in energy edition.

### Graphics & HMI editor
- Engineering Studio: screen types incl. world-view/GIS, single-line diagrams with **Automatic Line Coloring (topology coloring)**, dynamic elements, symbols, Smart Objects/templates, multi-monitor support; HTML5/Web Engine support matrix per screen type; Gantt in ETM supported in web.

### Scripting
- **VBA** and **VSTA (.NET)** add-in frameworks with a large object model (Editor + Runtime APIs), wizards, macros; plus a **Python** path — `pyZAN` library for offline data access (historical + real-time values, alarms, events, batches, metadata) and a newer Python Add-In for Editor/Runtime. Public API surface documented (zenon API map).

### Protocols & connectivity
- 300+ in-house drivers (not OPC wrappers): **IEC 61850 Ed. 2.1 — MMS client/server + GOOSE publisher/subscriber** with SCL Editor and auto-engineering wizard (SCD/CID/ICD import); IEC 60870-101/104 (incl. Process Gateway acting as a slave/gateway to re-issue zenon data over 60870/DNP3/Modbus), DNP3, Modbus, BACnet (driver + BACnet-device mode), OPC DA/UA, SNMP, plus MQTT/IIoT services and a GraphQL interface + pyZAN for data export.

### Security
- Role-based access control, fine-grained user administration, e-signature (FDA 21 CFR Part 11 capable), audit trail, HTTPS for web paths, encrypted Service Engine↔WVS channel; network encryption options; PRP/HSR support at protocol level.

### Reporting & analytics
- **zenon Report Engine** (built-in reports) + **zenon Analyzer** (web-based reporting server: connectors to heterogeneous sources → harmonized SQL DB → Report Builder/MS Report Builder reports served in browser via Report Launcher). Recipegroup Manager, Production & Facility Scheduler, Shift Management, GraphQL interface, pyZAN for ML/analytics pipelines.

### Redundancy & scale
- **Circular redundancy** (easy-config primary/standby with seamless process-server redundancy), **Rated Redundancy** (metric-driven preemptive failover), PRP (Parallel Redundancy Protocol — zero switchover) and HSR support for IEC 61850 networks, driver-level redundancy strategies, multi-server/client network model. Scales from standalone to distributed multi-node projects.

### Licensing
- TAG- or I/O-count based gradations: 64 → 128 → 256 → 512 → 1,024 → 2,048 → 4,096 → 8,192 → 16,384 → 65,536 → unlimited (internal/system/math/simulation variables don't count). I/O counting: 1 bit = 1 I/O, byte = 8, word/dword/float/string = 16. Separate licenses per product: Editor, Runtime, Analyzer, zenon Logic (straton) Runtime, Web Server, Web Engine/WVS, Process Gateway; drivers licensed individually or in price groups. CodeMeter (Wibu) hardware/software/VM dongles; soft licensing; concurrent network-dongle client licenses; upgrade path anytime.

### Standards & certifications
- IEC 61850 Ed 2.1 (incl. SCL), IEC 60870-5-101/104, DNP3; **ISA-88** Batch Control module (see below); FDA 21 CFR Part 11 / GMP support (pharma); IEC 61131-3 (straton); IEC 62443-aligned security development (COPA-DATA advertises secure development practices; check current cert status per release).

### Notes — differentiators
- **Command Processing** (SBO-type select-before-operate command sequences w/ interlocking, topological checks — "Safe Command Processing, Lockout-Tagout", Command Sequencer templates) is a genuine utility-grade differentiator.
- **Batch Control**: ISA-88 compliant master/control recipes, phase logic, audit trail — strong in pharma/food.
- **Process Recorder**: records live process data for later playback in simulation mode on the actual process screens (post-mortem analysis/training) — unique among SCADA peers.
- **straton** (zenon Logic): integrated IEC 61131-3 soft-PLC (5 languages) — historically "straton" branded, runtime as soft-PLC for PC/CE; also OEM toolkit (copalp) used by many PLC vendors.
- **zenon Energy Edition / DMS**: single-line + topology, integrated GIS, load-flow calc, state estimator, N-1 contingency, fault location, SoE, command sequencer.

### Sources
- https://www.copadata.com/en/zenon-capabilities/visualization-control/html5-technology-with-zenon/
- https://www.copadata.com/en/zenon-capabilities/visualization-control/zenon-web-visualization-service/
- http://download.copadata.com/fileadmin/user_upload/Downloads/Dokumentation/820SP0/ENGLISH/Manual/HTML_Web_Engine.pdf
- http://download.copadata.com/fileadmin/user_upload/Downloads/Dokumentation/760SP0/ENGLISH/Manual/zenon_Web_Server.pdf
- https://www.copadata.com/hubfs/Downloads/Brochures/Energy_zenon_BR_EN.pdf
- https://www.copadata.com/en/industries/energy-infrastructure/energy-solutions/zenon-energy-automated-substations/
- https://www.copadata.com/en/industries/energy-infrastructure/energy-insights/prp-substation-scada/
- https://www.copadata.com/en/industries/energy-infrastructure/energy-solutions/zenon-energy-distribution-management-system/
- https://www.copadata.com/en/zenon-capabilities/analytics-reporting/zenon-process-recorder/
- https://www.copadata.com/en/zenon-capabilities/analytics-reporting/reporting/
- http://download.copadata.com/fileadmin/user_upload/Downloads/DocumentationAnalyzer/300SP0/ENGLISH/Manual/Basics.pdf
- https://www.copadata.com/en/zenon-characteristics/zenon-batch-control/
- https://www.copadata.com/hubfs/Downloads/White%20Papers/Batch_Control_design_usage_WP_EN.pdf
- http://download.copadata.com/fileadmin/user_upload/Downloads/Dokumentation/711SP0/ENGLISH/Manual/zenon_logic.pdf
- https://straton-plc.com/en/product/
- http://download.copadata.com/fileadmin/user_upload/Downloads/Dokumentation/760SP0/ENGLISH/Manual/Licensing.pdf
- https://www.copadata.com/hubfs/Downloads/API-Poster_2022_A1.pdf
- http://download.copadata.com/fileadmin/user_upload/Downloads/Dokumentation/820SP0/FRENCH/Driver/IEC850.pdf
- http://download.copadata.com/fileadmin/user_upload/Downloads/Dokumentation/820SP0/ENGLISH/Manual/Status_processing.pdf
- https://go.copadata.com/hubfs/Release_notes_zenon_software_plattform_10.pdf

---

## 3. Honeywell Experion PKS (incl. Experion LX / Experion HS)

### Overview & positioning
- Flagship DCS/SCADA hybrid for process industries: oil & gas (huge pipeline SCADA base), refining, chemicals, LNG, mining. **Experion PKS** = full DCS; **Experion LX** = mid-size variant (C300 + Series 8 I/O); **Experion HS** = workstation-based "hybrid SCADA" for small/medium projects (a subset of PKS components, onboard historian, server redundancy, ≤16,050 composite SCADA points, ≤20 stations per server).
- Tight portfolio ties: Safety Manager (SIS), Uniformance PHD/Insight (historian/analytics), Honeywell Forge Alarm Management (formerly DynAMo).

### Architecture & client types
- Nodes: **Experion Server** (system-wide historian + global database + SCADA/DSA/OPC point sources + event journal; redundant server pairs), **Console Station** (direct controller access — "no loss of view/no loss of control," grouped into logical consoles), **Flex Station** (cached server access — efficient for large station counts; static or rotary/concurrent connection), **Engineering Station**, Application Control Environment (ACE), eServer.
- Controllers: C200 (legacy), **C300** (CEE — deterministic Control Execution Environment, FTE-native), Series 8/C-series I/O, ControlEdge PLC/RTU integration; Safety Manager via CDA peer-to-peer.
- **HMIWeb display technology**: displays are DHTML pages (.htm files) authored in HMIWeb Display Builder and rendered in Station or browser — Honeywell was early to "web-native" HMI (~2003), though the rendering is proprietary ActiveX/DHTML rather than modern HTML5. Objects expose a DOM; scripting via VBScript/JScript.
- **Web access: Experion eServer** — a separate DSA-based web server giving **read-only** browser access to the same custom displays with no conversion; casual users share a single access point; alarms/events blocked from eServer view; scalable concurrent-user licensing. Also "Experion Web" options and terminal-services-based access; no full read/write HTML5 operator client as of current releases — remote control still means Station/Remote Client or thin-client solutions.

### Tag & data model
- Composite points: Analog, Status, Accumulator point structures + algorithms, container points, OPC Advanced Points; parameters referenced relative to a single tagname; up to 65,000 points/server (≤20,000 process points; process + SCADA ≤ 65,000); ≤40 station connections/server; ≤99 channels; ≤255 SCADA RTUs; 1,000 areas; DSA links multiple servers into one logical system.

### Historian
- Onboard server historian (standard/fast/extended history point parameters, ≤10,000 each class per server) plus **Uniformance PHD** enterprise historian (collects via OPC etc., integrates tag sync with Experion), Uniformance Insight for analytics/dashboarding.

### Alarms
- Alarm/event infrastructure in server; console-station alarm acknowledgement, silencing, scope-of-responsibility; alarm groups, SOE (≤32,767 stored events; DI SOE in LX hardware). **Honeywell Forge Alarm Management (ex-DynAMo)**: vendor-neutral, web-based KPI reporting vs ISA-18.2/EEMUA 191/IEC 62682/API 1167/PHMSA; claims 1,000+ installs and up to 80% alarm-count reduction; mobile-capable dashboards. Sold both standalone and integrated with Experion.

### Graphics & HMI editor
- HMIWeb Display Builder: object-based editor, dynamic shapes, shape sequences (equipment state animation), alarm group generator, display validation; displays saved as .htm; ASM-Consortium-informed "situational awareness" display style; system displays out of box.

### Scripting
- VBScript/JScript embedded in HMIWeb displays (DOM-based, like classic web pages); server-side scripts (server tasks); Control Builder strategy logic for CEE controllers.

### Protocols & connectivity
- SCADA drivers: Modbus TCP/serial, DNP3, IEC 60870-5, IEC 61850 Ed2 (in Experion HS/LX), OPC DA/HDA/A&E client+server; CDA (internal), peer-to-peer between controllers; FTE supervisory network; interface to TPS/LCN legacy systems.

### Security
- FTE hardened control network; ISA99/IEC 62443-aligned Honeywell Cyber Security Architecture & methodology; Safety Manager is **ISASecure/EDSA certified** (Embedded Device Security Assurance) and SIL3 TÜV; eServer read-only segmentation protects control system integrity.

### Reporting & analytics
- Report/printing subsystem, eServer distribution of displays, Uniformance Insight dashboards, Honeywell Forge analytics stack, DynAMo alarm KPIs, production accounting/MES tie-ins (Uniformance Suite).

### Redundancy & scale
- **FTE (Fault Tolerant Ethernet)**: patented single-logical-network over redundant physical paths — <1s switchover, tolerates all single and many multiple faults; redundant servers; redundant C300 (and I/O links); QMR 2oo4D in Safety Manager; DSA scales horizontally across units/sites (publish/subscribe point federation, HS can publish up to 20 remote servers).

### Licensing
- License-key option enablement on the server ("most options don't require additional software installation"); database sized in point increments; station licenses: Static (dedicated) vs Rotary (concurrent-use pool); Flex Station counts per cluster (LX: 10/cluster; 2 bundled); eServer concurrent-user; separate SKUs for Direct/Flex stations, redundancy, DSA, OPC, history classes.

### Standards & certifications
- ISA-18.2/EEMUA 191/IEC 62682 via DynAMo/Forge tooling; IEC 61511/61508 SIL3 (Safety Manager, TÜV); ISASecure EDSA (Safety Manager); ASM Consortium HMI guidelines; API 1167 & PHMSA for pipelines.

### Sources
- https://process.honeywell.com/us/en/products/process-automation/distributed-control-systems-dcs/experion-pks/infrastructure/fault-tolerant-ethernet
- https://process.honeywell.com/us/en/products-backup/control-and-supervisory-systems/distributed-control-systems-dcs/experion-pks/remote-access/experion-eserver
- https://process.honeywell.com/us/en/products/process-automation/distributed-control-systems-dcs/experion-pks/systems/distributed-system-architecture
- https://process.honeywell.com/content/dam/process/en/documents/document-lists/doc-list-migration/Asset-Experion-HMI-PIN.pdf
- https://prod-edam.honeywell.com/content/dam/honeywell-edam/pmt/hps/products/pmc/field-instruments/pmt-hps-lx03-200-520-experion-lx-v01-0.pdf
- https://www.dgfg.nl/wp-content/uploads/2018/02/Experion-LX-R500-Reference-Guide.pdf
- https://process.honeywell.com/content/process/us/en/products/control-and-supervisory-systems/scada/experion-hs/experion-hs
- https://www.hanang-instrument.com/images/stories/pdf/Honeywell/Control-System/experion%20hs%20specification.pdf
- http://www.keli-control.com/control%20system/HONEYWELL/Honeywell-EPKS%20system.pdf
- https://process.honeywell.com/content/dam/process/en/documents/document-lists/doc-list-alarm-management/hon-alarm-reporting.pdf
- https://www.prnewswire.com/news-releases/honeywell-reduces-nuisance-alarms-that-can-lead-to-billion-dollar-losses-in-the-process-industries-232877331.html
- https://prod-edam.honeywell.com/content/dam/honeywell-edam/pmt/hps/products/pas/safety-systems/safety-manager/PIN-Safety-Manager.pdf
- https://process.honeywell.com/content/dam/process/en/documents/training-docs/control-monitoring-and-safety-systems/mt/EXP-7054-MT-Experion-PKS-HMIWeb-Display-Builder-Basic-Scripting.pdf
- https://www.hanang-instrument.com/images/stories/pdf/Honeywell/Control-System/intro-to-experion-lx.pdf

---

## 4. Emerson DeltaV + Ovation

### Overview & positioning
- **DeltaV**: flagship DCS for hybrid/process industries — life sciences, specialty chemical, oil & gas. ISA-88 batch is architecturally native ("built-for-batch"). **Ovation**: sister DCS purpose-built for power generation and water/wastewater (ARC names it #1 DCS for power generation); Ovation 4.0 adds software-defined architecture, GenAI advisor, Ovation View HMI.

### Architecture & client types (DeltaV)
- Workstations (ProPLUS, Operator, Application stations), controllers (M-series/SD-plus, newer **PK Flex** and **IQ** controllers), Electronic Marshalling via **CHARMs/CIOC** (96 individually configurable channels/card, fully redundant comms down to the channel, auto-sense I/O definition, field-mountable Zone 2 hardware), S-series I/O; embedded OPC servers; DeltaV Edge Environment for IT/OT data egress.
- **DeltaV Live** (introduced v14.3): new operator interface — **first DCS HMI to natively support HTML5 graphics**. Graphics Studio design environment (HTML5-based), no scripting needed for common tasks (TypeScript available for advanced cases); ISA-101/COP high-performance HMI features out of box: display hierarchies, coordinated navigation ("yoking"), layouts, themes, multi-language runtime; multi-platform (desktop/tablet/phone form factors).
- **Web/remote access:** **DeltaV Live Enterprise View** — app on DeltaV Edge Node serving Live displays in Chromium browsers, secure **read-only**, no display conversion; per-concurrent-user subscription (v15.LTS+ / Edge v2.2+; up to 500 displays; 1s–60s sampling; ≤1yr cached history). DeltaV Remote Client (terminal-services-style remote sessions; licenses by span-of-control: Zero Span vs Full vs View-Only VE2110). Classic DeltaV Operate remains the thick client.
- **Ovation 4.0:** new **Ovation View HMI** supports HTML5 web applications + any graphic style (3D, dashboards, high-performance), rich 2D/3D widget library; Developer Studio engineering; Oracle→MS SQL Server database migration; up to 750,000 points; Ovation Enterprise Data Solutions (EDS) for fleet/remote visualization incl. mobile.

### Tag & data model
- Module-based: control modules, equipment modules, units — mapped to ISA-88 physical model; DSTs (Device/Destination/Source Tags) are the licensing unit (~30,000 DSTs max in Flex). Aliased, class-based configuration; module parameters exposed to OPC.

### Historian
- Continuous Historian on Application Station (embedded), Event Chronicle; DeltaV Edge replicates contextualized data for enterprise/analytics (REST API + OPC UA on Edge).

### Alarms
- ISA-18.2-aligned alarm lifecycle support documented in "Alarm Management for DeltaV" whitepaper (alarm philosophy → rationalization → ops → monitoring/assessment); DeltaV AgileOps alarm tools; alarm shelving, priority, audit; Plantwide Event Historian/Alarm & Event services; e-alerts.

### Graphics & HMI editor
- **Graphics Studio (DeltaV Live)**: HTML5-native editor, display hierarchy-aware, theme/layout system, low-script configuration; classic DeltaV Operate/Intellution-era display builder remains for legacy systems.

### Scripting
- TypeScript in DeltaV Live (advanced scenarios); DeltaV historically favors configuration over scripting (IEC 61131-3 languages in controllers: FBD, ST, SFC + phase logic for batch).

### Protocols & connectivity
- OPC UA server (activation license; A&C support), OPC DA/A&E legacy, REST API on Edge, Modbus TCP, EtherNet/IP, PROFINET/PROFIBUS, FF H1/HSE (historic strength — FOUNDATION fieldbus champion), HART-native everywhere, DeviceNet; IEC 61850 via Ovation side/RTU integrations.

### Security
- **ISASecure SSA Level 1 (IEC 62443-3-3) certified** — DeltaV DCS+SIS since v14.3 FP1, maintained in v16.LTS (SDLA Level 1 for dev process; specific BOM/layout constraints, CIOC v2 required); integrated patch management; DeltaV Edge provides read-only DMZ-style data egress; SIS separated-but-integrated (separate LSN/CSLS).

### Reporting & analytics
- Batch Executive/batch history + electronic batch records (21 CFR Part 11 support, e-signatures, versioning); DeltaV Edge Environment apps marketplace (Edge Explorer etc.); Ovation advanced apps (digital twins, ML/AI, GenAI advisor).

### Redundancy & scale
- Redundant controllers, CIOC/CARRIER power+comms redundancy to the channel, redundant CSLS pairs for SIS, redundant workstations/servers; Flex scales 50→30,000 DSTs; Ovation to 750k points.

### Licensing
- Traditional: perpetual licenses keyed to DST count + workstation/application roles; span-of-control licensing for remote clients. **DeltaV Flex** (new): **term/subscription bundle** — software + support + extended hardware warranty in base packages of 50/100/250/500/1,500 Flex DSTs (→30k); aimed at lowering CapEx for OEM skids/small systems. DeltaV Live Enterprise View = add-on subscription per concurrent user.

### Standards & certifications
- **ISA-88 native** (physical/procedural model built in; NAMUR NE33); ISA-18.2/IEC 62682 tooling; **IEC 62443** ISASecure SSA L1 + SDLA L1; IEC 61511/61508 SIL3 (DeltaV SIS — CSLS logic solvers rated SIL3 simplex or redundant); ISA-101/COP HMI best practices; FDA 21 CFR Part 11; IEC 61131-3.

### Sources
- https://www.emerson.com/en/automation-systems/distributed-control-systems-dcs/deltav-distributed-control-system/deltav-live
- https://www.emerson.com/documents/automation/product-data-sheet-deltav-live-deltav-en-3869350.pdf
- https://www.emerson.com/is/content/emerson/en/systems-and-software/deltav-distributed-control-system-dcs/white-papers/documents/whats-new-in-deltav-v14.pdf
- https://www.emerson.com/is/content/emerson/en/systems-and-software/deltav-distributed-control-system-dcs/brochures-and-flyers/documents/deltav-live-enterprise-view.pdf
- https://www.emerson.com/en/automation-systems/deltav/deltav-v16
- https://www.emerson.com/en/automation-systems/deltav/deltav-v16/upgrade-v11-v13
- https://www.emerson.com/en/automation-systems/distributed-control-systems-dcs/deltav-distributed-control-system/deltav-controllers-io/deltav-flex-system
- https://www.emerson.com/is/content/emerson/en/systems-and-software/deltav-distributed-control-system-dcs/product-data-sheets/documents/deltav-flex-system.pdf
- https://www.emerson.com/is/content/emerson/en/systems-and-software/deltav-distributed-control-system-dcs/product-data-sheets/documents/deltav-electronic-marshalling.pdf
- https://www.emerson.com/is/content/emerson/en/systems-and-software/deltav-safety-instrumented-systems/product-data-sheets/deltav-sis-with-electronic-marshalling-product-data-sheet.pdf
- https://www.spartancontrols.com/products/control-safety-systems/deltav/deltav-distributed-control-system-for-process-industries/batch-control-operations/deltav-advanced-unit-management-software/
- https://www.emerson.com/is/content/emerson/en/systems-and-software/deltav-distributed-control-system-dcs/white-papers/documents/alarm-management-for-deltav.pdf
- https://www.emerson.com/is/content/emerson/en/systems-and-software/deltav-distributed-control-system-dcs/white-papers/documents/isa-secure-ssa-certification-for-deltav-and-deltav-sis-faq.pdf
- https://isasecure.org/hubfs/2022%20ISA%20Website%20Redesigns/ISA%20Secure/PDFs/IEC-62443-3-3-Certified-Systems/Emerson-DeltaV-ISASecure-SSA-Cert.pdf?hsLang=en
- https://www.emerson.com/en/automation-systems/ovation/ovation-4
- https://www.emerson.com/en/automation-systems/distributed-control-systems-dcs/ovation-distributed-control-system
- https://www.emersonautomationexperts.com/2025/industry/power-generation/a-deeper-look-into-ovation-4-0s-new-features/
- https://emersonexchange365.com/community-hubs/deltav-community-connect/f/deltav-discussions-questions/7515/zero-span-of-control-vs-view-onlydeltav-operate-license/17049

---

## 5. Yokogawa CENTUM VP + FAST/TOOLS + CI Server (OpreX)

### Overview & positioning
- **CENTUM VP** (8th-gen DCS, part of OpreX Control & Safety): process industries (oil & gas, chemicals, LNG, power) with ProSafe-RS as the integrated-yet-separated SIS. **FAST/TOOLS**: Yokogawa's **pure software SCADA** — Java-based, OS-independent, web-centric since R9 — used for pipelines (EPMS suite), upstream wellheads, renewables, water. **CI Server**: newer cross-platform "Collaborative Information Server" — the strategic IT/OT integration layer.

### Architecture & client types
- **CENTUM VP**: HIS (Human Interface Station — PC-based operator station), FCS (Field Control Station — dual-redundant "pair & spare" controllers, 99.99999% availability claim, run autonomously without HIS), Vnet/IP (redundant 1 GbE real-time control network); up to 1,000,000 tags; virtualization platform option; HIS can display CI Server screens (R6.09+).
- **FAST/TOOLS**: **server-centric web architecture** — clients launch from any browser; server-side license management only. Client types: **rich Java client** (full capability), **HTML5 mobile/web client** (pure HTML5, zero plug-ins — primarily monitoring/alarm update scope), web-based engineering/maintenance (zero-deployment config). Multi-tier Enterprise Automation Solution (EAS) model: Process → Area → Enterprise levels; single engineering environment (Enterprise Engineering Module) with object-model deployment across server tiers; supports virtualization/cloud/XaaS.
- **CI Server**: cross-platform supervisory information system aggregating DCS/SIS/PAM/PRM + third-party data; **web-based centralized engineering** (distributed DBs configured & synchronized centrally, multi-user online engineering); components include CI Gateway (edge data collection); RESTful API + OPC UA (incl. A&C) interfaces; receives CENTUM/ProSafe alarms over integrated network; deployable on-prem or cloud.

### Tag & data model
- CENTUM: tag-centric function-block model inside FCS (all process data/logic in controllers; HIS is effectively a client). FAST/TOOLS: object-based application model deployed from single engineering environment; information models for CENTUM integration. CI Server: unified namespace-style aggregation layer.

### Historian
- CENTUM: HIS long-term data archive + trend packages; Exaquantum is Yokogawa's enterprise historian/PIMS (companion product). FAST/TOOLS stores real-time + historical info with redundant server history. CI Server brokers contextualized data to IT systems.

### Alarms
- CENTUM VP HIS: integrated alarm handling across DCS + ProSafe-RS SIS + PRM asset alarms; Advanced Alarm Filter package, Million Tag Handling, alarm management consulting/tooling (ISA-18.2-aligned services and "Advanced Alarm Administration" packages). FAST/TOOLS: real-time event/alarm management in web client. CI Server can centralize alarms via OPC UA A&C.

### Graphics & HMI editor
- CENTUM VP: HIS windows-based graphics (traditional DCS console graphics). FAST/TOOLS: graphics editor generates **native HTML5** displays for both rich PC apps and lightweight tablet/phone views. CI Server: modern HTML5 dashboards/visualization.

### Scripting
- FAST/TOOLS: Java-based extensibility, scripting within application objects. CENTUM: function-block programming + HIS customization packages. CI Server: web APIs (REST).

### Protocols & connectivity
- CENTUM: FOUNDATION fieldbus, PROFIBUS-DP, PROFINET, Modbus RTU/TCP, DeviceNet, ISA100 wireless, HART (via PRM). FAST/TOOLS: large driver set (DNP3, IEC 60870, IEC 61850, Modbus, OPC, MELSEC iQ-R, Omron FINS, etc.) targeting RTU/PLC heterogeneity. CI Server: OPC UA (DA/A&C), RESTful API, MQTT/Modbus via gateway patterns.

### Security
- **ISASecure leader**: ProSafe-RS & ProSafe-RS Lite CSA L1 (2021), **CENTUM VP CSA Level 1 (IEC 62443-4-1/4-2)** — Jan 2022, among the first DCS certified (R6.09 added CRC integrity checking of FCS programs/DBs); **ICSS (CENTUM VP + ProSafe-RS) ISASecure SSA Level 1** (IEC 62443-3-3) — certified Feb 2026 under SSA 4.0.0; SDLA certified dev lifecycle. FAST/TOOLS: SPNEGO/Kerberos web auth, hardened deployment.

### Reporting & analytics
- CENTUM Report Package, VP Batch process management; Exaquantum PIMS/AM Suite; CI Server dashboards + REST/OData-style access; OpreX Intelligent Manufacturing Hub (real-time dashboard + low-code integration + AI assistant).

### Redundancy & scale
- CENTUM: dual-redundant pair-&-spare FCS, redundant Vnet/IP, redundant HIS/servers, 1M-tag systems. **FAST/TOOLS: dual/triple/quad server redundancy + RAID configs, geo-distributed, 99.999% availability claim, auto/manual failover, client (1+n) redundancy** — proven at NAM-scale pipeline/utility deployments.

### Licensing
- FAST/TOOLS: server + client licenses scaled on system size with module options; no client-side license management for web clients (server-centric). CENTUM: package-based software licenses per HIS/FCS function (VP6Hxxxx part numbers, e.g., OPC interface, alarm filter, archive packages). CI Server licensed per deployment/gateway components.

### Standards & certifications
- **IEC 62443**: ISASecure CSA L1 (CENTUM VP component, ProSafe-RS, ProSafe-RS Lite), ISASecure SSA L1 (ICSS system, 2026), SDLA — Yokogawa was an early mover. SIL3 TÜV (ProSafe-RS), SIL2 (Lite). ISA-18.2 alarm practices; ISA100 wireless advocacy; OPC UA.

### Sources
- https://www.yokogawa.com/solutions/products-and-services/control/control-and-safety-system/collaborative-information-server/fast-tools/
- https://www.yokogawa.com/news/press-releases/2019/2019-04-17/
- https://www.yokogawa.com/library/videos/product-overviews/yokogawa-fasttools-scada-mobile-client-demonstration/
- https://www.yokogawa.com/library/resources/yokogawa-technical-reports/enterprise-solutions-in-the-world-of-process-automation-with-fast-tools/
- https://www.yokogawa.com/news/press-releases/2010/2010-06-14/
- https://www.instrumentation.co.za/news.aspx?pklnewsid=35739
- http://www.yokogawa.com/pdf/provide/E/GW/TI/0000025524/0/TI33K01A10-50E.pdf
- https://www.yokogawa.com/solutions/products-and-services/control/control-and-safety-system/distributed-control-systems-dcs/centum-vp/
- https://www.yokogawa.com/cis/library/resources/white-papers/the-next-evolution-of-yokogawa-centum/
- http://web-material3.yokogawa.com/GS33J01A10-01EN_010.pdf
- https://www.yokogawa.com/solutions/products-and-services/control/control-and-safety-system/collaborative-information-server/ciserver/
- https://www.yokogawa.com/news/press-releases/2025/2025-02-12/
- https://control.com/news/yokogawa-upgrades-oprex-software-suite-for-ci-servers/
- https://www.yokogawa.com/news/press-releases/2022/2022-01-12/
- https://www.yokogawa.com/news/press-releases/2026/2026-04-08/
- https://isasecure.org/end-users/iec-62443-3-3-certified-systems
- https://isasecure.org/hubfs/EXIDA_26_YEC%2025-05-193%20C004%20V1R2%20SSA%204.0.0%20Level%201%20Certificate.pdf?hsLang=en

---

## 6. ABB Ability System 800xA

### Overview & positioning
- "Extended Automation" DCS — one system for process, electrical (power), safety and telecoms. Strong in mining/minerals, pulp & paper, cement, metals, oil & gas, chemicals. Flagship differentiator: **Aspect Object architecture** and integrated electrical control (IEC 61850).

### Architecture & client types
- **Aspect Objects**: real-world entities modeled as containers of independent "aspects" (each aspect = a perspective owned by an aspect system — graphics, alarms, docs, control, trends, asset data). Applications from ABB/third parties/customers cooperate without internal change; navigate-by-object rather than by-tag — the original "object-oriented SCADA" and a precursor to modern unified-namespace thinking.
- Nodes: Aspect servers (primary/secondary), Connectivity servers (OPC/field), Application servers, Workplaces.
- **Client types:** **Plant Explorer / Operator Workplace** (rich .NET/WPF client), **Smart Client** (office-network thin client: process graphics, trends, business graphics, history, alarm analysis — license per workplace), **Operations Client (800xA 6.2)** — **HTML5-based operator station**: zero-install browser access to PG2 process graphics + alarm/event lists, no conversion of existing graphics, multi-pane displays, integrated Object Explorer, coexistence with rich workplaces; licensed per concurrent user, max 100 per system (per catalog). Earlier web access was via Smart Client/terminal services.

### Tag & data model
- Aspect Object directory (object hierarchy of equipment + aspects); structured types/libraries (object types, aspect systems); alarm/event attached to objects; multi-system integration across 800xA systems.

### Historian
- **800xA History / Information Management**: hierarchical log structures, lossless compression, high-resolution short-term + progressive-resolution long-term storage, standard algorithms (min/max/avg/sum/sum-of-squares), Production Data Logs for batch (operator interventions, A&E, equipment usage, task times), archiving to offline storage, SoftPoints (calculated data points + alarms), report scheduling.

### Alarms
- Alarm/event services per aspect object; Alarm & Event analysis in IM; shelving/rationalization features, audit trail, alarm grouping; system messages; integrated F&G safety messages via High Integrity.

### Graphics & HMI editor
- PG2 process graphics (VB6-era lineage modernized to .NET), faceplates/element displays derived from object types; workplace layouts, multi-monitor; Operations Client renders the same PG2 graphics in browser.

### Scripting
- Control Builder M (IEC 61131-3: FBD, ST, SFC — all 5 in non-SIL apps) for AC 800M; workplace scripting via VB/A aspects; Calculation Engine + Structured Data Logger for computed/logging tasks.

### Protocols & connectivity
- OPC DA/A&E/HDA client & server (IEC 61850 integration is via IEC 61850 OPC server "Connect"), **native IEC 61850 Ed1 engineering workflow** (IET600/CCT600/PCM600 toolchain; MMS vertical + GOOSE horizontal; operation library for substation equipment), PROFIBUS/PROFINET, FF, HART, Modbus; OLE-DB real-time client connection; multisystem integration.

### Security
- Access control, re-auth/double-auth, electronic signature, FDA 21 CFR Part 11 support, audit trail, security-event logging; server node virtualization support.

### Reporting & analytics
- 800xA Information Management reports/schedules, Smart Client office analytics, PDL batch logs, asset optimization suite, SMS/email messaging option.

### Redundancy & scale
- Redundant aspect/connectivity/application servers; redundant control network; AC 800M redundancy up to Quad configs; hot-swap S880 I/O; multisystem federation; catalog shows client counts up to large installations (100 concurrent Operations Client licenses).

### Licensing
- À-la-carte part-number catalog: workplaces (Operations Client per concurrent user; Smart Client workplaces; Batch workplaces), server options, history/IM options, feature licenses (e-signature, structured data logger, OPC connections); Independent HI upgradeable to integrated HI by adding licenses.

### Standards & certifications
- **IEC 61850** integrated electrical control (major differentiator — built-in, not bolt-on); IEC 61508/61511 **SIL3 TÜV** (800xA High Integrity / AC 800M HI + SM811/SM812 coprocessor; diverse redundancy, ~99.9999% availability, embedded firewall mechanisms between control & safety); ISA-88 batch management; IEC 61131-3; 21 CFR Part 11.

### Sources
- https://new.abb.com/control-systems/system-800xa/800xa-dcs/system/aspect-object-technology-industrial-it
- https://new.abb.com/control-systems/system-800xa/electrical-control-system/ied-vs-hardwired-infographic
- https://library.e.abb.com/public/8b8cfd753a9f2137c1257dc10038a3e5/9ARD171384-600_-_en_System_800xA_6.0_IEC_61850_Engineering_Workflow.pdf
- https://library.e.abb.com/public/898c17457d403304c1257b40002e8171/3BSE038018-510_H_en_System_800xA_5.1_System_Guide_Functional_Description.pdf
- https://library.e.abb.com/public/d9fed34433dc49758c3965da8139a374/9ARD171387-510_D_en_System_800xA_IEC_61850_5.1_Connect_Configuration.pdf
- https://new.abb.com/control-systems/system-800xa/800xa-dcs/batch-control/information-management
- https://library.e.abb.com/public/f82d23807c9142e588191313327fcdc1/7PAA023920%20en%20A%20System%20800xA%20-%20Operations%20Client%E2%80%8B%20overview.pdf
- https://search.abb.com/library/Download.aspx?Action=Launch&DocumentID=7PAA010273&DocumentPartId=&DocumentRevisionId=G&LanguageCode=en
- https://new.abb.com/control-systems/safety-systems/system-800xa-high-integrity
- https://new.abb.com/control-systems/safety-systems/system-800xa-high-integrity/ac-800m-hi-controller
- https://search.abb.com/library/Download.aspx?DocumentID=3BUS095645&DocumentRevisionId=C
- https://library.e.abb.com/public/17596b52add1ff1cc12578570041e9dd/3BNP004865-510_-_en_System_800xA_Safety_5.1_AC_800M_High_Integrity_Safety_Manual.pdf

---

## 7. Omron (brief)

### Overview & positioning
- Omron is a PLC/machine-automation vendor; **it has no first-tier SCADA platform**. Two relevant offerings:
  - **CX-Supervisor** — legacy Windows-based HMI/SCADA package (CX-One suite), still sold and maintained (current v4.4.x; runs on Windows workstation OS, explicitly *not* server OS; workstation software). Developer + Runtime licensing; Machine Edition & PLUS runtime editions; USB dongle or soft activation; developer license available as 1-year subscription. VB-like script language + .NET interface. Positioned for machine-level supervision, not plant SCADA; aging architecture, no meaningful web/HTML5 story.
  - **Omron AVEVA Edge** — OEM-bundled rebranding of **AVEVA Edge** (ex-InduSoft Web Studio) with custom Omron drivers (SYSMAC Gateway/CX-Compolet integration, Tag Datalink shared memory for fast HMI updates, tag browsing, CX-Simulator offline test). "Design once, deploy anywhere" IDE; runtimes: SCADA (Windows/Server), Embedded HMI, Compact HMI (WinCE), **IoT View (Linux, incl. Raspberry Pi-class edge)**; 150+ drivers; supports web/thin clients inherited from InduSoft (Web Thin Client / SMA mobile). Sold through Omron channels, preferred pairing with NY-series industrial PCs.
- "i-Automation!" is Omron's automation concept brand (integrated/intelligent/interactive) — not a SCADA product.

### Key data points
- For Omron-centric shops, the competitive surface is effectively **AVEVA Edge tech** (InduSoft lineage): Windows runtime + web thin clients, not a modern pure-web architecture.
- CX-Supervisor remains a supported product but is clearly legacy-positioned.

### Sources
- https://automation.omron.com/en/us/products/family/cx%20supervisor
- https://industrial.omron.eu/en/products/cx-supervisor
- https://automation.omron.com/en/us/blog/aveva-scada-software-application
- https://automation.omron.com/en/us/products/family/Omron%20AVEVA
- https://assets.omron.com/m/41362efbfd4f7a68/original/Brochure_Aveva-Edge_202106_r1.pdf
- https://www.myomron.com/index.php?action=kb&article=130
- https://industrial-software.com/wp-content/uploads/AVEVA_Edge_HMI/2020_r2_sp1/ReadMe.html

---

## Cross-Platform Takeaways (for a web-based SCADA product)

| Platform | Web/HTML5 client tech | Read/write in browser? | Notable gap or strength |
|---|---|---|---|
| ICONICS GENESIS64 | HTML5 publish → IIS WebHMI server; per-session server-side AnyGlass instance | Yes (write-capable, auth-controlled) | Strong: real HTML5 parity, BACnet B-AWS. Weak: Windows/IIS-bound stack, session-per-server-instance scaling model |
| zenon | WVS (native HTML5 thin client in Service Engine) + HTML Web Engine | Yes | Strong: multi-session WVS, energy depth. Weak: web client feature matrix still trails native client (some screen types) |
| Experion PKS | eServer — DHTML/HMIWeb displays in browser | **No — read-only** | Weak: no modern HTML5 operator client; eServer is view-only, alarms hidden |
| DeltaV | DeltaV Live = HTML5-native HMI; Enterprise View = browser app on Edge Node | HMI yes (operator stations); Enterprise View **read-only** | Strong: true HTML5 authoring stack + TypeScript; enterprise web view read-only via Edge (secure-by-design) |
| FAST/TOOLS | Pure HTML5 client from server-centric Java arch | Yes (full-control web clients; mobile reduced scope) | Strong: web-native since 2010, quad redundancy; Weak: rich client still Java-based |
| 800xA | Operations Client = HTML5 PG2 in browser | Yes (operator functions) | Strong: zero-conversion reuse of PG2 graphics; limit 100 concurrent per catalog |
| Ovation 4.0 | Ovation View HMI supports HTML5 web apps | Partial (new) | Newest entrant; details maturing |
| Omron | AVEVA Edge web thin client (InduSoft) | Partial | No first-party modern SCADA |

**Patterns worth noting:**
1. **Read-only enterprise web tier** is the industry-standard compromise: Experion eServer, DeltaV Live Enterprise View, and 800xA Smart Client all segment casual web users from control. A product offering *safe* write-capable web operation (with scoped permissions) is still a differentiator.
2. **Server-side session/instance models** (ICONICS AnyGlass, zenon WVS multi-session, FAST/TOOLS server-centric) dominate — displays authored once, rendered server-side or transformed to HTML5, streamed to browser. Nobody rewrites projects for web.
3. **Licensing trend**: per-concurrent-user subscriptions for web clients (DeltaV Enterprise View, 800xA Operations Client, ICONICS floating CALs, zenon client licenses) + term-based bundles (DeltaV Flex, CX-Supervisor dev subscription).
4. **Certifications that sell**: BACnet BTL B-AWS (ICONICS), ISASecure SSA/CSA IEC 62443 (Emerson, Yokogawa, Honeywell SIS), IEC 61850 depth (zenon, ABB), ISA-18.2/IEC 62682 alarm tooling (all majors), ISA-88 (DeltaV native, zenon + 800xA modules).


---

# Part IV — Web-native & open-source SCADA

# Web-Native & Open-Source SCADA/HMI Platforms — In-Depth Research Report

*Compiled from 17 web searches + official docs/GitHub fetches. All sources cited per section.*

---

## 1. FUXA — the closest open-source analog to a self-built web SCADA

**Overview.** FUXA (frangoteam, Italy) is a fully web-based SCADA/HMI/dashboard platform — build, engineer, and run entirely in the browser. It is the most architecturally similar product to a React + Node/edge-bridge design: pure web technology (HTML5, CSS, JS, SVG), REST API + websocket (Socket.IO) communication.

**Architecture & tech stack.** Node.js backend + Angular frontend. Server exposes two UIs: `/home` (runtime visualization) and `/editor` (engineering). Serves on port 1881 by default. Data model: JSON project stored in SQLite; live values pushed over websockets. Available as npm package (`@frangoteam/fuxa`, v1.3.x, ~1.1k weekly downloads), Docker image, and self-contained headless binaries for Windows/macOS/Linux/ARM (incl. Raspberry Pi); Electron used for kiosk-style touchscreen HMIs.

**Editor & graphics.** Drag-and-drop WYSIWYG SVG editor: pre-defined widgets (gauges, charts, switches, tables, pipe animations), custom SVG shapes, multi-view layouts, event actions, recipes, schedulers, webcam/GPIO widgets.

**Protocols.** Modbus RTU/TCP, Siemens S7 (node-snap7; S7-200/300/400/1200/1500), OPC UA (client), BACnet IP, MQTT, EtherNet/IP (Allen-Bradley), ADS (Beckhoff), MC Protocol/SLMP (Mitsubishi MELSEC), WebAPI (REST), ODBC, Redis, GPIO (Raspberry Pi), plus raw serial/TCP for custom protocols. Node-RED integration via `node-red-contrib-fuxa` extends connectivity further.

**Alarms.** Tag-bound thresholds with 4 levels (High-High, High, Low, Message); actions per alarm (popup dialogs, write a value to a tag); active-alarm list and alarm history views. Acknowledgement exists but the model is basic — no ISA-18.2-style shelving/rationalization.

**Historian.** Built-in DAQ engine logging to **SQLite or InfluxDB**; ODBC and Redis for external integration; chart/trend controls.

**Security & auth.** Opt-in (`secureEnabled: false` by default!). JWT auth (`x-access-token`), bcrypt-hashed users in SQLite, RBAC via groups/roles, API keys, refresh cookies. Default `admin/123456`. **Notable caveat:** several 2024–2025 security advisories — e.g. GHSA-c5gq-4h56-4mmx (unauthenticated disclosure of plaintext InfluxDB credentials, fixed 1.2.10) and PR #2379 hardening JWT lifecycle and Socket.IO admin ops. Security posture is improving but immature vs commercial OT products.

**Scripting/extensibility.** Server-side JS scripts, scheduled events; custom drivers can be developed; REST API documented via OpenAPI (`server/docs/openapi.yaml`).

**License.** MIT — genuinely free, no runtime licensing.

**Maturity/community.** ~5.2k stars, 1.4k forks, ~2,955 commits, ~325 open issues, active development (releases through 2025). The most-starred open-source web SCADA.

**Limitations.** Auth off by default + history of CVEs; no redundancy/hot-standby; OPC UA client only (not server); basic alarm model; no audit trail, e-signatures, or AD/LDAP; documentation uneven; small maintainer team.

Sources: [GitHub](https://github.com/frangoteam/FUXA), [frangoteam.org](https://frangoteam.org/), [docs](https://frangoteam.github.io/FUXA/), [npm](https://www.npmjs.com/package/@frangoteam/fuxa), [alarms doc](https://frangoteam.github.io/FUXA/HowTo-setup-Alarms/), [security settings](https://frangoteam.github.io/FUXA/Settings/), [advisory GHSA-c5gq](https://github.com/frangoteam/FUXA/security/advisories/GHSA-c5gq-4h56-4mmx), [DeepWiki auth](https://deepwiki.com/frangoteam/FUXA/5.4-authentication-and-security)

---

## 2. ScadaBR — Java/Tomcat web SCADA (Mango M2M derivative)

**Overview.** Brazilian open-source SCADA (funded initially by FINEP/SEBRAE/CNPq ~2006), forked from the last open-source release of Mango M2M. Full traditional SCADA feature set run from a browser; deployed in production including CASAN (Santa Catarina water utility).

**Architecture.** Java 8 / OpenJDK 8 on Apache Tomcat (default). Everything — data sources, point config, HMI screens — administered in the browser (older Dojo-era JS UI).

**Protocols.** 20–30+ data source types: Modbus TCP/RTU/RTU-over-TCP, MQTT, DNP3 (IP & serial), BACnet IP, OPC, HTTP retriever, SQL, IEC 101 serial, M-Bus, ASCII serial/file, 1-wire, SNMP, JMX, plus internal/meta/virtual data sources.

**Features.** Synoptic/graphical views built in-browser, alarm & event engine (incl. audible alarms), sound alarms, user profiles/permissions, scheduled events, reports, scripting engine for control/automation/batches, API examples in Java/VB/PHP/Python.

**License/activity.** GPLv3. **ScadaBR 1.2 CE (2021) is the last release — essentially maintenance-frozen.** The international continuation is **Scada-LTS** (github.com/SCADA-LTS/Scada-LTS, GPLv2, ~1k stars, active — v2.8.0 released Oct 2025 with XSS fixes, OPC UA via Apache PLC4X, new Vue-based UI and REST API). ScadaBR plans a 2.x series on the Scada-LTS core. Docker install available for LTS.

**Limitations.** Aging stack (Java 8, Tomcat 9, dated UI); ScadaBR proper largely dormant; Scada-LTS still carries Mango-era architecture and is closing old security holes (recent releases include many XSS fixes).

Sources: [scadabr.org](https://scadabr.org/), [scadabr.com.br](https://www.scadabr.com.br/), [GitHub ScadaBR](https://github.com/ScadaBR/ScadaBR), [Scada-LTS releases](https://github.com/SCADA-LTS/Scada-LTS/releases), [protocol list PDF](https://celsoautomacao.com.br/curso-scadabr/uploads/Protocolos%20ScadaBR%201.2.pdf)

---

## 3. Rapid SCADA — open-source .NET SCADA with webstation

**Overview.** Open-source industrial automation platform (C#/.NET, Apache 2.0), mature (roots ~2006, current major version 6 on .NET 8). Marketed as a core for custom SCADA/MES builds. Free Community edition has **no tag limit and no expiry**; revenue comes from paid modules/editions and services.

**Architecture.** Multi-tier, TCP-based internal app protocol: **Communicator** (polls devices via driver DLLs) → **Server** (archives, math/logic modules, serves clients) → **Webstation** (ASP.NET Core web app — tables, schemes/diagrams, charts, reports) + Windows **Administrator** tool for project configuration. Server instances can exchange data for redundancy; distributed deployment across hosts supported.

**Protocols/modules.** Built-in/community drivers: Modbus RTU/ASCII/TCP, OPC DA/AE/UA, MQTT, SNMP, SMTP, M-Bus, Telegram notifications; logic modules (Automatic Control), web plugins (Chart Pro), Rapid Gate for syncing instances. Module types: communication drivers, Server logic modules, Webstation plugins, Administrator extensions — all C# DLLs; documented Web API.

**License/pricing.** Apache 2.0 core. Paid extras in Module Store (Telegram driver $49, Automatic Control $95, Modbus Slave $280); editions: Embedded $95, Standard $490–$920 by channel count.

**Limitations.** Engineering requires the Windows Admin tool — the web app is runtime-only, not a web-based editor like FUXA. Scheme editor produces functional but plainer graphics. Ecosystem/modules much smaller than commercial.

Sources: [architecture docs](https://rapidscada.net/docs/en/latest/software-overview/architecture), [dev basics](https://rapidscada.net/docs/en/latest/developers/development-basics), [GitHub scada-v6](https://github.com/RapidScada/scada-v6), [store](https://rapidscada.net/store/en), [rapidscada.org](https://rapidscada.org/)

---

## 4. OpenSCADA / Eclipse SCADA — status check

**Eclipse SCADA → NeoSCADA: dead.** Originated from openSCADA (cetera GmbH/IBH). Became Eclipse top-level project 2014, renamed NeoSCADA Nov 2015. Last release 0.5.0 (April 2018); **formally terminated/archived March 2021**. The PMC archiving proposal notes it was "still being used in production by some companies" but had zero upstream activity. Do not adopt.

**Eclipse SCADA ≠ OpenSCADA (oscada.org).** A separate, unrelated **OpenSCADA** project by Roman Savochenko (Ukraine, GPL v2, C++/Qt with web UI) is still maintained — 0.9 LTS updates shipped 2025–2026 — but it's a one-developer project with niche Eastern-European adoption, unusual release versioning, and commercial support packages.

Sources: [Eclipse metrics (archived)](https://metrics.eclipse.org/projects/iot.eclipsescada/), [project governance](https://projects.eclipse.org/projects/iot.eclipsescada/governance), [archiving proposal](https://www.eclipse.org/lists/iot-pmc/msg06720.html), [oscada.org](http://oscada.org/)

---

## 5. Node-RED + Dashboard as industrial HMI

**Overview.** Node-RED (Node.js, browser-based flow editor, Apache 2.0) is the de-facto IoT glue tool; with dashboard packages it functions as a lightweight HMI/SCADA-lite.

**Dashboard options.** `node-red-dashboard` (Dashboard 1.0, AngularJS, served `/ui`) — **deprecated 27 June 2024**. Successor: **Dashboard 2.0** (`@flowfuse/node-red-dashboard`, Vue, `/dashboard`). Alternatives: `ui-builder`, community SCADA kits like `node-red-dashboard-2-scada-kit` (ISA-101 symbols, equipment faceplates with write-confirmation, server-side RBAC, ISA-18.2-style alarm helpers).

**Industrial protocol nodes.** `node-red-contrib-modbus`, `node-red-contrib-opcua`, S7 nodes, built-in MQTT, thousands of community nodes on flows.nodered.org.

**Real industrial usage.** **Opto 22 ships Node-RED preinstalled on groov EPIC controllers and groov RIO edge I/O** (alongside groov View HMI, Ignition Edge, MQTT/Sparkplug, CODESYS). **Siemens ships Node-RED on SIMATIC IoT2050**. FlowFuse provides commercial fleet management for production Node-RED.

**Security posture criticism.** Historically `adminAuth` unset by default → many exposed instances; Node-RED 4.0 now forces an explicit auth choice. Siemens advisory SSA-834709: missing Node-RED auth on IoT2050 → unauthenticated flow creation → RCE. Academic work (Chalmers, USENIX SandTrap) documents malicious-node/flow risks inherent to its JS extensibility.

**Limitations as SCADA.** No native tag/namespace model, no historian or alarm system out of the box, form-style dashboard rather than a mimic/synoptic editor, per-flow logic sprawl, no audit trail or multi-operator auth model.

Sources: [FlowFuse OPC UA dashboard](https://flowfuse.com/blog/2023/07/how-to-build-a-opc-client-dashboard-in-node-red/), [EDWartens PLC dashboard](https://edwartens.com/blog/node-red-plc-dashboard-video), [SCADA kit](https://github.com/jsgorana/node-red-dashboard-2-scada-kit), [Opto22 Node-RED](https://www.opto22.com/products/groov-epic-system/groov-epic-software/node-red), [Siemens advisory](https://cert-portal.siemens.com/productcert/html/ssa-834709.html), [security-by-default RFC](https://github.com/node-red/designs/discussions/81)

---

## 6. Grafana as SCADA-adjacent

**Overview.** Grafana (AGPLv3 core + paid Enterprise) is the dominant industrial *visualization* layer, but a **"Layer 1" historian client** — it renders data someone else collected; it has no field-protocol drivers.

**Typical factory stack.** Telegraf or Node-RED → MQTT broker / InfluxDB / TimescaleDB → Grafana. Examples: **Varland Plating** (Opto22 PLCs → InfluxDB/MQTT → Grafana, GrafanaCon talk); **UMH** (United Manufacturing Hub open-source IT/OT platform: MQTT+Kafka Unified Namespace, TimescaleDB + Grafana).

**What it lacks for SCADA.** No control writes/setpoints, no alarm acknowledgement workflow (alerting exists — rules → email/Slack/webhook — but no ISA-18.2 operator alarm lifecycle), no proper HMI mimic editor (Canvas panel, SVG plugins are partial), no per-tag security or OT audit trail. The official-ish OPC UA datasource was **deprecated/EOL mid-2024**; remaining options are paid marketplace plugins or indirect ingestion via Telegraf/Node-RED.

**Ecosystem.** Huge plugin marketplace; Enterprise adds SAML/RBAC/reporting. Best practice framing: use it *alongside* a SCADA as the analytics/trend layer, not instead of one.

Sources: [scadaprotocols.com tool comparison](https://scadaprotocols.com/industrial-dashboard-software/), [Grafana community thread](https://community.grafana.com/t/scada-visualization/1927/2), [Varland Plating](https://grafana.com/events/grafanacon/2022/varland-plating-modernizes-industrial-iot-visualization-use-case/), [UMH/Grafana](https://grafana.com/blog/industrial-iot-visualization-how-grafana-powers-industrial-automation-and-iiot/), [tiering guide](https://industrialmonitordirect.com/blogs/knowledgebase/selecting-the-right-monitoring-architecture-from-grafana-to-scada)

---

## 7. ThingsBoard — IoT platform increasingly positioned as SCADA-lite

**Overview.** Java/Spring + Angular IoT platform (telemetry, rule engine, dashboards). Since v3.8 (Oct 2024) it has explicit **SCADA dashboards** — SVG-based "SCADA symbols" (valves, pumps, motors, tanks, pipes) scalable to any screen, custom symbol upload; v3.9 added high-performance/HP-HMI neutral-color symbols + "Get alarm status" symbol actions; v4.0 added Oil&Gas and Energy SCADA solution templates.

**Architecture.** Multi-tenant server; telemetry via MQTT/HTTP/CoAP transports; **IoT Gateway** (separate app) bridges OPC UA, Modbus, BACnet, MQTT, CAN, SNMP, etc.; **ThingsBoard Edge** for store-and-forward remote sites; **Rule Engine** visual processing chains; alarms subsystem; Trendz analytics add-on.

**License — important recent change.** Was Apache-2.0 Community Edition + proprietary Professional Edition. **From v4.4: unified single product under Business Source License 1.1** (source-available, *not* open source; each release converts to Apache 2.0 after 4 years). Free use: ≤100 devices commercial / ≤1,000 devices non-commercial, with ThingsBoard branding; pre-4.4 CE stays Apache 2.0 forever. Paid: subscription from ~$99/mo, perpetual from $4,999; Cloud plans $0–$749/mo.

**Limits for plant-floor SCADA.** Device/asset-centric data model rather than tag+mimic SCADA model; PLC connectivity requires the Gateway (extra hop, latency); alarming is notification-oriented (no ISA-18.2 rationalization); display is dashboard-grid based, not a free-form synoptic editor; white-labeling paid.

Sources: [3.8 SCADA release](https://thingsboard.io/blog/thingsboard-3-8-0-release/), [3.9 HP-HMI](https://thingsboard.io/blog/thingsboard-3-9-0-release/), [4.0 release](https://thingsboard.io/blog/thingsboard-4-0-release/), [re-licensing blog](https://thingsboard.io/blog/one-thingsboard-source-available/), [pricing](https://thingsboard.io/pricing/), [PE](https://thingsboard.io/products/thingsboard-pe/)

---

## 8. Tatsoft FrameworX — commercial .NET platform, web + .NET clients

**Overview.** Unified SCADA/HMI/MES/IIoT platform (Austin, TX; 30+ yrs industrial DNA; positioned as Ignition competitor). Dual runtime: **.NET Framework 4.8 (Windows) and .NET 8 (Linux/Docker/edge)**. Editions: **Enterprise** (UNS orchestrator), **MachineHMI**, **EdgeConnect** (Gateway / View). Distributed servers: DataHub Station, Displays Portal.

**Clients & graphics.** One engineering environment produces displays for **.NET Smart Client, web, and HTML5** clients; dashboard builder with trend charts, gauges, grids, symbols.

**Protocols.** **100+ connectors / 70+ native drivers**: OPC UA client+server, OPC HDA, Modbus, Siemens S7, Allen-Bradley EtherNet/IP, **MQTT (client + built-in broker) + Sparkplug B native**, BACnet, DNP3 master/slave, IEC 61850, SNMP, WITSML, CODESYS; TLS/SSL; auto tag browsing, TagProviders auto-discover tags from MQTT/OPC UA; driver toolkit SDK.

**Historian.** Built-in SQL historian **plus OEM partnership with Canary Labs**: embedded Canary Historian pre-integrated at .NET API level, 500 tags included, store-and-forward edge collectors — any of the 70+ drivers can feed Canary directly (Windows-only integration).

**Scripting.** C#, VB.NET, Python 3; SQL datasets & reports.

**Pricing (published).** EdgeConnect $750–$1,700; MachineHMI $900–$4,000 (150–4,500 I/O, 5 clients); Enterprise $4,500–$11,900 (1,500→unlimited I/O, **unlimited clients**); DataHub Station $3,900; Displays Portal $7,900. All editions include all features — pricing scales by deployment role/I-O, not functionality.

Sources: [pricing](https://tatsoft.com/pricing-101/), [editions doc](https://docs.tatsoft.com/display/FX/Product+Editions), [connectivity hub](https://tatsoft.com/connectivity-hub/), [architecture](https://docs.tatsoft.com/display/FX/Platform+Architecture+Reference), [Canary partnership](https://tatsoft.com/tatsoft-and-canary-labs/), [Canary connector docs](https://docs.tatsoft.com/display/FX/Canary+Historian+Connector)

---

## 9. Advantech WebAccess/SCADA

**Overview.** Commercial **100% web-based** SCADA — both *engineering and runtime* happen in a browser (a claim most competitors can't make; e.g., Rapid SCADA still needs a Windows config tool). IIS-based; tightly integrated with Advantech hardware and WISE-PaaS cloud.

**Architecture.** Project Node (engineering platform + web server, stores project DB/graphics), SCADA/Data Node (runtime engine with drivers, alarms, history), clients via browser; VisualSuite/EdgeView graphics builder; Dashboard 2.0 HTML5 + Widget Builder; gateway mode publishes via MQTT to WISE-PaaS (Dashboard, SaaS Composer, AFS AI).

**Protocols.** **450+ controllers/devices** via driver list (Advantech ADAM/APAX/WISE, all major PLC brands, CNCs, network switches); standard protocols: Modbus, OPC UA, OPC DA, EtherNet/IP, DNP3, SNMP, BACnet. Integration via RESTful API + SignalR + WebAccess APIs.

**Features.** Alarms, historian w/ database restore modes, scheduled/Excel reports, **LDAP integration + operation audit logs (v10)**, online license authentication, MES/ERP integration.

**Position/limits.** Established, hardware-bundled; strong in Asia/building automation; dated in parts (IIS/.NET Framework heritage); license is tag-count based, commercial.

Sources: [product page](https://www.advantech.com/en/products/webaccess-scada/sub_a7b4308c-a3d0-446c-8f03-0d098d4b2c31), [V9 datasheet](https://advdownload.advantech.com/productfile/PIS/WebAccess/SCADA/file/WebAccess_SCADA_DS(032625)20250326103348.pdf), [V10 datasheet](https://advdownload.advantech.com/productfile/PIS/WebAccess/SCADA%20V10/file/WebAccess_SCADA_DS(070326)20260707131318.pdf), [driver list](https://advdownload.advantech.com/productfile/Downloadfile5/1-2ML6952/WebAccess%20Driver%20List%20&%20Connectivity_V18_20240820.pdf)

---

## 10. atvise — OPC UA–native pure-web HMI/SCADA

**Overview.** Developed since 2006 by Certec EDV (Eisenstadt, Austria) — **first professional SCADA built on pure web standards**; acquired by Bachmann electronic 2012 → now Bachmann Visutec (distributed/partnered with Vester Business). **100,000+ installations**; strong in energy/infrastructure (Bachmann wind turbines, Dubai Mall parking since 2007, maritime via openBridge template). Basis of Bachmann M1 WebMI pro embedded visu.

**Architecture.** HTML5/CSS3/SVG + JavaScript visualization — any browser is a client, zero install/licensing per client. **OPC UA in the core**: both client AND server for DA, Alarms & Conditions, Historical Access, Methods — enables vertical/distributed architectures where alarms+history propagate losslessly. Object-oriented "vertical engineering"; multi-user engineering; builder is itself an OPC UA client.

**Protocols.** OPC UA native; **atvise connect X** adds Modbus TCP, KNX, BACnet, MQTT, Siemens S7 (Step7/TIA), Rockwell/EtherNet-IP, SNMP; ODBC databases; web services via http.

**Alarms/historian.** High-level alarming: shelving, suppression, deactivation, nestable hierarchies; event archives. Archiving: parameterizable ring buffers + **40+ aggregation functions** (OPC UA aggregates); automatic PDF reporting.

**Security.** Fine-grained permissions on OPC UA rights model; passed an independent penetration/vulnerability test (2022); **hot-standby redundancy** since 2015 (claims first web-native hot standby); license server (2025) for dynamic/container licensing. Server-side scripting engine for processing.

**Limits.** Commercial, quote-based licensing; OPC UA-centric (non-UA drivers via connect add-on); smaller brand recognition than incumbents.

Sources: [atvise SCADA](https://www.atvise.com/en/products/atvise-scada), [native web tech](https://www.atvise.com/en/products/native-web-technology), [feature overview](https://www.atvise.com/en/products/atvise-overview), [OPC UA core](https://www.atvise.com/en/products/opc-ua-in-the-core), [history/acquisition](https://www.automation.com/article/bachmann-electronic-acquires-certec), [20-year retrospective](https://industrialmachinerydigest.com/software/control-systems/two-decades-of-hmi-and-scada-with-atvise)

---

## 11. SpiderControl (iniNet Solutions, Switzerland) — PLC-embedded web HMI

**Overview.** Niche but architecturally unique: the **HMI is served by a web server running on the PLC itself**; the same HTML5 visu scales from a 50 kB-flash single-chip to a PC-based SCADA (>100 PLCs, 100k variables). Widely used as an **OEM framework licensed by PLC/panel/drive manufacturers**.

**Architecture.** Components: PC **HMI Editor** (v9, builds SPA-architecture HTML5 apps, no JS programming needed), **embedded web server/dataserver** on the controller, **MicroBrowser** runtime for panels, OEM mobile apps, SCADA server variant that aggregates multiple PLCs. Networked "Spider PLC" even allows browser-based embedded logic programming with C/C++/IEC-61131 external calls.

**PLC integrations.** Beckhoff (ADS/OPC UA), Phoenix Contact (incl. WebVisit applet → HTML5 *conversion tool* — solves the legacy Java-applet problem), CODESYS runtimes, KW Multiprog, infoteam OpenPCS, ISaGRAF, Bosch ctrlX, Wago PFC; trends and alarms stored on the PLC.

**License/position.** Commercial, OEM/royalty licensing; custom development services. Relevant as proof the "web server on the edge device + HTML5 editor" model works industrially.

Sources: [HMI editor](https://spidercontrol.net/spidercontrol-products/a-design-tool-hmi-editor/?lang=en), [web-HMI on PLC](https://spidercontrol.net/spidercontrol-products/easy-web-hmi-directly-on-the-sps/?lang=en), [OEM/custom](https://spidercontrol.net/spidercontrol-products/custom-development/?lang=en), [web engineering](https://spidercontrol.net/spidercontrol-products/web-engineering-neu/?lang=en)

---

## 12. OAS — Open Automation Software

**Overview.** US vendor (Lakewood, CO; est. 1993), .NET IIoT platform. More **developer toolkit / connectivity layer** than turnkey HMI designer — its core is the **Universal Data Connector** (Windows service / container) that moves data between PLCs, databases, apps, and IoT hubs.

**Web HMI.** Lightweight JS SDK — add one JS file, bind live data to any HTML element via attribute markup; works with vanilla JS, ASP.NET, React, Angular, Vue; cross-browser, no plugins. For thick clients: WPF/WinForms Trend .NET and Alarm .NET controls.

**Connectivity.** OPC UA + OPC DA (client & server), Allen-Bradley, Siemens, Modbus, MTConnect, MQTT, AWS/Azure/Google IoT hubs, Kafka, databases; REST API (data + config), .NET Data Connector (.NET Standard — Windows/Linux/Mac/iOS/Android), **free Universal Driver Interface SDK to write unlimited custom drivers** in C#/VB.NET.

**Alarms/historian.** Alarm engine with email/SMS/voice notification; logging to open databases; transforms on each tag.

**Licensing.** Per-server perpetual, tag-count based ("flex tags" distributable across servers), unlimited clients free. Entry from ~$495; typical examples $935–$1,188+; 30-day full demo; optional annual maintenance.

**Limits.** Not a SCADA-in-a-box — you build the UI yourself (which is actually *adjacent* to a self-built React approach); weaker on mimic editors, reporting, ISA-18.2 vs dedicated SCADA.

Sources: [Web HMI](https://openautomationsoftware.com/web-hmi/), [Universal Data Connector](https://openautomationsoftware.com/products/communications/universal-data-connector/), [.NET connector](https://openautomationsoftware.com/products/hmi-scada-for-net/net-iot-data-connector/), [dev tools](https://openautomationsoftware.com/products/developer-tools-apis/), [pricing](https://openautomationsoftware.com/products/pricing/)

---

## What open-source/web SCADA typically LACKS vs commercial

1. **Vendor support & accountability.** No SLA, no paid support escalation, no liability. Community projects can stall (NeoSCADA died 2021; ScadaBR froze at 1.2 in 2021).
2. **Certifications & compliance.** Commercial platforms invest in OPC Foundation certification, IEC 62443-4-1/-4-2 secure development, FDA 21 CFR Part 11 / GxP audit trails & e-signatures, NERC CIP reporting. Open-source tools rarely hold these; e.g., FUXA ships with auth *off* by default and has had credential-disclosure CVEs; Node-RED's default-insecure posture spawned Siemens advisories and academic critiques.
3. **Redundancy / hot-standby.** Hot-standby server pairs are standard in commercial SCADA; atvise built its reputation partly on first web-native hot standby (2015), Rapid SCADA has Server-to-Server redundancy — but FUXA, Grafana, Node-RED, ThingsBoard CE have no true hot failover. Store-and-forward and device redundancy are likewise rare in OSS.
4. **Driver breadth & maintenance.** Commercial: 70+ (Tatsoft) to 450+ (WebAccess) maintained drivers incl. DNP3, IEC 61850, S7, EtherNet/IP with conformance testing. OSS typically covers Modbus/OPC UA/MQTT + a few; protocol edge cases (slave modes, redundancy, timed writes) often missing or paid (Rapid SCADA charges for Modbus Slave).
5. **Alarm management depth.** ISA-18.2/IEC 62682 workflows — shelving, suppression, out-of-service, rationalization reports, KPI analysis — appear in atvise/commercial; OSS alarms are basic thresholds + lists.
6. **Reporting.** Scheduled/PDF/regulatory reports with templates (atvise, WebAccess Excel reports) vs "chart on a dashboard" in OSS.
7. **Enterprise security features.** AD/LDAP/SSO, granular audit trails, signed updates, hardened defaults, patch cadence. WebAccess v10 added LDAP + audit logs specifically for enterprise governance.
8. **Historian scale.** Purpose-built time-series stores (Canary embedded in FrameworX, atvise aggregates) vs SQLite/basic InfluxDB logging; compression, millions of tags, backfill, store-and-forward.
9. **Engineering productivity.** Object/template libraries, bulk tag import, version control, multi-user engineering, simulation, structured change management — most OSS offer a single flat editor. (Ironically, Advantech proves 100% web-based engineering is possible commercially.)
10. **Lifecycle guarantees.** LTS releases, security patching commitments, migration tooling — ThingsBoard's BSL relicensing and node-red-dashboard deprecation show OSS/supplier churn risk on both axes.
11. **"Web" is often partial.** Many "web SCADA" products (Rapid SCADA, classic WinCC WebNavigator lineage) keep Windows-only engineering; truly browser-side engineering exists in FUXA, WebAccess, SpiderControl Spider PLC — a differentiator the self-built React approach shares.

Sources for this section: [Opto22 open-source/SCADA podcast](https://blog.opto22.com/optoblog/a-discussion-of-open-source-software-and-scada), [SpecForge SCADA encyclopedia](https://www.sourcebyspec.com/encyclopedia/scada-software.html), [Powerfabric redundancy guide](https://powerfabric.org/knowledge/scada-redundancy-and-failover), [Powerfabric SCADA comparison](https://powerfabric.org/knowledge/scada-software-comparison)


---

# Part V — Standards landscape

# Standards Landscape for Industrial SCADA/HMI Software — Competitive Analysis

*Research compiled October 2026. Each entry: ID & full name → What it covers → Concrete implications for SCADA software features → Vendors claiming compliance → Sources.*

**Legend for relevance to a new web-based SCADA product:** 🔴 = must-have for credibility in most industrial deals · 🟡 = vertical/differentiator (needed for specific markets) · ⚪ = awareness/indirect.

---

## 1. IEC 62443 series — Industrial Automation & Control Systems (IACS) Cybersecurity 🔴

**Full name:** IEC 62443 / ISA-62443, "Security for industrial automation and control systems." Developed jointly by the ISA99 committee and IEC TC 65/WG 10. Recognized by IEC as a *horizontal standard* (applies across all industries).

### What it covers — series structure

| Part | Title | Who it addresses |
|---|---|---|
| 1-1 | Terminology, concepts and models (TS, 2009) | All roles — defines zones, conduits, foundational requirements, security levels |
| 1-5 | Scheme for IEC 62443 security profiles (TS, 2023) | Standards bodies / profile authors |
| 2-1 | Security program requirements for IACS asset owners (Ed.2, 2024) | Plant operators — organizational security program |
| 2-2 | IACS security protection scheme (PAS/TR, 2025) | Asset owners, assessors |
| 2-3 | Patch management in the IACS environment (TR, 2015) | Asset owners + vendors |
| 2-4 | Security program requirements for IACS service providers (Ed.2, 2023) | **System integrators / maintenance providers** |
| 3-2 | Security risk assessment for system design (2020) | Asset owners + integrators — zone/conduit partitioning, SL-T assignment |
| 3-3 | System security requirements and security levels (2013) | **The product/system spec** — technical SRs/REs mapped to SL1–SL4 |
| 4-1 | Secure product development lifecycle requirements (2018) | **Software/product vendors** — SDL process |
| 4-2 | Technical security requirements for IACS components (2019) | **Product vendors** — component-level technical reqs (CRs) |
| 6-1, 6-2 | Security evaluation methodologies (TS, 2024/2025) | Certification bodies |

### Core model

- **Seven Foundational Requirements (FRs):** FR1 Identification & Authentication Control (IAC); FR2 Use Control (UC); FR3 System Integrity (SI); FR4 Data Confidentiality (DC); FR5 Restricted Data Flow (RDF); FR6 Timely Response to Events (TRE); FR7 Resource Availability (RA).
- **Zones & conduits:** assets grouped into zones with common security requirements; all inter-zone traffic flows through defined conduits (defense-in-depth, Purdue-model-aligned segmentation).
- **Security levels** (defined against attacker capability):
  - **SL1** — protection against casual/coincidental violation (no attack skills, mistakes, non-intentional).
  - **SL2** — intentional violation using *simple means*, low resources, generic skills, isolated individual (e.g., cybercrime, hacker).
  - **SL3** — *sophisticated means* with moderate resources, IACS-specific skills, coordinated group (hacktivist/terrorist).
  - **SL4** — sophisticated means with *extended resources* — nation-state, multi-disciplinary teams.
  - (SL0 = no protection needed; informal baseline.) Three flavors: SL-T (target, from 3-2 risk assessment), SL-C (capability of component/system), SL-A (achieved).
- **62443-3-3** contains ~130 system requirements (SRs) + requirement enhancements (REs) across the 7 FRs (e.g., FR1: 13 SR + 11 RE; FR2: 12+12; FR3: 9+10; FR4: 3+3; FR5: 4+7; FR6: 2+1; FR7: 8+5). Each RE bumps the achievable SL.
- **62443-4-2** reuses the same FR structure as Component Requirements (CRs), plus four component-type profiles: **SAR** (software application — the relevant one for a web SCADA), **EDR** (embedded device), **HDR** (host device), **NDR** (network device).

### What SL2 / SL3 concretely demand from a SCADA product

- **FR1 (IAC):** unique user identification & authentication; at SL2+ — multifactor for untrusted networks, authenticator management, Linux/AD-independent account options; SL3 — authentication of software processes/devices, MFA for all human users.
- **FR2 (Use control):** granular RBAC mapped to roles, not users; authorization enforcement for all users incl. remote; wireless/mobile use control; session locking and auditable permission elevation.
- **FR3 (System integrity):** communication integrity (TLS), protection from malicious code, input validation, signed/verified updates, session integrity.
- **FR4 (Confidentiality):** encryption of data in transit and at rest where required; confidentiality of credentials (never plaintext).
- **FR5 (Restricted data flow):** support for zone/conduit deployment — network segmentation, controllable ports/protocols (documented port list!), DMZ-friendly architecture, no hard-coded outbound calls.
- **FR6 (TRE):** **audit log generation** — timestamped, non-repudiable records of operator actions, logins, config changes; audit records that can't be edited by normal users; alerting on audit failure.
- **FR7 (Resource availability):** redundancy/failover support, backup & restore of project config, denial-of-service resilience, controlled recovery.

**Key procurement reality:** Most end-user RFQs demand **SL2** for the SCADA component; critical infrastructure and oil & gas increasingly demand SL3 capability. Certification is against a *profile* (e.g., "100% SL2").

### Certification schemes

- **ISASecure** (ISA's conformance arm; ISO/IEC 17065-accredited CBs incl. **exida, TÜV SÜD, CSSC, Bureau Veritas**):
  - **CSA** (Component Security Assurance) → certifies to 62443-4-2 — the product-level cert most relevant to a SCADA vendor.
  - **EDSA** — legacy embedded-device scheme (replaced by CSA, Aug 2019); still on older certs.
  - **SSA** → 62443-3-3 system-level. **SDLA** → 62443-4-1 development-process cert.
  - **ICSA** (IIoT components), **HCSA** (high-criticality), **ACSSA** (site/system per 2-1, 2-4, 3-2, 3-3).
- **IECEE** Industrial Cyber Security Programme (OD-2061) — IEC's own conformity-assessment route.
- Certified products today are mostly controllers/DCS/SIS (ABB AC 800M, Yokogawa CENTUM VP & ProSafe-RS, Schneider FCP280/Triconex TCM, Hitachi, Toshiba, Azbil, Honeywell Safety Manager).

### Vendors claiming compliance

- **Siemens/ETM WinCC OA** — published certificates: IEC 62443-4-1 SDLC + 62443-4-2 (Full ML3 process profile, 100% SL2 component requirements); public mapping of FR→product features in its Security Guideline.
- **COPA-DATA zenon** — IEC 62443-4-1 certified development lifecycle; markets SL-ready features (AD/LDAP integration, 128-bit encrypted comms, signed projects, change history).
- **AVEVA** (System Platform/OMI, formerly Wonderware) — claims "IEC 62443 – Full Certification" for ops-control software and development practice (also ISO 27001, SOC 2 Type II).
- **Yokogawa, ABB, Schneider, Honeywell, Hitachi, Toshiba, Azbil** — ISASecure CSA/EDSA certified controllers/SIS (see isasecure.org component list).
- **Ignition (Inductive Automation)** — markets security hardening aligned to 62443 concepts; no ISASecure cert found — an opening for a newcomer to differentiate.

**Sources:** isa.org/standards-and-publications/isa-standards/isa-iec-62443-series-of-standards · iec.ch/cyber-security · isasecure.org/certification · isasecure.org/end-users/iec-62443-4-2-certified-components · webstore.iec.ch (62443-3-3, 4-2) · winccoa.com documentation product_certifications · copadata.com/en/products/.../industrial-cybersecurity · aveva.com OneSheet_StandardsCertification.pdf

---

## 2. ISA-95 / IEC 62264 — Enterprise-Control System Integration 🔴

**Full name:** ANSI/ISA-95 (IEC 62264), "Enterprise-Control System Integration," Parts 1–6.

### What it covers
- The canonical **level hierarchy**: L0 physical process (sensors/actuators) → L1 sensing/actuation control (PLC, I/O) → L2 control & supervision (**SCADA/HMI lives here**) → L3 Manufacturing Operations Management (MES/MOM) → L4 business logistics (ERP).
- Part 1: models & terminology (equipment, material, personnel hierarchies). Part 2: object models/attributes for the L3↔L4 interface. Part 3: MOM activity models (production, quality, inventory, maintenance operations). Parts 4–6: L3 object models, transactions, message services.
- **B2MML** (Business To Manufacturing Markup Language) — MESA International's royalty-free XML/XSD implementation of ISA-95 object models; de facto exchange format for ERP↔MES↔SCADA integration.
- Closely related: IEC 62264 is the international adoption; ISA-95 Ed.2025 Part 1 recently revised.

### SCADA software implications
- Tag/asset model should map to the **equipment hierarchy** (Enterprise→Site→Area→Work Center→Work Unit) so SCADA context feeds MES/ERP cleanly.
- Standard object models for **production schedules, actuals, material lots, equipment capability** → enables OEE/downtime/order tracking without bespoke schemas.
- UNS naming conventions in the field typically follow ISA-95 levels — a SCADA that emits ISA-95-structured topics/namespace plugs directly into modern IIoT architectures.
- Positioning: SCADA is the L2 data source; the standard dictates the *interface contract* upward.

### Vendors
- Ignition (Sepasoft MES modules implement ISA-95/B2MML), AVEVA MES, Siemens Opcenter, Rockwell FactoryTalk ProductionCentre, SAP DM — all market ISA-95 alignment. Almost every SCADA vendor claims "ISA-95/Purdue compatible architecture."

**Sources:** isa.org/standards-and-publications/isa-standards/isa-95-standard · webstore.ansi.org preview IEC 62264-2 · mesa.org B2MML · hivemq.com UNS/ISA-95 article

---

## 3. ISA-88 / IEC 61512 — Batch Control 🟡

**Full name:** ANSI/ISA-88 (IEC 61512), "Batch Control," Parts 1–4. IEC 61512-1 Ed.2 published 2026.

### What it covers
- **Physical model:** Enterprise → Site → Area → Process Cell → **Unit** → Equipment Module → Control Module (Unit is the mandatory level).
- **Procedural control model:** Procedure → Unit Procedure → Operation → **Phase** (phase is the atomic executable bound to equipment).
- **Recipe types:** General → Site → Master → Control recipe; recipe contents = header, formula, equipment requirements, procedure.
- Separation principle: recipe procedural elements vs. equipment procedural elements — recipes defined without changing equipment code.
- Process model (process → stages → operations → actions), batch states (Idle/Running/Holding/Aborting/Complete etc.), PFC (Procedure Function Charts, Part 2).
- Related: **ISA-TR88.00.02 / PackML** — machine/unit state model for packaging lines; OMAC PackTags.

### SCADA software implications
- For batch/pharma/food customers: equipment model objects (units, equipment modules) in the tag/asset tree; **phase-state visualization**, recipe display, batch ID tracking; **batch journal/electronic batch record (EBR)** feeds (timestamps, operator actions, recipe parameters — ties into Part 11).
- Sequential control displays (SFC-style), arbitration of shared resources (units between batches), exception handling visibility.
- Discrete/packaging customers: **PackML state machine** widgets (Execute/Hold/Suspend/Abort states), OEE dashboards keyed to PackTags.

### Vendors
- Rockwell (PlantPAx/FactoryTalk Batch — the canonical S88 product), Siemens SIMATIC BATCH, Emerson DeltaV Batch, AVEVA (InBatch), Ignition + Sepasoft Batch module, COPA-DATA zenon (batch module); PackML supported by most OEE platforms (Ignition, Vorne, PTC ThingWorx).

**Sources:** webstore.iec.ch/en/publication/75287 (IEC 61512-1:2026) · en.wikipedia.org/wiki/ISA-88 · isa.org ISA88 committee page · webstore.ansi.org preview ANSI/ISA-88.00.01-2010

---

## 4. ISA-101 (ANSI/ISA-101.01-2015) — Human Machine Interfaces for Process Automation 🔴

### What it covers
- Lifecycle standard for HMI: **HMI philosophy** → style guide → display design → implementation → operation → continuous improvement/change management.
- Supporting TRs: ISA-TR101.01-2022 (implementing the HMI philosophy), ISA-TR101.02-2019 (usability & performance).
- **Situational awareness** as the design goal: operator knows what's happening, the state now, and the *likely future state*. HMI should show minimal sensory stimuli when the process is normal; escalate salience as it deviates.

### High-performance HMI principles (market shorthand for "ISA-101 style")
- Gray backgrounds, restrained 2-D graphics; **color reserved for abnormal states/alarms** — no rainbow P&ID clones, no gratuitous animation.
- Analog representation of key values in context of normal/abnormal/alarm ranges; **embedded trends** rather than bare numbers.
- **Four-level display hierarchy:** L1 span-of-control overview (KPIs, alarm status, big picture; *no control actions*) → L2 process unit control (routine ops) → L3 unit detail (diagnostics) → L4 support/faceplates (interlocks, help, docs).
- Consistent navigation, minimizing data-entry errors, alarm indication integrated with ISA-18.2 priorities.

### SCADA software implications
- Ship an **HP-HMI widget/symbol library** (gray-scale templates, analog indicators, sparkline trends, alarm-colored states) — a genuine differentiator vs. vendors that ship arcade graphics.
- Display hierarchy support: role-based default landing pages, drill-down navigation model, template inheritance (L4 faceplates generated from tag metadata).
- HMI lifecycle support in the product: style-guide enforcement via themes, graphics standards/versioning, HMI change audit trail.

### Vendors
- ICONICS, AVEVA (InTouch/OMI), Ignition Perspective, Rockwell (Process HMI Style Guide published), VTScada, zenon all market "high-performance HMI" alignment; the High Performance HMI Handbook (Hollifield et al., ISA) is the de facto implementation text.

**Sources:** isa.org/standards-and-publications/isa-standards/isa-101-standards · ANSI/ISA-101.01-2015 (full text mirror) · Rockwell proces-wp023 Process HMI Style Guide · isa.org "High Performance HMI Overview" PDF

---

## 5. ISA-18.2 / IEC 62682 — Alarm Management 🔴

**Full name:** ANSI/ISA-18.2-2016 "Management of Alarm Systems for the Process Industries"; internationalized as **IEC 62682**. Complemented by EEMUA 191 guide.

### What it covers — the alarm lifecycle stages
Philosophy → Identification → Rationalization → Detailed design → Implementation → Operation → Maintenance → Monitoring & assessment → Management of change → Audit. Plus TRs (TR18.2.1 philosophy, .2 rationalization, .3 basic alarm design, etc.).

- **Alarm philosophy document** — mandatory artifact: defines what qualifies as an alarm (vs. event/message), priorities, classes, KPIs, MOC.
- **Rationalization** — every alarm needs documented setpoint, consequence, operator action, priority, class.
- **KPIs (Table per 30 days of data, per operator console):**
  - Annunciated alarms: **~150/day acceptable**, ~300/day max manageable; ~6/hour avg; ~1/10min avg.
  - **Flood condition** (>10 alarms/10 min): <1% of time; % of hours with >30 alarms <1%.
  - Top-10 most frequent alarms: <1–5% of total load; chattering/fleeting: zero; **stale alarms <5/day**.
  - Priority distribution ~80% low / 15% medium / 5% high (3-priority scheme).
  - Unauthorized suppression or attribute changes: zero (tracked via MOC).
- Required functions: **alarm shelving** (operator-authorized temporary removal with auto-return), **state-based/flood suppression** (suppression-by-design per operating mode), designed alarm groups, audit of changes.

### SCADA software implications — concrete features
- Alarm DB storing setpoint/priority/consequence/response-action/class per alarm (rationalization metadata).
- **Shelving, suppression-by-design, out-of-service states**, all permission-controlled and logged.
- Built-in **alarm analytics/KPI reports**: alarms/day, flood percentage, top-N bad actors, chattering count, stale list, priority distribution, standing-alarm aging.
- Alarm history historian + export for analysis; MOC hooks (who changed what setpoint when — also feeds Part 11/Annex 11 alarm-log requirements).
- Alarm notification workflows (escalation chains, on-call rosters) are the adjacent competitive feature.

### Vendors
- Ignition alarming + third-party tools; ICONICS explicitly markets ISA-18.2; Honeywell Process (whitepaper benchmarking ISA-18.2 vs EEMUA 191 vs IEC 62682); exida SILAlarm rationalization tool; Rockwell (metrics whitepapers); AVEVA, GE iFIX, VTScada (alarm analysis tools). Merck/Grantek built an ISA-18.2 alarm management system on Ignition.

**Sources:** webstore.ansi.org preview ANSI/ISA-18.2-2009 (TOC: §16 monitoring/metrics) · Honeywell alarm management standards whitepaper · Rockwell proces-wp014 metrics · ISA-TR18.2.3-2024 preview · exida alarm whitepaper

---

## 6. IEC 62541 — OPC UA (+ OPC Classic) 🔴

**Full name:** IEC 62541 / OPC 10000-x, "OPC Unified Architecture," maintained by the OPC Foundation.

### What it covers
- Service-oriented, platform-independent, secure interoperability spec: address-space information modeling, client-server services (read/write/subscribe), **alarms & conditions**, historical access, pub/sub (MQTT/UDP broker-based, Part 14), security via X.509 certs, signing & encryption.
- Standardized as IEC 62541 since 2012; also national standards in CN/JP/KR/SG. OPC UA FX (field eXchange) + TSN pushes UA toward controller-level comms; OPC UA Safety exists for functional-safety comms.
- **Profiles** segment functionality into testable/certifiable units (OPC 10000-7).
- **OPC Classic** (still endemic): **OPC DA** (real-time value/quality/timestamp), **OPC AE** (alarm & event notifications + acknowledgement), **OPC HDA** (historical time-series queries) — COM/DCOM, Windows-only, legacy but unavoidable in brownfield.

### Companion specifications (semantic interoperability = the real moat)
- **OPC 30050 UA for PackML** (ISA-TR88.00.02 state model → packaging machines)
- **OPC 40001 UA for Machinery**, **EUROMAP 77/82.x/83 = OPC 40083** (plastics & rubber machines)
- **OPC 10000-95 UA for ISA-95**; **MDIS** (JIP — subsea oil & gas production), Robotics, AutoID, CNC (OPC 40501), commercial kitchen equipment, etc.

### Certification program
- OPC Foundation accredited **Certification Test Labs**; certifiable targets: UA client, UA server, UA publisher/subscriber, and OPC Classic (DA 2.05/3.0, HDA, A&E). UA releases certifiable: 1.03/1.04/1.05 against profiles. Plus Plugfest interoperability events.
- Certified ⇒ compliant, interoperable, robust/recovering, usable, resource-efficient — "OPC Certified" is a checklist item in many tenders.

### SCADA software implications
- **Mandatory**: UA client (browse address space, subscriptions, alarms & conditions, history reads) *and* ideally an embedded UA server exposing the SCADA's unified tag model to MES/ERP — being a certifiable UA server is a strong claim.
- X.509 cert management UX, secure channel policies, username/anonymous auth, redundancy/failover per UA spec.
- OPC DA/AE/HDA connectivity still needed via wrapper or native for brownfield deals.
- Companion-spec awareness (auto-mapping PackML/EUROMAP nodes) is a differentiator.

### Vendors
- Practically universal support: Ignition (embedded UA server + client; Cirrus-Link heritage), Kepware KEPServerEX, Matrikon, AVEVA, Siemens WinCC, GE iFIX, ICONICS (GenBroker), COPA-DATA zenon, Prosys/Unified Automation SDKs.

**Sources:** opcfoundation.org/certification/overview-benefits · OPCF-FS-UA overview PDF (IEC 62541 status) · reference.opcfoundation.org OPC-30050 (PackML) · euromap.org/i40/OPCUA · opcfoundation.org OPC Classic page · advosol/Unified Automation OPC spec docs

---

## 7. MQTT (ISO/IEC 20922) + Sparkplug B (ISO/IEC 20237, Eclipse Tahu) 🟡→🔴 for IIoT plays

### What it covers
- **MQTT**: OASIS standard (v3.1.1 = ISO/IEC 20922; v5 current), lightweight pub/sub over TCP — broker-centric, QoS 0/1/2, retained messages, Last Will & Testament, payload-agnostic.
- **Sparkplug (B)**: Eclipse Sparkplug Working Group spec (v3.0.0 → ISO/IEC 20237:2023 via JTC1 PAS); reference implementation = **Eclipse Tahu** (client libs + TCK). Defines:
  - **Topic namespace**: `spBv1.0/<group_id>/<NBIRTH|NDEATH|DBIRTH|DDEATH|NDATA|DDATA|NCMD|DCMD|STATE>/<edge_node_id>/[<device_id>]`
  - **Birth/death certificates**: NBIRTH/DBIRTH declare the full metric catalog; NDEATH/DDEATH via MQTT Will mark data stale — solves "is this data current?" that raw MQTT cannot.
  - **STATE/Primary Host**: host apps publish their own birth (STATE topic, retained); edge nodes buffer via **store-and-forward** when the primary host is offline, then backfill on reconnect.
  - Payload = Google Protocol Buffers (templates, datasets, metric aliases for bandwidth, historical & file metrics).

### UNS (Unified Namespace)
- Not a standard — an architecture pattern: a single MQTT-brokered namespace (usually Sparkplug) hierarchically organized by ISA-95 levels as "single source of truth," replacing point-to-point integration. Increasingly the expected deployment model for modern SCADA/IIoT.

### SCADA software implications
- Native **Sparkplug B host application** role: subscribe NBIRTH→auto-discover edge/device tags, honor STATE for data validity, issue DCMD writes, consume DDATA timestamps/quality.
- Or edge role: publish birth certs, buffer with store-and-forward, expose metrics with aliases.
- Broker-side requirements: TLS, ACLs; SCADA should document namespace/group-ID conventions for UNS.

### Vendors
- Ignition (MQTT Transmission/Engine/Distributor modules — the reference Sparkplug stack; Inductive Automation's Cirrus Link lineage literally wrote Sparkplug), HiveMQ enterprise broker, Chariot, Red Lion, Canary, HighByte (UNS-oriented), Kepware IoT Gateway.

**Sources:** sparkplug.eclipse.org spec v3.0.0 · github.com/eclipse-tahu/tahu · eclipse.org newsroom (ISO/IEC 20237) · iso.org/standard/69466 (ISO/IEC 20922) · hivemq.com UNS article · docs.chariot.io store-and-forward

---

## 8. IEC 61131-3 — PLC Programming Languages ⚪ (interop note)

**Full name:** IEC 61131-3:2013 "Programmable controllers — Part 3: Programming languages" (Ed.4 in progress). Defines **LD** (ladder diagram), **FBD** (function block diagram), **ST** (structured text), **IL** (instruction list — deprecated in Ed.3), **SFC** (sequential function chart); POUs, data types, SFC elements, object-oriented extensions.

**SCADA relevance (no compliance claim):** (a) tag import — parse/export PLC symbol/tag files from vendor IDEs (TIA Portal, Studio 5000, CODESYS, TwinCAT) to cut engineering time; (b) edge SCADA products (e.g., CODESYS-based, groov EPIC) embed IEC 61131-3 runtimes for local control; (c) PLCopen XML interchange format aids portability. For a pure supervisory web SCADA it's a *display/import* concern only.

**Sources:** preview.sist.si IEC 61131-3:2013 · IEC webstore

---

## 9. Fieldbus & Telecontrol Protocols — the SCADA Driver Library 🔴

No single standard: a SCADA's competitive moat is breadth of its **driver library** across these standard families:

| Protocol / family | Standard | Domain |
|---|---|---|
| **Modbus RTU / ASCII / TCP** | IEC 61158 (CPF 15) / IEC 61784-2; de facto since 1979 | Everything — the baseline driver; also Modbus telemetry variants |
| **EtherNet/IP (+CIP, CIP Safety)** | IEC 61158/61784 (CPF 2); ODVA | Discrete/factory (Rockwell/Allen-Bradley) |
| **PROFINET / PROFIBUS** | IEC 61158/61784 (CPF 3); PI organization | Discrete + process (Siemens); SCADA usually reaches via S7 or OPC rather than raw PROFINET IO |
| **EtherCAT, Sercos, POWERLINK** | IEC 61158/61784 (CPF 12, 16…) | Motion/machine — rare direct SCADA drivers |
| **PROFIsafe/CIP Safety/FSoE** | IEC 61784-3 functional-safety profiles | Safety comms (monitoring only from SCADA) |
| **BACnet/IP, MS/TP** | ANSI/ASHRAE 135 = **ISO 16484-5**; BTL test to 16484-6 | Building automation — needed if product crosses into facilities/BMS |
| **S7comm (Siemens), FINS (Omron), MELSEC/MC (Mitsubishi), EtherNet/IP-PCCC** | Proprietary | De facto must-haves in discrete factory |
| **IEC 61850** | IEC 61850 (TC 57); MMS client/server (8-1), GOOSE/GSE multicast, SCL/SCD/CID/IID system config files, logical nodes (7-4), time sync (SNTP/PTP), sampled values | **Power/substation** — SCADA must act as MMS client, import SCD files, map LNs; KEMA/UCAIug conformance matters |
| **IEC 60870-5-101 / -104 ("101"/"104")** | IEC 60870-5; -104 = -101 over TCP/IP; IEC 60870-5-7 security extension | Telecontrol — EU/Asia utilities, water, rail |
| **DNP3 / IEEE 1815** | IEEE 1815 (DNP Users Group); Secure Authentication SAv5 | North American utilities, water/wastewater, O&G pipelines |
| **WITS-DNP3** | UK Water Industry Telemetry Standards — DNP3 application profile + certification | **UK water** — required for that market |
| **ICCP / TASE.2** | IEC 60870-6 | Control-center-to-control-center (ISO/RTO links) |
| **IEC 61850-90-x, IEC 61400-25** | Wind/DER extensions | Renewables |

**SCADA implications:** native drivers with per-protocol diagnostics (channel/device quality), unsolicited reporting & report-by-exception (DNP3/61850), deadbanding, time-stamped SOE at source (critical for utilities), store-and-forward at the RTU edge, and **protocol conformance evidence** where user groups offer it (DNP3 conformance testing, WITS certification, BTL for BACnet, UCA/IUG test certs for 61850 — e.g., AVEVA claims "IEC 61850: Full – Certification").

**Sources:** iec61850.dvl.iec.ch · ABB REC615 101/104 doc · dnp.org overview · witsprotocol.org · nettedautomation.com protocol comparison · powerfabric.org fieldbus standards list · bacnet.org · NTNU compendium ch.2

---

## 10. ISO/IEC 27001 — Information Security Management System 🔴 (vendor-level)

**Full name:** ISO/IEC 27001:2022 "Information security, cybersecurity and privacy protection — Information security management systems — Requirements."

- Certifies the **vendor organization's ISMS** (risk assessment, Annex A control set incl. access control, cryptography, ops security, supplier relationships, incident management, business continuity) — not the product.
- For a cloud/SaaS SCADA, customers will map your cert scope to hosted operations; commonly paired with **SOC 2 Type II** (US market) and **ISO 27017/27018** (cloud controls/PII).
- **Claimed by:** AVEVA (ISO 27001 full cert per its standards one-sheet), Siemens, most enterprise vendors; expect enterprise procurement questionnaires to require it.

**Sources:** iso.org/standard/27001 · aveva.com standards one-sheet · typical vendor trust centers

---

## 11. FDA 21 CFR Part 11 + EU GMP Annex 11 + ISPE GAMP 5 🔴 for life sciences

### 21 CFR Part 11 — Electronic Records; Electronic Signatures (US FDA)
Applies to records required by FDA predicate rules (cGMP manufacturing → batch records, trends, alarms, operator actions). §11.10 closed-system controls demand:
- **(a) System validation** — accuracy, reliability, ability to discern invalid/altered records.
- (b) Complete copies in human-readable + electronic form for inspection.
- (d) Limited system access to authorized individuals; **(g) authority checks** (RBAC).
- **(e) Secure, computer-generated, time-stamped audit trails** recording create/modify/delete — must not obscure previous data; retained ≥ record retention period; available for review.
- **§11.50/11.70/11.100–11.300 electronic signatures:** signed records show name/date-time/meaning; signature linked to record (can't be excised/copied); unique per user; identity verification; password aging/loss mgmt; two signing components for non-biometric.

### EU GMP Annex 11 — Computerised Systems (EudraLex Vol. 4; 2011 version in force, major 2025 revision in consultation)
- Validation across lifecycle; IT infra qualification; supplier/audit info availability; risk mgmt (ICH Q9-aligned); change & configuration management; security; incident mgmt; business continuity; **electronic signatures**; archiving with readability.
- 2025 draft adds explicit **alarm-log requirements**: automatic logging of all alarms & acknowledgements (name, date/time, acknowledging user + role + reason comment), non-editable by GMP users, searchable/sortable or exportable, periodic documented review — plus ALCOA+ data integrity framing.
- **ALCOA+**: Attributable, Legible, Contemporaneous, Original, Accurate + Complete, Consistent, Enduring, Available.

### ISPE GAMP 5 (2nd Ed. 2022) — the validation playbook
- Software categories drive rigor: Cat 3 standard products → **Cat 4 configured products (where configured SCADA/DCS lives — tag DB, graphics, alarms, recipes)** → Cat 5 custom apps (custom scripts = highest risk).
- SCADA vendors ease validation by shipping Cat-4-positioned products with full vendor SDLC docs, FAT/SAT support, audit-trail/e-sign features.

### SCADA software implications
Immutable append-only audit trail on every value write/setpoint change/login/config change; e-signature workflows (dual component, meaning-of-signature); enforced unique accounts + AD/SSO; password policies; time-synced timestamps; long-term record retention/export; validated release documentation; **per-project validation support package** (IQ/OQ templates).

### Vendors
Ignition (dedicated Part 11 whitepaper + ALCOA+; Bachem/Merck pharma case studies), Rockwell FactoryTalk Optix (Part 11 user guide), AVEVA ("21 CFR Part 11: Full – Compliance"), Siemens WinCC, GE iFIX/CIMPLICITY, ICONICS — all market Part 11 capability. Note: the *platform enables* compliance; the *application* is validated — vendors say "can be configured to be Part 11 compliant."

**Sources:** ecfr.gov 21 CFR Part 11/§11.10 · fda.gov Part 11 scope guidance · EudraLex Annex 11 + EC 2025 draft revision · guidance-docs.ispe.org GAMP 5 2nd Ed · inductiveautomation.com Part 11 article · Rockwell optix-um001 · learngxp.com GAMP categories

---

## 12. ISO 50001 — Energy Management Systems 🟡

**ISO 50001:2018 "Energy management systems — Requirements with guidance for use."** Plan-Do-Check-Act EnMS: energy review, **Significant Energy Uses (SEUs)**, **Energy Performance Indicators (EnPIs)**, **Energy Baselines (EnBs)**, objectives/action plans, monitoring & measurement, audits, management review. Technology-neutral; HLS structure integrates with ISO 9001/14001. ~18k+ certified orgs.

**SCADA implications:** energy is a first-class tag domain — metering/submetering drivers (Modbus power meters, M-Bus, IEC 62056/DLMS-COSEM for utility meters), interval data at ≤15-min resolution, automatic EnPI computation (kWh/unit, SEC), baseline modeling & deviation alarms, ISO 50001 evidence exports. Companion: ISO 50006 (EnPIs/EnBs), ISO 50015 (M&V). A SCADA that demos EnMS dashboards is a differentiator in EU where audits/EnMS are effectively mandated for large companies.

**Sources:** iso.org/standard/69426 · navigator.lbl.gov 50001 Ready Task 20 · umweltbundesamt.de EnMS guide · percee.energy requirement mapping

---

## 13. IEC 61508 / IEC 61511 (ISA-84) — Functional Safety / SIS ⚪→🟡

- **IEC 61508** "Functional safety of E/E/PE safety-related systems" — the umbrella standard; safety lifecycle; **SIL 1–4** (probability of dangerous failure on demand / per hour).
- **IEC 61511** = process-industry sector implementation (adopted in US as **ANSI/ISA-84.00.01**): SIS lifecycle from hazard & risk assessment through SIF design (sensor→logic solver→final element), SIL verification, operation & proof testing.
- **Key clause for SCADA (61511-1 §11.2.4 + §9.5):** the **BPCS must be separate and independent** such that functional integrity of the SIS is not compromised — independence, diversity, physical separation between protection layers and BPCS.

**SCADA implications (monitoring-only principle):**
- SCADA **reads** SIS data (trip status, bypasses, proof-test records, SOE) via gateway/one-way channel (OPC read-only, data diode); **never writes to the safety zone**. Architectures route SIS I/O through separate networks; document that no SCADA write path exists.
- Display **SIS states distinctly** (per ISA-101 L4 support displays); alarm SIS demands/bypass activations; log proof tests & bypass events for functional-safety audits.
- Competitive claim: "IEC 61511-aware architecture" — not certification of the SCADA itself.

**Sources:** ANSI/ISA-84.00.01 (IEC 61511-1 Mod) preview · IEC 61511-2 guidance preview (HMI, separation §F.18) · iceweb.eit.edu.au control/safety integration · havtil.no SINTEF ICT-security & independence report

---

## 14. ISO 13849 / IEC 62061 — Machinery Safety ⚪

- **ISO 13849-1:2023** "Safety of machinery — Safety-related parts of control systems" — Performance Levels **PL a–e** for SRP/CS, high/continuous demand mode, incl. software design.
- **IEC 62061:2021(+Amd)** machinery-sector functional safety of safety-related control systems — **SIL 1–3** (SILCL claim levels), within IEC 61508 framework; ISO/TR 23849 guides using both.

**SCADA implications:** monitoring only — machine safety functions belong to dedicated safety controllers (safety PLC, relays). SCADA may display e-stop/safety-device status and log safety events for incident analysis; never claim the SCADA implements PL/SIL functions. Relevant where product targets machine/OEM dashboards (PackML + safety-status data).

**Sources:** iso.org/standard/73481 · webstore.iec.ch IEC 62061 consolidated · ISO/TR 23849 preview · CAPIEL comparison whitepaper

---

## 15. NERC CIP — Bulk Electric System Cyber Reliability 🟡 (US/Canada power)

CIP-002 through CIP-015 series, mandatory/enforceable in North America. SCADA/EMS at a "Responsible Entity" is a **BES Cyber System** categorized high/medium/low impact (CIP-002). Demands on the platform:
- **CIP-005 Electronic Security Perimeter:** all external access through controlled Electronic Access Points; inbound/outbound permission control; **remote access via Intermediate System with MFA** — a web SCADA must sit behind (or implement) this pattern.
- **CIP-007 System Security Management:** only required ports/services enabled (**documented port list**); patch process within 35 days; malicious-code prevention where feasible; security event monitoring/logs; password enforcement incl. defaults changed.
- **CIP-010 Config change mgmt:** baseline configuration; authorize/log changes; 35-day vulnerability assessments; **transient cyber asset/removable media** controls.
- CIP-004 personnel & training, CIP-006 physical, CIP-008 incident response/reporting, CIP-009 recovery plans (backup/restore testability — the SCADA config must be restorable), CIP-011 info protection (BCSI), CIP-012 real-time comms between control centers (encryption of ICCP/telemetry links), CIP-013 supply-chain security (vendor transparency helps sell), CIP-014 physical, CIP-015 INSM (draft monitoring).

**Vendors:** AVEVA claims "NERC CIP: Full – Compliance"; OSI/GE/ABB/Siemens EMS vendors design for CIP; Ignition deployments in co-ops/utilities market CIP-ready architectures. Claims are "compliance-enabling features" — the *entity* is audited, not the product.

**Sources:** nerc.com/standards/reliability-standards/cip (CIP-002-7, CIP-005-7/-8, CIP-007-7.1, CIP-010-4/-5, CIP-012-2 PDFs)

---

## 16. Marine Classification Society Rules — DNV, ABS, LR, BV 🟡 (marine only)

- Ship automation/SCADA on classed vessels requires **type approval** of control & monitoring systems: DNV Rules Pt.4 Ch.9; test spec **IACS UR E10** + **IEC 60092-504** + **IEC 60945** (nav/radio env.); environmental testing per DNVGL-CG-0339 (vibration, temp, EMC, compass-safe distance).
- **IACS UR E26/E27** (mandatory for newbuild contracts from 1 Jul 2024): cyber-resilience of ships/systems — E27 requires **product certification of onboard systems to IEC 62443-derived security capabilities**; DNV "Cyber secure (Essential)" class notation, Security Profile 1; DNV-CP-0231 type-approval program.
- Others: ABS (Guide for Cybersecurity Implementation), Lloyd's Register, Bureau Veritas, ClassNK — harmonized via IACS URs.

**SCADA implications:** only relevant if targeting marine/offshore — then software approval, HIL testing, and IEC 62443-4-2-level security evidence become mandatory; web architecture helps remote fleet monitoring but onboard systems remain isolated/approved.

**Sources:** dnv.com control-and-automation-systems-and-software · dnv.com cyber-security-approval (UR E26/E27) · DNVGL-CG-0339 · approvalfinder.dnv.com certificate examples

---

## 17. Common Criteria + FIPS 140-2/140-3 ⚪ (brief)

- **Common Criteria (ISO/IEC 15408):** evaluated products against Protection Profiles (e.g., NDcPP for network devices); rarely applied to SCADA software itself — relevant in defense/government procurements.
- **FIPS 140-2/140-3 (NIST CMVP):** validates *cryptographic modules*. A web SCADA sells into US federal/utility markets by using **FIPS-validated crypto** (e.g., OpenSSL FIPS provider, BoringCrypto, Windows CNG) for TLS + stored secrets — claim "uses FIPS 140-x validated cryptographic modules," not "FIPS certified product" unless the module itself is validated. TLS 1.2+/1.3, AES-256, RSA/ECDSA, HMAC are the expected primitives.

**Sources:** csrc.nist.gov CMVP validated-modules search · commoncriteriaportal.org (e.g., Armor SCADA NDcPP20E security target) · NIST FIPS 140-2 IG

---

## 18. ISO/IEC 25010 — Software Product Quality (SQuaRE) ⚪ (brief)

**ISO/IEC 25010:2023** product quality model — **nine characteristics**: functional suitability, performance efficiency, compatibility, **interaction capability** (was usability), reliability, **security**, maintainability, flexibility (was portability), **safety** (new). Used for requirements spec, test objectives, acceptance criteria.

**SCADA implications:** good internal taxonomy for the product's own quality backlog (e.g., security sub-characteristics: confidentiality, integrity, non-repudiation, accountability, authenticity, resistance — maps cleanly onto 62443 FRs); occasionally cited in public-sector RFPs.

**Sources:** iso.org/standard/78176 · webstore.iec.ch ISO/IEC 25010:2023

---

## 19. GDPR / Data Protection for Cloud SCADA 🟡 (EU-hosted)

- SCADA processes personal data: **operator identity, action logs, shift patterns, audit trails, access records** (arguably video/location if integrated). Cloud SaaS ⇒ vendor is *processor*, plant is *controller*.
- Implications: **Art. 25** data protection by design/default (data minimization in logs, pseudonymized operator IDs where feasible); **Art. 32** security of processing (encryption, resilience — overlaps 62443); **DPIA** support docs; **Art. 28** DPA + subprocessor list + SCCs/DPF for non-EU transfers; retention controls.
- Tension to design around: **erasure vs. immutable audit trails** — resolve via pseudonymized user references and defined retention/legal-basis documentation; anonymization must be irreversible to exit GDPR scope.
- Adjacent EU law (strategically vital): **NIS2** — SCADA end-users in essential/important entities must implement risk measures; vendors get pulled into scope via supply chain (COPA-DATA explicitly markets zenon as NIS2-enabling). **Cyber Resilience Act (CRA)** — CE-marked security obligations for "products with digital elements" (incl. SCADA software) applying ~Dec 2027; **IEC 62443 is the presumption-of-conformity path**. Also EU **Machinery Regulation 2023/1230**.

**Sources:** commission.europa.eu data-protection-explained · EDPB pseudonymisation guidelines 2025 · ENISA Data Protection Engineering · copadata.com NIS2 positioning · Czech eGovernment SCADA+GDPR deck

---

## 20. Utility Integration Standards — IEC 61968/61970 (CIM), plus telecontrol set 🟡 (utilities)

- **IEC 61970 (EMS-API) / IEC 61968 (distribution system interfaces) / IEC 62325 (markets)** — the **Common Information Model (CIM)**: a UML ontology + CIM/XML(RDF) exchange format for network models, assets, measurements. IEC 61968-100 defines implementation profiles (web services/JMS; REST/XMPP in practice).
- Used to exchange power-system models between EMS/DMS/GIS/OMS/asset systems — NIST named it one of five foundational Smart Grid families.
- **SCADA implications (utility market):** import/export network models & measurement definitions as CIM XML; tag↔CIM object mapping avoids re-keying point lists; ICCP/TASE.2 (IEC 60870-6) for inter-control-center realtime data.
- Pair with §9 telecontrol stack: **IEC 60870-5-101/104** (EU telecontrol; -104 = TCP/IP profile; -5-7 security addendum), **DNP3/IEEE 1815 + Secure Authentication SAv5** (North America — note no encryption in-band; rely on transport), **WITS-DNP3** (UK water profile + certification program), **IEC 61850 MMS/GOOSE/SCL** (substations).

**Sources:** EPRI CIM Primer ch.1 & 11 · PNNL-32679 · en.wikipedia Common Information Model · IEC TC57 · witsprotocol.org · ABB/dnp.org docs above

---

# Certification Landscape — What Actually Buys Credibility for a Web SCADA

| Certification/attestation | Body/scheme | Applies to | Market weight |
|---|---|---|---|
| **ISASecure CSA / EDSA** (IEC 62443-4-2) | exida, TÜV SÜD, CSSC, BV (ISO/IEC 17065 CBs) | Product | ⭐⭐⭐ The differentiator — few software-only SCADAs hold it; most certs today are controllers/SIS. |
| **ISASecure SDLA** (62443-4-1) | same | Dev process | ⭐⭐⭐ Achievable for a startup; prerequisite credibility for CSA; WinCC OA, zenon, Yokogawa hold it. |
| **ISASecure SSA** (62443-3-3) / **ACSSA** (site) | same | System/site | ⭐ Integrator/asset-owner side; know it for spec language. |
| **IECEE Industrial Cyber Security** (OD-2061) | IECEE CB scheme | Product | ⭐⭐ EU-favored alternative to ISASecure. |
| **OPC Foundation Certification** | Accredited test labs + Plugfests | UA client/server | ⭐⭐⭐ Table stakes for "enterprise-grade"; certify the embedded UA server. |
| **ISO/IEC 27001** | Accredited CBs | Vendor ISMS/cloud ops | ⭐⭐⭐ Required by enterprise security reviews; pair with SOC 2 Type II for SaaS. |
| **SOC 2 Type II** | AICPA auditors | SaaS ops | ⭐⭐⭐ US procurement standard. |
| **FIPS 140-3 module usage** (NIST CMVP) | NIST | Crypto | ⭐⭐ Federal/utility checkbox — use validated modules, claim correctly. |
| **DNP3 conformance / WITS / IEEE 1815** | DNP-UG, WITS PSA | Protocol drivers | ⭐⭐ Needed for utility/water driver credibility (esp. UK water). |
| **UCAIug/IEC 61850 conformance** | KEMA/DNV test certs | 61850 client | ⭐⭐ For substation/utility deals (AVEVA claims it). |
| **BTL listing** (BACnet Testing Labs) | BACnet International | BACnet driver | ⭐ Only if BMS/buildings market. |
| **DNV/ABS/LR type approval** | Class societies (IACS UR E10/E26/E27) | Product | ⭐ Marine only. |
| **Common Criteria EAL** | National schemes | Product | ⚪ Rare; government/defense only. |
| **UL / CE marking** | NRTLs / self-declaration | Hardware appliance | ⚪ Applies to shipped *hardware* (panel PCs/edge gateways: UL 508/61010, CE-EMC/LVD). Software itself isn't UL/CE marked today — **but the EU CRA changes this ~Dec 2027 for software**: CE-marked cyber requirements with 62443 as presumption-of-conformity path. Watch this. |
| **FDA Part 11 / Annex 11 / GAMP 5** | No cert exists | App-level compliance | ⭐⭐⭐ Sell "compliance-enabling platform" + validation package; there's no product stamp — credibility = whitepapers, audit-trail features, customer references. |

**Recommended certification sequence for a new web SCADA:** (1) OPC UA server certification + membership → (2) IEC 62443-4-1 SDLA (secure dev lifecycle) → (3) ISO 27001 + SOC 2 if SaaS → (4) ISASecure CSA at SL2 (aspirational SL3) → (5) vertical additions: WITS/DNP3 conformance (water), 61850 test cert (utilities), Part 11 validation package (pharma), CRA readiness (EU 2027).

---

## Quick competitive-comparison snapshot

| Capability/claim | Ignition | AVEVA | WinCC OA | zenon | GE iFIX | ICONICS | Rockwell FT |
|---|---|---|---|---|---|---|---|
| IEC 62443-4-1 SDLC cert | —/partial claims | ✓ | ✓ | ✓ | — | — | (corporate SDL) |
| 62443-4-2 product cert | — | claimed "full" | SL2 (100%) | — | — | — | — |
| ISA-101 HP-HMI | ✓ (Perspective) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ (style guide) |
| ISA-18.2 alarm mgmt | ✓ + partners | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| 21 CFR Part 11 package | ✓ whitepaper | "Full" | ✓ | ✓ | ✓ | ✓ | ✓ Optix guide |
| OPC UA cert | ✓ server+client | Partial cert | ✓ | ✓ | ✓ | ✓ | ✓ |
| MQTT/Sparkplug native | ✓✓ (best-in-class) | Partial | ✓ | ✓ | partial | partial | partial |
| Utility protocols (61850/DNP3/60870) | drivers | Full cert (61850) | drivers | strong energy focus | drivers | ✓ | via partners |
| ISO 27001 / SOC 2 (vendor) | SOC 2 | ✓ both | (ETM/Siemens) | ISO 27001 | GE Vernova | — | Rockwell |

*(✓ = publicly claimed/marketed; verify current cert numbers against isasecure.org, OPC lab listings, and vendor trust centers before publishing externally.)*

---

### Master source list
- isa.org — 62443 series, ISA-95, ISA-101, ISA88/ISA95 committee pages, ISASecure certification + certified-component lists
- webstore.iec.ch / iso.org — IEC 61512-1, 62264, 62541, 62682, 62061, 61850, 60870-5-104, ISO 25010, ISO 50001, ISO 27001, ISO/IEC 20922
- opcfoundation.org — certification program, OPC Classic, OPC-30050 PackML; euromap.org
- sparkplug.eclipse.org, github.com/eclipse-tahu, eclipse.org newsroom (ISO/IEC 20237)
- ecfr.gov (21 CFR 11), fda.gov Part 11 guidance, EudraLex Annex 11 + 2025 draft, guidance-docs.ispe.org (GAMP 5)
- nerc.com CIP standards PDFs; cisa.gov CPG 2.0 + ICS pages
- dnv.com type-approval & UR E26/E27 pages, DNVGL-CG-0339
- inductiveautomation.com, aveva.com OneSheet_StandardsCertification.pdf, winccoa.com certs, copadata.com, iconics.com, Rockwell literature (optix-um001, proces-wp014/-wp023), gevernova.com iFIX
- EPRI CIM Primer, PNNL-32679, witsprotocol.org, dnp.org, bacnet.org, csrc.nist.gov CMVP, commoncriteriaportal.org


---

# Part VI — Academic literature

# Web-Based SCADA / Industrial SCADA — Citable Literature

*Citation counts are Crossref "is-referenced-by-count" figures (conservative vs. Google Scholar). Verified via Crossref API, web search, and JACoW/INSPIRE records, retrieved 2025.*

## 1. Surveys/Reviews — SCADA Architecture & Evolution

| Paper | Venue / Year | DOI | Cites | Relevance |
|---|---|---|---|---|
| **Yadav & Paul — "Architecture and security of SCADA systems: A review"** | Int. J. Critical Infrastructure Protection, 2021 | `10.1016/j.ijcip.2021.100433` | 242 | Best single survey: taxonomy of the four SCADA generations (monolithic → distributed → networked → IoT/4th-gen), protocols, attacks, IDS, testbeds, cloud/IoT-based SCADA. Lead background citation. |
| **Sverko, Grbac & Mikuc — "SCADA Systems With Focus on Continuous Manufacturing and Steel Industry: A Survey on Architectures, Standards, Challenges and Industry 5.0"** | IEEE Access, 2022 | `10.1109/access.2022.3211288` | 72 | Covers Web SCADA, cloud solutions, ISA-95 pyramid transformation under I4.0/I5.0, RAMI4.0 mapping. Strong for "why SCADA is moving to web/cloud." |
| **Shahzad — "The SCADA Review: System Components, Architecture, Protocols and Future Security Trends"** | American J. of Applied Sciences, 2014 | `10.3844/ajassp.2014.1418.1425` | 30 | Classic 3-generation architecture description (Monolithic/Distributed/Networked) + protocol review. |
| **"Evolution of SCADA Systems"** | Bulletin of the Transilvania University of Braşov, Series I | [URL](https://webbut.unitbv.ro/index.php/Series_I/article/download/3474/2759/6829) | — | 50-year history of SCADA; identifies IoT/SCADA as emerging 4th generation. Useful for historical framing. |
| **Dzingirai et al. — "IIoT and SCADA Integration for Enhanced Industrial Automation: A Comprehensive Review"** | Int. J. Advanced Networking and Applications, 2026 | `10.35444/ijana.2026.17604` | 0 | Very recent, on-topic review — but low-tier venue; cite cautiously. |

## 2. Web-Based / Cloud-Based SCADA

| Paper | Venue / Year | DOI | Cites | Relevance |
|---|---|---|---|---|
| **Maccarana, Cologni & Previdi — "Design of a HTML5 SCADA system"** | IEEE RTSI, 2016 | `10.1109/rtsi.2016.7740630` | 1 | HTML5 SCADA prototype: distributed HMI, push alarm notifications, reactive UI to overcome web data-transmission bottleneck. Closest architectural match to a React-based approach. |
| **Voitier, Golonka & Gonzalez-Berges — "Integrating Web-Based User Interface within CERN's Industrial Control System Infrastructure"** | ICALEPCS 2015 (JACoW) | `10.18429/JACoW-ICALEPCS2015-WEPGF069` | — | Real production-grade web SCADA frontend decoupled from WinCC-OA; discusses security, scaling to many web clients, legacy→web widget migration. Excellent practitioner precedent. |
| **Jeng, Chieng & Chen — "Web-Based Human-Machine Interfaces of Industrial Controllers in Single-Page Applications"** | Mobile Information Systems (Hindawi), 2021 | `10.1155/2021/6668843` | 7 | **Directly matches the target stack pattern**: MVC/SPA frontend using AJAX + WebSocket talking to a Node.js backend for remote industrial monitoring/control. |
| **Vargas-Salgado et al. — "Low-cost web-based SCADA system for a microgrid testbed"** | Heliyon, 2019 | `10.1016/j.heliyon.2019.e02474` | 53 | HTML5 web SCADA + Raspberry Pi/Arduino, ~86% cheaper than commercial SCADA; includes cost/comparison methodology useful for thesis evaluation section. |
| **Abbas — "Efficient Web-Based SCADA System"** | arXiv, 2015 | `10.48550/arXiv.1501.05725` | — | Early web-SCADA architecture paper; frequently cited by later web-SCADA work. |
| **Sviridov et al. — "Architecture of WEB-based SCADA"** | IEEE EIConRus, 2020 | `10.1109/eiconrus49466.2020.9039101` | 2 | Architectural treatment of web-based SCADA topologies. |
| **Aydogmus & Aydogmus — "A Web-Based Remote Access Laboratory Using SCADA"** | IEEE Trans. Education, 2009 | `10.1109/te.2008.921445` | 74 | Well-cited early web-SCADA remote-access implementation. |
| **Sverko & Orehovacki — "Web-Based Early Warning SCADA Subsystem"** | ACM ICSIE, 2021 | `10.1145/3512716.3512727` | 0 | Web-based alerting/notification subsystem design. |
| **Turc — "SCADA Systems Management Based on WEB Services"** | Procedia Economics & Finance, 2015 | `10.1016/s2212-5671(15)01419-7` | 3 | Web-services-based SCADA management layer. |
| **Turc, Gligor & Dumitru — "Web-based Wireless Sensor System for SCADA Environment"** | Procedia Engineering, 2017 | `10.1016/j.proeng.2017.02.432` | 2 | WSN + web SCADA integration. |
| **Tidrea & Korodi — "WebNavIGSS Web-Based Software Solution for IGSS SCADA Applications"** | IEEE MED, 2018 | `10.1109/med.2018.8442560` | 0 | Retrofitting an existing commercial SCADA (IGSS) with a web frontend — relevant to migration narrative. |
| **Goose, Kirsch & Wei — "SKYDA: cloud-based, secure SCADA-as-a-service"** | Int. Trans. Electrical Energy Systems, 2014 | `10.1002/etep.2018` | 5 | Explicit SCADA-as-a-Service cloud design with security focus. |
| **Porrmann, Essmann & Colombo — "Development of an event-oriented, cloud-based SCADA system using a microservice architecture under the RAMI4.0 specification: Lessons learned"** | IEEE IECON, 2017 | `10.1109/iecon.2017.8216583` | 10 | Microservice/event-driven cloud SCADA mapped to RAMI4.0 — key precedent for a FastAPI-backend microservice design. |
| **Yi et al. — "Benchmarking Cloud-Based SCADA System"** | IEEE CloudCom, 2017 | `10.1109/cloudcom.2017.25` | 14 | Performance evaluation methodology for cloud-hosted SCADA — citable for evaluation approach. |
| **Wali — "Analysis of Security Challenges in Cloud-Based SCADA Systems: A Survey"** | TechRxiv preprint, 2022 | `10.36227/techrxiv.20291835.v1` | 2 | Security issues specific to cloud-hosted SCADA (preprint — non-peer-reviewed). |

## 3. IIoT + SCADA Integration (MQTT, OPC UA Pub/Sub, Edge/Fog)

| Paper | Venue / Year | DOI | Cites | Relevance |
|---|---|---|---|---|
| **Zare & Iqbal — "Low-Cost ESP32, Raspberry Pi, Node-Red, and MQTT Protocol Based SCADA System"** | IEEE IEMTRONICS, 2020 | `10.1109/iemtronics51293.2020.9216412` | 42 | **Directly relevant** — MQTT-broker-based SCADA with Node-RED dashboard (web HMI over MQTT). Closest analogue to React+MQTT stack. |
| **Aghenta & Iqbal — "Low-Cost, Open Source IoT-Based SCADA System Design Using Thinger.IO and ESP32 Thing"** | Electronics (MDPI), 2019 | `10.3390/electronics8080822` | 120 | Most-cited open-source IoT-SCADA implementation; web dashboard via Thinger.IO IoT platform. |
| **Aghenta & Iqbal — "Development of an IoT Based Open Source SCADA System for PV System Monitoring"** | IEEE CCECE, 2019 | `10.1109/ccece.2019.8861827` | 63 | Companion conference version of the above. |
| **Profanter et al. — "OPC UA versus ROS, DDS, and MQTT: Performance Evaluation of Industry 4.0 Protocols"** | IEEE ICIT, 2019 | `10.1109/icit.2019.8755050` | 180 | Canonical quantitative comparison of MQTT vs OPC UA latency/overhead — cite for protocol-selection justification. |
| **Silveira Rocha et al. — "Performance Comparison Between OPC UA and MQTT for Data Exchange"** | IEEE MetroInd4.0&IoT, 2018 | `10.1109/metroi4.2018.8428342` | 32 | Head-to-head OPC UA vs MQTT benchmark. |
| **Raddatz et al. — "Evaluation and Extension of OPC UA Publish/Subscribe MQTT Binding"** | IEEE ICPS, 2020 | `10.1109/icps48405.2020.9274696` | 9 | OPC UA PubSub-over-MQTT broker binding; latency analysis vs client/server — directly relevant to MQTT-transport choice. |
| **Sai Guptha et al. — "Interoperability Between OPC-UA and MQTT in Hybrid Industrial IoT (IIoT) Environments"** | IEEE COMSNETS, 2025 | `10.1109/comsnets63942.2025.10885710` | 9 | Gateway/edge/broker bridging patterns between OPC UA and MQTT — useful for architecture chapter. |
| **Kurdi & Thayananthan — "A Multi-Tier MQTT Architecture with Multiple Brokers Based on Fog Computing for Securing Industrial IoT"** | Applied Sciences, 2022 | `10.3390/app12147173` | 32 | Multi-broker MQTT fog architecture — scalability & security for MQTT deployments. |
| **Boppana & Bagade — "Security risks in MQTT-based Industrial IoT Applications"** | IEEE COINS, 2022 | `10.1109/coins54846.2022.9854993` | 15 | MQTT-specific threat surface — cite in security chapter alongside TLS/ACL discussion. |
| **Rincon et al. — "An Operational 5G Edge Cloud-Controlled Robotic Cell Environment Based on MQTT and OPC UA"** | IEEE ICAR, 2023 | `10.1109/icar58858.2023.10406936` | 2 | Operational edge-cloud MQTT/OPC UA deployment data. |
| **Lekic & Gardasevic — "IoT sensor integration to Node-RED platform"** | IEEE INFOTEH, 2018 | `10.1109/infoteh.2018.8345544` | 100 | Standard citation for Node-RED as IIoT dashboard/integration middleware. |
| **Oton et al. — "Low-Cost Open Source IoT-Based SCADA System for a BTS Site Using ESP32 and Arduino IoT Cloud"** | IEEE UEMCON, 2021 | `10.1109/uemcon53757.2021.9666691` | 28 | Cloud-IoT-SCADA with ESP32/Arduino Cloud. |
| **Abdelsattar, Park & Marzouk — "An OPC UA Client/Gateway-Based Digital Twin Architecture of a SCADA System with Embedded System Connections"** | IEEE/ASME AIM, 2022 | `10.1109/aim52237.2022.9863367` | 14 | OPC UA gateway bridging SCADA ↔ digital twin. |
| **Flamini et al. — "BIM and SCADA integration: the Dynamic Digital Twin"** | IEEE/IAS I&CPS, 2022 | `10.1109/icps54075.2022.9773903` | 15 | SCADA-fed digital twin for building infrastructure. |
| **Sayghe — "Digital Twin-Driven Intrusion Detection for Industrial SCADA"** | Sensors, 2025 | `10.3390/s25164963` | 25 | Digital twin applied to SCADA cybersecurity. |
| **Mahnke, Leitner & Damm — "OPC Unified Architecture"** | Springer (book), 2009 | `10.1007/978-3-540-68899-0` | 573 | Canonical OPC UA reference (IEC 62541). |
| **"On the performance of OPC UA and MQTT for data exchange between industrial plants and cloud servers"** | Acta IMEKO, 2019 | [URL](https://acta.imeko.org/index.php/acta-imeko/article/view/IMEKO-ACTA-08%20%282019%29-02-11) | — | Plant→cloud payload/RTT comparison of OPC UA PubSub vs MQTT. |

## 4. SCADA Security

| Paper | Venue / Year | DOI | Cites | Relevance |
|---|---|---|---|---|
| **Igure, Laughter & Williams — "Security issues in SCADA networks"** | Computers & Security, 2006 | `10.1016/j.cose.2006.03.001` | 571 | Foundational SCADA security paper — threat classes, protocol weaknesses, research challenges. |
| **Nicholson, Webber, Dyer, Patel & Janicke — "SCADA security in the light of Cyber-Warfare"** | Computers & Security, 2012 | `10.1016/j.cose.2012.02.009` | 268 | The requested Nicholson et al. work — incident analysis (Stuxnet etc.), defence-in-depth for SCADA. |
| **Cherdantseva et al. — "A review of cyber security risk assessment methods for SCADA systems"** | Computers & Security, 2016 | `10.1016/j.cose.2015.09.009` | 510 | Benchmark survey of 24 SCADA risk-assessment methods. |
| **Alanazi, Mahmood & Chowdhury — "SCADA vulnerabilities and attacks: A review of the state-of-the-art and open issues"** | Computers & Security, 2023 | `10.1016/j.cose.2022.103028` | 152 | Most recent comprehensive vulnerability/attack review. |
| **Zhu, Joseph & Sastry — "A Taxonomy of Cyber Attacks on SCADA Systems"** | IEEE iThings/CPSCom, 2011 | `10.1109/ithings/cpscom.2011.34` | 309 | Canonical attack taxonomy for SCADA/ICS. |
| **Miller & Rowe — "A Survey SCADA of and Critical Infrastructure Incidents"** | ACM RIIT, 2012 | `10.1145/2380790.2380805` | — | Incident taxonomy by source/method/impact/target. |
| **Ralston, Graham & Hieb — "Cyber security risk assessment for SCADA and DCS networks"** | ISA Transactions, 2007 | `10.1016/j.isatra.2007.04.003` | 216 | Early ISAT-based risk model for SCADA/DCS. |
| **Knowles et al. — "A survey of cyber security management in industrial control systems"** | IJCIP, 2015 | `10.1016/j.ijcip.2015.02.002` | 302 | Governance/standards perspective (incl. IEC 62443). |
| **McLaughlin et al. — "The Cybersecurity Landscape in Industrial Control Systems"** | Proceedings of the IEEE, 2016 | `10.1109/jproc.2015.2512235` | 352 | Broad ICS security landscape survey. |
| **Humayed et al. — "Cyber-Physical Systems Security—A Survey"** | IEEE IoT Journal, 2017 | `10.1109/jiot.2017.2703172` | 1069 | Highest-cited CPS security survey; frames SCADA as CPS component. |
| **Hu et al. — "A survey of intrusion detection on industrial control systems"** | Int. J. Distributed Sensor Networks, 2018 | `10.1177/1550147718794615` | 162 | IDS taxonomy: protocol-analysis / traffic-mining / process-analysis. |
| **Rakas, Stojanovic & Markovic-Petrovic — "A Review of Research Work on Network-Based SCADA Intrusion Detection Systems"** | IEEE Access, 2020 | `10.1109/access.2020.2994961` | 100 | Evaluation methodology + 26-paper review of network IDSs for SCADA. |
| **Zhu & Sastry — "SCADA-specific Intrusion Detection/Prevention Systems: A Survey and Taxonomy"** | Workshop on Secure Control Systems, CPSWeek, 2010 | [URL](https://ptolemy.berkeley.edu/projects/truststc/conferences/10/CPSWeek/papers/scs1_paper_8.pdf) | — | No DOI (workshop paper); influential IDS taxonomy. |
| **Samtani et al. — "Identifying SCADA vulnerabilities using passive and active vulnerability assessment techniques"** | IEEE ISI, 2016 | `10.1109/isi.2016.7745438` | 47 | Shodan/passive-scan methodology for exposed SCADA devices — relevant to threat model for an internet-facing web SCADA. |
| **Shirazi et al. — "Evaluation of Anomaly Detection techniques for SCADA communication resilience"** | IEEE Resilience Week, 2016 | `10.1109/rweek.2016.7573322` | 34 | Anomaly-detection benchmarking on real gas-pipeline SCADA traffic. |
| **Piggin — "Development of industrial cyber security standards: IEC 62443 for SCADA and industrial control system security"** | IET Conf. Control & Automation, 2013 | `10.1049/cp.2013.0001` | 30 | Academic anchor for citing IEC 62443 (zones/conduits, security levels). |

## 5. Open-Source SCADA

| Paper | Venue / Year | DOI | Cites | Relevance |
|---|---|---|---|---|
| **Almas, Vanfretti et al. — "Open source SCADA implementation and PMU integration for power system monitoring and control applications"** | IEEE PES General Meeting, 2014 | `10.1109/pesgm.2014.6938840` | 21 | ScadaBR (browser-based open-source SCADA) lab implementation with DNP3 relays + PMU data. |
| **Prokhorov et al. — "Control systems software implementation using open source SCADA-system OpenSCADA"** | IEEE EIConRus, 2018 | `10.1109/eiconrus.2018.8317069` | 9 | OpenSCADA (openSCADA.org) implementation experience. |
| **de Miranda & Santos — "A Scada system used for monitoring virtual chemical plants via Modbus communication"** | Internet Technology Letters, 2024 | `10.1002/itl2.495` | 1 | ScadaBR + Python scripting + Modbus + UniSim simulator — a Python-backend analogue worth noting. |
| **Aghenta & Iqbal — Electronics 2019 (Thinger.IO/ESP32)** | See §3 | `10.3390/electronics8080822` | 120 | Doubles as open-source IoT-SCADA exemplar. |
| **Zare & Iqbal — IEMTRONICS 2020 (Node-RED/MQTT)** | See §3 | `10.1109/iemtronics51293.2020.9216412` | 42 | All-open-source stack (Node-RED, Mosquitto/MQTT). |
| **"An open source SCADA application in a small automation system"** | Pomiary Automatyka Robotyka (Polish journal) | [URL](https://bibliotekanauki.pl/articles/114673.pdf) | — | ScadaBR on single-board computer for home/heating monitoring. No DOI located. |

## 6. Alarm Management / High-Performance HMI

| Source | Venue / Year | DOI/URL | Cites | Relevance |
|---|---|---|---|---|
| **Wang, Yang, Chen & Shah — "An Overview of Industrial Alarm Systems: Main Causes for Alarm Overloading, Research Status, and Open Problems"** | IEEE Trans. Automation Science & Engineering, 2016 | `10.1109/tase.2015.2464234` | 259 | The key academic alarm-management survey: chattering alarms, alarm floods, lifecycle research agenda. |
| **Liu, Lim, Ho et al. — "The Intelligent Alarm Management System"** | IEEE Software, 2003 | `10.1109/MS.2003.1184170` | 27 | Deployed nuisance-alarm suppression on Yokogawa DCS. |
| **Jensen — "The need for dynamic configuration and other augmentation of distributed control systems for improved alarm management"** | IEE Colloquium "Stemming the Alarm Flood", 1997 | `10.1049/ic:19970747` | 6 | Seminal statement of the alarm-flood problem. |
| **Bullemer et al. / ASM Consortium — "Towards Improving Operator Alarm Flood Responses: Alternative Alarm Presentation Techniques"** | ASM Consortium white paper, 2011 | [URL](https://process.honeywell.com/content/dam/process/en/documents/document-lists/doc_asm-consortium/white-papers/October%2031%202011%20-%20Towards%20Improving%20Operator%20Alarm%20Flood%20Responses%20Alternative%20Alarm%20Presentation%20Techniques.pdf) | — | Empirical HMI/alarm-presentation study (alarm-rate modulation, area-based alarm views) — highly relevant to HMI design decisions. |
| **Bullemer & Reising — "Effective Console Operator HMI Design"** | ASM Consortium guideline, 2013 | asmconsortium.net | — | Industry guideline behind High-Performance HMI practice. |

## 7. Canonical Non-Paper Sources

| Source | Reference | Notes |
|---|---|---|
| **NIST SP 800-82 Rev. 3 — "Guide to Operational Technology (OT) Security"** | Stouffer et al., NIST, Sept. 2023. DOI `10.6028/NIST.SP.800-82r3` | Definitive OT/ICS security architecture, threats, and countermeasures guide. Current revision (Rev. 4 drafting began Jan 2026). |
| **IEC 62443 series / ISA/IEC 62443** | "Security for industrial automation and control systems" | Zones & conduits, SL1–SL4 security levels — framework for the security chapter. Pair with Piggin 2013 (§4). |
| **Boyer — "SCADA: Supervisory Control and Data Acquisition," 4th ed.** | ISA, 2010, ISBN 978-1936007097 | Standard textbook treatment of SCADA functions/comms. (Note: actual title is *Supervisory Control and Data Acquisition* — the "Critical Processes" phrasing doesn't match a real Boyer title.) |
| **Hollifield, Oliver, Nimmo & Habibi — "The High Performance HMI Handbook"** | PAS, 2008, ISBN 978-0977896912 | Grey-palette HMI, display hierarchy, situational-awareness design — basis for HMI design chapter. |
| **Hollifield & Habibi — "Alarm Management: A Comprehensive Guide," 2nd ed.** | ISA, 2011 | Alarm rationalization aligned to ISA-18.2. |
| **Bailey & Wright — "Practical SCADA for Industry"** | Newnes/IDC, 2003 | Engineering-practice complement to Boyer. |
| **Knapp & Langill — "Industrial Network Security," 2nd ed.** | Syngress, 2014 | Standard OT network-security textbook. |
| **ANSI/ISA-18.2-2016 / IEC 62682** | "Management of Alarm Systems for the Process Industries" | Alarm-management lifecycle standard. |
| **EEMUA Publication 191, 3rd ed.** | "Alarm Systems: A Guide to Design, Management and Procurement," 2013 | Source of the ≤1 alarm/10 min normal, ≤10 alarms/10 min upset benchmarks. |
| **ANSI/ISA-101-2015** | "Human Machine Interfaces for Process Automation Systems" | HMI standard underlying HP-HMI practice. |
| **OASIS MQTT Version 5.0 (2019) / MQTT 3.1.1 (Banks & Gupta, 2014)** | [docs.oasis-open.org](https://docs.oasis-open.org/mqtt/mqtt/v5.0/mqtt-v5.0.html) | Normative protocol spec for the MQTT transport layer. |

## BibTeX-Ready DOI List

```
10.1016/j.ijcip.2021.100433      % Yadav & Paul — SCADA arch/security review
10.1109/access.2022.3211288      % Sverko — SCADA survey, Industry 5.0
10.3844/ajassp.2014.1418.1425    % Shahzad — SCADA review
10.1109/rtsi.2016.7740630        % Maccarana — HTML5 SCADA
10.18429/JACoW-ICALEPCS2015-WEPGF069  % Voitier — CERN web UI (DataCite DOI)
10.1155/2021/6668843             % Jeng — SPA WebSocket HMI
10.1016/j.heliyon.2019.e02474    % Vargas-Salgado — web microgrid SCADA
10.48550/arXiv.1501.05725        % Abbas — efficient web SCADA
10.1109/eiconrus49466.2020.9039101 % Sviridov — WEB-based SCADA arch
10.1109/te.2008.921445           % Aydogmus — web remote-access SCADA lab
10.1145/3512716.3512727          % Sverko — early-warning SCADA
10.1016/s2212-5671(15)01419-7    % Turc — web services SCADA mgmt
10.1016/j.proeng.2017.02.432     % Turc — web WSN SCADA
10.1109/med.2018.8442560         % Tidrea — WebNavIGSS
10.1002/etep.2018                % Goose — SKYDA SCADA-as-a-service
10.1109/iecon.2017.8216583       % Porrmann — microservice cloud SCADA
10.1109/cloudcom.2017.25         % Yi — benchmarking cloud SCADA
10.36227/techrxiv.20291835.v1    % Wali — cloud SCADA security survey
10.1109/iemtronics51293.2020.9216412 % Zare — MQTT/Node-RED SCADA
10.3390/electronics8080822       % Aghenta — Thinger.IO IoT SCADA
10.1109/ccece.2019.8861827       % Aghenta — IoT SCADA PV
10.1109/icit.2019.8755050        % Profanter — OPC UA vs MQTT/DDS/ROS
10.1109/metroi4.2018.8428342     % Rocha — OPC UA vs MQTT perf
10.1109/icps48405.2020.9274696   % Raddatz — OPC UA PubSub MQTT binding
10.1109/comsnets63942.2025.10885710 % Sai Guptha — OPC UA/MQTT interop
10.3390/app12147173              % Kurdi — multi-broker MQTT fog
10.1109/coins54846.2022.9854993  % Boppana — MQTT IIoT security risks
10.1109/icar58858.2023.10406936  % Rincon — 5G edge MQTT/OPC UA cell
10.1109/infoteh.2018.8345544     % Lekic — Node-RED IoT integration
10.1109/uemcon53757.2021.9666691 % Oton — ESP32 Arduino-IoT-Cloud SCADA
10.1109/aim52237.2022.9863367    % Abdelsattar — OPC UA DT SCADA gateway
10.1109/icps54075.2022.9773903   % Flamini — BIM-SCADA digital twin
10.3390/s25164963                % Sayghe — DT intrusion detection SCADA
10.1007/978-3-540-68899-0        % Mahnke — OPC UA (book)
10.1016/j.cose.2006.03.001       % Igure — security issues SCADA
10.1016/j.cose.2012.02.009       % Nicholson — SCADA security cyber-warfare
10.1016/j.cose.2015.09.009       % Cherdantseva — SCADA risk-assessment review
10.1016/j.cose.2022.103028       % Alanazi — SCADA vulnerabilities review
10.1109/ithings/cpscom.2011.34   % Zhu — cyber-attack taxonomy SCADA
10.1145/2380790.2380805          % Miller & Rowe — SCADA incidents survey
10.1016/j.isatra.2007.04.003     % Ralston — SCADA/DCS risk assessment
10.1016/j.ijcip.2015.02.002      % Knowles — ICS security mgmt survey
10.1109/jproc.2015.2512235       % McLaughlin — ICS cybersecurity landscape
10.1109/jiot.2017.2703172        % Humayed — CPS security survey
10.1177/1550147718794615         % Hu — ICS intrusion detection survey
10.1109/access.2020.2994961      % Rakas — network SCADA IDS review
10.1109/isi.2016.7745438         % Samtani — SCADA vulnerability assessment
10.1109/rweek.2016.7573322       % Shirazi — anomaly detection SCADA
10.1049/cp.2013.0001             % Piggin — IEC 62443
10.1109/pesgm.2014.6938840       % Almas — open-source ScadaBR PMU
10.1109/eiconrus.2018.8317069    % Prokhorov — OpenSCADA
10.1002/itl2.495                 % de Miranda — ScadaBR Modbus virtual plant
10.1109/tase.2015.2464234        % Wang — industrial alarm systems overview
10.1109/MS.2003.1184170          % Liu — intelligent alarm management
10.1049/ic:19970747              % Jensen — alarm flood DCS
10.6028/NIST.SP.800-82r3         % NIST SP 800-82 Rev 3 OT security guide
```

## Methods & Provenance Notes

- **Semantic Scholar Graph API**: queried `web based SCADA`, `SCADA system survey architecture`, `MQTT SCADA IIoT`, `web SCADA HTML5` — **all returned HTTP 429 (rate limit)**, including after 45s+ waits across three retries. No S2 data was used; everything above comes from Crossref API (`/works` bibliographic queries + per-DOI metadata for ~40 DOIs) and `web_search`.
- **Crossref queries run**: `web based SCADA`, `MQTT SCADA industrial IoT`, `cloud SCADA architecture`, `SCADA security survey vulnerabilities`, `digital twin SCADA`, `IEC 62443 industrial control security`, plus bibliographic lookups for the Heliyon microgrid paper, Cherdantseva, Humayed, Knowles, McLaughlin, Zhu/Sastry taxonomy, Node-RED, OPC UA book, OpenSCADA, `IoT based SCADA system review`, `IIoT SCADA Industry 4.0`, `WebSocket SCADA real-time monitoring`, `SCADA live in the clouds`.
- **Empty/thin results to report**: (a) `SCADA live in the clouds` — no relevant result in Crossref (Taveras's trade book isn't indexed as a paper); (b) `WebSocket + SCADA` — no dedicated academic WebSocket-SCADA paper surfaced; the SPA paper (`10.1155/2021/6668843`) and CERN paper are the WebSocket-using SCADA references; (c) JACoW DOIs (`10.18429/...`) are **not in Crossref** (404) but resolve via DataCite — author/venue verified via INSPIRE-HEP and JACoW RIS export; (d) Zhu & Sastry CPSWeek-2010 workshop paper and the Polish ScadaBR paper have no DOI — URLs given instead.
- **Caveat**: one "SCADA-Based Security Testbed" entry (`10.1002/9781119606383.ch3`) is a Wiley book chapter — excluded as marginal. TechRxiv/preprints (Wali, Sayghe preprint variants) flagged as non-peer-reviewed where applicable.
