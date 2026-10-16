# M1-05 Edge model server, placement, distribution, test panel — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (inline) or superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** A camera with a pinned model runs YOLO26 on the plant gateway: the gateway fetches the exact model version, runs it on every sampled frame, draws only the enabled classes, shows engine and speed in the console, and an admin can test a model on an image before pinning it.

**Architecture:** A `model-server` container (ONNX Runtime, HTTP contract of roadmap 9.10) sits next to `edge-bridge` on the gateway's private network. `edge-bridge` pushes each camera's pinned version to it (`PUT /v1/models/{id}` with the capability URL from `cfg`), calls `POST /v1/infer` per sampled frame, filters by the camera's `class_config`, draws the overlay, and reports engine, latency and capabilities to the backend. The test panel is a one-shot op through the existing `cmd` ops channel.

**Tech Stack:** onnxruntime (CPU image, CUDA/OpenVINO build args), FastAPI, numpy, opencv-headless, paho-mqtt; React.

**Spec:** roadmap §13 (9.2, 9.5 edge only, 9.10, 9.11 `edge_capabilities`); cloud placement, failover and metering are M2.

## Global Constraints

- Model-server contract exactly as roadmap 9.10: `GET /v1/health`, `PUT /v1/models/{version_id}`, `DELETE /v1/models/{version_id}`, `POST /v1/infer?model=&classes=&conf=` (body `image/jpeg`), `POST /v1/benchmark?model=&frames=`.
- Infer output is untrusted: cap 300 detections, string length 80, scores clamped to 0..1, boxes clamped to 0..1, polygons simplified to at most 64 points. Same discipline as `backend/app/inference.py::_clean`.
- Execution provider order: TensorRT, CUDA, OpenVINO, CPU (only providers that load are used; the chosen one is reported as `engine`).
- The server keeps the last two versions on disk (rollback) and verifies `sha256` of every download. It runs with no inbound exposure beyond the compose network.
- A model download uses only the `cfg` capability URL; the model-server never talks to the backend otherwise.
- With the internet down a cached model keeps running; PUT of an already-cached sha256 needs no network.
- The edge ACL gains only publish on `vision/caps`.
- Detections never leave the gateway as frames of classes that are disabled: filtering happens before drawing, counting and (plan M1-06) rules.

## Review Focus

1. Model-server dies or a model fails to load → the camera shows `error` with the reason and keeps publishing raw frames; other cameras and telemetry are unaffected. *(Task 3)*
2. A hostile or broken model output (NaN scores, 10 000 boxes, huge strings, polygons with 1e6 points) is clamped, not forwarded. *(Task 1)*
3. Download with a wrong sha256 or a truncated body is rejected and the previous version keeps running. *(Task 1)*
4. Class disabled in the console → absent from the overlay after one config cycle; min score change applies without restarting the stream process. *(Task 3)*
5. Image test: a non-image body, a 20 MB body, and a version that is not on the gateway each return a clear error, not a hang. *(Task 4)*

---

### Task 1: Model server (pure post-processing + HTTP app)

**Files:**
- Create: `model-server/Dockerfile`, `model-server/requirements.txt`, `model-server/server/__init__.py`, `postprocess.py`, `runtime.py`, `app.py`
- Test: `tests/contract/test_model_server.py` (pure functions + the FastAPI app via `TestClient`, with a fake runtime session)

**Interfaces — Produces:**
- `letterbox(img_bgr, imgsz) -> (tensor NCHW float32 0..1, scale, pad_x, pad_y)` (pad value 114).
- `decode_detect(out: ndarray[1,N,6], scale, pad, orig_wh, imgsz, classes, class_filter, conf) -> list[dict]` — YOLO26 end-to-end rows `x1,y1,x2,y2,score,cls`; returns `{class_id, class, score, bbox:[x,y,w,h] (0..1)}` clamped and capped at 300.
- `decode_segment(out, proto, …) -> list[dict]` adds `polygon` (≤ 64 points, normalized) from the mask of each kept box.
- `clean(dets) -> list[dict]` the untrusted-output guard used by both.
- `class Runtime`: `providers() -> list[str]`, `load(version_id, path, meta)`, `unload`, `infer(version_id, jpeg, class_filter, conf) -> (dets, ms)`, `benchmark(version_id, frames) -> {fps, ms_p50, ms_p95, provider}`; sessions created with the best available provider.
- `app = create_app(runtime, store)` implementing the five routes; `PUT` body `{url, sha256, task, imgsz, classes[]}` → 202 then `loaded|failed` visible in `GET /v1/health` `loaded[]` / `failed{}`; `store` downloads with sha check into `MODEL_DIR/{sha}.onnx`, keeps the two newest.

