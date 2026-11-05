# Console Redesign R2: Data-visualization System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** แทนกราฟและ widget ทั้งหมดด้วยชุด viz ที่มีมาตรฐาน Datadog/Grafana (Panel chrome, StatTile, BulletBar, TimeSeries v2, StateTimeline, BarList/Pareto, HeatStrip) ที่ใช้ได้ทั้ง light/dark แล้วย้าย Trends, Dashboards, Overview มาใช้

**Architecture:** ทุกการคำนวณ (path, segment, delta, onset, pareto, bin, สี) เป็น pure function ใน `web/src/viz/*.ts` ทดสอบด้วย bun:test; component ใน `web/src/viz/*.tsx` อ่านสีจาก CSS token ผ่าน `chartTheme()` ครั้งเดียวต่อการเปลี่ยน theme; uPlot ยังเป็น engine ของ time series

**Tech Stack:** React 19, uPlot 1.6, motion (จาก R1), Tailwind v4 tokens (จาก R1), bun:test

**Spec:** `docs/superpowers/specs/2026-10-20-console-redesign-design.md` §7 (และ §6.6 M1, M8, M10)

**Depends on:** R1 Task 7 (tokens/theme), Task 8 (motion), Task 10 (Popover/Menu), Task 12 (Tabs)

## Global Constraints

- Categorical palette **5 slot ลำดับตายตัว**: light `#2a78d6, #c0479d, #6250d6, #0b9a9a, #9b4fc4`; dark `#3987e5, #d55181, #9085e9, #13a0a0, #b06fd8` (ผ่าน validator 2026-10-20) — ห้ามสร้าง hue ที่ 6; เกินให้ small multiples
- สีตาม entity ไม่ตามลำดับ: filter/ซ่อน series ไม่ทำให้ series ที่เหลือเปลี่ยนสี
- หนึ่งหน่วยต่อหนึ่งกราฟ (ไม่มี dual axis); gridline solid hairline; เส้น 2 px; marker ≥ 8 px; limit line เท่านั้นที่เป็นเส้นประ
- ข้อความ/ค่า ใช้ ink token ไม่ใช้สี series; status colour (crit/warn/info/ok) ไม่ใช้เป็น series
- ทุก chart มี table view; tooltip ไม่ใช่ทางเดียวที่อ่านค่า; hit target ≥ 24 px
- Refetch ห้าม flash skeleton: คง render เดิมที่ opacity 0.6 (M10)
- ค่าในตาราง/แกน `tabular-nums`; hero/stat value proportional
- Global Constraints ของ R0–R1 plan ใช้ทั้งหมด

## Review Focus

1. **Series ถูกซ่อนแล้วเปิดกลับ หรือ signal picker เปลี่ยนลำดับ** → สีเดิมกลับมาที่ entity เดิม — test ใน Task 1 (`assignSeriesColors` คงสีจาก prior)
2. **History ว่างบางช่วง (edge offline)** → เส้นขาดเป็นช่อง ไม่ลากเชื่อม — test ใน Task 6 (`withGaps` แทรก null เมื่อช่องว่าง > 3× cadence)
3. **ค่า boolean ที่ไม่เปลี่ยนเลยทั้งช่วง** → StateTimeline ยังแสดงแถบเดียวเต็มช่วง ไม่ว่าง — test ใน Task 7
4. **Theme เปลี่ยนขณะเปิดกราฟ** → uPlot สร้างใหม่ด้วยสีของ theme ใหม่ — test ใน Task 1 (`chartThemeKey` เปลี่ยนเมื่อ theme เปลี่ยน) + ตรวจด้วยมือใน Task 10
5. **Dashboard เก่าที่บันทึก kind `gauge`/`pie`/`treemap`** → ยังเปิดได้ แสดงเป็น Meter/BarList — test ใน Task 11 (`rendererFor`)

---

## File Structure

