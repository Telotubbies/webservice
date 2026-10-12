# 07 — UI Design System (Datadog density × Mitsubishi HMI)

## 1. ปรัชญาการออกแบบ

| Datadog (borrow) | Mitsubishi HMI (borrow) |
|---|---|
| Dense information layout | Industrial color semantics (ไม่ใช่สีสุ่ม) |
| Right panel inspector | Chunky, click-friendly targets |
| Metric/KPI strip | Mimic/P&ID central view |
| Dark theme ค่าเริ่มต้น | Status color coding (green/amber/red/gray) |
| Consistent table & filter | Big value display + unit |
| Alarm severity badge | Mechanical mimic symbols |

**สรุป**: หน้าตา Datadog (dark, dense, dashboard grid) + สัญลักษณ์และสี HMI (semantic colors + mimic layout)

### 1.1 Standards grounding (ทำไมออกแบบแบบนี้ — อ้างอิงจริง)

| หลักการที่ยืม | แหล่ง | นำมาใช้ตรงไหน |
|---|---|---|
| Background ต้อง neutral/unsaturated เพื่อให้ข้อมูลเด่น | **ANSI/ISA-101.01-2015** (HMI for Process Automation) | surface tokens `#0b0e14/#151a21` — สีเข้มกลางๆ ไม่ใช่ gradient จัด |
| สี alarm "reserved" — ห้ามเอาแดง/เหลืองไปใช้กับอย่างอื่น | ISA-101 + **ISA-18.2** (alarm management) | `--status-critical/warning` ใช้เฉพาะ alarm; accent ใช้ orange/cyan แยก |
| Redundant coding: สี + shape + text เสมอ | ISA-101 (color-blind safe) | `StatusDot` + label + icon; `AlarmBadge` มี text นับ |
| ข้อมูลสำคัญสุดอยู่บนสุด + scanning pattern | ISA-101 display hierarchy (L1 overview → L4 detail) | Overview = KPI strip บนสุด → mimic → detail panel |
| Alarm popup โปร่งไม่บังหน้า, acknowledgment | **Mitsubishi GT Designer3** pattern | แนว alarm banner ใน mimic + ack button |
| Goal-driven widgets, grouped, high-density, template vars | **Datadog** "Effective Dashboards" | dashboard grid + inspector panel + filter bar |

> เหตุผลเชิงธุรกิจ: ISA-101 มีอยู่เพื่อลด operator error จาก "สีเกิน/ข้อมูลรก" —
> ต้นเหตุอุบัติเหตุจริงในอุตสาหกรรม; Datadog เป็นต้นแบบสำหรับ "เห็นภาพรวมโดยไม่ scroll"
> เราเอาทั้งคู่: ความปลอดภัยของ HMI + ความหนาแน่นของ observability platform

## 2. Design Tokens

### Color

```css
/* semantic — HMI convention */
--status-running:   #22c55e;  /* green  — equipment running/normal */
--status-warning:   #eab308;  /* amber — warning/pre-alarm */
--status-critical:  #ef4444;  /* red   — alarm active/fault */
--status-stale:     #64748b;  /* gray  — no data/stale */
--status-standby:   #3b82f6;  /* blue  — stopped ready / manual mode */
--status-unknown:   #a855f7;  /* purple — not commissioned */

/* surface — Datadog-like dark */
--bg-app:     #0b0e14;
--bg-panel:   #151a21;
--bg-raised:  #1d242e;
--border:     #2a3340;

/* text */
--text-primary:   #e5e7eb;
--text-secondary: #9ca3af;
--text-muted:     #6b7280;
--text-inverse:   #0b0e14;

/* accent */
--accent:    #f97316;  /* orange — brand/highlight (Mitsubishi-ish) */
--accent-2:  #06b6d4;  /* cyan — links/selected */
```

### Typography

