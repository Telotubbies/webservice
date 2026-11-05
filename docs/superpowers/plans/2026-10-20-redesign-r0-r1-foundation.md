# Console Redesign R0–R1: Stabilize + Foundations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** แก้บั๊กที่ทำให้ console ดูพัง (R0) แล้ววางฐาน design system "Console 5" — tokens light/dark, motion, primitives, IA/rail/topbar ใหม่พร้อม redirect (R1)

**Architecture:** ทุก logic ที่ตัดสินใจได้แยกเป็น pure function ใน `.ts` ที่ทดสอบด้วย `bun:test`; component เป็น thin wrapper. Token ใหม่อยู่ใน `web/src/theme/tokens.css` (Tailwind v4 `@theme`, namespace `--color-*`) โดย dark override ใต้ `:root[data-theme=dark]`; ไฟล์ `dd-theme.css` เดิมยังอยู่ ชื่อที่ซ้ำถูก tokens.css ทับค่า. Primitive ใหม่อยู่ใน `web/src/ui/` (compound components, React 19 ไม่ใช้ forwardRef)

**Tech Stack:** React 19.2, react-router 8, Tailwind v4, TanStack Query 5, i18next, `motion` (ใหม่), bun:test, Playwright (Python, `channel="chrome"`)

**Spec:** `docs/superpowers/specs/2026-10-20-console-redesign-design.md` (§1 audit, §5 IA, §6 design system)

## Global Constraints

- ทุก string ใหม่มีทั้ง EN และ TH ในไฟล์ i18n ของ feature นั้น; `node scripts/check-i18n.mjs` ต้องผ่าน
- ห้าม hex ใน `.tsx` ใหม่ — ใช้ token (`bg-panel`, `text-ink-2`, `var(--color-crit)`)
- ห้าม `uppercase`/`tracking-*` บนข้อความที่อาจเป็นไทย; ใช้ `.overline`
- คง UAT hooks: `.side-nav`, `.topbar .live-pill`, `.top-clock`, `.user-btn`, `.palette-panel`, `.palette-input`, `.palette-option[data-item]`, `.skeleton`, `.error-state`
- localStorage อ่าน/เขียนใน try/catch เสมอ; หน้าใช้งานได้ถ้า storage ใช้ไม่ได้
- สีสถานะ: process surface ใช้สีเฉพาะ abnormal; "stopped" ไม่ใช้ `--color-crit`/`--color-danger`
- Motion: duration/easing มาจาก `web/src/theme/motion.ts` เท่านั้น; ทุก animation มีทาง reduced-motion
- Test web: `cd web && bun test <path>`; typecheck: `cd web && bun run build`; lint: `cd web && bun run lint`
- Commit ต่อ task; ข้อความ commit ลงท้าย `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`

## Review Focus

1. **Theme ที่เก็บไว้ใน localStorage ใช้ไม่ได้ (private window, throw)** → หน้าเปิดได้ด้วย theme `system` — test ใน Task 7 (`readThemePref` คืน `'system'` เมื่อ storage throw)
2. **ลิงก์เก่าจาก notification/email (`/line`, `/line3d`, `/infrastructure/sources/:edgeId`, `/oee`)** → ไปหน้าใหม่ที่ถูกต้องพร้อม param และ query — test ใน Task 14 (`resolveLegacy` คง `:edgeId` และ `?q=`)
3. **`/ack/:token` และ `/status` ต้องไม่ถูก redirect** — test ใน Task 14
4. **Alarm summary ต้องไม่นับ alarm ที่ cleared หรือ shelved อยู่ แต่ต้องนับกลับเมื่อ shelf หมดเวลา** — test ใน Task 15 (`summarizeAlarms`)
5. **ค่าที่แกว่งเล็กน้อยไม่ทำให้ flash (M1)** — test ใน Task 8 (`beyondDeadband` คืน false สำหรับ Δ < 0.5% ของ span)

---

## File Structure

```
web/src/theme/tokens.css          ใหม่  token light + dark (§6.2) + motion vars
web/src/theme/theme.ts            ใหม่  ThemePref, resolveTheme, read/write pref, applyTheme
web/src/theme/theme.test.ts       ใหม่
web/src/theme/motion.ts           ใหม่  DUR, EASE, SPRING, beyondDeadband
web/src/theme/motion.test.ts      ใหม่
web/src/ui/Button.tsx             ใหม่  Button, IconButton
web/src/ui/Badge.tsx              ใหม่  Badge, Kbd
web/src/ui/place.ts               ใหม่  placeFloating (pure positioning)
web/src/ui/place.test.ts          ใหม่
web/src/ui/Popover.tsx            ใหม่  Popover, Menu, Tooltip (top-layer popover API)
web/src/ui/Drawer.tsx             ใหม่  Drawer (native <dialog>, side sheet), Dialog
web/src/ui/toast.ts               ใหม่  toast queue (pure)
web/src/ui/toast.test.ts          ใหม่
web/src/ui/Toast.tsx              ใหม่  Toaster + useToast
web/src/ui/fields.ts              ใหม่  parseNumberField, clampStep
web/src/ui/fields.test.ts         ใหม่
web/src/ui/Fields.tsx             ใหม่  Input, NumberField, Select, Switch, Checkbox
web/src/ui/Tabs.tsx               ใหม่  Tabs (compound)
web/src/ui/i18n.ts                ใหม่  ui.* strings EN/TH
web/src/features/devui/DevUiPage.tsx  ใหม่  /dev/ui gallery (DEV only)
web/src/app/nav.ts                แก้   โครง Plant/Engineering/Platform/Admin
web/src/app/redirects.ts          ใหม่  LEGACY map + resolveLegacy
web/src/app/redirects.test.ts     ใหม่
web/src/app/alarmSummary.ts       ใหม่  summarizeAlarms
web/src/app/alarmSummary.test.ts  ใหม่
web/src/app/Shell.tsx             แก้   rail ยุบได้, topbar 40px, chip, theme, assistant
web/src/app/ScopePicker.tsx       ใหม่
web/src/app/paletteCommands.ts(+test) ใหม่  คำสั่งใน ⌘K
web/src/lib/scope.ts              แก้   เพิ่ม areaId/lineId
web/src/App.tsx                   แก้   route ใหม่ + legacy redirects + MotionConfig
web/src/main.tsx                  แก้   import tokens.css ผ่าน index.css, applyTheme ก่อน render
web/src/index.css                 แก้   @import "./theme/tokens.css" หลัง dd-theme
scripts/check-hex.mjs             ใหม่  กัน hex ใหม่ใน .tsx
R0:
web/src/features/trends/TimeChart.tsx + chartMount.ts(+test)
web/src/features/line/LinePage.tsx + schematic.ts(+test)
web/src/shared/ui/LineStatusBar.tsx + lineVerdict.ts(+test)
web/src/features/devices/NetworkMapPage.tsx + mapModel.ts(+test)
web/src/features/health/EdgeFleetTable.tsx
web/src/features/metrics/MetricsSummaryPage.tsx
tests/e2e/redesign_r0.py          ใหม่  Playwright smoke ของ R0
```

