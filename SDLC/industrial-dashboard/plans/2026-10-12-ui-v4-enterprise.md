# UI v4 + Enterprise Production Push — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: subagent-driven-development — one implementer subagent per task + one reviewer per task + whole-branch final review. Steps use checkbox syntax.

**Goal:** Take the v3 ops-wall product to enterprise production grade — formal-modern reskin (Linear/Datadog discipline), a supplementary three.js 3D line view, and the full deferred hardening stack (OIDC, MQTT doc-17 security, rate limits, DR, self-observability, real multi-org, admin UI).

**Architecture:** Same stack — FastAPI + Postgres (RLS/tenant_tx), React 18 + Vite + hand-rolled token CSS, MQTT edge, compose deploy. Frontend stays dependency-minimal: only new deps are `three` (lazy route) and `oidc-client-ts`. Backend adds `prometheus-client`, `pyjwt[crypto]` (JWKS), Keycloak service. No R3F/drei, no UI kit, no Tailwind.

**Tech Stack:** Python 3.12/FastAPI/asyncpg, React 18.3/TS/Vite, three, oidc-client-ts, Keycloak 26, mosquitto 2 + dynsec plugin, docker compose.

**Spec:** `SDLC/industrial-dashboard/20-ui-v4-enterprise.md` — executors read it first. Binding sibling contracts: `16-command-safety-contract.md`, `17-mqtt-security-contract.md`, `18-release-recovery.md`, `CONTRACT.v2.md`, ADR-12/13/14.

## Global Constraints

- Token CSS only: no raw hex/rgba in components (check-tokens.mjs gate); font floor 12px; i18n en+th parity for every new string (check-i18n.mjs).
- UAT `tests/e2e/uat.mjs` must end ≥41/41 with zero console errors and zero unexpected 4xx/5xx; each task updates whatever tests/UAT its change breaks — the gate is green-after-own-updates.
- Backend suites: `make test-db` (tenancy/RLS), contract + integration via `.venv` python (`PY=/home/supawich/Desktop/webservice/.venv/bin/python`), test Postgres on 127.0.0.1:5433 via `docker-compose.test.yml` overlay.
- Commits: `git -c user.name='Devin' -c user.email='devin-ai-integration[bot]@users.noreply.github.com' commit`.
- Branch: `ui-v4` from `main`.
- No billing. Severity enum stays `info|warning|critical`. Insights stay read-only. Secrets never committed; no dev-default fallbacks under `APP_ENV=prod` (after T5 lands).
- Demo-token auth survives only under `APP_ENV=dev` (compose default for tests); OIDC is the prod path.

## Review Focus

Inputs/failure modes the spec implies that could ship broken:

1. **WS first-frame auth timing** — a client that sends data before its auth frame, and an unauthenticated socket left open. Expected: pre-auth frames rejected/closed 4401, idle auth timeout ~10s. → T3 tests.
2. **Keycloak down at login/verify** — backend must fail closed (503/401), never accept unsigned or cached-forever keys; frontend must show a sane error, not a blank. → T5 tests.
3. **Cross-org telemetry injection** — edge publishes `v2/orgA/…` while provisioned for orgB; dynsec ACL must deny before the backend parses. → T6 tests.
4. **Membership revoked mid-session** — `wds_authz` NOTIFY → revoked_sessions → WS 4408 within ~5s; REST 403/401. → T5/T9 tests.
5. **Rate-limit + legit burst interleaving** — 5/10s cap must not eat a legitimate in-flight command or drop WS events silently. → T4 tests.
6. **3D on headless/no-WebGL** — silent fallback, zero console errors (SwiftShader); renderer fully disposed on StrictMode double-mount. → T2 checks.
7. **Security tests hitting the live command path** — safety-first OT doctrine: security/perf suites exercise only the SaaS surface and test-org MQTT namespaces; the edge/PLC command path runs through the normal guarded lifecycle, never fuzzed. → T12 constraint.

---

### Task 1: Foundry token retune

**Files:** Modify `web/src/styles/tokens.css`, `web/src/styles/base.css`; maybe `web/scripts/check-tokens.mjs`.

