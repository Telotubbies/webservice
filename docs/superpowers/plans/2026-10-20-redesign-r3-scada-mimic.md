# Console Redesign R3: SCADA Mimic from the 3D Twin Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** แยก equipment แต่ละชิ้นจาก .glb ออกมาเป็น symbol จริง (silhouette vector + feature lines), เก็บ process flow (เส้นเชื่อม + medium) ที่ผู้ใช้ยืนยัน, แล้ววาด mimic แบบ high-performance HMI พร้อม faceplate, flow editor, หน้า Live L2/L3 และ Wall ใหม่

**Architecture:** สามชั้น — (1) **extraction** ใน `scene.ts` (WebGL, offscreen) ให้ mask + feature-line raster ต่อ part; (2) **geometry/logic** pure TS ใน `web/src/features/process/model/` (contour, simplify, ports, pipes, proposals, layouts, state) ทดสอบด้วย bun:test; (3) **render** SVG ใน `web/src/features/process/` อ่าน live store. Backend เพิ่มสองตาราง (connections, layout) อ้าง part ด้วย **label**

**Tech Stack:** three 0.186 (มีอยู่), React 19, SVG, motion, IndexedDB, FastAPI + asyncpg + RLS, pytest, bun:test

**Spec:** `docs/superpowers/specs/2026-10-20-console-redesign-design.md` §8 (และ §5.3 L1–L4, §6.1 process register, §6.6 M3–M5, M13)

**Depends on:** R1 (tokens, motion, Drawer, Tabs, Button, routes `/live`, `/setup/*`), R2 Task 3 (StatTile), Task 6 (TimeSeries)

## Global Constraints

- Process register: สถานะปกติไม่มี hue — stopped `--color-hmi-equip`, running `--color-hmi-equip-run`; hue เฉพาะ alarm (`--color-crit`, `--color-warn`), stale (เส้นประ + "?"), sim (`--color-sim` เส้นประ)
- **ห้ามวาดเส้นเชื่อมที่ไม่ได้ยืนยัน** เป็นเส้นทึบ: `status:'suggested'` = เส้นประจาง 40% + ป้าย "ข้อเสนอ / Suggested" เฉพาะใน editor และใน Live เมื่อเปิด toggle "แสดงข้อเสนอ"
- Mimic ไม่เขียน PLC; การสั่งงานทั้งหมดผ่าน `useCommand` (`features/line/useCommand.ts`) จาก `CommandButton` ใน faceplate
- Connection/layout อ้าง part ด้วย `label` (unique ต่อ model); label หาย = dangling ต้องแสดงเตือน
- งบ: 300 symbol pan/zoom ≥ 55 fps บน laptop ระดับกลาง; loop animation หยุดเมื่อ `document.hidden`; reduced-motion = ไม่มี dash/rotation (ใช้ chevron นิ่ง)
- Backend: migration คู่ `.py`+`.sql` เลข `0055`, `down_revision = "0054"`; RLS `tenant_isolation` แบบ 0047; PUT ต้องผ่าน `m._v2_scope(org, site, p, m._CONFIG)` + `m._mutation_gate` + `audit.append`
- Global Constraints ของ R0–R1 และ R2 ใช้ทั้งหมด

## Review Focus

1. **ผู้ใช้เปลี่ยนชื่อ part ใน mapping editor หลังสร้าง connection แล้ว** → connection เดิมแสดงเป็น dangling (เตือน + ปุ่มผูกใหม่) ไม่หายเงียบ ไม่ทำให้ mimic พัง — test ใน Task 10 (`resolveConnections` แยก dangling) และ Task 2 (PUT ไม่ reject label ที่ไม่มีอยู่แต่ทำเครื่องหมาย — ดู Task 2 Step 1)
2. **Model CAD ที่ part มีรู/ชิ้นลอย (silo มีบันไดแยก)** → silhouette เป็น outer ring เดียวต่อ component ที่ใหญ่สุด + hole ภายใน, ชิ้นเล็ก < 2% area ถูกทิ้ง — test ใน Task 4
3. **Flow graph มี cycle (recirculation)** → flow layout ไม่วนไม่สิ้นสุด, ทุก node ได้ตำแหน่ง — test ใน Task 9
4. **Tag ของ equipment stale แต่ run flag ค้างเป็น true** → symbol แสดง stale ไม่ใช่ running — test ใน Task 11
5. **WebGL ใช้ไม่ได้ (เครื่องไม่มี GPU, context lost)** → mimic ใช้ fallback ISA symbol ทั้งหมด ไม่ค้าง loading — test ใน Task 7 (`symbolFor` คืน fallback เมื่อ extract error) + ตรวจด้วยมือ (Chrome `--disable-gpu`)

---

## File Structure

```text
backend/migrations/versions/0055_plant_flow.py / .sql   ใหม่ plant_connections, plant_layouts + RLS
backend/app/plant/flow.py                               ใหม่ router GET/PUT connections + hmi-layout, validate_connections
backend/app/main.py                                     แก้ include_router(flow_router)
tests/contract/test_plant_flow.py                       ใหม่ route registration + validate_connections
tests/integration/test_plant_models.py                  แก้ PUT/GET round-trip
tests/tenancy/test_plant_flow_rls.py                    ใหม่ RLS
web/src/lib/plantModel.ts                               แก้ types + plantApi.connections/putConnections/layout/putLayout
web/src/features/line3d/scene.ts                        แก้ renderPartMask, renderPartLines
web/src/features/process/model/contour.ts (+test)       traceRings, simplify, ringsToPath
web/src/features/process/model/ports.ts (+test)         suggestPorts
web/src/features/process/model/pipes.ts (+test)         pipePolyline
web/src/features/process/model/proposals.ts (+test)     proposeConnections, resolveConnections
web/src/features/process/model/layout.ts (+test)        elevationLayout, flowLayout, routeOrthogonal
web/src/features/process/model/state.ts (+test)         equipmentState
web/src/features/process/model/view.ts (+test)          zoomAt, fitView, lodOf
web/src/features/process/model/nav.ts (+test)           nextAlong
web/src/features/process/model/virtual.ts (+test)       virtualParts
web/src/features/process/model/history.ts (+test)       editor undo/redo reducer
web/src/features/process/model/replay.ts (+test)        valueAt
web/src/features/process/symbols/cache.ts (+test)       symbolKey, getSymbol/putSymbol (IndexedDB)
web/src/features/process/symbols/isa.tsx                fallback ISA shapes + fallbackShape (+ isa.test.ts)
web/src/features/process/symbols/useSymbols.ts          extract → cache → fallback
web/src/features/process/ProcessCanvas.tsx              pan/zoom SVG host + plies
web/src/features/process/EquipmentSymbol.tsx
web/src/features/process/ProcessLine.tsx
web/src/features/process/ValueTag.tsx
web/src/features/process/AlarmMarker.tsx
web/src/features/process/ModeBadge.tsx
web/src/features/process/Faceplate.tsx                  compound + CommandButton
web/src/features/process/LivePage.tsx                   /live, /live/:lineId
web/src/features/process/EquipmentPage.tsx              /live/:lineId/eq/:label
web/src/features/process/FlowEditor.tsx                 /setup/flow
web/src/features/process/i18n.ts
web/src/features/devui/SymbolsPage.tsx                  /dev/symbols (DEV only)
web/src/features/wall/WallPage.tsx                      แก้ ใช้ ProcessCanvas
tests/e2e/redesign_r3.py
```

