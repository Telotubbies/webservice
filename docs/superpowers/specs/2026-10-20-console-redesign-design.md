# Console Redesign — Full SCADA + Datadog-grade analytics + 2026 SaaS (Design)

*วันที่: 2026-10-20 · Branch base: `feature/plant-twin-glb` → PR เข้า `ui-v4` · สถานะ: draft รออนุมัติ*
*ภาษา: เนื้อหาหลักภาษาไทย ศัพท์เทคนิคเป็นภาษาอังกฤษ; ข้อความบน UI ทุกจุดต้องมี TH + EN (`scripts/check-i18n.mjs`)*
*เอกสารคู่กัน: `web/PRODUCT.md` (product truth), แผนลงมือ `docs/superpowers/plans/2026-10-20-redesign-r0-r1-foundation.md`, `…-r2-dataviz.md`, `…-r3-scada-mimic.md`, `…-r4-gateway-topology.md`*

---

## 0. ที่มาและเจตนา

ผู้ใช้ประเมินว่า console ตอนนี้ "ใช้ยาก ไม่ตอบโจทย์ กราฟคุณภาพต่ำ 2D ไม่เหมือนเครื่องจริง หน้า gateway ออกแบบไม่ดี"
และขอ **redesign ทั้งระบบตั้งแต่ IA ถึง visual และ interaction** ไม่ใช่แค่ขัดเงา โดยอ้างอิง Datadog, Grafana และ SCADA/HMI จริง

สิ่งที่ผู้ใช้ตัดสินแล้วในรอบนี้ (คำตอบของเขาเอง):

| เรื่อง | คำตอบ |
|---|---|
| เมนูที่ลอก Datadog (APM, Digital Experience, Security, Error tracking, Developer Portal, Incident Response) | **ย้ายไปอยู่ใน Platform area** ไม่ลบ |
| ฉากใช้งานหลักของหน้าจอ live | **Control-room monitor เปิดทั้งกะ** |
| Gateway / PLC / tag setup | **Live topology ที่แก้ไขได้ในตัว** (คลิก node → side panel, "+" เพื่อเพิ่มสิ่งถัดไป, health บนเส้น) |
| Visual direction (หลัง re-roll 2 รอบ) | **category standard ที่ craft เต็มที่**: Datadog/Grafana สำหรับ analytics + SCADA จริง (WinCC Unified, AVEVA, Ignition) สำหรับ process + **motion และลูกเล่นมากขึ้น** |
| ข้อความเพิ่มระหว่างทาง | "ใส่ ui component กับ animation ให้มีลูกเล่น", "อยากได้ scada เต็ม + datadog + 2026 SaaS web design" |
| ภาษาเอกสาร | ไทย + ศัพท์เทคนิคอังกฤษ |

**Positioning ที่ต้องพิสูจน์บนจอ:** mimic ของ operator **มาจาก 3D model (.glb) ของโรงงานเอง** ชิ้นต่อชิ้น ไม่ใช่ diagram generic
(ดู `web/PRODUCT.md` §Positioning)

---

## 1. ผลการ audit (หลักฐานจากหน้าจอจริง 2026-10-20 และโค้ด)

ถ่ายด้วย Playwright ที่ :5199 org "Demo" (ไฟล์ในเครื่อง: scratchpad ของ session) — ปัญหาเรียงจากแรงสุด

### 1.1 Information architecture
- Rail มี **16 กลุ่ม** ลอกเมนู Datadog ทั้งชุด (`web/src/app/nav.ts:41-196`); งานโรงงานกระจัดกระจาย: Line view อยู่ใต้ *Dashboards*, Trends อยู่ใต้ *Metrics*, Health อยู่ใต้ *Infrastructure*, OEE อยู่ใต้ *Production*; หน้า `/line` และ `/line3d` ไฮไลต์กลุ่ม *Dashboards*
- Infrastructure มี 8 tab ปนกัน (Devices, Data sources, Cameras, Models, Rules, Events, Map, Profiles) — connectivity กับ vision AI อยู่ในที่เดียว
- ไม่มีลำดับชั้นการนำทางแบบ HMI (L1 plant → L2 area/line → L3 equipment → L4 diagnostics)

### 1.2 Process visualization (2D/HMI)
- **สองโรงงานปนกัน:** Line view หัวข้อ "Sorting line 1" แสดง card ของ sorting line (motor/conveyor/camera/bin) แต่รูปด้านล่างเป็น **plan ของโรงผสมคอนกรีต** (`LinePage.tsx:179-201` ใช้ `useSceneSource` → demo glb)
- HMI mode (`features/line3d/HmiView.tsx`) ใช้ **symbol generic ต่อ kind**: vessel ทุกตัวหน้าตาเหมือนไซโล (liquid tank, drum emptier, weigh hopper เหมือนกันหมด), แถวจัดตาม kind (store/process/move) ไม่ใช่ตาม process, เส้นเชื่อมเดาจาก bounding box (`hmiLayout.ts:104-118`), pipe เป็นเส้นนอนไม่มีความหมาย, ข้อความ "not mapped" เต็มจอ, พื้นที่ว่างเกินครึ่ง
- **สีผิดหลัก ISA-101:** running = เขียว `#25a065` (`HmiView.tsx:21`), Plan view tint เขียวเมื่อ active (`PlantPlan.tsx:73`), Overview/Line ขึ้นแบนเนอร์ **แดง "STOPPED"** ทั้งที่การหยุดเป็นสถานะปกติ
- Plan/Front view: label ชนกัน ("LiquDrum'emptier 2"), กล่องสีน้ำเงินทับ raster
- Faceplate เป็นกองปุ่ม chip 30 ปุ่ม ไม่มีลำดับ

