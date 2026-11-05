# 01 — Scope & Requirements

## 1. Intent — ทำไมต้องมีระบบนี้

โรงงาน aggregate และปูนมีเครื่องจักรต่อเนื่อง (สายพาน เครื่องบด ตะแกรง ไซโล) ที่ PLC ควบคุมอยู่แล้ว
แต่ข้อมูลติดอยู่ในหน้าจอ HMI ใน control room: คนนอกห้องไม่เห็น ไม่มีประวัติย้อนหลังที่ค้นง่าย
ไม่มีภาพรวมข้ามไลน์/ข้ามไซต์ และงาน AI ใหม่ (กล้อง + YOLO วัดสัดส่วนกรวด/ทราย) ไม่มีที่แสดงผลร่วมกับ
สถานะเครื่อง Datadog แก้ปัญหานี้ให้ระบบ IT — **Plant Ops OS แก้ให้โรงงาน**: ข้อมูลเครื่องจักร + AI +
แอลาร์ม อยู่ในที่เดียว เปิดดูได้จากเบราว์เซอร์ทุกที่ และแยกข้อมูลต่อองค์กรอย่างปลอดภัย

**ความสำเร็จ (ผู้ใช้กำหนด):** ก่อน 20 ต.ค. ระบบ *ใช้งานได้จริงและ deploy แล้ว* รองรับผู้ใช้หลายบทบาท
ฟีเจอร์ที่ยังไม่เสร็จถูกซ่อนไว้ ไม่ใช่โชว์แล้วพัง

## 2. Goals / Non-goals / Anti-goals

| ประเภท | รายการ |
|---|---|
| **Goals** | (G1) เห็นสถานะเครื่องและค่าวัดสด ≤ 1 วินาที · (G2) แอลาร์มที่มีเจ้าของ (ack + ใครรับทราบ) · (G3) เห็นผล AI ข้างสถานะเครื่อง · (G4) dashboard ปรับแต่งได้เอง · (G5) เพิ่มอุปกรณ์ของลูกค้าได้เองผ่าน wizard · (G6) multi-tenant + RBAC + audit ระดับ enterprise · (G7) deploy ได้จริงบน VPS และย้ายไป AWS ได้ |
| **Non-goals (รอบนี้)** | แทนที่ PLC/HMI · control loop / safety interlock ในเว็บ · historian ระยะยาว (> 8 ชม. ใน hot table) · log management / APM / RUM แบบ Datadog · mobile app native · billing/ชำระเงินอัตโนมัติ · LINE OA |
| **Anti-goals (ถ้าเกิดถือว่าล้มเหลว แม้ระบบ "ทำงาน")** | ข้อมูลรั่วข้ามองค์กร · คำสั่งถึงเครื่องจริงโดยไม่ตั้งใจ · ค่าค้าง (stale) แสดงเหมือนค่าสด · แอลาร์มท่วมจน operator เลิกดู · หน้าที่ยังไม่เสร็จโผล่ให้ลูกค้าเห็นแล้วพัง · ใช้ asset ลิขสิทธิ์ของ Datadog (โลโก้/ไอคอน/ภาพ) ในของที่ส่งมอบ |

## 3. ผู้ใช้และบทบาท (persona → role)

อ้างอิง persona ฉบับเต็มใน [`../research/01-user-research.md`](../research/01-user-research.md) และ PRD ใน [`../research/04-product-strategy.md`](../research/04-product-strategy.md) §5.3

| Persona (คนจริง) | Role ในระบบ | หน้าแรกที่ควรเห็น | ทำได้ | ทำไม่ได้ |
|---|---|---|---|---|
| **Operator** (control room, ทั้งกะ) | `operator` | Overview สด + แอลาร์มที่ยังไม่รับทราบ | ack แอลาร์ม, สั่งงาน (เฉพาะไซต์ที่ `control_enabled` = simulator), ตั้ง downtime | แก้กฎแอลาร์ม, จัดการผู้ใช้/อุปกรณ์ |
| **ช่างซ่อมบำรุง** | `operator` | Infrastructure (อุปกรณ์ออฟไลน์/ผิดปกติ) | เหมือน operator + ดูประวัติแอลาร์มรายเครื่อง | เหมือน operator |
| **ผู้จัดการ** | `viewer` หรือ `admin` | Dashboards + SLOs | viewer: ดูอย่างเดียว · admin: + กฎแอลาร์ม, อุปกรณ์, ผู้ใช้ | viewer ไม่เห็นข้อมูลคำสั่งเลย (REST+WS) |
| **เจ้าของโรงงาน** | `owner` | Dashboards (KPI) | ทุกอย่างของ admin + ตั้ง owner/admin คนอื่น | — |
| **ผู้ดูแลแพลตฟอร์ม (เรา)** | ไม่มี role ในองค์กรลูกค้า | — | เปิดใช้งานลูกค้าใหม่ (`app.ops.bootstrap`), deploy, backup | อ่านข้อมูลลูกค้าผ่าน UI |

