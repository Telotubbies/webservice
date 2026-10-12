# 13 — Business Case & Decision Rationale

> เอกสารนี้ตอบ "ทำไม" ของทุกการตัดสินใจใหญ่ — ผูก requirement ↔ สถาปัตยกรรม ↔
> ต้นทุน ↔ ความเสี่ยง ด้วยตัวเลขและแหล่งอ้างอิงจริง ไม่ใช่ความรู้สึก

## 1. บริบท (ทำไมต้องมีระบบนี้)

โปรเจกต์นี้มีคุณค่า 3 ชั้นซ้อนกัน:

1. **งานวิจัย (thesis)** — Aggregate_Project เป็น CV pipeline (instance
   segmentation กรวด/ทราย) ที่ต้องการระบบแสดงผลและสาธิต end-to-end
   เพื่อเป็นหลักฐานว่าโมเดลทำงานใน pipeline อุตสาหกรรมจริง
2. **ระบบใช้งานจริง** — dashboard monitor + control สายการผลิต
   แม้ตอนนี้ขับด้วย Factory I/O (จำลอง) แต่สถาปัตยกรรมเดียวกันนี้
   ใช้กับ PLC จริงได้ทันทีโดยแก้แค่ config
3. **ทักษะ/portfolio** — ระบบนี้ครอบคลุม OT protocol, cloud IoT, real-time
   web, security — ซึ่งคือชุดทักษะ IIoT ครบวงจร

### เหตุผลเชิงตัวเลขว่า "monitoring" มีคุณค่าจริงในอุตสาหกรรม

| แหล่ง | ตัวเลข |
|---|---|
| Siemens True Cost of Downtime 2024 | downtime โรงงานใหญ่: **$36k/hr (FMCG) → $2.3M/hr (automotive)**; รวม ~11% ของรายได้บริษัทใหญ่ 500 แห่ง |
| ABB Value of Reliability 2023 (n=3,215) | median **~$125k/hr** ต่อเหตุขัดข้อง; 2 ใน 3 โรงงานมี outage อย่างน้อยเดือนละครั้ง |
| US DoE | predictive maintenance ลด downtime ~30–50% เทียบ run-to-failure |

> แม้โปรเจกต์นี้ไม่ได้กู้ downtime จริง (ยังเป็น simulation) — แต่ architecture,
> alarm lifecycle, OEE-ready data model ที่วางไว้คือสิ่งเดียวกันกับที่โรงงาน
> จ่ายเงินซื้อ ทำให้ demo/thesis มีน้ำหนัก เพราะพิสูจน์ pattern จริงได้

### 1.1 Users & Personas (ระบุให้ชัด — UI/UX ทุกการตัดสินใจอ้างถึงกลุ่มนี้)

| Persona | ความต้องการหลัก | ออกแบบให้ในเอกสาร |
|---|---|---|
| **Operator** (กะเวน, จอ HMI/touch) | เห็นสถานะไลน์ทันที, alarm เด้ง, สั่ง start/stop ปลอดภัย, ไม่ต้องอ่าน manual | mimic + alarm banner + 2-step confirm (07); typography ≥16px (ISA-101) |
| **Engineer/Supervisor** | drill down trend, เทียบช่วงเวลา, ตั้ง alarm rule, ดู audit | trend multi-tag + alarm rules CRUD + audit view (06) |
| **Management** (remote, มือถือ/แท็บเล็ต) | KPI summary, uptime, ไม่ต้อง login ซับซ้อน | overview page + responsive breakpoint (07) + anonymous read-only (08) |
| **ผู้พัฒนา/วิจัย (เราเอง)** | config-driven, reproducible, สาธิตได้ใน 5 นาที | IaC + docker-compose + sim mode (04, 10) |

### 1.2 Success Metrics (วัดว่า MVP "สำเร็จ" ยังไง — ไม่ใช่แค่รันได้)

| Metric | เป้าหมาย | วัดด้วย |
|---|---|---|
| End-to-end latency (sensor → จอ) | < 2s ที่ 100 tags/s | WS client timestamp diff |
| Command round-trip (กด → PLC/sim รับ) | < 5s รวม confirm | `commands` table timing fields |
| Data durability เมื่อเน็ตขาด | 0% data loss ≤ 8h store-and-forward | chaos test ใน 09 |
| Alarm visibility | alarm ใหม่เด้งบนจอ < 1s หลัง backend รับ | WS alarm event timing |
| Uptime dashboard | ≥ 99% ตอน demo | CloudWatch health check |
| **Business**: เวลา deploy ไซต์ใหม่ | clone config → รันได้ < 1 วัน | dry-run จริงใน Sprint 5 |

