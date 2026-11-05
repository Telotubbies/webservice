# 04 — UX/UI Design

> หลักฐาน/การวัดจาก Datadog: [`../research/03-ux-ui-research.md`](../research/03-ux-ui-research.md) และ `ref/datadog/live/COMPONENTS.md`
> หลักการ: **ลอกโครง ลอกความหนาแน่น ลอกพฤติกรรม — ไม่ลอก brand** (ไม่มีโลโก้/มาสคอต/ภาพ/ชื่อ Datadog ในของที่ส่งมอบ)

## 1. Design principles

1. **Console ไม่ใช่ฟอร์ม** — ทุกหน้าเป็น list/graph ที่กรองได้ (omnibar + facet + table) ตาม research 01 §4
2. **สถานะต้องซื่อสัตย์** — ค่าค้าง (stale/bad quality) ต้องดูต่างจากค่าสดเสมอ; ข้อมูลจำลองต้องมีป้ายบอก
3. **สีมีความหมาย (ISA-101)** — สีพื้นเรียบ; สีแดง/ส้ม **สงวนไว้สำหรับความผิดปกติ** และมีรูป + ข้อความเสมอ
4. **Pivot ไม่หลง** — จากแอลาร์ม → tag → trend → อุปกรณ์ ด้วยลิงก์ โดยเวลา/ตัวกรองอยู่ใน URL
5. **ทำลายต้องยืนยัน** — disable อุปกรณ์, ลบ dashboard, คำสั่งเครื่องจักร = confirm พร้อมบอกผล

## 2. Information architecture (เมนูจริง — `web/src/app/nav.ts`)

| กลุ่ม (rail) | รายการ | ผู้ใช้หลัก |
|---|---|---|
| **Dashboards** | Overview · Dashboards · Line view · 3D twin | ทุกคน |
| **Monitoring** | Alarms · Downtimes* · SLOs · Activity  (+ Alarm rules, + New rule) | operator, ช่าง |
| **Infrastructure** | Devices · System health  (+ Add device) | ช่าง, admin |
| **Metrics** | Trends · Tags | ช่าง, ผู้จัดการ |
| **Errors** | Error tracking* | (ซ่อนรอบนี้) |
| **Automation** | Commands | operator (simulator) |
| **Intelligence** | Insights (AI) | ทุกคน |
| **Admin** (operator+ เห็น, แก้ได้ admin/owner) | Organization · Alarm rules · Users · Audit · Settings | admin, owner |

\* ซ่อนด้วย feature flag ใน go-live (01 §4)

**Shell (วัดจาก Datadog):** rail มืด 160 px (หุบเป็นไอคอนได้) · topbar 36 px (ค้นหา Ctrl K, Live pill, กระดิ่ง, ผู้ใช้) ·
pagebar 44 px (ไอคอน + ชื่อ + แท็บ + action ขวา) · แถบแอลาร์มวิกฤตสีแดงใต้ topbar (ไม่ใช่ toast — ISA-18.2)

## 3. หน้าแรกตามบทบาท

| บทบาท | Landing | ทำไม |
|---|---|---|
| operator / ช่าง | `/` Overview (สถานะไลน์ + แอลาร์มที่ยังไม่ ack + insight) | งานหลักคือเฝ้าและตอบสนอง |
| viewer / ผู้จัดการ | `/` Overview → Dashboards | ดู KPI |
| admin / owner | `/` + ลิงก์ Infrastructure/Admin ใน rail | ดูแลอุปกรณ์/ผู้ใช้ |
| ไม่มีสิทธิ์ (role none) | หน้า sign-in โหมด "ไม่มีสิทธิ์ — ติดต่อผู้ดูแล" | ผู้ใช้ Google ใหม่ |

> ตัวเลือกในอนาคต: ตั้ง default dashboard ต่อ role (Should หลัง go-live)

## 4. Page inventory

| หน้า | Pattern | Datadog ที่อ้างอิง (capture) | สถานะ |
|---|---|---|---|
| Landing (สาธารณะ) | marketing hero + KPI สด | — | ✅ |
| Sign-in | การ์ดกลางจอแบบ Google: SSO หลัก · Google · (dev) token | `app-signin.png` | ✅ |
| Overview | KPI tiles + active alarms + insights | Dashboards / query value | ✅ |
| Dashboards list | preset lists + search + star + table | `live-dashboards.png` | ✅ |
| Dashboard canvas | 12-col grid, drag/resize, widget editor 4 ขั้น + preview | `dashboard-real.png`, widget editor | ✅ (localStorage) |
| Alarms | state tabs + omnibar `key:value` + density strip + group by + bulk ack | `live-monitors-list.png`, triggered | ✅ |
| Alarm detail | lifecycle stepper + live value + rule + transitions | `monitor-detail` | ✅ |
| Downtimes | facets + table + schedule dialog | `live-monitors-downtimes.png` | 🧪 off |
| SLOs | status tiles + facets + error budget bar | `live-slo.png` | ✅ |
| Infrastructure | status tiles + facets + table + rotate/disable | `live-infra.png` | ✅ |
| Add device wizard | stepper 4 ขั้น + secret reveal + snippets + poll | Datadog agent install flow | ✅ |
| Trends | tag picker + multi-series uPlot | metrics explorer | ✅ |
| Tags | registry table + latest value/quality | infra host list | ✅ |
| Insights | insight cards + evidence | Watchdog | ✅ |
| Commands | supervised command + lifecycle | Workflow automation | ✅ (sim) |
| Errors | facets + issue list + detail/stack | `live-error-tracking.png` | 🧪 off |
| Admin | in-content section nav + tables | org settings | ✅ |

