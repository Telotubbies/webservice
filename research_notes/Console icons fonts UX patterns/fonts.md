# UI fonts for vissointan: English/Thai dense-data SCADA console (checked 2026-11-05)

Evidence labels:
- **[file]**: I downloaded the font and read its tables with fontTools, or shaped text with HarfBuzz.
- **[css]**: read from CSS or HTML served without a login.
- **[source]**: read from a public source repository.
- **[secondary]**: search summary only; primary page not read.
- **UNVERIFIED**: could not be confirmed.

## Recommended stack

### Takeaway
Keep IBM Plex Sans and IBM Plex Mono, and change Thai from IBM Plex Sans Thai to Anuphan (variable). This is the lowest-risk change with a measurable benefit: all three fonts share the same vertical metrics and the same 0.6 em digit width. Anuphan also has 0.116 em less worst-case Thai ink height than Plex Sans Thai. No study supports choosing one of these specific fonts; the case rests on measured font properties and on a looped/loopless literature that does not test dense UI.

### Cited Findings
- Anuphan is a loopless Thai design by Cadson Demak, described as a loopless version of IBM Plex Thai, with Latin from IBM Plex — [Anuphan repository, secondary](https://github.com/cadsondemak/Anuphan).
- Plex Sans, Plex Mono and Anuphan all have hhea ascent/descent 1.025/-0.275 and default digits 0.6 em wide **[file]**. Plex Sans Thai has 1.116/-0.534 **[file]**. Files: [Anuphan](https://raw.githubusercontent.com/google/fonts/main/ofl/anuphan/Anuphan%5Bwght%5D.ttf), [Plex Sans](https://raw.githubusercontent.com/google/fonts/main/ofl/ibmplexsans/IBMPlexSans%5Bwdth%2Cwght%5D.ttf), [Plex Mono](https://raw.githubusercontent.com/google/fonts/main/ofl/ibmplexmono/IBMPlexMono-Regular.ttf), [Plex Sans Thai](https://raw.githubusercontent.com/google/fonts/main/ofl/ibmplexsansthai/IBMPlexSansThai-Regular.ttf).
- The current web app already bundles Plex through Fontsource, with Thai as the second family in `--font-sans` and `--font-mono` — `web/src/dd-theme.css` lines 93-94 and `web/src/index.css` lines 15-17 (local repo).
- `font-src 'self'` is set in `web/nginx.conf`, so all candidates must ship as bundled files (local repo).

### Inferences
Proposed tokens, not yet tested in the app:

```css
--font-sans: "IBM Plex Sans Variable", "Anuphan Variable", "Leelawadee UI", "Noto Sans Thai", system-ui, sans-serif;
--font-mono: "IBM Plex Mono", "Anuphan Variable", ui-monospace, Consolas, monospace;
```

- Packages: `@fontsource-variable/ibm-plex-sans`, `@fontsource-variable/anuphan`, and the existing `@fontsource/ibm-plex-mono`. Confirm the exact CSS family names from each package before use.
- Challenger for mono: JetBrains Mono. Its x-height is 0.55 em against Plex Mono's 0.516 **[file]**. It is variable, but its `calt` code ligatures must be disabled for tag values and formulas (`font-variant-ligatures: none`). Run a same-screen test with operators before switching; I found no evidence that justifies a blind migration.
- Rejected as the primary face:
  - Inter: default proportional digits and ambiguous `1lI` unless features are enabled, and its full feature set needs a custom self-hosted build.
  - Geist: same digit and `1lI` problems, and I found no Thai companion.
  - Roboto Flex: 1,733 KB upstream TTF, with features not useful here.
- Decision to revisit: if Thai paragraphs (help, reports, long alarm guidance) become common, use a looped Thai face in those areas only. Noto Sans Thai Looped and IBM Plex Sans Thai Looped both exist on Google Fonts.

### Gaps
- No browser test was run. Anuphan's weight at 12-13 px on the Windows displays actually used by operators needs a visual check with real tag names and alarm text.

## What do Datadog, Grafana, Databricks, Linear, Vercel and Stripe actually use?

### Takeaway
Only Grafana's product default and Datadog's login surface were verifiable without authentication; the rest are marketing-site evidence. Inter, Noto Sans, DM Sans and Geist are open options in this set; National and Söhne come from Klim Type Foundry and should be treated as commercial. Inter is the only family seen on two of the six vendors.

| Vendor | Verified use | Surface and method | Licence status |
|---|---|---|---|
| Datadog | NotoSans, Roboto Mono | [Login CSS](https://static.datadoghq.com/static/v/35.150516226/js/dd-login-rspack.min.css) **[css]**. Logged-in app UNVERIFIED | Noto Sans family status not checked in this pass |
| Datadog | National | [Marketing site font file](https://www.datadoghq.com/fonts/web-fonts/NationalWeb-Bold.woff2) **[file]** | Name table credits Klim Type Foundry; treat as proprietary |
| Grafana | Inter, Roboto Mono | [`createTypography.ts`](https://raw.githubusercontent.com/grafana/grafana/main/packages/grafana-data/src/themes/createTypography.ts), main branch **[source]** | Inter is OFL |
| Grafana | Inter, Poppins | [grafana.com](https://grafana.com) marketing files **[file]** | Not needed for the decision |
| Databricks | DM Sans, DM Mono, Hubot Sans | [Marketing site](https://www.databricks.com) **[file/css]**. Workspace product UI UNVERIFIED | Not checked |
| Linear | Inter Variable 4.001 | [linear.app font file](https://static.linear.app/fonts/InterVariable.woff2) **[file]**. Logged-in app UNVERIFIED | OFL |
| Vercel | Geist, Geist Mono | [vercel.com](https://vercel.com) **[css]**. Dashboard UNVERIFIED | [OFL](https://github.com/vercel/geist-font) |
| Stripe | Söhne, Source Code Pro | [Marketing font file](https://b.stripecdn.com/mkt-ssr-statics/assets/_next/static/media/Sohne.cb178166.woff2) **[file/css]**. Dashboard UNVERIFIED | Name table credits Klim; treat as proprietary |

### Cited Findings
- Grafana's source defines `'Inter', 'Helvetica', 'Arial', sans-serif` and `'Roboto Mono', monospace`, with a 12/18 small style and a 14/16 code style — [Grafana source](https://raw.githubusercontent.com/grafana/grafana/main/packages/grafana-data/src/themes/createTypography.ts).
- Datadog's login CSS declares `NotoSans, Lucida Grande, Lucida Sans Unicode, sans-serif` and `Roboto Mono, Menlo, Liberation Mono, Courier, monospace` — [Datadog CSS](https://static.datadoghq.com/static/v/35.150516226/js/dd-login-rspack.min.css).
- A third-party profile says Databricks uses DM Sans plus JetBrains Mono as a fallback, while another says DM Sans plus DM Mono. These profiles conflict; the DM Mono file was verified directly on the marketing site — [webdesignhot](https://www.webdesignhot.com/design.md/databricks/); [shadcn.io](https://www.shadcn.io/design/databricks).

### Inferences
- Two of the data-heavy tools that could be checked pair a neutral sans with a separate monospace face. This supports having a mono token, but the sample is too small to show that Inter or any other face is required.
- Marketing-site fonts should not be assumed to apply to the product UI.

### Gaps
- Datadog, Databricks, Linear, Vercel and Stripe logged-in product CSS: UNVERIFIED, as no accounts were used.
- Datadog Druids documentation could not be read: the fetch returned no font data.
- "Linear uses Inter Display" could not be confirmed. Only Inter Variable was verified.
- Klim licence terms were not read. "Proprietary" is inferred from the foundry credit in the font files.

## Licence, numerals, slashed zero, axes and self-hosting

### Takeaway
All six candidates are OFL and can be self-hosted, but feature support differs and **Fontsource's Latin subsets drop features found upstream**. `zero` was missing from every Fontsource Latin file checked, so CSS such as `font-variant-numeric: slashed-zero` will do nothing with them.

| Font (upstream version) | Licence | Default digits | `tnum` | `zero` | Other 0/O, 1/l help | Axes | Size checked |
|---|---|---|---|---|---|---|---|
| Inter 4.001 | OFL | Proportional | Yes | Yes | `ss02`, `cv05`, `cv08` | opsz 14-32, wght 100-900 | 343 KB upstream; 48 KB Fontsource Latin wght |
| Geist 1.900 | OFL | Proportional | Yes | **No** | `ss01`-`ss11` present; purposes not checked | wght | 67 KB npm |
| IBM Plex Sans 3.201 | OFL | **Tabular, 0.6 em** | Not needed | Yes (upstream) | `ss01`-`ss06`; `l` and `I` already distinct by default | wdth 75-100, wght 100-700 | 524 KB upstream TTF; 46 KB Fontsource Latin wght |
| Roboto Flex 3.000 | OFL | Same width (1156/2048) | Not found | **No** | None found | 13 axes, including opsz, wght, wdth, GRAD | 1,733 KB upstream TTF; 326 KB Fontsource Latin full |
| JetBrains Mono 2.305 | OFL | Mono | Not needed | Yes | Marked zero by default; `ss`/`cv` | wght 100-800 | 293 KB upstream TTF; 40 KB Fontsource Latin |
| Geist Mono 1.900 | OFL | Mono | Not needed | **No** | Marked zero by default; `ss` sets | wght 100-900 | 69 KB npm |
| IBM Plex Mono 2.3 | OFL | Mono | Not needed | Yes | Marked zero by default; `ss01`-`ss05` | None (static) | 132 KB upstream TTF per weight; 15 KB Fontsource Latin 400 |

### Cited Findings
- Inter documents OFL 1.1, `tnum`, `zero`, `ss02`, `cv05` and `cv08` — [Inter](https://rsms.me/inter/). Feature tags were also confirmed in the [upstream file](https://rsms.me/inter/font-files/InterVariable.woff2) **[file]**.
- Geist is OFL 1.1 and installs with `npm i geist` — [geist-font](https://github.com/vercel/geist-font). Tables were read from the [npm 1.9.1 package](https://registry.npmjs.org/geist/-/geist-1.9.1.tgz) **[file]**.
- JetBrains Mono's font is OFL-1.1, its build source is Apache 2.0, and a no-ligature "NL" version exists — [JetBrains Mono](https://github.com/jetbrains/JetBrainsMono). `zero` and `calt` were read from the [variable file](https://raw.githubusercontent.com/JetBrains/JetBrainsMono/master/fonts/variable/JetBrainsMono%5Bwght%5D.ttf) **[file]**.
- Fontsource package metadata lists OFL-1.1 for every checked package at 5.3.0 — e.g. [`@fontsource-variable/inter`](https://registry.npmjs.org/@fontsource-variable%2Finter/latest).
- Fontsource Latin subsets checked **[file]**:
  - `@fontsource-variable/inter`: `calt ccmp pnum tnum`, with no `zero`, `ss` or `cv` ([file](https://cdn.jsdelivr.net/npm/@fontsource-variable/inter@5.3.0/files/inter-latin-wght-normal.woff2)).
  - `@fontsource/ibm-plex-sans`: `ccmp liga` only ([file](https://cdn.jsdelivr.net/npm/@fontsource/ibm-plex-sans@5.3.0/files/ibm-plex-sans-latin-400-normal.woff2)).
  - `@fontsource-variable/jetbrains-mono`: `calt ccmp` only ([file](https://cdn.jsdelivr.net/npm/@fontsource-variable/jetbrains-mono@5.3.0/files/jetbrains-mono-latin-wght-normal.woff2)).
  - Upstream `wdth` on Plex Sans is also absent from the Fontsource `wght` file.
- Google Fonts metadata confirms axes for Geist Mono, Plex Sans, JetBrains Mono and Roboto Flex — e.g. [Plex Sans metadata](https://fonts.google.com/metadata/fonts/IBM%20Plex%20Sans).

### Inferences
- If a slashed zero is required in Plex Sans or Inter, build a project subset with `pyftsubset --layout-features=...` from the upstream font; do not rely on Fontsource. For vissointan, showing critical alphanumeric tag values in Plex Mono avoids that build, because its default zero is already marked.
- A render I made with upstream files shows Inter, Geist and Roboto Flex with similar-looking `l` and `I` by default, while Plex Sans separates them. This is my visual reading of one specimen at 26 px, not a test result.

### Gaps
- Geist `ss` set purposes were not reviewed.
- I checked Fontsource Latin subsets only; Latin-extended subsets may differ.
- Roboto Flex's digit width was only checked as uniform; its `tnum` and `pnum` behaviour was not tested in a browser.

## Evidence on legibility: dense data, small sizes, 0/O and 1/l

### Takeaway
The evidence supports design principles for confusable characters but does not rank Inter, Geist, Plex or JetBrains Mono. I found no peer-reviewed study on these fonts in dense dashboards, and no empirical study specifically on 0/O confusion in UI fonts. Treat vendor claims about legibility as design intent.

### Cited Findings
- Beier and Larson (2010), *Information Design Journal* 18(2), 118-137, used 41 participants and a single-letter method to compare letter variants within custom test typefaces. They report that a single-storey `a` was less legible than a double-storey `a`, and that broad `j` and `l` variants performed better, whereas a wide `f` did not reliably do so — [paper](https://www.microsoft.com/en-us/research/uploads/prod/2021/06/Beier-Larson-2010-Design-Improvements-for-Frequently-Misrecognized-Letters.pdf).
- A secondary summary adds that a serif on `i` and `j` helped in distance viewing and that broadening `t` and `l` improved legibility — [typography.guru, secondary](https://typography.guru/journal/what-makes-letters-legible-r37/).
- Beier, Bernard and Castet (2018), a Design Research Society conference paper, tested digit variants in random three-digit strings in peripheral vision. A narrow `1` without a bottom crossbar performed best, open apertures helped `3` and `9`, a straight-legged `7` without a serif on the bar performed best, and crowded digits generally benefited from simpler, shorter skeletons — [DRS 2018](https://dl.designresearchsociety.org/drs-conference-papers/drs2018/researchpapers/126).
- JetBrains says it maximises lowercase height while keeping character width standard, and presents this as helping small sizes. This is a vendor claim — [JetBrains Mono](https://github.com/jetbrains/JetBrainsMono).
- x-heights as a share of the em **[file]**: Inter 0.546, Geist 0.53, Plex Sans/Mono 0.516, Roboto Flex 0.514, JetBrains Mono 0.55, Geist Mono 0.53. Same upstream files as above.

### Inferences
- The studies support letter differentiation in general, so a distinct `l`/`I` and a marked zero are reasonable requirements. They do not validate a particular commercial or open UI font.
- The peripheral-vision digit result may matter for glanced-at SCADA values, but its transfer to foveal reading of live 12-13 px numerals is untested.
- Plex's lower x-height is a real trade-off against Inter and JetBrains Mono. It may look smaller at the same pixel size, and a slightly larger token could offset this.

### Gaps
- No study found directly comparing 0/O or slashed versus dotted zero in UI text.
- No peer-reviewed comparison of the named candidate fonts was found.
- Rendering at 11-13 px on Windows and hinting differences were not tested.

## Thai fonts: loops, weights, licence, Latin match, compact rows, reading research

### Takeaway
Anuphan is the best fit for short, compact UI text with Plex Latin. The reading evidence favours looped Thai for paragraph reading, so loopless should be limited to labels, values and short messages until tested with operators. Loops are not the only variable: older readers may do better with looped text in distance acuity, which is relevant to plant staff of mixed ages. At 13 px, no candidate's worst-case stack fits a 16 px line.

Metrics and ink below are from upstream Regular or default masters **[file]**. "Ink span" is the HarfBuzz-shaped maximum across `ปั๊ม ที่นี่ ญี่ปุ่น ฎู ฐุ ฤๅ สู้ปั้น น้ำ`.

| Font | Loops | Weights | Licence | hhea asc/desc | Ink top/bottom (em) | Ink span at 13 px | Latin match |
|---|---|---|---|---|---|---|---|
| Anuphan | Loopless | wght 100-700 | OFL | 1.025/-0.275 | 1.066/-0.316 | **18.0 px** | Latin from Plex; digits 0.6 em |
| IBM Plex Sans Thai | Loopless (separate Looped family) | 7 static | OFL | 1.116/-0.534 | 1.083/-0.415 | 19.5 px | Designed for Plex; digits 0.6 em |
| Noto Sans Thai | Loopless (separate Looped family) | wght 100-900, wdth 62.5-100 | OFL | 1.061/-0.45 | 1.009/-0.432 | 18.7 px | Digits 0.572 em; neutral |
| Sarabun | Looped, per secondary source | 8 with italics | OFL | 1.068/-0.232 (win 1.286/0.567) | 1.218/-0.535 | 22.8 px | Digits 0.55 em; hhea and win metrics differ |
| Kanit | Loopless, per my visual knowledge; UNVERIFIED | 9 with italics | OFL | 1.1/-0.395 | 1.013/-0.351 | 17.7 px | Lower x-height 0.474 **[fontsource file]** |
| Prompt | Loopless, per secondary source | 9 with italics | OFL | 1.09/-0.422 | 1.019/-0.368 | 18.0 px | Geometric, less like Plex (visual opinion) |
| LINE Seed Sans TH | UNVERIFIED | Thin, Regular, Bold, ExtraBold, Heavy | OFL | Not measured | Not measured | Not measured | No Medium/SemiBold listed; poor fit for UI hierarchy |

### Cited Findings
- Typotheque's 2024 Bangkok study covered 180 native Thai readers across three experiments:
  - Looped text was faster in distance acuity.
  - Continuous reading showed "a small significant difference" favouring looped, with no differences in comprehension.
  - The page "strongly" recommends looped Thai for paragraphs.
  - Loops strongly influenced a feeling of readability across formats, including car and smartwatch UI mock-ups — [Typotheque](https://www.typotheque.com/research/effects-of-loops-in-thai).
- The same page reports age-dependent acuity results, stating that looped suits older readers and younger individuals read loopless more efficiently. Younger participants preferred loopless only where less text was present — [Typotheque](https://www.typotheque.com/research/effects-of-loops-in-thai).
- **Limits and conflict:** the page does not state peer review, and Typotheque is a type foundry. Experiment 2 reports no age effect, while Experiment 1 does. A search summary of [the ATypI talk](https://atypi.org/presentation/the-contemporary-effects-of-thai-loops-a-perceptual-study/) says reading performance was not affected by loops, which conflicts with the small significant difference on Typotheque's page; I did not read the talk page directly.
- Punsongserm, Sunaga and Ihara (2017), *Archives of Design Research* 30(2), tested 34 typefaces with 35 Thai students, using isolated characters under simulated blur. Clear, serrated lines and jutting loops improved legibility, shrunken second loops caused more errors, and reducing the first loop of ฮ produced about 40% incorrect responses — [paper](https://aodr.org/_common/do.php?a=full&aidx=10554&bidx=785).
- Anuphan's variable range and Sarabun, Kanit and Prompt weights come from Google Fonts metadata — e.g. [Anuphan](https://fonts.google.com/metadata/fonts/Anuphan), [Sarabun](https://fonts.google.com/metadata/fonts/Sarabun). Noto and Plex looped siblings exist as separate families — [Noto Sans Thai Looped](https://fonts.google.com/metadata/fonts/Noto%20Sans%20Thai%20Looped), [IBM Plex Sans Thai Looped](https://fonts.google.com/metadata/fonts/IBM%20Plex%20Sans%20Thai%20Looped).
- Sarabun and Prompt loop classifications come from a search summary of foundry and specimen pages, not a primary statement — [Fontsource Prompt, secondary](https://fontsource.org/fonts/prompt/about).
- LINE Seed fonts are released under OFL 1.1, attribution is "highly" recommended for commercial use, and the listed weights are as above — [LINE Seed](https://seed.line.me/index_en.html); licence also shown on [line/seed](https://github.com/line/seed).
- The W3C Thai Layout Requirements note has no Thai-specific line-height or letter-spacing guidance; these sections are open questions or "tbd" — [W3C](https://www.w3.org/TR/thai-lreq/).

### Inferences
- **Row height:** Anuphan's worst-case ink needs about 18 px at 13 px and 16.6 px at 12 px. Use a 20 px minimum line box at 13 px and 18 px at 12 px for text that can be Thai, or avoid `overflow: hidden` clipping on those cells. Ink is not the same as line box, so check stacked marks in actual table rows.
- **Baseline stability:** identical hhea values should keep Plex and Anuphan text better aligned in mixed spans than Plex with Plex Sans Thai. The centre of the hhea box differs by 0.084 em with Plex Sans Thai (about 1.1 px at 13 px) and by 0 with Anuphan. Browser line-box behaviour with per-glyph fallback still needs a test.
- **Sarabun's hhea/win gap:** its ink exceeds hhea by a wide margin, so clipping risk is highest in compact rows.
- **Loopless for this console:** an inference from short-text preference data and from Plex matching. Neither study tested a dense industrial UI, so run a small test with representative older operators if Thai alarm text is safety-relevant.
- **Hierarchy:** the current styles should map cleanly to Anuphan's 400, 500, 600 and 700. Anuphan has no weights above 700.

### Gaps
- LINE Seed Sans TH font files were not found in the repository tree at the paths I searched, and the zip was not downloaded, so its metrics and loop style are unmeasured. Google Fonts metadata returned nothing for it, and Fontsource availability was not checked.
- Kanit's loop classification lacks a cited source in these notes. It is excluded from the recommendation regardless, given its display-oriented low x-height.
- I found no peer-reviewed study of looped versus loopless Thai in dense UI at 11-14 px.
- HarfBuzz ink measurements are unhinted and from one sample string set at Regular or default weight. Other strings or weights may be taller.
