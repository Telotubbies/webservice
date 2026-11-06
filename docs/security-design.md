# Security design ของ vissointan

สถานะ ณ 2026-11-06 เอกสารนี้อ่านจากโค้ดจริงใน repo แล้วจัดเป็น threat model, รายการ control, gap และแผน F21 ไม่ได้แก้โค้ด

ป้ายสถานะที่ใช้ในทุกตาราง

| ป้าย | ความหมาย |
|---|---|
| **exists** (ไฟล์:บรรทัด) | มีในโค้ดแล้ว อ้างตำแหน่งที่ตรวจเอง |
| **gap** | ยังไม่มี หรือมีแต่ไม่พอ |
| **proposed** | เสนอให้ทำ ยังไม่มีในโค้ด |

หลักที่ยึดตลอดเอกสาร: ระบบนี้เป็นชั้นเฝ้าดูและสั่งงานคู่กับ HMI เดิม **interlock ด้าน safety ต้องอยู่ที่ PLC เสมอ** ซอฟต์แวร์ฝั่งเราเป็นเพียงชั้นป้องกันเพิ่ม ไม่ใช่ชั้นสุดท้าย

เลขบรรทัดอาจขยับตามการแก้โค้ด ให้เช็กก่อนอ้างต่อ

---

## 1. บริบทระบบและ trust boundary

### 1.1 แผนภาพ

```text
 ┌─────────────┐
 │  Internet   │  ผู้ใช้, attacker, (ERP/webhook ในอนาคต)
 └──────┬──────┘
════════╪════════════ B1  Internet -> Web edge (nginx, TLS ที่ reverse proxy)
 ┌──────┴──────┐        web/nginx.conf: CSP, X-Frame-Options, nosniff
 │ Web (React) │        proxy /realms -> Keycloak (origin เดียว)
 │ nginx       │
 └──────┬──────┘
════════╪════════════ B2  Web -> API  (Bearer JWT RS256, WS /ws)
 ┌──────┴────────────────────────────┐        ┌──────────────┐
 │ API (FastAPI)                     │◄──OIDC─┤  Keycloak    │
 │ iam/security.py  deps.py          │  JWKS  │  realm wds   │
 │ edge/commands.py edge/dynsec.py   │        └──────────────┘
 └───┬──────────┬───────────┬────────┘
     │          │           │
═════╪══ B3 ════╪══ B4 ═════╪══ B5 ══════════════════════════
     │ API->DB  │ API->Broker│ API->Storage / model services
┌────┴───┐  ┌───┴──────┐  ┌──┴────────┐   ┌──────────────────┐
│Postgres│  │Mosquitto │  │ Garage S3 │   │ model-server     │
│ RLS    │  │ dynsec   │  │ (uploads, │   │ model-converter  │
│ audit  │  │ TLS 8883 │  │  backups) │   │ (net=none, ro,   │
└────────┘  └───┬──────┘  └───────────┘   │  cap_drop ALL)   │
                │                         └──────────────────┘
════════════════╪═══════ B6  Broker -> Edge (per-edge dynsec identity)
           ┌────┴─────┐
           │edge-bridge│  กล้อง/AI vision, rules, command gate
           └────┬─────┘
════════════════╪═══════ B7  Edge -> PLC (OT network, เขียน tag)
           ┌────┴─────┐
           │   PLC    │  interlock / safety อยู่ที่นี่
           └──────────┘

 (วางแผน) ┌───────────────┐  B8  API <-> ERP / webhook ลูกค้า (F18)
          │ ERP / ลูกค้า  │  ยังไม่มีโค้ด
          └───────────────┘
```

### 1.2 ตาราง boundary

ผลตรวจเทียบกรอบ system-design: สมมติฐานคือหนึ่ง replica ต่อ service และ edge อยู่ใน LAN โรงงานซึ่งต่อออกมาหา broker สาธารณะ (`docker-compose.prod.yml:44-49` เปิด 8883 ให้ edge ของลูกค้า) ภายใต้ prod compose ส่วน DB, backend, model-server และ converter ไม่เปิดพอร์ตออกนอก (`ports: !reset []` ที่ `docker-compose.prod.yml:39,51,74`) trade-off ที่เลือกคือ identity ต่อ edge แบบรหัสผ่านใน TLS แทน mTLS (ง่ายต่อการดูแล แลกกับความแข็งแรง) และ rate limit ในหน่วยความจำ (ง่าย แลกกับการขยายหลาย replica) สิ่งที่ต้องกลับมาทบทวนเมื่อโตขึ้นคือ rate limit แบบแชร์, ลำดับการเขียนข้าม tag และ egress proxy ของ B8

| ID | Boundary | ข้อมูลที่ข้าม | ระดับความเชื่อถือ |
|---|---|---|---|
| B1 | Internet -> nginx | HTTP, WS, OIDC redirect | ไม่เชื่อถือ |
| B2 | Web -> API | JWT, JSON, WS | ไม่เชื่อถือ จนกว่าจะ verify token + RLS |
| B3 | API -> Postgres | SQL ผ่าน role runtime | เชื่อถือ แต่ต้องคุมด้วย RLS |
| B4 | API <-> Mosquitto | command, telemetry, cfg | เชื่อถือตาม ACL ของ dynsec |
| B5 | API -> storage / model services | ไฟล์ upload, ONNX, pickle (.pt) | ไฟล์ไม่เชื่อถือ |
| B6 | Mosquitto <-> edge | tele, cmd, cmd-resp, vision | edge เชื่อถือเท่าที่ ACL ให้ |
| B7 | edge -> PLC | write tag | เชื่อถือสูงสุด ผลกระทบกายภาพ |
| B8 | API <-> ERP (planned) | order, webhook, export | ยังไม่มี ต้องออกแบบก่อน |