---

### Task 1: Migration 0055 — plant_connections + plant_layouts

**Files:**
- Create: `backend/migrations/versions/0055_plant_flow.py`, `backend/migrations/versions/0055_plant_flow.sql`, `tests/tenancy/test_plant_flow_rls.py`

**Interfaces:**
- Produces (SQL):
```sql
CREATE TABLE plant_connections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL, model_id uuid NOT NULL,
  from_label text NOT NULL CHECK (length(from_label) BETWEEN 1 AND 120),
  from_port text NOT NULL DEFAULT 'out' CHECK (from_port ~ '^[a-z0-9_]{1,24}$'),
  to_label text NOT NULL CHECK (length(to_label) BETWEEN 1 AND 120),
  to_port text NOT NULL DEFAULT 'in' CHECK (to_port ~ '^[a-z0-9_]{1,24}$'),
  medium text NOT NULL CHECK (medium IN ('aggregate','sand','cement','water','admixture','air','concrete','signal')),
  flow_tag text NULL,
  waypoints jsonb NOT NULL DEFAULT '[]' CHECK (pg_column_size(waypoints) <= 4096),
  status text NOT NULL DEFAULT 'confirmed' CHECK (status IN ('suggested','confirmed')),
  sort integer NOT NULL DEFAULT 0,
  CHECK (from_label <> to_label),
  UNIQUE (org_id, id),
  FOREIGN KEY (org_id, model_id) REFERENCES plant_models (org_id, id) ON DELETE CASCADE
);
CREATE INDEX plant_connections_model ON plant_connections (org_id, model_id, sort);
CREATE TABLE plant_layouts (
  org_id uuid NOT NULL, model_id uuid NOT NULL,
  doc jsonb NOT NULL CHECK (pg_column_size(doc) <= 65536),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, model_id),
  FOREIGN KEY (org_id, model_id) REFERENCES plant_models (org_id, id) ON DELETE CASCADE
);
```
  + DO-block RLS/GRANT แบบเดียวกับ `0047_plant_models.sql:46-56` สำหรับทั้งสองตาราง
- [ ] **Step 1: Write the failing test** (`tests/tenancy/test_plant_flow_rls.py`, marker `db`, รูปแบบเดียวกับ test ใน `tests/tenancy`): org A insert connection ของ model ตัวเอง → org B `SELECT count(*)` = 0 และ `INSERT` ด้วย org_id ของ A ถูกปฏิเสธ
- [ ] **Step 2: Run** `make up-test && cd tests && python -m pytest tenancy/test_plant_flow_rls.py -m db -v` — Expected: FAIL (relation does not exist)
- [ ] **Step 3: Implement** migration (`.py` แบบ `0054_web_push.py`; downgrade `DROP TABLE plant_layouts; DROP TABLE plant_connections;`) แล้ว `make migrate`
- [ ] **Step 4: Run test** — Expected: PASS
- [ ] **Step 5: Commit** `feat(plant): connections and HMI layout tables (0055)`

### Task 2: Flow API

**Files:**
- Create: `backend/app/plant/flow.py`, `tests/contract/test_plant_flow.py`
- Modify: `backend/app/main.py:78-81,1719-1720` (import + `app.include_router(flow_router)`), `tests/integration/test_plant_models.py`

**Interfaces:**
- Produces (HTTP):
  - `GET /api/v1/orgs/{org}/sites/{site}/plant-models/{model}/connections` → `{"connections": [ConnOut]}` (`ConnOut` = id, from_label, from_port, to_label, to_port, medium, flow_tag, waypoints, status, dangling: bool)
  - `PUT …/connections` body `{"connections": [ConnIn]}` (≤ 500) → replace-all, คืนแบบ GET
  - `GET …/hmi-layout` → `{"layout": doc | null}`; `PUT …/hmi-layout` body `{"layout": {version: 1, mode: 'flow'|'elevation', nodes: {label: {x, y, scale?, flip?}}, groups?: [...]}}`
  - audit actions: `plant_model.flow_saved`, `plant_model.layout_saved`
- Produces (Python): `validate_connections(conns: list[ConnIn], labels: set[str], tag_paths: set[str]) -> list[str]` คืน error messages; กฎ: medium อยู่ใน enum, from≠to, ไม่มีคู่ (from,from_port,to,to_port) ซ้ำ, `flow_tag` ต้องเป็น path ที่มีอยู่, waypoint ≤ 32 จุดค่าจำกัด ±1e5 — **label ที่ไม่มีใน model ไม่ใช่ error** (เก็บได้ แสดง `dangling: true`) เพื่อให้ rename part ไม่ทำ flow หาย
- [ ] **Step 1: Write the failing test** (`tests/contract/test_plant_flow.py`)

```python
from app.plant import flow

def test_routes_registered():
    paths = {(m, r.path) for r in flow.router.routes for m in r.methods}
    base = "/api/v1/orgs/{org}/sites/{site}/plant-models/{model}"
    for m in ("GET", "PUT"):
        assert (m, f"{base}/connections") in paths
        assert (m, f"{base}/hmi-layout") in paths

def test_self_loop_and_bad_medium_rejected():
    c = flow.ConnIn(from_label="A", to_label="A", medium="lava")
    errs = flow.validate_connections([c], {"A"}, set())
    assert any("self" in e for e in errs) and any("medium" in e for e in errs)

def test_unknown_label_is_allowed_as_dangling():
    c = flow.ConnIn(from_label="Gone", to_label="B", medium="cement")
    assert flow.validate_connections([c], {"B"}, set()) == []

def test_unknown_flow_tag_rejected():
    c = flow.ConnIn(from_label="A", to_label="B", medium="water", flow_tag="liq/x/flow")
    assert flow.validate_connections([c], {"A", "B"}, set()) != []
```

- [ ] **Step 2: Run** `cd tests && python -m pytest contract/test_plant_flow.py -v` — Expected: FAIL
- [ ] **Step 3: Implement** `flow.py` (pydantic `ConnIn`, `LayoutIn` with `Literal['flow','elevation']`; GET ใช้ `m._v2_scope(org, site, p)` (อ่านได้ทุก role), PUT ใช้ `m._CONFIG` + `_mutation_gate` + ลบแล้ว insert ใน `tenant_tx` เดียว + audit) แล้วเพิ่ม integration test: PUT 2 connections → GET คืน 2 พร้อม `dangling` ถูกต้อง; PUT layout → GET เท่ากัน; viewer PUT = 403
- [ ] **Step 4: Run tests** `python -m pytest contract/test_plant_flow.py -v` (PASS) และ `make up-test && python -m pytest integration/test_plant_models.py -v -k flow` (PASS)
- [ ] **Step 5: Commit** `feat(plant): flow and HMI layout API`

