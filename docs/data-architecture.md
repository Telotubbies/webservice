# สถาปัตยกรรมข้อมูล vissointan

สถานะ ณ 2026-11-06: เอกสารออกแบบ ยังไม่มีโค้ดตามส่วน "proposed" และไม่ได้รันระบบเพื่อวัดตัวเลข

เอกสารนี้เขียนให้คนเรียนรู้เรื่องการจัดการข้อมูลอ่านแล้วทำตามได้ ทุกข้อความมีป้ายกำกับ

- **exists (ไฟล์:บรรทัด)** คือเห็นในโค้ดจริงที่อ่านแล้ว เลขบรรทัดอาจขยับ ให้เช็กก่อนอ้าง
- **proposed** คือข้อเสนอใหม่ ยังไม่มีในโค้ด
- **estimate** คือคำนวณเองจากค่าในโค้ด แสดงวิธีคิดไว้ทุกครั้ง

## 0. หลักการ 5 ข้อ

คำแนะนำเดิมที่ใช้เป็นฐาน: ERP เป็นเจ้าของ master data, เราเป็นเจ้าของ floor facts, ใช้ outbox พร้อม idempotency key, เก็บตาราง mapping ของ id จาก ERP, ส่งขึ้น ERP เป็นยอดรวมต่อกะและต่อชั่วโมง ไม่ส่งข้อมูลดิบ

| # | หลักการ | เหตุผลสั้น ๆ |
|---|---|---|
| 1 | ERP เป็นเจ้าของ master data (สินค้า, ใบสั่งผลิต, work center, พนักงาน) | ลูกค้ามี ERP อยู่แล้ว ไม่ควรมีสองที่ให้แก้ |
| 2 | vissointan เป็นเจ้าของ floor facts (ค่าที่วัดได้, alarm, เครื่องหยุด, จำนวนที่นับได้) | ERP ไม่มีข้อมูลระดับวินาที และไม่ควรเดาแทน |
| 3 | ข้อมูลไหลทางเดียวต่อหนึ่งชนิด และมีเจ้าของเดียว | ป้องกันแก้ขัดกัน |
| 4 | ส่งออกผ่าน outbox ใน transaction เดียวกับข้อมูลต้นทาง | ส่งซ้ำได้ ไม่หาย |
| 5 | ส่งยอดรวม (กะ, ชั่วโมง) ไม่ส่ง raw | ERP ไม่ต้องรับ 100 แถวต่อวินาที |

ไม่สร้าง ERP เอง งานนี้ไม่มีสต็อก ใบสั่งซื้อ บัญชี หรือบัญชีเงินเดือน (ดู `docs/product-gap-plan.md` หัวข้อ "งานในอนาคต" ที่ตัดสูตรผลิตและตั๋วส่งของออกอยู่แล้ว)

## 1. ผังการไหลของข้อมูล

```text
 [PLC/เซนเซอร์] -> edge-bridge (poll 1 วินาที) -> spool SQLite (กันเน็ตหลุด)
                         |  MQTT QoS1  tele/<path>
                         v
              backend ingest (main.py _handle_telemetry)
        ตรวจ topic/tag, payload, อายุ ts  -> record_sample
                         |
        +----------------+-----------------+
        v                v                 v
   tag_latest      history_buf -> tag_history   alarm engine
   (ค่าล่าสุด)     (partition รายเดือน)         (alarms)
                         |
                  rollup job -> tag_rollup_1m -> tag_rollup_1h
                         |
   downtime sweep / OEE -> downtimes (kind='stop'), นับชิ้นงาน
                         |
        ================ proposed =================
                         v
        shift_summary / hour_summary  (ยอดรวม, F18)
                         |   เขียนใน tx เดียวกับ outbox row
                         v
                   integration_outbox -> dispatcher -> webhook / connector
                                                         |
 [ERP ของลูกค้า: Odoo ฯลฯ] <---- ส่งยอดขึ้น (idempotency key)
 [ERP ของลูกค้า] ----> ดึง master data ลง -> erp_id_map + ตารางอ้างอิง
```

## 2. รายการข้อมูล (data inventory)

### 2.1 ข้อสมมติในการคำนวณ

ตัวเลขทุกตัวด้านล่างเป็น estimate ต่อ 1 site ต่อวัน จากค่าในโค้ด

| ค่า | ที่มา |
|---|---|
| รอบ poll 1,000 ms เป็นค่าตั้งต้น | exists `edge-bridge/edge_bridge/config.py:48,91` |
| ทุกรอบ publish ทุก tag ไม่มี deadband | exists `edge-bridge/edge_bridge/main.py:42-60` (วนส่ง `values` ทั้งหมด) |
| tag ใน sim ประมาณ 93 รายการ ใช้ 100 เป็นตัวเลขกลม | exists `edge-bridge/tags.yaml` (นับบรรทัดคร่าว ๆ) |
| เพดาน tag ต่อ org: trial 100, starter 500, pro 5,000 | exists `backend/migrations/versions/0032_plans_platform.sql:37-39` |
| ขนาดแถว tag_history ประมาณ 130 ไบต์ | estimate: header 24 + tag_id 16 + ts 8 + org_id 16 + v jsonb ~9 + q ~5 + vn 8 = ~86 ไบต์ ปัดเป็น ~90 บวก index PK (tag_id, ts) ~40 |
| ขนาดแถว rollup 1m ประมาณ 150 ไบต์ | estimate: header 24 + org 16 + tag 16 + bucket 8 + mn/mx/sm 24 + nn/n 8 + lv 8 + lts 8 = 112 บวก index ~40 |

### 2.2 ตารางรายการ

| ชนิดข้อมูล | เจ้าของ | แหล่งความจริง | ตาราง / ไฟล์ | retention | โตต่อ site ต่อวัน | ขอบเขต tenant |
|---|---|---|---|---|---|---|
| Telemetry ดิบ | เรา (floor fact) | edge อ่านจาก PLC แล้วส่งมา | `tag_history` partition รายเดือน, exists `0052_history_partitions.sql:17-29` | ตามแพลน 7/90/365 วัน, exists `0032_plans_platform.sql:37-39` และ `plans.py:175` | 100 tag x 86,400 = 8.64M แถว x 130 B = ~1.1 GB | RLS ด้วย `org_id`, exists `0052...sql` ส่วน policy `tenant_isolation` |
| ค่าล่าสุด | เรา | ingest | `tag_latest`, exists `0001_saas_schema.sql:157` | ทับค่าเดิม ไม่โต | 100 แถวคงที่ | RLS |
| Telemetry rollup 1 นาที | เรา (derived) | คำนวณจาก tag_history | `tag_rollup_1m`, exists `0052...sql:~125` | min(แพลน, 90 วัน), exists `rollup.py:31,150-153` | 100 x 1,440 = 144,000 แถว x 150 B = ~22 MB | RLS |
| Telemetry rollup 1 ชั่วโมง | เรา (derived) | คำนวณจาก rollup 1m | `tag_rollup_1h` | ตามแพลน, exists `rollup.py:150` | 100 x 24 = 2,400 แถว x 150 B = ~0.4 MB | RLS |
| Alarm | เรา | alarm engine | `alarms`, `alarm_rules`, exists `0001...sql:180,198` | ไม่มี job ลบ (ดู 3.5) | สมมติ 50 แถว x ~150 B = ~7 KB (estimate, ไม่มีสถิติจริง) | RLS |
| Events (command, incident, config) | เรา | หลายตาราง | feed รวมจาก `alarms`, `command_events`, `audit_log`, `incident_events`, exists `eventsfeed.py:1-15` | ตามแต่ละตาราง ไม่มีเพดานรวม | ราว 100 แถว x ~300 B = ~30 KB (estimate) | RLS |
| เครื่องหยุดและช่วงงดแจ้งเตือน | เรา | state tag + sweep | `downtimes`, kind `window` กับ `stop`, exists `0008_downtimes.sql:6`, `0042_downtime_reasons.sql` (ขยายตาราง) | ไม่มี job ลบ | สมมติ 20 แถว x ~250 B = ~5 KB (estimate) | RLS |
| ยอดผลิต / OEE | เรา (คำนวณตอนอ่าน) | counter tag | ไม่เก็บ คำนวณจาก `tag_history` ผ่าน `_counter_sum`, exists `oee.py:242,516` | ตาม tag_history | 0 (แต่หายไปเมื่อ raw ถูกลบ ดู 3.5) | RLS |
| กะ ปฏิทิน เครื่อง-สินค้า | ผสม: กะเป็นของเรา, ชื่อสินค้าควรมาจาก ERP | ผู้ใช้กรอก | `shifts`, `nonworking_days`, `machine_state_map`, `machine_products`, exists `0039`, `0040`, `0041` | ถาวร | ~0 | RLS |
| Master data: สินค้า, ใบสั่งผลิต, work center | **ERP** | ERP ลูกค้า | ยังไม่มี; ตอนนี้ `machine_products.product` เป็น text อิสระ, exists `0041_machine_oee.sql:35-41` | n/a | n/a | proposed ตารางอ้างอิง RLS |
| Config (tag, data source, rule, สูตร) | เรา | ผู้ใช้ + แผน | `tags`, `data_sources`, `alarm_rules`, `tag_formulas`, exists `0001`, `0015`, `0053` | ถาวร | ~0 | RLS |
| Audit | เรา | audit module | `audit_log` มี hash chain ต่อ org, exists `0001...sql:277-290` | ไม่มี job ลบ | สมมติ 100 แถว x ~500 B = ~50 KB (estimate) | RLS + `UNIQUE (org_id, seq)` |
| Vision event | เรา | edge/vision engine | `vision_events` มี thumb สูงสุด 128 KB, exists `0023_vision_events.sql:6-22` | ไม่พบ job ลบ | สมมติ 200 แถว x 30 KB เฉลี่ย = ~6 MB สูงสุด 200 x 128 KB = ~26 MB (estimate) | RLS |
| วิดีโอ/โมเดลไฟล์ | เรา | อัปโหลดโดยผู้ใช้ | ไฟล์ใต้ `VIDEO_DIR`, `MODEL_DIR` แยกโฟลเดอร์ตาม org, exists `config.py:65,69`, `workers.py:410-425` | จนกว่าลบหรือ purge org | ขึ้นกับผู้ใช้ | โฟลเดอร์ต่อ org (ไม่ใช่ RLS) |
| Vision frame ดิบและ label | ยังไม่ชัด | กล้อง `fps_sample` ตั้งต้น 5, exists `vision/cameras.py:44` | ไม่พบตาราง label หรือที่เก็บเฟรมดิบในโค้ดที่อ่าน | n/a | n/a | proposed: ตัดสินใจก่อน (ดูข้อ 8) |
| Users, orgs, memberships | เรา (ตัวตนจริงอยู่ที่ Keycloak) | Keycloak + `users` | `users`, `organizations`, `memberships`, exists `0001...sql:19-46` | org ถูกลบแบบ soft แล้ว purge 30 วัน, exists `0038_purge_export_grants.sql:25-37` | ~0 | `organizations` เป็นราก; ตารางลูกอ้าง `org_id` |
| Export ที่ขอ | เรา | worker | `org_exports` + zip ใต้ `EXPORT_DIR`, exists `0037_org_exports.sql:6`; ไฟล์หมดอายุ 7 วัน | 7 วัน | ขึ้นกับการขอ | RLS |
| Edge log | เรา | edge | `edge_logs`, exists `0045_edge_logs.sql:9` | ไม่ได้ตรวจ | ไม่ได้ตรวจ | RLS |

