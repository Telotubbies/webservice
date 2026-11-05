# 🐟 MiroFish ×50 Master Audit Report — Senior UX/UI SCADA/HMI & Frontline Worker
**Target Application:** `vissointan — Line console` (`http://localhost:5173/` & `E:\03_Thesis\webservice`)

---

## Executive Synthesis (สรุปภาพรวมจาก 50 Personas)

**Overall HMI / Operator Readiness Score: ~4.7 / 10**

| รอบ (Round) | ขอบเขต (Scope) | คะแนนเฉลี่ย | รายงานรายหน้า (Scores) |
|---|---|---|---|
| **Round 1** | Core HMI & Mimic | **4.3 / 10** | Trends `8/10`, CmdSafety `5/10`, Ergo `5/10`, Line3D `4/10`, Overview `3/10`, Line Mimic `3/10`, Dashboards `3/10`, Alarms HMI `3/10`, Worker Mobile `3/10`, Nav HMI `3/10` |
| **Round 2** | Alarms, Events & Handover | **5.1 / 10** | Vision/Cameras `6/10`, Events SOE `6/10`, Rule Builder `6/10`, Channels `5.5/10`, Incidents `5/10`, Stops vs Downtimes `5/10`, Reports/Notebooks `4/10`, Audit vs Activity `4/10`, Ack Link `3/10` |
| **Round 3** | Historian, OEE & Observability | **4.6 / 10** | SLOs `7/10`, Insights `6/10`, OEE `5/10`, Monitors `5/10`, Synthetics `5/10`, Logs/Traces `4/10`, Health vs Status `4/10`, Error Tracking `4/10`, Tags Browser `4/10`, Metrics/Query `3/10` |
| **Round 4** | Edge Fleet, Vision, Security & Admin | **5.3 / 10** | Edge Fleet `7/10`, Vision Models `6/10`, Vision Rules `6/10`, Admin `6/10`, Netmap `5/10`, OT Security `5/10`, Platform NOC `5/10`, Sign-in HMI `4.8/10`, Settings `3/10`, Shifts `3/10` |
| **Round 5** | Cross-cutting (IA, Thai, Glove, Night, RAMS) | **4.4 / 10** | Alarm Philosophy `7/10`, Thai UX `6.5/10`, Mobile Glove `5.7/10`, Plant Mgr Morning Test `4/10`, Console Slop Audit `4/10 slop`, IA Consultant `3.5/10`, RAMS Data Quality `3.5/10`, Demo Seed `3/10`, Night-shift Wallboard `2/10` |

### สรุปประเด็นสำคัญที่สุด (Key Takeaways)

1. **ความปลอดภัยหน้างาน (Safety Blockers):**
   - ปุ่ม **Start** บน `/line` สั่งเดินเครื่องทันทีโดยไม่มี confirmation dialog
   - ปุ่ม **Stop** ไอคอนพังแสดงเป็นสี่เหลี่ยม tofu `▯`
   - ช่อง **Setpoint** เช็คแค่ `Number.isNaN()` หากกดส่งตอนช่องว่าง `Number("") === 0` จะสั่งเครื่องเป็น **0 Hz เงียบๆ** หรือพิมพ์ `600` Hz ก็ส่งไป PLC ได้
   - ลิงก์ **`/ack/:token`** ยิง `POST` รับทราบอัตโนมัติทันทีที่เปิดหน้า (โดน LINE/chat link preview กดรับทราบแทนคนงานได้โดยไม่ตั้งใจ)
   - ตอนสายหลุด (`Reconnecting`), หน้า `/alarms` ยังโชว์ข้อความใหญ่กลางจอว่า *"No active alarms — nothing needs attention"* และหน้า `/tags` โชว์ค่า `42.5` ที่ค้างมา 87 ชม. ด้วยสีเข้มปกติ
2. **มุมมองคนงานหน้าไลน์ & มือถือใส่ถุงมือ:**
   - `/line` บนมือถือไม่มีแถบบอกสถานะใหญ่ๆ ว่า `RUNNING / STOPPED` และกล่องควบคุมยุบเหลือ `Controls unavailable` โดยไม่บอกสาเหตุ
   - หน้า `/stops` (งานหลักที่คนงานต้องลงสาเหตุเครื่องหยุด) ไม่อยู่ในแถบเมนูด้านล่างบนมือถือ
   - หน้า `/oee` บนมือถือล้นจอแนวนอน (`465px` บนจอ `390px`)
   - คำว่า **Alarm** ในภาษาไทยใช้ปนกัน 3 คำ (`สัญญาณเตือน`, `แจ้งเตือน`, `ปลุก`) และคำว่า **Downtime** ชนกันระหว่างหน้าปิดเสียงเตือน (`/downtimes` = `ช่วงหยุดซ่อมบำรุง`/`ช่วงปิดเตือน`) กับหน้าเครื่องหยุดจริง (`/stops` = `การหยุดเครื่อง`)
3. **ฟีเจอร์ของจริงที่เขียนเสร็จแล้วในโค้ดแต่ไม่ได้ถูกเชื่อมต่อ (Dormant Gems):**
   - **2D SVG Mimic (`LinePage-r4.js`):** มีผัง 2D ของจริงพร้อมแอนิเมชันสายพานและระดับถัง แต่หน้า `/line` กลับเอาโมเดล 3D แพลนต์ปูนที่ชื่อไม่ตรงกับการ์ดมาแสดง
   - **สมุดส่งมอบกะ & ตารางกะ 3 กะไทย (`notebooks/i18n.ts` & `teams/roster.ts`):** มีโค้ดและคำแปลไทยครบแต่ไม่มีไฟล์ไหน import ไปใช้
   - **ค่าสถิติ Insight (`z, mu, sigma`) และเส้นสะสม Pareto (`cum_pct`):** Backend คำนวณและส่งมาใน API แล้ว แต่ UI ไม่นำมาแสดง
4. **AI-Slop & Template Tells:**
   - หน้า Landing (เมื่อยังไม่ล็อกอิน) เป็นโคลนของ **Hex.tech** (`9/10 slop`)
   - ตัว Console ข้างในใช้โครงสร้างเมนูและธีมที่วัดค่ามาจาก **Datadog** (`dd-theme.css`, `nav.bitsAi`, ไอคอน `watchdog`, เมนู `Intelligence`, `APM`, `Digital Experience`)
   - ช่องค้นหาใน `/tags`, `/admin/audit`, `/infrastructure` เขียน placeholder หลอกว่ามี DSL (`eq:motor unit:°C quality:stale`) แต่โค้ดจริงเป็นแค่ `.includes()` ธรรมดา
   - ข้อมูลเทสต์รั่วขึ้นจอ (`pytest-org-b-d1f4011e` เป็น default org ของ demo token, `support@example.com`, `WDS team`)

---

## สารบัญรายงานทั้งหมด (48 ฉบับ)

1. `round1/agent-01-overview.md`
2. `round1/agent-02-linemimic.md`
3. `round1/agent-03-line3d.md`
4. `round1/agent-04-dashhmi.md`
5. `round1/agent-05-alarmhmi.md`
6. `round1/agent-06-worker.md`
7. `round1/agent-07-trends.md`
8. `round1/agent-08-cmdsafety.md`
9. `round1/agent-09-navhmi.md`
10. `round1/agent-10-ergo.md`
11. `round2/agent-02-incidents.md`
12. `round2/agent-03-events.md`
13. `round2/agent-04-ack.md`
14. `round2/agent-05-channels.md`
15. `round2/agent-06-stops.md`
16. `round2/agent-07-reports.md`
17. `round2/agent-08-rulebuilder.md`
18. `round2/agent-09-audit.md`
19. `round2/agent-10-vision.md`
20. `round3/agent-01-oee.md`
21. `round3/agent-02-metrics.md`
22. `round3/agent-03-logs.md`
23. `round3/agent-04-monitors.md`
24. `round3/agent-05-slos.md`
25. `round3/agent-06-synthetics.md`
26. `round3/agent-07-healthstatus.md`
27. `round3/agent-08-errors.md`
28. `round3/agent-09-tags.md`
29. `round3/agent-10-insights.md`
30. `round4/agent-01-fleet.md`
31. `round4/agent-02-netmap.md`
32. `round4/agent-03-models.md`
33. `round4/agent-04-visionrules.md`
34. `round4/agent-05-otsec.md`
35. `round4/agent-06-admin.md`
36. `round4/agent-07-platform.md`
37. `round4/agent-08-signin.md`
38. `round4/agent-09-settings.md`
39. `round4/agent-10-shifts.md`
40. `round5/agent-01-ia.md`
41. `round5/agent-02-thai.md`
42. `round5/agent-03-mobile.md`
43. `round5/agent-04-nightshift.md`
44. `round5/agent-05-alarmphil.md`
45. `round5/agent-06-plantmgr.md`
46. `round5/agent-08-quality.md`
47. `round5/agent-09-slophunt.md`
48. `round5/agent-10-demodata.md`

---

<!-- ====================================================================== -->
## [01/48] File: `round1/agent-01-overview.md`

# Agent: senior-scada-designer — round1

**Evidence:** `s1-overview.png` (1440×900 viewport, `?demo=viewer`), `s1-overview-full.png` (1440×1800 @ 0.5 DSF, full page height). Rendered page confirmed against bundle `index-Criwe5Qj.js` inside `webservice-web-1` (nginx :5173).

## Pages: /

## Score /10 (as HMI)

**3/10.** This is a clean SaaS onboarding page wearing a control-room costume. As a Level-1 operator overview it fails the core test: at 2 seconds I cannot tell whether the line is running, stopped, faulted, or even connected — because the page gives four contradictory answers at once.

## HMI/ISA-101 verdicts

**The <2s test fails.** Header block asserts `Sorting line 1, live`. The header pill flapped between green `Live` (first capture) and amber `Reconnecting` (second capture, ~15 min later) during the same session. Mid-page an orphaned gray pill says `Unknown · No data yet`. The alarms card declares *"The line is running without abnormal conditions."* Four statements, four different truths. An operator standing at the panel cannot reconcile "live + reconnecting + unknown + running fine" — that is worse than showing nothing, because each element individually looks authoritative.

**Hierarchy is inverted.** Of ~1,500 px of content, the first ~600 px is onboarding chrome: a `Getting started · 4 of 6 done` checklist and a `Connect your plant` 4-step commissioning wizard (Modbus registers, `docker run` snippet, `Add device` CTA). The six process readouts — the only ops-critical content on the page — sit below the fold at 900 px viewport height, and below the wizard even at 1080. A control-room landing that scrolls past a `docker run` command box to reach belt speed is not an overview; it's a setup screen that forgot to leave.

**Readouts exist but carry no information.** BELT SPEED `— m/s`, BELT TEMPERATURE `— °C`, BIN LEVEL `— %`, GRAVEL RATIO `— %`, SPEED SETPOINT `— Hz`, LINE STATE `—`. Six parallel em-dashes is six repetitions of one fact (no data). ISA-101 handling: one explicit, colored `DATA SOURCE OFFLINE / STALE` state — not six ambiguous placeholders that an operator will scan tile-by-tile wondering if each is a real zero. `LINE STATE` as a small tile is backwards: line state *is* the page. It should be the dominant status element, not tile #6 with a dash.

**No analog context.** Where values would appear there is no engineering-unit context beyond the unit suffix: no setpoint-vs-actual deviation, no trend arrow/sparkline, no range bar, no quality timestamp. `SPEED SETPOINT` sitting beside `BELT SPEED` with both at `—` means even the "is speed tracking setpoint" question — the most basic deviation check — is unanswerable by design, not just by missing data.

**Alarm summary is mislocated and lying by omission.** `Active alarms (0)` with *"No active alarms — the line is running without abnormal conditions"* is the correct instinct (counted alarm summary) placed mid-page below onboarding, and its reassurance is fabricated: with zero data, alarm count 0 proves nothing. Correct HMI behavior: `Alarm state unknown — no data from gateway`. Meanwhile `Insights (1)` shows `Warning · Anomaly · run · 0.90` in the *adjacent card* — so the page simultaneously claims "no abnormal conditions" and flags a warning anomaly. Direct contradiction, side by side.

**Color discipline: mostly compliant, semantically broken.** Gray/light canvas, restrained palette, color reserved for state — green check marks, amber `Reconnecting`, `Warning` insight. Structurally ISA-101-ish. But color semantics are untrustworthy: green `Live` dot was shown while every value was `—` and "No data yet" was displayed. Green must never mean "UI rendered" — it means "process healthy," and here it asserted health on absent data.

**Mode integrity violation.** `SIMULATED` is a tiny badge inside one tile (GRAVEL RATIO). In demo/sim mode ISA-101 practice is a global mode banner ("TRAINING / SIMULATION MODE") — per-tile tags invite an operator to trust the other five tiles as real. They are all equally fake; only one is labeled.

## AI-slop flags

- **`Sorting line 1, live`** — subtitle asserts liveness the frontend cannot verify; generated confidence.
- **"The line is running without abnormal conditions"** — template reassurance rendered from empty data; the exact class of statement that gets operators hurt.
- **`Anomaly · run · 0.90`** — ML-score decoration: no tag name, no units, no direction, no recommended action. "run" appears to be a category string leaking through.
- **`pytest-org-b-d1f4011e`** in the org switcher, top-right header — test-fixture name shipping in the product chrome.
- **`Live` ↔ `Reconnecting` flapping** — the badge toggles while subtitle stays "live"; state machine leak.
- **Six identical `—` placeholders** instead of one designed empty state — form-filling, not communication.

## What works

- **Readout selection is right:** belt speed, belt temp, bin level, gravel ratio, speed setpoint, line state is exactly the tag set a sorting-line operator wants at a glance.
- **Restrained palette:** no rainbow dashboard-itis; color is at least *attempting* to mean something.
- **`Off shift` pill + wall clock (17:44) top-right** — genuinely control-room-appropriate context.
- **`Active alarms (0)` counted summary** — correct instinct for L1 display, needs data honesty.
- **Commissioning safety footer:** *"Keep tags read-only while commissioning. Writes need the operator role… every write is audited."* — a real operational guardrail, well-stated.
- **`Open line view →`** escape hatch to what is presumably the real mimic — good, but it admits this page isn't the HMI.

## What a คนงาน misreads

1. Sees green `Live` + "line is running without abnormal conditions" → walks away while the gateway is dead.
2. Sees `— m/s` → may read as zero speed (line stopped) or sensor dead — ambiguous.
3. `Anomaly · run · 0.90` → unactionable; is 0.90 bad? On what? Do what?
4. `SIMULATED` on one tile → assumes the other five are real plant data.
5. `Unknown · No data yet` pill looks like a filter chip, not a line-health verdict.

## Top fix

**Rebuild the top band as a Level-1 status header; demote all onboarding.** Single source of truth: one line-state element driven by actual data quality (`RUNNING` / `STOPPED` / `DATA STALE — gateway offline Xs` / `SIMULATION`), the six readouts as large high-contrast values with trend arrows and setpoint deviation, the alarm count, all above the fold at 1080p. Delete the "live" subtitle (state is computed, never asserted). Move `Getting started` + `Connect your plant` into a dismissible side card shown only until first data arrives — in demo mode, collapsed by default. Convert `Anomaly · run · 0.90` into `⚠ Bin level anomaly — sensor BIN_LVL_01, confidence 0.90 → Open trend` or drop it. Global `SIMULATION MODE` banner when data is synthetic.

---

<!-- ====================================================================== -->
## [02/48] File: `round1/agent-02-linemimic.md`

# Agent: mimic-designer — round1

## Pages: /line
Evidence: `C:\Users\Gigabyte\AppData\Local\Temp\shots\s1-line.png` (1440×900, caught backend-drop error state), `s1-line-tall.png` (1440×1600, full page). Code refs: `shots\plantModel.js` (GLB scene + part/tag bindings), `shots\LinePage-r4.js` (dormant 2D SVG schematic).

## Score /10 (as HMI)
**3/10.** It has a grayscale-ish panel and a spatially correct plant layout, but what is on screen is a rendered 3D plant model / site map, not a mimic. An operator cannot read flow, state, level, or alarm from it. It is a showroom artefact in operator clothing.

## HMI/ISA-101 verdicts

1. **Wrong artefact on the screen.** The "Sorting line 1" panel renders `/models/centrale-beton.glb` (concrete batching plant, `plantModel.js` — parts: Skip hoist, Mixer, Weigh hopper, Liquid tanks, Blower, Drum emptiers, Cement silos 1–4, Aggregate bins 1–4). There are **no pipes, no conveyance lines, no flow arrows**. A mimic's job is topology: aggregate → hoist → weigh → mixer; cement silos → weigh hopper → mixer. Here the cement silos sit on the far right reading as *downstream* product storage — the geometry implies the wrong flow direction to anyone scanning left→right.
2. **No run-state grammar.** Mixer, blower, skip hoist, drive motor — nothing on the drawing distinguishes running / stopped / fault. The bindings exist (`plantModel.js`: `batch/mix/mixer1/running`, `current_a`, `door_open`) but never reach the glyph. A mimic that cannot answer "is it turning?" at 3 m is decoration.
3. **ISA-101 color: half-kept, then broken.** The gray base is the right instinct. But indigo/blue is spent on *decoration* — bin shading, the camera lens (`#5e6dd6`), selection stroke (`#006bc2`), level fill tint (`#e8f1fb`). Meanwhile **alarm color never reaches the drawing at all**: every signal is stale and nothing on the mimic is red, amber, or even de-saturated. Color is doing brand work, not semantic work.
4. **Level fills are fake.** Aggregate bins and cement silos show uniform gradient shading — no proportional fill. The code proves the team knows better: `LinePage-r4.js` has a proper clip-path level (`rect y = 130 − s/100×60`, clipped to the bin trapezoid). Right pattern, wrong canvas — that schematic is not what renders.
5. **Stale handling is a whisper.** All six signals read "–" with 8–9 px gray "Stale" badges in the cards; the drawing shows nothing. Per ISA-101, bad/stale quality should transform the *value presentation* (and ideally halftone the affected equipment region), not be a footnote. Worse: in `s1-line.png` the backend was down and the header still showed green **"Live"** — the tall shot later shows amber "Reconnecting," so the pill does eventually catch up, but during the failure window it lied. On a mimic, data quality outranks data.
6. **No flow direction, no tag values on the drawing.** The 2D schematic renders live tag text adjacent to nodes (`j()` — value+unit, opacity 0.4 when stale). On the live page, every value lives in the four cards at top; the drawing carries only name labels. Equipment and its telemetry are in different postal codes.
7. **Equipment→signal binding is broken by naming.** Cards: Drive motor, Conveyor, Vision camera, Gravel bin. `plantModel.js` parts: Skip hoist, Mixer, Weigh hopper, Liquid tank, Blower, Drum emptier, Cement silos, Aggregate bins. **There is no "Conveyor" and no "Vision camera" node on this drawing.** The selected card (blue border + SELECTED chip) highlights nothing because its counterpart isn't depicted. Cross-highlight is architecturally impossible with this card/part mismatch.
8. **Label density / legibility.** Labels ~9–10 px; the center cluster (Drum emptier 1 / Drum emptier 2 / Mixer / Weigh hopper / Liquid tank 1 / Blower / Skip hoist) collides and overlaps the shapes — illegible at panel distance, and there's no hierarchy (tag name vs. tag ID vs. value all same weight).
9. **Layout waste.** Mimic is letterboxed (~660×460 px) inside a ~1260 px panel; the right ~320 px is an empty rail containing a *third* copy of "Select a piece of equipment on the drawing" (subtitle, hint line, rail = 3×). The rail should dock the selected-equipment detail/faceplate — that's what it's for.
10. **"Controls unavailable"** burns a full-width row on a lock icon in viewer mode; collapse it.

## AI-slop flags
- A 3D "digital twin" model substituted for a schematic — demos beautifully, operates badly.
- SELECTED state on a card with no echo on the drawing — affordance theater.
- The same instruction sentence three times because no element actually does the selecting.
- "– · Stale" on every signal under a green "Live" pill — dead data wearing a live badge.
- Card iconography (eye, layers, conveyor glyph) that doesn't correspond to anything drawn.

## What works
- Gray, low-saturation base palette is the correct ISA-101 instinct — don't lose it.
- **The grammar already exists in the codebase**: `LinePage-r4.js` builds a real 2D mimic — motor "M" circle, conveyor with rollers, `mimic-run` dashed belt animation only when running (0.8 s dash-scroll, and it respects `prefers-reduced-motion`), clip-path bin level, live tag text with stale dimming, `role="button"`/ARIA/keyboard on nodes. This file should be the product, not a leftover.
- Amber "Reconnecting" header pill is honest state.
- Card order follows process order (motor → conveyor → camera → bin).

## Top fix
**Redraw the mimic as a 2D schematic and delete the 3D model from this page.** Concrete plan, in order:

1. Extend the `LinePage-r4.js` pattern to the whole flow: Aggregate bins (left, proportional gray level fills + % text) → skip hoist/conveyor (dashed belt animates only when running) → weigh hopper (live weight text) → mixer (rotating-stroke or "M" glyph; running = subtle motion, stopped = static, fault = amber) → cement silos feeding the hopper from *above/right with drawn lines*, liquid tank likewise. Flow reads left→right, lines carry direction arrows.
2. Alarm semantics: red/amber outline+halo on the *equipment glyph* (not just the card); normal = grayscale; selection = thin blue that never fills.
3. Bind cards to node IDs: hovering/selecting a card highlights the glyph and vice-versa; rename cards to match depicted parts (or draw the missing conveyor/camera).
4. Put value+unit+quality next to each equipment glyph; stale = value dims to 40 % (pattern already in `j()`) **and** the glyph halves in contrast; "Live" pill must reflect connection state instantly, not eventually.
5. Reclaim the right rail as the selected-equipment faceplate (trend, setpoint, commands) — one "select equipment" instruction, once.

---

<!-- ====================================================================== -->
## [03/48] File: `round1/agent-03-line3d.md`

# Agent: scada-3d-skeptic — round1

## Pages: /line3d, /line3d/map

Screens captured via CDP (plain `--screenshot` fires on `load`, before the SPA's
`?demo=` token bootstrap resolves — page just sits on a skeleton). Files:
`s1-line3d.png` (viewer, healthy render), `s1-line3dmap.png` (admin),
`s1-line3d-recheck.png`.

**Session caveat:** the live channel died mid-session. First `/line3d` shot showed
green `Live` (17:32); everything after ~17:34 shows orange `Reconnecting`.
Consequences observed:
- `/line3d` still renders the bundled demo plant — graceful degrade, credit due.
- `/line3d/map` hard-fails into a full-page "Could not load data from the backend /
  Try again" state, three attempts in a row. Prior-audit capture `r1-line3dmap.png`
  + dumped `mapeditor.js`/`scene.js`/`useSceneSource.js` were used for the editor
  assessment. Also: a first-visit hit on `/line3d/map?demo=admin` bounced to the
  Alarm rules page once — the demo-token bootstrap races the router on cold load.

## Score /10 (as HMI)

**4/10.** It's honest engineering — real GLB, real three.js, real signal bindings —
but it is an engineering/asset tool sitting in an operator seat. As a "what is
alarming and where" surface it is strictly worse than `/line`, which shows values,
Stale badges, Start/Stop, and a setpoint control on one glanceable flat drawing.

## HMI/ISA-101 verdicts

- **Does 3D add operator value? Marginally — mostly no.** The one thing a twin can
  do better than a mimic is alarm localization ("which of the four identical silos").
  That only pays off if an alarm *drives the camera*. Nothing here auto-zooms,
  auto-isolates, or pins the alarming part — the operator must hunt in a rotatable
  scene. Spatial memory benefit is real but small: this plant is 30 tags; anyone
  learns it off a P&ID in a week.
- **Alarm glow (≈0.22 emissive, prior audit): too quiet — confirmed as a design
  flaw, not a tuning nit.** In a bright room it's below glance threshold; in a dark
  room the light-gray steel + faint glow is still low-salience. No severity
  hierarchy, no banner, no legend anywhere on the page — no ISA-18.2-style
  prioritization visible at all.
- **Color semantics are corrupted by CAD materials.** The aggregate bins and mixer
  roof render bright yellow; piping rings render red. Under ISA-101, saturated
  yellow/red = abnormal. At a glance this screen reads "half the plant in warning,
  red circles on every silo." State color must own the palette; model materials
  must be desaturated to grayscale or the encoding is noise.
- **Bright-scene glare.** Near-white ground plane and gray viewport is a glare bomb
  on the night shift; ISA-101 wants a muted, low-luminance canvas with saturated
  color reserved for abnormal only.
- **Zero process data at rest.** Tagline says "every mapped part shows its live
  signals" — the default view shows CAD, not signals. No values, no labels until
  you click, no Stale/bad-quality indication on parts (the 2D line page at least
  badges stale data honestly).
- **Monitor-only.** No controls on the page — fine for a read-only twin, but then
  it's a poster, not a console. Don't call it an HMI surface.
- **Disorientation risk: moderate.** Free orbit at 3 AM on a tired operator = lost.
  Reset view helps; Plan/Front are fixed orthographic projections derived from the
  same model — the smartest thing on the page, since the "2D mimic" can't drift out
  of sync with the twin. X-ray/Isolate help but add mode state the operator must
  remember to exit.
- **Editor (`/line3d/map`)**: genuine tooling — per-part signal bindings incl.
  WRITABLE points (`auto/mixer/running`, `door_open`), Auto-setup name-matching,
  .glb upload/model switching, Preview motion. That's a commissioning tool and it
  looks competent. It needs a role gate (prior audit: not role-gated), and this
  session showed it dies completely on backend outage — acceptable for an editor,
  but it means the twin pipeline has a single point of failure with no cached
  fallback.

## AI-slop flags

- "Faceplate" is misused — a faceplate is one instrument's control panel; this is
  an equipment chip picker. Naming-by-autocomplete.
- Equipment names like `Drum emptier 1/2`, `Aggregate bin 4` smell like Auto-setup
  name-matching output shipped as operator language — nobody on shift calls it that.
- Tagline overpromises ("every mapped part shows its live signals") vs. what renders.
- Demo-token bootstrap navigates before `me` resolves — cold hit on
  `/line3d/map?demo=admin` landed on Alarm rules once. Sloppy, not broken.
- Credit where due: the "Showing the bundled demo plant" banner is honest. Not slop.

## What works

- Real renderer, real assets, real bindings — not a canned demo video. Plan/Front
  derived 2D views with SVG hotspots are the genuinely good idea here.
- X-ray / Isolate / Zoom-to-part: the correct toolset for finding a tagged
  component in a dense skid.
- Viewer degrades gracefully — demo plant renders while live channel is down.
- Mapping editor is real engineering surface (bindings incl. writable points).

## Top fix

Make alarm→location the page's one job: on active alarm, auto zoom-to-part +
isolate + a persistent severity-colored pin, plus a legend for state encoding.
Then ISA-101 the scene: desaturate model materials, muted dark background, one
reserved alarm color, emissive at glance-visible intensity. Until then the
night-shift คนงาน will — correctly — use `/line`: labels, values, Start/Stop,
setpoint, stale badges, zero mouse gymnastics. The 3D is demo bait today; the fix
list above is what would turn it into an alarm-localization aid worth a monitor.

---

<!-- ====================================================================== -->
## [04/48] File: `round1/agent-04-dashhmi.md`

# Agent: dashboard-hmi-designer — round1

## Pages: /dashboards, /dashboards/line-performance, /dashboards/incident-overview

Evidence: `s1-dash.png`, `s1-dashdetail.png`, `s1-dashinc.png` (1440×900, demo=viewer).

## Score /10 (as HMI)

**3 / 10.** The bones of a real dashboarding system are here — template variables ($line/$equipment), time presets, threshold lines, a Live/Reconnecting indicator — but the execution is desktop-SaaS, not control-room. Put this on a wall at 4 m and an operator learns almost nothing per glance: ~5 panels per viewport, numbers with no limits, alarm widgets in brand-cyan, and "6 signals with no data" rendered as a quiet zero next to "OK".

## HMI/ISA-101 verdicts

**Panel density — fail.** Both detail views show ~5 widgets per 1440×900 viewport. A control-room reference grid (Grafana-class ops wall) carries 12–16. Worse, each "section" (Line health, Alarm activity, Alarm context, Summary) is a full-width colored banner that burns an entire row of wall for three words. On the incident page, the "Incidents" widget spends ~450×280 px to render a checkmark and "No incidents recorded."

**Glanceable design — fail.** Everything is big, so nothing is prioritized. The giant green "0.00 m/s" tile is legible at 4 m, but so is the checkmark and the prose banner. Glanceability isn't font size, it's that abnormal states must pop against a quiet background. Here the loudest elements on screen are two giant cyan slabs announcing a total of ONE alarm each.

**Numbers without limits — fail (the core sin).** An ops number without its limit is meaningless, and almost every widget commits this:
- "Belt speed 0.00 m/s" — no rated speed, no setpoint, no RUNNING/STOPPED state. Is 0 bad? Unknowable. The tile is green and says "No update for 1m ago" — i.e., it's *stale* and still green. Green encodes "healthy" while the data is dead.
- "Alarms by rule / by signal" — counts with no severity, no threshold, no trend. One warning renders as the same cyan as one critical would.
- "Availability SLO: 0 breached / 0 warning / 0 OK / 0 no data" — four zeros. Nothing monitored, card reads neutral.
- The ONE widget that does it right: "Belt temperature (°C)" trend draws CRIT 75.0 and WARN 70.0 dashed lines. That's the grammar every widget needs: value + unit + limit + trend + state color. It just has no data line plotted.

**Color discipline — fail.** Cyan is a brand color, not an alarm color. Per ISA-101-style practice, an alarm-count widget should sit grey/dim at zero and take the severity color (amber/red) only when nonzero. "No data" must be a first-class quality state — conventionally magenta or hatched grey "BAD" — never a plain digit. On the incident wall, 6 of 6 signals report "No data": the plant is blind, and the wallboard whispers it as a hollow-circle "6" beside "OK 0". That is the single most dangerous rendering on these pages.

**Wallboard suitability — fail.** This is a desktop app: left nav rail, search bar, org picker ("pytest-org-b-d1f4011e"), Share button, Invite/Support/Help footer, preset rail where 5 of 7 entries are "0". None of that belongs on a control-room wall. No kiosk/TV mode, no dark high-contrast theme option visible, no auto-rotation of dashboards. Time-transport controls (rewind/pause/ffwd) sit unexplained in the header — replay UI on a live wall is a hazard (operators misread replayed data as live).

**List page — acceptable as a menu, useless as ops surface.** Six rows in a sea of white; a "Templates 8" preset that presumably holds the actual control-room content is buried in the dead rail while "All dashboards" shows only built-ins.

## AI-slop flags

- **Checkmark-as-visualization**: a giant centered ✓ to say "No incidents recorded" — emoji-design instinct, not HMI. Zero incidents should be a small quiet counter, not a celebration.
- **Prose banners**: "Where the plant stands right now: open incidents, availability and signal health." / "Open alarms feeding the incident load — group bars filter with the variables above." Documentation voice on a wallboard; the label "Summary" already said it.
- **Broken copy**: "No update for 1m ago" — two time phrasings spliced together.
- **Confident rendering of dead data**: "Belt temperature distribution" shows max/p99/p95/p90/p75/p50 all 28.0 °C over "3 samples" as a distribution chart. A degenerate single-value histogram presented at full size with no stale flag.
- **Duplicate widgets**: "Alarms by rule" cyan slab appears on both pages; "Alarms by equipment" buckets everything under "Other 1" — group-by that produces one bar is a template nobody checked against real data.
- **Future-dated MODIFIED** (10/14–10/18/2026) on the list page — seed data nobody sanity-checked.
- **Preset rail where 5/7 filters return 0** and a transport-bar nobody will ever explain.
- "Warning · b-hi · 87h ago" — an alarm open for 3.6 days shown as a flat row, no age escalation.

## What works

- **Belt temperature trend with WARN/CRIT limit lines** — the correct widget grammar; clone it everywhere.
- **Connection state in the chrome**: "Live" green / "Reconnecting" amber — a wallboard must admit when it's lying. Keep this.
- **Template variables** ($line, $equipment) and time presets — real dashboard infrastructure, not a mock.
- **Widget count column on the list** and star affordances — fine for a dashboard picker.
- Units in titles ("Belt speed (m/s)", "Belt temperature (°C)") and on axes — at least the unit question is half-answered; now pair it with the limit.

## Top fix

**Re-grade every widget to "value + unit + limit + state", and make NO DATA an alarm, not a zero.** Concretely for a 4 m wallboard:

1. Kill the section banners and all desktop chrome; ship a dark, high-contrast kiosk mode (ISA-101: grey/dark canvas, color reserved for abnormal only).
2. Stat tiles: current value + unit + setpoint/limit + mini-sparkline + state word (RUNNING/STOPPED/STALE). "0.00 m/s · rated 2.5 · STOPPED" fits in the same tile and answers the question the current tile can't.
3. Alarm widgets: grey when zero, severity-colored when nonzero; any "No data" count renders in BAD-quality magenta/hatched, never as a plain digit beside OK. On today's incident page that means "Signal status" goes magenta on the "6", not a quiet list of zeros.
4. Halve the widget heights and drop the one-number-per-card layout; target 12+ panels per viewport. A checkmark is not a panel.
5. Fix stale-data semantics: a tile with "no update" degrades to grey/BAD, it does not stay green — right now the design rewards dead sensors with a healthy color.

---

<!-- ====================================================================== -->
## [05/48] File: `round1/agent-05-alarmhmi.md`

# Agent: alarm-hmi-engineer — round1

## Pages: /alarms, /alarms/quality

Screenshots: `Temp\shots\s1-alarms.png` (1440×900, demo=viewer), `Temp\shots\s1-alarmquality.png`. Code evidence: `Temp\shots\ackAlarm.js` (alarm-list i18n bundle), `Temp\shots\i18n.js` (KPI keys), `Temp\shots\AlarmQualityPage.js`, `Temp\shots\AlarmDetailPage.js`.

## Score /10 (as HMI)

**3/10** — clean, quiet, correctly-ordered list; but as a *flood-handling HMI* it is a dressed-up IT alert queue, not an alarm console. At 50 alarms/min this screen will scroll like a log tail and the operator has no flood-specific tool in front of them.

## HMI/ISA-101 verdicts

**Flood scenario — what the operator actually gets at 50 alarms/min:**

- **Flood mode: ABSENT.** No flood detection, no flood banner, no flood view switch on the list. The word "flood" does not exist in the list-page bundle — the only "flood" hits in `idx.js` are SVG `floodOpacity` attributes. ISA-18.2 §on alarm flood (>10 alarms/10 min) is only implemented *retrospectively* as a Quality-page KPI (`kpiFloods: "Flood windows"`, `kpiRate: "Alarms / 10 min"`, `kpiPeak: "Peak / 10 min"` in `i18n.js`). So the system can tell you *yesterday* that you drowned, but won't tell you *now* while you're drowning. That is the single most damning gap.
- **Rate indicator: half-present.** The "Alarm density" strip (10-min buckets, 4 h — `kpiDensity`) is the right idea but wrong resolution: it is a qualitative grey heatmap with no numeric readout, no threshold line, no "you are at 50/min, ISA-18.2 manageable is ~1/min" reference. In the demo it renders "No alarms in the last 4 hours" — fine, but nothing indicates it ever escalates to a *warning* state.
- **Priority sorting: CORRECT default.** `alx.lede: "Unacknowledged alarms first, then by severity"` — this is the right ISA-18.2 triage order and matches a DCS alarm summary. Credit where due. But during a flood the top row churns 50×/min; there is no freeze/pin, no "first-out" indication, and no evidence rows flash on unacked state the way a DCS banner does.
- **Bulk ack: EXISTS.** `ackSelected: "Acknowledge {{count}}"`, `kbdHint: "Space selects a row · Enter opens it · A acknowledges the selection"`, plus `ackPartial` handling. This is the one real flood survival tool — row multi-select + keyboard ack. Whether "select all" exists is unverifiable from the bundle, but selection-based ack is present.
- **Bulk shelve: ABSENT on this page.** `shelve` appears 18× in `AlarmDetailPage.js` (per-alarm shelving) and in `AlarmSettingsPage`, but not once in the alarm-list bundle. Prior finding stands: no bulk shelve, and shelved alarms can't be excluded from Active. At 50/min, shelving the offending rule/chattering tag is THE ISA-18.2 mitigation — and it's unreachable from the list.
- **Severity color discipline: unverifiable but palette is right.** Demo shows zero rows, so cell-level severity coloring can't be checked (prior finding: boolean columns render blank — suggestive). Page chrome itself follows ISA-101 well: grey/white, color reserved for the amber error banner and red alert dot. No Christmas-tree problem. The column is labeled "Priority" (`ruleSeverity`), which is ISA-18.2-correct terminology.
- **Would a stressed คนงาน pick the right alarm first?** Marginal yes on ordering (top row = oldest? highest-severity unacked), marginal no in practice: to cut a flood they must *type* a DSL (`tag:motor1 sev:critical state:active`) — no severity chips, no one-click "Critical only". Nobody types a filter DSL mid-flood. Thai operator note: TH translations exist (`ไม่มีสัญญาณเตือน...`), good.
- **vs a real DCS banner:** DCS gives a persistent 3–5 line banner on *every* display (newest unacked, priority color, flashing, horn, one-key ack, shelve from faceplate, P1/P2/P3 filter buttons). This app has: a small bell icon, a text line "Nothing waiting for acknowledgement", and a "Live" pill. No banner, no audible indication, no flash, no horn state. The tab badges (Active 0 / Acknowledged 1) are a good start but tiny.

## AI-slop flags

- **Error + empty render together on /alarms/quality** — screenshot shows amber "Could not load alarm history" AND "No alarms recorded yet — Quality metrics appear once rules start firing" simultaneously. Contradictory states: did the fetch fail, or is it empty? Classic generated-UI branch bug: error banner and empty-state both mounted.
- **Subtitle lie potential:** header says "ISA-18.2 alarm-system performance computed from **0 alarm records** on the server" — honest, but rendering a KPI framework over zero data with a load error on top is dead UI.
- **Density strip with no scale:** a 4-hour grid of identical grey cells labeled only "01:25 PM → 05:25 PM" — decorative until it isn't.
- **Filter DSL placeholder as documentation:** `tag:motor1 sev:critical state:active or free text…` is the *entire* discoverability story. No `?` affordance, no chips, no syntax help.
- **Flood KPIs exist but are cosmetic:** `kpiFloods`/`kpiPeak` are computed for a report page while the operational screen ignores the condition — smells like "ISA-18.2 checkbox" rather than flood management.

## What works

- Default ordering is correct: unacked-first, then severity (`alx.lede`).
- Bulk acknowledge with keyboard flow (Space/Enter/A) and partial-failure reporting (`ackPartial`).
- Alarm lifecycle view (`tlTitle: "Alarm lifecycle"`, raised/acked/cleared steps) on detail page.
- `liveLost` banner for connection loss — honest degradation.
- Quality page *intends* real ISA-18.2 KPIs: Alarms/10min, Peak/10min, Flood windows, Standing, Unacked.
- Quiet ISA-101-ish palette; EN+TH strings; role-aware ack (`viewOnly`, `errRole`).

## Top fix

**Put flood handling on the list, not just the report.** When rate >10 alarms/10min (you already compute `kpiRate`/`kpiFloods`): (a) show a flood banner on /alarms with the live rate number and threshold reference; (b) auto-surface "critical-only" + "group by rule" (`groupRule` already exists) and offer one-click **shelve this rule / shelve chattering tag** — the shelve machinery exists in `AlarmDetailPage.js`, expose it as a bulk list action and exclude shelved from Active; (c) freeze top-N critical rows so the priority target doesn't churn. Until then, this screen is an observer of floods, not a tool in one.

---

<!-- ====================================================================== -->
## [06/48] File: `round1/agent-06-worker.md`

# Agent: floor-worker — round1

Persona: คนงานหน้าไลน์ — I stand next to the conveyor with my phone (390px) or a
tablet on the machine. I wear gloves. The hall is loud. I am not the control-room
engineer. I read Thai; the screen gives me English.

## Pages: /line, /stops (mobile+desktop)

Screenshots: `s1-worker-line.png` (390×844), `s1-worker-line-desk.png` (1440×900),
`s1-worker-stops.png` (390×844), `s1-worker-stops-desk.png` (caught a skeleton —
the page shows loading placeholders for a long time; itself a finding).

## Score /10 (as HMI)

**3/10** for my job. It looks clean and modern, but at the machine it fails the
three things I need: tell me running/stopped at a glance, let me trust the
buttons, and put my real work (classifying stops) where my thumb can reach it.

## HMI/ISA-101 verdicts

- **No glanceable line state on mobile.** On my phone I see a list of equipment
  cards with *labels* — "Line state", "Speed setpoint", "Belt speed" — and the
  values are blank/dashes while the feed is "Reconnecting". I cannot tell from
  one look whether the line is running, stopped, or faulted. There is no big
  RUNNING/STOPPED banner, no color field. On desktop the same card says
  "Line state: OFF" — so the data exists; the mobile layout just doesn't surface
  it. ISA-101: state should be the highest-contrast element, not a missing value
  inside a card.
- **Stale-data honesty is inconsistent.** /stops shows a proper yellow banner:
  "Live feed reconnecting. Values on screen are the last ones recei… out of
  date." — good instinct (ISA-101: flag bad/stale data). But (a) the sentence is
  clipped mid-word at 390px, and (b) /line shows only a small orange
  "Reconnecting" pill with no explanation, so on the page where I need it most I
  get no warning that values are stale. Same condition, two different signals.
- **Controls disappear without a reason.** Below ~768px the whole Controls card
  collapses to a lock icon + "Controls unavailable". Unavailable *why*? No
  permission? Wrong screen? Feed down? A greyed-out Start/Stop with a one-line
  reason ("Control only from control room" / "Feed disconnected") would be
  operable; a lock with silence is a dead end. With gloves I will poke it twice
  and walk away.
- **Start/Stop not trustworthy (desktop).** Red Stop button renders a tofu glyph
  `▯` where its icon should be — a broken icon on the safety-relevant button is
  exactly the kind of defect that makes me not trust what the button does. Start
  is a bare blue button — no confirmation, no interlock hint, no "are you sure".
  The setpoint box is free text with a hint "Allowed 0 to 60 Hz · now 45.0 Hz" —
  the hint is good, but nothing visibly stops me typing 600 (prior finding:
  unvalidated).
- **My job is not in the nav.** Mobile bottom tabs are Overview / Alarms /
  Trends. "Stops to classify" — the thing I am actually paid to do at shift end —
  is not there; I must find it in the hamburger. One extra step × gloves × noise
  = it won't get done.
- **Schematic below the fold.** "Sorting line 1" drawing is under the fold on
  mobile and, on desktop, its labels are tiny and overlap ("Drum emptier 1 /
  Drum emptier tank 2 / Mixer / Weigh hopper" collide). "Select a piece of
  equipment on the drawing" is the instruction, but the drawing is the least
  usable part for a gloved finger. The card list above it is the workaround —
  which works — so the CAD drawing is decoration for me.
- **Good: freshness + units.** "Updated 7s ago" on /line, units on every value
  (m/s, °C, %, Hz), plain card names (Conveyor, Gravel bin). Those read well.

## AI-slop flags

- "Needs a reason only" — checkbox label is generated-sounding English for
  "unclassified"; nobody on the floor says this.
- Empty-state copy garbles under clipping: "…it shows classification." (words
  lost at 390px) — text written without checking the container.
- Banner text truncated mid-word ("…last ones recei|") — sentence too long for
  the component; nobody trimmed it.
- Tofu `▯` on the Stop button — icon font never loaded and nobody noticed on the
  one button where the icon matters most.
- Desktop sidebar shows ME — a floor operator — Dashboards, Monitoring,
  *Developer Portal*, Automation, Infrastructure, Security, Intelligence,
  Metrics, Production, Logs, Admin. Role scoping absent; that's admin-console
  sprawl, not an operator screen.
- /stops sat on skeleton placeholders long enough to capture on a fast local
  machine — perceived performance on real Wi-Fi will be worse.
- "Off shift" chip, 9+ bell, Ctrl+K "Search or jump" — noise competing with the
  two facts I need.

## What works

- Reconnecting indicator + stale-data banner on /stops — the app *can* admit its
  data is old; just extend it to /line and fix the clip.
- /stops empty state is plain and calm: "No stops need a reason right now" +
  explanation of when cards appear. When the queue fills, the flow is probably
  fine — title + checkbox + list is a reasonable classify-stops shape.
- Equipment cards are finger-height (~70px); tapping Conveyor/Gravel bin works
  with gloves. Units and decimals consistent (45.0 Hz, 27.9 °C).
- Desktop values are legible and the selected-equipment pattern (blue border)
  is clear — on a wall-mounted panel this reads OK.

## What's in jargon I don't read (Thai-speaking operator)

Everything is English. "Speed setpoint", "Gravel ratio", "Belt temperature",
"threshold", "classification", "Needs a reason only" — I can guess motor words
from the machine, but "Gravel ratio" from a "Vision camera" means nothing to me.
No ไทย toggle visible anywhere. If this is for our plant, half the team will
screenshot-and-ask rather than read it.

## Top fix

**Make the phone screen answer one question first — "ไลน์เดินอยู่ไหม?" — then get
me to my job.** Concretely: (1) pin a full-width state strip on /line mobile
(RUNNING / STOPPED / FAULT, high contrast, ISA-101 gray palette, alarm red only
for real alarms) that shows last-known state + staleness when reconnecting;
(2) add "Stops" to the bottom tab bar — it's my queue, not a menu item;
(3) replace "Controls unavailable" lock with the reason in one line. Until then
this screen tells me less than looking at the machine itself.

---

<!-- ====================================================================== -->
## [07/48] File: `round1/agent-07-trends.md`

# Agent: process-engineer — round1

## Pages: /trends

Evidence: headless screenshots `s1-trends.png` / `s1-trends-tags.png` (chart canvases blank under `--virtual-time-budget` — capture artifact; axes + chrome rendered fine), plus source audit of live chunks `assets/TrendsPage-K3qYWlRB.js` and `assets/useSeries-Bc2Rujau.js` pulled from localhost:5173.

## Score /10 (as HMI)

**8/10** — the only trend view in this product I would not be embarrassed to open during an upset investigation. It thinks like a historian, not like a BI dashboard. Held back from 9 by missing forensic entry points (no from/to datetime pickers, no event markers, no cursor delta) and one real defect (limit lines silently dropped on multi-signal charts).

## HMI/ISA-101 verdicts

- **Per-unit stacking is the correct call.** One chart per engineering unit, "signals with different units are never forced onto one axis" (`viz.perUnit`). That is the PI ProcessBook multi-scale discipline done right — no dual-axis pseudo-correlation. 6-signal cap (`limitCount`) is a sane cognitive limit.
- **Gap honesty is genuinely historian-grade.** `spanGaps:!1`; series are aligned to a common time grid (`Gi`) and a sample is only held forward `max(2500ms, 3× median dt)` — beyond that it becomes a visible `null` gap, not a fake interpolated line. Bad-quality samples are dropped, counted, and surfaced via the "N bad-quality samples hidden (shown as gaps)" banner (`viz.badHidden`). That is the right failure semantics: never fabricate continuity.
- **Decimation preserves extremes.** `Ui` min/max-per-bucket downsampling to 1400 pts — same class of algorithm as PI plot-values: spikes survive compression. An 8h+ window switches to server-side rollups with an explicit "values are N-min averages" banner (`viz.rollupHint`) and a truncation warning (`viz.truncated`) when the row cap hits. Honest about what you're looking at — rare.
- **Alarm limits drawn correctly when drawn at all.** Dashed, severity-colored (▲ critical / ◆ warning / ● info), labeled with value + unit (`Vi` plugin). **But:** limits only render on single-series charts (`n.length===1 ? limits : []`) — put two m/s signals on one chart and the limit lines vanish silently. During an upset you will not notice the missing LO line; you'll just misjudge the excursion. ISA-101 violation by omission.
- **Limit lines poison auto-range** (confirmed in code, `y.range` expands to include every limit `t.v` before padding). A HH alarm at 120 on a signal sitting at 40 flattens the trace into noise floor. Needs "clamp to data ± margin, draw limit if in range" or a manual y-lock.
- **Staleness semantics are right.** Last-value table flags Stale after 15s without update, quality pill shows non-good states, reconnect banner explicitly says "values may be out of date." No pretending.
- **Live tail is poll-hybrid, not streaming.** History refetch every 120s with WS buffer points appended between fetches. Fine for process work; just know the trace is not truly tick-by-tick.
- Drag-zoom→`from`/`to` URL params with "Back to live" chip: correct, shareable, back-button friendly. Cursor tooltip with timestamp + per-series values exists (synced across stacked charts via `syncKey:'trends'`) — prior audit's "no crosshair readout" is outdated; it exists, but it's a hover tooltip only.

## AI-slop flags

- Mostly clean. The anti-slop work is visible: explicit unit discipline, honest gap/rollup/truncation messaging, monospaced numeric columns, muted ISA-ish palette.
- Flag 1: **limits silently absent on multi-series charts** — looks like a convenience branch (`n.length===1`) that nobody justified. Classic "works in demo" pattern.
- Flag 2: **CSV export is thinner than it looks.** Columns are `ts,tag,value,unit` only — no quality flag, no gap marker, and it exports the min/max-decimated `pts`, not raw history. Label "Export CSV" overpromises forensic fidelity; an investigator diffing the CSV against the screen can't tell a gap from a dropped bad sample.
- Flag 3: quality column renders "Good" as plain gray text while non-good gets a styled pill — asymmetry is fine, but the Stats table "Good" vs "Stale" mixing quality and freshness in one column conflates two different diagnoses.

## What works

- Window presets 15m→1y + live window readout; custom window survives in URL and is labeled "Custom window" with a one-click return to live.
- Synced cursor across stacked per-unit charts; hover tooltip shows timestamp + each series value + unit, `—` for gaps.
- Series table: LAST/MIN/MAX/AVG/UNIT/QUALITY over the current window — a real stats readout, mono-aligned.
- Grid mode: compact per-tag cards with their own limit lines — the right shift-handover overview.
- Booleans coerced to 0/1 and trendable — digital state on a trend, the way motor run-backs actually get investigated.
- Truncation + bad-sample + rollup banners: the tool narrates its own data integrity.

## Top fix

1. **Forensic time entry + event markers (tie, do both first):**
   - Arbitrary `from`/`to` datetime-local inputs next to the window presets — the URL params and zoom already exist; the missing piece is a 10-line form. An investigator who knows "the trip was at 03:14" should not have to binary-search with drag-zoom.
   - Vertical event markers on the trend (alarm activation/ack/RTN, operator annotations). During an upset, the question is "what happened 30 s before the HI alarm?" — today there's no way to see the alarm *on* the trend.
2. **Draw limit lines on multi-series charts** (fix the `n.length===1` gate), and stop letting a distant HH/LL limit compress the y-range — clamp range to data, draw the limit line at the edge with an arrow, or add a y-lock.
3. **Pinned cursor + delta readout:** click to pin cursor A, drag to B, show Δt and Δv per series — the single most-used ProcessBook forensic gesture.
4. **CSV forensics:** add `quality` column, emit explicit gap rows or a `good` flag per sample, and offer "export raw" vs "export as displayed." Add a min/max column when bucketed.
5. Minor: split QUALITY column into "Freshness" and "Quality"; consider rate-of-change or σ in the stats row for slow-drifting analogs.

---

<!-- ====================================================================== -->
## [08/48] File: `round1/agent-08-cmdsafety.md`

# Agent: functional-safety-eng — round1

## Pages: /line controls, /commands

Verified visually (s1-cmd.png, s1-cmdlog.png) and in the shipped bundle
(`LinePage-r4.js`, `Confirm-r4.js`, `CommandsPage-r4.js`, `i18n.js`).

## Score /10 (as HMI): 5

Lock-model and journal are near best-in-class; the friction allocation on the
actual write path is inverted and the numeric write is unvalidated. On a
real plant this panel as-shipped hurts someone eventually.

## HMI/ISA-101 verdicts

**Friction is allocated backwards.** Code (LinePage, Controls card):

- Start: `onClick: () => send(running, true)` — zero confirmation, one click,
  energizes the drive. This is the classic unexpected-startup kill mechanism
  (IEC 60204-1 / ISO 13849: restart after a stop must not occur uncommanded
  or unverified). Someone inside the guarded zone clearing a jam eats a
  remote Start from a browser.
- Stop: click → `alertdialog` "Stop the conveyor?" → "The belt stops and
  production on line 1 halts until it is started again." The confirm exists
  to protect *production*, not *people* — and it inserts a modal + mouse
  travel into the function an operator reaches for when something is going
  wrong. An HMI stop is not an E-stop, but adding latency to the safest
  available action while leaving the energizing action instant is exactly
  backwards. Confirm severity should be proportional to consequence:
  Start (energize machinery) ≥ Stop (de-energize) — here it is 0 vs 1.

**Typed/two-person confirm: designed, never wired.** i18n ships
`typeToConfirm: "Type {{word}} to confirm"` in both English and Thai, and no
component references it. For a setpoint write or a Start on energized
equipment, typed-confirm (or at minimum a held-button / deliberate-action
pattern) is the standard answer for high-consequence writes. The team built
the string, localised it, and abandoned the feature — worst kind of slop
because it proves the hazard was recognized and deprioritised.

**Setpoint is an unvalidated free-text write.** Submit handler is literally
`let t = Number(f); Number.isNaN(t) || send(speedSp, t)`. Consequences:

- UI displays `Allowed 0 to 60 Hz` but nothing enforces it in the client —
  `60.5`, `600`, `-40`, `1e3` (parses to 1000), `0x28` (parses to 40),
  `Infinity` all pass straight to the write path. Whether the PLC clamps is
  invisible to the operator; if it does clamp, the HMI silently commanded a
  different value than displayed — the journal will show what was *asked*,
  which is good, but the operator was never told "rejected/clamped to 60."
- `Number("") === 0`, so pressing Apply on an empty field commands **0 Hz**
  with no warning. Fat-finger clearing the box then hitting Enter = silent
  full stop command.
- Text `<input>` with `inputMode="decimal"` — not even `type="number"` with
  min/max attributes. No out-of-range error string exists in i18n at all.
- No delta confirmation ("45.0 → 600.0 Hz?"), no rate-of-change limit
  indication.

**Feedback loop — partially closed.** After send, the panel shows
`control.sent` + LifecyclePill (issued → acked → done/denied), and `nowHz`
displays the tag readback ("now 45.0 Hz"). If `speedSp` is genuine PLC
readback, the operator can see the write land — that is the single most
important safety property and it's *almost* there. Gaps: (a) "done" is
transport-language; nothing explicitly correlates "commanded X → now reads
X" or flags a mismatch/stale value; (b) the pill shows only the last
command inline — navigate away and correlation is lost except on /commands;
(c) no timeout surfaced to the operator if a command hangs in `issued`
(though `denied` exists as a state, which is more than most).

**/commands journal is genuinely good.** Columns: id, tag, value, status,
user, time, detail — "who sent it and what happened" including denials.
That is a real command audit trail, not a toast log.

**Lock model is exemplary — the best thing on this surface.** Control is
replaced (not just disabled) by a lock reason, and the reasons are
operationally literate: `reasonEdge` "The edge gateway is offline, so
commands cannot reach the PLC", `reasonClock` "The edge clock is not
trusted, so the PLC would reject commands", `reasonRole`, `reasonGuest`,
`reasonViewport` "Equipment can only be operated from a workstation display
(768 px or wider)". Edge-offline and untrusted-clock interlocks are details
most production HMIs never implement.

## AI-slop flags

- `typeToConfirm` localized in 2 languages, zero references — feature
  scaffolded then orphaned.
- `confirmStopTitle`/consequence modal built with correct a11y (alertdialog,
  focus trap, Esc→cancel, backdrop→cancel) — then hung on the *safe* action
  while the dangerous one got nothing. Pattern applied without hazard
  analysis.
- Controls card header is just "Controls" — it never names its target.
  Buttons always write the drive tags (`running`, `speedSp`) regardless of
  which equipment card is selected above. Operator can select "Vision
  camera" and hit Start; the UI does not say what is being started.
- `demo=operator` + an "Off shift" toggle in the chrome — if shift state
  doesn't gate writes it's decorative; worth checking.
- Form-submit on Enter inside the setpoint box fires the write — no
  armed-then-apply staging despite the ghost "Apply" button looking like a
  two-step flow.

## What works

- Edge-offline and untrusted-clock command interlocks with plain-language
  reasons; workstation-viewport gate; role/guest distinction.
- Command lifecycle poll issued→acked→done/denied with an inline pill and a
  persistent journal including who/value/denial detail.
- Live-tag readback next to the write field (`now 45.0 Hz`) — readback
  confirmation is present in embryo.
- Stop modal itself is a correct accessible pattern — it's just on the
  wrong button.

## Top fix

**Rebalance friction to consequence and close the write-verify loop:**
1. Put the existing Confirm (or the already-localized `typeToConfirm`)
   on **Start** and on **out-of-envelope setpoint writes**; remove the
   modal from Stop (or make Stop the instant action it needs to be in a
   developing incident).
2. Validate the setpoint field: `type="number"` min=0 max=60, reject
   empty/whitespace (`""`→0 today), reject out-of-range with a visible
   error string, and echo "commanded → readback" so a clamped or denied
   write is obvious instead of silent.
3. Label the Controls card with its actual target (drive/line) so the
   selected-card ↔ command-target ambiguity can't put energy on the
   wrong asset.

What gets someone hurt today, in order: one-click remote Start on a
stopped conveyor with a person in the zone; a mistyped 600 Hz (or
600 rpm-analog) setpoint sailing through a NaN-only check; and a Start
issued against the wrong mental target because the panel never says what
it controls.

---

<!-- ====================================================================== -->
## [09/48] File: `round1/agent-09-navhmi.md`

# Agent: hmi-ia-consultant — round1

## Pages: global nav

Evidence: `Temp/shots/s1-nav.png` (1440×900, `?demo=admin`), nav model `web/src/app/nav.ts` (lines 40–211), labels `web/src/lib/i18n.ts` (en: nav block ~lines 15–33; th: ~lines 873–892).

Rendered rail (admin demo, flags off — 11 items, 4 divider clusters):
`Dashboards · Monitoring · Developer Portal · Automation | Infrastructure · Security · Intelligence | Metrics · Production · Logs | Admin`
Flag-gated items that exist in the model but not this build: Assistant AI, Incident Response, APM (Batch traces, Edge processes), Digital Experience (Operator sessions, Heartbeat checks), Error tracking, plus ~13 flag-gated routes overall.

## Score /10 (as HMI)

**3/10.** This is a vendor-observability taxonomy wearing a hard hat. The rail is the Datadog/Sentry pillar model (Monitors, APM, Digital Experience, SLOs, Synthetics, Metrics/Logs/Traces, Error tracking) transplanted onto a plant console. An operator's day is *watch the line → respond to alarms → log why it stopped → hand over the shift*. None of those four tasks is reachable in one click:

- Line view: Dashboards → flyout → "Live views" → Line view (3 interactions; the single most important screen in the console)
- Alarms: Monitoring → flyout → Alarms
- Stops (real downtime): Production → flyout → Stops
- Shift handover: Production → Shifts

The rail is organized by *system layer* (infra, security, metrics, logs) — exactly the "software taxonomy" an HMI is supposed to avoid. ISA-101's level hierarchy (Overview → Area/Line → Equipment → Detail) has no expression in the nav; it's feature-shaped, not plant-shaped.

## HMI/ISA-101 verdicts

**What the top level SHOULD be** (job-to-be-done, ≈7 groups, maps to plant roles):

| Proposed | Swallows today's | Serves |
|---|---|---|
| **Line** | /line, /line3d, /structure (plant structure), infra map | every operator, always-on |
| **Alarms** | /alarms, /downtimes (muting), /alarms/quality, /admin/rules, /notifications/channels, /alarms/settings | operator + alarm rationalization per ISA-18.2 |
| **Production** | /oee, /stops, /shifts, /reports, /traces (batch) | shift supervisor |
| **Trends & Tags** | /trends, /metrics, /tags, /query, /notebooks | process engineer |
| **Quality** | /traces or defect results, /insights, /errors→rejects | QC |
| **Equipment** | /infrastructure*, /health, /processes, /logs, /events | maintenance |
| **Setup / Admin** | /admin*, /security*, /settings, /users, audit | engineer/admin |

**Verdicts on the actual grouping:**

- **"Production" (OEE/Stops/Shifts/Reports) is the only group that speaks plant.** It is the model for what the rest should look like — and it's stranded in cluster 3 between "Metrics" and "Logs."
- **"Monitoring" is a false friend.** It mixes SRE "Monitors" (watch rules, templates, SLOs) with plant alarms. Alarm muting ("Downtimes"), alarm rules, notification channels all live here — correct instinct — but the roof should be labeled **Alarms**, and Monitors/SLOs belong under Equipment or Admin. Alarm rule editing is split across three surfaces: Monitoring→secondary "Alarm rules", `actionNewRule`, and Admin→"Alarm rules" — "rule" surfaces ×4 confirmed.
- **"/downtimes is the single most dangerous label in the app."** It is alarm *snooze/muting windows*, but the name says production downtime — while real downtime lives at Production→Stops. Worse, the Thai translation `ช่วงหยุดซ่อมบำรุง` reads as *"maintenance-stop periods"*, colliding head-on with `การหยุดเครื่อง` (Stops) one flyout over. ISA-18.2 calls this *shelving / suppression*; label it `ช่วงปิดเสียงเตือน` / "Alarm mute windows". An operator told to "check downtimes" after a trip will stare at a mute schedule. This is an incident-generating label, not a cosmetic one.
- **"APM" holding Batch traces is criminal burial.** Lot/batch traceability is a QC supervisor's daily tool, filed under an SRE acronym. Same for "Digital Experience" holding "Operator sessions" (an audit/who-touched-what feature — belongs in Admin) and "Heartbeat checks" (synthetics — belongs in Equipment health).
- **Single-item groups are rail waste:** Automation→Commands only; Logs→Logs only; Error tracking→/errors only; Assistant AI→/assistant only. Each opens a 400px flyout for one link. Automation especially: the name promises sequences/recipes and delivers `ประวัติคำสั่ง` — a *command history log*.
- **"Developer Portal" holds operator-relevant content** (Assets catalog, Plant structure — the equipment hierarchy an operator navigates by). The label says "not for you."
- **Assistant/AI is split-brained:** its own rail group AND inside Intelligence AND `/assistant` item — three entries to one chat.
- **Buried treasures:** Line view and 3D twin (the actual HMI screens) inside a Dashboards flyout; Plant structure inside Developer Portal; Commands (the write-path, the one dangerous surface) as a lone orphan under "Automation"; System health inside Infrastructure.

## AI-slop flags

- **Observability triad cloned wholesale:** Metrics / Logs / Traces(via "APM") + "Error tracking" + "Synthetics(Heartbeat checks)" + "SLOs" — this is Datadog's product surface, not a line console's.
- **"Digital Experience"** — pure SaaS-marketing category name; meaningless to anyone within 100 m of a conveyor.
- **Flyout chrome:** "+ New dashboard", "NEW" badges, right-hand secondary columns, 400px panels for one item — SaaS CRUD scaffolding generated bigger than the product.
- **"Getting started · 4 of 6 done · Invite a teammate"** activation checklist on the landing page — PLG onboarding pasted into an OT console. (The adjacent "Connect your plant / Simulator–Factory I/O–Real PLC" card, by contrast, is genuinely good commissioning UX.)
- **"Notebooks"** as operator navigation — Jupyter for a shift floor.
- **"Intelligence" → "Insights"** — thesaurus nav: the group and its child are synonyms (in Thai too: `ข้อมูลเชิงลึก` → `อินไซต์`).
- **"Security" as top-level cluster-2 peer** with a "Business logic" (`ตรรกะธุรกิจ`) child — API-protection vocabulary at the same rank as the plant itself.

## Labels that would confuse a Thai operator most

1. **APM** — left untranslated in the Thai dict (`apm: 'APM'`). Pure noise; hides `ติดตามล็อตการผลิต` (batch traces) underneath.
2. **Downtimes → `ช่วงหยุดซ่อมบำรุง`** — reads "maintenance downtime"; actually alarm muting. Collides with `การหยุดเครื่อง` (Stops). Worst single defect.
3. **Digital Experience → `ประสบการณ์ดิจิทัล`** — literal translation, zero referent on a line.
4. **Monitors → `มอนิเตอร์`** — to a Thai operator "มอนิเตอร์" is the display screen, not a watch rule.
5. **SLOs → `เป้าหมายระดับบริการ`** — service-industry phrasing; plant equivalent is alarm/KPI targets.
6. **Security → `สัญญาณความปลอดภัย`** — literally "safety signals"; reads like E-Stop/safety-system alarms (functional safety), not cybersecurity posture. Dangerous overlap in an OT context where "safety" means people, not CVEs.
7. **Automation → `การสั่งงาน`** ("the commanding") containing only `ประวัติคำสั่ง` (command *history*) — promises control, delivers an audit log.

## What works

- The 4-cluster divider concept is right; cluster 4 (Admin) separation is correct.
- Production group's contents match a supervisor's mental model exactly.
- Alarm-adjacent items do cluster inside Monitoring's flyout — the bones of a correct "Alarms" group exist.
- Command palette (Ctrl+K) partially forgives the IA for power users.
- "Connect your plant" commissioning card (Simulator → Factory I/O → Real PLC) is excellent progressive-onboarding for OT.

## Top fix

**Rename and re-roof, don't reorganize pages.** Cheap version (labels only, no route moves): Monitoring → **Alarms**; `/downtimes` → **"Alarm mute windows"** / `ช่วงปิดเสียงเตือน`; Metrics → **Trends & Tags**; Infrastructure → **Equipment**; Automation → **Operate**; demote Security/DevPortal single links into Admin. Full version: adopt the 7-group job-based rail above — promote **Line** and **Alarms** to top level so the two tasks that run a shift are one click from anywhere, merge Automation+Commands into Operate, move batch traces to Production/Quality, and delete APM/Digital Experience/Error-tracking as named groups (their 2–3 flag-gated items re-file under Equipment and Admin). Estimated delta: 11–16 rail items → 7, zero operator task deeper than 2 clicks.

---

<!-- ====================================================================== -->
## [10/48] File: `round1/agent-10-ergo.md`

# Agent: controlroom-ergonomics — round1

## Pages: /, /line, /alarms @1920

Captures: `Temp\shots\s1-ergo-overview.png` (`/?demo=viewer`), `s1-ergo-line.png`, `s1-ergo-alarms.png` (both need `?demo=viewer` — bare routes bounce to the login page, which is dark). Cross-referenced `c_alarms_101.png` (populated alarm detail w/ critical banner).

**Theme finding first: there is no dark content theme.** Confirmed in source — `src/dd-theme.css` defines a single light palette (`--color-paper: #ffffff`); the only dark surfaces are the rail/topbar chrome (`#292e39`), the flyout (`#15171e`), and the login page. No `prefers-color-scheme` handling anywhere outside the landing page's own `hx-dark` class (`src/features/landing/landing.css`) and `prefers-reduced-motion` in the ambient engine. So "both themes" = dark chrome + white content + dark login. The squint test below is on the only theme an operator can actually get.

## Score /10 (as HMI)

**5/10.** Good skeleton, wrong operating envelope. ISA-101-aware severity ramp, alarm lifecycle stepper, calm-mode ambient engine, density histogram — someone read the right books. But the primary failure is physical: the console is a *desk-distance office UI* (dominant text 12–13px, 341 uses of `text-[11px]`, 21 of 9px, 5 of 8px — measured across `src/**/*.tsx`) being asked to work as a *wall-distance control-room HMI*. At 2m on a 24" 1080p panel, 13px ≈ 6 arcmin letter height — under the ~10–12 arcmin floor for sustained legibility, and 11px caps labels are ~5 arcmin. A tired operator at 3am leans in, which is exactly the fatigue behavior the design should prevent.

## HMI/ISA-101 verdicts

- **Squint test — Overview:** survives: rail silhouette, page title, the blue "Factory I/O" segment, "Live" pill in topbar. Dies: the entire tag-tile row — "BELT SPEED / BIN LEVEL / GRAVE RATIO / SPEED SETPOINT / LINE STATE" labels (~10px caps, `--color-ink-46` ≈ 3:1) collapse to gray smudge; the values are thin em-dashes ("—"), i.e. **the plant state is invisible at 2m**. Worst offender: "Unknown · No data yet" in ~11px gray — the single most important fact on the screen (plant is NOT reporting) is whispered. ISA-101: unknown/stale data is an *abnormal condition to annunciate*, not a blank. At a glance this page is indistinguishable from "all nominal."
- **Squint test — /line:** survives: 4 equipment-card headers, blue "SELECTED" chip. Dies: every value is "— Stale" in a **hairline dashed-outline pill at ~9–10px** — the staleness annunciation dissolves at arm's length, let alone 2m. The mimic is a gray-on-gray CAD blob; the central label cluster ("Drum emptier 1/2", "Mixer", "Weight hopper") **literally overlaps** — colliding labels at desk distance become noise at distance. "Aggregate bin 1–4" stack labels partially clipped. ~40% of the drawing row is an empty right panel repeating the same hint already in the page subhead.
- **Squint test — /alarms (empty):** survives: tab structure, "No active alarms" state — correctly low-salience when nothing is wrong. Note: 1 acknowledged alarm sits behind a tab; fine while cleared-active, but the pattern that *does* work is in `c_alarms_101.png` — the full-width red banner "1 critical alarm active: conveyor temp HiHi > 75 °C" + "2 active" counter is exactly what survives at 2m at 3am. Big "66.6 °C" value on detail ≈ 28px — right direction, still small for wall distance.
- **Dark mode as default:** Yes for this environment — and currently **impossible to select**. White `#fff` content fields are glare panels in a dark room; overview and the alarms empty state are literally walls of white at 1080p. Caveat: don't naive-invert — ISA-101/EEMUA would take a muted low-luminance gray or true-dark palette with the severity ramp retuned (amber-on-white fails; the dark-pill rescue is already documented). Login page proves a dark surface exists in the design language; extend it to content.
- **What breaks in light mode (dark room):** not a contrast break — a *luminance* break. Worst: overview (maximum white acreage + the data tiles it should glance), then /line (white panel + gray mimic = glare *and* low contrast simultaneously — the worst of both), alarms empty state least harmful because density is low.
- **Density vs fatigue:** density isn't the problem — hierarchy is. /line's card row is a good operator density (4 targets, one row). The mimic is locally overcrowded (label pile-up) inside a globally empty canvas — rebalance, don't shrink. Overview spends ~60% of the viewport above the fold on onboarding chrome and pushes live plant state below the fold at 1080p. Fatigue-wise, the 11px-gray-everything habit is the real cost: low contrast × small size × distance = squint-and-lean all shift.
- **Rail/topbar:** measured — `text-nav-dim` #babdbb on #292e39 ≈ 7:1 at 13px/31px rows; survives. Bottom "Invite/Support/Help" trio at 11px on dark — dead at distance, acceptable (secondary). Clock + "Live" + shift pill in topbar — glanceable, keep.

## AI-slop flags

- **Onboarding cosplaying as an L1 display:** "Getting started · 4 of 6 done" checklist + "Connect your plant" wizard cards + a monospace `docker run` block — on the *operator overview*. That's a setup page that moved into the alarm seat. L1 should be plant state, alarm summary, and nothing else.
- **Duplicated hint:** "Select a piece of equipment on the drawing" appears as the page subhead-line AND in a dedicated half-width empty panel — generated-layout filler.
- **Naming drift:** overview tile reads "GRAVE RATIO" while /line says "Gravel bin / Gravel ratio" — likely a tag-name typo leaking to UI (not found in `web/src` — probably backend/mock data; verify tag `*.ratio` naming). Operators *will* notice "grave" on a cement line.
- **Mimic looks traced, not composed:** overlapping center labels, clipped bin labels, no value readouts on equipment — a P&ID drawing dropped in rather than a high-performance graphic with embedded values (ISA-101 L2 wants data *on* the symbol).
- **Demo chips on login** (`demo-operator / demo-viewer / demo-admin` pills): fine for demo, flag so it never ships.

## What works

- Critical-alarm banner pattern (`c_alarms_101.png`): full-width red strip + persistent "2 active" count — the one element that genuinely survives the 2m squint test. Extend this annunciation energy to stale/unknown data.
- Alarm density histogram: exactly the right ambient peripheral display — glanceable, calm, informative.
- Alarm lifecycle stepper (Raised → Acked → Cleared with pending durations) — good ISA-18.2/101 alignment.
- `ambientEngine.ts` calm-technology design: luminance-only contours ≤8% alpha, `prefers-reduced-motion` + persisted calm toggle, critical-alarm freezes motion — this is genuinely sophisticated fatigue-aware engineering. Pity the text layer doesn't match it.
- Search placeholder teaching syntax (`tag:motor1 sev:critical state:active`), severity ramp with `-ink` text variants ≥4.5:1, IBM Plex + Thai fallback — real craft in the details.

## Top fix

**Ship a low-luminance content theme and make it the default for console surfaces — then enforce a distance floor.** Concretely: (1) dark/"night" palette for content (the login page + rail prove the language exists), retune severity ramp for dark surfaces; (2) minimum 16px for any text carrying plant state, 11px reserved for true tertiary chrome; (3) promote tag-tile values to `--text-display`-class numerals and give stale/unknown a real annunciation treatment (not a bare em-dash + 11px gray). The information architecture is already right — it's just rendered for a desk, not a chair 2m back at 3am.

---

<!-- ====================================================================== -->
## [11/48] File: `round2/agent-02-incidents.md`

# Agent: incident-response-designer — round2

## Pages: /incidents (+/settings)

Audited on the :5199 Vite dev server (flag `incidents` on via `import.meta.env.DEV → 'all'`,
`web/src/lib/features.ts:5-9`). Captured fresh: `s2-incidents.png` (list, 2 real incidents),
`s2-incidents-panel.png` (accidental backend-blip shot — shows the honest error/“live feed
reconnecting” degraded state), `s2-incidentsettings.png` (settings), `s2-incidents-5173.png`
(prod Docker build on :5173 → silent Overview redirect, no "Incident Response" nav section).
Exercised the API live: declared, acked, noted, resolved an incident; verified forward-only
status (409 on ack-after-resolve), 405 on PATCH severity, append-only events with `who`/`at`.

## Score /10 (as HMI)

**5/10.** The chassis is real — backend lifecycle, authored append-only timeline, facet
filtering, keyboard hints, honest RBAC gating — but the four joints that make an incident
console an *incident console* are all disconnected: you can't declare from the alarm that
woke you, declaring notifies nobody, you can't see who's responding, and Escalate doesn't
escalate.

## HMI/ISA-101 verdicts

**Does it support a 3am plant upset?** Barely. Walk the loop:

1. **Declare fast from alarm — NO.** No "declare" action anywhere in `features/alarms`
   (grep: zero hits for `incident|declare`). The only path is /incidents → "Declare incident"
   → a dialog asking for title/severity/team (`IncidentsPage.tsx:37-82`). The backend
   `IncidentIn` *does* accept `alarm_id` (`backend/app/api/incidents.py:124`), but
   `incidentApi.create` never sends it (`lib/api.ts:409`) — so the linked-alarm card in the
   panel (`IncidentPanel.tsx:280-303`, complete with alarm state badge, tag, equipment, and
   "open alarms"/"open line" links) is **dead code**: unreachable from the UI, only populated
   by raw API calls. At 3am the operator retypes a title with no context carried over.
2. **See who's responding — NO.** Ownership is team-only (`owner_team_id`); there is no
   assignee field, no responder roster, no "acked by" chip. `IncidentRow.mine` is computed
   server-side and never rendered. The closest thing is the Escalate menu, which displays the
   current on-call *name* for the owning team (`IncidentPanel.tsx:228-239`) — read-only info,
   not a page button.
3. **Timeline — YES.** Real, append-only, authored (`incident_events`, kinds
   created/status/note; verified live — every event carries `who` + `at`). Note entry is
   operator-gated and hidden once resolved. This is the one part that works like a real
   console.
4. **Comms — NO.** Nothing incident-scoped. Notification channels and escalation policies are
   real but target **alarms** — the sweeper walks `esc_level` on the `alarms` table
   (`backend/app/alarming/notify.py:658-697`). `v2_create_incident` emits an audit record only;
   declaring a critical incident at 3am pages exactly nobody.

**What's missing vs a real incident console:** alarm→incident promotion, notify-on-declare,
incident-scoped escalation (policies exist but incidents never enter them), responder/assignee
tracking, severity upgrade (write-once; mis-click at 3am is permanent), reopen (resolved is
terminal — fine for audit, but no monitoring/verifying state), @mentions or any way for a note
to reach a phone, MTTA/ack-SLA surfacing (MTTR exists in a dashboard widget,
`widgets.tsx:878-930`).

**Is the flag-gate the right call?** **Yes — and it's the correct kind of honest.** On :5173
(prod build, flag off) the route isn't mounted, the nav group is filtered out
(`nav.ts:198-210`), and /incidents falls through to Overview — confirmed in
`s2-incidents-5173.png`. Shipping this half-broken would be worse than hiding it: an
"Escalate [!]" button that opens a paragraph of text explaining it can't escalate is actively
dangerous to a sleep-deprived operator who needs muscle memory to work. Hidden beats lying.
That said, the gap to shippable is smaller than the flag suggests — the API already accepts
`alarm_id`; wiring a "Declare incident" action into the alarm row/detail plus
notify-on-declare closes most of the 3am loop.

## AI-slop flags

- **Dead shortcuts on dead menus.** The Next-steps bar teaches P/S/A/! keyboard shortcuts
  (`IncidentPanel.tsx:107-126`), but only **S** does anything. P opens an all-disabled
  severity menu, A and ! open explanatory text + a link out. Shortcuts for non-features is
  PagerDuty cosplay — it trains operators to press keys that do nothing during real events.
  (To its credit the code comment admits it: "those menu items explain the gap instead of
  faking it", `IncidentPanel.tsx:6-8`.)
- **Aspirational copy.** Settings says channels are where "alarm and incident notifications
  are sent" and the empty state says "add a channel so alarms and incidents can reach a
  phone" — no incident notification path exists.
- **SaaS idiom transplant.** "Next steps", Escalate [!], Assign [A], facet sidebar, CSV
  export — Datadog/PagerDuty chrome wrapped around a model that can't assign or escalate.
- **Deep-link trap.** `?incident=<id>` deep links exist, but the demo sign-in path does
  `navigate(loc.pathname)` (`App.tsx:226`), stripping the query — so a fresh `?demo=` visitor
  loses the deep link. SSO-restored sessions keep it; demo links eat it.
- **`mine` computed and discarded** — backend answers "is this yours" and nothing renders it.

## What works

- **Real lifecycle, verified live:** POST → active; status endpoint enforces
  active→acknowledged→resolved forward-only (409 otherwise; resolving an active incident
  auto-acks it); notes append with author identity; no delete — properly append-only.
- **Honest vocabulary card** (`IncidentSettingsPage.tsx:200-229`): severity ladder with
  meaning *and expected response* ("Critical — respond immediately, escalate if not
  acknowledged"), status flow with plain-language semantics, and a footer admitting the
  vocabulary is backend-fixed. This is genuinely good incident-tool design.
- **Status pills are ISA-101-correct:** color + shape glyph + uppercase text, never color
  alone (`IncidentPanel.tsx:30-46`); severity renamed to Critical/Warning/Advisory with
  matching glyphs.
- **Escalation policies + on-call are real plumbing** — 1–10 levels, strictly increasing
  waits, channel/team/oncall-team per level, backed by the alarm sweeper. It just escalates
  alarms, not incidents.
- **Honest degraded states:** "Live feed reconnecting — values may be out of date" banner +
  error notice + Try again (visible in the panel screenshot during a real backend blip).
  Viewer/operator/admin gating explains *why* controls are missing rather than hiding them.
- **Density + scannability:** h-10 rows, mono opened/age columns, facet counts, omnibar with
  `status:`/`severity:`/`team:`/`equipment:` tokens (`incidents.ts:102-127`), CSV export,
  30s/15s polling. Fine console ergonomics.

## Top fix

**Wire the alarm into it.** Add a "Declare incident" action on the alarm row and
AlarmDetailPage that opens DeclareDialog with `alarm_id` prefilled (the API field already
exists and FKs correctly — `incidents.py:124,171-177`), and make `v2_create_incident`
enqueue a notification through the existing channel machinery so declaring pages the owning
team. That single connection turns the page from a form into a response loop: alarm →
declare → phone rings → on-call name shows in Escalate → timeline records who did what.
Until then, keep it behind the flag — the flag is the right call.

---

<!-- ====================================================================== -->
## [12/48] File: `round2/agent-03-events.md`

# Agent: soe-specialist — round2

## Pages: /events, /infrastructure/events

Evidence: prior-round screenshots (`r2-events.png`, `r2-events-7d.png`, `r2-events-corr.png`, `r2-events-cluster.png`, `r2-infraevents-demo.png`), fresh `--dump-dom` captures (`s2-events-dom3.html`, `s2-infraevents-dom.html`), and the live page bundles `EventsPage-eVvxg5pm.js` (main /events) and `cur-EventsPage-C.pretty.js` (vision events). Chrome `--screenshot` was sandbox-blocked in this session (child-process write denied); DOM dumps and prior PNGs cover the same surfaces.

## Score /10 (as HMI): 6

Down from the 7 I'd have given the idea on paper. It is a competent event *browser*. As a *record* — the thing you reconstruct an upset from — I would not trust it yet.

## HMI/ISA-101 verdicts

**Ordering / timebase — fails at the one thing SOE exists for.**
- `Pe()` renders `toLocaleString(..., {hour,minute,second})` — **second resolution only**. The underlying `at = Date.parse(ts)` and CSV export (`new Date(n.at).toISOString()`) prove ms data exists; the UI chooses to hide it. On a turbine trip you get dozens of events inside one second and this list cannot order them visibly.
- Confirmed visually: `r2-events-7d.png` vs `r2-events-corr.png` show the same two `13:27:00` insights ("silo3 level_pct" vs "Gravel ratio") **in swapped order** between List and Correlated. Same-second ties have no visible tiebreaker — no sequence number, no ms. A forensic reader cannot tell which fired first; worse, the UI tells them two different stories depending on the toggle.
- Vision events: `y = e => new Date(e).toLocaleString()` (`cur-EventsPage-C.pretty.js:50`) — same second-resolution, locale-formatted ("10/19/2026, 1:24:03 PM"), no TZ label.
- Bonus trust issue: demo data stamped **10/19/2026** — a year in the future vs the console clock. Even if it's a synthetic clock, an SOE record whose timestamps don't line up with wall time is not a record.

**Cause-chain visibility — modeled, then thrown away.**
- The code *does* synthesize lifecycle triples: every alarm becomes `a:<id>:r` (raised), `a:<id>:a` (acked, `actor: e.acked_by`), `a:<id>:c` (cleared). Commands become `c:<id>:i` issued + terminal status (`Ce` map: acknowledged→done, rejected/failed/timeout→failed). That's a real ISA-18.2 state model underneath.
- But the render is **flat**: raise, ack and clear are three unrelated rows scattered by timestamp, with no thread, no indent, no duration column. There is no "this alarm was active 4m12s, acked after 38s by X" anywhere. Time-to-ack — the single most useful post-incident metric — is uncomputable from the view.
- i18n shows correlate was *designed* for cause chains (`corrAlarm:"Alarm in window"`, `corrCmd:"Command to this signal"`, `corrInsight:"Overlapping insight"`) — the intent is right, the implementation doesn't reach it.

**Correlation — still broken, now code-confirmed why.**
- `ce(events,{by,gapMin})`: group key is `V(e,by)` = `e.equipment` or `e.tag` — **only**. Any event with `tag == null` bypasses clustering entirely (`e===null → i.push(n)` → stays a singleton row).
- The 500-row `vision-sweeper` config-change flood has no tag → Correlated mode renders it as a flat wall of identical rows (`r2-events-cluster.png`: Group by Signal / 15 min — zero visible collapse). The biggest flood source in the plant is the one class of event correlation cannot touch.
- Clusters sort by `U(e) = e.to` (cluster *end*), interleaved with singletons by `.at`. Reasonable, but a cluster's position silently moves as new events land — unstable during a live flood, exactly when you watch it.
- Cluster summary rows do exist (`evx.clusterTitle{count,where}` + `clusterSpan` + source chips) — the mechanics are fine; the key space is just too narrow.

**Actor legibility — no.**
- `children: n.actor ?? ''` — actor rendered verbatim. Commands use `e.user` (raw, previously seen as `user:uuid`), acks use `e.acked_by`, system events `e.actor`. No display-name resolution anywhere. Tags get resolved via `Z(e,n.tag)` to `site.path`; actors get nothing.
- BY column empty on most rows (insights carry no actor — fair — but then why is it a column?). The only populated BY values are service names like `vision-sweeper`.

**Fidelity of the record — the quiet killer.**
- Footer: *"Sources: last 500 alarm records, last 200 insights, last 100 commands. System events are from this browser tab only."* This is a client-side union of capped lists. In a real flood the first-out — the event that started everything — is precisely what falls off the back of the cap. An SOE that drops the root cause under load is worse than none.
- "System" source (`Se()`) reads `c.journal` — the **browser tab's own notification journal** (`session:!0`, dashed "session" badge). Edge-up/edge-down/auth events exist only while this tab is open. That is not a record; that's a toast log wearing a record's clothes.
- No before/after values: fifty identical "Config change: vision.alarm.raised" rows carry zero diff (old→new), no parameter, no count. A config-change stream without diffs is noise.
- Liveness: insights/commands poll at 60s/30s (`staleTime`/`refetchInterval`); alarms ride the `alarmRev` channel — acceptable, but the DOM showed "Reconnecting" so the live path is fragile.
- `/infrastructure/events` is honestly a decent vision-labeling queue — keyboard `c`/`w`/arrows, bulk mark, correct-class picker, ZIP export of wrongs — but it's a *review queue*, not an event record: second-resolution `toLocaleString` times, raw `JSON.stringify(detail)` blob, `rule_id` truncated to 8 chars when unmapped, classes fall back to "class N", no actor, no deep link into the main event stream. Two pages named "Events," two unrelated schemas, zero cross-reference.

## AI-slop flags

- Lede promises "Every alarm, insight and command change, in one searchable list" — then Source facet reads **Alarm 0, Command 0, Incident 0** on a 7-day demo window. The page advertises a unified record it doesn't demonstrate.
- "Correlated" toggle whose grouping silently skips the largest event class — the feature exists to be seen, not to work.
- `System` source = "events from this browser tab" — calling a session-local journal part of the plant event record is the definition of demo-thinking.
- Demo org switcher in the DOM lists a dozen `pytest-org-b-*` / `sec-org-*` orgs for the viewer account — test-fixture bleed into the product surface.
- Identical flood rows with no dedup/count — 500 copies of the same string is not information, it's a rendering bug that shipped.
- Vision detail pane: raw `<pre>JSON.stringify(detail)</pre>` — developer JSON left in an operator surface.

## What works

- Real lifecycle model underneath (`raised/acked/cleared` triples, command terminal states, severity ranking `B={critical:3,warning:2,info:1}`) — the data model is better than the presentation.
- Clickable histogram bins (`aria-label "09:44–09:52: 0 events"`, pick/clear) — genuinely useful for bracketing an upset window.
- Deep links: alarms → `/alarms/{id}`, insights → `/trends?tags=X&from=t-10m&to=t`, commands → `/commands?cmd=id`. Navigating from event to evidence is the right instinct.
- CSV export writes ISO timestamps with ms — the export is more truthful than the screen.
- Query DSL placeholder (`source:alarm sev:critical tag:conv* -action:cleared`) and facet counts are the right shape.
- Vision queue: c/w/arrow keyboard flow, bulk verdicts, wrong-export ZIP — good review ergonomics, just mislabeled as "Events".

## Top fix

**Millisecond timestamps + lifecycle threading, then fix the correlate key.**

1. Render `HH:MM:SS.mmm` (you already have ms in `at`; CSV already emits it). Add a monotonic tiebreaker (source seq/id) so same-second rows can't silently swap.
2. Collapse `a:<id>:r / :a / :c` into one expandable row showing `raise → ack → clear` with durations (`t_active`, `t_to_ack`, actor per transition). That's the difference between an event list and an SOE.
3. Give correlate a fallback key chain — `tag → equipment → source+subject` — so tag-less floods (the 500 vision config-changes) actually cluster; aggregate identical rows with a ×N badge in list view too.
4. Stop printing `user:uuid`; resolve actors to display names like you already resolve tags.
5. Drop "system events from this browser tab" from the record or label it as session diagnostics, and paginate past the 500/200/100 caps — an archive that truncates under flood is where root causes go to die.

---

<!-- ====================================================================== -->
## [13/48] File: `round2/agent-04-ack.md`

# Agent: mobile-hmi-designer — round2

## Pages: /ack/:token

Verified at 390×844 and 1440×900 headless Chrome against live `localhost:5173`
(assets: `AckLinkPage-DY7npF05.js` 2.2 KB, `api-Ce07eEu1.js` 8.4 KB). Both
shots render the generic "Log in" wall — the ack page never paints for a
logged-out operator.

## Score /10 (as HMI): 3

Prior audit said 4. A point comes off because on inspection the defect isn't
"missing features on a reasonable page" — the interaction model itself is
inverted: a GET-shaped URL that commits a mutation, with a half-built state
machine bolted on and never exercised end-to-end.

## HMI/ISA-101 verdicts

- **Auto-mutation on navigation is the headline defect.** `useEffect` fires
  `POST /api/v1/ack/{token}` on mount. A URL is GET-shaped: mail scanners
  (SafeLinks/Proofpoint fetch URLs to check them), SMS/iMessage link preview,
  Slack/Teams unfurl, browser prefetch/prerender, and the notification shade
  all "open" links. First-touch wins — the alarm can be acked by a corporate
  mail gateway before the operator's thumb reaches the screen. The 410 `used`
  state exists precisely because replay happens, yet first-actor-wins means
  the *scanner* consumes the token. Alarm ack is a control action on the
  process (it silences the annunciator); committing it with zero process
  context violates the ISA-18.2 principle that ack must be a deliberate
  operator response, and it destroys ack-rate metrics — every delivered link
  becomes an "ack," so rationalization data is poisoned.
- **"Show WHAT before committing" — currently shows nothing, ever.** No alarm
  name, no severity, no site/asset, no value-vs-threshold, no age. The server
  response already carries `alarm.id` (used only for a link href), so a
  preview payload is trivially available; the UI chooses blindness.
- **What a sleepy operator must see before the confirm tap:**
  1. Alarm name + severity as a color chip (ISA-101 palette — not generic
     brand colors; critical ≠ info-blue).
  2. Where: site / line / equipment.
  3. What: current value vs. trip threshold ("Tank-3 temp 94 °C > 90 °C").
  4. When: triggered time + live age ("active 12 min").
  5. State honesty: still-active vs. already-acked-by-someone, so a second
     tapper doesn't get a bare "used" line.
  6. One deliberate full-width thumb-zone button ≥48 px: "Acknowledge."
- **Semantic color misuse:** the `acked` state renders `ack.ok` in
  `--color-ok` green. Green = "process normal." An alarm that was just acked
  is still an active abnormal condition — the screen tells a half-awake
  operator "all good" at the exact moment it isn't.
- **Dead-end navigation:** "Open the alarm" → `/alarms/{id}` requires a
  session; the logged-out user (this page's primary audience) bounces to
  signin and loses the token context. No return-URL handling.
- **Layout is mobile-aware but pointless:** `min-h-[calc(100svh-36px)]`
  centered card, `max-w-sm` — fine chrome around a page that shows one line
  of text after silently doing the thing.

## AI-slop flags

- **Dead code shipped, never run:** a full `auth` state exists —
  `ack.signin`, `ack.signinBody`, `ack.retry` i18n keys, styled block, retry
  button — but the same 401 branch calls the global `onUnauthorized`
  (`i?.()`, confirmed: export `h` = the registered callback in
  `api-Ce07eEu1.js`), which navigates to `/signin` in the same tick. The
  authored signin UI is unreachable. Nobody tested the logged-out path; the
  screenshots prove it.
- **Guard for the wrong race:** `useRef` `h.current` blocks StrictMode
  double-invoke — developer-facing hygiene — while the real-world hazard
  (prefetch/unfurl/scanner firing the POST) is unguarded. Solved the fake
  problem, missed the production one.
- **Skeleton rows on a mutation page:** `c rows:2` shimmer is cosmetic polish
  on an interaction that shouldn't exist; it also lies — it frames the POST
  as "loading your page" when it's "committing your ack."
- **Retry re-commits blind:** `error` state's retry resets the ref and re-POSTs
  the same token — a second mutation attempt with still zero context about
  what it's acking.
- **State taxonomy as ornament:** `working|acked|auth|used|gone|error` looks
  like designed coverage, but the two states that matter most (`auth`,
  and the nonexistent `preview`) are respectively dead and missing.

## What works

- Status-code handling is correctly differentiated: 200→`acked`,
  401→redirect+state, 410→`used`, 404→`gone`, other→`error` with retry. The
  taxonomy is right; it's just bolted to a POST instead of a preview.
- Single-use capability-token-in-URL is the right *idea* for a 3am flow:
  the link itself is the credential, no session dance needed.
- Server response shape (`alarm.id`) proves the backend can hand the page
  alarm context — the fix is frontend-side.
- `svh` units, `max-w-sm`, dark theme, centered card: the canvas is
  phone-appropriate.
- Retry exists on the `error` path.

## Top fix

**Invert the interaction: token → preview → confirm → result. Never mutate
on navigation.**

1. `GET /api/v1/ack/{token}` (or reuse the POST endpoint's payload via a
   `?preview=1`/`Accept` distinction — the response already returns alarm
   fields) → render an **alarm card**: name, severity chip (ISA-101 color +
   priority word, not green), site/equipment, value vs threshold, triggered
   time + age, and current status ("still active" / "acked by j.smith 02:47").
   Below it: one full-width `Acknowledge` button ≥48 px, thumb-zone bottom,
   plus a quiet "View details" link that carries a return-URL through signin.
   Auth: the token itself is a single-purpose capability — render the preview
   for logged-out users; if org policy requires a session to *commit*, do a
   minimal signin that returns to this exact preview, never the generic wall.
2. `POST` fires **only on the tap**. `used`/`gone` states keep their current
   handling but gain content: "Already acknowledged by {who} at {when}" is
   the *correct* answer for a second tapper — it's information, not an error.
3. Result state: "Acknowledged ✓ {alarm name}, {site}, at {time}" — restate
   the object in the confirmation, and replace green `ok` with a severity-
   truthful style (acked ≠ normal).
4. If one-tap-from-notification is genuinely needed, put an "Acknowledge"
   action on the push/SMS itself (PagerDuty/xMatters pattern) and let the
   link open the detail page — don't smuggle a commit into a URL that every
   prefetcher on earth will fire.
5. Defense in depth: mark the endpoint `Cache-Control: no-store`, make the
   POST idempotent-by-actor (410 only on *other*-actor first touch), and log
   acks by user-agent so scanner-acks are at least visible in the audit trail.

---

<!-- ====================================================================== -->
## [14/48] File: `round2/agent-05-channels.md`

# Agent: thai-factory-engineer — round2

## Pages: /notifications/channels

Viewed as admin (`?demo=admin`). Fresh headless screenshot only captured the skeleton loader
(vite HMR socket stalls `--virtual-time-budget`; `--timeout` fires at load-event before React
Query resolves), so layout is judged from the same-route capture `shots/r2-channels.png`
plus source: `shots/ChannelsPage.pretty.js` (471 lines) and i18n strings in `shots/i18n-nc.js`.

## Score /10 (as HMI)

**5.5/10** — The page is real, not a mock: 5 provider types, delivery log, escalation policies
with client-side level validation. But for a Thai plant the ONE channel that matters is LINE,
and the LINE path fails first-try setup: wrong credential name, "(optional)" on a required
field, no hint where to get a token or a group ID, no test-before-save, no edit (delete +
recreate). An engineer standing at a Line 3 panel at 2AM would not get alerts flowing on the
first attempt — they'd paste the wrong secret, get a bare "fail", and give up or call IT.

## HMI/ISA-101 verdicts

- **CRITICAL — wrong terminology on the one required credential.** For `type=line` the form
  renders `nc.secret` = **"Signing secret (optional)"** (EN) / **"Signing secret (ไม่บังคับ)"** (TH)
  (`i18n-nc.js`), but the input is `required:!0` (`ChannelsPage.pretty.js` L246). Three faults
  stacked: (1) LINE has no "signing secret" — the LINE Developers console issues a **Channel
  access token**, and a separate **Channel secret** (used for webhook signature validation —
  literally a "signing secret", but the WRONG credential to paste here). An engineer who reads
  English carefully will paste the Channel secret → 401. (2) "(optional)" text on a
  browser-enforced required field — the label lies. (3) "Signing secret" is left in English in
  the Thai bundle; `lineTo` = "LINE user / group / room id" is also untranslated.
- **CRITICAL — zero acquisition guidance.** `lineTo` (L240) has no placeholder, no helper text,
  no doc link — just a bare required input. A Thai engineer holding a LINE Notify token from
  notify-bot.line.me has *no "to" ID at all* (Notify tokens are bound to the group at issuance).
  If this is Messaging API push (`config.to = v.trim()`, L197), the target is a `U…`/`C…`/`R…`
  ID that requires adding the OA to the group and fishing the ID out of a webhook — nothing in
  the UI says which API this is, where the token comes from, or what format `to` expects.
  Contrast: the webhook URL field gets a `nc.urlHint` helper line (L255-256); LINE gets nothing.
- **HIGH — no test-before-save.** "Test" exists per channel in the list (L124-127, inline
  ok/fail), so the engineer must *save a probably-broken channel first*, then test it, then
  **delete + recreate** to fix it — there is no edit flow anywhere (only enable toggle, test,
  delete-with-confirm; `patchChannel` is only used for `enabled` toggles, L44-47). Every SCADA
  peer (Grafana contact points, WIN-911, PagerDuty) puts "Test connection" *inside* the form.
  Worse, the result is a transient "test failed" string with **no reason** — no 401 vs
  invalid-target vs timeout. For LINE specifically a "send test to this group" pre-save is the
  entire verification loop.
- **MED — escalation editor is competent but orphaned.** Levels enforce strictly increasing
  `after_minutes` ≤ 10080 (7 days) client-side (`v` memo, L381-387) with `esc.badLevels` error;
  per-level channel checkboxes + team checkboxes + on-call team select; "+ Add level" auto-fills
  +30 min. Good bones — maps perfectly to Thai practice (night shift LINE group → supervisor →
  plant manager). But: (a) policies are created in a vacuum — nothing shows which alarm rules
  bind to a policy or whether it's used at all; (b) no edit, delete+recreate only; (c) T+0
  behavior ("who gets the alarm first") is implied by the lede, not shown — a preview
  ("T+0 → Line A group · T+15 → supervisor") would close the loop.
- **LOW — list rows are informative.** Name, raw type pill, bound team, enabled toggle,
  `has_secrets` lock badge, test + delete. Type pill and the create-form `<select>` render raw
  enum strings (`email`/`line`/`webhook`/`teams`/`slack`, L20/215) — lowercase "line" where the
  brand is LINE, untranslated.
- **Delivery log is real:** when/channel/kind/target/status/attempts, kind ∈
  test/raised/cleared/escalation/email/vision, status ∈ sent/failed/retrying/suppressed with
  color coding (L144-163). This is exactly the audit trail a plant needs to prove the alarm
  reached the group. Missing: a per-row error reason on `failed`, and no deep link from a
  failed row back to the channel.

## AI-slop flags

- **`nc.secret` key reused across semantically different secrets.** Same label serves webhook
  (HMAC signing secret — genuinely optional, correct term) and LINE (access token — required,
  wrong term). Classic i18n-key reuse smell: the form "looks" parameterized but the label was
  never thought through per-provider.
- **Provider fields are copy-paste symmetric but the docs are not.** Webhook gets a security
  hint; LINE — the channel a Thai user is most likely to pick — gets the least guidance.
- **`email` appears in the delivery-`kind` map (L21)** alongside lifecycle kinds
  (raised/cleared/escalation) — mixing channel type with event kind suggests the enum union was
  stuffed rather than modeled.
- **Empty-state copy is decent** ("Add a channel so alarms can reach a phone") — but it says
  "a phone" while the flagship integration can't tell you how to reach one.
- **No LINE Notify vs Messaging API distinction anywhere** — LINE Notify was retired April 2025;
  real Thai plants are mid-migration and the UI gives no hint which endpoint `secrets.token`
  talks to.

## What works

- Real two-pane layout: channels + delivery log + escalation policies, all backed by queries
  (`notify-channels`, `notify-deliveries`, `esc-policies`, `teams`).
- Per-channel enable toggle, test-send with inline ok/fail, delete with named confirm dialog.
- Delivery log with status taxonomy (sent/failed/retrying/suppressed) and attempt counts —
  genuinely useful for "did the 2AM alarm reach the group" forensics.
- Escalation editor validates monotonically increasing delays, caps at 7 days, supports
  channel + team + on-call routing per level, quick "+30 min" level scaffolding.
- Read-only role gating (`access.whyReadOnly`) so operators see but can't break alert paths.
- The lede names LINE explicitly — the product knows its audience; the form just doesn't follow
  through.

## Top fix

**Make the LINE form honest and self-guided.** Split the secret field per provider: for `line`
label it "LINE channel access token" (Thai: "โทเคนการเข้าถึงแชนเนล LINE"), keep it required and
drop "(optional)"; add a hint block like "สร้างโทเคนที่ LINE Developers Console → Messaging API
→ Channel access token" and for `lineTo` a placeholder `Cxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx`
plus "เพิ่มบอทเข้ากลุ่มแล้วดู group ID จาก webhook / ใส่ userId สำหรับส่วนตัว". Add a
**"Send test message" button inside the form** that POSTs the unsaved config and echoes the API
error (invalid token vs invalid `to`) — that single button is the difference between
first-try success and a dead alert path. Then add edit-in-place (PATCH already exists) so token
rotation doesn't mean delete+recreate.

---

<!-- ====================================================================== -->
## [15/48] File: `round2/agent-06-stops.md`

# Agent: mes-designer — round2

## Pages: /downtimes, /stops

Audited live at `http://localhost:5173` (`?demo=viewer` and `?demo=operator`; shots `s2-downtimes.png`, `s2-stops.png`) plus source at `E:\03_Thesis\webservice\web`.

The collision is total and runs through every layer:

- Route `/downtimes` → `src/features/downtimes/DowntimesPage.tsx` (line 99) — **scheduled alarm-rule suppression windows**. Nav: Monitoring group → Alarms flyout, `snooze` icon (`src/app/nav.ts:67,79`). Page title "Downtimes" (`lib/i18n.ts:713` EN / `:1577` TH). API: `v2 /orgs/{o}/downtimes` (`lib/api.ts:370-376`).
- Route `/stops` → `src/features/production/DowntimesPage.tsx` (line 22) — **the production-stop classification queue**. Nav: Production group, `pause` icon (`nav.ts:159`). Page title "Stops to classify" (`production/i18n.ts:36` EN / `:101` TH). API: `/downtime-events`, `/downtime-reasons`, `POST …/classify` (`production/api.ts:106-120`).

Both components are literally exported as `DowntimesPage` (`App.tsx:65,127` aliases the second). The API uses `downtimes` vs `downtime-events`/`downtime-reasons` in the same org namespace. This is not a label bug — it is a borrowed Datadog idiom (Datadog calls monitor-muting windows "downtimes") dropped into a plant MES where *downtime* already means production stops. ISA-18.2 has the right words: shelving / suppression — "downtime" is not one of them.

**Where the operator clicks to classify a stop:** rail → Production → Stops → queue cards → expand → reason `<select>` + note → Save → `POST classify`. The ONLY entry point in the entire app is the nav item — grep for `/stops` finds one hit (`nav.ts:159`). The OEE pareto's "Unclassified" bucket (`OeePage.tsx:163-176`) is a plain `<li>`, not a link, even though `/stops?needs_reason=…` is already URL-state (`DowntimesPage.tsx:29`). The one deep-link that would close the loop was never wired.

**Where the engineer clicks to mute alarms during maintenance:** rail → Monitoring → Alarms → "Downtimes" (snooze) → "Schedule downtime" dialog; also via Monitors page tab and Alarm Settings → "Manage" link (`AlarmSettingsPage.tsx:205`). Placement is *correct* (alarm config under Monitoring/Alarms). The label is what's wrong.

**The trap:** an operator searching for "downtime" mid-stop finds Monitoring→Downtimes first — the page literally named after their problem — and can *schedule an alarm-muting window* thinking they're recording a stop. Muting alarms during an unplanned stop is the worst possible wrong action. TH makes it sharper: nav label `ช่วงหยุดซ่อมบำรุง` ("maintenance stop period") shares `หยุด` with `การหยุดเครื่อง` ("machine stops"), and "planned maintenance" is itself a legitimate stop-reason category — same words, different objects.

## Score /10 (as HMI)

**5/10.** Individually the /stops queue is ~8 (phone-first, right defaults, real empty state, bilingual reason tree) and /downtimes is ~6 (works but dead facets + generic empty). The seam between them is an operational hazard, not a nitpick: wrong-page navigation is silent — no banner, no cross-link, nothing tells the lost user "are you looking for X?". Minus 2 for zero deep-link pareto→stops (the pareto is the *reason the page exists*).

## HMI/ISA-101 verdicts

- **Naming violates unambiguous-object rule.** Two operationally different objects share the industry's most loaded noun. ISA-18.2 vocabulary for this feature is shelving/suppression; the UI should say *mute*.
- **Grouping right, label wrong.** Job-based IA (Monitoring vs Production) is correct — renaming is cheap; restructuring isn't needed.
- **TH label inconsistency on the same page:** nav/title say `ช่วงหยุดซ่อมบำรุง` but the Monitors tab already says `ช่วงปิดเตือน` (`features/monitors/i18n.ts:54`) — the better name already exists in the codebase; it just isn't the canonical one.
- **Dead facet furniture:** empty data → both facet groups render "No matching values found" plus a generic "No matching results found" table — triple-negative noise where a "No mute windows scheduled. [Schedule one]" state belongs (`DowntimesPage.tsx:139-160` renders `EmptyState` with `slos.empty`, no CTA).
- **Page has no lede.** /downtimes shows tabs + filter, zero explanatory text — vs /stops which states its contract in one line ("Stops longer than the threshold need a reason code").
- **Reason picker flattens the 2-level tree with `— ` text prefixes** instead of `<optgroup>` (`production/DowntimesPage.tsx:157-163`) — screen readers announce the dash; keyboard scan cost grows with tree size.
- **Classify allows note-only save** (`disabled={!reasonId && !note.trim()}`, line 178) → `reason_id: null` POST; ambiguous whether that clears `needs_reason` — a "classify" action that can leave the event unclassified is a state-model smell.
- **Permission gating is good on both:** viewer sees "Operator role required to schedule" / `PermissionNotice`, and classified rows still show reason + timestamp for audit.
- **Pareto title re-exports the wrong word:** card title "Downtime reasons" (`production/i18n.ts:16`) — inside Production it reads fine, but it keeps "downtime" alive as a second meaning of… stops.

## AI-slop flags

- Two unrelated pages both named `DowntimesPage` — the generation tell; nobody reconciled the vocabulary afterwards.
- Datadog-clone IA (Monitors/Downtimes/SLOs/Notebooks) pasted onto MES domain objects; the imported term collides with the domain term and nobody noticed.
- Divergent TH copy for the same surface (ซ่อมบำรุง vs ปิดเตือน) — translated in separate passes with no glossary.
- The `?needs_reason` deep-link parameter exists but nothing links to it — affordance built, wiring forgotten.
- Facet sidebar kept as layout chrome even when it can only ever show empty-state text.

## What works

- /stops is a genuinely well-shaped MES queue: needs-reason default-on persisted in URL, amber = action-needed, duration + age, expandable card, bilingual reason tree, note, optimistic invalidation, viewer gets an explanation instead of silence, empty state explains *when* items appear.
- /downtimes: recurring weekly windows, scope/rule targeting, "All rules" escape hatch, End-now on active rows, 30 s refetch, end-after-start validation, correct home under Monitoring→Alarms and a contextually-correct inbound link from Alarm Settings.
- The Production-group grouping (OEE / Stops / Shifts / Reports) is exactly where an operator looks.
- "Off shift" badge in the top bar — nice touch connecting the page to the shift calendar.

## Top fix

**Rename the suppression surface — keep every layout pixel.** Change `nav.downtimes` + `downtime.title` to:

- **EN: "Mute windows"** (button: "Schedule mute window" → "Mute alarms…"; TH **"ช่วงปิดเตือน"** — already the Monitors tab label, zero new translation, and it removes `หยุด` from this surface entirely). Optionally move the route to `/alarm-muting` with a `/downtimes` redirect.
- **/stops keeps "Stops" / "การหยุดเครื่อง"** — it's already correct and domain-true; page title "Stops to classify" already disambiguates. (ISA-18.2 purists may prefer "Alarm shelving," but "Mute windows" speaks operator, not standard-committee.)

Then wire the loop: make the OEE pareto rows — especially the **Unclassified** bucket — link to `/stops` (the `needs_reason` filter is already default-on). One `<Link>` turns a report into a task queue. Secondary: rename `features/production/DowntimesPage` → `StopsPage` and `prod.dt*` keys → `prod.stop*` so the code stops lying to the next developer; and add a lede + schedule-CTA empty state to the mute-windows page.

---

<!-- ====================================================================== -->
## [16/48] File: `round2/agent-07-reports.md`

# Agent: shift-supervisor — round2

Persona: shift supervisor, lives in shift reports + handover notes — the 06:00/18:00 ritual.
Question answered: does report → notebook → next-shift flow exist? Would คนงานเปลี่ยนกะ use this vs the LINE group?

Evidence: screenshots `s2-reports.png` (demo=viewer), `s2-notebooks.png` (demo=viewer),
`s2-shifts.png` (demo=admin); source read at `E:\03_Thesis\webservice\`
(`backend/app/production/reports.py`, `web/src/features/production/ReportsPage.tsx`,
`web/src/features/production/i18n.ts`, `web/src/features/notebooks/NotebooksPage.tsx`,
`web/src/features/notebooks/i18n.ts`, `web/src/features/production/ShiftsPage.tsx` via page DOM).

## Pages: /reports, /notebooks, /shifts

## Score /10 (as HMI)

**4/10.** The report engine underneath is genuinely real and one of the better-built
features in the product — but the handover *ritual* the pages are meant to serve does not
exist. Three islands: a download page, an empty markdown box, and an OEE config form.
A supervisor at 05:55 gets a CSV and a blank textarea; LINE gets a photo and a voice note.
LINE wins today.

## HMI/ISA-101 verdicts

- **The handover chain is broken at every link.** `/reports` produces a document.
  `/notebooks` accepts free text. `/shifts` configures OEE math. Nothing passes data
  between them: no "generate handover" button, no pre-filled shift summary, no incoming-
  supervisor accept/ack step, no link from open alarms or unclassified stops into a note.
- **The designed flow exists as dead code.** `features/notebooks/i18n.ts` defines the
  entire intended feature — template picker (`nb.tpl.handover` = "Shift handover" /
  "ส่งมอบกะ"), cell types (text / timeseries / alarm-list cells), and seed bodies
  (`nb.seed.handoverText` Thai: "# สรุปกะ - สถานะไลน์: - บันทึกการผลิต: - ปัญหาค้าง
  สำหรับกะถัดไป:" + "## สัญญาณเตือนที่ค้างตอนส่งกะ"). Nothing imports this file — the
  whole `nb.*` namespace is unreferenced; `NotebooksPage.tsx` uses the separate
  `notebook.*` keys. Someone designed the exact ส่งมอบกะ template a Thai plant needs and
  it never shipped.
- **Scheduled delivery is real and correctly timezone-aware** (`reports.py`:
  `report_sweep` → `run_due_reports` → enqueue `send_email` with CSV+HTML attachments;
  org-local `send_time`, weekly day 1–7, monthly day 1–28, `last_run_at` catch-up after
  restart). But setup is admin-only — the viewer screenshot shows the lock banner
  "Admin role is required to schedule reports," and the supervisor persona is typically
  not admin. Channel is email only: **no LINE Notify / webhook**, which is the actual
  delivery rail in Thai factories.
- **Shift report semantics are right**: backend picks the most recently *completed*
  shift (`collect_report` template="shift", `reports.py:208-223`) — correct for a
  06:00 handover of the night shift — and falls back to "(in progress)" otherwise.
- **Report content quality is decent, not great**: OEE per machine + totals + downtime
  rows with "unclassified" fallback; monthly alarms include mean-time-to-ack and
  mean-time-to-clear — the two numbers a supervisor actually reports upward.
- **Print-ability is passable but not ritual-grade.** `render_html` (reports.py:78-103)
  emits a bare printable page: h1, period, bordered 12px tables, neutral colours —
  prints fine. Missing for a real paper handover: site/org/generator header block,
  shift name in large type, **signature lines for outgoing + incoming supervisor**,
  and a "next-shift actions" section. No dedicated PDF export — relies on browser
  print-to-PDF.
- **CSV is done right**: `utf-8-sig` so Excel renders Thai correctly — the one place
  the Thai shopfloor was thought about. Ironically the report *body* itself is
  English-only: column headers ("Availability %", "Downtime", "unclassified") are
  hardcoded English even though the app is fully i18n'd to Thai.
- **/shifts is mislabelled for the ritual**: "Shifts & machines" defines shift windows,
  breaks, non-working days, and tag→machine-state mapping for OEE. There is no roster,
  no "who takes over," no handover log. The name promises staffing; the page delivers
  calendar math.
- **Perf**: first capture of /shifts rendered a fully blank white page at ~10s; a second
  pass with an 8s post-load wait produced content. On a shared control-room PC this
  reads as "the page is broken."
- Top bar does show shift context ("Off shift" badge + clock) — the shell knows about
  shifts even though no page uses it for handover.

## AI-slop flags

- **`prod.csv` / `prod.html` render as literal button labels** in the UI (visible in
  screenshot). `ReportsPage.tsx:85,90` calls `t('prod.csv')`/`t('prod.html')` but the
  i18n bundle defines `prod.asCsv`/`prod.asHtml` (`i18n.ts:49`). Classic generated-code
  key drift; any human QA pass would catch raw keys on the two primary buttons.
- **Two parallel notebook namespaces** (`nb.*` designed, `notebook.*` shipped) — a
  refactor left a complete feature's worth of strings, including the Thai handover
  template, as dead code. Nobody noticed because nothing surfaces templates in the UI.
- "Reconnecting" status pill in demo shots, plus demo org names like
  `pytest-org-b-d1f4011e` — fine for dev, sloppy if this is the demo persona path.
- `/notebooks` for a viewer shows a bare search box over an empty state — an affordance
  vacuum; the empty-state copy promising "start a shift handover from a template"
  (`nb.emptyBody`) isn't even the string that renders.

## What works

- Four right templates for the rhythm of a plant: shift / daily / weekly OEE / monthly
  alarms — matching the 6am/6pm handover, the morning meeting, the weekly review, the
  monthly report to the plant manager.
- On-demand CSV+HTML download, scheduled email with both formats attached, org-timezone
  correctness, restart-safe scheduling — the backend is production-shaped, contract
  tests exist (`tests/contract/test_reports.py`).
- Notebook persistence is real (org-scoped API, shared/private flag, optimistic-
  concurrency conflict handling, markdown render via react-markdown with raw HTML
  disabled).
- Viewer role is correctly blocked from scheduling, with a clear permission notice.
- utf-8-sig CSV — Excel+Thai actually considered.

## Top fix

**Ship the handover workflow that's already designed.** Concrete version:
1. Fix `prod.csv`/`prod.html` → `prod.asCsv`/`prod.asHtml` (one-line key fix; the raw
   keys are on the two main buttons of the page).
2. Import/wire `features/notebooks/i18n.ts` and add "New from template" to Notebooks:
   the ส่งมอบกะ template already exists — pre-fill it with the ending shift's OEE,
   downtime list, and open alarms (the data `collect_report('shift', …)` already
   computes), then add an "accepted by [incoming supervisor]" line. That single flow —
   report numbers → handover note → named acceptance — is what LINE cannot do.
3. Add a LINE Notify/webhook channel alongside email for scheduled reports; an email at
   06:05 goes to the office, a LINE message goes to the people standing on the floor.
4. Add a sign-off header/footer to `render_html` (site, shift, generated-at, outgoing /
   incoming signature lines) so the printed page *is* the handover document.

Until the ส่งมอบกะ seed and the alarm pre-fill ship, a Thai night-shift crew has no
reason to open this: the ritual lives in the LINE group because LINE is where the
people, the photos, and the acknowledgement already are.

---

<!-- ====================================================================== -->
## [17/48] File: `round2/agent-08-rulebuilder.md`

# Agent: controls-engineer — round2
## Pages: /admin/rules/new, /admin/rules
## Score /10 (as HMI): 6/10

Previous audit said 7/10. After reading the actual rule payload in `RuleCreatePage-*.js` I'm docking a point: the form is polished, but the *model* underneath it stops at threshold + deadband and omits the temporal controls that decide whether this thing floods an operator at 03:00. This is an alerting form dressed as an alarm configurator.

## HMI/ISA-101 verdicts

**The #1 chattering fix is absent: no on-delay / off-delay (hold-down) anywhere.** Confirmed in code — the create payload is `{name, tag_id, kind, threshold, stale_s, window_s, deadband, severity, enabled}` (RuleCreatePage chunk). No `on_delay_s`, `off_delay_s`, `min_duration`, `hold`. Every alarm engineer's mental checklist is: threshold → deadband → **on-delay** → off-delay → priority → routing. Two of those six don't exist in the data model. Worse, the deadband helper text says "Stops flapping" — it doesn't. Deadband stops *clear/reset flapping* (re-arm). On-delay is what stops *momentary-spike trips*, which is the dominant nuisance-alarm mechanism on noisy analog tags (flow, level with splashing, pressure during valve strokes). ISA-18.2 / EEMUA-191 both name deadband + on/off-delay as the standard chattering countermeasures; shipping deadband alone and labeling it the flap-stopper teaches the wrong mental model.

**Preview is an echo, not a backtest.** The right-rail "Rule preview" renders `name / kind / tag path / "> 0.5 ± 0 unit" / severity badge` — it reads the form back to me (verified: RuleCreatePage aside renders `trendPreview_*` / `stalePreview` / `> {thr} ± {db}` strings, zero history queries). What I actually need before clicking Create is the thing every rationalization worksheet asks: *"had this rule been live over the last 24h/7d, how many times would it have activated?"* One line — "≈14 activations/day" — turns threshold guessing into engineering. The platform already has the timeseries; the preview is burning screen space on data I just typed.

**Method selection: genuinely discoverable, two caveats.** Six radio cards with plain-language one-liners ("Trigger when a tag stops reporting for a period") beats the dropdown-of-jargon most HMIs ship. But: (a) no HiHi/LoLo second tier — `kind_hihi`/`kind_lolo` strings exist in i18n ("High-high", "Low-low") yet only `hi/lo/stale/roc/anomaly/forecast` are creatable. ISA practice wants warn + trip levels per tag; achievable only as two separate rules on the same signal, and nothing in the UI teaches that pattern. (b) Vocab drift confirmed: wizard says "detection method" (`stepMethod`), list column says "Condition" (`ruleKind`), API field is `kind`, and kind `roc` renders as "Change". Four names, one concept. Pick "Condition" everywhere.

**Immutability is a real workflow wound.** List actions are `enabled` toggle (`patchRule` sends only `{enabled}`) + "Routing" (notify editor via `setRuleNotify`) + Delete. Threshold, deadband, kind, signal — all locked. To trim a threshold by 0.2 you delete the rule and rebuild it, orphaning its history. i18n still carries dead `editRule`/`saveRule` strings — the feature was specced and dropped.

**List table is a ledger, not a management view.** Columns: NAME / SIGNAL / CONDITION / THRESHOLD / DEADBAND / SEVERITY / ENABLED. No fires-in-24h, no last-fired, no state, no shelving status. When the tag lookup misses, SIGNAL falls back to a truncated raw UUID (`ff2abc7e-b4ed-4f21-bbaf-362b3fdf…`) — meaningless to anyone; should render "⚠ missing tag" not a hex fragment. Code does try `r.path` first, so this is a graceful-degradation bug not a design choice, but it's on screen in the demo.

**Header copy is good.** "Limits the alarm engine evaluates on live values. Changes apply without a restart" — states the hot-reload contract an engineer cares about, in one line.

**Severity: 3 tiers (Advisory/Warning/Critical).** Acceptable minimum. Missing: per-priority response-time/operator-action fields that 18.2 rationalization requires — fine to defer, flag the roadmap.

## AI-slop flags

- **Dead `editRule` / `saveRule` i18n strings** — UI was generated for an edit flow that was never wired. Ghost feature.
- **`kind_hihi` / `kind_lolo` translated in two locales, uncreatable** — vocab generated ahead of capability.
- **Enabled toggle renders "nabled"** — the label's leading "E" is clipped behind the toggle pill (visible in s2-rulenew.png). A padding regression nobody looked at.
- **"Stops flapping" deadband hint** — confidently wrong claim; reads like generated copy that was never reviewed against alarm-system practice.
- **UUID fallback in SIGNAL column** — classic "render the foreign key" when join data is absent.

## What works

- 3-step structure (method → define → notify) matches how you'd actually walk a junior through it.
- Method cards are discoverable, jargon-free, and each says its trigger condition in one sentence.
- Unit-aware threshold + deadband with a real explanation, placeholder "e.g. Belt speed low…" shows naming convention.
- Inline validation with field focus on error (`find(e=>r[e])` → focuses first invalid field) and sticky error bar.
- `stale` as first-class kind with its own seconds field — sensor-death detection is genuinely useful.
- Conditional fields: `window_s` only for windowed kinds, `stale_s` only for stale — form adapts to method instead of showing every knob.
- Notify routing separated into step 3 and editable post-create (channels/teams/on-call/on_clear).
- Hot-reload promise ("Changes apply without a restart") — engineers will trust rules they can flip live.

## Top fix

**Add `on_delay_s` (and ideally `off_delay_s`) to the rule model and form, and replace the preview echo with a 24-hour backtest count.** If forced to pick one: the backtest. It costs one timeseries query and gives the engineer the number that decides every other parameter — "this threshold would have paged someone 40 times yesterday" stops a bad rule before it exists. The delay fields are the correctness gap; the backtest is what makes the tool an alarm configurator instead of a notification form.

---

<!-- ====================================================================== -->
## [18/48] File: `round2/agent-09-audit.md`

# Agent: compliance-designer — round2

## Pages: /activity, /admin/audit

Two surfaces claim the same job. Only one can be the trail of record, and right now
the UI does not say which — that ambiguity is itself a compliance defect.

**Trail of record: `/admin/audit`.** It is the only surface backed by durable,
server-side, ordered, integrity-marked data: monotonic `SEQ · HASH` (#21, #20, #19…),
full timestamps (`Oct 19, 2026, 5:39:24 PM`), actor column (`demo-admin`), typed
targets, filters, and CSV export. `/activity` is a session-scoped notification inbox:
no WHO column, a "Mark all read" control (read-state is inbox semantics, never audit
semantics), it wiped to "No events" while the top bar showed `Reconnecting` — meaning
the page state tracks the websocket, not history. Yet its subtitle reads
**"Everything that happened on the line, in order."** That sentence is a false claim
of record: a refresh or a dropped socket contradicts it. `/activity` masquerades as
an audit view and must not be trusted as one.

Design consequence of the overlap: whichever screen an operator screenshots at
2 a.m. becomes the de facto record. `/activity` sits under **Monitoring** (high-traffic
nav); `/admin/audit` is buried under **Admin → Access**. The pretty, accessible,
labeled "everything in order" page is the ephemeral one; the real chain-of-custody
table is the hidden one. That is inverted. Worse, `/activity`'s footer even links to
"Audit log" — the product knows they are different things but presents them as peers.

What makes an audit log trustworthy, and where this one stands:

- **Immutable display** — monotonic sequence numbers, append-only ordering, no
  client-side mutation affordances. `/admin/audit`: PASS (seq column, no edit/delete
  UI). `/activity`: FAIL ("Mark all read" mutates state; refresh wipes).
- **Hash verify** — a hash you cannot recompute is decoration. The table shows
  truncated hashes (`f188091fdf…`) with no copy-full-hash, no "verify chain" control,
  and the header claims "tamper-evident audit chain" without offering evidence.
  Trust theater until verification exists.
- **Resolved names** — TARGET renders raw UUIDs
  (`incident_id: 2688c67e-2662-4417-b693-ae37304f6ba4`, `device_id: 74d9f434-…`).
  An auditor cannot read `camera_id: 465b6da6-eb37-11ea-a377-84a0dbb5fb` as an
  object. Resolve to `incident "Overheat on Line 2"` / `camera "CAM-North-03"`,
  keep the ID as a tooltip/copy affordance.
- **Honest caps** — "Showing 21 of 21 entries in this range" is the right pattern,
  but the fetch-5000/render-300 caps are silent. When the log exceeds them the page
  will lie by omission. Show `Showing 300 of 5,142 — narrow the range or export CSV`.
- **Complete localization** — WHAT renders the key twice (`incident.declared` /
  `incident.declared`) when a translation is missing. Doubling raw i18n keys in a
  legal-record column reads as generated, not authored.

## Score /10 (as HMI)

**4/10 for the pair.** `/admin/audit` alone would be ~6 — right bones, wrong finish.
`/activity` alone would be ~3 — clean empty state, dishonest contract. Together they
lose extra points because the two surfaces actively undercut each other's authority.

## HMI/ISA-101 verdicts

- **Display must reflect reality**: `/activity` showed "No events" while `/admin/audit`
  held 21 rows for the same org — including `incident.declared`, `incident.resolved`,
  `device.created` from minutes earlier. Two screens, two contradictory "truths." ISA-101's
  core principle (the operator's mental model must match plant state) is violated at the
  record layer, not just the process layer.
- **Hierarchy of information**: severity-neutral gray table is fine and consistent with
  high-performance HMI restraint; the failure is structural — the authoritative surface
  is lower in the nav hierarchy than the ephemeral one.
- **Status indication**: the amber `Reconnecting` chip is honest and good — but on a
  page titled "Activity" it quietly admits the feed is volatile, which the subtitle denies.
- **Empty-state semantics**: "No events" means "nothing since this websocket connected,"
  not "nothing happened." It should say so.

## AI-slop flags

- WHAT column duplicates the raw key when the translation is missing
  (`incident.acknowledged` rendered twice, bold + dim) — a fallback path nobody designed.
- Raw UUIDs in TARGET — developer identifiers leaking into a compliance surface.
- Subtitle copy: "Everything that happened on the line, in order" is marketing phrasing
  on a volatile inbox; "Export the tamper-evident audit chain" claims a property the UI
  never demonstrates (no verify, truncated hashes).
- `FROM` pre-filled `10/12/2026` next to an empty `TO` `mm/dd/yyyy` placeholder —
  inconsistent date-range defaulting.
- Truncated hash display (`f188091fdf…`) with ellipsis but no expand/copy — slop-shaped
  integrity.

## What works

- `/admin/audit` has the correct schema: WHEN / WHO / WHAT / TARGET / SEQ·HASH. Monotonic
  sequence numbers are exactly right for chain-of-custody.
- Filter set is real: FROM/TO dates, ACTION dropdown, free-text "who, what or target"
  search, CSV export — this is what an auditor actually asks for.
- "Showing 21 of 21 entries in this range" is honest count language; extend it to caps.
- `/activity`'s TYPE rail (Alarm / Alarm updates / Insight / Command / System / Sign-in)
  is a sensible notification taxonomy — as an inbox, not a ledger.
- Org/role context card on the audit page ("Your role here: Admin — …manages…the audit
  log") correctly ties the surface to permission.

## Top fix

**Declare `/admin/audit` the sole trail of record and strip `/activity` of its audit
pretense.** Concretely:

1. Rename/relabel `/activity` to "Notifications" with subtitle "Since this session —
   not the system of record. See Audit log." Deep-link each item to its audit row.
2. On `/admin/audit`: resolve TARGET UUIDs to human names (ID on hover/copy), render
   the full hash on demand with a "Verify chain" control, translate or remove the
   duplicated WHAT key, and make caps explicit (`Showing 300 of N — export CSV for all`).
3. Add a cross-link from every notification/alert surface into the corresponding audit
   entry, so the durable trail is always one click away and never duplicated by a
   session-scoped look-alike.

Until then, the product has a page that looks like the record and a record nobody
finds — the worst possible arrangement for compliance.

---

<!-- ====================================================================== -->
## [19/48] File: `round2/agent-10-vision.md`

# Agent: vision-systems-designer — round2

## Pages: /infrastructure/cameras (?demo=admin), /infrastructure/events (?demo=viewer)

Evidence: `s2-cameras.png`, `s2-visionevents.png` (skeleton-stuck), prior `r2-infraevents-demo.png` (page proven working under "Demo" org), current chunks `CamerasPage-DKPx21id.js`, `EventsPage-C-cX3ELV.js` decompiled.

## Score /10 (as HMI)

**6/10.** This is a good *configuration console* for a vision pipeline and a nearly-good *review queue* — but it is not yet a vision HMI. The defining artifact of the craft — the annotated frame — is absent everywhere. No bounding box is ever drawn on any surface in the product. Operators can *configure* detection (per-class min_score, class colours, model pin, ROI) but can never *see* detection. The trust loop ("the model says gravel — show me the box so I can believe it") is unclosed.

## HMI/ISA-101 verdicts

**What a detection tile must show vs. what this tile shows** (tile = `L()` component, cameras page lines ~130–205 of prettified chunk):

| Required | Present? |
|---|---|
| Live frame | Partial — plain `<img>` fed by `streamUrl()`, re-polled every ≥5 s (`setTimeout(i, f?5e3:E())`, `E()=Math.max(5e3,…)`); it is a polled snapshot model, not monitored video |
| **Frame age / freshness** | **No.** Worst omission. A frozen frame and a live frame are pixel-identical. ISA-101 requires every data element to carry quality/timestamp; a vision tile without "frame 0.4 s ago" fails that outright |
| Detection overlay (boxes, class, conf) | **No.** Zero canvas/overlay code — grep for `canvas|bbox|drawImage` across both chunks returns only checkboxes. The per-class colour pickers configure colours that are never painted |
| Per-class confidence / live det count | No. No dets/min, no last-class chip, no sparkline |
| Stream state | Yes — `waiting` / `streamLost` / `disabled` / `error` + `status_detail` text is real and correct |
| Model health | Partial — `model_state` ready/loading/error, `engine · latency_ms` when ready. No live FPS (only static `bench_fps` on a pinned-version match), no drop counter |
| Stream health | No bitrate/dropped-frame/stalled-frame indicator; `streamLost` only fires on fetch error, not on a frozen-but-open stream |

**Is the ROI/material panel honest? Mostly yes — one lie.**

- Honest: schema-driven slider ranges (`u.data.ranges`), unit hints, live feedback line (`mat.live: gate present/empty · last truck: <decision>`), snapshot refreshes every 8 s, ROI rect drawn over the still, **dry_run default with an explicit warn banner when turned off** (`mat.dryRunOff`) before PLC writes, writable-tag filtering for PLC outputs. That's real engineering, not theatre.
- The lie: **CLAHE / gamma / brightness sliders tune blind.** The preview `<img>` is the raw snapshot — the preprocess pipeline is never rendered. An operator sets gamma to hit a contrast target they cannot see. Same class of lie as "min_score colours": config UI promising visual feedback it never delivers.
- ROI editing = four numeric inputs L/T/R/B. No drag-draw. Workable but hostile; an operator standing at a conveyor will not type normalized coordinates.
- ROI overlay is a dashed rect with `shadow-[0_0_0_9999px_rgba(0,0,0,0.55)]` mask — good, legible.

**Review queue (C/W verdicts): good bones, one display-level slop.**

- Real: C/W keyboard verdicts guarded against input focus, ↑/↓ row navigation, corrected-class picker (`pickWrong` select), bulk correct/wrong, outcome filter (reviewed/unreviewed/correct/wrong), cursor pagination, **`Export ZIP` of wrong verdicts — that's the retraining loop, and it's the single best thing on the page.**
- Bad: the verdict surface shows a *raw snapshot plus `JSON.stringify(q.detail)` in a `<pre>`* — `{"rule":"mass_vote","frames":279,"margin":1,"params":{...}}`. A QC operator judging "did the model get this right" is shown the machine's internal deliberation and an unannotated photo. The boxes and ROI state at decision-time are exactly the evidence needed, and they're not rendered.
- Bad: score column renders `100%` on every "Truck decision" row — a decision object wearing a detector-score costume. `Class — ` and `Score 100%` on a *decision* invites misreading.
- Blocked events show `blocked_reason` in danger tone — good.

## AI-slop flags

1. **Demo seed has zero cameras.** The flagship vision page is an empty state in demo mode — second round running. Every reviewer of this page sees "No cameras on this gateway" and nothing else. All the round-1 work (model pin, class colours, ROI) is invisible to anyone who doesn't hand-create a camera.
2. **`?demo=viewer` events page = skeletons forever** (still skeleton after 35 s). Whatever fails (bootstrap, org, or a hung query) there is **no error and no empty state** — infinite shimmer is the failure mode. Skeletons that can persist forever are a slop signature.
3. **Persistent "Reconnecting" pill** in the header while pages render fine — the SSE badge is permanently in its worst state in demo, training users to ignore it (alarm-flood dynamics).
4. **Raw JSON `<pre>` in the event detail** — developer payload shipped as UX.
5. **`Score 100%` on decision rows** — honest-looking number, wrong semantics.
6. **Colour pickers for classes whose colours are never rendered** — the most literal AI-slop item: UI for a feature that doesn't exist yet.

## What works

- Real stream lifecycle (`waiting`/`streamLost`/`streamLost`-retry/`disabled`/`error + status_detail`) — states are distinct and honest.
- Model pin edge/cloud/auto + version picker filtered to `status==='active'` + `bench_fps` labelled as a bench figure, not a live one.
- Per-class min_score sliders with range validation (`0.05–0.95`) and presets — the config *depth* is genuinely right.
- Material panel: schema-driven ranges, live gate feedback, dry_run guard, writable-tag filtering, save/reset with confirm state.
- Events: thumbnail per row, kind taxonomy (`rule_fire/blocked/dry_run/alert_object/material`), C/W + arrows keyboard loop, corrected-class capture, bulk verdict, export-wrong-for-retrain.
- RBAC is honest: viewer gets "View only — admin required" banner and disabled fieldsets rather than silently-failing controls.
- Empty-state copy is good: "Add an RTSP camera, or upload a short clip to use as a demo camera."

## Top fix

**Draw the detections.** One canvas (or server-annotated frame) over every tile and every event snapshot: boxes in the configured class colours, `class conf%` labels, ROI outline, plus a frame-age badge (`frame 0.4s ago` → stale-state grey when >2× poll interval) and a live `dets/min · fps` chip. This single change converts the page from a settings console into a vision HMI — it makes min_score, colours, ROI, and the C/W review loop all become *verifiable* instead of trust-me config. Pair it with seeding ≥2 demo cameras (one `ok`, one `streamLost`) so the work is visible. Until then the QC operator's actual question — "is it seeing what I think it's seeing?" — has no answer anywhere in the product.

---

<!-- ====================================================================== -->
## [20/48] File: `round3/agent-01-oee.md`

# Agent: oee-tpm-consultant — round3

## Pages: /oee

## Score /10 (as HMI)
**5.0 / 10** — down from 6.5. Every prior-round defect is still in the code, and the demo now renders a dead empty state ("No machines are mapped yet") for both `demo=viewer` and `demo=admin`, so the page cannot even demonstrate its (already thin) populated layout.

## HMI/ISA-101 verdicts

**The 10-second test: FAIL.** Even fully populated, this page does not answer "where are we losing?" in 10 seconds:
- The four headline cards (A, P, Q, OEE) are equal-weight, equal-style tiles (`web/src/features/production/OeePage.tsx:122-127`). OEE is not visually primary; there is no target marker, no 85% world-class reference, no delta vs. previous period, no red/amber threshold color. A plant manager sees four gray-label numbers and learns nothing about which of the three loss families is bleeding.
- Between the KPIs and the loss data sits a 10-column per-machine table (`OeePage.tsx:129-155`) — drill-down data placed ahead of the answer. The pareto (the actual "where" answer) is pushed below the fold in a 2-col grid (`OeePage.tsx:157-179`).
- In the demo the answer is literally absent: verified via CDP DOM dump — body text is "No machines are mapped yet / Map a machine's state and count tags on the Shifts page to see OEE here." (screenshot `s3-oee-admin.png`; DOM dump `s3-oee-dom.json`).

**Unclassified downtime: NOT surfaced.** Backend groups `reason_id IS NULL` into a `reason_id: None` bucket (`backend/app/production/oee.py:1070`). The frontend renders it only as a fallback *label* — `r.name_en || r.name_th || r.code || t('prod.unclassified')` (`OeePage.tsx:166`) — with the same blue bar as real reasons. In TPM practice the unclassified share is itself a KPI (it measures data quality; >10% unclassified invalidates the pareto). It should be a flagged/hatched bar plus a separate "% unclassified" indicator, not a silent line item.

**Pareto is not a pareto.** Backend computes `cum_pct` per item (`oee.py:264-273`) — the frontend throws it away (`OeePage.tsx:163-176` uses only `r.pct` for bar width). No cumulative line means no 80/20 cut-off, so the "which two reasons kill 80% of our downtime" question is unanswerable at a glance. All bars identical `bg-blue` — the #1 loss does not pop.

**No loss waterfall / no A/P/Q decomposition.** A real OEE page shows the loss tree: Planned time → Availability losses → Performance losses → Quality losses → Valuable operating time (the classic TPM "six big losses" waterfall). Here A/P/Q are three disconnected percentages; the multiplicative relationship (OEE = A×P×Q) is invisible. A manager cannot see whether a 62% OEE is a stops problem or a speed problem without doing mental math.

**No shift comparison.** There is a single-select shift *filter* dropdown (`OeePage.tsx:103-107`) but no side-by-side per-shift A/P/Q. Shift-to-shift variance is the standing agenda item of every TPM morning meeting; filtering hides it. Worse, the pareto query doesn't even accept the shift param (`oee.py:1049-1053` — device/from/to only; `OeePage.tsx:74` doesn't pass shift), so picking a shift silently leaves the pareto stale.

**Trend ignores the range selector and isn't a chart.** `trendQ` queryKey omits `range` (`OeePage.tsx:81`) and hardcodes `weeks=8` — switching Last 24h ↔ 30d never refetches or re-buckets it. And it's a 5-column *table* of ISO week numbers (`OeePage.tsx:183-193`), not a chart. Nobody reads a table of weekly percentages to spot drift.

**Raw-seconds bug persists.** `Math.round(m.run_s)}s` / `planned_s` (`OeePage.tsx:144-145`) still render e.g. "78432s" instead of "21.8 h" — a credibility-killer on a production page.

**ISA-101 style:** the page is clean, low-saturation, tabular-nums mono — fine foundation. But it's a *report layout*, not an HMI hierarchy: no emphasis order, no status encoding anywhere (nothing is ever out-of-normal visually), and the empty-state icon (gauge) plus helper text is the only thing with any visual hierarchy.

## AI-slop flags
- Raw `s` suffix durations — a formatter TODO nobody wrote; smells of generated code never reviewed against real numbers.
- "Weekly trend" implemented as a table because "design system has no chart lib dependency" (comment `OeePage.tsx:3`) — constraint-shaped design presented as product; the pareto's CSS bars prove a simple inline SVG cumulative line was equally possible.
- Backend returns `cum_pct` the UI never uses — spec-complete API, cosmetically-complete UI.
- Symmetric 2-col card grid, identical FactorCards, uniform blue bars — the classic generated-dashboard look: everything present, nothing prioritized.
- Filters that don't fully apply (shift absent from pareto; range absent from trend) — UI control props wired for appearance, not function.

## What works
- Filter state lives in the URL (`useSearchParams`, `OeePage.tsx:39-45`) — shareable views, correct pattern.
- Empty state is genuinely good UX: names the missing precondition and points to the fix location (Shifts page) rather than a bare "no data".
- Backend pareto is properly ranked with cumulative share and groups unclassified correctly — the data model is right; only the rendering is lazy.
- A/P/Q/OEE totals + per-machine rows + reason pareto + weekly trend is the correct *set* of sections — the skeleton of a real OEE page exists.
- Tabular mono numerals, muted palette — no alarm-color abuse, honest ISA-101-adjacent restraint.

## Top fix
**Reorder the page around the loss story, and render the waterfall.**

1. Top band: one big OEE number with an 85% world-class tick + delta-vs-previous-period chip, then an A/P/Q waterfall bar (Planned time → −Availability loss → −Performance loss → −Quality loss → = Effective time). This one element answers "where are we losing" in <3s and is ~60 lines of the same CSS-bar technique already used for the pareto.
2. Convert the pareto card to a true pareto: bars + cumulative-% line using the already-returned `cum_pct`, top reason emphasized, and render the `reason_id == null` bucket hatched/distinct with an "unclassified: N min (X%)" callout above it.
3. Demote the machine table below the pareto, format durations as `h:mm`, and add a shift-comparison strip (per-shift A/P/Q bars) or at minimum wire `shift` through to the pareto query and `range` into the trend query key.
4. Turn the weekly table into an actual bar/line trend that re-buckets with the range selector.

If only one change ships: **the waterfall + cumulative pareto** — those two are the entire difference between this page and what a TPM board actually shows.

---

<!-- ====================================================================== -->
## [21/48] File: `round3/agent-02-metrics.md`

# Agent: instrument-engineer — round3

## Pages: /metrics, /query

## Score /10 (as HMI)

**3/10 combined** (/metrics 4, /query 2). Right shape, wrong semantics. An instrument engineer asking "is my sensor lying?" gets a table that cannot rank, sort, or even define staleness correctly — and a "query" tool whose answer is a thumbnail with no axes.

New this round: **/metrics is unreachable as a URL.** `GET http://localhost:5173/metrics` returns bare nginx `404 Not Found` — the SPA route is shadowed by an nginx `location` (almost certainly a Prometheus-scrape guard; the backend's real Prometheus endpoint lives on `webservice-backend-1` :8001). The page only renders via client-side nav (clicking the sidebar link works — verified, screenshot `s3-metrics-spa.png`). Direct load, refresh, bookmark, and "paste this link in the incident chat" all 404. For an HMI, a route that dies on F5 is a deployment defect, not a quirk.

Verified live this round (Playwright, `?demo=viewer`, screenshots `s3-metrics*.png`, `s3-query*.png`; source `MetricsSummaryPage-YZLOjwal.js`, `QueryPage-DKwwPXEf.js` fetched from the running container):

- **/metrics, pytest org:** `GET /api/v1/orgs/{id}/sites/{id}/tag-stats` → **200**, renders empty state "No tag history yet — History starts recording once a gateway ships tag samples" + Learn more. The lede line **does render now**: "0 signals, 0 with no stored samples" — prior claim it never renders no longer holds.
- **/metrics, Demo org:** after org switch, **no tag-stats request was ever observed**; the table sits in skeleton rows indefinitely. Prior round reported a 500; now it silently skeleton-locks — either way there is no error surface, no timeout, no retry prompt on this path.
- **/query, both orgs:** the `siteTags` call (`/sites/{id}/tags`, `enabled: !!orgId && !!siteId`) **never fires** — watched network for 12 s, zero tag/history requests. Signal dropdown permanently shows only "Choose a signal". The query page as shipped is a dead end in this deployment.

## HMI/ISA-101 verdicts

- **"Stale" is defined as `count === 0`** (`MetricsSummaryPage`: `M = items.filter(e => e.count === 0)`). That is "never reported", not "stopped reporting". A sensor that flatlined an hour ago with 50 k samples in the window is **not flagged stale** — the single most common field failure is invisible. The lede's "N with no stored samples" conflates commissioning gaps with live signal death.
- **No health ranking, no sorting, no stale-first.** Columns `signal | min | max | avg | count | value | gaps | updated` render in API order, sliced at 100 with "show more". Headers are inert `<th>` — no click-sort. For "is my sensor lying" triage you need sort-by-updated ascending and sort-by-gap% — neither exists.
- **No gap %.** Gaps render as `count · max_gap_s` (e.g. "3 · 142s") in caution amber — but with no window length and no expected-rate denominator you cannot tell a 99 %-dead tag from one that hiccuped once. ISA-101 wants severity at a glance; this needs mental math per row.
- **No quality dimension at all.** tag-stats carries no bad-quality/uncertain count, no flatline/variance indicator. The three classic liar-sensor signatures — frozen value, bad quality, stale timestamp — get one weak proxy (gaps) out of three.
- **Units only on the `value` column** (`e.unit` appended there); min/max/avg/count are unitless floats. Confirmed in code, not just prior report.
- **Grouping is a path heuristic**: the "Equipment group" facet keys on `path.split('/').slice(-2,-1)` — second-to-last segment. Any tag without a ≥2-segment path falls into `—`. Looks ISA-95-ish, isn't a real asset model.
- **/query result is a garnish plate.** Stat chips (count/min/max/avg/last, 20 px mono) + one `h-24` (96 px) full-width SVG sparkline, `preserveAspectRatio="none"`, **no axes, no gridlines, no units, no timestamps, no point table**. The only way to see an actual sample is CSV export (a fetch with Bearer token → `saveBlob`).
- **Bad-quality rows silently vanish** (`v: e.q === 'good' ? Number(e.v) : NaN`, then `filter(isFinite)`) — yet `count` still counts them. All-bad-quality data shows `count: 200, min/max/avg/last: —`, empty sparkline. A tool for verifying data trust hides distrust evidence.
- **4 presets only, max 8 h, `from = now − preset`.** No custom range, no absolute start/end — "what did that sensor do yesterday at 14:00" is unanswerable.
- **No URL state** — tag/range/agg are `useState` only. Can't link, can't refresh, can't diff two runs.
- **Mojibake `emptyLabel` appears fixed** — current chunk has a literal `—` and it renders correctly in the Demo screenshot.

## AI-slop flags

- **Route name collision:** naming a UI page `/metrics` — the one path every Prometheus-era reverse proxy is taught to guard — then shipping an nginx config that 404s it. Textbook "works in `vite dev`, untested through the front door."
- **Semantic slop:** calling `count === 0` "stale" in the lede — plausible-sounding, operationally wrong.
- **Decorative analytics:** a `preserveAspectRatio="none"` sparkline stretched across 1280 px with zero axes reads as "we have trending" without being one.
- **Inconsistent quality accounting:** bad samples counted in `count`, excluded from stats — internally incoherent by construction.
- **Brittle cleverness:** equipment grouping by "second-to-last path segment" — an LLM-flavored shortcut around not having an asset hierarchy join.
- **i18n namespace drift:** `msum.*` vs `px.query.*` for sibling pages; `evx.shownOf`/`evx.showMore` borrowed from a third namespace.
- Permanent skeleton under Demo org = loading state with no failure path.

## What works

- tag-stats returns 200 with a genuinely good empty state (icon, cause, docs CTA) on an org with a site but no data; error state component (`isError → retry`) exists in code even if the Demo path never reaches it.
- Lede now renders ("N signals, M with no stored samples") — honest summary line.
- Row expand → detail line + **deep link to `/trends?tags=<path>`** — the one correct integration; this is the right escape hatch pattern.
- 30 s `refetchInterval` on tag-stats — auto-refresh without manual reload.
- /query has a `truncated` notice, a CSV export with failure toast, and an `isError → retry` path — scaffolding is there, the table isn't.
- Sidebar client-side nav to /metrics works; nav cluster labels (Metrics → trends/metrics-summary/query) are sensible.

## Top fix

**Unbreak `/metrics` at the proxy, then give the table health semantics.** Rename the route (`/signals`, `/tag-health`) or delete the nginx `location /metrics` shadow — a page that 404s on refresh fails before it starts. Then add: sortable headers defaulting to `updated` ascending (stale-first), time-based staleness (`now − last_ts > expected interval`, not `count === 0`), and a `gap %`/`coverage` column — that turns this from a stats dump into an instrument-health board. For /query: ship a timestamped results table with a quality column next to the sparkline; every historian quick-lookup (PI Vision ad-hoc, Ignition Tag History, Canary, Grafana table panel, InfluxDB Data Explorer) leads with rows of `ts | value | quality` — the sparkline is the garnish, not the meal. Without it the page answers nothing a chart-shaped picture can't fake.

---

<!-- ====================================================================== -->
## [22/48] File: `round3/agent-03-logs.md`

# Agent: ot-it-engineer — round3

## Pages: /logs, /traces

Verdict up front: **during an edge outage this console cannot do the two things I actually need — tail the stream and follow a command across the edge↔cloud boundary.** The plumbing underneath is real (server-side `edge`/`level`/`q` filtering, cursor pagination via `next_cursor`, `limit:200`), but the workflow layer on top is a static log *browser*, not a debugging surface.

Evidence: `shots/s3-logs.png` (page loads, level facets all at **0**, honest empty state "No log lines yet… once an edge starts shipping them", top-bar shows amber **Reconnecting**), `shots/s3-traces.png` (`/traces?demo=viewer` landed on `http://localhost:5173/` — Overview — with no notice). Code-confirmed in `LogsPage.js` and `traces.js` bundles.

## Score /10 (as HMI)

**4/10.** Real backend filtering and honest empty states earn points; the absence of tail/follow, time navigation, staleness indication, and cross-correlation means it fails its primary incident scenario. As a journalctl/Seq-style tool it is a read-only archive viewer with a misleading nameplate on the neighbor page.

## HMI/ISA-101 verdicts

- **"Quiet vs. down" ambiguity is the cardinal sin.** The top bar knows the realtime link is broken (*Reconnecting*), but the Logs page gives no per-edge staleness ("last line received 6m ago"), no paused/offline marker on the list itself. During an outage, zero rows is indistinguishable from zero visibility. An HMI that can't answer "is it silent or am I blind?" fails situation awareness at level 1.
- **No follow/tail mode — code-confirmed.** The logs `useInfiniteQuery` has **no `refetchInterval`** and only pages *backward* via cursor (`fetchNextPage` → older rows). There is no `journalctl -f` equivalent; an operator would hand-refresh during a storm. Ironically `traces.js` *does* poll (`refetchInterval: 15e3`) — the pattern exists in the codebase, just not where it's needed most.
- **No time navigation.** The API call is `{edge, level, q, cursor, limit:200}` — no `since`/`until`. No "jump to 14:32 when the gateway dropped", no relative-time toggle, no Δt column. Correlating an outage window means scrolling.
- **Un-debounced per-keystroke search — code-confirmed.** `onChange` writes `u` straight into `useState`, and `u` sits in the queryKey (`['edge-logs', r, p, k.join(','), u]`). Every keystroke = new server round-trip. Typing "timeout" fires 7 queries. Under load this self-DDoSes the logs endpoint.
- **Facet counts lie politely.** `count: j.filter(t => t.level === e).length` — counts computed over *loaded rows only*. A fresh page shows debug/info/warn/error all at 0, which reads as "no errors" but means "nothing loaded". Prior round flagged the honest caption; it needs to survive.
- **Level coloring is correct ISA-101 behavior:** warn→caution amber, error→danger red, muted ink for debug/info — severity is preattentively scannable. Monospace 12px table with time/level/edge/source/msg columns is a reasonable log-line presentation.
- **/traces silently redirects to Overview when flag-gated.** Deep-linking an operator to a flag-off route dumps them on `/` with zero explanation — a discoverability and trust hazard during an incident. Even a "Traces requires feature X" toast beats a silent teleport.

## AI-slop flags

- **`/traces` is mislabeled — it is a command audit ledger, not traces.** `traces.js` calls `i.siteCommands(r, g, 50)` and renders columns `colId | colStatus | colIssued | colActor` with an expandable detail (`i.siteCommand`). No spans, no parent/child, no durations — and per prior round, events lack **Δms**, so the edge-ack→execute→complete latency (the whole point of tracing at the boundary) is invisible. Borrowing OTel vocabulary for a command table invites exactly the wrong mental model. Rename it "Commands"/"Command audit" — especially since it sits under an "APM" nav grouping, compounding the mislabel. (Also possibly redundant with the separate Commands page.)
- **Liveness language without liveness.** Prior round found a "Live" badge; the site subtitle here says "Sorting line 1, *live*" while the log surface can't stream and the header admits *Reconnecting*. Marketing tempo on a diagnostic page.
- **SaaS-onboarding chrome on an OT console:** "Learn more ↗" doc link inside the empty state; "Getting started · 4 of 6 done" checklist on the Overview the redirect lands you on.
- **Facet counts that mimic Seq/Splunk faceted search but are client-side decoration** (loaded-rows only) — looks like observability tooling, computes like a demo.
- **Truncated command IDs** (`…` + `id.slice(-8)`) with no copy button visible — fine for a table, painful when you need the full ID to grep logs by hand, which is currently the *only* correlation path.

## What works

- Server-side filtering is genuine: `edge` dropdown populated from a real `edges` query, `level` sent as a server param (omitted when all four enabled — correct), `q` passed through, cursor pagination with explicit "Show more" and a loaded-row count. This is a solid foundation, not a mock.
- Empty state is honest and instructive ("Gateway and data-source logs appear here once an edge starts shipping them") — no fake demo rows. Credibility-wise this is the right call for an OT tool.
- Command audit detail row expands inline and refetches on 15s polling — status transitions do surface, eventually.
- Connection state widget (*Reconnecting*) exists — the app has a realtime concept; it just isn't wired to the page that needs it.

## Missing vs journalctl/Seq-style tools

| Capability | journalctl -f / Seq / Loki | Here |
|---|---|---|
| Follow/tail | core feature | absent (no refetchInterval, no SSE append) |
| Time jump/range | `--since/--until`, histogram scrub | absent (no time params at all) |
| Volume histogram | event-count-over-time burst view | absent |
| Debounced search | standard | absent — query per keystroke |
| True facet counts | server aggregates | loaded-rows only |
| Correlation ID join | trace_id → span tree | absent — no link between a command and its log lines; hand-grep by timestamp only |
| Δms between command events | waterfall | absent |
| Staleness/edge-offline marker | "source heartbeat lost" | absent — only global Reconnecting |
| Shareable filter URL / export | permalink, download | not evident; filter state isn't in the URL |

**Can I watch logs tail?** No. **Can I correlate a command's journey?** Only by eyeball — /traces shows command status transitions (id/status/issued/actor, expandable events) but shares no correlation key with /logs, shows no Δms, and is itself flag-gated and silently redirecting.

## Top fix

**Add a follow mode to /logs**: poll (or SSE) for `ts > lastSeen`, prepend new lines, and pin a staleness readout to the header — "edge gw-3: last log 6m12s ago" — so silence and blindness stop looking identical. That's the single change that makes the page usable mid-outage; the 15s-poll pattern already exists in `traces.js` to copy. While in the file: debounce `q` (~300ms) and move the filter state into the URL.

Second (cheap, high-value): **rename `/traces` to "Commands" / "Command audit"** and add a Δms column on its events plus a "view logs for this command/edge" deep link — that converts two isolated tables into an actual correlation path.

---

<!-- ====================================================================== -->
## [23/48] File: `round3/agent-04-monitors.md`

# Agent: alarm-systems-engineer — round3

## Pages: /monitors, /monitors/templates

Screenshots: `s3-monitors.png`, `s3-templates.png` (1440x900, demo=admin, via CDP+Playwright after raw `--screenshot` headless runs produced no output).

## Score /10 (as HMI)

**5/10.** The data model underneath is defensible — arguably textbook — but the vocabulary layer actively works against it. On one pair of screens the app uses *monitor*, *rule*, *template*, *monitor template*, and *pack* as if they were synonyms, while the whole point of the feature is that they are **not** synonyms. An operator who needs the distinction most (did I install a thing, or a factory for things?) is given no stable term to hold onto.

## HMI/ISA-101 verdicts

**Can an engineer tell monitor vs rule vs template vs vision-rule apart?**

- **Monitor vs rule: NO, the UI itself can't decide.** Page title says "Monitors." Inside it: search placeholder "Search **rules** by name, signal or equipment", footer "Showing 1 of 1 **rules**", primary button "+ New **rule**", left rail filter "**Rule** type". Four internal references say *rule*, the chrome says *monitor*. If the team can't pick, the operator can't either. The defensible model (rule = definition, monitor = rule + live state) is invisible because nothing in the UI states it.
- **Template vs pack vs monitor template: NO.** Templates tab: title "Rule templates", helper text "Curated plant **rule packs**", search placeholder "Search for a **monitor template**", cards say "4 rules / Install **pack**". Three nouns for one concept on a single screen — a new AI-slop record for this review series.
- **Vision-rule: undiscoverable from here.** The "Vision pipeline" pack says "Staleness checks for camera inspection results" — it never says the installed items live under Infrastructure as a *different kind* of rule. An engineer installing this pack cannot predict where its rules will surface or that they're governed by a separate rules page. Fourth instance of "rule" in the product (monitors, admin/rules, templates, infra/vision) and this screen is where two of them silently collide.
- **Status model: GOOD, and the best part of the page.** Alert / Warn / No data / OK / Disabled as a first-class lifecycle is real alarm-system thinking. "No data" treated as a state rather than an absence is ISA-18.2-adjacent (dead tag / loss-of-integrity detection). The demo even shows it: `conv1_overtemp` sits in NO DATA — a Critical-priority check on a silent signal, exactly the failure mode plants get hurt by.
- **State vs severity correctly separated.** Status (alert/warn/nodata) and Priority (Critical/Warning/Advisory) are distinct axes — right. But "Rule type: High" is a confused filter: "High" is a *condition shape* (high-limit), not a rule type. Types should read threshold / rate-of-change / stale / heartbeat / expression. As-is it teaches operators the wrong taxonomy.
- **Condition column lacks units: confirmed.** `High > 80` — 80 what? °C? rpm? %? The tag name `…temp_c` hints Celsius but the HMI must not make the operator parse a tag path to learn engineering units. ISA-101 expects value + unit together: `> 80 °C`.
- **Row-click → /alarms, no edit: still wrong direction.** A monitor row is configuration+state; clicking it should open its definition (threshold, deadband, on/off delay, notification targets, enabled toggle) or a detail drawer. Routing to the alarm *event* list conflates config with history. An engineer wanting to raise the 80° limit has no path from the object that owns it.
- **List is too sparse for a monitoring surface.** No last value, no last state-change timestamp, no deadband/delay columns, no enabled toggle, no mute action, no notification-channel indicator. Facet rail (Status/Muted/Priority/Rule type/Equipment/Signal) is well-structured but there's almost nothing to facet *over*.
- **Templates/dedup concept: genuinely good.** Curated packs that bind each rule to existing site signals by pattern is the correct mechanism — this is how you'd actually want to roll out alarm rationalization across lines. Preview + per-item Will-create/Already-exists/No-match (seen in prior round) is honest, non-destructive install semantics. Real product thinking.
- **But the dedup is hidden.** At card level there is no "→ will create 3, 1 exists, 0 unmatched" summary. "Install pack" is enabled with zero indication of outcome; the engineer must expand Preview to learn what install will do. The single most valuable number on the card (net new rules) isn't shown. Also no uninstall/diff/upgrade path — packs are install-once, no version, no "pack updated, 2 rules drifted" reconciliation.

## AI-slop flags

- Triple-synonym single screen: "Rule templates" / "monitor template" / "rule packs" — LLM-generated copy that never met a terminology table.
- Header leaks `pytest-org-b-d1f4011e` — test-fixture org slug rendered as the org name in production chrome.
- "Off shift" pill + amber "Reconnecting" chip — socket state exposed as a permanent alarm-looking banner; a SCADA header should reserve alarm colors for alarms.
- Redundant double badge: left facet "No data **1**" chip plus table cell "NO DATA" lozenge — same fact stated twice in different visual languages.
- "Search or jump / Ctrl K" command-palette topbar on a plant floor tool.
- Facet titled "Rule type" containing "High" — taxonomy salad.

## What works

- **No-data-as-state is the standout.** Silent-signal detection surfaced as a first-class, filterable status is better alarming practice than most shipped historian/SCADA products. The demo even stages it correctly (Critical rule, dead signal).
- Status vs priority split is correct alarm semantics.
- Facet rail structure (Status / Muted / Priority / Type / Equipment / Signal) is the right mental model for triage — it just needs rows worth filtering.
- Template-pack mechanism (site-signal binding + per-item dedup preview) is the right install model; honest about what exists vs what will be created.
- "Triggered / Downtimes / Quality" sibling tabs hint at a coherent monitor lifecycle (live → suppression → rationalization metrics). Quality tab especially — alarm-system engineers live for that page.

## Top fix

**Pick one noun and enforce it globally.** The model is fine — the naming is not. Recommended contract:

- **Rule** (กฎแจ้งเตือน / เงื่อนไขเตือน) = the definition: tag + condition + threshold + notify. This is what "+ New rule" creates, what the list rows *are*. A Thai plant reads this as "เงื่อนไขที่ตั้งไว้" — the condition we configured.
- **Monitor / Monitoring** = the *live view of rules*: the status column, the Triggered tab. Rename the list page "Alarm rules" and keep "Monitoring" as the section/tab for live state — or vice versa, but never both words for the same object.
- **Rule pack** (ชุดกฎแจ้งเตือน) = the template card; the thing inside is "a rule from the pack." Delete the word "template" from user-facing copy entirely — engineers already own "tag template / faceplate template" as different concepts.
- **Vision rule** → "Inspection rule" or, better, fold vision staleness checks into rule packs as just another rule kind (the "Vision pipeline" pack already does this implicitly — make it explicit and delete the separate rules surface under Infrastructure).

Then fix the row: add units to CONDITION (`High > 80 °C`), last-value and since columns, and make row-click open the rule editor — not /alarms. Secondary: put the dedup verdict on the pack card itself ("Install → 3 new · 1 exists · 0 no-match").

---

<!-- ====================================================================== -->
## [24/48] File: `round3/agent-05-slos.md`

# Agent: reliability-engineer — round3

## Pages: /slos, /slos/settings

Evaluated live in the Demo org (had to select the "Demo" org from the header switcher and click "Add the default SLOs" — `?demo=admin` alone lands on an empty `pytest-org` and shows the empty state). Seeded: 4 Availability SLOs (belt temp telemetry 99.5%, bin level uptime 99.0%, conveyor availability 99.9% → CURRENT 99.96% / budget 59% left, vision frames 99.5% → 99.95% / 91%). Detail panel shows Overview/Alerts/Corrections/Audit tabs, burndown + burn-rate charts, "96,408 samples · History covers the last 81h 18m of this window". Settings: window default pills, presets, **Service limits** ("Tag history is retained for 8 hours — SLIs and charts cover at most the last 8 hours of any window", 100 SLOs/org, corrections ≤30d, delete is permanent), deleted-SLO audit table.

## Score /10 (as HMI)

**7/10.** Real arithmetic, honest limits documentation, and a sane empty/onboarding path. Docked: the headline numbers wear a 30d label the retention can't back; the burn-rate visual is a monitoring-tool transplant with no action attached; audit rows show raw UUIDs.

## HMI/ISA-101 verdicts

- **Is the 8h-retention-vs-30d-label a ship-blocker? Yes — for the list view, and it's a cheap fix.** The list column header says TIME=30d and CURRENT=99.96% with no coverage qualifier. That number is an ≤8h (demo shows up to ~81h) SLI. Anyone exporting or eyeballing that table for compliance ("did conveyor telemetry meet 99.9% this month?") gets a silently wrong answer. The disclosure exists — "History covers the last 81h 18m of this window" — but only inside the detail panel, one SLO at a time. A claim of correctness presented at list granularity requires the caveat at list granularity. Blocker severity, label-difficulty fix: per-row coverage badge or "evaluated on last Xh of 30d" subscript, plus grey/dashed styling of windows beyond retention on the pills.
- **Burn rate is barely actionable as drawn.** The chart (0 / 1× / 1.5× / target pace) is the Google-SRE multi-window-alert concept flattened to one line on ~8h of data — it will render as a step function of single bad samples and teaches nothing. No fast-burn/slow-burn thresholds, no tie-in to the Alerts tab visible, no "time to exhaustion at current rate" — the one number an operator could act on. For a plant-edge HMI, "budget exhausted in ~Xd at current pace" beats a ratio.
- **Model fit for plant-edge SLOs: partially right, one dangerous gap.** Ratio-of-good-samples is a reasonable SLI for tag streams, but the denominator question is unanswered in the UI: **when an edge node goes dark, no samples arrive — does the SLI count that as bad, or as absent?** If absent, an offline line reports 100% availability — false-green, the worst failure mode for edge heartbeat SLOs. There is a NO DATA state (good instinct), but a window that's 90% silence and 10% good samples still reads 100%. The model needs expected-vs-received samples (time-weighted coverage), which "96,408 samples" hints at but never exposes as a metric. Ingest-freshness SLOs are force-fit into "Availability" type — a lag-threshold SLI type is missing.
- ISA-101 positives: low-saliency gray charts (information, not alarm), state triage cards with redundant shape+color coding (▲◆●○), muted palette consistent with situational-awareness design.
- Header shows "Reconnecting" (SSE dropped) — honest data-freshness signaling, good.

## AI-slop flags

- **Window pills 7d/30d/90d that cannot be satisfied** by 8h retention — plausible-looking controls over a missing capability; the selector should degrade gracefully.
- **Coverage inconsistency**: settings says "at most the last 8 hours", detail panel says "History covers the last 81h 18m" — either demo seed leaks past the limit or two components disagree about retention. Pick one truth.
- **"Error budget left" math is the per-window complement of observed bad-fraction**, not a cumulative 30d budget position — the formula is textbook-shaped but answers the wrong question when the window is mostly unobserved.
- **Deleted-SLO audit table renders raw UUIDs** (SLO `e4c9634f-93f0-…`, actor `0199d000-0000-7000-…`) — an audit trail a human can't audit.
- Signal facet names truncate to `plant1.sort.line1.bin1…` with no tooltip — the differentiating part of the tag path is what's cut off.
- Footer explainer ("Current = share of good-quality samples…") is copy-paste generic; doesn't mention the retention cap where it matters most.

## What works

- Error-budget-left bars with real math (99.96% vs 99.9% → 59% consumed is internally consistent for the observed window), per-row bars, green→danger gradient.
- State facet rail (Breached/Warning/OK/No data × Type/Equipment/Signal) — proper triage affordance.
- Detail panel: Overview/Alerts/Corrections/Audit tabs, "target pace" reference line, out-of-budget band at −10% on burndown, sample-count + coverage disclosure.
- Settings page is unusually honest: service limits enumerated, deletion is permanent *and* says so twice, presets, audit of deletions. This is the right pattern — it's just not propagated to the list view.
- Empty state offers "Add the default SLOs" for the sorting line — good onboarding.

## Top fix

**Make the coverage qualifier structural, not a footnote.** On every row and every window pill, show evaluated coverage: "30d objective · evaluated on last 8h" with the pill styled as partial/insufficient (ISA-101: no full-confidence presentation of partial data). Then fix the denominator: add an expected-samples model so silent edge nodes count against availability instead of vanishing from it — otherwise edge-heartbeat SLOs certify darkness as uptime. Secondary: replace burn-rate ratio chart with "time to budget exhaustion" and wire burn-rate thresholds to the Alerts tab.

---

<!-- ====================================================================== -->
## [25/48] File: `round3/agent-06-synthetics.md`

# Agent: monitoring-architect — round3

## Pages: /synthetics, /synthetics/coverage

**Reachability this session:** :5199 dev server up — both routes rendered and screenshotted
(`shots/s3-synth.png`, `shots/s3-coverage.png`). :5173 flag-gate confirmed live:
`/synthetics?demo=viewer` silently redirected to `/` Overview, which then showed
"Could not load data from the backend" (`s3-synth-5173.png`). Sources audited:
`SyntheticsPage-pIHQuIpi.js`, `CoveragePage-DVNOu6CP.js` (fresh hashes from
`index-Criwe5Qj.js`), `px.synthetics` i18n bundle in `i18n-D9tVTlvC.js`.

## Score /10 (as HMI)

**5/10.** Up from prior 4 because I could finally run it and the Coverage tab is
genuinely useful; still capped by: unreachable in the flag-off build, zero temporal
depth (snapshot only), truth-telling problems in the suite bars, and a
vocabulary that doesn't match what the page actually measures.

## HMI/ISA-101 verdicts

- **Status encoding is ISA-101-aligned and it's the best thing here.** Four-state
  status (Passing ● / Stale ◆ / Bad quality ▲ / No data ○) uses shape + text, not
  color alone. Muted glyphs, no gratuitous alarm colors. Exactly right for a
  health surface.
- **Suite pass% bars lie by color.** `SyntheticsPage-pIHQuIpi.js`: fill is always
  `bg-[var(--color-ok)]` regardless of pass rate — a 0%-passing suite draws a green
  bar. On a floor display, green means "running/normal"; a dead suite showing green
  is backwards. Bar fill should follow worst-member status, or drop the bar.
- **"Last value" column shows age, not value.** i18n `px.synthetics.colAge` =
  `"Last value"`, but the cell renders `format(ts, now)` (relative age). Either the
  label or the formatter is wrong; an operator reading "Last value —" learns
  nothing. Fix to "Age" (or render the value + quality).
- **No temporal context anywhere.** Status is computed from one instant
  (`now - ts > 15s`). No last-transition time, no failure count, no flap history.
  A check that flapped 40 times today and one dead for 3 days render identically.
- **"No data" empty state is honest but silent.** In demo/viewer with no live feed
  the whole page reads 0 Passing / 6 No data — indistinguishable from broken
  plumbing vs. idle fleet. Graceful, but needs a banner saying which it is.
- **Edge heartbeats section duplicates the same concept with different windows**
  (checks: 15 s sample-age; edges: 30 s late / 5 min offline) with no explanation —
  two staleness vocabularies on one page.
- **Coverage tab is the keeper.** Per-signal alarm-rule count, silence-rule flag,
  live-data flag, explicit "Signals with no alarm rule" gap list. `Add rule`
  correctly role-gated (`orgRole` check) and links to `/admin/rules/new`. This is
  real monitoring architecture, not decoration.
- **Settings tab is honest to a fault:** it documents that windows are
  compile-time constants ("needs a code change and a deploy", not stored per-org).
  Better a settings page that confesses than fake knobs — but it confirms the
  thresholds can't be tuned per signal, which is what the page actually needs.

## AI-slop flags

- **"Synthetics" is a borrowed mental model that doesn't fit.** Synthetics in
  Datadog/Sentry means scripted probes injecting fake transactions. Here a "check"
  is just "did a good-quality sample arrive within 15 s" — that's signal
  liveness/freshness, a SCADA-native idea (PV status / input validation), not a
  synthetic transaction. Nothing synthetic is happening.
- **Three names for one surface:** route `/synthetics`, header title "Heartbeat
  checks", grouping called "Suites by equipment". "Suites" and "passing" are
  test-runner vocabulary; the status column already speaks live/stale/bad — the
  suite cards should reuse it.
- **Generated-scaffold smell:** Checks / Coverage / Settings tri-tab is the
  canonical observability-product skeleton; the Settings tab exists mainly to say
  nothing is configurable.
- **Always-green progress bars** = copy-pasted "percent → progress bar" widget
  without semantic color. Decorative dashboard grammar.

## What works

- Checks are derived from real stream state (sample age > 15 s → stale,
  quality ≠ good → bad, absent → none). Honest under-flag engineering confirmed
  in code, not just asserted.
- Coverage gap list → `Add rule` is the right operator workflow (find unwatched
  signal, fix it), and it's role-gated rather than fake-CTA.
- Edge fleet distinguishes disabled vs never-connected vs late vs offline.
- Failure mode on :5199 with backend down is graceful (zeros + "No data"), not
  fake-green — the page doesn't manufacture health.
- Thai translations are complete and terminology-consistent.

## Answers to the posed questions

**Is flag-hiding the right call?** Partly. Gating while there's no persistence is
defensible — but the *silent redirect to an erroring Overview* is the wrong failure
mode (a dead page that pretends the user meant the home screen). And a read-only
health page is the safest possible thing to expose: it can't hurt anything and
operator eyeballs are exactly the feedback needed to validate the 15 s window.
Right call: ship Checks+Coverage under a "Beta" badge, keep Settings gated, and
make the flag-off case render a proper 404/disabled notice, not a redirect.

**"Signal health" instead of "Synthetics"?** Yes — the header already says
"Heartbeat checks", which is closer to the truth. "Signal health" (or "Signal
liveness") is the honest SCADA name; "coverage" is already the right word for the
second tab. Rename costs one i18n key and a slug; the mental-model correction is
free credibility with operators who've never heard of web synthetics.

**What the check list needs:** (1) per-check history strip — last ~50 evaluations
as muted ticks, red only on excursions; (2) "last change" timestamp — when status
last transitioned, the analog of alarm last-occurrence; (3) failure count /24h or
MTBF per check to separate flappers from dead signals; (4) the per-row staleness
threshold displayed (it's a fixed 15 s today, meaningless for a 1 Hz tag vs a
5 min batch signal — expose the limit or make it per-rule); (5) real quality code
in the Bad column (uncertain vs bad vs comms-fail, not one bucket); (6) sort
worst-first, suite headers carry worst-member status; (7) click-through from a
check row to the tag/trend.

## Top fix

Give each check **a last-change timestamp + a 24 h history strip**, and fix the
suite bar to take worst-member color instead of permanent `--color-ok` green —
while you're in there, rename the surface to "Signal health". One pass turns an
instantaneous snapshot into a diagnosable monitor and the labels into something a
panel operator would recognize.

---

<!-- ====================================================================== -->
## [26/48] File: `round3/agent-07-healthstatus.md`

# Agent: hmi-trust-designer — round3

## Pages: /health, /status

Evidence: s3-health.png, s3-status.png (1440x900, `?demo=viewer`); bundle source
`StatusPage-B1L9b1zl.js`, `HealthPage-D8sYXhF0.js`, `api-Ce07eEu1.js`
(docker `webservice-web-1:/usr/share/nginx/html/assets/`).

## Score /10 (as HMI)

- **/health: 7/10.** Honest diagnostic surface. N/A rendered as data ("never",
  "Not reported"), explicit state thresholds in the legend, relative staleness
  ("Updated 36s ago"), a real websocket-state chip ("Reconnecting") in the top bar.
- **/status: 3/10.** Status-page *shape* without status-page *substance*: binary
  ok/bad, placeholder-grade since-timestamps, no history, understated severity.
- **The pair, as one trust surface: 4/10.** The contradiction IS the defect:
  two pages, three endpoints, two vocabularies, zero derivation.

## HMI/ISA-101 verdicts

- **One source of truth — violated.** Code-confirmed: /health polls
  `GET /api/health` (+ `/api/system/health` behind a role gate) and is
  websocket-revision driven; /status polls `GET /api/v1/status` every 30 s.
  They are parallel models, not a projection. Any drift between them is a
  lie shipped to users.
- **Component taxonomies don't even intersect cleanly.** /health: broker,
  edge gateway, database, websocket. /status: Console API, Database,
  "Realtime broker", "Edge ingest". "Console API" has no /health counterpart;
  "WebSocket" has no /status counterpart; broker and edge are renamed, not
  mapped. A viewer literally cannot reconcile the two lists.
- **Severity understatement.** /status banner: "Degraded performance." /health
  at the same moment: edge gateway DISCONNECTED, websocket DISCONNECTED,
  0 of 2 edges online, neither edge has *ever* reported. For a product whose
  lede is "Connectivity from the PLC to this screen," zero ingest is a
  **major outage**, not degradation. The caution-amber banner is a
  misclassified alarm state — ISA-101 would call this a defeated alarm.
- **Internal contradiction inside /health itself.** Fleet header reads
  "0 online · 0 late · 0 offline" while the table shows 2 rows in states
  the counter doesn't cover (Disabled, Never connected). The 3-bucket counter
  vs the 5-state row model means the headline mathematically cannot sum to
  the table — the same class of contradiction /status commits globally.
- **Stale-by-design on the "live" page.** /status claims "Live health" but
  polls at 30 s with no refresh affordance and a one-shot "Checked" footer.
  /health is the honest one ("Updated 36s ago").
- **Dead-end presentation.** /status has no drill-through to /health, no
  incident log, no uptime history, no "what does Edge ingest disrupted mean
  for me." Public status conventions exist; none are implemented.

## AI-slop flags

- Three "Operational" rows with the **identical** since-timestamp
  (10/19/2026, 5:16:44 PM) — that's process boot time rendered as
  per-component recovery history. Fake granularity: it LOOKS like tracking,
  it's a shared constant.
- "Edge ingest — Disrupted" with NO since/timestamp — the one row where a
  timestamp would carry information doesn't have one.
- "Checked 10/19/2026, 5:34:29 PM" — reassurance-shaped staleness disclosure.
- The rename layer (`mqtt`→"Realtime broker", `edge`→"Edge ingest" via i18n
  keys st.compMqtt/st.compEdge) is theater: new labels over the same booleans,
  presented as a different product-level view.
- Public page survives on binary `ok` boolean (`t.ok?st.ok:st.bad`) while the
  internal model has five edge states — granularity discarded at exactly the
  boundary where it matters.

## What works

- /health's discipline: "never", "Not reported", "0 online" — it shows
  negative/absent data instead of smoothing it. Legend defines Late=30 s,
  Offline=5 min. Credential version column (v0/v1) hints at rotation state.
- /health distinguishes Disabled vs Never connected — operationally real
  states, not decoration.
- /status is at least *trying* to be public: standalone, no shell chrome,
  plain-language names, banner + per-component rows, `role="status"`/
  `role="alert"` semantics, 30 s refetch, isError/isLoading paths.
- The "Degraded" banner proves the backend CAN aggregate — the failure is
  mapping and severity, not capability.

## Top fix

**Merge by projection, not by deletion — but kill the parallel model.**

Two surfaces is not the bug; two *truths* is. Public status page vs operator
diagnostics is a legitimate split (statuspage vs internal dashboard). The bug
is that `/api/v1/status` is a separately maintained component list that can
contradict `/api/health`.

Concretely:

1. **One aggregate.** Derive `/api/v1/status` from the same health model that
   feeds /health. Declare an explicit mapping, e.g. `platform = api ∧ db ∧
   mqtt`, `ingest = edge_gateway ∧ fleet_online_ratio`, `realtime = ws`.
   Public components are *capabilities* ("Data collection", "Realtime
   updates"), computed — never hand-listed.
2. **Severity from data.** 0 edges online + gateway down = Major outage on
   the ingest component and the banner. Tiers: Operational / Degraded /
   Partial outage / Major outage — the public page needs at least three.
3. **Fix the fleet counter** to cover all five states (online · late ·
   offline · disabled · never-connected) or the headline keeps contradicting
   its own table.
4. **Honest timestamps.** `since` = last state transition per component,
   not boot time; the disrupted row needs `since` MORE than the healthy ones.
   Keep /status's "Checked" but render relative ("checked 12 s ago") like
   /health does.
5. **Add the missing half of the genre**: a small incident history / uptime
   strip on /status, and a "view diagnostics" link for users with the role —
   one mental model, two zoom levels.

Until #1 lands, /status is a rumor about /health. The fastest trust repair is
a banner that says "Major outage — data collection down" when the fleet is at
zero, derived from the same payload the operator sees.

---

<!-- ====================================================================== -->
## [27/48] File: `round3/agent-08-errors.md`

# Agent: hmi-designer — round3

## Pages: /errors

Evidence: `s3-errors.png` (dev :5199, `?demo=viewer`, flag on → page renders);
`s3-errors-5173.png` + CDP `location.href` (`/errors` → silent `<Navigate to="/">`,
h1 "Overview"). Code: `web/src/features/errors/ErrorTrackingPage.tsx`,
`web/src/features/errors/errors.mock.ts`, `web/src/app/nav.ts:148-150`,
`web/src/App.tsx:278,337`, `web/src/lib/features.ts`.

## Score /10 (as HMI)

**4/10.** The page is a competent Sentry clone, but it answers a question no
operator asked. It is developer tooling wearing a plant-console rail slot; its
only concessions to the domain are mock messages about Modbus and YOLO. The
correct instinct is already in the code — the page is flag-gated and absent
from the prod build — so the shipped artifact gets the verdict the page itself
doesn't deserve.

## HMI/ISA-101 verdicts

- **Belongs in operator nav? No.** It sits in cluster 3 ("plant data") as a
  top-level rail group, peer to Trends/OEE/Logs (`nav.ts:148-150`). Stack
  traces, `KeyError`, and file:line excerpts are engineering diagnostics. An
  operator's question is "is the line healthy and what do I do" — this page
  answers "which function threw." Wrong altitude for the rail.
- **Severity model: absent.** `Issue` has no level/severity field
  (`errors.mock.ts:7-21`). `status` is a triage workflow state
  (review/reviewed/ignored), not severity — yet "FOR REVIEW" renders in the
  same alarm-red `#c8485f` as everything else (`ErrorTrackingPage.tsx:17,73,83`).
  A staging `TypeError` and a prod Modbus timeout are chromatically identical.
  The same product already has a Critical/Warning/Advisory vocabulary on
  Monitors/Alarms; this page ignores it entirely. ISA-101's core rule —
  encode consequence, not category — is violated.
- **Triage actions: none.** Statuses exist as data and as a facet, but the
  detail pane is read-only — no Resolve/Ignore/Assign button anywhere. "For
  review" is a dead affordance: it invites an action the UI cannot take.
- **No path to the plant.** Issues name services (`edge-bridge`,
  `mqtt-ingest`, `vision-yolo`) but never link to the device, line, or health
  page that owns them. A Modbus-timeout issue can't take the operator to the
  edge device that's failing.
- **Where it SHOULD live in IA:** two different populations are fused here.
  (a) The Sentry-style explorer is APM — it belongs inside the existing
  `nav.apm` group (`nav.ts:115-118`, already holds Traces/Processes,
  cluster 2) or under Developer Portal, engineer-visible only. (b) The
  *plant-relevant* failures it mocks — Modbus read timeout, MQTT refused,
  vision OOM — are operational events and should surface through the existing
  Events/Incidents/Health model (`/events`, `/infrastructure`, `/health`)
  with priority, equipment binding, and ack/escalation, not as an issue
  tracker.
- **Silent redirect when flag-gated:** on the prod build `/errors` hits the
  catch-all `<Navigate to="/">` (`App.tsx:337`) — right outcome, wrong
  mechanism. A bookmarked operator lands on Overview with no explanation;
  a "not available in this deployment" state (or at least a 404) is more
  honest. Minor.

## AI-slop flags

- **LCG-fabricated 24h histogram** (`errors.mock.ts:105-113`): deterministic
  pseudo-random bars scaled to `count/12`, labeled "errors in the past day" —
  a chart that depicts a distribution that was never observed.
- **Sentry cosplay:** `ERR-####` ids, `service:`/`env:`/`type:` query syntax,
  first/last-seen, deduped issue counts — the entire interaction grammar is
  lifted from Sentry, including the parts that don't fit (stack frames with
  hand-written plausible code excerpts, e.g. `modbus.py:85-89`).
- **Fake time control:** the "Past 1 day" chip is a static `<span>`
  (`ErrorTrackingPage.tsx:163`), not a range picker — it looks like a control
  and does nothing.
- **Partial honesty:** the "Demo data — the backend has no error-tracking
  endpoint yet" banner is genuinely honest (good), but it sits under a layer
  of fabricated specificity (496 occurrences, 30-day first-seen, exact line
  numbers) that reads as real to anyone who skims past the banner.
- **Settings tab** renders "not available in this build" — honest, but a tab
  whose only content is a no-op notice is nav furniture.

## What works

- Mock-data banner and settings-not-available notice — states its own
  dishonesty up front.
- Facet panel with per-value counts and a working `key:value` query grammar
  (`matchQuery`, `ErrorTrackingPage.tsx:23-29`) — real client-side filtering,
  not decorative.
- Histogram has `role="img"`, aria-label, and per-bar tooltips; empty state
  exists; detail pane degrades gracefully. Craft is decent.
- Flag gating means prod operators never see it — the correct default.

## Top fix

**Take it out of the operator rail and give it a severity model, or don't ship it.**
Concretely: (1) move `/errors` under the APM group (next to `/traces`,
`/processes`) and/or Developer Portal — engineer-scoped, not cluster-3 plant
data; (2) add `level: 'fatal'|'error'|'warning'|'info'` to the issue model and
map it to the product's existing Critical/Warning/Advisory palette so severity
isn't uniformly red; (3) either wire Resolve/Ignore to something real or drop
the status workflow until the backend exists — a read-only "For review" is a
promise the UI can't keep; (4) route the plant-meaningful failures (edge
timeouts, ingest failures, vision OOM) through Events/Incidents/Health where
operators already triage, so the diagnostic reaches the people who can act on
it. As it stands, the only thing protecting operators from this page is a
feature flag — fix the IA so the flag isn't doing all the work.

---

<!-- ====================================================================== -->
## [28/48] File: `round3/agent-09-tags.md`

# Agent: tagdb-engineer — round3

## Pages: /tags, /catalog

Evidence:
- `s3-tags.png` — /tags?demo=viewer, seeded state (2 signals)
- `s3-tags-drawer.png` — /tags?demo=viewer, un-seeded state (0 of 0 signals, "No signals reported" empty state); row click had nothing to click
- `s3-catalog.png` — /catalog?demo=viewer with feature flag OFF → renders the **Overview / Getting-started page** verbatim. No 404, no "feature not enabled" banner — the route silently falls through to a different page.
- `TagsPage.pretty.js` (338-line prettified bundle of the shipped component) read line-by-line for implementation truth.

## Score /10 (as HMI)

**4/10.** Recognizable tag-browser skeleton — pin/watchlist, W-writable badge, quality badge, stale dimming, detail drawer, bulk-move for admin — but it fails the two things a historian tag search exists for: **what unit is this number** and **where does this tag come from**. A PI System Explorer / Canary operator looking at `42.5` with no °C and no interface/gateway column cannot do their job.

## HMI/ISA-101 verdicts

- **UNITS: fail.** Filter placeholder literally advertises `unit:°C`, yet the row shows a bare `42.5`. The renderer supports units (`_(n.name, n.unit)` appends a unit span, TagsPage.pretty.js:305-306) but the seeded tag carries no unit — so the one analog value on the page is unit-less. Engineering units are non-negotiable in a tag list; this is the single most damaging gap.
- **SOURCE/edge: fail.** No column, no drawer field, nothing identifies which gateway/interface feeds the tag. For a page whose primary diagnostic use is "why is this tag dead" — and *both* demo tags are stale — the absence of provenance guts the tool. PI SMT shows pointsource/interface on every row for a reason.
- **Equipment grouping: wrong model.** The GROUPS facet is `name.split('.').slice(-2,-1)` — the second-to-last tag-name token (TagsPage.pretty.js:192). `motor1`/`sensor` facets are name-convention debris, not the asset hierarchy. The app *has* a real equipment tree (`o.tree()` → areas→lines→equipment) but only uses it inside the bulk-move dialog (lines 53-63). Group the facet by the equipment model, not by hoping the naming convention holds. Any tag named off-convention silently lands in a nonsense group.
- **Staleness: naive.** Hardcoded 15 s threshold for every tag (`>15e3` at lines 114/199/274). Real tags have scan classes; a 1 s flowmeter and a 5 min ambient reading need different staleness. Worse, in the seeded screenshot BOTH tags are stale → both rows render at `opacity-50` → the entire table is greyed out. ISA-101 de-emphasis for bad/stale data is correct; dimming 100% of the surface just makes the page look broken.
- **QUALITY conflates two things.** One badge merges source quality `q` and computed `stale` (line 309-311). "Stale" (we haven't heard lately) and "Bad/Comm-fail" (the source told us it's bad) are different diagnoses and need different labels. Row 2 renders what looks like an empty dashed badge — an edge case leaking through.
- **TREND column is dead UI.** Header exists, sparkline component `<w tag>` is wired (line 315) but renders nothing for stale/no-history tags — in the screenshot the column is entirely blank. An always-empty column is worse than no column.
- **UPDATED shows relative-only "87h ago".** Historians display absolute timestamps; relative-only hides drift and timezone questions. (Absolute-on-hover may exist — unverifiable headless — but shouldn't be the only path.)
- **Drawer is thin vs. a faceplate.** Shows value/quality/updated/access + the same empty trend box (lines 141-165). Missing: source, unit (yes it's there via `m?.unit` — but only if seeded), datatype, description, engineering range/limits, alarm state. Friendly labels come from a hardcoded `x[name]` map (line 131) — only whitelisted demo tags get descriptions; everything else is anonymous. That does not scale past demo.
- **Terminology drift.** Header "Tags", lede "2 of 2 signals", column "SIGNAL", facet "GROUPS". Pick one noun — "tag" — and hold it.
- **Empty state is decent** ("No signals reported / The backend has not reported any signals for this site yet") — but demo seeding is nondeterministic: one run showed 2 signals, the next showed 0 for the same `?demo=viewer` URL. A demo that sometimes demonstrates an empty page is a hazard for evaluators.
- **What /catalog flag-off does is worse than absent.** It doesn't 404 or banner — it silently serves the Overview page at a URL that isn't overview. Bookmarked links, command-palette entries, docs references all land somewhere the user didn't ask for, with zero explanation.

## AI-slop flags

1. **Fake filter DSL.** Placeholder promises `eq:motor unit:°C quality:stale`; the actual filter (lines 196-202) is a single `name.toLowerCase().includes(q)` substring match plus enum facets. There is no `unit:` or `quality:` parser anywhere. Aspirational placeholder text for an unimplemented query language is textbook slop — it teaches the user a syntax that silently does nothing (typing `unit:°C` searches for a tag literally named "unit:°C" and returns 0 rows).
2. **Hardcoded label metadata.** `x[tagName].labelKey` — a baked-in map of ~N demo tag descriptions. Real tag DBs pull descriptors from the point record.
3. **localStorage watchlist** (`wds.watchlist`, line 23-45) — per-browser, per-profile, invisible to the team. Fine for a toy; a real ops watchlist belongs server-side per user.
4. **GROUPS derived from name-splitting** — looks like "equipment grouping", is actually string surgery.
5. **Empty TREND column + empty drawer trend box** — chrome around a component that never paints.
6. **Ghost route /catalog** — a second registry surface kept behind a flag that, when off, masquerades as the overview.
7. **Nondeterministic demo seed** — same URL, different tag counts across loads.

## What works

- Quality/stale badge concept and stale-row de-emphasis — right instinct, ISA-101-aligned (needs per-tag thresholds and a distinction between stale vs. bad quality).
- W-writable badge + RBAC-gated bulk move (checkboxes only appear for privileged roles) — correctly scoped write affordances.
- Pin/watchlist facet and sort-pins-first ordering — a real workflow for shift handover.
- Filter facets (All / Pinned / Writable / No data) with counts on groups — the facet-sidebar shape is right.
- Detail drawer skeleton: name, copy-tag button, value, quality, updated, access — the right fields, just missing the rest of the record.
- Empty-state copy is honest and specific ("backend has not reported any signals for this site yet").
- Group facet counts are computed, not faked — `motor1 (1)`, `sensor (1)` are real tallies.

## Top fix

**Make the row tell the truth about the tag: add UNIT and SOURCE columns populated from real tag metadata, and drive the GROUPS facet off the equipment tree (`o.tree()`) instead of `name.split('.')`.** A historian tag search whose results can't show `42.5 °C · edge-gw-01 / modbus:40001` next to the name is a spreadsheet, not a tag browser. Everything else — sparklines, drawer fields, alarms-in-row — hangs off having that metadata plumbed through.

Second, closely related: **implement the advertised DSL or delete the placeholder.** Either parse `unit:`/`quality:`/`eq:` against real fields, or change the hint to "Filter by tag name". Never advertise a query language that silently degrades to substring matching.

On the two-surfaces question: **one too many, but the right fix is differentiation, not deletion.** PI splits this deliberately — flat *point* search (SMT point list) vs. *asset* registry (System Explorer elements/attributes). If `/catalog` is meant to be the equipment/asset browser (equipment → its tags → its templates), that's a legitimate second surface and worth shipping; if it's another flat tag list, kill the route. Either way, flag-off must return a real "not enabled" response or 404 — never silently render a different page.

Observation worth logging (for controller, per subagent rules): the project's headless-Chrome `--screenshot` flow intermittently fails silently in shared agent environments (profile-dir lock from parallel runs, plus a run that exited 0 but wrote nothing); playwright-core + `ms-playwright` chromium under `C:/Users/Gigabyte/node_modules` is the reliable path — see `Temp/shots/shot-a09.js`.

---

<!-- ====================================================================== -->
## [29/48] File: `round3/agent-10-insights.md`

# Agent: hmi-insights-skeptic — round3

## Pages: /insights, /assistant

Verified live this round (`?demo=viewer`, playwright-chromium, 1440×900):

- `/insights` renders: lede + filter box + kind/state facet column + a one-row table
  (`Warning | Anomaly | b_site.b.line1.motor1.run | 0.90 | Open | 87h ago | ongoing`).
  Screenshot: `s3-insights.png`.
- `/assistant?demo=viewer` → route is flag-gated (`enabled('assistant')`,
  `web/src/App.tsx:323`; flag list `web/src/lib/features.ts:5`). With the flag off the
  route is never registered and the SPA falls through to `/` (Overview) — observed
  `final url: http://localhost:5173/`. So `/assistant` is not a findings page you can
  reach, it's latent prototype code (`web/src/features/assistant/AssistantPage.tsx`).

## Score /10 (as HMI)

**6/10** — unchanged from prior round. The *engine* is honest engineering; the
*surface* still withholds everything that would let an operator believe it.

## HMI/ISA-101 verdicts

- **The backend is not slop.** `backend/app/alarming/insights.py` is a real,
  carefully-built detector set: EWMA z-score anomaly with open/close streak
  hysteresis, OLS drift on a 30-min window, flatline-with-peer-check, quality
  flapping. Good-quality gating (`q='good'` only, lines 25-28), winsorized
  baseline feed so the band can't absorb its own outliers (lines 322-331),
  dedupe via `insights_open_uq`, audit entries on open/close, `_fresh()` refuses
  to open insights on stale tags. Whoever wrote this understood detector
  hygiene. The problem is entirely the presentation layer.
- **`Score` column is actively misleading, not merely bare.** `score` means a
  different thing per kind (`insights.py` docstring lines 4-17): z-score for
  anomaly, slope×span/σ for drift, **flat minutes** for flatline, **transition
  count** for flapping. Rendering `i.score.toFixed(2)` (`InsightsPage.tsx:105`)
  as one unitless column mixes four physical units under one header — and
  `0.90` on a z-score reads to an operator like "90% confidence" while actually
  being below the anomaly open threshold. Either suffix the unit per kind
  (`z 6.2`, `14 min`, `5 flips`) or drop the column.
- **Rows are dead text.** Plain `<tr>`, no click, no expand, no link — despite
  `openInTrends: 'Open in trends'` sitting in i18n (`lib/i18n.ts:360`). An
  insight you can't drill into is a rumor.
- **No triage path.** Open/closed state exists but there is no ack, dismiss,
  or suppress. My screenshot shows an `Anomaly` open for **87h, ongoing** —
  that is alarm-shelving dynamics re-created in a new panel. Anything an
  operator can't act on or clear becomes ambient noise, then the panel's
  credibility decays — this is exactly the ISA-18.2 flood lesson.
- **"Closed" facet is structurally dead.** The seed only fetches
  `api.insights({ state: 'open' })` (`App.tsx:158`, `OverviewPage.tsx:87`).
  Closed rows can only arrive via WS during the session, so the checkbox
  permanently reads `Closed 0` — a filter that promises a history view the
  page never loads.
- **Severity badge reuse is borderline.** Insights get the same
  `SeverityBadge` visual language as alarms. The lede says "informational
  only" but the badge says "warning = alarm warning". Pick one story;
  ISA-101 would say a non-actionable finding should not wear the actionable
  channel's uniform.
- The error path is honest (`Could not load data from the backend / Try
  again`) — verified live when seed calls raced. Skeleton-then-error rather
  than a fake "0 insights" is the right call (`live.ts:49-54` comment even
  explains why).
- Minor: ~40 identical `GET /api/insights?state=open` in 15 s during one page
  view — something is polling far too eagerly for a WS-pushed resource.

## AI-slop flags

- **"Intelligence" nav group** (`nav.ts:142`, `watchdog` icon) containing a
  z-score detector and a flag-gated stub. That label promises cognition;
  the page delivers a threshold on an EWMA. The page itself is honest
  ("insight engine", "informational only") — it's the IA that oversells.
  Rename the group to what it is (Insights/Detectors) or nest under
  Monitoring.
- **Sparkle icon** on the empty state (`InsightsPage.tsx:97`) — the one
  decorative-AI tell on an otherwise restrained page.
- **Dead evidence i18n — confirmed still dead.** `evZ`, `evMu`, `evSigma`,
  `evSlope`, `evWindow`, `evResid`, `evSamples`, `evFlat`, `evTransitions`,
  `evidence`, `correlated`, `corrAlarm`, `corrCmd`, `corrInsight`,
  `openInTrends` (`i18n.ts:360-371`) have zero references outside the
  dictionary. Worse: the evidence exists *in the payload* — `_v1()` returns
  `detail` with `{mu, sigma, z}` / `{slope_per_s, window_s, sigma_baseline,
  residual_sigma, n}` / `{flat_minutes}` / `{transitions, window_s}`
  (`insights.py:367,408-410,434,452-453,564`). The UI ships strings for an
  evidence popover that was never rendered. The `corr*` keys are doubly dead:
  no backend overlap query exists at all.
- **/assistant is a second findings surface with different score semantics.**
  It's not an assistant — it's a read-only `/inference` viewer for an external
  model server (file comment: "the model never acts"). It renders score as a
  bar + `90%` (a *better* trust pattern than the insights table's bare 0.90!),
  has a provenance line (model name, latency ms, timestamp) that Insights
  lacks, and deep-links tags to `/trends` — the affordance Insights is
  missing. Two parallel "the machine found something" lists, one deterministic
  and scored in z/minutes/counts, one ML and scored in %, is how operators
  learn to distrust both.

## What would make an insight row trustworthy

Ranked by what operators actually need, all cheap because the data already
crosses the wire:

1. **A "why" sentence**, templated per kind from `detail`: "motor1.run peaked
   at z=6.2 vs a 60-min EWMA baseline (μ=41.2, σ=0.8); 5 consecutive good
   samples out of band." One sentence beats any score.
2. **Evidence row/popover** rendering `detail` per kind — the i18n strings
   are already written; this is wiring, not plumbing.
3. **Correlated chips**: "alarm raised in window", "command to this signal",
   "overlapping insight". `corrAlarm`/`corrCmd`/`corrInsight` exist in i18n;
   needs a backend overlap query. This is the difference between "a statistic
   moved" and "this coincided with the pump trip."
4. **Row click → trend** of the tag with `[ts_start, ts_end]` preselected
   (`openInTrends` exists).
5. **Honest score**: unit-suffixed per kind, or removed.
6. **Feedback/triage**: dismiss/suppress + "useful?" — otherwise thresholds
   can never be tuned against operator judgement, and stale rows pile up.
7. **Provenance line** like assistant's own: "detector: anomaly (z≥3,
   60-min EWMA) · evaluated 12 s ago."

## What works

- The lede is the best line in the app: *"Informational only — alarms remain
  the actionable channel."* It tells the operator exactly how much to weight
  the panel. More consoles should say this out loud.
- Engine quality: quality gating, winsorized baseline, hysteresis, dedupe,
  audit trail — real detector hygiene, not a demo heuristic.
- Severity caps at info/warning; nothing competes with the alarm channel.
- Facet + filter interaction is correct (exclusion-model checkboxes; the
  code comment shows the inclusion bug was found and fixed).
- Assistant's model+latency+timestamp provenance line and % bar are the
  trust patterns Insights should steal.

## Two surfaces — which wins

**Insights wins.** It's the auditable, deterministic surface and it's
shipped. Assistant's model results should enter `/insights` as a flagged
`kind` (or a provenance-labeled second table on the same page) — not as a
parallel route teaching a second scoring vocabulary. Keep the flag on
`/assistant` and let it die as a dev diagnostic, or fold it in.

## Is "Intelligence" overselling?

Yes — mildly but consistently. A z-score/OLS/variance detector under a nav
group named "Intelligence" (with an AI-search icon on the row) is the
marketing label on an honest instrument. The instrument is good; the label
is the problem. Call the nav group "Insights" or nest it under Monitoring.

## Top fix

**Make the row expandable with the evidence it already carries.** Render the
`detail` payload (the i18n strings exist), add the one-line "why" per kind,
suffix the score with its real unit, and deep-link the row to `/trends`
windowed on `[ts_start, ts_end]`. One diff to `InsightsPage.tsx` turns a
rumor table into a triage surface. Then rename the nav group — "Intelligence"
is the only dishonest pixel on the page.

---

Files cited: `web/src/features/insights/InsightsPage.tsx` (whole file, 125
lines), `web/src/features/assistant/AssistantPage.tsx` (whole file),
`web/src/lib/i18n.ts:355-371`, `web/src/app/nav.ts:142-145`,
`web/src/App.tsx:158,323`, `web/src/lib/features.ts`, `web/src/lib/live.ts:49-107`,
`backend/app/alarming/insights.py` (whole file — detectors, detail payloads,
`_v1()` serializer).

---

<!-- ====================================================================== -->
## [30/48] File: `round4/agent-01-fleet.md`

# Agent: scada-fleet-designer — round4

## Pages: /infrastructure, /infrastructure/add, /infrastructure/sources
(viewer demo on fleet + sources, admin demo on wizard)

## Score /10 (as HMI)

**7/10** — unchanged from prior round. The honest 5-state model, the staleness
banner, and the pending-config versioning survive; every previously flagged
defect survives too. Nothing regressed, nothing was fixed.

## HMI/ISA-101 verdicts

**"Am I blind right now?" — answerable in ~1s? Mostly yes, with an asterisk.**

- The five status cards (ONLINE 0 / STALE 0 / OFFLINE 0 / NEVER CONNECTED 1 /
  DISABLED 1) give a fleet-level answer in one glance. Keeping "Never connected"
  distinct from "Offline" is the single most important choice here — it
  separates *commissioning failure* (we were never not blind) from *lost
  visibility* (we just went blind). Most fleet tables conflate these. Good.
- The asterisk: the amber "Live feed reconnecting — values may be out of date"
  banner is honest, but there's no **data-as-of timestamp**. A SCADA designer's
  blindness question is really "am I blind *and how stale is my answer to that
  question*?" The cards need a "as of 17:41:52" chip so the 1s answer carries
  its own freshness.
- "Showing 1 of 2" under the cards is quietly excellent — the filtered-out
  disabled device is acknowledged, not silently dropped. Blindness often comes
  from filters the operator forgot; this counters it.
- Table columns (STATUS / DEVICE / CONNECTION / LAST HEARTBEAT / CLOCK /
  CREDENTIAL) are the right fields for the blindness question: heartbeat "Never",
  clock "Unknown", credential "v1". This is a fleet-health table, not a config
  table. Correct instinct.
- **Per-source blindness is NOT covered.** /infrastructure/sources shows one row
  per *gateway* with a single ADAPTER column ("Unknown"). If edge-b-e2e fronts
  three PLCs and one drops, this table cannot show it. The "am I blind" answer
  exists at gateway granularity only — one level too coarse for the actual
  question, since PLC-level comms failure with a healthy gateway is the classic
  silent-blindness mode.

**Enrollment UX for a field tech at the panel — good bones.**

- Four oversized protocol cards, one pre-selected, clear stepper
  (Connection → Details → Install → Verify). Readable on a laptop perched on a
  cabinet; targets big enough for trackpad-with-gloves.
- Separate Install and Verify steps match how commissioning actually goes:
  push the agent, *then* prove it works. Trust-building.
- But: "register map from tags.yaml" is dev-vocabulary in field-facing copy.
  A tech with a laptop next to the panel does not have tags.yaml context.
  "OPC UA — Siemens, Beckhoff, Rockwell servers" remains actively misleading:
  Allen-Bradley kit doesn't serve OPC UA natively. A Rockwell plant reads that
  card, picks it, and fails at Verify. Still no EtherNet/IP — the most common
  North-American PLC protocol is absent while Simulator gets a seat.
- Simulator as a peer card invites a tired tech to commission a fake line.
  Belongs under a collapsed "testing" affordance, or badged clearly.

**Source-config trust ("nothing is written to the PLC") — unverifiable from
these screens.** The sources table has Manage → but no visible Test-connection /
dry-run / read-only badge at the list level. "◆ Pending v5" correctly shows
config-not-applied (config v5 queued on a never-connected gateway — the
config/liveness split is real and good), but the trust promise a SCADA
integrator needs — *we only read, test before you save* — has no surface
evidence. If it exists it's buried in Manage; trust features must be visible
one level up.

## AI-slop flags

- **tags.yaml in UI copy** — internal filename leaked into user-facing wizard
  text. Classic generated-UI smell.
- **UUID noise persists**: `82e15e8e-3ba6-4955-9d50-149f8285a258` under
  `edge-b-e2e` in the DEVICE column. The wizard collects site/line identity;
  the table still shows a surrogate key instead. Operators communicate by
  site/line names, not GUIDs.
- **Vocab muddle continues across three screens**: tab says "Devices", facet
  group says "Connection", row is named `edge-*`, sources table header says
  "GATEWAY", wizard says "device" that the "edge bridge" runs next to. Pick one
  word for the box at the panel and one for the cloud-side row, and use them
  consistently.
- **Duplicate status filters**: the left Status/Connection facet rail repeats
  what the five cards already do — two filtering mechanisms for the same
  dimension ("Status: Never connected" vs "Connection: Unknown" overlap is
  actively confusing).
- "Rockwell servers over OPC UA" — vendor-name-dropping without protocol
  correctness.

## What works

- Never-connected ≠ offline distinction (commissioning vs runtime failure).
- "Pending v5" config versioning with pending/applied split on the gateway row.
- Live-feed reconnecting banner — honest staleness signaling instead of silent
  frozen data.
- "Showing 1 of 2" — filter transparency.
- Credential column ("v1") at fleet level — rotation state is glanceable.
- Viewer role correctly shows no row actions and *says why* ("Admin or owner
  role required to add or change devices") — explains the absence rather than
  hiding it.
- Wizard stepper with explicit Verify step.

## Top fix

**Add a per-source health row set (or expand-on-row) to /infrastructure/sources
showing per-PLC: adapter, last-good-read timestamp, signals flowing count, and
a "read-only — nothing is written to the PLC" badge with a Test button.** The
gateway-level row can't answer the real blindness question — a healthy edge
bridge over a dead PLC serial link is exactly how plants go silently blind.
And surface the collected site/line name in the Devices table instead of the
UUID; identity is how a night-shift operator answers "which panel is dark?"

---

<!-- ====================================================================== -->
## [31/48] File: `round4/agent-02-netmap.md`

# Agent: scada-topology — round4

## Pages: /infrastructure/map

Screenshot: `C:\Users\Gigabyte\AppData\Local\Temp\shots\s4-netmap.png` (1440×900, demo=viewer, org pytest-org-b-d1f4011e).

## Score /10 (as HMI)

**5/10.** The map is honest now — the footnote confesses the fake edges — but honesty about a lie isn't the same as removing it. A topology drawing whose edge set is N×M by construction carries zero bits of information in the edges. The only real data on this page is node status, and that data fits in a 3-row table.

## HMI/ISA-101 verdicts

- **Core question unanswered.** "Which gateway serves this equipment?" — the map cannot say, and the footnote says so: *"Gateways are not bound to specific signals, so each gateway is linked to every equipment group."* Every gateway→equipment edge is asserted and none is true. That's worse than no edges: an operator who skims the drawing will misread connectivity that doesn't exist.
- **Encoding degenerates in the demo state.** "Dashed = gateway not online" — but both gateways are dead (edge-b *Disabled*, edge-b-e2e *Never connected*), so every edge on the page is dashed. The distinction between topology and health collapses to nothing; there's not a single solid edge to anchor the grammar.
- **No legend.** States are conveyed by small text under node names ("Disabled", "Never connected", "no data") plus a tiny hollow/solid dot. A viewer shouldn't have to read a footnote to decode line style, and there's no swatch explaining node status colors at all. Legend is table stakes.
- **Edge crossings already at 2×2.** edge-b → e2e/line1/sensor/temp crosses edge-b-e2e → b/line1/motor1/run. With all-to-all wiring this is guaranteed spaghetti: at 5 gateways × 8 equipment groups you get 40 crossing dashed lines. The prior concern about 64px rows stands — this layout does not scale, it scatters.
- **Dead fleet is invisible in the chrome.** Header shows "Reconnecting" (live feed) and "Off shift", but nothing rolls up "0/2 gateways online — site is blind." On a real HMI, a site with zero live gateways is a top-level alarm condition, not a per-node label you discover by reading cards. Site B's node shows `b_site` and nothing else — no status rollup on the parent.
- **"No data" vs "bad quality" not distinguished.** ISA-101 cares about stale/bad/comm-fail quality. "1 signals · no data" flattens all of it. Combined with the reconnecting banner, an operator can't tell if tags are quiet because the gateway is down, never existed, or the feed is stale.
- **Letterboxing confirmed.** Content ends ~350px into a 900px viewport; the bottom two-thirds is void. No zoom, no pan, no minimap, no fit-to-content. The page is a diagram widget that doesn't know it's a diagram.

## AI-slop flags

- **Confessional footnote as design.** Writing *"we made up these edges"* in small gray text is the generated-code tell: it documents the hallucination instead of fixing it. Ship the truthful drawing or don't draw the edges.
- **All-to-all edges are structural slop.** The demo data itself betrays the fix: `b/line1/motor1/run` ↔ `edge-b`, `e2e/line1/sensor/temp` ↔ `edge-b-e2e`. The tag namespaces mirror the gateway names — a first-pass prefix/site inference would produce the *correct* bipartite edges and instantly make the map worth drawing. Nobody wired that up; they wired everything to everything.
- **Subtitle overpromises.** "Site, edge gateways and the equipment their signals belong to" — "belong to" is exactly the relationship the page admits it doesn't have.
- **"Equipment" nodes are tag paths.** `b/line1/motor1/run` rendered as an equipment card is a signal group wearing a hard hat. Fine if labeled honestly; misleading as drawn.

## What works

- **State derivation is real.** Disabled / Never connected / no data are genuinely derived, not random demo churn — the ISA-101 muted palette is right and nothing screams for attention that shouldn't.
- **Honest footnote beats silent fiction.** Crediting where due: confessing the fake edges is better than round-3 silence.
- **Column grammar is sound.** SITE → GATEWAYS → EQUIPMENT is the correct mental model for a site topology; the skeleton is right even though the connective tissue is fake.
- **Click-through links retained.** Nodes navigate — the map functions as an index even if not as a topology.
- **Reconnecting banner.** Stale-data warning at page level is proper HMI hygiene; keep it.

## Top fix

**Kill the N×M edges — pick one of two truthful drawings, and reconsider whether this should be a map at all.**

1. **Preferred: infer the binding.** The API may not expose tag→gateway, but the naming does: match each tag group's site/namespace prefix (`b/*` → site b's gateways, `e2e/*` → `edge-b-e2e`) or derive binding from the data-source config that owns the tag. Real bipartite edges → the map finally answers its one question → topology earns its page.
2. **Fallback: aggregate pipes.** If binding genuinely can't be derived, draw *one* edge per gateway→site labeled "serving N signal groups," and render equipment as a grouped list under the site with no per-node edges. Never draw an edge you can't defend.
3. **Artifact verdict:** until either lands, this page is a worse fleet table. Gateways-with-status is a 3-row table that answers every question this map answers, plus scales past 5 gateways without edge spaghetti. Either make the map truthful, or demote it to a "topology" column/rollup on the Devices/Data sources pages and let the table do the work. Add a legend and a site-level "gateways online" rollup regardless — a blind site should announce itself before you read a single card.

---

<!-- ====================================================================== -->
## [32/48] File: `round4/agent-03-models.md`

# Agent: vision-ml-engineer — round4

## Pages: /infrastructure/models, /infrastructure/profiles

## Score /10 (as HMI)
**6/10** — down from last round's 8 not because anything regressed, but because this round's question is the one the page can't answer: *"what model is running where, and is it the one I validated?"* The answer exists end-to-end in the plumbing — sha256 is computed at upload, rides the cfg to the edge, is verified on download, and the edge reports back which versions are loaded — and **none of it is rendered**. As a lifecycle manager it's good; as an audit surface it's a black box.

(Note: the demo org renders the empty state — "No models yet" — so this review is code-verified against the seeded schema, not exercised against live rows. Screenshot: `s4-models.png`.)

## HMI/ISA-101 verdicts
- **Provenance is stored, not surfaced.** `ModelVersion` carries `sha256`, `source_format`, `created_at`, `ultralytics_version`, `opset`, `stride`, `license_attested_at`, `notes`, `created_by` (`web/src/features/vision/api.ts:11-16`; backend `version_json` at `backend/app/vision/models.py:63-72`). The table renders exactly five fields: version number, status, class count, size, imgsz (`ModelsPage.tsx:54-58`). For a vision audit, sha256 *is* the artifact's identity — without it, "v3" is a label, not a verification.
- **Pin-state is invisible until it bites.** `camera_models` pins exist; archive and delete are refused with `409 version_pinned` (`models.py:316,321,338`). So the only way to learn a version is deployed is to try to kill it and get slapped. There is no "3 cameras pinned" column, no per-version list of which cameras/edges run it. ISA-101 would call this an undisplayed interlock — the state exists but the operator can't see it before acting.
- **"Active" ≠ "running," and the UI doesn't say so.** Activation flips one row's status (`models.py:291-294`) — siblings stay active. Deployment truth is per-camera pins, but the word "Active" reads as "this is what's deployed." An auditor skimming the table will misread lifecycle state as deployment state.
- **Fetched but dropped:** the model list already computes `version_count` and `active_version` (`models.py:114-117,126-128`) and the card header shows neither — only name + task (`ModelsPage.tsx:134`).
- **No reverse lookup.** CameraTile shows `model_state`, engine, latency (`CameraTile.tsx:63-74`) but never the model name/version actually running. Answering "what runs where" costs one ModelPanel drill-down *per camera* — O(n) clicks with no aggregate view in either direction.
- **Verification is real but silent.** The wire protocol delivers sha256 in the model cfg block (`models.py:393`, `cameras.py:107`); the model-server validates the hash pattern and verifies bytes on download (`model-server/server/app.py:23`, `store.py:39-42`); the edge reports `loaded` version UUIDs in capabilities (`edge-bridge/.../runner.py:214-225`, typed at `api.ts:35`). Reconciliation — "pinned v3, edge loaded v3, sha verified" — is computed nowhere and displayed nowhere. A pinned-but-not-loaded or loaded-but-unpinned drift would be invisible.
- **Bench-FPS honesty holds.** `cam.model_version === pin.model_version_id && Number.isFinite(bench_fps)` gate before showing FPS, else "pending" (`ModelPanel.tsx:104-112`). Still correct, still rare.
- **Profiles: honest but hand-mirrored.** Hardcoded `PROFILES` array (`ProfilesPage.tsx:19-24`) duplicates edge-bridge's adapter inventory by comment-and-convention — guaranteed drift. Worse, the IN USE count keys on `d.adapter` (`:35-42`), so a gateway running an adapter *not* in the hardcoded list vanishes silently instead of showing as an unlisted row. Read-only + "Coming soon" rows are the right honesty posture; the data source is wrong.

## AI-slop flags
- The convert-hint banner ("A .pt file is converted to ONNX in an isolated container") is truthful and specific — *not* slop. No slop found on these pages; the sin here is omission, not fabrication.
- Minor: truncated `failure_reason` with `title=` hover (`ModelsPage.tsx:55`) — fine, but the failure of a *conversion* (the .pt path) deserves the opset/ultralytics context that exists in the row and is never shown.

## What works
- Real lifecycle state machine enforced server-side: processing→draft→active→archived, plus failed with reason. `.pt` uploads land as `processing` with null fields and come back through the converter — no fake instant readiness.
- AGPL attestation gate is a real gate: `activate` 400s without `attest:true`, stamps `license_attested_by`/`_at`, writes an audit record (`models.py:282-304`). The checkbox UI forces a deliberate act (`ModelsPage.tsx:80-92`).
- `.pt` pickle is scan-gated before spool (`models.py:212-218`) and never opened by the main server — the banner's claim is backed by code.
- Upload integrity: streamed, size-capped, sha256 computed from actual bytes (`models.py:208`), task-mismatch refused, class-count mismatch refused (`models.py:273-275`), one-time class naming (`classes_already_set`).
- Version numbering serialized under row lock; deletes/archives blocked by FK/pin checks; audit events on every mutation.
- Pin select offers only `active` versions (`ModelPanel.tsx:26`) — you can't pin a draft.
- Profiles IN USE links filter the device list (`adapter:modbus`) — counts are navigable, not decorative.

## Top fix
**Make the version row self-verifying and the pin-state visible.** Add to the version table (or an expandable detail row):
1. `sha256` short-hash with copy button — the artifact's identity;
2. `source_format`, `created_at`, `ultralytics_version`/`opset` — provenance;
3. `license_attested_at` (+ attested-by) — the activation record;
4. **Pins column**: count of `camera_models` rows + camera names, click-through to Cameras — so "what's running where" is one glance, not n drill-downs, and a version refuses archive *visibly* before you click it.
Then reconcile: the edge already reports `loaded` version IDs in capabilities — flag any camera where pinned ≠ loaded. That single "verified/drift" badge turns the sha256 plumbing (which is genuinely excellent) into the audit answer it's currently hiding.

---

<!-- ====================================================================== -->
## [33/48] File: `round4/agent-04-visionrules.md`

# Agent: vision-rules-designer — round4

## Pages: /infrastructure/rules
Surface: `web/src/features/vision/RulesPage.tsx` (461 lines) + `features/vision/api.ts` (describeRule, rule types) + `features/vision/i18n.ts` (`vis.*` bundle, en/th). Served as a built nginx bundle in `webservice-web-1` — the live screenshot showed the camera-scoped empty state ("No cameras yet." on Site B / edge-b), so most verdicts are code-grounded, not pixel-grounded.

## Score /10 (as HMI): 6
Pre-fix it was a 5 — the rule grammar and safety scaffolding are genuinely right, but four visible labels lied about what the control does, which is exactly the kind of thing that makes a QC engineer stop trusting a screen. After the label fixes it earns a 6; a real zone tool and an org-wide audit view are what stand between this and an 8.

## HMI/ISA-101 verdicts

**Would a QC/vision engineer trust the grammar?** Yes — "When [class] [score ≥ N%] [in zone] for [N frames / ms / count ≥ N] → [actions]" is a real edge-vision rule grammar. It is the same trigger model Cognex/Keyence/Omron recipe screens use: detection class + confidence threshold + ROI + debounce → discrete output. `hold_frames` is debounce — the single most important nuisance-alarm defense on a vision line — and `hold_ms`/`count_in_zone` cover dwell and count-based triggers. This is not a toy condition builder.

**Sentence builder vs form fields.** The sentence layout is the right choice *for this grammar*: it reads like the requirement spec a process engineer wrote, keeps the whole trigger on one visual line, and the same phrase is now rendered read-only under each rule name via `describeRule()` — list and editor speak the same language, which is what ISA-101 calls consistent presentation. Its weakness is that it degenerates gracefully into a form anyway: five inline editors plus a nested polygon editor that expands below the "sentence." Beyond ~4 conditions the sentence metaphor stops paying rent, but at this grammar's size it still beats a labeled field grid.

**Trust breakers (all fixed this round):**
- Read-only notice said "change **models**" on the rules page (`vis.readOnly` reused from ModelsPage) → new `vis.rulesReadOnly`.
- Row action labeled **"Test"** actually opened the edit form (`vis.test` is the model-test key) → `vis.edit`.
- Submit said **"Save class settings"** (ModelPanel's key) → `vis.saveRule`. On a rule that can write PLC tags, a button claiming to save "class settings" is a genuine mislabeling hazard — the operator cannot tell what scope the write covers.
- Mode column showed **"Fired"** (`vis.kind_rule_fire`, an *event* kind) for every non-dry-run rule including ones that never fired → `vis.live` ("Live"), header `vis.colKind` → `vis.colMode`. "Fired" asserts a history that may not exist — a configured rule is live, not fired.
- `describeRule()` existed exported with a docstring describing exactly this UI and was never called → now renders "When person ≥ 70% zone 5 frames" under each rule name in the list. A rule list that shows only names forces an operator to open each rule to audit it; the sentence fixes that.

**What's genuinely good SCADA thinking:** dry-run default on every new rule (prove-before-actuate commissioning practice); the PLC-write confirmation names the *tag and the value*, not just "are you sure"; the amber "Writes to PLC" badge sits in the list row where it belongs rather than buried in the editor; dry-run results render inside the editor they validate; `allow_cloud_write` + `offline_write_window_s` show real edge-thinking about store-and-forward write windows; the lede states where rules execute ("on the gateway next to the camera") — correct mental model.

**Still wrong:** zones are authored by typing normalized polygon coordinates into x/y text fields. No vision engineer has ever drawn an ROI as floats; the industry pattern is drag-a-rectangle on a live frame or last snapshot. This is the largest functional trust gap. Second: no org-wide rules view — `visionApi.rules(org)` exists (api.ts:83) but the UI is camera-scoped only, and `CameraSelect.tsx:2` notes no org-wide camera endpoint exists, so "show me every rule that writes to line 2" requires visiting every camera. For audit/compliance that is a real gap. Minor: `{!cam → "No cameras yet."}` conflates "no camera selected" with "none exist" (line 239) — visible in the screenshot.

## AI-slop flags
- **Nearest-neighbor i18n reuse**: `vis.readOnly`, `vis.saveClassSettings`, `vis.test`, `vis.colKind`/`vis.kind_rule_fire` were all grabbed from sibling surfaces (models panel, events table) instead of purpose-written keys. Functionally wired, semantically wrong — the signature pattern of copy-reuse generation.
- **Dead affordance**: `describeRule()` (api.ts:159) shipped with a docstring describing the exact UI it was built for and zero call sites — spec written, wiring forgotten.
- **Form-generator answer to "zone"**: numeric polygon point rows are what you produce when you serialize the data model instead of designing the interaction.
- The shared `vis` namespace itself is the enabler: models/rules/events/test all draw from one flat key pool, so wrong-key reuse has no friction. Rules copy should be its own namespace block.

## What works
- Real vision-rule grammar (class + score + ROI + debounce/dwell/count → action set incl. plc_write, counter, alarm, notify, snapshot).
- Dry-run-by-default with in-editor results and a typed PLC-write confirmation naming tag=value.
- Safety-relevant state surfaced in the list ("Writes to PLC" badge, now the human-readable sentence via describeRule, Live/Dry-run mode).
- Per-camera scoping via the site→edge→camera cascade with `?cam=` deep-linking — consistent with the events page.
- en + th bundles kept in parity (fixed keys translated in both).

## Top fix
**Draw the zone on a camera frame.** Replace the x/y polygon text fields with a rectangle/polygon drag tool over the camera's last snapshot (snapshot endpoint already exists: `camApi.snapshot`); keep the numeric editor as an advanced fallback. Until then "in zone" is unverifiable — the operator cannot see what they configured, which is the one thing a vision-rule screen must never get wrong. Runner-up: an org-wide rules table (which rule writes to which tag, on which camera) using the existing `visionApi.rules(org)` — needs an org camera listing that doesn't exist yet.

---

<!-- ====================================================================== -->
## [34/48] File: `round4/agent-05-otsec.md`

# Agent: ot-security-officer — round4

## Pages: /security, /security/access, /security/api, /security/findings

## Score /10 (as HMI)
**5/10.** As a SaaS posture page it is honest and competently assembled. As a plant-console page answering "is my control surface safe?" it answers a different, easier question: "is my console account hygiene OK?" The control surface — zones, conduits, remote access paths, protocol security — is simply not modeled. The one genuinely OT-relevant check (edge heartbeat, ED-3) is ranked LOW beneath a MEDIUM SSO-enrollment check, and both sit under a heading that claims "high-severity." Last round's flags were not fixed; the heading is now *more* wrong (0 of the 2 shown items are HIGH).

## HMI/ISA-101 verdicts

- **"WDS baseline v1" is still invented authority.** An auditor will ask "WDS whose baseline?" There is no such framework. Either label it honestly ("Vissonian recommended policy") or — better — crosswalk each rule to IEC 62443 SR/CR identifiers: AC-1 → SR 1.x (identification & authentication control), ED-1 → SR 1.x/2.x (credential management / use control), ED-3 → SR 7.x / 3.x (resource availability, communication integrity), MN-1 → SR 6.x (timely response to events, audit). A crosswalk earns trust; an invented baseline spends it.
- **"Posture score 50%" is compliance theater, not a security level.** IEC 62443 measures SL-T (target) vs SL-A (achieved) *per zone*. An unweighted global mean of four rules — where an INFO audit-log check cancels a failed edge-heartbeat check — has no engineering meaning. A plant can score 90% and still have one flat, unsegmented control network. If a number must exist, weight it by consequence: loss of edge visibility should cost more than an SSO-enrollment gap.
- **Severity inversion from an OT view.** ED-3 "edge gateways should report a heartbeat" = the console has lost visibility into the field boundary. That is the precondition for an undetected intrusion and the OT analogue of "alarm system offline." It is LOW. AC-1 "members should sign in through SSO" = account-centralization hygiene — real, but it does not touch the control path — is MEDIUM and ranked #2. The ranking answers "is my IdP tidy," not "is my control surface safe."
- **"Top 3 high-severity rule failures" heading is factually wrong** — it lists a MEDIUM and a LOW, numbered "2" then "1" in reverse order. On a security page, mislabeled severity rankings are a credibility-critical defect, not a cosmetic one.
- **Area access is the seed of real zone enforcement — and it's fail-open.** "Operators with area access can only send commands in those areas. No ticks = every area." Default-permit is the opposite of IEC 62443 FR 2 (least privilege / deny by default). "Admins and owners can always command every area" means the most powerful accounts bypass the only segmentation control on the page. And it's an app-layer ACL — nothing says the enforcement holds at the gateway/protocol layer.
- **"Reconnecting / values may be out of date" banner is genuinely good** — on a security page, degraded telemetry *is itself a finding*, and the console admits it rather than painting green. Keep this; it is the most ISA-101-honest element on all four pages.

## AI-slop flags

- **Auto-templated event descriptions**: every row on /security/api reads "Tracks edge provisioned." / "Tracks camera created." — the event name with dots replaced by spaces, wrapped in "Tracks … ." Zero semantic content. The dangerous interpretation is never stated: "edge.provisioned by an unrecognized actor = possible rogue gateway on your control network." Templated filler where meaning was needed.
- **Unresolved actor UUIDs**: every ACTORS cell shows `user:0199d000-0000-7000-8000-00000000d003`. No operator can read that. Resolve to member name/email — on a page whose job is attribution, a raw UUID is a dead end.
- **"EXCESS ACCESS" tag on AC-1** is a taxonomy mislabel — members not using SSO is weak authentication, not excess access. Wrong finding categories erode trust in the whole findings model.
- **"No rule for this event" on every row** — the highest-consequence events (command.accepted, alarm.ack, edge.provisioned, incident.declared) ship with zero default detection rules. A detection page that detects nothing by default is scaffolding, not protection.
- **"Business logic / App & API protection" framing** is SaaS abuse-detection vocabulary transplanted onto a plant console. The OT question is "who sent a control command, from where, over which path" — not "which clients spike."

## What works

- **Honest empty states everywhere**: "No sign-in events recorded yet," "No API keys," "No gateway credential is due for rotation." Nothing fabricates a green check.
- **IdP-honest MFA copy**: "Your current session did not use two-factor sign-in. Turning this on will ask you to set up an authenticator app first." Tells you the consequence before you click.
- **Members table shows "Token" sign-in honestly** and leaves MFA as "—" rather than pretending.
- **The right event classes are being logged**: command.accepted, alarm.ack, incident.declared, edge.provisioned — these are the audit events that matter in an incident review. The substrate for real detection exists; only the defaults and descriptions are missing.
- **Findings have affected-resource counts and resource-type facets** (Edge gateway 1, Member 2), and blast-radius/remediation exist on expand per prior review.
- **Area-scoped command authorization exists at all** — conceptually the right primitive; it just needs deny-by-default and enforcement below the app layer.

## What's missing for a real OT review (the control surface itself)

1. **Zones & conduits (62443-3-2/-3-3)**: no zone inventory, no conduit rules (which protocols cross which boundary), no SL-T vs SL-A per zone. "Area access" is a shadow of this at the app layer only.
2. **Remote access paths**: vendor/integrator VPN, jump-host sessions, time-boxed access, session recording — the classic OT intrusion vector is entirely unmodeled. Sign-in events and API keys do not cover an engineer remoted into a cell area.
3. **Protocol security**: nothing on Modbus/TCP cleartext, OPC-UA security mode (None vs SignAndEncrypt), DNP3 secure authentication, MQTT/TLS, or gateway firmware signing. The console secures the cloud edge of the edge and stops.
4. **Compensating controls**: OT often can't rotate/patch/enable. Findings need a "compensating control / risk-accepted" disposition (e.g., conduit ACL restricts the path), not binary pass/fail.
5. **Consequence-aware severity**: a failed check on a command path to a boiler and a failed check on console SSO are presented as commensurable. Blast radius should weight severity.
6. **A zone/area facet in Findings**: the natural OT cut — "show me findings touching Area 3 / the packaging cell" — doesn't exist; filters are severity, resource type, control.
7. **Break-glass & shared-station realism**: "Require 2FA for everyone" is a blunt toggle; shift consoles on shared workstations need role/area-aware policy and an audited break-glass path.

## Top fix

**Kill the invented baseline and the unweighted score; replace with a zone-anchored posture view.** Concretely: rename "WDS baseline v1" to an honest policy name and crosswalk each rule to its IEC 62443 SR (AC-1→SR 1.1, ED-1→SR 1.x, ED-3→SR 7.x, MN-1→SR 6.1); group the overview by plant area/conduit rather than control family; weight the score by consequence so a dead edge heartbeat can never be laundered into 50% by an INFO pass; and flip "Area access" to deny-by-default with admins explicitly listed as zone-crossing principals. One change does the most work: make severity rank by what a failure lets happen to the process — then ED-3 (blind at the field boundary) outranks SSO hygiene, the "high-severity" heading becomes true, and the page starts answering "is my control surface safe" instead of "is my IdP compliant."

---

<!-- ====================================================================== -->
## [35/48] File: `round4/agent-06-admin.md`

# Agent: plant-sysadmin — round4

## Pages: /admin, /admin/users, /admin/storage

## Score /10 (as HMI)

**6/10** — down from 7/10. Same shell as ops pages, same honesty idiom (staleness banner, tri-state Garage status, scoping banner), so not structurally an afterthought. But every defect flagged last round is still shipping, and the page set fails the one job I actually came for: an account/key/storage *audit*. A maintenance surface that fabricates a number and can't tell me when anyone last signed in is not boringly correct.

## HMI/ISA-101 verdicts

- **Dormant-account audit: FAIL.** Members table (s4-users.png) still has exactly three columns: USER, ROLE, STATUS. Both members read "Active" — but "Active" here means membership status, not activity. There is no last-sign-in, no joined-date, no MFA flag, no "never logged in" state. demo-viewer could have been dormant for a year and this page would still show a green dot. An admin cannot answer "who should I deprovision?" from this screen. This is the core maintenance question and it's unanswerable.
- **Self-harm guard: PARTIAL.** "Only an Owner can grant the Owner role" is correct constraint copy, and role dropdowns are inline. But demo-admin's own row has an editable role dropdown and a Remove button — no visible protection against an admin demoting or removing the last/only admin. On a 2-member org that's a one-click lockout path with no friction indicator.
- **Storage truth: MOSTLY GOOD, ONE LIE.** Tri-state survives: "Stored in Garage: 0 / Garage is not configured" correctly distinguishes *zero* from *not configured* — exemplary, keep it. The scoping banner ("You see the whole organization because you are an admin…") is exactly the kind of boring, correct copy I want. **But** the Size tile still reads **"1 KB" while Objects reads 0** (s4-storage.png). Zero bytes rendered as a nonzero number is a fabricated value on a maintenance surface — the single worst sin in this persona's book. It was flagged last round; it's still there.
- **Orphan/replication surface: PARTIAL.** "Not yet in Garage: 0" is the right primitive for pending-replication detection. However, with Garage *not configured*, that 0 conflates "nothing pending" with "replication impossible" — the metric should grey out or read "—" when the backend it measures is absent, same as the heartbeat "—" convention used elsewhere.
- **Staleness honesty: PASS.** "Live feed reconnecting. Values on screen are the last ones received and may be out of date." — present on all three pages. Admin surfaces inherit the same staleness contract as ops surfaces. Correct.
- **Gateway table ambiguity:** edge-b is "disabled" and edge-b-e2e is "active", yet HEARTBEAT and CLOCK both show "—" for both rows (s4-admin.png). An *active* gateway with no heartbeat is a status contradiction — either the heartbeat column has no data source wired, or "active" doesn't mean "reporting". Pick one. BUFFER bars render with no numeric label — a bar of unknown capacity against an unknown cap is decoration, not maintenance data (prior "buffer % vs hidden cap" flag persists in spirit).
- **Empty states:** the ✓-checkmark-as-empty-state bug is unfixed — "No pending invites", "Nothing uploaded yet" (×3) all lead with a checkmark glyph. A checkmark is a status judgement ("verified", "healthy"), not an absence marker. On a security-adjacent page, "No pending invites ✓" reads like "invites audited and clear," which is a claim the page isn't making.

## AI-slop flags

- **"1 KB" for zero objects** — the formatter's minimum-display-unit logic leaking a fabricated nonzero. Classic generated-code rounding bug nobody read the output of.
- **Checkmark empty states** — an LLM reaching for "friendly empty state" clip-art semantics instead of absence semantics.
- **Org slug `pytest-org-b-d1f4011e`** rendered in the admin header strip — fine for demo mode, but it's test-harness naming surfaced as production identity; polish debt.
- **"Active" green dot** on members with no underlying activity data — status theater: looks like health, measures nothing.
- **Buffer bars with no numerals** — chart-as-decoration pattern.

## What works

- Information architecture: ORGANIZATION / IDENTITY & ACCOUNTS / ACCESS grouping in the sub-nav is clean and matches how an admin actually thinks (org → alarm rules → storage → users → audit log → API keys).
- Role model copy is honest and layered: "What each role can do" collapsed explainer, Owner-grant constraint spelled out, invite flow explains the Viewer→Admin→Owner promotion path in plain language.
- "How files are kept apart" panel on Storage is genuinely good security truth: server-built object keys, org-id scoping, no filename-derived keys — the kind of boring, correct invariant statement that builds trust.
- Consistent identity strip (org, site, role, permission summary) on every admin page — no page lets you forget what scope you're operating on.
- Remove/role controls are per-row, visible, and labeled — no hidden kebab menus on a maintenance table.

## Top fix

**Make the numbers literally true, then make them auditable.** Two commits, in order:

1. Fix the byte formatter: 0 objects must render "0 B" (or "—"), never "1 KB". Fabricated nonzeros on a storage surface erode trust in every other number on the page — including the ones that are correct.
2. Add LAST SIGN-IN and JOINED columns to the Members table, and a "Never signed in" status variant. Without them the page cannot perform the most basic maintenance duty — identifying dormant accounts for deprovisioning — and the green "Active" dot remains status theater.

Secondary queue (unchanged from last round, still open): replace ✓ empty-state glyphs with neutral absence markers; grey out "Not yet in Garage" when Garage isn't configured; wire heartbeat/clock data or drop the columns; put numerals on buffer bars; guard self-demotion/last-admin removal.

---

<!-- ====================================================================== -->
## [36/48] File: `round4/agent-07-platform.md`

# Agent: vendor-noc-designer — round4

Persona: senior multi-tenant ops designer. `/platform` is the vendor's own NOC — the screen a WDS operator opens to answer "which tenant is hurting right now?"

## Pages: /platform + subroutes

- `/platform` — PlatformPage (`PlatformPage-CJNrkjIK.js`, fresh build off `index-Criwe5Qj.js`)
- `/platform/orgs/:id` — PlatformOrgPage (`PlatformOrgPage-05MNZLaZ.js`)
- `/platform/support`, `/platform/announcements` — PlatformSupportPage / PlatformAnnouncementsPage (both in `PlatformOpsPage-pom4lDJb.js`)

**Screenshot evidence** (`s4-platform.png`, `?demo=admin`, 1440x900): full tenant chrome (sidebar: Dashboards…Admin, org picker `pytest-org-b-…`, "Off shift", Reconnecting) with header `Platform` + lede "WDS staff tools — tenants, support access, announcements.", header links `Support sessions` / `Announcements`, and a warn banner **"This area is for the WDS team."** — gate confirmed, as expected.

## Score /10 (as HMI)

**5/10.** Security posture is right (API-enforced 403, not just hidden nav), and the support-session trust model is genuinely good. But behind the gate this is a directory + CRUD console, not a fleet triage surface: it cannot rank tenant pain, cannot flag stale ingest, has no per-tenant alert volume, and no search. As the vendor's own NOC it answers "what exists," not "what needs me."

## HMI/ISA-101 verdicts

1. **The fleet page answers the wrong question.** The health strip (`platform-health`, 30s poll) shows *accounting*: orgs total/suspended/deleted, MQTT up/down, jobs pending/dead, notif sent/failed 1h, support sessions. A NOC landing view must answer *"who needs attention first?"* — that means a **worst-first tenant ranking**, not global counters. Global "jobs dead: 12" with no per-tenant attribution sends the operator hunting through a table that offers no hunt tools.
2. **No abnormal-state encoding anywhere.** ISA-101's core move — reserve salience for abnormal — is absent *and* its prerequisite (thresholds) is absent. Suspended/dead-job counts render the same neutral gray as healthy zeros. Per-tenant `edge_health` renders as bare text `3/5`; `last_activity_at` renders as a `toLocaleString` timestamp with no age math, no staleness color, no "gone quiet" flag. **Ingest freshness is the #1 tenant-health signal for an ingest SaaS and it is shown as a raw timestamp.** Relative age + color only when stale is the fix.
3. **Conditional tiles destabilize the layout.** `notifSent`/`notifFailed` tiles render only when `notification_deliveries_1h` exists; the whole health card returns `null` until first data arrives — pop-in + grid reflow on every cold load.
4. **MQTT up/down as a single boolean** is demo-grade telemetry for a NOC (no broker redundancy, no per-tenant connection counts, no flap history).
5. **Confirms are asymmetric and backwards-weighted.** Suspend gets a `danger:true` Confirm dialog (correct). But **unsuspend / "Restore access" is one click**, plan+limits save is one click, feature-flags save is one click, support-session revoke and announcement revoke are one click. The highest-blast-radius staff actions (billing plan, tenant-wide flags, restoring a suspended tenant) get less friction than posting an announcement.
6. **Raw-JSON god-mode inputs.** `plan_limits` and feature flags are free-text JSON textareas `JSON.parse`d inside the mutation — no client validation, no schema hints, no flag catalog. A typo produces `Request failed: SyntaxError…` via `String(error)`. `trial_ends_at` and announcement `ends_at` are raw ISO text inputs with a placeholder — no date picker, no validation.
7. **Tenant table has no search, filter, sort, or visible pagination** — fine at 20 tenants, unscanable at 500. No lifecycle column filter (suspended/deleted are inline badges in the plan cell).
8. **Gate leaks the surface it hides.** Denied users still see the lede "WDS staff tools — tenants, support access, announcements." *and* live `Support sessions`/`Announcements` header links (rendered unconditionally in the PageHeader actions) that lead to the same wall. Either 404 the route for non-staff, or gate the links; a half-open gate is the worst of both.
9. **Support sessions are the best-designed thing here.** Time-boxed (5–60 min), reason-required (min 3 chars), and — critically — tenant-transparent: `sessionOpened` = "Session opened — the tenant can see it in their audit log," and the tenant-side page explains "Time-boxed, read-only sessions the WDS team has opened into this organization." That is how vendor access *should* work; it deserves more prominence than a text link.
10. **Announcements are adequate**: per-org targeting, info/warning/critical severity, revoke with dimmed revoked rows. Severity renders as bare text in the list — `critical` should carry its color; same encode-abnormal gap.

## AI-slop flags

- Health strip = generic stat-card grid; the two "interesting" tiles are conditional so the grid literally reshapes based on data presence.
- `up`/`down` string for MQTT, `3/5` string for edge health, ISO strings for everything temporal — every signal reduced to a bare string because "table of strings" is the LLM-default console.
- Suspended/deleted states as inline text badges crammed into the plan cell rather than a status column — the classic "add another ad-hoc badge" accretion pattern.
- A "reason (shown to no one but staff)" placeholder that then renders that same reason back in a banner — internally consistent, but the kind of copy no human NOC designer writes.
- Announcement composer: title input + textarea + severity select + org select + ISO text input = the default five-field CRUD form, zero preview of how the tenant will see it.

## What works

- **Real authorization**: the denied banner is driven by an API error (`isError && isForbidden`-style check), not client-side hiding — the backend actually refuses; verified by the 403→banner path on `demo=admin`.
- Support-session trust model (time-boxed, read-only, tenant-visible in audit log) — best-in-show.
- Suspend requires a reason and a danger confirm; suspended orgs show the reason to staff; deleted orgs persist as dimmed rows (audit trail).
- Sensible poll rates (health 30s, tenants 60s); loading/error states all handled (skeleton, denied banner, retry card).
- `last_activity_at` and `edge_health` per tenant already exist in the API — the seeds of a real triage view are already wired.
- Fully i18n'd (EN+TH confirmed in `i18n-CbN2V2W8.js`), including the staff console — rare and right.

## On the verdict questions

**What should the fleet page answer?** In order: (1) *Which tenants need attention now?* — worst-first ranking by composite health (edge offline ratio, dead jobs, alert/notification failure rate, ingest staleness); (2) *Is each tenant still ingesting?* — age since `last_activity_at` with staleness thresholds, not a timestamp; (3) *Where is alert volume concentrated?* — per-tenant notification sent/failed, not a global 1h counter; (4) *What's degraded globally?* — the existing health strip is fine as a secondary strip once the tenant table does triage.

**Is gated-invisible right vs a demo persona?** Yes — `demo=admin` is a *tenant* admin, and showing them a staff console full of real tenant names would be worse than the wall. But two refinements: (a) the lede and subroute links should not render for the denied — currently the gate advertises and links the surface it protects (404 or hard-gate it); (b) if the demo story *needs* the NOC visible to evaluators, the right move is a `demo=noc` persona over synthetic tenants, not opening the real console. The gate itself is correct — keep it.

## Top fix

**Turn the tenant table into a worst-first triage list.** Default-sort by a computed health score (edge offline ratio → dead jobs → notification failure rate → ingest staleness), add an "Ingest age" column showing relative time colored *only* when stale, add search + lifecycle filter chips. That one change converts `/platform` from a directory into a NOC — every other gap (confirms, JSON inputs, MQTT bool) is secondary polish on a surface that currently can't answer its own first question.

---

<!-- ====================================================================== -->
## [37/48] File: `round4/agent-08-signin.md`

# Agent: hmi-frontdoor — round4

## Pages: /signin, /orgs/new

Verified against live render (1440×900 + 390×844) and source
(`web/src/features/auth/SignInWall.tsx`, `web/src/App.tsx`, `web/src/lib/i18n.ts`).

**Whale-page check:** `/signin` does NOT show the old whale page. It renders
`SignInWall` — a noir card on a hairline-striped dark field using the `hx-*`
design system carried over from the Hex.tech-derived landing (the class prefix
is literally `hx-`; `hx-noise`, `hx-corners`, corner-tick panel). `/` logged-out
renders `Landing` (vissointan copy on the same Hex-clone chrome — "operations
console your plant deserves", ISA-18.2/ISA-101 name-drops in the marketing
copy). `/orgs/new` logged-out bounces to the wall — byte-identical screenshot,
correct gating (`App.tsx:238-242`, `297`).

## Score /10 (as HMI)

**4.8 / 10** — up from ~4.4. Real fixes landed (token validated before commit,
token section gated on `dev_tokens`, denied-state handling), but the door still
speaks developer to an operator audience and four paths compete with no clear
primary.

## HMI/ISA-101 verdicts

- **SSO is not primary — it's a footnote.** The strongest visual element is a
  *disabled* Google button; below it "Continue with password" looks like a local
  credential form but actually calls `signInWithSSO(login_hint)`
  (SignInWall.tsx:174-185). The real SSO path, `auth.company` = "Log in with
  SSO", is a 13px text link (line 186-189). For a plant, SSO/AD should be THE
  button; three pseudo-paths is a decision the operator shouldn't have to make.
- **"Token (required)" is wrong twice** (`i18n.ts:113`): it's not required
  (three other sign-in paths exist on the same card), and "token" is
  commissioning-engineer vocabulary. A paste-a-token field is legitimate for
  the integrator laptop during FAT — it is *never* right as a peer option on a
  shared-kiosk front door. It is at least gated on `cfg?.dev_tokens`
  (SignInWall.tsx:194), so prod hides it — but this deployment renders it, so
  judge it present.
- **No kiosk affordance at all.** No badge-tap/PIN fast user-switch, no "this
  kiosk" scoping, no last-operator memory. Shift change on a floor HMI means
  typing full credentials under time pressure; the wall offers nothing between
  "full credential ceremony" and "one-click demo-admin".
- **`demo-admin` chip = privilege escalation on the door.** Three demo chips
  (SignInWall.tsx:215-225) call `signIn('demo-*')` directly, bypassing even the
  token validation added this round. The hint documents only operator+viewer;
  demo-admin is a silent third key under the mat (`i18n.ts:92` vs :117).
- **Credential-in-URL still alive:** `?token=…` / `?demo=operator` auto-login
  (App.tsx:219-227). Stripped from the bar after use but already in history,
  proxy logs and any shared screen-recording.
- **Terms/Privacy are compliance theater:** both `<Link to="/">`
  (SignInWall.tsx:239-240) — they now resolve to the marketing landing instead
  of 404, which is worse than dead: it *looks* like it worked.
- **Jargon leak to end users:** disabled-Google note reads "An admin can
  enable it with `make idp`" (`i18n.ts:106`) — a Makefile target on a login
  wall. ISA-101's plain-language discipline starts at the front door.
- **Aesthetics vs. ISA-101:** near-black field, pink accent, noise texture,
  corner ticks — developer-noir, not control-room. Pink is doing
  brand-decoration duty everywhere, so it can't mean "abnormal" anywhere —
  classic reserved-color violation in spirit. EN/TH toggle on the wall is the
  one genuinely plant-floor-aware choice (though `make idp` got translated
  verbatim into Thai, `i18n.ts:971`).

## AI-slop flags

1. Two buttons, one destination — "Continue with password" and "Log in with
   SSO" both invoke `signInWithSSO`; the labels promise different mechanisms.
2. "(required)" qualifier on a field sitting under an "or log in with a token"
   divider — self-contradictory copy nobody re-read.
3. Disabled-button-with-tooltip pattern showing devops instructions
   (`make idp`) to the audience least able to act on it.
4. Demo chips that skip the validation path the same file just added —
   security fix routed around by its own convenience UI.
5. Footer legal links that silently retarget to `/`.
6. Dead i18n keys: `wallTitle` "Plant Operations Console" / `wallBody` exist
   (`i18n.ts:94-95`) but the wall renders plain "Log in" — the product
   explanation complaint from last round was "fixed" in the string table only.
7. `hx-` prefix everywhere — Hex.tech scaffolding still wearing the donor's
   monogram.

## What works

- Token is validated via `/api/me` before `signIn` commits it; failure renders
  an inline `role="alert"` error instead of the old silent blank remount
  (SignInWall.tsx:81-95, 209-214). Real fix.
- Token block entirely gated on backend `dev_tokens` flag — clean dev/prod
  seam (line 194).
- FR-28 denied state: names the signed-in account, offers recheck + switch —
  the best piece of kiosk thinking on the page (lines 116-143).
- Disabled Google button explains *why* instead of dead-clicking — right
  instinct, wrong message content.
- Mobile 390px: card now fits (near full-bleed, right edge flush/clipped
  border — tight but no scroll).
- EN/TH toggle reachable before login — correct for a Thai plant.
- `/orgs/new` correctly refuses logged-out access; `noOrg` users get
  `CreateOrgPage` post-login (App.tsx:242).

## Top fix

**Make the door single-path and kiosk-shaped.** One primary button —
"Sign in with your company account" (SSO). Remove the password-labeled decoy
or relabel it honestly. Move the token form + demo chips behind a collapsed
"Development sign-in" disclosure rendered only when `dev_tokens`, and delete
`?token=`/`?demo=` URL login outright (App.tsx:219-227). Point Terms/Privacy at
real pages or cut the line. Then, for the actual floor case, add the thing
nothing here supports: a fast switch-user — badge/PIN or role-pinned quick
login scoped per kiosk — because three clicks of ceremony per shift change is
how operators end up sharing the admin's session.

---

<!-- ====================================================================== -->
## [38/48] File: `round4/agent-09-settings.md`

# Agent: hmi-settings-designer — round4
## Pages: /settings, /settings/org

## Score /10 (as HMI)

**3/10.** Both pages work and are honest — but the information architecture is organized by backend file (`features/platform/DangerZone.tsx`, `platform/api.ts`) rather than by the operator's task model. The most damning single fact: the URL `/settings/org` renders a page whose entire H1 is "Danger zone" (App.tsx:296 mounts `DangerZone` directly). "Org settings" as a surface does not exist; a GitHub-style easter-egg label has been promoted to a subsystem name. In an HMI you'd never name a whole screen DANGER — the destructive card is *one panel at the bottom*, not the plant.

## HMI/ISA-101 verdicts

- **Where an admin LOOKS vs where things ARE** (the core failure):

| Task in the admin's head | Where they look | Where it actually is |
|---|---|---|
| Org profile / rename / org identity | Admin → Organization | Nowhere. `/admin` (AdminPage.tsx) is org *status* (edges, sites, tags); no org settings anywhere |
| Webhooks / integrations | Admin or Developer Portal | Inside the "Danger zone" page (`DangerZone.tsx:67-141`) |
| Data export / backup | Settings or Admin → Org | Inside the "Danger zone" page (`DangerZone.tsx:20-64`) |
| API keys | Admin → Access → Keys ✓ | `/admin/keys` — but webhooks live two nav trees away, splitting the integration surface |
| Plan / billing | Settings | `/settings/plan`, reachable only via a 12px text link inside the **Preferences** card (SettingsPage.tsx:104) or the Admin flyout |
| Leave / delete org | Bottom of org settings | `/settings/org` — correctly located conceptually, but it's the *only* content on the org settings page |
| Tenant view of support sessions | Security or Admin | "Danger zone" page, owner-only card (`DangerZone.tsx:178-191`) |
| Language / mobile prefs | Settings ✓ | `/settings` ✓ — the one place the model holds |

- **Nav label = worst card on the page.** The link to `/settings/org` is rendered as `plat.dangerTitle` = "Danger zone" (SettingsPage.tsx:107-109, i18n.ts:21). An admin hunting "organization settings" will not click "Danger zone"; an admin who clicks "Danger zone" expecting destructive ops gets webhooks. Both directions fail the wayfinding test — the label names the rarest task, not the page.
- **Settings has no nav rail; Admin does.** `/admin/*` gets a proper sectioned left rail (`AdminNav.tsx`: Organization / Identity / Access). `/settings` gets a bare link row crammed inside the "Preferences" card — Activity, Plan, "Danger zone", Platform, Shortcuts — five unrelated destinations in one flex-wrap line (SettingsPage.tsx:97-122). Two adjacent subsystems, two different IA conventions. That's a schema leak, not a design.
- **Destructive affordance wrong.** "Leave organization" renders as a plain `.btn` — in the screenshot it's the blue, primary-looking button on the page (DangerZone.tsx:202-203). Confirm dialog exists (good, DangerZone.tsx:211-215) but the at-rest visual weight says "normal action." ISA-101: irreversible actions get the danger visual language *before* the click.
- **Copy bug, confirmed in screenshot:** the Data export table's empty state renders `plat.webhookNone` = "No webhook endpoints yet" (DangerZone.tsx:46) — wrong string for exports. A user reads that export history is stored in webhook endpoints.
- **Mixed scopes on one page.** `/settings` fuses personal (profile, language, mobile) with org-scoped (plan, danger zone) and platform-scoped (`/platform` link) in one scroll with zero grouping. "My stuff" / "this org's stuff" / "the whole product's stuff" is the single most important split in a settings mental model, and it's unmarked.
- **PageBar/URL mismatch.** URL says `org`, chrome says "Danger zone". The header clock says 17:42, the badge says "Off shift," the status pill says "Reconnecting" — fine for ops, but on a settings page the operator's first question "where am I?" is answered wrong.

## AI-slop flags

- "Danger zone" is cargo-cult GitHub vocabulary applied to a whole route. On GitHub it's a *section* under a real settings page; here it's the *entire page* because someone mounted the component wholesale at `settings/org` (App.tsx:296) — a lazy route-file pun made canonical.
- Raw backend enums as UI labels: webhook checkboxes `alarm_raised`, `alarm_cleared`, `downtime_classified`, `incident_opened` (DangerZone.tsx:101-113); "Sign-in method: dev"; "User ID: dev:admin" — snake_case and dev-auth internals straight onto the glass.
- The org membership table lists 13+ `pytest-org-b-*` / `sec-org-b-*` test tenants as raw `org_id` strings (SettingsPage.tsx:71-78) — seed noise presented as identity data, no display names, no sorting, no filter.
- Carried over from prior rounds: `/settings/plan` still has `mailto:support@example.com` and "WDS team" codename leakage; exports download as `wds-export-*.zip` (DangerZone.tsx:55).
- "Preferences" card is a junk drawer: language, a theme *note* (no control), then the entire settings sub-navigation disguised as footer links — the shape of a page that grew by accretion, not by design.

## What works

- `/admin` IA is genuinely good — Org / Identity / Access grouping (AdminNav.tsx:12-23) is exactly a mental-model split, and it even pulls `/settings`, `/settings/plan`, `/platform` into its flyout (nav.ts:187-189), which admits the team *knows* these belong near admin tasks.
- Org membership list with role badges answers "what can I touch" at a glance.
- Confirm dialogs on leave/delete with org name in the title (`leaveTitle`, `deleteTitle`) — correct destructive-action hygiene.
- Webhook HTTPS-only validation and show-secret-once (DangerZone.tsx:91-92, 99) are real security thinking.
- Language switcher, sign-out, and the keyboard-shortcuts trigger are honest, working, low-slop details.

## Top fix

**Create a real "Organization" settings page and demote the danger zone back to a card.** Route `/settings/org` to an `OrgSettingsPage` with the same left-rail pattern as AdminNav — sections: *Profile* (org name/identity, even read-only for now), *Integrations* (webhooks + link to /admin/keys), *Data & export* (exports table), *Lifecycle* (leave/delete, styled danger), with the support-sessions table under *Access*. Move the three misplaced cards out of DangerZone.tsx into those sections; keep `DangerZone` as a bottom card titled "Danger zone" inside the page — matching the convention it copied. While in there: relabel the SettingsPage link from "Danger zone" to "Organization", fix the export empty-state string (DangerZone.tsx:46), and give `/settings` a nav rail so account vs org vs platform scopes are visibly separate. One file move + one nav fix corrects the worst IA inversion in the app.

---

<!-- ====================================================================== -->
## [39/48] File: `round4/agent-10-shifts.md`

# Agent: mes-shift-designer — round4

## Pages: /shifts (+ /shifts/current probe)

**Verdict up front: the page is built wrong, not just named wrong.** `/shifts`
renders `ShiftsPage.tsx` (web/src/features/production/ShiftsPage.tsx), titled
"Shifts & machines" — three admin cards: OEE shift windows (the planned-time
*denominator*), a non-working-day calendar, and per-machine tag→state mapping
with ideal cycle times. That is OEE accounting plumbing. Nothing on the page
answers a single operator question. Meanwhile the actual operator-shift model
already exists in the codebase — and is dead code:

- `web/src/features/teams/roster.ts` — teams, members, equipment ownership,
  and `DEFAULT_SHIFTS` that are already the canonical Thai 3-กะ (A 06:00–14:00,
  B 14:00–22:00, C 22:00–06:00). `currentShift()` even handles the
  night-shift day-rollover correctly; `onCallNow()` resolves "who is on right
  now". **Zero importers.** It is also localStorage-only ("backend has no
  teams/roster table yet") — so even where it would surface, each browser sees
  a different roster. On a shared factory floor that is a fiction, not a
  roster.
- `prodApi.currentShift` (api.ts:87) hits a real backend `/shifts/current`
  endpoint — consumed only by `ShiftBadge` (ShiftBadge.tsx), wired into the
  top bar at Shell.tsx:638. All "now" context = one 11 px pill.
- `/shifts/current?demo=viewer` as a route does not exist — the SPA silently
  fell back to the getting-started landing page (screenshot s4-shiftcur.png
  shows "Overview / Sorting line 1"). A user who bookmarks or types the
  obvious URL gets the onboarding page with no error.
- Handover exists as three orphaned fragments: notebook template i18n strings
  (notebooks/i18n.ts:12,21–23 — no code consumes `tpl.handover`), a dashboard
  "note" widget (dashboards/templates.ts:72), and a report template
  `tpl_shift` "Shift handover" (lib/i18n.ts:750). Three half-features, no
  surface.

## Score /10 (as HMI)

**3/10** as the operator surface the name promises; ~6.5/10 as the admin
config it actually is (well-permissioned, i18n'd, clean skeleton/empty
states) — but it sits in the operator nav cluster `nav.production`
(nav.ts:160, icon `on-call`) next to OEE/Stops/Reports, a place an operator
will open at 06:00 looking for the roster and finding tag-mapping dialogs.

## HMI/ISA-101 verdicts

- **Hierarchy violation (ISA-101 L1 vs config).** Quarterly setup tasks
  (tag mapping, ideal cycle times) occupy a Level-1 operator navigation slot.
  Admin plumbing must live under Admin/Settings, not the daily workflow rail.
- **Semantic hazard — "always planned" empty state.** With no shifts defined,
  the copy admits "the site counts as always planned" (i18n.ts:22) — i.e. the
  OEE availability denominator silently becomes 24/7, understating
  availability loss. Simultaneously the top bar prints "Off shift"
  (i18n.ts:68). Both were visible in one screenshot: the system claims the
  plant is off-shift and fully planned at the same time. On an HMI, a missing
  config should degrade loudly, not launder itself into a KPI assumption.
- **No time context anywhere on the page.** No now-line, no "next change at
  22:00", no week grid, no timezone label (the badge tooltip knows the
  site timezone — `q.data?.timezone`, ShiftBadge.tsx:28 — the config page
  never does; a Thai admin editing 22:00–06:00 windows cannot tell whether
  times are site-local or browser-local).
- **The badge is a dead end.** ShiftBadge is a static `<span>` — it doesn't
  link to /shifts, /shifts/current, or anything. The one live shift artifact
  in the UI is unclickable.
- **Table renders raw ISO weekday numbers** (`s.days_of_week.join(',')`,
  ShiftsPage.tsx:115 → "1,2,3,4,5") although localized DOW names exist in both
  bundles (i18n.ts:25 EN "Mon…Sun", :91 TH "จ.…อา.") — they're used only for
  dialog checkboxes (line 254). A Thai-speaking supervisor reads digits where
  the app already knows how to say จันทร์–ศุกร์.
- **Validation gaps.** `start === end` is the only window check (line 268);
  no overlap detection between shifts, no coverage warning (a config that
  covers Mon–Fri 08:00–16:00 leaves the badge "Off shift" 76% of the week
  with no hint that this is intentional vs broken).
- **Non-working days accrete forever** — a flat list of raw ISO dates with no
  past/upcoming split, no year grouping; after a year of Thai public holidays
  (Songkran, royal birthdays, วันแรงงาน) it becomes noise.

## AI-slop flags

- **Split-brain feature**: two complete, mutually unaware "shift" models —
  server-side windows for OEE math, client-side roster for humans — is the
  signature of features generated ticket-by-ticket with no IA owner.
- **Copy that navigates by name, not by link**: OEE empty state says "Map a
  machine's state and count tags **on the Shifts page**" (i18n.ts:14) — a
  textual cross-reference with no `nav.shifts` link; meanwhile the page it
  names isn't a shift page.
- **Dead strings and dead stores**: `tpl.handover` notebook i18n, the whole
  `roster.ts` module — generated scaffolding left in place.
- **Free-text break entry**: "12:00-13:00 lunch" parsed by regex, bad lines
  silently dropped (ShiftsPage.tsx:19–26). A machine-readable config written
  as a natural-language textarea is a demo-data pattern, not a config UI —
  and it's untranslatable for TH-only admins.
- Thai micro-bug: `shiftNow: 'กะ{{name}}'` (i18n.ts:131) renders "กะA" — no
  space before the Latin shift letter.

## What works

- The backend model is the right *config* model: windows + breaks +
  enabled flag + non-working days + tag/state map + per-product ideal cycle
  times = a complete OEE planned-time definition.
- Permissioning is honest end-to-end: `canAdmin` gates every mutation,
  viewers get `PermissionNotice` + read-only — no greyed-but-clickable traps.
- `roster.ts` is genuinely good design waiting to be wired: correct Thai
  3-กะ defaults, correct overnight-rollover day attribution, per-org storage
  namespacing, `ownerOf(equipment)` for escalation routing.
- Dialog is properly keyed (`key={editing?.id ?? 'new'}`), skeletons and
  `EmptyState`/`ErrorState`/`Confirm` shared components all used correctly.

## Top fix

**Split the route, don't rename it.** `/shifts` is the word operators already
own — keep it for them and move the config out:

1. **`/shifts` becomes the operator surface** (L1, Production cluster): a
   "now" band — current กะ name, on-duty team + member names, minutes to
   changeover, countdown to next shift — fed by the existing
   `/shifts/current` API; a 7-day rotation grid (three กะ columns × days,
   cells = team names, localized DOW headers via existing `prod.dow`);
   a handover stream — outgoing crew writes "open issues / maintenance done /
   watch next", incoming crew acknowledges — which finally wires
   `tpl.handover`, the `tpl_shift` report, and the dashboard note widget into
   one flow; carried-forward context: unclassified stops (`/stops` pending)
   and open alarms at handover.
2. **Config relocates to `/admin/production` (or `/settings/oee`)** —
   "Shift windows", "Non-working days", "Machine mapping" as admin cards.
   Rename the nav item/page to what it is: "OEE schedule & mapping". Add the
   timezone label and overlap/coverage validation.
3. **Merge the two shift models server-side.** The roster must be a backend
   table referencing the same shift definitions (one shift = one window + one
   assigned team); delete localStorage as the source of truth. Until then,
   two supervisors on two PCs run two different factories.
4. **Cheap wins in the same PR**: make ShiftBadge a link to `/shifts`; render
   `dow` names not "1,2,3,4,5"; add a `/shifts/current` route (or redirect to
   `/shifts`) instead of the silent landing fallback; fix "กะ{{name}}"
   spacing; make the no-shifts empty state warn that OEE availability is
   being computed against 24/7 planned time.

---

<!-- ====================================================================== -->
## [40/48] File: `round5/agent-01-ia.md`

# Agent: ia-consultant — round5

## Pages: nav + all routes

**Evidence base**

- `web/src/app/nav.ts` (full read): 16 NavGroups in 4 clusters, ~45 nav leaves, flyout sections with `secondary` columns and `+ action` rows, fixed rail `ORDER` at lines 202-204, flag-filtering at lines 198-211.
- `web/src/App.tsx` lines 251-339: ~70 registered routes, 13 wrapped in `enabled(flag)` conditionals (lines 278, 299-300, 302-303, 306, 309-310, 312-315, 321, 323), terminal wildcard `path="*"` → `<Navigate to="/">` at line 337.
- `web/src/lib/i18n.ts` lines 14-33: resolved English labels for every group/item.
- `web/src/lib/features.ts`: flags come from `VITE_FEATURES`; **dev defaults to `all`, prod to empty** — meaning the flag-gated routes simply do not exist in a production build.
- `web/src/app/Shell.tsx`: rail `hidden md:flex` (line 541) → below `md` the entire 16-group nav becomes a 256px slide-over drawer (lines 576-616); flyouts render sections+secondary+action (lines 378-423).
- `web/src/shared/ui/ddicons.ts:106`: `'watchdog'` icon key — Datadog's product name used as the Intelligence group glyph.
- Screenshots: `s5-nav.png` (1440×900), `s5-navmob.png` (390×844).

**What the nav actually renders** (labels, rail order):

| # | Cluster | Group label | Contents |
|---|---------|-------------|----------|
| 1 | 1 | **Assistant AI** | /assistant (flagged) |
| 2 | 1 | **Dashboards** | / Overview, /dashboards NEW, /line, /line3d, /notebooks |
| 3 | 1 | **Monitoring** | /monitors, /alarms, /downtimes, /alarms/quality, /slos, /events, /activity (+secondary: /admin/rules, /notifications/channels, /alarms/settings) |
| 4 | 1 | **Developer Portal** | /catalog "Assets", /structure "Plant structure" |
| 5 | 1 | **Incident Response** | /incidents, /teams (both flagged) |
| 6 | 1 | **Automation** | /commands |
| 7 | 2 | **Infrastructure** | /infrastructure, map, profiles, /health |
| 8 | 2 | **APM** | /traces, /processes (flagged) |
| 9 | 2 | **Digital Experience** | /sessions, /synthetics (flagged) |
| 10 | 2 | **Security** | posture, issues, findings, api, access |
| 11 | 2 | **Intelligence** | /insights, /assistant (flagged, **duplicate of group 1**) |
| 12 | 3 | **Errors** | /errors (flagged) |
| 13 | 3 | **Metrics** | /trends, /metrics, /tags, /query |
| 14 | 3 | **Production** | /oee, /stops, /shifts, /reports |
| 15 | 3 | **Logs** | /logs |
| 16 | 4 | **Admin** (gated) | org, /admin/rules, users, audit, storage, keys (+secondary: /settings, /settings/plan, /platform) |

---

## Score /10 (as HMI): **3.5**

Loses to: Line view buried 3rd inside a "Dashboards" flyout while a flag-gated AI assistant holds rail slot #1; the `/downtimes` vs `/stops` word collision; 4 competing "rule" surfaces; ~13 routes that silently redirect to `/` in prod; wildcard→`/` masking every broken deep link; and a nav taxonomy that is Datadog's, not a plant's. Recovers half a point because the rail/flyout/palette mechanics (single source of truth in `nav.ts`, cluster dividers, badge system, mobile drawer) are competently built — the machinery is fine, the ontology is wrong.

---

## HMI/ISA-101 verdicts

1. **This is a SaaS-observability IA wearing SCADA clothes.** The giveaway isn't subtle — the source still carries the donor's fingerprints: i18n key `nav.bitsAi` ("Bits AI" is Datadog's AI product), icon name `watchdog` (Datadog Watchdog) for "Intelligence", "Monitors", "Downtimes" (Datadog's term for scheduled monitor muting — NOT machine downtime), "SLOs", "Synthetics", "Digital Experience" (Datadog's RUM label), "Error tracking", "Incident Response", "APM/Traces". Clusters 1-2 are Datadog's primary nav; the plant (Production, Metrics, Line) is pushed into cluster 3 — "plant data" bolted on below the observability core.

2. **The operator's home is wrong.** Product is branded "Line console" (`shell.product`), yet `/` is an "Overview" dashboard and the actual `/line` mimic is the 3rd item of a flyout under "Dashboards". On an HMI the line graphic IS the home screen. An operator at a PanelView never opens "Dashboards → Live views → Line view" to see the line.

3. **`/downtimes` vs `/stops` collision — the worst single defect.** `/downtimes` (Monitoring→Alarms) is alarm-suppression scheduling; `/stops` (Production) is downtime-event tracking. Same word in plant vocabulary ("downtime") = two different features on opposite sides of the nav. An operator looking for the downtime Pareto will land on alarm muting. ISA-18.2 already names the first concept: shelving / suppression windows. `/downtimes` must be renamed "Suppression" or "Shelving" and `/stops` should claim the word "Downtime".

4. **Four "rule" surfaces, no disambiguation:** `/monitors` + `/monitors/templates` (alert definitions — Datadog "monitors" are rules), `/admin/rules` ("Alarm rules"), `/infrastructure/rules` (**vision** rules — filed under Infrastructure!), and `/alarms/settings` (alarm shelving/escalation config). An engineer cannot predict which one edits the thing they mean.

5. **~13 flag-gated routes → silent redirect.** `enabled('flag')` wraps the `<Route>` itself (App.tsx 278-323); disabled flag = route unregistered = wildcard = `Navigate to="/"`. In a prod build (`VITE_FEATURES` unset → all flags off) every deep link to /incidents, /traces, /synthetics, /assistant, /errors, /teams, /catalog, /processes, /sessions, /alarms/settings silently lands on Overview. No 404, no "feature unavailable" — the URL is destroyed. On a plant floor, a bookmarked screen that silently opens a different screen is a safety-adjacent defect, not a UX nit.

6. **Wildcard `*` → `/` (App.tsx:337)** destroys the URL for ANY typo and makes "the screen I needed vanished" indistinguishable from "I typed it wrong." An HMI should render a 404 page with the current alarm summary still visible.

7. **Duplicate Assistant.** `/assistant` appears as rail group #1 ("Assistant AI") AND again inside "Intelligence" (cluster 2). Same route, two nav entries — a sign the taxonomy was copy-pasted and never reconciled.

8. **Mislabeled groups:** "Developer Portal" contains Asset catalog + Plant structure (a plant hierarchy tree — the most SCADA thing in the app); "Automation" contains only `/commands` (operator command entry — that's *operation*, not automation engineering); "Metrics" contains Trends/Tags/Query (that's the **historian**, the heart of any SCADA); "Infrastructure" contains cameras, vision models and vision rules (that's **quality/vision**). The labels describe the SaaS donor's domain model, not the plant's.

9. **16 groups for ~70 routes fails the 7±2 rule catastrophically.** On mobile the entire 16-group rail becomes one flat 256px drawer — an operator scrolls past "Digital Experience" and "APM" to reach "Production → Stops". ISA-101 hierarchy: level 1 = the line, always. Here it's flyout-item-3.

10. **Settings fragmentation:** alarm settings, SLO settings, incident settings, synthetics settings, account settings, plan, org danger-zone, platform back-office — 8 settings surfaces scattered across 5 groups. Domain config should live as a gear tab inside its domain, not leak into nav.

11. **Positive rail mechanics:** single `nav.ts` source of truth feeds rail + flyouts + palette (good IA hygiene); cluster dividers create visual rhythm; `gated` admin group respects roles; flyout `+ action` rows ("New dashboard", "New rule") are a genuinely good pattern — keep them.

---

## THE operator IA — proposed

Seven groups, ordered by operator frequency, matching the brief: **Line / Alarms / Production / Trends & Tags / Quality / Reports / Setup-Admin.** Assistant becomes a global header control (next to the palette), never a nav group.

### 1. LINE (default landing — make `/` serve the line view or redirect to it)

| Existing route | Disposition |
|---|---|
| `/line` | **Line — home.** Becomes the index experience |
| `/` Overview | Secondary: "Site overview" tile inside Line, or retired into a dashboard |
| `/line3d` | Tab/secondary "3D twin" — never equal rank with the line |
| `/line3d/map` | Gear icon from Line3D page, not a nav item (already absent from nav — good) |
| `/structure` "Plant structure" | "Structure" view inside Line (ISA-95 tree is the line's skeleton) |
| `/commands` | "Commands" — operator write actions live beside the line they act on |
| `/dashboards`, `/dashboards/:id` | "Dashboards" sub-item; keep `+ New dashboard` action row |

### 2. ALARMS (ISA-18.2 surface)

| Existing route | Disposition |
|---|---|
| `/alarms`, `/alarms/:id` | Alarm list/detail — group landing |
| `/events` | "Events & journal" — alarm+event history per ISA-18.2 |
| `/downtimes` | **Rename "Suppression"** (shelving windows) — kills the /stops collision |
| `/alarms/quality` | "Quality" — bad actors, floods, chattering (ISA-18.2 KPIs) |
| `/admin/rules`, `/admin/rules/new` | **MOVE HERE** as "Rules" — alarm config is alarm work, not org admin |
| `/monitors`, `/monitors/templates` | Merge into Rules (dedupe the double rule list) or label "Monitor templates" |
| `/alarms/settings` | Gear tab inside the group, not a nav leaf |
| `/notifications/channels` | Gear tab — notification routing |
| `/activity` | "Notification log" — or header bell feed only |
| `/incidents`, `/incidents/settings` | "Escalations" sub-tab (flagged) |
| `/teams` | "On-call" → Setup-Admin > Users, or Escalations secondary |
| `/slos`, `/slos/settings` | "Availability targets" — acceptable here or under Production |
| `/ack/:token` | Public ack link — stays outside nav (correct today) |

### 3. PRODUCTION (ISA-95 L3: what did we make, what stopped us)

| Existing route | Disposition |
|---|---|
| `/oee` | OEE — group landing |
| `/stops` | **Rename "Downtime"** — reclaim the word for the real downtime Pareto |
| `/shifts` | Shifts |
| `/traces` | i18n already labels it "Batch traces" → "Traceability" (flagged) |
| `/reports` | Move out → Reports group |

### 4. TRENDS & TAGS (the historian)

| Existing route | Disposition |
|---|---|
| `/trends` | Trends — group landing |
| `/tags` | Tag browser |
| `/metrics` | Merge into Trends as a summary view |
| `/query` | "Data query" |
| `/notebooks`, `/notebooks/:id` | Notebooks — ad-hoc analysis sits with data, not Dashboards |
| `/insights` | "Insights" secondary — AI analysis belongs to the historian, not a group |

### 5. QUALITY (vision)

| Existing route | Disposition |
|---|---|
| `/infrastructure/cameras` | **MOVE** — cameras are quality sensors, not infra |
| `/infrastructure/models` | "Vision models" |
| `/infrastructure/rules` | "Vision rules" — now unambiguous because the group scopes it |
| `/infrastructure/events` | "Vision events" — or fold into Alarms > Events as a vision filter |

### 6. REPORTS

| Existing route | Disposition |
|---|---|
| `/reports` | Group landing — shift/production reports |
| `/dashboards` export flows | Cross-link only |
| `/audit` (read-only view) | Optional secondary for supervisors |

### 7. SETUP-ADMIN (role-gated; everything an operator shouldn't touch mid-shift)

| Existing route | Disposition |
|---|---|
| `/admin`, `/admin/users`, `/admin/keys` | Org & access |
| `/admin/audit` | Audit log |
| `/admin/storage` | Storage |
| `/settings`, `/settings/plan`, `/settings/org` | Account/plan/danger-zone — all fold in |
| `/infrastructure`, `/infrastructure/add`, `/infrastructure/map`, `/infrastructure/profiles` | "Devices" |
| `/infrastructure/sources`, `/infrastructure/sources/:edgeId` | "Edge / data sources" |
| `/catalog` "Assets" | "Asset catalog" — out of "Developer Portal" (delete the label) |
| `/health` | Diagnostics > System health |
| `/logs` | Diagnostics > Logs |
| `/errors` | Diagnostics > Error tracking (flagged) |
| `/processes` | Diagnostics > Edge processes (flagged) |
| `/synthetics` + coverage + settings | Diagnostics > "Heartbeat checks" (flagged) |
| `/sessions` | Audit > "Operator sessions" (flagged) |
| `/security/*` (5 routes) | "Security" sub-section — keep if the data is plant-relevant, else flag it |
| `/platform`, `/platform/orgs/:id`, `/platform/support`, `/platform/announcements` | **Platform back-office — never in operator nav.** Platform-admin-only surface reached via role gate/URL, exactly as today (page enforces it) |
| `/status` | Public status page — footer link only, outside shell (correct today) |
| `/assistant` | **Global header button** (palette-adjacent), not a nav group; delete the duplicate Intelligence entry |

### What hides where

- **"Assistant AI" group → header.** A flag-gated chatbot holding rail slot #1 inverts every operator priority.
- **"Developer Portal" → deleted.** `/catalog` → Setup-Admin > Assets; `/structure` → Line > Structure. Nothing in the group was developer tooling.
- **"Monitoring" → split.** Alarms content → Alarms; SLOs → Alarms/Production; Monitors → merged with Rules; Downtimes → renamed Suppression.
- **"APM" → dissolved.** Traces (batch traces!) → Production; Processes → Setup > Diagnostics. The label "APM" must not survive — there is no application to perform-monitor on a line console.
- **"Digital Experience" → deleted.** Sessions → Audit; Synthetics → Diagnostics. A plant has no "digital experience" — it has operators.
- **"Intelligence" → dissolved.** Insights → Trends & Tags; Assistant → header (removes the duplicate too).
- **"Errors" → Setup > Diagnostics.** A 1-item flagged rail group is nav litter.
- **"Logs" → Setup > Diagnostics** (or Trends > Logs if these are process logs — check what the page actually shows; as application logs they are admin-only).
- **"Automation" → Line > Commands.** One route does not deserve a rail slot.
- **"Metrics" → renamed "Trends & Tags"** — the historian finally gets plant vocabulary.
- **"Incident Response" → Alarms > Escalations.** Escalation policy is alarm management.
- **Net: 16 groups → 7, ~45 leaves → ~30 visible** (rest demoted to gear tabs, secondaries, or flags).

### Routing fixes that ship with the IA

1. Wildcard → dedicated `NotFound` page inside the shell (alarm bar still live). Never `Navigate to="/"`.
2. Flag-gated routes → register the route, render a `FeatureOff` notice (or redirect to the parent group with a toast). A URL must never silently become a different screen.
3. `/downtimes` → URL alias to `/alarms/suppression` (301, keep old as redirect).
4. Role-gate enforcement stays server-side; nav `gated` flag stays.

---

## AI-slop flags

- **`nav.bitsAi`, `watchdog` icon, "Digital Experience", "Downtimes", "SLOs", "Synthetics", "Error tracking", "Incident Response"** — the nav was lifted wholesale from Datadog's product taxonomy; even the internal identifiers kept the donor's names. This is the single largest slop tell in the codebase.
- **16 groups, half of them 1-2 items** (Automation=1 item, Logs=1, Errors=1, APM=2, DigitalExperience=2, Intelligence=2, DevPortal=2) — classic "every generated page got its own group" growth with no consolidation pass.
- **Assistant twice** in one nav (rail #1 and inside Intelligence) — generated twice, reconciled never.
- **"Developer Portal" containing a plant asset tree** — label invented before content existed; nobody renamed it.
- **Badge `NEW` on `/dashboards` and `/infrastructure`** — marketing surface on an HMI. Nothing on the plant floor is "NEW".
- **8 scattered `*/settings` routes** — each generated domain page shipped its own settings page instead of sharing a config pattern.
- **Comment honesty check:** `nav.ts:38` claims "Navigation is grouped by job-to-be-done rather than by system layer" — the file then groups exactly by system layer (APM / Infrastructure / Logs / Metrics). The comment describes the IA the author wished they had.

---

## What works

- **One nav model** (`nav.ts`) drives rail, flyouts, drawer and command palette — adding/renaming a group is a one-place change. The proposed IA is a data edit, not a refactor.
- **Cluster dividers + `gated` admin** give the rail rhythm and respect roles.
- **Flyout `sections`/`secondary`/`action` anatomy** is genuinely good — keep it; Alarms and Setup-Admin both benefit.
- **`href` landing on group titles** (Monitoring→/monitors) is a nice touch worth keeping for all groups.
- **Public `/status` and `/ack/:token` live outside the shell** — correct call; don't move them.
- **Palette** (`pages/equipment/signals` result kinds) is the right escape hatch once the rail shrinks — the 7-group IA + palette is a strong combo.
- **`/stops`, `/shifts`, `/oee`, `/reports` co-located** — the Production cluster is the one part that already thinks like an operator.

---

## Top fix

**One commit, three moves — no page code changes required:**

1. **Reorder the rail so the plant comes first:** Line (with `/` → line view or "Overview" demoted) / Alarms / Production / Trends & Tags / Quality / Reports / Setup-Admin — implemented entirely inside `nav.ts`'s `ALL_NAV`/`ORDER`, because it is already the single source of truth.
2. **Kill the collision:** rename `/downtimes` label to "Suppression" (ISA-18.2 shelving) and `/stops` label to "Downtime"; move `/admin/rules` from Admin into the Alarms flyout (it's already *rendered* there as a secondary link — the file knows better than the route path).
3. **Stop the silent redirects:** replace the wildcard `Navigate to="/"` (App.tsx:337) with an in-shell 404, and render flag-gated routes as registered routes that show a "not enabled for this org" notice. ~13 deep links currently vaporize in prod builds.

Until those land, the verdict stands: **a SaaS-observability IA wearing SCADA clothes** — Datadog's nav with a Line console bolted into cluster 3.

---

<!-- ====================================================================== -->
## [41/48] File: `round5/agent-02-thai.md`

# Agent: thai-ux-writer — round5

**Persona:** senior Thai UX writer + plant-floor translator (10 yrs Thai SCADA/MES localization).
Question answered: does a Thai operator actually understand this console?

**Screenshots:** `C:\Users\Gigabyte\AppData\Local\Temp\shots\s5-th-overview.png`, `s5-th-line.png`, `s5-th-alarms.png`

## Method note — ?lang=th DOES NOT WORK (new defect)

`?lang=th` is silently ignored. The i18n bundle (r5-i18n.js) resolves language ONLY from
`localStorage["wds.lang"]` (`en`|`th`) else `navigator.language.startsWith("th")`. There is no
query-param lookup and `--lang=th` on Chrome headless did not flip `navigator.language` either.
I had to drive Chrome via CDP and run `localStorage.setItem('wds.lang','th')` before navigating.
→ Any QA/runbook that says "add ?lang=th" is broken; either implement the param or document
`localStorage["wds.lang"]`. This also means the EN/TH toggle in the user menu is the ONLY
supported switch — and it wasn't visible in the screenshots (buried in avatar menu).

## Pages: overview (ภาพรวม), /line (ดูไลน์), /alarms (สัญญาณเตือน) in TH

### Overview — TH completeness ≈ 88%

Translated and natural: แดชบอร์ด / การเฝ้าระวัง / พอร์ทัลนักพัฒนา / การสั่งงาน /
โครงสร้างพื้นฐาน / สัญญาณความปลอดภัย / ข้อมูลเชิงลึก / ค่าวัด / การผลิต / บันทึกระบบ —
all top-level nav is Thai (earlier "English-only nav" finding only applies to sub-items like
APM, Digital Experience — not expanded here). "ค้นหาหรือข้ามไป", "นอกเวรกะ",
"กำลังเชื่อมต่อใหม่", "เริ่มต้นใช้งาน • สำเร็จ 5 จาก 6", "ลงทะเบียนเกตเวย์",
"เพิ่มแหล่งข้อมูลหรือแท็ก", "เชื่อมต่อโรงงานของคุณ", "ตัวจำลอง / Factory I/O / PLC จริง" tabs —
fluent, not MT-flat. Reconnect banner: "กำลังเชื่อมต่อข้อมูลสดใหม่ ค่าบนจอคือค่าล่าสุดที่ได้รับ
อาจไม่ใช่ค่าปัจจุบัน" — genuinely good operator Thai.

UNTRANSLATED / leaks seen visually:
- **"Enroll edge gateway"** — step-2 heading in English while steps 1/3/4 headings are Thai
  ("เปิด Modbus server ใน Factory I/O", "ใช้แม่แบบ Factory I/O", "ตรวจค่าและเดินไลน์").
- **"Data sources"** — inside step-3 body AND button "เปิด Data sources →" (mixed-language button).
- **"Audit log"** — footer link next to Thai "สุขภาพระบบ" (alarms page footer).
- Term drift INSIDE one paragraph: step 1 body keeps "speed setpoint" English, but the /line
  card calls the same value "จุดตั้งความเร็ว". Pick one.
- "coil / holding register / input register" left English — acceptable as Modbus domain terms
  (Thai electricians do say คอยล์/รีจิสเตอร์), but wrap in a consistent style.

### /line — TH completeness ≈ 85%

Translated: "ดูไลน์", "เลือกอุปกรณ์เพื่อดูรายละเอียด และควบคุมหากมีสิทธิ์", "อัปเดต 22 นาทีที่แล้ว",
cards มอเตอร์ขับ / สายพานลำเลียง / กล้องวิชัน / ถังรับกรวด; fields สถานะไลน์ / จุดตั้งความเร็ว /
ความเร็วสายพาน / อุณหภูมิสายพาน / อัตราส่วนกรวด / ระดับถังรับ; "การควบคุม",
"ไม่สามารถควบคุมได้", "ข้อมูลค้าง" stale badge.

Issues:
- **Mimic drawing is 100% English**: Aggregate bin 1–4, Cement silo 1–4, Drum emptier, Mixer,
  Weigh hopper, Skip hoist, Blower, Liquid tank 1. These are scene-model data names, not i18n
  keys — but card↔drawing mapping breaks: the card says ถังรับกรวด, the drawing says
  "Aggregate bin". Under alarm pressure a Thai operator must map them instantly; give equipment
  a Thai display-name field rendered next to/instead of the EN asset name.
- "ที่เลือก" (SELECTED badge) — awkward; standard is "เลือกอยู่" or "กำลังเลือก".
- "ข้อมูลค้าง" for Stale — passable, but "ไม่ได้อัปเดต" / "ข้อมูลเก่า" reads more naturally;
  whatever is chosen must match the banner wording (banner already says อาจไม่ใช่ค่าปัจจุบัน).
- "ไม่สามารถควบคุมได้" is ambiguous (machine can't be controlled vs. no permission); for
  demo=viewer the truth is "ไม่มีสิทธิ์สั่งงาน" — say that.

### /alarms — TH completeness ≈ 92%

Translated: title "สัญญาณเตือน", "ไม่มีอะไรรอรับทราบ", tabs คงค้างอยู่ / รับทราบแล้ว /
หายแล้ว / ทั้งหมด, "ความหนาแน่นสัญญาณเตือน", empty state "ไม่มีสัญญาณเตือนที่ค้างอยู่ /
ขณะนี้ไม่มีสิ่งที่ต้องดำเนินการ", banner "การอัปเดตสดหยุดชั่วคราว รายการอาจไม่เป็นปัจจุบัน
จนกว่าการเชื่อมต่อจะกลับมา". This page is the best Thai of the three.

Issues:
- **Search placeholder leaks raw English enums**: `tag:motor1 sev:critical state:active
  หรือข้อความเสรี…` — field names + enum values untranslated. Either localize the query DSL
  (sev:วิกฤต) or add an explicit "ภาษาแบบสอบถาม (EN)" affordance; a Thai operator cannot guess
  `sev:critical`.
- **Terminology split confirmed in-page**: /alarms title = สัญญาณเตือน, but overview checklist
  uses กฎแจ้งเตือน / ช่องทางแจ้งเตือน, and context reports a third word ปลุก elsewhere.
- Density strip shows "แสดง 1 รายการ" with one red cell while the list says "แสดง 0 รายการ" —
  counter vs. list disagreement reads like a bug even if one is history.
- Footer: "Audit log" English next to "สุขภาพระบบ".

## Score /10 (as HMI)

**6.5/10.** Surface prose is ~88–92% Thai and reads like a person wrote it, not MT. What costs
points on an HMI specifically: (1) the ONE word that must be unambiguous — "alarm" — has three
translations in-flight; (2) a "downtime" page whose name collides with a notification-mute
concept is an OEE-integrity hazard, not a style issue; (3) critical pages still leak English at
exactly the moments of action (enroll gateway, audit trail, alarm query syntax); (4) no working
?lang=th for shift-floor verification. A real Thai operator can run this console, but two
operators describing the same screen will use different words — that is an incident-reporting
failure waiting to happen.

## HMI/ISA-101 verdicts

- **Alarm lifecycle tabs are correct** — unacknowledged/acknowledged/cleared map cleanly to
  ISA-18.2 states; รับทราบ (acknowledge) is the right Thai term (matches Siemens/ABB/
  Thai-integrator convention). Keep it.
- **Amber reconnect banners are ISA-101-appropriate** — awareness color, non-blocking, stale-data
  warning text is honest ("อาจไม่ใช่ค่าปัจจุบัน"). Good.
- **FAIL — one-concept-one-word**: alarm = {สัญญาณเตือน, แจ้งเตือน, ปลุก}. On a plant floor these
  are not synonyms: แจ้งเตือน = notification (the message), สัญญาณเตือน = the alarm condition.
  Muting a notification ≠ acknowledging an alarm; if the UI treats the words interchangeably,
  operators will too.
- **FAIL — downtime vs. mute conflation**: /downtimes titled ช่วงหยุดซ่อมบำรุง ("maintenance
  downtime") while the monitors tab calls the same page ช่วงปิดเตือน ("alert-mute window").
  If a mute window is recorded as downtime it corrupts Availability; if a real stop is labeled a
  mute window operators won't log a reason. This is the single worst terminology defect.
- **Stale-state treatment is right** (badge + banner), but badge word ข้อมูลค้าง must match banner
  vocabulary.
- **Equipment naming**: EN asset names on the mimic vs TH card names is a cross-reference break;
  ISA-101 expects label↔object correspondence. Provide Thai display names for equipment.

## The Thai SCADA glossary this product must standardize on

| EN | Standardize on | Do NOT use | Note |
|---|---|---|---|
| alarm (condition) | **สัญญาณเตือน** | ปลุก, แจ้งเตือน | One word, everywhere |
| notification | การแจ้งเตือน | สัญญาณเตือน | The message ABOUT an alarm |
| alarm rule | กฎสัญญาณเตือน | กฎแจ้งเตือน | Fix overview checklist |
| acknowledge (ack) | **รับทราบ** | ยืนยัน, ตอบรับ | Button: "รับทราบ" |
| unacknowledged | ยังไม่รับทราบ | คงค้างอยู่* | *rename Active tab — see below |
| active alarm | สัญญาณเตือนกำลังทำงาน / tab: **ยังไม่รับทราบ** | — | "คงค้างอยู่" is ambiguous; tabs should be: ยังไม่รับทราบ / รับทราบแล้ว / กลับปกติ / ทั้งหมด |
| cleared/return-to-normal | กลับปกติ | หายแล้ว | ISA-18.2 RTN; "หายแล้ว" acceptable, pick one |
| shelve | **พักสัญญาณเตือน (ชั่วคราว)** | ปิดเตือน | Shelving is timed suppression |
| suppress | ระงับการเตือน | — | For designed-out suppression |
| severity: Critical | **วิกฤต** | Critical (raw) | Enum must be translated, incl. query DSL |
| severity: Warning | **เตือน** | Warning | |
| severity: Info | **ข้อมูล** | Info | |
| alarm flood | สัญญาณเตือนล้น | — | ISA-18.2 metric |
| downtime (OEE stop) | **เวลาหยุดเดินเครื่อง** | ช่วงหยุดซ่อมบำรุง, ช่วงปิดเตือน | Maintenance is a CAUSE, not the event |
| planned/unplanned downtime | หยุดตามแผน / หยุดนอกแผน | — | |
| notification mute window | **ช่วงงดแจ้งเตือน** | ช่วงปิดเตือน | MUST differ from downtime word |
| stop reason | สาเหตุการหยุด | — | For operator logging |
| minor stop | จุดหยุดเล็ก | — | |
| edge gateway | **เอดจ์เกตเวย์** → เกตเวย์ | Enroll edge gateway (EN heading) | Loanword is authentic; translate the verb "Enroll" = ลงทะเบียน |
| gateway | เกตเวย์ | — | Already correct on overview |
| tag | **แท็ก** | ป้าย | Universal Thai-plant loanword |
| signal | สัญญาณ | — | Physical/analog sense |
| data source | แหล่งข้อมูล | Data sources | Fix step-3 body + button |
| setpoint | **ค่าตั้ง** (ค่าตั้งความเร็ว) | จุดตั้ง, speed setpoint | Line card uses จุดตั้งความเร็ว — unify |
| stale data | **ข้อมูลไม่ได้อัปเดต** (badge: ไม่สด) | ข้อมูลค้าง | Match banner wording |
| OEE | ค่า OEE (ประสิทธิภาพโดยรวมของอุปกรณ์) | — | Loan acronym is standard |
| Availability | ความพร้อมใช้งาน | — | |
| Performance | ประสิทธิภาพการผลิต | — | |
| Quality | อัตรางานดี | — | |
| target | เป้าหมายผลิต | — | |
| scrap/reject | ของเสีย / งานเสีย | — | |
| cycle time | เวลาต่อชิ้น (ไซเคิลไทม์) | — | |
| shift | กะ / เวรกะ | — | นอกเวรกะ already good |
| vision camera | **กล้องวิชัน** | — | Already used; loanword is correct |
| inspection | การตรวจงานด้วยภาพ | — | |
| defect | ตำหนิ / งานบกพร่อง | — | |
| pass/fail | ผ่าน / ไม่ผ่าน | — | |
| audit log | **บันทึกการตรวจสอบ** | Audit log | Footer leak |
| signing secret | รหัสลับสำหรับลายเซ็น | (untranslated in TH bundle) | Known dead key |
| reconnecting | กำลังเชื่อมต่อใหม่ | — | Already correct |
| controls unavailable | ไม่มีสิทธิ์สั่งงาน (viewer) | ไม่สามารถควบคุมได้ | Distinguish permission vs capability |

## AI-slop flags

- "Enroll edge gateway" — a lone English heading inside an all-Thai step list; classic coverage
  gap, not a style choice.
- Mixed-language button "เปิด Data sources →" — MT-style quoting of an untranslated label.
- "speed setpoint" (EN) in onboarding vs จุดตั้งความเร็ว (TH) on the card for the same register.
- Density widget "แสดง 1 รายการ" contradicting list "แสดง 0 รายการ" — counter drift.
- "Audit log" EN in footer next to สุขภาพระบบ TH — half-swept localization.
- "อัตราส่วนกรวด" is a literal-meaning translation of "Gravel ratio" — technically right,
  reads machine-flat.
- ?lang=th documented-but-dead param — the i18n detection reads localStorage only; the test
  tooling was written against a feature that doesn't exist.

## What works

- Prose quality: banners, empty states, and onboarding bodies are fluent operator Thai
  ("รายการอาจไม่เป็นปัจจุบันจนกว่าการเชื่อมต่อจะกลับมา"), not dictionary-MT.
- All 10 top-level nav groups localized; alarm page is ~92% complete with correct ISA-18.2
  lifecycle mapping (รับทราบแล้ว / หายแล้ว tabs).
- Correct loanword instincts: เกตเวย์, แท็ก, ไลน์, วิชัน, โมดบัส left as Thai-plant speech
  actually uses them.
- Stale-data honesty: badge + banner + "อาจไม่ใช่ค่าปัจจุบัน" — safety-relevant state is
  communicated, in Thai.

## Top fix

**Enforce one-word-per-concept for alarm and downtime, then sweep the leaks.**
1. Global replace: alarm → สัญญาณเตือน everywhere (kill ปลุก; demote แจ้งเตือน to
   "notification" only — fix กฎแจ้งเตือน/ช่องทางแจ้งเตือน on overview).
2. Rename /downtimes to เวลาหยุดเดินเครื่อง and the monitors tab's mute concept to
   ช่วงงดแจ้งเตือน — different pages, different words; this protects OEE integrity.
3. Translate the visible leaks: "Enroll edge gateway" heading, "Data sources" button/body,
   "Audit log" footer, and either localize or label the `sev:critical state:active` query DSL.
4. Make `?lang=th` actually work (or publish `localStorage["wds.lang"]`) so shift-floor QA can
   verify; give equipment Thai display names so ถังรับกรวด on the card equals the object on the mimic.

---

<!-- ====================================================================== -->
## [42/48] File: `round5/agent-03-mobile.md`

# Agent: mobile-ops-engineer — round5

## Pages: mobile sweep
Captured at 390×844, touch/mobile UA, `?demo=viewer`, unique profile per shot:

| Page | Shot | Layout width | Overflow? | Verdict |
|---|---|---|---|---|
| /alarms | s5-m-alarms.png | 390/390 | none | view-only safe |
| /oee | s5-m-oee.png | 465/390 | **+75px horizontal overflow** | broken on mobile |
| /infrastructure | s5-m-infra.png | 390/390 | none | view-safe, dense controls |
| /trends | s5-m-trends.png | 390/390 | none | view-safe, borderline targets |
| /admin/audit | s5-m-audit.png | 390/390 | none (but tab strip clips) | view-safe |

Evidence: `scrollWidth` measured per page via Playwright; only /oee exceeds the 390px viewport — its time-range segmented control ("Last 24 h | Last 7 days | [3rd segment fully clipped]") forces the whole page wide and pushes the header's bell + avatar icons off the right edge.

## Score /10 (as HMI)

- **/alarms — 7/10.** Bottom nav 4×~97px targets, full-width ~48px filter input, honest "Live updates paused" stale-data banner, readable density histogram, clean empty state. Deductions: header icon triplet (search/bell/avatar) is ~30–34px, under 44px; tab labels are ~16px with count chips that a glove could fat-finger between "Acknowledged" and "Cleared".
- **/oee — 3/10.** The only page that physically breaks the viewport. Clipped segmented control, header controls unreachable, and — worst for an HMI — *content exists offscreen that the operator cannot see and is not told about*. Cannot certify.
- **/infrastructure — 6.5/10.** No overflow, big status tiles (ONLINE/STALE/OFFLINE/NEVER CONNECTED/DISABLED) with huge numerals — genuinely glanceable from the floor. Deductions: facet checkboxes are ~20px desktop-density targets; 5-tab strip ("Rules") sits flush against the right edge.
- **/trends — 6/10.** Charts render legibly with real axis labels; per-unit charts (m/s, °C) kept separate — ISA-correct. Deductions: eight range chips (15m…1y) crammed at ~45px pitch — at the 44px floor with zero margin for gloves; signal-picker checkboxes ~18px; Explorer/Grid toggle is a desktop segmented pattern.
- **/admin/audit — 6/10.** Honest lock state ("Admin or Owner role required" — *tells you your role and who to ask*, which is more than the unexplained lock the worker agent found elsewhere). Deductions: admin tab strip clips "Users" at the right edge with no scroll affordance/fade — the same hidden-content sin as /oee, milder.

## HMI/ISA-101 verdicts

- **Nothing on any captured page can drive the process.** In viewer role there are no Stop/Start/ack controls rendered anywhere in thumb reach — the only actions are navigation, filtering, and Export CSV. That is the correct posture for a phone on the floor.
- **Danger assessment: low severity but non-zero.** The risk is not accidental actuation; it is *false confidence* — /oee hides header status (bell = alarm notifications!) offscreen, and on /alarms a real alarm list would put row-level ack buttons ~1 thumb-width above the bottom nav. Unverifiable here (0 alarms), flag for operator-role retest.
- **Stale-data honesty is good:** every page shows "Reconnecting" and /alarms adds an explicit "list may be out of date" banner — ISA-101-aligned situational-awareness disclosure.
- **Bottom nav (Overview / Alarms / Trends / More) meets 44px** and follows the 4-item mobile convention; worker's finding that /stops lives only under "More" is confirmed — a stops page is one tap deeper than it should be for floor use.
- **Status color/shape coding on /infrastructure is exemplary:** dot/diamond/triangle/circle/square glyphs + text labels — redundant coding, not color-only.

## AI-slop flags

- Segmented control on /oee not converted to a scrollable chip row or select below a width breakpoint — classic "desktop component shrunk, not redesigned."
- "Reconnecting" pill consumes ~40% of header width on all pages while the org-name pill is clipped mid-character — priority inversion in the app bar.
- Eight time-range chips inline on /trends instead of a native select/stepper at ≤480px.
- Admin tab strip with clipped text and no overflow indicator (no fade, no chevron).
- ~18–20px checkboxes in filter facets on /infrastructure and /trends — desktop pointer density shipped to touch unchanged.
- Header icon triplet ~30px everywhere — sub-44px across the board.

## What works

- Bottom nav: correct size, correct item count, labeled (not icon-only).
- /infrastructure status tiles: the single most floor-appropriate component in the sweep — readable at arm's length, gloved-tappable card rows (device row ~60px tall with chevron).
- /trends charts: legible axes, honest units, one-chart-per-unit.
- /alarms stale-data banner and /admin/audit lock copy: plain-language, actionable, honest.
- No horizontal scroll on 4 of 5 pages; no clipped body text anywhere except the two tab/segment strips.

## Top fix

**Fix the layout contract, not the components:** enforce `scrollWidth == clientWidth` at 360–430px in CI (one Playwright assert per route would have caught /oee), and replace inline segmented/tab strips with horizontally-scrollable chip rows *with a right-edge fade or chevron affordance* so clipped content is advertised. Then bump every interactive element that survived to ≥44px (header icons, facet checkboxes, range chips). Until /oee stops pushing the alarm bell offscreen, the rule for the floor is: **all five pages view-only; none certified for operation — and /oee not certified even for viewing.**

---

<!-- ====================================================================== -->
## [43/48] File: `round5/agent-04-nightshift.md`

# Agent: controlroom-designer — round5

## Pages: wallboard-size sweep

Captured headless Chrome @ 1920×1080 (wallboard panel resolution), judged as if viewed from 2 m in a dim control room at 03:00:

- `s5-wall-dash.png` — `/dashboards?demo=viewer` → dashboard **list** table (6 built-ins: Incident management overview, Alarm management KPIs, Aggregate AI — gravel/sand, Line performance, Sorting line 1 — overview, Vision quality). Not a wallboard — a file manager.
- `s5-wall-line.png` — `/line` → 4 equipment cards (Drive motor / Conveyor / Vision camera / Gravel bin), controls box, "Sorting line 1" P&ID-style diagram.
- `s5-wall-alarms.png` — `/alarms` → Active 0 / Ack'd 1 tabs, 4 h density strip, empty state.

## Score /10 (as HMI)

**2/10 as a night-shift wallboard.** It cannot be hung tonight. Every measured font is roughly half the 2 m minimum; >75% of pixels are white (glare source); every process value is "—"; and the only page that could reassure from across the room ("No active alarms") is lying, because the feed behind it is paused. The bones are clean — this is a competent desk UI — but desk-UI assumptions make it actively dangerous as a wallboard: it presents "all clear" while blind.

## HMI/ISA-101 verdicts

**Typography vs. 2 m rule (≈24 px min body, 48 px+ key values):**

| Element | Measured (est.) | 2 m requirement | Verdict |
|---|---|---|---|
| Page H1 (Alarms/Dashboards/Line view) | ~18–20 px | 48–64 px | FAIL |
| Body / table text | ~12–13 px | ≥24 px | FAIL (~50%) |
| Table headers, diagram labels, axis labels | ~10–11 px | ≥24 px | FAIL — invisible at 2 m |
| Process values on cards | ~14 px, all "—" | 48–72 px | FAIL on size AND content |
| Alarm count (tab numeral) | ~12 px | 64–96 px status field | FAIL |
| Clock (most readable item on screen) | ~13 px | 48 px+ | FAIL |

There is no text element on any of the three pages that survives 2 m. From across the room the product is a gray rectangle with a faint diagram.

**Contrast at distance:** gray-on-white microtext throughout (`~#6b7280` on white ≈ 4.5:1 nominal, but thin strokes at 12 px collapse to mush at 2 m). The alarm density strip is light-gray squares on white — decorative texture, unreadable. The "live updates paused" banner is pale-amber-on-pale-amber — the single most important message in the product rendered at the lowest effective contrast on the page.

**Color semantics (what colors mean at a glance):**
- The ONLY saturated pixels are **interaction chrome** — blue tab underline, blue "SELECTED" on the Conveyor card. ISA-101 says saturate what matters; here saturation marks where the mouse last clicked. Salience budget spent on selection state, zero spent on process state.
- Amber appears twice for degraded comms ("Reconnecting" pill, paused-updates banner) — correct semantic, correct instinct, but executed as thin 13 px text strips: perceptible from the chair, not from the room.
- **No plant-state vocabulary at all.** No green/red/gray discipline because there is no green or red anywhere — not "ISA-101 quiet," just absent. A wallboard with no active color field reads as "off," not "normal."
- "Stale" chips (dashed gray border) are a genuinely good ISA-101-flavored pattern — state communicated by shape+texture, not just color — but at 11 px they subliminally read as decoration, and there are eight of them saying the same thing that should be said once, loudly.

**Alarm salience from across the room:** zero. "Active 0" is a numeral inside a tab label. If an alarm fired, it would presumably arrive as a table row — below the 2 m floor. No color-field change, no beacon, no banner exists for alarm annunciation. The architecture has no room-scale alarm affordance; salience is a desk-only feature.

**Stale/offline handling — the disqualifier:** `/line` shows every value as "— Stale" with "Updated 21m ago" in 11 px gray; `/alarms` simultaneously renders a serene empty state: checkmark icon, **"No active alarms. Nothing needs attention right now."** From 2 m the board says ALL CLEAR while the product knows it is blind. In a control room this is the worst possible failure mode — worse than showing stale numbers, because it manufactures confidence. Data-health must outrank content: "no data" must never render as "no problem."

**Glare / dark-room fitness:** body is light-only (dark exists on rail, topbar, login — per context, no `prefers-color-scheme` dark theme). Roughly 75–80% of every captured frame is white or near-white. On a 55"+ wallboard at 250–400 nits that is a light source, not a display — it wrecks operators' dark adaptation and guarantees the screen is perceived as glare rather than information. Fail, and structural: there's no dark palette to flip into.

**Dead canvas:** >50% of all three pages is empty white below the fold. A wallboard that uses less than half its pixels is wasting the one resource a wallboard has.

## AI-slop flags

- **Contradictory reassurance:** "No active alarms / nothing needs attention" rendered at maximal size while "Live updates paused… may be out of date" sits in a thin strip above it. Each template is individually reasonable; composed, they lie. Classic component-library slop — no page-level truth arbiter.
- **Duplicated instruction:** "Select a piece of equipment on the drawing" appears twice on /line (subtitle + right panel) — padding where status should be.
- **Dev artifacts shipped:** org slug `pytest-org-b-d1f4011e` in the topbar; "Aggregate AI — gravel / sand" dashboard name mixes a marketing token into a plant asset.
- **12-hour clock labels** ("01:48 PM…05:48 PM") on an industrial density strip; and the strip itself is uniform gray — a visualization of nothing.
- **Chrome masquerading as content:** "6 dashboards," preset-list counts (0/0/0/6/8), "Sort: Recently modified" — management-UI furniture occupying wallboard space.
- The dashboards **list** page being what `?demo=viewer` lands on means the "viewer" demo opens on a sitemap, not a view.

## What works

- **Per-value staleness flags** ("Stale" chip, "Updated 21m ago") — the product *knows* its data health; only the salience is wrong.
- **Alarm density strip** — compact 4 h histogram is a legit wallboard element; needs scale and real bins.
- **Tab-counts pattern** (Active 0 · Ack'd 1) — the right glanceable primitive, just 5× too small.
- **Muted diagram palette** — the Sorting line 1 drawing is closer to ISA-101 than typical rainbow SCADA; it wants a dark base coat and abnormal-only color, not a redesign.
- **The empty state exists** — "all clear" as an explicit renderable state is correct wallboard thinking; it just must be gated on data freshness.
- **"Reconnecting" is surfaced at all** — many products hide this; here it's present, amber, and persistent. Right signal, wrong magnitude.

## Top fix

Ship a real **kiosk/wallboard mode** — `?kiosk=1` — as a first-class rendering mode, not a zoom hack:

1. **Dark palette (non-negotiable):** near-black/charcoal body (#14171a–#1c2024), muted gray equipment fills, color reserved for abnormal states and comms loss. Kill the 75%-white screen; the rail/topbar already prove the palette exists — extend it to body for kiosk.
2. **Big-status strip (always on):** full-width band, 64–96 px: LINE STATE word (RUN/STOP/FAULT/NO DATA), active alarm count by severity, comms/data-health icon, 48 px+ clock. When the feed is stale/paused this strip inverts to **amber/black hazard styling** and says "DATA STALE — LAST UPDATE 21m AGO" — the board's blindness becomes the loudest thing in the room, never a footnote.
3. **Typography tier for distance:** min 24 px labels, 48–72 px process values, 96 px+ state words. Implement as a `density=wall` stylesheet tier, not browser zoom.
4. **Auto-rotate:** cycle `?kiosk=1&rotate=30s&pages=<dash-ids>,line,alarms`; **interrupt rotation on unacknowledged alarm** (jump to alarms view, hold until ack'd) and on comms loss (hold a dedicated "I'm blind" screen).
5. **Alarm annunciation at room scale:** unack'd alarm = saturated severity color-field (ISA-101: red reserved for high priority), count + tag at 48 px+, optional flash-until-ack'd; ack'd drops to steady muted. Color is earned by state, never spent on selection chrome.
6. **Truth arbiter:** the "all clear" empty state may only render when comms are healthy AND data is fresh. Otherwise it's replaced by the stale-data hazard state. This single rule fixes tonight's active lie.

Until #2 and #6 exist, do not hang this on a wall: a board that says "nothing needs attention" while disconnected is worse than no board.

---

<!-- ====================================================================== -->
## [44/48] File: `round5/agent-05-alarmphil.md`

# Agent: alarm-philosopher — round5

Persona: senior alarm-management consultant (EEMUA 191 / ISA-18.2). Scope is the alarm *model* — what the system can express, measure, and enforce — not the pages that render it.

**Re-verify note (evidence delta vs. the brief):** the brief's claim "no flood detection, no standing-alarm aging, no alarm-activity report (ISA-18.2 KPA), alarm list lacks flood mode" is **stale**. This build now carries all four (see below). What remains absent: **on-delay / off-delay / debounce** (still zero hits in the alarm rule model — the only `debounce` in the tree is a 300 ms form-validation debounce in `FormulaDialog.tsx`, unrelated), **rationalization workflow / master alarm database fields**, **alarm-philosophy artifact**, **management-of-change on rules**, and **flood *suppression*** (flood handling is presentational only).

Verification artifact: `Temp/shots/s5-alarmset.png` (46 KB, rendered after retry — earlier runs exited 0 without writing; Chrome headless on this box is slow/broken, GCM/updater errors. Server answered 200 for `/alarms/settings?demo=admin`.)

## Pages: alarm subsystem model

Rule model — `src/types.ts:48-58` `AlarmRule{ tag, name, kind:'hi'|'hihi'|'lo'|'lolo'|'stale'|'roc'|'anomaly'|'forecast', threshold, stale_s, window_s, deadband, severity:'info'|'warning'|'critical', enabled }`. Alarm instance — `types.ts:17-32` `{ id, tag, rule, severity, state:'active'|'acked'|'cleared', ts, acked_at, acked_by, cleared_at, version, shelved_until, assigned_to, assigned_name }` (lifecycle fields from migration 0030). Creation form fields — `admin/RuleCreatePage.tsx:27,67-72,131-135`: name/tag/threshold/stale/deadband/window/severity/enabled only. Alarm semantics — `features/alarms/alarms.ts` (ISA-18.2 ordering, `FLOOD_THRESHOLD=10`, `?group=` bucketing), `AlarmsPage.tsx` (list, bulk/kbd/swipe ack), `AlarmActions.tsx` (shelve 1h–7d w/ reason, assign, comment, signed single-use ack link), `alarmquality/AlarmQualityPage.tsx` (server `/alarm-quality` KPA report), `alarmsettings/AlarmSettingsPage.tsx` (rules rollup, channels+escalation, downtime+mutes, disabled-rule archive), `notify/api.ts` (`EscPolicy{levels:[after_minutes→channels/teams/oncall]}`, `AlarmEvent` journal kinds comment/assign/shelve/unshelve/ack), `admin/AuditPage.tsx` (tamper-evident hash-chain org audit).

## Score /10 (as HMI)

**7 / 10** — up from prior rounds. The operate→maintain→monitor half of the lifecycle is now real and mostly correct; the front half (philosophy→identify→rationalize→design conditioning) is essentially missing, and one firing-conditioning primitive the product itself recommends cannot be configured. This is a well-executed notification-centric alarm system approaching an alarm-management system, stopped one schema migration short of it.

## HMI/ISA-101 verdicts

ISA-18.2 lifecycle mapping (what each stage needs vs. what exists):

| Stage | Verdict | Evidence |
|---|---|---|
| **Philosophy** | ABSENT | No philosophy document/artifact, no configurable targets. Flood rule-of-thumb is hard-coded twice: `alarms.ts:40 FLOOD_THRESHOLD=10` and `AlarmQualityPage.tsx:20 FLOOD_10M=10`. Operator-loading bands (6/12 per operator-hr) are hard-coded at `AlarmQualityPage.tsx:26`. |
| **Identify** | PARTIAL | `Insight` stream (`types.ts:36-46`: anomaly/drift/flatline/flapping) produces candidate abnormal conditions, but there is no promotion path insight→candidate-alarm; identification is informal. |
| **Rationalize** | ABSENT | A rule is name+kind+setpoints+severity+enabled — nothing else. No fields for cause, consequence, corrective action, required operator response time, or priority basis. Zero hits for `rationaliz*` anywhere. No review status, no "last rationalized / review due" dates. The General tab (`AlarmSettingsPage.tsx:55-65`) lists rules as a flat table — that is a rule inventory, not a master alarm database. |
| **Design** | PARTIAL | Present: deadband (`types.ts:55`, form `RuleCreatePage.tsx:255-264`), stale/data-quality alarm (`stale_s`), ROC/anomaly/forecast kinds, `window_s` lookback, 3-tier priority. Missing: **on-delay, off-delay, debounce/retrigger suppression** — zero hits in the alarm schema. No alarm classes, no designed-suppression list, no state/mode-based alarming (downtimes are the closest analogue). |
| **Implement** | SUPPORTED | Rule CRUD with validation and a live preview; enable/disable; disabled-rule archive with restore (`AlarmSettingsPage.tsx` Archive section, `adminApi.patchRule`). Role-gated (admin|owner, org-scoped). |
| **Operate** | SUPPORTED — strongest stage | ISA-18.2 ordering unacked→severity→newest (`alarms.ts:16-22`); severity edge bars only on unacked rows (`AlarmsPage.tsx:37-41`); ack records who+when; per-alarm shelve with expiry 1h–7d and auto-return (`AlarmActions.tsx:18,55-64`); assign+comment+event journal; bulk ack + keyboard 'A' + swipe-to-ack; signed single-use mobile ack link. |
| **Maintain** | SUPPORTED (partial) | Downtime policies — scoped, recurring, past/active/scheduled (`AlarmSettingsPage.tsx:171-210`); shelving doubles as out-of-service suppression. No formal "out of service" alarm state distinct from shelving. |
| **Monitor & Assess** | SUPPORTED — **new this round, brief was stale** | Server `GET /orgs/{o}/alarm-quality` → `AlarmQuality{alarms_per_operator_hour, peak_10m, hourly[], standing, unacked, top10_share, rules[]}` (`notify/api.ts:78-83`); page bands loading ok/manageable/overloaded, per-rule `chatter / standing / unacked / mtta_s` with flags frequent/chatter/standing/never-acked, finding cards (`AlarmQualityPage.tsx:68-73`). Dashboard KPI widget duplicates rate/peak/floods/standing client-side (`widgets.tsx:939-976`). |
| **Manage & audit / MOC** | PARTIAL | Generic tamper-evident audit log (`AuditPage.tsx:1-6`, hash-chain, admin|owner `audit:read`) and per-alarm event journal exist, but there is no alarm-specific change control: no approval step, no required reason-for-change on rule edits, no periodic audit report measured against stated philosophy targets. |

Additional findings:

- **Flood handling is real but presentation-layer only.** Threshold detection (`FLOOD_THRESHOLD`), a density strip (`AlarmDensity`), deep-linkable `?group=state|rule|eq` bucketing that collapses a flood into count+worst-severity+span (`alarms.ts:125-172`), and banner strings exist. What is missing is flood *response*: no declared flood state, no automatic demotion/suppression of low-priority alarms during flood, no first-out capture, no bulk shelve by rule/equipment. ISA-18.2 treats >10 alarms/10 min as an operator-overload *condition requiring designed mitigation*; here it only re-sorts the table.
- **Standing alarms measured, not treated.** Quality page flags rules with alarms active >24 h and explains the hazard ("a standing alarm trains operators to ignore it", `alarmquality/i18n.ts:21`) — but the working list gives a standing alarm no visual distinction beyond age text, and there is no escalation path for aged unacked alarms (escalation policies only key off `after_minutes` since raise for *notification*, not list treatment).
- **Ack-link auto-POST on open** (`AckLinkPage.tsx:30-46`): opening `/ack/<token>` immediately POSTs and consumes the single-use token — no confirmation step. Mitigations present: signed, single-use, TTL'd, auth-aware (401 surfaces sign-in without consuming), journaled. Residual philosophy concern: ack means "a human registered awareness"; a link that acks on render is vulnerable to prefetch/preview agents and deliberately removes the operator's deliberate-act requirement. Acceptable for mobile field workflow; should be documented in philosophy.
- **Severity discipline is loose at the seam.** `Alarm.severity` is contractually free-form (`types.ts:21`); `normSeverity` (`Status.tsx:31-37`) silently degrades any unknown string to `info` — a misspelled `'critical'` from the backend would render as the lowest priority with no error surface. Also `info` vs `advisory` is alias-normalized (`alarms.ts:51`) — two names for one tier across UI copy.
- **No response procedures in the alarm record.** Detail page shows value/trend/rule/journal (`AlarmDetailPage.tsx`) but no operator-action guidance field — the rationalization artifact ISA-18.2 expects the HMI to surface at the moment of alarm.
- Chatter is *detected* (re-fire within 10 min of clearing, per-rule flag) but never *prevented*: no retigger-holdoff exists in the firing model.

## AI-slop flags

- **Self-recommending feature gap:** the quality finding literally prescribes "widen the deadband or **add an on/off delay**" (`alarmquality/i18n.ts:20`, `fChatterBody`) — a remediation the rule schema cannot express. The product diagnoses a disease it cannot treat. Textbook generated-surface inconsistency: advice copy written against ISA-18.2 doctrine without checking the model.
- **Duplicated magic constant:** `FLOOD_THRESHOLD=10` (`alarms.ts:40`) and `FLOOD_10M=10` (`AlarmQualityPage.tsx:20`) are independent client constants plus a server-side definition — three copies of the same philosophy parameter, guaranteed to drift.
- **Naming drift:** `info` (model) vs `advisory` (UX copy) reconciled only by an alias table; `normSeverity` quietly buckets arbitrary severity strings as info.
- Honest counter-note: the dashboard widget does label its numbers "alarms seen in this session" (`model.ts:260`) — client-side approximations are marked, not laundered as server KPIs. That is the right habit; it makes the two real constants above stand out more.

## What works

- Three-tier severity is within EEMUA 191 / ISA-18.2 recommended priority count; ordering (unacked → severity → recency) is textbook.
- Deadband, stale-data-quality rules, ROC/anomaly/forecast kinds — a broader detection vocabulary than most IIoT dashboards.
- Shelving done properly: bounded (1 h–7 d), reasoned, auto-returns, journaled, visibly badged in the list — not a permanent mute.
- Downtime policies give designed-in suppression windows (recurring maintenance mutes).
- Escalation policies are real level-based escalation (`after_minutes` → channels/teams/on-call), not just retry-loops.
- Per-alarm event journal (ack/assign/shelve/comment) + org-level tamper-evident audit log — the raw material for the audit stage exists.
- Alarm-quality page computes the actual ISA-18.2 KPA set server-side: operator loading vs 6/12-per-hour bands, 10-min peak, standing >24 h, never-acked, MTTA, top-10 share — and per-rule bad actors link straight back to the filtered alarm list. Close the loop from finding→rule and it becomes a rationalization worklist.
- Mobile ack link is single-use, signed, TTL'd, and doesn't consume the token on auth failure.

## Top fix

**Add firing-conditioning fields to the alarm rule model: `on_delay_s` and `off_delay_s`** (debounce is the degenerate case), surfaced in `RuleCreatePage` next to deadband. Everything upstream already admits it: the quality engine already *measures* chatter and tells the user to "add an on/off delay"; the schema, form, validator, and preview are each one field away. It is the single highest-leverage gap because (a) it is the standard ISA-18.2 remedy for the system's #1 measured defect class — chattering alarms; (b) without it, deadband is the only conditioning tool, which fixes threshold-hugging chatter but not transient spikes or delayed clear; (c) every other missing lifecycle stage (rationalization fields, MOC) is a workflow/schema *feature*, while this is a *correctness* hole in the alarm function itself.

Second-order: promote the quality page's flagged rules into a rationalization worklist (add cause/consequence/action/response-time + review-due fields to `AlarmRule`), which converts Monitor&Assess output into the Rationalize stage and closes the lifecycle loop.

---

<!-- ====================================================================== -->
## [45/48] File: `round5/agent-06-plantmgr.md`

# Agent: plant-manager — round5

Persona: senior plant manager. I run the 07:00 shift meeting off this screen. I have
10 minutes, a room full of supervisors, and exactly four questions.

Evidence: headless screenshots of `/oee`, `/reports`, `/stops` (`?demo=admin`,
org `pytest-org-b-d1f4011e`, 1440×900) + frontend bundle `OeePage-*.js`,
`ReportsPage-*.js`, i18n bundle `index-*.js`, and backend
`app/production/oee.py` + `app/production/reports.py` in `webservice-backend-1`.
The demo org has no mapped machines, so all three pages rendered empty states —
I verified the populated-data behaviour from the shipped code instead.

## Pages: /oee, /reports, /stops

### The morning-meeting test — in order

**① What did last shift run?**
Partially. `/oee` gives A/P/Q/OEE cards + a per-machine table with units and
rejects, and a shift dropdown exists — but it *filters*, it doesn't *compare*.
Default view is "Last 24 h / All shifts", i.e. two or three shifts blurred
together. Run time renders as raw seconds (`Math.round(e.run_s),"s"` in
`OeePage` — a 7-hour shift shows "25200s"). No plan-vs-actual delta, no "vs
last shift" column. The `Shift report` template (CSV/HTML download) does answer
this — but it's a file download, not a board view.

**② Where did we lose time?**
Partially. The "Downtime reasons" pareto exists with minutes + count — but it
is a pareto in name only: a flat list of same-blue bars, **no cumulative %**
even though the backend computes and sends `cum_pct` (`oee.py:272`). Worse,
**unclassified downtime is the identical `bg-blue` bar** as real reasons
(`reason_id ?? "none"` → `prod.unclassified` label). I cannot see how much of
my loss is unattributed — which is exactly the number the room will ask about.

**③ Who's responsible?**
No. Nothing ties a loss to a shift, crew, or owner. The shift dropdown filters
to one shift at a time with no side-by-side; reasons have no owner/department;
the reports name machines, not teams. In the meeting this is the question that
assigns follow-ups — the console has no answer.

**④ What do I fix today?**
Weakly. The top pareto bar is the implied #1, but there is no target gap, no
biggest-loss-since-yesterday, no action list. The closest thing is the `/stops`
classify queue — "stops needing a reason" is genuinely an action list — but
it's buried under the Production nav group, has no backlog badge on `/oee`,
and my screenshot shows it defaults to a clean queue (good when true, invisible
when it isn't).

**Verdict: answers ~1.5 of 4 questions.** I would still open the CSV in Excel
before the meeting. The plumbing is real (real OEE math, real shift calendars,
real scheduled email sweep) — the *morning-board surface* is missing.

### What a plant manager would actually print

One page, A4, generated at 06:45 — the existing `prod.html` "Shift report"
template is 80% of the way there and just needs:
- OEE strip per shift side-by-side (last shift vs previous vs plan target)
- Pareto as an actual pareto: bars + cumulative % line, unclassified in amber
- Top-5 stops table: machine, duration h:mm, reason, who classified it
- Unclassified backlog count ("7 stops, 42 min still unclassified — supervisors
  clear before 08:00")
- A blank "Actions today" box for the meeting to fill in

That is a dashboard/report hybrid the `/reports` scheduler could already
deliver by email at 06:45 — the pieces exist, they're just not assembled.

## Score /10 (as HMI): 4

(One point below the generic OEE score — for *this* persona the missing shift
comparison and hidden unclassified bucket are disqualifying, not cosmetic.)

## HMI/ISA-101 verdicts

- **Pass:** restrained gray/blue palette, no rainbow; tabular-mono numerals;
  the amber "Live feed reconnecting — values may be out of date" banner is
  honest staleness indication (exactly right); empty states name the fix
  ("Map a machine's state and count tags on the Shifts page").
- **Fail:** unclassified downtime indistinguishable from classified — a
  data-quality abnormal rendered in the same blue as normal information.
  Should be amber/hatched per ISA-101 "depict abnormal conditions."
- **Fail:** raw seconds as display units — "25200s" is engineering noise, not
  an operator number. Minutes/h:mm everywhere, including the "Run s"/"Planned s"
  column headers that leak straight into the CSV/HTML reports.
- **Fail:** percentages with no embedded reference — an OEE of 62% with no
  target line or range shading forces every reader to carry the target in
  their head.
- **Fail:** "Weekly OEE trend" rendered as a table — trends exist to be
  pattern-recognized; a table forces serial reading.
- **Neutral:** stale values stay fully rendered under the reconnecting banner;
  ISA-101 practice would de-emphasize (gray) them until the feed confirms.

## AI-slop flags

- **Raw i18n keys shipped:** report buttons render literal `prod.csv` /
  `prod.html` — the bundle defines `asCsv`/`asHtml`, the page calls keys that
  don't exist. Nobody clicked the button before shipping.
- **Pareto without the pareto:** backend computes `cum_pct` (`oee.py:272`),
  frontend drops it — the defining feature of a pareto chart.
- **Seconds on the glass:** `Math.round(e.run_s),"s"` — a plausible-looking
  format no human would choose for a shift summary.
- **Trend = table:** the "trend" query returns 8 weekly rows rendered as a
  `<table>`; the word promises a chart.
- **One integer, two meanings:** schedule `send_day` = blank→daily, 1–7→weekday,
  1–28→month-day — schema-clever, UX-hostile.
- **English-only reports to a Thai floor:** reasons carry `name_th` in the DB
  and the UI is fully Thai-translated, but `reports.py:149` selects `name_en`
  and all report column headers are hardcoded English. LINE Notify (the actual
  channel Thai plants use) absent — email-only `to_addrs`.
- **`prod.tmpl_*` copy is fine,`prod.csv` is not:** adjacent keys done right
  makes the missed pair look exactly like generated drift.

## What works

- **Real backend:** OEE math is honest (counter-reset handling in
  `counter_delta`, planned-time from real shift calendars + non-working days,
  None-propagation when a factor has no basis), downtime auto-recording sweep,
  utf-8-sig CSV so Excel opens Thai correctly, scheduled email sweep with
  `last_run_at`.
- **The classify workflow is right:** `/stops` = reason-code queue with
  threshold auto-capture, `needs_reason` filter, reason-code manager with EN/TH
  names and parent grouping — a genuinely correct Andon-lite loop.
- **Empty states teach:** each empty page says what to configure and where.
- **Reports scheduler is the morning board in embryo** — send_time in org-local
  timezone is exactly right for a 06:45 auto-email.

## Top fix

**Assemble the shift-handover board.** Take the existing `Shift report`
HTML template, add (a) shift-vs-shift columns, (b) the pareto rendered with
its already-computed `cum_pct` and unclassified in amber, (c) an unclassified
backlog banner linked to `/stops` — and put it behind one
"Morning report" button that prints clean and auto-emails at 06:45.
Secondary quick wins, all one-liners: fix `prod.csv`/`prod.html` →
`asCsv`/`asHtml`; format `run_s`/`planned_s` as h:mm on the page and in
report column headers; localize report headers + reason names (`name_th`).

---

<!-- ====================================================================== -->
## [46/48] File: `round5/agent-08-quality.md`

# Agent: reliability-rams — round5

## Pages: cross-page quality model

Screenshots reviewed: `s5-qual.png` (/line?demo=viewer), `s5-tags.png` (/tags). Both taken during a live "Reconnecting" episode, which is ideal — it exposes exactly what the quality model does when the feed dies.

**The question a RAMS audit asks of every pixel: does this display tell the truth about *how much* you can trust the number?** Current answer: partially, and the partial truth is worse than no marking, because it teaches the operator a false model.

### The quality taxonomy this product should implement (VQT — Value/Quality/Timestamp)

Every rendered value must carry a triple, not a scalar:

| Quality | Meaning | Render rule (ISA-101) |
|---|---|---|
| **GOOD** | Fresh, within this tag's freshness deadline | Normal weight; no badge needed |
| **STALE** | Last value exceeded its deadline; last-good value retained | Value de-emphasized (gray, reduced contrast), badge + **age** ("last seen 87h ago"), never same weight as GOOD |
| **BAD** | Source reported failure (sensor fault, out-of-range, invalid) | Value replaced by status text or dashed placeholder; distinct glyph — NOT gray like stale |
| **SUBSTITUTED** | Manual/forced/calculated default | Distinct color/shape + audit trail; an operator must never mistake a forced value for a measured one |
| **COMM-FAIL** | Transport lost; state of the value is *unknown*, not stale | Page/section-level banner AND per-tag mark; semantically different from STALE — staleness is measured, comm-fail is unmeasurable |
| **NO-CONFIG** | Tag unbound/misconfigured | Commissioning fault surfaced to engineering, not to operator displays |
| **NO-DATA** | Bound but never received a value since start | Distinct from STALE: "never" vs "stopped" are different diagnoses |
| + Timestamps | Source timestamp AND server-received timestamp | Relative age for scanning, absolute on hover; "—" in UPDATED must mean "never," not "unknown" |

### Where each current display fails that model

1. **Green Live pill lying during backend failure** — the pill asserts a fact ("live") it cannot verify. A status LED must derive from *last-received-message age vs. a heartbeat deadline*, not from socket-intent. **DANGEROUS** — this is the trust anchor of the whole UI; one observed lie and operators either distrust everything or, worse, keep trusting it.

2. **Stale values rendered as healthy** — confirmed live in `s5-tags.png`: `b_site.e2e.line1.sensor.temp` shows **42.5 in full-weight text** with a faint dotted "Stale" outline pill, UPDATED = **87h ago**. A 3.6-day-old process value presented at the same visual weight as a live one. **DANGEROUS** — this is the classic stale-display incident precursor; operators act on the number, not the badge.

3. **Hardcoded 15s staleness for ALL tags** — one freshness deadline for a 1 Hz motor run bit and a slow KPI alike. Staleness must be per-tag/per-class (scan rate, sensor physics, contract). A binary flag with one threshold also can't express *why* data is late. **Moderate→dangerous**: too tight → alarm-fatigue flicker; too loose → the 87h case above is labeled identically to a 16s gap.

4. **"No data" / "Stale" flattens distinct states** — confirmed: `motor1.run` has VALUE "—", UPDATED "—" and is labeled **Stale** — i.e. *never received a value* renders identically to *stopped receiving*. Never-connected, stale, bad, and comm-fail demand different operator responses; collapsing them destroys diagnostic discriminating power. **DANGEROUS** for diagnosis; the "—" glyph is also reused for "no value," "no timestamp," and "no data," so the glyph itself carries zero information.

5. **Reconnecting semantics inconsistent across pages** — /line shows *both* a topbar amber "Reconnecting" pill *and* a yellow banner ("Live feed reconnecting… may be out of date"), while /stops reportedly shows only the banner, and the pill vocabulary differs page to page. Same system state, different chrome → operators build the wrong mental model of what "amber" means. **Cosmetic-to-moderate**: mostly a consistency failure, but it compounds #1.

6. **Edges fleet counter can't sum its own 5-state table** — an aggregate that disagrees with its source rows isn't a rounding problem, it's an *integrity* failure: if the headline number can't be reconciled to the table beneath it, every other aggregate on the page is suspect. **Moderate** (misleading but not directly unsafe) — unless that counter drives staffing/dispatch decisions, then dangerous.

7. **/status overstates health** — the status page is the fallback when operators doubt the main UI. If it claims healthy while subsystems degrade, it fails its only job. **DANGEROUS** for the same reason as #1, amplified: people check /status precisely when they already suspect trouble.

8. **Tag quality codes absent** — root cause of 2/4/5/6/7. There is no VQT in the data path, so every display layer invents its own ad-hoc marker (dotted pill, "—", banner, count). **Fundamental/dangerous.**

**Dangerous:** 1, 2, 4, 7, 8. **Cosmetic-to-moderate:** 3 (becomes dangerous at extremes), 5, 6.

## Score /10 (as HMI)

**3.5 / 10.** Points for: a stale concept exists at all, the reconnect banner is honest in wording, and controls lock out during feed loss (fail-safe instinct). Lost on: stale data rendered at full weight, a 87-hour-old value presented as current, never-received flattened into "stale," lying health indicators, no quality codes, no source/received timestamps, no per-tag freshness contract, inconsistent reconnect chrome. This scores as a *demo that looks right in screenshots*, not as an HMI you'd put in front of a shift.

## HMI/ISA-101 verdicts

- **Fail — quality before quantity**: ISA-101's core rule is that an operator must know data trustworthiness before reading the number. Here the number is rendered first-class and quality is a 12px dotted pill.
- **Fail — abnormal-by-departure**: stale/bad values should be *visually de-emphasized* (low-contrast gray, or hatched) so GOOD data pops and suspect data recedes. Current render does the opposite: the 87h-old 42.5 is the loudest element in its row.
- **Fail — don't flatten absence**: "—" is doing four different jobs (no value, no timestamp, never connected, unknown). One glyph = zero information.
- **Fail — consistent semantics**: reconnect state renders differently per page; the same quality ("Stale") is asserted for tags that have never received data and tags that stopped 3 days ago.
- **Partial pass — fail-safe controls**: "Controls unavailable" lockout during feed loss is correct RAMS behavior — you may not act on data you cannot trust. Keep it.
- **Partial pass — honest banner text**: "values on screen are the last ones received and may be out of date" is the right sentence. It just isn't backed by a per-tag model that makes it true.

## AI-slop flags

- **A two-value quality enum wearing a label**: "Stale" as the *only* non-good state is the signature of a model generated to satisfy a UI mock, not a data contract. Real pipelines ship OPC-quality codes or an equivalent enum; this one ships a boolean.
- **Search-placeholder cosplay**: `/tags` placeholder advertises `quality:stale` filter syntax — a grammar that knows exactly one quality. Filters "All / Pinned / Writable / No data" similarly enumerate UI affordances, not data states.
- **Cosmetic degradation**: the dotted outline pill for Stale is the lowest-visibility treatment available — a designer's "don't clutter the mock" choice that inverts the safety requirement.
- **Relative-only time**: "87h ago" with no absolute timestamp and no last-good/source distinction — generated convenience, not engineering.
- **Aggregate that can't count**: the fleet counter vs. its own 5-state table is the classic LLM-mock artifact — two independently hardcoded numbers that only agree in the demo data.
- **Status page as vibes**: /status overstating health suggests the page renders intended states, not measured ones.

## What works

- Controls lock out when the feed is untrusted — the one genuinely RAMS-correct behavior observed.
- The reconnect banner's wording is honest and specific (warns that on-screen values are last-known).
- A staleness concept exists in the tag model — there's a column and a badge to hang a real taxonomy on.
- UPDATED column shows relative age on /tags — the seed of the timestamp requirement (needs absolute + source/received split).
- Per-tag stale marking on /line equipment cards — the marking mechanism exists; the taxonomy behind it doesn't.

## Top fix

**Ship the VQT triple end-to-end and render from it exclusively.** Concretely:

1. Extend the tag/signal model to `{value, quality: GOOD|STALE|BAD|SUBSTITUTED|COMM_FAIL|NO_CONFIG|NO_DATA, sourceTs, receivedTs, freshnessDeadline}` — per-tag deadline, not a global 15s.
2. Derive every indicator — Live pill, page banners, /status rollups, fleet counters — from that model's *measured* state (last-received age, source-reported quality), never from connection intent or hardcoded sums.
3. Render rules: BAD/STALE/COMM-FAIL values get de-emphasized treatment and always show age; NO-DATA gets its own glyph; SUBSTITUTED gets its own color and an audit entry; "—" means exactly one thing.
4. Make the counters and status pages *compute* over the same table they display — if the table says 3-of-5 degraded, the counter says 3-of-5 degraded.

Until then, every green pill, every un-badged number, and every headline count on this UI is a claim the system cannot prove — and a senior operator learns that the hard way, once.

---

<!-- ====================================================================== -->
## [47/48] File: `round5/agent-09-slophunt.md`

# Agent: slop-auditor — round5

## Pages: console-wide

Sampled `/monitors/templates`, `/notifications/channels`, `/shifts` (demo=viewer, 1440×900) + code pass over `web/src` (nav model, i18n bundles, page sources) at `E:\03_Thesis\webservice`. Landing excluded per brief — everything below is INSIDE the console.

## Score /10 slop level (as HMI)

**4/10 overall** (higher = more slop). Split by type:

- **Design-slop: 7/10** — the console chrome is a measured Datadog reskin, down to the token names, rail widths and the product-taxonomy IA.
- **Code-slop: 5/10** — a handful of real copy/reuse bugs and two categories of dead i18n, but the wiring itself is mostly honest.
- **Content-slop: 3/10** — a pytest-org name in the topbar and a placeholder email; otherwise the demo data and copy are domain-real.

Verdict: NOT pure AI-slop. This is a *Datadog template-derivative console with an unusually honest content layer*. The slop is concentrated in the borrowed skeleton (IA + theme + facet-idiom placeholders), not in fake functionality — the pages mostly do what they say.

## HMI/ISA-101 verdicts

- **Stale-data honesty: PASS.** "Live feed reconnecting. Values on screen are the last ones received and may be out of date." (`lib/i18n.ts:569`) — a real degraded-mode banner; most real HMIs fail this.
- **Role-aware read-only state: PASS.** Viewer mode renders state as text, not disabled controls, and names the required role (`AlarmRulesPage.tsx:164-170`, channels read-only Notice).
- **Alarm shelving treated as a state change: PASS** — disabling a rule confirms (comment cites ISA-18.2, `AlarmRulesPage.tsx:2-3`).
- **Empty states teach consequences: PASS.** "Without shifts the site counts as always planned. Add shifts to measure availability against the real schedule."
- **Colour discipline: PARTIAL.** Severity ramp exists (`--color-sev-*` with AA-checked ink pairs — good), but it's Datadog's ramp; the ISA-101 grey-until-abnormal discipline isn't applied to operational graphics, only tokens.
- **Density: PARTIAL.** Datadog's 13px-dominant density measured onto a plant console is defensible for control-room viewing, but 14 top-level rail groups for a one-line plant is SaaS-mega-menu IA, not HMI task-IA.
- **Navigation vocabulary: FAIL.** "Intelligence", "Developer Portal", "APM", "Digital Experience", "Incident Response", "Assistant AI" are observability-SaaS product names, not operator task names.

## AI-slop flags (detailed)

### Code-slop — copy/reuse bugs

1. **"Signing secret (optional)" on the LINE channel access token — CONFIRMED.** `features/notify/ChannelsPage.tsx:257` labels the LINE secrets field with `nc.secret` = `'Signing secret (optional)'` (`notify/i18n.ts:17`), but `submit()` stores it as `secrets.token` (line 211) and the input is `required`. Wrong product concept (LINE's token is not a webhook signing secret) AND self-contradictory (required field labelled optional).
2. **Fake facet-DSL placeholders — CONFIRMED, 3 instances.** `tags.searchHint: 'Filter by text, or eq:motor unit:°C quality:stale'` (`lib/i18n.ts:407`) — `TagsPage.tsx:149` is a plain `name.toLowerCase().includes(q)`; no `eq:`/`unit:`/`quality:` parser exists anywhere. Same pattern: `audit.searchPh: 'user:demo status:done or free text…'` (`i18n.ts:427`, `AuditPage.tsx:86-87` substring filter) and devices `searchHint: '…status:offline adapter:modbus'` (`i18n.ts:654`). Datadog's facet-search idiom pasted into placeholders and never implemented — typing the advertised syntax matches nothing.
3. **Dead `nb.*` i18n namespace — CONFIRMED.** `features/notebooks/i18n.ts` (55 lines, EN+TH) describes an abandoned product: cell-based notebooks ("Timeseries cell", "Alarm list cell", "Add cell"), template types `tpl: { handover: 'Shift handover', downtime: 'Downtime investigation' }`, seed handover markdown, and a "stored in this browser only (localStorage)" demo notice. The shipped `NotebooksPage.tsx` uses `notebook.*` keys and a single markdown textarea — **zero** `nb.*` references. The shift-handover notebook the emptyBody advertises cannot be created.
4. **Dead insights "evidence" fields — CONFIRMED.** `insights.evidence`, `evZ`, `evMu`, `evSigma`, `evSlope`, `evWindow`, `evResid` (`lib/i18n.ts:363-366`, TH `1228-1230`) are never referenced by any component. `InsightsPage.tsx:99` renders severity/kind/tag/score/state/raised/window — no evidence column or drill-in. Landing sells "Evidence and score on every insight" (`Landing.tsx:156`); the console doesn't deliver it.
5. **Raw UUID fallback — MINOR.** `AlarmRulesPage.tsx:150` renders `tag?.path ?? r.tag_id` — a raw UUID lands in the Signal column whenever the tag lookup misses (deleted tag). The intent is right (comment at :76) but the fallback leaks the ID.
6. **NOT confirmed — keep the audit honest.** `vis.saveClassSettings` ("Save class settings") is used only in `vision/ModelPanel.tsx:136` on actual class settings; `vis.noActive` ("…on the Models page") only in `ModelPanel.tsx:84`. Alarm rules use proper `rn.*`/`admin.*` keys. The hypothesised wrong-string reuse on rules does not exist.

### Design-slop

7. **The theme is a measured Datadog skin — CONFIRMED by the file itself.** `dd-theme.css:4-6`: "Values were measured off a reference operations-console UI during the 2025-10 design pass; the raw captures live with the design research under SDLC/datadog." Tokens literally named `--color-purple-dd`, `--color-bits` ("Bits/AI button"), `--radius-dd`, `--leading-tight-dd`, `--w-rail: 160px (measured)`, `--shadow-bits`; a reference copy sits at `ref/datadog/live/dd-theme.css`.
8. **Datadog product taxonomy as nav — CONFIRMED.** `app/nav.ts` rail groups: `nav.bitsAi` (Bits AI → "Assistant AI"), `nav.apm` (:115), `nav.digitalExperience` (:119), `nav.incidentResponse` (:100), `nav.devPortal` (:96), `nav.intelligence` (:142), plus SLOs / Synthetics→"Heartbeat checks" / Notebooks. `nav.ts:202` ORDER is Datadog's rail order. The Monitors page clones Datadog's monitor tabs exactly — List / Templates / Triggered / Downtimes / Quality (`MonitorsPage.tsx:52-56`). Flag-gated items (traces, sessions, synthetics, errors, incidents, teams, assistant) hide in prod, so the demo rail shows the skeleton minus those groups — "Intelligence" and "Developer Portal" still ship.
9. **Sparkle icon in-console — CONFIRMED.** `shared/ui/Icon.tsx:32` — the two-star "AI magic" pictogram — used for insight empty states (`InsightsPage.tsx:97`, `OverviewPage.tsx:178`), the insight event marker (`events/ui.tsx:18`) and journal entries (`notify/journal.ts:59`), under the surviving `--color-bits` token.
10. **Generic empty-state icon — MINOR.** The same `check` glyph marks "No deliveries yet", "No escalation policies", "No shifts defined", "No planned non-working days" — an all-clear check where a descriptive icon belongs.

### Content-slop

11. **pytest fixture leak in the topbar — CONFIRMED.** The org switcher shows `pytest-org-b-d1f4011e` on all three sampled pages; `pytest-org-*` names are only generated by `tests/integration/test_tenancy.py` — the demo DB is populated with test-run orgs and every screen wears a fixture name.
12. **`support@example.com` shipped — CONFIRMED.** `features/platform/PlanPage.tsx:90` plan-upgrade CTA is `mailto:support@example.com`.
13. **Internal codename "WDS" in user copy — CONFIRMED.** "plans are set by the WDS team", "WDS staff tools", "This area is for the WDS team" (`platform/i18n.ts:16,37,40,44`). Product is branded "vissointan"; `X-WDS-Org` headers are fine internally, but the codename reaches user-facing strings.
14. **Placeholder-grade seed names — MINOR.** "Equipment 1" / "Line 1" rows in the /shifts Machines table; i18n keys like `ddPromo` name the design pass.

## What works

- The honest layer is real, not veneer: RBAC copy names your actual role and who can edit; stale-feed banner; secrets are write-only (`has_secrets`, never re-shown — `ChannelsPage.tsx:1-4,101`).
- Monitor template packs resolve against live site tags with will-create / already-exists / no-signal chips (`TemplatesPage.tsx:24-56`) and install real rules — functional, not decorative.
- Escalation-policy editor validates strictly-increasing delays ≤1 week with a rationale comment (`ChannelsPage.tsx:374-382`).
- Vision rules page is a sentence-style builder with dry-run default and a PLC-write confirm that names the tag and value (`RulesPage.tsx:209-216`) — actual HMI thinking.
- Delivery log translates kind/status enums via key maps (`ChannelsPage.tsx:20-26`); alarm-rule kinds translate with a raw-kind `defaultValue` fallback that only shows for unknown kinds.
- Domain copy is plant-real: "each rule binds to the signals that exist on this site", "Where alarms reach people", shelving/downtime/OEE vocabulary; EN+TH translations are genuine, not machine-glossed.

## Top fix

**Own or evict the Datadog skeleton — one decision, three actions:**
1. Rename the borrowed IA: `Intelligence`→"Anomaly detection" (or merge under Monitoring), `Developer Portal`→"Assets & structure", `APM`/`Digital Experience`→"Edge & batches" (or drop the groups and let the items live under Infrastructure/Production). Keep `dd-theme.css` if desired but rename `*-dd`/`*-bits` tokens and delete the measured-off comment — either admit it proudly or stop looking derived.
2. Implement or delete: the facet-DSL search placeholders (parse `eq:`/`unit:`/`quality:`/`status:`/`actor:` or change the placeholder text to "Filter by name"), the `nb.*` notebook bundle (ship the handover template — the strings and seed markdown already exist — or delete 55 lines), and the `insights.evidence*` keys (add an evidence expand row or drop the landing claim).
3. Scrub demo content: rename the demo org off `pytest-org-*`, replace `support@example.com`, and swap "WDS team" for the product name in `platform/i18n.ts`. Fix `nc.secret` → "Channel access token" for LINE (and drop "optional" on a required field).

---

<!-- ====================================================================== -->
## [48/48] File: `round5/agent-10-demodata.md`

# Agent: demo-engineer — round5

## Pages: seeded-world audit

Method: headless screenshots of `/?demo=admin` and `/infrastructure/cameras?demo=admin`
(s5-demo.png, s5-cameras.png), plus direct API enumeration with the `demo-admin` bearer
token (`/api/v1/orgs`, `/orgs/{id}/sites/{id}/{tags,machines,edges,alarms,slos}`).

### What the demo actually shows today

- `?demo=admin` lands the user in **pytest-org-b-d1f4011e** (slug `org-f699d869`, plan
  "trial") — an e2e test leftover — not the seeded "Demo" org. The org switcher lists
  13 orgs visible to this token: 1 real "Demo" (enterprise) + 4 `pytest-org-b-*` +
  8 `sec-org-b-*`, all with `role: admin`. The first thing a prospect sees in the org
  picker is our test suite's litter.
- Overview headline says "Sorting line 1, live" while the body is a "Getting started ·
  4 of 6 done" checklist and a "Connect your plant" Factory I/O onboarding card. Header
  badges: "Off shift" and "Reconnecting". Live plant story: dead on arrival.
- Cameras page: "No cameras on this gateway" empty tile — despite the cam-* edge work.
- Reconnecting banner on the cameras page, "Reconnecting" pill in the top bar, 502s on
  orgs/sites per prior round notes — backend flakiness is visible in every screenshot.

### What is actually seeded (API-verified)

**Demo org `0199d000-…-a001` / "Plant 1" site `…-b001`:**

- Edge "Edge 1" active, `last_hb_at 2026-10-19T10:28:20Z` — ~7h stale at screenshot
  time (17:48), config_version 455, `needs_rotation: true`.
- **~40 disabled `cam-XXXXXXXX` edges** (e.g. `cam-034386ee`, `cam-0a687ae1`) pollute
  the device list — camera-unit-test leftovers inside the demo org.
- 83 tags across **three colliding namespaces** in one site:
  - `batch/*` (39 tags): `batch/cem` ×17, `batch/agg` ×11, `batch/liq` ×6, `batch/mix`,
    `batch/air`, `batch/plant` — a proper concrete-batching model.
  - `auto/*` (~37 tags): `auto/aggregate_bin_5|6`, `auto/belt_conveyor_2..11`,
    `auto/mixer`, `auto/weigh_hopper`, `auto/aggregate_dump` — a *second* model of the
    same plant under a different prefix.
  - `sort/*` (6 tags): `sort/line1`, `sort/vision` — the Factory I/O sorting line.
  - Junk tags: `pydev`, `t_2c895328`, `t_6031d257`, `t_f08b8005`.
- Machines list flattens tag leaves into "machines": real assets (mixer, weigh_hopper,
  skip_hoist, dust_filter_1/2, silos, blower, tank) are interleaved with pseudo-machines
  named `bin1 level_pct`, `admix1 flow_lpm`, `silo1 high_level`, `motor1 speed_sp`.
  All machines report `configured: false` → OEE/downtime views have nothing to chew on.
- Alarms: 11 historical (e.g. `conv1_overtemp` critical, raised 09:36 cleared 10:16,
  one acked by `demo-operator`) — decent history, but on `sort.line1` tags.
- SLOs: 4 seeded (Belt temp telemetry 99.5/99.7, Bin level uptime 99.0/99.5, Conveyor
  availability 99.9/99.95, Vision camera frame…) — all bound to `plant1.sort.line1.*`
  paths, i.e. the sorting-line namespace, not the batching plant. Retention shows 8h
  while the label claims 30d (confirmed from prior round).
- Cameras: zero on every route tested (`/sites/{id}/cameras`,
  `/edges/{edge}/cameras` → 404). The camera feature has no demo data at all.
- `demo-admin` is a literal accepted bearer token (rejects no-auth and malformed
  tokens, accepts `Bearer demo-admin`) and carries **admin role in all 13 orgs**,
  including the `sec-org-*` security-test orgs. Public token is fine for a demo;
  admin-in-every-test-org is not.

## Score /10 (as HMI)

**3/10.** A believable plant exists in the database — but the demo drops the viewer
into an empty test org, shows an onboarding checklist under a "live" banner, and every
surface that should tell the story (cameras, machines config, OEE, tag list) is either
empty or littered with test residue. As a sales engineer I could not run this in front
of a customer today.

## HMI/ISA-101 verdicts

- **Departure (dev):** the seeded world must be *curated*, not accumulated. One org,
  one site, one plant narrative; test orgs and test edges must never be visible to the
  demo identity.
- **ISA-101 situational awareness:** the overview claims "live" while every value is
  stale/dashes and the banner says Reconnecting — the worst possible combination: it
  trains the viewer to distrust the data, the exact habit ISA-101 exists to prevent.
- **Hierarchy:** the demo lands on org→site→line but the line ("Sorting line 1") does
  not match the seeded equipment (batch plant). L1/L2 consistency broken.
- **Naming:** `auto/*`, `batch/*`, `sort/*` triple namespace + `cam-*`/`t_*`/`pydev`
  junk = the tag tree reads like a test fixture dump, not a tag database a controls
  engineer would recognize.
- **Alarm story is the one adult in the room:** real raised→ack→clear lifecycle with
  timestamps and an actor (`demo-operator`). Keep this; extend to 20–30 events.

## AI-slop flags

- Org names `pytest-org-b-d1f4011e`, `sec-org-b-38f2b1ab` in a customer-facing picker.
- Machine names that are literally signal names (`bin1 level_pct`, `admix1 flow_lpm`)
  — a seed flattening bug, reads as generated filler.
- `cam-<8-hex>` ghost edges, `t_<8-hex>` ghost tags, `pydev` tag.
- Three overlapping plant models in one site: same asset (aggregate bins) exists as
  `batch/agg/*` and `auto/aggregate_bin_*` simultaneously.
- SLOs bound to `plant1.sort.line1.*` while the machine fleet is batching equipment —
  the semantic layer doesn't agree with itself.
- Edge heartbeat 7h stale yet `status: "active"` + UI "Reconnecting" — the seed lies
  about liveness in both directions.

## What works

- The `batch/*` tag skeleton is genuinely believable concrete-plant taxonomy
  (cem silos, agg bins, liq admix/water, mix, air compressor, plant status).
- Alarm lifecycle data is realistic (raise→ack-by-operator→clear with durations).
- SLO definitions themselves are plausible (belt temp telemetry, bin sensor uptime,
  conveyor availability) — just wired to the wrong namespace.
- Auth does reject missing/malformed tokens; the problem is scope, not absence.

## What the demo world SHOULD be

One org, one site, one story — a Thai ready-mix / precast concrete plant, seeded
deterministically (fixed seed, wiped-and-rebuilt on deploy):

- **Org:** "Siam RMC Co., Ltd." (or "Bangna Ready-Mix"), enterprise plan. The demo
  token sees exactly this org — plus maybe one "Demo Sandbox" — never pytest/sec orgs.
- **Site:** "Plant 1 — Bang Na" (UTC+7, Bangkok tz). One edge "GW-BN01", heartbeat
  <60 s old, synth adapter pushing values.
- **Machines (named like a plant, not a fixture):** Twin-shaft Mixer `MIX-01`,
  Cement Silos `SILO-01..04`, Aggregate Bins `AGG-01..06`, Weigh Hopper `WGH-01`,
  Skip Hoist `SKP-01`, Screw Conveyors `SCR-01..04`, Belt `BCV-01`, Admix Pumps
  `ADM-01/02`, Water Batching `WTR-01`, Dust Collector `DST-01`, Air Compressor
  `AIR-01`.
- **Tag paths:** `bn01.batch.mix01.current_a`, `bn01.batch.silo03.level_pct`,
  `bn01.batch.agg02.gate_open`, `bn01.batch.wgh01.weight_kg` — one namespace, ISA-95
  flavored. ~80–120 tags, all with units and sane min/max.
- **Cameras:** 4 seeded RTSP/loop-clip cams — "Mixer bay", "Aggregate yard",
  "Load-out lane", "Gate/Weighbridge" — at least one marked live, one degraded.
- **Stops:** today's shift should show 3–4 believable downtimes (chute blockage 22 min,
  mix over-current 6 min, silo refill wait 14 min, sensor recal 4 min) so OEE lands
  ~82–88% — a number worth talking about, not 100 or 0.
- **Alarms:** ~25 over 7 days: a couple criticals acked within minutes by named Thai
  operators (`somchai.p`, `nida.k`), warnings self-cleared, one shelved — shows the
  ack workflow and the shelving feature.
- **SLOs:** rebind to the batch namespace; fix retention to match the 30d label.
- **Demo identity:** `demo-viewer` read-only + `demo-operator` for the ack demo;
  rotate or scope `demo-admin`; it must not be admin in test orgs.

## Which empty surfaces kill the story (ranked)

1. Org switcher / landing org — lands on an empty pytest org; nothing else matters
   until this is fixed.
2. Overview "live" page showing onboarding checklist + all dashes + Reconnecting.
3. Cameras page empty tile — a marketed feature with zero demo data.
4. Machines all `configured:false` → OEE/downtime/shift pages empty or meaningless.
5. Devices/edges list polluted with 40 dead `cam-*` ghosts.
6. Tag browser showing three namespaces + `t_*`/`pydev` junk.
7. Channels "Reconnecting", 502s on orgs/sites — visible instability.
8. SLO 8h vs 30d label — small but a sharp-eyed prospect catches it.

## Top fix

**Build a deterministic "demo seed" that runs on every environment reset:** wipe the
demo org, seed exactly one Thai concrete plant (one site, one edge, ~15 named machines,
~100 `bn01.batch.*` tags, 4 cameras, a week of alarms/downtimes/shifts), and pin the
`?demo=admin` flow to always land in that org with a fresh heartbeat. Then exclude
`pytest-*`/`sec-*` orgs and `cam-*`/`t_*` entities from any token the demo uses.
Everything else (502s, retention label, token scoping) is second-order to "the demo
opens on the right, populated world."

---