## 5. Design system (tokens — `web/src/dd-theme.css`)

| Token | ค่า | ใช้กับ |
|---|---|---|
| ink / ink-68 / ink-46 / ink-35 | `rgb(28 43 52 / .98 · .68 · .46 · .35)` | ข้อความหลัก/รอง/จาง/placeholder |
| paper / subtle / line | `#fff` / `#f9fafb` / `#e2e5ed` | พื้น, แถวสลับ, เส้นบาง |
| rail | `#292e39` | rail + topbar |
| blue | `#006bc2` | ลิงก์, ปุ่มหลัก, focus ring |
| severity | critical `#d24f57` ▲ · warning `#f99d02` ◆ · info `#828ba4` ● | แอลาร์ม/insight เท่านั้น |
| ok / danger / caution | `--color-ok #1c9a67` · `--color-danger #b83d44` · `--color-caution #b5740a` (+ `-soft` พื้นอ่อน) | สถานะในตาราง/ปุ่มอันตราย — ห้ามใช้ hex ตรงใน TSX |
| ฟอนต์ | IBM Plex Sans / Sans Thai / Mono | ข้อความ / ไทย / ตัวเลข-โค้ด |
| ขนาด | 13 px หลัก (body/table), 11 px overline, 15 px หัวข้อหน้า; ขั้นต่ำ 11 px | ความหนาแน่นแบบ console |
| radius / spacing | 4–5 px; table row 36–48 px | |
| icons | lucide-react (ISC) ทั้งระบบผ่าน `<DdIcon name>` (`shared/ui/ddicons.ts`) — druids ถูกแทนแล้ว 15 ต.ค. | |
| motion | 120–300 ms; ปิดเมื่อ `prefers-reduced-motion` | |

**Data viz (ตาม dataviz skill):** หนึ่งกราฟหนึ่งหน่วย (ห้าม dual axis) · สีซีรีส์ตามลำดับคงที่ 6 สี ไม่วน ·
เกณฑ์ warn/crit เป็นเส้นประ + อยู่ใน legend · legend เสมอเมื่อ ≥ 2 ซีรีส์ · tooltip/crosshair ทุกกราฟเวลา

## 6. Reusable patterns (components)

| Pattern | ไฟล์ | กติกา |
|---|---|---|
| ProductHeader + FacetGroup | `shared/ui/Product.tsx` | ทุกหน้า explorer ใช้ตัวเดียวกัน; facet แสดงจำนวน |
| Omnibar `key:value` | alarms / errors / devices | token AND กัน; key ที่ไม่รู้จักกลายเป็น free text (ไม่ตัดผลเงียบ ๆ) |
| Status pill | `Status.tsx`, devices, SLO | สี + glyph + label เสมอ |
| Widget editor | `dashboards/WidgetEditor.tsx` | preview สด; validate ก่อน save; ขนาดตั้งด้วยคีย์บอร์ดได้ (ทางเลือกแทน drag — WCAG 2.5.7) |
| Wizard | `devices/AddDeviceWizard.tsx` | stepper มี `aria-current="step"`; ย้อนกลับได้ก่อนขั้นที่สร้างของจริง |
| SecretReveal | `devices/SecretReveal.tsx` | แสดงครั้งเดียว, ซ่อนเป็นค่าเริ่มต้น, ปุ่ม copy มี `aria-live` |
| Confirm (destructive) | `shared/ui/Confirm.tsx` | บอกผลที่ย้อนไม่ได้ในประโยคเดียว |
| Notice / Empty / Error / Skeleton | `shared/ui/Feedback.tsx` | ทุกหน้ามีครบ 4 สถานะ |

## 7. States ที่ทุกหน้าต้องมี

loading (skeleton) · empty (มีคำแนะนำขั้นต่อไป) · error (retry) · stale/offline (Live pill + แถบสถานะ) ·
no-permission (ซ่อน action, อธิบายสิทธิ์ที่ต้องมี) · demo-data (Notice สีฟ้าบอกว่าเป็นข้อมูลจำลอง)

## 8. Accessibility & i18n checklist

- [x] focus-visible ทุกปุ่ม/ลิงก์ · [x] label ผูกกับ input · [x] error ใต้ช่อง + `role="alert"` · [x] สถานะไม่ใช้สีอย่างเดียว
- [x] ไทย/อังกฤษครบ (ตรวจ key ซ้ำด้วย `tsc`) · [x] Thai line-break ใน rail
- [ ] audit ด้วย screen reader จริง (NVDA) — ยังไม่ทำ · [ ] contrast audit ทั้งระบบด้วยเครื่องมือ — ยังไม่ทำ
- [x] มือถือ 375 px สำหรับ sign-in · [ ] ทุกหน้าบนมือถือ — ยังไม่ตรวจครบ

## 9. Copyright rule (ข้อบังคับ)

`ref/datadog/SOURCES.md`: asset ของ Datadog "design reference only, do not ship" → ห้ามมีในของที่ส่งมอบ:
โลโก้, มาสคอต, ภาพประกอบ, ชื่อ, **sprite ไอคอน druids** (`shared/ui/ddicons.ts` — ต้องแทนด้วย lucide ก่อนขาย)
ที่อนุญาต: layout, ระยะห่าง, ความหนาแน่น, ลำดับข้อมูล, interaction pattern