### 2.3 สิ่งที่ตัวเลขบอก

1. **ปัญหาใหญ่คือ raw telemetry** ที่ 1 Hz ไม่มี deadband: แพลน starter (500 tag) ได้ 500 x 86,400 = 43.2M แถวต่อวัน x 130 B = ~5.6 GB ต่อวัน เก็บ 90 วันได้ ~505 GB ต่อ site (estimate) แพลน pro เพดาน 5,000 tag คือ 5,000 ข้อความต่อวินาที และ ~56 GB ต่อวัน ซึ่งฐาน Postgres เครื่องเดียวรับยาก
2. ตัวเลขแพลน (7/90/365 วัน) ใช้กับ raw ทั้งหมด ทางเลือกใน 3.5 คือแยก retention ของ raw ให้สั้น (เช่น 14 วัน) และเก็บ rollup ยาว ต้องให้เจ้าของผลิตภัณฑ์ตัดสินใจ (ข้อ 8)
3. rollup เล็กกว่า raw ประมาณ 50 เท่า (22 MB เทียบ 1.1 GB ที่ 100 tag) จึงเป็นข้อมูลที่ควรเก็บนาน
4. **spool ของ edge เต็มเร็วกว่าที่คอมเมนต์ในโค้ดบอก**: ค่าตั้งต้น 200,000 แถว, exists `edge-bridge/edge_bridge/spool.py:22` คอมเมนต์ในโค้ดเขียนว่า ~1 ชั่วโมงที่ 50 tag แต่ที่ 100 tag คือ 200,000 / 100 = 2,000 วินาที ประมาณ 33 นาที เมื่อเต็มจะทิ้งแถวเก่าสุด, exists `spool.py:77-81`
5. backend ทิ้ง sample ที่เก่ากว่า 8 ชั่วโมง, exists `main.py:407-409`, `config.py:215` ดังนั้นการต่อเน็ตกลับหลังเกิน 8 ชั่วโมงข้อมูลช่วงแรกหายแม้ spool จะเก็บไว้ทัน

## 3. วงจรชีวิตข้อมูล (lifecycle)

### 3.1 ตารางสรุปแต่ละขั้น

| ขั้น | สถานะ | อยู่ที่ไหน |
|---|---|---|
| Ingest | exists | edge ส่ง `tele/<path>` QoS1; backend ตรวจ topic, tag อยู่ใน site และผูกกับ edge นี้, `main.py:391-398` |
| Validation | exists บางส่วน | payload ผ่าน `TelemetryMsg` (`main.py:399-403`); ts อนาคตเกิน 5 วินาทีทิ้ง (`main.py:404`); เก่าเกิน 8 ชม. ทิ้ง (`main.py:407`) |
| Quality flag | exists | `q` ต้องเป็น good, bad, stale หรือ uncertain, CHECK ใน `0001...sql:157-164` |
| ซ้ำ (duplicate) | exists | `ON CONFLICT (tag_id, ts) DO NOTHING`, `ingest.py:62-63` |
| มาช้า (late) | exists | `tag_latest` ทับเฉพาะ ts ใหม่กว่า, `ingest.py:25-30`; alarm ที่เกิดจากข้อมูลย้อนหลังติดธง `alarms.late`, `0055_alarm_rtn_late.sql:19`; alarm engine ประเมินเฉพาะ sample ที่อายุไม่เกิน 15 วินาที, `CONTRACT.v2.md` §6 |
| Rollup | exists | job รีเฟรช 1m แล้ว 1h; ชั้นลึกทุกชั่วโมงสำหรับ sample มาช้า, `rollup.py:22-31,107` |
| Retention | exists | `plans.retention_prune` ลบรายแถวตามแพลนของแต่ละ org แล้วลบ partition เก่าทั้งก้อน, `plans.py:175-205` |
| Archive | proposed | ยังไม่มี (ดู 3.5) |
| Backup | exists | `pg_dump -Fc` รายวันของ wds และ keycloak ขึ้น S3 เก็บ 30 วัน, `infra/backup/backup.sh:9,22,29` |
| Restore ต่อ org | proposed | ยังไม่มี (ดู 3.6) |
| Export ตอน org ออก | exists บางส่วน | `org_exports` + `_EXPORT_QUERIES`, `workers.py:281-305` ขาดหลายตาราง (ดู 3.7) |
| ลบตอน org ออก | exists | soft delete แล้ว `wds_purge_organization` หลัง 30 วัน และลบโฟลเดอร์ไฟล์, `0038...sql:25-37`, `workers.py:410-432` |

### 3.2 ช่องว่างใน validation

| ช่องว่าง | หลักฐาน | ข้อเสนอ |
|---|---|---|
| Rollup นับทุก sample โดยไม่ดู `q` | `_SQL_1M` ไม่มีเงื่อนไข `q`, `rollup.py:56-65` ค่า bad หรือ stale จึงปนใน min/max/avg | proposed: นับ `n_bad` แยก หรือกรอง `q='good'` ใน `nn`; เลือกแบบแรกเพราะไม่ทิ้งข้อมูล |
| ไม่มี range check ของ tag ฝั่ง ingest | `tags` มี `min_value`/`max_value` (`0001...sql:126-145`) แต่ ingest ไม่ใช้ในโค้ดที่อ่าน | proposed: ถ้าอยู่นอกช่วงให้ลด q เป็น `uncertain` ไม่ทิ้ง |
| ทิ้งข้อมูลเงียบ ๆ แต่นับ | `_count(st, "telemetry_too_old" ...)` | exists นับเป็น counter; proposed: แสดงบนหน้า health |
| `clock_ok` ไม่ถูกใช้ตัดสินใจตอน ingest | heartbeat เก็บค่า (`main.py:414-426`) แต่ `_handle_telemetry` ไม่อ่าน | proposed: ดูข้อ 6.3 |

### 3.3 ตัวอย่างลำดับเมื่อเน็ตหลุด 20 นาที