---

## R0 — Stabilize

### Task 1: TimeChart สร้าง uPlot หลัง loading จบ

**Files:**
- Create: `web/src/features/trends/chartMount.ts`, `web/src/features/trends/chartMount.test.ts`
- Modify: `web/src/features/trends/TimeChart.tsx:58-77`

**Interfaces:**
- Produces: `chartPhase(o: { loading?: boolean; error?: boolean; hasData: boolean }): 'loading' | 'error' | 'empty' | 'plot'`

- [ ] **Step 1: Reproduce ก่อน** — เปิด `/trends` (dev :5199, `?demo=admin`, org Demo) เลือก Belt speed; ยืนยันว่าไม่มี `<canvas>` ใน `.u-wrap` ทั้งที่ตาราง Series มีค่า; บันทึกลำดับ `loading`/`hasData` ด้วย `console.log` ชั่วคราวใน effect แล้วลบออก
- [ ] **Step 2: Write the failing test**

```ts
import { describe, expect, test } from 'bun:test';
import { chartPhase } from './chartMount';
describe('chartPhase', () => {
  test('loading wins over data', () => expect(chartPhase({ loading: true, hasData: true })).toBe('loading'));
  test('error before empty', () => expect(chartPhase({ error: true, hasData: false })).toBe('error'));
  test('plot when data and idle', () => expect(chartPhase({ hasData: true })).toBe('plot'));
  test('empty when idle without data', () => expect(chartPhase({ hasData: false })).toBe('empty'));
});
```

- [ ] **Step 3: Run** `cd web && bun test src/features/trends/chartMount.test.ts` — Expected: FAIL (module not found)
- [ ] **Step 4: Implement** `chartPhase` แล้วใน `TimeChart.tsx` คำนวณ `const phase = chartPhase({ loading, error, hasData })`; effect ที่สร้าง uPlot ใช้ deps `[structure, phase === 'plot']` และ return ทันทีถ้า `phase !== 'plot'`; branch การ render ใช้ `phase` แทนเงื่อนไขกระจาย
- [ ] **Step 5: Run test** — Expected: PASS; แล้ว reload `/trends` ยืนยันว่ามี canvas และเส้นกราฟ
- [ ] **Step 6: Commit** `fix(trends): mount uPlot once loading ends`

### Task 2: Line view ไม่เอา drawing ของ batching plant มาใส่ sorting line

**Files:**
- Create: `web/src/features/line/schematic.ts`, `web/src/features/line/schematic.test.ts`
- Modify: `web/src/features/line/LinePage.tsx:179-201`

**Interfaces:**
- Produces: `schematicFor(src: { model: { id: string } | null; status: string }): 'model-plan' | 'line-mimic'`

- [ ] **Step 1: Write the failing test**

```ts
test('bundled demo model is never drawn under the sorting line', () =>
  expect(schematicFor({ model: null, status: 'ready' })).toBe('line-mimic'));
test('an uploaded model gets its plan', () =>
  expect(schematicFor({ model: { id: 'm1' }, status: 'ready' })).toBe('model-plan'));
```

- [ ] **Step 2: Run** `cd web && bun test src/features/line/schematic.test.ts` — Expected: FAIL
- [ ] **Step 3: Implement** และใน `PlantSchematic` ถ้า `schematicFor(src) === 'line-mimic'` ให้ render `<Mimic sel={…} onSelect={…}/>` (ของ sorting line) พร้อมลิงก์ "เปิด 3D twin" ไป `/line3d`
- [ ] **Step 4: Run test** — Expected: PASS; screenshot `/line` ต้องไม่มีคำว่า "Cement silo"
- [ ] **Step 5: Commit** `fix(line): keep the demo batching plan out of the sorting line view`

### Task 3: STOPPED ไม่ใช่ alarm (ISA-101)

**Files:**
- Create: `web/src/shared/ui/lineVerdict.ts`, `web/src/shared/ui/lineVerdict.test.ts`
- Modify: `web/src/shared/ui/LineStatusBar.tsx:14-22`

**Interfaces:**
- Produces: `type Verdict = 'running' | 'stopped' | 'stale' | 'nodata'`; `VERDICT_TONE: Record<Verdict, string>`; `lineVerdict(o: { hasSample: boolean; fresh: boolean; wsOpen: boolean; running: boolean }): Verdict`

- [ ] **Step 1: Write the failing test**

```ts
test('stopped uses the neutral tone', () => {
  expect(VERDICT_TONE.stopped).not.toContain('danger');
  expect(VERDICT_TONE.stopped).toContain('neutral-soft');
});
test('dead feed reads stale, never stopped', () =>
  expect(lineVerdict({ hasSample: true, fresh: true, wsOpen: false, running: false })).toBe('stale'));
test('no sample reads nodata', () =>
  expect(lineVerdict({ hasSample: false, fresh: false, wsOpen: true, running: false })).toBe('nodata'));
```