---

## 2. Threat model (STRIDE) ต่อ boundary

S = Spoofing, T = Tampering, R = Repudiation, I = Information disclosure, D = Denial of service, E = Elevation of privilege

### 2.1 B1/B2 Internet, Web, API

| STRIDE | ภัย | Control ที่มี | สถานะ |
|---|---|---|---|
| S | ปลอม token / alg confusion | RS256 allowlist ตายตัว ไม่อ่าน alg จาก header, ตรวจ iss/aud/exp/sid | exists (`backend/app/iam/security.py:53-54`, docstring `:9-11`) |
| S | ข้าม MFA | org ที่ตั้ง `mfa_required` ต้องมี `acr=mfa` | exists (`backend/app/deps.py:175-180`) |
| T | XSS แก้ UI สั่งงาน | CSP `script-src 'self'`, `object-src 'none'` | exists (`web/nginx.conf:60`, `:118`); `style-src 'unsafe-inline'` ยังเปิด = gap ต่ำ |
| R | ปฏิเสธว่าไม่ได้สั่ง | audit hash chain ต่อ org ผ่าน DB trigger | exists (`backend/app/db/audit.py:3-5`) |
| I | ข้าม tenant (BOLA) | RLS + FORCE RLS + ชุดเทสต์ BOLA | exists (`backend/migrations/versions/0001_saas_schema.sql:348`, `tests/security/test_bola.py`) |
| D | เปิด WS จำนวนมาก | cap ต่อ IP | exists (`backend/app/core/config.py:153`) แต่ดู gap G9 เรื่อง NAT |
| E | viewer สั่งเขียน | RBAC + `step_up` ก่อน action ที่กระทบเครื่อง | exists (`deps.py:183-194`, ใช้ที่ `main.py:993`, `main.py:1340`, `tenancy/orgapi.py:255`) |

### 2.2 B3 API -> Postgres

| STRIDE | ภัย | Control | สถานะ |
|---|---|---|---|
| S/E | request ข้าม org ผ่าน connection pool | `set_config('app.org_id', ..., true)` แบบ transaction-local | exists (`backend/app/db/context.py:60`) |
| T | แก้/ลบ audit | chain คำนวณใน trigger, app เลือก `seq/hash` ไม่ได้ | exists (`db/audit.py:3-5`) และตรวจย้อนหลังด้วย `verify-audit` (`db/audit.py:34`) |
| I | role runtime อ่านข้าม org | สาม role แยก ทั้งหมด `NOSUPERUSER NOBYPASSRLS`; REVOKE CREATE บน schema public; REVOKE ALL บน database จาก PUBLIC; รหัสผ่านมาจาก secret file | exists (`infra/postgres/init/01-roles.sh:25-27,33-37,13-18`) |
| T | app แก้/ลบ audit_log โดยตรง | `wds_app` ได้เฉพาะ SELECT, INSERT บน audit_log, command_events, tag_history | exists (`backend/migrations/versions/0001_saas_schema.sql:384`) |
| D | backup พัง | ดู G5 | gap |

### 2.3 B4/B6 Broker และ edge

| STRIDE | ภัย | Control | สถานะ |
|---|---|---|---|
| S | **spoofed edge** ปลอมเป็น edge อื่น | ทุก edge มี identity ใน dynsec ACL จำกัดใต้ prefix ของตัวเอง | exists (`backend/app/edge/dynsec.py:68-84`) |
| S | ผู้ไม่หวังดีส่ง `cmd-resp` ปลอม | ACL ให้เฉพาะ edge เจ้าของ publish `cmd-resp/+` ใน prefix ตัวเอง | exists (`dynsec.py:74`) แต่ backend ไม่ผูก resp กับ edge_id ที่ส่งจริง = ดู G8 |
| T | **tampered telemetry** ใน broker | TLS 1.2 บน 8883, `allow_anonymous false` | exists (`infra/mosquitto.conf:6-13,29`); ไม่มี message signing = gap ต่ำ |
| T | **replay command** | `issued_at` + `ttl_s`, ตรวจ clock ก่อน TTL, dedup `req_id` | exists (`edge-bridge/edge_bridge/commands.py:6-10,32-34`); dedup อยู่ในหน่วยความจำ (INVARIANTS I12) |
| I | subscribe ข้าม org | ACL เป็น pattern ต่อ edge | exists (`dynsec.py:75-78`) |
| D | packet ใหญ่ / connection เยอะ | `max_packet_size`, `max_connections 64` | exists (`mosquitto.conf:35-37`) |
| I | credential ของ edge ที่หมุนแล้วถูกส่งทาง MQTT | publish แบบ QoS1 ไม่ retain บน `.../cred` เฉพาะ edge นั้น subscribe ได้ ส่งถึงตัวเก่าที่ยังใช้ได้ช่วง grace และไม่ log | exists (`backend/app/edge/credpush.py:1-8`); ข้อจำกัด: ความลับอยู่ใน payload ตรง ๆ ไม่ได้ห่อ ปลอดภัยเท่า TLS + ACL = gap ต่ำ |
| E | พอร์ต plaintext 1883 | ปิดใน default, เปิดเฉพาะ test overlay | exists (`mosquitto.conf:15-17`, `infra/mosquitto-extras-test/test.conf`) |

### 2.4 B7 Edge -> PLC (OT)