1. edge ยังอ่านค่าต่อ ใส่ spool บนดิสก์ (exists `spool.py:67-80`)
2. เน็ตกลับมา edge ส่งย้อนหลังช้า ๆ ไม่เกิน 200 ข้อความต่อวินาที เพื่อไม่ให้ข้อมูลสดต้องรอ, exists `mqtt_bridge.py:46-47`
3. backend รับ ตรวจ `ts` อายุไม่เกิน 8 ชม. แล้วเขียน `tag_history` ส่วน `tag_latest` ไม่ถูกทับเพราะ ts เก่ากว่า
4. rollup ชั้นลึกรอบถัดไป (ทุกชั่วโมง) คำนวณช่วงนั้นใหม่ ทำให้กราฟรายนาทีถูกต้องหลังช้าไม่เกิน 1 ชั่วโมง
5. alarm ที่เกิดจากข้อมูลย้อนหลังไม่ส่งแจ้งเตือน (ธง `late`)

### 3.4 เกณฑ์ที่ใช้ตัดสินว่าข้อมูลอยู่ชั้นไหน

| ชั้น | อายุ | ทำอะไรได้ | เก็บที่ไหน |
|---|---|---|---|
| Hot | 0 ถึง 14 วัน (proposed ค่าเริ่ม) | query ได้ทุกความละเอียด | `tag_history` |
| Warm | จนถึงตามแพลน | กราฟรายนาที/ชั่วโมง | `tag_rollup_1m` (สูงสุด 90 วัน), `tag_rollup_1h` |
| Cold | เกินแพลน | ดาวน์โหลดไฟล์เท่านั้น | proposed: ไฟล์ Parquet/CSV บีบอัดใน S3 (Garage) แยกตาม org/เดือน |
| ลบ | หลังกำหนดสัญญา | ไม่มี | ลบ partition |

ค่า 14 วันของ Hot เป็นข้อเสนอเริ่มต้นเท่านั้น ยังไม่ได้วัดการใช้งานจริง

### 3.5 Retention และ archive: ที่มีกับที่เสนอ

| งาน | สถานะ | รายละเอียด |
|---|---|---|
| ลบ raw ตามแพลน | exists | `retention_prune` ทุก `HISTORY_PRUNE_S` = 300 วินาที (`config.py:219`) ลบทีละ 10,000 แถว (`config.py:220`) |
| ลบ partition รายเดือนที่เก่ากว่าแพลนที่ยาวที่สุด | exists | `wds_history_drop_before`, `0052...sql:73-96` |
| สร้าง partition ล่วงหน้า 3 เดือน | exists | `rollup.ensure_partitions` รันทุก 86,400 วินาที, `main.py:541` |
| ลบ rollup | exists | `prune_rollups`, `rollup.py:150` |
| ลบ audit, alarm, downtime, vision_events | **ไม่มี** | ตารางเหล่านี้โตไม่จำกัด; proposed: นโยบาย retention ต่อ data class (F20) |
| Archive ก่อนลบ | **ไม่มี** | proposed: ก่อน drop partition ให้ export เป็นไฟล์ลง S3 แล้วบันทึกใน `archive_manifest` |
| Raw ที่ลบแล้ว ทำให้ OEE ย้อนหลังคำนวณไม่ได้ | ความเสี่ยง | `_counter_sum` อ่านจาก `tag_history`, `oee.py:242`; proposed: `shift_summary` (ข้อ 4.7) เก็บยอดสุดท้ายถาวรก่อนลบ raw |
| เงื่อนไขของ retention ที่สั้นกว่า | ข้อสังเกต | partition ถูกลบตามแพลนที่ยาวสุดเท่านั้น แพลนสั้นต้องรอ DELETE รายแถว ซึ่งช้ากว่าและทิ้ง bloat |

### 3.6 Backup และ restore ต่อ org

สิ่งที่มี: dump ทั้งฐาน (`backup.sh`) และคำสั่ง `make restore` ตามคอมเมนต์ใน `backup.sh:2-4` ปัญหาที่เห็น (ใน `docs/product-gap-plan.md` F15): backup ล้มเหลวแล้วยังลบไฟล์เก่าได้ (`backup.sh:25-29`) ยังไม่มีการทดสอบ restore

สิ่งที่ยังไม่มี: restore เฉพาะ org เดียว เพราะ dump เป็นของทั้งฐาน

| ทางเลือก | ข้อดี | ข้อเสีย | คำแนะนำ |
|---|---|---|---|
| A. restore ทั้งฐานลงเครื่องชั่วคราว แล้วดึง org เดียวด้วย SQL | ไม่ต้องเขียนอะไรใหม่ | ช้า ต้องมีดิสก์เท่าฐาน | ใช้ตอนนี้ เขียนเป็น runbook |
| B. export ราย org เป็นไฟล์ (ขยาย `_EXPORT_QUERIES`) แล้ว import กลับ | ย้าย org ข้ามเครื่องได้ | ต้องเขียน importer, ต้องจัดลำดับตาม FK | ทำใน F20 ถ้าลูกค้าต้องการ |

proposed ขั้นต่ำ: คำสั่ง `scripts/restore-org.sh <org_id>` ตามทางเลือก A และบันทึกวิธีใน `DEPLOY.md` (ไฟล์นั้นเป็นของ F15) กับงานทดสอบ restore จริงอย่างน้อยหนึ่งครั้งก่อนบอกว่ามี backup

### 3.7 ลบและส่งออกเมื่อ tenant ออก

| ขั้น | สถานะ |
|---|---|
| ลูกค้าขอ export | exists `org_exports` + worker `export_zip`, `workers.py:59,83` |
| ไฟล์ zip หมดอายุ 7 วัน | exists `0037_org_exports.sql:1-3` |
| ลบ org แบบ soft (`deleted_at`) | exists `0001...sql:38-43` |
| purge ถาวรหลัง 30 วันและลบโฟลเดอร์ | exists `workers.py:427-432` |
| zip มีตารางครบ | **ไม่ครบ** |

`_EXPORT_QUERIES` (`workers.py:281-305`) ส่งออก: organization, sites, edges, tags, alarm_rules, alarms, audit_log, members, invites, incidents, tag_history. ที่ขาดคือ `downtimes`, `downtime_reasons`, `shifts`, `machine_state_map`, `machine_products`, `vision_events`, `tag_formulas`, `data_sources`, rollup และไฟล์วิดีโอกับโมเดล นอกจากนี้ `tag_history` ถูกจำกัดที่ `EXPORT_HISTORY_DAYS` = 90 วัน และ 1,000,000 แถว (`config.py:96-97`) เรียงจากใหม่ไปเก่า ซึ่งที่ 100 tag ที่ 1 Hz ได้เพียง 1,000,000 / 100 = 10,000 วินาที (ราว 2.8 ชั่วโมง) ลูกค้าจึงได้ข้อมูลน้อยกว่าที่คิด (estimate)

proposed ใน F20: (1) สร้างรายการตารางของ org จาก `information_schema` เทียบกับ `_EXPORT_QUERIES` แล้วให้เทสต์ล้มถ้ามีตารางที่มี `org_id` แต่ไม่ได้ส่งออกและไม่ได้ประกาศยกเว้น (2) ส่งออก telemetry เป็นไฟล์ CSV แยกรายเดือนแทน limit (3) ใส่ `manifest.json` ใน zip (รายการไฟล์, จำนวนแถว, sha256, เวลา)

## 4. Master data และการเชื่อม ERP

### 4.1 ใครเป็นเจ้าของอะไร

| ข้อมูล | เจ้าของ | ทิศทาง | สถานะปัจจุบัน |
|---|---|---|---|
| สินค้า (รหัส, ชื่อ) | ERP | ERP -> เรา อ่านอย่างเดียว | `machine_products.product` เป็น text อิสระ, exists `0041...sql:35-41` |
| ใบสั่งผลิต (work order) | ERP | ERP -> เรา | ไม่มี; proposed `erp_work_order` |
| work center / เครื่อง | ERP ให้รหัส, เราผูกกับ `devices` | ERP -> เรา แล้ว map | `devices` มี, exists `0001...sql:95` |
| กะ ปฏิทินโรงงาน | เรา (ตามที่ผู้ใช้ตั้ง) | ไม่ซิงก์ในรอบแรก | `shifts`, exists `0039` |
| ยอดผลิต ของเสีย เวลาเดินเครื่อง เวลาหยุด | เรา | เรา -> ERP | คำนวณใน `oee.py` ไม่เก็บถาวร |
| เหตุผลการหยุด (reason code) | เรา เริ่มต้น, ERP ภายหลังได้ | สองทางเมื่อตกลงกัน | `downtime_reasons`, exists `0042` |
| พนักงาน / ผู้ใช้ | Keycloak ของเรา | ไม่ซิงก์ | exists |

