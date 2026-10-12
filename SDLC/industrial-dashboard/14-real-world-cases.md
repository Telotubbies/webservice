# 14 — Real-World Cases & Community Lessons

> เอกสารนี้เป็น **auditable research log** — ทุก design choice ใน SDLC ที่มี
> "from field practice" ต้อง trace กลับมาที่ตารางนี้ กฎ: case จาก blog/forum
> ถือเป็น practitioner evidence (ใช้เป็น rationale ได้) แต่ **ไม่ใช่ spec**
> — spec ยังต้องยึด official docs (Siemens/AWS/Modbus.org/IEC)

## 1. Lab Topology — Factory I/O + OpenPLC (pattern มาตรฐานของ community)

| แหล่ง | สิ่งที่เห็นจริง |
|---|---|
| DEV.to "DIY Smart Factory" series | Factory I/O = Modbus **server** (plant), OpenPLC Runtime = Modbus **master** ที่รัน ladder + เปิด Modbus **slave** ของตัวเองบน :502 → SCADA/HMI อ่านจาก OpenPLC ไม่ใช่จาก Factory I/O ตรงๆ |
| adainese.it virtual PLC lab | Topology: Factory I/O (Windows, plant) ←Modbus→ OpenPLC (Linux VM, controller) ←Modbus→ Node-RED/FUXA (supervision) + Kali (attacker) — แยก host/VM ตาม Purdue zone |
| GitHub `aiminhong/FactoryIO_TSC` | Factory I/O + OpenPLC + TimescaleDB + Grafana stack — telemetry historian pattern เดียวกับเรา |
| GitHub `BSalmazo/ot-lab-app` | OT lab: OpenPLC + FUXA + Modbus proxy + tshark — แยก OT zone / DMZ ใน docker |
| GitHub `Ntandolis431/iiot-testbed` | OpenPLC + FUXA + Node-RED + Mosquitto + InfluxDB + Grafana — pipeline Modbus→MQTT→TSDB เดียวกับ design เรา |

**บทเรียนที่เปลี่ยน design เรา**:
- ถ้า edge-bridge อ่าน Factory I/O ตรง (Mode A) → dashboard write จะลง actuator โดยไม่มี control layer คั่น — **ขัดกับ "PLC owns interlock" claim ของเราเอง**
- Community standard คือใส่ soft-PLC (OpenPLC) คั่น: command จาก cloud ลงที่ register ของ PLC, ladder logic เป็นคนตัดสิน — เรียกว่า **Mode B**
- OpenPLC ฟรี, รันบน Windows/Linux/Docker ได้, มี web UI แก้ ladder ได้ → ใส่เป็น optional tier ในเอกสาร 04 §1.5
- Mode A ยังมีประโยชน์: bring-up/smoke test เร็วสุด ไม่ต้อง config PLC — ใช้ Sprint 0–1
- Mode B ควรเป็น default สำหรับ demo/thesis เพราะ topology ตรงโรงงานจริงและเทส "command ผ่าน PLC" ได้จริง

## 2. Modbus Polling — field lessons (PLCTalk, Niagara, Modbus Connect, ICS Schneider)

| บทเรียน | แหล่ง | ที่ไป apply |
|---|---|---|
| **Central poller เดียว** — N โปรแกรม poll device เดียวกัน = socket ล้น/serial line ชนกัน | ICS Schneider (gateway field guide), PLCTalk | edge-bridge เป็น collector เดียวต่อ PLC — validate design เดิม, เขียนเป็นกฎใน 04 §6 |
| **Reuse TCP connection** — open/close ต่อ request = overhead + socket churn | ICS Schneider | 04 §6: connection ต้อง persistent, pool ต่อ slave |
| **Poll classes + fastest-wins pitfall** — Niagara N4 poll scheduler: tag เร็วตัวเดียวใน block จะลากทั้ง block ไป rate เร็วสุด | Tridium Niagara docs/community | เพิ่ม `poll_class` (fast/normal/slow) ใน tag YAML + เตือนเรื่อง block promotion ใน 04 |
| **Block read** — อ่าน contiguous register ทีเดียว > หลาย request เล็ก | Modbus Connect best practice | 04 §6: adapter ต้อง group contiguous addresses เป็น read block |
| **Timeout ≥ 3× normal response** + **retry เป็น storm source** | Modbus Connect, RealPars | 04 §6: timeout/retry config + exponential backoff |
| **PLC socket ceiling** — S7-1200 ~8–34 connections; zombie sessions กิน table | Siemens forums, PLCTalk | 08 + 04: cap concurrent connections, cleanup dead session |
| **Slowest tolerable rate** — poll ช้าที่สุดที่ process ยังรับได้ ไม่ใช่เร็วที่สุดที่ทำได้ | PLCTalk (RPI wisdom) | 04 §6: default poll ตาม process ไม่ใช่ max |
| **Sim ≠ real** — Factory I/O รับ poll ดุได้, PLC จริงมี CPU/socket จำกัด | community consensus | เตือนใน 04: config ที่รันบน sim ต้องผ่าน review ก่อนใช้กับ PLC จริง |

