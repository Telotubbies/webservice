# Console Redesign R4: Gateway Topology Editor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** แทน Network map แบบ full-mesh และหน้า gateway ตารางแบน ด้วย **live topology ที่แก้ไขได้ในตัว**: Gateway → Data source → Tag group → Equipment (และ Gateway → Camera → AI model) พร้อม health บนเส้น, inspector drawer, ปุ่ม "+" เพิ่มสิ่งถัดไป, ลาก tag group ไปผูก equipment

**Architecture:** graph สร้างฝั่ง client ด้วย pure `buildTopology()` จาก API ที่มีอยู่ (ไม่มี endpoint ใหม่เว้นแต่ Task 6 วัดแล้วช้า); layout และ health เป็น pure function; render ด้วย SVG + ใช้ view math จาก R3 (`features/process/model/view.ts`); ฟอร์มทั้งหมดอยู่ใน `Drawer` (R1) และนำ logic ของ `SourceWizard`/`TagTable` เดิมกลับมาใช้

**Tech Stack:** React 19, TanStack Query 5, SVG, motion, bun:test, Playwright

**Spec:** `docs/superpowers/specs/2026-10-20-console-redesign-design.md` §9 (และ §6.6 M7, M12; §4 S4)

**Depends on:** R1 (Drawer, Menu, Tabs, Button, Fields, Toast, routes `/connect*`), R3 Task 10 (`zoomAt`, `fitView`)

## Global Constraints

- ทุก node และเส้นมาจากข้อมูลจริง: `data_sources.edge_id`, `tags.source_id`, `tags.device_id`, `cameras.edge_id`, pin model ของกล้อง — ห้ามวาดเส้นที่ไม่มีความสัมพันธ์ในข้อมูล
- Edge `disabled` หรือ `last_hb_at === null` อยู่ใน node รวม "ปิดใช้งาน / Parked (n)" เสมอ (ใช้ `splitGateways` จาก R0 Task 4)
- Mutation ทุกอย่างทำผ่าน API เดิม (`dsApi.*`, `hierarchyApi.moveTags`, `adminApi.rotateDevice`/`adminApi.disableDevice`, `camApi.*`) และสิทธิ์เดิม (admin/owner แก้ได้; คนอื่นอ่านอย่างเดียว + `PermissionNotice`)
- การกระทำที่ย้อนไม่ได้หรือกระทบ PLC (ลบ source, ย้าย tag, disable edge, rotate key) ต้องผ่าน `Confirm` ที่บอกผลกระทบ 1 ประโยค
- Address แสดงแบบอ่านได้ตาม protocol; JSON ดิบอยู่ใน "Advanced" เท่านั้น
- Global Constraints ของ R0–R1 ใช้ทั้งหมด

## Review Focus

1. **Tag ที่ `source_id` เป็น null (tag เก่าก่อน migration 0015 หรือ derived tag)** → อยู่ใน group "ไม่มีแหล่ง / Unsourced" ใต้ site ไม่หาย — test ใน Task 1
2. **Source ที่ edge ถูก disable** → source และ tag group ย้ายไปอยู่ใต้ node Parked ด้วย ไม่ลอยค้าง — test ใน Task 1
3. **ย้าย tag group ไป equipment แล้ว API ล้มเหลวครึ่งทาง** → UI rollback เป็นสถานะเดิม + toast error ที่บอกจำนวนที่ย้ายไม่สำเร็จ — test ใน Task 9 (`applyMoveResult`)
4. **Site ที่มี 2,000+ tags** → เปิดหน้าภายใน 1.5 s เพราะ tag group โหลด lazy เมื่อขยาย source — Task 6 วัดและตัดสิน endpoint
5. **Address ที่ protocol ไม่รู้จักหรือ JSON เสีย** → แสดง "—" + ปุ่ม Advanced ไม่ crash — test ใน Task 3

---

## File Structure

