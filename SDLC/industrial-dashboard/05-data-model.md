# 05 — Data Model & Contracts

> **SaaS revision:** topics move to `v2/{org_id}/{site_id}/{edge_id}/{tele|hb|cmd|cmd-resp}/…` (doc 17). The DB is keyed by UUID with `org_id` on every tenant table, composite FKs and FORCE RLS (ADR-13). The dotted tag name becomes a per-site `path`. Sections below describe v1 and are kept for history.

## 1. MQTT Topic Layout (UNS-style)

```
{site}/{area}/{line}/{device}/{signal}         ← telemetry (tag value)
{site}/edge/{edge_id}/heartbeat                ← edge status
cmd/{edge_id}/{request_id}                     ← command down
cmd-resp/{edge_id}/{request_id}                ← command response up
sys/{edge_id}/health                           ← edge diagnostics
```

vision output เป็น telemetry ธรรมดา — ใช้ pattern เดียวกันโดย `line=vision`, `device=cam{id}` (ไม่มี topic พิเศษ ทำให้ tag flow เดียวกันทั้งระบบ)

ตัวอย่าง site นี้ (aggregate sorting line):
- `plant1/sort/line1/conv1/running`
- `plant1/sort/line1/sensor1/detected`
- `plant1/sort/vision/cam1/gravel_ratio`

**Mapping rule (ล็อกไว้)**: topic path ใช้ `/` คั่น, tag name ใน payload/DB/ YAML ใช้ `.` คั่น — แปลงกันได้ตรงๆ:
topic `plant1/sort/line1/conv1/running` ↔ tag `plant1.sort.line1.conv1.running`.
ห้ามใช้ชื่ออื่นกลางทาง (ดู §6).

**Topic governance** (จาก community lesson — UNS ล้มเพราะ "ทุกคน publish อะไรก็ได้"):
- topic ใหม่ต้องมี tag ลงทะเบียนใน `tags` table ก่อน — backend drop message ที่ tag ไม่รู้จัก (log + count เป็น metric `telemetry_unknown_tag`)
- `cmd/` และ `cmd-resp/` อยู่นอก UNS namespace เสมอ — ห้าม tag ใดใช้ชื่อขึ้นต้นด้วย `cmd` หรือ `sys`
- wildcard subscribe ของ backend คือ `{site}/#` เท่านั้น — ไม่ใช้ `#` เปล่า (กันโดน topic ของระบบอื่นบน broker เดียวกัน)

### Derived / KPI tags

ค่าที่คำนวณในระบบ (ไม่ได้อ่านจาก device) ใช้ convention เดียวกัน แต่ `src` บอกว่าเป็น computed:

```
plant1.sort.line1._derived.oee          src=derived
plant1.sort.line1._derived.alarm_rate   src=derived
plant1.sort.vision.cam1._derived.belt_health  src=derived
```

- prefix `_derived` ที่ตำแหน่ง `device` → แยกจาก real device ชัดเจน, ห้ามใช้ `_` นำหน้าชื่อ device จริง
- derived tag เขียนลง telemetry table เหมือนกัน แต่ `writable=false` เสมอ (ห้าม command ลง)
- คำนวณที่ backend (alarm engine / OEE job) แล้ว insert ตรง DB — **ไม่ต้อง** publish กลับ MQTT (ลด loop กับค่าใช้จ่าย; publish เฉพาะเมื่อมี consumer อื่นต้องการจริงๆ)

## 2. Payload Schemas

### TagValue (telemetry)

```json
{
  "tag": "plant1.sort.line1.conv1.speed",
  "v": 1420.5,
  "q": "good",
  "ts": "2025-01-15T08:30:00.123Z",
  "src": "modbus"
}
```

| field | type | หมายเหตุ |
|---|---|---|
| `tag` | string | normalized, lowercase, dot-separated |
| `v` | number/bool/string | raw engineering value |
| `q` | `good\|bad\|stale\|uncertain` | **bad = ห้ามแสดงเป็นค่าจริง** |
| `ts` | ISO8601 UTC | source timestamp |
| `src` | string | adapter ที่ผลิตข้อมูล |