- [ ] **Step 2: Run** `cd web && bun test src/shared/ui/lineVerdict.test.ts` — Expected: FAIL
- [ ] **Step 3: Implement** ย้าย `TONE`/`GLYPH`/logic verdict ออกจาก `LineStatusBar.tsx`; `stopped` = `bg-[var(--color-neutral-soft)] text-[var(--color-ink)]`, `running` = neutral เช่นกันแต่ glyph ● เข้ม (สีมีไว้ให้ stale/alarm)
- [ ] **Step 4: Run test** — Expected: PASS
- [ ] **Step 5: Commit** `fix(status): stopped is a normal state, not red`

### Task 4: Network map ไม่ full-mesh และยุบ edge ที่ปิดใช้งาน

**Files:**
- Create: `web/src/features/devices/mapModel.ts`, `web/src/features/devices/mapModel.test.ts`
- Modify: `web/src/features/devices/NetworkMapPage.tsx:22-153`, `web/src/features/devices/i18n` keys ใน `features/devices/devices.ts` หรือไฟล์ i18n ที่มีอยู่ของ `dev.*`
- Modify: `web/src/features/health/EdgeFleetTable.tsx` (ซ่อน disabled เป็นค่าเริ่มต้น + toggle "แสดงที่ปิดใช้งาน (n)")

**Interfaces:**
- Produces: `splitGateways<T extends { status: string; last_hb_at: string | null }>(edges: T[]): { active: T[]; parked: T[] }` (parked = status `disabled` หรือ `last_hb_at === null`)

- [ ] **Step 1: Write the failing test**

```ts
test('disabled and never-connected edges are parked', () => {
  const r = splitGateways([
    { id: 'a', status: 'active', last_hb_at: '2026-10-20T00:00:00Z' },
    { id: 'b', status: 'disabled', last_hb_at: null },
    { id: 'c', status: 'active', last_hb_at: null },
  ]);
  expect(r.active.map((e) => e.id)).toEqual(['a']);
  expect(r.parked.map((e) => e.id)).toEqual(['b', 'c']);
});
```

- [ ] **Step 2: Run** `cd web && bun test src/features/devices/mapModel.test.ts` — Expected: FAIL
- [ ] **Step 3: Implement**; ใน NetworkMapPage วาดเฉพาะ `active` + node เดียว "ปิดใช้งาน / Parked (n)" ที่ลิงก์ไป `/infrastructure?status=disabled`; เส้น gateway→equipment วาด **เฉพาะ gateway ที่ออนไลน์และมี source** ไม่ใช่ทุกคู่; ลบข้อความ `dev.mapNote` ที่อ้างว่า tag ไม่ผูก gateway (แทนด้วย "แผนที่เต็มอยู่ใน Connectivity (เร็ว ๆ นี้)")
- [ ] **Step 4: Run test** — Expected: PASS; screenshot `/infrastructure/map` ใน org Demo ต้องไม่มีเส้นไขว้เป็นร่างแห
- [ ] **Step 5: Commit** `fix(infra): park disabled gateways instead of meshing them`

### Task 5: Metrics summary ไม่ขัดแย้งตัวเองระหว่างโหลด

**Files:**
- Modify: `web/src/features/metrics/MetricsSummaryPage.tsx:77-110`

- [ ] **Step 1: Reproduce** — เปิด `/metrics` ใน org Demo; จับเวลา `GET …/tag-stats` ใน devtools Network; ถ้า > 10 s หรือ pending ตลอด ให้ใช้ skill systematic-debugging หา root cause ที่ backend ก่อน (ห้ามแก้แค่ UI ถ้า endpoint ค้าง)
- [ ] **Step 2: Implement** lede แสดง `t('msum.loadingLede')` ("กำลังนับสัญญาณ…" / "Counting signals…") ขณะ `stats.isLoading`; facet แสดง skeleton แทน "—"; เพิ่ม key ใน i18n ของ msum ทั้ง EN/TH
- [ ] **Step 3: Verify** reload `/metrics`: ระหว่างโหลดไม่มีข้อความ "0 signals"; หลังโหลดเห็นตาราง; `node scripts/check-i18n.mjs` ผ่าน
- [ ] **Step 4: Commit** `fix(metrics): no contradictory lede while stats load`

### Task 6: Playwright smoke ของ R0

**Files:**
- Create: `tests/e2e/redesign_r0.py`

- [ ] **Step 1: Write the script** — sign-in ด้วย `?demo=admin` ที่ `/line`, เลือก org `Demo` ผ่าน `<select>` (เปลี่ยน value แล้ว dispatch `change`), นำทางด้วย `history.pushState` + `popstate` (session อยู่ใน memory), launch `chromium.launch(headless=True, channel=os.environ.get("PW_CHANNEL", "chrome"))`, รอด้วย `load` + `wait_for_timeout`; assert: (a) `/trends` มี `.u-wrap canvas` ≥ 1; (b) `/line` ไม่มีข้อความ "Cement silo"; (c) `/infrastructure/map` มีข้อความ "Parked"; (d) `/` แบนเนอร์ status ไม่มี class ที่มี `danger` เมื่อ verdict = stopped; บันทึก screenshot ลง `%TEMP%/redesign_r0/`
- [ ] **Step 2: Run** `WEB_URL=http://localhost:5199 python tests/e2e/redesign_r0.py` — Expected: exit 0, พิมพ์ `ok` 4 บรรทัด
- [ ] **Step 3: Commit** `test(e2e): R0 stabilize smoke`

---

## R1 — Foundations

### Task 7: Theme tokens light/dark + theme preference

**Files:**
- Create: `web/src/theme/tokens.css`, `web/src/theme/theme.ts`, `web/src/theme/theme.test.ts`
- Modify: `web/src/index.css:5-6` (เพิ่ม `@import "./theme/tokens.css";` ต่อจาก dd-theme), `web/src/main.tsx` (เรียก `applyTheme(readThemePref())` ก่อน `createRoot`)

