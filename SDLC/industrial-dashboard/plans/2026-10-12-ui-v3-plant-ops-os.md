# UI v3 "Plant Ops OS" Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reskin + re-layout the whole app into a SCADA-grade ops-wall surface (hybrid mimic + dense metrics), add a real backend insight engine (anomaly/drift/flatline/flapping over tag_history) surfaced as rail/ribbons/feed, per spec.

**Architecture:** Backend: new `insights` table (RLS, tenant-scoped, audit-appended) + `InsightEngine` asyncio task + `GET /api/insights` + WS `insight` event — all additive to v1. Frontend: untouched plumbing (`live/ws/api/hooks`) gains an insights slice; tokens.css replaced with the steel ramp; new shared primitives (severity glyphs, InsightChip, global tag-keyed Faceplate in Shell); Overview becomes the ops wall; mimic/alarms/trends get shade states, glyph markers, anomaly ribbons; new `/insights` route.

**Tech Stack:** FastAPI + asyncpg + Alembic + pytest; React 18 + TS + Vite + uPlot + react-i18next + Playwright UAT. No new dependencies.

**Spec:** `SDLC/industrial-dashboard/19-ui-v3-design.md` — binding authority.

## Global Constraints

- All hex colors live ONLY in `web/src/styles/tokens.css` (`check-tokens.mjs` exits 1 otherwise); reserved alarm hues additionally restricted to files matching `/^sev/`, `/alarm/`, or `/status|State|Status/` — update the checker's reserved list to include `#f4534a`, `#ff9830`, `#f2cc0c`, `#e06cd8`.
- Font-size floor 12px; `font-feature-settings:"tnum"` on numeric renderings (`.num`, axes, KPI values).
- i18n: every new string needs `en` + `th` in `lib/i18n.ts` (Dict type enforces parity; `check-i18n.mjs` verifies).
- Severity data enum stays `info|warning|critical`; "advisory" is display label only; `baddata` is the quality axis, not a severity.
- Equipment state = shade not hue; running = light fill `#c1c7cd`, stopped `#343a3f`, manual `#4d5358`.
- UAT DOM contract must keep: `.side-nav`, `a.tab` + hrefs `/alarms` `/trends` `/commands` `/line`, `.topbar`/`.top-clock`/`.live-pill`, `.tile`/`.tile-val`/`.tile-stub-badge`, `.signin-btn`/`.token-input`/`.user-btn`, `.alarm-row`/`.btn-ack`/`.alarm-acked-label`/`.alarm-cleared-label`/`.alarm-count`, `.seg`/`.swatch`, `.cmd-panel`/`.cmd-row`, `g.equip[data-equipment]`, `.controls`/`.btn-control`/`.setpoint-input`/`.confirm-input`/`.lc-dot`, literal "Apply setpoint"/"Send command", <768px control gate, <480px too-small.
- Backend v1 contract is additive only: existing endpoints/statuses unchanged.
- Insight engine invariants (same as alarm engine): only fresh good-quality samples update stats and may open/close insights; bad/uncertain never do.
- Commits use `git -c user.name='Devin' -c user.email='devin-ai-integration[bot]@users.noreply.github.com' commit` (no git config changes).

## Review Focus

- Tag with zero history rows (new org): engine must not crash nor emit insights; test seeds a fresh tag and asserts no error, no insight rows.
- Insight dedupe: second detection while one is open must UPDATE (ts_end/score), never create a second open row — test injects two overlapping anomaly runs.
- Quality boundary: a tag that goes `good→bad→good` mid-anomaly must not count the bad samples toward open/close streaks — test asserts bad-quality rows extend neither.
- `?fp=<tag>` with an unknown/unmapped tag name: faceplate must render tag-level fallback (no equipment section, no controls), not crash — UAT asserts panel opens on a non-equipment tag.
- Clock/seed restart: engine restart must not backfill — test asserts no `ts_start` earlier than process start gets created on boot.