### Command (ลง)

```json
{
  "tag": "plant1.sort.line1.conv1.running",
  "value": false,
  "idempotency_key": "uuid-v4",
  "issued_at": "2025-01-15T08:30:00Z",
  "user": "operator@example.com",
  "ttl_s": 5
}
```

### CommandResponse (ขึ้น)

```json
{
  "request_id": "uuid-v4",
  "status": "done",
  "detail": "write confirmed",
  "edge_ts": "2025-01-15T08:30:01.040Z"
}
```

`status`: `done | denied | error` — `timeout` ไม่ใช่ค่าที่ edge ส่ง; เป็นสถานะที่ **backend** assign เมื่อไม่มี resp ใน deadline (05 §3 commands CHECK, 06 §3) — denied ต้องมี `detail` จากชุดคงที่: `not_writable` | `interlock` | `ttl_expired` | `clock_untrusted`

## 3. PostgreSQL Schema (relational)

```sql
-- tags: registry (normalize + metadata)
CREATE TABLE tags (
  id            SERIAL PRIMARY KEY,
  name          TEXT UNIQUE NOT NULL,          -- plant1.sort.line1.conv1.speed
  description   TEXT,
  unit          TEXT,
  writable      BOOLEAN DEFAULT FALSE,
  adapter       TEXT NOT NULL,                 -- modbus | s7 | opcua | sim | vision
  stale_after_s INTEGER DEFAULT 15,
  created_at    TIMESTAMPTZ DEFAULT now()
);

-- alarm_rules
CREATE TABLE alarm_rules (
  id          SERIAL PRIMARY KEY,
  tag_id      INT REFERENCES tags(id),
  name        TEXT NOT NULL,
  condition   TEXT NOT NULL,          -- "value > 1500", "stale > 30"
  severity    TEXT NOT NULL CHECK (severity IN ('info','warning','critical')),
  enabled     BOOLEAN DEFAULT TRUE
);

-- alarms: event instances
CREATE TABLE alarms (
  id           BIGSERIAL PRIMARY KEY,
  rule_id      INT REFERENCES alarm_rules(id),
  tag_id       INT REFERENCES tags(id),
  raised_at    TIMESTAMPTZ NOT NULL,
  acked_at     TIMESTAMPTZ,
  acked_by     TEXT,
  cleared_at   TIMESTAMPTZ,
  snapshot_url TEXT,                   -- S3 link (vision frame)
  status       TEXT NOT NULL DEFAULT 'active'
                 CHECK (status IN ('active','acked','cleared'))
);

-- commands: audit trail
CREATE TABLE commands (
  id              UUID PRIMARY KEY,
  idempotency_key TEXT UNIQUE NOT NULL,
  user_id         TEXT NOT NULL,
  tag             TEXT NOT NULL,
  value           JSONB NOT NULL,
  status          TEXT NOT NULL DEFAULT 'issued'
                    CHECK (status IN ('issued','sent','acked','done','failed','timeout','denied')),
  issued_at       TIMESTAMPTZ DEFAULT now(),
  completed_at    TIMESTAMPTZ,
  result          JSONB
);

-- หนึ่ง in-flight command ต่อ tag (รองรับ 409 command_in_flight ในเอกสาร 06)
CREATE UNIQUE INDEX commands_one_inflight_per_tag
  ON commands(tag) WHERE status IN ('issued','sent');

-- audit_log (generic)
CREATE TABLE audit_log (
  id         BIGSERIAL PRIMARY KEY,
  ts         TIMESTAMPTZ DEFAULT now(),
  user_id    TEXT,
  action     TEXT NOT NULL,            -- command.issue, alarm.ack, tag.create ...
  detail     JSONB,
  ip         INET
);
```

## 4. TimescaleDB (telemetry)