```text
web/src/viz/palette.ts (+test)      SERIES light/dark, assignSeriesColors, chartTheme, chartThemeKey
web/src/viz/panelState.ts (+test)   panelState
web/src/viz/Panel.tsx               Panel chrome (header, badge, menu, fullscreen, states)
web/src/viz/stat.ts (+test)         statDelta, sparkPath
web/src/viz/StatTile.tsx            StatTile (+ M1)
web/src/viz/Sparkline.tsx           Sparkline v2
web/src/viz/bullet.ts (+test)       bulletScale
web/src/viz/BulletBar.tsx           BulletBar, Meter
web/src/viz/series.ts (+test)       withGaps, breachOnsets, legendToggle
web/src/viz/TimeSeries.tsx          uPlot wrapper v2 (แทน trends/TimeChart.tsx)
web/src/viz/annotations.ts          uPlot plugin วาด event markers
web/src/viz/timeline.ts (+test)     segments
web/src/viz/StateTimeline.tsx
web/src/viz/pareto.ts (+test)       pareto
web/src/viz/BarList.tsx
web/src/viz/heat.ts (+test)         binCounts, rampStep
web/src/viz/HeatStrip.tsx
web/src/viz/range.ts (+test)        parseRange, formatRange, RANGE_PRESETS
web/src/viz/TimeRangePicker.tsx
web/src/viz/i18n.ts                 viz2.* EN/TH
web/src/features/trends/TrendsPage.tsx         แก้ ใช้ viz ใหม่
web/src/features/dashboards/renderers.ts (+test) rendererFor
web/src/features/dashboards/widgets.tsx        แก้ ใช้ viz ใหม่
web/src/features/dashboards/DashboardsPage.tsx แก้ group header เรียบ
web/src/features/overview/OverviewPage.tsx     แก้ bento
web/src/features/overview/onboarding.ts (+test) onboardingVisible
tests/e2e/redesign_r2.py
```

---

### Task 1: Palette v2 + chart theme

**Files:**
- Create: `web/src/viz/palette.ts`, `web/src/viz/palette.test.ts`
- Modify: `web/src/features/trends/viz.ts:23-24` (re-export จาก palette.ts; `MAX_SERIES = 5`)

**Interfaces:**
- Produces: `SERIES: { light: readonly string[]; dark: readonly string[] }`; `assignSeriesColors(keys: string[], prior: Map<string, number>): Map<string, number>` (คืน slot index ต่อ key; key เดิมคง slot; key ใหม่ได้ slot ว่างที่เล็กสุด; เกิน 5 คืน `-1` ให้ผู้เรียกทำ small multiples); `type ChartTheme = { series: readonly string[]; grid: string; axis: string; text: string; surface: string; crit: string; warn: string; info: string }`; `chartTheme(theme: 'light' | 'dark', css: (name: string) => string): ChartTheme` (อ่าน `--color-line`, `--color-ink-3`, `--color-ink-2`, `--color-panel`, `--color-crit`, `--color-warn-ink`, `--color-info`); `chartThemeKey(t: ChartTheme): string`

- [ ] **Step 1: Write the failing test**

```ts
test('palette constants are the validated ones', () => {
  expect(SERIES.light).toEqual(['#2a78d6', '#c0479d', '#6250d6', '#0b9a9a', '#9b4fc4']);
  expect(SERIES.dark).toEqual(['#3987e5', '#d55181', '#9085e9', '#13a0a0', '#b06fd8']);
});
test('existing keys keep their slot', () => {
  const prior = new Map([['b', 1], ['c', 2]]);
  expect([...assignSeriesColors(['c', 'a', 'b'], prior)]).toEqual([['c', 2], ['a', 0], ['b', 1]]);
});
test('sixth series gets no colour', () =>
  expect(assignSeriesColors(['a', 'b', 'c', 'd', 'e', 'f'], new Map()).get('f')).toBe(-1));
test('theme key changes with theme', () => {
  const css = (n: string) => n;
  expect(chartThemeKey(chartTheme('light', css))).not.toBe(chartThemeKey(chartTheme('dark', css)));
});
```