> ถ้า metric ไหนพลาด → ไม่ใช่ "ช้า" แต่คือ operator เชื่อถือระบบไม่ได้ —
> trust คือ product จริงของ dashboard อุตสาหกรรม

## 2. Build vs Buy — เหตุผลที่เลือก "build" (ตัวเลขจริง)

| ทางเลือก | ต้นทุนจริง | เหตุผลที่ไม่เลือก |
|---|---|---|
| **Ignition SCADA** (Inductive Automation) | license ~**$15,925 (Basic) / $24,370 (Pro)** จ่ายก้อนเดียว + server | ราคาเกิน scope thesis; เป็น platform ปิด — ไม่ได้เรียน/แสดง AWS + custom code ตามเป้าหมาย; mimic ดีแต่ Datadog-quality UX ต้องสร้างเองใน Perspective อยู่ดี |
| **AWS IoT SiteWise** + Managed Grafana | ingestion ~$0.30/ล้าน data points + storage + Grafana workspace; deployment ขนาดกลางเอกสารอ้าง **$5k–15k/เดือน**; latency 50–200ms; vendor lock-in สูง (model/asset ผูก SiteWise) | แพงกว่า requirement มาก (เรา 100 tags/s ≈ 8.6M pts/วัน); Grafana ทำ custom control panel + audit flow + mimic SVG แบบที่ต้องการไม่ได้; lock-in ทำให้สอน/ขยายยาก |
| **ThingsBoard CE/Cloud** | $0 (CE self-host) ถึง $39–499/เดือน | ได้ SCADA dashboard เร็วแต่: control 2 ทาง + audit + UNS tag model + vision integration ต้อง customize ลึก — สุดท้ายซับซ้อนกว่าเขียนเองและไม่ตรงแนว Mitsubishi/Datadog |
| **Node-RED** เป็น edge layer | free, low-code | เหมาะเป็น flow layer แต่ **ไม่ใช่ control layer ที่ deterministic**; register map + validation + security ยังต้องทำเอง; debugging flow เมื่อโตใหญ่ยากกว่าโค้ด; ใช้เป็น adapter ทางเลือกในอนาคตได้ |
| **✅ Build custom (เลือก)** | AWS **~$85–110/เดือน** (dev, รวม NAT+Redis ที่ estimate แรกลืม — ดู 10 §10) + เวลาพัฒนา | ตรง requirement ทุกข้อ (UNS model, 2-way control, audit, vision tags, custom UX); เป็นเจ้าของโค้ดทั้งหมด; สอดคล้องเป้าหมาย thesis + portfolio |

### ตัวเลขคิดเงินของตัวเอง (cost sensitivity)

- 100 tags/s ≈ **8.64M messages/วัน ≈ 260M/เดือน**
- IoT Core messaging ~$1/ล้าน msg → ~**$260/เดือน** ถ้า publish ทุก tag ทุกวินาที
- → เหตุผลที่ต้องมี **deadband/report-by-exception** (ส่งเฉพาะเมื่อเปลี่ยน
  เกิน threshold) + poll 1s แต่ publish เมื่อเปลี่ยน: ลดเหลือ ~10–30%
  ของ worst case → **$5–30/เดือน** ตามเอกสาร 10
- ถ้าอนาคต scale เป็น 10 ไลน์ × 500 tags → ประเมินใหม่ (อาจย้ายไป Greengrass
  stream manager หรือ batch publish)

## 3. เหตุผลรายการตัดสินใจ (map กับ ADR ใน 03)