- [x] Retune existing ladder values (canvas ~`#0D0F12`, +3% per raise), hairline `--line`, 3-level fg ramp — NO renames. Author values via OKLCH (note the OKLCH source in comments); emit hex. Off-white fg ~87%, not pure #fff (halation).
- [x] Merge `--live-data`+`--state-selected` → one phosphor-cyan "live" color (canonical name + alias); add `--accent: #5E6AD2` (brand indigo — nav/CTA only, never data); `--series-*`, `--sev-*`, `--ai-*` unchanged semantics.
- [x] Motion tokens: `--dur-micro:120ms`, `--dur-ui:200ms`, `--dur-state:300ms`, `--dur-settle:600ms`, `--ease-in:cubic-bezier(.5,0,.75,0)`, `--spring:linear(0,.6,1.12,.96,1.02,1)`.
- [x] `font-variant-numeric: tabular-nums` on metric cells/values; table rows 28–32px; radius ≤4px everywhere (audit component css).
- [x] Optional (<30 lines): contrast-floor assert in check-tokens.mjs for `--fg` on `--bg-canvas`; else document manual check.
- [x] Gates: `npm run check`, `tsc`, build, rebuild web, UAT ≥41; screenshot diff vs v3 (both live in /tmp/shots).
- [x] Commit `feat(web): foundry token retune (v4)`.

### Task 2: `/line3d` three.js view

**Files:** Create `web/src/features/line3d/{scene.ts,LineScene.tsx,Line3DPage.tsx,line3d.css}`; modify `web/src/App.tsx` (lazy route), `web/src/app/Shell.tsx` (Monitor nav, NOT MOBILE), `web/src/features/faceplate/FaceplateContext.tsx` (extend `?eq` mapping to `/line3d`), `web/src/lib/i18n.ts` (`nav.line3d`, `line3d.*` en+th), `web/package.json` (`three` pinned, ≥7d old).

**Interfaces:** `LineScene` subscribes `live.subscribe` → `applyState(scene)` → render-on-demand; click raycast → `nav('?eq=<id>')`; fallback renders `<LineSchematic compact>`.

- [x] `npm i three@<pinned>`; vite lazy route; canvas `role="img"` + aria-label.
- [x] scene.ts: ortho iso ~30°, damped/clamped orbit + reset; floor+grid; graphite meshes motor/conveyor/camera/bin; running→cyan emissive strip+belt motion (gated by prefers-reduced-motion); alarm→red under-glow pulse while unacked; anomaly→violet halo; selection→`--state-selected` edge; bin fill from `T.binLevel`.
- [x] HTML labels via camera projection, reuse `.readout` classes; state from `live.latest/alarms/insights` + `useEquipmentAlarm` logic ported.
- [x] WebGL probe before renderer construct → silent fallback; full dispose on unmount (StrictMode double-mount safe); `webglcontextlost` listener; DPR≤2.
- [x] UAT additions: `/line3d` loads (or falls back) with zero console errors; click equipment → faceplate opens; mobile nav still 5 items.
- [x] Gates + commit `feat(web): three.js isometric line view (/line3d)`.

### Task 3: WS first-frame auth + nginx log fix

**Files:** Modify `backend/app/main.py` (ws endpoint), `backend/app/ws.py`, `web/src/lib/ws.ts` (send auth frame, handle 4401), `web/nginx.conf` (`log_format` `$uri`-only), `web/index.html`/CSP (`connect-src 'self' ws: wss:` → `connect-src 'self'`), `tests/integration/test_ws.py`, `tests/e2e/uat.mjs`.

- [x] Backend `/ws`: accept, read first text frame ≤5s `{type:'auth', token}`, close 4401 on bad/absent, reject pre-auth data frames; keep v1 event protocol otherwise. Anonymous stays permitted *until T5* (anon frame `{type:'auth'}` empty) — T5 flips to authenticated-only.
- [x] ws.ts: open → send auth frame (token or empty) → resolve; no `?token=`.
- [x] nginx: `log_format` w/o `$request_uri` (or `$uri` only); CSP `connect-src 'self'` (proxy same-origin anyway).
- [x] Tests: first-frame auth, pre-auth frame rejection, bad-token 4401, no token in nginx-visible URL. UAT: WS still connects.
- [x] Gates + commit `feat(security): ws first-frame auth, uri-only nginx logs`.

### Task 4: Rate limiting + origin checks

**Files:** Create `backend/app/ratelimit.py`; modify `main.py`, `config.py` (`RATE_*`, `ALLOWED_ORIGINS` envs), `docker-compose.yml`; tests.

**Interfaces:** `RateLimiter.allow(key: str, cost=1) -> bool` token bucket; middleware/decorator usage.