### 4.2 ตาราง mapping (proposed, migration 0066)

เหตุผล: ERP มี id ของตัวเอง (เช่นเลข 17 ใน Odoo) เราต้องไม่ใช้ id นั้นเป็น key หลัก และไม่เก็บ id ของเราไว้ใน ERP เป็นหลัก

```sql
-- proposed 0066: การเชื่อมต่อ ERP หนึ่งตัวต่อ org (เริ่มที่หนึ่งก่อน)
CREATE TABLE erp_connections (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      uuid NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  kind        text NOT NULL CHECK (kind IN ('odoo','csv','webhook')),
  name        text NOT NULL,
  config      jsonb NOT NULL DEFAULT '{}',   -- url, db, ฯลฯ (ไม่เก็บ secret)
  secret_enc  bytea,                          -- ใช้ secretbox เดิม
  enabled     boolean NOT NULL DEFAULT true,
  status      text NOT NULL DEFAULT 'new',
  last_ok_at  timestamptz,
  UNIQUE (org_id, id)
);

-- แปลง id ของ ERP <-> id ของเรา
CREATE TABLE erp_id_map (
  org_id        uuid NOT NULL,
  connection_id uuid NOT NULL,
  entity        text NOT NULL CHECK (entity IN
                  ('product','work_order','work_center','reason')),
  external_id   text NOT NULL,                -- id ในระบบ ERP (เก็บเป็น text เสมอ)
  local_id      uuid NOT NULL,                -- id ฝั่งเรา
  external_ver  text,                         -- write_date หรือ hash ล่าสุดที่เห็น
  synced_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, connection_id, entity, external_id),
  UNIQUE      (org_id, connection_id, entity, local_id),
  FOREIGN KEY (org_id, connection_id) REFERENCES erp_connections (org_id, id)
    ON DELETE CASCADE
);

-- ตารางอ้างอิง ERP ฝั่งเรา (read-only จากหน้าจอ)
CREATE TABLE erp_work_order (
  org_id      uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(),
  code        text NOT NULL, product_code text NOT NULL,
  qty_planned numeric, due_at timestamptz,
  status      text NOT NULL,
  device_id   uuid,                           -- map จาก work center
  PRIMARY KEY (org_id, id), UNIQUE (org_id, code)
);
```

ทุกตารางข้างต้นต้องมี RLS แบบเดียวกับ `0036_webhooks.sql` (`ENABLE` + `FORCE` + policy `tenant_isolation`) ใช้กฎ: ถ้า `external_id` หายจาก ERP ให้ติดธง `inactive` ไม่ลบ เพราะ ยอดผลิตเก่ายังอ้างถึง

### 4.3 Outbox (proposed, migration 0066)

ใช้หลักเดียวกับที่มีอยู่แล้ว: เราเคยทำ `command_outbox` (exists `0001...sql:263`) และ webhook ที่มี `webhook_deliveries`, `webhook_cursor` (exists `0036...sql:46-80`) ที่ส่งซ้ำผ่าน job runner (exists `workers.py:59`) จึงขยายของเดิมแทนการสร้างระบบใหม่

```sql
CREATE TABLE integration_outbox (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  org_id          uuid NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  connection_id   uuid,                         -- NULL = ส่งทุก endpoint ที่สมัครไว้
  event_type      text NOT NULL,                -- 'shift_summary.closed', ...
  idempotency_key text NOT NULL,                -- ดู 4.4
  payload         jsonb NOT NULL,
  payload_ver     integer NOT NULL DEFAULT 1,
  status          text NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending','sent','dead')),
  attempts        integer NOT NULL DEFAULT 0,
  next_try_at     timestamptz NOT NULL DEFAULT now(),
  last_code       integer,
  last_error      text CHECK (length(last_error) <= 2000),
  created_at      timestamptz NOT NULL DEFAULT now(),
  sent_at         timestamptz,
  UNIQUE (org_id, connection_id, idempotency_key)   -- กัน enqueue ซ้ำ
);
CREATE INDEX integration_outbox_due ON integration_outbox (next_try_at)
  WHERE status = 'pending';
```

กฎสำคัญ: แถว outbox ต้องถูก INSERT **ใน transaction เดียวกับ** แถวข้อมูลที่ทำให้เกิดเหตุการณ์ (เช่นตอนปิดกะ เขียน `shift_summary` กับ outbox พร้อมกัน) ถ้า commit ไม่สำเร็จจะไม่มีอะไรหลุดออกไป ถ้าสำเร็จแล้วส่งไม่ได้ dispatcher ลองใหม่

### 4.4 Idempotency

| ระดับ | วิธี |
|---|---|
| คีย์ของ event | `uuid5(org_id, event_type + ":" + natural_key + ":" + version)` ตัวอย่าง `shift_summary.closed:<site>:<machine>:2026-11-06:S1:v1` คำนวณซ้ำได้ผลเท่าเดิม จึง enqueue ซ้ำไม่ได้ (UNIQUE ข้างบน) |
| ตอนส่ง | ใส่ header `Idempotency-Key: <key>` และ `X-Vissointan-Delivery: <outbox.id>` ผู้รับใช้คีย์ทิ้งของซ้ำ |
| เมื่อยอดถูกแก้ภายหลัง | ส่ง event ใหม่ที่ `version` + 1 พร้อม `supersedes: <key เดิม>` ห้ามส่งคีย์เดิมด้วยค่าใหม่ |
| ตอนรับขาเข้า | บันทึก `external_ver` ใน `erp_id_map`; ถ้าเท่าเดิมไม่ทำอะไร |

### 4.5 Retry และ dead-letter

| ครั้งที่ | รอก่อนลองใหม่ (proposed) |
|---|---|
| 1 ถึง 5 | 30 วินาที, 2 นาที, 10 นาที, 1 ชั่วโมง, 6 ชั่วโมง (backoff + สุ่มเล็กน้อย) |
| เกิน 8 ครั้ง หรือรหัส 4xx ที่ไม่ใช่ 408/429 | `status='dead'` ไม่ลองเอง |

- รหัส 4xx ส่วนใหญ่ (เช่น 400, 422) แปลว่าข้อมูลหรือ mapping ผิด ลองใหม่ไม่ช่วย
- หน้าจอ "Integration" แสดงรายการ dead พร้อมปุ่ม replay (เปลี่ยนกลับเป็น `pending`) และปุ่มทิ้ง
- เมื่อมี dead เกินเกณฑ์ ให้เพิ่ม insight/แจ้งเตือนแอดมินของ org ผ่านระบบที่มี (exists `alarming/insights.py`)
- เก็บแถว `sent` 30 วัน แล้วลบ (ใส่ใน job ของ F20)

### 4.6 Webhook ขาออก

ของที่มี: `webhook_endpoints` (url ต้อง `https://`, secret ถูก seal, event ได้ 4 ชนิด: `alarm_raised`, `alarm_cleared`, `downtime_classified`, `incident_opened`), exists `0036_webhooks.sql:11-24` proposed: เพิ่ม event `shift_summary.closed`, `hour_summary.closed`, `work_order.progress` ต้องแก้ CHECK ของคอลัมน์ `events` (ขยายเป็น migration ใหม่ใน 0066)

รูปแบบข้อความ (proposed):

```jsonc
POST <endpoint.url>
Headers: Content-Type: application/json
         X-Vissointan-Signature: sha256=<HMAC ของ body ด้วย secret ของ endpoint>
         X-Vissointan-Timestamp: <unix วินาที>      // ผู้รับปฏิเสธถ้าเก่าเกิน 5 นาที
         Idempotency-Key: <outbox.idempotency_key>
{
  "event": "shift_summary.closed",
  "version": 1,
  "org": "<org_id>", "site": "<site_code>",
  "data": {
    "machine": { "local_id": "<device uuid>", "erp_work_center": "WC-03" },
    "work_order": "MO/00123",           // null ถ้าไม่ทราบ
    "shift": { "name": "S1", "from": "2026-11-06T00:00:00Z", "to": "2026-11-06T08:00:00Z",
               "tz": "Asia/Bangkok" },
    "qty_total": 4210, "qty_good": 4150, "qty_scrap": 60,
    "run_s": 25100, "stop_s": 3700,
    "stops": [ { "reason_code": "jam", "seconds": 1800, "count": 3 } ],
    "data_quality": { "coverage_pct": 99.2, "late_samples": 120, "origin": "production" }
  }
}
```

เหตุผลของฟิลด์: `coverage_pct` ให้ ERP รู้ว่ายอดนี้อ้างข้อมูลครบเพียงใด และ `origin` ป้องกันยอดจาก demo หลุดเข้า ERP (ข้อ 6.5)

### 4.7 ยอดที่จะส่ง (proposed, migration 0067)

