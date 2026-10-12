# 22 — Design Literature & Principles (logo, color, type, ambient, 3D)

Status: research synthesis, Oct 2026. Sources: 8-agent literature sweep —
papers and canonical books only (no blogs). Every principle below cites its
source. This doc grounds the v4 reskin and any future identity work.

## 1. Logo / mark — "Plant Ops OS"

**The literature verdict:** silhouette-first (Wheeler, *Designing Brand
Identity* — shape is perceived before color); simple+single-meaning for new
brands (Janiszewski & Meyvis, JCR 2001 — fluency drives liking);
symmetric+angular signals reliability (Jiang et al., JCR 2016; Luffarelli
asymmetry effect, JMR 2019); descriptive cue OK for unfamiliar brands
(Luffarelli et al., JMR 2019); implied motion backfires for conservative
brands (Cian et al., JMR 2015); industrial marks end up geometric (Siemens,
ABB precedents).

**Logo brief (binding):**
- Glyph: single geometric mark, ≤2 strokes, legible at 16px favicon; square
  box; works monochrome + reversed-on-dark; no text in glyph.
- Wordmark: uppercase neo-grotesque (IBM Plex), generous tracking.
- **Never** use "POS" as abbreviation (point-of-sale collision). Use
  "PLANT OPS OS" full, or "PO" monogram.
- Color of mark: neutral ink/white OR brand indigo `#5E6AD2` only. Never
  red/amber/green (alarm confusion), never violet (reserved for AI).
- Semantic target: angular/kiki geometry (precision); decide deliberately
  whether a subtle "plant=botanical vs factory" pun is wanted — default no.
- Variants: full lockup, glyph-only, single-color stencil (ops wall).
- Motion: stroke-draw/segment-assembly on loading only.

## 2. Color

- **Workflow**: build ramps in **OKLCH** (Ottosson 2020 — perceptually
  uniform, hue/chroma independent of lightness); emit hex; clamp chroma.
  CIELAB is a baseline not truth (Fairchild 2013) — evaluate accents in
  context, not on a picker.
- **Harmony = similarity** (Schloss & Palmer 2011): small hue diffs + low
  combined saturation; a restrained palette + ONE high-contrast accent is
  both harmonious and preferred (EVT: Palmer & Schloss, PNAS 2010).
- **Itten is not science** (Koenderink et al. 2023) — vocabulary only.
- **Dark theme rules**: surfaces `#121212`–`#1E1E1E` (never `#000`), text
  ~87% white (halation; ~⅓ adults have astigmatism), slightly reduced weight
  on dark. Positive-polarity advantage is real (Piepenbrock 2014, Buchner
  2007) — **a light theme for office use is a legitimate future need**, not
  optional forever.
- **Reserved hues by contract** (IEC 60073 + ISA-101): red=danger,
  yellow/amber=warning, never spend them elsewhere. MDPI Sensors 2024: red
  text = highest measured visual fatigue.
- **Thai cautions**: red↔yellow are politically polarized; purple has
  mourning associations (widows). Our violet AI accent is acceptable but
  should stay clearly *instrumental*, never decorative; brand accent stays
  blue/indigo — culturally neutral.
- **One accent** wins because salience is relative (Theeuwes 1992) — ISA-101
  "happy plant = no color" applied to brand.

## 3. Typography

- Keep **IBM Plex** superfamily (Sans labels / Mono data / tnum everywhere —
  `font-variant-numeric: tabular-nums lining-nums`; slashed zero for 0/O).
- Dark mode: damp GRAD/weight, slight tracking increase, off-white text
  (CHI 2023: dark reads slower — mitigate, don't ignore).
- Floors: body ≥14px dark, labels ≥11–12px, no condensed for values
  (AgeLab: regular width beats condensed 11.2%); MIL-STD-1472H ≥15 arcmin
  for ops-wall distance checks.
- Hierarchy via weight/color before size (Lupton 2024).

## 4. Information design (ops wall)

Gestalt: group by proximity/common-region first, borders last (Palmer &
Rock 1994). Pre-attentive: alarms must pop out via unique channel — color
has only ~7–10 discriminable hues, spend them on alarms (Ware 2020;
Treisman & Gelade 1980). Alarm-rate budget: ≤6/hr ok, >2/10min = system
failure (ISA-18.2). Tufte empirics: remove ink that competes with data,
keep structural ink (Carswell & Kosslyn 1994; embellishments aid recall —
Bateman 2010). Position = attention: top-left + visual center prime
(Nielsen eyetracking).

## 5. Ambient tier (the "Mission Surface" field)

Grounded in calm technology canon:
- Weiser & Brown 1995; Ishii ambientROOM 1998 — periphery informs via
  *slow variation*, anomalies surface via *discontinuity*.
- Pousman & Stasko AVI'06: ambient tier carries "important but NOT
  critical" info only — critical stays foreground.
- Isolines convey field structure, not point values (ISPRS 2021 —
  choropleth beats contours for lookup) → our field is pattern-only. ✓
- **Motion onset captures attention involuntarily** (Abrams & Christ 2003);
  continuous smooth motion does not → field must drift smoothly, never
  pop/step; escalate via gradual reconfiguration.
- Ware et al.: pressure on contour channel while color carries temperature
  — channel separation = our luminance-only field + reserved hues. ✓

## 6. 3D twin — honest evidence

- Wickens (HFES 2000, IJAP 2017): 3D helps *navigation/spatial lookup*,
  hurts *precise judgment/search*. → **3D for "where", 2D for "how much"**
  (values/sparklines stay 2D even inside the 3D view).
- Munzner 2014: "no unjustified 3D" — plant twin qualifies (intrinsically
  spatial data) only with constrained navigation → fixed ortho iso ✓.
- Iso-only drawings can read flat (19–38% PSVT:R) → need shading/contact
  shadows. Pilots *preferred* 3D but performed *worse* — keep 2D primary
  by evidence, not taste. ✓ matches v4 choice.

## 7. Design-system governance

- W3C Design Tokens spec (stable 2025.10) as mental model;
  primitive→semantic→component one-way layering (we're close; enforce).
- Checker upgrades (Carbon/Stripe lineage): contrast-pair enforcement,
  step-interval rule within ramps, reserved-hue windows, component refs
  may touch semantic only.
- Version tokens; removals are SemVer-major — deprecate via alias.

## 8. Decisions this doc settles

1. Logo: geometric angular mark, ink-or-indigo only, "PO"/wordmark,
   never "POS". (Design task deferred — needs a design pass, not code.)
2. Palette: indigo brand + phosphor-cyan "live" + reserved alarm hues +
   violet-AI (instrumental, not decorative).
3. Ambient field: luminance-channel only, smooth-drift only, pattern-not-
   values — validated.
4. 3D: spatial view only; 2D remains primary by evidence.
5. Light theme: real future requirement (polarity advantage) — note as v5.
