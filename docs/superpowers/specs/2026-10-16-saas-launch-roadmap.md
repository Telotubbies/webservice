# WDS — SaaS launch roadmap (functional)

Date: 2026-10-16 · Status: draft · Branch: `feature/design`

## 1. Purpose

This plan takes WDS from "works for the person who runs the stack" to a
multi-tenant SaaS that a plant can sign up for, connect, use daily, and pay
for, without help from us. The focus is functional: what each user can do,
and the acceptance test that proves it. Infrastructure and other
non-functional work is listed only where a feature depends on it (§12).

### Definition of "customer-ready"

A new customer, with no help from us, can:

1. Sign up, verify their email, and create an organization.
2. Enroll a gateway, add a PLC and its tags (or apply a template), and see live values.
3. Build a dashboard, define alarm rules, and receive an alarm notification on their phone.
4. Invite their team with the right roles.
5. See production KPIs (OEE, downtime) and export a report.
6. Choose a plan, pay, and stay inside the plan limits.
7. Export or delete their data, and read the terms and privacy policy they agreed to.
8. Upload a YOLO26 model they trained, choose the classes to predict, see detections live on a camera, and let a detection drive the PLC.

Every phase below moves one or more of these items to "done".

## 2. Current state (audit of the code, 2026-10-16)

| Area | State | Evidence |
|---|---|---|
| Multi-tenancy (orgs/sites/edges, Postgres RLS) | **Real** | `0001_saas_schema`, `tests/tenancy` |
| Sign-in (Keycloak OIDC, per-org IdPs) | **Real** | `auth.py`, `provision_idp.py`, `SignInWall.tsx` |
| Members, roles, invites, API keys, audit export | **Real** | `/api/v1/orgs/{org}/members`, `/invites`, `/api-keys`, `/audit` |
| Live tags, history, WebSocket | **Real** | `/tags/*`, `ws.py` |
| Alarms, alarm rules (CRUD, rule kinds), ack | **Real** | `alarms.py`, `0011_rule_kinds` |
| Downtimes, dashboards, notebooks, SLOs | **Real** | migrations `0007`–`0013` |
| Teams, incidents (status, notes) | **Real (basic)** | `0010_teams_incidents` |
| Commands to PLC (lifecycle, audit) | **Real** | `commands.py` |
| Insights, inference (AI model via env) | **Real (env-configured)** | `insights.py`, `inference.py` |
| Vision AI (cameras, customer models, vision rules) | **Specified for one fixed model, not built** | data-sources spec §6–7; extended to bring-your-own-model in §13 |
| Gateway enrollment, edges rotate/disable | **Real (partial)** | `/edges` routes; enrollment code not yet built |
| PLC / tag / camera setup from the web | **Specified, not built** | data-sources spec, Phase A plan 0/30 tasks |
| Alarm quality, processes, synthetics | **Demo data** | feature-flagged, no backend |
| Logs, errors, traces, sessions, security, metrics, query | **Client-side view of existing APIs or demo data** | feature-flagged |
| Self-serve signup and org creation | **Missing** | no `POST /api/v1/orgs` |
| Outbound notifications (email, LINE, webhook…) | **Missing** | no channel code in `alarms.py` |
| Billing, plans, usage limits | **Missing** | — |
| Platform admin (back-office across tenants) | **Missing** | — |
| OEE, shifts, reason codes, scheduled reports | **Missing** | — |
| Data retention per tenant, PDPA export/delete | **Missing** (one global prune job) | `HISTORY_PRUNE_S` |

The working tree also has 85 uncommitted files, including migrations
`0008`–`0013`. That is Phase 0.

## 3. Users and core journeys

| Persona | Role | Must be able to |
|---|---|---|
| Owner / plant manager | `owner` | sign up, create org, pick plan, pay, see KPIs and reports, invite people |
| Automation engineer | `admin` | enroll gateways, add PLCs/tags/cameras, write alarm rules, manage API keys |
| Supervisor | `operator` | watch lines, ack alarms, run incidents, record downtime reasons, send commands |
| Line worker | `viewer` / `operator` | see values and alarms on a screen or phone, ack alarms |
| WDS staff | platform admin (new) | see all tenants, suspend, support with audited impersonation |

**Journey J1, first hour:** landing → sign up → verify email → create org and
site → onboarding checklist → enroll gateway → apply template → live
dashboard → invite a colleague.

**Journey J2, a normal shift:** an alarm fires → the on-call person gets a
LINE/email message → acks it from the phone → a downtime is recorded with a
reason → the shift report shows the lost minutes.

**Journey J3, the month:** the owner gets a monthly OEE report by email →
sees usage against plan limits → upgrades the plan → gets a tax invoice.

## 4. Phase 0: Stabilize the current branch (prerequisite)

| # | Requirement | Acceptance |
|---|---|---|
| 0.1 | Commit the 85 pending files in reviewable commits (backend, migrations, web) | `git status` clean; each commit builds |
| 0.2 | Migrations `0008`–`0013` apply on a fresh DB and on a copy of the current DB | `make migrate` on both; `tests/tenancy` green |
| 0.3 | Every new table has fail-closed RLS | RLS test per table: cross-org read and write both blocked |
| 0.4 | All suites green: contract, tenancy, security, integration, UAT | CI green on `ui-v4` after the merge |
| 0.5 | Remove dev-only allowances from the prod realm (`:5199` origin, direct grants) | prod realm export diff reviewed |

