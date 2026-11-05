# SCADA Parity — Design (ISA-95, Historian, Derived Tags, MFA/IEC 62443, PWA, BACnet/Sparkplug B, Recipe/SFC)

*Date: 2026-10-19 · Branch base: `ui-v4` · Status: draft for approval*
*ภาษา: เนื้อหาหลักเป็นภาษาไทย ศัพท์เทคนิคคงเป็นภาษาอังกฤษ; ข้อความบน UI ทุกจุดต้องมีทั้ง TH และ EN (ADR-14, `scripts/check-i18n`)*

---

## 0. ที่มาและเจตนา (Intent & why)

เป้าหมายคือทำให้ webservice มี feature ระดับเดียวกับ SCADA เชิงพาณิชย์ที่ guide อ้างถึง
(Appomax SCADA features, Pronto "Top features") โดยใช้ต้นแบบ 3 แหล่ง:

| แหล่ง | เอามาจากตรงไหน |
|---|---|
| **Datadog** | ภาษาภาพ (dd-theme ที่ใช้อยู่แล้ว), formula editor แบบ `a*0.5` เลือกตัวแปรจาก dropdown, tag explorer, facet/filter, monitor-style setup |
| **Siemens WinCC Unified / SIMATIC Batch** | Plant model (hierarchy), plant-hierarchy authorizations, recipe view, sequence ที่มี hold/resume/abort |
| **Mitsubishi ICONICS GENESIS64 / MC Works64** | AssetWorX (asset tree), BACnet connector, Hyper Historian (rollup + compression), mobile "Anywhere" |

**Security เป็นอันดับหนึ่ง** — ทุกที่ที่ต้องเลือกระหว่าง "ง่าย" กับ "ปลอดภัย" ให้เลือก
ปลอดภัยเป็นค่าเริ่มต้น แล้วทำให้ทาง "ปลอดภัย" ใช้ง่ายที่สุดเท่าที่ทำได้ (secure by default,
not secure by friction)

**เกณฑ์ใช้งานจริง (usability bar):** ทุก feature ต้องผ่านการประเมินกับ 3 persona ด้านล่าง
แต่ละ section มีตาราง "ใช้ยากง่ายแค่ไหน" บอกจำนวนขั้นตอน จุดที่ผู้ใช้จะติด และวิธีแก้

| Persona | ใคร | ความคาดหวัง |
|---|---|---|
| **Operator (ช่างหน้างาน)** | ดูค่า, รับ alarm, กดสั่งงาน, ใช้มือถือ | ไม่อยากพิมพ์ ไม่อยากตั้งค่า กดน้อยที่สุด อ่านภาษาไทยได้ทันที |
| **Engineer (วิศวกร/integrator)** | สร้าง tag, เชื่อม PLC, เขียนสูตร, ทำ recipe/sequence | อยากได้ความเร็ว + preview ผลทันที + error ที่ชี้ตำแหน่ง |
| **Admin/IT** | ผู้ใช้, MFA, สิทธิ์, audit, compliance | อยากได้นโยบายที่บังคับใช้ได้ และหลักฐานสำหรับ audit |

---

## 1. Goals / Non-goals / Anti-goals

**Goals**
1. MFA (TOTP) + step-up สำหรับการสั่งงานเครื่องจักร และเอกสาร IEC 62443 mapping (self-assessment)
2. ลำดับชั้น ISA-95 ครบ: Enterprise(org) › Site › **Area** › Line/Cell › **Equipment** พร้อมสิทธิ์ราย Area
3. Historian บน TimescaleDB: hypertable, compression, continuous aggregates (1m/1h), query เลือก rollup อัตโนมัติ
4. Derived/Calculated tags: สูตร + ฟังก์ชันช่วงเวลา (moving avg, delta, rate) — คำนวณฝั่ง backend
5. PWA + มือถือ: ติดตั้งได้, layout มือถือ, Web Push สำหรับ alarm
6. Protocol: BACnet/IP และ MQTT Sparkplug B เป็น data source ใหม่ของ edge-bridge
7. Recipe (parameter set) + Sequence (SFC แบบเส้นตรงมีเงื่อนไข) ที่สั่งงานผ่าน command path เดิมทุกขั้น

**Non-goals (รอบนี้ไม่ทำ)**
- Drag-and-drop HMI/mimic editor (อยู่ในรายการรอบก่อน แต่ไม่ได้เลือกในรอบนี้)
- รับ Sparkplug B จากอุปกรณ์ภายนอก **ตรงเข้า cloud broker** — รอบนี้รับผ่าน edge-bridge เท่านั้น (เหตุผล §7.2)
- Safety function (SIS/IEC 61511): sequence ของเราเป็น supervisory เท่านั้น interlock ด้านความปลอดภัยต้องอยู่ใน PLC
- ISA-88 batch record เต็มรูปแบบ, electronic signature แบบ 21 CFR Part 11
- ขอ certification IEC 62443 จริง — เอกสารเป็น self-assessment
- Native mobile app (iOS/Android) — ใช้ PWA

**Anti-goals (ถ้าเกิดสิ่งนี้ ถือว่าล้มเหลวแม้ระบบจะทำงานได้)**
- สูตร derived tag รันโค้ดอะไรก็ได้ (`eval`, Python expression) — ต้องเป็นภาษาจำกัดที่ parse เอง
- ข้อมูลข้าม tenant รั่วผ่าน rollup/view ใหม่ที่ไม่มี RLS
- Sequence เดินต่อเองหลัง backend restart โดยไม่มีคนยืนยัน
- มือถือเก็บข้อมูลโรงงาน (API response) ไว้ใน cache หลัง logout
- MFA ที่ admin ปิดให้ตัวเองได้เงียบ ๆ โดยไม่มี audit
- ย้ายเครื่องจักรใน asset tree แล้ว tag path เปลี่ยน → dashboard/alarm/สูตรพังทั้งหมด

---

## 2. Constraints (จากโค้ดที่มีอยู่)