| การตัดสินใจ | เหตุผลเทคนิค | เหตุผลธุรกิจ |
|---|---|---|
| **Protocol abstraction layer** | Siemens model ไม่รู้ → ผูกตัวกับ protocol เดียว = ทิ้งงานทั้งหมดเมื่อรู้รุ่น | ลด risk การเขียนซ้ำ; adapter interface = insurance policy ที่แทบฟรี |
| **AWS IoT Core** | managed MQTT, device cert, IAM, rules — ไม่ต้องดูแล broker | ไม่มี fixed cost; pay-per-message; ตรง requirement "deploy on AWS" |
| **TimescaleDB** (ไม่ใช่ InfluxDB/Timestream) | tag metadata + telemetry + alarms + audit อยู่ relational เดียวกัน → join ได้; benchmark: complex query ~40ms บน 250k rows; compression 10–20x | DB เดียวจบ — ไม่ต้องดูแล 2 paradigm; RDS managed = ไม่มีคนเฝ้า DB |
| **FastAPI + Python เดียวทั้งระบบ** | reuse Pydantic schema ข้าม edge/backend/vision; async รับ 100 tags/s เหลือ | โค้ด thesis เดิมเป็น Python ทั้งหมด — ไม่ต้องเรียนภาษาใหม่, คนเดียวดูแลได้ |
| **React SPA (Vite) ไม่ใช่ Next.js** | dashboard = internal tool, ไม่ต้อง SEO/SSR; real-time WS | host บน S3+CloudFront ~$1–5/เดือน vs ต้องมี server รัน SSR |
| **Modular monolith** | 1 dev, workload เล็ก | ไม่เสียเวลา ops microservices ก่อนจำเป็น; แยกได้เมื่อ scale ระเบิด (MQTT contract คั่นอยู่แล้ว) |
| **Modbus TCP เป็นตัวแรก** | Factory I/O เป็น Modbus TCP **server** ในตัว → เขียน client จบ; OPC ของ Factory I/O เป็น *client* → ต้องมี server แยก เพิ่ม complexity | เร็วสุดในการได้ demo end-to-end โดยไม่ซื้อ/ลง software เพิ่ม |
| **Quality flag เป็น first-class** | OT standard: ค่า bad/stale ต้องไม่แสดงเป็นค่าจริง (หลัก ISA-101) | ป้องกัน operator ตัดสินใจผิดจากข้อมูลตาย — ต้นเหตุอุบัติเหตุจริงในอุตสาหกรรม |
| **2-step confirm + audit ทุก command** | command ลง OT = write จริง | accountability + forensics; ตอบโจทย์ compliance/กฎหมายโรงงานเมื่อใช้จริง |
| **Store-and-forward 8 ชม.** | edge ขาดเน็ตไม่ควรเสียข้อมูล | durability = คุณค่าหลักของ historian; 8 ชม. เลือกจาก downtime เฉลี่ยต่อ incident |

## 4. Design rationale ระดับ UX (อ้างมาตรฐานจริง)

| การตัดสินใจ | อ้างอิง | เหตุผล |
|---|---|---|
| พื้นหลัง neutral/dark ไม่ใช้สีจัดทั่วไป | **ANSI/ISA-101.01-2015**: background ควร unsaturated/neutral เพื่อให้ข้อมูลเด่น; สีสำหรับ alarm ต้อง "reserved" ห้ามใช้กับอย่างอื่น | ลด cognitive load; alarm ต้องเด้งสายตาทันที |
| สีต้องไม่ใช่สัญญาณเดียว | ISA-101 + ISA-18.2: redundant coding (สี + shape + text) | color-blind operator ~8% ผู้ชายอ่านผิดถ้าใช้สีอย่างเดียว |
| Density สูง + grouped widgets | Datadog "Effective Dashboards" guidelines: goal-driven, widget grouping, template vars, high-density mode, aligned x-axes | operator ต้องเห็นภาพรวมโดยไม่ scroll |
| Alarm popup โปร่ง/ไม่บังหน้าหลัก | Mitsubishi GT Designer3 pattern: transparent alarm popup | ยังเห็น mimic ขณะ alarm |
| ปุ่มใหญ่ touch-friendly | GOT2000 ออกแบบสำหรับ touch panel โรงงาน | tablet/หน้าจอสัมผัสในอนาคต |

## 5. Risk Register (ธุรกิจ + เทคนิค)