- [ ] **Step 2: Run** `cd web && bun test src/viz/palette.test.ts` — Expected: FAIL
- [ ] **Step 3: Implement**; ใส่ comment หัวไฟล์ว่าค่าผ่าน dataviz validator วันที่ 2026-10-20 (light surface `#ffffff`, dark `#1b1f26`) และต้องรันซ้ำเมื่อแก้
- [ ] **Step 4: Run test** — Expected: PASS
- [ ] **Step 5: Commit** `feat(viz): validated 5-slot palette with stable entity colours`

### Task 2: Panel chrome

**Files:**
- Create: `web/src/viz/panelState.ts`, `web/src/viz/panelState.test.ts`, `web/src/viz/Panel.tsx`, `web/src/viz/i18n.ts`

**Interfaces:**
- Produces: `panelState(o: { loading: boolean; error: boolean; empty: boolean; stale: boolean; hasPrevious: boolean }): 'skeleton' | 'refetch' | 'error' | 'empty' | 'stale' | 'ready'` (loading + hasPrevious → `refetch`); `Panel` compound: `Panel.Root({ state, onRetry, children })`, `Panel.Header({ title, unit?, badge? /* "1h" */, info?, menu?: { label: string; onSelect: () => void }[], onFullscreen? })`, `Panel.Body`, `Panel.Footer` — container query `@container` ให้ body เลือก layout เองเมื่อกว้าง < 320 px; state `refetch` = body opacity 0.6 + crossfade `DUR.base`; `empty` ต้องบอกสิ่งที่จะเห็นและเวลา (`t('viz2.emptyWindow', { range })`)

- [ ] **Step 1: Write the failing test**

```ts
const base = { loading: false, error: false, empty: false, stale: false, hasPrevious: false };
test('first load is a skeleton', () => expect(panelState({ ...base, loading: true })).toBe('skeleton'));
test('refetch keeps the old render', () => expect(panelState({ ...base, loading: true, hasPrevious: true })).toBe('refetch'));
test('error beats empty', () => expect(panelState({ ...base, error: true, empty: true })).toBe('error'));
test('stale data is labelled', () => expect(panelState({ ...base, stale: true })).toBe('stale'));
```

- [ ] **Step 2: Run** `cd web && bun test src/viz/panelState.test.ts` — Expected: FAIL
- [ ] **Step 3: Implement** (header สูง 36 px, title 13/600, badge mono 11 ใน pill `--color-panel-2`, เมนูใช้ `Menu` จาก R1)
- [ ] **Step 4: Run test** — Expected: PASS
- [ ] **Step 5: Commit** `feat(viz): Panel chrome with honest states`

### Task 3: StatTile + Sparkline v2

**Files:**
- Create: `web/src/viz/stat.ts`, `web/src/viz/stat.test.ts`, `web/src/viz/StatTile.tsx`, `web/src/viz/Sparkline.tsx`

**Interfaces:**
- Consumes: `beyondDeadband`, `DUR`, `SPRING` (R1 Task 8)
- Produces: `statDelta(pts: { t: number; v: number }[], now: number, windowMs: number): { delta: number; pct: number | null; dir: 'up' | 'down' | 'flat' } | null` (เทียบค่าล่าสุดกับค่าที่ใกล้ `now - windowMs` ที่สุด; flat ถ้า |pct| < 0.5); `sparkPath(pts, w: number, h: number, domain?: [number, number]): string` (SVG `d`, ช่องว่าง > 3× median cadence เริ่ม `M` ใหม่); `StatTile({ label, value, unit?, decimals?, pts?, limits?: { v: number; severity: 'critical' | 'warning' }[], ts?, quality?, sim?: boolean, size?: 'md' | 'hero' | 'wall' })` — value proportional figures, unit ink-3, delta ลูกศร + % (สีกลาง ink-2: ทิศทางไม่ใช่ดี/ร้าย), freshness, `DemoBadge` เมื่อ sim; ค่าที่ข้าม limit ได้ outline + glyph สี severity; M1: ตัวเลข spring + underline flash เฉพาะเมื่อ `beyondDeadband`
- [ ] **Step 1: Write the failing test**