- [ ] Step 1: tests — `test_letterbox_shape_and_pad`, `test_decode_detect_maps_boxes_to_original_frame`, `test_decode_filters_class_and_conf`, `test_clean_clamps_nan_huge_and_long_strings`, `test_decode_segment_polygon_capped_at_64_points`, `test_put_wrong_sha_rejected_keeps_previous`, `test_infer_unknown_model_404`, `test_infer_rejects_non_jpeg_and_oversize`, `test_store_keeps_last_two`.
- [ ] Step 2–4: FAIL → implement → PASS.
- [ ] Step 5: commit `feat(model-server): ONNX Runtime server for YOLO26`.

### Task 2: Real-model proof of the server (no mocks)

**Files:**
- Create: `tests/e2e/model_server_real.py`
- The sandbox-converted `yolo26n.onnx` (from M1-04) and a sample image (`bus.jpg`, downloaded by the script into the scratch dir, never committed).

- [ ] Step 1: write the script: start `model-server` (image built in Task 1) with a mounted model folder, `PUT` the model through a local file URL server, `POST /v1/infer` on `bus.jpg`, assert `person` and `bus` are among the detections with score ≥ 0.4, `POST /v1/benchmark` returns fps > 0.
- [ ] Step 2: run it; record real numbers (provider, p50 latency) in the commit message. If the image cannot be built or the sample image cannot be fetched, say so in the report and leave the step red.
- [ ] Step 3: commit `test(e2e): YOLO26n through the model server on a real image`.

### Task 3: Edge integration — distribution, detector, overlay, health

**Files:**
- Create: `edge-bridge/edge_bridge/vision/modelclient.py`, `edge-bridge/edge_bridge/vision/overlay.py`
- Modify: `edge-bridge/edge_bridge/vision/detector.py` (`ModelDetector`), `edge-bridge/edge_bridge/vision/runner.py` (build the detector per camera from `cam["model"]`; draw overlay; report `engine`, `latency_ms`, `model_version`, `model_state` in the stat; raw frames when the model is not ready), `edge-bridge/edge_bridge/config.py` (`MODEL_SERVER_URL`, default `http://model-server:9000`), `docker-compose.yml` (`model-server` service + `edge-models` volume; `edge-bridge` gets `MODEL_SERVER_URL`)
- Test: `tests/contract/test_edge_model.py`

**Interfaces — Produces:**
- `ModelClient(base_url).ensure(model_block) -> "loaded"|"loading"|"failed:<reason>"` (idempotent `PUT`, polls `/v1/health`), `.infer(version_id, jpeg, class_ids, conf) -> (dets, ms)`, `.benchmark(version_id) -> dict`.
- `class_filter(class_config) -> (enabled_ids, per_class_min_score)`; `ModelDetector.detect(frame) -> list[dict]` calls infer with the enabled ids and the lowest enabled min score, then applies each class's own `min_score`.
- `draw_overlay(frame, dets, class_config, lang) -> frame` (box or mask polygon + label; colour from `class_config`).
- Runner: a detector error never raises into the camera loop — the frame goes out raw and the stat says `model_state: error`, `detail`.
- A changed `class_config` changes the camera hash so the thread restarts; `ensure` is skipped when the same `version_id` is already loaded.