**Interfaces:**
- Produces: `type ThemePref = 'light' | 'dark' | 'system'`; `resolveTheme(pref: ThemePref, prefersDark: boolean): 'light' | 'dark'`; `readThemePref(storage?: Pick<Storage, 'getItem'>): ThemePref` (key `wds.theme`); `writeThemePref(p: ThemePref, storage?: Pick<Storage, 'setItem'>): void`; `applyTheme(pref: ThemePref, doc?: Document): 'light' | 'dark'` (ตั้ง `document.documentElement.dataset.theme` และ `style.colorScheme`)

- [ ] **Step 1: Write the failing test**

```ts
test('system follows the OS', () => {
  expect(resolveTheme('system', true)).toBe('dark');
  expect(resolveTheme('system', false)).toBe('light');
});
test('explicit pref wins', () => expect(resolveTheme('light', true)).toBe('light'));
test('throwing storage falls back to system', () =>
  expect(readThemePref({ getItem: () => { throw new Error('denied'); } })).toBe('system'));
test('garbage value falls back to system', () =>
  expect(readThemePref({ getItem: () => 'neon' })).toBe('system'));
```

- [ ] **Step 2: Run** `cd web && bun test src/theme/theme.test.ts` — Expected: FAIL
- [ ] **Step 3: Implement theme.ts**; **tokens.css**: ใน `@theme` ใส่ค่า light ของ spec §6.2 ทุกแถว ด้วยชื่อ `--color-ground, --color-panel, --color-panel-2, --color-line, --color-line-strong, --color-ink, --color-ink-2, --color-ink-3, --color-ink-4, --color-chrome, --color-chrome-2, --color-accent, --color-accent-soft, --color-hmi-bg, --color-hmi-equip, --color-hmi-equip-run, --color-hmi-edge, --color-hmi-line-idle, --color-crit, --color-crit-soft, --color-warn (fill #f2a900), --color-warn-ink (#b26a00), --color-warn-soft, --color-info, --color-ok, --color-sim` และ medium hues `--color-medium-aggregate … --color-medium-signal`; แล้ว `:root[data-theme=dark] { … }` ใส่คอลัมน์ Dark; ใส่ type scale เพิ่ม `--text-body: 14px; --text-stat: 28px; --text-hero: 40px; --text-wall: 64px; --text-wall-xl: 96px` (คงของเดิม 10–22 px); elevation `--shadow-ply1: 0 1px 2px rgb(16 24 40 / .06)`, `--shadow-ply2: 0 4px 16px rgb(16 24 40 / .12)`, `--shadow-ply3: 0 12px 40px rgb(16 24 40 / .22)` (dark: alpha ×2); density `[data-density=comfortable]{--h-control:32px;--h-row:40px}` และ `[data-density=compact]{--h-control:28px;--h-row:32px}`; ใส่ radius `--radius-control: 6px; --radius-panel: 8px; --radius-overlay: 12px` และ motion vars `--dur-instant: 80ms; --dur-fast: 140ms; --dur-base: 220ms; --dur-slow: 360ms; --dur-process: 600ms; --ease-standard: cubic-bezier(.2,0,0,1); --ease-enter: cubic-bezier(0,0,0,1); --ease-exit: cubic-bezier(.3,0,1,1)`; `body { background: var(--color-ground) }` ภายใต้ `.app-shell` เท่านั้น (landing ไม่โดน)
- [ ] **Step 4: Run test** — Expected: PASS; `cd web && bun run build` ผ่าน; เปิด `/` แล้วสลับ `document.documentElement.dataset.theme='dark'` ใน console เห็นพื้นมืด
- [ ] **Step 5: Commit** `feat(theme): Console 5 tokens with light/dark and theme preference`

### Task 8: Motion foundation

**Files:**
- Create: `web/src/theme/motion.ts`, `web/src/theme/motion.test.ts`
- Modify: `web/package.json` (`bun add motion` — pin เวอร์ชันที่ resolve ได้), `web/src/App.tsx` (ครอบ `<MotionConfig reducedMotion="user">` รอบ `<BrowserRouter>`), `web/src/index.css:229-238` (ให้ reduced-motion block ครอบ `.app-shell` ใช้ต่อ)

**Interfaces:**
- Produces: `DUR = { instant: 0.08, fast: 0.14, base: 0.22, slow: 0.36, process: 0.6 } as const` (วินาที สำหรับ motion); `EASE = { standard: [0.2, 0, 0, 1], enter: [0, 0, 0, 1], exit: [0.3, 0, 1, 1] } as const`; `SPRING = { snappy: { type: 'spring', stiffness: 520, damping: 38 }, gentle: { type: 'spring', stiffness: 260, damping: 30 } } as const`; `exitOf(d: number): number` (= d × 0.7); `beyondDeadband(prev: number | null, next: number, span: number, frac = 0.005): boolean`; `type MotionPref = 'full' | 'calm'`, `readMotionPref(storage?)` / `writeMotionPref(p, storage?)` (key `wds.motion`, try/catch, ค่าเสีย → `'full'`); `calm` = `MotionConfig reducedMotion="always"` + `document.documentElement.dataset.motion = 'calm'` ที่ CSS ใช้ปิด loop ทุกตัว **ยกเว้น** process flow (M4) และ alarm blink (M2) ซึ่งเป็นข้อมูล ไม่ใช่การตกแต่ง

- [ ] **Step 1: Write the failing test**

```ts
test('tiny wiggle stays inside the deadband', () => expect(beyondDeadband(50, 50.3, 100)).toBe(false));
test('a real change leaves it', () => expect(beyondDeadband(50, 51, 100)).toBe(true));
test('first value always counts', () => expect(beyondDeadband(null, 3, 100)).toBe(true));
test('zero span never divides by zero', () => expect(beyondDeadband(1, 2, 0)).toBe(true));
test('exit is faster than enter', () => expect(exitOf(DUR.base)).toBeCloseTo(0.154, 3));
test('bad motion pref falls back to full', () => expect(readMotionPref({ getItem: () => 'wild' })).toBe('full'));
```