- Backend FastAPI + asyncpg, Postgres 16 (`postgres:16-alpine`), **RLS ทุกตาราง tenant** ผ่าน `tenant_tx` / `wds_ctx_org()`
- Migration เป็นคู่ `.py` + `.sql` (ADR-0001) ล่าสุดคือ `0049`; migration ที่ apply แล้วห้ามแก้
- Router ใหม่ใส่ใน package ตาม domain ห้ามเพิ่ม route ใน `main.py`
- Ingest อยู่ใน `main.py::_handle_telemetry` → `tag_latest` upsert → `alarms.evaluate` → `history_buf` → WS broadcast
- Backend รัน **instance เดียว** (ไม่มี replicas ใน compose) — engine ใน process (derived tags, sequence) ใช้ได้ แต่ต้องเขียนให้ไม่พังถ้าวันหนึ่งมีสอง instance (ใช้ advisory lock เป็น leader)
- Identity: **Keycloak 26.4** (realm `wds`) + OIDC JWT; backend ตรวจ JWT ใน `iam/security.py`, `Principal` ใน `iam/auth.py`
- Command path: `edge/commands.py::issue` มี gate ครบ (idempotency, in-flight 409, rate limit, site `control_enabled`, audit `command_events`)
- Edge config ส่งผ่าน MQTT `cfg` (`datasources/publisher.py`); `data_sources.protocol` CHECK อยู่ที่ `('sim','modbus','s7','opcua')`
- Web: React + i18next (`web/src/lib/i18n.ts` + `features/*/i18n.ts`), nav ที่ `web/src/app/nav.ts`, ธีม `dd-theme.css`
- Tag มี `path` แบบ UNS (`^[a-z0-9_]+(/[a-z0-9_]+){1,7}$`), `type` ∈ {bool, number}, `device_id` ชี้ `devices`

---

## 3. ลำดับการทำ (Recommended order) และเหตุผล

| Phase | Feature | ทำไมอยู่ตรงนี้ |
|---|---|---|
| **P0** | MFA + step-up + IEC 62443 doc (โครง) | Security มาก่อน และ step-up เป็น gate ที่ P5/P6 ต้องใช้ |
| **P1** | ISA-95 hierarchy + Area permissions | เป็นฐานของทุกอย่าง (tag, สิทธิ์, recipe, sequence ผูกกับ Area/Equipment) |
| **P2** | TimescaleDB historian | ผู้ใช้ไม่เห็น แต่ต้องทำก่อนข้อมูลโต ย้ายทีหลังเจ็บกว่า; ทำขนานกับ P1 ได้ |
| **P3** | Derived tags | ต้องใช้ hierarchy (เลือก tag จาก tree) และ rollup (warm-up หน้าต่างเวลา) |
| **P4** | PWA + Web Push | ต้องมีข้อมูล/alarm ที่ดีก่อนจะเอาไปบนมือถือ |
| **P5** | BACnet + Sparkplug B | เพิ่ม attack surface → ทำหลังจาก security/สิทธิ์พร้อม |
| **P6** | Recipe → Sequence (SFC) | เสี่ยงสุด (สั่งเครื่องหลายขั้น) ต้องใช้ step-up (P0), area permission (P1), expression (P3) |
| ทุก phase | อัปเดต IEC 62443 mapping | แต่ละ phase เพิ่มแถวหลักฐานในเอกสาร |

แต่ละ phase = 1 implementation plan + 1 PR แยก (merge ได้อิสระ ยกเว้น dependency ในตาราง)

---

## 4. P0 — MFA (TOTP) + Step-up + IEC 62443

### 4.1 Design

**หลักการ:** MFA อยู่ที่ Keycloak (แบบเดียวกับ Ignition/WinCC ที่ฝากไว้กับ IdP) backend ไม่เก็บ TOTP secret เอง
— ลดสิ่งที่ต้องปกป้อง และได้ brute-force protection ของ Keycloak (เปิดอยู่แล้ว `bruteForceProtected: true`)

1. **Realm config** (`infra/keycloak/realm-wds.json` + `infra/keycloak-prod/realm-wds.json`)
   - OTP policy: TOTP, 6 หลัก, 30 วินาที, HmacSHA1 (เข้ากันได้กับ Google Authenticator / Microsoft Authenticator)
   - Browser flow ใหม่ `browser-loa`: Cookie → Username/Password (LoA 1) → Conditional OTP (LoA 2)
   - `acr.loa.map`: `{"pwd": 1, "mfa": 2}` → token มี claim `acr` = `pwd` หรือ `mfa`
   - เพิ่ม mapper `amr` + `auth_time` ใน client `wds-web`
   - Recovery codes ของ Keycloak (ถ้า feature เปิดได้ใน 26.4) ไม่เช่นนั้นใช้ admin reset (ข้อ 4)
2. **Org policy** — migration `0050_mfa_policy`: `organizations.mfa_required boolean NOT NULL DEFAULT false`,
   `organizations.stepup_max_age_s integer NOT NULL DEFAULT 900 CHECK (BETWEEN 300 AND 3600)`, `api_keys.allow_control`
   (org ใหม่ที่สร้างผ่าน onboarding หลัง migration ตั้ง `mfa_required = true` — secure by default; เจ้าของ org ใหม่จะเจอหน้า
   ตั้ง Authenticator เป็นอย่างแรก; org เก่าคงเดิมแล้วโชว์ banner แนะนำ)
   - User ที่อยู่หลาย org: นโยบายประเมินตาม org ของ request แต่ละครั้ง (token เดียว ใช้ได้กับ org ที่ไม่บังคับ)
3. **Backend enforcement** (`iam/security.py`, `iam/auth.py`, `deps.py`)
   - `Principal` เพิ่ม `acr: str`, `auth_time: float`
   - ถ้า org ของ request มี `mfa_required` และ `acr != "mfa"` → `401 {"detail":"mfa_required"}` (ยกเว้น endpoint
     `/me`, logout, และหน้าตั้งค่า MFA)
   - **Step-up:** dependency `require_recent_mfa(max_age_s=config.STEPUP_MAX_AGE_S /*default 900*/)` ใช้กับ:
     command issue, recipe download, sequence start/resume, เปลี่ยน `mfa_required`, จัดการ API key, เปลี่ยน role
     → ถ้า `acr != "mfa"` หรือ `now - auth_time > max_age` → `401 {"detail":"step_up_required"}`
   - API key (machine principal) ไม่มี MFA → **ห้ามใช้ endpoint ที่ต้อง step-up** (403 `apikey_not_allowed`)
     *ยกเว้น* command issue สำหรับ key ที่มี `api_keys.allow_control = true` (คอลัมน์ใหม่, default false) ซึ่งตั้งได้ตอนสร้าง
     key เท่านั้นและผู้สร้างต้องผ่าน step-up, audit `api_key.control_granted` — **พฤติกรรมเปลี่ยน:** วันนี้ key ที่มี role
     operator สั่งงานได้; หลัง P0 key เดิมทั้งหมดสั่งไม่ได้จนกว่าจะออก key ใหม่ที่เปิด allow_control (หมายเหตุใน release notes)
     *[การตัดสินใจของผู้ออกแบบ — security first]*
   - ผู้ใช้ที่ยังไม่มี OTP แล้วถูกขอ `acr_values=mfa`: OTP Form ใน flow ตั้งเป็น REQUIRED ที่ LoA 2 → Keycloak เพิ่ม required
     action `CONFIGURE_TOTP` ให้เอง (ตั้งค่าแล้วได้ acr=mfa ในรอบเดียว) — ต้องยืนยันใน spike วันแรกของ P0