```text
web/src/features/topology/model/graph.ts (+test)     TopoNode, TopoEdge, buildTopology
web/src/features/topology/model/health.ts (+test)    nodeHealth, linkState, packetPeriod
web/src/features/topology/model/address.ts (+test)   formatAddress
web/src/features/topology/model/layout.ts (+test)    layoutTopology
web/src/features/topology/model/move.ts (+test)      planMove, applyMoveResult
web/src/features/topology/useTopology.ts             queries + lazy tags
web/src/features/topology/TopoCanvas.tsx             SVG host (pan/zoom, minimap)
web/src/features/topology/TopoNode.tsx
web/src/features/topology/TopoEdge.tsx
web/src/features/topology/Inspector.tsx              drawer ต่อชนิด node
web/src/features/topology/AddNext.tsx
web/src/features/topology/TopologyPage.tsx           /connect
web/src/features/topology/i18n.ts
web/src/ui/table.ts (+test)                           sortRows, groupRows
web/src/ui/DataTable.tsx                              generic table (sticky, sort, group, virtual)
web/src/features/datasources/GatewayPage.tsx          แก้ เป็น tabs + DataTable
web/src/features/datasources/TagTable.tsx             แก้ ใช้ DataTable + drawer editor
tests/e2e/redesign_r4.py
```

---

### Task 1: buildTopology

**Files:**
- Create: `web/src/features/topology/model/graph.ts`, `web/src/features/topology/model/graph.test.ts`

**Interfaces:**
- Consumes: `Device` (edge row, `lib/api.ts:508`), `DataSource`, `SourceTag` (`features/datasources/api.ts`), `HArea` (`lib/api.ts`), `Camera` (`features/cameras/api.ts`), `splitGateways` (R0 Task 4)
- Produces:
```ts
type TopoKind = 'site' | 'gateway' | 'parked' | 'source' | 'tagGroup' | 'unsourced' | 'equipment' | 'camera' | 'model';
interface TopoNode { id: string; kind: TopoKind; label: string; sub?: string; ref?: string; count?: number; parent?: string }
interface TopoEdge { id: string; from: string; to: string; kind: 'uplink' | 'poll' | 'feeds' | 'video' | 'infer' }
interface TopoInput {
  site: { id: string; name: string; code: string };
  edges: Device[]; sources: Record<string, DataSource[]>;   // key = edge id
  tags: Record<string, SourceTag[] | undefined>;          // key = source id; undefined = ยังไม่โหลด
  areas: HArea[]; cameras: Record<string, Camera[]>; pins: Record<string, { model_name: string } | undefined>;
  unsourced: number;
}
function buildTopology(i: TopoInput): { nodes: TopoNode[]; edges: TopoEdge[] }
```
  กฎ: id = `${kind}:${ref}`; tag group = tag ของ source เดียวกันที่ `device` เดียวกัน (ใช้ `SourceTag.device`, ค่าว่าง → `"(ไม่ระบุ)"`); tag group → equipment เมื่อ device ของ tag map เจอใน `areas[].lines[].equipment[].tag_paths` (เทียบ path); source ที่ยังไม่โหลด tag → ไม่มี tagGroup node แต่ `count = source.tag_count`; edge parked → `parked` node เดียว (children ทั้งหมดของมันต่อใต้ parked); `unsourced > 0` → node `unsourced:site`
- [ ] **Step 1: Write the failing test** — fixture: 2 edges (`e1` active hb ล่าสุด, `e2` disabled), `e1` มี source `s1` (tags 3 ตัว device `conveyor` 2 ตัว, `motor` 1 ตัว), `e2` มี source `s2`, `areas` มี equipment `Conveyor` ที่ `tag_paths` มี path ของ tag conveyor, กล้อง 1 ตัวบน `e1` pin model "YOLO26n-seg"; assertions:

