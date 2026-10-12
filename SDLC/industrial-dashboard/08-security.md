# 08 — Security

> **SaaS revision:** Cognito is replaced by Keycloak locally (OIDC; Cognito remains a drop-in IdP for AWS). Anonymous viewer role removed. RBAC is per-organization membership (owner/admin/operator/viewer), not JWT groups. Read [ADR-12](adr/ADR-12-authentication.md), [ADR-13](adr/ADR-13-tenant-isolation.md), [16](16-command-safety-contract.md), [17](17-mqtt-security-contract.md).

## 1. Authentication

| Actor | Method |
|---|---|
| Operator/Admin | Cognito Hosted UI → OAuth2 Authorization Code + PKCE → JWT |
| Public viewer | ไม่ต้อง login — read-only scope ที่ backend |
| Edge bridge | X.509 device certificate + MQTT TLS (AWS IoT Core device auth) |
| Backend → IoT Core | IAM role (SigV4) |
| Vision → IoT Core | X.509 cert (เหมือน edge) หรือ IAM role บน ECS |

- JWT verify: signature + expiry + `cognito:groups` claim
- Refresh token: HttpOnly, Secure, SameSite=Lax cookie
- Public read: ไม่ต้องมี token — แต่ backend whitelist endpoint ที่ anonymous เข้าถึงได้เท่านั้น

## 2. Authorization (RBAC)

| Role | Source | สิทธิ์ |
|---|---|---|
| `viewer` (anonymous) | ไม่มี token | GET tags/alarms/history/health, WS telemetry+alarms |
| `operator` | Cognito group `operators` | + POST /api/commands, POST /api/alarms/{id}/ack |
| `admin` | Cognito group `admins` | + alarm-rules CRUD, tag config, audit view, adapter config |

**Enforcement**: middleware ที่ FastAPI dependency — ไม่ใช่แค่ฝั่ง UI ซ่อนปุ่ม

## 3. OT Safety Boundary (สำคัญที่สุด)

> **กฎเหล็ก: ระบบนี้เป็น supervisory + monitoring เท่านั้น**
>
> ไม่มี path ใดในระบบนี้ที่ bypass safety interlock ใน PLC ได้
> — E-stop, guard, overload อยู่ใน PLC ladder เท่านั้น
> — Command จาก cloud เป็นเพียง "คำขอ" ที่ PLC/sim เป็นคนตัดสิน
> — ถ้าสั่งอะไรที่ PLC ไม่ยอม (interlock) → edge ตอบ `denied` กลับ

- Edge bridge **ไม่มี logic** ที่ทำให้ PLC ทำสิ่งที่มันไม่ได้ถูกตั้งให้ทำ
- Write-back = เขียน register/coil เท่านั้น — ถ้า PLC program ไม่ map → ไม่มีผล
- Audit trail ทุก write — ใครสั่ง อะไร เมื่อไหร่ ผลคืออะไร
- Rate limit + confirmation บน UI + TTL command + idempotency

## 4. Threat Model (STRIDE ย่อ)

| Threat | Mitigation |
|---|---|
| **Spoofing** — ปลอม edge device | X.509 cert per device, IoT Core device registry |
| **Tampering** — แก้ telemetry กลางทาง | TLS ทุก path; payload schema validation |
| **Repudiation** — ปฏิเสธว่าไม่ได้สั่ง | Audit log immutable + Cognito identity + timestamp |
| **Info disclosure** — ดูข้อมูลที่ไม่ควร | Public endpoint whitelist; S3 presigned URL สำหรับ snapshot |
| **DoS** — flood WS/commands | Rate limit; IoT Core connection limit; WAF บน CloudFront+ALB |
| **Elevation** — viewer สั่ง command | Server-side group check; ไม่เชื่อ role จาก client |
| **Malicious adapter** — เขียน code ที่ bypass | Adapter code อยู่ใน repo เดียวกัน; review; config แยกจาก code |

## 5. Network Security (Purdue)

```
Public Internet
      │ TLS
      ▼
CloudFront ──► ALB ──► ECS backend ──► RDS (private subnet)
                          │
                          │ MQTT/TLS (dial-out)
                          ▼
                    AWS IoT Core
                          ▲
                          │ MQTT/TLS (dial-out)
     ┌────────────────────┘
     │  (ไม่มี inbound เข้า OT)
edge-bridge (on-prem/PC) ──► Factory I/O (local LAN, ไม่เปิดเน็ตตรง)
```

- Edge bridge **dial-out only** — ไม่มี port เปิดรับ
- OT network (Factory I/O) แยก VLAN/subnet จาก edge bridge ถ้าทำได้
- Backend อยู่ private subnet; public เข้าได้แค่ผ่าน ALB + TLS
- RDS อยู่ private, Security Group อนุญาตเฉพาะ ECS SG

## 6. Secrets Management