### Task 3: Client API + types

**Files:**
- Modify: `web/src/lib/plantModel.ts`

**Interfaces:**
- Produces: `type Medium = 'aggregate' | 'sand' | 'cement' | 'water' | 'admixture' | 'air' | 'concrete' | 'signal'`; `interface PlantConnection { id?: string; from_label: string; from_port: string; to_label: string; to_port: string; medium: Medium; flow_tag?: string | null; waypoints?: [number, number][]; status: 'suggested' | 'confirmed'; dangling?: boolean }`; `interface HmiLayoutDoc { version: 1; mode: 'flow' | 'elevation'; nodes: Record<string, { x: number; y: number; scale?: number; flip?: boolean }>; groups?: { label: string; x: number; y: number; w: number; h: number }[] }`; `plantApi.connections(modelId): Promise<PlantConnection[]>`, `plantApi.putConnections(modelId, conns): Promise<PlantConnection[]>`, `plantApi.layout(modelId): Promise<HmiLayoutDoc | null>`, `plantApi.putLayout(modelId, doc): Promise<HmiLayoutDoc>`
- [ ] **Step 1: Implement** ตามรูปแบบ `putParts`
- [ ] **Step 2: Verify** `cd web && bun run build`
- [ ] **Step 3: Commit** `feat(web): plant flow client`

### Task 4: Contour tracing + simplify

**Files:**
- Create: `web/src/features/process/model/contour.ts`, `web/src/features/process/model/contour.test.ts`

**Interfaces:**
- Produces: `type Ring = [number, number][]`; `traceRings(mask: Uint8Array, w: number, h: number, opts?: { threshold?: number; minAreaFrac?: number }): { outer: Ring; holes: Ring[] }[]` (marching squares บน alpha; ring ตามเข็มนาฬิกา; component ที่พื้นที่ < `minAreaFrac` (ค่าเริ่ม 0.02) ของ component ใหญ่สุดถูกทิ้ง); `simplify(r: Ring, eps: number): Ring` (Ramer–Douglas–Peucker, ปิด ring); `ringsToPath(shapes, w, h): string` (พิกัด normalized 0..1, `fill-rule="evenodd"`)
- [ ] **Step 1: Write the failing test**

```ts
const maskOf = (w: number, h: number, on: (x: number, y: number) => boolean) => {
  const m = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) m[y * w + x] = on(x, y) ? 255 : 0;
  return m;
};
test('a square traces to 4 corners after simplify', () => {
  const s = traceRings(maskOf(20, 20, (x, y) => x >= 5 && x < 15 && y >= 5 && y < 15), 20, 20);
  expect(s).toHaveLength(1);
  expect(simplify(s[0].outer, 0.5)).toHaveLength(4);
});
test('a ring keeps its hole', () => {
  const s = traceRings(maskOf(30, 30, (x, y) => { const d = Math.hypot(x - 15, y - 15); return d < 12 && d > 6; }), 30, 30);
  expect(s[0].holes.length).toBe(1);
});
test('specks are dropped', () => {
  const s = traceRings(maskOf(40, 40, (x, y) => (x >= 2 && x < 30 && y >= 2 && y < 30) || (x === 36 && y === 36)), 40, 40);
  expect(s).toHaveLength(1);
});
test('path is normalized', () => {
  const s = traceRings(maskOf(10, 10, () => true), 10, 10);
  expect(ringsToPath(s, 10, 10)).toMatch(/^M0(\.0+)? 0(\.0+)?/);
});
```

- [ ] **Step 2: Run** `cd web && bun test src/features/process/model/contour.test.ts` — Expected: FAIL
- [ ] **Step 3: Implement**
- [ ] **Step 4: Run test** — Expected: PASS
- [ ] **Step 5: Commit** `feat(process): silhouette tracing and simplification`

### Task 5: Ports + pipe polylines

**Files:**
- Create: `web/src/features/process/model/ports.ts` (+test), `web/src/features/process/model/pipes.ts` (+test)

**Interfaces:**
- Produces: `type Port = { id: string; x: number; y: number; dir: 'up' | 'down' | 'left' | 'right' }` (normalized 0..1 ของ symbol box); `suggestPorts(kind: string, outer: Ring, w: number, h: number): Port[]` — vessel: `in` = กลางขอบบน, `out` = จุดต่ำสุดของ silhouette; conveyor: `tail` = ปลายซ้าย, `head` = ปลายขวา (แกนยาว), `in` = บนใกล้ tail; mixer: `in` บน, `out` ล่าง; pump/motor/valve: `in` ซ้าย, `out` ขวา; อื่น ๆ: 4 ด้าน; `pipePolyline(segs: [[number, number, number], [number, number, number]][], view: 'front' | 'top'): [number, number][]` — ฉายลง 2D (front: x,y; top: x,z), ต่อ segment ที่ปลายห่าง < 0.05, บังคับเป็นแนวตั้ง/นอน (snap มุม < 20° เป็นแกน), รวมจุดที่อยู่แนวเดียวกัน
- [ ] **Step 1: Write the failing test**

```ts
test('vessel outlet is the lowest silhouette point', () => {
  const cone: Ring = [[0, 0], [10, 0], [10, 6], [5, 10], [0, 6]];
  const out = suggestPorts('vessel', cone, 10, 10).find((p) => p.id === 'out')!;
  expect([out.x, out.y, out.dir]).toEqual([0.5, 1, 'down']);
});
test('conveyor has head and tail', () =>
  expect(suggestPorts('conveyor', [[0, 0], [40, 0], [40, 4], [0, 4]], 40, 4).map((p) => p.id).sort()).toEqual(['head', 'in', 'tail']));
test('pipe runs become orthogonal', () =>
  expect(pipePolyline([[[0, 0, 0], [5, 0.2, 0]], [[5, 0.2, 0], [5, 5, 0]]], 'front')).toEqual([[0, 0], [5, 0], [5, 5]]));
```

- [ ] **Step 2: Run** `cd web && bun test src/features/process/model/ports.test.ts src/features/process/model/pipes.test.ts` — Expected: FAIL
- [ ] **Step 3: Implement**
- [ ] **Step 4: Run tests** — Expected: PASS
- [ ] **Step 5: Commit** `feat(process): port suggestions and pipe polylines`

### Task 6: Extraction ใน scene.ts + หน้าตรวจ `/dev/symbols`

**Files:**
- Modify: `web/src/features/line3d/scene.ts` (เพิ่มใน `LineSceneView` และ object `view` ข้าง `plan()` ที่ `:755-810`)
- Create: `web/src/features/devui/SymbolsPage.tsx`; Modify: `web/src/App.tsx` (DEV route `dev/symbols`)