4. **Admin reset MFA** — `POST /api/v1/orgs/{org}/members/{user}/mfa/reset` (owner/admin + step-up) เรียก Keycloak admin
   API ลบ OTP credential ของ user นั้น → audit `mfa.reset` → user ต้องตั้งใหม่ตอน login ถัดไป
   (owner reset ตัวเองไม่ได้ ต้องให้ owner/admin อีกคน — four-eyes)
5. **Audit:** `mfa.enrolled` (จาก Keycloak event listener หรือ first-seen acr=mfa), `mfa.policy_changed`, `mfa.reset`,
   `auth.step_up`

### 4.2 UX (Datadog-style)

- **บังคับใช้:** org ที่ `mfa_required` → login ครั้งแรก Keycloak บังคับ "ตั้งค่า Authenticator" (required action
  `CONFIGURE_TOTP`) หน้าจอมี QR + ช่องกรอก 6 หลัก — Keycloak theme ต้องมีภาษาไทย (`messages_th.properties`)
- **Step-up modal:** กดสั่งงาน → ถ้าต้อง step-up โชว์ modal "ยืนยันตัวตนอีกครั้ง" → redirect ไป Keycloak พร้อม
  `acr_values=mfa&max_age=0` → กลับมาที่หน้าเดิมแล้ว **ส่งคำสั่งที่ค้างไว้ต่อทันทีหลังผู้ใช้กดยืนยันอีกครั้ง**
  (เก็บ intent ใน `sessionStorage` ไม่เก็บค่า token) — ผู้ใช้ไม่ต้องเริ่มใหม่
- **Settings › Security:** การ์ด "Two-factor authentication" สถานะ (เปิด/ปิด), ปุ่ม "บังคับทั้งองค์กร" พร้อมจำนวนคนที่ยัง
  ไม่ได้ตั้ง ("5 จาก 12 คนยังไม่ได้ตั้ง MFA") แบบ Datadog org settings
- **Members table:** คอลัมน์ MFA ✓/— และเมนู "Reset MFA"

| ข้อความ | EN | TH |
|---|---|---|
| step-up title | Confirm it's you | ยืนยันตัวตนอีกครั้ง |
| step-up body | Sending commands to equipment needs a fresh code from your authenticator app. | การสั่งงานเครื่องจักรต้องยืนยันด้วยรหัสจากแอป Authenticator อีกครั้ง |
| policy toggle | Require two-factor authentication for everyone | บังคับให้ทุกคนใช้การยืนยันตัวตนสองขั้นตอน |
| reset confirm | {{name}} will set up a new authenticator at next sign-in. | {{name}} จะต้องตั้งค่าแอป Authenticator ใหม่ในการเข้าสู่ระบบครั้งถัดไป |

### 4.3 ใช้ยากง่ายแค่ไหน

| Persona | ขั้นตอน | จุดที่จะติด | แก้ด้วย |
|---|---|---|---|
| Operator | ตั้งครั้งเดียว ~1 นาที; step-up ทุก 15 นาทีที่สั่งงาน | ทำมือถือหาย, ไม่มีแอป | หน้าตั้งค่าแนะนำแอปที่ใช้ได้ (TH), admin reset ได้ทันที |
| Operator | step-up ระหว่างกำลังสั่ง | กลัวคำสั่งหาย | resume intent หลัง redirect |
| Admin | เปิด policy 1 คลิก | ไม่รู้ว่าใครยังไม่ตั้ง | ตัวนับ + filter "ยังไม่ตั้ง MFA" |

**ความยาก: ง่าย** (ผู้ใช้คุ้นเคยกับ 2FA จากธนาคาร/LINE) — ความเสี่ยงคือ step-up ถี่เกินไป → `STEPUP_MAX_AGE_S` ปรับได้ต่อ org (300–3600)

### 4.4 IEC 62443 mapping document

ไฟล์ `docs/security/iec62443-mapping.md` (อังกฤษ เพราะใช้เป็นหลักฐาน audit) — **self-assessment, target SL2**

1. **Zones & conduits** (diagram): Enterprise/Users zone → Cloud zone (web, backend, Postgres, Keycloak, Garage) →
   Conduit MQTT/TLS + dynsec → Edge zone (edge-bridge) → Control zone (PLC/BACnet/Sparkplug devices)
2. **ตาราง FR1–FR7 (IEC 62443-3-3 SR)**: แต่ละ SR → สถานะ (Met / Partial / Gap) → หลักฐาน (ไฟล์:บรรทัด, test, config)
   เช่น SR 1.1 Human user identification → Keycloak OIDC + `iam/security.py`; SR 1.1 RE2 MFA → P0; SR 2.1
   Authorization enforcement → RLS + role + area grants (P1); SR 3.3 Security functionality verification → `tests/security/`;
   SR 6.1 Audit log accessibility → `audit_log` + export; SR 5.1 Network segmentation → zones; SR 7.x → backups, rate limit
3. **IEC 62443-4-1 (SDL) practices** ที่มี: threat model (`docs/security/storage-and-ai-threat-model.md`), code review,
   CI security tests, dependency pinning
4. **Gap list + แผน** (ต่อท้าย) — อัปเดตทุก phase

---

## 5. P1 — ISA-95 Hierarchy (Area + Equipment) + Area permissions

### 5.1 Model

```
Enterprise  = organizations        (มีอยู่)
Site        = sites                (มีอยู่)
Area        = areas                (ใหม่)
Line/Cell   = lines + kind         (มีอยู่ + เพิ่ม kind: line | cell | unit)
Equipment   = devices              (มีอยู่ — UI เปลี่ยนชื่อเป็น "Equipment / เครื่องจักร")
Tag         = tags.device_id       (มีอยู่)
```

