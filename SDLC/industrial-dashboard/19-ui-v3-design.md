# 19 — UI v3 design: "Plant Ops OS" (SCADA × observability SaaS × AI insights)

Status: **draft — awaiting sign-off** (2026-10-12)
Depends on: ADR-14 (design tokens enforced by `check-tokens.mjs`), doc 16 (command
safety), CONTRACT.md v1 API (extended, not broken).

## 1. Intent

v2 proved the platform is real (Postgres, RLS, commands, alarms, live WS). v3 makes
it *look and feel* like the product it claims to be: a full-SCADA surface that is
unmistakably a modern observability SaaS — with AI insight as a first-class,
backend-computed signal, not a marketing badge.

Three binding decisions from the product owner:

- **AI = real inference on real data.** A backend insight engine computes
  anomalies/drift/flatline from actual tag history and surfaces them in the UI.
- **SCADA feel = hybrid ops wall.** Mimic on top, dense metric grid below —
  not a P&ID-only HMI, not a tile-only Datadog clone.
- **Scope = reskin + new layout for the whole app.** All existing features stay.

## 2. Goals / non-goals / anti-goals

**Goals**

- G1. Every screen reads "industrial operations", not "admin template".
- G2. Alarm hues are reserved (ISA-101 / ASM discipline): nothing informational
  uses red/amber. Severity carries color + shape + text — never color alone.
- G3. Insights are real: computed server-side from tag history, tenant-scoped,
  pushed over WS, rendered as ribbons on trends + chips on mimic + a feed page.
- G4. One shared semantic system: tag = entity id; same severity ramp, same
  side-panel faceplate pattern on mimic, KPIs, alarms, insights.
- G5. Keep every working guarantee: command gating, quality invariants,
  TH/EN parity, token gate, UAT green.

**Non-goals (v3)**

- LLM/copilot chat surface (the side-panel + AI-accent patterns are designed so a
  copilot drawer can attach later without redesign).