**Interfaces:**
- Produces: `renderPartMask(partKey: string, view: 'front' | 'top', longSidePx = 512): { mask: Uint8Array; w: number; h: number; min: [number, number]; max: [number, number] } | null` — ซ่อนทุก part อื่น/floor/grid/overlay, ortho camera ครอบ `bb` ของ part (+3% pad), `overrideMaterial` = MeshBasicMaterial ขาว, อ่าน alpha จาก render target ที่ clear โปร่ง; คืน null เมื่อ bb ว่างหรือด้านสั้น < 4 px; `renderPartLines(partKey: string, view, longSidePx = 512): string | null` — สร้าง `EdgesGeometry(geom, 35)` ต่อ mesh ของ part, วาดเส้นดำบนพื้นโปร่งโดยใช้ depth ของ mesh เดียวกัน (pass แรก depth-only, pass สอง lines ด้วย `depthFunc LessEqual` + `polygonOffset`) → `canvas.toDataURL('image/png')` ขนาด 2× ของ mask; คืนสถานะเดิมของ scene ทุกครั้ง (visibility, background, overrideMaterial) แม้ throw (`try/finally`)
- [ ] **Step 1: Implement** ทั้งสองเมธอด
- [ ] **Step 2: Build the dev page**: โหลด demo model ผ่าน `useSceneSource`, สำหรับทุก part แสดงสามช่องเรียงกัน: (a) path จาก `traceRings → simplify(ε 1.2) → ringsToPath` เติม `--color-hmi-equip` (b) feature lines ใส่เป็น `mask-image` เติม `--color-hmi-edge` (c) ทั้งสองซ้อนกัน; แสดงเวลา extract ต่อ part และรวม
- [ ] **Step 3: Verify** เปิด `http://localhost:5199/dev/symbols?demo=admin` — ไซโล 4 ตัว, aggregate bin 4 ตัว, mixer, skip hoist มองออกว่าเป็นของจริง; บันทึกเวลารวม (< 3 s บนเครื่อง dev) ลงใน commit message; ปรับ ε/threshold ถ้าจำเป็นและจดค่าใหม่ใน spec §16
- [ ] **Step 4: Commit** `feat(twin): per-part silhouette and feature-line extraction`

### Task 7: Symbol cache + fallback ISA shapes + useSymbols

**Files:**
- Create: `web/src/features/process/symbols/cache.ts` (+test), `web/src/features/process/symbols/isa.tsx`, `web/src/features/process/symbols/isa.test.ts`, `web/src/features/process/symbols/useSymbols.ts`

**Interfaces:**
- Produces: `SYMBOL_VERSION = 1`; `symbolKey(sha: string, nodes: number[], view: 'front' | 'top'): string` (nodes เรียงก่อน hash; FNV-1a 32-bit hex); `type PartSymbol = { kind: 'extracted'; path: string; lines: string | null; ports: Port[]; aspect: number } | { kind: 'fallback'; shape: FallbackShape; ports: Port[]; aspect: number }`; `getSymbol(key): Promise<PartSymbol | null>`, `putSymbol(key, s): Promise<void>` (IndexedDB db `wds-symbols` store `v1`; ถ้า IndexedDB ใช้ไม่ได้ใช้ Map ในหน่วยความจำ); `type FallbackShape = 'silo' | 'hopper' | 'tank' | 'bin' | 'belt' | 'motor' | 'pump' | 'mixer' | 'valve' | 'filter' | 'skip' | 'generic'`; `fallbackShape(kind: string, aspect: number, label: string): FallbackShape` (vessel: aspect h/w > 2 → silo, label มี "tank"/"ถัง" → tank, "bin"/"ช่อง" → bin, อื่น → hopper; indicator + label "filter" → filter; slider → skip); `IsaShape({ shape, w, h })` SVG; `useSymbols(src: SceneSource, view): { symbols: Map<string, PartSymbol>; ready: boolean }` — แสดง fallback ทันที แล้วแทนด้วย extracted เมื่อได้ (crossfade M10); error ใด ๆ ของ WebGL → fallback ทั้งหมด
- [ ] **Step 1: Write the failing test**

```ts
test('key ignores node order', () => expect(symbolKey('ab', [3, 1, 2], 'front')).toBe(symbolKey('ab', [1, 2, 3], 'front')));
test('key changes with view', () => expect(symbolKey('ab', [1], 'front')).not.toBe(symbolKey('ab', [1], 'top')));
test('tall vessel is a silo', () => expect(fallbackShape('vessel', 3.2, 'Cement silo 1')).toBe('silo'));
test('named tank', () => expect(fallbackShape('vessel', 1.1, 'Liquid tank 2')).toBe('tank'));
test('aggregate bin', () => expect(fallbackShape('vessel', 0.9, 'Aggregate bin 3')).toBe('bin'));
test('unknown kind is generic', () => expect(fallbackShape('robot', 1, 'x')).toBe('generic'));
```

- [ ] **Step 2: Run** `cd web && bun test src/features/process/symbols` — Expected: FAIL
- [ ] **Step 3: Implement**
- [ ] **Step 4: Run tests** — Expected: PASS; ใน `/dev/symbols` เพิ่มคอลัมน์ fallback; เปิด Chrome ด้วย `--disable-gpu --disable-software-rasterizer` แล้ว `/dev/symbols` แสดง fallback ทั้งหมดไม่ค้าง
- [ ] **Step 5: Commit** `feat(process): symbol cache and ISA fallbacks`

### Task 8: Connection proposals + resolution

**Files:**
- Create: `web/src/features/process/model/proposals.ts` (+test)

**Interfaces:**
- Consumes: `PartBox` (`scene.ts:47`), `Port` (Task 5), `PlantConnection` (Task 3)
- Produces: `proposeConnections(parts: PlantPart[], boxes: PartBox[], existing: PlantConnection[]): (PlantConnection & { confidence: 'high' | 'med' })[]` — (a) vessel เหนือ conveyor (เงื่อนไขเดียวกับ `hmiLayout.ts:104-118`) → `aggregate` หรือ `cement` ตาม label/kind, high; (b) conveyor ที่ปลายด้านหนึ่งอยู่ภายใน 0.6 หน่วยจาก bbox ของ part อื่น → med; (c) pipe part ที่ bbox สัมผัส (pad 0.3) ≥ 2 part → เชื่อมเป็นลูกโซ่ตามแกน x, medium จาก `params.color`; ไม่เสนอคู่ที่มีอยู่แล้วใน `existing` (ไม่ว่าสถานะใด); `status: 'suggested'` เสมอ; `resolveConnections(conns: PlantConnection[], labels: Set<string>): { live: PlantConnection[]; dangling: PlantConnection[] }`
- [ ] **Step 1: Write the failing test**

