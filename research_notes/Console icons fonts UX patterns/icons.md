# Icon and symbol standards for vissointan (checked 2026-11-05)

Recommendation: keep Lucide for UI chrome. Draw a small in-house process symbol set and a separate alarm indicator component. Do not depend on an open P&ID library.

Evidence labels:
- **Measured** means counted or read from the published npm tarball or the GitHub API on 2026-11-05. The package URL is the source.
- **Secondary** means a vendor, blog, or standards-body summary, not the standard's text. No standard's full text was read for these notes.

## What do the symbol standards cover, what does ISA-101 / ISA-18.2 say about alarm shape and colour, and which apply to a web HMI?

### Takeaway
None of the symbol standards defines web UI icons. ISA-5.1 and ISO 14617 are the relevant references for process diagrams, ISO 7000 / IEC 60417 for equipment-operation symbols, and IEC 60617 for electrical items. Triple-coding alarms (colour, shape, text or number) is well supported in secondary sources, but no source read gives a standard shape-to-priority or colour-to-priority mapping, so vissointan must define its own in an alarm philosophy.

### Cited Findings
Symbol standards (all secondary: publisher pages and catalogue summaries)
- ISA-5.1 sets a common designation system of symbols and identification codes for measurement and control instruments, and it applies across process industries. — [ISA5.1 committee](https://www.isa.org/standards-and-publications/isa-standards/isa-standards-committees/isa5-1)
- The current edition is ANSI/ISA-5.1-2024, retitled to include control symbols, with companion reports ISA-TR5.1.02 and ISA-TR5.1.03. A further report, TR5.1.04, was in public review with comments due 22 June 2026. — [ISA press release](https://www.isa.org/news-press-releases/2024/october/widely-used-engineering-symbols-and-drawings-stand); [ISA public review](https://www.isa.org/standards-and-publications/isa-standards/news/ansi-public-review)
- ISO 14617-2:2025 covers diagram symbols for industrial components, products and processing. It excludes electrotechnical objects, which it refers to the IEC 60617 database, and measurement and control function symbols. — [ISO 14617-2 summary](https://genorma.com/en/standards/iso-14617-2-2025)
- Another ISO 14617 part covers measurement and control components in diagrams. — [BSI listing](https://knowledge.bsigroup.com/products/graphical-symbols-for-diagrams-measurement-and-control-devices)
- IEC 60417 symbols identify equipment or its parts, indicate functional states, designate connections, and instruct operation. — [IEC 60417 summary](https://genorma.com/en/standards/iec-60417-ed0)
- ISO 7000 is a registered collection of symbols for equipment of any kind. ISO 7000:2019 is listed as a current edition, and earlier editions are withdrawn. — [ISO 7000:2019](https://www.iso.org/standard/78717.html)
- The joint ISO/IEC database holds more than 5,200 symbols from IEC 60417 and ISO 7000. IEC 60417 is mainly electrotechnical and ISO 7000 covers other areas. — [ISO/IEC SYMBOL](https://webstore.iec.ch/en/publication/7514); [IEC TC 3](https://tc3.iec.ch/tc-activity/graphical-symbols-for-use-on-equipment/)

HMI and alarm guidance
- ISA lists ISA-101.01-2015 as its core HMI standard, covering the HMI lifecycle for continuous, batch and discrete industries. Supporting reports are TR101.01-2022 and TR101.02-2019. Its overview page gives no colour or alarm-shape rule. — [ISA-101 page](https://www.isa.org/standards-and-publications/isa-standards/isa-101-standards)
- ISA-18.2-2016 covers alarm-system lifecycle management for control-system and HMI alarms in process industries, including continuous, batch and discrete processes. Summaries read for these notes do not show shape or colour rules. — [ANSI webstore](https://webstore.ansi.org/standards/isa/isa182016); [InTech](https://www.isa.org/intech-home/2016/may-june/departments/isa18-alarm-management-standard-updated)
- Alarm priority is defined during rationalization. — [ISA search summary of technical report; page not opened](https://www.isa.org/intech-home/2016/may-june/departments/isa18-alarm-management-standard-updated)
- Ignition's high-performance guidance uses grey-scale design, simple shapes for tanks, pumps and meters, and alarm indicators that differ by shape, colour and text. It presents this as helping colour-blind users. — [Ignition 8.1 docs](https://docs.inductiveautomation.com/docs/8.1/ignition-modules/vision/common-tasks-in-vision/high-performance-hmitechniques.md)
- Control Global's article on Hollifield's work says alarms should be coded consistently by colour, shape and text. — [Control Global](https://www.controlglobal.com/articles/2011/the-ultimate-hmi)
- The mappings conflict across sources:
  - Ignition 7.9 shows a high-priority alarm as a yellow triangle with "2". — [Ignition 7.9](https://docs.inductiveautomation.com/docs/7.9/visualization-and-dashboards/understanding-components/high-performance-hmi-techniques)
  - Ignition 8.1 shows a critical alarm as a red rectangle with "1". — [Ignition 8.1](https://docs.inductiveautomation.com/docs/8.1/ignition-modules/vision/common-tasks-in-vision/high-performance-hmitechniques)
  - Tatsoft lists critical red, high orange, medium yellow, low cyan and suppressed purple under an "ISA-18.2 Aligned" heading. The summaries of ISA-18.2 read for these notes show no such palette, so treat this as Tatsoft's own choice. — [Tatsoft](https://docs.tatsoft.com/display/FX/ISA-101+HMI+Compliance+How-to)
  - A blog-level source instead attributes yellow, red and blue deviation colours to ISA-101. Low confidence. — [Processing Magazine](https://www.processingmagazine.com/process-control-automation/article/55386069/bridging-the-gap-between-automation-and-operator-awareness-in-the-process-industries)

### Inferences
- Applicability to a web HMI:
  - **ISA-101 and ISA-18.2:** apply as design and lifecycle guidance.
  - **ISA-5.1:** use its identification logic for tags and instrument bubbles, if the console shows instruments.
  - **ISO 14617:** optional reference for equipment shapes.
  - **ISO 7000 / IEC 60417:** a meaning reference for operation symbols such as start or stop, not a UI icon source.
  - **IEC 60617:** only relevant if electrical single-line views are added.
- Concrete batching and aggregate sorting equipment (silos, hoppers, conveyors, screens) may not map neatly to these chemical-process-heavy sets. Which of them the standards include is unverified, so label symbols with text.
- Proposed default for the alarm philosophy, not a standard: four distinct shapes, each with a priority number and a reserved colour, used for nothing except alarms. It must remain legible in greyscale.

### Gaps
- The clauses of ISA-101.01, ISA-18.2, ISA-5.1, ISO 14617, IEC 60617, ISO 7000 and IEC 60417 are paywalled and were not read. Any claim that a standard requires a specific colour or shape is unverified.
- IEC 60617's scope is known here only through ISO 14617's boundary statement. Its own page was not read.
- IEC 63303 was searched for as a possible international HMI standard, and nothing confirmed its scope or its relationship to ISA-101.
- The Hollifield handbook was not read. A claimed diamond-with-number example came from a Scribd copy of a paper and is excluded as weak.

## How do Lucide, Phosphor, IBM Carbon, Material Symbols and Tabler compare?

### Takeaway
All five are permissively licensed and cover generic industry poorly. Material Symbols has the most relevant process names and Tabler the most glyphs, but neither covers silo, hopper or mixer by filename, so no switch solves the process-symbol gap. Keep Lucide unless a measured need appears.

### Cited Findings
Counts are measured file counts.

| Library (version) | Licence | Files counted | Grid and stroke | Filename matches for industrial terms |
|---|---|---|---|---|
| [Lucide](https://www.npmjs.com/package/lucide-static) 1.69.0 | ISC, with MIT for Feather-derived icons ([licence](https://lucide.dev/license)) | 2,317 SVG, including some aliases, so distinct glyphs are fewer | 24 viewBox, 2 px stroke, round caps and joins | factory, forklift, gauge, circle-gauge, siren, scale, weight, briefcase-conveyor-belt |
| [Phosphor](https://www.npmjs.com/package/@phosphor-icons/core) core 2.1.1 | MIT | 1,512 per weight, 6 weights | 256 viewBox, fill-based paths | factory, crane, crane-tower, gauge, gas-pump, pipe, pipe-wrench, scales, siren |
| [Carbon](https://www.npmjs.com/package/@carbon/icons) 11.92.0 | Apache-2.0 | 2,644 in `svg/32`, only 68 in `svg/16` | 32 viewBox, fill-based paths | industry, tank, scale, scales, pipelines |
| [Material Symbols](https://www.npmjs.com/package/@material-symbols/svg-400) community SVG 0.48.3 | Apache-2.0 ([Google docs](https://developers.google.com/fonts/docs/material_symbols)) | 3,940 outlined, excluding `-fill` | Variable: FILL, wght 100-700, GRAD, opsz 20-48 | valve, water_pump, heat_pump, conveyor_belt, factory, forklift, propane_tank, siren, scale, weight |
| [Tabler](https://tabler.io/icons) 3.50.0 | MIT | 5,203 outline + 1,054 filled = 6,257, matching the site | 24 viewBox, 2 px stroke | building-factory, circuit-motor, crane, forklift, gauge, pipeline, scale, weight, tank |

- Google's page gives both "over 2,500" and "3,800+" for Material Symbols. The package count above differs again. — [Google docs](https://developers.google.com/fonts/docs/material_symbols)
- Lucide Lab has 357 icons, and a filename search for valve, pump, conveyor, silo, tank, mixer, factory, gauge and truck matched only "pumpkin". — [@lucide/lab](https://www.npmjs.com/package/@lucide/lab)
- `web/package.json` pins `lucide-react` 1.48.0. The latest Lucide release tag is 1.69.0. — local file; [Lucide repo](https://github.com/lucide-icons/lucide)
- Repo activity: Phosphor core's last push was 2026-01-06, while Lucide, Carbon, Tabler and Material all had pushes in October or November 2026. — [Phosphor core](https://github.com/phosphor-icons/core); [Tabler](https://github.com/tabler/tabler-icons)

### Inferences
- Lucide stays the best fit: it is already integrated, stroke-based and tree-shakable per icon, and its gaps are in process equipment, which a chrome set should not carry anyway.
- A process glyph on a 24 grid with Lucide's stroke rules would sit visually with the UI set. Material's `valve` and `conveyor_belt` could inform meaning, but mixing their fill-based geometry into stroke icons would look inconsistent.
- Tabler is the fallback if chrome coverage becomes a problem, since it shares the 24 grid and 2 px stroke, making a migration or occasional borrow visually low-risk. MIT requires retaining its notice.
- At 12 to 16 px in dense screens, a 2 px stroke may look heavy. Lucide's stroke width is configurable; test 1.5 px with real screens. This is design judgement, not measured.

### Gaps
- Coverage comes from filename matching for selected terms, so glyphs with other names are missed. Search terms silo, hopper, mixer, cement and concrete returned no match in any of the five.
- "tank" in Tabler and Carbon was not viewed and may not mean a storage tank.
- Carbon's documentation page exceeded the fetch limit, so its official sizes and stroke guidance were not read. Phosphor's site returned no usable content, so its figures rest on the package only.
- Lucide's distinct, alias-free count was not computed.

## What do Grafana, Datadog and Databricks actually use?

### Takeaway
Grafana uses forked Unicons plus Font Awesome and custom icons. I found no separate "Saga icon set". Databricks ships its own 16 px set. DRUIDS has its own icon gallery, but its contents could not be read. The pattern among those verified is one custom or adapted set plus domain extras.

### Cited Findings
- Grafana's `Icon` component is described as a wrapper over Font Awesome and Unicons. — [Icon.mdx](https://raw.githubusercontent.com/grafana/grafana/main/packages/grafana-ui/src/components/Icon/Icon.mdx)
- Grafana keeps `custom`, `iot`, `marker`, `mono`, `solid` and `unicons` folders. `unicons` holds 1,000 entries, and its NOTICE credits IconScout. — [Grafana icons](https://github.com/grafana/grafana/tree/main/public/img/icons); [NOTICE](https://github.com/grafana/grafana/blob/main/public/img/icons/unicons/NOTICE.txt)
- New Grafana icons go in `unicons/` even when they are not Unicons, and custom icons use `gf-` names such as `gf-traces`. — [icons README](https://github.com/grafana/grafana/blob/main/public/img/icons/README.md)
- Saga is Grafana's open source design system. Searches did not surface a Saga-specific icon library, and the guessed iconography URL returned 404. — [Saga overview](https://grafana.com/developers/saga/about/overview/)
- DRUIDS is for Datadog internal use and is not open source, though its documentation site is public. A search summary says the site has an icon gallery and construction principles, and that components accept a DRUIDS Icon or IntegrationLogo. — [DRUIDS](https://druids.datadoghq.com/); [Badge](https://druids.datadoghq.com/components/pills/Badge); [Datadog blog](https://www.datadoghq.com/blog/engineering/druids-the-design-system-that-powers-datadog/)
- Cloudcraft's icon sets (AWS, Azure, Font Awesome) are a separate product and should not be attributed to DRUIDS. — [Cloudcraft docs](https://docs.datadoghq.com/cloudcraft/components-common/icon/)
- Databricks' package is now branded "dbui", with Du Bois as its default theme. Version 2.0.16 ships 502 SVG files on a 16 px grid with `#727272` fills, including variants such as `DangerFillIcon` and `DangerSmallIcon`. It also depends on `@ant-design/icons`. Package metadata says ISC. — [@databricks/design-system](https://www.npmjs.com/package/@databricks/design-system)
- Its guidance classifies each icon as object, action, state or control chrome, searches a metadata file by concept, and requires an accessible name for icon-only controls, noting that a tooltip alone does not supply one. — [same package, `design-guidance/skills/dbui-pick-icon.md`](https://www.npmjs.com/package/@databricks/design-system)

### Inferences
- Worth copying: Databricks' four-way classification and Grafana's custom prefix. A `process/` namespace would keep equipment symbols apart from chrome.
- DRUIDS glyphs should not be reused because the system is internal. Grafana's are not a shortcut either, because of its mixed licensing.

### Gaps
- DRUIDS pages rendered only the word "DRUIDS" to the fetcher, so its icon count, grid and stroke are unknown.
- Grafana's `LICENSING.md` lists the Unicons folders separately from the default, but the heading of that list was not read, and neither was the upstream Unicons licence. Check both before reusing any glyph.

## Are there open, licence-clean P&ID/SCADA SVG libraries usable in a product?

### Takeaway
I found none that is both broad and clean enough to adopt as is. MIT `open-pid-icons` is tiny and its repo is now unreachable. The best full sets are CC BY-SA or not in SVG. Drawing an in-house set of 20 to 40 plant-specific symbols is the safest route.

### Cited Findings
- `open-pid-icons` 1.0.0 is MIT in its bundled licence and JSON, but its package metadata has no licence field. It has only 6 entries in JSON, 2 tank and the rest valve-matched by keyword, with no pump. — [npm package](https://www.npmjs.com/package/open-pid-icons)
- On 2026-11-05 its GitHub repo returned 404 from both the API and the website, although the package remains downloadable. — [repo URL](https://github.com/tbo47/open-pid-icons)
- A Wikimedia Commons palette redraws all ISO 10628-2:2012 symbols in Inkscape as SVG and PDF sheets, under CC BY-SA 4.0 per its author, who bought the standard and drew each symbol by hand. — [author's blog](https://reboil.com/ikiwiki/blog/posts/0020230524T0730+00..iso_10628_symbol_drawing_update)
- Black & Veatch's American National Standard set is CC BY-SA 4.0, in MicroStation `.cel` cell libraries. It is not SVG. — [license file](https://github.com/BVLtd/PID-Symbols-American-National-Standard/blob/main/License.md)
- The British Standard sibling is reported as CC BY 4.0 from BS 1646, for water-industry work. It is also a cell-library project and was last pushed in 2014. The licence comes from a search summary and was not opened. — [BVLtd British set](https://github.com/BVLtd/PID-Symbols-BritishStandard)
- `inkscape-open-symbols` has an MIT repo licence, but it is an aggregator, and its contents' licences were not audited. — [repo](https://github.com/PanderMusubi/inkscape-open-symbols)
- FreeCAD's symbol library is described as CC-BY 3.0 and is general purpose, not P&ID-specific (search summary). — [FreeCAD wiki](https://wiki.freecad.org/Translations:External_workbenches/125/en)

### Inferences
- CC BY-SA requires attribution and sharing adaptations under the same licence. Using such symbols inside a product may raise questions about what counts as an adaptation. This is not legal advice, and it is a further reason to avoid them.
- Recommended process-symbol approach:
  1. List the equipment that vissointan's plant views actually need: silo, hopper, weigh batcher, mixer, belt conveyor, screen, crusher, pump, valve, truck bay, for example. This list is a starting point and needs checking with the plant's engineers.
  2. Draw original SVGs on one grid, using neutral `currentColor` strokes and no status colour in the art.
  3. Drive state from separate overlays: run state as text or a simple marker, and alarms through the shared alarm indicator.
  4. Keep connection anchors in metadata. `open-pid-icons`' data format (`path`, `width`, `height`, `anchors`, `type`) is a useful model.
  5. Show the text label alongside every symbol, and record which standard's convention informed each one. Describe the set as "informed by", never "compliant with", unless checked against purchased text.
- Buy ISA-5.1 only if the console must show formal instrument loops.

### Gaps
- Whether original drawings that closely follow a standard's symbols raise copyright issues, and what reuse the ISO 7000 / IEC 60417 database licence permits, were not verified. ISO's publication page returned 403. Get advice before copying them.
- Search coverage was limited. Other open SCADA symbol sets, such as those in open-source HMI projects, were not audited.
- Wikimedia file pages for the ISO 10628 set were not opened, so per-file licences and completeness rest on the author's blog.