```ts
const g = buildTopology(fixture);
const ids = (k: TopoKind) => g.nodes.filter((n) => n.kind === k).map((n) => n.id);
test('one parked node holds disabled edges', () => {
  expect(ids('parked')).toEqual(['parked:site']);
  expect(g.nodes.find((n) => n.id === 'source:s2')?.parent).toBe('parked:site');
});
test('tags group by device per source', () => expect(ids('tagGroup').sort()).toEqual(['tagGroup:s1/conveyor', 'tagGroup:s1/motor']));
test('groups feed mapped equipment only', () =>
  expect(g.edges.filter((e) => e.kind === 'feeds').map((e) => [e.from, e.to])).toEqual([['tagGroup:s1/conveyor', `equipment:${CONVEYOR_ID}`]]));
test('camera chain', () => expect(g.edges.some((e) => e.kind === 'infer' && e.from === 'camera:c1')).toBe(true));
test('unloaded source still shows its count', () => {
  const g2 = buildTopology({ ...fixture, tags: {} });
  expect(g2.nodes.find((n) => n.id === 'source:s1')?.count).toBe(3);
});
test('unsourced tags are not lost', () => expect(buildTopology({ ...fixture, unsourced: 4 }).nodes.some((n) => n.kind === 'unsourced' && n.count === 4)).toBe(true));
```

- [ ] **Step 2: Run** `cd web && bun test src/features/topology/model/graph.test.ts` — Expected: FAIL
- [ ] **Step 3: Implement**
- [ ] **Step 4: Run test** — Expected: PASS
- [ ] **Step 5: Commit** `feat(topology): build the connectivity graph from real relations`

### Task 2: Health + link state

**Files:**
- Create: `web/src/features/topology/model/health.ts` (+test)

**Interfaces:**
- Consumes: `deviceState(d, now)` (`features/devices/devices.ts`), `STALE_MS`
- Produces: `type Health = 'ok' | 'degraded' | 'down' | 'off' | 'unknown'`; `nodeHealth(n: TopoNode, ctx: { edge?: Device; source?: DataSource; camera?: Camera; fresh?: { fresh: number; stale: number; bad: number }; now: number }): { health: Health; reasons: string[] /* i18n keys */ }` — gateway: offline/never = down, stale heartbeat หรือ `clock_ok === false` หรือ `config_applied < config_version` = degraded (+ reason `topo.cfgPending`), `config_error` = down; source: `status === 'error'` = down, `!enabled` = off, null = unknown; tagGroup: bad > 0 = down, stale > 0 = degraded; camera: `status` error = down, `model_state === 'loading'` = degraded; `linkState(from: Health, to: Health): 'ok' | 'degraded' | 'broken' | 'off'` (เส้นแตกเมื่อปลายใดปลายหนึ่ง down); `packetPeriod(msgsPerMin: number): number | null` (วินาทีต่อ packet สำหรับ M7: 0 → null; clamp 0.4–6 s)
- [ ] **Step 1: Write the failing test**

```ts
const now = Date.parse('2026-10-20T12:00:00Z');
test('pending config degrades a gateway', () =>
  expect(nodeHealth({ id: 'gateway:e1', kind: 'gateway', label: 'Edge 1' },
    { edge: { ...edgeOk, config_version: 5, config_applied: 4 }, now })).toMatchObject({ health: 'degraded', reasons: ['topo.cfgPending'] }));
test('a down end breaks the link', () => expect(linkState('ok', 'down')).toBe('broken'));
test('no traffic, no packets', () => expect(packetPeriod(0)).toBeNull());
test('busy links clamp', () => expect(packetPeriod(10_000)).toBe(0.4));
```

(`edgeOk` = Device ที่ `last_hb_at` = now − 2 s, `clock_ok: true`, `status: 'active'`)

- [ ] **Step 2: Run** `cd web && bun test src/features/topology/model/health.test.ts` — Expected: FAIL
- [ ] **Step 3: Implement**
- [ ] **Step 4: Run test** — Expected: PASS
- [ ] **Step 5: Commit** `feat(topology): node health and link state`

### Task 3: Readable addresses

**Files:**
- Create: `web/src/features/topology/model/address.ts` (+test)