```sql
CREATE TABLE telemetry (
  ts   TIMESTAMPTZ NOT NULL,
  tag  TEXT NOT NULL,
  v    DOUBLE PRECISION,
  q    TEXT,
  src  TEXT
);
SELECT create_hypertable('telemetry', 'ts');
CREATE INDEX ON telemetry (tag, ts DESC);

-- continuous aggregate: 1-min average
CREATE MATERIALIZED VIEW telemetry_1min
WITH (timescaledb.continuous) AS
SELECT time_bucket('1 minute', ts) AS bucket,
       tag, avg(v) AS avg_v, max(v) AS max_v, min(v) AS min_v, count(*) AS n
FROM telemetry GROUP BY bucket, tag;

-- retention
SELECT add_retention_policy('telemetry', INTERVAL '7 days');
-- aggregate เก็บ 90 วัน
SELECT add_retention_policy('telemetry_1min', INTERVAL '90 days');

-- compression (community: Timescale compress 10–20x, เปิดหลัง data นิ่ง)
ALTER TABLE telemetry SET (timescaledb.compress,
  timescaledb.compress_segmentby = 'tag');
SELECT add_compression_policy('telemetry', INTERVAL '1 day');
```

### Ingestion pattern (จาก TimescaleDB/community field lessons)

- **batch, ไม่ใช่ row-by-row**: ingest worker เก็บ buffer แล้ว flush ทุก `500 rows หรือ 1s` (แล้วแต่อะไรถึงก่อน) ด้วย `COPY telemetry FROM STDIN` หรือ multi-row `INSERT` — row-by-row insert ที่ 100 tags/s พัง connection pool ในระยะยาว
- **idempotent ingest**: QoS 1 → duplicate เกิดได้; dedupe key = `(tag, ts)` — ใช้ `ON CONFLICT DO NOTHING` บน unique index `telemetry(tag, ts)` ถ้าเปิด, หรือยอมรับ dupe แล้ว dedupe ตอน query ถ้า index แพง (ตัดสินใจตอน Sprint 2 ตาม cost จริง — บันทึกใน ADR)
- **ขาเข้าแยกจากขา query**: ingest เขียน hypertable ตรง; dashboard อ่านจาก continuous aggregate เมื่อ zoom ออก — ไม่ scan raw 7 วันทุกครั้ง

## 5. Entity Relationship

```
tags ──┬──► alarm_rules ──► alarms
       │
       └──► telemetry (hypertable)
commands (audit trail) ◄── user (Cognito sub)
audit_log ◄── ทุก mutating action
```

## 6. กฎสำคัญ

- `tag` ชื่อเดียวกันในทุก layer: config file → MQTT topic → DB → UI — ห้าม rename กลางทาง
- `quality` เป็น first-class — ไม่ใช่แค่ value; bad/stale ต้องแยกแสดงใน UI
- ทุก timestamp เป็น UTC ตลอด pipeline; แปลงเป็น local เฉพาะ UI
- `idempotency_key` อยู่ใน commands table (unique) — dedup ที่ DB ด้วย
- telemetry ที่ `q=bad` เก็บลง DB ด้วย (`v=NULL`) — ห้ามทิ้ง: gap ในกราฟคือข้อมูลที่ต้องบอกว่า "ขาด" ไม่ใช่ "เป็นศูนย์"
- tag ที่คำนวณเองต้องมี `_derived` ที่ตำแหน่ง device (§1) — ห้ามปนกับค่าจาก device จริง
- `ts` คือเวลาที่ **edge** (source clock, sync ผ่าน NTP — กฎใน 04 §6.6); stale detection วัดจาก backend receive-time แยกต่างหาก ไม่พึ่ง `ts` เดี่ยว — clock edge เพี้ยนต้องไม่ทำ stale/audit พังตาม
- command ที่ edge ตอบ `denied: clock_untrusted` เก็บลง commands table เหมือน denied ปกติ — audit ต้องเห็นว่า command ถูกปฏิเสธเพราะ clock ไม่ใช่เพราะ interlock