> **Gap ที่บันทึกไว้:** role ช่างซ่อมบำรุงยังใช้ `operator` ร่วมกัน — role แยก (`maintenance`) เป็น future
> เพราะต้องแก้ schema CHECK และ permission matrix (ดู 05 §9 roadmap)

## 4. Scope ตามช่วงเวลา (MoSCoW) + Feature flags

สถานะ: ✅ ใช้ข้อมูลจริงและทดสอบแล้ว · 🟡 ใช้ได้แต่มีข้อจำกัด · 🧪 ข้อมูลจำลอง · ⛔ ยังไม่มี

| ฟีเจอร์ | หน้า/route | MoSCoW (20 ต.ค.) | สถานะ | Flag | ข้อมูลมาจาก |
|---|---|---|---|---|---|
| Overview สด | `/` | **Must** | ✅ | on | REST + WS |
| ผังไลน์ 2D / 3D | `/line`, `/line3d` | **Must** / Should | ✅ | on | live store |
| Alarms + ack + timeline + density + grouping | `/alarms`, `/alarms/:id` | **Must** | ✅ | on | REST + WS |
| Trends | `/trends` | **Must** | ✅ | on | history API |
| Tags explorer | `/tags` | **Must** | ✅ | on | REST |
| Insights (AI แบบ rule-based) | `/insights` | **Must** | ✅ | on | `/api/insights` |
| Commands (simulator) | `/commands` | **Should** | ✅ | on (เฉพาะ `control_enabled`) | REST + WS |
| Dashboards ปรับแต่งได้ (widget editor, drag/resize) | `/dashboards` | **Must** | 🟡 เก็บใน localStorage (แชร์ข้ามเครื่องไม่ได้) | on | history API |
| SLOs | `/slos` | **Should** | 🟡 นิยาม SLO คงที่ในโค้ด | on | availability API |
| Infrastructure + Add device wizard + rotate/disable | `/infrastructure`, `/infrastructure/add` | **Must** | ✅ (ทดสอบ E2E กับ edge จริง) | on | edges API |
| System health | `/health` | **Must** | ✅ | on | health API |
| Admin (org, rules, users/invites, audit export) | `/admin*` | **Must** | ✅ | on | v2 admin API |
| Activity (journal) | `/activity` | Should | ✅ | on | WS journal |
| Sign-in (SSO + Google) | `/signin` | **Must** | 🟡 Google ยังไม่ทดสอบกับบัญชีจริง | Google on เมื่อตั้ง `GOOGLE_*` | Keycloak |
| Downtimes | `/downtimes` | Could | 🧪 ยังไม่ปิดเสียงแอลาร์มจริง | **off** | in-memory |
| Error Tracking | `/errors` | Won't (รอบนี้) | 🧪 | **off** | mock |
| Landing page สาธารณะ | `/` (ไม่ล็อกอิน) | Should | ✅ | on | — |
| เปิดใช้งานลูกค้า (org/site/owner) | CLI `app.ops.bootstrap` | **Must** | ✅ (ยังไม่ทดสอบ E2E ครบ) | — | DB |
| LINE OA, OPC UA/S7, AWS IoT Core, role maintenance, billing | — | Won't (รอบนี้) | ⛔ | — | — |

**กลไก flag (ต้องสร้าง — ดู 06):** `VITE_FEATURES` ตอน build (ค่าเริ่มต้นปิด `downtimes,errors`) ซ่อนทั้งเมนูและ route;
route ที่ปิดจะ redirect ไป `/` ไม่ใช่หน้า 404 แบบพัง

## 5. Functional requirements