**Interfaces:**
- Produces: `formatAddress(protocol: Protocol, address: unknown, locale: string): { text: string; advanced: string }` — `modbus` `{area:'hr',offset:0,type:'int16',scale:0.1}` → `"HR 40001 · int16 · ×0.1"` (coil 00001, discrete 10001, input 30001, holding 40001 = offset + base); `s7` `{db:10,offset:4,type:'real'}` → `"DB10.DBD4 · real"` (bool `DBX4.0`, int `DBW`, real/dint `DBD`); `opcua` `{node:'ns=2;s=Belt.Speed'}` → `"ns=2;s=Belt.Speed"`; `sim` `{behavior:'wander',lo:15,hi:95}` → TH `"สุ่มเดิน 15–95"` / EN `"random walk 15–95"`, `{behavior:'follow',follows:'auto/x/running',gain:1.2}` → `"follows auto/x/running ×1.2"`, `state` → `"ค่าคงที่ (เขียนได้)"`/`"held value (writable)"`, `cycle` → `"cycle 0–100 / 14 s"`; อื่น/เสีย → `{ text: '—', advanced: JSON.stringify(address) ?? '' }`; `advanced` = JSON จัดรูปเสมอ
- [ ] **Step 1: Write the failing test**

```ts
test('modbus holding register', () => expect(formatAddress('modbus', { area: 'hr', offset: 0, type: 'int16', scale: 0.1 }, 'en').text).toBe('HR 40001 · int16 · ×0.1'));
test('s7 real', () => expect(formatAddress('s7', { db: 10, offset: 4, type: 'real' }, 'en').text).toBe('DB10.DBD4 · real'));
test('sim wander in thai', () => expect(formatAddress('sim', { behavior: 'wander', lo: 15, hi: 95 }, 'th').text).toBe('สุ่มเดิน 15–95'));
test('garbage never throws', () => expect(formatAddress('modbus', 'not-json{', 'en').text).toBe('—'));
```

- [ ] **Step 2: Run** `cd web && bun test src/features/topology/model/address.test.ts` — Expected: FAIL
- [ ] **Step 3: Implement** (ข้อความแปลอยู่ใน `features/topology/i18n.ts`; function รับ `t` ไม่ได้เพราะเป็น pure — ใช้ตาราง `LABEL[locale]` ภายในไฟล์ แล้ว export `ADDRESS_LABELS` ให้ check-i18n ตรวจครบทั้งสองภาษา)
- [ ] **Step 4: Run test** — Expected: PASS
- [ ] **Step 5: Commit** `feat(topology): readable PLC addresses`

### Task 4: Topology layout

**Files:**
- Create: `web/src/features/topology/model/layout.ts` (+test)

**Interfaces:**
- Consumes: `TopoNode`, `TopoEdge` (Task 1)
- Produces: `COLUMNS: Record<TopoKind, number>` (site 0, gateway/parked 1, source/camera 2, tagGroup/model/unsourced 3, equipment 4); `layoutTopology(g: { nodes; edges }, collapsed: Set<string>, size = { colW: 240, rowH: 64, nodeW: 196, nodeH: 48 }): { pos: Map<string, { x: number; y: number }>; routes: Map<string, [number, number][]>; bounds: { w: number; h: number } }` — ลูกของ node ที่ collapsed ไม่ได้ตำแหน่ง; ลำดับในคอลัมน์ตาม parent (tidy tree: ลูกเรียงตาม label, parent อยู่กึ่งกลางของลูก); equipment ที่รับจากหลาย group วางที่ค่าเฉลี่ย y ของ group แล้วแก้ซ้อนด้วยการดันลง; route = orthogonal ผ่าน channel กลางระหว่างคอลัมน์
- [ ] **Step 1: Write the failing test**

```ts
test('columns follow the data path', () => {
  const { pos } = layoutTopology(sampleGraph, new Set());
  expect(pos.get('gateway:e1')!.x).toBeLessThan(pos.get('source:s1')!.x);
  expect(pos.get('source:s1')!.x).toBeLessThan(pos.get('tagGroup:s1/conveyor')!.x);
});
test('collapsed children are hidden', () =>
  expect(layoutTopology(sampleGraph, new Set(['source:s1'])).pos.has('tagGroup:s1/conveyor')).toBe(false));
test('no two nodes share a slot', () => {
  const ys = [...layoutTopology(sampleGraph, new Set()).pos.values()].map((p) => `${p.x}:${p.y}`);
  expect(new Set(ys).size).toBe(ys.length);
});
```