## 5. Phase 1: Self-serve accounts and tenancy

### 1.1 Sign-up and email verification
- Public sign-up page (email + password, or Google/Microsoft SSO) using Keycloak self-registration.
- Email verification is required before an org can be created.
- Password reset, and optional MFA (TOTP) per user. Owners can make MFA mandatory for the org.
- **Acceptance:** a new email address can sign up, verify, and reach the "create organization" step. An unverified user cannot reach any org data.

### 1.2 Create organization and first site
- `POST /api/v1/orgs` creates the org, makes the creator `owner`, and creates a default site.
- Org slug must be unique and URL-safe. Timezone and language (Thai/English) are set at creation.
- A user can belong to several orgs and switch between them from the top bar.
- **Acceptance:** after creation, the user lands in an empty org with RLS context set; a second user in another org cannot see it (tenancy test).

### 1.3 Onboarding checklist
- First-run checklist in the console: (1) enroll gateway, (2) add data source or apply template, (3) create first dashboard, (4) add an alarm rule, (5) set a notification channel, (6) invite a teammate.
- Each step links to the right page and ticks itself when done (derived from data, not a manual flag).
- Empty states on every page explain the next action instead of showing a blank table.
- **Acceptance:** a fresh org shows 0/6; completing each action in the UI ticks the matching step without a reload.

### 1.4 Members and roles (extend what exists)
- Invites already exist. Add: resend, expiry shown, invite by bulk paste, and an "accepted by" record.
- Per-site access: a member can be limited to some sites.
- Transfer ownership; an org must always have at least one owner.
- **Acceptance:** an operator limited to site A gets 404 on site B (API and UI); the last owner cannot be removed or demoted.

### 1.5 Org settings
- Name, logo, timezone, language, units, working calendar (used by OEE in Phase 5).
- Enterprise SSO (per-org IdP, already in the backend) gets a settings page with a "test connection" button.
- **Acceptance:** changing the timezone changes every timestamp in the UI and in reports.

### 1.6 Leave and delete
- A user can leave an org; an owner can delete it. The delete is soft for 30 days, then purged.
- **Acceptance:** a deleted org is unreachable at once, restorable for 30 days, and gone from the DB and backups after the retention window (see 8.3).

## 6. Phase 2: Getting data in (already specified)

This is the existing spec,
`docs/superpowers/specs/2026-10-15-data-sources-and-vision-design.md`. It is
not repeated here. To launch, it is needed up to and including:

| Spec phase | Needed for launch | Why |
|---|---|---|
| A: gateway enrollment, PLC connections, tags from the web, templates | **Yes** | without it no customer can connect anything; templates serve non-technical owners (G6) |
| B: cameras, video upload, vision-worker, frame relay, vision rules (spec §6) | **Yes**, as the base that §13 builds on | the thesis demo, and customers who already have a trained YOLO26 model |
| C: getting-started checklist, per-org AI settings (spec §7) | **Yes**, with one change: the per-org "Vision model URL" (spec §7.2) is replaced by the model registry (§13.3) and external endpoints (§13.6); the tag-inference URL setting stays | |
| D: GPU variant (G8), multi-replica fan-out (G14) | **Yes**, inside §13.5 (M1 for the GPU variant, M2 for fan-out with cloud fallback) | |
| D: recording (G13), S7/Modbus discovery (G12) | After launch (M4) | |
| E: model registry (G11) | **Yes**, replaced by §13.3 | |
| E: labeling (G9), training (G10), remote access (G15) | After launch (M4) | customers train off-platform for now |

Two additions to the spec for SaaS:

- **2.1 Gateway installer:** a one-line install (Docker on Linux, and on Windows through Docker Desktop) with the enrollment code, plus a gateway status page (version, last seen, config version, update available).
- **2.2 Tag import/export:** CSV import/export of the tag list, for engineers who already have tag tables.

## 7. Phase 3: Alerting that reaches people

Alarms exist today but only show up inside the console. For a customer,
an alarm that does not reach a phone is not an alarm.

### 3.1 Notification channels (per org)
- Channel types: **email**, **LINE** (Messaging API; LINE Notify has been shut down), **Microsoft Teams / Slack** webhook, **generic webhook** (signed with HMAC), **SMS** (optional, paid add-on).
- Each channel has a "send test" button and a delivery log (sent, failed, retried).
- **Acceptance:** a test message arrives on each channel type; a failed delivery is retried with backoff and shows in the log.

### 3.2 Routing
- An alarm rule chooses where it notifies: channels, teams, or the on-call person of a team.
- Severity filters (e.g., only critical goes to SMS).
- Downtimes (maintenance windows, already built) suppress notifications.
- De-duplication: one message per alarm episode, plus a message on clear (configurable).
- **Acceptance:** a rule routed to team X notifies only team X's channel; during a downtime, no message is sent but the alarm is still recorded.

### 3.3 On-call and escalation
- Teams get a weekly on-call rotation and overrides.
- Escalation policy: if not acked in N minutes, notify the next level.
- **Acceptance:** an un-acked critical alarm escalates after N minutes; an ack stops the escalation.

### 3.4 Act from the message
- Messages carry a signed, single-use link to ack the alarm (requires sign-in if the session has expired).
- Mobile-friendly alarm list (PWA, installable, works on a phone at the line).
- **Acceptance:** ack from a phone with a link; the ack appears in the audit log with the user's identity.