## 3. Siemens S7/snap7 — สามจุดพังคลาสสิก

| จุดพัง | รายละเอียด | ที่ไป apply |
|---|---|---|
| PUT/GET ไม่เปิด | S7-1200/1500 ใน TIA Portal ปิด "Permit access with PUT/GET" เป็นค่า default → snap7 connect ได้แต่ read/write fail | 04 §7 checklist |
| Optimized block access | DB ที่ optimize (symbolic) ไม่มี absolute offset → snap7 อ่านไม่ได้ ต้องปิดที่ DB properties | 04 §7 checklist |
| Rack/slot | snap7 connect ต้อง rack=0 slot=1 สำหรับ S7-1200/1500 (S7-300 เป็น 0/2) — hardcode ผิด = connect fail | 04 §7 checklist |
| Partner mode | snap7 บาง version ไม่รองรับ "partner" connection mode บน S7-1200 — ใช้ PG/OP mode | 04 §7 note |
| FW threshold | S7Comm (snap7 path) ต้อง FW เท่าไหร่ vs OPC UA native server (S7-1200 ≥FW4.4, S7-1500 ≥FW2.0 + license) | 04 §7 + adapter selection rule เดิม |
| TCP 102 | Windows firewall / ACL block port 102 silently = hang ไม่ใช่ refuse | 09-testing checklist |

## 4. Time-series DB — production evidence

| แหล่ง | สิ่งที่พบจริง |
|---|---|
| United Manufacturing Hub (UMH) | เลือก TimescaleDB สำหรับ IIoT เพราะ "boring/mature SQL + join asset model ได้" — เหตุผลเดียวกับ ADR-02 เรา |
| InfluxDB engine history | InfluxDB เขียน storage engine ใหม่ 2 ครั้งใน 5 ปี (1.x TSM → 2.x Flux ecosystem → 3.x FDAP/Rust) — migration churn คือความเสี่ยงจริงของ long-lived system |
| johal.in migration case | ย้าย sensors จาก Influx→Timescale เพราะต้องการ SQL + join กับ relational — pattern เดียวกับ requirement เรา (tags registry ↔ telemetry) |
| Timescale field practice | **batched COPY/insert 10k–50k rows** >> row-by-row INSERT; compress chunk หลัง ~7 วันได้ 10–20x |

→ apply: 05 เพิ่ม note batched ingestion (COPY ผ่าน `asyncpg.copy_records_to_table`); 03 ADR-02 เพิ่ม citations

## 5. AWS IoT Core — production pitfalls

