# 06 — API & Realtime Contract

> **SaaS revision:** this doc describes v1. The binding v2 surface is [CONTRACT.v2](../../CONTRACT.v2.md): `/api/v1/orgs/{org}/sites/{site}/…`, WS `/ws/v1` with first-frame auth (no token in URL), snapshot + `seq`, command statuses `accepted→dispatched→acknowledged|rejected|failed|timeout` (doc 16).

## 1. REST API (FastAPI)

```
GET    /api/health                       — liveness
GET    /api/tags                         — list + filter (adapter, writable, search)
GET    /api/tags/{name}/latest           — ค่าล่าสุด
GET    /api/tags/{name}/history?from&to&res=raw|1min|5min&limit
POST   /api/commands                     — สั่ง control (auth: operator)
GET    /api/commands/{id}                — สถานะ command
GET    /api/commands?tag=&user=&from&to  — history
GET    /api/alarms?status=&severity=     — list
POST   /api/alarms/{id}/ack              — acknowledge (auth: operator)
GET    /api/alarm-rules                  — CRUD rules (auth: admin)
POST   /api/alarm-rules
PATCH  /api/alarm-rules/{id}
DELETE /api/alarm-rules/{id}
GET    /api/system/health                — service status (edge, mqtt, db, vision)
GET    /api/audit?action=&user=&from&to  — audit trail (auth: admin)
```

### POST /api/commands

```json
// request
{
  "tag": "plant1.sort.line1.conv1.running",
  "value": false,
  "idempotency_key": "uuid-v4",
  "reason": "operator stop"
}
// response 202
{ "command_id": "uuid", "status": "issued" }
```

- ถ้า `idempotency_key` ซ้ำ → `200` + existing command (ไม่สร้างใหม่)
- ถ้า tag `writable=false` → `403`
- ถ้าไม่ login → `401`
- **ถ้า tag เดียวกันมี command `issued|sent` ค้างอยู่ → `409` `command_in_flight`**
  (คืน `command_id` ตัวเดิม) — กฎ "หนึ่ง in-flight command ต่อ tag": operator สองคน
  กดสั่งซ้อน/กดย้อนหลังต้องไม่แข่งกันลง PLC; ผู้สั่งใหม่เห็นว่ามี command ค้างและ
  เลือกรอ/ยกเลิกผ่าน UI — เพิ่ม `POST /api/commands/{id}/cancel` ได้ภายหลังถ้าจำเป็น
  (v1: รอ timeout 5s แล้วสั่งใหม่)

## 2. WebSocket `/ws`

```
ws://api.example.com/ws?token=<jwt>        ← operator (full stream)
ws://api.example.com/ws                    ← public (telemetry + alarms เท่านั้น)
```

### Server → Client messages

```jsonc
// tag update (หลัก)
{"type":"tag","tag":"...","v":1420.5,"q":"good","ts":"..."}

// batch (ส่งทุก ~200ms รวมหลาย tag ลด chatter)
{"type":"tags","items":[{"tag":"...","v":1,"q":"good","ts":"..."}]}

// alarm event
{"type":"alarm","alarm_id":123,"rule":"conv1_overtemp","tag":"...",
 "severity":"critical","status":"active","ts":"..."}

// command lifecycle
{"type":"command","command_id":"...","status":"sent|acked|done|denied|failed|timeout","tag":"..."}

// system
{"type":"health","service":"edge-bridge","status":"degraded","detail":"adapter modbus reconnecting"}
```

### Client → Server

```jsonc
{"type":"subscribe","tags":["plant1.*"]}   // subscribe pattern
{"type":"unsubscribe","tags":["..."]}
{"type":"ping"}
```

- Public connection ได้เฉพาะ `tag`, `tags`, `alarm`, `health` — ไม่ได้ `command` events
- Server batch `tags` ทุก 200ms (coalesce เฟรม)

## 3. Command Lifecycle (state machine)

```
            ┌──────────┐
            │  issued  │
            └────┬─────┘
                 │ publish to IoT Core ok
            ┌────▼─────┐
            │   sent   │
            └────┬─────┘
                 │ edge resp received
        ┌────────▼────────┐
        │  done | denied  │
        └─────────────────┘
                 │ timeout 5s →
            ┌────▼─────┐
            │ timeout/ │   (mark failed, alert UI)
            │  failed  │
            └──────────┘
```

- `denied` = edge ปฏิเสธ (tag ไม่ writable / interlock)
- `timeout` = ไม่ได้ resp ใน TTL → **ไม่** auto-retry
- ทุก transition บันทึก `commands.result` + `audit_log`

### Concurrency rules (multi-operator)

- **หนึ่ง in-flight command ต่อ tag** — second POST → `409` (ตามด้านบน);
  enforced ด้วย unique partial index `WHERE status IN ('issued','sent')` บน
  `commands(tag)` — กัน race ที่ DB ไม่ใช่แค่ application check
- **แตกต่าง tag พร้อมกันได้** — ไม่มี global lock
- **edge serialize ต่อ adapter** — command เข้า adapter เป็น queue เดี่ยว
  (ไม่ write ขนานบน connection เดียวกัน; Modbus/S7 ไม่มี transaction)