```sql
CREATE TABLE shift_summary (
  org_id uuid NOT NULL, site_id uuid NOT NULL, device_id uuid NOT NULL,
  shift_name text NOT NULL, shift_date date NOT NULL,  -- วันตามเวลา site
  from_ts timestamptz NOT NULL, to_ts timestamptz NOT NULL,
  version integer NOT NULL DEFAULT 1,
  qty_total numeric, qty_good numeric, qty_scrap numeric,
  run_s integer, stop_s integer, coverage_pct real,
  work_order_id uuid, closed_at timestamptz,
  PRIMARY KEY (org_id, device_id, shift_name, shift_date, version)
);
-- hour_summary รูปแบบเดียวกัน คีย์ด้วยชั่วโมง
```

- คำนวณจาก `oee.py` เดิม (ตรรกะ `_counter_sum` และหน้าต่างกะ, exists `oee.py:242,516`) ไม่เขียนสูตรใหม่
- ปิดกะแล้วรออีก 1 ชั่วโมงให้ข้อมูลมาช้าเข้าก่อน (สัมพันธ์กับ rollup ชั้นลึกรายชั่วโมง) ถ้าหลังจากนั้นยอดเปลี่ยนจึงออก version ใหม่
- ตารางนี้ยังแก้ปัญหาข้อ 3.5: ยอดที่ปิดแล้วคงอยู่หลัง raw ถูกลบ

### 4.8 Connector ขาเข้า: interface (proposed)

หลักของ module ลึก (`codebase-design`): ข้างนอกเห็นเมธอดไม่กี่ตัว ข้างในซ่อนรายละเอียด ERP แต่ละเจ้า

```python
class Connector(Protocol):
    kind: str                                   # 'odoo' | 'csv'
    async def healthcheck(self) -> Health: ...
    async def pull(self, entity: str, cursor: str | None) -> Page: ...
        # Page = {records: [ExtRecord], next_cursor: str | None}
        # ExtRecord = {external_id, version, fields: dict}
    async def push(self, event: OutboxEvent) -> PushResult: ...
        # PushResult = ok | retry(reason) | dead(reason)

# ส่วนกลางที่ไม่รู้จัก ERP ใด ๆ:
async def sync_entity(conn: Connector, entity: str): ...
    # วน pull -> แปลงด้วย mapping -> upsert ตาราง + erp_id_map -> เก็บ cursor
```

กฎ: connector ไม่แตะฐานข้อมูลเอง คืนแต่ข้อมูลดิบให้ `sync_entity` เขียน เพื่อให้ RLS และ audit อยู่ที่เดียว

### 4.9 Connector แรก: Odoo (sketch ยังไม่ได้ตรวจกับ Odoo จริง)

| รายการ | ข้อเสนอ | ข้อควรยืนยัน |
|---|---|---|
| วิธีเรียก | external API ของ Odoo (XML-RPC `execute_kw` หรือ JSON-2 ในรุ่นใหม่) ด้วย API key ของผู้ใช้ Odoo เฉพาะกิจ | รุ่น Odoo ของลูกค้า (ข้อ 8) |
| ดึงสินค้า | `product.product` (default_code, name, write_date) | ฟิลด์จริงตามรุ่น |
| ดึงใบสั่งผลิต | `mrp.production` สถานะ confirmed/progress (name, product_id, product_qty, date_start, state) | มีโมดูล MRP หรือไม่ |
| ดึง work center | `mrp.workcenter` (code, name) แล้วให้ผู้ใช้จับคู่กับ `devices` ในหน้า mapping ครั้งแรก | ลูกค้าตั้ง work center ไว้หรือไม่ |
| cursor | `write_date` ล่าสุดที่เห็น แล้ว pull ด้วย `write_date > cursor` | timezone ของ write_date (ปกติ UTC) |
| ส่งยอดกลับ | เขียนจำนวนที่ผลิตลง work order (`mrp.workorder`) และเวลาหยุดเป็นบันทึกความสูญเสีย (`mrp.workcenter.productivity`) หรือถ้าลูกค้าไม่ให้เขียน ให้ส่งเป็น webhook/CSV แทน | **ต้องถามลูกค้าก่อนว่ายอมให้ระบบภายนอกเขียนลง ERP ไหม** |
| ความถี่ | pull ทุก 15 นาที; push ตาม outbox | |

เริ่มที่ read-only ก่อน (ดึงสินค้า ใบสั่งผลิต work center) แล้วค่อยเปิดการเขียนกลับเมื่อลูกค้าอนุมัติ

### 4.10 CSV fallback

ลูกค้าบางรายไม่มี API จึงต้องมีทางสำรองที่ใช้ได้เสมอ

| ทิศ | วิธี | รูปแบบ |
|---|---|---|
| ขึ้น ERP | ดาวน์โหลดจากหน้า Integration หรือส่งตามเวลาไปยังที่เก็บ (S3) | CSV UTF-8, หนึ่งแถวต่อ (เครื่อง, กะ) คอลัมน์ตรงกับ `shift_summary` พร้อม `idempotency_key` ท้ายแถว |
| ลง | อัปโหลด CSV สินค้า/ใบสั่งผลิต | ใช้รูปแบบเดียวกับ `/sources/{id}/tags:bulk` ที่มีอยู่ (UTF-8, จำกัดขนาด, ตอบ 413/422), exists `CONTRACT.v2.md:98` |
| ตรวจก่อนนำเข้า | ปุ่ม dry-run แสดงแถวที่จะเพิ่ม/แก้/ข้าม/ผิด | |

CSV เข้า `sync_entity` เส้นเดียวกับ Odoo (connector ชนิด `csv` ที่ `pull` อ่านจากไฟล์ที่อัปโหลด) จึงไม่มีโค้ดซ้ำ

### 4.11 กฎเมื่อข้อมูลขัดกัน: ใครชนะ

| ข้อมูล | ผู้ชนะ | ถ้าไม่ตรงกัน |
|---|---|---|
| ชื่อ/รหัสสินค้า | ERP | เขียนทับตัวเรา ผู้ใช้แก้ในเราไม่ได้ (หน้าจอแสดงล็อก) |
| ใบสั่งผลิต: จำนวนแผน, วันครบกำหนด, สถานะ | ERP | เขียนทับ |
| ใบสั่งผลิต: จำนวนที่ทำได้จริง | เรา | ส่งขึ้น ERP ถ้า ERP มีค่าต่างและถูกแก้ด้วยมือ ให้ติดธง conflict ไม่เขียนทับ รอคนตัดสิน |
| เหตุผลการหยุด | เรา (operator เลือก) | ERP ไม่เขียนทับ ถ้าต้องการรหัสของ ERP ใช้ตาราง map `reason` |
| ยอดผลิตที่ปิดกะแล้ว | เรา | แก้ได้เฉพาะออก version ใหม่ ห้ามแก้ version เดิม |
| work center <-> เครื่อง | ผู้ใช้จับคู่ครั้งแรก | ถ้า ERP เปลี่ยนรหัส ให้ map เดิมค้าง เตือน ไม่เดาเอง |
| เวลา | UTC ภายใน | แสดงตาม `sites.timezone`, exists `0001...sql:73-84` |

หลักตัดสิน: ใครเป็นเจ้าของ ฟิลด์นั้นชนะเสมอ ที่เหลือคือ conflict ให้คนเห็น ไม่แก้เงียบ ๆ

## 5. SaaS back office (ของเราเอง ไม่ใช่ ERP ของลูกค้า)

### 5.1 ที่มีแล้ว

| ส่วน | สถานะ | อ้างอิง |
|---|---|---|
| Tenancy (org เป็นราก, `org_id` ทุกตาราง, RLS `FORCE` + `wds_ctx_org()`) | exists | `0001_saas_schema.sql:38-46`, `db/context.py` (`tenant_tx`) |
| บทบาทฐานข้อมูล: `wds_app` (จำกัด), `wds_system` (worker), `wds_owner` (migration) | exists | grant ใน `0001`, `0052` |
| Provisioning org + seed + OIDC | exists | `tenancy/onboarding.py`, `tenancy/orgs.py`, `ops/bootstrap.py`, `ops/provision_idp.py` |
| Platform admin (ผู้ดูแลระบบข้าม org) | exists | `platform_admins`, `0032_plans_platform.sql:89`; `tenancy/platform.py` (suspend `platform.py:234`) |
| Support session (เข้าดูแทนลูกค้าแบบมีบันทึก) | exists | `0034_support_sessions` |
| Feature flag ต่อ org, ประกาศ | exists | `0035_org_ops.sql:12,31` |
| Consent | exists | `0044_consents` |
| MFA policy | exists | `0050_mfa_policy` |
| Audit hash chain ต่อ org | exists | `0001...sql:277-290` |

