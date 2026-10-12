# Industrial Dashboard — 00 Overview & Context

> **SaaS revision (2026-10, design review rev 2):** scope is now **multi-tenant** (Organization → Site → Line), no billing. *Multi-tenant* moves out of the "Out-of-scope" list. The **public read-only** persona is removed: every human must log in. Auth is OIDC via Keycloak (ADR-12). See [CONTRACT.v2](../../CONTRACT.v2.md), [adr/](adr/), [16](16-command-safety-contract.md), [17](17-mqtt-security-contract.md), [18](18-release-recovery.md).

> เอกสารชุดนี้คือ design pack สำหรับระบบ **Industrial Monitoring & Control Dashboard**
> ที่วิ่งครอบโปรเจกต์ [Aggregate_Project](https://github.com/Telotubbies/Aggregate_Project)
> เดิม (instance segmentation gravel vs sand, YOLOv26n-seg) แล้วขยายเป็นระบบ
> monitor + control สายการผลิตจำลองบน Factory I/O โดยมีเส้นทางเปลี่ยนเป็น
> Siemens PLC จริงในอนาคต และ deploy บน AWS

---

## 1. ปัญหาที่แก้

- ไม่มีอุปกรณ์จริง → ใช้ **Factory I/O** เป็น digital twin ของสายการผลิต
- ต้องการ dashboard ระดับ enterprise: คุณภาพ UX ระดับ **Datadog**, หน้าตาแบบ
  **industrial HMI** (Mitsubishi GOT style)
- ต้อง **run โค้ด Aggregate_Project เดิม** (YOLO inference) เป็นส่วนหนึ่งของ pipeline
  ไม่ใช่แค่โชว์ข้อมูล GitHub
- ต้อง **สั่งควบคุมสองทาง** ได้ (เช่น start/stop conveyor, setpoint)
- ออกแบบให้สลับจาก simulator ไปเป็น Siemens PLC จริงได้โดยไม่แก้ core

## 2. วิสัยทัศน์

> "Web-based SCADA lite": ดูสายการผลิต aggregate sorting line แบบ real-time
> ได้ทุกที่ผ่าน browser — public เข้าดูได้ (read-only), operator login แล้ว
> สั่งเครื่องจริงผ่าน command channel ที่ audit ได้

## 3. Personas

| Persona | สิทธิ์ | ความต้องการหลัก |
|---|---|---|
| **Public viewer** | read-only, ไม่ต้อง login | ดูสถานะสายการผลิต, trend, alarm ที่เกิด |
| **Operator/Admin** | login → เห็นทุกอย่าง + สั่ง control | start/stop, เปลี่ยน setpoint, acknowledge alarm |
| **Developer (เจ้าของระบบ)** | full + config | ตั้ง tag mapping, alarm rules, deploy |

## 4. ขอบเขต (Scope)

### In-scope
- Edge bridge: คุยกับ Factory I/O (Modbus TCP เป็นตัวแรก), normalize เป็น tag model
- AWS cloud path: MQTT over TLS → IoT Core → backend → storage → dashboard
- Dashboard: overview, mimic/P&ID view, trends, alarms, tag explorer, control panel, admin
- YOLO vision service: รัน Aggregate_Project model วิเคราะห์เฟรม/วิดีโอ → publish ผลเป็น tag
- In-app alarm (raise/ack/clear), command audit trail
- IaC + CI/CD + env dev/staging/prod

### Out-of-scope (v1)
- Alarm notification ภายนอก (email/LINE/SMS) — ทำ phase 2
- Multi-tenant, billing
- Safety-critical control (interlock ที่ต้อง hard real-time) — ระบบนี้เป็น monitoring+
  supervisory เท่านั้น; safety interlock ต้องอยู่ใน PLC เสมอ (ดู 08-security)
- Mobile app

## 5. ข้อจำกัดเชิงเทคนิคที่ล็อกแล้ว (จากการตัดสินใจร่วมกัน)

| เรื่อง | ตัดสินใจ |
|---|---|
| Protocol integration | ทุกอย่างผ่าน **abstraction layer** — ห้าม code ใดพูดกับ Factory I/O โดยตรง |
| Cloud path | **Edge bridge + AWS IoT Core** (MQTT/TLS) — ห้ามเปิด OT endpoint สู่เน็ตตรงๆ |
| Direction | **สองทาง** — telemetry ขึ้น + command ลง |
| Frontend | **React + TypeScript custom** ทั้งหมด (ไม่ใช่ Grafana embed) |
| AWS tier | **Middle**: IoT Core + ECS + RDS; frontend บน S3+CloudFront |
| Users | **Public read-only + admin** (Cognito) |
| Data volume | เล็ก: **20–100 tags @ 1 Hz** |
| Alarm | **In-app เท่านั้น** |
| Factory I/O driver แรก | **Modbus TCP client** (Factory I/O เป็น server) — เหตุผลใน 04 |
| Siemens ในอนาคต | รุ่นไม่รู้ → adapter contract คุมทั้ง S7 protocol และ OPC UA |

## 6. ความเชื่อมโยงกับ Aggregate_Project

```
Aggregate_Project (YOLO26n-seg)
        │  inference: "gravel %, sand %, belt occupancy"
        ▼
vision-inference service ──MQTT──► IoT Core (tag: vision.*)
                                        │
Factory I/O (simulated line)            │
        │ Modbus TCP                    ▼
        ▼                        cloud backend ──► dashboard
edge-bridge ──MQTT──► IoT Core            ▲
        ▲                                 │
        └────── command ◄── backend ◄── operator
```

Dashboard แสดงสายการผลิตจำลอง + ผล vision บนจอเดียวกัน เช่น
"สายพานกำลังลำเลียง = true, %gravel เฉลี่ย 5 วิ = 62%, alarm: sand ratio > 40%"

## 7. คำจำกัดความ (Glossary)

| คำ | ความหมาย |
|---|---|
| **Tag** | จุดข้อมูลหนึ่งจุดในสายการผลิต (เช่น `line1.conveyor.running`) มี value + quality + timestamp |
| **Edge bridge** | service ที่รันบนเครื่องเดียวกับ Factory I/O (Windows PC) คุย protocol แล้วส่ง MQTT ขึ้น cloud |
| **Adapter/Connector** | implementation ของ protocol abstraction ต่อ protocol หนึ่งตัว (modbus, opcua, s7, vision) |
| **Mimic** | หน้าจอ HMI ที่วาด layout เครื่องจักรเป็น SVG/Canvas แล้ว bind tag |
| **UNS-style topic** | การตั้งชื่อ MQTT topic แบบ `site/area/line/device/signal` ตามแนว Unified Namespace (tag name ใน DB ใช้ `.` คั่น) |
| **Alarm** | เงื่อนไขบน tag ที่เปลี่ยนสถานะ active/ack/cleared |
| **Command** | คำสั่ง write จาก dashboard → PLC/sim ผ่าน lifecycle: issued→sent→ack→done/failed |

## 8. เอกสารประกอบชุดนี้

| ไฟล์ | เนื้อหา |
|---|---|
| `00-overview.md` | ไฟล์นี้ |
| `01-requirements.md` | FR/NFR + MoSCoW + acceptance criteria |
| `02-architecture.md` | C4 context/container, dataflow, deployment |
| `03-tech-stack.md` | ADR ทุกตัวเลือก + เหตุผลจาก research |
| `04-edge-bridge.md` | protocol abstraction spec + adapter contract |
| `05-data-model.md` | MQTT topics, payload schema, DB schema |
| `06-api-realtime.md` | REST + WebSocket contract, command lifecycle |
| `07-ui-design-system.md` | design tokens, หน้าเว็บ, component spec |
| `08-security.md` | authN/authZ, threat model, IEC 62443 mapping |
| `09-testing.md` | test pyramid + contract tests + load plan |
| `10-aws-deployment.md` | infra topology, CDK/Terraform, CI/CD, envs |
| `11-roadmap.md` | phase/milestone + exit criteria + risk |
| `12-aggregate-integration.md` | วิธีเอา YOLO pipeline เดิมเข้ามารัน |
| `13-business-case.md` | เหตุผลธุรกิจ/ต้นทุน/build-vs-buy/risk ของทุกการตัดสินใจ |