- [x] Bucket: commands 5/10s per user+tag (doc 16 row 7), mutations 60/min per user, WS conns per IP cap (e.g. 20) + origin allowlist.
- [x] 429 with `Retry-After`; 403/close 4403 on bad WS origin; in-flight command 409 path unchanged (limiter not eat inflight slot).
- [x] Tests: 429 on 6th command, burst interleave keeps legit command, bad-origin WS rejected, `ALLOWED_ORIGINS` unset→same-origin-only.
- [x] Gates + commit `feat(security): rate limiting + origin checks`.

### Task 5: OIDC (Keycloak) + anonymous-read removal

**Files:** Create `backend/app/security.py`, `infra/keycloak/realm-wds.json`, `make seed-dev` step; modify `docker-compose.yml` (+keycloak service, prod envs), `backend/app/auth.py` (dev-token path stays behind `APP_ENV=dev`), `main.py` (auth deps on all read routes + WS), `web/package.json` (`oidc-client-ts`), `web/src/lib/{api,ws}.ts`, `web/src/app/Shell.tsx` + new `features/auth/` (PKCE login/logout flow, sign-in wall), `db` code (`revoked_sessions`, `users.disabled_at`, `wds_authz` NOTIFY listener → broadcast), UAT + contract/integration re-baseline.

- [x] Keycloak service + realm artifact (realm `wds`, client `wds-web` PKCE public, `wds-api` audience); compose health-gated.
- [x] `security.py`: JWKS fetch+cache (bounded, fail-closed on IdP down: 503 login/401 verify), fixed alg allowlist (RS256 only), iss/aud/exp checks; `Principal` gains `sub`, org memberships; backchannel logout endpoint; ≤5s revocation via NOTIFY.
- [x] Backend: `require_principal` on all `/api/*` reads + WS auth frame verifies JWT; anonymous → 401; shell = sign-in wall.
- [x] Frontend: oidc-client-ts PKCE, in-memory tokens (delete localStorage token path), silent refresh, on 401→login.
- [x] `APP_ENV=dev` keeps demo tokens; UAT uses dev-login; ONE Playwright OIDC smoke through test realm (redirect → KC form → back).
- [x] Tests: bad/expired/wrong-aud JWT rejected; KC down→fail closed; revoked session→4408/403 ≤5s; anon reads 401; dev-token path only in dev.
- [x] Gates + commit `feat(auth): OIDC via Keycloak; end anonymous reads`.

### Task 6: MQTT security — full doc 17

**Files:** `infra/` (mosquitto.conf dynsec config, acl json), new `svc-dynsec-admin` reconciler service (backend module or small service per doc 17), edge-bridge provisioning client, backend `POST /edges` + rotation/disable endpoints, `make certs` (TLS 8883; keep 1883 on `--profile test` only), UAT MQTT injection re-plumbed to provisioned test identity, doc 17 status notes.

- [x] Dynsec plugin config; `v2/{org}/{site}/{edge}` topic namespace; reconciler syncs `edges`/`edge_identities` → dynsec ACLs (17:55–63).
- [x] Provisioning: `POST /api/v1/orgs/{org}/edges` returns secret once; edge-bridge authenticates, rotates, disables per 17.
- [x] TLS listener 8883 (self-signed via `make certs`), 1883 test-profile only; backend ingest subscribes `v2/#` on the dynsec-admin channel; verify `tester` exists only under test profile.
- [x] Tests: cross-org publish denied by ACL (not just app code), revoked edge can't connect, v1-topic publish rejected, healthcheck creds not in `docker inspect`.
- [x] UAT: MQTT anomaly injection works via test-profile identity; gates + commit `feat(security): MQTT per-device identities, TLS, dynsec ACLs (doc 17)`.

### Task 7: Secrets + DR + sqlite migration

**Files:** `Makefile` (`backup`, `restore DUMP=`, `certs`), `scripts/migrate_sqlite_to_pg.py` (new dir + script, doc 18:21 CLI shape: `--sqlite backend/data/app.db --dry-run`), `config.py`/`docker-compose.yml` (fail-fast, remove prod dev-defaults, healthcheck creds out of inspect), doc 15 restore-drill record.