```ts
const part = (label: string, kind: string, params = {}): PlantPart => ({ label, kind, nodes: [1], bindings: {}, params });
const box = (key: string, x0: number, x1: number, y0: number, y1: number): PartBox => ({ key, min: [x0, y0, -1], max: [x1, y1, 1] });
test('bin over belt is proposed once', () => {
  const p = proposeConnections([part('Aggregate bin 1', 'vessel'), part('Belt', 'conveyor')], [box('0', 0, 2, 3, 6), box('1', -1, 10, 0, 1)], []);
  expect(p.map((c) => [c.from_label, c.to_label, c.medium, c.status])).toEqual([['Aggregate bin 1', 'Belt', 'aggregate', 'suggested']]);
});
test('confirmed pairs are not re-proposed', () => {
  const ex: PlantConnection[] = [{ from_label: 'Aggregate bin 1', from_port: 'out', to_label: 'Belt', to_port: 'in', medium: 'aggregate', status: 'confirmed' }];
  expect(proposeConnections([part('Aggregate bin 1', 'vessel'), part('Belt', 'conveyor')], [box('0', 0, 2, 3, 6), box('1', -1, 10, 0, 1)], ex)).toHaveLength(0);
});
test('renamed part makes its connection dangling', () => {
  const r = resolveConnections([{ from_label: 'Old', from_port: 'out', to_label: 'Belt', to_port: 'in', medium: 'sand', status: 'confirmed' }], new Set(['Belt']));
  expect(r.dangling).toHaveLength(1);
  expect(r.live).toHaveLength(0);
});
```

- [ ] **Step 2: Run** `cd web && bun test src/features/process/model/proposals.test.ts` — Expected: FAIL
- [ ] **Step 3: Implement**
- [ ] **Step 4: Run test** — Expected: PASS
- [ ] **Step 5: Commit** `feat(process): connection proposals from geometry`

### Task 9: Layouts (elevation + flow) + orthogonal routing

**Files:**
- Create: `web/src/features/process/model/layout.ts` (+test)

**Interfaces:**
- Produces: `type Placed = { label: string; x: number; y: number; w: number; h: number }`; `elevationLayout(parts: PlantPart[], boxes: PartBox[], symbols: Map<string, { aspect: number }>, size: { w: number; h: number }): Placed[]` (front-view x/y จริงสเกลลง, กันซ้อนด้วยการดันแนวนอนขั้นต่ำ 16 หน่วย); `flowLayout(labels: string[], conns: PlantConnection[], seedX: Map<string, number>, sizes: Map<string, { w: number; h: number }>): Placed[]` — longest-path layering บนกราฟที่ตัด back-edge ด้วย DFS, ลำดับในชั้นด้วย barycenter 4 รอบ seed จาก `seedX`, ระยะชั้น 220, ระยะในชั้น 40; node โดดเดี่ยวเรียงชั้นสุดท้าย; `routeOrthogonal(a: { x: number; y: number; dir }, b: { x: number; y: number; dir }, obstacles: Placed[]): [number, number][]` (เส้นตั้ง/นอน ≤ 4 ข้อ, เลี่ยง box ด้วย channel กลางระหว่างชั้น)
- [ ] **Step 1: Write the failing test**

```ts
const sizes = new Map(['A', 'B', 'C'].map((l) => [l, { w: 60, h: 60 }]));
const c = (f: string, t: string): PlantConnection => ({ from_label: f, from_port: 'out', to_label: t, to_port: 'in', medium: 'cement', status: 'confirmed' });
test('sources sit left of sinks', () => {
  const p = flowLayout(['A', 'B', 'C'], [c('A', 'B'), c('B', 'C')], new Map(), sizes);
  const x = (l: string) => p.find((q) => q.label === l)!.x;
  expect(x('A')).toBeLessThan(x('B'));
  expect(x('B')).toBeLessThan(x('C'));
});
test('cycles terminate and place everyone', () =>
  expect(flowLayout(['A', 'B'], [c('A', 'B'), c('B', 'A')], new Map(), sizes)).toHaveLength(2));
test('no overlaps in a layer', () => {
  const p = flowLayout(['A', 'B', 'C'], [c('A', 'B'), c('A', 'C')], new Map(), sizes);
  const [b, cc] = ['B', 'C'].map((l) => p.find((q) => q.label === l)!);
  expect(Math.abs(b.y - cc.y)).toBeGreaterThanOrEqual(60);
});
test('routes are orthogonal', () => {
  const r = routeOrthogonal({ x: 0, y: 0, dir: 'right' }, { x: 100, y: 50, dir: 'left' }, []);
  for (let i = 1; i < r.length; i++) expect(r[i][0] === r[i - 1][0] || r[i][1] === r[i - 1][1]).toBe(true);
});
```

- [ ] **Step 2: Run** `cd web && bun test src/features/process/model/layout.test.ts` — Expected: FAIL
- [ ] **Step 3: Implement**
- [ ] **Step 4: Run test** — Expected: PASS
- [ ] **Step 5: Commit** `feat(process): elevation and flow layouts`

### Task 10: View math + keyboard navigation + virtual parts

**Files:**
- Create: `web/src/features/process/model/view.ts` (+test), `web/src/features/process/model/nav.ts` (+test), `web/src/features/process/model/virtual.ts` (+test)

**Interfaces:**
- Produces: `type View = { x: number; y: number; k: number }`; `zoomAt(v: View, factor: number, p: { x: number; y: number }, kMin = 0.25, kMax = 4): View` (จุดใต้ cursor คงที่); `fitView(bounds: { x: number; y: number; w: number; h: number }, size: { w: number; h: number }, pad = 24): View`; `lodOf(k: number): 'full' | 'markers'` (k < 0.6 = markers); `nextAlong(conns: PlantConnection[], from: string, dir: 'downstream' | 'upstream', placed: Placed[]): string | null` (หลายทาง = ตัวบนสุด); `virtualParts(devices: { id: string; name: string; kind: string | null }[], tagPathsByDevice: Map<string, string[]>): PlantPart[]` (part ต่อ device; kind จาก `devices.kind` map เข้า kinds ของ plant (`conveyor`, `motor`, `vessel`, `indicator`), bindings เดาจาก suffix ของ path: `running→run`, `speed*→speed`, `level*→level`, `temp*→temp`; `nodes: []`)
- [ ] **Step 1: Write the failing test**

```ts
test('zoom keeps the cursor point fixed', () =>
  // screen = world * k + offset; world (100, 50) under the cursor stays at screen (100, 50)
  expect(zoomAt({ x: 0, y: 0, k: 1 }, 2, { x: 100, y: 50 })).toEqual({ x: -100, y: -50, k: 2 }));
test('fit centres the content', () => expect(fitView({ x: 0, y: 0, w: 100, h: 100 }, { w: 248, h: 148 }, 24).k).toBe(1));
test('far zoom shows markers only', () => expect(lodOf(0.5)).toBe('markers'));
test('arrow follows the flow', () => {
  const conns = [{ from_label: 'A', from_port: 'out', to_label: 'B', to_port: 'in', medium: 'sand', status: 'confirmed' }] as PlantConnection[];
  expect(nextAlong(conns, 'A', 'downstream', [])).toBe('B');
  expect(nextAlong(conns, 'B', 'upstream', [])).toBe('A');
});
test('sorting line devices become parts', () => {
  const p = virtualParts([{ id: 'd1', name: 'Conveyor', kind: 'conveyor' }], new Map([['d1', ['line1/conveyor/running', 'line1/conveyor/speed_mps']]]));
  expect(p[0]).toMatchObject({ label: 'Conveyor', kind: 'conveyor', bindings: { run: 'line1/conveyor/running', speed: 'line1/conveyor/speed_mps' } });
});
```
- [ ] **Step 2: Run** `cd web && bun test src/features/process/model/view.test.ts src/features/process/model/nav.test.ts src/features/process/model/virtual.test.ts` — Expected: FAIL
- [ ] **Step 3: Implement**
- [ ] **Step 4: Run tests** — Expected: PASS
- [ ] **Step 5: Commit** `feat(process): view math, flow navigation, virtual parts`

