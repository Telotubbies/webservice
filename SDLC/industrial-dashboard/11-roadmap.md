# 11 — Roadmap

## Sprint 0 — Skeleton (เป้า: โครงรันได้ end-to-end กับ data ปลอม)

| # | Task |
|---|---|
| 0.1 | `edge-bridge` เฟรมเวิร์ก + `sim` adapter (generate sine/random ตาม config) |
| 0.2 | `backend` FastAPI: WS + Timescale insert + REST tag/latest |
| 0.3 | `frontend` React+Vite: layout + trend chart 1 หน้า subscribe `/ws` |
| 0.4 | docker-compose: backend + timescaledb + mosquitto (local MQTT แทน IoT Core) |
| 0.5 | `TagValue` schema + tag config YAML — contract ตั้งต้น |

**Exit**: เปิด `/trends` เห็น graph ขยับเรียลไทม์จาก sim tags

## Sprint 1 — Factory I/O connect (เป้า: ดึงค่าจริงจาก sim scene)

| # | Task |
|---|---|
| 1.1 | `modbus` adapter + `tags.modbus.yaml` map Factory I/O scene "Sorting Station" |
| 1.2 | Store-and-forward buffer (SQLite WAL) |
| 1.3 | Edge heartbeat + adapter status tag |
| 1.4 | Mimic page v1: SVG layout bind ค่าจริง (conveyor/sensor) |
| 1.5 | Quality badge + STALE indicator ใน UI |
| 1.5a | Edge clock discipline (04 §6.6): NTP sync + `clock_ok` ใน heartbeat + quality=uncertain เมื่อ unsync |
| 1.6 | **OpenPLC topology (Mode B)** — optional tier ตามเอกสาร 04 §1.5: Factory I/O ←Modbus→ OpenPLC (ladder) ←Modbus→ edge-bridge; เขียน ladder ง่ายๆ (start/stop + interlock) เพื่อเทส "command ผ่าน PLC ตัดสิน" จริง — Mode A (ตรง Factory I/O) ยังใช้สำหรับ bring-up เร็ว |

**Exit**: ปิด Factory I/O → dashboard แสดง STALE; เปิด → กลับมา live; (Mode B) สั่ง conveyor ที่ ladder interlock ไว้ → status=`denied`

## Sprint 2 — Alarm + Command (เป้า: สั่ง+เตือนได้)

| # | Task |
|---|---|
| 2.1 | Alarm engine + rules table + eval loop |
| 2.2 | Command pipeline: POST → IoT → edge → resp → lifecycle |
| 2.3 | Idempotency + TTL + denied path + **concurrent-command 409** (unique index ใน 05, contract ใน 06 §3) |
| 2.4 | Alarm UI: list + ack + severity filter + badge count + **flood handling** (rate-limit popup ไม่ drop record — ISA-18.2) |
| 2.5 | CommandButton 2-step confirm + audit log |

**Exit**: กด "Stop conveyor" บน mimic → Factory I/O หยุดจริง, command audit ครบ

## Sprint 3 — Auth + AWS (เป้า: deploy ขึ้น cloud จริง)

| # | Task |
|---|---|
| 3.1 | Cognito user pool + hosted UI + group mapping |
| 3.2 | RBAC middleware + public/operator separation |
| 3.3 | Terraform: VPC/ALB/ECS/RDS/IoT Core/S3/CF — deploy `dev` |
| 3.4 | GitHub Actions CI: test → build → deploy-dev |
| 3.5 | Edge connect ไป IoT Core จริง (cert+TLS) + cert rotation path |
| 3.6 | WS hardening: token mid-session expiry (auth.expiring → refresh → 4001) + Redis fan-out ready (06 §5) |

**Exit**: `https://dev.example.com` ทำงาน, operator login, edge บนเครื่อง local คุยกับ AWS

## Sprint 4 — Vision Integration (เป้า: โมเดลเดิมเข้า pipeline)

| # | Task |
|---|---|
| 4.1 | `vision-inference` service: โหลด YOLO26n-seg + camera/video input |
| 4.2 | Publish TagValue เช่น `cam1.gravel_ratio`, `cam1.count` ขึ้น MQTT |
| 4.3 | Snapshot → S3 เมื่อ alarm rule `quality` trigger |
| 4.4 | UI: camera panel + overlay metrics + snapshot gallery |
| 4.5 | Alarm rule: `gravel_ratio < threshold` → alarm + snapshot link |

**Exit**: เห็นค่า vision ไหลเข้า dashboard; ถ้า ratio ต่ำกว่า threshold → alarm พร้อมรูป snapshot

## Sprint 5 — Polish + Harden (เป้า: demo/production ready)

| # | Task |
|---|---|
| 5.1 | Health page + service status |
| 5.2 | Audit viewer + command history UI |
| 5.3 | Export CSV / PNG, compare mode ใน trends |
| 5.4 | Security pass: rate limit, WAF, input fuzz, secrets audit |
| 5.5 | Load test 100 tags/s × 50 WS clients |
| 5.6 | README + runbook (ติดตั้ง edge, onboard tag, troubleshoot) |
| 5.7 | Field-lesson + adversarial test suite (09 §6.5–6.6): poll storm, clock skew, concurrent 409, WS expiry, alarm flood |
| 5.8 | Cost audit: NAT Gateway ทางเลือก (VPC endpoints ~$7/ea) + Budgets alarm $100 — ตรง doc 10 §10 |

## Deferred / Future

| Item | เมื่อไหร่ |
|---|---|
| Siemens S7 adapter | เมื่อมี PLC จริง + รู้รุ่น + DB map |
| OPC UA adapter | ถ้า PLC รุ่นใหม่หรือมี OPC server กลาง |
| Multi-site | เมื่อต้องรองรับ >1 plant (topic prefix รองรับอยู่แล้ว) |
| Grafana embedded | ถ้าอยากได้ dashboard ขั้นสูงโดยไม่เขียนเอง |
| Mobile/PWA | ถ้าต้องใช้บน tablet หน้างาน |
| Timescale → SiteWise | ถ้าจะใช้ managed asset model ของ AWS แทน schema เอง |