Migration `0051_isa95_hierarchy`:
- `areas(id, org_id, site_id, name, code, sort, created_at)` UNIQUE (org_id, site_id, code), FK site, RLS policy เหมือนตารางอื่น
- `lines.area_id uuid NULL` FK `(org_id, area_id) → areas` ON DELETE RESTRICT; `lines.kind text NOT NULL DEFAULT 'line'`
- **Backfill:** แต่ละ site ที่มี line → สร้าง area `default` ("General / ทั่วไป") แล้วผูก line ทั้งหมด จากนั้นตั้ง
  `area_id NOT NULL` — ทุก line อยู่ใน area เสมอ (query ง่าย, ไม่มี null branch)
- `devices.kind text NULL` (motor, conveyor, vessel, valve, pump, mixer, indicator, other — ตรงกับ `plant_parts.kind`)
- `plant_parts.device_id uuid NULL` FK → devices — ผูกชิ้นส่วน 3D กับ Equipment จริง (ตอนนี้ equipment ของ 3D แยกขาด)

**กฎสำคัญ:** `tags.path` **ไม่ขึ้นกับ hierarchy** — ย้าย equipment ข้าม line/area ได้โดย path ไม่เปลี่ยน (anti-goal)

### 5.2 Area permissions (plant-hierarchy authorization แบบ WinCC)

- `area_grants(org_id, user_id, area_id)` — grant = "สั่งงานได้ใน area นี้" (การดูข้อมูลยังเป็นระดับ org; จำกัดการดูราย area = non-goal รอบนี้)
- กฎ: org role `owner/admin` สั่งได้ทุก area; org role `operator` **ถ้ามี grant อย่างน้อย 1 แถว** →
  สั่งงานได้เฉพาะ area ที่ได้ grant (area อื่นดูได้แต่สั่งไม่ได้); ไม่มี grant เลย = ทุก area (ไม่ทำให้ org เดิมพัง);
  `viewer` สั่งไม่ได้เหมือนเดิม; API key ใช้ grant ของ service user ของมัน
- Enforcement อยู่ที่ backend ใน `commands.issue`, recipe download, sequence start (หา area จาก tag → device → line → area)
  — ไม่ใช้ RLS สำหรับกฎนี้ (RLS คือ tenant boundary; area เป็น authorization ชั้นบน) แต่มี test ครบทุก endpoint ที่เขียน
- Audit: `area_grant.created/deleted`

### 5.3 API

`/api/v1/orgs/{org}/sites/{site}/areas` CRUD, `/lines` เพิ่ม `area_id`/`kind`, `/devices` เพิ่ม `kind`,
`GET /api/v1/orgs/{org}/sites/{site}/hierarchy` → tree เดียวทั้ง site (area › line › equipment › tag count + alarm count)
ใช้โดย asset tree, tag picker, scope selector

### 5.4 UX

- **Asset tree** (หน้า "Assets" เดิม `features/catalog` ขยาย) — ซ้ายเป็น tree แบบ ICONICS AssetWorX, ขวาเป็นรายละเอียด
  node (tags, alarms ที่ active, trend เล็ก, 3D part ที่ผูก) — drag เพื่อย้าย equipment/line (confirm dialog บอกว่า
  "tag path ไม่เปลี่ยน")
- **Scope selector บน header** (มี `lib/scope.ts` อยู่แล้ว) เพิ่มระดับ Area/Line → ทุกหน้ากรองตามที่เลือก (pattern เดียวกับ
  `lib/equipment.ts` ที่จำการเลือกข้ามหน้า)
- **Bulk assign:** ในหน้า Tags เลือกหลาย tag → "ย้ายไปที่ Equipment…" (ลดงานคนที่มี tag เป็นร้อย)
- **Quick start:** ถ้า site ยังไม่มี area → empty state "จัดโครงสร้างโรงงาน" + template (Area → Line → Equipment) สร้างได้ใน 1 หน้า

| ข้อความ | EN | TH |
|---|---|---|
| area | Area | พื้นที่ |
| line | Line | ไลน์ผลิต |
| cell | Cell | เซลล์ |
| equipment | Equipment | เครื่องจักร |
| move confirm | Tag paths stay the same — dashboards and alarms keep working. | path ของ tag ไม่เปลี่ยน — dashboard และ alarm ยังทำงานตามเดิม |
| grant hint | Operators with area access can only send commands in those areas. | Operator ที่ได้รับสิทธิ์รายพื้นที่ จะสั่งงานได้เฉพาะพื้นที่นั้น |

### 5.5 ใช้ยากง่ายแค่ไหน

| Persona | งาน | ความยาก | หมายเหตุ |
|---|---|---|---|
| Engineer | ตั้งโครงสร้างโรงงาน 3 ชั้น 20 เครื่อง | ปานกลาง → ง่าย ด้วย template + bulk assign | ไม่มี bulk = จะเลิกใช้ |
| Operator | หาเครื่องที่สนใจ | ง่าย (tree + search + scope จำค่า) | |
| Admin | ให้สิทธิ์รายพื้นที่ | ปานกลาง | หน้า member มี matrix area × user |

---

## 6. P2 — Historian บน TimescaleDB

### 6.1 Design

- Image `postgres:16-alpine` → `timescale/timescaledb:2.x-pg16` (major PG เดียวกัน → ใช้ volume เดิมได้;
  ต้องมี `shared_preload_libraries=timescaledb`) ทั้ง `docker-compose.yml`, `.prod.yml`, `.test.yml`
- Migration `0052_timescale`:
  1. `CREATE EXTENSION IF NOT EXISTS timescaledb`
  2. `tag_history` เพิ่มคอลัมน์ `vn double precision` (ค่าตัวเลข; bool → 0/1) — คำนวณตอน ingest เพื่อเลิก cast `v::text::float8`
     ทุก query (backfill จาก `v` ใน migration)
  3. `SELECT create_hypertable('tag_history','ts', chunk_time_interval => interval '1 day', migrate_data => true)`
     (PK `(tag_id, ts)` มี `ts` อยู่แล้ว → ใช้ได้)
  4. Compression: `segmentby = 'org_id, tag_id'`, `orderby = 'ts DESC'`, policy compress chunk อายุ > 7 วัน
  5. Continuous aggregates `tag_rollup_1m`, `tag_rollup_1h`: `(org_id, tag_id, bucket, min, max, avg, count, last)` จาก `vn`
     + refresh policy (1m: ทุก 1 นาที ย้อน 2 ชม.; 1h: ทุก 30 นาที ย้อน 2 วัน)
  6. Retention ของ rollup: 1m เก็บ 90 วัน, 1h เก็บตาม plan สูงสุด (หรือไม่จำกัด)