- Global time picker / replay scrub.
- Drag-and-drop dashboard builder, user-created widgets.
- New P&ID symbol library (the line has one real schematic; we upgrade it, we
  don't build a symbol editor).

**Anti-goals**

- Animated decoration that carries no state (ISA-101: animation is for alarm
  flash and genuinely ambiguous flow only).
- Green "healthy" chrome everywhere — running is implicit, not a celebration.
- A separate "AI page" with no ambient presence elsewhere.

## 3. Design language — "Plant Ops OS"

Direction chosen from research candidates; identity: *the mimic is an operating
surface; every tag addressable; every faceplate a panel; AI is the shell's
signal layer.*

### 3.1 Hierarchy (ISA-101 levels → nav)

| Level | Surface | Route |
|---|---|---|
| L1 ops wall | Overview: mimic hero + metric grid + insight rail + alarm strip | `/` |
| L2 unit display | Line view: full mimic canvas + faceplate side panel | `/line` |
| L3 task detail | Equipment faceplate (right panel) — PV/SP/limits/trend/anomalies | `/line?eq=` |
| Explorer | Trends, Tags | `/trends`, `/tags` |
| Ops records | Alarms (ISA-18.2 states), Commands | `/alarms`, `/commands` |
| AI feed | Insights page | `/insights` (new) |
| System | Health | `/health` |

Nav groups become `Monitor` (Overview, Line view, Trends), `Operate` (Alarms,
Commands), `Intelligence` (Insights), `System` (Tags, Health). Sidebar keeps the
`a.tab` + exact-href contract and `.side-nav`.

### 3.2 Visual system (tokens; all hex live only in `tokens.css`)

Replace the surface ramp with a cooler steel set and add the AI accent:

```
bg:        canvas #101417 / panel #161B1F / raised #1E2429 / overlay #262C32
line:      rgba(204,214,220,.10 | .20 | .30)   (weak|medium|strong)
text:      primary #DDE1E6 / secondary #A2A9B0 / muted #697077 / disabled #4D5358
accent:    #7C5CFF interactive/links        accent-soft for hovers/fills
ai:        #B98DF0 accent,  rgba(185,141,240,.08) surface   ← outside alarm palette
sev:       critical #F4534A / warning #FF9830 / advisory #F2CC0C
baddata:   #E06CD8 — quality axis (bad/uncertain/stale indication), NOT a severity
selected:  #3FC6D8 cyan — operator selection / actuated element
state:     running #C1C7CD(light fill) / stopped #343A3F / manual #4D5358 /
           stale handled by --sev-baddata + "stale" label
live data: #4FA8B8 desaturated cyan — PV numerals on mimic only
series:    #4C9BE0 #7C5CFF #3FC6D8 #E0A54C #3DAD72 #D66BA0 (chart categorical)
ok/info:   #3DAD72 / #4C7DD9 — forms, toasts, diffs only, never process state
```

Rules:

- Severity hues remain **reserved** — the checker already enforces this; new
  `sev-baddata`/`sev-advisory` tokens join the reserved list in
  `check-tokens.mjs`.
- Equipment state = **shade, not hue**: running light-fill, stopped dark-fill,
  uninstrumented mid-grey/hatch. No green bodies.
- Severity values in data stay `info|warning|critical` (no migration); `info`
  displays as "Advisory" via i18n label. Shape coding is the redundancy layer:
  ▲ critical, ◆ warning, ● advisory/info, ✚ bad-data (quality). Implemented as
  data-attribute glyphs, reused by `SeverityBadge`, alarm rows, mimic markers,
  insight cards.
- Type: Plex Sans + Plex Sans Thai (UI), Plex Mono (values/tags/axis chrome);
  `font-feature-settings:"tnum"` on `.num`, axes, KPI values.
- Geometry: 2px radius on mimic elements & alarm indicators; 4px chrome;
  hairline borders + tonal steps for elevation, `--shadow-pop` only on floating
  surfaces. 28px dense table rows stay an option via `.table.is-dense`.

### 3.3 The signature surfaces

**A. Ops wall (Overview redesign)** — L1:
1. `InsightRail` — a carousel strip directly under the page head: severity-sorted
   insight chips ("temp_c: +2.8σ above baseline for 9 min") + "View all" →
   `/insights`. Empty state is a single calm line, not a celebration.
2. Mimic hero — the existing `LineSchematic` upgraded (§3.3-D).
3. `MetricRow` — dense grid of **Moving Analog Indicators** (Ignition-style):
   each tile = label, mono value, horizontal range band (normal/alarm zones from
   `alarm-rules`), pointer at PV, tick at SP where writable, sparkline, stale/
   anomaly modifiers. Replaces current Kpi cards; keeps `.tile` contract.
4. Right column: active alarms (existing `AlarmRows compact`) + equipment list
   (existing) + a new "Insights" mini-feed (top 3 open insights).

**B. Faceplate (replaces Inspector)** — L3, a **global right side panel mounted
   in Shell** (not a `/line`-only aside), keyed by **tag**, not equipment.
   Content adapts: header (tag/equipment, severity, state), PV big-mono + SP,
   mode/writable, configured limits row, embedded sparkline, open insights for
   that tag, related recent commands; controls block appears only when the tag
   maps to operable equipment (`SIGNALS[].writable`, unchanged gating). Tags
   with no equipment mapping get a tag-level faceplate (no controls, no
   equipment section). Any click — mimic equipment (maps to its primary
   signal), KPI tile, alarm row tag, insight card, tags row — opens it via a
   shared context + `?fp=<tag>` URL param so it's linkable and survives refresh.
   One pattern, every surface = the fused feel.
   Keeps UAT classes `.controls`, `.setpoint-input`, `.btn-control`, `g.equip`.

**C. Insights page** — `/insights`: filter chips (kind, state, severity),
   table/cards: tag, kind glyph, score, window, "open in trends" (deep-links
   `?s=<tag>&w=1H`). Read-only in v3 (no ack workflow — insights are
   informational; alarms remain the actionable channel).

**D. Mimic upgrades** (both Overview hero and `/line`):
   - Shade-coded equipment fill per §3.2 (running = light steel).
   - Alarm markers get shape-coded glyphs (▲/◆) + unacked 1Hz flash —
     `prefers-reduced-motion` → steady.
   - **Anomaly halo**: instrument readouts with an open insight get a violet
     underline/halo (`--ai-accent`) — deliberately not an alarm hue.
   - Pipes stay static (linear A→B→C flow does not earn animation; belt/rotor
     motion stays because it encodes running state).
   - Instrument-bubble style readouts: circle + mono tag suffix (ISA-5.1 flavor:
     `TT-01`, `ST-02`-style short codes derived from tag leaf) — kept subtle:
     existing tag names remain the source of truth, bubble codes are display
     aliases only.

**E. Trend ribbons**: `TrendsPage` draws open/closed insight windows as violet
   bands (`--ai-ribbon` rgba(185,141,240,.15)) behind series, plus a chip on
   hover. Backend supplies `ts_start/ts_end` per insight.

## 4. Insight engine (backend — real inference, smallest honest form)

### 4.1 What it computes (per numeric tag, every `INSIGHT_PERIOD_S` = 15 s)

Rolling statistics over `tag_history`, no new dependencies. "Samples" below are
**history rows** (≈1 s cadence in the sim), not engine evaluations — anomalies
open in ~3 s of real deviation, which keeps the injected-anomaly test fast.

All constants live in `config.py` as env-tunable settings (same pattern as
`ALARM_FRESH_S`): `INSIGHT_PERIOD_S=15`, `INSIGHT_BASE_S=3600`,
`INSIGHT_OPEN_N=3`, `INSIGHT_CLOSE_N=5`, `INSIGHT_FLAT_S=300`,
`INSIGHT_FLAP_N=6`, `INSIGHT_FLAP_S=600`.

| Kind | Detector | `score` | Severity |
|---|---|---|---|
| `anomaly` | |z| ≥ 3 vs EWMA baseline (`INSIGHT_BASE_S`, α≈0.05); ≥`OPEN_N` consecutive out-of-band samples → open; `CLOSE_N` consecutive in-band → closed | \|z\| | >6 → warning else info |
| `drift`   | OLS slope on 30-min good-sample window exceeds `max(tag_deadband_min, 0.5·σ_baseline)/10min` and residual σ < 0.5·σ_baseline | slope·window/σ | info |
| `flatline`| zero variance across `INSIGHT_FLAT_S` of good samples while ≥1 *other numeric tag in the same org* moved → sensor-stuck suspicion | flat minutes | warning |
| `flapping`| ≥`INSIGHT_FLAP_N` good↔bad/uncertain quality transitions in `INSIGHT_FLAP_S` | transition count | info |

`tag_deadband_min` = smallest `deadband` over that tag's enabled rules, or 0.

Cold start: the engine begins evaluating from process start and does **not**
backfill (prevents a burst of stale insights on every deploy). `ts_start` of a
freshly opened insight is the first offending sample's timestamp.

Invariants inherited from the alarm engine: only good-quality fresh samples feed
the baseline; bad/uncertain samples never update statistics and never open or
close an insight. Stale tags produce no insights (and `flatline` covers the
interesting case). Insight open/close appends to the audit chain, mirroring
alarm transitions.

### 4.2 Storage

New migration `0003_insights.sql`:

```
insights(id uuid pk, org_id uuid, tag_id uuid,
         kind text, severity text, score real,
         state text default 'open',        -- open | closed
         ts_start timestamptz, ts_end timestamptz,
         detail jsonb default '{}',
         created_at, updated_at,
         UNIQUE (org_id, tag_id, kind) WHERE state='open'  -- one open per kind/tag
)
```

- Tenant columns + `FORCE ROW LEVEL SECURITY` + same policies/grants pattern as
  `alarm_rules` (copy the DDL shape from `0001_saas_schema.sql`).
- Edge case handled by the partial unique index + `INSERT … ON CONFLICT`: a
  repeated detection while one is open updates `ts_end`/`score`, no duplicates.

### 4.3 API surface (v1 contract extension — additive only)

- `GET /api/insights?state=open|closed&kind=&tag=<v1 name>&from=<iso>&to=<iso>`
  → list, tenant-scoped, newest first, limit 200. `tag`/`from`/`to` exist so
  the trends page can fetch every insight window overlapping the visible range
  for the selected series — client-side filtering of the global list would
  silently lose ribbons beyond the newest-200. Anonymous read allowed (same
  policy as `/api/alarms`). `insights.severity` uses the existing enum
  `info|warning|critical` with a CHECK constraint.
- WS event `{"type":"insight","insight":{…}}` on open/close/update — same
  broadcast path as `alarm_update`.
- No POST endpoints in v3: insights are engine-generated; an operator dismisses
  nothing (non-goal: feedback loop).

### 4.4 Wiring

`app/insights.py` — `InsightEngine` mirroring `AlarmEngine`'s structure (owns
per-tag `InsightsState`, called from `main.py`'s ingest path or a `asyncio`
periodic task; periodic is chosen: history already lands in `tag_history`, so the
engine reads the DB with the **system role** and writes with RLS tenant context
set — same pattern as `alarms.py`/`commands.py`).