### 5.2 แพลนและ metering

| รายการ | ค่าจริงในโค้ด | แหล่ง |
|---|---|---|
| แพลน | trial, starter, pro, enterprise | `0032...sql:37-40` |
| เพดาน | sites, edges, tags, users, cameras, vision_models | `plans.py:CAP_KEYS` (ต้นไฟล์) |
| การตรวจเพดาน | `check_limit` คืน HTTP 402 ภายใน tx เดียวกับ INSERT | `plans.py` ฟังก์ชัน `check_limit` |
| override ต่อ org | `organizations.plan_limits` jsonb ทับค่าแพลน | `plans.py` ฟังก์ชัน `caps` |
| retention | trial 7, starter 90, pro 365, enterprise NULL (ใช้ 365 เมื่ออ่านค่า) | `0032...sql:37-40`, `plans.py:features` |
| โควตา GPU | `gpu_hours_monthly` 2/0/20/0 | `0032...sql:37-40`; ตารางใช้งาน `0024_inference_usage` |
| rate limit API | 60/120/600/2400 ต่อนาที | `0032...sql:37-40` |

ช่องว่างของ metering ที่เห็น (ยังไม่ใช่ปัญหาจนกว่าจะเก็บเงินตามการใช้):

| สิ่งที่ควรวัด | มีหรือไม่ | ข้อเสนอ |
|---|---|---|
| จำนวน sample ที่รับต่อ org ต่อวัน | ไม่มีตาราง | proposed `usage_daily(org_id, day, samples, bytes_est, api_calls, gpu_s)` คำนวณจากข้อมูลที่มีใน job ชั่วโมง (F14 เป็นเจ้าของ ingest metric ให้ประสานกัน) |
| พื้นที่ดิสก์ของไฟล์ต่อ org | ไม่มี | นับจากโฟลเดอร์ `VIDEO_DIR`/`MODEL_DIR`/`EXPORT_DIR` ต่อ org |

### 5.3 Billing เป็นงานอนาคต

ไม่ทำในรอบนี้ (ตรงกับ gap-plan: "SMTP และระบบรับชำระเงิน" อยู่ในงานอนาคต) สิ่งที่ควรเตรียมโดยไม่เขียนโค้ดเพิ่ม: เก็บ `usage_daily` ไว้ให้ระบบเก็บเงินในอนาคตอ่าน, ใช้ `plan` กับ `plan_limits` เป็นแหล่งเดียวของสิทธิ์, ไม่เก็บข้อมูลบัตร

### 5.4 Support console

| งาน | สถานะ | ข้อเสนอ |
|---|---|---|
| ดู org ทั้งหมด, ระงับ, กู้ | exists `platform.py:72-78,234` | |
| เข้า org แทนลูกค้าแบบมีบันทึก | exists `0034_support_sessions` | แสดงชัดว่ากำลังอยู่ใน support session ในทุกหน้า |
| ดูสุขภาพการเชื่อม ERP ของลูกค้า | ไม่มี | proposed: แถวสถานะต่อ connection (ok ล่าสุด, จำนวน dead) ในหน้า platform (F14 ทำหน้า platform; F18 ส่งข้อมูล) |
| replay outbox แทนลูกค้า | ไม่มี | proposed: ทำได้เฉพาะใน support session และเขียน audit |

## 6. คุณภาพข้อมูลและ governance

### 6.1 หน่วย (units)

- `tags.unit` เป็น text อิสระ, `0001_saas_schema.sql:126-136` เช่น `Hz`, `m/s`, `m3/h` (`edge-bridge/tags.yaml`)
- ปัญหา: ไม่มีรายการหน่วยมาตรฐาน กราฟที่รวมสองเส้นอาจเทียบกันไม่ได้ (เช่น `m3/h` กับ `m³/h`)
- proposed: ตาราง `units(code, dimension, to_si_factor)` เล็ก ๆ (หรือค่าคงที่ในโค้ด) ใช้ตรวจตอนสร้าง tag; หน่วยที่ไม่รู้จักยังรับได้แต่ติดธง "ไม่ได้ตรวจ" (ใส่ใน F20 หรือเลื่อนก็ได้ เพราะไม่กระทบ ERP)
- ยอดที่ส่งขึ้น ERP ใช้ปริมาณเป็นหน่วย ERP เท่านั้น: เก็บ `uom` ใน mapping ของสินค้า (ชิ้น, กก., ลบ.ม.) และแปลงที่จุดเดียว

### 6.2 การตั้งชื่อ และความไม่ตรงกันของ tag ใน /query, /tags, /trends

ผู้ตรวจพบว่าชื่อ tag ไม่ตรงกันระหว่างสามที่ จากโค้ดเห็นสาเหตุว่าใน tag หนึ่งตัวมีชื่อหลายแบบพร้อมกัน

| ตัวระบุ | รูปแบบ | ที่ใช้ | หลักฐาน |
|---|---|---|---|
| `tags.id` | uuid | key จริงในฐานข้อมูล | `0001...sql:127` |
| `tags.path` | `area/line/device/signal` ตัวพิมพ์เล็ก ขีดล่าง | ฝั่ง edge ส่งใน topic `tele/<path>`; ค้นใน tagquery | CHECK ที่ `0001...sql:132`; `tagquery.py:68-80` รับ uuid หรือ path |
| `tags.name` | text อิสระ | แสดงผล | `0001...sql:133` |
| ชื่อ dotted แบบ v1 | `sort.line1.motor1.running` | CONTRACT.md และ WebSocket เก่า | `edge-bridge/tags.yaml`, `registry.py` `v1_name`, `CONTRACT.md:53` |
| `display_name` | site code + path | broadcast ทาง WebSocket | `ingest.py:43` |

ข้อเสนอ (proposed):

1. **key เดียว**: API ใหม่ทุกตัวอ้างด้วย `tag_id` (uuid) เป็นหลัก `path` เป็นตัวรอง ห้ามใช้ `name`/ชื่อ dotted เป็น key
2. endpoint ใดที่รับ "ชื่อ" ให้ผ่านฟังก์ชันเดียวคือ `_tag_or_404` (exists `tagquery.py:68`) ซึ่งตรวจ uuid ก่อน แล้ว path ซ้ำฟังก์ชันนี้ใน `/query` และ `/trends` (F13 เป็นเจ้าของ `/query` ดูข้อ 7 เรื่องการประสาน)
3. เพิ่มเทสต์ contract: ดึง tag ชุดเดียวกันจาก `/tags`, `/tags/latest`, `/query`, `/trends` แล้ว assert ว่าแต่ละที่คืน `id` เหมือนกันและ `path` เหมือนกัน
4. ระยะยาวเลิกใช้ชื่อ dotted v1 ใน API ใหม่ ยังเก็บไว้เฉพาะ shim

### 6.3 Timezone และ clock skew

| เรื่อง | สถานะ |
|---|---|
| เวลาภายในเป็น UTC (`timestamptz`) | exists ทั้งระบบ |
| timezone ของ site | exists `sites.timezone` default `'UTC'`, `0001...sql:73-84` |
| กะเก็บเป็น `time` ไม่ผูก timezone (`start_time`, `end_time`) | exists `0039_shifts.sql:8-14`; ต้องตีความด้วย `sites.timezone` เสมอ |
| ts ใช้เวลาของ edge | exists `edge_bridge/clock.py`; ถ้าเบี่ยงเกิน 500 ms ตั้ง `clock_ok=false` ในฮาร์ตบีต |
| backend ทิ้ง ts อนาคตเกิน 5 วินาที | exists `main.py:404`, `config.py:216` |
| edge ที่นาฬิกาช้าไปมาก | ไม่ถูกจับ: ts เก่าเกิน 8 ชม. ถูกทิ้ง ส่วนที่เก่าน้อยกว่านั้นถูกเก็บเป็นข้อมูลมาช้า |

proposed:
- ถ้า heartbeat ล่าสุดของ edge บอก `clock_ok=false` ให้ติดธงบนหน้า health และบน `shift_summary.coverage` (ไม่ทิ้งข้อมูล)
- ใน `shift_summary` เก็บ `shift_date` ตามเวลา site และเก็บ `from_ts`/`to_ts` เป็น UTC เสมอ
- ช่วงเปลี่ยน DST ไม่เกี่ยวกับไทย แต่ถ้าลูกค้าอยู่ประเทศที่มี DST ให้เทสต์วันที่ 23 และ 25 ชั่วโมง

### 6.4 Lineage (ข้อมูลมาจากไหน)