```ts
const pts = [{ t: 0, v: 10 }, { t: 30_000, v: 11 }, { t: 60_000, v: 12 }];
test('delta vs the window start', () => expect(statDelta(pts, 60_000, 60_000)).toEqual({ delta: 2, pct: 20, dir: 'up' }));
test('no history no delta', () => expect(statDelta([], 0, 60_000)).toBeNull());
test('gap breaks the path', () =>
  expect(sparkPath([{ t: 0, v: 1 }, { t: 1, v: 1 }, { t: 2, v: 1 }, { t: 10, v: 1 }], 100, 20).match(/M/g)?.length).toBe(2));
```

- [ ] **Step 2: Run** `cd web && bun test src/viz/stat.test.ts` — Expected: FAIL
- [ ] **Step 3: Implement**
- [ ] **Step 4: Run test** — Expected: PASS; เพิ่ม StatTile ทุก size ใน `/dev/ui`
- [ ] **Step 5: Commit** `feat(viz): StatTile and Sparkline v2`

### Task 4: BulletBar + Meter

**Files:**
- Create: `web/src/viz/bullet.ts`, `web/src/viz/bullet.test.ts`, `web/src/viz/BulletBar.tsx`

**Interfaces:**
- Produces: `bulletScale(o: { value: number; target?: number; max: number; bands?: number[] }): { valuePct: number; targetPct: number | null; bandPcts: number[] }` (clamp 0–100); `BulletBar({ label, value, unit, target?, max, bands?, tolerance?: number })` — แถบเทา band, แท่งค่า ink, เส้น target 3 px; ถ้า |value−target|/target > tolerance แสดง ◆ warn + ข้อความ deviation; `Meter({ value, max, label })` สำหรับอัตราส่วนเดียว (แทน gauge)
- [ ] **Step 1: Write the failing test**

```ts
test('scales and clamps', () =>
  expect(bulletScale({ value: 120, target: 80, max: 100, bands: [50] })).toEqual({ valuePct: 100, targetPct: 80, bandPcts: [50] }));
```

- [ ] **Step 2: Run** `cd web && bun test src/viz/bullet.test.ts` — Expected: FAIL
- [ ] **Step 3: Implement**
- [ ] **Step 4: Run test** — Expected: PASS
- [ ] **Step 5: Commit** `feat(viz): BulletBar and Meter`

### Task 5: Series helpers

**Files:**
- Create: `web/src/viz/series.ts`, `web/src/viz/series.test.ts`

**Interfaces:**
- Produces: `withGaps(pts: { t: number; v: number }[], factor = 3): { t: number; v: number | null }[]` (แทรก `{t, v:null}` ระหว่างจุดที่ห่าง > factor × median cadence); `breachOnsets(pts, limit: { v: number; kind: 'hi' | 'hihi' | 'lo' | 'lolo' }): number[]` (เวลาที่ข้ามเข้าเขต breach ครั้งแรกของแต่ละช่วง); `legendToggle(visible: Set<string>, key: string, mode: 'isolate' | 'toggle', all: string[]): Set<string>` (isolate ซ้ำบนตัวที่ isolate อยู่ = แสดงทั้งหมด)
- [ ] **Step 1: Write the failing test**

```ts
test('gap becomes null', () =>
  expect(withGaps([{ t: 0, v: 1 }, { t: 1, v: 1 }, { t: 2, v: 1 }, { t: 9, v: 1 }]).some((p) => p.v === null)).toBe(true));
test('onset only on entry', () =>
  expect(breachOnsets([{ t: 0, v: 70 }, { t: 1, v: 81 }, { t: 2, v: 85 }, { t: 3, v: 70 }, { t: 4, v: 90 }], { v: 80, kind: 'hi' })).toEqual([1, 4]));
test('isolate twice shows all', () => {
  const all = ['a', 'b', 'c'];
  const once = legendToggle(new Set(all), 'a', 'isolate', all);
  expect([...once]).toEqual(['a']);
  expect([...legendToggle(once, 'a', 'isolate', all)].sort()).toEqual(all);
});
```