---

### Task 1: Insights schema + RLS tests

**Files:**
- Create: `backend/migrations/versions/0003_insights.sql`, `backend/migrations/versions/0003_insights.py`
- Modify: `tests/tenancy/test_rls.py` (add insights rows to existing RLS assertions)
- Test: `tests/tenancy/test_rls.py`

**Interfaces:**
- Produces: table `insights(id uuid pk default gen_random_uuid(), org_id uuid not null references organizations(id), tag_id uuid not null, kind text check kind in ('anomaly','drift','flatline','flapping'), severity text check severity in ('info','warning','critical'), score real, state text not null default 'open' check state in ('open','closed'), ts_start timestamptz not null, ts_end timestamptz, detail jsonb not null default '{}', created_at timestamptz not null default now(), updated_at timestamptz not null default now())`; composite FK `(org_id, tag_id)` → `tags(org_id, id)`; partial unique index `insights_open_uq` on `(org_id, tag_id, kind) WHERE state='open'`; `ENABLE` + `FORCE ROW LEVEL SECURITY`; policies + grants identical in shape to `alarm_rules` in `0001_saas_schema.sql` (wds_app select/insert/update via tenant policy, wds_system full via system policy — copy that file's policy/grant block verbatim, swapping the table name).

- [ ] **Step 1:** Write the migration `.sql` + `.py` pair mirroring `0001_saas_schema.{sql,py}` structure (`.py` uses the same raw-cursor exec helper the user added there).
- [ ] **Step 2:** Extend `test_rls.py`: seed an `insights` row per org in fixtures; assert `wds_app` sees only own-org rows with tenant context, sees 0 rows without context (fail-closed), and cross-org insert violates the composite FK.
- [ ] **Step 3:** Run `docker compose -f docker-compose.yml -f docker-compose.test.yml up -d postgres` then `make test-db` — expect 23-24 passed including new assertions.
- [ ] **Step 4:** Commit `feat(db): insights table with RLS`.

### Task 2: InsightEngine + API + WS

**Files:**
- Create: `backend/app/insights.py`, `tests/integration/test_insights.py`
- Modify: `backend/app/config.py` (constants), `backend/app/main.py` (lifespan task + endpoint + WS broadcast)
- Test: `tests/integration/test_insights.py`

**Interfaces:**
- Consumes: `insights` table (Task 1); `st(request).pools`/`tenant_tx`/`iso_z`/`v1_tx`/`st(registry)`/`audit.append`/`broadcast` patterns already in `main.py` and `alarms.py` — mirror them.
- Produces: `class InsightEngine` with `async def run_forever()` loop (sleep `INSIGHT_PERIOD_S`, evaluate all numeric tags of v1 org); `GET /api/insights` supporting `state`, `kind`, `tag` (v1 name), `from`, `to` query params returning `[{id,tag,kind,severity,score,state,ts_start,ts_end,detail}]` newest-first limit 200; WS event `{"type":"insight","insight":{...same shape}}` broadcast on open/close/update via existing `broadcast()`. Config constants: `INSIGHT_PERIOD_S=15.0`, `INSIGHT_BASE_S=3600.0`, `INSIGHT_OPEN_N=3`, `INSIGHT_CLOSE_N=5`, `INSIGHT_FLAT_S=300.0`, `INSIGHT_FLAP_N=6`, `INSIGHT_FLAP_S=600.0`, `INSIGHT_ANOM_Z=3.0` — all env-overridable like existing settings.

Detectors per spec §4.1 (EWMA α=0.05, OLS drift, zero-variance flatline w/ peer check, quality-transition flapping). `tag_deadband_min` = min deadband of tag's enabled rules else 0. No backfill on boot. Open/close appends `audit.append` mirroring alarm transitions.

- [ ] **Step 1:** Write failing tests in `test_insights.py`: (a) inject ≥OPEN_N out-of-band good samples via the same helper the alarm integration tests use (check `tests/integration/` for MQTT publish helper; if engine evaluation latency is too long for tests, also call the engine's single-pass method directly — expose `async def evaluate_once()` for that purpose); assert row opens, WS/REST shape, dedupe on second detection, close after in-band streak, bad-quality rows ignored, unknown/zero-history tag no-op. (b) API filter params.
- [ ] **Step 2:** Implement `app/insights.py`, config constants, wire lifespan task + `/api/insights` + broadcast in `main.py`.
- [ ] **Step 3:** Run the new tests against the test stack — all pass.
- [ ] **Step 4:** Commit `feat(backend): insight engine + /api/insights + WS insight event`.

### Task 3: Frontend insights plumbing

**Files:**
- Modify: `web/src/types.ts`, `web/src/lib/api.ts`, `web/src/lib/live.ts`, `web/src/lib/ws.ts`, `web/src/App.tsx`, `web/src/lib/plant.ts`
- Test: `npx tsc --noEmit`

**Interfaces:**
- Produces: `interface Insight {id:string; tag:string; kind:'anomaly'|'drift'|'flatline'|'flapping'; severity:Severity; score:number; state:'open'|'closed'; ts_start:string; ts_end?:string|null; detail?:Record<string,unknown>}`; `api.insights(params?:{state?:string;kind?:string;tag?:string;from?:string;to?:string})` → `Insight[]`; `live.insights: Insight[]` (cap 500, keyed merge by id), `live.insightRev`, `live.mergeInsight(i)`, `live.setInsights(a)`; ws.ts dispatches `insight` events (wrapped `{insight}` or flat); `useLiveBoot` seeds `api.insights({state:'open'})`; `plant.ts` gains `bubbleCode(tag)` returning ISA-style short code (letter map: temp→T, speed→S, level→L, ratio→R, running→ST, cam→V + two-digit index).

- [ ] **Step 1:** Add type + api + store slice + ws dispatch + boot seed + `bubbleCode`.
- [ ] **Step 2:** `npx tsc --noEmit` clean; quick browser check that `live.insights` populates (curl /api/insights first).
- [ ] **Step 3:** Commit `feat(web): insights plumbing (types/api/live/ws/boot)`.

### Task 4: v3 tokens + glyph primitives

**Files:**
- Modify: `web/src/styles/tokens.css`, `web/src/styles/base.css`, `web/scripts/check-tokens.mjs`, `web/src/shared/ui/Status.tsx`
- Create: `web/src/shared/ui/InsightChip.tsx`, `web/src/lib/i18n.ts` additions (`insights.*`, `nav.intelligence`, `nav.insights`, `sev.advisory` label)
- Test: `npm run check`, `npx tsc --noEmit`

**Interfaces:**
- Produces: token set per spec §3.2 (keep existing token names, update values; add `--bg-canvas`, `--bg-overlay`, `--border-medium`, `--ai-accent`, `--ai-surface`, `--ai-ribbon`, `--sev-baddata`, `--equip-running`, `--equip-idle`, `--equip-manual`, `--live-data`, `--pipe-inactive`, `--pipe-active`, `--state-selected`); `SeverityBadge` renders shape glyph ▲/◆/● via `data-severity` CSS (no emoji, CSS `content` or inline SVG); `QualityMark` bad uses `--sev-baddata`; `InsightChip({insight,onClick?})` → `button.insight-chip[data-kind][data-sev]` with kind glyph ✦ + short tag label + score, used by rail/cards/mimic.

- [ ] **Step 1:** Rewrite `tokens.css` values to spec ramp; update `check-tokens.mjs` reserved-hue list; add base.css glyph styles (`.sev::before` shapes via data-attr) + `.insight-chip` styles.
- [ ] **Step 2:** `Status.tsx` glyph markup + `InsightChip.tsx` + i18n keys (en+th).
- [ ] **Step 3:** `npm run check` + `tsc` pass; build pass.
- [ ] **Step 4:** Commit `feat(web): v3 token ramp + severity glyphs + InsightChip`.

### Task 5: Global Faceplate panel

**Files:**
- Create: `web/src/features/faceplate/Faceplate.tsx`, `web/src/features/faceplate/faceplate.css`, `web/src/features/faceplate/FaceplateContext.tsx`
- Modify: `web/src/app/Shell.tsx` (mount panel + provider), `web/src/features/line/LinePage.tsx` (Inspector → Faceplate, keep controls), `web/src/features/overview/OverviewPage.tsx` (KPI click opens faceplate), `web/src/features/alarms/AlarmRows.tsx` (tag click opens faceplate), `web/src/features/tags/TagsPage.tsx` (row click), `web/src/lib/i18n.ts` (`faceplate.*`)
- Test: `uat.mjs` line-page section still passes

**Interfaces:**
- Produces: `FaceplateProvider` exposing `openFaceplate(tag:string)` via context + `?fp=<tag>` URL param (survives refresh); `<FaceplatePanel>` renders `.faceplate` right-side panel: header (tag label via `useSignalLabel`, equipment name if mapped, StatePill, SeverityBadge of worst open alarm/insight), PV mono + unit + QualityMark + age, configured limits from `api.alarmRules`, Sparkline strip, open insights for tag (`InsightChip` list), recent commands on that tag, controls block when `equipmentOf(tag)`+writable (reuse `MotorControls` markup/classes `.controls`/`.setpoint-input`/`.btn-control`); unknown tag → tag-level fallback, never crash. Esc/close button clears `?fp`.

- [ ] **Step 1:** Context + panel skeleton mounted in Shell; `?fp` param sync.
- [ ] **Step 2:** Port Inspector content into faceplate; update all open-points (mimic select, KPI tile click, alarm row tag cell, tags row); keep `g.equip[data-equipment]` and controls UAT classes.
- [ ] **Step 3:** Run UAT — full suite passes.
- [ ] **Step 4:** Commit `feat(web): global tag-keyed faceplate panel`.

### Task 6: Overview ops wall

**Files:**
- Modify: `web/src/features/overview/OverviewPage.tsx`, `web/src/features/overview/overview.css`, `web/src/lib/i18n.ts` (`overview.insights*`)
- Create: `web/src/features/overview/InsightRail.tsx`, `web/src/features/overview/MetricTile.tsx`
- Test: UAT overview section

**Interfaces:**
- Consumes: `live.insights`/`InsightChip` (T3/T4), `api.alarmRules` zones (extend `useLimits` to return per-tag `{lo,hi}` band edges — min hi/hihi as hi, max lo/lolo as lo), `live.buffers` sparkline.
- Produces: `InsightRail` — `.insight-rail` strip under page head listing open insights as `InsightChip`s + "View all" link `/insights`, calm single-line empty state; `MetricTile` — analog-indicator tile replacing `Kpi`: label, mono value (`tnum`), horizontal band bar (normal zone between lo/hi from rules, alarm zone shading outside), pointer at PV (`.tile-pointer`), SP tick when writable, Sparkline, `.is-stale`/`.is-alarm`/`.is-anomaly` modifiers, opens faceplate on click — **keeps classes `.tile`, `.tile-val`, `.tile-stub-badge`, `data-signal`, `.num`**.

- [ ] **Step 1:** `MetricTile` + grid; `InsightRail`; mini insights feed in right column.
- [ ] **Step 2:** UAT passes (`.tile` count ≥5, `.tile-val`, stub badge, sparkline svg).
- [ ] **Step 3:** Commit `feat(web): overview ops wall (insight rail + analog metric tiles)`.

### Task 7: LineSchematic v3

**Files:**
- Modify: `web/src/features/line/LineSchematic.tsx`, `web/src/features/line/line.css`, `web/src/lib/plant.ts`
- Test: UAT line section

**Interfaces:**
- Produces: equipment fill uses `--equip-running` when running signal true / `--equip-idle` otherwise (shade coding); alarm markers become shape glyphs ▲(critical)/◆(warning) with 1Hz unacked flash (`prefers-reduced-motion` → steady); instrument-bubble readouts: readout boxes gain `.readout-bubble` circle + `bubbleCode(tag)` mono label; open insight on a signal → `.readout.is-anomaly` violet underline/halo using `--ai-accent`; pipe strokes `--pipe-inactive`/`--pipe-active`; selection uses `--state-selected`. Keeps `g.equip[data-equipment]`, `.schematic`, `.readout`, `data-signal`.

- [ ] **Step 1:** CSS + component changes; i18n untouched (no new strings needed).
- [ ] **Step 2:** UAT passes; screenshot verify.
- [ ] **Step 3:** Commit `feat(web): ISA-style mimic (shade states, glyph markers, anomaly halo, bubbles)`.

### Task 8: Insights page + nav regroup

**Files:**
- Create: `web/src/features/insights/InsightsPage.tsx`, `web/src/features/insights/insights.css`
- Modify: `web/src/app/Shell.tsx` (NAV groups), `web/src/App.tsx` (route), `web/src/lib/i18n.ts`
- Test: UAT (add `a.tab[href="/insights"]` nav check)

**Interfaces:**
- Produces: `/insights` route rendering `.panel.insight-list` — `Segmented` filters for state (open/closed) and kind, table `.insight-row[data-kind][data-sev]` (kind glyph, tag, severity, score, window, "Open in trends" link → `/trends?s=<tag>&w=1h`); nav groups Monitor/Operate/Intelligence/System per spec §3.1 (existing hrefs unchanged, add `/insights`).

- [ ] **Step 1:** Page + CSS + i18n + route + nav.
- [ ] **Step 2:** UAT + tsc + check pass.
- [ ] **Step 3:** Commit `feat(web): insights page + Intelligence nav group`.

### Task 9: Trend anomaly ribbons

**Files:**
- Modify: `web/src/features/trends/TrendsPage.tsx`, `web/src/features/trends/trends.css`
- Test: UAT trends section + visual check

**Interfaces:**
- Consumes: `api.insights({tag,from,to,state})` (T2 params), uPlot `bands` option or a `drawSeries` canvas overlay.
- Produces: violet bands (fill `--ai-ribbon`, borders `--ai-accent`) behind series for each insight window overlapping the visible range; legend row gains `.insight-legend` chips (InsightChip compact) per selected tag; fetching is per-chart-rebuild keyed on selected tags + window.

- [ ] **Step 1:** Fetch + band rendering + chips.
- [ ] **Step 2:** UAT trends assertions pass; visual verify a synthetic anomaly window.
- [ ] **Step 3:** Commit `feat(web): anomaly ribbons on trends`.

### Task 10: UAT extension + full verification

**Files:**
- Modify: `tests/e2e/uat.mjs`
- Test: everything

- [ ] **Step 1:** Add UAT checks: `a.tab[href="/insights"]` nav item; `.insight-rail` exists; open faceplate via `g.equip[data-equipment="motor"]` click still shows `.controls`; faceplate on a non-equipment tag renders `.faceplate`; after MQTT anomaly injection, `.insight-row` or `.insight-chip` appears (drive temp_c to 120 for >3s through the existing publish helper, then `evaluate_once` path — if WS latency too long, poll `/api/insights?state=open` via `page.request`); glyph presence `data-severity` attributes.
- [ ] **Step 2:** Full gates: `npm run build`, `npm run check`, `npx tsc --noEmit`, `make test-db`, integration suite, UAT ~34/34.
- [ ] **Step 3:** Rebuild containers, screenshots at 1440/1024/768/400 for `/`, `/line`, `/insights`, `/trends` → `/tmp/shots/`.
- [ ] **Step 4:** Commit `test(e2e): v3 UAT coverage`.