| STRIDE | ภัย | Control | สถานะ |
|---|---|---|---|
| E | **unauthorised PLC write** ผ่าน API | RBAC + step-up + registry (writable, range) + gate ที่ edge | exists (`deps.py:183`, `edge/commands.py:73`, ผล `denied/not_writable`, `out_of_range` ใน ATTACK_PLAN B13/B14) |
| E | unauthorised write จาก AI vision | rule ต้อง enabled, `dry_run` default true, site `control_enabled`, org `ai_plc_write` | exists (`edge-bridge/edge_bridge/vision/rules.py:10,219,537,636`) |
| T | **AI misclassification** ทำให้ trigger ผิด | dry-run, สถานะ gate หลายชั้น | exists บางส่วน; ยังไม่ได้ทดสอบกับ PLC จริง = G1 |
| T | เขียนแล้วค่าไม่ตรง | อ่านกลับหลังเขียน | proposed (F05 ยังไม่ทำ, `docs/product-gap-plan.md` F05) |
| R | ไม่รู้ใครสั่ง | audit + command events ต่อ `command_id` | exists (`edge/commands.py:229-270`); เหตุผลของคำสั่งยังไม่ครบ = F05 |
| D | edge เขียน PLC ค้าง | worker pool + busy limit สำหรับ op | exists บางส่วน (`edge-bridge/edge_bridge/commands.py:37,104-113`) แต่การเขียนค้างยังไม่มี watchdog = G7 |
| E | safety ถูกข้าม | interlock อยู่ใน PLC | โดยการออกแบบ (ไม่ใช่ control ของ software) |

### 2.5 B5 Model และ storage

| STRIDE | ภัย | Control | สถานะ |
|---|---|---|---|
| E | **malicious model file** (pickle ใน `.pt`) | แปลงใน container แยก: `network_mode: none`, `read_only`, user 10001, `cap_drop ALL`, `no-new-privileges`, `mem_limit 3g`, timeout | exists (`docker-compose.yml:158-170`, `model-converter/converter.py:93-95`, `worker.py:9-13`) |
| E | pickle scan ก่อนเข้าคิว | `scan_pt` เดิน opcode ด้วย `pickletools.genops` ไม่รันโค้ด, allowlist module, refuse zip ที่ไม่ใช่ checkpoint; เรียกตอน upload ที่ `backend/app/vision/models.py:31,215` แล้วตอบ 422 `unsafe_checkpoint`; มีเทสต์ `tests/contract/test_ptscan.py` | exists (`backend/app/vision/ptscan.py:20-27,65-75,78`) |
| E | scan ซ้ำก่อน worker โหลด | `model-converter/converter.py` และ `worker.py` ไม่เรียก scan (grep ไม่พบ) ไฟล์ใน spool ถูกเชื่อว่าผ่านมาแล้ว | gap G6 |
| T | ONNX/โมเดลที่ใช้งานถูกสลับ | คำนวณ sha256 ตอน upload (`vision/models.py:185`, `storage.py:43`) ส่งไปกับ config (`models.py:393`) edge ส่ง hash ต่อให้ model-server (`edge-bridge/.../vision/modelclient.py:75`) ซึ่งดาวน์โหลดแล้วตรวจ sha256 ก่อนเก็บ cache (`model-server/server/app.py:50`, `store.py:1`) และ config ลงนามด้วย HMAC (`rules.py:227-235`) | exists |
| I | ข้าม tenant ใน storage | เทสต์ isolation | exists (`tests/security/test_storage_isolation.py`, `docs/security/storage-and-ai-threat-model.md`) |
| D | upload ใหญ่ | จำกัดขนาดภาพ 5 MiB ผ่าน broker packet cap | exists (`mosquitto.conf:33-35`) |

### 2.6 B8 ERP integration (planned)

ยังไม่มีโค้ด ดูข้อกำหนดที่หัวข้อ 5

---

## 3. Control ที่มีอยู่พร้อมหลักฐาน

| หมวด | Control | หลักฐาน | สถานะ |
|---|---|---|---|
| Authn | OIDC (Keycloak), RS256 pin, ตรวจ iss/aud/exp/sid, leeway 30 วินาที | `iam/security.py:9-11,53-54,149-153` | exists |
| MFA | `mfa_gate` บังคับ `acr=mfa` ต่อ org ที่ตั้งไว้ | `deps.py:175-180`, `iam/security.py:404-407` | exists |
| Keycloak realm (dev) | brute-force protection, `passwordPolicy` ยาว 12 ตัวอักษรและห้ามเหมือน username/email, TOTP 6 หลัก 30 วินาที (HmacSHA1), flow `browser-loa` map `pwd=1`, `mfa=2`, `sslRequired: all`, access token 300 วินาที, SSO idle 1800 วินาที, SSO max 36000 วินาที, LoA max-age 36000 วินาที | exists (`infra/keycloak/realm-wds.json:10-13,16,120,167-174,288`) |
| Keycloak realm (prod) | `directAccessGrantsEnabled: false` ทั้งสอง client, brute-force, password policy เดียวกัน, token 300 วินาที | exists (`infra/keycloak-prod/realm-wds.json:5,10,43,114,120,134,248`) |
| Keycloak dev ที่ไม่ควรรั่วไป prod | realm dev เปิด `directAccessGrantsEnabled: true` ซึ่งตัวไฟล์เตือนเองว่า bypass MFA ได้ ใช้เฉพาะ dev/test | exists เป็นข้อควรระวัง (`infra/keycloak/realm-wds.json:45-49`); กันด้วยการที่ prod compose ใช้ realm prod ต้องมีเทสต์ยืนยัน = gap G18 |
| Step-up | ต้อง `acr=mfa` และ `auth_time` ไม่เกิน `STEPUP_MAX_AGE_S` (900 วินาที) | `deps.py:183-194`, `core/config.py:198-199` | exists; ปิดใน dev/test โดย `APP_ENV` |
| RBAC | role ต่อ org จากตาราง memberships | `iam/security.py:399-411` | exists |
| RLS | `FORCE ROW LEVEL SECURITY` (129 จุดที่ใช้ RLS ใน migrations) และ context ต่อ transaction | `0001_saas_schema.sql:348`, `db/context.py:60-103` | exists |
| Command guard | in-flight หนึ่งคำสั่งต่อ tag (partial unique index), idempotency, TTL, clock check, range/writable | ATTACK_PLAN A1-A3, B12-B15; `edge/commands.py` | exists |
| Audit | hash chain ใน DB trigger + CLI ตรวจ | `db/audit.py:3-5,34`, `db/audit_cli.py` | exists |
| API key | เก็บเฉพาะ sha256, แสดงครั้งเดียว, ใช้ step-up ตอนสร้าง | `api/api_keys.py:31,83,102` | exists |
| Invite | เก็บ sha256 ของ token | `api/members.py:242,283` | exists |
| Secrets | Docker secrets ใน `infra/secrets/`, สร้างด้วย `gen-secrets.sh` | `infra/gen-secrets.sh`, `docker-compose.yml` | exists (dev) |
| TLS broker | 8883, TLS 1.2, ไม่มี client cert | `infra/mosquitto.conf:6-13` | exists; ดู G10 |
| Rate limit | token bucket ต่อ process, tier ตามแพลน, ต่อ IP สำหรับ enroll/logout/WS | `core/ratelimit.py`, `core/config.py:144-153` | exists; per-process เท่านั้น |
| Client IP | เชื่อ `X-Real-IP` เฉพาะจาก proxy ที่เชื่อถือ | `core/observability.py:151-164` | exists |
| CSP/headers | CSP, X-Frame-Options DENY, nosniff | `web/nginx.conf:57-60,115-118,127-128`, `tests/security/test_headers.py` | exists |
| Upload sandbox | converter ไม่มีเครือข่าย, root ro, cap_drop | `docker-compose.yml:158-170` | exists |
| Dependency lock | `bun install --frozen-lockfile` ใน CI และ Dockerfile | `.github/workflows/ci.yml:78`, `web/Dockerfile:9` | exists ฝั่ง web เท่านั้น |
| CI security | `make test-db`, `make test-security` รันใน CI | `.github/workflows/ci.yml:57-60` | exists |