- [ ] **Step 2: Run** `cd web && bun test src/viz/series.test.ts` — Expected: FAIL
- [ ] **Step 3: Implement**
- [ ] **Step 4: Run test** — Expected: PASS
- [ ] **Step 5: Commit** `feat(viz): gap, onset and legend helpers`

### Task 6: TimeSeries v2

**Files:**
- Create: `web/src/viz/TimeSeries.tsx`, `web/src/viz/annotations.ts`
- Modify: `web/src/features/trends/TimeChart.tsx` (เหลือเป็น re-export ของ TimeSeries เพื่อให้ import เดิมไม่แตกจนกว่า Task 10–11 ย้ายเสร็จ)

**Interfaces:**
- Consumes: `chartPhase` (R0 Task 1), `chartTheme/chartThemeKey/assignSeriesColors` (Task 1), `withGaps/breachOnsets/legendToggle` (Task 5), `chartOptions` จาก `features/trends/viz.ts` (ย้ายสีออกจาก constant ไปรับ `ChartTheme`)
- Produces: `TimeSeries({ series: ChartSeries[]; limits?: Limit[]; unit?: string; xRange: [number, number]; height?: number; fill?: boolean; syncKey?: string; onZoom?; annotations?: { t: number; kind: 'alarm' | 'command' | 'batch'; label: string; severity?: 'critical' | 'warning' }[]; view?: 'chart' | 'table'; loading?; error?; onRetry?; hasPrevious?: boolean })`; `annotationsPlugin(items): uPlot.Plugin` (วาด tick บนแกน x + เส้นแนวตั้ง hairline; alarm ใช้สี severity; command/batch ใช้ ink-3)
- [ ] **Step 1: Implement** — rebuild uPlot เมื่อ `structure` หรือ `chartThemeKey` เปลี่ยน; ข้อมูลผ่าน `withGaps`; onset marker (สามเหลี่ยมเล็ก สี severity ที่ขอบบน) จาก `breachOnsets` ต่อ limit; legend HTML ด้านล่าง: swatch + name + last value + unit, คลิก = isolate, ⌘/Ctrl-คลิก = toggle (`legendToggle`); `view='table'` แสดงตาราง t/series ล่าสุด 200 แถว; live: `setData` ทุก frame ที่มีจุดใหม่ (ไม่สร้างใหม่), drag-zoom แล้ว animate scale 250 ms (M8; ข้ามเมื่อ reduced motion)
- [ ] **Step 2: Verify** `bun run build`; เปิด `/trends` เลือก 2 signal หน่วยเดียวกัน → legend 2 รายการ, ซ่อน/แสดงไม่เปลี่ยนสี, สลับ theme แล้วสีกราฟเปลี่ยนตาม, ปิด WS (`docker stop webservice-edge-bridge-1` ชั่วคราว) แล้วเห็นเส้นขาดเป็นช่อง
- [ ] **Step 3: Commit** `feat(viz): TimeSeries v2 with annotations, onsets, table view`

### Task 7: StateTimeline

**Files:**
- Create: `web/src/viz/timeline.ts`, `web/src/viz/timeline.test.ts`, `web/src/viz/StateTimeline.tsx`

**Interfaces:**
- Produces: `type RunSeg = { from: number; to: number; state: 'running' | 'stopped' | 'fault' | 'nodata' }`; `segments(pts: { t: number; v: number }[], from: number, to: number, faultAt?: number[], staleMs = 15_000): RunSeg[]` (v>0 = running; ช่องว่าง > staleMs = nodata; ช่วงที่มี fault timestamp ทับ = fault); `StateTimeline({ rows: { label: string; segs: RunSeg[] }[]; from; to; onPick?(t) })` — แถว 16 px, running `--color-hmi-equip-run`, stopped `--color-hmi-equip`, fault `--color-crit` + hatch, nodata เส้นประ; tooltip ช่วงเวลา + duration; label ซ้าย 140 px
- [ ] **Step 1: Write the failing test**

