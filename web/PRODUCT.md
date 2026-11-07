# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

- **Operator (primary for every live screen).** Watches the plant on a control-room monitor for a whole shift, sometimes a wall screen. Glances from a distance, acknowledges alarms, starts and stops equipment through the guarded command path. Reads Thai first. Does not want to type or configure anything.
- **Engineer / integrator.** Enrolls edge gateways, connects PLCs and simulators, defines tags, maps the plant's 3D model to equipment, builds dashboards and alarm rules. Works on a laptop, wants speed, an instant preview and errors that point at the exact field.
- **Admin / IT.** Members, roles, MFA, audit, API keys, plan limits. Wants enforceable policy and audit evidence.

## Product Purpose

vissointan (LINE CONSOLE) is a multi-tenant SaaS SCADA and monitoring console for bulk-material plants: aggregate sorting lines with vision AI and concrete batching plants. Data flows PLC/simulator -> edge gateway -> MQTT (TLS) -> cloud backend -> browser. The console shows the live plant, raises and manages alarms, trends and historises signals, computes OEE and downtime, runs customer-trained YOLO models on cameras, and sends guarded commands back to the PLC. It is also a thesis project, so it is demonstrated to examiners on simulated plants.

Success: an operator can tell within one glance whether the plant is normal, what is abnormal and where, and can act on it safely; an engineer can bring a new gateway, PLC and plant model online without help.

## Positioning

The operator's process mimic comes from the plant's own 3D model (.glb). Equipment is mapped by clicking the model, and the same mapping drives the 3D twin, the 2D plan and the SCADA mimic, so the drawing is the real plant, not a generic diagram. On top of that: per-truck AI material decisions (gravel/sand) that can drive the PLC under the same command gates, and Datadog-grade dashboards, monitors and SLOs applied to industrial tags.

## Operating Context

- Control room: monitor left open all shift; alarms must be noticed from across the room. ISA-101 (high-performance HMI) and ISA-18.2 (alarm management) are the reference standards already cited in code.
- Engineering setup happens on a laptop next to the line or remotely.
- Hierarchy is ISA-95: Org (enterprise) > Site > Area > Line > Equipment, with per-area command rights.
- Demo and simulated data are common (Factory I/O sorting line, batching-plant simulator, auto-generated sim tags) and must always be labelled as such.
- Languages: Thai and English for every UI string (`scripts/check-i18n.mjs`).

## Capabilities and Constraints

- Web stack: React 19, React Router, TanStack Query, Tailwind v4 (`@theme` tokens in `src/dd-theme.css`), uPlot for time series, three.js for the twin, lucide icons, IBM Plex bundled via @fontsource (CSP allows self-hosted fonts only).
- Tag paths are UNS style (`area/line/device/signal`), tag types are bool or number.
- Commands go only through the guarded path: role, edge online, clock sync, confirm, per-tag rate limit, audit. A mapping or a mimic never writes to a PLC. AI PLC writes are a plan limit (`plan_limits.ai_plc_write`).
- Data sources today: simulator, Modbus, S7, OPC UA; BACnet and Sparkplug B are planned. Cameras are registered as devices.
- Web tests run with `bun:test`.
- Open decision: a free drag-and-drop HMI editor was an explicit non-goal in the 2026-10-19 SCADA parity design.

## Brand Commitments

- Name "vissointan", console wordmark "LINE CONSOLE", existing logo mark (the bird) in the rail.
- The public landing page has its own world (`web/DESIGN.md`, `--hx-*`); the signed-in console does not inherit it.
- Standing preference (2026-10-20, after two re-rolled direction rounds): the console follows the category standard executed at full craft. The bar is Datadog and Grafana for analytics surfaces (dashboards, trends, production, platform) and Siemens WinCC Unified, AVEVA and Ignition for process surfaces (mimic, faceplates, alarm banner, wall). The user asked for "more motion and flair": components and screens animate, but every motion maps to a real state change.

## Evidence on Hand

- Bundled concrete batching plant model `web/public/models/centrale-beton.glb` with the demo mapping `DEMO_PARTS` in `src/lib/plantModel.ts` (30 parts: aggregate bins, belts, cement silos, mixer, skip hoist, blower, pipe runs).
- Factory I/O-style sorting line simulator (motor, conveyor, vision camera, bin) and 42 batching-plant sim tags (`edge-bridge/tags.yaml`).
- Aggregate AI demo: seeded camera, clip and sim tags (`scripts/seed_material_demo.py`).
- No real customer plant data, customers, benchmarks or testimonials exist; none may be invented.

## Product Principles

1. Colour means abnormal. Normal operation looks calm and grey; alarms, faults and stale data are the only things that take colour, always with a shape and a word.
2. Truthful state. Stale, simulated, unmapped or disconnected data never looks live.
3. The plant model is the source of truth for equipment and layout: draw what the model shows, never invent equipment or connections.
4. Safe by default. Control actions are explicit, gated, confirmed and audited; viewing never writes.
5. Plant work first. Operator and engineer jobs own the navigation; IT and observability depth sits one level down in a Platform area.

## Accessibility & Inclusion

- WCAG 2.1 AA; status never by colour alone (colour + shape + text).
- Readable from control-room distance; tabular figures for live values.
- Thai typography: no uppercase or letter-spacing on text that can be Thai; Anuphan fallback.
- Reduced motion honoured everywhere, including mimic animations.
