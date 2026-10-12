# 09 — Testing Strategy

## 1. Test Pyramid

```
          ┌─────────┐
          │  E2E    │  5–10 critical flows (Playwright)
          ├─────────┤
          │  Integ. │  API + DB + MQTT + adapter mocks
          ├─────────┤
          │  Unit   │  adapters, normalizer, alarm engine, command lifecycle
          └─────────┘
```

## 2. Unit Tests (must-have ก่อน merge)

### edge-bridge
- `test_modbus_adapter_poll` — mock pymodbus → verify TagValue shape
- `test_normalize_*` — raw register → normalized value + unit
- `test_buffer_flush` — offline → reconnect → order preserved
- `test_command_idempotent` — same key → same response, no double write
- `test_writable_enforced` — write ไปที่ non-writable tag → denied
- `test_quality_bad_on_disconnect` — adapter fail → quality=BAD

### backend
- `test_command_lifecycle` — issued→sent→done transitions
- `test_command_timeout` — ไม่มี resp → timeout status
- `test_auth_public_read` — anonymous GET ผ่าน, POST ถูก 401
- `test_auth_operator_write` — group check
- `test_alarm_engine` — rule condition evaluate + transition
- `test_idempotency_dedup` — same key → same command_id

### vision
- `test_publish_tag_shape` — output conforms to TagValue schema
- `test_model_loads` — โหลด YOLO26n-seg weights จาก repo ได้

### frontend
- `test_quality_badge_render` — bad/stale/uncertain icons
- `test_stale_indicator` — tag เก่า >15s → STALE badge
- `test_command_button_confirm` — destructive → dialog แสดง
- `test_public_no_controls` — anonymous → ไม่มีปุ่ม control

## 3. Integration Tests

| Test | Setup | ยืนยัน |
|---|---|---|
| MQTT loop | local mosquitto + edge-bridge + backend | tag publish → DB insert → WS push |
| Command round-trip | backend + mock edge | POST /api/commands → cmd topic → resp → status=done |
| Alarm pipeline | feed tag value เข้า engine | alarm raise → ack → cleared ใน DB |
| Store-forward | kill mosquitto → edge buffer → restore → flush | ไม่มี data loss, timestamp ถูก |
| Timescale write | batch insert 100 tags/s × 60s | no loss, query ได้ |

## 4. Contract Tests

- `TagValue` schema: Pydantic model — test ทุก adapter คืน schema เดียวกัน
- `Command` payload: JSON Schema validate บน MQTT publish/subscribe
- REST: OpenAPI spec → generate client → verify frontend call ตรง contract
- WS message: schema per type (`tag`/`alarm`/`command`/`health`)

## 5. E2E Tests (Playwright)

```
E2E-1: public user เปิด / → เห็น dashboard, ไม่มีปุ่ม control
E2E-2: operator login → /mimic → กด "Stop Conv1" → confirm → status=done
E2E-3: tag disconnect → STALE badge ขึ้น < 20s
E2E-4: alarm raise → badge count +1 → ack → cleared
E2E-5: trend: เลือก tag → chart render + export CSV มีข้อมูล
```

## 6. Load / Performance Tests

- **Ingestion**: ปั๊ม 100 tags/s × 10 นาที → ตรวจไม่มี message หล่น, DB write latency p99 < 500ms
- **WS fan-out**: 50 concurrent clients + 100 tags/s → latency p99 < 2s
- **Burst**: 500 tags/s × 1 นาที → queue ไม่ล้น
- **Buffer**: offline 30 นาที → flush ภายใน 5 นาที ครบทุก row

## 6.5 Field-Lesson Tests (จากเอกสาร 14 — เทสที่ community เจ็บมาก่อน)

| Test | จำลอง | ยืนยัน |
|---|---|---|
| `test_poll_storm_guard` | adapter crash-loop / PLC ไม่ตอบ | retry = exponential backoff + max retry; ไม่มี reconnect spam >1 ครั้ง/backoff interval |
| `test_single_poller` | config 2 adapter ชี้ device เดียวกัน | edge refuse startup / warn — กฎ "poller เดียวต่อ device" |
| `test_block_read_grouping` | tag 10 ตัว contiguous | 1 block request ไม่ใช่ 10 request |
| `test_poll_class_promotion` | tag fast 1 ตัวอยู่ใน slow block | block ไม่ถูกลากไป rate เร็วสุดเงียบๆ — แยก block ตาม poll_class |
| `test_reconnect_backoff_jitter` | kill broker → คืนชีพ | reconnect backoff + jitter (ไม่ thundering herd), cap ~5–10 นาที |
| `test_cert_expiry_path` | cert หมดอายุ/mock expired | edge fail ชัดเจน (log + health tag=BAD), ไม่ใช่ hang เงียบ — เทียบ revoke runbook 08 §6.1 |
| `test_port102_silent_block` | S7 target ที่ port 102 ถูก drop (ไม่ใช่ refuse) | adapter timeout + quality=BAD ภายใน timeout — ไม่ค้างนิรันดร์ |
| `test_mode_b_command_denied` | OpenPLC/PLC ladder ไม่ยอม (interlock) | command status=`denied` ไม่ใช่ `done` — เทสว่า safety boundary ทำงานจริง |
| `test_unknown_tag_dropped` | publish tag ที่ไม่มีใน `tags` table | backend drop + metric `telemetry_unknown_tag` เพิ่ม |

