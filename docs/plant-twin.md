# Plant twin: upload a .glb, map it, drive it

A site can upload its own plant model (`.glb`). The operator clicks
equipment in the model, says what it is and which tags drive it. The same
mapping feeds three views: 3D, a 2D plan and a front elevation, all with live
signals and the normal guarded controls.

## Flow

1. **Upload** (admin/owner): `POST /api/v1/orgs/{org}/sites/{site}/plant-models`
   raw body. The server reads only the glTF header + JSON chunk: it refuses
   wrong magic/version, external URIs, >60 000 nodes, >64 MB. The first upload
   of a site becomes the active model.
2. **Map**: `/line3d/map` (admin). Click the model to select a node, "Select
   parent" climbs the hierarchy, "Add part from selection" creates a part:
   a name, a *kind* and one tag per *role* (below). `PUT .../parts` replaces
   the whole mapping and validates every binding.
3. **View**: `/line3d` loads the active model and its parts. Tabs: 3D, Plan
   (top), Front. With no active model the bundled Centrale a Beton demo is
   shown (`web/src/lib/plantModel.ts` `DEMO_PARTS`); "Save the demo plant as
   my model" in the editor uploads it and stores that mapping.

Nodes are referenced by **glTF node index**, which is stable for a given file.
Re-exporting a model changes indices, so a re-upload needs re-mapping (the
editor flags parts that point outside the file).

## Kinds and roles

Served by `GET /api/v1/plant-kinds` (source: `backend/app/plant/kinds.py`).

| Kind | Behaviour in the twin | Roles (writable = control) |
|---|---|---|
| motor | fan spins while `run` | run (w), speed (w), fault, temp |
| conveyor | lumps travel along the long axis while `run` | run (w), speed, temp, fault |
| vessel | side gauge from `level`; amber when `low` | level, weight, high, low |
| valve | lamp lit while `open` | open (w), position |
| pump | fan spins while `run` | run (w), flow, pressure, fault |
| mixer | fan spins while `run` | run (w), current, door (w) |
| indicator | lamp from `state` | state, value |

A role accepts one tag of its type (bool/number). Writable roles accept only
writable tags. **A mapping never writes.** The faceplate offers Start/Stop and
setpoint through the existing command path (role, edge-up and clock gates,
confirm on stop, per-tag rate limit, audit).

## Storage

`app/plant/storage.py` is the only module that knows the layout.

- Default: local volume `plant-data` mounted at `/data/plant`.
- Garage / any S3 API: set `PLANT_S3_ENDPOINT` (+ `PLANT_S3_BUCKET`,
  `PLANT_S3_REGION`, secret files `plant_s3_key_id` / `plant_s3_secret`).
  Objects are `plant-models/{org}/{model}.glb`; nothing stays on local disk.
  `deploy/garage/init.sh` creates the bucket `wds-plant-models` and a key that
  can touch only that bucket (the backup key cannot reach it, and vice versa).

Downloads go through the API (`.../plant-models/{id}/file`), so org isolation
(RLS) and RBAC apply; the browser never gets a bucket URL.

## Preparing a model

Browsers choke on raw CAD exports (the sample was 30 MB, 4.7 M vertices).
Pipeline used for the bundled plant (`web/public/models/centrale-beton.glb`):

```
CentraleBeton.skp  --openskp-->  instanced .glb (30 MB)
  --gltf-transform: dedup, weld, simplify 50 %, WebP textures <=1024,
    quantize, meshopt-->  6.9 MB
```

- `.skp` is read with [openskp](https://pypi.org/project/openskp/) (open
  source, no SketchUp needed; tested on SketchUp 26.1 files).
- The viewer decodes meshopt (`KHR_meshopt_compression`); textures must be
  embedded (no external URIs).
- Node names from CAD are often meaningless (`n323`); that is why mapping is
  by click, not by name.

## Equipment catalogue (concrete batching plant)

No public tag database exists for batching plants (searched: SCADA projects
FUXA, PyScada, json-scada ship no concrete-plant tag sets). The list below is
built from what a plant of this layout physically has, cross-checked against
the digital outputs a batch controller exposes (aggregate gates, cement
vibrators, conveyor run, dust collector, water and admixture valves, horn;
see the Rice Lake concrete-batcher I/O questionnaire) and against the
SketchUp model's own parts (4 aggregate bins, aggregate belt, 4 cement silos
with screws, weigh hopper, liquid weigh tank, Roots blower, admixture pump,
mixer).

