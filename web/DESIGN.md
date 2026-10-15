# vissointan — Landing Design System

Source: runtime-extracted from `https://hex.tech/product/notebooks/` via CDP
`getComputedStyle` sweep (ref/hex/extract.json, scroll bands). Design *system*
tokens/anatomy/motion come from that extraction; all copy, brand, and imagery
are vissointan originals — no Hex trademarks, fonts, logos, or artwork.

## 0. Research Log

- clone-from-url runtime sweep: colors, fonts, button anatomy (CornerLines +
  CornerCircles + gradient-border), keyframes (ticker, noise, dGOzbh,
  announcement-pill-shine), textures (bkg-noise.webp, checkerboard SVG),
  responsive captures at 390/1440/1920.
- Font substitution: PP Formula SemiExtended (proprietary) → Space Grotesk 700;
  Cinetype (proprietary) → IBM Plex Sans; Cinetype Mono → IBM Plex Mono.
- Texture substitution: proprietary noise webp → inline SVG feTurbulence.
- Deep pass 2 (scripts/hex-deep.py → ref/hex/deep/): hover-driven mega-menu
  captures, 14 gradient sites, 12 keyframes, 175-request network log (all
  third-party trackers — no page API), mobile overlay, band screenshots.
- Deep pass 3 (hex.tech home, 2025 light theme): paper canvas `#f0edee→#f4f1f2`,
  graph-paper grid, checkerboard `#e8e4e6`, PP Editorial New italic →
  Instrument Serif italic, PP Formula SemiExtended → Space Grotesk 700.

## Dual theme — Thai clock

`.landing-root` carries semantic vars (`--hx-*`); `thaiNight()` in
Landing.tsx flips `.hx-dark` when Bangkok time is outside 06:00–18:00 ICT,
re-checked every 60 s. Day = paper (graph grid + newsprint fleck, eggplant
ink, deep rose `#a55d73`); night = the original ink extraction. Dropdown
panels anchor to their trigger (`left:0` / `.hx-dd--end` → `right:0`), an
invisible `::before` bridge covers the gap, and close is intent-delayed
140 ms in JS; Esc closes. Reveal = `translateY(34px)` + overshoot
`cubic-bezier(.34,1.56,.64,1)` via `--hx-bounce`.

### Mega-menu (validated runtime)

- Viewport: `bg #14141c`, `border 1px #3a3138`, `radius 5px`,
  `shadow 0 4px 24px -4px rgba(0,0,0,.3)`, ~772px wide, centered under nav
  (~10px below bar). Items: 30px bordered glyph square + bold title + dim desc;
  hovered trigger `background rgba(245,192,192,.1)`, radius 1px; chevron
  rotates 180°; column eyebrows uppercase mono dim; bottom promo row with
  dashed top border.
- Mobile: full-screen fixed overlay — burger morphs to X-in-circle, eyebrow
  groups separated by dashed hairlines, items = glyph + label + trailing `>`.

### Other validated details

- Hero bg adds voronoi polygon mesh + nodes (`Voronoi__VoronoiWrapper`).
- Trusted strip: centered label + 8 static wordmarks under CTAs.
- Quote band: side block (logo + wordmark + role) | 1px divider | quote.
- "Built for teams": 102 tiled inline-SVG glyphs — ours uses an SVG
  `<pattern>` tile with radial mask.
- Testimonial pair: pennant-badge card + radial-wash quote card
  (`radial-gradient(circle at 66% 50%, rgba(26,26,37,.5), rgba(15,15,21,.5))`).
- Crosshair accents: `linear-gradient(#e3b2b3 50% → transparent)` v/h bars.
- Cells: toolbar run button, caret blink, floating autocomplete menu,
  big-number overlay card (`rotate(1.6deg)`, offset outside panel).
- Keyframes added: `hx-dd-in`, `hx-mnav-in`, `hx-blink`.

## 1. Atmosphere & Identity

Control-room-noir: near-black canvas with warm dusty-rose light, hairline
drafting marks, and a subtle paper-noise grain — technical drawing at night.
Signature moments: gradient-border "corner" buttons with orbit dots, and the
mono ticker marquee.

## 2. Color

| token | value | source |
|---|---|---|
| `--hx-ink` | `#14141c` | body backgroundColor |
| `--hx-ink-deep` | `#0f0f15` | hero radial edge |
| `--hx-panel` | `#1d1d29` | floating panels (hamburger radial) |
| `--hx-pink` | `#f5c0c0` | nav/links/buttons text |
| `--hx-pink-dim` | `#e3b2b3` | body copy |
| `--hx-mauve` | `#ad8eb6` | gradient border end stop |
| `--hx-line` | `#3a3138` | corner ticks, hairlines |
| `--hx-checker` | `#312a31` | margin checkerboard |
| `--hx-white` | `#ffffff` | headings |
| `--hx-tick-a`/`--hx-tick-b` | `#252128` / `#201d25` | ticker gradient |

Gradient border (all buttons): `linear-gradient(#14141c,#14141c)` padding-box
over `linear-gradient(45deg,#f5c0c0,#ad8eb6)` border-box on 1px transparent
border. Heading text gradient: `55deg, #fff 20% → rgba(245,192,192,.8)`
with `background-clip: text`.

## 3. Typography

- Display (h1): "Space Grotesk", 700, 60px/78px, letter-spacing -0.031em;
  mobile 36px/44px.
- Section (h2): "Space Grotesk", 700, 40px/52px, ls -0.025em; mobile 30px.
- UI/body: "IBM Plex Sans", 14–17px, `--hx-pink-dim`.
- Mono (ticker, cells, spec): "IBM Plex Mono", 12–13px, `--hx-pink`.

