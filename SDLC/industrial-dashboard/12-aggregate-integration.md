# 12 — Integration กับ Aggregate Repo เดิม

## 1. สิ่งที่มีอยู่ใน repo (observed)

- `README.md` — โปรเจกต์วิจัยแยก aggregate (gravel/sand) ด้วย computer vision
- `yolo26n-seg.pt` — trained segmentation model
- `docs/CVMS Pipeline*.pdf`, `Aggregate segmentation pipeline*.pdf`, `Aggregate analysis system*.pdf`, `Gravel sand measurement*.pdf` — เอกสารวิจัย
- อ้างถึง pipeline Roboflow bronze → cleaned silver → experiments (อาจอยู่ใน notebook/scripts ที่ยังไม่ fetch)

## 2. หลักการ integration

> **Dashboard นี้ไม่ได้แทนที่ pipeline เดิม — มันคือชั้น "operationalize"**
>
> โมเดลที่ train มาแล้ว (`yolo26n-seg.pt`) จะถูกห่อเป็น service ที่ publish
> metric เข้า pipeline เดียวกับ PLC/Factory I/O tags
> → ระบบเดียวรับได้ทั้ง OT data และ CV data

## 3. Vision Service Boundary

```
┌──────────────────────────┐
│  vision-inference        │
│  ┌────────────────────┐  │
│  │ load yolo26n-seg.pt│  │
│  │ infer frame        │  │
│  │ compute metrics    │  │  gravel_ratio, sand_ratio,
│  │ publish TagValue   │──┼─► count, area_dist, conf_mean
│  └────────────────────┘  │
└──────────┬───────────────┘
           │ MQTT
           ▼
      AWS IoT Core ──► backend ──► dashboard
           │
           └─► alarm rule: gravel_ratio < threshold
                └─► S3 snapshot เก็บ frame ที่ trigger
```

### Input sources (vision service รองรับ)

| Source | Config | ใช้ตอน |
|---|---|---|
| Video file | `source: file:///data/sample.mp4` | dev, ไม่มีกล้อง |
| RTSP camera | `source: rtsp://...` | มีกล้องจริง |
| USB camera | `source: usb:0` | local test |
| Image dir | `source: dir:///data/frames` | replay dataset |

## 4. Tag ที่ vision service ผลิต (สม่ำเสมอทุก frame/batch)

| Tag | Unit | Source field |
|---|---|---|
| `plant1.sort.vision.cam1.gravel_ratio` | 0–1 | mask area % |
| `plant1.sort.vision.cam1.sand_ratio` | 0–1 | mask area % |
| `plant1.sort.vision.cam1.object_count` | int | instance count |
| `plant1.sort.vision.cam1.mean_conf` | 0–1 | detection conf |
| `plant1.sort.vision.cam1.fps` | int | inference rate |
| `plant1.sort.vision.cam1.snapshot_url` | string | S3 presigned (เมื่อ alarm) |

ทุกตัวเขียนเป็น `TagValue{src:"vision"}` — เข้า pipeline เดียวกัน: IoT → ingest → Timescale → UI

## 5. จุดที่สองระบบเจอกัน

| เหตุการณ์ | Flow |
|---|---|
| Alarm จาก vision | rule `gravel_ratio < 0.3` → alarm raise → บันทึก snapshot URL → UI แสดงลิงก์ |
| Mimic overlay | camera node บน mimic แสดง live ratio + bounding box ล่าสุด (thumbnail) |
| Combined tag | tag อย่าง `line1.quality_score` อาจ derive จาก vision+sensor — ทำใน backend derived-tag |
| Audit | ทุกครั้งที่ rule trigger → `audit_log` เหมือน command/ack |

## 6. Repo Layout เป้าหมาย (integrate เข้า repo เดิม)

```
webservice/
├── services/
│   ├── edge-bridge/
│   ├── backend/
│   ├── vision-inference/        ← ใหม่ ใช้ yolo26n-seg.pt + inference code เดิม
│   └── (existing notebooks/scripts เดิมอยู่ที่เดิม)
├── apps/
│   └── dashboard/               ← React 18 + Vite SPA (ดู ADR-03)
├── infra/
│   ├── terraform/
│   └── docker-compose.yml
├── yolo26n-seg.pt               ← model เดิม — vision-inference อ่านตรงนี้
├── docs/                        ← เอกสารวิจัยเดิม
└── SDLC/industrial-dashboard/   ← docs ชุดนี้
```

> หมายเหตุ: `yolo26n-seg.pt` ยังอยู่ที่เดิม — `vision-inference` mount/copy เข้า container ตอน build หรือ load จาก S3

## 7. ขั้น Minimal Viable Integration (ทำก่อน ไม่ต้องรอ infra ครบ)

1. เขียน `vision-inference` เป็น script เดี่ยวที่: load model → วนอ่าน video file → publish MQTT `plant1.sort.vision.cam1.*` ไป local mosquitto
2. Backend subscribe + insert + WS push → dashboard แสดง trend
3. เมื่อมีกล้องจริง → เปลี่ยน `source` config เดียว

## 8. สิ่งที่ต้องตัดสินเพิ่ม (ไม่ blocker ตอนนี้)

- Camera จริงที่จะใช้ (RTSP/USB) — ตอนมี hardware
- Threshold ของ `gravel_ratio` alarm — tune ตอนเห็นข้อมูลจริง
- จะ derive `quality_score` รวมหลาย input ไหม — ถ้าใช่เพิ่ม derived-tag engine ใน backend (Sprint 5+)
- Notebook pipeline เดิมจะถูก wrap เป็น service ตรงๆ หรือ refactor เป็น module — ขึ้นกับโครงสร้างโค้ดที่ fetch มาละเอียดกว่า README
