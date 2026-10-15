# Plant Ops OS — Design Pack (Datadog for Factory)

> **สถานะ:** Draft รออนุมัติ · **วันที่:** 2026-10-15 · **เป้าหมายส่งมอบ:** go-live ก่อน 2026-10-20
> ต่อยอดจากงานวิจัยใน [`../research/`](../research/) (01 user · 02 product · 03 UX/UI · 04 strategy · 05 technical)
> และ design pack เดิมใน `SDLC/industrial-dashboard/` (ใน git, ADR-12/13/14, doc 16–18)

## ระบบนี้คืออะไร (หนึ่งย่อหน้า)

**Plant Ops OS** คือ "Datadog สำหรับโรงงาน" — web console แบบ multi-tenant SaaS ที่ให้คนในโรงงาน
aggregate/ปูน **เฝ้าดู** สถานะเครื่องจักร งาน AI (YOLO แยกกรวด/ทราย) และสัญญาณเตือนแบบ real-time
จากทุกที่ผ่านเบราว์เซอร์ ผู้ใช้หลักคือ **operator ใน control room**; เจ้าของ ผู้จัดการ และช่างซ่อมบำรุงใช้
มุมมองของตัวเอง การ **สั่งเครื่องจักร** (start/stop, setpoint) มีไว้แต่เปิดใช้กับ **Factory I/O / simulator**
ในรอบนี้เท่านั้น — การควบคุมจริงยังอยู่ที่ PLC/HMI ของโรงงาน

## สารบัญ

| # | เอกสาร | ตอบคำถาม |
|---|---|---|
| 01 | [Scope & Requirements](01-scope-requirements.md) | ทำอะไร/ไม่ทำอะไร, ใครใช้, ต้องเสร็จแค่ไหนวันที่ 20, enterprise spec (NFR, SLA, security) |
| 02 | [Architecture & Tech Stack](02-architecture.md) | ส่วนประกอบ, data flow, sequence หลัก, tech stack + เหตุผล, deployment 4 แบบ (VPS / AWS L1 / AWS L2 / Vercel) |
| 03 | [Data Model](03-data-model.md) | ERD 20 ตาราง (จาก DB จริง), tenancy/RLS, audit chain, retention |
| 04 | [UX/UI Design](04-ux-ui.md) | IA/เมนู, หน้าจอต่อบทบาท, design system, pattern, a11y/i18n, สถานะแต่ละหน้า |
| 05 | [SDLC, Quality & Operations](05-sdlc-operations.md) | กระบวนการ, environment, CI gate, test strategy, release/rollback, monitoring, backup/DR |
| 06 | [Go-live Plan (ถึง 20 ต.ค.)](06-go-live-plan.md) | งานรายวัน, bug ที่ค้าง, checklist ก่อนเปิด |

**Diagrams** ([`diagrams/`](diagrams/)):

- `architecture.drawio` — container view (แก้ไขได้ใน draw.io / VS Code extension)
- `erd.mmd` — ERD Mermaid สร้างจาก Postgres catalog จริง (20 ตาราง, 27 FK)
- `schema.sql` — `pg_dump -s` ของ schema ปัจจุบัน (หลักฐานต้นทางของ ERD)
- sequence / deployment / C4 context อยู่ใน 02 เป็น Mermaid

## การตัดสินใจหลัก (decision log)

| # | เรื่อง | ตัดสินใจ | ใครตัดสิน | อ้างอิง |
|---|---|---|---|---|
| D1 | ขอบเขตการควบคุม | ระบบ **monitor เป็นหลัก**; Commands เก็บไว้แต่ใช้กับ simulator เท่านั้น (`sites.control_enabled`) | ผู้ใช้ | 01 §2 |
| D2 | กลุ่มลูกค้าแรก | โรงงาน aggregate / ปูน | ผู้ใช้ | 01 §1 |
| D3 | ผู้ใช้ | operator (หลัก) + เจ้าของ + ผู้จัดการ + ช่างซ่อม | ผู้ใช้ | 01 §3 |
| D4 | เส้นตาย | ใช้งานได้จริง + deploy แล้วก่อน 20 ต.ค. ฟีเจอร์ยังไม่เสร็จซ่อนด้วย feature flag | ผู้ใช้ | 06 |
| D5 | Hosting หลัก | VPS (Hostinger, ≤ 1,000 บาท/เดือน) + Dokploy | ผู้ใช้ (งบ) / Claude (แนะนำ) | 02 §6 |
| D6 | ทางเลือก hosting สำรอง | เตรียม AWS ระดับ 1 (EC2+compose) และระดับ 2 (EC2+RDS) + frontend บน Vercel ได้ | ผู้ใช้ | 02 §6–7 |
| D7 | Backup | `pg_dump` รายวัน → S3 นอกเครื่อง (Garage หรือ Cloudflare R2 ในงบ) | Claude | 05 §6 |
| D8 | แจ้งเตือน | ในเว็บ (กระดิ่ง + แถบแอลาร์ม) + อีเมลจาก uptime probe; LINE OA เป็น future | ผู้ใช้ | 01 §7 |
| D9 | โมเดล AI | รันบนเครื่อง local (เป็น edge device) ส่งผลเป็น tag ผ่าน MQTT; HF Spaces เป็นทางเลือก | ผู้ใช้ / Claude | 02 §3 |
| D10 | Identity | Keycloak (OIDC PKCE) + Google broker (เปิดเมื่อตั้ง `GOOGLE_*`) | Claude (ตามคำขอ) | 02 §4 |
| D11 | ไม่ใช้ Supabase/Railway สำหรับ core | core เป็น realtime + RLS role เฉพาะ + LISTEN/NOTIFY → อยู่เครื่องเดียว | Claude | 02 §6 |
