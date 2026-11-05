# Keep Plex, swap Thai, draw symbols

Keep Lucide and IBM Plex Sans and Mono, replace IBM Plex Sans Thai with Anuphan, and draw 20 to 40 in-house process symbols. From the three products, take Grafana's cursor and time mechanics, Datadog's facets for review, and Unity Catalog's on-demand lineage for engineers, all away from the live overview. Nothing here has been tested with operators or in the app. **No standard's clause text was read**, so any claim that ISA-101 or ISA-18.2 requires a given colour or shape is unverified.

## Standards inform the symbols; vissointan must define alarm coding

ISA-5.1 covers instrument identification ([ISA](https://www.isa.org/standards-and-publications/isa-standards/isa-standards-committees/isa5-1)), ISO 14617-2 process diagram symbols ([summary](https://genorma.com/en/standards/iso-14617-2-2025)), and ISO 7000 and IEC 60417 equipment-operation symbols ([IEC](https://webstore.iec.ch/en/publication/7514)). None defines web icons, so describe the set as "informed by" them. **Silo, hopper, mixer, cement and concrete matched no filename in Lucide, Phosphor, Carbon, Material Symbols or Tabler**, so switching libraries solves nothing. Tabler shares Lucide's grid and stroke, making it the chrome fallback ([Tabler](https://tabler.io/icons)).

Open sets fall short: `open-pid-icons` has 6 entries ([npm](https://www.npmjs.com/package/open-pid-icons)), and the fullest SVG set is CC BY-SA ([author](https://reboil.com/ikiwiki/blog/posts/0020230524T0730+00..iso_10628_symbol_drawing_update)). Draw `currentColor` line symbols on Lucide's grid, with a text label beside each and state in overlays.

Code alarms by shape, colour and text ([Control Global](https://www.controlglobal.com/articles/2011/the-ultimate-hmi)). Published mappings conflict, even across Ignition's versions ([7.9](https://docs.inductiveautomation.com/docs/7.9/visualization-and-dashboards/understanding-components/high-performance-hmi-techniques), [8.1](https://docs.inductiveautomation.com/docs/8.1/ignition-modules/vision/common-tasks-in-vision/high-performance-hmitechniques)). Our proposal, not a standard: four shapes, priority numbers and reserved colours, legible in greyscale.

## Anuphan wins on metrics, not loops

Both Thai faces are loopless, so the switch is about fit. **Plex Sans, Plex Mono and Anuphan share hhea metrics of 1.025/-0.275 and 0.6 em digits; Plex Sans Thai has 1.116/-0.534** ([file](https://raw.githubusercontent.com/google/fonts/main/ofl/anuphan/Anuphan%5Bwght%5D.ttf)). Worst-case Thai ink at 13 px is 18.0 px against 19.5 px on one sample string, so use a 20 px minimum line box. Fontsource packages (OFL) satisfy `font-src 'self'`.

**Fontsource Latin subsets lack `zero`** ([Plex file](https://cdn.jsdelivr.net/npm/@fontsource/ibm-plex-sans@5.3.0/files/ibm-plex-sans-latin-400-normal.woff2)), so `slashed-zero` silently fails. Show tag values in Plex Mono, whose default zero is marked. JetBrains Mono merits a same-screen test, ligatures off. Inter and Geist default to proportional digits; Grafana's Inter ([source](https://raw.githubusercontent.com/grafana/grafana/main/packages/grafana-data/src/themes/createTypography.ts)) is precedent, not evidence.

Typotheque's 180-reader study favours looped Thai for paragraphs ([Typotheque](https://www.typotheque.com/research/effects-of-loops-in-thai)), though it is foundry-run with no stated peer review. Use a looped face for long text, and test Thai alarm text with older operators. **Unverified:** rendering at 11 to 13 px on operator displays. No peer-reviewed font ranking for dense UI was found.

## Exploration must never scope alarms

Verdicts are judgement. Only the tracker has study support, read at abstract level and only when paired with a trained response strategy ([Laberge 2014](https://bvbvf1.bib-bvb.de/vufind/PrimoRecord/cdi_proquest_miscellaneous_1534806650)).

| Pattern | Verdict and change |
|---|---|
| Alarm tracker by area | Adopt, with written response procedure |
| [Shared crosshair, "now delay"](https://grafana.com/docs/grafana/latest/dashboards/build-dashboards/modify-dashboard-settings/) | Adopt; delay on rollups only |
| [URL time range](https://grafana.com/docs/grafana/latest/dashboards/use-dashboards/) | Modify: "HISTORICAL" banner, one-key return to live |
| [Correlations](https://grafana.com/docs/grafana/latest/administration/correlations/) | Modify: join on batch, equipment, shift |
| [Facets](https://docs.datadoghq.com/logs/explorer/facets/) | Review screens; 5 to 8 curated |
| [Query syntax, saved views](https://docs.datadoghq.com/logs/explorer/search_syntax/) | Engineers; operators get named view buttons |
| [Variables](https://grafana.com/docs/grafana/latest/dashboards/variables/) | One template per plant, selection visible |
| [Panel editor](https://grafana.com/docs/grafana/latest/panels-visualizations/panel-editor-overview/) | Engineers; audit trail, no free palette |
| [Lineage](https://docs.databricks.com/aws/en/data-governance/unity-catalog/data-lineage) | Engineers; one-level expansion, survives renames |
| Density modes, auto-layout, AI text | Reject |

**Unverified:** Datadog's shared cursor, its logged-in fonts, DRUIDS icon details and Databricks' product fonts.

## The reference sites confirm stacks, not techniques

zams.com, the d/b/a of Obviously AI, runs Webflow and GSAP 3.15.0, with no `stroke-dashoffset` in its initial HTML ([zams.com](https://zams.com)). **Unverified:** how the line art is made and what GSAP animates, so it is no precedent for an SVG line-draw.

maze.co is Gatsby 5.16.1, with CSS `animation-timeline:view()`, staggered `animation-range` utilities and a fixed WebGL canvas container; its initial HTML has no GSAP, ScrollTrigger, Lenis or Lottie string ([maze.co](https://maze.co)). **Unverified:** JS bundles, the WebGL content and browser support; pages were not rendered. Use such motion on marketing pages only.

## Conclusion

The biggest risk is the alarm philosophy, not fonts or icons: it is safety-relevant and public sources cannot supply it. Decide it with plant engineers first, buying ISA-18.2 and ISA-101 if compliance will be claimed.