- **client ต้อง refresh ค่าล่าสุดก่อนสั่ง** — UI disable ปุ่มเมื่อ tag `stale`
  และแสดงค่าปัจจุบันใน confirm dialog (กันสั่งบนข้อมูลตาย)

## 4. Client-side Contract (browser) — จาก community lessons (เอกสาร 14 §5)

WS burst ท่วม main thread คือปัญหาจริงที่ dashboard ทุกตัวเจอ — contract ฝั่ง client ล็อกไว้ดังนี้:

### Buffering & rendering

- WS message เข้า → push ลง **ring buffer ต่อ tag** (capacity ~10,000 points/tag, drop เก่าสุด) — ไม่เรียก setState/render ทุก message
- flush ลง chart **เฟรมละครั้ง** ด้วย `requestAnimationFrame` — รวม update ทั้งเฟรมเป็น draw เดียว (uPlot `setData`)
- `setState` ของ React เฉพาะค่าที่ต้องแสดงเป็นตัวหนังสือ (latest readout, badge) — และ throttle ที่ ~4Hz; กราฟไม่ผ่าน React state เลย
- ปิด/แช่ tab → หยุด flush แต่ buffer ยังรับ (cap อยู่); กลับมา → resume render จาก buffer

### Reconnect

- exponential backoff `1s → 2s → 4s → … → cap 30s` + **jitter ±25%** (กัน thundering herd ตอน server กลับมา)
- reconnect สำเร็จ → re-subscribe pattern เดิม + fetch gap-fill ผ่าน `GET /api/tags/{name}/history?from=<last_ts>` เฉพาะ tag ที่แสดงอยู่
- UI แสดงสถานะ connection เสมอ (banner เทา/เหลืองตาม design system 07) — ห้ามแสดงค่าเก่าเป็นค่าปัจจุบันโดยไม่บอก stale

### Backpressure guard

- ถ้า ring buffer เต็มต่อเนื่อง >2 รอบ flush → client ขยับไป subscribe แบบ coarse (ขอ server batch หนักขึ้น / เหลือเฉพาะ visible tags)
- metric ฝั่ง client: `ws_msgs_dropped`, `ws_reconnects` — log ไป `/api/health` heartbeat เผื่อ debug

## 5. Auth Flow

- Cognito Hosted UI → Authorization Code + PKCE → JWT (access token)
- Frontend เก็บ access token ใน memory (ไม่ใช่ localStorage) + refresh ผ่าน HttpOnly cookie (Cognito)
- REST/WS ตรวจ JWT ฝั่ง backend (verify signature + `cognito:groups` claim)
- Role mapping: group `operators` → write allowed; group `admins` → + config; ไม่มี group → public read
- Public read: REST GET + WS ที่ไม่มี token ก็ได้ — แต่ POST/PATCH/DELETE ต้องมี token + group

### Token expiry กลาง WS session (ล็อกไว้ — JWT ~1 ชม. แต่ WS อยู่ได้เป็นวัน)

- server เช็ก `exp` ทุก 60s บน connection ที่ auth แล้ว; เหลือ ≤5 นาที →
  ส่ง `{"type":"auth_expiring","in_s":300}` ให้ client รู้ล่วงหน้า
- `exp` ผ่าน → server ส่ง `{"type":"auth_expired"}` แล้ว close `4401`
- client flow: silent refresh ผ่าน Cognito cookie → reconnect ด้วย token ใหม่ →
  restore subscriptions → gap-fill ตาม §4 (ผู้ใช้ไม่ควรกระทบอะไรเลย)
- ถ้า refresh ล้ม (refresh token หมดจริง) → UI เปลี่ยนเป็น public mode +
  banner "session expired — login ใหม่"; ปุ่ม control หายทันที
- **ห้าม** trust connection ที่ auth ครั้งเดียวตอนเปิด — token ที่ revoke
  ต้องมีผล ≤60s หลังหมดอายุ (claim `groups` เปลี่ยน → connection เก่าหลุดสิทธิ์
  ที่ `auth_expired` cycle ถัดไป ไม่ใช่ไม่มีกำหนด)

### Multi-replica note (เมื่อ backend >1 task)

- WS fan-out ผ่าน Redis pub/sub (ดู 10 §1) — broadcast event จาก replica ที่
  ingest ไปทุก replica
- ถ้า Redis ล้ม: connection บน replica อื่นหยุดรับ update → metric
  `ws_fanout_degraded` + health page แดง; client reconnect ไป replica เดียวกัน
  ก็ไม่หาย — **ต้อง alert ไม่ใช่เงียบ** (ผู้ใช้เห็น data นิ่งเหมือน OT ตาย)

## 6. Rate Limiting & Quotas

| Path | Limit |
|---|---|
| WS connections | 100 concurrent/IP (public) — scale ได้ถ้าจำเป็น |
| POST /api/commands | 30/min/user |
| GET history | 1000 points max per request, ต้องกำหนด res ถ้า range > 1 ชม. |
| Alarm ack | ไม่ rate-limit (แต่ audit) |

## 7. Versioning

- API path prefix `/api/v1/` เผื่อ breaking change
- WS message มี `"v":1` field เผื่อ schema evolution
- Tag schema เป็น contract ถาวร — เปลี่ยน = migration ที่ระบุใน changelog