| คำถาม | ตอบได้จาก | สถานะ |
|---|---|---|
| sample นี้มาจาก edge ไหน | `tags.edge_id` | exists |
| ค่านี้คำนวณหรือวัดจริง | `tag_formulas` (derived tag) | exists `0053_derived_tags.sql:12` |
| ยอดนี้อ้าง sample ช่วงไหนและครบแค่ไหน | `shift_summary.from_ts/to_ts/coverage_pct` | proposed |
| ใครแก้ config ล่าสุด | `audit_log` | exists |
| ข้อมูลที่ส่งไป ERP ตอนไหน ด้วยคีย์อะไร | `integration_outbox` | proposed |
| ข้อมูลจริงหรือ demo | ดู 6.5 | proposed |

### 6.5 กันข้อมูล demo/mock ปนใน export

ปัจจุบันไม่มีธงบอกว่า site หรือ tag เป็นข้อมูลจำลอง สิ่งที่มีคือ seed สำหรับ demo (`ops/seed.py` ผู้ใช้ `demo-*`, `ops/concrete.py`) และ edge รายงาน `adapter` ในฮาร์ตบีต (เก็บใน `edges.adapter`, อ้างใน `workers.py:289-291`) แต่ไม่มีใครใช้มันกรอง

proposed (migration 0069):

```sql
ALTER TABLE sites ADD COLUMN data_origin text NOT NULL DEFAULT 'production'
  CHECK (data_origin IN ('production','demo','simulated','test'));
```

| กฎ | รายละเอียด |
|---|---|
| ตั้งค่า | seed และ `ops/concrete.py` ตั้ง `demo`; org ที่ edge รายงาน `adapter='sim'` ตั้ง `simulated` อัตโนมัติ (แอดมินแก้ได้) |
| ใส่เฉพาะ site | ไม่ใส่ในตาราง `tag_history` เพราะเป็นตาราง partition ขนาดใหญ่ ใช้ join `tags.site_id` -> `sites.data_origin` แทน |
| outbox | ไม่ enqueue event ของ site ที่ origin ไม่ใช่ `production` เว้นแต่ connection ถูกตั้ง `allow_non_production` (ไว้ทดสอบกับ ERP sandbox) |
| export | ค่าเริ่มต้นไม่รวม site ที่ไม่ใช่ production; manifest ระบุว่ารวมหรือไม่ |
| หน้าจอ | ป้ายสีชัดบน site demo/simulated |
| เทสต์ | enqueue จาก site demo ต้องได้ 0 แถวใน outbox |

## 7. ข้อเสนอแยกฟีเจอร์: F18, F19, F20

รูปแบบตาม `docs/product-gap-plan.md` (ช่อง "เป็นเจ้าของ", "สกิล", "งาน", "เสร็จเมื่อ") ต้องแทรกเป็นรอบใหม่หลัง F14 และ F16 เสร็จ เพราะแตะ `plans.py` (F14 เป็นเจ้าของ) และ `ingest.py` (F14) เลข migration ที่ใช้คือ 0066 ถึง 0069 ตามที่จอง (0056 ถึง 0058 ใช้อยู่โดยฟีเจอร์ที่ทำอยู่; 0059 ถึง 0065 จองไว้ในแผนเดิม)

### F18 ชั้น integration (L)

- **เป็นเจ้าของ:** `backend/app/integration/` (ไฟล์ใหม่: `outbox.py`, `dispatcher.py`, `idmap.py`, `summary.py`, `routes.py`, `csvio.py`, `connector.py`), `backend/tests/integration/`, `web/src/features/integration/`, migration `0066` (connections, id_map, outbox, work order ref) และ `0067` (shift_summary, hour_summary, ขยาย CHECK ของ webhook events)
- **ต้องให้ผู้ประสานงานแก้:** `backend/app/main.py` (mount router, เพิ่ม `_every` ให้ dispatcher และ summary job), `CONTRACT.v2.md` (เพิ่ม endpoint และรูปแบบ webhook), `web/src/app/nav.ts`, `web/src/lib/i18n.ts`
- **สกิล:** `engineering:system-design`, `engineering:architecture` (ADR เรื่อง outbox), `codebase-design`, `test-driven-development`, `engineering:testing-strategy`, `security-review`, `ponytail`
- **งาน**
  - [ ] ADR สั้น ๆ: ทำไมใช้ outbox ใน Postgres ไม่ใช้ broker (ลูกค้า 1 ถึงหลายสิบราย, ไม่ต้องมีระบบเพิ่ม)
  - [ ] migration 0066 และ 0067 พร้อม RLS แบบเดียวกับ `0036_webhooks.sql` และเทสต์ว่า org อื่นอ่านไม่ได้
  - [ ] `shift_summary`/`hour_summary` job: ใช้ตรรกะของ `oee.py` ไม่เขียนสูตรซ้ำ ปิดกะ + รอ 1 ชั่วโมง + ออก version ใหม่เมื่อยอดเปลี่ยน
  - [ ] outbox enqueue ใน tx เดียวกับ summary และ dispatcher ใช้ job runner เดิม (`workers.py:59`) หรือ loop ใหม่ใน `_every`
  - [ ] retry/backoff/dead-letter ตามข้อ 4.5 และหน้าจอ replay
  - [ ] ลายเซ็น HMAC และ timestamp ตามข้อ 4.6 ใช้ `secretbox` เดิม (`datasources/secretbox.py`)
  - [ ] CSV export/import ตามข้อ 4.10 พร้อม dry-run
  - [ ] ตรวจ `data_origin` ก่อน enqueue (ต้องรอ F20 ใส่คอลัมน์ ดูหมายเหตุ)
- **เสร็จเมื่อ:** ปิดกะบนโรงงานจำลองแล้วมีแถวใน outbox หนึ่งแถว ส่งไปยัง webhook ทดสอบสำเร็จ ส่งซ้ำด้วยคีย์เดิมแล้ว ผู้รับเห็นว่าซ้ำ เมื่อผู้รับล่มครบจำนวนครั้งแถวเป็น `dead` และ replay แล้วส่งผ่าน

### F19 Odoo connector (M)

- **เป็นเจ้าของ:** `backend/app/integration/connectors/odoo.py`, `backend/app/integration/connectors/csv_connector.py`, `backend/tests/integration/test_odoo*.py`, `web/src/features/integration/odoo/`, migration `0068` (cursor ต่อ entity, ผลการ sync, staging ของแถวที่ map ไม่ได้)
- **ขึ้นกับ:** F18 เสร็จและ merge แล้ว (ใช้ `Connector` interface และ `sync_entity`)
- **สกิล:** `engineering:system-design`, `codebase-design`, `test-driven-development`, `security-review`, `ponytail`
- **งาน**
  - [ ] ยืนยันรุ่น Odoo และ API กับลูกค้า (ข้อ 8) ก่อนเขียน
  - [ ] เขียน fake Odoo server ในเทสต์ ไม่เรียกของจริงในเทสต์อัตโนมัติ
  - [ ] pull สินค้า, work center, ใบสั่งผลิตตามข้อ 4.9 ด้วย cursor `write_date`
  - [ ] หน้าจอจับคู่ work center กับ `devices` และ staging สำหรับแถวที่ map ไม่ได้
  - [ ] เก็บ credential ผ่าน `secretbox` ห้ามใส่ใน `config` jsonb ห้าม log
  - [ ] เฟสแรกอ่านอย่างเดียว เขียนกลับ Odoo ปิดเป็นค่าเริ่ม เปิดผ่านธงต่อ connection
- **เสร็จเมื่อ:** ต่อกับ Odoo ทดสอบ (หรือ fake) แล้วสินค้าและใบสั่งผลิตขึ้นในระบบ จับคู่เครื่องได้ และ sync รอบสองไม่สร้างแถวซ้ำ

### F20 วงจรชีวิตข้อมูลและ retention (L)

