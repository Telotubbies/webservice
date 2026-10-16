# Aggregate AI: gravel or sand, decided once per truck

A CCTV camera watches the dump point. A YOLO26-seg model finds gravel and sand masks. The system turns that into **one answer per truck**, shows it live on a dashboard, records it, and (when enabled) writes it to the PLC.

Everything below is configured in the console. Adding a camera, a model, a video or a PLC tag needs no code change.

## Flow

```
camera / uploaded clip
  -> (optional) ROI + CLAHE + gamma + brightness      [edge, before inference only]
  -> model server (ONNX, YOLO26-seg)                  [per-class min score already applied]
  -> presence gate + evidence votes                   [edge/vision/material.py]
  -> decision package (JSON)  ---> vision/event (MQTT) ---> Events + Dashboard
                              ---> PLC tags via the gated rule path (S7 / Modbus / OPC UA / Factory I/O)
```

## Why per truck, not per frame

Segment precision is not the goal; the goal is the right material for the right truck, and **no answer from frames that are not a truck**. So:

1. **Presence gate** (debounce + hysteresis). `k_enter` occupied frames open a visit, `k_leave` empty frames close it. One bad frame can neither start nor split a visit.
2. **Evidence** per frame and class: `sum(score x mask area)` over detections that pass `conf` and `area_min`. Confidence-weighted, so a tiny noisy mask cannot outvote a pile.
3. **Decision** over the visit: `mass_vote` (default) or `frame_majority`.
4. **Confidence**: `margin = |sand_share - 0.5| x 2`. Below `min_margin` the answer is flagged `uncertain` for a person.
5. **Rejection**: a visit shorter than `min_frames` is a flash, not a truck. No event, no PLC write.

This is the event-based, debounced, vote-over-the-visit pattern the original research (`Telotubbies/Aggregate_Project`, `deploy/material_state.py`) argued for; the module here re-implements it on the detections the gateway already has, so thresholds are live settings instead of code.

## Settings (Infrastructure -> Cameras -> Material)

| Setting | Default | Meaning |
|---|---|---|
| `conf` | 0.25 | Detections below this do not vote. |
| `area_min` | 0.005 | Smaller masks (fraction of the ROI/frame) are noise. |
| `coverage_gate` | 0.02 | Material coverage that counts a truck as present. |
| `k_enter` / `k_leave` | 3 / 5 | Frames to open / close a visit. |
| `min_frames` | 15 | Shorter visits are ignored (3 s at 5 fps). |
| `min_margin` | 0.30 | Below this the answer needs review. |
| `max_event_s` | 180 | Longest visit before it is closed and a new one starts. |
| `rule` | `mass_vote` | Or `frame_majority`. |
| class names | gravel / sand | Map the model's class names to the two materials. |
| Preprocess | off | ROI box, CLAHE, gamma, brightness. Applied before the model; the picture you see stays original. |
| `dry_run` | **on** | Decide and log only. Turn off to write to the PLC. |

Per-class minimum score (the model's own filter) stays on the existing "Model and classes" panel. The server validates every range; the form reads them from `GET /api/v1/vision/material-schema`.

## PLC interface

Tags (any writable tag of the site; optional each):

| Output | Content |
|---|---|
| `code` | `gravel_value` / `sand_value` / `none_value` (defaults 1 / 2 / 0). |
| `margin_pct` | 0 to 100. |
| `uncertain` | true when the answer needs review. |
| `trigger` | Pulsed true for `pulse_ms` (default 500 ms), **150 ms after** the data tags, so the PLC can latch them on the rising edge. |

Writes use the same path as any AI rule: site control switch, org AI-write switch, offline write window, tag range check, per-tag rate limit, one write in flight, and a signed audit record. Protocol (S7, Modbus, OPC UA, Factory I/O via Modbus) is whatever the tag's data source uses.

The full JSON package goes to the broker and the Events page (`kind = material`):

```json
{
  "schema": "wds.material.v1", "decision": "gravel", "sand_frac": 0.0, "gravel_w": 41.7, "sand_w": 0.0,
  "margin": 1.0, "uncertain": false, "frames": 279, "coverage_mean": 0.07, "duration_s": 55.8, "rule": "mass_vote",
  "params": {"conf": 0.25, "area_min": 0.005, "coverage_gate": 0.02, "k_enter": 3, "k_leave": 5, "min_margin": 0.3, "min_frames": 15},
  "dry_run": false,
  "outputs": [{"action": "plc_write", "tag_path": "auto/aggregate_dump/code", "value": 1, "result": "submitted"}]
}
```

PLC side, recommended: latch on the trigger rising edge; treat "no new trigger" as *hold / ask operator*, never as a material; require operator confirmation when `uncertain` is set.

## Dashboard

Dashboards -> **Aggregate AI**: live CCTV with masks and the running sand/gravel split, last-truck tile, class mix, KPIs, decision-margin histogram (with the review threshold), recent trucks (with PLC outcome), and the inference health of the model (p50/p95 latency, inferences and detections per minute). The same widgets are in the widget picker for any other board.

## Try it

```
python scripts/seed_material_demo.py --n n.pt --s s.pt --video clip.mp4 [--live]
```

Uploads the YOLO26n-seg (default) and s-seg models, the CCTV clip, creates the "Aggregate CCTV (demo)" camera on the first gateway, pins the model, creates four simulated PLC tags (`auto/aggregate_dump/*`) and turns the decision on in dry-run (`--live` to write). Uploads are mirrored to Garage (see `docs/security/storage-and-ai-threat-model.md`).

## Honest limits

- The research numbers (gravel .94 / sand .86 AP50 for n; .93 / .88 for s) are from a **seen-scene split**. On unseen scenes the same research log reports much lower scores, so new sites need a dry-run period and review of the margin histogram before switching writes on.
- On CPU the n model runs at roughly 110 to 190 ms per frame here; the gateway samples about 5 frames per second.
- The demo clip is a gravel scene: the dashboard shows gravel decisions only. Sand behaviour is covered by unit tests with synthetic detections, not by a real sand clip.