- [x] `APP_ENV=prod` + any missing required env → loud exit; healthcheck uses a file-mounted creds or `mosquitto_ctrl dynsec` local socket instead of password in command.
- [x] `make backup` (pg_dump → timestamped), `make restore DUMP=` + post-restore `verify-audit`; run drill once, record evidence in doc 15.
- [x] sqlite→pg script: map old `app.db` tables → saas schema for the seeded org; `--dry-run` reports counts; idempotent re-run.
- [x] Gates + commit `feat(ops): secrets fail-fast, backup/restore, sqlite migration`.

### Task 8: Self-observability

**Files:** `backend/app/` (prometheus_client metrics middleware/registry), `main.py` (`/metrics`, `/readyz`, request-id middleware, access log w/ redaction, docs_url=None gated to dev), nginx (no `/readyz` proxy), `App.tsx`/`session.ts` (role-gate system-health fetch), tests.

- [x] `/metrics`: request counts/latency, ws conn count, insight/alarm engine counters, db pool stats — no label leaks.
- [x] `/readyz` = migrate smoke (db connect + alembic head); not nginx-proxied; `/healthz` unchanged.
- [x] Request-id + JSON access log, redact `token`/Authorization/WS auth payload; `/docs`+`/openapi.json` served only `APP_ENV=dev`.
- [x] `/api/system/health` detail → operator+; frontend stops polling detail when viewer/anon (else 4xx gate fails).
- [x] Tests: metrics shape, readyz, redaction unit test, docs hidden in prod mode.
- [x] Gates + commit `feat(ops): metrics, readyz, access log, docs gating`.

### Task 9: Multi-org unpin

**Files:** `backend/app/main.py`, `db/context.py`, `config.py`, ingest path, `ws.py`, `insights.py`, `commands.py`, `alarms.py` — every `v1_tx` call becomes org-from-principal; routes gain `/api/v1/orgs/{org}/` per CONTRACT.v2 §REST; keep `/api/...` v1 paths as alias → seeded org (v1 shim documented as compat); tenancy tests extended to cross-org DATA (org A can't read org B's tags/alarms/insights through real endpoints).