---

## 4. รายการ gap เรียงตามระดับ

เจ้าของงาน: F05 = commands, F15 = deploy/backup, F18 = integration, F21 = งานใหม่ในเอกสารนี้

### 4.1 Critical

| ID | Gap | หลักฐาน | วิธีแก้เป็นรูปธรรม | เจ้าของ |
|---|---|---|---|---|
| G1 | **AI เขียน PLC ได้โดยยังไม่ผ่านการทดสอบกับ PLC จริง** | rule มี `dry_run` default true (`rules.py:219`) แต่ยังไม่มีการยืนยันบน PLC จริง | คง dry-run เป็นค่าเริ่มต้น; เพิ่ม gate "arming" ต่อ site ที่ต้องมี record ว่าทดสอบ commissioning แล้ว (ผู้ลงนาม + เวลา) ก่อนเปิด `ai_plc_write`; ต้อง step-up และ audit ตอนเปิด; interlock ซ้ำที่ PLC | F21 + F05 |
| G2 | **ไม่มี PLC busy-handshake** ระหว่าง AI trigger กับรถ/สายพาน | ไม่พบ ack จาก PLC ในเส้นทาง rules -> write | ให้ PLC ส่ง bit `ready/busy` กลับ; edge ตรวจ bit ก่อนเขียน และอ่านกลับหลังเขียน; ถ้าไม่ตอบให้ผลเป็น `unknown` ไม่ใช่ success | F05 (read-back) + ผู้ดูแล PLC |
| G3 | **`ca.key` อ่านได้ใน repo/host** | ไฟล์ `infra/certs/ca.key` อยู่ข้าง `ca.crt`; compose mount ทั้งโฟลเดอร์ `${CERTS_DIR:-./infra/certs}` (`docker-compose.yml:78,213,297`) ทำให้ container ที่ไม่ควรเห็นคีย์ CA เห็นได้ | mount เฉพาะ `ca.crt` ให้ client, เฉพาะ `server.crt/key` ให้ broker; เก็บ `ca.key` นอก repo/offline; ตรวจว่า `.gitignore` ไม่เก็บ `*.key`; prod ใช้ CA จริงหรือ cert จาก secret manager | F15 |

### 4.2 High