> **หลัก**: dashboard นี้คือ HMI — operator อ่านจากระยะ ~1m บนจอ 1080p และ
> อาจใช้มือเปื้อน/ถุงมือบนจอ touch ขนาดตัวหนังสือต้องตั้งจาก "ระยะอ่าน"
> ไม่ใช่ "ความหนาแน่นที่อยากได้" — ถ้าต้องแน่นกว่านี้ ให้ตัด widget ไม่ตัด font
>
> อ้างอิง ISA-101 style guidance: labels ~10–12pt (≈13–16px), process values
> ~14–16pt (≈19–21px) ที่ระยะอ่านปกติ — ตัวเลขด้านล่างกำหนดเป็น px สำหรับ web

#### Type scale (px, base 16)

| Token | Element | Font | Size | Weight | เหตุผล |
|---|---|---|---|---|---|
| `--text-display` | KPI value หน้า Overview / mimic readout | Roboto Mono | **28–40** | 500 | อ่านจาก 2–3m ต้องเห็นทันที |
| `--text-value` | process value บน mimic / card | Roboto Mono | **19–24** | 500 | ISA-101 value floor ≈14–16pt |
| `--text-lg` | heading section | Inter | 18–20 | 600 | |
| `--text-md` | panel title / button label | Inter | 15–16 | 500 | touch label ต้อง ≥15 |
| `--text-body` | UI body, table cell | Inter | **15** | 400 | floor สำหรับ operator content — ไม่ต่ำกว่านี้ |
| `--text-label` | mimic label, axis label, meta | Roboto Mono/Inter | **14** | 400 | floor สำหรับ secondary info — ต่ำกว่านี้ห้ามใช้กับข้อมูลที่ต้องอ่าน |
| `--text-caption` | timestamp, unit, footnote | Inter | 12–13 | 400 | เฉพาะ meta ที่ไม่ต้องตัดสินใจ — ห้ามใส่ค่า process หรือ alarm |

#### กฎ typography (เข้มงวด)

- **Numeric ทุกตัว** ใช้ `font-variant-numeric: tabular-nums` (หรือ mono font)
  — ค่ากระโดดทุก 200ms ต้องไม่ทำให้ layout กระตุก
- **Unit** แสดงเสมอข้าง value ที่ขนาด `--text-caption`, สี `--text-dim`
- **Alarm text** ต้อง ≥ `--text-body` (15px) เสมอ — alarm banner ใช้ `--text-md` + bold
- **Line height**: body 1.4, value/mono 1.1 (กราฟแน่น), label 1.2
- **Touch target**: interactive element ≥ **44×44px** (WCAG), control button บน
  mimic ≥ **48px** (GOT-style); ระยะห่างปุ่ม destructive จากปุ่มอื่น ≥ 8px
- **Truncate ห้ามกับ value/alarm** — tag name ยาว truncate ได้ (`…` + tooltip)
  แต่ค่า, severity, ปุ่มยืนยันห้ามตัด
- **Zoom 200%** (browser zoom) ต้องไม่พัง layout — test ใน E2E
- Dark theme contrast: body text ≥ 4.5:1, value ≥ 4.5:1, dim text ≥ 3:1 (WCAG AA)

### Spacing

`--space-unit: 4px` — dense grid (8, 12, 16, 24px typical)

### Components (สำคัญ)

| Component | Spec |
|---|---|
| `KpiStrip` | value + unit + sparkline + delta |
| `StatusDot` | 8px circle, semantic color, pulse ตอน active |
| `AlarmBadge` | pill + severity color + count |
| `TagCard` | name + live value + quality icon + mini trend |
| `MimicNode` | SVG wrapper — bind tag → animate (spin, color, position) |
| `CommandButton` | 2-step: click → confirm dialog (danger style ถ้า destructive) |
| `TrendChart` | **uPlot** line/area + zoom brush + compare (ADR-11 — browser-side backpressure) |
| `AlarmList` | table + severity filter + ack button + timestamp |

## 3. Page Layout

```
┌──────────────────────────────────────────────────────────────┐
│ Topbar: logo | site selector | alarm bell (count) | user     │
├──────────┬───────────────────────────────────────────────────┤
│ Sidebar  │  Page content                                     │
│ ─Overview│                                                   │
│ ─Mimic   │                                                   │
│ ─Trends  │                                                   │
│ ─Alarms  │                                                   │
│ ─Tags    │                                                   │
│ ─Health  │                                                   │
│ ─Admin   │                                                   │
└──────────┴───────────────────────────────────────────────────┘
```