## 5. Frontend changes (file-level map)

Reuse — the plumbing is untouched: `lib/live.ts` (add `insights` slice +
`insightRev`), `lib/ws.ts` (dispatch `insight`), `lib/api.ts` (add
`insights()`), `lib/hooks.ts`, `session.ts`, `plant.ts` (add `bubbleCode()`),
`types.ts` (+`Insight`, `WSState` union member).

New/changed:

```
styles/tokens.css          full v3 ramp (above); keep old names as aliases where
                           sensible to shrink the diff
styles/base.css            shell/side-panel/metric-tile/glyph/insight styles
app/Shell.tsx              nav regroup + insights item; alarm strip unchanged
shared/ui/Severity.tsx     SeverityBadge gains shape glyph (▲◆●✚)
shared/ui/InsightChip.tsx  severity/kind chip used by rail/cards/mimic halo
features/overview/         Ops wall: InsightRail + MetricRow (analog-indicator
                           tiles) + insights mini-feed; keeps .tile contract
features/line/Faceplate.tsx   Inspector → shared faceplate (§3.3-B)
features/line/LineSchematic.tsx  shade-coded states, glyph markers, anomaly halo,
                           instrument bubbles
features/insights/InsightsPage.tsx + insights.css   feed page + filters
features/trends/TrendsPage.tsx  anomaly bands behind series (uPlot `bands` or
                           drawSeries hook), insight chips in legend row
features/alarms/           glyph shapes; alarm table gets dense option
App.tsx                    /insights route; live boot seeds api.insights()
i18n                       new group `insights.*` (+nav item); en+th pairs
```

