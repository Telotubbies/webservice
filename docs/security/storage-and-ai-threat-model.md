# Threat model: uploads, Garage storage, and the AI truck decision

Scope: everything a user can upload (videos, `.pt`/`.onnx` models, `.glb` plant models), where it is stored (disk + Garage), how it reaches the model server, and how the gravel/sand decision reaches the PLC. Written for the aggregate-AI feature; it complements `docs/adr/` and `tests/ATTACK_PLAN.md`.

## 1. Assets and trust boundaries

| Asset | Why it matters |
|---|---|
| Uploaded videos (CCTV) | May show people and the site layout. |
| Model files | Code-like: a `.pt` is a pickle. Also the plant's IP. |
| Garage credentials | Whoever holds them reads every tenant's files. |
| The decision + PLC tags | A wrong write changes what material is dosed. |
| Per-user separation | Tenant A must never see tenant B; a member must not browse others' uploads. |

Boundaries: browser -> API (Keycloak token, org RBAC) · API -> Postgres (RLS, `wds_app`) · API -> disk/Garage · API -> converter (spool volume only, no network) · edge -> broker (TLS + per-edge credential) · edge -> PLC (gated, audited).

## 2. Threats and controls

Status: **done** (code + test), **by design** (documented trade-off), **open** (recommended, not built).

| # | Threat | Control | Status |
|---|---|---|---|
| 1 | **Cross-tenant read** of a file (guess an id / key) | Object keys are built only from a fixed kind + UUIDs (`core/objstore.key` rejects anything else). A file is read only through a DB row under RLS of its own org. Listings use the caller's org prefix. Non-member gets 404, same as a missing org. Tests: `tests/contract/test_objstore_keys.py`, `tests/security/test_storage_isolation.py`. | done |
| 2 | **Cross-user read inside an org** | The Storage inventory returns only the caller's uploads to members; admins/owners see the org with a per-user rollup. The org's video library and model registry stay shared across members **by product design** (cameras and models are org resources). If per-user privacy of those is required, add a `uploaded_by = current_user OR admin` RLS policy. | done (inventory) / by design (library) |
| 3 | **Malicious `.pt`** (pickle runs code on load) | New first gate `vision/ptscan.py` walks the pickle opcodes (never executes) and refuses any import outside torch/ultralytics/collections/numpy and re-entry points (`eval`, `os.system`, `torch.load`...); rejects non-zip legacy pickles and archives without a pickle. Converter is sandboxed: no network, read-only root, non-root user, all caps dropped, `no-new-privileges`, 3 GB / 256 pids. Tests: `test_ptscan.py` (os.system, eval, GLOBAL and STACK_GLOBAL forms; the real YOLO26 n/s checkpoints pass). Residual: a 0-day in torch/ultralytics deserialization. Prefer asking untrusted users for `.onnx`. | done / residual |
| 4 | **Malicious `.onnx`** | ONNX is protobuf data. Parsed by `inspect.py` in a subprocess with time and memory limits; node/class counts capped; task must match the registry. | done |
| 5 | **Malicious video** (parser bug in the decoder) | Magic-byte sniff (mp4/webm only), 200 MB cap, decoded on the gateway, not in the API process. Residual: decoder CVEs in OpenCV/ffmpeg; keep the edge image patched. | done / residual |
| 6 | **Garage credential theft** | The app key is bucket-scoped (`garage bucket allow`), never the admin token; separate key per purpose (backups vs artifacts); secrets via `*_FILE` in production; dev key lives in git-ignored `.env.garage`. Hardening not built: **one bucket+key per org** so a compromised app still cannot cross tenants. | done / open |
| 7 | **Garage exposed** | Dev binds `127.0.0.1:3900` only. Production: private network + TLS in front of port 3900 (see `deploy/garage/`). | done (dev) / config (prod) |
| 8 | **Mirror failure hides data loss** | Mirror is best-effort and counted/logged; the inventory shows "not in Garage" per file and admins can run "Copy missing". | done |
| 9 | **Tampered copy** | sha256 of every upload is stored; the Storage table shows it. No periodic re-hash job. | open |
| 10 | **Orphans / leftovers** after a delete | Deletes remove the disk file and the Garage object; admins see objects with no DB row in the inventory (never served). | done |
| 11 | **Upload DoS / quota abuse** | Size caps (video 200 MB, model 500 MB), per-user mutation rate limit, plan limits on models/cameras. A per-org byte quota is not enforced. | partly open |
| 12 | **AI writes a wrong value to the PLC** | Decision is per truck visit (presence gate + confidence x area votes), not per frame. Visits shorter than `min_frames` produce **no** write. `uncertain` (margin below threshold) is flagged for human review. PLC output defaults to **dry-run**; real writes go through the edge gate (site control switch, org AI-write switch, offline window, tag range, per-tag rate limit, one write in flight) and a signed audit record. Data tags are written before a delayed trigger pulse so the PLC latches consistent values. | done |
| 13 | **Model drift / wrong site** | Reported accuracy is a seen-scene split; unseen scenes were far lower in the research log. Mitigation: reviewer verdicts on every decision (events page), margin histogram on the dashboard, adjustable thresholds per camera, dry-run first. Not built: automatic drift alarm on review-wrong rate. | by design / open |
| 14 | **Camera tampering / spoofed scene** (tarp, light, lens covered) | Coverage gate and `min_frames` ignore flashes; ROI blacks out everything but the dump area; a dead camera produces no events. PLC logic must treat "no new trigger" as hold last/needs-operator, never as a material. | done / PLC-side |
| 15 | **Credentials in RTSP URLs** | Sealed at rest, shown never; status text strips URLs. | done |
| 16 | **Privacy of CCTV** | Only event thumbnails (<= 48 KB) and metrics are stored besides uploaded clips; ROI can exclude areas where people stand. Retention of clips is manual. | partly open |
| 17 | **Model provenance** | Activation requires a license attestation; sha256 recorded; no auto-update from the internet. | done |
| 18 | **Metrics poisoning** (fake stats from an edge) | `vision/stat` payloads are bounded and clamped; org/edge come from the topic, not the payload; the camera must belong to the edge. | done |

## 3. What changed in this work

- `vision/ptscan.py` + test, wired into the `.pt` upload.
- `core/objstore.py`: org-prefixed keys, write-through mirror of videos, models (`.onnx`, source `.pt`), delete, per-org listing.
- `artifacts.py`: member-scoped inventory, admin per-user rollup, orphans, "copy missing".
- Dev Garage (`docker-compose.garage.yml`, `scripts/garage-dev-init.sh`).
- Material decision settings validated server-side (output tags must exist and be writable), delivered in the edge cfg.

## 4. Open items, in priority order

1. Per-org Garage bucket + key created at org signup (strongest tenant isolation; needs the Garage admin API).
2. Per-org byte quota and a re-hash/verification job for the Garage copies.
3. RLS by uploader for videos/models if members must not see each other's files.
4. Drift alarm from reviewer verdicts; PLC-side interlock reference logic (hold on missing trigger, operator confirm on `uncertain`).
5. Plant-model (`.glb`) storage into the same artifact bucket, so the inventory shows its Garage state too.