- [ ] **Step 2: Run** `cd web && bun test src/theme/motion.test.ts` — Expected: FAIL
- [ ] **Step 3: Implement** + เพิ่ม dependency + MotionConfig
- [ ] **Step 4: Run test** — Expected: PASS; `bun run build` ผ่าน
- [ ] **Step 5: Commit** `feat(motion): motion tokens, springs, deadband`

### Task 9: Button, IconButton, Badge, Kbd

**Files:**
- Create: `web/src/ui/Button.tsx`, `web/src/ui/Badge.tsx`, `web/src/ui/i18n.ts`

**Interfaces:**
- Produces: `Button(props: ButtonHTMLAttributes & { variant?: 'primary' | 'secondary' | 'ghost' | 'danger'; size?: 'sm' | 'md' | 'lg'; loading?: boolean; icon?: ReactNode })` — สูง sm 24 / md 32 / lg 40, radius `--radius-control`, primary ใช้ `--color-accent` (สี action ปรากฏเฉพาะของที่กดได้; disabled ไม่มีสี accent), `loading` แสดง spinner และตั้ง `aria-busy`; `IconButton(props: … & { label: string })` (บังคับ `aria-label`); `Badge({ tone: 'neutral' | 'accent' | 'crit' | 'warn' | 'info' | 'ok' | 'sim'; children })` — crit/warn/info แสดง glyph ▲/◆/● นำหน้าเสมอ; `Kbd({ children })`
- [ ] **Step 1: Implement** (presentational; ไม่มี logic ให้ unit test) — press state ใช้ `motion.button` `whileTap={{ scale: 0.97 }}` ด้วย `DUR.instant`
- [ ] **Step 2: Verify** `bun run build` + `bun run lint` ผ่าน; ตรวจใน gallery (Task 13)
- [ ] **Step 3: Commit** `feat(ui): Button, IconButton, Badge, Kbd`

### Task 10: Floating positioning + Popover, Menu, Tooltip

**Files:**
- Create: `web/src/ui/place.ts`, `web/src/ui/place.test.ts`, `web/src/ui/Popover.tsx`

**Interfaces:**
- Produces: `type Rect = { x: number; y: number; w: number; h: number }`; `placeFloating(anchor: Rect, float: { w: number; h: number }, viewport: { w: number; h: number }, side: 'top' | 'bottom' | 'left' | 'right', gap = 6): { x: number; y: number; side: typeof side }` (พลิกด้านเมื่อล้น, clamp ให้อยู่ใน viewport ห่างขอบ 8 px); `Popover` compound: `Popover.Root`, `Popover.Trigger`, `Popover.Content` (ใช้ HTML `popover="auto"` → top layer, ไม่โดน overflow clip); `Menu` = Popover + roving focus (↑↓ Home End, Enter, Esc ปิดและคืน focus); `Tooltip({ label, children })` เปิดหลัง hover 400 ms / focus ทันที, `role="tooltip"` + `aria-describedby`
- [ ] **Step 1: Write the failing test**

```ts
const vp = { w: 1000, h: 800 };
test('bottom by default', () =>
  expect(placeFloating({ x: 100, y: 100, w: 40, h: 20 }, { w: 120, h: 60 }, vp, 'bottom')).toEqual({ x: 60, y: 126, side: 'bottom' }));
test('flips to top near the bottom edge', () =>
  expect(placeFloating({ x: 100, y: 760, w: 40, h: 20 }, { w: 120, h: 60 }, vp, 'bottom').side).toBe('top'));
test('clamps inside the viewport', () =>
  expect(placeFloating({ x: 990, y: 100, w: 10, h: 20 }, { w: 120, h: 60 }, vp, 'bottom').x).toBe(872));
```

- [ ] **Step 2: Run** `cd web && bun test src/ui/place.test.ts` — Expected: FAIL
- [ ] **Step 3: Implement**; enter/exit ของ Content ใช้ `AnimatePresence` + opacity/scale 0.98→1 ด้วย `SPRING.snappy`, exit `exitOf(DUR.base)` (M11)
- [ ] **Step 4: Run test** — Expected: PASS
- [ ] **Step 5: Commit** `feat(ui): floating placement, Popover, Menu, Tooltip`

### Task 11: Drawer, Dialog, Toast

**Files:**
- Create: `web/src/ui/Drawer.tsx`, `web/src/ui/toast.ts`, `web/src/ui/toast.test.ts`, `web/src/ui/Toast.tsx`
- Modify: `web/src/app/Shell.tsx` (mount `<Toaster/>` ครั้งเดียว)

**Interfaces:**
- Produces: `Drawer({ open, onClose, side?: 'right' | 'left', width?: number, title: ReactNode, children, footer? })` — native `<dialog>` + `showModal()`, ply3 (scrim + blur), focus แรกที่ปุ่มปิด, Esc ปิด, คืน focus ให้ trigger, slide-in `SPRING.gentle`; `Dialog` = Drawer แบบกลางจอ (แทน `.dialog` เดิมในของใหม่เท่านั้น); toast queue pure: `type ToastItem = { id: string; tone: 'info' | 'ok' | 'warn' | 'crit'; text: string; ttlMs: number }`, `pushToast(q: ToastItem[], t: ToastItem, max = 4): ToastItem[]` (ใหม่อยู่บน, เกิน max ตัดตัวเก่าสุด, id ซ้ำ = แทนที่ไม่เพิ่ม), `expire(q: ToastItem[], now: number, born: Map<string, number>): ToastItem[]`; `useToast(): (t: Omit<ToastItem, 'id'> & { id?: string }) => void`; Toaster เป็น `aria-live="polite"` (crit = `assertive`)
- [ ] **Step 1: Write the failing test**