ต่อยอด FR-1…FR-22 ใน PRD ([04 §5.4](../research/04-product-strategy.md)) — ตารางนี้เพิ่ม/ปรับเฉพาะที่ design นี้กำหนด

| ID | Requirement | Priority | Acceptance |
|---|---|---|---|
| FR-23 | **Device onboarding**: admin เพิ่มอุปกรณ์ผ่าน wizard 4 ขั้น ได้ MQTT key แสดงครั้งเดียว + `edge.env` + คำสั่ง docker, แล้วรอ heartbeat แรก | M | สร้างอุปกรณ์ → รัน edge-bridge ด้วยไฟล์ที่ได้ → wizard ขึ้น "connected" (ผ่านแล้ว 2026-10-15) |
| FR-24 | Rotate key / disable อุปกรณ์; disable ย้อนกลับไม่ได้ ต้องยืนยัน | M | key เดิมใช้ไม่ได้หลัง disable; UI มี confirm |
| FR-25 | **Plan limits** ต่อองค์กร (`organizations.plan_limits`: max_edges, max_tags, max_sites) บังคับฝั่ง server; UI อธิบายเมื่อเกิน | M | เพิ่มอุปกรณ์ตัวที่ 11 ได้ 403 `plan_limit_exceeded` + ข้อความเข้าใจได้ |
| FR-26 | **Custom dashboards**: เพิ่ม/แก้/ลบ/ลาก/ปรับขนาด widget (timeseries, query value, top list, alarm list, note) ตั้งค่า metric, aggregation, ช่วงเวลา, หน่วย, ทศนิยม, เกณฑ์ warn/crit, แกน Y, สีเส้น, legend, ขนาด | M | ทดสอบแล้ว; Should: ย้ายไปเก็บที่ backend เพื่อแชร์ |
| FR-27 | **Customer bootstrap**: CLI สร้าง org + site + owner (ผูกด้วย verified email) แบบ idempotent | M | รันซ้ำไม่สร้างซ้ำ ไม่ลด role |
| FR-28 | **Google sign-in** ผ่าน Keycloak broker; ผู้ใช้ใหม่ไม่มีสิทธิ์จนกว่าจะถูกเพิ่ม | S | `idps:["google"]` เมื่อตั้งค่า; role `none` เห็นหน้า "ไม่มีสิทธิ์" |
| FR-29 | **Feature flags** ซ่อนเมนู+route ที่ยังไม่พร้อม | M | build prod ไม่มีเมนู Downtimes/Errors |
| FR-30 | **AI status**: งาน vision ส่งผลเป็น tag (เช่น `vision.cam1.gravel_ratio`) และสถานะ heartbeat ของอุปกรณ์ที่รันโมเดล | M | เห็นค่าใน Overview/Trends และอุปกรณ์ในหน้า Infrastructure |

## 6. Enterprise-grade specification (NFR)

### 6.1 Reliability & performance

| หมวด | เป้าหมาย (รอบ VPS เดี่ยว) | หมายเหตุ |
|---|---|---|
| Availability | **99.5 %/เดือน** (≈ 3.6 ชม. downtime) | single host; ไม่มี HA — บอกลูกค้าตรง ๆ; 99.9 % ต้อง AWS L2 + multi-AZ |
| Latency tag → จอ | p95 ≤ 1 s ที่ cadence 1 s | NFR เดิมใน PRD |
| WS reconnect | ≤ 5 s พร้อมแสดงสถานะ Live/Reconnecting | มีแล้ว |
| RPO / RTO | **RPO ≤ 24 ชม.** (backup รายวัน) · **RTO ≤ 4 ชม.** (restore + DNS) | ลด RPO ได้ด้วย `BACKUP_INTERVAL_S` |
| Capacity (VPS 4 vCPU/8–16 GB) | ~10 อุปกรณ์/องค์กร, ~500 tag, 1 Hz, ~50 ผู้ใช้พร้อมกัน | ตาม `plan_limits` ค่าเริ่มต้น; ต้อง load test ยืนยัน (05 §4) |
| Data retention | `tag_history` 8 ชม. ตามการออกแบบ **แต่ยังไม่มี prune job** | งานค้าง (06) ก่อนใช้งานยาว |

### 6.2 Security