| ID | Gap | หลักฐาน | วิธีแก้ | เจ้าของ |
|---|---|---|---|---|
| G4 | **ลำดับการเขียนข้าม tag ไม่รับประกัน** | one-in-flight ต่อ tag เท่านั้น (ATTACK_PLAN A1) ไม่มีลำดับข้าม tag | ถ้าลำดับสำคัญ (เช่น วัสดุ แล้วค่อย trigger) ให้เขียนเป็น sequence เดียวที่ edge รับประกันลำดับ + read-back ทีละขั้น หรือรวมเป็น tag เดียวที่ PLC ตีความ | F05 |
| G5 | **backup ล้มเหลวแต่ยังลบไฟล์เก่า** | `infra/backup/backup.sh:25-26` รัน `rclone delete --min-age` ทุกรอบแม้ dump พัง; ไม่เห็นขั้นทดสอบ restore | นับจำนวน dump ที่สำเร็จ ลบเก่าเฉพาะเมื่อรอบนี้สำเร็จครบ; เก็บอย่างน้อย N ชุดล่าสุด; เพิ่ม `make restore` drill ใน CI หรือรายเดือน; แจ้งเตือนเมื่อ fail | F15 |
| G6 | **โมเดลมี scan ตอน upload แล้ว แต่ยังขาด integrity ต่อเนื่อง** (scanner มีจริง ไม่ใช่ gap) สิ่งที่ยังขาด: (a) worker ไม่ scan ซ้ำก่อน `YOLO(pt)` (`worker.py:13-15`) ถ้าไฟล์ใน spool ถูกสลับหลัง scan จะไม่มีด่านที่สอง มี sandbox เท่านั้น (b) hash ที่ model-server ตรวจมาจาก record ของ backend เอง ไม่ได้ผูกกับ hash ตอน scan ที่ converter แปลงเป็น ONNX จึงไม่มีสายต่อเนื่อง .pt -> .onnx (c) allowlist รวม root `torch`/`numpy` ทั้งก้อน (`ptscan.py:20`) ซึ่งกว้างกว่า symbol ที่จำเป็น | (a) เรียก `scan_pt` ซ้ำใน `converter.py` ก่อน spawn worker และเทียบ sha256 กับ record (b) บันทึก sha256 ของ .pt ต้นทางคู่กับ sha256 ของ .onnx ใน `model_artifacts` (c) ลด allowlist เป็นรายชื่อ symbol เมื่อมีข้อมูลจากโมเดลจริง; เพิ่ม seccomp profile ให้ sandbox | F21 |
| G7 | **edge เขียนค้างแล้วคิวติด** | `_OP_INFLIGHT_MAX` คุมเฉพาะ op (`edge-bridge/.../commands.py:37`); ไม่พบ timeout ของการเรียกเขียน PLC โดยตรง | ใส่ deadline ต่อการเขียน (เช่น `ttl_s`), ตัดไปสถานะ `unknown`, หยุดรับคำสั่งใหม่ของ tag นั้นจนกว่าจะอ่านกลับได้; backend `_watch` ตัด `timeout` อยู่แล้ว (`edge/commands.py:218`) | F05 |
| G8 | **backend ผูก `cmd-resp` กับคำสั่งโดยไม่เช็กว่า edge ไหนตอบ** | ATTACK_PLAN B25 ระบุ "accepted risk"; `resolve_op(command_id, edge_id, ...)` มี edge_id (`edge/commands.py:181`) แต่ `handle_response(command_id, status, ...)` ไม่รับ (`:194`) | ตรวจใน `handle_response` ว่า edge_id จาก topic ตรงกับ edge ที่คำสั่งถูกส่งไป; เพิ่มเทสต์ | F05 |
| G11 | **Supply chain: ไม่มี secret scan** | ไม่พบ gitleaks ใน `ci.yml` และเครื่องไม่ได้ติดตั้ง | เพิ่ม job gitleaks (pre-commit + CI) พร้อม baseline; ตรวจ `infra/secrets/` และ `infra/certs/` ว่าไม่ถูก track | F21 |
| G12 | **Supply chain: python deps/image ไม่ pin** | `pip install -r requirements.txt` ใน CI (`ci.yml:18,31,52`); base image `python:3.12-slim` ไม่มี digest (`backend/Dockerfile:3`, `edge-bridge/Dockerfile:6`, `model-converter/Dockerfile:3`); ฝั่ง web มี `bun.lock` ดีแล้ว | ใช้ `pip-compile --generate-hashes` หรือ `uv lock`; pin image ด้วย `@sha256`; เพิ่ม `pip-audit`, `bun audit` และ Trivy scan image ใน CI | F21 (+ ผู้ประสานงานแก้ `ci.yml`) |

### 4.3 Medium

| ID | Gap | หลักฐาน | วิธีแก้ | เจ้าของ |
|---|---|---|---|---|
| G9 | **cap WS ต่อ IP ทำงานต่างกันหลัง NAT** | `RATE_WS_PER_IP=20` (`config.py:153`) คีย์ด้วย IP; หลัง NAT โรงงานทั้งไซต์ใช้ IP เดียว ผู้ใช้ถูกบล็อกก่อนกำหนด; ถ้า proxy ไม่เชื่อถือ ทุกคนใช้ IP ของ proxy | key เพิ่มด้วย `sub`/org หลัง auth (cap ต่อ user และต่อ org) คง cap ต่อ IP เป็นชั้นก่อน auth เท่านั้น; ทำให้ค่าตั้งได้ต่อ site | F21 |
| G10 | broker ไม่ใช้ client cert; `tls_version tlsv1.2` | `mosquitto.conf:11-13` | พิจารณา mTLS ให้ edge (identity สองชั้น) และ TLS 1.3; ต้องเทียบกับต้นทุนการจัดการ cert | F15 / ตัดสินใจ D4 |
| G13 | rate limit อยู่ในหน่วยความจำต่อ process | `core/ratelimit.py:1-8` | ถ้าเพิ่ม replica ต้องย้ายไป Redis หรือ gateway | F15 |
| G14 | dedup ของ edge หายเมื่อ restart | INVARIANTS I12 | เก็บ `command_id` ล่าสุดบนดิสก์ (SQLite) ที่ edge | F05 |
| G15 | `style-src 'unsafe-inline'` | `web/nginx.conf:60` | ใช้ nonce/hash หรือย้ายสไตล์ออกเป็นไฟล์ | F21 (ต่ำ) |
| G16 | ไม่มีเทสต์ unit ที่ import โค้ดจริงของ edge/alarm หลายแถว | INVARIANTS I1, I2, I5, I6, I9 | เขียนตามตารางใน INVARIANTS; ตอนนี้ edge-bridge มีเทสต์ใน CI แล้ว (`ci.yml:21-22`) ต้องขยาย | F05 / F21 |
| G18 | realm prod ตั้ง `registrationAllowed: true` และ `loa-max-age` 36000 วินาที (10 ชั่วโมง) ทำให้ `acr=mfa` เก่าได้นาน ส่วน step-up ชดเชยด้วย `auth_time` 900 วินาที; prod compose ยังมี `kc-sync` ที่ตั้ง `APP_ENV: dev` | `infra/keycloak-prod/realm-wds.json:121`, `infra/keycloak/realm-wds.json:181,188`, `docker-compose.prod.yml:91` | ยืนยันว่า self-registration ตั้งใจเปิด (สอดคล้อง org signup) และมี `verifyEmail`; ลด loa-max-age ถ้าไม่จำเป็น; เทสต์ว่า prod realm ไม่เปิด direct grant | F15 / F21 |
| G17 | Step-up ปิดใน dev/test | `config.py:198` | CI ต้องมีเทสต์ที่เปิด `STEPUP_REQUIRED=1` เพื่อกัน regression | F21 |