(`sampleGraph` = `buildTopology(fixture)` จาก Task 1 — export fixture จาก `graph.test.ts` เป็น `model/fixtures.ts`)

- [ ] **Step 2: Run** `cd web && bun test src/features/topology/model/layout.test.ts` — Expected: FAIL
- [ ] **Step 3: Implement**
- [ ] **Step 4: Run test** — Expected: PASS
- [ ] **Step 5: Commit** `feat(topology): tidy column layout`

### Task 5: DataTable

**Files:**
- Create: `web/src/ui/table.ts` (+test), `web/src/ui/DataTable.tsx`

**Interfaces:**
- Produces: `sortRows<T>(rows: T[], key: keyof T, dir: 'asc' | 'desc', locale: string): T[]` (stable; null ไว้ท้ายเสมอ; string ใช้ `Intl.Collator(locale, { numeric: true })`); `groupRows<T>(rows: T[], by: (r: T) => string): { key: string; rows: T[] }[]` (คงลำดับการพบครั้งแรก); `DataTable<T>({ rows, columns: { key: keyof T | string; header: ReactNode; cell?: (r: T) => ReactNode; sortable?: boolean; align?: 'left' | 'right'; mono?: boolean; width?: number }[]; rowKey: (r: T) => string; groupBy?: (r: T) => string; groupHeader?: (key: string, rows: T[]) => ReactNode; onRowClick?; selected?: string | null; density?: 'comfortable' | 'compact'; empty?: ReactNode; virtualizeOver?: number /* default 200 */ })` — header sticky, `aria-sort`, คลิก header สลับ asc/desc/none, group header พับได้, virtual rows เมื่อเกินเกณฑ์ (คำนวณ window เองจาก scrollTop; ไม่เพิ่ม dependency)
- [ ] **Step 1: Write the failing test**

```ts
test('nulls sort last both ways', () => {
  const r = [{ v: 2 }, { v: null }, { v: 1 }];
  expect(sortRows(r, 'v', 'asc', 'en').map((x) => x.v)).toEqual([1, 2, null]);
  expect(sortRows(r, 'v', 'desc', 'en').map((x) => x.v)).toEqual([2, 1, null]);
});
test('numeric-aware strings', () =>
  expect(sortRows([{ n: 'bin10' }, { n: 'bin2' }], 'n', 'asc', 'en').map((x) => x.n)).toEqual(['bin2', 'bin10']));
test('groups keep first-seen order', () =>
  expect(groupRows([{ d: 'b' }, { d: 'a' }, { d: 'b' }], (r) => r.d).map((g) => g.key)).toEqual(['b', 'a']));
```

- [ ] **Step 2: Run** `cd web && bun test src/ui/table.test.ts` — Expected: FAIL
- [ ] **Step 3: Implement** + เพิ่มใน `/dev/ui`
- [ ] **Step 4: Run test** — Expected: PASS
- [ ] **Step 5: Commit** `feat(ui): DataTable with sorting, grouping, virtual rows`

### Task 6: useTopology + performance gate

**Files:**
- Create: `web/src/features/topology/useTopology.ts`