### 1.3 Charts
- **บั๊ก: Trends ไม่วาดกราฟ** ทั้งที่ตาราง stats มีค่า — `TimeChart.tsx:58-77` effect ขึ้นกับ `[structure, hasData]`; ถ้า `hasData` เป็นจริงระหว่าง `loading` (live points มาก่อน history) container ยังไม่ mount (`el` = null) และ effect จะไม่รันอีกเมื่อ loading จบ → uPlot ไม่ถูกสร้าง (ต้อง reproduce ก่อนแก้ ใน R0)
- Sparkline บน Overview เป็น step ไม่มี limit/ช่วงเวลา, stat tile ไม่มี delta, ไม่มี freshness
- Dashboard: query value ลอยกลาง panel ว่างใหญ่, treemap เป็นบล็อก cyan สีเดียว (นอก palette), section header เป็นแถบสีม่วง/ฟ้าอิ่มตัวกินพื้นที่, bar สัปดาห์เป็นบล็อกเขียวก้อนเดียว
- Palette ปัจจุบัน 6 สี (`trends/viz.ts:23`) ผ่าน validator บน light แต่ **CVD WARN 6.6** (#9b4fc4↔#1d5a9e) และ **FAIL บน dark** (lightness band + contrast) — ไม่มี dark theme ของกราฟเลย
- Metrics summary ค้าง skeleton พร้อมข้อความ "0 signals" (state ขัดกัน)
- Insights แสดง "Flatline · level_pct 112.12" — ตัวเลขไม่มีหน่วย/ความหมาย ซ้ำหลายแถว

### 1.4 Gateway / Infrastructure
- Network map วาด **gateway × equipment แบบ full mesh** (`NetworkMapPage.tsx:97-104`) → hairball; มี edge `cam-*` ที่ disabled กว่า 20 ตัว (ขยะจาก e2e test ใน org Demo) ปนเป็น gateway
- หมายเหตุบนหน้าบอกว่า "tags are not bound to a single gateway" — **ไม่จริงแล้ว**: `tags.source_id → data_sources.edge_id` (migration 0015) และ `tags.device_id → devices` (0051) ความสัมพันธ์จริงมีครบ
- หน้า gateway: ตาราง 35 แถวแบน, คอลัมน์ Address แสดง **JSON ดิบ** ของ simulator, แถว add มี 9 input ในบรรทัดเดียว, ไม่จัดกลุ่มตาม device/equipment
- Health page นับ camera edge ที่ disabled เป็น "Edge fleet"

### 1.5 Design system
- Token ชุดเดียว (light) วัดจาก Datadog (`dd-theme.css`), ไม่มี dark ของ console, ไม่มี motion token
- Hex hardcode ใน feature (HmiView `C`, Mimic, PlantPlan, NetworkMap fallback) ขัดกฎข้อ 4 ของ `shared/ui/README.md`
- `shared/ui` ขาด primitive พื้นฐาน: Tabs, Tooltip, Popover, Menu, Drawer, Toast, DataTable, StatTile, Panel chrome
- Wall มีแค่ STOPPED + 3 ค่า; จอ 70% ว่าง; Overview ให้ "Getting started" ที่ทำเสร็จแล้วกินครึ่งจอ

---

## 2. Goals / Non-goals / Anti-goals

**Goals**
1. **G1 IA ใหม่ตามงาน** — Plant work เป็นเจ้าของ rail; Engineering setup แยก; Platform รวมทุกหน้าที่ลอก Datadog ไว้กลุ่มเดียว; URL เก่าทุกอันยัง redirect ได้
2. **G2 Design system "Console 5"** — token light + dark, density 2 ระดับ, elevation plies, motion tokens, component library ครบชุด (§6)
3. **G3 Data-viz system** — กราฟเกรด Datadog/Grafana: panel chrome, stat tile, time-series v2, state timeline, bullet, bar list, heatmap; palette ผ่าน validator ทั้ง 2 theme (§7)
4. **G4 SCADA mimic จาก 3D twin** — แยก equipment ทีละชิ้นจาก .glb เป็น symbol จริง, process flow model (connections) ที่ผู้ใช้ยืนยัน, renderer แบบ high-performance HMI, faceplate, flow editor, ลำดับหน้าจอ L1–L4 (§8)
5. **G5 Gateway topology ที่แก้ไขได้** — Edge → Source → Tag group → Equipment + Camera chain, health บนเส้น, inspector, "+" next step (§9)
6. **G6 SCADA เต็มรูปแบบบนจอ** — Alarm console (ISA-18.2), event journal, trends, faceplate + guarded command, recipe/sequence screens (ตาม parity spec), shift handover log, comms diagnostics (§10)
7. **G7 Motion ที่มีลูกเล่น** — ทุก animation ผูกกับการเปลี่ยนสถานะจริง มี reduced-motion fallback และงบ CPU (§6.6)

**Non-goals (รอบนี้ไม่ทำ)**
- เปลี่ยน backend stack, เปลี่ยน uPlot หรือ three.js
- HMI editor แบบวาดอิสระ (free drawing) — มีเฉพาะ **flow editor แบบมีกรอบ** (ลากวาง symbol ที่ได้จาก model, ลากเส้นเชื่อม port, เลือก medium)
- หน้า landing (`web/DESIGN.md` world แยก)
- Native app; protocol ใหม่; ISA-88 batch record เต็มรูปแบบ
- ลบ feature ใน Platform group (ย้ายที่เท่านั้น)

**Anti-goals (ถ้าเกิด ถือว่าล้มเหลวแม้ทำงานได้)**
- สถานะปกติ (running, stopped, open, closed) ได้สี hue — สีมีไว้ให้ abnormal เท่านั้นบน process surface
- Animation วนโดยไม่มีสถานะรองรับ (decorative loop) หรือกระพริบเมื่อค่าแกว่งเล็กน้อยใน deadband
- Mimic **วาด equipment หรือเส้นเชื่อมที่ model/ผู้ใช้ไม่ได้ยืนยัน** — ข้อเสนออัตโนมัติต้องแสดงเป็น "suggested" (เส้นประ) จนกว่าจะ accept
- Mimic หรือ topology ส่งคำสั่งเขียน PLC โดยตรง — การสั่งงานผ่าน `CommandButton` → command path เดิมเท่านั้น
- Wall screen ใช้ CPU > 15% บน laptop ระดับกลาง หรือ frame drop ตอน pan/zoom mimic 300 symbol
- UAT hooks ที่มีอยู่หาย (`.side-nav`, `.topbar .live-pill`, `.top-clock`, `.user-btn`, `.palette-*`, `.skeleton`, `.error-state`)
- ข้อความไทยถูก uppercase / letter-spacing / ตัดกลางคำ

---

## 3. Constraints (จากโค้ดที่มี)

- Web: React 19.2, react-router 8, TanStack Query 5, Tailwind v4 `@theme`, uPlot 1.6, three 0.186, lucide 1.48, i18next; test ด้วย `bun:test` (`cd web && bun test <file>`); build `cd web && bun run build`
- CSP: font self-hosted เท่านั้น (@fontsource); script จาก bundle เท่านั้น
- Live data: `live` store (`lib/live.ts`) + `useStore(() => live.version)`; tag ชื่อ live เป็น dotted (`plant1.batch.agg.bin1.level_pct`), path ใน DB เป็น slash
- Backend: FastAPI + asyncpg, RLS ทุกตาราง tenant, migration คู่ `.py` + `.sql` (ADR-0001) ล่าสุด `0054` → ใหม่เริ่ม `0055`; router ใหม่อยู่ใน package ตาม domain
- Data model ที่ใช้ได้เลย: `edges` → `data_sources(edge_id)` → `tags(source_id, device_id)`; `sites → areas → lines → devices(kind)`; `plant_models → plant_parts(nodes, bindings, params ≤2048 B, device_id)`; `cameras(edge_id)`; `/hierarchy`, `/tags/move`
- Command path: `edge/commands.py::issue` (role, edge up, clock, confirm, rate limit, audit) — ห้ามสร้างทางลัด
- Serving dev: :5199 vite (Keycloak redirect กลับ :5199), :5173 nginx build — Playwright ใช้ `load` ไม่ใช่ `networkidle`

---

## 4. ผู้ใช้และสถานการณ์หลัก (ใช้เป็น acceptance)

| ID | Persona | สถานการณ์ | เกณฑ์ผ่าน |
|---|---|---|---|
| S1 | Operator | มองจอจากระยะ 2–3 m กลางกะ | ภายใน **5 วินาที** บอกได้ว่า plant ปกติไหม, มี alarm ระดับไหนกี่ตัว, อยู่ที่ equipment ไหน |
| S2 | Operator | alarm P1 เข้า | เห็นใน banner ทันที (≤1 s หลัง WS), คลิก → ไปที่ equipment บน mimic + faceplate เปิด, ack ได้ ≤ 2 คลิก |
| S3 | Operator | สั่ง stop belt | faceplate → Stop → confirm (บอกผลกระทบ) → เห็น lifecycle pending → acked บนปุ่มและบน symbol |
| S4 | Engineer | ต่อ PLC ใหม่ | จาก topology: Edge "+" → Modbus source → test connection → เพิ่ม tag (template/CSV/browse) → ลาก tag group ไป equipment → เห็นค่า live บนเส้น ภายใน 10 นาที ไม่เปิดหน้าอื่น |
| S5 | Engineer | upload .glb ใหม่ | auto-setup → ตรวจ symbol ที่สกัดได้ → ยืนยันเส้นเชื่อมที่เสนอ → mimic พร้อมใช้ |
| S6 | Supervisor | สรุปกะ | OEE A×P×Q, Pareto การหยุด, batch/truck decisions, handover note |
| S7 | Examiner demo | เปิด Wall บนจอใหญ่ | mimic + alarm banner + KPI อ่านได้จากระยะ 4 m, มีการเคลื่อนไหวที่บอกว่า "live" |

---

## 5. Information architecture ใหม่

### 5.1 Rail (ซ้าย, dark chrome) — 3 ส่วน + Platform + Admin

```
PLANT (operator)
  ภาพรวม / Overview                  /                     (L1)
  หน้างานสด / Live                    /live                 (L2 process mimic ต่อ line)
     ├ Process mimic                  /live/:lineId
     ├ 3D twin                        /live/:lineId/3d
     └ Wall mode                      /wall
  สัญญาณเตือน / Alarms               /alarms               (console, shelved, history, journal)
  แนวโน้ม / Trends                    /trends
  การผลิต / Production               /production           (OEE, stops, shifts, batches, truck AI decisions, reports, handover)
  Dashboards                         /dashboards  (+ notebooks)
ENGINEERING (engineer/admin)
  โครงสร้างโรงงาน / Plant setup      /setup                (ISA-95 tree, plant model & mapping, process flow, tags, alarm rules, derived tags)
  การเชื่อมต่อ / Connectivity        /connect              (topology editor, gateways, profiles)
  Vision AI                          /vision               (cameras, models, vision rules, events)
PLATFORM (หนึ่งกลุ่ม พับได้)
  Monitors, SLOs, Incidents, Teams, Logs, Events, Query, Metrics summary, Traces, Processes,
  Digital experience, Security, Error tracking, Catalog, Insights
ADMIN
  Organization, Members, Audit, API keys, Storage, Plan, Settings
```

- **Assistant AI** ย้ายเป็นปุ่มใน topbar (เปิด side panel) แทนกลุ่มแรกของ rail
- ทุก route เก่าใน `App.tsx` ได้ `<Navigate replace>` ไป route ใหม่ (ตาราง redirect อยู่ในแผน R1 Task 4)
- Rail ยุบเป็น icon 56 px ได้ (จำค่าใน localStorage); flyout เดิมยังใช้กับกลุ่มที่มีหลายรายการ

### 5.2 Topbar (40 px)
`[logo] [Scope picker: Org › Site › Area › Line] [⌘K search] ··· [Alarm summary chip ▲3 ◆5] [Shift] [Clock] [● Live] [Assistant] [Theme] [Bell] [User]`
- **Scope picker** แทน OrgSwitcher: breadcrumb dropdown ตาม ISA-95; ทุกหน้า Plant อ่าน scope นี้ (แทน `EquipmentPicker` ที่กระจายอยู่ตามหน้า)
- **Alarm summary chip** แสดงตลอดทุกหน้า: นับตาม priority + unacked, กดแล้วเปิด alarm drawer (ISA-18.2 "always visible alarm summary")
- Time range picker แบบ Grafana (relative/absolute, URL `?from=&to=`) **อยู่ใน page header ของหน้า analytics เท่านั้น** ไม่อยู่ใน topbar

### 5.3 ลำดับชั้นหน้าจอ process (ISA-101)
- **L1 Plant overview** — KPI row + area tiles (mini mimic thumbnail + alarm counts + state timeline 8 h) + top alarms
- **L2 Line process** — mimic ของ line นั้น + alarm banner + faceplate drawer
- **L3 Equipment detail** — `/live/:lineId/eq/:partId`: faceplate ขยายเต็มหน้า (values, trend 1 h/8 h, alarms ของ equipment, commands history, interlocks, AI decisions ถ้าเป็นกล้อง)
- **L4 Diagnostics** — tag list ของ equipment, quality/freshness, source/gateway ที่ป้อนค่า (ลิงก์ไป topology)

---

## 6. Design system "Console 5"

### 6.1 สองทะเบียนภาพ (registers) ในระบบเดียว
| | Process register (ISA-101) | Analytics register (Datadog) |
|---|---|---|
| ใช้ที่ | mimic, faceplate, alarm banner, wall, L1 tiles | dashboards, trends, production, platform, setup |
| พื้น | เทาอ่อน `--color-hmi-bg` | `--color-ground` + panel ขาว |
| สีสถานะ | **เฉพาะ abnormal** (alarm/fault/stale) | status ok/warn/crit ใช้ได้บน KPI ตาม threshold (มี icon + label เสมอ) |
| สีข้อมูล | ไม่มี series color; medium hues หม่น | categorical 5 สี (validated) |
| การเคลื่อนไหว | flow/rotation ผูกกับ run/speed | value tick, chart live edge, layout transitions |

กฎข้ามทะเบียน: **เขียวไม่เคยแปลว่า running** บน process surface; ใน analytics เขียวแปลว่า "อยู่ใน target" เท่านั้น

### 6.2 Color tokens (ใน `web/src/theme/tokens.css`: `@theme` ค่า light + override ใต้ `:root[data-theme=dark]`; ใช้ namespace `--color-*` เพื่อให้ Tailwind v4 สร้าง utility `bg-*`/`text-*`)

| Token | Light | Dark | หน้าที่ |
|---|---|---|---|
| `--color-ground` | `#eef1f4` | `#12151a` | พื้นแอป |
| `--color-panel` | `#ffffff` | `#1b1f26` | panel ply1 |
| `--color-panel-2` | `#f7f8fa` | `#222731` | header ตาราง, sunken |
| `--color-line` | `#dfe3e8` | `#2c323d` | hairline |
| `--color-line-strong` | `#c5ccd5` | `#3a4250` | input border |
| `--color-ink` | `#18202a` | `#e7eaf0` | ข้อความหลัก |
| `--color-ink-2` | `#4a5563` | `#b4bcc8` | รอง |
| `--color-ink-3` | `#6b7685` | `#8a94a3` | tertiary |
| `--color-ink-4` | `#9aa4b1` | `#5f6876` | disabled |
| `--color-chrome` | `#1f2430` | `#0d1014` | rail/topbar |
| `--color-chrome-2` | `#2a3040` | `#181c23` | chrome hover |
| `--color-accent` | `#2f6fdb` | `#5b8ff0` | action, selection, link เท่านั้น |
| `--color-accent-soft` | `#e6efff` | `#1e2c47` | selected row |
| `--color-hmi-bg` | `#e4e7eb` | `#171b21` | พื้น mimic |
| `--color-hmi-equip` | `#c9ced6` | `#3a414c` | equipment หยุด |
| `--color-hmi-equip-run` | `#6b7380` | `#8b94a1` | equipment ทำงาน (เข้มขึ้น ไม่ใช่เขียว) |
| `--color-hmi-edge` | `#3f4753` | `#aab3bf` | outline/feature lines |
| `--color-hmi-line-idle` | `#a3abb6` | `#4a525e` | process line ไม่มีการไหล |
| `--color-crit` / `--color-crit-soft` | `#c62828` / `#fdecec` | `#ff5b52` / `#3a1a1a` | alarm critical ▲ |
| `--color-warn` / `--color-warn-soft` | `#b26a00` (text) · `#f2a900` (fill) / `#fff3d6` | `#ffb020` / `#3a2c10` | alarm warning ◆ |
| `--color-info` | `#5b6573` | `#8d97a6` | info ● |
| `--color-ok` (analytics only) | `#1f8a5b` | `#3fbf80` | within target ✓ |
| `--color-sim` | `#2f6fdb` dashed | `#5b8ff0` dashed | simulated data (คงกฎเดิม: น้ำเงิน+เส้นประ) |

Medium hues (หม่น, ใช้แยกชนิดเส้น process เท่านั้น): aggregate `#8b7a5e`, sand `#a39373`, cement `#7d8590`, water `#4f7fa8`, air `#9aa3ad`, admixture `#8a6fa6`, concrete `#6d6a64`, signal `#5b6573` (dark theme ยกความสว่าง +12 L)

Token เดิมใน `dd-theme.css` **ยังอยู่** และ map เข้าหาชุดใหม่ใน R1 (alias) เพื่อไม่ให้หน้าเก่าแตก; ลบเมื่อ R6

### 6.3 Typography
- คง **IBM Plex Sans / Plex Sans Thai / Plex Mono** (incumbent, Thai-matched, self-hosted) — ความ "2026" มาจาก scale, weight, spacing ไม่ใช่ font ใหม่
- Scale (px): 11 · 12 · 13 (body dense, engineer tables) · 14 (body comfortable, process labels) · 16 · 18 · 22 (page title) · 28 (stat) · 40 (hero) · 64/96 (wall)
- ค่าตัวเลขในตาราง/value tag/axis = `tabular-nums`; hero และ stat value = proportional (กฎ dataviz)
- `.overline` คงกฎ Thai (ไม่ uppercase, ไม่ letter-spacing ใน `:lang(th)`)

### 6.4 Space, radius, elevation, density
- Spacing 4-pt: 2, 4, 6, 8, 12, 16, 20, 24, 32, 40, 48
- Radius: control 6, panel 8, overlay 12, pill 999 (2026 SaaS: มุมนุ่มขึ้นจาก 4/5 เดิม)
- **Elevation plies** (raise จากรอบเลือก world): ply0 ground · ply1 panel (hairline + `0 1px 2px` shadow) · ply2 popover/menu (shadow md) · ply3 dialog/drawer (shadow lg + scrim) — **เฉพาะ ply2/ply3 โปร่งแสง + backdrop-blur** ได้
- Density: `data-density="comfortable"` (control 32, row 40 — ค่าเริ่มต้นหน้า Plant) / `"compact"` (28/32 — ค่าเริ่มต้นหน้า Engineering/Platform)

### 6.5 Component library (`web/src/ui/` ใหม่; compound components, React 19 ไม่ใช้ forwardRef)

**Foundations:** `Button` (variant: primary · secondary · ghost · danger; size sm/md/lg; `loading`), `IconButton` (ต้องมี label), `Input`, `NumberField` (unit, min/max, step, mono), `Select`, `Combobox`, `Checkbox`, `Switch`, `Segmented`, `Tabs`, `Tooltip`, `Popover`, `Menu`, `Dialog`, `Drawer` (side sheet), `Toast`, `Badge`, `Kbd`, `ScopePicker`, `EmptyState`/`ErrorState`/`Skeleton` (ย้ายจาก Feedback)
**Data:** `Panel` (Datadog widget chrome: title, unit, time badge, menu, fullscreen, states), `StatTile`, `BulletBar`, `Meter`, `Sparkline` v2, `TimeSeries` (uPlot v2), `StateTimeline`, `BarList`, `HeatStrip`, `DataTable` (sort, sticky header, virtual rows ≥200, column chooser, density, row selection)
**Process (HMI):** `ValueTag` (ISA letters + value + unit + quality + limit marks), `EquipmentSymbol`, `ProcessLine`, `LevelFill`, `ModeBadge` (AUTO/MAN/LOCAL/OOS/SIM), `AlarmMarker` (priority shape+size ramp), `Faceplate` (`.Header .Values .Trend .Controls .Alarms .Interlocks`), `CommandButton` (confirm → pending → result), `AlarmBanner`, `AlarmRow`, `AlarmSummaryChip`
**Topology:** `TopoCanvas`, `TopoNode` (gateway · source · device · tagGroup · equipment · camera · model), `TopoEdge` (health), `Inspector`, `AddNext`

ทุก interactive component มี state ครบ: default, hover, focus-visible, active, disabled, loading, error (และ selected ถ้าเลือกได้) — แสดงใน **gallery route `/dev/ui`** (เฉพาะ `import.meta.env.DEV`) แทน Storybook

### 6.6 Motion system — "ลูกเล่นที่มีความหมาย"
**Tokens:** `--dur-instant 80ms` (press) · `--dur-fast 140ms` (hover/toggle) · `--dur-base 220ms` (menu, panel) · `--dur-slow 360ms` (drawer, view transition) · `--dur-process 600ms` (level/fill tween); easing `--ease-standard cubic-bezier(.2,0,0,1)`, `--ease-enter cubic-bezier(0,0,0,1)`, `--ease-exit cubic-bezier(.3,0,1,1)`; **exit = 0.7× enter**; springs: `snappy {stiffness 520, damping 38}`, `gentle {stiffness 260, damping 30}`

**เครื่องมือ:** `motion` (motion/react) สำหรับ enter/exit/layout/spring number; CSS keyframes สำหรับ loop ของ process (dash flow, rotation) ที่ปรับความเร็วด้วย custom property; View Transitions API (`document.startViewTransition` / react-router `viewTransition`) สำหรับ shared-element ระหว่างหน้า; ไม่ใช้ GSAP

**Motion catalogue (ทุกตัวผูกกับสถานะ):**
| ID | เหตุการณ์ (state) | การเคลื่อนไหว | reduced-motion |
|---|---|---|---|
| M1 | ค่าเปลี่ยนเกิน deadband | ตัวเลข spring-interpolate + underline flash 200 ms บน StatTile/ValueTag | เปลี่ยนทันที, ไม่ flash |
| M2 | alarm เข้า | แถวสไลด์เข้า banner + leading edge สี priority กวาด; **unacked P1 กระพริบ 1 Hz จน ack** (ISA-101) แล้วหยุดเป็น "stamp" morph | กรอบหนาคงที่ + ไอคอน ไม่กระพริบ |
| M3 | start/stop equipment | fill เข้มขึ้นแบบ radial wipe จาก drive; belt dash เร่ง/ชะลอตาม speed จริง (ease-out ตอนหยุด) | fill เปลี่ยนทันที, ลูกศรนิ่งแทน dash |
| M4 | มีการไหลในเส้น | particle/dash วิ่งตามเส้น, ความเร็ว ∝ flow rate; ไม่ไหล = นิ่ง | chevron นิ่งบอกทิศ |
| M5 | เลือก equipment | "lift & dim": ที่เลือกคงความเข้ม, ที่เหลือหรี่ 55% ใน 200 ms; trace เส้น upstream/downstream; faceplate spring เข้าจากขวา | หรี่ทันที, ไม่มี spring |
| M6 | ส่งคำสั่ง | ปุ่ม → วงแหวน pending → ✓ acked / ✕ failed (สั่น 2 ครั้ง) | ข้อความ + ไอคอนเท่านั้น |
| M7 | link health | packet วิ่งบนเส้น topology ตาม msg rate; หลุด = เส้นแตกเป็นประ + spark ณ จุดขาด; กลับมา = วาดเส้นคืน (dashoffset) | เส้นประคงที่ + ป้ายสถานะ |
| M8 | กราฟ live | จุดใหม่เลื่อนเข้าขอบขวา, crosshair sync, zoom animate 250 ms, onset marker ของ breach ตกลงมา | ไม่ animate zoom |
| M9 | เปลี่ยนหน้า | shared-element morph: area tile → L2 mimic, KPI tile → trend, alarm row → equipment | ตัดหน้าทันที |
| M10 | refetch | คง render เดิมที่ opacity .6 แล้ว crossfade (ไม่ flash skeleton) | crossfade 0 ms |
| M11 | overlay (menu, drawer, toast, palette) | spring enter 240 ms / exit 160 ms | fade 0 ms |
| M12 | gateway ต่อสำเร็จครั้งแรก | เส้นวาดตัวเอง + "signal acquired" pulse ครั้งเดียวที่ node | ป้ายข้อความ |
| M13 | replay scrubber | ลาก time cursor → mimic, value tag, กราฟ ย้อนค่าในอดีตพร้อมกัน (readout เวลาวิ่งตาม) | — (ผู้ใช้สั่งเอง) |

**กฎ:** ไม่เกิน 2 animation ต่อเนื่องนอกเหนือ process flow ในหนึ่ง view; หยุดทุก loop เมื่อ `document.hidden`; ค่าที่แกว่งใน deadband (ค่าเริ่ม 0.5% ของ span) ไม่ trigger M1; wall mode งบ CPU < 15%

### 6.7 2026 SaaS layer (ที่ทำให้ไม่ดู "แอปปี 2018")
- Bento grid บน Overview/Dashboards (tile ขนาดต่างกันตามความสำคัญ, gap 12)
- ⌘K command palette เป็นศูนย์กลาง: นำทาง, ค้นหา equipment/tag/alarm, คำสั่ง ("ack all visible", "open trend of Silo 3", "switch theme")
- Assistant panel (มีอยู่แล้ว) เปิดจาก topbar พร้อม context ของหน้า
- Theme light/dark/system มี parity จริง (ไม่ใช่ invert); toggle ใน topbar
- View transitions, optimistic UI สำหรับ ack/shelve, skeleton เฉพาะ first load
- Container queries ให้ Panel ปรับ layout ภายในตามขนาดตัวเอง (dashboard resize)

---

## 7. Data-visualization system

### 7.1 Form ตามงาน (ตัดสินก่อนสี)
| ข้อมูล | Form | ห้าม |
|---|---|---|
| ค่าปัจจุบัน 1 ค่า | `StatTile`: value + unit + delta vs 1 h + sparkline 1 h + limit band + freshness | one-bar chart, gauge |
| ค่า vs target (batch weight, OEE A/P/Q, ระดับ vs HI) | `BulletBar` | pie/donut |
| แนวโน้มตามเวลา | `TimeSeries` line, limit lines (dashed เฉพาะ threshold), onset marker, annotation (alarm/command/batch) | dual axis — **หนึ่งหน่วยต่อหนึ่งกราฟ** (คงกฎเดิม) |
| สถานะเครื่องตามเวลา | `StateTimeline` (running/stopped/fault/OOS แถบต่อ equipment) | stacked area |
| alarm density | `HeatStrip` sequential (สีเดียวอ่อน→เข้ม) | rainbow |
| downtime by reason | `BarList` แนวนอนเรียงมาก→น้อย (Pareto + cumulative line) | pie |
| AI decision (gravel/sand ต่อชั่วโมง) | stacked bar 2 class + confidence histogram | treemap |
| หลายค่าเท่ากัน | table + sparkline คอลัมน์ | 8 สี |

### 7.2 สี (validator ผ่านแล้ว 2026-10-20 — รันซ้ำทุกครั้งที่แก้)
- **Categorical 5 slot, ลำดับตายตัว** (ลดจาก 6 เพราะ 6 slot ที่ไม่ใช้ hue ร้อนผ่าน dark ไม่ได้):
  - Light (surface `#ffffff`): `#2a78d6, #c0479d, #6250d6, #0b9a9a, #9b4fc4` — ALL PASS (CVD worst 9.9, normal 19.3, contrast ≥3:1)
  - Dark (surface `#1b1f26`): `#3987e5, #d55181, #9085e9, #13a0a0, #b06fd8` — ALL PASS (CVD worst 8.3, normal 18.5)
  - เกิน 5 series → small multiples หรือ "Other"; สีตาม entity ไม่ตามลำดับ (filter ไม่ repaint)
- Sequential: blue ramp (light→dark) — สำหรับ HeatStrip/heatmap
- Diverging: blue ↔ orange-brown กลางเทา (deviation จาก target)
- Status: crit/warn/info/ok ตาม §6.2 — ไม่ใช้เป็น series เด็ดขาด

### 7.3 Panel chrome และ interaction (มาตรฐาน Datadog/Grafana)
- Header: title · unit · time badge ("1h") · ไอคอน info · เมนู (View in Trends, Add to dashboard, Export CSV/PNG, Edit) · fullscreen
- States: loading (skeleton เฉพาะครั้งแรก), refetch (M10), empty (บอกว่าจะเห็นอะไรเมื่อไหร่), error + retry, stale (ป้าย + เวลา), no permission
- Interaction: crosshair sync ภายใน dashboard/trend stack, drag-zoom, legend click = isolate / ⌘-click = hide, pause live, table-view toggle ทุก chart, keyboard focus แสดงเท่ากับ hover, tooltip ไม่ใช่ทางเดียวที่อ่านค่า
- Hit target ≥ 24 px; gridline solid hairline; ไม่มีตัวเลขบนทุกจุด

---

## 8. SCADA mimic จาก 3D twin (หัวใจของงาน)

### 8.1 Symbol extraction ("symbolize") — แยกชิ้นจาก three.js
ต่อ part ที่ map แล้ว (`plant_parts.nodes`) ใน scene เดิม (`features/line3d/scene.ts`):
1. **Isolate** nodes ของ part (มี `isolate()` อยู่แล้ว) แล้ว render orthographic **front view** (และ top view สำหรับ plan) ลง `WebGLRenderTarget` ขนาดตาม aspect (ด้านยาว 512 px) ด้วย material ขาวเรียบ + depth
2. **Silhouette → vector:** อ่าน alpha mask → marching squares → Ramer–Douglas–Peucker (ε = 1.2 px) → path `d` แบบ normalized 0..1 (pure TS, ทดสอบได้)
3. **Feature lines:** `EdgesGeometry` (threshold 35°) render ทับด้วย depth test กับ depth ของ part เอง (hidden-line removal) → raster 2× alpha (data URL) ใช้เป็น `mask` ให้เติมสีด้วย token (`--color-hmi-edge`) ได้ทั้งสอง theme
4. **Ports:** เสนอจุดต่ออัตโนมัติจาก silhouette: บน/ล่าง/ซ้าย/ขวา-กลาง; vessel → outlet = จุดต่ำสุด; conveyor → head/tail = ปลายแกนยาว
5. **Cache:** IndexedDB key = `sha256 ของ model + hash(nodes) + view + SYMBOL_VERSION`; ถ้า extraction ล้มเหลวหรือ part บาง/เล็กเกิน (bbox ด้านสั้น < 4 px) → **fallback ISA symbol** ตาม kind (ปรับปรุงจาก `HmiView.Symbol`)
6. **Pipe parts** ไม่เป็น symbol: centerline ของ segment ฉายลง 2D → simplify เป็น polyline ตั้งฉาก → กลายเป็น `ProcessLine` (medium จาก `params.color`)

"One geometry" (raise จากรอบเลือก world): silhouette path เดียวใช้เป็น **รูป, hit area, clip ของ level fill และ alarm outline**

### 8.2 Process flow model (ข้อมูลใหม่)
- ตาราง `plant_connections` (migration 0055): `org_id, model_id, id, from_label text, from_port text, to_label text, to_port text, medium text CHECK IN ('aggregate','sand','cement','water','admixture','air','concrete','signal'), flow_tag text NULL, waypoints jsonb ≤ 4 KB, status text CHECK IN ('suggested','confirmed')` + RLS
  - อ้าง part ด้วย **label** ไม่ใช่ uuid เพราะ `put_parts` (`app/plant/routes.py:300-329`) ลบแล้ว insert ใหม่ทุกครั้งที่ save → uuid เปลี่ยนทุกครั้ง; label unique ต่อ model อยู่แล้ว (`UNIQUE (org_id, model_id, label)`); label ที่หายไปหลังแก้ mapping = connection ค้าง (dangling) ซึ่ง editor แสดงเตือนเหมือน binding ค้าง
- ตาราง `plant_layouts` (0055): `org_id, model_id PK, doc jsonb ≤ 64 KB` (`{version:1, mode:'flow'|'elevation', nodes:{[label]:{x,y,scale,flip}}, groups:[{label,x,y,w,h}]}`)
- API: `GET|PUT /api/v1/orgs/{org}/sites/{site}/plant-models/{model}/connections` (replace-all, ≤ 500, validate part อยู่ใน model, ไม่มี self-loop, medium enum), `GET|PUT …/hmi-layout`; PUT ต้อง config role (admin/owner) + audit แบบเดียวกับ `put_parts`
- **Auto-propose** (client, pure function): vessel เหนือ belt (heuristic เดิม), conveyor head ใกล้ inlet ของ part อื่น (≤ 0.6 m), pipe สัมผัส part → ได้ `status:'suggested'` พร้อม confidence; mimic แสดง suggested เป็นเส้นประจาง **จนผู้ใช้ accept**

### 8.3 Layout
- **Elevation mode** (truthful): วาง symbol ที่ตำแหน่ง front-view จริงของ part (scale ลง) — ใช้ได้ทันทีไม่ต้องมี connection
- **Flow mode** (schematic): layered layout ซ้าย→ขวาตาม connections (longest-path layering + barycenter ordering, seed ลำดับจาก elevation x); เส้นเดินแบบ orthogonal มุมโค้ง 6 px
- ค่าเริ่มต้น: flow ถ้ามี confirmed connection ≥ 1, ไม่งั้น elevation; ผู้ใช้สลับได้, ตำแหน่งที่ลากเองเก็บใน `plant_layouts`

### 8.4 Renderer v2 (`web/src/features/process/`)
- SVG แบ่ง ply: area frames → process lines → symbols → value tags → alarm markers → selection overlay
- Pan/zoom (wheel, drag, ปุ่ม +/−/fit, keyboard `+ - 0`); level-of-detail: zoom < 0.6 ซ่อน value tag เหลือ alarm marker
- สถานะ symbol: stopped = `--color-hmi-equip` · running = `--color-hmi-equip-run` + motion M3/M4 · starting/stopping = ครึ่ง fill + outline pulse · fault/alarm = outline สี priority + `AlarmMarker` · interlocked = hatch · OOS = hatch + "OOS" · stale/bad = outline ประ + "?" · unmapped = outline ประจาง ไม่มี value · simulated = `ModeBadge SIM`
- Keyboard: Tab เข้า mimic, ลูกศร = เดินตาม connection ไป equipment ถัดไป, Enter = เปิด faceplate; มี list mirror สำหรับ screen reader
- **Faceplate drawer** (compound): header (name TH/EN, tag, area code, mode), values (ValueTag list), mini trend 15 นาที, controls (`CommandButton` start/stop/setpoint ผ่าน `useCommand` เดิม), alarms ของ equipment, interlocks (`tags.requires`), AI decisions (part ที่ผูกกล้อง)
- แยกสองโรงงาน: line ที่ไม่มี .glb (sorting line) ใช้ **virtual parts** จาก ISA-95 `devices(kind)` + fallback symbol; line ที่มี model ใช้ symbol จาก model — แต่ละ line มี mimic ของตัวเอง (แก้ §1.2 ข้อแรก)

### 8.5 Flow editor (`/setup/flow`, admin)
- ซ้าย: รายการ part (ค้นหา, กรอง unmapped); กลาง: renderer v2 ในโหมด edit (ลาก symbol snap 8 px, ลากจาก port ไป port = สร้าง connection, เลือก medium, accept/reject suggested ทีละเส้นหรือทั้งหมด, Auto-layout, undo/redo 50 ขั้น); ขวา: inspector ของสิ่งที่เลือก
- Save = PUT connections + layout ใน transaction เดียวฝั่ง client (สองคำขอ; ถ้าอันที่สองล้มให้แจ้งและไม่ทิ้ง state)
- viewer/operator เห็นแบบอ่านอย่างเดียว + `PermissionNotice`

---

## 9. Gateway topology editor (`/connect`)

### 9.1 Graph (ทุกความสัมพันธ์มาจากข้อมูลจริง)
`Site` → `Edge gateway` → `Data source` (protocol + endpoint) → `Tag group` (จัดตาม `tags.device_id`; tag ที่ยังไม่มี device จัดตาม segment `line/device` ของ path) → `Equipment` (ISA-95 device) ; และ `Edge` → `Camera` → `AI model` (R4); ต่อด้วย `Vision rule` → (tag ที่สั่ง PLC) ใน R5
- สร้าง graph ฝั่ง client จาก API ที่มี (`adminApi.devices`, `dsApi.sources`, `dsApi.tags`, `hierarchyApi.tree`, cameras/models API) ด้วย pure function `buildTopology()` (ทดสอบได้); ถ้าช้าเกิน 1.5 s ที่ 2,000 tags ค่อยเพิ่ม endpoint รวม `/sites/{site}/topology` (ระบุใน R4 เป็น task เงื่อนไข)
- Edge ที่ disabled/never-connected ยุบเป็น node รวม "ปิดใช้งาน (n)" — แก้ hairball; e2e ต้องลบ `cam-*` edge ที่สร้างเอง (R0)

### 9.2 Layout และภาพ
- Tidy layered layout ซ้าย→ขวา (คอลัมน์: Gateway · Source · Tag group · Equipment), เส้น orthogonal, group พับได้, mini-map เมื่อ node > 40
- Node แสดง health: gateway (heartbeat, clock sync, buffered, config applied vs pending), source (ok/error + detail), tag group (n tags, fresh/stale/bad), equipment (alarm count + priority)
- Edge แสดง link state: solid = ok, dashed = degraded/stale, แตก = error, + M7 packet ตาม msg rate; hover = latency/last message

### 9.3 การแก้ไข
- คลิก node → `Inspector` drawer: ฟอร์มของ entity นั้น (แก้ connection, **Test connection** ผ่าน `sources:test`, enable/disable, rotate key, ดู log)
- ปุ่ม "+" บน node (`AddNext`): Gateway "+" → data source / camera; Source "+" → tags (template Factory I/O, CSV import, OPC UA browse `OpcBrowser`, simulator); Equipment "+" → สร้าง device ใน line
- **ลาก tag group ไปวางบน equipment** = `POST /tags/move` (ยืนยันก่อน, แสดงจำนวน tag)
- Lens "Problems only": หรี่ทุกอย่างที่ปกติ (M5) เหลือ path ที่ผิดปกติ
- Address แสดงแบบอ่านได้ตาม protocol: Modbus `HR 40001 · int16 · ×0.1`, S7 `DB10.DBD4 · real`, OPC UA `ns=2;s=Belt.Speed`, sim `random walk 15–95 %` (ไม่แสดง JSON ดิบ; JSON อยู่ใน "Advanced")
- หน้า gateway detail จัดเป็น tab: Overview (health timeline, config versions) · Sources & tags (`DataTable` group ตาม device) · Cameras · Logs · Settings; แก้ tag ผ่าน drawer form + live preview

---

## 10. หน้าจอ SCADA เต็มรูปแบบ (เป้าหมายรายหน้า)

| หน้า | First viewport | Motion moment |
|---|---|---|
| **Overview L1** | KPI bento (state ของ plant ใช้คำ + shape ไม่ใช่แบนเนอร์แดง; batches, OEE, alarms by priority, AI decisions) · area tiles พร้อม mini mimic + state timeline 8 h · top 5 alarms · "Getting started" ย้ายเป็นการ์ดเล็กที่ซ่อนได้เมื่อครบ | M9 tile → L2 |
| **Live L2** | mimic เต็มพื้นที่ · alarm banner ล่าง · faceplate drawer ขวา · toolbar (layout mode, zoom, replay, problems lens) | M3, M4, M5, M13 |
| **Equipment L3** | faceplate ขยาย + trend 1 h/8 h + alarms + commands history + interlocks | M8 |
| **Alarms** | ISA-18.2 console: summary by priority, ตาราง (priority shape, เวลา, equipment, ข้อความ, state, age), ack / ack visible / shelve (มี backend) / comment; tab History, Journal (sequence of events), Quality (KPI: alarms/10 min ต่อ operator, flood, chattering, stale) | M2 |
| **Trends** | Grafana Explore-like: signal picker ตาม ISA-95 tree, stack ต่อหน่วย, annotations, compare ช่วงก่อนหน้า (เส้นเทา), table view, export | M8 |
| **Dashboards** | Datadog grid: group headers แบบเทาเรียบ (ไม่ใช่แถบสีอิ่ม), template variables ($area $line $equipment), time picker, widget ใหม่ทั้งชุด (§7) | M1, M10 |
| **Production** | OEE: A·P·Q BulletBar + loss waterfall; Stops: Pareto; Shifts; Batches (ticket table: target/actual/dev); Truck AI decisions; Reports; **Handover log** (ใหม่) | M1 |
| **Wall** | mimic ของ line ที่เลือก (หรือวน area ทุก 30 s) + alarm banner ใหญ่ + KPI 4 ช่อง font 64; อ่านจาก 4 m | M2, M4 |
| **Setup** | ISA-95 tree (มีแล้ว) ปรับเป็น `DataTable` tree + drawer; model & mapping (MapEditor เดิม + ขั้นตรวจ symbol); flow editor; tags; alarm rules | — |
| **Connectivity** | topology editor (§9) | M7, M12 |
| **Recipes / Sequences** | ตาม parity spec Phase 7 (ยังไม่มี backend) — R5 ออกแบบหน้าจอและ stub เมื่อ backend พร้อม | — |
| **Mobile** | alarm-first: summary + รายการ + ack; mimic แบบ list ของ equipment ที่ผิดปกติ | M2 |
| **Platform landing** | `/platform-tools` การ์ดรวมทุก feature เดิมพร้อมป้าย "demo data" ที่ยังเป็น demo | — |

Handover log ต้องมี backend ใหม่ (ตาราง `shift_notes`) — อยู่ใน R5 แผนแยก

---

## 11. Accessibility, i18n, performance
- WCAG 2.1 AA; สถานะ = สี + shape + ข้อความเสมอ; focus ring 2 px; ไม่มีข้อมูลที่อ่านได้ทาง tooltip ทางเดียว
- ทุก string มี TH/EN; Thai typography rules (§6.3); `scripts/check-i18n.mjs` ต้องผ่าน
- Performance: live update batch ต่อ animation frame; mimic 300 symbol pan/zoom 60 fps; bundle — `motion` โหลดกับ app shell (~35 KB gz) ยอมรับได้, three.js lazy เหมือนเดิม, `features/process` แยก chunk
- Reduced motion: ครอบด้วย `MotionConfig reducedMotion="user"` + CSS `@media (prefers-reduced-motion)` ของทุก keyframe

---

## 12. Roadmap (แต่ละ phase ส่งมอบซอฟต์แวร์ที่ใช้ได้)

| Phase | ส่งมอบ | Acceptance | แผน |
|---|---|---|---|
| **R0 Stabilize** | แก้ TimeChart mount, แยก sorting line ออกจาก batching drawing, Metrics skeleton, network map ไม่ full-mesh (ใช้ source_id จริง), เลิกแบนเนอร์แดงสำหรับ STOPPED, ล้าง `cam-*` test edges | Trends วาดกราฟ, screenshot ทุกหน้าไม่มีสถานะขัดกัน | r0-r1 |
| **R1 Foundations** | tokens light/dark + theme toggle, motion tokens + `motion`, component foundations, rail/topbar ใหม่ + redirects, ScopePicker, AlarmSummaryChip, `/dev/ui` | ทุก route เก่า redirect ถูก; UAT hooks ครบ; สลับ theme ไม่มีสีหลุด | r0-r1 |
| **R2 Data-viz** | Panel, StatTile, BulletBar, TimeSeries v2, StateTimeline, BarList, HeatStrip, palette ใหม่; Trends + Dashboard widgets + Overview ใช้ของใหม่ | validator ผ่านทั้ง 2 theme; anti-pattern checklist ผ่าน | r2 |
| **R3 SCADA mimic** | symbolize, connections/layout API, renderer v2, faceplate, flow editor, Live L2/L3, Wall ใหม่ | S1, S2, S3, S5, S7 ผ่าน; 60 fps ที่ 300 symbol | r3 |
| **R4 Topology** | buildTopology, TopoCanvas, inspector, AddNext, drag tag→equipment, gateway detail tabs, readable address | S4 ผ่าน ≤ 10 นาที | r4 |
| **R5 Pages** | Alarms console, Production (OEE/Pareto/batches/handover), Setup, Mobile, Recipes/Sequences screens | S6 ผ่าน | เขียนเมื่อ R4 เสร็จ |
| **R6 Platform & cleanup** | Platform group + landing, ลบ token/ component เก่า, ลบ `features/line` เดิม | ไม่มี import จาก `dd-theme` alias | เขียนเมื่อ R5 เสร็จ |
| **R7 Finish** | impeccable audit + finish review, a11y audit, perf audit, เขียน console `DESIGN.md` | detector clean, Lighthouse a11y ≥ 95 | — |

R0–R1 ต้องมาก่อนเพราะทุกอย่างใช้ token/primitive; R2 กับ R3 ทำขนานได้หลัง R1; R4 ใช้ Drawer/Inspector จาก R1

---

## 13. Testing strategy
- **bun:test** (pure logic): marching squares + RDP, port suggestion, auto-propose connections, flow layout, buildTopology, address formatter, deadband, motion reduced-mode selectors, redirect map, palette constants
- **pytest**: contract (`tests/contract`) สำหรับ route registration/validation ของ connections/layout; integration (`tests/integration/test_plant_models.py` ขยาย) สำหรับ PUT/GET; tenancy (`tests/tenancy`) สำหรับ RLS ของสองตารางใหม่
- **Playwright** (`tests/e2e/`): screenshot baseline หน้า Overview, Live, Trends, Connectivity ทั้ง light/dark ที่ 1440 และ 390; flow S2/S3/S4
- i18n check, `bun run build` (tsc) และ `oxlint` ทุก task

---

## 14. Risks
| ความเสี่ยง | ผลกระทบ | ลดอย่างไร |
|---|---|---|
| Silhouette จาก model CAD สกปรก (ชิ้นเล็ก, ภายในโปร่ง) | symbol ดูเละ | ε ปรับได้, เติมรูภายใน (hole fill), fallback ISA symbol, หน้าตรวจ symbol ใน mapping editor |
| Render 30+ part ตอนเปิดหน้าแรกช้า | first paint ช้า | ทำครั้งเดียว cache IndexedDB; ระหว่างรอแสดง fallback symbol แล้ว crossfade (M10) |
| Motion มากเกินใน control room | รบกวน operator | catalogue ตายตัว §6.6 + งบ 2 loop + setting "Calm motion" ต่อผู้ใช้ |
| Redirect พลาด → ลิงก์ใน notification/ack link เสีย | operator ไปผิดหน้า | ตาราง redirect มี test ครบทุก route เก่า; `/ack/:token` ไม่ย้าย |
| Theme dark ทำสีหลุดใน feature เก่าที่ hardcode hex | อ่านไม่ออก | R1 grep hex ใน TSX เป็น lint check (`scripts/check-hex.mjs`), ย้ายทีละ feature |
| Flow editor ถูกมองว่าเป็น "HMI editor" ที่เคยเป็น non-goal | scope creep | จำกัดเฉพาะ symbol จาก model + connection + medium; ไม่มีการวาดรูปอิสระ |

---

## 15. บันทึกการตัดสินใจ
**ของผู้ใช้:** ตาราง §0
**ของผู้ออกแบบ (ตรวจได้ แก้ได้):**
1. คง IBM Plex (Thai-matched + CSP) แทนเปลี่ยน font
2. Series palette 5 slot (เหตุผล validator §7.2)
3. `motion` แทน GSAP (React-native API, layout animation, เล็กกว่า)
4. Symbol cache ฝั่ง client (IndexedDB) ก่อน; server sidecar ค่อยทำถ้าจำเป็น
5. Topology graph สร้างฝั่ง client ก่อน; endpoint รวมเป็นเงื่อนไข
6. Sorting line ใช้ virtual parts + fallback symbol จนกว่าจะมี .glb ของมัน
7. Density เริ่มต้น: comfortable บน Plant, compact บน Engineering/Platform
8. Time picker อยู่ใน page header ของหน้า analytics ไม่ใช่ topbar
9. Gallery `/dev/ui` แทน Storybook (ไม่เพิ่ม dependency)
10. Recipes/Sequences และ Handover log ไปอยู่ R5 เพราะต้องมี backend ใหม่

## 16. เหลือให้ builder ตัดสิน
- ค่า ε ของ RDP และ threshold angle ของ EdgesGeometry ตามผลจริงของ centrale-beton.glb (เริ่ม 1.2 px / 35°)
- จำนวน particle ต่อเส้นและความเร็วฐาน (ภายในงบ CPU)
- ไอคอน lucide ที่ใช้ในแต่ละ nav item ใหม่