---

## 5. ข้อกำหนดความปลอดภัยสำหรับ integration และ data feature (F18 และเกี่ยวข้อง)

ทั้งหมดนี้เป็น **proposed** ยังไม่มีโค้ด ยกเว้นที่ระบุ

### 5.1 per-org API key

| ข้อกำหนด | รายละเอียด | สถานะ |
|---|---|---|
| รูปแบบ | `prefix_id` + secret สุ่ม 32 byte; เก็บ hash เท่านั้น แสดงครั้งเดียว | exists พื้นฐาน (`api/api_keys.py:31,102`) |
| ขอบเขต | key ผูก org และ scope (เช่น `read:production`, `write:orders`) ห้ามมี scope สั่ง PLC | proposed |
| อายุ | มี `expires` อยู่แล้ว (`api_keys.py:102`); ตั้งค่าสูงสุดต่อ org และแจ้งเตือนก่อนหมด | exists บางส่วน |
| การเพิกถอน | revoke มีผลทันที (ไม่ cache เกิน TTL ของ authz record) | proposed; ตรวจ cache ใน `iam/security.py:411` |
| Audit | ทุกการสร้าง/ใช้/เพิกถอนลง audit chain | proposed สำหรับการใช้ |

### 5.2 Webhook signing (ออกจากเรา ไปยังลูกค้า)

| ข้อกำหนด | รายละเอียด |
|---|---|
| ลายเซ็น | header `X-Vissointan-Signature: t=<unix>,v1=<hex>` โดย `v1 = HMAC-SHA256(secret, t + "." + raw_body)` |
| Replay window | ผู้รับปฏิเสธถ้า `|now - t| > 300` วินาที; ส่ง `X-Vissointan-Event-Id` ให้ผู้รับ dedup |
| Secret | secret แยกต่อ endpoint ต่อ org; รองรับ rotation โดยลงนามคู่ (2 secret) ช่วงเปลี่ยน |
| เปรียบเทียบ | ใช้ constant-time compare |
| ปลายทาง | อนุญาต HTTPS เท่านั้น; ใช้ `core/egress.py` ตรวจ host (บล็อก private IP / metadata) ก่อนยิง |
| Retry | exponential backoff มีเพดาน; ไม่ retry เป็นเหตุการณ์ใหม่ (ใช้ event id เดิม) |

| Egress guard | exists: อนุญาต http(s), ทุก IP ที่ resolve ต้องเป็น public (บล็อก private/loopback/link-local/reserved/multicast และ IPv4-mapped), ห้ามมี credential ใน URL, ไม่ตาม redirect (`backend/app/core/egress.py:46-51,54-81,84-89`); ใช้แล้วที่ `alarming/push.py:92` และ `tenancy/workers.py:215` |
| ช่องที่ยังเหลือ | gap: DNS rebinding ระหว่างตรวจกับเชื่อมต่อ (docstring `egress.py:10-14` ยอมรับเอง) และ `WDS_EGRESS_ALLOW_PRIVATE` ปิดการบล็อกทั้งหมด ต้องไม่ตั้งใน prod; แก้ด้วย egress proxy |

### 5.3 ERP credentials

| ข้อกำหนด | รายละเอียด |
|---|---|
| ที่เก็บ | เข้ารหัสแบบ envelope (key ต่อ org ห่อด้วย master key จาก secret) ห้ามเก็บ plaintext ใน DB หรือ log; repo มี `data_source_key` ใน secrets เป็นแนวทางเดิมที่ใช้ต่อได้ (`infra/secrets/data_source_key`) |
| การอ่าน | API คืนเฉพาะ mask (4 ตัวท้าย); การอ่านค่าจริงทำได้เฉพาะ worker |
| สิทธิ์ใน ERP | ขอ account แบบ least privilege, อ่านเป็นหลัก; ห้ามให้ ERP เรียกกลับมาสั่ง PLC โดยตรง |
| Rotation | มีปุ่ม rotate และ audit |

### 5.4 Export controls

| ข้อกำหนด | รายละเอียด |
|---|---|
| สิทธิ์ | export ต้องมี role และ step-up สำหรับชุดข้อมูลขนาดใหญ่ |
| ขอบเขต | บังคับผ่าน RLS context เดียวกับ API ปกติ ห้ามใช้ role owner |
| CSV injection | escape เซลล์ที่ขึ้นต้นด้วย `= + - @` |
| ลิงก์ดาวน์โหลด | signed URL อายุสั้น (นาที) ผูกกับ org และ user; ลบไฟล์หลังหมดอายุ |
| บันทึก | audit ว่าใคร export อะไร กี่แถว |

### 5.5 Tenant data deletion

| ข้อกำหนด | รายละเอียด |
|---|---|
| ขอบเขต | DB (ทุกตารางที่มี org_id), Garage objects, dynsec identities ของ edge, API keys, backup |
| ขั้นตอน | request -> step-up -> ช่วงพัก 7 วัน (ยกเลิกได้) -> ลบจริง -> ออก deletion certificate |
| Audit chain | audit เป็น chain ต่อ org; ต้องตัดสินใจว่าจะเก็บ hash สรุปสุดท้ายแทนการลบทั้งหมด (D6) |
| Backup | backup เก่ายังมีข้อมูล; ต้องระบุอายุเก็บ (`KEEP_DAYS`) ในสัญญา และห้ามกู้คืนข้อมูลที่ลบแล้ว |
| ทดสอบ | เทสต์ว่าไม่เหลือแถวใดอ้าง org นั้น และ storage ว่าง |