### Task 11: Equipment state derivation

**Files:**
- Create: `web/src/features/process/model/state.ts` (+test)

**Interfaces:**
- Consumes: `liveName`, `truthy` (`lib/plantModel.ts`), `STALE_MS` (`lib/live.ts`), `normSeverity`
- Produces: `type EqState = 'running' | 'stopped' | 'starting' | 'stopping' | 'fault' | 'oos' | 'stale' | 'unmapped'`; `equipmentState(part: PlantPart, read: (path: string) => { v: number | boolean; ts: string; q?: string } | undefined, alarms: Pick<Alarm, 'tag' | 'severity' | 'state' | 'shelved_until'>[], pending: Set<string>, now: number, prefix: string): { state: EqState; priority: 'critical' | 'warning' | null; unacked: boolean }` — ลำดับ: ไม่มี binding = unmapped; มี alarm active (ไม่ shelved) ของ tag ใน bindings = fault + priority สูงสุด (alarm ชนะ stale เสมอ); run flag stale (อายุ > STALE_MS หรือ q bad/stale) = stale; `params.oos === true` = oos; command pending บน run tag = starting/stopping ตามค่าเป้าหมาย; run truthy = running; อื่น = stopped
- [ ] **Step 1: Write the failing test**

```ts
const now = Date.parse('2026-10-20T12:00:00Z');
const belt: PlantPart = { label: 'Belt', kind: 'conveyor', nodes: [1], bindings: { run: 'agg/belt1/running' } };
const at = (v: boolean, ageMs: number) => () => ({ v, ts: new Date(now - ageMs).toISOString() });
test('stale run flag is stale, not running', () =>
  expect(equipmentState(belt, at(true, 60_000), [], new Set(), now, 'plant1').state).toBe('stale'));
test('fresh run flag runs', () => expect(equipmentState(belt, at(true, 1000), [], new Set(), now, 'plant1').state).toBe('running'));
test('active alarm on a bound tag is fault', () =>
  expect(equipmentState(belt, at(true, 1000), [{ tag: 'plant1.agg.belt1.running', severity: 'critical', state: 'active' }], new Set(), now, 'plant1'))
    .toMatchObject({ state: 'fault', priority: 'critical', unacked: true }));
test('no bindings is unmapped', () =>
  expect(equipmentState({ ...belt, bindings: {} }, () => undefined, [], new Set(), now, 'plant1').state).toBe('unmapped'));
```

(alarm tag ใน live store เป็นชื่อ dotted `<prefix>.<path with dots>`; ผู้เรียกส่ง `sitePrefix()` เป็น `prefix` เพื่อให้ function ไม่พึ่ง global)

- [ ] **Step 2: Run** `cd web && bun test src/features/process/model/state.test.ts` — Expected: FAIL
- [ ] **Step 3: Implement**
- [ ] **Step 4: Run test** — Expected: PASS
- [ ] **Step 5: Commit** `feat(process): equipment state derivation`

### Task 12: Renderer primitives

**Files:**
- Create: `web/src/features/process/ProcessCanvas.tsx`, `EquipmentSymbol.tsx`, `ProcessLine.tsx`, `ValueTag.tsx`, `AlarmMarker.tsx`, `ModeBadge.tsx`, `web/src/features/process/i18n.ts`, `web/src/features/process/process.css`

**Interfaces:**
- Consumes: Task 7 (`PartSymbol`, `IsaShape`), Task 10 (`View`, `zoomAt`, `fitView`, `lodOf`), Task 11 (`EqState`), R1 `DUR`
- Produces:
  - `ProcessCanvas({ bounds, children, toolbar?, onBackgroundClick? })` — SVG เต็มพื้นที่, wheel zoom (ctrl/pinch), drag pan, ปุ่ม +/−/fit, คีย์ `+ - 0`; ส่ง `View` ผ่าน context `useProcessView()`; ply groups: `<g data-ply="lines">`, `"symbols"`, `"tags"`, `"markers"`, `"selection"`
  - `EquipmentSymbol({ label, symbol, x, y, w, h, state, level?, selected, dimmed, onSelect })` — extracted: `<path d>` เติมตาม state + feature-lines ผ่าน `<mask>` image เติม `--color-hmi-edge`; level fill = `<clipPath>` จาก path เดียวกัน (one geometry); stopped/running/starting/stopping/oos/stale/unmapped/sim ตาม spec §8.4; `starting`/`stopping` outline pulse `DUR.process`; running conveyor/mixer/pump ใส่ class `pc-run` ที่หมุน/วิ่งด้วย CSS var `--pc-speed`; dimmed = opacity 0.45 (M5)
  - `ProcessLine({ points, medium, flowing, rate01, suggested, dangling })` — เส้น 4 px สี `--color-medium-*`, flowing = dash overlay วิ่ง `animation-duration: calc(1.6s / max(var(--rate), .15))`; suggested = ประจาง; dangling = ประ + ไอคอน ⚠ ที่ปลาย
  - `ValueTag({ isa, value, unit, quality, limits?, x, y })` — กล่อง ISA letter + ค่า mono; M1 ผ่าน `beyondDeadband`; stale = "———" จาง
  - `ModeBadge({ mode: 'auto' | 'manual' | 'local' | 'oos' | 'sim' })` — ป้ายเล็กมุมขวาบนของ symbol/faceplate: AUTO ไม่แสดงบน mimic (ค่าปกติ), MAN/LOCAL ink บนพื้น `--color-panel-2`, OOS hatch, SIM `--color-sim` เส้นประ; ข้อความ TH/EN
  - `AlarmMarker({ priority, unacked, x, y })` — ▲ crit 18 px / ◆ warn 14 px / ● info 10 px (size ramp), unacked = blink 1 Hz (ยกเว้น reduced-motion)
  - `process.css`: keyframes `pc-dash`, `pc-spin`, `pc-blink` + `@media (prefers-reduced-motion: reduce)` ปิดทั้งหมด + `:root[data-hidden] .pc-*{animation-play-state:paused}` (ตั้ง `data-hidden` จาก `visibilitychange` ใน ProcessCanvas)
- [ ] **Step 1: Implement**
- [ ] **Step 2: Verify** เพิ่มส่วน "Process" ใน `/dev/ui`: symbol ทุก state × light/dark, line ทุก medium flowing/idle/suggested/dangling, value tag ok/stale/limit, marker ทุก priority; ตรวจ reduced-motion ด้วย DevTools Rendering emulation
- [ ] **Step 3: Commit** `feat(process): HMI renderer primitives`

### Task 13: Faceplate + CommandButton

**Files:**
- Create: `web/src/features/process/Faceplate.tsx`, `web/src/features/process/model/command.ts` (+test)