- **Security ของ rollup (สำคัญ):** continuous aggregate **ไม่รองรับ RLS** → `REVOKE ALL` จาก `wds_app`; เข้าถึงผ่าน
  `SECURITY DEFINER` function `tag_rollup(p_tag uuid, p_from, p_to, p_bucket text)` ที่ตรวจ
  `EXISTS (SELECT 1 FROM tags WHERE id = p_tag)` ภายใต้ RLS ของ caller ก่อน (ถ้า tag ไม่ใช่ของ org ปัจจุบัน → ว่าง) และ
  filter `org_id = wds_ctx_org()` ซ้ำ — มี test ข้าม tenant ใน `tests/tenancy/`
- **Spike ก่อน (วันแรกของ P2):** ยืนยันว่า RLS policy บน hypertable + compressed chunk ทำงาน (`tests/tenancy` ผ่านทั้งหมด)
  ถ้าไม่ผ่าน → **fallback:** native declarative partitioning รายเดือน + ตาราง rollup ที่ job (`core/jobs.py`) อัปเดตเอง
  (RLS ใช้ได้ปกติ) — API ด้านบนเหมือนเดิม
- Per-org retention (`tenancy/plans.py::retention_prune`) คง DELETE ตาม plan ไว้ (Timescale ≥2.11 DELETE บน compressed chunk ได้)
  + เพิ่ม `drop_chunks` global ที่ retention สูงสุดของทุก plan
- `production/tagquery.py`: เลือก source ตาม bucket — `≥ 3600s → tag_rollup_1h`, `≥ 60s → tag_rollup_1m`, ไม่งั้น raw;
  response เพิ่ม `"source": "raw|1m|1h"`
- License note: compression/caggs อยู่ใต้ Timescale License (TSL) — ใช้ใน SaaS ของเราได้ (ห้ามขาย Timescale เป็น DBaaS) บันทึกใน ADR

### 6.2 UX

ผู้ใช้แทบไม่เห็น ยกเว้น:
- Trends ซูมช่วง 1 ปีได้เร็ว (เป้าหมาย p95 < 500 ms สำหรับ 1 tag × 1 ปี) — `tests/perf/` เพิ่ม benchmark
- Admin › Storage โชว์ "ขนาด history ก่อน/หลังบีบอัด" และอัตราบีบอัด (Hyper Historian ก็โชว์)
- Tooltip บน trend บอกว่าเป็นค่า "เฉลี่ย 1 ชม." เมื่อใช้ rollup (กันคนเข้าใจผิดว่าเป็นค่าจริงทุกจุด)

| ข้อความ | EN | TH |
|---|---|---|
| rollup hint | Showing 1-hour averages for this range. Zoom in for raw values. | แสดงค่าเฉลี่ยราย 1 ชั่วโมงในช่วงนี้ ซูมเข้าเพื่อดูค่าจริง |
| storage | Compressed {{ratio}}× · {{size}} on disk | บีบอัดแล้ว {{ratio}} เท่า · ใช้พื้นที่ {{size}} |

**ใช้ยากง่ายแค่ไหน:** ง่ายมาก (ไม่มีอะไรให้ตั้งค่า) — งานยากอยู่ที่ฝั่ง ops (migration, ภาพ docker ใหม่) → DEPLOY.md เพิ่มขั้นตอน

---

## 7. P3 — Derived / Calculated Tags

### 7.1 Design

- `tags.source text NOT NULL DEFAULT 'device' CHECK (source IN ('device','derived'))` (migration `0053_derived_tags`)
  - derived tag: `edge_id NULL`, `writable=false` เสมอ (CHECK), อยู่ใน site เดียวกับ input ทุกตัว
- `tag_formulas(org_id, tag_id PK, expr text, inputs jsonb /* {"a": tag_id, ...} */, version, updated_by, updated_at)`
  - input ต้องเป็น tag ใน **site เดียวกัน** (cross-site = non-goal) และห้ามวนกลับ (ตรวจ cycle ตอนบันทึก, ลึกสุด 5 ชั้น)
- **ภาษาสูตร (parse เอง, ไม่มี eval)** — `backend/app/production/formula.py`
  - Lexer + Pratt parser → AST → evaluator; จำกัดความยาว 500 ตัวอักษร, AST ≤ 200 node
  - ตัวแปร: `a`…`z` (ผูกกับ tag ผ่าน `inputs` — แบบ Datadog formula), ตัวเลข, `true/false`
  - Operators: `+ - * / %`, `^`, เปรียบเทียบ, `and or not`, `cond ? x : y`
  - ฟังก์ชันค่าปัจจุบัน: `abs min max round(x,n) clamp(x,lo,hi) sqrt log exp`
  - ฟังก์ชันช่วงเวลา (ใส่ได้เฉพาะตัวแปรตรง ๆ): `avg(a, 5m)`, `min(a,1h)`, `max(a,1h)`, `delta(a, 1m)` (ค่าเปลี่ยนในช่วง),
    `rate(a, 1m)` (ต่อวินาที), `integral(a, 1h)`; หน้าต่างสูงสุด 24h
  - ผลลัพธ์ไม่ finite (หารศูนย์, NaN) → quality `bad` ไม่ใช่ตัวเลขมั่ว
- **Engine** `backend/app/production/derived.py`
  - Index: input tag_id → derived tags ที่ใช้ (โหลดตอนเริ่ม + LISTEN `tags_changed` ที่มีอยู่)
  - Hook ใน `_handle_telemetry` หลัง `tag_latest` upsert สำเร็จ: เรียก `derived.on_sample(tag_id, v, q, ts)` → คำนวณ dependents
    → เขียนผ่านฟังก์ชันเดียวกับ device tag (`tag_latest`, `history_buf`, `alarms.evaluate`, WS) — derived tag จึงมี alarm/trend/
    dashboard ได้ทุกอย่าง (แยก ingest core ออกจาก `main.py` เป็น `production/ingest.py` ตาม ADR-0001 "to revisit")
  - Window state: ring buffer ต่อ (input, window) ในหน่วยความจำ จำกัดจำนวน sample/หน่วยความจำต่อ org; warm-up ตอนเริ่มจาก
    `tag_rollup_1m`/raw
  - Quality: ผลเป็น `good` เมื่อ input ทุกตัว good; ถ้ามี `stale/uncertain` → `uncertain`; มี `bad` → `bad`
  - Throttle: คำนวณซ้ำไม่เกิน 1 ครั้ง/วินาที/derived tag (กัน input ถี่ทำ CPU พุ่ง)
  - Leader: ถือ `pg_try_advisory_lock` ก่อนรัน (รองรับอนาคตที่มีหลาย instance)