---

## 6. แผนทดสอบความปลอดภัย

### 6.1 Suite ที่มีอยู่

| Suite | ครอบคลุม | หลักฐาน |
|---|---|---|
| `make test-security` | BOLA, auth bypass, RBAC/function-level, 429, headers, WS admission, infra, storage isolation, org signup | `tests/security/*.py`, `Makefile:143` |
| `make test-db` | RLS / tenant isolation / audit ด้วย role runtime | `Makefile:72` |
| `pytest -m integration` | command lifecycle, MQTT malformed, clock skew | `tests/ATTACK_PLAN.md` A, B |
| edge-bridge unit tests | PLC write gate | `.github/workflows/ci.yml:21-22` |
| ATTACK_PLAN ที่ยัง ⬜ | A5, A8, B6, B20-B21, B23-B25 | `tests/ATTACK_PLAN.md` |

### 6.2 เทสต์ใหม่ที่เสนอ

| ID | เทสต์ | ชนิด | ปิด gap |
|---|---|---|---|
| T1 | AI rule ที่ `dry_run=false` แต่ site `control_enabled=false` ต้องไม่เขียน | pytest edge unit | G1 |
| T2 | arming record หาย -> เปิด `ai_plc_write` ไม่ได้ | pytest API | G1 |
| T3 | PLC mock ไม่ตอบ busy/read-back -> สถานะ `unknown` ไม่ใช่ `done` | pytest edge | G2, G7 |
| T4 | `cmd-resp` จาก edge อื่นต้องถูกทิ้ง | pytest integration | G8 |
| T5 | restart edge แล้วส่ง `command_id` เดิมซ้ำ ต้องไม่เขียนซ้ำ | pytest edge | G14 |
| T6 | backup จำลอง dump fail -> ต้องไม่ลบไฟล์เก่า | shell test ใน CI | G5 |
| T7 | compose ไม่ mount `ca.key` เข้า container ใด | `tests/security/test_infra.py` เพิ่มเคส | G3 |
| T8 | worker ปฏิเสธ .pt ที่ไฟล์ถูกสลับหลัง upload (re-scan + sha256 ไม่ตรง); provenance ของ .onnx ตรงกับ .pt ที่ scan (เทสต์ upload ที่ได้ 422 มีอยู่แล้วใน `tests/contract/test_ptscan.py`) | pytest converter + edge | G6 |
| T9 | WS cap ต่อ user/org ไม่ถูกกระทบเมื่อหลาย user ใช้ IP เดียวกัน | `test_ws_admission.py` | G9 |
| T10 | `STEPUP_REQUIRED=1`: คำสั่งที่ `acr!=mfa` หรือ auth_time เก่าได้ 401 | pytest API | G17 |
| T11 | webhook: ลายเซ็นผิด, timestamp เก่า, replay event id ถูกปฏิเสธ | pytest (F18) | 5.2 |
| T12 | Playwright: viewer ไม่เห็นปุ่มสั่ง และ API ตอบ 403 เมื่อยิงตรง | Playwright + API | RBAC |
| T13 | Playwright: คำสั่งควบคุมเด้ง step-up แล้วทำต่อได้ | Playwright (ใช้ `.dev-demo` sign-in ตามบันทึก) | step-up |
| T14 | Playwright: ตรวจ response header CSP บนทุกหน้าหลัก | Playwright | G15 |

### 6.3 CI gate ขนาดเล็กที่เสนอ

| Gate | คำสั่ง | บล็อก merge เมื่อ |
|---|---|---|
| secret scan | `gitleaks detect --redact` | พบ secret ใหม่ |
| dep audit | `pip-audit -r backend/requirements.txt`, `bun audit` | พบช่องโหว่ระดับ high ขึ้นไปที่แก้ได้ |
| image scan | `trivy image --severity HIGH,CRITICAL --exit-code 1` | พบ critical |
| compose lint | เทสต์ T7 | `ca.key` ถูก mount |
| security suite | `make test-db test-security` | เทสต์ล้ม (มีอยู่แล้ว `ci.yml:57-60`) |
| safety tests | T1, T3, T4, T5 | ล้ม |

เริ่มแบบ "รายงานอย่างเดียว" 1 สัปดาห์ ก่อนเปลี่ยนเป็นบล็อก เพื่อไม่ให้ CI ที่เพิ่งเขียวกลับมาแดงโดยไม่รู้ตัว

---

## 7. ฟีเจอร์ที่เสนอ F21 (ใช้รูปแบบเดียวกับ `docs/product-gap-plan.md`)

### F21 Security hardening (L)

- **รอบ:** หลังรอบ 2 (ต้องรอ F05) และก่อน F15/F18 ปิดงาน
- **เป็นเจ้าของ:** `docs/security/`, `docs/security-design.md`, `tests/security/`, `backend/app/core/egress.py`, `backend/app/core/ratelimit.py`, `model-converter/`, `scripts/security/` (ใหม่), `edge-bridge/edge_bridge/vision/arming.py` (ใหม่), migration `0070` และ `0071`
- **ต้องให้ผู้ประสานงานแก้:** `.github/workflows/ci.yml`, `docker-compose*.yml`, `backend/requirements.txt`, `backend/app/main.py`
- **ห้ามแตะ:** `backend/app/edge/commands.py` และ `edge-bridge/edge_bridge/commands.py` (เจ้าของคือ F05), `infra/` และ `DEPLOY.md` (เจ้าของคือ F15)
- **migration ที่จอง**
  - `0070` ตาราง `site_ai_arming` (org_id, site_id, armed_by, armed_at, evidence_ref, revoked_at) พร้อม RLS และ FORCE RLS
  - `0071` ตาราง `model_artifacts` (org_id, sha256, kind, scan_result, created_at) และคอลัมน์ checksum ที่เกี่ยวข้อง