**Interfaces:**
- Consumes: `adminApi.devices(org, site)`, `dsApi.sources(org, edgeId)`, `dsApi.tags(org, edgeId, sourceId)`, `hierarchyApi.tree(org, site, true)`, `camApi.cameras(org, edgeId)`, `visionApi.pin(org, camId)`, `buildTopology`, `nodeHealth`
- Produces: `useTopology(orgId: string | undefined, siteId: string | undefined, expanded: Set<string>): { graph: { nodes: TopoNode[]; edges: TopoEdge[] } | null; health: Map<string, ReturnType<typeof nodeHealth>>; loading: boolean; error: unknown; refetch(): void }` — tags โหลดเฉพาะ source ที่อยู่ใน `expanded` (query key `['ds-tags', org, edge, source]` เดียวกับ TagTable เดิมเพื่อ share cache); refetch 10 s สำหรับ edges/sources (เหมือนหน้าเดิม)
- [ ] **Step 1: Implement**
- [ ] **Step 2: Measure** — seed site ทดสอบ 2,000 tags (สคริปต์เล็กใน `scripts/` เรียก `sources/{s}/tags:bulk` ของ sim source; ลบทิ้งหลังวัด) แล้ววัดเวลาจาก navigation ถึง graph พร้อมใน `/connect` (Performance panel หรือ `performance.mark`) ×3 ครั้ง
- [ ] **Step 3: Decide** — ถ้า median ≤ 1.5 s: บันทึกผลใน commit message และจบ; ถ้า > 1.5 s: เพิ่ม task ย่อย 6b — endpoint `GET /api/v1/orgs/{org}/sites/{site}/topology` ใน `backend/app/datasources/routes.py` คืน edges + sources + tag counts ต่อ (source, device) + cameras + pins ในคำขอเดียว (RLS ผ่าน `tenant_tx`; contract test route registration; integration test รูปร่าง JSON) แล้วให้ `useTopology` ใช้ endpoint นี้แทน fan-out
- [ ] **Step 4: Commit** `feat(topology): topology data hook` (+ `feat(api): site topology endpoint` ถ้าทำ 6b)

### Task 7: TopoCanvas, TopoNode, TopoEdge + motion

**Files:**
- Create: `web/src/features/topology/TopoCanvas.tsx`, `TopoNode.tsx`, `TopoEdge.tsx`, `web/src/features/topology/i18n.ts`

**Interfaces:**
- Consumes: `layoutTopology` (Task 4), `nodeHealth/linkState/packetPeriod` (Task 2), `zoomAt/fitView` (R3 Task 10), `DUR/SPRING` (R1)
- Produces: `TopoCanvas({ graph, health, collapsed, onToggle(id), selected, onSelect(id | null), lens: 'all' | 'problems', onDropGroup?(groupId, equipmentId) })`; `TopoNode` — การ์ด 196×48 radius 8: ไอคอนตาม kind (lucide: server, plug, tags, cog, camera, brain), label + sub (protocol/endpoint หรือ "n tags · m stale"), จุด health shape+สี (● ok ink-3, ◆ degraded warn, ▲ down crit, ○ off, ? unknown), ปุ่ม chevron พับ, ปุ่ม "+" (AddNext, Task 8) เมื่อ hover/focus; `TopoEdge` — เส้น orthogonal 1.5 px: ok ink-3 ทึบ, degraded ประ warn, broken ประ crit + "spark" (วงเล็ก scale-out 600 ms ครั้งเดียวเมื่อเปลี่ยนเป็น broken), off ประ ink-4; packet = วงกลม 4 px เดินตาม path ด้วย `offset-path` + `animation-duration: <packetPeriod>s` (M7), reduced-motion = ไม่มี packet; `lens='problems'` หรี่ node/edge ที่ health ok เหลือ 25% (M5); minimap มุมขวาล่างเมื่อ node > 40; keyboard: Tab ไล่ node ตามลำดับคอลัมน์, Enter = เลือก, Space = พับ/ขยาย, `+` = AddNext
- [ ] **Step 1: Implement**
- [ ] **Step 2: Verify** `/connect?demo=admin` org Demo: Edge 1 → 3 sources (Auto plant (sim), Batching plant (sim), Simulator) → ขยาย Batching เห็น tag group ตาม device; edge `cam-*` อยู่ใน Parked เดียว; ปิด edge-bridge (`docker stop webservice-edge-bridge-1`) แล้วภายใน 30 s เส้น Edge 1 กลายเป็นประพร้อม spark; เปิดกลับแล้วเส้นวาดคืน
- [ ] **Step 3: Commit** `feat(topology): live topology canvas`

### Task 8: Inspector + AddNext

**Files:**
- Create: `web/src/features/topology/Inspector.tsx`, `web/src/features/topology/AddNext.tsx`
- Modify: `web/src/features/datasources/SourceWizard.tsx` (แยกฟอร์มเป็น `SourceForm` ที่ใช้ได้ทั้งใน wizard เดิมและใน Drawer โดยไม่เปลี่ยนพฤติกรรม)

