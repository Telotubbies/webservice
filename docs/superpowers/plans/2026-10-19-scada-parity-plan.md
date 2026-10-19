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

## P2 — TimescaleDB historian
1. Spike: image `timescale/timescaledb:2.x-pg16`, ยืนยัน RLS บน hypertable + compressed chunk (`tests/tenancy`) — ไม่ผ่าน → native partition
2. Migration 0052: extension, `tag_history.vn`, `create_hypertable(migrate_data)`, compression 7d, caggs `tag_rollup_1m/1h`, function `tag_rollup()` SECURITY DEFINER, revoke caggs จาก wds_app
3. Ingest เขียน `vn`; `tagquery.py` เลือก raw/1m/1h + `"source"` ใน response
4. compose ×3 + DEPLOY.md + ADR-0002; perf test trend 1 ปี
5. Web: hint "ค่าเฉลี่ย 1 ชม." บน trend; ขนาดบีบอัดใน Admin › Storage

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