These are **simulated tags** (`edge-bridge/tags.yaml`, area `batch`) with
sim dynamics in `edge_bridge/adapters/batching_sim.py`: a repeating 60 s batch
cycle when `batch/plant/auto/enabled` is on, manual hold when it is off.
Real PLC addresses replace the sim entries in the `modbus:` / `s7:` map
without touching the model or the mapping, because mapping is by tag path.

| Area | Equipment | Tags (`batch/...`) |
|---|---|---|
| plant | auto sequencer | `plant/auto/enabled` (w), `plant/auto/cycle_count`, `plant/auto/stage` |
| agg | aggregate bin 1-4 | `agg/binN/level_pct`, `agg/binN/gate_open` (w) |
| agg | aggregate belt | `agg/belt1/running` (w), `agg/belt1/speed_mps` |
| agg | aggregate weigher | `agg/weigh1/weight_kg` |
| cem | cement silo 1-4 | `cem/siloN/level_pct`, `high_level`, `low_level` |
| cem | silo screw 1-4 | `cem/screwN/running` (w) |
| cem | cement weigher | `cem/weigh1/weight_kg` |
| liq | water | `liq/water1/open` (w), `liq/pump1/running` (w), `liq/pump1/flow_lpm` |
| liq | admixture | `liq/admix1/running` (w), `liq/admix1/flow_lpm` |
| liq | liquid weigher | `liq/weigh1/weight_kg` |
| air | Roots blower | `air/blower1/running` (w), `air/blower1/pressure_bar` |
| mix | mixer | `mix/mixer1/running` (w), `mix/mixer1/current_a`, `mix/mixer1/door_open` (w) |

42 tags. Not modelled yet (add when the PLC list exists): vibrators, dust
collector, horn, e-stop, moisture probe, silo aeration, skip hoist, truck
discharge.

In dev, `make migrate` + a backend restart seeds the tags and the
`Batching plant (sim)` data source, then bumps the edge cfg so the edge
simulates them.

## Auto-setup, motion and the rest of the app

**Auto-setup** (button in the mapping editor) reads the model and proposes parts:

1. names kept from SketchUp (`Skip`, `MALAXEUR75E`, `Silo2`, `Roots3`, `VideFuts`...
   the converter stores them as node extras `skp`) and layer names;
2. pipe fittings grouped by diameter (`DN100`, `DN125`...) into one flow part each;
3. shape (tall cylinder = silo/tank, long low box = belt, big open box = bin) for
   anything still unnamed. A group that contains named equipment is treated as a
   container, not a part.

Each proposal shows a `high`/`med` confidence and can be unticked. On **Apply**:
roles are bound to the site's existing tags when the part name and number match
(a number or role word alone is not enough); roles that stay empty get simulated
tags `auto/<part>/<signal>` created in the site's "Auto plant (sim)" source
(`POST .../plant-sim-tags`). They are normal tags: replace them with real PLC
tags from the data-sources page when available. Nothing is saved until
**Save mapping**.

**Motion** is per kind and edited under "Motion" on each part: rotation axis and
rpm (mixer, pump, motor), travel direction, distance and period (skip hoist),
fluid colour (pipe flow dots), fill (bins). *Preview motion* runs every part as if
its signals were on, so the mapping can be checked without the plant running.

**Looking inside:** X-ray (whole scene), Isolate/Show all, Zoom to part, on both
the editor and the twin page; the mixer shows concrete in the drum while it runs.

**Central equipment picker:** the parts of the active model are the site's
equipment list (`web/src/lib/equipment.ts`). The picker (`EquipmentPicker`) filters
Tags, Alarms and Commands to that equipment's signals, sets the series on Trends,
and the choice is remembered across pages. The Line view's drawing is the model's
plan (rendered off-screen once, cached) with the same live hotspots and gated
faceplate as the twin.

Not done: alarm rules and Modbus/OPC addresses for the generated simulated tags.

## Safety notes

- Upload is untrusted input: header/JSON-only inspection, no external URIs,
  size and node caps, tenant-namespaced keys, audit rows on upload / map /
  activate / delete.
- Mapping and commands are separate. Removing a binding never stops a PLC;
  binding a writable role to a tag does not bypass interlocks (`tags.requires`)
  or the command gates.
- A tag deleted after mapping leaves a dangling binding; the editor shows it
  with a warning and the twin shows `—`.
