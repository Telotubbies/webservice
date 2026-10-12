# 01 — Requirements

> **SaaS revision:** FR-B7 (public read-only) and AC-2 are **replaced** with: *anonymous request → 401 on every human endpoint and WS (4401); users only see orgs they are members of (non-member → 404)*. New Must requirements: tenant isolation (ADR-13), revocation ≤5 s (ADR-12), command safety gates (doc 16), per-edge MQTT identity (doc 17), i18n TH/EN. FR-A6 status at baseline: **not met** (in-memory paho queue only) — fixed in phase 4.

## 1. Functional Requirements (FR)

### FR-A: Telemetry Ingestion
| ID | Requirement | Priority |
|---|---|---|
| FR-A1 | ระบบต้องรับ tag value จาก edge bridge ผ่าน MQTT (QoS 1) | Must |
| FR-A2 | tag payload ต้องมี `value`, `quality`, `timestamp` (ดู 05) | Must |
| FR-A3 | ระบบต้องจัดการ tag ที่ stale (ไม่ update เกิน N วิ) → แสดงสถานะ "dead" | Must |
| FR-A4 | รองรับ 100 tags @ 1Hz ต่อเนื่องโดยไม่สูญเสียข้อมูล | Must |
| FR-A5 | เก็บ raw telemetry อย่างน้อย 7 วัน + downsample เป็น 1-min average เก็บ 90 วัน | Should |
| FR-A6 | buffer บน edge เมื่อขาดเน็ต แล้ว flush เมื่อกลับมา (store-and-forward) | Must |

### FR-B: Dashboard & Visualization
| ID | Requirement | Priority |
|---|---|---|
| FR-B1 | หน้า Overview แสดง: KPI strip (OEE-ish, throughput, active alarms), สถานะเครื่อง, mini-trend | Must |
| FR-B2 | หน้า Mimic: SVG P&ID ของสายการผลิต bind tag แบบ live (เครื่องหมุน/หยุด, สีตามสถานะ) | Must |
| FR-B3 | หน้า Trends: เลือกหลาย tag พล็อตรวม, zoom/pan, compare ช่วงเวลา, export CSV | Must |
| FR-B4 | หน้า Alarms: list active/ack/จบแล้ว, filter ตาม severity/line | Must |
| FR-B5 | หน้า Tag Explorer: ตาราง tag ทั้งหมด พร้อม live value + quality badge | Must |
| FR-B6 | update แบบ real-time ผ่าน WebSocket, latency จาก broker → UI ≤ 2 วินาที | Must |
| FR-B7 | รองรับ public read-only mode (ไม่ต้อง login เห็นทุกหน้าที่ read) | Must |
| FR-B8 | responsive ตาม viewport classes ใน 07 §7 — desktop ≥1280 เต็ม, tablet ≥768 read+ack alarm, phone <768 **read-only เสมอ** (ไม่มีปุ่ม control) | Must |

### FR-C: Control (Write-back)
| ID | Requirement | Priority |
|---|---|---|
| FR-C1 | operator (login แล้ว) สั่ง write tag ได้จาก control panel | Must |
| FR-C2 | ทุก command ต้องผ่าน allowlist: เฉพาะ tag ที่ `writable=true` | Must |
| FR-C3 | command มี lifecycle ติดตามได้: `issued → sent → acked → done/failed(timeout)` | Must |
| FR-C4 | command ทุกครั้งบันทึก audit log: ใคร สั่งอะไร เมื่อไหร่ ผลลัพธ์ | Must |
| FR-C5 | command ต้องมี idempotency key + server-side dedup | Must |
| FR-C6 | การกระทำเสี่ยง (start/stop motor) ต้องมี confirm dialog + แสดงผลข้างเคียง | Must |
| FR-C7 | public viewer ต้องไม่เห็นปุ่ม control เลย (UI ระดับ render) | Must |

