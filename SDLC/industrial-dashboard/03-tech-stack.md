# 03 — Tech Stack Decisions (ADR)

## สรุป Stack ที่เลือก

| Layer | เลือก | ตัวสำรองที่พิจารณา |
|---|---|---|
| Frontend | React 18 + TypeScript + Vite + Tailwind + shadcn/ui | Next.js (overkill สำหรับ SPA dashboard), Vue |
| Charts | **ECharts** (หลัก) + uPlot (high-rate panels) | Recharts (ช้า), Highcharts (paid) |
| Mimic/SCADA view | SVG + React (custom render) | Three.js (overkill), FUXA (embedded ไม่ตรง) |
| Backend | **Python FastAPI** (async) | Node.js/NestJS, Go |
| Realtime | WebSocket (native FastAPI) + Redis pub/sub (ถ้า >1 replica) | SSE (one-way), Socket.IO (heavier) |
| Edge bridge | Python asyncio | Node.js |
| Vision | Ultralytics (โค้ดเดิมใน repo) + ONNX runtime | OpenVINO, TensorRT |
| MQTT | AWS IoT Core + `aws-iot-device-sdk-python-v2` | Mosquitto self-hosted |
| Time-series | **TimescaleDB** (RDS Postgres + extension) | InfluxDB, Timestream |
| Relational | PostgreSQL (RDS instance เดียวกัน) | DynamoDB |
| Auth | Cognito (hosted UI) + JWT | Auth0, self-rolled |
| IaC | **Terraform** | CDK (เลือกได้ถ้าชอบ TS) |
| CI/CD | GitHub Actions | CodePipeline |
| Frontend host | S3 + CloudFront | Amplify, ECS |
| Backend host | ECS Fargate | Lambda (ไม่เหมาะกับ long-lived WS/MQTT) |

---

## ADR-01: Backend = FastAPI (ไม่ใช่ Node.js)

**Context**: ต้อง ingest MQTT, serve REST+WS, รัน alarm engine, orchestrate command

**เช็คจาก research + real cases**:
- FactoryPulse (reference architecture): React + **FastAPI** + MQTT + InfluxDB + WS
- Node.js ชนะเรื่อง connection fan-out ดิบๆ แต่:
  - โค้ดเดิมใน repo เป็น Python ทั้งหมด (notebooks, YOLO, pandas)
  - alarm engine, OEE calc, vision glue เขียน Python ง่ายกว่า
  - 100 tags/s ไม่ใช่ปริมาณที่ต้องเลือกภาษาเพราะ throughput
- FastAPI+asyncpg+uvloop รับ 100 tags/s สบาย ๆ (รับได้หลักหมื่น/s บน modest box)

**Decision**: FastAPI (Python 3.12, asyncio)

**Consequence**: ถ้าวันหนึ่ง tag rate ระเบิด (>10k/s) → แยก ingest เป็น Node.js หรือ Go service โดยไม่กระทบ API (MQTT contract คั่นกลางอยู่แล้ว)

---

## ADR-02: Time-series = TimescaleDB (ไม่ใช่ InfluxDB/Timestream)

| ตัวเลือก | เหตุผลที่เลือก/ไม่เลือก |
|---|---|
| InfluxDB | เหนือกว่าใน pure-metrics scale ใหญ่มาก (write ~300k rec/s ระดับผลิตภัณฑ์) แต่ต้องดูแล 2 DB paradigm (Influx + Postgres) บน workload เล็กไม่คุ้ม; Flux query language แยกจาก SQL ที่ใช้อยู่แล้ว |
| AWS Timestream | serverless ดี แต่ query language แปลก, lock-in สูง, tooling น้อยกว่า |
| **TimescaleDB** | ✅ Postgres นั่นเอง — hypertable + continuous aggregate + compress (10–20x) + retention policy ในตัว; **join กับ relational table ได้** (tags/alarm_rules/commands/audit ↔ telemetry) ซึ่งคือ requirement จริงของระบบนี้; RDS รองรับ extension อยู่แล้ว; complex query ~40ms บน 250k rows เพียงพอสำหรับ dashboard |

