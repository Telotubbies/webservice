# 20 — UI v4 + Enterprise Production Push

Status: proposed — pending approval.
Supersedes nothing; extends `19-ui-v3-design.md` (v3 shipped on `main` @ `c778bdc`).

## 1. Intent & why

v3 proved the ops-wall direction. v4 takes the same product to **enterprise
production grade** on three axes at once:

1. **Formal-modern reskin** — adopt the discipline of the top-ranked 2024–25
   enterprise dashboards (Linear's elevation ladder, Datadog's density grammar,
   Stripe's restraint) while keeping ISA-101 semantics. The current dark theme
   is close; v4 tightens the neutral ramp, typography, and micro-states.
2. **Three.js 3D line view** — a formal isometric digital-twin view of the line
   as a *supplementary* route (`/line3d`); the 2D mimic stays primary (user's
   choice). Spatial nav, not data density.
3. **Production hardening** — close the deferred gaps an enterprise security
   review actually checks: OIDC, MQTT TLS + per-device creds, rate limiting,
   WS auth, anonymous-read removal, DR drill, metrics, secrets hygiene — plus
   an **admin UI** for org/site/user management (user's choice: full scope).

Explicit non-goals (unchanged): billing/metering, SAML/SCIM built natively
(Keycloak brokers), multi-region/HA, Kubernetes, LLM copilot, OPC-UA/Modbus
ingestion (roadmap answer only).

Anti-goals: glassmorphism/bloom/game-feel 3D; rainbow state colors; KPI
carpet-bombing; panels nobody reads; auth half-migrated (v1 tokens + OIDC
coexisting forever is worse than either alone).

## 2. What the research said (one paragraph each)

**Top enterprise dashboards** (SaaSFrame/Mobbin rankings, token extractions
of Linear/Vercel/Stripe): near-monochrome neutral base + ONE brand accent +
3–4 reserved semantic hues; hairlines not shadows; `tnum` numerals + mono for
data; 28–32px rows; skeletons not spinners; ⌘K is table stakes; designed
empty/error states. Top-3 to emulate: **Linear** (density+precision),
**Datadog/DRUIDS** (same domain, unified filtering), **Stripe** (formal
restraint).

**Observability UX** (Datadog/Grafana/NR/Honeycomb/Chronosphere): severity =
color+shape+icon always together; brand color reserved for nav/active/CTA
never data; status colors only where status exists; context side panel not
drill-away; "minimize dead ends"; kiosk mode for ops walls; recents/favorites.

**3D industrial twins** (AWS TwinMaker+Grafana, realvirtual-WEB, isometric fab
dashboards): fixed/clamped orthographic iso camera wins for monitoring; matte
neutral meshes, state via small emissive accent + motion, alarm = red
under-glow ring, never whole-mesh recolor; restrained screen-space labels;
render-on-demand, DPR≤2, reduced-motion respected; 3D is one panel beside
2D, not the whole app.

**Enterprise checklist** (CAIQ/SIG-flavored): SSO+OIDC, RBAC granularity,
exportable audit, TLS everywhere incl. edge, secrets out of Compose, tested
restores, rate limiting, headers, SaaS self-observability. Tier-0 for this
product: MQTT TLS + per-device creds, OIDC, backup+restore drill, rate
limits, secrets fail-fast, Prometheus metrics. Don't waste on: native
SAML/SCIM, multi-region, K8s.

**Codebase audit**: `auth.py` = static env tokens, anonymous reads everywhere,
WS token-in-URL (leaks to nginx logs), zero rate limiting, no `/metrics`,
`/docs` public, dev-default secrets, `make restore` + sqlite migration script
missing, no frontend error boundary. Full list in §5.3.

## 3. Design decisions (my calls unless marked)

### 3.0 Design direction — "Mission Surface" (adopted from designer panel + lit review)

The page is not a wall of widgets — it's a dark room that quietly *is* the
plant. Full grounding: `22-design-literature.md`.

- **Ambient Tier**: canvas under all content paints a live **isobar/contour
  field** derived from telemetry (alarm sources → contours tighten + warm
  locally at ≤10% alpha; stale data → field stills). Luminance-channel only,
  smooth continuous drift ≥30Hz-equivalent (no discrete onsets — attention
  capture), pattern-not-values, carries "important but not critical" state
  only (Pousman & Stasko). Unacked critical alarm suppresses ambient motion.
  `prefers-reduced-motion` + "calm mode" toggle freeze it to static.
- **Three depth tiers**: ambient (never interactive) → ops plane (matte,
  hairline — current discipline) → focus tier (faceplate/⌘K/dialogs = the
  ONLY glass, ~72% backdrop blur over dimmed ops plane: translucency =
  attention signal).
- **Phosphor cyan**: merge `--live-data`+`--state-selected` into one "live"
  color (PV numerals, selection, field neutral line).
- **Motion grammar** (motion-director spec): `--dur-micro:120ms`,
  `--dur-ui:200ms`, `--dur-state:300ms`, `--dur-settle:600ms`,
  `--spring:linear(0,.6,1.12,.96,1.02,1)`; state crossfades never hue-flash;
  PVs never tween (dishonest); insight chips get a 600ms "confidence settle";
  one motion per surface per moment.
- **Cuts**: sidebar → 48px icon rail (⌘K-first nav); drop duplicated
  InsightFeed + EquipmentList panels on overview (rail + schematic already
  represent them); triple alarm surface → strip + field pressure; per-page
  h1+lede → single context bar.
- **Logo**: geometric angular mark, ink/indigo only, "PO" monogram or full
  wordmark (never "POS") — brief in doc 22 §1. Mark design deferred to a
  dedicated task; v4 ships a minimal glyph placeholder.
- **Palette engineering**: token values authored in OKLCH then emitted as
  hex (doc 22 §2); checker gains contrast-pair + reserved-hue enforcement
  if cheap.
- **Hard red-zones** (credibility keeper, binding): alarm hue reservation,
  shape+color redundancy, 1Hz unacked pulse, shade-state encoding, font
  floors, ≥48px destructive controls, nothing decorative above alarm
  priority in the visual stack. Glass NEVER on alarm banners/faceplate
  content — only the dimming context behind focus tier.

### 3.1 Palette — "Foundry" (formal-modern, research-derived)

Linear-ladder structure applied to our existing ISA-101 neutral base — the
change is *discipline*, not a new rainbow:

| Layer | Token family | Role |
|---|---|---|
| canvas | existing `--bg-canvas` retune ~`#0D0F12` | page background |
| raise | existing `--bg-panel`/`--bg-raised`/`--bg-overlay` retune | 4-level ladder already exists — retune values, NO renames |
| hairline | existing `--line` ~`rgba(255,255,255,.06)` | the ONLY separator; no shadows on cards |
| text | existing fg ramp | 3 levels only, ≥4.5:1 on canvas |
| brand accent | `--accent` indigo `#5E6AD2` (Linear-class) | nav-active, CTA — NEVER data/series; selection keeps `--state-selected` cyan (single selection color across 2D/3D) |
| semantics | existing `--sev-*` + `--ok` | reserved, unchanged semantics |
| AI | existing `--ai-accent`/`--ai-ribbon` violet | insights only; kept visually distinct from brand indigo |

Keep all existing token names — retune values only (every component CSS
consumes the current names). `#4D9DE0`-class blue was rejected: collides
with `--series-1` `#4c9be0` (data). Fix tokens.css:2's comment — the checker
greps components, not token values; extend check-tokens.mjs with a
fg/contrast-floor assert if it's <30 lines, else manual contrast check
documented in the task.

Typography: keep IBM Plex Sans/Mono. Enforce `font-variant-numeric: tabular-nums`
on every metric cell; row heights to 28–32px in tables; 4px radius max;
no text <12px (existing floor stands).

### 3.2 Three.js view — `/line3d`

- **Vanilla `three` in `useEffect`, lazy route** (`React.lazy`). No
  react-three-fiber: the LiveStore revision model is anti-reconciler — bind
  state imperatively via `live.subscribe` → `applyState(scene)` → render.
  ~160KB gz stays out of the main chunk.
- Scene: dark floor + faint grid, orthographic ~30° iso camera (orbit
  clamped, damping, reset-view control), matte graphite machines
  (motor/conveyor/camera/bin), running = subtle cyan emissive strip + belt
  motion, alarm = red under-glow ring pulsing while unacked, anomaly = violet
  halo, selection = `--state-selected` edge. Labels = HTML overlays (project
  camera → DOM), reusing readout classes, ≥12px, screen-reader visible.
- Render-on-demand (store flush/resize), `frameloop` equivalent = only draw
  on state change; `prefers-reduced-motion` gates belt motion; DPR ≤2;
  WebGL failure → silent fallback to compact 2D mimic (UAT "zero console
  errors" is a hard gate; SwiftShader in headless CI must degrade cleanly).
- Click → `?eq=` → global faceplate: extend FaceplateContext's `?eq`→faceplate
  mapping to also match `pathname === '/line3d'` (it's currently `/line`-only).
- NOT added to mobile nav (5-tab UAT contract).
- Nav: new item in Monitor group.
- WebGL pre-detection BEFORE constructing the renderer (`canvas.getContext
  ('webgl2')` probe) — three logs console errors on context failure and the
  UAT "zero console errors" gate (incl. headless SwiftShader) must stay green.
- Dependency: `three` pinned exact (version ≥7 days old); no drei/R3F.

### 3.3 Enterprise surface upgrades

- **⌘K command palette** (Linear/Datadog pattern): nav jump, tag jump (opens
  faceplate), equipment jump. Small, high leverage — implement as one
  component, keyboard-first, `?` help overlay.
- **Skeleton loaders** for first-load panels (matching content shape).
- **Kiosk/wallboard mode**: `?kiosk=1` hides chrome for ops-wall display
  (CSS-only hide + inert controls).
- **Designed empty/error states**: ErrorBoundary at router level (none
  exists — one render crash blanks the app today), per-page `errorElement`;
  cause-specific empties (cold-start vs filtered vs no-permission).
- **Admin section** (new nav group, operators+ only):
  - **alarm-rule CRUD** → DB `alarm_rules` + engine reload: add a
    `load_rules()` refresh triggered by a Postgres NOTIFY (or a cheap 30s
    re-read like the registry); a rule edit must take effect without restart.
  - **user/membership management** → `memberships` CRUD + invite accept flow
    (`invites` table already in schema 0001): `POST /api/invites` + accept
    endpoint; IdP `sub`→`users` row mapping lives in the OIDC login path.
  - **org/site CRUD**: real, once T9 unpins the `V1_ORG_ID`/`V1_SITE_ID` shim
    (user's call: true multi-org, not cosmetic). Tag registry stays
    yaml-sourced; per-org tag provisioning is a follow-up, not v4.
- **Audit export**: `GET /api/audit?from=&to=` JSON/CSV, tenant-admin only.
- Frontend must role-gate `/api/system/health` polling (anonymous/viewer →
  coarse status only) or the "zero 4xx/5xx" UAT fails once it's gated.

### 3.4 Production hardening (the unglamorous 80%)

From the audit, in implementation order:

1. **WS auth first-frame**: move the token out of `?token=` into the first
   client frame on the EXISTING v1 protocol (not full CONTRACT.v2 §5 — the
   `/ws/v1` wire rewrite stays future). Plus nginx `$uri`-only access log
   format, and `connect-src` tightened to self.
2. **Rate limiting**: 5 commands/10s per user+tag (doc 16 row 7), mutating
   bucket, WS conn limits + `ALLOWED_ORIGINS` origin check (new env;
   `CORS_ORIGIN` exists but is separate). Token bucket in-process.
3. **OIDC via Keycloak** (ADR-12, full): compose service + realm JSON
   artifact + `make seed-dev` import; backend `backend/app/security.py`
   JWKS verify (fixed alg list, iss/aud/exp), backchannel-logout endpoint,
   `wds_authz` NOTIFY revocation ≤5s, `users.disabled_at` check,
   `TRUSTED_PROXIES`. Frontend: `oidc-client-ts`, PKCE redirect flow,
   in-memory tokens (kill the localStorage token), silent refresh.
   **Anonymous reads end**: unauthenticated users get the sign-in wall only.
   UAT switches to a dev-login path (`APP_ENV=dev` retains token sign-in for
   tests) + one Playwright OIDC smoke through the Keycloak test realm.
   Every UAT/suite that assumed anonymous reads gets re-baselined inside the
   task that breaks it — the per-task gate is "suites green after the
   task's own updates," never "uat.mjs frozen."
4. **MQTT security**: full doc 17 (binding) — dynamic-security plugin
   replaces passwd+acl files, `svc-dynsec-admin` reconciler service, topic
   namespace `v2/{org}/{site}/{edge}/…`, edge provisioning via `POST /edges`
   (secret returned once), rotation/disable lifecycle, TLS 8883 (doc 20
   addition — doc 17 didn't include it; keep 1883 listener on test profile
   only, re-plumb UAT's `tester` injection to a provisioned test identity).
5. **Secrets fail-fast**: no dev-default fallbacks when `APP_ENV=prod`;
   healthcheck creds out of `docker inspect`. MUST LAND AFTER T5 (removing
   demo-token fallbacks before OIDC ships = prod with no auth).
6. **DR**: `make backup`/`make restore` (pg_dump, `make restore DUMP=`),
   recorded restore drill in doc 15 (doc 18:44 gate),
   `scripts/migrate_sqlite_to_pg.py` (Phase-2 leftover; doc 18:21 gives the
   CLI shape — field mapping spec'd in the task).
7. **Self-observability**: `/metrics` via `prometheus-client`, request-id +
   access log with token/secret redaction, `/readyz` (backend-only, NOT
   proxied through nginx per CONTRACT.v2:48), close public
   `/docs`/`/openapi.json`, gate `/api/system/health` detail by role.
8. **nginx TLS**: self-signed via `make certs`, behind `--profile tls` so
   plain-http UAT keeps working; HSTS only on the TLS listener.

## 4. Work breakdown (task order)

Sizing: this is 13 tasks; each gets an implementer subagent +
reviewer per the SDD flow that shipped v3.

| # | Task | Depends on |
|---|---|---|
| T1 | Foundry tokens: retune existing ladder + hairlines + tnum + radius | — |
| T2 | `/line3d` vanilla-three view + nav + WebGL fallback + `three` dep | T1 |
| T3 | WS first-frame auth (v1 semantics) + nginx `$uri` logs + connect-src | — |
| T4 | Rate limiting (commands/WS/mutations) + `ALLOWED_ORIGINS` + tests | T3 |
| T5 | Keycloak compose+realm + JWKS verify + backchannel + PKCE frontend + anonymous-read removal + dev-login for UAT | T3, T4 |
| T6 | MQTT security per doc 17 (scope per §6 answer) | — |
| T7 | Secrets fail-fast + backup/restore + `scripts/migrate_sqlite_to_pg.py` + restore drill in doc 15 | T5 |
| T8 | `/metrics` (prometheus-client) + request-id/access log + `/readyz` + `/docs` gating + system-health role gating | T5 |
| T9 | **Multi-org unpin**: `/api/v1/orgs/{org}/…` routes live (CONTRACT.v2 §REST paths), every handler + ingest + WS + insight engine parameterized by org from the principal's membership, v1 shim kept as alias to seeded org; tenancy tests extended to cross-org data (not just schema probes) | T5 |
| T10 | Admin UI: org/site CRUD + alarm-rule CRUD (+NOTIFY reload) + memberships/invites + audit export API | T5, T9 |
| T11 | ErrorBoundary + skeletons + kiosk mode + ⌘K palette + empty/error states | T1 |
| T12 | **Security + performance verification suite** against the live stack | T3–T10 |
| T13 | Final gates: all suites + UAT + restore drill + whole-branch review | all |

Every task: i18n en+th for new strings (check-i18n gate), update whatever
UAT/contract tests its change breaks, zero console errors, zero unexpected
4xx/5xx.

Verification per task: existing gates (`npm run check`, tsc, build, UAT 41+,
tenancy/integration/contract suites) + task-specific tests (429 paths, OIDC
deny paths, TLS handshake in CI where feasible).

**Security & performance verification (T12)**: OWASP API Top-10 sweep against
the live stack — BOLA/cross-tenant object access via real endpoints, auth
bypass (missing/alg-confusion/expired JWT), function-level authz on admin
routes, rate-limit proof, header/CSP scan, `/docs` exposure check, WS
origin/auth abuse — each a repeatable script under `tests/security/` with
pass/fail assertions, not a manual report. Performance: a load harness
(`tests/perf/`, k6 or a small asyncio harness — no heavy dep) covering:
history endpoint p95 ≤300ms at 15m window, 100 concurrent WS connections +
event fan-out p95 ≤2s, insight-eval pass <15s period, boot `tags/latest`
single round-trip, web main-chunk budget (≤600KB gz) and LCP target on the
ops wall. Safety note (per SCADA/ICS doctrine): security tests hit only the
SaaS surface and test-org MQTT namespaces — the command path to the edge/PLC
is exercised with the normal lifecycle, never stress-fuzzed.

Risk notes: T5 is the big one — Keycloak in compose adds a JVM container
(~1GB RAM); OIDC breaks UAT sign-in (tests must switch to a dev-login or
Keycloak test realm fixture). T2's zero-console-error gate needs the
SwiftShader fallback to be truly silent.

## 5. Deferred (explicit)

Native SAML/SCIM (Keycloak brokering suffices), SOC2/pen-test process items,
multi-region, K8s, billing, OPC-UA ingestion, per-org tag provisioning
(yaml stays source of truth in v4), global time-picker, saved views,
copilot LLM, severity filter on /insights, faceplate focus management.

## 6. Questions this doc settled vs left open

Settled by research/audit: palette direction (foundry, indigo `#5E6AD2` not
data-blue), 3D approach (vanilla, lazy, `/line3d`, `?eq` extended to that
route), R3F rejected, WS first-frame on v1 wire (full CONTRACT.v2 §5 stays
future), `?fp`/`?eq` faceplate contract, UAT re-baselined per-task, dev-login
kept for tests under `APP_ENV=dev`, admin UI scoped to alarm-rules+membership
(tags stay yaml-sourced, org/site read-only), invites flow for onboarding,
nginx TLS behind `--profile tls`.

Settled by user earlier: 3D as extra view (not replacement); full SaaS scope
incl. admin UI; palette chosen from research (this doc's pick: foundry ramp).

**Resolved by user:**

1. **T6 = full doc 17** — dynsec plugin + reconciler + `v2/` topics +
   provisioning/rotation lifecycle, plus TLS 8883.
2. **Multi-org = real** — unpin `V1_ORG_ID`; admin org/site CRUD is
   functional, v1 shim stays as an alias to the seeded org for compat.