- [x] `v1_tx(pool, fn)` → `tenant_tx(pool, org_id)` where `org_id` resolved from path `org` param (v2) or seeded shim (v1) + membership check. (`_v2_scope`/`_v2_org` in main.py; `v1_tx` remains as the documented shim pin.)
- [x] Ingest: telemetry routed by `v2/{org}/…` topic → org_id; v1 devices map to seeded org. (v1 MQTT topics are rejected at the broker since T6 — dynsec only grants v2 ACLs — so "map to seeded org" is realized as *v1 topics cannot reach ingest*; only the seeded edge's v2 topic is valid.)
- [x] WS: subscriptions per-org (auth frame carries org context or server derives from memberships). (`/ws/v1` requires `site_id` in the auth frame → site's org must be a membership; broadcasts filtered per-org; `/ws` stays the seeded-site compat socket.)
- [x] Tests: two orgs, real endpoint reads/writes, cross-org 403/empty; RLS probes already exist — add data-level ones. (`tests/integration/test_tenancy.py`: org A/B over real HTTP + WS + MQTT e2e.)
- [x] Gates + commit `feat(backend): real multi-tenant org routing (v4 T9)`.

### Task 10: Admin UI + audit export

**Files:** new `web/src/features/admin/` (pages: orgs/sites, alarm-rules, users/invites, audit), `backend/app/` admin routes (`POST /api/v1/orgs/{org}/alarm-rules` CRUD + NOTIFY `alarm_rules_changed` → engine `load_rules` refresh; memberships CRUD; `POST /invites` + `/invites/{token}/accept`; `GET /api/v1/orgs/{org}/audit?from=&to=&format=json|csv`), i18n en+th, UAT additions.

- [x] Alarm-rule CRUD takes effect without restart (NOTIFY listener in alarms engine; verify by integration test).
- [x] Users: list memberships, change role, disable; invites: create → token → accept flow (email_verified match per schema).
- [x] Audit export page: range picker, JSON/CSV download.
- [x] Operator+ gating (session.ts); UAT: admin nav hidden for viewer, CRUD roundtrip works.
- [x] Gates + commit `feat(admin): org/site/rule/user admin + audit export`.

### Task 11: Mission Surface chrome (ambient tier + shell cuts)

**Files:** Create `web/src/features/overview/AmbientField.tsx` + supporting canvas logic; modify `Shell.tsx` (sidebar → 48px icon rail with labels on hover, ⌘K opens palette), `OverviewPage.tsx`/`overview.css` (cut duplicated InsightFeed + EquipmentList — rail + schematic already represent them; page h1+lede → single context bar), `tokens.css` consumers for the three-tier depth stack (focus tier glass only), i18n.

- [x] AmbientField: fullscreen canvas under content on `/`; isobar/contour field from `live.alarms`/`live.insights` state — luminance channel only, ≤10% alpha, smooth continuous drift, no discrete onsets; unacked critical suppresses motion; `prefers-reduced-motion` + persisted `calm` class toggle → static contour plot; render only when visible (IntersectionObserver/visibilitychange).
- [x] Focus-tier glass: faceplate/⌘K/dialogs get backdrop-blur ~72% over dimmed ops plane; alarm surfaces NEVER glass.
- [x] Icon-rail sidebar: 48px, icon-only + tooltip/label, active = `--accent`; nav still keyboard-reachable; ⌘K is primary nav.
- [x] UAT: `.side-nav .tab` selectors preserved (icon rail keeps classes), mobile nav unchanged (5 tabs), overview insight rail still present.
- [x] Gates + commit `feat(web): mission-surface ambient tier + icon rail + surface cuts`.

### Task 12: Frontend enterprise polish

**Files:** `App.tsx` (router `errorElement` + ErrorBoundary), `web/src/shared/ui/` (Skeleton, EmptyState, `CommandPalette` ⌘K), `Shell.tsx` (kiosk `?kiosk=1` hides chrome + inert controls, `?` help overlay), faceplate mount-once for exit animation (Faceplate.tsx conditional-unmount fix), i18n.

- [x] ⌘K palette: nav jump + tag/equipment jump (opens faceplate); fuzzy filter; Esc closes; `?` overlay lists shortcuts.
- [x] Motion pass: insight chip arrive+confidence-settle, alarm ack (blink stops instantly), equipment shade crossfade 300ms, faceplate slide with mounted exit, command lifecycle spring dots, FLIP reorder on rail — all per motion grammar tokens; PVs never tween.
- [x] Skeletons for first-load panels (shaped, no spinners); cause-specific empties (cold-start vs filtered vs denied).
- [x] Kiosk mode: `?kiosk=1` on `/` hides nav/topbar chrome, controls inert, wallboard-clean (doubles as Andon).
- [x] ErrorBoundary per-route + global; deliberate crash test → recovery UI not blank.
- [x] Gates + commit `feat(web): command palette, kiosk, error boundaries, motion grammar`.

### Task 13: Security + performance verification suite

**Files:** Create `tests/security/` (repeatable scripts asserting pass/fail, run against the live stack) and `tests/perf/` (load harness); `Makefile` targets `test-security`, `test-perf`; a doc-18-style results appendix in `SDLC/industrial-dashboard/15-verification-log.md` (or sibling).

- [x] **OWASP API Top-10 sweep** (scripted, not manual): BOLA — org A's token vs org B's object IDs on every v2 route; auth bypass — missing/alg-confusion(`none`)/expired/wrong-aud JWT rejected on REST + WS; function-level — admin/edge routes deny viewer tokens; rate-limit proof — 429 + `Retry-After` observed; header scan — CSP/nosniff/frame-deny on every response class; `/docs`,`/openapi.json` absent in prod mode; WS — pre-auth frames closed 4401, bad origin 4403, conn cap enforced.
- [x] Secure-code-review pass on the new auth/security code (10-domain checklist, findings fixed or logged).
- [x] **Perf harness** (k6 if present else a small asyncio/httpx harness — no heavy deps): `GET /api/v1/.../history` 15m window p95 ≤300ms over 200 reqs; 100 concurrent WS + telemetry fan-out p95 ≤2s; insight eval pass <15s; `tags/latest` single round-trip; web main chunk ≤600KB gz; ops-wall LCP reported.
- [x] Safety boundary: tests use test-org + provisioned test MQTT identity only; the command path is exercised through the normal lifecycle — no fuzzing the edge/PLC-facing side.
- [x] Results recorded in the verification log; failures become findings to fix or documented accepted-risk.
- [x] Commit `test(ops): security + performance verification suite`.

### Task 14: Final gate + whole-branch review

- [x] All suites: contract, integration, tenancy, db, security, perf, UAT, `npm run check`/tsc/build.
- [x] Fresh `docker compose` rebuild from clean; restore drill artifact in doc 15 present.
- [x] Whole-branch review subagent on the full diff range; fix findings; re-review once.
- [x] Report: shipped/evidence/rulings/deferred → user.