- **สกิล:** `security-review`, `engineering:testing-strategy`, `engineering:code-review`, `test-driven-development`, `verification-before-completion`
- **งาน**
  - [ ] G1: gate "arming" ก่อนเปิด `ai_plc_write` ต้อง step-up และลง audit; ค่าเริ่มต้นยังเป็น dry-run
  - [ ] G6: scan ซ้ำใน converter ก่อน `YOLO(pt)` และเทียบ sha256 กับ `model_artifacts`; บันทึก provenance .pt -> .onnx (scanner ตอน upload มีแล้ว ไม่ต้องเขียนใหม่)
  - [ ] G9: เปลี่ยน cap WS เป็นต่อ user/org หลัง auth และคง cap ต่อ IP ก่อน auth
  - [ ] G11/G12: ร่าง gitleaks, pip-audit, Trivy และ lock file แบบ hash เป็นสคริปต์ใน `scripts/security/` ให้ผู้ประสานงานต่อเข้า `ci.yml`
  - [ ] G15, G17: เพิ่มเทสต์ CSP และเทสต์ step-up แบบเปิดบังคับ
  - [ ] เขียนเทสต์ T1, T2, T8, T9, T10 ก่อนโค้ด และ T12-T14 ใน Playwright
  - [ ] ใช้ `egress.check_url(..., https_only=True)` กับ webhook ใหม่ของ F18 และเพิ่มเทสต์ DNS rebinding ตามที่ docstring ยอมรับว่ายังไม่ปิดสนิท
- **เสร็จเมื่อ**
  - เปิด AI เขียน PLC ไม่ได้ถ้าไม่มี arming record และทุกการเปิดมีผู้ลงนามใน audit
  - .pt ที่ไม่ผ่าน scan ซ้ำหรือ hash ไม่ตรงไม่ถูกส่งเข้า sandbox และโมเดลที่ provenance ไม่ตรงไม่ถูกเปิดใช้
  - CI มี secret scan, dependency audit และ image scan ครบ และ `make test-security` เขียว
  - เทสต์ T1, T2, T8-T10 ผ่าน พร้อมผลรันจริงในรายงานส่งงาน

### งานที่ส่งต่อให้เจ้าของอื่น (ไม่อยู่ใน F21)

| งาน | เจ้าของ |
|---|---|
| G2, G4, G7, G8, G14 (busy handshake, ลำดับ, deadline, ผูก edge_id, dedup ถาวร) | F05 |
| G3, G5, G10, G13 (`ca.key`, backup, mTLS, rate limit แบบแชร์) | F15 |
| ข้อกำหนดหัวข้อ 5 (API key, webhook, ERP, export, deletion) | F18 |

---

## 8. เรื่องที่ต้องให้ผู้ใช้หรือโรงงานตัดสินใจ

| ID | คำถาม | ผลต่อแผน |
|---|---|---|
| D1 | PLC รุ่นใดและ tag ใดบ้างที่ AI ได้เขียน และมีบิต busy/ready ให้ใช้ได้ไหม | กำหนด G1/G2 |
| D2 | ใครมีอำนาจลงนาม arming ของ site (ผู้จัดการโรงงานหรือวิศวกรควบคุม) | รูปแบบ record ใน `site_ai_arming` |
| D3 | ถ้าผล AI ออกหลังรถออกไปแล้ว PLC ควรทำอะไร (ค้างใน product-gap-plan) | กติกาปฏิเสธผลที่สาย |
| D4 | ยอมรับต้นทุนจัดการ cert ของ mTLS ต่อ edge หรือไม่ | G10 |
| D5 | ลำดับการเขียนข้าม tag ที่ต้องรับประกันมีอะไรบ้าง | G4 |
| D6 | ตอนลบ tenant จะเก็บ hash สุดท้ายของ audit chain ไว้หรือไม่ และ backup เก็บกี่วัน | หัวข้อ 5.5 |
| D7 | ใช้ `pip-compile`/`uv` อย่างใดอย่างหนึ่ง และยอมให้ CI บล็อกเมื่อ scan พบ high หรือไม่ | G12 |
| D8 | ERP เป้าหมายคืออะไร และฝั่งโรงงานยอมให้ outbound จาก API ได้หรือไม่ | หัวข้อ 5, F18 |

---

## หมายเหตุขอบเขตการตรวจ

อ่านโดยตรงในรอบนี้: `tests/ATTACK_PLAN.md`, `tests/INVARIANTS.md`, `deps.py` (ส่วน MFA/step-up), `db/context.py`, หัวข้อของ `iam/security.py`, `edge/dynsec.py` (ACL), `infra/mosquitto.conf`, `infra/backup/backup.sh`, `model-converter/`, `web/nginx.conf`, `ci.yml`, ส่วนที่เกี่ยวของ `docker-compose.yml`

ยังไม่ได้อ่านเต็ม: realm Keycloak (`infra/keycloak*/realm-wds.json`) ว่า MFA/brute-force/password policy ตั้งไว้อย่างไร, `infra/postgres/init/*.sh` รายละเอียด GRANT, `core/egress.py`, `edge/credpush.py` และ `docker-compose.prod.yml` จึงยังไม่ให้ข้อสรุปเรื่องนั้น ควรตรวจเป็นงานแรกของ F21