**Decision**: RDS PostgreSQL + TimescaleDB extension — DB เดียวจบทั้ง time-series และ relational

**Business driver**: telemetry ของเราไม่ได้อยู่คนเดียว — ต้อง join กับ tags registry, alarms, commands, audit, user ตลอดเวลา → relational-native ชนะ; และ dev 1 คนไม่ควรดูแล 2 DB (ดู rationale เพิ่มในเอกสาร 13)

---

## ADR-03: Frontend = SPA (ไม่ใช่ Next.js SSR)

- Dashboard เป็น internal/monitoring tool — SEO ไม่สำคัญ
- Vite SPA บน S3+CloudFront ถูกกว่าและง่ายกว่า SSR server
- Real-time WS ไม่ต้องการ SSR เลย
- **แต่**: public read + operator login → ยังควบคุม route guard ฝั่ง client + JWT ฝั่ง API

---

## ADR-04: Charts = ECharts + uPlot

- ECharts: gauge, heatmap, stacked, scatter, candlestick-like → ครบทุก visualization ที่ HMI ต้องการ
- uPlot: 60fps streaming, canvas, tiny — ใช้กับหน้า Trend ที่ปล่อย live 1Hz+
- ไม่เอา Recharts เพราะ SVG re-render ช้าบน stream ความถี่สูง

---

## ADR-05: Modular monolith ก่อน microservices

- `backend` เป็น service เดียว แต่แยก module ชัด: `ingest/`, `alarms/`, `commands/`, `api/`, `ws/`
- เหตุ: 1 dev, workload เล็ก, ลด ops — แยกเมื่อจำเป็น (scaling boundary ชัดเพราะ MQTT+DB คั่น)

---

## ADR-06: Edge bridge = Python + asyncio

- `pymodbus` (Modbus TCP client) — mature, async support
- `asyncua` (OPC UA) — pure python, รองรับ subscribe
- `python-snap7` (S7) — Siemens S7-300/400/1200/1500 protocol ตรง
- `paho-mqtt` หรือ `awsiotsdk` สำหรับขึ้น cloud
- ภาษาเดียวกับ backend → reuse Pydantic schema ได้

**ทางเลือกที่ตัดทิ้ง — Node-RED**: เหมาะเป็น flow layer เร็วสำหรับ Modbus→MQTT แต่ไม่ deterministic (ไม่ใช่ control layer), register map/validation/security ต้องทำเองอยู่ดี, debug flow ใหญ่ยากกว่า code review ได้; เก็บไว้เป็นทางเลือกถ้าต้องการ visual flow สำหรับ demo — ไม่ใช่แกนหลัก

---

## ADR-07: Frontend host = S3 + CloudFront

- SPA static → ถูกสุด, เร็วสุด (CDN), HTTPS ฟรีผ่าน ACM
- Backend แยกที่ ALB/ECS บน subdomain `api.*`

---

## ADR-08: IaC = Terraform

- เหตุผล: industry standard, state file ชัด, module ecosystem ใหญ่
- ถ้าชอบ CDK (TS) ก็เปลี่ยนได้ — infra topology ในเอกสาร 10 เป็นแบบ service-agnostic

---

## ADR-09: MQTT payload = plain JSON บน UNS topics (ไม่ใช่ Sparkplug B) — จากเอกสาร 14 §3

**Context**: community testbed ที่นิยม (FUXA, Node-RED, UNS demos) ใช้ raw MQTT + JSON; Sparkplug B เป็นมาตรฐาน ISA/มี protobuf payload + session state (NBIRTH/NDEATH) + metric alias — แข็งแรงกว่าแต่ซับซ้อนกว่ามาก

| ตัวเลือก | เหตุผล |
|---|---|
| Sparkplug B | ✅ birth/death cert + state ในตัว, metric alias ประหยัด bandwidth, เหมาะ multi-vendor SCADA — แต่ ❌ ต้องมี sparkplug-aware client ทุกฝั่ง (edge decode protobuf, backend decode protobuf, dashboard ต้อง map alias→metric), debug ยาก (binary payload), dev 1 คนไม่คุ้ม |
| **Raw MQTT + JSON บน UNS topic** | ✅ อ่านด้วย mqttx/mosquitto_sub ได้ทันที, debug ง่าย, schema เป็น Pydantic model ที่ validate ข้าม backend/edge ได้ — เลือกตัวนี้ |

