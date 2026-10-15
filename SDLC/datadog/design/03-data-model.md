# 03 — Data Model

> แหล่งความจริง: schema ที่รันอยู่ (`diagrams/schema.sql` = `pg_dump -s`, Alembic head) — ERD ด้านล่าง **สร้างจาก Postgres catalog**
> ไม่ได้วาดเอง (20 ตาราง, 27 foreign key) สร้างใหม่ได้ด้วยคำสั่งใน §7

## 1. Domains

| Domain | ตาราง | หมายเหตุ |
|---|---|---|
| Identity & tenancy | `users`, `memberships`, `invites`, `revoked_sessions` | `users` เป็น global (ไม่มี org_id); `memberships` คือ role ต่อ org |
| Organization & plant | `organizations`, `sites`, `lines`, `devices` | `organizations.plan_limits` (jsonb) = โควตา; `sites.control_enabled` = เปิด/ปิดการสั่งงาน |
| Edge & tag registry | `edges`, `edge_identities`, `tags` | อุปกรณ์ edge + key MQTT ทุกเวอร์ชัน (เก็บ fingerprint); `tags` มี min/max/step สำหรับ validate คำสั่ง |
| Telemetry & AI | `tag_latest`, `tag_history`, `insights` | `tag_history` (tag_id, ts) PK; `insights` = ผลวิเคราะห์ rule-based (anomaly/drift/flatline/flapping) |
| Alarms | `alarm_rules`, `alarms` | `alarms.version` เรียงลำดับ transition |
| Commands & audit | `commands`, `command_events`, `command_outbox`, `audit_log` | outbox pattern; audit เป็น hash chain ต่อ org |

## 2. ERD (ฉบับเต็ม)

```mermaid
erDiagram
    organizations ||--o{ memberships : "org_id"
    users ||--o{ memberships : "user_id"
    users ||--o{ invites : "accepted_by"
    users ||--o{ invites : "invited_by"
    organizations ||--o{ invites : "org_id"
    organizations ||--o{ sites : "org_id"
    sites ||--o{ lines : "site_id"
    lines ||--o{ devices : "line_id"
    sites ||--o{ edges : "site_id"
    devices ||--o{ tags : "device_id"
    sites ||--o{ tags : "site_id"
    edges ||--o{ tags : "site_id,edge_id"
    tags ||--o{ tag_latest : "tag_id"
    tags ||--o{ tag_history : "tag_id"
    tags ||--o{ alarm_rules : "tag_id"
    users ||--o{ alarms : "acked_by"
    tags ||--o{ alarms : "tag_id"
    alarm_rules ||--o{ alarms : "tag_id,rule_id"
    users ||--o{ commands : "actor_user_id"
    edges ||--o{ commands : "site_id,edge_id"
    tags ||--o{ commands : "site_id,tag_id"
    commands ||--o{ command_events : "command_id"
    commands ||--o{ command_outbox : "command_id"
    organizations ||--o{ audit_log : "org_id"
    organizations ||--o{ insights : "org_id"
    tags ||--o{ insights : "tag_id"
    edges ||--o{ edge_identities : "edge_id"
    alarm_rules {
        uuid id PK
        uuid org_id
        uuid tag_id FK
        text name
        text kind
        float8 threshold
        int stale_s
        float8 deadband
        text severity
        bool enabled
    }
    alarms {
        uuid id PK
        uuid org_id
        uuid tag_id FK
        uuid rule_id FK
        text severity
        text state
        timestamptz raised_at
        timestamptz acked_at
        uuid acked_by FK
        timestamptz cleared_at
        int version
    }
    audit_log {
        bigint id PK
        uuid org_id FK
        bigint seq
        timestamptz at
        text actor
        text action
        jsonb target
        jsonb detail
        text prev_hash
        text hash
    }
    command_events {
        bigint id PK
        uuid org_id
        uuid command_id FK
        text from_status
        text to_status
        text actor
        text reason
        timestamptz at
    }
    command_outbox {
        uuid command_id PK
        uuid org_id
        text topic
        jsonb payload
        timestamptz not_after
        int attempts
        timestamptz created_at
    }
    commands {
        uuid id PK
        uuid org_id
        uuid site_id FK
        uuid edge_id FK
        uuid tag_id FK
        jsonb value
        text status
        text reason
        int ttl_s
        text idempotency_key
        text note
        uuid actor_user_id FK
        timestamptz issued_at
        timestamptz updated_at
        int version
    }
    devices {
        uuid id PK
        uuid org_id
        uuid line_id FK
        text name
    }
    edge_identities {
        uuid id PK
        uuid org_id
        uuid edge_id FK
        int version
        text username
        text fingerprint
        text status
        bool secret_issued
        timestamptz grace_until
        timestamptz rotated_at
        timestamptz created_at
    }
    edges {
        uuid id PK
        uuid org_id
        uuid site_id FK
        text name
        text status
        text mqtt_username
        int credential_version
        text credential_fingerprint
        timestamptz last_hb_at
        bool clock_ok
        text adapter
        int buffer_depth
        bigint buffer_dropped
        timestamptz created_at
    }
    insights {
        uuid id PK
        uuid org_id FK
        uuid tag_id FK
        text kind
        text severity
        real score
        text state
        timestamptz ts_start
        timestamptz ts_end
        jsonb detail
        timestamptz created_at
        timestamptz updated_at
    }
    invites {
        uuid id PK
        uuid org_id FK
        text email
        text role
        text token_hash
        uuid invited_by FK
        timestamptz expires_at
        timestamptz accepted_at
        uuid accepted_by FK
        timestamptz created_at
    }
    lines {
        uuid id PK
        uuid org_id
        uuid site_id FK
        text name
    }
    memberships {
        uuid org_id PK
        uuid user_id PK
        text role
        timestamptz created_at
    }
    organizations {
        uuid id PK
        text name
        jsonb plan_limits
        timestamptz created_at
        timestamptz deleted_at
    }
    revoked_sessions {
        text sid PK
        timestamptz revoked_at
    }
    sites {
        uuid id PK
        uuid org_id FK
        text name
        text code
        text timezone
        bool control_enabled
        timestamptz created_at
    }
    tag_history {
        uuid tag_id PK
        timestamptz ts PK
        uuid org_id
        jsonb v
        text q
    }
    tag_latest {
        uuid tag_id PK
        uuid org_id
        jsonb v
        text q
        timestamptz ts
    }
    tags {
        uuid id PK
        uuid org_id
        uuid site_id FK
        uuid edge_id FK
        uuid device_id FK
        text path
        text name
        text type
        text unit
        bool writable
        float8 min_value
        float8 max_value
        float8 step_value
        jsonb enum_values
        jsonb requires
        text description
        timestamptz created_at
    }
    users {
        uuid id PK
        text sub
        text email
        bool email_verified
        text display_name
        text locale
        timestamptz disabled_at
        timestamptz created_at
    }
```

