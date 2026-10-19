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

## P3 — Derived tags ✅ เสร็จ
1. [x] Migration 0053: `tags.source` (+ CHECK: derived = ไม่มี edge, ไม่ writable), `tag_formulas` + RLS
2. [x] `production/formula.py`: lexer + Pratt parser + evaluator ไม่มี eval, จำกัด 500 ตัวอักษร / 200 node / ซ้อน 100 ชั้น, หน้าต่าง 1s–24h (120 unit tests รวม fuzz-style "ไม่มีทางหลุดไปทำอย่างอื่น" และเช็ค AST ว่าไม่เรียก eval/exec/import)
3. [x] แยก ingest core ออกจาก `main.py` → `production/ingest.py` (`record_sample`, `flush_history`); `production/derived.py` engine: index input→derived, tick 1 วิ (= throttle), quality รวมแบบแย่สุด + input ที่เงียบเกิน 120 วิ → uncertain, leader ด้วย advisory lock, chaining derived→derived
4. [x] API `formulas/validate` (200 พร้อม preview ค่าจริงจาก tag_latest หรือ `ok:false`+ตำแหน่งผิด), CRUD `derived-tags` (admin/owner, audit `formula.changed` เก็บ expr เก่า/ใหม่), ตรวจ cycle / ลึกเกิน 5 ชั้น / input ต่าง site, ลบ tag ที่ derived อื่นอ่านอยู่ไม่ได้ (409)
5. [x] Web: dialog สร้าง/แก้ (เลือก tag ด้วย search, ค่าสดของตัวแปร, preview debounce 300 ms, ขีดชี้ตำแหน่งผิด + ข้อความ TH/EN, 5 template), badge ƒ ในหน้า Tags, flyout โชว์สูตรและตัวแปร
- ต่างจาก spec: `avg(a - b, 5m)` ใช้ได้ (window ครอบ expression ได้ ไม่ใช่เฉพาะตัวแปรตรงๆ — ตรงกับตัวอย่างใน UI ของ spec เอง); validate ตอบ 200 `ok:false` แทน 422 (ไม่ให้เป็น request ล้มเหลวทุกครั้งที่พิมพ์ยังไม่จบ)
- ยังไม่ทำ: warm-up window จาก rollup/raw ตอนเริ่ม (window เริ่มว่างหลัง restart); autocomplete ฟังก์ชัน; กราฟ dependency (มีแค่รายการตัวแปร); LISTEN `tags_changed` (ใช้ reload ทุก 30 วิ + reload ทันทีหลัง API เปลี่ยน)
- Tests: contract `test_formula.py` (120), `test_derived_engine.py` (14); integration `test_derived_tags.py` (5, ยิง backend จริง); ตรวจ e2e ด้วยมือ: สร้าง derived→chain→cycle ถูกปฏิเสธ→history ถูกเขียน

## P4 — PWA + Web Push ✅ เสร็จ (ต่างจากแผนบางจุด)
1. [x] PWA: `manifest.webmanifest` (192/512/maskable), `sw.js` เขียนเอง **ไม่ใช้ vite-plugin-pwa** (ควบคุมได้ชัดว่าแคชแค่ `/assets/` + หน้า offline, ไม่แตะ `/api` `/ws` ตรวจจริงว่า Cache Storage มีแต่ไฟล์ shell), nginx ให้ `sw.js`/manifest เป็น no-cache, logout → `disablePush` + `caches.delete` (จำกัด 2 วิ)
2. [x] Migration 0054: `push_subscriptions` (RLS), channel type `webpush`, `organizations.mobile_control`
3. [x] Web Push เขียนเองบน `cryptography` (RFC 8291 + VAPID RFC 8292) **ไม่ใช้ pywebpush**: ทดสอบกับตัวอย่างใน RFC (ecdh/IKM/CEK/nonce/ciphertext ตรงทุกค่า); VAPID key derive จาก `DATA_SOURCE_KEY` (ไม่มี secret ใหม่); endpoint ต้องเป็น https ของ push service ที่รู้จักเท่านั้น (กัน SSRF) + egress guard; payload มีแค่ "alarm ใหม่ระดับ X ที่ <area>" + ลิงก์ ไม่มีค่า/ชื่อ tag, แปลตามภาษาของผู้รับ, ส่งเฉพาะ raised/escalation, 404/410 ลบ subscription
4. [x] API: `GET /push/vapid-key`, subscribe/list/unsubscribe/test ของตัวเอง (สูงสุด 5 เครื่อง/คน, สร้าง channel "Mobile push" อัตโนมัติ), `/security` เพิ่ม `mobile_control` (admin, audit)
5. [x] Web: bottom nav 4 ปุ่ม (<768px, สูง 56px, badge alarm), offline banner, install hint (ครั้งที่ 3, iOS มีคำแนะนำ), การ์ด Settings › Mobile notifications (เปิด/ปิด/ทดสอบ/ขั้นตอน iOS), ปุ่ม Ack สูง ≥44px + ปัดซ้ายเพื่อ ack บนการ์ด alarm, ปุ่มสั่งงานบนจอแคบซ่อนตามเดิม เปิดได้ด้วย `mobile_control`
- ยังไม่ทำ: ส่ง push จริงถึง Google/Apple (ทดสอบเข้ารหัสด้วย RFC vector และ mock การส่ง; ยังไม่ได้ลองกับอุปกรณ์จริง), รูปประกอบคำแนะนำ iOS (มีข้อความทีละขั้น), widget Dashboard 3D → การ์ด "เปิดบนคอมพิวเตอร์", ปุ่ม ack ใน notification (ต้องผ่านหน้า login)
- Tests: contract `test_webpush.py` (29), integration `test_push_subscriptions.py` (7)

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