**Interfaces:**
- Consumes: `useCommand()` → `{ send(tag, value), tracked, error, busy }` (`features/line/useCommand.ts`), `useControlGate()` (`app/session.ts`), `Drawer`, `Tabs`, `Button` (R1), `TimeSeries` (R2), `Confirm` (`shared/ui/Confirm.tsx`)
- Produces: `commandPhase(tracked: { status: string } | null, error: string | null): 'idle' | 'pending' | 'done' | 'failed'` (accepted/dispatched = pending; acknowledged = done; rejected/failed/timeout = failed); `Faceplate` compound: `Faceplate.Root({ part, open, onClose })` (Drawer ขวา 380 px), `.Header` (ชื่อ, tag, area code, `ModeBadge`), `.Values` (ทุก numeric role เป็น `ValueTag` แนวตั้ง), `.Trend` (TimeSeries 15 นาทีของ numeric role แรก), `.Controls` (start/stop/setpoint ตาม writable roles ของ kind; ไม่มีสิทธิ์ = `gateReasonKey` note), `.Alarms` (alarm active ของ tag ใน part + ack), `.Interlocks` (จาก `tags.requires` ถ้ามี); `CommandButton({ label, tag, value, confirmTitle, consequence, danger? })` — คลิก → Confirm → `send` → แสดง phase (วงแหวน pending, ✓, ✕ + ข้อความ) M6
- [ ] **Step 1: Write the failing test**

```ts
test('lifecycle phases', () => {
  expect(commandPhase(null, null)).toBe('idle');
  expect(commandPhase({ status: 'dispatched' }, null)).toBe('pending');
  expect(commandPhase({ status: 'acknowledged' }, null)).toBe('done');
  expect(commandPhase({ status: 'timeout' }, null)).toBe('failed');
  expect(commandPhase(null, 'edge offline')).toBe('failed');
});
```

- [ ] **Step 2: Run** `cd web && bun test src/features/process/model/command.test.ts` — Expected: FAIL
- [ ] **Step 3: Implement**
- [ ] **Step 4: Run test** — Expected: PASS
- [ ] **Step 5: Commit** `feat(process): faceplate and guarded command button`

### Task 14: Live L2 — `/live/:lineId?`

**Files:**
- Create: `web/src/features/process/LivePage.tsx`
- Modify: `web/src/App.tsx` (route `/live` และ `/live/:lineId` ชี้ LivePage แทน LinePage จาก R1), `web/src/app/redirects.ts` (`/line` ยังชี้ `/live`)

**Interfaces:**
- Consumes: Tasks 3, 7–13; `useSceneSource` (`features/line3d/useSceneSource.ts`); scope (R1 Task 16)
- Produces: หน้า L2 — ถ้า line มี model active: parts + symbols จาก model; ไม่มี: `virtualParts` ของ devices ใน line + fallback symbols; layout = `HmiLayoutDoc` ที่บันทึก ถ้าไม่มี → flow (มี confirmed ≥1) หรือ elevation; toolbar: Segmented layout (Flow/Elevation), zoom, "Problems only" (หรี่ทุกอย่างที่ไม่ fault/stale), "แสดงข้อเสนอ", Replay (Task 17), ลิงก์ 3D; alarm banner ล่าง (AlarmRow ล่าสุด 3 แถว + ปุ่ม Ack + ลิงก์ Alarms); เลือก symbol → lift & dim + trace upstream/downstream (เส้นที่เชื่อมยังเข้ม) + Faceplate; คีย์บอร์ด: ←/→ = `nextAlong` downstream/upstream, Enter = เปิด faceplate, Esc = ปิด; list mirror `<ul class="sr-only">` ของ equipment + state
- [ ] **Step 1: Implement**
- [ ] **Step 2: Verify** `/live?demo=admin` (Demo org): batching plant แสดง symbol จริง, belt ที่ running มี dash วิ่ง, silo ที่ HI มี ▲ กระพริบจน ack; เลือก Mixer → ส่วนอื่นหรี่, faceplate เปิด; `/live/<sorting-line-id>` แสดง conveyor/motor/camera/bin ของ sorting line (ไม่มีไซโล)
- [ ] **Step 3: Commit** `feat(live): L2 process mimic from the plant model`

### Task 15: Equipment L3 — `/live/:lineId/eq/:label`

**Files:**
- Create: `web/src/features/process/EquipmentPage.tsx`; Modify: `web/src/App.tsx`

**Interfaces:**
- Consumes: Faceplate sub-components (Task 13), `TimeSeries`, `StateTimeline` (R2)
- Produces: หน้าเต็ม: header (ชื่อ TH/EN + state + mode), Tabs: Overview (values + trend 1 h/8 h + StateTimeline 8 h), Alarms (history ของ tag ใน part), Commands (history จาก commands API ของ tag), Diagnostics L4 (tag list: path, quality, age, source/gateway ลิงก์ไป `/connect/gateways/:edgeId`); faceplate drawer มีลิงก์ "เปิดหน้าเต็ม" มาที่นี่ ด้วย view transition (M9: `viewTransitionName` = `eq-<label>` บน symbol และ header)
- [ ] **Step 1: Implement**
- [ ] **Step 2: Verify** จาก L2 คลิก "เปิดหน้าเต็ม" → morph; Back กลับมาตำแหน่ง/zoom เดิม (เก็บ `View` ใน history state)
- [ ] **Step 3: Commit** `feat(live): L3 equipment detail`

### Task 16: Flow editor — `/setup/flow`

**Files:**
- Create: `web/src/features/process/FlowEditor.tsx`, `web/src/features/process/model/history.ts` (+test)
- Modify: `web/src/App.tsx`, `web/src/app/nav.ts` (Plant setup section: "Process flow")

**Interfaces:**
- Produces: `type EditorDoc = { conns: PlantConnection[]; layout: HmiLayoutDoc }`; `type EditorAction = { t: 'move'; label: string; x: number; y: number } | { t: 'connect'; conn: PlantConnection } | { t: 'remove'; index: number } | { t: 'accept'; index: number } | { t: 'acceptAll' } | { t: 'medium'; index: number; medium: Medium } | { t: 'layout'; placed: Placed[] }`; `editorReducer(s: { past: EditorDoc[]; now: EditorDoc; future: EditorDoc[] }, a: EditorAction | { t: 'undo' } | { t: 'redo' }): typeof s` (past สูงสุด 50; move ต่อเนื่องของ label เดียวกันภายใน 500 ms รวมเป็น 1 ขั้น — รับ `at: number` ใน move action)
- [ ] **Step 1: Write the failing test**