```ts
test('constant signal fills the window', () =>
  expect(segments([{ t: 0, v: 1 }], 0, 100_000, [], 1e9)).toEqual([{ from: 0, to: 100_000, state: 'running' }]));
test('silence becomes nodata', () =>
  expect(segments([{ t: 0, v: 1 }, { t: 50_000, v: 1 }], 0, 50_000, [], 15_000).some((s) => s.state === 'nodata')).toBe(true));
test('stop then run', () =>
  expect(segments([{ t: 0, v: 0 }, { t: 10, v: 1 }], 0, 20, [], 1e9).map((s) => s.state)).toEqual(['stopped', 'running']));
```

- [ ] **Step 2: Run** `cd web && bun test src/viz/timeline.test.ts` — Expected: FAIL
- [ ] **Step 3: Implement**
- [ ] **Step 4: Run test** — Expected: PASS
- [ ] **Step 5: Commit** `feat(viz): StateTimeline`

### Task 8: BarList + Pareto

**Files:**
- Create: `web/src/viz/pareto.ts`, `web/src/viz/pareto.test.ts`, `web/src/viz/BarList.tsx`

**Interfaces:**
- Produces: `pareto(items: { label: string; value: number }[], top: number, otherLabel: string): { label: string; value: number; cumPct: number }[]` (เรียงมาก→น้อย, หางที่เกิน `top` รวมเป็นแถวเดียวชื่อ `otherLabel` ที่ผู้เรียกแปลแล้ว); `BarList({ items, unit, cumulative?: boolean, onPick? })` — แท่งแนวนอน slot 1 สีเดียว, ค่าชิดขวา tabular, เส้น cumulative บางเมื่อ `cumulative`
- [ ] **Step 1: Write the failing test**

```ts
test('sorted with cumulative share', () =>
  expect(pareto([{ label: 'a', value: 1 }, { label: 'b', value: 3 }], 8, 'Other')).toEqual([
    { label: 'b', value: 3, cumPct: 75 }, { label: 'a', value: 1, cumPct: 100 }]));
test('tail folds into Other', () =>
  expect(pareto([1, 2, 3, 4].map((v, i) => ({ label: `x${i}`, value: v })), 2, 'Other').at(-1)?.label).toBe('Other'));
```

- [ ] **Step 2: Run** `cd web && bun test src/viz/pareto.test.ts` — Expected: FAIL
- [ ] **Step 3: Implement**
- [ ] **Step 4: Run test** — Expected: PASS
- [ ] **Step 5: Commit** `feat(viz): BarList with Pareto`

### Task 9: HeatStrip (alarm density)

**Files:**
- Create: `web/src/viz/heat.ts`, `web/src/viz/heat.test.ts`, `web/src/viz/HeatStrip.tsx`
- Modify: `web/src/features/alarms/AlarmDensity.tsx` (ใช้ HeatStrip)

**Interfaces:**
- Produces: `binCounts(ts: number[], from: number, to: number, bins: number): number[]`; `rampStep(count: number, max: number, steps = 5): number` (0 เมื่อ count 0; 1..steps ตามสัดส่วน, sequential blue ramp ใน tokens `--color-seq-1 … --color-seq-5` ที่เพิ่มใน tokens.css ทั้ง light/dark); `HeatStrip({ ts, from, to, bins?, label })`
- [ ] **Step 1: Write the failing test**

```ts
test('counts land in bins', () => expect(binCounts([0, 5, 99], 0, 100, 2)).toEqual([2, 1]));
test('zero stays empty', () => expect(rampStep(0, 10)).toBe(0));
test('max is the darkest step', () => expect(rampStep(10, 10)).toBe(5));
```