| Control | สถานะ |
|---|---|
| Authentication: OIDC PKCE ผ่าน Keycloak, token เก็บใน memory เท่านั้น, Google broker | ✅ |
| MFA | Keycloak รองรับ (OTP/WebAuthn) — เปิดเป็น required action ต่อ realm ได้ทันที | ⚙️ ตั้งค่า |
| Authorization: RBAC owner/admin/operator/viewer, ตรวจฝั่ง server ทุก endpoint + WS | ✅ |
| Tenant isolation: Postgres RLS ทุกตาราง tenant + composite FK `(org_id, …)` | ✅ |
| Audit: `audit_log` แบบ hash chain (`prev_hash`/`hash`) + export CSV | ✅ |
| Transport: HTTPS (Traefik/Let's Encrypt), MQTT TLS 8883 + cert SAN ชื่อสาธารณะ | ✅ |
| Device identity: MQTT key ต่ออุปกรณ์ (dynsec ACL ต่อ topic `v2/{org}/{site}/{edge}`) แสดงครั้งเดียว เก็บแค่ fingerprint | ✅ |
| Secrets: mount เป็นไฟล์ ไม่อยู่ใน env/`docker inspect`; prod ปฏิเสธการ start ถ้ายังเป็นค่า dev | ✅ (ยกเว้น `GOOGLE_CLIENT_SECRET` ยังเป็น env — งานค้าง) |
| Rate limits: คำสั่ง 5/10 s ต่อ tag, mutation 60/นาที/ผู้ใช้, WS 20/IP | ✅ (+ real-IP หลัง proxy แก้แล้ว) |
| Headers: CSP, X-Frame-Options, nosniff, Referrer-Policy | ✅ |
| Keycloak admin/master realm ไม่เปิดผ่านโดเมนสาธารณะ | ✅ ทดสอบแล้ว |
| Dev token (`demo-*`) ใช้ไม่ได้ใน prod | ✅ ทดสอบแล้ว (401) |

### 6.3 Compliance & data

- **PDPA (ไทย):** ข้อมูลส่วนบุคคลที่เก็บ = อีเมล ชื่อที่แสดง และ audit การกระทำ → ต้องมี privacy notice
  บนหน้า sign-in/landing, ช่องทางขอลบ/แก้ข้อมูล และ data processing agreement กับลูกค้า (งานเอกสาร ไม่ใช่โค้ด)
- **ข้อมูลโรงงาน** เป็นของลูกค้า: backup เข้ารหัสระหว่างส่ง (HTTPS ไป S3); ที่ปลายทาง ใช้ bucket ส่วนตัว
- **ลิขสิทธิ์:** asset ใน `ref/datadog/` ใช้อ้างอิงเท่านั้น — ไอคอน druids ใน `shared/ui/ddicons.ts` ต้องเปลี่ยนเป็น lucide ก่อนขาย (งานค้าง 06)

### 6.4 Usability, accessibility, i18n

- WCAG 2.1 AA: contrast ≥ 4.5:1, focus-visible, label ทุกช่อง, สถานะใช้สี + รูป + ข้อความ (ISA-101)
- ภาษาไทย/อังกฤษ ครบทุกข้อความ (มีการตรวจ key ซ้ำผ่าน typecheck)
- Responsive: desktop control room หลัก, ใช้บนมือถือ 375 px ได้ (หน้า sign-in ทดสอบแล้ว)

## 7. Notifications

| ช่องทาง | รอบนี้ | อนาคต |
|---|---|---|
| ในเว็บ: แถบแอลาร์มวิกฤต, กระดิ่ง, Activity | ✅ | — |
| อีเมลจาก uptime probe ภายนอก (ระบบล่ม) | ✅ ตั้งค่าตอน deploy | — |
| LINE OA (แอลาร์มวิกฤต / ระบบล่ม) | — | Phase ถัดไป |

## 8. Success metrics

| Metric | เป้า |
|---|---|
| ลูกค้าใหม่: จาก bootstrap ถึงเห็นค่าแรกบนจอ | < 30 นาที |
| tag → จอ p95 | ≤ 1 s |
| แอลาร์มวิกฤต → ack (มัธยฐาน, กะที่มีคนเฝ้า) | < 2 นาที |
| Console error / HTTP ≥ 400 ใน UAT | 0 |
| Uptime เดือนแรก | ≥ 99.5 % |
| Backup สำเร็จติดต่อกัน + restore drill | 7/7 วัน + drill ผ่าน 1 ครั้ง |