- API: `POST /formulas/validate` (ส่ง expr + inputs → AST ok/ error ตำแหน่ง + **ค่าตัวอย่างจากค่าล่าสุด**),
  CRUD derived tag (role admin/owner เท่านั้น — สูตรเปลี่ยนค่าที่ alarm ใช้ → audit `formula.changed` เก็บ expr เก่า/ใหม่)

### 7.2 UX (Datadog formula editor)

```
┌ New calculated tag / สร้าง tag คำนวณ ─────────────────────────┐
│ Name  [ line1/flow_avg_5m          ]  Unit [ m³/h ]            │
│ a  [ line1/flow_in      ▾ ]  12.4 m³/h  ● good                 │
│ b  [ line1/flow_out     ▾ ]   3.1 m³/h  ● good                 │
│ + add variable                                                 │
│ Formula  [ avg(a - b, 5m)                         ]            │
│ Preview  = 9.3 m³/h   ✓ valid                                  │
│ Functions: avg() delta() rate() min() max() clamp() …  (help)  │
└────────────────────────────────────────── [Cancel] [Create] ───┘
```

- เลือก tag ผ่าน tag picker ที่มี asset tree (P1) + search; ไม่ต้องพิมพ์ path
- พิมพ์สูตรแล้ว validate สด (debounce 300 ms) — error ชี้ตำแหน่งด้วยขีดเส้นใต้ + ข้อความไทย
- Template สำเร็จรูป: "ค่าเฉลี่ยเคลื่อนที่", "ผลต่าง in−out", "อัตราการเปลี่ยนแปลง", "แปลงหน่วย (×k)", "เปิด/ปิดรวมกัน (a or b)"
- ในหน้า Tags: badge "ƒ calculated" และ detail โชว์สูตร + กราฟ dependency (input → output)

| ข้อความ | EN | TH |
|---|---|---|
| err unknown var | Unknown variable "{{name}}". Add it above first. | ไม่รู้จักตัวแปร "{{name}}" — เพิ่มตัวแปรด้านบนก่อน |
| err cycle | This formula depends on itself through {{path}}. | สูตรนี้อ้างกลับมาที่ตัวเองผ่าน {{path}} |
| err window | Time windows go from 1s to 24h, e.g. 5m. | ช่วงเวลาต้องอยู่ระหว่าง 1s ถึง 24h เช่น 5m |
| quality note | Uncertain because input "b" is stale. | ไม่แน่นอน เพราะค่าของตัวแปร "b" ไม่อัปเดต |

**ใช้ยากง่ายแค่ไหน:** Engineer — ง่าย ถ้ามี template + preview (สูตรง่ายเสร็จใน < 1 นาที); จุดติดคือไวยากรณ์ช่วงเวลา → ใช้
autocomplete ฟังก์ชันพร้อมตัวอย่าง; Operator ไม่ต้องสร้าง แค่เห็นเป็น tag ปกติ

---

## 8. P4 — Mobile / PWA + Web Push

### 8.1 Design

- `vite-plugin-pwa`: manifest (name EN/TH, icons มีแล้ว `logo-192.png`; เพิ่ม 512 + maskable), `display: standalone`
- **Service worker cache เฉพาะ app shell** (JS/CSS/fonts/icons) — `NetworkOnly` สำหรับ `/api/*`, `/ws`, รูปจากกล้อง
  (anti-goal: ไม่มีข้อมูลโรงงานค้างในเครื่อง); logout → `caches.delete` + unregister push subscription
- หน้า offline: "ไม่มีการเชื่อมต่อ — ค่าที่แสดงอาจไม่เป็นปัจจุบัน" และ **ห้ามแสดงค่าเก่าเหมือนเป็นค่าสด** (stale ทุก widget)
- **Web Push (VAPID)**: notification channel ชนิดใหม่ `webpush` ใน `alarming/notify.py`; ตาราง `push_subscriptions(org_id, user_id,
  endpoint, p256dh, auth, ua, created_at)`; payload **ไม่มีค่า process** — แค่ "Alarm ใหม่ระดับ High ที่ {{area}}" + ลิงก์
  (ข้อมูลจริงโหลดหลังเปิดแอปซึ่งต้อง login) ลดข้อมูลรั่วผ่าน push service ของ Google/Apple
- Ack alarm จากมือถือได้ (ความเสี่ยงต่ำ); **การสั่งงานบนมือถือใช้ step-up เหมือน desktop** และ org setting
  `mobile_control` (default ปิด) ซ่อนปุ่มสั่งงานบนจอแคบ — ระบุชัดในเอกสารว่าเป็น UX guard ไม่ใช่ security boundary
  (ขอบเขตความปลอดภัยจริงคือ role + area + step-up)

### 8.2 UX

- จอ < 768px: bottom nav 4 ปุ่ม **ภาพรวม · Alarm · Trend · เพิ่มเติม** (เหมือน Datadog mobile)
- Alarm list แบบการ์ดใหญ่, ปัดเพื่อ ack (มีปุ่มสำรองสำหรับ accessibility), target ≥ 44px
- Dashboard บนมือถือ: widget เรียงคอลัมน์เดียวตามลำดับเดิม; widget ที่ใช้ไม่ได้บนจอเล็ก (3D twin) → การ์ด "เปิดบนคอมพิวเตอร์"
- Install prompt แบบไม่รบกวน: แสดงหลังเข้าใช้ครั้งที่ 3 บนมือถือ "เพิ่มลงหน้าจอหลักเพื่อรับแจ้งเตือน alarm"
- iOS: Web Push ใช้ได้เฉพาะเมื่อ "Add to Home Screen" แล้ว → หน้าตั้งค่ามีคำแนะนำทีละขั้นภาษาไทยพร้อมรูป

| ข้อความ | EN | TH |
|---|---|---|
| install | Add to home screen to get alarm notifications | เพิ่มลงหน้าจอหลักเพื่อรับการแจ้งเตือน alarm |
| push body | New {{priority}} alarm in {{area}} | มี alarm ระดับ {{priority}} ใหม่ที่ {{area}} |
| offline | You're offline. Values may be out of date. | ไม่มีการเชื่อมต่อ ค่าที่แสดงอาจไม่เป็นปัจจุบัน |

**ใช้ยากง่ายแค่ไหน:** Operator — ง่าย (Android 2 แตะ); iOS ยากกว่า (ต้อง Add to Home Screen ก่อน push) → คำแนะนำมีรูป

---

## 9. P5 — BACnet/IP + MQTT Sparkplug B