## 6.6 Adversarial-Review Tests (จาก design review — ช่องโหว่ที่ spec เดิมไม่ครอบ)

| Test | จำลอง | ยืนยัน |
|---|---|---|
| `test_concurrent_command_conflict` | 2 clients POST /api/commands tag เดียวกันพร้อมกัน | อันแรกผ่าน, อันสองได้ **409** + `active_command_id` — ห้าม double-write (06 §3, index ใน 05) |
| `test_idempotent_replay_after_409` | resend `idempotency_key` เดิม | ได้ command เดิมกลับ (ไม่ใช่ 409) — dedup ต้องมาก่อน conflict check |
| `test_command_ttl_expired_edge` | cmd `ttl_s=5` แต่ edge offline 10s | edge **drop + ตอบ `denied` (detail=`ttl_expired`)** → backend mark `denied` — ไม่ execute คำสั่งเก่า (04 §5) |
| `test_ws_token_expiry_mid_session` | token หมดอายุขณะ WS เปิดอยู่ | server ส่ง `auth.expiring` → client refresh → resume ไม่ drop subscriptions; ถ้าไม่ refresh → close code 4001 (06 §5) |
| `test_ws_fanout_replica` | backend 2 replica + Redis down | client ที่ต่อ replica A ยังเห็น event จาก replica B? — ถ้า Redis down: degrade เป็น local-only + `health` event warn (06 §5) |
| `test_clock_skew_bad` | edge clock ผิด >30s | tag → `quality=uncertain`, command จาก edge นั้น denied, metric `edge_clock_untrusted` (04 §6.6) |
| `test_alarm_flood` | 500 alarms/min spike | UI ไม่ค้าง, alarm banner เด้งทีละกลุ่ม; ISA-18.2 flood handling — rate-limit popup แต่ไม่ drop record |
| `test_render_bad_stale` | tag `quality=bad` / stale >15s | mimic แสดง "—" + badge เทา, **ไม่แสดงค่าตัวเลขล่าสุด** (ISA-101 — ค่าตายต้องไม่ดูเหมือนค่าจริง) |
| `test_ntp_lost_uncertain` | edge ไม่มี NTP sync | telemetry ที่สร้างหลัง unsync → `uncertain`, heartbeat รายงาน `clock_ok=false` |

## 7. Security Tests

- `POST /api/commands` โดยไม่มี token → 401
- `POST /api/commands` ด้วย token ที่ไม่มี group `operators` → 403
- SQL injection attempt ใน `/api/tags/{name}` → parameterized query ป้องกัน
- XSS payload ใน tag description → frontend escape
- Command replay: ส่ง `idempotency_key` เดิมซ้ำ → ไม่ execute ซ้ำ
- WS subscribe pattern `*` → ไม่ leak command events ให้ anonymous

## 8. Factory I/O Acceptance (manual checklist)

- [ ] Modbus TCP connect สำเร็จ (Factory I/O driver = Modbus TCP Server)
- [ ] อ่าน coil/input register ครบตาม `tags.modbus.yaml`
- [ ] เขียน output coil ได้และเห็นใน scene (conveyor หยุดจริง)
- [ ] Tag quality=BAD เมื่อปิด Factory I/O
- [ ] Command จาก dashboard → Factory I/O ตอบใน <3s
- [ ] Vision service (ถ้าเปิด) publish tag ต่อเนื่อง

## 9. Definition of Done (per feature)

- [ ] unit test ผ่าน + coverage ไม่ลด
- [ ] integration test ผ่าน (ถ้าแตะ contract)
- [ ] E2E ผ่าน (ถ้าแตะ user flow)
- [ ] ไม่มี console error / type error / lint error
- [ ] docstring + README อัปเดตถ้า interface เปลี่ยน
- [ ] security review ถ้าแตะ auth/command/adapter