- [ ] **Step 2: Run** `cd web && bun test src/viz/heat.test.ts` — Expected: FAIL
- [ ] **Step 3: Implement**; เพิ่ม `--color-seq-1..5` (light: `#dbe8fb #b3cff5 #7fb0ec #4a8be0 #1f63c4`; dark: `#1d2a3f #23426d #2c5f9f #3d7fd0 #6aa3ec`) ใน tokens.css
- [ ] **Step 4: Run test** — Expected: PASS
- [ ] **Step 5: Commit** `feat(viz): HeatStrip for alarm density`

### Task 10: Trends ใหม่ (Grafana Explore-like)

**Files:**
- Create: `web/src/viz/range.ts`, `web/src/viz/range.test.ts`, `web/src/viz/TimeRangePicker.tsx`
- Modify: `web/src/features/trends/TrendsPage.tsx`

**Interfaces:**
- Produces: `RANGE_PRESETS = ['15m', '1h', '4h', '8h', '24h', '7d', '30d'] as const`; `parseRange(search: string, now: number): { from: number; to: number; live: boolean; preset: string | null }` (`?range=1h` = live; `?from=<ms>&to=<ms>` = absolute; ค่าเสีย → 1h live); `formatRange(r): string` (คืน query string); `TimeRangePicker({ value, onChange })` — preset segmented + popover absolute (2 input datetime-local) + ปุ่ม pause live
- [ ] **Step 1: Write the failing test**

```ts
const now = 1_000_000_000_000;
test('preset is live', () => expect(parseRange('?range=4h', now)).toEqual({ from: now - 4 * 3600_000, to: now, live: true, preset: '4h' }));
test('absolute round-trips', () => {
  const r = parseRange('?from=1&to=2', now);
  expect(r.live).toBe(false);
  expect(parseRange(formatRange(r), now)).toEqual(r);
});
test('garbage falls back to 1h', () => expect(parseRange('?range=abc', now).preset).toBe('1h'));
```

- [ ] **Step 2: Run** `cd web && bun test src/viz/range.test.ts` — Expected: FAIL
- [ ] **Step 3: Implement** + เขียน TrendsPage ใหม่: header = title + TimeRangePicker + Equipment scope จาก ScopePicker (R1 Task 16) + Export; ซ้าย = signal picker จัดกลุ่มตาม ISA-95 (area › line › equipment) ค้นหาได้; ขวา = stack ของ `Panel` + `TimeSeries` หนึ่งต่อหน่วย, `syncKey` ร่วม, ปุ่ม compare "ช่วงก่อนหน้า" (series เทา ink-4 เส้น 1.5 px), annotations alarm/command ของ tag ที่เลือก; ล่าง = ตาราง stats (last/min/max/avg/unit/quality)
- [ ] **Step 4: Run test** — Expected: PASS; ตรวจ `/trends?range=4h` และลิงก์ absolute ทำงาน, URL เปลี่ยนเมื่อเลือก preset
- [ ] **Step 5: Commit** `feat(trends): Explore-style trends on the new viz kit`

### Task 11: Dashboard widgets ใช้ viz ใหม่

**Files:**
- Create: `web/src/features/dashboards/renderers.ts`, `web/src/features/dashboards/renderers.test.ts`
- Modify: `web/src/features/dashboards/widgets.tsx` (body ทุก kind ห่อด้วย `Panel`), `web/src/features/dashboards/DashboardsPage.tsx` (group header = แถบเทา `--color-panel-2` สูง 32 px, ไม่มี tone สีอิ่ม; `GroupTone` เหลือเป็น accent เส้นซ้าย 3 px)

**Interfaces:**
- Produces: `rendererFor(kind: VizKind): 'timeseries' | 'stat' | 'meter' | 'bullet' | 'barlist' | 'state' | 'histogram' | 'table' | 'alarms' | 'heat' | 'counts'` — `gauge → meter`, `bargauge → bullet`, `pie → barlist`, `treemap → barlist`, `toplist → barlist`, `value/stat → stat`, `stateline → state`
- [ ] **Step 1: Write the failing test**

```ts
test('retired forms map to honest ones', () => {
  expect(rendererFor('gauge')).toBe('meter');
  expect(rendererFor('pie')).toBe('barlist');
  expect(rendererFor('treemap')).toBe('barlist');
});
test('every VizKind has a renderer', () => {
  for (const k of ALL_VIZ_KINDS) expect(rendererFor(k)).toBeTruthy();
});
```