ทั้งสองเป็น **adapter ใหม่ของ edge-bridge** ใช้ data source model เดิม (`data_sources.protocol` เพิ่ม `'bacnet','sparkplug'`
ใน migration `0054_protocols`; `connection` jsonb ต่อ protocol; secrets ใน `secret_enc`)

### 9.1 BACnet/IP

- Library: `bacpypes3` (async, MIT) ใน `edge_bridge/adapters/bacnet.py`
- Connection: `{local_address, bbmd?: {address, ttl}}`; tag address: `{device_instance, object_type, object_instance,
  property: "present-value"}` (validate ใน `datasources/addresses.py`)
- อ่าน: poll ตาม `poll_ms` + COV subscription ถ้าอุปกรณ์รองรับ (ลด traffic)
- เขียน: `WriteProperty` ที่ **priority 8 (Manual Operator)** เป็นค่าเริ่มต้น (ปรับได้ต่อ tag 1–16 ยกเว้น 1–2 ที่สงวนไว้ให้
  life-safety → ห้าม); มี "relinquish" (เขียน null) เป็นคำสั่งแยก
- Discovery: edge op `browse` (มีกลไก `request_op` อยู่แล้ว) → Who-Is/I-Am → list objects → UI เลือกเป็น tag ได้
- Security: BACnet/IP ไม่มีการเข้ารหัส → เอกสารแนะนำให้ edge อยู่ใน control zone เดียวกับอุปกรณ์ ห้าม route BACnet ข้าม zone;
  BACnet/SC = future

### 9.2 MQTT Sparkplug B

- **ทำไมผ่าน edge ไม่ใช่ cloud broker โดยตรง:** อุปกรณ์ภายนอกจำนวนมาก (ของคนอื่น) ใช้ credential แบบ shared/อ่อน
  ถ้าเปิดให้ต่อ cloud broker ตรง ทุกอุปกรณ์กลายเป็น client ของ broker กลางที่มี tenant อื่นอยู่ด้วย → ให้ edge-bridge เป็น
  **Sparkplug Host Application** บน broker ของโรงงาน (local) แล้วส่งต่อด้วย credential ของ edge ที่ dynsec จำกัดไว้แล้ว
  (ลด attack surface ฝั่ง cloud เป็นศูนย์) — cloud-direct เป็นงานอนาคต
- `edge_bridge/adapters/sparkplug.py`: subscribe `spBv1.0/{group_id}/#` บน broker ที่กำหนดใน `connection`
  (`{broker_url, group_id, tls, ca_pem?}`, username/password ใน secret) — **บังคับ TLS ยกเว้นผู้ใช้ติ๊ก "ยอมรับความเสี่ยง"**
  ซึ่งถูก audit
- Decode Sparkplug B protobuf (vendored `sparkplug_b.proto` compiled ด้วย `protobuf`) ; รองรับ NBIRTH/DBIRTH (alias map),
  NDATA/DDATA, NDEATH/DDEATH (→ quality `bad` ทุก metric ของ node/device), seq number (ขาดลำดับ → ส่ง NCMD Rebirth)
- Tag address: `{edge_node_id, device_id?, metric}`; **Auto-discovery:** metric ที่เห็นใน BIRTH แต่ยังไม่ map → แสดงใน UI
  "พบ 37 metric ใหม่" ให้เลือกสร้าง tag ทีละหลายตัว (ไม่สร้างอัตโนมัติ — กัน tag ขยะ/การโจมตีด้วยการ flood metric)
- เขียน: DCMD/NCMD สำหรับ metric ที่ tag `writable` ผ่าน command path เดิม
- จำกัด: metric ต่อ data source ≤ 5,000, payload ≤ 256 KB, ทิ้ง type ที่ไม่รองรับ (dataset/template → log + counter)

### 9.3 UX

- Add data source wizard (มีอยู่ `AddDeviceWizard`) เพิ่มการ์ด BACnet และ Sparkplug B พร้อมโลโก้/คำอธิบายภาษาไทย
- ขั้นตอน: เลือก protocol → กรอก connection → **Test connection** (op เดิม) → **Discover** → เลือก point/metric ด้วย
  checkbox + ตั้ง path อัตโนมัติจากชื่อ (แก้ได้) → ผูก Equipment (P1) → เสร็จ
- สถานะ data source: Sparkplug แสดง node online/offline ตาม BIRTH/DEATH

| ข้อความ | EN | TH |
|---|---|---|
| sp new metrics | {{n}} new metrics found. Choose which to add as tags. | พบ {{n}} metric ใหม่ เลือกรายการที่ต้องการเพิ่มเป็น tag |
| bacnet priority | Write priority (8 = manual operator) | ระดับความสำคัญในการเขียน (8 = ผู้ควบคุมสั่งเอง) |
| tls off | Unencrypted connection — anyone on this network can read or change values. | การเชื่อมต่อไม่เข้ารหัส — ใครที่อยู่ในเครือข่ายนี้อ่านหรือแก้ค่าได้ |

**ใช้ยากง่ายแค่ไหน:** Engineer — ปานกลาง (ต้องรู้ IP/device instance/group id) → discovery ทำให้เหลือ "กรอก IP แล้วติ๊กเลือก"

---

## 10. P6 — Recipe + Sequence (SFC)

### 10.1 Recipe (ทำก่อน)

- `recipes(id, org_id, site_id, line_id, name, version, status ∈ {draft, approved, archived}, created_by, approved_by,
  approved_at)`, `recipe_items(recipe_id, tag_id, value jsonb)` — tag ทุกตัวต้อง `writable` และอยู่ใน line นั้น
- **Four-eyes:** approve ต้องเป็นคนละคนกับผู้สร้าง/แก้ล่าสุด (role admin/owner) — แก้ approved = สร้าง version ใหม่เป็น draft
- **Download:** เฉพาะ approved → step-up → area permission → ตรวจ min/max/step ของทุก tag ก่อน (ผิดตัวเดียว = ไม่ส่งเลย)
  → ส่งเป็นชุดคำสั่งผ่าน `commands.issue` ตามลำดับ → หน้าแสดงผลรายบรรทัด (acknowledged/rejected)
  → ถ้ามีตัวล้ม: หยุดส่งที่เหลือ และแสดงว่าตัวไหนเขียนไปแล้ว (ไม่ rollback อัตโนมัติ — การเขียนค่าเก่ากลับเองอันตรายพอ ๆ กัน)
- "Compare with live": diff ค่าใน recipe กับค่าปัจจุบัน (เหมือน WinCC recipe view)
- Audit: `recipe.created/approved/downloaded` พร้อม version