| Risk | ผลกระทบ | โอกาส | Mitigation |
|---|---|---|---|
| Siemens model ไม่ตรงสมมติฐาน | เขียน adapter ใหม่ | สูง | ✅ abstraction layer แล้ว; เอกสาร 04 ระบุข้อมูลที่ต้องถามผู้ขาย/integrator |
| AWS bill ระเบิดจาก telemetry flood | ค่าใช้จ่ายเกินงบ | กลาง | deadband + budget alarm (doc 10); rule กรองที่ IoT Core |
| Command ผิดพลาดบน PLC จริง | เครื่องจักร/คนปลอดภัย | ต่ำแต่ร้ายแรง | writable allowlist + confirm + edge-side validation + audit; safety ระดับ PLC อยู่นอก scope นี้ (interlock ต้องอยู่ที่ PLC ไม่ใช่ cloud) |
| Vision model accuracy ต่ำบนวิดีโอจริง | tag เพี้ยน | กลาง | quality flag + confidence threshold; แยก vision tags จาก control path |
| Single dev / bus factor | งานหยุด | กลาง | SDLC docs ครบ + IaC + ADR — คนใหม่อ่านรู้เรื่อง |
| Scope creep (อยากได้ MES/ERP) | ไม่เสร็จ | สูง | MoSCoW "Won't (v1)" lock ไว้ใน 01 |

## 6. สิ่งที่ระบบนี้ยังไม่ใช่ (boundary ซื่อสัตย์)

- **ไม่ใช่ safety system** — interlock/SIL ต้องอยู่ที่ PLC/relay เสมอ;
  dashboard เป็นเพียง supervisory layer
- **ไม่ใช่ MES/ERP** — ไม่มี production order, inventory, genealogy
- **ไม่ใช่ historian ระดับ enterprise** — retention 7 วัน raw + 90 วัน
  1-min; ถ้าต้องเก็บปี เพิ่ม S3 export tier ได้โดยไม่เปลี่ยนสถาปัตยกรรม
  (S3 อยู่ใน stack แล้วสำหรับ vision snapshots — ดู 05)

## 7. Real-World Validation (ชุมชน/field practice → การตัดสินใจเรา)

> หลักฐานเต็มอยู่ในเอกสาร 14 (auditable research log) — ส่วนนี้คือสรุปเชิงธุรกิจว่า
> community ทำอะไรกันจริงและเราได้อะไรจากมัน

| Pattern ที่ industry ใช้จริง | หลักฐาน | เราทำตาม/ต่างอย่างไร |
|---|---|---|
| **Soft-PLC คั่นกลาง** (Factory I/O → OpenPLC → SCADA) เป็น lab topology มาตรฐาน | DEV.to DIY Smart Factory, adainese.it OT lab, GitHub `aiminhong/FactoryIO_TSC` | เพิ่ม Mode B ใน 04 §1.5 — ทำให้ claim "PLC owns interlock" เทสได้จริงโดยไม่ต้องมี PLC hardware; Mode A (ตรง Factory I/O) เก็บไว้ bring-up |
| **UNS + plain MQTT** เลือกมากกว่า Sparkplug B ใน deployment ขนาดเล็ก-กลาง | HiveMQ UNS cases (Mayker Foods), Corso Systems; HiveMQ เองแนะนำ convention ที่ UNS layer | validate ADR-09; เพิ่ม trigger ชัดเจนว่าเมื่อไหร่ควร bridge เป็น Sparkplug |
| **TimescaleDB > InfluxDB** สำหรับ IIoT ที่ต้อง join asset model | United Manufacturing Hub, migration case จริง | validate ADR-02 — "boring SQL" คือ feature ไม่ใช่ความจำเป็น |
| **Report-by-exception** เป็นเรื่องบังคับ ไม่ใช่ optimization | IoT Core pricing math + fleet case จริง | deadband อยู่ใน NFR + cost model (§2) แล้ว — ไม่ใช่ของแถม |
| **S7 integration มีจุดพังคาดเดาได้** (PUT/GET, optimized DB, rack/slot, port 102) | Siemens forum/PLCTalk consensus | checklist ใน 04 §7 + test ใน 09 §6.5 — เปลี่ยนจาก "unknown unknowns" เป็น known checklist |
| **WS client ต้องมี backpressure ฝั่ง browser** | uPlot benchmark (~10% CPU vs Chart.js ~40%), React+WS community patterns | client contract ใน 06 §4 (ring buffer + rAF flush + backoff+jitter) |

**Business takeaway**: ทุก pattern ข้างบนเป็น "บทเรียนที่คนอื่นจ่ายแพงแล้ว" — เรา adopt
ก่อนเจ็บเอง นี่คือเหตุผลที่ SDLC ชุดนี้หนักกว่า hobby project ปกติ แต่เบากว่า
enterprise RFP — เหมาะกับ thesis + production-lite deployment ที่จะเจอ environment จริง