### 3.5 Alarm lifecycle completeness
- Shelve (silence one alarm for a time), comment, and assign. Every action is audited.
- Alarm quality (now demo data) is computed from real data using ISA-18.2 metrics: alarms per operator per hour, standing alarms, chattering alarms, top 10 bad actors.
- **Acceptance:** the alarm quality page matches a hand count on a test dataset.

## 8. Phase 4: Turn every page real, or hide it

A paying customer must never see fake numbers. Decision per flagged page:

| Page | Decision | Functional requirement |
|---|---|---|
| Alarm quality | **Make real** | see 3.5 |
| Events | **Make real** | one timeline of alarms, commands, config changes, and incidents, filterable by site, tag, and type |
| Logs | **Make real** | gateway and data-source logs shipped from the edge (connection errors, config apply results), searchable, 7–30 day retention per plan |
| Query | **Make real** | read-only tag history query (tag, time range, aggregation) with CSV export; no raw SQL for tenants |
| Metrics (summary) | **Make real** | per-tag stats: min, max, avg, sample count, last value, data gaps |
| Teams, incidents | **Keep, finish** | add on-call (3.3), link incidents to alarms, postmortem notes |
| Catalog | **Merge** into an "Assets" page: line → machine → tag hierarchy |
| Security | **Repurpose** as an org security page: sign-in history, API key use, MFA status per member |
| Assistant | **Keep behind flag** until it answers from real tenant data with citations; then launch as a paid add-on |
| Errors, traces, processes, sessions, synthetics | **Remove from the customer build** | these are software-APM concepts; plants do not need them. Keep the code out of the prod nav |

**Acceptance:** a prod build with `VITE_FEATURES` empty shows no page that
uses demo data; a test fails the build if a demo data module is imported
by a page in the prod nav.

## 9. Phase 5: Production value (what owners pay for)

### 5.1 Shifts and calendar
- Define shifts per site (e.g., 08:00–16:00, 16:00–24:00), breaks, and planned non-working days.
- **Acceptance:** the current shift shows in the top bar; KPIs can be grouped by shift.

### 5.2 Machine state and downtime reasons
- Map tags to machine states (running, idle, stopped, fault) per machine.
- Stops longer than a threshold ask the operator for a reason code from a per-org reason tree (e.g., Mechanical → Jam).
- **Acceptance:** a 5-minute stop creates a downtime record that an operator can classify from the phone.

### 5.3 OEE
- Availability, performance, and quality from state, count, and reject tags, per machine, line, shift, and day.
- Ideal cycle time is set per machine/product.
- Pareto of downtime reasons, and a trend over weeks.
- **Acceptance:** on the Factory I/O sorting line, OEE matches a hand calculation from the same raw data to within 0.5%.

### 5.4 Reports and export
- Report templates: shift report, daily production, weekly OEE, monthly alarm summary.
- Schedule by email (PDF + CSV), or download on demand.
- Export any table or chart to CSV; export tag history by range.
- **Acceptance:** a scheduled daily report arrives at 07:00 local org time with yesterday's numbers.

### 5.5 Integrations out
- Outbound webhooks for events (alarm raised/cleared, downtime classified, incident opened), signed with HMAC and retried.
- Public REST API documented (OpenAPI page per org, using the existing API keys), with rate limits per plan.
- **Acceptance:** a customer can pull hourly OEE through the API with an API key, and receives a webhook on each alarm.

## 10. Phase 6: Plans, limits, and billing

### 6.1 Plans
| | Trial (14 days) | Starter | Pro | Enterprise |
|---|---|---|---|---|
| Sites | 1 | 1 | 5 | custom |
| Gateways | 1 | 2 | 10 | custom |
| Tags | 100 | 500 | 5,000 | custom |
| Users | 5 | 10 | 50 | unlimited |
| History retention | 7 days | 90 days | 1 year | custom |
| SSO (per-org IdP), audit export | — | — | yes | yes |
| Cameras | 1 | 2 | 20 | custom |
| Custom vision models (§13) | 1 | 2 | 10 | custom |
| Cloud inference (§13.5) | 2 GPU-hours | — | 20 GPU-hours/month, then metered | custom |
| SMS, assistant | — | add-on | add-on | included |

The numbers are placeholders to be validated with pilot customers.

### 6.2 Limit enforcement
- Every create endpoint (site, edge, tag, member, camera) checks the plan limit and returns `402 plan_limit` with the limit name.
- The UI shows usage against limits (settings → plan) and warns at 80%.
- Retention is applied per org, replacing the single global prune job.
- Going over a limit never drops incoming data silently: new tags are refused at creation, not at ingest.
- **Acceptance:** creating tag #501 on Starter returns 402 and the UI offers an upgrade; history older than the plan's retention is pruned only for that org.

### 6.3 Payment
- Provider: Stripe (cards, and PromptPay in Thailand) or Omise. Pick one before building.
- Self-serve checkout, upgrade/downgrade with proration, cancel at period end.
- Thai tax invoice / receipt with VAT and the customer's tax ID.
- Dunning: failed payment → emails → 7-day grace period → read-only mode (data kept, no new config, alarms still notify).
- **Acceptance:** a full trial → paid → card fails → grace → read-only → payment → restored cycle passes in the provider's test mode.