```ts
const t = (id: string): ToastItem => ({ id, tone: 'info', text: id, ttlMs: 4000 });
test('newest first, capped', () =>
  expect(pushToast([t('a'), t('b'), t('c'), t('d')], t('e')).map((x) => x.id)).toEqual(['e', 'a', 'b', 'c']));
test('same id replaces', () => expect(pushToast([t('a')], { ...t('a'), text: 'x' })).toHaveLength(1));
test('expires after ttl', () =>
  expect(expire([t('a')], 5000, new Map([['a', 0]]))).toHaveLength(0));
```

- [ ] **Step 2: Run** `cd web && bun test src/ui/toast.test.ts` — Expected: FAIL
- [ ] **Step 3: Implement**
- [ ] **Step 4: Run test** — Expected: PASS
- [ ] **Step 5: Commit** `feat(ui): Drawer, Dialog, Toast`

### Task 12: Fields + Tabs

**Files:**
- Create: `web/src/ui/fields.ts`, `web/src/ui/fields.test.ts`, `web/src/ui/Fields.tsx`, `web/src/ui/Tabs.tsx`

**Interfaces:**
- Produces: `filterOptions(options: { value: string; label: string; hint?: string }[], q: string, locale: string)` (ใน `fields.ts`); `parseNumberField(raw: string, o: { min?: number; max?: number; locale?: string }): { ok: true; value: number } | { ok: false; reason: 'empty' | 'nan' | 'min' | 'max' }` (รับ "1,5" ใน th/en? — รับเฉพาะจุดทศนิยม `.`; ช่องว่างตัดทิ้ง); `clampStep(v: number, step: number, min?: number, max?: number): number`; `NumberField({ value, onChange, unit, min, max, step, label, hint })` — mono, ปุ่ม −/+, ข้อความ error ใต้ช่อง `role="alert"`; `Input`, `Select` (native), `Switch` (`role="switch"`), `Checkbox`, `Combobox({ options: { value: string; label: string; hint?: string }[]; value; onChange; placeholder; label })` (ARIA combobox + listbox, กรองด้วย `filterOptions(options, q, locale)` ที่ไม่สนตัวพิมพ์และวรรณยุกต์ไทยไม่ถูกตัด, ↑↓ Enter Esc); `Tabs` compound: `Tabs.Root value onValueChange`, `Tabs.List`, `Tabs.Tab value`, `Tabs.Panel value` — ลูกศรซ้าย/ขวาเลื่อน, indicator เลื่อนด้วย `layoutId` (motion)
- [ ] **Step 1: Write the failing test**

```ts
test('blank is empty, not zero', () => expect(parseNumberField('  ', {})).toEqual({ ok: false, reason: 'empty' }));
test('range enforced', () => expect(parseNumberField('61', { max: 60 })).toEqual({ ok: false, reason: 'max' }));
test('accepts decimals', () => expect(parseNumberField('45.5', { min: 0, max: 60 })).toEqual({ ok: true, value: 45.5 }));
test('step snaps and clamps', () => expect(clampStep(7.3, 0.5, 0, 7)).toBe(7));
test('combobox filter is case-insensitive', () => expect(filterOptions([{ value: 'a', label: 'Cement Silo 3' }], 'silo', 'en')).toHaveLength(1));
```

- [ ] **Step 2: Run** `cd web && bun test src/ui/fields.test.ts` — Expected: FAIL
- [ ] **Step 3: Implement**
- [ ] **Step 4: Run test** — Expected: PASS
- [ ] **Step 5: Commit** `feat(ui): fields and tabs`

### Task 13: `/dev/ui` gallery

**Files:**
- Create: `web/src/features/devui/DevUiPage.tsx`
- Modify: `web/src/App.tsx` (`{import.meta.env.DEV && <Route path="dev/ui" element={page(DevUiPage)} />}`)

- [ ] **Step 1: Implement** หน้าเดียวแสดงทุก primitive จาก Task 9–12 ในทุก state (default, hover ด้วย class บังคับ, focus-visible, disabled, loading, error) ทั้งสอง density และปุ่มสลับ theme บนหน้า
- [ ] **Step 2: Verify** เปิด `http://localhost:5199/dev/ui?demo=admin` ทั้ง light/dark; ภาพ screenshot ไม่มี text หลุด/ทับ; production build (`bun run build`) ไม่มี string "DevUiPage" ใน `dist/assets/*.js` (`grep -L`)
- [ ] **Step 3: Commit** `feat(devui): component gallery for the redesign`

### Task 14: IA ใหม่ + legacy redirects

**Files:**
- Create: `web/src/app/redirects.ts`, `web/src/app/redirects.test.ts`
- Modify: `web/src/app/nav.ts` (ทั้งไฟล์), `web/src/App.tsx:265-340`, i18n keys `nav.*` ใหม่ใน `web/src/lib/i18n.ts`

**Interfaces:**
- Produces: `LEGACY: ReadonlyArray<[from: string, to: string]>` — อย่างน้อย: `/line → /live`, `/line3d → /live/3d`, `/line3d/map → /setup/model`, `/structure → /setup/structure`, `/tags → /setup/tags`, `/admin/rules → /setup/rules`, `/admin/rules/new → /setup/rules/new`, `/infrastructure → /connect/gateways`, `/infrastructure/sources → /connect/gateways`, `/infrastructure/sources/:edgeId → /connect/gateways/:edgeId`, `/infrastructure/map → /connect`, `/infrastructure/profiles → /connect/profiles`, `/infrastructure/add → /connect/add`, `/infrastructure/cameras → /vision/cameras`, `/infrastructure/models → /vision/models`, `/infrastructure/rules → /vision/rules`, `/infrastructure/events → /vision/events`, `/oee → /production/oee`, `/stops → /production/stops`, `/shifts → /production/shifts`, `/reports → /production/reports`, `/health → /connect/health`; `resolveLegacy(pathname: string, search: string): string | null` (แทน `:param` และคง `search`; คืน null ถ้าไม่ใช่ legacy)
- Produces (nav.ts): `NavGroup.cluster: 'plant' | 'engineering' | 'platform' | 'admin'`; Plant: Overview `/`, Live `/live`, Alarms `/alarms`, Trends `/trends`, Production `/production/oee`, Dashboards `/dashboards`; Engineering: Plant setup `/setup/structure`, Connectivity `/connect`, Vision AI `/vision/cameras`; Platform: ทุก item ที่เคยอยู่ใน `nav.devPortal, nav.incidentResponse, nav.automation, nav.apm, nav.digitalExperience, nav.security, nav.intelligence, nav.errors, nav.metrics(ยกเว้น trends/tags), nav.logs, nav.monitoring(ยกเว้น alarms)`; Admin: เดิม
- [ ] **Step 1: Write the failing test**

