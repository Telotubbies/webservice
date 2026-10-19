# SCADA Parity — Implementation Plan

Spec: `docs/superpowers/specs/2026-10-19-scada-parity-design.md`
แต่ละ phase = 1 commit/PR, contract tests ต้องผ่านก่อนไป phase ถัดไป

## P0 — MFA + step-up + IEC 62443 ✅ เสร็จ (commit 8e0e447)
- [x] Migration 0050: `organizations.mfa_required`, `api_keys.allow_control`
- [x] `Principal.acr/auth_time/mfa_orgs/allow_control`; `deps.mfa_gate` (ทุก route ของ org), `deps.step_up` (commands)
- [x] `GET/PATCH /api/v1/orgs/{org}/security`; API key `allow_control` (ต้อง step-up)
- [x] Keycloak realm: TOTP, flow `browser-loa` (LoA pwd=1/mfa=2), mapper `auth_time`, password policy
- [x] Web: 401 `mfa_required/step_up_required` → re-login `acr_values=mfa`; การ์ด MFA ในหน้า Security › Access; checkbox ใน API keys
- [x] `docs/security/iec62443-mapping.md`
- [ ] **ค้าง:** ทดสอบ flow จริงกับ Keycloak (ต้องรัน docker) — สลับ realm แล้วต้อง re-import realm
- ตัดจาก spec: ปุ่ม reset MFA ในแอป (ใช้ Keycloak console แทน backend ไม่ถือสิทธิ์ realm-admin), max-age ราย org, auto-resume คำสั่งหลัง step-up

## P1 — ISA-95 hierarchy + area permissions ✅ เสร็จ
1. [x] Migration 0051: `areas`, `lines.area_id` (backfill `default` แล้ว NOT NULL + trigger ใส่ default area ให้ INSERT เดิม), `lines.kind`, `devices.kind`, `plant_parts.device_id`, `area_grants` + RLS
2. [x] `backend/app/plant/hierarchy.py`: CRUD areas/lines/devices, `GET /sites/{site}/hierarchy` (`?tags=true` ให้ path ต่อ equipment), `POST /tags/move`, area grants GET/PUT
3. [x] `area_allowed` เรียกใน `CommandManager.issue` (403 `area_forbidden`) — recipe/sequence จะเรียกตัวเดียวกันใน P6
4. [x] Web: หน้า Plant structure (`/structure`, ไม่ใช้ `/assets` เพราะชนกับ `/assets/` ของ Vite บน nginx), ย้ายด้วย select + confirm, quick start, scope picker เพิ่ม Area/Line, bulk "ย้ายไปที่เครื่องจักร" ในหน้า Tags, matrix สิทธิ์ใน Security › Access
5. [x] Tests: contract `test_hierarchy.py`, tenancy `test_hierarchy.py` (cross-org, default area, FK, rule)
- ยังไม่ทำ: drag-and-drop ในต้นไม้ (ใช้ select + confirm แทนเพื่อให้ใช้ด้วยคีย์บอร์ดได้); ยังไม่มี integration test ยิง command ผ่าน HTTP ด้วย operator ที่ถูกจำกัดพื้นที่

## P2 — Historian (partition + rollup) ✅ เสร็จ — **เปลี่ยนจาก TimescaleDB เป็น native partition**
Spike ผลลัพธ์: hypertable ใช้กับ RLS ได้ แต่ **compression และ continuous aggregate ถูกปฏิเสธบนตารางที่มี RLS**
→ ใช้ fallback ของ spec ตาม `docs/adr/0002-historian-partitioning.md` (ไม่เปลี่ยน image, ไม่มี Timescale license)
1. [x] Spike (timescale 2.17.2-pg16, throwaway container) — ผลข้างบน
2. [x] Migration 0052: `tag_history` PARTITION BY RANGE(ts) รายเดือน + default partition, คอลัมน์ `vn`, `tag_rollup_1m/1h` (RLS ปกติ), ฟังก์ชัน `wds_history_ensure_partitions/drop_before` (SECURITY DEFINER; ย้ายแถวจาก default partition เข้าเดือนใหม่)
3. [x] Ingest เขียน `vn`; `production/rollup.py` refresh ทุก 60 วิ (advisory lock, 1m←raw, 1h←1m, deep pass ทุกชั่วโมง); `tagquery` เลือก raw/1m/1h + `"source"`; retention ใช้ PK แทน `ctid` + drop partition เก่ากว่าแผนที่ยาวสุด
4. [x] ADR-0002 + DEPLOY.md (ไม่ต้องเปลี่ยน compose)
5. [x] Tests: tenancy `test_historian.py` / `test_historian_perf.py` (1 tag × 1 ปี p95 < 500 ms จาก rollup), contract `test_rollup.py`, bun `agg.test.ts`
6. [x] Web: ช่วงเวลา 1d/7d/30d/1y ใน Trends ใช้ rollup + ข้อความ "แสดงค่าเฉลี่ยราย …"
- ตัดออก: "บีบอัดแล้ว N เท่า" ใน Admin › Storage (ไม่มี compression); bool ใน agg แสดงเป็นสัดส่วน 0/1 แทน null
- ยังไม่ทำ: widget บน Dashboard ยังจำกัด 8 ชม. (`RETENTION_MS`); ตรวจหน้า Trends 1y ด้วยภาพจริงไม่สำเร็จ (org switcher ใน dev เต็มไปด้วย org ทดสอบ) ตรวจผ่าน API + unit test แทน

## P3 — Derived tags
1. Migration 0053: `tags.source`, `tag_formulas`
2. `production/formula.py` (lexer + Pratt parser + evaluator, ไม่มี eval) + unit tests เยอะ
3. แยก ingest ออกจาก `main.py` → `production/ingest.py`; `production/derived.py` engine (index, window buffer, throttle, advisory lock)
4. API validate + CRUD (admin, audit `formula.changed`)
5. Web: formula editor แบบ Datadog (ตัวแปร a,b + preview + template), badge ƒ ในหน้า Tags

## P4 — PWA + Web Push
1. `vite-plugin-pwa`: manifest TH/EN, SW cache app shell เท่านั้น, ล้าง cache ตอน logout
2. Migration 0054: `push_subscriptions`; channel `webpush` ใน `alarming/notify.py` (VAPID, payload ไม่มีค่า process)
3. Web: bottom nav มือถือ, alarm การ์ด + ack, install prompt, คำแนะนำ iOS

## P5 — BACnet + Sparkplug B (edge-bridge)
1. Migration 0055: `data_sources.protocol` + `'bacnet','sparkplug'`; address validators
2. `adapters/bacnet.py` (bacpypes3): poll/COV, WriteProperty priority 8, browse op
3. `adapters/sparkplug.py`: Tahu `sparkplug_b.proto` + protobuf, BIRTH/DATA/DEATH, seq/rebirth, DCMD, จำกัด metric/payload, TLS บังคับ
4. Web: การ์ดใน Add data source wizard + discovery เลือก point/metric

## P6 — Recipe → Sequence
1. Migration 0056: recipes, recipe_items (four-eyes approve); download ผ่าน `commands.issue` + step-up + area_gate
2. Migration 0057: sequences, steps, runs, run_events; `production/sequencer.py` (Held หลัง restart, interlock, timeout)
3. Web: recipe view + compare live; sequence editor แนวตั้ง + run view (Hold/Abort/Resume) + dry run บน sim

## ทุก phase
- อัปเดต `iec62443-mapping.md`, i18n TH/EN (`node scripts/check-i18n.mjs`), `pytest tests/` (contract) และ integration เมื่อ docker พร้อม