**Recommendation:** for the first 1–3 pilot customers, skip 6.3. Set plans
by hand from the back-office (7.1) and invoice manually. Build 6.1 and 6.2
first, because limits protect the platform whatever the payment method.

## 11. Phase 7: Platform back-office (WDS staff)

### 7.1 Tenant management
- List all orgs with plan, usage, last activity, gateway health, and MRR.
- Change plan or limits by hand, extend trials, suspend or restore an org.
- **Acceptance:** a suspended org's users see a "suspended" page; its gateways stay connected but commands are refused.

### 7.2 Support access
- "Access as support" into a tenant: time-boxed (e.g., 1 hour), needs a reason, is read-only by default, is visible to the tenant's owners, and is written to the tenant's audit log.
- **Acceptance:** the tenant owner sees the support session in their audit log with the reason given.

### 7.3 Operations
- Per-tenant feature flags (replacing the build-time `VITE_FEATURES` for paid add-ons).
- In-app announcements (maintenance notice banner).
- Platform health: ingest rate, notification delivery rate, failed jobs.

## 12. Phase 8: Trust, legal, and support (needed before the first paid customer)

| # | Requirement | Acceptance |
|---|---|---|
| 8.1 | Terms of Service, Privacy Policy, and PDPA consent recorded at sign-up (version and timestamp) | consent row per user; new versions ask again |
| 8.2 | Data export: the owner downloads all org data (config, tags, history, alarms, audit) as a zip | export of a test org re-imports into an empty org |
| 8.3 | Data deletion: org delete purges data after 30 days, including from backups after their rotation | documented and tested purge job |
| 8.4 | Public status page (uptime, incidents) and an email for support | status page live on its own domain |
| 8.5 | In-app help: docs site (getting started, gateway install, PLC setup per protocol, FAQ) linked from every empty state | each onboarding step links to a doc page |
| 8.6 | Full Thai and English for every page, email, and report | no missing i18n keys in CI |
| 8.7 | Works on a phone for the alarm list, ack, and dashboards (read-only) | UAT on a 390 px viewport |
| 8.8 | Accessibility: WCAG 2.1 AA for sign-up, onboarding, alarms, dashboards | axe scan clean on those pages |

### Non-functional items that block features above
Short list only. Details live in the SDLC docs (AWS target architecture, doc 18 ops).

- Production hosting (AWS target), domain, TLS, and a separate prod Keycloak realm.
- Time-series storage that scales per tenant (TimescaleDB, already planned) for 5.3/5.4 and 1-year retention.
- A background job runner (notifications, reports, retention, exports) with retries. Several phases depend on it, so build it once in Phase 3.
- Transactional email provider (SES or similar) with SPF/DKIM, for 1.1, 3.1, 5.4, and 6.3.
- Multi-replica backend (spec G14) before more than a handful of tenants.
- Daily backups with a tested restore (`make backup`/`restore` exist; automate and monitor them).
- Object storage for model files, thumbnails, and exports, with signed download URLs (9.1, 9.5, 9.8).
- A sandboxed converter job for `.pt` uploads (9.1) and a GPU pool for cloud inference (9.5).
- An external penetration test before launch. It must include the model upload path.

## 13. Phase 9: AI vision, bring your own model

### Decisions (user, 2026-10-16)

- **Bring your own model.** A customer uploads model weights they trained
  themselves (Ultralytics YOLO26), chooses which of the model's classes to
  predict, and runs it on their cameras straight away. WDS does not label or
  train in this phase; spec goals G9–G10 move to M4.
- **Edge first, cloud fallback.** Inference runs on the plant gateway by
  default. Our cloud GPU pool runs cameras whose gateway cannot keep up, or
  plants with no capable hardware.
- **Licence.** Ultralytics YOLO26 is AGPL-3.0 unless an Enterprise licence
  is held. That is acceptable for the thesis. Selling the service is
  blocked until open decision 6 (§16) is settled.

This section supersedes the single-model contract in the data-sources spec
§7.3 and extends its camera, vision-worker, and vision-rule design (§6.1–6.5),
which stays valid.

### Supported models

| | Launch | Later |
|---|---|---|
| Family | Ultralytics YOLO26 (NMS-free end-to-end head) | YOLO11/v8 exports; other ONNX detectors through an adapter |
| Tasks | detect, segment | pose, oriented boxes (OBB), classify |
| Upload formats | `.onnx` (preferred), `.pt` (converted, see 9.1) | TensorRT `.engine` uploads are not accepted, because engines are tied to one GPU and driver |
| Sizes | n, s, m, l, x; max file 500 MB | |

### 9.1 Upload and inspect a model

- Admins upload from **Vision → Models → Upload model**: drag a file in, or pick one.
- **`.pt` files are never loaded by the backend.** A `.pt` file is a Python
  pickle and can run code when it is loaded. The file goes to an isolated
  converter job (no network, read-only filesystem except an output folder,
  CPU/memory/time limits, non-root user) that exports it to ONNX. Only the
  ONNX file is stored and sent to gateways. The original `.pt` is deleted
  after conversion.
- Inspection reads, from the ONNX metadata: task, class list (id → name),
  input size, stride, Ultralytics version, opset, file size, and sha256.
- If the class names are missing, the admin pastes them (one per line). The
  count must equal the model's class output size.
