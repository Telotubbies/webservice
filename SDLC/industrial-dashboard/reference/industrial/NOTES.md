# Industrial SCADA / HMI Reference Set

Collected 2026-10-13 for the industrial operations console (mission-surface /
ISA-101 high-performance HMI direction). All images verified as real image files;
every retained file is >30 KB. Sources: Wikimedia Commons (freely licensed),
Inductive Automation docs + showcase, AVEVA.com, public GitHub Ignition projects.

Pixel statistics below were measured on each file (lum = mean luminance 0–1,
grey% = share of near-achromatic pixels) to objectively confirm "high-performance"
vs "traditional colorful" styling.

## High-performance / ISA-101 style screens (priority a)

- **ignition-hphmi-grey-overview.png** — Ignition docs, canonical High Performance
  HMI example. Light grey (lum 0.84, sat 0.02, 93% grey) schematic of vessels,
  pumps and lines in flat 2-D greyscale; color appears only as tiny alarm/state
  accents. THE reference for the "happy plant = grey screen" doctrine.
- **ignition-traditional-hmi.png** — Ignition docs, deliberately "bad" traditional
  colorful 3-D-ish HMI shown for contrast with the HP version above.
- **bhp-highperf-hmi-ignition.png** — Inductive Automation customer showcase:
  BHP Technology Remote Operations Centre high-performance HMI built on Ignition
  Perspective. NOTABLY DARK (lum 0.24, 96% grey, sat 0.10): dark-charcoal
  background, thin grey vector equipment, data chips — proof that a serious
  production HP-HMI deployment can be dark-themed, matching our graphite direction.
- **ignition-isa101-scada-1.png / -2.png / -3.png** — GitHub `Abijith0/plc_scada_demo_mes`,
  an Ignition 8.3 tank-control project explicitly built to ISA-101. Light grey
  cards (lum 0.83, ~95% grey); scada-2/-3 show a red alarm state (~2.4% red) —
  color used ONLY when abnormal. Card-based layout, trends embedded beside values.
- **ignition-hmi-tank-ui.png** — GitHub `downl2160/ignition-scada-tank-monitoring`:
  Ignition Perspective HMI with a radial tank-level gauge, pump toggle, alarm
  status table and trend chart. ~10% red (alarm banner) on a light background.
- **ignition-alarm-triggered.png** — same project, alarm-active state: red alarm
  table + status region (~18% red, 22% blue). Alarm = dedicated list/table with
  colored severity cells.
- **ignition-hphmi-radar-chart.png** — Ignition docs radar/spider chart promoted
  as an HP-HMI component for multivariable comparison (364×329, kept: small but genuine).
- **aveva-pi-vision-dashboard.jpg** — AVEVA PI Vision operations dashboard (from
  aveva.com Avebe case study): dark-ish theme (lum 0.38), KPI chips, process
  flow indicators, real-time alert rows; ~8% green status accents. Confirms
  PI Vision ships dark-friendly, card/KPI-dense dashboards.

## Classic SCADA/HMI software screenshots (priority a/c)

- **cimact-hmi-screen.jpg** — CIMACT HMI (Eurocontrol air-traffic/military sensor
  fusion console). Dark grey UI (lum 0.36, 97% achromatic) with dense tabular
  tracks — dark-greyscale operational consoles exist outside process control too.
- **simatic-wincc-workspace.jpg** — Siemens SIMATIC WinCC workspace screenshot:
  classic Windows-era HMI with colorful P&ID mimic, toolbar chrome, ~18% blue.
  Representative of the pre-ISA-101 aesthetic.
- **eclipse-scada-demo.png** — Eclipse SCADA demo screen: light grey mimic,
  mostly achromatic (95%), minimal color — mid-2000s OSS SCADA look.
- **laquis-scada-software.png** — LAquis SCADA screenshot: traditional saturated
  mimic (sat 0.28, ~20% blue), 3-D tanks and pipes — contrast reference.
- **zenon-scada-editor.png** — COPA-DATA zenon 8.10 editor screenshot (1280px):
  IDE-like project/workspace view with light theme.
- **scada-pumping-station.jpg** — Photograph of a physical SCADA workstation
  monitor showing a pumping-station mimic (1032×854, Exif 2010) — real
  operator-desk context, not a marketing render.

## Control-room / operator-console photographs

- **altbach-power-plant-control-room.jpg** — Altbach power plant control room:
  modern curved desk, wall of operator monitors showing grey-ish graphics.
- **chernobyl-unit3-control-room.jpg** — Chernobyl NPP Unit 3 control room:
  wall-to-wall analog indicator panels — the ancestor of our tile grid.
- **fukushima-control-room-analog-panels.jpg** — Fukushima Daiichi control room:
  dense rows of circular analog meters, strip-chart recorders, annunciator
  windows — strongest validation that radial gauges tile well at wall density.
- **san-onofre-control-room-1968.jpg** — San Onofre NGS control room, 1968:
  full-width console + vertical annunciator/meter boards behind operators.
- **soviet-control-room-gauges.jpg** — Soviet-era control room: circular dial
  instruments in dense grid rows with red-line markings on gauge faces.
- **wendelstein-diagnostic-monitors.jpg** — Wendelstein 7-X fusion experiment
  control room: modern multi-monitor diagnostic wall, mixed trends/schematics.

