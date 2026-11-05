# M1-05 edge inference — status checkpoint

Companion to `2026-10-17-m1-05-edge-inference.md`. Mixed state: contract and
UI checks have run and largely pass (see Verification), but the migration is
unapplied, RLS is untested, and no live edge demo exists.

## Done (code)

- **Task 3**: `ModelClient.ensure` performs one post-PUT health read →
  `loaded` / `failed:<reason>` / `loading`; no polling.
- **Task 4**: `edge_capabilities` migration 0020 (fail-closed RLS, not
  applied); `vision/caps` topic + ACLs + ingest (`handle_caps`); capabilities
  GET route; `CameraStat` metadata + 30 s latest-stat relay; `camera_json`
  runtime merge; `model_test` route (5 MiB stream, magic check, server-built
  URL, 10 s request, audited outcome codes only); sanitized
  `vision/results.py`; edge op `model_test` with one ≤9 s monotonic deadline
  across every network call; signalled caps loop (startup/reconnect/300 s);
  benchmark moved to a per-detector daemon thread; broker `max_packet_size`
  8 MiB; draft downloads via existing HMAC.
- **Task 5**: `TestPanel` (gateway picker, camera snapshot, file/drop, canvas
  overlay, confidence filter, abort+sequence guards), VersionRow Test button,
  CameraTile engine/latency + model state line, ModelPanel measured-only FPS,
  api/overlay additions, EN+TH i18n. `tsc --noEmit` clean.
- **Task 6**: CONTRACT.v2, edge-bridge README, factoryio demo notes, this
  checkpoint, SDD ledger — all code-stage.

## Verification observed (this session)

- `pytest -m "not integration"` (tests/): **779 passed, 62 skipped, 1 failed** —
  the failure was `test_migrations_layout` HEAD constant (`0019` → updated to
  `0020`); that file re-ran green (3 passed). Focused Task3–5 contract subset:
  **79 passed**. Tenancy/RLS tests (incl. new `test_edge_capabilities_rls.py`)
  were collected but skipped — no DSNs/DB this session; **RLS unverified**.
- `bun test` (web/): 44 pass / 0 fail, incl. `overlay.test.ts`.
- `bun run build` (tsc -b + vite build): clean; pre-existing chunk-size
  warnings only.
- `tests/e2e/model_test_ui.py` (Playwright async, system Chrome via
  `PW_CHROMIUM`, fully mocked `/api` with event-gated delayed routes):
  **PASS** — canvas overlay (box + polygon), exactly one test POST, slider
  filters without re-request, stale-result guard proven mid-flight for file
  replace and gateway switch, stale snapshot cancelled on camera switch,
  offline-gateway notice, control bounding rects inside viewport at
  1280/768/375 px, Thai labels resolve. Screenshots in `tests/e2e/_shots/` +
  `E:/03_Thesis/evidence/final-gate/`.
- Wave-2 covering subset (after the panel-relayout fix): contract
  `test_migrations_layout + test_relay + test_model_test_route` = 27 passed;
  RLS file collects 5 tests under `-m db`, still skipped without DSNs;
  `bun test` 44/0; `bun run build` clean. Raw logs in
  `E:/03_Thesis/evidence/final-gate/`.
- Impeccable scan of the dev-server root: 11 findings, all pre-existing
  landing-page anti-patterns. The scan covered the landing page only — the
  console pages were not audited by it.

## Not verified / deferred

- Migration 0020 written but not applied; DB untouched.
- No live edge + model-server demo executed; e2e used mocked API responses —
  it is a UI contract check, not proof of real YOLO inference.
- Estimated-FPS display intentionally absent — measurement only until a real
  reference table exists.
- M1-06 (rules/detections → tags/alarms) onwards not started.
- No commit/push/merge requested or performed; tree carries the user's WIP.