- Unknown output shapes or unsupported operators are rejected with a reason
  the admin can act on (e.g., "exported with `nms=True` from an older
  version; re-export with YOLO26 default settings").
- **Acceptance:**
  - an official `yolo26n.pt` and `yolo26n-seg.pt` each become a model with 80 classes and the right task;
  - a crafted pickle that tries to write a file outside the output folder, or to open a network socket, fails without effect;
  - a wrong class-name count is refused, with both counts shown.

### 9.2 Test before use

- A test panel on the model page: drop an image or short clip, or take a frame from a live camera. It shows boxes/masks, the class list with scores, and the latency on the reference CPU.
- A confidence slider updates the preview without re-running the model.
- **Where the test runs** (designer's call):
  - on one of the org's online gateways, picked by the admin and defaulting
    to the most capable one, sent as a test job over the existing `cfg`
    channel;
  - in M2 it can also run on the cloud pool;
  - WDS does not run customer models on a shared server in M1;
  - with no gateway online, the panel is disabled and says why.
- **FPS estimate in the deploy step:**
  - before a version is pinned, the estimate comes from a lookup table
    (model size × the gateway's reported hardware) and is labelled
    "estimate";
  - the 20-frame benchmark (9.5) replaces it after pinning.
- **Acceptance:** on the reference gateway (open decision 8), a test result appears within 10 s for an `n` model; changing the slider redraws in under 100 ms.

### 9.3 Model registry and versions

- A model has versions. Each version is immutable once saved: file, sha256, classes, task, input size, who uploaded it, notes.
- States: `draft` (testable only) → `active` (can be pinned to cameras) → `archived`.
- **Licence attestation:** activating a version needs the uploader to tick
  "My organization has the right to use this model commercially". The tick
  is stored with the user and time.
- A camera pins **one exact version**. To upgrade, pick the new version. The
  UI shows a class diff (added, removed, renamed by id). Rules or
  per-class settings that use a removed class block the upgrade until they
  are fixed.
- One-click rollback to the previous version on each camera.
- An archived or pinned version cannot be deleted. Deletion of an unpinned version removes the file from storage and from every gateway cache.
- **Acceptance:**
  - an upgrade that drops a class used by a rule is blocked, and the rule is named in the message;
  - after a rollback, the camera runs the previous version within one config cycle.

### 9.4 Choose the classes to predict (per camera)

- The camera page lists the pinned model's classes in a table: **enabled**,
  display name (Thai and English), minimum score (0.05–0.95, slider plus
  number box), colour, **alert class** (marks the class as abnormal for
  colour and alarms), and a live count.
- Only enabled classes are drawn, counted, stored, or used by rules. The
  model server filters them out after inference, so disabled classes cost
  nothing downstream.
- **Class sets:** save a selection plus thresholds as a named preset (e.g.,
  "QC line A"), and apply it to other cameras that use the same model.
- **Acceptance:**
  - disabling a class removes it from the overlay within 1 s, and no event is stored for it afterwards;
  - a threshold change applies without restarting the stream.

### 9.5 Where the model runs

- **Gateway capability report.** Each gateway reports CPU, cores, RAM, GPU
  (CUDA and TensorRT versions, VRAM), Jetson model, and OpenVINO
  availability, plus current load. It is shown on the gateway page.
- **Placement per camera:** `Auto` (default), `Edge`, or `Cloud`.
  - `Auto` picks the gateway if the estimated FPS meets the camera's sample
    rate.
  - Otherwise it picks cloud, if the plan allows.
  - Otherwise it stays on the gateway at a lower FPS and shows a warning.
  - The estimate comes from a 20-frame benchmark the gateway runs when a
    version is first pinned.
- **Edge platforms by milestone** (designer's call):
  - **M1:** x86-64 Linux Docker in a CPU image and an NVIDIA CUDA/TensorRT
    image, plus Windows through Docker Desktop (WSL2), because the Factory
    I/O demo runs on Windows.
  - **M2:** Jetson (ARM64/L4T) and an OpenVINO image.
  - A native Windows service is not planned.
- **Edge runtime:** one model server per gateway, using ONNX Runtime
  execution providers in this order: TensorRT, CUDA, OpenVINO, CPU.
  - A TensorRT engine is built once per (model version, GPU) and cached.
    Build progress shows on the camera.
  - Several cameras that use the same version share one loaded model.
- **Distribution:**
  - the gateway receives the pinned version through the existing `cfg`
    message;
  - it downloads the file through a short-lived signed URL and checks the
    sha256;
  - it keeps the last two versions for rollback;
  - once downloaded, the model runs with the internet down.
- **Cloud fallback:**
  - the same model server image runs on a GPU pool;
  - the vision-worker sends sampled JPEG frames over its existing outbound
    WSS;
  - usage is metered as GPU-seconds per org (counted against the plan in
    §10);
  - the camera shows a `Cloud` badge with its measured latency.
- **Failover:**
  - if the edge model server fails 3 times in 5 minutes, `Auto` cameras
    move to cloud (if allowed) and an alarm is raised;
  - they move back after 10 healthy minutes on the gateway.
- **PLC safety:**
  - a vision rule that writes to a PLC runs from cloud inference only if the
    admin turns on "Allow PLC writes from cloud inference" **on that rule**
    (default off);
  - the rule editor shows the expected detection-to-write latency for the
    current placement;
  - if a camera fails over to cloud and its rules do not allow cloud
    writes, those rules pause and record `blocked_reason = cloud_placement`.
- **Acceptance:**
  - on a gateway without a GPU, `yolo26n` at 5 FPS stays on the edge, and `yolo26x` at 5 FPS moves to cloud under `Auto`;
  - killing the edge model server three times moves the camera to cloud and raises an alarm;
  - with the internet unplugged, an edge camera keeps detecting and its PLC rules keep firing, and the events sync when the link returns.

### 9.6 External model endpoints (optional)

- A model of kind `external` calls a hosted service instead of a file. Supported:
  - Roboflow Inference (self-hosted or Roboflow cloud);
  - a Hugging Face Inference Endpoint running a custom container;
  - any HTTP server that speaks the contract in 9.10.
- An adapter per provider maps responses to the WDS detection schema. The class list is fetched from the endpoint or typed in. The API key is stored encrypted, write-only.
- External models never write to a PLC by default (same switch as cloud placement), and the page warns that frames leave the plant.
- Hugging Face's serverless Inference Providers are not a target. They serve detection only through one general model (DETR), have no segmentation partner, and take one image per request.

### 9.7 Vision rules (extends spec §6.5)

**Where rules run (changes spec §6.5; follows from the user's edge-first
choice, which was "a PLC write never depends on the internet"):**

- **Edge-placed camera:** the rule is evaluated **on the gateway**, next
  to the model server. The gateway applies a local command gate that
  mirrors `commands.py`:
  - range check against the tag's limits;
  - one write in flight per tag;
  - a per-tag rate limit;
  - every off switch (rule, camera, site `control_enabled`, org "AI may write
    to PLC"), cached from the last `cfg`.
- **Cloud-placed camera:** the rule is evaluated in the backend, exactly
  as spec §6.5 describes, and is gated by "allow cloud write" (9.5).
- **Rule config** is still written only in the backend and delivered by
  `cfg`. The gateway never edits rules.
- **Audit:**
  - every edge-fired write produces a signed command record (the same fields
    as a backend command, `source = edge_rule`);
  - the record is published at once and buffered on disk while offline, then
    replayed in order when the link returns;
  - the backend verifies the signature, writes the audit row with both times
    (fired and synced), and links the record to the vision event.
- **Off switches while offline:**
  - a switch turned off in the backend reaches the gateway only when it
    reconnects;
  - as a safety bound, a gateway that has been offline longer than the
    org's **offline write window** (default 15 min, 0 to disable offline
    writes) stops PLC writes, keeps detecting and alarming locally, and
    shows that on reconnect;
  - a physical stop on the line stays the real safety layer, and the docs
    say so.

**Conditions and actions:**

- **When:** class in a set, score ≥ value, inside a drawn zone, box area ≥
  value, present for N consecutive frames or T ms, count in zone ≥ k.
- **Then** (one or more):
  - write a PLC tag (with optional pulse), through the existing command path;
  - raise an alarm with a severity, which then goes through the notification routing in Phase 3;
  - increment a counter tag, so vision rejects feed OEE quality (5.3);
  - send a notification;
  - save a snapshot.
- New rules start in **dry run**. The rule page shows what it would have
  done for the last hour, so the admin can tune it before going live.
- All the spec's off switches, the audit trail, and the "dropped, not
  queued" behaviour stay as written.
- **Acceptance:**
  - a dry-run rule records "would fire" events and never sends a command;
  - a live rule on the Factory I/O demo rejects a defective part within the measured latency budget.

### 9.8 Detection events and review

- **What is stored** (designer's call):
  - the gateway tracks objects across frames (ByteTrack-style IoU tracking),
    so one object passing the camera is **one detection**, not one per frame;
  - it stores a `vision_events` row for:
    - every rule fire, blocked fire, or dry-run "would fire";
    - every tracked object of a class marked **alert**;
  - each of those rows gets a thumbnail;
  - other enabled classes are not stored per object. They become per-minute
    counts per class and camera, stored as metrics and used for charts, OEE,
    and the live counts in 9.4.
  - Plan limits count stored events per month.
- An event list with thumbnail, class, score, camera, model version, rule, action result, and any `blocked_reason`. Filters: camera, class, rule, time, outcome.
- Reviewers mark an event **correct** or **wrong** (and the right class, if
  wrong). Wrong detections can be exported as a dataset ZIP in YOLO format,
  with the frames and corrected labels, so the customer can retrain
  off-platform and upload a new version.
- Events and thumbnails follow plan retention (30 days by default).
- **Acceptance:** an export of 50 marked events opens in Ultralytics training without edits.

### 9.9 Monitoring

- Per camera: input FPS, inference FPS, latency p50/p95, dropped frames, last frame age, placement, model version, engine (TensorRT/CUDA/OpenVINO/CPU).
- Built-in alarms, routed like any other alarm:
  - camera offline;
  - model failed to load;
  - latency over the rule's budget;
  - cloud fallback active;
  - GPU-hours at 80% of the plan.
- **Acceptance:** each built-in alarm can be triggered in a test and reaches a notification channel.

### 9.10 Model server contract (edge and cloud)

```text
GET    /v1/health                 → {device, providers[], gpu_mem_mb, loaded[]}
PUT    /v1/models/{version_id}    {url, sha256, task, imgsz, classes[]} → 202, then loaded|failed
DELETE /v1/models/{version_id}
POST   /v1/infer?model={version_id}&classes=0,3&conf=0.25   body: image/jpeg
       → {model, ms, detections:[{class_id, class, score,
          bbox:[x,y,w,h] (0..1), polygon?:[[x,y],...] (0..1)}]}
POST   /v1/benchmark?model={version_id}&frames=20 → {fps, ms_p50, ms_p95, provider}
```

The output is untrusted, exactly like `inference.py::_clean`: caps on
count and string length, clamped scores, and polygons simplified to at most
64 points.

### 9.11 Data model (new tables, all with fail-closed RLS)

```text
vision_models          id, org_id, name, kind ('file'|'external'), task, created_by
vision_model_versions  id, model_id, version, status, artifact_key, sha256, format,
                       imgsz, classes jsonb, size_bytes, ultralytics_version,
                       license_attested_by, license_attested_at, notes
external_endpoints     id, model_id, provider, url, key_enc
camera_models          camera_id, model_version_id, placement ('auto'|'edge'|'cloud'),
                       class_config jsonb  -- per class: enabled, names{th,en}, min_score, colour, alert
class_presets          id, org_id, model_id, name, class_config jsonb
edge_capabilities      edge_id, reported_at, cpu, ram_mb, gpu jsonb, providers[]
inference_usage        org_id, day, placement, frames, gpu_seconds
vision_event_reviews   event_id, verdict, corrected_class_id, reviewed_by, reviewed_at
```

`vision_rules` and `vision_events` from the spec gain `model_version_id`,
`dry_run`, and `allow_cloud_write`.

## 14. UX/UI requirements (whole product)

The console already has a visual system: `web/src/dd-theme.css` and
`SDLC/datadog/design/04-ux-ui.md`. New screens follow it and do not invent
a new look. Polish comes from precision: dense but calm layouts, aligned
numbers, honest states, and colour kept for things that are wrong.

### 14.1 Rules for every screen

| # | Rule | Check |
|---|---|---|
| U1 | All six states exist: loading (skeleton), empty (says the next action), error (retry), stale/offline, no permission (explains the role needed), demo data (labelled) | review checklist per PR |
| U2 | ISA-101 colour: neutral by default; red and amber only for abnormal states, always with an icon and text | no raw hex in TSX; tokens only |
| U3 | Every list is an explorer: omnibar `key:value`, facets with counts, sortable table, bulk actions where it makes sense | same `Product.tsx` components |
| U4 | Time range and filters live in the URL, so every view can be shared and the back button works | deep link test |
| U5 | Destructive or plant-affecting actions confirm in one sentence that says what cannot be undone | `Confirm.tsx` |
| U6 | Wizards use the stepper; the user can go back until the step that creates something real | `AddDeviceWizard` pattern |
| U7 | Numbers use tabular figures and units; timestamps use the org timezone and show relative time on hover | visual review |
| U8 | Keyboard: everything reachable, visible focus, no traps; every drag has a click or keyboard alternative (WCAG 2.5.7) | keyboard-only UAT |
| U9 | Contrast 4.5:1 for text, including pills on tinted fills (use the `-ink` tokens) | axe scan in CI |
| U10 | Thai and English complete for UI, emails, and reports; Thai line-breaking checked in narrow columns | missing-key check in CI |
| U11 | Phone width 390 px works for alarms, ack, detection review, and camera view; dense explorers may scroll inside their table, never the page | UAT at 390 px |
| U12 | Motion 120–300 ms, only for state changes; everything respects `prefers-reduced-motion` | review |

### 14.2 Rules for live video and AI

| # | Rule |
|---|---|
| V1 | Overlay labels show the class name and score as text, not colour alone. Boxes use a 2 px stroke with a label chip. Masks use about 35% fill. |
| V2 | Class colours come from a fixed categorical palette assigned in class order, so a class keeps its colour on every screen. Classes marked **alert** use the danger colour, and only those do. |
| V3 | Freshness is always visible. If the newest frame is older than 2 s, the tile dims and shows "Stale 5 s". An offline camera shows its last frame in grey with the time it was taken. A tile never looks live when it is not. This needs the capture time of each frame in the browser. The spec's MJPEG relay does not carry it, so the builder chooses between a WebSocket frame channel and an MJPEG stream plus a timestamp side channel. |
| V4 | Every stream can be paused. Tiles that are off-screen or in a background tab stop pulling frames. With reduced motion, the camera wall switches to a snapshot every 2 s. |
| V5 | A placement badge on every camera reads `Edge · TensorRT · 18 ms` or `Cloud · 140 ms`, so people know where the AI runs and how fast it is. |
| V6 | Overlay on/off, class toggles, and threshold changes apply live, with no reload and no dialog. |
| V7 | Zones are drawn by clicking points on a frozen frame, with drag handles. Alternatives: preset zones (full frame, left/right half, centre band) and a numeric point editor for keyboard users. |
| V8 | Screen readers get one polite, atomic status per camera that is rate-limited to once every 10 s (e.g., "Camera 2: 3 defects in the last minute"), never a stream of per-frame announcements. |
| V9 | Anything that can write to a PLC carries a visible "Writes to PLC" marker, and its toggle needs a confirm that names the tag and value. |

### 14.3 Vision screens

All live under a new **Vision** nav group: Cameras · Models · Rules · Events.

| Screen | Purpose | Layout and key interactions | Empty state |
|---|---|---|---|
| **Camera wall** | watch many lines at once | 1/4/9/16 grid picker; each tile shows name, status, placement badge, alert-class count; click opens detail; group by site/line | "No cameras yet." Two actions: add an RTSP camera, or upload a video to try it out |
| **Camera detail** | see and tune one camera | large video left with overlay toggle and pause; right panel tabs: **Classes** (table from 9.4), **Rules**, **Events**, **Health** (9.9 numbers with sparklines); the model version and placement live in the header with a "Change" action | n/a |
| **Models list** | manage uploaded models | explorer table: name, task, latest version, classes, cameras using it, status; facets by task/status | "Upload a YOLO26 model you trained." Link to the export guide |
| **Upload model** (wizard) | get a model running | 1 Upload (progress, sha256) → 2 Inspect (task, classes, input size; paste names if missing) → 3 Test (drop an image; live slider) → 4 Licence and save → 5 Deploy (pick cameras; per-gateway FPS estimate and placement preview) | n/a |
| **Model detail** | versions and safety | version timeline; class list; test panel; "used by" cameras and rules; class diff when comparing two versions | n/a |
| **Rule builder** | turn detections into actions | sentence layout "When [class] [score ≥ 0.6] [in zone] for [3 frames] → then [write Pusher = 1, pulse 500 ms]"; frozen frame for the zone on the right; dry-run results below; latency budget shown next to the PLC action | "Rules turn detections into actions." Starter template: "Reject part when defect seen" |
| **Events** | review what the AI saw and did | explorer with thumbnail column; side panel with full frame, boxes, rule, command result; keyboard shortcuts C (correct) / W (wrong) / ↑↓ (next); bulk mark; export ZIP | "No detections yet." Links to the class table if all classes are off |
| **Gateway → AI tab** | can this gateway run the model? | capability card (CPU/GPU/providers), loaded models, benchmark results, cloud usage this month against plan | "This gateway has not reported its hardware yet." Shows the version needed |

### 14.4 Quality gates before a screen ships

1. U1–U12, plus V1–V9 for vision screens, checked in review.
2. axe scan clean, keyboard-only run of the main task, and a check at 390 px.
3. Screenshots in both themes (where the page supports both) attached to the PR.
4. Thai and English screenshots for any page with new copy.
5. UAT script (`tests/e2e/uat.mjs`) extended with the screen's main task.

## 15. Release plan

| Milestone | Includes | Customer outcome |
|---|---|---|
| **M0: Stable** | Phase 0 | a trustworthy base |
| **M1: Pilot-ready + thesis demo** | Phase 1 (1.1–1.4), Phase 2 (spec A, B, C), Phase 3 (3.1, 3.2, 3.4), Phase 4, vision on the edge (9.1–9.4, 9.5 edge only, 9.7, 9.8 without export, 9.10–9.11), UX rules §14, 8.1, 8.4–8.6, plans set by hand (7.1) | pilot plants onboard themselves, get alarms on their phones, and run their own YOLO26 model on the line |
| **M2: Value** | Phase 5 (5.1–5.4), Phase 3 (3.3, 3.5), 6.1–6.2, 8.2–8.3, 7.2, cloud fallback (9.5 cloud), monitoring (9.9), review export (9.8) | owners get OEE and reports; limits enforced; plants without a GPU still run vision |
| **M3: Public launch** | 6.3 payment, 5.5 integrations, 7.3, 8.7–8.8, external endpoints (9.6), **YOLO26 licence settled**, pen test | anyone can sign up and pay |
| **M4: Expand** | labeling and training on-platform (spec G9–G10), recording (G13), remote access (G15), pose/OBB/classify tasks, assistant add-on | upsell to Pro and Enterprise |

Order inside M1: Phase 0 → 1.1/1.2 → spec A (incl. templates) → spec B cameras/worker/relay → vision 9.1–9.3 → 9.4/9.5 edge → 9.7 rules → 3.1/3.2 → 1.3 + spec C checklist → Phase 4 cleanup → legal and docs.

## 16. Open decisions

1. Payment provider: Stripe or Omise (affects PromptPay and Thai tax invoices).
2. SMS provider and whether SMS is included or metered.
3. Plan limits and prices (validate with pilots before M3).
4. Is the thesis deadline tied to all of M1, or only to the vision demo? If only the demo, vision (9.1–9.7) moves ahead of Phase 1.
5. Hosting region: AWS Singapore vs Bangkok (`ap-southeast-7`) for PDPA and latency.
6. **YOLO26 licence (blocks M3).** Ultralytics models are AGPL-3.0 unless an Enterprise licence is bought. Choices before selling:
   - (a) buy an Ultralytics Enterprise licence that covers customers' models running in our service;
   - (b) keep YOLO26 as a customer-supplied option where the customer attests their own licence (9.3), and ship an Apache-2.0 detector as the default;
   - (c) a legal opinion on whether running customer-uploaded AGPL weights in our runtime puts obligations on WDS.

   Verify the current Ultralytics terms when deciding.
7. Cloud GPU provider for fallback inference (AWS g5/g6, or a GPU cloud), which sets the GPU-hour price in §10.
8. Reference edge hardware to recommend to customers (e.g., Jetson Orin, or an x86 box with a small NVIDIA GPU). The FPS tables in onboarding docs depend on it.