### FR-D: Alarms
| ID | Requirement | Priority |
|---|---|---|
| FR-D1 | นิยาม alarm rule บน tag: threshold (hi/hihi/lo/lolo), rate-of-change, stale | Must |
| FR-D2 | alarm lifecycle: `active → acked → cleared` + บันทึก transition | Must |
| FR-D3 | severity: `info / warning / critical` | Must |
| FR-D4 | alarm แจ้งใน app: banner + sound toggle + badge count | Must |
| FR-D5 | external notification (email/LINE) | Could — phase 2 |

### FR-E: Vision Integration (Aggregate_Project)
| ID | Requirement | Priority |
|---|---|---|
| FR-E1 | vision service รัน YOLO26n-seg จาก repo เดิมบน video stream/image batch | Must |
| FR-E2 | publish ผลเป็น tag: `vision.gravel_ratio`, `vision.sand_ratio`, `vision.object_count`, `vision.frame_fps` | Must |
| FR-E3 | เก็บ snapshot frame เมื่อมี alarm event ลง S3 แล้วลิงก์ใน alarm | Should |

### FR-F: Administration
| ID | Requirement | Priority |
|---|---|---|
| FR-F1 | หน้า admin: จัดการ tag registry (ชื่อ, unit, writable, alarm rules) | Must |
| FR-F2 | จัดการ adapter config (endpoint, poll rate) ผ่าน config file/UI | Should |
| FR-F3 | health/status ของทุก service ในหน้าเดียว (System Health) | Must |

## 2. Non-Functional Requirements (NFR)

| Category | Target |
|---|---|
| **Latency** | tag→UI ≤ 2s; command→edge ack ≤ 3s |
| **Throughput** | 100 tags/s sustained; burst 500/s สำหรับ 1 นาที |
| **Availability** | dashboard 99.5%; ระบบ ingest 99.9% (IoT Core SLA) |
| **Durability** | telemetry ไม่หายเมื่อ edge ขาดเน็ต ≤ 8 ชม. (local buffer) |
| **Security** | TLS ทุก path; X.509 device cert บน edge; least-privilege IAM; audit trail ทุก write |
| **Maintainability** | adapter ใหม่เพิ่มได้โดย implement interface เดียว ไม่แก้ core |
| **Observability** | structured log (JSON), metric ทุก service, trace command end-to-end |
| **Readability** | font/contrast/touch-target ตาม spec 07 — floor: body 15px, mimic label 14px, value ≥19px, touch ≥44px; WCAG AA contrast; zoom 200% ไม่พัง |
| **Time sync** | edge + backend + vision node NTP-synced, drift ≤2s; เกิน → health degraded + command TTL reject (04 §6) |
| **Cost** | AWS dev tier เป้า ~$85–110/เดือน (รวม NAT Gateway + Redis แล้ว — ดู breakdown ในเอกสาร 10; ต้องมี budget alarm) |
| **Portability** | ทุก service containerized; local dev = docker compose |

## 3. MoSCoW Summary

- **Must**: ingest, dashboard real-time, mimic, alarms in-app, control 2 ทางที่ audit ได้, vision tags, IaC deploy
- **Should**: downsample retention, CSV export, tag admin UI, alarm snapshot
- **Could**: email/LINE notify, OEE เต็มรูป, multi-line
- **Won't (v1)**: multi-tenant, mobile app, hard real-time control

## 4. Acceptance Criteria (ตัวอย่างสำคัญ)

- **AC-1**: เมื่อ edge bridge ขาดเน็ต 10 นาทีแล้วกลับมา → tag ใน 10 นาทีนั้นต้องขึ้น cloud ครบ timestamp เดิม
- **AC-2**: public visitor เปิด `/` เห็น dashboard แต่ไม่มีปุ่ม control และ POST /api/commands → 401
- **AC-3**: operator กด "Stop Conveyor" → ต้องผ่าน confirm → command ปรากฏใน audit log พร้อมผล ack จาก PLC ใน ≤ 5s
- **AC-4**: tag stale เกิน 15s → UI แสดง badge "STALE" อัตโนมัติ ไม่ต้อง refresh
- **AC-5**: `terraform apply` (หรือ CDK deploy) บน AWS account สะอาด → ระบบขึ้นครบและ dashboard เปิดได้