### 10.2 Sequence (SFC แบบเส้นตรงมีเงื่อนไข)

- Model: `sequences(id, org_id, site_id, line_id, name, version, status draft/approved)`,
  `sequence_steps(seq_id, idx, name, actions jsonb, transition jsonb, timeout_s, on_timeout ∈ {hold, abort})`
  - action: `{"write": tag_id, "value": …}` หรือ `{"recipe": recipe_id}`
  - transition: expression ภาษาเดียวกับ P3 (เช่น `a >= 80 and b == true`) + `min_dwell_s`
  - `interlock`: expression ระดับ sequence ที่ต้องเป็นจริงตลอด ไม่งั้น → **Held**
  - **ไม่มี parallel branch** ในรอบนี้ (แบบเส้นตรงพอสำหรับงานส่วนใหญ่และใช้ง่ายกว่า graph editor มาก)
- Run state machine (ISA-88 แบบย่อ): `idle → running → (held ⇄ running) → complete | aborted | stopped`
- `sequence_runs(id, seq_id, version, state, step_idx, started_by, started_at, ended_at, reason)`, `sequence_run_events`
- Engine `backend/app/production/sequencer.py`: task ต่อ run, ทุก write ผ่าน `commands.issue` (ได้ gate ทั้งหมดฟรี),
  ประเมิน transition เมื่อ input เปลี่ยน (ใช้ hook เดียวกับ derived) + timer
- **Restart safety:** backend start → run ที่ `running` ทุกตัวกลายเป็น `held` พร้อม reason `backend_restart` → ต้องมีคนกด Resume
  (ต้อง step-up) — anti-goal
- Approve four-eyes เหมือน recipe; start/resume = step-up + area permission; hold/abort ทำได้ทันทีไม่ต้อง step-up (หยุดต้องง่ายเสมอ)
- จำกัด: step ≤ 50, run พร้อมกันต่อ line = 1

### 10.3 UX

- **Editor แบบรายการขั้นตอนแนวตั้ง** (ไม่ใช่ graph อิสระ) — แต่ละ step เป็นการ์ด: "ทำอะไร" (เลือก tag + ค่า หรือ recipe) →
  "ไปขั้นต่อไปเมื่อ" (expression + preview ค่าปัจจุบันว่าจริง/เท็จ) → timeout; ลากเพื่อเรียงลำดับ
- **Run view:** แถบขั้นตอนแนวตั้ง step ปัจจุบันเน้นสี, เงื่อนไขของ step นี้แสดงค่าจริงสด ("รอ: อุณหภูมิ 72.4 / 80 °C"),
  ปุ่มใหญ่ **Hold · Abort** ตลอดเวลา (สีแดง Abort ต้อง confirm 1 ครั้ง), Resume
- **Dry run:** จำลองบน tag ของ `sim` adapter ก่อนใช้จริง (มี sim อยู่แล้ว) — ช่วย engineer ทดสอบโดยไม่แตะเครื่องจริง

| ข้อความ | EN | TH |
|---|---|---|
| waiting | Waiting: {{label}} {{value}} / {{target}} | รอ: {{label}} {{value}} / {{target}} |
| held restart | Held after a server restart. Check the line, then resume. | หยุดพักเพราะเซิร์ฟเวอร์รีสตาร์ต ตรวจสอบไลน์ก่อนแล้วกดดำเนินการต่อ |
| interlock | Held: interlock "{{expr}}" became false. | หยุดพัก: เงื่อนไขความปลอดภัย "{{expr}}" ไม่เป็นจริงแล้ว |
| approve self | Someone else must approve your changes. | ต้องให้ผู้อื่นเป็นผู้อนุมัติการแก้ไขของคุณ |
| abort confirm | Abort the sequence? Equipment stays in its current state. | ยกเลิก sequence? เครื่องจักรจะคงอยู่ในสถานะปัจจุบัน |

**ใช้ยากง่ายแค่ไหน:** Engineer — ปานกลาง (ต้องคิดลำดับขั้น) → ง่ายขึ้นด้วย dry run + preview เงื่อนไข;
Operator — ง่าย (Start/Hold/Abort/Resume + บอกว่ารออะไรอยู่) ; จุดเสี่ยงคือคนอนุมัติเป็นคนเดียวกันในโรงงานเล็ก → ระบุใน UI ชัด ๆ
ว่าทำไมต้องสองคน (ไม่มีทางลัด)

---

## 11. Cross-cutting

- **Testing:** ทุก phase มี `tests/contract` (pure functions: formula parser, sparkplug decode, recipe validation),
  `tests/tenancy` (ข้าม org: areas, area_grants, rollup function, formulas, recipes, sequences), `tests/security`
  (step-up บังคับจริงทุก endpoint ในรายการ §4.1, API key ถูกปฏิเสธ, four-eyes), `tests/integration` (Timescale, ingest → derived → alarm)
- **i18n:** key ใหม่ทุกตัวมี TH/EN; `scripts/check-i18n` ต้องผ่าน; ใช้คำไทยที่ช่างใช้จริง (ไลน์ผลิต, เครื่องจักร) คง
  ศัพท์ที่คนหน้างานพูดเป็นอังกฤษ (alarm, tag, recipe)
- **Audit:** ทุก action ใหม่ที่เปลี่ยน config หรือสั่งงานลง `audit_log`
- **Docs:** อัปเดต `docs/security/iec62443-mapping.md`, `DEPLOY.md` (Timescale image, VAPID keys, Keycloak flow), ADR ใหม่:
  `0002-timescaledb-historian.md`, `0003-derived-tag-language.md`, `0004-mfa-at-idp-with-step-up.md`
- **Feature flags:** แต่ละ feature มี flag ใน `org_feature_flags` (มีอยู่แล้ว) เปิดทีละ org ได้

## 12. ปล่อยให้ builder ตัดสินใจเอง

- โครงสร้าง component ภายใน, ชื่อไฟล์ย่อย, รูปแบบ hook React
- ค่าตัวเลข refresh policy / chunk interval ถ้า benchmark บอกว่าค่าอื่นดีกว่า (บันทึกเหตุผลใน ADR)
- ไลบรารี protobuf/codegen สำหรับ Sparkplug, ไลบรารี web-push (เช่น `pywebpush`)
- รายละเอียด Keycloak authentication flow JSON (ตราบที่ได้ `acr` = `pwd|mfa` และ `auth_time`)
- การจัดวาง UI ภายในกรอบ dd-theme และ pattern ที่มีอยู่