```ts
const empty = { conns: [], layout: { version: 1, mode: 'flow', nodes: {} } } as EditorDoc;
const s0 = { past: [], now: empty, future: [] };
test('undo restores, redo replays', () => {
  const s1 = editorReducer(s0, { t: 'move', label: 'A', x: 10, y: 0, at: 0 });
  const s2 = editorReducer(s1, { t: 'undo' });
  expect(s2.now.layout.nodes.A).toBeUndefined();
  expect(editorReducer(s2, { t: 'redo' }).now.layout.nodes.A).toEqual({ x: 10, y: 0 });
});
test('drag burst is one undo step', () => {
  let s = s0;
  for (let i = 0; i < 5; i++) s = editorReducer(s, { t: 'move', label: 'A', x: i, y: 0, at: i * 100 });
  expect(s.past).toHaveLength(1);
});
test('acceptAll confirms suggestions only', () => {
  const sug = { from_label: 'A', from_port: 'out', to_label: 'B', to_port: 'in', medium: 'sand', status: 'suggested' } as PlantConnection;
  const s = editorReducer({ ...s0, now: { ...empty, conns: [sug] } }, { t: 'acceptAll' });
  expect(s.now.conns[0].status).toBe('confirmed');
});
```

- [ ] **Step 2: Run** `cd web && bun test src/features/process/model/history.test.ts` — Expected: FAIL
- [ ] **Step 3: Implement** editor: ซ้าย part list (ค้นหา, filter "ยังไม่เชื่อม"); กลาง ProcessCanvas edit mode (ลาก symbol snap 8, ลากจากจุด port → ปล่อยบน port ของอีก part = connect, คลิกเส้น = เลือก + เมนู medium/ลบ, ปุ่ม "เสนอเส้นเชื่อม" เรียก `proposeConnections`, "ยอมรับทั้งหมด", "จัดอัตโนมัติ" เรียก `flowLayout`); ขวา inspector ของสิ่งที่เลือก (medium, flow_tag picker จาก tag ของ site); Save = `putConnections` แล้ว `putLayout` (ถ้าอันหลังล้ม แสดง Notice error และคง state); viewer = อ่านอย่างเดียว + `PermissionNotice`; Ctrl+Z/Ctrl+Shift+Z
- [ ] **Step 4: Run test** — Expected: PASS; ใน dev: เสนอเส้นของ demo plant → ยอมรับ → save → reload `/live` เห็น flow layout พร้อมเส้นทึบ
- [ ] **Step 5: Commit** `feat(setup): constrained process flow editor`

### Task 17: Replay scrubber (M13)

**Files:**
- Create: `web/src/features/process/model/replay.ts` (+test)
- Modify: `web/src/features/process/LivePage.tsx` (toolbar Replay)

**Interfaces:**
- Produces: `valueAt(series: { t: number; v: number }[], t: number): number | null` (ค่าล่าสุดที่ ≤ t; ก่อนจุดแรก = null; binary search); replay mode: เลือกช่วง 1 h/8 h, scrubber ลากได้ + ปุ่มเล่น ×10/×60, ทุก `read(path)` ใน LivePage อ่านจาก history (`useSeries` ของ trends) ณ เวลา cursor แทน live; แบนเนอร์ "กำลังดูย้อนหลัง 13:42:10 / Replaying" สีกลาง + ปุ่มกลับ live; คำสั่งทั้งหมด disabled ระหว่าง replay
- [ ] **Step 1: Write the failing test**

```ts
const s = [{ t: 10, v: 1 }, { t: 20, v: 2 }, { t: 30, v: 3 }];
test('holds the last value', () => expect(valueAt(s, 25)).toBe(2));
test('exact hit', () => expect(valueAt(s, 30)).toBe(3));
test('before history is null', () => expect(valueAt(s, 5)).toBeNull());
```

- [ ] **Step 2: Run** `cd web && bun test src/features/process/model/replay.test.ts` — Expected: FAIL
- [ ] **Step 3: Implement**
- [ ] **Step 4: Run test** — Expected: PASS; ใน dev ลาก scrubber แล้วระดับไซโล/สถานะ belt เปลี่ยนตามประวัติ, ปุ่ม Stop ใน faceplate disabled
- [ ] **Step 5: Commit** `feat(live): replay the mimic over history`

### Task 18: Wall ใหม่ + L1 area tiles

**Files:**
- Modify: `web/src/features/wall/WallPage.tsx`, `web/src/features/overview/OverviewPage.tsx` (area tiles จาก R2 placeholder)
- Create: `web/src/features/wall/cycle.ts` (+test)

**Interfaces:**
- Produces: `wallCycle(lineIds: string[], now: number, periodMs = 30_000, pinned?: string): string | null` (pinned ชนะ; ไม่มี line = null); Wall: ProcessCanvas fit ไม่มี toolbar, value tag ขนาด ×1.6, alarm banner ใหญ่ (ข้อความ 24 px), KPI 4 ช่อง `StatTile size="wall"`, clock 48 px; dark theme เป็นค่าเริ่มต้นของ wall ถ้าผู้ใช้ไม่ได้ตั้งเอง; Overview area tile = ProcessCanvas แบบ thumbnail (lod markers, ไม่มี animation) + alarm count + คลิกไป `/live/:lineId` ด้วย view transition
- [ ] **Step 1: Write the failing test**

```ts
test('cycles by period', () => {
  expect(wallCycle(['a', 'b'], 0)).toBe('a');
  expect(wallCycle(['a', 'b'], 30_000)).toBe('b');
  expect(wallCycle(['a', 'b'], 60_000)).toBe('a');
});
test('pinned wins', () => expect(wallCycle(['a', 'b'], 30_000, 30_000, 'a')).toBe('a'));
```

- [ ] **Step 2: Run** `cd web && bun test src/features/wall/cycle.test.ts` — Expected: FAIL
- [ ] **Step 3: Implement**
- [ ] **Step 4: Run test** — Expected: PASS
- [ ] **Step 5: Commit** `feat(wall): mimic wall and overview area tiles`

### Task 19: Performance + e2e R3

**Files:**
- Create: `tests/e2e/redesign_r3.py`; Create: `web/src/features/devui/PerfMimic.tsx` (DEV route `/dev/perf-mimic`: 300 fallback symbols + 320 lines สุ่มแบบ seed คงที่ + flow animation)

- [ ] **Step 1: Write the script** — (a) `/dev/perf-mimic`: ใช้ `page.evaluate` นับเฟรมด้วย `requestAnimationFrame` ระหว่าง zoom wheel 40 ครั้ง → assert ≥ 55 fps; (b) `/live` Demo: assert มี `[data-ply="symbols"] path` ≥ 20, ไม่มีข้อความ "not mapped"; คลิก symbol แรกที่ `aria-label` มี "Mixer" → drawer เปิด; (c) `/live` ตั้ง `emulateMedia(reduced_motion='reduce')` → ไม่มี element ที่ `getComputedStyle().animationName !== 'none'` ใน `.pc-run`; (d) screenshot light/dark 1440 และ 390 ลง `%TEMP%/redesign_r3/`
- [ ] **Step 2: Run** `WEB_URL=http://localhost:5199 python tests/e2e/redesign_r3.py` — Expected: exit 0; เปิดดูภาพทุกไฟล์: symbol อ่านออกว่าเป็นอะไร, ไม่มี label ชน
- [ ] **Step 3: Run detector** `C:\Users\Gigabyte\.claude\skills\impeccable\scripts\impeccable.cmd detect --json web/src/features/process`
- [ ] **Step 4: Commit** `test(e2e): R3 mimic performance and behaviour`