**Decision**: `site/area/line/device/signal` + JSON `{v,q,ts,src}` QoS1; quality/disconnect handling ทำเองผ่าน heartbeat + LWT (ครอบคลุม capability หลักที่ Sparkplug ให้: state tracking)

**Trigger เปลี่ยนใจ**: ถ้าอนาคตต้อง integrate กับ Ignition/third-party SCADA ที่พูด Sparkplug natively → เขียน bridge `uns/* ↔ spBv1.0/*` ที่ edge ได้โดยไม่เปลี่ยน core (topic namespace แยกกันอยู่แล้ว)

---

## ADR-10: MQTT version = 3.1.1 (baseline)

- AWS IoT Core รองรับทั้ง 3.1.1 และ 5 — เลือก **3.1.1** เป็น contract เพราะ: ครบทุก feature ที่ใช้ (QoS1, LWT, retained), ทุก client lib mature, ไม่มีส่วนไหนใน design ต้องการ MQTT 5 properties (reason codes / message expiry / shared subscription)
- LWT ใช้เป็น mechanism หลักของ edge "death" → ทุก tag ของ edge นั้น quality=BAD (ครอบคลุม Sparkplug NDEATH equivalent)
- ออกแบบ payload ไม่ผูกกับ MQTT version → upgrade เป็น 5 ทีหลังได้โดยไม่เปลี่ยน contract

---

## ADR-11: Realtime dashboard = uPlot (validated จาก community)

- Grafana/realtime community เจอบ่อย: Plotly/Recharts กระตุกบน live stream >1Hz เพราะ SVG/React re-render ทุก point
- **uPlot** = canvas + minimal DOM → 60fps streaming บนเครื่องธรรมดา, bundle เล็ก
- ECharts เก็บไว้เฉพาะหน้า non-streaming (gauge, heatmap, alarm summary) — ห้ามใช้กับ trend live
- **Client-side backpressure**: UI เก็บ ring buffer + flush ลง chart ด้วย `requestAnimationFrame` (รายละเอียดเอกสาร 06 §4) — กัน WS event ท่วม main thread

---

## ตารางเปรียบเทียบที่ทำ grilling แล้ว (สรุป)

| คำถาม | คำตอบสุดท้าย |
|---|---|
| ทำไมไม่ใช้ SiteWise + Managed Grafana เลย? | ต้องการ custom mimic + control + audit ที่ Grafana ทำไม่ได้; SiteWise ingestion แพงกว่า MQTT+Timescale บน workload เล็ก |
| ทำไมไม่ Lambda? | WebSocket + MQTT subscribe เป็น long-lived → Fargate เหมาะกว่า; Lambda ใช้เฉพาะ alarm evaluator (stateless) ถ้าจะแยก |
| ทำไมไม่ Kafka? | 100 tags/s ไม่จำเป็น; IoT Core = managed MQTT พอ |
| ทำไมไม่ Supabase/Firebase? | TimescaleDB extension + full SQL ต้องการ; self-managed บน RDS คุมได้มากกว่า |
| ทำไมไม่ซื้อ Ignition/SCADA เลย? | license ~$16k–24k ก้อนเดียว + ไม่ได้ custom UX/vision integration ตามเป้าหมาย; รายละเอียด build-vs-buy อยู่ในเอกสาร 13 |
| ทำไมไม่ Sparkplug B? | protobuf + birth/death session ซับซ้อนเกิน scope dev คนเดียว — LWT + heartbeat ครอบคลุมเทียบเท่า (ADR-09) |
| ทำไมไม่ให้ OpenPLC publish MQTT ตรง? | OpenPLC เป็น controller ไม่ใช่ historian — edge-bridge ยังเป็น translator เดียวที่คุม normalization (Mode B ในเอกสาร 04 §1.5) |