## Gauge / panel-meter / alarm hardware close-ups (priorities b, d)

- **maximator-pressure-gauge.jpg** — MAXIMATOR high-pressure manometer face
  close-up: crisp circular scale, fine ticks, needle — dial-craft reference for
  our 240° arc (tick density, numeral placement, needle shape).
- **pressure-gauge-industrial.jpg** — Bourdon-tube pressure gauge on a red valve
  in situ: how a radial instrument reads at arm's length in the field.
- **rams-monitoring-panel.jpg** — NASA Remote Area Monitoring System panel:
  labelled meter windows + indicator lamps in a regular grid — physical
  equivalent of a tile grid with per-channel status lights.
- **annunciator-substation-panel.jpg** — Substation alarm annunciator board:
  matrix of labeled windows that back-light on alarm — the physical ancestor of
  our alarm list / severity badges.
- **datmeltech-alarm-annunciator.jpg** — Modern DIN alarm annunciator unit
  (Datmeltech): colored LED windows with engraved labels; first-out / ack
  behavior conventions.

---

## Patterns that validate / contradict our current design

Our design under test: 240° SVG analog panel meters (arc + ticks + needle +
red alarm-zone segments + PV numeral + sparkline), 72 px labeled nav rail,
dark graphite theme.

### Validated

- **Analog depiction at tile density.** Fukushima, Chernobyl, Soviet panels and
  the Hollifield/PAS doctrine all confirm radial/arc instruments remain legible
  when tiled densely — humans pattern-match needle angle faster than digits.
  Our dial-per-tile direction is sound.
- **Embedded trend per value.** ISA-101 material (Ignition docs, Rockwell
  Process HMI Style Guide) prescribes small trends beside key values; our
  in-tile sparkline matches exactly.
- **PV numeral beside the graphic.** Every real HMI pairs the analog indicator
  with a digital readout — our numeral-under-dial is correct.
- **Color reserved for abnormal.** The greytest reference screens (Ignition
  HP-HMI 93–96% achromatic, BHP 96%, CIMACT 97%) only light up on alarm. Our
  severity badge + `is-alarm` tile state align with this.
- **Dark theme is defensible.** ISA-101 canon prefers LIGHT grey backgrounds
  (Gray 3/4, ~#CCC–#D9D9), and most reference HP-HMIs are light — BUT two of
  the most credible real deployments are dark: BHP's production Ignition TROC
  screen (lum 0.24) and CIMACT (lum 0.36), plus PI Vision's dark-ish dashboard.
  Mission-surface / NOC-style dark graphite is a legitimate alternative
  convention; keep saturation low and let alarm colors carry the contrast.

### Contradictions / risks to consider

- **Permanent red arc segments on the dial.** ISA-101 convention does NOT paint
  alarm zones red on the instrument. Alarm limits are shown as small grey/dark
  limit markers (bands, tick flags, triangle pointers); red/amber appear only
  when the value is actually in alarm. Our always-on red zone segments spend
  the color budget HP-HMI tries to save — consider neutral limit markers +
  coloring only on violation.
- **Radial dials vs linear "moving analog indicators".** The dominant ISA-101
  element is a *linear* bar/pointer indicator showing normal band + alarm
  thresholds (Rockwell style guide, Hollifield Fig. 7, RealPars) — bars tile
  more densely and align rows better than circles. Radial dials are authentic
  (see Fukushima/Soviet walls) but read as "legacy panel" rather than modern
  HP-HMI; a linear-bar tile variant may be worth prototyping for L2 density.
- **Left icon rail vs HMI navigation convention.** Real HMIs navigate via
  display-hierarchy breadcrumbs + click-through on equipment, plus top/side
  *button bars* named after displays (WinCC/FactoryTalk nav bars), not app-style
  icon rails. Our 72 px labeled rail is fine for a web console, but consider
  (a) surfacing the L1–L4 level in the rail, and (b) breadcrumb/drill-down on
  the tiles themselves to match operator mental models.
- **Faceplates.** Convention: click an instrument → modal/docked faceplate with
  PV/SP/OP/mode + trend + ack. Our `useFaceplate`/Faceplate context matches —
  ensure the faceplate shows mode (Auto/Man/Cas) and SP/OP controls, the two
  elements every real faceplate (e.g. ignition-hmi-tank-ui's toggle + alarm
  table) exposes.
- **Alarm lists.** Real convention (annunciator photos, GoJS/ISA-101 sample,
  Ignition alarm table): rows = time, tag/label, priority color square, state;
  unacked alarms blink or hold saturated color until ack. Hardware annunciators
  (datmeltech, substation board) show the "window per alarm, lit when active"
  pattern our severity badges echo — keep the badge grid idea, add ack state.
- **2-D flat, not 3-D.** All HP references are flat 2-D (laquis/wincc show the
  3-D "before" style). Our flat SVG meters are on-convention; avoid skeuomorphic
  bezels/gradients on the dial face.

### Source/licence note

Wikimedia Commons images are freely licensed (see file pages for CC variants).
Ignition docs/showcase, AVEVA, GitHub project screenshots are vendor/community
material — internal design research only, do not redistribute in product.