| จุด | รายละเอียด | ที่ไป apply |
|---|---|---|
| **Cert ต่อ device — ห้าม share** | X.509 per-thing; postmortem จริง: cert รั่ว = revoke ทั้ง fleet | 08 §1 มีอยู่แล้ว → เพิ่ม lifecycle (provision/rotate/revoke) + JITR note ใน 10 |
| **MQTT 3.1.1 vs 5.0** | MQTT 5 session expiry + clean-start semantics บน IoT Core มี edge case จริง (session หลุดพร้อมกันทั้ง fleet); 3.1.1 boring กว่า | 03 ADR: edge client ใช้ MQTT 3.1.1 (default boring path) เว้นจำเป็น 5.0 features |
| **Topic structure = hardest to refactor** | real fleets: เปลี่ยน topic ทีหลังแพงที่สุด — device firmware + rules + downstream ทุกตัวผูกกัน | validate ว่าเราล็อก UNS layout ตั้งแต่ต้นถูกแล้ว — เขียนเป็น "frozen contract" note ใน 05 |
| **S3 object explosion** | rule→S3 per-message = ล้าน object → cost + list ช้า | กฎ: S3 ใช้เฉพาะ snapshot (ขนาดใหญ่) ไม่ใช่ telemetry — เขียนใน 10 §3 |
| **IoT Jobs** | managed command/OTA path ที่ track lifecycle เอง — alternative ถึง cmd topic ของเรา | 03 ADR table: เลือก custom cmd topic (simpler, contract เราเอง) — Jobs เป็น option ตอน fleet ใหญ่ |

## 6. UNS / Sparkplug B — real deployments

| แหล่ง | สิ่งที่พบ |
|---|---|
| HiveMQ UNS case (Mayker Foods, multi-line) | pattern ที่ใช้ได้จริง: contextualize ที่ edge → publish UNS → derive KPI tag กลับเข้า namespace → rollout PoC→line→site→multi-site |
| Sparkplug B vs plain MQTT (Corso Systems, HiveMQ 2024+) | Sparkplug ให้ birth/death cert + typed payload + stale ในตัว แต่ topic โครง fix (`spBv1.0/{group}/...`) ขัดกับ semantic UNS; HiveMQ เองแนะนำ plain MQTT+convention ที่ UNS layer — **validate ทางเลือกเรา**: plain MQTT + quality/heartbeat conventions |
| Sparkplug trigger | ถ้าต้อง interop กับ Ignition Edge / SCADA ที่พูด Sparkplug → bridge เป็น adapter ทีหลัง ไม่ใช่เปลี่ยน contract |

→ apply: 05 เพิ่ม derived-tag convention (`{site}.{area}.kpi.{line}.{metric}`); 03 เพิ่ม ADR Sparkplug-rejected-for-now

## 7. Realtime Frontend — scaling lessons

| แหล่ง | สิ่งที่พบ |
|---|---|
| uPlot benchmark + community streaming dashboards | uPlot ~10% CPU ที่ 3,600 pts/60fps; Chart.js ~40% ที่เฟรมเดียวกัน — validate ADR-04 (ECharts+uPlot) |
| React + WS patterns (blog/community consensus) | (1) **อย่า** setState ต่อ message — buffer → flush ด้วย rAF/~100ms tick (2) ring buffer เก็บ N points ล่าสุด + downsample เมื่อเลื่อนย้อน (3) reconnect = exponential backoff + jitter + cap ~5–10 นาที (4) `useSyncExternalStore` สำหรับ external store pattern |
| Server-side batching | เรา batch `tags` ทุก 200ms อยู่แล้ว (06 §2) — ตรง practice; เพิ่ม client-side contract ให้ชัด |

→ apply: 06 เพิ่ม §2.1 "Client consumption contract"; 03 ADR-04 เพิ่มตัวเลข

## 8. สรุปสิ่งที่เปลี่ยนใน SDLC จากรอบ research นี้

| # | การเปลี่ยน | Doc |
|---|---|---|
| 1 | OpenPLC optional middle tier (Mode A/B topology) | 02, 04, 11 |
| 2 | Modbus poll_class + block read + timeout/retry/socket rules | 04, 08, 09 |
| 3 | Siemens checklist (PUT/GET, optimized DB, rack/slot, FW, port 102) | 04, 09 |
| 4 | Batched COPY ingestion 10k+ rows | 05 |
| 5 | MQTT 3.1.1 edge default + cert lifecycle + IoT Jobs option | 03, 08, 10 |
| 6 | Sparkplug B ADR (rejected now, trigger ชัดเจน) | 03 |
| 7 | Derived KPI tag convention + frozen-topic warning | 05 |
| 8 | WS client consumption contract | 06 |
| 9 | Sprint task 1.x: OpenPLC topology option | 11 |
| 10 | Test ใหม่: poll storm, reconnect backoff, cert rotation | 09 |