- [ ] Step 1: tests (fake model server via `http.server` thread) — `test_ensure_puts_once_per_version`, `test_failed_load_reports_error_and_frames_stay_raw`, `test_filter_uses_enabled_ids_and_per_class_score`, `test_disabled_class_absent_from_overlay`, `test_server_down_does_not_stop_frames`, `test_overlay_draws_box_and_polygon`.
- [ ] Step 2–4: FAIL → implement → PASS.
- [ ] Step 5: commit `feat(edge): run the pinned model per camera on the gateway`.

### Task 4: Capabilities, speed in the console, and the image test op

**Files:**
- Create: `backend/migrations/versions/0020_edge_capabilities.{sql,py}`
- Modify: `edge-bridge/edge_bridge/vision/runner.py` (send `vision/caps` at start and every 5 min: cores, RAM MB, providers, device, loaded versions), `edge-bridge/edge_bridge/ops.py` (`model_test`), `backend/app/dynsec.py` (edge ACL + backend subscription for `vision/caps`), `backend/app/vision/stream.py` (`handle_caps`), `backend/app/vision/models.py` (`POST …/versions/{v}/test`), `backend/app/vision/relay.py` (`parse_stat` keeps `engine`, `latency_ms`), `backend/app/vision/cameras.py` (`camera_json` adds `engine`, `latency_ms` from the last stat held in memory)
- Test: `tests/tenancy/test_edge_capabilities_rls.py`, `tests/contract/test_relay.py` (extend), `tests/integration/test_model_test_op.py`

**Interfaces — Produces:**
- `edge_capabilities(org_id, edge_id PK, reported_at, cpu_cores, ram_mb, device, providers jsonb, loaded jsonb)`; `GET /api/v1/orgs/{org}/edges/{edge}/capabilities`.
- `POST /api/v1/orgs/{org}/vision/models/{model}/versions/{v}/test?edge=<id>` raw body = image (jpeg/png ≤ 5 MB) → `{ms, engine, detections: [... all ≥ 0.05, unfiltered]}`; 409 `edge_offline`, 504 on gateway timeout (10 s), 422 for a non-image. The version must be `draft` or `active`.
- Deploy estimate: `estimate_fps(model_size_class, device) -> float` lookup table, labelled "estimate" until the 20-frame benchmark replaces it (benchmark result arrives in stat as `bench_fps`).

- [ ] Step 1: tests — RLS isolation + upsert; `parse_stat` keeps and clamps engine/latency; integration with a fake edge answering the op: `test_model_test_roundtrip`, `test_test_requires_online_edge`, `test_test_rejects_non_image_and_oversize`, `test_viewer_403_nonmember_404`.
- [ ] Step 2–4: FAIL → implement → PASS (rebuild backend).
- [ ] Step 5: commit `feat: edge capabilities, runtime speed, model test op`.

### Task 5: Web — test panel, speed and engine

**Files:**
- Create: `web/src/features/vision/TestPanel.tsx` (drop an image or take the latest frame of a camera, canvas overlay, confidence slider that filters client-side without re-calling, class list with scores, latency), `web/src/features/vision/overlay.ts` + `overlay.test.ts` (filter by threshold, bbox → canvas rect, polygon scaling)
- Modify: `web/src/features/vision/ModelsPage.tsx` (Test button on draft/active versions, gateway picker), `web/src/features/cameras/CameraTile.tsx` (engine and latency chip), `web/src/features/vision/ModelPanel.tsx` (estimate vs measured fps), `web/src/features/vision/i18n.ts`
- Test: `bun test`, `npx tsc -b`, Playwright `tests/e2e/model_test_ui.py` using the real `yolo26n` and `bus.jpg` if present, otherwise the tiny ONNX (and then the assertions are limited to the request path).

- [ ] Step 1–4: unit tests, implement, tsc, browser walk-through.
- [ ] Step 5: commit `feat(web): model test panel and runtime speed`.

### Task 6: Docs and gate

**Files:** `CONTRACT.v2.md`, `edge-bridge/README.md` (model server, capability topic, offline behaviour), `SDLC/factoryio.md` (vision demo section).
- [ ] Run `make test-contract test-db test-security`; targeted integration; report honestly. Commit `docs: edge inference`.