- **เป็นเจ้าของ:** `backend/app/lifecycle/` (ไฟล์ใหม่: `policy.py`, `archive.py`, `export_manifest.py`, `restore_org.py`), `scripts/restore-org.sh`, `backend/tests/lifecycle/`, `web/src/features/lifecycle/` (หน้าตั้งค่า retention/ดู archive), migration `0069` (retention_policy, archive_manifest, `sites.data_origin`, `usage_daily`)
- **ต้องให้ผู้ประสานงานแก้:** `backend/app/main.py` (เพิ่ม job), `backend/app/tenancy/plans.py` (ถ้า F14 ยังถือไฟล์ ให้ F20 เสนอ diff ใน "บันทึกการเชื่อมต่อ" แทนแก้เอง), `backend/app/tenancy/workers.py` (`_EXPORT_QUERIES`, ไฟล์ของ tenancy ไม่มีเจ้าของใน gap-plan จึงให้ประสานงานตัดสิน)
- **สกิล:** `engineering:system-design`, `engineering:architecture`, `engineering:deploy-checklist`, `test-driven-development`, `security-review`, `ponytail`
- **งาน**
  - [ ] ตาราง `retention_policy(data_class, default_days)` และ job ลบ `alarms`, `downtimes`, `vision_events`, `edge_logs`, outbox `sent`, `org_exports` ตามกำหนด (ตอนนี้ไม่มีตัวไหนถูกลบ, ดูข้อ 3.5)
  - [ ] archive ก่อน drop partition: เขียนไฟล์ลง S3 ต่อ org ต่อเดือน, ลงทะเบียน `archive_manifest` พร้อม sha256 และเทสต์ว่าไฟล์อ่านกลับได้ครบก่อนอนุญาตให้ drop
  - [ ] แยก retention ของ raw (Hot) ออกจากแพลน เสนอผ่านนโยบายใหม่ (ต้องรอคำตัดสินข้อ 8)
  - [ ] เทสต์ "ตารางที่มี `org_id` ต้องถูกส่งออกหรือประกาศยกเว้น" ตามข้อ 3.7 และเพิ่มตารางที่ขาด
  - [ ] export telemetry เป็น CSV รายเดือน แทน limit 1,000,000 แถว และใส่ `manifest.json`
  - [ ] `sites.data_origin` + ตั้งค่าจาก seed และ `adapter` + กฎใน export (ข้อ 6.5)
  - [ ] `scripts/restore-org.sh` ตามทางเลือก A (ข้อ 3.6) และซ้อม restore จริงหนึ่งครั้งแล้วบันทึกผล
  - [ ] `usage_daily` สำหรับ metering (ประสานกับ F14 เรื่อง ingest metric)
  - [ ] เทสต์ contract ชื่อ tag ระหว่าง `/tags`, `/query`, `/trends` (ข้อ 6.2) ถ้า F13 ยังไม่แตะ
- **เสร็จเมื่อ:** มีนโยบายลบครบทุก data class พร้อมเทสต์ partition ที่ถูกลบมี archive ที่อ่านกลับได้ zip ส่งออกครบทุกตารางของ org ตาม manifest ซ้อม restore org หนึ่งตัวสำเร็จ และ site demo ไม่อยู่ใน export ค่าเริ่มต้น

### ตารางจุดเสี่ยงชนกัน

| ไฟล์ | ผู้ถือเดิม | ฟีเจอร์ใหม่ที่อยากแตะ | วิธี |
|---|---|---|---|
| `production/ingest.py` | F14 | F20 (ธง q, range check) | ส่งเป็นข้อเสนอผ่านบันทึกการเชื่อมต่อ ไม่แก้เอง |
| `tenancy/plans.py` | F14 | F20 (retention แยก), F18 (usage) | เหมือนกัน |
| `production/oee.py` | ไม่มีใน gap-plan | F18 (ใช้ตรรกะ) | import ฟังก์ชัน ไม่แก้ไฟล์; ถ้าต้องแยกฟังก์ชันให้ขอผู้ประสานงาน |
| `tenancy/workers.py` | ไม่มี | F20 (`_EXPORT_QUERIES`) | ผู้ประสานงานตัดสิน |
| `0036_webhooks.sql` CHECK ของ events | เดิม | F18 | เปลี่ยนด้วย migration 0067 ไม่แก้ไฟล์เก่า |
| `main.py`, `CONTRACT.v2.md` | ผู้ประสานงาน | ทั้งสาม | ตามกติกากลาง |

เลข migration: F18 ใช้ 0066 และ 0067, F19 ใช้ 0068, F20 ใช้ 0069 ลำดับ merge ต้องเป็น F18, F19, F20 และ F20 ต้องใส่ `sites.data_origin` ก่อนที่ F18 จะเปิดการส่งจริง จึงเสนอให้ย้ายเฉพาะคอลัมน์ `data_origin` ไปไว้ใน 0066 ของ F18 ถ้าต้องการให้ F18 ปลอดภัยตั้งแต่ต้น

### ลำดับที่แนะนำ

```text
F14, F16 (เดิม)  ->  F18  ->  F19
                     \->  F20  (ทำขนานกับ F19 ได้ ถ้าไม่ชนไฟล์ส่วนกลาง)
```

## 8. สิ่งที่ผู้ใช้หรือโรงงานต้องตัดสินใจ

| # | คำถาม | ใครตัดสิน | ผลต่อการออกแบบ |
|---|---|---|---|
| 1 | ลูกค้าใช้ ERP ตัวไหนและรุ่นอะไร (Odoo รุ่นใด, มีโมดูล MRP ไหม) | โรงงาน | กำหนดขอบเขต F19 ถ้าไม่ใช่ Odoo ใช้ CSV ก่อน |
| 2 | ลูกค้ายอมให้ระบบเราเขียนลง ERP หรือไม่ หรืออ่านอย่างเดียวแล้วให้ ERP ดึงยอดของเรา | โรงงาน / IT ลูกค้า | เปิดหรือปิดการเขียนกลับในข้อ 4.9 |
| 3 | ยอดผลิตที่ถูกต้องอ้างจากอะไร: ตัวนับ PLC, เซนเซอร์, หรือกล้อง และของเสียวัดอย่างไร | วิศวกรโรงงาน | เป็นที่มาของ `qty_good`/`qty_scrap`; ตอนนี้ใช้ `count_tag_id` กับ `reject_tag_id`, `0041...sql:10-33` |
| 4 | แยก retention ของ raw จากแพลนหรือไม่ และ raw เก็บกี่วัน (เสนอเริ่ม 14) | เจ้าของผลิตภัณฑ์ | ถ้าไม่แยก starter เก็บ ~505 GB ต่อ site ที่ 500 tag (ข้อ 2.3) |
| 5 | ใช้ deadband / report-by-exception ที่ edge เพื่อลดข้อมูลหรือไม่ | เจ้าของผลิตภัณฑ์ + วิศวกร | ลดปริมาณ raw ได้มาก แต่เปลี่ยนความหมายของ "ไม่มีข้อมูล"; edge เป็นโค้ดของ F03/F11 |
| 6 | ปิดกะแล้วรอกี่นาทีก่อนส่งยอด (เสนอ 60) และอนุญาตแก้ยอดย้อนหลังนานเท่าไร | โรงงาน | กำหนด version ของ `shift_summary` |
| 7 | อนุญาตให้ ERP เป็นเจ้าของรหัสเหตุผลการหยุดไหม | โรงงาน | ข้อ 4.11 |
| 8 | Archive เก็บที่ไหนและนานเท่าไร ลูกค้าต้องเข้าถึงเองหรือไม่ | เจ้าของผลิตภัณฑ์ | ขนาด S3 และสัญญา |
| 9 | ต้องการ restore ราย org จริงหรือไม่ หรือพอ restore ทั้งฐาน | เจ้าของผลิตภัณฑ์ | ทางเลือก A หรือ B ในข้อ 3.6 |
| 10 | เก็บเฟรมดิบและ label ของกล้องหรือไม่ ใครเป็นเจ้าของภาพ (ความเป็นส่วนตัวของคนในภาพ) | เจ้าของผลิตภัณฑ์ + ฝ่ายกฎหมาย | ยังไม่พบตารางรองรับ; เกี่ยวกับ `consents` (exists `0044`) |
| 11 | ใช้ชื่อ tag แบบใดเป็นมาตรฐานที่ผู้ใช้เห็น: `path` หรือ `name` | เจ้าของผลิตภัณฑ์ | ข้อ 6.2 (เสนอ id เป็น key, path เป็นชื่ออ้างอิง) |
| 12 | ราคาแพลนจะอิงอะไร: จำนวน tag, จำนวน sample, หรือพื้นที่ | เจ้าของผลิตภัณฑ์ | กำหนดว่าต้อง meter อะไร (ข้อ 5.2) |

## 9. สิ่งที่ยังไม่ได้ตรวจ

- ไม่ได้รันระบบหรือฐานข้อมูล ตัวเลขขนาดเป็น estimate จากการคำนวณ ควรวัดจริงด้วย `pg_total_relation_size` บน stack จำลองหนึ่งวัน
- ไม่ได้อ่านทุกบรรทัดของ `oee.py`, `alarms.py`, `vision/*.py` และ `datasources/*.py` ข้อความเกี่ยวกับสองกลุ่มหลังอ้างเฉพาะบรรทัดที่ระบุ
- ไม่ได้ตรวจ API ของ Odoo จริง ข้อ 4.9 เป็นร่าง
- ไม่ได้เปิดเอกสารคำแนะนำเดิมเป็นไฟล์ ใช้สรุปห้าข้อตามที่ได้รับ
- เลขบรรทัดบางจุดเป็นช่วงโดยประมาณ (มีเครื่องหมาย `~`) ให้ค้นชื่อฟังก์ชันก่อนอ้างอิงในเล่ม thesis