```ts
test('params survive', () => expect(resolveLegacy('/infrastructure/sources/abc', '?source=s1')).toBe('/connect/gateways/abc?source=s1'));
test('plain move', () => expect(resolveLegacy('/oee', '')).toBe('/production/oee'));
test('ack links are untouched', () => expect(resolveLegacy('/ack/tok123', '')).toBeNull());
test('status page is untouched', () => expect(resolveLegacy('/status', '')).toBeNull());
test('every target is unique per source', () => {
  const from = LEGACY.map(([f]) => f);
  expect(new Set(from).size).toBe(from.length);
});
```

- [ ] **Step 2: Run** `cd web && bun test src/app/redirects.test.ts` — Expected: FAIL
- [ ] **Step 3: Implement** redirects + nav.ts; ใน App.tsx เพิ่ม route ใหม่ชี้ component เดิม (`/live` → LinePage ชั่วคราว, `/live/3d` → Line3DPage, `/setup/model` → MapEditor, `/connect` → NetworkMapPage, `/connect/gateways` → DataSourcesPage, `/connect/gateways/:edgeId` → GatewayPage, ฯลฯ) และ component `LegacyRedirect` ที่ match `LEGACY` ด้วย `resolveLegacy(useLocation())` → `<Navigate replace>`; `DEVICE_TABS` ใน `features/devices/tabs.ts` ชี้ path ใหม่
- [ ] **Step 4: Run test** — Expected: PASS; `bun run build` ผ่าน; คลิกทุก item ใน rail ใน dev ไม่มี 404/redirect วน
- [ ] **Step 5: Commit** `feat(nav): plant-first IA with legacy redirects`

### Task 15: Shell ใหม่ — rail ยุบได้, topbar 40 px, alarm summary chip, theme toggle

**Files:**
- Create: `web/src/app/alarmSummary.ts`, `web/src/app/alarmSummary.test.ts`
- Modify: `web/src/app/Shell.tsx:508-678`

**Interfaces:**
- Consumes: `NAV` (Task 14), `applyTheme/readThemePref/writeThemePref` (Task 7), `Tooltip`, `Menu` (Task 10), `useAlarms()` จาก `features/alarms/alarms`
- Produces: `summarizeAlarms(alarms: Pick<Alarm, 'state' | 'severity' | 'acked_at' | 'shelved_until'>[], now: number): { critical: number; warning: number; info: number; unacked: number }` (ไม่นับ `state === 'cleared'` และ alarm ที่ `Date.parse(shelved_until) > now`; severity ผ่าน `normSeverity`); rail width 200 px / 56 px collapsed (key `wds.rail` ใน localStorage, try/catch); cluster divider + label `.overline` ต่อ cluster; Platform cluster พับเป็นค่าเริ่มต้น
- [ ] **Step 1: Write the failing test**

```ts
const NOW = Date.parse('2026-10-20T12:00:00Z');
test('cleared and shelved are not counted', () =>
  expect(summarizeAlarms([
    { state: 'active', severity: 'critical' },
    { state: 'cleared', severity: 'critical' },
    { state: 'active', severity: 'warning', shelved_until: '2026-10-20T13:00:00Z' },
    { state: 'acked', severity: 'warning', acked_at: '2026-10-20T11:00:00Z' },
  ], NOW)).toEqual({ critical: 1, warning: 1, info: 0, unacked: 1 }));
test('an expired shelf counts again', () =>
  expect(summarizeAlarms([{ state: 'active', severity: 'critical', shelved_until: '2026-10-20T11:00:00Z' }], NOW).critical).toBe(1));
```

- [ ] **Step 2: Run** `cd web && bun test src/app/alarmSummary.test.ts` — Expected: FAIL
- [ ] **Step 3: Implement**; topbar: `[logo][ScopePicker (Task 16)][⌘K][spacer][AlarmSummaryChip ▲n ◆n][ShiftBadge][.top-clock][.live-pill][Assistant IconButton → /assistant][Theme Menu: Light/Dark/System][bell][.user-btn]`; chip กดแล้วเปิด Drawer รายการ alarm active — แยก markup ของแถวใน `features/alarms/AlarmsPage.tsx` ออกเป็น `features/alarms/AlarmRow.tsx` (export `AlarmRow({ alarm, onAck? })`, ไม่เปลี่ยนหน้าตาเดิม) แล้วใช้ทั้งสองที่; ถ้ามี unacked critical chip ใช้พื้น `--color-crit-soft` และกระพริบ 1 Hz จน ack (M2) เว้น reduced-motion
- [ ] **Step 4: Run test** — Expected: PASS; รัน `tests/e2e/uat.mjs` (ตามที่ repo ใช้) หรือ Playwright smoke Task 6 ยังผ่าน; UAT selectors ครบ
- [ ] **Step 5: Commit** `feat(shell): collapsible rail, 40px topbar, alarm summary chip, theme switch`

### Task 16: ScopePicker (Org › Site › Area › Line)