UAT contract: every existing selector stays (`.tile`, `.side-nav`, `a.tab`
hrefs, `.alarm-row`, `.controls`, `.setpoint-input`, `.lc-dot`, `g.equip`,
`button:has-text("Apply setpoint")` …). New assertions to add: `a.tab[href=
"/insights"]`, `.insight-rail` presence (may be empty-state), faceplate opens on
motor click (replaces inspector check, keeping `.controls` inside it), and an
insights API contract test seeding a synthetic anomaly via MQTT injection (e.g.,
driving temp far off baseline) — extend `uat.mjs`, don't fork it.

## 6. What stays exactly as it is

- Command flow, gating reasons, `ConfirmCommand` dialog, `Lifecycle` stepper.
- Health page structure (restyle only), Tags/Commands pages (restyle only).
- WS contract, auth token model, all backend v1 endpoints (additive only).
- TH/EN parity gate, token gate, `<480px` too-small, `<768px` control gate,
  reduced-motion, focus rings.

## 7. Verification gates (unchanged + additions)

- `npm run build`, `npm run check` (token + i18n), `npx tsc --noEmit`.
- `make test-db` (21) — plus new insight-table RLS tests (fail-closed,
  cross-tenant invisible) → target 24.
- Integration suite (38) unchanged; add insight API tests (open→close cycle on
  injected anomaly, no duplicate open insights, bad-quality samples produce none).
- UAT 30 → ~34 checks.
- Visual: screenshots at 1440/1024/768/400 for `/`, `/line`, `/insights`,
  `/trends`.

## 8. Open calls I made (flagged, not user-agreed)

- C1. "AI" = statistical inference (EWMA/OLS/variance) implemented in-backend,
  honest naming ("insights"). An LLM copilot would bolt on the same UI surfaces
  later; this ships real value with zero new infra.
- C2. "Plant Ops OS" direction: violet AI accent, ISA shape glyphs, steel ramp.
- C3. Insights are read-only (no ack/dismiss) in v3.
- C4. New `/insights` nav item under an `Intelligence` group.
- C5. Faceplate replaces Inspector as *shared* component; same file family.
- C6. Global time picker and replay explicitly deferred.
- C7. No new npm/pip dependencies.