**Interfaces:**
- Consumes: `Drawer`, `Tabs`, `Button`, `Confirm`, `useToast` (R1), `SourceForm`, `OpcBrowser` (`features/datasources/OpcBrowser.tsx`), `applyTemplate` + `factoryioSorting` (`features/datasources/apply.ts`, `templates.ts`), `dsApi.test(org, edgeId, { protocol, connection, secrets })` (`sources:test`), `camApi.create`, `hierarchyApi.createDevice`, `formatAddress`
- Produces: `Inspector({ node, onClose })` — gateway: สถานะ (heartbeat age, clock, buffered, adapter, config applied/pending/error), ปุ่ม Rotate key / Disable (Confirm), ลิงก์ Logs; source: `SourceForm` แก้ไข + ปุ่ม **Test connection** (ผลแสดงใน drawer: ✓ latency / ✕ ข้อความ) + Enable switch + Delete (Confirm, 409 → "ยังมี tag อยู่"); tagGroup: DataTable ของ tag (path, type, unit, address readable, live value + quality) + แก้ทีละตัวด้วย sub-drawer; equipment: alarm active, ลิงก์ "เปิดใน mimic" `/live/:lineId?select=<label>`; camera: สถานะ, model ที่ pin, ลิงก์ Vision; `AddNext({ node })` เมนูตาม kind: gateway → "เพิ่ม data source", "เพิ่มกล้อง"; source → "เพิ่ม tags: Template Factory I/O / นำเข้า CSV / Browse OPC UA (เมื่อ protocol = opcua) / ทีละตัว"; site → "เพิ่ม gateway" (`/connect/add` wizard เดิม); equipment area → "เพิ่ม equipment"; เมื่อ source แรกของ gateway ได้ค่า live ครั้งแรก → M12 (เส้นวาดตัวเอง + pulse ครั้งเดียว + toast "รับสัญญาณแล้ว / Signal acquired")
- [ ] **Step 1: Implement** (ไม่เปลี่ยน logic API ของ wizard เดิม; หน้าเดิมยังใช้ได้)
- [ ] **Step 2: Verify** ทำ S4 ด้วยมือบน org ทดสอบ: Edge "+" → Simulator source → Test ✓ → "+ Template Factory I/O" → tags ขึ้นใน group → ค่า live ภายใน 10 s; จับเวลารวม ≤ 10 นาที โดยไม่ออกจาก `/connect`
- [ ] **Step 3: Commit** `feat(topology): inspector and add-next actions`

### Task 9: ลาก tag group ไปผูก equipment

**Files:**
- Create: `web/src/features/topology/model/move.ts` (+test)
- Modify: `web/src/features/topology/TopoCanvas.tsx` (drop target), `Inspector.tsx` (ทางเลือกคีย์บอร์ด: เมนู "ผูกกับ equipment…" + Combobox)

**Interfaces:**
- Consumes: `hierarchyApi.moveTags(org, site, { tag_ids, device_id })` → `{ moved: number }`
- Produces: `planMove(group: { tagIds: string[]; currentDevice: string | null }, target: { deviceId: string; label: string }): { tag_ids: string[]; device_id: string; summary: { count: number; from: string | null; to: string } } | null` (null เมื่อย้ายไปที่เดิมหรือไม่มี tag); `applyMoveResult(planned: number, res: { moved: number } | Error): { ok: boolean; failed: number; message: 'topo.moveOk' | 'topo.movePartial' | 'topo.moveFailed' }`; UI: ลาก group (pointer) แสดงเส้นผีตาม cursor, equipment ที่วางได้ไฮไลต์ accent, ปล่อย → Dialog ยืนยัน "ย้าย n tag จาก X ไป Y — alarm rule และ dashboard ใช้ path เดิม ไม่เปลี่ยน" → optimistic เส้น feeds ใหม่ → rollback เมื่อผลไม่ ok + toast
- [ ] **Step 1: Write the failing test**