**Files:**
- Create: `web/src/app/ScopePicker.tsx`, `web/src/lib/scopeModel.ts`, `web/src/lib/scopeModel.test.ts`
- Modify: `web/src/lib/scope.ts` (เพิ่ม `areaId?: string; lineId?: string` ใน scope และ setter `setScopeLine(areaId: string | null, lineId: string | null)`)

**Interfaces:**
- Consumes: `hierarchyApi.tree(org, site)` → `{ areas: HArea[] }`
- Produces: `scopeCrumbs(tree: HArea[], s: { areaId?: string; lineId?: string }): { label: string; id: string; level: 'area' | 'line' }[]`; `repairScope(tree: HArea[], s): { areaId?: string; lineId?: string }` (line ที่ไม่อยู่ใน area แล้ว/ถูกลบ → ล้างทิ้ง)
- [ ] **Step 1: Write the failing test**

```ts
const tree = [{ id: 'a1', name: 'Batching', lines: [{ id: 'l1', name: 'Line 1' }] }] as HArea[];
test('crumbs follow the tree', () => expect(scopeCrumbs(tree, { areaId: 'a1', lineId: 'l1' }).map((c) => c.label)).toEqual(['Batching', 'Line 1']));
test('stale line is dropped', () => expect(repairScope(tree, { areaId: 'a1', lineId: 'gone' })).toEqual({ areaId: 'a1' }));
```

- [ ] **Step 2: Run** `cd web && bun test src/lib/scopeModel.test.ts` — Expected: FAIL
- [ ] **Step 3: Implement** ScopePicker = OrgSwitcher เดิม (org) + Popover สองระดับ (area → line) ค้นหาได้; แทน OrgSwitcher ใน topbar
- [ ] **Step 4: Run test** — Expected: PASS
- [ ] **Step 5: Commit** `feat(scope): ISA-95 scope picker in the topbar`

### Task 17: กัน hex ใหม่ใน TSX

**Files:**
- Create: `scripts/check-hex.mjs`, `scripts/check-hex.allow.txt` (รายการไฟล์ legacy ที่มี hex อยู่แล้ว ณ วันนี้ — สร้างครั้งเดียวจากผล scan)

**Interfaces:**
- Produces: CLI `node scripts/check-hex.mjs` — สแกน `web/src/**/*.tsx` หา `#[0-9a-fA-F]{3,8}\b` นอก comment; ไฟล์ใน allowlist ข้าม; ออก exit 1 พร้อม `path:line` ถ้าเจอ
- [ ] **Step 1: Generate allowlist** `node scripts/check-hex.mjs --write-allow` (สร้าง allow จากสถานะปัจจุบัน)
- [ ] **Step 2: Verify** ใส่ `className="text-[#ff0000]"` ชั่วคราวใน `web/src/ui/Badge.tsx` → `node scripts/check-hex.mjs` exit 1 ชี้บรรทัดนั้น; เอาออก → exit 0
- [ ] **Step 3: Add to CI** เพิ่ม step `node scripts/check-hex.mjs` ใน `.github/workflows/ci.yml` ต่อจาก check-i18n
- [ ] **Step 4: Commit** `chore(ci): block new hex colours in TSX`

### Task 18: ⌘K palette actions

**Files:**
- Create: `web/src/app/paletteCommands.ts`, `web/src/app/paletteCommands.test.ts`
- Modify: `web/src/app/Palette.tsx`

**Interfaces:**
- Consumes: `NAV` (Task 14), `summarizeAlarms` (Task 15), `writeThemePref` (Task 7)
- Produces: `type PaletteCommand = { id: string; group: 'navigate' | 'action' | 'equipment' | 'alarm'; label: string; hint?: string; run: () => void; enabled: boolean }`; `paletteCommands(ctx: { nav: NavGroup[]; role: string; alarms: Alarm[]; equipment: { label: string; lineId: string }[]; navigate: (to: string) => void; ackVisible: () => void; setTheme: (p: ThemePref) => void; t: (k: string) => string }): PaletteCommand[]` — navigate ทุก item ใน NAV; actions: "รับทราบ alarm ที่เห็นทั้งหมด / Acknowledge visible alarms" (enabled เมื่อ role ≥ operator และมี unacked), "สลับธีม: สว่าง/มืด/ตามระบบ"; equipment: "เปิด <label>" → `/live/:lineId?select=<label>` และ "Trend ของ <label>" → `/trends?equipment=<label>`
- [ ] **Step 1: Write the failing test**

```ts
const base = { nav: NAV, role: 'viewer', alarms: [], equipment: [{ label: 'Cement silo 3', lineId: 'l1' }], navigate: () => {}, ackVisible: () => {}, setTheme: () => {}, t: (k: string) => k };
test('viewer cannot ack', () => expect(paletteCommands(base).find((c) => c.id === 'ack-visible')?.enabled).toBe(false));
test('equipment gets open and trend', () =>
  expect(paletteCommands(base).filter((c) => c.group === 'equipment').map((c) => c.id)).toEqual(['open:Cement silo 3', 'trend:Cement silo 3']));
```

- [ ] **Step 2: Run** `cd web && bun test src/app/paletteCommands.test.ts` — Expected: FAIL
- [ ] **Step 3: Implement** และให้ Palette แสดงกลุ่ม (Navigate / Actions / Equipment) คงคลาส `.palette-panel`, `.palette-input`, `.palette-option[data-item]`
- [ ] **Step 4: Run test** — Expected: PASS
- [ ] **Step 5: Commit** `feat(palette): actions, equipment and theme commands`

---

## Execution notes
- R0 Task 1–6 ทำก่อน และ deploy dev (`docker compose build web && docker compose up -d web` สำหรับ :5173) เพื่อให้ demo ไม่พังระหว่างทำ R1
- หลังจบ R1 ให้รัน `C:\Users\Gigabyte\.claude\skills\impeccable\scripts\impeccable.cmd detect --json web/src/ui web/src/app` ครั้งเดียวและแก้สิ่งที่เป็น mechanical