### หน้า Overview (`/`)
- KPI strip: Throughput (t/h), Uptime %, Active Alarms count, Quality ratio
- Equipment status cards (per device): name, running/stopped, speed, last event
- Mini trend row: 3–4 key metrics 6h
- Recent alarms list (5 ล่าสุด)

### หน้า Mimic (`/mimic`) — สำคัญสุด
- SVG layout ของสายการผลิต (conveyor, sensor, diverter, camera)
- แต่ละ element bind tag → animate (belt run = ลูกศรไหล, motor = สีเขียว/แดง)
- Click element → side panel แสดง tags ของ device นั้น + control (ถ้า login)
- Hover → tooltip: tag + value + quality

### หน้า Trends (`/trends`)
- Tag picker (multi-select, searchable)
- Time range: 15m / 1h / 6h / 24h / custom
- Resolution toggle: raw / 1min / 5min
- Export CSV, PNG
- Compare mode: overlay 2 range

### หน้า Alarms (`/alarms`)
- Tab: Active / Acked / Cleared / All
- Filter: severity, tag/line, time range
- Row: severity icon, rule name, tag, raised time, duration, ack button (operator)

### หน้า Tag Explorer (`/tags`)
- Table: name, adapter, value, quality, unit, writable badge, stale indicator
- Filter by adapter/writable/search
- Click → drill detail + history mini chart

### หน้า System Health (`/health`)
- Service cards: edge-bridge, vision, backend, iot-core, db — status + uptime
- MQTT topic stats, message rate, buffer depth บน edge

### หน้า Admin (`/admin`, auth)
- Tag registry CRUD, alarm rules CRUD, adapter config, user list, audit viewer

## 4. Behavior Rules

- **Live indicator**: ทุกหน้ามี "LIVE" badge เขียวกะพริบเมื่อ WS connected; แดงเมื่อ disconnected + auto-reconnect status
- **Stale data**: tag ไม่ update >15s → ค่าแสดง + เครื่องหมาย "STALE" สีเทา (ไม่ใช่ค่าจริง)
- **Quality**: แสดง icon ข้างค่าเสมอ: ✓ good, ⚠ uncertain, ✗ bad
- **Command button**: ปุ่มสั่ง (start/stop) ต้อง 2-step: กด → dialog ยืนยัน + แสดง consequence; ปุ่ม destructive = สีแดง + ต้องพิมพ์ยืนยันถ้าอันตราย
- **Sound**: toggle ใน topbar — alarm critical มีเสียง (optional, default off)
- **Alarm flood**: ถ้า active alarms >10 ใน 5 นาที → banner "ALARM FLOOD — N active" + auto-group by rule (ISA-18.2 target ≈6 alarms/hr; ถ้าระบบสร้าง alarm เกินนี้ต่อเนื่อง = rule design ผิด ไม่ใช่ operator ช้า)
- **Reduced motion**: `@media (prefers-reduced-motion)` → ปิด animation ทั้งหมด (belt flow, blink) แต่ **สถานะสี/สัญลักษณ์ยังครบ**; alarm blink ใช้ ≤2Hz เสมอ (กัน photosensitive risk — WCAG 2.3.1 ห้าม flash >3 ครั้ง/วิ)

## 5. Visual References ที่ใช้ออกแบบ

- **Datadog** dashboard (layout density, KPI strip, right-panel inspector)
- **Mitsubishi GOT2000** HMI screen (mimic layout, status color semantics, chunky touch targets)
- **Factory I/O** scene view (เป็น inspiration ของ mimic layout จริงที่จะวาด)

## 6. Assets ที่ต้องวาด (สำหรับ Mimic)

SVG components:
- Conveyor belt (animated dashes)
- Motor (circle + rotation)
- Photo sensor (beam + state)
- Diverter/gate (rotate arm)
- Camera (overlay vision metrics)
- Hopper/bin (fill level)
- Alarm beacon (blink เมื่อ active)