(`ALL_VIZ_KINDS` export ใหม่จาก `dashboards/model.ts` = ทุกค่าของ union `VizKind`)

- [ ] **Step 2: Run** `cd web && bun test src/features/dashboards/renderers.test.ts` — Expected: FAIL
- [ ] **Step 3: Implement**; widget editor (`WidgetEditor.tsx`) ซ่อน kind ที่ถูก map ออกจากตัวเลือกใหม่ แต่ยังเปิด dashboard เก่าได้
- [ ] **Step 4: Run test** — Expected: PASS; เปิด `/dashboards/incident-overview` ไม่มีบล็อกสี cyan/เขียวก้อนใหญ่
- [ ] **Step 5: Commit** `feat(dashboards): widgets on the new viz kit`

### Task 12: Overview bento

**Files:**
- Create: `web/src/features/overview/onboarding.ts`, `web/src/features/overview/onboarding.test.ts`
- Modify: `web/src/features/overview/OverviewPage.tsx`

**Interfaces:**
- Produces: `onboardingVisible(steps: { done: boolean }[], dismissed: boolean): 'full' | 'compact' | 'hidden'` (ครบทุกขั้น = hidden; dismissed = compact; อื่น = full)
- [ ] **Step 1: Write the failing test**

```ts
test('done hides it', () => expect(onboardingVisible([{ done: true }, { done: true }], false)).toBe('hidden'));
test('dismissed keeps a small card', () => expect(onboardingVisible([{ done: false }], true)).toBe('compact'));
```

- [ ] **Step 2: Run** `cd web && bun test src/features/overview/onboarding.test.ts` — Expected: FAIL
- [ ] **Step 3: Implement** bento 12 คอลัมน์: แถว 1 = plant state tile (ข้อความ + shape จาก `lineVerdict`, ไม่ใช่แบนเนอร์สี) span 4 + StatTile 4 ตัว (span 2) ที่มี sparkline/limit/freshness; แถว 2 = area tiles (placeholder `Panel` จนกว่า R3 ส่ง mini mimic) span 8 + top alarms span 4; แถว 3 = StateTimeline 8 h ของ equipment ที่ทำงานได้ span 8 + Insights (ตัวเลขต้องมีหน่วยและคำอธิบาย เช่น "นิ่ง 5 นาที 12 วิ") span 4; onboarding ตาม `onboardingVisible`
- [ ] **Step 4: Run test** — Expected: PASS
- [ ] **Step 5: Commit** `feat(overview): bento overview on the viz kit`

### Task 13: Visual check R2

**Files:**
- Create: `tests/e2e/redesign_r2.py`

- [ ] **Step 1: Write the script** (รูปแบบ sign-in/nav เหมือน `tests/e2e/redesign_r0.py`) ถ่าย `/`, `/trends?range=1h`, `/dashboards/incident-overview` ที่ 1440×900 และ 390×844 ทั้ง `data-theme=light` และ `dark` (ตั้งผ่าน `page.evaluate`) ลง `%TEMP%/redesign_r2/`; assert ทุกหน้ามี `canvas` หรือ `svg` ใน Panel ≥ 1 และไม่มี element ที่ `scrollWidth > clientWidth` ของ `body` ที่ 390 px
- [ ] **Step 2: Run** `WEB_URL=http://localhost:5199 python tests/e2e/redesign_r2.py` — Expected: exit 0; เปิดดูภาพทุกไฟล์ด้วยตา: ไม่มี label ชน, axis ไม่ถูกตัด, สี dark ไม่หลุด
- [ ] **Step 3: Run detector** `C:\Users\Gigabyte\.claude\skills\impeccable\scripts\impeccable.cmd detect --json web/src/viz` และแก้ข้อที่เป็น mechanical
- [ ] **Step 4: Commit** `test(e2e): R2 viz screenshots light/dark`