| Secret | เก็บที่ |
|---|---|
| Cognito client secret | AWS Secrets Manager → inject env บน ECS |
| IoT device cert/private key | IoT Core (cert) + Secrets Manager (key สำหรับ edge bootstrap) |
| DB password | Secrets Manager → ECS task env |
| JWT signing | Cognito จัดการ (RS256) |
| Edge local config | ไฟล์ `.env` บนเครื่อง edge (gitignore) — ไม่มี cloud secret |

### 6.1 Device Certificate Lifecycle (จาก field postmortem — cert รั่ว = revoke ทั้ง fleet)

| Phase | กฎ |
|---|---|
| Provision | 1 cert ต่อ 1 thing — ห้าม share; ใช้ fleet provisioning/JITR เมื่อ edge >2-3 ตัว |
| Store | private key อยู่เฉพาะบนเครื่อง edge (`.pem`, chmod 600) — ไม่เข้า git, ไม่เข้า Secrets Manager |
| Rotate | กำหนด cert validity (เช่น 12 เดือน) + CloudWatch/IoT Device Defender alarm ล่วงหน้า 30 วัน — cert หมดอายุเงียบๆ = edge หลุดทั้งระบบ |
| Revoke | runbook: deactivate cert ใน IoT Core → edge disconnect ทันที → issue cert ใหม่ → redeploy; ทดสอบ drill ใน Sprint 5 |
| Monitor | เปิด **IoT Device Defender** (audit + detect: shared cert, cert expiring, anomalous connect) — managed, ไม่ต้องเขียนเอง |

## 7. Logging & Audit

- Structured JSON log ทุก service → CloudWatch
- Audit table บันทึก: login, command issue/ack/fail, alarm ack, config change
- Command มี `idempotency_key` + `user_id` + `issued_at` + `result` — ย้อนได้เต็ม
- Alarm events เก็บ history (ไม่ overwrite — append-only transition)

## 8. IEC 62443 Mapping (ระดับ concept — ไม่ใช่ cert)

| IEC 62443 concept | Implementation ในระบบนี้ |
|---|---|
| Zone & conduit | Purdue L2 (edge) / L3.5 (IoT Core) / L4 (cloud) — dial-out only |
| Authentication | X.509 (edge) + Cognito (user) + IAM (service) |
| Authorization | RBAC + tag writable allowlist |
| Auditability | audit_log + command lifecycle + CloudWatch |
| Data integrity | TLS + schema validation + timestamp |
| Availability | store-and-forward + retry + health monitoring |
| Fail-safe | PLC interlock อยู่นอกระบบ — เราไม่ bypass |

## 9. OT Field Hardening (จาก community field lessons — เอกสาร 14 §2)

| ปัญหาจริง | กฎในระบบนี้ |
|---|---|
| PLC socket ceiling (S7-1200 ~8–34 connections; zombie session กิน table) | edge-bridge = **Modbus/TCP poller เดียว**ต่อ device; connection persistent + cleanup dead session; ห้าม script/QA tool อื่น poll PLC เดียวกัน |
| Retry storm ทำ PLC หรือเกตเวย์ล้ม | timeout ≥3× normal response + exponential backoff + max retry (เอกสาร 04 §6); retry ไม่ใช่ loop ตรงๆ |
| Config ที่ "รันได้" บน Factory I/O พัง PLC จริง | sim รับ poll ดุได้ — **config ที่จะชี้ไป PLC จริงต้องผ่าน review** (poll_ms, block size, timeout) ก่อน deploy เสมอ |
| Anonymous MQTT publish เข้า namespace | IoT policy จำกัด topic per-thing (เอกสาร 10 §3) + backend drop unknown tag (เอกสาร 05 §1) |

## 10. Accepted Risks (ระบุชัด — ไม่ปล่อยให้คนอ่านคิดเอง)

| Risk | เหตุที่ยอมรับ / compensation |
|---|---|
| **Modbus TCP ไม่มี auth/encryption** (protocol design เอง — ใครอยู่ LAN เดียวกัน write coil ได้) | Standard industry trade-off; compensation = network segmentation (edge↔PLC subnet/VLAN แยก, ห้าม route ออกเน็ต), poller เดียว, writable-tag allowlist, PLC interlock เป็น authority สุดท้าย — ถ้า site ต้องการมากกว่านี้ → เปลี่ยนเป็น OPC UA (มี Sign & Encrypt) หรือวาง firewall แยก OT zone เต็มรูปแบบ |
| **Audit timestamp เชื่อ edge clock** | mitigation: NTP บังคับ + drift monitor + `clock_untrusted` denial (04 §6.6) — ถ้าต้องการ legal-grade non-repudiation ต้องมี trusted time source แยก (out of scope, บันทึกใน risk register 13) |
| **Factory I/O ไม่มี fault model** — sim ไม่เคยตอบช้า/ตอบผิดแบบ PLC จริง | Mode B (OpenPLC คั่น) เทสได้บางส่วน; integration test กับ hardware จริงจำเป็นก่อน claim production-ready (roadmap Sprint 5 gate) |