ใช้ SVG + CSS animation bind กับ tag — ไม่ต้องใช้ภาพ bitmap

## 7. Responsive & Display Contexts

> หลักคิด: หน้าจอหลักของระบบนี้คือ **operator workstation 1080p+** —
> ไม่ใช่มือถือ. ออกแบบ desktop-first, degrade อย่างมีวินัย, และ
> **ยอมรับว่ามีจอที่เล็กเกิน** (ห้ามบีบจนอ่านไม่ได้ — แสดง "screen too small" แทน)

### Viewport classes

| Class | Width | อุปกรณ์เป้าหมาย | โหมด |
|---|---|---|---|
| `xl` | ≥1536px | operator workstation, wallboard | เต็ม: sidebar + grid 4 col + inspector |
| `lg` | 1280–1535px | laptop/monitor ทั่วไป | เต็ม: sidebar ยุบ icon, grid 3 col |
| `md` | 1024–1279px | laptop เก่า, panel PC | grid 2 col, inspector = overlay drawer |
| `sm` | 768–1023px | tablet landscape | read + ack alarm; **command ต้องผ่าน confirm เหมือนเดิม** |
| `xs` | <768px | phone | **read-only เสมอ** — ซ่อน control ทั้งหมด (safety: ไม่สั่งเครื่องจากจอเล็กที่กดพลาดง่าย) |
| — | <480px | — | แสดง placeholder "เปิดบนจอใหญ่กว่า" — ห้าม render mimic |

### Per-component behavior

| Component | xl/lg | md | sm | xs |
|---|---|---|---|---|
| Sidebar | เต็ม / icon-only | overlay drawer | overlay drawer | bottom nav 3 ปุ่ม (Overview/Alarms/Trends) |
| KPI strip | 4–6 cards แถวเดียว | wrap 2 แถว | wrap | stack แนวตั้ง, ซ่อน sparkline |
| Mimic | SVG เต็ม + inspector ขวา | SVG + inspector overlay | SVG fit-width, inspector = bottom sheet | SVG fit-width, ไม่มี inspector (tap = tooltip เท่านั้น) |
| TrendChart | เต็ม | เต็ม | เต็ม (เคาะ touch zoom ง่าย) | เต็มความกว้าง, ความสูง 40vh |
| AlarmList | table เต็ม | table เต็ม | card list (stack) | card list, ปุ่ม ack ≥48px |
| Admin pages | เต็ม | เต็ม | **redirect → "ใช้ desktop"** | ไม่มี |

### กฎ responsive

- **Mimic ไม่ reflow** — SVG viewBox scale เสมอ (พิกัด device คงที่) แต่ font บน mimic
  มี `min-scale` — ถ้า scale ทำให้ label <14px effective → ซ่อน label เหลือ status dot
  (hover/tap ดูชื่อได้) แทนที่จะ render ตัวเล็กอ่านไม่ได้
- **Orientation**: tablet portrait = ใช้ layout `sm`; phone landscape (<768 สูง)
  = `xs` เหมือนเดิม
- **Density override**: URL param `?density=compact` ย้อนกลับไปใช้ scale เล็ก
  สำหรับ power user ที่นั่งใกล้จอ — แต่ floor `--text-body`/`--text-label`
  ยังบังคับอยู่
- **Wallboard mode** (`?kiosk`): xl เท่านั้น, ซ่อน interactive chrome,
  font +1 step ทุก token, auto-rotate หน้า overview/mimic/alarms

### Display environment (อุตสาหกรรม)

- รองรับ **จอ TN panel ราคาถูก** (contrast ต่ำ, viewing angle แคบ) → status ต้อง
  แยกด้วย shape/icon ด้วยเสมอ ไม่พึ่งสีล้วน (อยู่แล้วตาม ISA-101)
- รองรับ **สภาพแสงจ้า** → dark theme contrast ที่กำหนดข้างบนเป็น floor ไม่ใช่เป้า
- ถ้า deploy บน panel PC ความละเอียดต่ำ (1366×768 ที่พบบ่อยในโรงงาน) → `md`
  class ต้องใช้งานได้เต็ม ไม่ใช่แค่ "เปิดได้"