## 4. Spacing & Layout

- Content max-width 1200px, side padding 24px; checkerboard margin rails at
  ±(content edge) on ≥1280px (4×4 SVG tile, `--hx-checker`).
- Sections: 110–130px top padding. Hero: 130px top, centered, max 820px.
- Nav: 62px sticky bar, hairline bottom border.

## 5. Components

### Nav (`hx-nav`) — centered-logo 3-part grid
- `grid-template-columns: 1fr auto 1fr`; left links, center brand, right
  links + login + CornerButton. Height 62px, hairline bottom border.
- Mobile ≤860px: links/CTA hide → circle burger (radial `#1d1d29→#0f0f15`).

### Section split (`hx-split`)
- Left: icon chip (26px circled hairline, Icon) + h2 + body + ghost
  CornerButton. Right: **bright** product visual — off-white panels
  `#f2eff3` with ink text `#2a2530` on the dark canvas (extracted look:
  Hex's white cell screenshots pop off the dark page).
- Alternate copy/visual sides per section.

### Quote band (`hx-quote`)
- Full-width, centered: mono brand mark + Space Grotesk 34–44px quote in
  `--hx-pink-dim`, small attr line. No card chrome — type only.

### Feature trio / template grid (`hx-card`)
- `--hx-panel` card + hairline + 160px "thumbnail" zone at top carrying a
  line-art SVG illustration (pink strokes on ink) — matches Hex's
  screenshot-thumbnail card anatomy without their assets.

### Big centered band (`hx-centerband`)
- "Built for…" pattern: glyph-starfield tile background (8% opacity,
  tiny line-glyph repeating SVG), centered h2 at display size, sub, button.

### Footer (`hx-foot`)
- 4 link columns (mono 11px uppercase heads + 13px links) + brand block;
  hairline top border, 90px vertical padding.

### CornerButton (`hx-btn`, primary/nav/large/ghost variants)
- Height 38px (nav), 50px (hero large); padding 0 15px / 0 20px.
- Gradient border recipe above; label 14px `--hx-pink`.
- `::after`: inset 1px wash `rgba(245,192,192,.14)`, opacity .2 → .45 hover,
  .25s `cubic-bezier(.25,.1,.25,1)`.
- 4 `hx-corner` L-ticks: 15×15, two 1px `--hx-line` edges at each corner,
  wrapper opacity 0 → 1 on hover/focus-visible.
- 4 `hx-orb` rings: 13×13, `1px solid rgba(245,192,192,.3)`, center at each
  corner (−7px outset); each contains a 3px dot orbiting its rim
  (`hx-spin`, 3s linear infinite; second ring 2s reverse on primary).
- Ghost: same border recipe at .55 opacity, no fill layer.

### Ticker (`hx-ticker`)
- 27px bar, `linear-gradient(to left,#252128,#201d25,#252128)`, mono 12px
  `--hx-pink`; marquee `translateX(0→-50%)` 56s linear infinite
  (matches extracted `ticker` keyframe shape).

### Badge pill (`hx-pill`)
- Hairline `--hx-line` border, mono 12px `--hx-pink`, radius 999px;
  shine sweep `translateX(-160%→160%)` 5s ease-in-out infinite
  (from `announcement-pill-shine`).

### Marquee (`hx-marquee`)
- Protocol wordmarks row, mono 13px uppercase ls .12em, `.6` opacity;
  duplicated track `translateX(0→-50%)` 40s.

### CodeCell (`hx-cell`)
- `--hx-panel` surface, hairline `--hx-line`, mono 12.5px, syntax tints:
  keyword `--hx-pink`, value `--hx-mauve`, ok `#7ee787`, warn `#f0b96e`.

### MetricCard (`hx-mini`)
- Panel + hairline; mono label 11px dim, Space Grotesk value 30px,
  sparkline polyline `--hx-pink`/`--hx-mauve`.

## 6. Motion & Interaction

- Easing: `cubic-bezier(.25,.1,.25,1)` ("easeOut-extracted"); hover/fill .25s.
- Orbit dots: `hx-spin` rotate 360° 2s/3s linear infinite (from `dGOzbh`).
- Scroll reveal (`data-reveal` → `.hx-in`): opacity 0→1 + translateY(18px→0)
  .6s easeOut, staggered by DOM order via `transition-delay`.
- Card hover: border-color brightens to `--hx-pink`/40, translateY(-2px).
- GPU-only: transform/opacity/filter. `prefers-reduced-motion`: all
  keyframes/animation → none; reveals instant; marquee static (wrap ok).

## 7. Depth & Surface

- Page noise: fixed layer, SVG feTurbulence tile 200×200, opacity .05,
  `mix-blend-mode: overlay` (replaces proprietary `bkg-noise.webp`).
- Hero vignette: `radial-gradient(circle at 0% 0%, #14141c 300px, #0f0f15)`.
- Hero line-art: large faint arcs/circles (`stroke: var(--hx-line)`) behind
  the headline + scattered micro-glyph marks (Hex uses notebook-icon
  starfield; we use tiny "▨" outline rects 6% opacity).
- Panels: single hairline border, no shadows; depth via layering + noise.

## 8. Accessibility Constraints

- `--hx-pink`/`--hx-pink-dim` on `--hx-ink` ≥ 7:1 — body/link safe.
- Focus: `:focus-visible` 1px `--hx-pink` outline + corner ticks on.
- Marquees `aria-hidden` with a static sr list; ticker links real anchors.