```ts
test('same device is a no-op', () => expect(planMove({ tagIds: ['t1'], currentDevice: 'd1' }, { deviceId: 'd1', label: 'Belt' })).toBeNull());
test('plans the move', () =>
  expect(planMove({ tagIds: ['t1', 't2'], currentDevice: null }, { deviceId: 'd2', label: 'Belt' })).toEqual({ tag_ids: ['t1', 't2'], device_id: 'd2', summary: { count: 2, from: null, to: 'Belt' } }));
test('partial result rolls back with a count', () =>
  expect(applyMoveResult(5, { moved: 3 })).toEqual({ ok: false, failed: 2, message: 'topo.movePartial' }));
test('network error fails all', () => expect(applyMoveResult(5, new Error('x'))).toEqual({ ok: false, failed: 5, message: 'topo.moveFailed' }));
```

- [ ] **Step 2: Run** `cd web && bun test src/features/topology/model/move.test.ts` — Expected: FAIL
- [ ] **Step 3: Implement**
- [ ] **Step 4: Run test** — Expected: PASS
- [ ] **Step 5: Commit** `feat(topology): drag a tag group onto equipment`

### Task 10: TopologyPage + gateway detail tabs

**Files:**
- Create: `web/src/features/topology/TopologyPage.tsx`
- Modify: `web/src/App.tsx` (`/connect` → TopologyPage; `/connect/gateways` คงหน้า list เดิม), `web/src/features/datasources/GatewayPage.tsx`, `web/src/features/datasources/TagTable.tsx`, `web/src/features/devices/NetworkMapPage.tsx` (ลบ; `/infrastructure/map` redirect ไป `/connect` อยู่แล้วจาก R1)

**Interfaces:**
- Consumes: Tasks 1–9
- Produces: TopologyPage — header: title, ค้นหา node (กรองแล้ว fit ไปที่ผลแรก), Segmented lens (ทั้งหมด / เฉพาะปัญหา), ปุ่ม "เพิ่ม gateway", legend shape/เส้น; body: TopoCanvas เต็มพื้นที่ + Inspector drawer; URL `?select=<nodeId>&expand=<ids>` (deep link); GatewayPage ใหม่ = Tabs: Overview (health ตาม `nodeHealth`, config versions applied/pending/error, heartbeat sparkline), Sources & tags (DataTable group ตาม device, คอลัมน์: signal, type, unit, address readable (`formatAddress`), write, min/max/scale, live value + QualityMark; แถวคลิก = drawer แก้ tag พร้อม live preview; ปุ่ม "Advanced" แสดง JSON), Cameras, Logs (หน้า log เดิมของ edge), Settings (rotate/disable)
- [ ] **Step 1: Implement**
- [ ] **Step 2: Verify** `/connect/gateways/<Edge 1 id>` ไม่มี JSON ดิบในตาราง; `/connect?select=source:<id>` เปิด inspector ของ source นั้นตรง ๆ
- [ ] **Step 3: Commit** `feat(connect): topology page and tabbed gateway detail`

### Task 11: e2e S4 + screenshots

**Files:**
- Create: `tests/e2e/redesign_r4.py`

- [ ] **Step 1: Write the script** (รูปแบบ sign-in/nav จาก R0): (a) `/connect` org Demo: มี node `[data-node-kind="parked"]` = 1, ไม่มีเส้นมากกว่า `nodes × 2`; (b) คลิก node source แรก → drawer เปิด, มีปุ่ม Test connection; (c) `/connect/gateways/<edge>` ไม่มีข้อความที่ match `^\{"` ในเซลล์ address; (d) emulate reduced motion → ไม่มี element `.topo-packet`; (e) screenshot light/dark 1440/390 ลง `%TEMP%/redesign_r4/`
- [ ] **Step 2: Run** `WEB_URL=http://localhost:5199 python tests/e2e/redesign_r4.py` — Expected: exit 0; เปิดดูภาพทุกไฟล์
- [ ] **Step 3: Run detector** `C:\Users\Gigabyte\.claude\skills\impeccable\scripts\impeccable.cmd detect --json web/src/features/topology web/src/ui/DataTable.tsx`
- [ ] **Step 4: Commit** `test(e2e): R4 topology`