## 3. Multi-tenancy rules (ADR-13)

1. ทุกตาราง tenant มี `org_id` และเปิด **RLS** (18 ตาราง) — policy อ่าน `current_setting('app.org_id')`
   ที่ backend ตั้งด้วย `set_config(..., true)` ภายใน transaction (`tenant_tx`)
2. FK เป็นแบบ **composite** `(org_id, …)` → แถวลูกอ้างอิงแถวของ org อื่นไม่ได้แม้ RLS จะพลาด (defense in depth)
3. Role แยก: `wds_owner` (migration เท่านั้น) · `wds_app` (API, NOBYPASSRLS) · `wds_system` (worker, lookup ข้าม org แบบจำกัด) — app ไม่มี superuser
4. นอก tenant transaction (`global_tx`) เห็นเฉพาะตาราง global (`users`, `revoked_sessions`) — CLI `app.bootstrap`
   จึงใช้ org id แบบ deterministic (uuid5 ของชื่อ) แทนการค้นข้าม tenant

## 4. State machines

```mermaid
stateDiagram-v2
  direction LR
  state "Alarm" as A {
    [*] --> active: rule fires
    active --> acked: operator ack (acked_by, acked_at)
    active --> cleared: condition clears
    acked --> cleared: condition clears
    cleared --> [*]
  }
```

```mermaid
stateDiagram-v2
  direction LR
  state "Command (doc 16) — DB CHECK vocabulary" as C {
    [*] --> accepted: POST /api/commands (role, rate limit, range, control_enabled)
    accepted --> dispatched: outbox → MQTT cmd/
    dispatched --> acknowledged: edge applied value
    dispatched --> rejected: edge refused (range / clock / ttl)
    dispatched --> timeout: no response before not_after (ttl_s 1–60)
    accepted --> failed: publish failed
  }
```

API v1 (หน้าเว็บเดิม) แปลงชื่อสถานะเป็น `issued · sent · acked · done · denied · failed · timeout`
(accepted→issued, dispatched→sent, acknowledged→acked/done, rejected→denied)

```mermaid
stateDiagram-v2
  direction LR
  state "Edge identity (doc 17) — CHECK: active | grace | disabled | lost" as E {
    [*] --> active: provision (secret shown once)
    active --> grace: rotate — old key valid until grace_until
    active --> lost: broker credential recreated by reconciler (nobody holds it → UI "rotate")
    grace --> disabled: grace_until passed / edge disabled
    active --> disabled: disable edge (terminal)
    lost --> disabled
  }
```

## 5. Audit log (tamper-evident)

`audit_log(org_id, seq, at, actor, action, target, detail, prev_hash, hash)` — แต่ละแถวเก็บ hash ของแถวก่อนหน้าใน org เดียวกัน
→ แก้/ลบแถวกลางทางจะทำให้ chain แตก ตรวจด้วย `make verify-audit` (ทำหลัง restore ทุกครั้ง)
เหตุการณ์ที่บันทึก: ack, command, rule CRUD, membership/invite, edge provision/rotate/disable, export

## 6. Retention & growth

| ตาราง | อัตราโต (10 อุปกรณ์ × 50 tag × 1 Hz) | นโยบาย |
|---|---|---|
| `tag_history` | ~43 ล้านแถว/วัน | ออกแบบเก็บ 8 ชม. — **ต้องเพิ่ม prune job** (ลบ `ts < now() - 8h` ทุก 5 นาที) ก่อนใช้งานยาว; ระยะยาว → TimescaleDB |
| `alarms`, `command_events`, `audit_log` | ต่ำ | เก็บถาวร (audit ห้ามลบ) |
| `insights` | ต่ำ | เก็บถาวร; state closed |

> ข้อสังเกต: 43 ล้านแถว/วันบน VPS เดียวหนักเกินไปถ้าไม่ prune — นี่คือความเสี่ยงอันดับต้นของ go-live (06 §2)

## 7. Regenerate

```bash
docker compose exec -T postgres pg_dump -U postgres -d wds -s --no-owner --no-privileges > SDLC/datadog/design/diagrams/schema.sql
# ERD: query pg_constraint (contype='f') + information_schema.columns → diagrams/erd.mmd (ดูสคริปต์ใน 05 §8)
```
